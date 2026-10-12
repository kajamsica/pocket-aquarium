import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { inspectPublicV13Entry, PublicV13SourceLink, readPublicV13Rescues } from './PublicV13Entry'
import { createAtomicV8Store } from './domain/atomicV8Database'
import { createAtomicV9Store } from './domain/atomicV9Database'
import { createAtomicV10Store } from './domain/atomicV10Database'
import { createAtomicV11Store } from './domain/atomicV11Database'
import { createAtomicV12Store } from './domain/atomicV12Database'
import { createAtomicV13Store } from './domain/atomicV13Database'
import { createFreshPublicWorld } from './domain/publicWorldState'
import { PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA, serializePublicV7World,
  withFreshPublicV7Herbs } from './domain/publicWorldV7'
import { migratePublicV7ToV8 } from './domain/publicWorldV8Flow'
import { encodePublicV8Head } from './domain/publicWorldV8Snapshot'
import { migratePublicV8ToV9 } from './domain/publicWorldV9Flow'
import { encodePublicV9Head } from './domain/publicWorldV9Snapshot'
import { withFreshPublicV9Camps } from './domain/publicWorldV9State'
import { migratePublicV9ToV10 } from './domain/publicWorldV10Flow'
import { encodePublicV10Head } from './domain/publicWorldV10Snapshot'
import { withPublicV10TerrainRevision } from './domain/publicWorldV10State'
import { migratePublicV10ToV11 } from './domain/publicWorldV11Flow'
import { encodePublicV11Head } from './domain/publicWorldV11Snapshot'
import { withPublicV11Highland } from './domain/publicWorldV11State'
import { commitPublicV12Snapshot, migratePublicV11ToV12 } from './domain/publicWorldV12Flow'
import { commitPublicV13Snapshot, migratePublicSourceToV13 } from './domain/publicWorldV13Flow'
import { parsePublicV13Rescue } from './domain/publicWorldV13Rescue'
import { createPublicV13SourceReader } from './domain/publicWorldV13SourceReader'

async function fixture() {
  const factory = new FakeFactory(), locks = { request: async <T,>(_name: string,
    _options: { mode: 'exclusive' }, callback: () => Promise<T>) => callback() }
  const base = withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'))
  const bytes = serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA, saveRevision: 4,
    bootstrap: null, migrationSourceV6Bytes: null, state: base })
  const values = new Map([[PUBLIC_V7_ROOT_KEY, bytes]])
  const storage = { getItem: (key: string) => values.get(key) ?? null }
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
  const reader = createPublicV13SourceReader(factory, storage, v8, v9, v10, v11, v12)
  return { storage, values, locks, v8, v9, v10, v11, v12, v13, reader,
    promoteV12: () => migratePublicV11ToV12(storage, locks, v8, v9, v10, v11, v12,
      { sourceV11Head: encodePublicV11Head(s11, null, 0), sourceV11Receipt: r11 }) }
}

describe('unmounted explicit v13 entry', () => {
  it('gives the fallback source link a 44px touch target', () => {
    const html = renderToStaticMarkup(createElement(PublicV13SourceLink))
    expect(html).toContain('href="?publicWorld=v11"')
    expect(html).toContain('display:inline-flex')
    expect(html).toContain('min-height:44px')
    expect(html).toContain('align-items:center')
  })

  it('only offers migration on inspection, then explicitly resumes a separate v13 save', async () => {
    const f = await fixture()
    const old = await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read(), f.v12.read()])
    const entry = await inspectPublicV13Entry(f.locks, f.reader, f.v13)
    expect(entry.status).toBe('upgrade')
    expect(await f.v13.read()).toMatchObject({ head: null, previous: null, lineage: null })
    if (entry.status !== 'upgrade') throw Error(entry.status)
    const migrated = await migratePublicSourceToV13(f.locks, f.reader, f.v13, entry.sourceLineage)
    if (!migrated.ok) throw Error(migrated.reason)
    expect(await inspectPublicV13Entry(f.locks, f.reader, f.v13))
      .toEqual({ status: 'resume', start: migrated.value })
    expect(await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read(), f.v12.read()])).toEqual(old)
    expect(f.storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(f.values.get(PUBLIC_V7_ROOT_KEY))
  })

  it('selects a v12 source when present and blocks a changed source without resetting v13', async () => {
    const f = await fixture()
    const promoted = await f.promoteV12()
    if (!promoted.ok) throw Error(promoted.reason)
    const entry = await inspectPublicV13Entry(f.locks, f.reader, f.v13)
    if (entry.status !== 'upgrade') throw Error(entry.status)
    expect(entry.sourceLineage.sourceSchemaVersion).toBe('wizard-world/v12')
    const migrated = await migratePublicSourceToV13(f.locks, f.reader, f.v13, entry.sourceLineage)
    if (!migrated.ok) throw Error(migrated.reason)
    const before = await f.v13.read()
    const newer = { ...promoted.value.state, tick: promoted.value.state.tick + 1,
      player: { ...promoted.value.state.player, coins: 7 } }
    expect((await commitPublicV12Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10, f.v11, f.v12,
      newer, promoted.value.saveRevision, promoted.value.sourceReceipt)).ok).toBe(true)
    expect(await inspectPublicV13Entry(f.locks, f.reader, f.v13))
      .toEqual({ status: 'blocked', reason: 'invalid-v13-records' })
    expect(await inspectPublicV13Entry(undefined, f.reader, f.v13))
      .toEqual({ status: 'blocked', reason: 'lock-unavailable' })
    expect(await f.v13.read()).toEqual(before)
  })

  it('exports only individually validated offline records from a blocked save', async () => {
    const f = await fixture()
    const entry = await inspectPublicV13Entry(f.locks, f.reader, f.v13)
    if (entry.status !== 'upgrade') throw Error(entry.status)
    const migrated = await migratePublicSourceToV13(f.locks, f.reader, f.v13, entry.sourceLineage)
    if (!migrated.ok) throw Error(migrated.reason)
    const saved = await commitPublicV13Snapshot(f.locks, f.reader, f.v13,
      { ...migrated.value.state, tick: migrated.value.state.tick + 1 },
      migrated.value.saveRevision, migrated.value.sourceLineage)
    if (!saved.ok) throw Error(saved.reason)
    const before = await f.v13.read()
    if (before.status !== 'ok') throw Error('Missing v13 records')
    const exports = await readPublicV13Rescues(f.v13)
    expect(exports.map(({ source, saveRevision }) => ({ source, saveRevision })))
      .toEqual([{ source: 'head', saveRevision: 1 }, { source: 'previous', saveRevision: 0 }])
    expect(parsePublicV13Rescue(exports[0].bytes)?.savedBase.state).toEqual(saved.value.state)
    expect(await f.v13.read()).toEqual(before)
    expect((await readPublicV13Rescues({ read: async () => ({ ...before,
      head: { saveRevision: 1, value: {} } }) })).map(({ source }) => source)).toEqual(['previous'])
    expect(await readPublicV13Rescues({ read: async () => ({ ...before,
      lineage: { broken: true } }) })).toEqual([])
    expect(await readPublicV13Rescues({ read: async () => { throw Error('denied') } })).toEqual([])
  })
})
