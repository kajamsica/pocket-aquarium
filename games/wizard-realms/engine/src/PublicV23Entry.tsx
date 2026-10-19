import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { inspectPublicV23, resumePublicV23, startPublicV23 } from './domain/publicWorldV23Flow'
import type { PublicV23Inspection, PublicV23Operation, PublicV23Start } from './domain/publicWorldV23Flow'

export type PublicV23EntryBindings = Readonly<{ locks: PublicV7LockProvider;
  store: ReturnType<typeof createAtomicV23Store>;
  sourceStore: ReturnType<typeof createAtomicV17Store> }>
export type PublicV23EntryDecision = { status: 'resume'; start: PublicV23Start }
  | { status: 'fresh-available' }
  | Extract<PublicV23Inspection, { status: 'migration-available' | 'blocked' }>
export type PublicV23EntryChoice = 'resume' | 'fresh' | 'migrate'

/** Only the V23 inspector decides whether a V17 source may be copied. */
export async function inspectPublicV23Entry(bindings: PublicV23EntryBindings | null):
  Promise<PublicV23EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  const result = await inspectPublicV23(bindings.locks, bindings.store, bindings.sourceStore)
  if (!result.ok) return { status: 'blocked', reason: result.reason }
  return result.value.status === 'valid'
    ? { status: 'resume', start: result.value.start } : result.value
}

export function choosePublicV23Entry(decision: PublicV23EntryDecision,
  choice: PublicV23EntryChoice, bindings: PublicV23EntryBindings, seed: string):
  Promise<PublicV23Operation<PublicV23Start>> {
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV23(
    bindings.locks, bindings.store, bindings.sourceStore,
    decision.start.head.saveRevision, decision.start.lineage)
  if (decision.status === 'fresh-available' && choice === 'fresh') return startPublicV23(
    bindings.locks, bindings.store, bindings.sourceStore, seed, null)
  if (decision.status === 'migration-available' && choice === 'migrate') return startPublicV23(
    bindings.locks, bindings.store, bindings.sourceStore, seed, decision.sourceReceipt)
  return Promise.resolve({ ok: false, reason: 'choice-unavailable' })
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit',
  cursor: 'pointer' } as const
export function PublicV23EntryView({ entry, busy, onChoose, onRetry, actionError,
  seed = 'greenway-alpha' }: { entry: PublicV23EntryDecision | { status: 'checking' };
  busy: boolean; onChoose: (choice: PublicV23EntryChoice) => void;
  onRetry: () => void; actionError: string | null; seed?: string }) {
  return <main data-public-v23-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}>
    <section style={{ maxWidth: 560 }}><h1>Wizard Realms regional ladders</h1>
      {entry.status === 'checking' && <p role="status">Checking this device for a V23 world…</p>}
      {entry.status === 'resume' && <><p role="status">Validated V23 save
        #{entry.start.head.saveRevision} is ready.</p><button type="button" style={button}
        disabled={busy} onClick={() => onChoose('resume')}>Resume V23 world</button></>}
      {entry.status === 'fresh-available' && <><p>No V23 or V17 world is saved here.
        Create a fresh {seed} world.</p><button type="button" style={button} disabled={busy}
        onClick={() => onChoose('fresh')}>Create V23 world</button></>}
      {entry.status === 'migration-available' && <><p>A validated V17 world can be
        copied into V23. The V17 save remains in place.</p><button type="button" style={button}
        disabled={busy} onClick={() => onChoose('migrate')}>Migrate V17 world</button></>}
      {entry.status === 'blocked' && <><p role="alert">V23 access is blocked
        ({entry.reason}). Your saves were not reset.</p><button type="button" style={button}
        disabled={busy} onClick={onRetry}>Reload to recheck</button></>}
      {actionError && <p role="alert">The selected action did not complete
        ({actionError}). No save was cleared.</p>}
    </section>
  </main>
}

export function PublicV23EntryApp({ renderSession, seed = 'greenway-alpha' }: {
  renderSession: (start: PublicV23Start, bindings: PublicV23EntryBindings) => ReactNode;
  seed?: string }) {
  const bindings = useRef<PublicV23EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV23EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV23Start | null>(null)
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
        bindings.current ??= { locks, store: createAtomicV23Store(factory),
          sourceStore: createAtomicV17Store(factory) }
        const result = await inspectPublicV23Entry(bindings.current)
        if (!cancelled) setEntry(result)
      } catch { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) }
    }
    void inspect()
    return () => { cancelled = true }
  }, [])
  const choose = async (choice: PublicV23EntryChoice) => {
    if (choosing.current || !bindings.current || entry.status === 'checking') return
    choosing.current = true; setBusy(true); setActionError(null)
    try {
      const result = await choosePublicV23Entry(entry, choice, bindings.current, seed)
      if (result.ok) setSession(result.value)
      else {
        setActionError(result.reason)
        setEntry(await inspectPublicV23Entry(bindings.current))
      }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV23EntryView entry={entry} busy={busy} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} seed={seed} />
}
