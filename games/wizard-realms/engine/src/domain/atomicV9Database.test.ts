import { IDBFactory as FakeFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV8Store } from './atomicV8Database'
import { createAtomicV9Store } from './atomicV9Database'
import type { AtomicV9Record } from './atomicV9Database'
import { createFreshPublicWorld } from './publicWorldState'
import { PUBLIC_V7_SCHEMA, serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
import { encodePublicV8Head } from './publicWorldV8Snapshot'
import { encodePublicV9Head } from './publicWorldV9Snapshot'
import type { PublicV9SourceReceipt } from './publicWorldV9Snapshot'
import { withFreshPublicV9Camps } from './publicWorldV9State'

const base = withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'))
const state = withFreshPublicV9Camps(base)
const lineage: PublicV9SourceReceipt = { sourceV8Head: encodePublicV8Head(base, null, 2),
  sourceV7Bytes: `\n${serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
    saveRevision: 4, bootstrap: null, migrationSourceV6Bytes: null, state: base })}\n` }
const record = (saveRevision: number): AtomicV9Record => ({ saveRevision,
  value: encodePublicV9Head({ ...state, player: { ...state.player, coins: saveRevision } }, null, saveRevision) })
const first = record(0)
const second = record(1)

async function putRaw(factory: IDBFactory, key: string, value: unknown) {
  const request = factory.open('wizard-realms:world:v9', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('records')
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const transaction = db.transaction('records', 'readwrite')
  transaction.objectStore('records').put(value, key)
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
  })
  db.close()
}

