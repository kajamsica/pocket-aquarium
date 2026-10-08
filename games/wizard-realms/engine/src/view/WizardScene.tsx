import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import type { WizardBuildSite, WizardDigSite, WizardFairyRing, WizardInscription, WizardLandmark, WizardResourceNode, WizardRoute, WizardStore, WizardTerrainCell, WizardViewProjection } from './contracts'
import { visibleTerrainCells } from './visibleTerrain'

// Authoritative transforms arrive at 20 Hz; the view eases a presentation pose toward them each frame.
const TELEPORT_SNAP_DISTANCE_M = 3
const POSITION_DAMPING_PER_S = 14
const YAW_DAMPING_PER_S = 16
const SPEED_DAMPING_PER_S = 10
const WALK_SPEED_M_PER_S = 3.2
const STRIDE_LENGTH_M = 1.4
const LEG_SWING_RAD = 0.5
const ARM_SWING_RAD = 0.3
const BODY_BOB_M = 0.05

// Atmosphere palette. three applies fog after tone mapping and colour-space conversion, and both fog and clear colour
// are converted as unlit output-space colours, so these values compare directly (neither is ACES-compressed).
// The fog is kept marginally brighter than the sky on purpose, for a soft haze band above the far terrain edge.
const SKY_COLOR = '#8fc0d6'
const FOG_COLOR = '#a7cddb'
const BEDROCK_COLOR = '#4a6a3e'

// Shared geometry/material instances for primitives that have no per-instance variance.
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const LEAF_GEOMETRY = new THREE.IcosahedronGeometry(1, 1)
const ROCK_GEOMETRY = new THREE.DodecahedronGeometry(1, 0)
const CRYSTAL_GEOMETRY = new THREE.OctahedronGeometry(1, 0)
const WOOD_MATERIAL = new THREE.MeshStandardMaterial({ color: '#6e4a30', roughness: 0.92 })
const DARK_WOOD_MATERIAL = new THREE.MeshStandardMaterial({ color: '#4a3222', roughness: 0.9 })
const STAKE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#9a8a70', roughness: 0.9 })
const ROBE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#4f3176', roughness: 0.76 })
const ROBE_TRIM_MATERIAL = new THREE.MeshStandardMaterial({ color: '#2d1f45', roughness: 0.82 })
const WADER_MATERIAL = new THREE.MeshStandardMaterial({ color: '#41695f', roughness: 0.88, flatShading: true })
const WADER_CUFF_MATERIAL = new THREE.MeshStandardMaterial({ color: '#9ab6a0', roughness: 0.84, flatShading: true })
const GOLD_MATERIAL = new THREE.MeshStandardMaterial({ color: '#d4aa52', roughness: 0.38, metalness: 0.45 })
const AXE_HEAD_MATERIAL = new THREE.MeshStandardMaterial({ color: '#9ba4ad', roughness: 0.42, metalness: 0.6 })
const MIREGLASS_WATER_MATERIAL = new THREE.MeshStandardMaterial({ color: '#417b83', roughness: 0.28, metalness: 0.12 })
const MIREGLASS_REED_MATERIAL = new THREE.MeshStandardMaterial({ color: '#849568', roughness: 0.95 })
const MIREGLASS_PEAT_MATERIAL = new THREE.MeshStandardMaterial({ color: '#433c34', roughness: 1 })
const MIREGLASS_STONE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#a4aaa0', roughness: 0.94 })
const APPROACH_BRUSH_MATERIAL = new THREE.MeshStandardMaterial({ color: '#6a8253', roughness: 1, flatShading: true })
const APPROACH_PEBBLE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#a89e82', roughness: 0.98, flatShading: true })
const APPROACH_TRAIL_MATERIAL = new THREE.MeshStandardMaterial({ color: '#aa9672', roughness: 1, flatShading: true })
const APPROACH_SOIL_MATERIAL = new THREE.MeshStandardMaterial({ color: '#6c7255', roughness: 1, flatShading: true })
const APPROACH_GROUND_COLOR = new THREE.Color('#687a59')
const MARKER_STONE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#b9aa89', roughness: 0.95, flatShading: true })
const MARKER_RUNE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#bde4d0', emissive: '#4d9b82', emissiveIntensity: 0.9, roughness: 0.5 })
const MARKER_DORMANT_MATERIAL = new THREE.MeshStandardMaterial({ color: '#787d69', roughness: 0.9 })
const ALDER_BARK_MATERIAL = new THREE.MeshStandardMaterial({ color: '#45382d', roughness: 1, flatShading: true })
const ALDER_LEAF_MATERIAL = new THREE.MeshStandardMaterial({ color: '#628661', roughness: 0.9, flatShading: true })
const ALDER_BELL_MATERIAL = new THREE.MeshStandardMaterial({ color: '#a98552', metalness: 0.35, roughness: 0.55 })
const CACHE_PEAT_MATERIAL = new THREE.MeshStandardMaterial({ color: '#665442', roughness: 1, flatShading: true })
const CACHE_PIT_MATERIAL = new THREE.MeshStandardMaterial({ color: '#2e302a', roughness: 1 })
const ALDER_TRUNK_GEOMETRY = new THREE.CylinderGeometry(0.18, 0.34, 3.4, 7)
const CACHE_PIT_GEOMETRY = new THREE.CircleGeometry(0.72, 12)
const WADER_SHAFT_GEOMETRY = new THREE.CylinderGeometry(0.13, 0.15, 0.5, 6)
const NO_MIREGLASS_DETAIL = { water: false, reeds: false, peat: false, stone: false, brush: false, pebbles: false,
  soil: false, trail: false, trailYaw: 0, trailLength: 0, trailX: 0, trailZ: 0,
  brushX: 0, brushZ: 0, x: 0, z: 0, rotation: 0 } as const

/** Side/soil colour and surface roughness per biome; the projection colour stays the authoritative top tone. */
const TERRAIN_SURFACE: Record<string, { side: string; roughness: number }> = {
  temperate_forest: { side: '#5a4330', roughness: 0.95 },
  marsh: { side: '#40493a', roughness: 0.7 },
  dry_highland: { side: '#6a6052', roughness: 0.92 },
  alpine: { side: '#8a97a1', roughness: 0.58 },
}

const TREE_CANOPY = [[-0.5, 3.0, 0.15, 1.1, '#3a7c43'], [0.42, 3.3, -0.25, 1.0, '#4c9a4e'], [0.05, 3.95, 0.05, 0.9, '#64b35a']] as const

// Camera-line tree occlusion. Nearby trunks and canopies fade with hysteresis so the avatar stays visible.
// Scalar math only, no per-frame geometry or material allocation.
const CANOPY_CENTRE_Y_M = 3.4
const CANOPY_RADIUS_M = 1.75
const OCCLUDE_ENTER_MARGIN_M = 0.25
const OCCLUDE_EXIT_MARGIN_M = 0.8
const OCCLUDED_OPACITY = 0.12
const AVATAR_FOCUS_HEIGHT_M = 1.5
const FADE_OUT_PER_S = 12
const FADE_IN_PER_S = 5

/** View-only pose shared by avatar and camera. It is derived from the projection and never fed back to the domain. */
interface PresentationPose {
  position: THREE.Vector3
  yaw: number
  speed: number
  phase: number
}

function damping(ratePerSecond: number, delta: number) {
  return 1 - Math.exp(-ratePerSecond * delta)
}

