import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PublicV23Controller, publicV28WorkRouteForView } from './PublicV23Controller'
import { displayPublicV28RiverBridge } from './PublicV28WorldView'
import { choosePublicV40Entry, inspectPublicV40Entry, PublicV40EntryView } from './PublicV40Entry'
import type { PublicV40EntryBindings } from './PublicV40Entry'
import { projectPublicV40Waystation } from './PublicV40WorldView'
import { createAtomicV39Store } from './domain/atomicV39Database'
import { createAtomicV40Store } from './domain/atomicV40Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { createFreshPublicV36Root, PUBLIC_V36_SCHEMA } from './domain/publicWorldV36Snapshot'
import { createPublicV37Root } from './domain/publicWorldV37Snapshot'
import { createPublicV38Root } from './domain/publicWorldV38Snapshot'
import { createFreshPublicV39Root, createPublicV39Root } from './domain/publicWorldV39Snapshot'
import { createFreshPublicV40Root, createPublicV40Root } from './domain/publicWorldV40Snapshot'
import { waystationRiverSite } from './domain/waystationRiverContent'
import { resolvePublicV28RiverBridge } from './domain/publicWorldV28RiverBridgeSites'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from './domain/worldChunks'
import type { WizardViewIntent, WizardViewProjection } from './view/contracts'
import { WizardHud } from './view/WizardHud'

const probe = vi.hoisted(() => ({ projection: null as WizardViewProjection | null,
  onIntent: null as ((intent: WizardViewIntent) => void) | null,
  actions: [] as unknown[], outcomes: [] as unknown[], injectSelectedWork: false,
  captureState: false, stateWrites: [] as unknown[] }))
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: (initial: unknown) => {
    const [value, setValue] = actual.useState(initial)
    return [value, (next: unknown) => {
      if (probe.captureState) probe.stateWrites.push(next)
      setValue(next)
    }]
  } }
})
vi.mock('./view/WizardSurface', () => ({ WizardSurface: ({ projection, onIntent }: {
  projection: WizardViewProjection; onIntent: (intent: WizardViewIntent) => void }) => {
  probe.projection = projection; probe.onIntent = onIntent; return null
} }))
vi.mock('./PublicV40ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV40ControllerRuntime')>()
  return { ...actual, createPublicV40ControllerRuntime: (
    ...args: Parameters<typeof actual.createPublicV40ControllerRuntime>) => {
    const runtime = actual.createPublicV40ControllerRuntime(...args)
    return { ...runtime, action: async (witness: Parameters<typeof runtime.action>[0]) => {
      probe.actions.push(witness)
      const outcome = await runtime.action(witness)
      probe.outcomes.push(outcome)
      return outcome
    } }
  } }
})
vi.mock('./PublicV40WorldView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV40WorldView')>()
  return { ...actual, projectPublicV40Waystation: (
    ...args: Parameters<typeof actual.projectPublicV40Waystation>) => {
    const view = actual.projectPublicV40Waystation(...args)
    if (!probe.injectSelectedWork) return view
    const site = waystationRiverSite(args[0].state.seed)!
    const works = view.savedTerrainWorks
    if (!works) throw Error('Expected V40 saved Works projection')
    const selected = { site: displayPublicV28RiverBridge(site), rejection: null,
      angleRadians: 0, distanceMeters: 1, reason: 'Ready', benefit: 'Checked deck' }
    return { ...view, savedTerrainWorks: { ...works, modeActive: true,
      actionsEnabled: true, preview: { selected, nearby: [selected], guidance: null } } }
  } }
})
const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>) => body() }

