import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV14Store } from './domain/atomicV14Database'
import { createAtomicV15Store } from './domain/atomicV15Database'
import { startFreshPublicV14 } from './domain/publicWorldV14Flow'
import { createFreshPublicV14Head, decodePublicV14Head } from './domain/publicWorldV14Snapshot'
import { publicWorldV15SuppressedStarterResourceIds } from './domain/publicWorldV15StarterSites'
import { inspectPublicV15, resumePublicV15 } from './domain/publicWorldV15Flow'
import { createFreshPublicV15Head, decodePublicV15Head, decodePublicV15Lineage,
  encodePublicV15Head, PUBLIC_V15_DATABASE_NAME, PUBLIC_V15_SCHEMA } from './domain/publicWorldV15Snapshot'
import { choosePublicV15Entry, inspectPublicV15Entry,
  PublicV15SafetyGate } from './PublicV15Entry'

const locks = { request: async <T,>(name: string, options: { mode: 'exclusive' },
  callback: () => T | Promise<T>): Promise<T> => {
  expect(name).toBe('wizard-realms:world:v6:root:exclusive')
  expect(options).toEqual({ mode: 'exclusive' })
  return callback()
} }

async function rawPut(factory: IDBFactory, slot: string, value: unknown) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(PUBLIC_V15_DATABASE_NAME, 1)
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