function shortestArc(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

/** A trunk may fill the near camera even when its canopy misses the avatar sightline. */
export function treeTrunkBlocksView(
  camera: THREE.Vector3, avatar: THREE.Vector3, trunk: readonly [number, number, number], scale: number, margin: number,
): boolean {
  const dx = avatar.x - camera.x
  const dz = avatar.z - camera.z
  const horizontalLength2 = dx * dx + dz * dz
  const projected = horizontalLength2 > 1e-8 ? ((trunk[0] - camera.x) * dx + (trunk[2] - camera.z) * dz) / horizontalLength2 : 0
  if (projected < -0.08 || projected > 1.08) return false
  const t = Math.min(1, Math.max(0, projected))
  const rayY = camera.y + (avatar.y + AVATAR_FOCUS_HEIGHT_M - camera.y) * t
  if (rayY < trunk[1] - 0.3 * scale - margin || rayY > trunk[1] + 3.55 * scale + margin) return false
  const segmentDistance = Math.hypot(camera.x + dx * t - trunk[0], camera.z + dz * t - trunk[2])
  const cameraDistance = Math.hypot(camera.x - trunk[0], camera.z - trunk[2])
  return segmentDistance < 0.62 * scale + margin || cameraDistance < 1.35 * scale + margin
}

// These bounds enclose the rendered shop body and pitched roof. They affect only the presentation camera.
function segmentBoxHit(from: THREE.Vector3, to: THREE.Vector3, centre: THREE.Vector3, half: THREE.Vector3): number | null {
  let enter = 0
  let exit = 1
  let fromInside = true
  let toInside = true
  for (const axis of ['x', 'y', 'z'] as const) {
    const change = to[axis] - from[axis]
    const low = centre[axis] - half[axis]
    const high = centre[axis] + half[axis]
    fromInside &&= from[axis] >= low && from[axis] <= high
    toInside &&= to[axis] >= low && to[axis] <= high
    if (Math.abs(change) < 1e-8) {
      if (from[axis] < low || from[axis] > high) return null
      continue
    }
    const first = (low - from[axis]) / change
    const second = (high - from[axis]) / change
    enter = Math.max(enter, Math.min(first, second))
    exit = Math.min(exit, Math.max(first, second))
    if (enter > exit) return null
  }
  // A legacy save may start inside a shop. Keep its camera before the exit wall, not at distance zero.
  return fromInside ? (toInside ? null : exit) : enter
}

function firstStoreCameraHit(from: THREE.Vector3, to: THREE.Vector3, stores: readonly WizardStore[]): number | null {
  let firstHit: number | null = null
  for (const store of stores) {
    const [x, y, z] = store.position
    const body = segmentBoxHit(from, to, new THREE.Vector3(x, y + 1.2, z), new THREE.Vector3(1.7, 1.2, 1.2))
    const roof = segmentBoxHit(from, to, new THREE.Vector3(x, y + 2.95, z), new THREE.Vector3(2.4, 0.8, 2.4))
    for (const hit of [body, roof]) if (hit !== null) firstHit = firstHit === null ? hit : Math.min(firstHit, hit)
  }
  return firstHit
}

/** Keep the wizard visible when the requested follow orbit looks through a shop. Never changes world movement. */
export function storeSafeCameraPosition(
  target: THREE.Vector3, desired: THREE.Vector3, stores: readonly WizardStore[], previous: THREE.Vector3 | null, delta: number,
): THREE.Vector3 {
  let clear = desired
  let bestHit = firstStoreCameraHit(target, desired, stores)
  if (bestHit !== null) {
    const offset = desired.clone().sub(target)
    for (const angle of [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75, Math.PI]) {
      const sin = Math.sin(angle)
      const cos = Math.cos(angle)
      const candidate = target.clone().add(new THREE.Vector3(offset.x * cos + offset.z * sin, offset.y, offset.z * cos - offset.x * sin))
      const hit = firstStoreCameraHit(target, candidate, stores)
      if (hit === null) {
        clear = candidate
        break
      }
      if (hit > bestHit) {
        clear = candidate
        bestHit = hit
      }
    }
  }
  const next = previous ? previous.clone().lerp(clear, damping(10, Math.max(0, delta))) : clear.clone()
  const hit = firstStoreCameraHit(target, next, stores)
  if (hit === null) return next
  const distance = target.distanceTo(next)
  // The frame and near plane still fill part of the view when the eye is only 12 cm from the shop bound.
  return target.clone().lerp(next, Math.max(0, hit - 0.45 / Math.max(distance, 0.45)))
}

const DESKTOP_CAMERA = { focusHeight: 1.35, eyeRise: 1.2, distance: 6.4, pitchScale: 1 } as const
const COMPACT_CAMERA = { focusHeight: 0.45, eyeRise: 0.45, distance: 5.6, pitchScale: 0.65 } as const

/** Match the HUD's compact breakpoint so the wizard stays above its lower objective and touch controls. */
export function cameraFramingFor(width: number, height: number) {
  return width < 720 || (width <= 900 && height <= 590) ? COMPACT_CAMERA : DESKTOP_CAMERA
}

/** Deterministic [0, 1) from a stable id, so cosmetic variation never depends on randomness or time. */
function hashUnit(id: string, salt: number) {
  let hash = 2166136261 ^ salt
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  hash ^= hash >>> 15
  hash = Math.imul(hash, 2246822507)
  hash ^= hash >>> 13
  return (hash >>> 0) / 4294967296
}

/** Stable, sparse ground detail. It is scenery only and has no interaction target. */
export function mireglassDetailFor(cell: WizardTerrainCell) {
  const terrain = cell.mireglassTerrain
  if (!terrain && !cell.mireglassApproach && !cell.mireglassTrailSegment) return NO_MIREGLASS_DETAIL
  const roll = hashUnit(cell.id, 7)
  const segment = cell.mireglassTrailSegment
  const dx = segment ? segment.to[0] - segment.from[0] : 0
  const dz = segment ? segment.to[1] - segment.from[1] : 0
  const trailLength = Math.hypot(dx, dz)
  const trail = !!segment && Number.isFinite(trailLength) && trailLength > 0.01
  const trailYaw = trail ? Math.atan2(dx, dz) : 0
  const trailX = trail ? (segment.from[0] + segment.to[0]) / 2 - cell.position[0] : 0
  const trailZ = trail ? (segment.from[1] + segment.to[1]) / 2 - cell.position[2] : 0
  const side = hashUnit(cell.id, 16) < 0.5 ? -1 : 1
  const approachX = (hashUnit(cell.id, 14) - 0.5) * 2.6
  const approachZ = (hashUnit(cell.id, 15) - 0.5) * 2.6
  return {
    water: terrain === 'wetland' && roll < 0.72,
    reeds: terrain === 'wetland' && roll >= 0.22 && roll < 0.58,
    peat: terrain === 'loam' && roll < 0.38,
    stone: terrain === 'rocky' && roll < 0.6,
    brush: !!cell.mireglassApproach && hashUnit(cell.id, 11) < 0.62,
    pebbles: !!cell.mireglassApproach && hashUnit(cell.id, 12) < 0.52,
    soil: !!cell.mireglassApproach && hashUnit(cell.id, 13) < 0.42,
    trail, trailYaw, trailLength, trailX, trailZ,
    brushX: trail ? trailX + side * Math.cos(trailYaw) * 1.18 : approachX,
    brushZ: trail ? trailZ - side * Math.sin(trailYaw) * 1.18 : approachZ,
    x: (hashUnit(cell.id, 8) - 0.5) * 1.3,
    z: (hashUnit(cell.id, 9) - 0.5) * 1.3,
    rotation: hashUnit(cell.id, 10) * Math.PI,
  }
}

function PresentationPoseDriver({ player, pose, worldSupport }: {
  player: WizardViewProjection['player']; pose: PresentationPose; worldSupport: RefObject<THREE.Group | null>
}) {
  const target = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, delta) => {
    target.set(player.position[0], player.position[1], player.position[2])
    if (Math.hypot(target.x - pose.position.x, target.z - pose.position.z) > TELEPORT_SNAP_DISTANCE_M) {
      pose.position.copy(target)
      pose.yaw = player.yaw
      pose.speed = 0
    } else {
      const previousX = pose.position.x
      const previousZ = pose.position.z
      pose.position.lerp(target, damping(POSITION_DAMPING_PER_S, delta))
      pose.yaw += shortestArc(pose.yaw, player.yaw) * damping(YAW_DAMPING_PER_S, delta)
      const realizedSpeed = delta > 0 ? Math.hypot(pose.position.x - previousX, pose.position.z - previousZ) / delta : 0
      pose.speed += (realizedSpeed - pose.speed) * damping(SPEED_DAMPING_PER_S, delta)
      pose.phase = (pose.phase + pose.speed / STRIDE_LENGTH_M * Math.PI * 2 * delta) % (Math.PI * 2)
    }
    worldSupport.current?.position.set(pose.position.x, 0, pose.position.z)
  }, -1)
  return null
}

