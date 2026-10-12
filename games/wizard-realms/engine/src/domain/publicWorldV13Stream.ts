import type { ReadonlyWorldTile } from './activeWorldTerrain'
import { discoveryMaskHasTileId } from './discoveryMask'
import { nearbyWorldTileIds, PUBLIC_SPELL_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { highlandLandmark } from './highlandContent'
import { discoveredTileIdsInActiveWindow } from './publicV13DiscoveryWindow'
import { preservesPublicV13History } from './publicV13History'
import { createPublicV11RouteSupport } from './publicV11RouteSupport'
import type { PublicV11LandmarkEvent } from './publicWorldV11Authority'
import { publicV11Gait } from './publicWorldGait'
import type { PublicV13Start } from './publicWorldV13Flow'
import { decodePublicV13Head, decodePublicV13SourceLineage, PUBLIC_V13_SCHEMA } from './publicWorldV13Snapshot'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import type { StreamedWorldEvent, StreamedWorldIntent, StreamedWorldRejection,
  StreamedWorldRuntime, StreamedWorldState } from './streamedWorld'
import { createStreamedWorldV13FromState } from './terrainWorkRuntimeHooks'
import type { TradeListingSoldEvent, WizardEvent } from './types'
import { settleTradeListings, stepRng } from './world'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

export type PublicV13StreamEvent = (StreamedWorldEvent & { sequence: number })
  | TradeListingSoldEvent | PublicV11LandmarkEvent
  | Extract<WizardEvent, { type: 'spell_cast' | 'skill_xp_gained' }>
export type PublicV13StreamIntent = StreamedWorldIntent
  | { type: 'cast_spell'; spellId: 'wayfinder_glow' }
export type PublicV13StreamRejection = Omit<StreamedWorldRejection, 'intentType' | 'code'> & {
  intentType: PublicV13StreamIntent['type']
  code: StreamedWorldRejection['code'] | 'unlearned_spell'
}
export interface PublicV13StreamSession {
  view(): Readonly<{ tick: number; player: StreamedWorldState['player'];
    activeKnownTileIds: readonly string[]; activeTiles: readonly ReadonlyWorldTile[] }>
  advance(intents: readonly PublicV13StreamIntent[], options: { walkRequested: boolean }): Readonly<{
    events: readonly PublicV13StreamEvent[]
    rejections: readonly PublicV13StreamRejection[]
  }>
  snapshotForSave(): PublicV13Head['state']
  previewSnapshot(): PublicV13Head['state']
}

const chunkMeters = WORLD_CELL_METERS * WORLD_CHUNK_CELLS
const gridWidth = WORLD_GRID_MAX - WORLD_GRID_MIN + 1
const chunkKey = (position: { x: number; z: number }) =>
  `${Math.floor(position.x / chunkMeters)}:${Math.floor(position.z / chunkMeters)}`

/** A streamed-only, unsaved-in-memory v13 seam. A work commit creates a new session. */
export function createPublicV13StreamSession(start: PublicV13Start,
  current?: PublicV13Head['state']): PublicV13StreamSession {
  const lineage = decodePublicV13SourceLineage(start?.sourceLineage)
  const head = lineage && decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
    saveRevision: start.saveRevision, bootstrap: start.bootstrap, state: start.state }, lineage)
  if (!head || current === undefined && head.state.movementOwner !== 'streamed') {
    throw new RangeError('Invalid streamed v13 start.')
  }
  const resumed = current === undefined ? null : decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
    saveRevision: head.saveRevision + 1, bootstrap: head.bootstrap, state: current }, lineage)
  if (current !== undefined && (!Number.isSafeInteger(head.saveRevision + 1)
    || !resumed || resumed.state.movementOwner !== 'streamed'
    || resumed.state.tick <= head.state.tick
    || !preservesPublicV13History(head.state, resumed.state))) {
    throw new RangeError('Invalid streamed v13 in-memory current state.')
  }
  let state = resumed?.state ?? head.state
  const support = createPublicV11RouteSupport({ ...state, discoveredTileIds: [] })
  const context = { seed: state.seed, fieldCampTileIds: state.fieldCampTileIds,
    authoredBuiltRouteIds: [state.mireglass.builtRoutes.bridge, state.mireglass.builtRoutes.ladder]
      .filter((id): id is string => id !== null) }
  const runtimeFrom = (current: PublicV13Head['state']): StreamedWorldRuntime =>
    createStreamedWorldV13FromState({ seed: current.seed, tick: current.tick,
      player: { position: current.player.position, yaw: current.player.yaw,
        pitch: current.player.pitch, verticalVelocity: current.player.verticalVelocity },
      discoveredTileIds: discoveredTileIdsInActiveWindow(current.discoveryMask,
        current.player.position) }, current.terrainWorks, context,
    { cachePitDug: current.mireglass.cacheExcavated, highlandRidge: true, routeSupport: support })
  let runtime = runtimeFrom(state)

  return {
    view: () => Object.freeze({ tick: state.tick, player: structuredClone(runtime.state.player),
      activeKnownTileIds: [...runtime.state.discoveredTileIds], activeTiles: runtime.activeTiles() }),
    advance(intents, options) {
      if (!Array.isArray(intents) || typeof options?.walkRequested !== 'boolean') {
        throw new RangeError('Invalid streamed frame.')
      }
      if (intents.length > 2 || intents.length === 2
        && (intents[0]?.type !== 'look' || intents[1]?.type !== 'move')) {
        const index = Math.min(1, intents.length - 1)
        return { events: [], rejections: [{ intentIndex: index,
          intentType: intents[index]?.type ?? 'move', code: 'invalid_value' }] }
      }
      const limit = publicV11Gait(state.player.equipment.feet, options.walkRequested).metersPerStep
      const copied: StreamedWorldIntent[] = []
      let cast = false
      for (const [index, intent] of intents.entries()) {
        if (!intent || typeof intent !== 'object') throw new RangeError('Invalid streamed intent.')
        if (intent.type === 'move') {
          if (!intent.delta || !Number.isFinite(intent.delta.x)
            || !Number.isFinite(intent.delta.z)
            || Math.hypot(intent.delta.x, intent.delta.z) > limit + 1e-9) {
            return { events: [], rejections: [{ intentIndex: index, intentType: 'move', code: 'invalid_value' }] }
          }
          copied.push({ type: 'move', delta: { x: intent.delta.x, z: intent.delta.z } })
        } else if (intent.type === 'look') {
          copied.push({ type: 'look', yawDelta: intent.yawDelta, pitchDelta: intent.pitchDelta })
        } else if (intent.type === 'jump') copied.push({ type: 'jump' })
        else if (intent.type === 'cast_spell') {
          if (intent.spellId !== 'wayfinder_glow') return { events: [], rejections: [
            { intentIndex: index, intentType: 'cast_spell', code: 'invalid_value' }] }
          if (!state.player.learnedSpellIds.includes(intent.spellId)) return { events: [], rejections: [
            { intentIndex: index, intentType: 'cast_spell', code: 'unlearned_spell' }] }
          cast = true
        }
        else throw new RangeError('Invalid streamed intent.')
      }
      const revealedTileIds = cast ? nearbyWorldTileIds(state.player.position, PUBLIC_SPELL_REVEAL_RADIUS_METERS)
        .filter((id) => !discoveryMaskHasTileId(state.discoveryMask, id)) : []
      if (cast && ['spellcraft', 'wayfinding'].some((skillId) => !Number.isSafeInteger(
        state.player.skillXp[skillId as 'spellcraft' | 'wayfinding'] + revealedTileIds.length * 10))) {
        return { events: [], rejections: [{ intentIndex: 0, intentType: 'cast_spell', code: 'invalid_value' }] }
      }
      try {
        const result = runtime.advance(copied, { atomicOnRejection: true, nearbyDiscovery: !cast })
        if (result.rejections.length) return { events: [], rejections: result.rejections }
        const frameEvents: Array<StreamedWorldEvent
          | Omit<Extract<WizardEvent, { type: 'spell_cast' }>, 'sequence'>
          | Omit<Extract<WizardEvent, { type: 'skill_xp_gained' }>, 'sequence'>> = [...result.events]
        if (cast) {
          frameEvents.unshift({ type: 'spell_cast', tick: result.state.tick,
            spellId: 'wayfinder_glow', revealedTileIds, revealedDigSiteIds: [] })
          frameEvents.push(...revealedTileIds.map((tileId) => ({
            type: 'tile_discovered' as const, tick: result.state.tick, tileId })))
          if (revealedTileIds.length) for (const skillId of ['spellcraft', 'wayfinding'] as const) {
            frameEvents.push({ type: 'skill_xp_gained', tick: result.state.tick,
              skillId, xp: revealedTileIds.length * 10 })
          }
        }
        // Four listings and one landmark can follow streamed events in this frame.
        if (!Number.isSafeInteger(state.eventSequence + frameEvents.length + 5)) {
          throw new RangeError('Streamed event sequence exhausted.')
        }
        const mask = frameEvents.some((event) => event.type === 'tile_discovered')
          ? new Uint8Array(state.discoveryMask) : state.discoveryMask
        for (const event of frameEvents) {
          if (event.type !== 'tile_discovered') continue
          // The hooked authority emits canonical in-grid IDs. Touch only their bits.
          const match = /^tile-(-?\d+)-(-?\d+)$/.exec(event.tileId)
          if (!match) throw new RangeError('Invalid streamed discovery.')
          const bit = (Number(match[2]) - 3 - WORLD_GRID_MIN) * gridWidth
            + Number(match[1]) - 3 - WORLD_GRID_MIN
          if (!Number.isSafeInteger(bit) || bit < 0 || bit >= mask.length * 8) {
            throw new RangeError('Invalid streamed discovery.')
          }
          mask[bit >> 3] |= 1 << (bit & 7)
        }
        const sequence = state.eventSequence + frameEvents.length
        const numbered = frameEvents.map((event, index) => Object.freeze({ ...event,
          sequence: state.eventSequence + index + 1 }))
        const player = { ...state.player, position: { ...result.state.player.position },
          yaw: result.state.player.yaw, pitch: result.state.player.pitch,
          verticalVelocity: result.state.player.verticalVelocity }
        if (revealedTileIds.length) player.skillXp = { ...player.skillXp,
          spellcraft: player.skillXp.spellcraft + revealedTileIds.length * 10,
          wayfinding: player.skillXp.wayfinding + revealedTileIds.length * 10 }
        const sale = settleTradeListings(player, result.state.tick, sequence)
        const moved = copied.some((intent) => intent.type === 'move')
          && (player.position.x !== state.player.position.x
            || player.position.z !== state.player.position.z)
        const landmark = moved && !state.highland.landmarkDiscovered
          ? highlandLandmark(state.seed) : null
        const discoveredLandmark = landmark !== null && Math.hypot(
          player.position.x - landmark.tile.center.x,
          player.position.z - landmark.tile.center.z) <= 8
        const next: PublicV13Head['state'] = { ...state, tick: result.state.tick,
          rng: { ...state.rng, simulation: stepRng(state.rng.simulation) },
          eventSequence: sale.eventSequence + (discoveredLandmark ? 1 : 0),
          discoveryMask: mask, player: sale.player,
          highland: discoveredLandmark ? { ...state.highland, landmarkDiscovered: true } : state.highland }
        const events: PublicV13StreamEvent[] = [...numbered,
          ...sale.events.map((event) => Object.freeze({ ...event }))]
        if (discoveredLandmark) events.push(Object.freeze({ type: 'highland_landmark_discovered',
          tick: next.tick, sequence: next.eventSequence, landmarkId: landmark.id }))
        if (cast || chunkKey(next.player.position) !== chunkKey(state.player.position)) {
          runtime = runtimeFrom(next)
        }
        state = next
        return { events, rejections: [] }
      } catch (error) {
        runtime = runtimeFrom(state)
        throw error
      }
    },
    snapshotForSave() {
      const owned = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
        saveRevision: head.saveRevision + 1, bootstrap: head.bootstrap, state }, lineage)
      if (!owned) throw new RangeError('Invalid streamed v13 save snapshot.')
      return owned.state
    },
    previewSnapshot: () => structuredClone(state),
  }
}
