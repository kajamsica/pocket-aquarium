import { MIREGLASS_CORE, MIREGLASS_FEN_BACK, mireglassFenDepthAt, mireglassPlateauAt } from './mireglassTerrain'
import { WORLD_CELL_METERS } from './worldChunks'

type GroundPosition = { x: number; z: number }
type MireglassMoveBarrier = 'fen_channel' | 'slate_cliff' | null

// Match ActiveWorldTerrain.tileAtWorld: an exact half-cell tie belongs to the lower center.
const gridAtWorld = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)

/** Classifies the complete swept path of one ordinary move against authored Mireglass cells. */
export function mireglassMoveBarrier(seed: string, from: GroundPosition, to: GroundPosition): MireglassMoveBarrier {
  if (![from.x, from.z, to.x, to.z].every(Number.isFinite)) return 'fen_channel'
  const dx = to.x - from.x
  const dz = to.z - from.z
  // The caller validates move length; this cap also keeps the sweep bounded for direct callers.
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || dx * dx + dz * dz > WORLD_CELL_METERS ** 2) return 'fen_channel'
  if (Math.max(from.x, to.x) < MIREGLASS_CORE.minX - 2
    || Math.min(from.x, to.x) > MIREGLASS_CORE.maxX + 2
    || Math.max(from.z, to.z) < MIREGLASS_CORE.minZ - 2
    || Math.min(from.z, to.z) > MIREGLASS_FEN_BACK + 10) return null

  const fromGX = gridAtWorld(from.x)
  const fromGZ = gridAtWorld(from.z)
  const toGX = gridAtWorld(to.x)
  const toGZ = gridAtWorld(to.z)
  const minGX = Math.min(fromGX, toGX) - 1
  const maxGX = Math.max(fromGX, toGX) + 1
  const minGZ = Math.min(fromGZ, toGZ) - 1
  const maxGZ = Math.max(fromGZ, toGZ) + 1
  let fen = false
  let plateau = false
  let lowerGround = false
  const visit = (gx: number, gz: number) => {
    const x = gx * WORLD_CELL_METERS
    const z = gz * WORLD_CELL_METERS
    if (mireglassFenDepthAt(seed, x, z) !== null) fen = true
    if (mireglassPlateauAt(seed, x, z) !== null) plateau = true
    else lowerGround = true
  }

  // A cell is traversed if its open interior contains a positive-length part of the
  // segment. For a path on a grid edge, the constant axis uses the lower-cell tie.
  for (let gx = minGX; gx <= maxGX; gx += 1) {
    if (dx === 0 && gx !== fromGX) continue
    const left = gx * WORLD_CELL_METERS - WORLD_CELL_METERS / 2
    const right = left + WORLD_CELL_METERS
    const xEnter = dx === 0 ? -Infinity : Math.min((left - from.x) / dx, (right - from.x) / dx)
    const xExit = dx === 0 ? Infinity : Math.max((left - from.x) / dx, (right - from.x) / dx)
    for (let gz = minGZ; gz <= maxGZ; gz += 1) {
      if (dz === 0 && gz !== fromGZ) continue
      const bottom = gz * WORLD_CELL_METERS - WORLD_CELL_METERS / 2
      const top = bottom + WORLD_CELL_METERS
      const zEnter = dz === 0 ? -Infinity : Math.min((bottom - from.z) / dz, (top - from.z) / dz)
      const zExit = dz === 0 ? Infinity : Math.max((bottom - from.z) / dz, (top - from.z) / dz)
      if (Math.max(0, xEnter, zEnter) < Math.min(1, xExit, zExit)) visit(gx, gz)
    }
  }

  // Endpoints obey tileAtWorld's exact tie. At an interior diagonal corner, include
  // both side cells so a zero-width passage between obstacles cannot be cut.
  visit(fromGX, fromGZ)
  visit(toGX, toGZ)
  if (dx !== 0 && dz !== 0) {
    for (let gx = minGX; gx < maxGX; gx += 1) {
      const tx = (gx * WORLD_CELL_METERS + WORLD_CELL_METERS / 2 - from.x) / dx
      if (tx <= 0 || tx >= 1) continue
      for (let gz = minGZ; gz < maxGZ; gz += 1) {
        const tz = (gz * WORLD_CELL_METERS + WORLD_CELL_METERS / 2 - from.z) / dz
        if (tx !== tz) continue
        visit(gx, gz)
        visit(gx + 1, gz)
        visit(gx, gz + 1)
        visit(gx + 1, gz + 1)
      }
    }
  }

  if (fen) return 'fen_channel'
  if (plateau && lowerGround) return 'slate_cliff'
  return null
}
