import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV43Store } from './domain/atomicV43Database'
import { createAtomicV44Store } from './domain/atomicV44Database'
import { inspectPublicV44, resumePublicV44, startPublicV44 } from './domain/publicWorldV44Flow'
import type { PublicV44Operation, PublicV44Start } from './domain/publicWorldV44Flow'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'

export type PublicV44EntryBindings = Readonly<{
  locks: PublicV7LockProvider
  store: ReturnType<typeof createAtomicV44Store>
  v43Store: ReturnType<typeof createAtomicV43Store>
}>
export type PublicV44EntryDecision = { status: 'resume'; start: PublicV44Start }
  | { status: 'migration-available'; sourceRevision: number }
  | { status: 'blocked'; reason: string }
type Choice = 'resume' | 'migrate'

export async function inspectPublicV44Entry(bindings: PublicV44EntryBindings | null):
  Promise<PublicV44EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  if (!bindings.locks || typeof bindings.locks.request !== 'function')
    return { status: 'blocked', reason: 'lock-unavailable' }
  try {
    const checked = await inspectPublicV44(bindings.locks, bindings.store, bindings.v43Store)
    if (!checked.ok) return { status: 'blocked', reason: checked.reason }
    return checked.value.status === 'valid'
      ? { status: 'resume', start: checked.value.start } : checked.value
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV44Entry(decision: PublicV44EntryDecision,
  choice: Choice, bindings: PublicV44EntryBindings):
  Promise<PublicV44Operation<PublicV44Start>> {
  const current = await inspectPublicV44Entry(bindings)
  if (current.status === 'blocked') return { ok: false, reason: current.reason }
  if (decision.status === 'resume' && choice === 'resume'
    && current.status === 'resume')
    return resumePublicV44(bindings.locks, bindings.store, bindings.v43Store,
      decision.start.head.saveRevision, decision.start.lineage)
  if (decision.status === 'migration-available' && choice === 'migrate'
    && current.status === 'migration-available') {
    if (current.sourceRevision !== decision.sourceRevision)
      return { ok: false, reason: 'source-revision-changed' }
    return startPublicV44(bindings.locks, bindings.store, bindings.v43Store,
      decision.sourceRevision)
  }
  return { ok: false, reason: 'branch-changed' }
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV44EntryView({ entry, busyChoice, onChoose, onRetry, actionError }: {
  entry: PublicV44EntryDecision | { status: 'checking' }; busyChoice: Choice | null;
  onChoose: (choice: Choice) => void; onRetry: () => void; actionError: string | null }) {
  const busy = busyChoice !== null
  return <main data-public-v44-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}><section style={{ maxWidth: 560 }}>
    <p role="status">Experimental V44 mount preview</p>
    <h1>Wizard Realms</h1>
    {busyChoice && <p role="status" aria-live="polite">{busyChoice === 'migrate'
      ? 'Checking and moving adventure…' : 'Continuing adventure…'}</p>}
    {entry.status === 'checking' && <p>Checking this device for a V44 adventure…</p>}
    {entry.status === 'migration-available' && <><p>A checked V43 adventure at save
      #{entry.sourceRevision} is ready to move into V44. Its save bytes are preserved, but
      V43 will be fenced afterward, with no parallel rollback branch. Close older game tabs
      before moving.</p><button type="button" style={button} disabled={busy}
      onClick={() => onChoose('migrate')}>Move V43 adventure into V44</button></>}
    {entry.status === 'resume' && <><p>Checked V44 save #{entry.start.head.saveRevision}
      is ready. The V43 source is fenced after the handoff.</p><button type="button"
      style={button} disabled={busy} onClick={() => onChoose('resume')}>
        Continue V44 adventure</button></>}
    {entry.status === 'blocked' && <><p role="alert">V44 cannot open ({entry.reason}).
      No save was cleared or replaced. A checked V43 adventure is required before V44 can
      begin.</p><button type="button" style={button} disabled={busy} onClick={onRetry}>
        Reload to recheck</button></>}
    {actionError && <p role="alert">The action did not complete ({actionError}). No save
      was reset. Reload to recheck before retrying.</p>}
  </section></main>
}

export function PublicV44EntryApp({ renderSession }: {
  renderSession: (start: PublicV44Start, bindings: PublicV44EntryBindings) => ReactNode }) {
  const bindings = useRef<PublicV44EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV44EntryDecision | { status: 'checking' }>(
    { status: 'checking' })
  const [busyChoice, setBusyChoice] = useState<Choice | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV44Start | null>(null)
  useEffect(() => {
    let cancelled = false
    const inspect = async () => {
      try {
        const locks = (navigator as Navigator & { locks?: PublicV7LockProvider }).locks
        const factory = window.indexedDB
        if (!locks || typeof locks.request !== 'function' || !factory) {
          if (!cancelled) setEntry({ status: 'blocked', reason: !locks
            || typeof locks.request !== 'function' ? 'lock-unavailable' : 'storage-error' })
          return
        }
        bindings.current ??= { locks, store: createAtomicV44Store(factory),
          v43Store: createAtomicV43Store(factory) }
        const result = await inspectPublicV44Entry(bindings.current)
        if (!cancelled) setEntry(result)
      } catch { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) }
    }
    void inspect()
    return () => { cancelled = true }
  }, [])
  const choose = async (choice: Choice) => {
    if (choosing.current || !bindings.current || entry.status === 'checking') return
    choosing.current = true; setBusyChoice(choice); setActionError(null)
    try {
      const result = await choosePublicV44Entry(entry, choice, bindings.current)
      if (result.ok) setSession(result.value)
      else { setActionError(result.reason); setEntry(await inspectPublicV44Entry(bindings.current)) }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusyChoice(null) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV44EntryView entry={entry} busyChoice={busyChoice}
    onChoose={(choice) => void choose(choice)} onRetry={() => window.location.reload()}
    actionError={actionError} />
}
