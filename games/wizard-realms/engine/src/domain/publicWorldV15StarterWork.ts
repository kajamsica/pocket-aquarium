import { discoveryMaskHasTileId } from './discoveryMask'
import type { PublicTerrainWorkEvent, PublicTerrainWorkRejection } from './publicTerrainWorkAction'
import { publicV15StarterPoseValid } from './publicWorldV15StarterMovement'
import { publicWorldV15StarterTileAtGrid, resolvePublicWorldV15StarterSite } from './publicWorldV15StarterSites'
import type { PublicV15StarterSite } from './publicWorldV15StarterSites'
import { decodePublicV15Progress } from './publicWorldV15Validation'
import type { PublicV15Progress } from './publicWorldV15Validation'
import { resolveTerrainWorkSite } from './terrainWorks'

export type PublicV15StarterWorkPreview = Readonly<{
  site: PublicV15StarterSite | null
  rejection: PublicTerrainWorkRejection | null
}>
export type PublicV15StarterWorkResult =
  | Readonly<{ progress: PublicV15Progress; event: PublicTerrainWorkEvent; rejection?: never }>
  | Readonly<{ progress?: never; event?: never; rejection: PublicTerrainWorkRejection }>

const REACH_METERS = 3
const itemCount = (progress: PublicV15Progress, id: string) =>
  progress.state.player.inventory.filter((stack) => stack.itemId === id)
    .reduce((sum, stack) => sum + stack.quantity, 0)
const capacityUsed = (progress: PublicV15Progress) =>
  progress.state.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)
  + progress.state.player.tradeSlots.reduce((sum, slot) => sum + slot.quantity, 0)
const tileAt = (progress: PublicV15Progress) => {
  const { x, z } = progress.state.player.position
  return publicWorldV15StarterTileAtGrid(progress.state.seed,
    Math.ceil(x / 4 - 0.5), Math.ceil(z / 4 - 0.5)).id
}

/** Preview is advisory; confirmation repeats this check on the current pair. */
function checked(progress: PublicV15Progress, id: unknown): PublicV15StarterWorkPreview {
  const reject = (rejection: PublicTerrainWorkRejection,
    site: PublicV15StarterSite | null = null): PublicV15StarterWorkPreview => ({ site, rejection })
  const owned = decodePublicV15Progress(progress, progress?.state?.seed)
  if (!owned) return reject('invalid_progress')
  if (owned.state.movementOwner !== 'greenway') return reject('unavailable_here')
  const site = resolvePublicWorldV15StarterSite(owned.state.seed, id)
  if (!site) return reject('invalid_site')
  if (site.footprintTileIds.some((tileId) =>
    !discoveryMaskHasTileId(owned.state.discoveryMask, tileId))) return reject('undiscovered', site)
  const route = owned.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
  if (!publicV15StarterPoseValid({ seed: owned.state.seed,
    profile: owned.state.generationProfile, route,
    built: owned.state.greenway.builtRouteIds.includes('greenway_ladder'),
    starterWorks: owned.starterWorks }, owned.state.player.position,
  owned.state.player.verticalVelocity)) return reject('invalid_progress', site)
  const target = site.kind === 'bridge' ? site.from : site.center
  const position = owned.state.player.position
  if (Math.hypot(position.x - target.x, position.y - target.y,
    position.z - target.z) > REACH_METERS) return reject('too_far', site)
  if (site.kind === 'bridge' ? owned.starterWorks.bridgeBuilt
    : owned.starterWorks.bankCacheDug) return reject('already_done', site)
  if (site.kind === 'bridge' ? owned.state.terrainWorks.builtWorkIds.length >= 32
    : owned.state.terrainWorks.dugTileIds.length >= 64) return reject('limit_reached', site)
  const occupiedByCamp = owned.state.fieldCampTileIds.some((tileId) =>
    site.footprintTileIds.includes(tileId))
  const occupiedByWork = [...owned.state.terrainWorks.builtWorkIds,
    ...owned.state.terrainWorks.dugTileIds].some((workId) => {
    const other = resolveTerrainWorkSite(owned.state.seed, workId)
    return other?.footprintTileIds.some((tileId) => site.footprintTileIds.includes(tileId))
  })
  if (occupiedByCamp || occupiedByWork
    || site.kind === 'dig' && tileAt(owned) === site.footprintTileIds[0]) {
    return reject('occupied', site)
  }
  if (site.kind === 'bridge') {
    if (itemCount(owned, 'logs') < site.logCost) return reject('not_owned', site)
  } else {
    if (owned.state.player.equipment.mainHand !== 'field_spade'
      || itemCount(owned, 'field_spade') < 1) return reject('requires_spade', site)
    if (capacityUsed(owned) + 1 > owned.state.player.backpackCapacity) {
      return reject('capacity', site)
    }
  }
  const xp = site.kind === 'bridge' ? site.xpReward : site.reward.xp
  const skill = site.kind === 'bridge' ? 'construction' : 'excavation'
  const stone = owned.state.player.inventory.find((stack) => stack.itemId === 'stone')
  if (![owned.state.eventSequence + 1, owned.state.player.xp + xp,
    owned.state.player.skillXp[skill] + xp,
    (stone?.quantity ?? 0) + Number(site.kind === 'dig')].every(Number.isSafeInteger)) {
    return reject('invalid_value', site)
  }
  // Building must not instantly leave the builder inside a raised deck.
  if (site.kind === 'bridge' && !publicV15StarterPoseValid({ seed: owned.state.seed,
    profile: owned.state.generationProfile, route,
    built: owned.state.greenway.builtRouteIds.includes('greenway_ladder'),
    starterWorks: { ...owned.starterWorks, bridgeBuilt: true } }, position,
  owned.state.player.verticalVelocity)) return reject('occupied', site)
  return { site, rejection: null }
}

