import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import type { WizardFairyRing, WizardResourceNode, WizardStore, WizardViewProjection } from './contracts'

function CameraRig({ player }: { player: WizardViewProjection['player'] }) {
  useFrame(({ camera }) => {
    camera.position.set(...player.position)
    camera.rotation.order = 'YXZ'
    camera.rotation.set(player.pitch, player.yaw, 0)
  })
  return null
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

export function WizardScene({ projection }: { projection: WizardViewProjection }) {
  return (
    <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 68, near: 0.08, far: 180 }}>
      <color attach="background" args={['#82b8c4']} />
      <fog attach="fog" args={['#91bdc0', 36, 125]} />
      <ambientLight intensity={1.15} color="#b8d7f0" />
      <directionalLight position={[18, 30, 12]} intensity={3.2} color="#fff1c4" castShadow />
      <hemisphereLight args={['#a9ddff', '#355321', 1.2]} />
      <CameraRig player={projection.player} />
      {projection.terrain.map((cell) => (
        <mesh key={cell.id} position={[cell.position[0], cell.position[1] - cell.height / 2, cell.position[2]]} receiveShadow>
          <boxGeometry args={[cell.size[0], cell.height, cell.size[1]]} />
          <meshStandardMaterial color={cell.color ?? '#56824b'} roughness={0.96} />
        </mesh>
      ))}
      {projection.resources.map((node) => <Resource key={node.id} node={node} />)}
      {projection.stores.map((store) => <Store key={store.id} store={store} />)}
      {projection.fairyRings.map((ring) => <FairyRing key={ring.id} ring={ring} />)}
    </Canvas>
  )
}
