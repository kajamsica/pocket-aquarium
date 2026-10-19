import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublicV23Controller } from './PublicV23Controller'
import { createAtomicV41Store } from './domain/atomicV41Database'
import { createAtomicV42Store } from './domain/atomicV42Database'
import { createFreshPublicV42Root } from './domain/publicWorldV42Snapshot'
import type { WizardViewIntent } from './view/contracts'

const probe = vi.hoisted(() => ({ refs: [] as { current: unknown }[], states: [] as unknown[],
  refIndex: 0, stateIndex: 0, reuse: false, tick: null as (() => void) | null,
  onIntent: null as ((intent: WizardViewIntent) => void) | null,
  pose: null as { x: number; y: number; z: number; yaw: number } | null,
  frames: [] as Array<readonly { type: string; yawDelta?: number;
    delta?: { x: number; z: number } }[]>, savedFrames: 0, pendingOffset: 0,
  rejectNextMove: false, runBoots: false,
  waypoints: null as readonly { x: number; z: number }[] | null }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual,
    useRef: (value: unknown) => {
      const ref = actual.useRef(value), index = probe.refIndex++
      return probe.reuse ? probe.refs[index] ?? ref : (probe.refs[index] = ref)
    },
    useState: (initial: unknown) => {
      const state = actual.useState(initial), index = probe.stateIndex++
      if (!probe.reuse) probe.states[index] = state[0]
      return [probe.states[index], (next: unknown) => {
        probe.states[index] = typeof next === 'function'
          ? (next as (prior: unknown) => unknown)(probe.states[index]) : next
      }]
    },
    useEffect: (effect: () => void | (() => void)) => { effect() },
  }
})
vi.mock('./view/WizardSurface', () => ({ WizardSurface: ({ onIntent }: {
  onIntent: (intent: WizardViewIntent) => void }) => { probe.onIntent = onIntent; return null } }))
vi.mock('./view/devNavigation', () => ({ planDevRoute: (_view: unknown, _start: unknown,
  destination: { x: number; z: number }) => ({ ok: true,
  waypoints: probe.waypoints ?? [destination] }) }))
vi.mock('./PublicV42ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV42ControllerRuntime')>()
  return { ...actual, createPublicV42ControllerRuntime: (
    ...args: Parameters<typeof actual.createPublicV42ControllerRuntime>) => {
    const base = actual.createPublicV42ControllerRuntime(...args)
    const initial = base.view().player
    probe.pose = { ...initial.position, yaw: 0 }
    return { ...base,
      view: () => { const value = base.view(), pose = probe.pose!
        return { ...value, player: { ...value.player,
          position: { x: pose.x, y: pose.y, z: pose.z }, yaw: pose.yaw,
          equipment: probe.runBoots ? { ...value.player.equipment, feet: 'leather_boots' as const }
            : value.player.equipment } } },
      status: () => ({ ...base.status(), pendingFrames:
        probe.frames.length - probe.savedFrames + probe.pendingOffset }),
      idleFrameNeeded: () => false,
      save: async () => { probe.savedFrames = probe.frames.length; probe.pendingOffset = 0
        return { status: 'saved', events: [], resetWalkRequested: false } },
      advanceFrame: (intents: readonly { type: string; yawDelta?: number;
        delta?: { x: number; z: number } }[]) => {
        probe.frames.push(intents)
        if (probe.rejectNextMove && intents.some((intent) => intent.type === 'move')) {
          probe.rejectNextMove = false
          return { events: [], rejections: [{ intentIndex: 0, intentType: 'move',
            code: 'terrain_missing', message: 'Blocked by terrain.' }] }
        }
        for (const intent of intents) {
          if (intent.type === 'look') probe.pose!.yaw += intent.yawDelta ?? 0
          if (intent.type === 'move' && intent.delta) {
            probe.pose!.x += intent.delta.x; probe.pose!.z += intent.delta.z
          }
        }
        return { events: [], rejections: [] }
      },
    }
  } }
})

