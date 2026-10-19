import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV17Store } from './atomicV17Database'
import { createAtomicV23Store } from './atomicV23Database'
import { createAtomicV24Store } from './atomicV24Database'
import { createAtomicV25Store } from './atomicV25Database'
import { createAtomicV26Store } from './atomicV26Database'
import { createAtomicV27Store } from './atomicV27Database'
import { createAtomicV28Store } from './atomicV28Database'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { startFreshPublicV24World } from './publicWorldV24Flow'
import { startPublicV25 } from './publicWorldV25Flow'
import { inspectPublicV26, startPublicV26 } from './publicWorldV26Flow'
import { PUBLIC_V27_DATABASE_NAME } from './publicWorldV27Migration'
import { inspectPublicV27, startPublicV27 } from './publicWorldV27Flow'
import { PUBLIC_V28_DATABASE_NAME } from './publicWorldV28Migration'
import { createPublicV28Root } from './publicWorldV28Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

async function replaceRoot(factory: IDBFactory, name: string, root: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve) => {
    const tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').put(root, 'root')
    tx.oncomplete = () => resolve()
  })
  db.close()
}

describe('bounded raw IndexedDB comparison', () => {
  it('admits a detached canonical V24 root within the raw-byte cap', () => {
    const root = createPublicV24Root(createPublicV23Root('greenway-alpha'))
    expect(sameStrictBoundedRaw(root, structuredClone(root))).toBe(true)
  })

  it('rejects bytes, keys, descriptors, prototypes, aliases, and unsupported shapes', () => {
    const original = { bytes: new Uint8Array([1, 2]), nested: { value: 3 } }
    const changedByte = structuredClone(original)
    changedByte.bytes[1] = 4
    expect(sameStrictBoundedRaw(original, changedByte)).toBe(false)
    const forgedBrand = new Uint8ClampedArray([1, 2])
    Object.setPrototypeOf(forgedBrand, Uint8Array.prototype)
    expect(forgedBrand instanceof Uint8Array).toBe(true)
    expect(sameStrictBoundedRaw(original, { ...original, bytes: forgedBrand })).toBe(false)
    const oversized = new Uint8Array(new ArrayBuffer(3), 0, 2)
    oversized.set(original.bytes)
    expect(sameStrictBoundedRaw(original, { ...original, bytes: oversized })).toBe(false)
    const offset = new Uint8Array(new ArrayBuffer(3), 1, 2)
    offset.set(original.bytes)
    expect(sameStrictBoundedRaw(original, { ...original, bytes: offset })).toBe(false)
    const resizable = new Uint8Array(Reflect.construct(ArrayBuffer, [2, { maxByteLength: 3 }]))
    resizable.set(original.bytes)
    expect(sameStrictBoundedRaw(original, { ...original, bytes: resizable })).toBe(false)
    const shared = new Uint8Array(new SharedArrayBuffer(2))
    shared.set(original.bytes)
    expect(sameStrictBoundedRaw(original, { ...original, bytes: shared })).toBe(false)
    expect(sameStrictBoundedRaw(original, { ...structuredClone(original), extra: true })).toBe(false)
    const changedDescriptor = structuredClone(original)
    Object.defineProperty(changedDescriptor.nested, 'value', { writable: false })
    expect(sameStrictBoundedRaw(original, changedDescriptor)).toBe(false)
    const changedPrototype = structuredClone(original)
    Object.setPrototypeOf(changedPrototype.nested, null)
    expect(sameStrictBoundedRaw(original, changedPrototype)).toBe(false)
    const accessor = Object.defineProperty({}, 'value', { get: () => 3, enumerable: true })
    expect(sameStrictBoundedRaw(accessor, accessor)).toBe(false)
    const repeated = { a: original.nested, b: original.nested }
    expect(sameStrictBoundedRaw(repeated, structuredClone(repeated))).toBe(false)
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(sameStrictBoundedRaw(cyclic, structuredClone(cyclic))).toBe(false)
    expect(sameStrictBoundedRaw(new Date(0), new Date(0))).toBe(false)
  })

  it('bypasses records whose estimated raw payload exceeds one MiB', () => {
    const large = { bytes: new Uint8Array(1 << 20) }
    expect(sameStrictBoundedRaw(large, structuredClone(large))).toBe(false)
    expect(sameStrictBoundedRaw(large, structuredClone(large), 2 << 20)).toBe(true)
    expect(sameStrictBoundedRaw(large, structuredClone(large), Infinity)).toBe(false)
    expect(sameStrictBoundedRaw(large, structuredClone(large), 4 << 20)).toBe(false)
    const changed = structuredClone(large)
    changed.bytes[0] = 1
    expect(sameStrictBoundedRaw(large, changed, 2 << 20)).toBe(false)
    expect(sameStrictBoundedRaw(large, { ...structuredClone(large), extra: true }, 2 << 20)).toBe(false)
    const overCap = { bytes: new Uint8Array(3 << 20) }
    expect(sameStrictBoundedRaw(overCap, structuredClone(overCap), 3 << 20)).toBe(false)
  })

  it('admits real V26/V27 warm caches and V28 root, but not later raw tampering', async () => {
    const factory = new IDBFactory(), locks = { request: async <T,>(
      _name: string, _options: { mode: 'exclusive' }, body: () => T | Promise<T>) => body() }
    const v17 = createAtomicV17Store(factory), v23 = createAtomicV23Store(factory)
    const v24 = createAtomicV24Store(factory), v25 = createAtomicV25Store(factory)
    const v26 = createAtomicV26Store(factory), v27 = createAtomicV27Store(factory)
    const v28 = createAtomicV28Store(factory), seed = 'greenway-alpha'
    const started24 = await startFreshPublicV24World(locks, v24, v23, v17, seed)
    if (!started24.ok) throw new Error(started24.reason)
    const started25 = await startPublicV25(locks, v25, v24, v23, v17, seed, started24.value)
    if (!started25.ok) throw new Error(started25.reason)
    const available26 = await inspectPublicV26(locks, v26, v25, v24, v23, v17)
    if (!available26.ok || available26.value.status !== 'migration-available')
      throw new Error('V26 migration unavailable')
    const started26 = await startPublicV26(locks, v26, v25, v24, v23, v17,
      seed, available26.value.sourceReceipt)
    if (!started26.ok) throw new Error(started26.reason)
    const phases26: string[] = []
    const read26 = await v26.readChecked((sample) => phases26.push(sample.phase))
    expect(phases26).toContain('v26-validated-cache-hit')
    if (read26.status !== 'valid') throw new Error('V26 root unreadable')
    expect(sameStrictBoundedRaw(read26.root, structuredClone(read26.root))).toBe(false)
    expect(sameStrictBoundedRaw(read26.root, structuredClone(read26.root), 2 << 20)).toBe(true)
    const available27 = await inspectPublicV27(locks, v27, v26, v25, v24, v23, v17)
    if (!available27.ok || available27.value.status !== 'migration-available')
      throw new Error('V27 migration unavailable')
    const started27 = await startPublicV27(locks, v27, v26, v25, v24, v23, v17,
      seed, available27.value.sourceReceipt)
    if (!started27.ok) throw new Error(started27.reason)
    const phases27: string[] = []
    const read27 = await v27.readChecked((sample) => phases27.push(sample.phase))
    expect(phases27).toContain('v27-validated-cache-hit')
    if (read27.status !== 'valid') throw new Error('V27 root unreadable')
    expect(sameStrictBoundedRaw(read27.root, structuredClone(read27.root))).toBe(false)
    expect(sameStrictBoundedRaw(read27.root, structuredClone(read27.root), 2 << 20)).toBe(true)
    const missing28 = await v28.readChecked()
    if (missing28.status !== 'missing') throw new Error('V28 root already present')
    const root28 = createPublicV28Root(started27.value)
    expect(await v28.commit(missing28.proof, root28)).toBe('committed')
    const read28 = await v28.readChecked()
    if (read28.status !== 'valid') throw new Error('V28 root unreadable')
    expect(sameStrictBoundedRaw(read28.root, structuredClone(read28.root))).toBe(false)
    expect(sameStrictBoundedRaw(read28.root, structuredClone(read28.root), 3 << 20)).toBe(true)
    const coins = read27.root.head.state.player.coins
    read27.root.head.state.player.coins++
    const unchanged = await v27.readChecked()
    expect(unchanged.status).toBe('valid')
    if (unchanged.status === 'valid') expect(unchanged.root.head.state.player.coins).toBe(coins)
    await replaceRoot(factory, PUBLIC_V27_DATABASE_NAME,
      { ...structuredClone(read27.root), extra: true })
    expect(await v27.readChecked()).toEqual({ status: 'blocked', reason: 'invalid-v27-root' })
    await replaceRoot(factory, PUBLIC_V28_DATABASE_NAME,
      { ...structuredClone(read28.root), extra: true })
    expect(await v28.readChecked()).toEqual({ status: 'blocked', reason: 'invalid-v28-root' })
  }, 30_000)
})
