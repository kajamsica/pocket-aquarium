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
import { createAtomicV32Store } from './domain/atomicV32Database'
import { PUBLIC_V7_LOCK_NAME } from './domain/publicWorldV7'
import { choosePublicV31Entry, inspectPublicV31Entry } from './PublicV31Entry'
import { choosePublicV32Entry, inspectPublicV32Entry, PublicV32EntryView } from './PublicV32Entry'
import type { PublicV32EntryBindings } from './PublicV32Entry'
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
function bindings(): PublicV32EntryBindings {
  const factory = new IDBFactory()
  return { locks, store: createAtomicV32Store(factory), sourceStore: createAtomicV31Store(factory),
    v30Store: createAtomicV30Store(factory), v29Store: createAtomicV29Store(factory),
    v28Store: createAtomicV28Store(factory), v27Store: createAtomicV27Store(factory),
    v26Store: createAtomicV26Store(factory), v25Store: createAtomicV25Store(factory),
    v24Store: createAtomicV24Store(factory), v23Store: createAtomicV23Store(factory),
    v17Store: createAtomicV17Store(factory) }
}
const previous = (f: PublicV32EntryBindings) => ({ locks: f.locks, store: f.sourceStore,
  sourceStore: f.v30Store, v29Store: f.v29Store, v28Store: f.v28Store,
  v27Store: f.v27Store, v26Store: f.v26Store, v25Store: f.v25Store,
  v24Store: f.v24Store, v23Store: f.v23Store, v17Store: f.v17Store })

describe('V32 Highland entry', () => {
  it('starts an empty device with a separate V32 copy and resumes that exact head', async () => {
    const f = bindings(), fresh = await inspectPublicV32Entry(f)
    expect(fresh).toEqual({ status: 'fresh-available' })
    const html = renderToStaticMarkup(createElement(PublicV32EntryView, { entry: fresh,
      busy: false, onChoose: () => {}, onRetry: () => {}, actionError: null }))
    expect(html).toContain('Start new adventure')
    expect(html).toContain('older saves are not reset')
    const created = await choosePublicV32Entry(fresh, 'create', f, 'greenway-alpha')
    if (!created.ok) throw new Error(created.reason)
    const source = await f.sourceStore.readChecked()
    expect(source.status).toBe('valid')
    expect(created.value.lineage.sourceReceipt).toEqual(source.status === 'valid'
      ? source.root : null)
    expect(created.value.head.schemaVersion).toBe('wizard-world/v32')
    const resumed = await inspectPublicV32Entry(f)
    expect(resumed).toEqual({ status: 'resume', start: created.value })
    expect(await choosePublicV32Entry(resumed, 'resume', f, 'ignored')).toEqual(created)
    expect(await f.sourceStore.readChecked()).toEqual(source)
  }, 240_000)

  it('copies an existing V31 save without modifying the source', async () => {
    const f = bindings(), old = previous(f)
    const v31Decision = await inspectPublicV31Entry(old)
    const source = await choosePublicV31Entry(v31Decision, 'create', old, 'wizard-realms')
    if (!source.ok) throw new Error(source.reason)
    const sourceBefore = await f.sourceStore.readChecked()
    const decision = await inspectPublicV32Entry(f)
    expect(decision.status).toBe('migration-available')
    const migrated = await choosePublicV32Entry(decision, 'migrate', f, 'ignored')
    if (!migrated.ok) throw new Error(migrated.reason)
    expect(migrated.value.head.state.seed).toBe('wizard-realms')
    expect(migrated.value.lineage.sourceReceipt).toEqual(sourceBefore.status === 'valid'
      ? sourceBefore.root : null)
    expect(await f.sourceStore.readChecked()).toEqual(sourceBefore)
  }, 240_000)

  it('fails closed on unavailable choices and routes through the build-time readiness gate', async () => {
    const f = bindings()
    expect(await inspectPublicV32Entry(null)).toEqual({ status: 'blocked', reason: 'storage-error' })
    expect(await choosePublicV32Entry({ status: 'blocked', reason: 'source-changed' },
      'create', f, 'greenway-alpha')).toEqual({ ok: false, reason: 'choice-unavailable' })
    expect(mainSource).toContain('export const PUBLIC_V32_ENTRY_READY = true')
    expect(mainSource).toContain("publicWorld === 'v32'")
    expect(mainSource).toContain('PUBLIC_V32_ENTRY_READY\n      ? <PublicV32EntryApp')
    expect(mainSource).toContain('<PublicV23Controller version="v32" start={start} {...bindings} />')
    expect(mainSource).toContain('export const PUBLIC_V31_ENTRY_READY = true')
  })
})
