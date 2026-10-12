import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV15Store } from './domain/atomicV15Database'
import { createAtomicV16Store } from './domain/atomicV16Database'
import { startFreshPublicV15 } from './domain/publicWorldV15Flow'
import { createFreshPublicV15Head, PUBLIC_V15_DATABASE_NAME } from './domain/publicWorldV15Snapshot'
import { PUBLIC_V16_DATABASE_NAME } from './domain/publicWorldV16Snapshot'
import { choosePublicV16Entry, inspectPublicV16Entry, PublicV16EntryView } from './PublicV16Entry'

const locks = { request: async <T,>(name: string, options: { mode: 'exclusive' },
  callback: () => T | Promise<T>): Promise<T> => {
  expect(name).toBe('wizard-realms:world:v6:root:exclusive')
  expect(options).toEqual({ mode: 'exclusive' })
  return callback()
} }

async function rawPut(factory: IDBFactory, name: string, slot: string, value: unknown) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('records', 'readwrite')
      transaction.objectStore('records').put(value, slot)
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { database.close() }
}

describe('explicit public v16 entry', () => {
  it('offers fresh only for missing roots, then creates solely the v16 root by choice', async () => {
    const factory = new FakeFactory()
    const bindings = { locks, store: createAtomicV16Store(factory),
      sourceStore: createAtomicV15Store(factory) }
    const decision = await inspectPublicV16Entry(locks, bindings.store, bindings.sourceStore)
    expect(decision).toEqual({ status: 'missing', source: { status: 'missing' } })
    expect(await bindings.store.read()).toEqual({ status: 'ok', head: null,
      previous: null, lineage: null })
    expect(await bindings.sourceStore.read()).toEqual({ status: 'ok', head: null,
      previous: null, lineage: null })
    expect(await choosePublicV16Entry(decision, 'migrate', bindings, 'greenway-alpha'))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    const html = renderToStaticMarkup(createElement(PublicV16EntryView, {
      entry: decision, busy: false, onChoose: () => {}, onRetry: () => {},
    }))
    expect(html).toContain('Create fresh v16 world')
    expect(html).not.toContain('Migrate checked v15 world')
    expect(html).toContain('min-height:44px')
    const fresh = await choosePublicV16Entry(decision, 'fresh', bindings, 'greenway-alpha')
    expect(fresh.ok).toBe(true)
    if (!fresh.ok) return
    expect(fresh.value.saveRevision).toBe(0)
    expect(fresh.value.lineage.origin).toBe('fresh')
    const unchangedSource = await bindings.sourceStore.read()
    expect(unchangedSource.status === 'ok' ? unchangedSource.head : null).toBeNull()
    expect((await factory.databases()).map(({ name }) => name).sort())
      .toEqual([PUBLIC_V15_DATABASE_NAME, PUBLIC_V16_DATABASE_NAME].sort())
  })

  it('offers migration only after a checked v15 inspection, and preserves its source', async () => {
    const factory = new FakeFactory()
    const bindings = { locks, store: createAtomicV16Store(factory),
      sourceStore: createAtomicV15Store(factory) }
    const source = await startFreshPublicV15(locks, bindings.sourceStore, 'greenway-alpha')
    if (!source.ok) throw new Error(source.reason)
    const original = structuredClone(await bindings.sourceStore.read())
    const decision = await inspectPublicV16Entry(locks, bindings.store, bindings.sourceStore)
    expect(decision.status).toBe('missing')
    if (decision.status !== 'missing') return
    expect(decision.source).toEqual({ status: 'valid', start: source.value })
    const emptyTarget = await bindings.store.read()
    expect(emptyTarget.status === 'ok' ? emptyTarget.head : null).toBeNull()
    const html = renderToStaticMarkup(createElement(PublicV16EntryView, {
      entry: decision, busy: false, onChoose: () => {}, onRetry: () => {},
    }))
    expect(html).toContain('Create fresh v16 world')
    expect(html).toContain('Migrate checked v15 world')
    expect(html).toContain('original save will remain unchanged')
    const migrated = await choosePublicV16Entry(decision, 'migrate', bindings, 'unused-seed')
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.value.lineage.origin).toBe('v15-migration')
    expect(migrated.value.lineage.sourceReceipt).toEqual({
      saveRevision: source.value.saveRevision, lineage: source.value.lineage,
      state: source.value.state, starterWorks: source.value.starterWorks,
    })
    expect(await bindings.sourceStore.read()).toEqual(original)
  })

  it('resumes a checked v16 root without opening the optional v15 source', async () => {
    const factory = new FakeFactory()
    const bindings = { locks, store: createAtomicV16Store(factory),
      sourceStore: createAtomicV15Store(factory) }
    const missing = await inspectPublicV16Entry(locks, bindings.store)
    const fresh = await choosePublicV16Entry(missing, 'fresh', bindings, 'greenway-alpha')
    if (!fresh.ok) throw new Error(fresh.reason)
    const open = vi.spyOn(factory, 'open')
    const decision = await inspectPublicV16Entry(locks, bindings.store, bindings.sourceStore)
    expect(decision).toEqual({ status: 'resume', start: fresh.value })
    expect(open.mock.calls.map(([name]) => name)).toEqual([PUBLIC_V16_DATABASE_NAME])
    const html = renderToStaticMarkup(createElement(PublicV16EntryView, {
      entry: decision, busy: false, onChoose: () => {}, onRetry: () => {},
    }))
    expect(html).toContain('Resume v16 world')
    expect(html).not.toContain('Create fresh v16 world')
    expect(html).not.toContain('Migrate checked v15 world')
    expect(await choosePublicV16Entry(decision, 'resume', bindings, 'ignored'))
      .toEqual({ ok: true, value: fresh.value })
    expect(await choosePublicV16Entry(decision, 'fresh', bindings, 'ignored'))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    expect((await factory.databases()).map(({ name }) => name)).toEqual([PUBLIC_V16_DATABASE_NAME])
  })

  it('rejects migration when the inspected v15 source changes before confirmation', async () => {
    const factory = new FakeFactory()
    const bindings = { locks, store: createAtomicV16Store(factory),
      sourceStore: createAtomicV15Store(factory) }
    const source = await startFreshPublicV15(locks, bindings.sourceStore, 'greenway-alpha')
    if (!source.ok) throw new Error(source.reason)
    const decision = await inspectPublicV16Entry(locks, bindings.store, bindings.sourceStore)
    expect(decision.status).toBe('missing')
    await rawPut(factory, PUBLIC_V15_DATABASE_NAME, 'head', { saveRevision: 0, value: {} })
    expect(await choosePublicV16Entry(decision, 'migrate', bindings, 'ignored'))
      .toEqual({ ok: false, reason: 'invalid-v15-records' })
    const target = await bindings.store.read()
    expect(target.status === 'ok' ? target.head : null).toBeNull()
  })

  it('keeps fresh creation available when v15 migration is blocked', async () => {
    const factory = new FakeFactory()
    const bindings = { locks, store: createAtomicV16Store(factory),
      sourceStore: createAtomicV15Store(factory) }
    const source = createFreshPublicV15Head('greenway-alpha')
    expect((await bindings.sourceStore.read()).status).toBe('ok')
    const legacy = { ...source.lineage, rulesProfile: 'starter-crossing/v1' }
    await rawPut(factory, PUBLIC_V15_DATABASE_NAME, 'lineage', legacy)
    await rawPut(factory, PUBLIC_V15_DATABASE_NAME, 'head',
      { saveRevision: 0, value: source.head })
    const decision = await inspectPublicV16Entry(locks, bindings.store, bindings.sourceStore)
    expect(decision).toEqual({ status: 'missing', source: {
      status: 'blocked', reason: 'legacy-v15-root' } })
    const html = renderToStaticMarkup(createElement(PublicV16EntryView, {
      entry: decision, busy: false, onChoose: () => {}, onRetry: () => {},
    }))
    expect(html).toContain('Create fresh v16 world')
    expect(html).toContain('V15 migration is unavailable')
    expect(html).not.toContain('Migrate checked v15 world')
    expect(await choosePublicV16Entry(decision, 'migrate', bindings, 'greenway-alpha'))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    expect(await choosePublicV16Entry(decision, 'fresh', bindings, 'greenway-alpha'))
      .toMatchObject({ ok: true })
    const raw = await bindings.sourceStore.read()
    expect(raw.status === 'ok' ? raw.lineage : null).toEqual(legacy)
  })

  it('blocks a malformed v16 root without consulting v15 or offering an overwrite', async () => {
    const factory = new FakeFactory()
    const bindings = { locks, store: createAtomicV16Store(factory),
      sourceStore: createAtomicV15Store(factory) }
    expect((await bindings.store.read()).status).toBe('ok')
    await rawPut(factory, PUBLIC_V16_DATABASE_NAME, 'head', { saveRevision: 0, value: {} })
    const open = vi.spyOn(factory, 'open')
    const decision = await inspectPublicV16Entry(locks, bindings.store, bindings.sourceStore)
    expect(decision).toEqual({ status: 'blocked', reason: 'invalid-v16-records' })
    expect(open.mock.calls.map(([name]) => name)).toEqual([PUBLIC_V16_DATABASE_NAME])
    expect(await choosePublicV16Entry(decision, 'fresh', bindings, 'greenway-alpha'))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    const html = renderToStaticMarkup(createElement(PublicV16EntryView, {
      entry: decision, busy: false, onChoose: () => {}, onRetry: () => {},
    }))
    expect(html).toContain('V16 access is blocked')
    expect(html).not.toContain('Create fresh v16 world')
    expect((await factory.databases()).map(({ name }) => name)).toEqual([PUBLIC_V16_DATABASE_NAME])
  })
})
