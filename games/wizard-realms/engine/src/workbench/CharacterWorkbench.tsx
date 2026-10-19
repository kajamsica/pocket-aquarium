import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CharacterModel, type CharacterStats } from './CharacterModel'
import { CHARACTER_CANDIDATES, CHARACTER_CLIPS, selectCharacterCandidate, type CharacterClip } from './characterCatalog'
import './characterWorkbench.css'

type CameraView = 'front' | 'side' | 'back' | 'top' | 'three-quarter'
const CAMERA_VIEWS: readonly CameraView[] = ['front', 'side', 'back', 'top', 'three-quarter']
const CAMERA_DIRECTIONS: Readonly<Record<CameraView, THREE.Vector3Tuple>> = {
  // The exported glTF faces -Z, so its front camera sits in front of -Z.
  front: [0, 0.08, -1],
  side: [1, 0.08, 0],
  back: [0, 0.08, 1],
  top: [0, 1, 0.001],
  'three-quarter': [0.7, 0.28, -0.7],
}
const PLAYBACK_RATES = [0.25, 0.5, 1, 2] as const
const REFERENCE_PANELS: Partial<Record<CameraView, number>> = {
  front: 0,
  'three-quarter': 1,
  side: 2,
  back: 3,
}
const FIXED_COMPARISON_CENTER: THREE.Vector3Tuple = [0, 1.13, 0]
const FIXED_COMPARISON_SIZE: THREE.Vector3Tuple = [1.3, 2.5, 1.3]
const RULER_POSITIONS: Readonly<Partial<Record<CameraView, THREE.Vector3Tuple>>> = {
  front: [0.9, 0, 0],
  side: [0, 0, 0.9],
  back: [-0.9, 0, 0],
  'three-quarter': [0.7, 0, 0.7],
}
const V2_VIEW_COMPARISONS: Readonly<Record<CameraView, string>> = {
  front: 'NO-GO: separate facial pieces and cylindrical sleeves lack the approved V9 face and shoulder shape.',
  'three-quarter': 'NO-GO: intersecting cowl, torso, and robe shells lose the continuous cloth volume and folds of V9.',
  side: 'NO-GO: the face profile, flat hair mass, and boot shape do not match the approved V9 silhouette.',
  back: 'NO-GO: exposed rear scalp and plain robe surface lack the layered hair and cloth construction of V9.',
  top: 'No approved V9 top view exists. Inspect geometry here without inferring top-view art approval.',
}

interface AssetBoundaryProps {
  readonly resetKey: string
  readonly onError: (message: string) => void
  readonly children: ReactNode
}

class AssetBoundary extends Component<AssetBoundaryProps, { failed: boolean; resetKey: string }> {
  state = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError() { return { failed: true } }

  static getDerivedStateFromProps(props: AssetBoundaryProps, state: { resetKey: string }) {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey }
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error instanceof Error ? error.message : 'The 3D character asset could not be loaded.')
  }

  render() { return this.state.failed ? null : this.props.children }
}

function CameraControls({ view, fitToken, bounds, comparisonLocked }: {
  readonly view: CameraView
  readonly fitToken: number
  readonly bounds?: CharacterStats['bounds']
  readonly comparisonLocked: boolean
}) {
  const { camera, gl, size } = useThree()
  const controlsRef = useRef<OrbitControls | null>(null)

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement)
    controlsRef.current = controls
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = true
    controls.minDistance = 0.55
    controls.maxDistance = 22
    controls.update()
    return () => {
      controls.dispose()
      if (controlsRef.current === controls) controlsRef.current = null
    }
  }, [camera, gl.domElement])

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    controls.enabled = !comparisonLocked
    controls.enableDamping = !comparisonLocked
    const center = comparisonLocked ? FIXED_COMPARISON_CENTER : bounds?.center ?? [0, 1.1, 0]
    const frameSize = comparisonLocked ? FIXED_COMPARISON_SIZE : bounds?.size ?? [1.25, 2.25, 0.8]
    const height = Math.max(frameSize[1], 1.8)
    const width = Math.max(frameSize[0], frameSize[2])
    const aspect = Math.max(size.width / Math.max(size.height, 1), 0.3)
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 35
    const halfFov = THREE.MathUtils.degToRad(fov) / 2
    // Use the half-extent for camera fit, then leave modest room for moving sleeves and the turn clip.
    const distance = Math.max(height / (2 * Math.tan(halfFov)), width / (2 * Math.tan(halfFov) * aspect)) * 1.18
    const direction = new THREE.Vector3(...CAMERA_DIRECTIONS[view]).normalize()
    camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0)
    camera.position.set(center[0], center[1], center[2]).addScaledVector(direction, distance)
    controls.target.set(center[0], center[1], center[2])
    camera.lookAt(controls.target)
    controls.update()
  }, [bounds, camera, comparisonLocked, fitToken, size.height, size.width, view])

  useFrame(() => { if (!comparisonLocked) controlsRef.current?.update() })
  return null
}

