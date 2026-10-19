import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV42Store } from './atomicV42Database'
import { createAtomicV43Store } from './atomicV43Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { confirmPublicV43BagUpgrade, createPublicV43BagUpgrade,
  GREENWAY_BAG_UPGRADE } from './publicWorldV43BagUpgrade'
import { commitPublicV43, resumePublicV43, startPublicV43 } from './publicWorldV43Flow'
import { createFreshPublicV42Root, decodePublicV42Root,
  PUBLIC_V42_DATABASE_NAME, PUBLIC_V42_SCHEMA } from './publicWorldV42Snapshot'
import type { PublicV42Root } from './publicWorldV42Snapshot'
import { createPublicV43Root, decodePublicV43Root,
  replayPublicV43Witness } from './publicWorldV43Snapshot'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'
import { waystationRiverSite } from './waystationRiverContent'

const seed = 'wizard-realms'
const buy = { kind: 'buy-greenway-backpack/v1' } as const
const locks = { request: async (_name: string, _options: unknown,
  body: () => Promise<unknown>) => body() }

function outfittersSource(coins = 120, logs = 0, near = true): PublicV42Root {
  const source = createFreshPublicV42Root(seed)
  const store = source.head.state.greenway.stores.find((entry) =>
    entry.id === GREENWAY_BAG_UPGRADE.storeId)!
  const genesis = { ...source.lineage.genesis,
    state: { ...source.head.state,
      player: { ...source.head.state.player, coins,
        position: near ? { ...store.position } : source.head.state.player.position,
        inventory: [...source.head.state.player.inventory,
          ...(logs ? [{ itemId: 'logs' as const, quantity: logs }] : [])] } } }
  const root: PublicV42Root = { lineage: { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed, sourceRevision: 0, genesis },
  previous: null, head: { ...structuredClone(genesis), schemaVersion: PUBLIC_V42_SCHEMA,
    saveRevision: 0, witness: null } }
  expect(decodePublicV42Root(root)).not.toBeNull()
  return root
}

function wrongRegionSource(): PublicV42Root {
  const source = createFreshPublicV42Root(seed)
  const site = resolveSedgehornFamiliarSite(source.lineage.genesis)!
  const bridge = waystationRiverSite(seed)!
  const genesis = { ...source.lineage.genesis, southbankReached: true,
    riverBridgeIds: [bridge.id], state: { ...source.head.state,
      movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(source.head.state.discoveryMask),
        ...bridge.footprintTileIds, site.tracks.id,
      ])].sort()),
      player: { ...source.head.state.player,
        position: { ...site.tracks.center }, verticalVelocity: 0 } } }
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

