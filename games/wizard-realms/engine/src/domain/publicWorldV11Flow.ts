import type { createAtomicV8Store } from './atomicV8Database'
import type { createAtomicV9Store } from './atomicV9Database'
import type { createAtomicV10Store } from './atomicV10Database'
import type { AtomicV11Record, createAtomicV11Store } from './atomicV11Database'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { inspectPublicV10UnderLock } from './publicWorldV10Flow'
import { decodePublicV10Head, encodePublicV10Head } from './publicWorldV10Snapshot'
import { decodePublicV11Head, encodePublicV11Head, isValidPublicV11SourceReceipt,
  samePublicV11SourceReceipt } from './publicWorldV11Snapshot'
import type { PublicV11SourceReceipt } from './publicWorldV11Snapshot'
import { withPublicV11Highland } from './publicWorldV11State'
import type { PublicWorldV11State } from './publicWorldV11State'

export type PublicV11Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV11Start = {
  readonly state: PublicWorldV11State
  readonly saveRevision: number
  readonly sourceReceipt: PublicV11SourceReceipt
}
export type PublicV11Inspection =
  | { status: 'missing'; sourceReceipt: PublicV11SourceReceipt | null }
  | { status: 'valid'; start: PublicV11Start }
  | { status: 'blocked'; reason: string }

type V8Store = ReturnType<typeof createAtomicV8Store>
type V9Store = ReturnType<typeof createAtomicV9Store>
type V10Store = ReturnType<typeof createAtomicV10Store>
type V11Store = ReturnType<typeof createAtomicV11Store>
type Checked = Exclude<PublicV11Inspection, { status: 'valid' }> |
  { status: 'valid'; start: PublicV11Start; bootstrap: PublicV6BootstrapRoot | null }
const failed = (reason: string): PublicV11Operation<never> => ({ ok: false, reason })
const succeeded = <T,>(value: T): PublicV11Operation<T> => ({ ok: true, value })
const blocked = (reason: string): PublicV11Operation<Checked> => succeeded({ status: 'blocked', reason })
const identity = (state: PublicWorldV11State, bootstrap: PublicV6BootstrapRoot | null) =>
  JSON.stringify([state.seed, state.generationProfile, bootstrap])
const preservesCampHistory = (previous: PublicWorldV11State, next: PublicWorldV11State) =>
  previous.fieldCampTileIds.length <= next.fieldCampTileIds.length
  && previous.fieldCampTileIds.every((id, index) => id === next.fieldCampTileIds[index])
const preservesDigHistory = (previous: PublicWorldV11State, next: PublicWorldV11State) =>
  !previous.mireglass.cacheExcavated || next.mireglass.cacheExcavated
const preservesHighlandHistory = (previous: PublicWorldV11State, next: PublicWorldV11State) =>
  (!previous.highland.landmarkDiscovered || next.highland.landmarkDiscovered)
  && previous.highland.stoneNodes.length === next.highland.stoneNodes.length
  && previous.highland.stoneNodes.every((node, index) => node.id === next.highland.stoneNodes[index]?.id
    && node.readyAtTick <= next.highland.stoneNodes[index].readyAtTick)

async function withLock<T>(locks: PublicV7LockProvider | undefined,
  operation: () => Promise<PublicV11Operation<T>>): Promise<PublicV11Operation<T>> {
  if (!locks) return failed('lock-unavailable')
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, operation) }
  catch { return failed('storage-error') }
}

function decodeRecord(record: AtomicV11Record | null) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || Reflect.ownKeys(record).length !== 2
    || !Object.hasOwn(record, 'saveRevision') || !Object.hasOwn(record, 'value')) return null
  const decoded = decodePublicV11Head(record.value)
  return decoded && decoded.saveRevision === record.saveRevision ? decoded : null
}

function matchesInitialState(head: NonNullable<ReturnType<typeof decodeRecord>>,
  source: PublicV11SourceReceipt): boolean {
  const v10 = decodePublicV10Head(source.sourceV10Head)!
  try {
    const initial = encodePublicV11Head(withPublicV11Highland(v10.state), v10.bootstrap, 0)
    return JSON.stringify(head.bootstrap) === JSON.stringify(v10.bootstrap)
      && JSON.stringify(encodePublicV11Head(head.state, head.bootstrap, 0)) === JSON.stringify(initial)
  } catch { return false }
}

