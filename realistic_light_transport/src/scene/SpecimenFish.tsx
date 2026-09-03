import { useFrame, useLoader } from '@react-three/fiber'
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import * as THREE from 'three'

import type { ReefSnapshot } from '../contracts'
import type { PocketSpecimen } from '../integration/pocketAquariumBridge'
import type { ScenePellet } from './feeding'
import { specimenAssetFor } from './specimens/assetRegistry'
import { RiggedSpecimen } from './specimens/RiggedSpecimen'

const MAX_SPECIMENS = 24
const TANK_HALF_WIDTH = 2.76
const SAND_Y = -1.44
const CONTACT_RADIUS = 0.34
const SEPARATION_RADIUS = 0.5
const HUNGER_TO_PURSUE = 0.12
const MARINE_SPECIES = new Set(['ocellaris', 'watchman_goby', 'pistol_shrimp', 'epaulette_shark'])
/** Shared per-frame steering context so fish can separate and claim pellets exactly once. */
interface SteerContext {
  readonly positions: Map<number, THREE.Vector3>
  readonly claimed: Set<number>
  readonly pellets: readonly ScenePellet[]
  readonly consume: (foodId: number, eaterId: number) => void
}
const SpecimenRosterContext = createContext<readonly PocketSpecimen[]>([])
const VISUAL_SKINS = {
  watchman_goby: {
    url: new URL('../../../assets/animals/yellow-watchman-goby-v1.png', import.meta.url).href,
    image: [1536, 1024], crop: [57, 223, 1453, 732],
  },
} as const

export function SpecimenRosterProvider({ specimens, children }: {
  readonly specimens: readonly PocketSpecimen[]
  readonly children: ReactNode
}) {
  return <SpecimenRosterContext.Provider value={specimens}>{children}</SpecimenRosterContext.Provider>
}

export interface SpecimenFishProps {
  readonly snapshot: ReefSnapshot
  readonly waterSurfaceY: number
  readonly pellets: readonly ScenePellet[]
  readonly consume: (foodId: number, eaterId: number) => void
}

type BodyProfile = readonly (readonly [x: number, yRadius: number, zRadius: number])[]

function createBodyGeometry(profile: BodyProfile, uvVertical: readonly [number, number]) {
  const radialSegments = 18
  const vertices: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const [tailX] = profile[0]
  const [headX] = profile.at(-1) ?? profile[0]
  for (const [x, yRadius, zRadius] of profile) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = segment / radialSegments * Math.PI * 2
      vertices.push(x, Math.cos(angle) * yRadius, Math.sin(angle) * zRadius)
      uvs.push((x - tailX) / (headX - tailX), THREE.MathUtils.lerp(uvVertical[0], uvVertical[1], (Math.cos(angle) + 1) * .5))
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
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function cropSkin(source: THREE.Texture, skin: (typeof VISUAL_SKINS)[keyof typeof VISUAL_SKINS]) {
  const texture = source.clone()
  const [imageWidth, imageHeight] = skin.image
  const [left, top, right, bottom] = skin.crop
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.offset.set(left / imageWidth, 1 - (bottom + 1) / imageHeight)
  texture.repeat.set((right - left + 1) / imageWidth, (bottom - top + 1) / imageHeight)
  texture.needsUpdate = true
  return texture
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
    goby: createBodyGeometry([[-.5, .03, .025], [-.4, .12, .055], [-.05, .15, .08], [.28, .18, .1], [.47, .12, .075], [.52, .035, .025]], [.25, .72]),
    shark: createBodyGeometry([[-.52, .025, .02], [-.38, .08, .055], [-.04, .13, .09], [.27, .15, .105], [.46, .105, .085], [.52, .025, .02]], [0, 1]),
    tail: createFinGeometry([[0, .06], [-.31, .27], [-.25, 0], [-.32, -.26], [0, -.06]]),
    dorsal: createFinGeometry([[-.22, 0], [-.08, .35], [.18, .15], [.26, 0]]),
    pectoral: createFinGeometry([[-.2, 0], [.03, -.34], [.24, -.08], [.2, .03]]),
  }), [])
  useEffect(() => () => Object.values(geometries).forEach((geometry) => geometry.dispose()), [geometries])
  return geometries
}

