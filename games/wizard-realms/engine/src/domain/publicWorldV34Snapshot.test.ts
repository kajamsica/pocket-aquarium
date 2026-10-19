import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import { createPublicV26Root } from './publicWorldV26Snapshot'
import { createPublicV27Root } from './publicWorldV27Snapshot'
import { createPublicV28Root } from './publicWorldV28Snapshot'
import { createPublicV29Root } from './publicWorldV29Snapshot'
import { createPublicV30Root } from './publicWorldV30Snapshot'
import { createPublicV31Root } from './publicWorldV31Snapshot'
import { createPublicV32Root } from './publicWorldV32Snapshot'
import { createPublicV33Root, replayPublicV33Witness } from './publicWorldV33Snapshot'
import { createAtomicV34Store } from './atomicV34Database'
import { createPublicV34Root, decodePublicV34CheckedSuccessor,
  decodePublicV34Root } from './publicWorldV34Snapshot'
import type { PublicV34Root } from './publicWorldV34Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

const seed = 'wizard-realms'
let genesis: PublicV34Root
const successor = (before: PublicV34Root): PublicV34Root => ({
  lineage: before.lineage, previous: before.head,
  head: { ...before.head, saveRevision: before.head.saveRevision + 1,
    witness: { kind: 'checkpoint' } },
})
const frameSuccessor = (before: PublicV34Root): PublicV34Root => {
  const witness = { kind: 'frame-batch/v1' as const, frames: [{
    intents: [{ type: 'look' as const, yawDelta: 0.01, pitchDelta: 0 }],
    walkRequested: false }] }
  const progress = replayPublicV33Witness(before.head, witness)
  if (!progress) throw Error('Expected a replayable frame fixture')
  return { lineage: before.lineage, previous: before.head,
    head: { ...before.head, ...progress, saveRevision: before.head.saveRevision + 1,
      witness } }
}

beforeAll(() => {
  const v23 = createPublicV23Root(seed), v24 = createPublicV24Root(v23)
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
  const v31 = createPublicV31Root(v30), v32 = createPublicV32Root(v31)
  genesis = createPublicV34Root(createPublicV33Root(v32).head)
}, 120_000)

async function putRaw(factory: IDBFactory, name: string, key: string, value: unknown) {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('records', 'readwrite')
      tx.objectStore('records').put(value, key)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onabort = () => { db.close(); reject(tx.error) }
    }
  })
}

function objectGraph(value: unknown): WeakSet<object> {
  const seen = new WeakSet<object>()
  const visit = (item: unknown) => {
    if (item === null || typeof item !== 'object' || seen.has(item)) return
    seen.add(item)
    if (ArrayBuffer.isView(item)) visit(item.buffer)
    for (const key of Reflect.ownKeys(item)) {
      const field = Object.getOwnPropertyDescriptor(item, key)
      if (field && 'value' in field) visit(field.value)
    }
  }
  visit(value)
  return seen
}

