import { discoveryMaskHasTileId } from './discoveryMask'
import { previewCheckedCompactPublicTerrainWork } from './publicTerrainWorkAction'
import type { PublicTerrainWorkRejection } from './publicTerrainWorkAction'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import { parseTerrainWorkId } from './terrainWorks'
import type { TerrainWorkSite, TerrainWorkWindow } from './terrainWorks'

export type PublicV13BuildChoice = Readonly<{
  site: TerrainWorkSite; angleRadians: number; distanceMeters: number
  rejection: PublicTerrainWorkRejection | null; reason: string; benefit: string
}>
export type PublicV13BuildPreview = Readonly<{
  selected: PublicV13BuildChoice | null
  nearby: readonly PublicV13BuildChoice[]
  guidance: string | null
}>

const RADIUS_METERS = 16
const CONE_RADIANS = Math.PI / 6
const MAX_NEARBY = 5
const benefit = {
  bridge: 'Cross a shallow Fen channel. Costs 8 logs and earns 80 Construction XP.',
  ladder: 'Climb a 1.56 m Slate cliff. Costs 4 logs and earns 60 Construction XP.',
  dig: 'Lower loam by 0.24 m and gain 1 stone plus 30 Excavation XP. Stone and 4 logs can make a camp.',
} as const
const explore = {
  bridge: 'Explore the far bank before previewing a bridge.',
  ladder: 'Explore the upper cliff edge before previewing a ladder.',
  dig: 'Explore this loam ground before previewing a dig.',
} as const

function reason(site: TerrainWorkSite, rejection: PublicTerrainWorkRejection | null): string {
  switch (rejection) {
    case null: return site.kind === 'dig' ? 'Ready to dig here.' : 'Ready to build here.'
    case 'too_far': return site.kind === 'dig'
      ? 'Move within 3 m of the dig tile.' : 'Move within 3 m of the source foot.'
    case 'not_owned': return site.kind === 'dig' ? 'Build preview is unavailable for this site.'
      : `Gather ${site.logCost} logs before building.`
    case 'requires_spade': return 'Own and equip a field spade to dig.'
    case 'capacity': return 'Free one backpack slot for the stone.'
    case 'already_done': return site.kind === 'dig' ? 'Already dug here.' : 'Already built here.'
    case 'occupied': return 'This footprint overlaps another work or camp.'
    case 'limit_reached': return 'The terrain-work limit has been reached.'
    case 'undiscovered': return explore[site.kind]
    default: return 'Build preview is unavailable for this site.'
  }
}

/** The caller caches sites from enumerateTerrainWorkSites(seed, window) until its window changes. */
export function selectPublicV13BuildPreview(state: PublicV13Head['state'],
  window: TerrainWorkWindow, sites: readonly TerrainWorkSite[], kind: TerrainWorkSite['kind'],
  bodyYaw: number): PublicV13BuildPreview {
  if (!Number.isFinite(bodyYaw) || !['bridge', 'ladder', 'dig'].includes(kind)) {
    throw new RangeError('Select a work kind with a finite body yaw.')
  }
  if (!window || typeof window !== 'object') throw new RangeError('A work window is required.')
  const { minGX, maxGX, minGZ, maxGZ } = window
  if (![minGX, maxGX, minGZ, maxGZ].every(Number.isSafeInteger)
    || maxGX < minGX || maxGZ < minGZ || maxGX - minGX >= 16 || maxGZ - minGZ >= 16
    || !Array.isArray(sites) || sites.length > 7 * (maxGX - minGX + 1) * (maxGZ - minGZ + 1)) {
    throw new RangeError('Build preview requires one cached 16 by 16 work window.')
  }
  const facingX = -Math.sin(bodyYaw), facingZ = -Math.cos(bodyYaw)
  const player = state.player.position
  const cachedSites: readonly TerrainWorkSite[] = sites
  const ranked: Array<{ site: TerrainWorkSite; angleRadians: number; distanceMeters: number;
    discovered: boolean }> = []
  const seen = new Set<string>()
  for (const site of cachedSites) {
    const anchor = parseTerrainWorkId(site.id)
    if (!anchor || anchor.kind !== site.kind || anchor.gx < minGX || anchor.gx > maxGX
      || anchor.gz < minGZ || anchor.gz > maxGZ || seen.has(site.id)) {
      throw new RangeError('Cached work sites must be distinct and inside their window.')
    }
    seen.add(site.id)
    if (site.kind !== kind) continue
    const x = site.kind === 'dig' ? site.center.x : (site.from.x + site.to.x) / 2
    const z = site.kind === 'dig' ? site.center.z : (site.from.z + site.to.z) / 2
    const dx = x - player.x, dz = z - player.z
    const distanceMeters = Math.hypot(dx, dz)
    if (distanceMeters > RADIUS_METERS) continue
    const angleRadians = distanceMeters < 1e-9 ? 0
      : Math.atan2(Math.abs(facingX * dz - facingZ * dx), facingX * dx + facingZ * dz)
    ranked.push({ site, angleRadians, distanceMeters,
      discovered: site.footprintTileIds.every((id: string) => discoveryMaskHasTileId(state.discoveryMask, id)) })
  }
  ranked.sort((a, b) => a.angleRadians - b.angleRadians || a.distanceMeters - b.distanceMeters
    || (a.site.id < b.site.id ? -1 : a.site.id > b.site.id ? 1 : 0))
  const guidance = ranked.some(({ discovered, angleRadians }) => !discovered
    && angleRadians <= CONE_RADIANS) ? explore[kind] : null
  const nearby = ranked.filter(({ discovered }) => discovered).slice(0, MAX_NEARBY)
    .flatMap(({ site, angleRadians, distanceMeters }) => {
      const checked = previewCheckedCompactPublicTerrainWork(state, site.id)
      return checked.site ? [{ site: checked.site, angleRadians, distanceMeters,
        rejection: checked.rejection, reason: reason(checked.site, checked.rejection),
        benefit: benefit[checked.site.kind] }] : []
    })
  return { selected: nearby.find(({ angleRadians }) => angleRadians <= CONE_RADIANS) ?? null,
    nearby, guidance }
}
