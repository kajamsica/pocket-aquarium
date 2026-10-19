import type { createAtomicV17Store } from './atomicV17Database'
import type { createAtomicV23Store } from './atomicV23Database'
import type { createAtomicV24Store, AtomicV24Read, PublicV24AtomicPhase } from './atomicV24Database'
import { inspectPublicV23UnderLock, startPublicV23UnderLock } from './publicWorldV23Flow'
import type { PublicV23InspectionPhase } from './publicWorldV23Flow'
import { startFreshPublicV17UnderLock } from './publicWorldV17Flow'
import { samePublicV14Value } from './publicWorldV14Validation'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { applyPublicV23Witness } from './publicWorldV23Transitions'
import { applyPublicV24MireglassAction } from './publicWorldV24MireglassAction'
import { createPublicV24Root, decodePublicV24Lineage, decodePublicV24SourceReceipt,
  decodePublicV24Witness } from './publicWorldV24Snapshot'
import type { PublicV24Head, PublicV24Lineage, PublicV24SourceReceipt,
  PublicV24Witness } from './publicWorldV24Snapshot'

type Store = ReturnType<typeof createAtomicV24Store>
type SourceStore = ReturnType<typeof createAtomicV23Store>
type AncestorStore = ReturnType<typeof createAtomicV17Store>
export type PublicV24WriterPhase = PublicV24AtomicPhase | PublicV23InspectionPhase
  | 'lock-wait' | 'v24-checked-read' | 'source-receipt-compare'
  | 'v23-v17-source-inspection' | 'witness-apply'
export type PublicV24WriterTiming = (sample: Readonly<{
  phase: PublicV24WriterPhase; durationMs: number }>) => void
function report(onPhase: PublicV24WriterTiming | undefined, phase: PublicV24WriterPhase,
  startedAt: number) {
  if (!onPhase) return
  try { onPhase({ phase, durationMs: performance.now() - startedAt }) }
  catch { /* Diagnostics must not affect checked writes. */ }
}
export type PublicV24Start = Readonly<{ head: PublicV24Head; lineage: PublicV24Lineage }>
export type PublicV24Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV24Inspection = { status: 'migration-available'; sourceReceipt: PublicV24SourceReceipt }
  | { status: 'valid'; start: PublicV24Start }
  | { status: 'blocked'; reason: string }
type Checked = { status: 'missing'; target: Extract<AtomicV24Read, { status: 'missing' }>;
    sourceReceipt: PublicV24SourceReceipt }
  | { status: 'valid'; target: Extract<AtomicV24Read, { status: 'valid' }>;
    start: PublicV24Start }
  | { status: 'blocked'; reason: string }

async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV24Operation<T>>, onPhase?: PublicV24WriterTiming): Promise<PublicV24Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  const startedAt = onPhase ? performance.now() : 0
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, () => {
    report(onPhase, 'lock-wait', startedAt)
    return body()
  }) }
  catch { return { ok: false, reason: 'storage-error' } }
}

/** Validate the complete live V23 chain, including its V17 source, under our one lock. */
async function inspectUnderLock(store: Store, sourceStore: SourceStore,
  ancestorStore: AncestorStore, onPhase?: PublicV24WriterTiming): Promise<Checked> {
  const readStartedAt = onPhase ? performance.now() : 0
  const target = await store.readChecked(onPhase)
  report(onPhase, 'v24-checked-read', readStartedAt)
  if (target.status === 'blocked') return target
  const sourceStartedAt = onPhase ? performance.now() : 0
  try {
    const source = await inspectPublicV23UnderLock(sourceStore, ancestorStore, onPhase)
    if (source.status === 'blocked') return { status: 'blocked',
      reason: source.reason.startsWith('source-') ? source.reason : `source-${source.reason}` }
    if (source.status !== 'valid') return { status: 'blocked', reason: 'source-v23-missing' }
    const sourceReceipt = { head: source.start.head, lineage: source.start.lineage }
    if (target.status === 'missing') return { status: 'missing', target, sourceReceipt }
    const compareStartedAt = onPhase ? performance.now() : 0
    const matches = samePublicV14Value(sourceReceipt, target.root.lineage.sourceReceipt)
    report(onPhase, 'source-receipt-compare', compareStartedAt)
    if (!matches)
      return { status: 'blocked', reason: 'source-changed' }
    return { status: 'valid', target, start: { head: target.root.head, lineage: target.root.lineage } }
  } finally { report(onPhase, 'v23-v17-source-inspection', sourceStartedAt) }
}

/** Read-only complete source inspection while a successor owns the world lock. */
export async function inspectPublicV24UnderLock(store: Store, sourceStore: SourceStore,
  ancestorStore: AncestorStore): Promise<PublicV24Inspection> {
  const checked = await inspectUnderLock(store, sourceStore, ancestorStore)
  return checked.status === 'missing'
    ? { status: 'migration-available', sourceReceipt: checked.sourceReceipt }
    : checked.status === 'valid' ? { status: 'valid', start: checked.start } : checked
}

export function inspectPublicV24(locks: PublicV7LockProvider | undefined, store: Store,
  sourceStore: SourceStore, ancestorStore: AncestorStore): Promise<PublicV24Operation<PublicV24Inspection>> {
  return lock(locks, async () => ({ ok: true,
    value: await inspectPublicV24UnderLock(store, sourceStore, ancestorStore) }))
}

