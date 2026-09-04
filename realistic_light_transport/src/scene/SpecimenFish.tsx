import { useFrame, useLoader } from '@react-three/fiber'
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import * as THREE from 'three'

import type { ReefSnapshot } from '../contracts'
import type { PocketAction, PocketSpecimen } from '../integration/pocketAquariumBridge'
import type { MorphologyProfileV1 } from '../specimens/specimenProfile'
import { evaluateMorphology } from '../workbench/geometry/evaluateMorphology'
import type { ScenePellet } from './feeding'
import { visibleFoodContact } from './foodContact'
import { REEF_ROCKS } from './reefLayout'
import {
  ACCEPTED_SPECIES_IDS,
  specimenAssetFor,
  type SpecimenAsset,
} from './specimens/assetRegistry'
import { RiggedSpecimen } from './specimens/RiggedSpecimen'

const MAX_SPECIMENS = 24
const TANK_HALF_WIDTH = 2.76
// Believable inner water depth (front/back glass). Mirrors the width inset from the
// rendered tank so fish swim the full depth band without clipping the glass panels.
const TANK_HALF_DEPTH = 1.2
const SAND_Y = -1.44
const MAX_POSITION_FRAME_SECONDS = .05
const SHOWCASE_FISH_LAYERS: Readonly<Partial<Record<string, PocketSpecimen['layer']>>> = {
  diamond_goby: 'bottom', epaulette_shark: 'bottom', watchman_goby: 'bottom', six_line_wrasse: 'top',
}
interface SpecimenRosterValue {
  readonly specimens: readonly PocketSpecimen[]
  readonly showcaseCatalog?: AcceptedShowcaseCatalog
  readonly morphologyOverride?: MorphologyProfileV1
  readonly dispatch?: (action: PocketAction) => void
}
const SpecimenRosterContext = createContext<SpecimenRosterValue>({ specimens: [] })
const VISUAL_SKINS = {
  watchman_goby: {
    url: new URL('../../../assets/animals/yellow-watchman-goby-v1.png', import.meta.url).href,
    image: [1536, 1024], crop: [57, 223, 1453, 732],
  },
} as const

export interface AcceptedShowcaseCatalog {
  readonly acceptedSpeciesCount: number
  readonly defaultAssets: readonly SpecimenAsset[]
  readonly animalAssets: readonly SpecimenAsset[]
  readonly coralAssets: readonly SpecimenAsset[]
}

/** Registry-derived presentation data only. These assets never become root PA residents. */
export function createAcceptedShowcaseCatalog(): AcceptedShowcaseCatalog {
  const defaults = ACCEPTED_SPECIES_IDS.map((speciesId) => {
    const asset = specimenAssetFor(speciesId)
    if (!asset) throw new Error(`Accepted default is missing from the registry: ${speciesId}`)
    return asset
  })
  return {
    acceptedSpeciesCount: defaults.length,
    defaultAssets: defaults,
    animalAssets: defaults.filter((asset) => asset.category !== 'coral'),
    coralAssets: defaults.filter((asset) => asset.category === 'coral'),
  }
}

