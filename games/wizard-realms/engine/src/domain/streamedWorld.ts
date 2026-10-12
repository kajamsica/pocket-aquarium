import { createActiveWorldTerrain } from './activeWorldTerrain'
import type { ActiveWorldTerrain, ReadonlyWorldTile } from './activeWorldTerrain'
import { highlandRidgeMoveBarrier } from './highlandRidge'
import type { TerrainFacts } from './mireglassCachePitOverlay'
import type { PublicV11RouteSupport } from './publicV11RouteSupport'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import type { Vec3 } from './types'
import { WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'
import type { ChunkCoordinate } from './worldChunks'

const STEP_SECONDS = 0.05
const GRAVITY = 9.8
const JUMP_SPEED = 5
const MAX_ABS_YAW = 1e6
const MAX_ABS_VERTICAL_VELOCITY = 50

export interface StreamedWorldState {
  readonly seed: string
  readonly tick: number
  readonly player: {
    readonly position: Readonly<Vec3>
    readonly yaw: number
    readonly pitch: number
    readonly verticalVelocity: number
  }
  readonly discoveredTileIds: readonly string[]
}

export type StreamedWorldIntent =
  | { type: 'move'; delta: { x: number; z: number } }
  | { type: 'look'; yawDelta: number; pitchDelta: number }
  | { type: 'jump' }

export type StreamedWorldEvent =
  | { type: 'player_moved'; tick: number; position: Vec3 }
  | { type: 'player_looked'; tick: number; yaw: number; pitch: number }
  | { type: 'player_jumped'; tick: number }
  | { type: 'tile_discovered'; tick: number; tileId: string }

export interface StreamedWorldRejection {
  intentIndex: number
  intentType: StreamedWorldIntent['type']
  code: 'invalid_value' | 'out_of_bounds' | 'terrain_missing' | 'airborne' | 'fen_channel' | 'slate_cliff' | 'ridge_rock'
}

export interface StreamedWorldAdvanceResult {
  state: StreamedWorldState
  events: StreamedWorldEvent[]
  rejections: StreamedWorldRejection[]
}

export interface StreamedWorldRuntime {
  readonly state: StreamedWorldState
  advance(intents: readonly StreamedWorldIntent[], options?: {
    atomicOnRejection?: boolean
    nearbyDiscovery?: boolean
  }): StreamedWorldAdvanceResult
  tileAtWorld(x: number, z: number): ReadonlyWorldTile | null
  activeTiles(): readonly ReadonlyWorldTile[]
  activeChunkCoordinates(): readonly Readonly<ChunkCoordinate>[]
  activeChunkCount(): number
}

/** Explicit unsaved-trial seam. Omitted for every public and ordinary streamed runtime. */
export interface StreamedWorldTrialHooks {
  barrier(from: Readonly<Vec3>, to: { x: number; z: number },
    authored: 'fen_channel' | 'slate_cliff' | null): 'fen_channel' | 'slate_cliff' | null
  tile(base: ReadonlyWorldTile): ReadonlyWorldTile
  activeTiles(base: readonly ReadonlyWorldTile[]): readonly ReadonlyWorldTile[]
  groundY(position: { x: number; z: number }, tile: ReadonlyWorldTile): number
  supportsStep?(from: Readonly<Vec3>, to: { x: number; z: number }): boolean
}

function freezeState(state: StreamedWorldState): StreamedWorldState {
  Object.freeze(state.player.position)
  Object.freeze(state.player)
  Object.freeze(state.discoveredTileIds)
  return Object.freeze(state)
}

/**
 * Separate streamed authority. Its terrain cache never enters the serializable state.
 * An optional start is validated through active terrain; a non-finite or out-of-world start throws a RangeError.
 * The final opt-in reveals a bounded walking neighborhood only for unsaved previews.
 */
export function createStreamedWorld(seed: string, start: { x: number; z: number } = { x: 0, z: 0 },
  facts?: TerrainFacts, trialHooks?: StreamedWorldTrialHooks,
  initialNearbyDiscovery = false): StreamedWorldRuntime {
  const normalizedSeed = seed || 'wizard-realms'
  const terrain = createActiveWorldTerrain(normalizedSeed, facts)
  terrain.activate(start)
  const startTile = terrain.tileAtWorld(start.x, start.z)
  if (!startTile) throw new Error('Missing starting terrain.')
  return createRuntime(normalizedSeed, terrain, {
    seed: normalizedSeed, tick: 0,
    player: { position: { x: start.x, y: startTile.center.y, z: start.z }, yaw: 0, pitch: 0, verticalVelocity: 0 },
    discoveredTileIds: initialNearbyDiscovery
      ? nearbyWorldTileIds(start, PUBLIC_WALK_REVEAL_RADIUS_METERS) : [startTile.id],
  }, facts?.highlandRidge === true, trialHooks, facts?.routeSupport)
}

function canonicalWorldTileId(id: unknown): boolean {
  if (typeof id !== 'string') return false
  const match = /^tile-(-?\d+)-(-?\d+)$/.exec(id)
  if (!match) return false
  const idX = Number(match[1])
  const idZ = Number(match[2])
  return Number.isSafeInteger(idX) && Number.isSafeInteger(idZ)
    && id === `tile-${idX}-${idZ}`
    && idX - 3 >= WORLD_GRID_MIN && idX - 3 <= WORLD_GRID_MAX
    && idZ - 3 >= WORLD_GRID_MIN && idZ - 3 <= WORLD_GRID_MAX
}

/** Rebuilds active terrain and authority from a validated serialized snapshot. */
export function createStreamedWorldFromState(snapshot: StreamedWorldState, facts?: TerrainFacts,
  trialHooks?: StreamedWorldTrialHooks): StreamedWorldRuntime {
  const player = snapshot?.player
  const position = player?.position
  const discovered = snapshot?.discoveredTileIds
  if (typeof snapshot?.seed !== 'string' || snapshot.seed.length === 0
    || !Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0
    || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)
    || !Number.isFinite(player.yaw) || Math.abs(player.yaw) > MAX_ABS_YAW
    || !Number.isFinite(player.pitch) || Math.abs(player.pitch) > Math.PI / 2
    || !Number.isFinite(player.verticalVelocity) || Math.abs(player.verticalVelocity) > MAX_ABS_VERTICAL_VELOCITY
    || !Array.isArray(discovered)) throw new RangeError('Invalid streamed-world snapshot.')

  const terrain = createActiveWorldTerrain(snapshot.seed, facts)
  terrain.activate(position)
  const ground = terrain.tileAtWorld(position.x, position.z)
  const effective = ground && trialHooks ? trialHooks.tile(ground) : ground
  const baseFloor = effective && trialHooks
    ? trialHooks.groundY(position, effective) : effective?.center.y
  if (!ground || baseFloor === undefined
    || position.y < (facts?.routeSupport?.floorY(position, baseFloor) ?? baseFloor)) {
    throw new RangeError('Invalid streamed-world snapshot position.')
  }
  let previousId = ''
  for (const id of discovered) {
    if (!canonicalWorldTileId(id) || (previousId && id <= previousId)) {
      throw new RangeError('Invalid streamed-world snapshot discovery.')
    }
    previousId = id
  }
  if (!discovered.includes(ground.id)) throw new RangeError('Snapshot discovery omits the current tile.')

  return createRuntime(snapshot.seed, terrain, {
    seed: snapshot.seed,
    tick: snapshot.tick,
    player: {
      position: { x: position.x, y: position.y, z: position.z },
      yaw: player.yaw, pitch: player.pitch, verticalVelocity: player.verticalVelocity,
    },
    discoveredTileIds: [...discovered],
  }, facts?.highlandRidge === true, trialHooks, facts?.routeSupport)
}

