import type { createAtomicV42Store } from './atomicV42Database'
import type { createAtomicV43Store } from './atomicV43Database'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { samePublicV14Value } from './publicWorldV14Validation'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { confirmPublicV43FamiliarAction,
  decodePublicV43FamiliarWitness,
  PUBLIC_V43_PROGRESS_KEYS } from './publicWorldV43FamiliarAction'
import type { PublicV43FamiliarProgress } from './publicWorldV43FamiliarAction'
import { createFreshPublicV43Root, createPublicV43Root,
  decodePublicV43Lineage, decodePublicV43Witness,
  replayPublicV43Witness } from './publicWorldV43Snapshot'
import type { PublicV43Head, PublicV43Root,
  PublicV43Witness } from './publicWorldV43Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

type Store = ReturnType<typeof createAtomicV43Store>
type SourceStore = ReturnType<typeof createAtomicV42Store>
export type PublicV43Start = Readonly<Pick<PublicV43Root, 'head' | 'lineage'>>
export type PublicV43Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV43Inspection = { status: 'migration-available' }
  | { status: 'valid'; start: PublicV43Start }
  | { status: 'blocked'; reason: string }

function sameLineage(raw: unknown, checked: PublicV43Root['lineage']): boolean {
  return sameStrictBoundedRaw(raw, checked, 3 << 20)
    || samePublicV14Value(decodePublicV43Lineage(raw), checked)
}

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV43Operation<T>>): Promise<PublicV43Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}

export function inspectPublicV43(locks: PublicV7LockProvider | undefined,
  store: Store): Promise<PublicV43Operation<PublicV43Inspection>> {
  return lock(locks, async () => {
    const read = await store.readChecked()
    const value: PublicV43Inspection = read.status === 'missing'
      ? { status: 'migration-available' }
      : read.status === 'valid' ? { status: 'valid',
        start: { head: read.root.head, lineage: read.root.lineage } } : read
    return { ok: true, value }
  })
}

/** Reads only a checked V42 source, then atomically copies to another database. */
export function startPublicV43(locks: PublicV7LockProvider | undefined,
  store: Store, source: SourceStore, expectedSourceRevision: number):
  Promise<PublicV43Operation<PublicV43Start>> {
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
    let fresh: PublicV43Root
    try { fresh = createPublicV43Root(structuredClone(old.root)) }
    catch { return { ok: false, reason: 'invalid-source' } }
    const result = await store.commit(read.proof, fresh)
    return result === 'committed'
      ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: result }
  })
}

export function startFreshPublicV43(locks: PublicV7LockProvider | undefined,
  store: Store, seed: string): Promise<PublicV43Operation<PublicV43Start>> {
  return lock(locks, async () => {
    const read = await store.readChecked()
    if (read.status !== 'missing') return { ok: false,
      reason: read.status === 'blocked' ? read.reason : 'target-conflict' }
    let fresh: PublicV43Root
    try { fresh = createFreshPublicV43Root(seed) }
    catch { return { ok: false, reason: 'invalid-seed' } }
    const result = await store.commit(read.proof, fresh)
    return result === 'committed'
      ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
      : { ok: false, reason: result }
  })
}

export function resumePublicV43(locks: PublicV7LockProvider | undefined,
  store: Store, revision: number, rawLineage: unknown):
  Promise<PublicV43Operation<PublicV43Start>> {
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

async function commitWitnessUnderLock(store: Store, revision: number,
  rawLineage: unknown, witnessFromWriter: () => unknown, returnHome: boolean):
  Promise<PublicV43Operation<PublicV43Start>> {
  const read = await store.readChecked()
  if (read.status !== 'valid') return { ok: false,
    reason: read.status === 'blocked' ? read.reason : 'root-missing' }
  const { head, lineage } = read.root
  if (!sameLineage(rawLineage, lineage)) return { ok: false, reason: 'lineage-changed' }
  if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
  if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: 'invalid-revision' }
  const decoded = decodePublicV43Witness(witnessFromWriter())
  if (!decoded || (decoded.kind === 'return-home/v1') !== returnHome)
    return { ok: false, reason: 'invalid-witness' }
  const replayed = replayPublicV43Witness(head, decoded)
  if (!replayed) {
    if (decodePublicV43FamiliarWitness(decoded))
      return { ok: false, reason: confirmPublicV43FamiliarAction(
        Object.fromEntries(PUBLIC_V43_PROGRESS_KEYS.map((key) =>
          [key, head[key]])) as PublicV43FamiliarProgress, decoded).rejection
        ?? 'action-rejected' }
    if (returnHome && decoded.kind === 'return-home/v1') {
      const { state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs } = head
      const reason = applyPublicV26ReturnHome({ state, greenwayWorks,
        regionalWorks, terrain, nextHomeAtMs }, decoded.atMs).rejection
      if (reason === 'not_trapped' || reason === 'cooldown') return { ok: false, reason }
    }
    return { ok: false, reason: decoded.kind === 'frame-batch/v1'
      ? 'frame-rejected' : 'action-rejected' }
  }
  const next: PublicV43Head = { ...replayed, schemaVersion: head.schemaVersion,
    saveRevision: revision + 1, witness: structuredClone(decoded) }
  const result = await store.commit(read.proof, { lineage, previous: head, head: next })
  return result === 'committed' ? { ok: true, value: { head: next, lineage } }
    : { ok: false, reason: result }
}

export function commitPublicV43(locks: PublicV7LockProvider | undefined,
  store: Store, revision: number, rawLineage: unknown, witness: PublicV43Witness):
  Promise<PublicV43Operation<PublicV43Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, revision,
    rawLineage, () => witness, false))
}

export function requestPublicV43ReturnHome(locks: PublicV7LockProvider | undefined,
  store: Store, revision: number, rawLineage: unknown):
  Promise<PublicV43Operation<PublicV43Start>> {
  return lock(locks, () => commitWitnessUnderLock(store, revision,
    rawLineage, () => ({ kind: 'return-home/v1', atMs: Date.now() }), true))
}
