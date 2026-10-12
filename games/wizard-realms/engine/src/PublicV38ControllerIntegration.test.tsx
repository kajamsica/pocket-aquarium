import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PublicV23Controller } from './PublicV23Controller'
import { choosePublicV38Entry, inspectPublicV38Entry, PublicV38EntryView } from './PublicV38Entry'
import type { PublicV38EntryBindings } from './PublicV38Entry'
import { projectPublicV38Signal } from './PublicV38WorldView'
import { createAtomicV37Store } from './domain/atomicV37Database'
import { createAtomicV38Store } from './domain/atomicV38Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { highlandCorridorCells, highlandLandmark } from './domain/highlandContent'
import { highlandSignalVane } from './domain/highlandSignalContent'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { createFreshPublicV36Root, PUBLIC_V36_SCHEMA } from './domain/publicWorldV36Snapshot'
import { createFreshPublicV37Root, createPublicV37Root } from './domain/publicWorldV37Snapshot'
import { createPublicV38Root } from './domain/publicWorldV38Snapshot'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from './domain/worldChunks'
import type { WizardViewIntent, WizardViewProjection } from './view/contracts'

const probe = vi.hoisted(() => ({ projection: null as WizardViewProjection | null,
  onIntent: null as ((intent: WizardViewIntent) => void) | null, witnesses: [] as unknown[] }))
vi.mock('./PublicV38ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV38ControllerRuntime')>()
  return { ...actual, createPublicV38ControllerRuntime: (
    ...args: Parameters<typeof actual.createPublicV38ControllerRuntime>) => {
    const runtime = actual.createPublicV38ControllerRuntime(...args)
    return { ...runtime, action: (witness: Parameters<typeof runtime.action>[0]) => {
      probe.witnesses.push(witness); return runtime.action(witness)
    } }
  } }
})
vi.mock('./view/WizardSurface', () => ({ WizardSurface: ({ projection, onIntent }: {
  projection: WizardViewProjection; onIntent: (intent: WizardViewIntent) => void }) => {
  probe.projection = projection; probe.onIntent = onIntent; return null
} }))
const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>) => body() }

/** A checked V37 copy with an already credited approach, not a fresh-player journey proof. */
function signalStart() {
  const base = createFreshPublicV36Root('wizard-realms')
  const vane = highlandSignalVane('wizard-realms'), crown = highlandLandmark('wizard-realms')
  const floor = resolvePublicV23Surface(base.head.state, vane.tile.center, [])!.floorY
  const ids = [...new Set([...decodeDiscoveredTileIds(base.head.state.discoveryMask),
    ...highlandCorridorCells().map(({ x, z }) => `tile-${x / 4 + 3}-${z / 4 + 3}`),
    crown.tile.id, vane.tile.id])].sort()
  const state = { ...base.head.state, movementOwner: 'streamed' as const,
    highland: { ...base.head.state.highland, landmarkDiscovered: true },
    windstep: { learned: true, activeUntilTick: 1200, nextCastTick: 1800,
      practicedRouteIndices: [vane.routeIndex] }, discoveryMask: encodeDiscoveredTileIds(ids),
    player: { ...base.head.state.player,
      position: { ...vane.tile.center, y: floor } } }
  const genesis = { ...base.lineage.genesis, state }
  const source = { lineage: { origin: 'v35-migration' as const,
    rulesProfile: 'old-marker/v1' as const, seed: 'wizard-realms',
    sourceRevision: 0, genesis }, previous: null,
  head: { ...genesis, markerClaimReward: null, schemaVersion: PUBLIC_V36_SCHEMA,
    saveRevision: 0, witness: null } }
  return createPublicV38Root(createPublicV37Root(source))
}