function CameraRig({ pose, cameraOrbit, orbiting, stores }: {
  pose: PresentationPose
  cameraOrbit: readonly [number, number]
  orbiting: boolean
  stores: readonly WizardStore[]
}) {
  const orbitYaw = useRef(cameraOrbit[0])
  const orbitPitch = useRef(cameraOrbit[1])
  const initialized = useRef(false)
  const target = useMemo(() => new THREE.Vector3(), [])
  const desired = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }, delta) => {
    const blend = 1 - Math.exp(-(orbiting ? 18 : 2.6) * delta)
    orbitYaw.current += (cameraOrbit[0] - orbitYaw.current) * blend
    orbitPitch.current += (cameraOrbit[1] - orbitPitch.current) * blend
    const heading = pose.yaw + orbitYaw.current
    const framing = cameraFramingFor(size.width, size.height)
    const horizontal = Math.cos(orbitPitch.current * framing.pitchScale) * framing.distance
    target.set(pose.position.x, pose.position.y + framing.focusHeight, pose.position.z)
    desired.set(
      target.x + Math.sin(heading) * horizontal,
      target.y + framing.eyeRise + Math.sin(orbitPitch.current * framing.pitchScale) * framing.distance,
      target.z + Math.cos(heading) * horizontal,
    )
    camera.position.copy(storeSafeCameraPosition(target, desired, stores, initialized.current ? camera.position : null, delta))
    initialized.current = true
    camera.lookAt(target)
  })
  return null
}

type AvatarEquipment = WizardViewProjection['equipment']

/** Pure mapping from authoritative equipment to the gear the avatar shows. Unknown or empty slots render nothing. */
export function avatarGearFor(equipment: AvatarEquipment) {
  const id = (slot: keyof AvatarEquipment) => equipment[slot]?.itemId ?? null
  const feet = id('feet')
  const mainHand = id('mainHand') === 'woodcutters_axe' ? 'axe' : id('mainHand') === 'field_spade' ? 'spade' : id('mainHand') === 'oak_wand' ? 'wand' : null
  const offHand = id('offHand') === 'wooden_shield' ? 'shield' : id('offHand') === 'oak_wand' ? 'wand' : null
  return {
    hat: id('head') === 'apprentice_hat',
    tunic: id('chest') === 'traveler_tunic',
    leggings: id('legs') === 'trail_leggings',
    boots: feet === 'leather_boots',
    waders: feet === 'mireglass_reach/item/waders',
    mainHand,
    offHand,
    // One wand light at most: two equipped wands share the main-hand light rather than doubling fragment cost.
    offHandLight: offHand === 'wand' && mainHand !== 'wand',
  } as const
}

function Wand({ side, light }: { side: 1 | -1; light: boolean }) {
  return <>
    <mesh position={[0.18 * side, -0.32, 0]} rotation={[0.05, 0, 0.12 * side]} material={DARK_WOOD_MATERIAL} castShadow><cylinderGeometry args={[0.035, 0.05, 2.45, 7]} /></mesh>
    <mesh position={[0.04 * side, 0.78, -0.06]} material={GOLD_MATERIAL}><cylinderGeometry args={[0.06, 0.04, 0.12, 7]} /></mesh>
    <mesh position={[0.03 * side, 0.95, -0.07]}><sphereGeometry args={[0.12, 12, 10]} /><meshStandardMaterial color="#e9dcff" emissive="#bd82ff" emissiveIntensity={2.2} roughness={0.25} /></mesh>
    {light && <pointLight position={[0.03 * side, 1.0, -0.07]} color="#bd82ff" intensity={2.6} distance={3.8} />}
  </>
}

function Axe() {
  return <group position={[0.2, -0.5, 0]} rotation={[0.1, 0, 0.1]}>
    <mesh position={[0, 0.2, 0]} material={DARK_WOOD_MATERIAL} castShadow><cylinderGeometry args={[0.03, 0.04, 1.1, 6]} /></mesh>
    <mesh geometry={UNIT_BOX} material={AXE_HEAD_MATERIAL} position={[0.13, 0.66, 0]} scale={[0.3, 0.2, 0.06]} castShadow />
    <mesh geometry={UNIT_BOX} material={DARK_WOOD_MATERIAL} position={[0, 0.66, 0.03]} scale={[0.07, 0.1, 0.08]} />
  </group>
}

function Spade() {
  return <group position={[0.2, -0.38, 0.02]} rotation={[0.08, 0, 0.08]}>
    <mesh position={[0, 0.24, 0]} material={DARK_WOOD_MATERIAL} castShadow><cylinderGeometry args={[0.035, 0.04, 1.1, 6]} /></mesh>
    <mesh geometry={UNIT_BOX} material={AXE_HEAD_MATERIAL} position={[0, -0.47, 0]} scale={[0.28, 0.42, 0.07]} castShadow />
  </group>
}

function Shield() {
  return <group position={[-0.22, -0.38, 0.02]}>
    <mesh geometry={UNIT_BOX} material={WOOD_MATERIAL} scale={[0.56, 0.72, 0.08]} castShadow />
    <mesh position={[0, 0, 0.07]} rotation={[Math.PI / 2, 0, 0]} material={GOLD_MATERIAL}><cylinderGeometry args={[0.09, 0.09, 0.04, 8]} /></mesh>
  </group>
}