function StudioFloor() {
  return <>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.018, 0]} receiveShadow>
      <planeGeometry args={[12, 12]} />
      <meshStandardMaterial color="#c6c5c0" roughness={1} />
    </mesh>
    <gridHelper args={[6, 12, '#91928f', '#b6b6b2']} position={[0, -0.012, 0]} />
  </>
}

function MeterRuler({ view }: { readonly view: CameraView }) {
  const position = RULER_POSITIONS[view]
  if (!position) return null
  const rotation = view === 'side' ? Math.PI / 2 : view === 'three-quarter' ? Math.PI / 4 : 0
  return <group position={position} rotation={[0, rotation, 0]}>
    <mesh position={[0, 1, 0]}><boxGeometry args={[0.018, 2, 0.018]} /><meshBasicMaterial color="#50315d" /></mesh>
    {[0, 0.5, 1, 1.5, 2].map((height) => <mesh key={height} position={[0, height, 0]}>
      <boxGeometry args={[height === 0 || height === 2 ? 0.22 : 0.14, 0.022, 0.022]} />
      <meshBasicMaterial color="#50315d" />
    </mesh>)}
  </group>
}

function formatDuration(value: number) { return `${value.toFixed(2)}s` }

export function CharacterWorkbench({ workbenchId }: { readonly workbenchId: string }) {
  const requestedCandidateId = new URLSearchParams(window.location.search).get('candidate')
  const candidate = selectCharacterCandidate(workbenchId, requestedCandidateId)
  const [clipName, setClipName] = useState<CharacterClip>('Idle')
  const [playing, setPlaying] = useState(true)
  const [playbackRate, setPlaybackRate] = useState<number>(1)
  const [phase, setPhase] = useState(0)
  const [cameraView, setCameraView] = useState<CameraView>('three-quarter')
  const [fitToken, setFitToken] = useState(0)
  const [wireframe, setWireframe] = useState(false)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [turntable, setTurntable] = useState(false)
  const [showReference, setShowReference] = useState(true)
  const [comparisonLocked, setComparisonLocked] = useState(true)
  const [stats, setStats] = useState<CharacterStats>()
  const [loadError, setLoadError] = useState<string>()
  const [clipError, setClipError] = useState<string>()
  const handleReady = useCallback((value: CharacterStats) => setStats(value), [])
  const handleLoadError = useCallback((message: string) => setLoadError(message), [])
  const handleClipError = useCallback((message?: string) => setClipError(message), [])
  const handlePhase = useCallback((value: number) => setPhase(value), [])
  const reset = useCallback(() => {
    setClipName('Idle')
    setPlaying(true)
    setPlaybackRate(1)
    setPhase(0)
    setCameraView('three-quarter')
    setFitToken((value) => value + 1)
    setWireframe(false)
    setShowSkeleton(false)
    setTurntable(false)
    setShowReference(true)
    setComparisonLocked(true)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return
      if (event.code === 'Space') { event.preventDefault(); setPlaying((value) => !value) }
      else if (event.key.toLowerCase() === 'w') setWireframe((value) => !value)
      else if (event.key.toLowerCase() === 'k') setShowSkeleton((value) => !value)
      else if (event.key.toLowerCase() === 'r') reset()
      else if (event.key >= '1' && event.key <= '5') setCameraView(CAMERA_VIEWS[Number(event.key) - 1])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [reset])

  if (!candidate) {
    return <main className="character-workbench character-workbench--missing">
      <h1>Character candidate not found</h1>
      <p>No candidate matches <code>{workbenchId}{requestedCandidateId ? ` / ${requestedCandidateId}` : ''}</code>.</p>
      <a href="?workbench=wayfarer">Open the available Wayfarer candidate</a>
    </main>
  }

  const availableClips = stats?.clips.map((clip) => clip.name) ?? []
  const missingClips = stats ? candidate.expectedClips.filter((name) => !availableClips.includes(name)) : []
  const referencePanel = REFERENCE_PANELS[cameraView]
  const approvedRender = candidate.approvedRenders[referencePanel ?? 1]
  const comparisonText = candidate.status === 'candidate_no_go'
    ? V2_VIEW_COMPARISONS[cameraView]
    : cameraView === 'top'
      ? 'No approved V9 top view exists. Inspect geometry here without inferring top-view art approval.'
      : 'Compare the GLB here with the approved V9 bust render. The bust image is a design target, not a metric full-body guide.'

  return <main className="character-workbench" data-candidate-state={candidate.status}>
    <title>Wayfarer Character Workbench | Wizard Realms</title>
    <header className="character-workbench__header">
      <div>
        <p className="character-workbench__eyebrow">Wizard Realms · Isolated 3D asset playground</p>
        <h1>{candidate.label}</h1>
      </div>
      <div className="character-workbench__header-actions">
        <a href="?publicWorld=1">Return to game</a>
        <span className="character-workbench__status" role="status">{candidate.statusLabel}</span>
      </div>
    </header>

    <p className="character-workbench__notice">{candidate.summary}</p>

    <div className="character-workbench__layout">
      <section className={`character-workbench__stage${comparisonLocked && showReference ? ' character-workbench__stage--compare' : ''}`} aria-label="Interactive 3D character viewer and approved V9 render">
        <div className="character-workbench__stage-viewer">
          <Canvas
          camera={{ fov: 35, near: 0.01, far: 100, position: [3.4, 2.2, 4.3] }}
          shadows="basic"
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: false }}
          fallback={<div className="character-workbench__error" role="alert">WebGL is unavailable. The 3D viewer needs hardware acceleration.</div>}
          >
          <color attach="background" args={['#d8d8d4']} />
          <ambientLight intensity={0.75} />
          <hemisphereLight args={['#f3f5f7', '#8b8178', 1.35]} />
          <directionalLight castShadow position={[3.5, 7, 5]} intensity={3.1} shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-normalBias={0.04} shadow-camera-left={-3} shadow-camera-right={3} shadow-camera-top={4} shadow-camera-bottom={-2} />
          <directionalLight position={[-4, 3, -4]} color="#d6c4ff" intensity={1.4} />
          <CameraControls view={cameraView} fitToken={fitToken} bounds={stats?.bounds} comparisonLocked={comparisonLocked} />
          <StudioFloor />
          {comparisonLocked && <MeterRuler view={cameraView} />}
          <AssetBoundary resetKey={candidate.id} onError={handleLoadError}>
            <Suspense fallback={null}>
              <CharacterModel
                candidate={candidate}
                clipName={clipName}
                playing={playing}
                playbackRate={playbackRate}
                phase={phase}
                wireframe={wireframe}
                showSkeleton={showSkeleton}
                turntable={turntable}
                onReady={handleReady}
                onClipError={handleClipError}
                onPhase={handlePhase}
              />
            </Suspense>
          </AssetBoundary>
          </Canvas>
          {!stats && !loadError && <div className="character-workbench__loading" role="status">Loading rigged GLB…</div>}
          {loadError && <div className="character-workbench__error" role="alert">Asset load failed: {loadError}</div>}
          {clipError && <div className="character-workbench__error character-workbench__error--clip" role="alert">{clipError}</div>}
          {comparisonLocked && <p className="character-workbench__meter-hint">2 m ruler · 0.5 m ticks · GLB height {stats ? `${stats.bounds.size[1].toFixed(2)} m` : 'loading'}</p>}
          <p className="character-workbench__orbit-hint">{comparisonLocked ? `Candidate GLB · ${cameraView} · fixed metric camera` : 'Drag to orbit · wheel to zoom · right-drag to pan'}</p>
        </div>
        {showReference && <aside className="character-workbench__stage-reference" aria-label={`Approved V9 ${approvedRender.label.toLowerCase()} bust render`}>
          <a href={approvedRender.url} target="_blank" rel="noreferrer" title="Open the approved V9 bust render">
            <img className="character-workbench__reference-sheet" src={approvedRender.url} alt={`Approved V9 Wayfarer ${approvedRender.label.toLowerCase()} bust render`} />
          </a>
          <span className="character-workbench__reference-caption">Approved V9 bust · {referencePanel === undefined ? 'three-quarter shown; no top view' : cameraView} · framing is illustrative</span>
        </aside>}
      </section>

      <aside className="character-workbench__controls" aria-label="Character workbench controls">
        <fieldset>
          <legend>Camera</legend>
          <div className="character-workbench__button-grid">
            {CAMERA_VIEWS.map((view, index) => <button key={view} type="button" aria-pressed={cameraView === view} onClick={() => setCameraView(view)}>{index + 1}. {view === 'three-quarter' ? '3/4' : view}</button>)}
          </div>
          <div className="character-workbench__button-grid character-workbench__button-grid--two">
            <button type="button" disabled={comparisonLocked} onClick={() => setFitToken((value) => value + 1)}>Fit model</button>
            <button type="button" aria-pressed={turntable} disabled={comparisonLocked} onClick={() => setTurntable((value) => !value)}>Turntable</button>
          </div>
          <button className="character-workbench__play" type="button" aria-pressed={comparisonLocked} onClick={() => { setComparisonLocked((value) => !value); setShowReference(true); setTurntable(false) }}>Fixed-scale comparison {comparisonLocked ? 'on' : 'off'}</button>
          <small>Compare each angle with the same world-space camera, fitted to a 2.5 m guide with margin. Unlock to orbit and fit freely. The approved V9 bust renders are not metric full-body guides.</small>
        </fieldset>

        <fieldset>
          <legend>Animation</legend>
          <label htmlFor="character-workbench-clip">Clip</label>
          <select id="character-workbench-clip" value={clipName} onChange={(event) => { setClipName(event.target.value as CharacterClip); setPhase(0) }}>
            {CHARACTER_CLIPS.map((name) => <option key={name} value={name} disabled={Boolean(stats && !availableClips.includes(name))}>{name}</option>)}
          </select>
          <div className="character-workbench__button-grid character-workbench__button-grid--rates" aria-label="Playback speed">
            {PLAYBACK_RATES.map((rate) => <button key={rate} type="button" aria-pressed={playbackRate === rate} onClick={() => setPlaybackRate(rate)}>{rate}×</button>)}
          </div>
          <button className="character-workbench__play" type="button" aria-pressed={playing} onClick={() => setPlaying((value) => !value)}>{playing ? 'Pause animation' : 'Play animation'}</button>
          <label className="character-workbench__scrub" htmlFor="character-workbench-phase">Phase {(phase * 100).toFixed(0)}%</label>
          <input id="character-workbench-phase" type="range" min="0" max="1" step="0.01" value={phase} disabled={playing} onChange={(event) => setPhase(Number(event.target.value))} />
          <small>Pause to scrub the rig pose. The model stays in place during Walk.</small>
        </fieldset>

        <fieldset>
          <legend>Inspection</legend>
          <div className="character-workbench__button-grid character-workbench__button-grid--two">
            <button type="button" aria-pressed={showReference} disabled={comparisonLocked} onClick={() => setShowReference((value) => !value)}>Reference</button>
            <button type="button" aria-pressed={wireframe} onClick={() => setWireframe((value) => !value)}>Wireframe</button>
            <button type="button" aria-pressed={showSkeleton} onClick={() => setShowSkeleton((value) => !value)}>Skeleton</button>
            <button type="button" onClick={reset}>Reset</button>
          </div>
        </fieldset>
        <p className="character-workbench__shortcuts">Keys: space play/pause, 1–5 views, W wireframe, K skeleton, R reset.</p>
      </aside>
    </div>

    <section className="character-workbench__details" aria-label="Candidate review and statistics">
      <div>
        <h2>Candidate inspection</h2>
        <p><strong>Status:</strong> {candidate.statusLabel}. Design approval and GLB technical verification are separate checks.</p>
        <p className="character-workbench__view-verdict"><strong>{cameraView} comparison:</strong> {comparisonText}</p>
        <ul>{candidate.reviewNotes.map((note) => <li key={note}>{note}</li>)}</ul>
        <p>{candidate.status === 'design_approved'
          ? <a href="?workbench=wayfarer&candidate=wayfarer-v2-male">Inspect rejected V2 technical comparison</a>
          : <a href="?workbench=wayfarer">Return to approved V9 design candidate</a>}</p>
        <h3>Loaded GLB</h3>
        <dl className="character-workbench__stats">
          <div><dt>Triangles</dt><dd>{stats?.triangles.toLocaleString() ?? 'Loading…'}</dd></div>
          <div><dt>Nodes</dt><dd>{stats?.nodes.toLocaleString() ?? 'Loading…'}</dd></div>
          <div><dt>Bones</dt><dd>{stats?.bones.toLocaleString() ?? 'Loading…'}</dd></div>
          <div><dt>Materials</dt><dd>{stats?.materials.toLocaleString() ?? 'Loading…'}</dd></div>
        </dl>
        <div className="character-workbench__clips"><strong>Actual clips:</strong> {stats?.clips.map((clip) => <code key={clip.name}>{clip.name} {formatDuration(clip.duration)}</code>) ?? 'Loading…'}</div>
        {missingClips.length > 0 && <p className="character-workbench__missing-clips" role="alert">Missing expected clips: {missingClips.join(', ')}</p>}
      </div>
      <div className="character-workbench__comparison">
        <h2>Approved V9 bust and candidate render</h2>
        <div className="character-workbench__comparison-images">
          <figure><a href={candidate.approvedRenders[1].url} target="_blank" rel="noreferrer"><img src={candidate.approvedRenders[1].url} alt="Approved V9 male Wayfarer three-quarter bust render" loading="lazy" /></a><figcaption>Approved V9 bust direction</figcaption></figure>
          <figure><a href={candidate.reviewRenders[1].url} target="_blank" rel="noreferrer"><img src={candidate.reviewRenders[1].url} alt={`${candidate.label} three-quarter Blender render`} loading="lazy" /></a><figcaption>{candidate.renderCaption}</figcaption></figure>
        </div>
        <details><summary>Earlier concept sheet</summary><a href={candidate.conceptUrl} target="_blank" rel="noreferrer"><img className="character-workbench__historical-concept" src={candidate.conceptUrl} alt="Earlier male Wayfarer concept sheet, preceding the approved V9 bust" loading="lazy" /></a><p>The V9 bust render above is the approved target for this workbench.</p></details>
        <details><summary>Other Blender review angles</summary><div className="character-workbench__review-renders">{candidate.reviewRenders.map((render) => <a key={render.label} href={render.url} target="_blank" rel="noreferrer">{render.label}</a>)}</div></details>
      </div>
    </section>
    <footer className="character-workbench__footer">{CHARACTER_CANDIDATES.length} inspectable candidates · no save data is read or changed by this workbench</footer>
  </main>
}
