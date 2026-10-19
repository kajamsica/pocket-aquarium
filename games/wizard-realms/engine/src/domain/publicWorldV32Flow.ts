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
import type { createAtomicV32Store, AtomicV32Read } from './atomicV32Database'
import { samePublicV14Value } from './publicWorldV14Validation'
import { inspectPublicV29UnderLock } from './publicWorldV29Flow'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { confirmPublicV31SoilAction } from './publicWorldV31Soil'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { decodePublicV32Lineage } from './publicWorldV32Migration'
import type { PublicV32Lineage, PublicV32SourceReceipt } from './publicWorldV32Migration'
import { confirmPublicV32HighlandAction } from './publicWorldV32Highland'
import { createPublicV32Root, decodePublicV32Witness,
  replayPublicV32Witness } from './publicWorldV32Snapshot'
import type { PublicV32Head, PublicV32Witness } from './publicWorldV32Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

type Store = ReturnType<typeof createAtomicV32Store>
type V31Store = ReturnType<typeof createAtomicV31Store>
type V30Store = ReturnType<typeof createAtomicV30Store>
type V29Store = ReturnType<typeof createAtomicV29Store>
type V28Store = ReturnType<typeof createAtomicV28Store>
type V27Store = ReturnType<typeof createAtomicV27Store>
type V26Store = ReturnType<typeof createAtomicV26Store>
type V25Store = ReturnType<typeof createAtomicV25Store>
type V24Store = ReturnType<typeof createAtomicV24Store>
type V23Store = ReturnType<typeof createAtomicV23Store>
type V17Store = ReturnType<typeof createAtomicV17Store>

export type PublicV32Start = Readonly<{ head: PublicV32Head; lineage: PublicV32Lineage }>
export type PublicV32Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV32Inspection = { status: 'migration-available'; sourceReceipt: PublicV32SourceReceipt }
  | { status: 'valid'; start: PublicV32Start }
  | { status: 'blocked'; reason: string }
type Checked = { status: 'missing'; target: Extract<AtomicV32Read, { status: 'missing' }>;
    sourceReceipt: PublicV32SourceReceipt }
  | { status: 'valid'; target: Extract<AtomicV32Read, { status: 'valid' }>;
    start: PublicV32Start }
  | { status: 'blocked'; reason: string }

function matchesCheckedLineage(rawLineage: unknown, checked: PublicV32Lineage): boolean {
  return sameStrictBoundedRaw(rawLineage, checked, 3 << 20)
    || samePublicV14Value(decodePublicV32Lineage(rawLineage), checked)
}

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV32Operation<T>>): Promise<PublicV32Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}

/** Check V32 and its complete live V31 source, including V30 and V29 ancestry. */
async function inspectUnderLock(store: Store, v31Store: V31Store, v30Store: V30Store,
  v29Store: V29Store, v28Store: V28Store, v27Store: V27Store, v26Store: V26Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store,
  v17Store: V17Store): Promise<Checked> {
  const target = await store.readChecked()
  const source: AtomicV31Read = await v31Store.readChecked()
  const v30: AtomicV30Read = await v30Store.readChecked()
  const ancestor = await inspectPublicV29UnderLock(v29Store, v28Store, v27Store,
    v26Store, v25Store, v24Store, v23Store, v17Store)
  if (target.status === 'blocked') return target
  if (source.status === 'blocked') return { status: 'blocked', reason: `source-${source.reason}` }
  if (v30.status === 'blocked') return { status: 'blocked', reason: `source-${v30.reason}` }
  if (ancestor.status === 'blocked') return { status: 'blocked',
    reason: ancestor.reason.startsWith('source-') ? ancestor.reason : `source-${ancestor.reason}` }
  if (ancestor.status !== 'valid') return { status: 'blocked', reason: 'source-v29-missing' }
  if (v30.status !== 'valid') return { status: 'blocked', reason: 'source-v30-missing' }
  if (source.status !== 'valid') return { status: 'blocked', reason: 'source-v31-missing' }
  if (!samePublicV14Value(v30.root.lineage.sourceReceipt, ancestor.start))
    return { status: 'blocked', reason: 'source-v30-source-changed' }
  if (!sameStrictBoundedRaw(source.root.lineage.sourceReceipt, v30.root, 3 << 20))
    return { status: 'blocked', reason: 'source-v31-source-changed' }
  if (target.status === 'missing') return { status: 'missing', target,
    sourceReceipt: source.root }
  if (!sameStrictBoundedRaw(target.root.lineage.sourceReceipt, source.root, 3 << 20))
    return { status: 'blocked', reason: 'source-changed' }
  return { status: 'valid', target,
    start: { head: target.root.head, lineage: target.root.lineage } }
}

