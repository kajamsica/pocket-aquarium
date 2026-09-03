import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import type { ReefSceneProps } from '../contracts'
import { sampleFlowField, type FlowFieldState } from '../sim/flowField'
import { createProceduralMaterialTextures, type ProceduralMaterialTextures } from './materials/proceduralMaterials'
import { REEF_ROCKS as ROCKS, seededUnit } from './reefLayout'
import { SpecimenFish } from './SpecimenFish'

const TANK_HALF_WIDTH = 2.76
const TANK_HALF_DEPTH = 1.18
const SAND_Y = -1.44
const OPTICAL_INTERIOR_HEIGHT = 3.1
const OPTICAL_SAND_FLOOR_Y = -1.56
const MIN_OPTICAL_LEVEL_RATIO = 0.04
const DYNAMIC_FLOOR_Y = SAND_Y + 0.06
const PARTICLE_SURFACE_CLEARANCE = 0.05
const MICROFAUNA_SURFACE_CLEARANCE = 0.09
const UP = new THREE.Vector3(0, 1, 0)

interface FlowFieldSource {
  readonly current: FlowFieldState
}

interface ReefHabitatProps extends ReefSceneProps {
  readonly flowField: FlowFieldSource
}

interface HabitatMaterials {
  readonly rock: ProceduralMaterialTextures
  readonly sand: ProceduralMaterialTextures
  readonly coral: ProceduralMaterialTextures
}

function waterSurfaceFor(tank: ReefSceneProps['snapshot']['tank']) {
  const footprintSquareMeters = Math.max(tank.widthMeters * tank.depthMeters, 0.001)
  const modeledWaterLevelMeters = THREE.MathUtils.clamp(
    tank.waterVolumeLiters / 1000 / footprintSquareMeters,
    0,
    tank.heightMeters,
  )
  const levelRatio = THREE.MathUtils.clamp(
    modeledWaterLevelMeters / Math.max(tank.heightMeters, 0.001),
    MIN_OPTICAL_LEVEL_RATIO,
    1,
  )
  return OPTICAL_SAND_FLOOR_Y + OPTICAL_INTERIOR_HEIGHT * levelRatio
}

function boundedPathY(
  preferredCenter: number,
  preferredExcursion: number,
  wave: number,
  minimum: number,
  maximum: number,
) {
  if (maximum <= minimum) return maximum
  const excursion = Math.min(Math.max(preferredExcursion, 0), (maximum - minimum) * 0.5)
  const center = THREE.MathUtils.clamp(preferredCenter, minimum + excursion, maximum - excursion)
  return center + THREE.MathUtils.clamp(wave, -1, 1) * excursion
}

function sampleSceneFlow(flowField: FlowFieldSource, x: number, y: number, waterSurfaceY: number) {
  return sampleFlowField(
    flowField.current,
    (x + TANK_HALF_WIDTH) / (TANK_HALF_WIDTH * 2),
    (y - DYNAMIC_FLOOR_Y) / Math.max(waterSurfaceY - DYNAMIC_FLOOR_Y, 0.01),
  )
}

const PORE_PATCHES = Array.from({ length: 32 }, (_, index) => {
  const host = ROCKS[index % ROCKS.length]
  return {
    position: new THREE.Vector3(
      host.position.x + (seededUnit(index, 10) - 0.5) * host.scale.x * 1.2,
      host.position.y + (0.12 + seededUnit(index, 11) * 0.7) * host.scale.y,
      host.position.z + (seededUnit(index, 12) - 0.5) * host.scale.z * 1.2,
    ),
    rotation: new THREE.Euler(
      seededUnit(index, 13) * Math.PI,
      seededUnit(index, 14) * Math.PI,
      seededUnit(index, 15) * Math.PI,
    ),
    scale: 0.025 + seededUnit(index, 16) * 0.065,
  }
})

const CORAL_BRANCHES = [
  [-1.28, -0.92, 0.04, -1.31, -0.34, 0.02],
  [-1.31, -0.62, 0.02, -1.68, -0.18, 0.05],
  [-1.34, -0.58, 0.01, -1.01, -0.07, -0.06],
  [-1.48, -0.45, 0.04, -1.75, 0.0, 0.18],
  [-1.18, -0.37, -0.02, -0.89, 0.12, 0.12],
  [-1.3, -0.34, 0.02, -1.36, 0.22, 0.02],
  [-1.66, -0.2, 0.06, -1.91, 0.18, -0.02],
  [-1.65, -0.2, 0.08, -1.54, 0.29, 0.27],
  [-1.03, -0.12, 0.02, -0.78, 0.31, -0.13],
  [-1.03, -0.12, 0.02, -1.05, 0.36, 0.21],
  [-1.36, 0.08, 0.02, -1.57, 0.45, 0.08],
  [-1.36, 0.08, 0.02, -1.17, 0.51, -0.12],
] as const

