import { PUBLIC_RUN_STEP_METERS } from './publicWorldGait'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import type { PublicV24Progress } from './publicWorldV24Snapshot'
import { publicV25RiverPassage } from './publicWorldV25Passage'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { projectPublicV26Pose } from './publicWorldV26Pose'
import { decodePublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import type { PublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { projectPublicV28Pose, publicV28ResolvedRiverBridges,
  publicV28RiverBridgeFloorAt } from './publicWorldV28RiverSupport'
import type { Vec3 } from './types'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN, worldTileAtGrid } from './worldChunks'

type Passage = { ok: true } | { ok: false; reason: 'river-needs-bridge' | 'invalid-segment' }
type WetContact = Readonly<{ tileId: string; point: Vec3; carrierProbe: Vec3 }>
const EPSILON = 1e-6
const GROUND_TOLERANCE = 0.03
const MAX_SAVED_BANK_GRADE = 0.55
const cell = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
const inWorld = (gx: number, gz: number) => gx >= WORLD_GRID_MIN && gx <= WORLD_GRID_MAX
  && gz >= WORLD_GRID_MIN && gz <= WORLD_GRID_MAX

/** Match V25's endpoint, interval and diagonal-corner supercover, retaining each wet contact. */
function wetContacts(seed: string, from: Vec3, to: Vec3): readonly WetContact[] | null {
  const start = { gx: cell(from.x), gz: cell(from.z) }
  const end = { gx: cell(to.x), gz: cell(to.z) }
  if (!inWorld(start.gx, start.gz) || !inWorld(end.gx, end.gz)) return null
  const point = (t: number): Vec3 => ({ x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t })
  const contacts: WetContact[] = []
  const add = (gx: number, gz: number, t: number, probeT = t): boolean => {
    if (!inWorld(gx, gz)) return false
    if (publicV25RiverCellAtGrid(seed, gx, gz)) {
      contacts.push({ tileId: worldTileAtGrid(seed, gx, gz).id,
        point: point(t), carrierProbe: point(probeT) })
    }
    return true
  }
  if (!add(start.gx, start.gz, 0) || !add(end.gx, end.gz, 1)) return null
  const cuts: { t: number; axis: 'x' | 'z'; lower: number }[] = []
  for (const axis of ['x', 'z'] as const) {
    const first = axis === 'x' ? start.gx : start.gz
    const last = axis === 'x' ? end.gx : end.gz
    if (first === last) continue
    const lower = Math.min(first, last), boundary = (lower + 0.5) * WORLD_CELL_METERS
    const t = (boundary - from[axis]) / (to[axis] - from[axis])
    if (t > 0 && t < 1) cuts.push({ t, axis, lower })
  }
  cuts.sort((a, b) => a.t - b.t)
  let previous = 0
  for (let index = 0; index < cuts.length;) {
    const t = cuts[index].t, middle = point((previous + t) / 2)
    const gx = cell(middle.x), gz = cell(middle.z)
    // Keep the exact contact for deck coverage, but probe the old carrier floor
    // just inside this interval. At a cut, grid tie-breaking can select the
    // adjacent dry tile even though this contact belongs to the wet interval.
    const inward = Math.min(1e-5, (t - previous) / 4)
    if (!add(gx, gz, previous, previous + inward)
      || !add(gx, gz, (previous + t) / 2)
      || !add(gx, gz, t, t - inward)) return null
    let xCut: typeof cuts[number] | null = null, zCut: typeof cuts[number] | null = null
    do {
      if (cuts[index].axis === 'x') xCut = cuts[index]
      else zCut = cuts[index]
      index++
    } while (index < cuts.length && Math.abs(cuts[index].t - t) <= 8 * Number.EPSILON)
    if (xCut && zCut) {
      for (const cornerX of [xCut.lower, xCut.lower + 1]) {
        for (const cornerZ of [zCut.lower, zCut.lower + 1]) {
          if (!add(cornerX, cornerZ, t)) return null
        }
      }
    }
    previous = t
  }
  const middle = point((previous + 1) / 2)
  const gx = cell(middle.x), gz = cell(middle.z)
  const inward = Math.min(1e-5, (1 - previous) / 4)
  return add(gx, gz, previous, previous + inward)
    && add(gx, gz, (previous + 1) / 2)
    && add(gx, gz, 1, 1 - inward) ? contacts : null
}

/** A canonical saved deck alone authorizes the adjacent near-bank/first-wet carrier seam. */
export function publicV28AdjacentBankSeam(progress: PublicV24Progress,
  terrain: PublicV26TerrainLedger, riverBridgeIds: readonly string[],
  from: Vec3, to: Vec3): { direction: 'outward' | 'return'; wetTileId: string } | null {
  try {
    const player = progress.state.player, position = player.position
    const length = Math.hypot(to.x - from.x, to.z - from.z)
    if (progress.state.movementOwner !== 'streamed' || player.verticalVelocity !== 0
      || ![from.x, from.y, from.z, to.x, to.y, to.z].every(Number.isFinite)
      || from.x !== position.x || from.y !== position.y || from.z !== position.z
      || !(length > 0) || length > PUBLIC_RUN_STEP_METERS + EPSILON || to.z === from.z)
      return null
    const checkedTerrain = decodePublicV26TerrainLedger(terrain)
    const sites = publicV28ResolvedRiverBridges(progress.state.seed, riverBridgeIds)
    const source = resolvePublicV23Surface(progress.state, from, progress.regionalWorks.builtLadderIds)
    const target = resolvePublicV23Surface(progress.state, to, progress.regionalWorks.builtLadderIds)
    const contacts = wetContacts(progress.state.seed, from, to)
    if (!checkedTerrain || !sites || !source || !target || !contacts?.length
      || source.support !== 'terrain' || target.support !== 'terrain'
      || Math.abs(from.y - source.floorY) > EPSILON) return null
    const outward = to.z > from.z
    const dry = outward ? source : target, wet = outward ? target : source
    if (dry.floorY - wet.floorY <= EPSILON
      || dry.floorY - wet.floorY > MAX_SAVED_BANK_GRADE
      // V23 carries dry Y into a downward trial, but raises to dry Y on return.
      || Math.abs(to.y - (outward ? from.y : target.floorY)) > EPSILON) return null
    const minGX = Math.min(cell(from.x), cell(to.x)), maxGX = Math.max(cell(from.x), cell(to.x))
    const minGZ = Math.min(cell(from.z), cell(to.z)), maxGZ = Math.max(cell(from.z), cell(to.z))
    if (checkedTerrain.columns.some((column) => column.openDepth > 0
      && column.gx >= minGX && column.gx <= maxGX
      && column.gz >= minGZ && column.gz <= maxGZ)) return null
    const matching = sites.filter((site) => dry.tileId === site.footprintTileIds[1]
      && wet.tileId === site.wetGapTileIds[0]
      && Math.abs(from.x - site.from.x) <= site.widthMeters / 2
      && Math.abs(to.x - site.from.x) <= site.widthMeters / 2
      && contacts.every(({ tileId, point }) => site.wetGapTileIds.includes(tileId)
        && publicV28RiverBridgeFloorAt(site, point) !== null))
    if (matching.length !== 1) return null
    const site = matching[0]
    const start = projectPublicV28Pose(progress, checkedTerrain, riverBridgeIds,
      outward ? from : { ...from, y: wet.floorY })
    const end = projectPublicV28Pose(progress, checkedTerrain, riverBridgeIds,
      outward ? { ...to, y: wet.floorY } : to)
    return start?.bridgeId === site.id && end?.bridgeId === site.id
      && start.support === 'bridge' && end.support === 'bridge'
      ? { direction: outward ? 'outward' : 'return', wetTileId: wet.tileId } : null
  } catch { return null }
}

/** Old supported crossings remain valid; every other wet contact needs saved V28 deck. */
export function publicV28RiverPassage(progress: PublicV24Progress,
  terrain: PublicV26TerrainLedger, riverBridgeIds: readonly string[],
  fromCarrier: Vec3, toCarrier: Vec3): Passage {
  const invalid = { ok: false, reason: 'invalid-segment' } as const
  const blocked = { ok: false, reason: 'river-needs-bridge' } as const
  try {
    if (!fromCarrier || !toCarrier
      || ![fromCarrier.x, fromCarrier.y, fromCarrier.z,
        toCarrier.x, toCarrier.y, toCarrier.z].every(Number.isFinite)
      || Math.hypot(toCarrier.x - fromCarrier.x, toCarrier.z - fromCarrier.z)
        > PUBLIC_RUN_STEP_METERS + EPSILON) return invalid
    const checkedTerrain = decodePublicV26TerrainLedger(terrain)
    const sites = publicV28ResolvedRiverBridges(progress.state.seed, riverBridgeIds)
    if (!checkedTerrain || !sites) return invalid
    const old = publicV25RiverPassage(progress, fromCarrier, toCarrier)
    if (old.ok) return old
    // V23 can yield a transient carrier a few millimetres above its old floor
    // between streamed frames. The V28 check below validates that offset and
    // the complete wet supercover without changing V25's saved replay policy.
    const contacts = wetContacts(progress.state.seed, fromCarrier, toCarrier)
    if (!contacts) return invalid
    if (!contacts.length) return blocked
    const adjacent = publicV28AdjacentBankSeam(progress, checkedTerrain, riverBridgeIds,
      fromCarrier, toCarrier)
    const bankSeamProbe = (contact: WetContact): Vec3 | null => {
      const fromFloor = resolvePublicV23Surface(progress.state, fromCarrier,
        progress.regionalWorks.builtLadderIds)
      const toFloor = resolvePublicV23Surface(progress.state, toCarrier,
        progress.regionalWorks.builtLadderIds)
      if (!fromFloor || !toFloor || fromFloor.support !== 'terrain'
        || toFloor.support !== 'terrain' || progress.state.player.verticalVelocity !== 0
        || Math.abs(fromCarrier.y - fromFloor.floorY) > EPSILON
        || toCarrier.z === fromCarrier.z
        || Math.abs(toCarrier.y - toFloor.floorY) > GROUND_TOLERANCE) return null
      const outward = toCarrier.z > fromCarrier.z
      const site = sites.find((saved) => {
        const bank = outward ? saved.from : saved.to
        const dryTile = outward ? saved.footprintTileIds[1] : saved.footprintTileIds.at(-2)
        const wetTile = outward ? saved.wetGapTileIds[0] : saved.wetGapTileIds.at(-1)
        return fromFloor.tileId === dryTile && toFloor.tileId === wetTile
          && contact.tileId === wetTile
          && Math.abs(fromCarrier.x - bank.x) <= saved.widthMeters / 2
          && Math.abs(toCarrier.x - bank.x) <= saved.widthMeters / 2
          && publicV28RiverBridgeFloorAt(saved, contact.point) !== null
      })
      if (!site || toFloor.floorY - fromFloor.floorY <= EPSILON
        || toFloor.floorY - fromFloor.floorY > GROUND_TOLERANCE) return null
      const minGX = Math.min(cell(fromCarrier.x), cell(toCarrier.x))
      const maxGX = Math.max(cell(fromCarrier.x), cell(toCarrier.x))
      const minGZ = Math.min(cell(fromCarrier.z), cell(toCarrier.z))
      const maxGZ = Math.max(cell(fromCarrier.z), cell(toCarrier.z))
      if (checkedTerrain.columns.some((column) => column.openDepth > 0
        && column.gx >= minGX && column.gx <= maxGX
        && column.gz >= minGZ && column.gz <= maxGZ)) return null
      const wetFloor = resolvePublicV23Surface(progress.state, contact.carrierProbe,
        progress.regionalWorks.builtLadderIds)
      if (!wetFloor || wetFloor.tileId !== contact.tileId
        || wetFloor.floorY - contact.carrierProbe.y <= EPSILON
        || wetFloor.floorY - contact.carrierProbe.y > GROUND_TOLERANCE) return null
      return { ...contact.carrierProbe, y: wetFloor.floorY }
    }
    for (const { tileId, point, carrierProbe } of contacts) {
      const direct = projectPublicV26Pose(progress, checkedTerrain, carrierProbe)
      const seam = direct ? null : bankSeamProbe({ tileId, point, carrierProbe })
      const wetFloor = adjacent && tileId === adjacent.wetTileId
        ? resolvePublicV23Surface(progress.state, carrierProbe,
          progress.regionalWorks.builtLadderIds) : null
      const normalized = wetFloor?.tileId === tileId
        ? projectPublicV26Pose(progress, checkedTerrain,
          { ...carrierProbe, y: wetFloor.floorY }) : null
      const base = direct ?? (seam ? projectPublicV26Pose(progress, checkedTerrain, seam) : null)
        ?? normalized
      if (!base || !adjacent && Math.abs(carrierProbe.y - base.carrier.floorY)
        > GROUND_TOLERANCE) return blocked
      const covered = sites.some((site) => site.wetGapTileIds.includes(tileId)
        && publicV28RiverBridgeFloorAt(site, point) !== null)
      if (!covered) return blocked
    }
    return { ok: true }
  } catch { return invalid }
}
