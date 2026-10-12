import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { createAtomicV24Store } from './domain/atomicV24Database'
import { createAtomicV25Store } from './domain/atomicV25Database'
import { startFreshPublicV24World } from './domain/publicWorldV24Flow'
import { inspectPublicV25, resumePublicV25, startPublicV25 } from './domain/publicWorldV25Flow'
import type { PublicV25Operation, PublicV25Start } from './domain/publicWorldV25Flow'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { inspectPublicV24Entry } from './PublicV24Entry'

export type PublicV25EntryBindings = Readonly<{ locks: PublicV7LockProvider;
  store: ReturnType<typeof createAtomicV25Store>;
  sourceStore: ReturnType<typeof createAtomicV24Store>;
  v23Store: ReturnType<typeof createAtomicV23Store>;
  v17Store: ReturnType<typeof createAtomicV17Store> }>
export type PublicV25EntryDecision = { status: 'resume'; start: PublicV25Start }
  | { status: 'migration-available'; sourceReceipt: PublicV25Start['lineage']['sourceReceipt'] }
  | { status: 'fresh-available' }
  | { status: 'older-world'; route: 'v23' | 'v24' }
  | { status: 'blocked'; reason: string }
export type PublicV25EntryChoice = 'resume' | 'migrate' | 'create'

/** Classify partial older worlds without treating them as blank V25 profiles. */
export async function inspectPublicV25Entry(bindings: PublicV25EntryBindings | null):
  Promise<PublicV25EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  try {
    const { locks, store, sourceStore, v23Store, v17Store } = bindings
    const result = await inspectPublicV25(locks, store, sourceStore, v23Store, v17Store)
    if (!result.ok) return { status: 'blocked', reason: result.reason }
    if (result.value.status === 'valid') return { status: 'resume', start: result.value.start }
    if (result.value.status === 'migration-available') return result.value
    if (result.value.reason !== 'source-v24-missing'
      && result.value.reason !== 'source-v23-missing') return result.value
    const target = await store.readChecked()
    if (target.status !== 'missing') return { status: 'blocked', reason: target.status === 'valid'
      ? 'target-conflict' : target.reason }
    const older = await inspectPublicV24Entry({ locks, store: sourceStore,
      sourceStore: v23Store, ancestorStore: v17Store })
    if (older.status === 'fresh-available') return older
    if (older.status === 'migration-available') return { status: 'older-world', route: 'v24' }
    if (older.status === 'blocked' && older.reason === 'source-v23-missing')
      return { status: 'older-world', route: 'v23' }
    return { status: 'blocked', reason: older.status === 'blocked' ? older.reason : 'source-changed' }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV25Entry(decision: PublicV25EntryDecision,
  choice: PublicV25EntryChoice, bindings: PublicV25EntryBindings, seed: string):
  Promise<PublicV25Operation<PublicV25Start>> {
  const { locks, store, sourceStore, v23Store, v17Store } = bindings
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV25(
    locks, store, sourceStore, v23Store, v17Store,
    decision.start.head.saveRevision, decision.start.lineage)
  if (decision.status === 'migration-available' && choice === 'migrate') return startPublicV25(
    locks, store, sourceStore, v23Store, v17Store, seed, decision.sourceReceipt)
  if (decision.status === 'fresh-available' && choice === 'create') {
    const fresh = await startFreshPublicV24World(locks, sourceStore, v23Store, v17Store, seed)
    return fresh.ok ? startPublicV25(locks, store, sourceStore, v23Store, v17Store,
      seed, { head: fresh.value.head, lineage: fresh.value.lineage }) : fresh
  }
  return { ok: false, reason: 'choice-unavailable' }
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV25EntryView({ entry, busy, onChoose, onRetry, actionError }: {
  entry: PublicV25EntryDecision | { status: 'checking' }; busy: boolean;
  onChoose: (choice: PublicV25EntryChoice) => void; onRetry: () => void;
  actionError: string | null }) {
  return <main data-public-v25-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}>
    <section style={{ maxWidth: 560 }}><h1>Wizard Realms: Connected River</h1>
      {entry.status === 'checking' && <p role="status">Checking this device for a V25 world…</p>}
      {entry.status === 'fresh-available' && <><p>Start a new local world. Its checked V24 foundation
        will be created first, then copied into V25. This browser save is not backed up online.</p>
        <button type="button" style={button} disabled={busy}
          onClick={() => onChoose('create')}>Start new V25 world</button></>}
      {entry.status === 'resume' && <><p role="status">Validated V25 save
        #{entry.start.head.saveRevision} is ready.</p><button type="button" style={button}
        disabled={busy} onClick={() => onChoose('resume')}>Resume V25 world</button></>}
      {entry.status === 'migration-available' && <><p>A validated V24 world can be copied into V25.
        Save now or checkpoint and close the V24 tab before migrating. This copies only the last
        committed V24 save. Your V24 save remains in place.</p><button type="button" style={button}
        disabled={busy} onClick={() => onChoose('migrate')}>Copy V24 world into V25</button></>}
      {entry.status === 'older-world' && <><p role="status">This browser has an older world.
        Continue its checked migration through V{entry.route === 'v23' ? '23' : '24'} first.
        No save was reset.</p><a href={`?publicWorld=${entry.route}`}>
          Open V{entry.route === 'v23' ? '23' : '24'} entry</a></>}
      {entry.status === 'blocked' && <><p role="alert">V25 access is blocked
        ({entry.reason}). Your saves were not reset.</p>
        <button type="button" style={button} disabled={busy} onClick={onRetry}>Reload to recheck</button></>}
      {actionError && <p role="alert">The selected action did not complete
        ({actionError}). No save was cleared. Reload to recheck or retry the available action.</p>}
    </section>
  </main>
}

export function PublicV25EntryApp({ renderSession, seed = 'greenway-alpha' }: {
  renderSession: (start: PublicV25Start, bindings: PublicV25EntryBindings) => ReactNode;
  seed?: string }) {
  const bindings = useRef<PublicV25EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV25EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV25Start | null>(null)
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
        bindings.current ??= { locks, store: createAtomicV25Store(factory),
          sourceStore: createAtomicV24Store(factory), v23Store: createAtomicV23Store(factory),
          v17Store: createAtomicV17Store(factory) }
        const result = await inspectPublicV25Entry(bindings.current)
        if (!cancelled) setEntry(result)
      } catch { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) }
    }
    void inspect()
    return () => { cancelled = true }
  }, [])
  const choose = async (choice: PublicV25EntryChoice) => {
    if (choosing.current || !bindings.current || entry.status === 'checking') return
    choosing.current = true; setBusy(true); setActionError(null)
    try {
      const result = await choosePublicV25Entry(entry, choice, bindings.current, seed)
      if (result.ok) setSession(result.value)
      else { setActionError(result.reason); setEntry(await inspectPublicV25Entry(bindings.current)) }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV25EntryView entry={entry} busy={busy} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} />
}
