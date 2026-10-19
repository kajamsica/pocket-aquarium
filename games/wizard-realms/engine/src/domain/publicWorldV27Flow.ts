import type { createAtomicV17Store } from './atomicV17Database'
import type { createAtomicV23Store } from './atomicV23Database'
import type { createAtomicV24Store } from './atomicV24Database'
import type { createAtomicV25Store } from './atomicV25Database'
import type { createAtomicV26Store } from './atomicV26Database'
import type { createAtomicV27Store, AtomicV27Read } from './atomicV27Database'
import { samePublicV14Value } from './publicWorldV14Validation'
import { inspectPublicV25UnderLock } from './publicWorldV25Flow'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { decodePublicV27Lineage, decodePublicV27SourceReceipt } from './publicWorldV27Migration'
import type { PublicV27Lineage, PublicV27SourceReceipt } from './publicWorldV27Migration'
import { createPublicV27Root, decodePublicV27Witness, replayPublicV27Witness } from './publicWorldV27Snapshot'
import type { PublicV27Head, PublicV27Witness } from './publicWorldV27Snapshot'

type Store = ReturnType<typeof createAtomicV27Store>
type V26Store = ReturnType<typeof createAtomicV26Store>
type V25Store = ReturnType<typeof createAtomicV25Store>
type V24Store = ReturnType<typeof createAtomicV24Store>
type V23Store = ReturnType<typeof createAtomicV23Store>
type V17Store = ReturnType<typeof createAtomicV17Store>
export type PublicV27Start = Readonly<{ head: PublicV27Head; lineage: PublicV27Lineage }>
export type PublicV27Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV27Inspection = { status: 'migration-available'; sourceReceipt: PublicV27SourceReceipt }
  | { status: 'valid'; start: PublicV27Start }
  | { status: 'blocked'; reason: string }
type Checked = { status: 'missing'; target: Extract<AtomicV27Read, { status: 'missing' }>;
    sourceReceipt: PublicV27SourceReceipt }
  | { status: 'valid'; target: Extract<AtomicV27Read, { status: 'valid' }>;
    start: PublicV27Start }
  | { status: 'blocked'; reason: string }

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV27Operation<T>>): Promise<PublicV27Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}

/** One lock checks the target, complete V26 root, and V26's pinned live V25 chain. */
async function inspectUnderLock(store: Store, v26Store: V26Store, v25Store: V25Store,
  v24Store: V24Store, v23Store: V23Store, v17Store: V17Store): Promise<Checked> {
  const target = await store.readChecked()
  const source = await v26Store.readChecked()
  const upstream = await inspectPublicV25UnderLock(v25Store, v24Store, v23Store, v17Store)
  if (target.status === 'blocked') return target
  if (source.status === 'blocked') return { status: 'blocked', reason: `source-${source.reason}` }
  if (upstream.status === 'blocked') return { status: 'blocked',
    reason: upstream.reason.startsWith('source-') ? upstream.reason : `source-${upstream.reason}` }
  if (upstream.status !== 'valid') return { status: 'blocked', reason: 'source-v25-missing' }
  if (source.status !== 'valid') return { status: 'blocked', reason: 'source-v26-missing' }
  if (!samePublicV14Value(source.root.lineage.sourceReceipt,
    { head: upstream.start.head, lineage: upstream.start.lineage }))
    return { status: 'blocked', reason: 'source-v26-source-changed' }
  const sourceReceipt = { head: source.root.head, lineage: source.root.lineage }
  if (target.status === 'missing') return { status: 'missing', target, sourceReceipt }
  if (!samePublicV14Value(target.root.lineage.sourceReceipt, sourceReceipt))
    return { status: 'blocked', reason: 'source-changed' }
  return { status: 'valid', target,
    start: { head: target.root.head, lineage: target.root.lineage } }
}

export function inspectPublicV27(locks: PublicV7LockProvider | undefined, store: Store,
  v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store): Promise<PublicV27Operation<PublicV27Inspection>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v26Store, v25Store, v24Store, v23Store, v17Store)
    const value: PublicV27Inspection = checked.status === 'missing'
      ? { status: 'migration-available', sourceReceipt: checked.sourceReceipt }
      : checked.status === 'valid' ? { status: 'valid', start: checked.start } : checked
    return { ok: true, value }
  })
}