export function inspectPublicV32(locks: PublicV7LockProvider | undefined, store: Store,
  v31Store: V31Store, v30Store: V30Store, v29Store: V29Store, v28Store: V28Store,
  v27Store: V27Store, v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store):
  Promise<PublicV32Operation<PublicV32Inspection>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v31Store, v30Store, v29Store, v28Store,
      v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
    const value: PublicV32Inspection = checked.status === 'missing'
      ? { status: 'migration-available', sourceReceipt: checked.sourceReceipt }
      : checked.status === 'valid' ? { status: 'valid', start: checked.start } : checked
    return { ok: true, value }
  })
}

export function startPublicV32(locks: PublicV7LockProvider | undefined, store: Store,
  v31Store: V31Store, v30Store: V30Store, v29Store: V29Store, v28Store: V28Store,
  v27Store: V27Store, v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  seed: string, expectedSource: PublicV32SourceReceipt): Promise<PublicV32Operation<PublicV32Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128)
    return Promise.resolve({ ok: false, reason: 'invalid-seed' })
  let fresh: ReturnType<typeof createPublicV32Root>
  try { fresh = createPublicV32Root(expectedSource) }
  catch { return Promise.resolve({ ok: false, reason: 'invalid-source' }) }
  if (fresh.head.state.seed !== seed) return Promise.resolve({ ok: false, reason: 'invalid-source' })
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v31Store, v30Store, v29Store, v28Store,
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

export function resumePublicV32(locks: PublicV7LockProvider | undefined, store: Store,
  v31Store: V31Store, v30Store: V30Store, v29Store: V29Store, v28Store: V28Store,
  v27Store: V27Store, v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV32Operation<PublicV32Start>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v31Store, v30Store, v29Store, v28Store,
      v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    if (!matchesCheckedLineage(rawLineage, checked.start.lineage))
      return { ok: false, reason: 'lineage-changed' }
    return checked.start.head.saveRevision === revision
      ? { ok: true, value: checked.start } : { ok: false, reason: 'revision-changed' }
  })
}

async function commitWitnessUnderLock(store: Store, v31Store: V31Store, v30Store: V30Store,
  v29Store: V29Store, v28Store: V28Store, v27Store: V27Store, v26Store: V26Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown, witnessFromWriter: () => unknown,
  returnHome: boolean): Promise<PublicV32Operation<PublicV32Start>> {
  try {
    const checked = await inspectUnderLock(store, v31Store, v30Store, v29Store, v28Store,
      v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    const { head, lineage } = checked.start
    if (!matchesCheckedLineage(rawLineage, lineage))
      return { ok: false, reason: 'lineage-changed' }
    if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
    if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: 'invalid-revision' }
    const decoded = decodePublicV32Witness(witnessFromWriter())
    if (!decoded || (decoded.kind === 'return-home/v1') !== returnHome)
      return { ok: false, reason: 'invalid-witness' }
    const before = { state: head.state, greenwayWorks: head.greenwayWorks,
      regionalWorks: head.regionalWorks, terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs,
      riverBridgeIds: head.riverBridgeIds, miningTools: head.miningTools,
      claimedBridgeheadId: head.claimedBridgeheadId, raisedSoilCells: head.raisedSoilCells }
    const replayed = replayPublicV32Witness(before, decoded)
    if (!replayed) {
      if (decoded.kind === 'highland-discover/v1' || decoded.kind === 'highland-extract/v1')
        return { ok: false, reason: confirmPublicV32HighlandAction(before, decoded).rejection
          ?? 'action-rejected' }
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
    const next: PublicV32Head = { ...head, ...replayed, saveRevision: revision + 1,
      witness: structuredClone(decoded) }
    const write = await store.commit(checked.target.proof,
      { lineage, previous: head, head: next })
    return write === 'committed' ? { ok: true, value: { head: next, lineage } }
      : { ok: false, reason: write }
  } catch { return { ok: false, reason: 'storage-error' } }
}

export function commitPublicV32(locks: PublicV7LockProvider | undefined, store: Store,
  v31Store: V31Store, v30Store: V30Store, v29Store: V29Store, v28Store: V28Store,
  v27Store: V27Store, v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown, witness: PublicV32Witness):
  Promise<PublicV32Operation<PublicV32Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, v31Store, v30Store, v29Store, v28Store,
    v27Store, v26Store, v25Store, v24Store, v23Store, v17Store, revision, rawLineage,
    () => witness, false))
}

export function requestPublicV32ReturnHome(locks: PublicV7LockProvider | undefined, store: Store,
  v31Store: V31Store, v30Store: V30Store, v29Store: V29Store, v28Store: V28Store,
  v27Store: V27Store, v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV32Operation<PublicV32Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, v31Store, v30Store, v29Store, v28Store,
    v27Store, v26Store, v25Store, v24Store, v23Store, v17Store, revision, rawLineage,
    () => ({ kind: 'return-home/v1', atMs: Date.now() }), true))
}
