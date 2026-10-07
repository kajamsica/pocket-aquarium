import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { WizardFairyRing, WizardResourceNode, WizardRoute, WizardStore, WizardViewProjection } from './contracts'

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

function PresentationPoseDriver({ player, pose }: { player: WizardViewProjection['player']; pose: PresentationPose }) {
  const target = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, delta) => {
    target.set(player.position[0], player.position[1], player.position[2])
    if (Math.hypot(target.x - pose.position.x, target.z - pose.position.z) > TELEPORT_SNAP_DISTANCE_M) {
      pose.position.copy(target)
      pose.yaw = player.yaw
      pose.speed = 0
      return
    }
    const previousX = pose.position.x
    const previousZ = pose.position.z
    pose.position.lerp(target, damping(POSITION_DAMPING_PER_S, delta))
    pose.yaw += shortestArc(pose.yaw, player.yaw) * damping(YAW_DAMPING_PER_S, delta)
    const realizedSpeed = delta > 0 ? Math.hypot(pose.position.x - previousX, pose.position.z - previousZ) / delta : 0
    pose.speed += (realizedSpeed - pose.speed) * damping(SPEED_DAMPING_PER_S, delta)
    pose.phase = (pose.phase + pose.speed / STRIDE_LENGTH_M * Math.PI * 2 * delta) % (Math.PI * 2)
  }, -1)
  return null
}

function CameraRig({ pose, cameraOrbit, orbiting }: {
  pose: PresentationPose
  cameraOrbit: readonly [number, number]
  orbiting: boolean
}) {
  const orbitYaw = useRef(cameraOrbit[0])
  const orbitPitch = useRef(cameraOrbit[1])
  const target = useMemo(() => new THREE.Vector3(), [])
  const desired = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }, delta) => {
    const blend = 1 - Math.exp(-(orbiting ? 18 : 2.6) * delta)
    orbitYaw.current += ((orbiting ? cameraOrbit[0] : 0) - orbitYaw.current) * blend
    orbitPitch.current += ((orbiting ? cameraOrbit[1] : 0.28) - orbitPitch.current) * blend
    const heading = pose.yaw + orbitYaw.current
    const distance = 6.4
    const horizontal = Math.cos(orbitPitch.current) * distance
    target.set(pose.position.x, pose.position.y + 1.35, pose.position.z)
    desired.set(
      target.x + Math.sin(heading) * horizontal,
      target.y + 1.2 + Math.sin(orbitPitch.current) * distance,
      target.z + Math.cos(heading) * horizontal,
    )
    camera.position.lerp(desired, 1 - Math.exp(-10 * delta))
    camera.lookAt(target)
  })
  return null
}

