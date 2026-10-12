import type { ReadonlyWorldTile } from './activeWorldTerrain'
import { discoveryMaskHasTileId, encodeDiscoveredTileIds } from './discoveryMask'
import { discoveredTileIdsInActiveWindow } from './publicV13DiscoveryWindow'
import { publicV11Gait } from './publicWorldGait'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './publicWorldRuntime'
import { advancePublicV14BoundaryFrame, publicV14InsideGreenway } from './publicWorldV14Boundary'
import type { PublicV14Start } from './publicWorldV14Flow'
import { advancePublicV14GreenwayFrame } from './publicWorldV14GreenwayFrame'
import { decodePublicV14Head, decodePublicV14Lineage, PUBLIC_V14_SCHEMA } from './publicWorldV14Snapshot'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { createPublicV14StreamTerrain, resolvePublicV14Surface } from './publicWorldV14Terrain'
import { validatePublicV14State } from './publicWorldV14Validation'
import type { PublicV17GroundStepPolicy } from './publicWorldV17StarterMovement'
import { starterCliffSupportAt } from './starterCliffMovement'
import type { StreamedWorldEvent, StreamedWorldIntent, StreamedWorldRuntime } from './streamedWorld'
import { settleTradeListings, stepRng } from './world'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from './worldChunks'

export type PublicV14SaveReadiness =
  | Readonly<{ status: 'ready'; state: PublicV14State }>
  | Readonly<{ status: 'deferred-airborne'; pendingBoundary: boolean }>
  | Readonly<{ status: 'needs-checked-commit'; state: PublicV14State; boundaryTransitions: number }>

export type PublicV14SessionFrame = Readonly<{
  events: readonly PublicWorldEvent[]
  rejections: readonly PublicWorldRejection[]
}>

export interface PublicV14ContinuousSession {
  view(): Readonly<{ movementOwner: PublicV14State['movementOwner']; tick: number;
    player: PublicV14State['player']; activeKnownTileIds: readonly string[];
    activeTiles: readonly ReadonlyWorldTile[]; pendingBoundary: boolean }>
  advanceFrame(intents: readonly PublicWorldIntent[],
    options: { walkRequested: boolean }): PublicV14SessionFrame
  /** A detached, possibly airborne preview, never a persistence authorization. */
  previewSnapshot(): PublicV14State
  snapshotForSave(): PublicV14SaveReadiness
}

const STEP_METERS_PER_CHUNK = WORLD_CELL_METERS * WORLD_CHUNK_CELLS
const chunkKey = (position: { x: number; z: number }) =>
  `${Math.floor(position.x / STEP_METERS_PER_CHUNK)}:${Math.floor(position.z / STEP_METERS_PER_CHUNK)}`

