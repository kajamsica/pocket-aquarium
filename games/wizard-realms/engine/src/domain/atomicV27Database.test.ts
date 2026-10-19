import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV26Store } from './atomicV26Database'
import { createAtomicV27Store } from './atomicV27Database'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import { createPublicV26Root } from './publicWorldV26Snapshot'
import { PUBLIC_V27_DATABASE_NAME } from './publicWorldV27Migration'
import { createPublicV27Root, replayPublicV27Witness } from './publicWorldV27Snapshot'

function genesis() {
  const v23 = createPublicV23Root('wizard-realms')
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  return { v26, v27: createPublicV27Root({ head: v26.head, lineage: v26.lineage }) }
}

describe('atomic V27 root', () => {
  it('accepts a checked successor, falls back for valid noncanonical data, and rejects changed ancestry', async () => {
    const factory = new IDBFactory(), store = createAtomicV27Store(factory)
    const root = genesis().v27
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected empty V27 store')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const checked = await store.readChecked()
    if (checked.status !== 'valid') throw new Error('Missing V27 genesis')
    const successor = { lineage: checked.root.lineage, previous: checked.root.head,
      head: { ...checked.root.head, saveRevision: 1,
        witness: { kind: 'checkpoint' as const } } }
    let preflightMs = Number.NaN
    expect(await store.commit(checked.proof, successor, ({ phase, durationMs }) => {
      if (phase === 'atomic-candidate-preflight') preflightMs = durationMs
    })).toBe('committed')
    expect(Number.isFinite(preflightMs)).toBe(true)
    const saved = await store.readChecked()
    if (saved.status !== 'valid') throw new Error('Missing checked successor')
    const second = { lineage: Object.freeze({ ...saved.root.lineage }),
      previous: saved.root.head, head: { ...saved.root.head, saveRevision: 2,
        witness: { kind: 'checkpoint' as const } } }
    expect(await store.commit(saved.proof, second)).toBe('committed')
    const altered = await store.readChecked()
    if (altered.status !== 'valid') throw new Error('Missing noncanonical successor')
    expect(await store.commit(altered.proof, { lineage: { ...altered.root.lineage,
      seed: 'forged' }, previous: altered.root.head,
      head: { ...altered.root.head, saveRevision: 3,
        witness: { kind: 'checkpoint' as const } } })).toBe('invalid')
    const retry = await store.readChecked()
    if (retry.status !== 'valid') throw new Error('Expected unchanged V27 root')
    expect(await store.commit(retry.proof, { lineage: retry.root.lineage,
      previous: { ...retry.root.head, saveRevision: 1 },
      head: { ...retry.root.head, saveRevision: 3,
        witness: { kind: 'checkpoint' as const } } })).toBe('invalid')
  }, 30_000)

  it('keeps the V26 source unchanged, validates root shape and resolves competing CAS proofs', async () => {
    const factory = new IDBFactory(), old = createAtomicV26Store(factory)
    const oldMissing = await old.readChecked()
    if (oldMissing.status !== 'missing') throw new Error('Expected empty V26 store')
    const roots = genesis()
    expect(await old.commit(oldMissing.proof, roots.v26)).toBe('committed')
    const store = createAtomicV27Store(factory), missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected empty V27 store')
    expect(await store.commit(missing.proof, { ...roots.v27, extra: true } as never)).toBe('invalid')
    const retry = await store.readChecked()
    if (retry.status !== 'missing') throw new Error('Expected empty V27 store after invalid candidate')
    expect(await store.commit(retry.proof, roots.v27)).toBe('committed')
    const competitor = createAtomicV27Store(factory)
    const left = await store.readChecked(), right = await competitor.readChecked()
    if (left.status !== 'valid' || right.status !== 'valid') throw new Error('Missing V27 genesis')
    const witness = { kind: 'frame-batch/v1' as const,
      frames: [{ intents: [{ type: 'move' as const, delta: { x: 0.1, z: 0 } }],
        walkRequested: false }] }
    const before = { state: left.root.head.state, greenwayWorks: left.root.head.greenwayWorks,
      regionalWorks: left.root.head.regionalWorks, terrain: left.root.head.terrain,
      nextHomeAtMs: left.root.head.nextHomeAtMs }
    const moved = replayPublicV27Witness(before, witness)
    if (!moved) throw new Error('Expected V27 frame replay')
    const next = { lineage: left.root.lineage, previous: left.root.head,
      head: { ...left.root.head, ...moved, saveRevision: 1, witness } }
    expect(await store.commit(left.proof, next)).toBe('committed')
    expect(await competitor.commit(right.proof, next)).toBe('revision-changed')
    expect((await createAtomicV27Store(factory).readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1,
        state: { player: { position: { x: 0.1 } } } } } })
    expect(await old.readChecked()).toMatchObject({ status: 'valid', root: roots.v26 })
  }, 30_000)

  it('blocks an extra database record and never treats a partial record as valid', async () => {
    const factory = new IDBFactory(), store = createAtomicV27Store(factory)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(PUBLIC_V27_DATABASE_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('records')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve) => {
      const tx = db.transaction('records', 'readwrite')
      tx.objectStore('records').put({ partial: true }, 'root')
      tx.oncomplete = () => resolve()
    })
    db.close()
    expect(await store.readChecked()).toEqual({ status: 'blocked', reason: 'invalid-v27-root' })
  })
})
