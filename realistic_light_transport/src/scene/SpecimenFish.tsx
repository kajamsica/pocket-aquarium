import { useFrame, useLoader } from '@react-three/fiber'
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import * as THREE from 'three'

import type { ReefSnapshot } from '../contracts'
import type { PocketAction, PocketSpecimen } from '../integration/pocketAquariumBridge'
import { sampleFlowField } from '../sim/flowField'
import type { MorphologyProfileV1 } from '../specimens/specimenProfile'
import { evaluateMorphology } from '../workbench/geometry/evaluateMorphology'
import type { ScenePellet } from './feeding'
import { FOOD_CONTACT_RADIUS, type ScenePoint, visibleFoodContact } from './foodContact'
import type { FlowFieldSource } from './ReefHabitat'
import { REEF_ROCKS } from './reefLayout'
import {
  fishPaceMultiplier,
  fishRouteWaypoints,
  isAcceptedAnimalSpeciesId,
  isSurfaceBoundLocomotion,
  resolveSpecimenLocomotionPlan,
  speciesBehaviorPolicyFor,
} from './speciesBehavior'
import {
  ACCEPTED_SPECIES_IDS,
  specimenAssetFor,
  type SpecimenAsset,
} from './specimens/assetRegistry'
import { RiggedSpecimen } from './specimens/RiggedSpecimen'
import { createSurfaceCircuit, sampleSurfaceCircuit, type SurfaceCircuit, type SurfacePose } from './surfaceLocomotion'

const MAX_SPECIMENS = 25
const TANK_HALF_WIDTH = 2.76
// Believable inner water depth (front/back glass). Mirrors the width inset from the
// rendered tank so fish swim the full depth band without clipping the glass panels.
const TANK_HALF_DEPTH = 1.2
const SAND_Y = -1.44
const MAX_POSITION_FRAME_SECONDS = .05
const MAX_FISH_FLOW_STEP = 0.025
const FISH_MOTION_FRAME_PRIORITY = -2
const FOOD_CONTACT_FRAME_PRIORITY = -1
/** The selected marker is presentation only: it must never become a click or feed-tap target. */
const MARKER_NO_RAYCAST = () => null
/** Transient pointer presentation only. It carries an id and viewport point; the HUD reads the
 *  live name and health for that id out of the authoritative root view, so a hover label can
 *  never drift from the projected resident it names. */
