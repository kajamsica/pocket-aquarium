import type { createAtomicV17Store } from './atomicV17Database'
import type { createAtomicV23Store } from './atomicV23Database'
import { inspectPublicV17UnderLock } from './publicWorldV17Flow'
import type { PublicV17Start } from './publicWorldV17Flow'
import { samePublicV14Value } from './publicWorldV14Validation'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { createPublicV23Root, decodePublicV23Lineage,
  decodePublicV23Source } from './publicWorldV23Snapshot'
import type { PublicV23Head, PublicV23Lineage, PublicV23SourceReceipt, PublicV23Witness } from './publicWorldV23Snapshot'
import { applyPublicV23Witness } from './publicWorldV23Transitions'

type Store = ReturnType<typeof createAtomicV23Store>
type SourceStore = ReturnType<typeof createAtomicV17Store>
export type PublicV23Start = Readonly<{ head: PublicV23Head; lineage: PublicV23Lineage }>
export type PublicV23Operation<T> = { ok: true; value: T } | { ok: false; reason: string }
export type PublicV23Inspection = { status: 'fresh-available' }
  | { status: 'migration-available'; sourceReceipt: PublicV23SourceReceipt }
  | { status: 'valid'; start: PublicV23Start }
  | { status: 'blocked'; reason: string }
export type PublicV23InspectionPhase = 'v23-checked-read' | 'v17-source-inspection'
export type PublicV23InspectionTiming = (sample: Readonly<{
  phase: PublicV23InspectionPhase; durationMs: number }>) => void
function report(onPhase: PublicV23InspectionTiming | undefined,
  phase: PublicV23InspectionPhase, startedAt: number) {
  if (!onPhase) return
  try { onPhase({ phase, durationMs: performance.now() - startedAt }) }
  catch { /* Diagnostics must not affect checked source inspection. */ }
}
const receipt = (source: PublicV17Start): PublicV23SourceReceipt => ({ state: source.state,
  greenwayWorks: source.greenwayWorks, lineage: source.lineage, saveRevision: source.saveRevision })
async function lock<T>(locks: PublicV7LockProvider | undefined,
  body: () => Promise<PublicV23Operation<T>>): Promise<PublicV23Operation<T>> {
  if (!locks) return { ok: false, reason: 'lock-unavailable' }
  try { return await locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' }, body) }
  catch { return { ok: false, reason: 'storage-error' } }
}
async function inspectUnderLock(store: Store, sourceStore: SourceStore,
  onPhase?: PublicV23InspectionTiming) {
  const targetStartedAt = onPhase ? performance.now() : 0
  const target = await store.readChecked()
  report(onPhase, 'v23-checked-read', targetStartedAt)
  if (target.status === 'blocked') return target
  const sourceStartedAt = onPhase ? performance.now() : 0
  const source = await inspectPublicV17UnderLock(sourceStore)
  report(onPhase, 'v17-source-inspection', sourceStartedAt)
  if (source.status === 'blocked') return { status: 'blocked' as const, reason: `source-${source.reason}` }
  if (target.status === 'missing') return { status: 'missing' as const, target,
    sourceReceipt: source.status === 'valid' ? receipt(source.start) : null }
  const actual = source.status === 'valid' ? receipt(source.start) : null
  if (!samePublicV14Value(actual, target.root.lineage.sourceReceipt)) return { status: 'blocked' as const, reason: 'source-changed' }
  return { status: 'valid' as const, target, start: { head: target.root.head, lineage: target.root.lineage } }
}
/** Read-only source inspection while a successor already owns the world lock. */
export async function inspectPublicV23UnderLock(store: Store,
  sourceStore: SourceStore, onPhase?: PublicV23InspectionTiming): Promise<PublicV23Inspection> {
  const checked = await inspectUnderLock(store, sourceStore, onPhase)
  return checked.status === 'missing'
    ? checked.sourceReceipt ? { status: 'migration-available', sourceReceipt: checked.sourceReceipt }
      : { status: 'fresh-available' }
    : checked.status === 'valid' ? { status: 'valid', start: checked.start } : checked
}
export function inspectPublicV23(locks: PublicV7LockProvider | undefined, store: Store, sourceStore: SourceStore): Promise<PublicV23Operation<PublicV23Inspection>> {
  return lock(locks, async () => ({ ok: true,
    value: await inspectPublicV23UnderLock(store, sourceStore) }))
}

/** The V23 root is the promotion marker. The V17 database is only read under this same lock. */
export function startPublicV23(locks: PublicV7LockProvider | undefined, store: Store,
  sourceStore: SourceStore, seed: string, expectedSource: PublicV23SourceReceipt | null,
  options?: { requireMissing: true }): Promise<PublicV23Operation<PublicV23Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128) return Promise.resolve({ ok: false, reason: 'invalid-seed' })
  const expected = expectedSource === null ? null : decodePublicV23Source(expectedSource)
  if (expectedSource !== null && (!expected || expected.state.seed !== seed)) return Promise.resolve({ ok: false, reason: 'invalid-source' })
  return lock(locks, () => startPublicV23UnderLock(store, sourceStore, seed, expected, options))
}

