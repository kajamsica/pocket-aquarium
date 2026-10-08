import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV8Store } from './domain/atomicV8Database'
import { createAtomicV9Store } from './domain/atomicV9Database'
import { applyFieldCampAction } from './domain/fieldCamp'
import { createFreshPublicWorld } from './domain/publicWorldState'
import { PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA, serializePublicV7World, withFreshPublicV7Herbs } from './domain/publicWorldV7'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { commitPublicV8Snapshot, migratePublicV7ToV8 } from './domain/publicWorldV8Flow'
import { commitPublicV9Snapshot, migratePublicV8ToV9, resumePublicV9 } from './domain/publicWorldV9Flow'
import { parsePublicV9Rescue } from './domain/publicWorldV9Snapshot'
import { worldTileAtGrid } from './domain/worldChunks'
import { inspectPublicV9Entry, readPublicV9Rescues } from './PublicV9Entry'

async function fixture() {
  const state = withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'))
  const bytes = serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA, state,
    saveRevision: 2, bootstrap: null, migrationSourceV6Bytes: null })
  const values = new Map([[PUBLIC_V7_ROOT_KEY, bytes]])
  const storage = { getItem: (key: string) => values.get(key) ?? null }
  const locks: PublicV7LockProvider = { request: async (_name, _options, callback) => callback() }
  const factory = new FakeFactory()
  const v8 = createAtomicV8Store(factory), v9 = createAtomicV9Store(factory)
  await migratePublicV7ToV8(storage, locks, v8, bytes)
  return { state, bytes, values, storage, locks, v8, v9 }
}