export interface SpecimenHover {
  readonly id: number
  readonly x: number
  readonly y: number
}
interface SpecimenRosterValue {
  readonly specimens: readonly PocketSpecimen[]
  readonly morphologyOverride?: MorphologyProfileV1
  readonly dispatch?: (action: PocketAction) => void
  /** Root `view.selection` is the only selection authority; this is that answer, not a second store. */
  readonly selectedSpecimenId?: number | null
  readonly onHoverSpecimen?: (hover: SpecimenHover | null) => void
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

export function SpecimenRosterProvider({ specimens, morphologyOverride, dispatch,
  selectedSpecimenId, onHoverSpecimen, children }: {
  readonly specimens: readonly PocketSpecimen[]
  readonly morphologyOverride?: MorphologyProfileV1
  readonly dispatch?: (action: PocketAction) => void
  readonly selectedSpecimenId?: number | null
  readonly onHoverSpecimen?: (hover: SpecimenHover | null) => void
  readonly children: ReactNode
}) {
  const value = useMemo(() => ({ specimens, morphologyOverride, dispatch, selectedSpecimenId, onHoverSpecimen }),
    [dispatch, morphologyOverride, onHoverSpecimen, selectedSpecimenId, specimens])
  return <SpecimenRosterContext.Provider value={value}>{children}</SpecimenRosterContext.Provider>
}

/** The tank's root dispatch, for any other selectable entity rendered inside this provider. */
export function useSpecimenDispatch() {
  return useContext(SpecimenRosterContext).dispatch
}

export interface SpecimenFishProps {
  readonly snapshot: ReefSnapshot
  readonly waterSurfaceY: number
  readonly pellets: readonly ScenePellet[]
  readonly flowField: FlowFieldSource
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

/** Fairly distributes edible portions while allowing one meal to reach a waiting bottom resident. */
export function assignPelletTargets(specimens: readonly PocketSpecimen[], food: readonly ScenePellet[],
  mouths: ReadonlyMap<number, THREE.Vector3>, waterSurfaceY: number) {
  void waterSurfaceY
  const assignments = new Map<number, number>()
  const fedThisPass = new Set<number>()
  const hungryResidents = specimens.filter((specimen) => specimen.alive && specimen.hunger > .05 &&
    (!isAcceptedAnimalSpeciesId(specimen.speciesId) ||
      !isSurfaceBoundLocomotion(resolveSpecimenLocomotionPlan(specimen.speciesId))))
  const hungryBottom = hungryResidents.filter((specimen) => specimen.layer === 'bottom')
  const hungryWaterColumn = hungryResidents.filter((specimen) => specimen.layer !== 'bottom')
  // Freshly stocked residents share a lastFedDay, so an equal history must still reserve;
  // a strict comparison silently disabled the reservation for every new tank.
  const reserveForBottom = hungryBottom.length > 0 && hungryWaterColumn.length > 0 && hungryBottom.some((bottom) =>
    hungryWaterColumn.every((waterColumn) => bottom.lastFedDay <= waterColumn.lastFedDay))
  let reservedFallingPortion = false
  for (const pellet of [...food].sort((a, b) => a.id - b.id)) {
    const reservedForBottomEater = !pellet.sunk && reserveForBottom && !reservedFallingPortion
    if (reservedForBottomEater) reservedFallingPortion = true
    const candidates = hungryResidents.filter((specimen) => reservedForBottomEater
      ? specimen.layer === 'bottom' : specimen.layer !== 'bottom' || pellet.sunk).map((specimen) => {
      const mouth = mouths.get(specimen.id)
      const distance = mouth ? mouth.distanceTo(pellet) : 0
      return { specimen, alreadyFed: fedThisPass.has(specimen.id), distance }
    }).sort((a, b) => Number(a.alreadyFed) - Number(b.alreadyFed) ||
      (pellet.sunk && a.specimen.lastFedDay !== b.specimen.lastFedDay
        ? a.specimen.lastFedDay < b.specimen.lastFedDay ? -1 : 1
        : 0) ||
      // Settled food is the only food a bottom resident can reach, so on equal feeding
      // history it wins the portion instead of losing the id tiebreak to a water-column fish.
      (pellet.sunk ? Number(b.specimen.layer === 'bottom') - Number(a.specimen.layer === 'bottom') : 0) ||
      b.specimen.hunger - a.specimen.hunger || a.specimen.id - b.specimen.id || a.distance - b.distance)
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
const SPECIMEN_ROCK_AVOIDANCE_RANGE = 1.48
const SPECIMEN_ROCK_TURN_ARC = 1.18
const LOCAL_FORWARD = new THREE.Vector3(1, 0, 0)
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const BODY_SAMPLE_OFFSETS = [-1, 0, 1] as const
const MOTION_HEADING_SPEED_EPSILON = .01

function specimenRockClearance(position: THREE.Vector3, heading: THREE.Vector3,
  halfSpan: number, bodyRadius: number, rock: (typeof REEF_ROCKS)[number]) {
  let minimum = Infinity
  for (const offset of BODY_SAMPLE_OFFSETS) {
    const sampleX = position.x + heading.x * offset * halfSpan
    const sampleY = position.y + heading.y * offset * halfSpan
    const sampleZ = position.z + heading.z * offset * halfSpan
    const nx = (sampleX - rock.position.x) / (rock.scale.x * REEF_ROCK_PAD + bodyRadius)
    const ny = (sampleY - rock.position.y) / (rock.scale.y * REEF_ROCK_PAD + bodyRadius)
    const nz = (sampleZ - rock.position.z) / (rock.scale.z * REEF_ROCK_PAD + bodyRadius)
    minimum = Math.min(minimum, Math.hypot(nx, ny, nz))
  }
  return minimum
}

export function minimumSpecimenHardscapeClearance(position: THREE.Vector3, heading: THREE.Vector3,
  halfSpan: number, bodyRadius: number) {
  return Math.min(...REEF_ROCKS.map((rock) => specimenRockClearance(
    position, heading, halfSpan, bodyRadius, rock)))
}

/** Bias the route toward one deterministic passing arc before the body reaches a rendered rock. */
export function guideSpecimenAroundHardscape(desiredHeading: THREE.Vector3, currentHeading: THREE.Vector3,
  position: THREE.Vector3, specimenId: number, halfSpan: number, bodyRadius: number) {
  const forwardLength = Math.hypot(currentHeading.x, currentHeading.z)
  const forwardX = forwardLength > 1e-5 ? currentHeading.x / forwardLength : 1
  const forwardZ = forwardLength > 1e-5 ? currentHeading.z / forwardLength : 0
  const lookAhead = halfSpan * 1.25 + bodyRadius * 2.4
  const predicted = new THREE.Vector3(position.x + forwardX * lookAhead, position.y,
    position.z + forwardZ * lookAhead)
  let strongest = 0
  let passingSide = 0
  for (let rockIndex = 0; rockIndex < REEF_ROCKS.length; rockIndex += 1) {
    const rock = REEF_ROCKS[rockIndex]
    const clearance = specimenRockClearance(predicted, currentHeading, halfSpan, bodyRadius, rock)
    const strength = THREE.MathUtils.clamp(
      (SPECIMEN_ROCK_AVOIDANCE_RANGE - clearance) / (SPECIMEN_ROCK_AVOIDANCE_RANGE - 1), 0, 1)
    if (strength <= strongest) continue
    const awayX = predicted.x - rock.position.x
    const awayZ = predicted.z - rock.position.z
    const cross = forwardX * awayZ - forwardZ * awayX
    passingSide = Math.abs(cross) > .025 ? Math.sign(cross) :
      (seededUnit(specimenId + rockIndex * 17, 611) < .5 ? -1 : 1)
    strongest = strength
  }
  if (strongest === 0) return 0
  const routeYaw = Math.atan2(desiredHeading.z, desiredHeading.x)
  const guidedYaw = routeYaw + passingSide * SPECIMEN_ROCK_TURN_ARC * strongest
  desiredHeading.x = Math.cos(guidedYaw)
  desiredHeading.z = Math.sin(guidedYaw)
  return strongest
}

/** Last-resort X/Z guard. A safe prior frame is clipped to the last clear point on its
 * forward segment, so the result stays within the existing travel cap and never changes Y. */
export function constrainSpecimenHardscapeTravel(previous: THREE.Vector3, proposed: THREE.Vector3,
  heading: THREE.Vector3, halfSpan: number, bodyRadius: number) {
  if (minimumSpecimenHardscapeClearance(proposed, heading, halfSpan, bodyRadius) >= 1) return false
  const start = new THREE.Vector3(previous.x, proposed.y, previous.z)
  if (minimumSpecimenHardscapeClearance(start, heading, halfSpan, bodyRadius) < 1) {
    proposed.x = previous.x
    proposed.z = previous.z
    return true
  }
  const endX = proposed.x
  const endZ = proposed.z
  let clear = 0
  let blocked = 1
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const sample = (clear + blocked) * .5
    proposed.x = THREE.MathUtils.lerp(previous.x, endX, sample)
    proposed.z = THREE.MathUtils.lerp(previous.z, endZ, sample)
    if (minimumSpecimenHardscapeClearance(proposed, heading, halfSpan, bodyRadius) >= 1) clear = sample
    else blocked = sample
  }
  proposed.x = THREE.MathUtils.lerp(previous.x, endX, clear)
  proposed.z = THREE.MathUtils.lerp(previous.z, endZ, clear)
  return true
}

/** Keep a body's yaw arc from rotating its nose through rock before forward travel begins. */
export function constrainSpecimenHardscapeTurn(position: THREE.Vector3, previousHeading: THREE.Vector3,
  proposedHeading: THREE.Vector3, halfSpan: number, bodyRadius: number) {
  if (minimumSpecimenHardscapeClearance(position, proposedHeading, halfSpan, bodyRadius) >= 1) return false
  const previousYaw = Math.atan2(previousHeading.z, previousHeading.x)
  const proposedYaw = Math.atan2(proposedHeading.z, proposedHeading.x)
  const yawDelta = Math.atan2(Math.sin(proposedYaw - previousYaw), Math.cos(proposedYaw - previousYaw))
  let clear = 0
  let blocked = 1
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const sample = (clear + blocked) * .5
    proposedHeading.set(Math.cos(previousYaw + yawDelta * sample), 0,
      Math.sin(previousYaw + yawDelta * sample))
    if (minimumSpecimenHardscapeClearance(position, proposedHeading, halfSpan, bodyRadius) >= 1) clear = sample
    else blocked = sample
  }
  proposedHeading.set(Math.cos(previousYaw + yawDelta * clear), 0,
    Math.sin(previousYaw + yawDelta * clear))
  return true
}

interface MotionProfile {
  readonly cruiseSpeed: number
  readonly pursuitSpeed: number
  readonly acceleration: number
  readonly turnRate: number
  readonly arrivalRadius: number
  readonly lookAhead: number
  readonly retargetSeconds: number
  readonly roamX: number
  readonly roamY: number
  readonly roamZ: number
}

interface FishPhysicsState {
  readonly position: THREE.Vector3
  readonly velocity: THREE.Vector3
  readonly forward: THREE.Vector3
  readonly crowdHeading: THREE.Vector3
  readonly roamTarget: THREE.Vector3
  readonly desired: THREE.Vector3
  readonly desiredDirection: THREE.Vector3
  readonly avoidance: THREE.Vector3
  readonly predicted: THREE.Vector3
  readonly sample: THREE.Vector3
  readonly correction: THREE.Vector3
  readonly previousPosition: THREE.Vector3
  readonly previousForward: THREE.Vector3
  readonly orientation: THREE.Quaternion
  readonly targetOrientation: THREE.Quaternion
  readonly orientationMatrix: THREE.Matrix4
  readonly orientationUp: THREE.Vector3
  readonly orientationSide: THREE.Vector3
  initialized: boolean
  nextRoamAt: number
  roamIndex: number
}

export function specimenMotionProfile(speciesId: string): MotionProfile {
  if (speciesId === 'epaulette_shark') return {
    cruiseSpeed: .28, pursuitSpeed: .38, acceleration: .48, turnRate: .62,
    arrivalRadius: .8, lookAhead: .82, retargetSeconds: 5.2, roamX: 1.65, roamY: .025, roamZ: .48,
  }
  if (resolveSpecimenLocomotionPlan(speciesId)?.endsWith('_crawler')) return {
    cruiseSpeed: speciesId === 'cleaner_shrimp' ? .052 : speciesId.includes('shrimp') || speciesId.includes('crab') ? .04 : .024,
    pursuitSpeed: .06, acceleration: .12, turnRate: 1.1,
    arrivalRadius: .12, lookAhead: .15, retargetSeconds: 12, roamX: 0, roamY: 0, roamZ: 0,
  }
  if (speciesId === 'watchman_goby' || speciesId === 'diamond_goby') return {
    cruiseSpeed: speciesId === 'watchman_goby' ? .16 : .2, pursuitSpeed: .48, acceleration: .7, turnRate: 1.6,
    arrivalRadius: .42, lookAhead: .48, retargetSeconds: 3.7, roamX: .52, roamY: .035, roamZ: .4,
  }
  if (speciesId.endsWith('_tang') || speciesId === 'six_line_wrasse') return {
    cruiseSpeed: speciesId === 'six_line_wrasse' ? .48 : .52, pursuitSpeed: .78, acceleration: 1.25,
    turnRate: 2.15, arrivalRadius: .7, lookAhead: .62, retargetSeconds: 3.6, roamX: 1.7, roamY: .16, roamZ: .78,
  }
  if (speciesId === 'ocellaris' || speciesId === 'black_storm_ocellaris' ||
    speciesId === 'banggai_cardinal' || speciesId === 'royal_gramma') return {
    cruiseSpeed: .3, pursuitSpeed: .58, acceleration: .9, turnRate: 1.9,
    arrivalRadius: .48, lookAhead: .38, retargetSeconds: 4.2, roamX: .62, roamY: .12, roamZ: .45,
  }
  return {
    cruiseSpeed: .42, pursuitSpeed: .72, acceleration: 1.35, turnRate: 2.4,
    arrivalRadius: .62, lookAhead: .45, retargetSeconds: 2.8, roamX: 1.15, roamY: .22, roamZ: .42,
  }
}

/** Cleaner shrimp patrol a short repeatable section of one rock instead of crossing the tank. */
export function specimenSurfaceProgress(speciesId: string, circuit: SurfaceCircuit, seed: number,
  elapsedSeconds: number, speed: number) {
  if (speciesId !== 'cleaner_shrimp') {
    return THREE.MathUtils.euclideanModulo(seededUnit(seed, 901) +
      elapsedSeconds * speed / Math.max(circuit.totalLength, .01), 1)
  }
  let prefix = 0
  const station = circuit.segments.find((segment) => {
    if (segment.kind === 'rock') return true
    prefix += segment.length
    return false
  })
  if (!station) return 0
  const patrol = .5 + Math.sin((elapsedSeconds / 18 + seededUnit(seed, 902)) * Math.PI * 2) * .035
  return (prefix + station.length * patrol) / circuit.totalLength
}

/** Keep authored +X-forward fish upright while allowing a small, smoothly capped turn bank. */
export function updateUprightSpecimenOrientation(current: THREE.Quaternion, forward: THREE.Vector3,
  bankRadians: number, maximumTurnRadians: number, target = new THREE.Quaternion()) {
  const horizontal = Math.hypot(forward.x, forward.z)
  const maximumVertical = horizontal * Math.tan(THREE.MathUtils.degToRad(11.5))
  const xAxis = new THREE.Vector3(forward.x,
    THREE.MathUtils.clamp(forward.y, -maximumVertical, maximumVertical), forward.z)
  if (xAxis.lengthSq() < 1e-8) xAxis.set(1, 0, 0)
  xAxis.normalize()
  const zAxis = new THREE.Vector3().crossVectors(xAxis, WORLD_UP)
  if (zAxis.lengthSq() < 1e-8) zAxis.set(0, 0, 1)
  else zAxis.normalize()
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize()
  target.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis))
  target.multiply(new THREE.Quaternion().setFromAxisAngle(LOCAL_FORWARD,
    THREE.MathUtils.clamp(bankRadians, -.14, .14)))
  current.rotateTowards(target, Math.max(0, maximumTurnRadians)).normalize()
  return current
}

