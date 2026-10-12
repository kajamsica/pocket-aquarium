import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { createAtomicV24Store } from './domain/atomicV24Database'
import { inspectPublicV17, startFreshPublicV17 } from './domain/publicWorldV17Flow'
import { commitPublicV23, inspectPublicV23, startPublicV23 } from './domain/publicWorldV23Flow'
import { PUBLIC_V7_LOCK_NAME } from './domain/publicWorldV7'
import { choosePublicV24Entry, inspectPublicV24Entry, PublicV24EntryView } from './PublicV24Entry'
import type { PublicV24EntryBindings, PublicV24EntryDecision } from './PublicV24Entry'

const seed = 'greenway-alpha'
const locks = { request: async <T,>(name: string, options: { mode: 'exclusive' },
  callback: () => T | Promise<T>): Promise<T> => {
  expect(name).toBe(PUBLIC_V7_LOCK_NAME)
  expect(options).toEqual({ mode: 'exclusive' })
  return callback()
} }
const bindings = (factory = new IDBFactory()): PublicV24EntryBindings => ({
  locks, store: createAtomicV24Store(factory), sourceStore: createAtomicV23Store(factory),
  ancestorStore: createAtomicV17Store(factory),
})
const view = (entry: PublicV24EntryDecision) => renderToStaticMarkup(createElement(PublicV24EntryView, {
  entry, busy: false, onChoose: () => {}, onRetry: () => {}, actionError: null,
}))
async function sourceReady(f: PublicV24EntryBindings) {
  const started = await startPublicV23(f.locks, f.sourceStore, f.ancestorStore, seed, null)
  if (!started.ok) throw new Error(started.reason)
  return started.value
}

