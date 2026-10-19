import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV42Store } from './atomicV42Database'
import { createAtomicV43Store } from './atomicV43Database'
import { GREENWAY_LOG_ORDER } from './greenwayProcurementOrder'
import { commitPublicV43, resumePublicV43, startPublicV43 } from './publicWorldV43Flow'
import { createFreshPublicV42Root, decodePublicV42Root,
  PUBLIC_V42_DATABASE_NAME, PUBLIC_V42_SCHEMA } from './publicWorldV42Snapshot'
import type { PublicV42Root } from './publicWorldV42Snapshot'
import { createPublicV43Root, decodePublicV43Root,
  replayPublicV43Witness } from './publicWorldV43Snapshot'

const seed = 'wizard-realms'
const fulfill = { kind: 'fulfill-greenway-logs/v1' } as const
const locks = { request: async (_name: string, _options: unknown,
  body: () => Promise<unknown>) => body() }

function orderSource(logs = 4): PublicV42Root {
  const source = createFreshPublicV42Root(seed)
  const store = source.head.state.greenway.stores.find((entry) =>
    entry.id === GREENWAY_LOG_ORDER.destinationStoreId)!
  const genesis = { ...source.lineage.genesis,
    state: { ...source.head.state,
      player: { ...source.head.state.player,
        position: { ...store.position },
        inventory: [...source.head.state.player.inventory,
          { itemId: 'logs' as const, quantity: logs }] } } }
  const root: PublicV42Root = { lineage: { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed, sourceRevision: 0, genesis },
  previous: null, head: { ...structuredClone(genesis), schemaVersion: PUBLIC_V42_SCHEMA,
    saveRevision: 0, witness: null } }
  expect(decodePublicV42Root(root)).not.toBeNull()
  return root
}

async function putRaw(factory: IDBFactory, root: PublicV42Root) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(PUBLIC_V42_DATABASE_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').put(root, 'root')
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}

