import { samePublicV14Value } from './publicWorldV14Validation'
import { PUBLIC_V27_DATABASE_NAME } from './publicWorldV27Migration'
import { decodePublicV27CheckedSuccessor, decodePublicV27Root } from './publicWorldV27Snapshot'
import type { PublicV27Root } from './publicWorldV27Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'
import { exactPublicV23 } from './publicWorldV23Snapshot'

const RAW_CACHE_LIMIT = 2 << 20

export type PublicV27AtomicPhase = 'atomic-candidate-preflight' | 'idb-open'
  | 'cas-read-put' | 'transaction-completion' | 'v27-validated-cache-hit'
export type PublicV27AtomicTiming = (sample: Readonly<{
  phase: PublicV27AtomicPhase; durationMs: number }>) => void
function report(onPhase: PublicV27AtomicTiming | undefined, phase: PublicV27AtomicPhase, startedAt: number) {
  try { if (onPhase) onPhase({ phase, durationMs: performance.now() - startedAt }) }
  catch { /* Diagnostics must not affect checked writes. */ }
}
export type AtomicV27Read = { status: 'missing'; proof: object }
  | { status: 'valid'; root: PublicV27Root; proof: object }
  | { status: 'blocked'; reason: string }
type ValidatedCache = { factory: IDBFactory; name: string; raw: unknown; root: PublicV27Root }
let validatedCache: ValidatedCache | null = null
function preparedCache(factory: IDBFactory, name: string, raw: unknown, root: PublicV27Root): ValidatedCache | null {
  try {
    const detachedRaw = structuredClone(raw)
    return sameStrictBoundedRaw(raw, detachedRaw, RAW_CACHE_LIMIT)
      ? { factory, name, raw: detachedRaw, root: structuredClone(root) } : null
  } catch { return null }
}

/** One exact V27 root record, independent of the pinned V26 source database. */
export function createAtomicV27Store(factory: IDBFactory, name = PUBLIC_V27_DATABASE_NAME) {
  const proofs = new WeakMap<object, PublicV27Root | null>()
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
    async readChecked(onPhase?: PublicV27AtomicTiming): Promise<AtomicV27Read> {
      let db: IDBDatabase | undefined
      try {
        db = await open()
        return await new Promise<AtomicV27Read>((resolve) => {
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
            const root = exactKeys ? hit ? structuredClone(cached!.root) : decodePublicV27Root(value.result) : null
            if (hit && onPhase) report(onPhase, 'v27-validated-cache-hit', performance.now())
            if (!root) {
              validatedCache = null; resolve({ status: 'blocked', reason: 'invalid-v27-root' }); return
            }
            if (!hit) validatedCache = preparedCache(factory, name, value.result, root)
            const proof = {}; proofs.set(proof, structuredClone(root)); resolve({ status: 'valid', root, proof })
          }
        })
      } catch { return { status: 'blocked', reason: 'storage-error' } }
      finally { db?.close() }
    },
    async commit(proof: object, next: PublicV27Root, onPhase?: PublicV27AtomicTiming): Promise<
      'committed' | 'invalid' | 'revision-changed' | 'storage-error'> {
      if (!proofs.has(proof)) return 'invalid'
      const before = proofs.get(proof)!; proofs.delete(proof)
      const preflightStartedAt = onPhase ? performance.now() : 0
      // Checked proofs make the unchanged lineage and previous head reusable. Any
      // noncanonical or altered representation retains the full-decoder path.
      const canonicalSuccessor = before !== null && exactPublicV23(next,
        ['lineage', 'head', 'previous'])
        && sameStrictBoundedRaw(next.lineage, before.lineage, RAW_CACHE_LIMIT)
        && sameStrictBoundedRaw(next.previous, before.head, RAW_CACHE_LIMIT)
      const candidate = canonicalSuccessor
        ? decodePublicV27CheckedSuccessor(before, next) : decodePublicV27Root(next)
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
