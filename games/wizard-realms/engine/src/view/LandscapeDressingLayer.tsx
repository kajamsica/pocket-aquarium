import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { landscapeDressingFor, type LandscapeDetail, type LandscapeDetailKind } from './landscapeDressing'
import type { Vec2, WizardTerrainCell } from './contracts'

// One draw call per silhouette, even when the streamed terrain window holds hundreds of details.
const GROUND_GEOMETRY = new THREE.CircleGeometry(1, 7)
GROUND_GEOMETRY.rotateX(-Math.PI / 2)
function bladeCluster(radius: number, height: number) {
  const blades = ([[-0.23, 0, 0.78, -0.18], [0.15, 0.1, 1, 0.16], [0.08, -0.18, 0.65, -0.09]] as const)
    .map(([x, z, length, lean]) => {
      const geometry = new THREE.ConeGeometry(radius, height * length, 3)
      geometry.rotateZ(lean)
      geometry.translate(x, height * length / 2, z)
      return geometry
    })
  const cluster = mergeGeometries(blades)
  blades.forEach((blade) => blade.dispose())
  if (!cluster) throw new Error('Landscape blade geometry could not be merged.')
  return cluster
}
const GRASS_GEOMETRY = bladeCluster(0.16, 1)
const FLOWER_GEOMETRY = new THREE.IcosahedronGeometry(0.16, 0)
FLOWER_GEOMETRY.translate(0, 0.55, 0)
const SHRUB_LOBES = ([[-0.27, 0.5, 0.02, 0.58], [0.28, 0.62, -0.12, 0.7], [0.01, 0.81, 0.21, 0.55]] as const)
  .map(([x, y, z, radius]) => new THREE.IcosahedronGeometry(radius, 0).translate(x, y, z))
const SHRUB_GEOMETRY = mergeGeometries(SHRUB_LOBES)
SHRUB_LOBES.forEach((lobe) => lobe.dispose())
if (!SHRUB_GEOMETRY) throw new Error('Landscape shrub geometry could not be merged.')
const STONE_GEOMETRY = new THREE.DodecahedronGeometry(0.7, 0)
STONE_GEOMETRY.translate(0, 0.28, 0)
const REED_GEOMETRY = bladeCluster(0.075, 1.5)
const SNAG_PARTS = [
  new THREE.CylinderGeometry(0.09, 0.28, 3.4, 5).rotateZ(0.08).translate(0, 1.7, 0),
  new THREE.CylinderGeometry(0.05, 0.12, 1.25, 4).rotateZ(-0.8).translate(0.4, 2.52, 0),
  new THREE.CylinderGeometry(0.04, 0.1, 0.95, 4).rotateZ(0.9).translate(-0.34, 2.12, 0.08),
]
const SNAG_GEOMETRY = mergeGeometries(SNAG_PARTS)
SNAG_PARTS.forEach((part) => part.dispose())
if (!SNAG_GEOMETRY) throw new Error('Landscape snag geometry could not be merged.')
const ALDER_TRUNK_GEOMETRY = new THREE.CylinderGeometry(0.1, 0.19, 2.9, 6)
ALDER_TRUNK_GEOMETRY.translate(0, 1.45, 0)
const ALDER_CROWNS = ([[-0.42, 2.5, 0.06, 0.68], [0.34, 2.7, -0.13, 0.74], [0.02, 3.12, 0.12, 0.57]] as const)
  .map(([x, y, z, radius]) => new THREE.IcosahedronGeometry(radius, 1).translate(x, y, z))
const ALDER_CROWN_GEOMETRY = mergeGeometries(ALDER_CROWNS)
ALDER_CROWNS.forEach((crown) => crown.dispose())
if (!ALDER_CROWN_GEOMETRY) throw new Error('Landscape alder crown geometry could not be merged.')
const MATERIAL = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94, flatShading: true, side: THREE.DoubleSide })
const ALDER_BARK_MATERIAL = new THREE.MeshStandardMaterial({ color: '#62513d', roughness: 1, flatShading: true })
const KINDS = ['ground', 'grass', 'flower', 'shrub', 'stone', 'reed', 'snag'] as const satisfies readonly LandscapeDetailKind[]
const GEOMETRY: Record<LandscapeDetailKind, THREE.BufferGeometry> = {
  ground: GROUND_GEOMETRY,
  grass: GRASS_GEOMETRY,
  flower: FLOWER_GEOMETRY,
  shrub: SHRUB_GEOMETRY,
  stone: STONE_GEOMETRY,
  reed: REED_GEOMETRY,
  snag: SNAG_GEOMETRY,
  alder: ALDER_CROWN_GEOMETRY,
}

