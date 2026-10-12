import { IDBDatabase as FakeDatabase, IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV13Store } from './atomicV13Database'
import type { AtomicV13Record } from './atomicV13Database'
import { createAtomicV8Store } from './atomicV8Database'
import { createAtomicV9Store } from './atomicV9Database'
import { createAtomicV10Store } from './atomicV10Database'
import { createAtomicV11Store } from './atomicV11Database'
import { createAtomicV12Store } from './atomicV12Database'
import { createFreshPublicWorld } from './publicWorldState'
import { PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA, serializePublicV7World,
  withFreshPublicV7Herbs } from './publicWorldV7'
import { migratePublicV7ToV8 } from './publicWorldV8Flow'
import { encodePublicV8Head } from './publicWorldV8Snapshot'
import { migratePublicV8ToV9 } from './publicWorldV9Flow'
import { encodePublicV9Head } from './publicWorldV9Snapshot'
import { migratePublicV9ToV10 } from './publicWorldV10Flow'
import { encodePublicV10Head } from './publicWorldV10Snapshot'
import { migratePublicV10ToV11 } from './publicWorldV11Flow'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import * as v11Snapshot from './publicWorldV11Snapshot'
import * as v12Snapshot from './publicWorldV12Snapshot'
import { encodePublicV11Head, PUBLIC_V11_SCHEMA } from './publicWorldV11Snapshot'
import { withPublicV11Highland } from './publicWorldV11State'
import { createPublicV13MigrationHead, createPublicV13MigrationHeadWithSource } from './publicWorldV13Snapshot'
import { createPublicV13SourceReader, resolvePublicV13SourceLease } from './publicWorldV13SourceReader'
import type { PublicV13SourceLease } from './publicWorldV13SourceReader'

const old = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
  withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1')))))
const lineage = { sourceSchemaVersion: PUBLIC_V11_SCHEMA,
  sourceHead: encodePublicV11Head(old, null, 3) }
const initial = createPublicV13MigrationHead(lineage)!
const ResizableBuffer = ArrayBuffer as unknown as new (length: number,
  options: { maxByteLength: number }) => ArrayBuffer
const record = (saveRevision: number): AtomicV13Record => ({ saveRevision,
  value: structuredClone({ ...initial, saveRevision }) })
const databaseName = 'wizard-realms:world:v13'
async function checked(store: ReturnType<typeof createAtomicV13Store>) {
  const result = await store.readChecked()
  if (result.status !== 'ok' || !result.proof) throw new Error('Missing checked v13 proof')
  return result
}
async function bound(store: ReturnType<typeof createAtomicV13Store>, lease: PublicV13SourceLease) {
  const result = await store.readCheckedWithSource(lease)
  if (result.status !== 'ok' || !result.proof) throw new Error('Missing bound v13 proof')
  return result
}
async function putRaw(factory: IDBFactory, key: string, value: unknown) {
  const request = factory.open(databaseName, 1)
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => request.result.createObjectStore('records')
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
async function leasedSource() {
  const factory = new FakeFactory()
  const base = withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'))
  const bytes = serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA, saveRevision: 4,
    bootstrap: null, migrationSourceV6Bytes: null, state: base })
  const storage = { getItem: (key: string) => key === PUBLIC_V7_ROOT_KEY ? bytes : null }
  const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
    callback: () => Promise<T>) => callback() }
  const v8 = createAtomicV8Store(factory), v9 = createAtomicV9Store(factory)
  const v10 = createAtomicV10Store(factory), v11 = createAtomicV11Store(factory)
  const v12 = createAtomicV12Store(factory)
  expect((await migratePublicV7ToV8(storage, locks, v8, bytes)).ok).toBe(true)
  const r9 = { sourceV8Head: encodePublicV8Head(base, null, 0), sourceV7Bytes: bytes }
  expect((await migratePublicV8ToV9(storage, locks, v8, v9, r9)).ok).toBe(true)
  const s9 = withFreshPublicV9Camps(base)
  const r10 = { sourceV9Head: encodePublicV9Head(s9, null, 0), sourceV9Lineage: r9 }
  expect((await migratePublicV9ToV10(storage, locks, v8, v9, v10, r10)).ok).toBe(true)
  const s10 = withPublicV10TerrainRevision(s9)
  const r11 = { sourceV10Head: encodePublicV10Head(s10, null, 0), sourceV10Lineage: r10 }
  expect((await migratePublicV10ToV11(storage, locks, v8, v9, v10, v11, r11)).ok).toBe(true)
  const reader = createPublicV13SourceReader(factory, storage, v8, v9, v10, v11, v12)
  const selected = await reader.readUnderLock()
  if (!selected.ok || selected.value.status !== 'v11') throw new Error('Missing v11 source')
  const lease = reader.consumeProof(selected.value.proof)
  if (!lease) throw new Error('Missing authentic source lease')
  return { factory, reader, lease }
}

