import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV39Store } from './domain/atomicV39Database'
import { createAtomicV40Store } from './domain/atomicV40Database'
import { inspectPublicV40, resumePublicV40, startFreshPublicV40,
  startPublicV40 } from './domain/publicWorldV40Flow'
import type { PublicV40Operation, PublicV40Start } from './domain/publicWorldV40Flow'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'

export type PublicV40EntryBindings = Readonly<{
  locks: PublicV7LockProvider
  store: ReturnType<typeof createAtomicV40Store>
  v39Store: ReturnType<typeof createAtomicV39Store>
}>
export type PublicV40EntryDecision = { status: 'resume'; start: PublicV40Start }
  | { status: 'copy-available'; sourceRevision: number }
  | { status: 'fresh-available'; sourceWarning: string | null }
  | { status: 'blocked'; reason: string }
type Choice = 'resume' | 'copy' | 'create'

/** A missing V40 target offers a fresh start and, when checked, an explicit V39 copy. */
export async function inspectPublicV40Entry(bindings: PublicV40EntryBindings | null):
  Promise<PublicV40EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  try {
    const target = await inspectPublicV40(bindings.locks, bindings.store)
    if (!target.ok) return { status: 'blocked', reason: target.reason }
    if (target.value.status === 'valid') return { status: 'resume', start: target.value.start }
    if (target.value.status === 'blocked') return { status: 'blocked', reason: target.value.reason }
    const source = await bindings.v39Store.readChecked()
    return source.status === 'valid'
      ? { status: 'copy-available', sourceRevision: source.root.head.saveRevision }
      : { status: 'fresh-available', sourceWarning: source.status === 'blocked'
        ? source.reason : null }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV40Entry(decision: PublicV40EntryDecision, choice: Choice,
  bindings: PublicV40EntryBindings): Promise<PublicV40Operation<PublicV40Start>> {
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV40(
    bindings.locks, bindings.store, decision.start.head.saveRevision, decision.start.lineage)
  if (choice === 'create') {
    if (decision.status !== 'copy-available' && decision.status !== 'fresh-available')
      return { ok: false, reason: 'choice-unavailable' }
    const current = await inspectPublicV40Entry(bindings)
    if (current.status !== 'copy-available' && current.status !== 'fresh-available') return {
      ok: false, reason: current.status === 'blocked' ? current.reason : 'target-conflict' }
    return startFreshPublicV40(bindings.locks, bindings.store, 'wizard-realms')
  }
  if (decision.status !== 'copy-available' || choice !== 'copy')
    return { ok: false, reason: 'choice-unavailable' }
  const current = await inspectPublicV40Entry(bindings)
  if (current.status !== 'copy-available') return { ok: false,
    reason: current.status === 'blocked' ? current.reason : 'target-conflict' }
  if (current.sourceRevision !== decision.sourceRevision)
    return { ok: false, reason: 'source-revision-changed' }
  return startPublicV40(bindings.locks, bindings.store, bindings.v39Store,
    decision.sourceRevision)
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV40EntryView({ entry, busyChoice, onChoose, onRetry, actionError }: {
  entry: PublicV40EntryDecision | { status: 'checking' }; busyChoice: Choice | null;
  onChoose: (choice: Choice) => void; onRetry: () => void; actionError: string | null }) {
  const busy = busyChoice !== null
  return <main data-public-v40-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}><section style={{ maxWidth: 560 }}>
    <p role="status">Experimental V40 preview, separate save branch</p>
    <h1>Wizard Realms</h1>
    {busyChoice && <p role="status" aria-live="polite">{busyChoice === 'create'
      ? 'Preparing adventure…' : busyChoice === 'copy'
        ? 'Checking and copying adventure…' : 'Continuing adventure…'}</p>}
    {entry.status === 'checking' && <p>Checking this device for a V40 adventure…</p>}
    {entry.status === 'copy-available' && <><p>Copy checked V39 adventure #{entry.sourceRevision}
      into a separate V40 save to try Windward Waystation. V39 remains unchanged and playable.
      Return to V39 to roll back. Later progress in either branch will not automatically appear in the other. Close older
      game tabs before copying.</p><button type="button" style={button} disabled={busy}
      onClick={() => onChoose('copy')}>
        {busyChoice === 'copy' ? 'Checking and copying adventure…'
          : 'Copy V39 adventure into V40'}</button><p>Or begin an independent V40 adventure from the start.
      Your V39 save will remain unchanged.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('create')}>
        {busyChoice === 'create' ? 'Preparing adventure…' : 'New Game'}</button></>}
    {entry.status === 'fresh-available' && <>{entry.sourceWarning
      ? <p role="alert">V39 cannot currently be checked ({entry.sourceWarning}), so copying is
        unavailable. Its save remains untouched.</p>
      : <p>No earlier adventure is needed. Begin a new V40 adventure.</p>}
      <p>New Game creates an independent V40 save without changing older adventures.</p>
      <button type="button" style={button} disabled={busy}
        onClick={() => onChoose('create')}>
        {busyChoice === 'create' ? 'Preparing adventure…' : 'New Game'}</button></>}
    {entry.status === 'resume' && <><p>Validated V40 save #{entry.start.head.saveRevision}{' '}
      is ready. This branch does not sync back to V39.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('resume')}>
        {busyChoice === 'resume' ? 'Continuing adventure…' : 'Continue experimental adventure'}</button></>}
    {entry.status === 'blocked' && <><p role="alert">V40 cannot open ({entry.reason}). No save
      was cleared or replaced. Do not restart over this branch.</p><button type="button" style={button}
      disabled={busy} onClick={onRetry}>Reload to recheck</button></>}
    {actionError && <p role="alert">The action did not complete ({actionError}). Neither
      branch was reset. Reload to recheck before retrying.</p>}
  <p><a href="?publicWorld=v39" style={{ color: '#d8edbb' }}>Open untouched V39 adventure</a></p>
  </section></main>
}

export function PublicV40EntryApp({ renderSession }: {
  renderSession: (start: PublicV40Start, bindings: PublicV40EntryBindings) => ReactNode }) {
  const bindings = useRef<PublicV40EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV40EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busyChoice, setBusyChoice] = useState<Choice | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV40Start | null>(null)
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
        bindings.current ??= { locks, store: createAtomicV40Store(factory),
          v39Store: createAtomicV39Store(factory) }
        const result = await inspectPublicV40Entry(bindings.current)
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
      const result = await choosePublicV40Entry(entry, choice, bindings.current)
      if (result.ok) setSession(result.value)
      else { setActionError(result.reason); setEntry(await inspectPublicV40Entry(bindings.current)) }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusyChoice(null) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV40EntryView entry={entry} busyChoice={busyChoice} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} />
}