function WizardAvatar({ pose, equipment }: { pose: PresentationPose; equipment: AvatarEquipment }) {
  const gear = avatarGearFor(equipment)
  const legMaterial = gear.leggings ? STAKE_MATERIAL : ROBE_TRIM_MATERIAL
  const root = useRef<THREE.Group>(null)
  const torso = useRef<THREE.Group>(null)
  const leftLeg = useRef<THREE.Group>(null)
  const rightLeg = useRef<THREE.Group>(null)
  const leftArm = useRef<THREE.Group>(null)
  const rightArm = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!root.current || !torso.current || !leftLeg.current || !rightLeg.current || !leftArm.current || !rightArm.current) return
    root.current.position.copy(pose.position)
    root.current.rotation.y = pose.yaw
    // Swing amplitude follows realized speed, so stopping fades to idle while the phase stays continuous.
    const stride = Math.min(pose.speed / WALK_SPEED_M_PER_S, 1)
    const swing = Math.sin(pose.phase) * stride
    leftLeg.current.rotation.x = swing * LEG_SWING_RAD
    rightLeg.current.rotation.x = -swing * LEG_SWING_RAD
    leftArm.current.rotation.x = -swing * ARM_SWING_RAD
    rightArm.current.rotation.x = swing * ARM_SWING_RAD
    torso.current.position.y = BODY_BOB_M * stride * 0.5 * (1 + Math.cos(2 * pose.phase))
  })
  return (
    <group ref={root} aria-label="Player wizard">
      {[leftLeg, rightLeg].map((leg, index) => (
        <group key={index} ref={leg} position={[index === 0 ? -0.16 : 0.16, 0.6, 0]}>
          <mesh position={[0, -0.3, 0]} material={legMaterial} castShadow><cylinderGeometry args={[0.09, 0.11, 0.6, 6]} /></mesh>
          {gear.boots && <mesh geometry={UNIT_BOX} material={DARK_WOOD_MATERIAL} position={[0, -0.54, 0.05]} scale={[0.22, 0.14, 0.34]} castShadow />}
          {gear.waders && <>
            <mesh geometry={WADER_SHAFT_GEOMETRY} material={WADER_MATERIAL} position={[0, -0.3, 0]} castShadow />
            <mesh geometry={UNIT_BOX} material={WADER_CUFF_MATERIAL} position={[0, -0.07, 0]} scale={[0.28, 0.06, 0.28]} castShadow />
            <mesh geometry={UNIT_BOX} material={WADER_MATERIAL} position={[0, -0.52, 0.12]} scale={[0.27, 0.17, 0.45]} castShadow />
          </>}
        </group>
      ))}
      <group ref={torso}>
        <mesh position={[0, 0.92, 0]} material={ROBE_MATERIAL} castShadow><coneGeometry args={[0.52, 1.65, 7]} /></mesh>
        {gear.waders && <mesh geometry={UNIT_BOX} material={WADER_MATERIAL} position={[0, 0.75, 0.43]} scale={[0.42, 0.66, 0.1]} castShadow />}
        <mesh position={[0, 0.16, 0]} material={ROBE_TRIM_MATERIAL} castShadow><cylinderGeometry args={[0.5, 0.54, 0.14, 7]} /></mesh>
        <mesh position={[0, 1.2, 0]} material={GOLD_MATERIAL}><cylinderGeometry args={[0.2, 0.23, 0.08, 7]} /></mesh>
        {gear.tunic && <mesh position={[0, 1.36, 0]} material={WOOD_MATERIAL} castShadow><cylinderGeometry args={[0.24, 0.36, 0.5, 7]} /></mesh>}
        <mesh position={[0, 1.78, 0]} castShadow><sphereGeometry args={[0.34, 12, 10]} /><meshStandardMaterial color="#d6a27a" roughness={0.78} /></mesh>
        <mesh position={[0, 1.5, -0.2]} rotation={[Math.PI + 0.3, 0, 0]} castShadow><coneGeometry args={[0.19, 0.55, 7]} /><meshStandardMaterial color="#ece6dc" roughness={0.92} /></mesh>
        {gear.hat && <>
          <mesh position={[0, 2.18, 0]} castShadow><coneGeometry args={[0.48, 1.05, 8]} /><meshStandardMaterial color="#34234f" roughness={0.72} flatShading /></mesh>
          <mesh position={[0, 2.06, 0]} material={GOLD_MATERIAL}><cylinderGeometry args={[0.31, 0.33, 0.1, 8]} /></mesh>
          <mesh position={[0, 1.98, 0]} material={ROBE_TRIM_MATERIAL} castShadow><cylinderGeometry args={[0.56, 0.56, 0.08, 10]} /></mesh>
        </>}
        <mesh position={[0, 1.78, -0.31]} castShadow><coneGeometry args={[0.08, 0.2, 6]} /><meshStandardMaterial color="#bd805d" /></mesh>
        <group ref={leftArm} position={[-0.3, 1.4, 0]}>
          <mesh position={[-0.08, -0.3, 0]} rotation={[0, 0, 0.25]} material={ROBE_MATERIAL} castShadow><cylinderGeometry args={[0.07, 0.085, 0.62, 6]} /></mesh>
          {gear.offHand === 'shield' && <Shield />}
          {gear.offHand === 'wand' && <Wand side={-1} light={gear.offHandLight} />}
        </group>
        <group ref={rightArm} position={[0.3, 1.4, 0]}>
          <mesh position={[0.08, -0.3, 0]} rotation={[0, 0, -0.25]} material={ROBE_MATERIAL} castShadow><cylinderGeometry args={[0.07, 0.085, 0.62, 6]} /></mesh>
          {gear.mainHand === 'axe' && <Axe />}
          {gear.mainHand === 'spade' && <Spade />}
          {gear.mainHand === 'wand' && <Wand side={1} light />}
        </group>
      </group>
    </group>
  )
}

function TerrainCell({ cell }: { cell: WizardTerrainCell }) {
  const surface = TERRAIN_SURFACE[cell.climate] ?? TERRAIN_SURFACE.temperate_forest
  const detail = useMemo(() => mireglassDetailFor(cell), [cell.id, cell.mireglassTerrain,
    cell.mireglassApproach, cell.mireglassTrailSegment])
  const { top, side, cap } = useMemo(() => {
    const jitter = hashUnit(cell.id, 1) - 0.5
    // Higher cells catch more sun, so lift them a touch; per-cell jitter breaks the uniform grid read.
    const lift = (cell.height - 2) * 0.02
    const top = new THREE.Color(cell.color ?? '#56824b')
    if (cell.mireglassApproach) top.lerp(APPROACH_GROUND_COLOR, 0.42)
    return {
      top: top.offsetHSL(jitter * (cell.mireglassApproach ? 0.01 : 0.03),
        (hashUnit(cell.id, 2) - 0.5) * (cell.mireglassApproach ? 0.03 : 0.08),
        jitter * (cell.mireglassApproach ? 0.015 : 0.05) + lift),
      side: new THREE.Color(surface.side).offsetHSL(0, 0, jitter * 0.04),
      cap: 0.1 + hashUnit(cell.id, 3) * 0.1,
    }
  }, [cell.id, cell.color, cell.height, cell.mireglassApproach, surface.side])
  const [x, y, z] = cell.position
  const [width, depth] = cell.size
  return (
    <group position={[x, 0, z]}>
      {/* Terrain only receives shadows: column-on-column casting produced heavy grid seams for little depth gain. */}
      <mesh geometry={UNIT_BOX} position={[0, y - cap / 2, 0]} scale={[width, cap, depth]} receiveShadow>
        <meshStandardMaterial color={top} roughness={surface.roughness} />
      </mesh>
      <mesh geometry={UNIT_BOX} position={[0, y - cap - (cell.height - cap) / 2, 0]} scale={[width, cell.height - cap, depth]} receiveShadow>
        <meshStandardMaterial color={side} roughness={0.97} />
      </mesh>
      {detail.water && <mesh geometry={UNIT_BOX} material={MIREGLASS_WATER_MATERIAL} position={[detail.x, y + 0.012, detail.z]} rotation={[0, detail.rotation, 0]} scale={[2.2, 0.024, 1.35]} />}
      {detail.reeds && <group position={[detail.x + 0.9, y, detail.z - 0.7]} rotation={[0, detail.rotation, 0]}>
        <mesh geometry={UNIT_BOX} material={MIREGLASS_REED_MATERIAL} position={[-0.12, 0.24, 0]} rotation={[0, 0, -0.12]} scale={[0.045, 0.48, 0.045]} />
        <mesh geometry={UNIT_BOX} material={MIREGLASS_REED_MATERIAL} position={[0.09, 0.31, 0.09]} rotation={[0, 0, 0.16]} scale={[0.04, 0.62, 0.04]} />
        <mesh geometry={UNIT_BOX} material={MIREGLASS_REED_MATERIAL} position={[0.02, 0.18, -0.1]} scale={[0.04, 0.36, 0.04]} />
      </group>}
      {detail.peat && <mesh geometry={UNIT_BOX} material={MIREGLASS_PEAT_MATERIAL} position={[detail.x, y + 0.01, detail.z]} rotation={[0, detail.rotation, 0]} scale={[1.8, 0.02, 1.25]} />}
      {detail.stone && <mesh geometry={ROCK_GEOMETRY} material={MIREGLASS_STONE_MATERIAL} position={[detail.x, y + 0.1, detail.z]} rotation={[0, detail.rotation, 0]} scale={[0.55, 0.16, 0.42]} />}
      {detail.soil && <mesh geometry={ROCK_GEOMETRY} material={APPROACH_SOIL_MATERIAL}
        position={[detail.x, y + 0.012, detail.z]} rotation={[0, detail.rotation, 0]} scale={[1.05, 0.025, 0.8]} />}
      {detail.trail && <mesh geometry={UNIT_BOX} material={APPROACH_TRAIL_MATERIAL}
        position={[detail.trailX, y + 0.021, detail.trailZ]} rotation={[0, detail.trailYaw, 0]}
        scale={[1.1, 0.024, detail.trailLength + 0.04]} receiveShadow />}
      {detail.brush && <group position={[detail.brushX, y, detail.brushZ]} rotation={[0, detail.rotation, 0]}>
        <mesh geometry={UNIT_BOX} material={MIREGLASS_REED_MATERIAL} position={[-0.12, 0.23, 0]} rotation={[0, 0, -0.22]} scale={[0.035, 0.46, 0.035]} />
        <mesh geometry={UNIT_BOX} material={MIREGLASS_REED_MATERIAL} position={[0.11, 0.19, 0.08]} rotation={[0, 0, 0.24]} scale={[0.035, 0.38, 0.035]} />
        <mesh geometry={LEAF_GEOMETRY} material={APPROACH_BRUSH_MATERIAL} position={[-0.19, 0.39, 0]} scale={[0.23, 0.12, 0.2]} />
        <mesh geometry={LEAF_GEOMETRY} material={APPROACH_BRUSH_MATERIAL} position={[0.18, 0.31, 0.08]} scale={[0.21, 0.11, 0.18]} />
      </group>}
      {detail.pebbles && <group position={[detail.x + 0.68, y, detail.z - 0.52]} rotation={[0, detail.rotation, 0]}>
        <mesh geometry={ROCK_GEOMETRY} material={APPROACH_PEBBLE_MATERIAL} position={[-0.16, 0.055, 0]} scale={[0.27, 0.09, 0.2]} />
        <mesh geometry={ROCK_GEOMETRY} material={APPROACH_PEBBLE_MATERIAL} position={[0.17, 0.04, 0.08]} scale={[0.18, 0.07, 0.16]} />
      </group>}
    </group>
  )
}