function clampBetween(value: number, minimum: number, maximum: number) {
  return minimum <= maximum ? THREE.MathUtils.clamp(value, minimum, maximum) : (minimum + maximum) * .5
}

function turnTowards(current: THREE.Vector3, target: THREE.Vector3, maximumAngle: number, axis: THREE.Vector3) {
  const angle = current.angleTo(target)
  if (angle <= maximumAngle) return current.copy(target)
  axis.crossVectors(current, target)
  if (axis.lengthSq() < 1e-8) {
    axis.crossVectors(current, Math.abs(current.y) < .9 ? WORLD_UP : LOCAL_FORWARD)
  }
  return current.applyAxisAngle(axis.normalize(), maximumAngle).normalize()
}

function clampBodyToTank(position: THREE.Vector3, forward: THREE.Vector3, halfSpan: number,
  bodyRadius: number, benthic: boolean, clearance: number, waterSurfaceY: number) {
  const extentX = Math.abs(forward.x) * halfSpan + bodyRadius
  const extentY = Math.abs(forward.y) * halfSpan + bodyRadius
  const extentZ = Math.abs(forward.z) * halfSpan + bodyRadius
  position.x = clampBetween(position.x, -TANK_HALF_WIDTH + extentX, TANK_HALF_WIDTH - extentX)
  position.y = clampBetween(position.y, SAND_Y + (benthic ? Math.max(clearance, extentY) : extentY),
    waterSurfaceY - extentY)
  position.z = clampBetween(position.z, -TANK_HALF_DEPTH + extentZ, TANK_HALF_DEPTH - extentZ)
}

