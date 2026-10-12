import type { createAtomicV8Store } from './atomicV8Database'
import type { createAtomicV9Store } from './atomicV9Database'
import type { createAtomicV10Store } from './atomicV10Database'
import type { createAtomicV11Store } from './atomicV11Database'
import type { createAtomicV12Store } from './atomicV12Database'
import { DISCOVERY_MASK_BYTES, isValidDiscoveryMask } from './discoveryMask'
import { inspectPublicV11UnderLock } from './publicWorldV11Flow'
import type { PublicV11Head } from './publicWorldV11Snapshot'
import { inspectPublicV12UnderLock } from './publicWorldV12Flow'
import type { PublicV12Head } from './publicWorldV12Snapshot'
import type { PublicV13SourceLineage } from './publicWorldV13Snapshot'

type V8 = ReturnType<typeof createAtomicV8Store>
type V9 = ReturnType<typeof createAtomicV9Store>
type V10 = ReturnType<typeof createAtomicV10Store>
type V11 = ReturnType<typeof createAtomicV11Store>
type V12 = ReturnType<typeof createAtomicV12Store>
type Raw<T extends { read: () => Promise<unknown> }> = Awaited<ReturnType<T['read']>>
type Ok<T extends { read: () => Promise<unknown> }> = Extract<Raw<T>, { status: 'ok' }>
type Closure = {
  present: boolean
  v12: Ok<V12> | null
  v11: Ok<V11> | null
  v10: Ok<V10> | null
  v9: Ok<V9> | null
  v8: Ok<V8> | null
  texts: [string, string | null][]
}
type Cache = Closure & { selected: 'v11' | 'v12' }
export type PublicV13CheckedSource =
  | { status: 'v11'; head: PublicV11Head; proof: object }
  | { status: 'v12'; head: PublicV12Head; proof: object }
  | { status: 'missing' }
  | { status: 'blocked'; reason: string }
export type PublicV13SourceRead = { ok: true; value: PublicV13CheckedSource }
  | { ok: false; reason: 'storage-error' }

declare const sourceLeaseBrand: unique symbol
export type PublicV13SourceLease = { readonly [sourceLeaseBrand]: true }
type Lease = { owner: object; selected: 'v11' | 'v12'; accepted: PublicV11Head | PublicV12Head;
  isLive: () => boolean }
const leases = new WeakMap<object, Lease>()

/** A live lease yields only a detached head, never the private accepted source. */
export function resolvePublicV13SourceLease(lease: PublicV13SourceLease): PublicV13SourceLineage | null {
  try {
    const issued = leases.get(lease)
    if (!issued?.isLive()) return null
    const sourceHead = structuredClone(issued.accepted)
    return issued.selected === 'v11'
      ? { sourceSchemaVersion: 'wizard-world/v11', sourceHead: sourceHead as PublicV11Head }
      : { sourceSchemaVersion: 'wizard-world/v12', sourceHead: sourceHead as PublicV12Head }
  } catch { return null }
}

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)
const viewBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!
const viewOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!
const bufferBytes = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!
const bufferMaxBytes = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'maxByteLength')?.get

// Only IDB-normalized, bounded trees can use the shortcut. Exotic old-accepted
// values still go through the old inspectors on every read.
function cacheable(value: unknown): boolean {
  const pending = [value]
  const seen = new WeakSet<object>()
  let nodes = 0, fields = 0, textUnits = 0
  while (pending.length) {
    const item = pending.pop()
    if (typeof item === 'string') {
      if ((textUnits += item.length) > 8 * 1024 * 1024) return false
      continue
    }
    if (typeof item === 'bigint' || typeof item === 'symbol' || typeof item === 'function') return false
    if (typeof item !== 'object' || item === null) continue
    if (seen.has(item) || ++nodes > 50_000) return false
    seen.add(item)
    if (ArrayBuffer.isView(item)) {
      if (!isValidDiscoveryMask(item) || viewOffset.call(item) !== 0) return false
      const backing = viewBuffer.call(item)
      if (bufferBytes.call(backing) !== DISCOVERY_MASK_BYTES
        || bufferMaxBytes !== undefined && bufferMaxBytes.call(backing) !== DISCOVERY_MASK_BYTES) return false
      if (Reflect.ownKeys(item).length !== DISCOVERY_MASK_BYTES) return false
      continue
    }
    if (Object.getPrototypeOf(item) !== (Array.isArray(item) ? Array.prototype : Object.prototype)
      || Array.isArray(item) && item.length > 2_048) return false
    const keys = Reflect.ownKeys(item)
    if ((fields += keys.length) > 100_000) return false
    for (const key of keys) {
      if (typeof key !== 'string') return false
      if ((textUnits += key.length) > 8 * 1024 * 1024) return false
      const field = Object.getOwnPropertyDescriptor(item, key)
      if (!field || !Object.hasOwn(field, 'value')) return false
      pending.push(field.value)
    }
  }
  return true
}

