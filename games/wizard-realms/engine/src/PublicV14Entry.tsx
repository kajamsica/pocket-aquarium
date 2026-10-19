import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV14Store } from './domain/atomicV14Database'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { inspectPublicV14, resumePublicV14, startFreshPublicV14 } from './domain/publicWorldV14Flow'
import type { PublicV14Operation, PublicV14Start } from './domain/publicWorldV14Flow'

type Store = ReturnType<typeof createAtomicV14Store>
export type PublicV14EntryBindings = Readonly<{ locks: PublicV7LockProvider; store: Store }>
export type PublicV14EntryDecision =
  | { status: 'missing' }
  | { status: 'resume'; start: PublicV14Start }
  | { status: 'blocked'; reason: string }
type DisplayDecision = PublicV14EntryDecision | { status: 'checking' }

/** Inspection never creates a world, reads an older root, or repairs a blocked v14 record. */
export async function inspectPublicV14Entry(locks: PublicV7LockProvider | undefined,
  store: Store | undefined): Promise<PublicV14EntryDecision> {
  if (!locks) return { status: 'blocked', reason: 'lock-unavailable' }
  if (!store) return { status: 'blocked', reason: 'storage-error' }
  try {
    const result = await inspectPublicV14(locks, store)
    if (!result.ok) return { status: 'blocked', reason: result.reason }
    if (result.value.status === 'valid') return { status: 'resume', start: result.value.start }
    return result.value
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

/** A stale choice still goes through the flow's lock, lineage, and CAS checks. */
export function choosePublicV14Entry(decision: PublicV14EntryDecision,
  locks: PublicV7LockProvider, store: Store, seed: string): Promise<PublicV14Operation<PublicV14Start>> {
  if (decision.status === 'missing') return startFreshPublicV14(locks, store, seed)
  if (decision.status === 'resume') return resumePublicV14(locks, store,
    decision.start.saveRevision, decision.start.lineage)
  return Promise.resolve({ ok: false, reason: 'choice-unavailable' })
}

const buttonStyle = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const

export function PublicV14EntryView({ entry, busy, onChoose, onRetry, seed = 'greenway-alpha' }: {
  entry: DisplayDecision; busy: boolean; onChoose: () => void; onRetry: () => void; seed?: string
}) {
  return <main data-public-v14-entry="true" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center',
    padding: 24, boxSizing: 'border-box', background: '#10201b', color: '#f4efda', font: '16px/1.5 system-ui' }}>
    <section style={{ maxWidth: 520 }}><h1>Wizard Realms starter-cliff world</h1>
      <p>This separate v14 world uses its own save. Older worlds remain untouched.</p>
      {entry.status === 'checking' && <p role="status">Checking this device for a v14 world…</p>}
      {entry.status === 'missing' && <><p role="status">No v14 world is saved on this device.
        Creating one with seed {seed} is your choice.</p>
        <button type="button" style={buttonStyle} disabled={busy} onClick={onChoose}>Create new v14 world</button></>}
      {entry.status === 'resume' && <><p role="status">A validated v14 world is ready at save
        #{entry.start.saveRevision}. Resume requires your choice.</p>
        <button type="button" style={buttonStyle} disabled={busy} onClick={onChoose}>Resume v14 world</button></>}
      {entry.status === 'blocked' && <><p role="alert">V14 access is blocked ({entry.reason}).
        Nothing was reset or repaired. Keep this site data; a conflicting or corrupt save needs
        an independently verified recovery decision. This entry cannot import or download a rescue.</p>
        <button type="button" style={buttonStyle} onClick={onRetry}>Reload to recheck access</button></>}
    </section>
  </main>
}

/** Deliberately unmounted until the v14 controller and continuous authority are accepted. */
export function PublicV14EntryApp({ renderSession, seed = 'greenway-alpha' }: {
  renderSession: (start: PublicV14Start, bindings: PublicV14EntryBindings) => ReactNode
  seed?: string
}) {
  const bindings = useRef<PublicV14EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<DisplayDecision>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState<PublicV14Start | null>(null)
  useEffect(() => {
    let cancelled = false
    const inspect = async () => {
      try {
        const locks = (navigator as Navigator & { locks?: PublicV7LockProvider }).locks
        if (!locks) { if (!cancelled) setEntry({ status: 'blocked', reason: 'lock-unavailable' }); return }
        const factory = window.indexedDB
        if (!factory) { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }); return }
        bindings.current ??= { locks, store: createAtomicV14Store(factory) }
        const result = await inspectPublicV14Entry(bindings.current.locks, bindings.current.store)
        if (!cancelled) setEntry(result)
      } catch { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) }
    }
    void inspect()
    return () => { cancelled = true }
  }, [])
  const choose = async () => {
    if (choosing.current || !bindings.current || entry.status === 'checking'
      || entry.status === 'blocked') return
    choosing.current = true; setBusy(true)
    try {
      const result = await choosePublicV14Entry(entry, bindings.current.locks,
        bindings.current.store, seed)
      if (result.ok) setSession(result.value)
      else setEntry({ status: 'blocked', reason: result.reason })
    } catch { setEntry({ status: 'blocked', reason: 'storage-error' }) }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV14EntryView entry={entry} busy={busy} onChoose={() => void choose()}
    onRetry={() => window.location.reload()} seed={seed} />
}