/** A checked V39 source positioned at the revealed dry north-bank stockpile. */
function northBankSource(buildKit = false, withSpade = false, nearerBridge = false) {
  const base = createFreshPublicV36Root('wizard-realms')
  const site = waystationRiverSite('wizard-realms')!
  const other = nearerBridge ? resolvePublicV28RiverBridge('wizard-realms',
    'works6:river-bridge:19') : null
  const target = other?.from ?? (buildKit ? site.from : site.approach)
  const floor = resolvePublicV23Surface(base.head.state, target, [])!.floorY
  const ids = [...new Set([...decodeDiscoveredTileIds(base.head.state.discoveryMask),
    ...site.footprintTileIds, ...(other?.footprintTileIds ?? [])])].sort()
  const state = { ...base.head.state, movementOwner: 'streamed' as const,
    discoveryMask: encodeDiscoveredTileIds(ids), player: { ...base.head.state.player,
      position: { ...target, y: floor },
      equipment: withSpade ? { ...base.head.state.player.equipment,
        mainHand: 'woodcutters_axe' as const } : base.head.state.player.equipment,
      inventory: buildKit ? [{ itemId: 'logs' as const, quantity: 8 }]
        : withSpade ? [{ itemId: 'stone' as const, quantity: 2 },
          { itemId: 'woodcutters_axe' as const, quantity: 1 },
          { itemId: 'field_spade' as const, quantity: 1 }]
        : [{ itemId: 'stone' as const, quantity: 2 }] } }
  const genesis = { ...base.lineage.genesis, state }
  const source = { lineage: { origin: 'v35-migration' as const,
    rulesProfile: 'old-marker/v1' as const, seed: 'wizard-realms',
    sourceRevision: 0, genesis }, previous: null,
  head: { ...genesis, markerClaimReward: null, schemaVersion: PUBLIC_V36_SCHEMA,
    saveRevision: 0, witness: null } }
  return createPublicV39Root(createPublicV38Root(createPublicV37Root(source)))
}

