import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { createAtomicV24Store } from './domain/atomicV24Database'
import { createAtomicV25Store } from './domain/atomicV25Database'
import { createAtomicV26Store } from './domain/atomicV26Database'
import { startFreshPublicV17 } from './domain/publicWorldV17Flow'
import { startFreshPublicV24World } from './domain/publicWorldV24Flow'
import { commitPublicV25, startPublicV25 } from './domain/publicWorldV25Flow'
import { PUBLIC_V25_DATABASE_NAME } from './domain/publicWorldV25Migration'
import { PUBLIC_V26_DATABASE_NAME } from './domain/publicWorldV26Migration'
import { PUBLIC_V7_LOCK_NAME } from './domain/publicWorldV7'
import { choosePublicV26Entry, inspectPublicV26Entry, PublicV26EntryView } from './PublicV26Entry'
import type { PublicV26EntryBindings, PublicV26EntryDecision } from './PublicV26Entry'

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
const bindings = (factory = new IDBFactory()): PublicV26EntryBindings => ({ locks,
  store: createAtomicV26Store(factory), sourceStore: createAtomicV25Store(factory),
  v24Store: createAtomicV24Store(factory), v23Store: createAtomicV23Store(factory),
  v17Store: createAtomicV17Store(factory) })
const view = (entry: PublicV26EntryDecision, actionError: string | null = null) =>
  renderToStaticMarkup(createElement(PublicV26EntryView, { entry, busy: false,
    onChoose: () => {}, onRetry: () => {}, actionError }))

async function startOld(f: PublicV26EntryBindings) {
  const v24 = await startFreshPublicV24World(f.locks, f.v24Store, f.v23Store, f.v17Store, seed)
  if (!v24.ok) throw new Error(v24.reason)
  const v25 = await startPublicV25(f.locks, f.sourceStore, f.v24Store,
    f.v23Store, f.v17Store, seed, v24.value)
  if (!v25.ok) throw new Error(v25.reason)
  return v25.value
}

async function putStray(factory: IDBFactory, name: string) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').put({ stray: true }, 'stray')
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  }) } finally { db.close() }
}

