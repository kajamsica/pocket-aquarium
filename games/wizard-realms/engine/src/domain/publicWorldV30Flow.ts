import type { createAtomicV17Store } from './atomicV17Database'
import type { createAtomicV23Store } from './atomicV23Database'
import type { createAtomicV24Store } from './atomicV24Database'
import type { createAtomicV25Store } from './atomicV25Database'
import type { createAtomicV26Store } from './atomicV26Database'
import type { createAtomicV27Store } from './atomicV27Database'
import type { createAtomicV28Store } from './atomicV28Database'
import type { createAtomicV29Store } from './atomicV29Database'
import type { createAtomicV30Store, AtomicV30Read } from './atomicV30Database'
import { samePublicV14Value } from './publicWorldV14Validation'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { inspectPublicV29UnderLock } from './publicWorldV29Flow'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { confirmPublicV30BridgeheadClaim } from './publicWorldV30BridgeheadAction'
import { decodePublicV30Lineage } from './publicWorldV30Migration'
import type { PublicV30Lineage, PublicV30SourceReceipt } from './publicWorldV30Migration'
import { createPublicV30Root, decodePublicV30Witness,
  replayPublicV30Witness } from './publicWorldV30Snapshot'
import type { PublicV30Head, PublicV30Witness } from './publicWorldV30Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

type Store = ReturnType<typeof createAtomicV30Store>
type V29Store = ReturnType<typeof createAtomicV29Store>
type V28Store = ReturnType<typeof createAtomicV28Store>
type V27Store = ReturnType<typeof createAtomicV27Store>
type V26Store = ReturnType<typeof createAtomicV26Store>
type V25Store = ReturnType<typeof createAtomicV25Store>
type V24Store = ReturnType<typeof createAtomicV24Store>
type V23Store = ReturnType<typeof createAtomicV23Store>
type V17Store = ReturnType<typeof createAtomicV17Store>
export type PublicV30WriterPhase = 'lock-wait' | 'v30-checked-read'
  | 'v29-ancestry-inspect' | 'lineage-witness-replay' | 'v30-commit'
export type PublicV30WriterTiming = (sample: Readonly<{
  phase: PublicV30WriterPhase; durationMs: number }>) => void
function report(onPhase: PublicV30WriterTiming | undefined,
  phase: PublicV30WriterPhase, startedAt: number) {
  if (!onPhase) return
  const durationMs = performance.now() - startedAt
  if (!Number.isFinite(durationMs) || durationMs < 0) return
  try { onPhase({ phase, durationMs }) }
  catch { /* Diagnostics must not affect checked writes. */ }
}
export type PublicV30Start = Readonly<{ head: PublicV30Head; lineage: PublicV30Lineage }>
export type PublicV30Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV30Inspection = { status: 'migration-available'; sourceReceipt: PublicV30SourceReceipt }
  | { status: 'valid'; start: PublicV30Start }
  | { status: 'blocked'; reason: string }
type Checked = { status: 'missing'; target: Extract<AtomicV30Read, { status: 'missing' }>;
    sourceReceipt: PublicV30SourceReceipt }
  | { status: 'valid'; target: Extract<AtomicV30Read, { status: 'valid' }>;
    start: PublicV30Start }
  | { status: 'blocked'; reason: string }

function matchesCheckedLineage(rawLineage: unknown, checked: PublicV30Lineage): boolean {
  return sameStrictBoundedRaw(rawLineage, checked, 3 << 20)
    || samePublicV14Value(decodePublicV30Lineage(rawLineage), checked)
}

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV30Operation<T>>,
  onPhase?: PublicV30WriterTiming): Promise<PublicV30Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  const startedAt = onPhase ? performance.now() : 0
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, () => {
    report(onPhase, 'lock-wait', startedAt)
    return body()
  }) }
  catch { return { ok: false, reason: 'storage-error' } }
}

