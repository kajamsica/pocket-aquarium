import type { createAtomicV17Store } from './atomicV17Database'
import type { createAtomicV23Store } from './atomicV23Database'
import type { createAtomicV24Store } from './atomicV24Database'
import type { createAtomicV25Store, AtomicV25Read } from './atomicV25Database'
import { samePublicV14Value } from './publicWorldV14Validation'
import { inspectPublicV24UnderLock } from './publicWorldV24Flow'
import { applyPublicV23Witness, visitPublicV23Frames } from './publicWorldV23Transitions'
import { applyPublicV24MireglassAction } from './publicWorldV24MireglassAction'
import { decodePublicV24Witness } from './publicWorldV24Snapshot'
import type { PublicV24Witness } from './publicWorldV24Snapshot'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { decodePublicV25Lineage, decodePublicV25SourceReceipt } from './publicWorldV25Migration'
import type { PublicV25Lineage, PublicV25SourceReceipt } from './publicWorldV25Migration'
import { publicV25RiverPassage } from './publicWorldV25Passage'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import type { PublicV25Head } from './publicWorldV25Snapshot'

type Store = ReturnType<typeof createAtomicV25Store>
type SourceStore = ReturnType<typeof createAtomicV24Store>
type V23Store = ReturnType<typeof createAtomicV23Store>
type V17Store = ReturnType<typeof createAtomicV17Store>
export type PublicV25Start = Readonly<{ head: PublicV25Head; lineage: PublicV25Lineage }>
export type PublicV25Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV25Inspection = { status: 'migration-available'; sourceReceipt: PublicV25SourceReceipt }
  | { status: 'valid'; start: PublicV25Start }
  | { status: 'blocked'; reason: string }
export type PublicV25UnderLockRead = { status: 'missing'; target: Extract<AtomicV25Read, { status: 'missing' }>;
    sourceReceipt: PublicV25SourceReceipt }
  | { status: 'valid'; target: Extract<AtomicV25Read, { status: 'valid' }>;
    start: PublicV25Start }
  | { status: 'blocked'; reason: string }

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV25Operation<T>>): Promise<PublicV25Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}

/** Check the V25 root and complete live source chain. Caller must already own the world lock. */
export async function inspectPublicV25UnderLock(store: Store, sourceStore: SourceStore,
  v23Store: V23Store, v17Store: V17Store): Promise<PublicV25UnderLockRead> {
  const target = await store.readChecked()
  const source = await inspectPublicV24UnderLock(sourceStore, v23Store, v17Store)
  if (target.status === 'blocked') return target
  if (source.status === 'blocked') return { status: 'blocked',
    reason: source.reason.startsWith('source-') ? source.reason : `source-${source.reason}` }
  if (source.status !== 'valid') return { status: 'blocked', reason: 'source-v24-missing' }
  const sourceReceipt = { head: source.start.head, lineage: source.start.lineage }
  if (target.status === 'missing') return { status: 'missing', target, sourceReceipt }
  if (!samePublicV14Value(target.root.lineage.sourceReceipt, sourceReceipt))
    return { status: 'blocked', reason: 'source-changed' }
  return { status: 'valid', target,
    start: { head: target.root.head, lineage: target.root.lineage } }
}

export function inspectPublicV25(locks: PublicV7LockProvider | undefined, store: Store,
  sourceStore: SourceStore, v23Store: V23Store, v17Store: V17Store):
  Promise<PublicV25Operation<PublicV25Inspection>> {
  return lock(locks, async () => {
    const checked = await inspectPublicV25UnderLock(store, sourceStore, v23Store, v17Store)
    const value: PublicV25Inspection = checked.status === 'missing'
      ? { status: 'migration-available', sourceReceipt: checked.sourceReceipt }
      : checked.status === 'valid' ? { status: 'valid', start: checked.start } : checked
    return { ok: true, value }
  })
}