function createRuntime(normalizedSeed: string, terrain: ActiveWorldTerrain, initialState: StreamedWorldState,
  highlandRidge: boolean, trialHooks?: StreamedWorldTrialHooks,
  routeSupport?: PublicV11RouteSupport): StreamedWorldRuntime {
  let state = freezeState(initialState)
  const discovered = new Set(state.discoveredTileIds)
  const tileAtWorld = (x: number, z: number) => {
    const base = terrain.tileAtWorld(x, z)
    return base && trialHooks ? trialHooks.tile(base) : base
  }
  const groundY = (position: { x: number; z: number }, tile: ReadonlyWorldTile) => {
    const base = trialHooks ? trialHooks.groundY(position, tile) : tile.center.y
    return routeSupport?.floorY(position, base) ?? base
  }
  return {
    get state() { return state },
    advance(intents, options) {
      const tick = state.tick + 1
      if (!Number.isSafeInteger(tick)) throw new RangeError('Streamed-world tick overflow.')
      const player = { ...state.player, position: { ...state.player.position } }
      let discoveredTileIds = state.discoveredTileIds
      let pendingDiscovery: Set<string> | undefined
      const events: StreamedWorldEvent[] = []
      const rejections: StreamedWorldRejection[] = []
      const reject = (index: number, intent: StreamedWorldIntent, code: StreamedWorldRejection['code']) =>
        rejections.push({ intentIndex: index, intentType: intent.type, code })

      intents.forEach((intent, index) => {
        if (intent.type === 'move') {
          const { x: dx, z: dz } = intent.delta
          if (!Number.isFinite(dx) || !Number.isFinite(dz)
            || Math.hypot(dx, dz) > (trialHooks ? 0.24 + 1e-9 : 4)) {
            reject(index, intent, 'invalid_value')
            return
          }
          const x = player.position.x + dx
          const z = player.position.z + dz
          const authoredBarrier = mireglassMoveBarrier(normalizedSeed, player.position, { x, z })
          const attemptedBarrier = trialHooks
            ? trialHooks.barrier(player.position, { x, z }, authoredBarrier) : authoredBarrier
          const mireglassBarrier = attemptedBarrier
            && routeSupport?.clearsMireglassBarrier(player.position, { x, z }, attemptedBarrier)
            ? null : attemptedBarrier
          const barrier = mireglassBarrier
            ?? (highlandRidge ? highlandRidgeMoveBarrier(player.position, { x, z }) : null)
          if (barrier) {
            reject(index, intent, barrier)
            return
          }
          try { terrain.activate({ x, z }) } catch (error) {
            if (!(error instanceof RangeError)) throw error
            reject(index, intent, 'out_of_bounds')
            return
          }
          const tile = tileAtWorld(x, z)
          if (!tile) {
            terrain.activate(player.position)
            reject(index, intent, 'terrain_missing')
            return
          }
          const moved = x !== player.position.x || z !== player.position.z
          const floorY = groundY({ x, z }, tile)
          const priorTile = tileAtWorld(player.position.x, player.position.z)
          const priorFloor = priorTile && groundY(player.position, priorTile)
          const onBuiltSupport = routeSupport?.crossing(player.position, { x, z })
          const groundedOnSupport = ((onBuiltSupport
            && (onBuiltSupport.kind === 'fen_bridge' || onBuiltSupport.kind === 'slate_ladder'))
            || trialHooks?.supportsStep?.(player.position, { x, z }))
            && priorFloor !== null && priorFloor !== undefined
            && Math.abs(player.position.y - priorFloor) <= 0.001 && player.verticalVelocity <= 0
          player.position = { x, y: groundedOnSupport ? floorY : Math.max(player.position.y, floorY), z }
          if (player.position.y === floorY) player.verticalVelocity = 0
          events.push({ type: 'player_moved', tick, position: { ...player.position } })
          const revealedIds = options?.nearbyDiscovery && moved
            ? nearbyWorldTileIds(player.position, PUBLIC_WALK_REVEAL_RADIUS_METERS) : [tile.id]
          for (const tileId of revealedIds) {
            if (discovered.has(tileId) || pendingDiscovery?.has(tileId)) continue
            const nextDiscoveredTileIds = [...discoveredTileIds]
            let low = 0
            let high = nextDiscoveredTileIds.length
            while (low < high) {
              const middle = (low + high) >>> 1
              if (nextDiscoveredTileIds[middle] < tileId) low = middle + 1
              else high = middle
            }
            nextDiscoveredTileIds.splice(low, 0, tileId)
            discoveredTileIds = nextDiscoveredTileIds
            if (!pendingDiscovery) pendingDiscovery = new Set()
            pendingDiscovery.add(tileId)
            events.push({ type: 'tile_discovered', tick, tileId })
          }
          return
        }
        if (intent.type === 'look') {
          if (!Number.isFinite(intent.yawDelta) || !Number.isFinite(intent.pitchDelta)
            || !Number.isFinite(player.yaw + intent.yawDelta)
            || Math.abs(player.yaw + intent.yawDelta) > MAX_ABS_YAW) {
            reject(index, intent, 'invalid_value')
            return
          }
          player.yaw += intent.yawDelta
          player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.pitch + intent.pitchDelta))
          events.push({ type: 'player_looked', tick, yaw: player.yaw, pitch: player.pitch })
          return
        }
        const ground = tileAtWorld(player.position.x, player.position.z)
        if (!ground) { reject(index, intent, 'terrain_missing'); return }
        if (Math.abs(player.position.y - groundY(player.position, ground)) > 0.001 || player.verticalVelocity !== 0) {
          reject(index, intent, 'airborne')
          return
        }
        player.verticalVelocity = JUMP_SPEED
        events.push({ type: 'player_jumped', tick })
      })

      if (options?.atomicOnRejection && rejections.length) {
        terrain.activate(state.player.position)
        return { state, events: [], rejections }
      }

      const ground = tileAtWorld(player.position.x, player.position.z)
      if (!ground) throw new Error('Active terrain missing under player.')
      const floorY = groundY(player.position, ground)
      if (player.position.y > floorY || player.verticalVelocity > 0) {
        player.position.y += player.verticalVelocity * STEP_SECONDS
        player.verticalVelocity = Math.max(-MAX_ABS_VERTICAL_VELOCITY, player.verticalVelocity - GRAVITY * STEP_SECONDS)
        if (player.position.y <= floorY) {
          player.position.y = floorY
          player.verticalVelocity = 0
        }
      } else {
        player.position.y = floorY
        player.verticalVelocity = 0
      }
      state = freezeState({ seed: normalizedSeed, tick, player, discoveredTileIds })
      if (pendingDiscovery) for (const id of pendingDiscovery) discovered.add(id)
      return { state, events, rejections }
    },
    tileAtWorld,
    activeTiles: () => trialHooks ? trialHooks.activeTiles(terrain.activeTiles()) : terrain.activeTiles(),
    activeChunkCoordinates: () => terrain.activeChunkCoordinates,
    activeChunkCount: () => terrain.activeChunkCount,
  }
}
