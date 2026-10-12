import type { createAtomicV34Store } from './atomicV34Database'
import type { createAtomicV35Store } from './atomicV35Database'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { confirmPublicV31SoilAction } from './publicWorldV31Soil'
import { confirmPublicV32HighlandAction } from './publicWorldV32Highland'
import { confirmPublicV33FairyRingAction } from './publicWorldV33FairyRing'
import { samePublicV14Value } from './publicWorldV14Validation'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { confirmPublicV35LedgerAction } from './publicWorldV35LedgerAction'
import { createPublicV35Root, decodePublicV35Lineage, decodePublicV35Witness,
  replayPublicV35Witness } from './publicWorldV35Snapshot'
import type { PublicV35Head, PublicV35Root, PublicV35Witness } from './publicWorldV35Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

type Store = ReturnType<typeof createAtomicV35Store>
type SourceStore = ReturnType<typeof createAtomicV34Store>
export type PublicV35Start = Readonly<Pick<PublicV35Root, 'head' | 'lineage'>>
export type PublicV35Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV35Inspection = { status: 'migration-available' }
  | { status: 'valid'; start: PublicV35Start }
  | { status: 'blocked'; reason: string }

function sameLineage(raw: unknown, checked: PublicV35Root['lineage']): boolean {
  return sameStrictBoundedRaw(raw, checked, 3 << 20)
    || samePublicV14Value(decodePublicV35Lineage(raw), checked)
}

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV35Operation<T>>): Promise<PublicV35Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}

export function inspectPublicV35(locks: PublicV7LockProvider | undefined,
  store: Store): Promise<PublicV35Operation<PublicV35Inspection>> {
  return lock(locks, async () => {
    const read = await store.readChecked()
    const value: PublicV35Inspection = read.status === 'missing'
      ? { status: 'migration-available' }
      : read.status === 'valid' ? { status: 'valid',
        start: { head: read.root.head, lineage: read.root.lineage } } : read
    return { ok: true, value }
  })
}

/** Explicit one-time copy of a checked, self-contained V34 head; V34 is read only. */
export function startPublicV35(locks: PublicV7LockProvider | undefined,
  store: Store, source: SourceStore): Promise<PublicV35Operation<PublicV35Start>> {
  return lock(locks, async () => {
    const old = await source.readChecked()
    if (old.status !== 'valid') return { ok: false,
      reason: old.status === 'blocked' ? old.reason : 'source-missing' }
    const read = await store.readChecked()
    if (read.status !== 'missing') return { ok: false,
      reason: read.status === 'blocked' ? read.reason : 'target-conflict' }
    let fresh: PublicV35Root
    try { fresh = createPublicV35Root(structuredClone(old.root.head)) }
    catch { return { ok: false, reason: 'invalid-source' } }
    const result = await store.commit(read.proof, fresh)
    return result === 'committed'
      ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: result }
  })
}

export function resumePublicV35(locks: PublicV7LockProvider | undefined, store: Store,
  revision: number, rawLineage: unknown): Promise<PublicV35Operation<PublicV35Start>> {
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
  Promise<PublicV35Operation<PublicV35Start>> {
  const read = await store.readChecked()
  if (read.status !== 'valid') return { ok: false,
    reason: read.status === 'blocked' ? read.reason : 'root-missing' }
  const { head, lineage } = read.root
  if (!sameLineage(rawLineage, lineage)) return { ok: false, reason: 'lineage-changed' }
  if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
  if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: 'invalid-revision' }
  const decoded = decodePublicV35Witness(witnessFromWriter())
  if (!decoded || (decoded.kind === 'return-home/v1') !== returnHome)
    return { ok: false, reason: 'invalid-witness' }
  const replayed = replayPublicV35Witness(head, decoded)
  if (!replayed) {
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
  const next: PublicV35Head = { ...head, ...replayed, saveRevision: revision + 1,
    witness: structuredClone(decoded) }
  const result = await store.commit(read.proof, { lineage, previous: head, head: next })
  return result === 'committed' ? { ok: true, value: { head: next, lineage } }
    : { ok: false, reason: result }
}

export function commitPublicV35(locks: PublicV7LockProvider | undefined, store: Store,
  revision: number, rawLineage: unknown, witness: PublicV35Witness):
  Promise<PublicV35Operation<PublicV35Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, revision, rawLineage, () => witness, false))
}

export function requestPublicV35ReturnHome(locks: PublicV7LockProvider | undefined,
  store: Store, revision: number, rawLineage: unknown): Promise<PublicV35Operation<PublicV35Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, revision, rawLineage,
    () => ({ kind: 'return-home/v1', atMs: Date.now() }), true))
}
