import { createActiveWorldTerrain } from './activeWorldTerrain'
import type { ReadonlyWorldTile } from './activeWorldTerrain'
import type { Vec3 } from './types'
import type { ChunkCoordinate } from './worldChunks'

const STEP_SECONDS = 0.05
const GRAVITY = 9.8
const JUMP_SPEED = 5

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
  code: 'invalid_value' | 'out_of_bounds' | 'terrain_missing' | 'airborne'
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
  let state = freezeState({
    seed: normalizedSeed, tick: 0,
    player: { position: { x: start.x, y: startTile.center.y, z: start.z }, yaw: 0, pitch: 0, verticalVelocity: 0 },
    discoveredTileIds: [startTile.id],
  })

  return {
    get state() { return state },
    advance(intents) {
      const tick = state.tick + 1
      const player = { ...state.player, position: { ...state.player.position } }
      const discoveredTileIds = [...state.discoveredTileIds]
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
          if (!discoveredTileIds.includes(tile.id)) {
            discoveredTileIds.push(tile.id)
            discoveredTileIds.sort()
            events.push({ type: 'tile_discovered', tick, tileId: tile.id })
          }
          return
        }
        if (intent.type === 'look') {
          if (!Number.isFinite(intent.yawDelta) || !Number.isFinite(intent.pitchDelta)
            || !Number.isFinite(player.yaw + intent.yawDelta)) {
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
        player.verticalVelocity -= GRAVITY * STEP_SECONDS
        if (player.position.y <= ground.center.y) {
          player.position.y = ground.center.y
          player.verticalVelocity = 0
        }
      } else {
        player.position.y = ground.center.y
        player.verticalVelocity = 0
      }
      state = freezeState({ seed: normalizedSeed, tick, player, discoveredTileIds })
      return { state, events, rejections }
    },
    tileAtWorld: (x, z) => terrain.tileAtWorld(x, z),
    activeTiles: () => terrain.activeTiles(),
    activeChunkCoordinates: () => terrain.activeChunkCoordinates,
    activeChunkCount: () => terrain.activeChunkCount,
  }
}
