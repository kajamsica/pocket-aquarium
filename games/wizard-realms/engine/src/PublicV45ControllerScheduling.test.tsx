import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { PublicV23Controller } from './PublicV23Controller'
import { createFreshPublicV42Root } from './domain/publicWorldV42Snapshot'
import { createPublicV43Root } from './domain/publicWorldV43Snapshot'
import { createPublicV44Root } from './domain/publicWorldV44Snapshot'
import { createPublicV45Genesis } from './domain/publicWorldV45Migration'
import type { WizardViewIntent } from './view/contracts'

const probe = vi.hoisted(() => ({ active: false, reuse: false, refs: [] as { current: unknown }[],
  states: [] as unknown[], refIndex: 0, stateIndex: 0, now: 0,
  tick: null as (() => void) | null,
  onIntent: null as ((intent: WizardViewIntent) => void) | null,
  notify: null as (() => void) | null,
  cleanups: [] as Array<() => void>, gate: 'open' as 'open' | 'cap-paused' | 'blocked',
  pending: 0, durable: 1, frames: 0, frameKinds: [] as string[],
  redraws: 0, saveCalls: 0 }))

vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>()
  return { ...react,
    useRef: (value: unknown) => {
      const ref = react.useRef(value)
      if (!probe.active) return ref
      const index = probe.refIndex++
      return probe.reuse ? probe.refs[index] ?? ref : (probe.refs[index] = ref)
    },
    useState: (initial: unknown) => {
      const state = react.useState(initial)
      if (!probe.active) return state
      const index = probe.stateIndex++
      if (!probe.reuse) probe.states[index] = state[0]
      return [probe.states[index], (next: unknown) => {
        if (index === 0) probe.redraws++
        probe.states[index] = typeof next === 'function'
          ? (next as (prior: unknown) => unknown)(probe.states[index]) : next
      }]
    },
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      if (probe.active) { const cleanup = effect(); if (cleanup) probe.cleanups.push(cleanup); return }
      return react.useEffect(effect, deps)
    },
  }
})
vi.mock('./view/WizardSurface', () => ({ WizardSurface: ({ onIntent }: {
  onIntent: (intent: WizardViewIntent) => void }) => { probe.onIntent = onIntent; return null } }))
vi.mock('./PublicV45WorkerBindings', () => ({ createPublicV45WorkerBindings: () => ({
  write: async () => ({ ok: false, reason: 'test-writer' }),
  homeWrite: async () => ({ ok: false, reason: 'test-writer' }),
  ridePort: { epoch: 'test', commitRideBatch: async () => ({ status: 'blocked',
    reason: 'test-writer', durability: 'not-committed' }), onFatal: () => () => {} },
}) }))
vi.mock('./PublicV45ControllerRuntime', async (original) => {
  const actual = await original<typeof import('./PublicV45ControllerRuntime')>()
  return { ...actual, createPublicV45ControllerRuntime: (...args:
    Parameters<typeof actual.createPublicV45ControllerRuntime>) => {
    const base = actual.createPublicV45ControllerRuntime(...args)
    if (!probe.active) return base
    return { ...base,
      groundMount: () => ({ ...base.groundMount(), mode: 'riding' as const }),
      status: () => ({ ...base.status(), gate: probe.gate, pendingFrames: probe.pending,
        durableRevision: probe.durable, blockedReason: probe.gate === 'blocked'
          ? 'test-worker-fatal' : null }),
      idleFrameNeeded: () => false,
      advanceFrame: (intents: readonly { type: string }[]) => {
        probe.frames++; probe.pending++
        probe.frameKinds.push(intents[0]?.type ?? 'idle')
        if (args[3] && probe.pending === 64) probe.gate = 'cap-paused'
        return { events: [], rejections: [] }
      },
      save: async () => { probe.saveCalls++; return { status: 'saved', events: [],
        resetWalkRequested: false } },
      subscribeStatus: (listener: () => void) => { probe.notify = listener
        return () => { probe.notify = null } },
    } as unknown as typeof base
  } }
})

