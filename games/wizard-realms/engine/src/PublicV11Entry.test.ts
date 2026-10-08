import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV8Store } from './domain/atomicV8Database'
import { createAtomicV9Store } from './domain/atomicV9Database'
import { createAtomicV10Store } from './domain/atomicV10Database'
import { createAtomicV11Store } from './domain/atomicV11Database'
import { createActiveWorldTerrain } from './domain/activeWorldTerrain'
import { highlandRidgeCellAtWorld, highlandRidgeRecoveryTarget } from './domain/highlandRidge'
import { createFreshPublicWorld } from './domain/publicWorldState'
import { PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA, serializePublicV7World, withFreshPublicV7Herbs } from './domain/publicWorldV7'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { migratePublicV7ToV8 } from './domain/publicWorldV8Flow'
import { migratePublicV8ToV9 } from './domain/publicWorldV9Flow'
import { commitPublicV10Snapshot, migratePublicV9ToV10 } from './domain/publicWorldV10Flow'
import { commitPublicV11Snapshot, migratePublicV10ToV11, resumePublicV11 } from './domain/publicWorldV11Flow'
import { advancePublicWorldV11Frame } from './domain/publicWorldV11Authority'
import { parsePublicV11Rescue } from './domain/publicWorldV11Snapshot'
import { inspectPublicV9Entry } from './PublicV9Entry'
import { inspectPublicV10Entry } from './PublicV10Entry'
import { inspectPublicV11Entry, readPublicV11Rescues } from './PublicV11Entry'

async function fixture() {
  const state = withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'))
  const bytes = serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA, state,
    saveRevision: 2, bootstrap: null, migrationSourceV6Bytes: null })
  const values = new Map([[PUBLIC_V7_ROOT_KEY, bytes]])
  const storage = { getItem: (key: string) => values.get(key) ?? null }
  const locks: PublicV7LockProvider = { request: async (_name, _options, callback) => callback() }
  const factory = new FakeFactory()
  const v8 = createAtomicV8Store(factory), v9 = createAtomicV9Store(factory)
  const v10 = createAtomicV10Store(factory), v11 = createAtomicV11Store(factory)
  const v8Start = await migratePublicV7ToV8(storage, locks, v8, bytes)
  if (!v8Start.ok) throw new Error(v8Start.reason)
  const v9Entry = await inspectPublicV9Entry(storage, locks, v8, v9)
  if (v9Entry.status !== 'upgrade') throw new Error(v9Entry.status)
  const v9Start = await migratePublicV8ToV9(storage, locks, v8, v9, v9Entry.sourceReceipt)
  if (!v9Start.ok) throw new Error(v9Start.reason)
  const v10Entry = await inspectPublicV10Entry(storage, locks, v8, v9, v10)
  if (v10Entry.status !== 'upgrade') throw new Error(v10Entry.status)
  const v10Start = await migratePublicV9ToV10(storage, locks, v8, v9, v10, v10Entry.sourceReceipt)
  if (!v10Start.ok) throw new Error(v10Start.reason)
  return { bytes, storage, locks, v8, v9, v10, v11, v10Start }
}

