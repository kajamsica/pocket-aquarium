import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectPublicV29UnderLock } from './publicWorldV29Flow'
import { createFreshPublicV17Head } from './publicWorldV17Snapshot'
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
import { inspectPublicV33, withLockedCheckedPublicV33SourceRaw } from './publicWorldV33Flow'

vi.mock('./publicWorldV29Flow', () => ({ inspectPublicV29UnderLock: vi.fn() }))

type Args = Parameters<typeof inspectPublicV33>
const valid = (root: unknown) => ({ status: 'valid' as const, root, proof: {} })

function chain() {
  const start = { head: { state: { seed: 'wizard-realms' } },
    lineage: { seed: 'wizard-realms' } }
  const v30 = { lineage: { sourceReceipt: structuredClone(start) },
    head: { state: { seed: 'wizard-realms' } } }
  const v31 = { lineage: { sourceReceipt: structuredClone(v30) },
    head: { state: { seed: 'wizard-realms' } } }
  const v32 = { lineage: { sourceReceipt: structuredClone(v31) },
    head: { state: { seed: 'wizard-realms' } }, previous: null }
  const target = { lineage: { sourceReceipt: structuredClone(v32) },
    head: { saveRevision: 0 }, previous: null }
  vi.mocked(inspectPublicV29UnderLock).mockResolvedValue({ status: 'valid',
    start, target: valid({}) } as never)
  const reads = {
    target: vi.fn(async () => valid(target)), v30: vi.fn(async () => valid(v30)),
    v31: vi.fn(async () => valid(v31)), v32: vi.fn(async () => valid(v32)),
  }
  const store = (readChecked: unknown) => ({ readChecked })
  const unused = {} as never
  const inspect = () => inspectPublicV33({ request: async (_name, _options, body) => body() },
    store(reads.target) as Args[1], store(reads.v32) as Args[2],
    store(reads.v31) as Args[3], store(reads.v30) as Args[4],
    unused, unused, unused, unused, unused, unused, unused, unused)
  return { start, v30, v31, v32, target, reads, inspect }
}

describe('V33 adjacent checked-source comparisons', () => {
  beforeEach(() => vi.mocked(inspectPublicV29UnderLock).mockReset())

  it('reads target first, then validates ancestry toward V32', async () => {
    const f = chain()
    expect(await f.inspect()).toMatchObject({ ok: true, value: { status: 'valid' } })
    const order = [f.reads.target, vi.mocked(inspectPublicV29UnderLock),
      f.reads.v30, f.reads.v31, f.reads.v32]
    for (let index = 1; index < order.length; index++)
      expect(order[index - 1].mock.invocationCallOrder[0])
        .toBeLessThan(order[index].mock.invocationCallOrder[0])
  })

  it('retains target, V32, V31, V30, ancestor blocked priority', async () => {
    const f = chain()
    vi.mocked(inspectPublicV29UnderLock).mockResolvedValue({ status: 'blocked',
      reason: 'older' } as never)
    f.reads.v30.mockResolvedValue({ status: 'blocked', reason: 'middle' } as never)
    f.reads.v31.mockResolvedValue({ status: 'blocked', reason: 'newer' } as never)
    f.reads.v32.mockResolvedValue({ status: 'blocked', reason: 'newest' } as never)
    expect(await f.inspect()).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-newest' } })
    f.reads.target.mockResolvedValue({ status: 'blocked', reason: 'target' } as never)
    expect(await f.inspect()).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'target' } })
  })

  it('preserves each exact edge and the final pinned V32 source', async () => {
    const f = chain()
    expect(await f.inspect()).toMatchObject({ ok: true, value: { status: 'valid' } })
    f.reads.v30.mockResolvedValue(valid({ ...f.v30, lineage: { sourceReceipt:
      { ...f.start, head: { state: { seed: 'swapped' } } } } }))
    expect(await f.inspect()).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-v30-source-changed' } })
    f.reads.v30.mockResolvedValue(valid(f.v30))
    f.reads.v31.mockResolvedValue(valid({ ...f.v31, lineage: { sourceReceipt:
      { ...f.v30, head: { state: { seed: 'swapped' } } } } }))
    expect(await f.inspect()).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-v31-source-changed' } })
    f.reads.v31.mockResolvedValue(valid(f.v31))
    f.reads.v32.mockResolvedValue(valid({ ...f.v32, lineage: { sourceReceipt:
      { ...f.v31, head: { state: { seed: 'swapped' } } } } }))
    expect(await f.inspect()).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-v32-source-changed' } })
    f.reads.v32.mockResolvedValue(valid(f.v32))
    f.reads.target.mockResolvedValue(valid({ ...f.target, lineage: { sourceReceipt:
      { ...f.v32, head: { state: { seed: 'swapped' } } } } }))
    expect(await f.inspect()).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-changed' } })
  })
})

