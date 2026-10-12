import { discoveryMaskHasTileId } from './discoveryMask'
import type { PublicTerrainWorkEvent } from './publicTerrainWorkAction'
import { publicV23CampOverlaps, publicV23CorridorsOverlap,
  publicV23WorkCorridor } from './publicWorldV23Sites'
import { decodePublicV23Progress } from './publicWorldV23Snapshot'
import { decodePublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import type { PublicV28Progress } from './publicWorldV28Migration'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import type { PublicV28RiverBridgeSite } from './publicWorldV28RiverBridgeSites'
import { projectPublicV28Pose, publicV28ResolvedRiverBridges,
  PUBLIC_V28_MAX_RIVER_BRIDGES } from './publicWorldV28RiverSupport'

export type PublicV28BridgeRejection = 'invalid_progress' | 'invalid_site' | 'undiscovered'
  | 'unavailable_here' | 'too_far' | 'already_done' | 'limit_reached'
  | 'occupied' | 'not_owned' | 'invalid_value'
export type PublicV28BridgeEvent = PublicTerrainWorkEvent & Readonly<{ kind: 'bridge' }>
export type PublicV28BridgeResult = Readonly<{
  progress: PublicV28Progress; event: PublicV28BridgeEvent; rejection?: never
}> | Readonly<{ progress?: never; event?: never; rejection: PublicV28BridgeRejection }>

const oldProgress = ({ state, greenwayWorks, regionalWorks }: PublicV28Progress) =>
  ({ state, greenwayWorks, regionalWorks })

/** The ledger's structures must remain compatible with older works, camps and excavated ground. */
export function publicV28BridgeSitesValid(progress: PublicV28Progress): boolean {
  try {
    const { state, terrain, riverBridgeIds } = progress, seed = state.seed
    const sites = publicV28ResolvedRiverBridges(seed, riverBridgeIds)
    const checkedTerrain = decodePublicV26TerrainLedger(terrain)
    if (!sites || !checkedTerrain) return false
    const oldIds = [...state.terrainWorks.builtWorkIds, ...state.terrainWorks.dugTileIds,
      ...progress.greenwayWorks.builtBridgeIds, ...progress.greenwayWorks.builtLadderIds,
      ...progress.greenwayWorks.dugTileIds, ...progress.regionalWorks.builtLadderIds]
    const oldCorridors = oldIds.map((id) => publicV23WorkCorridor(seed, id))
    if (oldCorridors.some((corridor) => !corridor)) return false
    for (let index = 0; index < sites.length; index++) {
      const site = sites[index]
      if (site.footprintTileIds.some((id) => !discoveryMaskHasTileId(state.discoveryMask, id))
        || state.fieldCampTileIds.some((id) => publicV23CampOverlaps(seed, site.corridor, id))
        || oldCorridors.some((corridor) => publicV23CorridorsOverlap(site.corridor, corridor!))
        || sites.slice(0, index).some((other) =>
          publicV23CorridorsOverlap(site.corridor, other.corridor))
        || checkedTerrain.columns.some((column) => column.openDepth > 0
          && site.footprintTileIds.includes(`tile-${column.gx + 3}-${column.gz + 3}`))) return false
    }
    return !!projectPublicV28Pose(oldProgress(progress), checkedTerrain, riverBridgeIds)
  } catch { return false }
}

type Checked = Readonly<{ progress: PublicV28Progress; site: PublicV28RiverBridgeSite }>
  | Readonly<{ rejection: PublicV28BridgeRejection; site: PublicV28RiverBridgeSite | null }>
function checked(raw: PublicV28Progress, id: unknown): Checked {
  const reject = (rejection: PublicV28BridgeRejection, site: PublicV28RiverBridgeSite | null = null): Checked =>
    ({ rejection, site })
  try {
    const seed = raw?.state?.seed
    if (typeof seed !== 'string') return reject('invalid_progress')
    const old = decodePublicV23Progress(oldProgress(raw), seed)
    const terrain = decodePublicV26TerrainLedger(raw.terrain)
    const sites = publicV28ResolvedRiverBridges(seed, raw.riverBridgeIds)
    if (!old || !terrain || !sites || !Number.isSafeInteger(raw.nextHomeAtMs)
      || raw.nextHomeAtMs < 0) return reject('invalid_progress')
    const progress = { ...old, terrain, nextHomeAtMs: raw.nextHomeAtMs,
      riverBridgeIds: sites.map((site) => site.id) }
    if (!publicV28BridgeSitesValid(progress)) return reject('invalid_progress')
    const site = resolvePublicV28RiverBridge(seed, id)
    if (!site) return reject('invalid_site')
    if (old.state.movementOwner !== 'streamed') return reject('unavailable_here', site)
    if (site.footprintTileIds.some((tile) =>
      !discoveryMaskHasTileId(old.state.discoveryMask, tile))) return reject('undiscovered', site)
    if (progress.riverBridgeIds.includes(site.id)) return reject('already_done', site)
    if (progress.riverBridgeIds.length >= PUBLIC_V28_MAX_RIVER_BRIDGES)
      return reject('limit_reached', site)
    const { player } = old.state, position = player.position
    const pose = projectPublicV28Pose(old, terrain, progress.riverBridgeIds)
    if (!pose || player.verticalVelocity !== 0 || pose.support !== 'terrain'
      || Math.abs(position.y - pose.carrier.floorY) > 1e-6
      || Math.abs(pose.effective.floorY - pose.carrier.floorY) > 1e-6
      || pose.cell.gx !== site.from.x / 4 || pose.cell.gz !== site.from.z / 4
      || Math.hypot(position.x - site.from.x, position.y - site.from.y,
        position.z - site.from.z) > 3) return reject('too_far', site)
    const candidate = { ...progress, riverBridgeIds: [...progress.riverBridgeIds, site.id].sort() }
    if (!publicV28BridgeSitesValid(candidate)) return reject('occupied', site)
    if (player.inventory.filter((stack) => stack.itemId === 'logs')
      .reduce((sum, stack) => sum + stack.quantity, 0) < site.logCost)
      return reject('not_owned', site)
    if (![old.state.eventSequence + 1, player.xp + site.xpReward,
      player.skillXp.construction + site.xpReward].every(Number.isSafeInteger))
      return reject('invalid_value', site)
    return { progress, site }
  } catch { return reject('invalid_progress') }
}

/** Advisory only. Confirmation recomputes all eligibility from the current checked state. */
export function previewPublicV28RiverBridge(progress: PublicV28Progress, id: unknown): {
  site: PublicV28RiverBridgeSite | null; rejection: PublicV28BridgeRejection | null
} {
  const result = checked(progress, id)
  return { site: result.site, rejection: 'rejection' in result ? result.rejection : null }
}

/** Pure candidate for the V28 locked witness writer. */
export function confirmPublicV28RiverBridge(raw: PublicV28Progress, id: unknown): PublicV28BridgeResult {
  const result = checked(raw, id)
  if ('rejection' in result) return { rejection: result.rejection }
  const { progress, site } = result
  const state = structuredClone(progress.state)
  let remaining: number = site.logCost
  for (const stack of state.player.inventory) {
    if (stack.itemId !== 'logs') continue
    const spent = Math.min(stack.quantity, remaining)
    stack.quantity -= spent
    remaining -= spent
  }
  state.player.inventory = state.player.inventory.filter((stack) => stack.quantity > 0)
  state.player.xp += site.xpReward
  state.player.skillXp.construction += site.xpReward
  state.player.level = 1 + Math.floor(state.player.xp / 100)
  const nextState = { ...state, eventSequence: state.eventSequence + 1 }
  const next = { ...progress, state: nextState,
    riverBridgeIds: [...progress.riverBridgeIds, site.id].sort() }
  const verified = decodePublicV23Progress(oldProgress(next), state.seed)
  if (!verified || !publicV28BridgeSitesValid(next)) return { rejection: 'invalid_progress' }
  return { progress: { ...next, ...verified }, event: { kind: 'bridge', type: 'terrain_work_built',
    id: site.id, tick: progress.state.tick, sequence: nextState.eventSequence,
    logsSpent: site.logCost, stoneGained: 0, xp: site.xpReward } }
}
