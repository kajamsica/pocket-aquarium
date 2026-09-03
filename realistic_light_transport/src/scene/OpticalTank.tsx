import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ReefRenderSettings, ReefSceneProps } from '../contracts'
import {
  OPTICAL_IOR,
  causticFragmentShader,
  causticVertexShader,
  waterSurfaceFragmentShader,
  waterSurfaceVertexShader,
  waterVolumeFragmentShader,
  waterVolumeVertexShader,
} from './materials/opticalShaders'
import { estimateSpectralTransport, type SpectralTransportTelemetry } from './materials/spectralTransport'

const TANK_WIDTH = 5.8
const INTERIOR_HEIGHT = 3.1
const TANK_DEPTH = 2.6
const SAND_FLOOR_Y = -1.56
const PANEL_THICKNESS = 0.055

export interface OpticalTankProps extends ReefSceneProps {
  readonly onOpticsTelemetry?: (telemetry: SpectralTransportTelemetry) => void
}

const DEFAULT_RENDER_SETTINGS: ReefRenderSettings = {
  quality: 'balanced',
  diagnosticView: 'beauty',
  brightness: 1,
}

const renderTargetSize = (
  width: number,
  height: number,
  pixelRatio: number,
  quality: ReefRenderSettings['quality'],
) => {
  const desiredScale = quality === 'cinematic'
    ? THREE.MathUtils.clamp(pixelRatio, 1, 1.5) : Math.min(pixelRatio, 0.65)
  const maximumDimension = quality === 'cinematic' ? 1536 : 960
  const requestedWidth = Math.max(1, width * desiredScale)
  const requestedHeight = Math.max(1, height * desiredScale)
  const cap = Math.min(1, maximumDimension / Math.max(requestedWidth, requestedHeight))
  const targetWidth = Math.max(32, Math.floor(requestedWidth * cap))
  return {
    width: targetWidth,
    height: Math.max(32, Math.floor(requestedHeight * cap)),
    scale: targetWidth / Math.max(width, 1),
  }
}

type PanelProps = {
  readonly args: readonly [number, number, number]
  readonly position: readonly [number, number, number]
  readonly renderOrder: number
}