function mount(search = '?dev=1', runBoots = false) {
  probe.refs = []; probe.states = []; probe.refIndex = probe.stateIndex = 0
  probe.reuse = false; probe.frames = []; probe.savedFrames = 0; probe.pendingOffset = 0
  probe.rejectNextMove = false; probe.runBoots = runBoots; probe.waypoints = null
  vi.stubGlobal('window', { location: { hostname: 'localhost', search },
    setInterval: (tick: () => void) => { probe.tick = tick; return 1 }, clearInterval: () => {},
    addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('document', { hidden: false,
    addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const root = createFreshPublicV42Root('wizard-realms'), factory = new IDBFactory()
  const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
    body: () => T | Promise<T>) => body() }
  renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v42',
    start: { head: root.head, lineage: root.lineage }, locks,
    store: createAtomicV42Store(factory), v41Store: createAtomicV41Store(factory) }))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('V42 dev route controller', () => {
  it('walks forward to a north waypoint with the normal movement writer', () => {
    mount()
    const start = { ...probe.pose! }
    probe.onIntent!({ type: 'dev.navigate', destination: { x: start.x, z: start.z - 3 } })
    probe.tick!()
    expect(probe.frames[0][0].type).toBe('move')
    expect(Math.abs(probe.frames[0][0].delta!.x)).toBeLessThan(0.001)
    expect(probe.frames[0][0].delta!.z).toBeLessThan(0)
    expect(probe.pose!.z).toBeLessThan(start.z)
  })

  it('pivots toward an east waypoint, then moves east, and Esc cancels further travel', () => {
    mount()
    const start = { ...probe.pose! }
    probe.onIntent!({ type: 'dev.navigate', destination: { x: start.x + 3, z: start.z } })
    for (let index = 0; index < 16; index++) probe.tick!()
    expect(probe.pose!.x).toBeGreaterThan(start.x)
    const atCancel = probe.frames.length
    probe.onIntent!({ type: 'dev.navigate.cancel' })
    probe.tick!()
    expect(probe.frames.length).toBe(atCancel)
  })

  it('does not accept dev navigation outside dev mode', () => {
    mount('')
    const start = { ...probe.pose! }
    probe.onIntent!({ type: 'dev.navigate', destination: { x: start.x, z: start.z - 3 } })
    probe.tick!()
    expect(probe.pose).toEqual(start)
  })

  it('stops after a checked movement rejection and does not retry the blocked step', () => {
    mount()
    const start = { ...probe.pose! }
    probe.onIntent!({ type: 'dev.navigate', destination: { x: start.x, z: start.z - 3 } })
    probe.rejectNextMove = true
    probe.tick!()
    expect(probe.pose).toEqual(start)
    const attempted = probe.frames.length
    probe.tick!()
    expect(probe.frames.length).toBe(attempted)
  })

  it('cancels for manual controls but continues after a routine save gate', async () => {
    mount()
    const start = { ...probe.pose! }
    probe.onIntent!({ type: 'dev.navigate', destination: { x: start.x, z: start.z - 3 } })
    probe.pendingOffset = 96
    probe.tick!()
    expect(probe.frames).toHaveLength(0)
    await vi.waitFor(() => expect(probe.pendingOffset).toBe(0))
    await vi.waitFor(() => { probe.tick!(); expect(probe.pose!.z).toBeLessThan(start.z) })
    probe.onIntent!({ type: 'movement', vector: [0, 1], atMs: performance.now() })
    probe.onIntent!({ type: 'movement', vector: [0, 0] })
    const frames = probe.frames.length
    probe.tick!()
    expect(probe.frames).toHaveLength(frames)
  })

  it('passes a close intermediate corner at run speed and arrives without oscillating', () => {
    mount('?dev=1', true)
    const start = { ...probe.pose! }
    const destination = { x: start.x + 1.2, z: start.z - 0.15 }
    probe.waypoints = [{ x: start.x, z: start.z - 0.15 }, destination]
    probe.onIntent!({ type: 'dev.navigate', destination })
    probe.tick!()
    expect(probe.frames[0][0].delta?.z).toBeCloseTo(-0.15)
    for (let index = 1; index < 30; index++) probe.tick!()
    expect(probe.pose!.x).toBeGreaterThan(start.x + 0.5)
    expect(Math.hypot(destination.x - probe.pose!.x, destination.z - probe.pose!.z))
      .toBeLessThanOrEqual(0.5)
    expect(probe.states.some((value) => Array.isArray(value)
      && value.includes('Auto-route arrived at the selected ground.'))).toBe(true)
  })
})
