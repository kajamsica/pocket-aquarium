import { PUBLIC_V43_DATABASE_NAME, decodePublicV43CheckedSuccessor,
  decodePublicV43Root } from './publicWorldV43Snapshot'
import type { PublicV43Root } from './publicWorldV43Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export type AtomicV43Read = { status: 'missing'; proof: object }
  | { status: 'valid'; root: PublicV43Root; proof: object }
  | { status: 'blocked'; reason: string }
type Prior = { raw: unknown; root: PublicV43Root } | null
const SUCCESSOR_KEY = 'v44-successor'
const SUCCESSOR_SCHEMA = 'v44-successor/v1' as const
const FINGERPRINT_PREFIX = 'v43-canonical-sha256/v1:'
export type V43SuccessorMarker = Readonly<{ schemaVersion: typeof SUCCESSOR_SCHEMA;
  phase: 'pending' | 'finalized' | 'conflict'; sourceRevision: number;
  sourceFingerprint: string }>
export type AtomicV43PromotionRead = { status: 'missing' }
  | { status: 'valid'; root: PublicV43Root; marker: V43SuccessorMarker | null;
    sourceFingerprint: string; proof: object }
  | { status: 'blocked'; reason: string }
type PromotionPrior = { raw: unknown; markerRaw: unknown;
  marker: V43SuccessorMarker | null; root: PublicV43Root; fingerprint: string }

function decodeMarker(raw: unknown): V43SuccessorMarker | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.getPrototypeOf(raw) !== Object.prototype
    || Reflect.ownKeys(raw).length !== 4
    || Object.keys(raw).sort().join() !== 'phase,schemaVersion,sourceFingerprint,sourceRevision')
    return null
  const marker = raw as Partial<V43SuccessorMarker>
  return marker.schemaVersion === SUCCESSOR_SCHEMA
    && (marker.phase === 'pending' || marker.phase === 'finalized'
      || marker.phase === 'conflict')
    && Number.isSafeInteger(marker.sourceRevision) && marker.sourceRevision! >= 0
    && typeof marker.sourceFingerprint === 'string'
    && /^v43-canonical-sha256\/v1:[0-9a-f]{64}$/.test(marker.sourceFingerprint)
    ? marker as V43SuccessorMarker : null
}

/** Versioned digest of a checked root, independent of object key order. */
async function sourceFingerprint(root: PublicV43Root): Promise<string> {
  const canonical = JSON.stringify(root, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0))
      : value)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return FINGERPRINT_PREFIX + Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}

