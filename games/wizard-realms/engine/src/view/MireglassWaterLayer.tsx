import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mireglassFenDepthAt } from '../domain/mireglassTerrain'
import { PUBLIC_V15_STARTER_CREEK_BOUNDS } from '../domain/publicWorldV15StarterSites'
import { publicWorldV16TileAtGrid } from '../domain/publicWorldV16GreenwaySites'
import { publicV25RiverCellAtGrid } from '../domain/publicWorldV25River'
import { WORLD_GRID_MAX, WORLD_GRID_MIN } from '../domain/worldChunks'
import type { WizardTerrainCell } from './contracts'
import { buildTerrainSurfaceGeometry, terrainSignature } from './TerrainSurfaceLayer'

const CELL_METERS = 4
// The canonical fen caps are 0.54 m (deep) and 0.90 m (shallow); dry banks are 1.20 m.
const WATER_Y = 1.03
const SHALLOW_COLOR = new THREE.Color('#4c9292')
const DEEP_COLOR = new THREE.Color('#33717c')

export function mireglassWaterTilesFor(seed: string, cells: readonly WizardTerrainCell[]) {
  const tiles: { x: number; z: number; depth: 'shallow' | 'deep' }[] = []
  for (const cell of cells) {
    if (cell.size[0] !== CELL_METERS || cell.size[1] !== CELL_METERS) continue
    const [x, , z] = cell.position
    const depth = mireglassFenDepthAt(seed, x, z)
    if (depth) tiles.push({ x, z, depth })
  }
  return tiles
}

type WaterTile = ReturnType<typeof mireglassWaterTilesFor>[number]

function WaterInstances({ tiles }: { tiles: readonly WaterTile[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const transform = new THREE.Object3D()
    transform.rotation.x = -Math.PI / 2
    tiles.forEach(({ x, z, depth }, index) => {
      transform.position.set(x, WATER_Y, z)
      transform.updateMatrix()
      mesh.setMatrixAt(index, transform.matrix)
      mesh.setColorAt(index, depth === 'deep' ? DEEP_COLOR : SHALLOW_COLOR)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [tiles])
  return <instancedMesh ref={meshRef} args={[undefined, undefined, tiles.length]}
    name="Mireglass fen water" frustumCulled={false} receiveShadow>
    <planeGeometry args={[CELL_METERS, CELL_METERS]} />
    <meshStandardMaterial color="#ffffff" roughness={0.32} metalness={0.08}
      emissive="#173d43" emissiveIntensity={0.12} />
  </instancedMesh>
}

/** View-only river skin over exactly the authored, movement-blocking fen cells. */
export function MireglassWaterLayer({ seed, cells }: { seed: string; cells: readonly WizardTerrainCell[] }) {
  const signature = `${seed}:${cells.map((cell) => `${cell.position[0]},${cell.position[2]},${cell.size[0]},${cell.size[1]}`).join('|')}`
  // Projections refresh at 20 Hz; instance buffers only change when the visible cell window changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tiles = useMemo(() => mireglassWaterTilesFor(seed, cells), [signature])
  return tiles.length > 0 ? <WaterInstances tiles={tiles} /> : null
}

/** Only the five canonical wet cells occupy the v17 creek's physical bounds. */
export function greenwayCreekWaterCellsFor(seed: string, cells: readonly WizardTerrainCell[]) {
  const { minX, maxX, nearZ, farZ } = PUBLIC_V15_STARTER_CREEK_BOUNDS
  return cells.filter((cell) => {
    const [x, y, z] = cell.position
    if (cell.size[0] !== CELL_METERS || cell.size[1] !== CELL_METERS
      || !Number.isInteger(x / CELL_METERS) || !Number.isInteger(z / CELL_METERS)
      || x <= minX || x > maxX || z <= nearZ || z > farZ) return false
    const tile = publicWorldV16TileAtGrid(seed, x / CELL_METERS, z / CELL_METERS)
    return tile.terrain === 'wetland' && tile.id === cell.id && tile.center.y === y
  })
}

/** The caller supplies the bounded revealed window; only canonical V25 wet cells receive water. */
export function v25RiverWaterCellsFor(seed: string, cells: readonly WizardTerrainCell[]) {
  return cells.filter((cell) => {
    const [x, , z] = cell.position
    if (cell.size[0] !== CELL_METERS || cell.size[1] !== CELL_METERS
      || !Number.isInteger(x / CELL_METERS) || !Number.isInteger(z / CELL_METERS)) return false
    const gx = x / CELL_METERS, gz = z / CELL_METERS
    return gx >= WORLD_GRID_MIN && gx <= WORLD_GRID_MAX
      && gz >= WORLD_GRID_MIN && gz <= WORLD_GRID_MAX
      && publicV25RiverCellAtGrid(seed, gx, gz)
  })
}

/** Follow the same terrain fan as the banks, raised just enough to avoid z-fighting. */
export function GreenwayCreekWaterLayer({ seed, cells, allCells, appearanceFor, v25RiverActive = false }: {
  seed: string; cells: readonly WizardTerrainCell[]; allCells: readonly WizardTerrainCell[]
  appearanceFor: (cell: WizardTerrainCell) => { top: THREE.Color; side: THREE.Color }
  v25RiverActive?: boolean
}) {
  const signature = `${v25RiverActive}:${seed}:${cells.map((cell) => cell.id).join('|')}:${terrainSignature(allCells)}`
  // The visible projection refreshes at 20 Hz; geometry changes only with discovery or terrain.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wetCells = useMemo(() => v25RiverActive
    ? v25RiverWaterCellsFor(seed, cells) : greenwayCreekWaterCellsFor(seed, cells), [signature])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => {
    if (!wetCells.length) return null
    const { top, sides } = buildTerrainSurfaceGeometry(seed, wetCells, allCells, appearanceFor)
    sides.dispose()
    return top
  }, [signature, appearanceFor])
  useLayoutEffect(() => () => { geometry?.dispose() }, [geometry])
  return geometry ? <mesh geometry={geometry} name="Greenway creek water"
    position={[0, 0.03, 0]} frustumCulled={false} receiveShadow dispose={null}>
    <meshStandardMaterial color="#4c9fa8" roughness={0.3} metalness={0.08}
      emissive="#173d43" emissiveIntensity={0.14} />
  </mesh> : null
}