/** Checked promotion while the caller owns the world lock. */
export async function startPublicV23UnderLock(store: Store, sourceStore: SourceStore,
  seed: string, expectedSource: PublicV23SourceReceipt | null,
  options?: { requireMissing: true }): Promise<PublicV23Operation<PublicV23Start>> {
  if (typeof seed !== 'string' || !seed || seed.length > 128) return { ok: false, reason: 'invalid-seed' }
  const expected = expectedSource === null ? null : decodePublicV23Source(expectedSource)
  if (expectedSource !== null && (!expected || expected.state.seed !== seed))
    return { ok: false, reason: 'invalid-source' }
  const checked = await inspectUnderLock(store, sourceStore)
  if (checked.status === 'blocked') return { ok: false, reason: checked.reason }
  if (checked.status === 'valid') return options?.requireMissing
    ? { ok: false, reason: 'target-conflict' }
    : checked.start.lineage.seed === seed
    && samePublicV14Value(checked.start.lineage.sourceReceipt, expected)
    ? { ok: true, value: checked.start } : { ok: false, reason: 'target-conflict' }
  if (!samePublicV14Value(checked.sourceReceipt, expected)) return { ok: false, reason: 'source-changed' }
  const fresh = createPublicV23Root(seed, expected)
  const result = await store.commit(checked.target.proof, { ...fresh, previous: null })
  return result === 'committed' ? { ok: true, value: fresh } : { ok: false, reason: result }
}

export function resumePublicV23(locks: PublicV7LockProvider | undefined, store: Store, sourceStore: SourceStore,
  revision: number, rawLineage: unknown): Promise<PublicV23Operation<PublicV23Start>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, sourceStore)
    if (checked.status !== 'valid') return { ok: false, reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    if (!samePublicV14Value(decodePublicV23Lineage(rawLineage), checked.start.lineage)) return { ok: false, reason: 'lineage-changed' }
    return checked.start.head.saveRevision === revision ? { ok: true, value: checked.start } : { ok: false, reason: 'revision-changed' }
  })
}

export function commitPublicV23(locks: PublicV7LockProvider | undefined, store: Store, sourceStore: SourceStore,
  revision: number, rawLineage: unknown, witness: PublicV23Witness): Promise<PublicV23Operation<PublicV23Start>> {
  return lock(locks, async () => {
    const checked = await inspectUnderLock(store, sourceStore)
    if (checked.status !== 'valid') return { ok: false, reason: checked.status === 'blocked' ? checked.reason : 'root-missing' }
    const { head, lineage } = checked.start
    if (!samePublicV14Value(decodePublicV23Lineage(rawLineage), lineage)) return { ok: false, reason: 'lineage-changed' }
    if (head.saveRevision !== revision) return { ok: false, reason: 'revision-changed' }
    const result = applyPublicV23Witness({ state: head.state,
      greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }, witness)
    if ('rejection' in result) return { ok: false, reason: result.rejection }
    const next: PublicV23Head = { ...head, ...result.progress, saveRevision: revision + 1,
      witness: structuredClone(witness) }
    const write = await store.commit(checked.target.proof, { lineage, head: next, previous: head })
    return write === 'committed' ? { ok: true, value: { head: next, lineage } } : { ok: false, reason: write }
  })
}
