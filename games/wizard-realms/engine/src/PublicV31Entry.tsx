import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { createAtomicV24Store } from './domain/atomicV24Database'
import { createAtomicV25Store } from './domain/atomicV25Database'
import { createAtomicV26Store } from './domain/atomicV26Database'
import { createAtomicV27Store } from './domain/atomicV27Database'
import { createAtomicV28Store } from './domain/atomicV28Database'
import { createAtomicV29Store } from './domain/atomicV29Database'
import { createAtomicV30Store } from './domain/atomicV30Database'
import { createAtomicV31Store } from './domain/atomicV31Database'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { inspectPublicV31, resumePublicV31, startPublicV31 } from './domain/publicWorldV31Flow'
import type { PublicV31Operation, PublicV31Start } from './domain/publicWorldV31Flow'
import type { PublicV31SourceReceipt } from './domain/publicWorldV31Migration'
import { choosePublicV30Entry, inspectPublicV30Entry } from './PublicV30Entry'
import type { PublicV30EntryBindings } from './PublicV30Entry'

export type PublicV31EntryBindings = Readonly<{ locks: PublicV7LockProvider;
  store: ReturnType<typeof createAtomicV31Store>;
  sourceStore: ReturnType<typeof createAtomicV30Store>;
  v29Store: ReturnType<typeof createAtomicV29Store>;
  v28Store: ReturnType<typeof createAtomicV28Store>;
  v27Store: ReturnType<typeof createAtomicV27Store>;
  v26Store: ReturnType<typeof createAtomicV26Store>;
  v25Store: ReturnType<typeof createAtomicV25Store>;
  v24Store: ReturnType<typeof createAtomicV24Store>;
  v23Store: ReturnType<typeof createAtomicV23Store>;
  v17Store: ReturnType<typeof createAtomicV17Store> }>
export type PublicV31EntryDecision = { status: 'resume'; start: PublicV31Start }
  | { status: 'migration-available'; sourceReceipt: PublicV31SourceReceipt }
  | { status: 'fresh-available' } | { status: 'older-world' }
  | { status: 'blocked'; reason: string }
type Choice = 'resume' | 'migrate' | 'create'
const v30Bindings = ({ locks, sourceStore, v29Store, v28Store, v27Store,
  v26Store, v25Store, v24Store, v23Store, v17Store }: PublicV31EntryBindings): PublicV30EntryBindings =>
  ({ locks, store: sourceStore, sourceStore: v29Store, v28Store, v27Store,
    v26Store, v25Store, v24Store, v23Store, v17Store })
const sourceMissing = new Set(['source-v30-missing', 'source-v29-missing',
  'source-v28-missing', 'source-v27-missing', 'source-v26-missing',
  'source-v25-missing', 'source-v24-missing', 'source-v23-missing'])