const POLYPS = Array.from({ length: 24 }, (_, index) => {
  const angle = index * 2.399963 + seededUnit(index, 20) * 0.16
  const radius = 0.08 + Math.sqrt((index + 0.5) / 24) * 0.38
  return {
    x: 0.86 + Math.cos(angle) * radius,
    y: -0.49 + Math.sqrt(Math.max(0, 0.18 - radius * radius)) * 0.36,
    z: 0.27 + Math.sin(angle) * radius * 0.72,
    phase: seededUnit(index, 21) * Math.PI * 2,
  }
})

type FilmKind = 'diatom' | 'green' | 'cyano'

function SandBed({ material }: { readonly material: ProceduralMaterialTextures }) {
  const moundRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useLayoutEffect(() => {
    const mound = moundRef.current
    if (!mound) return

    for (let index = 0; index < 22; index += 1) {
      dummy.position.set(
        -2.55 + seededUnit(index, 30) * 5.1,
        SAND_Y + 0.012 + seededUnit(index, 31) * 0.026,
        -1.08 + seededUnit(index, 32) * 2.16,
      )
      dummy.rotation.set(0, seededUnit(index, 33) * Math.PI, 0)
      dummy.scale.set(
        0.22 + seededUnit(index, 34) * 0.38,
        0.02 + seededUnit(index, 35) * 0.025,
        0.12 + seededUnit(index, 36) * 0.24,
      )
      dummy.updateMatrix()
      mound.setMatrixAt(index, dummy.matrix)
    }
    mound.instanceMatrix.needsUpdate = true
  }, [dummy])

  return (
    <group>
      <mesh position={[0, SAND_Y - 0.055, 0]} receiveShadow>
        <boxGeometry args={[5.55, 0.12, 2.34]} />
        <meshStandardMaterial
          color="#c7b991"
          map={material.albedoMap}
          normalMap={material.normalMap}
          roughnessMap={material.roughnessMap}
          roughness={0.96}
          metalness={0}
        />
      </mesh>
      <instancedMesh ref={moundRef} args={[undefined, undefined, 22]} receiveShadow>
        <sphereGeometry args={[1, 12, 7]} />
        <meshStandardMaterial
          color="#d6c8a1"
          map={material.albedoMap}
          normalMap={material.normalMap}
          roughnessMap={material.roughnessMap}
          roughness={1}
        />
      </instancedMesh>
    </group>
  )
}

function Rockwork({ material }: { readonly material: ProceduralMaterialTextures }) {
  const rockRef = useRef<THREE.InstancedMesh>(null)
  const poreRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])

  useLayoutEffect(() => {
    const rock = rockRef.current
    const pore = poreRef.current
    if (!rock || !pore) return

    ROCKS.forEach((piece, index) => {
      dummy.position.copy(piece.position)
      dummy.rotation.copy(piece.rotation)
      dummy.scale.copy(piece.scale)
      dummy.updateMatrix()
      rock.setMatrixAt(index, dummy.matrix)
      color.setHSL(0.075 + seededUnit(index, 40) * 0.035, 0.09, 0.25 + seededUnit(index, 41) * 0.08)
      rock.setColorAt(index, color)
    })

    PORE_PATCHES.forEach((patch, index) => {
      dummy.position.copy(patch.position)
      dummy.rotation.copy(patch.rotation)
      dummy.scale.set(patch.scale, patch.scale * 0.28, patch.scale * 0.8)
      dummy.updateMatrix()
      pore.setMatrixAt(index, dummy.matrix)
    })

    rock.instanceMatrix.needsUpdate = true
    pore.instanceMatrix.needsUpdate = true
    if (rock.instanceColor) rock.instanceColor.needsUpdate = true
  }, [color, dummy])

  return (
    <group>
      <instancedMesh ref={rockRef} args={[undefined, undefined, ROCKS.length]} castShadow receiveShadow>
        <icosahedronGeometry args={[1, 2]} />
        <meshStandardMaterial
          color="#635d54"
          map={material.albedoMap}
          normalMap={material.normalMap}
          roughnessMap={material.roughnessMap}
          emissiveMap={material.emissiveMap ?? undefined}
          emissive="#1c071c"
          emissiveIntensity={0.08}
          roughness={0.93}
          vertexColors
        />
      </instancedMesh>
      <instancedMesh ref={poreRef} args={[undefined, undefined, PORE_PATCHES.length]}>
        <sphereGeometry args={[1, 8, 5]} />
        <meshStandardMaterial color="#241f1e" roughness={1} />
      </instancedMesh>
    </group>
  )
}

