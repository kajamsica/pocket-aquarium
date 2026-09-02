import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

function WaterSurface({ boosted }: { boosted: boolean }) {
  const surface = useRef<THREE.Mesh>(null)
  const geometry = useMemo(() => new THREE.PlaneGeometry(5.75, 2.55, 32, 18), [])

  useFrame(({ clock }) => {
    const positions = geometry.attributes.position as THREE.BufferAttribute
    const elapsed = clock.getElapsedTime()

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index)
      const y = positions.getY(index)
      const ripple = Math.sin(x * 2.1 + elapsed * 1.25) * 0.025
      const crossRipple = Math.cos(y * 3.4 - elapsed * 0.85) * 0.015
      positions.setZ(index, ripple + crossRipple)
    }

    positions.needsUpdate = true
    geometry.computeVertexNormals()
    if (surface.current) surface.current.rotation.z = Math.sin(elapsed * 0.2) * 0.004
  })

  return (
    <mesh ref={surface} geometry={geometry} rotation-x={-Math.PI / 2} position={[0, 1.52, 0]}>
      <meshPhysicalMaterial
        color={boosted ? '#27c9ff' : '#3bb7c7'}
        transparent
        opacity={0.42}
        roughness={0.12}
        metalness={0}
        transmission={0.35}
        thickness={0.18}
        ior={1.333}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function TankScene({ boosted }: { boosted: boolean }) {
  const caustic = useRef<THREE.PointLight>(null)

  useFrame(({ clock }) => {
    if (!caustic.current) return
    const elapsed = clock.getElapsedTime()
    caustic.current.position.x = Math.sin(elapsed * 0.7) * 2.2
    caustic.current.position.z = Math.cos(elapsed * 0.55) * 0.8
  })

  return (
    <>
      <color attach="background" args={[boosted ? '#020817' : '#06151d']} />
      <fog attach="fog" args={[boosted ? '#06122e' : '#0a2730', 7, 16]} />
      <ambientLight intensity={boosted ? 0.26 : 0.48} color="#7ebbc0" />
      <spotLight
        castShadow
        color={boosted ? '#578cff' : '#fff1ca'}
        intensity={boosted ? 135 : 92}
        angle={0.62}
        penumbra={0.65}
        position={[0, 6, 1]}
      />
      <pointLight
        ref={caustic}
        color={boosted ? '#19a6ff' : '#44f1d2'}
        intensity={boosted ? 34 : 21}
        distance={5.5}
        position={[0, -0.9, 0]}
      />

      <group position={[0, -0.2, 0]}>
        <mesh position={[0, 0.08, 0]} receiveShadow>
          <boxGeometry args={[5.8, 3.15, 2.6]} />
          <meshPhysicalMaterial
            color={boosted ? '#09668f' : '#0d7c82'}
            transparent
            opacity={0.18}
            roughness={0.16}
            transmission={0.2}
            thickness={1.1}
            ior={1.333}
            side={THREE.BackSide}
          />
        </mesh>

        <mesh position={[0, -1.36, 0]} receiveShadow>
          <boxGeometry args={[5.72, 0.26, 2.52]} />
          <meshStandardMaterial color="#b7a27a" roughness={0.94} />
        </mesh>

        <mesh position={[-1.25, -0.9, 0.15]} castShadow receiveShadow rotation={[0.2, 0.1, -0.15]}>
          <icosahedronGeometry args={[0.86, 2]} />
          <meshStandardMaterial color="#5b554f" roughness={0.92} />
        </mesh>
        <mesh position={[0.05, -0.98, -0.18]} castShadow receiveShadow rotation={[-0.1, 0.4, 0.25]}>
          <icosahedronGeometry args={[0.72, 2]} />
          <meshStandardMaterial color="#665d55" roughness={0.9} />
        </mesh>
        <mesh position={[1.35, -1.02, 0.2]} castShadow receiveShadow>
          <icosahedronGeometry args={[0.58, 2]} />
          <meshStandardMaterial color="#554f49" roughness={0.94} />
        </mesh>

        <group position={[1.35, -0.35, 0.16]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.08, 0.13, 0.78, 10]} />
            <meshStandardMaterial color={boosted ? '#8c5bd8' : '#b96f91'} roughness={0.58} />
          </mesh>
          <mesh position={[0, 0.43, 0]} castShadow>
            <sphereGeometry args={[0.28, 18, 12]} />
            <meshStandardMaterial color={boosted ? '#b96cff' : '#e58f9e'} roughness={0.48} />
          </mesh>
        </group>

        <WaterSurface boosted={boosted} />

        <mesh position={[0, 0.08, 0]}>
          <boxGeometry args={[6.05, 3.46, 2.9]} />
          <meshPhysicalMaterial
            color="#b9edff"
            transparent
            opacity={0.13}
            roughness={0.06}
            metalness={0}
            transmission={0.88}
            thickness={0.12}
            ior={1.49}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      <mesh position={[0, -1.99, 0]} receiveShadow>
        <boxGeometry args={[6.8, 0.25, 3.5]} />
        <meshStandardMaterial color="#0b1113" roughness={0.65} />
      </mesh>
    </>
  )
}

export default function App() {
  const [actinicBoost, setActinicBoost] = useState(false)

  return (
    <main className="reef-app">
      <div className="canvas-shell" aria-label="Interactive three-dimensional marine reef aquarium">
        <Canvas
          camera={{ position: [0, 1.05, 8.3], fov: 42, near: 0.1, far: 80 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          shadows="basic"
          fallback={<div className="webgl-fallback">WebGL is required to render the aquarium.</div>}
        >
          <TankScene boosted={actinicBoost} />
        </Canvas>
      </div>

      <header className="title-card">
        <p className="eyebrow">Marine reef laboratory</p>
        <h1>Reef Room</h1>
        <p>A physically grounded, real-time aquarium approximation.</p>
      </header>

      <section className="control-card" aria-label="Aquarium lighting controls">
        <div>
          <span className="status-dot" data-boosted={actinicBoost} />
          <p className="control-label">Optical profile</p>
          <strong>{actinicBoost ? 'Actinic fluorescence' : 'Balanced daylight'}</strong>
        </div>
        <button
          type="button"
          aria-pressed={actinicBoost}
          onClick={() => setActinicBoost((current) => !current)}
        >
          {actinicBoost ? 'Restore daylight' : 'Engage actinic'}
        </button>
      </section>

      <aside className="reading-card" aria-label="Aquarium snapshot">
        <span>Preview system</span>
        <dl>
          <div><dt>Water</dt><dd>246 L</dd></div>
          <div><dt>Salinity</dt><dd>35.0 ppt</dd></div>
          <div><dt>Interface</dt><dd>Air · glass · seawater</dd></div>
        </dl>
      </aside>
    </main>
  )
}
