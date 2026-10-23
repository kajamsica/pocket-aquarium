import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PublicV23Controller, publicV23DiscoveredWestSite,
  publicV26PitLadderWitness, publicV26SafetyEscape,
  publicV26SafetyRejectionMessage } from './PublicV23Controller'
import type { PublicV17InputTrace } from './PublicV17InputScheduler'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { createAtomicV24Store } from './domain/atomicV24Database'
import { createAtomicV25Store } from './domain/atomicV25Database'
import { createAtomicV26Store } from './domain/atomicV26Database'
import { createAtomicV27Store } from './domain/atomicV27Database'
import { createAtomicV28Store } from './domain/atomicV28Database'
import { createAtomicV29Store } from './domain/atomicV29Database'
import { createAtomicV30Store } from './domain/atomicV30Database'
import { createAtomicV31Store } from './domain/atomicV31Database'
import { createAtomicV42Store } from './domain/atomicV42Database'
import { createAtomicV43Store } from './domain/atomicV43Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { publicV11Gait } from './domain/publicWorldGait'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { createPublicV23Root, decodePublicV23Progress } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { createPublicV26Root } from './domain/publicWorldV26Snapshot'
import { createPublicV27Root } from './domain/publicWorldV27Snapshot'
import { createPublicV28Root } from './domain/publicWorldV28Snapshot'
import { createPublicV29Root } from './domain/publicWorldV29Snapshot'
import { createPublicV30Root } from './domain/publicWorldV30Snapshot'
import { createPublicV31Root } from './domain/publicWorldV31Snapshot'
import { createFreshPublicV43Root } from './domain/publicWorldV43Snapshot'
import type { PublicV17ActiveView } from './PublicV17WorldView'
import { resolvePublicV23Site } from './domain/publicWorldV23Sites'
import { resolvePublicV14Surface } from './domain/publicWorldV14Terrain'
import type { WizardViewIntent, WizardViewProjection } from './view/contracts'
import { keyboardMovementIntents, savedWorkKeyboardIntent } from './view/WizardSurface'
import type { V9WorkActionCue } from './view/WizardScene'

const workId = 'works4:bridge:greenway-creek:0'
const probe = vi.hoisted(() => ({ enabled: false, reuse: false, cursor: 0,
  now: 0,
  stateCursor: 0, states: [] as unknown[], streamed: false, known: false, airborne: false,
  westPose: false, bootsEquipped: false,
  v43Blocked: false,
  greenwayOak: false, actionEvents: [] as Array<{ type: string }>,
  suggested: false,
  poseOnJump: false, poseOnMove: false,
  refs: [] as { current: unknown }[], tick: null as (() => void) | null,
  onIntent: null as ((intent: WizardViewIntent) => void) | null,
  trace: null as PublicV17InputTrace | null,
  projection: null as WizardViewProjection | null,
  workActionCue: null as V9WorkActionCue | null,
  saveInProgress: null as boolean | null,
  soilPlaceRejection: null as string | null,
  gate: 'open' as 'open' | 'checkpointing' | 'blocked', pending: 0,
  idleNeeded: true, countFrames: false,
  saveCalls: 0, cleanups: [] as Array<() => void>,
  releaseSave: null as ((blocked?: boolean) => void) | null,
  holdAction: false, releaseAction: null as (() => void) | null,
  actionRejection: null as string | null,
  raisedCell: false,
  pitOpportunity: false, ownPitLadder: false,
  frames: [] as Array<readonly { type: string; yawDelta?: number }[]>, actions: [] as unknown[],
  frameRejections: [] as Array<{ intentType: string; message: string } | null>,
  events: [] as string[], v31ViewCalls: 0, v31FrameCount: 0,
  v31Rejections: [] as string[], v31Status: null as { saveRevision: number;
    pendingFrames: number } | null, v31View: null as PublicV17ActiveView | null,
  v31FreshView: null as (() => PublicV17ActiveView) | null }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: (initial: unknown) => {
    const state = actual.useState(initial), value = state[0]
    if (!probe.enabled) return state
    const index = probe.stateCursor++
    if (!probe.reuse) probe.states[index] = value
    return [probe.states[index], (next: unknown) => {
      probe.states[index] = typeof next === 'function'
        ? (next as (prior: unknown) => unknown)(probe.states[index]) : next
    }]
  }, useRef: (value: unknown) => {
    const ref = actual.useRef(value)
    if (!probe.enabled) return ref
    const index = probe.cursor++
    return probe.reuse ? probe.refs[index] ?? ref : (probe.refs[index] = ref)
  }, useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    if (probe.enabled) { const cleanup = effect(); if (cleanup) probe.cleanups.push(cleanup); return }
    return actual.useEffect(effect, deps)
  } }
})
vi.mock('./view/WizardSurface', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./view/WizardSurface')>()
  return { ...actual, WizardSurface: (props: Parameters<typeof actual.WizardSurface>[0]) => {
    if (probe.enabled) { probe.onIntent = props.onIntent; probe.projection = props.projection
      probe.trace = props.inputTrace ?? null
      probe.workActionCue = props.workActionCue ?? null
      probe.saveInProgress = props.saveInProgress ?? false
      probe.soilPlaceRejection = props.soilPlaceRejection ?? null
      return null }
    return actual.WizardSurface(props)
  } }
})
vi.mock('./PublicV23WorldView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV23WorldView')>()
  return { ...actual, publicWorldV23ViewProjection:
    (...args: Parameters<typeof actual.publicWorldV23ViewProjection>) => {
      const view = actual.publicWorldV23ViewProjection(...args)
      if (!probe.enabled) return view
      if (probe.westPose) {
        const site = resolvePublicV23Site(seed, 'works5:ladder:mireglass-slate:W:-103:4306')!
        const choice = { site: { ...site, obstacle: 'slate_cliff' as const },
          rejection: 'too_far' as const, angleRadians: 0, distanceMeters: 2,
          benefit: 'Four logs support a reusable west-facing cliff climb.',
          reason: 'Move east onto grounded dry terrain at or east of the lower foot, within 3 m.' }
        return { ...view, regionalLadders: { builtSites: [], preview: { site,
          rejection: 'too_far' } }, savedTerrainWorks: { ...view.savedTerrainWorks!,
          preview: { selected: choice, nearby: [choice], guidance: null } } } as
          ReturnType<typeof actual.publicWorldV23ViewProjection>
      }
      const oak = probe.greenwayOak ? view.resources.find((resource) => resource.kind === 'tree') : null
      return { ...view, ...(oak ? { nearbyInteraction: { kind: 'resource' as const,
        targetId: oak.id, label: oak.label, action: 'Chop', actionable: true },
        resources: view.resources.map((resource) => resource.id === oak.id
          ? { ...resource, available: true } : resource) } : {}), ...(probe.bootsEquipped
        ? { gait: publicV11Gait('leather_boots', args[5]) } : {}),
        savedTerrainWorks: { ...view.savedTerrainWorks!, modeActive: true,
        actionsEnabled: true, preview: { selected: { site: { id: workId },
          rejection: null } }, ...(probe.suggested ? { suggestedSites: [
            { id: 'creek', kind: 'bridge', from: { x: 1.1 } },
          ] } : {}) } } as ReturnType<typeof actual.publicWorldV23ViewProjection>
    } }
})
vi.mock('./PublicV26WorldView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV26WorldView')>()
  return { ...actual, publicWorldV26ViewProjection:
    (...args: Parameters<typeof actual.publicWorldV26ViewProjection>) => {
      const view = actual.publicWorldV26ViewProjection(...args)
      if (!probe.enabled) return view
      const [x, , z] = view.player.position
      return { ...view,
        ...(probe.pitOpportunity ? { v26PitLadderOpportunity:
          { gx: 3, gz: 1, logCost: 4 as const } } : {}),
        ...(probe.ownPitLadder ? { v26PitLadders: [{ cellId: 'saved-pit-ladder',
          gx: Math.ceil(x / 16 - 0.5), gz: Math.ceil(z / 16 - 0.5),
          floorY: 0, rimY: 0.8 }] } : {}) }
    } }
})
vi.mock('./PublicV23ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV23ControllerRuntime')>()
  const scripted = <T extends ReturnType<typeof actual.createPublicV23ControllerRuntime>
    | ReturnType<typeof actual.createPublicV24ControllerRuntime>
    | ReturnType<typeof actual.createPublicV25ControllerRuntime>>(base: T): T => {
      if (!probe.enabled) return base
      return { ...base,
        view: () => { const view = base.view(); return probe.airborne ? { ...view,
          player: { ...view.player, verticalVelocity: 1 } } : view },
        status: () => ({ ...base.status(), gate: probe.gate, pendingFrames: probe.pending }),
        idleFrameNeeded: () => probe.idleNeeded,
        save: () => new Promise((resolve) => {
          probe.saveCalls++
          probe.gate = 'checkpointing'
          probe.releaseSave = (blocked = false) => {
            probe.gate = blocked ? 'blocked' : 'open'; probe.pending = 0
            resolve(blocked ? { status: 'blocked', reason: 'source-changed' }
              : { status: 'saved', events: [], resetWalkRequested: false })
          }
        }),
        action: async (witness: unknown) => { probe.actions.push(witness);
          probe.events.push('action')
          if (probe.holdAction) await new Promise<void>((resolve) => { probe.releaseAction = resolve })
          return probe.actionRejection ? { status: 'rejected', reason: probe.actionRejection }
            : { status: 'saved', events: probe.actionEvents, resetWalkRequested: false } },
        advanceFrame: (intents: readonly { type: string; yawDelta?: number }[]) => {
          probe.frames.push(intents); probe.events.push(`frame:${intents.map((intent) =>
            intent.type).join(',')}`)
          if (probe.countFrames) probe.pending++
          if ((probe.poseOnJump && intents.some((intent) => intent.type === 'jump'))
            || (probe.poseOnMove && intents.some((intent) => intent.type === 'move'))) {
            probe.airborne = true; if (!probe.countFrames) probe.pending++
          }
          const rejection = probe.frameRejections.shift()
          return { events: [], rejections: rejection
            ? [{ intentIndex: 0, code: 'terrain_missing', ...rejection }] : [] } },
      } as unknown as T
    }
  return { ...actual,
    createPublicV23ControllerRuntime:
      (...args: Parameters<typeof actual.createPublicV23ControllerRuntime>) =>
        scripted(actual.createPublicV23ControllerRuntime(...args)),
    createPublicV24ControllerRuntime:
      (...args: Parameters<typeof actual.createPublicV24ControllerRuntime>) =>
        scripted(actual.createPublicV24ControllerRuntime(...args)),
    createPublicV25ControllerRuntime:
      (...args: Parameters<typeof actual.createPublicV25ControllerRuntime>) =>
        scripted(actual.createPublicV25ControllerRuntime(...args)),
  }
})
vi.mock('./PublicV26ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV26ControllerRuntime')>()
  return { ...actual, createPublicV26ControllerRuntime:
    (...args: Parameters<typeof actual.createPublicV26ControllerRuntime>) => {
      const base = actual.createPublicV26ControllerRuntime(...args)
      if (!probe.enabled) return base
      return { ...base,
        status: () => ({ ...base.status(), gate: probe.gate, pendingFrames: probe.pending }),
        idleFrameNeeded: () => probe.idleNeeded,
        action: async (witness: unknown) => { probe.actions.push(witness)
          return probe.actionRejection ? { status: 'rejected' as const, reason: probe.actionRejection }
            : { status: 'saved' as const, events: [], resetWalkRequested: false } },
        advanceFrame: (intents: readonly { type: string }[]) => {
          probe.frames.push(intents)
          const rejection = probe.frameRejections.shift()
          return { events: [], rejections: rejection
            ? [{ intentIndex: 0, code: 'terrain_missing' as const, ...rejection }] : [] }
        } }
    } }
})
vi.mock('./PublicV31ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV31ControllerRuntime')>()
  return { ...actual, createPublicV31ControllerRuntime:
    (...args: Parameters<typeof actual.createPublicV31ControllerRuntime>) => {
      const base = actual.createPublicV31ControllerRuntime(...args)
      if (!probe.enabled) return base
      probe.v31FreshView = () => base.view()
      return { ...base,
        view: () => { probe.v31ViewCalls++; return (probe.v31View = base.view()) },
        advanceFrame: (...frameArgs: Parameters<typeof base.advanceFrame>) => {
          const result = base.advanceFrame(...frameArgs)
          probe.v31FrameCount++
          probe.v31Rejections.push(...result.rejections.map((rejection) => rejection.message))
          probe.v31Status = base.status()
          return result
        },
        preview: () => ({ ...base.preview(),
          raisedSoilCells: probe.raisedCell ? [{ gx: 1, gz: 0 }] : [] }),
        action: async (witness: unknown) => { probe.actions.push(witness)
          return probe.actionRejection
            ? { status: 'rejected' as const, reason: probe.actionRejection }
            : { status: 'saved' as const, events: [], resetWalkRequested: false } } }
    } }
})
vi.mock('./PublicV43ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV43ControllerRuntime')>()
  return { ...actual, createPublicV43ControllerRuntime:
    (...args: Parameters<typeof actual.createPublicV43ControllerRuntime>) => {
      const base = actual.createPublicV43ControllerRuntime(...args)
      return !probe.enabled ? base : { ...base,
        status: () => probe.v43Blocked ? { ...base.status(), gate: 'blocked' as const,
          blockedReason: 'test-blocked' } : base.status(),
        action: async (witness: Parameters<typeof base.action>[0]) => {
          probe.actions.push(witness)
          return { status: 'saved' as const, events: [], resetWalkRequested: false }
        } }
    } }
})

