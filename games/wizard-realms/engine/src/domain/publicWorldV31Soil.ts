import { backpackSlotsUsed } from './backpackSlots'
import { discoveryMaskHasTileId } from './discoveryMask'
import { STORE_HALF_DEPTH, STORE_HALF_WIDTH } from './generation'
import { highlandStoneNodes } from './highlandContent'
import { mireglassResources } from './mireglassContent'
import { mireglassRouteSites } from './mireglassRouteSites'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV14InsideGreenway } from './publicWorldV14Boundary'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import { decodePublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { resolvePublicV23Site } from './publicWorldV23Sites'
import { publicV28ResolvedRiverBridges } from './publicWorldV28RiverSupport'
import { decodePublicV29ActionProgress } from './publicWorldV29MiningTools'
import type { PublicV29Progress } from './publicWorldV29Migration'
import { canonicalClaim } from './publicWorldV30Snapshot'
import type { PublicV30Progress } from './publicWorldV30Migration'
import type { PublicV31Progress } from './publicWorldV31Migration'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { resolveTerrainWorkSite } from './terrainWorks'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

export type PublicV31RaisedSoilCell = Readonly<{ gx: number; gz: number }>
export type PublicV31SoilWitness = Readonly<{
  kind: 'soil-place/v1' | 'soil-remove/v1'; gx: number; gz: number }>
export type PublicV31SoilResult = Readonly<{ progress: PublicV31Progress; rejection?: never }>
  | Readonly<{ progress?: never; rejection: string }>
const materials = ['soil', 'stone', 'iron_ore', 'gold_ore', 'diamond'] as const
const inGrid = (value: unknown): value is number => Number.isSafeInteger(value)
  && (value as number) >= WORLD_GRID_MIN && (value as number) <= WORLD_GRID_MAX
const order = (a: PublicV31RaisedSoilCell, b: PublicV31RaisedSoilCell) =>
  a.gx - b.gx || a.gz - b.gz
const tileId = (gx: number, gz: number) => `tile-${gx + 3}-${gz + 3}`

function nativeSupport(progress: PublicV31Progress, gx: number, gz: number) {
  const { state } = progress, x = gx * WORLD_CELL_METERS, z = gz * WORLD_CELL_METERS
  return publicV14InsideGreenway({ x, z })
    ? publicV17StarterSupportAt({ seed: state.seed, profile: state.generationProfile,
      route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
      built: state.greenway.builtRouteIds.includes('greenway_ladder'),
      greenwayWorks: progress.greenwayWorks }, { x, z })
    : resolvePublicV23Surface(state, { x, z }, progress.regionalWorks.builtLadderIds)
}

export function decodePublicV31RaisedSoilCells(value: unknown):
  readonly PublicV31RaisedSoilCell[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > 256 || Reflect.ownKeys(value).length !== value.length + 1) return null
    const cells: PublicV31RaisedSoilCell[] = []
    for (let i = 0; i < value.length; i += 1) {
      const field = Object.getOwnPropertyDescriptor(value, String(i))
      const row: unknown = field?.value
      if (!field?.enumerable || !Object.hasOwn(field, 'value')
        || !exactPublicV23(row, ['gx', 'gz']) || !inGrid(row.gx) || !inGrid(row.gz)) return null
      const cell = { gx: row.gx, gz: row.gz }
      if (cells.length && order(cells[cells.length - 1], cell) >= 0) return null
      cells.push(cell)
    }
    structuredClone(value)
    return cells
  } catch { return null }
}

export function publicV31HasRaisedSoilCell(cells: readonly PublicV31RaisedSoilCell[],
  gx: number, gz: number): boolean {
  return cells.some((cell) => cell.gx === gx && cell.gz === gz)
}

export function decodePublicV31SoilWitness(value: unknown): PublicV31SoilWitness | null {
  try {
    if (!exactPublicV23(value, ['kind', 'gx', 'gz'])
      || value.kind !== 'soil-place/v1' && value.kind !== 'soil-remove/v1'
      || !inGrid(value.gx) || !inGrid(value.gz)) return null
    structuredClone(value)
    return { kind: value.kind, gx: value.gx, gz: value.gz }
  } catch { return null }
}

