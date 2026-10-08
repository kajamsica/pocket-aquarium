import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV8Store } from './atomicV8Database'
import { createAtomicV9Store } from './atomicV9Database'
import { createAtomicV10Store } from './atomicV10Database'
import { createAtomicV11Store } from './atomicV11Database'
import { createFreshPublicWorld } from './publicWorldState'
import { PUBLIC_V7_LOCK_NAME, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA,
  serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import { migratePublicV7ToV8 } from './publicWorldV8Flow'
import { encodePublicV8Head } from './publicWorldV8Snapshot'
import { migratePublicV8ToV9 } from './publicWorldV9Flow'
import { encodePublicV9Head } from './publicWorldV9Snapshot'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { commitPublicV10Snapshot, migratePublicV9ToV10 } from './publicWorldV10Flow'
import { encodePublicV10Head } from './publicWorldV10Snapshot'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { commitPublicV11Snapshot, inspectPublicV11, migratePublicV10ToV11,
  resumePublicV11 } from './publicWorldV11Flow'
import { decodePublicV11Head, encodePublicV11Head, parsePublicV11Rescue,
  serializePublicV11Rescue } from './publicWorldV11Snapshot'
import { withPublicV11Highland } from './publicWorldV11State'

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
  expect((await migratePublicV7ToV8(storage, locks, v8, bytes)).ok).toBe(true)
  const v9Source = { sourceV8Head: encodePublicV8Head(base, null, 0), sourceV7Bytes: bytes }
  const v9State = withFreshPublicV9Camps(base)
  expect((await migratePublicV8ToV9(storage, locks, v8, v9, v9Source)).ok).toBe(true)
  const v10Source = { sourceV9Head: encodePublicV9Head(v9State, null, 0), sourceV9Lineage: v9Source }
  const v10State = withPublicV10TerrainRevision(v9State)
  expect((await migratePublicV9ToV10(storage, locks, v8, v9, v10, v10Source)).ok).toBe(true)
  const v11Source = { sourceV10Head: encodePublicV10Head(v10State, null, 0), sourceV10Lineage: v10Source }
  const v11State = withPublicV11Highland(v10State)
  names.length = 0
  return { factory, bytes, writes, storage, names, locks, v8, v9, v10, v11,
    v10Source, v10State, v11Source, v11State }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const inspect = (f: Fixture) => inspectPublicV11(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11)
const migrate = (f: Fixture) => migratePublicV10ToV11(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11, f.v11Source)
const save = (f: Fixture, state = f.v11State, revision = 0) =>
  commitPublicV11Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11, state, revision, f.v11Source)

