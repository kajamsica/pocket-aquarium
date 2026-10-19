import { beforeEach, describe, expect, it, vi } from 'vitest'
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
import { withLockedCheckedPublicV33SourceRaw } from './publicWorldV33Flow'
import { createPublicV33Root } from './publicWorldV33Snapshot'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import { commitPublicV34, inspectPublicV34, requestPublicV34ReturnHome,
  resumePublicV34, startPublicV34 } from './publicWorldV34Flow'
import { decodePublicV34Root } from './publicWorldV34Snapshot'
import type { PublicV34Root } from './publicWorldV34Snapshot'

vi.mock('./publicWorldV33Flow', () => ({ withLockedCheckedPublicV33SourceRaw: vi.fn() }))

function source() {
  const v17 = createFreshPublicV17Head('wizard-realms')
  const v23 = createPublicV23Root('wizard-realms', { state: v17.head.state,
    greenwayWorks: v17.head.greenwayWorks, saveRevision: 1, lineage: v17.lineage })
  const v24 = createPublicV24Root(v23)
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
  return createPublicV33Root(createPublicV32Root(createPublicV31Root(v30))).head
}

const checkedSourceHead = source()

function fixture() {
  let root: PublicV34Root | null = null
  let blocked: string | null = null
  let writeResult: 'committed' | 'storage-error' = 'committed'
  const readChecked = vi.fn(async () => blocked ? { status: 'blocked' as const, reason: blocked }
    : root ? { status: 'valid' as const, root, proof: {} }
      : { status: 'missing' as const, proof: {} })
  const commit = vi.fn(async (_proof: object, next: PublicV34Root) => {
    if (writeResult === 'committed') root = decodePublicV34Root(next)
    return writeResult
  })
  const store = { readChecked, commit } as never
  const lock = { request: vi.fn(async (_name: string, _options: unknown,
    body: () => Promise<unknown>) => body()) }
  const v33 = { head: structuredClone(checkedSourceHead) }, original = structuredClone(v33)
  vi.mocked(withLockedCheckedPublicV33SourceRaw).mockImplementation(async (...args) => {
    const callback = args.at(-1)
    if (typeof callback !== 'function') throw new Error('Missing source callback')
    return lock.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' },
      () => callback(v33)) as Promise<never>
  })
  const unused = {} as never
  const start = () => startPublicV34(lock as never, store, unused, unused, unused, unused, unused, unused,
    unused, unused, unused, unused, unused, unused)
  return { store, lock, v33, original, readChecked, commit, start,
    setBlocked: (reason: string | null) => { blocked = reason },
    setWriteResult: (result: 'committed' | 'storage-error') => { writeResult = result },
    getRoot: () => root }
}

describe('V34 self-contained migration flow', () => {
  beforeEach(() => { vi.mocked(withLockedCheckedPublicV33SourceRaw).mockReset() })

  it('copies an owned checked V33 head once, then resumes without older stores', async () => {
    const f = fixture()
    expect(await inspectPublicV34(f.lock as never, f.store)).toEqual({ ok: true,
      value: { status: 'migration-available' } })
    const started = await f.start()
    expect(started).toMatchObject({ ok: true, value: { head: { saveRevision: 0 } } })
    expect(f.commit).toHaveBeenCalledOnce()
    expect(f.v33).toEqual(f.original)
    expect(f.getRoot()?.lineage.genesis).not.toBe(f.v33.head)
    expect(f.getRoot()?.lineage.sourceRevision).toBe(f.v33.head.saveRevision)
    Object.assign(f.v33.head, { saveRevision: f.v33.head.saveRevision + 1 })
    vi.mocked(withLockedCheckedPublicV33SourceRaw).mockImplementation(async () => {
      throw new Error('old stores unavailable')
    })
    if (!started.ok) throw new Error('Expected a valid migration')
    expect(await inspectPublicV34(f.lock as never, f.store)).toMatchObject({ ok: true,
      value: { status: 'valid' } })
    expect(await resumePublicV34(f.lock as never, f.store, 0, started.value.lineage))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 0 } } })
    expect(await commitPublicV34(f.lock as never, f.store, 0, started.value.lineage,
      { kind: 'checkpoint' })).toMatchObject({ ok: true,
      value: { head: { saveRevision: 1 } } })
    expect(f.getRoot()?.head.saveRevision).toBe(1)
    expect(vi.mocked(withLockedCheckedPublicV33SourceRaw)).toHaveBeenCalledOnce()
    expect(f.lock.request).toHaveBeenCalledTimes(5)
  }, 120_000)

  it('blocks partial/corrupt targets and failed migration without touching V33', async () => {
    const f = fixture()
    f.setBlocked('invalid-v34-root')
    expect(await f.start()).toEqual({ ok: false, reason: 'invalid-v34-root' })
    expect(f.commit).not.toHaveBeenCalled()
    f.setBlocked(null)
    f.setWriteResult('storage-error')
    expect(await f.start()).toEqual({ ok: false, reason: 'storage-error' })
    expect(f.getRoot()).toBeNull()
    expect(f.v33).toEqual(f.original)
    f.setWriteResult('committed')
    expect(await f.start()).toMatchObject({ ok: true })
    expect(await f.start()).toEqual({ ok: false, reason: 'target-conflict' })
  }, 120_000)

  it('rejects stale revisions and invalid fairy-ring actions without writing', async () => {
    const f = fixture(), started = await f.start()
    if (!started.ok) throw new Error('Expected a valid migration')
    f.commit.mockClear()
    expect(await resumePublicV34(f.lock as never, f.store, 1, started.value.lineage))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await commitPublicV34(f.lock as never, f.store, 1, started.value.lineage,
      { kind: 'checkpoint' })).toEqual({ ok: false, reason: 'revision-changed' })
    const remote = { kind: 'fairy-ring-travel/v1' as const,
      sourceRingId: 'ring-greenway' as const, targetRingId: 'ring-mireglass' as const }
    const first = await commitPublicV34(f.lock as never, f.store, 0, started.value.lineage, remote)
    const second = await commitPublicV34(f.lock as never, f.store, 0, started.value.lineage, remote)
    expect(first).toEqual(second)
    expect(first).toMatchObject({ ok: false })
    expect(f.commit).not.toHaveBeenCalled()
    expect(f.getRoot()?.head.saveRevision).toBe(0)
    expect(await requestPublicV34ReturnHome(f.lock as never, f.store, 0, started.value.lineage))
      .toMatchObject({ ok: false })
  }, 120_000)
})