describe('explicit v9 entry', () => {
  it('offers upgrade without writing and resumes only the explicit separate migration', async () => {
    const f = await fixture()
    const oldV8 = await f.v8.read()
    const entry = await inspectPublicV9Entry(f.storage, f.locks, f.v8, f.v9)
    expect(entry.status).toBe('upgrade')
    expect(await f.v9.read()).toMatchObject({ head: null, previous: null, lineage: null })
    if (entry.status !== 'upgrade') throw new Error(entry.status)
    const migrated = await migratePublicV8ToV9(f.storage, f.locks, f.v8, f.v9, entry.sourceReceipt)
    if (!migrated.ok) throw new Error(migrated.reason)
    expect(await inspectPublicV9Entry(f.storage, f.locks, f.v8, f.v9))
      .toEqual({ status: 'resume', start: migrated.value })
    expect(await resumePublicV9(f.storage, f.locks, f.v8, f.v9, 0, entry.sourceReceipt)).toEqual(migrated)
    expect(await f.v8.read()).toEqual(oldV8)
    expect(f.storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(f.bytes)
    await commitPublicV8Snapshot(f.storage, f.locks, f.v8, f.state, 0)
    expect(await inspectPublicV9Entry(f.storage, f.locks, f.v8, f.v9))
      .toEqual({ status: 'blocked', reason: 'source-changed' })
  })

  it('blocks a corrupt source and unavailable locks without resetting either store', async () => {
    const f = await fixture()
    f.values.set(PUBLIC_V7_ROOT_KEY, 'corrupt')
    const before = await f.v8.read()
    expect(await inspectPublicV9Entry(f.storage, f.locks, f.v8, f.v9))
      .toMatchObject({ status: 'blocked' })
    expect(await inspectPublicV9Entry(f.storage, undefined, f.v8, f.v9))
      .toEqual({ status: 'blocked', reason: 'lock-unavailable' })
    expect(await f.v8.read()).toEqual(before)
    expect(await f.v9.read()).toMatchObject({ head: null, previous: null, lineage: null })
    expect(f.storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe('corrupt')
    expect(await inspectPublicV9Entry(f.storage, f.locks, createAtomicV8Store(new FakeFactory()), f.v9))
      .toEqual({ status: 'needs-v8' })
  })
})

describe('blocked startup v9 rescue downloads', () => {
  async function savedFixture() {
    const f = await fixture()
    const entry = await inspectPublicV9Entry(f.storage, f.locks, f.v8, f.v9)
    if (entry.status !== 'upgrade') throw new Error(entry.status)
    const migrated = await migratePublicV8ToV9(f.storage, f.locks, f.v8, f.v9, entry.sourceReceipt)
    if (!migrated.ok) throw new Error(migrated.reason)
    const tile = worldTileAtGrid(f.state.seed, -76, 100)
    const placed = applyFieldCampAction({ ...migrated.value.state, movementOwner: 'streamed',
      player: { ...f.state.player, position: tile.center, inventory: [...f.state.player.inventory,
        { itemId: 'logs', quantity: 4 }, { itemId: 'stone', quantity: 1 }] },
      discoveredTileIds: [...new Set([...f.state.discoveredTileIds, tile.id])].sort() }, tile.id)
    if (placed.rejection) throw new Error(placed.rejection.message)
    const saved = await commitPublicV9Snapshot(f.storage, f.locks, f.v8, f.v9, placed.state, 0, entry.sourceReceipt)
    if (!saved.ok) throw new Error(saved.reason)
    return { ...f, tile, sourceReceipt: entry.sourceReceipt }
  }

  it('exports head and previous with source receipts despite changed or missing live v8, without writing', async () => {
    const f = await savedFixture()
    await commitPublicV8Snapshot(f.storage, f.locks, f.v8, f.state, 0)
    expect(await inspectPublicV9Entry(f.storage, f.locks, f.v8, f.v9))
      .toEqual({ status: 'blocked', reason: 'source-changed' })
    const beforeV8 = await f.v8.read(), beforeV9 = await f.v9.read()
    const rescues = await readPublicV9Rescues(f.v9)
    expect(rescues.map(({ source, saveRevision }) => ({ source, saveRevision })))
      .toEqual([{ source: 'head', saveRevision: 1 }, { source: 'previous', saveRevision: 0 }])
    const parsed = rescues.map(({ bytes }) => parsePublicV9Rescue(bytes))
    expect(parsed.every((rescue) => rescue !== null)).toBe(true)
    expect(parsed[0]?.snapshot.state.fieldCampTileIds).toEqual([f.tile.id])
    expect(parsed[1]?.snapshot.state.fieldCampTileIds).toEqual([])
    expect(parsed.map((rescue) => rescue?.sourceReceipt)).toEqual([f.sourceReceipt, f.sourceReceipt])
    expect(await inspectPublicV9Entry(f.storage, f.locks, createAtomicV8Store(new FakeFactory()), f.v9))
      .toEqual({ status: 'blocked', reason: 'v8-missing' })
    expect(await readPublicV9Rescues(f.v9)).toEqual(rescues)
    expect(await f.v8.read()).toEqual(beforeV8)
    expect(await f.v9.read()).toEqual(beforeV9)
    expect(f.storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(f.bytes)
  })

  it('validates each slot independently and refuses malformed wrappers, lineage, and unreadable storage', async () => {
    const f = await savedFixture()
    const records = await f.v9.read()
    if (records.status !== 'ok' || !records.head || !records.previous) throw new Error('Missing fixture')
    const read = (patch: Partial<typeof records>) => readPublicV9Rescues({ read: async () => ({ ...records, ...patch }) })
    for (const head of [{ saveRevision: 1, value: {} }, { ...records.head, saveRevision: 2 },
      { ...records.head, unexpected: true }]) {
      expect((await read({ head })).map(({ source }) => source)).toEqual(['previous'])
    }
    expect((await read({ previous: { saveRevision: 0, value: {} } })).map(({ source }) => source)).toEqual(['head'])
    expect(await read({ lineage: { ...f.sourceReceipt, sourceV7Bytes: 'invalid' } })).toEqual([])
    expect(await read({ head: null, previous: null })).toEqual([])
    expect(await readPublicV9Rescues({ read: async () => ({ status: 'storage-error' }) })).toEqual([])
    expect(await readPublicV9Rescues({ read: async () => { throw new Error('Storage denied') } })).toEqual([])
    expect(await f.v9.read()).toEqual(records)
  })
})