export function SpecimenRosterProvider({ specimens, showcaseCatalog, morphologyOverride, dispatch, children }: {
  readonly specimens: readonly PocketSpecimen[]
  readonly showcaseCatalog?: AcceptedShowcaseCatalog
  readonly morphologyOverride?: MorphologyProfileV1
  readonly dispatch?: (action: PocketAction) => void
  readonly children: ReactNode
}) {
  const value = useMemo(() => ({ specimens, showcaseCatalog, morphologyOverride, dispatch }),
    [dispatch, morphologyOverride, showcaseCatalog, specimens])
  return <SpecimenRosterContext.Provider value={value}>{children}</SpecimenRosterContext.Provider>
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

function DraftMorphologyOverlay({ profile, targetLengthSceneUnits }: {
  readonly profile: MorphologyProfileV1
  readonly targetLengthSceneUnits: number
}) {
  const evaluated = useMemo(() => evaluateMorphology(profile), [profile])
  useEffect(() => () => evaluated.geometry.dispose(), [evaluated.geometry])
  return <mesh name={`draft-morphology-overlay-${profile.speciesId}`} geometry={evaluated.geometry}
    scale={targetLengthSceneUnits / profile.adultLengthMeters}
    renderOrder={20}
    userData={{ draftMorphology: true, speciesId: profile.speciesId, geometryDigest: evaluated.digest.value }}>
    <meshBasicMaterial color="#ff45d7" transparent opacity={.58} wireframe depthTest={false} depthWrite={false} />
  </mesh>
}

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

export interface SpecimenMotionRoute {
  readonly curve: THREE.CatmullRomCurve3
  readonly seed: number
  readonly phase: number
  readonly speed: number
  readonly direction: -1 | 1
  readonly yBounds: readonly [minimum: number, maximum: number]
}
export interface SpecimenMotionState {
  progress: number
  direction: -1 | 1
  switchIndex: number
  secondsUntilSwitch: number
}
export interface SpecimenCrowd {
  readonly pressure: number
  readonly awayX: number
  readonly awayZ: number
}
const NO_SPECIMEN_CROWD: SpecimenCrowd = { pressure: 0, awayX: 0, awayZ: 0 }
export interface SpecimenPosition {
  readonly position: THREE.Vector3
  readonly velocity: THREE.Vector3
  readonly profile: SpecimenBehaviorProfile
  longitudinal: number
  lateral: number
  verticalClearance: number
}
type SpecimenPositions = Map<number, SpecimenPosition>
export type SpecimenBehaviorProfile = 'pair' | 'shoal' | 'territorial_cruise' | 'benthic' |
  'territorial_cave' | 'reef_cruise'
export function specimenBehaviorProfile(speciesId: string): SpecimenBehaviorProfile {
  if (speciesId === 'ocellaris' || speciesId === 'black_storm_ocellaris') return 'pair'
  if (speciesId.endsWith('_tang')) return 'territorial_cruise'
  if (speciesId === 'banggai_cardinal') return 'shoal'
  if (speciesId === 'diamond_goby' || speciesId === 'watchman_goby' || speciesId === 'epaulette_shark') return 'benthic'
  if (speciesId === 'royal_gramma') return 'territorial_cave'
  return 'reef_cruise'
}
export interface SpecimenCollisionEnvelope { readonly longitudinal: number; readonly lateral: number }
export function specimenCollisionEnvelope(length: number, bodyRadius: number): SpecimenCollisionEnvelope {
  return { longitudinal: length * .52, lateral: bodyRadius * 1.4 } }
function specimenVerticalBounds(layer: PocketSpecimen['layer'], waterSurfaceY: number, bodyRadius: number) {
  const floor = SAND_Y + bodyRadius
  const ceiling = Math.max(floor + .04, waterSurfaceY - bodyRadius)
  if (layer === 'bottom') return [floor, Math.min(ceiling, SAND_Y + .42)] as const
  const midFloor = Math.min(ceiling, SAND_Y + .56)
  if (layer === 'top') return [THREE.MathUtils.lerp(midFloor, ceiling, .55), ceiling] as const
  return [midFloor, ceiling] as const
}
/** Seeded closed route: long front/back traversals, with depth changes at high outer-side waypoints. */
export function createSpecimenMotionRoute(seed: number, layer: PocketSpecimen['layer'],
  waterSurfaceY: number, bodyRadius: number): SpecimenMotionRoute {
  const yBounds = specimenVerticalBounds(layer, waterSurfaceY, bodyRadius)
  const ySpan = yBounds[1] - yBounds[0]
  const low = yBounds[0] + ySpan * (.08 + seededUnit(seed, 101) * .12)
  const middle = yBounds[0] + ySpan * (.42 + seededUnit(seed, 102) * .18)
  const high = yBounds[1]
  const xLimit = TANK_HALF_WIDTH - bodyRadius
  const zLimit = TANK_HALF_DEPTH - bodyRadius
  const left = -xLimit * (.78 + seededUnit(seed, 103) * .1)
  const right = xLimit * (.78 + seededUnit(seed, 104) * .1)
  const back = -zLimit * (.9 + seededUnit(seed, 105) * .05)
  const front = zLimit * (.9 + seededUnit(seed, 106) * .05)
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(left, low, back), new THREE.Vector3(-xLimit * .94, high, 0),
    new THREE.Vector3(left, middle, front), new THREE.Vector3(right, low, front),
    new THREE.Vector3(xLimit * .94, high, 0), new THREE.Vector3(right, middle, back),
  ], true, 'catmullrom', .5)
  return {
    curve,
    seed,
    phase: seededUnit(seed, 107),
    speed: .022 + seededUnit(seed, 108) * .012,
    direction: seededUnit(seed, 109) < .5 ? -1 : 1,
    yBounds,
  }
}
export function specimenDirectionInterval(route: SpecimenMotionRoute, switchIndex: number, crowdPressure = 0) {
  const isolatedInterval = 14 + seededUnit(route.seed, 201 + switchIndex) * 6
  return THREE.MathUtils.lerp(isolatedInterval, 8, THREE.MathUtils.clamp(crowdPressure, 0, 1))
}
export function createSpecimenMotionState(route: SpecimenMotionRoute): SpecimenMotionState {
  return { progress: route.phase, direction: route.direction, switchIndex: 0,
    secondsUntilSwitch: specimenDirectionInterval(route, 0) }
}
export function specimenReversalThreshold(crowdPressure: number) {
  return .12 + THREE.MathUtils.clamp(crowdPressure, 0, 1) * .76
}
export function decideSpecimenDirection(current: -1 | 1, tangent: THREE.Vector3,
  crowd: SpecimenCrowd, decisionSample: number): -1 | 1 {
  if (crowd.pressure > .08) {
    const awayDot = tangent.x * crowd.awayX + tangent.z * crowd.awayZ
    if (Math.abs(awayDot) > 1e-5) return awayDot > 0 ? 1 : -1
  }
  return decisionSample < specimenReversalThreshold(crowd.pressure) ? (current === 1 ? -1 : 1) : current
}
/** Integrate across decision boundaries so direction changes never remap to another curve point. */
export function advanceSpecimenMotionState(state: SpecimenMotionState, route: SpecimenMotionRoute,
  deltaSeconds: number, crowd: SpecimenCrowd = NO_SPECIMEN_CROWD) {
  let remaining = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
  while (remaining >= state.secondsUntilSwitch) {
    state.progress = THREE.MathUtils.euclideanModulo(
      state.progress + state.secondsUntilSwitch * route.speed * state.direction, 1)
    remaining -= state.secondsUntilSwitch
    const tangent = route.curve.getTangentAt(state.progress, new THREE.Vector3())
    state.direction = decideSpecimenDirection(state.direction, tangent, crowd,
      seededUnit(route.seed, 401 + state.switchIndex))
    state.switchIndex += 1
    state.secondsUntilSwitch = specimenDirectionInterval(route, state.switchIndex, crowd.pressure)
  }
  state.progress = THREE.MathUtils.euclideanModulo(state.progress + remaining * route.speed * state.direction, 1)
  state.secondsUntilSwitch -= remaining
  return state.progress
}
export function sampleSpecimenMotionRoute(route: SpecimenMotionRoute, progress: number,
  bodyRadius: number, target: THREE.Vector3) {
  route.curve.getPointAt(THREE.MathUtils.euclideanModulo(progress, 1), target)
  target.x = THREE.MathUtils.clamp(target.x, -TANK_HALF_WIDTH + bodyRadius, TANK_HALF_WIDTH - bodyRadius)
  target.y = THREE.MathUtils.clamp(target.y, route.yBounds[0], route.yBounds[1])
  target.z = THREE.MathUtils.clamp(target.z, -TANK_HALF_DEPTH + bodyRadius, TANK_HALF_DEPTH - bodyRadius)
  return target
}
/** Turn the desired heading toward a passing arc without directly correcting position. */
export function steerSpecimenHeading(heading: THREE.Vector3, routeHeading: THREE.Vector3,
  velocity: THREE.Vector3, position: THREE.Vector3, specimenId: number, bodyRadius: number, envelope: SpecimenCollisionEnvelope,
  positions: ReadonlyMap<number, SpecimenPosition>, profile: SpecimenBehaviorProfile, deltaSeconds: number,
  maxTurnRadiansPerSecond = 3.2) {
  let avoidance = 0
  let socialX = 0
  let socialZ = 0
  for (const [otherId, other] of positions) {
    if (otherId === specimenId) continue
    const dx = other.position.x - position.x
    const dz = other.position.z - position.z
    const distance = Math.hypot(dx, dz)
    const socialClearance = envelope.lateral + other.lateral
    const velocityX = other.velocity.x - velocity.x
    const velocityZ = other.velocity.z - velocity.z
    const velocitySquared = velocityX * velocityX + velocityZ * velocityZ
    const closing = dx * velocityX + dz * velocityZ
    const verticalOverlap = Math.abs(position.y - other.position.y) < bodyRadius + other.verticalClearance
    if (verticalOverlap && closing < 0 && velocitySquared > 1e-5) {
      const closestTime = -closing / velocitySquared
      const closestX = dx + velocityX * closestTime
      const closestZ = dz + velocityZ * closestTime
      let forwardX = heading.x
      let forwardZ = heading.z
      const forwardLength = Math.hypot(forwardX, forwardZ)
      if (forwardLength > 1e-5) { forwardX /= forwardLength; forwardZ /= forwardLength }
      else { const angle = seededUnit(specimenId, 303) * Math.PI * 2; forwardX = Math.cos(angle); forwardZ = Math.sin(angle) }
      const sideX = -forwardZ
      const sideZ = forwardX
      const longitudinalReach = envelope.longitudinal + other.longitudinal
      const lateralReach = envelope.lateral + other.lateral
      const corridorDistance = Math.hypot(
        (closestX * forwardX + closestZ * forwardZ) / longitudinalReach,
        (closestX * sideX + closestZ * sideZ) / lateralReach)
      if (closestTime <= 1.3) {
        const comfort = profile === 'territorial_cave' ? 1.8 : profile === 'territorial_cruise' ? 1.65 :
          profile === 'reef_cruise' ? 1.45 : 1.2
        let urgency = corridorDistance < 1 ? 1 - corridorDistance * .35 :
          Math.max(0, 1 - corridorDistance / comfort) * .45
        const otherSpeed = Math.hypot(other.velocity.x, other.velocity.z)
        const compatible = (profile === 'pair' || profile === 'shoal') && otherSpeed > 1e-5 &&
          (heading.x * other.velocity.x + heading.z * other.velocity.z) / otherSpeed > .5
        if (compatible && corridorDistance >= 1) urgency *= .35
        const sideDot = sideX * closestX + sideZ * closestZ
        const pairSeed = Math.min(specimenId, otherId) * 131 + Math.max(specimenId, otherId)
        const side = Math.abs(sideDot) > 1e-5 ? (sideDot > 0 ? -1 : 1) : (seededUnit(pairSeed, 304) < .5 ? -1 : 1)
        avoidance += side * urgency
      }
    }
    const socialNeighbor = profile === 'pair' ? other.profile === 'pair' : profile === 'shoal' && other.profile === 'shoal'
    if (socialNeighbor && distance > socialClearance * 1.5) {
      const otherSpeed = Math.hypot(other.velocity.x, other.velocity.z)
      socialX += dx / distance + (profile === 'shoal' && otherSpeed > 1e-5 ? other.velocity.x / otherSpeed * .55 : 0)
      socialZ += dz / distance + (profile === 'shoal' && otherSpeed > 1e-5 ? other.velocity.z / otherSpeed * .55 : 0)
    }
  }
  const routeYaw = Math.atan2(routeHeading.z, routeHeading.x)
  const socialLength = Math.hypot(socialX, socialZ)
  const socialYaw = socialLength > 0 ? Math.atan2(routeHeading.z + socialZ / socialLength * .15,
    routeHeading.x + socialX / socialLength * .15) : routeYaw
  const targetYaw = avoidance === 0 ? socialYaw : routeYaw + THREE.MathUtils.clamp(avoidance, -1, 1) * 1.05
  const currentYaw = heading.lengthSq() > 0 ? Math.atan2(heading.z, heading.x) : routeYaw
  const nextYaw = limitSpecimenFrameTurn(currentYaw, targetYaw, maxTurnRadiansPerSecond, deltaSeconds)
  heading.set(Math.cos(nextYaw), 0, Math.sin(nextYaw))
  return Math.abs(Math.atan2(Math.sin(nextYaw - currentYaw), Math.cos(nextYaw - currentYaw)))
}
export function measureSpecimenCrowd(position: THREE.Vector3, specimenId: number, awarenessClearance: number,
  positions: ReadonlyMap<number, SpecimenPosition>, awarenessScale = 2.5): SpecimenCrowd {
  let weight = 0
  let centroidX = 0
  let centroidZ = 0
  for (const [otherId, other] of positions) {
    if (otherId === specimenId) continue
    const distance = Math.hypot(position.x - other.position.x, position.z - other.position.z)
    const awareness = (awarenessClearance + other.longitudinal) * awarenessScale
    if (distance >= awareness) continue
    const neighborWeight = 1 - distance / awareness
    weight += neighborWeight
    centroidX += other.position.x * neighborWeight
    centroidZ += other.position.z * neighborWeight
  }
  if (weight === 0) return NO_SPECIMEN_CROWD
  let awayX = position.x - centroidX / weight
  let awayZ = position.z - centroidZ / weight
  const awayLength = Math.hypot(awayX, awayZ)
  if (awayLength > 1e-5) {
    awayX /= awayLength
    awayZ /= awayLength
  } else {
    const angle = seededUnit(specimenId, 302) * Math.PI * 2
    awayX = Math.cos(angle)
    awayZ = Math.sin(angle)
  }
  return { pressure: Math.min(1, weight), awayX, awayZ }
}
/** Bound world-space travel independently of render rate so target and collision changes cannot snap a specimen. */
export function limitSpecimenFrameTravel(previous: THREE.Vector3, proposed: THREE.Vector3,
  maxUnitsPerSecond: number, deltaSeconds: number) {
  const maxDistance = Math.max(0, maxUnitsPerSecond) *
    THREE.MathUtils.clamp(deltaSeconds, 0, MAX_POSITION_FRAME_SECONDS)
  const distance = proposed.distanceTo(previous)
  if (!Number.isFinite(distance)) {
    proposed.copy(previous)
    return 0
  }
  if (distance > maxDistance && distance > 0) proposed.lerp(previous, 1 - maxDistance / distance)
  return maxDistance
}
/** Turn through the shortest arc without a one-frame mirror flip around an off-center asset pivot. */
export function limitSpecimenFrameTurn(current: number, target: number,
  maxRadiansPerSecond: number, deltaSeconds: number) {
  const maxTurn = Math.max(0, maxRadiansPerSecond) *
    THREE.MathUtils.clamp(deltaSeconds, 0, MAX_POSITION_FRAME_SECONDS)
  const remaining = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + THREE.MathUtils.clamp(remaining, -maxTurn, maxTurn)
}
type SpeciesSkins = Readonly<Record<'watchman_goby', THREE.Texture>>
type MouthPositions = Map<number, THREE.Vector3>
type FoodAssignments = ReadonlyMap<number, number>

