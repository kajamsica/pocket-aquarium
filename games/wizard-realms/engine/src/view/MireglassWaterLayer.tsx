import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mireglassFenDepthAt } from '../domain/mireglassTerrain'
import type { WizardTerrainCell } from './contracts'

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
