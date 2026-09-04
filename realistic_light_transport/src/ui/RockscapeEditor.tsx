import type { PocketRockView } from '../integration/pocketAquariumBridge'

export type RockTransformPatch = Readonly<{
  position?: PocketRockView['position']
  rotation?: PocketRockView['rotation']
  scale?: PocketRockView['scale']
}>

interface RockscapeEditorProps {
  readonly active: boolean
  readonly rocks: readonly PocketRockView[]
  readonly occupiedRockIds: ReadonlySet<number>
  readonly selectedRockId: number | null
  readonly onBegin: () => void
  readonly onSelect: (rockId: number) => void
  readonly onPatch: (rockId: number, patch: RockTransformPatch) => void
  readonly onSave: () => void
  readonly onCancel: () => void
}

const POSITION_STEP = .12
const ROTATION_STEP = Math.PI / 18
const SCALE_STEP = .06
const POSITION_BOUNDS = [[-2.2, 2.2], [-1.3, .5], [-.9, .9]] as const
const SCALE_BOUNDS = [.18, .9] as const

function clamp(value: number, [minimum, maximum]: readonly [number, number]) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function offsetRockPosition(values: PocketRockView['position'], axis: 0 | 1 | 2, amount: number) {
  const next = [...values] as [number, number, number]
  next[axis] = clamp(next[axis] + amount, POSITION_BOUNDS[axis])
  return next as PocketRockView['position']
}

export function rotateRock(values: PocketRockView['rotation'], amount: number) {
  const turn = values[1] + amount
  const wrapped = ((turn + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
  return [values[0], wrapped, values[2]] as PocketRockView['rotation']
}

export function resizeRock(values: PocketRockView['scale'], amount: number) {
  return values.map((value) => clamp(value + amount, SCALE_BOUNDS)) as [number, number, number]
}

export function changedRockTransform(original: PocketRockView, draft: PocketRockView): RockTransformPatch | null {
  const positionChanged = draft.position.some((value, index) => value !== original.position[index])
  const rotationChanged = draft.rotation.some((value, index) => value !== original.rotation[index])
  const scaleChanged = draft.scale.some((value, index) => value !== original.scale[index])
  if (!positionChanged && !rotationChanged && !scaleChanged) return null
  return {
    ...(positionChanged ? { position: draft.position } : {}),
    ...(rotationChanged ? { rotation: draft.rotation } : {}),
    ...(scaleChanged ? { scale: draft.scale } : {}),
  }
}

/** A small deliberate aquascaping surface. Scene dragging and these keyboard-friendly nudges
 * edit the same draft; only Lock rockscape dispatches authoritative root updates. */
export function RockscapeEditor({ active, rocks, occupiedRockIds, selectedRockId, onBegin, onSelect,
  onPatch, onSave, onCancel }: RockscapeEditorProps) {
  if (!active) return <aside className="rockscape-editor-launcher">
    <button type="button" onClick={onBegin}>Edit rockscape</button>
  </aside>

  const selected = rocks.find((rock) => rock.id === selectedRockId) ?? rocks[0]
  const occupied = selected ? occupiedRockIds.has(selected.id) : false
  return <aside className="rockscape-editor" aria-label="Rockscape editor">
    <header><div><span>Aquascape workspace</span><strong>Move the reef foundation</strong></div>
      <small>Drag a rock in the tank, or use the precise controls. Changes stay temporary until locked.</small></header>
    <label>Selected rock
      <select value={selected?.id ?? ''} onChange={(event) => onSelect(Number(event.currentTarget.value))}>
        {rocks.map((rock) => <option key={rock.id} value={rock.id}>Rock {rock.index + 1}</option>)}
      </select>
    </label>
    {selected ? <>
      <div className="rockscape-editor-grid" aria-label="Move selected rock">
        <button type="button" onClick={() => onPatch(selected.id, { position: offsetRockPosition(selected.position, 0, -POSITION_STEP) })}>Left</button>
        <button type="button" onClick={() => onPatch(selected.id, { position: offsetRockPosition(selected.position, 2, -POSITION_STEP) })}>Back</button>
        <button type="button" onClick={() => onPatch(selected.id, { position: offsetRockPosition(selected.position, 2, POSITION_STEP) })}>Front</button>
        <button type="button" onClick={() => onPatch(selected.id, { position: offsetRockPosition(selected.position, 0, POSITION_STEP) })}>Right</button>
        <button type="button" disabled={occupied} title={occupied ? 'Move its coral before rotating this rock.' : undefined}
          onClick={() => onPatch(selected.id, { rotation: rotateRock(selected.rotation, -ROTATION_STEP) })}>Turn left</button>
        <button type="button" disabled={occupied} title={occupied ? 'Move its coral before rotating this rock.' : undefined}
          onClick={() => onPatch(selected.id, { rotation: rotateRock(selected.rotation, ROTATION_STEP) })}>Turn right</button>
        <button type="button" disabled={occupied} title={occupied ? 'Move its coral before resizing this rock.' : undefined}
          onClick={() => onPatch(selected.id, { scale: resizeRock(selected.scale, -SCALE_STEP) })}>Smaller</button>
        <button type="button" disabled={occupied} title={occupied ? 'Move its coral before resizing this rock.' : undefined}
          onClick={() => onPatch(selected.id, { scale: resizeRock(selected.scale, SCALE_STEP) })}>Larger</button>
      </div>
      {occupied ? <small className="rockscape-editor-note">Attached coral follows horizontal moves. Move the coral before turning or resizing this rock.</small> : null}
      <p>Rock {selected.index + 1} · diatoms {Math.round(selected.biology.diatom * 100)}% · nuisance algae {Math.round(selected.biology.nuisanceAlgae * 100)}% · coralline {Math.round(selected.biology.coralline * 100)}%</p>
    </> : null}
    <footer><button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="rockscape-editor-lock" onClick={onSave}>Lock rockscape</button></footer>
  </aside>
}