export function startPublicV25(locks: PublicV7LockProvider | undefined, store: Store,
  sourceStore: SourceStore, v23Store: V23Store, v17Store: V17Store,
  seed: string, expectedSource: PublicV25SourceReceipt): Promise<PublicV25Operation<PublicV25Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128)
    return Promise.resolve({ ok: false, reason: 'invalid-seed' })
  const expected = decodePublicV25SourceReceipt(expectedSource)
  if (!expected || expected.head.state.seed !== seed)
    return Promise.resolve({ ok: false, reason: 'invalid-source' })
  return lock(locks, async () => {
    const checked = await inspectPublicV25UnderLock(store, sourceStore, v23Store, v17Store)
    if (checked.status === 'blocked') return { ok: false, reason: checked.reason }
    if (checked.status === 'valid') return { ok: false, reason: 'target-conflict' }
    if (!samePublicV14Value(checked.sourceReceipt, expected))
      return { ok: false, reason: 'source-changed' }
    let fresh: ReturnType<typeof createPublicV25Root>
    try { fresh = createPublicV25Root(expected) }
    catch { return { ok: false, reason: 'source-unplaceable' } }
    const write = await store.commit(checked.target.proof, fresh)
    return write === 'committed' ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: write }
  })
}

export function resumePublicV25(locks: PublicV7LockProvider | undefined, store: Store,
  sourceStore: SourceStore, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown): Promise<PublicV25Operation<PublicV25Start>> {
  return lock(locks, async () => {
    const checked = await inspectPublicV25UnderLock(store, sourceStore, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    if (!samePublicV14Value(decodePublicV25Lineage(rawLineage), checked.start.lineage))
      return { ok: false, reason: 'lineage-changed' }
    return checked.start.head.saveRevision === revision
      ? { ok: true, value: checked.start } : { ok: false, reason: 'revision-changed' }
  })
}

export function commitPublicV25(locks: PublicV7LockProvider | undefined, store: Store,
  sourceStore: SourceStore, v23Store: V23Store, v17Store: V17Store,
  revision: number, rawLineage: unknown, witness: PublicV24Witness):
  Promise<PublicV25Operation<PublicV25Start>> {
  return lock(locks, async () => {
    const checked = await inspectPublicV25UnderLock(store, sourceStore, v23Store, v17Store)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    const { head, lineage } = checked.start
    if (!samePublicV14Value(decodePublicV25Lineage(rawLineage), lineage))
      return { ok: false, reason: 'lineage-changed' }
    if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
    if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: 'invalid-revision' }
    const decoded = decodePublicV24Witness(witness)
    if (!decoded) return { ok: false, reason: 'invalid-witness' }
    const before = { state: head.state, greenwayWorks: head.greenwayWorks,
      regionalWorks: head.regionalWorks }
    let rejection: string | null = null
    const result = decoded.kind === 'frame-batch/v1'
      ? visitPublicV23Frames(before, decoded.frames, (prior, after) => {
        const passage = publicV25RiverPassage(prior, prior.state.player.position,
          after.state.player.position)
        if (!passage.ok) rejection = passage.reason
        return passage.ok
      })
      : decoded.kind === 'mireglass-action/v1'
        ? applyPublicV24MireglassAction(before, decoded.action)
        : applyPublicV23Witness(before, decoded)
    if (!result || 'rejection' in result) return { ok: false,
      reason: rejection ?? (result && 'rejection' in result ? result.rejection : 'frame-rejected') ?? 'invalid-witness' }
    const progress = 'progress' in result ? result.progress : result
    const next: PublicV25Head = { ...head, ...progress, saveRevision: revision + 1,
      witness: structuredClone(decoded) }
    const write = await store.commit(checked.target.proof,
      { lineage, previous: head, head: next })
    return write === 'committed' ? { ok: true, value: { head: next, lineage } }
      : { ok: false, reason: write }
  })
}