export type ProceduralSpecimenFallback = 'watchman_goby' | 'pistol_shrimp' | 'epaulette_shark'

export interface SpecimenVisualPlan {
  readonly renderAcceptedAsset: boolean
  readonly proceduralFallback?: ProceduralSpecimenFallback
}

/** Accepted assets are the sole primary visual. Procedural bodies remain a fail-safe only. */
export function resolveSpecimenVisualPlan(speciesId: string, hasAcceptedAsset: boolean): SpecimenVisualPlan {
  if (hasAcceptedAsset) return { renderAcceptedAsset: true }
  if (speciesId === 'watchman_goby' || speciesId === 'pistol_shrimp' || speciesId === 'epaulette_shark') {
    return { renderAcceptedAsset: false, proceduralFallback: speciesId }
  }
  return { renderAcceptedAsset: false }
}

export function isRenderableLivestockSpecies(speciesId: string, hasAcceptedAsset: boolean) {
  const plan = resolveSpecimenVisualPlan(speciesId, hasAcceptedAsset)
  return plan.renderAcceptedAsset || Boolean(plan.proceduralFallback)
}

/** Hunger decides priority, but every eligible fish receives one portion before repeats. */
export function assignPelletTargets(specimens: readonly PocketSpecimen[], food: readonly ScenePellet[],
  mouths: ReadonlyMap<number, THREE.Vector3>, waterSurfaceY: number) {
  void waterSurfaceY
  const assignments = new Map<number, number>()
  const fedThisPass = new Set<number>()
  for (const pellet of [...food].sort((a, b) => a.id - b.id)) {
    const candidates = specimens.filter((specimen) => specimen.alive && specimen.kind === 'fish' && specimen.hunger > .05 &&
      (specimen.layer !== 'bottom' || pellet.sunk)).map((specimen) => {
      const mouth = mouths.get(specimen.id)
      const distance = mouth ? mouth.distanceTo(pellet) : 0
      return { specimen, alreadyFed: fedThisPass.has(specimen.id), distance }
    }).sort((a, b) => Number(a.alreadyFed) - Number(b.alreadyFed) ||
      b.specimen.hunger - a.specimen.hunger || a.distance - b.distance || a.specimen.id - b.specimen.id)
    const winner = candidates[0]?.specimen
    if (winner) {
      assignments.set(pellet.id, winner.id)
      fedThisPass.add(winner.id)
    }
  }
  return assignments
}

