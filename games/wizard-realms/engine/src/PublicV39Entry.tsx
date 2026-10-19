import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV38Store } from './domain/atomicV38Database'
import { createAtomicV39Store } from './domain/atomicV39Database'
import { inspectPublicV39, resumePublicV39, startFreshPublicV39,
  startPublicV39 } from './domain/publicWorldV39Flow'
import type { PublicV39Operation, PublicV39Start } from './domain/publicWorldV39Flow'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'

export type PublicV39EntryBindings = Readonly<{
  locks: PublicV7LockProvider
  store: ReturnType<typeof createAtomicV39Store>
  v38Store: ReturnType<typeof createAtomicV38Store>
}>
export type PublicV39EntryDecision = { status: 'resume'; start: PublicV39Start }
  | { status: 'copy-available'; sourceRevision: number }
  | { status: 'fresh-available'; sourceWarning: string | null }
  | { status: 'blocked'; reason: string }
type Choice = 'resume' | 'copy' | 'create'

/** A missing V39 target offers a fresh start and, when checked, an explicit V38 copy. */
export async function inspectPublicV39Entry(bindings: PublicV39EntryBindings | null):
  Promise<PublicV39EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  try {
    const target = await inspectPublicV39(bindings.locks, bindings.store)
    if (!target.ok) return { status: 'blocked', reason: target.reason }
    if (target.value.status === 'valid') return { status: 'resume', start: target.value.start }
    if (target.value.status === 'blocked') return { status: 'blocked', reason: target.value.reason }
    const source = await bindings.v38Store.readChecked()
    return source.status === 'valid'
      ? { status: 'copy-available', sourceRevision: source.root.head.saveRevision }
      : { status: 'fresh-available', sourceWarning: source.status === 'blocked'
        ? source.reason : null }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV39Entry(decision: PublicV39EntryDecision, choice: Choice,
  bindings: PublicV39EntryBindings): Promise<PublicV39Operation<PublicV39Start>> {
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV39(
    bindings.locks, bindings.store, decision.start.head.saveRevision, decision.start.lineage)
  if (choice === 'create') {
    if (decision.status !== 'copy-available' && decision.status !== 'fresh-available')
      return { ok: false, reason: 'choice-unavailable' }
    const current = await inspectPublicV39Entry(bindings)
    if (current.status !== 'copy-available' && current.status !== 'fresh-available') return {
      ok: false, reason: current.status === 'blocked' ? current.reason : 'target-conflict' }
    return startFreshPublicV39(bindings.locks, bindings.store, 'wizard-realms')
  }
  if (decision.status !== 'copy-available' || choice !== 'copy')
    return { ok: false, reason: 'choice-unavailable' }
  const current = await inspectPublicV39Entry(bindings)
  if (current.status !== 'copy-available') return { ok: false,
    reason: current.status === 'blocked' ? current.reason : 'target-conflict' }
  if (current.sourceRevision !== decision.sourceRevision)
    return { ok: false, reason: 'source-revision-changed' }
  return startPublicV39(bindings.locks, bindings.store, bindings.v38Store,
    decision.sourceRevision)
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV39EntryView({ entry, busyChoice, onChoose, onRetry, actionError }: {
  entry: PublicV39EntryDecision | { status: 'checking' }; busyChoice: Choice | null;
  onChoose: (choice: Choice) => void; onRetry: () => void; actionError: string | null }) {
  const busy = busyChoice !== null
  return <main data-public-v39-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}><section style={{ maxWidth: 560 }}>
    <p role="status">Experimental V39 preview, separate save branch</p>
    <h1>Wizard Realms</h1>
    {busyChoice && <p role="status" aria-live="polite">{busyChoice === 'create'
      ? 'Preparing adventure…' : busyChoice === 'copy'
        ? 'Checking and copying adventure…' : 'Continuing adventure…'}</p>}
    {entry.status === 'checking' && <p>Checking this device for a V39 adventure…</p>}
    {entry.status === 'copy-available' && <><p>Copy checked V38 adventure #{entry.sourceRevision}
      into a separate V39 save to try Ringkeeper's Trail. V38 remains unchanged and playable.
      Return to V38 to roll back. Later progress in either branch will not automatically appear in the other. Close older
      game tabs before copying.</p><button type="button" style={button} disabled={busy}
      onClick={() => onChoose('copy')}>
        {busyChoice === 'copy' ? 'Checking and copying adventure…'
          : 'Copy V38 adventure into V39'}</button><p>Or begin an independent V39 adventure from the start.
      Your V38 save will remain unchanged.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('create')}>
        {busyChoice === 'create' ? 'Preparing adventure…' : 'New Game'}</button></>}
    {entry.status === 'fresh-available' && <>{entry.sourceWarning
      ? <p role="alert">V38 cannot currently be checked ({entry.sourceWarning}), so copying is
        unavailable. Its save remains untouched.</p>
      : <p>No earlier adventure is needed. Begin a new V39 adventure.</p>}
      <p>New Game creates an independent V39 save without changing older adventures.</p>
      <button type="button" style={button} disabled={busy}
        onClick={() => onChoose('create')}>
        {busyChoice === 'create' ? 'Preparing adventure…' : 'New Game'}</button></>}
    {entry.status === 'resume' && <><p>Validated V39 save #{entry.start.head.saveRevision}{' '}
      is ready. This branch does not sync back to V38.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('resume')}>
        {busyChoice === 'resume' ? 'Continuing adventure…' : 'Continue experimental adventure'}</button></>}
    {entry.status === 'blocked' && <><p role="alert">V39 cannot open ({entry.reason}). No save
      was cleared or replaced. Do not restart over this branch.</p><button type="button" style={button}
      disabled={busy} onClick={onRetry}>Reload to recheck</button></>}
    {actionError && <p role="alert">The action did not complete ({actionError}). Neither
      branch was reset. Reload to recheck before retrying.</p>}
  <p><a href="?publicWorld=v38" style={{ color: '#d8edbb' }}>Open untouched V38 adventure</a></p>
  </section></main>
}

export function PublicV39EntryApp({ renderSession }: {
  renderSession: (start: PublicV39Start, bindings: PublicV39EntryBindings) => ReactNode }) {
  const bindings = useRef<PublicV39EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV39EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busyChoice, setBusyChoice] = useState<Choice | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV39Start | null>(null)
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
        bindings.current ??= { locks, store: createAtomicV39Store(factory),
          v38Store: createAtomicV38Store(factory) }
        const result = await inspectPublicV39Entry(bindings.current)
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
      const result = await choosePublicV39Entry(entry, choice, bindings.current)
      if (result.ok) setSession(result.value)
      else { setActionError(result.reason); setEntry(await inspectPublicV39Entry(bindings.current)) }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusyChoice(null) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV39EntryView entry={entry} busyChoice={busyChoice} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} />
}
