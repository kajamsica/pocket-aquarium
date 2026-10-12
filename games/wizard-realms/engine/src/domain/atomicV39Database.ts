import { samePublicV14Value } from './publicWorldV14Validation'
import { PUBLIC_V39_DATABASE_NAME, decodePublicV39CheckedSuccessor,
  decodePublicV39Root } from './publicWorldV39Snapshot'
import type { PublicV39Root } from './publicWorldV39Snapshot'

export type AtomicV39Read = { status: 'missing'; proof: object }
  | { status: 'valid'; root: PublicV39Root; proof: object }
  | { status: 'blocked'; reason: string }
type Prior = { raw: unknown; root: PublicV39Root } | null

/** Separate three-slot V39 record; proofs bind one read to one atomic write. */
export function createAtomicV39Store(factory: IDBFactory,
  name = PUBLIC_V39_DATABASE_NAME) {
  const proofs = new WeakMap<object, Prior>()
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
    async readChecked(): Promise<AtomicV39Read> {
      let db: IDBDatabase | undefined
      try {
        db = await open()
        return await new Promise<AtomicV39Read>((resolve) => {
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
              const root = exactKeys ? decodePublicV39Root(value.result) : null
              if (!root) {
                resolve({ status: 'blocked', reason: 'invalid-v39-root' }); return
              }
              const proof = {}
              proofs.set(proof, { raw: value.result, root })
              resolve({ status: 'valid', root: structuredClone(root), proof })
            } catch { resolve({ status: 'blocked', reason: 'invalid-v39-root' }) }
          }
        })
      } catch { return { status: 'blocked', reason: 'storage-error' } }
      finally { db?.close() }
    },
    async commit(proof: object, next: PublicV39Root): Promise<
      'committed' | 'invalid' | 'revision-changed' | 'storage-error'> {
      if (!proofs.has(proof)) return 'invalid'
      const prior = proofs.get(proof)!; proofs.delete(proof)
      const decoded = prior === null ? decodePublicV39Root(next)
        : decodePublicV39CheckedSuccessor(prior.root, next)
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
                  && samePublicV14Value(read.result, prior.raw))
            } catch { /* Malformed competing data cannot satisfy the CAS. */ }
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