/** The caller holds the shared v7 Web Lock. Never request a nested lock here. */
async function inspectUnderLock(storage: Pick<Storage, 'getItem'>, v8: V8Store, v9: V9Store,
  v10: V10Store, v11: V11Store): Promise<PublicV11Operation<Checked>> {
  const read = await v11.read()
  if (read.status !== 'ok') return failed('storage-error')
  const missing = read.head === null && read.previous === null && read.lineage === null
  const head = decodeRecord(read.head)
  const previous = decodeRecord(read.previous)
  if (!missing) {
    if (!head) return blocked('invalid-v11-head')
    if (!isValidPublicV11SourceReceipt(read.lineage)) return blocked('invalid-v11-lineage')
    if (head.saveRevision === 0 ? read.previous !== null
      : !previous || previous.saveRevision !== head.saveRevision - 1) return blocked('invalid-v11-previous')
    const source = decodePublicV10Head(read.lineage.sourceV10Head)!
    const sourceState = withPublicV11Highland(source.state)
    if (identity(head.state, head.bootstrap) !== identity(sourceState, source.bootstrap)
      || head.saveRevision === 0 && !matchesInitialState(head, read.lineage)
      || !preservesCampHistory(sourceState, head.state)
      || !preservesDigHistory(sourceState, head.state)
      || !preservesHighlandHistory(sourceState, head.state)) return blocked('invalid-v11-lineage')
    if (previous && (identity(previous.state, previous.bootstrap) !== identity(head.state, head.bootstrap)
      || previous.saveRevision === 0 && !matchesInitialState(previous, read.lineage)
      || !preservesCampHistory(sourceState, previous.state)
      || !preservesDigHistory(sourceState, previous.state)
      || !preservesHighlandHistory(sourceState, previous.state))) return blocked('invalid-v11-previous')
    if (previous && !preservesCampHistory(previous.state, head.state)) return blocked('invalid-v11-camp-history')
    if (previous && !preservesDigHistory(previous.state, head.state)) return blocked('invalid-v11-dig-history')
    if (previous && !preservesHighlandHistory(previous.state, head.state)) return blocked('invalid-v11-highland-history')
  }
  const current = await inspectPublicV10UnderLock(storage, v8, v9, v10)
  if (!current.ok) return current
  if (current.value.status === 'blocked') return blocked(current.value.reason)
  if (current.value.status === 'missing') return missing
    ? succeeded({ status: 'missing', sourceReceipt: null }) : blocked('v10-missing')
  const sourceReceipt = structuredClone({ sourceV10Head: encodePublicV10Head(current.value.start.state,
    current.value.bootstrap, current.value.start.saveRevision),
    sourceV10Lineage: current.value.start.sourceReceipt })
  if (!isValidPublicV11SourceReceipt(sourceReceipt)) return blocked('invalid-v10-lineage')
  if (missing) return succeeded({ status: 'missing', sourceReceipt })
  if (!samePublicV11SourceReceipt(read.lineage, sourceReceipt)) return blocked('source-changed')
  return succeeded({ status: 'valid', bootstrap: head!.bootstrap,
    start: { state: head!.state, saveRevision: head!.saveRevision, sourceReceipt } })
}

export function inspectPublicV11(storage: Pick<Storage, 'getItem'>, locks: PublicV7LockProvider | undefined,
  v8: V8Store, v9: V9Store, v10: V10Store, v11: V11Store): Promise<PublicV11Operation<PublicV11Inspection>> {
  return withLock(locks, async () => {
    const checked = await inspectUnderLock(storage, v8, v9, v10, v11)
    if (!checked.ok) return checked
    return succeeded(checked.value.status === 'valid'
      ? { status: 'valid' as const, start: checked.value.start } : checked.value)
  })
}

