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
import type { createAtomicV33Store, AtomicV33Read } from './atomicV33Database'
import { samePublicV14Value } from './publicWorldV14Validation'
import { inspectPublicV29UnderLock } from './publicWorldV29Flow'
import type { PublicV29Checked } from './publicWorldV29Flow'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { confirmPublicV31SoilAction } from './publicWorldV31Soil'
import { confirmPublicV32HighlandAction } from './publicWorldV32Highland'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { decodePublicV33Lineage } from './publicWorldV33Migration'
import type { PublicV33Lineage, PublicV33SourceReceipt } from './publicWorldV33Migration'
import { confirmPublicV33FairyRingAction } from './publicWorldV33FairyRing'
import { createPublicV33Root, decodePublicV33Root, decodePublicV33Witness,
  replayPublicV33Witness } from './publicWorldV33Snapshot'
import type { PublicV33Head, PublicV33Witness } from './publicWorldV33Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

type Store = ReturnType<typeof createAtomicV33Store>
type V32Store = ReturnType<typeof createAtomicV32Store>
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

export type PublicV33Start = Readonly<{ head: PublicV33Head; lineage: PublicV33Lineage }>
export type PublicV33Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV33Inspection = { status: 'migration-available'; sourceReceipt: PublicV33SourceReceipt }
  | { status: 'valid'; start: PublicV33Start }
  | { status: 'blocked'; reason: string }
type Checked = { status: 'missing'; target: Extract<AtomicV33Read, { status: 'missing' }>;
    sourceReceipt: PublicV33SourceReceipt }
  | { status: 'valid'; target: Extract<AtomicV33Read, { status: 'valid' }>;
    start: PublicV33Start }
  | { status: 'blocked'; reason: string }
type CheckedAncestry = { status: 'valid'; sourceReceipt: PublicV33SourceReceipt }
  | { status: 'blocked'; reason: string }

function matchesCheckedLineage(rawLineage: unknown, checked: PublicV33Lineage): boolean {
  return sameStrictBoundedRaw(rawLineage, checked, 3 << 20)
    || samePublicV14Value(decodePublicV33Lineage(rawLineage), checked)
}

function sameCheckedV32Source(left: PublicV33SourceReceipt, right: PublicV33SourceReceipt): boolean {
  const limit = 3 << 20
  // Pairwise checks retain the whole-root alias rejection without charging all three slots at once.
  return sameStrictBoundedRaw([left.lineage, left.head], [right.lineage, right.head], limit)
    && sameStrictBoundedRaw([left.lineage, left.previous], [right.lineage, right.previous], limit)
    && sameStrictBoundedRaw([left.head, left.previous], [right.head, right.previous], limit)
}

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV33Operation<T>>): Promise<PublicV33Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}

/** Shared V32-to-V17 inspection for ordinary V33 reads and source-only reads. */
async function inspectAncestryUnderLock(v32Store: V32Store, v31Store: V31Store, v30Store: V30Store,
  v29Store: V29Store, v28Store: V28Store, v27Store: V27Store, v26Store: V26Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store,
  v17Store: V17Store): Promise<CheckedAncestry> {
  let ancestor: PublicV29Checked | null = await inspectPublicV29UnderLock(v29Store, v28Store, v27Store,
    v26Store, v25Store, v24Store, v23Store, v17Store)
  let v30: AtomicV30Read | null = await v30Store.readChecked()
  const ancestorBlocked = ancestor.status === 'blocked' ? ancestor.reason : null
  const ancestorMissing = ancestor.status !== 'valid'
  const v30Blocked = v30.status === 'blocked' ? v30.reason : null
  const v30Missing = v30.status !== 'valid'
  const v30SourceChanged = ancestor.status === 'valid' && v30.status === 'valid'
    && !samePublicV14Value(v30.root.lineage.sourceReceipt, ancestor.start)
  ancestor = null
  let v31: AtomicV31Read | null = await v31Store.readChecked()
  const v31Blocked = v31.status === 'blocked' ? v31.reason : null
  const v31Missing = v31.status !== 'valid'
  const v31SourceChanged = v30.status === 'valid' && v31.status === 'valid'
    && !sameStrictBoundedRaw(v31.root.lineage.sourceReceipt, v30.root, 3 << 20)
  v30 = null
  const source: AtomicV32Read = await v32Store.readChecked()
  const v32SourceChanged = v31.status === 'valid' && source.status === 'valid'
    && !sameStrictBoundedRaw(source.root.lineage.sourceReceipt, v31.root, 3 << 20)
  v31 = null
  if (source.status === 'blocked') return { status: 'blocked', reason: `source-${source.reason}` }
  if (v31Blocked !== null) return { status: 'blocked', reason: `source-${v31Blocked}` }
  if (v30Blocked !== null) return { status: 'blocked', reason: `source-${v30Blocked}` }
  if (ancestorBlocked !== null) return { status: 'blocked',
    reason: ancestorBlocked.startsWith('source-') ? ancestorBlocked : `source-${ancestorBlocked}` }
  if (ancestorMissing) return { status: 'blocked', reason: 'source-v29-missing' }
  if (v30Missing) return { status: 'blocked', reason: 'source-v30-missing' }
  if (v31Missing) return { status: 'blocked', reason: 'source-v31-missing' }
  if (source.status !== 'valid') return { status: 'blocked', reason: 'source-v32-missing' }
  if (v30SourceChanged) return { status: 'blocked', reason: 'source-v30-source-changed' }
  if (v31SourceChanged) return { status: 'blocked', reason: 'source-v31-source-changed' }
  if (v32SourceChanged) return { status: 'blocked', reason: 'source-v32-source-changed' }
  return { status: 'valid', sourceReceipt: source.root }
}

