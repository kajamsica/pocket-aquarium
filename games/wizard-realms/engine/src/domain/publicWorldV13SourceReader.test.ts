import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV8Store } from './atomicV8Database'
import { createAtomicV9Store } from './atomicV9Database'
import { createAtomicV10Store } from './atomicV10Database'
import { createAtomicV11Store } from './atomicV11Database'
import { createAtomicV12Store } from './atomicV12Database'
import { DISCOVERY_MASK_BYTES } from './discoveryMask'
import { createFreshPublicWorld } from './publicWorldState'
import { PUBLIC_V7_ROOT_KEY, PUBLIC_V7_SCHEMA, PUBLIC_V7_STAGE_KEY,
  serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
import { migratePublicV7ToV8 } from './publicWorldV8Flow'
import { encodePublicV8Head } from './publicWorldV8Snapshot'
import { migratePublicV8ToV9 } from './publicWorldV9Flow'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { encodePublicV9Head } from './publicWorldV9Snapshot'
import { migratePublicV9ToV10 } from './publicWorldV10Flow'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { encodePublicV10Head } from './publicWorldV10Snapshot'
import { migratePublicV10ToV11 } from './publicWorldV11Flow'
import { withPublicV11Highland } from './publicWorldV11State'
import { encodePublicV11Head } from './publicWorldV11Snapshot'
import { commitPublicV12Snapshot, inspectPublicV12UnderLock,
  migratePublicV11ToV12 } from './publicWorldV12Flow'
import { decodePublicV12Head } from './publicWorldV12Snapshot'
import type { PublicV12Head } from './publicWorldV12Snapshot'
import { withPublicV12Windstep } from './publicWorldV12State'
import { createPublicV13SourceReader, resolvePublicV13SourceLease } from './publicWorldV13SourceReader'
import type { PublicV13SourceLease } from './publicWorldV13SourceReader'

async function fixture() {
  const factory = new FakeFactory()
  const base = withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'))
  const bytes = serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA, saveRevision: 4,
    bootstrap: null, migrationSourceV6Bytes: null, state: base })
  const values = new Map([[PUBLIC_V7_ROOT_KEY, bytes]])
  const storage = { getItem: (key: string) => values.get(key) ?? null }
  const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
    callback: () => Promise<T>) => callback() }
  const v8 = createAtomicV8Store(factory), v9 = createAtomicV9Store(factory)
  const v10 = createAtomicV10Store(factory), v11 = createAtomicV11Store(factory)
  const v12 = createAtomicV12Store(factory)
  expect((await migratePublicV7ToV8(storage, locks, v8, bytes)).ok).toBe(true)
  const r9 = { sourceV8Head: encodePublicV8Head(base, null, 0), sourceV7Bytes: bytes }
  const s9 = withFreshPublicV9Camps(base)
  expect((await migratePublicV8ToV9(storage, locks, v8, v9, r9)).ok).toBe(true)
  const r10 = { sourceV9Head: encodePublicV9Head(s9, null, 0), sourceV9Lineage: r9 }
  const s10 = withPublicV10TerrainRevision(s9)
  expect((await migratePublicV9ToV10(storage, locks, v8, v9, v10, r10)).ok).toBe(true)
  const r11 = { sourceV10Head: encodePublicV10Head(s10, null, 0), sourceV10Lineage: r10 }
  const s11 = withPublicV11Highland(s10)
  expect((await migratePublicV10ToV11(storage, locks, v8, v9, v10, v11, r11)).ok).toBe(true)
  const r12 = { sourceV11Head: encodePublicV11Head(s11, null, 0), sourceV11Receipt: r11 }
  const s12 = withPublicV12Windstep(s11)
  const reader = createPublicV13SourceReader(factory, storage, v8, v9, v10, v11, v12)
  return { factory, values, storage, locks, v8, v9, v10, v11, v12, reader, r12, s12 }
}
async function put(factory: IDBFactory, name: string, key: string, value: unknown) {
  const request = factory.open(name, 1)
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const transaction = db.transaction('records', 'readwrite')
  transaction.objectStore('records').put(value, key)
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
  })
  db.close()
}

