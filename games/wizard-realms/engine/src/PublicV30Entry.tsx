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
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { inspectPublicV30, resumePublicV30, startPublicV30 } from './domain/publicWorldV30Flow'
import type { PublicV30Operation, PublicV30Start } from './domain/publicWorldV30Flow'
import type { PublicV30SourceReceipt } from './domain/publicWorldV30Migration'
import { choosePublicV29Entry, inspectPublicV29Entry } from './PublicV29Entry'
import type { PublicV29EntryBindings } from './PublicV29Entry'

export type PublicV30EntryBindings = Readonly<{ locks: PublicV7LockProvider;
  store: ReturnType<typeof createAtomicV30Store>;
  sourceStore: ReturnType<typeof createAtomicV29Store>;
  v28Store: ReturnType<typeof createAtomicV28Store>;
  v27Store: ReturnType<typeof createAtomicV27Store>;
  v26Store: ReturnType<typeof createAtomicV26Store>;
  v25Store: ReturnType<typeof createAtomicV25Store>;
  v24Store: ReturnType<typeof createAtomicV24Store>;
  v23Store: ReturnType<typeof createAtomicV23Store>;
  v17Store: ReturnType<typeof createAtomicV17Store> }>
export type PublicV30EntryDecision = { status: 'resume'; start: PublicV30Start }
  | { status: 'migration-available'; sourceReceipt: PublicV30SourceReceipt }
  | { status: 'fresh-available' } | { status: 'older-world' }
  | { status: 'blocked'; reason: string }
type Choice = 'resume' | 'migrate' | 'create'
const v29Bindings = ({ locks, sourceStore, v28Store, v27Store, v26Store,
  v25Store, v24Store, v23Store, v17Store }: PublicV30EntryBindings): PublicV29EntryBindings =>
  ({ locks, store: sourceStore, sourceStore: v28Store, v27Store, v26Store,
    v25Store, v24Store, v23Store, v17Store })
const sourceMissing = new Set(['source-v29-missing', 'source-v28-missing',
  'source-v27-missing', 'source-v26-missing', 'source-v25-missing',
  'source-v24-missing', 'source-v23-missing'])