/** Check V33 and its complete live V32 source, including V31, V30 and V29 ancestry. */
async function inspectUnderLock(store: Store, v32Store: V32Store, v31Store: V31Store, v30Store: V30Store,
  v29Store: V29Store, v28Store: V28Store, v27Store: V27Store, v26Store: V26Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store,
  v17Store: V17Store): Promise<Checked> {
  const target = await store.readChecked()
  const ancestry = await inspectAncestryUnderLock(v32Store, v31Store, v30Store, v29Store, v28Store,
    v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
  if (target.status === 'blocked') return target
  if (ancestry.status === 'blocked') return ancestry
  if (target.status === 'missing') return { status: 'missing', target,
    sourceReceipt: ancestry.sourceReceipt }
  if (!sameCheckedV32Source(target.root.lineage.sourceReceipt, ancestry.sourceReceipt))
    return { status: 'blocked', reason: 'source-changed' }
  return { status: 'valid', target,
    start: { head: target.root.head, lineage: target.root.lineage } }
}

/** The decoded source and ancestor roots leave scope before the caller reads another target. */
async function checkedRawSourceUnderLock(store: Store, v32Store: V32Store, v31Store: V31Store,
  v30Store: V30Store, v29Store: V29Store, v28Store: V28Store, v27Store: V27Store,
  v26Store: V26Store, v25Store: V25Store, v24Store: V24Store, v23Store: V23Store,
  v17Store: V17Store): Promise<PublicV33Operation<unknown>> {
  const target = await store.readRawSourceEnvelope()
  const ancestry = await inspectAncestryUnderLock(v32Store, v31Store, v30Store, v29Store,
    v28Store, v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
  const decoded = target.status === 'valid' ? decodePublicV33Root(target.raw) : null
  if (target.status === 'blocked') return { ok: false, reason: target.reason }
  if (target.status === 'valid' && !decoded) return { ok: false, reason: 'invalid-v33-root' }
  if (ancestry.status === 'blocked') return { ok: false, reason: ancestry.reason }
  if (target.status === 'missing') return { ok: false, reason: 'root-missing' }
  if (!decoded || !sameCheckedV32Source(decoded.lineage.sourceReceipt, ancestry.sourceReceipt))
    return { ok: false, reason: 'source-changed' }
  return { ok: true, value: target.raw }
}

/** For a separate successor store: one world lock, full V33 source check, then raw callback. */
export function withLockedCheckedPublicV33SourceRaw<T>(locks: PublicV7LockProvider | undefined,
  store: Store, v32Store: V32Store, v31Store: V31Store, v30Store: V30Store,
  v29Store: V29Store, v28Store: V28Store, v27Store: V27Store, v26Store: V26Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  body: (raw: unknown) => Promise<PublicV33Operation<T>>): Promise<PublicV33Operation<T>> {
  return lock(locks, async () => {
    const checked = await checkedRawSourceUnderLock(store, v32Store, v31Store, v30Store, v29Store,
      v28Store, v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
    return checked.ok ? body(checked.value) : checked
  })
}

export function inspectPublicV33(locks: PublicV7LockProvider | undefined, store: Store,
  v32Store: V32Store, v31Store: V31Store, v30Store: V30Store, v29Store: V29Store, v28Store: V28Store,
  v27Store: V27Store, v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store):
  Promise<PublicV33Operation<PublicV33Inspection>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v32Store, v31Store, v30Store, v29Store, v28Store,
      v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
    const value: PublicV33Inspection = checked.status === 'missing'
      ? { status: 'migration-available', sourceReceipt: checked.sourceReceipt }
      : checked.status === 'valid' ? { status: 'valid', start: checked.start } : checked
    return { ok: true, value }
  })
}

