import { IDBFactory as FakeFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV8Store } from './atomicV8Database'
import { createFreshPublicWorld } from './publicWorldState'
import { PUBLIC_V7_LOCK_NAME, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA,
  serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { commitPublicV8Snapshot, inspectPublicV8, migratePublicV7ToV8, resumePublicV8 } from './publicWorldV8Flow'

function fixture(factory = new FakeFactory()) {
  const state = withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'))
  const bytes = `\n${serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
    saveRevision: 4, bootstrap: null, migrationSourceV6Bytes: null, state })}\n`
  const values = new Map([[PUBLIC_V7_ROOT_KEY, bytes]])
  const writes: string[] = []
  const storage = { values, writes, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push(key); values.set(key, value) } }
  const names: string[] = []
  const locks: PublicV7LockProvider = { request: async (name, options, callback) => {
    names.push(name)
    expect(options).toEqual({ mode: 'exclusive' })
    return callback()
  } }
  return { state, bytes, storage, names, locks, db: createAtomicV8Store(factory), factory }
}

async function putRaw(factory: IDBFactory, key: string, value: unknown) {
  const request = factory.open('wizard-realms:world:v8', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('records')
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const transaction = connection.transaction('records', 'readwrite')
  transaction.objectStore('records').put(value, key)
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
  })
  connection.close()
}

