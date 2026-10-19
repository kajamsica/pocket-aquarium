import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PublicV16Controller, publicV16ActionForView, publicV16CheckpointDue,
  publicV16CheckpointWithWorkMode, publicV16IdleWorksSampler,
  publicV16WorkRouteForView } from './PublicV16Controller'
import { createPublicV16ControllerRuntime } from './PublicV16ControllerRuntime'
import { publicWorldV16ViewProjection } from './PublicV16WorldView'
import { createAtomicV16Store } from './domain/atomicV16Database'
import { createPublicV16ContinuousSession } from './domain/publicWorldV16ContinuousSession'
import { startFreshPublicV16 } from './domain/publicWorldV16Flow'
import type { PublicV16Start } from './domain/publicWorldV16Flow'
import { resolvePublicV16GreenwaySite } from './domain/publicWorldV16GreenwaySites'
import { createFreshPublicV16Head } from './domain/publicWorldV16Snapshot'
import { createTimedMovementSampler, recordTimedMovement } from './view/timedInput'
import type { WizardViewIntent, WizardViewProjection } from './view/contracts'
import { WizardHud } from './view/WizardHud'
import { savedWorkKeyboardIntent } from './view/WizardSurface'

const seed = 'greenway-alpha'
const controllerProbe = vi.hoisted(() => ({ enabled: false, tick: null as (() => void) | null,
  keepRefs: false, reuseRefs: false, refCursor: 0, refs: [] as { current: unknown }[],
  forceCanRun: false,
  forceUiTargets: false,
  onIntent: null as ((intent: WizardViewIntent) => void) | null,
  projection: null as WizardViewProjection | null,
  runtime: null as ReturnType<typeof createPublicV16ControllerRuntime> | null }))
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
vi.mock('./PublicV16ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV16ControllerRuntime')>()
  return { ...actual, createPublicV16ControllerRuntime:
    (...args: Parameters<typeof actual.createPublicV16ControllerRuntime>) => {
      const runtime = actual.createPublicV16ControllerRuntime(...args)
      if (controllerProbe.enabled) controllerProbe.runtime = runtime
      return runtime
    } }
})
vi.mock('./PublicV16WorldView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV16WorldView')>()
  return { ...actual, publicWorldV16ViewProjection:
    (...args: Parameters<typeof actual.publicWorldV16ViewProjection>) => {
      const projection = actual.publicWorldV16ViewProjection(...args)
      if (controllerProbe.forceUiTargets) return { ...projection,
        openStoreId: args[4] ?? null,
        nearbyStoreId: 'store-greenway',
        nearbyInteraction: { kind: 'store', targetId: 'store-greenway',
          label: 'Greenway Store', action: 'Open', actionable: true },
        stores: [{ id: 'store-greenway', name: 'Greenway Store',
          position: projection.player.position,
          listings: [{ id: 'spade', name: 'Spade', price: 1, stock: 1 }], sellOffers: [] }],
        savedTerrainWorks: { ...projection.savedTerrainWorks!,
          preview: { selected: { site: { id: 'works3:bridge:greenway-creek:0' },
            rejection: null } } },
      } as unknown as ReturnType<typeof actual.publicWorldV16ViewProjection>
      return controllerProbe.forceCanRun ? { ...projection,
        gait: { ...projection.gait!, canRun: true } } : projection
    } }
})
function fresh(): PublicV16Start {
  const { head, lineage } = createFreshPublicV16Head(seed)
  return { state: head.state, greenwayWorks: head.greenwayWorks,
    bootstrap: null, saveRevision: 0, lineage }
}