/** Reading V30 never creates a save or mutates its pinned V29 source. */
export async function inspectPublicV30Entry(bindings: PublicV30EntryBindings | null):
  Promise<PublicV30EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  try {
    const { locks, store, sourceStore, v28Store, v27Store, v26Store,
      v25Store, v24Store, v23Store, v17Store } = bindings
    const result = await inspectPublicV30(locks, store, sourceStore, v28Store,
      v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
    if (!result.ok) return { status: 'blocked', reason: result.reason }
    if (result.value.status === 'valid') return { status: 'resume', start: result.value.start }
    if (result.value.status === 'migration-available') return result.value
    if (!sourceMissing.has(result.value.reason)) return result.value
    const target = await store.readChecked()
    if (target.status !== 'missing') return { status: 'blocked',
      reason: target.status === 'valid' ? 'source-changed' : target.reason }
    const predecessor = await inspectPublicV29Entry(v29Bindings(bindings))
    if (predecessor.status === 'fresh-available'
      || predecessor.status === 'migration-available') return { status: 'fresh-available' }
    return predecessor.status === 'older-world' ? predecessor : { status: 'blocked',
      reason: predecessor.status === 'blocked' ? predecessor.reason : 'source-changed' }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV30Entry(decision: PublicV30EntryDecision, choice: Choice,
  bindings: PublicV30EntryBindings, seed: string): Promise<PublicV30Operation<PublicV30Start>> {
  const { locks, store, sourceStore, v28Store, v27Store, v26Store,
    v25Store, v24Store, v23Store, v17Store } = bindings
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV30(
    locks, store, sourceStore, v28Store, v27Store, v26Store, v25Store,
    v24Store, v23Store, v17Store, decision.start.head.saveRevision, decision.start.lineage)
  if (decision.status === 'migration-available' && choice === 'migrate') return startPublicV30(
    locks, store, sourceStore, v28Store, v27Store, v26Store, v25Store,
    v24Store, v23Store, v17Store, decision.sourceReceipt.head.state.seed,
    decision.sourceReceipt)
  if (decision.status !== 'fresh-available' || choice !== 'create')
    return { ok: false, reason: 'choice-unavailable' }
  const current = await inspectPublicV30Entry(bindings)
  if (current.status !== 'fresh-available') return { ok: false,
    reason: current.status === 'blocked' ? current.reason : 'source-changed' }
  const predecessor = await inspectPublicV29Entry(v29Bindings(bindings))
  const predecessorChoice = predecessor.status === 'fresh-available' ? 'create'
    : predecessor.status === 'migration-available' ? 'migrate' : null
  if (!predecessorChoice) return { ok: false, reason: predecessor.status === 'blocked'
    ? predecessor.reason : 'source-changed' }
  const source = await choosePublicV29Entry(predecessor, predecessorChoice,
    v29Bindings(bindings), predecessor.status === 'migration-available'
      ? predecessor.sourceReceipt.head.state.seed : seed)
  if (!source.ok) return { ok: false, reason: source.reason }
  const ready = await inspectPublicV30(locks, store, sourceStore, v28Store,
    v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
  if (!ready.ok || ready.value.status !== 'migration-available') return { ok: false,
    reason: ready.ok && ready.value.status === 'blocked' ? ready.value.reason : 'source-changed' }
  return startPublicV30(locks, store, sourceStore, v28Store, v27Store, v26Store,
    v25Store, v24Store, v23Store, v17Store, ready.value.sourceReceipt.head.state.seed,
    ready.value.sourceReceipt)
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV30EntryView({ entry, busy, onChoose, onRetry, actionError }: {
  entry: PublicV30EntryDecision | { status: 'checking' }; busy: boolean;
  onChoose: (choice: Choice) => void; onRetry: () => void; actionError: string | null }) {
  return <main data-public-v30-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}><section style={{ maxWidth: 560 }}>
    <h1>Wizard Realms: River Works</h1>
    {entry.status === 'checking' && <p role="status">Checking this device for a V30 world…</p>}
    {entry.status === 'fresh-available' && <><p>Start a local V30 world by creating a checked V29
      foundation, then copying it into a separate V30 save. Your older saves remain unchanged.
      This browser save is not backed up online.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('create')}>Create V29 foundation and V30 copy</button></>}
    {entry.status === 'resume' && <><p role="status">Validated V30 save
      #{entry.start.head.saveRevision} is ready.</p><button type="button"
      style={button} disabled={busy} onClick={() => onChoose('resume')}>Resume V30 world</button></>}
    {entry.status === 'migration-available' && <><p>A validated V29 world can be copied into a
      separate V30 save. Checkpoint and close the V29 tab first. Only its last committed save
      is copied; the V29 world remains unchanged.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('migrate')}>Copy V29 world into V30</button></>}
    {entry.status === 'older-world' && <><p role="status">An older world needs its checked V29
      foundation before V30 can start. No save was reset.</p><a href="?publicWorld=v29">
      Open V29 entry</a></>}
    {entry.status === 'blocked' && <><p role="alert">V30 access is blocked ({entry.reason}).
      Your saves were not reset.</p><button type="button" style={button} disabled={busy}
      onClick={onRetry}>Reload to recheck</button></>}
    {actionError && <p role="alert">The selected action did not complete ({actionError}).
      No save was cleared. Reload to recheck or retry the available action.</p>}
  </section></main>
}

export function PublicV30EntryApp({ renderSession, seed = 'greenway-alpha' }: {
  renderSession: (start: PublicV30Start, bindings: PublicV30EntryBindings) => ReactNode;
  seed?: string }) {
  const bindings = useRef<PublicV30EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV30EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV30Start | null>(null)
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
        bindings.current ??= { locks, store: createAtomicV30Store(factory),
          sourceStore: createAtomicV29Store(factory), v28Store: createAtomicV28Store(factory),
          v27Store: createAtomicV27Store(factory), v26Store: createAtomicV26Store(factory),
          v25Store: createAtomicV25Store(factory), v24Store: createAtomicV24Store(factory),
          v23Store: createAtomicV23Store(factory), v17Store: createAtomicV17Store(factory) }
        const result = await inspectPublicV30Entry(bindings.current)
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
      const result = await choosePublicV30Entry(entry, choice, bindings.current, seed)
      if (result.ok) setSession(result.value)
      else { setActionError(result.reason); setEntry(await inspectPublicV30Entry(bindings.current)) }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV30EntryView entry={entry} busy={busy} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} />
}
