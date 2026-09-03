import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import type { ReefRenderSettings, ReefSceneProps } from '../contracts'
import {
  createFlowField,
  diagnoseFlowField,
  estimateCanonicalFlowRegime,
  sampleFlowField,
  stepFlowField,
  type FlowFieldState,
} from '../sim/flowField'
import { OpticalTank } from './OpticalTank'
import { ReefHabitat } from './ReefHabitat'
import type { SpectralTransportTelemetry } from './materials/spectralTransport'

const DEFAULT_RENDER_SETTINGS: ReefRenderSettings = {
  quality: 'balanced',
  diagnosticView: 'beauty',
}
const MAX_FLOW_STEP_SECONDS = 0.1

function CameraRig() {
  const home = useMemo(() => new THREE.Vector3(0, 0.48, 7.7), [])
  const target = useMemo(() => new THREE.Vector3(0, -0.12, 0), [])
  const desired = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ camera, pointer }, delta) => {
    desired.set(home.x + pointer.x * 0.22, home.y + pointer.y * 0.11, home.z)
    camera.position.lerp(desired, 1 - Math.exp(-delta * 2.8))
    camera.lookAt(target)
  })

  return null
}

function ExposureController({ lightPower }: { readonly lightPower: number }) {
  const { gl } = useThree()

  useEffect(() => {
    gl.toneMappingExposure = THREE.MathUtils.lerp(1.06, 1.28, lightPower)
  }, [gl, lightPower])

  return null
}

function FlowVectorField({
  flowField,
  quality,
  visible,
}: {
  readonly flowField: { readonly current: FlowFieldState }
  readonly quality: ReefRenderSettings['quality']
  readonly visible: boolean
}) {
  const layout = quality === 'cinematic' ? [16, 8] : [12, 6]
  const geometry = useMemo(() => {
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute('position', new THREE.BufferAttribute(new Float32Array(layout[0] * layout[1] * 6), 3))
    return buffer
  }, [layout[0], layout[1]])

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame(() => {
    if (!visible) return
    const positions = geometry.attributes.position as THREE.BufferAttribute
    let vertex = 0
    for (let row = 0; row < layout[1]; row += 1) {
      for (let column = 0; column < layout[0]; column += 1) {
        const x = (column + 0.5) / layout[0]
        const y = (row + 0.5) / layout[1]
        const sample = sampleFlowField(flowField.current, x, y)
        const sceneX = THREE.MathUtils.lerp(-2.65, 2.65, x)
        const sceneY = THREE.MathUtils.lerp(-1.32, 1.28, y)
        positions.setXYZ(vertex, sceneX, sceneY, 1.34)
        positions.setXYZ(
          vertex + 1,
          sceneX + sample.xMetersPerSecond * 6,
          sceneY + sample.yMetersPerSecond * 6,
          1.34,
        )
        vertex += 2
      }
    }
    positions.needsUpdate = true
  })

  return (
    <lineSegments geometry={geometry} visible={visible} renderOrder={70} frustumCulled={false}>
      <lineBasicMaterial color="#64f3ff" transparent opacity={0.82} depthTest={false} depthWrite={false} />
    </lineSegments>
  )
}