function BenthicFilm({ kind, coverage, flowPower }: { kind: FilmKind; coverage: number; flowPower: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const maximum = kind === 'green' ? 34 : 28
  const boundedCoverage = THREE.MathUtils.clamp(coverage, 0, 1)
  const lowFlowPocket = kind === 'cyano' ? THREE.MathUtils.lerp(1.18, 0.72, THREE.MathUtils.clamp(flowPower, 0, 1)) : 1
  const visibleCount = Math.round(maximum * THREE.MathUtils.clamp(boundedCoverage * lowFlowPocket, 0, 1))

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.count = visibleCount

    for (let index = 0; index < maximum; index += 1) {
      if (kind === 'green') {
        const host = ROCKS[index % ROCKS.length]
        dummy.position.set(
          host.position.x + (seededUnit(index, 50) - 0.5) * host.scale.x,
          host.position.y + host.scale.y * (0.55 + seededUnit(index, 51) * 0.42),
          host.position.z + (seededUnit(index, 52) - 0.5) * host.scale.z,
        )
        dummy.rotation.set(
          (seededUnit(index, 53) - 0.5) * 0.5,
          seededUnit(index, 54) * Math.PI,
          (seededUnit(index, 55) - 0.5) * 0.42,
        )
        const height = 0.04 + boundedCoverage * (0.13 + seededUnit(index, 56) * 0.14)
        dummy.scale.set(0.018 + seededUnit(index, 57) * 0.024, height, 0.018 + seededUnit(index, 58) * 0.024)
      } else {
        const pocket = index % 3
        const pocketX = [-1.98, 0.56, 1.92][pocket]
        const pocketZ = [-0.74, 0.82, -0.57][pocket]
        const spread = kind === 'cyano' ? 0.5 : 1.1
        dummy.position.set(
          pocketX + (seededUnit(index, 59) - 0.5) * spread,
          SAND_Y + 0.074 + index * 0.0002,
          pocketZ + (seededUnit(index, 60) - 0.5) * spread * 0.62,
        )
        dummy.rotation.set(-Math.PI / 2, 0, seededUnit(index, 61) * Math.PI)
        const size = (0.07 + seededUnit(index, 62) * 0.18) * (0.55 + boundedCoverage * 0.72)
        dummy.scale.set(size, size * (0.52 + seededUnit(index, 63) * 0.46), 1)
      }
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [boundedCoverage, dummy, kind, maximum, visibleCount])

  const color = kind === 'cyano' ? '#651f2b' : kind === 'diatom' ? '#8e6841' : '#315f2f'
  const emissive = kind === 'cyano' ? '#2d0710' : '#07120a'

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, maximum]} receiveShadow={kind !== 'green'} castShadow={kind === 'green'}>
      {kind === 'green' ? <coneGeometry args={[1, 1, 5]} /> : <circleGeometry args={[1, 11]} />}
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={kind === 'cyano' ? 0.24 : 0.06}
        transparent
        opacity={0.5 + boundedCoverage * 0.34}
        roughness={kind === 'cyano' ? 0.7 : 0.96}
        depthWrite={false}
      />
    </instancedMesh>
  )
}

