import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV8Store } from './atomicV8Database'
import { createAtomicV9Store } from './atomicV9Database'
import { createAtomicV10Store } from './atomicV10Database'
import { createAtomicV11Store } from './atomicV11Database'
import { createAtomicV12Store } from './atomicV12Database'
import { applyFieldCampAction } from './fieldCamp'
import { createFreshPublicWorld } from './publicWorldState'
import { PUBLIC_V7_LOCK_NAME, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA,
  serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { migratePublicV7ToV8 } from './publicWorldV8Flow'
import { encodePublicV8Head } from './publicWorldV8Snapshot'
import { migratePublicV8ToV9 } from './publicWorldV9Flow'
import { encodePublicV9Head } from './publicWorldV9Snapshot'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { migratePublicV9ToV10 } from './publicWorldV10Flow'
import { encodePublicV10Head } from './publicWorldV10Snapshot'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { commitPublicV11Snapshot, migratePublicV10ToV11 } from './publicWorldV11Flow'
import { encodePublicV11Head } from './publicWorldV11Snapshot'
import { withPublicV11Highland } from './publicWorldV11State'
import { commitPublicV12Snapshot, inspectPublicV12, migratePublicV11ToV12,
  resumePublicV12 } from './publicWorldV12Flow'
import { encodePublicV12Head, parsePublicV12Rescue,
  serializePublicV12Rescue } from './publicWorldV12Snapshot'
import { withPublicV12Windstep } from './publicWorldV12State'
import { worldTileAtGrid } from './worldChunks'

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
  const v11 = createAtomicV11Store(factory)
  const v12 = createAtomicV12Store(factory)
  expect((await migratePublicV7ToV8(storage, locks, v8, bytes)).ok).toBe(true)
  const v9Source = { sourceV8Head: encodePublicV8Head(base, null, 0), sourceV7Bytes: bytes }
  const v9State = withFreshPublicV9Camps(base)
  expect((await migratePublicV8ToV9(storage, locks, v8, v9, v9Source)).ok).toBe(true)
  const v10Source = { sourceV9Head: encodePublicV9Head(v9State, null, 0), sourceV9Lineage: v9Source }
  const v10State = withPublicV10TerrainRevision(v9State)
  expect((await migratePublicV9ToV10(storage, locks, v8, v9, v10, v10Source)).ok).toBe(true)
  const v11Source = { sourceV10Head: encodePublicV10Head(v10State, null, 0), sourceV10Lineage: v10Source }
  const v11State = withPublicV11Highland(v10State)
  expect((await migratePublicV10ToV11(storage, locks, v8, v9, v10, v11, v11Source)).ok).toBe(true)
  const v12Source = { sourceV11Head: encodePublicV11Head(v11State, null, 0),
    sourceV11Receipt: v11Source }
  const v12State = withPublicV12Windstep(v11State)
  names.length = 0
  return { factory, bytes, writes, storage, names, locks, v8, v9, v10, v11, v12,
    v11State, v11Source, v12State, v12Source }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const inspect = (f: Fixture) => inspectPublicV12(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11, f.v12)
const migrate = (f: Fixture) => migratePublicV11ToV12(f.storage, f.locks,
  f.v8, f.v9, f.v10, f.v11, f.v12, f.v12Source)
const save = (f: Fixture, state = f.v12State, revision = 0) => commitPublicV12Snapshot(f.storage,
  f.locks, f.v8, f.v9, f.v10, f.v11, f.v12, state, revision, f.v12Source)

async function putRaw(f: Fixture, key: string, value: unknown) {
  const request = f.factory.open('wizard-realms:world:v12', 1)
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

function learned(f: Fixture) {
  return { ...f.v12State, highland: { ...f.v12State.highland, landmarkDiscovered: true },
    windstep: { learned: true, activeUntilTick: 1200, nextCastTick: 1800,
      practicedRouteIndices: [21, 22] } }
}

describe('public v12 save flow', () => {
  it('pins the exact validated v11 head once and leaves older saves untouched', async () => {
    const f = await fixture()
    const before = await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read()])
    expect(await inspect(f)).toEqual({ ok: true,
      value: { status: 'missing', sourceReceipt: f.v12Source } })
    const start = { state: f.v12State, saveRevision: 0, sourceReceipt: f.v12Source }
    expect(await migrate(f)).toEqual({ ok: true, value: start })
    expect(await inspect(f)).toEqual({ ok: true, value: { status: 'valid', start } })
    expect(await resumePublicV12(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11, f.v12,
      0, f.v12Source)).toEqual({ ok: true, value: start })
    expect(await migrate(f)).toEqual({ ok: false, reason: 'v12-records-present' })
    expect(await f.v12.read()).toEqual({ status: 'ok', head: { saveRevision: 0,
      value: encodePublicV12Head(f.v12State, null, 0) }, previous: null, lineage: f.v12Source })
    const read = await f.v12.read()
    if (read.status !== 'ok' || !read.head) throw new Error('Missing v12 head')
    expect(Object.keys(read.head.value as object)).toEqual(['schemaVersion', 'saveRevision', 'bootstrap', 'state'])
    expect(Object.hasOwn(read.head.value as object, 'sourceReceipt')).toBe(false)
    expect(await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read()])).toEqual(before)
    expect(f.storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(f.bytes)
    expect(f.writes).toEqual([])
    expect(f.names).toEqual(Array(5).fill(PUBLIC_V7_LOCK_NAME))
  })

  it('rejects stale CAS and any retreat in the learned spell, practice, timers, dig or Highland history', async () => {
    const f = await fixture()
    expect((await migrate(f)).ok).toBe(true)
    const progress = learned(f)
    expect((await save(f, progress)).ok).toBe(true)
    const before = await f.v12.read()
    expect(await save(f, progress)).toEqual({ ok: false, reason: 'revision-changed' })
    expect(await save(f, { ...progress, windstep: { ...progress.windstep,
      practicedRouteIndices: [21] } }, 1)).toEqual({ ok: false, reason: 'invalid-v12-wind-history' })
    expect(await save(f, { ...progress, windstep: { ...progress.windstep,
      activeUntilTick: 0, nextCastTick: 0, practicedRouteIndices: [] } }, 1))
      .toEqual({ ok: false, reason: 'invalid-v12-wind-history' })
    expect(await save(f, { ...progress, highland: f.v12State.highland }, 1))
      .toEqual({ ok: false, reason: 'invalid-v12-highland-history' })
    const dug = { ...progress,
      player: { ...progress.player, xp: 50, level: 1,
        inventory: [...progress.player.inventory, { itemId: 'mireglass_reach/item/seal' as const, quantity: 1 }],
        learnedSpellIds: ['wayfinder_glow' as const],
        skillXp: { ...progress.player.skillXp, wayfinding: 10, spellcraft: 10, excavation: 40 } },
      mireglass: { ...progress.mireglass, fringeMarkerStudied: true,
        cacheRevealed: true, cacheExcavated: true } }
    expect((await save(f, dug, 1)).ok).toBe(true)
    expect(await save(f, progress, 2)).toEqual({ ok: false, reason: 'invalid-v12-dig-history' })
    expect(await f.v12.read()).not.toEqual(before)
  })

  it('retains a legitimately placed field camp and rejects an erased camp ledger', async () => {
    const f = await fixture()
    expect((await migrate(f)).ok).toBe(true)
    const tile = worldTileAtGrid(f.v12State.seed, -76, 100)
    const { windContentRevision: _windRevision, windstep: _windstep,
      highlandContentRevision: _highlandRevision, highland: _highland,
      terrainRevision: _terrainRevision, ...v9State } = f.v12State
    const built = applyFieldCampAction({ ...v9State, movementOwner: 'streamed',
      player: { ...v9State.player, position: { ...tile.center },
        inventory: [...v9State.player.inventory,
          { itemId: 'logs', quantity: 4 }, { itemId: 'stone', quantity: 1 }] },
      discoveredTileIds: [...v9State.discoveredTileIds, tile.id].sort() }, tile.id, null)
    if (built.rejection) throw new Error(built.rejection.code)
    const camp = { ...f.v12State, movementOwner: built.state.movementOwner,
      player: built.state.player, discoveredTileIds: built.state.discoveredTileIds,
      fieldCampTileIds: built.state.fieldCampTileIds }
    expect((await save(f, camp)).ok).toBe(true)
    expect(await save(f, { ...camp, fieldCampTileIds: [] }, 1))
      .toEqual({ ok: false, reason: 'invalid-v12-camp-history' })
  })

  it('does not publish an older authoritative tick or event sequence', async () => {
    const f = await fixture()
    expect((await migrate(f)).ok).toBe(true)
    const advanced = { ...f.v12State, tick: f.v12State.tick + 10,
      eventSequence: f.v12State.eventSequence + 2 }
    expect((await save(f, advanced)).ok).toBe(true)
    expect(await save(f, { ...advanced, tick: f.v12State.tick }, 1))
      .toEqual({ ok: false, reason: 'invalid-v12-clock-history' })
    expect(await save(f, { ...advanced, eventSequence: f.v12State.eventSequence }, 1))
      .toEqual({ ok: false, reason: 'invalid-v12-clock-history' })
  })

  it('blocks a later v11 source change without touching the v12 head', async () => {
    const f = await fixture()
    expect((await migrate(f)).ok).toBe(true)
    const before = await f.v12.read()
    const changed = { ...f.v11State, player: { ...f.v11State.player,
      coins: f.v11State.player.coins + 1 } }
    expect((await commitPublicV11Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11,
      changed, 0, f.v11Source)).ok).toBe(true)
    expect(await inspect(f)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-changed' } })
    expect(await save(f)).toEqual({ ok: false, reason: 'source-changed' })
    expect(await f.v12.read()).toEqual(before)
  })

  it('refuses migration when v11 advances after the inspected source receipt', async () => {
    const f = await fixture()
    const changed = { ...f.v11State, player: { ...f.v11State.player,
      coins: f.v11State.player.coins + 1 } }
    expect((await commitPublicV11Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11,
      changed, 0, f.v11Source)).ok).toBe(true)
    expect(await migrate(f)).toEqual({ ok: false, reason: 'source-changed' })
    expect(await f.v12.read()).toEqual({ status: 'ok', head: null, previous: null, lineage: null })
  })

  it('blocks corrupt heads, previous records, lineage and orphan branches; rescue stays read-only', async () => {
    const f = await fixture()
    const orphan = { ...f, v11: createAtomicV11Store(new FakeFactory()) }
    expect(await inspect(orphan)).toEqual({ ok: true,
      value: { status: 'missing', sourceReceipt: null } })
    expect(await migrate(orphan)).toEqual({ ok: false, reason: 'v11-missing' })
    expect((await migrate(f)).ok).toBe(true)
    expect((await save(f, learned(f))).ok).toBe(true)
    const before = await f.v12.read()
    if (before.status !== 'ok' || !before.previous) throw new Error('Missing previous v12 head')
    const rescue = serializePublicV12Rescue(f.v12State, null, 0, f.v12Source)
    expect(parsePublicV12Rescue(rescue)?.sourceReceipt).toEqual(f.v12Source)
    await putRaw(f, 'previous', { saveRevision: 0, value: encodePublicV12Head(learned(f), null, 0) })
    expect(await inspect(f)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v12-previous' } })
    await putRaw(f, 'previous', before.previous)
    await putRaw(f, 'head', { saveRevision: 1, value: {} })
    expect(await inspect(f)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v12-head' } })
    expect((await f.v12.read()).status).toBe('ok')
    expect(parsePublicV12Rescue(rescue)?.snapshot.state).toEqual(f.v12State)
    if (before.status === 'ok' && before.head) await putRaw(f, 'head', before.head)
    await putRaw(f, 'lineage', { sourceV11Head: {} })
    expect(await inspect(f)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v12-lineage' } })
  })

  it('requires the shared lock and allows only one racing compare-and-swap publication', async () => {
    const f = await fixture()
    for (const result of await Promise.all([
      inspectPublicV12(f.storage, undefined, f.v8, f.v9, f.v10, f.v11, f.v12),
      migratePublicV11ToV12(f.storage, undefined, f.v8, f.v9, f.v10, f.v11, f.v12, f.v12Source),
      resumePublicV12(f.storage, undefined, f.v8, f.v9, f.v10, f.v11, f.v12, 0, f.v12Source),
      commitPublicV12Snapshot(f.storage, undefined, f.v8, f.v9, f.v10, f.v11, f.v12,
        f.v12State, 0, f.v12Source),
    ])) expect(result).toEqual({ ok: false, reason: 'lock-unavailable' })
    expect((await migrate(f)).ok).toBe(true)
    let arrivals = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const racing = { ...f.v12, read: async () => {
      const read = await f.v12.read()
      if (++arrivals === 2) release()
      await gate
      return read
    } }
    const unlocked: PublicV7LockProvider = { request: async (_name, _options, callback) => callback() }
    const results = await Promise.all([1, 2].map((coins) => commitPublicV12Snapshot(f.storage, unlocked,
      f.v8, f.v9, f.v10, f.v11, racing, { ...f.v12State,
        player: { ...f.v12State.player, coins } }, 0, f.v12Source)))
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: 'revision-changed' }])
  })
})
