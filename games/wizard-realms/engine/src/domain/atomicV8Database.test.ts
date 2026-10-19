import { IDBFactory as FakeFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV8Store, type AtomicV8Lineage } from './atomicV8Database'

const lineage: AtomicV8Lineage = { sourceV7Bytes: '{ "schema": "v7" }\n' }
const first = { saveRevision: 0, value: { mask: new Uint8Array([3, 5]) } }
const second = { saveRevision: 1, value: { mask: new Uint8Array([3, 7]) } }

describe('atomic v8 IndexedDB slot', () => {
  it('starts empty and publishes the first head and exact lineage together', async () => {
    const store = createAtomicV8Store(new FakeFactory())
    expect(await store.read()).toEqual({ status: 'ok', head: null, previous: null, lineage: null })
    expect(await store.commit(null, null, first, lineage)).toBe('committed')
    expect(await store.read()).toEqual({ status: 'ok', head: first, previous: null, lineage })
  })

  it('does not publish an initial head over an orphaned recovery record', async () => {
    const factory = new FakeFactory()
    const request = factory.open('orphaned-previous', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const orphan = { saveRevision: 9, value: { old: true } }
    const transaction = db.transaction('records', 'readwrite')
    transaction.objectStore('records').put(orphan, 'previous')
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
    })
    db.close()

    const store = createAtomicV8Store(factory, 'orphaned-previous')
    expect(await store.commit(null, null, first, lineage)).toBe('invalid')
    expect(await store.read()).toEqual({ status: 'ok', head: null, previous: orphan, lineage: null })
  })

  it('advances the head, retains its prior version, and leaves lineage intact', async () => {
    const store = createAtomicV8Store(new FakeFactory())
    expect(await store.commit(null, null, first, lineage)).toBe('committed')
    expect(await store.commit(0, lineage, second)).toBe('committed')
    expect(await store.read()).toEqual({ status: 'ok', head: second, previous: first, lineage })
  })

  it('rejects stale revisions and changed lineage without publishing anything', async () => {
    const store = createAtomicV8Store(new FakeFactory())
    await store.commit(null, null, first, lineage)
    const before = await store.read()
    expect(await store.commit(null, null, first, lineage)).toBe('revision-changed')
    expect(await store.commit(1, lineage, { saveRevision: 2, value: 'late' })).toBe('revision-changed')
    expect(await store.commit(0, { sourceV7Bytes: 'different bytes' }, second)).toBe('lineage-changed')
    expect(await store.read()).toEqual(before)
  })

  it('rejects invalid initial and next revisions before any write', async () => {
    const store = createAtomicV8Store(new FakeFactory())
    expect(await store.commit(null, null, first)).toBe('invalid')
    expect(await store.commit(null, null, second, lineage)).toBe('invalid')
    expect(await store.commit(null, null, { saveRevision: -1, value: 0 }, lineage)).toBe('invalid')
    expect(await store.commit(null, null, { saveRevision: Number.MAX_SAFE_INTEGER + 1, value: 0 }, lineage)).toBe('invalid')
    expect(await store.read()).toEqual({ status: 'ok', head: null, previous: null, lineage: null })
    await store.commit(null, null, first, lineage)
    const before = await store.read()
    expect(await store.commit(0, lineage, { saveRevision: 2, value: 'skip' })).toBe('invalid')
    expect(await store.commit(0, lineage, second, lineage)).toBe('invalid')
    expect(await store.read()).toEqual(before)
  })

  it('rolls back an uncloneable head and retains all prior records', async () => {
    const store = createAtomicV8Store(new FakeFactory())
    const bad = { saveRevision: 0, value: () => 1 }
    expect(await store.commit(null, null, bad, lineage)).toBe('storage-error')
    expect(await store.read()).toEqual({ status: 'ok', head: null, previous: null, lineage: null })
    await store.commit(null, null, first, lineage)
    await store.commit(0, lineage, second)
    const before = await store.read()
    expect(await store.commit(1, lineage, { saveRevision: 2, value: () => 2 })).toBe('storage-error')
    expect(await store.read()).toEqual(before)
  })

  it('reports a transaction abort after a put request succeeds', async () => {
    const store = createAtomicV8Store(new FakeFactory())
    await store.commit(null, null, first, lineage)
    const before = await store.read()
    const originalPut = FakeObjectStore.prototype.put
    let abortNextHead = true
    FakeObjectStore.prototype.put = function (value, key) {
      const request = originalPut.call(this, value, key)
      if (key === 'head' && abortNextHead) {
        abortNextHead = false
        request.addEventListener('success', () => this.transaction.abort())
      }
      return request
    }
    try {
      expect(await store.commit(0, lineage, second)).toBe('storage-error')
    } finally {
      FakeObjectStore.prototype.put = originalPut
    }
    expect(await store.read()).toEqual(before)
  })

  it('serializes competing commits from separate store instances', async () => {
    const factory = new FakeFactory()
    const a = createAtomicV8Store(factory, 'shared')
    const b = createAtomicV8Store(factory, 'shared')
    expect(await a.commit(null, null, first, lineage)).toBe('committed')
    const [left, right] = await Promise.all([
      a.commit(0, lineage, second),
      b.commit(0, lineage, { saveRevision: 1, value: 'other tab' }),
    ])
    expect([left, right].sort()).toEqual(['committed', 'revision-changed'])
    const read = await b.read()
    expect(read).toMatchObject({ status: 'ok', previous: first, lineage })
    if (read.status === 'ok') expect(read.head?.saveRevision).toBe(1)
  })
})
