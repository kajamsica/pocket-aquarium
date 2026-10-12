import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { choosePublicV37Entry, inspectPublicV37Entry, PublicV37EntryView } from './PublicV37Entry'
import type { PublicV37EntryBindings } from './PublicV37Entry'
import { createAtomicV37Store } from './domain/atomicV37Database'
import { createFreshPublicV36Root } from './domain/publicWorldV36Snapshot'

const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>) => body() }
describe('V37 explicit entry', () => {
  it('offers independent fresh or checked V36 copy, then only checked continue', async () => {
    const source = createFreshPublicV36Root('wizard-realms'), before = structuredClone(source)
    const v36Store = { readChecked: vi.fn(async () => ({ status: 'valid', root: source })) }
    const bindings = { locks, store: createAtomicV37Store(new IDBFactory()), v36Store } as unknown as PublicV37EntryBindings
    const decision = await inspectPublicV37Entry(bindings)
    expect(decision).toEqual({ status: 'copy-available', sourceRevision: 0 })
    const html = renderToStaticMarkup(createElement(PublicV37EntryView, { entry: decision,
      busyChoice: null, onChoose: vi.fn(), onRetry: vi.fn(), actionError: null }))
    expect(html).toContain('Copy V36 adventure into V37')
    expect(html).toContain('New Game')
    expect(html).toContain('Open untouched V36 adventure')
    expect(await bindings.store.readChecked()).toMatchObject({ status: 'missing' })
    v36Store.readChecked.mockResolvedValueOnce({ status: 'valid', root: {
      ...source, head: { ...source.head, saveRevision: 1 } } })
    expect(await choosePublicV37Entry(decision, 'copy', bindings))
      .toEqual({ ok: false, reason: 'source-revision-changed' })
    expect(await bindings.store.readChecked()).toMatchObject({ status: 'missing' })
    const copied = await choosePublicV37Entry(decision, 'copy', bindings)
    expect(copied).toMatchObject({ ok: true, value: { lineage: { origin: 'v36-migration' } } })
    expect(source).toEqual(before)
    const continued = await inspectPublicV37Entry(bindings)
    expect(continued.status).toBe('resume')
    expect(await choosePublicV37Entry(continued, 'resume', bindings)).toEqual(copied)
    expect(await choosePublicV37Entry(continued, 'create', bindings))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    const fresh = await choosePublicV37Entry(decision, 'create', { ...bindings,
      store: createAtomicV37Store(new IDBFactory()) })
    expect(fresh).toMatchObject({ ok: true, value: { lineage: { origin: 'fresh', seed: 'wizard-realms' } } })
    expect(source).toEqual(before)
  }, 120_000)

  it('blocks malformed V37 without reading V36 or offering reset', async () => {
    const v36Store = { readChecked: vi.fn() }
    const bindings = { locks, store: { readChecked: async () => ({ status: 'blocked',
      reason: 'invalid-v37-root' }) }, v36Store } as unknown as PublicV37EntryBindings
    const decision = await inspectPublicV37Entry(bindings)
    expect(decision).toEqual({ status: 'blocked', reason: 'invalid-v37-root' })
    expect(await choosePublicV37Entry(decision, 'create', bindings))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    expect(v36Store.readChecked).not.toHaveBeenCalled()
    const html = renderToStaticMarkup(createElement(PublicV37EntryView, { entry: decision,
      busyChoice: null, onChoose: vi.fn(), onRetry: vi.fn(), actionError: null }))
    expect(html).not.toContain('New Game')
    expect(html).toContain('No save was cleared or replaced')
  })
})