function Tree({ node, pose, yaw, scale, baseOpacity }: { node: WizardResourceNode; pose: PresentationPose; yaw: number; scale: number; baseOpacity: number }) {
  const trunk = useRef<THREE.Group>(null)
  const canopy = useRef<THREE.Group>(null)
  const occluded = useRef(false)
  const treeOpacity = useRef(baseOpacity)
  const [x, y, z] = node.position
  useFrame(({ camera }, delta) => {
    if (!canopy.current || !trunk.current) return
    const centreY = y + CANOPY_CENTRE_Y_M * scale
    const ax = camera.position.x
    const ay = camera.position.y
    const az = camera.position.z
    const dx = pose.position.x - ax
    const dy = pose.position.y + AVATAR_FOCUS_HEIGHT_M - ay
    const dz = pose.position.z - az
    const length2 = dx * dx + dy * dy + dz * dz
    const t = length2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (centreY - ay) * dy + (z - az) * dz) / length2)) : 0
    const distance = Math.hypot(ax + dx * t - x, ay + dy * t - centreY, az + dz * t - z)
    const radius = CANOPY_RADIUS_M * scale
    const margin = occluded.current ? OCCLUDE_EXIT_MARGIN_M : OCCLUDE_ENTER_MARGIN_M
    occluded.current = distance < radius + margin || treeTrunkBlocksView(camera.position, pose.position, node.position, scale, margin)
    const target = occluded.current ? Math.min(baseOpacity, OCCLUDED_OPACITY) : baseOpacity
    treeOpacity.current += (target - treeOpacity.current) * damping(occluded.current ? FADE_OUT_PER_S : FADE_IN_PER_S, delta)
    for (let index = 0; index < canopy.current.children.length; index += 1) {
      ((canopy.current.children[index] as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = treeOpacity.current
    }
    for (let index = 0; index < trunk.current.children.length; index += 1) {
      const material = (trunk.current.children[index] as THREE.Mesh).material as THREE.MeshStandardMaterial
      material.opacity = treeOpacity.current
      material.depthWrite = !occluded.current
    }
  })
  // Shadow depth ignores opacity, so a faded (depleted) node stops casting rather than leaving a solid silhouette.
  const castShadow = node.available
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]} scale={scale}>
      {/* Materials stay transparent; nearby trunk depth write is disabled only while faded so it cannot mask the wizard. */}
      <group ref={trunk}>
        <mesh geometry={ROCK_GEOMETRY} position={[0, 0.1, 0]} scale={[0.62, 0.28, 0.62]} castShadow={castShadow}><meshStandardMaterial color="#4e3322" roughness={0.95} flatShading transparent opacity={baseOpacity} /></mesh>
        <mesh position={[0, 1.7, 0]} castShadow={castShadow}>
          <cylinderGeometry args={[0.24, 0.42, 3.4, 7]} />
          <meshStandardMaterial color="#5c3b27" roughness={0.95} transparent opacity={baseOpacity} />
        </mesh>
      </group>
      <group ref={canopy}>
        {TREE_CANOPY.map(([lx, ly, lz, radius, color], index) => (
          <mesh key={index} geometry={LEAF_GEOMETRY} position={[lx, ly, lz]} scale={radius} castShadow={castShadow}>
            <meshStandardMaterial color={color} roughness={0.88} flatShading transparent opacity={baseOpacity} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

function Resource({ node, pose }: { node: WizardResourceNode; pose: PresentationPose }) {
  const faded = { transparent: !node.available, opacity: node.available ? 1 : 0.3 }
  const yaw = hashUnit(node.id, 1) * Math.PI * 2
  const scale = 0.88 + hashUnit(node.id, 2) * 0.24
  const position = node.position as [number, number, number]
  if (node.kind === 'tree') return <Tree node={node} pose={pose} yaw={yaw} scale={scale} baseOpacity={faded.opacity} />
  if (node.kind === 'ore') {
    return (
      <group position={position} rotation={[0, yaw, 0]} scale={scale}>
        <mesh geometry={ROCK_GEOMETRY} position={[0, 0.45, 0]} rotation={[0.15, 0.4, 0]} scale={0.7} castShadow={node.available}>
          <meshStandardMaterial color="#5d6477" roughness={0.6} metalness={0.3} flatShading {...faded} />
        </mesh>
        {([[0.25, 1.0, 0.1, 0.22], [-0.3, 0.9, -0.15, 0.17]] as const).map(([x, y, z, size], index) => (
          <mesh key={index} geometry={CRYSTAL_GEOMETRY} position={[x, y, z]} rotation={[0.3 * index, 0.5, -0.2]} scale={[size, size * 1.8, size]} castShadow={node.available}>
            <meshStandardMaterial color="#a98cff" emissive="#7a52e8" emissiveIntensity={node.available ? 0.9 : 0.15} roughness={0.3} flatShading {...faded} />
          </mesh>
        ))}
      </group>
    )
  }
  const herb = node.kind === 'herb'
  return (
    <group position={position} rotation={[0, yaw, 0]} scale={scale}>
      {[-0.28, 0, 0.28].map((offset, index) => herb ? (
        <group key={offset} position={[offset, 0, 0]} rotation={[0, 0, offset * 1.2]}>
          <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.025, 0.04, 0.4, 5]} /><meshStandardMaterial color="#3f7a2e" roughness={0.9} {...faded} /></mesh>
          <mesh geometry={LEAF_GEOMETRY} position={[0, 0.46, 0]} scale={[0.26, 0.2, 0.26]} castShadow={node.available}>
            <meshStandardMaterial color={index === 1 ? '#8fe066' : '#6fcf55'} emissive="#2d6a1c" emissiveIntensity={0.2} roughness={0.75} flatShading {...faded} />
          </mesh>
        </group>
      ) : (
        <mesh key={offset} geometry={ROCK_GEOMETRY} position={[offset, 0.22, offset * 0.4]} rotation={[0.2, offset * 2, 0]} scale={[0.3, 0.24 + index * 0.04, 0.3]} castShadow={node.available}>
          <meshStandardMaterial color={index === 1 ? '#a89b84' : '#8f8370'} roughness={0.96} flatShading {...faded} />
        </mesh>
      ))}
    </group>
  )
}

function Store({ store }: { store: WizardStore }) {
  return (
    <group position={store.position as [number, number, number]}>
      <mesh geometry={UNIT_BOX} position={[0, 0.16, 0]} scale={[3.5, 0.32, 2.5]} castShadow receiveShadow><meshStandardMaterial color="#6d6a62" roughness={0.95} /></mesh>
      <mesh geometry={UNIT_BOX} position={[0, 1.3, 0]} scale={[3.2, 2.0, 2.2]} castShadow receiveShadow><meshStandardMaterial color="#8a5a3e" roughness={0.86} /></mesh>
      {([[-1.52, 1.03], [1.52, 1.03], [-1.52, -1.03], [1.52, -1.03]] as const).map(([x, z], index) => (
        <mesh key={index} geometry={UNIT_BOX} material={DARK_WOOD_MATERIAL} position={[x, 1.3, z]} scale={[0.18, 2.0, 0.18]} castShadow />
      ))}
      <mesh position={[0, 2.95, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[2.35, 1.5, 4]} /><meshStandardMaterial color="#7c2f49" roughness={0.7} flatShading /></mesh>
      <mesh geometry={UNIT_BOX} position={[0.9, 3.35, -0.4]} scale={[0.36, 0.9, 0.36]} castShadow><meshStandardMaterial color="#5b5651" roughness={0.9} /></mesh>
      <mesh geometry={UNIT_BOX} position={[0, 1.8, 1.12]} scale={[1.8, 0.7, 0.12]}><meshStandardMaterial color="#d9b872" roughness={0.6} /></mesh>
      <mesh geometry={UNIT_BOX} position={[-0.9, 0.95, 1.12]} scale={[0.7, 1.25, 0.1]}><meshStandardMaterial color="#3d2a1c" roughness={0.9} /></mesh>
      {/* The lit window is purely emissive; a per-store point light was not worth its per-fragment cost. */}
      <mesh geometry={UNIT_BOX} position={[0.8, 1.15, 1.12]} scale={[0.6, 0.6, 0.1]}><meshStandardMaterial color="#ffd98a" emissive="#ffb650" emissiveIntensity={1.9} roughness={0.3} /></mesh>
    </group>
  )
}

function FairyRing({ ring }: { ring: WizardFairyRing }) {
  const mushrooms = useMemo(() => Array.from({ length: 11 }, (_, index) => {
    const angle = index / 11 * Math.PI * 2
    return [Math.cos(angle) * 1.35, Math.sin(angle) * 1.35, angle, 0.8 + hashUnit(`${ring.id}:${index}`, 4) * 0.45] as const
  }), [ring.id])
  const glow = ring.discovered ? 1 : 0.4
  return (
    <group position={ring.position as [number, number, number]}>
      <pointLight position={[0, 0.8, 0]} color="#b085ff" intensity={ring.discovered ? 12 : 4} distance={7} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.95, 1.7, 40]} />
        <meshStandardMaterial color="#5a3f7a" emissive="#8a5cff" emissiveIntensity={0.6 * glow} roughness={0.8} transparent opacity={0.55} depthWrite={false} />
      </mesh>
      {mushrooms.map(([x, z, angle, size], index) => (
        <group key={index} position={[x, 0, z]} rotation={[0, -angle, 0]} scale={size}>
          <mesh position={[0, 0.22, 0]} castShadow><cylinderGeometry args={[0.06, 0.1, 0.44, 7]} /><meshStandardMaterial color="#efe7d6" roughness={0.85} /></mesh>
          <mesh position={[0, 0.48, 0]} castShadow><coneGeometry args={[0.24, 0.22, 8]} /><meshStandardMaterial color={ring.discovered ? '#b06cea' : '#776a78'} emissive="#713ea5" emissiveIntensity={0.9 * glow} roughness={0.55} flatShading /></mesh>
        </group>
      ))}
    </group>
  )
}

