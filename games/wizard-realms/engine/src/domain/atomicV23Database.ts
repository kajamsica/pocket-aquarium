import { samePublicV14Value } from './publicWorldV14Validation'
import { preservesPublicV13History } from './publicV13History'
import { preservesPublicV17GreenwayWorks } from './publicWorldV17Validation'
import { createPublicV23Root, decodePublicV23Head, decodePublicV23Lineage,
  exactPublicV23, PUBLIC_V23_DATABASE_NAME, replayPublicV23Transition } from './publicWorldV23Snapshot'
import type { PublicV23Head, PublicV23Lineage } from './publicWorldV23Snapshot'

export type AtomicV23Root = Readonly<{ lineage: PublicV23Lineage; head: PublicV23Head; previous: PublicV23Head | null }>
export type AtomicV23Read = { status: 'missing'; proof: object }
  | { status: 'valid'; root: AtomicV23Root; proof: object }
  | { status: 'blocked'; reason: string }

function decodeRoot(value: unknown): AtomicV23Root | null {
  if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
  const lineage = decodePublicV23Lineage(value.lineage)
  const head = lineage && decodePublicV23Head(value.head, lineage)
  if (!lineage || !head) return null
  const previous = value.previous === null ? null : decodePublicV23Head(value.previous, lineage)
  if (head.saveRevision === 0 ? value.previous !== null
    : !previous || !replayPublicV23Transition(previous, head)) return null
  const genesis = createPublicV23Root(lineage.seed, lineage.sourceReceipt).head
  const preserves = (prior: PublicV23Head, next: PublicV23Head) =>
    preservesPublicV13History(prior.state as never, next.state as never)
    && preservesPublicV17GreenwayWorks(prior.greenwayWorks, next.greenwayWorks, lineage.seed)
    && prior.regionalWorks.builtLadderIds.every((id) => next.regionalWorks.builtLadderIds.includes(id))
  return preserves(genesis, head) && (!previous || preserves(genesis, previous))
    ? { lineage, head, previous } : null
}

/** One root record atomically holds lineage, head, and predecessor in the V23 database. */
export function createAtomicV23Store(factory: IDBFactory, name = PUBLIC_V23_DATABASE_NAME) {
  const proofs = new WeakMap<object, unknown>()
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
    async readChecked(): Promise<AtomicV23Read> {
      let db: IDBDatabase | undefined
      try {
        db = await open()
        return await new Promise<AtomicV23Read>((resolve) => {
          const tx = db!.transaction('records', 'readonly'), records = tx.objectStore('records')
          const value = records.get('root'), keys = records.getAllKeys()
          tx.onabort = () => resolve({ status: 'blocked', reason: 'storage-error' })
          tx.oncomplete = () => {
            if (keys.result.length === 0) {
              const proof = {}; proofs.set(proof, null); resolve({ status: 'missing', proof }); return
            }
            const root = keys.result.length === 1 && keys.result[0] === 'root' ? decodeRoot(value.result) : null
            if (!root) { resolve({ status: 'blocked', reason: 'invalid-v23-root' }); return }
            const proof = {}; proofs.set(proof, structuredClone(root)); resolve({ status: 'valid', root, proof })
          }
        })
      } catch { return { status: 'blocked', reason: 'storage-error' } }
      finally { db?.close() }
    },
    async commit(proof: object, next: AtomicV23Root): Promise<'committed' | 'invalid' | 'revision-changed' | 'storage-error'> {
      if (!proofs.has(proof)) return 'invalid'
      const before = proofs.get(proof) as AtomicV23Root | null; proofs.delete(proof)
      const candidate = decodeRoot(next)
      if (!candidate || (before === null ? candidate.head.saveRevision !== 0
        : !samePublicV14Value(before.lineage, candidate.lineage)
          || !samePublicV14Value(before.head, candidate.previous))) return 'invalid'
      let db: IDBDatabase | undefined
      try {
        db = await open()
        return await new Promise((resolve) => {
          let tx: IDBTransaction
          try { tx = db!.transaction('records', 'readwrite', { durability: 'strict' }) }
          catch (error) {
            if (!(error instanceof TypeError) && !(error instanceof DOMException && error.name === 'NotSupportedError')) throw error
            tx = db!.transaction('records', 'readwrite')
          }
          const records = tx.objectStore('records'), read = records.get('root'), keys = records.getAllKeys()
          let result: 'committed' | 'invalid' | 'revision-changed' | 'storage-error' = 'storage-error'
          tx.oncomplete = () => resolve(result)
          tx.onabort = () => resolve('storage-error')
          keys.onsuccess = () => {
            if (keys.result.length !== (before === null ? 0 : 1)
              || before !== null && keys.result[0] !== 'root'
              || !samePublicV14Value(read.result ?? null, before)) { result = 'revision-changed'; return }
            try { records.put(candidate, 'root'); result = 'committed' } catch { tx.abort() }
          }
        })
      } catch { return 'storage-error' }
      finally { db?.close() }
    },
  }
}
