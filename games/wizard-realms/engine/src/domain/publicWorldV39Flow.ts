import type { createAtomicV38Store } from './atomicV38Database'
import type { createAtomicV39Store } from './atomicV39Database'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { confirmPublicV31SoilAction } from './publicWorldV31Soil'
import { confirmPublicV32HighlandAction } from './publicWorldV32Highland'
import { confirmPublicV33FairyRingAction } from './publicWorldV33FairyRing'
import { samePublicV14Value } from './publicWorldV14Validation'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { confirmPublicV35LedgerAction } from './publicWorldV35LedgerAction'
import { confirmPublicV36MarkerAction } from './publicWorldV36MarkerAction'
import { confirmPublicV37WindwardAction } from './publicWorldV37WindwardAction'
import { confirmPublicV38SignalAction } from './publicWorldV38SignalAction'
import { confirmPublicV39RingAction } from './publicWorldV39RingAction'
import { createFreshPublicV39Root, createPublicV39Root,
  decodePublicV39Lineage, decodePublicV39Witness,
  replayPublicV39Witness } from './publicWorldV39Snapshot'
import type { PublicV39Head, PublicV39Root, PublicV39Witness } from './publicWorldV39Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

type Store = ReturnType<typeof createAtomicV39Store>
type SourceStore = ReturnType<typeof createAtomicV38Store>
export type PublicV39Start = Readonly<Pick<PublicV39Root, 'head' | 'lineage'>>
export type PublicV39Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV39Inspection = { status: 'migration-available' }
  | { status: 'valid'; start: PublicV39Start }
  | { status: 'blocked'; reason: string }

function sameLineage(raw: unknown, checked: PublicV39Root['lineage']): boolean {
  return sameStrictBoundedRaw(raw, checked, 3 << 20)
    || samePublicV14Value(decodePublicV39Lineage(raw), checked)
}

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV39Operation<T>>): Promise<PublicV39Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}

export function inspectPublicV39(locks: PublicV7LockProvider | undefined,
  store: Store): Promise<PublicV39Operation<PublicV39Inspection>> {
  return lock(locks, async () => {
    const read = await store.readChecked()
    const value: PublicV39Inspection = read.status === 'missing'
      ? { status: 'migration-available' }
      : read.status === 'valid' ? { status: 'valid',
        start: { head: read.root.head, lineage: read.root.lineage } } : read
    return { ok: true, value }
  })
}

/** Copy only an entire checked V38 root. The V38 database remains read only. */
export function startPublicV39(locks: PublicV7LockProvider | undefined,
  store: Store, source: SourceStore, expectedSourceRevision: number):
  Promise<PublicV39Operation<PublicV39Start>> {
  return lock(locks, async () => {
    const old = await source.readChecked()
    if (old.status !== 'valid') return { ok: false,
      reason: old.status === 'blocked' ? old.reason : 'source-missing' }
    if (!Number.isSafeInteger(expectedSourceRevision) || expectedSourceRevision < 0)
      return { ok: false, reason: 'invalid-source-revision' }
    if (old.root.head.saveRevision !== expectedSourceRevision)
      return { ok: false, reason: 'source-revision-changed' }
    const read = await store.readChecked()
    if (read.status !== 'missing') return { ok: false,
      reason: read.status === 'blocked' ? read.reason : 'target-conflict' }
    let fresh: PublicV39Root
    try { fresh = createPublicV39Root(structuredClone(old.root)) }
    catch { return { ok: false, reason: 'invalid-source' } }
    const result = await store.commit(read.proof, fresh)
    return result === 'committed'
      ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: result }
  })
}

/** Fresh creation writes only the missing V39 root, never an older database. */
export function startFreshPublicV39(locks: PublicV7LockProvider | undefined,
  store: Store, seed: string): Promise<PublicV39Operation<PublicV39Start>> {
  return lock(locks, async () => {
    const read = await store.readChecked()
    if (read.status !== 'missing') return { ok: false,
      reason: read.status === 'blocked' ? read.reason : 'target-conflict' }
    let fresh: PublicV39Root
    try { fresh = createFreshPublicV39Root(seed) }
    catch { return { ok: false, reason: 'invalid-seed' } }
    const result = await store.commit(read.proof, fresh)
    return result === 'committed'
      ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: result }
  })
}

