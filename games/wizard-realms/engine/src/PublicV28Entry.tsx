import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { createAtomicV24Store } from './domain/atomicV24Database'
import { createAtomicV25Store } from './domain/atomicV25Database'
import { createAtomicV26Store } from './domain/atomicV26Database'
import { createAtomicV27Store } from './domain/atomicV27Database'
import { createAtomicV28Store } from './domain/atomicV28Database'
import { inspectPublicV28, resumePublicV28, startPublicV28 } from './domain/publicWorldV28Flow'
import type { PublicV28Operation, PublicV28Start } from './domain/publicWorldV28Flow'
import type { PublicV28SourceReceipt } from './domain/publicWorldV28Migration'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { choosePublicV27Entry, inspectPublicV27Entry } from './PublicV27Entry'

export type PublicV28EntryBindings = Readonly<{ locks: PublicV7LockProvider;
  store: ReturnType<typeof createAtomicV28Store>;
  sourceStore: ReturnType<typeof createAtomicV27Store>;
  v26Store: ReturnType<typeof createAtomicV26Store>;
  v25Store: ReturnType<typeof createAtomicV25Store>;
  v24Store: ReturnType<typeof createAtomicV24Store>;
  v23Store: ReturnType<typeof createAtomicV23Store>;
  v17Store: ReturnType<typeof createAtomicV17Store> }>
export type PublicV28EntryDecision = { status: 'resume'; start: PublicV28Start }
  | { status: 'migration-available'; sourceReceipt: PublicV28SourceReceipt }
  | { status: 'fresh-available' } | { status: 'older-world' }
  | { status: 'blocked'; reason: string }
type Choice = 'resume' | 'migrate' | 'create'
const v27Bindings = ({ locks, sourceStore, v26Store, v25Store, v24Store,
  v23Store, v17Store }: PublicV28EntryBindings) => ({ locks, store: sourceStore,
    sourceStore: v26Store, v25Store, v24Store, v23Store, v17Store })
const sourceMissing = new Set(['source-v27-missing', 'source-v26-missing',
  'source-v25-missing', 'source-v24-missing', 'source-v23-missing'])

