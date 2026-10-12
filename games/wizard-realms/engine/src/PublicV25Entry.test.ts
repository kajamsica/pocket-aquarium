import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { createAtomicV24Store } from './domain/atomicV24Database'
import { createAtomicV25Store } from './domain/atomicV25Database'
import { startFreshPublicV17 } from './domain/publicWorldV17Flow'
import { startPublicV23 } from './domain/publicWorldV23Flow'
import { commitPublicV24, startFreshPublicV24World } from './domain/publicWorldV24Flow'
import { PUBLIC_V7_LOCK_NAME } from './domain/publicWorldV7'
import { choosePublicV25Entry, inspectPublicV25Entry, PublicV25EntryView } from './PublicV25Entry'
import type { PublicV25EntryBindings, PublicV25EntryDecision } from './PublicV25Entry'

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
const bindings = (factory = new IDBFactory()): PublicV25EntryBindings => ({ locks,
  store: createAtomicV25Store(factory), sourceStore: createAtomicV24Store(factory),
  v23Store: createAtomicV23Store(factory), v17Store: createAtomicV17Store(factory) })
const view = (entry: PublicV25EntryDecision, actionError: string | null = null) =>
  renderToStaticMarkup(createElement(PublicV25EntryView, { entry, busy: false,
    onChoose: () => {}, onRetry: () => {}, actionError }))

describe('explicit V25 entry', () => {
  it('creates a checked V24 foundation only on a truly blank profile, then resumes V25', async () => {
    const f = bindings(), decision = await inspectPublicV25Entry(f)
    expect(decision).toEqual({ status: 'fresh-available' })
    expect(view(decision)).toContain('Start new V25 world')
    expect(view(decision)).toContain('not backed up online')
    const created = await choosePublicV25Entry(decision, 'create', f, seed)
    if (!created.ok) throw new Error(created.reason)
    expect(created.value.head.saveRevision).toBe(0)
    const v24 = await f.sourceStore.readChecked()
    expect(v24).toMatchObject({ status: 'valid' })
    expect(created.value.lineage.sourceReceipt).toEqual(v24.status === 'valid'
      ? { head: v24.root.head, lineage: v24.root.lineage } : null)
    const resume = await inspectPublicV25Entry(f)
    expect(resume).toEqual({ status: 'resume', start: created.value })
    expect(view(resume)).toContain('Resume V25 world')
    expect(await choosePublicV25Entry(resume, 'resume', f, seed)).toEqual(created)
    expect(await f.sourceStore.readChecked()).toEqual(v24)
  })

  it('copies a validated V24 save only on explicit choice and keeps the source intact', async () => {
    const f = bindings(), old = await startFreshPublicV24World(f.locks, f.sourceStore,
      f.v23Store, f.v17Store, seed)
    if (!old.ok) throw new Error(old.reason)
    const before = await f.sourceStore.readChecked(), decision = await inspectPublicV25Entry(f)
    expect(decision).toEqual({ status: 'migration-available', sourceReceipt: old.value })
    expect(view(decision)).toContain('last committed V24 save')
    expect(view(decision)).toContain('V24 save remains in place')
    expect((await f.store.readChecked()).status).toBe('missing')
    expect(await choosePublicV25Entry(decision, 'resume', f, seed))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    const copied = await choosePublicV25Entry(decision, 'migrate', f, seed)
    if (!copied.ok) throw new Error(copied.reason)
    expect(copied.value.lineage.sourceReceipt).toEqual(old.value)
    expect(await f.sourceStore.readChecked()).toEqual(before)
    expect(await inspectPublicV25Entry(f)).toEqual({ status: 'resume', start: copied.value })
  })

  it('guides V17 and V23 partial worlds and never offers a reset over a V25 target', async () => {
    const v17 = bindings(), blank17 = await inspectPublicV25Entry(v17)
    const old17 = await startFreshPublicV17(v17.locks, v17.v17Store, seed)
    if (!old17.ok) throw new Error(old17.reason)
    expect((await choosePublicV25Entry(blank17, 'create', v17, seed)).ok).toBe(false)
    const first = await inspectPublicV25Entry(v17)
    expect(first).toEqual({ status: 'older-world', route: 'v23' })
    expect(view(first)).toContain('publicWorld=v23')
    expect(await choosePublicV25Entry(first, 'create', v17, seed))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    const v23 = bindings(), old23 = await startPublicV23(v23.locks, v23.v23Store,
      v23.v17Store, seed, null)
    if (!old23.ok) throw new Error(old23.reason)
    const second = await inspectPublicV25Entry(v23)
    expect(second).toEqual({ status: 'older-world', route: 'v24' })
    expect(view(second)).toContain('publicWorld=v24')
    const completed = bindings(), blank = await inspectPublicV25Entry(completed)
    expect((await choosePublicV25Entry(blank, 'create', completed, seed)).ok).toBe(true)
    const separate: PublicV25EntryBindings = { ...completed,
      sourceStore: createAtomicV24Store(new IDBFactory()),
      v23Store: createAtomicV23Store(new IDBFactory()),
      v17Store: createAtomicV17Store(new IDBFactory()) }
    expect(await inspectPublicV25Entry(separate))
      .toEqual({ status: 'blocked', reason: 'target-conflict' })
    expect(view(await inspectPublicV25Entry(separate))).not.toContain('Start new V25 world')
  })

  it('blocks stale migration and retains checked older roots after a V25 write failure', async () => {
    const f = bindings(), old = await startFreshPublicV24World(f.locks, f.sourceStore,
      f.v23Store, f.v17Store, seed)
    if (!old.ok) throw new Error(old.reason)
    const decision = await inspectPublicV25Entry(f)
    const changed = await commitPublicV24(f.locks, f.sourceStore, f.v23Store, f.v17Store,
      0, old.value.lineage, { kind: 'checkpoint' })
    if (!changed.ok) throw new Error(changed.reason)
    expect(await choosePublicV25Entry(decision, 'migrate', f, seed))
      .toEqual({ ok: false, reason: 'source-changed' })
    const current = await inspectPublicV25Entry(f)
    const failed: PublicV25EntryBindings = { ...f,
      store: { ...f.store, commit: async () => 'storage-error' as const } }
    expect(await choosePublicV25Entry(current, 'migrate', failed, seed))
      .toEqual({ ok: false, reason: 'storage-error' })
    expect((await f.sourceStore.readChecked()).status).toBe('valid')
    expect((await f.store.readChecked()).status).toBe('missing')
    expect((await inspectPublicV25Entry(f)).status).toBe('migration-available')
  })

  it('shows storage and lock failures with retry and no reset', async () => {
    const absent = await inspectPublicV25Entry(null)
    expect(absent).toEqual({ status: 'blocked', reason: 'storage-error' })
    expect(view(absent, 'storage-error')).toContain('Reload to recheck')
    expect(view(absent, 'storage-error')).toContain('No save was cleared')
    expect(await inspectPublicV25Entry({ ...bindings(), locks: undefined as never }))
      .toEqual({ status: 'blocked', reason: 'lock-unavailable' })
  })
})