type SpecimenGeometry = ReturnType<typeof useSpecimenGeometry>
const FIN_MATERIAL = { roughness: 0.48, metalness: 0.02 } as const

function WatchmanGoby({ geometry, skin, tailRef }: {
  readonly geometry: SpecimenGeometry
  readonly skin: THREE.Texture
  readonly tailRef: RefObject<THREE.Group | null>
}) {
  return <group name="watchman-goby-volumetric">
    <mesh geometry={geometry.goby} castShadow receiveShadow><meshPhysicalMaterial map={skin} color="#ffffff" roughness={.5} clearcoat={.16} /></mesh>
    <group ref={tailRef} position={[-.42, 0, 0]}>
      <mesh position={[-.045, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, .58]} castShadow>
        <cylinderGeometry args={[.045, .057, .12, 16]} /><meshPhysicalMaterial map={skin} color="#ffffff" roughness={.5} />
      </mesh>
      <mesh position={[-.08, 0, 0]} geometry={geometry.tail} scale={[.62, .66, 1.75]} castShadow><meshStandardMaterial color="#d7bf3b" {...FIN_MATERIAL} /></mesh>
    </group>
    <mesh position={[-.08, .14, 0]} geometry={geometry.dorsal} scale={[.72, .62, 1.8]} castShadow><meshStandardMaterial color="#e0c935" {...FIN_MATERIAL} /></mesh>
    <mesh position={[.25, .15, 0]} geometry={geometry.dorsal} scale={[.52, .78, 1.8]} castShadow><meshStandardMaterial color="#cba909" {...FIN_MATERIAL} /></mesh>
    {[-1, 1].map((side) => <group key={side}>
      <mesh position={[.2, -.04, side * .09]} geometry={geometry.pectoral} rotation={[side * .45, 0, -.1]} scale={[.72, .62, 1.45]} castShadow><meshStandardMaterial color="#dbc640" {...FIN_MATERIAL} /></mesh>
      <mesh position={[.38, .135, side * .078]} scale={[.05, .055, .035]}><dodecahedronGeometry args={[1, 1]} /><meshPhysicalMaterial color="#070908" roughness={.12} clearcoat={1} /></mesh>
    </group>)}
  </group>
}