function BranchingCoral({
  health,
  maturity,
  flowField,
  material,
  waterSurfaceY,
}: {
  health: number; maturity: number; flowField: FlowFieldSource
  material: ProceduralMaterialTextures; waterSurfaceY: number
}) {
  const branchRef = useRef<THREE.InstancedMesh>(null)
  const tipRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const direction = useMemo(() => new THREE.Vector3(), [])
  const start = useMemo(() => new THREE.Vector3(), [])
  const end = useMemo(() => new THREE.Vector3(), [])
  const growth = THREE.MathUtils.lerp(0.78, 1, THREE.MathUtils.clamp(maturity, 0, 1))

  useLayoutEffect(() => {
    branchRef.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    tipRef.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  }, [])

  useFrame(({ clock }) => {
    const branch = branchRef.current
    const tip = tipRef.current
    if (!branch || !tip) return
    const elapsed = clock.getElapsedTime()

    CORAL_BRANCHES.forEach((points, index) => {
      start.set(points[0], points[1], points[2])
      end.set(points[3], points[4], points[5])
      const flow = sampleSceneFlow(flowField, end.x, end.y, waterSurfaceY)
      const pulse = Math.sin(elapsed * (0.8 + flow.speedMetersPerSecond * 5) + index * 0.63)
      end.x += flow.xMetersPerSecond * 0.42 + pulse * flow.speedMetersPerSecond * 0.12
      end.y += flow.yMetersPerSecond * 0.34
      direction.subVectors(end, start)
      const length = direction.length() * growth
      direction.normalize()
      dummy.position.copy(start).addScaledVector(direction, length * 0.5)
      dummy.quaternion.setFromUnitVectors(UP, direction)
      const radius = 0.045 + (index % 3) * 0.009
      dummy.scale.set(radius, length, radius)
      dummy.updateMatrix()
      branch.setMatrixAt(index, dummy.matrix)

      dummy.position.copy(start).addScaledVector(direction, length)
      dummy.quaternion.identity()
      dummy.scale.setScalar(radius * 1.28)
      dummy.updateMatrix()
      tip.setMatrixAt(index, dummy.matrix)
    })
    branch.instanceMatrix.needsUpdate = true
    tip.instanceMatrix.needsUpdate = true
  })

  const coralColor = health > 0.55 ? '#c27b8c' : '#a59387'

  return (
    <group>
      <instancedMesh ref={branchRef} args={[undefined, undefined, CORAL_BRANCHES.length]} castShadow>
        <cylinderGeometry args={[1, 1.15, 1, 8]} />
        <meshStandardMaterial
          color={coralColor}
          map={material.albedoMap}
          normalMap={material.normalMap}
          roughnessMap={material.roughnessMap}
          emissiveMap={material.emissiveMap ?? undefined}
          emissive="#551131"
          emissiveIntensity={0.12}
          roughness={0.56}
        />
      </instancedMesh>
      <instancedMesh ref={tipRef} args={[undefined, undefined, CORAL_BRANCHES.length]} castShadow>
        <sphereGeometry args={[1, 9, 7]} />
        <meshStandardMaterial
          color="#e7a6a5"
          map={material.albedoMap}
          normalMap={material.normalMap}
          roughnessMap={material.roughnessMap}
          emissiveMap={material.emissiveMap ?? undefined}
          emissive="#6b183e"
          emissiveIntensity={0.14}
          roughness={0.5}
        />
      </instancedMesh>
    </group>
  )
}

