import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV24Store } from './atomicV24Database'
import { createAtomicV25Store } from './atomicV25Database'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { PUBLIC_V25_DATABASE_NAME } from './publicWorldV25Migration'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import type { PublicV25Root } from './publicWorldV25Snapshot'

const oldRoot = () => createPublicV24Root(createPublicV23Root('wizard-realms'))
const genesis = () => {
  const { head, lineage } = oldRoot()
  return createPublicV25Root({ head, lineage })
}
const checkpoint = (before: PublicV25Root): PublicV25Root => ({ lineage: structuredClone(before.lineage),
  previous: structuredClone(before.head), head: { ...structuredClone(before.head),
    saveRevision: before.head.saveRevision + 1, witness: { kind: 'checkpoint' } } })
async function valid(store: ReturnType<typeof createAtomicV25Store>, onPhase?: (sample: { phase: string }) => void) {
  const read = await store.readChecked(onPhase)
  if (read.status !== 'valid') throw new Error(`Expected valid V25 root, got ${read.status}`)
  return read
}
async function started(factory = new IDBFactory()) {
  const store = createAtomicV25Store(factory), missing = await store.readChecked()
  if (missing.status !== 'missing') throw new Error('Expected missing V25 root')
  expect(await store.commit(missing.proof, genesis())).toBe('committed')
  return store
}
async function putRaw(factory: IDBFactory, key: string, value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(PUBLIC_V25_DATABASE_NAME, 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve) => {
    const tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').put(value, key)
    tx.oncomplete = () => resolve()
  })
  db.close()
}

describe('atomic V25 root', () => {
  it('isolates genesis and revision writes from the V24 database, including a fresh reader', async () => {
    const factory = new IDBFactory(), old = createAtomicV24Store(factory)
    const oldMissing = await old.readChecked()
    if (oldMissing.status !== 'missing') throw new Error('Expected missing V24 root')
    const oldSaved = oldRoot()
    expect(await old.commit(oldMissing.proof, oldSaved)).toBe('committed')
    const store = createAtomicV25Store(factory), missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected missing V25 root')
    expect(await store.commit(missing.proof, genesis())).toBe('committed')
    const first = await valid(store), next = checkpoint(first.root)
    expect(await store.commit(first.proof, next)).toBe('committed')
    expect((await valid(createAtomicV25Store(factory))).root).toEqual(next)
    expect(await old.readChecked()).toMatchObject({ status: 'valid', root: oldSaved })
  })

  it('consumes proofs, rejects forged roots, and resolves competing CAS writes', async () => {
    const store = await started(), left = await valid(store), right = await valid(store)
    const next = checkpoint(left.root), forged = structuredClone(next)
    forged.head.state.player.coins++
    expect(await store.commit({}, next)).toBe('invalid')
    expect(await store.commit(left.proof, forged)).toBe('invalid')
    expect(await store.commit(left.proof, next)).toBe('invalid')
    const retry = await valid(store)
    expect((await Promise.all([store.commit(retry.proof, next),
      store.commit(right.proof, next)])).sort()).toEqual(['committed', 'revision-changed'])
    const later = await valid(store)
    expect(await store.commit(later.proof, next)).toBe('invalid')
  })

  it('rejects extra candidate keys, partial records, and warm-cache raw tampering', async () => {
    const factory = new IDBFactory(), store = createAtomicV25Store(factory)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected missing V25 root')
    expect(await store.commit(missing.proof, { ...genesis(), extra: true } as never)).toBe('invalid')
    await putRaw(factory, 'stray', { stray: true })
    expect(await store.readChecked()).toEqual({ status: 'blocked', reason: 'invalid-v25-root' })
    const cleanFactory = new IDBFactory(), clean = await started(cleanFactory), hits: string[] = []
    const note = (sample: { phase: string }) => hits.push(sample.phase)
    const saved = await valid(clean, note)
    expect(hits).toContain('v25-validated-cache-hit')
    saved.root.head.state.player.coins++
    expect((await valid(createAtomicV25Store(cleanFactory))).root).toEqual(genesis())
    await putRaw(cleanFactory, 'root', { ...genesis(), extra: true })
    expect(await clean.readChecked()).toEqual({ status: 'blocked', reason: 'invalid-v25-root' })
  })

  it('waits for transaction completion and reports an aborted write as storage failure', async () => {
    const factory = new IDBFactory(), store = createAtomicV25Store(factory)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected missing V25 root')
    const original = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args) {
      const request = original.apply(this, args)
      if (this.transaction.db.name === PUBLIC_V25_DATABASE_NAME) this.transaction.abort()
      return request
    })
    try { expect(await store.commit(missing.proof, genesis())).toBe('storage-error') }
    finally { spy.mockRestore() }
    expect((await store.readChecked()).status).toBe('missing')
  })
})
