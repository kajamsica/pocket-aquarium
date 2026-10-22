import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
// Initialize V41 ancestry before the cross-version V43/V44 module graph.
import './atomicV41Database'
import { createAtomicV44Store } from './atomicV44Database'
import { createAtomicV44PromotionStore } from './atomicV44Promotion'
import { createFreshPublicV43Root } from './publicWorldV43Snapshot'
import { createPublicV44Root, PUBLIC_V44_DATABASE_NAME } from './publicWorldV44Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

const root = createPublicV44Root(createFreshPublicV43Root('wizard-realms'))
type Store = ReturnType<typeof createAtomicV44PromotionStore>

function open(factory: IDBFactory, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(PUBLIC_V44_DATABASE_NAME, version)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function write(factory: IDBFactory, key: string, value: unknown) {
  const db = await open(factory)
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite')
      tx.objectStore('records').put(value, key)
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}

async function inspect(factory: IDBFactory) {
  const db = await open(factory)
  try {
    return await new Promise<{ version: number; keys: IDBValidKey[];
      raw: unknown; marker: unknown }>((resolve, reject) => {
      const tx = db.transaction('records', 'readonly')
      const records = tx.objectStore('records')
      const raw = records.get('root'), marker = records.get('v45-successor')
      const keys = records.getAllKeys()
      tx.oncomplete = () => resolve({ version: db.version, keys: keys.result,
        raw: raw.result, marker: marker.result })
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}

async function checkedRead(store: Store) {
  const read = await store.readForPromotion()
  expect(read.status).toBe('valid')
  if (read.status !== 'valid') throw new Error('Expected checked V44 proof')
  return read
}

describe('V44 to V45 durable successor reservation', () => {
  it('upgrades only on pending, preserves the exact root, and fences old V44 opens', async () => {
    const factory = new IDBFactory(), store = createAtomicV44PromotionStore(factory)
    await write(factory, 'root', root)
    const before = await inspect(factory)
    const read = await checkedRead(store)
    expect(read.marker).toBeNull()
    expect(read.sourceFingerprint).toMatch(/^v44-canonical-sha256\/v1:[0-9a-f]{64}$/)
    expect((await inspect(factory)).version).toBe(1)
    expect(await store.transitionSuccessor(read.proof, 'pending')).toBe('committed')
    expect(await store.transitionSuccessor(read.proof, 'pending')).toBe('invalid')
    const after = await inspect(factory)
    expect(after.version).toBe(2)
    expect(after.keys).toEqual(['root', 'v45-successor'])
    expect(JSON.stringify(after.raw)).toBe(JSON.stringify(before.raw))
    expect(sameStrictBoundedRaw(after.raw, before.raw, 3 << 20)).toBe(true)
    expect(after.marker).toEqual({ schemaVersion: 'v45-successor/v1',
      phase: 'pending', sourceRevision: root.head.saveRevision,
      sourceFingerprint: read.sourceFingerprint })
    await expect(open(factory, 1)).rejects.toMatchObject({ name: 'VersionError' })
    expect(await createAtomicV44Store(factory).readChecked()).toEqual({
      status: 'blocked', reason: 'storage-error' })
  })

  it('fails a blocked upgrade promptly without allowing a late marker write', async () => {
    const factory = new IDBFactory(), store = createAtomicV44PromotionStore(factory)
    await write(factory, 'root', root)
    const before = await inspect(factory)
    const held = await open(factory, 1)
    const read = await checkedRead(store)
    const onBlocked = vi.fn()
    let reachedBlocked!: () => void, settled = false
    const blocked = new Promise<void>((resolve) => { reachedBlocked = resolve })
    const transition = store.transitionSuccessor(read.proof, 'pending', () => {
      onBlocked(); reachedBlocked()
    }).then((result) => { settled = true; return result })
    try {
      await blocked
      expect(await Promise.race([transition,
        new Promise((resolve) => setTimeout(() => resolve('still-pending'), 20))]))
        .toBe('storage-error')
      expect(onBlocked).toHaveBeenCalledTimes(1)
      expect(settled).toBe(true)
      expect(held.version).toBe(1)
    } finally { held.close() }
    expect(await transition).toBe('storage-error')
    expect(onBlocked).toHaveBeenCalledTimes(1)
    const after = await inspect(factory)
    expect(after).toEqual(before)
    expect(await store.transitionSuccessor((await checkedRead(store)).proof,
      'pending')).toBe('committed')
    expect((await inspect(factory)).version).toBe(2)
  })

  it('closes a late successful connection after a blocked return', async () => {
    const actual = new IDBFactory()
    await write(actual, 'root', root)
    const close = vi.fn()
    const request = { result: { close }, onblocked: null, onupgradeneeded: null,
      onerror: null, onsuccess: null } as unknown as IDBOpenDBRequest
    const factory = { open: (name: string, version?: number) => version === 2
      ? request : actual.open(name, version) } as unknown as IDBFactory
    const store = createAtomicV44PromotionStore(factory)
    const transition = store.transitionSuccessor((await checkedRead(store)).proof, 'pending')
    request.onblocked?.call(request, {} as IDBVersionChangeEvent)
    expect(await transition).toBe('storage-error')
    request.onsuccess?.call(request, {} as Event)
    expect(close).toHaveBeenCalledTimes(1)
    expect(await inspect(actual)).toMatchObject({ version: 1, keys: ['root'] })
  })

  it('rejects a stale concurrent V1 proof without silently accepting its upgrade', async () => {
    const factory = new IDBFactory()
    await write(factory, 'root', root)
    const first = createAtomicV44PromotionStore(factory)
    const second = createAtomicV44PromotionStore(factory)
    const firstRead = await checkedRead(first), stale = await checkedRead(second)
    expect(await first.transitionSuccessor(firstRead.proof, 'pending')).toBe('committed')
    expect(await second.transitionSuccessor(stale.proof, 'pending')).toBe('revision-changed')
    expect((await inspect(factory)).marker).toMatchObject({ phase: 'pending' })
  })

  it('aborts the V2 upgrade when the V44 root changes after its proof', async () => {
    const factory = new IDBFactory(), store = createAtomicV44PromotionStore(factory)
    await write(factory, 'root', root)
    const read = await checkedRead(store)
    const competitor = { ...root, previous: { forged: true } }
    await write(factory, 'root', competitor)
    expect(await store.transitionSuccessor(read.proof, 'pending')).toBe('revision-changed')
    const after = await inspect(factory)
    expect(after.version).toBe(1)
    expect(after.keys).toEqual(['root'])
    expect(after.raw).toEqual(competitor)
    expect(await store.readForPromotion()).toEqual({ status: 'blocked',
      reason: 'invalid-v44-root' })
  })

  it('blocks malformed, absent, unexpected, and unsupported V44 records', async () => {
    const missing = new IDBFactory(), malformed = new IDBFactory()
    const extra = new IDBFactory(), extraV2 = new IDBFactory()
    const future = new IDBFactory()
    ;(await open(missing, 1)).close()
    await write(malformed, 'root', { forged: true })
    await write(extra, 'root', root)
    await write(extra, 'extra', { forged: true })
    await write(extraV2, 'root', root)
    const v2 = createAtomicV44PromotionStore(extraV2)
    expect(await v2.transitionSuccessor((await checkedRead(v2)).proof,
      'pending')).toBe('committed')
    await write(extraV2, 'extra', { forged: true })
    const futureDb = await open(future, 3)
    futureDb.close()
    expect(await createAtomicV44PromotionStore(missing).readForPromotion())
      .toEqual({ status: 'blocked', reason: 'missing-v44-root' })
    expect(await createAtomicV44PromotionStore(malformed).readForPromotion())
      .toEqual({ status: 'blocked', reason: 'invalid-v44-root' })
    expect(await createAtomicV44PromotionStore(extra).readForPromotion())
      .toEqual({ status: 'blocked', reason: 'invalid-v44-records' })
    expect(await v2.readForPromotion())
      .toEqual({ status: 'blocked', reason: 'invalid-v44-records' })
    expect(await createAtomicV44PromotionStore(future).readForPromotion())
      .toEqual({ status: 'blocked', reason: 'unsupported-v44-version' })
  })

  it('resumes pending after restart and advances finalized to terminal conflict', async () => {
    const factory = new IDBFactory(), store = createAtomicV44PromotionStore(factory)
    await write(factory, 'root', root)
    expect(await store.transitionSuccessor((await checkedRead(store)).proof,
      'finalized')).toBe('invalid')
    expect(await store.transitionSuccessor((await checkedRead(store)).proof,
      'pending')).toBe('committed')
    const restarted = createAtomicV44PromotionStore(factory)
    const pending = await checkedRead(restarted)
    expect(pending.marker?.phase).toBe('pending')
    expect(await restarted.transitionSuccessor(pending.proof, 'pending')).toBe('unchanged')
    const finalize = await checkedRead(restarted)
    const stale = await checkedRead(restarted)
    expect(await restarted.transitionSuccessor(finalize.proof, 'finalized')).toBe('committed')
    expect(await restarted.transitionSuccessor(stale.proof, 'conflict'))
      .toBe('revision-changed')
    const finalized = await checkedRead(createAtomicV44PromotionStore(factory))
    expect(finalized.marker?.phase).toBe('finalized')
    expect(await restarted.transitionSuccessor(finalized.proof, 'pending')).toBe('invalid')
    const terminal = await checkedRead(restarted)
    const staleFinalized = await checkedRead(restarted)
    expect(await restarted.transitionSuccessor(terminal.proof, 'conflict')).toBe('committed')
    expect(await restarted.transitionSuccessor(staleFinalized.proof, 'finalized'))
      .toBe('revision-changed')
    expect(await createAtomicV44PromotionStore(factory).readForPromotion())
      .toEqual({ status: 'blocked', reason: 'successor-conflict' })
  })

  it('can move pending directly to a terminal conflict without rewriting V44', async () => {
    const factory = new IDBFactory(), store = createAtomicV44PromotionStore(factory)
    await write(factory, 'root', root)
    expect(await store.transitionSuccessor((await checkedRead(store)).proof,
      'pending')).toBe('committed')
    const before = await inspect(factory)
    expect(await store.transitionSuccessor((await checkedRead(store)).proof,
      'conflict')).toBe('committed')
    const after = await inspect(factory)
    expect(after.raw).toEqual(before.raw)
    expect(after.marker).toMatchObject({ phase: 'conflict' })
    expect(await store.readForPromotion()).toEqual({ status: 'blocked',
      reason: 'successor-conflict' })
  })

  it('blocks a mismatched V2 marker without repairing it or changing the root', async () => {
    const factory = new IDBFactory(), store = createAtomicV44PromotionStore(factory)
    await write(factory, 'root', root)
    expect(await store.transitionSuccessor((await checkedRead(store)).proof,
      'pending')).toBe('committed')
    const before = await inspect(factory)
    const db = await open(factory)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite')
      tx.objectStore('records').put({ ...(before.marker as object),
        sourceFingerprint: 'v44-canonical-sha256/v1:' + '0'.repeat(64) },
      'v45-successor')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
    })
    db.close()
    expect(await store.readForPromotion()).toEqual({ status: 'blocked',
      reason: 'invalid-successor-marker' })
    const after = await inspect(factory)
    expect(after.raw).toEqual(before.raw)
    expect(after.marker).not.toEqual(before.marker)
  })
})