describe('V34 compact checked root', () => {
  it('decodes an owned graph with no references into the raw record', () => {
    for (const source of [genesis, successor(genesis), successor(successor(genesis))]) {
      const raw = structuredClone(source), decoded = decodePublicV34Root(raw)!
      const rawObjects = objectGraph(raw)
      const visit = (item: unknown, seen = new WeakSet<object>()): boolean => {
        if (item === null || typeof item !== 'object' || seen.has(item)) return false
        seen.add(item)
        if (rawObjects.has(item)) return true
        if (ArrayBuffer.isView(item) && visit(item.buffer, seen)) return true
        return Reflect.ownKeys(item).some((key) => {
          const field = Object.getOwnPropertyDescriptor(item, key)
          return field && 'value' in field && visit(field.value, seen)
        })
      }
      expect(decoded).not.toBeNull()
      expect(visit(decoded)).toBe(false)
    }
  }, 120_000)

  it('accepts genesis and two replayed successors without legacy lineage', () => {
    expect(Object.keys(genesis.lineage)).toEqual(expect.arrayContaining([
      'origin', 'seed', 'rulesProfile', 'sourceRevision', 'genesis']))
    expect('sourceReceipt' in genesis.lineage).toBe(false)
    expect(decodePublicV34Root(genesis)).toEqual(genesis)
    const first = successor(genesis), second = successor(first)
    expect(decodePublicV34CheckedSuccessor(genesis, first)).toEqual(first)
    expect(decodePublicV34Root(first)).toEqual(first)
    expect(decodePublicV34CheckedSuccessor(first, second)).toEqual(second)
    expect(decodePublicV34Root(second)).toEqual(second)
  }, 120_000)

  it('matches full decoding for checked frame and non-frame successors at revisions one and two', () => {
    const checkpointFirst = successor(genesis), frameFirst = frameSuccessor(genesis)
    for (const [before, candidate] of [
      [genesis, checkpointFirst], [checkpointFirst, frameSuccessor(checkpointFirst)],
      [genesis, frameFirst], [frameFirst, successor(frameFirst)],
    ] as const) {
      const full = decodePublicV34Root(candidate)
      expect(full).not.toBeNull()
      expect(decodePublicV34CheckedSuccessor(before, candidate)).toEqual(full)
    }
  }, 120_000)

  it('falls back to full semantic decoding for an unchanged nonextensible lineage', () => {
    const candidate = structuredClone(frameSuccessor(genesis))
    Object.preventExtensions(candidate.lineage)
    expect(sameStrictBoundedRaw([candidate.lineage, candidate.previous],
      [genesis.lineage, genesis.head], 3 << 20)).toBe(false)
    const full = decodePublicV34Root(candidate)
    expect(full).not.toBeNull()
    expect(decodePublicV34CheckedSuccessor(genesis, candidate)).toEqual(full)
    const source = structuredClone(frameSuccessor(genesis))
    const aliased = { ...source, previous: { ...source.previous!,
      state: source.lineage.genesis.state } }
    expect(sameStrictBoundedRaw([aliased.lineage, aliased.previous],
      [genesis.lineage, genesis.head], 3 << 20)).toBe(false)
    expect(decodePublicV34CheckedSuccessor(genesis, aliased))
      .toEqual(decodePublicV34Root(aliased))
  }, 120_000)

  it('rejects forged checked successors and does not retain caller-owned head fields', () => {
    const valid = frameSuccessor(genesis)
    const changedState = { ...valid.head.state, player: { ...valid.head.state.player,
      coins: valid.head.state.player.coins + 1 } }
    for (const forged of [
      { ...valid, lineage: { ...valid.lineage,
        sourceRevision: valid.lineage.sourceRevision + 1 } },
      { ...valid, previous: { ...valid.previous!, state: changedState } },
      { ...valid, head: { ...valid.head, state: changedState } },
      { ...valid, head: { ...valid.head, witness: { kind: 'checkpoint' } } },
      { ...valid, head: { ...valid.head, saveRevision: 2 } },
    ]) expect(decodePublicV34CheckedSuccessor(genesis, forged)).toBeNull()
    const caller = structuredClone(valid)
    const checked = decodePublicV34CheckedSuccessor(genesis, caller)
    expect(checked).not.toBeNull()
    caller.head.state.player.coins += 1
    expect(checked!.head.state.player.coins).toBe(genesis.head.state.player.coins)
  }, 120_000)

  it('does not trust malformed proxy, accessor, cycle or aliased predecessors', () => {
    const valid = frameSuccessor(genesis)
    const accessor = { ...valid }
    Object.defineProperty(accessor, 'previous', { enumerable: true,
      get: () => valid.previous })
    const cyclic: Record<string, unknown> = { ...valid }
    cyclic.previous = cyclic
    const alias = { ...valid, previous: valid.head }
    const proxy = new Proxy(valid, { get(target, key) {
      if (key === 'lineage') throw Error('untrusted proxy')
      return Reflect.get(target, key)
    } })
    for (const malformed of [accessor, cyclic, alias, proxy])
      expect(decodePublicV34CheckedSuccessor(genesis, malformed)).toBeNull()
  }, 120_000)

  it('rejects baseline, head, witness, prior slot and envelope forgeries', () => {
    const first = successor(genesis)
    const changed = { ...genesis.head.state, player: { ...genesis.head.state.player,
      coins: genesis.head.state.player.coins + 1 } }
    expect(decodePublicV34Root({ ...genesis, head: { ...genesis.head,
      state: changed } })).toBeNull()
    expect(decodePublicV34Root({ ...first, lineage: { ...first.lineage,
      genesis: { ...first.lineage.genesis, state: changed } } })).toBeNull()
    expect(decodePublicV34Root({ ...first, previous: { ...first.previous,
      state: changed } })).toBeNull()
    expect(decodePublicV34Root({ ...first, head: { ...first.head,
      state: changed } })).toBeNull()
    expect(decodePublicV34Root({ ...first, head: { ...first.head,
      witness: { kind: 'not-an-action' } } })).toBeNull()
    expect(decodePublicV34Root({ ...first, extra: true })).toBeNull()
    for (const lineage of [
      { ...first.lineage, sourceRevision: -1 },
      { ...first.lineage, seed: 'other' },
      { ...first.lineage, rulesProfile: 'other' },
    ]) expect(decodePublicV34Root({ ...first, lineage })).toBeNull()
    expect(decodePublicV34Root({ ...first, head: { ...first.head,
      schemaVersion: 'wizard-world/v33' } })).toBeNull()
  }, 120_000)
})