describe('checked V43 Greenway NPC log order', () => {
  it('preserves legacy heads and accepts only a fixed, replayed one-time exchange', () => {
    const root = createPublicV43Root(orderSource())
    expect(decodePublicV43Root(root)).not.toBeNull()
    expect(Object.hasOwn(root.head, 'greenwayOrder')).toBe(false)
    const progress = replayPublicV43Witness(root.head, fulfill)!
    expect(progress.greenwayOrder?.claimedAtSequence).toBe(root.head.state.eventSequence + 1)
    expect(progress.state.player.coins).toBe(root.head.state.player.coins + 10)
    expect(progress.state.player.inventory.some((row) => row.itemId === 'logs')).toBe(false)
    expect(progress.familiar).toEqual(root.head.familiar)
    const next = { lineage: root.lineage, previous: root.head,
      head: { ...progress, schemaVersion: root.head.schemaVersion,
        saveRevision: 1, witness: fulfill } }
    expect(decodePublicV43Root(next)).not.toBeNull()
    expect(replayPublicV43Witness(next.head, fulfill)).toBeNull()
    expect(replayPublicV43Witness(root.head,
      { ...fulfill, payCoins: 1000 })).toBeNull()
    expect(decodePublicV43Root({ ...next, head: { ...next.head,
      greenwayOrder: { claimedAtSequence: null } } })).toBeNull()
    const { greenwayOrder: _removed, ...withoutOrder } = next.head
    expect(decodePublicV43Root({ ...next, head: withoutOrder })).toBeNull()
    expect(decodePublicV43Root({ ...next, head: { ...next.head,
      state: { ...next.head.state, player: { ...next.head.state.player,
        coins: next.head.state.player.coins + 1 } } } })).toBeNull()
  })

  it('commits and resumes the order under the V42 fence; stale and duplicate writes do not pay',
    async () => {
      const factory = new IDBFactory(), source = orderSource()
      const oldStore = createAtomicV42Store(factory), store = createAtomicV43Store(factory)
      await putRaw(factory, source)
      const started = await startPublicV43(locks as never, store, oldStore, 0)
      if (!started.ok) throw new Error(started.reason)
      expect((await oldStore.readChecked()).status).toBe('blocked')
      const beforeCoins = started.value.head.state.player.coins
      const completed = await commitPublicV43(locks as never, store, oldStore,
        0, started.value.lineage, fulfill)
      if (!completed.ok) throw new Error(completed.reason)
      expect(completed.value.head.state.player.coins).toBe(beforeCoins + 10)
      expect(completed.value.head.state.player.inventory.filter((row) =>
        row.itemId === 'logs')).toEqual([])
      expect(completed.value.head.greenwayOrder?.claimedAtSequence)
        .toBe(completed.value.head.state.eventSequence)
      expect(await resumePublicV43(locks as never, store, oldStore,
        1, completed.value.lineage)).toEqual(completed)
      expect(await commitPublicV43(locks as never, store, oldStore,
        0, completed.value.lineage, fulfill))
        .toEqual({ ok: false, reason: 'revision-changed' })
      expect(await commitPublicV43(locks as never, store, oldStore,
        1, completed.value.lineage, fulfill))
        .toEqual({ ok: false, reason: 'already_fulfilled' })
      expect((await store.readChecked())).toMatchObject({ status: 'valid',
        root: { head: { saveRevision: 1, state: { player: { coins: beforeCoins + 10 } } } } })
      expect((await oldStore.readForPromotion())).toMatchObject({ status: 'valid',
        root: source, marker: { phase: 'finalized' } })
    })

  it('rejects insufficient logs and preserves the claimed order across later frames', async () => {
    const poor = createPublicV43Root(orderSource(3))
    expect(replayPublicV43Witness(poor.head, fulfill)).toBeNull()
    const factory = new IDBFactory(), source = orderSource()
    const oldStore = createAtomicV42Store(factory), store = createAtomicV43Store(factory)
    await putRaw(factory, source)
    const start = await startPublicV43(locks as never, store, oldStore, 0)
    if (!start.ok) throw new Error(start.reason)
    expect(await commitPublicV43(locks as never, store, oldStore,
      0, start.value.lineage, { kind: 'fulfill-greenway-logs/v1', quantity: 1 } as never))
      .toEqual({ ok: false, reason: 'invalid-witness' })
    const ordered = await commitPublicV43(locks as never, store, oldStore,
      0, start.value.lineage, fulfill)
    if (!ordered.ok) throw new Error(ordered.reason)
    const moved = await commitPublicV43(locks as never, store, oldStore,
      1, ordered.value.lineage, { kind: 'frame-batch/v1',
        frames: [{ intents: [], walkRequested: true }] })
    if (!moved.ok) throw new Error(moved.reason)
    expect(moved.value.head.greenwayOrder).toEqual(ordered.value.head.greenwayOrder)
    expect((await store.readChecked()).status).toBe('valid')
    expect(await commitPublicV43(locks as never, store, oldStore,
      2, moved.value.lineage, fulfill))
      .toEqual({ ok: false, reason: 'already_fulfilled' })
  })

  it('accepts a full pack because logs leave and coin does not consume a slot', () => {
    const starter = orderSource()
    const occupied = starter.head.state.player.inventory.reduce((sum, row) =>
      sum + (row.itemId === 'logs' ? 0 : row.quantity), 0)
    const count = starter.head.state.player.backpackCapacity - occupied
    const root = createPublicV43Root(orderSource(count))
    expect(root.head.state.player.inventory.reduce((sum, row) =>
      sum + row.quantity, 0)).toBe(root.head.state.player.backpackCapacity)
    const after = replayPublicV43Witness(root.head, fulfill)
    expect(after).not.toBeNull()
    expect(after!.state.player.inventory.reduce((sum, row) =>
      sum + row.quantity, 0)).toBe(root.head.state.player.backpackCapacity - 4)
    expect(after!.state.player.coins).toBe(root.head.state.player.coins + 10)
  })
})