const start = createPublicV45Genesis(createPublicV44Root(
  createPublicV43Root(createFreshPublicV42Root('wizard-realms'))))
const entryProps = (ready: boolean) => ({ version: 'v45' as const, start,
  locks: {} as never, store: {} as never, v44Store: {} as never,
  v45SaveOpen: ready ? { status: 'ready' as const, transport: {} as never }
    : { status: 'unsupported' as const, reason: 'worker' as const } })
const render = (ready: boolean) => {
  probe.refIndex = probe.stateIndex = 0
  return renderToStaticMarkup(createElement(PublicV23Controller, entryProps(ready)))
}
const mount = (ready: boolean) => {
  probe.active = true
  vi.spyOn(performance, 'now').mockImplementation(() => probe.now)
  vi.stubGlobal('window', { location: { hostname: 'localhost', search: '?publicWorld=v45' },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    setInterval: (tick: () => void) => { probe.tick = tick; return 1 }, clearInterval: vi.fn() })
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(),
    removeEventListener: vi.fn() })
  return render(ready)
}
afterEach(() => {
  for (const cleanup of probe.cleanups) cleanup()
  probe.active = probe.reuse = false
  probe.refs = []; probe.states = []; probe.cleanups = []
  probe.refIndex = probe.stateIndex = probe.now = probe.pending = probe.frames = probe.saveCalls = 0
  probe.redraws = 0; probe.frameKinds = []
  probe.tick = probe.onIntent = probe.notify = null
  probe.gate = 'open'; probe.durable = 1
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('overlaps READY ride windows at 32, pauses at 64 without held burst, and keeps an explicit tap', () => {
  probe.pending = 31; mount(true)
  probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
  probe.tick!()
  expect(probe.pending).toBe(32)
  expect(probe.saveCalls).toBe(0)
  probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
  probe.tick!()
  expect(probe.pending).toBe(33)
  probe.pending = 63
  probe.onIntent!({ type: 'movement', vector: [0, 1], atMs: 1 })
  probe.now = 151
  probe.tick!()
  expect(probe.gate).toBe('cap-paused')
  expect(probe.saveCalls).toBe(0)
  probe.reuse = true
  expect(render(true)).toContain('2 short input step(s) queued')
  probe.now = 1001; probe.tick!()
  expect(render(true)).not.toContain('short input step(s) queued')
  probe.onIntent!({ type: 'movement', vector: [0, 0], atMs: 1002 })
  probe.onIntent!({ type: 'movement.tap', vector: [1, 0], source: 'keyboard' })
  const redrawsBeforeAck = probe.redraws
  probe.pending = 32; probe.durable = 2; probe.gate = 'open'; probe.notify!()
  expect(probe.redraws).toBeGreaterThan(redrawsBeforeAck)
  probe.now = 1051; probe.tick!()
  expect(probe.frames).toBe(4)
  expect(probe.frameKinds.at(-1)).toBe('look')
  expect(probe.saveCalls).toBe(0)
  const html = render(true)
  expect(html).toContain('Durable revision 2; 33 unsaved frame(s).')
  probe.gate = 'blocked'; probe.notify!()
  const blocked = render(true)
  expect(blocked).toContain('Save blocked (test-worker-fatal)')
  expect(blocked).not.toContain('Current checked progress is saved')
})

it('keeps unsupported V45 on the original 32-frame synchronous checkpoint', () => {
  probe.pending = 31; mount(false)
  probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
  probe.tick!()
  expect(probe.pending).toBe(32)
  expect(probe.saveCalls).toBe(1)
})

it('still drains a partially filled READY ride after the player becomes idle', () => {
  probe.pending = 8; mount(true)
  probe.tick!()
  expect(probe.saveCalls).toBe(1)
})

it('still drains READY unsaved travel when the tab becomes hidden', () => {
  probe.pending = 8; mount(true)
  const onHidden = vi.mocked(document.addEventListener).mock.calls
    .find(([event]) => event === 'visibilitychange')?.[1] as () => void
  Object.assign(document, { hidden: true })
  onHidden()
  expect(probe.saveCalls).toBe(1)
})
