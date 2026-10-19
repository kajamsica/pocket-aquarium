import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PublicV23Controller } from './PublicV23Controller'
import { createPublicV41ControllerRuntime } from './PublicV41ControllerRuntime'
import { choosePublicV41Entry, inspectPublicV41Entry, PublicV41EntryView } from './PublicV41Entry'
import type { PublicV41EntryBindings } from './PublicV41Entry'
import { projectPublicV41IronHall } from './PublicV41WorldView'
import { createAtomicV40Store } from './domain/atomicV40Database'
import { createAtomicV41Store } from './domain/atomicV41Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { ironHallSite } from './domain/ironHallSite'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { createFreshPublicV36Root, PUBLIC_V36_SCHEMA } from './domain/publicWorldV36Snapshot'
import { createPublicV37Root } from './domain/publicWorldV37Snapshot'
import { createPublicV38Root } from './domain/publicWorldV38Snapshot'
import { createPublicV39Root } from './domain/publicWorldV39Snapshot'
import { commitPublicV40 } from './domain/publicWorldV40Flow'
import { createFreshPublicV40Root, createPublicV40Root } from './domain/publicWorldV40Snapshot'
import { commitPublicV41 } from './domain/publicWorldV41Flow'
import { createFreshPublicV41Root, createPublicV41Root } from './domain/publicWorldV41Snapshot'
import { waystationRiverSite } from './domain/waystationRiverContent'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from './domain/worldChunks'
import type { WizardViewIntent, WizardViewProjection } from './view/contracts'
import { WizardHud } from './view/WizardHud'

const probe = vi.hoisted(() => ({ projection: null as WizardViewProjection | null,
  onIntent: null as ((intent: WizardViewIntent) => void) | null,
  actions: [] as unknown[], outcomes: [] as unknown[] }))
vi.mock('./view/WizardSurface', () => ({ WizardSurface: ({ projection, onIntent }: {
  projection: WizardViewProjection; onIntent: (intent: WizardViewIntent) => void }) => {
  probe.projection = projection; probe.onIntent = onIntent; return null
} }))
vi.mock('./PublicV41ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV41ControllerRuntime')>()
  return { ...actual, createPublicV41ControllerRuntime: (
    ...args: Parameters<typeof actual.createPublicV41ControllerRuntime>) => {
    const runtime = actual.createPublicV41ControllerRuntime(...args)
    return { ...runtime, action: async (witness: Parameters<typeof runtime.action>[0]) => {
      probe.actions.push(witness)
      const outcome = await runtime.action(witness)
      probe.outcomes.push(outcome)
      return outcome
    } }
  } }
})
const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>) => body() }

/** Checked copied branch with a real V40 bridge, south-bank witness and near-Hall walk. */
async function nearHallCopy() {
  const base = createFreshPublicV36Root('wizard-realms')
  const bridge = waystationRiverSite('wizard-realms')!
  const hall = ironHallSite(createFreshPublicV40Root('wizard-realms').head)!
  const floor = resolvePublicV23Surface(base.head.state, bridge.exit, [])!.floorY
  const ids = [...new Set([...decodeDiscoveredTileIds(base.head.state.discoveryMask),
    ...bridge.footprintTileIds, hall.alcove.id, hall.ward.id, hall.door.id])].sort()
  const state = { ...base.head.state, movementOwner: 'streamed' as const,
    discoveryMask: encodeDiscoveredTileIds(ids), player: { ...base.head.state.player,
      position: { ...bridge.exit, y: floor } } }
  const genesis = { ...base.lineage.genesis, state, riverBridgeIds: [bridge.id] }
  const old = { lineage: { origin: 'v35-migration' as const,
    rulesProfile: 'old-marker/v1' as const, seed: 'wizard-realms',
    sourceRevision: 0, genesis }, previous: null,
  head: { ...genesis, markerClaimReward: null, schemaVersion: PUBLIC_V36_SCHEMA,
    saveRevision: 0, witness: null } }
  const v39 = createPublicV39Root(createPublicV38Root(createPublicV37Root(old)))
  const root = createPublicV40Root(v39), factory = new IDBFactory()
  const store = createAtomicV40Store(factory), missing = await store.readChecked()
  if (missing.status !== 'missing') throw Error('Unexpected V40 target')
  expect(await store.commit(missing.proof, root)).toBe('committed')
  const crossed = await commitPublicV40(locks, store, 0, root.lineage,
    { kind: 'waystation-cross/v1' })
  expect(crossed.ok).toBe(true)
  if (!crossed.ok) throw Error(crossed.reason)
  const frames = Array.from({ length: 16 }, () => ({ intents: [{ type: 'move' as const,
    delta: { x: 0, z: 0.16 } }], walkRequested: true }))
  const walked = await commitPublicV40(locks, store, 1, crossed.value.lineage,
    { kind: 'frame-batch/v1', frames })
  expect(walked.ok).toBe(true)
  if (!walked.ok) throw Error(walked.reason)
  const read = await store.readChecked()
  expect(read.status).toBe('valid')
  if (read.status !== 'valid') throw Error('V40 source failed checked reload')
  return { source: read.root, store, factory }
}

