import type { createAtomicV17Store } from './atomicV17Database'
import type { createAtomicV23Store } from './atomicV23Database'
import type { createAtomicV24Store } from './atomicV24Database'
import type { createAtomicV25Store } from './atomicV25Database'
import type { createAtomicV26Store } from './atomicV26Database'
import type { createAtomicV27Store } from './atomicV27Database'
import type { createAtomicV28Store } from './atomicV28Database'
import type { createAtomicV29Store } from './atomicV29Database'
import type { createAtomicV30Store } from './atomicV30Database'
import type { createAtomicV31Store } from './atomicV31Database'
import type { createAtomicV32Store } from './atomicV32Database'
import type { createAtomicV33Store } from './atomicV33Database'
import type { createAtomicV34Store } from './atomicV34Database'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { confirmPublicV31SoilAction } from './publicWorldV31Soil'
import { confirmPublicV32HighlandAction } from './publicWorldV32Highland'
import { confirmPublicV33FairyRingAction } from './publicWorldV33FairyRing'
import { withLockedCheckedPublicV33SourceRaw } from './publicWorldV33Flow'
import type { PublicV33Root } from './publicWorldV33Snapshot'
import { decodePublicV33Witness, replayPublicV33Witness } from './publicWorldV33Snapshot'
import type { PublicV33Witness } from './publicWorldV33Snapshot'
import { samePublicV14Value } from './publicWorldV14Validation'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { decodePublicV34Lineage } from './publicWorldV34Snapshot'
import type { PublicV34Head, PublicV34Root } from './publicWorldV34Snapshot'
import { createPublicV34Root } from './publicWorldV34Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

type Store = ReturnType<typeof createAtomicV34Store>
type SourceStores = [ReturnType<typeof createAtomicV33Store>,
  ReturnType<typeof createAtomicV32Store>, ReturnType<typeof createAtomicV31Store>,
  ReturnType<typeof createAtomicV30Store>, ReturnType<typeof createAtomicV29Store>,
  ReturnType<typeof createAtomicV28Store>, ReturnType<typeof createAtomicV27Store>,
  ReturnType<typeof createAtomicV26Store>, ReturnType<typeof createAtomicV25Store>,
  ReturnType<typeof createAtomicV24Store>, ReturnType<typeof createAtomicV23Store>,
  ReturnType<typeof createAtomicV17Store>]
export type PublicV34Start = Readonly<Pick<PublicV34Root, 'head' | 'lineage'>>
export type PublicV34Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV34Inspection = { status: 'migration-available' }
  | { status: 'valid'; start: PublicV34Start }
  | { status: 'blocked'; reason: string }

function sameLineage(raw: unknown, checked: PublicV34Root['lineage']): boolean {
  return sameStrictBoundedRaw(raw, checked, 3 << 20)
    || samePublicV14Value(decodePublicV34Lineage(raw), checked)
}

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV34Operation<T>>): Promise<PublicV34Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}

/** Existing V34 saves are self-contained: no older database is opened here. */
export function inspectPublicV34(locks: PublicV7LockProvider | undefined,
  store: Store): Promise<PublicV34Operation<PublicV34Inspection>> {
  return lock(locks, async () => {
    const read = await store.readChecked()
    const value: PublicV34Inspection = read.status === 'missing'
      ? { status: 'migration-available' }
      : read.status === 'valid' ? { status: 'valid',
        start: { head: read.root.head, lineage: read.root.lineage } } : read
    return { ok: true, value }
  })
}

/** Explicit one-time copy from a fully checked V33-to-V17 chain. V33 is never written. */
export function startPublicV34(locks: PublicV7LockProvider | undefined,
  store: Store, ...sources: SourceStores): Promise<PublicV34Operation<PublicV34Start>> {
  return withLockedCheckedPublicV33SourceRaw(locks, ...sources, async (raw) => {
    let fresh: PublicV34Root
    try {
      // The source seam already decoded this raw root. Only an owned head leaves this callback.
      fresh = createPublicV34Root(structuredClone((raw as PublicV33Root).head))
    } catch { return { ok: false, reason: 'invalid-source' } }
    const read = await store.readChecked()
    if (read.status === 'blocked') return { ok: false, reason: read.reason }
    if (read.status === 'valid') return { ok: false, reason: 'target-conflict' }
    const result = await store.commit(read.proof, fresh)
    return result === 'committed'
      ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: result }
  })
}

export function resumePublicV34(locks: PublicV7LockProvider | undefined, store: Store,
  revision: number, rawLineage: unknown): Promise<PublicV34Operation<PublicV34Start>> {
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
  witnessFromWriter: () => unknown, returnHome: boolean): Promise<PublicV34Operation<PublicV34Start>> {
  const read = await store.readChecked()
  if (read.status !== 'valid') return { ok: false,
    reason: read.status === 'blocked' ? read.reason : 'root-missing' }
  const { head, lineage } = read.root
  if (!sameLineage(rawLineage, lineage)) return { ok: false, reason: 'lineage-changed' }
  if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
  if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: 'invalid-revision' }
  const decoded = decodePublicV33Witness(witnessFromWriter())
  if (!decoded || (decoded.kind === 'return-home/v1') !== returnHome)
    return { ok: false, reason: 'invalid-witness' }
  const replayed = replayPublicV33Witness(head, decoded)
  if (!replayed) {
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
  const next: PublicV34Head = { ...head, ...replayed, saveRevision: revision + 1,
    witness: structuredClone(decoded) }
  const result = await store.commit(read.proof, { lineage, previous: head, head: next })
  return result === 'committed' ? { ok: true, value: { head: next, lineage } }
    : { ok: false, reason: result }
}

export function commitPublicV34(locks: PublicV7LockProvider | undefined, store: Store,
  revision: number, rawLineage: unknown, witness: PublicV33Witness):
  Promise<PublicV34Operation<PublicV34Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, revision, rawLineage, () => witness, false))
}

export function requestPublicV34ReturnHome(locks: PublicV7LockProvider | undefined,
  store: Store, revision: number, rawLineage: unknown): Promise<PublicV34Operation<PublicV34Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, revision, rawLineage,
    () => ({ kind: 'return-home/v1', atMs: Date.now() }), true))
}
