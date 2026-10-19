import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV15Store } from './domain/atomicV15Database'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { inspectPublicV15, resumePublicV15, startFreshPublicV15 } from './domain/publicWorldV15Flow'
import type { PublicV15Operation, PublicV15Start } from './domain/publicWorldV15Flow'

type Store = ReturnType<typeof createAtomicV15Store>
export type PublicV15EntryBindings = Readonly<{ locks: PublicV7LockProvider; store: Store }>
export type PublicV15EntryDecision =
  | { status: 'missing' }
  | { status: 'resume'; start: PublicV15Start }
  | { status: 'blocked'; reason: string }
type DisplayDecision = PublicV15EntryDecision | { status: 'checking' }

/** Inspection never creates a world, reads an older root, or repairs a blocked v15 record. */
export async function inspectPublicV15Entry(locks: PublicV7LockProvider | undefined,
  store: Store | undefined): Promise<PublicV15EntryDecision> {
  if (!locks) return { status: 'blocked', reason: 'lock-unavailable' }
  if (!store) return { status: 'blocked', reason: 'storage-error' }
  try {
    const result = await inspectPublicV15(locks, store)
    if (!result.ok) return { status: 'blocked', reason: result.reason }
    if (result.value.status === 'valid') return { status: 'resume', start: result.value.start }
    return result.value
  } catch { return { status: 'blocked', reason: 'storage-error' } }
}

/** A stale choice still goes through the flow's lock, lineage, and CAS checks. */
export function choosePublicV15Entry(decision: PublicV15EntryDecision,
  locks: PublicV7LockProvider, store: Store, seed: string): Promise<PublicV15Operation<PublicV15Start>> {
  if (decision.status === 'missing') return startFreshPublicV15(locks, store, seed)
  if (decision.status === 'resume') return resumePublicV15(locks, store,
    decision.start.saveRevision, decision.start.lineage)
  return Promise.resolve({ ok: false, reason: 'choice-unavailable' })
}

const buttonStyle = { minHeight: 44, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const

export function PublicV15EntryView({ entry, busy, onChoose, onRetry, seed = 'greenway-alpha' }: {
  entry: DisplayDecision; busy: boolean; onChoose: () => void; onRetry: () => void; seed?: string
}) {
  return <main data-public-v15-entry="true" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}>
    <section style={{ maxWidth: 520 }}><h1>Wizard Realms creek-crossing world</h1>
      <p>This v15 world has its own save. Your v14 and older worlds remain untouched.</p>
      {entry.status === 'checking' && <p role="status">Checking this device for a v15 world…</p>}
      {entry.status === 'missing' && <><p role="status">No v15 world is saved on this device.
        Creating one with seed {seed} is your choice.</p>
        <button type="button" style={buttonStyle} disabled={busy} onClick={onChoose}>Create new v15 world</button></>}
      {entry.status === 'resume' && <><p role="status">A validated v15 world is ready at save
        #{entry.start.saveRevision}. Resume requires your choice.</p>
        <button type="button" style={buttonStyle} disabled={busy} onClick={onChoose}>Resume v15 world</button></>}
      {entry.status === 'blocked' && <><p role="alert">V15 access is blocked ({entry.reason}).
        Nothing was reset or repaired. Keep this site data; a conflicting, experimental, or corrupt save
        needs an independently verified recovery decision.</p>
        <button type="button" style={buttonStyle} onClick={onRetry}>Reload to recheck access</button></>}
    </section>
  </main>
}

/** Only mount after native v15 authority and its UI journey pass review. */
export function PublicV15EntryApp({ renderSession, seed = 'greenway-alpha' }: {
  renderSession: (start: PublicV15Start, bindings: PublicV15EntryBindings) => ReactNode
  seed?: string
}) {
  const bindings = useRef<PublicV15EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<DisplayDecision>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState<PublicV15Start | null>(null)
  useEffect(() => {
    let cancelled = false
    const inspect = async () => {
      try {
        const locks = (navigator as Navigator & { locks?: PublicV7LockProvider }).locks
        if (!locks) { if (!cancelled) setEntry({ status: 'blocked', reason: 'lock-unavailable' }); return }
        const factory = window.indexedDB
        if (!factory) { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }); return }
        bindings.current ??= { locks, store: createAtomicV15Store(factory) }
        const result = await inspectPublicV15Entry(bindings.current.locks, bindings.current.store)
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
      const result = await choosePublicV15Entry(entry, bindings.current.locks,
        bindings.current.store, seed)
      if (result.ok) setSession(result.value)
      else setEntry({ status: 'blocked', reason: result.reason })
    } catch { setEntry({ status: 'blocked', reason: 'storage-error' }) }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session && bindings.current) return <>{renderSession(session, bindings.current)}</>
  return <PublicV15EntryView entry={entry} busy={busy} onChoose={() => void choose()}
    onRetry={() => window.location.reload()} seed={seed} />
}

/** Mounted route until v15-native movement, work, and resource suppression are proven. */
export function PublicV15SafetyGate() {
  return <main data-public-v15-entry="dormant" style={{ minHeight: '100dvh', display: 'grid',
    placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#10201b',
    color: '#f4efda', font: '16px/1.5 system-ui' }}>
    <section style={{ maxWidth: 520 }}><h1>Wizard Realms v15 preview</h1>
      <p role="status">The separate v15 save shell is ready, but this route is not playable yet.
        Starter bridge, dig, and resource-clearance rules are still being connected and tested.</p>
      <p>No save is opened or changed on this page. Your v14 world remains available.</p>
    </section>
  </main>
}
