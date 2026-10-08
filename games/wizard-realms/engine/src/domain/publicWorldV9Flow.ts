import type { createAtomicV8Store } from './atomicV8Database'
import type { AtomicV9Record, createAtomicV9Store } from './atomicV9Database'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { inspectPublicV8UnderLock } from './publicWorldV8Flow'
import { decodePublicV8Head, encodePublicV8Head } from './publicWorldV8Snapshot'
import { decodePublicV9Head, encodePublicV9Head, isValidPublicV9SourceReceipt,
  samePublicV9SourceReceipt } from './publicWorldV9Snapshot'
import type { PublicV9SourceReceipt } from './publicWorldV9Snapshot'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import type { PublicWorldV9State } from './publicWorldV9State'

export type PublicV9Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV9Start = {
  readonly state: PublicWorldV9State
  readonly saveRevision: number
  readonly sourceReceipt: PublicV9SourceReceipt
}
export type PublicV9Inspection =
  | { status: 'missing'; sourceReceipt: PublicV9SourceReceipt | null }
  | { status: 'valid'; start: PublicV9Start }
  | { status: 'blocked'; reason: string }

type V8Store = ReturnType<typeof createAtomicV8Store>
type V9Store = ReturnType<typeof createAtomicV9Store>
type Checked = Exclude<PublicV9Inspection, { status: 'valid' }> |
  { status: 'valid'; start: PublicV9Start; bootstrap: PublicV6BootstrapRoot | null }
const failed = (reason: string): PublicV9Operation<never> => ({ ok: false, reason })
const succeeded = <T,>(value: T): PublicV9Operation<T> => ({ ok: true, value })
const blocked = (reason: string): PublicV9Operation<Checked> => succeeded({ status: 'blocked', reason })
const identity = (state: PublicWorldV9State, bootstrap: PublicV6BootstrapRoot | null) =>
  JSON.stringify([state.seed, state.generationProfile, bootstrap])
const preservesCampHistory = (previous: PublicWorldV9State, next: PublicWorldV9State) =>
  previous.fieldCampTileIds.length === 0
  || previous.fieldCampTileIds.length === next.fieldCampTileIds.length
    && previous.fieldCampTileIds.every((id, index) => id === next.fieldCampTileIds[index])

async function withLock<T>(locks: PublicV7LockProvider | undefined,
  operation: () => Promise<PublicV9Operation<T>>): Promise<PublicV9Operation<T>> {
  if (!locks) return failed('lock-unavailable')
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, operation) }
  catch { return failed('storage-error') }
}

function decodeRecord(record: AtomicV9Record | null) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || Reflect.ownKeys(record).length !== 2
    || !Object.hasOwn(record, 'saveRevision') || !Object.hasOwn(record, 'value')) return null
  const decoded = decodePublicV9Head(record.value)
  return decoded && decoded.saveRevision === record.saveRevision ? decoded : null
}

function matchesInitialState(head: NonNullable<ReturnType<typeof decodeRecord>>, source: PublicV9SourceReceipt) {
  const { fieldCampTileIds, ...v8State } = head.state
  return fieldCampTileIds.length === 0 && samePublicV9SourceReceipt(source, {
    sourceV7Bytes: source.sourceV7Bytes,
    sourceV8Head: encodePublicV8Head(v8State, head.bootstrap, source.sourceV8Head.saveRevision),
  })
}

/** Both databases and the v7 root are read while the caller holds the one shared Web Lock. */
async function inspectUnderLock(storage: Pick<Storage, 'getItem'>, v8: V8Store,
  v9: V9Store): Promise<PublicV9Operation<Checked>> {
  const read = await v9.read()
  if (read.status !== 'ok') return failed('storage-error')
  const missing = read.head === null && read.previous === null && read.lineage === null
  const head = decodeRecord(read.head)
  const previous = decodeRecord(read.previous)
  if (!missing) {
    if (!head) return blocked('invalid-v9-head')
    if (!isValidPublicV9SourceReceipt(read.lineage)) return blocked('invalid-v9-lineage')
    if (head.saveRevision === 0 ? read.previous !== null
      : !previous || previous.saveRevision !== head.saveRevision - 1) return blocked('invalid-v9-previous')
    const source = decodePublicV8Head(read.lineage.sourceV8Head)!
    const sourceState = withFreshPublicV9Camps(source.state)
    if (identity(head.state, head.bootstrap) !== identity(sourceState, source.bootstrap)
      || head.saveRevision === 0 && !matchesInitialState(head, read.lineage)) return blocked('invalid-v9-lineage')
    if (previous && (identity(previous.state, previous.bootstrap) !== identity(head.state, head.bootstrap)
      || previous.saveRevision === 0 && !matchesInitialState(previous, read.lineage))) {
      return blocked('invalid-v9-previous')
    }
    if (previous && !preservesCampHistory(previous.state, head.state)) return blocked('invalid-v9-camp-history')
  }
  const current = await inspectPublicV8UnderLock(storage, v8)
  if (!current.ok) return current
  if (current.value.status === 'blocked') return blocked(current.value.reason)
  if (current.value.status === 'missing') return missing
    ? succeeded({ status: 'missing', sourceReceipt: null }) : blocked('v8-missing')
  const sourceReceipt = structuredClone({ sourceV8Head: current.value.head,
    sourceV7Bytes: current.value.start.sourceV7Bytes })
  if (!isValidPublicV9SourceReceipt(sourceReceipt)) return blocked('invalid-v8-lineage')
  if (missing) return succeeded({ status: 'missing', sourceReceipt })
  if (!samePublicV9SourceReceipt(read.lineage, sourceReceipt)) return blocked('source-changed')
  return succeeded({ status: 'valid', bootstrap: head!.bootstrap,
    start: { state: head!.state, saveRevision: head!.saveRevision, sourceReceipt } })
}

