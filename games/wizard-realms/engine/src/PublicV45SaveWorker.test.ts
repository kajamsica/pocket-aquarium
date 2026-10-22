import { afterEach, expect, it, vi } from 'vitest'

const flow = vi.hoisted(() => ({
  resume: vi.fn(), commit: vi.fn(), home: vi.fn(), receipt: vi.fn(),
}))
vi.mock('./domain/atomicV44Promotion', () => ({ createAtomicV44PromotionStore: () => ({}) }))
vi.mock('./domain/atomicV45Database', () => ({ createAtomicV45Store: () => ({}) }))
vi.mock('./domain/publicWorldV45Flow', () => ({
  resumePublicV45: flow.resume, commitPublicV45: flow.commit,
  requestPublicV45ReturnHome: flow.home,
  consumePublicV45CommitReceipt: flow.receipt,
}))

const witness = { kind: 'sedgehorn-assisted-ride-batch/v1', frames: [{
  kind: 'sedgehorn-assisted-ride-frame/v1',
  intents: [{ type: 'move', delta: { x: 0.2, z: 0 } }] }] }
const start = { head: { saveRevision: 4, state: { tick: 8,
  player: { position: { x: 1, y: 0, z: 2 }, yaw: 0.5 } },
  groundMount: { mode: 'riding' } }, lineage: { sourceRevision: 3 } }
let receive: ((event: MessageEvent) => void) | undefined
let messages: unknown[]
const send = (data: unknown) => receive?.({ data } as MessageEvent)
const latest = () => messages.at(-1) as Record<string, unknown>

async function openWorker() {
  messages = []
  vi.stubGlobal('postMessage', (value: unknown) => messages.push(value))
  vi.stubGlobal('addEventListener', (_type: string, fn: typeof receive) => { receive = fn })
  vi.stubGlobal('navigator', { locks: { request: vi.fn() } })
  vi.stubGlobal('indexedDB', {})
  vi.stubGlobal('crypto', { subtle: {}, randomUUID: () => 'epoch-1' })
  vi.resetModules()
  await import('./PublicV45SaveWorker')
  flow.resume.mockResolvedValue({ ok: true, value: start })
  flow.receipt.mockReturnValue(true)
  send({ kind: 'init', expected: start })
  await vi.waitFor(() => expect(latest()).toEqual({ kind: 'ready', epoch: 'epoch-1' }))
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); receive = undefined })

it('commits a checked ride inside the Worker and sends only terminal metadata', async () => {
  await openWorker()
  flow.commit.mockResolvedValue({ ok: true, value: { ...start,
    head: { ...start.head, saveRevision: 5,
      state: { ...start.head.state, tick: 9 } } } })
  send({ kind: 'ride', epoch: 'epoch-1', id: 1,
    expectedRevision: 4, witness })
  await vi.waitFor(() => expect(latest()).toMatchObject({ kind: 'result',
    result: { status: 'committed', ack: { batchId: 1, baseRevision: 4,
      nextRevision: 5, frameCount: 1, terminal: { tick: 9 } } } }))
  expect(flow.commit).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(latest())).not.toMatch(/lineage|root|proof/)
  send({ kind: 'ride', epoch: 'epoch-1', id: 2, expectedRevision: 5,
    witness, root: start })
  expect(latest()).toMatchObject({ result: { status: 'blocked',
    reason: 'invalid-request', durability: 'not-committed' } })
  expect(flow.commit).toHaveBeenCalledTimes(1)
})

it('distinguishes a proven rejected write from unknown durability', async () => {
  await openWorker()
  flow.commit.mockResolvedValue({ ok: false, reason: 'ride-blocked' })
  send({ kind: 'ride', epoch: 'epoch-1', id: 1,
    expectedRevision: 4, witness })
  await vi.waitFor(() => expect(latest()).toMatchObject({ result: {
    status: 'blocked', reason: 'ride-blocked', durability: 'not-committed' } }))
  flow.resume.mockResolvedValue({ ok: false, reason: 'storage-error' })
  send({ kind: 'ride', epoch: 'epoch-1', id: 2,
    expectedRevision: 4, witness })
  await vi.waitFor(() => expect(latest()).toMatchObject({ result: {
    status: 'blocked', reason: 'ride-blocked', durability: 'unknown' } }))
})