function LandscapeInstances({ kind, details }: { kind: LandscapeDetailKind; details: readonly LandscapeDetail[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const instances = useMemo(() => details.filter((detail) => detail.kind === kind), [details, kind])
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const transform = new THREE.Object3D()
    const color = new THREE.Color()
    instances.forEach((detail, index) => {
      transform.position.set(detail.position[0], detail.position[1] + (kind === 'ground' ? 0.012 : 0.005), detail.position[2])
      transform.rotation.set(0, detail.yaw, 0)
      transform.scale.setScalar(detail.scale)
      transform.updateMatrix()
      mesh.setMatrixAt(index, transform.matrix)
      mesh.setColorAt(index, color.set(detail.color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [instances, kind])
  if (instances.length === 0) return null
  return <instancedMesh ref={meshRef} args={[GEOMETRY[kind], MATERIAL, instances.length]}
    name={`Landscape ${kind}`} frustumCulled={false}
    castShadow={kind === 'shrub' || kind === 'stone' || kind === 'snag'} receiveShadow={kind === 'ground'} />
}

function AlderInstances({ details }: { details: readonly LandscapeDetail[] }) {
  const trunks = useRef<THREE.InstancedMesh>(null)
  const crowns = useRef<THREE.InstancedMesh>(null)
  const instances = useMemo(() => details.filter((detail) => detail.kind === 'alder'), [details])
  useLayoutEffect(() => {
    if (!trunks.current || !crowns.current) return
    const transform = new THREE.Object3D()
    const color = new THREE.Color()
    instances.forEach((detail, index) => {
      transform.position.set(detail.position[0], detail.position[1], detail.position[2])
      transform.rotation.set(0, detail.yaw, 0)
      transform.scale.setScalar(detail.scale)
      transform.updateMatrix()
      trunks.current!.setMatrixAt(index, transform.matrix)
      crowns.current!.setMatrixAt(index, transform.matrix)
      crowns.current!.setColorAt(index, color.set(detail.color))
    })
    trunks.current.instanceMatrix.needsUpdate = true
    crowns.current.instanceMatrix.needsUpdate = true
    if (crowns.current.instanceColor) crowns.current.instanceColor.needsUpdate = true
  }, [instances])
  if (instances.length === 0) return null
  return <group name="Cosmetic alder saplings">
    <instancedMesh ref={trunks} args={[ALDER_TRUNK_GEOMETRY, ALDER_BARK_MATERIAL, instances.length]}
      frustumCulled={false} castShadow />
    <instancedMesh ref={crowns} args={[ALDER_CROWN_GEOMETRY, MATERIAL, instances.length]}
      frustumCulled={false} castShadow />
  </group>
}

/** Pure scenery: no raycast targets, collisions, resource yields, or save fields. */
export function LandscapeDressing({ cells, clearings }: { cells: readonly WizardTerrainCell[]; clearings: readonly Vec2[] }) {
  const signature = cells.map((cell) => [cell.id, cell.position.join(','), cell.size.join(','), cell.climate, cell.mireglassTerrain,
    cell.mireglassApproach, cell.mireglassTrailSegment?.from.join(','), cell.mireglassTrailSegment?.to.join(','),
    cell.highlandSurface, cell.highlandTrailSegment?.from.join(','), cell.highlandTrailSegment?.to.join(','),
    cell.highlandRidgeCell].join(':')).join('|')
    + '::' + clearings.map((point) => point.join(',')).join('|')
  // Projections refresh at 20 Hz. Regenerate only when the visible terrain or a surface changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const details = useMemo(() => landscapeDressingFor(cells, clearings), [signature])
  return <group name="Cosmetic landscape dressing">
    {KINDS.map((kind) => <LandscapeInstances key={kind} kind={kind} details={details} />)}
    <AlderInstances details={details} />
  </group>
}
