import { createActiveWorldTerrain } from './activeWorldTerrain'
import type { ActiveWorldTerrain, ReadonlyWorldTile } from './activeWorldTerrain'
import { mireglassMoveBarrier } from './mireglassMovementGate'
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
  code: 'invalid_value' | 'out_of_bounds' | 'terrain_missing' | 'airborne' | 'fen_channel' | 'slate_cliff'
}

export interface StreamedWorldAdvanceResult {
  state: StreamedWorldState
  events: StreamedWorldEvent[]
  rejections: StreamedWorldRejection[]
}

export interface StreamedWorldRuntime {
  readonly state: StreamedWorldState
  advance(intents: readonly StreamedWorldIntent[]): StreamedWorldAdvanceResult
  tileAtWorld(x: number, z: number): ReadonlyWorldTile | null
  activeTiles(): readonly ReadonlyWorldTile[]
  activeChunkCoordinates(): readonly Readonly<ChunkCoordinate>[]
  activeChunkCount(): number
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
 */
export function createStreamedWorld(seed: string, start: { x: number; z: number } = { x: 0, z: 0 }): StreamedWorldRuntime {
  const normalizedSeed = seed || 'wizard-realms'
  const terrain = createActiveWorldTerrain(normalizedSeed)
  terrain.activate(start)
  const startTile = terrain.tileAtWorld(start.x, start.z)
  if (!startTile) throw new Error('Missing starting terrain.')
  return createRuntime(normalizedSeed, terrain, {
    seed: normalizedSeed, tick: 0,
    player: { position: { x: start.x, y: startTile.center.y, z: start.z }, yaw: 0, pitch: 0, verticalVelocity: 0 },
    discoveredTileIds: [startTile.id],
  })
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
export function createStreamedWorldFromState(snapshot: StreamedWorldState): StreamedWorldRuntime {
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

  const terrain = createActiveWorldTerrain(snapshot.seed)
  terrain.activate(position)
  const ground = terrain.tileAtWorld(position.x, position.z)
  if (!ground || position.y < ground.center.y) throw new RangeError('Invalid streamed-world snapshot position.')
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
  })
}

function createRuntime(normalizedSeed: string, terrain: ActiveWorldTerrain, initialState: StreamedWorldState): StreamedWorldRuntime {
  let state = freezeState(initialState)
  const discovered = new Set(state.discoveredTileIds)
  return {
    get state() { return state },
    advance(intents) {
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
          if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) > 4) {
            reject(index, intent, 'invalid_value')
            return
          }
          const x = player.position.x + dx
          const z = player.position.z + dz
          const barrier = mireglassMoveBarrier(normalizedSeed, player.position, { x, z })
          if (barrier) {
            reject(index, intent, barrier)
            return
          }
          try { terrain.activate({ x, z }) } catch (error) {
            if (!(error instanceof RangeError)) throw error
            reject(index, intent, 'out_of_bounds')
            return
          }
          const tile = terrain.tileAtWorld(x, z)
          if (!tile) {
            terrain.activate(player.position)
            reject(index, intent, 'terrain_missing')
            return
          }
          player.position = { x, y: Math.max(player.position.y, tile.center.y), z }
          if (player.position.y === tile.center.y) player.verticalVelocity = 0
          events.push({ type: 'player_moved', tick, position: { ...player.position } })
          if (!discovered.has(tile.id) && !pendingDiscovery?.has(tile.id)) {
            const nextDiscoveredTileIds = [...discoveredTileIds]
            let low = 0
            let high = nextDiscoveredTileIds.length
            while (low < high) {
              const middle = (low + high) >>> 1
              if (nextDiscoveredTileIds[middle] < tile.id) low = middle + 1
              else high = middle
            }
            nextDiscoveredTileIds.splice(low, 0, tile.id)
            discoveredTileIds = nextDiscoveredTileIds
            if (!pendingDiscovery) pendingDiscovery = new Set()
            pendingDiscovery.add(tile.id)
            events.push({ type: 'tile_discovered', tick, tileId: tile.id })
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
        const ground = terrain.tileAtWorld(player.position.x, player.position.z)
        if (!ground) { reject(index, intent, 'terrain_missing'); return }
        if (Math.abs(player.position.y - ground.center.y) > 0.001 || player.verticalVelocity !== 0) {
          reject(index, intent, 'airborne')
          return
        }
        player.verticalVelocity = JUMP_SPEED
        events.push({ type: 'player_jumped', tick })
      })

      const ground = terrain.tileAtWorld(player.position.x, player.position.z)
      if (!ground) throw new Error('Active terrain missing under player.')
      if (player.position.y > ground.center.y || player.verticalVelocity > 0) {
        player.position.y += player.verticalVelocity * STEP_SECONDS
        player.verticalVelocity = Math.max(-MAX_ABS_VERTICAL_VELOCITY, player.verticalVelocity - GRAVITY * STEP_SECONDS)
        if (player.position.y <= ground.center.y) {
          player.position.y = ground.center.y
          player.verticalVelocity = 0
        }
      } else {
        player.position.y = ground.center.y
        player.verticalVelocity = 0
      }
      state = freezeState({ seed: normalizedSeed, tick, player, discoveredTileIds })
      if (pendingDiscovery) for (const id of pendingDiscovery) discovered.add(id)
      return { state, events, rejections }
    },
    tileAtWorld: (x, z) => terrain.tileAtWorld(x, z),
    activeTiles: () => terrain.activeTiles(),
    activeChunkCoordinates: () => terrain.activeChunkCoordinates,
    activeChunkCount: () => terrain.activeChunkCount,
  }
}