const seed = 'greenway-alpha'
const lock = { request: async <T,>(_name: string,
  _options: { mode: 'exclusive' }, body: () => T | Promise<T>) => body() }
const props = () => { const factory = new IDBFactory(), root = createPublicV23Root(seed)
  const site = resolvePublicV23Site(seed, 'works5:ladder:mireglass-slate:W:-103:4306')!
  const currentTile = resolvePublicV14Surface(root.head.state, site.from)!.tileId
  const start = !probe.streamed ? root : { ...root, head: { ...root.head,
    state: { ...root.head.state, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set(probe.known
        ? [...site.footprintTileIds, currentTile] : [currentTile])].sort()),
      player: { ...root.head.state.player, position: probe.westPose
        ? { x: -413.92, y: site.from.y, z: 430.08 } : { ...site.from } } } } }
  return { start,
  locks: lock, store: createAtomicV23Store(factory), sourceStore: createAtomicV17Store(factory) } }
const v24Props = () => { const factory = new IDBFactory(), source = createPublicV23Root(seed)
  return { version: 'v24' as const, start: createPublicV24Root(source), locks: lock,
    store: createAtomicV24Store(factory), sourceStore: createAtomicV23Store(factory),
    ancestorStore: createAtomicV17Store(factory) } }
const v25Props = () => { const factory = new IDBFactory(), v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  return { version: 'v25' as const, start: v25, locks: lock,
    store: createAtomicV25Store(factory), sourceStore: createAtomicV24Store(factory),
    v23Store: createAtomicV23Store(factory), v17Store: createAtomicV17Store(factory) } }
const v26Props = () => { const factory = new IDBFactory(), v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  return { version: 'v26' as const, start: v26, locks: lock,
    store: createAtomicV26Store(factory), sourceStore: createAtomicV25Store(factory),
    v24Store: createAtomicV24Store(factory), v23Store: createAtomicV23Store(factory),
    v17Store: createAtomicV17Store(factory) } }
let preparedV31Start: ReturnType<typeof createPublicV31Root> | null = null
let preparedStreamedV31Start: ReturnType<typeof createPublicV31Root> | null = null
let preparedV43Start: ReturnType<typeof createFreshPublicV43Root> | null = null
let preparedBridgeheadV43Start: ReturnType<typeof createFreshPublicV43Root> | null = null
function v31FromV23(v23: ReturnType<typeof createPublicV23Root>) {
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
  return createPublicV31Root(v30)
}
function prepareV31Start() { const v23 = createPublicV23Root(seed)
  preparedV31Start = v31FromV23(v23)
  const point = { x: -157.42, z: 83.37 }
  const floor = resolvePublicV14Surface(v23.head.state, point)
  if (!floor) throw new Error('Missing streamed V31 test support')
  const progress = decodePublicV23Progress({ state: { ...v23.head.state,
    movementOwner: 'streamed', discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(v23.head.state.discoveryMask), floor.tileId])].sort()),
    player: { ...v23.head.state.player,
      position: { ...point, y: floor.floorY }, yaw: Math.PI } },
  greenwayWorks: v23.head.greenwayWorks, regionalWorks: v23.head.regionalWorks }, seed)
  if (!progress) throw new Error('Invalid streamed V31 test progress')
  preparedStreamedV31Start = v31FromV23({ ...v23, head: { ...v23.head, ...progress,
    saveRevision: 1, witness: { kind: 'checkpoint' } } })
}
function prepareV43Start() {
  preparedV43Start = createFreshPublicV43Root('wizard-realms')
  const head = preparedV43Start.head
  const bridge = resolvePublicV17GreenwaySite(head.state.seed, workId)
  if (!bridge || bridge.kind !== 'bridge') throw new Error('Missing Greenway creek bridge')
  const greenwayWorks = { ...head.greenwayWorks, builtBridgeIds: [bridge.id] }
  const support = publicV17StarterSupportAt({ seed: head.state.seed,
    profile: head.state.generationProfile,
    route: head.state.greenway.routes[0] ?? null,
    built: false, greenwayWorks }, bridge.exit)
  if (!support || support.kind !== 'ground') throw new Error('Missing dry bridge exit')
  preparedBridgeheadV43Start = { ...preparedV43Start, head: {
    ...head, greenwayWorks, state: { ...head.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(head.state.discoveryMask), ...bridge.footprintTileIds])].sort()),
      player: { ...head.state.player, xp: head.state.player.xp + 80,
        skillXp: { ...head.state.player.skillXp, construction: 80 },
        position: { ...bridge.exit, y: support.floorY } } } } }
}
const v31Props = () => { const factory = new IDBFactory()
  if (!preparedV31Start) throw new Error('V31 test ancestry was not prepared')
  const start = probe.streamed ? preparedStreamedV31Start : preparedV31Start
  if (!start) throw new Error('Streamed V31 test ancestry was not prepared')
  return { version: 'v31' as const, start, locks: lock,
    store: createAtomicV31Store(factory), sourceStore: createAtomicV30Store(factory),
    v29Store: createAtomicV29Store(factory), v28Store: createAtomicV28Store(factory),
    v27Store: createAtomicV27Store(factory), v26Store: createAtomicV26Store(factory),
    v25Store: createAtomicV25Store(factory), v24Store: createAtomicV24Store(factory),
    v23Store: createAtomicV23Store(factory), v17Store: createAtomicV17Store(factory) } }