function Waystone({ inscription }: { inscription: WizardInscription }) {
  return <group name={`Waystone: ${inscription.name}`} position={inscription.position as [number, number, number]}>
    <mesh geometry={ROCK_GEOMETRY} position={[0, 1.05, 0]} rotation={[0.08, 0.3, -0.09]} scale={[0.55, 1.05, 0.42]} castShadow>
      <meshStandardMaterial color="#796e91" roughness={0.83} flatShading />
    </mesh>
    <mesh geometry={CRYSTAL_GEOMETRY} position={[0, 1.35, 0.4]} scale={[0.2, 0.38, 0.08]}>
      <meshStandardMaterial color="#bd9cff" emissive="#9b6fff" emissiveIntensity={inscription.studied ? 1.2 : 2.2} roughness={0.3} />
    </mesh>
    <mesh geometry={ROCK_GEOMETRY} position={[0, 0.1, 0]} scale={[0.9, 0.25, 0.8]} receiveShadow><meshStandardMaterial color="#5d566e" roughness={0.95} flatShading /></mesh>
  </group>
}

export function digSiteAppearance(site: Pick<WizardDigSite, 'revealed' | 'excavated'>): 'hidden' | 'mound' | 'dug' {
  return site.excavated ? 'dug' : site.revealed ? 'mound' : 'hidden'
}

function DigSite({ site }: { site: WizardDigSite }) {
  const appearance = digSiteAppearance(site)
  if (appearance === 'hidden') return null
  return <group name={`Dig site: ${site.name} (${appearance})`} position={site.position as [number, number, number]}>
    {appearance === 'dug' ? <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} receiveShadow><circleGeometry args={[0.7, 16]} /><meshStandardMaterial color="#352c23" roughness={1} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}><torusGeometry args={[0.83, 0.15, 6, 16]} /><meshStandardMaterial color="#84684a" roughness={1} flatShading /></mesh>
      {[-1, 1].map((side) => <mesh key={side} geometry={ROCK_GEOMETRY} position={[side * 0.78, 0.14, 0.2]} scale={[0.32, 0.18, 0.3]} castShadow><meshStandardMaterial color="#8c7151" roughness={1} flatShading /></mesh>)}
    </> : <>
      <mesh position={[0, 0.1, 0]} scale={[1, 0.28, 0.75]} castShadow receiveShadow><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial color="#8b7558" roughness={1} flatShading /></mesh>
      <mesh geometry={CRYSTAL_GEOMETRY} position={[0, 0.5, 0]} scale={[0.16, 0.28, 0.16]}><meshStandardMaterial color="#d9bd7a" emissive="#a27c38" emissiveIntensity={0.5} roughness={0.55} /></mesh>
    </>}
  </group>
}