/** Final numerical guard for the oriented fish body. Predictive steering is expected
 *  to avoid these corrections during ordinary movement; each sample is projected by
 *  the shortest radial displacement from a padded rock ellipsoid. */
function resolveReefBodyHardscape(position: THREE.Vector3, forward: THREE.Vector3, halfSpan: number,
  bodyRadius: number, benthic: boolean, sample: THREE.Vector3, correction: THREE.Vector3) {
  for (let pass = 0; pass < 7; pass += 1) {
    let corrected = false
    for (const offset of BODY_SAMPLE_OFFSETS) {
      sample.copy(forward).multiplyScalar(offset * halfSpan).add(position)
      for (const rock of REEF_ROCKS) {
        const rx = rock.scale.x * REEF_ROCK_PAD + bodyRadius
        const ry = rock.scale.y * REEF_ROCK_PAD + bodyRadius
        const rz = rock.scale.z * REEF_ROCK_PAD + bodyRadius
        let nx = (sample.x - rock.position.x) / rx
        let ny = (sample.y - rock.position.y) / ry
        let nz = (sample.z - rock.position.z) / rz
        let normalizedLength = Math.sqrt(nx * nx + ny * ny + nz * nz)
        if (normalizedLength >= 1) continue
        if (normalizedLength < 1e-5) {
          nx = offset || 1
          ny = benthic ? .04 : .65
          nz = .5
          normalizedLength = Math.sqrt(nx * nx + ny * ny + nz * nz)
        }
        correction.set(
          rock.position.x + nx / normalizedLength * rx - sample.x,
          rock.position.y + ny / normalizedLength * ry - sample.y,
          rock.position.z + nz / normalizedLength * rz - sample.z,
        )
        position.add(correction)
        sample.add(correction)
        corrected = true
      }
    }
    if (!corrected) break
  }
}

function addPredictiveAvoidance(state: FishPhysicsState, halfSpan: number, bodyRadius: number,
  benthic: boolean, clearance: number, waterSurfaceY: number, lookAhead: number) {
  const { avoidance, predicted, sample } = state
  avoidance.set(0, 0, 0)
  predicted.copy(state.velocity).multiplyScalar(lookAhead).add(state.position)
  const extentX = Math.abs(state.forward.x) * halfSpan + bodyRadius
  const extentY = Math.abs(state.forward.y) * halfSpan + bodyRadius
  const extentZ = Math.abs(state.forward.z) * halfSpan + bodyRadius
  const wallMargin = .34
  const minX = -TANK_HALF_WIDTH + extentX
  const maxX = TANK_HALF_WIDTH - extentX
  const minY = SAND_Y + (benthic ? Math.max(clearance, extentY) : extentY)
  const maxY = waterSurfaceY - extentY
  const minZ = -TANK_HALF_DEPTH + extentZ
  const maxZ = TANK_HALF_DEPTH - extentZ
  if (predicted.x < minX + wallMargin) avoidance.x += (minX + wallMargin - predicted.x) / wallMargin
  if (predicted.x > maxX - wallMargin) avoidance.x -= (predicted.x - maxX + wallMargin) / wallMargin
  if (predicted.y < minY + wallMargin) avoidance.y += (minY + wallMargin - predicted.y) / wallMargin
  if (predicted.y > maxY - wallMargin) avoidance.y -= (predicted.y - maxY + wallMargin) / wallMargin
  if (predicted.z < minZ + wallMargin) avoidance.z += (minZ + wallMargin - predicted.z) / wallMargin
  if (predicted.z > maxZ - wallMargin) avoidance.z -= (predicted.z - maxZ + wallMargin) / wallMargin

  for (const offset of BODY_SAMPLE_OFFSETS) {
    sample.copy(state.forward).multiplyScalar(offset * halfSpan).add(predicted)
    for (const rock of REEF_ROCKS) {
      const rx = rock.scale.x * REEF_ROCK_PAD + bodyRadius
      const ry = rock.scale.y * REEF_ROCK_PAD + bodyRadius
      const rz = rock.scale.z * REEF_ROCK_PAD + bodyRadius
      const nx = (sample.x - rock.position.x) / rx
      const ny = (sample.y - rock.position.y) / ry
      const nz = (sample.z - rock.position.z) / rz
      const normalizedLength = Math.sqrt(nx * nx + ny * ny + nz * nz)
      const avoidanceRange = 1.42
      if (normalizedLength >= avoidanceRange) continue
      state.correction.set(nx / rx, ny / ry, nz / rz)
      if (state.correction.lengthSq() < 1e-6) state.correction.set(offset || 1, benthic ? .03 : .5, .6)
      if (benthic) state.correction.y *= .12
      state.correction.normalize().multiplyScalar((avoidanceRange - Math.max(normalizedLength, .18)) * .72)
      avoidance.add(state.correction)
    }
  }
  return avoidance
}

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

function FoodContactDriver({ food, specimens, mouths, assignments, paused, consume }: {
  readonly food: readonly ScenePellet[]
  readonly specimens: readonly PocketSpecimen[]
  readonly mouths: MouthPositions
  readonly assignments: FoodAssignments
  readonly paused: boolean
  readonly consume: (foodId: number, eaterId: number) => void
}) {
  const firstSeenAt = useRef(new Map<number, number>())
  const consumeSent = useRef(new Set<number>())

  useFrame(({ clock }) => {
    // Root clock paused: rendered mouth overlap must not consume or dispatch, and a portion
    // queued while stopped is only acknowledged once the keeper resumes.
    if (paused) return
    const nowMs = clock.getElapsedTime() * 1000
    const activeFood = new Set(food.map((pellet) => pellet.id))
    for (const id of firstSeenAt.current.keys()) if (!activeFood.has(id)) firstSeenAt.current.delete(id)
    for (const id of consumeSent.current) if (!activeFood.has(id)) consumeSent.current.delete(id)

    for (const pellet of food) {
      if (!firstSeenAt.current.has(pellet.id)) firstSeenAt.current.set(pellet.id, nowMs)
      if (consumeSent.current.has(pellet.id)) continue
      const assignedEater = assignments.get(pellet.id)
      const eater = specimens.find((specimen) => specimen.id === assignedEater && specimen.alive &&
        specimen.hunger > .05 && (specimen.layer !== 'bottom' || pellet.sunk) &&
        visibleFoodContact(mouths.get(specimen.id) ?? { x: Infinity, y: Infinity, z: Infinity }, pellet,
          firstSeenAt.current.get(pellet.id) ?? nowMs, nowMs))
      if (!eater) continue
      consumeSent.current.add(pellet.id)
      consume(pellet.id, eater.id)
    }
  }, FOOD_CONTACT_FRAME_PRIORITY)

  return <group name="root-food-contact-driver" userData={{ contactDriver: 'root-food-contact-v1' }} />
}