export function startPublicV27(locks: PublicV7LockProvider | undefined, store: Store,
  v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  seed: string, expectedSource: PublicV27SourceReceipt): Promise<PublicV27Operation<PublicV27Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128)
    return Promise.resolve({ ok: false, reason: 'invalid-seed' })
  const expected = decodePublicV27SourceReceipt(expectedSource)
  if (!expected || expected.head.state.seed !== seed)
    return Promise.resolve({ ok: false, reason: 'invalid-source' })
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v26Store, v25Store, v24Store, v23Store, v17Store)
    if (checked.status === 'blocked') return { ok: false, reason: checked.reason }
    if (checked.status === 'valid') return { ok: false, reason: 'target-conflict' }
    if (!samePublicV14Value(checked.sourceReceipt, expected))
      return { ok: false, reason: 'source-changed' }
    let fresh: ReturnType<typeof createPublicV27Root>
    try { fresh = createPublicV27Root(expected) }
    catch { return { ok: false, reason: 'source-unplaceable' } }
    const write = await store.commit(checked.target.proof, fresh)
    return write === 'committed' ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: write }
  })
}

export function resumePublicV27(locks: PublicV7LockProvider | undefined, store: Store,
  v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV27Operation<PublicV27Start>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v26Store, v25Store, v24Store, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    if (!samePublicV14Value(decodePublicV27Lineage(rawLineage), checked.start.lineage))
      return { ok: false, reason: 'lineage-changed' }
    return checked.start.head.saveRevision === revision
      ? { ok: true, value: checked.start } : { ok: false, reason: 'revision-changed' }
  })
}

async function commitWitnessUnderLock(store: Store, v26Store: V26Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown, witnessFromWriter: () => unknown,
  returnHome: boolean): Promise<PublicV27Operation<PublicV27Start>> {
  try {
    const checked = await inspectUnderLock(store, v26Store, v25Store, v24Store, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    const { head, lineage } = checked.start
    if (!samePublicV14Value(decodePublicV27Lineage(rawLineage), lineage))
      return { ok: false, reason: 'lineage-changed' }
    if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
    if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: 'invalid-revision' }
    const decoded = decodePublicV27Witness(witnessFromWriter())
    if (!decoded || (decoded.kind === 'return-home/v1') !== returnHome)
      return { ok: false, reason: 'invalid-witness' }
    const before = { state: head.state, greenwayWorks: head.greenwayWorks,
      regionalWorks: head.regionalWorks, terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs }
    const replayed = replayPublicV27Witness(before, decoded)
    if (!replayed) {
      if (returnHome && decoded.kind === 'return-home/v1') {
        const reason = applyPublicV26ReturnHome(before, decoded.atMs).rejection
        if (reason === 'not_trapped' || reason === 'cooldown') return { ok: false, reason }
      }
      return { ok: false, reason: 'frame-rejected' }
    }
    const next: PublicV27Head = { ...head, ...replayed, saveRevision: revision + 1,
      witness: structuredClone(decoded) }
    const write = await store.commit(checked.target.proof,
      { lineage, previous: head, head: next })
    return write === 'committed' ? { ok: true, value: { head: next, lineage } }
      : { ok: false, reason: write }
  } catch { return { ok: false, reason: 'storage-error' } }
}

export function commitPublicV27(locks: PublicV7LockProvider | undefined, store: Store,
  v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown, witness: PublicV27Witness):
  Promise<PublicV27Operation<PublicV27Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, v26Store, v25Store, v24Store, v23Store,
    v17Store, revision, rawLineage, () => witness, false))
}

/** Rescue time comes from the local writer clock after live source and CAS checks. */
export function requestPublicV27ReturnHome(locks: PublicV7LockProvider | undefined, store: Store,
  v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV27Operation<PublicV27Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, v26Store, v25Store, v24Store, v23Store,
    v17Store, revision, rawLineage, () => ({ kind: 'return-home/v1', atMs: Date.now() }), true))
}
