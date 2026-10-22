import { decodePublicV45Root, decodePublicV45SuccessorOfCheckedRoot }
  from './publicWorldV45Snapshot'
import type { PublicV45Root } from './publicWorldV45Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export const PUBLIC_V45_DATABASE_NAME = 'wizard-realms:world:v45'
export type AtomicV45Read = { status: 'missing'; proof: object }
  | { status: 'valid'; root: PublicV45Root; proof: object }
  | { status: 'blocked'; reason: string }
type Prior = { raw: unknown; root: PublicV45Root } | null
type CommitResult = 'committed' | 'invalid' | 'revision-changed' | 'storage-error'
const RAW_LIMIT = 3 << 20

/** A checked read issues one private, single-use proof for the next root CAS. */
export function createAtomicV45Store(factory: IDBFactory,
  name = PUBLIC_V45_DATABASE_NAME) {
  const proofs = new WeakMap<object, Prior>()
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = factory.open(name, 1)
      let blocked = false
      request.onupgradeneeded = (event) => {
        if (event.oldVersion !== 0) { request.transaction?.abort(); return }
        request.result.createObjectStore('records')
      }
      request.onblocked = () => {
        blocked = true
        reject(new Error('Database blocked'))
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        if (blocked) request.result.close()
        else resolve(request.result)
      }
    })
  }
  const exactStore = (db: IDBDatabase) => db.version === 1
    && db.objectStoreNames.length === 1 && db.objectStoreNames[0] === 'records'
  return {
    async readChecked(): Promise<AtomicV45Read> {
      let db: IDBDatabase | undefined
      try {
        db = await open()
        if (!exactStore(db)) return { status: 'blocked', reason: 'invalid-v45-records' }
        return await new Promise<AtomicV45Read>((resolve) => {
          const tx = db!.transaction('records', 'readonly')
          const records = tx.objectStore('records')
          const value = records.get('root'), keys = records.getAllKeys()
          tx.onabort = () => resolve({ status: 'blocked', reason: 'storage-error' })
          tx.oncomplete = () => {
            try {
              if (keys.result.length === 0) {
                const proof = {}; proofs.set(proof, null)
                resolve({ status: 'missing', proof }); return
              }
              const raw = value.result
              const root = keys.result.length === 1 && keys.result[0] === 'root'
                && sameStrictBoundedRaw(raw, raw, RAW_LIMIT)
                ? decodePublicV45Root(raw) : null
              if (!root || !sameStrictBoundedRaw(raw, root, RAW_LIMIT)) {
                resolve({ status: 'blocked', reason: 'invalid-v45-root' }); return
              }
              const proof = {}
              proofs.set(proof, { raw, root })
              resolve({ status: 'valid', root: structuredClone(root), proof })
            } catch { resolve({ status: 'blocked', reason: 'invalid-v45-root' }) }
          }
        })
      } catch { return { status: 'blocked', reason: 'storage-error' } }
      finally { db?.close() }
    },
    async commit(proof: object, next: PublicV45Root): Promise<CommitResult> {
      if (!proofs.has(proof)) return 'invalid'
      const prior = proofs.get(proof)!; proofs.delete(proof)
      if (!sameStrictBoundedRaw(next, next, RAW_LIMIT)) return 'invalid'
      const decoded = prior === null ? decodePublicV45Root(next)
        : decodePublicV45SuccessorOfCheckedRoot(prior.root, next)
      if (!decoded || prior === null && decoded.head.saveRevision !== 0) return 'invalid'
      let candidate: PublicV45Root
      try {
        candidate = structuredClone(decoded)
        if (!sameStrictBoundedRaw(candidate, decoded, RAW_LIMIT)) return 'invalid'
      } catch { return 'invalid' }
      let db: IDBDatabase | undefined
      try {
        db = await open()
        if (!exactStore(db)) return 'storage-error'
        return await new Promise<CommitResult>((resolve) => {
          let tx: IDBTransaction
          try { tx = db!.transaction('records', 'readwrite', { durability: 'strict' }) }
          catch (error) {
            if (!(error instanceof TypeError) && !(error instanceof DOMException
              && error.name === 'NotSupportedError')) throw error
            tx = db!.transaction('records', 'readwrite')
          }
          const records = tx.objectStore('records'), read = records.get('root')
          const keys = records.getAllKeys()
          let result: CommitResult = 'storage-error'
          tx.oncomplete = () => resolve(result)
          tx.onabort = () => resolve('storage-error')
          keys.onsuccess = () => {
            let matches = false
            try {
              matches = keys.result.length === (prior === null ? 0 : 1)
                && (prior === null || keys.result[0] === 'root'
                  && sameStrictBoundedRaw(read.result, prior.raw, RAW_LIMIT))
            } catch { /* A changed record cannot satisfy the proof. */ }
            if (!matches) { result = 'revision-changed'; return }
            try { records.put(candidate, 'root'); result = 'committed' }
            catch { tx.abort() }
          }
        })
      } catch { return 'storage-error' }
      finally { db?.close() }
    },
  }
}
