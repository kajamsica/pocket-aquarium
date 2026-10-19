import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PublicV23Controller } from './PublicV23Controller'
import { choosePublicV39Entry, inspectPublicV39Entry, PublicV39EntryView } from './PublicV39Entry'
import type { PublicV39EntryBindings } from './PublicV39Entry'
import { projectPublicV39Ringkeeper } from './PublicV39WorldView'
import { createAtomicV37Store } from './domain/atomicV37Database'
import { createAtomicV38Store } from './domain/atomicV38Database'
import { createAtomicV39Store } from './domain/atomicV39Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { highlandQuarryRing } from './domain/highlandQuarryRingContent'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { createFreshPublicV36Root, PUBLIC_V36_SCHEMA } from './domain/publicWorldV36Snapshot'
import { createPublicV37Root } from './domain/publicWorldV37Snapshot'
import { createFreshPublicV38Root, createPublicV38Root } from './domain/publicWorldV38Snapshot'
import { createFreshPublicV39Root, createPublicV39Root } from './domain/publicWorldV39Snapshot'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from './domain/worldChunks'
import type { WizardViewIntent, WizardViewProjection } from './view/contracts'
import { WizardHud } from './view/WizardHud'

const probe = vi.hoisted(() => ({ projection: null as WizardViewProjection | null,
  onIntent: null as ((intent: WizardViewIntent) => void) | null,
  actions: [] as unknown[], completed: [] as unknown[], injectLinks: false,
  routeSource: 'ring-greenway' as 'ring-greenway' | 'ring-highland-quarry' }))
vi.mock('./view/WizardSurface', () => ({ WizardSurface: ({ projection, onIntent }: {
  projection: WizardViewProjection; onIntent: (intent: WizardViewIntent) => void }) => {
  probe.projection = projection; probe.onIntent = onIntent; return null
} }))
vi.mock('./PublicV39ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV39ControllerRuntime')>()
  return { ...actual, createPublicV39ControllerRuntime: (
    ...args: Parameters<typeof actual.createPublicV39ControllerRuntime>) => {
    const runtime = actual.createPublicV39ControllerRuntime(...args)
    return { ...runtime, action: async (witness: Parameters<typeof runtime.action>[0]) => {
      probe.actions.push(witness)
      const result = await runtime.action(witness)
      probe.completed.push(result)
      return result
    } }
  } }
})
vi.mock('./PublicV39WorldView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV39WorldView')>()
  return { ...actual, projectPublicV39Ringkeeper: (
    ...args: Parameters<typeof actual.projectPublicV39Ringkeeper>) => {
    const view = actual.projectPublicV39Ringkeeper(...args)
    if (!probe.injectLinks) return view
    const source = view.fairyRings.find((ring) => ring.id === probe.routeSource)!
    return { ...view, fairyRings: [{ ...source, discovered: true,
      destinations: probe.routeSource === 'ring-highland-quarry'
        ? [{ ringId: 'ring-greenway', label: 'Greenway Ring', discovered: true }]
        : [
        { ringId: 'ring-mireglass', label: 'Mireglass Ring', discovered: true },
        { ringId: 'ring-highland-quarry', label: 'Highland Quarry Ring', discovered: true },
      ] }], nearbyInteraction: { kind: 'fairy-ring' as const,
      targetId: source.id, label: source.label, action: 'Choose a destination.',
      actionable: false }, v33FairyTravel: true }
  } }
})
const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>) => body() }

/** Checked V38 source beside the revealed ring, not proof of the fresh-player journey. */
function quarrySource() {
  const base = createFreshPublicV36Root('wizard-realms')
  const ring = highlandQuarryRing('wizard-realms')
  const floor = resolvePublicV23Surface(base.head.state, ring.tile.center, [])!.floorY
  const ids = [...new Set([...decodeDiscoveredTileIds(base.head.state.discoveryMask),
    ring.tile.id])].sort()
  const state = { ...base.head.state, movementOwner: 'streamed' as const,
    discoveryMask: encodeDiscoveredTileIds(ids), player: { ...base.head.state.player,
      position: { ...ring.tile.center, y: floor } } }
  const genesis = { ...base.lineage.genesis, state }
  const source = { lineage: { origin: 'v35-migration' as const,
    rulesProfile: 'old-marker/v1' as const, seed: 'wizard-realms',
    sourceRevision: 0, genesis }, previous: null,
  head: { ...genesis, markerClaimReward: null, schemaVersion: PUBLIC_V36_SCHEMA,
    saveRevision: 0, witness: null } }
  return createPublicV38Root(createPublicV37Root(source))
}

