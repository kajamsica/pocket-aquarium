import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicWorldV7State } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { inspectV7SourceForV8 } from './publicWorldV8Source'
import { decodePublicV8Head, encodePublicV8Head } from './publicWorldV8Snapshot'
import type { PublicV8Head } from './publicWorldV8Snapshot'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { createAtomicV8Store } from './atomicV8Database'
import type { AtomicV8Record } from './atomicV8Database'

export type PublicV8Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV8Start = { state: PublicWorldV7State; saveRevision: number; sourceV7Bytes: string }
export type PublicV8Inspection =
  | { status: 'missing' }
  | { status: 'valid'; start: PublicV8Start }
  | { status: 'blocked'; reason: string }

type V8Store = ReturnType<typeof createAtomicV8Store>
export type PublicV8UnderLockInspection = Exclude<PublicV8Inspection, { status: 'valid' }> |
  { status: 'valid'; start: PublicV8Start; bootstrap: PublicV6BootstrapRoot | null;
    head: PublicV8Head; previous: PublicV8Head | null }
const failed = (reason: string): PublicV8Operation<never> => ({ ok: false, reason })
const succeeded = <T,>(value: T): PublicV8Operation<T> => ({ ok: true, value })
const blocked = (reason: string): PublicV8Operation<PublicV8UnderLockInspection> => succeeded({ status: 'blocked', reason })

async function withLock<T>(locks: PublicV7LockProvider | undefined,
  operation: () => Promise<PublicV8Operation<T>>): Promise<PublicV8Operation<T>> {
  if (!locks) return failed('lock-unavailable')
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, operation) }
  catch { return failed('storage-error') }
}

function decodeRecord(record: AtomicV8Record | null) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || Reflect.ownKeys(record).length !== 2
    || !Object.hasOwn(record, 'saveRevision') || !Object.hasOwn(record, 'value')) return null
  const decoded = decodePublicV8Head(record.value)
  return decoded && decoded.saveRevision === record.saveRevision ? decoded : null
}

/** Caller must hold PUBLIC_V7_LOCK_NAME across this fully validated source read and any following CAS.
 * This helper never acquires a nested lock or changes v7/v8 storage. */
export async function inspectPublicV8UnderLock(storage: Pick<Storage, 'getItem'>,
  db: V8Store): Promise<PublicV8Operation<PublicV8UnderLockInspection>> {
  const read = await db.read()
  if (read.status !== 'ok') return failed('storage-error')
  if (read.head === null && read.previous === null && read.lineage === null) return succeeded({ status: 'missing' })
  const head = decodeRecord(read.head)
  if (!head) return blocked('invalid-v8-head')
  if (!read.lineage || typeof read.lineage !== 'object' || Array.isArray(read.lineage)
    || Reflect.ownKeys(read.lineage).length !== 1
    || !Object.hasOwn(read.lineage, 'sourceV7Bytes')
    || typeof read.lineage.sourceV7Bytes !== 'string') return blocked('invalid-v8-lineage')
  const previous = decodeRecord(read.previous)
  if (head.saveRevision === 0 ? read.previous !== null
    : !previous || previous.saveRevision !== head.saveRevision - 1) return blocked('invalid-v8-previous')
  const source = inspectV7SourceForV8(storage, read.lineage.sourceV7Bytes)
  if (source.status !== 'same') return blocked(source.status)
  const identity = (state: PublicWorldV7State, bootstrap: PublicV6BootstrapRoot | null) =>
    JSON.stringify([state.seed, state.generationProfile, bootstrap])
  if (identity(head.state, head.bootstrap) !== identity(source.root.state, source.root.bootstrap)
    || previous && identity(previous.state, previous.bootstrap) !== identity(head.state, head.bootstrap)) {
    return blocked('invalid-v8-lineage')
  }
  if (head.saveRevision === 0 && JSON.stringify(read.head!.value)
    !== JSON.stringify(encodePublicV8Head(source.root.state, source.root.bootstrap, 0))) {
    return blocked('invalid-v8-lineage')
  }
  return succeeded({ status: 'valid',
    start: { state: head.state, saveRevision: head.saveRevision, sourceV7Bytes: read.lineage.sourceV7Bytes },
    bootstrap: head.bootstrap, head: read.head!.value as PublicV8Head,
    previous: read.previous === null ? null : read.previous.value as PublicV8Head })
}

export function inspectPublicV8(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, db: V8Store): Promise<PublicV8Operation<PublicV8Inspection>> {
  return withLock(locks, async () => {
    const checked = await inspectPublicV8UnderLock(storage, db)
    if (!checked.ok) return checked
    return succeeded(checked.value.status === 'valid'
      ? { status: 'valid' as const, start: checked.value.start } : checked.value)
  })
}

export function migratePublicV7ToV8(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, db: V8Store,
  expectedV7Bytes: string): Promise<PublicV8Operation<PublicV8Start>> {
  return withLock(locks, async () => {
    const source = inspectV7SourceForV8(storage, expectedV7Bytes)
    if (source.status !== 'same') return failed(source.status)
    const read = await db.read()
    if (read.status !== 'ok') return failed('storage-error')
    if (read.head !== null || read.previous !== null || read.lineage !== null) return failed('v8-records-present')
    const head = encodePublicV8Head(source.root.state, source.root.bootstrap, 0)
    const result = await db.commit(null, null, { saveRevision: 0, value: head }, { sourceV7Bytes: expectedV7Bytes })
    return result === 'committed'
      ? succeeded({ state: source.root.state, saveRevision: 0, sourceV7Bytes: expectedV7Bytes }) : failed(result)
  })
}

export function resumePublicV8(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, db: V8Store,
  expectedRevision: number): Promise<PublicV8Operation<PublicV8Start>> {
  return withLock(locks, async () => {
    const checked = await inspectPublicV8UnderLock(storage, db)
    if (!checked.ok) return checked
    if (checked.value.status !== 'valid') return failed(checked.value.status === 'missing'
      ? 'v8-missing' : checked.value.reason)
    return checked.value.start.saveRevision === expectedRevision
      ? succeeded(checked.value.start) : failed('revision-changed')
  })
}

export function commitPublicV8Snapshot(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, db: V8Store,
  state: PublicWorldV7State, expectedRevision: number): Promise<PublicV8Operation<PublicV8Start>> {
  return withLock(locks, async () => {
    const checked = await inspectPublicV8UnderLock(storage, db)
    if (!checked.ok) return checked
    if (checked.value.status !== 'valid') return failed(checked.value.status === 'missing'
      ? 'v8-missing' : checked.value.reason)
    const { start, bootstrap } = checked.value
    if (start.saveRevision !== expectedRevision) return failed('revision-changed')
    const nextRevision = expectedRevision + 1
    let head: ReturnType<typeof encodePublicV8Head>
    try { head = encodePublicV8Head(state, bootstrap, nextRevision) }
    catch { return failed('invalid-state') }
    const result = await db.commit(expectedRevision, { sourceV7Bytes: start.sourceV7Bytes },
      { saveRevision: nextRevision, value: head })
    return result === 'committed'
      ? succeeded({ state, saveRevision: nextRevision, sourceV7Bytes: start.sourceV7Bytes }) : failed(result)
  })
}
