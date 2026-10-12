import { highlandCorridorCells } from './highlandContent'
import type { WorldTile } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const route = highlandCorridorCells()
const routeIndex = route.findIndex(({ x, z }) => x === 512 && z === -472)
if (routeIndex !== 243) throw new Error('Pinned Highland signal route cell is missing.')

export const HIGHLAND_SIGNAL_BEARING = Object.freeze({
  x: 540, z: -500, label: 'Stormline Foothill',
})

export type HighlandSignalVane = Readonly<{
  id: 'highland_quarry/landmark/signal_vane'
  routeIndex: number
  routeCell: Readonly<{ x: number; z: number }>
  tile: WorldTile
}>

/** Fixed authored route cell. Terrain is derived from the same seed as the checked world. */
export function highlandSignalVane(seed: string): HighlandSignalVane {
  const routeCell = route[routeIndex]
  const tile = worldTileAtGrid(seed || 'wizard-realms',
    routeCell.x / WORLD_CELL_METERS, routeCell.z / WORLD_CELL_METERS)
  return Object.freeze({ id: 'highland_quarry/landmark/signal_vane', routeIndex,
    routeCell, tile: Object.freeze({ ...tile, center: Object.freeze({ ...tile.center }) }) })
}
