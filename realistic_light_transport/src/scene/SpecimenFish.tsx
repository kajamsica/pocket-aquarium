import { useFrame } from '@react-three/fiber'
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'

import type { ReefSnapshot } from '../contracts'
import type { PocketSpecimen } from '../integration/pocketAquariumBridge'

const MAX_SPECIMENS = 24
const TANK_HALF_WIDTH = 2.76
const SAND_Y = -1.44
const MARINE_SPECIES = new Set(['ocellaris', 'watchman_goby', 'pistol_shrimp', 'epaulette_shark'])
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

type BodyProfile = readonly (readonly [x: number, yRadius: number, zRadius: number])[]

function createBodyGeometry(profile: BodyProfile) {
  const radialSegments = 18
  const vertices: number[] = []
  const indices: number[] = []
  for (const [x, yRadius, zRadius] of profile) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = segment / radialSegments * Math.PI * 2
      vertices.push(x, Math.cos(angle) * yRadius, Math.sin(angle) * zRadius)
    }
  }
  for (let ring = 0; ring < profile.length - 1; ring += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments
      const a = ring * radialSegments + segment
      const b = ring * radialSegments + next
      const c = (ring + 1) * radialSegments + segment
      const d = (ring + 1) * radialSegments + next
      indices.push(a, c, b, b, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createFinGeometry(points: readonly (readonly [number, number])[]) {
  const shape = new THREE.Shape()
  shape.moveTo(points[0][0], points[0][1])
  points.slice(1).forEach(([x, y]) => shape.lineTo(x, y))
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.026, bevelEnabled: true, bevelSize: 0.009, bevelThickness: 0.008, bevelSegments: 2,
  })
  geometry.translate(0, 0, -0.013)
  geometry.computeVertexNormals()
  return geometry
}

function useSpecimenGeometry() {
  const geometries = useMemo(() => ({
    clown: createBodyGeometry([[-0.48, .035, .025], [-.38, .15, .07], [-.12, .29, .115], [.18, .3, .125], [.42, .2, .1], [.5, .035, .025]]),
    goby: createBodyGeometry([[-.5, .03, .025], [-.4, .12, .055], [-.05, .15, .08], [.28, .18, .1], [.47, .12, .075], [.52, .035, .025]]),
    shark: createBodyGeometry([[-.52, .025, .02], [-.38, .08, .055], [-.04, .13, .09], [.27, .15, .105], [.46, .105, .085], [.52, .025, .02]]),
    tail: createFinGeometry([[0, .06], [-.31, .27], [-.25, 0], [-.32, -.26], [0, -.06]]),
    dorsal: createFinGeometry([[-.22, 0], [-.08, .35], [.18, .15], [.26, 0]]),
    pectoral: createFinGeometry([[-.2, 0], [.03, -.34], [.24, -.08], [.2, .03]]),
  }), [])
  useEffect(() => () => Object.values(geometries).forEach((geometry) => geometry.dispose()), [geometries])
  return geometries
}

type SpecimenGeometry = ReturnType<typeof useSpecimenGeometry>
const FIN_MATERIAL = { roughness: 0.48, metalness: 0.02 } as const