function WizardAvatar({ pose }: { pose: PresentationPose }) {
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
      <group ref={leftLeg} position={[-0.16, 0.6, 0]}><mesh position={[0, -0.3, 0]} castShadow><cylinderGeometry args={[0.09, 0.11, 0.6, 6]} /><meshStandardMaterial color="#34234f" roughness={0.9} /></mesh></group>
      <group ref={rightLeg} position={[0.16, 0.6, 0]}><mesh position={[0, -0.3, 0]} castShadow><cylinderGeometry args={[0.09, 0.11, 0.6, 6]} /><meshStandardMaterial color="#34234f" roughness={0.9} /></mesh></group>
      <group ref={torso}>
        <mesh position={[0, 0.92, 0]} castShadow><coneGeometry args={[0.52, 1.65, 7]} /><meshStandardMaterial color="#513477" roughness={0.82} /></mesh>
        <mesh position={[0, 1.78, 0]} castShadow><sphereGeometry args={[0.34, 10, 8]} /><meshStandardMaterial color="#c9946c" roughness={0.9} /></mesh>
        <mesh position={[0, 2.18, 0]} castShadow><coneGeometry args={[0.48, 1.05, 8]} /><meshStandardMaterial color="#34234f" roughness={0.78} /></mesh>
        <mesh position={[0, 1.98, 0]} castShadow><cylinderGeometry args={[0.56, 0.56, 0.08, 10]} /><meshStandardMaterial color="#34234f" /></mesh>
        <mesh position={[0, 1.78, -0.31]} castShadow><coneGeometry args={[0.08, 0.2, 6]} /><meshStandardMaterial color="#bd805d" /></mesh>
        <group ref={leftArm} position={[-0.3, 1.4, 0]}><mesh position={[-0.08, -0.3, 0]} rotation={[0, 0, 0.25]} castShadow><cylinderGeometry args={[0.07, 0.085, 0.62, 6]} /><meshStandardMaterial color="#513477" roughness={0.82} /></mesh></group>
        <group ref={rightArm} position={[0.3, 1.4, 0]}>
          <mesh position={[0.08, -0.3, 0]} rotation={[0, 0, -0.25]} castShadow><cylinderGeometry args={[0.07, 0.085, 0.62, 6]} /><meshStandardMaterial color="#513477" roughness={0.82} /></mesh>
          <mesh position={[0.18, -0.32, 0]} rotation={[0.05, 0, 0.12]} castShadow><cylinderGeometry args={[0.035, 0.05, 2.45, 7]} /><meshStandardMaterial color="#6d472c" /></mesh>
        </group>
        <pointLight position={[0.5, 2.28, 0]} color="#bd82ff" intensity={2.2} distance={3.5} />
      </group>
    </group>
  )
}

function Resource({ node }: { node: WizardResourceNode }) {
  const opacity = node.available ? 1 : 0.28
  if (node.kind === 'tree') {
    return (
      <group position={node.position as [number, number, number]}>
        <mesh position={[0, 1.7, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.46, 3.4, 7]} />
          <meshStandardMaterial color="#70442d" transparent opacity={opacity} />
        </mesh>
        {([[-0.45, 3.1, 0.1], [0.38, 3.35, -0.2], [0, 3.85, 0]] as const).map((position, index) => (
          <mesh key={index} position={position} castShadow>
            <icosahedronGeometry args={[1.12 - index * 0.08, 1]} />
            <meshStandardMaterial color={index === 1 ? '#3d8b4a' : '#52a456'} transparent opacity={opacity} roughness={0.9} />
          </mesh>
        ))}
      </group>
    )
  }
  if (node.kind === 'ore') {
    return (
      <mesh position={node.position as [number, number, number]} rotation={[0.15, 0.4, 0]} castShadow>
        <dodecahedronGeometry args={[0.7, 0]} />
        <meshStandardMaterial color="#717b95" emissive="#6859aa" emissiveIntensity={0.24} transparent opacity={opacity} />
      </mesh>
    )
  }
  return (
    <group position={node.position as [number, number, number]}>
      {[-0.28, 0, 0.28].map((offset) => (
        <mesh key={offset} position={[offset, 0.35, 0]} rotation={[0, 0, offset * 1.2]} castShadow>
          <sphereGeometry args={[0.24, 8, 6]} />
          <meshStandardMaterial color={node.kind === 'herb' ? '#7ad85c' : '#d9b162'} transparent opacity={opacity} />
        </mesh>
      ))}
    </group>
  )
}