describe('explicit v11 entry', () => {
  it('offers a read-only v10 upgrade, then resumes only the separate v11 save', async () => {
    const f = await fixture()
    const oldV8 = await f.v8.read(), oldV9 = await f.v9.read(), oldV10 = await f.v10.read()
    const entry = await inspectPublicV11Entry(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11)
    expect(entry.status).toBe('upgrade')
    expect(await f.v11.read()).toMatchObject({ head: null, previous: null, lineage: null })
    if (entry.status !== 'upgrade') throw new Error(entry.status)
    const migrated = await migratePublicV10ToV11(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11, entry.sourceReceipt)
    if (!migrated.ok) throw new Error(migrated.reason)
    expect(await inspectPublicV11Entry(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11))
      .toEqual({ status: 'resume', start: migrated.value })
    expect(await resumePublicV11(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11,
      migrated.value.saveRevision, entry.sourceReceipt)).toEqual(migrated)
    expect(migrated.value.state.highlandContentRevision).toBe('highland-quarry-v1')
    expect(migrated.value.state.highland.stoneNodes).toHaveLength(4)
    expect(await f.v8.read()).toEqual(oldV8)
    expect(await f.v9.read()).toEqual(oldV9)
    expect(await f.v10.read()).toEqual(oldV10)
    expect(f.storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(f.bytes)
    const changed = { ...f.v10Start.value.state, player: { ...f.v10Start.value.state.player, coins: 9 } }
    const newerV10 = await commitPublicV10Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10,
      changed, 0, f.v10Start.value.sourceReceipt)
    if (!newerV10.ok) throw new Error(newerV10.reason)
    expect(await inspectPublicV11Entry(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11))
      .toEqual({ status: 'blocked', reason: 'source-changed' })
    expect((await readPublicV11Rescues(f.v11)).map(({ source }) => source)).toEqual(['head'])
  })

  it('blocks unavailable locks and links to the v10 entry when no v10 world exists', async () => {
    const f = await fixture()
    expect(await inspectPublicV11Entry(f.storage, undefined, f.v8, f.v9, f.v10, f.v11))
      .toEqual({ status: 'blocked', reason: 'lock-unavailable' })
    expect(await inspectPublicV11Entry(f.storage, f.locks, f.v8, f.v9,
      createAtomicV10Store(new FakeFactory()), f.v11)).toEqual({ status: 'needs-v10' })
  })

  it('resumes a legacy ridge-rock pose unchanged and saves an authoritative escape to open ground', async () => {
    const f = await fixture()
    const entry = await inspectPublicV11Entry(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11)
    if (entry.status !== 'upgrade') throw new Error(entry.status)
    const migrated = await migratePublicV10ToV11(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11, entry.sourceReceipt)
    if (!migrated.ok) throw new Error(migrated.reason)

    const rock = { x: 580, z: -500 }
    const terrain = createActiveWorldTerrain(migrated.value.state.seed,
      { cachePitDug: migrated.value.state.mireglass.cacheExcavated })
    terrain.activate(rock)
    const ground = terrain.tileAtWorld(rock.x, rock.z)
    if (!ground) throw new Error('Missing ridge-rock fixture ground')
    const legacy = { ...migrated.value.state, movementOwner: 'streamed' as const,
      player: { ...migrated.value.state.player, position: { ...rock, y: ground.center.y }, verticalVelocity: 0 },
      discoveredTileIds: [...new Set([...migrated.value.state.discoveredTileIds, ground.id])].sort() }
    const saved = await commitPublicV11Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11,
      legacy, migrated.value.saveRevision, entry.sourceReceipt)
    if (!saved.ok) throw new Error(saved.reason)
    expect(saved.value.saveRevision).toBe(1)
    const savedRecords = await f.v11.read()
    if (savedRecords.status !== 'ok' || !savedRecords.head) throw new Error('Missing legacy ridge save')

    const inspected = await inspectPublicV11Entry(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11)
    expect(inspected).toEqual({ status: 'resume', start: saved.value })
    const resumed = await resumePublicV11(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11,
      saved.value.saveRevision, entry.sourceReceipt)
    expect(resumed).toEqual(saved)
    if (!resumed.ok) throw new Error(resumed.reason)
    expect(resumed.value.state).toEqual(legacy)
    expect(resumed.value.state.player.position).toEqual({ ...rock, y: ground.center.y })
    expect(resumed.value.state.discoveredTileIds).toContain(ground.id)
    expect(resumed.value.state.fieldCampTileIds).toEqual(legacy.fieldCampTileIds)
    expect(resumed.value.state.mireglass).toEqual(legacy.mireglass)
    expect(resumed.value.state.highland).toEqual(legacy.highland)
    expect(resumed.value.saveRevision).toBe(1)
    expect(await f.v11.read()).toEqual(savedRecords)

    const target = highlandRidgeRecoveryTarget(rock.x, rock.z)
    expect(target).toEqual({ x: 600, z: -500, distance: 20 })
    if (!target) throw new Error('Missing ridge recovery target')
    let escaped = resumed.value.state
    for (let step = 1; step <= 5; step++) {
      const moved = advancePublicWorldV11Frame(escaped, [{ type: 'move', delta: { x: 4, z: 0 } }])
      expect(moved.rejections).toEqual([])
      expect(moved.events).toContainEqual(expect.objectContaining({ type: 'player_moved' }))
      expect(moved.state.player.position.x).toBe(rock.x + step * 4)
      expect(moved.state.player.position.z).toBe(rock.z)
      escaped = moved.state
    }
    expect(escaped.player.position.x).toBe(target.x)
    expect(escaped.player.position.z).toBe(target.z)
    expect(highlandRidgeCellAtWorld(escaped.player.position.x, escaped.player.position.z)).toBeNull()
    const committed = await commitPublicV11Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11,
      escaped, resumed.value.saveRevision, entry.sourceReceipt)
    if (!committed.ok) throw new Error(committed.reason)
    expect(committed.value.saveRevision).toBe(2)
    expect(committed.value.state).toEqual(escaped)
    expect(committed.value.sourceReceipt).toEqual(entry.sourceReceipt)
    const movedRecords = await f.v11.read()
    expect(movedRecords).toMatchObject({ head: { saveRevision: 2 }, previous: { saveRevision: 1 } })
    if (movedRecords.status !== 'ok') throw new Error('Missing moved ridge save')
    expect(movedRecords.previous).toEqual(savedRecords.head)
    const reopened = await inspectPublicV11Entry(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11)
    expect(reopened).toEqual({ status: 'resume', start: committed.value })
    if (reopened.status !== 'resume') throw new Error(reopened.status)
    expect(reopened.start.state.player.position).toEqual(escaped.player.position)
    expect(await resumePublicV11(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11,
      committed.value.saveRevision, entry.sourceReceipt)).toEqual(committed)
  })
})