describe('V40 controller, Waystation projection, and entry integration', () => {
  it('plans the canonical Waystation bridge instead of a nearer discovered crossing', () => {
    probe.captureState = false; probe.stateWrites.length = 0
    const root = createPublicV40Root(northBankSource(true, false, true))
    const factory = new IDBFactory(), site = waystationRiverSite('wizard-realms')!
    const other = resolvePublicV28RiverBridge('wizard-realms', 'works6:river-bridge:19')!
    renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v40',
      start: { head: root.head, lineage: root.lineage }, locks,
      store: createAtomicV40Store(factory), v39Store: createAtomicV39Store(factory) }))
    const view = probe.projection!
    expect(view.v40WaystationQuest?.stage).toBe('build')
    expect(view.savedTerrainWorks?.suggestedSites?.some((choice) => choice.id === other.id)).toBe(true)
    const distance = (point: { x: number; z: number }) => Math.hypot(
      point.x - view.player.position[0], point.z - view.player.position[2])
    expect(distance(other.from)).toBeLessThan(distance(site.from))
    expect(renderToStaticMarkup(createElement(WizardHud, { projection: view,
      onIntent: vi.fn() }))).toContain('Plan Waystation bridge')
    probe.captureState = true
    probe.onIntent!({ type: 'saved-work.aim-waystation' })
    probe.captureState = false
    expect(probe.stateWrites).toEqual([true, 'bridge', site.approach.x, null])
    expect(probe.actions).toEqual([])
  })

  it('routes a visible Waystation spade equip through the checked streamed action', async () => {
    probe.actions.length = probe.outcomes.length = 0; probe.injectSelectedWork = false
    const root = createPublicV40Root(northBankSource(false, true))
    const factory = new IDBFactory(), store = createAtomicV40Store(factory)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V40 target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v40',
      start: { head: root.head, lineage: root.lineage }, locks, store,
      v39Store: createAtomicV39Store(factory) }))
    const spade = probe.projection?.backpack.stacks.find((stack) => stack.itemId === 'field_spade')
    expect(probe.projection?.v40WaystationSite).toMatchObject({ revealed: true })
    expect(probe.projection?.equipment.mainHand?.itemId).toBe('woodcutters_axe')
    expect(spade?.equippableSlots).toContain('mainHand')
    probe.onIntent!({ type: 'equipment.equip', stackId: spade!.id, slot: 'feet' })
    probe.onIntent!({ type: 'equipment.equip', stackId: 'absent', slot: 'mainHand' })
    expect(probe.actions).toEqual([])
    probe.onIntent!({ type: 'equipment.equip', stackId: spade!.id, slot: 'mainHand' })
    await vi.waitFor(() => expect(probe.outcomes).toHaveLength(1))
    expect(probe.actions).toEqual([{ kind: 'mireglass-action/v1', action: {
      type: 'equip_item', itemId: 'field_spade' } }])
    expect(probe.outcomes[0]).toMatchObject({ status: 'saved' })
    expect(await store.readChecked()).toMatchObject({ status: 'valid', root: { head: {
      saveRevision: 1, witness: { kind: 'mireglass-action/v1', action: {
        type: 'equip_item', itemId: 'field_spade' } },
      state: { player: { equipment: { mainHand: 'field_spade' } } },
    } } })
  }, 120_000)

  it('routes visible barter through the checked V40 store and keeps cross/claim payload-free', async () => {
    probe.actions.length = probe.outcomes.length = 0; probe.injectSelectedWork = false
    const source = northBankSource(), root = createPublicV40Root(source)
    const factory = new IDBFactory(), store = createAtomicV40Store(factory)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V40 target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const html = renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v40',
      start: { head: root.head, lineage: root.lineage }, locks, store,
      v39Store: createAtomicV39Store(factory) }))
    expect(html).toContain('data-public-version="v40"')
    expect(probe.projection?.v40WaystationQuest?.stage).toBe('choose-materials')
    expect(probe.projection?.v40WaystationSite).toMatchObject({ revealed: true, built: false })
    const journal = renderToStaticMarkup(createElement(WizardHud, {
      projection: probe.projection!, onIntent: vi.fn() }))
    expect(journal).toContain('Barter 2 stone for 8 logs')
    expect(journal).toContain('Highland Signal')
    expect(journal).toContain('Ringkeeper')
    probe.onIntent!({ type: 'v40.waystation.barter' })
    await vi.waitFor(async () => {
      const read = await store.readChecked()
      expect(read.status).toBe('valid')
      if (read.status === 'valid') expect(read.root.head).toMatchObject({ saveRevision: 1,
        witness: { kind: 'waystation-barter/v1' }, timberBartered: true })
    })
    expect(probe.actions).toEqual([{ kind: 'waystation-barter/v1' }])
    expect(probe.outcomes[0]).toMatchObject({ status: 'saved' })
    probe.onIntent!({ type: 'v40.waystation.cross' })
    await vi.waitFor(() => expect(probe.outcomes).toHaveLength(2))
    probe.onIntent!({ type: 'v40.waystation.claim' })
    await vi.waitFor(() => expect(probe.outcomes).toHaveLength(3))
    expect(probe.actions).toEqual([{ kind: 'waystation-barter/v1' },
      { kind: 'waystation-cross/v1' }, { kind: 'waystation-claim/v1' }])
    expect(probe.outcomes.slice(1)).toEqual([
      { status: 'rejected', reason: 'not_built' },
      { status: 'rejected', reason: 'wrong_region' },
    ])
    probe.onIntent!({ type: 'v39.ring.discover' })
    await vi.waitFor(() => expect(probe.outcomes).toHaveLength(4))
    probe.onIntent!({ type: 'v38.signal.inspect' })
    await vi.waitFor(() => expect(probe.outcomes).toHaveLength(5))
    expect(probe.actions.slice(3)).toEqual([
      { kind: 'ringkeeper-discover/v1' }, { kind: 'signal-vantage/v1' },
    ])
    expect(await createAtomicV39Store(factory).readChecked()).toEqual({ status: 'missing',
      proof: expect.anything() })
  }, 120_000)

  it('routes an actually selected V28 bridge through normal Works, not a Waystation shortcut', async () => {
    probe.actions.length = probe.outcomes.length = 0; probe.injectSelectedWork = true
    const root = createPublicV40Root(northBankSource(true))
    const factory = new IDBFactory(), site = waystationRiverSite('wizard-realms')!
    const store = createAtomicV40Store(factory), missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V40 target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v40',
      start: { head: root.head, lineage: root.lineage }, locks,
      store, v39Store: createAtomicV39Store(factory) }))
    expect(publicV28WorkRouteForView(probe.projection!, site.id, 'streamed',
      'wizard-realms')).toBe('river-bridge/v1')
    probe.onIntent!({ type: 'saved-work.confirm', id: site.id })
    await vi.waitFor(() => expect(probe.outcomes).toHaveLength(1))
    expect(probe.actions).toEqual([{ id: site.id, kind: 'river-bridge/v1' }])
    expect(probe.outcomes[0]).toMatchObject({ status: 'saved' })
    expect(await store.readChecked()).toMatchObject({ status: 'valid', root: {
      head: { saveRevision: 1, witness: { id: site.id, kind: 'river-bridge/v1' },
        riverBridgeIds: [site.id] } } })
    probe.injectSelectedWork = false
  }, 120_000)

  it('hides the stockpile until revealed and never uses a marker to reveal overview cells', () => {
    probe.injectSelectedWork = false
    const root = createFreshPublicV40Root('wizard-realms'), factory = new IDBFactory()
    renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v40',
      start: { head: root.head, lineage: root.lineage }, locks,
      store: createAtomicV40Store(factory), v39Store: createAtomicV39Store(factory) }))
    const carrier = probe.projection!, site = waystationRiverSite('wizard-realms')!
    expect(carrier.v40WaystationSite).toBeNull()
    expect(carrier.v40WaystationQuest?.stage).toBe('find')
    const chunkMeters = WORLD_CELL_METERS * WORLD_CHUNK_CELLS
    const cell = { id: 'waystation-cell', gridX: Math.floor(site.approach.x / chunkMeters),
      gridZ: Math.floor(site.approach.z / chunkMeters), discoveredCells: 0,
      terrain: null, biome: null, markers: [] as string[] }
    const base = { ...carrier, map: { ...carrier.map,
      overview: () => ({ player: { gridX: 0, gridZ: 0, yaw: 0 }, cells: [cell] }) } }
    const hidden = projectPublicV40Waystation(root.head, base)
    expect(hidden.v40WaystationSite).toBeNull()
    expect(hidden.map.overview!().cells).toEqual([cell])
    const revealed = { ...root.head, state: { ...root.head.state,
      discoveryMask: encodeDiscoveredTileIds([site.footprintTileIds[0]]) } }
    const shown = projectPublicV40Waystation(revealed, base)
    expect(shown.v40WaystationSite).toMatchObject({ id: site.id, revealed: true })
    expect(shown.map.overview!().cells).toEqual([cell])
    expect(shown.v40WaystationQuest?.stage).toBe('choose-materials')
    const discoveredCell = { ...cell, discoveredCells: 1 }
    const mapped = projectPublicV40Waystation(revealed, { ...base,
      map: { ...base.map, overview: () => ({ player: { gridX: 0, gridZ: 0, yaw: 0 },
        cells: [discoveredCell] }) } })
    expect(mapped.map.overview!().cells).toEqual([{ ...discoveredCell,
      markers: ['Windward Waystation'] }])
    const restricted = { ...base, unavailableActions: true as const }
    const near = { ...revealed, state: { ...revealed.state,
      movementOwner: 'streamed' as const, player: { ...revealed.state.player,
        position: site.approach } } }
    expect(projectPublicV40Waystation(near, restricted).unavailableActions).toBeUndefined()
    expect(projectPublicV40Waystation({ ...near, state: { ...near.state,
      discoveryMask: root.head.state.discoveryMask } }, restricted).unavailableActions).toBe(true)
    expect(projectPublicV40Waystation({ ...near, state: { ...near.state,
      movementOwner: 'greenway' as const } }, restricted).unavailableActions).toBe(true)
    expect(projectPublicV40Waystation({ ...near, state: { ...near.state,
      player: { ...near.state.player, position: { ...site.approach,
        x: site.approach.x + 12.01 } } } }, restricted).unavailableActions).toBe(true)
  })

  it('keeps the cross and return actions legible beside the older quest chapters', () => {
    const root = createPublicV40Root(northBankSource()), factory = new IDBFactory()
    renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v40',
      start: { head: root.head, lineage: root.lineage }, locks,
      store: createAtomicV40Store(factory), v39Store: createAtomicV39Store(factory) }))
    const carrier = probe.projection!, site = waystationRiverSite('wizard-realms')!
    const built = { ...root.head, riverBridgeIds: [site.id], state: { ...root.head.state,
      player: { ...root.head.state.player, position: site.exit } } }
    const atExit = { ...carrier, player: { ...carrier.player,
      position: [site.exit.x, site.exit.y, site.exit.z] as const } }
    const crossing = projectPublicV40Waystation(built, atExit)
    expect(crossing.v40WaystationQuest?.stage).toBe('cross')
    expect(renderToStaticMarkup(createElement(WizardHud, { projection: crossing,
      onIntent: vi.fn() }))).toContain('Record south-bank crossing')
    const greenway = root.head.state.greenway.stores.find((store) => store.id === 'store-greenway')!
    const returned = { ...built, southbankReached: true, state: { ...built.state,
      movementOwner: 'greenway' as const, player: { ...built.state.player,
        position: greenway.position } } }
    const fresh = createFreshPublicV40Root('wizard-realms')
    renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v40',
      start: { head: fresh.head, lineage: fresh.lineage }, locks,
      store: createAtomicV40Store(new IDBFactory()),
      v39Store: createAtomicV39Store(new IDBFactory()) }))
    const atStore = { ...probe.projection!, player: { ...probe.projection!.player,
      position: [greenway.position.x, greenway.position.y, greenway.position.z] as const } }
    const claim = projectPublicV40Waystation(returned, atStore)
    expect(claim.v40WaystationQuest?.stage).toBe('return')
    const journal = renderToStaticMarkup(createElement(WizardHud, { projection: claim,
      onIntent: vi.fn() }))
    expect(journal).toContain('Claim Waystation reward')
    expect(journal).toContain('Highland Signal')
    expect(journal).toContain('Ringkeeper')
  })

  it('offers checked V39 copy, independent fresh start and resume without changing the source', async () => {
    const factory = new IDBFactory(), source = createFreshPublicV39Root('wizard-realms')
    const v39Store = createAtomicV39Store(factory), store = createAtomicV40Store(factory)
    const missing = await v39Store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V39 source')
    expect(await v39Store.commit(missing.proof, source)).toBe('committed')
    const bindings: PublicV40EntryBindings = { locks, store, v39Store }
    const decision = await inspectPublicV40Entry(bindings)
    expect(decision).toEqual({ status: 'copy-available', sourceRevision: 0 })
    const html = renderToStaticMarkup(createElement(PublicV40EntryView, {
      entry: decision, busyChoice: null, onChoose: vi.fn(), onRetry: vi.fn(), actionError: null }))
    expect(html).toContain('Copy V39 adventure into V40')
    expect(html).toContain('New Game')
    expect(html).toContain('Open untouched V39 adventure')
    const copied = await choosePublicV40Entry(decision, 'copy', bindings)
    expect(copied).toMatchObject({ ok: true, value: { lineage: {
      origin: 'v39-migration', sourceRevision: 0 } } })
    expect(await v39Store.readChecked()).toMatchObject({ status: 'valid', root: source })
    const resume = await inspectPublicV40Entry(bindings)
    expect(resume.status).toBe('resume')
    expect(await choosePublicV40Entry(resume, 'resume', bindings)).toEqual(copied)
    expect(await choosePublicV40Entry(resume, 'create', bindings))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    const fresh = await choosePublicV40Entry(decision, 'create', { ...bindings,
      store: createAtomicV40Store(new IDBFactory()) })
    expect(fresh).toMatchObject({ ok: true, value: { lineage: { origin: 'fresh' } } })
    expect(await v39Store.readChecked()).toMatchObject({ status: 'valid', root: source })
  }, 120_000)
})
