import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import { specimenAssetFor } from '../scene/specimens/assetRegistry'
import {
  WorkbenchSpecimen,
  type WorkbenchAssetStats,
  type WorkbenchClipName,
} from './WorkbenchSpecimen'

type CameraPreset = 'side' | 'front' | 'top' | 'three-quarter'
type Projection = 'perspective' | 'orthographic'

const CAMERA_POSITIONS: Readonly<Record<CameraPreset, THREE.Vector3Tuple>> = {
  side: [0, 0.012, 0.19],
  front: [0.19, 0.012, 0],
  top: [0, 0.2, 0.001],
  'three-quarter': [0.135, 0.09, 0.145],
}
const PLAYBACK_RATES = [0.25, 0.5, 1, 2] as const
const asset = specimenAssetFor('ocellaris')
let assetByteLengthPromise: Promise<number> | undefined

interface AssetBoundaryProps {
  readonly onError: (message: string) => void
  readonly children: React.ReactNode
}

interface AssetBoundaryState {
  readonly failed: boolean
}

class AssetBoundary extends Component<AssetBoundaryProps, AssetBoundaryState> {
  state: AssetBoundaryState = { failed: false }

  static getDerivedStateFromError(): AssetBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error instanceof Error ? error.message : 'The specimen asset could not be loaded.')
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

function CameraControls({ preset, projection, resetToken }: {
  readonly preset: CameraPreset
  readonly projection: Projection
  readonly resetToken: number
}) {
  const { gl, set, size } = useThree()
  const camera = useMemo(() => projection === 'perspective'
    ? new THREE.PerspectiveCamera(34, 1, 0.005, 5)
    : new THREE.OrthographicCamera(-0.08, 0.08, 0.08, -0.08, 0.005, 5), [projection])
  const controlsRef = useRef<OrbitControls | null>(null)

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement)
    controlsRef.current = controls
    const aspect = Math.max(size.width / Math.max(size.height, 1), 0.1)
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = aspect
    } else {
      const verticalSpan = 0.14
      camera.left = -verticalSpan * aspect / 2
      camera.right = verticalSpan * aspect / 2
      camera.top = verticalSpan / 2
      camera.bottom = -verticalSpan / 2
    }
    camera.updateProjectionMatrix()
    camera.position.set(...CAMERA_POSITIONS[preset])
    camera.lookAt(0, 0, 0)
    controls.target.set(0, 0, 0)
    controls.minDistance = 0.06
    controls.maxDistance = 0.75
    controls.minZoom = 0.5
    controls.maxZoom = 7
    controls.enableDamping = true
    controls.dampingFactor = 0.075
    controls.enablePan = true
    controls.update()
    set({ camera })
    return () => {
      controls.dispose()
      if (controlsRef.current === controls) controlsRef.current = null
    }
  }, [camera, gl.domElement, preset, projection, resetToken, set, size.height, size.width])

  useFrame(() => controlsRef.current?.update())
  return null
}

