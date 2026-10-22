import { PUBLIC_V44_DATABASE_NAME, decodePublicV44Root } from './publicWorldV44Snapshot'
import type { PublicV44Root } from './publicWorldV44Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

const MARKER_KEY = 'v45-successor'
const MARKER_SCHEMA = 'v45-successor/v1' as const
const FINGERPRINT_PREFIX = 'v44-canonical-sha256/v1:'
const RAW_LIMIT = 3 << 20
type Phase = 'pending' | 'finalized' | 'conflict'
type Transition = 'committed' | 'unchanged' | 'invalid' | 'revision-changed' | 'storage-error'
type Snapshot = { raw: unknown; markerRaw: unknown; keys: IDBValidKey[] }
type Prior = Snapshot & { version: number; root: PublicV44Root;
  marker: V44SuccessorMarker | null; fingerprint: string }

export type V44SuccessorMarker = Readonly<{ schemaVersion: typeof MARKER_SCHEMA;
  phase: Phase; sourceRevision: number; sourceFingerprint: string }>
export type AtomicV44PromotionRead = { status: 'missing' }
  | { status: 'valid'; root: PublicV44Root; marker: V44SuccessorMarker | null;
    sourceFingerprint: string; proof: object }
  | { status: 'blocked'; reason: string }

function exactKeys(keys: IDBValidKey[], marked: boolean): boolean {
  return keys.length === (marked ? 2 : 1) && keys[0] === 'root'
    && (!marked || keys[1] === MARKER_KEY)
}

function decodeMarker(raw: unknown): V44SuccessorMarker | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.getPrototypeOf(raw) !== Object.prototype
    || Reflect.ownKeys(raw).length !== 4
    || Object.keys(raw).sort().join() !== 'phase,schemaVersion,sourceFingerprint,sourceRevision')
    return null
  const marker = raw as Partial<V44SuccessorMarker>
  return marker.schemaVersion === MARKER_SCHEMA
    && (marker.phase === 'pending' || marker.phase === 'finalized'
      || marker.phase === 'conflict')
    && Number.isSafeInteger(marker.sourceRevision) && marker.sourceRevision! >= 0
    && typeof marker.sourceFingerprint === 'string'
    && /^v44-canonical-sha256\/v1:[0-9a-f]{64}$/.test(marker.sourceFingerprint)
    ? marker as V44SuccessorMarker : null
}

// Keep this small digest implementation local so historical V43/V44 code remains isolated.
async function sourceFingerprint(root: PublicV44Root): Promise<string> {
  const canonical = JSON.stringify(root, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0)) : value)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return FINGERPRINT_PREFIX + Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}

function readSnapshot(db: IDBDatabase): Promise<Snapshot | null> {
  return new Promise((resolve) => {
    const tx = db.transaction('records', 'readonly'), records = tx.objectStore('records')
    const root = records.get('root'), marker = records.get(MARKER_KEY)
    const keys = records.getAllKeys()
    tx.onabort = () => resolve(null)
    tx.oncomplete = () => resolve({ raw: root.result, markerRaw: marker.result,
      keys: keys.result })
  })
}

function openCurrent(factory: IDBFactory, name: string): Promise<{
  db: IDBDatabase; created: boolean }> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name)
    let created = false
    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) { request.transaction?.abort(); return }
      created = true
      request.result.createObjectStore('records')
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve({ db: request.result, created })
  })
}

/**
 * V45-only reservation of a checked V44 source. The caller must hold the shared
 * exclusive PUBLIC_V7_LOCK_NAME lock until each transition promise settles.
 * Neither reading nor transitioning rewrites the V44 root.
 */
export function createAtomicV44PromotionStore(factory: IDBFactory,
  name = PUBLIC_V44_DATABASE_NAME) {
  const proofs = new WeakMap<object, Prior>()
  return {
    async readForPromotion(): Promise<AtomicV44PromotionRead> {
      let db: IDBDatabase | undefined
      try {
        const opened = await openCurrent(factory, name)
        db = opened.db
        if (db.version !== 1 && db.version !== 2)
          return { status: 'blocked', reason: 'unsupported-v44-version' }
        const snapshot = await readSnapshot(db)
        if (!snapshot) return { status: 'blocked', reason: 'storage-error' }
        if (snapshot.keys.length === 0)
          return opened.created && db.version === 1
            ? { status: 'missing' }
            : { status: 'blocked', reason: 'missing-v44-root' }
        if (!exactKeys(snapshot.keys, db.version === 2))
          return { status: 'blocked', reason: 'invalid-v44-records' }
        const root = decodePublicV44Root(snapshot.raw)
        if (!root) return { status: 'blocked', reason: 'invalid-v44-root' }
        if (!sameStrictBoundedRaw(snapshot.raw, snapshot.raw, RAW_LIMIT)
          || !sameStrictBoundedRaw(root, structuredClone(root), RAW_LIMIT))
          return { status: 'blocked', reason: 'source-too-large' }
        const fingerprint = await sourceFingerprint(root)
        const marker = db.version === 2 ? decodeMarker(snapshot.markerRaw) : null
        if (db.version === 2 && (!marker
          || marker.sourceRevision !== root.head.saveRevision
          || marker.sourceFingerprint !== fingerprint))
          return { status: 'blocked', reason: 'invalid-successor-marker' }
        if (marker?.phase === 'conflict')
          return { status: 'blocked', reason: 'successor-conflict' }
        const proof = {}
        proofs.set(proof, { ...snapshot, version: db.version, root, marker, fingerprint })
        return { status: 'valid', root: structuredClone(root),
          marker: marker ? structuredClone(marker) : null,
          sourceFingerprint: fingerprint, proof }
      } catch { return { status: 'blocked', reason: 'storage-error' } }
      finally { db?.close() }
    },
    async transitionSuccessor(proof: object, phase: Phase,
      onBlocked?: () => void): Promise<Transition> {
      const prior = proofs.get(proof)
      if (!prior) return 'invalid'
      proofs.delete(proof)
      if (phase !== 'pending' && phase !== 'finalized' && phase !== 'conflict')
        return 'invalid'
      const before = prior.marker?.phase
      if (!(before === phase || !before && phase === 'pending'
        || before === 'pending' && (phase === 'finalized' || phase === 'conflict')
        || before === 'finalized' && phase === 'conflict')) return 'invalid'
      const next: V44SuccessorMarker = { schemaVersion: MARKER_SCHEMA, phase,
        sourceRevision: prior.root.head.saveRevision,
        sourceFingerprint: prior.fingerprint }
      return prior.version === 1
        ? reservePending(factory, name, prior, next, onBlocked)
        : transitionMarked(factory, name, prior, next, onBlocked)
    },
  }
}

