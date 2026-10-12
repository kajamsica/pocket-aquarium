import { decodePublicV11Head } from './publicWorldV11Snapshot'
import { decodePublicV12Head, isValidatedPublicV12MigrationState, isValidPublicV12SourceReceipt,
  samePublicV12SourceReceipt } from './publicWorldV12Snapshot'
import type { PublicV12SourceReceipt } from './publicWorldV12Snapshot'

export type AtomicV12Record = { saveRevision: number; value: unknown }
export type AtomicV12Read =
  | { status: 'ok'; head: AtomicV12Record | null; previous: AtomicV12Record | null; lineage: PublicV12SourceReceipt | null }
  | { status: 'storage-error' }
export type AtomicV12Write = 'committed' | 'revision-changed' | 'lineage-changed' | 'invalid' | 'storage-error'
export type AtomicV12CheckedRead =
  | { status: 'storage-error' }
  | Extract<AtomicV12Read, { status: 'ok' }> & {
    decodedHead: ReturnType<typeof decodePublicV12Head>
    decodedPrevious: ReturnType<typeof decodePublicV12Head>
    lineageValid: boolean
    proof: object | null
  }
type ValidatedRead = {
  raw: Extract<AtomicV12Read, { status: 'ok' }>
  decodedHead: ReturnType<typeof decodePublicV12Head>
  decodedPrevious: ReturnType<typeof decodePublicV12Head>
  lineageValid: boolean
}

const STORE = 'records'
const knownSlots = (keys: readonly IDBValidKey[]) => keys.every((key) =>
  key === 'head' || key === 'previous' || key === 'lineage')
const validRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
function decodeRecord(value: unknown): ReturnType<typeof decodePublicV12Head> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== 2
    || !Object.hasOwn(value, 'saveRevision') || !Object.hasOwn(value, 'value')) return null
  const record = value as AtomicV12Record
  if (!validRevision(record.saveRevision)) return null
  const decoded = decodePublicV12Head(record.value)
  return decoded?.saveRevision === record.saveRevision ? decoded : null
}

/** Exact structural equality for detached IndexedDB values, including every typed-mask byte. */
function sameStoredValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array && b instanceof Uint8Array) || a.length !== b.length) return false
  } else if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object'
    || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  const left = a as Record<PropertyKey, unknown>
  const right = b as Record<PropertyKey, unknown>
  const keys = Reflect.ownKeys(left)
  return keys.length === Reflect.ownKeys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && sameStoredValue(left[key], right[key]))
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
  const proofs = new WeakMap<object, ValidatedRead>()
  let cache: ValidatedRead | null = null
  async function readRecords(): Promise<AtomicV12Read> {
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
  }

  return {
    read: readRecords,
    async readChecked(): Promise<AtomicV12CheckedRead> {
      const read = await readRecords()
      if (read.status !== 'ok') { cache = null; return read }
      // A cache hit is permitted only after a fresh slot read matches every stored byte.
      if (cache && sameStoredValue(read, cache.raw)) {
        const proof = Object.freeze({})
        proofs.set(proof, cache)
        return { ...read, decodedHead: structuredClone(cache.decodedHead),
          decodedPrevious: structuredClone(cache.decodedPrevious),
          lineageValid: cache.lineageValid, proof }
      }
      cache = null
      const decodedHead = read.head === null ? null : decodeRecord(read.head)
      const decodedPrevious = read.previous === null ? null : decodeRecord(read.previous)
      const missing = read.head === null && read.previous === null && read.lineage === null
      const lineageValid = decodedHead !== null && isValidPublicV12SourceReceipt(read.lineage)
      const valid = missing || decodedHead !== null && lineageValid
        && (decodedHead.saveRevision === 0 ? read.previous === null
          : decodedPrevious !== null && decodedPrevious.saveRevision === decodedHead.saveRevision - 1)
      const proof = valid ? Object.freeze({}) : null
      if (proof) {
        cache = { raw: structuredClone(read), decodedHead: structuredClone(decodedHead),
          decodedPrevious: structuredClone(decodedPrevious), lineageValid }
        proofs.set(proof, cache)
      }
      return { ...read, decodedHead, decodedPrevious, lineageValid, proof }
    },

    async commit(expectedRevision: number | null, expectedLineage: PublicV12SourceReceipt | null,
      next: AtomicV12Record, initialLineage?: PublicV12SourceReceipt,
      proof?: object): Promise<AtomicV12Write> {
      const snapshot = proof === undefined ? undefined : proofs.get(proof)
      cache = null
      if (proof !== undefined && !snapshot) return 'invalid'
      if (proof) proofs.delete(proof)
      if (snapshot && (snapshot.raw.head?.saveRevision ?? null) !== expectedRevision) return 'invalid'
      let pending: { next: AtomicV12Record; expectedLineage: PublicV12SourceReceipt | null;
        initialLineage: PublicV12SourceReceipt | undefined }
      try { pending = structuredClone({ next, expectedLineage, initialLineage }) }
      catch {
        try { return decodeRecord(next) ? 'storage-error' : 'invalid' }
        catch { return 'invalid' }
      }
      const decodedNext = decodeRecord(pending.next)
      if (!decodedNext) return 'invalid'
      if (expectedRevision === null) {
        if (pending.expectedLineage !== null || !isValidPublicV12SourceReceipt(pending.initialLineage)
          || snapshot && (snapshot.raw.head !== null || snapshot.raw.previous !== null
            || snapshot.raw.lineage !== null)
          || !isValidatedPublicV12MigrationState(decodedNext,
            decodePublicV11Head(pending.initialLineage.sourceV11Head)!)) return 'invalid'
      } else if (!validRevision(expectedRevision)
        || !(snapshot ? sameStoredValue(pending.expectedLineage, snapshot.raw.lineage)
          : isValidPublicV12SourceReceipt(pending.expectedLineage))
        || pending.initialLineage !== undefined || pending.next.saveRevision !== expectedRevision + 1) return 'invalid'

      let db: IDBDatabase | undefined
      try {
        const detachedNext = snapshot ? structuredClone(decodedNext) : null
        db = await openDatabase(factory, name)
        const result = await new Promise<AtomicV12Write>((resolve) => {
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
            if (hasHead && (snapshot
              ? !sameStoredValue(prior, snapshot.raw.head) : !decodeRecord(prior))) {
              const changed = snapshot ? decodeRecord(prior) : null
              result = changed && changed.saveRevision !== expectedRevision
                ? 'revision-changed' : 'invalid'
              return
            }
            if ((hasHead ? (prior as AtomicV12Record).saveRevision : null) !== expectedRevision) {
              result = 'revision-changed'; return
            }
            if (expectedRevision === null ? keys.result.includes('lineage')
              : snapshot ? !sameStoredValue(source, snapshot.raw.lineage)
                : !samePublicV12SourceReceipt(source, pending.expectedLineage)) {
              result = 'lineage-changed'; return
            }
            if (expectedRevision === null || expectedRevision === 0 ? hasPrevious
              : snapshot ? !sameStoredValue(previous.result, snapshot.raw.previous)
                : !decodeRecord(previous.result)
                  || previous.result.saveRevision !== expectedRevision - 1) {
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
        cache = result === 'committed' && snapshot
          ? { raw: { status: 'ok', head: pending.next, previous: snapshot.raw.head,
            lineage: expectedRevision === null ? pending.initialLineage! : snapshot.raw.lineage },
            decodedHead: detachedNext, decodedPrevious: snapshot.decodedHead, lineageValid: true }
          : null
        return result
      } catch { cache = null; return 'storage-error' }
      finally { db?.close() }
    },
  }
}