export function previewPublicV15StarterWork(progress: PublicV15Progress,
  id: unknown): PublicV15StarterWorkPreview {
  return checked(progress, id)
}

/** Pure candidate. The checked v15 writer owns revision, lock, and storage. */
export function confirmPublicV15StarterWork(progress: PublicV15Progress,
  id: unknown): PublicV15StarterWorkResult {
  const preview = checked(progress, id)
  if (preview.rejection || !preview.site) return { rejection: preview.rejection ?? 'invalid_site' }
  const owned = decodePublicV15Progress(progress, progress.state.seed)
  if (!owned) return { rejection: 'invalid_progress' }
  const site = preview.site
  const player = owned.state.player
  const xp = site.kind === 'bridge' ? site.xpReward : site.reward.xp
  let logsSpent = 0, stoneGained = 0
  if (site.kind === 'bridge') {
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
  } else {
    const stone = player.inventory.find((stack) => stack.itemId === 'stone')
    if (stone) stone.quantity += 1
    else player.inventory.push({ itemId: 'stone', quantity: 1 })
    stoneGained = 1
    player.skillXp.excavation += xp
  }
  player.xp += xp
  player.level = 1 + Math.floor(player.xp / 100)
  const candidate: PublicV15Progress = { state: { ...owned.state,
    eventSequence: owned.state.eventSequence + 1 },
  starterWorks: site.kind === 'bridge' ? { ...owned.starterWorks, bridgeBuilt: true }
    : { ...owned.starterWorks, bankCacheDug: true } }
  const validated = decodePublicV15Progress(candidate, owned.state.seed)
  if (!validated) return { rejection: 'invalid_progress' }
  return { progress: validated,
    event: { type: site.kind === 'bridge' ? 'terrain_work_built' : 'terrain_work_dug',
      id: site.id, tick: owned.state.tick, sequence: validated.state.eventSequence,
      logsSpent, stoneGained, xp } }
}
