import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { choosePublicV43Entry, inspectPublicV43Entry } from './PublicV43Entry'
import type { PublicV43EntryBindings } from './PublicV43Entry'
import { createAtomicV42Store } from './domain/atomicV42Database'
import { createAtomicV43Store } from './domain/atomicV43Database'
import { createFreshPublicV41Root } from './domain/publicWorldV41Snapshot'
import { createFreshPublicV42Root, createPublicV42Root } from './domain/publicWorldV42Snapshot'
import { createFreshPublicV43Root } from './domain/publicWorldV43Snapshot'

const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>) => body() }
function bindings(): PublicV43EntryBindings {
  const factory = new IDBFactory()
  return { locks, store: createAtomicV43Store(factory),
    v42Store: createAtomicV42Store(factory) }
}

describe('V43 entry decisions', () => {
  it('imports without a primed V41 module graph', async () => {
    vi.resetModules()
    await expect(import('./PublicV43Entry')).resolves.toHaveProperty('inspectPublicV43Entry')
  })

  it('offers New Game only with both records absent, then resumes a checked V43 save', async () => {
    const entry = bindings()
    const fresh = await inspectPublicV43Entry(entry)
    expect(fresh).toEqual({ status: 'fresh-available' })
    expect(await choosePublicV43Entry(fresh, 'migrate', entry))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    const started = await choosePublicV43Entry(fresh, 'create', entry)
    expect(started).toMatchObject({ ok: true, value: { head: { saveRevision: 0 } } })
    const resumed = await inspectPublicV43Entry(entry)
    expect(resumed).toMatchObject({ status: 'resume', start: {
      lineage: { origin: 'v42-migration' } } })
    expect(await choosePublicV43Entry(resumed, 'resume', entry)).toEqual(started)
  }, 120_000)

  it('migrates only an unmarked checked V42 source after explicit choice', async () => {
    const entry = bindings(), root = createFreshPublicV42Root('wizard-realms')
    const empty = await entry.v42Store.readChecked()
    if (empty.status !== 'missing') throw Error('Expected empty V42 source')
    expect(await entry.v42Store.commit(empty.proof, root)).toBe('committed')
    const decision = await inspectPublicV43Entry(entry)
    expect(decision).toEqual({ status: 'migrate-available', sourceRevision: 0 })
    expect((await entry.store.readChecked()).status).toBe('missing')
    expect(await choosePublicV43Entry({ status: 'migrate-available', sourceRevision: 1 },
      'migrate', entry)).toEqual({ ok: false, reason: 'source-revision-changed' })
    const moved = await choosePublicV43Entry(decision, 'migrate', entry)
    expect(moved).toMatchObject({ ok: true, value: { lineage: {
      origin: 'v42-migration', sourceRevision: 0 } } })
    expect(await entry.v42Store.readForPromotion()).toMatchObject({ status: 'valid',
      root, marker: { phase: 'finalized' } })
    expect((await entry.v42Store.readChecked()).status).toBe('blocked')
    expect((await inspectPublicV43Entry(entry)).status).toBe('resume')
  }, 120_000)

  it('continues an interrupted fresh handoff from its fenced V42 source', async () => {
    const pending = bindings()
    expect(await pending.v42Store.bootstrapFreshSuccessor('wizard-realms')).toBe('committed')
    const decision = await inspectPublicV43Entry(pending)
    expect(decision).toEqual({ status: 'recover-available', sourceRevision: 0, fresh: true })
    expect(await choosePublicV43Entry(decision, 'recover', pending))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 0 } } })
    expect(await pending.v42Store.readForPromotion()).toMatchObject({ status: 'valid',
      root: createFreshPublicV42Root('wizard-realms'), marker: { phase: 'finalized' } })
    expect((await inspectPublicV43Entry(pending)).status).toBe('resume')
  }, 120_000)

  it('continues an interrupted migration without reopening the V42 writer', async () => {
    const pending = bindings()
    const root = createPublicV42Root(createFreshPublicV41Root('wizard-realms'))
    const empty = await pending.v42Store.readChecked()
    if (empty.status !== 'missing') throw Error('Expected empty V42 source')
    expect(await pending.v42Store.commit(empty.proof, root)).toBe('committed')
    const source = await pending.v42Store.readForPromotion()
    if (source.status !== 'valid') throw Error('Expected checked V42 source')
    expect(await pending.v42Store.transitionSuccessor(source.proof, 'pending'))
      .toBe('committed')
    const decision = await inspectPublicV43Entry(pending)
    expect(decision).toEqual({ status: 'recover-available', sourceRevision: 0, fresh: false })
    expect(await choosePublicV43Entry(decision, 'recover', pending))
      .toMatchObject({ ok: true, value: { lineage: {
        origin: 'v42-migration', sourceRevision: 0 } } })
    expect(await pending.v42Store.readForPromotion()).toMatchObject({ status: 'valid',
      root, marker: { phase: 'finalized' } })
  }, 120_000)

  it('blocks unavailable locks and ambiguous targets', async () => {
    const withoutLock = { ...bindings(), locks: undefined } as unknown as PublicV43EntryBindings
    expect(await inspectPublicV43Entry(withoutLock))
      .toEqual({ status: 'blocked', reason: 'lock-unavailable' })
    expect(await choosePublicV43Entry({ status: 'fresh-available' }, 'create', withoutLock))
      .toEqual({ ok: false, reason: 'lock-unavailable' })
    const rejecting = { ...bindings(), locks: { request: async () => { throw Error('unavailable') } },
    } as unknown as PublicV43EntryBindings
    expect(await inspectPublicV43Entry(rejecting))
      .toEqual({ status: 'blocked', reason: 'storage-error' })

    const orphan = bindings(), empty = await orphan.store.readChecked()
    if (empty.status !== 'missing') throw Error('Expected empty V43 target')
    expect(await orphan.store.commit(empty.proof,
      createFreshPublicV43Root('wizard-realms'))).toBe('committed')
    expect(await inspectPublicV43Entry(orphan))
      .toEqual({ status: 'blocked', reason: 'source-missing' })

    const ambiguous = bindings(), v42 = await ambiguous.v42Store.readChecked()
    const v43 = await ambiguous.store.readChecked()
    if (v42.status !== 'missing' || v43.status !== 'missing')
      throw Error('Expected empty migration branch')
    expect(await ambiguous.v42Store.commit(v42.proof,
      createFreshPublicV42Root('wizard-realms'))).toBe('committed')
    expect(await ambiguous.store.commit(v43.proof,
      createFreshPublicV43Root('wizard-realms'))).toBe('committed')
    expect(await inspectPublicV43Entry(ambiguous))
      .toEqual({ status: 'blocked', reason: 'ambiguous-legacy-target' })

  }, 120_000)
})