/** Dormant one-authority 50 ms session. No generic save or work writer is installed here. */
export function createPublicV14ContinuousSession(start: PublicV14Start,
  policy?: PublicV17GroundStepPolicy): PublicV14ContinuousSession {
  const lineage = decodePublicV14Lineage(start?.lineage)
  const head = lineage && decodePublicV14Head({ schemaVersion: PUBLIC_V14_SCHEMA,
    saveRevision: start.saveRevision, bootstrap: start.bootstrap, state: start.state }, lineage)
  if (!head) throw new RangeError('A validated v14 start is required.')
  let state = head.state
  let stream: StreamedWorldRuntime | null = state.movementOwner === 'streamed'
    ? createPublicV14StreamTerrain(state) : null
  let boundaryTransitions = 0
  const reject = (intents: readonly PublicWorldIntent[], index: number,
    code: PublicWorldRejection['code'], message: string): PublicV14SessionFrame => ({
    events: [], rejections: [{ intentIndex: index,
      intentType: intents?.[index]?.type ?? 'move', code, message }],
  })

  const advanceStream = (intents: readonly PublicWorldIntent[],
    options: { walkRequested: boolean }): PublicV14SessionFrame => {
    const old = state
    const moveIndex = intents.findIndex((intent) => intent.type === 'move')
    if (moveIndex >= 0) {
      const move = intents[moveIndex] as Extract<PublicWorldIntent, { type: 'move' }>
      const { x, z, y = 0 } = move.delta ?? {}
      const gait = publicV11Gait(old.player.equipment.feet, options.walkRequested).metersPerStep
      if (![x, z, y].every(Number.isFinite) || y !== 0 || Math.hypot(x, z) > gait + 1e-9) {
        return reject(intents, moveIndex, 'invalid_value', 'The move exceeds the permitted horizontal gait.')
      }
    }
    const translated = intents.map((intent): StreamedWorldIntent => intent.type === 'move'
      ? { type: 'move', delta: { x: intent.delta.x, z: intent.delta.z } }
      : intent as StreamedWorldIntent)
    try {
      const authority = stream ?? createPublicV14StreamTerrain(old)
      const result = authority.advance(translated, { atomicOnRejection: true, nearbyDiscovery: true })
      if (result.rejections.length) return { events: [], rejections: result.rejections.map((issue) => ({
        ...issue, message: `Streamed movement rejected: ${issue.code}.`,
      })) }
      const tick = old.tick + 1
      let sequence = old.eventSequence
      const added: string[] = []
      const events: PublicWorldEvent[] = []
      for (const event of result.events) {
        if (event.type === 'tile_discovered') {
          if (discoveryMaskHasTileId(old.discoveryMask, event.tileId)) continue
          added.push(event.tileId)
        }
        events.push({ ...event, sequence: ++sequence } as StreamedWorldEvent & { sequence: number })
      }
      if (!Number.isSafeInteger(tick) || !Number.isSafeInteger(sequence + 4)) {
        return reject(intents, 0, 'invalid_value', 'The world clock or event sequence is exhausted.')
      }
      const mask = added.length ? new Uint8Array(old.discoveryMask) : old.discoveryMask
      if (added.length) {
        const bits = encodeDiscoveredTileIds(added)
        for (let index = 0; index < mask.length; index++) mask[index] |= bits[index]
      }
      const player = { ...old.player, position: { ...result.state.player.position },
        yaw: result.state.player.yaw, pitch: result.state.player.pitch,
        verticalVelocity: result.state.player.verticalVelocity }
      const sale = settleTradeListings(player, tick, sequence)
      if (!Number.isSafeInteger(sale.eventSequence)) {
        return reject(intents, 0, 'invalid_value', 'The market event sequence is exhausted.')
      }
      const next: PublicV14State = { ...old, tick, eventSequence: sale.eventSequence,
        rng: { ...old.rng, simulation: stepRng(old.rng.simulation) },
        discoveryMask: mask, player: sale.player }
      const surface = resolvePublicV14Surface(next, next.player.position)
      if (!surface || next.player.position.y < surface.floorY - 1e-6) {
        return reject(intents, 0, 'terrain_missing', 'The streamed player has no valid floor.')
      }
      if (next.player.verticalVelocity === 0 && Math.abs(next.player.position.y - surface.floorY) <= 1e-6
        && !validatePublicV14State(next, next.seed)) {
        return reject(intents, 0, 'terrain_missing', 'The streamed pose failed v14 proof.')
      }
      const changedChunk = chunkKey(old.player.position) !== chunkKey(next.player.position)
      const nextStream = changedChunk ? createPublicV14StreamTerrain(next) : authority
      state = next
      stream = nextStream
      return { events: [...events, ...sale.events], rejections: [] }
    } catch {
      // The lower-level runtime may have advanced before post-checking failed.
      stream = createPublicV14StreamTerrain(old)
      return reject(intents, 0, 'terrain_missing', 'The streamed frame failed atomically.')
    } finally {
      if (state === old && stream?.state.tick !== old.tick) {
        stream = createPublicV14StreamTerrain(old)
      }
    }
  }

  return {
    view() {
      const activeTiles = state.movementOwner === 'greenway'
        ? state.greenway.tiles : stream?.activeTiles() ?? []
      return { movementOwner: state.movementOwner, tick: state.tick,
        player: structuredClone(state.player), activeKnownTileIds:
          discoveredTileIdsInActiveWindow(state.discoveryMask, state.player.position),
        activeTiles: structuredClone(activeTiles), pendingBoundary: boundaryTransitions > 0 }
    },
    advanceFrame(intents, options) {
      if (!Array.isArray(intents) || typeof options?.walkRequested !== 'boolean'
        || intents.length > 2 || intents.length === 2
          && (intents[0]?.type !== 'look' || intents[1]?.type !== 'move')) {
        return reject(intents, 0, 'invalid_frame', 'A frame accepts one action or a look followed by a move.')
      }
      const unsupported = intents.findIndex((intent) => !intent
        || !['look', 'move', 'jump'].includes(intent.type))
      if (unsupported >= 0) return reject(intents, unsupported, 'unavailable_here',
        'This session owns movement only; work actions require a checked writer.')
      const last = intents[intents.length - 1]
      if (last?.type === 'move') {
        const x = state.player.position.x + last.delta?.x
        const z = state.player.position.z + last.delta?.z
        if (Number.isFinite(x) && Number.isFinite(z)
          && publicV14InsideGreenway({ x, z }) !== publicV14InsideGreenway(state.player.position)) {
          const crossing = advancePublicV14BoundaryFrame(state, intents, options, policy)
          if (!crossing.candidate) return { events: [], rejections: crossing.rejections }
          try {
            const receiving = crossing.candidate.movementOwner === 'streamed'
              ? createPublicV14StreamTerrain(crossing.candidate) : null
            state = crossing.candidate
            stream = receiving
            boundaryTransitions++
            return { events: crossing.events, rejections: [] }
          } catch { return reject(intents, intents.length - 1, 'terrain_missing',
            'The receiving owner could not activate its bounded terrain.') }
        }
      }
      if (state.movementOwner === 'greenway') {
        const frame = advancePublicV14GreenwayFrame(state, intents, options)
        if (!frame.rejections.length) state = frame.state
        return { events: frame.events, rejections: frame.rejections }
      }
      return advanceStream(intents, options)
    },
    previewSnapshot: () => structuredClone(state),
    snapshotForSave() {
      const position = state.player.position
      const floor = state.movementOwner === 'greenway'
        ? starterCliffSupportAt({ seed: state.seed, profile: state.generationProfile,
          route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
          built: state.greenway.builtRouteIds.includes('greenway_ladder') }, position)?.floorY
        : resolvePublicV14Surface(state, position)?.floorY
      if (floor === undefined || position.y < floor - 1e-6) {
        throw new RangeError('The v14 player has no valid support.')
      }
      if (state.player.verticalVelocity !== 0 || position.y > floor + 1e-6) {
        return { status: 'deferred-airborne', pendingBoundary: boundaryTransitions > 0 }
      }
      const checked = validatePublicV14State(state, state.seed)
      if (!checked) throw new RangeError('The v14 grounded state failed proof.')
      return boundaryTransitions > 0
        ? { status: 'needs-checked-commit', state: checked, boundaryTransitions }
        : { status: 'ready', state: checked }
    },
  }
}