function EpauletteShark({ geometry, tailRef }: { readonly geometry: SpecimenGeometry; readonly tailRef: RefObject<THREE.Group | null> }) {
  return <group name="epaulette-shark-volumetric">
    <mesh geometry={geometry.shark} castShadow receiveShadow><meshPhysicalMaterial color="#957b55" roughness={.62} clearcoat={.08} /></mesh>
    <group ref={tailRef} position={[-.42, 0, 0]}><mesh position={[-.08, 0, 0]} geometry={geometry.tail} scale={[.95, .72, 2.2]} castShadow><meshStandardMaterial color="#735c3e" {...FIN_MATERIAL} /></mesh></group>
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

type SpeciesSkins = Readonly<Record<'watchman_goby', THREE.Texture>>

function RenderedSpecimen({ specimen, snapshot, waterSurfaceY, geometry, skins, steer }: {
  readonly specimen: PocketSpecimen
  readonly snapshot: ReefSnapshot
  readonly waterSurfaceY: number
  readonly geometry: SpecimenGeometry
  readonly skins: SpeciesSkins
  readonly steer: SteerContext
}) {
  const group = useRef<THREE.Group>(null)
  const tail = useRef<THREE.Group>(null)
  const feedDriveRef = useRef(0)
  const phase = seededUnit(specimen.id, 1) * Math.PI * 2
  const rootX = THREE.MathUtils.lerp(-TANK_HALF_WIDTH * .72, TANK_HALF_WIDTH * .72, specimen.x)
  const benthic = specimen.layer === 'bottom' || specimen.speciesId === 'epaulette_shark'
  const clown = specimen.speciesId === 'ocellaris'
  const shark = specimen.speciesId === 'epaulette_shark'
  const shrimp = specimen.speciesId === 'pistol_shrimp'
  const clearance = shrimp ? .055 : shark ? .14 : .18
  const openWaterY = THREE.MathUtils.lerp(SAND_Y + .48, waterSurfaceY - .34, 1 - specimen.y)
  const rootY = benthic ? SAND_Y + clearance : THREE.MathUtils.clamp(openWaterY, SAND_Y + .38, waterSurfaceY - .28)
  const sceneUnitsPerMeter = TANK_HALF_WIDTH * 2 / Math.max(snapshot.tank.widthMeters, .4)
  const lifeScale = specimen.stage === 'adult' ? 1 : .68
  const length = THREE.MathUtils.clamp(specimen.adultSizeCm / 100 * sceneUnitsPerMeter * lifeScale, .16, 3.7)
  const riggedAsset = specimenAssetFor(specimen.speciesId)
  // Persistent position/velocity give the fish real bounded steering (arrival, separation,
  // tank avoidance, depth preference, hunger-weighted food targeting) instead of a fixed path.
  const pos = useMemo(() => new THREE.Vector3(rootX, rootY, clown ? 1 : benthic ? .48 : 0), [])
  const vel = useMemo(() => new THREE.Vector3(), [])
  const desired = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ clock }, delta) => {
    const node = group.current
    if (!node) return
    const dt = Math.min(delta, 0.05)
    const speed = (.33 + seededUnit(specimen.id, 3) * .13) * (shark ? .42 : shrimp ? .55 : 1)
    const wave = clock.getElapsedTime() * speed + phase
    const maxSpeed = shrimp ? .42 : shark ? .7 : clown ? 1.25 : 1
    const yFloor = benthic ? SAND_Y + clearance : SAND_Y + .35
    const yCeil = waterSurfaceY - .22
    const xBound = TANK_HALF_WIDTH - .15

    // roam target keeps each species' character when it is not chasing food
    let targetX = clown ? rootX * .5 + Math.sin(wave) * 1.4
      : benthic ? rootX * .28 + Math.sin(wave) * (shark ? 1.5 : .28) : rootX + Math.sin(wave) * .35
    let targetY = benthic ? yFloor : THREE.MathUtils.clamp(rootY + Math.sin(wave * .71) * .12, yFloor, yCeil)
    let targetZ = clown ? 1 + Math.cos(wave * .61) * .3
      : benthic ? .48 + Math.cos(wave * .67) * (shark ? .32 : .12) : Math.cos(wave * .8) * .4

    // hunger-weighted targeting of the nearest eligible unclaimed pellet
    let pursued: ScenePellet | null = null
    if (specimen.kind !== 'invert' && specimen.hunger > HUNGER_TO_PURSUE) {
      let best = Infinity
      for (const pellet of steer.pellets) {
        if (steer.claimed.has(pellet.id)) continue
        if (specimen.layer === 'bottom' && !pellet.sunk) continue
        const dx = pellet.x - pos.x, dy = pellet.y - pos.y, dz = pellet.z - pos.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < best) { best = d2; pursued = pellet }
      }
      if (pursued) { targetX = pursued.x; targetY = pursued.y; targetZ = pursued.z }
    }
    const pursuing = pursued ? THREE.MathUtils.clamp(specimen.hunger, 0, 1) : 0

    // arrival toward target
    desired.set(targetX - pos.x, targetY - pos.y, targetZ - pos.z)
    const dist = desired.length()
    const arrival = Math.min(maxSpeed, dist * 3) * (pursuing > 0 ? 1 + pursuing * .4 : .7)
    if (dist > 1e-4) desired.multiplyScalar(arrival / dist)
    // separation from neighbours
    for (const [otherId, otherPos] of steer.positions) {
      if (otherId === specimen.id) continue
      const dx = pos.x - otherPos.x, dy = pos.y - otherPos.y, dz = pos.z - otherPos.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 > 1e-6 && d2 < SEPARATION_RADIUS * SEPARATION_RADIUS) {
        const push = (SEPARATION_RADIUS - Math.sqrt(d2)) / SEPARATION_RADIUS * maxSpeed
        desired.x += dx * push * .6; desired.y += dy * push * .3; desired.z += dz * push * .6
      }
    }
    // integrate and keep inside the tank interior
    vel.lerp(desired, 1 - Math.exp(-dt * 4))
    pos.addScaledVector(vel, dt)
    pos.x = THREE.MathUtils.clamp(pos.x, -xBound, xBound)
    pos.y = THREE.MathUtils.clamp(pos.y, yFloor, yCeil)
    pos.z = THREE.MathUtils.clamp(pos.z, -.45, 1.3)
    steer.positions.set(specimen.id, pos)

    // mouth/pellet contact dispatches CONSUME_FOOD exactly once (claimed guards duplicates)
    if (pursued && specimen.hunger > 0.05 && !steer.claimed.has(pursued.id)) {
      const dx = pursued.x - pos.x, dy = pursued.y - pos.y, dz = pursued.z - pos.z
      if (dx * dx + dy * dy + dz * dz < CONTACT_RADIUS * CONTACT_RADIUS) {
        steer.claimed.add(pursued.id)
        steer.consume(pursued.id, specimen.id)
      }
    }

    const direction = vel.x >= 0 ? 1 : -1
    const base = riggedAsset ? 1 : length
    node.position.copy(pos)
    node.rotation.set(
      benthic ? -.03 : THREE.MathUtils.clamp(-vel.y * .4, -.3, .3),
      THREE.MathUtils.clamp(Math.sin(wave * .61) * .18, -.26, .26),
      benthic ? 0 : Math.sin(wave * .67) * .05,
    )
    node.scale.set(direction * base, base, base)
    if (tail.current) {
      const tailAmplitude = shark ? .1 : shrimp ? 0 : specimen.speciesId === 'watchman_goby' ? .14 : .22
      tail.current.rotation.y = Math.sin(wave * 8.2) * tailAmplitude * (1 + pursuing * .5)
    }
    feedDriveRef.current = pursuing
  })

  return <group ref={group} name={`root-specimen-${specimen.speciesId}-${specimen.id}`}
    userData={{ rootSpecimenId: specimen.id, speciesId: specimen.speciesId }}>
    {riggedAsset && <RiggedSpecimen asset={riggedAsset} individualId={specimen.id}
      targetLengthSceneUnits={length} stage={specimen.stage} hunger={specimen.hunger}
      feedDrive={feedDriveRef} />}
    {specimen.speciesId === 'watchman_goby' && <WatchmanGoby geometry={geometry} skin={skins.watchman_goby} tailRef={tail} />}
    {specimen.speciesId === 'epaulette_shark' && <EpauletteShark geometry={geometry} tailRef={tail} />}
    {specimen.speciesId === 'pistol_shrimp' && <PistolShrimp />}
  </group>
}

