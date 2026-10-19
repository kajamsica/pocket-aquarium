import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV8Store } from './domain/atomicV8Database'
import { createAtomicV9Store } from './domain/atomicV9Database'
import { createAtomicV10Store } from './domain/atomicV10Database'
import { createAtomicV11Store } from './domain/atomicV11Database'
import { createAtomicV12Store } from './domain/atomicV12Database'
import { createFreshPublicWorld } from './domain/publicWorldState'
import { PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA, serializePublicV7World,
  withFreshPublicV7Herbs } from './domain/publicWorldV7'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import { migratePublicV7ToV8 } from './domain/publicWorldV8Flow'
import { inspectPublicV9 } from './domain/publicWorldV9Flow'
import { migratePublicV8ToV9 } from './domain/publicWorldV9Flow'
import { inspectPublicV10, migratePublicV9ToV10 } from './domain/publicWorldV10Flow'
import { commitPublicV11Snapshot, inspectPublicV11, migratePublicV10ToV11 } from './domain/publicWorldV11Flow'
import { commitPublicV12Snapshot } from './domain/publicWorldV12Flow'
import { parsePublicV12Rescue } from './domain/publicWorldV12Snapshot'
import { choosePublicV12Entry, inspectPublicV12Entry, PublicV12EntryView,
  readPublicV12Rescues, type PublicV12EntryBindings, type PublicV12EntryDecision } from './PublicV12Entry'

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
  const v12 = createAtomicV12Store(factory)
  const v8Start = await migratePublicV7ToV8(storage, locks, v8, bytes)
  if (!v8Start.ok) throw new Error(v8Start.reason)
  const v9Entry = await inspectPublicV9(storage, locks, v8, v9)
  if (!v9Entry.ok || v9Entry.value.status !== 'missing' || !v9Entry.value.sourceReceipt) {
    throw new Error('Expected v9 source')
  }
  const v9Start = await migratePublicV8ToV9(storage, locks, v8, v9, v9Entry.value.sourceReceipt)
  if (!v9Start.ok) throw new Error(v9Start.reason)
  const v10Entry = await inspectPublicV10(storage, locks, v8, v9, v10)
  if (!v10Entry.ok || v10Entry.value.status !== 'missing' || !v10Entry.value.sourceReceipt) {
    throw new Error('Expected v10 source')
  }
  const v10Start = await migratePublicV9ToV10(storage, locks, v8, v9, v10, v10Entry.value.sourceReceipt)
  if (!v10Start.ok) throw new Error(v10Start.reason)
  const v11Entry = await inspectPublicV11(storage, locks, v8, v9, v10, v11)
  if (!v11Entry.ok || v11Entry.value.status !== 'missing' || !v11Entry.value.sourceReceipt) {
    throw new Error('Expected v11 source')
  }
  const v11Start = await migratePublicV10ToV11(storage, locks, v8, v9, v10, v11, v11Entry.value.sourceReceipt)
  if (!v11Start.ok) throw new Error(v11Start.reason)
  const bindings: PublicV12EntryBindings = { storage, locks, v8, v9, v10, v11, v12 }
  const inspect = () => inspectPublicV12Entry(storage, locks, v8, v9, v10, v11, v12)
  return { bytes, storage, bindings, inspect, v8, v9, v10, v11, v12, v11Start }
}

function view(entry: PublicV12EntryDecision | { status: 'checking' },
  rescues: Awaited<ReturnType<typeof readPublicV12Rescues>> | null = null, busy = false) {
  return renderToStaticMarkup(createElement(PublicV12EntryView, { entry, busy, rescues,
    downloadNotice: '', onChoose: () => {}, onDownload: () => {}, onReload: () => {} }))
}