describe('unmounted atomic v13 store', () => {
  it('initializes rev0, rotates previous on revN and never opens old stores', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV13Store(factory)
    const empty = await checked(store)
    expect(empty).toMatchObject({ head: null, previous: null, lineage: null })
    expect(await store.commit(null, null, record(0), lineage, empty.proof!)).toBe('committed')
    const after0 = await checked(store)
    expect(after0.decodedHead?.saveRevision).toBe(0)
    expect(after0.previous).toBeNull()
    expect(await store.commit(0, lineage, record(1), undefined, after0.proof!)).toBe('committed')
    const after1 = await checked(store)
    expect(after1.decodedHead?.saveRevision).toBe(1)
    expect(after1.decodedPrevious?.saveRevision).toBe(0)
    expect(await store.commit(1, lineage, record(2), undefined, after1.proof!)).toBe('committed')
    const after2 = await checked(store)
    expect(after2.decodedHead?.saveRevision).toBe(2)
    expect(after2.decodedPrevious?.saveRevision).toBe(1)
    expect(after2.lineage).toEqual(lineage)
    expect((await factory.databases()).map((db) => db.name)).toEqual([databaseName])
  })

  it('rejects foreign and replayed proofs, stale revision, and an altered lineage', async () => {
    const factory = new FakeFactory()
    const a = createAtomicV13Store(factory), b = createAtomicV13Store(factory)
    const empty = await checked(a)
    expect(await b.commit(null, null, record(0), lineage, empty.proof!)).toBe('invalid')
    expect(await a.commit(null, null, record(0), lineage, empty.proof!)).toBe('committed')
    expect(await a.commit(null, null, record(0), lineage, empty.proof!)).toBe('invalid')
    const first = await checked(a), second = await checked(b)
    const results = await Promise.all([
      a.commit(0, lineage, record(1), undefined, first.proof!),
      b.commit(0, lineage, record(1), undefined, second.proof!),
    ])
    expect(results.sort()).toEqual(['committed', 'revision-changed'])
    const stale = await checked(a)
    expect(await a.commit(0, lineage, record(1), undefined, stale.proof!)).toBe('invalid')
    const changed = structuredClone(lineage)
    changed.sourceHead.state.discoveryMask[0] ^= 1
    const current = await checked(a)
    expect(await a.commit(1, changed, record(2), undefined, current.proof!)).toBe('invalid')
    expect((await a.read()).status).toBe('ok')
  })

  it('checks every stored slot byte at commit time and snapshots caller inputs', async () => {
    const factory = new FakeFactory(), store = createAtomicV13Store(factory)
    const empty = await checked(store)
    expect(await store.commit(null, null, record(0), lineage, empty.proof!)).toBe('committed')
    const before = await checked(store)
    const next = record(1)
    const pending = store.commit(0, lineage, next, undefined, before.proof!)
    ;(next.value as typeof initial).state.player.coins = 999
    expect(await pending).toBe('committed')
    const stored = await store.read()
    if (stored.status !== 'ok') throw new Error('Expected stored v13 record')
    expect(stored.status === 'ok' && ((stored.head as AtomicV13Record).value as typeof initial)
      .state.player.coins).toBe(initial.state.player.coins)
    const maskProof = await checked(store)
    const changed = structuredClone(stored.head) as AtomicV13Record
    ;(changed.value as typeof initial).state.discoveryMask[0] ^= 1
    await putRaw(factory, 'head', changed)
    expect(await store.commit(1, lineage, record(2), undefined, maskProof.proof!)).toBe('invalid')
    await putRaw(factory, 'head', stored.head)
    const backingProof = await checked(store)
    const oversized = structuredClone(stored.head) as AtomicV13Record
    const mask = (oversized.value as typeof initial).state.discoveryMask
    const wide = new Uint8Array(new ArrayBuffer(mask.byteLength * 2), 0, mask.byteLength)
    wide.set(mask)
    ;((oversized.value as typeof initial).state as { discoveryMask: Uint8Array }).discoveryMask = wide
    await putRaw(factory, 'head', oversized)
    expect(await store.commit(1, lineage, record(2), undefined, backingProof.proof!)).toBe('invalid')
    await putRaw(factory, 'head', stored.head)
    const previousProof = await checked(store)
    await putRaw(factory, 'previous', { malformed: true })
    expect(await store.commit(1, lineage, record(2), undefined, previousProof.proof!)).toBe('invalid')
    await putRaw(factory, 'previous', stored.previous)
    const lineageProof = await checked(store)
    await putRaw(factory, 'lineage', { malformed: true })
    expect(await store.commit(1, lineage, record(2), undefined, lineageProof.proof!))
      .toBe('lineage-changed')
    await putRaw(factory, 'lineage', lineage)
    const hidden = record(2)
    Object.defineProperty(hidden, 'surplus', { value: true })
    const fresh = await checked(store)
    expect(await store.commit(1, lineage, hidden, undefined, fresh.proof!)).toBe('invalid')
    const mutated = await checked(store)
    ;((mutated.head as AtomicV13Record).value as typeof initial).state.discoveryMask[0] ^= 1
    expect(await store.commit(1, lineage, record(2), undefined, mutated.proof!)).toBe('invalid')
    const concealed = await checked(store)
    Object.defineProperty((concealed.head as AtomicV13Record).value, 'surplus', { value: true })
    expect(await store.commit(1, lineage, record(2), undefined, concealed.proof!)).toBe('invalid')
  })

  it('rejects partial/corrupt slots and preserves all slots on a transaction abort', async () => {
    const factory = new FakeFactory(), store = createAtomicV13Store(factory)
    await putRaw(factory, 'previous', record(0))
    expect((await store.readChecked()).proof).toBeNull()
    const cleanFactory = new FakeFactory(), clean = createAtomicV13Store(cleanFactory)
    const empty = await checked(clean)
    expect(await clean.commit(null, null, record(0), lineage, empty.proof!)).toBe('committed')
    const before = await clean.read()
    const proof = await checked(clean)
    const original = FakeDatabase.prototype.transaction
    const spy = vi.spyOn(FakeDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase, names, mode, options) {
      const transaction = original.call(this, names, mode, options)
      if (mode === 'readwrite') queueMicrotask(() => transaction.abort())
      return transaction
    })
    try { expect(await clean.commit(0, lineage, record(1), undefined, proof.proof!)).toBe('storage-error') }
    finally { spy.mockRestore() }
    expect(await clean.read()).toEqual(before)
    await putRaw(cleanFactory, 'lineage', { malformed: true })
    expect((await clean.readChecked()).proof).toBeNull()
    await putRaw(cleanFactory, 'lineage', lineage)
    await putRaw(cleanFactory, 'head', { malformed: true })
    expect((await clean.readChecked()).proof).toBeNull()
    await putRaw(cleanFactory, 'future-slot', true)
    expect(await clean.readChecked()).toEqual({ status: 'storage-error' })
  })

  it('rejects forged mask brand and enlarged resizable backing after issuing proof', async () => {
    for (const forge of [
      (mask: Uint8Array) => Object.setPrototypeOf(new Uint8ClampedArray(mask), Uint8Array.prototype),
      (mask: Uint8Array) => Object.defineProperty(mask, 'hidden', { value: true }),
      (mask: Uint8Array) => {
        const view = new Uint8Array(new ResizableBuffer(mask.byteLength,
          { maxByteLength: mask.byteLength * 2 }))
        view.set(mask)
        return view
      },
    ]) {
      const store = createAtomicV13Store(new FakeFactory()), empty = await checked(store)
      expect(await store.commit(null, null, record(0), lineage, empty.proof!)).toBe('committed')
      const issued = await checked(store)
      const state = ((issued.head as AtomicV13Record).value as typeof initial).state
      ;(state as { discoveryMask: Uint8Array }).discoveryMask = forge(state.discoveryMask)
      expect(await store.commit(0, lineage, record(1), undefined, issued.proof!)).toBe('invalid')
    }
  })

  it('uses an authentic live source lease for bound read and one-step commit', async () => {
    const { factory, reader, lease } = await leasedSource()
    const store = createAtomicV13Store(factory)
    const initial = createPublicV13MigrationHeadWithSource(lease)!
    const decoder = vi.spyOn(v11Snapshot, 'decodePublicV11Head')
    const v12Decoder = vi.spyOn(v12Snapshot, 'decodePublicV12Head')
    try {
      const empty = await store.readCheckedWithSource(lease)
      expect(empty.status).toBe('ok')
      expect(await store.commitWithSource(lease, null,
        { saveRevision: 0, value: initial }, empty.proof!)).toBe('committed')
      const current = await store.readCheckedWithSource(lease)
      expect(current.decodedHead?.saveRevision).toBe(0)
      expect(await store.commitWithSource(lease, 0, { saveRevision: 1,
        value: { ...initial, saveRevision: 1 } }, current.proof!)).toBe('committed')
      expect(await store.commitWithSource(lease, 0, record(1), current.proof!)).toBe('invalid')
      expect(decoder).not.toHaveBeenCalled()
      expect(v12Decoder).not.toHaveBeenCalled()
      expect((await store.readCheckedWithSource(lease)).decodedPrevious?.saveRevision).toBe(0)
    } finally { decoder.mockRestore(); v12Decoder.mockRestore() }
    expect(await store.readCheckedWithSource({} as PublicV13SourceLease))
      .toEqual({ status: 'storage-error' })
    const bound = await store.readCheckedWithSource(lease)
    expect(await store.commit(1, lineage, record(2), undefined, bound.proof!)).toBe('invalid')
    const strict = await store.readChecked()
    expect(await store.commitWithSource(lease, 1, record(2), strict.proof!)).toBe('invalid')
    const stale = await store.readCheckedWithSource(lease)
    await reader.readUnderLock()
    expect(await store.commitWithSource(lease, 1, record(2), stale.proof!)).toBe('invalid')
    const selected = await reader.readUnderLock()
    if (!selected.ok || selected.value.status !== 'v11') throw new Error('Missing new lease')
    const freshLease = reader.consumeProof(selected.value.proof)!
    const revoked = await store.readCheckedWithSource(freshLease)
    reader.revoke(freshLease)
    expect(await store.commitWithSource(freshLease, 1, record(2), revoked.proof!)).toBe('invalid')
  })

  it('rechecks all bound slots in one CAS transaction and rolls back aborts', async () => {
    const { factory, lease } = await leasedSource()
    const a = createAtomicV13Store(factory), b = createAtomicV13Store(factory)
    const migration = createPublicV13MigrationHeadWithSource(lease)!
    const next = (revision: number): AtomicV13Record => ({ saveRevision: revision,
      value: structuredClone({ ...migration, saveRevision: revision }) })
    expect(await a.commitWithSource(lease, null, next(0), (await bound(a, lease)).proof!))
      .toBe('committed')
    const first = await bound(a, lease), second = await bound(b, lease)
    expect((await Promise.all([a.commitWithSource(lease, 0, next(1), first.proof!),
      b.commitWithSource(lease, 0, next(1), second.proof!)])).sort())
      .toEqual(['committed', 'revision-changed'])
    const before = await a.read()
    if (before.status !== 'ok') throw new Error('Missing v13 slots')
    const maskProof = await bound(a, lease)
    const changed = structuredClone(before.head) as AtomicV13Record
    ;(changed.value as typeof migration).state.discoveryMask[0] ^= 1
    await putRaw(factory, 'head', changed)
    expect(await a.commitWithSource(lease, 1, next(2), maskProof.proof!)).toBe('invalid')
    await putRaw(factory, 'head', before.head)
    const lineageProof = await bound(a, lease)
    await putRaw(factory, 'lineage', { malformed: true })
    expect((await a.readCheckedWithSource(lease)).proof).toBeNull()
    expect(await a.commitWithSource(lease, 1, next(2), lineageProof.proof!))
      .toBe('lineage-changed')
    await putRaw(factory, 'lineage', resolvePublicV13SourceLease(lease))
    const previousProof = await bound(a, lease)
    await putRaw(factory, 'previous', { malformed: true })
    expect((await a.readCheckedWithSource(lease)).proof).toBeNull()
    expect(await a.commitWithSource(lease, 1, next(2), previousProof.proof!)).toBe('invalid')
    await putRaw(factory, 'previous', before.previous)
    const proof = await bound(a, lease)
    const original = FakeDatabase.prototype.transaction
    const spy = vi.spyOn(FakeDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase, names, mode, options) {
      const transaction = original.call(this, names, mode, options)
      if (mode === 'readwrite') queueMicrotask(() => transaction.abort())
      return transaction
    })
    try { expect(await a.commitWithSource(lease, 1, next(2), proof.proof!)).toBe('storage-error') }
    finally { spy.mockRestore() }
    expect(await a.read()).toEqual(before)
  })
})