export function migratePublicV10ToV11(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: V8Store, v9: V9Store, v10: V10Store, v11: V11Store,
  expectedSourceReceipt: PublicV11SourceReceipt): Promise<PublicV11Operation<PublicV11Start>> {
  return withLock(locks, async () => {
    if (!isValidPublicV11SourceReceipt(expectedSourceReceipt)) return failed('invalid-expected-source')
    const expected = structuredClone(expectedSourceReceipt)
    const checked = await inspectUnderLock(storage, v8, v9, v10, v11)
    if (!checked.ok) return checked
    if (checked.value.status === 'blocked') return failed(checked.value.reason)
    if (checked.value.status === 'valid') return failed('v11-records-present')
    const sourceReceipt = checked.value.sourceReceipt
    if (!sourceReceipt) return failed('v10-missing')
    if (!samePublicV11SourceReceipt(expected, sourceReceipt)) return failed('source-changed')
    const source = decodePublicV10Head(sourceReceipt.sourceV10Head)!
    const state = withPublicV11Highland(source.state)
    const head = encodePublicV11Head(state, source.bootstrap, 0)
    const result = await v11.commit(null, null, { saveRevision: 0, value: head }, sourceReceipt)
    return result === 'committed' ? succeeded({ state, saveRevision: 0, sourceReceipt }) : failed(result)
  })
}

export function resumePublicV11(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: V8Store, v9: V9Store, v10: V10Store, v11: V11Store,
  expectedRevision: number, expectedSourceReceipt: PublicV11SourceReceipt): Promise<PublicV11Operation<PublicV11Start>> {
  return withLock(locks, async () => {
    if (!isValidPublicV11SourceReceipt(expectedSourceReceipt)) return failed('invalid-expected-source')
    const expected = structuredClone(expectedSourceReceipt)
    const checked = await inspectUnderLock(storage, v8, v9, v10, v11)
    if (!checked.ok) return checked
    if (checked.value.status !== 'valid') return failed(checked.value.status === 'missing'
      ? 'v11-missing' : checked.value.reason)
    const { start } = checked.value
    if (!samePublicV11SourceReceipt(expected, start.sourceReceipt)) return failed('lineage-changed')
    return start.saveRevision === expectedRevision ? succeeded(start) : failed('revision-changed')
  })
}

export function commitPublicV11Snapshot(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: V8Store, v9: V9Store, v10: V10Store, v11: V11Store,
  state: PublicWorldV11State, expectedRevision: number,
  expectedSourceReceipt: PublicV11SourceReceipt): Promise<PublicV11Operation<PublicV11Start>> {
  return withLock(locks, async () => {
    if (!isValidPublicV11SourceReceipt(expectedSourceReceipt)) return failed('invalid-expected-source')
    const expected = structuredClone(expectedSourceReceipt)
    const checked = await inspectUnderLock(storage, v8, v9, v10, v11)
    if (!checked.ok) return checked
    if (checked.value.status !== 'valid') return failed(checked.value.status === 'missing'
      ? 'v11-missing' : checked.value.reason)
    const { start, bootstrap } = checked.value
    if (!samePublicV11SourceReceipt(expected, start.sourceReceipt)) return failed('lineage-changed')
    if (start.saveRevision !== expectedRevision) return failed('revision-changed')
    if (!preservesCampHistory(start.state, state)) return failed('invalid-v11-camp-history')
    if (!preservesDigHistory(start.state, state)) return failed('invalid-v11-dig-history')
    if (!preservesHighlandHistory(start.state, state)) return failed('invalid-v11-highland-history')
    const nextRevision = expectedRevision + 1
    let head: ReturnType<typeof encodePublicV11Head>
    try {
      if (identity(state, bootstrap) !== identity(start.state, bootstrap)) return failed('invalid-state')
      head = structuredClone(encodePublicV11Head(state, bootstrap, nextRevision))
    } catch { return failed('invalid-state') }
    const nextState = decodePublicV11Head(head)!.state
    const result = await v11.commit(expectedRevision, start.sourceReceipt, { saveRevision: nextRevision, value: head })
    return result === 'committed'
      ? succeeded({ state: nextState, saveRevision: nextRevision, sourceReceipt: start.sourceReceipt }) : failed(result)
  })
}