/** V29's complete occupied footprint plus resource cells and protected routes. */
function occupied(progress: PublicV31Progress, gx: number, gz: number, id: string): boolean {
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
      && Math.abs(z - store.position.z) <= STORE_HALF_DEPTH + 2)
    || state.greenway.resources.some((resource) => resource.tileId === id && !resource.depleted)
    || mireglassResources(seed).some((resource) => resource.tile.id === id)
    || highlandStoneNodes(seed).some((node) => node.tile.id === id)) return true
  const sites = [
    ...[...greenwayWorks.builtBridgeIds, ...greenwayWorks.builtLadderIds]
      .map((workId) => resolvePublicV17GreenwaySite(seed, workId)),
    ...regionalWorks.builtLadderIds.map((workId) => resolvePublicV23Site(seed, workId)),
    ...state.terrainWorks.builtWorkIds.map((workId) => resolveTerrainWorkSite(seed, workId)),
  ]
  if (sites.some((site) => site?.footprintTileIds.includes(id))) return true
  // Works3/4 bridge and ladder footprints are confined to these grid bands.
  // Reserve the corridor before a lift can make a future route build unreplayable.
  if (gz >= 0 && gz <= 4 && Math.abs(gx) <= 2
    || gz >= -3 && gz <= 0 && Math.abs(gx) <= 7) return true
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

/** Structural location proof also applies when the last three slots omit placement history. */
export function publicV31RaisedSoilSitesValid(progress: PublicV31Progress): boolean {
  try {
    const cells = decodePublicV31RaisedSoilCells(progress.raisedSoilCells)
    if (!cells) return false
    const { state, terrain } = progress
    return cells.every(({ gx, gz }) => {
      const id = tileId(gx, gz)
      if (!discoveryMaskHasTileId(state.discoveryMask, id)
        || publicV25RiverCellAtGrid(state.seed, gx, gz)
        || publicV26TerrainCellIsWet(state.seed, gx, gz, state.movementOwner)
        || terrain.columns.some((column) => column.gx === gx && column.gz === gz
          && column.openDepth !== 0) || occupied(progress, gx, gz, id)) return false
      const support = nativeSupport(progress, gx, gz)
      return !!support && ('kind' in support ? support.kind === 'ground'
        : support.support === 'terrain')
    })
  } catch { return false }
}

/** Full V30 field validation, then independent V31 sidecar and effective-pose checks. */
export function decodePublicV31ActionProgress(value: PublicV31Progress): PublicV31Progress | null {
  try {
    if (!exactPublicV23(value, ['state', 'greenwayWorks', 'regionalWorks', 'terrain',
      'nextHomeAtMs', 'riverBridgeIds', 'miningTools', 'claimedBridgeheadId',
      'raisedSoilCells'])) return null
    const { state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
      riverBridgeIds, miningTools } = value
    const inherited = decodePublicV29ActionProgress({ state, greenwayWorks, regionalWorks,
      terrain, nextHomeAtMs, riverBridgeIds, miningTools } as PublicV29Progress)
    const raisedSoilCells = decodePublicV31RaisedSoilCells(value.raisedSoilCells)
    if (!inherited || !raisedSoilCells || !canonicalClaim(value as PublicV30Progress)) return null
    const next = { ...inherited, claimedBridgeheadId: value.claimedBridgeheadId, raisedSoilCells }
    return publicV31RaisedSoilSitesValid(next) && projectPublicV31Pose(next) ? next : null
  } catch { return null }
}

export function previewPublicV31SoilAction(progress: PublicV31Progress, rawWitness: unknown):
  Readonly<{ rejection: string | null }> {
  const result = confirmPublicV31SoilAction(progress, rawWitness)
  return { rejection: result.rejection ?? null }
}