function checkedRawChain() {
  const seed = 'wizard-realms', v17 = createFreshPublicV17Head(seed)
  const v23 = createPublicV23Root(seed, { state: v17.head.state,
    greenwayWorks: v17.head.greenwayWorks, saveRevision: 1, lineage: v17.lineage })
  const v24 = createPublicV24Root(v23), v25 = createPublicV25Root({
    head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
  const v31 = createPublicV31Root(v30), v32 = createPublicV32Root(v31)
  const root = createPublicV33Root(v32)
  vi.mocked(inspectPublicV29UnderLock).mockResolvedValue({ status: 'valid',
    start: { head: v29.head, lineage: v29.lineage }, target: valid(v29) } as never)
  const reads = { raw: vi.fn(async () => ({ status: 'valid' as const, raw: root })),
    v30: vi.fn(async () => valid(v30)), v31: vi.fn(async () => valid(v31)),
    v32: vi.fn(async () => valid(v32)) }
  const lock = { request: vi.fn(async (_name: string, _options: unknown,
    body: () => Promise<unknown>) => body()) }
  const unused = {} as never, store = (readChecked: unknown) => ({ readChecked })
  const callback = vi.fn(async (raw: unknown) => ({ ok: true as const, value: raw }))
  const check = () => withLockedCheckedPublicV33SourceRaw(lock as never,
    { readRawSourceEnvelope: reads.raw } as never,
    store(reads.v32) as never, store(reads.v31) as never, store(reads.v30) as never,
    unused, unused, unused, unused, unused, unused, unused, unused, callback)
  return { root, v30, v31, v32, reads, lock, callback, check }
}

describe('V33 source-only checked raw seam', () => {
  beforeEach(() => vi.mocked(inspectPublicV29UnderLock).mockReset())

  it('accepts a real decoded source under one lock without a V33 proof read', async () => {
    const f = checkedRawChain()
    expect(await f.check()).toEqual({ ok: true, value: f.root })
    expect(f.callback).toHaveBeenCalledOnce()
    expect(f.callback.mock.calls[0][0]).toBe(f.root)
    expect(f.lock.request).toHaveBeenCalledOnce()
    expect(f.reads.raw).toHaveBeenCalledOnce()
    expect(f.reads.raw.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(inspectPublicV29UnderLock).mock.invocationCallOrder[0])
  }, 120_000)

  it('keeps invalid V33 ahead of blocked ancestry, and never calls the consumer', async () => {
    const f = checkedRawChain()
    f.reads.raw.mockResolvedValue({ status: 'valid', raw: { forged: true } } as never)
    vi.mocked(inspectPublicV29UnderLock).mockResolvedValue({ status: 'blocked',
      reason: 'source-v17-invalid' } as never)
    expect(await f.check()).toEqual({ ok: false, reason: 'invalid-v33-root' })
    expect(f.callback).not.toHaveBeenCalled()
    f.reads.raw.mockResolvedValue({ status: 'blocked', reason: 'storage-error' } as never)
    expect(await f.check()).toEqual({ ok: false, reason: 'storage-error' })
    f.reads.raw.mockResolvedValue({ status: 'missing' } as never)
    expect(await f.check()).toEqual({ ok: false, reason: 'source-v17-invalid' })
    vi.mocked(inspectPublicV29UnderLock).mockResolvedValue({ status: 'valid',
      start: f.v30.lineage.sourceReceipt, target: valid({}) } as never)
    expect(await f.check()).toEqual({ ok: false, reason: 'root-missing' })
    expect(f.callback).not.toHaveBeenCalled()
  }, 120_000)

  it('rejects changed V32 and deeper ancestry, while surfacing a valid new V33 root', async () => {
    const f = checkedRawChain()
    f.reads.v32.mockResolvedValue(valid({ ...f.v32, head: {
      ...f.v32.head, saveRevision: 1 } }) as never)
    expect(await f.check()).toEqual({ ok: false, reason: 'source-changed' })
    f.reads.v32.mockResolvedValue(valid(f.v32))
    f.reads.v30.mockResolvedValue(valid({ ...f.v30, lineage: { ...f.v30.lineage,
      sourceReceipt: { forged: true } } }) as never)
    expect(await f.check()).toEqual({ ok: false, reason: 'source-v30-source-changed' })
    f.reads.v30.mockResolvedValue(valid(f.v30))
    const witness = { kind: 'checkpoint' as const }
    const progress = replayPublicV33Witness(f.root.head, witness)!
    const updated = { lineage: f.root.lineage, previous: f.root.head,
      head: { ...f.root.head, ...progress, saveRevision: 1, witness } }
    f.reads.raw.mockResolvedValue({ status: 'valid', raw: updated } as never)
    expect(await f.check()).toEqual({ ok: true, value: updated })
    expect(f.callback).toHaveBeenCalledWith(updated)
  }, 120_000)
})