function AcrylicPanel({ args, position, renderOrder }: PanelProps) {
  return (
    <mesh position={position} renderOrder={renderOrder}>
      <boxGeometry args={args} />
      <meshPhysicalMaterial
        color="#bcecff"
        transparent
        opacity={0.28}
        transmission={0.72}
        thickness={PANEL_THICKNESS}
        ior={OPTICAL_IOR.acrylic}
        roughness={0.075}
        metalness={0}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

export function OpticalTank({
  snapshot,
  renderSettings = DEFAULT_RENDER_SETTINGS,
  onOpticsTelemetry,
}: OpticalTankProps) {
  const { camera, gl, scene, size } = useThree()
  const opticalGroup = useRef<THREE.Group>(null)
  const volumeMaterial = useRef<THREE.ShaderMaterial>(null)
  const surfaceMaterial = useRef<THREE.ShaderMaterial>(null)
  const causticMaterial = useRef<THREE.ShaderMaterial>(null)
  const causticLight = useRef<THREE.PointLight>(null)
  const captureActive = useRef(false)
  const drawingBufferSize = useMemo(() => new THREE.Vector2(1, 1), [])
  const habitatTarget = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: true, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter,
      stencilBuffer: false, type: THREE.UnsignedByteType,
    })
    target.texture.generateMipmaps = false
    target.texture.name = 'reef-habitat-optical-sample'
    return target
  }, [])
  const targetSize = renderTargetSize(
    size.width, size.height, gl.getPixelRatio(), renderSettings.quality,
  )

  const levelRatio = THREE.MathUtils.clamp(
    snapshot.tank.waterLevelMeters / Math.max(snapshot.tank.heightMeters, 0.001),
    0.04,
    1,
  )
  const waterHeight = INTERIOR_HEIGHT * levelRatio
  const waterSurfaceY = SAND_FLOOR_Y + waterHeight
  const waterCenterY = SAND_FLOOR_Y + waterHeight * 0.5
  const lightEnergy = THREE.MathUtils.clamp(snapshot.equipment.lightPower, 0, 1)
  const interfaceTransmission = THREE.MathUtils.clamp(
    snapshot.lightField.interfaceTransmission,
    0,
    1,
  )
  const attenuation = Math.max(snapshot.lightField.attenuationPerMeter, 0.01)
  const flowPower = THREE.MathUtils.clamp(snapshot.equipment.flowPower, 0, 1)

  const volumeUniforms = useMemo(
    () => ({
      uWaterHeight: { value: waterHeight },
      uAttenuation: { value: attenuation },
      uInterfaceTransmission: { value: interfaceTransmission },
      uLightPower: { value: lightEnergy },
      uDiagnosticView: { value: 0 },
    }),
    [],
  )
  const surfaceUniforms = useMemo(
    () => ({
      uSceneTexture: { value: habitatTarget.texture },
      uSceneReady: { value: 0 },
      uDiagnosticView: { value: 0 },
      uTime: { value: 0 },
      uFlowPower: { value: flowPower },
      uLightPower: { value: lightEnergy },
      uInterfaceTransmission: { value: interfaceTransmission },
      uAttenuation: { value: attenuation },
      uViewport: { value: new THREE.Vector2(1, 1) },
    }),
    [],
  )
  const causticUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uFlowPower: { value: flowPower },
      uLightPower: { value: lightEnergy },
      uInterfaceTransmission: { value: interfaceTransmission },
    }),
    [],
  )
  const edgeGeometry = useMemo(
    () => {
      const tankGeometry = new THREE.BoxGeometry(
        TANK_WIDTH + PANEL_THICKNESS * 2,
        INTERIOR_HEIGHT + PANEL_THICKNESS * 2,
        TANK_DEPTH + PANEL_THICKNESS * 2,
      )
      const edges = new THREE.EdgesGeometry(tankGeometry)
      tankGeometry.dispose()
      return edges
    },
    [],
  )

  useEffect(() => {
    habitatTarget.setSize(targetSize.width, targetSize.height)
    if (surfaceMaterial.current) surfaceMaterial.current.uniforms.uSceneReady.value = 0
  }, [habitatTarget, targetSize.height, targetSize.width])

  useEffect(() => {
    onOpticsTelemetry?.(estimateSpectralTransport(
      snapshot.lightField.sampleDepthMeters, attenuation, interfaceTransmission,
      targetSize.scale, targetSize.width,
    ))
  }, [
    attenuation, interfaceTransmission, onOpticsTelemetry,
    snapshot.lightField.sampleDepthMeters, targetSize.scale, targetSize.width,
  ])

  useEffect(() => () => {
    habitatTarget.dispose()
    edgeGeometry.dispose()
  }, [edgeGeometry, habitatTarget])

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime()
    if (volumeMaterial.current) {
      volumeMaterial.current.uniforms.uWaterHeight.value = waterHeight
      volumeMaterial.current.uniforms.uAttenuation.value = attenuation
      volumeMaterial.current.uniforms.uInterfaceTransmission.value = interfaceTransmission
      volumeMaterial.current.uniforms.uLightPower.value = lightEnergy
      volumeMaterial.current.uniforms.uDiagnosticView.value =
        renderSettings.diagnosticView === 'spectral' ? 1 : 0
    }
    if (surfaceMaterial.current) {
      surfaceMaterial.current.uniforms.uTime.value = elapsed
      surfaceMaterial.current.uniforms.uFlowPower.value = flowPower
      surfaceMaterial.current.uniforms.uLightPower.value = lightEnergy
      surfaceMaterial.current.uniforms.uInterfaceTransmission.value = interfaceTransmission
      surfaceMaterial.current.uniforms.uAttenuation.value = attenuation
      surfaceMaterial.current.uniforms.uDiagnosticView.value =
        renderSettings.diagnosticView === 'spectral' ? 1 : 0
      gl.getDrawingBufferSize(drawingBufferSize)
      surfaceMaterial.current.uniforms.uViewport.value.copy(drawingBufferSize)
    }
    if (causticMaterial.current) {
      causticMaterial.current.uniforms.uTime.value = elapsed
      causticMaterial.current.uniforms.uFlowPower.value = flowPower
      causticMaterial.current.uniforms.uLightPower.value = lightEnergy
      causticMaterial.current.uniforms.uInterfaceTransmission.value = interfaceTransmission
    }
    if (causticLight.current) {
      const drift = elapsed * (0.28 + flowPower * 0.72)
      causticLight.current.position.x = Math.sin(drift) * 1.75
      causticLight.current.position.z = Math.cos(drift * 0.83) * 0.72
      causticLight.current.intensity = (7 + lightEnergy * 28) * interfaceTransmission
    }

    const group = opticalGroup.current
    if (!group || captureActive.current) return

    const previousTarget = gl.getRenderTarget()
    const previousVisibility = group.visible
    captureActive.current = true
    group.visible = false
    try {
      gl.setRenderTarget(habitatTarget)
      gl.clear(true, true, true)
      gl.render(scene, camera)
      if (surfaceMaterial.current) surfaceMaterial.current.uniforms.uSceneReady.value = 1
    } finally {
      gl.setRenderTarget(previousTarget)
      group.visible = previousVisibility
      captureActive.current = false
    }
  })

  const shaftOpacity = (0.025 + 0.075 * lightEnergy) * interfaceTransmission

  return (
    <group ref={opticalGroup} name="optical-tank">
      {/* A moving local light lets the procedural caustic cue reach rock-facing materials. */}
      <pointLight
        ref={causticLight}
        color="#45bfff"
        intensity={(7 + lightEnergy * 28) * interfaceTransmission}
        distance={4.6}
        decay={2}
        position={[0, -0.82, 0]}
      />

      <mesh position={[0, waterCenterY, 0]} renderOrder={4}>
        <boxGeometry args={[TANK_WIDTH - 0.04, waterHeight, TANK_DEPTH - 0.04]} />
        <shaderMaterial
          ref={volumeMaterial}
          uniforms={volumeUniforms}
          vertexShader={waterVolumeVertexShader}
          fragmentShader={waterVolumeFragmentShader}
          transparent
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>

      <group position={[0, waterCenterY, 0]} renderOrder={7}>
        {[-1.55, 0, 1.55].map((x, index) => (
          <mesh
            key={x}
            position={[x, 0, index === 1 ? -0.3 : 0.25]}
            rotation-z={(index - 1) * 0.1}
            scale={[1, waterHeight, 1]}
            renderOrder={7}
          >
            <cylinderGeometry args={[0.055, 0.34, 1, 14, 1, true]} />
            <meshBasicMaterial
              color={index === 1 ? '#7ecbff' : '#4a9eff'}
              transparent
              opacity={shaftOpacity}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </group>

      <mesh
        position={[0, SAND_FLOOR_Y + 0.018, 0]}
        rotation-x={-Math.PI / 2}
        renderOrder={9}
      >
        <planeGeometry args={[TANK_WIDTH - 0.08, TANK_DEPTH - 0.08, 1, 1]} />
        <shaderMaterial
          ref={causticMaterial}
          uniforms={causticUniforms}
          vertexShader={causticVertexShader}
          fragmentShader={causticFragmentShader}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          polygonOffset
          polygonOffsetFactor={-1}
        />
      </mesh>

      <mesh
        position={[0, waterSurfaceY, 0]}
        rotation-x={-Math.PI / 2}
        renderOrder={30}
      >
        <planeGeometry args={[TANK_WIDTH - 0.035, TANK_DEPTH - 0.035, 56, 28]} />
        <shaderMaterial
          ref={surfaceMaterial}
          uniforms={surfaceUniforms}
          vertexShader={waterSurfaceVertexShader}
          fragmentShader={waterSurfaceFragmentShader}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Acrylic is approximated as flat parallel interfaces around the water medium. */}
      <AcrylicPanel
        args={[TANK_WIDTH + PANEL_THICKNESS, INTERIOR_HEIGHT, PANEL_THICKNESS]}
        position={[0, -0.01, TANK_DEPTH * 0.5 + PANEL_THICKNESS * 0.5]}
        renderOrder={40}
      />
      <AcrylicPanel
        args={[TANK_WIDTH + PANEL_THICKNESS, INTERIOR_HEIGHT, PANEL_THICKNESS]}
        position={[0, -0.01, -TANK_DEPTH * 0.5 - PANEL_THICKNESS * 0.5]}
        renderOrder={39}
      />
      <AcrylicPanel
        args={[PANEL_THICKNESS, INTERIOR_HEIGHT, TANK_DEPTH]}
        position={[-TANK_WIDTH * 0.5 - PANEL_THICKNESS * 0.5, -0.01, 0]}
        renderOrder={41}
      />
      <AcrylicPanel
        args={[PANEL_THICKNESS, INTERIOR_HEIGHT, TANK_DEPTH]}
        position={[TANK_WIDTH * 0.5 + PANEL_THICKNESS * 0.5, -0.01, 0]}
        renderOrder={41}
      />
      <AcrylicPanel
        args={[TANK_WIDTH + PANEL_THICKNESS, PANEL_THICKNESS, TANK_DEPTH]}
        position={[0, SAND_FLOOR_Y - PANEL_THICKNESS * 0.5, 0]}
        renderOrder={38}
      />

      <lineSegments geometry={edgeGeometry} position={[0, -0.01, 0]} renderOrder={55}>
        <lineBasicMaterial color="#9de7ff" transparent opacity={0.28} depthWrite={false} />
      </lineSegments>
    </group>
  )
}
