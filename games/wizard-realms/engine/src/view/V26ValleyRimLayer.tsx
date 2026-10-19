import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PublicV26ValleyRimSegment } from '../domain/publicWorldV26ValleyRim'
import { WORLD_CELL_METERS } from '../domain/worldChunks'
import type { WizardTerrainCell } from './contracts'

const MAX_SEGMENTS = 132
const MAX_VERTICES = 8_192
const STEP_METERS = 1
const ROCK = [
  [0.31, 0.32, 0.31], [0.39, 0.38, 0.35], [0.45, 0.43, 0.39], [0.35, 0.36, 0.35],
] as const
const MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98,
  flatShading: true, side: THREE.DoubleSide })
const gridAt = (value: number) => Math.ceil(value / WORLD_CELL_METERS - 0.5)
const key = (x: number, z: number) => `${gridAt(x)}:${gridAt(z)}`
const rough = (x: number, z: number) =>
  Math.sin(x * 2.13 + z * 0.71) * Math.sin(z * 1.43 - x * 0.37)

/** Deterministic, discovery-gated facets on the checked segment lines. No aperture has faces. */
export function buildV26ValleyRimGeometry(segments: readonly PublicV26ValleyRimSegment[],
  revealedCells: readonly WizardTerrainCell[]): THREE.BufferGeometry {
  if (segments.length > MAX_SEGMENTS || revealedCells.length > 1_024)
    throw new RangeError('The V26 rim view must be bounded.')
  const terrain = new Map(revealedCells.filter((cell) =>
    cell.size[0] === WORLD_CELL_METERS && cell.size[1] === WORLD_CELL_METERS)
    .map((cell) => [key(cell.position[0], cell.position[2]), cell.position[1]]))
  const positions: number[] = [], colors: number[] = []
  const triangle = (points: readonly (readonly [number, number, number])[], tone: number) => {
    const color = ROCK[tone % ROCK.length]
    for (const point of points) {
      positions.push(...point)
      colors.push(...color)
    }
  }
  for (const segment of segments) {
    if (segment.ladderAperture) continue
    const dx = segment.to.x - segment.from.x, dz = segment.to.z - segment.from.z
    const length = Math.hypot(dx, dz)
    if (!Number.isFinite(length) || length > 100) throw new RangeError('Invalid V26 rim span.')
    if (length === 0) continue
    const nx = -dz / length, nz = dx / length
    const steps = Math.ceil(length / STEP_METERS)
    for (let index = 0; index < steps; index += 1) {
      const at = (fraction: number) => ({ x: segment.from.x + dx * fraction,
        z: segment.from.z + dz * fraction })
      const a = at(index / steps), b = at((index + 1) / steps)
      const middle = at((index + 0.5) / steps)
      const neighbors = [terrain.get(key(middle.x + nx * 0.4, middle.z + nz * 0.4)),
        terrain.get(key(middle.x - nx * 0.4, middle.z - nz * 0.4))]
        .filter((value): value is number => value !== undefined)
      if (!neighbors.length) continue
      const base = Math.min(...neighbors) - 0.35
      const crestFloor = Math.max(...neighbors) + 0.35
      const point = (p: { x: number; z: number }, side: number, offset: number, y: number):
        readonly [number, number, number] =>
        [p.x + nx * side * offset, y, p.z + nz * side * offset]
      for (const side of [-1, 1]) {
        const aBase = point(a, side, 0.2, base), bBase = point(b, side, 0.2, base)
        const aShoulder = point(a, side, 0.5, base + 0.72 + rough(a.x, a.z) * 0.13)
        const bShoulder = point(b, side, 0.5, base + 0.72 + rough(b.x, b.z) * 0.13)
        const aCrest = point(a, side, 0, Math.max(crestFloor, base + 2.04 + rough(a.x, a.z) * 0.24))
        const bCrest = point(b, side, 0, Math.max(crestFloor, base + 2.04 + rough(b.x, b.z) * 0.24))
        const tone = Math.abs(Math.round(middle.x * 3 + middle.z * 5 + side))
        triangle([aBase, bBase, aShoulder], tone)
        triangle([bBase, bShoulder, aShoulder], tone + 1)
        triangle([aShoulder, bShoulder, aCrest], tone + 2)
        triangle([bShoulder, bCrest, aCrest], tone + 1)
      }
      if (positions.length / 3 > MAX_VERTICES) throw new RangeError('The V26 rim mesh is too large.')
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

export function V26ValleyRimLayer({ segments, cells }: {
  segments: readonly PublicV26ValleyRimSegment[]; cells: readonly WizardTerrainCell[]
}) {
  const signature = `${segments.map((segment) => `${segment.id}:${segment.from.x},${segment.from.z}`
    + `:${segment.to.x},${segment.to.z}:${segment.ladderAperture ?? false}`).join('|')}`
    + `:${cells.map((cell) => `${cell.id}:${cell.position.join(',')}`).join('|')}`
  // A checked projection may recreate equal arrays every frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => buildV26ValleyRimGeometry(segments, cells), [signature])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={MATERIAL} name="V26 starter valley rock rim"
    castShadow receiveShadow frustumCulled={false} dispose={null} />
}
