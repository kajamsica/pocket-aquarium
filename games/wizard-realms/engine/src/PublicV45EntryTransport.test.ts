import { describe, expect, it, vi } from 'vitest'
import { createPublicV45EntryTransportGate } from './PublicV45Entry'
import type { PublicV45SaveOpen, PublicV45SaveTransport } from './PublicV45SaveTransport'
import type { PublicV45Start } from './domain/publicWorldV45Flow'

const start = {} as PublicV45Start
const ready = () => {
  const dispose = vi.fn()
  return { result: { status: 'ready', transport: {
    dispose } as unknown as PublicV45SaveTransport } as const, dispose }
}

describe('V45 entry Worker handshake', () => {
  it('retains a ready transport until genuine unmount', async () => {
    const worker = ready()
    const gate = createPublicV45EntryTransportGate(async () => worker.result)
    const unmount = gate.mount()
    expect(await gate.open(start)).toBe(worker.result)
    expect(worker.dispose).not.toHaveBeenCalled()
    unmount()
    await Promise.resolve()
    expect(worker.dispose).toHaveBeenCalledOnce()
  })

  it('does not close a ready transport on StrictMode effect replay', async () => {
    const worker = ready()
    const gate = createPublicV45EntryTransportGate(async () => worker.result)
    const replayCleanup = gate.mount()
    expect(await gate.open(start)).toBe(worker.result)
    replayCleanup()
    const realCleanup = gate.mount()
    await Promise.resolve()
    expect(worker.dispose).not.toHaveBeenCalled()
    realCleanup()
    await Promise.resolve()
    expect(worker.dispose).toHaveBeenCalledOnce()
  })

  it('explicitly admits unsupported and blocks failed initialization', async () => {
    for (const result of [
      { status: 'unsupported', reason: 'worker' },
      { status: 'blocked', reason: 'worker-init-failed' },
    ] as PublicV45SaveOpen[]) {
      const gate = createPublicV45EntryTransportGate(async () => result)
      const unmount = gate.mount()
      expect(await gate.open(start)).toEqual(result)
      unmount()
    }
    const throwing = createPublicV45EntryTransportGate(async () => { throw Error('failed') })
    throwing.mount()
    expect(await throwing.open(start)).toEqual({ status: 'blocked', reason: 'worker-init-error' })
  })

  it('disposes a ready Worker from a superseded or unmounted choice', async () => {
    const first = ready(), second = ready()
    const resolvers: Array<(value: PublicV45SaveOpen) => void> = []
    const gate = createPublicV45EntryTransportGate(() => new Promise((resolve) => {
      resolvers.push(resolve)
    }))
    const unmount = gate.mount()
    const stale = gate.open(start), newest = gate.open(start)
    resolvers[0](first.result)
    expect(await stale).toEqual({ status: 'blocked', reason: 'choice-superseded' })
    expect(first.dispose).toHaveBeenCalledOnce()
    unmount()
    await Promise.resolve()
    resolvers[1](second.result)
    expect(await newest).toEqual({ status: 'blocked', reason: 'choice-superseded' })
    expect(second.dispose).toHaveBeenCalledOnce()
  })
})
