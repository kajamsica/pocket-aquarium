import type { createAtomicV8Store } from './atomicV8Database'
import type { createAtomicV9Store } from './atomicV9Database'
import type { createAtomicV10Store } from './atomicV10Database'
import type { createAtomicV11Store } from './atomicV11Database'
import type { createAtomicV12Store } from './atomicV12Database'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { inspectPublicV11UnderLock } from './publicWorldV11Flow'
import { decodePublicV11Head, encodePublicV11Head } from './publicWorldV11Snapshot'
import { encodePublicV12Head, isValidatedPublicV12MigrationState,
  isValidPublicV12SourceReceipt, sameValidatedPublicV12SourceReceipt } from './publicWorldV12Snapshot'
import type { PublicV12SourceReceipt } from './publicWorldV12Snapshot'
import { withPublicV12Windstep } from './publicWorldV12State'
import type { PublicWorldV12State } from './publicWorldV12State'

export type PublicV12Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV12Start = {
  readonly state: PublicWorldV12State
  readonly saveRevision: number
  readonly sourceReceipt: PublicV12SourceReceipt
}
export type PublicV12Inspection =
  | { status: 'missing'; sourceReceipt: PublicV12SourceReceipt | null }
  | { status: 'valid'; start: PublicV12Start }
  | { status: 'blocked'; reason: string }

type V8Store = ReturnType<typeof createAtomicV8Store>
type V9Store = ReturnType<typeof createAtomicV9Store>
type V10Store = ReturnType<typeof createAtomicV10Store>
type V11Store = ReturnType<typeof createAtomicV11Store>
type V12Store = ReturnType<typeof createAtomicV12Store>
type Checked = Exclude<PublicV12Inspection, { status: 'valid' }> |
  { status: 'valid'; start: PublicV12Start; bootstrap: PublicV6BootstrapRoot | null }
const inspectionProofs = new WeakMap<Checked, object>()
const failed = (reason: string): PublicV12Operation<never> => ({ ok: false, reason })
const succeeded = <T,>(value: T): PublicV12Operation<T> => ({ ok: true, value })
const blocked = (reason: string): PublicV12Operation<Checked> => succeeded({ status: 'blocked', reason })
const identity = (state: PublicWorldV12State, bootstrap: PublicV6BootstrapRoot | null) =>
  JSON.stringify([state.seed, state.generationProfile, bootstrap])
const preservesCampHistory = (previous: PublicWorldV12State, next: PublicWorldV12State) =>
  previous.fieldCampTileIds.length <= next.fieldCampTileIds.length
  && previous.fieldCampTileIds.every((id, index) => id === next.fieldCampTileIds[index])
const preservesDigHistory = (previous: PublicWorldV12State, next: PublicWorldV12State) =>
  !previous.mireglass.cacheExcavated || next.mireglass.cacheExcavated
const preservesHighlandHistory = (previous: PublicWorldV12State, next: PublicWorldV12State) =>
  (!previous.highland.landmarkDiscovered || next.highland.landmarkDiscovered)
  && previous.highland.stoneNodes.length === next.highland.stoneNodes.length
  && previous.highland.stoneNodes.every((node, index) => node.id === next.highland.stoneNodes[index]?.id
    && node.readyAtTick <= next.highland.stoneNodes[index].readyAtTick)
const preservesWindHistory = (previous: PublicWorldV12State, next: PublicWorldV12State) =>
  (!previous.windstep.learned || next.windstep.learned)
  && previous.windstep.activeUntilTick <= next.windstep.activeUntilTick
  && previous.windstep.nextCastTick <= next.windstep.nextCastTick
  && previous.windstep.practicedRouteIndices.every((index) =>
    next.windstep.practicedRouteIndices.includes(index))
const preservesHistory = (previous: PublicWorldV12State, next: PublicWorldV12State) =>
  previous.tick <= next.tick && previous.eventSequence <= next.eventSequence
  && preservesCampHistory(previous, next) && preservesDigHistory(previous, next)
  && preservesHighlandHistory(previous, next) && preservesWindHistory(previous, next)

async function withLock<T>(locks: PublicV7LockProvider | undefined,
  operation: () => Promise<PublicV12Operation<T>>): Promise<PublicV12Operation<T>> {
  if (!locks) return failed('lock-unavailable')
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, operation) }
  catch { return failed('storage-error') }
}

