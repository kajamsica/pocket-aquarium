import { hashSeed } from './generation'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

export const PUBLIC_V25_RIVER_PROFILE = 'connected-river/v1' as const

const validGrid = (value: number) => Number.isSafeInteger(value)
  && value >= WORLD_GRID_MIN && value <= WORLD_GRID_MAX

function validSeedAndGrid(seed: string, gx: number): void {
  if (typeof seed !== 'string' || seed.length === 0 || seed.length > 128 || !validGrid(gx)) {
    throw new RangeError('V25 river requires a nonempty seed of at most 128 characters and in-range integer grid coordinates.')
  }
}

/** One seeded center row per column, anchored to the existing starter crossing. */
export function publicV25RiverCenterZ(seed: string, gx: number): number {
  validSeedAndGrid(seed, gx)
  const offset = gx < -2 ? gx + 2 : gx > 2 ? gx - 2 : 0
  const phase = (hashSeed(seed) / 4294967296) * Math.PI * 2
  // The maximum change between neighboring columns is 4/42 of a row before
  // rounding, so centers can bend by at most one cell at a time.
  return 2 + Math.round(4 * (Math.sin(offset * WORLD_CELL_METERS / 168 + phase) - Math.sin(phase)))
}

/** Canonical wet-cell predicate for both future V25 simulation and rendering. */
export function publicV25RiverCellAtGrid(seed: string, gx: number, gz: number): boolean {
  validSeedAndGrid(seed, gx)
  if (!validGrid(gz)) throw new RangeError('V25 river grid coordinates must be integers from -256 through 255.')
  const center = publicV25RiverCenterZ(seed, gx)
  return gz === center || (gx > WORLD_GRID_MIN && gz === publicV25RiverCenterZ(seed, gx - 1))
}
