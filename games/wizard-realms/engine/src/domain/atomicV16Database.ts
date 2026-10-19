import { isValidDiscoveryMask } from './discoveryMask'
import { preservesPublicV13History } from './publicV13History'
import { createFreshPublicV16Head, decodePublicV16Head, decodePublicV16Lineage,
  PUBLIC_V16_DATABASE_NAME, PUBLIC_V16_SCHEMA } from './publicWorldV16Snapshot'
import type { PublicV16Head, PublicV16Lineage } from './publicWorldV16Snapshot'
import { mapValidatedV15ToV16Start } from './publicWorldV16Migration'
import { preservesPublicV16GreenwayWorks } from './publicWorldV16Validation'

export type AtomicV16Record = { saveRevision: number; value: unknown }
export type AtomicV16Read =
  | { status: 'ok'; head: unknown | null; previous: unknown | null; lineage: unknown | null }
  | { status: 'storage-error' }
export type AtomicV16CheckedRead = AtomicV16Read & {
  decodedHead?: PublicV16Head | null; decodedPrevious?: PublicV16Head | null
  decodedLineage?: PublicV16Lineage | null; proof?: object | null
}
export type AtomicV16Write = 'committed' | 'revision-changed' | 'lineage-changed'
  | 'invalid' | 'storage-error'

const STORE = 'records'
const validRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0
const knownSlots = (keys: readonly IDBValidKey[]) => keys.every((key) =>
  key === 'head' || key === 'previous' || key === 'lineage')
function captureRecord(value: unknown): AtomicV16Record | null {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) return null
    const keys = Reflect.ownKeys(value)
    if (keys.length !== 2 || !keys.includes('saveRevision') || !keys.includes('value')) return null
    const revision = Object.getOwnPropertyDescriptor(value, 'saveRevision')
    const data = Object.getOwnPropertyDescriptor(value, 'value')
    return revision?.enumerable && Object.hasOwn(revision, 'value')
      && data?.enumerable && Object.hasOwn(data, 'value') && validRevision(revision.value)
      ? { saveRevision: revision.value, value: data.value } : null
  } catch { return null }
}
function decodeRecord(value: unknown, lineage: PublicV16Lineage | null): PublicV16Head | null {
  const record = captureRecord(value)
  if (!record || !lineage) return null
  const head = decodePublicV16Head(record.value, lineage)
  return head?.saveRevision === record.saveRevision ? head : null
}
function genesisFor(lineage: PublicV16Lineage): PublicV16Head | null {
  try {
    if (lineage.origin === 'fresh') return createFreshPublicV16Head(lineage.seed).head
    const mapped = mapValidatedV15ToV16Start({ ...lineage.sourceReceipt, bootstrap: null })
    return mapped ? decodePublicV16Head({ schemaVersion: PUBLIC_V16_SCHEMA,
      saveRevision: 0, bootstrap: null, state: mapped.state,
      greenwayWorks: mapped.greenwayWorks }, lineage) : null
  } catch { return null }
}
function preservesHistory(before: PublicV16Head, after: PublicV16Head,
  seed: string): boolean {
  return preservesPublicV13History(before.state as never, after.state as never)
    && preservesPublicV16GreenwayWorks(before.greenwayWorks, after.greenwayWorks, seed)
}

/** Descriptor and byte equality for the raw proof and each transaction's observed slots. */
function sameRaw(a: unknown, b: unknown): boolean {
  try {
    const pending: [unknown, unknown][] = [[a, b]]
    let visited = 0
    while (pending.length) {
      if (++visited > 100_000) return false
      const [left, right] = pending.pop()!
      if (Object.is(left, right)) continue
      if (typeof left !== typeof right || left === null || right === null
        || typeof left !== 'object' || typeof right !== 'object') return false
      if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
        if (!isValidDiscoveryMask(left) || !isValidDiscoveryMask(right)
          || left.byteOffset !== right.byteOffset
          || left.buffer.byteLength !== right.buffer.byteLength
          || left.length !== right.length) return false
        for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false
        continue
      }
      if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false
      const keys = Reflect.ownKeys(left), other = Reflect.ownKeys(right)
      if (keys.length !== other.length) return false
      for (let index = 0; index < keys.length; index++) {
        if (keys[index] !== other[index]) return false
        const l = Object.getOwnPropertyDescriptor(left, keys[index])
        const r = Object.getOwnPropertyDescriptor(right, keys[index])
        if (!l || !r || !Object.hasOwn(l, 'value') || !Object.hasOwn(r, 'value')
          || l.enumerable !== r.enumerable || l.configurable !== r.configurable
          || l.writable !== r.writable) return false
        pending.push([l.value, r.value])
      }
    }
    return true
  } catch { return false }
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(new Error('IndexedDB upgrade blocked')) }
    request.onsuccess = () => blocked ? request.result.close() : resolve(request.result)
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