/** Inspect the whole checked V28 ancestry before offering any opt-in mutation. */
export async function inspectPublicV28Entry(bindings: PublicV28EntryBindings | null):
  Promise<PublicV28EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  try {
    const { locks, store, sourceStore, v26Store, v25Store, v24Store,
      v23Store, v17Store } = bindings
    const result = await inspectPublicV28(locks, store, sourceStore, v26Store,
      v25Store, v24Store, v23Store, v17Store)
    if (!result.ok) return { status: 'blocked', reason: result.reason }
    if (result.value.status === 'valid') return { status: 'resume', start: result.value.start }
    if (result.value.status === 'migration-available') return result.value
    if (!sourceMissing.has(result.value.reason)) return result.value
    const target = await store.readChecked()
    if (target.status !== 'missing') return { status: 'blocked',
      reason: target.status === 'valid' ? 'source-changed' : target.reason }
    const predecessor = await inspectPublicV27Entry(v27Bindings(bindings))
    if (predecessor.status === 'fresh-available'
      || predecessor.status === 'migration-available') return { status: 'fresh-available' }
    return predecessor.status === 'older-world' ? predecessor : { status: 'blocked',
      reason: predecessor.status === 'blocked' ? predecessor.reason : 'source-changed' }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV28Entry(decision: PublicV28EntryDecision, choice: Choice,
  bindings: PublicV28EntryBindings, seed: string): Promise<PublicV28Operation<PublicV28Start>> {
  const { locks, store, sourceStore, v26Store, v25Store, v24Store,
    v23Store, v17Store } = bindings
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV28(
    locks, store, sourceStore, v26Store, v25Store, v24Store, v23Store, v17Store,
    decision.start.head.saveRevision, decision.start.lineage)
  if (decision.status === 'migration-available' && choice === 'migrate') return startPublicV28(
    locks, store, sourceStore, v26Store, v25Store, v24Store, v23Store, v17Store,
    decision.sourceReceipt.head.state.seed, decision.sourceReceipt)
  if (decision.status !== 'fresh-available' || choice !== 'create')
    return { ok: false, reason: 'choice-unavailable' }
  const current = await inspectPublicV28Entry(bindings)
  if (current.status !== 'fresh-available') return { ok: false,
    reason: current.status === 'blocked' ? current.reason : 'source-changed' }
  const predecessor = await inspectPublicV27Entry(v27Bindings(bindings))
  const predecessorChoice = predecessor.status === 'fresh-available' ? 'create'
    : predecessor.status === 'migration-available' ? 'migrate' : null
  if (!predecessorChoice) return { ok: false, reason: predecessor.status === 'blocked'
    ? predecessor.reason : 'source-changed' }
  const source = await choosePublicV27Entry(predecessor, predecessorChoice,
    v27Bindings(bindings), predecessor.status === 'migration-available'
      ? predecessor.sourceReceipt.head.state.seed : seed)
  if (!source.ok) return { ok: false, reason: source.reason }
  const ready = await inspectPublicV28(locks, store, sourceStore, v26Store,
    v25Store, v24Store, v23Store, v17Store)
  if (!ready.ok || ready.value.status !== 'migration-available') return { ok: false,
    reason: ready.ok && ready.value.status === 'blocked' ? ready.value.reason : 'source-changed' }
  return startPublicV28(locks, store, sourceStore, v26Store, v25Store,
    v24Store, v23Store, v17Store, ready.value.sourceReceipt.head.state.seed,
    ready.value.sourceReceipt)
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV28EntryView({ entry, busy, onChoose, onRetry, actionError }: {
  entry: PublicV28EntryDecision | { status: 'checking' }; busy: boolean;
  onChoose: (choice: Choice) => void; onRetry: () => void; actionError: string | null }) {
  return <main data-public-v28-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}><section style={{ maxWidth: 560 }}>
    <h1>Wizard Realms: Connected River</h1>
    {entry.status === 'checking' && <p role="status">Checking this device for a V28 world…</p>}
    {entry.status === 'fresh-available' && <><p>Start a local V28 world with a checked V27
      foundation. This browser save is not backed up online.</p><button type="button"
      style={button} disabled={busy} onClick={() => onChoose('create')}>Start new V28 world</button></>}
    {entry.status === 'resume' && <><p role="status">Validated V28 save
      #{entry.start.head.saveRevision} is ready.</p><button type="button"
      style={button} disabled={busy} onClick={() => onChoose('resume')}>Resume V28 world</button></>}
    {entry.status === 'migration-available' && <><p>A validated V27 world can be copied into V28.
      Checkpoint and close the V27 tab first. Only its last committed save is copied; the V27
      world remains unchanged.</p><button type="button" style={button} disabled={busy}
      onClick={() => onChoose('migrate')}>Copy V27 world into V28</button></>}
    {entry.status === 'older-world' && <><p role="status">An older world needs its checked V27
      foundation before V28 can start. No save was reset.</p><a href="?publicWorld=v27">
      Open V27 entry</a></>}
    {entry.status === 'blocked' && <><p role="alert">V28 access is blocked ({entry.reason}).
      Your saves were not reset.</p><button type="button" style={button} disabled={busy}
      onClick={onRetry}>Reload to recheck</button></>}
    {actionError && <p role="alert">The selected action did not complete ({actionError}).
      No save was cleared. Reload to recheck or retry the available action.</p>}
  </section></main>
}

export function PublicV28EntryApp({ renderSession, seed = 'greenway-alpha' }: {
  renderSession: (start: PublicV28Start, bindings: PublicV28EntryBindings) => ReactNode;
  seed?: string }) {
  const bindings = useRef<PublicV28EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV28EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV28Start | null>(null)
  useEffect(() => {
    let cancelled = false
    const inspect = async () => {
      try {
        const locks = (navigator as Navigator & { locks?: PublicV7LockProvider }).locks
        const factory = window.indexedDB
        if (!locks || !factory) {
          if (!cancelled) setEntry({ status: 'blocked', reason: !locks
            ? 'lock-unavailable' : 'storage-error' })
          return
        }
        bindings.current ??= { locks, store: createAtomicV28Store(factory),
          sourceStore: createAtomicV27Store(factory), v26Store: createAtomicV26Store(factory),
          v25Store: createAtomicV25Store(factory), v24Store: createAtomicV24Store(factory),
          v23Store: createAtomicV23Store(factory), v17Store: createAtomicV17Store(factory) }
        const result = await inspectPublicV28Entry(bindings.current)
        if (!cancelled) setEntry(result)
      } catch { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) }
    }
    void inspect()
    return () => { cancelled = true }
  }, [])
  const choose = async (choice: Choice) => {
    if (choosing.current || !bindings.current || entry.status === 'checking') return
    choosing.current = true; setBusy(true); setActionError(null)
    try {
      const result = await choosePublicV28Entry(entry, choice, bindings.current, seed)
      if (result.ok) setSession(result.value)
      else { setActionError(result.reason); setEntry(await inspectPublicV28Entry(bindings.current)) }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV28EntryView entry={entry} busy={busy} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} />
}
