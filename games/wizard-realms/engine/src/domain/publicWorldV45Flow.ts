import type { createAtomicV44PromotionStore } from './atomicV44Promotion'
import type { createAtomicV45Store } from './atomicV45Database'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { confirmPublicV45Action } from './publicWorldV45RideAction'
import { createPublicV45Genesis, PUBLIC_V45_SCHEMA } from './publicWorldV45Migration'
import { decodePublicV45Root, decodePublicV45Witness }
  from './publicWorldV45Snapshot'
import type { PublicV45Head, PublicV45Root,
  PublicV45Witness } from './publicWorldV45Snapshot'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { sameStrictBoundedRaw } from './strictBoundedRaw'
import type { PublicWorldEvent } from './publicWorldRuntime'

type Store = ReturnType<typeof createAtomicV45Store>
type SourceStore = ReturnType<typeof createAtomicV44PromotionStore>
type Succession = { status: 'migration-available'; sourceRevision: number }
  | { status: 'valid'; root: PublicV45Root; proof: object }
  | { status: 'blocked'; reason: string }
export type PublicV45Start = Readonly<Pick<PublicV45Root, 'head' | 'lineage'>>
export type PublicV45Commit = Readonly<PublicV45Start & {
  events: readonly PublicWorldEvent[] }>
export type PublicV45Operation<T> = { ok: true; value: T }
  | { ok: false; reason: string }
export type PublicV45Inspection = { status: 'migration-available'; sourceRevision: number }
  | { status: 'valid'; start: PublicV45Start }
  | { status: 'blocked'; reason: string }
type CommitReceipt = Readonly<{
  beforeHead: PublicV45Head
  lineage: PublicV45Start['lineage']
  witness: PublicV45Witness
  nextHead: PublicV45Head
  events: readonly PublicWorldEvent[]
  returnHome: boolean
}>
const commitReceipts = new WeakMap<object, CommitReceipt>()

/** A durable Flow reply grants one validation shortcut, never a forgeable field. */
export function consumePublicV45CommitReceipt(
  reply: PublicV45Operation<PublicV45Start>, before: PublicV45Start,
  requested: PublicV45Witness | null): boolean {
  if (!reply.ok) return false
  const receipt = commitReceipts.get(reply)
  if (!receipt) return false
  commitReceipts.delete(reply)
  try {
    return sameStrictBoundedRaw(before.head, receipt.beforeHead, 3 << 20)
      && sameStrictBoundedRaw(before.lineage, receipt.lineage, 3 << 20)
      && (requested === null ? receipt.returnHome
        && receipt.witness.kind === 'return-home/v1'
        : !receipt.returnHome && sameStrictBoundedRaw(requested,
          receipt.witness, 3 << 20))
      && sameStrictBoundedRaw(reply, { ok: true, value: {
        head: receipt.nextHead, lineage: receipt.lineage,
        events: receipt.events } }, 3 << 20)
  } catch { return false }
}

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV45Operation<T>>): Promise<PublicV45Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}

function checkedGenesis(source: Parameters<typeof createPublicV45Genesis>[0]):
  PublicV45Root | null {
  try {
    const genesis = createPublicV45Genesis(source)
    if (!sameStrictBoundedRaw(genesis, genesis, 3 << 20)) return null
    const checked = decodePublicV45Root(genesis)
    return checked && sameStrictBoundedRaw(checked, genesis, 3 << 20)
      ? checked : null
  } catch { return null }
}

/** All reads, source reservations, target CAS and finalization stay under one lock. */
async function succession(store: Store, source: SourceStore, create: boolean,
  expectedSourceRevision?: number): Promise<Succession> {
  let old = await source.readForPromotion()
  if (old.status !== 'valid') return { status: 'blocked',
    reason: old.status === 'blocked' ? old.reason : 'source-missing' }
  if (expectedSourceRevision !== undefined
    && old.root.head.saveRevision !== expectedSourceRevision)
    return { status: 'blocked', reason: 'source-revision-changed' }
  let target = await store.readChecked()
  if (target.status === 'blocked') return { status: 'blocked', reason: target.reason }
  if (!old.marker && target.status !== 'missing')
    return { status: 'blocked', reason: 'ambiguous-legacy-target' }
  if (!old.marker && !create) return { status: 'migration-available',
    sourceRevision: old.root.head.saveRevision }

  // Preflight before the irreversible V44 version bump, including the full
  // checked genesis size rather than only the smaller checked V44 source.
  let genesis: PublicV45Root | null = null
  if (create && target.status === 'missing') {
    genesis = checkedGenesis(old.root)
    if (!genesis) return { status: 'blocked', reason: 'invalid-source' }
  }
  if (!old.marker) {
    const priorRoot = old.root, fingerprint = old.sourceFingerprint
    const reserved = await source.transitionSuccessor(old.proof, 'pending')
    if (reserved !== 'committed') return { status: 'blocked', reason: reserved }
    old = await source.readForPromotion()
    if (old.status !== 'valid' || old.marker?.phase !== 'pending'
      || old.sourceFingerprint !== fingerprint
      || old.root.head.saveRevision !== priorRoot.head.saveRevision
      || !sameStrictBoundedRaw(old.root, priorRoot, 3 << 20))
      return { status: 'blocked', reason: 'source-changed' }
    target = await store.readChecked()
    if (target.status === 'blocked') return { status: 'blocked', reason: target.reason }
  }

  if (old.marker?.phase === 'pending' && target.status === 'missing') {
    if (!create) return { status: 'migration-available',
      sourceRevision: old.root.head.saveRevision }
    genesis ??= checkedGenesis(old.root)
    if (!genesis) return { status: 'blocked', reason: 'invalid-source' }
    const committed = await store.commit(target.proof, genesis)
    if (committed !== 'committed' && committed !== 'revision-changed')
      return { status: 'blocked', reason: committed }
    target = await store.readChecked()
    if (target.status === 'blocked') return { status: 'blocked', reason: target.reason }
  }
  if (target.status !== 'valid'
    || target.root.lineage.sourceRevision !== old.root.head.saveRevision
    || !sameStrictBoundedRaw(target.root.lineage.source, old.root, 3 << 20)) {
    const conflicted = await source.transitionSuccessor(old.proof, 'conflict')
    if (conflicted !== 'committed' && conflicted !== 'unchanged')
      return { status: 'blocked', reason: conflicted }
    return { status: 'blocked', reason: 'target-conflict' }
  }
  if (old.marker?.phase === 'pending') {
    const finalized = await source.transitionSuccessor(old.proof, 'finalized')
    if (finalized !== 'committed' && finalized !== 'unchanged')
      return { status: 'blocked', reason: finalized }
  }
  return { status: 'valid', root: target.root, proof: target.proof }
}

