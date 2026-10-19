import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV8Store } from './domain/atomicV8Database'
import { createAtomicV9Store } from './domain/atomicV9Database'
import { createAtomicV10Store } from './domain/atomicV10Database'
import { createFreshPublicWorld } from './domain/publicWorldState'
import { PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA, serializePublicV7World, withFreshPublicV7Herbs } from './domain/publicWorldV7'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { migratePublicV7ToV8 } from './domain/publicWorldV8Flow'
import { commitPublicV9Snapshot, migratePublicV8ToV9 } from './domain/publicWorldV9Flow'
import { migratePublicV9ToV10, commitPublicV10Snapshot } from './domain/publicWorldV10Flow'
import { parsePublicV10Rescue } from './domain/publicWorldV10Snapshot'
import { inspectPublicV9Entry } from './PublicV9Entry'
import { inspectPublicV10Entry, readPublicV10Rescues } from './PublicV10Entry'

async function fixture() {
  const state = withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'))
  const bytes = serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA, state,
    saveRevision: 2, bootstrap: null, migrationSourceV6Bytes: null })
  const values = new Map([[PUBLIC_V7_ROOT_KEY, bytes]])
  const storage = { getItem: (key: string) => values.get(key) ?? null }
  const locks: PublicV7LockProvider = { request: async (_name, _options, callback) => callback() }
  const factory = new FakeFactory()
  const v8 = createAtomicV8Store(factory), v9 = createAtomicV9Store(factory), v10 = createAtomicV10Store(factory)
  const v8Start = await migratePublicV7ToV8(storage, locks, v8, bytes)
  if (!v8Start.ok) throw new Error(v8Start.reason)
  const v9Entry = await inspectPublicV9Entry(storage, locks, v8, v9)
  if (v9Entry.status !== 'upgrade') throw new Error(v9Entry.status)
  const v9Start = await migratePublicV8ToV9(storage, locks, v8, v9, v9Entry.sourceReceipt)
  if (!v9Start.ok) throw new Error(v9Start.reason)
  return { state, bytes, values, storage, locks, v8, v9, v10, v8Start, v9Start }
}

describe('explicit v10 entry', () => {
  it('offers a read-only v9 upgrade, then resumes only the separate v10 save', async () => {
    const f = await fixture()
    const oldV8 = await f.v8.read(), oldV9 = await f.v9.read()
    const entry = await inspectPublicV10Entry(f.storage, f.locks, f.v8, f.v9, f.v10)
    expect(entry.status).toBe('upgrade')
    expect(await f.v10.read()).toMatchObject({ head: null, previous: null, lineage: null })
    if (entry.status !== 'upgrade') throw new Error(entry.status)
    const migrated = await migratePublicV9ToV10(f.storage, f.locks, f.v8, f.v9, f.v10, entry.sourceReceipt)
    if (!migrated.ok) throw new Error(migrated.reason)
    expect(await inspectPublicV10Entry(f.storage, f.locks, f.v8, f.v9, f.v10))
      .toEqual({ status: 'resume', start: migrated.value })
    expect(migrated.value.state.terrainRevision).toBe('mireglass-cache-pit-v1')
    expect(await f.v8.read()).toEqual(oldV8)
    expect(await f.v9.read()).toEqual(oldV9)
    expect(f.storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(f.bytes)
    const changed = { ...f.v9Start.value.state, player: { ...f.v9Start.value.state.player, coins: 9 } }
    const newerV9 = await commitPublicV9Snapshot(f.storage, f.locks, f.v8, f.v9,
      changed, 0, f.v9Start.value.sourceReceipt)
    if (!newerV9.ok) throw new Error(newerV9.reason)
    expect(await inspectPublicV10Entry(f.storage, f.locks, f.v8, f.v9, f.v10))
      .toEqual({ status: 'blocked', reason: 'source-changed' })
    expect((await readPublicV10Rescues(f.v10)).map(({ source }) => source)).toEqual(['head'])
  })

  it('blocks unavailable locks and gives a v9 link when no v9 world exists', async () => {
    const f = await fixture()
    expect(await inspectPublicV10Entry(f.storage, undefined, f.v8, f.v9, f.v10))
      .toEqual({ status: 'blocked', reason: 'lock-unavailable' })
    expect(await inspectPublicV10Entry(f.storage, f.locks, f.v8,
      createAtomicV9Store(new FakeFactory()), f.v10)).toEqual({ status: 'needs-v9' })
  })
})

describe('blocked startup v10 rescue downloads', () => {
  it('independently exports validated head and previous with the original source receipt', async () => {
    const f = await fixture()
    const entry = await inspectPublicV10Entry(f.storage, f.locks, f.v8, f.v9, f.v10)
    if (entry.status !== 'upgrade') throw new Error(entry.status)
    const migrated = await migratePublicV9ToV10(f.storage, f.locks, f.v8, f.v9, f.v10, entry.sourceReceipt)
    if (!migrated.ok) throw new Error(migrated.reason)
    const next = { ...migrated.value.state, player: { ...migrated.value.state.player, coins: 5 } }
    const saved = await commitPublicV10Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10,
      next, 0, entry.sourceReceipt)
    if (!saved.ok) throw new Error(saved.reason)
    const before = await f.v10.read()
    const rescues = await readPublicV10Rescues(f.v10)
    expect(rescues.map(({ source, saveRevision }) => ({ source, saveRevision })))
      .toEqual([{ source: 'head', saveRevision: 1 }, { source: 'previous', saveRevision: 0 }])
    const parsed = rescues.map(({ bytes }) => parsePublicV10Rescue(bytes))
    expect(parsed.every((rescue) => rescue !== null)).toBe(true)
    expect(parsed.map((rescue) => rescue?.snapshot.state.player.coins)).toEqual([5, migrated.value.state.player.coins])
    expect(parsed.map((rescue) => rescue?.sourceReceipt)).toEqual([entry.sourceReceipt, entry.sourceReceipt])
    expect(await f.v10.read()).toEqual(before)
  })

  it('refuses malformed wrappers and lineage without exporting raw saves', async () => {
    const f = await fixture()
    const entry = await inspectPublicV10Entry(f.storage, f.locks, f.v8, f.v9, f.v10)
    if (entry.status !== 'upgrade') throw new Error(entry.status)
    const migrated = await migratePublicV9ToV10(f.storage, f.locks, f.v8, f.v9, f.v10, entry.sourceReceipt)
    if (!migrated.ok) throw new Error(migrated.reason)
    const saved = await commitPublicV10Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10,
      migrated.value.state, 0, entry.sourceReceipt)
    if (!saved.ok) throw new Error(saved.reason)
    const records = await f.v10.read()
    if (records.status !== 'ok' || !records.head || !records.previous) throw new Error('Missing fixture')
    const read = (patch: Partial<typeof records>) => readPublicV10Rescues({ read: async () => ({ ...records, ...patch }) })
    expect((await read({ head: { saveRevision: 1, value: {} } })).map(({ source }) => source)).toEqual(['previous'])
    expect((await read({ previous: { ...records.previous, unexpected: true } as never })).map(({ source }) => source)).toEqual(['head'])
    expect(await read({ lineage: { ...entry.sourceReceipt, sourceV9Head: {} } as never })).toEqual([])
    expect(await readPublicV10Rescues({ read: async () => ({ status: 'storage-error' }) })).toEqual([])
    expect(await readPublicV10Rescues({ read: async () => { throw new Error('Denied') } })).toEqual([])
  })
})
