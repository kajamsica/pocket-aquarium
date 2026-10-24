import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV41Store } from './domain/atomicV41Database'
import { createAtomicV42Store } from './domain/atomicV42Database'
import { inspectPublicV42, resumePublicV42, startFreshPublicV42,
  startPublicV42 } from './domain/publicWorldV42Flow'
import type { PublicV42Operation, PublicV42Start } from './domain/publicWorldV42Flow'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'

export type PublicV42EntryBindings = Readonly<{
  locks: PublicV7LockProvider
  store: ReturnType<typeof createAtomicV42Store>
  v41Store: ReturnType<typeof createAtomicV41Store>
}>
export type PublicV42EntryDecision = { status: 'resume'; start: PublicV42Start }
  | { status: 'copy-available'; sourceRevision: number }
  | { status: 'fresh-available'; sourceWarning: string | null }
  | { status: 'blocked'; reason: string }
type Choice = 'resume' | 'copy' | 'create'

/** A missing V42 target offers a fresh start and, when checked, an explicit V41 copy. */
export async function inspectPublicV42Entry(bindings: PublicV42EntryBindings | null):
  Promise<PublicV42EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  try {
    const target = await inspectPublicV42(bindings.locks, bindings.store)
    if (!target.ok) return { status: 'blocked', reason: target.reason }
    if (target.value.status === 'valid') return { status: 'resume', start: target.value.start }
    if (target.value.status === 'blocked') return { status: 'blocked', reason: target.value.reason }
    const source = await bindings.v41Store.readChecked()
    return source.status === 'valid'
      ? { status: 'copy-available', sourceRevision: source.root.head.saveRevision }
      : { status: 'fresh-available', sourceWarning: source.status === 'blocked'
        ? source.reason : null }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV42Entry(decision: PublicV42EntryDecision, choice: Choice,
  bindings: PublicV42EntryBindings): Promise<PublicV42Operation<PublicV42Start>> {
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV42(
    bindings.locks, bindings.store, decision.start.head.saveRevision, decision.start.lineage)
  if (choice === 'create') {
    if (decision.status !== 'copy-available' && decision.status !== 'fresh-available')
      return { ok: false, reason: 'choice-unavailable' }
    const current = await inspectPublicV42Entry(bindings)
    if (current.status !== 'copy-available' && current.status !== 'fresh-available') return {
      ok: false, reason: current.status === 'blocked' ? current.reason : 'target-conflict' }
    return startFreshPublicV42(bindings.locks, bindings.store, 'wizard-realms')
  }
  if (decision.status !== 'copy-available' || choice !== 'copy')
    return { ok: false, reason: 'choice-unavailable' }
  const current = await inspectPublicV42Entry(bindings)
  if (current.status !== 'copy-available') return { ok: false,
    reason: current.status === 'blocked' ? current.reason : 'target-conflict' }
  if (current.sourceRevision !== decision.sourceRevision)
    return { ok: false, reason: 'source-revision-changed' }
  return startPublicV42(bindings.locks, bindings.store, bindings.v41Store,
    decision.sourceRevision)
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV42EntryView({ entry, busyChoice, onChoose, onRetry, actionError }: {
  entry: PublicV42EntryDecision | { status: 'checking' }; busyChoice: Choice | null;
  onChoose: (choice: Choice) => void; onRetry: () => void; actionError: string | null }) {
  const busy = busyChoice !== null
  return <main data-public-v42-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}><section style={{ maxWidth: 560 }}>
    <p role="status">Experimental V42 Iron Hall rewards preview, separate save branch</p>
    <h1>Wizard Realms</h1>
    {busyChoice && <p role="status" aria-live="polite">{busyChoice === 'create'
      ? 'Preparing adventure…' : busyChoice === 'copy'
        ? 'Checking and copying adventure…' : 'Continuing adventure…'}</p>}
    {entry.status === 'checking' && <p>Checking this device for a V42 adventure…</p>}
    {entry.status === 'copy-available' && <><p>Copy checked V41 adventure #{entry.sourceRevision}
      into a separate V42 save to try the Iron Hall reward, vest, and practice ward. V41 remains unchanged and playable.
      Return to V41 to roll back. Later progress in either branch will not automatically appear in the other. Close older
      game tabs before copying.</p><button type="button" style={button} disabled={busy}
      onClick={() => onChoose('copy')}>
        {busyChoice === 'copy' ? 'Checking and copying adventure…'
          : 'Copy V41 adventure into V42'}</button><p>Or begin an independent V42 adventure from the start.
      Your V41 save will remain unchanged.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('create')}>
        {busyChoice === 'create' ? 'Preparing adventure…' : 'New Game'}</button></>}
    {entry.status === 'fresh-available' && <>{entry.sourceWarning
      ? <p role="alert">V41 cannot currently be checked ({entry.sourceWarning}), so copying is
        unavailable. Its save remains untouched.</p>
      : <p>No earlier adventure is needed. Begin a new V42 adventure.</p>}
      <p>New Game creates an independent V42 save without changing older adventures.</p>
      <button type="button" style={button} disabled={busy}
        onClick={() => onChoose('create')}>
        {busyChoice === 'create' ? 'Preparing adventure…' : 'New Game'}</button></>}
    {entry.status === 'resume' && <><p>Validated V42 save #{entry.start.head.saveRevision}{' '}
      is ready. This branch does not sync back to V41.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('resume')}>
        {busyChoice === 'resume' ? 'Continuing adventure…' : 'Continue V42 adventure'}</button></>}
    {entry.status === 'blocked' && <><p role="alert">V42 cannot open ({entry.reason}). No save
      was cleared or replaced. Do not restart over this branch.</p><button type="button" style={button}
      disabled={busy} onClick={onRetry}>Reload to recheck</button></>}
    {!busy && !actionError && entry.status === 'blocked'
      && entry.reason === 'invalid-v42-root' && <p>If you moved this adventure to V43,
      <a href="?publicWorld=v43" style={{ color: '#d8edbb' }}> open its checked V43 entry</a>.
      This V42 error alone does not confirm a move; V43 checks its own save before Continue.</p>}
    {actionError && <p role="alert">The action did not complete ({actionError}). Neither
      branch was reset. Reload to recheck before retrying.</p>}
    {!busy && !actionError && entry.status === 'resume' && <p><a href="?publicWorld=v43"
      style={{ color: '#d8edbb' }}>Explore the expanded V43 adventure</a>. V43 will ask before
      moving your checked V42 save. If you choose Move, V42 is fenced and cannot be played
      independently; there is no parallel rollback branch.</p>}
    {!busy && !actionError && entry.status === 'fresh-available' && <p><a href="?publicWorld=v43"
      style={{ color: '#d8edbb' }}>Explore the expanded V43 adventure</a>. Without a V42 save,
      you can start an independent V43 adventure there.</p>}
  <p><a href="?publicWorld=v41" style={{ color: '#d8edbb' }}>Open untouched V41 adventure</a></p>
  </section></main>
}

export function PublicV42EntryApp({ renderSession }: {
  renderSession: (start: PublicV42Start, bindings: PublicV42EntryBindings) => ReactNode }) {
  const bindings = useRef<PublicV42EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV42EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busyChoice, setBusyChoice] = useState<Choice | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV42Start | null>(null)
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
        bindings.current ??= { locks, store: createAtomicV42Store(factory),
          v41Store: createAtomicV41Store(factory) }
        const result = await inspectPublicV42Entry(bindings.current)
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
      const result = await choosePublicV42Entry(entry, choice, bindings.current)
      if (result.ok) setSession(result.value)
      else { setActionError(result.reason); setEntry(await inspectPublicV42Entry(bindings.current)) }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusyChoice(null) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV42EntryView entry={entry} busyChoice={busyChoice} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} />
}
