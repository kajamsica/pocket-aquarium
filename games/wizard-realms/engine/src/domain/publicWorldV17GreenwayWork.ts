import { discoveryMaskHasTileId } from './discoveryMask'
import type { PublicTerrainWorkEvent, PublicTerrainWorkRejection } from './publicTerrainWorkAction'
import { publicV17StarterPoseValid } from './publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import type { PublicV16GreenwaySite as PublicV17GreenwaySite } from './publicWorldV16GreenwaySites'
import type { PublicV17GreenwayWorks } from './publicWorldV17Migration'
import { decodePublicV17Progress } from './publicWorldV17Validation'
import type { PublicV17Progress } from './publicWorldV17Validation'
import { resolveTerrainWorkSite } from './terrainWorks'

export type PublicV17GreenwayWorkPreview = Readonly<{ site: PublicV17GreenwaySite | null
  rejection: PublicTerrainWorkRejection | null }>
export type PublicV17GreenwayWorkEvent = PublicTerrainWorkEvent &
  Readonly<{ kind: PublicV17GreenwaySite['kind'] }>
export type PublicV17GreenwayWorkResult =
  | Readonly<{ progress: PublicV17Progress; event: PublicV17GreenwayWorkEvent; rejection?: never }>
  | Readonly<{ progress?: never; event?: never; rejection: PublicTerrainWorkRejection }>

type Checked = { site: PublicV17GreenwaySite; progress: PublicV17Progress
  nextWorks: PublicV17GreenwayWorks; rejection: null }
  | { site: PublicV17GreenwaySite | null; progress: null; nextWorks: null
    rejection: PublicTerrainWorkRejection }
const REACH_METERS = 3
const count = (progress: PublicV17Progress, itemId: string) =>
  progress.state.player.inventory.filter((stack) => stack.itemId === itemId)
    .reduce((sum, stack) => sum + stack.quantity, 0)
const usedCapacity = (progress: PublicV17Progress) =>
  progress.state.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)
    + progress.state.player.tradeSlots.reduce((sum, slot) => sum + slot.quantity, 0)
function underWork(site: PublicV17GreenwaySite, x: number, z: number): boolean {
  const { minX, maxX, minZ, maxZ } = physicalBounds(site)
  return site.kind === 'dig'
    ? x > minX && x <= maxX && z > minZ && z <= maxZ
    : x >= minX && x <= maxX && z >= minZ && z <= maxZ
}

/** Footprints include discovery/approach tiles; only occupied structure spans collide. */
function physicalBounds(site: PublicV17GreenwaySite) {
  if (site.kind === 'dig') return { minX: site.center.x - 2, maxX: site.center.x + 2,
    minZ: site.center.z - 2, maxZ: site.center.z + 2 }
  const halfWidth = site.widthMeters / 2 + (site.kind === 'bridge' ? 0.04 : 0.015)
  return { minX: site.from.x - halfWidth, maxX: site.from.x + halfWidth,
    minZ: site.kind === 'bridge' ? site.from.z - 0.5 : site.supportPath[2].z - 0.5,
    maxZ: site.kind === 'bridge' ? site.to.z + 0.5 : site.supportPath[1].z + 0.5 }
}

function physicalOverlap(left: PublicV17GreenwaySite,
  right: PublicV17GreenwaySite): boolean {
  const a = physicalBounds(left), b = physicalBounds(right)
  return a.minX < b.maxX && b.minX < a.maxX
    && a.minZ < b.maxZ && b.minZ < a.maxZ
}

