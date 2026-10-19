import type { createAtomicV17Store } from './atomicV17Database'
import type { createAtomicV23Store } from './atomicV23Database'
import type { createAtomicV24Store } from './atomicV24Database'
import type { createAtomicV25Store } from './atomicV25Database'
import type { createAtomicV26Store, AtomicV26Read } from './atomicV26Database'
import { samePublicV14Value } from './publicWorldV14Validation'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { inspectPublicV25UnderLock } from './publicWorldV25Flow'
import { decodePublicV26Lineage, decodePublicV26SourceReceipt } from './publicWorldV26Migration'
import type { PublicV26Lineage, PublicV26SourceReceipt } from './publicWorldV26Migration'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { createPublicV26Root, decodePublicV26Witness, replayPublicV26Witness } from './publicWorldV26Snapshot'
import type { PublicV26Head, PublicV26Witness } from './publicWorldV26Snapshot'

type Store = ReturnType<typeof createAtomicV26Store>
type V25Store = ReturnType<typeof createAtomicV25Store>
type V24Store = ReturnType<typeof createAtomicV24Store>
type V23Store = ReturnType<typeof createAtomicV23Store>
type V17Store = ReturnType<typeof createAtomicV17Store>
export type PublicV26Start = Readonly<{ head: PublicV26Head; lineage: PublicV26Lineage }>
export type PublicV26Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV26Inspection = { status: 'migration-available'; sourceReceipt: PublicV26SourceReceipt }
  | { status: 'valid'; start: PublicV26Start }
  | { status: 'blocked'; reason: string }
type Checked = { status: 'missing'; target: Extract<AtomicV26Read, { status: 'missing' }>;
    sourceReceipt: PublicV26SourceReceipt }
  | { status: 'valid'; target: Extract<AtomicV26Read, { status: 'valid' }>;
    start: PublicV26Start }
  | { status: 'blocked'; reason: string }

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV26Operation<T>>): Promise<PublicV26Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}

/** Caller owns the sole world lock while the V26 root and complete V25 chain are read. */
async function inspectUnderLock(store: Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store): Promise<Checked> {
  const target = await store.readChecked()
  const source = await inspectPublicV25UnderLock(v25Store, v24Store, v23Store, v17Store)
  if (target.status === 'blocked') return target
  if (source.status === 'blocked') return { status: 'blocked',
    reason: source.reason.startsWith('source-') ? source.reason : `source-${source.reason}` }
  if (source.status !== 'valid') return { status: 'blocked', reason: 'source-v25-missing' }
  const sourceReceipt = { head: source.start.head, lineage: source.start.lineage }
  if (target.status === 'missing') return { status: 'missing', target, sourceReceipt }
  if (!samePublicV14Value(target.root.lineage.sourceReceipt, sourceReceipt))
    return { status: 'blocked', reason: 'source-changed' }
  return { status: 'valid', target,
    start: { head: target.root.head, lineage: target.root.lineage } }
}

export function inspectPublicV26(locks: PublicV7LockProvider | undefined, store: Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store):
  Promise<PublicV26Operation<PublicV26Inspection>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v25Store, v24Store, v23Store, v17Store)
    const value: PublicV26Inspection = checked.status === 'missing'
      ? { status: 'migration-available', sourceReceipt: checked.sourceReceipt }
      : checked.status === 'valid' ? { status: 'valid', start: checked.start } : checked
    return { ok: true, value }
  })
}

export function startPublicV26(locks: PublicV7LockProvider | undefined, store: Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  seed: string, expectedSource: PublicV26SourceReceipt): Promise<PublicV26Operation<PublicV26Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128)
    return Promise.resolve({ ok: false, reason: 'invalid-seed' })
  const expected = decodePublicV26SourceReceipt(expectedSource)
  if (!expected || expected.head.state.seed !== seed)
    return Promise.resolve({ ok: false, reason: 'invalid-source' })
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v25Store, v24Store, v23Store, v17Store)
    if (checked.status === 'blocked') return { ok: false, reason: checked.reason }
    if (checked.status === 'valid') return { ok: false, reason: 'target-conflict' }
    if (!samePublicV14Value(checked.sourceReceipt, expected))
      return { ok: false, reason: 'source-changed' }
    let fresh: ReturnType<typeof createPublicV26Root>
    try { fresh = createPublicV26Root(expected) }
    catch { return { ok: false, reason: 'source-unplaceable' } }
    const write = await store.commit(checked.target.proof, fresh)
    return write === 'committed' ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: write }
  })
}

export function resumePublicV26(locks: PublicV7LockProvider | undefined, store: Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV26Operation<PublicV26Start>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v25Store, v24Store, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    if (!samePublicV14Value(decodePublicV26Lineage(rawLineage), checked.start.lineage))
      return { ok: false, reason: 'lineage-changed' }
    return checked.start.head.saveRevision === revision
      ? { ok: true, value: checked.start } : { ok: false, reason: 'revision-changed' }
  })
}

async function commitWitnessUnderLock(store: Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown, witnessFromWriter: () => unknown,
  returnHome: boolean): Promise<PublicV26Operation<PublicV26Start>> {
  try {
    const checked = await inspectUnderLock(store, v25Store, v24Store, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    const { head, lineage } = checked.start
    if (!samePublicV14Value(decodePublicV26Lineage(rawLineage), lineage))
      return { ok: false, reason: 'lineage-changed' }
    if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
    if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: 'invalid-revision' }
    const decoded = decodePublicV26Witness(witnessFromWriter())
    if (!decoded || (decoded.kind === 'return-home/v1') !== returnHome)
      return { ok: false, reason: 'invalid-witness' }
    const before = { state: head.state,
      greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
      terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs }
    const replayed = replayPublicV26Witness(before, decoded)
    if (!replayed) {
      if (returnHome && decoded.kind === 'return-home/v1') {
        const reason = applyPublicV26ReturnHome(before, decoded.atMs).rejection
        if (reason === 'not_trapped' || reason === 'cooldown') return { ok: false, reason }
      }
      return { ok: false, reason: 'frame-rejected' }
    }
    const next: PublicV26Head = { ...head, ...replayed, saveRevision: revision + 1,
      witness: structuredClone(decoded) }
    const write = await store.commit(checked.target.proof,
      { lineage, previous: head, head: next })
    return write === 'committed' ? { ok: true, value: { head: next, lineage } }
      : { ok: false, reason: write }
  } catch { return { ok: false, reason: 'storage-error' } }
}

/** Client witnesses cannot stamp rescue time; replay and CAS remain under one lock. */
export function commitPublicV26(locks: PublicV7LockProvider | undefined, store: Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown, witness: PublicV26Witness):
  Promise<PublicV26Operation<PublicV26Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, v25Store, v24Store, v23Store, v17Store,
    revision, rawLineage, () => witness, false))
}

/** Uses only the local writer clock, sampled after live source and CAS validation. */
export function requestPublicV26ReturnHome(locks: PublicV7LockProvider | undefined, store: Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV26Operation<PublicV26Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, v25Store, v24Store, v23Store, v17Store,
    revision, rawLineage, () => ({ kind: 'return-home/v1', atMs: Date.now() }), true))
}
