import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mireglassPlateauAt } from '../domain/mireglassTerrain'
import { WORLD_CELL_METERS } from '../domain/worldChunks'
import type { WizardTerrainCell } from './contracts'

type CliffFace = { x: number; y: number; z: number; yaw: number; rise: number; color: string }
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
const SLATE = ['#737574', '#656e70', '#7b7770', '#6b7175'] as const

/** Only the visible, authoritative high-to-low seams receive a cosmetic rock face. */
export function mireglassCliffFacesFor(seed: string, cells: readonly WizardTerrainCell[]): CliffFace[] {
  const byPosition = new Map(cells.map((cell) => [`${cell.position[0]}:${cell.position[2]}`, cell]))
  const faces: CliffFace[] = []
  for (const cell of cells) {
    const [x, y, z] = cell.position
    if (!mireglassPlateauAt(seed, x, z)) continue
    for (const [dx, dz] of NEIGHBORS) {
      const nextX = x + dx * WORLD_CELL_METERS
      const nextZ = z + dz * WORLD_CELL_METERS
      const lower = byPosition.get(`${nextX}:${nextZ}`)
      if (!lower || mireglassPlateauAt(seed, nextX, nextZ)) continue
      const rise = y - lower.position[1]
      if (rise < 0.8) continue
      // Recess the fascia into the upper tile. The short ladder run stays in front of the face.
      faces.push({
        x: (x + nextX) / 2 - dx * 0.02,
        y: (y + lower.position[1]) / 2,
        z: (z + nextZ) / 2 - dz * 0.02,
        yaw: dx === 0 ? 0 : Math.PI / 2,
        rise,
        color: SLATE[Math.abs(Math.round(x / WORLD_CELL_METERS) * 3
          + Math.round(z / WORLD_CELL_METERS) + dx * 2 + dz) % SLATE.length],
      })
    }
  }
  return faces
}

/** R3F owns and disposes this geometry; the sculpt is idempotent across updates. */
function sculptRockFace(geometry: THREE.BoxGeometry): void {
  const vertices = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < vertices.count; index += 1) {
    const x = vertices.getX(index)
    const y = vertices.getY(index)
    const side = Math.sign(vertices.getZ(index))
    vertices.setZ(index, side * 0.08 + Math.sin(x * 18 + y * 9) * 0.07)
  }
  vertices.needsUpdate = true
  geometry.computeVertexNormals()
}

/** Bounded instancing, at most four faces per visible cell; no collision or save state. */
export function MireglassCliffLayer({ seed, cells }: { seed: string; cells: readonly WizardTerrainCell[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  // The projection slices a new visible array at 20 Hz; only changed cells rebuild descriptors.
  const signature = `${seed}:${cells.map((cell) => cell.position.join(',')).join('|')}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const faces = useMemo(() => mireglassCliffFacesFor(seed, cells), [signature])
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const transform = new THREE.Object3D()
    const color = new THREE.Color()
    faces.forEach((face, index) => {
      transform.position.set(face.x, face.y, face.z)
      transform.rotation.set(0, face.yaw, 0)
      transform.scale.set(WORLD_CELL_METERS, face.rise, 1)
      transform.updateMatrix()
      mesh.setMatrixAt(index, transform.matrix)
      mesh.setColorAt(index, color.set(face.color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [faces])
  if (faces.length === 0) return null
  return <instancedMesh ref={meshRef} args={[undefined, undefined, faces.length]}
    name="Mireglass cosmetic slate escarpment" frustumCulled={false} receiveShadow>
    <boxGeometry args={[1, 1, 0.16, 4, 2, 1]} onUpdate={sculptRockFace} />
    <meshStandardMaterial color="#ffffff" roughness={0.98} flatShading />
  </instancedMesh>
}
