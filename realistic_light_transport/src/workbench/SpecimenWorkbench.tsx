import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import {
  WorkbenchSpecimen,
  type WorkbenchAssetStats,
  type WorkbenchClipName,
} from './WorkbenchSpecimen'
import {
  clipLoops,
  loadWorkbenchCatalog,
  selectWorkbenchAsset,
  workbenchSearch,
  type WorkbenchAsset,
  type WorkbenchCatalog,
} from './workbenchCatalog'

type CameraPreset = 'side' | 'front' | 'top' | 'three-quarter'
type Projection = 'perspective' | 'orthographic'

// Framing was authored for the 8 cm Ocellaris; every distance scales with the specimen's reference size.
const REFERENCE_FRAME_METERS = 0.08
const CAMERA_POSITIONS: Readonly<Record<CameraPreset, THREE.Vector3Tuple>> = {
  side: [0, 0.012, 0.19],
  front: [0.19, 0.012, 0],
  top: [0, 0.2, 0.001],
  'three-quarter': [0.135, 0.09, 0.145],
}
const PLAYBACK_RATES = [0.25, 0.5, 1, 2] as const
const SEARCH = new URLSearchParams(window.location.search)

interface AssetBoundaryProps {
  readonly onError: (message: string) => void
  readonly resetKey: string
  readonly children: React.ReactNode
}

interface AssetBoundaryState {
  readonly failed: boolean
  readonly resetKey: string
}

class AssetBoundary extends Component<AssetBoundaryProps, AssetBoundaryState> {
  state: AssetBoundaryState = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<AssetBoundaryState> {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: AssetBoundaryProps, state: AssetBoundaryState): Partial<AssetBoundaryState> | null {
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error instanceof Error ? error.message : 'The specimen asset could not be loaded.')
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

function CameraControls({ preset, projection, resetToken, scale }: {
  readonly preset: CameraPreset
  readonly projection: Projection
  readonly resetToken: number
  readonly scale: number
}) {
  const { gl, set, size } = useThree()
  const camera = useMemo(() => projection === 'perspective'
    ? new THREE.PerspectiveCamera(34, 1, 0.005 * scale, 5 * Math.max(scale, 1))
    : new THREE.OrthographicCamera(-0.08 * scale, 0.08 * scale, 0.08 * scale, -0.08 * scale, 0.005 * scale, 5 * Math.max(scale, 1)), [projection, scale])
  const controlsRef = useRef<OrbitControls | null>(null)

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement)
    controlsRef.current = controls
    const aspect = Math.max(size.width / Math.max(size.height, 1), 0.1)
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = aspect
    } else {
      const verticalSpan = 0.14 * scale
      camera.left = -verticalSpan * aspect / 2
      camera.right = verticalSpan * aspect / 2
      camera.top = verticalSpan / 2
      camera.bottom = -verticalSpan / 2
    }
    camera.updateProjectionMatrix()
    const [x, y, z] = CAMERA_POSITIONS[preset]
    camera.position.set(x * scale, y * scale, z * scale)
    camera.lookAt(0, 0, 0)
    controls.target.set(0, 0, 0)
    controls.minDistance = 0.06 * scale
    controls.maxDistance = 0.75 * scale
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
  }, [camera, gl.domElement, preset, projection, resetToken, scale, set, size.height, size.width])

  useFrame(() => controlsRef.current?.update())
  return null
}

