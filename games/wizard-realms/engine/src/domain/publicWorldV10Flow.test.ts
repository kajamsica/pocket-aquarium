import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV8Store } from './atomicV8Database'
import { createAtomicV9Store } from './atomicV9Database'
import { createAtomicV10Store } from './atomicV10Database'
import { applyFieldCampAction } from './fieldCamp'
import { mireglassAnchors } from './mireglassContent'
import { actPublicMireglass } from './publicWorldActions'
import { createFreshPublicWorld } from './publicWorldState'
import type { PublicWorldState } from './publicWorldState'
import { PUBLIC_V7_LOCK_NAME, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA,
  serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
import type { PublicWorldV7State } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { commitPublicV8Snapshot, migratePublicV7ToV8 } from './publicWorldV8Flow'
import { encodePublicV8Head } from './publicWorldV8Snapshot'
import { commitPublicV9Snapshot, migratePublicV8ToV9 } from './publicWorldV9Flow'
import { encodePublicV9Head } from './publicWorldV9Snapshot'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { commitPublicV10Snapshot, inspectPublicV10, migratePublicV9ToV10, resumePublicV10 } from './publicWorldV10Flow'
import { encodePublicV10Head } from './publicWorldV10Snapshot'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

async function fixture() {
  const base = withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'))
  const bytes = `\n${serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
    saveRevision: 4, bootstrap: null, migrationSourceV6Bytes: null, state: base })}\n`
  const values = new Map([[PUBLIC_V7_ROOT_KEY, bytes]])
  const writes: string[] = []
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push(key); values.set(key, value) } }
  const names: string[] = []
  let held = false
  const locks: PublicV7LockProvider = { request: async (name, options, callback) => {
    expect(held, 'Nested Web Lock request').toBe(false)
    expect(options).toEqual({ mode: 'exclusive' })
    names.push(name)
    held = true
    try { return await callback() } finally { held = false }
  } }
  const factory = new FakeFactory()
  const v8 = createAtomicV8Store(factory)
  const v9 = createAtomicV9Store(factory)
  const v10 = createAtomicV10Store(factory)
  await migratePublicV7ToV8(storage, locks, v8, bytes)
  const state = { ...base, player: { ...base.player, coins: 17 } }
  await commitPublicV8Snapshot(storage, locks, v8, state, 0)
  const v9Source = { sourceV8Head: encodePublicV8Head(state, null, 1), sourceV7Bytes: bytes }
  const fresh = withFreshPublicV9Camps(state)
  expect((await migratePublicV8ToV9(storage, locks, v8, v9, v9Source)).ok).toBe(true)
  const v10Source = { sourceV9Head: encodePublicV9Head(fresh, null, 0), sourceV9Lineage: v9Source }
  names.length = 0
  return { factory, bytes, values, writes, storage, names, locks, v8, v9, v10,
    state, fresh, v9Source, v10Source, v10State: withPublicV10TerrainRevision(fresh) }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const inspect = (f: Fixture) => inspectPublicV10(f.storage, f.locks, f.v8, f.v9, f.v10)
const migrate = (f: Fixture) => migratePublicV9ToV10(f.storage, f.locks, f.v8, f.v9, f.v10, f.v10Source)
const save = (f: Fixture, state = f.v10State, revision = 0) =>
  commitPublicV10Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10, state, revision, f.v10Source)

