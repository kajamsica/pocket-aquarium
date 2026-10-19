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
import { createAtomicV29Store } from './domain/atomicV29Database'
import { PUBLIC_V7_LOCK_NAME } from './domain/publicWorldV7'
import { choosePublicV28Entry, inspectPublicV28Entry } from './PublicV28Entry'
import { choosePublicV29Entry, inspectPublicV29Entry, PublicV29EntryView } from './PublicV29Entry'
import type { PublicV29EntryBindings } from './PublicV29Entry'

let active = false
const locks = { request: async <T,>(name: string, options: { mode: 'exclusive' },
  body: () => T | Promise<T>): Promise<T> => {
  expect(name).toBe(PUBLIC_V7_LOCK_NAME)
  expect(options).toEqual({ mode: 'exclusive' })
  if (active) throw new Error('Nested world lock')
  active = true
  try { return await body() } finally { active = false }
} }
function bindings(): PublicV29EntryBindings {
  const factory = new IDBFactory()
  return { locks, store: createAtomicV29Store(factory), sourceStore: createAtomicV28Store(factory),
    v27Store: createAtomicV27Store(factory), v26Store: createAtomicV26Store(factory),
    v25Store: createAtomicV25Store(factory), v24Store: createAtomicV24Store(factory),
    v23Store: createAtomicV23Store(factory), v17Store: createAtomicV17Store(factory) }
}
const v28Bindings = (f: PublicV29EntryBindings) => ({ locks: f.locks, store: f.sourceStore,
  sourceStore: f.v27Store, v26Store: f.v26Store, v25Store: f.v25Store,
  v24Store: f.v24Store, v23Store: f.v23Store, v17Store: f.v17Store })

describe('opt-in V29 checked entry', () => {
  it('creates a checked V28 foundation, then resumes V29 without changing V28', async () => {
    const f = bindings(), blank = await inspectPublicV29Entry(f)
    expect(blank).toEqual({ status: 'fresh-available' })
    const html = renderToStaticMarkup(createElement(PublicV29EntryView, { entry: blank,
      busy: false, onChoose: () => {}, onRetry: () => {}, actionError: null }))
    expect(html).toContain('Start new V29 world')
    expect(html).toContain('not backed up online')
    const created = await choosePublicV29Entry(blank, 'create', f, 'greenway-alpha')
    if (!created.ok) throw new Error(created.reason)
    const source = await f.sourceStore.readChecked()
    expect(source.status).toBe('valid')
    expect(created.value.lineage.sourceReceipt).toEqual(source.status === 'valid'
      ? { head: source.root.head, lineage: source.root.lineage } : null)
    expect(created.value.head.miningTools.activePick).toBeNull()
    expect(await inspectPublicV29Entry(f)).toEqual({ status: 'resume', start: created.value })
    expect(await choosePublicV29Entry({ status: 'resume', start: created.value },
      'resume', f, 'greenway-alpha')).toEqual(created)
    expect(await f.sourceStore.readChecked()).toEqual(source)
    expect(await choosePublicV29Entry(blank, 'create', f, 'greenway-alpha'))
      .toEqual({ ok: false, reason: 'source-changed' })
  }, 30_000)

  it('copies the validated V28 seed and preserves the source save', async () => {
    const f = bindings(), predecessor = v28Bindings(f)
    const blank = await inspectPublicV28Entry(predecessor)
    expect(blank.status).toBe('fresh-available')
    const v28 = await choosePublicV28Entry(blank, 'create', predecessor, 'wizard-realms')
    if (!v28.ok) throw new Error(v28.reason)
    const prior = await f.sourceStore.readChecked()
    const decision = await inspectPublicV29Entry(f)
    expect(decision.status).toBe('migration-available')
    const migrated = await choosePublicV29Entry(decision, 'migrate', f, 'ignored')
    if (!migrated.ok) throw new Error(migrated.reason)
    expect(migrated.value.head.state.seed).toBe('wizard-realms')
    expect(await f.sourceStore.readChecked()).toEqual(prior)
  }, 30_000)

  it('does not offer mutation from missing storage or a blocked choice', async () => {
    const f = bindings()
    expect(await inspectPublicV29Entry(null)).toEqual({ status: 'blocked', reason: 'storage-error' })
    expect(await choosePublicV29Entry({ status: 'blocked', reason: 'source-changed' },
      'create', f, 'greenway-alpha')).toEqual({ ok: false, reason: 'choice-unavailable' })
  })
})
