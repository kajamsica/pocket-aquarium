import type { createAtomicV17Store } from './atomicV17Database'
import type { createAtomicV23Store } from './atomicV23Database'
import type { createAtomicV24Store } from './atomicV24Database'
import type { createAtomicV25Store } from './atomicV25Database'
import type { createAtomicV26Store } from './atomicV26Database'
import type { createAtomicV27Store } from './atomicV27Database'
import type { createAtomicV28Store } from './atomicV28Database'
import type { createAtomicV29Store, AtomicV29Read } from './atomicV29Database'
import { samePublicV14Value } from './publicWorldV14Validation'
import { inspectPublicV25UnderLock } from './publicWorldV25Flow'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { decodePublicV29Lineage, decodePublicV29SourceReceipt } from './publicWorldV29Migration'
import type { PublicV29Lineage, PublicV29SourceReceipt } from './publicWorldV29Migration'
import { sameStrictBoundedRaw } from './strictBoundedRaw'
import { createPublicV29Root, decodePublicV29Witness, replayPublicV29Witness } from './publicWorldV29Snapshot'
import type { PublicV29Head, PublicV29Witness } from './publicWorldV29Snapshot'

type Store = ReturnType<typeof createAtomicV29Store>
type V28Store = ReturnType<typeof createAtomicV28Store>
type V27Store = ReturnType<typeof createAtomicV27Store>
type V26Store = ReturnType<typeof createAtomicV26Store>
type V25Store = ReturnType<typeof createAtomicV25Store>
type V24Store = ReturnType<typeof createAtomicV24Store>
type V23Store = ReturnType<typeof createAtomicV23Store>
type V17Store = ReturnType<typeof createAtomicV17Store>
export type PublicV29Start = Readonly<{ head: PublicV29Head; lineage: PublicV29Lineage }>
export type PublicV29Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV29Inspection = { status: 'migration-available'; sourceReceipt: PublicV29SourceReceipt }
  | { status: 'valid'; start: PublicV29Start }
  | { status: 'blocked'; reason: string }
export type PublicV29Checked = { status: 'missing'; target: Extract<AtomicV29Read, { status: 'missing' }>;
    sourceReceipt: PublicV29SourceReceipt }
  | { status: 'valid'; target: Extract<AtomicV29Read, { status: 'valid' }>;
    start: PublicV29Start }
  | { status: 'blocked'; reason: string }

function matchesCheckedLineage(rawLineage: unknown, checked: PublicV29Lineage): boolean {
  return sameStrictBoundedRaw(rawLineage, checked, 3 << 20)
    || samePublicV14Value(decodePublicV29Lineage(rawLineage), checked)
}

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV29Operation<T>>): Promise<PublicV29Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}

/** Check the exact target and every live V28 through V25 ancestor under one lock. */
export async function inspectPublicV29UnderLock(store: Store, v28Store: V28Store, v27Store: V27Store,
  v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store): Promise<PublicV29Checked> {
  const target = await store.readChecked()
  const source = await v28Store.readChecked()
  const v27 = await v27Store.readChecked()
  const v26 = await v26Store.readChecked()
  const upstream = await inspectPublicV25UnderLock(v25Store, v24Store, v23Store, v17Store)
  if (target.status === 'blocked') return target
  if (source.status === 'blocked') return { status: 'blocked', reason: `source-${source.reason}` }
  if (v27.status === 'blocked') return { status: 'blocked', reason: `source-${v27.reason}` }
  if (v26.status === 'blocked') return { status: 'blocked', reason: `source-${v26.reason}` }
  if (upstream.status === 'blocked') return { status: 'blocked',
    reason: upstream.reason.startsWith('source-') ? upstream.reason : `source-${upstream.reason}` }
  if (upstream.status !== 'valid') return { status: 'blocked', reason: 'source-v25-missing' }
  if (v26.status !== 'valid') return { status: 'blocked', reason: 'source-v26-missing' }
  if (v27.status !== 'valid') return { status: 'blocked', reason: 'source-v27-missing' }
  if (source.status !== 'valid') return { status: 'blocked', reason: 'source-v28-missing' }
  if (!samePublicV14Value(v26.root.lineage.sourceReceipt,
    { head: upstream.start.head, lineage: upstream.start.lineage }))
    return { status: 'blocked', reason: 'source-v26-source-changed' }
  if (!samePublicV14Value(v27.root.lineage.sourceReceipt,
    { head: v26.root.head, lineage: v26.root.lineage }))
    return { status: 'blocked', reason: 'source-v27-source-changed' }
  if (!samePublicV14Value(source.root.lineage.sourceReceipt,
    { head: v27.root.head, lineage: v27.root.lineage }))
    return { status: 'blocked', reason: 'source-v28-source-changed' }
  const sourceReceipt = { head: source.root.head, lineage: source.root.lineage }
  if (target.status === 'missing') return { status: 'missing', target, sourceReceipt }
  if (!samePublicV14Value(target.root.lineage.sourceReceipt, sourceReceipt))
    return { status: 'blocked', reason: 'source-changed' }
  return { status: 'valid', target,
    start: { head: target.root.head, lineage: target.root.lineage } }
}