describe('explicit V26 entry', () => {
  it('creates a checked V25 foundation on a blank profile, then copies it into V26', async () => {
    const f = bindings(), blank = await inspectPublicV26Entry(f)
    expect(blank).toEqual({ status: 'fresh-available' })
    expect(view(blank)).toContain('Start new V26 world')
    expect(view(blank)).toContain('not backed up online')
    expect(await choosePublicV26Entry(blank, 'migrate', f, seed))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    expect((await f.store.readChecked()).status).toBe('missing')
    expect((await f.sourceStore.readChecked()).status).toBe('missing')
    const created = await choosePublicV26Entry(blank, 'create', f, seed)
    if (!created.ok) throw new Error(created.reason)
    const v25 = await f.sourceStore.readChecked()
    expect(v25.status).toBe('valid')
    expect(created.value.lineage.sourceReceipt).toEqual(v25.status === 'valid'
      ? { head: v25.root.head, lineage: v25.root.lineage } : null)
    expect((await f.v24Store.readChecked()).status).toBe('valid')
    expect((await f.v23Store.readChecked()).status).toBe('valid')
    expect((await f.v17Store.readChecked()).status).toBe('ok')
    const ready = await inspectPublicV26Entry(f)
    expect(ready).toEqual({ status: 'resume', start: created.value })
    expect(await choosePublicV26Entry(ready, 'resume', f, seed)).toEqual(created)
    expect(await f.sourceStore.readChecked()).toEqual(v25)
  }, 30_000)

  it('links partial older worlds to V25 and rejects a stale blank-world choice', async () => {
    const f = bindings(), blank = await inspectPublicV26Entry(f)
    const v24 = await startFreshPublicV24World(f.locks, f.v24Store, f.v23Store, f.v17Store, seed)
    if (!v24.ok) throw new Error(v24.reason)
    const partial = await inspectPublicV26Entry(f)
    expect(partial).toEqual({ status: 'older-world' })
    expect(view(partial)).toContain('publicWorld=v25')
    expect(view(partial)).not.toContain('Start new V26 world')
    expect(await choosePublicV26Entry(blank, 'create', f, seed))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect((await f.store.readChecked()).status).toBe('missing')
    expect((await f.sourceStore.readChecked()).status).toBe('missing')
  }, 30_000)

  it('keeps a checked V25 foundation available if the V26 copy fails', async () => {
    const f = bindings(), blank = await inspectPublicV26Entry(f)
    const failed: PublicV26EntryBindings = { ...f,
      store: { ...f.store, commit: async () => 'storage-error' as const } }
    expect(await choosePublicV26Entry(blank, 'create', failed, seed))
      .toEqual({ ok: false, reason: 'storage-error' })
    expect((await f.store.readChecked()).status).toBe('missing')
    expect((await f.sourceStore.readChecked()).status).toBe('valid')
    const retry = await inspectPublicV26Entry(f)
    expect(retry.status).toBe('migration-available')
    const copied = await choosePublicV26Entry(retry, 'migrate', f, seed)
    expect(copied.ok).toBe(true)
  }, 30_000)

  it('copies only a checked V25 save on explicit choice, then resumes V26', async () => {
    const f = bindings(), old = await startOld(f), before = await f.sourceStore.readChecked()
    const decision = await inspectPublicV26Entry(f)
    expect(decision).toEqual({ status: 'migration-available', sourceReceipt: old })
    expect(view(decision)).toContain('last committed V25 save')
    expect(view(decision)).toContain('V25 save remains in place')
    expect((await f.store.readChecked()).status).toBe('missing')
    expect(await choosePublicV26Entry(decision, 'resume', f, seed))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    const migrated = await choosePublicV26Entry(decision, 'migrate', f, seed)
    if (!migrated.ok) throw new Error(migrated.reason)
    expect(migrated.value.lineage.sourceReceipt).toEqual(old)
    expect(await f.sourceStore.readChecked()).toEqual(before)
    const ready = await inspectPublicV26Entry(f)
    expect(ready).toEqual({ status: 'resume', start: migrated.value })
    expect(view(ready)).toContain('Resume V26 world')
    expect(await choosePublicV26Entry(ready, 'resume', f, 'ignored')).toEqual(migrated)
  }, 30_000)

  it('rejects a stale V25 migration choice and blocks resume after source changes', async () => {
    const f = bindings(), old = await startOld(f), decision = await inspectPublicV26Entry(f)
    const advanced = await commitPublicV25(f.locks, f.sourceStore, f.v24Store,
      f.v23Store, f.v17Store, 0, old.lineage, { kind: 'checkpoint' })
    if (!advanced.ok) throw new Error(advanced.reason)
    expect(await choosePublicV26Entry(decision, 'migrate', f, seed))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect((await f.store.readChecked()).status).toBe('missing')
    const current = await inspectPublicV26Entry(f)
    const migrated = await choosePublicV26Entry(current, 'migrate', f, seed)
    if (!migrated.ok) throw new Error(migrated.reason)
    const later = await commitPublicV25(f.locks, f.sourceStore, f.v24Store,
      f.v23Store, f.v17Store, 1, advanced.value.lineage, { kind: 'checkpoint' })
    if (!later.ok) throw new Error(later.reason)
    expect(await inspectPublicV26Entry(f))
      .toEqual({ status: 'blocked', reason: 'source-changed' })
    expect(await choosePublicV26Entry({ status: 'resume', start: migrated.value },
      'resume', f, seed)).toEqual({ ok: false, reason: 'source-changed' })
  }, 30_000)

  it('blocks corrupt V25 source and never mistakes an existing V26 target for an older world', async () => {
    const factory = new IDBFactory(), f = bindings(factory)
    await startOld(f)
    await putStray(factory, PUBLIC_V25_DATABASE_NAME)
    const corrupt = await inspectPublicV26Entry(f)
    expect(corrupt.status).toBe('blocked')
    expect(view(corrupt)).toContain('saves were not reset')
    expect(view(corrupt)).not.toContain('publicWorld=v25')
    const corruptTargetFactory = new IDBFactory(), corruptTarget = bindings(corruptTargetFactory)
    await corruptTarget.store.readChecked()
    await putStray(corruptTargetFactory, PUBLIC_V26_DATABASE_NAME)
    const blockedTarget = await inspectPublicV26Entry(corruptTarget)
    expect(blockedTarget.status).toBe('blocked')
    expect(view(blockedTarget)).not.toContain('publicWorld=v25')
    const clean = bindings(), source = await startOld(clean)
    const brokenChain = { ...clean, v24Store: createAtomicV24Store(new IDBFactory()),
      v23Store: createAtomicV23Store(new IDBFactory()),
      v17Store: createAtomicV17Store(new IDBFactory()) }
    const blockedChain = await inspectPublicV26Entry(brokenChain)
    expect(blockedChain.status).toBe('blocked')
    expect(view(blockedChain)).not.toContain('publicWorld=v25')
    const migration = await inspectPublicV26Entry(clean)
    const started = await choosePublicV26Entry(migration, 'migrate', clean, seed)
    if (!started.ok) throw new Error(started.reason)
    expect(started.value.lineage.sourceReceipt).toEqual(source)
    const separated = { ...clean, sourceStore: createAtomicV25Store(new IDBFactory()),
      v24Store: createAtomicV24Store(new IDBFactory()),
      v23Store: createAtomicV23Store(new IDBFactory()),
      v17Store: createAtomicV17Store(new IDBFactory()) }
    expect(await inspectPublicV26Entry(separated))
      .toEqual({ status: 'blocked', reason: 'target-conflict' })
    expect((await clean.store.readChecked()).status).toBe('valid')
  }, 30_000)

  it('does not create over a partial V17 world discovered after blank inspection', async () => {
    const f = bindings(), blank = await inspectPublicV26Entry(f)
    const ancestor = await startFreshPublicV17(f.locks, f.v17Store, seed)
    if (!ancestor.ok) throw new Error(ancestor.reason)
    expect(await choosePublicV26Entry(blank, 'create', f, seed))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect((await f.sourceStore.readChecked()).status).toBe('missing')
    expect((await f.store.readChecked()).status).toBe('missing')
  }, 30_000)

  it('shows missing storage or lock as a blocked retry, never a create action', async () => {
    expect(await inspectPublicV26Entry(null)).toEqual({ status: 'blocked', reason: 'storage-error' })
    const unavailable = await inspectPublicV26Entry({ ...bindings(), locks: undefined as never })
    expect(unavailable).toEqual({ status: 'blocked', reason: 'lock-unavailable' })
    expect(view(unavailable, 'storage-error')).toContain('Reload to recheck')
    expect(view(unavailable, 'storage-error')).toContain('No save was cleared')
    expect(view(unavailable)).not.toContain('Start new V26 world')
  })
})