function SoftCoral({
  extension,
  flowField,
  health,
  material,
  waterSurfaceY,
}: {
  extension: number; flowField: FlowFieldSource; health: number
  material: ProceduralMaterialTextures; waterSurfaceY: number
}) {
  const stemRef = useRef<THREE.InstancedMesh>(null)
  const centerRef = useRef<THREE.InstancedMesh>(null)
  const tentacleRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const direction = useMemo(() => new THREE.Vector3(), [])
  const center = useMemo(() => new THREE.Vector3(), [])
  const boundedExtension = THREE.MathUtils.clamp(extension, 0, 1)

  useLayoutEffect(() => {
    stemRef.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    centerRef.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    tentacleRef.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  }, [])

  useFrame(({ clock }) => {
    const stems = stemRef.current
    const centers = centerRef.current
    const tentacles = tentacleRef.current
    if (!stems || !centers || !tentacles) return

    const elapsed = clock.getElapsedTime()
    const stemLength = 0.035 + boundedExtension * 0.16
    const radialReach = 0.012 + boundedExtension * 0.075

    for (let polypIndex = 0; polypIndex < POLYPS.length; polypIndex += 1) {
      const polyp = POLYPS[polypIndex]
      const flow = sampleSceneFlow(flowField, polyp.x, polyp.y, waterSurfaceY)
      const flowAmplitude = 0.004 + flow.speedMetersPerSecond * 0.18
      const flowRate = 0.9 + flow.speedMetersPerSecond * 5
      const swayX = flow.xMetersPerSecond * 0.2 + Math.sin(elapsed * flowRate + polyp.phase) * flowAmplitude
      const swayY = flow.yMetersPerSecond * 0.16
      const swayZ = Math.cos(elapsed * flowRate * 0.82 + polyp.phase) * flowAmplitude * 0.72
      center.set(polyp.x + swayX, polyp.y + stemLength + swayY, polyp.z + swayZ)

      dummy.position.set(polyp.x + swayX * 0.45, polyp.y + stemLength * 0.5, polyp.z + swayZ * 0.45)
      dummy.rotation.set(swayZ * 1.9, 0, -swayX * 1.9)
      dummy.scale.set(0.012, stemLength, 0.012)
      dummy.updateMatrix()
      stems.setMatrixAt(polypIndex, dummy.matrix)

      dummy.position.copy(center)
      dummy.rotation.set(0, polyp.phase, 0)
      dummy.scale.setScalar(0.024 + boundedExtension * 0.012)
      dummy.updateMatrix()
      centers.setMatrixAt(polypIndex, dummy.matrix)

      for (let arm = 0; arm < 6; arm += 1) {
        const angle = (arm / 6) * Math.PI * 2 + polyp.phase * 0.12
        direction.set(
          Math.cos(angle) * radialReach + swayX * 0.7,
          0.009 + boundedExtension * 0.017,
          Math.sin(angle) * radialReach + swayZ * 0.7,
        )
        const length = direction.length()
        direction.normalize()
        dummy.position.copy(center).addScaledVector(direction, length * 0.5)
        dummy.quaternion.setFromUnitVectors(UP, direction)
        dummy.scale.set(0.005, length, 0.005)
        dummy.updateMatrix()
        tentacles.setMatrixAt(polypIndex * 6 + arm, dummy.matrix)
      }
    }

    stems.instanceMatrix.needsUpdate = true
    centers.instanceMatrix.needsUpdate = true
    tentacles.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <mesh position={[0.86, -0.84, 0.27]} castShadow scale={[0.34, 0.43, 0.26]}>
        <sphereGeometry args={[1, 18, 12]} />
        <meshStandardMaterial
          color={health > 0.5 ? '#8d628d' : '#887b7c'}
          map={material.albedoMap}
          normalMap={material.normalMap}
          roughnessMap={material.roughnessMap}
          emissiveMap={material.emissiveMap ?? undefined}
          emissive="#45123e"
          emissiveIntensity={0.1}
          roughness={0.72}
        />
      </mesh>
      <mesh position={[0.86, -0.58, 0.27]} castShadow scale={[0.44, 0.18, 0.33]}>
        <sphereGeometry args={[1, 18, 12]} />
        <meshStandardMaterial color="#a56ca2" map={material.albedoMap} normalMap={material.normalMap} roughness={0.65} />
      </mesh>
      <instancedMesh ref={stemRef} args={[undefined, undefined, POLYPS.length]}>
        <cylinderGeometry args={[1, 1, 1, 5]} />
        <meshStandardMaterial color="#c68ac1" map={material.albedoMap} normalMap={material.normalMap} roughness={0.52} />
      </instancedMesh>
      <instancedMesh ref={centerRef} args={[undefined, undefined, POLYPS.length]}>
        <sphereGeometry args={[1, 7, 5]} />
        <meshStandardMaterial color="#f0a6d0" map={material.albedoMap} emissive="#63204b" emissiveMap={material.emissiveMap ?? undefined} emissiveIntensity={0.16} roughness={0.48} />
      </instancedMesh>
      <instancedMesh ref={tentacleRef} args={[undefined, undefined, POLYPS.length * 6]}>
        <cylinderGeometry args={[1, 0.72, 1, 4]} />
        <meshStandardMaterial color="#df9fc8" map={material.albedoMap} normalMap={material.normalMap} roughness={0.52} />
      </instancedMesh>
    </group>
  )
}

function SuspendedParticles({ flowField, waterSurfaceY }: {
  flowField: FlowFieldSource; waterSurfaceY: number
}) {
  const count = 180
  const geometry = useMemo(() => {
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    const colors = new Float32Array(count * 3)
    const color = new THREE.Color()
    for (let index = 0; index < count; index += 1) {
      color.set(index % 6 === 0 ? '#94704a' : '#c5edf0')
      color.toArray(colors, index * 3)
    }
    buffer.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return buffer
  }, [])
  const base = useMemo(() => {
    const values = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      values[index * 3] = -TANK_HALF_WIDTH + seededUnit(index, 80) * TANK_HALF_WIDTH * 2
      values[index * 3 + 1] = seededUnit(index, 81)
      values[index * 3 + 2] = -TANK_HALF_DEPTH + seededUnit(index, 82) * TANK_HALF_DEPTH * 2
    }
    return values
  }, [])

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame(({ clock }) => {
    const positions = geometry.attributes.position as THREE.BufferAttribute
    const elapsed = clock.getElapsedTime()
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3
      const surfaceLimit = waterSurfaceY - PARTICLE_SURFACE_CLEARANCE
      const detritus = index % 6 === 0
      const verticalSeed = detritus ? base[offset + 1] * 0.22 : base[offset + 1]
      const preferredY = THREE.MathUtils.lerp(DYNAMIC_FLOOR_Y, surfaceLimit, verticalSeed)
      const flow = sampleSceneFlow(flowField, base[offset], preferredY, waterSurfaceY)
      const drift = elapsed * (0.18 + flow.speedMetersPerSecond * 4)
      const x = base[offset]
        + flow.xMetersPerSecond * 0.7
        + Math.sin(drift + index * 1.91) * (0.025 + flow.speedMetersPerSecond * 0.18)
      const y = boundedPathY(
        preferredY + flow.yMetersPerSecond * 0.32,
        detritus ? 0.018 : 0.06,
        Math.sin(elapsed * 0.18 + index * 0.73),
        DYNAMIC_FLOOR_Y,
        surfaceLimit,
      )
      const z = base[offset + 2] + Math.cos(drift * 0.74 + index * 1.17) * 0.04
      positions.setXYZ(index, x, y, z)
    }
    positions.needsUpdate = true
  })

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial vertexColors size={0.012} transparent opacity={0.38} sizeAttenuation depthWrite={false} />
    </points>
  )
}

