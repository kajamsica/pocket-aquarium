import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import type { MorphologyProfileV1 } from '../specimens/specimenProfile'
import { EditableSpecimen } from './EditableSpecimen'
import { evaluateMorphology, type GeometryDigest } from './geometry/evaluateMorphology'
import { constrainStationEdit, type EditableStationField } from './geometry/morphologyConstraints'

interface MorphologyEditorProps {
  readonly profile: MorphologyProfileV1
  readonly acceptedProfile: MorphologyProfileV1
  readonly onChange: (profile: MorphologyProfileV1) => void
  readonly onDigest?: (digest: GeometryDigest) => void
}

function Orbit() {
  const { camera, gl } = useThree()
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl.domElement])
  useEffect(() => () => controls.dispose(), [controls])
  useFrame(() => controls.update())
  return null
}

export function MorphologyEditor({ profile, acceptedProfile, onChange, onDigest }: MorphologyEditorProps) {
  const [stationId, setStationId] = useState('peduncle-01')
  const [wireframe, setWireframe] = useState(false)
  const [showGhost, setShowGhost] = useState(true)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [clipPhase, setClipPhase] = useState(0)
  const evaluated = useMemo(() => evaluateMorphology(profile), [profile])
  const accepted = useMemo(() => evaluateMorphology(acceptedProfile), [acceptedProfile])
  const station = profile.controlStations.find((item) => item.id === stationId) ?? profile.controlStations[0]

  useEffect(() => { onDigest?.(evaluated.digest) }, [evaluated.digest, onDigest])
  useEffect(() => () => evaluated.geometry.dispose(), [evaluated.geometry])
  useEffect(() => () => accepted.geometry.dispose(), [accepted.geometry])

  const change = (field: EditableStationField, value: number) => onChange(constrainStationEdit(profile, station.id, field, value))
  const control = (label: string, field: EditableStationField, maximum = 0.032) => (
    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
      <span>{label} {(station[field] * 1000).toFixed(1)} mm</span>
      <input aria-label={label} type="range" min={field.startsWith('center') ? -0.01 : 0.0001} max={maximum}
        step="0.0001" value={station[field]} onChange={(event) => change(field, Number(event.target.value))} />
    </label>
  )

  return (
    <section aria-label="Constrained morphology editor" style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 1fr) 300px', minHeight: 520, color: '#182127', background: '#d7d8d6' }}>
      <div style={{ minHeight: 520 }}>
        <Canvas camera={{ position: [0.12, 0.08, 0.14], fov: 34, near: 0.005, far: 5 }} shadows>
          <color attach="background" args={['#d7d8d6']} /><ambientLight intensity={0.7} />
          <directionalLight position={[0.12, 0.18, 0.13]} intensity={3.2} castShadow />
          <pointLight position={[-0.14, 0.1, -0.16]} color="#b5d7ff" intensity={1.2} />
          <Orbit />
          <EditableSpecimen profile={profile} evaluated={evaluated} accepted={accepted} showAcceptedGhost={showGhost}
            wireframe={wireframe} showSkeleton={showSkeleton} clipPhase={clipPhase} />
        </Canvas>
      </div>
      <aside className="workbench-controls" style={{ gridColumn: 'auto', gridRow: 'auto', padding: 16, overflow: 'auto' }}>
        <p style={{ margin: '0 0 6px', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase' }}>Ocellaris authoring cage</p>
        <strong>Grade {profile.referenceGrade}, provisional anatomy</strong>
        <label style={{ display: 'grid', gap: 5, margin: '16px 0', fontSize: 12 }}>Station
          <select value={station.id} onChange={(event) => setStationId(event.target.value)}>
            {profile.controlStations.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
          </select>
        </label>
        <fieldset><legend>Side profile</legend>{control('Dorsal height', 'dorsalHeight')}{control('Ventral depth', 'ventralDepth')}</fieldset>
        <fieldset><legend>Top profile</legend>{control('Half width', 'halfWidth')}</fieldset>
        <fieldset><legend>Front profile</legend>{control('Lateral center', 'centerY', 0.01)}{control('Vertical center', 'centerZ', 0.01)}</fieldset>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBlock: 12 }}>
          <button type="button" aria-pressed={showGhost} onClick={() => setShowGhost((value) => !value)}>Accepted ghost</button>
          <button type="button" aria-pressed={wireframe} onClick={() => setWireframe((value) => !value)}>Wireframe</button>
          <button type="button" aria-pressed={showSkeleton} onClick={() => setShowSkeleton((value) => !value)}>Skeleton</button>
        </div>
        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>Clip scrub hook {Math.round(clipPhase * 100)}%
          <input type="range" min="0" max="1" step="0.01" value={clipPhase} onChange={(event) => setClipPhase(Number(event.target.value))} />
        </label>
        <code style={{ display: 'block', marginTop: 14 }}>digest {evaluated.digest.value}<br />{evaluated.digest.vertices} vertices · {evaluated.digest.triangles} triangles</code>
      </aside>
    </section>
  )
}
