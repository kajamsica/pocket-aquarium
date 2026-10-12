import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV23Store } from './atomicV23Database'
import type { AtomicV23Root } from './atomicV23Database'
import { createPublicV23Root, replayPublicV23Transition } from './publicWorldV23Snapshot'
import type { PublicV23Head } from './publicWorldV23Snapshot'
import { applyPublicV23Witness } from './publicWorldV23Transitions'

const seed = 'greenway-alpha'
const genesis = (): AtomicV23Root => ({ ...createPublicV23Root(seed), previous: null })
const checkpoint = (before: AtomicV23Root): AtomicV23Root => ({
  lineage: structuredClone(before.lineage),
  previous: structuredClone(before.head),
  head: { ...structuredClone(before.head), saveRevision: before.head.saveRevision + 1,
    witness: { kind: 'checkpoint' } },
})
async function checked(store: ReturnType<typeof createAtomicV23Store>) {
  const read = await store.readChecked()
  if (read.status !== 'valid') throw new Error(`Expected valid V23 root, received ${read.status}`)
  return read
}
async function started() {
  const store = createAtomicV23Store(new IDBFactory())
  const empty = await store.readChecked()
  if (empty.status !== 'missing') throw new Error('Expected missing V23 root')
  expect(await store.commit(empty.proof, genesis())).toBe('committed')
  return store
}

describe('atomic V23 checked commit', () => {
  it('accepts a detached but exactly equal predecessor and persists one replayable checkpoint', async () => {
    const store = await started(), before = await checked(store), next = checkpoint(before.root)
    expect(next.previous).not.toBe(before.root.head)
    expect(next.previous).toEqual(before.root.head)
    expect(replayPublicV23Transition(next.previous!, next.head)).toBe(true)
    expect(await store.commit(before.proof, next)).toBe('committed')
    const saved = await checked(store)
    expect(saved.root).toEqual(next)
    expect(await store.commit(before.proof, next)).toBe('invalid')
  })

  it('rejects a forged transition despite an exact checked predecessor', async () => {
    const store = await started(), before = await checked(store), next = checkpoint(before.root)
    const head = structuredClone(next.head)
    head.state.player.coins += 1
    const forged = { ...next, head }
    expect(replayPublicV23Transition(forged.previous!, forged.head)).toBe(false)
    expect(await store.commit(before.proof, forged)).toBe('invalid')
    expect((await checked(store)).root).toEqual(before.root)
    expect(await store.commit(before.proof, checkpoint(before.root))).toBe('invalid')
  })

  it('rejects a valid but mismatched predecessor rather than applying an old transition', async () => {
    const store = await started(), first = await checked(store), revisionOne = checkpoint(first.root)
    expect(await store.commit(first.proof, revisionOne)).toBe('committed')
    const current = await checked(store)
    expect(replayPublicV23Transition(revisionOne.previous!, revisionOne.head)).toBe(true)
    expect(await store.commit(current.proof, revisionOne)).toBe('invalid')
    expect((await checked(store)).root).toEqual(revisionOne)
  })

  it('keeps same-transaction revision CAS for two checked proofs and consumes both once', async () => {
    const store = await started(), left = await checked(store), right = await checked(store)
    const next = checkpoint(left.root)
    expect((await Promise.all([store.commit(left.proof, next), store.commit(right.proof, next)])).sort())
      .toEqual(['committed', 'revision-changed'])
    expect(await store.commit(left.proof, next)).toBe('invalid')
    expect(await store.commit(right.proof, next)).toBe('invalid')
    expect((await checked(store)).root).toEqual(next)
  })

  it('rejects an altered frame witness at the atomic store and accepts the original transition', async () => {
    const store = await started(), before = await checked(store)
    const witness = { kind: 'frame-batch/v1' as const, frames: [
      { intents: [{ type: 'look' as const, yawDelta: -0.13, pitchDelta: 0 }], walkRequested: false }] }
    const { state, greenwayWorks, regionalWorks } = before.root.head
    const result = applyPublicV23Witness({ state, greenwayWorks, regionalWorks }, witness)
    if (!('progress' in result)) throw new Error(result.rejection)
    const head: PublicV23Head = { ...before.root.head, ...result.progress, saveRevision: 1, witness }
    const valid: AtomicV23Root = { lineage: before.root.lineage,
      previous: structuredClone(before.root.head), head }
    const altered: AtomicV23Root = { ...valid, head: { ...head, witness: {
      ...witness, frames: [{ ...witness.frames[0], intents: [
        { ...witness.frames[0].intents[0], yawDelta: 0.13 }] }] } } }
    expect(replayPublicV23Transition(altered.previous!, altered.head)).toBe(false)
    expect(await store.commit(before.proof, altered)).toBe('invalid')
    const retry = await checked(store)
    expect(retry.root).toEqual(before.root)
    expect(await store.commit(retry.proof, valid)).toBe('committed')
    expect((await checked(store)).root).toEqual(valid)
  })
})
