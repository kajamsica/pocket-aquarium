import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import type { ReefRenderSettings, ReefSceneProps } from '../contracts'
import type { PocketCoralView } from '../integration/pocketAquariumBridge'
import {
  createFlowField,
  diagnoseFlowField,
  estimateCanonicalFlowRegime,
  sampleFlowField,
  stepFlowField,
  type FlowFieldState,
} from '../sim/flowField'
import { OpticalTank } from './OpticalTank'
import type { CoralPlacementCandidate } from './CoralPlacement'
import { ReefHabitat } from './ReefHabitat'
import type { SpectralTransportTelemetry } from './materials/spectralTransport'
import { endTankDrag, noteTankDrag, noteTankPointerDown, noteTankPointerUp } from './tankGestures'

const DEFAULT_RENDER_SETTINGS: ReefRenderSettings = {
  quality: 'balanced',
  diagnosticView: 'beauty',
  brightness: 1,
}
const MAX_FLOW_STEP_SECONDS = 0.1

export function cameraDistanceForAspect(aspect: number) {
  if (aspect < .72) return 8.55
  if (aspect > 1.5) return 6.95
  return 7.7
}

/** Orbit look target and framing constants. Radius comes from the aspect/zoom distance so
 *  the default yaw/pitch reproduces the prior head-on framing (0, 0.48, ~7.7). */
export const ORBIT_TARGET = { x: 0, y: -0.12, z: 0 } as const
export const ORBIT_DEFAULT_PITCH = 0.0778
export const ORBIT_MIN_PITCH = -0.15
export const ORBIT_MAX_PITCH = 1.05
/** UI-to-scene reset signal. The View panel dispatches this so its button reaches the same
 *  `resetView` closure double-click uses, with no second reset path or shared camera state. */
export const REEF_CAMERA_RESET_EVENT = 'pocket-aquarium:reset-camera'
const ORBIT_YAW_PER_PX = 0.006
const ORBIT_PITCH_PER_PX = 0.005
const ORBIT_DRAG_THRESHOLD_PX = 6
const ORBIT_YAW_PER_KEY = 0.12
const ORBIT_PITCH_PER_KEY = 0.08
/** Amplify pinch so a single gesture crosses more of the zoom range; bounded by clamp. */
const PINCH_ZOOM_EXPONENT = 4.5
/** Wheel/trackpad scene units per deltaY unit; one notch (~100) moves a fifth of the range. */
const WHEEL_ZOOM_PER_DELTA = 0.02
/** Near bound sits inside the front glass (habitat half-depth 1.18) so the camera enters the
 *  water volume, and stays far enough from the orbit target to clear the 0.1 near plane. */
const MIN_CAMERA_DISTANCE = 0.95
const MAX_CAMERA_DISTANCE = 10.2
/** Exponential convergence rate toward the requested orbit position: prompt, still smoothed. */
const CAMERA_CONVERGENCE = 6.5

export const clampOrbitPitch = (pitch: number) =>
  THREE.MathUtils.clamp(pitch, ORBIT_MIN_PITCH, ORBIT_MAX_PITCH)

/** Pure orbit placement: spherical yaw/pitch around the tank at a bounded radius. A full
 *  2π yaw returns to the same point, so horizontal drag revolves through 360 degrees. */
export function orbitCameraPosition(
  out: THREE.Vector3,
  radius: number,
  yaw: number,
  pitch: number,
  target: { x: number; y: number; z: number } = ORBIT_TARGET,
) {
  const cosPitch = Math.cos(pitch)
  return out.set(
    target.x + radius * cosPitch * Math.sin(yaw),
    target.y + radius * Math.sin(pitch),
    target.z + radius * cosPitch * Math.cos(yaw),
  )
}