function Microfauna({ activity, waterSurfaceY }: { activity: number; waterSurfaceY: number }) {
  const maximum = 54
  const segmentsPerAnimal = 3
  const geometry = useMemo(() => {
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maximum * segmentsPerAnimal * 2 * 3), 3))
    return buffer
  }, [])
  const base = useMemo(() => {
    const values = new Float32Array(maximum * 3)
    for (let index = 0; index < maximum; index += 1) {
      values[index * 3] = -2.3 + seededUnit(index, 90) * 4.6
      values[index * 3 + 1] = seededUnit(index, 91)
      values[index * 3 + 2] = -0.98 + seededUnit(index, 92) * 1.96
    }
    return values
  }, [])
  const visibleCount = Math.round(maximum * THREE.MathUtils.clamp(activity, 0, 1))

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame(({ clock }) => {
    const attribute = geometry.attributes.position as THREE.BufferAttribute
    const values = attribute.array as Float32Array
    const elapsed = clock.getElapsedTime()
    geometry.setDrawRange(0, visibleCount * segmentsPerAnimal * 2)

    for (let index = 0; index < visibleCount; index += 1) {
      const source = index * 3
      const target = index * 18
      const pulse = Math.sin(elapsed * (1.6 + activity * 2.4) + index * 2.31)
      const x = base[source] + pulse * 0.035
      const z = base[source + 2] + Math.sin(elapsed * 0.8 + index * 0.31) * 0.018
      const length = 0.014 + seededUnit(index, 93) * 0.014
      const surfaceLimit = waterSurfaceY - MICROFAUNA_SURFACE_CLEARANCE
      const preferredY = THREE.MathUtils.lerp(DYNAMIC_FLOOR_Y, surfaceLimit, base[source + 1])
      const y = boundedPathY(
        preferredY,
        0.027,
        Math.cos(elapsed * 1.1 + index),
        DYNAMIC_FLOOR_Y,
        surfaceLimit,
      )

      values[target] = x
      values[target + 1] = y - length
      values[target + 2] = z
      values[target + 3] = x
      values[target + 4] = y + length
      values[target + 5] = z
      values[target + 6] = x
      values[target + 7] = y + length * 0.55
      values[target + 8] = z
      values[target + 9] = x - length * 0.82
      values[target + 10] = y + length * 1.35
      values[target + 11] = z + length * 0.3
      values[target + 12] = x
      values[target + 13] = y + length * 0.55
      values[target + 14] = z
      values[target + 15] = x + length * 0.82
      values[target + 16] = y + length * 1.35
      values[target + 17] = z - length * 0.3
    }
    attribute.needsUpdate = true
  })

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#e5f6c8" transparent opacity={0.64} depthWrite={false} />
    </lineSegments>
  )
}

