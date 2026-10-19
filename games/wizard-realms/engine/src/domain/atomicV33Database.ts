import { samePublicV14Value } from './publicWorldV14Validation'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { PUBLIC_V33_DATABASE_NAME } from './publicWorldV33Migration'
import { decodePublicV33CheckedSuccessor, decodePublicV33Root } from './publicWorldV33Snapshot'
import type { PublicV33Root } from './publicWorldV33Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

const RAW_CACHE_LIMIT = 3 << 20

export type AtomicV33Read = { status: 'missing'; proof: object }
  | { status: 'valid'; root: PublicV33Root; proof: object }
  | { status: 'blocked'; reason: string }
export type AtomicV33RawSourceRead = { status: 'missing' }
  | { status: 'valid'; raw: unknown }
  | { status: 'blocked'; reason: string }
type ValidatedCache = { factory: IDBFactory; name: string; raw: unknown; root: PublicV33Root }
let validatedCache: ValidatedCache | null = null
function sameRecordEnvelope(left: unknown, right: unknown, keys: readonly string[]): boolean {
  try {
    if (!exactPublicV23(left, keys) || !exactPublicV23(right, keys)
      || Object.isExtensible(left) !== Object.isExtensible(right)) return false
    return keys.every((key) => {
      const a = Object.getOwnPropertyDescriptor(left, key)!
      const b = Object.getOwnPropertyDescriptor(right, key)!
      return a.enumerable === b.enumerable && a.configurable === b.configurable
        && a.writable === b.writable
    })
  } catch { return false }
}

/** Pairwise checks retain cross-slot alias detection below the raw comparison cap. */
function sameCheckedLineage(left: PublicV33Root['lineage'],
  right: PublicV33Root['lineage']): boolean {
  try {
    if (!sameRecordEnvelope(left, right, ['origin', 'seed', 'rulesProfile', 'sourceReceipt'])
      || !sameStrictBoundedRaw(left.origin, right.origin, RAW_CACHE_LIMIT)
      || !sameStrictBoundedRaw(left.seed, right.seed, RAW_CACHE_LIMIT)
      || !sameStrictBoundedRaw(left.rulesProfile, right.rulesProfile, RAW_CACHE_LIMIT)
      || !sameRecordEnvelope(left.sourceReceipt, right.sourceReceipt,
        ['lineage', 'head', 'previous'])) return false
    const a = left.sourceReceipt, b = right.sourceReceipt
    return sameStrictBoundedRaw([a.lineage, a.head], [b.lineage, b.head], RAW_CACHE_LIMIT)
      && sameStrictBoundedRaw([a.lineage, a.previous],
        [b.lineage, b.previous], RAW_CACHE_LIMIT)
      && sameStrictBoundedRaw([a.head, a.previous],
        [b.head, b.previous], RAW_CACHE_LIMIT)
  } catch { return false }
}

function preparedCache(factory: IDBFactory, name: string, raw: unknown,
  root: PublicV33Root): ValidatedCache | null {
  try {
    if (!sameStrictBoundedRaw(raw, raw, RAW_CACHE_LIMIT)) return null
    const detachedRaw = structuredClone(raw)
    return sameStrictBoundedRaw(raw, detachedRaw, RAW_CACHE_LIMIT)
      ? { factory, name, raw: detachedRaw, root: structuredClone(root) } : null
  } catch { return null }
}

/** A V33 root is isolated from its pinned, unchanged V32 source. */
export function createAtomicV33Store(factory: IDBFactory, name = PUBLIC_V33_DATABASE_NAME) {
  const proofs = new WeakMap<object, PublicV33Root | null>()
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
    /** One native IDB value, with no V33 decode, cache copy, or commit proof. */
    async readRawSourceEnvelope(): Promise<AtomicV33RawSourceRead> {
      let db: IDBDatabase | undefined
      try {
        db = await open()
        return await new Promise<AtomicV33RawSourceRead>((resolve) => {
          const tx = db!.transaction('records', 'readonly'), records = tx.objectStore('records')
          const value = records.get('root'), keys = records.getAllKeys()
          tx.onabort = () => resolve({ status: 'blocked', reason: 'storage-error' })
          tx.oncomplete = () => resolve(keys.result.length === 0 ? { status: 'missing' }
            : keys.result.length === 1 && keys.result[0] === 'root'
              ? { status: 'valid', raw: value.result }
              : { status: 'blocked', reason: 'invalid-v33-root' })
        })
      } catch { return { status: 'blocked', reason: 'storage-error' } }
      finally { db?.close() }
    },
    async readChecked(): Promise<AtomicV33Read> {
      let db: IDBDatabase | undefined
      try {
        db = await open()
        return await new Promise<AtomicV33Read>((resolve) => {
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
            const root = exactKeys ? hit ? structuredClone(cached!.root) : decodePublicV33Root(value.result) : null
            if (!root) {
              validatedCache = null; resolve({ status: 'blocked', reason: 'invalid-v33-root' }); return
            }
            if (!hit) validatedCache = preparedCache(factory, name, value.result, root)
            const proof = {}; proofs.set(proof, structuredClone(root)); resolve({ status: 'valid', root, proof })
          }
        })
      } catch { return { status: 'blocked', reason: 'storage-error' } }
      finally { db?.close() }
    },
    async commit(proof: object, next: PublicV33Root): Promise<
      'committed' | 'invalid' | 'revision-changed' | 'storage-error'> {
      if (!proofs.has(proof)) return 'invalid'
      const before = proofs.get(proof)!; proofs.delete(proof)
      let candidate: PublicV33Root | null
      if (before === null) candidate = decodePublicV33Root(next)
      else if (sameRecordEnvelope(next, before,
        ['lineage', 'head', 'previous'])
        && sameCheckedLineage(next.lineage, before.lineage)
        && sameStrictBoundedRaw(next.previous, before.head, RAW_CACHE_LIMIT)) {
        const source = next.lineage.sourceReceipt, pinned = before.lineage.sourceReceipt
        const detached = (['lineage', 'head', 'previous'] as const).every((slot) =>
          sameStrictBoundedRaw([source[slot], next.previous],
            [pinned[slot], before.head], RAW_CACHE_LIMIT))
        candidate = detached ? decodePublicV33CheckedSuccessor(before, next) : null
      } else candidate = null
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
