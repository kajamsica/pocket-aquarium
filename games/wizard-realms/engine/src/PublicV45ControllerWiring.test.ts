import { beforeEach, expect, it, vi } from 'vitest'
import { createPublicV45RuntimeForEntry } from './PublicV23Controller'
import type { PublicV45ControllerProps } from './PublicV23Controller'
import type { PublicV45Start } from './domain/publicWorldV45Flow'

const seams = vi.hoisted(() => ({ adapter: vi.fn(), runtime: vi.fn(),
  syncWrite: vi.fn(), syncHome: vi.fn() }))
vi.mock('./PublicV45WorkerBindings', () => ({
  createPublicV45WorkerBindings: seams.adapter,
}))
vi.mock('./PublicV45ControllerRuntime', () => ({
  createPublicV45ControllerRuntime: seams.runtime,
}))
vi.mock('./domain/publicWorldV45Flow', async (original) => ({
  ...await original<typeof import('./domain/publicWorldV45Flow')>(),
  commitPublicV45: seams.syncWrite,
  requestPublicV45ReturnHome: seams.syncHome,
}))

const start = (revision: number) => ({ head: { saveRevision: revision },
  lineage: { sourceRevision: 3 } } as PublicV45Start)
const bindings = { locks: {}, store: {}, v44Store: {} }

beforeEach(() => { vi.resetAllMocks() })

it('uses only READY Worker writers and reads the latest committed runtime start', async () => {
  const transport = { epoch: 'ready-epoch' }
  const blocked = { ok: false as const, reason: 'worker-outcome-unknown' }
  const worker = { write: vi.fn().mockResolvedValue(blocked),
    homeWrite: vi.fn().mockResolvedValue(blocked), ridePort: transport }
  let committed = start(4)
  const runtime = { committed: vi.fn(() => committed) }
  seams.adapter.mockReturnValue(worker)
  seams.runtime.mockReturnValue(runtime)
  const props = { ...bindings, version: 'v45', start: committed,
    v45SaveOpen: { status: 'ready', transport } } as unknown as PublicV45ControllerProps
  expect(createPublicV45RuntimeForEntry(props)).toBe(runtime)
  expect(seams.adapter).toHaveBeenCalledWith(transport, props, expect.any(Function))
  const readCurrent = seams.adapter.mock.calls[0][2] as () => PublicV45Start
  expect(readCurrent()).toBe(committed)
  committed = start(5)
  expect(readCurrent()).toBe(committed)
  const [initial, write, homeWrite, ridePort] = seams.runtime.mock.calls[0]
  expect(initial).toBe(props.start)
  expect(ridePort).toBe(transport)
  expect(await write(5, committed.lineage, { kind: 'buy-sedgehorn-tack/v1' }))
    .toBe(blocked)
  expect(await homeWrite(5, committed.lineage)).toBe(blocked)
  expect(seams.syncWrite).not.toHaveBeenCalled()
  expect(seams.syncHome).not.toHaveBeenCalled()
})

it('keeps unsupported V45 on the existing sync writers without a ride port', async () => {
  const runtime = { committed: vi.fn() }
  seams.runtime.mockReturnValue(runtime)
  seams.syncWrite.mockResolvedValue({ ok: false, reason: 'sync-blocked' })
  seams.syncHome.mockResolvedValue({ ok: false, reason: 'sync-home-blocked' })
  const props = ({ ...bindings, version: 'v45', start: start(4),
    v45SaveOpen: { status: 'unsupported', reason: 'worker' } }) as unknown as PublicV45ControllerProps
  expect(createPublicV45RuntimeForEntry(props)).toBe(runtime)
  expect(seams.adapter).not.toHaveBeenCalled()
  const [, write, homeWrite, ridePort] = seams.runtime.mock.calls[0]
  expect(ridePort).toBeUndefined()
  const witness = { kind: 'buy-sedgehorn-tack/v1' }
  expect(await write(4, props.start.lineage, witness))
    .toEqual({ ok: false, reason: 'sync-blocked' })
  expect(await homeWrite(4, props.start.lineage))
    .toEqual({ ok: false, reason: 'sync-home-blocked' })
  expect(seams.syncWrite).toHaveBeenCalledWith(props.locks, props.store,
    props.v44Store, 4, props.start.lineage, witness)
  expect(seams.syncHome).toHaveBeenCalledWith(props.locks, props.store,
    props.v44Store, 4, props.start.lineage)
})

it('fails closed on missing or forged blocked status without constructing a writer', () => {
  const base = { ...bindings, version: 'v45', start: start(4) }
  for (const v45SaveOpen of [undefined, { status: 'blocked', reason: 'storage-error' }])
    expect(() => createPublicV45RuntimeForEntry(
      { ...base, v45SaveOpen } as unknown as PublicV45ControllerProps))
      .toThrow('V45 save transport status is required')
  expect(seams.adapter).not.toHaveBeenCalled()
  expect(seams.runtime).not.toHaveBeenCalled()
  expect(seams.syncWrite).not.toHaveBeenCalled()
})
