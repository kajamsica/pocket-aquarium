import type { createAtomicV8Store } from './atomicV8Database'
import type { createAtomicV9Store } from './atomicV9Database'
import type { AtomicV10Record, createAtomicV10Store } from './atomicV10Database'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { inspectPublicV9UnderLock } from './publicWorldV9Flow'
import { decodePublicV9Head, encodePublicV9Head } from './publicWorldV9Snapshot'
import { decodePublicV10Head, encodePublicV10Head, isValidPublicV10SourceReceipt,
  samePublicV10SourceReceipt } from './publicWorldV10Snapshot'
import type { PublicV10SourceReceipt } from './publicWorldV10Snapshot'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import type { PublicWorldV10State } from './publicWorldV10State'

export type PublicV10Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV10Start = {
  readonly state: PublicWorldV10State
  readonly saveRevision: number
  readonly sourceReceipt: PublicV10SourceReceipt
}
export type PublicV10Inspection =
  | { status: 'missing'; sourceReceipt: PublicV10SourceReceipt | null }
  | { status: 'valid'; start: PublicV10Start }
  | { status: 'blocked'; reason: string }

type V8Store = ReturnType<typeof createAtomicV8Store>
type V9Store = ReturnType<typeof createAtomicV9Store>
type V10Store = ReturnType<typeof createAtomicV10Store>
type Checked = Exclude<PublicV10Inspection, { status: 'valid' }> |
  { status: 'valid'; start: PublicV10Start; bootstrap: PublicV6BootstrapRoot | null }
const failed = (reason: string): PublicV10Operation<never> => ({ ok: false, reason })
const succeeded = <T,>(value: T): PublicV10Operation<T> => ({ ok: true, value })
const blocked = (reason: string): PublicV10Operation<Checked> => succeeded({ status: 'blocked', reason })
const identity = (state: PublicWorldV10State, bootstrap: PublicV6BootstrapRoot | null) =>
  JSON.stringify([state.seed, state.generationProfile, bootstrap])
const preservesCampHistory = (previous: PublicWorldV10State, next: PublicWorldV10State) =>
  previous.fieldCampTileIds.length === 0
  || previous.fieldCampTileIds.length === next.fieldCampTileIds.length
    && previous.fieldCampTileIds.every((id, index) => id === next.fieldCampTileIds[index])
const preservesDigHistory = (previous: PublicWorldV10State, next: PublicWorldV10State) =>
  !previous.mireglass.cacheExcavated || next.mireglass.cacheExcavated

async function withLock<T>(locks: PublicV7LockProvider | undefined,
  operation: () => Promise<PublicV10Operation<T>>): Promise<PublicV10Operation<T>> {
  if (!locks) return failed('lock-unavailable')
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, operation) }
  catch { return failed('storage-error') }
}

function decodeRecord(record: AtomicV10Record | null) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || Reflect.ownKeys(record).length !== 2
    || !Object.hasOwn(record, 'saveRevision') || !Object.hasOwn(record, 'value')) return null
  const decoded = decodePublicV10Head(record.value)
  return decoded && decoded.saveRevision === record.saveRevision ? decoded : null
}

function matchesInitialState(head: NonNullable<ReturnType<typeof decodeRecord>>, source: PublicV10SourceReceipt) {
  const { terrainRevision, ...v9State } = head.state
  return terrainRevision === 'mireglass-cache-pit-v1' && samePublicV10SourceReceipt(source, {
    sourceV9Head: encodePublicV9Head(v9State, head.bootstrap, source.sourceV9Head.saveRevision),
    sourceV9Lineage: source.sourceV9Lineage,
  })
}

/** The caller already holds the shared v7 Web Lock; no nested lock is requested. */
export async function inspectPublicV10UnderLock(storage: Pick<Storage, 'getItem'>, v8: V8Store, v9: V9Store,
  v10: V10Store): Promise<PublicV10Operation<Checked>> {
  const read = await v10.read()
  if (read.status !== 'ok') return failed('storage-error')
  const missing = read.head === null && read.previous === null && read.lineage === null
  const head = decodeRecord(read.head)
  const previous = decodeRecord(read.previous)
  if (!missing) {
    if (!head) return blocked('invalid-v10-head')
    if (!isValidPublicV10SourceReceipt(read.lineage)) return blocked('invalid-v10-lineage')
    if (head.saveRevision === 0 ? read.previous !== null
      : !previous || previous.saveRevision !== head.saveRevision - 1) return blocked('invalid-v10-previous')
    const source = decodePublicV9Head(read.lineage.sourceV9Head)!
    const sourceState = withPublicV10TerrainRevision(source.state)
    if (identity(head.state, head.bootstrap) !== identity(sourceState, source.bootstrap)
      || head.saveRevision === 0 && !matchesInitialState(head, read.lineage)
      || !preservesCampHistory(sourceState, head.state)
      || !preservesDigHistory(sourceState, head.state)) return blocked('invalid-v10-lineage')
    if (previous && (identity(previous.state, previous.bootstrap) !== identity(head.state, head.bootstrap)
      || previous.saveRevision === 0 && !matchesInitialState(previous, read.lineage)
      || !preservesCampHistory(sourceState, previous.state)
      || !preservesDigHistory(sourceState, previous.state))) return blocked('invalid-v10-previous')
    if (previous && !preservesCampHistory(previous.state, head.state)) return blocked('invalid-v10-camp-history')
    if (previous && !preservesDigHistory(previous.state, head.state)) return blocked('invalid-v10-dig-history')
  }
  const current = await inspectPublicV9UnderLock(storage, v8, v9)
  if (!current.ok) return current
  if (current.value.status === 'blocked') return blocked(current.value.reason)
  if (current.value.status === 'missing') return missing
    ? succeeded({ status: 'missing', sourceReceipt: null }) : blocked('v9-missing')
  const sourceReceipt = structuredClone({ sourceV9Head: current.value.head,
    sourceV9Lineage: current.value.start.sourceReceipt })
  if (!isValidPublicV10SourceReceipt(sourceReceipt)) return blocked('invalid-v9-lineage')
  if (missing) return succeeded({ status: 'missing', sourceReceipt })
  if (!samePublicV10SourceReceipt(read.lineage, sourceReceipt)) return blocked('source-changed')
  return succeeded({ status: 'valid', bootstrap: head!.bootstrap,
    start: { state: head!.state, saveRevision: head!.saveRevision, sourceReceipt } })
}

