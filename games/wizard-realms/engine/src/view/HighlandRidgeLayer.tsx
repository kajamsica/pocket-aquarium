import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { highlandRidgeCellAt, highlandRidgeCellAtWorld, HIGHLAND_RIDGE_REVISION } from '../domain/highlandRidge'
import { WORLD_CELL_METERS } from '../domain/worldChunks'
import type { WizardTerrainCell } from './contracts'

const CELL = WORLD_CELL_METERS
const MAX_VISIBLE_CELLS = 289
const ROOF_UNDERSIDE = 7.6 // At least 4.6 m above the clamped maximum 3 m gallery floor.
const ROOF_THICKNESS = 1.4 // The fractured roof crest stays below the nominal ridge top.
const SLATE = ['#989a92', '#aaa79a', '#818d90', '#b4ab9d', '#8c918e'] as const
const EDGES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

type Rock = { x: number; y: number; z: number; height: number; yaw: number; color: string }
type Wall = Rock & { edgeYaw: number; galleryEdge: boolean }
type Roof = { x: number; z: number; color: string }

/** Legacy saves may start inside newly authored rock; keep the escape route visible. */
export function shouldRenderHighlandRidgeFor(playerPosition: readonly [number, number, number]): boolean {
  return highlandRidgeCellAtWorld(playerPosition[0], playerPosition[2]) !== 'rock'
}

/** Cosmetic descriptors only. Neighbor classification never depends on the visible-window boundary. */
export function highlandRidgeInstancesFor(cells: readonly WizardTerrainCell[]): {
  rocks: Rock[]; walls: Wall[]; roofs: Roof[]
} {
  const rocks: Rock[] = []
  const walls: Wall[] = []
  const roofs: Roof[] = []
  for (const cell of cells) {
    if (rocks.length + roofs.length >= MAX_VISIBLE_CELLS || cell.size[0] !== CELL || cell.size[1] !== CELL) continue
    const [x, floor, z] = cell.position
    const kind = highlandRidgeCellAt(x, z)
    if (!kind) continue
    const variant = Math.abs(Math.round(x / CELL) * 13 + Math.round(z / CELL) * 7) % SLATE.length
    if (kind === 'gallery') {
      roofs.push({ x, z, color: SLATE[variant] })
      continue
    }
    const top = Math.max(9.65, 10.7 + Math.sin(x * 0.19 + z * 0.11) * 1.15
      + Math.sin(x * 0.43 - z * 0.27) * 0.65)
    const height = top - floor
    const rock = { x, y: floor + height / 2, z, height,
      yaw: (variant % 4) * Math.PI / 2, color: SLATE[variant] }
    rocks.push(rock)
    for (const [dx, dz] of EDGES) {
      const neighbor = highlandRidgeCellAt(x + dx * CELL, z + dz * CELL)
      if (neighbor === 'rock') continue
      walls.push({ ...rock, x: x + dx * CELL / 2, z: z + dz * CELL / 2,
        edgeYaw: dx === 1 ? Math.PI / 2 : dx === -1 ? -Math.PI / 2 : dz === 1 ? 0 : Math.PI,
        galleryEdge: neighbor === 'gallery' })
    }
  }
  return { rocks, walls, roofs }
}

/** R3F owns each geometry; fixed source vertices keep sculpting idempotent. */
function sourceVertices(geometry: THREE.BoxGeometry): Float32Array {
  if (!geometry.userData.ridgeSource) {
    geometry.userData.ridgeSource = Float32Array.from(geometry.getAttribute('position').array)
  }
  return geometry.userData.ridgeSource as Float32Array
}

