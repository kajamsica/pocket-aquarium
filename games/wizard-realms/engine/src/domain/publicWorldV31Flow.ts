import type { createAtomicV17Store } from './atomicV17Database'
import type { createAtomicV23Store } from './atomicV23Database'
import type { createAtomicV24Store } from './atomicV24Database'
import type { createAtomicV25Store } from './atomicV25Database'
import type { createAtomicV26Store } from './atomicV26Database'
import type { createAtomicV27Store } from './atomicV27Database'
import type { createAtomicV28Store } from './atomicV28Database'
import type { createAtomicV29Store } from './atomicV29Database'
import type { createAtomicV30Store, AtomicV30Read } from './atomicV30Database'
import type { createAtomicV31Store, AtomicV31Read } from './atomicV31Database'
import { samePublicV14Value } from './publicWorldV14Validation'
import { inspectPublicV29UnderLock } from './publicWorldV29Flow'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { confirmPublicV31SoilAction } from './publicWorldV31Soil'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { decodePublicV31Lineage } from './publicWorldV31Migration'
import type { PublicV31Lineage, PublicV31SourceReceipt } from './publicWorldV31Migration'
import { createPublicV31Root, decodePublicV31Witness,
  replayPublicV31Witness } from './publicWorldV31Snapshot'
import type { PublicV31Head, PublicV31Witness } from './publicWorldV31Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

type Store = ReturnType<typeof createAtomicV31Store>
type V30Store = ReturnType<typeof createAtomicV30Store>
type V29Store = ReturnType<typeof createAtomicV29Store>
type V28Store = ReturnType<typeof createAtomicV28Store>
type V27Store = ReturnType<typeof createAtomicV27Store>
type V26Store = ReturnType<typeof createAtomicV26Store>
type V25Store = ReturnType<typeof createAtomicV25Store>
type V24Store = ReturnType<typeof createAtomicV24Store>
type V23Store = ReturnType<typeof createAtomicV23Store>
type V17Store = ReturnType<typeof createAtomicV17Store>

export type PublicV31Start = Readonly<{ head: PublicV31Head; lineage: PublicV31Lineage }>
export type PublicV31Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV31Inspection = { status: 'migration-available'; sourceReceipt: PublicV31SourceReceipt }
  | { status: 'valid'; start: PublicV31Start }
  | { status: 'blocked'; reason: string }
type Checked = { status: 'missing'; target: Extract<AtomicV31Read, { status: 'missing' }>;
    sourceReceipt: PublicV31SourceReceipt }
  | { status: 'valid'; target: Extract<AtomicV31Read, { status: 'valid' }>;
    start: PublicV31Start }
  | { status: 'blocked'; reason: string }

function matchesCheckedLineage(rawLineage: unknown, checked: PublicV31Lineage): boolean {
  return sameStrictBoundedRaw(rawLineage, checked, 3 << 20)
    || samePublicV14Value(decodePublicV31Lineage(rawLineage), checked)
}

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV31Operation<T>>): Promise<PublicV31Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}

/** Read the complete checked V30 source and prove its live V29 ancestry under one lock. */
async function inspectUnderLock(store: Store, v30Store: V30Store, v29Store: V29Store,
  v28Store: V28Store, v27Store: V27Store, v26Store: V26Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store,
  v17Store: V17Store): Promise<Checked> {
  const target = await store.readChecked()
  const source: AtomicV30Read = await v30Store.readChecked()
  const ancestor = await inspectPublicV29UnderLock(v29Store, v28Store, v27Store,
    v26Store, v25Store, v24Store, v23Store, v17Store)
  if (target.status === 'blocked') return target
  if (source.status === 'blocked') return { status: 'blocked', reason: `source-${source.reason}` }
  if (ancestor.status === 'blocked') return { status: 'blocked',
    reason: ancestor.reason.startsWith('source-') ? ancestor.reason : `source-${ancestor.reason}` }
  if (ancestor.status !== 'valid') return { status: 'blocked', reason: 'source-v29-missing' }
  if (source.status !== 'valid') return { status: 'blocked', reason: 'source-v30-missing' }
  if (!samePublicV14Value(source.root.lineage.sourceReceipt, ancestor.start))
    return { status: 'blocked', reason: 'source-v30-source-changed' }
  if (target.status === 'missing') return { status: 'missing', target,
    sourceReceipt: source.root }
  if (!sameStrictBoundedRaw(target.root.lineage.sourceReceipt, source.root, 3 << 20))
    return { status: 'blocked', reason: 'source-changed' }
  return { status: 'valid', target,
    start: { head: target.root.head, lineage: target.root.lineage } }
}

export function inspectPublicV31(locks: PublicV7LockProvider | undefined, store: Store,
  v30Store: V30Store, v29Store: V29Store, v28Store: V28Store, v27Store: V27Store,
  v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store):
  Promise<PublicV31Operation<PublicV31Inspection>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v30Store, v29Store, v28Store,
      v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
    const value: PublicV31Inspection = checked.status === 'missing'
      ? { status: 'migration-available', sourceReceipt: checked.sourceReceipt }
      : checked.status === 'valid' ? { status: 'valid', start: checked.start } : checked
    return { ok: true, value }
  })
}

