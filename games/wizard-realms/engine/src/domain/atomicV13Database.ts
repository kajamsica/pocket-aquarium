import { decodePublicV13Head, decodePublicV13HeadWithSource,
  decodePublicV13SourceLineage } from './publicWorldV13Snapshot'
import type { PublicV13Head, PublicV13SourceLineage } from './publicWorldV13Snapshot'
import { resolvePublicV13SourceLease } from './publicWorldV13SourceReader'
import type { PublicV13SourceLease } from './publicWorldV13SourceReader'
import { DISCOVERY_MASK_BYTES, isValidDiscoveryMask } from './discoveryMask'

export type AtomicV13Record = { saveRevision: number; value: unknown }
export type AtomicV13Read =
  | { status: 'ok'; head: unknown | null; previous: unknown | null; lineage: unknown | null }
  | { status: 'storage-error' }
/** Decoded fields are advisory detached values; the proof binds only the three raw slots. */
export type AtomicV13CheckedRead = AtomicV13Read & {
  decodedHead?: PublicV13Head | null
  decodedPrevious?: PublicV13Head | null
  decodedLineage?: PublicV13SourceLineage | null
  proof?: object | null
}
export type AtomicV13Write = 'committed' | 'revision-changed' | 'lineage-changed' | 'invalid' | 'storage-error'

const STORE = 'records'
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)
const viewBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!
const viewOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!
const bufferBytes = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!
const bufferMaxBytes = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'maxByteLength')?.get
const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get
const knownSlots = (keys: readonly IDBValidKey[]) => keys.every((key) =>
  key === 'head' || key === 'previous' || key === 'lineage')
const validRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
function captureRecord(value: unknown): AtomicV13Record | null {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) return null
    const keys = Reflect.ownKeys(value)
    if (keys.length !== 2 || !keys.includes('saveRevision') || !keys.includes('value')) return null
    const revision = Object.getOwnPropertyDescriptor(value, 'saveRevision')
    const data = Object.getOwnPropertyDescriptor(value, 'value')
    if (!revision?.enumerable || !Object.hasOwn(revision, 'value')
      || !data?.enumerable || !Object.hasOwn(data, 'value')
      || !validRevision(revision.value)) return null
    return { saveRevision: revision.value, value: data.value }
  } catch { return null }
}

function decodeRecord(value: unknown, lineage: PublicV13SourceLineage | null): PublicV13Head | null {
  const record = captureRecord(value)
  if (!lineage || !record) return null
  const head = decodePublicV13Head(record.value, lineage)
  return head?.saveRevision === record.saveRevision ? head : null
}
function decodeRecordWithSource(value: unknown, lease: PublicV13SourceLease): PublicV13Head | null {
  const record = captureRecord(value)
  if (!record) return null
  const head = decodePublicV13HeadWithSource(record.value, lease)
  return head?.saveRevision === record.saveRevision ? head : null
}

/** Exact structural slot equality, including descriptors, hidden keys and every mask byte. */
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
          || viewOffset.call(left) !== viewOffset.call(right)
          || bufferBytes.call(viewBuffer.call(left)) !== bufferBytes.call(viewBuffer.call(right))
          || bufferMaxBytes?.call(viewBuffer.call(left)) !== bufferMaxBytes?.call(viewBuffer.call(right))
          || bufferResizable?.call(viewBuffer.call(left)) !== bufferResizable?.call(viewBuffer.call(right))
          || Reflect.ownKeys(left).length !== DISCOVERY_MASK_BYTES
          || Reflect.ownKeys(right).length !== DISCOVERY_MASK_BYTES) return false
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