/** Padding over the raw rock scale: the rendered icosahedron hardscape is irregular
 *  and carries pores/coral spillover, so the exclusion ellipsoid is inflated past the
 *  visual hull, plus the fish body radius, to keep fish from clipping into rock. */
const REEF_ROCK_PAD = 1.2

/** Resolve against the same padded ellipsoids that render the live-rock hardscape. */
export function resolveReefHardscape(position: THREE.Vector3, bodyRadius: number, benthic: boolean) {
  for (let pass = 0; pass < 6; pass += 1) {
    for (const rock of REEF_ROCKS) {
      const rx = rock.scale.x * REEF_ROCK_PAD + bodyRadius
      const ry = rock.scale.y * REEF_ROCK_PAD + bodyRadius
      const rz = rock.scale.z * REEF_ROCK_PAD + bodyRadius
      let nx = (position.x - rock.position.x) / rx
      let ny = (position.y - rock.position.y) / ry
      let nz = (position.z - rock.position.z) / rz
      let length = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (length >= 1) continue
      if (length < 1e-5) {
        nx = 0
        ny = benthic ? 0 : 1
        nz = 1
        length = Math.sqrt(ny * ny + nz * nz)
      }
      if (!benthic) {
        ny += .7
        length = Math.sqrt(nx * nx + ny * ny + nz * nz)
      }
      position.set(rock.position.x + nx / length * rx, rock.position.y + ny / length * ry,
        rock.position.z + nz / length * rz)
    }
  }
}

function FoodContactDriver({ food, specimens, mouths, assignments, consume }: {
  readonly food: readonly ScenePellet[]
  readonly specimens: readonly PocketSpecimen[]
  readonly mouths: MouthPositions
  readonly assignments: FoodAssignments
  readonly consume: (foodId: number, eaterId: number) => void
}) {
  const firstSeenAt = useRef(new Map<number, number>())
  const consumeSent = useRef(new Set<number>())

  useFrame(({ clock }) => {
    const nowMs = clock.getElapsedTime() * 1000
    const activeFood = new Set(food.map((pellet) => pellet.id))
    for (const id of firstSeenAt.current.keys()) if (!activeFood.has(id)) firstSeenAt.current.delete(id)
    for (const id of consumeSent.current) if (!activeFood.has(id)) consumeSent.current.delete(id)

    for (const pellet of food) {
      if (!firstSeenAt.current.has(pellet.id)) firstSeenAt.current.set(pellet.id, nowMs)
      if (consumeSent.current.has(pellet.id)) continue
      const assignedEater = assignments.get(pellet.id)
      const eater = specimens.find((specimen) => specimen.id === assignedEater && specimen.alive &&
        specimen.kind === 'fish' && specimen.hunger > .05 && (specimen.layer !== 'bottom' || pellet.sunk) &&
        visibleFoodContact(mouths.get(specimen.id) ?? { x: Infinity, y: Infinity, z: Infinity }, pellet,
          firstSeenAt.current.get(pellet.id) ?? nowMs, nowMs))
      if (!eater) continue
      consumeSent.current.add(pellet.id)
      consume(pellet.id, eater.id)
    }
  })

  return <group name="root-food-contact-driver" userData={{ contactDriver: 'root-food-contact-v1' }} />
}

