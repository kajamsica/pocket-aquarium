import { discoveryMaskHasTileId } from './discoveryMask'
import { STORE_HALF_DEPTH, STORE_HALF_WIDTH } from './generation'
import { mireglassRouteSites } from './mireglassRouteSites'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { PUBLIC_V25_BEDROCK_LAYER, publicV25StratumAt } from './publicWorldV25Strata'
import { publicV26TerrainConserved } from './publicWorldV26TerrainConservation'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import { digPublicV26Column } from './publicWorldV26TerrainLedger'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { resolvePublicV23Site } from './publicWorldV23Sites'
import { projectPublicV28Pose, publicV28ResolvedRiverBridges } from './publicWorldV28RiverSupport'
import type { PublicV29Progress } from './publicWorldV29Migration'
import { decodePublicV29ActionProgress } from './publicWorldV29MiningTools'
import { resolveTerrainWorkSite } from './terrainWorks'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

export type PublicV29DeepDigAction = Readonly<{ kind: 'deep-dig'; gx: number; gz: number }>
export type PublicV29DeepDigResult = Readonly<{ progress: PublicV29Progress; rejection?: never }>
  | Readonly<{ progress?: never; rejection: string }>
const materials = ['soil', 'stone', 'iron_ore', 'gold_ore', 'diamond'] as const
const inGrid = (value: unknown): value is number => Number.isSafeInteger(value)
  && (value as number) >= WORLD_GRID_MIN && (value as number) <= WORLD_GRID_MAX
const tileId = (gx: number, gz: number) => `tile-${gx + 3}-${gz + 3}`

export function decodePublicV29DeepDigAction(value: unknown): PublicV29DeepDigAction | null {
  try {
    if (!exactPublicV23(value, ['kind', 'gx', 'gz']) || value.kind !== 'deep-dig'
      || !inGrid(value.gx) || !inGrid(value.gz)) return null
    structuredClone(value)
    return { kind: 'deep-dig', gx: value.gx, gz: value.gz }
  } catch { return null }
}

/** Old built works and V28 decks occupy their complete footprint, not only their visible rail. */
function occupied(progress: PublicV29Progress, gx: number, gz: number, id: string): boolean {
  const { state, greenwayWorks, regionalWorks } = progress
  const x = gx * WORLD_CELL_METERS, z = gz * WORLD_CELL_METERS, seed = state.seed
  if (gx === 0 && gz === 0 || progress.terrain.columns.some((entry) =>
    entry.gx === gx && entry.gz === gz && entry.pitLadder)
    || state.fieldCampTileIds.some((campId) => {
      const match = /^tile-(-?\d+)-(-?\d+)$/.exec(campId)
      return !!match && Math.abs(Number(match[1]) - 3 - gx) <= 1
        && Math.abs(Number(match[2]) - 3 - gz) <= 1
    }) || state.greenway.stores.some((store) =>
      Math.abs(x - store.position.x) <= STORE_HALF_WIDTH + 2
      && Math.abs(z - store.position.z) <= STORE_HALF_DEPTH + 2)) return true
  const sites = [
    ...[...greenwayWorks.builtBridgeIds, ...greenwayWorks.builtLadderIds]
      .map((workId) => resolvePublicV17GreenwaySite(seed, workId)),
    ...regionalWorks.builtLadderIds.map((workId) => resolvePublicV23Site(seed, workId)),
    ...state.terrainWorks.builtWorkIds.map((workId) => resolveTerrainWorkSite(seed, workId)),
  ]
  if (sites.some((site) => site?.footprintTileIds.includes(id))) return true
  const bridges = publicV28ResolvedRiverBridges(seed, progress.riverBridgeIds)
  if (!bridges || bridges.some((bridge) => bridge.footprintTileIds.includes(id))) return true
  const mireglassBuilt = Object.values(state.mireglass.builtRoutes).filter((workId): workId is string =>
    workId !== null)
  const authored = [
    ...state.greenway.routes.filter((route) => state.greenway.builtRouteIds.includes(route.id)),
    ...mireglassRouteSites(seed).filter((site) => mireglassBuilt.includes(site.id)),
  ]
  return authored.some(({ from, to }) => {
    const dx = to.x - from.x, dz = to.z - from.z, length2 = dx * dx + dz * dz
    const t = length2 ? Math.max(0, Math.min(1,
      ((x - from.x) * dx + (z - from.z) * dz) / length2)) : 0
    return Math.hypot(x - from.x - t * dx, z - from.z - t * dz) <= 3
  })
}