/** Dev-only physical feed-path trace on `window.__PA_FEED_TRACE__`, written only in a Vite dev
 *  build opened with `?feedDebug=1`. `import.meta.env.DEV` folds to `false` in the production
 *  bundle, so every guarded write below is eliminated from shipped output. */
interface FeedTraceRecord {
  readonly specimenId: number; readonly speciesId: string; readonly layer: PocketSpecimen['layer']
  readonly targetFoodId: number | null; readonly targetSunk: boolean | null; readonly mouthDistance: number | null
  readonly position: ScenePoint; readonly mouth: ScenePoint; readonly food: ScenePoint | null
  readonly actualSpeed: number; readonly avoidanceMagnitude: number; readonly collisionCorrection: number
  readonly pathDistance: number; readonly collisionCorrectionDistance: number; readonly minimumMouthDistance: number | null; readonly frames: number
}
const FEED_TRACE_ENABLED = import.meta.env.DEV && typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('feedDebug') === '1'
const feedTraceStore = () => ((window as typeof window &
  { __PA_FEED_TRACE__?: Record<number, FeedTraceRecord> }).__PA_FEED_TRACE__ ??= {})
const FEED_TRACE_ELEMENT_ID = 'pa-feed-trace', FEED_TRACE_PUBLISH_MS = 100
let feedTracePublishedAt = -Infinity
/** Mirrors the whole trace store into an inert `application/json` script node: a browser review
 *  runtime cannot observe the page-script global, so the DOM is the only shared boundary. Throttled
 *  so per-specimen serialization cannot materially perturb motion. */
const publishFeedTrace = () => {
  if (!FEED_TRACE_ENABLED) return
  const nowMs = performance.now()
  if (nowMs - feedTracePublishedAt < FEED_TRACE_PUBLISH_MS) return
  feedTracePublishedAt = nowMs
  let node = document.getElementById(FEED_TRACE_ELEMENT_ID) as HTMLScriptElement | null
  if (!node) {
    node = Object.assign(document.createElement('script'), { id: FEED_TRACE_ELEMENT_ID, type: 'application/json' })
    document.body.appendChild(node)
  }
  node.textContent = JSON.stringify(feedTraceStore())
}

