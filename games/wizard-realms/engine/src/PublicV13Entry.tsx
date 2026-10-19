import { useEffect, useRef, useState } from 'react'
import { PublicV13Controller } from './PublicV13Controller'
import { createAtomicV8Store } from './domain/atomicV8Database'
import { createAtomicV9Store } from './domain/atomicV9Database'
import { createAtomicV10Store } from './domain/atomicV10Database'
import { createAtomicV11Store } from './domain/atomicV11Database'
import { createAtomicV12Store } from './domain/atomicV12Database'
import { createAtomicV13Store } from './domain/atomicV13Database'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { inspectPublicV13, migratePublicSourceToV13, resumePublicV13 } from './domain/publicWorldV13Flow'
import type { PublicV13Start } from './domain/publicWorldV13Flow'
import { serializePublicV13Rescue } from './domain/publicWorldV13Rescue'
import { createPublicV13SourceReader } from './domain/publicWorldV13SourceReader'
import { decodePublicV13Head, decodePublicV13SourceLineage } from './domain/publicWorldV13Snapshot'
import type { PublicV13SourceLineage } from './domain/publicWorldV13Snapshot'

type Reader = ReturnType<typeof createPublicV13SourceReader>
type Store = ReturnType<typeof createAtomicV13Store>
type Bindings = { locks: PublicV7LockProvider; reader: Reader; store: Store }
export type PublicV13EntryDecision =
  | { status: 'resume'; start: PublicV13Start }
  | { status: 'upgrade'; sourceLineage: PublicV13SourceLineage }
  | { status: 'needs-source' }
  | { status: 'blocked'; reason: string }
type Rescue = { source: 'head' | 'previous'; saveRevision: number; bytes: string }

export function PublicV13SourceLink() {
  return <a href="?publicWorld=v11" style={{ display: 'inline-flex', minHeight: 44,
    alignItems: 'center' }}>Open the v11 entry</a>
}

export async function inspectPublicV13Entry(locks: PublicV7LockProvider | undefined,
  reader: Reader, store: Store): Promise<PublicV13EntryDecision> {
  const result = await inspectPublicV13(locks, reader, store)
  if (!result.ok) return { status: 'blocked', reason: result.reason }
  if (result.value.status === 'blocked') return result.value
  if (result.value.status === 'valid') return { status: 'resume', start: result.value.start }
  return result.value.sourceLineage
    ? { status: 'upgrade', sourceLineage: result.value.sourceLineage }
    : { status: 'needs-source' }
}

/** Individually validated offline exports, not proof that the old source is still live. */
export async function readPublicV13Rescues(store: Pick<Store, 'read'>): Promise<Rescue[]> {
  try {
    const records = await store.read()
    if (records.status !== 'ok') return []
    const lineage = decodePublicV13SourceLineage(records.lineage)
    if (!lineage) return []
    return (['head', 'previous'] as const).flatMap((source) => {
      const record = records[source]
      if (!record || typeof record !== 'object' || Array.isArray(record)
        || Object.getPrototypeOf(record) !== Object.prototype
        || Reflect.ownKeys(record).length !== 2
        || !Object.hasOwn(record, 'value') || !Object.hasOwn(record, 'saveRevision')) return []
      const shaped = record as { value: unknown; saveRevision: unknown }
      const head = decodePublicV13Head(shaped.value, lineage)
      if (!head || head.saveRevision !== shaped.saveRevision) return []
      try {
        return [{ source, saveRevision: head.saveRevision, bytes: serializePublicV13Rescue(
          { state: head.state, bootstrap: head.bootstrap, saveRevision: head.saveRevision,
            sourceLineage: lineage }, null) }]
      } catch { return [] }
    })
  } catch { return [] }
}

