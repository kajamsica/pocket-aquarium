import { PUBLIC_V42_DATABASE_NAME, decodePublicV42CheckedSuccessor,
  decodePublicV42Root, createFreshPublicV42Root } from './publicWorldV42Snapshot'
import type { PublicV42Root } from './publicWorldV42Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export type AtomicV42Read = { status: 'missing'; proof: object }
  | { status: 'valid'; root: PublicV42Root; proof: object }
  | { status: 'blocked'; reason: string }
/** Optional numeric diagnostics. The caller owns the localhost/opt-in gate. */
export type AtomicV42StoreTrace = (sample: Readonly<{
  operation: 'readChecked' | 'commit'; phase: 'validate' | 'candidate-clone'
    | 'open' | 'transaction' | 'request-wait' | 'cas' | 'put'
    | 'tx-completion' | 'decode' | 'clone'; durationMs: number
}>) => void
type AtomicV42StoreSample = Parameters<AtomicV42StoreTrace>[0]
function reportStorePhase(trace: AtomicV42StoreTrace | undefined,
  operation: AtomicV42StoreSample['operation'], phase: AtomicV42StoreSample['phase'],
  startedAt: number) {
  if (!trace) return
  try { trace({ operation, phase, durationMs: performance.now() - startedAt }) }
  catch { /* Diagnostics must not affect checked writes. */ }
}
type Prior = { raw: unknown; root: PublicV42Root } | null
const SUCCESSOR_KEY = 'v43-successor'
const SUCCESSOR_SCHEMA = 'v43-successor/v1' as const
const FINGERPRINT_PREFIX = 'v42-canonical-sha256/v1:'
export type V42SuccessorMarker = Readonly<{ schemaVersion: typeof SUCCESSOR_SCHEMA;
  phase: 'pending' | 'finalized' | 'conflict'; sourceRevision: number;
  sourceFingerprint: string }>
export type AtomicV42PromotionRead = { status: 'missing' }
  | { status: 'valid'; root: PublicV42Root; marker: V42SuccessorMarker | null;
    sourceFingerprint: string; proof: object }
  | { status: 'blocked'; reason: string }
type PromotionPrior = { raw: unknown; markerRaw: unknown;
  marker: V42SuccessorMarker | null; root: PublicV42Root; fingerprint: string }

function decodeMarker(raw: unknown): V42SuccessorMarker | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.getPrototypeOf(raw) !== Object.prototype
    || Reflect.ownKeys(raw).length !== 4
    || Object.keys(raw).sort().join() !== 'phase,schemaVersion,sourceFingerprint,sourceRevision')
    return null
  const marker = raw as Partial<V42SuccessorMarker>
  return marker.schemaVersion === SUCCESSOR_SCHEMA
    && (marker.phase === 'pending' || marker.phase === 'finalized'
      || marker.phase === 'conflict')
    && Number.isSafeInteger(marker.sourceRevision) && marker.sourceRevision! >= 0
    && typeof marker.sourceFingerprint === 'string'
    && /^v42-canonical-sha256\/v1:[0-9a-f]{64}$/.test(marker.sourceFingerprint)
    ? marker as V42SuccessorMarker : null
}

/** Versioned, key-order-independent digest of an already checked V42 root. */
async function sourceFingerprint(root: PublicV42Root): Promise<string> {
  const canonical = JSON.stringify(root, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0))
      : value)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return FINGERPRINT_PREFIX + Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}

