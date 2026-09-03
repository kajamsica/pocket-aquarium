import { useFrame, useLoader } from '@react-three/fiber'
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'

import type { ReefSnapshot } from '../contracts'
import type { PocketSpecimen } from '../integration/pocketAquariumBridge'

const MAX_SPECIMENS = 24
const TANK_HALF_WIDTH = 2.76
const SAND_Y = -1.44
const MARINE_SPECIES = new Set(['ocellaris', 'watchman_goby', 'pistol_shrimp', 'epaulette_shark'])

const VISUAL_ASSETS = {
  ocellaris: {
    url: new URL('../../../assets/animals/ocellaris-clownfish-v2.png', import.meta.url).href,
    image: [1536, 1024],
    crop: [89, 195, 1384, 832],
  },
  watchman_goby: {
    url: new URL('../../../assets/animals/yellow-watchman-goby-v1.png', import.meta.url).href,
    image: [1536, 1024],
    crop: [57, 223, 1453, 732],
  },
} as const

const SpecimenRosterContext = createContext<readonly PocketSpecimen[]>([])

export function SpecimenRosterProvider({ specimens, children }: {
  readonly specimens: readonly PocketSpecimen[]
  readonly children: ReactNode
}) {
  return <SpecimenRosterContext.Provider value={specimens}>{children}</SpecimenRosterContext.Provider>
}

export interface SpecimenFishProps {
  readonly snapshot: ReefSnapshot
  readonly waterSurfaceY: number
}