export function PublicV13EntryApp() {
  const bindings = useRef<Bindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV13EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState<PublicV13Start | null>(null)
  const [rescues, setRescues] = useState<Rescue[] | null>(null)
  const [downloadNotice, setDownloadNotice] = useState('')
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const locks = (navigator as Navigator & { locks?: PublicV7LockProvider }).locks
      if (!locks) { setEntry({ status: 'blocked', reason: 'lock-unavailable' }); return }
      const storage = window.localStorage, factory = window.indexedDB
      if (!storage || !factory) { setEntry({ status: 'blocked', reason: 'storage-error' }); return }
      if (!bindings.current) {
        const v8 = createAtomicV8Store(factory), v9 = createAtomicV9Store(factory)
        const v10 = createAtomicV10Store(factory), v11 = createAtomicV11Store(factory)
        const v12 = createAtomicV12Store(factory)
        bindings.current = { locks, reader: createPublicV13SourceReader(factory, storage,
          v8, v9, v10, v11, v12), store: createAtomicV13Store(factory) }
      }
      const { reader, store } = bindings.current
      const result = await inspectPublicV13Entry(locks, reader, store)
      if (!cancelled) setEntry(result)
    }
    void check().catch(() => { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (entry.status !== 'blocked') return
    let cancelled = false
    const store = bindings.current?.store ?? (window.indexedDB ? createAtomicV13Store(window.indexedDB) : null)
    if (!store) { setRescues([]); return }
    void readPublicV13Rescues(store).then((result) => { if (!cancelled) setRescues(result) })
    return () => { cancelled = true }
  }, [entry.status])
  const choose = async () => {
    if (!bindings.current || choosing.current || (entry.status !== 'resume' && entry.status !== 'upgrade')) return
    choosing.current = true; setBusy(true)
    const { locks, reader, store } = bindings.current
    try {
      const result = entry.status === 'resume'
        ? await resumePublicV13(locks, reader, store, entry.start.saveRevision, entry.start.sourceLineage)
        : await migratePublicSourceToV13(locks, reader, store, entry.sourceLineage)
      if (result.ok) setSession(result.value)
      else setEntry({ status: 'blocked', reason: result.reason })
    } catch { setEntry({ status: 'blocked', reason: 'storage-error' }) }
    finally { choosing.current = false; setBusy(false) }
  }
  const download = (rescue: Rescue) => {
    let url: string | null = null
    try {
      url = URL.createObjectURL(new Blob([rescue.bytes], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = `wizard-realms-v13-${rescue.source}-${rescue.saveRevision}-rescue.json`
      document.body.append(link); link.click(); link.remove()
      setDownloadNotice('Downloaded a locally validated offline record. Keep this site data too.')
    } catch { setDownloadNotice('Download failed. Keep this site data and recheck before continuing.') }
    finally { const cleanupUrl = url
      if (cleanupUrl) window.setTimeout(() => URL.revokeObjectURL(cleanupUrl), 60_000) }
  }
  if (session && bindings.current) return <PublicV13Controller start={session} {...bindings.current} />
  return <main className="wr-v13-entry" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center',
    padding: 24, boxSizing: 'border-box', background: '#10201b', color: '#f4efda', font: '16px/1.5 system-ui' }}>
    <style>{'.wr-v13-entry button{min-height:44px;padding:8px 14px;font:inherit;cursor:pointer}.wr-v13-entry a{color:#f5d889}'}</style>
    <section style={{ maxWidth: 520 }}><h1>Wizard Realms continuous-world preview</h1>
      <p>Explore connected terrain with a separate v13 save. Older worlds remain in their original slots.</p>
      {entry.status === 'checking' && <p role="status">Checking this device for a v13 world…</p>}
      {entry.status === 'upgrade' && <><p role="status">A validated {entry.sourceLineage.sourceSchemaVersion} world is ready.
        Migration requires your choice and creates a separate v13 save.</p>
        <button disabled={busy} onClick={() => void choose()}>Create v13 world from this save</button></>}
      {entry.status === 'resume' && <><p role="status">A valid v13 world is ready.</p>
        <button disabled={busy} onClick={() => void choose()}>Resume v13 world</button></>}
      {entry.status === 'needs-source' && <p>No validated v11 or v12 source is ready.
        {' '}<PublicV13SourceLink /> first.</p>}
      {entry.status === 'blocked' && <><p role="alert">V13 access is blocked ({entry.reason}). Nothing was reset or repaired.
        Keep this site data; a conflicting or corrupt save needs an independently verified recovery decision.</p>
        {rescues === null ? <p role="status">Checking for validated offline recovery downloads…</p>
          : rescues.length ? <><p>These records are locally validated snapshots, not proof that the source is still live.
            Downloading does not change a save. This preview cannot import them.</p>
            {rescues.map((rescue) => <button key={rescue.source} onClick={() => download(rescue)}>
              Download {rescue.source} save #{rescue.saveRevision}</button>)}</>
            : <p>No validated export is available. No raw save will be downloaded.</p>}
        {downloadNotice && <p role="status">{downloadNotice}</p>}
        <button onClick={() => window.location.reload()}>Reload to recheck storage</button></>}
    </section>
  </main>
}
