import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV16Store } from './atomicV16Database'
import type { AtomicV16Record } from './atomicV16Database'
import { createFreshPublicV15Head } from './publicWorldV15Snapshot'
import { createFreshPublicV16Head, createMigratedPublicV16Head,
  PUBLIC_V16_DATABASE_NAME } from './publicWorldV16Snapshot'
import type { PublicV16Head } from './publicWorldV16Snapshot'

const fresh = createFreshPublicV16Head('wizard-realms')
const record = (revision: number, head: PublicV16Head = fresh.head): AtomicV16Record => ({
  saveRevision: revision, value: structuredClone({ ...head, saveRevision: revision }),
})
async function checked(store: ReturnType<typeof createAtomicV16Store>) {
  const read = await store.readChecked()
  if (read.status !== 'ok' || !read.proof) throw new Error('Missing checked v16 proof')
  return read
}
async function putRaw(factory: IDBFactory, key: string, value: unknown) {
  const request = factory.open(PUBLIC_V16_DATABASE_NAME, 1)
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

describe('atomic v16 root', () => {
  it('writes only its own root and rotates checked head and previous revisions', async () => {
    const factory = new FakeFactory(), store = createAtomicV16Store(factory)
    const empty = await checked(store)
    expect(empty).toMatchObject({ head: null, previous: null, lineage: null })
    expect(await store.commit(null, null, record(0), fresh.lineage, empty.proof!))
      .toBe('committed')
    const first = await checked(store)
    expect(first.decodedHead?.saveRevision).toBe(0)
    expect(await store.commit(0, fresh.lineage, record(1), undefined, first.proof!))
      .toBe('committed')
    const second = await checked(store)
    expect(second.decodedHead?.saveRevision).toBe(1)
    expect(second.decodedPrevious?.saveRevision).toBe(0)
    expect(await store.commit(1, fresh.lineage, record(2), undefined, second.proof!))
      .toBe('committed')
    expect((await checked(store)).decodedPrevious?.saveRevision).toBe(1)
    expect((await factory.databases()).map((db) => db.name)).toEqual([PUBLIC_V16_DATABASE_NAME])
    await putRaw(factory, 'previous', record(0))
    expect((await store.readChecked()).proof).toBeNull()
  })

  it('pins a migrated genesis to its detached source receipt', async () => {
    const v15 = createFreshPublicV15Head('wizard-realms')
    const migrated = createMigratedPublicV16Head({ saveRevision: v15.head.saveRevision,
      bootstrap: null, state: v15.head.state, starterWorks: v15.head.starterWorks,
      lineage: v15.lineage })!
    const factory = new FakeFactory(), store = createAtomicV16Store(factory)
    const empty = await checked(store)
    expect(await store.commit(null, null, record(0, migrated.head), migrated.lineage,
      empty.proof!)).toBe('committed')
    expect((await checked(store)).decodedLineage?.origin).toBe('v15-migration')
    const changed = structuredClone(migrated.lineage)
    ;(changed.sourceReceipt!.starterWorks as { bridgeBuilt: boolean }).bridgeBuilt = true
    const current = await checked(store)
    expect(await store.commit(0, changed, record(1, migrated.head), undefined,
      current.proof!)).toBe('invalid')
    expect(await store.commit(0, migrated.lineage, record(1, migrated.head), undefined,
      (await checked(store)).proof!)).toBe('committed')
    expect((await checked(store)).decodedPrevious?.saveRevision).toBe(0)
  })

  it('consumes proofs once and resolves concurrent compare-and-swap by revision', async () => {
    const factory = new FakeFactory(), a = createAtomicV16Store(factory)
    const b = createAtomicV16Store(factory), empty = await checked(a)
    expect(await b.commit(null, null, record(0), fresh.lineage, empty.proof!))
      .toBe('invalid')
    expect(await a.commit(null, null, record(0), fresh.lineage, empty.proof!))
      .toBe('committed')
    expect(await a.commit(null, null, record(0), fresh.lineage, empty.proof!))
      .toBe('invalid')
    const first = await checked(a), second = await checked(b)
    expect((await Promise.all([
      a.commit(0, fresh.lineage, record(1), undefined, first.proof!),
      b.commit(0, fresh.lineage, record(1), undefined, second.proof!),
    ])).sort()).toEqual(['committed', 'revision-changed'])
    expect(await a.commit(0, fresh.lineage, record(1), undefined,
      (await checked(a)).proof!)).toBe('invalid')
  })

  it('rejects invalid genesis, malformed slots, and altered proof bytes without writing', async () => {
    const factory = new FakeFactory(), store = createAtomicV16Store(factory)
    const empty = await checked(store)
    const forged = record(0)
    ;((forged.value as PublicV16Head).state.player as { coins: number }).coins++
    expect(await store.commit(null, null, forged, fresh.lineage, empty.proof!))
      .toBe('invalid')
    const stillEmpty = await store.read()
    expect(stillEmpty.status === 'ok' && stillEmpty.head).toBeNull()
    expect(await store.commit(null, null, record(0), fresh.lineage,
      (await checked(store)).proof!)).toBe('committed')
    const raw = await store.read()
    if (raw.status !== 'ok') throw new Error('Missing raw root')
    const issued = await checked(store)
    ;((issued.head as AtomicV16Record).value as PublicV16Head).state.discoveryMask[0] ^= 1
    expect(await store.commit(0, fresh.lineage, record(1), undefined, issued.proof!))
      .toBe('invalid')
    const before = await store.read()
    expect(before).toEqual(raw)
    const descriptorProof = await checked(store)
    Object.defineProperty((descriptorProof.head as AtomicV16Record).value,
      'hidden', { value: true })
    expect(await store.commit(0, fresh.lineage, record(1), undefined,
      descriptorProof.proof!)).toBe('invalid')
    const headProof = await checked(store)
    const changed = structuredClone(raw.head) as AtomicV16Record
    ;((changed.value as PublicV16Head).state.player as { coins: number }).coins++
    await putRaw(factory, 'head', changed)
    expect(await store.commit(0, fresh.lineage, record(1), undefined, headProof.proof!))
      .toBe('invalid')
    await putRaw(factory, 'head', raw.head)
    const lineageProof = await checked(store)
    await putRaw(factory, 'lineage', { malformed: true })
    expect(await store.commit(0, fresh.lineage, record(1), undefined,
      lineageProof.proof!)).toBe('lineage-changed')
    expect((await store.readChecked()).proof).toBeNull()
    await putRaw(factory, 'lineage', raw.lineage)
    const previousProof = await checked(store)
    await putRaw(factory, 'previous', { malformed: true })
    expect(await store.commit(0, fresh.lineage, record(1), undefined,
      previousProof.proof!)).toBe('invalid')
    expect((await store.readChecked()).proof).toBeNull()
  })

  it('does not issue a proof for partial, malformed, or unknown raw slots', async () => {
    const factory = new FakeFactory(), store = createAtomicV16Store(factory)
    await putRaw(factory, 'previous', record(0))
    expect((await store.readChecked()).proof).toBeNull()
    const clean = new FakeFactory(), other = createAtomicV16Store(clean)
    expect(await other.commit(null, null, record(0), fresh.lineage,
      (await checked(other)).proof!)).toBe('committed')
    await putRaw(clean, 'head', { malformed: true })
    expect((await other.readChecked()).proof).toBeNull()
    await putRaw(clean, 'future-slot', true)
    expect(await other.readChecked()).toEqual({ status: 'storage-error' })
  })
})