function mountV31() {
  probe.enabled = true; probe.cursor = probe.stateCursor = 0
  vi.spyOn(performance, 'now').mockImplementation(() => probe.now)
  vi.stubGlobal('window', { location: { hostname: 'localhost', search: '' },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    setInterval: (tick: () => void) => { probe.tick = tick; return 1 }, clearInterval: () => {} })
  vi.stubGlobal('document', { hidden: false,
    addEventListener: vi.fn(), removeEventListener: vi.fn() })
  return renderToStaticMarkup(createElement(PublicV23Controller, v31Props()))
}
function rerenderV31() {
  probe.reuse = true; probe.cursor = probe.stateCursor = 0
  return renderToStaticMarkup(createElement(PublicV23Controller, v31Props()))
}
function mountV43(start: NonNullable<typeof preparedV43Start>) {
  probe.enabled = true; probe.cursor = probe.stateCursor = 0
  vi.spyOn(performance, 'now').mockImplementation(() => probe.now)
  vi.stubGlobal('window', { location: { hostname: 'localhost', search: '?publicWorld=v43' },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    setInterval: (tick: () => void) => { probe.tick = tick; return 1 }, clearInterval: () => {} })
  vi.stubGlobal('document', { hidden: false,
    addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const factory = new IDBFactory()
  return renderToStaticMarkup(createElement(PublicV23Controller, {
    version: 'v43', start, locks: lock,
    store: createAtomicV43Store(factory), v42Store: createAtomicV42Store(factory) }))
}
function mount(trace = false, v24 = false, v25 = false, v26 = false) {
  probe.enabled = true; probe.cursor = probe.stateCursor = 0
  vi.spyOn(performance, 'now').mockImplementation(() => probe.now)
  vi.stubGlobal('window', { location: { hostname: 'localhost',
    search: trace ? '?inputTrace=1' : '' },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    setInterval: (tick: () => void) => { probe.tick = tick; return 1 },
    clearInterval: () => {} })
  vi.stubGlobal('document', { hidden: false,
    addEventListener: vi.fn(), removeEventListener: vi.fn() })
  return renderToStaticMarkup(createElement(PublicV23Controller,
    v26 ? v26Props() : v25 ? v25Props() : v24 ? v24Props() : props()))
}
function rerender(v24 = false, v25 = false, v26 = false) {
  probe.reuse = true; probe.cursor = probe.stateCursor = 0
  return renderToStaticMarkup(createElement(PublicV23Controller,
    v26 ? v26Props() : v25 ? v25Props() : v24 ? v24Props() : props()))
}
function move() {
  probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
  probe.tick!()
}
function advanceAirborneFrame(airborne: boolean) {
  probe.airborne = airborne
  probe.pending++
}
const beforeUnload = () => vi.mocked(window.addEventListener).mock.calls
  .find(([type]) => type === 'beforeunload')?.[1] as (event: BeforeUnloadEvent) => void
const visibilityChange = () => vi.mocked(document.addEventListener).mock.calls
  .find(([type]) => type === 'visibilitychange')?.[1] as () => void
const savePanel = (html: string) => html.match(/<div class="v23-save">([\s\S]*?)<\/div>/)?.[1] ?? ''
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve() }
afterEach(() => { probe.enabled = probe.reuse = probe.streamed = probe.known = probe.airborne = false
  probe.westPose = false; probe.bootsEquipped = false; probe.greenwayOak = false
  probe.v43Blocked = false
  probe.actionEvents = []
  probe.now = 0
  probe.suggested = false
  probe.poseOnJump = probe.poseOnMove = false
  probe.cursor = probe.stateCursor = 0; probe.refs = []; probe.states = []
  probe.tick = probe.onIntent = probe.releaseSave = null; probe.projection = probe.trace = null
  probe.workActionCue = null
  probe.saveInProgress = null
  probe.soilPlaceRejection = null
  probe.holdAction = false; probe.releaseAction = null
  probe.actionRejection = null
  probe.raisedCell = false
  probe.pitOpportunity = probe.ownPitLadder = false
  probe.gate = 'open'; probe.pending = 0; probe.frames = []; probe.actions = [];
  probe.frameRejections = []
  probe.idleNeeded = true; probe.countFrames = false
  probe.events = []; probe.saveCalls = 0; probe.cleanups = []
  probe.v31ViewCalls = probe.v31FrameCount = 0; probe.v31Rejections = []
  probe.v31Status = probe.v31View = probe.v31FreshView = null
  vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('V23 controller input admission', () => {
  it('closes open Safety on Escape and returns focus to its summary without hijacking other keys', () => {
    const focus = vi.fn(), preventDefault = vi.fn(), stopPropagation = vi.fn()
    const details = { open: true, querySelector: vi.fn(() => ({ focus })) }
    const event = (key: string) => ({ key, currentTarget: details,
      preventDefault, stopPropagation }) as unknown as Parameters<typeof publicV26SafetyEscape>[0]
    publicV26SafetyEscape(event('Enter'))
    expect(details.open).toBe(true)
    expect(preventDefault).not.toHaveBeenCalled()
    publicV26SafetyEscape(event('Escape'))
    expect(details.open).toBe(false)
    expect(focus).toHaveBeenCalledOnce()
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(stopPropagation).toHaveBeenCalledOnce()
    publicV26SafetyEscape(event('Escape'))
    expect(stopPropagation).toHaveBeenCalledOnce()
  })

  it('explains an unmapped E interaction without inventing an action or naming an old world', () => {
    mount(false, false, false, true)
    probe.onIntent!({ type: 'interact' })
    expect(probe.actions).toEqual([])
    expect((probe.states[1] as string[]).at(-1)).toBe(
      'No available E interaction here. Move near an actionable object or use its explicit control.')
  })

  it('projects input-neutral repeat-chop feedback for the interact intent used by click and touch', async () => {
    probe.greenwayOak = true; probe.holdAction = true
    probe.actionEvents = [{ type: 'resource_damaged' }]
    mount()
    const oak = probe.projection!.resources.find((resource) => resource.kind === 'tree')
    expect(oak).toBeDefined()
    probe.onIntent!({ type: 'interact' })
    expect(probe.actions).toEqual([{ kind: 'legacy-action', intent: {
      type: 'harvest', resourceId: oak!.id } }])
    probe.onIntent!({ type: 'interact' })
    expect(probe.actions).toHaveLength(1)
    expect((probe.states[1] as string[]).at(-1)).toBe(
      'That chop did not count: a checked action is pending. Wait for it to finish, then chop again.')
    rerender()
    expect(probe.workActionCue).toBeNull()
    expect(probe.projection!.recentEvents.at(-1)).toContain('That chop did not count')
    probe.releaseAction!(); await settle()
    expect((probe.states[1] as string[]).at(-1)).toBe(
      'Oak chopped once and saved. Chop again to gather 4 logs.')
    rerender()
    expect(probe.workActionCue).toEqual({ kind: 'Chop', sequence: 1 })
    expect(probe.projection!.recentEvents.at(-1)).toBe(
      'Oak chopped once and saved. Chop again to gather 4 logs.')
    probe.holdAction = false
    probe.actionEvents = [{ type: 'resource_harvested' }, { type: 'skill_xp_gained' }]
    probe.onIntent!({ type: 'interact' }); await settle()
    expect(probe.actions).toHaveLength(2)
    expect((probe.states[1] as string[]).at(-1)).toBe(
      'Oak felled. Four logs saved to your backpack.')
    rerender()
    expect(probe.workActionCue).toEqual({ kind: 'Chop', sequence: 2 })
    expect(probe.projection!.recentEvents.at(-1)).toBe('Oak felled. Four logs saved to your backpack.')
    probe.actionRejection = 'too_far'
    probe.onIntent!({ type: 'interact' }); await settle()
    rerender()
    expect(probe.actions).toHaveLength(3)
    expect(probe.workActionCue).toEqual({ kind: 'Chop', sequence: 2 })
  })

  it('plays Cast only after a checked spell event is saved', async () => {
    probe.greenwayOak = true
    probe.actionEvents = [{ type: 'spell_cast' }]
    mount()
    probe.onIntent!({ type: 'interact' }); await settle()
    rerender()
    expect(probe.workActionCue).toEqual({ kind: 'Cast', sequence: 1 })

    probe.actionRejection = 'blocked'
    probe.onIntent!({ type: 'interact' }); await settle()
    rerender()
    expect(probe.workActionCue).toEqual({ kind: 'Cast', sequence: 1 })
  })

  it('ignores barefoot pace toggles so newly equipped boots begin at the default run pace', () => {
    mount()
    expect(probe.projection?.gait).toMatchObject({ canRun: false, pace: 'walk' })
    probe.onIntent!({ type: 'gait.toggle' })
    expect(probe.states[2]).toBe(false)
    probe.bootsEquipped = true
    rerender()
    expect(probe.projection?.gait).toMatchObject({ canRun: true, pace: 'run' })
    probe.onIntent!({ type: 'gait.toggle' })
    rerender()
    expect(probe.projection?.gait).toMatchObject({ canRun: true, pace: 'walk' })
  })

  it('explains exact creek and cliff rejections on deliberate retries, then clears after travel', () => {
    probe.idleNeeded = false
    probe.frameRejections = [
      { intentType: 'move', message: 'Build a Greenway bridge lane to cross the creek.' },
      { intentType: 'move', message: 'Build a Greenway bridge lane to cross the creek.' },
      { intentType: 'move', message: 'Build a ladder at this cliff face.' },
      null,
    ]
    mount()
    probe.onIntent!({ type: 'movement', vector: [0, 1] })
    probe.tick!()
    expect(rerender()).toContain('Chop 8 logs. Open Works (tap Works or press B), then choose Bridge.')
    expect(probe.states[1]).toEqual(['Build a Greenway bridge lane to cross the creek.'])
    probe.now = 1000; move()
    expect(probe.states[1]).toHaveLength(1)
    expect(rerender()).toContain('Chop 8 logs. Open Works (tap Works or press B), then choose Bridge.')
    probe.now = 1100; move()
    expect(rerender()).toContain('Chop 4 logs. Open Works (tap Works or press B), then choose Ladder.')
    expect(probe.states[1]).toHaveLength(2)
    move()
    expect(rerender()).not.toContain('class="v23-obstacle-cue"')
  })

  it('shows a compact V25 starting guide and the exact river bridge hint without repeating held cues', () => {
    probe.idleNeeded = false
    const river = 'River crossing blocked. Build a bridge to cross.'
    probe.frameRejections = [
      { intentType: 'move', message: river },
      { intentType: 'move', message: river },
      { intentType: 'move', message: 'No supported move at this position.' },
    ]
    const initial = mount(false, false, true)
    expect(initial).toContain('data-public-version="v25"')
    expect(initial).toContain('<details class="v23-guide v25-start-guide">')
    expect(initial).toContain('<summary>First steps: chop trees for logs</summary>')
    expect(initial).toContain('A river bridge costs 8 logs; a cliff ladder costs 4.')
    expect(initial).toContain('Equip boots to run')
    expect(initial).not.toContain('click to dig')
    expect(initial).not.toContain('return home')
    probe.onIntent!({ type: 'movement', vector: [0, 1] })
    probe.tick!()
    expect(rerender(false, true)).toContain(`${river} A bridge costs 8 logs. Open Works (tap Works or press B), then choose Bridge.`)
    expect(probe.states[1]).toEqual([river])
    probe.now = 1000; move()
    expect(probe.states[1]).toEqual([river])
    probe.now = 1100; move()
    const html = rerender(false, true)
    expect(html).toContain('No supported move at this position.')
    expect(html).not.toContain(`${river} A bridge costs 8 logs`)
    expect(probe.states[1]).toEqual([river, 'No supported move at this position.'])
  })

  it('queues exact V26 terrain witnesses, reports results, and explains checked river and cliff stops', async () => {
    probe.idleNeeded = false
    mount(false, false, false, true)
    probe.onIntent!({ type: 'v26.terrain', kind: 'dig', gx: 3, gz: 1 })
    await settle()
    expect(probe.actions).toEqual([{ kind: 'terrain-action/v1',
      action: { kind: 'dig', gx: 3, gz: 1 } }])
    expect(probe.states[1]).toContain('Dig saved at column 3, 1.')
    rerender(false, false, true)
    expect(probe.workActionCue).toEqual({ kind: 'Dig', sequence: 1 })
    probe.actionRejection = 'requires-soil'
    probe.onIntent!({ type: 'v26.terrain', kind: 'fill', gx: 3, gz: 1 })
    await settle()
    expect(probe.actions.at(-1)).toEqual({ kind: 'terrain-action/v1',
      action: { kind: 'fill', gx: 3, gz: 1 } })
    expect(probe.states[1]).toContain('Earn soil by digging before filling this column.')
    rerender(false, false, true)
    expect(probe.workActionCue).toEqual({ kind: 'Dig', sequence: 1 })
    probe.frameRejections = [
      { intentType: 'move', message: 'River crossing blocked. Build a bridge to cross.' },
      { intentType: 'move', message: 'Build a ladder at this cliff face.' },
    ]
    probe.onIntent!({ type: 'movement', vector: [0, 1] })
    probe.tick!()
    expect(rerender(false, false, true)).toContain('A bridge costs 8 logs.')
    move()
    expect(rerender(false, false, true)).toContain('Chop 4 logs.')
  })

  it('shows V26-only checked escape controls with 44px pit action and cooldown copy', () => {
    probe.pitOpportunity = true
    expect(publicV26PitLadderWitness({ gx: 3, gz: 1, logCost: 4 })).toEqual({
      kind: 'pit-ladder/v1', action: { kind: 'place-pit-ladder', gx: 3, gz: 1 } })
    expect(publicV26SafetyRejectionMessage('not_trapped'))
      .toContain('only when every checked exit is blocked')
    expect(publicV26SafetyRejectionMessage('cooldown')).toContain('30 minutes')
    const v26 = mount(false, false, false, true)
    expect(v26).toContain('aria-label="Pit safety actions"')
    expect(v26).toContain('Build pit ladder (4 logs)')
    expect(v26).toContain('Return home if trapped')
    expect(v26).toContain('min-height:44px')
    expect(v26).toContain('30-minute cooldown')
    probe.pitOpportunity = false
    const ordinary = rerender(false, false, true)
    expect(ordinary).not.toContain('Build pit ladder (4 logs)')
    expect(ordinary).toMatch(/<button[^>]*>Return home if trapped<\/button>/)
    expect(ordinary).not.toMatch(/<button[^>]*disabled=""[^>]*>Return home if trapped<\/button>/)
    probe.ownPitLadder = true
    const laddered = rerender(false, false, true)
    expect(laddered).toMatch(/<button[^>]*disabled=""[^>]*>Return home if trapped<\/button>/)
    const old = rerender(false, true)
    expect(old).not.toContain('Pit safety actions')
    expect(old).not.toContain('Return home if trapped')
  })

  it('rearms a fresh touch tap after expiry before interval cleanup and keeps unknown errors verbatim', () => {
    probe.idleNeeded = false
    const ownerMessage = 'The receiving owner rejected this crossing.'
    probe.frameRejections = [
      { intentType: 'move', message: ownerMessage },
      { intentType: 'move', message: ownerMessage },
      { intentType: 'move', message: ownerMessage },
    ]
    mount(); move()
    expect(rerender()).toContain(ownerMessage)
    expect(rerender()).not.toContain('Chop 8 logs')
    expect(rerender()).not.toContain('Chop 4 logs')
    probe.now = 1000; move()
    expect(probe.states[1]).toEqual([ownerMessage])
    probe.now = 4601
    move()
    expect(rerender()).toContain('class="v23-obstacle-cue"')
    expect(probe.states[1]).toEqual([ownerMessage, ownerMessage])
  })

  it('stops a blocked hold, expires its cue, then rearms after release', () => {
    probe.idleNeeded = false
    const creek = 'Build a Greenway bridge lane to cross the creek.'
    probe.frameRejections = [{ intentType: 'move', message: creek }]
    mount()
    probe.onIntent!({ type: 'movement', vector: [0, 1] })
    probe.tick!()
    probe.now = 1000; probe.tick!()
    probe.now = 3600; probe.tick!()
    expect(rerender()).not.toContain('class="v23-obstacle-cue"')
    probe.now = 8200; probe.tick!()
    expect(rerender()).not.toContain('class="v23-obstacle-cue"')
    expect(probe.frames.filter((frame) => frame.some((intent) => intent.type === 'move')))
      .toHaveLength(1)
    expect(probe.states[1]).toEqual([creek])
    probe.onIntent!({ type: 'movement', vector: [0, 0] })
    probe.now = 11701; probe.tick!()
    expect(rerender()).not.toContain('class="v23-obstacle-cue"')
    expect(probe.frames.filter((frame) => frame.some((intent) => intent.type === 'move')))
      .toHaveLength(1)
    expect(probe.states[1]).toEqual([creek])
    probe.frameRejections = [{ intentType: 'move', message: creek }]
    probe.onIntent!({ type: 'movement', vector: [0, 1] })
    probe.tick!()
    expect(rerender()).toContain('Chop 8 logs. Open Works (tap Works or press B), then choose Bridge.')
    expect(probe.states[1]).toEqual([creek, creek])
  })

  it('uses the same exact rejection cue on the V24 entry', () => {
    probe.idleNeeded = false
    probe.frameRejections = [{ intentType: 'move', message: 'No supported move at this position.' }]
    mount(false, true); move()
    const html = rerender(true)
    expect(html).toContain('data-public-version="v24"')
    expect(html).toContain('class="v23-obstacle-cue"')
    expect(html).toContain('No supported move at this position.')
    expect(html).not.toContain('Chop 8 logs')
    expect(html).not.toContain('<details class="v23-guide v25-start-guide"')
  })

  it('shows terrain rejection for a combined pivot and move even when replay labels the first look intent', () => {
    probe.idleNeeded = false
    probe.frameRejections = [{ intentType: 'look', message: 'No supported move at this position.' }]
    mount()
    probe.onIntent!({ type: 'movement.tap', vector: [1, 1], source: 'keyboard' })
    probe.tick!()
    expect(probe.frames[0].map((intent) => intent.type)).toEqual(['look', 'move'])
    expect(rerender()).toContain('class="v23-obstacle-cue"')
  })

  it('never shows an obstacle cue for idle or jump rejections', () => {
    probe.frameRejections = [{ intentType: 'move', message: 'Idle movement error.' },
      { intentType: 'jump', message: 'Jump only from supported ground.' }]
    mount(); probe.tick!()
    expect(rerender()).not.toContain('class="v23-obstacle-cue"')
    probe.onIntent!({ type: 'jump' }); probe.tick!()
    expect(rerender()).not.toContain('class="v23-obstacle-cue"')
  })

  it('keeps an untouched opening and a checked idle checkpoint clean', async () => {
    probe.idleNeeded = false
    const opening = mount()
    const event = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent
    for (let index = 0; index < 80; index++) probe.tick!()
    expect(probe.frames).toEqual([])
    expect(savePanel(opening)).not.toContain('Save now')
    beforeUnload()(event)
    expect(event.preventDefault).not.toHaveBeenCalled()

    probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
    probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type))).toEqual([['move']])
    probe.pending = 1
    Object.assign(document, { hidden: true }); visibilityChange()()
    probe.releaseSave!(); await settle()
    for (let index = 0; index < 80; index++) probe.tick!()
    const saved = rerender()
    expect(probe.frames).toHaveLength(1)
    expect(savePanel(saved)).toContain('V23 progress saved on this device.')
    expect(savePanel(saved)).not.toContain('newer progress is not yet saved')
    beforeUnload()(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it.each([
    ['V23', false], ['V24', true],
  ])('saves grounded pending travel on the next idle tick without a neutral frame (%s)',
    async (_, v24) => {
      probe.idleNeeded = false; probe.countFrames = true; mount(false, v24)
      probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
      probe.tick!()
      expect(probe.frames[0].map((intent) => intent.type)).toEqual(['move'])
      expect(probe.pending).toBe(1)
      expect(probe.saveCalls).toBe(0)
      probe.tick!()
      expect(probe.frames).toHaveLength(1)
      expect(probe.saveCalls).toBe(1)
      probe.releaseSave!(); await settle()
      for (let index = 0; index < 80; index++) probe.tick!()
      expect(probe.frames).toHaveLength(1)
      expect(probe.pending).toBe(0)
      const saved = rerender(v24)
      expect(savePanel(saved)).toContain(`V${v24 ? 24 : 23} progress saved on this device.`)
      expect(savePanel(saved)).not.toContain('newer progress is not yet saved')
      const event = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent
      beforeUnload()(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    })

  it.each([
    ['an idle frame is needed', true, false],
    ['the player is airborne', false, true],
  ])('continues simulation instead of early-saving when %s', (_, idleNeeded, airborne) => {
    probe.idleNeeded = idleNeeded; probe.countFrames = true; probe.poseOnMove = airborne; mount()
    probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
    probe.tick!()
    probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['move'], []])
    expect(probe.saveCalls).toBe(0)
  })

  it('shows pending travel, active save, and a checked saved notice without claiming an early save', async () => {
    probe.pending = 1
    const pending = mount()
    expect(probe.saveInProgress).toBe(false)
    expect(savePanel(pending)).toContain('Save now</button>')
    expect(savePanel(pending)).toContain('Travel since the last checkpoint is not saved.')
    expect(pending).not.toContain('V23 progress saved on this device.')

    Object.assign(document, { hidden: true })
    visibilityChange()()
    expect(probe.saveCalls).toBe(1)
    const saving = rerender()
    expect(probe.saveInProgress).toBe(true)
    expect(savePanel(saving)).toContain('Save now</button>')
    expect(savePanel(saving)).toContain('Saving progress')
    expect(savePanel(saving)).toContain('disabled=""')
    visibilityChange()()
    expect(probe.saveCalls).toBe(1)

    probe.releaseSave!(); await settle()
    const saved = rerender()
    expect(probe.saveInProgress).toBe(false)
    expect(savePanel(saved)).not.toContain('Save now</button>')
    expect(savePanel(saved)).toContain('V23 progress saved on this device.')
    probe.pending = 1
    const newerTravel = rerender()
    expect(savePanel(newerTravel)).toContain('Save now</button>')
    expect(savePanel(newerTravel)).toContain('Last checkpoint saved on this device; newer progress is not yet saved.')
  })

  it('keeps a failed save visibly blocked and disables Save now', async () => {
    probe.pending = 1; mount()
    Object.assign(document, { hidden: true }); visibilityChange()()
    const saving = rerender()
    expect(probe.saveInProgress).toBe(true)
    expect(savePanel(saving)).toContain('Saving progress')
    probe.releaseSave!(true); await settle()
    const blocked = rerender()
    expect(probe.saveInProgress).toBe(false)
    expect(blocked).toContain('Save blocked')
    expect(blocked).toContain('Movement is frozen; keep this tab open.')
    expect(savePanel(blocked)).not.toContain('Save now</button>')
    expect(blocked).not.toContain('V23 progress saved on this device.')
    probe.pending = 1
    const blockedWithPendingTravel = rerender()
    expect(savePanel(blockedWithPendingTravel)).toContain('Save now</button>')
    expect(savePanel(blockedWithPendingTravel)).toContain('disabled=""')
    expect(savePanel(blockedWithPendingTravel)).toContain('Save blocked. Keep this tab open.')
  })

  it('warns before unloading pending or saving travel, but not checked progress', async () => {
    mount()
    const event = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent
    beforeUnload()(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    probe.pending = 1
    beforeUnload()(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.returnValue).toBe('')

    Object.assign(document, { hidden: true }); visibilityChange()()
    probe.pending = 0
    beforeUnload()(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    probe.releaseSave!(); await settle()
    beforeUnload()(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
  })

  it('warns before unloading queued movement or an active checked action', async () => {
    probe.holdAction = true; mount()
    const event = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent
    probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
    beforeUnload()(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    probe.tick!()
    beforeUnload()(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)

    probe.onIntent!({ type: 'saved-work.confirm', id: workId })
    expect(probe.releaseAction).not.toBeNull()
    beforeUnload()(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    probe.releaseAction!(); await settle()
    beforeUnload()(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
  })

  it('removes the unload and visibility listeners during cleanup', () => {
    mount()
    const unload = beforeUnload(), visibility = visibilityChange()
    probe.cleanups[0]()
    expect(window.removeEventListener).toHaveBeenCalledWith('beforeunload', unload)
    expect(document.removeEventListener).toHaveBeenCalledWith('visibilitychange', visibility)
  })

  it('keeps V23 overlays clear of both mobile touch clusters and out of document flow', () => {
    const markup = mount(), css = markup.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
    expect(markup).not.toContain('class="v23-guide"')
    expect(markup).toContain('<style>')
    expect(css).toContain('position:fixed')
    expect(css).toContain('pointer-events:none')
    expect(css).toContain('.v23-obstacle-cue{position:fixed')
    expect(css).toContain('text-align:center;pointer-events:none')
    expect(css).toContain('[data-public-v23]:has(.wr-map-backdrop) .v23-obstacle-cue{display:none}')
    const compactCue = css.match(/@media\(max-height:400px\)\{\[data-public-v23\] \.v23-obstacle-cue\{top:(\d+)px;max-height:calc\(100dvh - (\d+)px - env\(safe-area-inset-bottom,0px\)\)/)
    expect(compactCue).not.toBeNull()
    const cueTop = Number(compactCue?.[1]), cueReserve = Number(compactCue?.[2])
    for (const safeInset of [0, 24]) {
      expect(cueTop + (320 - cueReserve - safeInset))
        .toBeLessThanOrEqual((320 - 16 - safeInset) - 14 - (2 * 58 + 5))
    }
    expect(css).toContain('[data-public-v23]:has(.wr-map-backdrop) .v23-guide,[data-public-v23]:has(.wr-map-backdrop) .v23-aim{display:none}')
    expect(css).not.toContain('[data-public-v23]:has(.wr-map-backdrop) .v23-status{display:none}')
    expect(css).toContain('max-height:calc(100dvh - 184px - env(safe-area-inset-bottom,0px))')
    expect(css).toContain('[data-public-v23]{height:calc(100dvh - 16px - env(safe-area-inset-bottom,0px))}')
    expect(css).toContain('[data-public-v23] .wr-surface{height:100%;min-height:0}')
    expect(css).toContain('overflow-y:auto')
    expect(css).toContain('(min-width:720px) and (max-width:900px) and (max-height:590px)')
    const bottom = Number(css.match(/bottom:calc\((\d+)px \+ env\(safe-area-inset-bottom/)?.[1])
    const rightReserve = Number([...css.matchAll(/width:min\(300px,calc\(100vw - (\d+)px\)\)/g)]
      .at(-1)?.[1])
    expect(bottom).toBeGreaterThan(14 + 2 * 58 + 5) // D-pad top row
    expect(rightReserve).toBeGreaterThan(14 + 72) // touch-action column
  })

  it('gives a sub-50ms W/S tap one step and never double-counts a held key', () => {
    mount()
    probe.onIntent!({ type: 'movement', vector: [0, 1], atMs: 1 })
    probe.onIntent!({ type: 'movement', vector: [0, 0], atMs: 20 })
    probe.tick!(); probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type))).toEqual([['move'], []])
    probe.onIntent!({ type: 'movement', vector: [0, -1], atMs: 51 })
    probe.now = 101; probe.tick!(); probe.now = 151; probe.tick!()
    expect(probe.frames.slice(2).map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['move'], ['move']])
  })

  it('keeps a short W tap when key events reach the controller late', () => {
    probe.idleNeeded = false; mount()
    probe.now = 100
    probe.onIntent!({ type: 'movement', vector: [0, 1], atMs: 1 })
    probe.now = 120
    probe.onIntent!({ type: 'movement', vector: [0, 0], atMs: 35 })
    probe.now = 150; probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['move']])
  })

  it('coalesces open-gate tap feedback into the consuming frame repaint', () => {
    mount()
    const redraws = probe.states[0]
    probe.now = 10
    probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
    expect(probe.states[0]).toBe(redraws)
    probe.now = 50; probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type))).toEqual([['move']])
    expect(probe.states[0]).toBe((redraws as number) + 1)
  })

  it('still repaints queued feedback when the runtime gate is closed', () => {
    probe.gate = 'checkpointing'; mount()
    const redraws = probe.states[0]
    probe.now = 10
    probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
    expect(probe.states[0]).toBe((redraws as number) + 1)
    expect(probe.frames).toHaveLength(0)
  })

  it('repaints once when keyup cancels unconsumed open-gate held input', () => {
    probe.idleNeeded = false
    mount(true)
    probe.now = 1
    probe.onIntent!({ type: 'movement', vector: [0, 1], atMs: 1 })
    const redraws = probe.states[0]
    probe.now = 180
    probe.onIntent!({ type: 'movement', vector: [0, 0], atMs: 180 })
    expect(probe.states[0]).toBe((redraws as number) + 1)
    expect(probe.trace!.json()).toContain('held-direction-change')
    probe.now = 200; probe.tick!()
    expect(probe.frames.filter((frame) => frame.some((intent) => intent.type === 'move')))
      .toHaveLength(0)
    expect(probe.states[0]).toBe((redraws as number) + 1)
    probe.now = 250; probe.tick!()
    expect(probe.frames.filter((frame) => frame.some((intent) => intent.type === 'move')))
      .toHaveLength(0)
  })

  it('clears held-key queue feedback after keyup while checkpointing', () => {
    probe.gate = 'checkpointing'; mount()
    probe.now = 1
    probe.onIntent!({ type: 'movement', vector: [0, 1], atMs: 1 })
    const redraws = probe.states[0]
    probe.now = 180
    probe.onIntent!({ type: 'movement', vector: [0, 0], atMs: 180 })
    expect(probe.states[0]).toBe((redraws as number) + 1)
    expect(probe.frames).toHaveLength(0)
  })

  it('traces a held edge parked before its first 50 ms sample', () => {
    mount(true)
    probe.now = 1
    probe.onIntent!({ type: 'movement', vector: [0, 1], atMs: 1 })
    probe.now = 40; probe.tick!()
    expect(probe.frames).toHaveLength(0)
    const events = JSON.parse(probe.trace!.json()).records.map((record: { event: string }) => record.event)
    expect(events).toContain('controller.tick')
    expect(events).toContain('controller.tick.parked')
  })

  it('drains at most four aged taps as distinct frames after a delayed timer callback', () => {
    mount()
    for (const atMs of [10, 70, 130, 190, 250]) {
      probe.now = atMs
      probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
    }
    const redraws = probe.states[0]
    probe.now = 500; probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual(Array(4).fill(['move']))
    expect(probe.states[0]).toBe((redraws as number) + 1)
    probe.now = 550; probe.tick!()
    expect(probe.frames).toHaveLength(5)
  })

  it('keeps normal timer cadence and does not accelerate newly queued taps', () => {
    mount()
    for (const atMs of [10, 20, 30]) {
      probe.now = atMs
      probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
    }
    probe.now = 50; probe.tick!()
    expect(probe.frames).toHaveLength(1)
    probe.now = 100; probe.tick!()
    expect(probe.frames).toHaveLength(2)
    probe.now = 490
    probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
    probe.now = 500; probe.tick!()
    expect(probe.frames).toHaveLength(3)
    probe.now = 550; probe.tick!()
    expect(probe.frames).toHaveLength(4)
  })

  it('stops delayed catch-up on rejection and does not cross a save barrier', async () => {
    mount()
    for (const atMs of [10, 70, 130]) {
      probe.now = atMs
      probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
    }
    probe.frameRejections = [{ intentType: 'move', message: 'No supported move.' }]
    probe.now = 500; probe.tick!()
    expect(probe.frames).toHaveLength(1)
    probe.pending = 96
    probe.now = 1000; probe.tick!()
    expect(probe.frames).toHaveLength(1)
    expect(probe.saveCalls).toBe(1)
    probe.releaseSave!(); await settle()
    probe.now = 1050; probe.tick!()
    expect(probe.frames).toHaveLength(2)
  })

  it('stops within a catch-up batch when a frame starts a checkpoint', () => {
    probe.pending = 63; probe.countFrames = true; mount()
    for (const atMs of [10, 70, 130]) {
      probe.now = atMs
      probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
    }
    probe.now = 500; probe.tick!()
    expect(probe.frames).toHaveLength(1)
    expect(probe.saveCalls).toBe(1)
    expect(probe.gate).toBe('checkpointing')
  })

  it('queues one F or touch confirm during save, revalidates on recovery, and keeps a short W step', async () => {
    probe.pending = 96; mount(); probe.tick!()
    const keyboard = savedWorkKeyboardIntent('KeyF', probe.projection!.savedTerrainWorks)
    expect(keyboard).toEqual({ type: 'saved-work.confirm', id: workId })
    probe.onIntent!(keyboard!)
    probe.onIntent!({ type: 'saved-work.confirm', id: workId }) // touch
    probe.onIntent!({ type: 'movement', vector: [0, 1], atMs: 2 })
    probe.onIntent!({ type: 'movement', vector: [0, 0], atMs: 15 })
    expect(probe.actions).toEqual([])
    probe.reuse = true; probe.cursor = probe.stateCursor = 0
    const queued = renderToStaticMarkup(createElement(PublicV23Controller, props()))
    expect(queued).toContain('One checked action is queued and will be revalidated')
    expect(queued).toContain('class="v23-status"')
    probe.releaseSave!(); await settle(); probe.tick!(); probe.tick!()
    expect(probe.actions).toEqual([{ kind: 'legacy-work', id: workId }])
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type))).toEqual([['move'], []])
  })

  it('keeps an explicit D pivot before Confirm after held turns are cancelled', async () => {
    probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 1)) probe.onIntent!(intent)
    for (let index = 0; index < 4; index++) { probe.now = 51 + index * 50; probe.tick!() }
    probe.onIntent!({ type: 'saved-work.confirm', id: workId })
    probe.onIntent!({ type: 'saved-work.confirm', id: workId })
    for (let index = 0; index < 4; index++) { probe.now = 251 + index * 50; probe.tick!() }
    for (const intent of keyboardMovementIntents(keys, 'KeyD', false, 401)) probe.onIntent!(intent)
    expect(probe.frames).toEqual([])
    expect(probe.actions).toEqual([])
    probe.releaseSave!(); await settle()
    for (let index = 0; index < 8; index++) { probe.tick!(); await settle() }
    expect(probe.events.filter((event) => event !== 'frame:'))
      .toEqual(['frame:look', 'action'])
    expect(probe.actions).toEqual([{ kind: 'legacy-work', id: workId }])
    const turn = probe.frames.flatMap((frame) => frame).reduce((sum, intent) =>
      sum + (intent.type === 'look' ? intent.yawDelta ?? 0 : 0), 0)
    expect(turn).toBeCloseTo(-0.13)
  })

  it('cancels a delayed D hold on keyup and preserves its pivot and mid-hold Confirm', async () => {
    probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 1)) probe.onIntent!(intent)
    probe.now = 263; probe.tick!()
    probe.now = 400; probe.onIntent!({ type: 'saved-work.confirm', id: workId })
    probe.onIntent!({ type: 'saved-work.confirm', id: workId })
    probe.now = 523; probe.tick!()
    probe.now = 1056
    for (const intent of keyboardMovementIntents(keys, 'KeyD', false, 1056)) probe.onIntent!(intent)
    expect(probe.frames).toEqual([])
    expect(probe.actions).toEqual([])
    probe.releaseSave!(); await settle()
    for (let index = 0; index < 16; index++) { probe.tick!(); await settle() }
    expect(probe.events.filter((event) => event !== 'frame:'))
      .toEqual(['frame:look', 'action'])
    expect(probe.actions).toHaveLength(1)
    expect(probe.frames.filter((frame) => frame.length)).toHaveLength(1)
  })

  it('keeps a short timestamped D tap to one pivot across a checked save', async () => {
    probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 1)) probe.onIntent!(intent)
    probe.now = 35
    for (const intent of keyboardMovementIntents(keys, 'KeyD', false, 35)) probe.onIntent!(intent)
    probe.now = 523; probe.tick!()
    probe.releaseSave!(); await settle(); probe.tick!(); probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['look'], []])
  })

  it('cancels obsolete held vectors without repeating the pivot or buffered W step', async () => {
    probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 1)) probe.onIntent!(intent)
    probe.now = 101; probe.tick!()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 126)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyD', false, 251)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 401)) probe.onIntent!(intent)
    probe.releaseSave!(); await settle()
    for (let index = 0; index < 8; index++) probe.tick!()
    expect(probe.frames.filter((frame) => frame.length)
      .map((frame) => frame.map((intent) => intent.type))).toEqual([['look'], ['move']])
  })

  it('cancels timestamped catch-up after an untimed blur release', async () => {
    probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 1)) probe.onIntent!(intent)
    probe.now = 101; probe.tick!()
    probe.onIntent!({ type: 'movement', vector: [0, 0] })
    probe.now = 523; probe.tick!()
    probe.releaseSave!(); await settle(); probe.tick!()
    expect(probe.frames).toEqual([[]])
  })

  it('caps held samples at 16 and accepts an explicit tap after release', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 1)) probe.onIntent!(intent)
    for (let index = 0; index < 100; index++) { probe.now = 51 + index * 50; probe.tick!() }
    probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
    expect((probe.states[1] as string[]).at(-1)).toContain('16-step input queue is full')
    for (const intent of keyboardMovementIntents(keys, 'KeyD', false, 5001)) probe.onIntent!(intent)
    probe.releaseSave!(); await settle()
    for (let index = 0; index < 16; index++) probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['look']])
    probe.onIntent!({ type: 'movement.tap', vector: [1, 0], source: 'keyboard' })
    probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['look'], ['look']])
  })

  it('keeps one turn and one forward step during a checked save', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 801; probe.tick!()
    expect(rerender()).toContain('1 short input step(s) queued')
    for (const intent of keyboardMovementIntents(keys, 'KeyA', true, 801)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyA', false, 826)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 827)) probe.onIntent!(intent)
    expect(probe.frames).toEqual([])
    probe.releaseSave!(); await settle()
    probe.now = 850; probe.tick!(); probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['move'], ['look']])
    expect(probe.frames[1][0].yawDelta).toBeCloseTo(0.13)
  })

  it('keeps only the latest latched turn while the checked save is pending', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 801; probe.tick!()
    for (const intent of keyboardMovementIntents(keys, 'KeyA', true, 801)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyA', false, 826)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 827)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyD', false, 851)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 852)) probe.onIntent!(intent)
    probe.releaseSave!(); await settle()
    probe.now = 900; probe.tick!(); probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['move'], ['look']])
    expect(probe.frames[1][0].yawDelta).toBeCloseTo(-0.13)
  })

  it('keeps checked-action order when a later turn replaces a latched turn', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 801; probe.tick!()
    for (const intent of keyboardMovementIntents(keys, 'KeyA', true, 801)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyA', false, 826)) probe.onIntent!(intent)
    probe.onIntent!({ type: 'saved-work.confirm', id: workId })
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 827)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyD', false, 851)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 852)) probe.onIntent!(intent)
    probe.releaseSave!(); await settle()
    probe.now = 900; probe.tick!(); await settle(); probe.tick!(); await settle(); probe.tick!()
    expect(probe.events.filter((event) => event !== 'frame:'))
      .toEqual(['frame:move', 'action', 'frame:look'])
    expect(probe.frames[1][0].yawDelta).toBeCloseTo(-0.13)
  })

  it('does not replay a latched turn when the checked save is blocked', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 801; probe.tick!()
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 801)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyD', false, 826)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 827)) probe.onIntent!(intent)
    probe.releaseSave!(true); await settle()
    probe.gate = 'open'; probe.now = 850; probe.tick!()
    expect(probe.frames).toEqual([])
  })

  it('coalesces busy repaints while keeping the explicit pivot after held-key release', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount(); probe.tick!()
    expect(probe.states[0]).toBe(1) // entering the checked save
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 1)) probe.onIntent!(intent)
    probe.now = 801; probe.tick!()
    probe.reuse = true; probe.cursor = probe.stateCursor = 0
    expect(renderToStaticMarkup(createElement(PublicV23Controller, props())))
      .toContain('16 short input step(s) queued')
    for (const intent of keyboardMovementIntents(keys, 'KeyD', false, 801)) probe.onIntent!(intent)
    expect(probe.states[0]).toBe(1)
    probe.reuse = true; probe.cursor = probe.stateCursor = 0
    const busyMarkup = renderToStaticMarkup(createElement(PublicV23Controller, props()))
    expect(busyMarkup).toContain('Checked save in progress')
    expect(busyMarkup).toContain('1 short input step(s) queued')
    probe.releaseSave!(); await settle()
    expect(probe.states[0]).toBe(2) // the completed save clears the busy state
    for (let index = 0; index < 16; index++) probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['look']])
  })

  it('retains only one intentional W step when keyup precedes a successful save', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    for (let index = 0; index < 8; index++) { probe.now = 51 + index * 50; probe.tick!() }
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 401)) probe.onIntent!(intent)
    expect(probe.frames).toEqual([])
    expect(rerender()).toContain('1 short input step(s) queued')
    probe.releaseSave!(); await settle()
    for (let index = 0; index < 8; index++) probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type))).toEqual([['move']])
  })

  it('keeps a pre-save W edge if keyup arrives before the first save-time sample', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 40; probe.tick!()
    expect(probe.saveCalls).toBe(1)
    expect(probe.frames).toEqual([])
    probe.now = 70
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 70)) probe.onIntent!(intent)
    expect(rerender()).toContain('1 short input step(s) queued')
    probe.releaseSave!(); await settle()
    probe.now = 100; probe.tick!(); probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type))).toEqual([['move']])
  })

  it('keeps a W edge pressed before the save starts when keyup follows a save-time sample', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 40; probe.tick!()
    expect(probe.saveCalls).toBe(1)
    expect(probe.frames).toEqual([])
    probe.now = 51; probe.tick!() // Save-time sample merges the pre-save held edge.
    probe.now = 70
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 70)) probe.onIntent!(intent)
    expect(rerender()).toContain('1 short input step(s) queued')
    probe.releaseSave!(); await settle()
    probe.now = 100; probe.tick!(); probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type))).toEqual([['move']])
  })

  it('bounds sampled W backlog when the save begins before queued steps drain', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 801; probe.tick!()
    expect(probe.saveCalls).toBe(1)
    expect(probe.frames).toEqual([])
    expect(rerender()).toContain('1 short input step(s) queued')
    probe.now = 827
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 827)) probe.onIntent!(intent)
    probe.releaseSave!(); await settle()
    probe.now = 850
    for (let index = 0; index < 8; index++) probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type))).toEqual([['move']])
  })

  it.each(['timed', 'untimed'] as const)(
    'retains a fresh %s W sample after the pre-save edge drained', async (sample) => {
      probe.idleNeeded = false; probe.pending = 62; probe.countFrames = true; mount()
      probe.onIntent!({ type: 'movement', vector: [0, 1],
        ...(sample === 'timed' ? { atMs: 1 } : {}) })
      probe.now = 51; probe.tick!()
      expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
        .toEqual([['move']])
      probe.pending = 96; probe.now = 75; probe.tick!()
      expect(probe.saveCalls).toBe(1)
      probe.now = 101; probe.tick!() // A new sample, not the earlier edge, is now buffered.
      expect(rerender()).toContain('1 short input step(s) queued')
      probe.onIntent!({ type: 'movement', vector: [0, 0], atMs: 120 })
      expect(rerender()).toContain('1 short input step(s) queued')
      probe.releaseSave!(); await settle()
      probe.now = 150; probe.tick!(); probe.tick!()
      expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
        .toEqual([['move'], ['move']])
    })

  it.each(['direction', 'blur', 'blocked'] as const)(
    'cancels the pre-save W edge on %s before replay', async (cancel) => {
      probe.idleNeeded = false; probe.pending = 96; mount()
      probe.onIntent!({ type: 'movement', vector: [0, 1], atMs: 1 })
      probe.now = 40; probe.tick!()
      probe.now = 51; probe.tick!()
      probe.now = 70
      if (cancel === 'direction') {
        probe.onIntent!({ type: 'movement', vector: [1, 0], atMs: 70 })
        probe.onIntent!({ type: 'movement', vector: [0, 0], atMs: 80 })
      } else if (cancel === 'blur') probe.onIntent!({ type: 'movement', vector: [0, 0] })
      else probe.onIntent!({ type: 'movement', vector: [0, 0], atMs: 70 })
      probe.releaseSave!(cancel === 'blocked'); await settle()
      if (cancel === 'blocked') probe.gate = 'open'
      probe.now = 100
      for (let index = 0; index < 8; index++) probe.tick!()
      expect(probe.frames.filter((frame) => frame.some((intent) => intent.type === 'move')))
        .toEqual([])
    })

  it('buffers at most one W step across repeated presses during one checked save', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const atMs of [1, 201, 401]) {
      for (const intent of keyboardMovementIntents(keys, 'KeyW', true, atMs)) probe.onIntent!(intent)
      probe.now = atMs + 150; probe.tick!()
      for (const intent of keyboardMovementIntents(keys, 'KeyW', false, atMs + 150)) probe.onIntent!(intent)
    }
    expect(rerender()).toContain('1 short input step(s) queued')
    probe.releaseSave!(); await settle()
    for (let index = 0; index < 8; index++) { probe.now += 50; probe.tick!() }
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type))).toEqual([['move']])
  })

  it('cancels the buffered W step on map-open or blur before save completes', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 30)) probe.onIntent!(intent)
    probe.onIntent!({ type: 'movement', vector: [0, 0] })
    probe.releaseSave!(); await settle()
    for (let index = 0; index < 8; index++) probe.tick!()
    expect(probe.frames).toEqual([])
  })

  it('does not replay a buffered W step after a blocked save', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 30)) probe.onIntent!(intent)
    probe.releaseSave!(true); await settle()
    probe.gate = 'open'
    for (let index = 0; index < 8; index++) probe.tick!()
    expect(probe.frames).toEqual([])
  })

  it('does not catch up a long W hold after keyup, then accepts a fresh D turn', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 801; probe.tick!()
    expect(rerender()).toContain('1 short input step(s) queued')
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 801)) probe.onIntent!(intent)
    expect(rerender()).toContain('1 short input step(s) queued')
    probe.releaseSave!(); await settle()
    for (let index = 0; index < 20; index++) { probe.now += 50; probe.tick!() }
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type))).toEqual([['move']])
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 1851)) probe.onIntent!(intent)
    probe.now = 1901; probe.tick!()
    for (const intent of keyboardMovementIntents(keys, 'KeyD', false, 1901)) probe.onIntent!(intent)
    for (let index = 0; index < 20; index++) { probe.now += 50; probe.tick!() }
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['move'], ['look']])
  })

  it('replaces a queued W hold with the new D direction before replay', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount(); probe.tick!()
    probe.onIntent!({ type: 'movement', vector: [0, 1], atMs: 1 })
    probe.now = 801; probe.tick!()
    expect(rerender()).toContain('1 short input step(s) queued')
    probe.onIntent!({ type: 'movement', vector: [1, 0], atMs: 801 })
    expect(rerender()).not.toContain('short input step(s) queued')
    probe.now = 851; probe.tick!()
    probe.releaseSave!(); await settle(); probe.tick!()
    probe.onIntent!({ type: 'movement', vector: [0, 0], atMs: 851 })
    for (let index = 0; index < 20; index++) { probe.now += 50; probe.tick!() }
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['look']])
  })

  it('keeps an explicit tap and checked action in order after held W keyup', async () => {
    probe.idleNeeded = false; probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 51; probe.tick!()
    probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
    probe.onIntent!({ type: 'saved-work.confirm', id: workId })
    probe.now = 101; probe.tick!()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 101)) probe.onIntent!(intent)
    probe.releaseSave!(); await settle()
    probe.tick!(); probe.tick!(); await settle(); probe.tick!()
    expect(probe.events).toEqual(['frame:move', 'frame:move', 'action'])
    expect(probe.actions).toEqual([{ kind: 'legacy-work', id: workId }])
  })

  it('keeps frames accepted before keyup in the normal save path', async () => {
    probe.idleNeeded = false; probe.countFrames = true; mount()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    for (const atMs of [51, 101]) { probe.now = atMs; probe.tick!() }
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['move'], ['move']])
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 101)) probe.onIntent!(intent)
    probe.tick!()
    expect(probe.saveCalls).toBe(1)
    probe.releaseSave!(); await settle()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['move'], ['move']])
  })

  it('does not repeat the one saved W step after grounded terrain rejection', async () => {
    probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 801; probe.tick!()
    expect(rerender()).toContain('1 short input step(s) queued')
    probe.frameRejections = [{ intentType: 'move', message: 'No supported move.' }]
    probe.releaseSave!(); await settle()
    probe.tick!()
    expect(probe.frames.filter((frame) => frame.some((intent) => intent.type === 'move')))
      .toHaveLength(1)
    expect(rerender()).not.toContain('short input step(s) queued')
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 801)) probe.onIntent!(intent)
    for (let index = 0; index < 20; index++) probe.tick!()
    expect(probe.frames.filter((frame) => frame.some((intent) => intent.type === 'move')))
      .toHaveLength(1)
  })

  it('keeps an explicit W tap and checked action behind a rejected held W', async () => {
    probe.pending = 96; mount(); probe.tick!()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 51; probe.tick!()
    probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
    probe.now = 101; probe.onIntent!({ type: 'saved-work.confirm', id: workId })
    probe.now = 151; probe.tick!()
    probe.frameRejections = [{ intentType: 'move', message: 'No supported move.' }]
    probe.releaseSave!(); await settle()
    probe.tick!()
    probe.tick!(); await settle(); probe.tick!()
    expect(probe.events.slice(0, 3)).toEqual(['frame:move', 'frame:move', 'action'])
    expect(probe.actions).toEqual([{ kind: 'legacy-work', id: workId }])
    for (let index = 0; index < 8; index++) probe.tick!()
    expect(probe.frames.filter((frame) => frame.some((intent) => intent.type === 'move')))
      .toHaveLength(2)
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 201)) probe.onIntent!(intent)
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 251)) probe.onIntent!(intent)
    probe.now = 301; probe.tick!()
    expect(probe.frames.filter((frame) => frame.some((intent) => intent.type === 'move')))
      .toHaveLength(3)
  })

  it('rearms held sampling when the direction changes after a terrain rejection', () => {
    probe.frameRejections = [{ intentType: 'move', message: 'No supported move.' }]
    mount()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 51; probe.tick!()
    probe.now = 101; probe.tick!()
    expect(probe.frames.filter((frame) => frame.some((intent) => intent.type === 'move')))
      .toHaveLength(1)
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 151)) probe.onIntent!(intent)
    probe.now = 201; probe.tick!()
    expect(probe.frames.filter((frame) => frame.some((intent) => intent.type === 'move')))
      .toHaveLength(2)
    expect(probe.frames.at(-1)?.map((intent) => intent.type)).toEqual(['look', 'move'])
  })

  it('does not persist neutral frames while a rejected W remains held', () => {
    probe.idleNeeded = false
    probe.frameRejections = [{ intentType: 'move', message: 'No supported move.' }]
    mount()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 51; probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['move']])
    for (let index = 0; index < 20; index++) {
      probe.now += 50; probe.tick!()
    }
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['move']])
    expect(probe.saveCalls).toBe(0)
  })

  it('turns on every open-gate tick when a D keydown reaches the controller', () => {
    mount()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 1)) probe.onIntent!(intent)
    for (let index = 0; index < 16; index++) { probe.now = 51 + index * 50; probe.tick!() }
    for (const intent of keyboardMovementIntents(keys, 'KeyD', false, 801)) probe.onIntent!(intent)
    expect(probe.frames).toHaveLength(16)
    expect(probe.frames.every((frame) => frame.length === 1 && frame[0].type === 'look')).toBe(true)
    expect(probe.releaseSave).toBeNull()
  })

  it('stops delayed open-gate D sampling on keyup', () => {
    probe.idleNeeded = false; mount()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 1)) probe.onIntent!(intent)
    probe.now = 263; probe.tick!()
    probe.now = 523; probe.tick!()
    for (const intent of keyboardMovementIntents(keys, 'KeyD', false, 801)) probe.onIntent!(intent)
    expect(probe.frames).toHaveLength(7)
    for (let index = 0; index < 9; index++) probe.tick!()
    expect(probe.frames).toHaveLength(7)
    expect(probe.frames.every((frame) => frame.length === 1 && frame[0].type === 'look')).toBe(true)
  })

  it('exposes local opt-in trace records for intent, save-time sample, and frame drain', async () => {
    probe.pending = 96; const markup = mount(true); probe.tick!()
    expect(markup).toContain('Input trace (local diagnostics)')
    expect(markup).toContain('class="v23-input-trace"')
    expect(markup).toContain('max-width:min(640px,calc(100vw - 260px))')
    expect(probe.trace).not.toBeNull()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyD', true, 1)) probe.onIntent!(intent)
    probe.now = 51; probe.tick!()
    probe.releaseSave!(); await settle(); probe.tick!()
    const events = (JSON.parse(probe.trace!.json()) as { records: { event: string }[] })
      .records.map((record) => record.event)
    expect(events).toContain('controller.intent')
    expect(events).toContain('controller.sample')
    expect(events).toContain('controller.frame')
    expect(events).toContain('controller.render')
    const records = (JSON.parse(probe.trace!.json()) as { records: { event: string;
      data: Record<string, unknown> }[] }).records
    expect(records.find((record) => record.event === 'controller.frame')?.data)
      .toMatchObject({ advanceMs: 0, viewMs: 0 })
    expect(records.find((record) => record.event === 'controller.render')?.data)
      .toMatchObject({ projectionMs: 0, baseProjectionMs: 0, mireglassProjectionMs: 0 })
  })

  it('records only bounded page and long-task diagnostics when local input tracing is enabled', () => {
    let deliver: PerformanceObserverCallback | null = null
    const observe = vi.fn(), disconnect = vi.fn()
    vi.stubGlobal('PerformanceObserver', class {
      static supportedEntryTypes = ['longtask']
      constructor(callback: PerformanceObserverCallback) { deliver = callback }
      observe = observe
      disconnect = disconnect
    })
    mount(true)
    expect(observe).toHaveBeenCalledWith({ type: 'longtask' })
    Object.assign(document, { visibilityState: 'hidden', hasFocus: () => false })
    probe.now = 100
    probe.onIntent!({ type: 'movement.tap', vector: [0, 1], source: 'keyboard' })
    probe.now = 200; probe.tick!()
    const entries = Array.from({ length: 130 }, (_, index) => ({
      startTime: index === 0 ? -12 : index === 1 ? 20 : 30,
      duration: index === 1 ? 65_000 : 57,
      name: 'private-attribution',
    })) as PerformanceEntry[]
    deliver!({ getEntries: () => entries } as PerformanceObserverEntryList,
      {} as PerformanceObserver)
    const records = (JSON.parse(probe.trace!.json()) as { records: { event: string;
      data: Record<string, unknown> }[] }).records
    expect(records.find((record) => record.event === 'controller.environment')?.data)
      .toMatchObject({ visibilityState: 'unknown', hasFocus: null, longTaskObserved: true })
    expect(records.find((record) => record.event === 'controller.intent')?.data)
      .toMatchObject({ visibilityState: 'hidden', hasFocus: false })
    expect(records.find((record) => record.event === 'controller.tick')?.data)
      .toMatchObject({ visibilityState: 'hidden', hasFocus: false, elapsedMs: 200 })
    const tasks = records.filter((record) => record.event === 'controller.longtask')
    expect(tasks).toHaveLength(120)
    expect(records.find((record) => record.event === 'controller.longtask.limit')?.data)
      .toEqual({ maxEntries: 120 })
    expect(tasks[0].data).toEqual({ startMs: 0, durationMs: 57, durationCapped: false })
    expect(tasks[1].data).toEqual({ startMs: 20, durationMs: 60_000,
      durationCapped: true })
    expect(JSON.stringify(tasks)).not.toContain('private-attribution')
    for (const cleanup of probe.cleanups) cleanup()
    expect(disconnect).toHaveBeenCalledTimes(1)
    deliver!({ getEntries: () => entries } as PerformanceObserverEntryList,
      {} as PerformanceObserver)
    const later = (JSON.parse(probe.trace!.json()) as { records: { event: string }[] }).records
    expect(later.filter((record) => record.event === 'controller.longtask')).toHaveLength(120)
  })

  it('does not create a long-task observer without local trace opt-in', () => {
    const observer = vi.fn()
    Object.assign(observer, { supportedEntryTypes: ['longtask'] })
    vi.stubGlobal('PerformanceObserver', observer)
    mount()
    expect(observer).not.toHaveBeenCalled()
    expect(probe.trace).toBeNull()
  })

  it('reports finite nonnegative V24 base and Mireglass projection times in local trace', () => {
    mount(true, true)
    const records = (JSON.parse(probe.trace!.json()) as { records: { event: string;
      data: Record<string, unknown> }[] }).records
    const render = records.find((record) => record.event === 'controller.render')!.data
    for (const key of ['projectionMs', 'baseProjectionMs', 'mireglassProjectionMs']) {
      expect(typeof render[key]).toBe('number')
      expect(Number.isFinite(render[key])).toBe(true)
      expect(render[key]).toBeGreaterThanOrEqual(0)
    }
  })

  it('does not run queued work after a failed checkpoint', async () => {
    probe.pending = 96; mount(); probe.tick!()
    probe.onIntent!({ type: 'saved-work.confirm', id: workId })
    probe.releaseSave!(true); await settle(); probe.tick!()
    expect(probe.actions).toEqual([])
    expect(probe.frames).toEqual([])
  })

  it.each([['open', 'jump'], ['open', 'W'], ['checkpoint', 'jump'],
    ['checkpoint', 'W']] as const)(
    'settles an earlier %s gate %s pulse before Confirm', async (gate, input) => {
      if (gate === 'checkpoint') probe.pending = 96
      mount()
      if (gate === 'checkpoint') probe.tick!()
      if (input === 'jump') probe.onIntent!({ type: 'jump' })
      else { probe.onIntent!({ type: 'movement', vector: [0, 1], atMs: 1 })
        probe.onIntent!({ type: 'movement', vector: [0, 0], atMs: 10 }) }
      probe.onIntent!({ type: 'saved-work.confirm', id: workId })
      expect(probe.actions).toEqual([])
      if (gate === 'checkpoint') { probe.releaseSave!(); await settle() }
      probe.tick!(); await settle()
      expect(probe.events).toEqual([`frame:${input === 'jump' ? 'jump' : 'move'}`, 'action'])
      expect(probe.actions).toEqual([{ kind: 'legacy-work', id: workId }])
      probe.tick!(); expect(probe.actions).toHaveLength(1)
    })

  it.each([['open', 'jump'], ['open', 'W'], ['checkpoint', 'jump'],
    ['checkpoint', 'W']] as const)(
    'holds a later %s gate %s pulse behind Confirm', async (gate, input) => {
      if (gate === 'checkpoint') probe.pending = 96
      mount()
      if (gate === 'checkpoint') probe.tick!()
      probe.onIntent!({ type: 'saved-work.confirm', id: workId })
      if (input === 'jump') probe.onIntent!({ type: 'jump' })
      else { probe.onIntent!({ type: 'movement', vector: [0, 1], atMs: 1 })
        probe.onIntent!({ type: 'movement', vector: [0, 0], atMs: 10 }) }
      if (gate === 'checkpoint') { expect(probe.events).toEqual([])
        probe.releaseSave!(); await settle() }
      else await settle()
      expect(probe.events).toEqual(['action'])
      probe.tick!(); await settle()
      expect(probe.events).toEqual(['action', `frame:${input === 'jump' ? 'jump' : 'move'}`])
      expect(probe.actions).toHaveLength(1)
    })

  it('rejects new airborne taps while preserving a previously accepted grounded pulse', async () => {
    probe.pending = 96; mount()
    probe.onIntent!({ type: 'jump' })
    advanceAirborneFrame(true)
    probe.onIntent!({ type: 'movement.tap', vector: [1, 0], source: 'keyboard' })
    probe.onIntent!({ type: 'jump' })
    expect((probe.states[1] as string[]).at(-1)).toContain('Land before starting')
    probe.tick!(); expect(probe.events).toEqual(['frame:'])
    advanceAirborneFrame(false)
    probe.tick!(); probe.releaseSave!(); await settle()
    probe.tick!(); probe.tick!()
    expect(probe.events).toEqual(['frame:', 'frame:jump', 'frame:'])
  })

  it('keeps held forward and pivot input through a jump, then stops each on release', () => {
    probe.poseOnJump = true; mount()
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true)) probe.onIntent!(intent)
    probe.tick!()
    for (const intent of keyboardMovementIntents(keys, 'KeyA', true)) probe.onIntent!(intent)
    probe.onIntent!({ type: 'jump' })
    probe.tick!(); probe.tick!()
    expect(probe.airborne).toBe(true)
    probe.tick!(); probe.tick!()
    for (const intent of keyboardMovementIntents(keys, 'KeyA', false)) probe.onIntent!(intent)
    probe.tick!()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false)) probe.onIntent!(intent)
    probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type))).toEqual([
      ['move'], ['look'], ['jump'], ['look', 'move'], ['look', 'move'], ['move'], [],
    ])
    expect(probe.frames.filter((frame) => frame.some((intent) => intent.type === 'jump')))
      .toHaveLength(1)
  })

  it('takes off before stale sampled W steps, then moves only while W stays held', () => {
    probe.poseOnJump = true; mount(true)
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 260; probe.tick!() // Delayed callback leaves sampled W steps queued.
    const framesBeforeJump = probe.frames.length
    probe.now = 400; probe.onIntent!({ type: 'jump' })
    const records = (JSON.parse(probe.trace!.json()) as { records: { event: string;
      data: Record<string, unknown> }[] }).records
    expect(records.find((record) => record.event === 'controller.jump.prioritized')?.data)
      .toMatchObject({ droppedHeldSteps: 2, retained: 0, vector: [0, 1] })
    probe.now = 1000; probe.tick!()
    expect(probe.frames.slice(framesBeforeJump).map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['jump']])
    const jumpFrame = (JSON.parse(probe.trace!.json()) as { records: { event: string;
      data: Record<string, unknown> }[] }).records.findLast((record) =>
      record.event === 'controller.frame')
    expect(jumpFrame?.data).toMatchObject({ vector: [0, 1], jump: true, queued: 0 })
    probe.now = 1050; probe.tick!()
    expect(probe.frames.at(-1)?.map((intent) => intent.type)).toEqual(['move'])
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 1100)) probe.onIntent!(intent)
    probe.now = 1150; probe.tick!()
    probe.now = 1200; probe.tick!()
    expect(probe.frames.slice(-2)).toEqual([[], []])
  })

  it('keeps explicit taps and checked actions ahead of a held-W jump', async () => {
    probe.holdAction = true; probe.poseOnJump = true; mount(true)
    const keys = new Set<string>()
    probe.onIntent!({ type: 'movement.tap', vector: [1, 0], source: 'keyboard' })
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.onIntent!({ type: 'saved-work.confirm', id: workId })
    probe.now = 260; probe.onIntent!({ type: 'jump' })
    expect(probe.trace!.json()).not.toContain('controller.jump.prioritized')
    probe.tick!()
    expect(probe.events).toContain('action')
    expect(probe.events).not.toContain('frame:jump')
    probe.releaseAction!(); await settle()
    probe.now = 320; probe.tick!()
    expect(probe.events.indexOf('action')).toBeLessThan(probe.events.indexOf('frame:jump'))
  })

  it('prioritizes takeoff over sampled hold steps without deleting an explicit tap', () => {
    probe.poseOnJump = true; mount(true)
    const keys = new Set<string>()
    probe.onIntent!({ type: 'movement.tap', vector: [1, 0], source: 'keyboard' })
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    probe.now = 260; probe.onIntent!({ type: 'jump' })
    const prioritized = (JSON.parse(probe.trace!.json()) as { records: { event: string;
      data: Record<string, unknown> }[] }).records.find((record) =>
      record.event === 'controller.jump.prioritized')
    expect(prioritized?.data).toMatchObject({ droppedHeldSteps: 1, retained: 1 })
    probe.now = 500; probe.tick!()
    expect(probe.frames.map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['look'], ['jump']])
  })

  it.each(['jump', 'tap'] as const)(
    'does not defer a second %s pulse across a pending-95 jump and landing', async (second) => {
      probe.pending = 95; probe.poseOnJump = true; mount()
      probe.onIntent!({ type: 'jump' })
      probe.onIntent!(second === 'jump' ? { type: 'jump' }
        : { type: 'movement.tap', vector: [1, 0], source: 'keyboard' })
      expect((probe.states[1] as string[]).at(-1)).toContain('queued jump')
      probe.tick!(); expect(probe.events).toEqual(['frame:jump'])
      probe.tick!(); expect(probe.events).toEqual(['frame:jump', 'frame:'])
      advanceAirborneFrame(false)
      probe.tick!(); probe.releaseSave!(); await settle()
      probe.tick!()
      expect(probe.events).toEqual(['frame:jump', 'frame:', 'frame:'])
    })

  it('cancels later accepted taps when a movement frame unexpectedly takes off', async () => {
    probe.pending = 95; probe.poseOnMove = true; mount()
    probe.onIntent!({ type: 'movement.tap', vector: [0, 1] })
    probe.onIntent!({ type: 'movement.tap', vector: [0, 1] })
    probe.tick!()
    expect(probe.events).toEqual(['frame:move'])
    expect((probe.states[1] as string[]).at(-1)).toContain('cancelled')
    probe.tick!(); advanceAirborneFrame(false)
    probe.tick!(); probe.releaseSave!(); await settle(); probe.tick!()
    expect(probe.events).toEqual(['frame:move', 'frame:', 'frame:'])
  })

  it.each(['open', 'checkpoint'] as const)(
    'keeps post-Confirm taps behind an unfinished checked write in %s gate', async (gate) => {
      probe.holdAction = true
      if (gate === 'checkpoint') probe.pending = 96
      mount()
      if (gate === 'checkpoint') probe.tick!()
      probe.onIntent!({ type: 'saved-work.confirm', id: workId })
      probe.onIntent!({ type: 'jump' })
      if (gate === 'checkpoint') { probe.releaseSave!(); await settle() }
      probe.tick!()
      expect(probe.events).toEqual(['action'])
      probe.releaseAction!(); await settle(); probe.tick!()
      expect(probe.events).toEqual(['action', 'frame:jump'])
      expect(probe.actions).toHaveLength(1)
    })

  it('cancels unready jump and A/D on map-open or blur without replacing accepted taps', () => {
    mount()
    probe.onIntent!({ type: 'movement.tap', vector: [1, 0], source: 'keyboard' })
    probe.onIntent!({ type: 'jump' })
    probe.onIntent!({ type: 'movement', vector: [0, 0] }) // untimed map/blur release
    expect(probe.states[1]).toContain('2 queued movement step(s) cancelled when the map opened or controls lost focus.')
    probe.tick!()
    expect(probe.frames[0]).toEqual([])
    probe.onIntent!({ type: 'movement.tap', vector: [-1, 0], source: 'keyboard' })
    probe.onIntent!({ type: 'jump' })
    probe.tick!(); probe.tick!()
    expect(probe.frames.slice(1).map((frame) => frame.map((intent) => intent.type)))
      .toEqual([['look'], ['jump']])
  })

  it('reveals a west aim only when every canonical footprint tile is discovered', () => {
    const site = resolvePublicV23Site(seed,
      'works5:ladder:mireglass-slate:W:-103:4306')!
    expect(publicV23DiscoveredWestSite(seed, encodeDiscoveredTileIds([]), 430.6)).toBeNull()
    expect(publicV23DiscoveredWestSite(seed,
      encodeDiscoveredTileIds([...site.footprintTileIds.slice(0, -1)].sort()), 430.6)).toBeNull()
    expect(publicV23DiscoveredWestSite(seed,
      encodeDiscoveredTileIds([...site.footprintTileIds].sort()), 430.6)?.id).toBe(site.id)
  })

  it('opens Works aimed at a discovered bridge instead of an unsupported default', () => {
    probe.suggested = true
    mount()
    probe.onIntent!({ type: 'saved-work.mode', active: true })
    rerender()
    expect(probe.projection?.savedTerrainWorks).toMatchObject({ selectedKind: 'bridge', aimX: 1.1 })
    probe.onIntent!({ type: 'saved-work.mode', active: false })
    rerender()
    expect(probe.projection?.savedTerrainWorks?.aimX).toBeNull()
  })

  it('hides the exact Z control and rejects a hidden scene aim, then accepts a discovered aim', () => {
    probe.streamed = true
    mount()
    probe.onIntent!({ type: 'saved-work.mode', active: true })
    probe.onIntent!({ type: 'saved-work.kind', kind: 'ladder' })
    probe.reuse = true; probe.cursor = probe.stateCursor = 0
    const hidden = renderToStaticMarkup(createElement(PublicV23Controller, props()))
    expect(hidden).toContain('West cliff ladder aim')
    expect(hidden).toContain('class="v23-aim"')
    expect(hidden).not.toContain('id="v23-west-aim"')
    expect(hidden).not.toContain('430.6')
    expect(hidden).not.toContain('move the slider')
    const hiddenStates = [...probe.states]
    probe.onIntent!({ type: 'saved-work.aim-west', aimZ: 430.6 })
    expect(probe.states).toEqual(hiddenStates)
    probe.enabled = probe.reuse = false; probe.refs = []; probe.states = []
    probe.streamed = probe.known = true
    mount()
    probe.onIntent!({ type: 'saved-work.mode', active: true })
    probe.onIntent!({ type: 'saved-work.kind', kind: 'ladder' })
    probe.reuse = true; probe.cursor = probe.stateCursor = 0
    const discovered = renderToStaticMarkup(createElement(PublicV23Controller, props()))
    expect(discovered).toContain('id="v23-west-aim"')
    const beforeAim = [...probe.states]
    probe.onIntent!({ type: 'saved-work.aim-west', aimZ: 430.6 })
    const aimed = rerender()
    expect(probe.states.some((value, index) => beforeAim[index] === null && value === 430.6)).toBe(true)
    expect(aimed).toContain('value="430.6"')
  })

  it('explains the checked west-side too_far pose as an east-side grounded approach', () => {
    probe.streamed = probe.known = probe.westPose = true
    mount()
    probe.onIntent!({ type: 'saved-work.mode', active: true })
    probe.onIntent!({ type: 'saved-work.kind', kind: 'ladder' })
    rerender()
    probe.onIntent!({ type: 'saved-work.aim-west', aimZ: 430.6 })
    const html = rerender()
    expect(html).toContain('West cliff ladder aim')
    expect(html).toMatch(/Move east.*grounded dry terrain.*lower foot/)
    expect(html).not.toContain('too_far')
    expect(html).not.toContain('Discover the full lower and upper footprint before preview')
  })
})

