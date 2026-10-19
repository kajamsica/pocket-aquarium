import type { createAtomicV13Store } from './atomicV13Database'
import { isValidDiscoveryMask } from './discoveryMask'
import { preservesPublicV13History as preservesHistory } from './publicV13History'
import { publicBootPurchaseCandidate } from './publicBootPurchase'
import { confirmCompactPublicTerrainWork } from './publicTerrainWorkAction'
import type { PublicTerrainWorkEvent } from './publicTerrainWorkAction'
import type { PublicWorldEvent } from './publicWorldRuntime'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { cloneBoundedPublicV13SourceShape, cloneBoundedPublicV13StateShape,
  createPublicV13MigrationHeadWithSource, decodePublicV13HeadWithSource,
  decodePublicV13SourceLineage, PUBLIC_V13_SCHEMA } from './publicWorldV13Snapshot'
import type { PublicV13Head, PublicV13SourceLineage } from './publicWorldV13Snapshot'
import { resolvePublicV13SourceLease } from './publicWorldV13SourceReader'
import type { createPublicV13SourceReader, PublicV13SourceLease } from './publicWorldV13SourceReader'

type Reader = ReturnType<typeof createPublicV13SourceReader>
type Store = ReturnType<typeof createAtomicV13Store>
export type PublicV13Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV13Start = {
  readonly state: PublicV13Head['state']; readonly bootstrap: PublicV6BootstrapRoot | null
  readonly saveRevision: number; readonly sourceLineage: PublicV13SourceLineage
}
export type PublicV13Inspection =
  | { status: 'missing'; sourceLineage: PublicV13SourceLineage | null }
  | { status: 'valid'; start: PublicV13Start }
  | { status: 'blocked'; reason: string }

const failed = (reason: string): PublicV13Operation<never> => ({ ok: false, reason })
const succeeded = <T,>(value: T): PublicV13Operation<T> => ({ ok: true, value })
const blocked = (reason: string): PublicV13Operation<PublicV13Inspection> =>
  succeeded({ status: 'blocked', reason })
const sameIds = (before: readonly string[], after: readonly string[]) =>
  before.length === after.length && before.every((id, index) => id === after[index])

/** Compare bounded validated source trees without JSON's signed-zero collapse. */
function sameSource(a: unknown, b: unknown): boolean {
  try {
    const pending: [unknown, unknown][] = [[a, b]]
    let visited = 0
    while (pending.length) {
      if (++visited > 100_000) return false
      const [left, right] = pending.pop()!
      if (Object.is(left, right)) continue
      if (typeof left !== typeof right || left === null || right === null
        || typeof left !== 'object' || typeof right !== 'object') return false
      if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
        if (!isValidDiscoveryMask(left) || !isValidDiscoveryMask(right)
          || !left.every((byte, index) => byte === right[index])) return false
        continue
      }
      const prototype = Object.getPrototypeOf(left)
      if (prototype !== Object.getPrototypeOf(right)
        || prototype !== (Array.isArray(left) ? Array.prototype : Object.prototype)) return false
      const keys = Reflect.ownKeys(left), other = Reflect.ownKeys(right)
      if (keys.length !== other.length) return false
      for (let index = 0; index < keys.length; index++) {
        if (keys[index] !== other[index]) return false
        const l = Object.getOwnPropertyDescriptor(left, keys[index])
        const r = Object.getOwnPropertyDescriptor(right, keys[index])
        if (!l || !r || !Object.hasOwn(l, 'value') || !Object.hasOwn(r, 'value')
          || l.enumerable !== r.enumerable || l.configurable !== r.configurable
          || l.writable !== r.writable) return false
        pending.push([l.value, r.value])
      }
    }
    return true
  } catch { return false }
}

function decodeRecord(value: unknown, lease: PublicV13SourceLease): PublicV13Head | null {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== 2) return null
    const revision = Object.getOwnPropertyDescriptor(value, 'saveRevision')
    const head = Object.getOwnPropertyDescriptor(value, 'value')
    if (!revision?.enumerable || !Object.hasOwn(revision, 'value')
      || !head?.enumerable || !Object.hasOwn(head, 'value')
      || !Number.isSafeInteger(revision.value) || revision.value < 0) return null
    const decoded = decodePublicV13HeadWithSource(head.value, lease)
    return decoded?.saveRevision === revision.value ? decoded : null
  } catch { return null }
}

type CheckedRecords = { status: 'missing'; proof: object }
  | { status: 'valid'; head: PublicV13Head; sourceZero: PublicV13Head; proof: object }
  | { status: 'blocked' | 'storage-error'; reason: string }