function StudioRuler({ lengthMeters, floorY }: { readonly lengthMeters: number; readonly floorY: number }) {
  const tick = lengthMeters * 0.0075
  const bar = lengthMeters * 0.0075
  return (
    <group position={[0, floorY + tick * 1.2, lengthMeters * 0.075]}>
      <mesh receiveShadow>
        <boxGeometry args={[lengthMeters, bar, bar]} />
        <meshStandardMaterial color="#68727a" roughness={0.7} />
      </mesh>
      {[-0.5, -0.25, 0, 0.25, 0.5].map((fraction) => (
        <mesh key={fraction} position={[fraction * lengthMeters, tick * 3.3, 0]}>
          <boxGeometry args={[bar, tick * 7.5, bar]} />
          <meshStandardMaterial color="#68727a" roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
}

function StudioFloor({ visible, floorY, scale }: { readonly visible: boolean; readonly floorY: number; readonly scale: number }) {
  if (!visible) return null
  return (
    <mesh position={[0, floorY, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[1.2 * scale, 1.2 * scale]} />
      <shadowMaterial color="#283039" opacity={0.19} transparent />
    </mesh>
  )
}

function formatBytes(bytes?: number) {
  if (bytes === undefined) return 'Loading…'
  return `${bytes.toLocaleString()} B (${(bytes / 1024).toFixed(1)} KiB)`
}

function formatSize(meters: number) {
  return meters >= 1 ? `${meters.toFixed(2)} m` : `${(meters * 100).toFixed(1)} cm`
}

function defaultClip(asset: WorkbenchAsset): WorkbenchClipName {
  return asset.clipRoles?.locomotion ?? (asset.clips.includes('swim') ? 'swim' : asset.clips[0] ?? 'swim')
}

function assetLabel(asset: WorkbenchAsset) {
  return asset.state === 'accepted'
    ? `${asset.displayName} (accepted v${asset.assetVersion})`
    : `${asset.displayName} (${asset.candidate}, ${asset.buildStatus === 'passed' ? 'validated' : asset.buildStatus ?? 'unvalidated'})`
}

export function SpecimenWorkbench() {
  const [catalog, setCatalog] = useState<WorkbenchCatalog>()
  const [selectionKey, setSelectionKey] = useState<string>()
  const [invalidSelection, setInvalidSelection] = useState<string>()
  const [clipName, setClipName] = useState<WorkbenchClipName>('swim')
  const [playing, setPlaying] = useState(true)
  const [playbackRate, setPlaybackRate] = useState<number>(1)
  const [phase, setPhase] = useState(0)
  const [wireframe, setWireframe] = useState(false)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [showFloor, setShowFloor] = useState(true)
  const [showRenders, setShowRenders] = useState(true)
  const [turntable, setTurntable] = useState(false)
  const [projection, setProjection] = useState<Projection>('perspective')
  const [preset, setPreset] = useState<CameraPreset>('three-quarter')
  const [resetToken, setResetToken] = useState(0)
  const [stats, setStats] = useState<WorkbenchAssetStats>()
  const [assetBytes, setAssetBytes] = useState<number>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    loadWorkbenchCatalog().then((loaded) => {
      if (!active) return
      const { asset, invalid } = selectWorkbenchAsset(loaded.assets, SEARCH.get('workbench'), SEARCH.get('candidate'))
      setCatalog(loaded)
      setInvalidSelection(invalid)
      if (asset) {
        setSelectionKey(asset.key)
        setClipName(defaultClip(asset))
      }
    })
    return () => {
      active = false
    }
  }, [])

  const asset = useMemo(() => catalog?.assets.find((entry) => entry.key === selectionKey), [catalog, selectionKey])
  const scale = (asset?.referenceSizeMeters ?? REFERENCE_FRAME_METERS) / REFERENCE_FRAME_METERS
  const floorY = stats ? stats.bounds.center[1] - stats.bounds.size[1] / 2 - 0.006 * scale : -0.047 * scale

  const selectAsset = useCallback((next: WorkbenchAsset) => {
    setSelectionKey(next.key)
    setInvalidSelection(undefined)
    setClipName(defaultClip(next))
    setPhase(0)
    setStats(undefined)
    setAssetBytes(undefined)
    setLoading(true)
    setError(undefined)
    window.history.replaceState(null, '', workbenchSearch(next))
  }, [])

  const handleReady = useCallback((nextStats: WorkbenchAssetStats) => {
    setStats(nextStats)
    setLoading(false)
  }, [])
  const handleError = useCallback((message?: string) => setError(message), [])
  const handlePhase = useCallback((nextPhase: number) => {
    setPhase((current) => Math.abs(current - nextPhase) > 0.015 ? nextPhase : current)
  }, [])

  const reset = useCallback(() => {
    if (asset) setClipName(defaultClip(asset))
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
  }, [asset])

  useEffect(() => {
    if (!asset) return
    let active = true
    fetch(asset.url, { method: 'HEAD' })
      .then((response) => {
        if (!response.ok) throw new Error(`Asset request failed with HTTP ${response.status}.`)
        const length = Number(response.headers.get('content-length'))
        if (!Number.isFinite(length) || length <= 0) throw new Error('The server did not report the GLB byte length.')
        return length
      })
      .then((length) => {
        if (active) setAssetBytes(length)
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'The GLB request failed.')
      })
    return () => {
      active = false
    }
  }, [asset])

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

  if (catalog && !asset) {
    return <main className="specimen-workbench specimen-workbench--fatal" role="alert">Ocellaris asset registry entry is missing.</main>
  }
  if (!catalog || !asset) {
    return <main className="specimen-workbench specimen-workbench--fatal" role="status">Loading specimen catalog…</main>
  }

  const accepted = catalog.assets.filter((entry) => entry.state === 'accepted')
  const candidateSpecies = [...new Set(catalog.assets.filter((entry) => entry.state === 'candidate').map((entry) => entry.speciesId))]
  const clips = asset.clips.length ? asset.clips : stats?.clips.map((clip) => clip.name) ?? []
  const statusLabel = error
    ? 'Inspection blocked'
    : loading
      ? 'Loading GLB'
      : asset.state === 'accepted'
        ? 'Accepted asset loaded'
        : `Candidate loaded: ${asset.candidateState ?? 'awaiting_user_acceptance'}`

  return (
    <main className="specimen-workbench" data-asset-state={asset.state}>
      <title>{`${asset.displayName} Specimen Workbench`}</title>
      <header className="workbench-header">
        <div>
          <p className="workbench-eyebrow">Isolated 3D specimen workbench</p>
          <h1>{asset.displayName} <span>{asset.scientificName ?? asset.speciesId} · LOD1</span></h1>
        </div>
        <label className="workbench-picker" htmlFor="workbench-species">
          <span>Specimen</span>
          <select
            id="workbench-species"
            value={asset.key}
            onChange={(event) => {
              const next = catalog.assets.find((entry) => entry.key === event.target.value)
              if (next) selectAsset(next)
            }}
          >
            <optgroup label="Accepted (runtime)">
              {accepted.map((entry) => <option key={entry.key} value={entry.key}>{assetLabel(entry)}</option>)}
            </optgroup>
            {candidateSpecies.map((speciesId) => (
              <optgroup key={speciesId} label={`Candidate · ${speciesId}`}>
                {catalog.assets.filter((entry) => entry.state === 'candidate' && entry.speciesId === speciesId).map((entry) => (
                  <option key={entry.key} value={entry.key}>{assetLabel(entry)}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="workbench-status" data-ready={!loading && !error} data-candidate={asset.state === 'candidate'}>
          <span aria-hidden="true" />
          {statusLabel}
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
            position={[0.12 * scale, 0.18 * scale, 0.13 * scale]}
            intensity={3.3}
            shadow-mapSize={[1024, 1024]}
            shadow-camera-near={0.02 * scale}
            shadow-camera-far={1 * Math.max(scale, 1)}
            shadow-camera-left={-0.12 * scale}
            shadow-camera-right={0.12 * scale}
            shadow-camera-top={0.12 * scale}
            shadow-camera-bottom={-0.12 * scale}
          />
          <spotLight position={[-0.12 * scale, 0.08 * scale, 0.16 * scale]} intensity={3.1 * scale * scale} angle={0.65} penumbra={0.8} />
          <pointLight position={[-0.14 * scale, 0.1 * scale, -0.16 * scale]} color="#b5d7ff" intensity={1.2 * scale * scale} />
          <CameraControls preset={preset} projection={projection} resetToken={resetToken} scale={scale} />
          <StudioFloor visible={showFloor} floorY={floorY} scale={scale} />
          <StudioRuler lengthMeters={asset.referenceSizeMeters} floorY={floorY} />
          <AssetBoundary onError={handleError} resetKey={asset.key}>
            <Suspense fallback={null}>
              <WorkbenchSpecimen
                key={asset.key}
                asset={asset}
                clipName={clipName}
                loop={clipLoops(asset, clipName)}
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
        {invalidSelection && (
          <div className="workbench-error workbench-error--notice" role="alert">
            <strong>Unknown specimen “{invalidSelection}”</strong>
            <span>Fell back to the accepted Ocellaris. Pick a catalog entry from the Specimen menu.</span>
          </div>
        )}
        <div className="workbench-ruler-label">0 <i /> {formatSize(asset.referenceSizeMeters)} {asset.referenceSizeKind.replaceAll('_', ' ')}</div>
        <div className="workbench-orbit-hint">Drag to orbit · wheel to zoom · right-drag to pan · framing scales with the specimen</div>
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
          <select id="workbench-clip" value={clipName} onChange={(event) => { setClipName(event.target.value); setPhase(0) }}>
            {clips.map((clip) => {
              const role = asset.clipRoles ? (Object.entries(asset.clipRoles).find(([, name]) => name === clip)?.[0]) : undefined
              return <option key={clip} value={clip}>{role ? `${clip} (${role})` : clip}</option>
            })}
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
          {asset.state === 'candidate' && (
            <button type="button" aria-pressed={showRenders} onClick={() => setShowRenders((value) => !value)}>
              {showRenders ? 'Hide Blender review renders' : 'Show Blender review renders'}
            </button>
          )}
        </fieldset>
        <p className="workbench-shortcuts">Keys: space play/pause, 1–4 views, W wireframe, K skeleton, R reset.</p>
      </aside>

      <section className="workbench-stats" aria-label="Asset statistics">
        <div className="workbench-stats-heading">
          <div><span>Species</span><strong>{asset.speciesId}{asset.candidate ? ` / ${asset.candidate}` : ''}</strong></div>
          <div><span>{asset.state === 'accepted' ? 'Asset version' : 'Candidate state'}</span><strong>{asset.state === 'accepted' ? asset.assetVersion : asset.candidateState ?? 'awaiting_user_acceptance'}</strong></div>
          <div><span>Reference size</span><strong>{formatSize(asset.referenceSizeMeters)}</strong></div>
          <div><span>GLB</span><strong>{formatBytes(assetBytes)}</strong></div>
          {asset.state === 'candidate' && (
            <>
              <div><span>Validator</span><strong>{asset.validatorStatus ?? 'pending'}{asset.buildFailedStage ? ` (failed ${asset.buildFailedStage})` : ''}</strong></div>
              <div><span>Reference grade</span><strong>{asset.referenceGrade ?? '?'} · {asset.bodyPlan ?? 'plan ?'}</strong></div>
            </>
          )}
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
          {catalog.candidateSource === 'unavailable' && <code>candidate catalog unavailable (dev server only)</code>}
        </div>
      </section>

      {asset.state === 'candidate' && showRenders && (asset.authorPreviewUrl || asset.threeViewUrl) && (
        <section className="workbench-renders" aria-label="Blender review renders">
          {asset.authorPreviewUrl && <a href={asset.authorPreviewUrl} target="_blank" rel="noreferrer"><img src={asset.authorPreviewUrl} alt={`${asset.displayName} author preview render`} /></a>}
          {asset.threeViewUrl && <a href={asset.threeViewUrl} target="_blank" rel="noreferrer"><img src={asset.threeViewUrl} alt={`${asset.displayName} side, top and front render`} /></a>}
        </section>
      )}
    </main>
  )
}
