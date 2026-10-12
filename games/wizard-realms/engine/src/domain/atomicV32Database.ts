import { samePublicV14Value } from './publicWorldV14Validation'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { PUBLIC_V32_DATABASE_NAME } from './publicWorldV32Migration'
import { decodePublicV32CheckedSuccessor, decodePublicV32Root } from './publicWorldV32Snapshot'
import type { PublicV32Root } from './publicWorldV32Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

const RAW_CACHE_LIMIT = 3 << 20

export type AtomicV32Read = { status: 'missing'; proof: object }
  | { status: 'valid'; root: PublicV32Root; proof: object }
  | { status: 'blocked'; reason: string }
type ValidatedCache = { factory: IDBFactory; name: string; raw: unknown; root: PublicV32Root }
let validatedCache: ValidatedCache | null = null
function preparedCache(factory: IDBFactory, name: string, raw: unknown,
  root: PublicV32Root): ValidatedCache | null {
  try {
    const detachedRaw = structuredClone(raw)
    return sameStrictBoundedRaw(raw, detachedRaw, RAW_CACHE_LIMIT)
      ? { factory, name, raw: detachedRaw, root: structuredClone(root) } : null
  } catch { return null }
}

/** A V32 root is isolated from its pinned, unchanged V31 source. */
export function createAtomicV32Store(factory: IDBFactory, name = PUBLIC_V32_DATABASE_NAME) {
  const proofs = new WeakMap<object, PublicV32Root | null>()
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
    async readChecked(): Promise<AtomicV32Read> {
      let db: IDBDatabase | undefined
      try {
        db = await open()
        return await new Promise<AtomicV32Read>((resolve) => {
          const tx = db!.transaction('records', 'readonly'), records = tx.objectStore('records')
          const value = records.get('root'), keys = records.getAllKeys()
          tx.onabort = () => resolve({ status: 'blocked', reason: 'storage-error' })
          tx.oncomplete = () => {
            if (keys.result.length === 0) {
              validatedCache = null
              const proof = {}; proofs.set(proof, null); resolve({ status: 'missing', proof }); return
            }
            const exactKeys = keys.result.length === 1 && keys.result[0] === 'root'
            const cached = validatedCache?.factory === factory && validatedCache.name === name
              ? validatedCache : null
            const hit = exactKeys && cached !== null
              && sameStrictBoundedRaw(value.result, cached.raw, RAW_CACHE_LIMIT)
            const root = exactKeys ? hit ? structuredClone(cached!.root) : decodePublicV32Root(value.result) : null
            if (!root) {
              validatedCache = null; resolve({ status: 'blocked', reason: 'invalid-v32-root' }); return
            }
            if (!hit) validatedCache = preparedCache(factory, name, value.result, root)
            const proof = {}; proofs.set(proof, structuredClone(root)); resolve({ status: 'valid', root, proof })
          }
        })
      } catch { return { status: 'blocked', reason: 'storage-error' } }
      finally { db?.close() }
    },
    async commit(proof: object, next: PublicV32Root): Promise<
      'committed' | 'invalid' | 'revision-changed' | 'storage-error'> {
      if (!proofs.has(proof)) return 'invalid'
      const before = proofs.get(proof)!; proofs.delete(proof)
      const canonicalSuccessor = before !== null && exactPublicV23(next,
        ['lineage', 'head', 'previous'])
        && sameStrictBoundedRaw(next.lineage, before.lineage, RAW_CACHE_LIMIT)
        && sameStrictBoundedRaw(next.previous, before.head, RAW_CACHE_LIMIT)
      const candidate = canonicalSuccessor
        ? decodePublicV32CheckedSuccessor(before, next) : decodePublicV32Root(next)
      const invalid = !candidate || (before === null ? candidate.head.saveRevision !== 0
        : !samePublicV14Value(before.lineage, candidate.lineage)
          || !samePublicV14Value(before.head, candidate.previous))
      const nextCache = !invalid && candidate ? preparedCache(factory, name, candidate, candidate) : null
      if (invalid) return 'invalid'
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
          const records = tx.objectStore('records'), read = records.get('root'), keys = records.getAllKeys()
          let result: 'committed' | 'invalid' | 'revision-changed' | 'storage-error' = 'storage-error'
          tx.oncomplete = () => { validatedCache = result === 'committed' ? nextCache : null; resolve(result) }
          tx.onabort = () => { validatedCache = null; resolve('storage-error') }
          keys.onsuccess = () => {
            if (keys.result.length !== (before === null ? 0 : 1)
              || before !== null && keys.result[0] !== 'root'
              || !samePublicV14Value(read.result ?? null, before)) {
              result = 'revision-changed'; return
            }
            try { records.put(candidate, 'root'); result = 'committed' } catch { tx.abort() }
          }
        })
      } catch { return 'storage-error' }
      finally { db?.close() }
    },
  }
}