/** The caller holds the shared v7 Web Lock; never request it a second time. */
export async function inspectPublicV12UnderLock(storage: Pick<Storage, 'getItem'>,
  v8: V8Store, v9: V9Store, v10: V10Store, v11: V11Store,
  v12: V12Store): Promise<PublicV12Operation<Checked>> {
  const read = await v12.readChecked()
  if (read.status !== 'ok') return failed('storage-error')
  const missing = read.head === null && read.previous === null && read.lineage === null
  const head = read.decodedHead
  const previous = read.decodedPrevious
  if (!missing) {
    if (!head) return blocked('invalid-v12-head')
    if (!read.lineageValid) return blocked('invalid-v12-lineage')
    if (head.saveRevision === 0 ? read.previous !== null
      : !previous || previous.saveRevision !== head.saveRevision - 1) return blocked('invalid-v12-previous')
    const source = decodePublicV11Head(read.lineage!.sourceV11Head)!
    const sourceState = withPublicV12Windstep(source.state)
    if (identity(head.state, head.bootstrap) !== identity(sourceState, source.bootstrap)
      || head.saveRevision === 0 && !isValidatedPublicV12MigrationState(head, source)
      || !preservesHistory(sourceState, head.state)) return blocked('invalid-v12-lineage')
    if (previous && (identity(previous.state, previous.bootstrap) !== identity(head.state, head.bootstrap)
      || previous.saveRevision === 0 && !isValidatedPublicV12MigrationState(previous, source)
      || !preservesHistory(sourceState, previous.state))) return blocked('invalid-v12-previous')
    if (previous && !preservesCampHistory(previous.state, head.state)) return blocked('invalid-v12-camp-history')
    if (previous && !preservesDigHistory(previous.state, head.state)) return blocked('invalid-v12-dig-history')
    if (previous && !preservesHighlandHistory(previous.state, head.state)) return blocked('invalid-v12-highland-history')
    if (previous && !preservesWindHistory(previous.state, head.state)) return blocked('invalid-v12-wind-history')
    if (previous && (previous.state.tick > head.state.tick
      || previous.state.eventSequence > head.state.eventSequence)) return blocked('invalid-v12-clock-history')
  }
  const current = await inspectPublicV11UnderLock(storage, v8, v9, v10, v11)
  if (!current.ok) return current
  if (current.value.status === 'blocked') return blocked(current.value.reason)
  if (current.value.status === 'missing') return missing
    ? succeeded({ status: 'missing', sourceReceipt: null }) : blocked('v11-missing')
  const sourceReceipt = structuredClone({ sourceV11Head: encodePublicV11Head(current.value.start.state,
    current.value.bootstrap, current.value.start.saveRevision),
    sourceV11Receipt: current.value.start.sourceReceipt })
  if (!isValidPublicV12SourceReceipt(sourceReceipt)) return blocked('invalid-v11-lineage')
  if (missing) {
    if (!read.proof) return failed('storage-error')
    const checked: Checked = { status: 'missing', sourceReceipt }
    inspectionProofs.set(checked, read.proof)
    return succeeded(checked)
  }
  if (!sameValidatedPublicV12SourceReceipt(read.lineage!, sourceReceipt)) return blocked('source-changed')
  if (!read.proof) return failed('storage-error')
  const checked: Checked = { status: 'valid', bootstrap: head!.bootstrap,
    start: { state: head!.state, saveRevision: head!.saveRevision, sourceReceipt } }
  inspectionProofs.set(checked, read.proof)
  return succeeded(checked)
}

export function inspectPublicV12(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: V8Store, v9: V9Store, v10: V10Store,
  v11: V11Store, v12: V12Store): Promise<PublicV12Operation<PublicV12Inspection>> {
  return withLock(locks, async () => {
    const checked = await inspectPublicV12UnderLock(storage, v8, v9, v10, v11, v12)
    if (!checked.ok) return checked
    return succeeded(checked.value.status === 'valid'
      ? { status: 'valid' as const, start: checked.value.start } : checked.value)
  })
}