export function inspectPublicV29(locks: PublicV7LockProvider | undefined, store: Store,
  v28Store: V28Store, v27Store: V27Store, v26Store: V26Store, v25Store: V25Store,
  v24Store: V24Store, v23Store: V23Store, v17Store: V17Store):
  Promise<PublicV29Operation<PublicV29Inspection>> {
  return lock(locks, async () => {
    const checked = await inspectPublicV29UnderLock(store, v28Store, v27Store, v26Store,
      v25Store, v24Store, v23Store, v17Store)
    const value: PublicV29Inspection = checked.status === 'missing'
      ? { status: 'migration-available', sourceReceipt: checked.sourceReceipt }
      : checked.status === 'valid' ? { status: 'valid', start: checked.start } : checked
    return { ok: true, value }
  })
}

export function startPublicV29(locks: PublicV7LockProvider | undefined, store: Store,
  v28Store: V28Store, v27Store: V27Store, v26Store: V26Store, v25Store: V25Store,
  v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  seed: string, expectedSource: PublicV29SourceReceipt): Promise<PublicV29Operation<PublicV29Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128)
    return Promise.resolve({ ok: false, reason: 'invalid-seed' })
  const expected = decodePublicV29SourceReceipt(expectedSource)
  if (!expected || expected.head.state.seed !== seed)
    return Promise.resolve({ ok: false, reason: 'invalid-source' })
  return lock(locks, async () => {
    const checked = await inspectPublicV29UnderLock(store, v28Store, v27Store, v26Store,
      v25Store, v24Store, v23Store, v17Store)
    if (checked.status === 'blocked') return { ok: false, reason: checked.reason }
    if (checked.status === 'valid') return { ok: false, reason: 'target-conflict' }
    if (!samePublicV14Value(checked.sourceReceipt, expected))
      return { ok: false, reason: 'source-changed' }
    let fresh: ReturnType<typeof createPublicV29Root>
    try { fresh = createPublicV29Root(expected) }
    catch { return { ok: false, reason: 'source-unplaceable' } }
    const write = await store.commit(checked.target.proof, fresh)
    return write === 'committed' ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: write }
  })
}

export function resumePublicV29(locks: PublicV7LockProvider | undefined, store: Store,
  v28Store: V28Store, v27Store: V27Store, v26Store: V26Store, v25Store: V25Store,
  v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV29Operation<PublicV29Start>> {
  return lock(locks, async () => {
    const checked = await inspectPublicV29UnderLock(store, v28Store, v27Store, v26Store,
      v25Store, v24Store, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    if (!matchesCheckedLineage(rawLineage, checked.start.lineage))
      return { ok: false, reason: 'lineage-changed' }
    return checked.start.head.saveRevision === revision
      ? { ok: true, value: checked.start } : { ok: false, reason: 'revision-changed' }
  })
}

async function commitWitnessUnderLock(store: Store, v28Store: V28Store, v27Store: V27Store,
  v26Store: V26Store, v25Store: V25Store, v24Store: V24Store, v23Store: V23Store,
  v17Store: V17Store, revision: number, rawLineage: unknown,
  witnessFromWriter: () => unknown, returnHome: boolean): Promise<PublicV29Operation<PublicV29Start>> {
  try {
    const checked = await inspectPublicV29UnderLock(store, v28Store, v27Store, v26Store,
      v25Store, v24Store, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    const { head, lineage } = checked.start
    if (!matchesCheckedLineage(rawLineage, lineage))
      return { ok: false, reason: 'lineage-changed' }
    if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
    if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: 'invalid-revision' }
    const decoded = decodePublicV29Witness(witnessFromWriter())
    if (!decoded || (decoded.kind === 'return-home/v1') !== returnHome)
      return { ok: false, reason: 'invalid-witness' }
    const before = { state: head.state, greenwayWorks: head.greenwayWorks,
      regionalWorks: head.regionalWorks, terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs,
      riverBridgeIds: head.riverBridgeIds, miningTools: head.miningTools }
    const replayed = replayPublicV29Witness(before, decoded)
    if (!replayed) {
      if (returnHome && decoded.kind === 'return-home/v1') {
        const reason = applyPublicV26ReturnHome({ state: before.state,
          greenwayWorks: before.greenwayWorks, regionalWorks: before.regionalWorks,
          terrain: before.terrain, nextHomeAtMs: before.nextHomeAtMs }, decoded.atMs).rejection
        if (reason === 'not_trapped' || reason === 'cooldown') return { ok: false, reason }
      }
      return { ok: false, reason: 'frame-rejected' }
    }
    const next: PublicV29Head = { ...head, ...replayed, saveRevision: revision + 1,
      witness: structuredClone(decoded) }
    const write = await store.commit(checked.target.proof,
      { lineage, previous: head, head: next })
    return write === 'committed' ? { ok: true, value: { head: next, lineage } }
      : { ok: false, reason: write }
  } catch { return { ok: false, reason: 'storage-error' } }
}

/** Commit a strictly decoded V29 witness against the checked live ancestry. */
export function commitPublicV29(locks: PublicV7LockProvider | undefined, store: Store,
  v28Store: V28Store, v27Store: V27Store, v26Store: V26Store, v25Store: V25Store,
  v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown, witness: PublicV29Witness):
  Promise<PublicV29Operation<PublicV29Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, v28Store, v27Store, v26Store,
    v25Store, v24Store, v23Store, v17Store, revision, rawLineage, () => witness, false))
}

export function requestPublicV29ReturnHome(locks: PublicV7LockProvider | undefined, store: Store,
  v28Store: V28Store, v27Store: V27Store, v26Store: V26Store, v25Store: V25Store,
  v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV29Operation<PublicV29Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, v28Store, v27Store, v26Store,
    v25Store, v24Store, v23Store, v17Store, revision, rawLineage,
    () => ({ kind: 'return-home/v1', atMs: Date.now() }), true))
}
