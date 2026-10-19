import { useEffect, useRef, useState } from 'react'
import { PublicWizardApp, type PublicV9PlayableSession } from './PublicWizardApp'
import { createAtomicV8Store } from './domain/atomicV8Database'
import { createAtomicV9Store } from './domain/atomicV9Database'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { commitPublicV9Snapshot, inspectPublicV9, migratePublicV8ToV9, resumePublicV9,
  type PublicV9Start } from './domain/publicWorldV9Flow'
import { decodePublicV9Head, isValidPublicV9SourceReceipt, serializePublicV9Rescue,
  type PublicV9SourceReceipt } from './domain/publicWorldV9Snapshot'

type Bindings = { storage: Storage; locks: PublicV7LockProvider;
  v8: ReturnType<typeof createAtomicV8Store>; v9: ReturnType<typeof createAtomicV9Store> }
export type PublicV9EntryDecision =
  | { status: 'resume'; start: PublicV9Start }
  | { status: 'upgrade'; sourceReceipt: PublicV9SourceReceipt }
  | { status: 'needs-v8' }
  | { status: 'blocked'; reason: string }

export async function inspectPublicV9Entry(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: Bindings['v8'], v9: Bindings['v9']): Promise<PublicV9EntryDecision> {
  const result = await inspectPublicV9(storage, locks, v8, v9)
  if (!result.ok) return { status: 'blocked', reason: result.reason }
  const entry = result.value
  if (entry.status === 'valid') return { status: 'resume', start: entry.start }
  if (entry.status === 'blocked') return entry
  return entry.sourceReceipt ? { status: 'upgrade', sourceReceipt: entry.sourceReceipt } : { status: 'needs-v8' }
}

type StoredV9Rescue = { source: 'head' | 'previous'; saveRevision: number; bytes: string }
/** A read-only rescue remains useful when the live source has diverged or disappeared. */
export async function readPublicV9Rescues(v9: Pick<Bindings['v9'], 'read'>): Promise<StoredV9Rescue[]> {
  try {
    const records = await v9.read()
    if (records.status !== 'ok' || !isValidPublicV9SourceReceipt(records.lineage)) return []
    const sourceReceipt = records.lineage
    return (['head', 'previous'] as const).flatMap((source) => {
      const record = records[source]
      if (!record || typeof record !== 'object' || Array.isArray(record)
        || Reflect.ownKeys(record).length !== 2 || !Object.hasOwn(record, 'value')
        || !Object.hasOwn(record, 'saveRevision')) return []
      const snapshot = decodePublicV9Head(record.value)
      if (!snapshot || snapshot.saveRevision !== record.saveRevision) return []
      try {
        return [{ source, saveRevision: snapshot.saveRevision, bytes: serializePublicV9Rescue(
          snapshot.state, snapshot.bootstrap, snapshot.saveRevision, sourceReceipt) }]
      } catch { return [] }
    })
  } catch { return [] }
}

