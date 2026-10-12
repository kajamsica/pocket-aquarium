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
import { createAtomicV32Store } from './domain/atomicV32Database'
import { createAtomicV33Store } from './domain/atomicV33Database'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { inspectPublicV33, resumePublicV33, startPublicV33 } from './domain/publicWorldV33Flow'
import type { PublicV33Operation, PublicV33Start } from './domain/publicWorldV33Flow'
import type { PublicV33SourceReceipt } from './domain/publicWorldV33Migration'
import { choosePublicV32Entry, inspectPublicV32Entry } from './PublicV32Entry'
import type { PublicV32EntryBindings } from './PublicV32Entry'

export type PublicV33EntryBindings = Readonly<{ locks: PublicV7LockProvider;
  store: ReturnType<typeof createAtomicV33Store>;
  sourceStore: ReturnType<typeof createAtomicV32Store>;
  v31Store: ReturnType<typeof createAtomicV31Store>;
  v30Store: ReturnType<typeof createAtomicV30Store>;
  v29Store: ReturnType<typeof createAtomicV29Store>;
  v28Store: ReturnType<typeof createAtomicV28Store>;
  v27Store: ReturnType<typeof createAtomicV27Store>;
  v26Store: ReturnType<typeof createAtomicV26Store>;
  v25Store: ReturnType<typeof createAtomicV25Store>;
  v24Store: ReturnType<typeof createAtomicV24Store>;
  v23Store: ReturnType<typeof createAtomicV23Store>;
  v17Store: ReturnType<typeof createAtomicV17Store> }>
export type PublicV33EntryDecision = { status: 'resume'; start: PublicV33Start }
  | { status: 'migration-available'; sourceReceipt: PublicV33SourceReceipt }
  | { status: 'predecessor-migration-available' }
  | { status: 'fresh-available' } | { status: 'older-world' }
  | { status: 'blocked'; reason: string }
type Choice = 'resume' | 'migrate' | 'create'
const v32Bindings = ({ locks, sourceStore, v31Store, v30Store, v29Store,
  v28Store, v27Store, v26Store, v25Store, v24Store, v23Store, v17Store }:
  PublicV33EntryBindings): PublicV32EntryBindings => ({ locks, store: sourceStore,
    sourceStore: v31Store, v30Store, v29Store, v28Store, v27Store, v26Store,
    v25Store, v24Store, v23Store, v17Store })
const sourceMissing = new Set(['source-v32-missing', 'source-v31-missing',
  'source-v30-missing', 'source-v29-missing', 'source-v28-missing',
  'source-v27-missing', 'source-v26-missing', 'source-v25-missing',
  'source-v24-missing', 'source-v23-missing'])