function RenderedSpecimen({ specimen, snapshot, waterSurfaceY, food, flowField, assignments, mouths, positions, dispatch, geometry, skins, morphologyOverride }: {
  readonly specimen: PocketSpecimen
  readonly snapshot: ReefSnapshot
  readonly waterSurfaceY: number
  readonly food: readonly ScenePellet[]
  readonly flowField: FlowFieldSource
  readonly assignments: FoodAssignments
  readonly mouths: MouthPositions
  readonly positions: SpecimenPositions
  readonly dispatch?: (action: PocketAction) => void
  readonly geometry: SpecimenGeometry
  readonly skins: SpeciesSkins
  readonly morphologyOverride?: MorphologyProfileV1
}) {
  const { selectedSpecimenId, onHoverSpecimen } = useContext(SpecimenRosterContext)
  const group = useRef<THREE.Group>(null)
  const marker = useRef<THREE.Mesh>(null)
  const tail = useRef<THREE.Group>(null)
  const mouthPosition = useMemo(() => new THREE.Vector3(), [])
  const fallbackMouth = useMemo(() => new THREE.Vector3(), [])
  const forage = useRef(0)
  const tailPhase = useRef(seededUnit(specimen.id, 2) * Math.PI * 2)
  const phase = seededUnit(specimen.id, 1) * Math.PI * 2
  const behaviorPolicy = speciesBehaviorPolicyFor(specimen.speciesId)
  const locomotion = resolveSpecimenLocomotionPlan(specimen.speciesId)
  const surfaceBound = isSurfaceBoundLocomotion(locomotion)
  const rootX = THREE.MathUtils.lerp(-TANK_HALF_WIDTH * .72, TANK_HALF_WIDTH * .72, specimen.x)
  const benthic = locomotion === 'benthic_fish'
  const clearance = specimen.speciesId === 'epaulette_shark' ? .14 : .08
  const openWaterY = THREE.MathUtils.lerp(SAND_Y + .48, waterSurfaceY - .34, 1 - specimen.y)
  const rootY = benthic ? SAND_Y + clearance : THREE.MathUtils.clamp(openWaterY, SAND_Y + .38, waterSurfaceY - .28)
  const sceneUnitsPerMeter = TANK_HALF_WIDTH * 2 / Math.max(snapshot.tank.widthMeters, .4)
  const lifeScale = specimen.stage === 'adult' ? 1 : .68
  const length = THREE.MathUtils.clamp(specimen.adultSizeCm / 100 * sceneUnitsPerMeter * lifeScale, .16, 3.7)
  const bodyRadius = THREE.MathUtils.clamp(length * .24, .08, .34)
  const behavior = specimenBehaviorProfile(specimen.speciesId)
  const collisionEnvelope = useMemo(() => specimenCollisionEnvelope(length, bodyRadius), [bodyRadius, length])
  const riggedAsset = specimenAssetFor(specimen.speciesId)
  // A rigged asset renders at group scale 1 while the procedural fallback is scaled by `length`,
  // so the marker radius is stated in whichever space this specimen's group already uses.
  const markerRadius = (riggedAsset ? length : 1) * .62
  const visualPlan = resolveSpecimenVisualPlan(specimen.speciesId, Boolean(riggedAsset))
  const targetFood = food.find((pellet) => assignments.get(pellet.id) === specimen.id)
  const targetPosition = targetFood ?? null
  const profile = specimenMotionProfile(specimen.speciesId)
  const verticalBounds = specimenVerticalBounds(specimen.layer, waterSurfaceY, bodyRadius)
  const habitatPolicy = behaviorPolicy.fishHabitat
  const habitatWaypoints = useMemo(() => surfaceBound || !habitatPolicy ? [] : fishRouteWaypoints(habitatPolicy, specimen.id, {
    x: [-TANK_HALF_WIDTH + bodyRadius + length * .34, TANK_HALF_WIDTH - bodyRadius - length * .34],
    z: [-TANK_HALF_DEPTH + bodyRadius, TANK_HALF_DEPTH - bodyRadius],
  }, verticalBounds, REEF_ROCKS.map((rock) => new THREE.Vector3(...rock.position.toArray()))),
  [bodyRadius, habitatPolicy, length, specimen.id, surfaceBound, verticalBounds])
  const surfaceCircuit = useMemo(() => surfaceBound ? createSurfaceCircuit(
    specimen.speciesId, specimen.id, TANK_HALF_WIDTH - bodyRadius, TANK_HALF_DEPTH - bodyRadius, SAND_Y) : undefined,
  [bodyRadius, specimen.id, specimen.speciesId, surfaceBound])
  const surfacePose = useMemo<SurfacePose>(() => ({ position: new THREE.Vector3(),
    normal: new THREE.Vector3(), tangent: new THREE.Vector3() }), [])
  const motion = useMemo<FishPhysicsState>(() => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    forward: new THREE.Vector3(1, 0, 0),
    crowdHeading: new THREE.Vector3(1, 0, 0),
    roamTarget: new THREE.Vector3(),
    desired: new THREE.Vector3(),
    desiredDirection: new THREE.Vector3(),
    avoidance: new THREE.Vector3(),
    predicted: new THREE.Vector3(),
    sample: new THREE.Vector3(),
    correction: new THREE.Vector3(),
    previousPosition: new THREE.Vector3(),
    previousForward: new THREE.Vector3(1, 0, 0),
    orientation: new THREE.Quaternion(),
    targetOrientation: new THREE.Quaternion(),
    orientationMatrix: new THREE.Matrix4(),
    orientationUp: new THREE.Vector3(0, 1, 0),
    orientationSide: new THREE.Vector3(0, 0, 1),
    initialized: false,
    nextRoamAt: 0,
    roamIndex: 0,
  }), [specimen.id])

  // The entry aliases the live physics vectors, so neighbors read this resident's
  // authoritative position and velocity instead of a per-frame copy.
  const positionEntry = useMemo<SpecimenPosition>(() => ({ position: motion.position, velocity: motion.velocity,
    profile: behavior, ...collisionEnvelope, verticalClearance: bodyRadius }),
    [behavior, bodyRadius, collisionEnvelope, motion])

  const feedTrace = useRef({ targetFoodId: null as number | null, pathDistance: 0,
    collisionCorrectionDistance: 0, minimumMouthDistance: null as number | null, frames: 0 })
  useEffect(() => () => {
    mouths.delete(specimen.id)
    positions.delete(specimen.id)
    if (FEED_TRACE_ENABLED) { delete feedTraceStore()[specimen.id]; publishFeedTrace() }
  }, [mouths, positions, specimen.id])

  useFrame(({ camera, clock }, delta) => {
    const node = group.current
    if (!node) return
    // Face the ring at the camera through the resident's own yaw and roll, so the marker stays a
    // readable flat halo instead of turning edge-on whenever the fish banks or swims away.
    const billboardMarker = () => marker.current?.quaternion.copy(node.quaternion).invert().multiply(camera.quaternion)
    const shark = specimen.speciesId === 'epaulette_shark'
    const shrimp = specimen.speciesId === 'pistol_shrimp'
    const clown = specimen.speciesId === 'ocellaris'
    const now = clock.getElapsedTime()
    const step = Math.min(Math.max(delta, 0), .05)
    const mouthLead = riggedAsset ? length * .53 : length * .5
    const bodyHalfSpan = Math.max(length * (shark ? .48 : .34), bodyRadius * .55)

    if (surfaceBound && surfaceCircuit) {
      motion.previousPosition.copy(motion.position)
      motion.previousForward.copy(motion.forward)
      sampleSurfaceCircuit(surfaceCircuit, specimenSurfaceProgress(specimen.speciesId, surfaceCircuit,
        specimen.id, now, profile.cruiseSpeed), surfacePose)
      motion.desired.copy(surfacePose.position).addScaledVector(surfacePose.normal,
        Math.min(.045, bodyRadius * .42))
      if (!motion.initialized) {
        motion.position.copy(motion.desired)
        motion.previousPosition.copy(motion.position)
        motion.orientation.identity()
        motion.initialized = true
      } else {
        limitSpecimenFrameTravel(motion.position, motion.desired, profile.cruiseSpeed, step)
        motion.position.copy(motion.desired)
      }
      motion.velocity.copy(motion.position).sub(motion.previousPosition).divideScalar(Math.max(step, 1e-4))
      motion.forward.copy(surfacePose.tangent).normalize()
      motion.orientationUp.copy(surfacePose.normal).normalize()
      motion.orientationSide.crossVectors(motion.forward, motion.orientationUp).normalize()
      motion.orientationUp.crossVectors(motion.orientationSide, motion.forward).normalize()
      motion.targetOrientation.setFromRotationMatrix(motion.orientationMatrix.makeBasis(
        motion.forward, motion.orientationUp, motion.orientationSide))
      motion.orientation.rotateTowards(motion.targetOrientation, profile.turnRate * step)
      node.position.copy(motion.position)
      node.quaternion.copy(motion.orientation)
      node.scale.setScalar(riggedAsset ? 1 : length)
      billboardMarker()
      positions.set(specimen.id, positionEntry)
      mouths.set(specimen.id, mouthPosition.copy(motion.position).addScaledVector(motion.forward, mouthLead))
      forage.current += (0 - forage.current) * (1 - Math.exp(-step * 4.5))
      return
    }

    if (!motion.initialized) {
      const initialDirection = seededUnit(specimen.id, 4) > .5 ? 1 : -1
      motion.position.set(rootX, rootY, clown ? .48 : benthic ? .22 : (seededUnit(specimen.id, 5) - .5) * .65)
      motion.forward.set(initialDirection, 0, (seededUnit(specimen.id, 6) - .5) * .3).normalize()
      motion.crowdHeading.set(motion.forward.x, 0, motion.forward.z).normalize()
      clampBodyToTank(motion.position, motion.forward, bodyHalfSpan, bodyRadius, benthic, clearance, waterSurfaceY)
      resolveReefBodyHardscape(motion.position, motion.forward, bodyHalfSpan, bodyRadius, benthic,
        motion.sample, motion.correction)
      clampBodyToTank(motion.position, motion.forward, bodyHalfSpan, bodyRadius, benthic, clearance, waterSurfaceY)
      motion.velocity.copy(motion.forward).multiplyScalar(profile.cruiseSpeed * .42)
      motion.initialized = true
      motion.nextRoamAt = 0
    }

    if (!targetPosition && (now >= motion.nextRoamAt || motion.position.distanceToSquared(motion.roamTarget) < .04)) {
      const index = motion.roamIndex
      // Same neighbor measurement the showcase route uses for its crowd decisions: under
      // pressure the next roam target is offset down the away vector, so a crowded resident
      // separates by where it goes and not by yaw alone. An uncrowded resident reads zero
      // pressure, so the seeded roam pattern is unchanged.
      const crowd = measureSpecimenCrowd(motion.position, specimen.id, collisionEnvelope.longitudinal, positions)
      const habitatTarget = habitatWaypoints[index % habitatWaypoints.length]
      motion.roamTarget.copy(habitatTarget ?? motion.position)
      motion.roamTarget.x += crowd.awayX * crowd.pressure * Math.min(profile.roamX, .35)
      motion.roamTarget.z += crowd.awayZ * crowd.pressure * Math.min(profile.roamZ, .25)
      resolveReefHardscape(motion.roamTarget, bodyRadius, benthic)
      clampBodyToTank(motion.roamTarget, motion.forward, bodyHalfSpan, bodyRadius, benthic, clearance, waterSurfaceY)
      motion.roamIndex += 1
      motion.nextRoamAt = now + profile.retargetSeconds * (.82 + seededUnit(specimen.id, 80 + index) * .36)
    }

    motion.previousForward.copy(motion.forward)
    if (targetPosition) {
      // Aim the authored +X snout at the pellet, then steer the root toward the point
      // that places the mouth anchor on it. This preserves renderer-observed contact.
      // A bottom resident is clamped to the sand, so chasing a still-falling portion's live
      // height burns pursuit authority on an unreachable climb; preposition under its lateral
      // route instead and take the real height once it has settled.
      motion.desired.set(targetPosition.x,
        benthic && !targetPosition.sunk ? rootY : targetPosition.y, targetPosition.z)
      motion.desiredDirection.copy(motion.desired).sub(motion.position)
      if (motion.desiredDirection.lengthSq() > 1e-6) motion.desiredDirection.normalize()
      else motion.desiredDirection.copy(motion.forward)
      motion.desired.addScaledVector(motion.desiredDirection, -mouthLead).sub(motion.position)
    } else {
      motion.desired.copy(motion.roamTarget).sub(motion.position)
      if (motion.desired.lengthSq() > 1e-6) motion.desiredDirection.copy(motion.desired).normalize()
      else motion.desiredDirection.copy(motion.forward)
    }

    const arrivalDistance = motion.desired.length()
    const maximumSpeed = targetPosition ? profile.pursuitSpeed : profile.cruiseSpeed *
      fishPaceMultiplier(habitatPolicy!, specimen.id, now)
    let desiredSpeed = maximumSpeed * Math.min(1, Math.sqrt(arrivalDistance / profile.arrivalRadius))
    const mouthDistance = targetPosition ? motion.position.distanceTo(targetPosition) - mouthLead : 0
    if (targetPosition && mouthDistance > FOOD_CONTACT_RADIUS * .55) desiredSpeed = Math.max(desiredSpeed, .065)
    // Reuse the shared crowd separation the accepted showcase population already runs, so
    // authoritative residents pass one another instead of interpenetrating. Only the yaw of
    // the desired direction comes from it (`steerSpecimenHeading` reads the route heading as
    // an atan2 bearing); pitch, pursuit magnitude, and the wall/hardscape avoidance blended
    // in below stay authoritative.
    const horizontalDrive = Math.hypot(motion.desiredDirection.x, motion.desiredDirection.z)
    if (horizontalDrive > 1e-4) {
      steerSpecimenHeading(motion.crowdHeading, motion.desiredDirection, motion.velocity, motion.position,
        specimen.id, bodyRadius, collisionEnvelope, positions, behavior, step, profile.turnRate)
      motion.desiredDirection.x = motion.crowdHeading.x * horizontalDrive
      motion.desiredDirection.z = motion.crowdHeading.z * horizontalDrive
    }
    addPredictiveAvoidance(motion, bodyHalfSpan, bodyRadius, benthic, clearance, waterSurfaceY, profile.lookAhead)
    // Portions only ever settle in a rock-free lane, so the summed potential field has nothing
    // real to avoid at the destination. At full strength it matches the unit pursuit vector and
    // parks a benthic eater in orbit, so fade it out over the final approach; the hardscape and
    // tank projections below remain the authoritative collision guard.
    motion.desiredDirection.addScaledVector(motion.avoidance,
      targetPosition ? .92 * Math.min(1, Math.max(mouthDistance, 0) / profile.arrivalRadius) : 1.18)
    if (benthic && !targetPosition) motion.desiredDirection.y *= .16
    if (motion.desiredDirection.lengthSq() > 1e-6) motion.desiredDirection.normalize()
    else motion.desiredDirection.copy(motion.forward)
    turnTowards(motion.forward, motion.desiredDirection, profile.turnRate * step, motion.correction)

    motion.desired.copy(motion.forward).multiplyScalar(desiredSpeed)
    motion.correction.copy(motion.desired).sub(motion.velocity)
    const maximumVelocityChange = profile.acceleration * step
    if (motion.correction.lengthSq() > maximumVelocityChange * maximumVelocityChange) {
      motion.correction.setLength(maximumVelocityChange)
    }
    motion.velocity.add(motion.correction)
    if (motion.velocity.lengthSq() > maximumSpeed * maximumSpeed) motion.velocity.setLength(maximumSpeed)
    if (benthic && !targetPosition) motion.velocity.y *= Math.exp(-step * 8)
    if (motion.velocity.lengthSq() > MOTION_HEADING_SPEED_EPSILON * MOTION_HEADING_SPEED_EPSILON) {
      motion.forward.copy(motion.velocity).normalize()
    }

    motion.previousPosition.copy(motion.position)
    motion.position.addScaledVector(motion.velocity, step)
    const current = sampleFlowField(
      flowField.current,
      (motion.position.x + TANK_HALF_WIDTH) / (TANK_HALF_WIDTH * 2),
      (motion.position.y - SAND_Y) / Math.max(waterSurfaceY - SAND_Y, .01),
    )
    const currentExposure = benthic ? .1 : .42
    const currentScale = sceneUnitsPerMeter * currentExposure * step
    motion.position.x += THREE.MathUtils.clamp(current.xMetersPerSecond * currentScale,
      -MAX_FISH_FLOW_STEP, MAX_FISH_FLOW_STEP)
    motion.position.y += THREE.MathUtils.clamp(current.yMetersPerSecond * currentScale,
      -MAX_FISH_FLOW_STEP, MAX_FISH_FLOW_STEP)
    motion.desired.copy(motion.position)
    // Alternate oriented body projection and glass bounds. Avoidance should normally
    // make this a no-op; it remains a guard for frame spikes and newly moving targets.
    for (let i = 0; i < 5; i += 1) {
      resolveReefBodyHardscape(motion.position, motion.forward, bodyHalfSpan, bodyRadius, benthic,
        motion.sample, motion.correction)
      clampBodyToTank(motion.position, motion.forward, bodyHalfSpan, bodyRadius, benthic, clearance, waterSurfaceY)
    }
    motion.correction.copy(motion.position).sub(motion.desired)
    if (motion.correction.lengthSq() > 1e-8) {
      motion.correction.normalize()
      const inwardSpeed = motion.velocity.dot(motion.correction)
      if (inwardSpeed < 0) motion.velocity.addScaledVector(motion.correction, -inwardSpeed)
    }
    positions.set(specimen.id, positionEntry)

    const actualSpeed = motion.position.distanceTo(motion.previousPosition) / Math.max(step, 1e-4)
    const normalizedSpeed = THREE.MathUtils.clamp(actualSpeed / Math.max(profile.cruiseSpeed, .01), 0, 1.8)
    const turnAngle = motion.previousForward.angleTo(motion.forward)
    const turnSign = Math.sign(motion.previousForward.z * motion.forward.x - motion.previousForward.x * motion.forward.z)
    updateUprightSpecimenOrientation(motion.orientation, motion.forward,
      turnSign * Math.min(turnAngle / Math.max(step, .001), profile.turnRate) / profile.turnRate * .09,
      profile.turnRate * step, motion.targetOrientation)
    node.position.copy(motion.position)
    node.quaternion.copy(motion.orientation)
    node.scale.setScalar(riggedAsset ? 1 : length)
    billboardMarker()

    const motionDrive = THREE.MathUtils.clamp(normalizedSpeed * .16 + turnAngle / Math.max(profile.turnRate * step, .001) * .16, 0, .3)
    const feedDrive = targetPosition ? .58 + normalizedSpeed * .22 : motionDrive
    forage.current += (THREE.MathUtils.clamp(feedDrive, 0, 1) - forage.current) * (1 - Math.exp(-step * 4.5))
    tailPhase.current += step * (4.4 + normalizedSpeed * 8.5)
    if (tail.current) {
      const tailAmplitude = shark ? .1 : shrimp ? 0 : specimen.speciesId === 'watchman_goby' ? .14 : .22
      tail.current.rotation.y = Math.sin(tailPhase.current + phase) * tailAmplitude * (.28 + normalizedSpeed * .72)
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
    if (FEED_TRACE_ENABLED) {
      const cumulative = feedTrace.current
      const targetFoodId = targetFood?.id ?? null
      if (cumulative.targetFoodId !== targetFoodId) {
        cumulative.targetFoodId = targetFoodId
        cumulative.pathDistance = cumulative.collisionCorrectionDistance = cumulative.frames = 0
        cumulative.minimumMouthDistance = null
      }
      // `motion.desired` still holds the pre-projection position snapshotted just before the loop above, so this reads back the applied correction.
      const collisionCorrection = motion.position.distanceTo(motion.desired)
      const traceMouthDistance = targetPosition ? mouthPosition.distanceTo(targetPosition) : null
      cumulative.pathDistance += motion.position.distanceTo(motion.previousPosition)
      cumulative.collisionCorrectionDistance += collisionCorrection
      cumulative.frames += 1
      if (traceMouthDistance !== null) cumulative.minimumMouthDistance = Math.min(cumulative.minimumMouthDistance ?? traceMouthDistance, traceMouthDistance)
      feedTraceStore()[specimen.id] = {
        specimenId: specimen.id, speciesId: specimen.speciesId, layer: specimen.layer, targetFoodId,
        targetSunk: targetFood ? targetFood.sunk : null, mouthDistance: traceMouthDistance, actualSpeed,
        position: { x: motion.position.x, y: motion.position.y, z: motion.position.z }, mouth: { x: mouthPosition.x, y: mouthPosition.y, z: mouthPosition.z },
        food: targetPosition ? { x: targetPosition.x, y: targetPosition.y, z: targetPosition.z } : null,
        avoidanceMagnitude: motion.avoidance.length(), collisionCorrection, pathDistance: cumulative.pathDistance,
        collisionCorrectionDistance: cumulative.collisionCorrectionDistance, minimumMouthDistance: cumulative.minimumMouthDistance, frames: cumulative.frames,
      }
      publishFeedTrace()
    }
  }, FISH_MOTION_FRAME_PRIORITY)

  return <group ref={group} name={`root-specimen-${specimen.speciesId}-${specimen.id}`}
    userData={{ rootSpecimenId: specimen.id, speciesId: specimen.speciesId, mouthAnchor: riggedAsset ? 'rig-node-or-fallback' : 'body-fallback' }}
    onClick={(event) => {
      event.stopPropagation()
      dispatch?.(specimenSelectionAction(specimen.id))
    }}
    onPointerOver={(event) => {
      // Nearest resident wins, and only inside the renderer's own hit graph: the native event is
      // untouched, so tank drag, pinch, and feed taps keep every gesture they had before.
      event.stopPropagation()
      onHoverSpecimen?.({ id: specimen.id, x: event.clientX, y: event.clientY })
    }}
    onPointerOut={() => onHoverSpecimen?.(null)}>
    {selectedSpecimenId === specimen.id ? <mesh ref={marker} raycast={MARKER_NO_RAYCAST}>
      <ringGeometry args={[markerRadius * .9, markerRadius, 44]} />
      <meshBasicMaterial color="#78e6ff" transparent opacity={.78} depthWrite={false}
        side={THREE.DoubleSide} toneMapped={false} />
    </mesh> : null}
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

export function specimenSelectionAction(id: number): PocketAction {
  return { type: 'SELECT_ENTITY', entityType: 'livestock', id }
}

export function resolveSpecimenPopulations(roster: readonly PocketSpecimen[]) {
  return {
    authoritative: roster.filter((specimen) => specimen.alive &&
      isRenderableLivestockSpecies(specimen.speciesId, Boolean(specimenAssetFor(specimen.speciesId)))).slice(0, MAX_SPECIMENS),
  }
}

function AuthoritativeSpecimenPopulation({ snapshot, waterSurfaceY, pellets, flowField, consume, roster, positions, morphologyOverride, dispatch }: SpecimenFishProps & {
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
      paused={snapshot.clock.paused} consume={consume} />
    {roster.map((specimen) => <RenderedSpecimen key={specimen.id} specimen={specimen} snapshot={snapshot}
      waterSurfaceY={waterSurfaceY} food={pellets} flowField={flowField} mouths={mouths} assignments={assignments}
      positions={positions} dispatch={dispatch} geometry={geometry} skins={skins}
      morphologyOverride={morphologyOverride?.speciesId === specimen.speciesId ? morphologyOverride : undefined} />)}
  </group>
}

export function SpecimenFish(props: SpecimenFishProps) {
  const { specimens, morphologyOverride, dispatch } = useContext(SpecimenRosterContext)
  const populations = resolveSpecimenPopulations(specimens)
  const positions = useMemo<SpecimenPositions>(() => new Map(), [])
  return <AuthoritativeSpecimenPopulation {...props} roster={populations.authoritative} positions={positions}
    morphologyOverride={morphologyOverride} dispatch={dispatch} />
}
