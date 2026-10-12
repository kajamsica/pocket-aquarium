import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { createAtomicV24Store } from './domain/atomicV24Database'
import { inspectPublicV23 } from './domain/publicWorldV23Flow'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { inspectPublicV24, resumePublicV24, startFreshPublicV24World,
  startPublicV24 } from './domain/publicWorldV24Flow'
import type { PublicV24Inspection, PublicV24Operation, PublicV24Start } from './domain/publicWorldV24Flow'

export type PublicV24EntryBindings = Readonly<{ locks: PublicV7LockProvider;
  store: ReturnType<typeof createAtomicV24Store>;
  sourceStore: ReturnType<typeof createAtomicV23Store>;
  ancestorStore: ReturnType<typeof createAtomicV17Store> }>
export type PublicV24EntryDecision = { status: 'resume'; start: PublicV24Start }
  | { status: 'fresh-available' }
  | Extract<PublicV24Inspection, { status: 'migration-available' | 'blocked' }>
export type PublicV24EntryChoice = 'resume' | 'migrate' | 'create'

/** The checked flow alone decides whether a V23 source may be promoted. */
export async function inspectPublicV24Entry(bindings: PublicV24EntryBindings | null):
  Promise<PublicV24EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  const result = await inspectPublicV24(bindings.locks, bindings.store,
    bindings.sourceStore, bindings.ancestorStore)
  if (!result.ok) return { status: 'blocked', reason: result.reason }
  if (result.value.status === 'valid') return { status: 'resume', start: result.value.start }
  if (result.value.status === 'blocked' && result.value.reason === 'source-v23-missing') {
    const source = await inspectPublicV23(bindings.locks, bindings.sourceStore,
      bindings.ancestorStore)
    if (!source.ok) return { status: 'blocked', reason: source.reason }
    if (source.value.status === 'fresh-available') {
      const target = await bindings.store.readChecked()
      return target.status === 'missing' ? { status: 'fresh-available' }
        : { status: 'blocked', reason: target.status === 'valid'
          ? 'target-conflict' : target.reason }
    }
    if (source.value.status === 'blocked') return source.value
    return { status: 'blocked', reason: source.value.status === 'migration-available'
      ? 'source-v23-missing' : 'source-changed' }
  }
  return result.value
}

export async function choosePublicV24Entry(decision: PublicV24EntryDecision,
  choice: PublicV24EntryChoice, bindings: PublicV24EntryBindings, seed: string):
  Promise<PublicV24Operation<PublicV24Start>> {
  if (decision.status === 'fresh-available' && choice === 'create') {
    return startFreshPublicV24World(bindings.locks, bindings.store, bindings.sourceStore,
      bindings.ancestorStore, seed)
  }
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV24(
    bindings.locks, bindings.store, bindings.sourceStore, bindings.ancestorStore,
    decision.start.head.saveRevision, decision.start.lineage)
  if (decision.status === 'migration-available' && choice === 'migrate') return startPublicV24(
    bindings.locks, bindings.store, bindings.sourceStore, bindings.ancestorStore,
    seed, decision.sourceReceipt)
  return Promise.resolve({ ok: false, reason: 'choice-unavailable' })
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV24EntryView({ entry, busy, onChoose, onRetry, actionError }: {
  entry: PublicV24EntryDecision | { status: 'checking' }; busy: boolean;
  onChoose: (choice: PublicV24EntryChoice) => void; onRetry: () => void;
  actionError: string | null }) {
  return <main data-public-v24-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}>
    <section style={{ maxWidth: 560 }}><h1>Wizard Realms: Mireglass</h1>
      {entry.status === 'checking' && <p role="status">Checking this device for a V24 world…</p>}
      {entry.status === 'fresh-available' && <><p>Start a new world saved in this browser.
        This local save is not backed up online.</p>
        <button type="button" style={button} disabled={busy}
          onClick={() => onChoose('create')}>Start new world</button></>}
      {entry.status === 'resume' && <><p role="status">Validated V24 save
        #{entry.start.head.saveRevision} is ready.</p><button type="button" style={button}
        disabled={busy} onClick={() => onChoose('resume')}>Resume V24 world</button></>}
      {entry.status === 'migration-available' && <><p>A validated V23 world can be
        copied into V24. In V23, Save now/checkpoint and close that tab before migrating.
        This copies only the last committed V23 save; the V23 save remains in place.</p><button type="button" style={button}
        disabled={busy} onClick={() => onChoose('migrate')}>Migrate V23 world</button></>}
      {entry.status === 'blocked' && <><p role="alert">V24 access is blocked
        ({entry.reason}). Your saves were not reset.</p>{entry.reason === 'source-v23-missing'
        && <p>If you have a V17 world, migrate it through <a href="?publicWorld=v23">V23</a> first.</p>}
        <button type="button" style={button} disabled={busy} onClick={onRetry}>Reload to recheck</button></>}
      {actionError && <p role="alert">The selected action did not complete
        ({actionError}). No save was cleared.</p>}
    </section>
  </main>
}

export function PublicV24EntryApp({ renderSession, seed = 'greenway-alpha' }: {
  renderSession: (start: PublicV24Start, bindings: PublicV24EntryBindings) => ReactNode;
  seed?: string }) {
  const bindings = useRef<PublicV24EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV24EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV24Start | null>(null)
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
        bindings.current ??= { locks, store: createAtomicV24Store(factory),
          sourceStore: createAtomicV23Store(factory), ancestorStore: createAtomicV17Store(factory) }
        const result = await inspectPublicV24Entry(bindings.current)
        if (!cancelled) setEntry(result)
      } catch { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) }
    }
    void inspect()
    return () => { cancelled = true }
  }, [])
  const choose = async (choice: PublicV24EntryChoice) => {
    if (choosing.current || !bindings.current || entry.status === 'checking') return
    choosing.current = true; setBusy(true); setActionError(null)
    try {
      const result = await choosePublicV24Entry(entry, choice, bindings.current, seed)
      if (result.ok) setSession(result.value)
      else {
        setActionError(result.reason)
        setEntry(await inspectPublicV24Entry(bindings.current))
      }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV24EntryView entry={entry} busy={busy} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} />
}