/** Bound raw slots are decoded anew; advisory decoded fields confer no authority. */
async function checkedRecords(store: Store, lease: PublicV13SourceLease): Promise<CheckedRecords> {
  const read = await store.readCheckedWithSource(lease)
  if (read.status !== 'ok') return { status: 'storage-error', reason: 'storage-error' }
  if (!read.proof) return { status: 'blocked', reason: 'invalid-v13-records' }
  if (read.head === null && read.previous === null && read.lineage === null) {
    return { status: 'missing', proof: read.proof }
  }
  if (read.head === null || read.lineage === null) {
    return { status: 'blocked', reason: 'invalid-v13-records' }
  }
  const head = decodeRecord(read.head, lease)
  const previous = read.previous === null ? null : decodeRecord(read.previous, lease)
  const sourceZero = createPublicV13MigrationHeadWithSource(lease)
  if (!head || !sourceZero
    || (head.saveRevision === 0 ? read.previous !== null
      : !previous || previous.saveRevision !== head.saveRevision - 1)
    || !preservesHistory(sourceZero.state, head.state)
    || previous && !preservesHistory(sourceZero.state, previous.state)
    || previous && !preservesHistory(previous.state, head.state)) {
    return { status: 'blocked', reason: 'invalid-v13-history' }
  }
  return { status: 'valid', head, sourceZero, proof: read.proof }
}

function start(head: PublicV13Head, sourceLineage: PublicV13SourceLineage): PublicV13Start {
  return { state: structuredClone(head.state), bootstrap: structuredClone(head.bootstrap),
    saveRevision: head.saveRevision, sourceLineage: structuredClone(sourceLineage) }
}

async function withLock<T>(locks: PublicV7LockProvider | undefined,
  operation: () => Promise<PublicV13Operation<T>>): Promise<PublicV13Operation<T>> {
  if (!locks) return failed('lock-unavailable')
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, operation) }
  catch { return failed('storage-error') }
}

type Selected = { status: 'selected'; lease: PublicV13SourceLease;
  sourceLineage: PublicV13SourceLineage }
  | { status: 'missing' | 'blocked' | 'storage-error'; reason?: string }

/** Caller holds the exclusive v7 lock. No await or callback separates read and proof consumption. */
async function selectUnderLock(reader: Reader): Promise<Selected> {
  const result = await reader.readUnderLock()
  if (!result.ok) return { status: 'storage-error' }
  if (result.value.status === 'missing') return { status: 'missing' }
  if (result.value.status === 'blocked') return { status: 'blocked', reason: result.value.reason }
  const lease = reader.consumeProof(result.value.proof)
  if (!lease) return { status: 'storage-error' }
  const sourceLineage = resolvePublicV13SourceLease(lease)
  if (!sourceLineage) { reader.revoke(lease); return { status: 'storage-error' } }
  return { status: 'selected', lease, sourceLineage }
}

/** Read-only v13 inspection. Advisory decoded store fields never establish validity. */
export function inspectPublicV13(locks: PublicV7LockProvider | undefined,
  reader: Reader, store: Store): Promise<PublicV13Operation<PublicV13Inspection>> {
  return withLock<PublicV13Inspection>(locks, async () => {
    const selected = await selectUnderLock(reader)
    if (selected.status === 'storage-error') return failed('storage-error')
    if (selected.status === 'blocked') return blocked(selected.reason ?? 'invalid-source')
    if (selected.status === 'missing') {
      const read = await store.read()
      if (read.status !== 'ok') return failed('storage-error')
      return read.head === null && read.previous === null && read.lineage === null
        ? succeeded({ status: 'missing', sourceLineage: null }) : blocked('source-missing')
    }
    if (selected.status !== 'selected') return failed('storage-error')
    const { lease, sourceLineage } = selected
    try {
      const read = await checkedRecords(store, lease)
      if (read.status === 'storage-error') return failed(read.reason)
      if (read.status === 'blocked') return blocked(read.reason)
      if (read.status === 'missing') {
        return succeeded({ status: 'missing', sourceLineage })
      }
      if (read.status !== 'valid') return failed('storage-error')
      return succeeded({ status: 'valid', start: start(read.head, sourceLineage) })
    } finally { reader.revoke(lease) }
  })
}