export function inspectPublicV9(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: V8Store, v9: V9Store): Promise<PublicV9Operation<PublicV9Inspection>> {
  return withLock(locks, async () => {
    const checked = await inspectUnderLock(storage, v8, v9)
    if (!checked.ok) return checked
    return succeeded(checked.value.status === 'valid'
      ? { status: 'valid' as const, start: checked.value.start } : checked.value)
  })
}

export function migratePublicV8ToV9(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: V8Store, v9: V9Store,
  expectedSourceReceipt: PublicV9SourceReceipt): Promise<PublicV9Operation<PublicV9Start>> {
  return withLock(locks, async () => {
    if (!isValidPublicV9SourceReceipt(expectedSourceReceipt)) return failed('invalid-expected-source')
    const expected = structuredClone(expectedSourceReceipt)
    const checked = await inspectUnderLock(storage, v8, v9)
    if (!checked.ok) return checked
    if (checked.value.status === 'blocked') return failed(checked.value.reason)
    if (checked.value.status === 'valid') return failed('v9-records-present')
    const sourceReceipt = checked.value.sourceReceipt
    if (!sourceReceipt) return failed('v8-missing')
    if (!samePublicV9SourceReceipt(expected, sourceReceipt)) return failed('source-changed')
    const source = decodePublicV8Head(sourceReceipt.sourceV8Head)!
    const state = withFreshPublicV9Camps(source.state)
    const head = encodePublicV9Head(state, source.bootstrap, 0)
    const result = await v9.commit(null, null, { saveRevision: 0, value: head }, sourceReceipt)
    return result === 'committed' ? succeeded({ state, saveRevision: 0, sourceReceipt }) : failed(result)
  })
}

export function resumePublicV9(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: V8Store, v9: V9Store,
  expectedRevision: number, expectedSourceReceipt: PublicV9SourceReceipt): Promise<PublicV9Operation<PublicV9Start>> {
  return withLock(locks, async () => {
    if (!isValidPublicV9SourceReceipt(expectedSourceReceipt)) return failed('invalid-expected-source')
    const expected = structuredClone(expectedSourceReceipt)
    const checked = await inspectUnderLock(storage, v8, v9)
    if (!checked.ok) return checked
    if (checked.value.status !== 'valid') return failed(checked.value.status === 'missing'
      ? 'v9-missing' : checked.value.reason)
    const { start } = checked.value
    if (!samePublicV9SourceReceipt(expected, start.sourceReceipt)) return failed('lineage-changed')
    return start.saveRevision === expectedRevision ? succeeded(start) : failed('revision-changed')
  })
}

export function commitPublicV9Snapshot(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: V8Store, v9: V9Store, state: PublicWorldV9State,
  expectedRevision: number, expectedSourceReceipt: PublicV9SourceReceipt): Promise<PublicV9Operation<PublicV9Start>> {
  return withLock(locks, async () => {
    if (!isValidPublicV9SourceReceipt(expectedSourceReceipt)) return failed('invalid-expected-source')
    const expected = structuredClone(expectedSourceReceipt)
    const checked = await inspectUnderLock(storage, v8, v9)
    if (!checked.ok) return checked
    if (checked.value.status !== 'valid') return failed(checked.value.status === 'missing'
      ? 'v9-missing' : checked.value.reason)
    const { start, bootstrap } = checked.value
    if (!samePublicV9SourceReceipt(expected, start.sourceReceipt)) return failed('lineage-changed')
    if (start.saveRevision !== expectedRevision) return failed('revision-changed')
    if (!preservesCampHistory(start.state, state)) return failed('invalid-v9-camp-history')
    const nextRevision = expectedRevision + 1
    let head: ReturnType<typeof encodePublicV9Head>
    try {
      if (identity(state, bootstrap) !== identity(start.state, bootstrap)) return failed('invalid-state')
      head = structuredClone(encodePublicV9Head(state, bootstrap, nextRevision))
    } catch { return failed('invalid-state') }
    const nextState = decodePublicV9Head(head)!.state
    const result = await v9.commit(expectedRevision, start.sourceReceipt, { saveRevision: nextRevision, value: head })
    return result === 'committed'
      ? succeeded({ state: nextState, saveRevision: nextRevision, sourceReceipt: start.sourceReceipt }) : failed(result)
  })
}