function CameraRig({ disabled = false }: { readonly disabled?: boolean }) {
  const { gl, size } = useThree()
  const target = useMemo(() => new THREE.Vector3(ORBIT_TARGET.x, ORBIT_TARGET.y, ORBIT_TARGET.z), [])
  const desired = useMemo(() => new THREE.Vector3(), [])
  const cameraDistance = useRef<number | null>(null)
  const yaw = useRef(0)
  const pitch = useRef(ORBIT_DEFAULT_PITCH)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; cameraDistance: number } | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null)

  useEffect(() => {
    if (disabled) {
      touches.current.clear()
      pinch.current = null
      drag.current = null
      return
    }
    const element = gl.domElement
    const pointerDown = (event: PointerEvent) => {
      noteTankPointerDown(event.pointerId, event.pointerType)
      if (event.pointerType === 'touch') {
        touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (touches.current.size === 2) {
          drag.current = null
          const [a, b] = [...touches.current.values()]
          pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), cameraDistance: cameraDistance.current ?? 7.7 }
          return
        }
      }
      // Single pointer (mouse/pen or one finger) is an orbit candidate until it feeds/selects.
      if (!pinch.current) drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: event.clientX, oy: event.clientY, moved: false }
    }
    const pointerMove = (event: PointerEvent) => {
      if (touches.current.has(event.pointerId)) {
        touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      }
      if (touches.current.size === 2 && pinch.current) {
        const [a, b] = [...touches.current.values()]
        const distance = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 20)
        cameraDistance.current = THREE.MathUtils.clamp(
          pinch.current.cameraDistance * (pinch.current.distance / distance) ** PINCH_ZOOM_EXPONENT,
          MIN_CAMERA_DISTANCE,
          MAX_CAMERA_DISTANCE,
        )
        event.preventDefault()
        return
      }
      const active = drag.current
      if (!active || active.id !== event.pointerId) return
      const dx = event.clientX - active.x
      const dy = event.clientY - active.y
      active.x = event.clientX
      active.y = event.clientY
      yaw.current -= dx * ORBIT_YAW_PER_PX
      // Vertical drag reversed per player expectation; horizontal direction unchanged.
      pitch.current = clampOrbitPitch(pitch.current + dy * ORBIT_PITCH_PER_PX)
      // Cumulative travel from the press origin, so a slow drag still cancels the tap/feed.
      if (!active.moved && Math.hypot(event.clientX - active.ox, event.clientY - active.oy) > ORBIT_DRAG_THRESHOLD_PX) {
        active.moved = true
      }
      if (active.moved) {
        noteTankDrag()
        event.preventDefault()
      }
    }
    const pointerUp = (event: PointerEvent) => {
      noteTankPointerUp(event.pointerId, event.pointerType)
      if (drag.current?.id === event.pointerId) {
        if (drag.current.moved) endTankDrag()
        drag.current = null
      }
      touches.current.delete(event.pointerId)
      if (touches.current.size < 2) pinch.current = null
    }
    const wheel = (event: WheelEvent) => {
      const base = cameraDistance.current ?? cameraDistanceForAspect(size.width / Math.max(size.height, 1))
      cameraDistance.current = THREE.MathUtils.clamp(
        base + event.deltaY * WHEEL_ZOOM_PER_DELTA,
        MIN_CAMERA_DISTANCE,
        MAX_CAMERA_DISTANCE,
      )
      event.preventDefault()
    }
    const resetView = () => {
      yaw.current = 0
      pitch.current = ORBIT_DEFAULT_PITCH
      cameraDistance.current = null
    }
    const keydown = (event: KeyboardEvent) => {
      const node = event.target as HTMLElement | null
      const tag = node?.tagName
      // Never steal keystrokes destined for form controls or editable content.
      if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || node?.isContentEditable) return
      switch (event.key) {
        case 'ArrowLeft': yaw.current += ORBIT_YAW_PER_KEY; break
        case 'ArrowRight': yaw.current -= ORBIT_YAW_PER_KEY; break
        case 'ArrowUp': pitch.current = clampOrbitPitch(pitch.current - ORBIT_PITCH_PER_KEY); break
        case 'ArrowDown': pitch.current = clampOrbitPitch(pitch.current + ORBIT_PITCH_PER_KEY); break
        default: return
      }
      event.preventDefault()
    }
    element.addEventListener('pointerdown', pointerDown, { capture: true })
    element.addEventListener('pointermove', pointerMove, { capture: true })
    element.addEventListener('pointerup', pointerUp, { capture: true })
    element.addEventListener('pointercancel', pointerUp, { capture: true })
    element.addEventListener('wheel', wheel, { passive: false })
    element.addEventListener('dblclick', resetView)
    window.addEventListener(REEF_CAMERA_RESET_EVENT, resetView)
    window.addEventListener('keydown', keydown)
    return () => {
      element.removeEventListener('pointerdown', pointerDown, { capture: true })
      element.removeEventListener('pointermove', pointerMove, { capture: true })
      element.removeEventListener('pointerup', pointerUp, { capture: true })
      element.removeEventListener('pointercancel', pointerUp, { capture: true })
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('dblclick', resetView)
      window.removeEventListener(REEF_CAMERA_RESET_EVENT, resetView)
      window.removeEventListener('keydown', keydown)
    }
  }, [disabled, gl, size.height, size.width])

  useFrame(({ camera }, delta) => {
    const radius = cameraDistance.current ?? cameraDistanceForAspect(size.width / Math.max(size.height, 1))
    orbitCameraPosition(desired, radius, yaw.current, pitch.current, target)
    camera.position.lerp(desired, 1 - Math.exp(-delta * CAMERA_CONVERGENCE))
    camera.lookAt(target)
  })

  return null
}