/** Independent V43 record. One checked read proof permits one atomic CAS. */
export function createAtomicV43Store(factory: IDBFactory,
  name = PUBLIC_V43_DATABASE_NAME) {
  const proofs = new WeakMap<object, Prior>()
  const promotionProofs = new WeakMap<object, PromotionPrior>()
  async function open() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, 1)
      let blocked = false
      request.onupgradeneeded = () => request.result.createObjectStore('records')
      request.onerror = () => reject(request.error)
      request.onblocked = () => { blocked = true; reject(new Error('Database blocked')) }
      request.onsuccess = () => blocked ? request.result.close() : resolve(request.result)
    })
  }
  return {
    async readForPromotion(): Promise<AtomicV43PromotionRead> {
      let db: IDBDatabase | undefined
      try {
        db = await open()
        const snapshot = await new Promise<{ raw: unknown; markerRaw: unknown;
          keys: IDBValidKey[] } | null>((resolve) => {
          const tx = db!.transaction('records', 'readonly'), records = tx.objectStore('records')
          const root = records.get('root'), marker = records.get(SUCCESSOR_KEY)
          const keys = records.getAllKeys()
          tx.onabort = () => resolve(null)
          tx.oncomplete = () => resolve({ raw: root.result, markerRaw: marker.result,
            keys: keys.result })
        })
        if (!snapshot) return { status: 'blocked', reason: 'storage-error' }
        if (snapshot.keys.length === 0) return { status: 'missing' }
        const marked = snapshot.keys.length === 2 && snapshot.keys[0] === 'root'
          && snapshot.keys[1] === SUCCESSOR_KEY
        if (!(snapshot.keys.length === 1 && snapshot.keys[0] === 'root') && !marked)
          return { status: 'blocked', reason: 'invalid-v43-records' }
        const root = decodePublicV43Root(snapshot.raw)
        if (!root) return { status: 'blocked', reason: 'invalid-v43-root' }
        // CAS comparison and V44 lineage both have a strict three MiB ceiling.
        if (!sameStrictBoundedRaw(root, structuredClone(root), 3 << 20))
          return { status: 'blocked', reason: 'source-too-large' }
        const fingerprint = await sourceFingerprint(root)
        const marker = marked ? decodeMarker(snapshot.markerRaw) : null
        if (marked && (!marker || marker.sourceRevision !== root.head.saveRevision
          || marker.sourceFingerprint !== fingerprint))
          return { status: 'blocked', reason: 'invalid-successor-marker' }
        const proof = {}
        promotionProofs.set(proof, { raw: snapshot.raw, markerRaw: snapshot.markerRaw,
          marker, root, fingerprint })
        return { status: 'valid', root: structuredClone(root),
          marker: marker ? structuredClone(marker) : null,
          sourceFingerprint: fingerprint, proof }
      } catch { return { status: 'blocked', reason: 'storage-error' } }
      finally { db?.close() }
    },
    async transitionSuccessor(proof: object, phase: V43SuccessorMarker['phase']): Promise<
      'committed' | 'unchanged' | 'invalid' | 'revision-changed' | 'storage-error'> {
      const prior = promotionProofs.get(proof)
      if (!prior) return 'invalid'
      promotionProofs.delete(proof)
      if (phase !== 'pending' && phase !== 'finalized' && phase !== 'conflict')
        return 'invalid'
      const before = prior.marker?.phase
      if (!(before === phase || !before && phase === 'pending'
        || before === 'pending' && (phase === 'finalized' || phase === 'conflict')
        || before === 'finalized' && phase === 'conflict')) return 'invalid'
      const next: V43SuccessorMarker = { schemaVersion: SUCCESSOR_SCHEMA,
        phase, sourceRevision: prior.root.head.saveRevision,
        sourceFingerprint: prior.fingerprint }
      let db: IDBDatabase | undefined
      try {
        db = await open()
        return await new Promise((resolve) => {
          let tx: IDBTransaction
          try { tx = db!.transaction('records', 'readwrite', { durability: 'strict' }) }
          catch (error) {
            if (!(error instanceof TypeError) && !(error instanceof DOMException
              && error.name === 'NotSupportedError')) throw error
            tx = db!.transaction('records', 'readwrite')
          }
          const records = tx.objectStore('records'), root = records.get('root')
          const marker = records.get(SUCCESSOR_KEY), keys = records.getAllKeys()
          let result: 'committed' | 'unchanged' | 'revision-changed' | 'storage-error'
            = 'storage-error'
          tx.oncomplete = () => resolve(result)
          tx.onabort = () => resolve('storage-error')
          keys.onsuccess = () => {
            let unchanged = false
            try {
              unchanged = keys.result.length === (prior.marker ? 2 : 1)
                && keys.result[0] === 'root'
                && (!prior.marker || keys.result[1] === SUCCESSOR_KEY
                  && sameStrictBoundedRaw(marker.result, prior.markerRaw))
                && sameStrictBoundedRaw(root.result, prior.raw, 3 << 20)
            } catch { /* A changed source or marker cannot satisfy the CAS. */ }
            if (!unchanged) { result = 'revision-changed'; return }
            if (before === phase) { result = 'unchanged'; return }
            try { records.put(next, SUCCESSOR_KEY); result = 'committed' }
            catch { tx.abort() }
          }
        })
      } catch { return 'storage-error' }
      finally { db?.close() }
    },
    async readChecked(): Promise<AtomicV43Read> {
      let db: IDBDatabase | undefined
      try {
        db = await open()
        return await new Promise<AtomicV43Read>((resolve) => {
          const tx = db!.transaction('records', 'readonly'), records = tx.objectStore('records')
          const value = records.get('root'), keys = records.getAllKeys()
          tx.onabort = () => resolve({ status: 'blocked', reason: 'storage-error' })
          tx.oncomplete = () => {
            try {
              if (keys.result.length === 0) {
                const proof = {}; proofs.set(proof, null)
                resolve({ status: 'missing', proof }); return
              }
              const exactKeys = keys.result.length === 1 && keys.result[0] === 'root'
              const root = exactKeys ? decodePublicV43Root(value.result) : null
              if (!root) {
                resolve({ status: 'blocked', reason: 'invalid-v43-root' }); return
              }
              const proof = {}
              proofs.set(proof, { raw: value.result, root })
              resolve({ status: 'valid', root: structuredClone(root), proof })
            } catch { resolve({ status: 'blocked', reason: 'invalid-v43-root' }) }
          }
        })
      } catch { return { status: 'blocked', reason: 'storage-error' } }
      finally { db?.close() }
    },
    async commit(proof: object, next: PublicV43Root): Promise<
      'committed' | 'invalid' | 'revision-changed' | 'storage-error'> {
      if (!proofs.has(proof)) return 'invalid'
      const prior = proofs.get(proof)!; proofs.delete(proof)
      const decoded = prior === null ? decodePublicV43Root(next)
        : decodePublicV43CheckedSuccessor(prior.root, next)
      if (!decoded || prior === null && decoded.head.saveRevision !== 0) return 'invalid'
      const candidate = structuredClone(decoded)
      let db: IDBDatabase | undefined
      try {
        db = await open()
        return await new Promise((resolve) => {
          let tx: IDBTransaction
          try { tx = db!.transaction('records', 'readwrite', { durability: 'strict' }) }
          catch (error) {
            if (!(error instanceof TypeError) && !(error instanceof DOMException
              && error.name === 'NotSupportedError')) throw error
            tx = db!.transaction('records', 'readwrite')
          }
          const records = tx.objectStore('records'), read = records.get('root')
          const keys = records.getAllKeys()
          let result: 'committed' | 'revision-changed' | 'storage-error' = 'storage-error'
          tx.oncomplete = () => resolve(result)
          tx.onabort = () => resolve('storage-error')
          keys.onsuccess = () => {
            let unchanged = false
            try {
              unchanged = keys.result.length === (prior === null ? 0 : 1)
                && (prior === null || keys.result[0] === 'root'
                  && sameStrictBoundedRaw(read.result, prior.raw, 3 << 20))
            } catch { /* Competing data cannot satisfy the CAS. */ }
            if (!unchanged) { result = 'revision-changed'; return }
            try { records.put(candidate, 'root'); result = 'committed' }
            catch { tx.abort() }
          }
        })
      } catch { return 'storage-error' }
      finally { db?.close() }
    },
  }
}
