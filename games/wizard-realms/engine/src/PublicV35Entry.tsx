import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV34Store } from './domain/atomicV34Database'
import { createAtomicV35Store } from './domain/atomicV35Database'
import { inspectPublicV35, resumePublicV35, startPublicV35 } from './domain/publicWorldV35Flow'
import type { PublicV35Operation, PublicV35Start } from './domain/publicWorldV35Flow'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'

export type PublicV35EntryBindings = Readonly<{
  locks: PublicV7LockProvider
  store: ReturnType<typeof createAtomicV35Store>
  v34Store: ReturnType<typeof createAtomicV34Store>
}>
export type PublicV35EntryDecision = { status: 'resume'; start: PublicV35Start }
  | { status: 'copy-available'; sourceRevision: number }
  | { status: 'blocked'; reason: string }
type Choice = 'resume' | 'copy'

/** A missing V35 target offers only a deliberate copy of a checked V34 head. */
export async function inspectPublicV35Entry(bindings: PublicV35EntryBindings | null):
  Promise<PublicV35EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  try {
    const target = await inspectPublicV35(bindings.locks, bindings.store)
    if (!target.ok) return { status: 'blocked', reason: target.reason }
    if (target.value.status === 'valid') return { status: 'resume', start: target.value.start }
    if (target.value.status === 'blocked') return { status: 'blocked', reason: target.value.reason }
    const source = await bindings.v34Store.readChecked()
    return source.status === 'valid'
      ? { status: 'copy-available', sourceRevision: source.root.head.saveRevision }
      : { status: 'blocked', reason: source.status === 'blocked' ? source.reason : 'source-missing' }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV35Entry(decision: PublicV35EntryDecision, choice: Choice,
  bindings: PublicV35EntryBindings): Promise<PublicV35Operation<PublicV35Start>> {
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV35(
    bindings.locks, bindings.store, decision.start.head.saveRevision, decision.start.lineage)
  if (decision.status !== 'copy-available' || choice !== 'copy')
    return { ok: false, reason: 'choice-unavailable' }
  const current = await inspectPublicV35Entry(bindings)
  if (current.status !== 'copy-available') return { ok: false,
    reason: current.status === 'blocked' ? current.reason : 'target-conflict' }
  if (current.sourceRevision !== decision.sourceRevision)
    return { ok: false, reason: 'source-revision-changed' }
  return startPublicV35(bindings.locks, bindings.store, bindings.v34Store)
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV35EntryView({ entry, busy, onChoose, onRetry, actionError }: {
  entry: PublicV35EntryDecision | { status: 'checking' }; busy: boolean;
  onChoose: (choice: Choice) => void; onRetry: () => void; actionError: string | null }) {
  return <main data-public-v35-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}><section style={{ maxWidth: 560 }}>
    <p role="status">Experimental V35 preview, separate save branch</p>
    <h1>Wizard Realms</h1>
    {entry.status === 'checking' && <p>Checking this device for a V35 adventure…</p>}
    {entry.status === 'copy-available' && <><p>Copy checked V34 adventure #{entry.sourceRevision}
      into a separate V35 save to try Outfitters&apos; Ledger. V34 remains unchanged and playable.
      Later progress in either branch will not automatically appear in the other. Close older
      game tabs before copying.</p><button type="button" style={button} disabled={busy}
      onClick={() => onChoose('copy')}>
        {busy ? 'Checking and copying adventure…' : 'Copy V34 adventure into V35'}</button></>}
    {entry.status === 'resume' && <><p>Validated V35 save #{entry.start.head.saveRevision}
      is ready. This branch does not sync back to V34.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('resume')}>Continue experimental adventure</button></>}
    {entry.status === 'blocked' && <><p role="alert">V35 cannot open ({entry.reason}). No save
      was cleared or replaced. {entry.reason === 'source-missing'
        ? <>Open <a href="?publicWorld=v34">V34</a> to prepare a checked adventure first.</>
        : 'Do not restart over this branch.'}</p><button type="button" style={button}
      disabled={busy} onClick={onRetry}>Reload to recheck</button></>}
    {actionError && <p role="alert">The action did not complete ({actionError}). Neither
      branch was reset. Reload to recheck before retrying.</p>}
  </section></main>
}

export function PublicV35EntryApp({ renderSession }: {
  renderSession: (start: PublicV35Start, bindings: PublicV35EntryBindings) => ReactNode }) {
  const bindings = useRef<PublicV35EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV35EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV35Start | null>(null)
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
        bindings.current ??= { locks, store: createAtomicV35Store(factory),
          v34Store: createAtomicV34Store(factory) }
        const result = await inspectPublicV35Entry(bindings.current)
        if (!cancelled) setEntry(result)
      } catch { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) }
    }
    void inspect()
    return () => { cancelled = true }
  }, [])
  const choose = async (choice: Choice) => {
    if (choosing.current || !bindings.current || entry.status === 'checking') return
    choosing.current = true; setBusy(true); setActionError(null)
    try {
      const result = await choosePublicV35Entry(entry, choice, bindings.current)
      if (result.ok) setSession(result.value)
      else { setActionError(result.reason); setEntry(await inspectPublicV35Entry(bindings.current)) }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV35EntryView entry={entry} busy={busy} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} />
}
