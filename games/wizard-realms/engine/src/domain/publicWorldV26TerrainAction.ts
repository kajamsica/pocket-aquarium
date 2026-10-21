import { backpackSlotsUsed } from './backpackSlots'
import { discoveryMaskHasTileId } from './discoveryMask'
import { STORE_HALF_DEPTH, STORE_HALF_WIDTH } from './generation'
import { mireglassRouteSites } from './mireglassRouteSites'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { PUBLIC_V25_BEDROCK_LAYER, publicV25StratumAt } from './publicWorldV25Strata'
import type { PublicV26Progress } from './publicWorldV26Migration'
import { projectPublicV26Pose } from './publicWorldV26Pose'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import { decodePublicV26TerrainLedger, digPublicV26Column,
  fillPublicV26Column } from './publicWorldV26TerrainLedger'
import { exactPublicV23, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { resolvePublicV23Site } from './publicWorldV23Sites'
import { resolveTerrainWorkSite } from './terrainWorks'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

export type PublicV26TerrainAction = Readonly<{ kind: 'dig' | 'fill'; gx: number; gz: number }>
export type PublicV26TerrainActionResult = Readonly<{ progress: PublicV26Progress; rejection?: never }>
  | Readonly<{ progress?: never; rejection: string }>
const materials = ['soil', 'stone', 'iron_ore', 'gold_ore', 'diamond'] as const
const tileId = (gx: number, gz: number) => `tile-${gx + 3}-${gz + 3}`
const inGrid = (n: unknown): n is number => Number.isSafeInteger(n)
  && (n as number) >= WORLD_GRID_MIN && (n as number) <= WORLD_GRID_MAX

export function decodePublicV26TerrainAction(value: unknown): PublicV26TerrainAction | null {
  try {
    return exactPublicV23(value, ['kind', 'gx', 'gz'])
      && (value.kind === 'dig' || value.kind === 'fill') && inGrid(value.gx) && inGrid(value.gz)
      && !!structuredClone(value)
      ? { kind: value.kind, gx: value.gx, gz: value.gz } : null
  } catch { return null }
}

function checkedProgress(value: unknown): PublicV26Progress | null {
  try {
    if (!exactPublicV23(value, ['state', 'greenwayWorks', 'regionalWorks', 'terrain', 'nextHomeAtMs'])
      || !Number.isSafeInteger(value.nextHomeAtMs) || (value.nextHomeAtMs as number) < 0) return null
    const seed = (value.state as { seed?: unknown }).seed
    if (typeof seed !== 'string') return null
    const old = decodePublicV23Progress({ state: value.state,
      greenwayWorks: value.greenwayWorks, regionalWorks: value.regionalWorks }, seed)
    const terrain = decodePublicV26TerrainLedger(value.terrain)
    return old && terrain ? { ...old, terrain, nextHomeAtMs: value.nextHomeAtMs as number } : null
  } catch { return null }
}

function occupied(progress: PublicV26Progress, gx: number, gz: number, id: string): boolean {
  const { state, greenwayWorks, regionalWorks } = progress
  const x = gx * WORLD_CELL_METERS, z = gz * WORLD_CELL_METERS, seed = state.seed
  if (gx === 0 && gz === 0 || state.fieldCampTileIds.some((campId) => {
    const match = /^tile-(-?\d+)-(-?\d+)$/.exec(campId)
    return !!match && Math.abs(Number(match[1]) - 3 - gx) <= 1
      && Math.abs(Number(match[2]) - 3 - gz) <= 1
  })) return true
  if (state.greenway.stores.some((store) =>
    Math.abs(x - store.position.x) <= STORE_HALF_WIDTH + 2
    && Math.abs(z - store.position.z) <= STORE_HALF_DEPTH + 2)) return true
  const built = [
    ...greenwayWorks.builtBridgeIds, ...greenwayWorks.builtLadderIds,
  ].map((workId) => resolvePublicV17GreenwaySite(seed, workId))
  const regional = regionalWorks.builtLadderIds.map((workId) => resolvePublicV23Site(seed, workId))
  const terrain = state.terrainWorks.builtWorkIds.map((workId) => resolveTerrainWorkSite(seed, workId))
  if ([...built, ...regional, ...terrain].some((site) => site?.footprintTileIds.includes(id))) return true
  const mireglassBuilt = Object.values(state.mireglass.builtRoutes).filter((id): id is string => id !== null)
  const authored = [
    ...state.greenway.routes.filter((route) => state.greenway.builtRouteIds.includes(route.id)),
    ...(mireglassBuilt.length ? mireglassRouteSites(seed)
      .filter((site) => mireglassBuilt.includes(site.id)) : []),
  ]
  return authored.some(({ from, to }) => {
    const dx = to.x - from.x, dz = to.z - from.z, length2 = dx * dx + dz * dz
    const t = length2 ? Math.max(0, Math.min(1,
      ((x - from.x) * dx + (z - from.z) * dz) / length2)) : 0
    return Math.hypot(x - from.x - t * dx, z - from.z - t * dz) <= 3
  })
}

/** Checks only server-owned progress and a clicked canonical cell, never client permission flags. */
export function applyPublicV26TerrainAction(rawProgress: PublicV26Progress,
  rawAction: unknown): PublicV26TerrainActionResult {
  const reject = (rejection: string): PublicV26TerrainActionResult => ({ rejection })
  const action = decodePublicV26TerrainAction(rawAction)
  if (!action) return reject('invalid_action')
  const progress = checkedProgress(rawProgress)
  if (!progress) return reject('invalid_progress')
  const finish = (next: PublicV26Progress): PublicV26TerrainActionResult => {
    const checked = checkedProgress(next)
    return checked ? { progress: checked } : reject('invalid_value')
  }
  try {
    const { gx, gz, kind } = action, { state, terrain } = progress
    const id = tileId(gx, gz)
    if (!discoveryMaskHasTileId(state.discoveryMask, id)) return reject('unrevealed')
    const playerPose = projectPublicV26Pose(progress, terrain)
    if (!playerPose || state.player.verticalVelocity !== 0
      || Math.abs(playerPose.effective.position.y - playerPose.effective.floorY) > 1e-6) {
      return reject('invalid_pose')
    }
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
      : support.support === 'terrain')) return reject('occupied')
    if (occupied(progress, gx, gz, id)) return reject('occupied')
    const column = terrain.columns.find((entry) => entry.gx === gx && entry.gz === gz)
    const targetY = support.floorY - (column?.openDepth ?? 0) * 0.4
    if (Math.hypot(playerPose.effective.position.x - x,
      playerPose.effective.position.y - targetY,
      playerPose.effective.position.z - z) > 5) return reject('too_far')
    const hasSpade = state.player.equipment.mainHand === 'field_spade'
      && state.player.inventory.some((stack) => stack.itemId === 'field_spade' && stack.quantity > 0)
    if (!hasSpade) return reject('requires_tool')
    if (kind === 'fill') {
      const result = fillPublicV26Column(terrain, { gx, gz, eligible: true })
      if (!result.ok) return reject(result.reason)
      return finish({ ...progress, terrain: result.ledger })
    }
    const layer = column?.openDepth ?? 0
    if (layer >= PUBLIC_V25_BEDROCK_LAYER) return reject('bedrock')
    const stratum = publicV25StratumAt(state.seed, gx, gz, layer)
    if (stratum.toolTier !== 'spade') {
      return reject('requires_tool')
    }
    if (1 + Math.floor(state.player.skillXp.excavation / 30) < stratum.minimumExcavationLevel) {
      return reject('skill_locked')
    }
    const novel = layer === (column?.rewardDepth ?? 0)
    const bagCount = materials.reduce((sum, material) => sum + terrain.bag[material], 0)
    const used = backpackSlotsUsed(state.player.inventory, state.player.tradeSlots, bagCount)
    if (novel && used + 1 > state.player.backpackCapacity) return reject('capacity')
    const result = digPublicV26Column(terrain, { seed: state.seed, gx, gz, eligible: true })
    if (!result.ok) return reject(result.reason)
    if (result.material === null) return finish({ ...progress, terrain: result.ledger })
    const xp = state.player.xp + 30, excavation = state.player.skillXp.excavation + 30
    const sequence = state.eventSequence + 1
    if (![xp, excavation, sequence].every(Number.isSafeInteger)) return reject('invalid_value')
    const nextState = { ...state, eventSequence: sequence, player: { ...state.player,
      xp, level: 1 + Math.floor(xp / 100), skillXp: { ...state.player.skillXp, excavation } } }
    return finish({ ...progress, state: nextState, terrain: result.ledger })
  } catch { return reject('invalid_progress') }
}