function soilActionRejection(progress: PublicV31Progress, witness: PublicV31SoilWitness,
  playerPose: ReturnType<typeof projectPublicV31Pose>): string | null {
  const { gx, gz, kind } = witness, { state, terrain, raisedSoilCells } = progress
  const id = tileId(gx, gz)
  if (!discoveryMaskHasTileId(state.discoveryMask, id)) return 'unrevealed'
  if (!playerPose || state.player.verticalVelocity !== 0
    || Math.abs(playerPose.effective.position.y - playerPose.effective.floorY) > 1e-6)
    return 'invalid_pose'
  if (publicV25RiverCellAtGrid(state.seed, gx, gz)
    || publicV26TerrainCellIsWet(state.seed, gx, gz, state.movementOwner)) return 'wet'
  const x = gx * WORLD_CELL_METERS, z = gz * WORLD_CELL_METERS
  const support = nativeSupport(progress, gx, gz)
  if (!support || !('kind' in support ? support.kind === 'ground'
    : support.support === 'terrain')) return 'occupied'
  if (Math.abs(state.player.position.x - x) < 2
    && Math.abs(state.player.position.z - z) < 2 || occupied(progress, gx, gz, id))
    return 'occupied'
  const column = terrain.columns.find((entry) => entry.gx === gx && entry.gz === gz)
  if ((column?.openDepth ?? 0) !== 0) return 'open_column'
  const present = publicV31HasRaisedSoilCell(raisedSoilCells, gx, gz)
  const targetY = support.floorY + (present ? 0.4 : 0)
  if (Math.hypot(playerPose.effective.position.x - x,
    playerPose.effective.position.y - targetY,
    playerPose.effective.position.z - z) > 5) return 'too_far'
  const hasSpade = state.player.equipment.mainHand === 'field_spade'
    && state.player.inventory.some((stack) => stack.itemId === 'field_spade' && stack.quantity > 0)
  if (!hasSpade) return 'requires_tool'
  if (kind === 'soil-place/v1' && present) return 'already_raised'
  if (kind === 'soil-remove/v1' && !present) return 'not_raised'
  if (kind === 'soil-place/v1' && (!terrain.bag.soil || raisedSoilCells.length >= 256))
    return terrain.bag.soil ? 'cells_full' : 'requires_soil'
  if (kind === 'soil-remove/v1') {
    const bagCount = materials.reduce((sum, material) => sum + terrain.bag[material], 0)
    const used = backpackSlotsUsed(state.player.inventory, state.player.tradeSlots, bagCount)
    if (bagCount >= 256 || used + 1 > state.player.backpackCapacity) return 'capacity'
  }
  return null
}

/** Read-only place witnesses from checked progress, without re-decoding or successors. */
export function previewPublicV31SoilPlaces(rawProgress: PublicV31Progress):
  readonly Readonly<{ gx: number; gz: number; rejection: string | null }>[] {
  try {
    if (rawProgress.terrain.bag.soil === 0
      || rawProgress.state.player.equipment.mainHand !== 'field_spade') return []
    const { x, z } = rawProgress.state.player.position
    const playerPose = projectPublicV31Pose(rawProgress)
    const radius = 5.5
    const preview: { gx: number; gz: number; rejection: string | null }[] = []
    for (let gx = Math.ceil((x - radius) / WORLD_CELL_METERS);
      gx <= Math.floor((x + radius) / WORLD_CELL_METERS); gx += 1) {
      for (let gz = Math.ceil((z - radius) / WORLD_CELL_METERS);
        gz <= Math.floor((z + radius) / WORLD_CELL_METERS); gz += 1) {
        if (!inGrid(gx) || !inGrid(gz)
          || Math.hypot(gx * WORLD_CELL_METERS - x, gz * WORLD_CELL_METERS - z) > radius
          || !discoveryMaskHasTileId(rawProgress.state.discoveryMask, tileId(gx, gz))) continue
        let rejection: string | null
        try {
          rejection = soilActionRejection(rawProgress,
            { kind: 'soil-place/v1', gx, gz }, playerPose)
        } catch { rejection = 'invalid_progress' }
        preview.push({ gx, gz, rejection })
      }
    }
    return preview
  } catch { return [] }
}

/** Witness-owned soil accounting. No geology, XP, or event-sequence transition occurs. */
export function confirmPublicV31SoilAction(rawProgress: PublicV31Progress,
  rawWitness: unknown): PublicV31SoilResult {
  const reject = (rejection: string): PublicV31SoilResult => ({ rejection })
  const witness = decodePublicV31SoilWitness(rawWitness)
  if (!witness) return reject('invalid_action')
  const progress = decodePublicV31ActionProgress(rawProgress)
  if (!progress) return reject('invalid_progress')
  try {
    const { gx, gz, kind } = witness, { terrain, raisedSoilCells } = progress
    const playerPose = projectPublicV31Pose(progress)
    const rejection = soilActionRejection(progress, witness, playerPose)
    if (rejection) return reject(rejection)
    const present = publicV31HasRaisedSoilCell(raisedSoilCells, gx, gz)
    const delta = kind === 'soil-place/v1' ? -1 : 1
    const next: PublicV31Progress = { ...progress,
      terrain: { ...terrain, bag: { ...terrain.bag, soil: terrain.bag.soil + delta } },
      raisedSoilCells: kind === 'soil-place/v1'
        ? [...raisedSoilCells, { gx, gz }].sort(order)
        : raisedSoilCells.filter((cell) => cell.gx !== gx || cell.gz !== gz) }
    return decodePublicV26TerrainLedger(next.terrain) && decodePublicV31ActionProgress(next)
      ? { progress: next } : reject('invalid_value')
  } catch { return reject('invalid_progress') }
}