/** Preview is advisory. Confirmation calls this again on its current input. */
function checked(progress: PublicV17Progress, id: unknown): Checked {
  const reject = (rejection: PublicTerrainWorkRejection,
    site: PublicV17GreenwaySite | null = null): Checked => ({
    site, progress: null, nextWorks: null, rejection })
  let seed: string | undefined
  try { seed = progress?.state?.seed } catch { return reject('invalid_progress') }
  if (typeof seed !== 'string') return reject('invalid_progress')
  const owned = decodePublicV17Progress(progress, seed)
  if (!owned) return reject('invalid_progress')
  const state = owned.state
  if (state.movementOwner !== 'greenway') return reject('unavailable_here')
  const site = resolvePublicV17GreenwaySite(seed, id)
  if (!site) return reject('invalid_site')
  if (site.footprintTileIds.some((tileId) =>
    !discoveryMaskHasTileId(state.discoveryMask, tileId))) return reject('undiscovered', site)
  const route = state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
  const movement = { seed, profile: state.generationProfile, route,
    built: state.greenway.builtRouteIds.includes('greenway_ladder'),
    greenwayWorks: owned.greenwayWorks }
  const position = state.player.position
  const target = site.kind === 'dig' ? site.center : site.from
  if (Math.hypot(position.x - target.x, position.y - target.y,
    position.z - target.z) > (site.kind === 'dig' ? 4 : REACH_METERS)) return reject('too_far', site)
  const workIds = site.kind === 'bridge' ? owned.greenwayWorks.builtBridgeIds
    : site.kind === 'ladder' ? owned.greenwayWorks.builtLadderIds
      : owned.greenwayWorks.dugTileIds
  if (workIds.includes(site.id)) return reject('already_done', site)
  if (workIds.length >= (site.kind === 'dig' ? 64 : 32)) return reject('limit_reached', site)

  const footprint = new Set(site.footprintTileIds)
  const overlaps = (tileIds: readonly string[]) => tileIds.some((tileId) => footprint.has(tileId))
  if (state.fieldCampTileIds.some((tileId) => footprint.has(tileId))
    || [...state.terrainWorks.builtWorkIds, ...state.terrainWorks.dugTileIds]
      .some((workId) => overlaps(resolveTerrainWorkSite(seed, workId)?.footprintTileIds ?? []))
    || [...owned.greenwayWorks.builtBridgeIds, ...owned.greenwayWorks.builtLadderIds,
      ...owned.greenwayWorks.dugTileIds].some((workId) => {
      const existing = resolvePublicV17GreenwaySite(seed, workId)
      return !existing || physicalOverlap(site, existing)
    })
    || underWork(site, position.x, position.z)) return reject('occupied', site)
  // P29 rejects permanent props and lists every tree intersecting its chosen structure.
  // V14 validation pins resource positions, so current depletion is the dynamic check.
  if (site.kind !== 'dig' && site.blockingResourceIds.some((resourceId) => {
    const resource = state.greenway.resources.find((entry) => entry.id === resourceId)
    return resource?.kind !== 'tree' || !resource.depleted || resource.health !== 0
  })) return reject('occupied', site)

  if (site.kind === 'dig') {
    if (state.player.equipment.mainHand !== 'field_spade'
      || count(owned, 'field_spade') < 1) return reject('requires_spade', site)
    if (usedCapacity(owned) + 1 > state.player.backpackCapacity) return reject('capacity', site)
  } else if (count(owned, 'logs') < site.logCost) return reject('not_owned', site)
  const xp = site.kind === 'dig' ? site.reward.xp : site.xpReward
  const skill = site.kind === 'dig' ? 'excavation' : 'construction'
  const stone = state.player.inventory.find((stack) => stack.itemId === 'stone')
  if (![state.eventSequence + 1, state.player.xp + xp,
    state.player.skillXp[skill] + xp,
    (stone?.quantity ?? 0) + Number(site.kind === 'dig')].every(Number.isSafeInteger)) {
    return reject('invalid_value', site)
  }
  const nextWorks = { ...owned.greenwayWorks,
    [site.kind === 'bridge' ? 'builtBridgeIds' : site.kind === 'ladder' ? 'builtLadderIds'
      : 'dugTileIds']: [...workIds, site.id].sort() }
  if (!publicV17StarterPoseValid({ ...movement, greenwayWorks: nextWorks },
    position, state.player.verticalVelocity)) return reject('occupied', site)
  return { site, progress: owned, nextWorks, rejection: null }
}

export function previewPublicV17GreenwayWork(progress: PublicV17Progress,
  id: unknown): PublicV17GreenwayWorkPreview {
  const result = checked(progress, id)
  return { site: result.site, rejection: result.rejection }
}

/** Pure candidate. The later checked writer owns storage and concurrency. */
export function confirmPublicV17GreenwayWork(progress: PublicV17Progress,
  id: unknown): PublicV17GreenwayWorkResult {
  const result = checked(progress, id)
  if (result.rejection || !result.progress || !result.site) {
    return { rejection: result.rejection ?? 'invalid_site' }
  }
  const owned = result.progress
  const site = result.site
  const player = owned.state.player
  const xp = site.kind === 'dig' ? site.reward.xp : site.xpReward
  let logsSpent = 0, stoneGained = 0
  if (site.kind === 'dig') {
    const stack = player.inventory.find((entry) => entry.itemId === 'stone')
    if (stack) stack.quantity += 1
    else player.inventory.push({ itemId: 'stone', quantity: 1 })
    stoneGained = 1
    player.skillXp.excavation += xp
  } else {
    logsSpent = site.logCost
    let remaining = logsSpent
    for (const stack of player.inventory) {
      if (stack.itemId !== 'logs') continue
      const spent = Math.min(remaining, stack.quantity)
      stack.quantity -= spent
      remaining -= spent
    }
    player.inventory = player.inventory.filter((stack) => stack.quantity > 0)
    player.skillXp.construction += xp
  }
  player.xp += xp
  player.level = 1 + Math.floor(player.xp / 100)
  const candidate = decodePublicV17Progress({ state: { ...owned.state,
    eventSequence: owned.state.eventSequence + 1 },
  greenwayWorks: result.nextWorks }, owned.state.seed)
  if (!candidate) return { rejection: 'invalid_progress' }
  return { progress: candidate,
    event: { kind: site.kind, type: site.kind === 'dig' ? 'terrain_work_dug' : 'terrain_work_built',
      id: site.id, tick: owned.state.tick, sequence: candidate.state.eventSequence,
      logsSpent, stoneGained, xp } }
}