function reservePending(factory: IDBFactory, name: string, prior: Prior,
  next: V44SuccessorMarker, onBlocked?: () => void): Promise<Transition> {
  return new Promise((resolve) => {
    let changed = false, upgraded = false, blockedNotified = false, cancelled = false
    let request: IDBOpenDBRequest
    try { request = factory.open(name, 2) }
    catch { resolve('storage-error'); return }
    request.onblocked = () => {
      if (!blockedNotified) {
        blockedNotified = true
        cancelled = true
        resolve('storage-error')
        try { onBlocked?.() } catch { /* A UI callback cannot cancel the upgrade. */ }
      }
    }
    request.onupgradeneeded = (event) => {
      const tx = request.transaction
      if (cancelled) { tx?.abort(); return }
      upgraded = true
      if (event.oldVersion !== 1 || !tx) { changed = true; tx?.abort(); return }
      try {
        const records = tx.objectStore('records')
        const root = records.get('root'), keys = records.getAllKeys()
        keys.onsuccess = () => {
          let matches = false
          try { matches = exactKeys(keys.result, false)
            && sameStrictBoundedRaw(root.result, prior.raw, RAW_LIMIT) }
          catch { /* A changed or oversized root cannot satisfy the CAS. */ }
          if (!matches) { changed = true; tx.abort(); return }
          try { records.put(next, MARKER_KEY) } catch { tx.abort() }
        }
      } catch { tx.abort() }
    }
    request.onerror = () => resolve(changed ? 'revision-changed' : 'storage-error')
    request.onsuccess = () => {
      request.result.close()
      if (cancelled) return
      resolve(upgraded ? 'committed' : 'revision-changed')
    }
  })
}

function transitionMarked(factory: IDBFactory, name: string, prior: Prior,
  next: V44SuccessorMarker, onBlocked?: () => void): Promise<Transition> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    let blockedNotified = false, changed = false
    try { request = factory.open(name, 2) }
    catch { resolve('storage-error'); return }
    request.onblocked = () => {
      if (!blockedNotified) {
        blockedNotified = true
        try { onBlocked?.() } catch { /* A UI callback cannot cancel the request. */ }
      }
    }
    request.onerror = () => resolve(changed ? 'revision-changed' : 'storage-error')
    request.onupgradeneeded = () => { changed = true; request.transaction?.abort() }
    request.onsuccess = () => {
      const db = request.result
      if (db.version !== 2) { db.close(); resolve('revision-changed'); return }
      let tx: IDBTransaction
      try { tx = db.transaction('records', 'readwrite', { durability: 'strict' }) }
      catch (error) {
        if (!(error instanceof TypeError) && !(error instanceof DOMException
          && error.name === 'NotSupportedError')) {
          db.close(); resolve('storage-error'); return
        }
        try { tx = db.transaction('records', 'readwrite') }
        catch { db.close(); resolve('storage-error'); return }
      }
      const records = tx.objectStore('records'), root = records.get('root')
      const marker = records.get(MARKER_KEY), keys = records.getAllKeys()
      let result: Transition = 'storage-error'
      tx.onabort = () => { db.close(); resolve('storage-error') }
      tx.oncomplete = () => { db.close(); resolve(result) }
      keys.onsuccess = () => {
        let matches = false
        try { matches = exactKeys(keys.result, true)
          && sameStrictBoundedRaw(root.result, prior.raw, RAW_LIMIT)
          && sameStrictBoundedRaw(marker.result, prior.markerRaw, RAW_LIMIT) }
        catch { /* A changed record cannot satisfy the CAS. */ }
        if (!matches) { result = 'revision-changed'; return }
        if (prior.marker?.phase === next.phase) { result = 'unchanged'; return }
        try { records.put(next, MARKER_KEY); result = 'committed' }
        catch { tx.abort() }
      }
    }
  })
}
