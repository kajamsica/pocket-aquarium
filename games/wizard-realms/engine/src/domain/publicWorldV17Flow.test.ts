import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV16Store } from './atomicV16Database'
import { createAtomicV17Store } from './atomicV17Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { commitPublicV16FrameBatch, commitPublicV16GreenwayWork, inspectPublicV16,
  startFreshPublicV16 } from './publicWorldV16Flow'
import { resolvePublicV16GreenwaySite } from './publicWorldV16GreenwaySites'
import { encodePublicV16Head, PUBLIC_V16_DATABASE_NAME } from './publicWorldV16Snapshot'
import { publicV16StarterSupportAt } from './publicWorldV16StarterMovement'
import { commitPublicV17FrameBatch, commitPublicV17GreenwayWork, commitPublicV17TerrainWork,
  inspectPublicV17, resumePublicV17, startFreshPublicV17,
  startMigratedPublicV17 } from './publicWorldV17Flow'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { resolvePublicV14Surface } from './publicWorldV14Terrain'
import { createFreshPublicV17Head, decodePublicV17Head, encodePublicV17Head,
  PUBLIC_V17_DATABASE_NAME } from './publicWorldV17Snapshot'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { decodePublicV17Progress } from './publicWorldV17Validation'
import { resolveTerrainWorkSite } from './terrainWorks'

const seed = 'wizard-realms'
function locks() {
  let active = false
  return { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
    callback: () => Promise<T>): Promise<T> => {
    if (active) throw new Error('Nested world lock')
    active = true
    try { return await callback() } finally { active = false }
  } }
}
async function putRaw(factory: IDBFactory, key: string, value: unknown,
  name: string = PUBLIC_V17_DATABASE_NAME) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite')
      transaction.objectStore('records').put(value, key)
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
}