/** Resume only the caller's current checked revision and source; never write or migrate. */
export function resumePublicV13(locks: PublicV7LockProvider | undefined,
  reader: Reader, store: Store, expectedRevision: number,
  expectedSourceLineage: unknown): Promise<PublicV13Operation<PublicV13Start>> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return Promise.resolve(failed('invalid-revision'))
  }
  const expected = cloneBoundedPublicV13SourceShape(expectedSourceLineage)
  if (!expected) return Promise.resolve(failed('invalid-expected-source'))
  return withLock(locks, async () => {
    const selected = await selectUnderLock(reader)
    if (selected.status !== 'selected') return failed(selected.status === 'missing'
      ? 'source-missing' : selected.reason ?? 'storage-error')
    const { lease, sourceLineage } = selected
    try {
      if (!sameSource(sourceLineage, expected)) return failed('source-changed')
      const checked = await checkedRecords(store, lease)
      if (checked.status !== 'valid') return failed(checked.status === 'missing'
        ? 'v13-missing' : checked.reason)
      if (checked.head.saveRevision !== expectedRevision) return failed('revision-changed')
      return succeeded(start(checked.head, sourceLineage))
    } finally { reader.revoke(lease) }
  })
}

/** One-time additive v11/v12 migration; no older slot is written. */
export function migratePublicSourceToV13(locks: PublicV7LockProvider | undefined,
  reader: Reader, store: Store, expectedSource: unknown): Promise<PublicV13Operation<PublicV13Start>> {
  // Capture untrusted expectations before an asynchronous lock wait.
  const expected = decodePublicV13SourceLineage(expectedSource)
  if (!expected) return Promise.resolve(failed('invalid-expected-source'))
  return withLock(locks, async () => {
    const selected = await selectUnderLock(reader)
    if (selected.status !== 'selected') return failed(selected.status === 'missing'
      ? 'source-missing' : selected.reason ?? 'storage-error')
    const { lease, sourceLineage } = selected
    try {
      if (!sameSource(sourceLineage, expected)) return failed('source-changed')
      const read = await store.readCheckedWithSource(lease)
      if (read.status !== 'ok') return failed('storage-error')
      if (!read.proof) return failed('invalid-v13-records')
      if (read.head !== null || read.previous !== null || read.lineage !== null) {
        return failed('v13-records-present')
      }
      const head = createPublicV13MigrationHeadWithSource(lease)
      if (!head) return failed('invalid-source')
      const result = await store.commitWithSource(lease, null,
        { saveRevision: 0, value: head }, read.proof)
      return result === 'committed' ? succeeded(start(head, sourceLineage)) : failed(result)
    } finally { reader.revoke(lease) }
  })
}

/** Generic saves preserve works; only a future recomputed work intent may change that ledger. */
export function commitPublicV13Snapshot(locks: PublicV7LockProvider | undefined,
  reader: Reader, store: Store, nextCompactState: unknown, expectedRevision: number,
  expectedSourceLineage: unknown): Promise<PublicV13Operation<PublicV13Start>> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !Number.isSafeInteger(expectedRevision + 1)) return Promise.resolve(failed('invalid-revision'))
  const next = cloneBoundedPublicV13StateShape(nextCompactState)
  if (!next) return Promise.resolve(failed('invalid-state'))
  const expected = cloneBoundedPublicV13SourceShape(expectedSourceLineage)
  if (!expected) return Promise.resolve(failed('invalid-expected-source'))
  return withLock(locks, async () => {
    const selected = await selectUnderLock(reader)
    if (selected.status !== 'selected') return failed(selected.status === 'missing'
      ? 'source-missing' : selected.reason ?? 'storage-error')
    const { lease, sourceLineage } = selected
    try {
      if (!sameSource(sourceLineage, expected)) return failed('source-changed')
      const checked = await checkedRecords(store, lease)
      if (checked.status !== 'valid') return failed(checked.status === 'missing'
        ? 'v13-missing' : checked.reason)
      if (checked.head.saveRevision !== expectedRevision) return failed('revision-changed')
      const head = decodePublicV13HeadWithSource({ schemaVersion: PUBLIC_V13_SCHEMA,
        saveRevision: expectedRevision + 1, bootstrap: checked.head.bootstrap, state: next }, lease)
      if (!head) return failed('invalid-state')
      const oldWorks = checked.head.state.terrainWorks, newWorks = head.state.terrainWorks
      if (!sameIds(oldWorks.builtWorkIds, newWorks.builtWorkIds)
        || !sameIds(oldWorks.dugTileIds, newWorks.dugTileIds)) return failed('terrain-works-changed')
      if (!preservesHistory(checked.head.state, head.state)
        || !preservesHistory(checked.sourceZero.state, head.state)) return failed('invalid-v13-history')
      const result = await store.commitWithSource(lease, expectedRevision,
        { saveRevision: head.saveRevision, value: head }, checked.proof)
      return result === 'committed' ? succeeded(start(head, sourceLineage)) : failed(result)
    } finally { reader.revoke(lease) }
  })
}