function Store({ store }: { store: WizardStore }) {
  return (
    <group position={store.position as [number, number, number]}>
      <mesh position={[0, 1.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 2.3, 2.2]} />
        <meshStandardMaterial color="#774b35" />
      </mesh>
      <mesh position={[0, 2.55, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[2.25, 1.4, 4]} />
        <meshStandardMaterial color="#7b2e45" />
      </mesh>
      <mesh position={[0, 1.3, 1.12]}>
        <boxGeometry args={[1.8, 0.95, 0.12]} />
        <meshStandardMaterial color="#d2ae70" />
      </mesh>
    </group>
  )
}

function FairyRing({ ring }: { ring: WizardFairyRing }) {
  const mushrooms = useMemo(() => Array.from({ length: 11 }, (_, index) => {
    const angle = index / 11 * Math.PI * 2
    return [Math.cos(angle) * 1.35, Math.sin(angle) * 1.35, angle] as const
  }), [])
  return (
    <group position={ring.position as [number, number, number]}>
      <pointLight color="#b085ff" intensity={ring.discovered ? 12 : 4} distance={7} />
      {mushrooms.map(([x, z, angle], index) => (
        <group key={index} position={[x, 0, z]} rotation={[0, -angle, 0]}>
          <mesh position={[0, 0.22, 0]}><cylinderGeometry args={[0.06, 0.1, 0.44, 7]} /><meshStandardMaterial color="#eee6d5" /></mesh>
          <mesh position={[0, 0.48, 0]}><coneGeometry args={[0.24, 0.22, 8]} /><meshStandardMaterial color={ring.discovered ? '#b06cea' : '#776a78'} emissive="#713ea5" emissiveIntensity={0.5} /></mesh>
        </group>
      ))}
    </group>
  )
}

function ConstructionRoute({ route }: { route: WizardRoute }) {
  const from = new THREE.Vector3(...route.from)
  const to = new THREE.Vector3(...route.to)
  const midpoint = from.clone().lerp(to, 0.5)
  const length = from.distanceTo(to)
  const yaw = Math.atan2(to.x - from.x, to.z - from.z)
  return (
    <group>
      {[route.from, route.to].map((position, index) => (
        <mesh key={index} position={[position[0], position[1] + 0.45, position[2]]} castShadow>
          <cylinderGeometry args={[0.12, 0.18, 0.9, 6]} />
          <meshStandardMaterial color={route.built ? '#77502f' : '#8a755d'} />
        </mesh>
      ))}
      <group position={[midpoint.x, midpoint.y + 0.25, midpoint.z]} rotation={[0, yaw, 0]}>
        {route.built ? Array.from({ length: 7 }, (_, index) => (
          <mesh key={index} position={[0, 0, -length / 2 + length * index / 6]} castShadow>
            <boxGeometry args={[1.35, 0.16, 0.46]} />
            <meshStandardMaterial color="#8a5f36" roughness={0.9} />
          </mesh>
        )) : <>
          <mesh position={[-0.55, 0, 0]}><boxGeometry args={[0.12, 0.12, length]} /><meshStandardMaterial color="#74624e" /></mesh>
          <mesh position={[0.55, 0, 0]}><boxGeometry args={[0.12, 0.12, length]} /><meshStandardMaterial color="#74624e" /></mesh>
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
  return (
    <Canvas shadows={{ type: THREE.PCFShadowMap }} dpr={[1, 1.5]} camera={{ fov: 68, near: 0.08, far: 180 }}>
      <color attach="background" args={['#82b8c4']} />
      <fog attach="fog" args={['#91bdc0', 36, 125]} />
      <ambientLight intensity={1.15} color="#b8d7f0" />
      <directionalLight position={[18, 30, 12]} intensity={3.2} color="#fff1c4" castShadow />
      <hemisphereLight args={['#a9ddff', '#355321', 1.2]} />
      <PresentationPoseDriver player={projection.player} pose={pose} />
      <CameraRig pose={pose} cameraOrbit={cameraOrbit} orbiting={orbiting} />
      {projection.terrain.map((cell) => (
        <mesh key={cell.id} position={[cell.position[0], cell.position[1] - cell.height / 2, cell.position[2]]} receiveShadow>
          <boxGeometry args={[cell.size[0], cell.height, cell.size[1]]} />
          <meshStandardMaterial color={cell.color ?? '#56824b'} roughness={0.96} />
        </mesh>
      ))}
      {projection.resources.map((node) => <Resource key={node.id} node={node} />)}
      {projection.stores.map((store) => <Store key={store.id} store={store} />)}
      {projection.fairyRings.map((ring) => <FairyRing key={ring.id} ring={ring} />)}
      {projection.routes.map((route) => <ConstructionRoute key={route.id} route={route} />)}
      <WizardAvatar pose={pose} />
    </Canvas>
  )
}
