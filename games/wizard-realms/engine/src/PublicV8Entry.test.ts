import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV8Store } from './domain/atomicV8Database'
import { createFreshPublicWorld } from './domain/publicWorldState'
import {
  PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA, PUBLIC_V7_STAGE_KEY,
  serializePublicV7World, withFreshPublicV7Herbs,
} from './domain/publicWorldV7'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { migratePublicV7ToV8 } from './domain/publicWorldV8Flow'
import { inspectPublicV8Entry } from './PublicV8Entry'

function fixture() {
  const state = withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'))
  const bytes = serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
    saveRevision: 2, bootstrap: null, migrationSourceV6Bytes: null, state })
  const values = new Map([[PUBLIC_V7_ROOT_KEY, bytes]])
  const reads: string[] = []
  const writes: string[] = []
  const storage = { getItem: (key: string) => { reads.push(key); return values.get(key) ?? null },
    setItem: (key: string, value: string) => { writes.push(key); values.set(key, value) } }
  const locks: PublicV7LockProvider = { request: async (_name, _options, callback) => callback() }
  return { state, bytes, values, reads, writes, storage, locks, db: createAtomicV8Store(new FakeFactory()) }
}

describe('public v8 entry', () => {
  it('offers an explicit upgrade only for a clean playable v7 source', async () => {
    const source = fixture()
    expect(await inspectPublicV8Entry(source.storage, source.locks, source.db))
      .toEqual({ status: 'upgrade', sourceBytes: source.bytes })
    expect(source.writes).toEqual([])
    expect(await source.db.read()).toMatchObject({ status: 'ok', head: null })

    source.values.set(PUBLIC_V7_STAGE_KEY, 'invalid pending stage')
    expect(await inspectPublicV8Entry(source.storage, source.locks, source.db))
      .toEqual({ status: 'needs-v7', reason: 'pending-v7-stage' })
    source.values.delete(PUBLIC_V7_STAGE_KEY)
    source.values.delete(PUBLIC_V7_ROOT_KEY)
    expect(await inspectPublicV8Entry(source.storage, source.locks, source.db))
      .toEqual({ status: 'needs-v7', reason: null })
    expect(source.writes).toEqual([])
  })

  it('offers explicit resume when v8 is valid, then blocks when its v7 source changes', async () => {
    const source = fixture()
    const migrated = await migratePublicV7ToV8(source.storage, source.locks, source.db, source.bytes)
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(await inspectPublicV8Entry(source.storage, source.locks, source.db))
      .toEqual({ status: 'resume', start: migrated.value })
    source.values.set(PUBLIC_V7_ROOT_KEY, serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
      saveRevision: 3, bootstrap: null, migrationSourceV6Bytes: null,
      state: { ...source.state, player: { ...source.state.player, coins: 40 } } }))
    expect(await inspectPublicV8Entry(source.storage, source.locks, source.db))
      .toEqual({ status: 'blocked', reason: 'source-changed' })
    expect(source.writes).toEqual([])
  })

  it('never inspects v7 after a blocked v8 head and closes on missing locks', async () => {
    const source = fixture()
    expect(await source.db.commit(null, null, { saveRevision: 0, value: {} },
      { sourceV7Bytes: source.bytes })).toBe('committed')
    expect(await inspectPublicV8Entry(source.storage, source.locks, source.db))
      .toEqual({ status: 'blocked', reason: 'invalid-v8-head' })
    expect(source.reads).toEqual([])
    expect(await inspectPublicV8Entry(source.storage, undefined, source.db))
      .toEqual({ status: 'blocked', reason: 'lock-unavailable' })
    expect(source.writes).toEqual([])
  })
})