function RenderedSpecimen({ specimen, snapshot, waterSurfaceY, food, assignments, mouths, positions, dispatch, geometry, skins, morphologyOverride }: {
  readonly specimen: PocketSpecimen
  readonly snapshot: ReefSnapshot
  readonly waterSurfaceY: number
  readonly food: readonly ScenePellet[]
  readonly assignments: FoodAssignments
  readonly mouths: MouthPositions
  readonly positions: SpecimenPositions
  readonly dispatch?: (action: PocketAction) => void
  readonly geometry: SpecimenGeometry
  readonly skins: SpeciesSkins
  readonly morphologyOverride?: MorphologyProfileV1
}) {
  const group = useRef<THREE.Group>(null)
  const tail = useRef<THREE.Group>(null)
  const mouthPosition = useMemo(() => new THREE.Vector3(), [])
  const fallbackMouth = useMemo(() => new THREE.Vector3(), [])
  const forage = useRef(0)
  const positionSeeded = useRef(false)
  const facingSeeded = useRef(false)
  const phase = seededUnit(specimen.id, 1) * Math.PI * 2
  const rootX = THREE.MathUtils.lerp(-TANK_HALF_WIDTH * .72, TANK_HALF_WIDTH * .72, specimen.x)
  const benthic = specimen.layer === 'bottom' || specimen.speciesId === 'epaulette_shark'
  const clearance = specimen.speciesId === 'pistol_shrimp' ? .055 : specimen.speciesId === 'epaulette_shark' ? .14 : .18
  const openWaterY = THREE.MathUtils.lerp(SAND_Y + .48, waterSurfaceY - .34, 1 - specimen.y)
  const rootY = benthic ? SAND_Y + clearance : THREE.MathUtils.clamp(openWaterY, SAND_Y + .38, waterSurfaceY - .28)
  const sceneUnitsPerMeter = TANK_HALF_WIDTH * 2 / Math.max(snapshot.tank.widthMeters, .4)
  const lifeScale = specimen.stage === 'adult' ? 1 : .68
  const length = THREE.MathUtils.clamp(specimen.adultSizeCm / 100 * sceneUnitsPerMeter * lifeScale, .16, 3.7)
  const bodyRadius = THREE.MathUtils.clamp(length * .24, .08, .34)
  const behavior = specimenBehaviorProfile(specimen.speciesId)
  const collisionEnvelope = useMemo(() => specimenCollisionEnvelope(length, bodyRadius), [bodyRadius, length])
  const route = useMemo(() => createSpecimenMotionRoute(specimen.id, specimen.layer, waterSurfaceY, bodyRadius),
    [bodyRadius, specimen.id, specimen.layer, waterSurfaceY])
  const motionState = useMemo(() => createSpecimenMotionState(route), [route])
  const routePosition = useMemo(() => new THREE.Vector3(), [])
  const routeTangent = useMemo(() => new THREE.Vector3(), [])
  const steeredHeading = useMemo(() => new THREE.Vector3(), [])
  const foodPosition = useMemo(() => new THREE.Vector3(), [])
  const foodDirection = useMemo(() => new THREE.Vector3(), [])
  const positionEntry = useMemo<SpecimenPosition>(() => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(),
    profile: behavior, ...collisionEnvelope, verticalClearance: bodyRadius }), [behavior, bodyRadius, collisionEnvelope])
  const riggedAsset = specimenAssetFor(specimen.speciesId)
  const visualPlan = resolveSpecimenVisualPlan(specimen.speciesId, Boolean(riggedAsset))
  const targetFood = food.find((pellet) => assignments.get(pellet.id) === specimen.id)
  const targetPosition = targetFood ?? null

  useEffect(() => () => {
    mouths.delete(specimen.id)
    positions.delete(specimen.id)
  }, [mouths, positions, specimen.id])

  useFrame(({ clock }, delta) => {
    const node = group.current
    if (!node) return
    const shark = specimen.speciesId === 'epaulette_shark'
    const shrimp = specimen.speciesId === 'pistol_shrimp'
    const clown = specimen.speciesId === 'ocellaris'
    const speed = (.33 + seededUnit(specimen.id, 3) * .13) * (shark ? .42 : shrimp ? .55 : 1)
    const wave = clock.getElapsedTime() * speed + phase
    forage.current += ((targetPosition ? 1 : 0) - forage.current) * (1 - Math.exp(-delta * 4.5))
    const ambientX = clown ? rootX * .25 + Math.sin(wave) * 1.55
      : benthic ? rootX * .28 + Math.sin(wave) * (shark ? 1.55 : .28) : rootX + Math.sin(wave) * .35
    const ambientY = benthic ? rootY : rootY + Math.sin(wave * .71) * .11
    const ambientZ = clown ? 1.04 + Math.cos(wave * .61) * .28
      : benthic ? .48 + Math.cos(wave * .67) * (shark ? .32 : .12) : Math.cos(wave * .8) * .4
    const direction = Math.cos(wave) >= 0 ? 1 : -1
    const mouthLead = riggedAsset ? length * .53 : length * .5
    // Depth band: keep the whole body inside the front/back glass while covering the full
    // pellet depth range (food z spans about -.62..+.62) so fish can make visible contact.
    const zLimit = TANK_HALF_DEPTH - bodyRadius
    const clampToTankGlass = () => {
      node.position.x = THREE.MathUtils.clamp(node.position.x, -TANK_HALF_WIDTH + bodyRadius, TANK_HALF_WIDTH - bodyRadius)
      node.position.y = THREE.MathUtils.clamp(node.position.y, benthic ? SAND_Y + clearance : SAND_Y + bodyRadius,
        waterSurfaceY - bodyRadius)
      node.position.z = THREE.MathUtils.clamp(node.position.z, -zLimit, zLimit)
    }
    let facingYaw: number
    if (specimen.kind === 'fish') {
      const territorial = behavior === 'territorial_cruise' || behavior === 'territorial_cave'
      const crowd = territorial && delta >= motionState.secondsUntilSwitch
        ? measureSpecimenCrowd(node.position, specimen.id, collisionEnvelope.longitudinal, positions,
          behavior === 'territorial_cave' ? 3.5 : 3) : NO_SPECIMEN_CROWD
      const progress = advanceSpecimenMotionState(motionState, route, delta, crowd)
      sampleSpecimenMotionRoute(route, progress, bodyRadius, routePosition)
      route.curve.getTangentAt(THREE.MathUtils.euclideanModulo(progress, 1), routeTangent)
        .multiplyScalar(motionState.direction).normalize()
      if (targetPosition) {
        foodPosition.set(targetPosition.x, targetPosition.y, targetPosition.z)
        foodDirection.copy(foodPosition).sub(routePosition).normalize()
        foodPosition.addScaledVector(foodDirection, -mouthLead)
        routePosition.lerp(foodPosition, forage.current)
        routeTangent.lerp(foodDirection, forage.current).normalize()
      }
      routePosition.x = THREE.MathUtils.clamp(routePosition.x, -TANK_HALF_WIDTH + bodyRadius, TANK_HALF_WIDTH - bodyRadius)
      routePosition.y = THREE.MathUtils.clamp(routePosition.y, SAND_Y + bodyRadius, waterSurfaceY - bodyRadius)
      routePosition.z = THREE.MathUtils.clamp(routePosition.z, -zLimit, zLimit)
      const guideY = routePosition.y
      foodDirection.copy(routePosition).sub(node.position).setY(0)
      if (positionSeeded.current && foodDirection.lengthSq() > 1e-5) routeTangent.lerp(foodDirection.normalize(), .18).normalize()
      const travelSpeed = Math.max(.55, length * 1.8) * (1 + forage.current)
      if (!positionSeeded.current) steeredHeading.copy(routeTangent)
      else steerSpecimenHeading(steeredHeading, routeTangent, positionEntry.velocity, node.position, specimen.id,
        bodyRadius, collisionEnvelope, positions, behavior, delta)
      if (positionSeeded.current) routePosition.set(
        node.position.x + steeredHeading.x * THREE.MathUtils.lerp(route.speed * route.curve.getLength(), travelSpeed, forage.current) * delta,
        guideY,
        node.position.z + steeredHeading.z * THREE.MathUtils.lerp(route.speed * route.curve.getLength(), travelSpeed, forage.current) * delta)
      routePosition.x = THREE.MathUtils.clamp(routePosition.x, -TANK_HALF_WIDTH + bodyRadius, TANK_HALF_WIDTH - bodyRadius)
      routePosition.y = THREE.MathUtils.clamp(routePosition.y, SAND_Y + bodyRadius, waterSurfaceY - bodyRadius)
      routePosition.z = THREE.MathUtils.clamp(routePosition.z, -zLimit, zLimit)
      if (positionSeeded.current) limitSpecimenFrameTravel(node.position, routePosition, travelSpeed, delta)
      if (positionSeeded.current && delta > 0) positionEntry.velocity.set(
        (routePosition.x - node.position.x) / delta, 0, (routePosition.z - node.position.z) / delta)
      else positionEntry.velocity.copy(steeredHeading).multiplyScalar(
        THREE.MathUtils.lerp(route.speed * route.curve.getLength(), travelSpeed, forage.current))
      node.position.copy(routePosition)
      positionSeeded.current = true
      positionEntry.position.copy(node.position)
      positionEntry.longitudinal = collisionEnvelope.longitudinal
      positionEntry.lateral = collisionEnvelope.lateral
      positionEntry.verticalClearance = bodyRadius
      positions.set(specimen.id, positionEntry)
      facingYaw = Math.atan2(-steeredHeading.z, steeredHeading.x)
    } else {
      node.position.set(ambientX, Math.min(ambientY, waterSurfaceY - .2), THREE.MathUtils.clamp(ambientZ, -zLimit, zLimit))
      resolveReefHardscape(node.position, bodyRadius, benthic)
      clampToTankGlass()
      facingYaw = direction < 0 ? Math.PI : 0
    }
    node.rotation.set(benthic ? -.03 : Math.sin(wave * .53) * .04,
      facingSeeded.current ? limitSpecimenFrameTurn(node.rotation.y, facingYaw, 5.2, delta) : facingYaw,
      benthic ? 0 : Math.sin(wave * .67) * .055)
    facingSeeded.current = true
    const scaleX = specimen.kind === 'fish' ? 1 : direction
    node.scale.set(scaleX * (riggedAsset ? 1 : length), riggedAsset ? 1 : length, riggedAsset ? 1 : length)
    if (tail.current) {
      const tailAmplitude = shark ? .1 : shrimp ? 0 : specimen.speciesId === 'watchman_goby' ? .14 : .22
      tail.current.rotation.y = Math.sin(wave * 8.2) * tailAmplitude * (1 + forage.current * .45)
    }
    const rigMouth = riggedAsset ? node.getObjectByName(`PA_${specimen.speciesId}_Mouth`) : undefined
    let usableRigMouth = false
    if (rigMouth) {
      rigMouth.getWorldPosition(mouthPosition)
      // Food and steering coordinates are local to the habitat. Keep the sampled mouth
      // in that same space; the habitat itself is translated slightly inside ReefScene.
      node.parent?.worldToLocal(mouthPosition)
      // The current clown asset contains a named mouth node at its root origin. Treat
      // that zero-length authoring marker as missing so pursuit reaches the visible snout.
      usableRigMouth = mouthPosition.distanceTo(node.position) > length * .1
    }
    if (!usableRigMouth) {
      node.localToWorld(mouthPosition.copy(fallbackMouth.set(riggedAsset ? mouthLead : .5, 0, 0)))
      node.parent?.worldToLocal(mouthPosition)
    }
    mouths.set(specimen.id, mouthPosition)
  })

  return <group ref={group} name={`root-specimen-${specimen.speciesId}-${specimen.id}`}
    userData={{ rootSpecimenId: specimen.id, speciesId: specimen.speciesId, mouthAnchor: riggedAsset ? 'rig-node-or-fallback' : 'body-fallback' }}
    onClick={(event) => {
      event.stopPropagation()
      dispatch?.({ type: 'SELECT_ENTITY', entityType: 'livestock', id: specimen.id })
    }}>
    {visualPlan.renderAcceptedAsset && riggedAsset && <RiggedSpecimen asset={riggedAsset} individualId={specimen.id}
      targetLengthSceneUnits={length} stage={specimen.stage} hunger={specimen.hunger}
      feedDrive={forage} />}
    {morphologyOverride?.speciesId === specimen.speciesId &&
      <DraftMorphologyOverlay profile={morphologyOverride} targetLengthSceneUnits={length} />}
    {visualPlan.proceduralFallback === 'watchman_goby' &&
      <WatchmanGoby geometry={geometry} skin={skins.watchman_goby} tailRef={tail} />}
    {visualPlan.proceduralFallback === 'epaulette_shark' && <EpauletteShark geometry={geometry} tailRef={tail} />}
    {visualPlan.proceduralFallback === 'pistol_shrimp' && <PistolShrimp />}
  </group>
}