function StudioRuler() {
  return (
    <group position={[0, -0.041, 0.006]}>
      <mesh receiveShadow>
        <boxGeometry args={[0.08, 0.0006, 0.0006]} />
        <meshStandardMaterial color="#68727a" roughness={0.7} />
      </mesh>
      {[-0.04, -0.02, 0, 0.02, 0.04].map((x) => (
        <mesh key={x} position={[x, 0.002, 0]}>
          <boxGeometry args={[0.0006, 0.0045, 0.0006]} />
          <meshStandardMaterial color="#68727a" roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
}

function StudioFloor({ visible }: { readonly visible: boolean }) {
  if (!visible) return null
  return (
    <mesh position={[0, -0.047, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[1.2, 1.2]} />
      <shadowMaterial color="#283039" opacity={0.19} transparent />
    </mesh>
  )
}

function formatBytes(bytes?: number) {
  if (bytes === undefined) return 'Loading…'
  return `${bytes.toLocaleString()} B (${(bytes / 1024).toFixed(1)} KiB)`
}

export function SpecimenWorkbench() {
  const [clipName, setClipName] = useState<WorkbenchClipName>('swim')
  const [playing, setPlaying] = useState(true)
  const [playbackRate, setPlaybackRate] = useState<number>(1)
  const [phase, setPhase] = useState(0)
  const [wireframe, setWireframe] = useState(false)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [showFloor, setShowFloor] = useState(true)
  const [turntable, setTurntable] = useState(false)
  const [projection, setProjection] = useState<Projection>('perspective')
  const [preset, setPreset] = useState<CameraPreset>('three-quarter')
  const [resetToken, setResetToken] = useState(0)
  const [stats, setStats] = useState<WorkbenchAssetStats>()
  const [assetBytes, setAssetBytes] = useState<number>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const handleReady = useCallback((nextStats: WorkbenchAssetStats) => {
    setStats(nextStats)
    setLoading(false)
  }, [])
  const handleError = useCallback((message?: string) => setError(message), [])
  const handlePhase = useCallback((nextPhase: number) => {
    setPhase((current) => Math.abs(current - nextPhase) > 0.015 ? nextPhase : current)
  }, [])

  const reset = useCallback(() => {
    setClipName('swim')
    setPlaying(true)
    setPlaybackRate(1)
    setPhase(0)
    setWireframe(false)
    setShowSkeleton(false)
    setShowFloor(true)
    setTurntable(false)
    setProjection('perspective')
    setPreset('three-quarter')
    setResetToken((value) => value + 1)
    setError(undefined)
  }, [])

  useEffect(() => {
    if (!asset) return
    let active = true
    assetByteLengthPromise ??= fetch(asset.url, { method: 'HEAD' })
      .then((response) => {
        if (!response.ok) throw new Error(`Asset request failed with HTTP ${response.status}.`)
        const length = Number(response.headers.get('content-length'))
        if (!Number.isFinite(length) || length <= 0) throw new Error('The server did not report the GLB byte length.')
        return length
      })
    assetByteLengthPromise
      .then((length) => {
        if (active) setAssetBytes(length)
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'The GLB request failed.')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return
      if (event.code === 'Space') {
        event.preventDefault()
        setPlaying((value) => !value)
      } else if (event.key.toLowerCase() === 'r') reset()
      else if (event.key.toLowerCase() === 'w') setWireframe((value) => !value)
      else if (event.key.toLowerCase() === 'k') setShowSkeleton((value) => !value)
      else if (event.key === '1') setPreset('side')
      else if (event.key === '2') setPreset('front')
      else if (event.key === '3') setPreset('top')
      else if (event.key === '4') setPreset('three-quarter')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [reset])

  if (!asset) {
    return <main className="specimen-workbench specimen-workbench--fatal" role="alert">Ocellaris asset registry entry is missing.</main>
  }

  return (
    <main className="specimen-workbench">
      <title>Ocellaris Specimen Workbench</title>
      <header className="workbench-header">
        <div>
          <p className="workbench-eyebrow">Isolated 3D specimen workbench</p>
          <h1>Ocellaris clownfish <span>LOD1</span></h1>
        </div>
        <div className="workbench-status" data-ready={!loading && !error}>
          <span aria-hidden="true" />
          {error ? 'Inspection blocked' : loading ? 'Loading GLB' : 'Accepted asset loaded'}
        </div>
      </header>

      <section className="workbench-stage" aria-label="Interactive 3D specimen viewer">
        <Canvas
          shadows="basic"
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: false }}
          fallback={<div className="workbench-webgl-error" role="alert">WebGL is unavailable. This workbench requires hardware-accelerated 3D rendering.</div>}
        >
          <color attach="background" args={['#d7d8d6']} />
          <ambientLight intensity={0.55} />
          <hemisphereLight args={['#f4f8fb', '#737b82', 1.25]} />
          <directionalLight
            castShadow={showFloor}
            position={[0.12, 0.18, 0.13]}
            intensity={3.3}
            shadow-mapSize={[1024, 1024]}
            shadow-camera-near={0.02}
            shadow-camera-far={1}
          />
          <spotLight position={[-0.12, 0.08, 0.16]} intensity={3.1} angle={0.65} penumbra={0.8} />
          <pointLight position={[-0.14, 0.1, -0.16]} color="#b5d7ff" intensity={1.2} />
          <CameraControls preset={preset} projection={projection} resetToken={resetToken} />
          <StudioFloor visible={showFloor} />
          <StudioRuler />
          <AssetBoundary onError={handleError}>
            <Suspense fallback={null}>
              <WorkbenchSpecimen
                asset={asset}
                clipName={clipName}
                playing={playing}
                playbackRate={playbackRate}
                phase={phase}
                wireframe={wireframe}
                showSkeleton={showSkeleton}
                castShadow={showFloor}
                turntable={turntable}
                onReady={handleReady}
                onMissingClip={handleError}
                onPhase={handlePhase}
              />
            </Suspense>
          </AssetBoundary>
        </Canvas>

        {loading && !error && <div className="workbench-loading" role="status">Loading rigged specimen…</div>}
        {error && <div className="workbench-error" role="alert"><strong>Workbench error</strong><span>{error}</span></div>}
        <div className="workbench-ruler-label">0 <i /> 8.0 cm adult reference</div>
        <div className="workbench-orbit-hint">Drag to orbit · wheel to zoom · right-drag to pan</div>
      </section>

      <aside className="workbench-controls" aria-label="Specimen controls">
        <fieldset>
          <legend>Camera</legend>
          <div className="workbench-grid workbench-grid--camera">
            {(['side', 'front', 'top', 'three-quarter'] as const).map((view) => (
              <button key={view} type="button" aria-pressed={preset === view} onClick={() => setPreset(view)}>
                {view === 'three-quarter' ? '3/4' : view}
              </button>
            ))}
          </div>
          <div className="workbench-grid workbench-grid--two">
            <button type="button" aria-pressed={turntable} onClick={() => setTurntable((value) => !value)}>Turntable</button>
            <button type="button" onClick={() => setProjection((value) => value === 'perspective' ? 'orthographic' : 'perspective')}>
              {projection === 'perspective' ? 'Perspective' : 'Orthographic'}
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Animation</legend>
          <label className="workbench-select-label" htmlFor="workbench-clip">Clip</label>
          <select id="workbench-clip" value={clipName} onChange={(event) => { setClipName(event.target.value as WorkbenchClipName); setPhase(0) }}>
            {asset.clips.map((clip) => <option key={clip} value={clip}>{clip}</option>)}
          </select>
          <div className="workbench-grid workbench-grid--speeds" aria-label="Playback speed">
            {PLAYBACK_RATES.map((rate) => (
              <button key={rate} type="button" aria-pressed={playbackRate === rate} onClick={() => setPlaybackRate(rate)}>{rate}×</button>
            ))}
          </div>
          <button className="workbench-play" type="button" aria-pressed={playing} onClick={() => setPlaying((value) => !value)}>
            {playing ? 'Pause animation' : 'Play animation'}
          </button>
          <label className="workbench-scrub" htmlFor="workbench-phase">
            <span>Phase {(phase * 100).toFixed(0)}%</span>
            <input id="workbench-phase" type="range" min="0" max="1" step="0.01" value={phase} disabled={playing} onChange={(event) => setPhase(Number(event.target.value))} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Inspection</legend>
          <div className="workbench-grid workbench-grid--two">
            <button type="button" aria-pressed={wireframe} onClick={() => setWireframe((value) => !value)}>Wireframe</button>
            <button type="button" aria-pressed={showSkeleton} onClick={() => setShowSkeleton((value) => !value)}>Skeleton</button>
            <button type="button" aria-pressed={showFloor} onClick={() => setShowFloor((value) => !value)}>Floor shadow</button>
            <button type="button" onClick={reset}>Reset</button>
          </div>
        </fieldset>
        <p className="workbench-shortcuts">Keys: space play/pause, 1–4 views, W wireframe, K skeleton, R reset.</p>
      </aside>

      <section className="workbench-stats" aria-label="Asset statistics">
        <div className="workbench-stats-heading">
          <div><span>Species</span><strong>{asset.speciesId}</strong></div>
          <div><span>Asset version</span><strong>{asset.assetVersion}</strong></div>
          <div><span>Adult length</span><strong>{(asset.referenceAdultLengthMeters * 100).toFixed(1)} cm</strong></div>
          <div><span>GLB</span><strong>{formatBytes(assetBytes)}</strong></div>
        </div>
        <dl>
          <div><dt>Triangles</dt><dd>{stats?.triangles.toLocaleString() ?? '…'}</dd></div>
          <div><dt>Scene nodes</dt><dd>{stats?.nodes.toLocaleString() ?? '…'}</dd></div>
          <div><dt>Bones</dt><dd>{stats?.bones.toLocaleString() ?? '…'}</dd></div>
          <div><dt>Materials</dt><dd>{stats?.materials.toLocaleString() ?? '…'}</dd></div>
        </dl>
        <div className="workbench-clips">
          <span>Animation clips</span>
          {stats?.clips.map((clip) => <code key={clip.name}>{clip.name} {clip.duration.toFixed(2)}s</code>) ?? <code>Loading…</code>}
        </div>
      </section>
    </main>
  )
}