describe('checked V43 Greenway backpack upgrade', () => {
  it('replays a fixed 70-coin purchase without mutating or auto-upgrading an older save', () => {
    const root = createPublicV43Root(outfittersSource())
    expect(decodePublicV43Root(root)).not.toBeNull()
    expect(root.head.state.player.backpackCapacity).toBe(20)
    expect(Object.hasOwn(root.head, 'greenwayBagUpgrade')).toBe(false)
    const next = replayPublicV43Witness(root.head, buy)!
    expect(next.state.player).toMatchObject({ coins: 50, backpackCapacity: 28 })
    expect(next.greenwayBagUpgrade?.claimedAtSequence)
      .toBe(root.head.state.eventSequence + 1)
    expect(root.head.state.player).toMatchObject({ coins: 120, backpackCapacity: 20 })
    const saved = { lineage: root.lineage, previous: root.head,
      head: { ...next, schemaVersion: root.head.schemaVersion,
        saveRevision: 1, witness: buy } }
    expect(decodePublicV43Root(saved)).not.toBeNull()
    expect(replayPublicV43Witness(saved.head, buy)).toBeNull()
    expect(replayPublicV43Witness(root.head, { ...buy, price: 0 })).toBeNull()
    expect(decodePublicV43Root({ ...saved, head: { ...saved.head,
      state: { ...saved.head.state, player: { ...saved.head.state.player,
        backpackCapacity: 29 } } } })).toBeNull()
    expect(decodePublicV43Root({ ...saved, head: { ...saved.head,
      greenwayBagUpgrade: { claimedAtSequence: null } } })).toBeNull()
    expect(decodePublicV43Root({ ...saved, head: { ...saved.head,
      state: { ...saved.head.state, player: { ...saved.head.state.player,
        coins: 51 } } } })).toBeNull()
  })

  it('migrates a V42 save, commits atomically, resumes 28 slots, and rejects stale or duplicate writes',
    async () => {
      const factory = new IDBFactory(), source = outfittersSource()
      const oldStore = createAtomicV42Store(factory), store = createAtomicV43Store(factory)
      await putRaw(factory, source)
      const started = await startPublicV43(locks as never, store, oldStore, 0)
      if (!started.ok) throw new Error(started.reason)
      expect(started.value.head.state.player.backpackCapacity).toBe(20)
      const bought = await commitPublicV43(locks as never, store, oldStore,
        0, started.value.lineage, buy)
      if (!bought.ok) throw new Error(bought.reason)
      expect(bought.value.head.state.player).toMatchObject({ coins: 50, backpackCapacity: 28 })
      expect((await resumePublicV43(locks as never, store, oldStore,
        1, bought.value.lineage))).toEqual(bought)
      expect(await commitPublicV43(locks as never, store, oldStore,
        0, bought.value.lineage, buy)).toEqual({ ok: false, reason: 'revision-changed' })
      expect(await commitPublicV43(locks as never, store, oldStore,
        1, bought.value.lineage, buy)).toEqual({ ok: false, reason: 'already_purchased' })
      expect((await store.readChecked())).toMatchObject({ status: 'valid', root: { head: {
        saveRevision: 1, state: { player: { coins: 50, backpackCapacity: 28 } } } } })
      expect((await oldStore.readForPromotion())).toMatchObject({ status: 'valid',
        root: source, marker: { phase: 'finalized' } })
    })

  it('allows a full pack, rejects too far and insufficient coins, and preserves the upgrade after a frame', () => {
    const full = createPublicV43Root(outfittersSource(120, 19))
    expect(full.head.state.player.inventory.reduce((sum, row) => sum + row.quantity, 0))
      .toBe(20)
    const bag = createPublicV43BagUpgrade(full.head)!
    const result = confirmPublicV43BagUpgrade(bag, buy)
    expect(result.progress?.state.player.inventory).toEqual(full.head.state.player.inventory)
    expect(result.progress?.state.player.backpackCapacity).toBe(28)
    expect(confirmPublicV43BagUpgrade(bag, { ...buy, extraSlots: 100 }))
      .toEqual({ rejection: 'invalid_action' })
    const poor = createPublicV43BagUpgrade(createPublicV43Root(outfittersSource(69)).head)!
    expect(confirmPublicV43BagUpgrade(poor, buy)).toEqual({ rejection: 'insufficient_coins' })
    expect(poor.state.player.coins).toBe(69)
    const far = createPublicV43BagUpgrade(createPublicV43Root(outfittersSource(120, 0, false)).head)!
    expect(confirmPublicV43BagUpgrade(far, buy)).toEqual({ rejection: 'too_far' })
    expect(far.state.player.backpackCapacity).toBe(20)
    const wrong = createPublicV43BagUpgrade(createPublicV43Root(wrongRegionSource()).head)!
    expect(confirmPublicV43BagUpgrade(wrong, buy)).toEqual({ rejection: 'unavailable_here' })
    expect(wrong.state.player).toEqual(createPublicV43Root(wrongRegionSource()).head.state.player)
    const airborne = { ...bag, state: { ...bag.state,
      player: { ...bag.state.player, verticalVelocity: 1 } } }
    expect(confirmPublicV43BagUpgrade(airborne, buy)).toEqual({ rejection: 'invalid_progress' })
    expect(airborne.state.player.coins).toBe(120)
    const after = replayPublicV43Witness(full.head, buy)!
    const framed = replayPublicV43Witness(after,
      { kind: 'frame-batch/v1', frames: [{ intents: [], walkRequested: true }] })
    expect(framed?.greenwayBagUpgrade).toEqual(after.greenwayBagUpgrade)
    expect(framed?.state.player.backpackCapacity).toBe(28)
    const ordered = replayPublicV43Witness(after, { kind: 'fulfill-greenway-logs/v1' })
    expect(ordered?.greenwayBagUpgrade).toEqual(after.greenwayBagUpgrade)
    expect(ordered?.state.player.backpackCapacity).toBe(28)
  })

  it('keeps checked heads unchanged after far, poor, and wrong-region purchases', async () => {
    for (const [source, reason] of [
      [outfittersSource(120, 0, false), 'too_far'],
      [outfittersSource(69), 'insufficient_coins'],
      [wrongRegionSource(), 'unavailable_here'],
    ] as const) {
      const factory = new IDBFactory()
      const oldStore = createAtomicV42Store(factory), store = createAtomicV43Store(factory)
      await putRaw(factory, source)
      const started = await startPublicV43(locks as never, store, oldStore, 0)
      if (!started.ok) throw new Error(started.reason)
      const before = await store.readChecked()
      expect(before.status).toBe('valid')
      expect(await commitPublicV43(locks as never, store, oldStore,
        0, started.value.lineage, buy)).toEqual({ ok: false, reason })
      expect(await store.readChecked()).toEqual(before)
      expect(started.value.head).not.toHaveProperty('greenwayBagUpgrade')
      expect(started.value.head.state.player.backpackCapacity).toBe(20)
    }
  })

  it('resumes a nonzero-revision legacy V43 head without a bag overlay, then purchases', async () => {
    const factory = new IDBFactory(), source = outfittersSource()
    const oldStore = createAtomicV42Store(factory), store = createAtomicV43Store(factory)
    await putRaw(factory, source)
    const started = await startPublicV43(locks as never, store, oldStore, 0)
    if (!started.ok) throw new Error(started.reason)
    const moved = await commitPublicV43(locks as never, store, oldStore,
      0, started.value.lineage, { kind: 'frame-batch/v1',
        frames: [{ intents: [], walkRequested: true }] })
    if (!moved.ok) throw new Error(moved.reason)
    expect(moved.value.head.saveRevision).toBe(1)
    expect(moved.value.head).not.toHaveProperty('greenwayBagUpgrade')
    const reopened = createAtomicV43Store(factory)
    const resumed = await resumePublicV43(locks as never, reopened, oldStore,
      1, moved.value.lineage)
    expect(resumed).toEqual(moved)
    const bought = await commitPublicV43(locks as never, reopened, oldStore,
      1, moved.value.lineage, buy)
    if (!bought.ok) throw new Error(bought.reason)
    expect(bought.value.head.state.player).toMatchObject({ coins: 50, backpackCapacity: 28 })
    expect((await resumePublicV43(locks as never, reopened, oldStore,
      2, bought.value.lineage))).toEqual(bought)
  })
})
