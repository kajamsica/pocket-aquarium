import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV42Store } from './domain/atomicV42Database'
import { createAtomicV43Store } from './domain/atomicV43Database'
import { inspectPublicV43, resumePublicV43, startFreshPublicV43,
  startPublicV43 } from './domain/publicWorldV43Flow'
import type { PublicV43Operation, PublicV43Start } from './domain/publicWorldV43Flow'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'

export type PublicV43EntryBindings = Readonly<{
  locks: PublicV7LockProvider
  store: ReturnType<typeof createAtomicV43Store>
  v42Store: ReturnType<typeof createAtomicV42Store>
}>
export type PublicV43EntryDecision = { status: 'resume'; start: PublicV43Start }
  | { status: 'migrate-available'; sourceRevision: number }
  | { status: 'recover-available'; sourceRevision: number; fresh: boolean }
  | { status: 'fresh-available' }
  | { status: 'blocked'; reason: string }
type Choice = 'resume' | 'migrate' | 'recover' | 'create'

/** Inspect under the V43 lock before offering any branch choice. */
export async function inspectPublicV43Entry(bindings: PublicV43EntryBindings | null):
  Promise<PublicV43EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  if (!bindings.locks || typeof bindings.locks.request !== 'function')
    return { status: 'blocked', reason: 'lock-unavailable' }
  try {
    const checked = await inspectPublicV43(bindings.locks, bindings.store, bindings.v42Store)
    if (!checked.ok) return { status: 'blocked', reason: checked.reason }
    if (checked.value.status === 'valid')
      return { status: 'resume', start: checked.value.start }
    if (checked.value.status === 'blocked') {
      if (checked.value.reason !== 'source-missing')
        return { status: 'blocked', reason: checked.value.reason }
      const source = await bindings.v42Store.readForPromotion()
      if (source.status !== 'missing') return { status: 'blocked',
        reason: source.status === 'blocked' ? source.reason : 'branch-changed' }
      const target = await bindings.store.readChecked()
      return target.status === 'missing' ? { status: 'fresh-available' }
        : { status: 'blocked', reason: target.status === 'blocked'
          ? target.reason : 'source-missing' }
    }
    const source = await bindings.v42Store.readForPromotion()
    if (source.status !== 'valid') return { status: 'blocked',
      reason: source.status === 'blocked' ? source.reason : 'branch-changed' }
    if (source.marker === null) return { status: 'migrate-available',
      sourceRevision: source.root.head.saveRevision }
    return source.marker.phase === 'pending'
      ? { status: 'recover-available', sourceRevision: source.root.head.saveRevision,
        fresh: source.root.lineage.origin === 'fresh'
          && source.root.head.saveRevision === 0 }
      : { status: 'blocked', reason: 'target-conflict' }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV43Entry(decision: PublicV43EntryDecision,
  choice: Choice, bindings: PublicV43EntryBindings):
  Promise<PublicV43Operation<PublicV43Start>> {
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV43(
    bindings.locks, bindings.store, bindings.v42Store,
    decision.start.head.saveRevision, decision.start.lineage)
  if (decision.status === 'fresh-available' && choice === 'create') {
    const current = await inspectPublicV43Entry(bindings)
    if (current.status !== 'fresh-available') return { ok: false,
      reason: current.status === 'blocked' ? current.reason : 'branch-changed' }
    return startFreshPublicV43(bindings.locks, bindings.store, bindings.v42Store,
      'wizard-realms')
  }
  if (decision.status === 'recover-available' && choice === 'recover') {
    const current = await inspectPublicV43Entry(bindings)
    if (current.status !== 'recover-available') return { ok: false,
      reason: current.status === 'blocked' ? current.reason : 'branch-changed' }
    if (current.sourceRevision !== decision.sourceRevision || current.fresh !== decision.fresh)
      return { ok: false, reason: 'source-changed' }
    return decision.fresh
      ? startFreshPublicV43(bindings.locks, bindings.store, bindings.v42Store,
        'wizard-realms')
      : startPublicV43(bindings.locks, bindings.store, bindings.v42Store,
        decision.sourceRevision)
  }
  if (decision.status !== 'migrate-available' || choice !== 'migrate')
    return { ok: false, reason: 'choice-unavailable' }
  const current = await inspectPublicV43Entry(bindings)
  if (current.status !== 'migrate-available') return { ok: false,
    reason: current.status === 'blocked' ? current.reason : 'branch-changed' }
  if (current.sourceRevision !== decision.sourceRevision)
    return { ok: false, reason: 'source-revision-changed' }
  return startPublicV43(bindings.locks, bindings.store, bindings.v42Store,
    decision.sourceRevision)
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV43EntryView({ entry, busyChoice, onChoose, onRetry, actionError }: {
  entry: PublicV43EntryDecision | { status: 'checking' }; busyChoice: Choice | null;
  onChoose: (choice: Choice) => void; onRetry: () => void; actionError: string | null }) {
  const busy = busyChoice !== null
  return <main data-public-v43-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}><section style={{ maxWidth: 560 }}>
    <p role="status">Experimental V43 preview</p>
    <h1>Wizard Realms</h1>
    {busyChoice && <p role="status" aria-live="polite">{busyChoice === 'create'
      ? 'Preparing adventure…' : busyChoice === 'migrate'
        ? 'Checking and moving adventure…' : 'Continuing adventure…'}</p>}
    {entry.status === 'checking' && <p>Checking this device for a V43 adventure…</p>}
    {entry.status === 'migrate-available' && <><p>A checked V42 adventure at save
      #{entry.sourceRevision} is ready to move into V43. This handoff keeps the V42 save bytes,
      but fences that save: V42 will not be independently playable afterward. There is no
      parallel rollback branch. Close older game tabs before moving.</p>
      <button type="button" style={button} disabled={busy} onClick={() => onChoose('migrate')}>
        {busyChoice === 'migrate' ? 'Checking and moving adventure…'
          : 'Move V42 adventure into V43'}</button></>}
    {entry.status === 'recover-available' && <><p role="status">A V43 handoff was interrupted.
      Continue it from the checked V42 save #{entry.sourceRevision}. The V42 save bytes remain,
      but that save is fenced and cannot be played independently. There is no parallel rollback
      branch.</p><button type="button" style={button} disabled={busy}
      onClick={() => onChoose('recover')}>
        {busyChoice === 'recover' ? 'Continuing handoff…' : 'Continue V43 handoff'}</button></>}
    {entry.status === 'fresh-available' && <><p>No V42 or V43 adventure was found on this device.
      Start a new V43 adventure.</p><button type="button" style={button} disabled={busy}
      onClick={() => onChoose('create')}>
        {busyChoice === 'create' ? 'Preparing adventure…' : 'New Game'}</button></>}
    {entry.status === 'resume' && <><p>Checked V43 save #{entry.start.head.saveRevision} is ready.
      The V42 source is fenced after the handoff.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('resume')}>
        {busyChoice === 'resume' ? 'Continuing adventure…' : 'Continue V43 adventure'}</button></>}
    {entry.status === 'blocked' && <><p role="alert">V43 cannot open ({entry.reason}). No save
      was cleared or replaced. Do not restart over this branch.</p><button type="button"
      style={button} disabled={busy} onClick={onRetry}>Reload to recheck</button></>}
    {actionError && <p role="alert">The action did not complete ({actionError}). No save
      was reset. Reload to recheck before retrying.</p>}
  </section></main>
}

export function PublicV43EntryApp({ renderSession }: {
  renderSession: (start: PublicV43Start, bindings: PublicV43EntryBindings) => ReactNode }) {
  const bindings = useRef<PublicV43EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV43EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busyChoice, setBusyChoice] = useState<Choice | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV43Start | null>(null)
  useEffect(() => {
    let cancelled = false
    const inspect = async () => {
      try {
        const locks = (navigator as Navigator & { locks?: PublicV7LockProvider }).locks
        const factory = window.indexedDB
        if (!locks || typeof locks.request !== 'function' || !factory) {
          if (!cancelled) setEntry({ status: 'blocked', reason: !locks
            || typeof locks.request !== 'function'
            ? 'lock-unavailable' : 'storage-error' })
          return
        }
        bindings.current ??= { locks, store: createAtomicV43Store(factory),
          v42Store: createAtomicV42Store(factory) }
        const result = await inspectPublicV43Entry(bindings.current)
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
      const result = await choosePublicV43Entry(entry, choice, bindings.current)
      if (result.ok) setSession(result.value)
      else { setActionError(result.reason); setEntry(await inspectPublicV43Entry(bindings.current)) }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusyChoice(null) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV43EntryView entry={entry} busyChoice={busyChoice} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} />
}