/** V29's under-lock inspector proves its complete live ancestry without reacquiring the lock. */
async function inspectUnderLock(store: Store, v29Store: V29Store, v28Store: V28Store,
  v27Store: V27Store, v26Store: V26Store, v25Store: V25Store,
  v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  onPhase?: PublicV30WriterTiming): Promise<Checked> {
  const readStartedAt = onPhase ? performance.now() : 0
  let target: AtomicV30Read
  try { target = await store.readChecked() }
  finally { report(onPhase, 'v30-checked-read', readStartedAt) }
  const sourceStartedAt = onPhase ? performance.now() : 0
  try {
    const source = await inspectPublicV29UnderLock(v29Store, v28Store, v27Store,
      v26Store, v25Store, v24Store, v23Store, v17Store)
    if (target.status === 'blocked') return target
    if (source.status === 'blocked') return { status: 'blocked',
      reason: source.reason.startsWith('source-') ? source.reason : `source-${source.reason}` }
    if (source.status !== 'valid') return { status: 'blocked', reason: 'source-v29-missing' }
    const sourceReceipt = source.start
    if (target.status === 'missing') return { status: 'missing', target, sourceReceipt }
    if (!samePublicV14Value(target.root.lineage.sourceReceipt, sourceReceipt))
      return { status: 'blocked', reason: 'source-changed' }
    return { status: 'valid', target,
      start: { head: target.root.head, lineage: target.root.lineage } }
  } finally { report(onPhase, 'v29-ancestry-inspect', sourceStartedAt) }
}

export function inspectPublicV30(locks: PublicV7LockProvider | undefined, store: Store,
  v29Store: V29Store, v28Store: V28Store, v27Store: V27Store, v26Store: V26Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store):
  Promise<PublicV30Operation<PublicV30Inspection>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v29Store, v28Store, v27Store, v26Store,
      v25Store, v24Store, v23Store, v17Store)
    const value: PublicV30Inspection = checked.status === 'missing'
      ? { status: 'migration-available', sourceReceipt: checked.sourceReceipt }
      : checked.status === 'valid' ? { status: 'valid', start: checked.start } : checked
    return { ok: true, value }
  })
}

export function startPublicV30(locks: PublicV7LockProvider | undefined, store: Store,
  v29Store: V29Store, v28Store: V28Store, v27Store: V27Store, v26Store: V26Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  seed: string, expectedSource: PublicV30SourceReceipt): Promise<PublicV30Operation<PublicV30Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128)
    return Promise.resolve({ ok: false, reason: 'invalid-seed' })
  let fresh: ReturnType<typeof createPublicV30Root>
  try { fresh = createPublicV30Root(expectedSource) }
  catch { return Promise.resolve({ ok: false, reason: 'invalid-source' }) }
  if (fresh.head.state.seed !== seed) return Promise.resolve({ ok: false, reason: 'invalid-source' })
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v29Store, v28Store, v27Store, v26Store,
      v25Store, v24Store, v23Store, v17Store)
    if (checked.status === 'blocked') return { ok: false, reason: checked.reason }
    if (checked.status === 'valid') return { ok: false, reason: 'target-conflict' }
    if (!samePublicV14Value(checked.sourceReceipt, fresh.lineage.sourceReceipt))
      return { ok: false, reason: 'source-changed' }
    const write = await store.commit(checked.target.proof, fresh)
    return write === 'committed' ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: write }
  })
}

export function resumePublicV30(locks: PublicV7LockProvider | undefined, store: Store,
  v29Store: V29Store, v28Store: V28Store, v27Store: V27Store, v26Store: V26Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV30Operation<PublicV30Start>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, v29Store, v28Store, v27Store, v26Store,
      v25Store, v24Store, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    if (!matchesCheckedLineage(rawLineage, checked.start.lineage))
      return { ok: false, reason: 'lineage-changed' }
    return checked.start.head.saveRevision === revision
      ? { ok: true, value: checked.start } : { ok: false, reason: 'revision-changed' }
  })
}

