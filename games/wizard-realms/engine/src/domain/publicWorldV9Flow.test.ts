import { IDBFactory as FakeFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV8Store } from './atomicV8Database'
import { createAtomicV9Store } from './atomicV9Database'
import { applyFieldCampAction } from './fieldCamp'
import { createGeneratedWorld } from './generation'
import { serializeWizardWorld } from './persistence'
import { commitLegacyImportToPublicV6, inspectLegacyImportSource, PUBLIC_V6_ROOT_KEY } from './publicWorldV6'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { createFreshPublicWorld } from './publicWorldState'
import { createPublicV7StateFromV6Root, PUBLIC_V7_LOCK_NAME, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA,
  serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { commitPublicV8Snapshot, migratePublicV7ToV8 } from './publicWorldV8Flow'
import { encodePublicV8Head } from './publicWorldV8Snapshot'
import { commitPublicV9Snapshot, inspectPublicV9, migratePublicV8ToV9, resumePublicV9 } from './publicWorldV9Flow'
import { encodePublicV9Head } from './publicWorldV9Snapshot'
import type { PublicV9SourceReceipt } from './publicWorldV9Snapshot'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { worldTileAtGrid } from './worldChunks'

async function fixture(bootstrap: PublicV6BootstrapRoot | null = null) {
  const base = bootstrap ? createPublicV7StateFromV6Root(bootstrap)
    : withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'))
  const bytes = `\n${serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
    saveRevision: 4, bootstrap, migrationSourceV6Bytes: bootstrap && JSON.stringify(bootstrap), state: base })}\n`
  const values = new Map([[PUBLIC_V7_ROOT_KEY, bytes]])
  if (bootstrap) {
    values.set(PUBLIC_V6_ROOT_KEY, JSON.stringify(bootstrap))
    values.set(bootstrap.source.key, bootstrap.source.bytes)
  }
  const writes: string[] = []
  const storage = { values, writes, getItem: (key: string) => values.get(key) ?? null,
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
  await migratePublicV7ToV8(storage, locks, v8, bytes)
  const state = { ...base, player: { ...base.player, coins: 17 } }
  await commitPublicV8Snapshot(storage, locks, v8, state, 0)
  names.length = 0
  const sourceReceipt = { sourceV8Head: encodePublicV8Head(state, bootstrap, 1), sourceV7Bytes: bytes }
  const fresh = withFreshPublicV9Camps(state)
  return { factory, bytes, storage, names, locks, v8, v9, state, fresh, sourceReceipt, bootstrap }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const migrate = (f: Fixture) => migratePublicV8ToV9(f.storage, f.locks, f.v8, f.v9, f.sourceReceipt)
const save = (f: Fixture, revision = 0) =>
  commitPublicV9Snapshot(f.storage, f.locks, f.v8, f.v9, f.fresh, revision, f.sourceReceipt)

function placedCamp(f: Fixture) {
  const tile = worldTileAtGrid(f.state.seed, -76, 100)
  const built = applyFieldCampAction({ ...f.fresh, movementOwner: 'streamed',
    player: { ...f.fresh.player, position: { ...tile.center },
      inventory: [...f.fresh.player.inventory, { itemId: 'logs', quantity: 4 }, { itemId: 'stone', quantity: 1 }] },
    discoveredTileIds: [...f.fresh.discoveredTileIds, tile.id].sort() }, tile.id, f.bootstrap)
  if (built.rejection) throw new Error(built.rejection.code)
  return built.state
}

async function putRaw(f: Fixture, version: 8 | 9, key: string, value: unknown) {
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

async function expectBlocked(f: Fixture, reason: string, revision = 0) {
  const before = await f.v9.read()
  expect(await inspectPublicV9(f.storage, f.locks, f.v8, f.v9))
    .toEqual({ ok: true, value: { status: 'blocked', reason } })
  expect(await resumePublicV9(f.storage, f.locks, f.v8, f.v9, revision, f.sourceReceipt))
    .toEqual({ ok: false, reason })
  expect(await save(f, revision)).toEqual({ ok: false, reason })
  expect(await f.v9.read()).toEqual(before)
}

describe('public v9 migration and source coherence', () => {
  it('reports a missing source without authorizing a fresh v9 branch', async () => {
    const f = await fixture()
    const absent = createAtomicV8Store(new FakeFactory())
    expect(await inspectPublicV9(f.storage, f.locks, absent, f.v9))
      .toEqual({ ok: true, value: { status: 'missing', sourceReceipt: null } })
    expect(await migratePublicV8ToV9(f.storage, f.locks, absent, f.v9, f.sourceReceipt))
      .toEqual({ ok: false, reason: 'v8-missing' })
    expect(await resumePublicV9(f.storage, f.locks, f.v8, f.v9, 0, f.sourceReceipt))
      .toEqual({ ok: false, reason: 'v9-missing' })
    expect(await save(f)).toEqual({ ok: false, reason: 'v9-missing' })
    await migrate(f)
    await expectBlocked({ ...f, v8: absent }, 'v8-missing')
  })

  it('returns a detached full source receipt, then migrates once under one lock with unchanged v7/v8 bytes', async () => {
    const f = await fixture()
    const original = await f.v8.read()
    const shared = { ...f.v8, read: async () => original }
    const inspected = await inspectPublicV9(f.storage, f.locks, shared, f.v9)
    expect(inspected).toEqual({ ok: true, value: { status: 'missing', sourceReceipt: f.sourceReceipt } })
    if (!inspected.ok || inspected.value.status !== 'missing' || !inspected.value.sourceReceipt) throw new Error('missing receipt')
    inspected.value.sourceReceipt.sourceV8Head.state.discoveryMask.fill(0)
    expect(await f.v8.read()).toEqual(original)
    if (original.status === 'ok') expect(original.head?.value).toEqual(f.sourceReceipt.sourceV8Head)
    const start = { state: f.fresh, saveRevision: 0, sourceReceipt: f.sourceReceipt }
    expect(await migrate(f)).toEqual({ ok: true, value: start })
    expect(await inspectPublicV9(f.storage, f.locks, f.v8, f.v9))
      .toEqual({ ok: true, value: { status: 'valid', start } })
    expect(await resumePublicV9(f.storage, f.locks, f.v8, f.v9, 0, f.sourceReceipt)).toEqual({ ok: true, value: start })
    expect(await migrate(f)).toEqual({ ok: false, reason: 'v9-records-present' })
    expect(await f.v9.read()).toEqual({ status: 'ok', head: { saveRevision: 0,
      value: encodePublicV9Head(f.fresh, null, 0) }, previous: null, lineage: f.sourceReceipt })
    expect(await f.v8.read()).toEqual(original)
    expect(f.storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(f.bytes)
    expect(f.storage.writes).toEqual([])
    expect(f.names).toEqual(Array(5).fill(PUBLIC_V7_LOCK_NAME))
  })

  it('saves a real camp, reloads it and retains previous state without allowing stale saves', async () => {
    const f = await fixture()
    await migrate(f)
    const before = await f.v9.read()
    const state = placedCamp(f)
    const start = { state, saveRevision: 1, sourceReceipt: f.sourceReceipt }
    expect(await commitPublicV9Snapshot(f.storage, f.locks, f.v8, f.v9, state, 0, f.sourceReceipt))
      .toEqual({ ok: true, value: start })
    expect(await resumePublicV9(f.storage, f.locks, f.v8, createAtomicV9Store(f.factory), 1, f.sourceReceipt))
      .toEqual({ ok: true, value: start })
    const saved = await f.v9.read()
    expect(saved.status === 'ok' && saved.previous).toEqual(before.status === 'ok' && before.head)
    expect(await save(f)).toEqual({ ok: false, reason: 'revision-changed' })
    expect(await resumePublicV9(f.storage, f.locks, f.v8, f.v9, 0, f.sourceReceipt))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await f.v9.read()).toEqual(saved)
  })

  it('never commits or resumes deletion or substitution of a placed camp', async () => {
    for (const substitute of [false, true]) {
      const f = await fixture()
      await migrate(f)
      const placed = placedCamp(f)
      expect((await commitPublicV9Snapshot(f.storage, f.locks, f.v8, f.v9,
        placed, 0, f.sourceReceipt)).ok).toBe(true)
      const alternate = worldTileAtGrid(f.state.seed, -70, 100)
      const changed = substitute
        ? { ...placed, discoveredTileIds: [...placed.discoveredTileIds, alternate.id].sort(),
          fieldCampTileIds: [alternate.id] }
        : { ...placed, fieldCampTileIds: [] }
      const before = await f.v9.read()
      expect(await commitPublicV9Snapshot(f.storage, f.locks, f.v8, f.v9,
        changed, 1, f.sourceReceipt)).toEqual({ ok: false, reason: 'invalid-v9-camp-history' })
      expect(await f.v9.read()).toEqual(before)
      expect((await commitPublicV9Snapshot(f.storage, f.locks, f.v8, f.v9,
        placed, 1, f.sourceReceipt)).ok).toBe(true)
      await putRaw(f, 9, 'head', { saveRevision: 2, value: encodePublicV9Head(changed, f.bootstrap, 2) })
      await expectBlocked(f, 'invalid-v9-camp-history', 2)
    }
  })

  it('retains the real import bootstrap through migration, camp placement, save and reload', async () => {
    const values = new Map([['wizard-realms:world:v5', serializeWizardWorld(createGeneratedWorld('greenway-alpha'))]])
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, bytes: string) => { values.set(key, bytes) } }
    const source = inspectLegacyImportSource(storage, 'greenway-classic-v1')
    if (source.status !== 'available') throw new Error(source.status)
    const imported = commitLegacyImportToPublicV6(storage, source)
    if (imported.status !== 'committed') throw new Error(imported.status)
    const f = await fixture(imported.root)
    const original = await f.v8.read()
    expect((await migrate(f)).ok).toBe(true)
    const state = placedCamp(f)
    expect((await commitPublicV9Snapshot(f.storage, f.locks, f.v8, f.v9, state, 0, f.sourceReceipt)).ok).toBe(true)
    expect(await resumePublicV9(f.storage, f.locks, f.v8, createAtomicV9Store(f.factory), 1, f.sourceReceipt))
      .toEqual({ ok: true, value: { state, saveRevision: 1, sourceReceipt: f.sourceReceipt } })
    expect(await f.v8.read()).toEqual(original)
    expect(f.storage.writes).toEqual([])
  })

  it('blocks all v9 operations when an old v8 tab advances, preserving both branches', async () => {
    const f = await fixture()
    await migrate(f)
    const changed = { ...f.state, player: { ...f.state.player, coins: 22 } }
    expect((await commitPublicV8Snapshot(f.storage, f.locks, f.v8, changed, 1)).ok).toBe(true)
    const newer = await f.v8.read()
    await expectBlocked(f, 'source-changed')
    expect(await f.v8.read()).toEqual(newer)
    expect(f.storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(f.bytes)
    expect(f.storage.writes).toEqual([])
  })

  it('compares v7 bytes exactly and validates the current v8 previous record on every operation', async () => {
    const f = await fixture()
    await migrate(f)
    f.storage.values.set(PUBLIC_V7_ROOT_KEY, f.bytes.trim())
    await expectBlocked(f, 'source-changed')
    f.storage.values.set(PUBLIC_V7_ROOT_KEY, f.bytes)
    await putRaw(f, 8, 'previous', { saveRevision: 0, value: {} })
    await expectBlocked(f, 'invalid-v8-previous')
  })

  it('detects complete source changes even when the v8 revision stays the same', async () => {
    for (const changeMask of [true, false]) {
      const f = await fixture()
      await migrate(f)
      const head = structuredClone(f.sourceReceipt.sourceV8Head)
      if (changeMask) head.state.discoveryMask[0] |= 1
      else head.state.player.coins += 1
      await putRaw(f, 8, 'head', { saveRevision: head.saveRevision, value: head })
      await expectBlocked(f, 'source-changed')
    }
  })

  it('revalidates the selected source before migration and rejects malformed v8 sources', async () => {
    const stale = await fixture()
    await commitPublicV8Snapshot(stale.storage, stale.locks, stale.v8, stale.state, 1)
    expect(await migrate(stale)).toEqual({ ok: false, reason: 'source-changed' })
    expect(await stale.v9.read()).toMatchObject({ head: null, previous: null, lineage: null })
    for (const [key, value, reason] of [['head', {}, 'invalid-v8-head'],
      ['previous', {}, 'invalid-v8-previous'], ['lineage', { sourceV7Bytes: null }, 'invalid-v8-lineage']] as const) {
      const f = await fixture()
      await putRaw(f, 8, key, value)
      expect(await migrate(f)).toEqual({ ok: false, reason })
      expect(await inspectPublicV9(f.storage, f.locks, f.v8, f.v9))
        .toEqual({ ok: true, value: { status: 'blocked', reason } })
      expect(await f.v9.read()).toMatchObject({ head: null, previous: null, lineage: null })
    }
  })

  it('blocks orphaned and malformed v9 records without fallback or overwrite', async () => {
    const orphan = await fixture()
    await orphan.v9.read()
    await putRaw(orphan, 9, 'previous', { saveRevision: 0, value: encodePublicV9Head(orphan.fresh, null, 0) })
    await expectBlocked(orphan, 'invalid-v9-head')
    expect(await migrate(orphan)).toEqual({ ok: false, reason: 'invalid-v9-head' })
    for (const [key, value, reason] of [['head', {}, 'invalid-v9-head'],
      ['head', { saveRevision: 7, value: {} }, 'invalid-v9-head'],
      ['previous', {}, 'invalid-v9-previous'], ['lineage', {}, 'invalid-v9-lineage'],
      ['lineage', { sourceV7Bytes: 'x', sourceV8Head: {} }, 'invalid-v9-lineage']] as const) {
      const f = await fixture()
      await migrate(f)
      await putRaw(f, 9, key, value)
      await expectBlocked(f, reason)
    }
  })

  it('requires revision zero and its recovery copy to be the exact camp-free migration state', async () => {
    for (const previous of [false, true]) {
      const f = await fixture()
      await migrate(f)
      if (previous) await save(f)
      const altered = { ...f.fresh, player: { ...f.fresh.player, coins: 999 } }
      await putRaw(f, 9, previous ? 'previous' : 'head', { saveRevision: 0,
        value: encodePublicV9Head(altered, null, 0) })
      await expectBlocked(f, previous ? 'invalid-v9-previous' : 'invalid-v9-lineage', previous ? 1 : 0)
    }
  })

  it('binds the session to its receipt and rejects invalid or different-world save state', async () => {
    const f = await fixture()
    await migrate(f)
    const before = await f.v9.read()
    const other = { ...f.sourceReceipt, sourceV8Head: { ...f.sourceReceipt.sourceV8Head, saveRevision: 8 } }
    expect(await resumePublicV9(f.storage, f.locks, f.v8, f.v9, 0, other))
      .toEqual({ ok: false, reason: 'lineage-changed' })
    expect(await commitPublicV9Snapshot(f.storage, f.locks, f.v8, f.v9, f.fresh, 0, other))
      .toEqual({ ok: false, reason: 'lineage-changed' })
    const bad = { ...other, sourceV7Bytes: '{}' } as PublicV9SourceReceipt
    expect(await resumePublicV9(f.storage, f.locks, f.v8, f.v9, 0, bad))
      .toEqual({ ok: false, reason: 'invalid-expected-source' })
    for (const state of [{ ...f.fresh, fieldCampTileIds: ['invented'] },
      withFreshPublicV9Camps(withFreshPublicV7Herbs(createFreshPublicWorld('other-world', 'greenway-classic-v1')))]) {
      expect(await commitPublicV9Snapshot(f.storage, f.locks, f.v8, f.v9, state, 0, f.sourceReceipt))
        .toEqual({ ok: false, reason: 'invalid-state' })
    }
    expect(await f.v9.read()).toEqual(before)
  })

  it('lets only one concurrent CAS publish after two callers inspect the same revision', async () => {
    const f = await fixture()
    await migrate(f)
    let arrivals = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const racing = { ...f.v9, read: async () => {
      const read = await f.v9.read()
      if (++arrivals === 2) release()
      await gate
      return read
    } }
    const unlocked: PublicV7LockProvider = { request: async (_name, _options, callback) => callback() }
    const results = await Promise.all([1, 2].map((coins) => commitPublicV9Snapshot(f.storage, unlocked, f.v8,
      racing, { ...f.fresh, player: { ...f.fresh.player, coins } }, 0, f.sourceReceipt)))
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: 'revision-changed' }])
  })

  it('propagates atomic transaction aborts during migration and saving without publishing partial state', async () => {
    const initial = await fixture()
    const existing = await fixture()
    await migrate(existing)
    const before = await existing.v9.read()
    const original = FakeObjectStore.prototype.put
    FakeObjectStore.prototype.put = function (value, key) {
      const request = original.call(this, value, key)
      if (key === 'head' && this.transaction.db.name === 'wizard-realms:world:v9') {
        request.addEventListener('success', () => this.transaction.abort())
      }
      return request
    }
    try {
      expect(await migrate(initial)).toEqual({ ok: false, reason: 'storage-error' })
      expect(await save(existing)).toEqual({ ok: false, reason: 'storage-error' })
    } finally { FakeObjectStore.prototype.put = original }
    expect(await initial.v9.read()).toMatchObject({ head: null, previous: null, lineage: null })
    expect(await existing.v9.read()).toEqual(before)
  })

  it('propagates a lineage CAS failure after inspection and preserves the changed receipt', async () => {
    const f = await fixture()
    await migrate(f)
    const before = await f.v9.read()
    const changed = { ...f.sourceReceipt, sourceV8Head: { ...f.sourceReceipt.sourceV8Head, saveRevision: 8 } }
    const racing = { ...f.v9, commit: async (...args: Parameters<typeof f.v9.commit>) => {
      await putRaw(f, 9, 'lineage', changed)
      return f.v9.commit(...args)
    } }
    expect(await commitPublicV9Snapshot(f.storage, f.locks, f.v8, racing, f.fresh, 0, f.sourceReceipt))
      .toEqual({ ok: false, reason: 'lineage-changed' })
    expect(await f.v9.read()).toEqual({ ...before, lineage: changed })
  })

  it('requires the shared lock for all entry points', async () => {
    const f = await fixture()
    for (const result of await Promise.all([
      inspectPublicV9(f.storage, undefined, f.v8, f.v9),
      migratePublicV8ToV9(f.storage, undefined, f.v8, f.v9, f.sourceReceipt),
      resumePublicV9(f.storage, undefined, f.v8, f.v9, 0, f.sourceReceipt),
      commitPublicV9Snapshot(f.storage, undefined, f.v8, f.v9, f.fresh, 0, f.sourceReceipt),
    ])) expect(result).toEqual({ ok: false, reason: 'lock-unavailable' })
    expect(await f.v9.read()).toMatchObject({ head: null, previous: null, lineage: null })
  })
})
