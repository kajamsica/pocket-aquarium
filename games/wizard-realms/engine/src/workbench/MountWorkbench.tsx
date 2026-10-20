import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { MOUNT_CANDIDATES, mountStatusLabel, selectMountCandidate } from './mountCatalog'
import './characterWorkbench.css'
import './MountWorkbench.css'

interface MountStats {
  readonly triangles: number
  readonly nodes: number
  readonly bones: number
  readonly materials: number
  readonly clips: readonly { readonly name: string; readonly duration: number }[]
  readonly center: THREE.Vector3Tuple
  readonly size: THREE.Vector3Tuple
}

class PreviewBoundary extends Component<{ readonly resetKey: string; readonly onError: (error: string) => void; readonly children: ReactNode }, { failed: boolean; resetKey: string }> {
  state = { failed: false, resetKey: this.props.resetKey }
  static getDerivedStateFromError() { return { failed: true } }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { resetKey: string }) {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey }
  }
  componentDidCatch(error: unknown) { this.props.onError(error instanceof Error ? error.message : 'Mount asset could not be loaded.') }
  render() { return this.state.failed ? null : this.props.children }
}

function OrbitCamera({ bounds }: { readonly bounds?: MountStats }) {
  const { camera, gl, size } = useThree()
  const controls = useRef<OrbitControls | null>(null)
  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement)
    orbit.enableDamping = true
    orbit.minDistance = 0.5
    orbit.maxDistance = 35
    controls.current = orbit
    return () => { orbit.dispose(); controls.current = null }
  }, [camera, gl.domElement])
  useEffect(() => {
    if (!controls.current || !bounds || !(camera instanceof THREE.PerspectiveCamera)) return
    const center = new THREE.Vector3(...bounds.center)
    const span = Math.max(...bounds.size, 1.5)
    const fov = THREE.MathUtils.degToRad(camera.fov)
    const distance = span / (2 * Math.tan(fov / 2)) * (size.width < size.height ? 1.7 : 1.3)
    camera.position.copy(center).add(new THREE.Vector3(0.8, 0.35, -1).normalize().multiplyScalar(distance))
    controls.current.target.copy(center)
    controls.current.update()
  }, [bounds, camera, size.height, size.width])
  useFrame(() => controls.current?.update())
  return null
}

function MountModel({ url, clipName, playing, onReady }: {
  readonly url: string
  readonly clipName: string
  readonly playing: boolean
  readonly onReady: (stats: MountStats) => void
}) {
  const source = useLoader(GLTFLoader, url)
  const root = useMemo(() => cloneSkinned(source.scene), [source.scene])
  const mixer = useMemo(() => new THREE.AnimationMixer(root), [root])
  const clip = source.animations.find((item) => item.name === clipName) ?? source.animations[0]
  useEffect(() => {
    let triangles = 0
    let nodes = 0
    let bones = 0
    const materials = new Set<string>()
    root.traverse((node) => {
      nodes += 1
      if ((node as THREE.Bone).isBone) bones += 1
      if (!(node as THREE.Mesh).isMesh) return
      const mesh = node as THREE.Mesh
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0) / 3
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material.uuid)
    })
    const box = new THREE.Box3().setFromObject(root)
    onReady({ triangles: Math.round(triangles), nodes, bones, materials: materials.size,
      clips: source.animations.map((item) => ({ name: item.name, duration: item.duration })),
      center: box.getCenter(new THREE.Vector3()).toArray() as THREE.Vector3Tuple,
      size: box.getSize(new THREE.Vector3()).toArray() as THREE.Vector3Tuple })
  }, [onReady, root, source.animations])
  useEffect(() => {
    const action = clip && mixer.clipAction(clip, root)
    action?.reset().setLoop(THREE.LoopRepeat, Infinity).play()
    return () => { action?.stop(); mixer.uncacheRoot(root) }
  }, [clip, mixer, root])
  useFrame((_, delta) => { if (playing) mixer.update(Math.min(delta, 0.05)) })
  return <primitive object={root} />
}