async function commitWitnessUnderLock(store: Store, v29Store: V29Store, v28Store: V28Store,
  v27Store: V27Store, v26Store: V26Store, v25Store: V25Store, v24Store: V24Store,
  v23Store: V23Store, v17Store: V17Store, revision: number, rawLineage: unknown,
  witnessFromWriter: () => unknown, returnHome: boolean,
  onPhase?: PublicV30WriterTiming): Promise<PublicV30Operation<PublicV30Start>> {
  try {
    const checked = await inspectUnderLock(store, v29Store, v28Store, v27Store, v26Store,
      v25Store, v24Store, v23Store, v17Store, onPhase)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    const { head, lineage } = checked.start
    const replayStartedAt = onPhase ? performance.now() : 0
    let next: PublicV30Head
    try {
      if (!matchesCheckedLineage(rawLineage, lineage))
        return { ok: false, reason: 'lineage-changed' }
      if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
      if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: 'invalid-revision' }
      const decoded = decodePublicV30Witness(witnessFromWriter())
      if (!decoded || (decoded.kind === 'return-home/v1') !== returnHome)
        return { ok: false, reason: 'invalid-witness' }
      const before = { state: head.state, greenwayWorks: head.greenwayWorks,
        regionalWorks: head.regionalWorks, terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs,
        riverBridgeIds: head.riverBridgeIds, miningTools: head.miningTools,
        claimedBridgeheadId: head.claimedBridgeheadId }
      const replayed = replayPublicV30Witness(before, decoded)
      if (!replayed) {
        if (decoded.kind === 'bridgehead-claim/v1') return { ok: false,
          reason: confirmPublicV30BridgeheadClaim(before, decoded.bridgeId).rejection
            ?? 'frame-rejected' }
        if (returnHome && decoded.kind === 'return-home/v1') {
          const reason = applyPublicV26ReturnHome({ state: before.state,
            greenwayWorks: before.greenwayWorks, regionalWorks: before.regionalWorks,
            terrain: before.terrain, nextHomeAtMs: before.nextHomeAtMs }, decoded.atMs).rejection
          if (reason === 'not_trapped' || reason === 'cooldown') return { ok: false, reason }
        }
        return { ok: false, reason: 'frame-rejected' }
      }
      next = { ...head, ...replayed, saveRevision: revision + 1,
        witness: structuredClone(decoded) }
    } finally { report(onPhase, 'lineage-witness-replay', replayStartedAt) }
    const commitStartedAt = onPhase ? performance.now() : 0
    let write: Awaited<ReturnType<Store['commit']>>
    try { write = await store.commit(checked.target.proof,
      { lineage, previous: head, head: next }) }
    finally { report(onPhase, 'v30-commit', commitStartedAt) }
    return write === 'committed' ? { ok: true, value: { head: next, lineage } }
      : { ok: false, reason: write }
  } catch { return { ok: false, reason: 'storage-error' } }
}

export function commitPublicV30(locks: PublicV7LockProvider | undefined, store: Store,
  v29Store: V29Store, v28Store: V28Store, v27Store: V27Store, v26Store: V26Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown, witness: PublicV30Witness,
  onPhase?: PublicV30WriterTiming):
  Promise<PublicV30Operation<PublicV30Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, v29Store, v28Store, v27Store,
    v26Store, v25Store, v24Store, v23Store, v17Store, revision, rawLineage,
    () => witness, false, onPhase), onPhase)
}

export function requestPublicV30ReturnHome(locks: PublicV7LockProvider | undefined, store: Store,
  v29Store: V29Store, v28Store: V28Store, v27Store: V27Store, v26Store: V26Store,
  v25Store: V25Store, v24Store: V24Store, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV30Operation<PublicV30Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, v29Store, v28Store, v27Store,
    v26Store, v25Store, v24Store, v23Store, v17Store, revision, rawLineage,
    () => ({ kind: 'return-home/v1', atMs: Date.now() }), true))
}
