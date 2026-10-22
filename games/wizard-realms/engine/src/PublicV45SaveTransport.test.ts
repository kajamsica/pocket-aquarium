import { expect, it, vi } from 'vitest'
import { openPublicV45SaveTransport } from './PublicV45SaveTransport'
import type { PublicV45Start } from './domain/publicWorldV45Flow'

const witness = { kind: 'sedgehorn-assisted-ride-batch/v1' as const,
  frames: [{ kind: 'sedgehorn-assisted-ride-frame/v1' as const,
    intents: [{ type: 'move' as const, delta: { x: 0.2, z: 0 } }] as const }] }
class FakeWorker {
  static last: FakeWorker
  onmessage: ((event: MessageEvent) => void) | null = null
  messages: Record<string, unknown>[] = []
  malformed = false
  silent = false
  constructor() { FakeWorker.last = this }
  postMessage(message: Record<string, unknown>) {
    this.messages.push(message)
    if (this.silent) return
    if (message.kind === 'init') {
      queueMicrotask(() => this.onmessage?.({ data: { kind: 'ready', epoch: 'e' } } as MessageEvent))
      return
    }
    const ack = { epoch: 'e', [message.kind === 'ride' ? 'batchId' : 'requestId']:
      message.id, baseRevision: message.expectedRevision,
      nextRevision: Number(message.expectedRevision) + 1,
      frameCount: message.kind === 'ride' ? 1 : 0,
      terminal: { tick: 9, position: { x: 1, y: 0, z: 2 }, yaw: 0.5,
        groundMountMode: 'riding' } }
    queueMicrotask(() => this.onmessage?.({ data: { kind: 'result', epoch: 'e',
      id: message.id, result: { status: 'committed', ack: this.malformed
        ? { ...ack, root: {} } : ack } } } as MessageEvent))
  }
  terminate() {}
}

it('sends witness-only writes, accepts exact ACKs and fails closed on extra authority', async () => {
  vi.stubGlobal('Worker', FakeWorker)
  try {
    const opened = await openPublicV45SaveTransport({} as PublicV45Start)
    if (opened.status !== 'ready') throw new Error('Worker did not open')
    const input = { batchId: 1, expectedRevision: 4, witness }
    expect(await opened.transport.commitRideBatch(input)).toMatchObject({
      status: 'committed', ack: { batchId: 1, nextRevision: 5, frameCount: 1 } })
    expect(FakeWorker.last.messages[1]).toEqual({ kind: 'ride', epoch: 'e',
      id: 1, expectedRevision: 4, witness })
    FakeWorker.last.malformed = true
    expect(await opened.transport.commitRideBatch({ ...input, batchId: 2,
      expectedRevision: 5 })).toEqual({ status: 'blocked',
      reason: 'worker-ack-mismatch', durability: 'unknown' })
    expect(await opened.transport.commitRideBatch({ ...input, batchId: 3,
      expectedRevision: 5 })).toEqual({ status: 'blocked',
      reason: 'worker-ack-mismatch', durability: 'not-committed' })
    expect(FakeWorker.last.messages).toHaveLength(3)
  } finally { vi.unstubAllGlobals() }
})

it('fails a silent in-flight Worker request as unknown after the timeout', async () => {
  vi.stubGlobal('Worker', FakeWorker)
  try {
    const opened = await openPublicV45SaveTransport({} as PublicV45Start)
    if (opened.status !== 'ready') throw new Error('Worker did not open')
    FakeWorker.last.silent = true
    const fatal = vi.fn(); opened.transport.onFatal(fatal)
    vi.useFakeTimers()
    const result = opened.transport.commitRideBatch({ batchId: 1,
      expectedRevision: 4, witness })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await result).toEqual({ status: 'blocked',
      reason: 'worker-request-timeout', durability: 'unknown' })
    expect(fatal).toHaveBeenCalledWith('worker-request-timeout')
  } finally { vi.useRealTimers(); vi.unstubAllGlobals() }
})

it('reports missing Worker capabilities without a main-thread save fallback', async () => {
  class NoLocksWorker extends FakeWorker {
    override postMessage(message: Record<string, unknown>) {
      this.messages.push(message)
      queueMicrotask(() => this.onmessage?.({ data: {
        kind: 'unsupported', reason: 'locks' } } as MessageEvent))
    }
  }
  vi.stubGlobal('Worker', NoLocksWorker)
  try {
    expect(await openPublicV45SaveTransport({} as PublicV45Start)).toEqual({
      status: 'unsupported', reason: 'locks' })
    expect(FakeWorker.last.messages).toHaveLength(1)
  } finally { vi.unstubAllGlobals() }
})

it('keeps action and Return Home requests witness-only with independent IDs', async () => {
  vi.stubGlobal('Worker', FakeWorker)
  try {
    const opened = await openPublicV45SaveTransport({} as PublicV45Start)
    if (opened.status !== 'ready') throw new Error('Worker did not open')
    expect(await opened.transport.commitAction({ requestId: 1, expectedRevision: 4,
      witness: { kind: 'buy-sedgehorn-tack/v1' } })).toMatchObject({
      status: 'committed', ack: { requestId: 1, frameCount: 0 } })
    expect(await opened.transport.requestReturnHome({ requestId: 2,
      expectedRevision: 5 })).toMatchObject({ status: 'committed',
      ack: { requestId: 2, nextRevision: 6 } })
    expect(FakeWorker.last.messages[2]).toEqual({ kind: 'home', epoch: 'e',
      id: 2, expectedRevision: 5 })
  } finally { vi.unstubAllGlobals() }
})
