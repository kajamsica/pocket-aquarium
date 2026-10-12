import type { createAtomicV37Store } from './atomicV37Database'
import type { createAtomicV38Store } from './atomicV38Database'
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
import { createFreshPublicV38Root, createPublicV38Root,
  decodePublicV38Lineage, decodePublicV38Witness,
  replayPublicV38Witness } from './publicWorldV38Snapshot'
import type { PublicV38Head, PublicV38Root, PublicV38Witness } from './publicWorldV38Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

type Store = ReturnType<typeof createAtomicV38Store>
type SourceStore = ReturnType<typeof createAtomicV37Store>
export type PublicV38Start = Readonly<Pick<PublicV38Root, 'head' | 'lineage'>>
export type PublicV38Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV38Inspection = { status: 'migration-available' }
  | { status: 'valid'; start: PublicV38Start }
  | { status: 'blocked'; reason: string }

function sameLineage(raw: unknown, checked: PublicV38Root['lineage']): boolean {
  return sameStrictBoundedRaw(raw, checked, 3 << 20)
    || samePublicV14Value(decodePublicV38Lineage(raw), checked)
}

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV38Operation<T>>): Promise<PublicV38Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}

export function inspectPublicV38(locks: PublicV7LockProvider | undefined,
  store: Store): Promise<PublicV38Operation<PublicV38Inspection>> {
  return lock(locks, async () => {
    const read = await store.readChecked()
    const value: PublicV38Inspection = read.status === 'missing'
      ? { status: 'migration-available' }
      : read.status === 'valid' ? { status: 'valid',
        start: { head: read.root.head, lineage: read.root.lineage } } : read
    return { ok: true, value }
  })
}

/** Copy only an entire checked V37 root. The V37 database remains read only. */
export function startPublicV38(locks: PublicV7LockProvider | undefined,
  store: Store, source: SourceStore, expectedSourceRevision: number):
  Promise<PublicV38Operation<PublicV38Start>> {
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
    let fresh: PublicV38Root
    try { fresh = createPublicV38Root(structuredClone(old.root)) }
    catch { return { ok: false, reason: 'invalid-source' } }
    const result = await store.commit(read.proof, fresh)
    return result === 'committed'
      ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: result }
  })
}

/** Fresh creation writes only the missing V38 root, never an older database. */
export function startFreshPublicV38(locks: PublicV7LockProvider | undefined,
  store: Store, seed: string): Promise<PublicV38Operation<PublicV38Start>> {
  return lock(locks, async () => {
    const read = await store.readChecked()
    if (read.status !== 'missing') return { ok: false,
      reason: read.status === 'blocked' ? read.reason : 'target-conflict' }
    let fresh: PublicV38Root
    try { fresh = createFreshPublicV38Root(seed) }
    catch { return { ok: false, reason: 'invalid-seed' } }
    const result = await store.commit(read.proof, fresh)
    return result === 'committed'
      ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: result }
  })
}

export function resumePublicV38(locks: PublicV7LockProvider | undefined, store: Store,
  revision: number, rawLineage: unknown): Promise<PublicV38Operation<PublicV38Start>> {
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
  Promise<PublicV38Operation<PublicV38Start>> {
  const read = await store.readChecked()
  if (read.status !== 'valid') return { ok: false,
    reason: read.status === 'blocked' ? read.reason : 'root-missing' }
  const { head, lineage } = read.root
  if (!sameLineage(rawLineage, lineage)) return { ok: false, reason: 'lineage-changed' }
  if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
  if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: 'invalid-revision' }
  const decoded = decodePublicV38Witness(witnessFromWriter())
  if (!decoded || (decoded.kind === 'return-home/v1') !== returnHome)
    return { ok: false, reason: 'invalid-witness' }
  const replayed = replayPublicV38Witness(head, decoded)
  if (!replayed) {
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
  const next: PublicV38Head = { ...replayed, schemaVersion: head.schemaVersion,
    saveRevision: revision + 1, witness: structuredClone(decoded) }
  const result = await store.commit(read.proof, { lineage, previous: head, head: next })
  return result === 'committed' ? { ok: true, value: { head: next, lineage } }
    : { ok: false, reason: result }
}

export function commitPublicV38(locks: PublicV7LockProvider | undefined, store: Store,
  revision: number, rawLineage: unknown, witness: PublicV38Witness):
  Promise<PublicV38Operation<PublicV38Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, revision, rawLineage, () => witness, false))
}

export function requestPublicV38ReturnHome(locks: PublicV7LockProvider | undefined,
  store: Store, revision: number, rawLineage: unknown): Promise<PublicV38Operation<PublicV38Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, revision, rawLineage,
    () => ({ kind: 'return-home/v1', atMs: Date.now() }), true))
}
