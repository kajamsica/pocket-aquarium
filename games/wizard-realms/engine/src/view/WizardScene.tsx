import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { WizardFairyRing, WizardResourceNode, WizardRoute, WizardStore, WizardViewProjection } from './contracts'

function CameraRig({ player, cameraOrbit, orbiting }: {
  player: WizardViewProjection['player']
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
    const heading = player.yaw + orbitYaw.current
    const distance = 6.4
    const horizontal = Math.cos(orbitPitch.current) * distance
    target.set(player.position[0], player.position[1] + 1.35, player.position[2])
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

function WizardAvatar({ player }: { player: WizardViewProjection['player'] }) {
  return (
    <group position={player.position as [number, number, number]} rotation={[0, player.yaw, 0]} aria-label="Player wizard">
      <mesh position={[0, 0.92, 0]} castShadow><coneGeometry args={[0.52, 1.65, 7]} /><meshStandardMaterial color="#513477" roughness={0.82} /></mesh>
      <mesh position={[0, 1.78, 0]} castShadow><sphereGeometry args={[0.34, 10, 8]} /><meshStandardMaterial color="#c9946c" roughness={0.9} /></mesh>
      <mesh position={[0, 2.18, 0]} castShadow><coneGeometry args={[0.48, 1.05, 8]} /><meshStandardMaterial color="#34234f" roughness={0.78} /></mesh>
      <mesh position={[0, 1.98, 0]} castShadow><cylinderGeometry args={[0.56, 0.56, 0.08, 10]} /><meshStandardMaterial color="#34234f" /></mesh>
      <mesh position={[0, 1.78, -0.31]} castShadow><coneGeometry args={[0.08, 0.2, 6]} /><meshStandardMaterial color="#bd805d" /></mesh>
      <mesh position={[0.48, 1.08, 0]} rotation={[0.05, 0, 0.12]} castShadow><cylinderGeometry args={[0.035, 0.05, 2.45, 7]} /><meshStandardMaterial color="#6d472c" /></mesh>
      <pointLight position={[0.5, 2.28, 0]} color="#bd82ff" intensity={2.2} distance={3.5} />
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
  return (
    <Canvas shadows={{ type: THREE.PCFShadowMap }} dpr={[1, 1.5]} camera={{ fov: 68, near: 0.08, far: 180 }}>
      <color attach="background" args={['#82b8c4']} />
      <fog attach="fog" args={['#91bdc0', 36, 125]} />
      <ambientLight intensity={1.15} color="#b8d7f0" />
      <directionalLight position={[18, 30, 12]} intensity={3.2} color="#fff1c4" castShadow />
      <hemisphereLight args={['#a9ddff', '#355321', 1.2]} />
      <CameraRig player={projection.player} cameraOrbit={cameraOrbit} orbiting={orbiting} />
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
      <WizardAvatar player={projection.player} />
    </Canvas>
  )
}