/** Inspection never creates a world or mutates its pinned, complete V30 source root. */
export async function inspectPublicV31Entry(bindings: PublicV31EntryBindings | null):
  Promise<PublicV31EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  try {
    const { locks, store, sourceStore, v29Store, v28Store, v27Store,
      v26Store, v25Store, v24Store, v23Store, v17Store } = bindings
    const result = await inspectPublicV31(locks, store, sourceStore, v29Store, v28Store,
      v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
    if (!result.ok) return { status: 'blocked', reason: result.reason }
    if (result.value.status === 'valid') return { status: 'resume', start: result.value.start }
    if (result.value.status === 'migration-available') return result.value
    if (!sourceMissing.has(result.value.reason)) return result.value
    const target = await store.readChecked()
    if (target.status !== 'missing') return { status: 'blocked',
      reason: target.status === 'valid' ? 'source-changed' : target.reason }
    const predecessor = await inspectPublicV30Entry(v30Bindings(bindings))
    if (predecessor.status === 'fresh-available'
      || predecessor.status === 'migration-available') return { status: 'fresh-available' }
    return predecessor.status === 'older-world' ? predecessor : { status: 'blocked',
      reason: predecessor.status === 'blocked' ? predecessor.reason : 'source-changed' }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV31Entry(decision: PublicV31EntryDecision, choice: Choice,
  bindings: PublicV31EntryBindings, seed: string): Promise<PublicV31Operation<PublicV31Start>> {
  const { locks, store, sourceStore, v29Store, v28Store, v27Store,
    v26Store, v25Store, v24Store, v23Store, v17Store } = bindings
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV31(
    locks, store, sourceStore, v29Store, v28Store, v27Store, v26Store,
    v25Store, v24Store, v23Store, v17Store, decision.start.head.saveRevision,
    decision.start.lineage)
  if (decision.status === 'migration-available' && choice === 'migrate') return startPublicV31(
    locks, store, sourceStore, v29Store, v28Store, v27Store, v26Store,
    v25Store, v24Store, v23Store, v17Store, decision.sourceReceipt.head.state.seed,
    decision.sourceReceipt)
  if (decision.status !== 'fresh-available' || choice !== 'create')
    return { ok: false, reason: 'choice-unavailable' }
  const current = await inspectPublicV31Entry(bindings)
  if (current.status !== 'fresh-available') return { ok: false,
    reason: current.status === 'blocked' ? current.reason : 'source-changed' }
  const predecessor = await inspectPublicV30Entry(v30Bindings(bindings))
  const predecessorChoice = predecessor.status === 'fresh-available' ? 'create'
    : predecessor.status === 'migration-available' ? 'migrate' : null
  if (!predecessorChoice) return { ok: false, reason: predecessor.status === 'blocked'
    ? predecessor.reason : 'source-changed' }
  const source = await choosePublicV30Entry(predecessor, predecessorChoice,
    v30Bindings(bindings), predecessor.status === 'migration-available'
      ? predecessor.sourceReceipt.head.state.seed : seed)
  if (!source.ok) return { ok: false, reason: source.reason }
  const ready = await inspectPublicV31(locks, store, sourceStore, v29Store, v28Store,
    v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
  if (!ready.ok || ready.value.status !== 'migration-available') return { ok: false,
    reason: ready.ok && ready.value.status === 'blocked' ? ready.value.reason : 'source-changed' }
  return startPublicV31(locks, store, sourceStore, v29Store, v28Store, v27Store,
    v26Store, v25Store, v24Store, v23Store, v17Store,
    ready.value.sourceReceipt.head.state.seed, ready.value.sourceReceipt)
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV31EntryView({ entry, busy, onChoose, onRetry, actionError }: {
  entry: PublicV31EntryDecision | { status: 'checking' }; busy: boolean;
  onChoose: (choice: Choice) => void; onRetry: () => void; actionError: string | null }) {
  return <main data-public-v31-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}><section style={{ maxWidth: 560 }}>
    <h1>Wizard Realms</h1>
    {entry.status === 'checking' && <p role="status">Checking this device for a V31 world…</p>}
    {entry.status === 'fresh-available' && <><p>Begin exploring, gathering, building, and learning
      magic. Progress is saved on this device, not backed up online. Older saves remain unchanged.</p>
      <p>A separate checked V31 save will be created from a V30 foundation.</p>
      <button type="button" style={button} disabled={busy} onClick={() => onChoose('create')}>{busy
        ? 'Preparing your adventure…' : 'Start new adventure'}</button></>}
    {entry.status === 'resume' && <><p role="status">Your saved adventure is ready.</p>
      <button type="button" style={button} disabled={busy} onClick={() => onChoose('resume')}>Continue adventure</button></>}
    {entry.status === 'migration-available' && <><p>Continue from your existing adventure.
      Checkpoint and close the V30 tab first. A separate checked V31 copy will be made from its
      last saved state; the older world remains unchanged.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('migrate')}>{busy
        ? 'Copying your save…' : 'Continue adventure'}</button></>}
    {entry.status === 'older-world' && <><p role="status">An older world needs its checked V30
      foundation before V31 can start. No save was reset.</p><a href="?publicWorld=v30">
      Open V30 entry</a></>}
    {entry.status === 'blocked' && <><p role="alert">V31 access is blocked ({entry.reason}).
      Your saves were not reset.</p><button type="button" style={button} disabled={busy}
      onClick={onRetry}>Reload to recheck</button></>}
    {actionError && <p role="alert">The selected action did not complete ({actionError}).
      No save was cleared. Reload to recheck or retry the available action.</p>}
  </section></main>
}

export function PublicV31EntryApp({ renderSession, seed = 'greenway-alpha' }: {
  renderSession: (start: PublicV31Start, bindings: PublicV31EntryBindings) => ReactNode;
  seed?: string }) {
  const bindings = useRef<PublicV31EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV31EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV31Start | null>(null)
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
        bindings.current ??= { locks, store: createAtomicV31Store(factory),
          sourceStore: createAtomicV30Store(factory), v29Store: createAtomicV29Store(factory),
          v28Store: createAtomicV28Store(factory), v27Store: createAtomicV27Store(factory),
          v26Store: createAtomicV26Store(factory), v25Store: createAtomicV25Store(factory),
          v24Store: createAtomicV24Store(factory), v23Store: createAtomicV23Store(factory),
          v17Store: createAtomicV17Store(factory) }
        const result = await inspectPublicV31Entry(bindings.current)
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
      const result = await choosePublicV31Entry(entry, choice, bindings.current, seed)
      if (result.ok) setSession(result.value)
      else { setActionError(result.reason); setEntry(await inspectPublicV31Entry(bindings.current)) }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV31EntryView entry={entry} busy={busy} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} />
}