describe('V31 controller soil intent routing', () => {
  beforeAll(prepareV31Start, 30000)

  it('reuses one streamed V31 view per accepted timed W step without changing travel', () => {
    probe.streamed = true
    mountV31()
    const initial = probe.v31View!
    expect(initial.movementOwner).toBe('streamed')
    const keys = new Set<string>()
    for (const intent of keyboardMovementIntents(keys, 'KeyW', true, 1)) probe.onIntent!(intent)
    for (let index = 0; index < 17; index++) {
      probe.now = 51 + index * 50
      probe.tick!()
      rerenderV31()
    }
    for (const intent of keyboardMovementIntents(keys, 'KeyW', false, 851)) probe.onIntent!(intent)
    expect(probe.v31FrameCount).toBe(17)
    expect(probe.v31Rejections).toEqual([])
    expect(probe.v31Status).toMatchObject({ saveRevision: 0, pendingFrames: 17 })
    expect(probe.v31ViewCalls).toBe(18) // Initial render, then one clone per accepted frame.
    expect(probe.v31View!.player.position).not.toEqual(initial.player.position)
    expect(probe.v31View).toEqual(probe.v31FreshView!())
    expect(probe.projection!.player.position).toEqual([
      probe.v31View!.player.position.x, probe.v31View!.player.position.y,
      probe.v31View!.player.position.z])
  }, 60_000)
  it('explains occupied soil cells instead of exposing the raw rejection', async () => {
    probe.actionRejection = 'occupied'
    mountV31()
    probe.onIntent!({ type: 'v31.soil-place', gx: 2, gz: 0 })
    await settle()
    const message = (probe.states[1] as string[]).at(-1)
    expect(message).toContain('reserved for a bridge or ladder')
    expect(message).toContain('open dry ground')
    expect(message).not.toContain('Soil action rejected: occupied')
    rerenderV31()
    expect(probe.soilPlaceRejection).toBe(message)
  })
  it('explains a raised-soil route overlap without a raw rejection token', async () => {
    probe.actionRejection = 'soil_overlap'
    mountV31()
    probe.onIntent!({ type: 'saved-work.confirm', id: workId })
    await settle()
    expect(probe.actions).toEqual([{ kind: 'legacy-work', id: workId }])
    const message = (probe.states[1] as string[]).at(-1)
    expect(message).toContain('Equip your spade and Dig the raised cell')
    expect(message).not.toContain('soil_overlap')
  })

  it('routes Place and raised-cell Dig to distinct checked soil witnesses', async () => {
    probe.raisedCell = true
    const html = mountV31()
    expect(html).toContain('data-public-version="v31"')
    expect(probe.projection?.v31Soil?.raisedCells).toEqual([{ gx: 1, gz: 0 }])
    probe.onIntent!({ type: 'v31.soil-place', gx: 2, gz: 0 })
    await settle()
    probe.onIntent!({ type: 'v26.terrain', kind: 'dig', gx: 1, gz: 0 })
    await settle()
    probe.onIntent!({ type: 'v26.terrain', kind: 'fill', gx: 1, gz: 0 })
    await settle()
    expect(probe.actions).toEqual([
      { kind: 'soil-place/v1', gx: 2, gz: 0 },
      { kind: 'soil-remove/v1', gx: 1, gz: 0 },
      { kind: 'terrain-action/v1', action: { kind: 'fill', gx: 1, gz: 0 } },
    ])
  })

  it('keeps normal Dig on unraised V31 ground', async () => {
    mountV31()
    probe.onIntent!({ type: 'v26.terrain', kind: 'dig', gx: 1, gz: 0 })
    await settle()
    expect(probe.actions).toEqual([
      { kind: 'terrain-action/v1', action: { kind: 'dig', gx: 1, gz: 0 } },
    ])
  })

  it('plays Mine for a saved checked deep dig', async () => {
    mountV31()
    probe.onIntent!({ type: 'v29.deep-dig', gx: 1, gz: 0 })
    await settle()
    expect(probe.actions).toEqual([{ kind: 'deep-dig', gx: 1, gz: 0 }])
    rerenderV31()
    expect(probe.workActionCue).toEqual({ kind: 'Mine', sequence: 1 })
  })

  it('never admits Place soil from the V26 route', async () => {
    mount(false, false, false, true)
    probe.onIntent!({ type: 'v31.soil-place', gx: 1, gz: 0 })
    await settle()
    expect(probe.actions).toEqual([])
  })
})

