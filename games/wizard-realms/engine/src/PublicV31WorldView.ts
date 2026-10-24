import type { PublicV31Progress } from './domain/publicWorldV31Migration'
import { previewPublicV31SoilPlaces } from './domain/publicWorldV31Soil'
import { projectPublicV31Pose } from './domain/publicWorldV31Support'
import { WORLD_CELL_METERS } from './domain/worldChunks'
import type { WizardTerrainCell, WizardViewProjection } from './view/contracts'

const cellId = (gx: number, gz: number) => `tile-${gx + 3}-${gz + 3}`
const gridAt = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)

/** V31-only visual lift from the checked sidecar; it never changes V30 terrain or saves. */
export function projectPublicV31WorldView(progress: PublicV31Progress,
  carrier: WizardViewProjection): WizardViewProjection {
  const { state, raisedSoilCells } = progress
  if (carrier.seed !== state.seed
    || carrier.player.position[0] !== state.player.position.x
    || carrier.player.position[2] !== state.player.position.z)
    throw new RangeError('The V31 view and checked carrier position must match.')
  const pose = projectPublicV31Pose(progress)
  if (!pose) throw new RangeError('Invalid V31 soil pose.')
  const player = { ...carrier.player, position: [state.player.position.x,
    pose.effective.position.y, state.player.position.z] as const }
  const raised = new Set(raisedSoilCells.map(({ gx, gz }) => cellId(gx, gz)))
  const lift = (cell: WizardTerrainCell): WizardTerrainCell => {
    if (cell.size[0] !== WORLD_CELL_METERS || cell.size[1] !== WORLD_CELL_METERS
      || cell.id !== cellId(gridAt(cell.position[0]), gridAt(cell.position[2]))
      || !raised.has(cell.id)) return cell
    return { ...cell, position: [cell.position[0], cell.position[1] + 0.4, cell.position[2]],
      height: cell.height + 0.4 }
  }
  const terrain = carrier.terrain.map(lift)
  const visualTerrain = carrier.visualWorld?.terrain.map(lift)
  const heights = new Map([...terrain, ...(visualTerrain ?? [])].map((cell) =>
    [cell.id, cell.position[1]] as const))
  return { ...carrier, player, terrain,
    ...(carrier.visualWorld ? { visualWorld: { ...carrier.visualWorld, terrain: visualTerrain! } } : {}),
    map: { ...carrier.map, tiles: carrier.map.tiles.map((tile) => {
      const height = tile.discovered && raised.has(tile.id) ? heights.get(tile.id) : undefined
      return height === undefined ? tile
        : { ...tile, elevationMeters: height, hasRaisedSoil: true }
    }) },
    v31Soil: { raisedCells: raisedSoilCells, soilAvailable: progress.terrain.bag.soil,
      placePreview: previewPublicV31SoilPlaces(progress) } }
}