function Ocellaris({ geometry }: { readonly geometry: SpecimenGeometry }) {
  const bands = [[-.3, .18], [-.04, .29], [.3, .235]] as const
  return <group name="ocellaris-volumetric">
    <mesh geometry={geometry.clown} castShadow receiveShadow><meshPhysicalMaterial color="#f06a19" roughness={0.42} clearcoat={0.22} /></mesh>
    <mesh position={[-.49, 0, 0]} geometry={geometry.tail} scale={[.9, .92, 2.5]} castShadow><meshStandardMaterial color="#17120f" {...FIN_MATERIAL} /></mesh>
    <mesh position={[-.485, 0, .008]} geometry={geometry.tail} scale={[.76, .76, 2.25]} castShadow><meshStandardMaterial color="#e86718" {...FIN_MATERIAL} /></mesh>
    <mesh position={[-.08, .265, 0]} geometry={geometry.dorsal} scale={[.86, .66, 2.4]} castShadow><meshStandardMaterial color="#2b1710" {...FIN_MATERIAL} /></mesh>
    <mesh position={[-.06, -.26, 0]} geometry={geometry.dorsal} rotation={[0, 0, Math.PI]} scale={[.7, .46, 2.2]} castShadow><meshStandardMaterial color="#d95817" {...FIN_MATERIAL} /></mesh>
    <mesh position={[.13, -.02, .12]} geometry={geometry.pectoral} rotation={[.32, 0, -.12]} scale={[.54, .48, 1.8]} castShadow><meshStandardMaterial color="#dd5a17" {...FIN_MATERIAL} /></mesh>
    {bands.map(([x, radius]) => <group key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
      <mesh scale={[1, 1, .54]}><cylinderGeometry args={[radius + .012, radius + .012, .13, 20]} /><meshStandardMaterial color="#17120f" roughness={.44} /></mesh>
      <mesh scale={[1, 1, .55]}><cylinderGeometry args={[radius + .014, radius + .014, .085, 20]} /><meshPhysicalMaterial color="#f7f5e8" roughness={.3} clearcoat={.18} /></mesh>
    </group>)}
    <mesh position={[.39, .075, .102]} scale={.035}><dodecahedronGeometry args={[1, 1]} /><meshPhysicalMaterial color="#070807" roughness={.18} clearcoat={1} /></mesh>
  </group>
}

function WatchmanGoby({ geometry }: { readonly geometry: SpecimenGeometry }) {
  const spots = [[.36, .08], [.27, .13], [.17, .06], [.05, .12], [-.1, .05], [-.22, .1]] as const
  return <group name="watchman-goby-volumetric">
    <mesh geometry={geometry.goby} castShadow receiveShadow><meshPhysicalMaterial color="#d8b912" roughness={.5} clearcoat={.16} /></mesh>
    <mesh position={[-.5, 0, 0]} geometry={geometry.tail} scale={[.72, .7, 1.7]} castShadow><meshStandardMaterial color="#d7bf3b" {...FIN_MATERIAL} /></mesh>
    <mesh position={[-.08, .14, 0]} geometry={geometry.dorsal} scale={[.72, .62, 1.8]} castShadow><meshStandardMaterial color="#e0c935" {...FIN_MATERIAL} /></mesh>
    <mesh position={[.25, .15, 0]} geometry={geometry.dorsal} scale={[.52, .78, 1.8]} castShadow><meshStandardMaterial color="#cba909" {...FIN_MATERIAL} /></mesh>
    <mesh position={[.2, -.04, .09]} geometry={geometry.pectoral} rotation={[.45, 0, -.1]} scale={[.72, .62, 1.45]} castShadow><meshStandardMaterial color="#dbc640" {...FIN_MATERIAL} /></mesh>
    {spots.map(([x, y]) => <mesh key={x} position={[x, y, .096]} scale={[.018, .018, .008]}>
      <dodecahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#55cee0" emissive="#177e97" emissiveIntensity={.25} roughness={.3} />
    </mesh>)}
    <mesh position={[.38, .135, .078]} scale={[.05, .055, .035]}><dodecahedronGeometry args={[1, 1]} /><meshPhysicalMaterial color="#070908" roughness={.12} clearcoat={1} /></mesh>
  </group>
}

