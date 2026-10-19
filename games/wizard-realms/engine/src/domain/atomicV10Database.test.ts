import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV9Store } from './atomicV9Database'
import { createAtomicV10Store } from './atomicV10Database'
import type { AtomicV10Record } from './atomicV10Database'
import { createFreshPublicWorld } from './publicWorldState'
import { PUBLIC_V7_SCHEMA, serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
import { encodePublicV8Head } from './publicWorldV8Snapshot'
import { encodePublicV9Head } from './publicWorldV9Snapshot'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { encodePublicV10Head } from './publicWorldV10Snapshot'
import type { PublicV10SourceReceipt } from './publicWorldV10Snapshot'
import { withPublicV10TerrainRevision } from './publicWorldV10State'

const v7 = withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'))
const v9 = withFreshPublicV9Camps(v7)
const v10 = withPublicV10TerrainRevision(v9)
const sourceLineage = { sourceV8Head: encodePublicV8Head(v7, null, 2),
  sourceV7Bytes: `\n${serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
    saveRevision: 3, bootstrap: null, migrationSourceV6Bytes: null, state: v7 })}\n` }
const lineage: PublicV10SourceReceipt = { sourceV9Head: encodePublicV9Head(v9, null, 0),
  sourceV9Lineage: sourceLineage }
const record = (saveRevision: number): AtomicV10Record => ({ saveRevision,
  value: encodePublicV10Head({ ...v10,
    player: { ...v10.player, coins: v10.player.coins + saveRevision } }, null, saveRevision) })
const first = record(0)
const second = record(1)

async function putRaw(factory: IDBFactory, key: string, value: unknown) {
  const request = factory.open('wizard-realms:world:v10', 1)
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

describe('atomic v10 IndexedDB slot', () => {
  it('publishes typed v9 source, head and previous without writing the older store', async () => {
    const factory = new FakeFactory()
    const old = createAtomicV9Store(factory)
    const oldBefore = await old.read()
    const store = createAtomicV10Store(factory)
    expect(await store.read()).toEqual({ status: 'ok', head: null, previous: null, lineage: null })
    expect(await store.commit(null, null, first, lineage)).toBe('committed')
    expect(await createAtomicV10Store(factory).read()).toEqual({ status: 'ok',
      head: first, previous: null, lineage })
    expect(await store.commit(0, lineage, second)).toBe('committed')
    expect(await createAtomicV10Store(factory).read()).toEqual({ status: 'ok',
      head: second, previous: first, lineage })
    expect(await old.read()).toEqual(oldBefore)
  })

  it('allows one writer per revision and blocks changed lineage or skipped revisions', async () => {
    const factory = new FakeFactory()
    const a = createAtomicV10Store(factory)
    const b = createAtomicV10Store(factory)
    expect((await Promise.all([a.commit(null, null, first, lineage),
      b.commit(null, null, first, lineage)])).sort()).toEqual(['committed', 'revision-changed'])
    const changed = { ...lineage, sourceV9Head: encodePublicV9Head(v9, null, 1) }
    const before = await a.read()
    expect(await a.commit(0, changed, second)).toBe('lineage-changed')
    expect(await a.commit(0, { ...lineage, sourceV9Lineage: {
      ...sourceLineage, sourceV7Bytes: sourceLineage.sourceV7Bytes.trim() } }, second)).toBe('lineage-changed')
    expect(await a.commit(1, lineage, record(2))).toBe('revision-changed')
    expect(await a.commit(0, lineage, record(2))).toBe('invalid')
    expect(await a.read()).toEqual(before)
    expect((await Promise.all([a.commit(0, lineage, second),
      b.commit(0, lineage, second)])).sort()).toEqual(['committed', 'revision-changed'])
  })

  it('fails closed on malformed records, orphaned slots and unknown keys', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV10Store(factory)
    expect(await store.commit(null, null, { ...first, extra: true } as AtomicV10Record, lineage)).toBe('invalid')
    expect(await store.commit(null, null, first, { ...lineage,
      sourceV9Head: { ...lineage.sourceV9Head, schemaVersion: 'wizard-world/v8' } } as unknown as PublicV10SourceReceipt))
      .toBe('invalid')
    expect(await store.commit(null, null, first)).toBe('invalid')
    await putRaw(factory, 'future-slot', first)
    expect(await store.read()).toEqual({ status: 'storage-error' })
    expect(await store.commit(null, null, first, lineage)).toBe('invalid')
  })

  it('does not overwrite a malformed previous recovery head', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV10Store(factory)
    expect(await store.commit(null, null, first, lineage)).toBe('committed')
    expect(await store.commit(0, lineage, second)).toBe('committed')
    await putRaw(factory, 'previous', { saveRevision: 0, value: {} })
    const before = await store.read()
    expect(await store.commit(1, lineage, record(2))).toBe('invalid')
    expect(await store.read()).toEqual(before)
  })

  it('snapshots caller inputs before asynchronous IndexedDB publication', async () => {
    const store = createAtomicV10Store(new FakeFactory())
    const source = structuredClone(lineage)
    const next = record(0)
    const pending = store.commit(null, null, next, source)
    source.sourceV9Head.state.discoveryMask.fill(0)
    next.saveRevision = 8
    expect(await pending).toBe('committed')
    expect(await store.read()).toEqual({ status: 'ok', head: first, previous: null, lineage })
  })
})
