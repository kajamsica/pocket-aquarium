import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { createAtomicV24Store } from './domain/atomicV24Database'
import { createAtomicV25Store } from './domain/atomicV25Database'
import { createAtomicV26Store } from './domain/atomicV26Database'
import { createAtomicV27Store } from './domain/atomicV27Database'
import { createAtomicV28Store } from './domain/atomicV28Database'
import { createAtomicV29Store } from './domain/atomicV29Database'
import { createAtomicV30Store } from './domain/atomicV30Database'
import { createAtomicV31Store } from './domain/atomicV31Database'
import { createAtomicV32Store } from './domain/atomicV32Database'
import { createAtomicV33Store } from './domain/atomicV33Database'
import { createAtomicV34Store } from './domain/atomicV34Database'
import { inspectPublicV34, resumePublicV34, startPublicV34 } from './domain/publicWorldV34Flow'
import type { PublicV34Operation, PublicV34Start } from './domain/publicWorldV34Flow'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'

export type PublicV34EntryBindings = Readonly<{ locks: PublicV7LockProvider;
  store: ReturnType<typeof createAtomicV34Store>;
  v33Store: ReturnType<typeof createAtomicV33Store>;
  v32Store: ReturnType<typeof createAtomicV32Store>;
  v31Store: ReturnType<typeof createAtomicV31Store>;
  v30Store: ReturnType<typeof createAtomicV30Store>;
  v29Store: ReturnType<typeof createAtomicV29Store>;
  v28Store: ReturnType<typeof createAtomicV28Store>;
  v27Store: ReturnType<typeof createAtomicV27Store>;
  v26Store: ReturnType<typeof createAtomicV26Store>;
  v25Store: ReturnType<typeof createAtomicV25Store>;
  v24Store: ReturnType<typeof createAtomicV24Store>;
  v23Store: ReturnType<typeof createAtomicV23Store>;
  v17Store: ReturnType<typeof createAtomicV17Store> }>
export type PublicV34EntryDecision = { status: 'resume'; start: PublicV34Start }
  | { status: 'copy-available' } | { status: 'blocked'; reason: string }
type Choice = 'resume' | 'copy'

/** A missing V34 target offers a deliberate V33 copy, never an implicit new game. */
export async function inspectPublicV34Entry(bindings: PublicV34EntryBindings | null):
  Promise<PublicV34EntryDecision> {
  if (!bindings) return { status: 'blocked', reason: 'storage-error' }
  try {
    const result = await inspectPublicV34(bindings.locks, bindings.store)
    if (!result.ok) return { status: 'blocked', reason: result.reason }
    return result.value.status === 'valid' ? { status: 'resume', start: result.value.start }
      : result.value.status === 'migration-available' ? { status: 'copy-available' }
        : { status: 'blocked', reason: result.value.reason }
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

export async function choosePublicV34Entry(decision: PublicV34EntryDecision, choice: Choice,
  bindings: PublicV34EntryBindings): Promise<PublicV34Operation<PublicV34Start>> {
  const { locks, store, v33Store, v32Store, v31Store, v30Store, v29Store,
    v28Store, v27Store, v26Store, v25Store, v24Store, v23Store, v17Store } = bindings
  if (decision.status === 'resume' && choice === 'resume') return resumePublicV34(
    locks, store, decision.start.head.saveRevision, decision.start.lineage)
  if (decision.status !== 'copy-available' || choice !== 'copy')
    return { ok: false, reason: 'choice-unavailable' }
  const current = await inspectPublicV34Entry(bindings)
  if (current.status !== 'copy-available') return { ok: false,
    reason: current.status === 'blocked' ? current.reason : 'target-conflict' }
  return startPublicV34(locks, store, v33Store, v32Store, v31Store, v30Store,
    v29Store, v28Store, v27Store, v26Store, v25Store, v24Store, v23Store, v17Store)
}

const button = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const
export function PublicV34EntryView({ entry, busy, onChoose, onRetry, actionError }: {
  entry: PublicV34EntryDecision | { status: 'checking' }; busy: boolean;
  onChoose: (choice: Choice) => void; onRetry: () => void; actionError: string | null }) {
  return <main data-public-v34-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}><section style={{ maxWidth: 560 }}>
    <p role="status">Experimental V34 preview, separate save branch</p>
    <h1>Wizard Realms</h1>
    {entry.status === 'checking' && <p>Checking this device for a V34 adventure…</p>}
    {entry.status === 'copy-available' && <><p>Copy your last checked V33 adventure into a
      separate V34 save. This can take a while. V33 remains unchanged and playable, but later
      progress in either branch will not automatically appear in the other. Close older game
      tabs before copying.</p><p>No V33 adventure here? Open <a href="?publicWorld=v33">V33</a>
      to prepare one first. This preview does not yet create a new adventure.</p>
      <button type="button" style={button} disabled={busy} onClick={() => onChoose('copy')}>
        {busy ? 'Checking and copying adventure…' : 'Copy V33 adventure into V34'}</button></>}
    {entry.status === 'resume' && <><p>Validated V34 save #{entry.start.head.saveRevision}
      is ready. This branch does not sync back to V33.</p><button type="button" style={button}
      disabled={busy} onClick={() => onChoose('resume')}>Continue experimental adventure</button></>}
    {entry.status === 'blocked' && <><p role="alert">V34 cannot open ({entry.reason}). No save
      was cleared or replaced. Do not restart over this branch.</p><button type="button"
      style={button} disabled={busy} onClick={onRetry}>Reload to recheck</button></>}
    {actionError && <p role="alert">The action did not complete ({actionError}). Neither
      branch was reset. Reload to recheck before retrying.</p>}
  </section></main>
}

export function PublicV34EntryApp({ renderSession }: {
  renderSession: (start: PublicV34Start, bindings: PublicV34EntryBindings) => ReactNode }) {
  const bindings = useRef<PublicV34EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV34EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicV34Start | null>(null)
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
        bindings.current ??= { locks, store: createAtomicV34Store(factory),
          v33Store: createAtomicV33Store(factory), v32Store: createAtomicV32Store(factory),
          v31Store: createAtomicV31Store(factory), v30Store: createAtomicV30Store(factory),
          v29Store: createAtomicV29Store(factory), v28Store: createAtomicV28Store(factory),
          v27Store: createAtomicV27Store(factory), v26Store: createAtomicV26Store(factory),
          v25Store: createAtomicV25Store(factory), v24Store: createAtomicV24Store(factory),
          v23Store: createAtomicV23Store(factory), v17Store: createAtomicV17Store(factory) }
        const result = await inspectPublicV34Entry(bindings.current)
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
      const result = await choosePublicV34Entry(entry, choice, bindings.current)
      if (result.ok) setSession(result.value)
      else { setActionError(result.reason); setEntry(await inspectPublicV34Entry(bindings.current)) }
    } catch { setActionError('storage-error') }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV34EntryView entry={entry} busy={busy} onChoose={(choice) => void choose(choice)}
    onRetry={() => window.location.reload()} actionError={actionError} />
}
