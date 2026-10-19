import { resolveTerrainWorkSite } from './terrainWorks'
import type { TerrainWorkSite } from './terrainWorks'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import type { PublicV16GreenwaySite } from './publicWorldV16GreenwaySites'
import type { Vec3 } from './types'
import { mireglassAnchors, mireglassFairyRing, mireglassResources } from './mireglassContent'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import { resolveFieldCampSite } from './fieldCamp'

export type PublicV23Corridor = Readonly<{ center: Readonly<Vec3>;
  normal: Readonly<{ x: number; z: number }>; tangent: Readonly<{ x: number; z: number }>;
  halfLength: number; halfWidth: number }>
export type PublicV23ResolvedSite = Readonly<{
  id: string; kind: 'ladder'; obstacle: 'mireglass-slate';
  from: Readonly<Vec3>; to: Readonly<Vec3>; approach: Readonly<Vec3>; exit: Readonly<Vec3>;
  supportPath: readonly Readonly<Vec3>[];
  normal: Readonly<{ x: number; z: number }>; tangent: Readonly<{ x: number; z: number }>;
  corridor: PublicV23Corridor; footprintTileIds: readonly string[];
  widthMeters: 1.05; logCost: 4; xpReward: 60; rewardClass: 'construction';
  blockingResourceIds: readonly string[];
}>

export function publicV23PlacementId(aimZ: number): string | null {
  const q = Math.floor(aimZ * 10 + 0.5)
  return Number.isSafeInteger(q) && q >= 4306 && q <= 4334
    ? `works5:ladder:mireglass-slate:W:-103:${q}` : null
}

/** Conservative two-metre prop reservation plus guarded width and clearance.
 * This first face requires an intrinsically clear approach, including tree stumps;
 * resource depletion does not make an obstructed placement eligible.
 */
export function publicV23CanonicalPropBlockers(seed: string, approach: Readonly<Vec3>,
  exit: Readonly<Vec3>): readonly string[] {
  const props = [...Object.values(mireglassAnchors(seed)), ...mireglassResources(seed),
    ...mireglassHerbPatches(seed), mireglassFairyRing(seed)]
  const dx = exit.x - approach.x, dz = exit.z - approach.z, length2 = dx * dx + dz * dz
  return props.filter(({ tile }) => {
    const point = tile.center
    const t = Math.max(0, Math.min(1, ((point.x - approach.x) * dx + (point.z - approach.z) * dz) / length2))
    return Math.hypot(point.x - approach.x - t * dx, point.z - approach.z - t * dz) <= 2 + 0.54 + 0.05
  }).map(({ id }) => id).sort()
}

/** Full guarded width must lie on canonical supported grid rows. */
export function resolvePublicV23Site(seed: string, id: unknown): PublicV23ResolvedSite | null {
  if (typeof seed !== 'string' || !seed || typeof id !== 'string') return null
  const match = /^works5:ladder:mireglass-slate:W:-103:(-?(?:0|[1-9]\d*))$/.exec(id)
  if (!match || match[1] === '-0') return null
  const q = Number(match[1]), z = q / 10
  // Bound this obstacle's candidate row; guarded-width terrain checks below
  // decide the valid edges (4305/4335 touch unsupported neighboring rows).
  if (!Number.isSafeInteger(q) || String(q) !== match[1] || q < 4300 || q > 4340) return null
  const minRow = Math.ceil((z - 0.54) / 4 - 0.5)
  const maxRow = Math.ceil((z + 0.54) / 4 - 0.5)
  const rows: Extract<TerrainWorkSite, { kind: 'bridge' | 'ladder' }>[] = []
  for (let row = minRow; row <= maxRow; row++) {
    const site = resolveTerrainWorkSite(seed, `works1:ladder:-103:${row}:W`)
    if (!site || site.kind !== 'ladder') return null
    rows.push(site)
  }
  const base = rows[0], at = (point: Readonly<Vec3>): Vec3 => ({ ...point, z })
  const blockingResourceIds = publicV23CanonicalPropBlockers(seed, at(base.approach), at(base.exit))
  if (blockingResourceIds.length) return null
  const normal = { x: -1, z: 0 }, tangent = { x: 0, z: 1 }
  const from = at(base.from), to = at(base.to)
  return { id, kind: 'ladder', obstacle: 'mireglass-slate', from, to,
    approach: at(base.approach), exit: at(base.exit), supportPath: base.supportPath.map(at),
    normal, tangent, corridor: { center: { x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2, z }, normal, tangent, halfLength: 2, halfWidth: 0.54 },
    footprintTileIds: [...new Set(rows.flatMap((row) => row.footprintTileIds))],
    widthMeters: 1.05, logCost: 4, xpReward: 60, rewardClass: 'construction',
    blockingResourceIds }
}

/** Separating-axis test. Discovery tile sharing is deliberately irrelevant. */
export function publicV23CorridorsOverlap(a: PublicV23Corridor, b: PublicV23Corridor,
  clearance = 0.05): boolean {
  const delta = { x: b.center.x - a.center.x, z: b.center.z - a.center.z }
  const dot = (p: { x: number; z: number }, q: { x: number; z: number }) => p.x * q.x + p.z * q.z
  const radius = (box: PublicV23Corridor, axis: { x: number; z: number }) =>
    Math.abs(dot(box.normal, axis)) * box.halfLength + Math.abs(dot(box.tangent, axis)) * box.halfWidth
  return [a.normal, a.tangent, b.normal, b.tangent].every((axis) =>
    Math.abs(dot(delta, axis)) < radius(a, axis) + radius(b, axis) + clearance - 1e-9)
}

export function publicV23LegacyCorridor(site: TerrainWorkSite | PublicV16GreenwaySite): PublicV23Corridor {
  if (site.kind === 'dig') return { center: site.center, normal: { x: 1, z: 0 },
    tangent: { x: 0, z: 1 }, halfLength: 2, halfWidth: 2 }
  const dx = site.to.x - site.from.x, dz = site.to.z - site.from.z
  const length = Math.hypot(dx, dz), normal = { x: dx / length, z: dz / length }
  return { center: { x: (site.from.x + site.to.x) / 2,
    y: (site.from.y + site.to.y) / 2, z: (site.from.z + site.to.z) / 2 }, normal,
  tangent: { x: -normal.z, z: normal.x }, halfLength: length / 2,
  halfWidth: site.widthMeters / 2 + (site.kind === 'ladder' ? 0.015 : 0.04) }
}

export function publicV23WorkCorridor(seed: string, id: string): PublicV23Corridor | null {
  const regional = resolvePublicV23Site(seed, id)
  if (regional) return regional.corridor
  const old = resolveTerrainWorkSite(seed, id) ?? resolvePublicV17GreenwaySite(seed, id)
  return old ? publicV23LegacyCorridor(old) : null
}

/** A field camp reserves its entire three-by-three 4m-cell footprint. */
export function publicV23CampOverlaps(seed: string, corridor: PublicV23Corridor, tileId: string): boolean {
  const camp = resolveFieldCampSite(seed, tileId)
  return !camp || publicV23CorridorsOverlap(corridor, { center: camp.tile.center,
    normal: { x: 1, z: 0 }, tangent: { x: 0, z: 1 }, halfLength: 6, halfWidth: 6 })
}