function ReefWorld({
  snapshot,
  renderSettings = DEFAULT_RENDER_SETTINGS,
  onRenderTelemetry,
}: ReefSceneProps) {
  const keyLight = useRef<THREE.SpotLight>(null)
  const fillLight = useRef<THREE.PointLight>(null)
  const flowField = useRef(createFlowField({ quality: renderSettings.quality }))
  const opticsTelemetry = useRef<SpectralTransportTelemetry | undefined>(undefined)
  const lastTelemetryEmit = useRef(0)
  const lightPower = THREE.MathUtils.clamp(snapshot.equipment.lightPower, 0, 1)
  const daylight = useMemo(() => new THREE.Color(), [])
  const updateOpticsTelemetry = useCallback((telemetry: SpectralTransportTelemetry) => {
    opticsTelemetry.current = telemetry
  }, [])

  useEffect(() => {
    flowField.current = createFlowField({ quality: renderSettings.quality })
  }, [renderSettings.quality])

  useFrame(({ clock }, delta) => {
    const elapsed = clock.getElapsedTime()
    flowField.current = stepFlowField(
      flowField.current,
      Math.min(delta, MAX_FLOW_STEP_SECONDS),
      snapshot.equipment.flowPower,
    )
    const optics = opticsTelemetry.current
    if (optics && elapsed - lastTelemetryEmit.current >= 0.25) {
      lastTelemetryEmit.current = elapsed
      const flow = diagnoseFlowField(flowField.current)
      const canonicalFlow = estimateCanonicalFlowRegime(snapshot.equipment.flowPower)
      onRenderTelemetry?.({
        optics,
        flow: {
          columns: flow.columns,
          rows: flow.rows,
          meanSpeedMetersPerSecond: canonicalFlow.meanSpeedMetersPerSecond,
          peakSpeedMetersPerSecond: canonicalFlow.peakSpeedMetersPerSecond,
          meanShearPerSecond: canonicalFlow.meanShearPerSecond,
          lowFlowFraction: canonicalFlow.lowFlowFraction,
          maximumDivergence: flow.maximumDivergence,
          pressureResidual: flow.pressureResidual,
        },
      })
    }
    daylight.setRGB(
      THREE.MathUtils.lerp(0.2, 0.64, lightPower),
      THREE.MathUtils.lerp(0.38, 0.82, lightPower),
      1,
    )

    if (keyLight.current) {
      keyLight.current.color.copy(daylight)
      keyLight.current.intensity = 70 + lightPower * 150
      keyLight.current.position.x = Math.sin(elapsed * 0.09) * 0.16
    }
    if (fillLight.current) {
      fillLight.current.intensity = 12 + lightPower * 18
    }
  })

  return (
    <>
      <color attach="background" args={['#01080d']} />
      <fogExp2 attach="fog" args={['#061923', 0.055]} />
      <hemisphereLight args={['#8bd5f2', '#0d1c24', 0.6]} />
      <directionalLight color="#8fbfd0" intensity={0.42} position={[1.8, 2.5, 5]} />
      <spotLight
        ref={keyLight}
        castShadow
        color="#83cfff"
        intensity={70 + lightPower * 150}
        angle={0.58}
        penumbra={0.72}
        decay={2}
        distance={14}
        position={[0, 5.8, 1.4]}
        shadow-bias={-0.0004}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight
        ref={fillLight}
        color="#3dd9d0"
        intensity={12 + lightPower * 18}
        decay={2}
        distance={7}
        position={[-3.4, 0.6, 3.2]}
      />

      <mesh position={[0, 0.08, -1.78]} receiveShadow>
        <planeGeometry args={[12, 7]} />
        <meshStandardMaterial color="#06141a" roughness={0.88} metalness={0.08} />
      </mesh>
      <mesh position={[0, -1.86, 0]} receiveShadow>
        <boxGeometry args={[6.7, 0.34, 3.35]} />
        <meshStandardMaterial color="#071014" roughness={0.74} metalness={0.22} />
      </mesh>

      <group position={[0, 0.03, 0]}>
        <ReefHabitat snapshot={snapshot} flowField={flowField} />
        <OpticalTank
          snapshot={snapshot}
          renderSettings={renderSettings}
          onOpticsTelemetry={updateOpticsTelemetry}
        />
        <FlowVectorField
          flowField={flowField}
          quality={renderSettings.quality}
          visible={renderSettings.diagnosticView === 'flow'}
        />
      </group>
      <ExposureController lightPower={lightPower} />
      <CameraRig />
    </>
  )
}

export function ReefScene({
  snapshot,
  renderSettings = DEFAULT_RENDER_SETTINGS,
  onRenderTelemetry,
}: ReefSceneProps) {
  return (
    <div className="canvas-shell" aria-label="Interactive three-dimensional marine reef aquarium">
      <Canvas
        camera={{ position: [0, 0.48, 7.7], fov: 43, near: 0.1, far: 60 }}
        dpr={[1, renderSettings.quality === 'cinematic' ? 2 : 1.5]}
        gl={{
          alpha: false,
          antialias: true,
          outputColorSpace: THREE.SRGBColorSpace,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
        }}
        shadows="basic"
        fallback={
          <div className="webgl-fallback" role="alert">
            This aquarium needs WebGL to render. Enable hardware acceleration and reload Reef Room.
          </div>
        }
      >
        <ReefWorld
          snapshot={snapshot}
          renderSettings={renderSettings}
          onRenderTelemetry={onRenderTelemetry}
        />
      </Canvas>
    </div>
  )
}