describe('blocked startup v11 rescue downloads', () => {
  it('independently exports validated head and previous with the original source receipt', async () => {
    const f = await fixture()
    const entry = await inspectPublicV11Entry(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11)
    if (entry.status !== 'upgrade') throw new Error(entry.status)
    const migrated = await migratePublicV10ToV11(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11, entry.sourceReceipt)
    if (!migrated.ok) throw new Error(migrated.reason)
    const next = { ...migrated.value.state, player: { ...migrated.value.state.player, coins: 5 } }
    const saved = await commitPublicV11Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11,
      next, 0, entry.sourceReceipt)
    if (!saved.ok) throw new Error(saved.reason)
    const before = await f.v11.read()
    const rescues = await readPublicV11Rescues(f.v11)
    expect(rescues.map(({ source, saveRevision }) => ({ source, saveRevision })))
      .toEqual([{ source: 'head', saveRevision: 1 }, { source: 'previous', saveRevision: 0 }])
    const parsed = rescues.map(({ bytes }) => parsePublicV11Rescue(bytes))
    expect(parsed.every((rescue) => rescue !== null)).toBe(true)
    expect(parsed.map((rescue) => rescue?.snapshot.state.player.coins)).toEqual([5, migrated.value.state.player.coins])
    expect(parsed.map((rescue) => rescue?.sourceReceipt)).toEqual([entry.sourceReceipt, entry.sourceReceipt])
    expect(await f.v11.read()).toEqual(before)
  })

  it('refuses malformed wrappers and lineage without exporting raw saves', async () => {
    const f = await fixture()
    const entry = await inspectPublicV11Entry(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11)
    if (entry.status !== 'upgrade') throw new Error(entry.status)
    const migrated = await migratePublicV10ToV11(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11, entry.sourceReceipt)
    if (!migrated.ok) throw new Error(migrated.reason)
    const saved = await commitPublicV11Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11,
      migrated.value.state, 0, entry.sourceReceipt)
    if (!saved.ok) throw new Error(saved.reason)
    const records = await f.v11.read()
    if (records.status !== 'ok' || !records.head || !records.previous) throw new Error('Missing fixture')
    const read = (patch: Partial<typeof records>) => readPublicV11Rescues({ read: async () => ({ ...records, ...patch }) })
    expect((await read({ head: { saveRevision: 1, value: {} } })).map(({ source }) => source)).toEqual(['previous'])
    expect((await read({ previous: { ...records.previous, unexpected: true } as never })).map(({ source }) => source)).toEqual(['head'])
    expect(await read({ lineage: { ...entry.sourceReceipt, sourceV10Head: {} } as never })).toEqual([])
    expect(await readPublicV11Rescues({ read: async () => ({ status: 'storage-error' }) })).toEqual([])
    expect(await readPublicV11Rescues({ read: async () => { throw new Error('Denied') } })).toEqual([])
  })
})