/** Display selection only. The campaign owns revelation, excavation, and interaction reach. */
export function landmarkAppearance(landmark: WizardLandmark): 'frontier-marker' | 'bell-alder' | 'hidden' | 'mound' | 'dug' {
  if (landmark.kind !== 'seal-cache') return landmark.kind
  if (!landmark.revealed) return 'hidden'
  return digSiteAppearance(landmark)
}

function Landmark({ landmark }: { landmark: WizardLandmark }) {
  const appearance = landmarkAppearance(landmark)
  if (appearance === 'hidden') return null
  const position = landmark.position as [number, number, number]
  if (landmark.kind === 'frontier-marker') return <group name="Mireglass frontier marker" position={position}>
    <mesh geometry={ROCK_GEOMETRY} material={MARKER_STONE_MATERIAL} position={[0, 0.12, 0]} scale={[0.95, 0.22, 0.7]} castShadow receiveShadow />
    <mesh geometry={ROCK_GEOMETRY} material={MARKER_STONE_MATERIAL} position={[-0.34, 0.84, 0]} rotation={[0, 0.16, -0.12]} scale={[0.32, 0.84, 0.29]} castShadow />
    <mesh geometry={ROCK_GEOMETRY} material={MARKER_STONE_MATERIAL} position={[0.28, 1.02, -0.08]} rotation={[0, -0.18, 0.11]} scale={[0.35, 1.01, 0.3]} castShadow />
    <mesh geometry={UNIT_BOX} material={landmark.studied ? MARKER_DORMANT_MATERIAL : MARKER_RUNE_MATERIAL} position={[0.28, 1.23, 0.27]} rotation={[0, -0.18, 0.11]} scale={[0.09, 0.55, 0.05]} />
    <mesh geometry={CRYSTAL_GEOMETRY} material={MARKER_STONE_MATERIAL} position={[0.02, 1.85, -0.02]} rotation={[0, 0.4, 0.4]} scale={[0.24, 0.36, 0.21]} castShadow />
  </group>
  if (landmark.kind === 'bell-alder') return <group name="Mireglass bell alder" position={position}>
    <mesh geometry={ROCK_GEOMETRY} material={CACHE_PEAT_MATERIAL} position={[0, 0.08, 0]} scale={[0.8, 0.18, 0.65]} receiveShadow />
    <mesh geometry={ALDER_TRUNK_GEOMETRY} material={ALDER_BARK_MATERIAL} position={[0.43, 1.72, 0]} rotation={[0, 0, -0.26]} castShadow />
    <mesh geometry={UNIT_BOX} material={ALDER_BARK_MATERIAL} position={[-0.38, 2.66, 0]} rotation={[0, 0, 0.33]} scale={[1.8, 0.18, 0.18]} castShadow />
    <mesh geometry={UNIT_BOX} material={ALDER_BARK_MATERIAL} position={[1.19, 2.81, -0.12]} rotation={[0, 0, -0.44]} scale={[1.45, 0.16, 0.16]} castShadow />
    <mesh geometry={LEAF_GEOMETRY} material={ALDER_LEAF_MATERIAL} position={[-1.15, 3.1, 0]} scale={[0.92, 0.46, 0.72]} castShadow />
    <mesh geometry={LEAF_GEOMETRY} material={ALDER_LEAF_MATERIAL} position={[0.35, 3.51, -0.16]} scale={[1.25, 0.62, 0.78]} castShadow />
    <mesh geometry={LEAF_GEOMETRY} material={ALDER_LEAF_MATERIAL} position={[1.54, 3.25, -0.16]} scale={[0.86, 0.48, 0.62]} castShadow />
    <mesh geometry={UNIT_BOX} material={ALDER_BARK_MATERIAL} position={[-1.09, 2.26, 0]} scale={[0.035, 0.78, 0.035]} />
    <mesh geometry={CRYSTAL_GEOMETRY} material={ALDER_BELL_MATERIAL} position={[-1.09, 1.79, 0]} scale={[0.2, 0.25, 0.2]} />
  </group>
  return <group name={`Mireglass seal cache (${appearance})`} position={position}>
    {appearance === 'mound' ? <>
      <mesh geometry={ROCK_GEOMETRY} material={CACHE_PEAT_MATERIAL} position={[0, 0.14, 0]} rotation={[0, 0.36, 0]} scale={[0.85, 0.26, 0.63]} castShadow receiveShadow />
      <mesh geometry={ROCK_GEOMETRY} material={MIREGLASS_STONE_MATERIAL} position={[-0.41, 0.27, 0.14]} scale={[0.24, 0.12, 0.2]} castShadow />
      <mesh geometry={CRYSTAL_GEOMETRY} material={MARKER_DORMANT_MATERIAL} position={[0.19, 0.32, 0.03]} scale={[0.12, 0.09, 0.12]} />
    </> : <>
      <mesh geometry={CACHE_PIT_GEOMETRY} material={CACHE_PIT_MATERIAL} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} receiveShadow />
      {[-1, 0, 1].map((side) => <mesh key={side} geometry={ROCK_GEOMETRY} material={CACHE_PEAT_MATERIAL}
        position={[side * 0.62, 0.13, side === 0 ? -0.67 : 0.23]} rotation={[0, side * 0.4, 0]} scale={[0.31, 0.16, 0.26]} castShadow />)}
    </>}
  </group>
}

export function constructionVisuals(routes: readonly WizardRoute[], sites: readonly WizardBuildSite[], siteId: string | null): Pick<WizardRoute, 'id' | 'from' | 'to' | 'built'>[] {
  const preview = sites.find((site) => site.id === siteId && site.discovered && site.status !== 'built' && !routes.some((route) => route.id === site.routeId && route.built))
  return [...routes.filter((route) => route.built), ...(preview ? [{ id: preview.id, from: preview.from, to: preview.to, built: false }] : [])]
}

/** Mireglass IDs identify authored structure kinds; legacy v5 routes retain their existing view. */
export function mireglassConstructionGeometry(route: Pick<WizardRoute, 'id' | 'from' | 'to'>) {
  const bridgeId = 'mireglass_reach/route/fen_bridge'
  const ladderId = 'mireglass_reach/route/slate_ladder'
  const kind = route.id === bridgeId || route.id.startsWith(`${bridgeId}/`) ? 'bridge'
    : route.id === ladderId || route.id.startsWith(`${ladderId}/`) ? 'ladder' : null
  if (!kind) return null
  const dx = route.to[0] - route.from[0]
  const dz = route.to[2] - route.from[2]
  const horizontalSpan = Math.hypot(dx, dz)
  if (horizontalSpan < 0.01) return null
  const rise = route.to[1] - route.from[1]
  // The ladder leans against the seam between tile centres, rather than lying across the whole 4 m tile span.
  const run = kind === 'bridge' ? horizontalSpan : Math.min(0.65, horizontalSpan * 0.2)
  const length = Math.hypot(run, rise)
  const count = kind === 'bridge' ? Math.ceil(horizontalSpan / 0.65) : Math.max(4, Math.ceil(length / 0.32))
  return { kind, midpoint: [(route.from[0] + route.to[0]) / 2, (route.from[1] + route.to[1]) / 2,
    (route.from[2] + route.to[2]) / 2] as const,
    yaw: Math.atan2(dx, dz), pitch: -Math.atan2(rise, run), run, rise, length, count } as const
}

