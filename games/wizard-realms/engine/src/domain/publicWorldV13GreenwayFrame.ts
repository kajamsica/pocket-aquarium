import { discoveryMaskHasTileId, encodeDiscoveredTileIds } from './discoveryMask'
import { legacyMovementEnvelope } from './publicWorldV6'
import { preservesPublicV13History } from './publicV13History'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { publicV11Gait } from './publicWorldGait'
import { createPublicV11RouteSupport } from './publicV11RouteSupport'
import type { PublicV13Start } from './publicWorldV13Flow'
import { decodePublicV13Head, decodePublicV13SourceLineage, PUBLIC_V13_SCHEMA } from './publicWorldV13Snapshot'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import type { PublicWorldV11State } from './publicWorldV11State'
import { advancePublicGreenwayOnlyFrame } from './publicWorldRuntime'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './publicWorldRuntime'

export interface PublicV13GreenwaySession {
  view(): Readonly<{ tick: number; player: PublicV13Head['state']['player'];
    knownGreenwayTileIds: readonly string[] }>
  advance(intents: readonly PublicWorldIntent[], options: { walkRequested: boolean }): Readonly<{
    events: readonly PublicWorldEvent[]; rejections: readonly PublicWorldRejection[] }>
  snapshotForSave(): PublicV13Head['state']
  previewSnapshot(): PublicV13Head['state']
}

/** A bounded v11 witness for the authored Greenway, never a decoded world mask. */
export function publicV13GreenwayWitness(state: PublicV13Head['state'], intents: readonly PublicWorldIntent[]): PublicWorldV11State {
  const ids = new Set<string>()
  const keep = (id: string) => { if (discoveryMaskHasTileId(state.discoveryMask, id)) ids.add(id) }
  for (const tile of state.greenway.tiles) keep(tile.id)
  const positions = [state.player.position]
  const move = intents.find((intent) => intent.type === 'move')
  if (move?.type === 'move' && Number.isFinite(move.delta?.x) && Number.isFinite(move.delta?.z)) {
    positions.push({ ...state.player.position,
      x: state.player.position.x + move.delta.x, z: state.player.position.z + move.delta.z })
  }
  for (const intent of intents) {
    if (intent.type === 'teleport_fairy_ring') {
      const target = state.greenway.fairyRings.find((ring) => ring.id === intent.targetRingId)
      if (target) positions.push(target.position)
    } else if (intent.type === 'traverse_route') {
      const route = state.greenway.routes.find((candidate) => candidate.id === intent.routeId)
      if (route) positions.push(route.from, route.to)
    }
  }
  for (const position of positions) {
    for (const id of nearbyWorldTileIds(position, PUBLIC_WALK_REVEAL_RADIUS_METERS)) keep(id)
  }
  const { discoveryMask: _mask, windContentRevision: _revision, windstep: _wind,
    terrainWorks: _works, ...legacy } = state
  return { ...legacy, discoveredTileIds: [...ids].sort() }
}

/** Unmounted Greenway authority. Cross-region travel remains fenced until the hooked seam exists. */
export function createPublicV13GreenwaySession(start: PublicV13Start,
  current?: PublicV13Head['state']): PublicV13GreenwaySession {
  const lineage = decodePublicV13SourceLineage(start?.sourceLineage)
  const head = lineage && decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
    saveRevision: start.saveRevision, bootstrap: start.bootstrap, state: start.state }, lineage)
  if (!head || current === undefined && head.state.movementOwner !== 'greenway') {
    throw new RangeError('Invalid Greenway v13 start.')
  }
  const resumed = current === undefined ? null : decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
    saveRevision: head.saveRevision + 1, bootstrap: head.bootstrap, state: current }, lineage)
  if (current !== undefined && (!Number.isSafeInteger(head.saveRevision + 1)
    || !resumed || resumed.state.movementOwner !== 'greenway'
    || resumed.state.tick <= head.state.tick
    || !preservesPublicV13History(head.state, resumed.state))) {
    throw new RangeError('Invalid Greenway v13 in-memory current state.')
  }
  let state = resumed?.state ?? head.state
  const envelope = legacyMovementEnvelope({ generationProfile: state.generationProfile,
    tiles: state.greenway.tiles })
  const withinGreenway = (position: { x: number; z: number }) =>
    position.x >= envelope.minX && position.x <= envelope.maxX
      && position.z >= envelope.minZ && position.z <= envelope.maxZ

  return {
    view: () => ({ tick: state.tick, player: structuredClone(state.player),
      knownGreenwayTileIds: state.greenway.tiles.map(({ id }) => id)
        .filter((id) => discoveryMaskHasTileId(state.discoveryMask, id)).sort() }),
    advance(intents, options) {
      if (!Array.isArray(intents) || typeof options?.walkRequested !== 'boolean') {
        throw new RangeError('Invalid Greenway frame.')
      }
      if (intents.length > 2 || intents.length === 2
        && (intents[0]?.type !== 'look' || intents[1]?.type !== 'move')) {
        const index = Math.min(1, intents.length - 1)
        const intent = intents[index]
        return { events: [], rejections: [{ intentIndex: index,
          intentType: intent?.type ?? 'move', code: 'invalid_frame',
          message: 'A fixed step accepts at most one look followed by one move.' }] }
      }
      const moveIndex = intents.findIndex((intent) => intent?.type === 'move')
      const move = intents[moveIndex]
      if (move?.type === 'move') {
        const limit = publicV11Gait(state.player.equipment.feet, options.walkRequested).metersPerStep
        const { x, z } = move.delta ?? {}
        if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) > limit + 1e-9) {
          return { events: [], rejections: [{ intentIndex: moveIndex,
            intentType: 'move', code: 'invalid_value',
            message: `Movement exceeds the ${publicV11Gait(state.player.equipment.feet,
              options.walkRequested).pace} step.` }] }
        }
      }
      const legacy = publicV13GreenwayWitness(state, intents)
      const result = advancePublicGreenwayOnlyFrame(legacy, intents,
        createPublicV11RouteSupport(legacy))
      if (result.rejections.length) return { events: [], rejections: result.rejections }
      if (result.state.movementOwner !== 'greenway'
        || !withinGreenway(result.state.player.position)) {
        const index = Math.max(0, intents.findIndex((intent) => intent.type === 'traverse_route'))
        return { events: [], rejections: [{ intentIndex: index,
          intentType: intents[index]?.type ?? 'move', code: 'unavailable_here',
          message: 'Travel beyond Greenway is not yet available.' }] }
      }
      const discoveries = [...new Set(result.events.filter((event) => event.type === 'tile_discovered')
        .map((event) => event.tileId))].sort()
      const mask = discoveries.length ? new Uint8Array(state.discoveryMask) : state.discoveryMask
      if (discoveries.length) {
        const added = encodeDiscoveredTileIds(discoveries)
        for (let index = 0; index < mask.length; index++) mask[index] |= added[index]
      }
      // Greenway's copy-on-write authority retains the v11 fields on its input.
      const { discoveredTileIds: _ids, ...legacyNext } = result.state as PublicWorldV11State
      state = { ...state, ...legacyNext, discoveryMask: mask,
        windstep: state.windstep, terrainWorks: state.terrainWorks }
      return { events: structuredClone(result.events), rejections: [] }
    },
    snapshotForSave() {
      const owned = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
        saveRevision: head.saveRevision + 1, bootstrap: head.bootstrap, state }, lineage)
      if (!owned) throw new RangeError('Invalid Greenway v13 save snapshot.')
      return owned.state
    },
    previewSnapshot: () => structuredClone(state),
  }
}
