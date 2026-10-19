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
import { createAtomicV30Store } from './domain/atomicV30Database'
import { createAtomicV31Store } from './domain/atomicV31Database'
import { PUBLIC_V7_LOCK_NAME } from './domain/publicWorldV7'
import { choosePublicV30Entry, inspectPublicV30Entry } from './PublicV30Entry'
import { choosePublicV31Entry, inspectPublicV31Entry, PublicV31EntryView } from './PublicV31Entry'
import type { PublicV31EntryBindings } from './PublicV31Entry'
import mainSource from './main.tsx?raw'

let active = false
const locks = { request: async <T,>(name: string, options: { mode: 'exclusive' },
  body: () => T | Promise<T>): Promise<T> => {
  expect(name).toBe(PUBLIC_V7_LOCK_NAME)
  expect(options).toEqual({ mode: 'exclusive' })
  if (active) throw new Error('Nested world lock')
  active = true
  try { return await body() } finally { active = false }
} }
function bindings(): PublicV31EntryBindings {
  const factory = new IDBFactory()
  return { locks, store: createAtomicV31Store(factory), sourceStore: createAtomicV30Store(factory),
    v29Store: createAtomicV29Store(factory), v28Store: createAtomicV28Store(factory),
    v27Store: createAtomicV27Store(factory), v26Store: createAtomicV26Store(factory),
    v25Store: createAtomicV25Store(factory), v24Store: createAtomicV24Store(factory),
    v23Store: createAtomicV23Store(factory), v17Store: createAtomicV17Store(factory) }
}
const v30Bindings = (f: PublicV31EntryBindings) => ({ locks: f.locks, store: f.sourceStore,
  sourceStore: f.v29Store, v28Store: f.v28Store, v27Store: f.v27Store,
  v26Store: f.v26Store, v25Store: f.v25Store, v24Store: f.v24Store,
  v23Store: f.v23Store, v17Store: f.v17Store })

describe('opt-in V31 checked entry', () => {
  it('creates a V30 foundation and a distinct V31 copy of its complete validated root', async () => {
    const f = bindings(), blank = await inspectPublicV31Entry(f)
    expect(blank).toEqual({ status: 'fresh-available' })
    const html = renderToStaticMarkup(createElement(PublicV31EntryView, { entry: blank,
      busy: false, onChoose: () => {}, onRetry: () => {}, actionError: null }))
    expect(html).toContain('Start new adventure')
    expect(html).toContain('separate checked V31 save')
    expect(html).toContain('not backed up online')
    const created = await choosePublicV31Entry(blank, 'create', f, 'greenway-alpha')
    if (!created.ok) throw new Error(created.reason)
    const source = await f.sourceStore.readChecked()
    expect(source.status).toBe('valid')
    expect(created.value.lineage.sourceReceipt).toEqual(source.status === 'valid'
      ? source.root : null)
    expect(created.value.lineage.sourceReceipt).toHaveProperty('previous')
    expect(created.value.head.raisedSoilCells).toEqual([])
    expect(await inspectPublicV31Entry(f)).toEqual({ status: 'resume', start: created.value })
    expect(await choosePublicV31Entry({ status: 'resume', start: created.value },
      'resume', f, 'ignored')).toEqual(created)
    expect(await f.sourceStore.readChecked()).toEqual(source)
    expect(await choosePublicV31Entry(blank, 'create', f, 'greenway-alpha'))
      .toEqual({ ok: false, reason: 'source-changed' })
  }, 240_000)

  it('copies an existing V30 world without changing its checked source', async () => {
    const f = bindings(), predecessor = v30Bindings(f)
    const blank = await inspectPublicV30Entry(predecessor)
    expect(blank.status).toBe('fresh-available')
    const v30 = await choosePublicV30Entry(blank, 'create', predecessor, 'wizard-realms')
    if (!v30.ok) throw new Error(v30.reason)
    const prior = await f.sourceStore.readChecked()
    const decision = await inspectPublicV31Entry(f)
    expect(decision.status).toBe('migration-available')
    const migrated = await choosePublicV31Entry(decision, 'migrate', f, 'ignored')
    if (!migrated.ok) throw new Error(migrated.reason)
    expect(migrated.value.head.state.seed).toBe('wizard-realms')
    expect(migrated.value.lineage.sourceReceipt).toEqual(prior.status === 'valid'
      ? prior.root : null)
    expect(await f.sourceStore.readChecked()).toEqual(prior)
  }, 240_000)

  it('fails closed on missing storage or a blocked choice', async () => {
    const f = bindings()
    expect(await inspectPublicV31Entry(null)).toEqual({ status: 'blocked', reason: 'storage-error' })
    expect(await choosePublicV31Entry({ status: 'blocked', reason: 'source-changed' },
      'create', f, 'greenway-alpha')).toEqual({ ok: false, reason: 'choice-unavailable' })
  })

  it('opens the V31 URL route behind a build-time gate while leaving V30 available', () => {
    expect(mainSource).toContain('export const PUBLIC_V31_ENTRY_READY = true')
    expect(mainSource).toContain("publicWorld === 'v31'")
    expect(mainSource).toContain('PUBLIC_V31_ENTRY_READY\n      ? <PublicV31EntryApp')
    expect(mainSource).toContain('<PublicV23Controller version="v31" start={start} {...bindings} />')
    expect(mainSource).toContain("publicWorld === 'v30'")
    expect(mainSource).toContain('export const PUBLIC_V30_ENTRY_READY = true')
  })
})
