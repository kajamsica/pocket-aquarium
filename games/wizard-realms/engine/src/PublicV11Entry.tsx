import { useEffect, useRef, useState } from 'react'
import { PublicWizardApp, type PublicV11PlayableSession } from './PublicWizardApp'
import { createAtomicV8Store } from './domain/atomicV8Database'
import { createAtomicV9Store } from './domain/atomicV9Database'
import { createAtomicV10Store } from './domain/atomicV10Database'
import { createAtomicV11Store } from './domain/atomicV11Database'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { commitPublicV11Snapshot, inspectPublicV11, migratePublicV10ToV11, resumePublicV11,
  type PublicV11Start } from './domain/publicWorldV11Flow'
import { decodePublicV11Head, isValidPublicV11SourceReceipt, serializePublicV11Rescue,
  type PublicV11SourceReceipt } from './domain/publicWorldV11Snapshot'

type Bindings = { storage: Storage; locks: PublicV7LockProvider;
  v8: ReturnType<typeof createAtomicV8Store>; v9: ReturnType<typeof createAtomicV9Store>;
  v10: ReturnType<typeof createAtomicV10Store>; v11: ReturnType<typeof createAtomicV11Store> }
export type PublicV11EntryDecision =
  | { status: 'resume'; start: PublicV11Start }
  | { status: 'upgrade'; sourceReceipt: PublicV11SourceReceipt }
  | { status: 'needs-v10' }
  | { status: 'blocked'; reason: string }

export async function inspectPublicV11Entry(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: Bindings['v8'], v9: Bindings['v9'],
  v10: Bindings['v10'], v11: Bindings['v11']): Promise<PublicV11EntryDecision> {
  const result = await inspectPublicV11(storage, locks, v8, v9, v10, v11)
  if (!result.ok) return { status: 'blocked', reason: result.reason }
  const entry = result.value
  if (entry.status === 'valid') return { status: 'resume', start: entry.start }
  if (entry.status === 'blocked') return entry
  return entry.sourceReceipt ? { status: 'upgrade', sourceReceipt: entry.sourceReceipt } : { status: 'needs-v10' }
}

type StoredV11Rescue = { source: 'head' | 'previous'; saveRevision: number; bytes: string }
/** A read-only rescue remains useful even when the live source is blocked. */
export async function readPublicV11Rescues(v11: Pick<Bindings['v11'], 'read'>): Promise<StoredV11Rescue[]> {
  try {
    const records = await v11.read()
    if (records.status !== 'ok' || !isValidPublicV11SourceReceipt(records.lineage)) return []
    const sourceReceipt = records.lineage
    return (['head', 'previous'] as const).flatMap((source) => {
      const record = records[source]
      if (!record || typeof record !== 'object' || Array.isArray(record)
        || Reflect.ownKeys(record).length !== 2 || !Object.hasOwn(record, 'value')
        || !Object.hasOwn(record, 'saveRevision')) return []
      const snapshot = decodePublicV11Head(record.value)
      if (!snapshot || snapshot.saveRevision !== record.saveRevision) return []
      try {
        return [{ source, saveRevision: snapshot.saveRevision, bytes: serializePublicV11Rescue(
          snapshot.state, snapshot.bootstrap, snapshot.saveRevision, sourceReceipt) }]
      } catch { return [] }
    })
  } catch { return [] }
}

