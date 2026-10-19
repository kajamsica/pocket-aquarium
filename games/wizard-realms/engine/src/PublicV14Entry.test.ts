import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV14Store } from './domain/atomicV14Database'
import { commitPublicV14Snapshot } from './domain/publicWorldV14Flow'
import { advancePublicV14GreenwayFrame } from './domain/publicWorldV14GreenwayFrame'
import { choosePublicV14Entry, inspectPublicV14Entry,
  PublicV14EntryApp, PublicV14EntryView } from './PublicV14Entry'

const locks = { request: async <T,>(name: string, options: { mode: 'exclusive' },
  callback: () => T | Promise<T>): Promise<T> => {
  expect(name).toBe('wizard-realms:world:v6:root:exclusive')
  expect(options).toEqual({ mode: 'exclusive' })
  return callback()
} }
const render = (entry: Parameters<typeof PublicV14EntryView>[0]['entry']) =>
  renderToStaticMarkup(createElement(PublicV14EntryView,
    { entry, busy: false, onChoose: vi.fn(), onRetry: vi.fn() }))

describe('unmounted public v14 entry', () => {
  it('offers an explicit fresh choice on an empty independent root', async () => {
    const factory = new FakeFactory()
    const opened = vi.spyOn(factory, 'open')
    const store = createAtomicV14Store(factory)
    const decision = await inspectPublicV14Entry(locks, store)
    expect(decision).toEqual({ status: 'missing' })
    const markup = render(decision)
    expect(markup).toContain('Create new v14 world')
    expect(markup).not.toContain('Resume v14 world')
    expect(markup).not.toContain('Reset')
    expect(markup).toContain('min-height:44px')
    expect((await factory.databases()).map(({ name }) => name))
      .toEqual(['wizard-realms:world:v14'])
    expect(opened.mock.calls.map(([name]) => name))
      .toEqual(['wizard-realms:world:v14'])
  })

  it('resumes only the inspected revision and lineage after explicit choice', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV14Store(factory)
    const empty = await inspectPublicV14Entry(locks, store)
    const created = await choosePublicV14Entry(empty, locks, store, 'greenway-alpha')
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.saveRevision).toBe(0)
    const decision = await inspectPublicV14Entry(locks, store)
    expect(decision).toEqual({ status: 'resume', start: created.value })
    expect(render(decision)).toContain('Resume v14 world')
    expect(render(decision)).not.toContain('Create new v14 world')
    expect(await choosePublicV14Entry(decision, locks, store, 'ignored-seed'))
      .toEqual({ ok: true, value: created.value })
    expect((await factory.databases()).map(({ name }) => name))
      .toEqual(['wizard-realms:world:v14'])
    const frame = advancePublicV14GreenwayFrame(created.value.state, [], { walkRequested: false })
    expect(frame.rejections).toEqual([])
    const later = await commitPublicV14Snapshot(locks, store, frame.state,
      created.value.saveRevision, created.value.lineage)
    expect(later.ok).toBe(true)
    expect(await choosePublicV14Entry(decision, locks, store, 'ignored-seed'))
      .toEqual({ ok: false, reason: 'revision-changed' })
  })

  it('rejects a duplicate fresh choice without replacing the first world', async () => {
    const factory = new FakeFactory()
    const firstStore = createAtomicV14Store(factory)
    const secondStore = createAtomicV14Store(factory)
    const first = await inspectPublicV14Entry(locks, firstStore)
    const second = await inspectPublicV14Entry(locks, secondStore)
    const results = await Promise.all([
      choosePublicV14Entry(first, locks, firstStore, 'greenway-alpha'),
      choosePublicV14Entry(second, locks, secondStore, 'other-seed'),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: 'revision-changed' }])
    expect(await choosePublicV14Entry(first, locks, firstStore, 'third-seed'))
      .toEqual({ ok: false, reason: 'root-present' })
    const valid = await inspectPublicV14Entry(locks, firstStore)
    expect(valid.status).toBe('resume')
    if (valid.status === 'resume') expect(valid.start.lineage.seed)
      .toBe(results.find((result) => result.ok)!.value.lineage.seed)
  })

  it('blocks malformed records without reset, migration, or raw rescue claims', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV14Store(factory)
    const initial = await inspectPublicV14Entry(locks, store)
    const fresh = await choosePublicV14Entry(initial, locks, store, 'greenway-alpha')
    expect(fresh.ok).toBe(true)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('wizard-realms:world:v14', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite')
      transaction.objectStore('records').put({ unexpected: true }, 'unknown-slot')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
    })
    db.close()
    const blocked = await inspectPublicV14Entry(locks, store)
    expect(blocked).toEqual({ status: 'blocked', reason: 'storage-error' })
    const markup = render(blocked)
    expect(markup).toContain('Nothing was reset or repaired')
    expect(markup).toContain('Keep this site data')
    expect(markup).not.toContain('Create new v14 world')
    expect(markup).not.toContain('Download rescue')
    expect(await choosePublicV14Entry(blocked, locks, store, 'greenway-alpha'))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
  })

  it('reports missing lock or IndexedDB before any fresh-world choice', async () => {
    const store = createAtomicV14Store(new FakeFactory())
    expect(await inspectPublicV14Entry(undefined, store))
      .toEqual({ status: 'blocked', reason: 'lock-unavailable' })
    expect(await inspectPublicV14Entry(locks, undefined))
      .toEqual({ status: 'blocked', reason: 'storage-error' })
    const markup = renderToStaticMarkup(createElement(PublicV14EntryApp,
      { renderSession: () => 'PLAYABLE SESSION' }))
    expect(markup).toContain('Checking this device')
    expect(markup).not.toContain('PLAYABLE SESSION')
  })
})
