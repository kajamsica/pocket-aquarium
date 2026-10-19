import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PublicV17Controller, publicV17ActionForView,
  publicV17ReticleAimX, publicV17SuggestedWorkAimX,
  publicV17WorkRouteForView } from './PublicV17Controller'
import { createPublicV17ControllerRuntime } from './PublicV17ControllerRuntime'
import { publicWorldV17ViewProjection } from './PublicV17WorldView'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createPublicV17ContinuousSession } from './domain/publicWorldV17ContinuousSession'
import { startFreshPublicV17 } from './domain/publicWorldV17Flow'
import { createFreshPublicV17Head } from './domain/publicWorldV17Snapshot'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import type { WizardViewIntent, WizardViewProjection } from './view/contracts'
import { keyboardMovementIntents, savedWorkKeyboardIntent } from './view/WizardSurface'

const seed = 'wizard-realms'
const queuedInput = () => controllerProbe.refs.find((ref) => !!ref.current
  && typeof ref.current === 'object' && 'tokens' in ref.current)!.current as {
  tokens: Array<{ type: string; intent?: WizardViewIntent;
    pulse?: { vector: readonly [number, number]; jumping: boolean } | null }>
  queuedCommands: () => number
}
const controllerProbe = vi.hoisted(() => ({ enabled: false, tick: null as (() => void) | null,
  keepRefs: false, reuseRefs: false, refCursor: 0, refs: [] as { current: unknown }[],
  forceCanRun: false,
  forceUiTargets: false,
  onIntent: null as ((intent: WizardViewIntent) => void) | null,
  projection: null as WizardViewProjection | null,
  runtime: null as ReturnType<typeof createPublicV17ControllerRuntime> | null }))
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useRef: (value: unknown) => {
    const ref = actual.useRef(value)
    if (!controllerProbe.keepRefs) return ref
    const index = controllerProbe.refCursor++
    if (controllerProbe.reuseRefs) return controllerProbe.refs[index] ?? ref
    controllerProbe.refs[index] = ref
    return ref
  }, useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    if (controllerProbe.enabled) { effect(); return }
    return actual.useEffect(effect, deps)
  } }
})
vi.mock('./view/WizardSurface', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./view/WizardSurface')>()
  return { ...actual, WizardSurface: (props: Parameters<typeof actual.WizardSurface>[0]) => {
    if (controllerProbe.enabled) {
      controllerProbe.onIntent = props.onIntent
      controllerProbe.projection = props.projection
      return null
    }
    return actual.WizardSurface(props)
  } }
})
vi.mock('./PublicV17ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV17ControllerRuntime')>()
  return { ...actual, createPublicV17ControllerRuntime:
    (...args: Parameters<typeof actual.createPublicV17ControllerRuntime>) => {
      const runtime = actual.createPublicV17ControllerRuntime(...args)
      if (controllerProbe.enabled) controllerProbe.runtime = runtime
      return runtime
    } }
})
vi.mock('./PublicV17WorldView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV17WorldView')>()
  return { ...actual, publicWorldV17ViewProjection:
    (...args: Parameters<typeof actual.publicWorldV17ViewProjection>) => {
      const projection = actual.publicWorldV17ViewProjection(...args)
      if (controllerProbe.forceUiTargets) return { ...projection,
        openStoreId: args[4] ?? null,
        nearbyStoreId: 'store-greenway',
        nearbyInteraction: { kind: 'store', targetId: 'store-greenway',
          label: 'Greenway Store', action: 'Open', actionable: true },
        stores: [{ id: 'store-greenway', name: 'Greenway Store',
          position: projection.player.position,
          listings: [{ id: 'spade', name: 'Spade', price: 1, stock: 1 }], sellOffers: [] }],
        savedTerrainWorks: { ...projection.savedTerrainWorks!,
          preview: { selected: { site: { id: 'works4:bridge:greenway-creek:0' },
            rejection: null } } },
      } as unknown as ReturnType<typeof actual.publicWorldV17ViewProjection>
      return controllerProbe.forceCanRun ? { ...projection,
        gait: { ...projection.gait!, canRun: true } } : projection
    } }
})