function FeedCloud({ pulse, satiation, waterSurfaceY }: { pulse: number; satiation: number; waterSurfaceY: number }) {
  const maximum = 84
  const materialRef = useRef<THREE.PointsMaterial>(null)
  const geometry = useMemo(() => {
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maximum * 3), 3))
    return buffer
  }, [])
  const response = THREE.MathUtils.clamp(pulse * (0.58 + (1 - THREE.MathUtils.clamp(satiation, 0, 1)) * 0.76), 0, 1)
  const visibleCount = Math.round(maximum * response)

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame(({ clock }) => {
    const attribute = geometry.attributes.position as THREE.BufferAttribute
    const elapsed = clock.getElapsedTime()
    geometry.setDrawRange(0, visibleCount)
    for (let index = 0; index < visibleCount; index += 1) {
      const fall = (elapsed * (0.12 + seededUnit(index, 100) * 0.14) + seededUnit(index, 101) * 1.4) % 1.55
      const x = 0.32 + (seededUnit(index, 102) - 0.5) * (0.24 + fall * 0.18)
      const y = THREE.MathUtils.lerp(
        waterSurfaceY - PARTICLE_SURFACE_CLEARANCE,
        DYNAMIC_FLOOR_Y,
        fall / 1.55,
      )
      const z = (seededUnit(index, 103) - 0.5) * (0.22 + fall * 0.16)
      attribute.setXYZ(index, x, y, z)
    }
    attribute.needsUpdate = true
    if (materialRef.current) materialRef.current.opacity = response * 0.9
  })

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial ref={materialRef} color="#d8a35b" size={0.032} transparent opacity={0} depthWrite={false} />
    </points>
  )
}

export function ReefHabitat({ snapshot, flowField }: ReefHabitatProps) {
  const { ecology, equipment, events, livestock } = snapshot
  const waterSurfaceY = waterSurfaceFor(snapshot.tank)
  const hasCoral = livestock.coralHealth > 0
  const materials = useMemo<HabitatMaterials>(() => {
    const created = {
      rock: createProceduralMaterialTextures('reef-rock', { seed: 29 }),
      sand: createProceduralMaterialTextures('aragonite-sand', { seed: 47 }),
      coral: createProceduralMaterialTextures('coral-tissue', { seed: 71 }),
    }
    for (const material of Object.values(created)) {
      for (const texture of [material.albedoMap, material.normalMap, material.roughnessMap, material.emissiveMap]) {
        texture?.repeat.set(4, 4)
      }
    }
    return created
  }, [])

  useEffect(() => () => {
    materials.rock.dispose()
    materials.sand.dispose()
    materials.coral.dispose()
  }, [materials])

  return (
    <group name="living-reef-habitat">
      <SandBed material={materials.sand} />
      <BenthicFilm kind="diatom" coverage={ecology.diatomCoverage} flowPower={equipment.flowPower} />
      <BenthicFilm kind="cyano" coverage={ecology.cyanobacteriaCoverage} flowPower={equipment.flowPower} />
      <Rockwork material={materials.rock} />
      <BenthicFilm kind="green" coverage={ecology.greenAlgaeCoverage} flowPower={equipment.flowPower} />
      {hasCoral && (
        <BranchingCoral
          health={livestock.coralHealth}
          maturity={ecology.maturity}
          flowField={flowField}
          material={materials.coral}
          waterSurfaceY={waterSurfaceY}
        />
      )}
      {hasCoral && (
        <SoftCoral
          extension={ecology.polypExtension}
          flowField={flowField}
          health={livestock.coralHealth}
          material={materials.coral}
          waterSurfaceY={waterSurfaceY}
        />
      )}
      <SpecimenFish snapshot={snapshot} waterSurfaceY={waterSurfaceY} />
      <SuspendedParticles flowField={flowField} waterSurfaceY={waterSurfaceY} />
      <Microfauna activity={ecology.microfaunaActivity} waterSurfaceY={waterSurfaceY} />
      <FeedCloud pulse={events.feedPulse} satiation={livestock.fishSatiation} waterSurfaceY={waterSurfaceY} />
    </group>
  )
}