function EpauletteShark({ geometry }: { readonly geometry: SpecimenGeometry }) {
  return <group name="epaulette-shark-volumetric">
    <mesh geometry={geometry.shark} castShadow receiveShadow><meshPhysicalMaterial color="#957b55" roughness={.62} clearcoat={.08} /></mesh>
    <mesh position={[-.5, 0, 0]} geometry={geometry.tail} scale={[.95, .72, 2.2]} castShadow><meshStandardMaterial color="#735c3e" {...FIN_MATERIAL} /></mesh>
    <mesh position={[-.19, .105, 0]} geometry={geometry.dorsal} scale={[.52, .42, 1.65]} castShadow><meshStandardMaterial color="#806746" {...FIN_MATERIAL} /></mesh>
    <mesh position={[.08, .12, 0]} geometry={geometry.dorsal} scale={[.58, .48, 1.7]} castShadow><meshStandardMaterial color="#806746" {...FIN_MATERIAL} /></mesh>
    <mesh position={[.25, -.06, .09]} geometry={geometry.pectoral} rotation={[.82, 0, -.18]} scale={[.82, .76, 1.8]} castShadow><meshStandardMaterial color="#876f4c" {...FIN_MATERIAL} /></mesh>
    {[-.28, -.12, .04].map((x) => <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, .68]}>
      <cylinderGeometry args={[.125, .125, .045, 18]} /><meshStandardMaterial color="#5b4936" roughness={.68} />
    </mesh>)}
    <mesh position={[.22, .055, .105]} scale={[.075, .075, .018]}><ringGeometry args={[.48, 1, 24]} /><meshStandardMaterial color="#e9d49e" roughness={.48} /></mesh>
    <mesh position={[.22, .055, .107]} scale={[.035, .035, .012]}><circleGeometry args={[1, 24]} /><meshBasicMaterial color="#161510" /></mesh>
    <mesh position={[.43, .055, .078]} scale={.022}><dodecahedronGeometry args={[1, 1]} /><meshPhysicalMaterial color="#050606" clearcoat={1} roughness={.1} /></mesh>
  </group>
}