describe('v16 playable controller', () => {
  it('runs only one fixed physics frame for several UI clicks inside 50 ms', () => {
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = true
    try {
      renderToStaticMarkup(createElement(PublicV16Controller, {
        start: fresh(), locks: { request: async <T,>(_name: string,
          _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() },
        store: createAtomicV16Store(new FakeFactory()),
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

  it('lands past the movement reserve, saves, and drains a queued click', async () => {
    const factory = new FakeFactory(), store = createAtomicV16Store(factory)
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV16(locks, store, seed)
    if (!started.ok) throw new Error(started.reason)
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval: (tick: () => void) => {
      controllerProbe.tick = tick; return 1 }, clearInterval: () => {} })
    controllerProbe.enabled = true
    try {
      renderToStaticMarkup(createElement(PublicV16Controller,
        { start: started.value, locks, store }))
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
      const landingFrames = vi.spyOn(runtime, 'advanceFrame')
      for (let index = 1; index <= 32 && runtime.view().player.verticalVelocity !== 0; index++) {
        const priorTick = runtime.view().tick
        now = index * 50; controllerProbe.tick!()
        expect(runtime.view().tick).toBe(priorTick + 1)
      }
      expect(landingFrames.mock.calls.every(([intents]) => intents.length === 0)).toBe(true)
      expect(runtime.view().player.verticalVelocity).toBe(0)
      expect(runtime.status().pendingFrames).toBeGreaterThan(96)
      await vi.waitFor(() => {
        expect(runtime.preview().state.player.equipment.mainHand).toBe('woodcutters_axe')
        expect(runtime.status()).toMatchObject({ gate: 'open', saveRevision: 2,
          pendingFrames: 0 })
      }, { timeout: 4000 })
    } finally {
      controllerProbe.enabled = false
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  }, 10000)

  it('visibly refuses the first excess click but keeps the full queue runnable', async () => {
    const store = createAtomicV16Store(new FakeFactory())
    const directLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV16(directLocks, store, seed)
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
      renderToStaticMarkup(createElement(PublicV16Controller, props))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      for (let index = 0; index < 64; index++) runtime.advanceFrame([], false)
      now = 50; controllerProbe.tick!()
      expect(runtime.status().gate).toBe('checkpointing')
      now = 60
      for (let index = 0; index < 128; index++) {
        click({ type: 'saved-work.mode', active: index % 2 === 0 })
      }
      const queue = controllerProbe.refs.find((ref) => Array.isArray(ref.current)
        && ref.current.length === 127) as { current: unknown[] }
      expect(queue.current).toHaveLength(127)
      controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
      const markup = renderToStaticMarkup(createElement(PublicV16Controller, props))
      expect(markup).toContain('New clicks were refused')
      now = 70; release()
      await vi.waitFor(() => expect(runtime.status().gate).toBe('open'))
      now = 100; controllerProbe.tick!()
      await vi.waitFor(() => expect(queue.current).toHaveLength(0))
      expect(runtime.view().tick).toBe(66)
    } finally {
      release()
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.refCursor = 0; controllerProbe.refs = []
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  }, 10000)

  it('replays a queued gait toggle between fixed frames after a held checkpoint', async () => {
    const store = createAtomicV16Store(new FakeFactory())
    const directLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV16(directLocks, store, seed)
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
      renderToStaticMarkup(createElement(PublicV16Controller,
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
      expect(frames.mock.calls.map(([, walking]) => walking)).toEqual([false])
      release()
      await vi.waitFor(() => expect(frames.mock.calls).toHaveLength(3))
      expect(frames.mock.calls.map(([, walking]) => walking)).toEqual([false, false, true])
    } finally {
      release()
      controllerProbe.enabled = controllerProbe.forceCanRun = false
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  }, 10000)

  it('shows Works and Store immediately during a checkpoint so follow-up clicks are emitted', async () => {
    const store = createAtomicV16Store(new FakeFactory())
    const directLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV16(directLocks, store, seed)
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
      renderToStaticMarkup(createElement(PublicV16Controller, props))
      const runtime = controllerProbe.runtime!, click = controllerProbe.onIntent!
      for (let index = 0; index < 64; index++) runtime.advanceFrame([], false)
      now = 50; controllerProbe.tick!()
      expect(runtime.status().gate).toBe('checkpointing')
      const renderAgain = () => {
        controllerProbe.reuseRefs = true; controllerProbe.refCursor = 0
        renderToStaticMarkup(createElement(PublicV16Controller, props))
        return controllerProbe.projection!
      }
      now = 60; click({ type: 'saved-work.mode', active: true })
      const works = renderAgain()
      expect(works.savedTerrainWorks?.modeActive).toBe(true)
      const confirm = savedWorkKeyboardIntent('KeyF', works.savedTerrainWorks)
      expect(confirm?.type).toBe('saved-work.confirm')
      click(confirm!)
      now = 70; click({ type: 'interact' })
      const visibleStore = renderAgain()
      expect(visibleStore.openStoreId).toBe('store-greenway')
      click({ type: 'store.select-listing', storeId: 'store-greenway', listingId: 'spade' })
      const queue = controllerProbe.refs.find((ref) => Array.isArray(ref.current)
        && ref.current.length === 4) as { current: Array<{ type: string; intent?: WizardViewIntent }> }
      expect(queue.current.map((item) => item.intent?.type)).toEqual([
        'saved-work.mode', 'saved-work.confirm', 'interact', 'store.select-listing'])
    } finally {
      release()
      controllerProbe.enabled = controllerProbe.keepRefs = controllerProbe.reuseRefs = false
      controllerProbe.forceUiTargets = false; controllerProbe.refCursor = 0
      controllerProbe.refs = []; controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  }, 10000)

  it('buffers three seconds of movement, tap, jump, and a click during an action write', async () => {
    const factory = new FakeFactory(), store = createAtomicV16Store(factory)
    const baseLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV16(baseLocks, store, seed)
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
      renderToStaticMarkup(createElement(PublicV16Controller,
        { start: started.value, locks, store }))
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
      await vi.waitFor(() => {
        expect(runtime.preview().state.greenway.resources.find(
          (resource) => resource.id === nearbyTree)?.health).toBeLessThan(initialHealth)
        expect(runtime.status().gate).toBe('open')
      }, { timeout: 4000 })
      expect(runtime.view().player.position).not.toEqual(initial.position)
      expect(runtime.view().player.yaw).not.toBe(initial.yaw)
      expect(frames.mock.calls.some(([intents]) => intents.some((intent) => intent.type === 'jump')))
        .toBe(true)
      expect(writes).toBeGreaterThanOrEqual(3)
    } finally {
      release()
      controllerProbe.enabled = false
      controllerProbe.tick = controllerProbe.onIntent = null
      controllerProbe.runtime = controllerProbe.projection = null
      clock.mockRestore(); vi.unstubAllGlobals()
    }
  }, 10000)

  it('keeps timed movement and a checked click through an asynchronous checkpoint', async () => {
    const factory = new FakeFactory(), store = createAtomicV16Store(factory)
    const baseLocks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() }
    const started = await startFreshPublicV16(baseLocks, store, seed)
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
      renderToStaticMarkup(createElement(PublicV16Controller,
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
  it('renders only the native checked v16 surface without opening a save', () => {
    const factory = new FakeFactory()
    const opened = vi.spyOn(factory, 'open')
    const markup = renderToStaticMarkup(createElement(PublicV16Controller, {
      start: fresh(), locks: { request: async <T,>(_name: string,
        _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() },
      store: createAtomicV16Store(factory),
    }))
    expect(markup).toContain('data-public-v16="true"')
    expect(markup).toContain('data-owner="greenway"')
    expect(markup).toContain('Works Off')
    expect(markup).not.toContain('data-public-v15="true"')
    expect(opened).not.toHaveBeenCalled()
  })

  it('routes only a current ready canonical Works preview to its checked owner', () => {
    const id = [-3, -2, -1, 0, 1, 2, 3].map((gx) => `works3:ladder:${gx}`)
      .find((candidate) => resolvePublicV16GreenwaySite(seed, candidate))!
    expect(id).toBeDefined()
    const view = { controllerActionsEnabled: true, savedTerrainWorks: {
      actionsEnabled: true, modeActive: true,
      preview: { selected: { site: { id }, rejection: null } },
    } } as WizardViewProjection
    expect(publicV16WorkRouteForView(view, id, 'greenway', seed)).toBe('greenway')
    expect(publicV16WorkRouteForView(view, id, 'streamed', seed)).toBeNull()
    expect(publicV16WorkRouteForView(view, 'works3:ladder:01', 'greenway', seed)).toBeNull()
    expect(publicV16WorkRouteForView({ ...view, controllerActionsEnabled: false },
      id, 'greenway', seed)).toBeNull()
    expect(publicV16WorkRouteForView({ ...view, savedTerrainWorks: {
      ...view.savedTerrainWorks!, modeActive: false } }, id, 'greenway', seed)).toBeNull()
  })

  it('maps only ready, visible Greenway Study and Cast intents to checked actions', () => {
    const session = createPublicV16ContinuousSession(fresh())
    const projection = publicWorldV16ViewProjection(session.previewSnapshot(), session.view(),
      [], null, null, false, { kind: 'bridge', bodyYaw: 0, actionsEnabled: true })
    const inscription = { id: 'greenway_waystone' as const, name: 'Greenway waystone',
      position: projection.player.position, spellId: 'wayfinder_glow' as const, studied: false }
    const view: WizardViewProjection = { ...projection, controllerActionsEnabled: true,
      inscriptions: [inscription], learnedSpellIds: ['wayfinder_glow'] }
    const study = { type: 'inscription.study' as const, inscriptionId: inscription.id }
    const cast = { type: 'spell.cast' as const, spellId: inscription.spellId }
    expect(publicV16ActionForView(study, view, 'greenway'))
      .toEqual({ type: 'study_inscription', inscriptionId: inscription.id })
    expect(publicV16ActionForView(cast, view, 'greenway'))
      .toEqual({ type: 'cast_spell', spellId: inscription.spellId })
    expect(publicV16ActionForView(study, { ...view, inscriptions: [] }, 'greenway')).toBeNull()
    expect(publicV16ActionForView(study, { ...view, inscriptions: [{ ...inscription,
      studied: true }] }, 'greenway')).toBeNull()
    expect(publicV16ActionForView(study, { ...view, inscriptions: [{ ...inscription,
      position: [view.player.position[0] + 4, view.player.position[1],
        view.player.position[2]] }] },
    'greenway')).toBeNull()
    expect(publicV16ActionForView(cast, { ...view, learnedSpellIds: [] }, 'greenway')).toBeNull()
    for (const unavailable of [{ ...view, controllerActionsEnabled: false },
      { ...view, unavailableActions: true as const },
      { ...view, savedTerrainWorks: undefined }]) {
      expect(publicV16ActionForView(study, unavailable, 'greenway')).toBeNull()
      expect(publicV16ActionForView(cast, unavailable, 'greenway')).toBeNull()
    }
    expect(publicV16ActionForView(study, view, 'streamed')).toBeNull()
    expect(publicV16ActionForView(cast, view, 'streamed')).toBeNull()
    const legacyView = { ...view, backpack: { ...view.backpack, stacks: [{ id: 'axe',
      itemId: 'woodcutters_axe', name: 'Axe', quantity: 1 }] } }
    expect(publicV16ActionForView({ type: 'equipment.equip', stackId: 'axe',
      slot: 'mainHand' }, legacyView, 'greenway'))
      .toEqual({ type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' })
  })

  it('offers bridge, ladder, and dig controls in v16 Greenway Works mode', () => {
    const session = createPublicV16ContinuousSession(fresh())
    const view = publicWorldV16ViewProjection(session.previewSnapshot(), session.view(),
      [], null, null, false, { kind: 'ladder', bodyYaw: 0,
        modeActive: true, actionsEnabled: true })
    const markup = renderToStaticMarkup(createElement(WizardHud, {
      projection: view, onIntent: () => {},
    }))
    expect(view.savedTerrainWorks?.context).toBe('works3-greenway')
    expect(markup).toContain('aria-label="Choose bridge"')
    expect(markup).toContain('aria-label="Choose ladder"')
    expect(markup).toContain('aria-label="Choose dig"')
    expect(savedWorkKeyboardIntent('Digit2', view.savedTerrainWorks))
      .toEqual({ type: 'saved-work.kind', kind: 'ladder' })
  })

  it('keeps idle Works open across a checked checkpoint and reserves movement frames', async () => {
    const start = fresh()
    const runtime = createPublicV16ControllerRuntime(start, {
      frames: vi.fn(async (frames, revision, lineage) => {
        const session = createPublicV16ContinuousSession(start)
        for (const frame of frames) session.advanceFrame(frame.intents,
          { walkRequested: frame.walkRequested })
        const ready = session.snapshotForSave()
        if (ready.status === 'deferred-airborne') throw new Error('Unexpected airborne save')
        return { ok: true as const, value: { start: { ...ready.progress,
          bootstrap: null, saveRevision: revision + 1, lineage }, events: [] } }
      }),
      action: vi.fn(async () => ({ ok: false as const, reason: 'action-rejected' })),
      greenwayWork: vi.fn(async () => ({ ok: false as const, reason: 'action-rejected' })),
      work: vi.fn(async () => ({ ok: false as const, reason: 'action-rejected' })),
    })
    const sampler = createTimedMovementSampler(0)
    expect(publicV16IdleWorksSampler(runtime.view(), true,
      { held: [0, 0], tap: null, jump: false, sampler }, 50)?.cursorMs).toBe(50)
    recordTimedMovement(sampler, 25, [0, 1])
    expect(publicV16IdleWorksSampler(runtime.view(), true,
      { held: [0, 0], tap: null, jump: false, sampler }, 50)).toBeNull()
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(publicV16CheckpointDue(runtime.status(), false, true)).toBe(true)
    const mode = { current: true }
    expect((await publicV16CheckpointWithWorkMode(runtime, mode)).status).toBe('saved')
    expect(mode.current).toBe(true)
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0 })
  })
})
