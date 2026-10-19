import { useEffect, useRef, useState } from 'react'
import { PublicWizardApp, type PublicV8PlayableSession } from './PublicWizardApp'
import { createAtomicV8Store } from './domain/atomicV8Database'
import { inspectPublicV7Entry, type PublicV7LockProvider } from './domain/publicWorldV7Flow'
import {
  commitPublicV8Snapshot, inspectPublicV8, migratePublicV7ToV8, resumePublicV8,
  type PublicV8Start,
} from './domain/publicWorldV8Flow'

type V8Store = ReturnType<typeof createAtomicV8Store>
type Bindings = { storage: Storage; locks: PublicV7LockProvider; db: V8Store }
export type PublicV8EntryDecision =
  | { status: 'resume'; start: PublicV8Start }
  | { status: 'upgrade'; sourceBytes: string }
  | { status: 'needs-v7'; reason: string | null }
  | { status: 'blocked'; reason: string }

/** The v7 entry is consulted only when the compact v8 store is genuinely empty. */
export async function inspectPublicV8Entry(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, db: V8Store): Promise<PublicV8EntryDecision> {
  const v8 = await inspectPublicV8(storage, locks, db)
  if (!v8.ok) return { status: 'blocked', reason: v8.reason }
  if (v8.value.status === 'valid') return { status: 'resume', start: v8.value.start }
  if (v8.value.status === 'blocked') return { status: 'blocked', reason: v8.value.reason }
  const v7 = await inspectPublicV7Entry(storage, locks)
  if (!v7.ok) return { status: 'blocked', reason: v7.reason }
  if (v7.value.blockedReason === null && v7.value.root.status === 'valid-playable') {
    return { status: 'upgrade', sourceBytes: v7.value.root.bytes }
  }
  if (v7.value.blockedReason === 'storage-error') return { status: 'blocked', reason: 'storage-error' }
  return { status: 'needs-v7', reason: v7.value.blockedReason }
}

function browserBindings(): Bindings | { reason: string } {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return { reason: 'Browser storage is unavailable.' }
  let storage: Storage
  let factory: IDBFactory
  let locks: PublicV7LockProvider | undefined
  try { storage = window.localStorage } catch { return { reason: 'Local storage is unavailable.' } }
  try { factory = window.indexedDB } catch { return { reason: 'IndexedDB is unavailable.' } }
  try { locks = (navigator as Navigator & { locks?: PublicV7LockProvider }).locks }
  catch { return { reason: 'Web Locks are unavailable.' } }
  if (!storage) return { reason: 'Local storage is unavailable.' }
  if (!factory) return { reason: 'IndexedDB is unavailable.' }
  if (!locks) return { reason: 'Web Locks are unavailable.' }
  return { storage, locks, db: createAtomicV8Store(factory) }
}

const STYLES = `.wr-v8-entry{min-height:100vh;display:grid;place-items:center;padding:24px;background:#10201b;color:#f4efda;font:16px/1.5 system-ui,sans-serif}.wr-v8-card{max-width:520px;padding:28px;border:1px solid #806e4a;border-radius:12px;background:#1c2c25;box-shadow:0 18px 50px #0005}.wr-v8-card h1{margin:0 0 8px;color:#f5d889}.wr-v8-card button{padding:10px 16px;margin:8px 0;border:1px solid #c3a864;border-radius:7px;background:#c3a864;color:#18241d;font:inherit;cursor:pointer}.wr-v8-card button:disabled{opacity:.5;cursor:wait}.wr-v8-card a{color:#f5d889}.wr-v8-warning{color:#ffd6a2}`

export function PublicV8EntryApp() {
  const bindings = useRef<Bindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV8EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState<PublicV8PlayableSession | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!bindings.current) {
      const available = browserBindings()
      if ('reason' in available) { setEntry({ status: 'blocked', reason: available.reason }); return }
      bindings.current = available
    }
    const { storage, locks, db } = bindings.current
    void inspectPublicV8Entry(storage, locks, db).then((result) => {
      if (!cancelled) setEntry(result)
    }).catch(() => { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) })
    return () => { cancelled = true }
  }, [])

  const choose = async () => {
    const current = bindings.current
    if (!current || choosing.current || (entry.status !== 'resume' && entry.status !== 'upgrade')) return
    choosing.current = true
    setBusy(true)
    try {
      const { storage, locks, db } = current
      const result = entry.status === 'resume'
        ? await resumePublicV8(storage, locks, db, entry.start.saveRevision)
        : await migratePublicV7ToV8(storage, locks, db, entry.sourceBytes)
      if (!result.ok) { setEntry({ status: 'blocked', reason: result.reason }); return }
      setSession({ start: result.value,
        commit: (state, expectedRevision) => commitPublicV8Snapshot(storage, locks, db, state, expectedRevision) })
    } catch { setEntry({ status: 'blocked', reason: 'storage-error' }) }
    finally { choosing.current = false; setBusy(false) }
  }

  if (session) return <PublicWizardApp v8Session={session} />
  return <main className="wr-v8-entry"><style>{STYLES}</style><section className="wr-v8-card">
    <h1>Wizard Realms v8 preview</h1>
    <p>This experimental compact save keeps the existing v7 world separate.</p>
    {entry.status === 'checking' && <p role="status">Checking this device for a compact save…</p>}
    {entry.status === 'resume' && <><p role="status">A compact v8 save is ready. Resume it explicitly.</p>
      <button disabled={busy} onClick={() => void choose()}>Resume v8 world</button></>}
    {entry.status === 'upgrade' && <><p role="status">A clean v7 world is ready. Upgrade creates a separate v8 save and preserves the v7 source.</p>
      <button disabled={busy} onClick={() => void choose()}>Upgrade v7 world to v8</button></>}
    {entry.status === 'needs-v7' && <><p role="status">{entry.reason
      ? `The v7 save needs attention (${entry.reason}). Use the v7 entry first.`
      : 'No playable v7 world is ready. Start or resume one through the v7 entry first.'}</p>
      <a href="?publicWorld=1">Open the v7 entry</a></>}
    {entry.status === 'blocked' && <><p role="alert" className="wr-v8-warning">Compact save access is blocked ({entry.reason}).
      No save was restored or replaced automatically. Keep this site data and recheck before continuing.</p>
      <button onClick={() => window.location.reload()}>Reload to recheck storage</button></>}
  </section></main>
}
