import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV35Store } from './domain/atomicV35Database'
import { createAtomicV36Store } from './domain/atomicV36Database'
import { inspectPublicV36, resumePublicV36, startFreshPublicV36,
  startPublicV36 } from './domain/publicWorldV36Flow'
import type { PublicV36Operation, PublicV36Start } from './domain/publicWorldV36Flow'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'

export type PublicV36EntryBindings = Readonly<{
  locks: PublicV7LockProvider
  store: ReturnType<typeof createAtomicV36Store>
  v35Store: ReturnType<typeof createAtomicV35Store>
}>
export type PublicV36EntryDecision = { status: 'resume'; start: PublicV36Start }
  | { status: 'copy-available'; sourceRevision: number }
  | { status: 'fresh-available'; sourceWarning: string | null }
  | { status: 'blocked'; reason: string }
type Choice = 'resume' | 'copy' | 'create'

/** A missing V36 target offers a fresh start and, when checked, an explicit V35 copy. */
export async function inspectPublicV36Entry(bindings: PublicV36EntryBindings | null):
  Promise<PublicV36EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  try {
    const target = await inspectPublicV36(bindings.locks, bindings.store)
    if (!target.ok) return { status: 'blocked', reason: target.reason }
    if (target.value.status === 'valid') return { status: 'resume', start: target.value.start }
    if (target.value.status === 'blocked') return { status: 'blocked', reason: target.value.reason }
    const source = await bindings.v35Store.readChecked()
    return source.status === 'valid'
      ? { status: 'copy-available', sourceRevision: source.root.head.saveRevision }
      : { status: 'fresh-available', sourceWarning: source.status === 'blocked'
        ? source.reason : null }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV36Entry(decision: PublicV36EntryDecision, choice: Choice,
  bindings: PublicV36EntryBindings): Promise<PublicV36Operation<PublicV36Start>> {
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV36(
    bindings.locks, bindings.store, decision.start.head.saveRevision, decision.start.lineage)
  if (choice === 'create') {
    if (decision.status !== 'copy-available' && decision.status !== 'fresh-available')
      return { ok: false, reason: 'choice-unavailable' }
    const current = await inspectPublicV36Entry(bindings)
    if (current.status !== 'copy-available' && current.status !== 'fresh-available') return {
      ok: false, reason: current.status === 'blocked' ? current.reason : 'target-conflict' }
    return startFreshPublicV36(bindings.locks, bindings.store, 'wizard-realms')
  }
  if (decision.status !== 'copy-available' || choice !== 'copy')
    return { ok: false, reason: 'choice-unavailable' }
  const current = await inspectPublicV36Entry(bindings)
  if (current.status !== 'copy-available') return { ok: false,
    reason: current.status === 'blocked' ? current.reason : 'target-conflict' }
  if (current.sourceRevision !== decision.sourceRevision)
    return { ok: false, reason: 'source-revision-changed' }
  return startPublicV36(bindings.locks, bindings.store, bindings.v35Store,
    decision.sourceRevision)
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV36EntryView({ entry, busyChoice, onChoose, onRetry, actionError }: {
  entry: PublicV36EntryDecision | { status: 'checking' }; busyChoice: Choice | null;
  onChoose: (choice: Choice) => void; onRetry: () => void; actionError: string | null }) {
  const busy = busyChoice !== null
  return <main data-public-v36-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}><section style={{ maxWidth: 560 }}>
    <p role="status">Experimental V36 preview, separate save branch</p>
    <h1>Wizard Realms</h1>
    {busyChoice && <p role="status" aria-live="polite">{busyChoice === 'create'
      ? 'Preparing adventure…' : busyChoice === 'copy'
        ? 'Checking and copying adventure…' : 'Continuing adventure…'}</p>}
    {entry.status === 'checking' && <p>Checking this device for a V36 adventure…</p>}
    {entry.status === 'copy-available' && <><p>Copy checked V35 adventure #{entry.sourceRevision}
      into a separate V36 save to try Beneath the Old Marker. V35 remains unchanged and playable.
      Later progress in either branch will not automatically appear in the other. Close older
      game tabs before copying.</p><button type="button" style={button} disabled={busy}
      onClick={() => onChoose('copy')}>
        {busyChoice === 'copy' ? 'Checking and copying adventure…'
          : 'Copy V35 adventure into V36'}</button><p>Or begin an independent V36 adventure from the start.
      Your V35 save will remain unchanged.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('create')}>
        {busyChoice === 'create' ? 'Preparing adventure…' : 'New Game'}</button></>}
    {entry.status === 'fresh-available' && <>{entry.sourceWarning
      ? <p role="alert">V35 cannot currently be checked ({entry.sourceWarning}), so copying is
        unavailable. Its save remains untouched.</p>
      : <p>No earlier adventure is needed. Begin a new V36 adventure.</p>}
      <p>New Game creates an independent V36 save without changing older adventures.</p>
      <button type="button" style={button} disabled={busy}
        onClick={() => onChoose('create')}>
        {busyChoice === 'create' ? 'Preparing adventure…' : 'New Game'}</button></>}
    {entry.status === 'resume' && <><p>Validated V36 save #{entry.start.head.saveRevision}{' '}
      is ready. This branch does not sync back to V35.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('resume')}>
        {busyChoice === 'resume' ? 'Continuing adventure…' : 'Continue experimental adventure'}</button></>}
    {entry.status === 'blocked' && <><p role="alert">V36 cannot open ({entry.reason}). No save
      was cleared or replaced. Do not restart over this branch.</p><button type="button" style={button}
      disabled={busy} onClick={onRetry}>Reload to recheck</button></>}
    {actionError && <p role="alert">The action did not complete ({actionError}). Neither
      branch was reset. Reload to recheck before retrying.</p>}
  </section></main>
}

export function PublicV36EntryApp({ renderSession }: {
  renderSession: (start: PublicV36Start, bindings: PublicV36EntryBindings) => ReactNode }) {
  const bindings = useRef<PublicV36EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV36EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busyChoice, setBusyChoice] = useState<Choice | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV36Start | null>(null)
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
        bindings.current ??= { locks, store: createAtomicV36Store(factory),
          v35Store: createAtomicV35Store(factory) }
        const result = await inspectPublicV36Entry(bindings.current)
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
      const result = await choosePublicV36Entry(entry, choice, bindings.current)
      if (result.ok) setSession(result.value)
      else { setActionError(result.reason); setEntry(await inspectPublicV36Entry(bindings.current)) }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusyChoice(null) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV36EntryView entry={entry} busyChoice={busyChoice} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} />
}
