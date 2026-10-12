import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { createAtomicV24Store } from './domain/atomicV24Database'
import { createAtomicV25Store } from './domain/atomicV25Database'
import { createAtomicV26Store } from './domain/atomicV26Database'
import { createAtomicV27Store } from './domain/atomicV27Database'
import { createAtomicV28Store } from './domain/atomicV28Database'
import { PUBLIC_V7_LOCK_NAME } from './domain/publicWorldV7'
import { choosePublicV27Entry, inspectPublicV27Entry } from './PublicV27Entry'
import { choosePublicV28Entry, inspectPublicV28Entry, PublicV28EntryView } from './PublicV28Entry'
import type { PublicV28EntryBindings } from './PublicV28Entry'

const seed = 'greenway-alpha'
let active = false
const locks = { request: async <T,>(name: string, options: { mode: 'exclusive' },
  body: () => T | Promise<T>): Promise<T> => {
  expect(name).toBe(PUBLIC_V7_LOCK_NAME)
  expect(options).toEqual({ mode: 'exclusive' })
  if (active) throw new Error('Nested world lock')
  active = true
  try { return await body() } finally { active = false }
} }
function bindings(): PublicV28EntryBindings {
  const factory = new IDBFactory()
  return { locks, store: createAtomicV28Store(factory), sourceStore: createAtomicV27Store(factory),
    v26Store: createAtomicV26Store(factory), v25Store: createAtomicV25Store(factory),
    v24Store: createAtomicV24Store(factory), v23Store: createAtomicV23Store(factory),
    v17Store: createAtomicV17Store(factory) }
}
const sourceBindings = (f: PublicV28EntryBindings) => ({ locks: f.locks, store: f.sourceStore,
  sourceStore: f.v26Store, v25Store: f.v25Store, v24Store: f.v24Store,
  v23Store: f.v23Store, v17Store: f.v17Store })

describe('opt-in V28 checked entry', () => {
  it('offers a fresh checked foundation and resumes V28 without changing V27', async () => {
    const f = bindings(), blank = await inspectPublicV28Entry(f)
    expect(blank).toEqual({ status: 'fresh-available' })
    const html = renderToStaticMarkup(createElement(PublicV28EntryView, { entry: blank,
      busy: false, onChoose: () => {}, onRetry: () => {}, actionError: null }))
    expect(html).toContain('Start new V28 world')
    expect(html).toContain('not backed up online')
    const created = await choosePublicV28Entry(blank, 'create', f, seed)
    if (!created.ok) throw new Error(created.reason)
    const source = await f.sourceStore.readChecked()
    expect(source.status).toBe('valid')
    expect(created.value.lineage.sourceReceipt).toEqual(source.status === 'valid'
      ? { head: source.root.head, lineage: source.root.lineage } : null)
    expect(created.value.head.riverBridgeIds).toEqual([])
    expect(await inspectPublicV28Entry(f)).toEqual({ status: 'resume', start: created.value })
    expect(await choosePublicV28Entry({ status: 'resume', start: created.value },
      'resume', f, seed)).toEqual(created)
    expect(await f.sourceStore.readChecked()).toEqual(source)
    expect(await choosePublicV28Entry(blank, 'create', f, seed))
      .toEqual({ ok: false, reason: 'source-changed' })
  }, 30_000)

  it('copies a validated V27 seed without resetting the source world', async () => {
    const f = bindings(), predecessor = sourceBindings(f)
    const blank = await inspectPublicV27Entry(predecessor)
    expect(blank.status).toBe('fresh-available')
    const v27 = await choosePublicV27Entry(blank, 'create', predecessor, 'wizard-realms')
    if (!v27.ok) throw new Error(v27.reason)
    const prior = await f.sourceStore.readChecked()
    const decision = await inspectPublicV28Entry(f)
    expect(decision.status).toBe('migration-available')
    const migrated = await choosePublicV28Entry(decision, 'migrate', f, seed)
    if (!migrated.ok) throw new Error(migrated.reason)
    expect(migrated.value.head.state.seed).toBe('wizard-realms')
    expect(await f.sourceStore.readChecked()).toEqual(prior)
  }, 30_000)

  it('never offers a destructive choice when ancestry is blocked', async () => {
    const f = bindings()
    expect(await inspectPublicV28Entry(null)).toEqual({ status: 'blocked', reason: 'storage-error' })
    expect(await choosePublicV28Entry({ status: 'blocked', reason: 'source-changed' },
      'create', f, seed)).toEqual({ ok: false, reason: 'choice-unavailable' })
  })
})