function facetRock(geometry: THREE.BoxGeometry): void {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  const source = sourceVertices(geometry)
  for (let index = 0; index < positions.count; index += 1) {
    const x = source[index * 3]
    const y = source[index * 3 + 1]
    const z = source[index * 3 + 2]
    const rise = y + 0.5
    const shoulder = 1 - 0.35 * rise * rise
    positions.setXYZ(index,
      x * shoulder + Math.sin(z * 11 + y * 7) * 0.018 * rise,
      y > 0.2 ? 0.5 + Math.sin(x * 13 + z * 8) * 0.075
        + Math.sin(x * 23 - z * 16) * 0.05 : y,
      z * shoulder + Math.sin(x * 9 - y * 6) * 0.018 * rise)
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()
}

function facetWall(geometry: THREE.BoxGeometry): void {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  const source = sourceVertices(geometry)
  for (let index = 0; index < positions.count; index += 1) {
    const x = source[index * 3]
    const y = source[index * 3 + 1]
    const rise = y + 0.5
    const fracturedFace = 0.26 - 0.8 * rise + Math.sin(x * 13 + y * 19) * 0.11
    positions.setXYZ(index, x * (1 - 0.18 * rise),
      y > 0.4 ? 0.5 + Math.sin(x * 15) * 0.025 : y,
      fracturedFace - (source[index * 3 + 2] < 0 ? 0.19 : 0))
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()
}

function facetRoof(geometry: THREE.BoxGeometry): void {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  const source = sourceVertices(geometry)
  for (let index = 0; index < positions.count; index += 1) {
    const x = source[index * 3]
    const y = source[index * 3 + 1]
    const z = source[index * 3 + 2]
    // The broken lip rises from the clear 7.6 m minimum; no ceiling vertex descends below it.
    positions.setXYZ(index, x * (y > 0 ? 0.92 : 1),
      y < 0 ? -0.5 + (Math.sin(x * 11 + z * 17) + 1) * 0.055
        : 0.5 + Math.sin(x * 13 - z * 9) * 0.07,
      z * (y > 0 ? 0.92 : 1))
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()
}

/** Bounded view-only mass, exposed outer/gallery faces, and a camera-friendly passage roof. */
export function HighlandRidgeLayer({ cells, playerPosition }: {
  cells: readonly WizardTerrainCell[]; playerPosition: readonly [number, number, number]
}) {
  const rockMesh = useRef<THREE.InstancedMesh>(null)
  const wallMesh = useRef<THREE.InstancedMesh>(null)
  const roofMesh = useRef<THREE.InstancedMesh>(null)
  const roofMaterial = useRef<THREE.MeshStandardMaterial>(null)
  const signature = `${HIGHLAND_RIDGE_REVISION}:${cells.map((cell) => `${cell.position.join(',')}:${cell.size.join(',')}`).join('|')}`
  // Projections refresh at 20 Hz; regenerate only when the visible terrain window changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { rocks, walls, roofs } = useMemo(() => highlandRidgeInstancesFor(cells), [signature])
  const showRidge = shouldRenderHighlandRidgeFor(playerPosition)
  useLayoutEffect(() => {
    const transform = new THREE.Object3D()
    const color = new THREE.Color()
    rocks.forEach((rock, index) => {
      if (!rockMesh.current) return
      transform.position.set(rock.x, rock.y, rock.z)
      transform.rotation.set(0, rock.yaw, 0)
      transform.scale.set(CELL + 0.04, rock.height, CELL + 0.04)
      transform.updateMatrix()
      rockMesh.current.setMatrixAt(index, transform.matrix)
      rockMesh.current.setColorAt(index, color.set(rock.color))
    })
    walls.forEach((wall, index) => {
      if (!wallMesh.current) return
      transform.position.set(wall.x, wall.y, wall.z)
      transform.rotation.set(0, wall.edgeYaw, 0)
      transform.scale.set(CELL + 0.04, wall.height, 1)
      transform.updateMatrix()
      wallMesh.current.setMatrixAt(index, transform.matrix)
      wallMesh.current.setColorAt(index, color.set(wall.color).multiplyScalar(wall.galleryEdge ? 1.05 : 0.92))
    })
    roofs.forEach((roof, index) => {
      if (!roofMesh.current) return
      transform.position.set(roof.x, ROOF_UNDERSIDE + ROOF_THICKNESS / 2, roof.z)
      transform.rotation.set(0, index % 4 * Math.PI / 2, 0)
      transform.scale.set(CELL + 0.04, ROOF_THICKNESS, CELL + 0.04)
      transform.updateMatrix()
      roofMesh.current.setMatrixAt(index, transform.matrix)
      roofMesh.current.setColorAt(index, color.set(roof.color))
    })
    for (const mesh of [rockMesh.current, wallMesh.current, roofMesh.current]) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [rocks, walls, roofs, showRidge])
  const inGallery = highlandRidgeCellAtWorld(playerPosition[0], playerPosition[2]) === 'gallery'
  useFrame((_, delta) => {
    if (!roofMaterial.current) return
    roofMaterial.current.opacity = THREE.MathUtils.damp(roofMaterial.current.opacity,
      inGallery ? 0.12 : 1, 8, delta)
  })
  if (!showRidge || rocks.length + roofs.length === 0) return null
  return <group name="Highland ridge and walk-through gallery">
    {rocks.length > 0 && <instancedMesh ref={rockMesh} args={[undefined, undefined, rocks.length]}
      name="Highland faceted slate mass" frustumCulled={false} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1, 3, 2, 3]} onUpdate={facetRock} />
      <meshStandardMaterial color="#ffffff" roughness={0.98} flatShading />
    </instancedMesh>}
    {walls.length > 0 && <instancedMesh ref={wallMesh} args={[undefined, undefined, walls.length]}
      name="Highland exposed rock faces" frustumCulled={false} receiveShadow>
      <boxGeometry args={[1, 1, 0.28, 4, 4, 1]} onUpdate={facetWall} />
      <meshStandardMaterial color="#ffffff" roughness={1} flatShading />
    </instancedMesh>}
    {roofs.length > 0 && <instancedMesh ref={roofMesh} args={[undefined, undefined, roofs.length]}
      name="Highland gallery roof" frustumCulled={false} receiveShadow>
      <boxGeometry args={[1, 1, 1, 3, 1, 3]} onUpdate={facetRoof} />
      <meshStandardMaterial ref={roofMaterial} color="#ffffff" roughness={0.98} flatShading
        transparent opacity={1} depthWrite={false} />
    </instancedMesh>}
  </group>
}