describe('V34 one-record atomic store', () => {
  it('keeps the proof baseline private when the returned root is mutated', async () => {
    const store = createAtomicV34Store(new IDBFactory(), 'v34-private-proof')
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Expected empty target')
    expect(await store.commit(missing.proof, genesis)).toBe('committed')
    const read = await store.readChecked()
    if (read.status !== 'valid') throw Error('Expected checked target')
    const untouched = structuredClone(read.root)
    read.root.head.state.player.coins += 11
    read.root.lineage.genesis.state.player.coins += 7
    expect(await store.commit(read.proof, successor(untouched))).toBe('committed')
    const nextRead = await store.readChecked()
    if (nextRead.status !== 'valid') throw Error('Expected checked successor')
    const next = successor(nextRead.root)
    const forged = { ...next, head: { ...next.head, state: { ...next.head.state,
      player: { ...next.head.state.player, coins: next.head.state.player.coins + 1 } } } }
    expect(await store.commit(nextRead.proof, forged)).toBe('invalid')
    expect(await store.readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1 } } })
  }, 120_000)

  it('uses one-use proofs, copies caller data, and detects stale revisions', async () => {
    const factory = new IDBFactory(), store = createAtomicV34Store(factory, 'v34-cas')
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Expected empty target')
    expect(await store.commit(missing.proof, genesis)).toBe('committed')
    expect(await store.commit(missing.proof, genesis)).toBe('invalid')
    const stale = await store.readChecked(), fresh = await store.readChecked()
    if (stale.status !== 'valid' || fresh.status !== 'valid') throw Error('Expected valid target')
    const next = successor(fresh.root)
    const writing = store.commit(fresh.proof, next)
    next.head.state.player.coins += 999
    expect(await writing).toBe('committed')
    expect(await store.commit(stale.proof, successor(stale.root))).toBe('revision-changed')
    const saved = await store.readChecked()
    expect(saved.status).toBe('valid')
    if (saved.status !== 'valid') throw Error('Expected saved target')
    expect(saved.root.head.saveRevision).toBe(1)
    expect(saved.root.head.state.player.coins).toBe(genesis.head.state.player.coins)
    saved.root.head.state.player.coins += 1
    const readAgain = await store.readChecked()
    expect(readAgain.status === 'valid' && readAgain.root.head.state.player.coins)
      .toBe(genesis.head.state.player.coins)
    if (readAgain.status !== 'valid') throw Error('Expected unchanged target')
    expect(await store.commit(readAgain.proof, successor(readAgain.root))).toBe('committed')
    expect(await store.readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 2 } } })
  }, 120_000)

  it('blocks partial, extra-key and malformed records', async () => {
    for (const [name, key, value] of [
      ['v34-partial', 'partial', genesis],
      ['v34-malformed', 'root', { ...genesis, head: { ...genesis.head,
        schemaVersion: 'wizard-world/v33' } }],
    ] as const) {
      const factory = new IDBFactory(), store = createAtomicV34Store(factory, name)
      await putRaw(factory, name, key, value)
      expect(await store.readChecked()).toMatchObject({ status: 'blocked' })
    }
    const factory = new IDBFactory(), name = 'v34-extra'
    await putRaw(factory, name, 'root', genesis)
    await putRaw(factory, name, 'extra', 1)
    expect(await createAtomicV34Store(factory, name).readChecked())
      .toMatchObject({ status: 'blocked' })
  }, 120_000)

  it('rejects forged successors and leaves a record intact on transaction abort', async () => {
    const factory = new IDBFactory(), store = createAtomicV34Store(factory, 'v34-abort')
    const empty = await store.readChecked()
    if (empty.status !== 'missing') throw Error('Expected missing target')
    expect(await store.commit(empty.proof, genesis)).toBe('committed')
    const read = await store.readChecked()
    if (read.status !== 'valid') throw Error('Expected valid target')
    expect(await store.commit(read.proof, { ...successor(read.root),
      lineage: { ...read.root.lineage, sourceRevision: read.root.lineage.sourceRevision + 1 } }))
      .toBe('invalid')
    const retry = await store.readChecked()
    if (retry.status !== 'valid') throw Error('Expected valid target')
    const originalPut = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore, ...args) {
      if (args[1] === 'root') throw Error('forced abort')
      return originalPut.apply(this, args)
    })
    try { expect(await store.commit(retry.proof, successor(retry.root))).toBe('storage-error') }
    finally { spy.mockRestore() }
    expect(await store.readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0 } } })
  }, 120_000)
})