const v12Name = 'wizard-realms:world:v12'
const inspect = async (f: Awaited<ReturnType<typeof fixture>>) => {
  const result = await f.reader.readUnderLock()
  return result.ok ? result.value : { status: 'error', reason: result.reason }
}
async function migrate(f: Awaited<ReturnType<typeof fixture>>) {
  expect((await migratePublicV11ToV12(f.storage, f.locks, f.v8, f.v9, f.v10,
    f.v11, f.v12, f.r12)).ok).toBe(true)
}
describe('unmounted v13 checked source reader', () => {
  it('selects direct v11 without creating v12, and fails closed without a presence API', async () => {
    const f = await fixture()
    expect((await f.factory.databases()).some((db) => db.name === v12Name)).toBe(false)
    const selected = await f.reader.readUnderLock()
    expect(selected.ok && selected.value.status).toBe('v11')
    expect((await f.factory.databases()).some((db) => db.name === v12Name)).toBe(false)
    const unavailable = createPublicV13SourceReader({ databases: undefined } as unknown as IDBFactory,
      f.storage, f.v8, f.v9, f.v10, f.v11, f.v12)
    expect(await unavailable.readUnderLock()).toEqual({ ok: false, reason: 'storage-error' })
  })

  it('matches old rev0/revN classification, returns detached heads and never redecodes on hot reads', async () => {
    const f = await fixture()
    await migrate(f)
    const checked = vi.spyOn(f.v12, 'readChecked')
    const old = await inspectPublicV12UnderLock(f.storage, f.v8, f.v9, f.v10, f.v11, f.v12)
    expect(old.ok && old.value.status).toBe('valid')
    const first = await f.reader.readUnderLock()
    expect(first.ok && first.value.status).toBe('v12')
    if (!first.ok || first.value.status !== 'v12') return
    if (old.ok && old.value.status === 'valid')
      expect(decodePublicV12Head(first.value.head)?.state).toEqual(old.value.start.state)
    const firstMask = first.value.head.state.discoveryMask
    firstMask[0] ^= 1
    expect(f.reader.takeProof(first.value.proof)).toBe(false)
    expect(f.reader.takeProof(first.value.proof)).toBe(false)
    const calls = checked.mock.calls.length
    const hot = await f.reader.readUnderLock()
    expect(hot.ok && hot.value.status).toBe('v12')
    expect(checked).toHaveBeenCalledTimes(calls)
    expect(f.reader.takeProof(first.value.proof)).toBe(false)
    if (hot.ok && hot.value.status === 'v12') {
      expect(hot.value.head.state.discoveryMask[0]).not.toBe(firstMask[0])
      expect(f.reader.takeProof(hot.value.proof)).toBe(true)
    }
    expect((await commitPublicV12Snapshot(f.storage, f.locks, f.v8, f.v9, f.v10,
      f.v11, f.v12, f.s12, 0, f.r12)).ok).toBe(true)
    const revised = await f.reader.readUnderLock()
    expect(revised.ok && revised.value.status === 'v12' && revised.value.head.saveRevision).toBe(1)
    const oldRevised = await inspectPublicV12UnderLock(f.storage, f.v8, f.v9, f.v10, f.v11, f.v12)
    expect(oldRevised.ok && oldRevised.value.status).toBe('valid')
    if (revised.ok && revised.value.status === 'v12'
      && oldRevised.ok && oldRevised.value.status === 'valid')
      expect(decodePublicV12Head(revised.value.head)?.state).toEqual(oldRevised.value.start.state)
    const revisedCalls = checked.mock.calls.length
    expect((await inspect(f)).status).toBe('v12')
    expect(checked).toHaveBeenCalledTimes(revisedCalls)
    checked.mockRestore()
  })

  it('blocks partial, unknown and corrupt v12 instead of falling back to valid v11', async () => {
    const f = await fixture()
    await put(f.factory, v12Name, 'previous', { saveRevision: 0, value: {} })
    expect(await f.reader.readUnderLock()).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v12-head' } })
    const g = await fixture()
    await migrate(g)
    await put(g.factory, v12Name, 'head', { hidden: true })
    expect(await g.reader.readUnderLock()).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v12-head' } })
    await put(g.factory, v12Name, 'unknown', true)
    expect(await g.reader.readUnderLock()).toEqual({ ok: false, reason: 'storage-error' })
  })

  it('invalidates on late v12, old source drift, artifact text and exact mask-byte drift', async () => {
    const f = await fixture()
    expect((await f.reader.readUnderLock()).ok).toBe(true)
    await migrate(f)
    expect((await inspect(f)).status).toBe('v12')
    const raw = await f.v12.read()
    if (raw.status !== 'ok' || !raw.head) throw new Error('missing v12 head')
    const changed = structuredClone(raw.head) as { saveRevision: number; value: PublicV12Head }
    changed.value.state.discoveryMask[DISCOVERY_MASK_BYTES - 1] ^= 0x80
    await put(f.factory, v12Name, 'head', changed)
    expect(await inspect(f)).toEqual({ status: 'blocked', reason: 'invalid-v12-lineage' })
    const g = await fixture()
    await migrate(g)
    expect((await inspect(g)).status).toBe('v12')
    g.values.set(PUBLIC_V7_STAGE_KEY, 'bad')
    expect(await inspect(g)).toEqual({ status: 'blocked', reason: 'pending-v7-stage' })
    for (const version of [8, 9, 10] as const) {
      const h = await fixture()
      await migrate(h)
      expect((await inspect(h)).status).toBe('v12')
      await put(h.factory, `wizard-realms:world:v${version}`, 'head', { hidden: true })
      expect(await inspect(h)).toEqual({ status: 'blocked',
        reason: `invalid-v${version}-head` })
    }
  })

  it('uses the old oracle for an accepted oversized mask backing, without retaining that backing', async () => {
    const f = await fixture()
    await migrate(f)
    const raw = await f.v12.read()
    if (raw.status !== 'ok' || !raw.head) throw new Error('missing v12 head')
    const head = structuredClone(raw.head) as { saveRevision: number; value: PublicV12Head }
    const large = new Uint8Array(new ArrayBuffer(5 * 1024 * 1024), 0, DISCOVERY_MASK_BYTES)
    large.set(head.value.state.discoveryMask)
    head.value = { ...head.value, state: { ...head.value.state, discoveryMask: large } }
    await put(f.factory, v12Name, 'head', head)
    const checked = vi.spyOn(f.v12, 'readChecked')
    for (let repeat = 0; repeat < 2; repeat++) {
      const result = await f.reader.readUnderLock()
      expect(result.ok && result.value.status).toBe('v12')
      if (result.ok && result.value.status === 'v12') {
        expect(result.value.head.state.discoveryMask.buffer.byteLength).toBe(DISCOVERY_MASK_BYTES)
      }
    }
    expect(checked).toHaveBeenCalledTimes(2)
    checked.mockRestore()
  })

  it('rejects an overlapping read without letting it mint or overwrite the first proof', async () => {
    const f = await fixture()
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    let firstProbe = true
    const factory = { databases: async () => {
      if (firstProbe) { firstProbe = false; entered(); await gate }
      return f.factory.databases()
    } } as IDBFactory
    const reader = createPublicV13SourceReader(factory, f.storage,
      f.v8, f.v9, f.v10, f.v11, f.v12)
    const pending = reader.readUnderLock()
    await started
    expect(await reader.readUnderLock()).toEqual({ ok: false, reason: 'storage-error' })
    release()
    const result = await pending
    expect(result.ok && result.value.status).toBe('v11')
    if (result.ok && result.value.status === 'v11') expect(reader.takeProof(result.value.proof)).toBe(true)
  })

  it('rejects a nonenumerable nested key added after a checked read', async () => {
    const f = await fixture()
    await migrate(f)
    const result = await f.reader.readUnderLock()
    expect(result.ok && result.value.status).toBe('v12')
    if (!result.ok || result.value.status !== 'v12') return
    Object.defineProperty(result.value.head.state.player, 'hidden', { value: true })
    expect(f.reader.takeProof(result.value.proof)).toBe(false)
    expect(f.reader.takeProof(result.value.proof)).toBe(false)
  })

  it('consumes a v11 proof into a detached, unforgeable and revocable head-only lease', async () => {
    const f = await fixture()
    const result = await f.reader.readUnderLock()
    expect(result.ok && result.value.status).toBe('v11')
    if (!result.ok || result.value.status !== 'v11') return
    const lease = f.reader.consumeProof(result.value.proof)
    expect(lease).not.toBeNull()
    expect(f.reader.consumeProof(result.value.proof)).toBeNull()
    expect(f.reader.takeProof(result.value.proof)).toBe(false)
    const pair = resolvePublicV13SourceLease(lease!)
    expect(pair?.sourceSchemaVersion).toBe('wizard-world/v11')
    expect(pair?.sourceHead).toEqual(result.value.head)
    const acceptedMaskByte = pair!.sourceHead.state.discoveryMask[0]
    result.value.head.state.discoveryMask[0] ^= 1
    expect(resolvePublicV13SourceLease(lease!)?.sourceHead.state.discoveryMask[0])
      .toBe(acceptedMaskByte)
    pair!.sourceHead.state.discoveryMask[0] ^= 1
    expect(resolvePublicV13SourceLease(lease!)?.sourceHead.state.discoveryMask[0])
      .not.toBe(pair!.sourceHead.state.discoveryMask[0])
    expect(resolvePublicV13SourceLease({} as PublicV13SourceLease)).toBeNull()
    expect(resolvePublicV13SourceLease(structuredClone(lease!) as PublicV13SourceLease)).toBeNull()
    f.reader.revoke(lease!)
    expect(resolvePublicV13SourceLease(lease!)).toBeNull()
  })

  it('rejects mutated heads and expires v12 leases after another source read', async () => {
    const f = await fixture()
    await migrate(f)
    const first = await f.reader.readUnderLock()
    expect(first.ok && first.value.status).toBe('v12')
    if (!first.ok || first.value.status !== 'v12') return
    first.value.head.state.discoveryMask[0] ^= 1
    expect(f.reader.consumeProof(first.value.proof)).toBeNull()
    const hidden = await f.reader.readUnderLock()
    if (!hidden.ok || hidden.value.status !== 'v12') throw new Error('Missing v12 source')
    Object.defineProperty(hidden.value.head.state.player, 'hidden', { value: true })
    expect(f.reader.consumeProof(hidden.value.proof)).toBeNull()
    const checked = await f.reader.readUnderLock()
    if (!checked.ok || checked.value.status !== 'v12') throw new Error('Missing v12 source')
    const lease = f.reader.consumeProof(checked.value.proof)
    expect(resolvePublicV13SourceLease(lease!)?.sourceSchemaVersion).toBe('wizard-world/v12')
    expect((await f.reader.readUnderLock()).ok).toBe(true)
    expect(resolvePublicV13SourceLease(lease!)).toBeNull()
  })

  it('consumes a proof on an uncloneable returned head and invalidates a lease on source drift', async () => {
    const f = await fixture()
    const altered = await f.reader.readUnderLock()
    if (!altered.ok || altered.value.status !== 'v11') throw new Error('Missing v11 source')
    Object.defineProperty(altered.value.head.state, 'player', {
      value: new Proxy(altered.value.head.state.player, {}) })
    expect(f.reader.consumeProof(altered.value.proof)).toBeNull()
    expect(f.reader.consumeProof(altered.value.proof)).toBeNull()
    const valid = await f.reader.readUnderLock()
    if (!valid.ok || valid.value.status !== 'v11') throw new Error('Missing v11 source')
    const lease = f.reader.consumeProof(valid.value.proof)!
    f.values.set(PUBLIC_V7_STAGE_KEY, 'bad')
    expect((await inspect(f)).status).toBe('blocked')
    expect(resolvePublicV13SourceLease(lease)).toBeNull()
  })

  it('rejects an extra nested mask before cloning a returned head', async () => {
    const f = await fixture()
    await migrate(f)
    const checked = await f.reader.readUnderLock()
    if (!checked.ok || checked.value.status !== 'v12') throw new Error('Missing v12 source')
    Object.defineProperty(checked.value.head.state, 'extraMask', {
      value: new Uint8Array(DISCOVERY_MASK_BYTES), enumerable: true })
    const clone = vi.spyOn(globalThis, 'structuredClone')
    try {
      expect(f.reader.consumeProof(checked.value.proof)).toBeNull()
      expect(clone).not.toHaveBeenCalled()
    } finally { clone.mockRestore() }
  })

  it('rejects a changed hot raw slot before cloning its extra nested mask', async () => {
    const f = await fixture()
    await migrate(f)
    expect((await inspect(f)).status).toBe('v12')
    const raw = await f.v12.read()
    if (raw.status !== 'ok' || !raw.head) throw new Error('Missing v12 head')
    Object.defineProperty((raw.head as { value: PublicV12Head }).value.state, 'extraMask', {
      value: new Uint8Array(DISCOVERY_MASK_BYTES), enumerable: true })
    const read = vi.spyOn(f.v12, 'read').mockResolvedValue(raw)
    const checked = vi.spyOn(f.v12, 'readChecked').mockResolvedValue({ status: 'storage-error' })
    const clone = vi.spyOn(globalThis, 'structuredClone')
    try {
      expect(await f.reader.readUnderLock()).toEqual({ ok: false, reason: 'storage-error' })
      expect(checked).toHaveBeenCalledOnce()
      expect(clone).not.toHaveBeenCalled()
    } finally { clone.mockRestore(); checked.mockRestore(); read.mockRestore() }
  })
})