export function inspectPublicV10(storage: Pick<Storage, 'getItem'>, locks: PublicV7LockProvider | undefined,
  v8: V8Store, v9: V9Store, v10: V10Store): Promise<PublicV10Operation<PublicV10Inspection>> {
  return withLock(locks, async () => {
    const checked = await inspectPublicV10UnderLock(storage, v8, v9, v10)
    if (!checked.ok) return checked
    return succeeded(checked.value.status === 'valid'
      ? { status: 'valid' as const, start: checked.value.start } : checked.value)
  })
}

export function migratePublicV9ToV10(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: V8Store, v9: V9Store, v10: V10Store,
  expectedSourceReceipt: PublicV10SourceReceipt): Promise<PublicV10Operation<PublicV10Start>> {
  return withLock(locks, async () => {
    if (!isValidPublicV10SourceReceipt(expectedSourceReceipt)) return failed('invalid-expected-source')
    const expected = structuredClone(expectedSourceReceipt)
    const checked = await inspectPublicV10UnderLock(storage, v8, v9, v10)
    if (!checked.ok) return checked
    if (checked.value.status === 'blocked') return failed(checked.value.reason)
    if (checked.value.status === 'valid') return failed('v10-records-present')
    const sourceReceipt = checked.value.sourceReceipt
    if (!sourceReceipt) return failed('v9-missing')
    if (!samePublicV10SourceReceipt(expected, sourceReceipt)) return failed('source-changed')
    const source = decodePublicV9Head(sourceReceipt.sourceV9Head)!
    const state = withPublicV10TerrainRevision(source.state)
    const head = encodePublicV10Head(state, source.bootstrap, 0)
    const result = await v10.commit(null, null, { saveRevision: 0, value: head }, sourceReceipt)
    return result === 'committed' ? succeeded({ state, saveRevision: 0, sourceReceipt }) : failed(result)
  })
}

export function resumePublicV10(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: V8Store, v9: V9Store, v10: V10Store,
  expectedRevision: number, expectedSourceReceipt: PublicV10SourceReceipt): Promise<PublicV10Operation<PublicV10Start>> {
  return withLock(locks, async () => {
    if (!isValidPublicV10SourceReceipt(expectedSourceReceipt)) return failed('invalid-expected-source')
    const expected = structuredClone(expectedSourceReceipt)
    const checked = await inspectPublicV10UnderLock(storage, v8, v9, v10)
    if (!checked.ok) return checked
    if (checked.value.status !== 'valid') return failed(checked.value.status === 'missing'
      ? 'v10-missing' : checked.value.reason)
    const { start } = checked.value
    if (!samePublicV10SourceReceipt(expected, start.sourceReceipt)) return failed('lineage-changed')
    return start.saveRevision === expectedRevision ? succeeded(start) : failed('revision-changed')
  })
}

export function commitPublicV10Snapshot(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: V8Store, v9: V9Store, v10: V10Store,
  state: PublicWorldV10State, expectedRevision: number,
  expectedSourceReceipt: PublicV10SourceReceipt): Promise<PublicV10Operation<PublicV10Start>> {
  return withLock(locks, async () => {
    if (!isValidPublicV10SourceReceipt(expectedSourceReceipt)) return failed('invalid-expected-source')
    const expected = structuredClone(expectedSourceReceipt)
    const checked = await inspectPublicV10UnderLock(storage, v8, v9, v10)
    if (!checked.ok) return checked
    if (checked.value.status !== 'valid') return failed(checked.value.status === 'missing'
      ? 'v10-missing' : checked.value.reason)
    const { start, bootstrap } = checked.value
    if (!samePublicV10SourceReceipt(expected, start.sourceReceipt)) return failed('lineage-changed')
    if (start.saveRevision !== expectedRevision) return failed('revision-changed')
    if (!preservesCampHistory(start.state, state)) return failed('invalid-v10-camp-history')
    if (!preservesDigHistory(start.state, state)) return failed('invalid-v10-dig-history')
    const nextRevision = expectedRevision + 1
    let head: ReturnType<typeof encodePublicV10Head>
    try {
      if (identity(state, bootstrap) !== identity(start.state, bootstrap)) return failed('invalid-state')
      head = structuredClone(encodePublicV10Head(state, bootstrap, nextRevision))
    } catch { return failed('invalid-state') }
    const nextState = decodePublicV10Head(head)!.state
    const result = await v10.commit(expectedRevision, start.sourceReceipt, { saveRevision: nextRevision, value: head })
    return result === 'committed'
      ? succeeded({ state: nextState, saveRevision: nextRevision, sourceReceipt: start.sourceReceipt }) : failed(result)
  })
}