describe('V38 controller and projection integration', () => {
  it('routes a payload-free inspect intent through the checked V38 writer', async () => {
    probe.witnesses.length = 0
    const root = signalStart(), before = structuredClone(root), factory = new IDBFactory()
    const store = createAtomicV38Store(factory), missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V38 target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const html = renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v38', start: { head: root.head, lineage: root.lineage }, locks,
      store, v37Store: createAtomicV37Store(factory) }))
    expect(html).toContain('data-public-version="v38"')
    expect(probe.projection?.v38SignalQuest).toMatchObject({ id: 'highland-signal/v1', stage: 'vane' })
    expect(probe.projection?.v38SignalVane).toMatchObject({ inspected: false })
    probe.onIntent!({ type: 'v38.signal.inspect' })
    await vi.waitFor(async () => {
      const read = await store.readChecked()
      expect(read.status).toBe('valid')
      if (read.status === 'valid') expect(read.root.head).toMatchObject({ saveRevision: 1,
        witness: { kind: 'signal-vantage/v1' }, signalVantageInspected: true,
        signalClaimed: false })
    })
    expect(probe.witnesses).toEqual([{ kind: 'signal-vantage/v1' }])
    probe.onIntent!({ type: 'v38.signal.claim' })
    await vi.waitFor(() => expect(probe.witnesses).toEqual([
      { kind: 'signal-vantage/v1' }, { kind: 'signal-claim/v1' }]))
    const afterRejectedClaim = await store.readChecked()
    expect(afterRejectedClaim.status).toBe('valid')
    if (afterRejectedClaim.status === 'valid') expect(afterRejectedClaim.root.head.saveRevision).toBe(1)
    expect(root).toEqual(before)
  }, 120_000)

  it('projects the vane only when revealed and adds only a map clue after claim', () => {
    const root = signalStart(), progress = root.head
    renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v38',
      start: { head: root.head, lineage: root.lineage }, locks,
      store: createAtomicV38Store(new IDBFactory()),
      v37Store: createAtomicV37Store(new IDBFactory()) }))
    const chunkMeters = WORLD_CELL_METERS * WORLD_CHUNK_CELLS
    const target = { id: 'target', gridX: Math.floor(540 / chunkMeters),
      gridZ: Math.floor(-500 / chunkMeters), discoveredCells: 0,
      terrain: null, biome: null, markers: [] as string[] }
    const other = { ...target, id: 'other', gridX: target.gridX + 1 }
    const base = { ...probe.projection!, map: { ...probe.projection!.map,
      overview: () => ({ player: { gridX: 0, gridZ: 0, yaw: 0 }, cells: [target, other] }) } }
    const unclaimed = projectPublicV38Signal(progress, base)
    expect(unclaimed.v38SignalVane).toMatchObject({ inspected: false })
    expect(unclaimed.v38SignalQuest?.stage).toBe('vane')
    expect(unclaimed.map.overview!().cells).toEqual([target, other])
    const hidden = projectPublicV38Signal({ ...progress, state: { ...progress.state,
      discoveryMask: encodeDiscoveredTileIds([]) } }, base)
    expect(hidden.v38SignalVane).toBeNull()
    const claimed = projectPublicV38Signal({ ...progress, signalVantageInspected: true,
      signalClaimed: true }, base)
    expect(claimed.v38SignalQuest).toMatchObject({ stage: 'complete', complete: true })
    expect(claimed.v38SignalVane).toMatchObject({ inspected: true })
    expect(claimed.map.overview!().cells).toEqual([{ ...target,
      markers: ['Stormline Foothill bearing (clue)'] }, other])
    expect(claimed.map.overview!().cells[0]).toMatchObject({ discoveredCells: 0,
      terrain: null, biome: null })
  })

  it('keeps V37 projection free of V38 quest fields', () => {
    const root = createFreshPublicV37Root('wizard-realms'), factory = new IDBFactory()
    const html = renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v37', start: root, locks, store: createAtomicV37Store(factory),
      v36Store: {} as never }))
    expect(html).toContain('data-public-version="v37"')
    expect(probe.projection?.v38SignalQuest).toBeUndefined()
    expect(probe.projection?.v38SignalVane).toBeUndefined()
  })

  it('offers checked V37 copy or fresh V38, then only resumes the checked V38 branch', async () => {
    const factory = new IDBFactory(), source = createFreshPublicV37Root('wizard-realms')
    const v37Store = createAtomicV37Store(factory), v38Store = createAtomicV38Store(factory)
    const absent = await v37Store.readChecked()
    if (absent.status !== 'missing') throw Error('Unexpected V37 source')
    expect(await v37Store.commit(absent.proof, source)).toBe('committed')
    const bindings: PublicV38EntryBindings = { locks, store: v38Store, v37Store }
    const decision = await inspectPublicV38Entry(bindings)
    expect(decision).toEqual({ status: 'copy-available', sourceRevision: 0 })
    const html = renderToStaticMarkup(createElement(PublicV38EntryView, {
      entry: decision, busyChoice: null, onChoose: vi.fn(), onRetry: vi.fn(), actionError: null }))
    expect(html).toContain('Copy V37 adventure into V38')
    expect(html).toContain('New Game')
    expect(html).toContain('Open untouched V37 adventure')
    const copied = await choosePublicV38Entry(decision, 'copy', bindings)
    expect(copied).toMatchObject({ ok: true, value: { lineage: {
      origin: 'v37-migration', sourceRevision: 0 } } })
    expect((await v37Store.readChecked())).toMatchObject({ status: 'valid', root: source })
    const resume = await inspectPublicV38Entry(bindings)
    expect(resume.status).toBe('resume')
    expect(await choosePublicV38Entry(resume, 'resume', bindings)).toEqual(copied)
    expect(await choosePublicV38Entry(resume, 'create', bindings))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    const fresh = await choosePublicV38Entry(decision, 'create', { ...bindings,
      store: createAtomicV38Store(new IDBFactory()) })
    expect(fresh).toMatchObject({ ok: true, value: { lineage: { origin: 'fresh' } } })
  }, 120_000)
})
