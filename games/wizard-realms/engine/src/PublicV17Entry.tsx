import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV16Store } from './domain/atomicV16Database'
import { createAtomicV17Store } from './domain/atomicV17Database'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { inspectPublicV16 } from './domain/publicWorldV16Flow'
import type { PublicV16Start } from './domain/publicWorldV16Flow'
import { inspectPublicV17, resumePublicV17, startFreshPublicV17,
  startMigratedPublicV17 } from './domain/publicWorldV17Flow'
import type { PublicV17Operation, PublicV17Start } from './domain/publicWorldV17Flow'

type V16Store = ReturnType<typeof createAtomicV16Store>
type V17Store = ReturnType<typeof createAtomicV17Store>
export type PublicV17EntryBindings = Readonly<{
  locks: PublicV7LockProvider; store: V17Store; sourceStore?: V16Store
}>
type Source = { status: 'valid'; start: PublicV16Start } | { status: 'missing' }
  | { status: 'blocked'; reason: string }
export type PublicV17EntryDecision = { status: 'resume'; start: PublicV17Start }
  | { status: 'missing'; source: Source } | { status: 'blocked'; reason: string }
type DisplayDecision = PublicV17EntryDecision | { status: 'checking' }
export type PublicV17EntryChoice = 'resume' | 'fresh' | 'migrate'

/** Read the older root only when a distinct v17 root is proved missing. */
export async function inspectPublicV17Entry(locks: PublicV7LockProvider | undefined,
  store: V17Store | undefined, sourceStore?: V16Store): Promise<PublicV17EntryDecision> {
  if (!locks) return { status: 'blocked', reason: 'lock-unavailable' }
  if (!store) return { status: 'blocked', reason: 'storage-error' }
  try {
    const target = await inspectPublicV17(locks, store)
    if (!target.ok) return { status: 'blocked', reason: target.reason }
    if (target.value.status === 'blocked') return target.value
    if (target.value.status === 'valid') return { status: 'resume', start: target.value.start }
    if (!sourceStore) return { status: 'missing', source: {
      status: 'blocked', reason: 'source-store-unavailable' } }
    try {
      const source = await inspectPublicV16(locks, sourceStore)
      return { status: 'missing', source: source.ok ? source.value
        : { status: 'blocked', reason: source.reason } }
    } catch { return { status: 'missing', source: { status: 'blocked', reason: 'storage-error' } } }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

/** Each choice re-enters checked authority; migration rechecks v16 under the shared lock. */
export function choosePublicV17Entry(decision: PublicV17EntryDecision,
  choice: PublicV17EntryChoice, bindings: PublicV17EntryBindings, seed: string):
  Promise<PublicV17Operation<PublicV17Start>> {
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV17(
    bindings.locks, bindings.store, decision.start.saveRevision, decision.start.lineage)
  if (decision.status === 'missing' && choice === 'fresh') return startFreshPublicV17(
    bindings.locks, bindings.store, seed)
  if (decision.status === 'missing' && choice === 'migrate'
    && decision.source.status === 'valid' && bindings.sourceStore) return startMigratedPublicV17(
      bindings.locks, bindings.store, bindings.sourceStore, decision.source.start)
  return Promise.resolve({ ok: false, reason: 'choice-unavailable' })
}

const buttonStyle = { minHeight: 44, padding: '8px 14px', font: 'inherit',
  cursor: 'pointer' } as const

export function PublicV17EntryView({ entry, busy, onChoose, onRetry,
  seed = 'greenway-alpha', actionError }: {
  entry: DisplayDecision; busy: boolean; onChoose: (choice: PublicV17EntryChoice) => void
  onRetry: () => void; seed?: string; actionError?: string | null
}) {
  return <main data-public-v17-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}>
    <section style={{ maxWidth: 560 }}><h1>Wizard Realms Greenway free placement</h1>
      <p>This v17 world has its own save. Your v16 and older worlds remain untouched.</p>
      {entry.status === 'checking' && <p role="status">Checking this device for a v17 world…</p>}
      {entry.status === 'resume' && <><p role="status">A validated v17 world is ready at save
        #{entry.start.saveRevision}. Resume requires your choice.</p>
        <button type="button" style={buttonStyle} disabled={busy}
          onClick={() => onChoose('resume')}>Resume v17 world</button></>}
      {entry.status === 'missing' && <><p role="status">No v17 world is saved on this device.
        Creating one with seed {seed} is your choice.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" style={buttonStyle} disabled={busy}
            onClick={() => onChoose('fresh')}>Create fresh v17 world</button>
          {entry.source.status === 'valid' && <button type="button" style={buttonStyle}
            disabled={busy} onClick={() => onChoose('migrate')}>Migrate checked v16 world</button>}
        </div>
        {entry.source.status === 'valid' && <p>Your checked v16 world will be copied only if you
          choose migration. Its original save will remain unchanged.</p>}
        {entry.source.status === 'missing' && <p>No v16 world is available to migrate.</p>}
        {entry.source.status === 'blocked' && <p role="alert">V16 migration is unavailable
          ({entry.source.reason}). You may still create a fresh v17 world. No old save was changed.</p>}
      </>}
      {entry.status === 'blocked' && <><p role="alert">V17 access is blocked ({entry.reason}).
        Nothing was reset or repaired. Keep this site data for a separately verified recovery.</p>
        <button type="button" style={buttonStyle} disabled={busy}
          onClick={onRetry}>Reload to recheck access</button></>}
      {actionError && <p role="alert">The selected action did not complete ({actionError}).
        No save was reset or cleared.</p>}
    </section>
  </main>
}

export function PublicV17EntryApp({ renderSession, seed = 'greenway-alpha' }: {
  renderSession: (start: PublicV17Start, bindings: PublicV17EntryBindings) => ReactNode
  seed?: string
}) {
  const bindings = useRef<PublicV17EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<DisplayDecision>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV17Start | null>(null)
  useEffect(() => {
    let cancelled = false
    const inspect = async () => {
      try {
        const locks = (navigator as Navigator & { locks?: PublicV7LockProvider }).locks
        if (!locks) { if (!cancelled) setEntry({ status: 'blocked', reason: 'lock-unavailable' }); return }
        const factory = window.indexedDB
        if (!factory) { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }); return }
        bindings.current ??= { locks, store: createAtomicV17Store(factory),
          sourceStore: createAtomicV16Store(factory) }
        const result = await inspectPublicV17Entry(locks, bindings.current.store,
          bindings.current.sourceStore)
        if (!cancelled) setEntry(result)
      } catch { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) }
    }
    void inspect()
    return () => { cancelled = true }
  }, [])
  const choose = async (choice: PublicV17EntryChoice) => {
    if (choosing.current || !bindings.current || entry.status === 'checking') return
    choosing.current = true; setBusy(true); setActionError(null)
    try {
      const result = await choosePublicV17Entry(entry, choice, bindings.current, seed)
      if (result.ok) setSession(result.value)
      else {
        setActionError(result.reason)
        setEntry(await inspectPublicV17Entry(bindings.current.locks, bindings.current.store,
          bindings.current.sourceStore))
      }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV17EntryView entry={entry} busy={busy} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} seed={seed} actionError={actionError} />
}