/** Compare complete normalized records, including key order, hidden keys and mask bytes. */
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
          || viewOffset.call(right) !== 0
          || bufferBytes.call(viewBuffer.call(right)) !== DISCOVERY_MASK_BYTES
          || bufferMaxBytes !== undefined
            && bufferMaxBytes.call(viewBuffer.call(right)) !== DISCOVERY_MASK_BYTES
          || Reflect.ownKeys(right).length !== DISCOVERY_MASK_BYTES) return false
        for (let index = 0; index < DISCOVERY_MASK_BYTES; index++) {
          if (left[index] !== right[index]) return false
        }
        continue
      }
      if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false
      const keys = Reflect.ownKeys(left)
      const other = Reflect.ownKeys(right)
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

/** Caller holds PUBLIC_V7_LOCK_NAME. This reader never locks or writes old slots. */
export function createPublicV13SourceReader(factory: IDBFactory, storage: Pick<Storage, 'getItem'>,
  v8: V8, v9: V9, v10: V10, v11: V11, v12: V12,
  v12Name = 'wizard-realms:world:v12') {
  const owner = Object.freeze({})
  let cache: Cache | null = null
  let generation = 0, reading = false
  let activeClosure: Closure | null = null
  const proofs = new WeakMap<object, { generation: number; selected: 'v11' | 'v12';
    head: unknown; accepted: PublicV11Head | PublicV12Head; closure: Closure }>()
  const failed = (): PublicV13SourceRead => ({ ok: false, reason: 'storage-error' })
  const mint = (selected: 'v11' | 'v12', head: unknown, closure: Closure): PublicV13SourceRead => {
    const raw = head as PublicV11Head | PublicV12Head
    // Old decoders may accept a 32 KiB view over a much larger backing buffer.
    // Copy just the visible mask before detaching the head returned to callers.
    const detached = structuredClone({ ...raw,
      state: { ...raw.state, discoveryMask: new Uint8Array(raw.state.discoveryMask) } }) as
      PublicV11Head | PublicV12Head
    const proof = Object.freeze({})
    activeClosure = closure
    proofs.set(proof, { generation, selected, head: detached,
      accepted: structuredClone(detached), closure })
    return { ok: true, value: { status: selected, head: detached, proof } as PublicV13CheckedSource }
  }
  const present = async (): Promise<boolean | null> => {
    try {
      if (typeof factory.databases !== 'function') return null
      return (await factory.databases()).some((database) => database.name === v12Name)
    } catch { return null }
  }
  const headOf = (entry: Cache): unknown => (entry.selected === 'v12' ? entry.v12 : entry.v11)!.head!.value
  const consumeIssued = (proof: object) => {
    const issued = proofs.get(proof)
    proofs.delete(proof)
    try { return issued && issued.generation === generation && issued.closure === activeClosure
      && sameRaw(issued.accepted, issued.head) && cacheable(issued.head)
      && structuredClone(issued.head) !== null ? issued : null }
    catch { return null }
  }

  return {
    takeProof(proof: object): boolean { return consumeIssued(proof) !== null },
    consumeProof(proof: object): PublicV13SourceLease | null {
      const issued = consumeIssued(proof)
      if (!issued) return null
      const lease = Object.freeze({}) as PublicV13SourceLease
      leases.set(lease, { owner, selected: issued.selected, accepted: issued.accepted,
        isLive: () => issued.generation === generation && issued.closure === activeClosure })
      return lease
    },
    revoke(lease: PublicV13SourceLease): void {
      if (leases.get(lease)?.owner === owner) leases.delete(lease)
    },
    async readUnderLock(): Promise<PublicV13SourceRead> {
      if (reading) return failed()
      reading = true
      try {
      generation++
      activeClosure = null
      const hasV12 = await present()
      if (hasV12 === null) { cache = null; return failed() }
      if (cache && cache.present === hasV12) {
        try {
          const reads = [
            [cache.v12, () => v12.read()], [cache.v11, () => v11.read()],
            [cache.v10, () => v10.read()], [cache.v9, () => v9.read()], [cache.v8, () => v8.read()],
          ] as const
          let same = true
          for (const [expected, read] of reads) {
            if (!expected) continue
            const fresh = await read()
            try {
              if (!sameRaw(expected, fresh) || !cacheable(fresh)
                || !sameRaw(fresh, structuredClone(fresh))) { same = false; break }
            } catch { same = false; break }
          }
          if (same) for (const [key, value] of cache.texts) {
            if (storage.getItem(key) !== value) { same = false; break }
          }
          if (same) return mint(cache.selected, headOf(cache), cache)
        } catch { cache = null; return failed() }
      }
      cache = null
      try {
        const checked = hasV12 ? await v12.readChecked() : null
        if (checked?.status === 'storage-error') return failed()
        const rawV12: Ok<V12> | null = checked && checked.status === 'ok'
          ? { status: 'ok', head: checked.head, previous: checked.previous, lineage: checked.lineage } : null
        const chooseV12 = rawV12?.status === 'ok'
          && (rawV12.head !== null || rawV12.previous !== null || rawV12.lineage !== null)
        const captured: { v8?: Raw<V8>; v9?: Raw<V9>; v10?: Raw<V10>; v11?: Raw<V11> } = {}
        const texts = new Map<string, string | null>()
        let changingText = false
        const observedStorage = { getItem(key: string) {
          const value = storage.getItem(key)
          if (texts.has(key) && texts.get(key) !== value) changingText = true
          texts.set(key, value)
          return value
        } }
        const wrapped8 = { ...v8, read: async () => (captured.v8 = await v8.read()) }
        const wrapped9 = { ...v9, read: async () => (captured.v9 = await v9.read()) }
        const wrapped10 = { ...v10, read: async () => (captured.v10 = await v10.read()) }
        const wrapped11 = { ...v11, read: async () => (captured.v11 = await v11.read()) }
        const result = chooseV12
          ? await inspectPublicV12UnderLock(observedStorage, wrapped8, wrapped9, wrapped10,
            wrapped11, { ...v12, readChecked: async () => checked! })
          : await inspectPublicV11UnderLock(observedStorage, wrapped8, wrapped9, wrapped10, wrapped11)
        if (!result.ok) return failed()
        if (result.value.status !== 'valid') return { ok: true, value: result.value }
        const selected = chooseV12 ? 'v12' : 'v11'
        if (captured.v11?.status !== 'ok' || captured.v10?.status !== 'ok'
          || captured.v9?.status !== 'ok' || captured.v8?.status !== 'ok') return failed()
        const closure: Closure = { present: hasV12, v12: rawV12, v11: captured.v11,
          v10: captured.v10, v9: captured.v9, v8: captured.v8,
          texts: [...texts] }
        const head = (selected === 'v12' ? rawV12 : captured.v11)!.head!.value
        if (!changingText && cacheable(closure)) {
          try {
            const detached = structuredClone(closure)
            if (sameRaw(closure, detached)) cache = { ...detached, selected }
          } catch { /* Exotic old-accepted input stays on the cold oracle path. */ }
        }
        return mint(selected, head, cache ?? closure)
      } catch { cache = null; return failed() }
      } finally { reading = false }
    },
  }
}
