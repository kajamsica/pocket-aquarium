import { decodePublicV12Head, isPublicV12MigrationHead, isValidPublicV12SourceReceipt,
  samePublicV12SourceReceipt } from './publicWorldV12Snapshot'
import type { PublicV12SourceReceipt } from './publicWorldV12Snapshot'

export type AtomicV12Record = { saveRevision: number; value: unknown }
export type AtomicV12Read =
  | { status: 'ok'; head: AtomicV12Record | null; previous: AtomicV12Record | null; lineage: PublicV12SourceReceipt | null }
  | { status: 'storage-error' }
export type AtomicV12Write = 'committed' | 'revision-changed' | 'lineage-changed' | 'invalid' | 'storage-error'

const STORE = 'records'
const knownSlots = (keys: readonly IDBValidKey[]) => keys.every((key) =>
  key === 'head' || key === 'previous' || key === 'lineage')
const validRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
function validRecord(value: unknown): value is AtomicV12Record {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== 2
    || !Object.hasOwn(value, 'saveRevision') || !Object.hasOwn(value, 'value')) return false
  const record = value as AtomicV12Record
  return validRevision(record.saveRevision) && decodePublicV12Head(record.value)?.saveRevision === record.saveRevision
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(new Error('IndexedDB upgrade blocked')) }
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
  })
}

function writeTransaction(db: IDBDatabase): IDBTransaction {
  try { return db.transaction(STORE, 'readwrite', { durability: 'strict' }) }
  catch (error) {
    if (!(error instanceof TypeError)
      && !(error instanceof DOMException && error.name === 'NotSupportedError')) throw error
    return db.transaction(STORE, 'readwrite')
  }
}

/** V12 has its own database; publication never writes older version slots. */
export function createAtomicV12Store(factory: IDBFactory, name = 'wizard-realms:world:v12') {
  return {
    async read(): Promise<AtomicV12Read> {
      let db: IDBDatabase | undefined
      try {
        db = await openDatabase(factory, name)
        return await new Promise<AtomicV12Read>((resolve) => {
          const transaction = db!.transaction(STORE, 'readonly')
          const records = transaction.objectStore(STORE)
          const head = records.get('head')
          const previous = records.get('previous')
          const lineage = records.get('lineage')
          const keys = records.getAllKeys()
          transaction.oncomplete = () => {
            if (!knownSlots(keys.result)) { resolve({ status: 'storage-error' }); return }
            if (keys.result.includes('head') && head.result == null
              || keys.result.includes('previous') && previous.result == null
              || keys.result.includes('lineage') && lineage.result == null) {
              resolve({ status: 'storage-error' }); return
            }
            resolve({ status: 'ok',
              head: head.result ?? null, previous: previous.result ?? null, lineage: lineage.result ?? null })
          }
          transaction.onabort = () => resolve({ status: 'storage-error' })
        })
      } catch { return { status: 'storage-error' } }
      finally { db?.close() }
    },

    async commit(expectedRevision: number | null, expectedLineage: PublicV12SourceReceipt | null,
      next: AtomicV12Record, initialLineage?: PublicV12SourceReceipt): Promise<AtomicV12Write> {
      if (!validRecord(next)) return 'invalid'
      if (expectedRevision === null) {
        if (expectedLineage !== null || !isValidPublicV12SourceReceipt(initialLineage)
          || !isPublicV12MigrationHead(next.value, initialLineage)) return 'invalid'
      } else if (!validRevision(expectedRevision) || !isValidPublicV12SourceReceipt(expectedLineage)
        || initialLineage !== undefined || next.saveRevision !== expectedRevision + 1) return 'invalid'

      let db: IDBDatabase | undefined
      try {
        // Snapshot caller objects before the first asynchronous IndexedDB step.
        const pending = structuredClone({ next, expectedLineage, initialLineage })
        db = await openDatabase(factory, name)
        return await new Promise<AtomicV12Write>((resolve) => {
          const transaction = writeTransaction(db!)
          const records = transaction.objectStore(STORE)
          let result: AtomicV12Write = 'storage-error'
          transaction.oncomplete = () => resolve(result)
          transaction.onabort = () => resolve('storage-error')
          const head = records.get('head')
          const lineage = records.get('lineage')
          const previous = records.get('previous')
          const keys = records.getAllKeys()
          keys.onsuccess = () => {
            if (!knownSlots(keys.result)) { result = 'invalid'; return }
            const prior: unknown = head.result
            const source: unknown = lineage.result
            const hasHead = keys.result.includes('head')
            const hasPrevious = keys.result.includes('previous')
            if (hasHead && !validRecord(prior)) { result = 'invalid'; return }
            if ((hasHead ? (prior as AtomicV12Record).saveRevision : null) !== expectedRevision) {
              result = 'revision-changed'; return
            }
            if (expectedRevision === null ? keys.result.includes('lineage')
              : !samePublicV12SourceReceipt(source, pending.expectedLineage)) {
              result = 'lineage-changed'; return
            }
            if (expectedRevision === null || expectedRevision === 0 ? hasPrevious
              : !validRecord(previous.result) || previous.result.saveRevision !== expectedRevision - 1) {
              result = 'invalid'; return
            }
            try {
              records.put(pending.next, 'head')
              if (prior !== undefined) records.put(prior, 'previous')
              if (expectedRevision === null) records.put(pending.initialLineage, 'lineage')
              result = 'committed'
            } catch { transaction.abort() }
          }
        })
      } catch { return 'storage-error' }
      finally { db?.close() }
    },
  }
}
