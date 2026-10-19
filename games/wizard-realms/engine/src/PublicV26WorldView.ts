import { projectPublicV26Pose } from './domain/publicWorldV26Pose'
import type { PublicV26Progress } from './domain/publicWorldV26Migration'
import { publicV26SavedLadderSpans } from './domain/publicWorldV26Snapshot'
import { publicV26ValleyRimSegments } from './domain/publicWorldV26ValleyRim'
import type { PublicV26ValleyRimSegment } from './domain/publicWorldV26ValleyRim'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './domain/worldChunks'
import type { WizardTerrainCell, WizardV26PitLadder, WizardViewProjection } from './view/contracts'
import { PUBLIC_VISUAL_RADIUS_CELLS, visibleTerrainCells } from './view/visibleTerrain'

export type PublicV26WorldViewProjection = WizardViewProjection & Readonly<{
  v26ValleyRimSegments: readonly PublicV26ValleyRimSegment[]
  v26PitLadders: readonly WizardV26PitLadder[]
  v26TerrainBag: NonNullable<WizardViewProjection['v26TerrainBag']>
  v26OpenPitColumns: NonNullable<WizardViewProjection['v26OpenPitColumns']>
}>

const gridAt = (position: number) => Math.ceil(position / WORLD_CELL_METERS - 0.5)

/** Overlay checked V26 physical state on an already-derived old-carrier view. */
export function publicWorldV26ViewProjection(progress: PublicV26Progress,
  carrier: WizardViewProjection): PublicV26WorldViewProjection {
  const { state, terrain: ledger } = progress
  const saved = state.player.position
  const shown = carrier?.player?.position
  if (carrier?.seed !== state.seed || !shown || shown[0] !== saved.x
    || shown[1] !== saved.y || shown[2] !== saved.z) {
    throw new RangeError('The V26 view and saved carrier pose must match.')
  }
  const pose = projectPublicV26Pose(progress, ledger)
  const spans = publicV26SavedLadderSpans(progress)
  if (!pose || !spans) throw new RangeError('Invalid V26 physical view state.')
  const depths = new Map(ledger.columns.filter((column) => column.openDepth > 0)
    .map((column) => [`${column.gx},${column.gz}`, column.openDepth]))
  const columns = new Map(ledger.columns.map((column) => [`${column.gx},${column.gz}`, column]))
  const lower = (cell: WizardTerrainCell): WizardTerrainCell => {
    if (cell.size[0] !== WORLD_CELL_METERS || cell.size[1] !== WORLD_CELL_METERS) return cell
    const depth = depths.get(`${gridAt(cell.position[0])},${gridAt(cell.position[2])}`) ?? 0
    const drop = 0.4 * depth
    return drop ? { ...cell,
      position: [cell.position[0], cell.position[1] - drop, cell.position[2]],
      height: cell.height - drop } : cell
  }
  const visualTerrain = carrier.visualWorld?.terrain.map(lower)
  const revealed = new Set(carrier.visualWorld?.discoveredTileIds ?? [])
  const visible = carrier.visualWorld ? visibleTerrainCells(carrier.visualWorld.terrain,
    carrier.player.position, PUBLIC_VISUAL_RADIUS_CELLS) : []
  const visiblePits = visible.flatMap((cell) => {
    if (cell.size[0] !== WORLD_CELL_METERS || cell.size[1] !== WORLD_CELL_METERS
      || !Number.isInteger(cell.position[0] / WORLD_CELL_METERS)
      || !Number.isInteger(cell.position[2] / WORLD_CELL_METERS)) return []
    const gx = cell.position[0] / WORLD_CELL_METERS
    const gz = cell.position[2] / WORLD_CELL_METERS
    const column = columns.get(`${gx},${gz}`)
    if (gx < WORLD_GRID_MIN || gx > WORLD_GRID_MAX || gz < WORLD_GRID_MIN || gz > WORLD_GRID_MAX
      || cell.id !== `tile-${gx + 3}-${gz + 3}` || !revealed.has(cell.id)
      || !column || !Number.isSafeInteger(column.openDepth)
      || column.openDepth < 1 || column.openDepth > 12) return []
    return [{ cell, column }]
  })
  const v26PitLadders = visiblePits.flatMap(({ cell, column }): WizardV26PitLadder[] =>
    column.pitLadder ? [{ cellId: cell.id, gx: column.gx, gz: column.gz,
      floorY: cell.position[1] - column.openDepth * 0.4, rimY: cell.position[1] }] : [])
  const v26OpenPitColumns = visiblePits.map(({ column }) => ({ gx: column.gx,
    gz: column.gz, openDepth: column.openDepth }))
  const current = columns.get(`${pose.cell.gx},${pose.cell.gz}`)
  const opportunity = (pose.support === 'ground' || pose.support === 'terrain')
    && current && current.openDepth >= 2 && !current.pitLadder
    ? { gx: pose.cell.gx, gz: pose.cell.gz, logCost: 4 as const } : undefined
  return { ...carrier,
    player: { ...carrier.player, position: [saved.x, pose.effective.position.y, saved.z] },
    terrain: carrier.terrain.map(lower),
    ...(carrier.visualWorld ? { visualWorld: { ...carrier.visualWorld, terrain: visualTerrain! } } : {}),
    v26PitLadders, v26PitLadderOpportunity: opportunity,
    v26OpenPitColumns, v26TerrainBag: { ...ledger.bag },
    v26ValleyRimSegments: publicV26ValleyRimSegments(state.seed, spans) }
}