export function migratePublicV11ToV12(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: V8Store, v9: V9Store, v10: V10Store,
  v11: V11Store, v12: V12Store,
  expectedSourceReceipt: PublicV12SourceReceipt): Promise<PublicV12Operation<PublicV12Start>> {
  return withLock(locks, async () => {
    if (!isValidPublicV12SourceReceipt(expectedSourceReceipt)) return failed('invalid-expected-source')
    const expected = structuredClone(expectedSourceReceipt)
    const checked = await inspectPublicV12UnderLock(storage, v8, v9, v10, v11, v12)
    if (!checked.ok) return checked
    if (checked.value.status === 'blocked') return failed(checked.value.reason)
    if (checked.value.status === 'valid') return failed('v12-records-present')
    const sourceReceipt = checked.value.sourceReceipt
    if (!sourceReceipt) return failed('v11-missing')
    if (!sameValidatedPublicV12SourceReceipt(expected, sourceReceipt)) return failed('source-changed')
    const source = decodePublicV11Head(sourceReceipt.sourceV11Head)!
    const state = withPublicV12Windstep(source.state)
    const head = encodePublicV12Head(state, source.bootstrap, 0)
    const proof = inspectionProofs.get(checked.value)
    if (!proof) return failed('storage-error')
    const result = await v12.commit(null, null, { saveRevision: 0, value: head }, sourceReceipt, proof)
    return result === 'committed' ? succeeded({ state, saveRevision: 0, sourceReceipt }) : failed(result)
  })
}

export function resumePublicV12(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: V8Store, v9: V9Store, v10: V10Store,
  v11: V11Store, v12: V12Store, expectedRevision: number,
  expectedSourceReceipt: PublicV12SourceReceipt): Promise<PublicV12Operation<PublicV12Start>> {
  return withLock(locks, async () => {
    if (!isValidPublicV12SourceReceipt(expectedSourceReceipt)) return failed('invalid-expected-source')
    const expected = structuredClone(expectedSourceReceipt)
    const checked = await inspectPublicV12UnderLock(storage, v8, v9, v10, v11, v12)
    if (!checked.ok) return checked
    if (checked.value.status !== 'valid') return failed(checked.value.status === 'missing'
      ? 'v12-missing' : checked.value.reason)
    const { start } = checked.value
    if (!sameValidatedPublicV12SourceReceipt(expected, start.sourceReceipt)) return failed('lineage-changed')
    return start.saveRevision === expectedRevision ? succeeded(start) : failed('revision-changed')
  })
}

export function commitPublicV12Snapshot(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: V8Store, v9: V9Store, v10: V10Store,
  v11: V11Store, v12: V12Store, state: PublicWorldV12State, expectedRevision: number,
  expectedSourceReceipt: PublicV12SourceReceipt): Promise<PublicV12Operation<PublicV12Start>> {
  // Detach caller-owned inputs before the lock request can wait.
  let nextState: PublicWorldV12State | undefined
  let expected: PublicV12SourceReceipt | undefined
  try { nextState = structuredClone(state) } catch { /* invalid-state below */ }
  try { expected = structuredClone(expectedSourceReceipt) } catch { /* invalid-expected-source below */ }
  return withLock(locks, async () => {
    if (!isValidPublicV12SourceReceipt(expected)) return failed('invalid-expected-source')
    if (!nextState) return failed('invalid-state')
    const checked = await inspectPublicV12UnderLock(storage, v8, v9, v10, v11, v12)
    if (!checked.ok) return checked
    if (checked.value.status !== 'valid') return failed(checked.value.status === 'missing'
      ? 'v12-missing' : checked.value.reason)
    const { start, bootstrap } = checked.value
    if (!sameValidatedPublicV12SourceReceipt(expected, start.sourceReceipt)) return failed('lineage-changed')
    if (start.saveRevision !== expectedRevision) return failed('revision-changed')
    if (!preservesCampHistory(start.state, nextState)) return failed('invalid-v12-camp-history')
    if (!preservesDigHistory(start.state, nextState)) return failed('invalid-v12-dig-history')
    if (!preservesHighlandHistory(start.state, nextState)) return failed('invalid-v12-highland-history')
    if (!preservesWindHistory(start.state, nextState)) return failed('invalid-v12-wind-history')
    if (start.state.tick > nextState.tick || start.state.eventSequence > nextState.eventSequence) {
      return failed('invalid-v12-clock-history')
    }
    const nextRevision = expectedRevision + 1
    let head: ReturnType<typeof encodePublicV12Head>
    try {
      if (identity(nextState, bootstrap) !== identity(start.state, bootstrap)) return failed('invalid-state')
      head = structuredClone(encodePublicV12Head(nextState, bootstrap, nextRevision))
    } catch { return failed('invalid-state') }
    const proof = inspectionProofs.get(checked.value)
    if (!proof) return failed('storage-error')
    const result = await v12.commit(expectedRevision, start.sourceReceipt,
      { saveRevision: nextRevision, value: head }, undefined, proof)
    return result === 'committed'
      ? succeeded({ state: nextState, saveRevision: nextRevision, sourceReceipt: start.sourceReceipt })
      : failed(result)
  })
}