function ConstructionRoute({ route }: { route: Pick<WizardRoute, 'id' | 'from' | 'to' | 'built'> }) {
  const mireglass = mireglassConstructionGeometry(route)
  if (mireglass) {
    const material = route.built ? WOOD_MATERIAL : GOLD_MATERIAL
    const [x, y, z] = mireglass.midpoint
    if (mireglass.kind === 'bridge') return <group name="Mireglass fen bridge" position={[x, y + 0.16, z]} rotation={[mireglass.pitch, mireglass.yaw, 0]}>
      {/* One continuous deck and two longitudinal beams carry joined planks across both banks. */}
      <mesh geometry={UNIT_BOX} material={material} scale={[1.58, 0.14, mireglass.run + 0.7]} castShadow={route.built} receiveShadow />
      {[-0.57, 0.57].map((side) => <mesh key={side} geometry={UNIT_BOX} material={DARK_WOOD_MATERIAL}
        position={[side, -0.13, 0]} scale={[0.15, 0.15, mireglass.run + 0.55]} castShadow={route.built} />)}
      {Array.from({ length: mireglass.count }, (_, index) => <mesh key={index} geometry={UNIT_BOX}
        material={route.built && index % 2 ? DARK_WOOD_MATERIAL : material}
        position={[0, 0.105, -mireglass.run / 2 + (index + 0.5) * mireglass.run / mireglass.count]}
        scale={[1.68, 0.06, mireglass.run / mireglass.count + 0.04]} castShadow={route.built} receiveShadow />)}
    </group>
    return <group name="Mireglass slate ladder" position={[x, y + 0.14, z]} rotation={[mireglass.pitch, mireglass.yaw, 0]}>
      {[-0.47, 0.47].map((side) => <mesh key={side} geometry={UNIT_BOX} material={material}
        position={[side, 0, 0]} scale={[0.11, 0.11, mireglass.length + 0.22]} castShadow={route.built} />)}
      {Array.from({ length: mireglass.count }, (_, index) => <mesh key={index} geometry={UNIT_BOX} material={material}
        position={[0, 0.04, -mireglass.length / 2 + (index + 0.5) * mireglass.length / mireglass.count]}
        scale={[1.05, 0.09, 0.14]} castShadow={route.built} />)}
    </group>
  }
  const from = new THREE.Vector3(...route.from)
  const to = new THREE.Vector3(...route.to)
  const midpoint = from.clone().lerp(to, 0.5)
  const length = from.distanceTo(to)
  const yaw = Math.atan2(to.x - from.x, to.z - from.z)
  return (
    <group>
      {[route.from, route.to].map((position, index) => (
        <group key={index} position={[position[0], position[1], position[2]]}>
          <mesh position={[0, 0.5, 0]} material={route.built ? WOOD_MATERIAL : GOLD_MATERIAL} castShadow={route.built}><cylinderGeometry args={[0.11, 0.17, 1.0, 6]} /></mesh>
          <mesh geometry={CRYSTAL_GEOMETRY} position={[0, 1.1, 0]} scale={[0.1, 0.16, 0.1]}>
            <meshStandardMaterial color="#d9b45c" emissive={route.built ? '#ffb347' : '#89c9ff'} emissiveIntensity={route.built ? 0.8 : 1.7} roughness={0.4} metalness={0.4} />
          </mesh>
        </group>
      ))}
      <group position={[midpoint.x, midpoint.y + 0.25, midpoint.z]} rotation={[0, yaw, 0]}>
        {route.built ? Array.from({ length: 7 }, (_, index) => (
          <mesh key={index} geometry={UNIT_BOX} position={[0, 0, -length / 2 + length * index / 6]} rotation={[0, (hashUnit(`${route.id}:${index}`, 5) - 0.5) * 0.12, 0]} scale={[1.35, 0.16, 0.46]} castShadow receiveShadow>
            <meshStandardMaterial color={index % 2 ? '#8a5f36' : '#7d552f'} roughness={0.92} />
          </mesh>
        )) : <>
          {[-0.55, 0.55].map((x) => <mesh key={x} geometry={UNIT_BOX} material={GOLD_MATERIAL} position={[x, 0, 0]} scale={[0.08, 0.08, length]} />)}
          <mesh geometry={UNIT_BOX} position={[0, -0.1, 0]} scale={[1.2, 0.04, length]}><meshStandardMaterial color="#d9eaff" emissive="#7bbcff" emissiveIntensity={0.8} transparent opacity={0.5} depthWrite={false} /></mesh>
        </>}
      </group>
    </group>
  )
}

export function WizardScene({ projection, cameraOrbit, orbiting }: {
  projection: WizardViewProjection
  cameraOrbit: readonly [number, number]
  orbiting: boolean
}) {
  const [pose] = useState<PresentationPose>(() => ({
    position: new THREE.Vector3(...projection.player.position), yaw: projection.player.yaw, speed: 0, phase: 0,
  }))
  const worldSupport = useRef<THREE.Group>(null)
  const sunTarget = useMemo(() => new THREE.Object3D(), [])
  const visibleRoutes = constructionVisuals(projection.routes, projection.buildSites, projection.selectedBuildSiteId)
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.5]}
      gl={{
        alpha: false,
        antialias: true,
        powerPreference: 'high-performance',
        outputColorSpace: THREE.SRGBColorSpace,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.08,
      }}
      camera={{ fov: 68, near: 0.08, far: 180 }}
    >
      <color attach="background" args={[SKY_COLOR]} />
      <fog attach="fog" args={[FOG_COLOR, 24, 100]} />
      {/* Light hierarchy: warm sun key with shadows, sky/ground hemisphere fill, cool rim from the shaded side. */}
      <hemisphereLight args={['#cde4ff', '#4f6a33', 0.85]} />
      <ambientLight intensity={0.22} color="#dfe8ff" />
      <group ref={worldSupport} position={[pose.position.x, 0, pose.position.z]}>
        <primitive object={sunTarget} />
        <directionalLight
          position={[18, 30, 12]}
          target={sunTarget}
          intensity={2.9}
          color="#ffe6b8"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-radius={2.5}
          shadow-bias={-0.0004}
          shadow-normalBias={0.04}
          shadow-camera-near={4}
          shadow-camera-far={90}
          shadow-camera-left={-26}
          shadow-camera-right={26}
          shadow-camera-top={26}
          shadow-camera-bottom={-26}
        />
        <directionalLight position={[-16, 10, -20]} target={sunTarget} intensity={0.7} color="#9ec1ff" />
        {/* Bedrock meadow under the tile columns so the world reads as raised land rather than islands over void. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.72, 0]} receiveShadow>
          <planeGeometry args={[320, 320]} />
          <meshStandardMaterial color={BEDROCK_COLOR} roughness={1} />
        </mesh>
      </group>
      <PresentationPoseDriver player={projection.player} pose={pose} worldSupport={worldSupport} />
      <CameraRig pose={pose} cameraOrbit={cameraOrbit} orbiting={orbiting} stores={projection.stores} />
      {visibleTerrainCells(projection.terrain, projection.player.position).map((cell) => <TerrainCell key={cell.id} cell={cell} />)}
      {projection.resources.map((node) => <Resource key={node.id} node={node} pose={pose} />)}
      {projection.stores.map((store) => <Store key={store.id} store={store} />)}
      {projection.fairyRings.map((ring) => <FairyRing key={ring.id} ring={ring} />)}
      {projection.inscriptions.map((inscription) => <Waystone key={inscription.id} inscription={inscription} />)}
      {projection.digSites.map((site) => <DigSite key={site.id} site={site} />)}
      {projection.landmarks?.map((landmark) => <Landmark key={landmark.id} landmark={landmark} />)}
      {visibleRoutes.map((route) => <ConstructionRoute key={route.id} route={route} />)}
      <WizardAvatar pose={pose} equipment={projection.equipment} />
    </Canvas>
  )
}