describe('v17 isolated checked root', () => {
  it('keeps v16 data intact across an under-lock migration and reload', async () => {
    const factory = new FakeFactory(), gate = locks()
    const v16 = createAtomicV16Store(factory), v17 = createAtomicV17Store(factory)
    const source = await startFreshPublicV16(gate, v16, seed)
    if (!source.ok) throw new Error(source.reason)
    const migrated = await startMigratedPublicV17(gate, v17, v16, source.value)
    expect(migrated.ok, migrated.ok ? '' : migrated.reason).toBe(true)
    if (!migrated.ok) return
    expect(migrated.value.lineage).toMatchObject({ origin: 'v16-migration',
      sourceReceipt: { saveRevision: 0 } })
    expect(await inspectPublicV16(gate, v16)).toMatchObject({ ok: true,
      value: { status: 'valid', start: source.value } })
    expect(await resumePublicV17(gate, v17, 0, migrated.value.lineage))
      .toEqual({ ok: true, value: migrated.value })
    expect(await inspectPublicV17(gate, v17)).toMatchObject({ ok: true,
      value: { status: 'valid', start: migrated.value } })
  })

  it('carries a checked built works3 bridge into the distinct v17 root', async () => {
    const factory = new FakeFactory(), gate = locks()
    const v16 = createAtomicV16Store(factory), v17 = createAtomicV17Store(factory)
    const source = await startFreshPublicV16(gate, v16, seed)
    if (!source.ok) throw new Error(source.reason)
    const site = resolvePublicV16GreenwaySite(seed, 'works3:bridge:1')
    if (!site || site.kind !== 'bridge' || site.blockingResourceIds.length) {
      throw new Error('Missing clear works3 bridge')
    }
    const state = source.value.state
    const point = { x: site.from.x, z: site.from.z - 0.6 }
    const y = publicV16StarterSupportAt({ seed, profile: state.generationProfile,
      route: state.greenway.routes[0] ?? null, built: false,
      greenwayWorks: source.value.greenwayWorks }, point)?.floorY
    if (y === undefined) throw new Error('Missing bank')
    const ready = { state: { ...state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(state.discoveryMask), ...site.footprintTileIds,
      ])].sort()),
      player: { ...state.player, position: { ...point, y },
        inventory: [...state.player.inventory, { itemId: 'logs' as const, quantity: 8 }] } },
    greenwayWorks: source.value.greenwayWorks }
    await putRaw(factory, 'previous', { saveRevision: 1,
      value: encodePublicV16Head(ready, 1, source.value.lineage) }, PUBLIC_V16_DATABASE_NAME)
    await putRaw(factory, 'head', { saveRevision: 2,
      value: encodePublicV16Head(ready, 2, source.value.lineage) }, PUBLIC_V16_DATABASE_NAME)
    const built = await commitPublicV16GreenwayWork(gate, v16, site.id, 2,
      source.value.lineage)
    if (!built.ok) throw new Error(built.reason)
    const sourceRead = await inspectPublicV16(gate, v16)
    if (!sourceRead.ok || sourceRead.value.status !== 'valid') {
      throw new Error('Source failed checked inspection')
    }
    const migrated = await startMigratedPublicV17(gate, v17, v16, sourceRead.value.start)
    expect(migrated.ok, migrated.ok ? '' : migrated.reason).toBe(true)
    if (!migrated.ok) return
    expect(migrated.value.greenwayWorks.builtBridgeIds).toEqual([site.id])
    expect(migrated.value.state.player.xp).toBe(built.value.start.state.player.xp)
    expect(await inspectPublicV17(gate, v17)).toMatchObject({ ok: true,
      value: { status: 'valid', start: { greenwayWorks: {
        builtBridgeIds: [site.id] } } } })
  })

  it('does not create a root from stale source revision', async () => {
    const factory = new FakeFactory(), gate = locks()
    const v16 = createAtomicV16Store(factory), v17 = createAtomicV17Store(factory)
    const source = await startFreshPublicV16(gate, v16, seed)
    if (!source.ok) throw new Error(source.reason)
    const newer = await commitPublicV16FrameBatch(gate, v16,
      [{ intents: [{ type: 'move', delta: { x: 0.1, z: 0 } }],
        walkRequested: true }], 0, source.value.lineage)
    expect(newer.ok, newer.ok ? '' : newer.reason).toBe(true)
    expect(await startMigratedPublicV17(gate, v17, v16, source.value)).toEqual({
      ok: false, reason: 'source-changed' })
    expect(await inspectPublicV17(gate, v17)).toEqual({ ok: true,
      value: { status: 'missing' } })
  })

  it('replays a bounded frame, rejects forged work, and leaves failed bytes alone', async () => {
    const factory = new FakeFactory(), gate = locks(), store = createAtomicV17Store(factory)
    const fresh = await startFreshPublicV17(gate, store, seed)
    if (!fresh.ok) throw new Error(fresh.reason)
    const frame = await commitPublicV17FrameBatch(gate, store,
      [{ intents: [{ type: 'move', delta: { x: 0.1, z: 0 } }],
        walkRequested: true }], 0, fresh.value.lineage)
    expect(frame.ok, frame.ok ? '' : frame.reason).toBe(true)
    if (!frame.ok) return
    const before = await store.read()
    expect(await commitPublicV17GreenwayWork(gate, store,
      'works4:bridge:greenway-creek:01', 1, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'invalid_site' })
    expect(await store.read()).toEqual(before)
    const raw = await store.read()
    if (raw.status !== 'ok' || !raw.head) throw new Error('Missing root')
    const tampered = structuredClone(raw.head) as { value: { state: { player: { xp: number } } } }
    tampered.value.state.player.xp += 80
    await putRaw(factory, 'head', tampered)
    expect(await inspectPublicV17(gate, store)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v17-history' } })
  })

  it('checks a works4 confirmation against the saved state and replays its cost', async () => {
    const factory = new FakeFactory(), gate = locks(), store = createAtomicV17Store(factory)
    const fresh = await startFreshPublicV17(gate, store, seed)
    if (!fresh.ok) throw new Error(fresh.reason)
    const site = resolvePublicV17GreenwaySite(seed,
      'works4:bridge:greenway-creek:0')
    if (!site || site.kind !== 'bridge' || site.blockingResourceIds.length) {
      throw new Error('Missing clear works4 bridge')
    }
    const point = { x: site.from.x, z: site.from.z - 0.6 }
    const y = publicV17StarterSupportAt({ seed,
      profile: fresh.value.state.generationProfile,
      route: fresh.value.state.greenway.routes[0] ?? null,
      built: false, greenwayWorks: fresh.value.greenwayWorks }, point)?.floorY
    if (y === undefined) throw new Error('Missing bank')
    const state = fresh.value.state
    const ready = { state: { ...state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(state.discoveryMask), ...site.footprintTileIds,
      ])].sort()),
      player: { ...state.player, position: { ...point, y },
        inventory: [...state.player.inventory, { itemId: 'logs' as const, quantity: 8 }] } },
    greenwayWorks: fresh.value.greenwayWorks }
    await putRaw(factory, 'previous', { saveRevision: 1,
      value: encodePublicV17Head(ready, 1, fresh.value.lineage) })
    await putRaw(factory, 'head', { saveRevision: 2,
      value: encodePublicV17Head(ready, 2, fresh.value.lineage) })
    const built = await commitPublicV17GreenwayWork(gate, store, site.id, 2,
      fresh.value.lineage)
    expect(built.ok, built.ok ? '' : built.reason).toBe(true)
    if (!built.ok) return
    expect(built.value.event).toMatchObject({ kind: 'bridge', logsSpent: 8, xp: 80 })
    expect(built.value.start.greenwayWorks.builtBridgeIds).toEqual([site.id])
    expect(await inspectPublicV17(gate, store)).toEqual({ ok: true,
      value: { status: 'valid', start: built.value.start } })
    expect(await commitPublicV17GreenwayWork(gate, store, site.id, 3,
      fresh.value.lineage)).toEqual({ ok: false, reason: 'already_done' })

    const ladder = resolvePublicV17GreenwaySite(seed,
      'works4:ladder:greenway-north-cliff:11')
    if (!ladder || ladder.kind !== 'ladder') throw new Error('Missing ladder')
    const ladderPoint = { x: ladder.from.x, z: ladder.from.z + 0.6 }
    const ladderY = publicV17StarterSupportAt({ seed,
      profile: built.value.start.state.generationProfile,
      route: built.value.start.state.greenway.routes[0] ?? null,
      built: false, greenwayWorks: built.value.start.greenwayWorks },
    ladderPoint)?.floorY
    if (ladderY === undefined) throw new Error('Missing ladder stance')
    const afterBridge = built.value.start
    const ladderReady = { state: { ...afterBridge.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(afterBridge.state.discoveryMask), ...ladder.footprintTileIds,
      ])].sort()),
      player: { ...afterBridge.state.player, position: { ...ladderPoint, y: ladderY },
        inventory: [...afterBridge.state.player.inventory,
          { itemId: 'logs' as const, quantity: 4 }] } },
    greenwayWorks: afterBridge.greenwayWorks }
    // A checked last-two fixture stands in for gathering and walking to the cliff.
    await putRaw(factory, 'previous', { saveRevision: 4,
      value: encodePublicV17Head(ladderReady, 4, fresh.value.lineage) })
    await putRaw(factory, 'head', { saveRevision: 5,
      value: encodePublicV17Head(ladderReady, 5, fresh.value.lineage) })
    expect(await inspectPublicV17(gate, store)).toMatchObject({ ok: true,
      value: { status: 'valid' } })
    const builtLadder = await commitPublicV17GreenwayWork(gate, store, ladder.id, 5,
      fresh.value.lineage)
    expect(builtLadder.ok, builtLadder.ok ? '' : builtLadder.reason).toBe(true)
    if (!builtLadder.ok) return
    expect(builtLadder.value.start.greenwayWorks).toMatchObject({
      builtBridgeIds: [site.id], builtLadderIds: [ladder.id] })
    expect(await inspectPublicV17(gate, store)).toEqual({ ok: true,
      value: { status: 'valid', start: builtLadder.value.start } })
  })

  it('validates works4 IDs and an isolated fresh root without weakening v16', () => {
    const { head, lineage } = createFreshPublicV17Head(seed)
    expect(decodePublicV17Progress({ state: head.state,
      greenwayWorks: head.greenwayWorks }, seed)).not.toBeNull()
    const forged = { ...head, greenwayWorks: { ...head.greenwayWorks,
      builtBridgeIds: ['works4:bridge:greenway-creek:01'] } }
    expect(decodePublicV17Head(forged, lineage)).toBeNull()
  })

  it.each([
    ['works1:bridge:-102:92:z', 8, 80],
    ['works1:ladder:-103:108:W', 4, 60],
  ] as const)('checks and restores Mireglass %s with one material charge',
    async (id, logCost, xp) => {
      const mireSeed = 'greenway-alpha'
      const factory = new FakeFactory(), gate = locks(), store = createAtomicV17Store(factory)
      const fresh = await startFreshPublicV17(gate, store, mireSeed)
      if (!fresh.ok) throw new Error(fresh.reason)
      const site = resolveTerrainWorkSite(mireSeed, id)
      if (!site || site.kind === 'dig') throw new Error(`Missing canonical ${id}`)
      const floor = resolvePublicV14Surface(fresh.value.state, site.from)
      if (!floor) throw new Error('Missing Mireglass approach support')
      const state = fresh.value.state
      const ready = { state: { ...state, tick: 1, movementOwner: 'streamed' as const,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(state.discoveryMask), floor.tileId,
          site.footprintTileIds[1],
        ])].sort()),
        player: { ...state.player, position: { ...site.from, y: floor.floorY },
          backpackCapacity: 30,
          inventory: [...state.player.inventory.filter((stack) => stack.itemId !== 'logs'),
            { itemId: 'logs' as const, quantity: 12 }] } },
      greenwayWorks: fresh.value.greenwayWorks }
      // The paired records represent prior checked travel and gathering, not a teleport action.
      await putRaw(factory, 'previous', { saveRevision: 1,
        value: encodePublicV17Head(ready, 1, fresh.value.lineage) })
      await putRaw(factory, 'head', { saveRevision: 2,
        value: encodePublicV17Head(ready, 2, fresh.value.lineage) })
      expect(await inspectPublicV17(gate, store)).toMatchObject({ ok: true,
        value: { status: 'valid' } })
      const built = await commitPublicV17TerrainWork(gate, store, id, 2,
        fresh.value.lineage)
      expect(built.ok, built.ok ? '' : built.reason).toBe(true)
      if (!built.ok) return
      expect(built.value.event).toMatchObject({ type: 'terrain_work_built', id,
        logsSpent: logCost, xp, stoneGained: 0 })
      expect(built.value.start.state.terrainWorks.builtWorkIds).toEqual([id])
      expect(built.value.start.state.player.inventory.filter((stack) => stack.itemId === 'logs')
        .reduce((sum, stack) => sum + stack.quantity, 0)).toBe(12 - logCost)
      expect(built.value.start.state.player.skillXp.construction).toBe(xp)
      expect(built.value.start.state.player.xp - state.player.xp).toBe(xp)
      expect(built.value.start.saveRevision).toBe(3)
      expect(await inspectPublicV17(gate, store)).toEqual({ ok: true,
        value: { status: 'valid', start: built.value.start } })
      expect(await resumePublicV17(gate, store, 3, fresh.value.lineage))
        .toEqual({ ok: true, value: built.value.start })
      const bytes = await store.read()
      expect(await commitPublicV17TerrainWork(gate, store, id, 3,
        fresh.value.lineage)).toEqual({ ok: false, reason: 'action-rejected' })
      expect(await store.read()).toEqual(bytes)
    })
})