describe('explicit V24 entry', () => {
  it('starts one checked V17 to V23 to V24 world from a blank profile', async () => {
    const f = bindings()
    const decision = await inspectPublicV24Entry(f)
    expect(decision).toEqual({ status: 'fresh-available' })
    expect(view(decision)).toContain('Start new world')
    expect(view(decision)).toContain('saved in this browser')
    expect(view(decision)).toContain('not backed up online')
    expect(view(decision)).not.toContain('Migrate V23 world')
    const created = await choosePublicV24Entry(decision, 'create', f, seed)
    if (!created.ok) throw new Error(created.reason)
    const v17 = await inspectPublicV17(f.locks, f.ancestorStore)
    const v23 = await inspectPublicV23(f.locks, f.sourceStore, f.ancestorStore)
    if (!v17.ok || v17.value.status !== 'valid'
      || !v23.ok || v23.value.status !== 'valid') throw new Error('Missing checked foundation')
    expect(v23.value.start.lineage.sourceReceipt).toEqual({
      state: v17.value.start.state, greenwayWorks: v17.value.start.greenwayWorks,
      lineage: v17.value.start.lineage, saveRevision: v17.value.start.saveRevision,
    })
    expect(created.value.lineage.sourceReceipt).toEqual(v23.value.start)
    expect(await inspectPublicV24Entry(f)).toEqual({ status: 'resume', start: created.value })
    expect(await choosePublicV24Entry({ status: 'resume', start: created.value },
      'resume', f, seed)).toEqual(created)
    expect(await startFreshPublicV17(f.locks, f.ancestorStore, seed))
      .toEqual({ ok: false, reason: 'root-present' })
    expect(await inspectPublicV24Entry(f)).toEqual({ status: 'resume', start: created.value })
  })

  it('never offers fresh over a standalone V24 target with missing sources', async () => {
    const f = bindings(), blank = await inspectPublicV24Entry(f)
    const created = await choosePublicV24Entry(blank, 'create', f, seed)
    if (!created.ok) throw new Error(created.reason)
    const separated: PublicV24EntryBindings = { ...f,
      sourceStore: createAtomicV23Store(new IDBFactory()),
      ancestorStore: createAtomicV17Store(new IDBFactory()) }
    const decision = await inspectPublicV24Entry(separated)
    expect(decision).toEqual({ status: 'blocked', reason: 'target-conflict' })
    expect(view(decision)).not.toContain('Start new world')
    expect(await choosePublicV24Entry(blank, 'create', separated, seed))
      .toEqual({ ok: false, reason: 'target-conflict' })
    expect(await f.store.readChecked()).toMatchObject({ status: 'valid', root: created.value })
    expect((await separated.sourceStore.readChecked()).status).toBe('missing')
    expect(await separated.ancestorStore.readChecked()).toMatchObject({ status: 'ok', head: null })
  })

  it('rejects stale blank choices after another V17, V23, or V24 creation', async () => {
    for (const level of ['v17', 'v23', 'v24'] as const) {
      const f = bindings(), blank = await inspectPublicV24Entry(f)
      expect(blank.status).toBe('fresh-available')
      if (level === 'v17') {
        expect((await startFreshPublicV17(f.locks, f.ancestorStore, seed)).ok).toBe(true)
      } else if (level === 'v23') {
        expect((await sourceReady(f)).head.saveRevision).toBe(0)
      } else {
        const created = await choosePublicV24Entry(blank, 'create', f, seed)
        expect(created.ok).toBe(true)
      }
      const before17 = await f.ancestorStore.readChecked()
      const before23 = await f.sourceStore.readChecked()
      const before24 = await f.store.readChecked()
      const stale = await choosePublicV24Entry(blank, 'create', f, seed)
      expect(stale.ok).toBe(false)
      expect(await f.ancestorStore.readChecked()).toEqual(before17)
      expect(await f.sourceStore.readChecked()).toEqual(before23)
      expect(await f.store.readChecked()).toEqual(before24)
    }
  })

  it('retains checked foundations after either promotion write fails', async () => {
    const failed23 = bindings(), blank23 = await inspectPublicV24Entry(failed23)
    const bad23: PublicV24EntryBindings = { ...failed23,
      sourceStore: { ...failed23.sourceStore, commit: async () => 'storage-error' as const } }
    expect(await choosePublicV24Entry(blank23, 'create', bad23, seed))
      .toEqual({ ok: false, reason: 'storage-error' })
    expect(await inspectPublicV17(failed23.locks, failed23.ancestorStore))
      .toMatchObject({ ok: true, value: { status: 'valid' } })
    expect(await inspectPublicV23(failed23.locks, failed23.sourceStore,
      failed23.ancestorStore)).toMatchObject({ ok: true, value: { status: 'migration-available' } })
    expect(await inspectPublicV24Entry(failed23))
      .toEqual({ status: 'blocked', reason: 'source-v23-missing' })

    const failed24 = bindings(), blank24 = await inspectPublicV24Entry(failed24)
    const bad24: PublicV24EntryBindings = { ...failed24,
      store: { ...failed24.store, commit: async () => 'storage-error' as const } }
    expect(await choosePublicV24Entry(blank24, 'create', bad24, seed))
      .toEqual({ ok: false, reason: 'storage-error' })
    expect(await inspectPublicV17(failed24.locks, failed24.ancestorStore))
      .toMatchObject({ ok: true, value: { status: 'valid' } })
    expect(await inspectPublicV23(failed24.locks, failed24.sourceStore,
      failed24.ancestorStore)).toMatchObject({ ok: true, value: { status: 'valid' } })
    expect((await inspectPublicV24Entry(failed24)).status).toBe('migration-available')
  })

  it('leaves no newer roots when the initial V17 write fails', async () => {
    const f = bindings(), blank = await inspectPublicV24Entry(f)
    const bad17: PublicV24EntryBindings = { ...f,
      ancestorStore: { ...f.ancestorStore, commit: async () => 'storage-error' as const } }
    expect(await choosePublicV24Entry(blank, 'create', bad17, seed))
      .toEqual({ ok: false, reason: 'storage-error' })
    expect(await f.ancestorStore.readChecked()).toMatchObject({ status: 'ok', head: null })
    expect((await f.sourceStore.readChecked()).status).toBe('missing')
    expect((await f.store.readChecked()).status).toBe('missing')
    expect(await inspectPublicV24Entry(f)).toEqual({ status: 'fresh-available' })
  })

  it('offers only checked V23 migration, copies it, then resumes V24', async () => {
    const f = bindings(), source = await sourceReady(f), original = await f.sourceStore.readChecked()
    const decision = await inspectPublicV24Entry(f)
    expect(decision).toMatchObject({ status: 'migration-available',
      sourceReceipt: { head: source.head, lineage: source.lineage } })
    expect(view(decision)).toContain('Migrate V23 world')
    expect(view(decision)).toContain('Save now/checkpoint and close that tab before migrating')
    expect(view(decision)).toContain('only the last committed V23 save')
    expect(view(decision)).not.toContain('Create fresh')
    expect(await choosePublicV24Entry(decision, 'resume', f, seed))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    expect(await choosePublicV24Entry(decision, 'migrate', f, 'other-seed'))
      .toEqual({ ok: false, reason: 'invalid-source' })
    expect((await f.store.readChecked()).status).toBe('missing')
    const migrated = await choosePublicV24Entry(decision, 'migrate', f, seed)
    if (!migrated.ok) throw new Error(migrated.reason)
    expect(migrated.value.head).toMatchObject({ saveRevision: 0, state: source.head.state,
      greenwayWorks: source.head.greenwayWorks, regionalWorks: source.head.regionalWorks })
    expect(await f.sourceStore.readChecked()).toMatchObject({ status: 'valid', root:
      original.status === 'valid' ? original.root : null })
    const resumed = await inspectPublicV24Entry(f)
    expect(resumed).toEqual({ status: 'resume', start: migrated.value })
    expect(view(resumed)).toContain('Resume V24 world')
    expect(await choosePublicV24Entry(resumed, 'resume', f, 'ignored'))
      .toEqual({ ok: true, value: migrated.value })
    expect(await choosePublicV24Entry(resumed, 'migrate', f, seed))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
  })

  it('blocks V17-only worlds and explains the required V23 migration first', async () => {
    const f = bindings()
    const old = await startFreshPublicV17(f.locks, f.ancestorStore, seed)
    if (!old.ok) throw new Error(old.reason)
    const decision = await inspectPublicV24Entry(f)
    expect(decision).toEqual({ status: 'blocked', reason: 'source-v23-missing' })
    expect(view(decision)).toContain('migrate it through')
    expect(view(decision)).toContain('publicWorld=v23')
    expect(view(decision)).not.toContain('Migrate V23 world')
    expect(await choosePublicV24Entry(decision, 'migrate', f, seed))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
  })

  it('rejects a stale source choice and blocks after a migrated V23 source changes', async () => {
    const f = bindings(), source = await sourceReady(f)
    const staleDecision = await inspectPublicV24Entry(f)
    const changed = await commitPublicV23(f.locks, f.sourceStore, f.ancestorStore,
      source.head.saveRevision, source.lineage, { kind: 'checkpoint' })
    if (!changed.ok) throw new Error(changed.reason)
    expect(await choosePublicV24Entry(staleDecision, 'migrate', f, seed))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect((await f.store.readChecked()).status).toBe('missing')
    const current = await inspectPublicV24Entry(f)
    const migrated = await choosePublicV24Entry(current, 'migrate', f, seed)
    if (!migrated.ok) throw new Error(migrated.reason)
    const later = await commitPublicV23(f.locks, f.sourceStore, f.ancestorStore,
      changed.value.head.saveRevision, changed.value.lineage, { kind: 'checkpoint' })
    if (!later.ok) throw new Error(later.reason)
    expect(await inspectPublicV24Entry(f))
      .toEqual({ status: 'blocked', reason: 'source-changed' })
    expect(await choosePublicV24Entry({ status: 'resume', start: migrated.value }, 'resume', f, seed))
      .toEqual({ ok: false, reason: 'source-changed' })
  })

  it('fails closed without bindings or lock and shows a retry state', async () => {
    const absent = await inspectPublicV24Entry(null)
    expect(absent).toEqual({ status: 'blocked', reason: 'storage-error' })
    expect(view(absent)).toContain('Reload to recheck')
    expect(view(absent)).toContain('saves were not reset')
    const f = bindings()
    expect(await inspectPublicV24Entry({ ...f, locks: undefined as never }))
      .toEqual({ status: 'blocked', reason: 'lock-unavailable' })
  })
})
