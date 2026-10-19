import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createAtomicV8Store } from './domain/atomicV8Database'
import { createAtomicV9Store } from './domain/atomicV9Database'
import { createAtomicV10Store } from './domain/atomicV10Database'
import { createAtomicV11Store } from './domain/atomicV11Database'
import { createAtomicV12Store } from './domain/atomicV12Database'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { commitPublicV12Snapshot, inspectPublicV12, migratePublicV11ToV12, resumePublicV12,
  type PublicV12Operation, type PublicV12Start } from './domain/publicWorldV12Flow'
import { decodePublicV12Head, isValidPublicV12SourceReceipt, publicV12RescueSourceFitsCap, serializePublicV12Rescue,
  type PublicV12SourceReceipt } from './domain/publicWorldV12Snapshot'
import type { PublicWorldV12State } from './domain/publicWorldV12State'

export type PublicV12EntryBindings = {
  storage: Pick<Storage, 'getItem'>
  locks: PublicV7LockProvider
  v8: ReturnType<typeof createAtomicV8Store>
  v9: ReturnType<typeof createAtomicV9Store>
  v10: ReturnType<typeof createAtomicV10Store>
  v11: ReturnType<typeof createAtomicV11Store>
  v12: ReturnType<typeof createAtomicV12Store>
}
export type PublicV12EntryDecision =
  | { status: 'resume'; start: PublicV12Start }
  | { status: 'upgrade'; sourceReceipt: PublicV12SourceReceipt }
  | { status: 'needs-v11' }
  | { status: 'blocked'; reason: string }

/** Inspection is read-only. The displayed choice must still be rechecked under the shared lock when clicked. */
export async function inspectPublicV12Entry(storage: Pick<Storage, 'getItem'>,
  locks: PublicV7LockProvider | undefined, v8: PublicV12EntryBindings['v8'],
  v9: PublicV12EntryBindings['v9'], v10: PublicV12EntryBindings['v10'],
  v11: PublicV12EntryBindings['v11'], v12: PublicV12EntryBindings['v12']): Promise<PublicV12EntryDecision> {
  const result = await inspectPublicV12(storage, locks, v8, v9, v10, v11, v12)
  if (!result.ok) return { status: 'blocked', reason: result.reason }
  if (result.value.status === 'valid') return { status: 'resume', start: result.value.start }
  if (result.value.status === 'blocked') return result.value
  return result.value.sourceReceipt
    ? { status: 'upgrade', sourceReceipt: result.value.sourceReceipt } : { status: 'needs-v11' }
}

/** No stale UI decision can publish an upgrade or resume: both flows inspect the live source again. */
export function choosePublicV12Entry(bindings: PublicV12EntryBindings,
  decision: PublicV12EntryDecision): Promise<PublicV12Operation<PublicV12Start>> {
  const { storage, locks, v8, v9, v10, v11, v12 } = bindings
  if (decision.status === 'resume') return resumePublicV12(storage, locks, v8, v9, v10, v11,
    v12, decision.start.saveRevision, decision.start.sourceReceipt)
  if (decision.status === 'upgrade') return migratePublicV11ToV12(storage, locks, v8, v9, v10,
    v11, v12, decision.sourceReceipt)
  return Promise.resolve({ ok: false, reason: 'choice-unavailable' })
}

export type StoredV12Rescue = { source: 'head' | 'previous'; saveRevision: number; bytes: string }
/** Independently validate each stored head. The serializer refuses exports above 8 MiB. */
export async function readPublicV12Rescues(v12: Pick<PublicV12EntryBindings['v12'], 'read'>): Promise<StoredV12Rescue[]> {
  try {
    const records = await v12.read()
    if (records.status !== 'ok' || !publicV12RescueSourceFitsCap(records.lineage)
      || !isValidPublicV12SourceReceipt(records.lineage)) return []
    const lineage = records.lineage
    return (['head', 'previous'] as const).flatMap((source) => {
      const record = records[source]
      if (!record || typeof record !== 'object' || Array.isArray(record)
        || Reflect.ownKeys(record).length !== 2 || !Object.hasOwn(record, 'value')
        || !Object.hasOwn(record, 'saveRevision')) return []
      const snapshot = decodePublicV12Head(record.value)
      if (!snapshot || snapshot.saveRevision !== record.saveRevision) return []
      try {
        return [{ source, saveRevision: snapshot.saveRevision, bytes: serializePublicV12Rescue(
          snapshot.state, snapshot.bootstrap, snapshot.saveRevision, lineage) }]
      } catch { return [] }
    })
  } catch { return [] }
}

/** An integration boundary, not a v12 session implementation inside the older world view. */
export type PublicV12PlayableSession = {
  start: PublicV12Start
  commit: (state: PublicWorldV12State, expectedRevision: number,
    sourceReceipt: PublicV12SourceReceipt) => Promise<PublicV12Operation<PublicV12Start>>
}

export type PublicV12EntryViewProps = {
  entry: PublicV12EntryDecision | { status: 'checking' }
  busy: boolean
  rescues: StoredV12Rescue[] | null
  downloadNotice: string
  onChoose: () => void
  onDownload: (rescue: StoredV12Rescue) => void
  onReload: () => void
}