async function putRaw(f: Fixture, key: string, value: unknown) {
  const request = f.factory.open('wizard-realms:world:v11', 1)
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

function discovered(f: Fixture) {
  return { ...f.v11State, highland: { ...f.v11State.highland, landmarkDiscovered: true } }
}
function harvested(f: Fixture) {
  return { ...f.v11State, highland: { landmarkDiscovered: true,
    stoneNodes: f.v11State.highland.stoneNodes.map((node, index) => index === 0
      ? { ...node, readyAtTick: 3000 } : node) } }
}

describe('public v11 migration, atomic storage and source coherence', () => {
  it('upgrades a validated v10 head under one lock without changing older bytes', async () => {
    const f = await fixture()
    const beforeV8 = await f.v8.read()
    const beforeV9 = await f.v9.read()
    const beforeV10 = await f.v10.read()
    expect(await inspect(f)).toEqual({ ok: true,
      value: { status: 'missing', sourceReceipt: f.v11Source } })
    const start = { state: f.v11State, saveRevision: 0, sourceReceipt: f.v11Source }
    expect(await migrate(f)).toEqual({ ok: true, value: start })
    expect(await inspect(f)).toEqual({ ok: true, value: { status: 'valid', start } })
    expect(await resumePublicV11(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11, 0, f.v11Source))
      .toEqual({ ok: true, value: start })
    expect(await migrate(f)).toEqual({ ok: false, reason: 'v11-records-present' })
    expect(await f.v11.read()).toEqual({ status: 'ok', head: { saveRevision: 0,
      value: encodePublicV11Head(f.v11State, null, 0) }, previous: null, lineage: f.v11Source })
    expect(await f.v8.read()).toEqual(beforeV8)
    expect(await f.v9.read()).toEqual(beforeV9)
    expect(await f.v10.read()).toEqual(beforeV10)
    expect(f.storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(f.bytes)
    expect(f.writes).toEqual([])
    expect(f.names).toEqual(Array(5).fill(PUBLIC_V7_LOCK_NAME))
  })

  it('blocks an orphan branch, stale save, and any retreat in landmark or node readiness', async () => {
    const f = await fixture()
    const orphan = { ...f, v10: createAtomicV10Store(new FakeFactory()) }
    expect(await inspect(orphan)).toEqual({ ok: true, value: { status: 'missing', sourceReceipt: null } })
    expect(await migrate(orphan)).toEqual({ ok: false, reason: 'v10-missing' })
    expect((await migrate(f)).ok).toBe(true)
    const discoveredState = discovered(f)
    expect((await save(f, discoveredState)).ok).toBe(true)
    const harvestedState = harvested(f)
    expect((await save(f, harvestedState, 1)).ok).toBe(true)
    const before = await f.v11.read()
    expect(await save(f, harvestedState, 1)).toEqual({ ok: false, reason: 'revision-changed' })
    expect(await save(f, discoveredState, 2)).toEqual({ ok: false, reason: 'invalid-v11-highland-history' })
    expect(await save(f, f.v11State, 2)).toEqual({ ok: false, reason: 'invalid-v11-highland-history' })
    expect(await f.v11.read()).toEqual(before)
    expect(await resumePublicV11(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11, 2, f.v11Source))
      .toEqual({ ok: true, value: { state: harvestedState, saveRevision: 2, sourceReceipt: f.v11Source } })
  })

  it('blocks a later v10 source change and does not rewrite v11 on failed commit', async () => {
    const f = await fixture()
    expect((await migrate(f)).ok).toBe(true)
    const before = await f.v11.read()
    const changed = { ...f.v10State, player: { ...f.v10State.player, coins: f.v10State.player.coins + 1 } }
    expect((await commitPublicV10Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10,
      changed, 0, f.v10Source)).ok).toBe(true)
    expect(await inspect(f)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-changed' } })
    expect(await save(f)).toEqual({ ok: false, reason: 'source-changed' })
    expect(await f.v11.read()).toEqual(before)
  })

  it('blocks a tampered prior head and refuses a changed expected lineage', async () => {
    const f = await fixture()
    expect((await migrate(f)).ok).toBe(true)
    expect((await save(f, discovered(f))).ok).toBe(true)
    await putRaw(f, 'previous', { saveRevision: 0,
      value: encodePublicV11Head(discovered(f), null, 0) })
    expect(await inspect(f)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v11-previous' } })
    const invalidSource = { ...f.v11Source, sourceV10Head: {} } as typeof f.v11Source
    expect(await resumePublicV11(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11, 1, invalidSource))
      .toEqual({ ok: false, reason: 'invalid-expected-source' })
  })

  it('retains a validated previous head for read-only rescue after latest-head corruption', async () => {
    const f = await fixture()
    expect((await migrate(f)).ok).toBe(true)
    expect((await save(f, discovered(f))).ok).toBe(true)
    const before = await f.v11.read()
    expect(before.status).toBe('ok')
    if (before.status !== 'ok') throw new Error('Missing v11 records')
    const previous = decodePublicV11Head(before.previous?.value)
    expect(previous?.saveRevision).toBe(0)
    const rescue = serializePublicV11Rescue(previous!.state, previous!.bootstrap,
      previous!.saveRevision, f.v11Source)
    expect(parsePublicV11Rescue(rescue)?.snapshot.state).toEqual(f.v11State)
    await putRaw(f, 'head', { saveRevision: 1, value: {} })
    expect(await inspect(f)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v11-head' } })
    const damaged = await f.v11.read()
    expect(damaged.status === 'ok' && damaged.previous).toEqual(before.previous)
    expect(parsePublicV11Rescue(rescue)?.sourceReceipt).toEqual(f.v11Source)
  })

  it('requires the shared lock and lets only one racing compare-and-swap publish', async () => {
    const f = await fixture()
    for (const result of await Promise.all([
      inspectPublicV11(f.storage, undefined, f.v8, f.v9, f.v10, f.v11),
      migratePublicV10ToV11(f.storage, undefined, f.v8, f.v9, f.v10, f.v11, f.v11Source),
      resumePublicV11(f.storage, undefined, f.v8, f.v9, f.v10, f.v11, 0, f.v11Source),
      commitPublicV11Snapshot(f.storage, undefined, f.v8, f.v9, f.v10, f.v11,
        f.v11State, 0, f.v11Source),
    ])) expect(result).toEqual({ ok: false, reason: 'lock-unavailable' })
    expect((await migrate(f)).ok).toBe(true)
    let arrivals = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const racing = { ...f.v11, read: async () => {
      const read = await f.v11.read()
      if (++arrivals === 2) release()
      await gate
      return read
    } }
    const unlocked: PublicV7LockProvider = { request: async (_name, _options, callback) => callback() }
    const results = await Promise.all([1, 2].map((coins) => commitPublicV11Snapshot(f.storage, unlocked,
      f.v8, f.v9, f.v10, racing, { ...f.v11State,
        player: { ...f.v11State.player, coins } }, 0, f.v11Source)))
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: 'revision-changed' }])
  })
})
