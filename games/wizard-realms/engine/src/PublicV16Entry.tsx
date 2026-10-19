import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV15Store } from './domain/atomicV15Database'
import { createAtomicV16Store } from './domain/atomicV16Database'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { inspectPublicV15 } from './domain/publicWorldV15Flow'
import type { PublicV15Start } from './domain/publicWorldV15Flow'
import { inspectPublicV16, resumePublicV16, startFreshPublicV16,
  startMigratedPublicV16 } from './domain/publicWorldV16Flow'
import type { PublicV16Operation, PublicV16Start } from './domain/publicWorldV16Flow'

type V15Store = ReturnType<typeof createAtomicV15Store>
type V16Store = ReturnType<typeof createAtomicV16Store>
export type PublicV16EntryBindings = Readonly<{
  locks: PublicV7LockProvider; store: V16Store; sourceStore?: V15Store
}>
type Source = { status: 'valid'; start: PublicV15Start } | { status: 'missing' }
  | { status: 'blocked'; reason: string }
export type PublicV16EntryDecision = { status: 'resume'; start: PublicV16Start }
  | { status: 'missing'; source: Source } | { status: 'blocked'; reason: string }
type DisplayDecision = PublicV16EntryDecision | { status: 'checking' }
export type PublicV16EntryChoice = 'resume' | 'fresh' | 'migrate'

/** The v15 source is inspected only after the distinct v16 root is proved missing. */
export async function inspectPublicV16Entry(locks: PublicV7LockProvider | undefined,
  store: V16Store | undefined, sourceStore?: V15Store): Promise<PublicV16EntryDecision> {
  if (!locks) return { status: 'blocked', reason: 'lock-unavailable' }
  if (!store) return { status: 'blocked', reason: 'storage-error' }
  try {
    const target = await inspectPublicV16(locks, store)
    if (!target.ok) return { status: 'blocked', reason: target.reason }
    if (target.value.status === 'blocked') return target.value
    if (target.value.status === 'valid') return { status: 'resume', start: target.value.start }
    if (!sourceStore) return { status: 'missing', source: {
      status: 'blocked', reason: 'source-store-unavailable' } }
    try {
      const source = await inspectPublicV15(locks, sourceStore)
      return { status: 'missing', source: source.ok ? source.value
        : { status: 'blocked', reason: source.reason } }
    } catch { return { status: 'missing', source: { status: 'blocked', reason: 'storage-error' } } }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

/** Each choice re-enters checked authority; migration rechecks the source under the shared lock. */
export function choosePublicV16Entry(decision: PublicV16EntryDecision,
  choice: PublicV16EntryChoice, bindings: PublicV16EntryBindings, seed: string):
  Promise<PublicV16Operation<PublicV16Start>> {
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV16(
    bindings.locks, bindings.store, decision.start.saveRevision, decision.start.lineage)
  if (decision.status === 'missing' && choice === 'fresh') return startFreshPublicV16(
    bindings.locks, bindings.store, seed)
  if (decision.status === 'missing' && choice === 'migrate'
    && decision.source.status === 'valid' && bindings.sourceStore) return startMigratedPublicV16(
      bindings.locks, bindings.store, bindings.sourceStore, decision.source.start)
  return Promise.resolve({ ok: false, reason: 'choice-unavailable' })
}

const buttonStyle = { minHeight: 44, padding: '8px 14px', font: 'inherit',
  cursor: 'pointer' } as const

export function PublicV16EntryView({ entry, busy, onChoose, onRetry,
  seed = 'greenway-alpha', actionError }: {
  entry: DisplayDecision; busy: boolean; onChoose: (choice: PublicV16EntryChoice) => void
  onRetry: () => void; seed?: string; actionError?: string | null
}) {
  return <main data-public-v16-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}>
    <section style={{ maxWidth: 560 }}><h1>Wizard Realms Greenway world</h1>
      <p>This v16 world has its own save. Your v15 and older worlds remain untouched.</p>
      {entry.status === 'checking' && <p role="status">Checking this device for a v16 world…</p>}
      {entry.status === 'resume' && <><p role="status">A validated v16 world is ready at save
        #{entry.start.saveRevision}. Resume requires your choice.</p>
        <button type="button" style={buttonStyle} disabled={busy}
          onClick={() => onChoose('resume')}>Resume v16 world</button></>}
      {entry.status === 'missing' && <><p role="status">No v16 world is saved on this device.
        Creating one with seed {seed} is your choice.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" style={buttonStyle} disabled={busy}
            onClick={() => onChoose('fresh')}>Create fresh v16 world</button>
          {entry.source.status === 'valid' && <button type="button" style={buttonStyle}
            disabled={busy} onClick={() => onChoose('migrate')}>Migrate checked v15 world</button>}
        </div>
        {entry.source.status === 'valid' && <p>Your checked v15 world will be copied only if you
          choose migration. Its original save will remain unchanged.</p>}
        {entry.source.status === 'missing' && <p>No v15 world is available to migrate.</p>}
        {entry.source.status === 'blocked' && <p role="alert">V15 migration is unavailable
          ({entry.source.reason}). You may still create a fresh v16 world. No old save was changed.</p>}
      </>}
      {entry.status === 'blocked' && <><p role="alert">V16 access is blocked ({entry.reason}).
        Nothing was reset or repaired. Keep this site data for a separately verified recovery.</p>
        <button type="button" style={buttonStyle} disabled={busy}
          onClick={onRetry}>Reload to recheck access</button></>}
      {actionError && <p role="alert">The selected action did not complete ({actionError}).
        No save was reset or cleared.</p>}
    </section>
  </main>
}

export function PublicV16EntryApp({ renderSession, seed = 'greenway-alpha' }: {
  renderSession: (start: PublicV16Start, bindings: PublicV16EntryBindings) => ReactNode
  seed?: string
}) {
  const bindings = useRef<PublicV16EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<DisplayDecision>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV16Start | null>(null)
  useEffect(() => {
    let cancelled = false
    const inspect = async () => {
      try {
        const locks = (navigator as Navigator & { locks?: PublicV7LockProvider }).locks
        if (!locks) { if (!cancelled) setEntry({ status: 'blocked', reason: 'lock-unavailable' }); return }
        const factory = window.indexedDB
        if (!factory) { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }); return }
        bindings.current ??= { locks, store: createAtomicV16Store(factory),
          sourceStore: createAtomicV15Store(factory) }
        const result = await inspectPublicV16Entry(locks, bindings.current.store,
          bindings.current.sourceStore)
        if (!cancelled) setEntry(result)
      } catch { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) }
    }
    void inspect()
    return () => { cancelled = true }
  }, [])
  const choose = async (choice: PublicV16EntryChoice) => {
    if (choosing.current || !bindings.current || entry.status === 'checking') return
    choosing.current = true; setBusy(true); setActionError(null)
    try {
      const result = await choosePublicV16Entry(entry, choice, bindings.current, seed)
      if (result.ok) setSession(result.value)
      else {
        setActionError(result.reason)
        setEntry(await inspectPublicV16Entry(bindings.current.locks, bindings.current.store,
          bindings.current.sourceStore))
      }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV16EntryView entry={entry} busy={busy} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} seed={seed} actionError={actionError} />
}
