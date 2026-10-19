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
import { PUBLIC_V7_LOCK_NAME } from './domain/publicWorldV7'
import { startFreshPublicV24World } from './domain/publicWorldV24Flow'
import { startPublicV25 } from './domain/publicWorldV25Flow'
import { choosePublicV26Entry, inspectPublicV26Entry } from './PublicV26Entry'
import { choosePublicV27Entry, inspectPublicV27Entry, PublicV27EntryView } from './PublicV27Entry'
import type { PublicV27EntryBindings } from './PublicV27Entry'

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
function bindings(): PublicV27EntryBindings {
  const factory = new IDBFactory()
  return { locks, store: createAtomicV27Store(factory), sourceStore: createAtomicV26Store(factory),
    v25Store: createAtomicV25Store(factory), v24Store: createAtomicV24Store(factory),
    v23Store: createAtomicV23Store(factory), v17Store: createAtomicV17Store(factory) }
}

describe('explicit V27 entry', () => {
  it('copies a nondefault V25 world through missing V26 without changing its seed', async () => {
    const f = bindings()
    const old = await startFreshPublicV24World(f.locks, f.v24Store, f.v23Store,
      f.v17Store, 'wizard-realms')
    if (!old.ok) throw new Error(old.reason)
    const v25 = await startPublicV25(f.locks, f.v25Store, f.v24Store, f.v23Store,
      f.v17Store, 'wizard-realms', old.value)
    if (!v25.ok) throw new Error(v25.reason)
    const decision = await inspectPublicV27Entry(f)
    expect(decision).toEqual({ status: 'fresh-available' })
    const created = await choosePublicV27Entry(decision, 'create', f, seed)
    expect(created.ok).toBe(true)
    if (created.ok) expect(created.value.head.state.seed).toBe('wizard-realms')
  }, 30_000)

  it('migrates the V26 world seed even when the app fresh-world default differs', async () => {
    const f = bindings(), predecessor = { locks: f.locks, store: f.sourceStore,
      sourceStore: f.v25Store, v24Store: f.v24Store, v23Store: f.v23Store,
      v17Store: f.v17Store }
    const blank = await inspectPublicV26Entry(predecessor)
    expect(blank.status).toBe('fresh-available')
    const source = await choosePublicV26Entry(blank, 'create', predecessor, 'wizard-realms')
    if (!source.ok) throw new Error(source.reason)
    const decision = await inspectPublicV27Entry(f)
    expect(decision.status).toBe('migration-available')
    const migrated = await choosePublicV27Entry(decision, 'migrate', f, seed)
    expect(migrated.ok).toBe(true)
    if (migrated.ok) expect(migrated.value.head.state.seed).toBe('wizard-realms')
  }, 30_000)

  it('creates a checked V26 foundation, copies it once, and resumes V27 without altering V26', async () => {
    const f = bindings(), blank = await inspectPublicV27Entry(f)
    expect(blank).toEqual({ status: 'fresh-available' })
    const html = renderToStaticMarkup(createElement(PublicV27EntryView, { entry: blank,
      busy: false, onChoose: () => {}, onRetry: () => {}, actionError: null }))
    expect(html).toContain('Start new V27 world')
    expect(html).toContain('not backed up online')
    const created = await choosePublicV27Entry(blank, 'create', f, seed)
    if (!created.ok) throw new Error(created.reason)
    const source = await f.sourceStore.readChecked()
    expect(source.status).toBe('valid')
    expect(created.value.lineage.sourceReceipt).toEqual(source.status === 'valid'
      ? { head: source.root.head, lineage: source.root.lineage } : null)
    const ready = await inspectPublicV27Entry(f)
    expect(ready).toEqual({ status: 'resume', start: created.value })
    expect(await choosePublicV27Entry(ready, 'resume', f, seed)).toEqual(created)
    expect(await f.sourceStore.readChecked()).toEqual(source)
    expect(await choosePublicV27Entry(blank, 'create', f, seed))
      .toEqual({ ok: false, reason: 'source-changed' })
  }, 30_000)
})