/** Only a validated V23 head may be promoted. No direct V17 or fresh V24 path. */
export function startPublicV24(locks: PublicV7LockProvider | undefined, store: Store,
  sourceStore: SourceStore, ancestorStore: AncestorStore, seed: string,
  expectedSource: PublicV24SourceReceipt): Promise<PublicV24Operation<PublicV24Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128)
    return Promise.resolve({ ok: false, reason: 'invalid-seed' })
  const expected = decodePublicV24SourceReceipt(expectedSource)
  if (!expected || expected.head.state.seed !== seed)
    return Promise.resolve({ ok: false, reason: 'invalid-source' })
  return lock(locks, () => startPublicV24UnderLock(store, sourceStore, ancestorStore,
    seed, expected))
}

/** Checked promotion while the caller owns the world lock. */
export async function startPublicV24UnderLock(store: Store, sourceStore: SourceStore,
  ancestorStore: AncestorStore, seed: string, expectedSource: PublicV24SourceReceipt):
  Promise<PublicV24Operation<PublicV24Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128)
    return { ok: false, reason: 'invalid-seed' }
  const expected = decodePublicV24SourceReceipt(expectedSource)
  if (!expected || expected.head.state.seed !== seed)
    return { ok: false, reason: 'invalid-source' }
  const checked = await inspectUnderLock(store, sourceStore, ancestorStore)
  if (checked.status === 'blocked') return { ok: false, reason: checked.reason }
  if (checked.status === 'valid') return checked.start.lineage.seed === seed
    && samePublicV14Value(checked.start.lineage.sourceReceipt, expected)
    ? { ok: true, value: checked.start } : { ok: false, reason: 'target-conflict' }
  if (!samePublicV14Value(checked.sourceReceipt, expected))
    return { ok: false, reason: 'source-changed' }
  const fresh = createPublicV24Root(expected)
  const result = await store.commit(checked.target.proof, fresh)
  return result === 'committed'
    ? { ok: true, value: { head: fresh.head, lineage: fresh.lineage } }
    : { ok: false, reason: result }
}

/** One checked, ordered V17 to V23 to V24 genesis under one world lock. */
export function startFreshPublicV24World(locks: PublicV7LockProvider | undefined,
  store: Store, sourceStore: SourceStore, ancestorStore: AncestorStore, seed: string):
  Promise<PublicV24Operation<PublicV24Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128)
    return Promise.resolve({ ok: false, reason: 'invalid-seed' })
  return lock(locks, async () => {
    const target = await store.readChecked()
    if (target.status !== 'missing') return { ok: false, reason: target.status === 'valid'
      ? 'target-conflict' : target.reason }
    const source = await inspectPublicV23UnderLock(sourceStore, ancestorStore)
    if (source.status !== 'fresh-available') return { ok: false,
      reason: source.status === 'blocked' ? source.reason : 'source-changed' }
    const foundation = await startFreshPublicV17UnderLock(ancestorStore, seed)
    if (!foundation.ok) return foundation
    const v17 = foundation.value
    const promoted = await startPublicV23UnderLock(sourceStore, ancestorStore, seed,
      { state: v17.state, greenwayWorks: v17.greenwayWorks,
        lineage: v17.lineage, saveRevision: v17.saveRevision }, { requireMissing: true })
    if (!promoted.ok) return promoted
    return startPublicV24UnderLock(store, sourceStore, ancestorStore, seed,
      { head: promoted.value.head, lineage: promoted.value.lineage })
  })
}

export function resumePublicV24(locks: PublicV7LockProvider | undefined, store: Store,
  sourceStore: SourceStore, ancestorStore: AncestorStore, revision: number,
  rawLineage: unknown): Promise<PublicV24Operation<PublicV24Start>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, sourceStore, ancestorStore)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    if (!samePublicV14Value(decodePublicV24Lineage(rawLineage), checked.start.lineage))
      return { ok: false, reason: 'lineage-changed' }
    return checked.start.head.saveRevision === revision
      ? { ok: true, value: checked.start } : { ok: false, reason: 'revision-changed' }
  })
}

export function commitPublicV24(locks: PublicV7LockProvider | undefined, store: Store,
  sourceStore: SourceStore, ancestorStore: AncestorStore, revision: number,
  rawLineage: unknown, witness: PublicV24Witness,
  onPhase?: PublicV24WriterTiming): Promise<PublicV24Operation<PublicV24Start>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, sourceStore, ancestorStore, onPhase)
    if (checked.status !== 'valid') return { ok: false,
      reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    const { head, lineage } = checked.start
    if (!samePublicV14Value(decodePublicV24Lineage(rawLineage), lineage))
      return { ok: false, reason: 'lineage-changed' }
    if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
    const applyStartedAt = onPhase ? performance.now() : 0
    const decoded = decodePublicV24Witness(witness)
    if (!decoded) {
      report(onPhase, 'witness-apply', applyStartedAt)
      return { ok: false, reason: 'invalid-witness' }
    }
    const before = { state: head.state, greenwayWorks: head.greenwayWorks,
      regionalWorks: head.regionalWorks }
    const result = decoded.kind === 'mireglass-action/v1'
      ? applyPublicV24MireglassAction(before, decoded.action)
      : applyPublicV23Witness(before, decoded)
    report(onPhase, 'witness-apply', applyStartedAt)
    if ('rejection' in result) return { ok: false, reason: result.rejection ?? 'invalid-witness' }
    const next: PublicV24Head = { ...head, ...result.progress, saveRevision: revision + 1,
      witness: structuredClone(decoded) }
    const write = await store.commit(checked.target.proof, { lineage, head: next, previous: head }, onPhase)
    return write === 'committed' ? { ok: true, value: { head: next, lineage } }
      : { ok: false, reason: write }
  }, onPhase)
}