/** Inspection only reads V33 and its checked V32 ancestry. */
export async function inspectPublicV33Entry(bindings: PublicV33EntryBindings | null):
  Promise<PublicV33EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  try {
    const { locks, store, sourceStore, v31Store, v30Store, v29Store,
      v28Store, v27Store, v26Store, v25Store, v24Store, v23Store, v17Store } = bindings
    const result = await inspectPublicV33(locks, store, sourceStore, v31Store,
      v30Store, v29Store, v28Store, v27Store, v26Store, v25Store, v24Store,
      v23Store, v17Store)
    if (!result.ok) return { status: 'blocked', reason: result.reason }
    if (result.value.status === 'valid') return { status: 'resume', start: result.value.start }
    if (result.value.status === 'migration-available') return result.value
    if (!sourceMissing.has(result.value.reason)) return result.value
    const target = await store.readChecked()
    if (target.status !== 'missing') return { status: 'blocked',
      reason: target.status === 'valid' ? 'source-changed' : target.reason }
    const predecessor = await inspectPublicV32Entry(v32Bindings(bindings))
    if (predecessor.status === 'fresh-available') return { status: 'fresh-available' }
    if (predecessor.status === 'migration-available')
      return { status: 'predecessor-migration-available' }
    return predecessor.status === 'older-world' ? predecessor : { status: 'blocked',
      reason: predecessor.status === 'blocked' ? predecessor.reason : 'source-changed' }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV33Entry(decision: PublicV33EntryDecision, choice: Choice,
  bindings: PublicV33EntryBindings, seed: string): Promise<PublicV33Operation<PublicV33Start>> {
  const { locks, store, sourceStore, v31Store, v30Store, v29Store,
    v28Store, v27Store, v26Store, v25Store, v24Store, v23Store, v17Store } = bindings
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV33(
    locks, store, sourceStore, v31Store, v30Store, v29Store, v28Store, v27Store,
    v26Store, v25Store, v24Store, v23Store, v17Store, decision.start.head.saveRevision,
    decision.start.lineage)
  if (decision.status === 'migration-available' && choice === 'migrate') return startPublicV33(
    locks, store, sourceStore, v31Store, v30Store, v29Store, v28Store, v27Store,
    v26Store, v25Store, v24Store, v23Store, v17Store,
    decision.sourceReceipt.head.state.seed, decision.sourceReceipt)
  if (!((decision.status === 'fresh-available' && choice === 'create')
    || (decision.status === 'predecessor-migration-available' && choice === 'migrate')))
    return { ok: false, reason: 'choice-unavailable' }
  const current = await inspectPublicV33Entry(bindings)
  if (current.status !== decision.status) return { ok: false,
    reason: current.status === 'blocked' ? current.reason : 'source-changed' }
  const predecessor = await inspectPublicV32Entry(v32Bindings(bindings))
  const predecessorChoice = predecessor.status === 'fresh-available' && choice === 'create'
    ? 'create' : predecessor.status === 'migration-available' && choice === 'migrate'
      ? 'migrate' : null
  if (!predecessorChoice) return { ok: false, reason: predecessor.status === 'blocked'
    ? predecessor.reason : 'source-changed' }
  const source = await choosePublicV32Entry(predecessor, predecessorChoice,
    v32Bindings(bindings), predecessor.status === 'migration-available'
      ? predecessor.sourceReceipt.head.state.seed : seed)
  if (!source.ok) return { ok: false, reason: source.reason }
  const ready = await inspectPublicV33(locks, store, sourceStore, v31Store,
    v30Store, v29Store, v28Store, v27Store, v26Store, v25Store, v24Store,
    v23Store, v17Store)
  if (!ready.ok || ready.value.status !== 'migration-available') return { ok: false,
    reason: ready.ok && ready.value.status === 'blocked' ? ready.value.reason : 'source-changed' }
  return startPublicV33(locks, store, sourceStore, v31Store, v30Store, v29Store,
    v28Store, v27Store, v26Store, v25Store, v24Store, v23Store, v17Store,
    ready.value.sourceReceipt.head.state.seed, ready.value.sourceReceipt)
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV33EntryView({ entry, busy, onChoose, onRetry, actionError }: {
  entry: PublicV33EntryDecision | { status: 'checking' }; busy: boolean;
  onChoose: (choice: Choice) => void; onRetry: () => void; actionError: string | null }) {
  return <main data-public-v33-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}><section style={{ maxWidth: 560 }}>
    <h1>Wizard Realms</h1>
    {entry.status === 'checking' && <p role="status">Checking this device for an adventure…</p>}
    {entry.status === 'fresh-available' && <><p>Explore a connected world, gather materials,
      learn magic, and discover the fairy rings that link Greenway and Mireglass.</p>
      <p>Your adventure is saved on this device. Starting creates a checked foundation and
      a separate world copy; older saves are not reset.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('create')}>{busy ? 'Preparing adventure…'
        : 'Start new adventure'}</button></>}
    {entry.status === 'resume' && <><p role="status">Your validated adventure is ready
      at save #{entry.start.head.saveRevision}.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('resume')}>Continue adventure</button></>}
    {entry.status === 'migration-available' && <><p>A saved adventure is available. Copy its
      last committed state into a separate fairy-ring save. Close the older game tab first;
      its save remains unchanged.</p><button type="button" style={button} disabled={busy}
      onClick={() => onChoose('migrate')}>{busy ? 'Copying saved adventure…'
        : 'Continue adventure'}</button></>}
    {entry.status === 'predecessor-migration-available' && <><p>A saved adventure is available
      in an earlier world. Continue by copying its last committed state into separate previous
      and fairy-ring saves. Close older game tabs first; your older save remains unchanged.</p>
      <button type="button" style={button} disabled={busy} onClick={() => onChoose('migrate')}>
        {busy ? 'Copying saved adventure…' : 'Continue adventure'}</button></>}
    {entry.status === 'older-world' && <><p role="status">An older adventure needs its checked
      foundation before the fairy-ring world can start. No save was reset.</p>
      <a href="?publicWorld=v32">Open the previous adventure</a></>}
    {entry.status === 'blocked' && <><p role="alert">This adventure cannot open yet
      ({entry.reason}). Your saves were not reset.</p><button type="button" style={button}
      disabled={busy} onClick={onRetry}>Reload to recheck</button></>}
    {actionError && <p role="alert">The action did not complete ({actionError}).
      No save was cleared. Reload to recheck or retry.</p>}
  </section></main>
}

export function PublicV33EntryApp({ renderSession, seed = 'greenway-alpha' }: {
  renderSession: (start: PublicV33Start, bindings: PublicV33EntryBindings) => ReactNode;
  seed?: string }) {
  const bindings = useRef<PublicV33EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV33EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV33Start | null>(null)
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
        bindings.current ??= { locks, store: createAtomicV33Store(factory),
          sourceStore: createAtomicV32Store(factory), v31Store: createAtomicV31Store(factory),
          v30Store: createAtomicV30Store(factory), v29Store: createAtomicV29Store(factory),
          v28Store: createAtomicV28Store(factory), v27Store: createAtomicV27Store(factory),
          v26Store: createAtomicV26Store(factory), v25Store: createAtomicV25Store(factory),
          v24Store: createAtomicV24Store(factory), v23Store: createAtomicV23Store(factory),
          v17Store: createAtomicV17Store(factory) }
        const result = await inspectPublicV33Entry(bindings.current)
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
      const result = await choosePublicV33Entry(entry, choice, bindings.current, seed)
      if (result.ok) setSession(result.value)
      else { setActionError(result.reason); setEntry(await inspectPublicV33Entry(bindings.current)) }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV33EntryView entry={entry} busy={busy} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} />
}