export function MountWorkbench() {
  const requestedId = new URLSearchParams(window.location.search).get('mount')
  const candidate = selectMountCandidate(requestedId)
  const [stats, setStats] = useState<MountStats>()
  const [clipName, setClipName] = useState('Idle')
  const [playing, setPlaying] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const onReady = useCallback((value: MountStats) => setStats(value), [])
  const onError = useCallback((value: string) => setLoadError(value), [])
  useEffect(() => { setStats(undefined); setClipName('Idle'); setLoadError(undefined) }, [candidate?.id])

  if (!candidate) return <main className="character-workbench character-workbench--missing">
    <h1>Mount candidate not found</h1><p>The requested mount is not in this workbench.</p>
    <a href="?workbench=mounts">Open the five-mount gallery</a>
  </main>

  const previewable = candidate.status === 'review_ready' && Boolean(candidate.modelUrl)
  const clips = stats?.clips ?? []
  const selectedClip = clips.some((item) => item.name === clipName) ? clipName : clips[0]?.name ?? 'Idle'
  return <main className="character-workbench mount-workbench" data-candidate-state={candidate.status}>
    <title>Mount Workbench | Wizard Realms</title>
    <header className="character-workbench__header">
      <div><p className="character-workbench__eyebrow">Wizard Realms · Isolated mount asset playground</p><h1>{candidate.name} · {candidate.form}</h1></div>
      <div className="character-workbench__header-actions"><a href="?publicWorld=v42">Return to game</a><span className="character-workbench__status" role="status">{mountStatusLabel(candidate)}</span></div>
    </header>
    <p className="character-workbench__notice">These five silhouettes are art candidates, not unlocked gameplay mounts. Model review and traversal approval are separate gates.</p>
    <nav className="mount-workbench__catalog" aria-label="Mount candidates">
      {MOUNT_CANDIDATES.map((mount) => <a key={mount.id} aria-current={candidate.id === mount.id ? 'page' : undefined} href={`?workbench=mounts&mount=${mount.id}`}>
        <strong>{mount.name}</strong><span>{mount.form}</span>
      </a>)}
    </nav>
    <div className="character-workbench__layout">
      <section className="character-workbench__stage" aria-label="Selected mount 3D inspection stage">
        {previewable && candidate.modelUrl ? <>
          <Canvas key={candidate.id} camera={{ fov: 35, near: 0.01, far: 100, position: [4, 3, -6] }} dpr={[1, 1.5]} fallback={<div role="alert">WebGL unavailable.</div>}>
            <color attach="background" args={['#d8d8d4']} />
            <ambientLight intensity={1.15} /><hemisphereLight args={['#ffffff', '#8d8070', 1.1]} />
            <directionalLight position={[4, 7, 5]} intensity={2.7} />
            <OrbitCamera bounds={stats} />
            <gridHelper args={[12, 24, '#8f9090', '#b8b8b4']} position={[0, -0.02, 0]} />
            <PreviewBoundary resetKey={candidate.id} onError={onError}>
              <Suspense fallback={null}><MountModel url={candidate.modelUrl} clipName={selectedClip} playing={playing} onReady={onReady} /></Suspense>
            </PreviewBoundary>
          </Canvas>
          {!stats && !loadError && <p className="character-workbench__loading" role="status">Loading selected mount only…</p>}
          {loadError && <p className="character-workbench__error" role="alert">Asset load failed: {loadError}</p>}
          <p className="character-workbench__orbit-hint">Drag to orbit · wheel to zoom</p>
        </> : <div className="mount-workbench__pending" role="status"><strong>No 3D model loaded</strong><span>{mountStatusLabel(candidate)}. This does not start a renderer.</span></div>}
      </section>
      <aside className="character-workbench__controls" aria-label="Mount workbench controls">
        <fieldset><legend>Animation</legend>
          <label htmlFor="mount-workbench-clip">Actual GLB clip</label>
          <select id="mount-workbench-clip" value={selectedClip} disabled={!clips.length} onChange={(event) => setClipName(event.target.value)}>
            {clips.length ? clips.map((clip) => <option key={clip.name} value={clip.name}>{clip.name} · {clip.duration.toFixed(2)}s</option>) : <option value="Idle">No GLB clips yet</option>}
          </select>
          <button className="character-workbench__play" type="button" disabled={!clips.length} aria-pressed={playing} onClick={() => setPlaying((value) => !value)}>{playing ? 'Pause animation' : 'Play animation'}</button>
          <small>Only exported clips are selectable. Orbit controls activate when this candidate has a verified GLB.</small>
        </fieldset>
        <fieldset><legend>Design brief</legend><p><strong>Travel role:</strong> {candidate.traversal}</p><p><strong>Silhouette:</strong> {candidate.silhouette}</p><p><strong>Acquisition idea:</strong> {candidate.acquisition}</p></fieldset>
      </aside>
    </div>
    <section className="character-workbench__details" aria-label="Mount candidate status and statistics">
      <div><h2>Asset review status</h2><p>{mountStatusLabel(candidate)}.</p><p>Visual design, rig, scale, movement clips, rider fit, and game traversal each require separate checks before release.</p></div>
      <div><h2>Loaded model</h2><dl className="character-workbench__stats">
        <div><dt>Triangles</dt><dd>{stats?.triangles.toLocaleString() ?? 'Pending'}</dd></div>
        <div><dt>Nodes</dt><dd>{stats?.nodes.toLocaleString() ?? 'Pending'}</dd></div>
        <div><dt>Bones</dt><dd>{stats?.bones.toLocaleString() ?? 'Pending'}</dd></div>
        <div><dt>Materials</dt><dd>{stats?.materials.toLocaleString() ?? 'Pending'}</dd></div>
      </dl></div>
    </section>
    <footer className="character-workbench__footer">Five distinct mount candidates · this gallery does not mount gameplay or read or write saves</footer>
  </main>
}
