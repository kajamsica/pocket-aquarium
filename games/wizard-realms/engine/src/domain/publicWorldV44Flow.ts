import type { createAtomicV43Store } from './atomicV43Database'
import type { createAtomicV44Store } from './atomicV44Database'
import { confirmPublicV44GroundMountAction } from './publicWorldV44GroundMount'
import { createPublicV44Root, decodePublicV44Witness,
  decodePublicV44CheckedSuccessor } from './publicWorldV44Snapshot'
import type { PublicV44Head, PublicV44Root,
  PublicV44Witness } from './publicWorldV44Snapshot'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

type Store = ReturnType<typeof createAtomicV44Store>
type SourceStore = ReturnType<typeof createAtomicV43Store>
export type PublicV44Start = Readonly<Pick<PublicV44Root, 'head' | 'lineage'>>
export type PublicV44Operation<T> = { ok: true; value: T }
  | { ok: false; reason: string }
export type PublicV44Inspection = { status: 'migration-available'; sourceRevision: number }
  | { status: 'valid'; start: PublicV44Start }
  | { status: 'blocked'; reason: string }

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV44Operation<T>>): Promise<PublicV44Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}

/** V43 is not sealed by this local prototype. Every V44 read/write fences on
 * the exact imported checked source and fails closed if a V43 writer advances. */
async function succession(store: Store, source: SourceStore, create: boolean,
  expectedSourceRevision?: number): Promise<
    { status: 'migration-available'; sourceRevision: number }
    | { status: 'valid'; root: PublicV44Root }
    | { status: 'blocked'; reason: string }> {
  const old = await source.readChecked()
  if (old.status !== 'valid') return { status: 'blocked',
    reason: old.status === 'blocked' ? old.reason : 'source-missing' }
  if (expectedSourceRevision !== undefined
    && old.root.head.saveRevision !== expectedSourceRevision)
    return { status: 'blocked', reason: 'source-revision-changed' }
  const target = await store.readChecked()
  if (target.status === 'blocked') return { status: 'blocked', reason: target.reason }
  if (target.status === 'valid') {
    const { lineage } = target.root
    if (lineage.sourceRevision !== old.root.head.saveRevision
      || !sameStrictBoundedRaw(lineage.source, old.root, 3 << 20))
      return { status: 'blocked', reason: 'source-changed' }
    return { status: 'valid', root: target.root }
  }
  if (!create) return { status: 'migration-available',
    sourceRevision: old.root.head.saveRevision }
  let genesis: PublicV44Root
  try { genesis = createPublicV44Root(old.root) }
  catch { return { status: 'blocked', reason: 'invalid-source' } }
  const result = await store.commit(target.proof, genesis)
  if (result !== 'committed') return { status: 'blocked', reason: result }
  return { status: 'valid', root: genesis }
}

export function inspectPublicV44(locks: PublicV7LockProvider | undefined,
  store: Store, source: SourceStore): Promise<PublicV44Operation<PublicV44Inspection>> {
  return lock(locks, async () => {
    const result = await succession(store, source, false)
    const value: PublicV44Inspection = result.status === 'valid'
      ? { status: 'valid', start: { head: result.root.head,
        lineage: result.root.lineage } } : result
    return { ok: true, value }
  })
}

export function startPublicV44(locks: PublicV7LockProvider | undefined,
  store: Store, source: SourceStore, expectedSourceRevision: number):
  Promise<PublicV44Operation<PublicV44Start>> {
  return lock(locks, async () => {
    if (!Number.isSafeInteger(expectedSourceRevision) || expectedSourceRevision < 0)
      return { ok: false, reason: 'invalid-source-revision' }
    const result = await succession(store, source, true, expectedSourceRevision)
    return result.status === 'valid'
      ? { ok: true, value: { head: result.root.head, lineage: result.root.lineage } }
      : { ok: false, reason: result.status === 'blocked'
        ? result.reason : 'target-missing' }
  })
}

export function resumePublicV44(locks: PublicV7LockProvider | undefined,
  store: Store, source: SourceStore, revision: number, rawLineage: unknown):
  Promise<PublicV44Operation<PublicV44Start>> {
  return lock(locks, async () => {
    const result = await succession(store, source, false)
    if (result.status !== 'valid') return { ok: false,
      reason: result.status === 'blocked' ? result.reason : 'target-missing' }
    if (!sameStrictBoundedRaw(rawLineage, result.root.lineage, 3 << 20))
      return { ok: false, reason: 'lineage-changed' }
    return result.root.head.saveRevision === revision
      ? { ok: true, value: { head: result.root.head,
        lineage: result.root.lineage } }
      : { ok: false, reason: 'revision-changed' }
  })
}

export function commitPublicV44(locks: PublicV7LockProvider | undefined,
  store: Store, source: SourceStore, revision: number,
  rawLineage: unknown, rawWitness: PublicV44Witness):
  Promise<PublicV44Operation<PublicV44Start>> {
  return lock(locks, async () => {
    const fenced = await succession(store, source, false)
    if (fenced.status !== 'valid') return { ok: false,
      reason: fenced.status === 'blocked' ? fenced.reason : 'target-missing' }
    const read = await store.readChecked()
    if (read.status !== 'valid') return { ok: false,
      reason: read.status === 'blocked' ? read.reason : 'root-missing' }
    const { head, lineage } = read.root
    if (!sameStrictBoundedRaw(rawLineage, lineage, 3 << 20))
      return { ok: false, reason: 'lineage-changed' }
    if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
    if (!Number.isSafeInteger(revision + 1))
      return { ok: false, reason: 'invalid-revision' }
    const witness = decodePublicV44Witness(rawWitness)
    if (!witness) return { ok: false, reason: 'invalid-witness' }
    const action = confirmPublicV44GroundMountAction({ v43: head.v43,
      groundMount: head.groundMount }, witness)
    if (!action.progress) return { ok: false,
      reason: action.rejection ?? 'action-rejected' }
    const nextHead: PublicV44Head = { ...action.progress,
      schemaVersion: head.schemaVersion, saveRevision: revision + 1, witness }
    const candidate = decodePublicV44CheckedSuccessor(read.root, { lineage,
      previous: head, head: nextHead })
    if (!candidate) return { ok: false, reason: 'invalid-successor' }
    const result = await store.commit(read.proof, candidate)
    return result === 'committed'
      ? { ok: true, value: { head: candidate.head, lineage } }
      : { ok: false, reason: result }
  })
}