/** Server-owned geology and support determine one clicked layer; client input is only a cell. */
export function applyPublicV29DeepDig(rawProgress: PublicV29Progress,
  rawAction: unknown): PublicV29DeepDigResult {
  const reject = (rejection: string): PublicV29DeepDigResult => ({ rejection })
  const action = decodePublicV29DeepDigAction(rawAction)
  if (!action) return reject('invalid_action')
  const progress = decodePublicV29ActionProgress(rawProgress)
  if (!progress) return reject('invalid_progress')
  try {
    const { gx, gz } = action, { state, terrain } = progress, id = tileId(gx, gz)
    if (!discoveryMaskHasTileId(state.discoveryMask, id)) return reject('unrevealed')
    const playerPose = projectPublicV28Pose(progress, terrain, progress.riverBridgeIds)
    if (!playerPose || state.player.verticalVelocity !== 0
      || Math.abs(playerPose.effective.position.y - playerPose.effective.floorY) > 1e-6)
      return reject('invalid_pose')
    if (publicV25RiverCellAtGrid(state.seed, gx, gz)
      || publicV26TerrainCellIsWet(state.seed, gx, gz, state.movementOwner)) return reject('wet')
    const x = gx * WORLD_CELL_METERS, z = gz * WORLD_CELL_METERS
    const support = state.movementOwner === 'greenway'
      ? publicV17StarterSupportAt({ seed: state.seed, profile: state.generationProfile,
        route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
        built: state.greenway.builtRouteIds.includes('greenway_ladder'),
        greenwayWorks: progress.greenwayWorks }, { x, z })
      : resolvePublicV23Surface(state, { x, z }, progress.regionalWorks.builtLadderIds)
    if (!support || !('kind' in support ? support.kind === 'ground'
      : support.support === 'terrain') || occupied(progress, gx, gz, id)) return reject('occupied')
    const column = terrain.columns.find((entry) => entry.gx === gx && entry.gz === gz)
    const targetY = support.floorY - (column?.openDepth ?? 0) * 0.4
    if (Math.hypot(playerPose.effective.position.x - x,
      playerPose.effective.position.y - targetY,
      playerPose.effective.position.z - z) > 5) return reject('too_far')
    const layer = column?.openDepth ?? 0
    if (layer >= PUBLIC_V25_BEDROCK_LAYER) return reject('bedrock')
    const stratum = publicV25StratumAt(state.seed, gx, gz, layer)
    if (stratum.toolTier === 'spade') return reject('requires_spade')
    if (stratum.toolTier === 'enchanted_pick' && progress.miningTools.activePick !== 'enchanted')
      return reject('requires_enchanted_pick')
    if (stratum.toolTier === 'pick' && progress.miningTools.activePick === null)
      return reject('requires_pick')
    if (1 + Math.floor(state.player.skillXp.excavation / 30) < stratum.minimumExcavationLevel)
      return reject('skill_locked')
    const novel = layer === (column?.rewardDepth ?? 0)
    const bagCount = materials.reduce((sum, material) => sum + terrain.bag[material], 0)
    const carried = state.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)
      + state.player.tradeSlots.reduce((sum, slot) => sum + slot.quantity, 0)
    if (novel && carried + bagCount + 1 > state.player.backpackCapacity) return reject('capacity')
    const result = digPublicV26Column(terrain, { seed: state.seed, gx, gz, eligible: true })
    if (!result.ok) return reject(result.reason)
    if (!publicV26TerrainConserved(terrain, result.ledger, state.seed)) return reject('invalid_value')
    const material = result.material
    if (material === null) {
      const next = decodePublicV29ActionProgress({ ...progress, terrain: result.ledger })
      return next ? { progress: next } : reject('invalid_value')
    }
    const xp = state.player.xp + 30, excavation = state.player.skillXp.excavation + 30
    const sequence = state.eventSequence + 1
    if (![xp, excavation, sequence].every(Number.isSafeInteger)) return reject('invalid_value')
    const next = decodePublicV29ActionProgress({ ...progress, terrain: result.ledger, state: { ...state,
      eventSequence: sequence, player: { ...state.player, xp, level: 1 + Math.floor(xp / 100),
        skillXp: { ...state.player.skillXp, excavation } } } })
    return next ? { progress: next } : reject('invalid_value')
  } catch { return reject('invalid_progress') }
}