describe('V41 controller, Iron Hall view and entry integration', () => {
  it('renders health/phase and persists payload-free study, engage, bolt and guard', async () => {
    probe.actions.length = probe.outcomes.length = 0
    const { source, store: v40Store, factory } = await nearHallCopy()
    const root = createPublicV41Root(source), v41Store = createAtomicV41Store(factory)
    const missing = await v41Store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V41 target')
    expect(await v41Store.commit(missing.proof, root)).toBe('committed')
    const html = renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v41',
      start: { head: root.head, lineage: root.lineage }, locks,
      store: v41Store, v40Store }))
    expect(html).toContain('data-public-version="v41"')
    expect(probe.projection?.v41IronHallSite?.revealed).toBe(true)
    expect(probe.projection?.v41IronHall).toMatchObject({ health: 12, wardHealth: 9,
      phase: 'dormant', learnedBolt: false })
    const journal = renderToStaticMarkup(createElement(WizardHud, {
      projection: probe.projection!, onIntent: vi.fn() }))
    expect(journal).toContain('Study Arc Bolt')
    expect(journal).toContain('Health 12/12')
    expect(journal).toContain('Highland Signal')
    expect(journal).toContain('Ringkeeper')
    expect(journal).toContain('Windward Waystation')
    const hudAfter = async () => {
      const checked = await v41Store.readChecked()
      if (checked.status !== 'valid') throw Error('V41 action failed checked reload')
      return renderToStaticMarkup(createElement(WizardHud, { onIntent: vi.fn(),
        projection: projectPublicV41IronHall(checked.root.head, probe.projection!) }))
    }
    for (const type of ['study', 'engage', 'bolt', 'guard', 'rest'] as const) {
      probe.onIntent!({ type: `v41.ironhall.${type}` })
      await vi.waitFor(() => expect(probe.outcomes).toHaveLength(
        ['study', 'engage', 'bolt', 'guard', 'rest'].indexOf(type) + 1))
      if (type === 'study') expect(await hudAfter()).toContain('Engage clockwork ward')
      if (type === 'engage') {
        const active = await hudAfter()
        expect(active).toContain('Cast Arc Bolt')
        expect(active).toContain('Guard next slam')
        expect(active).toContain('data-phase="windup"')
      }
    }
    expect(probe.actions).toEqual(['study', 'engage', 'bolt', 'guard', 'rest']
      .map((name) => ({ kind: `ironhall-${name}/v1` })))
    expect(probe.outcomes.slice(0, 4)).toEqual(Array(4).fill(
      expect.objectContaining({ status: 'saved' })))
    expect(probe.outcomes[4]).toMatchObject({ status: 'rejected', reason: 'cannot_rest' })
    // UI-only damaged/dormant projection; the failed checked rest above remains authoritative.
    const restView = { ...probe.projection!, v41IronHall: { ...probe.projection!.v41IronHall!,
      health: 8, phase: 'dormant' as const, rest: { hint: null, rejection: null } } }
    expect(renderToStaticMarkup(createElement(WizardHud, { projection: restView,
      onIntent: vi.fn() }))).toContain('Rest at the alcove')
    const postDefeatView = { ...restView, v41IronHall: { ...restView.v41IronHall,
      wardHealth: 0, wardDefeated: true, phase: 'defeated' as const } }
    expect(renderToStaticMarkup(createElement(WizardHud, { projection: postDefeatView,
      onIntent: vi.fn() }))).toContain('<button type="button">Rest at the alcove</button>')
    expect(await v41Store.readChecked()).toMatchObject({ status: 'valid', root: {
      head: { saveRevision: 4, ironHall: { learnedBolt: true, engaged: true,
        phase: 'windup', playerHealth: 12, wardHealth: 6, combatXp: 2 } } } })
    expect(await v40Store.readChecked()).toMatchObject({ status: 'valid', root: source })
  }, 120_000)

  it('advances a ward strike during movement and saves the checked dodge', async () => {
    const { source } = await nearHallCopy(), root = createPublicV41Root(source)
    const factory = new IDBFactory(), store = createAtomicV41Store(factory)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V41 target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const writer = (revision: number, lineage: typeof root.lineage,
      witness: Parameters<typeof commitPublicV41>[4]) =>
      commitPublicV41(locks, store, revision, lineage, witness)
    const runtime = createPublicV41ControllerRuntime({ head: root.head, lineage: root.lineage }, writer)
    expect(await runtime.action({ kind: 'ironhall-study/v1' })).toMatchObject({ status: 'saved' })
    expect(await runtime.action({ kind: 'ironhall-engage/v1' })).toMatchObject({ status: 'saved' })
    expect(runtime.idleFrameNeeded()).toBe(true)
    const beforeMove = runtime.preview().state.player.position.z
    for (let index = 0; index < 20; index++)
      expect(runtime.advanceFrame(index === 0 ? [{ type: 'move',
        delta: { x: 0, z: 0.16 } }] : [], false).rejections).toEqual([])
    expect(runtime.preview().state.player.position.z).toBeGreaterThan(beforeMove)
    expect(runtime.preview().ironHall.phase).toBe('recovery')
    const previewHealth = runtime.preview().ironHall.playerHealth
    expect(previewHealth).toBe(12) // More than 2.7 m from the ward: the slam misses.
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(await store.readChecked()).toMatchObject({ status: 'valid', root: { head: {
      ironHall: { phase: 'recovery', playerHealth: previewHealth },
      witness: { kind: 'frame-batch/v1' } } } })
  }, 120_000)

  it('gates ward and map marker on discovery without revealing opaque cells', () => {
    const root = createFreshPublicV41Root('wizard-realms'), factory = new IDBFactory()
    renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v41',
      start: { head: root.head, lineage: root.lineage }, locks,
      store: createAtomicV41Store(factory), v40Store: createAtomicV40Store(factory) }))
    const carrier = probe.projection!, hall = ironHallSite(root.head)!
    expect(carrier.v41IronHallSite).toBeNull()
    const meters = WORLD_CELL_METERS * WORLD_CHUNK_CELLS
    const cell = { id: 'hall-cell', gridX: Math.floor(hall.alcove.center.x / meters),
      gridZ: Math.floor(hall.alcove.center.z / meters), discoveredCells: 0,
      terrain: null, biome: null, markers: [] as string[] }
    const base = { ...carrier, map: { ...carrier.map,
      overview: () => ({ player: { gridX: 0, gridZ: 0, yaw: 0 }, cells: [cell] }) } }
    expect(projectPublicV41IronHall(root.head, base).map.overview!().cells).toEqual([cell])
    const shown = projectPublicV41IronHall({ ...root.head, state: { ...root.head.state,
      discoveryMask: encodeDiscoveredTileIds([hall.alcove.id]) } }, base)
    expect(shown.v41IronHallSite?.revealed).toBe(true)
    expect(shown.map.overview!().cells).toEqual([cell])
    expect(projectPublicV41IronHall({ ...root.head, state: { ...root.head.state,
      discoveryMask: encodeDiscoveredTileIds([hall.alcove.id]) } }, { ...base,
      map: { ...base.map, overview: () => ({ player: { gridX: 0, gridZ: 0, yaw: 0 },
        cells: [{ ...cell, discoveredCells: 1 }] }) } }).map.overview!().cells)
      .toEqual([{ ...cell, discoveredCells: 1, markers: ['Iron Hall'] }])
  })

  it('copies V40 only by choice, resumes V41 and keeps fresh starts independent', async () => {
    const factory = new IDBFactory(), source = createFreshPublicV40Root('wizard-realms')
    const v40Store = createAtomicV40Store(factory), store = createAtomicV41Store(factory)
    const missing = await v40Store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V40 source')
    expect(await v40Store.commit(missing.proof, source)).toBe('committed')
    const bindings: PublicV41EntryBindings = { locks, store, v40Store }
    const decision = await inspectPublicV41Entry(bindings)
    expect(decision).toEqual({ status: 'copy-available', sourceRevision: 0 })
    const html = renderToStaticMarkup(createElement(PublicV41EntryView, {
      entry: decision, busyChoice: null, onChoose: vi.fn(), onRetry: vi.fn(), actionError: null }))
    expect(html).toContain('Copy V40 adventure into V41')
    expect(html).toContain('New Game')
    expect(html).toContain('Open untouched V40 adventure')
    const copied = await choosePublicV41Entry(decision, 'copy', bindings)
    expect(copied).toMatchObject({ ok: true, value: { lineage: {
      origin: 'v40-migration', sourceRevision: 0 } } })
    expect(await v40Store.readChecked()).toMatchObject({ status: 'valid', root: source })
    const resume = await inspectPublicV41Entry(bindings)
    expect(resume.status).toBe('resume')
    expect(await choosePublicV41Entry(resume, 'resume', bindings)).toEqual(copied)
    expect(await choosePublicV41Entry(resume, 'create', bindings))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    const fresh = await choosePublicV41Entry(decision, 'create', { ...bindings,
      store: createAtomicV41Store(new IDBFactory()) })
    expect(fresh).toMatchObject({ ok: true, value: { lineage: { origin: 'fresh' } } })
    expect(await v40Store.readChecked()).toMatchObject({ status: 'valid', root: source })
  }, 120_000)
})
