import { IDBDatabase as FakeDatabase, IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { backpackSlotsUsed } from './backpackSlots'
import { createAtomicV8Store } from './atomicV8Database'
import { createAtomicV9Store } from './atomicV9Database'
import { createAtomicV10Store } from './atomicV10Database'
import { createAtomicV11Store } from './atomicV11Database'
import { createAtomicV12Store } from './atomicV12Database'
import { createAtomicV13Store } from './atomicV13Database'
import { encodeDiscoveredTileIds } from './discoveryMask'
import { terrainHeightAt } from './generation'
import { createFreshPublicWorld } from './publicWorldState'
import { PUBLIC_V7_LOCK_NAME, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA,
  serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
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
import { migratePublicV11ToV12 } from './publicWorldV12Flow'
import { createPublicV13SourceReader } from './publicWorldV13SourceReader'
import { commitPublicV13Snapshot, commitPublicV13TerrainWork,
  commitPublicV13BootPurchase, inspectPublicV13, migratePublicSourceToV13,
  resumePublicV13 } from './publicWorldV13Flow'
import { createPublicV13GreenwaySession } from './publicWorldV13GreenwayFrame'
import { createPublicV13ContinuousSession } from './publicWorldV13ContinuousSession'
import { publicV11Gait } from './publicWorldGait'
import { decodePublicV13Head, PUBLIC_V13_SCHEMA } from './publicWorldV13Snapshot'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import { provePublicWorldV13Pose } from './publicWorldV13Pose'
import { appendTerrainWorkLedger, emptyTerrainWorkLedger } from './terrainWorkLedger'
import { terrainWorkSupportAt } from './terrainWorkSupport'
import { resolveTerrainWorkSite } from './terrainWorks'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const v12Name = 'wizard-realms:world:v12', v13Name = 'wizard-realms:world:v13'
async function fixture() {
  const factory = new FakeFactory()
  const base = withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))
  const bytes = serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA, saveRevision: 4,
    bootstrap: null, migrationSourceV6Bytes: null, state: base })
  const values = new Map([[PUBLIC_V7_ROOT_KEY, bytes]])
  const storage = { getItem: (key: string) => values.get(key) ?? null }
  const requested: string[] = []
  const locks = { request: async <T,>(name: string, options: { mode: 'exclusive' },
    callback: () => Promise<T>) => {
    expect(options.mode).toBe('exclusive')
    requested.push(name)
    return callback()
  } }
  const v8 = createAtomicV8Store(factory), v9 = createAtomicV9Store(factory)
  const v10 = createAtomicV10Store(factory), v11 = createAtomicV11Store(factory)
  const v12 = createAtomicV12Store(factory), v13 = createAtomicV13Store(factory)
  expect((await migratePublicV7ToV8(storage, locks, v8, bytes)).ok).toBe(true)
  const r9 = { sourceV8Head: encodePublicV8Head(base, null, 0), sourceV7Bytes: bytes }
  const s9 = withFreshPublicV9Camps(base)
  expect((await migratePublicV8ToV9(storage, locks, v8, v9, r9)).ok).toBe(true)
  const r10 = { sourceV9Head: encodePublicV9Head(s9, null, 0), sourceV9Lineage: r9 }
  const s10 = withPublicV10TerrainRevision(s9)
  expect((await migratePublicV9ToV10(storage, locks, v8, v9, v10, r10)).ok).toBe(true)
  const r11 = { sourceV10Head: encodePublicV10Head(s10, null, 0), sourceV10Lineage: r10 }
  const s11 = withPublicV11Highland(s10)
  expect((await migratePublicV10ToV11(storage, locks, v8, v9, v10, v11, r11)).ok).toBe(true)
  requested.length = 0
  const reader = createPublicV13SourceReader(factory, storage, v8, v9, v10, v11, v12)
  const promoteV12 = () => migratePublicV11ToV12(storage, locks, v8, v9, v10, v11, v12,
    { sourceV11Head: encodePublicV11Head(s11, null, 0), sourceV11Receipt: r11 })
  return { factory, values, storage, locks, requested, v8, v9, v10, v11, v12, v13,
    reader, r11, s11, promoteV12 }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const inspect = (f: Fixture) => inspectPublicV13(f.locks, f.reader, f.v13)