export function inspectPublicV45(locks: PublicV7LockProvider | undefined,
  store: Store, source: SourceStore): Promise<PublicV45Operation<PublicV45Inspection>> {
  return lock(locks, async () => {
    const result = await succession(store, source, false)
    const value: PublicV45Inspection = result.status === 'valid'
      ? { status: 'valid', start: { head: result.root.head,
        lineage: result.root.lineage } } : result
    return { ok: true, value }
  })
}

export function startPublicV45(locks: PublicV7LockProvider | undefined,
  store: Store, source: SourceStore, expectedSourceRevision: number):
  Promise<PublicV45Operation<PublicV45Start>> {
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

export function resumePublicV45(locks: PublicV7LockProvider | undefined,
  store: Store, source: SourceStore, revision: number, rawLineage: unknown):
  Promise<PublicV45Operation<PublicV45Start>> {
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

async function commitWitnessUnderLock(store: Store, source: SourceStore,
  revision: number, rawLineage: unknown, witnessFromWriter: () => unknown,
  returnHome: boolean): Promise<PublicV45Operation<PublicV45Commit>> {
    const fenced = await succession(store, source, false)
    if (fenced.status !== 'valid') return { ok: false,
      reason: fenced.status === 'blocked' ? fenced.reason : 'target-missing' }
    const { head, lineage } = fenced.root
    if (!sameStrictBoundedRaw(rawLineage, lineage, 3 << 20))
      return { ok: false, reason: 'lineage-changed' }
    if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
    if (!Number.isSafeInteger(revision + 1))
      return { ok: false, reason: 'invalid-revision' }
    if (returnHome && head.groundMount.mode !== 'parked')
      return { ok: false, reason: 'must-dismount' }
    const witness = decodePublicV45Witness(witnessFromWriter())
    if (!witness || (witness.kind === 'return-home/v1') !== returnHome)
      return { ok: false, reason: 'invalid-witness' }
    const { schemaVersion: _schema, saveRevision: _revision,
      witness: _previous, ...progress } = head
    const action = confirmPublicV45Action(progress, witness)
    if (!action.progress) {
      if (returnHome && witness.kind === 'return-home/v1') {
        const { state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs } = head
        const reason = applyPublicV26ReturnHome({ state, greenwayWorks,
          regionalWorks, terrain, nextHomeAtMs }, witness.atMs).rejection
        if (reason === 'not_trapped' || reason === 'cooldown')
          return { ok: false, reason }
      }
      return { ok: false, reason: action.rejection ?? 'action-rejected' }
    }
    const nextHead: PublicV45Head = { ...action.progress,
      schemaVersion: PUBLIC_V45_SCHEMA, saveRevision: revision + 1, witness }
    const candidate: PublicV45Root = { lineage, previous: head, head: nextHead }
    const committed = await store.commit(fenced.proof, candidate)
    if (committed !== 'committed') return { ok: false,
      reason: committed === 'invalid' ? 'invalid-successor' : committed }
    const reply: PublicV45Operation<PublicV45Commit> = { ok: true,
      value: { head: candidate.head, lineage, events: action.events } }
    try {
      commitReceipts.set(reply, { beforeHead: structuredClone(head),
        lineage: structuredClone(lineage), witness: structuredClone(witness),
        nextHead: structuredClone(nextHead), events: structuredClone(action.events),
        returnHome })
    } catch { /* A durable write still succeeds; its caller uses full validation. */ }
    return reply
}

export function commitPublicV45(locks: PublicV7LockProvider | undefined,
  store: Store, source: SourceStore, revision: number, rawLineage: unknown,
  rawWitness: PublicV45Witness): Promise<PublicV45Operation<PublicV45Commit>> {
  return lock(locks, () => commitWitnessUnderLock(store, source, revision,
    rawLineage, () => rawWitness, false))
}

export function requestPublicV45ReturnHome(locks: PublicV7LockProvider | undefined,
  store: Store, source: SourceStore, revision: number, rawLineage: unknown):
  Promise<PublicV45Operation<PublicV45Commit>> {
  return lock(locks, () => commitWitnessUnderLock(store, source, revision,
    rawLineage, () => ({ kind: 'return-home/v1', atMs: Date.now() }), true))
}
