import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV16Store } from './domain/atomicV16Database'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { startFreshPublicV16 } from './domain/publicWorldV16Flow'
import { PUBLIC_V16_DATABASE_NAME } from './domain/publicWorldV16Snapshot'
import { PUBLIC_V17_DATABASE_NAME } from './domain/publicWorldV17Snapshot'
import { choosePublicV17Entry, inspectPublicV17Entry, PublicV17EntryView } from './PublicV17Entry'

const locks = { request: async <T,>(name: string, options: { mode: 'exclusive' },
  callback: () => T | Promise<T>): Promise<T> => {
  expect(name).toBe('wizard-realms:world:v6:root:exclusive')
  expect(options).toEqual({ mode: 'exclusive' })
  return callback()
} }

describe('explicit public v17 entry', () => {
  it('creates only a distinct v17 root after a fresh choice', async () => {
    const factory = new FakeFactory()
    const bindings = { locks, store: createAtomicV17Store(factory),
      sourceStore: createAtomicV16Store(factory) }
    const decision = await inspectPublicV17Entry(locks, bindings.store, bindings.sourceStore)
    expect(decision).toEqual({ status: 'missing', source: { status: 'missing' } })
    expect(await choosePublicV17Entry(decision, 'migrate', bindings, 'greenway-alpha'))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    const markup = renderToStaticMarkup(createElement(PublicV17EntryView, {
      entry: decision, busy: false, onChoose: () => {}, onRetry: () => {},
    }))
    expect(markup).toContain('Create fresh v17 world')
    expect(markup).not.toContain('Migrate checked v16 world')
    const fresh = await choosePublicV17Entry(decision, 'fresh', bindings, 'greenway-alpha')
    expect(fresh.ok).toBe(true)
    if (!fresh.ok) return
    expect(fresh.value).toMatchObject({ bootstrap: null, saveRevision: 0,
      lineage: { origin: 'fresh' } })
    expect(await bindings.sourceStore.read()).toMatchObject({ status: 'ok', head: null })
    expect((await factory.databases()).map(({ name }) => name).sort())
      .toEqual([PUBLIC_V16_DATABASE_NAME, PUBLIC_V17_DATABASE_NAME].sort())
  })

  it('migrates only a checked v16 source and leaves its bytes unchanged', async () => {
    const factory = new FakeFactory()
    const bindings = { locks, store: createAtomicV17Store(factory),
      sourceStore: createAtomicV16Store(factory) }
    const source = await startFreshPublicV16(locks, bindings.sourceStore, 'greenway-alpha')
    if (!source.ok) throw new Error(source.reason)
    const original = structuredClone(await bindings.sourceStore.read())
    const decision = await inspectPublicV17Entry(locks, bindings.store, bindings.sourceStore)
    expect(decision).toMatchObject({ status: 'missing', source: { status: 'valid' } })
    const markup = renderToStaticMarkup(createElement(PublicV17EntryView, {
      entry: decision, busy: false, onChoose: () => {}, onRetry: () => {},
    }))
    expect(markup).toContain('Migrate checked v16 world')
    const migrated = await choosePublicV17Entry(decision, 'migrate', bindings, 'unused-seed')
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.value.lineage.origin).toBe('v16-migration')
    expect(migrated.value.lineage.sourceReceipt).toEqual({
      saveRevision: source.value.saveRevision, lineage: source.value.lineage,
      state: source.value.state, greenwayWorks: source.value.greenwayWorks,
    })
    expect(await bindings.sourceStore.read()).toEqual(original)
  })

  it('resumes v17 without opening v16, and never offers overwrite', async () => {
    const factory = new FakeFactory()
    const bindings = { locks, store: createAtomicV17Store(factory),
      sourceStore: createAtomicV16Store(factory) }
    const missing = await inspectPublicV17Entry(locks, bindings.store)
    const fresh = await choosePublicV17Entry(missing, 'fresh', bindings, 'greenway-alpha')
    if (!fresh.ok) throw new Error(fresh.reason)
    const open = vi.spyOn(factory, 'open')
    const decision = await inspectPublicV17Entry(locks, bindings.store, bindings.sourceStore)
    expect(decision).toEqual({ status: 'resume', start: fresh.value })
    expect(open.mock.calls.map(([name]) => name)).toEqual([PUBLIC_V17_DATABASE_NAME])
    expect(await choosePublicV17Entry(decision, 'resume', bindings, 'ignored'))
      .toEqual({ ok: true, value: fresh.value })
    expect(await choosePublicV17Entry(decision, 'fresh', bindings, 'ignored'))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
  })

  it('blocks missing lock and malformed target without deleting existing saves', async () => {
    const factory = new FakeFactory()
    const bindings = { locks, store: createAtomicV17Store(factory),
      sourceStore: createAtomicV16Store(factory) }
    expect(await inspectPublicV17Entry(undefined, bindings.store))
      .toEqual({ status: 'blocked', reason: 'lock-unavailable' })
    const fresh = await choosePublicV17Entry({ status: 'missing', source: {
      status: 'missing' } }, 'fresh', bindings, 'greenway-alpha')
    if (!fresh.ok) throw new Error(fresh.reason)
    const before = await bindings.store.read()
    const decision = await inspectPublicV17Entry(locks, bindings.store)
    expect(await choosePublicV17Entry(decision, 'migrate', bindings, 'ignored'))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    expect(await bindings.store.read()).toEqual(before)
  })
})