async function putRaw(f: Fixture, version: 9 | 10, key: string, value: unknown) {
  const request = f.factory.open(`wizard-realms:world:v${version}`, 1)
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

function placedCamp(f: Fixture) {
  const tile = worldTileAtGrid(f.state.seed, -76, 100)
  const { terrainRevision: _terrainRevision, ...v9State } = f.v10State
  const built = applyFieldCampAction({ ...v9State, movementOwner: 'streamed',
    player: { ...v9State.player, position: { ...tile.center },
      inventory: [...v9State.player.inventory, { itemId: 'logs', quantity: 4 }, { itemId: 'stone', quantity: 1 }] },
    discoveredTileIds: [...v9State.discoveredTileIds, tile.id].sort() }, tile.id, null)
  if (built.rejection) throw new Error(built.rejection.code)
  return withPublicV10TerrainRevision(built.state)
}

async function excavatedSource(f: Fixture) {
  const anchors = mireglassAnchors(f.state.seed)
  const at = (position: typeof anchors.sealCache.tile.center, state: PublicWorldState = f.state): PublicWorldState => ({ ...state,
    movementOwner: 'streamed' as const, player: { ...state.player, position: { ...position }, verticalVelocity: 0 },
    discoveredTileIds: [...new Set([...state.discoveredTileIds,
      worldTileAtGrid(state.seed, position.x / WORLD_CELL_METERS, position.z / WORLD_CELL_METERS).id])].sort() })
  const marker = actPublicMireglass(at(anchors.fringeMarker.tile.center), { type: 'study_fringe_marker' })
  if (marker.rejection) throw new Error(marker.rejection.code)
  const cache = actPublicMireglass(at(anchors.sealCache.tile.center, marker.state), { type: 'cast_wayfinder_glow' })
  if (cache.rejection) throw new Error(cache.rejection.code)
  const ready: PublicWorldState = { ...cache.state, player: { ...cache.state.player,
    skillXp: { ...cache.state.player.skillXp, excavation: 30 },
    inventory: [...cache.state.player.inventory, { itemId: 'field_spade', quantity: 1 }],
    equipment: { ...cache.state.player.equipment, mainHand: 'field_spade' } } }
  const dug = actPublicMireglass(ready, { type: 'excavate_cache' })
  if (dug.rejection) throw new Error(dug.rejection.code)
  const v7State: PublicWorldV7State = { ...dug.state, mireglass: { ...dug.state.mireglass,
    herbHarvestCycles: f.state.mireglass.herbHarvestCycles } }
  expect((await commitPublicV8Snapshot(f.storage, f.locks, f.v8, v7State, 1)).ok).toBe(true)
  const v9Source = { sourceV8Head: encodePublicV8Head(v7State, null, 2), sourceV7Bytes: f.bytes }
  const fresh = withFreshPublicV9Camps(v7State)
  const v9 = createAtomicV9Store(new FakeFactory())
  expect((await migratePublicV8ToV9(f.storage, f.locks, f.v8, v9, v9Source)).ok).toBe(true)
  const v10 = createAtomicV10Store(new FakeFactory())
  const v10Source = { sourceV9Head: encodePublicV9Head(fresh, null, 0), sourceV9Lineage: v9Source }
  return { ...f, v9, v10, fresh, v9Source, v10Source, v10State: withPublicV10TerrainRevision(fresh) }
}

describe('public v10 migration and source coherence', () => {
  it('does not create an independent branch without a valid v9 source', async () => {
    const f = await fixture()
    const noV9 = { ...f, v9: createAtomicV9Store(new FakeFactory()), v10: createAtomicV10Store(new FakeFactory()) }
    expect(await inspect(noV9)).toEqual({ ok: true, value: { status: 'missing', sourceReceipt: null } })
    expect(await migrate(noV9)).toEqual({ ok: false, reason: 'v9-missing' })
    await migrate(f)
    const orphan = { ...f, v9: noV9.v9 }
    expect(await inspect(orphan)).toEqual({ ok: true, value: { status: 'blocked', reason: 'v9-missing' } })
  })

  it('pins the exact v9 head and lineage under one lock without changing older saves', async () => {
    const f = await fixture()
    const beforeV8 = await f.v8.read()
    const beforeV9 = await f.v9.read()
    expect(await inspect(f)).toEqual({ ok: true, value: { status: 'missing', sourceReceipt: f.v10Source } })
    const start = { state: f.v10State, saveRevision: 0, sourceReceipt: f.v10Source }
    expect(await migrate(f)).toEqual({ ok: true, value: start })
    expect(await inspect(f)).toEqual({ ok: true, value: { status: 'valid', start } })
    expect(await resumePublicV10(f.storage, f.locks, f.v8, f.v9, f.v10, 0, f.v10Source))
      .toEqual({ ok: true, value: start })
    expect(await migrate(f)).toEqual({ ok: false, reason: 'v10-records-present' })
    expect(await f.v10.read()).toEqual({ status: 'ok', head: { saveRevision: 0,
      value: encodePublicV10Head(f.v10State, null, 0) }, previous: null, lineage: f.v10Source })
    expect(await f.v8.read()).toEqual(beforeV8)
    expect(await f.v9.read()).toEqual(beforeV9)
    expect(f.storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(f.bytes)
    expect(f.writes).toEqual([])
    expect(f.names).toEqual(Array(5).fill(PUBLIC_V7_LOCK_NAME))
  })

  it('keeps a built camp in head and previous, rejects stale saves and deletion', async () => {
    const f = await fixture()
    await migrate(f)
    const initial = await f.v10.read()
    const camp = placedCamp(f)
    expect((await save(f, camp)).ok).toBe(true)
    expect(await f.v10.read()).toMatchObject({ previous: initial.status === 'ok' ? initial.head : null })
    expect(await resumePublicV10(f.storage, f.locks, f.v8, f.v9,
      createAtomicV10Store(f.factory), 1, f.v10Source))
      .toEqual({ ok: true, value: { state: camp, saveRevision: 1, sourceReceipt: f.v10Source } })
    const before = await f.v10.read()
    expect(await save(f, f.v10State, 1)).toEqual({ ok: false, reason: 'invalid-v10-camp-history' })
    expect(await save(f, camp)).toEqual({ ok: false, reason: 'revision-changed' })
    expect(await f.v10.read()).toEqual(before)
    expect((await save(f, camp, 1)).ok).toBe(true)
    await putRaw(f, 10, 'head', { saveRevision: 2, value: encodePublicV10Head(f.v10State, null, 2) })
    expect(await inspect(f)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v10-camp-history' } })
  })

  it('blocks v10 after a newer v9 write or malformed prior v9 record', async () => {
    const f = await fixture()
    await migrate(f)
    const before = await f.v10.read()
    const changed = { ...f.fresh, player: { ...f.fresh.player, coins: 22 } }
    expect((await commitPublicV9Snapshot(f.storage, f.locks, f.v8, f.v9,
      changed, 0, f.v9Source)).ok).toBe(true)
    expect(await inspect(f)).toEqual({ ok: true, value: { status: 'blocked', reason: 'source-changed' } })
    expect(await save(f)).toEqual({ ok: false, reason: 'source-changed' })
    expect(await f.v10.read()).toEqual(before)
    await putRaw(f, 9, 'previous', {})
    expect(await inspect(f)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v9-previous' } })
  })

  it('detects a changed v9 head even if its revision number stays the same', async () => {
    const f = await fixture()
    const saved = { ...f.fresh, player: { ...f.fresh.player, coins: 18 } }
    expect((await commitPublicV9Snapshot(f.storage, f.locks, f.v8, f.v9,
      saved, 0, f.v9Source)).ok).toBe(true)
    const pinned = { ...f, v10Source: { sourceV9Head: encodePublicV9Head(saved, null, 1),
      sourceV9Lineage: f.v9Source }, v10State: withPublicV10TerrainRevision(saved) }
    expect((await migrate(pinned)).ok).toBe(true)
    const before = await f.v10.read()
    const changed = { ...saved, player: { ...saved.player, coins: 19 } }
    await putRaw(f, 9, 'head', { saveRevision: 1, value: encodePublicV9Head(changed, null, 1) })
    expect(await inspect(pinned)).toEqual({ ok: true, value: { status: 'blocked', reason: 'source-changed' } })
    expect(await f.v10.read()).toEqual(before)
  })

  it('carries a prior completed excavation forward and cannot erase that history', async () => {
    const f = await excavatedSource(await fixture())
    expect(f.v10State.mireglass.cacheExcavated).toBe(true)
    expect((await migrate(f)).ok).toBe(true)
    const before = await f.v10.read()
    const erased = { ...f.v10State, mireglass: { ...f.v10State.mireglass, cacheExcavated: false } }
    expect(await save(f, erased)).toEqual({ ok: false, reason: 'invalid-v10-dig-history' })
    expect(await f.v10.read()).toEqual(before)
  })

  it('rejects malformed or changed expected receipt and requires the shared lock', async () => {
    const f = await fixture()
    const invalid = { ...f.v10Source, sourceV9Head: {} } as typeof f.v10Source
    expect(await migratePublicV9ToV10(f.storage, f.locks, f.v8, f.v9, f.v10, invalid))
      .toEqual({ ok: false, reason: 'invalid-expected-source' })
    const newer = { ...f.fresh, player: { ...f.fresh.player, coins: 22 } }
    expect((await commitPublicV9Snapshot(f.storage, f.locks, f.v8, f.v9,
      newer, 0, f.v9Source)).ok).toBe(true)
    expect(await migrate(f))
      .toEqual({ ok: false, reason: 'source-changed' })
    for (const result of await Promise.all([
      inspectPublicV10(f.storage, undefined, f.v8, f.v9, f.v10),
      migratePublicV9ToV10(f.storage, undefined, f.v8, f.v9, f.v10, f.v10Source),
      resumePublicV10(f.storage, undefined, f.v8, f.v9, f.v10, 0, f.v10Source),
      commitPublicV10Snapshot(f.storage, undefined, f.v8, f.v9, f.v10, f.v10State, 0, f.v10Source),
    ])) expect(result).toEqual({ ok: false, reason: 'lock-unavailable' })
  })

  it('lets only one concurrent compare-and-swap publish', async () => {
    const f = await fixture()
    await migrate(f)
    let arrivals = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const racing = { ...f.v10, read: async () => {
      const read = await f.v10.read()
      if (++arrivals === 2) release()
      await gate
      return read
    } }
    const unlocked: PublicV7LockProvider = { request: async (_name, _options, callback) => callback() }
    const results = await Promise.all([1, 2].map((coins) => commitPublicV10Snapshot(f.storage, unlocked,
      f.v8, f.v9, racing, { ...f.v10State, player: { ...f.v10State.player, coins } }, 0, f.v10Source)))
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: 'revision-changed' }])
  })
})