export function resumePublicV39(locks: PublicV7LockProvider | undefined, store: Store,
  revision: number, rawLineage: unknown): Promise<PublicV39Operation<PublicV39Start>> {
  return lock(locks, async () => {
    const read = await store.readChecked()
    if (read.status !== 'valid') return { ok: false,
      reason: read.status === 'blocked' ? read.reason : 'root-missing' }
    if (!sameLineage(rawLineage, read.root.lineage))
      return { ok: false, reason: 'lineage-changed' }
    return read.root.head.saveRevision === revision
      ? { ok: true, value: { head: read.root.head, lineage: read.root.lineage } }
      : { ok: false, reason: 'revision-changed' }
  })
}

async function commitWitnessUnderLock(store: Store, revision: number, rawLineage: unknown,
  witnessFromWriter: () => unknown, returnHome: boolean):
  Promise<PublicV39Operation<PublicV39Start>> {
  const read = await store.readChecked()
  if (read.status !== 'valid') return { ok: false,
    reason: read.status === 'blocked' ? read.reason : 'root-missing' }
  const { head, lineage } = read.root
  if (!sameLineage(rawLineage, lineage)) return { ok: false, reason: 'lineage-changed' }
  if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
  if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: 'invalid-revision' }
  const decoded = decodePublicV39Witness(witnessFromWriter())
  if (!decoded || (decoded.kind === 'return-home/v1') !== returnHome)
    return { ok: false, reason: 'invalid-witness' }
  const replayed = replayPublicV39Witness(head, decoded)
  if (!replayed) {
    if (decoded.kind === 'ringkeeper-discover/v1' || decoded.kind === 'ringkeeper-link/v1'
      || decoded.kind === 'ringkeeper-travel/v1' || decoded.kind === 'ringkeeper-claim/v1')
      return { ok: false, reason: confirmPublicV39RingAction(head, decoded).rejection
        ?? 'action-rejected' }
    if (decoded.kind === 'signal-vantage/v1' || decoded.kind === 'signal-claim/v1')
      return { ok: false, reason: confirmPublicV38SignalAction(head, decoded).rejection
        ?? 'action-rejected' }
    if (decoded.kind === 'windward-study/v1' || decoded.kind === 'windward-cast/v1')
      return { ok: false, reason: confirmPublicV37WindwardAction(head, decoded).rejection
        ?? 'action-rejected' }
    if (decoded.kind === 'marker-claim/v1')
      return { ok: false, reason: confirmPublicV36MarkerAction(head, decoded).rejection
        ?? 'action-rejected' }
    if (decoded.kind === 'ledger-survey/v1' || decoded.kind === 'ledger-deliver/v1')
      return { ok: false, reason: confirmPublicV35LedgerAction(head, decoded).rejection
        ?? 'action-rejected' }
    if (decoded.kind === 'fairy-ring-discover/v1' || decoded.kind === 'fairy-ring-travel/v1')
      return { ok: false, reason: confirmPublicV33FairyRingAction(head, decoded).rejection
        ?? 'action-rejected' }
    if (decoded.kind === 'highland-discover/v1' || decoded.kind === 'highland-extract/v1')
      return { ok: false, reason: confirmPublicV32HighlandAction(head, decoded).rejection
        ?? 'action-rejected' }
    if (decoded.kind === 'soil-place/v1' || decoded.kind === 'soil-remove/v1')
      return { ok: false, reason: confirmPublicV31SoilAction(head, decoded).rejection
        ?? 'frame-rejected' }
    if (returnHome && decoded.kind === 'return-home/v1') {
      const reason = applyPublicV26ReturnHome(head, decoded.atMs).rejection
      if (reason === 'not_trapped' || reason === 'cooldown') return { ok: false, reason }
    }
    return { ok: false, reason: 'frame-rejected' }
  }
  const next: PublicV39Head = { ...replayed, schemaVersion: head.schemaVersion,
    saveRevision: revision + 1, witness: structuredClone(decoded) }
  const result = await store.commit(read.proof, { lineage, previous: head, head: next })
  return result === 'committed' ? { ok: true, value: { head: next, lineage } }
    : { ok: false, reason: result }
}

export function commitPublicV39(locks: PublicV7LockProvider | undefined, store: Store,
  revision: number, rawLineage: unknown, witness: PublicV39Witness):
  Promise<PublicV39Operation<PublicV39Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, revision, rawLineage, () => witness, false))
}

export function requestPublicV39ReturnHome(locks: PublicV7LockProvider | undefined,
  store: Store, revision: number, rawLineage: unknown): Promise<PublicV39Operation<PublicV39Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, revision, rawLineage,
    () => ({ kind: 'return-home/v1', atMs: Date.now() }), true))
}