/** Separate v13 slots. The caller owns the shared Web Lock and live source proof. */
export function createAtomicV13Store(factory: IDBFactory, name = 'wizard-realms:world:v13') {
  type Ok = Extract<AtomicV13Read, { status: 'ok' }>
  type Mode = 'strict' | 'bound'
  const proofs = new WeakMap<object, { snapshot: Ok; issued: AtomicV13CheckedRead;
    mode: Mode; lease?: PublicV13SourceLease }>()
  async function readRecords(): Promise<AtomicV13Read> {
    let db: IDBDatabase | undefined
    try {
      db = await openDatabase(factory, name)
      return await new Promise<AtomicV13Read>((resolve) => {
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
  function mint(raw: Ok, decodedHead: PublicV13Head | null,
    decodedPrevious: PublicV13Head | null, decodedLineage: PublicV13SourceLineage | null,
    valid: boolean, mode: Mode, lease?: PublicV13SourceLease): AtomicV13CheckedRead {
    const proof = valid ? Object.freeze({}) : null
    const checked = { ...raw, decodedHead, decodedPrevious, decodedLineage, proof }
    if (proof) proofs.set(proof, { snapshot: structuredClone(raw), issued: checked, mode, lease })
    return checked
  }
  function take(proof: object, mode: Mode, lease?: PublicV13SourceLease): Ok | null {
    const issued = proofs.get(proof)
    proofs.delete(proof)
    const snapshot = issued?.snapshot
    return snapshot && issued.mode === mode && issued.lease === lease
      && issued.issued.status === 'ok'
      && sameRaw(snapshot.head, issued.issued.head)
      && sameRaw(snapshot.previous, issued.issued.previous)
      && sameRaw(snapshot.lineage, issued.issued.lineage) ? snapshot : null
  }
  async function write(snapshot: Ok, lineage: PublicV13SourceLineage,
    pending: AtomicV13Record, expectedRevision: number | null,
    live: () => boolean = () => true): Promise<AtomicV13Write> {
    let db: IDBDatabase | undefined
    try {
      db = await openDatabase(factory, name)
      return await new Promise<AtomicV13Write>((resolve) => {
        const transaction = writeTransaction(db!)
        const records = transaction.objectStore(STORE)
        let result: AtomicV13Write = 'storage-error'
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
            || keys.result.includes('lineage') && source.result == null) { result = 'invalid'; return }
          if (!sameRaw(current.head, snapshot.head)) {
            const actual = captureRecord(current.head)
            result = actual && actual.saveRevision !== expectedRevision
              ? 'revision-changed' : 'invalid'
            return
          }
          if (!sameRaw(current.lineage, snapshot.lineage)) { result = 'lineage-changed'; return }
          if (!sameRaw(current.previous, snapshot.previous)) { result = 'invalid'; return }
          if (!live()) { result = 'invalid'; return }
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
  }

  return {
    read: readRecords,
    async readChecked(): Promise<AtomicV13CheckedRead> {
      const raw = await readRecords()
      if (raw.status !== 'ok') return raw
      const missing = raw.head === null && raw.previous === null && raw.lineage === null
      const decodedLineage = raw.lineage === null ? null : decodePublicV13SourceLineage(raw.lineage)
      const decodedHead = raw.head === null ? null : decodeRecord(raw.head, decodedLineage)
      const decodedPrevious = raw.previous === null ? null : decodeRecord(raw.previous, decodedLineage)
      const valid = missing || decodedHead !== null && decodedLineage !== null
        && (decodedHead.saveRevision === 0 ? raw.previous === null
          : decodedPrevious !== null && decodedPrevious.saveRevision === decodedHead.saveRevision - 1)
      return mint(raw, decodedHead, decodedPrevious, decodedLineage, valid, 'strict')
    },
    async readCheckedWithSource(lease: PublicV13SourceLease): Promise<AtomicV13CheckedRead> {
      const first = resolvePublicV13SourceLease(lease)
      if (!first) return { status: 'storage-error' }
      const raw = await readRecords()
      if (raw.status !== 'ok') return raw
      const lineage = resolvePublicV13SourceLease(lease)
      if (!lineage || !sameRaw(first, lineage)) return { status: 'storage-error' }
      const missing = raw.head === null && raw.previous === null && raw.lineage === null
      const matches = missing || sameRaw(raw.lineage, lineage)
      const decodedHead = matches && raw.head !== null ? decodeRecordWithSource(raw.head, lease) : null
      const decodedPrevious = matches && raw.previous !== null
        ? decodeRecordWithSource(raw.previous, lease) : null
      const valid = matches && (missing || decodedHead !== null
        && (decodedHead.saveRevision === 0 ? raw.previous === null
          : decodedPrevious !== null && decodedPrevious.saveRevision === decodedHead.saveRevision - 1))
      return mint(raw, decodedHead, decodedPrevious, lineage, valid, 'bound', lease)
    },
    async commit(expectedRevision: number | null, expectedLineage: unknown,
      next: AtomicV13Record, initialLineage: unknown, proof: object): Promise<AtomicV13Write> {
      const snapshot = take(proof, 'strict')
      if (!snapshot || (snapshot.head === null ? null
        : (snapshot.head as AtomicV13Record).saveRevision) !== expectedRevision) return 'invalid'
      let lineage: PublicV13SourceLineage | null, pending: AtomicV13Record
      try {
        lineage = expectedRevision === null ? decodePublicV13SourceLineage(initialLineage)
          : decodePublicV13SourceLineage(expectedLineage)
        const captured = captureRecord(next)
        if (!lineage || !captured) return 'invalid'
        if (expectedRevision === null) {
          if (expectedLineage !== null || snapshot.head !== null || snapshot.previous !== null
            || snapshot.lineage !== null || captured.saveRevision !== 0) return 'invalid'
        } else if (!validRevision(expectedRevision) || initialLineage !== undefined
          || !sameRaw(lineage, snapshot.lineage)
          || captured.saveRevision !== expectedRevision + 1) return 'invalid'
        const decoded = decodeRecord(captured, lineage)
        if (!decoded) return 'invalid'
        pending = { saveRevision: captured.saveRevision, value: decoded }
      } catch { return 'invalid' }
      return write(snapshot, lineage, pending, expectedRevision)
    },
    async commitWithSource(lease: PublicV13SourceLease, expectedRevision: number | null,
      next: AtomicV13Record, proof: object): Promise<AtomicV13Write> {
      const snapshot = take(proof, 'bound', lease)
      const lineage = resolvePublicV13SourceLease(lease)
      if (!snapshot || !lineage) return 'invalid'
      const actualRevision = snapshot.head === null ? null : captureRecord(snapshot.head)?.saveRevision
      const captured = captureRecord(next)
      if (actualRevision !== expectedRevision || !captured) return 'invalid'
      if (expectedRevision === null) {
        if (snapshot.previous !== null || snapshot.lineage !== null
          || captured.saveRevision !== 0) return 'invalid'
      } else if (!validRevision(expectedRevision) || !sameRaw(snapshot.lineage, lineage)
        || captured.saveRevision !== expectedRevision + 1) return 'invalid'
      const decoded = decodeRecordWithSource(captured, lease)
      if (!decoded) return 'invalid'
      const pending = { saveRevision: captured.saveRevision, value: decoded }
      return write(snapshot, lineage, pending, expectedRevision, () => {
        const fresh = resolvePublicV13SourceLease(lease)
        return fresh !== null && sameRaw(lineage, fresh)
      })
    },
  }
}
