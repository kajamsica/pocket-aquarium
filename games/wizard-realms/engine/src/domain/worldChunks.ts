import { classify, hashSeed, legacyTileAtGrid } from './generation'
import { mireglassTerrainAt } from './mireglassTerrain'
import type { WorldTile } from './types'

export const WORLD_CELL_METERS = 4
export const WORLD_GRID_MIN = -256
export const WORLD_GRID_MAX = 255
export const WORLD_CHUNK_CELLS = 16
export const WORLD_CHUNK_MIN = -16
export const WORLD_CHUNK_MAX = 15

export interface WorldChunk { chunkX: number; chunkZ: number; tiles: WorldTile[] }
export interface ChunkCoordinate { chunkX: number; chunkZ: number }

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / (to - from))
  return t * t * (3 - 2 * t)
}
const sample = (key: string) => hashSeed(key) / 4294967296

function valueNoise(seed: string, field: string, gx: number, gz: number, scale: number): number {
  const x = gx / scale
  const z = gz / scale
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const tx = smoothstep(0, 1, x - ix)
  const tz = smoothstep(0, 1, z - iz)
  const corner = (dx: number, dz: number) => sample(`${seed}:stream:${field}:${ix + dx}:${iz + dz}`)
  const north = corner(0, 0) * (1 - tx) + corner(1, 0) * tx
  const south = corner(0, 1) * (1 - tx) + corner(1, 1) * tx
  return north * (1 - tz) + south * tz
}

function outerClimate(seed: string, gx: number, gz: number) {
  const warpedX = gx + (valueNoise(seed, 'warp-x', gx, gz, 64) - 0.5) * 48
  const warpedZ = gz + (valueNoise(seed, 'warp-z', gx, gz, 64) - 0.5) * 48
  const highland = smoothstep(48, 112, warpedX) * (1 - smoothstep(-112, -48, warpedZ))
  const wetland = (1 - smoothstep(-112, -48, warpedX)) * smoothstep(48, 112, warpedZ)
  const broad = valueNoise(seed, 'climate', gx, gz, 32) - 0.5
  const detail = sample(`${seed}:stream:detail:${gx}:${gz}`) - 0.5
  return {
    elevation: clamp01(0.43 + 0.29 * highland - 0.10 * wetland + 0.12 * broad + 0.04 * detail),
    temperature: clamp01(0.68 - 0.28 * highland + 0.07 * wetland - 0.05 * broad + 0.04 * detail),
    moisture: clamp01(0.53 - 0.30 * highland + 0.28 * wetland + 0.12 * broad + 0.04 * detail),
  }
}

function validGrid(value: number): boolean {
  return Number.isSafeInteger(value) && value >= WORLD_GRID_MIN && value <= WORLD_GRID_MAX
}

export function worldTileAtGrid(seed: string, gx: number, gz: number): WorldTile {
  if (!validGrid(gx) || !validGrid(gz)) throw new RangeError('World grid coordinates must be integers from -256 through 255.')
  const normalizedSeed = seed || 'wizard-realms'
  const legacy = legacyTileAtGrid(normalizedSeed, gx + 3, gz + 3)
  const outside = Math.max(-7 - gx, gx - 8, -7 - gz, gz - 8, 0)
  if (outside === 0) return legacy
  const blend = smoothstep(0, 8, outside)
  const outer = outerClimate(normalizedSeed, gx, gz)
  const climate = mireglassTerrainAt(normalizedSeed, gx * WORLD_CELL_METERS, gz * WORLD_CELL_METERS, {
    elevation: clamp01(legacy.elevation * (1 - blend) + outer.elevation * blend),
    temperature: clamp01(legacy.temperature * (1 - blend) + outer.temperature * blend),
    moisture: clamp01(legacy.moisture * (1 - blend) + outer.moisture * blend),
  })
  const { elevation, temperature, moisture } = climate
  const [biome, terrain] = classify(elevation, temperature, moisture)
  return { ...legacy, elevation, temperature, moisture, biome, terrain,
    center: { ...legacy.center, y: elevation * 3 } }
}

export function worldChunk(seed: string, chunkX: number, chunkZ: number): WorldChunk {
  if (!Number.isSafeInteger(chunkX) || !Number.isSafeInteger(chunkZ)
    || chunkX < WORLD_CHUNK_MIN || chunkX > WORLD_CHUNK_MAX
    || chunkZ < WORLD_CHUNK_MIN || chunkZ > WORLD_CHUNK_MAX) throw new RangeError('World chunk coordinates must be integers from -16 through 15.')
  const tiles: WorldTile[] = []
  for (let localZ = 0; localZ < WORLD_CHUNK_CELLS; localZ += 1) {
    for (let localX = 0; localX < WORLD_CHUNK_CELLS; localX += 1) {
      tiles.push(worldTileAtGrid(seed, chunkX * WORLD_CHUNK_CELLS + localX, chunkZ * WORLD_CHUNK_CELLS + localZ))
    }
  }
  return { chunkX, chunkZ, tiles }
}

export function activeChunkCoordinates(position: { x: number; z: number }, radiusChunks = 1): ChunkCoordinate[] {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) throw new RangeError('World position must be finite.')
  if (!Number.isSafeInteger(radiusChunks) || radiusChunks < 0 || radiusChunks > 1) throw new RangeError('Active chunk radius must be zero or one.')
  const chunkMeters = WORLD_CELL_METERS * WORLD_CHUNK_CELLS
  const chunkX = Math.max(WORLD_CHUNK_MIN, Math.min(WORLD_CHUNK_MAX, Math.floor(position.x / chunkMeters)))
  const chunkZ = Math.max(WORLD_CHUNK_MIN, Math.min(WORLD_CHUNK_MAX, Math.floor(position.z / chunkMeters)))
  const coordinates: ChunkCoordinate[] = []
  for (let z = Math.max(WORLD_CHUNK_MIN, chunkZ - radiusChunks); z <= Math.min(WORLD_CHUNK_MAX, chunkZ + radiusChunks); z += 1) {
    for (let x = Math.max(WORLD_CHUNK_MIN, chunkX - radiusChunks); x <= Math.min(WORLD_CHUNK_MAX, chunkX + radiusChunks); x += 1) {
      coordinates.push({ chunkX: x, chunkZ: z })
    }
  }
  return coordinates
}