describe('explicit v12 entry', () => {
  it('offers a read-only v11 upgrade, rechecks the choice, then resumes only the separate v12 save', async () => {
    const f = await fixture()
    const oldStores = await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read()])
    const decision = await f.inspect()
    expect(decision.status).toBe('upgrade')
    expect(await f.v12.read()).toMatchObject({ head: null, previous: null, lineage: null })
    expect(view(decision)).toContain('Upgrade v11 world to v12')
    if (decision.status !== 'upgrade') throw new Error(decision.status)
    const migrated = await choosePublicV12Entry(f.bindings, decision)
    if (!migrated.ok) throw new Error(migrated.reason)
    expect(migrated.value.saveRevision).toBe(0)
    expect(migrated.value.state.windstep).toEqual({ learned: false, activeUntilTick: 0,
      nextCastTick: 0, practicedRouteIndices: [] })
    const resume = await f.inspect()
    expect(resume).toEqual({ status: 'resume', start: migrated.value })
    expect(view(resume)).toContain('Resume v12 world')
    expect(await choosePublicV12Entry(f.bindings, resume)).toEqual(migrated)
    expect(await Promise.all([f.v8.read(), f.v9.read(), f.v10.read(), f.v11.read()])).toEqual(oldStores)
    expect(f.storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(f.bytes)
  })

  it('refuses a stale upgrade and a stale resume instead of silently switching source or revision', async () => {
    const f = await fixture()
    const upgrade = await f.inspect()
    if (upgrade.status !== 'upgrade') throw new Error(upgrade.status)
    const changedV11 = { ...f.v11Start.value.state,
      player: { ...f.v11Start.value.state.player, coins: f.v11Start.value.state.player.coins + 1 } }
    const newerV11 = await commitPublicV11Snapshot(f.bindings.storage, f.bindings.locks,
      f.v8, f.v9, f.v10, f.v11, changedV11, 0, f.v11Start.value.sourceReceipt)
    if (!newerV11.ok) throw new Error(newerV11.reason)
    expect(await choosePublicV12Entry(f.bindings, upgrade)).toEqual({ ok: false, reason: 'source-changed' })
    expect(await f.v12.read()).toMatchObject({ head: null, previous: null, lineage: null })
    const current = await f.inspect()
    if (current.status !== 'upgrade') throw new Error(current.status)
    const start = await choosePublicV12Entry(f.bindings, current)
    if (!start.ok) throw new Error(start.reason)
    const resume = await f.inspect()
    if (resume.status !== 'resume') throw new Error(resume.status)
    const changedV12 = { ...start.value.state,
      player: { ...start.value.state.player, coins: start.value.state.player.coins + 1 } }
    const saved = await commitPublicV12Snapshot(f.bindings.storage, f.bindings.locks,
      f.v8, f.v9, f.v10, f.v11, f.v12, changedV12, 0, start.value.sourceReceipt)
    if (!saved.ok) throw new Error(saved.reason)
    expect(await choosePublicV12Entry(f.bindings, resume)).toEqual({ ok: false, reason: 'revision-changed' })
  })

  it('blocks unavailable locking and links back to v11 when the source is absent', async () => {
    const f = await fixture()
    expect(await inspectPublicV12Entry(f.bindings.storage, undefined,
      f.v8, f.v9, f.v10, f.v11, f.v12))
      .toEqual({ status: 'blocked', reason: 'lock-unavailable' })
    expect(await inspectPublicV12Entry(f.bindings.storage, f.bindings.locks,
      f.v8, f.v9, f.v10, createAtomicV11Store(new FakeFactory()), f.v12))
      .toEqual({ status: 'needs-v11' })
    expect(view({ status: 'needs-v11' })).toContain('href="?publicWorld=v11"')
    expect(view({ status: 'checking' })).toContain('Checking this device for a v12 save')
    expect(await choosePublicV12Entry(f.bindings, { status: 'needs-v11' }))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
  })
})

describe('blocked v12 recovery', () => {
  it('exports independently validated head and previous without changing the database', async () => {
    const f = await fixture()
    const decision = await f.inspect()
    if (decision.status !== 'upgrade') throw new Error(decision.status)
    const start = await choosePublicV12Entry(f.bindings, decision)
    if (!start.ok) throw new Error(start.reason)
    const later = { ...start.value.state,
      player: { ...start.value.state.player, coins: start.value.state.player.coins + 1 } }
    const saved = await commitPublicV12Snapshot(f.bindings.storage, f.bindings.locks,
      f.v8, f.v9, f.v10, f.v11, f.v12, later, 0, start.value.sourceReceipt)
    if (!saved.ok) throw new Error(saved.reason)
    const before = await f.v12.read()
    const rescues = await readPublicV12Rescues(f.v12)
    expect(rescues.map(({ source, saveRevision }) => ({ source, saveRevision })))
      .toEqual([{ source: 'head', saveRevision: 1 }, { source: 'previous', saveRevision: 0 }])
    expect(rescues.every(({ bytes }) => parsePublicV12Rescue(bytes) !== null)).toBe(true)
    expect(rescues.map(({ bytes }) => parsePublicV12Rescue(bytes)?.snapshot.state.player.coins))
      .toEqual([later.player.coins, start.value.state.player.coins])
    expect(await f.v12.read()).toEqual(before)
    const html = view({ status: 'blocked', reason: 'source-changed' }, rescues)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Download validated head save #1')
    expect(html).toContain('Download validated previous save #0')
    expect(html).toContain('Downloading does not resolve a fork')
    expect(view({ status: 'blocked', reason: 'invalid-v12-head' }, []))
      .toContain('No validated export under the 8 MiB limit is available')
  })

  it('excludes malformed records and lineage, never exports raw or unvalidated bytes', async () => {
    const f = await fixture()
    const decision = await f.inspect()
    if (decision.status !== 'upgrade') throw new Error(decision.status)
    const start = await choosePublicV12Entry(f.bindings, decision)
    if (!start.ok) throw new Error(start.reason)
    const saved = await commitPublicV12Snapshot(f.bindings.storage, f.bindings.locks,
      f.v8, f.v9, f.v10, f.v11, f.v12, start.value.state, 0, start.value.sourceReceipt)
    if (!saved.ok) throw new Error(saved.reason)
    const records = await f.v12.read()
    if (records.status !== 'ok' || !records.head || !records.previous) throw new Error('Missing fixture')
    const read = (patch: Partial<typeof records>) => readPublicV12Rescues({
      read: async () => ({ ...records, ...patch }),
    })
    expect((await read({ head: { saveRevision: 1, value: {} } })).map(({ source }) => source))
      .toEqual(['previous'])
    expect((await read({ previous: { ...records.previous, extra: true } as never })).map(({ source }) => source))
      .toEqual(['head'])
    expect(await read({ lineage: { sourceV11Head: {} } as never })).toEqual([])
    expect(await readPublicV12Rescues({ read: async () => ({ status: 'storage-error' }) })).toEqual([])
    expect(await readPublicV12Rescues({ read: async () => { throw new Error('Denied') } })).toEqual([])
  })
})
