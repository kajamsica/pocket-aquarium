import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { landscapeDressingFor, type LandscapeDetail, type LandscapeDetailKind } from './landscapeDressing'
import type { Vec2, WizardTerrainCell } from './contracts'

// One draw call per silhouette, even when the streamed terrain window holds hundreds of details.
function shade(geometry: THREE.BufferGeometry, base: number, top = base) {
  const positions = geometry.getAttribute('position')
  const colors = new Float32Array(positions.count * 3)
  for (let index = 0; index < positions.count; index += 1) {
    const tone = base + (top - base) * Math.max(0, Math.min(1, positions.getY(index)))
    colors.fill(tone, index * 3, index * 3 + 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}
const GROUND_GEOMETRY = new THREE.CircleGeometry(1, 12)
GROUND_GEOMETRY.rotateX(-Math.PI / 2)
const groundPositions = GROUND_GEOMETRY.getAttribute('position') as THREE.BufferAttribute
const groundColors = new Float32Array(groundPositions.count * 3)
for (let index = 0; index < groundPositions.count; index += 1) {
  const angle = Math.atan2(groundPositions.getZ(index), groundPositions.getX(index))
  const radius = index === 0 ? 0 : 0.76 + 0.11 * Math.sin(3 * angle + 0.6) + 0.05 * Math.cos(5 * angle)
  groundPositions.setX(index, groundPositions.getX(index) * radius * (1 + 0.08 * Math.sin(2 * angle)))
  groundPositions.setZ(index, groundPositions.getZ(index) * radius)
  groundColors.fill(index === 0 ? 0.92 : 1.02 + 0.03 * Math.sin(4 * angle), index * 3, index * 3 + 3)
}
GROUND_GEOMETRY.setAttribute('color', new THREE.BufferAttribute(groundColors, 3))
GROUND_GEOMETRY.computeVertexNormals()
function bladeCluster(radius: number, height: number) {
  const blades = Array.from({ length: 6 }, (_, index) => {
      const yaw = index * Math.PI / 3 + 0.2
      const length = 0.72 + 0.25 * Math.sin(index * 2.1)
      const bladeHeight = height * length
      const geometry = new THREE.PlaneGeometry(radius * 2, bladeHeight, 1, 3)
      const positions = geometry.getAttribute('position') as THREE.BufferAttribute
      for (let index = 0; index < positions.count; index += 1) {
        const progress = positions.getY(index) / bladeHeight + 0.5
        positions.setXYZ(index, positions.getX(index) * (1 - 0.86 * progress) + radius * 0.55 * progress ** 2,
          positions.getY(index) + bladeHeight / 2, radius * 0.18 * progress ** 2)
      }
      geometry.rotateY(yaw)
      geometry.translate(Math.cos(yaw) * radius * 0.55, 0, Math.sin(yaw) * radius * 0.55)
      geometry.computeVertexNormals()
      return shade(geometry, 0.68 + index * 0.035, 1.04 + index * 0.025)
    })
  const cluster = mergeGeometries(blades)
  blades.forEach((blade) => blade.dispose())
  if (!cluster) throw new Error('Landscape blade geometry could not be merged.')
  return cluster
}
const GRASS_GEOMETRY = bladeCluster(0.21, 1.15)
const FLOWER_PARTS = [
  shade(new THREE.CylinderGeometry(0.012, 0.02, 0.5, 4).translate(0, 0.25, 0), 0.62, 0.82),
  ...[0.94, 1.06, 0.98, 1.1, 1.02].map((tone, index) => {
    const angle = index * Math.PI * 2 / 5
    return shade(new THREE.CircleGeometry(0.06, 6).rotateX(-Math.PI / 2).scale(0.9, 1, 1.05).rotateY(angle)
      .translate(Math.cos(angle) * 0.08, 0.55, Math.sin(angle) * 0.08), tone)
  }),
  shade(new THREE.SphereGeometry(0.035, 5, 2).translate(0, 0.57, 0), 0.74),
]
const FLOWER_GEOMETRY = mergeGeometries(FLOWER_PARTS)
FLOWER_PARTS.forEach((part) => part.dispose())
if (!FLOWER_GEOMETRY) throw new Error('Landscape flower geometry could not be merged.')
const SHRUB_LOBES = ([[-0.34, 0.47, 0.02, 0.58, 0.88], [0.31, 0.53, -0.12, 0.65, 1],
  [0.01, 0.78, 0.17, 0.61, 1.12], [-0.06, 0.4, -0.38, 0.48, 0.94],
  [0.25, 0.38, 0.32, 0.45, 1.06]] as const)
  .map(([x, y, z, radius, tone]) => shade(new THREE.SphereGeometry(radius, 6, 3)
    .scale(0.92, 0.68, 0.86).translate(x, y, z), tone * 0.8, tone * 1.08))
const SHRUB_GEOMETRY = mergeGeometries(SHRUB_LOBES)
SHRUB_LOBES.forEach((lobe) => lobe.dispose())
if (!SHRUB_GEOMETRY) throw new Error('Landscape shrub geometry could not be merged.')
const STONE_PARTS = ([[-0.22, 0.29, 0.02, 0.55, 0.45, 0.5],
  [0.37, 0.19, 0.1, 0.43, 0.27, 0.37], [-0.05, 0.15, -0.35, 0.42, 0.22, 0.31]] as const)
  .map(([x, y, z, width, height, depth], index) => shade(new THREE.DodecahedronGeometry(1, 0)
    .scale(width, height, depth).rotateY(index * 0.6).translate(x, y, z), 0.72 + index * 0.07, 1.08))
const STONE_GEOMETRY = mergeGeometries(STONE_PARTS)
STONE_PARTS.forEach((part) => part.dispose())
if (!STONE_GEOMETRY) throw new Error('Landscape stone geometry could not be merged.')
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
const DRESSING_MATERIAL = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94, flatShading: true,
  vertexColors: true, side: THREE.DoubleSide })
const GROUND_MATERIAL = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, vertexColors: true,
  transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide })
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
  return <instancedMesh ref={meshRef} args={[GEOMETRY[kind], kind === 'snag' ? MATERIAL
    : kind === 'ground' ? GROUND_MATERIAL : DRESSING_MATERIAL, instances.length]}
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