export function PublicV12EntryView({ entry, busy, rescues, downloadNotice, onChoose,
  onDownload, onReload }: PublicV12EntryViewProps) {
  return <main className="wr-v12-entry" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center',
    padding: 24, boxSizing: 'border-box', background: '#10201b', color: '#f4efda', font: '16px/1.5 system-ui' }}>
    <style>{'.wr-v12-entry button{min-height:44px;padding:8px 14px;font:inherit;cursor:pointer}.wr-v12-entry a{color:#f5d889}'}</style>
    <section style={{ maxWidth: 520 }}><h1>Wizard Realms v12 Windward Step preview</h1>
      <p>This experimental world adds a learnable wind spell to the Highland return trail.</p>
      {entry.status === 'checking' && <p role="status">Checking this device for a v12 save…</p>}
      {entry.status === 'upgrade' && <><p role="status">Your validated v11 world is ready. Upgrading creates a separate v12 save and preserves all older saves.</p>
        <button disabled={busy} onClick={onChoose}>Upgrade v11 world to v12</button></>}
      {entry.status === 'resume' && <><p role="status">A valid v12 world is ready. Resume it explicitly.</p>
        <button disabled={busy} onClick={onChoose}>Resume v12 world</button></>}
      {entry.status === 'needs-v11' && <p>No playable v11 world is ready. <a href="?publicWorld=v11">Open the v11 entry</a> first.</p>}
      {entry.status === 'blocked' && <><p role="alert">V12 save access is blocked ({entry.reason}). No save was restored, replaced, or reset.
        Keep this site data. This preview cannot resolve divergent or corrupt saves automatically.</p>
        {rescues === null ? <p role="status">Checking stored v12 records for validated recovery downloads…</p>
          : rescues.length ? <><p>These read-only downloads contain locally validated v12 snapshots and their pinned v11 source receipt.
            They are not proof of authenticity. Downloading does not resolve a fork, change a save, or import a file.
            Keep the files and this site data.</p>
            {rescues.map((rescue) => <button key={rescue.source} onClick={() => onDownload(rescue)}>
              Download validated {rescue.source} save #{rescue.saveRevision}
            </button>)}</> : <p>No validated export under the 8 MiB limit is available.
              Keep this site data; no raw or unvalidated save will be downloaded.</p>}
        {downloadNotice && <p role="status">{downloadNotice}</p>}
        <button onClick={onReload}>Reload to recheck storage</button></>}
    </section>
  </main>
}

/** Requires an explicit world renderer; this entry is intentionally not mounted by the public router yet. */
export function PublicV12EntryApp({ renderWorld }: { renderWorld: (session: PublicV12PlayableSession) => ReactNode }) {
  const bindings = useRef<PublicV12EntryBindings | null>(null)
  const choosing = useRef(false)
  const [entry, setEntry] = useState<PublicV12EntryDecision | { status: 'checking' }>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState<PublicV12PlayableSession | null>(null)
  const [rescues, setRescues] = useState<StoredV12Rescue[] | null>(null)
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
        v10: createAtomicV10Store(factory), v11: createAtomicV11Store(factory),
        v12: createAtomicV12Store(factory) }
      const result = await inspectPublicV12Entry(current.storage, current.locks,
        current.v8, current.v9, current.v10, current.v11, current.v12)
      if (!cancelled) setEntry(result)
    }
    void check().catch(() => { if (!cancelled) setEntry({ status: 'blocked', reason: 'storage-error' }) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (entry.status !== 'blocked') return
    let cancelled = false
    const check = async () => {
      const store = bindings.current?.v12 ?? (window.indexedDB ? createAtomicV12Store(window.indexedDB) : null)
      const result = store ? await readPublicV12Rescues(store) : []
      if (!cancelled) setRescues(result)
    }
    void check().catch(() => { if (!cancelled) setRescues([]) })
    return () => { cancelled = true }
  }, [entry.status])
  const download = (rescue: StoredV12Rescue) => {
    let url: string | null = null
    let link: HTMLAnchorElement | null = null
    try {
      url = URL.createObjectURL(new Blob([rescue.bytes], { type: 'application/json' }))
      link = document.createElement('a')
      link.href = url
      link.download = `wizard-realms-v12-${rescue.source}-${rescue.saveRevision}-rescue.json`
      document.body.append(link)
      link.click()
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
    choosing.current = true
    setBusy(true)
    const current = bindings.current
    try {
      const result = await choosePublicV12Entry(current, entry)
      if (!result.ok) { setEntry({ status: 'blocked', reason: result.reason }); return }
      setSession({ start: result.value, commit: (state, revision, receipt) =>
        commitPublicV12Snapshot(current.storage, current.locks, current.v8, current.v9,
          current.v10, current.v11, current.v12, state, revision, receipt) })
    } catch { setEntry({ status: 'blocked', reason: 'storage-error' }) }
    finally { choosing.current = false; setBusy(false) }
  }
  if (session) return <>{renderWorld(session)}</>
  return <PublicV12EntryView entry={entry} busy={busy} rescues={rescues} downloadNotice={downloadNotice}
    onChoose={() => void choose()} onDownload={download} onReload={() => window.location.reload()} />
}