function AcceptedShowcaseAnimal({ asset, index, snapshot, waterSurfaceY, positions }: {
  readonly asset: SpecimenAsset
  readonly index: number
  readonly snapshot: ReefSnapshot
  readonly waterSurfaceY: number
  readonly positions: SpecimenPositions
}) {
  const group = useRef<THREE.Group>(null)
  const feedDrive = useRef(0)
  const positionSeeded = useRef(false)
  const facingSeeded = useRef(false)
  const phase = seededUnit(index + 1, 91) * Math.PI * 2
  const column = index % 5
  const row = Math.floor(index / 5)
  const fish = asset.category === 'fish'
  const layer = SHOWCASE_FISH_LAYERS[asset.speciesId] ?? 'mid'
  const benthic = !fish
  const anchorX = THREE.MathUtils.lerp(-2.2, 2.2, column / 4)
  const anchorY = benthic ? SAND_Y + .12 : THREE.MathUtils.lerp(SAND_Y + .48, waterSurfaceY - .38, row / 4)
  const anchorZ = THREE.MathUtils.lerp(-.72, .72, ((index * 3) % 5) / 4)
  const sceneUnitsPerMeter = TANK_HALF_WIDTH * 2 / Math.max(snapshot.tank.widthMeters, .4)
  const length = THREE.MathUtils.clamp(asset.referenceAdultLengthMeters * sceneUnitsPerMeter, .12, .72)
  const bodyRadius = THREE.MathUtils.clamp(length * .24, .05, .18)
  const behavior = specimenBehaviorProfile(asset.speciesId)
  const collisionEnvelope = useMemo(() => specimenCollisionEnvelope(length, bodyRadius), [bodyRadius, length])
  const specimenId = -(index + 1)
  const route = useMemo(() => createSpecimenMotionRoute(specimenId, layer, waterSurfaceY, bodyRadius),
    [bodyRadius, index, layer, waterSurfaceY])
  const motionState = useMemo(() => createSpecimenMotionState(route), [route])
  const routePosition = useMemo(() => new THREE.Vector3(), [])
  const routeTangent = useMemo(() => new THREE.Vector3(), [])
  const steeredHeading = useMemo(() => new THREE.Vector3(), [])
  const guideDirection = useMemo(() => new THREE.Vector3(), [])
  const positionEntry = useMemo<SpecimenPosition>(() => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(),
    profile: behavior, ...collisionEnvelope, verticalClearance: bodyRadius }), [behavior, bodyRadius, collisionEnvelope])
  useEffect(() => () => { positions.delete(specimenId) }, [positions, specimenId])

  useFrame(({ clock }, delta) => {
    const node = group.current
    if (!node) return
    const wave = clock.getElapsedTime() * (.24 + seededUnit(index + 1, 92) * .1) + phase
    const direction = Math.cos(wave) >= 0 ? 1 : -1
    if (fish) {
      const territorial = behavior === 'territorial_cruise' || behavior === 'territorial_cave'
      const crowd = territorial && delta >= motionState.secondsUntilSwitch
        ? measureSpecimenCrowd(node.position, specimenId, collisionEnvelope.longitudinal, positions,
          behavior === 'territorial_cave' ? 3.5 : 3) : NO_SPECIMEN_CROWD
      const progress = advanceSpecimenMotionState(motionState, route, delta, crowd)
      sampleSpecimenMotionRoute(route, progress, bodyRadius, routePosition)
      route.curve.getTangentAt(THREE.MathUtils.euclideanModulo(progress, 1), routeTangent)
        .multiplyScalar(motionState.direction).normalize()
      const guideY = routePosition.y
      guideDirection.copy(routePosition).sub(node.position).setY(0)
      if (positionSeeded.current && guideDirection.lengthSq() > 1e-5) routeTangent.lerp(guideDirection.normalize(), .18).normalize()
      const travelSpeed = Math.max(.35, length * 1.8)
      if (!positionSeeded.current) steeredHeading.copy(routeTangent)
      else steerSpecimenHeading(steeredHeading, routeTangent, positionEntry.velocity, node.position, specimenId,
        bodyRadius, collisionEnvelope, positions, behavior, delta)
      if (positionSeeded.current) routePosition.set(
        node.position.x + steeredHeading.x * route.speed * route.curve.getLength() * delta, guideY,
        node.position.z + steeredHeading.z * route.speed * route.curve.getLength() * delta)
      routePosition.x = THREE.MathUtils.clamp(routePosition.x, -TANK_HALF_WIDTH + bodyRadius, TANK_HALF_WIDTH - bodyRadius)
      routePosition.y = THREE.MathUtils.clamp(routePosition.y, route.yBounds[0], route.yBounds[1])
      routePosition.z = THREE.MathUtils.clamp(routePosition.z, -TANK_HALF_DEPTH + bodyRadius, TANK_HALF_DEPTH - bodyRadius)
      if (positionSeeded.current) limitSpecimenFrameTravel(node.position, routePosition,
        Math.max(.35, length * 1.8), delta)
      if (positionSeeded.current && delta > 0) positionEntry.velocity.set(
        (routePosition.x - node.position.x) / delta, 0, (routePosition.z - node.position.z) / delta)
      else positionEntry.velocity.copy(steeredHeading).multiplyScalar(route.speed * route.curve.getLength())
      node.position.copy(routePosition)
      positionSeeded.current = true
      positionEntry.position.copy(node.position)
      positionEntry.longitudinal = collisionEnvelope.longitudinal
      positionEntry.lateral = collisionEnvelope.lateral
      positionEntry.verticalClearance = bodyRadius
      positions.set(specimenId, positionEntry)
      const facingYaw = Math.atan2(-steeredHeading.z, steeredHeading.x)
      node.rotation.set(Math.sin(wave * .53) * .035,
        facingSeeded.current ? limitSpecimenFrameTurn(node.rotation.y, facingYaw, 5.2, delta) : facingYaw, 0)
      facingSeeded.current = true
      node.scale.x = 1
    } else {
      node.position.set(anchorX + Math.sin(wave) * .1, anchorY, anchorZ + Math.cos(wave * .61) * .1)
      resolveReefHardscape(node.position, bodyRadius, true)
      node.position.x = THREE.MathUtils.clamp(node.position.x, -TANK_HALF_WIDTH + .12, TANK_HALF_WIDTH - .12)
      node.position.y = THREE.MathUtils.clamp(node.position.y, SAND_Y + .08, waterSurfaceY - .18)
      node.position.z = THREE.MathUtils.clamp(node.position.z, -TANK_HALF_DEPTH + .12, TANK_HALF_DEPTH - .12)
      node.rotation.set(0, Math.sin(wave * .61) * .18, 0)
      node.scale.x = direction
    }
  })

  return <group ref={group} name={`accepted-showcase-${asset.speciesId}`}
    userData={{ authority: 'accepted-catalog-visual-only', speciesId: asset.speciesId }}>
    <RiggedSpecimen asset={asset} individualId={-(index + 1)} targetLengthSceneUnits={length}
      stage="adult" hunger={0} feedDrive={feedDrive} />
  </group>
}