export function SpecimenFish({ snapshot, waterSurfaceY, pellets, consume }: SpecimenFishProps) {
  const roster = useContext(SpecimenRosterContext)
  const geometry = useSpecimenGeometry()
  const gobySource = useLoader(THREE.TextureLoader, VISUAL_SKINS.watchman_goby.url)
  const skins = useMemo(() => ({
    watchman_goby: cropSkin(gobySource, VISUAL_SKINS.watchman_goby),
  }), [gobySource])
  useEffect(() => () => Object.values(skins).forEach((skin) => skin.dispose()), [skins])
  const positions = useRef(new Map<number, THREE.Vector3>()).current
  const claimed = useRef(new Set<number>()).current
  // Forget claims once their pellet has left the authoritative list (eaten or decayed),
  // keeping the exactly-once guard bounded to live pellets.
  const liveIds = new Set(pellets.map((pellet) => pellet.id))
  for (const id of claimed) if (!liveIds.has(id)) claimed.delete(id)
  const steer: SteerContext = { positions, claimed, pellets, consume }
  const marineRoster = roster.filter((specimen) => specimen.alive && MARINE_SPECIES.has(specimen.speciesId)).slice(0, MAX_SPECIMENS)
  return <group name="root-pocket-aquarium-specimens">
    {marineRoster.map((specimen) => <RenderedSpecimen key={specimen.id} specimen={specimen} snapshot={snapshot}
      waterSurfaceY={waterSurfaceY} geometry={geometry} skins={skins} steer={steer} />)}
  </group>
}