describe('V43 River Works E interaction', () => {
  beforeAll(prepareV43Start, 30000)

  it('claims the real projected ready post with E on the current V43 route', async () => {
    const html = mountV43(preparedBridgeheadV43Start!)
    expect(html).toContain('data-public-version="v43"')
    expect(probe.projection?.v30Bridgehead).toMatchObject({ bridgeId: workId,
      claimReady: true, reward: 'basic-pick' })
    probe.onIntent!({ type: 'interact' })
    expect(probe.actions).toEqual([{ kind: 'bridgehead-claim/v1', bridgeId: workId }])
    probe.onIntent!({ type: 'interact' })
    expect(probe.actions).toHaveLength(1)
    expect((probe.states[1] as string[]).at(-1)).toBe(
      'A checked action is already queued; retry after it finishes.')
    await settle()
    probe.onIntent!({ type: 'v30.bridgehead.claim', bridgeId: workId })
    expect(probe.actions).toHaveLength(2)
    await settle()
  })

  it('prioritizes the ready post over a competing projected E action', async () => {
    probe.greenwayOak = true
    mountV43(preparedBridgeheadV43Start!)
    expect(probe.projection?.nearbyInteraction?.kind).toBe('resource')
    expect(probe.projection?.v30Bridgehead?.claimReady).toBe(true)
    probe.onIntent!({ type: 'interact' })
    expect(probe.actions).toEqual([{ kind: 'bridgehead-claim/v1', bridgeId: workId }])
    await settle()
  })

  it('does not invent a River Works claim without a ready projected post', async () => {
    probe.greenwayOak = true
    mountV43(preparedV43Start!)
    expect(probe.projection?.v30Bridgehead).toBeUndefined()
    probe.onIntent!({ type: 'interact' })
    expect(probe.actions).not.toContainEqual({ kind: 'bridgehead-claim/v1', bridgeId: workId })
    await settle()
  })

  it('does not claim a ready post while the checked world is blocked', () => {
    probe.v43Blocked = true
    mountV43(preparedBridgeheadV43Start!)
    expect(probe.projection?.v30Bridgehead?.claimReady).toBe(true)
    expect(probe.projection?.controllerActionsEnabled).toBe(false)
    probe.onIntent!({ type: 'interact' })
    expect(probe.actions).toEqual([])
  })
})