describe('isolated public v15 shell', () => {
  it('creates a separate v15 envelope and never opens or modifies an existing v14 root', async () => {
    const factory = new FakeFactory()
    const v14 = createAtomicV14Store(factory)
    const old = await startFreshPublicV14(locks, v14, 'greenway-alpha')
    expect(old.ok).toBe(true)
    const original = structuredClone(await v14.read())
    const open = vi.spyOn(factory, 'open')
    const v15 = createAtomicV15Store(factory)
    const decision = await inspectPublicV15Entry(locks, v15)
    expect(decision).toEqual({ status: 'missing' })
    const created = await choosePublicV15Entry(decision, locks, v15, 'greenway-alpha')
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.lineage.rulesProfile).toBe('starter-crossing/v2')
    expect(created.value.saveRevision).toBe(0)
    const raw = await v15.read()
    expect(raw.status).toBe('ok')
    if (raw.status !== 'ok') return
    expect((raw.head as { value: { schemaVersion: string } }).value.schemaVersion)
      .toBe(PUBLIC_V15_SCHEMA)
    const v15Head = decodePublicV15Head((raw.head as { value: unknown }).value, raw.lineage)
    expect(v15Head?.state).toEqual(created.value.state)
    expect(v15Head?.starterWorks).toEqual({ bridgeBuilt: false, bankCacheDug: false })
    expect(v15Head?.resourceClearance.suppressedResourceIds.length).toBeGreaterThan(0)
    expect(decodePublicV14Head((raw.head as { value: unknown }).value,
      createFreshPublicV14Head('greenway-alpha').lineage)).toBeNull()
    expect(open.mock.calls.map(([name]) => name)).toEqual([
      PUBLIC_V15_DATABASE_NAME, PUBLIC_V15_DATABASE_NAME,
      PUBLIC_V15_DATABASE_NAME, PUBLIC_V15_DATABASE_NAME,
    ])
    expect(await v14.read()).toEqual(original)
  })

  it('resumes only the exact v15 root and leaves the playable route dormant', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV15Store(factory)
    const initial = await inspectPublicV15Entry(locks, store)
    const fresh = await choosePublicV15Entry(initial, locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error(fresh.reason)
    expect((await inspectPublicV15(locks, store))).toEqual({ ok: true,
      value: { status: 'valid', start: fresh.value } })
    expect(await resumePublicV15(locks, store, 0, fresh.value.lineage))
      .toEqual({ ok: true, value: fresh.value })
    expect(await resumePublicV15(locks, store, 0,
      { ...fresh.value.lineage, rulesProfile: 'unknown' }))
      .toEqual({ ok: false, reason: 'invalid-expectation' })
    expect(await choosePublicV15Entry(initial, locks, store, 'other-seed'))
      .toEqual({ ok: false, reason: 'root-present' })
    expect((await factory.databases()).map(({ name }) => name))
      .toEqual([PUBLIC_V15_DATABASE_NAME])
    const gate = renderToStaticMarkup(createElement(PublicV15SafetyGate))
    expect(gate).toContain('data-public-v15-entry="dormant"')
    expect(gate).toContain('not playable yet')
    expect(gate).not.toContain('Create new v15 world')
  })

  it('rejects wrong-version lineage and heads rather than importing them', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV15Store(factory)
    const v14 = createFreshPublicV14Head('greenway-alpha')
    expect(decodePublicV15Lineage(v14.lineage)).toBeNull()
    expect(decodePublicV15Head(v14.head, v14.lineage)).toBeNull()
    expect(await store.read()).toEqual({ status: 'ok', head: null,
      previous: null, lineage: null })
    await rawPut(factory, 'lineage', v14.lineage)
    await rawPut(factory, 'head', { saveRevision: 0, value: v14.head })
    expect(await inspectPublicV15Entry(locks, store))
      .toEqual({ status: 'blocked', reason: 'invalid-v15-records' })
    expect((await factory.databases()).map(({ name }) => name))
      .toEqual([PUBLIC_V15_DATABASE_NAME])
  })

  it('blocks an experimental v1 root without silently upgrading or deleting it', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV15Store(factory)
    const fresh = createFreshPublicV15Head('greenway-alpha')
    const legacy = { ...fresh.lineage, rulesProfile: 'starter-crossing/v1' }
    const record = { saveRevision: 0, value: fresh.head }
    expect((await store.read()).status).toBe('ok')
    await rawPut(factory, 'lineage', legacy)
    await rawPut(factory, 'head', record)
    expect(await inspectPublicV15Entry(locks, store))
      .toEqual({ status: 'blocked', reason: 'legacy-v15-root' })
    const after = await store.read()
    expect(after.status === 'ok' ? after.lineage : null).toEqual(legacy)
    expect(after.status === 'ok' ? after.head : null).toEqual(record)
  })

  it('keeps the v14 core immutable while recording version-native resource clearance', async () => {
    for (const seed of ['greenway-alpha', 'greenway-beta', 'route-seed-37']) {
      const factory = new FakeFactory()
      const store = createAtomicV15Store(factory)
      const decision = await inspectPublicV15Entry(locks, store)
      const fresh = await choosePublicV15Entry(decision, locks, store, seed)
      if (!fresh.ok) throw new Error(fresh.reason)
      const old = createFreshPublicV14Head(seed)
      expect(fresh.value.state).toEqual(old.head.state)
      const raw = await store.read()
      if (raw.status !== 'ok') throw new Error('Missing v15 head')
      const head = decodePublicV15Head((raw.head as { value: unknown }).value, raw.lineage)
      expect(head?.resourceClearance.suppressedResourceIds)
        .toEqual(publicWorldV15SuppressedStarterResourceIds(seed,
          old.head.state.greenway.resources))
    }
  })

  it('blocks a forged starter-work flag or edited clearance without repairing it', async () => {
    for (const edit of ['starter-works', 'clearance']) {
      const factory = new FakeFactory()
      const store = createAtomicV15Store(factory)
      const decision = await inspectPublicV15Entry(locks, store)
      const fresh = await choosePublicV15Entry(decision, locks, store, 'greenway-alpha')
      if (!fresh.ok) throw new Error(fresh.reason)
      const raw = await store.read()
      if (raw.status !== 'ok') throw new Error('Missing v15 head')
      const record = structuredClone(raw.head as { saveRevision: number; value: {
        starterWorks: { bridgeBuilt: boolean }; resourceClearance: { suppressedResourceIds: string[] }
      } })
      if (edit === 'starter-works') record.value.starterWorks.bridgeBuilt = true
      else record.value.resourceClearance.suppressedResourceIds.pop()
      await rawPut(factory, 'head', record)
      expect(await inspectPublicV15Entry(locks, store))
        .toEqual({ status: 'blocked', reason: 'invalid-v15-records' })
      const after = await store.read()
      expect(after.status === 'ok' ? after.head : null).toEqual(record)
    }
  })

  it.each(['head', 'previous'] as const)(
    'rejects sparse or extra-property clearance arrays in the raw %s slot', async (slot) => {
      for (const tamper of ['hole', 'extra-own-property'] as const) {
        const factory = new FakeFactory()
        const store = createAtomicV15Store(factory)
        const initial = await inspectPublicV15Entry(locks, store)
        const fresh = await choosePublicV15Entry(initial, locks, store, 'greenway-alpha')
        if (!fresh.ok) throw new Error(fresh.reason)
        const raw = await store.read()
        if (raw.status !== 'ok') throw new Error('Missing v15 head')
        const genesis = structuredClone(raw.head as { saveRevision: number; value: {
          resourceClearance: { suppressedResourceIds: string[] }
        } })
        if (slot === 'previous') {
          const next = encodePublicV15Head(fresh.value.state, 1, fresh.value.lineage)
          await rawPut(factory, 'previous', genesis)
          await rawPut(factory, 'head', { saveRevision: 1, value: next })
          expect((await inspectPublicV15Entry(locks, store)).status).toBe('resume')
        }
        const record = structuredClone(genesis)
        const ids = record.value.resourceClearance.suppressedResourceIds
        expect(ids.length).toBeGreaterThan(0)
        if (tamper === 'hole') delete ids[0]
        else Object.defineProperty(ids, 'foo', { value: 'hidden', enumerable: true,
          configurable: true, writable: true })
        await rawPut(factory, slot, record)
        expect(await inspectPublicV15Entry(locks, store))
          .toEqual({ status: 'blocked', reason: 'invalid-v15-records' })
      }
    },
  )
})