async function expected(f: Fixture) {
  const result = await inspect(f)
  if (!result.ok || result.value.status !== 'missing' || !result.value.sourceLineage) {
    throw new Error('Missing expected source')
  }
  return result.value.sourceLineage
}
async function migrated(f: Fixture) {
  const source = await expected(f)
  const result = await migratePublicSourceToV13(f.locks, f.reader, f.v13, source)
  if (!result.ok) throw new Error(`Migration failed: ${result.reason}`)
  return result.value
}
async function readyWork(f: Fixture, id: string,
  change?: (state: PublicV13Head['state']) => PublicV13Head['state']) {
  const start = await migrated(f)
  const site = resolveTerrainWorkSite(seed, id)
  if (!site) throw Error('Missing work site')
  const target = site.kind === 'dig' ? site.center : site.from
  const seen = site.kind === 'dig' ? site.footprintTileIds[0] : site.footprintTileIds[1]
  const state: PublicV13Head['state'] = { ...start.state, tick: start.state.tick + 1,
    movementOwner: 'streamed',
    discoveryMask: encodeDiscoveredTileIds([...new Set([...f.s11.discoveredTileIds, seen])].sort()),
    player: { ...start.state.player, position: { ...target }, backpackCapacity: 30,
      inventory: [...start.state.player.inventory.filter((stack) => stack.itemId !== 'logs'
        && stack.itemId !== 'field_spade'), { itemId: 'logs', quantity: 12 },
        { itemId: 'field_spade', quantity: 1 }],
      equipment: { ...start.state.player.equipment, mainHand: 'field_spade' } } }
  const prepared = await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
    change ? change(state) : state, start.saveRevision, start.sourceLineage)
  if (!prepared.ok) throw Error(`Invalid ready-work fixture: ${prepared.reason}`)
  return prepared.value
}
async function readyBoots(f: Fixture,
  change?: (state: PublicV13Head['state']) => PublicV13Head['state']) {
  const start = await migrated(f)
  const store = start.state.greenway.stores.find((entry) => entry.id === 'store-greenway')!
  const state: PublicV13Head['state'] = { ...start.state, tick: start.state.tick + 1,
    player: { ...start.state.player, position: { ...store.position } } }
  const prepared = await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
    change ? change(state) : state, start.saveRevision, start.sourceLineage)
  if (!prepared.ok) throw Error(`Invalid ready-boots fixture: ${prepared.reason}`)
  return prepared.value
}
async function putRaw(factory: IDBFactory, name: string, key: string, value: unknown) {
  const request = factory.open(name, 1)
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

describe('unmounted source-selecting public v13 flow', () => {
  it('saves and reloads one continuous edge round trip without touching older slots', async () => {
    const f = await fixture(), initial = await migrated(f)
    const old = await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(),
      f.v11.read(), f.v12.read()])
    const oldRoot = f.values.get(PUBLIC_V7_ROOT_KEY)
    const edge = { x: -12, y: terrainHeightAt(initial.state.greenway.tiles, -12, 0), z: 0 }
    const edgeTile = worldTileAtGrid(seed, -3, 0).id
    const prepared = await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
      { ...initial.state, tick: initial.state.tick + 1,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...f.s11.discoveredTileIds, edgeTile])].sort()),
        player: { ...initial.state.player, position: edge } },
      initial.saveRevision, initial.sourceLineage)
    if (!prepared.ok) throw Error(prepared.reason)
    const session = createPublicV13ContinuousSession(prepared.value)
    expect(session.advanceFrame([{ type: 'move', delta: { x: -.16, z: 0 } }],
      { walkRequested: false }).rejections).toEqual([])
    expect(session.view().movementOwner).toBe('streamed')
    expect(session.advanceFrame([{ type: 'move', delta: { x: .16, z: 0 } }],
      { walkRequested: false }).rejections).toEqual([])
    const candidate = session.snapshotForSave()
    const committed = await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
      candidate, prepared.value.saveRevision, prepared.value.sourceLineage)
    if (!committed.ok) throw Error(committed.reason)
    const resumed = await resumePublicV13(f.locks, f.reader, f.v13,
      committed.value.saveRevision, committed.value.sourceLineage)
    if (!resumed.ok) throw Error(resumed.reason)
    const reloaded = createPublicV13ContinuousSession(resumed.value)
    expect(reloaded.view().movementOwner).toBe('greenway')
    expect(reloaded.snapshotForSave()).toEqual(candidate)
    expect(await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(),
      f.v11.read(), f.v12.read()])).toEqual(old)
    expect(f.values.get(PUBLIC_V7_ROOT_KEY)).toBe(oldRoot)
  })

  it('migrates direct v11 rev0 under the shared lock without changing old stores', async () => {
    const f = await fixture()
    const source = await expected(f)
    expect(source.sourceSchemaVersion).toBe('wizard-world/v11')
    const old = await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read()])
    const bytes = f.values.get(PUBLIC_V7_ROOT_KEY)
    const consume = vi.spyOn(f.reader, 'consumeProof')
    const migrated = await migratePublicSourceToV13(f.locks, f.reader, f.v13, source)
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.value.saveRevision).toBe(0)
    const { windContentRevision, windstep, terrainWorks, ...inherited } = migrated.value.state
    expect(inherited).toEqual(source.sourceHead.state)
    expect(windContentRevision).toBeTruthy()
    expect(windstep).toEqual({ learned: false, activeUntilTick: 0,
      nextCastTick: 0, practicedRouteIndices: [] })
    expect(terrainWorks).toEqual({ builtWorkIds: [], dugTileIds: [] })
    expect(f.requested.every((name) => name === PUBLIC_V7_LOCK_NAME)).toBe(true)
    expect(f.reader.consumeProof(consume.mock.calls.at(-1)![0])).toBeNull()
    expect((await inspect(f))).toMatchObject({ ok: true, value: { status: 'valid',
      start: { saveRevision: 0 } } })
    expect(await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read()]))
      .toEqual(old)
    expect(f.values.get(PUBLIC_V7_ROOT_KEY)).toBe(bytes)
    expect((await f.factory.databases()).some((database) => database.name === v12Name)).toBe(false)
    migrated.value.state.discoveryMask[0] ^= 1
    const raw = await f.v13.read()
    expect(raw.status).toBe('ok')
    if (raw.status === 'ok') expect((raw.head as { value: { state: { discoveryMask: Uint8Array } } })
      .value.state.discoveryMask[0]).not.toBe(migrated.value.state.discoveryMask[0])
  })

  it('selects v12 when present and blocks partial v12 or a late v12 source', async () => {
    const f = await fixture()
    const staleV11 = await expected(f)
    expect((await f.promoteV12()).ok).toBe(true)
    expect((await inspect(f))).toMatchObject({ ok: true, value: { status: 'missing',
      sourceLineage: { sourceSchemaVersion: 'wizard-world/v12' } } })
    expect(await migratePublicSourceToV13(f.locks, f.reader, f.v13, staleV11))
      .toEqual({ ok: false, reason: 'source-changed' })
    const freshV12 = await expected(f)
    const oldV12 = await f.v12.read()
    const migrated = await migratePublicSourceToV13(f.locks, f.reader, f.v13, freshV12)
    expect(migrated.ok).toBe(true)
    if (migrated.ok) expect(migrated.value.state).toEqual({ ...freshV12.sourceHead.state,
      terrainWorks: { builtWorkIds: [], dugTileIds: [] } })
    expect(await f.v12.read()).toEqual(oldV12)
    const partial = await fixture()
    await putRaw(partial.factory, v12Name, 'previous', { malformed: true })
    const result = await inspect(partial)
    expect(result.ok && result.value.status).not.toBe('valid')
    expect((await partial.v13.read()).status).toBe('ok')
  })

  it('rechecks source revision, refuses replay and blocks partial or unknown v13 slots', async () => {
    const f = await fixture()
    const source = await expected(f)
    expect((await commitPublicV11Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11,
      f.s11, 0, f.r11)).ok).toBe(true)
    expect(await migratePublicSourceToV13(f.locks, f.reader, f.v13, source))
      .toEqual({ ok: false, reason: 'source-changed' })
    const updated = await expected(f)
    expect(updated.sourceHead.saveRevision).toBe(1)
    expect((await migratePublicSourceToV13(f.locks, f.reader, f.v13, updated)).ok).toBe(true)
    expect(await migratePublicSourceToV13(f.locks, f.reader, f.v13, updated))
      .toEqual({ ok: false, reason: 'v13-records-present' })
    await putRaw(f.factory, v13Name, 'previous', { malformed: true })
    expect((await inspect(f))).toMatchObject({ ok: true, value: { status: 'blocked' } })
    await putRaw(f.factory, v13Name, 'future-slot', true)
    expect((await inspect(f)).ok).toBe(false)
  })

  it('rejects a signed-zero change in the expected source head', async () => {
    const f = await fixture()
    const source = await expected(f)
    const yaw = source.sourceHead.state.player.yaw
    const stale = structuredClone(source)
    stale.sourceHead.state.player.yaw = Object.is(yaw, -0) ? 0 : -0
    expect(Object.is(stale.sourceHead.state.player.yaw, yaw)).toBe(false)
    expect(await migratePublicSourceToV13(f.locks, f.reader, f.v13, stale))
      .toEqual({ ok: false, reason: 'source-changed' })
  })

  it('blocks a valid individual head that rolls back built terrain works from previous', async () => {
    const f = await fixture()
    const source = await expected(f)
    expect((await migratePublicSourceToV13(f.locks, f.reader, f.v13, source)).ok).toBe(true)
    const raw = await f.v13.read()
    if (raw.status !== 'ok') throw new Error('Missing v13 head')
    const zero = (raw.head as { value: Record<string, unknown> }).value as {
      state: { terrainWorks: ReturnType<typeof emptyTerrainWorkLedger> }
    } & Record<string, unknown>
    const built = appendTerrainWorkLedger(emptyTerrainWorkLedger(),
      'works1:bridge:-102:92:z', { seed, fieldCampTileIds: [], authoredBuiltRouteIds: [] })!
    await putRaw(f.factory, v13Name, 'previous', { saveRevision: 1,
      value: { ...zero, saveRevision: 1, state: { ...zero.state, terrainWorks: built } } })
    await putRaw(f.factory, v13Name, 'head', { saveRevision: 2,
      value: { ...zero, saveRevision: 2 } })
    expect((await inspect(f))).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v13-history' } })
  })

  it('fails closed when the lock is absent or throws', async () => {
    const f = await fixture()
    const source = await expected(f)
    expect(await inspectPublicV13(undefined, f.reader, f.v13))
      .toEqual({ ok: false, reason: 'lock-unavailable' })
    expect(await migratePublicSourceToV13(undefined, f.reader, f.v13, source))
      .toEqual({ ok: false, reason: 'lock-unavailable' })
    const throws = { request: async () => { throw new Error('lock failure') } }
    expect(await inspectPublicV13(throws, f.reader, f.v13))
      .toEqual({ ok: false, reason: 'storage-error' })
  })

  it('resumes only the current revision and source without writing or sharing mutable state', async () => {
    const f = await fixture(), initial = await migrated(f)
    const next = await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
      { ...initial.state, tick: initial.state.tick + 1 }, 0, initial.sourceLineage)
    if (!next.ok) throw Error(next.reason)
    const before = await f.v13.read()
    const old = await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read()])
    const root = f.values.get(PUBLIC_V7_ROOT_KEY)
    const write = vi.spyOn(f.v13, 'commitWithSource')
    const resumed = await resumePublicV13(f.locks, f.reader, f.v13,
      1, next.value.sourceLineage)
    expect(resumed).toMatchObject({ ok: true, value: { saveRevision: 1,
      state: { tick: initial.state.tick + 1 } } })
    expect(await resumePublicV13(f.locks, f.reader, f.v13,
      0, next.value.sourceLineage)).toEqual({ ok: false, reason: 'revision-changed' })
    const expectedAtCall = structuredClone(next.value.sourceLineage)
    const waits = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
      callback: () => Promise<T>) => {
      await Promise.resolve()
      expectedAtCall.sourceHead.state.discoveryMask[0] ^= 1
      return callback()
    } }
    expect((await resumePublicV13(waits, f.reader, f.v13, 1, expectedAtCall)).ok).toBe(true)
    if (resumed.ok) resumed.value.state.discoveryMask[0] ^= 1
    expect(await f.v13.read()).toEqual(before)
    expect(await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read()]))
      .toEqual(old)
    expect(f.values.get(PUBLIC_V7_ROOT_KEY)).toBe(root)
    expect(write).not.toHaveBeenCalled()
    write.mockRestore()
    expect(f.requested.every((name) => name === PUBLIC_V7_LOCK_NAME)).toBe(true)
  })

  it('fails closed on source drift, missing or corrupt slots, lock and storage errors', async () => {
    const missing = await fixture(), source = await expected(missing)
    expect(await resumePublicV13(missing.locks, missing.reader, missing.v13, 0, source))
      .toEqual({ ok: false, reason: 'v13-missing' })
    const f = await fixture(), start = await migrated(f)
    const stale = structuredClone(start.sourceLineage)
    stale.sourceHead.state.player.yaw = -0
    expect(await resumePublicV13(f.locks, f.reader, f.v13, 0, stale))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect(await resumePublicV13(undefined, f.reader, f.v13, 0, start.sourceLineage))
      .toEqual({ ok: false, reason: 'lock-unavailable' })
    expect(await resumePublicV13({ request: async () => { throw Error('storage') } },
      f.reader, f.v13, 0, start.sourceLineage))
      .toEqual({ ok: false, reason: 'storage-error' })
    const noLock = { request: vi.fn() }
    expect(await resumePublicV13(noLock, f.reader, f.v13, -1, start.sourceLineage))
      .toEqual({ ok: false, reason: 'invalid-revision' })
    const getter = structuredClone(start.sourceLineage)
    Object.defineProperty(getter, 'sourceHead', { enumerable: true,
      get: () => start.sourceLineage.sourceHead })
    expect(await resumePublicV13(noLock, f.reader, f.v13, 0, getter))
      .toEqual({ ok: false, reason: 'invalid-expected-source' })
    expect(noLock.request).not.toHaveBeenCalled()
    const storageError = vi.spyOn(f.v13, 'readCheckedWithSource')
      .mockResolvedValueOnce({ status: 'storage-error' })
    expect(await resumePublicV13(f.locks, f.reader, f.v13, 0, start.sourceLineage))
      .toEqual({ ok: false, reason: 'storage-error' })
    storageError.mockResolvedValueOnce({ status: 'ok', head: null,
      previous: null, lineage: null, proof: null })
    expect(await resumePublicV13(f.locks, f.reader, f.v13, 0, start.sourceLineage))
      .toEqual({ ok: false, reason: 'invalid-v13-records' })
    storageError.mockRestore()
    await putRaw(f.factory, v13Name, 'previous', { malformed: true })
    expect(await resumePublicV13(f.locks, f.reader, f.v13, 0, start.sourceLineage))
      .toEqual({ ok: false, reason: 'invalid-v13-records' })
    const corrupt = await fixture(), current = await migrated(corrupt)
    await putRaw(corrupt.factory, v13Name, 'head', { malformed: true })
    expect(await resumePublicV13(corrupt.locks, corrupt.reader, corrupt.v13,
      0, current.sourceLineage)).toEqual({ ok: false, reason: 'invalid-v13-records' })
    const drift = await fixture(), old = await migrated(drift)
    expect((await drift.promoteV12()).ok).toBe(true)
    expect(await resumePublicV13(drift.locks, drift.reader, drift.v13,
      0, old.sourceLineage)).toEqual({ ok: false, reason: 'source-changed' })
  })

  it.each([false, true])('commits a v13 snapshot with %s v12 source and rotates only v13', async (useV12) => {
    const f = await fixture()
    if (useV12) expect((await f.promoteV12()).ok).toBe(true)
    const start = await migrated(f)
    const before = await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read(),
      useV12 ? f.v12.read() : Promise.resolve(null)])
    const root = f.values.get(PUBLIC_V7_ROOT_KEY)
    const next = { ...start.state, tick: start.state.tick + 1, eventSequence: start.state.eventSequence + 1 }
    const result = await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
      next, start.saveRevision, start.sourceLineage)
    expect(result).toMatchObject({ ok: true, value: { saveRevision: 1, state: next } })
    expect((await inspect(f))).toMatchObject({ ok: true, value: { status: 'valid',
      start: { saveRevision: 1, state: next } } })
    const raw = await f.v13.read()
    if (raw.status !== 'ok') throw new Error('Missing committed head')
    expect((raw.head as { saveRevision: number }).saveRevision).toBe(1)
    expect((raw.previous as { saveRevision: number }).saveRevision).toBe(0)
    expect(raw.lineage).toEqual(start.sourceLineage)
    expect(await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read(),
      useV12 ? f.v12.read() : Promise.resolve(null)])).toEqual(before)
    expect(f.values.get(PUBLIC_V7_ROOT_KEY)).toBe(root)
  })

  it('rejects generic ledger mutation, stale revision and source drift without writing', async () => {
    const f = await fixture(), start = await migrated(f)
    const next = { ...start.state, tick: start.state.tick + 1 }
    const built = appendTerrainWorkLedger(emptyTerrainWorkLedger(),
      'works1:bridge:-102:92:z', { seed, fieldCampTileIds: [], authoredBuiltRouteIds: [] })!
    expect(await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
      { ...next, terrainWorks: built }, 0, start.sourceLineage))
      .toEqual({ ok: false, reason: 'terrain-works-changed' })
    expect(await commitPublicV13Snapshot(f.locks, f.reader, f.v13, next, 1, start.sourceLineage))
      .toEqual({ ok: false, reason: 'revision-changed' })
    const signed = structuredClone(start.sourceLineage)
    signed.sourceHead.state.player.yaw = -0
    expect(await commitPublicV13Snapshot(f.locks, f.reader, f.v13, next, 0, signed))
      .toEqual({ ok: false, reason: 'source-changed' })
    const mask = structuredClone(start.sourceLineage)
    mask.sourceHead.state.discoveryMask[0] ^= 1
    expect(await commitPublicV13Snapshot(f.locks, f.reader, f.v13, next, 0, mask))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect((await f.v13.read()).status).toBe('ok')
    expect((await inspect(f))).toMatchObject({ ok: true, value: { status: 'valid',
      start: { saveRevision: 0 } } })
    expect((await f.promoteV12()).ok).toBe(true)
    expect(await commitPublicV13Snapshot(f.locks, f.reader, f.v13, next, 0, start.sourceLineage))
      .toEqual({ ok: false, reason: 'source-changed' })
  })

  it('captures input before a lock wait and rejects getters, proxies and oversized masks', async () => {
    const f = await fixture(), start = await migrated(f)
    const next = { ...start.state, tick: start.state.tick + 1 }
    const waits = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
      callback: () => Promise<T>) => { await Promise.resolve(); next.tick = 99; return callback() } }
    const result = await commitPublicV13Snapshot(waits, f.reader, f.v13,
      next, 0, start.sourceLineage)
    expect(result).toMatchObject({ ok: true, value: { state: { tick: start.state.tick + 1 } } })
    const getter = { ...start.state }
    Object.defineProperty(getter, 'tick', { enumerable: true, get: () => start.state.tick + 2 })
    const noLock = { request: vi.fn() }
    for (const bad of [getter, new Proxy(start.state, { ownKeys: () => { throw Error('proxy') } }),
      { ...start.state, discoveryMask: new Uint8Array(new ArrayBuffer(65_536), 0, 32_768) }]) {
      expect(await commitPublicV13Snapshot(noLock, f.reader, f.v13,
        bad, 1, start.sourceLineage)).toEqual({ ok: false, reason: 'invalid-state' })
    }
    const sourceGetter = structuredClone(start.sourceLineage)
    Object.defineProperty(sourceGetter, 'sourceHead', { enumerable: true, get: () => start.sourceLineage.sourceHead })
    expect(await commitPublicV13Snapshot(noLock, f.reader, f.v13,
      start.state, 1, sourceGetter)).toEqual({ ok: false, reason: 'invalid-expected-source' })
    expect(await commitPublicV13Snapshot(noLock, f.reader, f.v13,
      start.state, Number.MAX_SAFE_INTEGER, start.sourceLineage))
      .toEqual({ ok: false, reason: 'invalid-revision' })
    expect(noLock.request).not.toHaveBeenCalled()
  })

  it('blocks discovery rollback, corrupt records and a raw concurrent writer', async () => {
    const f = await fixture(), start = await migrated(f)
    const discovered = new Uint8Array(start.state.discoveryMask)
    expect(discovered[0] & 1).toBe(0)
    discovered[0] |= 1
    const first = await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
      { ...start.state, discoveryMask: discovered, tick: start.state.tick + 1 },
      0, start.sourceLineage)
    expect(first.ok).toBe(true)
    expect(await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
      { ...start.state, tick: start.state.tick + 2 }, 1, start.sourceLineage))
      .toEqual({ ok: false, reason: 'invalid-v13-history' })
    const current = await inspect(f)
    if (!current.ok || current.value.status !== 'valid') throw Error('Missing rev1')
    const original = f.v13.commitWithSource
    const spy = vi.spyOn(f.v13, 'commitWithSource').mockImplementation(async (...args) => {
      await putRaw(f.factory, v13Name, 'head', args[2])
      return original(...args)
    })
    try {
      expect(await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
        { ...current.value.start.state, tick: current.value.start.state.tick + 1 },
        1, start.sourceLineage)).toEqual({ ok: false, reason: 'revision-changed' })
    } finally { spy.mockRestore() }
    await putRaw(f.factory, v13Name, 'previous', { malformed: true })
    expect(await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
      current.value.start.state, 1, start.sourceLineage))
      .toEqual({ ok: false, reason: 'invalid-v13-records' })
  })

  it.each([
    ['Greenway stock', (state: PublicV13Head['state']) => { state.greenway.stores[0].listings[0].stock-- }],
    ['Greenway resource', (state: PublicV13Head['state']) => {
      const node = state.greenway.resources.find((resource) => resource.health > 0)!
      node.health--
      if (node.health === 0) node.depleted = true
    }],
    ['Greenway route site', (state: PublicV13Head['state']) => {
      state.greenway.builtRouteIds.push('greenway_ladder')
      state.greenway.routes[0].siteId = 'greenway_ladder:x:0'
    }],
    ['Greenway progress IDs', (state: PublicV13Head['state']) => {
      state.greenway.studiedInscriptionIds.push('greenway_waystone')
      state.greenway.revealedDigSiteIds.push('practice_mound')
      state.greenway.excavatedDigSiteIds.push('practice_mound')
    }],
    ['Mireglass stock', (state: PublicV13Head['state']) => {
      (state.mireglass.shopStock as Record<string, number>).field_spade--
      state.player.inventory.push({ itemId: 'field_spade', quantity: 1 })
    }],
  ] as const)('rejects individually valid %s rollback', async (_name, advance) => {
    const f = await fixture(), start = await migrated(f)
    const progressed = structuredClone(start.state)
    advance(progressed)
    const next = { ...progressed, tick: progressed.tick + 1 }
    const first = await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
      next, 0, start.sourceLineage)
    if (!first.ok) throw Error(first.reason)
    const rolled = { ...start.state, tick: next.tick + 1 }
    expect(decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA, saveRevision: 2,
      bootstrap: start.bootstrap, state: rolled }, start.sourceLineage)).not.toBeNull()
    expect(await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
      rolled, 1, start.sourceLineage)).toEqual({ ok: false, reason: 'invalid-v13-history' })
  })

  it('keeps the original ladder Y and refuses to remove its built ledger', async () => {
    const f = await fixture(), start = await migrated(f)
    const id = 'works1:ladder:-103:108:W'
    const site = resolveTerrainWorkSite(seed, id)
    if (!site || site.kind !== 'ladder') throw Error('Missing ladder fixture')
    const ledger = appendTerrainWorkLedger(emptyTerrainWorkLedger(), id,
      { seed, fieldCampTileIds: [], authoredBuiltRouteIds: [] })!
    const t = 0.55
    const point = { x: site.from.x + (site.to.x - site.from.x) * t,
      z: site.from.z + (site.to.z - site.from.z) * t }
    const y = terrainWorkSupportAt(site, point).floorY!
    const state = { ...start.state, movementOwner: 'streamed' as const,
      tick: start.state.tick + 1, terrainWorks: ledger,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...f.s11.discoveredTileIds, ...site.footprintTileIds])].sort()),
      player: { ...start.state.player, position: { ...point, y } } }
    const head = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
      saveRevision: 1, bootstrap: start.bootstrap, state }, start.sourceLineage)
    expect(head).not.toBeNull()
    const raw = await f.v13.read()
    if (raw.status !== 'ok') throw Error('Missing rev0')
    await putRaw(f.factory, v13Name, 'previous', raw.head)
    await putRaw(f.factory, v13Name, 'head', { saveRevision: 1, value: head })
    const current = await inspect(f)
    if (!current.ok || current.value.status !== 'valid') throw Error('Invalid built ladder')
    const { terrainWorks, ...inherited } = current.value.start.state
    const pose = provePublicWorldV13Pose(inherited, terrainWorks)
    expect(pose?.originalY).toBe(y)
    expect(pose?.witness.player.position.y).toBeGreaterThan(y)
    const next = { ...current.value.start.state, tick: current.value.start.state.tick + 1 }
    const committed = await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
      next, 1, start.sourceLineage)
    expect(committed).toMatchObject({ ok: true, value: { state: { player: { position: { y } } } } })
    const removed = { ...next, terrainWorks: emptyTerrainWorkLedger(),
      player: { ...next.player, position: { ...site.from } } }
    expect(await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
      removed, 2, start.sourceLineage)).toEqual({ ok: false, reason: 'terrain-works-changed' })
  })

  it('does not report success when the bound store aborts', async () => {
    const f = await fixture(), start = await migrated(f)
    const spy = vi.spyOn(f.v13, 'commitWithSource').mockResolvedValueOnce('storage-error')
    try {
      expect(await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
        { ...start.state, tick: start.state.tick + 1 }, 0, start.sourceLineage))
        .toEqual({ ok: false, reason: 'storage-error' })
    } finally { spy.mockRestore() }
    expect((await inspect(f))).toMatchObject({ ok: true, value: { status: 'valid',
      start: { saveRevision: 0 } } })
  })

  it.each([
    ['works1:bridge:-102:92:z', 8, 80, 'built'],
    ['works1:ladder:-103:108:W', 4, 60, 'built'],
    ['tile--64-76', 0, 30, 'dug'],
  ] as const)('saves real %s work and event only after CAS', async (id, logs, xp, kind) => {
    const f = await fixture()
    if (kind === 'dug') expect((await f.promoteV12()).ok).toBe(true)
    const current = await readyWork(f, id)
    const input = structuredClone(current)
    const old = await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read(), f.v12.read()])
    const result = await commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
      id, current.saveRevision, current.sourceLineage)
    expect(result).toMatchObject({ ok: true, value: { start: { saveRevision: 2 },
      event: { id, tick: current.state.tick, sequence: current.state.eventSequence + 1,
        logsSpent: logs, stoneGained: Number(kind === 'dug'), xp } } })
    if (!result.ok) return
    const next = result.value.start.state
    expect(next.player.xp).toBe(current.state.player.xp + xp)
    expect(next.player.skillXp[kind === 'dug' ? 'excavation' : 'construction'])
      .toBe(current.state.player.skillXp[kind === 'dug' ? 'excavation' : 'construction'] + xp)
    expect(next.terrainWorks[kind === 'dug' ? 'dugTileIds' : 'builtWorkIds']).toEqual([id])
    expect(next.player.inventory.filter((stack) => stack.itemId === 'logs')
      .reduce((sum, stack) => sum + stack.quantity, 0)).toBe(12 - logs)
    expect(next.player.inventory.filter((stack) => stack.itemId === 'stone')
      .reduce((sum, stack) => sum + stack.quantity, 0)).toBe(Number(kind === 'dug'))
    expect((await inspect(f))).toMatchObject({ ok: true, value: { status: 'valid',
      start: { saveRevision: 2, state: next } } })
    const raw = await f.v13.read()
    if (raw.status !== 'ok') throw Error('Missing work head')
    expect((raw.previous as { saveRevision: number }).saveRevision).toBe(1)
    expect((raw.head as { saveRevision: number }).saveRevision).toBe(2)
    expect(await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read(), f.v12.read()]))
      .toEqual(old)
    expect(current).toEqual(input)
    expect(await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
      { ...next, terrainWorks: emptyTerrainWorkLedger() }, 2, current.sourceLineage))
      .toEqual({ ok: false, reason: 'terrain-works-changed' })
    expect(await commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
      id, 2, current.sourceLineage)).toEqual({ ok: false, reason: 'already_done' })
  })
  it.each([
    ['logs', 'works1:bridge:-102:92:z', (s: PublicV13Head['state']) => ({ ...s,
      player: { ...s.player, inventory: s.player.inventory.filter((stack) => stack.itemId !== 'logs') } }), 'not_owned'],
    ['spade', 'tile--64-76', (s: PublicV13Head['state']) => ({ ...s,
      player: { ...s.player, equipment: { ...s.player.equipment, mainHand: null } } }), 'requires_spade'],
    ['capacity', 'tile--64-76', (s: PublicV13Head['state']) => ({ ...s,
      player: { ...s.player, backpackCapacity: backpackSlotsUsed(s.player.inventory,
        s.player.tradeSlots) } }), 'capacity'],
    ['original Y', 'works1:bridge:-102:92:z', (s: PublicV13Head['state']) => ({ ...s,
      player: { ...s.player, position: { ...s.player.position, y: s.player.position.y + 3.01 } } }), 'too_far'],
  ] as const)('does not write or emit an event for %s rejection', async (_name, id, change, code) => {
    const f = await fixture(), current = await readyWork(f, id, change)
    const before = await f.v13.read()
    expect(await commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
      id, current.saveRevision, current.sourceLineage)).toEqual({ ok: false, reason: code })
    expect(await f.v13.read()).toEqual(before)
  })

  it('rejects undiscovered work and an authored-route overlap without writing', async () => {
    const f = await fixture(), bridge = await readyWork(f, 'works1:bridge:-102:92:z')
    const before = await f.v13.read()
    expect(await commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
      'works1:ladder:-103:108:W', 1, bridge.sourceLineage))
      .toEqual({ ok: false, reason: 'undiscovered' })
    expect(await f.v13.read()).toEqual(before)
    const occupied = await fixture()
    const dig = await readyWork(occupied, 'tile--95-93', (s) => {
      const xp = s.player.xp + 80
      return { ...s, player: { ...s.player, xp, level: 1 + Math.floor(xp / 100),
        skillXp: { ...s.player.skillXp, construction: s.player.skillXp.construction + 80 } },
      mireglass: { ...s.mireglass, builtRoutes: { ...s.mireglass.builtRoutes,
        bridge: 'mireglass_reach/route/fen_bridge/-98/92' } } }
    })
    const raw = await occupied.v13.read()
    expect(await commitPublicV13TerrainWork(occupied.locks, occupied.reader, occupied.v13,
      'tile--95-93', 1, dig.sourceLineage)).toEqual({ ok: false, reason: 'occupied' })
    expect(await occupied.v13.read()).toEqual(raw)
  })

  it('rejects stale revision, signed-zero source drift and malformed scalar inputs before write', async () => {
    const f = await fixture(), current = await readyWork(f, 'works1:bridge:-102:92:z')
    const id = 'works1:bridge:-102:92:z', before = await f.v13.read()
    expect(await commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
      id, 0, current.sourceLineage)).toEqual({ ok: false, reason: 'revision-changed' })
    const stale = structuredClone(current.sourceLineage)
    stale.sourceHead.state.player.yaw = -0
    expect(await commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
      id, 1, stale)).toEqual({ ok: false, reason: 'source-changed' })
    const forged = structuredClone(current.sourceLineage)
    forged.sourceHead.state.discoveryMask[0] ^= 1
    expect(await commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
      id, 1, forged)).toEqual({ ok: false, reason: 'source-changed' })
    const noLock = { request: vi.fn() }
    expect(await commitPublicV13TerrainWork(noLock, f.reader, f.v13,
      { id }, 1, current.sourceLineage)).toEqual({ ok: false, reason: 'invalid_site' })
    expect(await commitPublicV13TerrainWork(noLock, f.reader, f.v13,
      id, Number.MAX_SAFE_INTEGER, current.sourceLineage))
      .toEqual({ ok: false, reason: 'invalid-revision' })
    const getter = structuredClone(current.sourceLineage)
    Object.defineProperty(getter, 'sourceHead', { enumerable: true,
      get: () => current.sourceLineage.sourceHead })
    expect(await commitPublicV13TerrainWork(noLock, f.reader, f.v13,
      id, 1, getter)).toEqual({ ok: false, reason: 'invalid-expected-source' })
    expect(noLock.request).not.toHaveBeenCalled()
    expect(await f.v13.read()).toEqual(before)
    expect((await f.promoteV12()).ok).toBe(true)
    expect(await commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
      id, 1, current.sourceLineage)).toEqual({ ok: false, reason: 'source-changed' })
  })

  it.each(['head', 'previous'])('blocks a corrupt %s before action', async (slot) => {
    const f = await fixture(), current = await readyWork(f, 'works1:bridge:-102:92:z')
    await putRaw(f.factory, v13Name, slot, { malformed: true })
    const before = await f.v13.read()
    expect(await commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
      'works1:bridge:-102:92:z', 1, current.sourceLineage))
      .toEqual({ ok: false, reason: 'invalid-v13-records' })
    expect(await f.v13.read()).toEqual(before)
  })

  it('blocks an invalid stored pose before recomputing work', async () => {
    const f = await fixture(), current = await readyWork(f, 'works1:bridge:-102:92:z')
    const raw = await f.v13.read()
    if (raw.status !== 'ok' || !raw.head) throw Error('Missing prepared head')
    const corrupt = structuredClone(raw.head) as { saveRevision: number; value: PublicV13Head }
    corrupt.value.state.player.position.y = -100
    await putRaw(f.factory, v13Name, 'head', corrupt)
    expect(await commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
      'works1:bridge:-102:92:z', 1, current.sourceLineage))
      .toEqual({ ok: false, reason: 'invalid-v13-records' })
  })

  it('returns no event or write on abort and refuses a replayed one-use proof', async () => {
    const f = await fixture(), current = await readyWork(f, 'works1:bridge:-102:92:z')
    const before = await f.v13.read(), original = f.v13.commitWithSource
    const transaction = FakeDatabase.prototype.transaction
    const abort = vi.spyOn(FakeDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase, names, mode, options) {
      const pending = transaction.call(this, names, mode, options)
      if (mode === 'readwrite') queueMicrotask(() => pending.abort())
      return pending
    })
    try {
      expect(await commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
        'works1:bridge:-102:92:z', 1, current.sourceLineage))
        .toEqual({ ok: false, reason: 'storage-error' })
    } finally { abort.mockRestore() }
    expect(await f.v13.read()).toEqual(before)
    let replay: string | undefined
    const spy = vi.spyOn(f.v13, 'commitWithSource').mockImplementation(async (...args) => {
      const first = await original(...args)
      replay = await original(...args)
      return first
    })
    try {
      expect((await commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
        'works1:bridge:-102:92:z', 1, current.sourceLineage)).ok).toBe(true)
    } finally { spy.mockRestore() }
    expect(replay).toBe('invalid')
    expect((await inspect(f))).toMatchObject({ ok: true, value: { status: 'valid',
      start: { saveRevision: 2 } } })
  })

  it('commits at most one of two concurrent work calls at the same revision', async () => {
    const f = await fixture(), id = 'works1:bridge:-102:92:z'
    const current = await readyWork(f, id)
    const [first, second] = await Promise.all([
      commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
        id, current.saveRevision, current.sourceLineage),
      commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
        id, current.saveRevision, current.sourceLineage),
    ])
    const results = [first, second]
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
    const winner = results.find((result) => result.ok)
    if (!winner?.ok) throw Error('Missing winning work commit')
    expect(winner.value.event).toMatchObject({ id, logsSpent: 8,
      sequence: current.state.eventSequence + 1 })
    const saved = await inspect(f)
    expect(saved).toMatchObject({ ok: true, value: { status: 'valid',
      start: { saveRevision: 2, state: { terrainWorks: { builtWorkIds: [id] },
        eventSequence: current.state.eventSequence + 1 } } } })
    if (!saved.ok || saved.value.status !== 'valid') throw Error('Missing saved work state')
    expect(saved.value.start.state.player.inventory.find((stack) => stack.itemId === 'logs')?.quantity)
      .toBe(4)
  })

  it('rejects a raw concurrent writer at the final CAS', async () => {
    const f = await fixture(), current = await readyWork(f, 'works1:bridge:-102:92:z')
    const original = f.v13.commitWithSource
    const spy = vi.spyOn(f.v13, 'commitWithSource').mockImplementation(async (...args) => {
      await putRaw(f.factory, v13Name, 'head', args[2])
      return original(...args)
    })
    try {
      expect(await commitPublicV13TerrainWork(f.locks, f.reader, f.v13,
        'works1:bridge:-102:92:z', 1, current.sourceLineage))
        .toEqual({ ok: false, reason: 'revision-changed' })
    } finally { spy.mockRestore() }
  })

  it('buys exactly one unequipped pair for 25g under CAS and preserves old slots', async () => {
    const f = await fixture(), current = await readyBoots(f)
    const input = structuredClone(current)
    const old = await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read(), f.v12.read()])
    const bytes = f.values.get(PUBLIC_V7_ROOT_KEY)
    const result = await commitPublicV13BootPurchase(f.locks, f.reader, f.v13,
      'store-greenway', current.saveRevision, current.sourceLineage)
    expect(result).toMatchObject({ ok: true, value: { start: { saveRevision: 2 }, event: {
      type: 'store_item_bought', storeId: 'store-greenway', listingId: 'v11-leather-boots',
      itemId: 'leather_boots', price: 25, tick: current.state.tick,
      sequence: current.state.eventSequence + 1 } } })
    if (!result.ok) return
    const next = result.value.start
    expect(next.state.player.coins).toBe(current.state.player.coins - 25)
    expect(next.state.player.inventory.filter((stack) => stack.itemId === 'leather_boots'))
      .toEqual([{ itemId: 'leather_boots', quantity: 1 }])
    expect(next.state.player.equipment.feet).toBeNull()
    expect(publicV11Gait(next.state.player.equipment.feet, false).pace).toBe('walk')
    const session = createPublicV13GreenwaySession(next)
    expect(session.advance([{ type: 'equip_item', itemId: 'leather_boots', slot: 'feet' }],
      { walkRequested: false }).rejections).toEqual([])
    expect(publicV11Gait(session.view().player.equipment.feet, false).pace).toBe('run')
    expect((await inspect(f))).toMatchObject({ ok: true, value: { status: 'valid',
      start: { saveRevision: 2, state: next.state } } })
    const raw = await f.v13.read()
    if (raw.status !== 'ok') throw Error('Missing boots head')
    expect((raw.previous as { saveRevision: number }).saveRevision).toBe(1)
    expect(await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read(), f.v12.read()]))
      .toEqual(old)
    expect(f.values.get(PUBLIC_V7_ROOT_KEY)).toBe(bytes)
    expect(current).toEqual(input)
    const before = await f.v13.read()
    expect(await commitPublicV13BootPurchase(f.locks, f.reader, f.v13,
      'store-greenway', 2, current.sourceLineage))
      .toEqual({ ok: false, reason: 'You already own leather boots.' })
    expect(await f.v13.read()).toEqual(before)
  })

  it.each([
    ['wrong store', (s: PublicV13Head['state']) => s, 'store-other',
      'Leather boots are sold only at Greenway Outfitters.'],
    ['distance', (s: PublicV13Head['state']) => ({ ...s,
      player: { ...s.player, position: { ...s.player.position, x: s.player.position.x + 4 } } }),
    'store-greenway', 'Move closer to Greenway Outfitters.'],
    ['24g', (s: PublicV13Head['state']) => ({ ...s,
      player: { ...s.player, coins: 24 } }), 'store-greenway',
    'Not enough coins for leather boots.'],
    ['full bag', (s: PublicV13Head['state']) => ({ ...s,
      player: { ...s.player, backpackCapacity: backpackSlotsUsed(s.player.inventory,
        s.player.tradeSlots) } }), 'store-greenway', 'The backpack is full.'],
    ['duplicate inventory', (s: PublicV13Head['state']) => ({ ...s,
      player: { ...s.player, inventory: [...s.player.inventory,
        { itemId: 'leather_boots' as const, quantity: 1 }] } }), 'store-greenway',
    'You already own leather boots.'],
    ['duplicate trade slot', (s: PublicV13Head['state']) => ({ ...s,
      player: { ...s.player, tradeSlots: [{ ...s.player.tradeSlots[0],
        itemId: 'leather_boots' as const, quantity: 1, unitPrice: 25 },
      ...s.player.tradeSlots.slice(1)] as typeof s.player.tradeSlots } }), 'store-greenway',
    'You already own leather boots.'],
  ] as const)('rejects %s without a write or event', async (_name, change, storeId, reason) => {
    const f = await fixture(), current = await readyBoots(f, change)
    const before = await f.v13.read()
    expect(await commitPublicV13BootPurchase(f.locks, f.reader, f.v13,
      storeId, current.saveRevision, current.sourceLineage)).toEqual({ ok: false, reason })
    expect(await f.v13.read()).toEqual(before)
  })

  it('rejects stale revision, source drift, corrupt head, and failed commit', async () => {
    const f = await fixture(), current = await readyBoots(f)
    const before = await f.v13.read()
    expect(await commitPublicV13BootPurchase(f.locks, f.reader, f.v13,
      'store-greenway', 0, current.sourceLineage))
      .toEqual({ ok: false, reason: 'revision-changed' })
    const stale = structuredClone(current.sourceLineage)
    stale.sourceHead.state.player.yaw = -0
    expect(await commitPublicV13BootPurchase(f.locks, f.reader, f.v13,
      'store-greenway', 1, stale)).toEqual({ ok: false, reason: 'source-changed' })
    const spy = vi.spyOn(f.v13, 'commitWithSource').mockResolvedValueOnce('storage-error')
    try {
      expect(await commitPublicV13BootPurchase(f.locks, f.reader, f.v13,
        'store-greenway', 1, current.sourceLineage))
        .toEqual({ ok: false, reason: 'storage-error' })
    } finally { spy.mockRestore() }
    expect(await f.v13.read()).toEqual(before)
    await putRaw(f.factory, v13Name, 'head', { malformed: true })
    const corrupt = await f.v13.read()
    expect(await commitPublicV13BootPurchase(f.locks, f.reader, f.v13,
      'store-greenway', 1, current.sourceLineage))
      .toEqual({ ok: false, reason: 'invalid-v13-records' })
    expect(await f.v13.read()).toEqual(corrupt)
  })

  it('rejects a promoted older source before charging for boots', async () => {
    const f = await fixture(), current = await readyBoots(f)
    const before = await f.v13.read()
    expect((await f.promoteV12()).ok).toBe(true)
    expect(await commitPublicV13BootPurchase(f.locks, f.reader, f.v13,
      'store-greenway', current.saveRevision, current.sourceLineage))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect(await f.v13.read()).toEqual(before)
  })
})
