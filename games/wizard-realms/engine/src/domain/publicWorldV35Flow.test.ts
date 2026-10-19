import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV35Store } from './atomicV35Database'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { emptyPublicV29MiningTools } from './publicWorldV29MiningTools'
import { PUBLIC_V34_SCHEMA } from './publicWorldV34Snapshot'
import type { PublicV34Head } from './publicWorldV34Snapshot'
import { replayPublicV35Witness } from './publicWorldV35Snapshot'
import { commitPublicV35, inspectPublicV35, resumePublicV35,
  startPublicV35 } from './publicWorldV35Flow'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'

function fixture() {
  const { head } = createPublicV23Root('wizard-realms')
  const sourceHead: PublicV34Head = { schemaVersion: PUBLIC_V34_SCHEMA,
    saveRevision: 0, witness: null, state: head.state,
    greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
    terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0,
    riverBridgeIds: [], miningTools: emptyPublicV29MiningTools(),
    claimedBridgeheadId: null, raisedSoilCells: [] }
  const source = { readChecked: vi.fn(async () => ({ status: 'valid',
    root: { head: sourceHead } })) }
  const original = structuredClone(sourceHead)
  const factory = new IDBFactory(), store = createAtomicV35Store(factory)
  const locks = { request: vi.fn(async (_name: string, _options: unknown,
    body: () => Promise<unknown>) => body()) }
  return { sourceHead, source, original, store, factory, locks }
}

describe('V35 locked copy and checked flow', () => {
  it('copies once without writing V34, reloads and continues inherited actions', async () => {
    const f = fixture()
    expect(await inspectPublicV35(f.locks as never, f.store)).toEqual({ ok: true,
      value: { status: 'migration-available' } })
    const started = await startPublicV35(f.locks as never, f.store, f.source as never)
    if (!started.ok) throw new Error(started.reason)
    expect(f.sourceHead).toEqual(f.original)
    expect(f.source.readChecked).toHaveBeenCalledOnce()
    expect(await startPublicV35(f.locks as never, f.store, f.source as never))
      .toEqual({ ok: false, reason: 'target-conflict' })
    expect(await resumePublicV35(f.locks as never, f.store, 0, started.value.lineage))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 0 } } })
    const next = await commitPublicV35(f.locks as never, f.store, 0,
      started.value.lineage, { kind: 'checkpoint' })
    expect(next).toMatchObject({ ok: true, value: { head: { saveRevision: 1 } } })
    expect(await createAtomicV35Store(f.factory).readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1 } } })
    expect(await commitPublicV35(f.locks as never, f.store, 0,
      started.value.lineage, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'revision-changed' })
    const left = await f.store.readChecked(), right = await f.store.readChecked()
    if (left.status !== 'valid' || right.status !== 'valid') throw new Error('Missing V35 root')
    const replayed = replayPublicV35Witness(left.root.head, { kind: 'checkpoint' })
    if (!replayed) throw new Error('Checkpoint did not replay')
    const successor = { lineage: left.root.lineage, previous: left.root.head,
      head: { ...left.root.head, ...replayed, saveRevision: 2,
        witness: { kind: 'checkpoint' as const } } }
    expect(await f.store.commit(left.proof, successor)).toBe('committed')
    expect(await f.store.commit(right.proof, successor)).toBe('revision-changed')
    expect(f.locks.request).toHaveBeenCalledWith(PUBLIC_V7_LOCK_NAME,
      { mode: 'exclusive' }, expect.any(Function))
  })

  it('fails closed on missing source and forged or premature ledger actions', async () => {
    const f = fixture()
    f.source.readChecked.mockResolvedValueOnce({ status: 'missing' } as never)
    expect(await startPublicV35(f.locks as never, f.store, f.source as never))
      .toEqual({ ok: false, reason: 'source-missing' })
    f.source.readChecked.mockResolvedValueOnce({ status: 'valid',
      root: { head: { ...f.sourceHead, extra: true } } } as never)
    expect(await startPublicV35(f.locks as never, f.store, f.source as never))
      .toEqual({ ok: false, reason: 'invalid-source' })
    const started = await startPublicV35(f.locks as never, f.store, f.source as never)
    if (!started.ok) throw new Error(started.reason)
    expect(await commitPublicV35(f.locks as never, f.store, 0,
      started.value.lineage, { kind: 'ledger-deliver/v1' }))
      .toEqual({ ok: false, reason: 'requires_survey' })
    expect(await f.store.readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0 } } })
    expect(f.sourceHead).toEqual(f.original)
  })
})
