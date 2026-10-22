import { beforeEach, expect, it, vi } from 'vitest'
import { createPublicV45WorkerBindings } from './PublicV45WorkerBindings'
import type { PublicV45EntryBindings } from './PublicV45Entry'
import type { PublicV45SaveTransport } from './PublicV45SaveTransport'
import type { PublicV45Start } from './domain/publicWorldV45Flow'

const checks = vi.hoisted(() => ({ resume: vi.fn(), root: vi.fn((value: unknown) => value) }))
vi.mock('./domain/publicWorldV45Flow', () => ({ resumePublicV45: checks.resume }))
vi.mock('./domain/publicWorldV45Snapshot', async (original) => ({
  ...await original<typeof import('./domain/publicWorldV45Snapshot')>(),
  decodePublicV45Root: checks.root,
}))

const lineage = { origin: 'v44-migration', sourceRevision: 3 }
const start = (revision: number, witness: unknown = null,
  tick = 8): PublicV45Start => ({ lineage, head: {
    saveRevision: revision, witness, state: { tick,
      player: { position: { x: 1, y: 0, z: 2 }, yaw: 0.5 } },
    groundMount: { mode: 'parked' },
  } } as unknown as PublicV45Start)
const ack = (requestId: number, baseRevision: number, tick = 9) => ({
  epoch: 'epoch-1', requestId, baseRevision, nextRevision: baseRevision + 1,
  frameCount: 0, terminal: { tick, position: { x: 1, y: 0, z: 2 },
    yaw: 0.5, groundMountMode: 'parked' as const },
})
const bindings = {} as PublicV45EntryBindings
const transport = () => ({ epoch: 'epoch-1', commitAction: vi.fn(),
  requestReturnHome: vi.fn(), commitRideBatch: vi.fn(), onFatal: vi.fn(),
  dispose: vi.fn() } as unknown as PublicV45SaveTransport & {
    commitAction: ReturnType<typeof vi.fn>; requestReturnHome: ReturnType<typeof vi.fn> })

beforeEach(() => { vi.clearAllMocks(); checks.root.mockImplementation((value) => value) })

it('shares increasing action/home IDs and accepts only a checked full successor', async () => {
  const worker = transport()
  const buy = { kind: 'buy-sedgehorn-tack/v1' as const }
  let current = start(4)
  const afterAction = start(5, buy, 9)
  const afterHome = start(6, { kind: 'return-home/v1', atMs: 123 }, 10)
  checks.resume.mockResolvedValueOnce({ ok: true, value: afterAction })
    .mockResolvedValueOnce({ ok: true, value: afterHome })
  worker.commitAction.mockResolvedValue({ status: 'committed', ack: ack(1, 4) })
  worker.requestReturnHome.mockResolvedValue({ status: 'committed', ack: ack(2, 5, 10) })
  const adapter = createPublicV45WorkerBindings(worker, bindings, () => current)
  expect(await adapter.write(4, lineage as PublicV45Start['lineage'], buy))
    .toEqual({ ok: true, value: afterAction })
  current = afterAction
  expect(await adapter.homeWrite(5, lineage as PublicV45Start['lineage']))
    .toEqual({ ok: true, value: afterHome })
  expect(worker.commitAction.mock.calls[0][0]).toEqual({ requestId: 1,
    expectedRevision: 4, witness: buy })
  expect(worker.requestReturnHome.mock.calls[0][0]).toEqual({ requestId: 2,
    expectedRevision: 5 })
  expect(checks.resume.mock.calls.map((call) => call.slice(3)))
    .toEqual([[5, lineage], [6, lineage]])
  expect(checks.root.mock.calls[0][0]).toEqual({ lineage,
    previous: start(4).head, head: afterAction.head })
})

it('retains the exact requested witness when the caller mutates it during the ACK', async () => {
  const worker = transport()
  let release: ((value: unknown) => void) | undefined
  worker.commitAction.mockReturnValue(new Promise((resolve) => { release = resolve }))
  const requested = { kind: 'sell-marsh-herb/v1' as const, quantity: 1 }
  checks.resume.mockResolvedValue({ ok: true, value: start(5,
    { kind: 'sell-marsh-herb/v1', quantity: 1 }, 9) })
  const adapter = createPublicV45WorkerBindings(worker, bindings, () => start(4))
  const result = adapter.write(4, lineage as PublicV45Start['lineage'], requested)
  requested.quantity = 9
  release?.({ status: 'committed', ack: ack(1, 4) })
  expect((await result).ok).toBe(true)
  expect(worker.commitAction.mock.calls[0][0].witness.quantity).toBe(1)
})

it('blocks a mismatched terminal, witness, or concurrent readback', async () => {
  const buy = { kind: 'buy-sedgehorn-tack/v1' as const }
  const worker = transport()
  const adapter = createPublicV45WorkerBindings(worker, bindings, () => start(4))
  worker.commitAction.mockResolvedValueOnce({ status: 'committed', ack: ack(1, 4, 99) })
    .mockResolvedValueOnce({ status: 'committed', ack: ack(2, 4) })
    .mockResolvedValueOnce({ status: 'committed', ack: ack(3, 4) })
  checks.resume.mockResolvedValueOnce({ ok: true, value: start(5, buy, 9) })
    .mockResolvedValueOnce({ ok: true, value: start(5,
      { kind: 'sell-marsh-herb/v1', quantity: 1 }, 9) })
    .mockResolvedValueOnce({ ok: false, reason: 'revision-changed' })
  expect(await adapter.write(4, lineage as PublicV45Start['lineage'], buy))
    .toEqual({ ok: false, reason: 'worker-readback-mismatch' })
  expect(await adapter.write(4, lineage as PublicV45Start['lineage'], buy))
    .toEqual({ ok: false, reason: 'worker-readback-mismatch' })
  expect(await adapter.write(4, lineage as PublicV45Start['lineage'], buy))
    .toEqual({ ok: false, reason: 'worker-readback-failed' })
})

it('never downgrades uncertain home durability to a gameplay rejection', async () => {
  const worker = transport()
  worker.requestReturnHome.mockResolvedValue({ status: 'blocked',
    reason: 'cooldown', durability: 'unknown' })
  const adapter = createPublicV45WorkerBindings(worker, bindings, () => start(4))
  expect(await adapter.homeWrite(4, lineage as PublicV45Start['lineage']))
    .toEqual({ ok: false, reason: 'worker-outcome-unknown' })
  expect(checks.resume).not.toHaveBeenCalled()
})

it('rejects a spoofed ACK before reading and a root the decoder cannot prove', async () => {
  const worker = transport()
  const buy = { kind: 'buy-sedgehorn-tack/v1' as const }
  const adapter = createPublicV45WorkerBindings(worker, bindings, () => start(4))
  worker.commitAction.mockResolvedValueOnce({ status: 'committed', ack: ack(99, 4) })
    .mockResolvedValueOnce({ status: 'committed', ack: ack(2, 4) })
  expect(await adapter.write(4, lineage as PublicV45Start['lineage'], buy))
    .toEqual({ ok: false, reason: 'worker-ack-mismatch' })
  expect(checks.resume).not.toHaveBeenCalled()
  checks.resume.mockResolvedValue({ ok: true, value: start(5, buy, 9) })
  checks.root.mockReturnValueOnce(null)
  expect(await adapter.write(4, lineage as PublicV45Start['lineage'], buy))
    .toEqual({ ok: false, reason: 'worker-readback-mismatch' })
})