describe('public v8 migration flow', () => {
  it('imports the exact v7 bytes once under the shared lock and resumes the same state', async () => {
    const { state, bytes, storage, names, locks, db } = fixture()
    expect(await inspectPublicV8(storage, locks, db)).toEqual({ ok: true, value: { status: 'missing' } })
    const start = { state, saveRevision: 0, sourceV7Bytes: bytes }
    expect(await migratePublicV7ToV8(storage, locks, db, bytes)).toEqual({ ok: true, value: start })
    expect(await db.read()).toMatchObject({ status: 'ok', lineage: { sourceV7Bytes: bytes }, previous: null })
    expect(await inspectPublicV8(storage, locks, db)).toEqual({ ok: true, value: { status: 'valid', start } })
    expect(await resumePublicV8(storage, locks, db, 0)).toEqual({ ok: true, value: start })
    expect(await migratePublicV7ToV8(storage, locks, db, bytes)).toEqual({ ok: false, reason: 'v8-records-present' })
    expect(storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(bytes)
    expect(storage.writes).toEqual([])
    expect(names).toHaveLength(5)
    expect(names.every((name) => name === PUBLIC_V7_LOCK_NAME)).toBe(true)
  })

  it('saves a changed state and rejects a stale revision', async () => {
    const { state, bytes, storage, locks, db } = fixture()
    await migratePublicV7ToV8(storage, locks, db, bytes)
    const changed = { ...state, player: { ...state.player, coins: state.player.coins + 9 } }
    expect(await commitPublicV8Snapshot(storage, locks, db, changed, 0)).toEqual({ ok: true,
      value: { state: changed, saveRevision: 1, sourceV7Bytes: bytes } })
    const read = await db.read()
    expect(read.status === 'ok' && read.previous?.saveRevision).toBe(0)
    expect(await resumePublicV8(storage, locks, db, 1)).toEqual({ ok: true,
      value: { state: changed, saveRevision: 1, sourceV7Bytes: bytes } })
    expect(await resumePublicV8(storage, locks, db, 0)).toEqual({ ok: false, reason: 'revision-changed' })
    expect(await commitPublicV8Snapshot(storage, locks, db, state, 0))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(bytes)
  })

  it('lets only one of two tabs win an IndexedDB CAS from the same revision', async () => {
    const shared = new FakeFactory()
    const { state, bytes, storage, locks, db } = fixture(shared)
    await migratePublicV7ToV8(storage, locks, db, bytes)
    const other = createAtomicV8Store(shared)
    let arrivals = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const race = (store: typeof db) => ({ ...store, read: async () => {
      const result = await store.read()
      if (result.status === 'ok' && result.head?.saveRevision === 0) {
        if (++arrivals === 2) release()
        await gate
      }
      return result
    } })
    const left = { ...state, player: { ...state.player, coins: 11 } }
    const right = { ...state, player: { ...state.player, coins: 12 } }
    const results = await Promise.all([
      commitPublicV8Snapshot(storage, locks, race(db), left, 0),
      commitPublicV8Snapshot(storage, locks, race(other), right, 0),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: 'revision-changed' }])
    const resumed = await resumePublicV8(storage, locks, db, 1)
    expect(resumed.ok && [11, 12].includes(resumed.value.state.player.coins)).toBe(true)
  })

  it('blocks reads and saves after an older v7 tab advances its root', async () => {
    const { state, bytes, storage, locks, db } = fixture()
    await migratePublicV7ToV8(storage, locks, db, bytes)
    const before = await db.read()
    storage.values.set(PUBLIC_V7_ROOT_KEY, serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
      saveRevision: 5, bootstrap: null, migrationSourceV6Bytes: null,
      state: { ...state, player: { ...state.player, coins: 33 } } }))
    expect(await inspectPublicV8(storage, locks, db)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-changed' } })
    expect(await resumePublicV8(storage, locks, db, 0)).toEqual({ ok: false, reason: 'source-changed' })
    expect(await commitPublicV8Snapshot(storage, locks, db, state, 0))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect(await db.read()).toEqual(before)
  })

  it('blocks orphaned and malformed heads, lineage, and previous records', async () => {
    const { bytes, storage, locks, db, factory } = fixture()
    await putRaw(factory, 'previous', { saveRevision: 0, value: {} })
    expect(await inspectPublicV8(storage, locks, db)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v8-head' } })
    await putRaw(factory, 'head', 0)
    expect(await inspectPublicV8(storage, locks, db)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v8-head' } })
    expect(await migratePublicV7ToV8(storage, locks, db, bytes)).toEqual({ ok: false, reason: 'v8-records-present' })
    const clean = fixture()
    await clean.db.commit(null, null, { saveRevision: 0, value: {} }, { sourceV7Bytes: clean.bytes })
    expect(await inspectPublicV8(clean.storage, clean.locks, clean.db)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v8-head' } })
    const valid = fixture()
    await migratePublicV7ToV8(valid.storage, valid.locks, valid.db, valid.bytes)
    await putRaw(valid.factory, 'lineage', { sourceV7Bytes: null })
    expect(await inspectPublicV8(valid.storage, valid.locks, valid.db)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v8-lineage' } })
    await putRaw(valid.factory, 'lineage', { sourceV7Bytes: valid.bytes })
    const changed = { ...valid.state, player: { ...valid.state.player, coins: 2 } }
    await commitPublicV8Snapshot(valid.storage, valid.locks, valid.db, changed, 0)
    await putRaw(valid.factory, 'previous', { saveRevision: 7, value: {} })
    expect(await inspectPublicV8(valid.storage, valid.locks, valid.db)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v8-previous' } })
  })

  it('requires a lock and reports an aborted IndexedDB write without advancing', async () => {
    const { state, bytes, storage, locks, db } = fixture()
    expect(await migratePublicV7ToV8(storage, undefined, db, bytes))
      .toEqual({ ok: false, reason: 'lock-unavailable' })
    expect(await inspectPublicV8(storage, undefined, db)).toEqual({ ok: false, reason: 'lock-unavailable' })
    expect(await resumePublicV8(storage, undefined, db, 0)).toEqual({ ok: false, reason: 'lock-unavailable' })
    expect(await commitPublicV8Snapshot(storage, undefined, db, state, 0))
      .toEqual({ ok: false, reason: 'lock-unavailable' })
    expect(await db.read()).toMatchObject({ status: 'ok', head: null })
    await migratePublicV7ToV8(storage, locks, db, bytes)
    const before = await db.read()
    const originalPut = FakeObjectStore.prototype.put
    let abortHead = true
    FakeObjectStore.prototype.put = function (value, key) {
      const request = originalPut.call(this, value, key)
      if (key === 'head' && abortHead) {
        abortHead = false
        request.addEventListener('success', () => this.transaction.abort())
      }
      return request
    }
    try {
      expect(await commitPublicV8Snapshot(storage, locks, db, state, 0))
        .toEqual({ ok: false, reason: 'storage-error' })
    } finally { FakeObjectStore.prototype.put = originalPut }
    expect(await db.read()).toEqual(before)
  })
})
