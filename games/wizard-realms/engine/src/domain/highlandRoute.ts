import { WORLD_CELL_METERS } from './worldChunks'

type Point = Readonly<{ x: number; z: number }>

export const HIGHLAND_LANDMARK = Object.freeze({
  id: 'highland_quarry/landmark/quarry_crown', x: 464, z: -432,
})

const WAYPOINTS: readonly Point[] = [
  { x: 12, z: 0 }, { x: 96, z: 0 }, { x: 192, z: -96 }, { x: 320, z: -224 },
  { x: 448, z: -384 }, { x: 464, z: -432 }, { x: 520, z: -480 },
]

/** Pinned 4 m cardinal route. At each step, reduce the larger remaining axis; x wins a tie. */
const corridor = (() => {
  const points: Point[] = [{ ...WAYPOINTS[0] }]
  for (const target of WAYPOINTS.slice(1)) {
    let current = points.at(-1)!
    while (current.x !== target.x || current.z !== target.z) {
      const dx = target.x - current.x
      const dz = target.z - current.z
      current = Math.abs(dx) >= Math.abs(dz)
        ? { x: current.x + Math.sign(dx) * WORLD_CELL_METERS, z: current.z }
        : { x: current.x, z: current.z + Math.sign(dz) * WORLD_CELL_METERS }
      points.push(current)
    }
  }
  return Object.freeze(points.map((point) => Object.freeze(point)))
})()

export function highlandCorridorCells(): readonly Point[] { return corridor }