function ExposureController({ lightPower, brightness }: { readonly lightPower: number; readonly brightness: number }) {
  const { gl } = useThree()

  useEffect(() => {
    gl.toneMappingExposure = THREE.MathUtils.lerp(1.06, 1.28, lightPower) * THREE.MathUtils.clamp(brightness, .7, 1.45)
  }, [brightness, gl, lightPower])

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

interface ReefPlacementSceneProps {
  readonly placedCorals: readonly PocketCoralView[]
  readonly activeCoral?: PocketCoralView
  readonly previewCandidate: CoralPlacementCandidate | null
  readonly onPlacementCandidate: (candidate: CoralPlacementCandidate | null) => void
}

type ReefWorldProps = ReefSceneProps & ReefPlacementSceneProps

function ReefWorld({
  snapshot,
  renderSettings = DEFAULT_RENDER_SETTINGS,
  onRenderTelemetry,
  placedCorals,
  activeCoral,
  previewCandidate,
  onPlacementCandidate,
}: ReefWorldProps) {
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
        <ReefHabitat snapshot={snapshot} flowField={flowField} placedCorals={placedCorals}
          activeCoral={activeCoral} previewCandidate={previewCandidate}
          onPlacementCandidate={onPlacementCandidate} />
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
      <ExposureController lightPower={lightPower} brightness={renderSettings.brightness} />
      <CameraRig disabled={Boolean(activeCoral)} />
    </>
  )
}

export function ReefScene({
  snapshot,
  renderSettings = DEFAULT_RENDER_SETTINGS,
  onRenderTelemetry,
  placedCorals,
  activeCoral,
  previewCandidate,
  onPlacementCandidate,
}: ReefWorldProps) {
  const [hintDismissed, setHintDismissed] = useState(false)
  return (
    <div className="canvas-shell" aria-label="Interactive three-dimensional marine reef aquarium">
      {!hintDismissed ? <button type="button" className="tank-orbit-hint" onClick={() => setHintDismissed(true)}
        aria-label="Dismiss camera hint">Drag to orbit · Pinch/wheel to zoom · Arrow keys ×</button> : null}
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
        onPointerMissed={() => { if (activeCoral) onPlacementCandidate(null) }}
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
          placedCorals={placedCorals}
          activeCoral={activeCoral}
          previewCandidate={previewCandidate}
          onPlacementCandidate={onPlacementCandidate}
        />
      </Canvas>
    </div>
  )
}