describe('V39 controller, journal, and entry integration', () => {
  it('routes a payload-free Discover intent to a checked V39 write', async () => {
    probe.actions.length = probe.completed.length = 0; probe.injectLinks = false
    const root = createPublicV39Root(quarrySource()), before = structuredClone(root)
    const factory = new IDBFactory()
    const store = createAtomicV39Store(factory), missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V39 target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const html = renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v39', start: { head: root.head, lineage: root.lineage }, locks,
      store, v38Store: createAtomicV38Store(factory) }))
    expect(html).toContain('data-public-version="v39"')
    expect(probe.projection?.v39QuarryRing).toMatchObject({ discovered: false })
    expect(probe.projection?.v39RingkeeperQuest).toMatchObject({ stage: 'find' })
    expect(probe.projection?.v38SignalQuest).toBeDefined()
    probe.onIntent!({ type: 'v39.ring.discover' })
    await vi.waitFor(async () => {
      const read = await store.readChecked()
      expect(read.status).toBe('valid')
      if (read.status === 'valid') expect(read.root.head).toMatchObject({ saveRevision: 1,
        witness: { kind: 'ringkeeper-discover/v1' }, quarryRingDiscovered: true })
    })
    expect(probe.actions).toEqual([{ kind: 'ringkeeper-discover/v1' }])
    expect(root).toEqual(before)
  }, 120_000)

  it('projects the ring only on revealed local terrain and leaves overview fog intact', () => {
    probe.injectLinks = false
    const source = quarrySource(), root = createPublicV39Root(source), factory = new IDBFactory()
    renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v38', start: { head: source.head, lineage: source.lineage }, locks,
      store: createAtomicV38Store(factory), v37Store: createAtomicV37Store(factory) }))
    const carrier = probe.projection!
    expect(carrier.v39QuarryRing).toBeUndefined()
    const ring = highlandQuarryRing('wizard-realms')
    const chunkMeters = WORLD_CELL_METERS * WORLD_CHUNK_CELLS
    const target = { id: 'target', gridX: Math.floor(ring.tile.center.x / chunkMeters),
      gridZ: Math.floor(ring.tile.center.z / chunkMeters), discoveredCells: 0,
      terrain: null, biome: null, markers: [] as string[] }
    const base = { ...carrier, map: { ...carrier.map,
      overview: () => ({ player: { gridX: 0, gridZ: 0, yaw: 0 }, cells: [target] }) } }
    const shown = projectPublicV39Ringkeeper(root.head, base)
    expect(shown.v39QuarryRing).not.toBeNull()
    expect(shown.fairyRings.some((candidate) => candidate.id === 'ring-highland-quarry')).toBe(true)
    expect(shown.visualWorld?.fairyRings.some((candidate) => candidate.id === 'ring-highland-quarry')).toBe(true)
    expect(shown.v38SignalQuest).toBeDefined()
    expect(shown.v39RingkeeperQuest).toBeDefined()
    const journal = renderToStaticMarkup(createElement(WizardHud, {
      projection: shown, onIntent: vi.fn() }))
    expect(journal).toContain('Highland Signal')
    expect(journal).toContain('Ringkeeper')
    expect(shown.map.overview!().cells).toEqual([{ ...target,
      markers: ['Highland Quarry Ring'] }])
    expect(shown.map.overview!().cells[0]).toMatchObject({ discoveredCells: 0,
      terrain: null, biome: null })
    const hidden = projectPublicV39Ringkeeper({ ...root.head, state: { ...root.head.state,
      discoveryMask: encodeDiscoveredTileIds([]) } }, base)
    expect(hidden.v39QuarryRing).toBeNull()
    expect(hidden.fairyRings.some((candidate) => candidate.id === 'ring-highland-quarry')).toBe(false)
    expect(hidden.map.overview!().cells).toEqual([target])
  })

  it('keeps the old pair on the V33 witness and routes only the new pair to V39', async () => {
    probe.actions.length = probe.completed.length = 0; probe.injectLinks = true
    probe.routeSource = 'ring-greenway'
    const root = createFreshPublicV39Root('wizard-realms'), factory = new IDBFactory()
    renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v39',
      start: { head: root.head, lineage: root.lineage }, locks,
      store: createAtomicV39Store(factory), v38Store: createAtomicV38Store(factory) }))
    probe.onIntent!({ type: 'fairy-ring.teleport', ringId: 'ring-greenway',
      destinationRingId: 'ring-mireglass' })
    await vi.waitFor(() => expect(probe.completed).toHaveLength(1))
    expect(probe.actions[0]).toEqual({ kind: 'fairy-ring-travel/v1',
      sourceRingId: 'ring-greenway', targetRingId: 'ring-mireglass' })
    probe.onIntent!({ type: 'fairy-ring.teleport', ringId: 'ring-greenway',
      destinationRingId: 'ring-highland-quarry' })
    await vi.waitFor(() => expect(probe.completed).toHaveLength(2))
    expect(probe.actions[1]).toEqual({ kind: 'ringkeeper-travel/v1',
      direction: 'greenway-to-highland' })
    probe.routeSource = 'ring-highland-quarry'
    const quarry = createPublicV39Root(quarrySource())
    renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v39',
      start: { head: quarry.head, lineage: quarry.lineage }, locks,
      store: createAtomicV39Store(new IDBFactory()),
      v38Store: createAtomicV38Store(new IDBFactory()) }))
    probe.onIntent!({ type: 'fairy-ring.teleport', ringId: 'ring-highland-quarry',
      destinationRingId: 'ring-greenway' })
    await vi.waitFor(() => expect(probe.completed).toHaveLength(3))
    expect(probe.actions[2]).toEqual({ kind: 'ringkeeper-travel/v1',
      direction: 'highland-to-greenway' })
    probe.injectLinks = false
  }, 120_000)

  it('offers copy, fresh and checked continue without mutating V38', async () => {
    const factory = new IDBFactory(), source = createFreshPublicV38Root('wizard-realms')
    const v38Store = createAtomicV38Store(factory), v39Store = createAtomicV39Store(factory)
    const missing = await v38Store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V38 source')
    expect(await v38Store.commit(missing.proof, source)).toBe('committed')
    const bindings: PublicV39EntryBindings = { locks, store: v39Store, v38Store }
    const decision = await inspectPublicV39Entry(bindings)
    expect(decision).toEqual({ status: 'copy-available', sourceRevision: 0 })
    const html = renderToStaticMarkup(createElement(PublicV39EntryView, {
      entry: decision, busyChoice: null, onChoose: vi.fn(), onRetry: vi.fn(), actionError: null }))
    expect(html).toContain('Copy V38 adventure into V39')
    expect(html).toContain('New Game')
    expect(html).toContain('Open untouched V38 adventure')
    const copied = await choosePublicV39Entry(decision, 'copy', bindings)
    expect(copied).toMatchObject({ ok: true, value: { lineage: {
      origin: 'v38-migration', sourceRevision: 0 } } })
    expect(await v38Store.readChecked()).toMatchObject({ status: 'valid', root: source })
    const resume = await inspectPublicV39Entry(bindings)
    expect(resume.status).toBe('resume')
    expect(await choosePublicV39Entry(resume, 'resume', bindings)).toEqual(copied)
    expect(await choosePublicV39Entry(resume, 'create', bindings))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    const fresh = await choosePublicV39Entry(decision, 'create', { ...bindings,
      store: createAtomicV39Store(new IDBFactory()) })
    expect(fresh).toMatchObject({ ok: true, value: { lineage: { origin: 'fresh' } } })
    expect(await v38Store.readChecked()).toMatchObject({ status: 'valid', root: source })
  }, 120_000)
})