export function startPublicV31(locks: PublicV7LockProvider | undefined, store: Store,
  v30Store: V30Store, v29Store: V29Store, v28Store: V28Store, v27Store: V27Store,
  v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  seed: string, expectedSource: PublicV31SourceReceipt): Promise<PublicV31Operation<PublicV31Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128)
    return Promise.resolve({ ok: false, reason: 'invalid-seed' })
  let fresh: ReturnType<typeof createPublicV31Root>
  try { fresh = createPublicV31Root(expectedSource) }
  catch { return Promise.resolve({ ok: false, reason: 'invalid-source' }) }
  if (fresh.head.state.seed !== seed) return Promise.resolve({ ok: false, reason: 'invalid-source' })
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v30Store, v29Store, v28Store,
      v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
    if (checked.status === 'blocked') return { ok: false, reason: checked.reason }
    if (checked.status === 'valid') return { ok: false, reason: 'target-conflict' }
    if (!sameStrictBoundedRaw(checked.sourceReceipt, fresh.lineage.sourceReceipt, 3 << 20))
      return { ok: false, reason: 'source-changed' }
    const write = await store.commit(checked.target.proof, fresh)
    return write === 'committed' ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: write }
  })
}

export function resumePublicV31(locks: PublicV7LockProvider | undefined, store: Store,
  v30Store: V30Store, v29Store: V29Store, v28Store: V28Store, v27Store: V27Store,
  v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV31Operation<PublicV31Start>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v30Store, v29Store, v28Store,
      v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    if (!matchesCheckedLineage(rawLineage, checked.start.lineage))
      return { ok: false, reason: 'lineage-changed' }
    return checked.start.head.saveRevision === revision
      ? { ok: true, value: checked.start } : { ok: false, reason: 'revision-changed' }
  })
}

async function commitWitnessUnderLock(store: Store, v30Store: V30Store, v29Store: V29Store,
  v28Store: V28Store, v27Store: V27Store, v26Store: V26Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store,
  v17Store: V17Store, revision: number, rawLineage: unknown,
  witnessFromWriter: () => unknown, returnHome: boolean): Promise<PublicV31Operation<PublicV31Start>> {
  try {
    const checked = await inspectUnderLock(store, v30Store, v29Store, v28Store,
      v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    const { head, lineage } = checked.start
    if (!matchesCheckedLineage(rawLineage, lineage))
      return { ok: false, reason: 'lineage-changed' }
    if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
    if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: 'invalid-revision' }
    const decoded = decodePublicV31Witness(witnessFromWriter())
    if (!decoded || (decoded.kind === 'return-home/v1') !== returnHome)
      return { ok: false, reason: 'invalid-witness' }
    const before = { state: head.state, greenwayWorks: head.greenwayWorks,
      regionalWorks: head.regionalWorks, terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs,
      riverBridgeIds: head.riverBridgeIds, miningTools: head.miningTools,
      claimedBridgeheadId: head.claimedBridgeheadId, raisedSoilCells: head.raisedSoilCells }
    const replayed = replayPublicV31Witness(before, decoded)
    if (!replayed) {
      if (decoded.kind === 'soil-place/v1' || decoded.kind === 'soil-remove/v1')
        return { ok: false, reason: confirmPublicV31SoilAction(before, decoded).rejection
          ?? 'frame-rejected' }
      if (returnHome && decoded.kind === 'return-home/v1') {
        const reason = applyPublicV26ReturnHome({ state: before.state,
          greenwayWorks: before.greenwayWorks, regionalWorks: before.regionalWorks,
          terrain: before.terrain, nextHomeAtMs: before.nextHomeAtMs }, decoded.atMs).rejection
        if (reason === 'not_trapped' || reason === 'cooldown') return { ok: false, reason }
      }
      return { ok: false, reason: 'frame-rejected' }
    }
    const next: PublicV31Head = { ...head, ...replayed, saveRevision: revision + 1,
      witness: structuredClone(decoded) }
    const write = await store.commit(checked.target.proof,
      { lineage, previous: head, head: next })
    return write === 'committed' ? { ok: true, value: { head: next, lineage } }
      : { ok: false, reason: write }
  } catch { return { ok: false, reason: 'storage-error' } }
}

export function commitPublicV31(locks: PublicV7LockProvider | undefined, store: Store,
  v30Store: V30Store, v29Store: V29Store, v28Store: V28Store, v27Store: V27Store,
  v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown, witness: PublicV31Witness):
  Promise<PublicV31Operation<PublicV31Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, v30Store, v29Store, v28Store,
    v27Store, v26Store, v25Store, v24Store, v23Store, v17Store, revision, rawLineage,
    () => witness, false))
}

export function requestPublicV31ReturnHome(locks: PublicV7LockProvider | undefined, store: Store,
  v30Store: V30Store, v29Store: V29Store, v28Store: V28Store, v27Store: V27Store,
  v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV31Operation<PublicV31Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, v30Store, v29Store, v28Store,
    v27Store, v26Store, v25Store, v24Store, v23Store, v17Store, revision, rawLineage,
    () => ({ kind: 'return-home/v1', atMs: Date.now() }), true))
}