export function PublicV9EntryApp() {
  const bindings = useRef<Bindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV9EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState<PublicV9PlayableSession | null>(null)
  const [rescues, setRescues] = useState<StoredV9Rescue[] | null>(null)
  const [downloadNotice, setDownloadNotice] = useState('')
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const locks = (navigator as Navigator & { locks?: PublicV7LockProvider }).locks
      if (!locks) { setEntry({ status: 'blocked', reason: 'lock-unavailable' }); return }
      const storage = window.localStorage
      const factory = window.indexedDB
      if (!storage || !factory) { setEntry({ status: 'blocked', reason: 'storage-error' }); return }
      const current = bindings.current ??= { storage, locks,
        v8: createAtomicV8Store(factory), v9: createAtomicV9Store(factory) }
      const result = await inspectPublicV9Entry(current.storage, current.locks, current.v8, current.v9)
      if (!cancelled) setEntry(result)
    }
    void check().catch(() => { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (entry.status !== 'blocked') return
    let cancelled = false
    const read = async () => {
      try { return await readPublicV9Rescues(bindings.current?.v9 ?? createAtomicV9Store(window.indexedDB)) }
      catch { return [] }
    }
    void read().then((result) => { if (!cancelled) setRescues(result) })
    return () => { cancelled = true }
  }, [entry.status])
  const download = (rescue: StoredV9Rescue) => {
    let url: string | null = null
    let link: HTMLAnchorElement | null = null
    try {
      url = URL.createObjectURL(new Blob([rescue.bytes], { type: 'application/json' }))
      link = document.createElement('a')
      link.href = url; link.download = `wizard-realms-v9-${rescue.source}-${rescue.saveRevision}-rescue.json`
      document.body.append(link); link.click()
      setDownloadNotice(`Downloaded the locally validated ${rescue.source} save #${rescue.saveRevision}. Keep this site data.`)
    } catch { setDownloadNotice('Download failed. Keep this site data and recheck before continuing.') }
    finally {
      link?.remove()
      const cleanupUrl = url
      if (cleanupUrl) window.setTimeout(() => URL.revokeObjectURL(cleanupUrl), 60_000)
    }
  }
  const choose = async () => {
    if (!bindings.current || choosing.current || (entry.status !== 'resume' && entry.status !== 'upgrade')) return
    choosing.current = true; setBusy(true)
    const { storage, locks, v8, v9 } = bindings.current
    try {
      const result = entry.status === 'resume'
        ? await resumePublicV9(storage, locks, v8, v9, entry.start.saveRevision, entry.start.sourceReceipt)
        : await migratePublicV8ToV9(storage, locks, v8, v9, entry.sourceReceipt)
      if (!result.ok) { setEntry({ status: 'blocked', reason: result.reason }); return }
      setSession({ start: result.value, commit: (state, revision, receipt) =>
        commitPublicV9Snapshot(storage, locks, v8, v9, state, revision, receipt) })
    } catch { setEntry({ status: 'blocked', reason: 'storage-error' }) }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session) return <PublicWizardApp v9Session={session} />
  return <main className="wr-v9-entry" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24,
    boxSizing: 'border-box', background: '#10201b', color: '#f4efda', font: '16px/1.5 system-ui' }}>
    <style>{'.wr-v9-entry button{min-height:44px;padding:8px 14px;font:inherit;cursor:pointer}.wr-v9-entry a{color:#f5d889}'}</style>
    <section style={{ maxWidth: 520 }}><h1>Wizard Realms v9 field camp preview</h1>
      <p>This experimental world adds one player-chosen field camp in Mireglass.</p>
      {entry.status === 'checking' && <p role="status">Checking this device for a v9 save…</p>}
      {entry.status === 'upgrade' && <><p role="status">Your validated v8 world is ready. Upgrade creates a separate v9 save and preserves the v8 and v7 sources.</p>
        <button disabled={busy} onClick={() => void choose()}>Upgrade v8 world to v9</button></>}
      {entry.status === 'resume' && <><p role="status">A valid v9 world is ready. Resume it explicitly.</p>
        <button disabled={busy} onClick={() => void choose()}>Resume v9 world</button></>}
      {entry.status === 'needs-v8' && <p>No playable v8 world is ready. <a href="?publicWorld=v8">Open the v8 entry</a> first.</p>}
      {entry.status === 'blocked' && <><p role="alert">V9 save access is blocked ({entry.reason}). No save was restored, replaced, or reset.
        Keep this site data. Recovery requires a verified save choice; this preview cannot repair divergent or corrupt saves.</p>
        {rescues === null ? <p role="status">Checking stored v9 records for validated recovery downloads…</p>
          : rescues.length ? <><p>These downloads contain a locally validated v9 snapshot and its source receipt, not proof of authenticity.
            Downloading does not resolve a fork or change any save. This preview cannot import these files. Keep the files and this site data.</p>
            {rescues.map((rescue) => <button key={rescue.source} onClick={() => download(rescue)}>
              Download validated {rescue.source} save #{rescue.saveRevision}
            </button>)}</> : <p>No validated export is available. Keep this site data; no raw or unvalidated save will be downloaded.</p>}
        {downloadNotice && <p role="status">{downloadNotice}</p>}
        <button onClick={() => window.location.reload()}>Reload to recheck storage</button></>}
    </section>
  </main>
}