/** The only v13 work writer: recompute from the checked head while holding the source lock. */
export function commitPublicV13TerrainWork(locks: PublicV7LockProvider | undefined,
  reader: Reader, store: Store, id: unknown, expectedRevision: number,
  expectedSourceLineage: unknown): Promise<PublicV13Operation<{
    start: PublicV13Start; event: PublicTerrainWorkEvent
  }>> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !Number.isSafeInteger(expectedRevision + 1)) return Promise.resolve(failed('invalid-revision'))
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    return Promise.resolve(failed('invalid_site'))
  }
  const expected = cloneBoundedPublicV13SourceShape(expectedSourceLineage)
  if (!expected) return Promise.resolve(failed('invalid-expected-source'))
  return withLock(locks, async () => {
    const selected = await selectUnderLock(reader)
    if (selected.status !== 'selected') return failed(selected.status === 'missing'
      ? 'source-missing' : selected.reason ?? 'storage-error')
    const { lease, sourceLineage } = selected
    try {
      if (!sameSource(sourceLineage, expected)) return failed('source-changed')
      const checked = await checkedRecords(store, lease)
      if (checked.status !== 'valid') return failed(checked.status === 'missing'
        ? 'v13-missing' : checked.reason)
      if (checked.head.saveRevision !== expectedRevision) return failed('revision-changed')
      const candidate = confirmCompactPublicTerrainWork(checked.head, lease, id)
      if (candidate.rejection || !candidate.head || !candidate.event) {
        return failed(candidate.rejection ?? 'invalid_progress')
      }
      if (candidate.head.saveRevision !== expectedRevision + 1
        || !preservesHistory(checked.head.state, candidate.head.state)
        || !preservesHistory(checked.sourceZero.state, candidate.head.state)) {
        return failed('invalid-v13-history')
      }
      const result = await store.commitWithSource(lease, expectedRevision,
        { saveRevision: candidate.head.saveRevision, value: candidate.head }, checked.proof)
      return result === 'committed' ? succeeded({ start: start(candidate.head, sourceLineage),
        event: candidate.event }) : failed(result)
    } finally { reader.revoke(lease) }
  })
}

/** Virtual Outfitters offer, recomputed from the checked v13 head under the source lock. */
export function commitPublicV13BootPurchase(locks: PublicV7LockProvider | undefined,
  reader: Reader, store: Store, storeId: unknown, expectedRevision: number,
  expectedSourceLineage: unknown): Promise<PublicV13Operation<{
    start: PublicV13Start; event: Extract<PublicWorldEvent, { type: 'store_item_bought' }>
  }>> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !Number.isSafeInteger(expectedRevision + 1)) return Promise.resolve(failed('invalid-revision'))
  if (typeof storeId !== 'string' || storeId.length === 0 || storeId.length > 128) {
    return Promise.resolve(failed('invalid-store'))
  }
  const expected = cloneBoundedPublicV13SourceShape(expectedSourceLineage)
  if (!expected) return Promise.resolve(failed('invalid-expected-source'))
  return withLock(locks, async () => {
    const selected = await selectUnderLock(reader)
    if (selected.status !== 'selected') return failed(selected.status === 'missing'
      ? 'source-missing' : selected.reason ?? 'storage-error')
    const { lease, sourceLineage } = selected
    try {
      if (!sameSource(sourceLineage, expected)) return failed('source-changed')
      const checked = await checkedRecords(store, lease)
      if (checked.status !== 'valid') return failed(checked.status === 'missing'
        ? 'v13-missing' : checked.reason)
      if (checked.head.saveRevision !== expectedRevision) return failed('revision-changed')
      const purchase = publicBootPurchaseCandidate(checked.head.state, storeId)
      if ('rejection' in purchase) return failed(purchase.rejection)
      const candidate = decodePublicV13HeadWithSource({ schemaVersion: PUBLIC_V13_SCHEMA,
        saveRevision: expectedRevision + 1, bootstrap: checked.head.bootstrap,
        state: { ...checked.head.state, player: purchase.player,
          eventSequence: purchase.eventSequence } }, lease)
      if (!candidate || !preservesHistory(checked.head.state, candidate.state)
        || !preservesHistory(checked.sourceZero.state, candidate.state)) {
        return failed('invalid-v13-history')
      }
      const result = await store.commitWithSource(lease, expectedRevision,
        { saveRevision: candidate.saveRevision, value: candidate }, checked.proof)
      return result === 'committed' ? succeeded({ start: start(candidate, sourceLineage),
        event: purchase.event }) : failed(result)
    } finally { reader.revoke(lease) }
  })
}