export function PublicV11EntryApp() {
  const bindings = useRef<Bindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV11EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState<PublicV11PlayableSession | null>(null)
  const [rescues, setRescues] = useState<StoredV11Rescue[] | null>(null)
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
        v8: createAtomicV8Store(factory), v9: createAtomicV9Store(factory),
        v10: createAtomicV10Store(factory), v11: createAtomicV11Store(factory) }
      const result = await inspectPublicV11Entry(current.storage, current.locks,
        current.v8, current.v9, current.v10, current.v11)
      if (!cancelled) setEntry(result)
    }
    void check().catch(() => { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (entry.status !== 'blocked') return
    let cancelled = false
    const store = bindings.current?.v11 ?? (window.indexedDB ? createAtomicV11Store(window.indexedDB) : null)
    if (!store) { setRescues([]); return }
    void readPublicV11Rescues(store).then((result) => { if (!cancelled) setRescues(result) })
    return () => { cancelled = true }
  }, [entry.status])
  const download = (rescue: StoredV11Rescue) => {
    let url: string | null = null
    let link: HTMLAnchorElement | null = null
    try {
      url = URL.createObjectURL(new Blob([rescue.bytes], { type: 'application/json' }))
      link = document.createElement('a')
      link.href = url; link.download = `wizard-realms-v11-${rescue.source}-${rescue.saveRevision}-rescue.json`
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
    const { storage, locks, v8, v9, v10, v11 } = bindings.current
    try {
      const result = entry.status === 'resume'
        ? await resumePublicV11(storage, locks, v8, v9, v10, v11, entry.start.saveRevision, entry.start.sourceReceipt)
        : await migratePublicV10ToV11(storage, locks, v8, v9, v10, v11, entry.sourceReceipt)
      if (!result.ok) { setEntry({ status: 'blocked', reason: result.reason }); return }
      setSession({ start: result.value, commit: (state, revision, receipt) =>
        commitPublicV11Snapshot(storage, locks, v8, v9, v10, v11, state, revision, receipt) })
    } catch { setEntry({ status: 'blocked', reason: 'storage-error' }) }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session) return <PublicWizardApp v11Session={session} />
  return <main className="wr-v11-entry" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24,
    boxSizing: 'border-box', background: '#10201b', color: '#f4efda', font: '16px/1.5 system-ui' }}>
    <style>{'.wr-v11-entry button{min-height:44px;padding:8px 14px;font:inherit;cursor:pointer}.wr-v11-entry a{color:#f5d889}'}</style>
    <section style={{ maxWidth: 520 }}><h1>Wizard Realms v11 Highland preview</h1>
      <p>This experimental world adds a connected, discoverable Highland quarry to your saved journey.</p>
      {entry.status === 'checking' && <p role="status">Checking this device for a v11 save…</p>}
      {entry.status === 'upgrade' && <><p role="status">Your validated v10 world is ready. Upgrade creates a separate v11 save and preserves all older sources.</p>
        <button disabled={busy} onClick={() => void choose()}>Upgrade v10 world to v11</button></>}
      {entry.status === 'resume' && <><p role="status">A valid v11 world is ready. Resume it explicitly.</p>
        <button disabled={busy} onClick={() => void choose()}>Resume v11 world</button></>}
      {entry.status === 'needs-v10' && <p>No playable v10 world is ready. <a href="?publicWorld=v10">Open the v10 entry</a> first.</p>}
      {entry.status === 'blocked' && <><p role="alert">V11 save access is blocked ({entry.reason}). No save was restored, replaced, or reset.
        Keep this site data. Recovery requires a verified save choice; this preview cannot repair divergent or corrupt saves.</p>
        {rescues === null ? <p role="status">Checking stored v11 records for validated recovery downloads…</p>
          : rescues.length ? <><p>These downloads contain a locally validated v11 snapshot and its v10 source receipt, not proof of authenticity.
            Downloading does not resolve a fork or change any save. This preview cannot import these files. Keep the files and this site data.</p>
            {rescues.map((rescue) => <button key={rescue.source} onClick={() => download(rescue)}>
              Download validated {rescue.source} save #{rescue.saveRevision}
            </button>)}</> : <p>No validated export is available. Keep this site data; no raw or unvalidated save will be downloaded.</p>}
        {downloadNotice && <p role="status">{downloadNotice}</p>}
        <button onClick={() => window.location.reload()}>Reload to recheck storage</button></>}
    </section>
  </main>
}
