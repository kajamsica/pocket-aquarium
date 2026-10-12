import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

type Point = { x: number; z: number }
type Cut = { t: number; axis: 'x' | 'z'; lowerCell: number }

const gridAt = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)

function checkedCell(point: Point): { gx: number; gz: number } {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) {
    throw new RangeError('V25 river sweep requires finite XZ endpoints.')
  }
  const gx = gridAt(point.x)
  const gz = gridAt(point.z)
  if (gx < WORLD_GRID_MIN || gx > WORLD_GRID_MAX || gz < WORLD_GRID_MIN || gz > WORLD_GRID_MAX) {
    throw new RangeError('V25 river sweep endpoints must belong to world grid cells.')
  }
  return { gx, gz }
}

function addCuts(cuts: Cut[], axis: 'x' | 'z', start: number, end: number): void {
  if (start === end) return
  const low = Math.min(start, end)
  const high = Math.max(start, end)
  for (let lowerCell = Math.floor(low / WORLD_CELL_METERS - 0.5) + 1;
    (lowerCell + 0.5) * WORLD_CELL_METERS < high; lowerCell += 1) {
    const boundary = (lowerCell + 0.5) * WORLD_CELL_METERS
    if (boundary > low) cuts.push({ t: (boundary - start) / (end - start), axis, lowerCell })
  }
}

/** True when any canonical wet cell contacts a finite, in-world XZ segment. */
export function publicV25RiverTouchesSegment(seed: string, from: Point, to: Point): boolean {
  const start = checkedCell(from)
  const end = checkedCell(to)
  const wet = (gx: number, gz: number) => publicV25RiverCellAtGrid(seed, gx, gz)
  if (wet(start.gx, start.gz) || wet(end.gx, end.gz)) return true

  const cuts: Cut[] = []
  addCuts(cuts, 'x', from.x, to.x)
  addCuts(cuts, 'z', from.z, to.z)
  cuts.sort((a, b) => a.t - b.t)

  let previous = 0
  for (let index = 0; index < cuts.length;) {
    const t = cuts[index].t
    const middle = (previous + t) / 2
    if (wet(gridAt(from.x + (to.x - from.x) * middle),
      gridAt(from.z + (to.z - from.z) * middle))) return true

    let xCut: Cut | undefined
    let zCut: Cut | undefined
    do {
      const cut = cuts[index]
      if (cut.axis === 'x') xCut = cut
      else zCut = cut
      index += 1
    } while (index < cuts.length && Math.abs(cuts[index].t - t) <= 8 * Number.EPSILON)

    // A diagonal threading a grid corner contacts both side cells too. A path
    // running along an edge has no cut on that axis and retains cell ownership.
    if (xCut && zCut) {
      const x = xCut.lowerCell
      const z = zCut.lowerCell
      if (wet(x, z) || wet(x + 1, z) || wet(x, z + 1) || wet(x + 1, z + 1)) return true
    }
    previous = t
  }
  const middle = (previous + 1) / 2
  return wet(gridAt(from.x + (to.x - from.x) * middle),
    gridAt(from.z + (to.z - from.z) * middle))
}