const SHRIMP_SEGMENTS = [0, 1, 2, 3, 4] as const
function PistolShrimp() {
  return <group name="pistol-shrimp-volumetric" scale={1.18}>
    {SHRIMP_SEGMENTS.map((segment) => <mesh key={segment} position={[-.04 - segment * .105, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[.075 - segment * .007, .082 - segment * .006, .13, 10]} />
      <meshStandardMaterial color={segment % 2 ? '#d7b486' : '#704838'} roughness={.58} />
    </mesh>)}
    <mesh position={[.13, 0, 0]} scale={[.19, .11, .11]} castShadow><dodecahedronGeometry args={[1, 1]} /><meshStandardMaterial color="#956148" roughness={.5} /></mesh>
    <mesh position={[.33, .08, .025]} scale={[.23, .085, .1]} castShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#d29a68" roughness={.46} /></mesh>
    <mesh position={[.5, .095, .025]} rotation={[0, 0, .25]} scale={[.15, .045, .08]} castShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#e3b17e" roughness={.42} /></mesh>
    {[-1, 1].flatMap((side) => [0, 1, 2].map((leg) => <mesh key={`${side}-${leg}`} position={[.1 - leg * .1, -.1, side * .035]}
      rotation={[side * .35, 0, side * .75]} scale={[.015, .16, .015]}><cylinderGeometry args={[1, .72, 1, 5]} /><meshStandardMaterial color="#c99a71" roughness={.62} /></mesh>))}
    {[-1, 1].map((side) => <mesh key={side} position={[.25, .07, side * .045]} rotation={[0, 0, side * .42]} scale={[.008, .3, .008]}>
      <cylinderGeometry args={[1, .4, 1, 5]} /><meshStandardMaterial color="#e4c2a0" roughness={.55} /></mesh>)}
  </group>
}

function seededUnit(id: number, salt: number) {
  const value = Math.sin((id + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function RenderedSpecimen({ specimen, snapshot, waterSurfaceY, geometry }: {
  readonly specimen: PocketSpecimen
  readonly snapshot: ReefSnapshot
  readonly waterSurfaceY: number
  readonly geometry: SpecimenGeometry
}) {
  const group = useRef<THREE.Group>(null)
  const phase = seededUnit(specimen.id, 1) * Math.PI * 2
  const rootX = THREE.MathUtils.lerp(-TANK_HALF_WIDTH * .72, TANK_HALF_WIDTH * .72, specimen.x)
  const benthic = specimen.layer === 'bottom' || specimen.speciesId === 'epaulette_shark'
  const clearance = specimen.speciesId === 'pistol_shrimp' ? .055 : specimen.speciesId === 'epaulette_shark' ? .14 : .18
  const openWaterY = THREE.MathUtils.lerp(SAND_Y + .48, waterSurfaceY - .34, 1 - specimen.y)
  const rootY = benthic ? SAND_Y + clearance : THREE.MathUtils.clamp(openWaterY, SAND_Y + .38, waterSurfaceY - .28)
  const sceneUnitsPerMeter = TANK_HALF_WIDTH * 2 / Math.max(snapshot.tank.widthMeters, .4)
  const lifeScale = specimen.stage === 'adult' ? 1 : .68
  const length = THREE.MathUtils.clamp(specimen.adultSizeCm / 100 * sceneUnitsPerMeter * lifeScale, .16, 3.7)

  useFrame(({ clock }) => {
    const node = group.current
    if (!node) return
    const shark = specimen.speciesId === 'epaulette_shark'
    const shrimp = specimen.speciesId === 'pistol_shrimp'
    const clown = specimen.speciesId === 'ocellaris'
    const speed = (.33 + seededUnit(specimen.id, 3) * .13) * (shark ? .42 : shrimp ? .55 : 1)
    const wave = clock.getElapsedTime() * speed + phase
    const feedDrive = THREE.MathUtils.clamp(snapshot.events.feedPulse * specimen.hunger, 0, .75)
    const x = clown ? THREE.MathUtils.lerp(rootX * .25 + Math.sin(wave) * 1.55, 0, feedDrive)
      : benthic ? rootX * .28 + Math.sin(wave) * (shark ? 1.55 : .28) : rootX + Math.sin(wave) * .35
    const y = benthic ? rootY : THREE.MathUtils.lerp(rootY + Math.sin(wave * .71) * .11, waterSurfaceY - .42, feedDrive)
    const z = clown ? THREE.MathUtils.lerp(.34 + Math.cos(wave * .61) * .68, .88, feedDrive)
      : benthic ? .48 + Math.cos(wave * .67) * (shark ? .32 : .12) : Math.cos(wave * .8) * .4
    const direction = Math.cos(wave) + (0 - x) * feedDrive >= 0 ? 1 : -1
    node.position.set(x, Math.min(y, waterSurfaceY - .2), z)
    node.rotation.set(benthic ? -.03 : Math.sin(wave * .53) * .04, THREE.MathUtils.clamp(-Math.sin(wave * .61) * .24, -.26, .26), benthic ? 0 : Math.sin(wave * .67) * .055)
    node.scale.set(direction * length, length, length)
  })

  return <group ref={group} name={`root-specimen-${specimen.speciesId}-${specimen.id}`}
    userData={{ rootSpecimenId: specimen.id, speciesId: specimen.speciesId }}>
    {specimen.speciesId === 'ocellaris' && <Ocellaris geometry={geometry} />}
    {specimen.speciesId === 'watchman_goby' && <WatchmanGoby geometry={geometry} />}
    {specimen.speciesId === 'epaulette_shark' && <EpauletteShark geometry={geometry} />}
    {specimen.speciesId === 'pistol_shrimp' && <PistolShrimp />}
  </group>
}

export function SpecimenFish({ snapshot, waterSurfaceY }: SpecimenFishProps) {
  const roster = useContext(SpecimenRosterContext)
  const geometry = useSpecimenGeometry()
  const marineRoster = roster.filter((specimen) => specimen.alive && MARINE_SPECIES.has(specimen.speciesId)).slice(0, MAX_SPECIMENS)
  return <group name="root-pocket-aquarium-specimens">
    {marineRoster.map((specimen) => <RenderedSpecimen key={specimen.id} specimen={specimen} snapshot={snapshot}
      waterSurfaceY={waterSurfaceY} geometry={geometry} />)}
  </group>
}