function seededUnit(id: number, salt: number) {
  const value = Math.sin((id + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function cropTexture(source: THREE.Texture, asset: (typeof VISUAL_ASSETS)[keyof typeof VISUAL_ASSETS]) {
  const texture = source.clone()
  const [imageWidth, imageHeight] = asset.image
  const [left, top, right, bottom] = asset.crop
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.offset.set(left / imageWidth, 1 - (bottom + 1) / imageHeight)
  texture.repeat.set((right - left + 1) / imageWidth, (bottom - top + 1) / imageHeight)
  texture.needsUpdate = true
  return texture
}

function SpecimenCard({ speciesId, texture, exposure }: {
  readonly speciesId: 'ocellaris' | 'watchman_goby'
  readonly texture: THREE.Texture
  readonly exposure: number
}) {
  const asset = VISUAL_ASSETS[speciesId]
  const visibleWidth = asset.crop[2] - asset.crop[0] + 1
  const visibleHeight = asset.crop[3] - asset.crop[1] + 1
  return (
    <mesh name={`${speciesId}-cutout`} scale={[1, visibleHeight / visibleWidth, 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={texture}
        color={new THREE.Color(exposure, exposure, exposure)}
        alphaTest={0.5}
        alphaToCoverage
        transparent={false}
        depthTest
        depthWrite
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  )
}

const SHARK_SHAPE = new THREE.Shape()
SHARK_SHAPE.moveTo(0.5, 0)
SHARK_SHAPE.bezierCurveTo(0.48, 0.14, 0.3, 0.17, 0.06, 0.13)
SHARK_SHAPE.lineTo(-0.27, 0.09)
SHARK_SHAPE.lineTo(-0.48, 0.22)
SHARK_SHAPE.lineTo(-0.43, 0.04)
SHARK_SHAPE.lineTo(-0.52, 0)
SHARK_SHAPE.lineTo(-0.43, -0.04)
SHARK_SHAPE.lineTo(-0.48, -0.19)
SHARK_SHAPE.lineTo(-0.27, -0.08)
SHARK_SHAPE.lineTo(0.08, -0.12)
SHARK_SHAPE.bezierCurveTo(0.32, -0.15, 0.48, -0.1, 0.5, 0)

function EpauletteSharkFallback() {
  return (
    <group name="epaulette-shark-procedural">
      <mesh castShadow receiveShadow>
        <extrudeGeometry args={[SHARK_SHAPE, { depth: 0.045, bevelEnabled: true, bevelSize: 0.016, bevelThickness: 0.012, bevelSegments: 2 }]} />
        <meshStandardMaterial color="#9b815d" roughness={0.68} />
      </mesh>
      <mesh position={[0.12, -0.13, 0.045]} rotation={[0, 0, -0.45]} scale={[0.2, 0.08, 1]} castShadow>
        <circleGeometry args={[1, 3]} />
        <meshStandardMaterial color="#876d4c" roughness={0.72} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0.08, 0.105, 0.051]} scale={[0.075, 0.075, 1]}>
        <ringGeometry args={[0.42, 1, 24]} />
        <meshStandardMaterial color="#efe5c5" roughness={0.58} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0.08, 0.105, 0.053]} scale={[0.035, 0.035, 1]}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial color="#171611" />
      </mesh>
    </group>
  )
}

const SHRIMP_SEGMENTS = [0, 1, 2, 3, 4] as const

function PistolShrimpFallback() {
  return (
    <group name="pistol-shrimp-procedural" scale={1.25}>
      {SHRIMP_SEGMENTS.map((segment) => (
        <mesh key={segment} position={[-0.04 - segment * 0.105, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.075 - segment * 0.007, 0.082 - segment * 0.006, 0.13, 8]} />
          <meshStandardMaterial color={segment % 2 ? '#d6b58d' : '#76513f'} roughness={0.62} />
        </mesh>
      ))}
      <mesh position={[0.13, 0, 0]} scale={[0.19, 0.11, 0.11]} castShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#9a6a50" roughness={0.58} />
      </mesh>
      <mesh position={[0.32, 0.09, 0]} rotation={[0, 0, -0.12]} scale={[0.2, 0.075, 0.1]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#c8996c" roughness={0.54} />
      </mesh>
      <mesh position={[0.48, 0.105, 0]} rotation={[0, 0, 0.25]} scale={[0.14, 0.045, 0.08]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#e1b486" roughness={0.5} />
      </mesh>
      {[-1, 1].flatMap((side) => [0, 1, 2].map((leg) => (
        <mesh key={`${side}-${leg}`} position={[0.1 - leg * 0.1, -0.1, side * 0.035]}
          rotation={[side * 0.35, 0, side * 0.75]} scale={[0.015, 0.16, 0.015]}>
          <cylinderGeometry args={[1, 0.75, 1, 5]} />
          <meshStandardMaterial color="#c79b77" roughness={0.66} />
        </mesh>
      )))}
    </group>
  )
}

function RenderedSpecimen({ specimen, snapshot, waterSurfaceY, textures }: {
  readonly specimen: PocketSpecimen
  readonly snapshot: ReefSnapshot
  readonly waterSurfaceY: number
  readonly textures: Readonly<Record<'ocellaris' | 'watchman_goby', THREE.Texture>>
}) {
  const group = useRef<THREE.Group>(null)
  const phase = seededUnit(specimen.id, 1) * Math.PI * 2
  const anchorX = THREE.MathUtils.lerp(-TANK_HALF_WIDTH * 0.72, TANK_HALF_WIDTH * 0.72, specimen.x)
  const anchorZ = THREE.MathUtils.lerp(-0.68, 0.68, seededUnit(specimen.id, 2))
  const isBenthic = specimen.layer === 'bottom' || specimen.speciesId === 'epaulette_shark'
  const clearance = specimen.speciesId === 'pistol_shrimp' ? 0.055 : specimen.speciesId === 'epaulette_shark' ? 0.13 : 0.18
  const openWaterY = THREE.MathUtils.lerp(SAND_Y + 0.48, waterSurfaceY - 0.34, 1 - specimen.y)
  const anchorY = isBenthic ? SAND_Y + clearance : THREE.MathUtils.clamp(openWaterY, SAND_Y + 0.38, waterSurfaceY - 0.28)
  const sceneUnitsPerMeter = (TANK_HALF_WIDTH * 2) / Math.max(snapshot.tank.widthMeters, 0.4)
  const lifeScale = specimen.stage === 'adult' ? 1 : 0.68
  const length = THREE.MathUtils.clamp(specimen.adultSizeCm / 100 * sceneUnitsPerMeter * lifeScale, 0.16, 3.7)
  const exposure = THREE.MathUtils.clamp(0.72 + snapshot.lightField.localPpfd / 900, 0.72, 1)

  useFrame(({ clock }) => {
    const node = group.current
    if (!node) return
    const benthicFactor = isBenthic ? 0.28 : 1
    const speed = (0.34 + seededUnit(specimen.id, 3) * 0.13) * (specimen.speciesId === 'epaulette_shark' ? 0.42 : 1)
    const wave = clock.getElapsedTime() * speed + phase
    const feedDrive = THREE.MathUtils.clamp(snapshot.events.feedPulse * specimen.hunger, 0, 0.8)
    const roamingX = anchorX + Math.sin(wave) * 0.38 * benthicFactor
    const roamingY = anchorY + Math.sin(wave * 0.71) * 0.12 * benthicFactor
    const roamingZ = anchorZ + Math.cos(wave * 0.83) * 0.18 * benthicFactor
    const x = THREE.MathUtils.lerp(roamingX, 0, feedDrive)
    const y = isBenthic ? anchorY : THREE.MathUtils.lerp(roamingY, waterSurfaceY - 0.42, feedDrive)
    const z = THREE.MathUtils.lerp(roamingZ, 0.12, feedDrive)
    const direction = Math.cos(wave) + (0 - roamingX) * feedDrive >= 0 ? 1 : -1
    node.position.set(x, Math.min(y, waterSurfaceY - 0.2), z)
    node.rotation.set(0, THREE.MathUtils.clamp(-Math.sin(wave * 0.83) * 0.18, -0.22, 0.22), isBenthic ? 0 : Math.sin(wave * 0.67) * 0.045)
    node.scale.set(direction * length, length, length)
  })

  return (
    <group ref={group} name={`root-specimen-${specimen.speciesId}-${specimen.id}`}
      userData={{ rootSpecimenId: specimen.id, speciesId: specimen.speciesId }}>
      {specimen.speciesId === 'ocellaris' && <SpecimenCard speciesId="ocellaris" texture={textures.ocellaris} exposure={exposure} />}
      {specimen.speciesId === 'watchman_goby' && <SpecimenCard speciesId="watchman_goby" texture={textures.watchman_goby} exposure={exposure} />}
      {specimen.speciesId === 'epaulette_shark' && <EpauletteSharkFallback />}
      {specimen.speciesId === 'pistol_shrimp' && <PistolShrimpFallback />}
    </group>
  )
}

export function SpecimenFish({ snapshot, waterSurfaceY }: SpecimenFishProps) {
  const roster = useContext(SpecimenRosterContext)
  const [clownSource, gobySource] = useLoader(THREE.TextureLoader, [VISUAL_ASSETS.ocellaris.url, VISUAL_ASSETS.watchman_goby.url])
  const textures = useMemo(() => ({
    ocellaris: cropTexture(clownSource, VISUAL_ASSETS.ocellaris),
    watchman_goby: cropTexture(gobySource, VISUAL_ASSETS.watchman_goby),
  }), [clownSource, gobySource])
  useEffect(() => () => Object.values(textures).forEach((texture) => texture.dispose()), [textures])

  const marineRoster = roster
    .filter((specimen) => specimen.alive && MARINE_SPECIES.has(specimen.speciesId))
    .slice(0, MAX_SPECIMENS)

  return (
    <group name="root-pocket-aquarium-specimens">
      {marineRoster.map((specimen) => (
        <RenderedSpecimen key={specimen.id} specimen={specimen} snapshot={snapshot}
          waterSurfaceY={waterSurfaceY} textures={textures} />
      ))}
    </group>
  )
}
