import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { createAtomicV24Store } from './domain/atomicV24Database'
import { createAtomicV25Store } from './domain/atomicV25Database'
import { createAtomicV26Store } from './domain/atomicV26Database'
import { inspectPublicV26, resumePublicV26, startPublicV26 } from './domain/publicWorldV26Flow'
import type { PublicV26Operation, PublicV26Start } from './domain/publicWorldV26Flow'
import type { PublicV26SourceReceipt } from './domain/publicWorldV26Migration'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { choosePublicV25Entry, inspectPublicV25Entry } from './PublicV25Entry'

export type PublicV26EntryBindings = Readonly<{ locks: PublicV7LockProvider;
  store: ReturnType<typeof createAtomicV26Store>;
  sourceStore: ReturnType<typeof createAtomicV25Store>;
  v24Store: ReturnType<typeof createAtomicV24Store>;
  v23Store: ReturnType<typeof createAtomicV23Store>;
  v17Store: ReturnType<typeof createAtomicV17Store> }>
export type PublicV26EntryDecision = { status: 'resume'; start: PublicV26Start }
  | { status: 'migration-available'; sourceReceipt: PublicV26SourceReceipt }
  | { status: 'fresh-available' }
  | { status: 'older-world' }
  | { status: 'blocked'; reason: string }
export type PublicV26EntryChoice = 'resume' | 'migrate' | 'create'

/** Offer creation only when the checked V25 entry confirms a blank source chain. */
export async function inspectPublicV26Entry(bindings: PublicV26EntryBindings | null):
  Promise<PublicV26EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  try {
    const { locks, store, sourceStore, v24Store, v23Store, v17Store } = bindings
    const result = await inspectPublicV26(locks, store, sourceStore, v24Store, v23Store, v17Store)
    if (!result.ok) return { status: 'blocked', reason: result.reason }
    if (result.value.status === 'valid') return { status: 'resume', start: result.value.start }
    if (result.value.status === 'migration-available') return result.value
    if (!['source-v25-missing', 'source-v24-missing', 'source-v23-missing']
      .includes(result.value.reason)) return result.value
    const target = await store.readChecked()
    if (target.status !== 'missing') return { status: 'blocked',
      reason: target.status === 'valid' ? 'target-conflict' : target.reason }
    const predecessor = await inspectPublicV25Entry({ locks, store: sourceStore,
      sourceStore: v24Store, v23Store, v17Store })
    if (predecessor.status === 'fresh-available') return predecessor
    if (predecessor.status === 'older-world' || predecessor.status === 'migration-available')
      return { status: 'older-world' }
    return { status: 'blocked', reason: predecessor.status === 'blocked'
      ? predecessor.reason : 'source-changed' }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV26Entry(decision: PublicV26EntryDecision,
  choice: PublicV26EntryChoice, bindings: PublicV26EntryBindings, seed: string):
  Promise<PublicV26Operation<PublicV26Start>> {
  const { locks, store, sourceStore, v24Store, v23Store, v17Store } = bindings
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV26(
    locks, store, sourceStore, v24Store, v23Store, v17Store,
    decision.start.head.saveRevision, decision.start.lineage)
  if (decision.status === 'migration-available' && choice === 'migrate') return startPublicV26(
    locks, store, sourceStore, v24Store, v23Store, v17Store, seed, decision.sourceReceipt)
  if (decision.status === 'fresh-available' && choice === 'create') {
    const current = await inspectPublicV26Entry(bindings)
    if (current.status !== 'fresh-available') return { ok: false,
      reason: current.status === 'blocked' ? current.reason : 'source-changed' }
    const foundation = await choosePublicV25Entry({ status: 'fresh-available' }, 'create',
      { locks, store: sourceStore, sourceStore: v24Store, v23Store, v17Store }, seed)
    if (!foundation.ok) return { ok: false, reason: foundation.reason }
    return startPublicV26(locks, store, sourceStore, v24Store, v23Store, v17Store,
      seed, foundation.value)
  }
  return { ok: false, reason: 'choice-unavailable' }
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV26EntryView({ entry, busy, onChoose, onRetry, actionError }: {
  entry: PublicV26EntryDecision | { status: 'checking' }; busy: boolean;
  onChoose: (choice: PublicV26EntryChoice) => void; onRetry: () => void;
  actionError: string | null }) {
  return <main data-public-v26-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}>
    <section style={{ maxWidth: 560 }}><h1>Wizard Realms: Physical Valley</h1>
      {entry.status === 'checking' && <p role="status">Checking this device for a V26 world…</p>}
      {entry.status === 'fresh-available' && <><p>Start a new local world. Its checked V25
        foundation will be created first, then copied into V26. This browser save is not backed
        up online.</p><button type="button" style={button} disabled={busy}
        onClick={() => onChoose('create')}>Start new V26 world</button></>}
      {entry.status === 'resume' && <><p role="status">Validated V26 save
        #{entry.start.head.saveRevision} is ready.</p><button type="button" style={button}
        disabled={busy} onClick={() => onChoose('resume')}>Resume V26 world</button></>}
      {entry.status === 'migration-available' && <><p>A validated V25 world can be copied into V26.
        Save now or checkpoint and close the V25 tab before migrating. Only the last committed
        V25 save is copied; your V25 save remains in place.</p><button type="button" style={button}
        disabled={busy} onClick={() => onChoose('migrate')}>Copy V25 world into V26</button></>}
      {entry.status === 'older-world' && <><p role="status">No checked V25 save is ready.
        Open V25 entry to create or migrate the foundation first. No save was reset.</p>
        <a href="?publicWorld=v25">Open V25 entry</a></>}
      {entry.status === 'blocked' && <><p role="alert">V26 access is blocked
        ({entry.reason}). Your saves were not reset.</p><button type="button" style={button}
        disabled={busy} onClick={onRetry}>Reload to recheck</button></>}
      {actionError && <p role="alert">The selected action did not complete
        ({actionError}). No save was cleared. Reload to recheck or retry the available action.</p>}
    </section>
  </main>
}

export function PublicV26EntryApp({ renderSession, seed = 'greenway-alpha' }: {
  renderSession: (start: PublicV26Start, bindings: PublicV26EntryBindings) => ReactNode;
  seed?: string }) {
  const bindings = useRef<PublicV26EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV26EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV26Start | null>(null)
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
        bindings.current ??= { locks, store: createAtomicV26Store(factory),
          sourceStore: createAtomicV25Store(factory), v24Store: createAtomicV24Store(factory),
          v23Store: createAtomicV23Store(factory), v17Store: createAtomicV17Store(factory) }
        const result = await inspectPublicV26Entry(bindings.current)
        if (!cancelled) setEntry(result)
      } catch { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) }
    }
    void inspect()
    return () => { cancelled = true }
  }, [])
  const choose = async (choice: PublicV26EntryChoice) => {
    if (choosing.current || !bindings.current || entry.status === 'checking') return
    choosing.current = true; setBusy(true); setActionError(null)
    try {
      const result = await choosePublicV26Entry(entry, choice, bindings.current, seed)
      if (result.ok) setSession(result.value)
      else { setActionError(result.reason); setEntry(await inspectPublicV26Entry(bindings.current)) }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV26EntryView entry={entry} busy={busy} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} />
}
