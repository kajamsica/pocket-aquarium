import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { choosePublicV36Entry, inspectPublicV36Entry, PublicV36EntryView } from './PublicV36Entry'
import type { PublicV36EntryBindings } from './PublicV36Entry'
import { createAtomicV36Store } from './domain/atomicV36Database'
import { emptyPublicV26TerrainLedger } from './domain/publicWorldV26TerrainLedger'
import { emptyPublicV29MiningTools } from './domain/publicWorldV29MiningTools'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { PUBLIC_V34_SCHEMA } from './domain/publicWorldV34Snapshot'
import type { PublicV34Head } from './domain/publicWorldV34Snapshot'
import { createPublicV35Root } from './domain/publicWorldV35Snapshot'

describe('V36 explicit entry', () => {
  it('offers a checked V35 copy only on choice and resumes the separate target', async () => {
    const { head } = createPublicV23Root('wizard-realms')
    const v34: PublicV34Head = { schemaVersion: PUBLIC_V34_SCHEMA,
      saveRevision: 0, witness: null, state: head.state,
      greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
      terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0,
      riverBridgeIds: [], miningTools: emptyPublicV29MiningTools(),
      claimedBridgeheadId: null, raisedSoilCells: [] }
    const v35 = createPublicV35Root(v34), sourceBefore = structuredClone(v35)
    const source = { readChecked: vi.fn(async () => ({ status: 'valid', root: v35 })) }
    const locks = { request: async (_name: string, _options: unknown,
      body: () => Promise<unknown>) => body() }
    const store = createAtomicV36Store(new IDBFactory())
    const bindings = { locks, store, v35Store: source } as unknown as PublicV36EntryBindings
    const decision = await inspectPublicV36Entry(bindings)
    expect(decision).toEqual({ status: 'copy-available', sourceRevision: 0 })
    const html = renderToStaticMarkup(createElement(PublicV36EntryView, { entry: decision,
      busyChoice: null, onChoose: vi.fn(), onRetry: vi.fn(), actionError: null }))
    expect(html).toContain('Copy V35 adventure into V36')
    expect(html).toContain('New Game')
    const copying = renderToStaticMarkup(createElement(PublicV36EntryView, { entry: decision,
      busyChoice: 'copy', onChoose: vi.fn(), onRetry: vi.fn(), actionError: null }))
    expect(copying).toContain('Checking and copying adventure…')
    expect(await store.readChecked()).toMatchObject({ status: 'missing' })
    expect(await choosePublicV36Entry(decision, 'resume', bindings))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    const freshStore = createAtomicV36Store(new IDBFactory())
    const fresh = await choosePublicV36Entry(decision, 'create', { ...bindings, store: freshStore })
    expect(fresh).toMatchObject({ ok: true, value: { lineage: { origin: 'fresh' } } })
    expect(v35).toEqual(sourceBefore)
    source.readChecked.mockResolvedValueOnce({ status: 'valid', root: { ...v35,
      head: { ...v35.head, saveRevision: 1 } } })
    expect(await choosePublicV36Entry(decision, 'copy', bindings))
      .toEqual({ ok: false, reason: 'source-revision-changed' })
    expect(await store.readChecked()).toMatchObject({ status: 'missing' })
    source.readChecked.mockResolvedValueOnce({ status: 'valid', root: v35 })
      .mockResolvedValueOnce({ status: 'valid', root: { ...v35,
        head: { ...v35.head, saveRevision: 1 } } })
    expect(await choosePublicV36Entry(decision, 'copy', bindings))
      .toEqual({ ok: false, reason: 'source-revision-changed' })
    expect(await store.readChecked()).toMatchObject({ status: 'missing' })
    expect(v35).toEqual(sourceBefore)
    const copied = await choosePublicV36Entry(decision, 'copy', bindings)
    expect(copied).toMatchObject({ ok: true, value: { head: { saveRevision: 0 } } })
    expect(v35).toEqual(sourceBefore)
    expect(await choosePublicV36Entry(decision, 'copy', bindings))
      .toEqual({ ok: false, reason: 'target-conflict' })
    const resumed = await inspectPublicV36Entry(bindings)
    expect(resumed).toMatchObject({ status: 'resume' })
    expect(renderToStaticMarkup(createElement(PublicV36EntryView, { entry: resumed,
      busyChoice: null, onChoose: vi.fn(), onRetry: vi.fn(), actionError: null })))
      .toContain('save #0 is ready')
    expect(await choosePublicV36Entry(resumed, 'resume', bindings)).toEqual(copied)
    expect(await choosePublicV36Entry(resumed, 'create', bindings))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
  }, 120_000)

  it.each([
    ['missing', null], ['blocked', 'invalid-source'],
  ] as const)('offers New Game when V35 is %s, with an accurate warning', async (status, warning) => {
    const source = { readChecked: vi.fn(async () => status === 'missing'
      ? { status: 'missing' } : { status: 'blocked', reason: 'invalid-source' }) }
    const locks = { request: async (_name: string, _options: unknown,
      body: () => Promise<unknown>) => body() }
    const store = createAtomicV36Store(new IDBFactory())
    const bindings = { locks, store, v35Store: source } as unknown as PublicV36EntryBindings
    const decision = await inspectPublicV36Entry(bindings)
    expect(decision).toEqual({ status: 'fresh-available', sourceWarning: warning })
    const html = renderToStaticMarkup(createElement(PublicV36EntryView, { entry: decision,
      busyChoice: null, onChoose: vi.fn(), onRetry: vi.fn(), actionError: null }))
    expect(html).toContain('New Game')
    const starting = renderToStaticMarkup(createElement(PublicV36EntryView, { entry: decision,
      busyChoice: 'create', onChoose: vi.fn(), onRetry: vi.fn(), actionError: null }))
    expect(starting).toContain('role="status" aria-live="polite">Preparing adventure…')
    expect(starting).toContain('disabled="">Preparing adventure…</button>')
    expect(html).not.toContain('Copy V35 adventure into V36')
    if (warning) expect(html).toContain('V35 cannot currently be checked')
    else expect(html).not.toContain('V35 cannot currently be checked')
    expect(await choosePublicV36Entry(decision, 'copy', bindings))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    expect(await choosePublicV36Entry(decision, 'create', bindings))
      .toMatchObject({ ok: true, value: { lineage: { origin: 'fresh' } } })
    expect(await inspectPublicV36Entry(bindings)).toMatchObject({ status: 'resume' })
    expect(await choosePublicV36Entry(decision, 'create', bindings))
      .toEqual({ ok: false, reason: 'target-conflict' })
  }, 120_000)

  it('keeps a blocked V36 target blocked without probing or overwriting V35', async () => {
    const source = { readChecked: vi.fn() }
    const locks = { request: async (_name: string, _options: unknown,
      body: () => Promise<unknown>) => body() }
    const store = { readChecked: vi.fn(async () => ({ status: 'blocked', reason: 'invalid-root' })) }
    const bindings = { locks, store, v35Store: source } as unknown as PublicV36EntryBindings
    const decision = await inspectPublicV36Entry(bindings)
    expect(decision).toEqual({ status: 'blocked', reason: 'invalid-root' })
    expect(await choosePublicV36Entry(decision, 'create', bindings))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    expect(source.readChecked).not.toHaveBeenCalled()
    const html = renderToStaticMarkup(createElement(PublicV36EntryView, { entry: decision,
      busyChoice: null, onChoose: vi.fn(), onRetry: vi.fn(), actionError: null }))
    expect(html).not.toContain('New Game')
  })
})