describe('v17 playable controller', () => {
  it('exposes opt-in bounded input diagnostics and preserves checked save phase order', async () => {
    const store = createAtomicV17Store(new FakeFactory())
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV17(locks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    vi.stubGlobal('window', { location: { hostname: '127.0.0.1', search: '?inputTrace=1' },
      setInterval: (tick: () => void) => { controllerProbe.tick = tick; return 1 },
      clearInterval: () => {} })
    controllerProbe.enabled = controllerProbe.keepRefs = true
    controllerProbe.refCursor = 0
    try {
      const markup = renderToStaticMarkup(createElement(PublicV17Controller,
        { start: started.value, locks, store }))
      expect(markup).toContain('Input trace (local diagnostics)')
      expect(markup).toContain('Download JSON')
      expect(markup).not.toContain('<details open')
      const trace = controllerProbe.refs.find((ref) => !!ref.current
        && typeof ref.current === 'object' && 'json' in ref.current)!.current as {
          json(): string
        }
      controllerProbe.onIntent!({ type: 'movement', vector: [0, 1], atMs: 100 })
      controllerProbe.runtime!.advanceFrame([], false)
      expect((await controllerProbe.runtime!.save()).status).toBe('saved')
      const records = JSON.parse(trace.json()).records as Array<{ event: string; data: unknown }>
      expect(records.filter((record) => record.event !== 'save.phase').map((record) => record.event)).toEqual([
        'controller.receive', 'save.lock.request', 'save.lock.acquired',
        'save.read.start', 'save.read.finished', 'save.commit.start',
        'save.commit.finished', 'save.lock.finished',
      ])
      expect(records[0].data).toMatchObject({ type: 'movement', eventAtMs: 100 })
      expect(records.filter((record) => record.event === 'save.phase').map((record) =>
        (record.data as { phase: string }).phase)).toEqual([
        'atomic-raw-read', 'atomic-decode', 'previous-replay', 'checked-records',
        'incoming-replay', 'encode-final-replay', 'commit-preflight', 'commit-transaction',
      ])
      expect(trace.json()).not.toContain('lineage')
    } finally {
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.refs = []; controllerProbe.refCursor = 0
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      vi.unstubAllGlobals()
    }
  })
  it('runs only one fixed physics frame for several UI clicks inside 50 ms', () => {
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = true
    try {
      const { head, lineage } = createFreshPublicV17Head(seed)
      renderToStaticMarkup(createElement(PublicV17Controller, {
        start: { state: head.state, greenwayWorks: head.greenwayWorks,
          bootstrap: null, saveRevision: 0, lineage },
        locks: { request: async <T,>(_name: string,
          _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() },
        store: createAtomicV17Store(new FakeFactory()),
      }))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      const initialTick = runtime.view().tick
      click({ type: 'movement', vector: [0, 1], atMs: 0 })
      for (const atMs of [10, 20, 30, 40]) {
        now = atMs; click({ type: 'saved-work.mode', active: true })
        expect(runtime.view().tick).toBe(initialTick)
      }
      now = 50; controllerProbe.tick!()
      expect(runtime.view().tick).toBe(initialTick + 1)
    } finally {
      controllerProbe.enabled = false
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  })

  it('describes the grounded frame cap as a paused save boundary, not a queued click', () => {
    vi.stubGlobal('window', { setInterval: () => 1, clearInterval: () => {} })
    const { head, lineage } = createFreshPublicV17Head(seed)
    const props = { start: { state: head.state, greenwayWorks: head.greenwayWorks,
      bootstrap: null, saveRevision: 0, lineage },
    locks: { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() },
    store: createAtomicV17Store(new FakeFactory()) }
    controllerProbe.enabled = controllerProbe.keepRefs = true
    controllerProbe.refCursor = 0
    try {
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      const runtime = controllerProbe.runtime!
      for (let index = 0; index < 128; index++)
        expect(runtime.advanceFrame([], false).rejections).toEqual([])
      expect(runtime.status().gate).toBe('cap-paused')
      controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
      const markup = renderToStaticMarkup(createElement(PublicV17Controller, props))
      expect(markup).toContain('Frame cap reached: world time is paused')
      expect(markup).toContain('No inputs queued')
      expect(markup).not.toContain('Checkpoint backpressure')
      expect(markup).toMatch(/<p role="status"[^>]*height:42px[^>]*>Frame cap reached/)
    } finally {
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.refCursor = 0; controllerProbe.refs = []
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      vi.unstubAllGlobals()
    }
  })

  it('clears paused W/S credits without dropping accepted jump or touch taps', () => {
    vi.stubGlobal('window', { setInterval: () => 1, clearInterval: () => {} })
    const { head, lineage } = createFreshPublicV17Head(seed)
    const props = { start: { state: head.state, greenwayWorks: head.greenwayWorks,
      bootstrap: null, saveRevision: 0, lineage },
    locks: { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() },
    store: createAtomicV17Store(new FakeFactory()) }
    controllerProbe.enabled = controllerProbe.keepRefs = true
    controllerProbe.refCursor = 0
    try {
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      for (let index = 0; index < 96; index++)
        expect(runtime.advanceFrame([], false).rejections).toEqual([])
      click({ type: 'movement', vector: [0, 1], atMs: 10 })
      click({ type: 'movement', vector: [0, 0], atMs: 610 })
      click({ type: 'jump' })
      click({ type: 'movement.tap', vector: [1, 0] })
      click({ type: 'movement', vector: [0, 0] })
      click({ type: 'movement', vector: [0, -1], atMs: 620 })
      click({ type: 'movement', vector: [0, 0], atMs: 720 })
      click({ type: 'movement', vector: [0, 0] })
      expect(queuedInput().queuedCommands()).toBe(2)
      expect(queuedInput().tokens.flatMap((item) => item.pulse ?? []))
        .toMatchObject([{ vector: [0, 0], jumping: true },
          { vector: [1, 0], jumping: false }])
    } finally {
      controllerProbe.enabled = controllerProbe.keepRefs = false
      controllerProbe.refCursor = 0; controllerProbe.refs = []
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      vi.unstubAllGlobals()
    }
  })

  it('visibly rejects an airborne checked click and still lands on neutral frames', async () => {
    const factory = new FakeFactory(), store = createAtomicV17Store(factory)
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV17(locks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = controllerProbe.keepRefs = true
    controllerProbe.refCursor = 0
    try {
      const props = { start: started.value, locks, store }
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      const axe = controllerProbe.projection!.backpack.stacks.find(
        (stack) => stack.itemId === 'woodcutters_axe')!
      for (let index = 0; index < 95; index++) runtime.advanceFrame([], false)
      expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
      expect(runtime.status().pendingFrames).toBe(96)
      expect(runtime.view().player.verticalVelocity).not.toBe(0)
      now = 10; click({ type: 'movement', vector: [0, 1], atMs: now })
      click({ type: 'equipment.equip', stackId: axe.id, slot: 'mainHand' })
      expect(runtime.preview().state.player.equipment.mainHand).not.toBe('woodcutters_axe')
      controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
      expect(renderToStaticMarkup(createElement(PublicV17Controller, props)))
        .toContain('Land before interacting. Action was not queued.')
      expect(runtime.status().saveRevision).toBe(0)
      const landingFrames = vi.spyOn(runtime, 'advanceFrame')
      for (let index = 1; index <= 32 && runtime.view().player.verticalVelocity !== 0; index++) {
        const priorTick = runtime.view().tick
        now = index * 50; controllerProbe.tick!()
        expect(runtime.view().tick).toBe(priorTick + 1)
      }
      expect(landingFrames.mock.calls.every(([intents]) => intents.length === 0)).toBe(true)
      expect(runtime.view().player.verticalVelocity).toBe(0)
      expect(runtime.status().pendingFrames).toBeGreaterThan(96)
      await vi.waitFor(() => expect(runtime.status()).toMatchObject({ gate: 'open',
        saveRevision: 1, pendingFrames: 0 }), { timeout: 4000 })
      expect(runtime.preview().state.player.equipment.mainHand).not.toBe('woodcutters_axe')
    } finally {
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.refCursor = 0; controllerProbe.refs = []
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  }, 10000)

  it('pauses world time during a slow checkpoint without filling the click queue or replaying elapsed minutes', async () => {
    const store = createAtomicV17Store(new FakeFactory())
    const directLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV17(directLocks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    let release!: () => void
    const heldWriter = new Promise<void>((resolve) => { release = resolve })
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => {
      await heldWriter; return callback()
    } }
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = controllerProbe.keepRefs = true
    controllerProbe.refCursor = 0
    try {
      const props = { start: started.value, locks, store }
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      for (let index = 0; index < 64; index++) runtime.advanceFrame([], false)
      now = 50; controllerProbe.tick!()
      expect(runtime.status().gate).toBe('checkpointing')
      controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
      expect(renderToStaticMarkup(createElement(PublicV17Controller, props)))
        .toContain('Checked save running in background; movement remains available')
      click({ type: 'saved-work.mode', active: true })
      for (let index = 2; index <= 33; index++) {
        now = index * 50; controllerProbe.tick!()
      }
      expect(runtime.status().pendingFrames).toBe(96)
      const pausedTick = runtime.view().tick
      controllerProbe.refCursor = 0
      const neutralMarkup = renderToStaticMarkup(createElement(PublicV17Controller, props))
      expect(neutralMarkup).toContain('Checkpoint in progress')
      expect(neutralMarkup).toContain('No inputs queued')
      expect(neutralMarkup).toContain('0 queued steps, 0 queued commands')
      expect(neutralMarkup).not.toContain('Checkpoint backpressure')
      now = 1700
      click({ type: 'saved-work.kind', kind: 'ladder' })
      for (let index = 0; index < 10; index++)
        click({ type: 'saved-work.aim', aimX: index / 10 })
      const keys = new Set<string>()
      for (let index = 34; index <= 300; index++) {
        now = index * 50
        if (index === 100 || index === 112)
          for (const intent of keyboardMovementIntents(keys, 'KeyW', index === 100, now)) click(intent)
        if (index === 113) {
          click({ type: 'movement', vector: [0, 0] }) // Map open or window blur clears controls.
          expect(queuedInput().tokens.some((item) => item.pulse !== null
            && item.pulse !== undefined)).toBe(false)
        }
        if (index === 116 || index === 128)
          for (const intent of keyboardMovementIntents(keys, 'KeyW', index === 116, now)) click(intent)
        if (index === 130 || index === 131)
          for (const intent of keyboardMovementIntents(keys, 'KeyD', index === 130, now)) click(intent)
        controllerProbe.tick!()
      }
      expect(runtime.view().tick).toBe(pausedTick)
      const queue = queuedInput()
      expect(queue.tokens.some((item) => item.intent?.type === 'saved-work.kind')).toBe(true)
      expect(queue.tokens.filter((item) => item.pulse !== null && item.pulse !== undefined)
        .map((item) => item.pulse?.vector)).toEqual([[0, 1], [1, 0]])
      expect(queue.tokens.length).toBeLessThan(40)
      controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
      const waitingMarkup = renderToStaticMarkup(createElement(PublicV17Controller, props))
      expect(waitingMarkup).toContain('Checkpoint backpressure')
      expect(waitingMarkup).toContain('world time is paused for the checked save')
      expect(waitingMarkup).not.toContain('New clicks or key commands were refused')
      const beforePausedPress = runtime.view().player.position
      const resumedFrames = vi.spyOn(runtime, 'advanceFrame')
      release()
      await vi.waitFor(() => expect(runtime.status().gate).toBe('open'))
      expect(runtime.status().saveRevision).toBe(1)
      now = 15050; controllerProbe.tick!()
      now = 15100; controllerProbe.tick!()
      for (const atMs of [15150, 15200, 15250]) {
        now = atMs; controllerProbe.tick!()
      }
      await vi.waitFor(() => expect(queue.tokens).toHaveLength(0))
      expect(runtime.view().player.position).not.toEqual(beforePausedPress)
      expect(resumedFrames.mock.calls.filter(([intents]) => intents.some((intent) =>
        intent.type === 'move'))).toHaveLength(1)
      expect(resumedFrames.mock.calls.length).toBeLessThan(34)
      controllerProbe.refCursor = 0
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      expect(controllerProbe.projection!.savedTerrainWorks).toMatchObject({
        modeActive: true, selectedKind: 'ladder', aimX: 0.9,
      })
      controllerProbe.refCursor = 0
      expect(renderToStaticMarkup(createElement(PublicV17Controller, props)))
        .not.toContain('Checkpoint in progress')
      expect(runtime.view().player.yaw).not.toBe(started.value.state.player.yaw)
      now = 15260; click({ type: 'movement', vector: [0, 0], atMs: now })
      now = 15300; controllerProbe.tick!()
      const beforeFreshMovement = runtime.view().player.position
      now = 15310; click({ type: 'movement', vector: [0, 1], atMs: now })
      now = 15350; controllerProbe.tick!()
      expect(runtime.view().player.position).not.toEqual(beforeFreshMovement)
    } finally {
      release()
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.refCursor = 0; controllerProbe.refs = []
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  }, 10000)

  it('keeps a queued early click ordered while an airborne checkpoint lands on neutral frames', async () => {
    const store = createAtomicV17Store(new FakeFactory())
    const directLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV17(directLocks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    let release!: () => void
    const heldWriter = new Promise<void>((resolve) => { release = resolve })
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => {
      await heldWriter; return callback()
    } }
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = controllerProbe.keepRefs = true
    controllerProbe.refCursor = 0
    try {
      const props = { start: started.value, locks, store }
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      for (let index = 0; index < 64; index++) runtime.advanceFrame([], false)
      now = 50; controllerProbe.tick!()
      expect(runtime.status().gate).toBe('checkpointing')
      expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
      expect(runtime.view().player.verticalVelocity).not.toBe(0)
      now = 55; click({ type: 'saved-work.mode', active: true })
      expect(queuedInput().tokens.some((item) => item.intent?.type === 'saved-work.mode'))
        .toBe(true)
      for (let index = 2; index <= 33; index++) {
        now = index * 50; controllerProbe.tick!()
      }
      const pausedTick = runtime.view().tick
      now = 15000; controllerProbe.tick!()
      expect(runtime.view().tick).toBe(pausedTick)
      const queued = queuedInput()
      expect(queued.tokens.length).toBeLessThan(34)
      const neutral = vi.spyOn(runtime, 'advanceFrame')
      release()
      await vi.waitFor(() => expect(runtime.status().gate).toBe('open'))
      now = 15050; controllerProbe.tick!()
      now = 15100; controllerProbe.tick!()
      await vi.waitFor(() => expect(queued.tokens).toHaveLength(0))
      expect(neutral.mock.calls.every(([intents]) => intents.length === 0)).toBe(true)
      expect(runtime.view().player.verticalVelocity).toBe(0)
    } finally {
      release()
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.refCursor = 0; controllerProbe.refs = []
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  }, 10000)

  it('orders jump, queued mode, and later airborne kind without blocking landing', async () => {
    const store = createAtomicV17Store(new FakeFactory())
    const directLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV17(directLocks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    let release!: () => void
    const heldWriter = new Promise<void>((resolve) => { release = resolve })
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => {
      await heldWriter; return callback()
    } }
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = controllerProbe.keepRefs = true
    controllerProbe.refCursor = 0
    try {
      const props = { start: started.value, locks, store }
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      for (let index = 0; index < 64; index++) runtime.advanceFrame([], false)
      now = 50; controllerProbe.tick!()
      expect(runtime.status().gate).toBe('checkpointing')
      now = 55; click({ type: 'jump' })
      click({ type: 'saved-work.mode', active: true })
      now = 100; controllerProbe.tick!()
      expect(runtime.view().player.verticalVelocity).not.toBe(0)
      now = 105; click({ type: 'saved-work.kind', kind: 'ladder' })
      expect(queuedInput().tokens.filter((item) => item.type === 'intent')
        .map((item) => item.intent?.type)).toEqual(['saved-work.kind'])
      for (let index = 3; index <= 30 && runtime.view().player.verticalVelocity !== 0; index++) {
        now = index * 50; controllerProbe.tick!()
      }
      expect(runtime.view().player.verticalVelocity).toBe(0)
      release()
      await vi.waitFor(() => expect(runtime.status().gate).toBe('open'))
      controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      expect(controllerProbe.projection!.savedTerrainWorks)
        .toMatchObject({ modeActive: true, selectedKind: 'ladder' })
    } finally {
      release()
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.refCursor = 0; controllerProbe.refs = []
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  }, 10000)

  it('does not pause a pending-95 airborne virtual Works boundary during a held save', async () => {
    const store = createAtomicV17Store(new FakeFactory())
    const directLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV17(directLocks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    let release!: () => void
    const heldWriter = new Promise<void>((resolve) => { release = resolve })
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => {
      await heldWriter; return callback()
    } }
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = controllerProbe.keepRefs = true
    controllerProbe.refCursor = 0
    try {
      const props = { start: started.value, locks, store }
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      for (let index = 0; index < 93; index++) runtime.advanceFrame([], false)
      now = 50; controllerProbe.tick!()
      expect(runtime.status()).toMatchObject({ gate: 'checkpointing', pendingFrames: 94 })
      now = 55; click({ type: 'jump' })
      now = 100; controllerProbe.tick!()
      expect(runtime.status().pendingFrames).toBe(95)
      expect(runtime.view().player.verticalVelocity).not.toBe(0)
      now = 105; click({ type: 'saved-work.mode', active: true })
      click({ type: 'saved-work.kind', kind: 'ladder' })
      const beforeLanding = runtime.view().tick
      now = 150; controllerProbe.tick!()
      expect(runtime.view().tick).toBe(beforeLanding + 1)
      now = 155; click({ type: 'movement', vector: [0, 1], atMs: now })
      for (let index = 4; index <= 30 && runtime.view().player.verticalVelocity !== 0; index++) {
        now = index * 50; controllerProbe.tick!()
      }
      expect(runtime.view().player.verticalVelocity).toBe(0)
      const pausedTick = runtime.view().tick
      const sampler = controllerProbe.refs.find((ref) => !!ref.current
        && typeof ref.current === 'object' && 'cursorMs' in ref.current)!.current as {
        cursorMs: number
      }
      const pausedCursor = sampler.cursorMs
      for (let index = 31; index <= 300; index++) {
        now = index * 50; controllerProbe.tick!()
      }
      expect(runtime.view().tick).toBe(pausedTick)
      expect(sampler.cursorMs).toBe(pausedCursor)
      controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
      expect(renderToStaticMarkup(createElement(PublicV17Controller, props)))
        .toContain('Movement was paused while landing at checkpoint reserve')
      release()
      await vi.waitFor(() => expect(runtime.status().gate).toBe('open'))
      const normalFrames = vi.spyOn(runtime, 'advanceFrame')
      now = 15050; controllerProbe.tick!()
      now = 15100; controllerProbe.tick!()
      expect(runtime.view().tick - pausedTick).toBeLessThanOrEqual(1)
      expect(normalFrames.mock.calls.some(([intents]) =>
        intents.some((intent) => intent.type === 'move'))).toBe(true)
      controllerProbe.refCursor = 0
      const resumedMarkup = renderToStaticMarkup(createElement(PublicV17Controller, props))
      expect(controllerProbe.projection!.savedTerrainWorks)
        .toMatchObject({ modeActive: true, selectedKind: 'ladder' })
      expect(resumedMarkup).not.toContain('Movement was paused while landing at checkpoint reserve')
    } finally {
      release()
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.refCursor = 0; controllerProbe.refs = []
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  }, 10000)

  it('keeps a queued tap behind a jump from blocking neutral landing at reserve', async () => {
    const store = createAtomicV17Store(new FakeFactory())
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV17(locks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = controllerProbe.keepRefs = true
    controllerProbe.refCursor = 0
    try {
      const props = { start: started.value, locks, store }
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      for (let index = 0; index < 95; index++) runtime.advanceFrame([], false)
      click({ type: 'jump' })
      click({ type: 'movement.tap', vector: [1, 0] })
      now = 50; controllerProbe.tick!()
      expect(runtime.status().pendingFrames).toBe(96)
      const priorTick = runtime.view().tick
      const frames = vi.spyOn(runtime, 'advanceFrame')
      now = 100; controllerProbe.tick!()
      expect(runtime.view().tick).toBe(priorTick + 1)
      expect(frames.mock.calls.at(-1)?.[0]).toEqual([])
      controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
      expect(renderToStaticMarkup(createElement(PublicV17Controller, props)))
        .toContain('Queued tap or jump was rejected during landing')
    } finally {
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.refCursor = 0; controllerProbe.refs = []
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  })

  it('rejects a checked click queued before a jump becomes airborne and preserves landing', async () => {
    const store = createAtomicV17Store(new FakeFactory())
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV17(locks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = controllerProbe.keepRefs = true
    controllerProbe.refCursor = 0
    try {
      const props = { start: started.value, locks, store }
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      const axe = controllerProbe.projection!.backpack.stacks.find(
        (stack) => stack.itemId === 'woodcutters_axe')!
      for (let index = 0; index < 95; index++) runtime.advanceFrame([], false)
      click({ type: 'jump' })
      click({ type: 'equipment.equip', stackId: axe.id, slot: 'mainHand' })
      now = 50; controllerProbe.tick!()
      expect(runtime.view().player.verticalVelocity).not.toBe(0)
      expect(queuedInput().tokens.some((item) => item.intent?.type === 'equipment.equip'))
        .toBe(false)
      controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
      expect(renderToStaticMarkup(createElement(PublicV17Controller, props)))
        .toContain('Queued action was rejected while airborne')
      now = 100; controllerProbe.tick!()
      expect(runtime.status().pendingFrames).toBe(97)
      expect(runtime.preview().state.player.equipment.mainHand).not.toBe('woodcutters_axe')
    } finally {
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.refCursor = 0; controllerProbe.refs = []
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  })

  it('labels movement-only overflow truthfully and clears it after the sampler recovers', () => {
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = controllerProbe.keepRefs = true
    controllerProbe.refCursor = 0
    try {
      const { head, lineage } = createFreshPublicV17Head(seed)
      const props = { start: { state: head.state, greenwayWorks: head.greenwayWorks,
        bootstrap: null, saveRevision: 0, lineage },
      locks: { request: async <T,>(_name: string,
        _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() },
      store: createAtomicV17Store(new FakeFactory()) }
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      const click = controllerProbe.onIntent!
      for (let index = 0; index < 300; index++) click({ type: 'movement',
        vector: index % 2 ? [1, 0] : [0, 0], atMs: 0 })
      controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
      const overflow = renderToStaticMarkup(createElement(PublicV17Controller, props))
      expect(overflow).toContain('Movement history reached capacity')
      expect(overflow).not.toContain('New clicks or key commands were refused')
      now = 50; controllerProbe.tick!()
      now = 100; controllerProbe.tick!()
      controllerProbe.refCursor = 0
      expect(renderToStaticMarkup(createElement(PublicV17Controller, props)))
        .not.toContain('Input backpressure')
    } finally {
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.refCursor = 0; controllerProbe.refs = []
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  })

  it('visibly refuses the first excess click but keeps the full queue runnable', async () => {
    const store = createAtomicV17Store(new FakeFactory())
    const directLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV17(directLocks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    let release!: () => void
    const heldWriter = new Promise<void>((resolve) => { release = resolve })
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => {
      await heldWriter; return callback()
    } }
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = controllerProbe.keepRefs = true
    controllerProbe.refCursor = 0
    try {
      const props = { start: started.value, locks, store }
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      for (let index = 0; index < 64; index++) runtime.advanceFrame([], false)
      now = 50; controllerProbe.tick!()
      expect(runtime.status().gate).toBe('checkpointing')
      now = 60
      for (let index = 0; index < 129; index++) {
        click({ type: 'saved-work.mode', active: index % 2 === 0 })
      }
      const queue = queuedInput()
      expect(queue.queuedCommands()).toBe(128)
      controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
      const markup = renderToStaticMarkup(createElement(PublicV17Controller, props))
      expect(markup).toContain('New clicks or key commands were refused')
      for (let index = 2; index <= 300; index++) {
        now = index * 50; controllerProbe.tick!()
      }
      controllerProbe.refCursor = 0
      const saturated = renderToStaticMarkup(createElement(PublicV17Controller, props))
      expect(saturated).toContain('world time is paused for the checked save')
      expect(saturated).toContain('New clicks or key commands were refused')
      expect(saturated).not.toContain('Movement history reached capacity')
      release()
      await vi.waitFor(() => expect(runtime.status().gate).toBe('open'))
      now = 15050; controllerProbe.tick!()
      now = 15100; controllerProbe.tick!()
      await vi.waitFor(() => expect(queue.tokens).toHaveLength(0))
      expect(runtime.view().tick).toBeLessThan(100)
      controllerProbe.refCursor = 0
      expect(renderToStaticMarkup(createElement(PublicV17Controller, props)))
        .not.toContain('Input backpressure')
    } finally {
      release()
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.refCursor = 0; controllerProbe.refs = []
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  }, 10000)

  it('keeps accepted tokens intact when a checked checkpoint writer blocks', async () => {
    const store = createAtomicV17Store(new FakeFactory())
    const directLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV17(directLocks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, _callback: () => T | Promise<T>) => {
      throw new Error('writer failed')
    } }
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = controllerProbe.keepRefs = true
    controllerProbe.refCursor = 0
    try {
      const props = { start: started.value, locks, store }
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      for (let index = 0; index < 64; index++) runtime.advanceFrame([], false)
      now = 50; controllerProbe.tick!()
      click({ type: 'movement.tap', vector: [1, 0] })
      const queued = queuedInput()
      expect(queued.tokens).toHaveLength(1)
      await vi.waitFor(() => expect(runtime.status().gate).toBe('blocked'))
      expect(queued.tokens).toHaveLength(1)
      const frozenTick = runtime.view().tick
      for (let index = 2; index <= 20; index++) {
        now = index * 50; controllerProbe.tick!()
      }
      expect(runtime.view().tick).toBe(frozenTick)
      expect(queued.tokens).toHaveLength(1)
      controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
      expect(renderToStaticMarkup(createElement(PublicV17Controller, props)))
        .toContain('Save blocked')
    } finally {
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.refCursor = 0; controllerProbe.refs = []
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  })

  it('replays a queued gait toggle between fixed frames after a held checkpoint', async () => {
    const store = createAtomicV17Store(new FakeFactory())
    const directLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV17(directLocks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    let release!: () => void
    const heldWriter = new Promise<void>((resolve) => { release = resolve })
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => {
      await heldWriter; return callback()
    } }
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = controllerProbe.forceCanRun = true
    try {
      renderToStaticMarkup(createElement(PublicV17Controller,
        { start: started.value, locks, store }))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      for (let index = 0; index < 64; index++) runtime.advanceFrame([], false)
      now = 50; controllerProbe.tick!()
      expect(runtime.status().gate).toBe('checkpointing')
      const frames = vi.spyOn(runtime, 'advanceFrame')
      now = 55; click({ type: 'movement', vector: [0, 1], atMs: now })
      now = 100; controllerProbe.tick!()
      now = 110; click({ type: 'gait.toggle' })
      now = 150; controllerProbe.tick!()
      now = 200; controllerProbe.tick!()
      expect(frames.mock.calls.slice(0, 3).map(([, walking]) => walking))
        .toEqual([false, false, true])
      for (let index = 5; index <= 300; index++) {
        now = index * 50; controllerProbe.tick!()
      }
      expect(frames.mock.calls.length).toBeLessThanOrEqual(31)
      expect(frames.mock.calls.slice(0, 3).map(([, walking]) => walking))
        .toEqual([false, false, true])
      release()
      await vi.waitFor(() => expect(runtime.status().gate).toBe('open'))
      now = 15050; controllerProbe.tick!()
      now = 15100; controllerProbe.tick!()
      await vi.waitFor(() => expect(frames.mock.calls.length).toBeGreaterThanOrEqual(3))
      expect(frames.mock.calls.slice(0, 3).map(([, walking]) => walking))
        .toEqual([false, false, true])
    } finally {
      release()
      controllerProbe.enabled = controllerProbe.forceCanRun = false
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  }, 10000)

  it('shows Works aim and Store immediately during a checkpoint so follow-up clicks are emitted', async () => {
    const store = createAtomicV17Store(new FakeFactory())
    const directLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV17(directLocks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    let release!: () => void
    const heldWriter = new Promise<void>((resolve) => { release = resolve })
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => {
      await heldWriter; return callback()
    } }
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.forceUiTargets = true
    controllerProbe.refCursor = 0
    try {
      const props = { start: started.value, locks, store }
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      for (let index = 0; index < 64; index++) runtime.advanceFrame([], false)
      now = 50; controllerProbe.tick!()
      expect(runtime.status().gate).toBe('checkpointing')
      const renderAgain = () => {
        controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
        renderToStaticMarkup(createElement(PublicV17Controller, props))
        return controllerProbe.projection!
      }
      now = 60; click({ type: 'saved-work.mode', active: true })
      expect(renderAgain().savedTerrainWorks?.modeActive).toBe(true)
      for (let index = 0; index < 200; index++)
        click({ type: 'saved-work.aim', aimX: index / 10 })
      const works = renderAgain()
      expect(works.savedTerrainWorks?.aimX).toBe(19.9)
      const confirm = savedWorkKeyboardIntent('KeyF', works.savedTerrainWorks)
      expect(confirm?.type).toBe('saved-work.confirm')
      click(confirm!)
      now = 70; click({ type: 'interact' })
      const visibleStore = renderAgain()
      expect(visibleStore.openStoreId).toBe('store-greenway')
      click({ type: 'store.select-listing', storeId: 'store-greenway', listingId: 'spade' })
      const queue = queuedInput()
      expect(queue.tokens.filter((item) => item.type === 'intent')
        .map((item) => item.intent?.type)).toEqual([
        'saved-work.mode', 'saved-work.aim', 'saved-work.confirm', 'interact', 'store.select-listing'])
    } finally {
      release()
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.forceUiTargets = false; controllerProbe.refCursor = 0
      controllerProbe.refs = []; controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  }, 10000)

  it('keeps discrete inputs through a held action write without replaying elapsed movement', async () => {
    const factory = new FakeFactory(), store = createAtomicV17Store(factory)
    const baseLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV17(baseLocks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    let release!: () => void
    const heldWriter = new Promise<void>((resolve) => { release = resolve })
    let writes = 0
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => {
      if (++writes === 1) await heldWriter
      return callback()
    } }
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = controllerProbe.keepRefs = true
    controllerProbe.refCursor = 0
    try {
      const props = { start: started.value, locks, store }
      renderToStaticMarkup(createElement(PublicV17Controller, props))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      const initial = runtime.view().player
      const nearbyTree = controllerProbe.projection!.nearbyInteraction!.targetId
      const initialHealth = runtime.preview().state.greenway.resources.find(
        (resource) => resource.id === nearbyTree)!.health
      const axe = controllerProbe.projection!.backpack.stacks.find(
        (stack) => stack.itemId === 'woodcutters_axe')!
      click({ type: 'equipment.equip', stackId: axe.id, slot: 'mainHand' })
      await vi.waitFor(() => expect(writes).toBe(1))
      expect(runtime.status().gate).toBe('barrier')
      controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
      expect(renderToStaticMarkup(createElement(PublicV17Controller, props)))
        .toContain('Checked action in progress: world time is paused')
      const frames = vi.spyOn(runtime, 'advanceFrame')
      for (let index = 1; index <= 60; index++) {
        now = index * 50
        if (now === 50) click({ type: 'movement', vector: [0, 1], atMs: now })
        if (now === 150) click({ type: 'movement', vector: [0, 0], atMs: now })
        if (now === 200) click({ type: 'movement.tap', vector: [1, 0], atMs: now })
        if (now === 300) click({ type: 'jump' })
        if (now === 2500) click({ type: 'interact' })
        controllerProbe.tick!()
      }
      expect(runtime.status().gate).toBe('barrier')
      expect(runtime.view().player.position).toEqual(initial.position)
      release()
      await vi.waitFor(() => expect(runtime.status().gate).toBe('open'))
      for (const tickAt of [3050, 3100, 3150, 3200]) {
        now = tickAt; controllerProbe.tick!()
      }
      expect(runtime.preview().state.greenway.resources.find(
        (resource) => resource.id === nearbyTree)?.health).toBe(initialHealth)
      expect(runtime.view().player.position).not.toEqual(initial.position)
      expect(runtime.view().player.yaw).not.toBe(initial.yaw)
      expect(frames.mock.calls.some(([intents]) => intents.some((intent) => intent.type === 'jump')))
        .toBe(true)
      expect(frames.mock.calls.length).toBeLessThanOrEqual(3)
      controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
      expect(renderToStaticMarkup(createElement(PublicV17Controller, props)))
        .toContain('Queued action was rejected while airborne')
      expect(writes).toBe(1)
    } finally {
      release()
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.refCursor = 0; controllerProbe.refs = []
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  }, 10000)

  it('keeps timed movement and a checked click through an asynchronous checkpoint', async () => {
    const factory = new FakeFactory(), store = createAtomicV17Store(factory)
    const baseLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV17(baseLocks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    let release!: () => void
    const heldWriter = new Promise<void>((resolve) => { release = resolve })
    let writes = 0
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => {
      if (++writes === 1) await heldWriter
      return callback()
    } }
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = true
    try {
      renderToStaticMarkup(createElement(PublicV17Controller,
        { start: started.value, locks, store }))
      const runtime = controllerProbe.runtime!
      const click = controllerProbe.onIntent!
      const axe = controllerProbe.projection!.backpack.stacks.find(
        (stack) => stack.itemId === 'woodcutters_axe')!
      expect(axe).toBeDefined()
      for (let index = 0; index < 64; index++) runtime.advanceFrame([], false)
      now = 50; controllerProbe.tick!()
      expect(runtime.status().gate).toBe('checkpointing')
      const before = runtime.view().player
      const tickBeforeClick = runtime.view().tick
      const sampledFrames = vi.spyOn(runtime, 'advanceFrame')
      now = 55; click({ type: 'movement', vector: [0, 1], atMs: now })
      now = 60; click({ type: 'movement.tap', vector: [1, 0], atMs: now })
      now = 65; click({ type: 'equipment.equip', stackId: axe.id, slot: 'mainHand' })
      expect(runtime.view().tick).toBe(tickBeforeClick)
      expect(runtime.status().pendingFrames).toBe(65)
      now = 70; release()
      await vi.waitFor(() => expect(runtime.status()).toMatchObject({ gate: 'open',
        saveRevision: 1, pendingFrames: 0 }), { timeout: 3000 })
      expect(runtime.preview().state.player.equipment.mainHand).not.toBe('woodcutters_axe')
      now = 100; controllerProbe.tick!()
      await vi.waitFor(() => {
        expect(runtime.preview().state.player.equipment.mainHand).toBe('woodcutters_axe')
        expect(runtime.status()).toMatchObject({ gate: 'open', saveRevision: 3,
          pendingFrames: 0 })
      }, { timeout: 3000 })
      expect(sampledFrames).toHaveBeenCalledTimes(1)
      expect(runtime.view().player.position).not.toEqual(before.position)
      expect(runtime.view().player.yaw).not.toBe(before.yaw)
      now = 110; click({ type: 'movement', vector: [0, 0], atMs: now })
      now = 150; controllerProbe.tick!()
      expect(runtime.status().pendingFrames).toBe(1)
      expect(writes).toBeGreaterThanOrEqual(3)
    } finally {
      release()
      controllerProbe.enabled = false
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  })
  it('renders only the checked v17 session without opening a save', () => {
    const factory = new FakeFactory()
    const opened = vi.spyOn(factory, 'open')
    const { head, lineage } = createFreshPublicV17Head(seed)
    const markup = renderToStaticMarkup(createElement(PublicV17Controller, {
      start: { state: head.state, greenwayWorks: head.greenwayWorks,
        bootstrap: null, saveRevision: 0, lineage },
      locks: { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
        callback: () => T | Promise<T>) => callback() },
      store: createAtomicV17Store(factory),
    }))
    expect(markup).toContain('data-public-v17="true"')
    expect(markup).toContain('data-owner="greenway"')
    expect(markup).toMatch(/<p role="status"[^>]*height:42px[^>]*><\/p>/)
    expect(markup).toContain('Works Off')
    expect(markup).not.toContain('data-public-v16="true"')
    expect(opened).not.toHaveBeenCalled()
  })

  it('reticle aim intersects the creek or cliff plane, while invalid rays stay null', () => {
    expect(publicV17ReticleAimX({ x: 2, z: 5 }, Math.PI, 'bridge')).toBeCloseTo(2)
    expect(publicV17ReticleAimX({ x: 2, z: -3 }, 0, 'ladder')).toBeCloseTo(2)
    expect(publicV17ReticleAimX({ x: 2, z: 5 }, 0, 'bridge')).toBeNull()
    expect(publicV17ReticleAimX({ x: 2, z: 5 }, Math.PI / 2, 'bridge')).toBeNull()
    expect(publicV17ReticleAimX({ x: 2, z: 5 }, NaN, 'bridge')).toBeNull()
    expect(publicV17ReticleAimX({ x: 2, z: 5 }, Math.PI, 'dig')).toBeNull()
  })

  it('starts a Works ladder on the nearest discovered supported lane', () => {
    const view = { savedTerrainWorks: { suggestedSites: [
      { id: 'far', kind: 'ladder', from: { x: -2 } },
      { id: 'near', kind: 'ladder', from: { x: 1.1 } },
      { id: 'creek', kind: 'bridge', from: { x: 0 } },
    ] } } as unknown as WizardViewProjection
    expect(publicV17SuggestedWorkAimX(view, 'ladder', 0)).toBe(1.1)
    expect(publicV17SuggestedWorkAimX(view, 'bridge', 0)).toBe(0)
    expect(publicV17SuggestedWorkAimX({} as WizardViewProjection, 'ladder', 0)).toBeNull()
  })

  it('routes only the exact selected ready snapped ID to checked Greenway work', () => {
    const id = 'works4:bridge:greenway-creek:0'
    expect(resolvePublicV17GreenwaySite(seed, id)?.kind).toBe('bridge')
    const view = { controllerActionsEnabled: true, savedTerrainWorks: {
      context: 'works4-greenway', actionsEnabled: true, modeActive: true,
      preview: { selected: { site: { id }, rejection: null } },
    } } as WizardViewProjection
    expect(publicV17WorkRouteForView(view, id, 'greenway', seed)).toBe('greenway')
    expect(publicV17WorkRouteForView(view, 'works4:bridge:greenway-creek:1',
      'greenway', seed)).toBeNull()
    expect(publicV17WorkRouteForView(view, 'works4:bridge:greenway-creek:00',
      'greenway', seed)).toBeNull()
    expect(publicV17WorkRouteForView({ ...view, controllerActionsEnabled: false },
      id, 'greenway', seed)).toBeNull()
    expect(publicV17WorkRouteForView({ ...view, savedTerrainWorks: {
      ...view.savedTerrainWorks!, modeActive: false } }, id, 'greenway', seed)).toBeNull()
    expect(publicV17WorkRouteForView(view, id, 'streamed', seed)).toBeNull()
  })

  it('maps visible nearby waystone Study and learned Glow cast only in v17 Greenway', () => {
    const { head, lineage } = createFreshPublicV17Head(seed)
    const session = createPublicV17ContinuousSession({ state: head.state,
      greenwayWorks: head.greenwayWorks, saveRevision: 0, lineage })
    const base = publicWorldV17ViewProjection(session.previewSnapshot(), session.view(),
      [], null, null, false, { kind: 'bridge', bodyYaw: 0, aimX: null,
        actionsEnabled: true })
    const inscription = { id: 'greenway_waystone' as const, name: 'Greenway waystone',
      position: base.player.position, spellId: 'wayfinder_glow' as const, studied: false }
    const view: WizardViewProjection = { ...base, controllerActionsEnabled: true,
      inscriptions: [inscription], learnedSpellIds: ['wayfinder_glow'],
    }
    expect(publicV17ActionForView({ type: 'inscription.study',
      inscriptionId: inscription.id }, view, 'greenway'))
      .toEqual({ type: 'study_inscription', inscriptionId: inscription.id })
    expect(publicV17ActionForView({ type: 'spell.cast', spellId: inscription.spellId },
      view, 'greenway')).toEqual({ type: 'cast_spell', spellId: inscription.spellId })
    expect(publicV17ActionForView({ type: 'spell.cast', spellId: inscription.spellId },
      { ...view, learnedSpellIds: [] }, 'greenway')).toBeNull()
    expect(publicV17ActionForView({ type: 'inscription.study',
      inscriptionId: inscription.id }, view, 'streamed')).toBeNull()
  })
})