/** Separate V42 record. A read proof permits one checked atomic write. */
export function createAtomicV42Store(factory: IDBFactory,
  name = PUBLIC_V42_DATABASE_NAME) {
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
    /** Atomically create a checked fresh source and its V43 fence. No unfenced
     * V42 root is ever exposed, including after an interrupted fresh start. */
    async bootstrapFreshSuccessor(seed: string): Promise<
      'committed' | 'invalid-seed' | 'revision-changed' | 'storage-error'> {
      let root: PublicV42Root
      try {
        const checked = decodePublicV42Root(createFreshPublicV42Root(seed))
        if (!checked) return 'invalid-seed'
        root = checked
      } catch { return 'invalid-seed' }
      let marker: V42SuccessorMarker
      try {
        marker = { schemaVersion: SUCCESSOR_SCHEMA, phase: 'pending',
          sourceRevision: root.head.saveRevision,
          sourceFingerprint: await sourceFingerprint(root) }
      } catch { return 'storage-error' }
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
          const records = tx.objectStore('records'), keys = records.getAllKeys()
          let result: 'committed' | 'revision-changed' | 'storage-error' = 'storage-error'
          tx.oncomplete = () => resolve(result)
          tx.onabort = () => resolve('storage-error')
          keys.onsuccess = () => {
            if (keys.result.length !== 0) { result = 'revision-changed'; return }
            try {
              records.put(root, 'root')
              records.put(marker, SUCCESSOR_KEY)
              result = 'committed'
            } catch { tx.abort() }
          }
        })
      } catch { return 'storage-error' }
      finally { db?.close() }
    },
    async readForPromotion(): Promise<AtomicV42PromotionRead> {
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
          return { status: 'blocked', reason: 'invalid-v42-records' }
        const root = decodePublicV42Root(snapshot.raw)
        if (!root) return { status: 'blocked', reason: 'invalid-v42-root' }
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
    async transitionSuccessor(proof: object, phase: V42SuccessorMarker['phase']): Promise<
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
      const next: V42SuccessorMarker = { schemaVersion: SUCCESSOR_SCHEMA,
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
    async readChecked(trace?: AtomicV42StoreTrace): Promise<AtomicV42Read> {
      let db: IDBDatabase | undefined
      try {
        const openStartedAt = trace ? performance.now() : 0
        db = await open()
        reportStorePhase(trace, 'readChecked', 'open', openStartedAt)
        return await new Promise<AtomicV42Read>((resolve) => {
          const transactionStartedAt = trace ? performance.now() : 0
          const tx = db!.transaction('records', 'readonly'), records = tx.objectStore('records')
          reportStorePhase(trace, 'readChecked', 'transaction', transactionStartedAt)
          const requestStartedAt = trace ? performance.now() : 0
          const value = records.get('root'), keys = records.getAllKeys()
          let completionStartedAt = requestStartedAt
          keys.onsuccess = () => {
            reportStorePhase(trace, 'readChecked', 'request-wait', requestStartedAt)
            completionStartedAt = trace ? performance.now() : 0
          }
          tx.onabort = () => {
            reportStorePhase(trace, 'readChecked', 'tx-completion', completionStartedAt)
            resolve({ status: 'blocked', reason: 'storage-error' })
          }
          tx.oncomplete = () => {
            reportStorePhase(trace, 'readChecked', 'tx-completion', completionStartedAt)
            try {
              if (keys.result.length === 0) {
                const proof = {}; proofs.set(proof, null)
                resolve({ status: 'missing', proof }); return
              }
              const exactKeys = keys.result.length === 1 && keys.result[0] === 'root'
              const decodeStartedAt = trace ? performance.now() : 0
              const root = exactKeys ? decodePublicV42Root(value.result) : null
              reportStorePhase(trace, 'readChecked', 'decode', decodeStartedAt)
              if (!root) {
                resolve({ status: 'blocked', reason: 'invalid-v42-root' }); return
              }
              const proof = {}
              proofs.set(proof, { raw: value.result, root })
              const cloneStartedAt = trace ? performance.now() : 0
              const clone = structuredClone(root)
              reportStorePhase(trace, 'readChecked', 'clone', cloneStartedAt)
              resolve({ status: 'valid', root: clone, proof })
            } catch { resolve({ status: 'blocked', reason: 'invalid-v42-root' }) }
          }
        })
      } catch { return { status: 'blocked', reason: 'storage-error' } }
      finally { db?.close() }
    },
    async commit(proof: object, next: PublicV42Root,
      trace?: AtomicV42StoreTrace): Promise<
      'committed' | 'invalid' | 'revision-changed' | 'storage-error'> {
      if (!proofs.has(proof)) return 'invalid'
      const prior = proofs.get(proof)!; proofs.delete(proof)
      const validateStartedAt = trace ? performance.now() : 0
      const decoded = prior === null ? decodePublicV42Root(next)
        : decodePublicV42CheckedSuccessor(prior.root, next)
      reportStorePhase(trace, 'commit', 'validate', validateStartedAt)
      if (!decoded || prior === null && decoded.head.saveRevision !== 0) return 'invalid'
      const cloneStartedAt = trace ? performance.now() : 0
      const candidate = structuredClone(decoded)
      reportStorePhase(trace, 'commit', 'candidate-clone', cloneStartedAt)
      let db: IDBDatabase | undefined
      try {
        const openStartedAt = trace ? performance.now() : 0
        db = await open()
        reportStorePhase(trace, 'commit', 'open', openStartedAt)
        return await new Promise((resolve) => {
          const transactionStartedAt = trace ? performance.now() : 0
          let tx: IDBTransaction
          try { tx = db!.transaction('records', 'readwrite', { durability: 'strict' }) }
          catch (error) {
            if (!(error instanceof TypeError) && !(error instanceof DOMException
              && error.name === 'NotSupportedError')) throw error
            tx = db!.transaction('records', 'readwrite')
          }
          reportStorePhase(trace, 'commit', 'transaction', transactionStartedAt)
          const requestStartedAt = trace ? performance.now() : 0
          const records = tx.objectStore('records'), read = records.get('root')
          const keys = records.getAllKeys()
          let result: 'committed' | 'revision-changed' | 'storage-error' = 'storage-error'
          let completionStartedAt = requestStartedAt
          tx.oncomplete = () => {
            reportStorePhase(trace, 'commit', 'tx-completion', completionStartedAt)
            resolve(result)
          }
          tx.onabort = () => {
            reportStorePhase(trace, 'commit', 'tx-completion', completionStartedAt)
            resolve('storage-error')
          }
          keys.onsuccess = () => {
            reportStorePhase(trace, 'commit', 'request-wait', requestStartedAt)
            const casStartedAt = trace ? performance.now() : 0
            let unchanged = false
            try {
              unchanged = keys.result.length === (prior === null ? 0 : 1)
                && (prior === null || keys.result[0] === 'root'
                  && sameStrictBoundedRaw(read.result, prior.raw, 3 << 20))
            } catch { /* Competing data cannot satisfy the CAS. */ }
            reportStorePhase(trace, 'commit', 'cas', casStartedAt)
            if (!unchanged) {
              result = 'revision-changed'
              completionStartedAt = trace ? performance.now() : 0
              return
            }
            const putStartedAt = trace ? performance.now() : 0
            try { records.put(candidate, 'root'); result = 'committed' }
            catch { tx.abort() }
            reportStorePhase(trace, 'commit', 'put', putStartedAt)
            completionStartedAt = trace ? performance.now() : 0
          }
        })
      } catch { return 'storage-error' }
      finally { db?.close() }
    },
  }
}