export function resolveSpecimenPopulations(
  roster: readonly PocketSpecimen[],
  showcaseCatalog?: AcceptedShowcaseCatalog,
) {
  if (showcaseCatalog) return { authoritative: [] as readonly PocketSpecimen[], visualOnly: showcaseCatalog.animalAssets }
  return {
    authoritative: roster.filter((specimen) => specimen.alive &&
      isRenderableLivestockSpecies(specimen.speciesId, Boolean(specimenAssetFor(specimen.speciesId)))).slice(0, MAX_SPECIMENS),
    visualOnly: [] as readonly SpecimenAsset[],
  }
}

function AuthoritativeSpecimenPopulation({ snapshot, waterSurfaceY, pellets, consume, roster, positions, morphologyOverride, dispatch }: SpecimenFishProps & {
  readonly roster: readonly PocketSpecimen[]
  readonly positions: SpecimenPositions
  readonly morphologyOverride?: MorphologyProfileV1
  readonly dispatch?: (action: PocketAction) => void
}) {
  const mouths = useMemo<MouthPositions>(() => new Map(), [])
  const geometry = useSpecimenGeometry()
  const gobySource = useLoader(THREE.TextureLoader, VISUAL_SKINS.watchman_goby.url)
  const skins = useMemo(() => ({
    watchman_goby: cropSkin(gobySource, VISUAL_SKINS.watchman_goby),
  }), [gobySource])
  useEffect(() => () => Object.values(skins).forEach((skin) => skin.dispose()), [skins])
  const assignments = assignPelletTargets(roster, pellets, mouths, waterSurfaceY)
  return <group name="root-pocket-aquarium-specimens">
    <FoodContactDriver food={pellets} specimens={roster} mouths={mouths} assignments={assignments}
      consume={consume} />
    {roster.map((specimen) => <RenderedSpecimen key={specimen.id} specimen={specimen} snapshot={snapshot}
      waterSurfaceY={waterSurfaceY} food={pellets} mouths={mouths} assignments={assignments} positions={positions}
      dispatch={dispatch} geometry={geometry} skins={skins}
      morphologyOverride={morphologyOverride?.speciesId === specimen.speciesId ? morphologyOverride : undefined} />)}
  </group>
}

export function SpecimenFish(props: SpecimenFishProps) {
  const { specimens, showcaseCatalog, morphologyOverride, dispatch } = useContext(SpecimenRosterContext)
  const populations = resolveSpecimenPopulations(specimens, showcaseCatalog)
  const positions = useMemo<SpecimenPositions>(() => new Map(), [])
  if (showcaseCatalog) return <group name="accepted-showcase-specimens"
    userData={{ authority: 'accepted-catalog-visual-only', acceptedSpeciesCount: showcaseCatalog.acceptedSpeciesCount,
      visibleAnimalCount: populations.visualOnly.length }}>
    {populations.visualOnly.map((asset, index) => <AcceptedShowcaseAnimal key={asset.key} asset={asset} index={index}
      snapshot={props.snapshot} waterSurfaceY={props.waterSurfaceY} positions={positions} />)}
  </group>
  return <AuthoritativeSpecimenPopulation {...props} roster={populations.authoritative}
    morphologyOverride={morphologyOverride} dispatch={dispatch} positions={positions} />
}
