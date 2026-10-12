import { samePublicV14Value } from './publicWorldV14Validation'
import { PUBLIC_V25_DATABASE_NAME } from './publicWorldV25Migration'
import { decodePublicV25Root } from './publicWorldV25Snapshot'
import type { PublicV25Root } from './publicWorldV25Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export type PublicV25AtomicPhase = 'atomic-candidate-preflight' | 'idb-open'
  | 'cas-read-put' | 'transaction-completion' | 'v25-validated-cache-hit'
export type PublicV25AtomicTiming = (sample: Readonly<{
  phase: PublicV25AtomicPhase; durationMs: number }>) => void
function report(onPhase: PublicV25AtomicTiming | undefined, phase: PublicV25AtomicPhase, startedAt: number) {
  try { if (onPhase) onPhase({ phase, durationMs: performance.now() - startedAt }) }
  catch { /* Diagnostics must not affect checked writes. */ }
}
export type AtomicV25Read = { status: 'missing'; proof: object }
  | { status: 'valid'; root: PublicV25Root; proof: object }
  | { status: 'blocked'; reason: string }
type ValidatedCache = { factory: IDBFactory; name: string; raw: unknown; root: PublicV25Root }
let validatedCache: ValidatedCache | null = null
function preparedCache(factory: IDBFactory, name: string, raw: unknown, root: PublicV25Root): ValidatedCache | null {
  try {
    const detachedRaw = structuredClone(raw)
    return sameStrictBoundedRaw(raw, detachedRaw)
      ? { factory, name, raw: detachedRaw, root: structuredClone(root) } : null
  } catch { return null }
}

/** One exact V25 root record, independent of the pinned V24 source database. */
export function createAtomicV25Store(factory: IDBFactory, name = PUBLIC_V25_DATABASE_NAME) {
  const proofs = new WeakMap<object, PublicV25Root | null>()
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
    async readChecked(onPhase?: PublicV25AtomicTiming): Promise<AtomicV25Read> {
      let db: IDBDatabase | undefined
      try {
        db = await open()
        return await new Promise<AtomicV25Read>((resolve) => {
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
            const hit = exactKeys && cached !== null && sameStrictBoundedRaw(value.result, cached.raw)
            const root = exactKeys ? hit ? structuredClone(cached!.root) : decodePublicV25Root(value.result) : null
            if (hit && onPhase) report(onPhase, 'v25-validated-cache-hit', performance.now())
            if (!root) {
              validatedCache = null; resolve({ status: 'blocked', reason: 'invalid-v25-root' }); return
            }
            if (!hit) validatedCache = preparedCache(factory, name, value.result, root)
            const proof = {}; proofs.set(proof, structuredClone(root)); resolve({ status: 'valid', root, proof })
          }
        })
      } catch { return { status: 'blocked', reason: 'storage-error' } }
      finally { db?.close() }
    },
    async commit(proof: object, next: PublicV25Root, onPhase?: PublicV25AtomicTiming): Promise<
      'committed' | 'invalid' | 'revision-changed' | 'storage-error'> {
      if (!proofs.has(proof)) return 'invalid'
      const before = proofs.get(proof)!; proofs.delete(proof)
      const preflightStartedAt = onPhase ? performance.now() : 0
      const candidate = decodePublicV25Root(next)
      const invalid = !candidate || (before === null ? candidate.head.saveRevision !== 0
        : !samePublicV14Value(before.lineage, candidate.lineage)
          || !samePublicV14Value(before.head, candidate.previous))
      const nextCache = !invalid && candidate ? preparedCache(factory, name, candidate, candidate) : null
      report(onPhase, 'atomic-candidate-preflight', preflightStartedAt)
      if (invalid) return 'invalid'
      let db: IDBDatabase | undefined
      try {
        const openStartedAt = onPhase ? performance.now() : 0
        db = await open()
        report(onPhase, 'idb-open', openStartedAt)
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
          const casStartedAt = onPhase ? performance.now() : 0; let completionStartedAt = casStartedAt
          const finishCas = () => {
            report(onPhase, 'cas-read-put', casStartedAt)
            completionStartedAt = onPhase ? performance.now() : 0
          }
          tx.oncomplete = () => {
            report(onPhase, 'transaction-completion', completionStartedAt)
            validatedCache = result === 'committed' ? nextCache : null; resolve(result)
          }
          tx.onabort = () => {
            report(onPhase, 'transaction-completion', completionStartedAt)
            validatedCache = null; resolve('storage-error')
          }
          keys.onsuccess = () => {
            if (keys.result.length !== (before === null ? 0 : 1)
              || before !== null && keys.result[0] !== 'root'
              || !samePublicV14Value(read.result ?? null, before)) {
              result = 'revision-changed'; finishCas(); return
            }
            try { records.put(candidate, 'root'); result = 'committed' } catch { tx.abort() }
            finishCas()
          }
        })
      } catch { return 'storage-error' }
      finally { db?.close() }
    },
  }
}