describe('atomic v9 IndexedDB slot', () => {
  it('publishes and reopens head, previous and typed lineage in a separate database', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV9Store(factory)
    const v8 = createAtomicV8Store(factory)
    expect(await v8.commit(null, null, { saveRevision: 0, value: lineage.sourceV8Head },
      { sourceV7Bytes: lineage.sourceV7Bytes })).toBe('committed')
    const v8Before = await v8.read()
    expect(await store.read()).toEqual({ status: 'ok', head: null, previous: null, lineage: null })
    expect(await store.commit(null, null, first, lineage)).toBe('committed')
    expect(await createAtomicV9Store(factory).read()).toEqual({ status: 'ok', head: first, previous: null, lineage })
    expect(await store.commit(0, lineage, second)).toBe('committed')
    expect(await createAtomicV9Store(factory).read()).toEqual({ status: 'ok', head: second, previous: first, lineage })
    expect(await store.commit(1, lineage, record(2))).toBe('committed')
    expect(await store.read()).toEqual({ status: 'ok', head: record(2), previous: second, lineage })
    expect(await v8.read()).toEqual(v8Before)
  })

  it('allows only one initial creator and one writer at a shared revision', async () => {
    const factory = new FakeFactory()
    const a = createAtomicV9Store(factory)
    const b = createAtomicV9Store(factory)
    expect((await Promise.all([a.commit(null, null, first, lineage), b.commit(null, null, first, lineage)])).sort())
      .toEqual(['committed', 'revision-changed'])
    expect((await Promise.all([a.commit(0, lineage, second), b.commit(0, lineage, second)])).sort())
      .toEqual(['committed', 'revision-changed'])
    expect(await b.read()).toEqual({ status: 'ok', head: second, previous: first, lineage })
  })

  it('blocks stale revisions and any changed source revision, mask, state or v7 bytes', async () => {
    const store = createAtomicV9Store(new FakeFactory())
    await store.commit(null, null, first, lineage)
    const before = await store.read()
    expect(await store.commit(1, lineage, record(2))).toBe('revision-changed')
    const mask = structuredClone(lineage)
    mask.sourceV8Head.state.discoveryMask[0] |= 1
    for (const changed of [mask, { ...lineage, sourceV7Bytes: lineage.sourceV7Bytes.trim() },
      { ...lineage, sourceV8Head: { ...lineage.sourceV8Head, saveRevision: 3 } },
      { ...lineage, sourceV8Head: encodePublicV8Head({ ...base, player: { ...base.player, coins: 9 } }, null, 2) }]) {
      expect(await store.commit(0, changed, second)).toBe('lineage-changed')
    }
    expect(await store.read()).toEqual(before)
  })

  it('rejects malformed expected sources, non-exact records and skipped or exhausted revisions', async () => {
    const store = createAtomicV9Store(new FakeFactory())
    for (const bad of [{ ...first, extra: 1 }, { saveRevision: 0, value: {} },
      { saveRevision: 1, value: first.value }, { saveRevision: -1, value: first.value },
      Object.defineProperty({ ...first }, 'hidden', { value: true })]) {
      expect(await store.commit(null, null, bad, lineage)).toBe('invalid')
    }
    for (const bad of [{ ...lineage, extra: 1 }, { ...lineage, sourceV7Bytes: '{}' },
      { ...lineage, sourceV8Head: { ...lineage.sourceV8Head, state: {} } }]) {
      expect(await store.commit(null, null, first, bad as PublicV9SourceReceipt)).toBe('invalid')
    }
    expect(await store.commit(null, null, first)).toBe('invalid')
    expect(await store.commit(null, lineage, first, lineage)).toBe('invalid')
    expect(await store.commit(null, null, second, lineage)).toBe('invalid')
    expect(await store.read()).toEqual({ status: 'ok', head: null, previous: null, lineage: null })
    await store.commit(null, null, first, lineage)
    const before = await store.read()
    expect(await store.commit(0, lineage, record(2))).toBe('invalid')
    expect(await store.commit(0, lineage, second, lineage)).toBe('invalid')
    expect(await store.commit(Number.MAX_SAFE_INTEGER, lineage,
      { saveRevision: Number.MAX_SAFE_INTEGER + 1, value: second.value })).toBe('invalid')
    expect(await store.read()).toEqual(before)
  })

  it('preserves orphaned records and never overwrites malformed current or previous records', async () => {
    for (const [key, value, expected] of [
      ['previous', first, 'invalid'], ['previous', undefined, 'invalid'],
      ['lineage', undefined, 'lineage-changed'], ['head', undefined, 'invalid'],
      ['head', null, 'invalid'], ['head', { ...first, extra: 1 }, 'invalid'],
    ] as const) {
      const factory = new FakeFactory()
      const store = createAtomicV9Store(factory)
      await putRaw(factory, key, value)
      const before = await store.read()
      if (value == null) expect(before).toEqual({ status: 'storage-error' })
      expect(await store.commit(null, null, first, lineage)).toBe(expected)
      expect(await store.read()).toEqual(before)
    }
    for (const [key, value] of [['head', { ...second, extra: 1 }], ['previous', undefined], ['previous', first.value],
      ['previous', { saveRevision: 0, value: {} }], ['previous', second]] as const) {
      const factory = new FakeFactory()
      const store = createAtomicV9Store(factory)
      await store.commit(null, null, first, lineage)
      await store.commit(0, lineage, second)
      await putRaw(factory, key, value)
      const before = await store.read()
      expect(await store.commit(1, lineage, record(2))).toBe('invalid')
      expect(await store.read()).toEqual(before)
    }
  })

  it('fails closed when an unknown slot exists instead of treating the store as empty', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV9Store(factory)
    await putRaw(factory, 'future-save', first)
    expect(await store.read()).toEqual({ status: 'storage-error' })
    expect(await store.commit(null, null, first, lineage)).toBe('invalid')
    expect(await store.read()).toEqual({ status: 'storage-error' })
  })

  it('blocks an unexpected recovery slot at revision zero and malformed stored lineage', async () => {
    for (const [key, value, expected] of [['previous', first, 'invalid'],
      ['lineage', { ...lineage, extra: true }, 'lineage-changed'],
      ['lineage', { ...lineage, sourceV8Head: {} }, 'lineage-changed']] as const) {
      const factory = new FakeFactory()
      const store = createAtomicV9Store(factory)
      await store.commit(null, null, first, lineage)
      await putRaw(factory, key, value)
      const before = await store.read()
      expect(await store.commit(0, lineage, second)).toBe(expected)
      expect(await store.read()).toEqual(before)
    }
  })

  it('detects a lineage change after the read and snapshots caller-owned pending data', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV9Store(factory)
    const source = structuredClone(lineage)
    const initial = record(0)
    const pending = store.commit(null, null, initial, source)
    source.sourceV8Head.state.discoveryMask.fill(0)
    initial.saveRevision = 8
    expect(await pending).toBe('committed')
    expect(await store.read()).toEqual({ status: 'ok', head: first, previous: null, lineage })
    await putRaw(factory, 'lineage', { ...lineage, sourceV8Head: { ...lineage.sourceV8Head, saveRevision: 3 } })
    const before = await store.read()
    expect(await store.commit(0, lineage, second)).toBe('lineage-changed')
    expect(await store.read()).toEqual(before)
  })

  it('rolls back all slots if the transaction aborts after publishing a head request', async () => {
    const store = createAtomicV9Store(new FakeFactory())
    await store.commit(null, null, first, lineage)
    const empty = createAtomicV9Store(new FakeFactory())
    const before = await store.read()
    const original = FakeObjectStore.prototype.put
    FakeObjectStore.prototype.put = function (value, key) {
      const request = original.call(this, value, key)
      if (key === 'head') request.addEventListener('success', () => this.transaction.abort())
      return request
    }
    try {
      expect(await store.commit(0, lineage, second)).toBe('storage-error')
      expect(await empty.commit(null, null, first, lineage)).toBe('storage-error')
    }
    finally { FakeObjectStore.prototype.put = original }
    expect(await store.read()).toEqual(before)
    expect(await empty.read()).toEqual({ status: 'ok', head: null, previous: null, lineage: null })
  })
})
