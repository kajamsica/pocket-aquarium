import { IDBDatabase as FakeDatabase, IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { DISCOVERY_MASK_BYTES } from './discoveryMask'
import { createAtomicV11Store } from './atomicV11Database'
import { createAtomicV12Store } from './atomicV12Database'
import type { AtomicV12Record } from './atomicV12Database'
import { createFreshPublicWorld } from './publicWorldState'
import { PUBLIC_V7_SCHEMA, serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
import { encodePublicV8Head } from './publicWorldV8Snapshot'
import { encodePublicV9Head } from './publicWorldV9Snapshot'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { encodePublicV10Head } from './publicWorldV10Snapshot'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { encodePublicV11Head } from './publicWorldV11Snapshot'
import { withPublicV11Highland } from './publicWorldV11State'
import { decodePublicV12Head, encodePublicV12Head, isValidPublicV12SourceReceipt } from './publicWorldV12Snapshot'
import type { PublicV12SourceReceipt } from './publicWorldV12Snapshot'
import { withPublicV12Windstep } from './publicWorldV12State'

const v7 = withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'))
const v9 = withFreshPublicV9Camps(v7)
const v10 = withPublicV10TerrainRevision(v9)
const v11 = withPublicV11Highland(v10)
const v12 = withPublicV12Windstep(v11)
const lineage: PublicV12SourceReceipt = { sourceV11Head: encodePublicV11Head(v11, null, 0),
  sourceV11Receipt: { sourceV10Head: encodePublicV10Head(v10, null, 0),
    sourceV10Lineage: { sourceV9Head: encodePublicV9Head(v9, null, 0),
      sourceV9Lineage: { sourceV8Head: encodePublicV8Head(v7, null, 2),
        sourceV7Bytes: `\n${serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
          saveRevision: 4, bootstrap: null, migrationSourceV6Bytes: null, state: v7 })}\n` } } } }
const record = (saveRevision: number): AtomicV12Record => ({ saveRevision,
  value: encodePublicV12Head({ ...v12,
    player: { ...v12.player, coins: v12.player.coins + saveRevision } }, null, saveRevision) })
const first = record(0)
const second = record(1)

async function putRaw(factory: IDBFactory, key: string, value: unknown) {
  const request = factory.open('wizard-realms:world:v12', 1)
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

describe('atomic v12 IndexedDB store', () => {
  it('publishes one pinned lineage, head and previous without modifying the v11 store', async () => {
    const factory = new FakeFactory()
    const old = createAtomicV11Store(factory)
    const before = await old.read()
    const store = createAtomicV12Store(factory)
    expect(await store.read()).toEqual({ status: 'ok', head: null, previous: null, lineage: null })
    expect(await store.commit(null, null, first, lineage)).toBe('committed')
    expect(await createAtomicV12Store(factory).read()).toEqual({ status: 'ok',
      head: first, previous: null, lineage })
    expect(await store.commit(0, lineage, second)).toBe('committed')
    expect(await createAtomicV12Store(factory).read()).toEqual({ status: 'ok',
      head: second, previous: first, lineage })
    expect(await old.read()).toEqual(before)
  })

  it('rejects stale writers, changed source receipt and skipped revisions', async () => {
    const factory = new FakeFactory()
    const a = createAtomicV12Store(factory)
    const b = createAtomicV12Store(factory)
    expect((await Promise.all([a.commit(null, null, first, lineage),
      b.commit(null, null, first, lineage)])).sort()).toEqual(['committed', 'revision-changed'])
    const changed = { ...lineage, sourceV11Head: encodePublicV11Head({ ...v11,
      player: { ...v11.player, coins: v11.player.coins + 1 } }, null, 1) }
    const before = await a.read()
    expect(await a.commit(0, changed, second)).toBe('lineage-changed')
    expect(await a.commit(1, lineage, record(2))).toBe('revision-changed')
    expect(await a.commit(0, lineage, record(2))).toBe('invalid')
    expect(await a.read()).toEqual(before)
    expect((await Promise.all([a.commit(0, lineage, second),
      b.commit(0, lineage, second)])).sort()).toEqual(['committed', 'revision-changed'])
  })

  it('rejects forged migration, malformed records, orphaned slots and unknown keys', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV12Store(factory)
    expect(await store.commit(null, null, { ...first, extra: true } as AtomicV12Record,
      lineage)).toBe('invalid')
    expect(await store.commit(null, null, record(1), lineage)).toBe('invalid')
    expect(await store.commit(null, null, { saveRevision: 0,
      value: encodePublicV12Head({ ...v12,
        player: { ...v12.player, coins: v12.player.coins + 1 } }, null, 0) }, lineage)).toBe('invalid')
    expect(await store.commit(null, null, first)).toBe('invalid')
    const invalidSource = { ...lineage,
      sourceV11Head: { ...lineage.sourceV11Head, schemaVersion: 'wizard-world/v10' } } as unknown as PublicV12SourceReceipt
    expect(await store.commit(null, null, first, invalidSource)).toBe('invalid')
    await putRaw(factory, 'future-slot', first)
    expect(await store.read()).toEqual({ status: 'storage-error' })
    expect(await store.commit(null, null, first, lineage)).toBe('invalid')
  })

  it('never overwrites a malformed previous recovery head', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV12Store(factory)
    expect(await store.commit(null, null, first, lineage)).toBe('committed')
    expect(await store.commit(0, lineage, second)).toBe('committed')
    await putRaw(factory, 'previous', { saveRevision: 0, value: {} })
    const before = await store.read()
    expect(await store.commit(1, lineage, record(2))).toBe('invalid')
    expect(await store.read()).toEqual(before)
  })

  it('keeps head, previous and lineage unchanged when the write transaction aborts', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV12Store(factory)
    expect(await store.commit(null, null, first, lineage)).toBe('committed')
    const checked = await store.readChecked()
    if (checked.status !== 'ok' || !checked.proof) throw new Error('Missing checked v12 read')
    const original = FakeDatabase.prototype.transaction
    const spy = vi.spyOn(FakeDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase, names, mode, options) {
      const transaction = original.call(this, names, mode, options)
      if (mode === 'readwrite') queueMicrotask(() => transaction.abort())
      return transaction
    })
    try {
      expect(await store.commit(0, lineage, second)).toBe('storage-error')
      expect(await store.commit(0, lineage, second, undefined, checked.proof)).toBe('storage-error')
    } finally { spy.mockRestore() }
    expect(await store.read()).toEqual({ status: 'ok', head: first, previous: null, lineage })
  })

  it('snapshots caller inputs before asynchronous IndexedDB publication', async () => {
    const store = createAtomicV12Store(new FakeFactory())
    const source = structuredClone(lineage)
    const next = record(0)
    const pending = store.commit(null, null, next, source)
    source.sourceV11Head.state.discoveryMask.fill(0)
    next.saveRevision = 8
    expect(await pending).toBe('committed')
    expect(await store.read()).toEqual({ status: 'ok', head: first, previous: null, lineage })
  })

  it('validates the detached value a direct caller actually publishes', async () => {
    const store = createAtomicV12Store(new FakeFactory())
    let reads = 0
    const next = { saveRevision: 0, get value() { return ++reads === 1 ? first.value : {} } }
    expect(await store.commit(null, null, next, lineage)).toBe('committed')
    expect(reads).toBe(1)
    expect(await store.read()).toEqual({ status: 'ok', head: first, previous: null, lineage })
  })

  it('accepts one store-issued read proof and rejects forgery, reuse and a foreign revision', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV12Store(factory)
    expect(await store.commit(null, null, first, lineage)).toBe('committed')
    const checked = await store.readChecked()
    if (checked.status !== 'ok' || !checked.proof) throw new Error('Missing checked v12 read')
    expect(checked.decodedHead?.saveRevision).toBe(0)
    expect(await store.commit(0, lineage, second, undefined, {})).toBe('invalid')
    expect(await store.commit(0, lineage, second, undefined, checked.proof)).toBe('committed')
    expect(await store.commit(0, lineage, second, undefined, checked.proof)).toBe('invalid')
    const stale = await store.readChecked()
    if (stale.status !== 'ok' || !stale.proof) throw new Error('Missing checked v12 read')
    expect(await store.commit(1, lineage, record(2))).toBe('committed')
    expect(await store.commit(1, lineage, record(2), undefined, stale.proof)).toBe('revision-changed')
  })

  it('refuses changed head bytes, previous recovery, lineage and unknown slots after a checked read', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV12Store(factory)
    expect(await store.commit(null, null, first, lineage)).toBe('committed')
    expect(await store.commit(0, lineage, second)).toBe('committed')
    const checked = await store.readChecked()
    if (checked.status !== 'ok' || !checked.proof) throw new Error('Missing checked v12 read')
    const changed = structuredClone(second)
    const changedHead = changed.value as ReturnType<typeof encodePublicV12Head>
    changedHead.state.discoveryMask[DISCOVERY_MASK_BYTES - 1] ^= 1
    expect(decodePublicV12Head(changedHead)).not.toBeNull()
    await putRaw(factory, 'head', changed)
    expect(await store.commit(1, lineage, record(2), undefined, checked.proof)).toBe('invalid')
    expect((await store.read()).status).toBe('ok')

    await putRaw(factory, 'head', second)
    const previousProof = await store.readChecked()
    if (previousProof.status !== 'ok' || !previousProof.proof) throw new Error('Missing checked v12 read')
    await putRaw(factory, 'previous', { saveRevision: 0, value: {} })
    expect(await store.commit(1, lineage, record(2), undefined, previousProof.proof)).toBe('invalid')

    await putRaw(factory, 'previous', first)
    const lineageProof = await store.readChecked()
    if (lineageProof.status !== 'ok' || !lineageProof.proof) throw new Error('Missing checked v12 read')
    const changedLineage = { ...lineage, sourceV11Head: encodePublicV11Head({ ...v11,
      player: { ...v11.player, coins: v11.player.coins + 1 } }, null, 1) }
    expect(isValidPublicV12SourceReceipt(changedLineage)).toBe(true)
    await putRaw(factory, 'lineage', changedLineage)
    expect(await store.commit(1, lineage, record(2), undefined, lineageProof.proof))
      .toBe('lineage-changed')

    await putRaw(factory, 'lineage', lineage)
    const slotProof = await store.readChecked()
    if (slotProof.status !== 'ok' || !slotProof.proof) throw new Error('Missing checked v12 read')
    await putRaw(factory, 'future-slot', first)
    expect(await store.commit(1, lineage, record(2), undefined, slotProof.proof)).toBe('invalid')
  })

  it('keeps cached decoded reads detached and advances only through a checked commit', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV12Store(factory)
    expect(await store.commit(null, null, first, lineage)).toBe('committed')
    const cold = await store.readChecked()
    if (cold.status !== 'ok' || !cold.proof || !cold.head || !cold.decodedHead) {
      throw new Error('Missing cold checked read')
    }
    ;(cold.head.value as ReturnType<typeof encodePublicV12Head>).state.discoveryMask.fill(0)
    ;(cold.decodedHead.state.player as { coins: number }).coins = 999
    const hot = await store.readChecked()
    if (hot.status !== 'ok' || !hot.proof || !hot.decodedHead) throw new Error('Missing hot checked read')
    expect(hot.proof).not.toBe(cold.proof)
    expect(hot.head).toEqual(first)
    expect(hot.decodedHead.state.player.coins).toBe(v12.player.coins)
    expect(await store.commit(0, lineage, second, undefined, hot.proof)).toBe('committed')
    const advanced = await store.readChecked()
    if (advanced.status !== 'ok' || !advanced.proof) throw new Error('Missing advanced checked read')
    expect(advanced.head).toEqual(second)
    expect(advanced.previous).toEqual(first)
    const reopened = await createAtomicV12Store(factory).readChecked()
    expect(reopened.status).toBe('ok')
    if (reopened.status !== 'ok') return
    expect(reopened.head).toEqual(second)
    expect(reopened.proof).not.toBeNull()
    expect(await store.commit(1, lineage, record(2))).toBe('committed')
    const afterRaw = await store.readChecked()
    if (afterRaw.status !== 'ok') throw new Error('Missing read after raw commit')
    expect(afterRaw.head).toEqual(record(2))
    expect(afterRaw.previous).toEqual(second)
    expect(await store.commit(1, lineage, record(2), undefined, advanced.proof)).toBe('revision-changed')
  })

  it('cold-validates every changed slot before a cached read can be reused', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV12Store(factory)
    expect(await store.commit(null, null, first, lineage)).toBe('committed')
    expect(await store.commit(0, lineage, second)).toBe('committed')
    expect((await store.readChecked()).status).toBe('ok')
    const warm = await store.readChecked()
    if (warm.status !== 'ok' || !warm.proof) throw new Error('Missing warm checked read')

    const changed = structuredClone(second)
    const changedHead = changed.value as ReturnType<typeof encodePublicV12Head>
    changedHead.state.discoveryMask[DISCOVERY_MASK_BYTES - 1] ^= 1
    await putRaw(factory, 'head', changed)
    const maskRead = await store.readChecked()
    if (maskRead.status !== 'ok') throw new Error('Missing changed mask read')
    expect(maskRead.decodedHead).toEqual(decodePublicV12Head(changedHead))
    expect(maskRead.proof).not.toBeNull()

    await putRaw(factory, 'head', second)
    expect((await store.readChecked()).status).toBe('ok')
    await putRaw(factory, 'previous', { saveRevision: 0, value: {} })
    const previousRead = await store.readChecked()
    expect(previousRead.status).toBe('ok')
    if (previousRead.status !== 'ok') return
    expect(previousRead.proof).toBeNull()
    await putRaw(factory, 'previous', first)
    expect((await store.readChecked()).status).toBe('ok')
    await putRaw(factory, 'lineage', { sourceV11Head: {} })
    const lineageRead = await store.readChecked()
    expect(lineageRead.status).toBe('ok')
    if (lineageRead.status !== 'ok') return
    expect(lineageRead.lineageValid).toBe(false)
    expect(lineageRead.proof).toBeNull()
    await putRaw(factory, 'lineage', lineage)
    expect((await store.readChecked()).status).toBe('ok')
    await putRaw(factory, 'future-slot', first)
    expect(await store.readChecked()).toEqual({ status: 'storage-error' })
  })
})