export function startPublicV33(locks: PublicV7LockProvider | undefined, store: Store,
  v32Store: V32Store, v31Store: V31Store, v30Store: V30Store, v29Store: V29Store, v28Store: V28Store,
  v27Store: V27Store, v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  seed: string, expectedSource: PublicV33SourceReceipt): Promise<PublicV33Operation<PublicV33Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128)
    return Promise.resolve({ ok: false, reason: 'invalid-seed' })
  let fresh: ReturnType<typeof createPublicV33Root>
  try { fresh = createPublicV33Root(expectedSource) }
  catch { return Promise.resolve({ ok: false, reason: 'invalid-source' }) }
  if (fresh.head.state.seed !== seed) return Promise.resolve({ ok: false, reason: 'invalid-source' })
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v32Store, v31Store, v30Store, v29Store, v28Store,
      v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
    if (checked.status === 'blocked') return { ok: false, reason: checked.reason }
    if (checked.status === 'valid') return { ok: false, reason: 'target-conflict' }
    if (!sameCheckedV32Source(checked.sourceReceipt, fresh.lineage.sourceReceipt))
      return { ok: false, reason: 'source-changed' }
    const write = await store.commit(checked.target.proof, fresh)
    return write === 'committed' ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: write }
  })
}

export function resumePublicV33(locks: PublicV7LockProvider | undefined, store: Store,
  v32Store: V32Store, v31Store: V31Store, v30Store: V30Store, v29Store: V29Store, v28Store: V28Store,
  v27Store: V27Store, v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV33Operation<PublicV33Start>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v32Store, v31Store, v30Store, v29Store, v28Store,
      v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    if (!matchesCheckedLineage(rawLineage, checked.start.lineage))
      return { ok: false, reason: 'lineage-changed' }
    return checked.start.head.saveRevision === revision
      ? { ok: true, value: checked.start } : { ok: false, reason: 'revision-changed' }
  })
}

async function commitWitnessUnderLock(store: Store, v32Store: V32Store, v31Store: V31Store, v30Store: V30Store,
  v29Store: V29Store, v28Store: V28Store, v27Store: V27Store, v26Store: V26Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown, witnessFromWriter: () => unknown,
  returnHome: boolean): Promise<PublicV33Operation<PublicV33Start>> {
  try {
    const checked = await inspectUnderLock(store, v32Store, v31Store, v30Store, v29Store, v28Store,
      v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    const { head, lineage } = checked.start
    if (!matchesCheckedLineage(rawLineage, lineage))
      return { ok: false, reason: 'lineage-changed' }
    if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
    if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: 'invalid-revision' }
    const decoded = decodePublicV33Witness(witnessFromWriter())
    if (!decoded || (decoded.kind === 'return-home/v1') !== returnHome)
      return { ok: false, reason: 'invalid-witness' }
    const before = { state: head.state, greenwayWorks: head.greenwayWorks,
      regionalWorks: head.regionalWorks, terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs,
      riverBridgeIds: head.riverBridgeIds, miningTools: head.miningTools,
      claimedBridgeheadId: head.claimedBridgeheadId, raisedSoilCells: head.raisedSoilCells }
    const replayed = replayPublicV33Witness(before, decoded)
    if (!replayed) {
      if (decoded.kind === 'fairy-ring-discover/v1' || decoded.kind === 'fairy-ring-travel/v1')
        return { ok: false, reason: confirmPublicV33FairyRingAction(before, decoded).rejection
          ?? 'action-rejected' }
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
    const next: PublicV33Head = { ...head, ...replayed, saveRevision: revision + 1,
      witness: structuredClone(decoded) }
    const write = await store.commit(checked.target.proof,
      { lineage, previous: head, head: next })
    return write === 'committed' ? { ok: true, value: { head: next, lineage } }
      : { ok: false, reason: write }
  } catch { return { ok: false, reason: 'storage-error' } }
}

export function commitPublicV33(locks: PublicV7LockProvider | undefined, store: Store,
  v32Store: V32Store, v31Store: V31Store, v30Store: V30Store, v29Store: V29Store, v28Store: V28Store,
  v27Store: V27Store, v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown, witness: PublicV33Witness):
  Promise<PublicV33Operation<PublicV33Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, v32Store, v31Store, v30Store, v29Store, v28Store,
    v27Store, v26Store, v25Store, v24Store, v23Store, v17Store, revision, rawLineage,
    () => witness, false))
}

export function requestPublicV33ReturnHome(locks: PublicV7LockProvider | undefined, store: Store,
  v32Store: V32Store, v31Store: V31Store, v30Store: V30Store, v29Store: V29Store, v28Store: V28Store,
  v27Store: V27Store, v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV33Operation<PublicV33Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, v32Store, v31Store, v30Store, v29Store, v28Store,
    v27Store, v26Store, v25Store, v24Store, v23Store, v17Store, revision, rawLineage,
    () => ({ kind: 'return-home/v1', atMs: Date.now() }), true))
}