/** An independent v16 root. Migration source authentication belongs to the checked flow. */
export function createAtomicV16Store(factory: IDBFactory, name = PUBLIC_V16_DATABASE_NAME) {
  type Ok = Extract<AtomicV16Read, { status: 'ok' }>
  const proofs = new WeakMap<object, { snapshot: Ok; issued: AtomicV16CheckedRead }>()
  async function readRecords(): Promise<AtomicV16Read> {
    let db: IDBDatabase | undefined
    try {
      db = await openDatabase(factory, name)
      return await new Promise<AtomicV16Read>((resolve) => {
        const transaction = db!.transaction(STORE, 'readonly')
        const records = transaction.objectStore(STORE)
        const head = records.get('head'), previous = records.get('previous')
        const lineage = records.get('lineage'), keys = records.getAllKeys()
        transaction.oncomplete = () => {
          if (!knownSlots(keys.result)
            || keys.result.includes('head') && head.result == null
            || keys.result.includes('previous') && previous.result == null
            || keys.result.includes('lineage') && lineage.result == null) {
            resolve({ status: 'storage-error' }); return
          }
          resolve({ status: 'ok', head: head.result ?? null,
            previous: previous.result ?? null, lineage: lineage.result ?? null })
        }
        transaction.onabort = () => resolve({ status: 'storage-error' })
      })
    } catch { return { status: 'storage-error' } }
    finally { db?.close() }
  }
  function take(proof: object): Ok | null {
    const issued = proofs.get(proof)
    proofs.delete(proof)
    const snapshot = issued?.snapshot
    return snapshot && issued.issued.status === 'ok'
      && sameRaw(snapshot.head, issued.issued.head)
      && sameRaw(snapshot.previous, issued.issued.previous)
      && sameRaw(snapshot.lineage, issued.issued.lineage) ? snapshot : null
  }
  return {
    read: readRecords,
    async readChecked(): Promise<AtomicV16CheckedRead> {
      const raw = await readRecords()
      if (raw.status !== 'ok') return raw
      const missing = raw.head === null && raw.previous === null && raw.lineage === null
      const decodedLineage = raw.lineage === null ? null : decodePublicV16Lineage(raw.lineage)
      const decodedHead = raw.head === null ? null : decodeRecord(raw.head, decodedLineage)
      const decodedPrevious = raw.previous === null ? null : decodeRecord(raw.previous, decodedLineage)
      let valid = missing
      if (decodedHead && decodedLineage) {
        const genesis = genesisFor(decodedLineage)
        valid = !!genesis && (decodedHead.saveRevision === 0 ? raw.previous === null
          : !!decodedPrevious && decodedPrevious.saveRevision === decodedHead.saveRevision - 1
            && preservesHistory(decodedPrevious, decodedHead, decodedLineage.seed))
        valid = valid && !!genesis && preservesHistory(genesis, decodedHead,
          decodedLineage.seed)
      }
      const proof = valid ? Object.freeze({}) : null
      const checked = { ...raw, decodedHead, decodedPrevious, decodedLineage, proof }
      if (proof) proofs.set(proof, { snapshot: structuredClone(raw), issued: checked })
      return checked
    },
    async commit(expectedRevision: number | null, expectedLineage: unknown,
      next: AtomicV16Record, initialLineage: unknown, proof: object): Promise<AtomicV16Write> {
      const snapshot = take(proof)
      if (!snapshot || (snapshot.head === null ? null
        : captureRecord(snapshot.head)?.saveRevision) !== expectedRevision) return 'invalid'
      const captured = captureRecord(next)
      const lineage = decodePublicV16Lineage(expectedRevision === null
        ? initialLineage : expectedLineage)
      if (!captured || !lineage) return 'invalid'
      if (expectedRevision === null) {
        if (expectedLineage !== null || snapshot.head !== null || snapshot.previous !== null
          || snapshot.lineage !== null || captured.saveRevision !== 0) return 'invalid'
      } else if (!validRevision(expectedRevision) || !Number.isSafeInteger(expectedRevision + 1)
        || initialLineage !== undefined || !sameRaw(lineage, snapshot.lineage)
        || captured.saveRevision !== expectedRevision + 1) return 'invalid'
      const decoded = decodeRecord(captured, lineage)
      if (!decoded) return 'invalid'
      if (expectedRevision !== null) {
        const prior = decodeRecord(snapshot.head, lineage)
        if (!prior || !preservesHistory(prior, decoded, lineage.seed)) return 'invalid'
      }
      const pending = { saveRevision: decoded.saveRevision, value: decoded }
      let db: IDBDatabase | undefined
      try {
        db = await openDatabase(factory, name)
        return await new Promise<AtomicV16Write>((resolve) => {
          const transaction = writeTransaction(db!)
          const records = transaction.objectStore(STORE)
          let result: AtomicV16Write = 'storage-error'
          transaction.oncomplete = () => resolve(result)
          transaction.onabort = () => resolve('storage-error')
          const head = records.get('head'), previous = records.get('previous')
          const source = records.get('lineage'), keys = records.getAllKeys()
          keys.onsuccess = () => {
            if (!knownSlots(keys.result)) { result = 'invalid'; return }
            const current = { status: 'ok' as const, head: head.result ?? null,
              previous: previous.result ?? null, lineage: source.result ?? null }
            if (keys.result.includes('head') && head.result == null
              || keys.result.includes('previous') && previous.result == null
              || keys.result.includes('lineage') && source.result == null) {
              result = 'invalid'; return
            }
            if (!sameRaw(current.head, snapshot.head)) {
              const actual = captureRecord(current.head)
              result = actual && actual.saveRevision !== expectedRevision
                ? 'revision-changed' : 'invalid'
              return
            }
            if (!sameRaw(current.lineage, snapshot.lineage)) { result = 'lineage-changed'; return }
            if (!sameRaw(current.previous, snapshot.previous)) { result = 'invalid'; return }
            try {
              records.put(pending, 'head')
              if (current.head !== null) records.put(current.head, 'previous')
              if (expectedRevision === null) records.put(lineage, 'lineage')
              result = 'committed'
            } catch { transaction.abort() }
          }
        })
      } catch { return 'storage-error' }
      finally { db?.close() }
    },
  }
}
