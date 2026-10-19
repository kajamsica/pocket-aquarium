import { MIREGLASS_CONTENT_REVISION } from './mireglassContent'
import {
  applyMireglassExpeditionAction, createMireglassRegionProgress, createMireglassV6Player,
  isValidMireglassRegionProgress, isValidMireglassV6Player,
} from './mireglassExpedition'
import type {
  MireglassExpeditionAction, MireglassExpeditionEvent, MireglassExpeditionRejection,
  MireglassRegionProgress, MireglassV6Player,
} from './mireglassExpedition'
import { createStreamedWorld, createStreamedWorldFromState } from './streamedWorld'
import type {
  StreamedWorldEvent, StreamedWorldIntent, StreamedWorldRejection, StreamedWorldRuntime,
} from './streamedWorld'
import type { ReadonlyWorldTile } from './activeWorldTerrain'
import type { PlayerState } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'
import type { ChunkCoordinate } from './worldChunks'

export interface MireglassWorldState {
  readonly seed: string
  readonly contentRevision: typeof MIREGLASS_CONTENT_REVISION
  readonly tick: number
  readonly player: MireglassV6Player
  readonly discoveredTileIds: readonly string[]
  readonly expedition: MireglassRegionProgress
}

export interface MireglassWorldAdvanceResult {
  state: MireglassWorldState
  events: StreamedWorldEvent[]
  rejections: StreamedWorldRejection[]
}

export type MireglassWorldActionResult =
  | { state: MireglassWorldState; event: MireglassExpeditionEvent; rejection?: never }
  | { state: MireglassWorldState; rejection: MireglassExpeditionRejection; event?: never }

export interface MireglassWorldRuntime {
  readonly state: MireglassWorldState
  advance(intents: readonly StreamedWorldIntent[]): MireglassWorldAdvanceResult
  act(action: MireglassExpeditionAction): MireglassWorldActionResult
  tileAtWorld(x: number, z: number): ReadonlyWorldTile | null
  activeTiles(): readonly ReadonlyWorldTile[]
  activeChunkCoordinates(): readonly Readonly<ChunkCoordinate>[]
  activeChunkCount(): number
}

function freezeTree(value: unknown, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value) || seen.has(value)) return
  seen.add(value)
  for (const child of Object.values(value)) freezeTree(child, seen)
  Object.freeze(value)
}

function frozenState(state: MireglassWorldState): MireglassWorldState {
  freezeTree(state)
  return state
}

/** One campaign player; streamed terrain and physics stay private to this runtime. */
export function createMireglassWorld(
  seed: string, v5Player?: PlayerState, start?: { x: number; z: number },
): MireglassWorldRuntime {
  if (v5Player && start) throw new RangeError('An imported player keeps its saved position.')
  const player = createMireglassV6Player(seed, v5Player)
  const normalizedSeed = seed || 'wizard-realms'
  let streamed: StreamedWorldRuntime = createStreamedWorld(normalizedSeed, start ?? player.position)
  if (v5Player) {
    streamed = createStreamedWorldFromState({
      seed: normalizedSeed, tick: 0,
      player: {
        position: player.position, yaw: player.yaw, pitch: player.pitch,
        verticalVelocity: player.verticalVelocity,
      },
      discoveredTileIds: streamed.state.discoveredTileIds,
    })
  } else {
    player.position = { ...streamed.state.player.position }
  }
  return createRuntime(streamed, {
    seed: normalizedSeed, contentRevision: MIREGLASS_CONTENT_REVISION, tick: 0,
    player, discoveredTileIds: streamed.state.discoveredTileIds,
    expedition: createMireglassRegionProgress(normalizedSeed),
  })
}

/** Restores a complete v6 campaign without modifying the supplied save object. */
export function createMireglassWorldFromState(snapshot: MireglassWorldState): MireglassWorldRuntime {
  let copy: MireglassWorldState
  try { copy = structuredClone(snapshot) } catch { throw new RangeError('Invalid Mireglass world snapshot.') }
  if (!copy || typeof copy.seed !== 'string' || !copy.seed
    || copy.contentRevision !== MIREGLASS_CONTENT_REVISION
    || !Number.isSafeInteger(copy.tick) || copy.tick < 0
    || !isValidMireglassV6Player(copy.player)
    || !isValidMireglassRegionProgress(copy.expedition, copy.seed)) {
    throw new RangeError('Invalid Mireglass world snapshot.')
  }
  const streamed = createStreamedWorldFromState({
    seed: copy.seed, tick: copy.tick,
    player: {
      position: copy.player.position, yaw: copy.player.yaw, pitch: copy.player.pitch,
      verticalVelocity: copy.player.verticalVelocity,
    },
    discoveredTileIds: copy.discoveredTileIds,
  })
  return createRuntime(streamed, {
    seed: copy.seed, contentRevision: MIREGLASS_CONTENT_REVISION, tick: streamed.state.tick,
    player: copy.player, discoveredTileIds: streamed.state.discoveredTileIds,
    expedition: copy.expedition,
  })
}

function createRuntime(streamedStart: StreamedWorldRuntime, initialState: MireglassWorldState): MireglassWorldRuntime {
  let streamed = streamedStart
  let state = frozenState(initialState)
  const normalizedSeed = state.seed
  return {
    get state() { return state },
    advance(intents) {
      const result = streamed.advance(intents)
      state = frozenState({
        ...state, tick: result.state.tick, discoveredTileIds: result.state.discoveredTileIds,
        player: {
          ...state.player, position: { ...result.state.player.position },
          yaw: result.state.player.yaw, pitch: result.state.player.pitch,
          verticalVelocity: result.state.player.verticalVelocity,
        },
      })
      return { state, events: result.events, rejections: result.rejections }
    },
    act(action) {
      const result = applyMireglassExpeditionAction(normalizedSeed, state.player, state.expedition, action,
        state.discoveredTileIds)
      if (result.rejection) return { state, rejection: result.rejection }

      if (result.event.type === 'route_traversed' || result.event.type === 'terrain_revealed'
        || result.event.type === 'cache_revealed') {
        const { position } = result.player
        const revealedTileIds = result.event.type === 'route_traversed'
          ? [worldTileAtGrid(normalizedSeed, position.x / WORLD_CELL_METERS,
            position.z / WORLD_CELL_METERS).id]
          : result.event.revealedTileIds
        const discoveredTileIds = [...new Set([...state.discoveredTileIds, ...revealedTileIds])].sort()
        const destination = createStreamedWorldFromState({
          seed: normalizedSeed, tick: state.tick,
          player: {
            position, yaw: result.player.yaw, pitch: result.player.pitch,
            verticalVelocity: result.player.verticalVelocity,
          },
          discoveredTileIds,
        })
        const nextState = frozenState({ ...state, player: result.player, expedition: result.region,
          discoveredTileIds: destination.state.discoveredTileIds })
        streamed = destination
        state = nextState
      } else {
        state = frozenState({ ...state, player: result.player, expedition: result.region })
      }
      return { state, event: result.event }
    },
    tileAtWorld: (x, z) => streamed.tileAtWorld(x, z),
    activeTiles: () => streamed.activeTiles(),
    activeChunkCoordinates: () => streamed.activeChunkCoordinates(),
    activeChunkCount: () => streamed.activeChunkCount(),
  }
}
