import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PublicV23Controller, publicV23ReadActiveView, publicV23WorkRouteForView,
  publicV27StarterGuide, publicV44EffectiveGait } from './PublicV23Controller'
import { publicV23HasWestStripSite, publicWorldV23ViewProjection } from './PublicV23WorldView'
import { createPublicV31ControllerRuntime } from './PublicV31ControllerRuntime'
import { createPublicV26ControllerRuntime } from './PublicV26ControllerRuntime'
import { createPublicV23ControllerRuntime } from './PublicV23ControllerRuntime'
import { createWizardWorld } from './domain'
import { toViewProjection } from './App'
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
import { confirmPublicV23Work, createPublicV23Root, decodePublicV23Progress,
  previewPublicV23Work } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { createPublicV26Root, replayPublicV26Witness } from './domain/publicWorldV26Snapshot'
import { createPublicV27Root } from './domain/publicWorldV27Snapshot'
import { createPublicV28Root } from './domain/publicWorldV28Snapshot'
import { createPublicV29Root } from './domain/publicWorldV29Snapshot'
import { createPublicV30Root } from './domain/publicWorldV30Snapshot'
import { createPublicV31Root, decodePublicV31CheckedSuccessor,
  decodePublicV31Root, replayPublicV31Witness } from './domain/publicWorldV31Snapshot'
import type { PublicV31Witness } from './domain/publicWorldV31Snapshot'
import type { PublicV31Start } from './domain/publicWorldV31Flow'
import { decodePublicV31ActionProgress } from './domain/publicWorldV31Soil'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { resolvePublicV14Surface, createPublicV14StreamTerrain,
  createPublicV23StreamTerrain } from './domain/publicWorldV14Terrain'
import { createFreshPublicV14Head } from './domain/publicWorldV14Snapshot'
import { createFreshPublicV17Head } from './domain/publicWorldV17Snapshot'
import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { publicWorldV14ViewProjection } from './PublicV14WorldView'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { applyPublicV23Witness } from './domain/publicWorldV23Transitions'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { worldTileAtGrid } from './domain/worldChunks'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { resolvePublicV28RiverBridge } from './domain/publicWorldV28RiverBridgeSites'
import { resolvePublicV23Site } from './domain/publicWorldV23Sites'
import { mireglassAnchors, mireglassResources } from './domain/mireglassContent'
import { mireglassApproachTrail } from './domain/mireglassApproachTrail'
import { mireglassRouteSites } from './domain/mireglassRouteSites'
import { mireglassMoveBarrier } from './domain/mireglassMovementGate'
import { mireglassPlateauAt } from './domain/mireglassTerrain'
import { enumerateTerrainWorkSites, resolveTerrainWorkSite } from './domain/terrainWorks'
import { createTerrainWorkRuntimeHooks } from './domain/terrainWorkRuntimeHooks'
import { terrainWorkSupportAt } from './domain/terrainWorkSupport'
import type { WizardViewProjection } from './view/contracts'

const surface = vi.hoisted(() => ({ guidance: null as string | null }))
vi.mock('./view/WizardSurface', () => ({ WizardSurface: ({ projection }: {
  projection: WizardViewProjection }) => { surface.guidance = projection.map.guidance ?? null
  return null } }))

const ladder = 'works4:ladder:greenway-north-cliff:11'
const bridge = 'works4:bridge:greenway-creek:0'
const locks = { request: async <T,>(_name: string,
  _options: { mode: 'exclusive' }, body: () => T | Promise<T>) => body() }

describe('V44 mounted pace', () => {
  it('uses boots run distance on the V2 ride and retains on-foot Walk choice', () => {
    expect(publicV44EffectiveGait('leather_boots', true, true))
      .toMatchObject({ pace: 'run', metersPerStep: 0.24 })
    expect(publicV44EffectiveGait(null, true, false))
      .toMatchObject({ pace: 'walk', metersPerStep: 0.16 })
    expect(publicV44EffectiveGait('leather_boots', false, true))
      .toMatchObject({ pace: 'walk', metersPerStep: 0.16 })
    expect(publicV44EffectiveGait('leather_boots', false, false))
      .toMatchObject({ pace: 'run', metersPerStep: 0.24 })
  })
})

function withKnownLocalGround(view: WizardViewProjection,
  position: readonly [number, number, number], radius = 24,
  terrainRadius = radius): WizardViewProjection {
  const cx = Math.ceil(position[0] / 4 - 0.5), cz = Math.ceil(position[2] / 4 - 0.5)
  const tiles = [] as WizardViewProjection['map']['tiles'][number][]
  for (let gx = cx - radius; gx <= cx + radius; gx += 1)
    for (let gz = cz - radius; gz <= cz + radius; gz += 1) {
      const native = worldTileAtGrid(view.seed, gx, gz)
      tiles.push({ id: native.id, gridX: native.gridX, gridZ: native.gridZ,
        terrain: native.terrain, biome: native.biome, discovered: true,
        hasResource: false, hasStore: false, hasRing: false,
        hasRouteSite: false, hasBuiltRoute: false })
    }
  const terrain = tiles.filter((tile) => Math.abs(tile.gridX - 3 - cx) <= terrainRadius
    && Math.abs(tile.gridZ - 3 - cz) <= terrainRadius).map((tile) => {
    const native = worldTileAtGrid(view.seed, tile.gridX - 3, tile.gridZ - 3)
    return { id: native.id, position: [native.center.x, native.center.y,
      native.center.z] as const, size: [4, 4] as const, height: native.center.y,
      climate: native.biome }
  })
  return { ...view, terrain, map: { ...view.map, tiles } }
}
function postDigFenFixture(seed: string,
  position = mireglassAnchors(seed).salvager.tile.center, logs = 8) {
  const base = toViewProjection(createWizardWorld(seed), [])
  const river = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
  const spade = { ...base.backpack.stacks[0]!, itemId: 'field_spade' as const }
  const at = [position.x, position.y, position.z] as const
  const view = withKnownLocalGround({ ...base,
    player: { ...base.player, position: at },
    skillXp: { ...base.skillXp, excavation: 30 },
    backpack: { ...base.backpack, stacks: [spade,
      ...(logs ? [{ ...spade, itemId: 'logs' as const, quantity: logs }] : [])] },
    equipment: { ...base.equipment, mainHand: spade },
    v31Soil: { raisedCells: [], soilAvailable: 1 },
    map: { ...base.map, title: 'Mireglass Reach',
      guidance: 'Explore the fen and slate shelf.' } }, at, 16, 15)
  return { view, works: { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] },
    context: { movementOwner: 'streamed' as const, riverBridgeBuilt: true,
      riverBridgeId: river.id, claimedBridgeheadId: river.id,
      fringeMarkerStudied: true, fieldSpadeOwned: true, mireglassCacheRevealed: false,
      authoredFenBridgeId: null, builtTerrainWorkIds: [] as string[] } }
}
function v31Start(worldSeed = 'wizard-realms'): PublicV31Start {
  const v23 = createPublicV23Root(worldSeed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
  const v31 = createPublicV31Root(v30)
  return { head: v31.head, lineage: v31.lineage }
}
function v31Writer(start: PublicV31Start) {
  let current = structuredClone(start)
  return async (revision: number, lineage: PublicV31Start['lineage'],
    witness: PublicV31Witness) => {
    const next = revision === current.head.saveRevision
      ? replayPublicV31Witness(current.head, witness) : null
    if (!next) return { ok: false as const, reason: 'frame-rejected' }
    current = { lineage, head: { ...current.head, ...next,
      saveRevision: revision + 1, witness } }
    return { ok: true as const, value: current }
  }
}

describe('V31 Slate checked preview carrier', () => {
  it('retains a migrated wizard-realms generic Slate ladder through checked V31 Works', async () => {
    const seed = 'wizard-realms', source = createFreshPublicV17Head(seed)
    const v23 = createPublicV23Root(seed, { state: source.head.state,
      greenwayWorks: source.head.greenwayWorks, saveRevision: source.head.saveRevision,
      lineage: source.lineage })
    const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
    const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
    const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
    const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
    const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
    const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
    const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
    const start = createPublicV31Root(v30)
    expect(start.lineage.sourceReceipt).toBeDefined()
    const site = enumerateTerrainWorkSites(seed, { minGX: -110, maxGX: -95,
      minGZ: 104, maxGZ: 111 }).find((candidate) => candidate.kind === 'ladder'
        && candidate.obstacle === 'slate_cliff' && candidate.to.x < candidate.from.x)!
    expect(site).toBeDefined()
    if (site.kind !== 'ladder') throw new Error('Expected a canonical generic Slate ladder')
    const at = { x: site.from.x, z: site.from.z }
    const floor = resolvePublicV14Surface(start.head.state, at)!
    const state = { ...start.head.state, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(start.head.state.discoveryMask),
        ...site.footprintTileIds])].sort()),
      player: { ...start.head.state.player,
        position: { ...at, y: floor.floorY }, inventory: [
          ...start.head.state.player.inventory.filter((stack) => stack.itemId !== 'logs'),
          { itemId: 'logs' as const, quantity: 4 }] } }
    const active = { movementOwner: state.movementOwner, tick: state.tick,
      player: structuredClone(state.player), pendingBoundary: false,
      activeKnownTileIds: discoveredTileIdsInActiveWindow(state.discoveryMask,
        state.player.position), activeTiles: createPublicV14StreamTerrain(state).activeTiles() }
    const work = { kind: 'ladder' as const, bodyYaw: Math.PI / 2, aimX: null,
      aimZ: site.from.z, modeActive: true, actionsEnabled: true }
    const base = publicWorldV14ViewProjection(state, active, [], null, null, false, work)
    expect(base.savedTerrainWorks?.preview?.selected?.site.id).toBe(site.id)
    expect(base.savedTerrainWorks?.preview?.selected?.rejection).toBeNull()
    const projected = publicWorldV23ViewProjection({ ...start.head, state }, active,
      [], null, null, false, work)
    expect(projected.savedTerrainWorks?.preview?.selected?.site.id).toBe(site.id)
    expect(projected.savedTerrainWorks?.preview?.selected?.rejection).toBeNull()
    expect(projected.regionalLadders?.preview).toBeNull()
    expect(projected.map.guidance).not.toContain('West Mireglass Slate cliff:')
    expect(publicV23HasWestStripSite(seed)).toBe(false)
    expect(publicV23HasWestStripSite('greenway-alpha')).toBe(true)
    expect(publicV23WorkRouteForView(projected, site.id, 'streamed', seed))
      .toBe('legacy-work')
    const projectAt = (next: typeof state) => publicWorldV23ViewProjection({ ...start.head,
      state: next }, { ...active, player: structuredClone(next.player),
      activeKnownTileIds: discoveredTileIdsInActiveWindow(next.discoveryMask,
        next.player.position), activeTiles: createPublicV14StreamTerrain(next).activeTiles() },
    [], null, null, false, work)
    const noLogs = projectAt({ ...state, player: { ...state.player,
      inventory: [...state.player.inventory.filter((stack) => stack.itemId !== 'logs'),
        { itemId: 'logs' as const, quantity: 3 }] } })
    expect(noLogs.savedTerrainWorks?.preview?.selected?.rejection).toBe('not_owned')
    const farAt = { x: site.approach.x, z: site.approach.z }
    const farFloor = resolvePublicV14Surface(state, farAt)!
    const tooFar = projectAt({ ...state, player: { ...state.player,
      position: { ...farAt, y: farFloor.floorY } } })
    expect(tooFar.savedTerrainWorks?.preview?.selected?.site.id).toBe(site.id)
    expect(tooFar.savedTerrainWorks?.preview?.selected?.rejection).toBe('too_far')
    const hidden = projectAt({ ...state, discoveryMask: encodeDiscoveredTileIds(
      decodeDiscoveredTileIds(state.discoveryMask).filter((id) =>
        id !== site.footprintTileIds.at(-1))) })
    expect(hidden.savedTerrainWorks?.preview?.selected).toBeNull()
    expect(publicV23WorkRouteForView(hidden, site.id, 'streamed', seed)).toBeNull()
    const checked = applyPublicV23Witness({ state,
      greenwayWorks: start.head.greenwayWorks,
      regionalWorks: start.head.regionalWorks }, { kind: 'legacy-work', id: site.id })
    expect(checked).toHaveProperty('progress')
    if (!('progress' in checked)) return
    expect(checked.progress.state.terrainWorks.builtWorkIds).toContain(site.id)
    expect(applyPublicV23Witness(checked.progress, { kind: 'legacy-work', id: site.id }))
      .toEqual({ rejection: 'already_done' })
    const replayed = replayPublicV31Witness({ ...start.head, state },
      { kind: 'legacy-work', id: site.id })
    expect(replayed?.state.terrainWorks.builtWorkIds).toContain(site.id)
    expect(replayPublicV31Witness(replayed!, { kind: 'legacy-work', id: site.id }))
      .toBeNull()
    const built = publicWorldV23ViewProjection(replayed!, active, [], null, null, false, work)
    expect(built.savedTerrainWorks?.builtSites.map((entry) => entry.id)).toContain(site.id)
    expect(built.savedTerrainWorks?.preview?.selected).toBeNull()
    const shapedSource = createPublicV30Root({ lineage: v29.lineage,
      head: { ...v29.head, state, saveRevision: 1,
        witness: { kind: 'checkpoint' as const } } })
    const genesis = createPublicV31Root(shapedSource)
    expect(decodePublicV31Root(genesis)).toEqual(genesis)
    const factory = new IDBFactory()
    const store = createAtomicV31Store(factory)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected an empty V31 store')
    expect(await store.commit(missing.proof, genesis)).toBe('committed')
    const before = await store.readChecked()
    if (before.status !== 'valid') throw new Error('Expected a checked V31 root')
    const witness = { kind: 'legacy-work' as const, id: site.id }
    const committed = replayPublicV31Witness(before.root.head, witness)
    if (!committed) throw new Error('Generic ladder rejected by V31 replay')
    const successor = { lineage: before.root.lineage, previous: before.root.head,
      head: { ...before.root.head, ...committed, saveRevision: 1, witness } }
    expect(decodePublicV31CheckedSuccessor(before.root, successor)).toEqual(successor)
    expect(await store.commit(before.proof, successor)).toBe('committed')
    const reloaded = await store.readChecked()
    if (reloaded.status !== 'valid') throw new Error('Expected checked V31 reload')
    expect(decodePublicV31Root(reloaded.root)).toEqual(reloaded.root)
    expect(reloaded.root.head.state.terrainWorks.builtWorkIds).toContain(site.id)
    expect(reloaded.root.head.regionalWorks).toEqual(genesis.head.regionalWorks)
    expect(reloaded.root.head.greenwayWorks).toEqual(genesis.head.greenwayWorks)
    expect(reloaded.root.head.terrain).toEqual(genesis.head.terrain)
    expect(reloaded.root.head.raisedSoilCells).toEqual(genesis.head.raisedSoilCells)
    expect(reloaded.root.head.riverBridgeIds).toEqual(genesis.head.riverBridgeIds)
    expect(reloaded.root.head.claimedBridgeheadId).toBe(genesis.head.claimedBridgeheadId)
    expect(replayPublicV31Witness(reloaded.root.head, witness)).toBeNull()
    expect(await store.commit(reloaded.proof, { lineage: reloaded.root.lineage,
      previous: reloaded.root.head, head: { ...reloaded.root.head,
        saveRevision: 2, witness } })).toBe('invalid')
    expect(await store.readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1 } } })
    const html = renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v31', start: { ...start, head: { ...start.head, state } }, locks,
      store: createAtomicV31Store(factory), sourceStore: createAtomicV30Store(factory),
      v29Store: createAtomicV29Store(factory), v28Store: createAtomicV28Store(factory),
      v27Store: createAtomicV27Store(factory), v26Store: createAtomicV26Store(factory),
      v25Store: createAtomicV25Store(factory), v24Store: createAtomicV24Store(factory),
      v23Store: createAtomicV23Store(factory), v17Store: createAtomicV17Store(factory) }))
    expect(html).not.toContain('West cliff ladder aim')
    expect(html).not.toContain('class="v23-guide v23-guide-west"')
  }, 60_000)

  it('projects the exact V23 preview and writer result for a V31 save', () => {
    const seed = 'greenway-alpha', start = v31Start(seed)
    const site = resolvePublicV23Site(seed, 'works5:ladder:mireglass-slate:W:-103:4306')!
    const at = { x: site.from.x + 0.5, z: site.from.z }
    const floor = resolvePublicV14Surface(start.head.state, at)!
    const state = { ...start.head.state, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(start.head.state.discoveryMask), ...site.footprintTileIds,
        floor.tileId])].sort()),
      player: { ...start.head.state.player,
        position: { ...at, y: floor.floorY }, inventory: [
          ...start.head.state.player.inventory.filter((stack) => stack.itemId !== 'logs'),
          { itemId: 'logs' as const, quantity: 4 }] } }
    const v31 = { ...start.head, state }
    const exact = { state, greenwayWorks: v31.greenwayWorks,
      regionalWorks: v31.regionalWorks }
    const active = { movementOwner: state.movementOwner, tick: state.tick,
      player: structuredClone(state.player), pendingBoundary: false,
      activeKnownTileIds: discoveredTileIdsInActiveWindow(state.discoveryMask,
        state.player.position), activeTiles: createPublicV14StreamTerrain(state).activeTiles() }
    const work = { kind: 'ladder' as const, bodyYaw: Math.PI / 2, aimX: null,
      aimZ: site.from.z, modeActive: true, actionsEnabled: true }
    expect(previewPublicV23Work(v31, site.id)).toEqual({ site: null,
      rejection: 'invalid_progress' })
    expect(previewPublicV23Work(exact, site.id).rejection).toBeNull()
    expect(confirmPublicV23Work(exact, site.id)).toHaveProperty('progress')
    const projected = publicWorldV23ViewProjection(v31, active, [], null, null, false, work)
    expect(projected.regionalLadders?.preview).toEqual(previewPublicV23Work(exact, site.id))
    expect(projected.savedTerrainWorks?.preview?.selected?.rejection).toBeNull()
    const noLogsState = { ...state, player: { ...state.player,
      inventory: state.player.inventory.filter((stack) => stack.itemId !== 'logs') } }
    expect(previewPublicV23Work({ ...exact, state: noLogsState }, site.id).rejection)
      .toBe('not_owned')
    const built = applyPublicV23Witness(exact, { kind: 'regional-work', id: site.id })
    expect(built).toHaveProperty('progress')
    if ('progress' in built) {
      expect(built.progress.regionalWorks.builtLadderIds).toContain(site.id)
      expect(applyPublicV23Witness(built.progress, { kind: 'regional-work', id: site.id }))
        .toEqual({ rejection: 'already_done' })
    }
    const westAt = { x: -413.92, z: 430.08 }
    const westFloor = resolvePublicV14Surface(state, westAt)!
    const westState = { ...state, player: { ...state.player,
      position: { ...westAt, y: westFloor.floorY } } }
    const west = publicWorldV23ViewProjection({ ...v31, state: westState }, {
      ...active, player: structuredClone(westState.player),
      activeKnownTileIds: discoveredTileIdsInActiveWindow(westState.discoveryMask,
        westState.player.position), activeTiles: createPublicV14StreamTerrain(westState).activeTiles(),
    }, [], null, null, false, work)
    expect(west.regionalLadders?.preview?.rejection).toBe('too_far')
    expect(west.savedTerrainWorks?.preview?.selected?.reason)
      .toMatch(/Move east.*grounded dry terrain.*lower foot/)
    const eastAt = { x: site.from.x + 4, z: site.from.z }
    const eastFloor = resolvePublicV14Surface(state, eastAt)!
    const eastState = { ...state, player: { ...state.player,
      position: { ...eastAt, y: eastFloor.floorY } } }
    const east = publicWorldV23ViewProjection({ ...v31, state: eastState }, {
      ...active, player: structuredClone(eastState.player),
      activeKnownTileIds: discoveredTileIdsInActiveWindow(eastState.discoveryMask,
        eastState.player.position), activeTiles: createPublicV14StreamTerrain(eastState).activeTiles(),
    }, [], null, null, false, work)
    expect(east.regionalLadders?.preview?.rejection).toBe('too_far')
    expect(east.savedTerrainWorks?.preview?.selected?.reason).not.toContain('Move east')
    const partial = { ...state, discoveryMask: encodeDiscoveredTileIds(
      decodeDiscoveredTileIds(state.discoveryMask).filter((id) => id !== site.footprintTileIds[0])) }
    const hidden = publicWorldV23ViewProjection({ ...v31, state: partial }, {
      ...active, activeKnownTileIds: discoveredTileIdsInActiveWindow(partial.discoveryMask,
        partial.player.position), activeTiles: createPublicV14StreamTerrain(partial).activeTiles(),
    }, [], null, null, false, work)
    expect(hidden.regionalLadders?.preview).toBeNull()
    expect(hidden.savedTerrainWorks?.preview?.selected).toBeNull()
    expect(hidden.savedTerrainWorks?.preview?.guidance).toContain('Discover both ledges')
    for (const aimZ of [null, 440]) {
      const noAim = publicWorldV23ViewProjection(v31, active, [], null, null, false,
        { ...work, aimZ })
      expect(noAim.regionalLadders?.preview).toBeNull()
      expect(noAim.savedTerrainWorks?.preview?.selected).toBeNull()
      expect(noAim.savedTerrainWorks?.preview?.guidance).not.toContain('Discover both ledges')
    }
  }, 30_000)

  it('does not fabricate a Ready V23 west-face site for the other named seed', () => {
    const seed = 'wizard-realms', start = v31Start(seed)
    const supported = Array.from({ length: 29 }, (_, index) => resolvePublicV23Site(seed,
      `works5:ladder:mireglass-slate:W:-103:${4306 + index}`)).filter(Boolean)
    expect(supported).toHaveLength(0)
    const at = { x: -411.5, z: 430.6 }
    const floor = resolvePublicV14Surface(start.head.state, at)!
    const state = { ...start.head.state, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(start.head.state.discoveryMask), floor.tileId])].sort()),
      player: { ...start.head.state.player, position: { ...at, y: floor.floorY },
        inventory: [...start.head.state.player.inventory,
          { itemId: 'logs' as const, quantity: 4 }] } }
    const exact = { state, greenwayWorks: start.head.greenwayWorks,
      regionalWorks: start.head.regionalWorks }
    const active = { movementOwner: state.movementOwner, tick: state.tick,
      player: structuredClone(state.player), pendingBoundary: false,
      activeKnownTileIds: discoveredTileIdsInActiveWindow(state.discoveryMask,
        state.player.position), activeTiles: createPublicV14StreamTerrain(state).activeTiles() }
    expect(previewPublicV23Work(exact,
      'works5:ladder:mireglass-slate:W:-103:4306')).toEqual({ site: null,
        rejection: 'invalid_site' })
    const projected = publicWorldV23ViewProjection({ ...start.head, state }, active, [],
      null, null, false, { kind: 'ladder', bodyYaw: Math.PI / 2,
        aimX: null, aimZ: 430.6, modeActive: true, actionsEnabled: true })
    expect(projected.regionalLadders?.preview).toBeNull()
    expect(projected.savedTerrainWorks?.preview?.selected).toBeNull()
    expect(projected.savedTerrainWorks?.preview?.guidance).not.toContain('Discover both ledges')
  }, 30_000)
})

function guide(version: 'v25' | 'v26' | 'v27', builtLadder: boolean, builtBridge: boolean) {
  const factory = new IDBFactory(), v23 = createPublicV23Root('greenway-alpha')
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v17Store = createAtomicV17Store(factory), v23Store = createAtomicV23Store(factory)
  const v24Store = createAtomicV24Store(factory), v25Store = createAtomicV25Store(factory)
  const works = { ...v25.head.greenwayWorks,
    builtLadderIds: builtLadder ? [ladder] : [], builtBridgeIds: builtBridge ? [bridge] : [] }
  const construction = (builtLadder ? 60 : 0) + (builtBridge ? 80 : 0)
  const blocked = [builtLadder ? ladder : null, builtBridge ? bridge : null]
    .flatMap((id) => {
      const site = id ? resolvePublicV17GreenwaySite('greenway-alpha', id) : null
      return site && site.kind !== 'dig' ? site.blockingResourceIds : []
    })
  const state = { ...v25.head.state, player: { ...v25.head.state.player,
    xp: v25.head.state.player.xp + construction,
    level: 1 + Math.floor((v25.head.state.player.xp + construction) / 100),
    skillXp: { ...v25.head.state.player.skillXp,
      construction: v25.head.state.player.skillXp.construction + construction } },
    greenway: { ...v25.head.state.greenway, resources: v25.head.state.greenway.resources
      .map((resource) => blocked.includes(resource.id) ? { ...resource, depleted: true, health: 0 }
        : resource) } }
  const start25 = { ...v25, head: { ...v25.head, state, greenwayWorks: works } }
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const html = version === 'v25' ? renderToStaticMarkup(createElement(PublicV23Controller, {
    version, start: start25, locks, store: v25Store, sourceStore: v24Store,
    v23Store, v17Store })) : version === 'v26'
    ? renderToStaticMarkup(createElement(PublicV23Controller, {
    version, start: { ...v26, head: { ...v26.head, state, greenwayWorks: works } }, locks,
    store: createAtomicV26Store(factory), sourceStore: v25Store, v24Store, v23Store,
    v17Store })) : renderToStaticMarkup(createElement(PublicV23Controller, {
      version, start: { ...v27, head: { ...v27.head, state, greenwayWorks: works } }, locks,
      store: createAtomicV27Store(factory), sourceStore: createAtomicV26Store(factory),
      v25Store, v24Store, v23Store, v17Store }))
  return html.match(/<details class="v23-guide v25-start-guide">([\s\S]*?)<\/details>/)?.[1] ?? ''
}

describe('V26 starter route guide', () => {
  it.each([
    [false, false, 'First steps: chop trees for logs', 'A river bridge costs 8 logs', 'Routes ready'],
    [true, false, 'North ladder ready: climb the cliff', 'from the lower cliff face', 'your bridge'],
    [false, true, 'River bridge ready: cross the creek', 'from the dry bank', 'North ladder ready'],
    [true, true, 'Routes ready: explore beyond the valley', 'the built ladder', 'First steps'],
  ])('shows the saved-work stage for ladder=%s bridge=%s', (ladderBuilt, bridgeBuilt,
    title, direction, premature) => {
    const html = guide('v26', ladderBuilt, bridgeBuilt)
    expect(html).toContain(title)
    expect(html).toContain(direction)
    expect(html).not.toContain(premature)
  })

  it('preserves V25 guide copy regardless of saved works', () => {
    expect(guide('v25', true, true)).toBe(guide('v25', false, false))
    expect(guide('v25', true, true)).toContain('First steps: chop trees for logs')
  })
})

describe('V27 starter route coaching', () => {
  it('keeps V24 marker guidance when V28 river Works overlaps the V31 Mireglass trail', () => {
    const seed = 'wizard-realms', v23 = createPublicV23Root(seed)
    const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
    const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
    const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
    const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
    const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
    const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
    const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
    const v31 = createPublicV31Root(v30)
    const position = { x: -80, y: 0, z: 0 }
    const floor = resolvePublicV23Surface(v31.head.state, position, [])
    if (!floor) throw new Error('Missing dry Mireglass trail')
    const currentTile = worldTileAtGrid(seed, -20, 0)
    const start = { ...v31, head: { ...v31.head, state: { ...v31.head.state,
      movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(v31.head.state.discoveryMask), currentTile.id])].sort()),
      player: { ...v31.head.state.player,
        position: { ...position, y: floor.floorY } } } } }
    const { schemaVersion: _schema, saveRevision: _revision,
      witness: _witness, ...progress } = start.head
    expect(decodePublicV31ActionProgress(progress)).not.toBeNull()
    const factory = new IDBFactory()
    const html = renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v31', start, locks, store: createAtomicV31Store(factory),
      sourceStore: createAtomicV30Store(factory), v29Store: createAtomicV29Store(factory),
      v28Store: createAtomicV28Store(factory), v27Store: createAtomicV27Store(factory),
      v26Store: createAtomicV26Store(factory), v25Store: createAtomicV25Store(factory),
      v24Store: createAtomicV24Store(factory), v23Store: createAtomicV23Store(factory),
      v17Store: createAtomicV17Store(factory) }))
    expect(html).toContain('Follow the dry west trail and study the frontier marker.')
    expect(html).not.toContain('Connected river: use only marked dry-bank crossings')
    expect(surface.guidance).toBe('Follow the dry west trail and study the frontier marker.')
  }, 20_000)

  it('guides each side of a built ladder without treating the starter creek bridge as a river crossing', () => {
    const base = toViewProjection(createWizardWorld('greenway-alpha'), [])
    const atZ = (z: number) => ({ ...base, player: { ...base.player,
      position: [base.player.position[0], base.player.position[1], z] as const } })
    const works = { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] }
    const upper = publicV27StarterGuide(atZ(-6), works)
    expect(upper.summary).toBe('Upper shelf: gather 8 bridge logs')
    expect(upper.action).toContain('stay north of the cliff lip for the westward route')
    expect(upper.action).toContain('Chop accessible Greenway oaks until you carry 8 logs')
    expect(upper.action).not.toContain('lower foot')
    const lower = publicV27StarterGuide(atZ(-5.9), works)
    expect(lower.action).toContain('built ladder’s lower foot and climb')
    expect(lower.action).toContain('upper north shelf for the westward route')
    expect(lower.action).not.toContain('stay north of the cliff lip')
    for (const stage of [upper, lower]) {
      expect(stage.boots).toContain('Buy boots at Greenway Outfitters')
      expect(stage.spade).toContain('Outfitters also sells a spade')
    }
    const both = publicV27StarterGuide(atZ(-6), { ...works, builtBridgeIds: [bridge] })
    expect(both.action).toContain('8 logs for the separate connected-river bridge')
    expect(both.action).not.toContain('connected-river bridge is built')
  })

  it('teaches the Surveyor creek bridge before the Ledger ladder and separate river bridge', () => {
    const base = toViewProjection(createWizardWorld('greenway-alpha'), [])
    const empty = { builtLadderIds: [], builtBridgeIds: [], dugTileIds: [] }
    const before = publicV27StarterGuide(base, empty)
    expect(before.summary).toBe('First steps: 8-log South creek bridge')
    expect(before.action).toContain('an 8-log South creek bridge (0/8)')
    expect(before.action).toContain('The 4-log north ladder opens the later west route')
    const withLogs = { ...base, backpack: { ...base.backpack,
      stacks: [...base.backpack.stacks, { ...base.backpack.stacks[0]!, id: 'logs-test',
        itemId: 'logs' as const, quantity: 8 }] } }
    const ready = publicV27StarterGuide(withLogs, empty)
    expect(ready.summary).toBe('8 logs ready: build South creek bridge')
    expect(ready.action).toContain('cross its saved deck to the dry far bank')
    const crossed = publicV27StarterGuide(base, { ...empty, builtBridgeIds: [bridge] })
    expect(crossed.summary).toBe('Bridge ready: cross to the far bank')
    expect(crossed.action).toContain('Then build the north cliff ladder for 4 logs')
    expect(crossed.action).toContain('8 more for the connected-river bridge')
  })

  it('sends a short-log streamed owner back to Greenway without a cliff-side cue', () => {
    const base = toViewProjection(createWizardWorld('greenway-alpha'), [])
    const view = { ...base, player: { ...base.player,
      position: [base.player.position[0], base.player.position[1], -6] as const },
      backpack: { ...base.backpack, stacks: [{ ...base.backpack.stacks[0]!,
        id: 'logs-test', itemId: 'logs', quantity: 3 }] } }
    const works = { builtLadderIds: [ladder], builtBridgeIds: [bridge], dugTileIds: [] }
    const stage = publicV27StarterGuide(view, works,
      { movementOwner: 'streamed', riverBridgeBuilt: false })
    expect(stage.summary).toBe('Connected-river bridge next: return for 8 logs')
    expect(stage.action).toContain('Return east via your saved north ladder to accessible Greenway oaks')
    expect(stage.action).toContain('Gather 5 more logs for the 8-log connected-river bridge')
    expect(stage.action).not.toContain('upper north shelf')
    expect(stage.action).not.toContain('starter creek')
  })

  it('directs a streamed owner across the saved connected-river bridge', () => {
    const view = toViewProjection(createWizardWorld('greenway-alpha'), [])
    const works = { builtLadderIds: [ladder], builtBridgeIds: [bridge], dugTileIds: [] }
    const stage = publicV27StarterGuide(view, works,
      { movementOwner: 'streamed', riverBridgeBuilt: true })
    expect(stage.summary).toBe('Connected-river bridge ready: cross its deck')
    expect(stage.action).toContain('use its saved deck from a dry bank to cross')
    expect(stage.action).not.toContain('Gather')
    expect(stage.action).not.toContain('return east')
  })

  it('retains a V28 river-bank bearing in starter Map and HUD before building', () => {
    const base = toViewProjection(createWizardWorld('wizard-realms'), [])
    const cue = 'Follow this dry bank west, revealing ground until Works shows a supported crossing.'
    const view = { ...base, map: { ...base.map, guidance: cue },
      backpack: { ...base.backpack, stacks: [{ ...base.backpack.stacks[0]!,
        id: 'logs-test', itemId: 'logs' as const, quantity: 8 }] },
      savedTerrainWorks: { builtSites: [], dugTileIds: [], preview: null,
        context: 'v28-river' as const } }
    const works = { builtLadderIds: [ladder], builtBridgeIds: [bridge], dugTileIds: [] }
    const before = publicV27StarterGuide(view, works,
      { movementOwner: 'streamed', riverBridgeBuilt: false })
    expect(before).toMatchObject({ summary: 'River bank: find a supported crossing', action: cue })
    expect(publicV27StarterGuide({ ...view, savedTerrainWorks: {
      ...view.savedTerrainWorks, context: 'works4-greenway' as const } }, works,
    { movementOwner: 'streamed', riverBridgeBuilt: false }).action)
      .toContain('open Works at a marked Ready dry-bank site')
    expect(publicV27StarterGuide(view, works,
      { movementOwner: 'streamed', riverBridgeBuilt: true }).action)
      .toContain('saved deck')
    expect(publicV27StarterGuide({ ...view, map: { ...view.map, title: 'Mireglass Reach' } },
      works, { movementOwner: 'streamed', riverBridgeBuilt: false,
        mireglassGuidance: 'Mireglass guidance.' }).action).toBe('Mireglass guidance.')
  })

  it('stops telling a far-bank player to cross after the River Works find is claimed', () => {
    const base = toViewProjection(createWizardWorld('wizard-realms'), [])
    const site = resolvePublicV28RiverBridge(base.seed, 'works6:river-bridge:-43')!
    const view = { ...base, player: { ...base.player,
      position: [site.exit.x, site.exit.y, site.exit.z] as const },
      v30Bridgehead: { bridgeId: site.id, position: [site.exit.x, site.exit.y,
        site.exit.z] as const, tileId: site.footprintTileIds.at(-1)!,
      claimed: true, claimReady: false, reward: null } }
    const works = { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] }
    const stage = publicV27StarterGuide(view, works,
      { movementOwner: 'streamed', riverBridgeBuilt: true })
    expect(stage.action).toContain('Mireglass frontier marker')
    expect(stage.action).not.toContain('cross')
  })

  it('guides the saved greenway-alpha far-bank position toward the live frontier marker', () => {
    const base = toViewProjection(createWizardWorld('greenway-alpha'), [])
    const site = resolvePublicV28RiverBridge(base.seed, 'works6:river-bridge:-43')!
    const position = [-156.84, 1.28, 117.46] as const
    const view = { ...base, player: { ...base.player, position } }
    const works = { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] }
    const context = { movementOwner: 'streamed' as const, riverBridgeBuilt: true,
      riverBridgeId: site.id, claimedBridgeheadId: site.id }
    expect(position[2]).toBeGreaterThan(site.to.z)
    expect(mireglassAnchors(base.seed).fringeMarker.tile.center).toMatchObject({ x: -108, z: 104 })
    const stage = publicV27StarterGuide(view, works, context)
    expect(stage.action).toBe('Mireglass frontier marker: ENE, about 51 m direct. North is up on the map; stay on revealed dry ground.')
    expect(stage.action).not.toMatch(/\b[xyz] -?\d/)
    expect(publicV27StarterGuide({ ...view, player: { ...view.player,
      position: [-146.84, 1.28, 117.46] as const } }, works, context).action)
      .toContain('ENE, about 41 m direct')
  })

  it('uses the default seed marker rather than the greenway-alpha position', () => {
    const base = toViewProjection(createWizardWorld('wizard-realms'), [])
    const site = resolvePublicV28RiverBridge(base.seed, 'works6:river-bridge:-43')!
    const marker = mireglassAnchors(base.seed).fringeMarker.tile.center
    const position = [marker.x - 20, marker.y, marker.z + 20] as const
    const view = { ...base, player: { ...base.player, position } }
    const works = { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] }
    expect(position[2]).toBeGreaterThan(site.to.z)
    expect(publicV27StarterGuide(view, works, { movementOwner: 'streamed',
      riverBridgeBuilt: true, riverBridgeId: site.id, claimedBridgeheadId: site.id }).action)
      .toContain('Mireglass frontier marker: NE, about 28 m direct')
  })

  it.each(['greenway-alpha', 'wizard-realms'])('leads a studied %s player from the marker onto the canonical salvager trail', (seed) => {
    const base = toViewProjection(createWizardWorld(seed), [])
    const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const marker = mireglassAnchors(seed).fringeMarker.tile.center
    const trail = mireglassApproachTrail(seed)
    const view = { ...base, player: { ...base.player,
      position: [marker.x, marker.y, marker.z] as const },
      map: { ...base.map, title: 'Mireglass Reach', guidance: 'Explore the fen and slate shelf.' } }
    const works = { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] }
    expect(marker.z).toBeGreaterThan(site.to.z)
    expect(trail[0]).toEqual(marker)
    expect(trail.at(-1)).toEqual(mireglassAnchors(seed).salvager.tile.center)
    expect(trail[8].x).toBe(marker.x - 16)
    expect(trail[8].z).toBe(marker.z + 16)
    const context = { movementOwner: 'streamed' as const, riverBridgeBuilt: true,
      riverBridgeId: site.id, claimedBridgeheadId: site.id,
      fringeMarkerStudied: true, fieldSpadeOwned: false, mireglassCacheRevealed: false }
    const stage = publicV27StarterGuide(view, works, context)
    expect(stage.summary).toBe('Mireglass salvager: field spade')
    expect(stage.action).toContain('Follow the dry route toward the Mireglass salvager: SW, about 23 m to the next dry waypoint.')
    expect(stage.action).toContain('At the salvager, buy a field spade. North is up on the map; stay on revealed dry ground.')
    expect(stage.action).not.toContain('frontier marker')
    const along = (index: number) => publicV27StarterGuide({ ...view,
      player: { ...view.player, position: [trail[index].x, trail[index].y,
        trail[index].z] as const } }, works, context).action
    expect(along(7)).toContain('about 4 m to the next dry waypoint.')
    expect(along(8)).toContain('about 23 m to the next dry waypoint.')
    const midpoint = { x: (trail[0].x + trail[1].x) / 2,
      z: (trail[0].z + trail[1].z) / 2 }
    const aroundMidpoint = (offset: number) => publicV27StarterGuide({ ...view,
      player: { ...view.player, position: [midpoint.x,
        marker.y, midpoint.z + offset] as const } }, works, context).action
    expect(aroundMidpoint(-0.01)).toBe(aroundMidpoint(0.01))
    expect(publicV27StarterGuide(view, works, { ...context, fieldSpadeOwned: true }).action)
      .toBe('Explore the fen and slate shelf.')
    expect(publicV27StarterGuide({ ...view, map: { ...view.map,
      guidance: 'Return to the salvager to trade, then explore onward.' } }, works,
    { ...context, mireglassCacheRevealed: true }).action)
      .toBe('Return to the salvager to trade, then explore onward.')
  })

  it.each(['greenway-alpha', 'wizard-realms'])('hands an owned-spade %s V31 player to a visible first Dig', (seed) => {
    const base = toViewProjection(createWizardWorld(seed), [])
    const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const salvager = mireglassAnchors(seed).salvager.tile.center
    const spade = { ...base.backpack.stacks[0]!, itemId: 'field_spade' as const }
    const view = { ...base, player: { ...base.player,
      position: [salvager.x, salvager.y, salvager.z] as const },
      backpack: { ...base.backpack, stacks: [spade] },
      equipment: { ...base.equipment, mainHand: spade },
      v31Soil: { raisedCells: [], soilAvailable: 0 },
      map: { ...base.map, title: 'Mireglass Reach',
        guidance: 'Explore the fen and slate shelf.' } }
    const works = { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] }
    const context = { movementOwner: 'streamed' as const, riverBridgeBuilt: true,
      riverBridgeId: site.id, claimedBridgeheadId: site.id,
      fringeMarkerStudied: true, fieldSpadeOwned: true, mireglassCacheRevealed: false,
      grounded: true }
    const stage = publicV27StarterGuide(view, works, context)
    expect(stage.summary).toBe('Excavation Lv2: Dig revealed, unoccupied dry loam')
    expect(stage.action).toContain('Equip your field spade, close trade/map/Works')
    expect(stage.action).toContain('unoccupied revealed dry grassy (loam) patch within 5 m to Dig topsoil for 30 Excavation XP')
    expect(stage.action).not.toContain('unoccupied revealed dry patch')
    expect(stage.action).toContain('Chopped-stump E prompts are another 30 XP option')
    expect(stage.action).not.toMatch(/\b(?:cache|seal)\b|\b[xyz] -?\d/i)
    expect(stage.spade).toContain('Chopped-stump E interactions also use it')
    expect(stage.spade).toContain('tap revealed, unoccupied dry grassy (loam) ground in reach')
    expect(stage.spade).not.toContain('cache')
    expect(publicV27StarterGuide({ ...view, equipment: { ...view.equipment,
      mainHand: null } }, works, context).spade)
      .toContain('then tap revealed, unoccupied dry grassy (loam) ground in reach')
    expect(publicV27StarterGuide({ ...view, backpack: { ...view.backpack, stacks: [] },
      equipment: { ...view.equipment, mainHand: null } }, works,
    { ...context, fieldSpadeOwned: false }).spade)
      .toContain('click-to-dig on revealed, unoccupied dry grassy (loam) ground')
    expect(publicV27StarterGuide({ ...view, v31Soil: undefined }, works, context).action)
      .toBe('Explore the fen and slate shelf.')
    const revealed = { ...context, mireglassCacheRevealed: true }
    expect(publicV27StarterGuide(view, works, revealed).action).toContain('Dig topsoil')
    expect(publicV27StarterGuide(view, works, revealed).spade)
      .toContain('revealed cache E interaction')
    const levelTwo = { ...view, skillXp: { ...view.skillXp, excavation: 30 },
      map: { ...view.map, guidance: 'Equip a field spade and excavate the revealed seal cache.' } }
    const next = publicV27StarterGuide(levelTwo, works, revealed)
    expect(next.summary).toBe('Mireglass Reach')
    expect(next.action).toBe('Equip a field spade and excavate the revealed seal cache.')
  })

  it('keeps pack, pose, equipment, marker, and river prerequisites ahead of first Dig', () => {
    const seed = 'greenway-alpha', base = toViewProjection(createWizardWorld(seed), [])
    const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const marker = mireglassAnchors(seed).fringeMarker.tile.center
    const spade = { ...base.backpack.stacks[0]!, itemId: 'field_spade' as const }
    const view = { ...base, player: { ...base.player,
      position: [marker.x, marker.y, marker.z] as const },
      backpack: { ...base.backpack, stacks: [spade] },
      equipment: { ...base.equipment, mainHand: spade },
      v31Soil: { raisedCells: [], soilAvailable: 0 },
      map: { ...base.map, title: 'Wilderness' } }
    const works = { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] }
    const context = { movementOwner: 'streamed' as const, riverBridgeBuilt: true,
      riverBridgeId: site.id, claimedBridgeheadId: site.id,
      fringeMarkerStudied: true, fieldSpadeOwned: true, grounded: true }
    const full = publicV27StarterGuide({ ...view, backpack: { ...view.backpack,
      capacity: 1 } }, works, context)
    expect(full.summary).toBe('Excavation Lv2: make room, then Dig')
    expect(full.action).toContain('Make room in your pack and terrain bag first.')
    const airborne = publicV27StarterGuide(view, works, { ...context, grounded: false })
    expect(airborne.summary).toBe('Excavation Lv2: land, then Dig')
    expect(airborne.action).toContain('Land on stable ground first.')
    expect(publicV27StarterGuide({ ...view, equipment: { ...view.equipment,
      mainHand: null } }, works, context).summary)
      .toBe('Excavation Lv2: equip spade, then Dig')
    expect(publicV27StarterGuide(view, works, { ...context,
      fringeMarkerStudied: false }).action).toContain('Mireglass frontier marker')
    expect(publicV27StarterGuide(view, works, { ...context,
      claimedBridgeheadId: null }).summary).toBe('Explore the far bank')
    const onDeck = { ...view, player: { ...view.player,
      position: [site.from.x, site.from.y, (site.from.z + site.to.z) / 2] as const } }
    expect(publicV27StarterGuide(onDeck, works, context).summary).toBe('On the saved river bridge')
    expect(publicV27StarterGuide(view, works, { ...context,
      movementOwner: 'greenway' }).summary).not.toContain('Excavation')
  })

  it.each(['greenway-alpha', 'wizard-realms'])('charts only known dry Fen waypoints after the first %s Dig', (seed) => {
    const { view, works, context } = postDigFenFixture(seed)
    const [x, , z] = view.player.position
    const known = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) => ({
      ...tile, discovered: Math.hypot((tile.gridX - 3) * 4 - x,
        (tile.gridZ - 3) * 4 - z) <= 48 })) } }
    expect(known.map.tiles).toHaveLength(33 * 33)
    expect(known.terrain).toHaveLength(31 * 31)
    const stage = publicV27StarterGuide(known, works, context)
    expect(stage.summary).toBe('Fen bank: follow a known dry waypoint')
    expect(stage.action).toMatch(/Fen north bank: [NSEW]+, about \d+ m to the next known safe turn/)
    expect(stage.action).not.toMatch(/works1:|tile-|mireglass_reach\/route\/|\b[xyz] -?\d/)
    expect(publicV27StarterGuide({ ...known, player: { ...known.player,
      position: [x + 0.02, known.player.position[1], z] as const } }, works, context).action)
      .toBe(stage.action)
    const onlyHere = { ...known, map: { ...known.map, tiles: known.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.gridX - 3 === Math.ceil(x / 4 - 0.5)
        && tile.gridZ - 3 === Math.ceil(z / 4 - 0.5) })) } }
    const fallback = publicV27StarterGuide(onlyHere, works, context)
    expect(fallback.summary).toBe('Fen bank: reveal adjacent safe ground')
    expect(fallback.action).toContain('No known dry continuation')
    expect(fallback.action).not.toMatch(/: [NSEW]+, about/)
  })

  it.each(['greenway-alpha', 'wizard-realms'])('names a Fen bridge only after its full %s footprint is discovered', (seed) => {
    const site = mireglassRouteSites(seed).find((candidate) => candidate.kind === 'bridge')!
    const { view, works, context } = postDigFenFixture(seed, site.from)
    const footprint = [-1, 0, 1, 2, 3].map((offset) =>
      `tile-${Math.ceil(site.from.x / 4 - 0.5) + 3}-${Math.ceil(site.from.z / 4 - 0.5) + offset + 3}`)
    const partial = new Set(footprint.filter((_, index) => index !== 2))
    const hidden = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: partial.has(tile.id) })) } }
    const concealed = publicV27StarterGuide(hidden, works, context)
    expect(concealed.summary).toBe('Fen bank: reveal nearby crossing ground')
    expect(concealed.action).not.toContain(site.id)
    expect(concealed.action).not.toContain('fully revealed')
    const found = publicV27StarterGuide(view, works, context)
    expect(footprint.every((id) => view.map.tiles.some((tile) => tile.id === id
      && tile.discovered))).toBe(true)
    expect(found.summary).toBe('Fen bank: gather 8 logs and check Works')
    expect(found.action).toContain('fully revealed nearby')
    expect(found.action).toContain('checked Ready or blocked preview')
    expect(found.action).not.toContain(site.id)
  })

  it('keeps the #171 revealed Fen bank on a safe approach until Works can list a site', () => {
    const { view, works, context } = postDigFenFixture('greenway-alpha',
      { x: -334.06, y: 1.18, z: 338.35 })
    const [x, , z] = view.player.position
    const gx = Math.ceil(x / 4 - 0.5), gz = Math.ceil(z / 4 - 0.5)
    const candidates = enumerateTerrainWorkSites(view.seed,
      { minGX: gx - 4, maxGX: gx + 4, minGZ: gz - 4, maxGZ: gz + 4 })
      .filter((site) => site.kind === 'bridge' && site.obstacle === 'fen_channel'
        && Math.hypot(site.from.x - x, site.from.z - z) <= 16)
    expect(candidates).toHaveLength(0)
    const stage = publicV27StarterGuide(view, works, context)
    expect(stage.summary).toBe('Fen bank: follow a known dry waypoint')
    expect(stage.action).toMatch(/: [NSEW]+, about \d+ m to the next known safe turn/)
    expect(stage.action).not.toContain('Open Works')
    expect(publicV27StarterGuide({ ...view, player: { ...view.player,
      position: [x + 0.02, view.player.position[1], z] as const } }, works, context).action)
      .toBe(stage.action)
  })

  it.each(['greenway-alpha', 'wizard-realms'])('invites %s Works only inside its checked Fen source window', (seed) => {
    const authored = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const gx = Math.ceil(authored.from.x / 4 - 0.5)
    const gz = Math.ceil(authored.from.z / 4 - 0.5)
    const site = enumerateTerrainWorkSites(seed,
      { minGX: gx - 4, maxGX: gx + 4, minGZ: gz - 4, maxGZ: gz + 4 })
      .find((candidate) => candidate.kind === 'bridge' && candidate.obstacle === 'fen_channel'
        && candidate.from.x === authored.from.x && candidate.from.z === authored.from.z)!
    expect(site).toBeDefined()
    for (const [offset, rejection] of [[-8, 'too_far'], [0, null]] as const) {
      const at = worldTileAtGrid(seed, gx, gz + offset / 4).center
      const { view, works, context } = postDigFenFixture(seed, at)
      const base = createFreshPublicV14Head(seed).head.state
      const floor = resolvePublicV14Surface(base, at)?.floorY
      expect(floor).toBeDefined()
      const state = { ...base, movementOwner: 'streamed' as const,
        player: { ...base.player, position: { ...at, y: floor! },
          inventory: [...base.player.inventory, { itemId: 'logs' as const, quantity: 8 }] },
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(base.discoveryMask), ...site.footprintTileIds,
          worldTileAtGrid(seed, gx, gz + offset / 4).id,
        ])].sort()) }
      const active = { movementOwner: state.movementOwner, tick: state.tick,
        player: structuredClone(state.player), pendingBoundary: false,
        activeKnownTileIds: discoveredTileIdsInActiveWindow(state.discoveryMask, state.player.position),
        activeTiles: createPublicV14StreamTerrain(state).activeTiles() }
      const checked = publicWorldV14ViewProjection(state, active, [], null, null, false,
        { kind: 'bridge', bodyYaw: 0, modeActive: true, actionsEnabled: true })
      expect(checked.savedTerrainWorks?.preview?.nearby.find((choice) => choice.site.id === site.id)
        ?.rejection).toBe(rejection)
      const stage = publicV27StarterGuide({ ...view, savedTerrainWorks: checked.savedTerrainWorks },
        works, context)
      expect(stage.summary).toBe('Fen bank: gather 8 logs and check Works')
      expect(stage.action).toContain('checked Ready or blocked preview')
      const closed = publicWorldV14ViewProjection(state, active, [], null, null, false,
        { kind: 'bridge', bodyYaw: 0, modeActive: false, actionsEnabled: true })
      expect(closed.savedTerrainWorks?.preview).toBeNull()
      expect(publicV27StarterGuide({ ...view, savedTerrainWorks: closed.savedTerrainWorks },
        works, context).action).toContain('Open Works')
    }
  })

  it('does not invent a route to a revealed Fen source across unknown ground or open pits', () => {
    const { view, works, context } = postDigFenFixture('greenway-alpha',
      { x: -334.06, y: 1.18, z: 338.35 })
    const [x, , z] = view.player.position
    const gx = Math.ceil(x / 4 - 0.5), gz = Math.ceil(z / 4 - 0.5)
    const footprint = new Set(mireglassRouteSites(view.seed)
      .filter((site) => site.kind === 'bridge')
      .flatMap((site) => [-1, 0, 1, 2, 3].map((offset) =>
        `tile-${Math.ceil(site.from.x / 4 - 0.5) + 3}-${Math.ceil(site.from.z / 4 - 0.5) + offset + 3}`)))
    const hidden = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.id === `tile-${gx + 3}-${gz + 3}`
        || footprint.has(tile.id) })) } }
    const noRoute = publicV27StarterGuide(hidden, works, context)
    expect(noRoute.summary).toBe('Fen bank: reveal adjacent safe ground')
    expect(noRoute.action).toContain('no known dry route')
    expect(noRoute.action).not.toMatch(/: [NSEW]+, about/)
    const allPits = { ...context, openPitColumns: [[-1, 0], [1, 0], [0, -1], [0, 1]]
      .map(([dx, dz]) => ({ gx: gx + dx, gz: gz + dz, openDepth: 2 })) }
    const blocked = publicV27StarterGuide(view, works, allPits)
    expect(blocked.action).toContain('no known dry route')
    expect(blocked.action).not.toMatch(/: [NSEW]+, about/)
    const fogged = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.id === `tile-${gx + 3}-${gz + 3}` })) } }
    expect(publicV27StarterGuide(fogged, works, context).action).not.toContain('Open Works')
  })

  it('routes the #197 off-lane player to the saved Fen deck source instead of generic exploration', () => {
    const { view, works, context } = postDigFenFixture('greenway-alpha',
      { x: -339.35, y: 1.20, z: 361.93 }, 0)
    const stage = publicV27StarterGuide(view, works, { ...context,
      builtTerrainWorkIds: ['works1:bridge:-86:91:z'] })
    expect(stage.summary).toBe('Fen deck: follow a known dry approach')
    expect(stage.action).toMatch(/: [NSEW]+, about \d+ m to the next known safe turn/)
    expect(stage.action).toContain('dry source')
    expect(stage.action).toContain('Do not step sideways onto the wet span')
    expect(publicV27StarterGuide({ ...view, player: { ...view.player,
      position: [-339.33, view.player.position[1], 361.93] as const } }, works,
    { ...context, builtTerrainWorkIds: ['works1:bridge:-86:91:z'] }).action).toBe(stage.action)
  })

  it.each(['greenway-alpha', 'wizard-realms'])('aligns and crosses a saved %s Fen deck, then releases the cue', (seed) => {
    const authored = mireglassRouteSites(seed).find((route) => route.kind === 'bridge')!
    const gx = Math.ceil(authored.from.x / 4 - 0.5)
    const gz = Math.ceil(authored.from.z / 4 - 0.5)
    const site = enumerateTerrainWorkSites(seed,
      { minGX: gx - 4, maxGX: gx + 4, minGZ: gz - 4, maxGZ: gz + 4 })
      .find((candidate) => candidate.kind === 'bridge' && candidate.obstacle === 'fen_channel'
        && candidate.from.x === authored.from.x && candidate.from.z === authored.from.z)!
    expect(site).toBeDefined()
    if (site.kind !== 'bridge') throw new Error('Expected a Fen bridge')
    const { view, works, context } = postDigFenFixture(seed, site.from, 0)
    const built = { ...context, builtTerrainWorkIds: [site.id] }
    expect(publicV27StarterGuide(view, works, built).summary)
      .toBe('Fen deck: cross lengthwise to the far bank')
    expect(publicV27StarterGuide(view, works, { ...context,
      authoredFenBridgeId: authored.id }).summary)
      .toBe('Fen deck: cross lengthwise to the far bank')
    const offCenter = { ...view, player: { ...view.player,
      position: [site.from.x + 1.2, site.from.y, site.from.z + 1] as const } }
    const alignment = publicV27StarterGuide(offCenter, works, built)
    const barrier = createTerrainWorkRuntimeHooks(() => [site], () => new Set()).hooks.barrier
    expect(barrier(
      { x: site.from.x + 0.9, y: site.from.y, z: site.from.z + 1 },
      { x: site.from.x + 0.7, z: site.from.z + 1 }, null)).toBe('fen_channel')
    expect(barrier(
      { x: site.from.x + 0.9, y: site.from.y, z: site.from.z },
      { x: site.from.x + 0.7, z: site.from.z }, null)).toBeNull()
    expect(alignment.summary).toBe('Fen deck: retreat to the dry entry end')
    expect(alignment.action).toMatch(/First walk north.*Only then move sideways/)
    expect(publicV27StarterGuide(offCenter, works, { ...built, openPitColumns: [{
      gx: Math.ceil(site.approach.x / 4 - 0.5),
      gz: Math.ceil(site.approach.z / 4 - 0.5), openDepth: 2,
    }] }).summary).toBe('Fen deck: retreat to the dry entry end')
    expect(publicV27StarterGuide(offCenter, works, { ...built, openPitColumns: [{
      gx, gz, openDepth: 2,
    }] }).summary).toBe('Fen deck: retrace a known dry approach')
    const onDeck = { ...view, player: { ...view.player,
      position: [site.from.x, site.supportPath[1].y, site.supportPath[1].z] as const } }
    expect(publicV27StarterGuide(onDeck, works, built).action)
      .toContain('Walk straight along its center')
    const far = { ...view, player: { ...view.player,
      position: [site.to.x, site.to.y, site.to.z] as const } }
    expect(publicV27StarterGuide(far, works, built).summary).toBe('Mireglass Reach')
    expect(publicV27StarterGuide(view, works, { ...built,
      mireglassCacheRevealed: true }).summary).toBe('Mireglass Reach')
    expect(publicV27StarterGuide(view, works, { ...context,
      builtTerrainWorkIds: ['works1:bridge:9999:9999:z'] }).summary).toBe('Mireglass Reach')
    const hidden = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.id !== site.footprintTileIds[2] })) } }
    expect(publicV27StarterGuide(hidden, works, built).summary).toBe('Mireglass Reach')
    expect(publicV27StarterGuide(hidden, works, built).action).not.toContain('Fen deck')
  })

  it('does not invent a dry source approach across unknown ground or open pits', () => {
    const { view, works, context } = postDigFenFixture('greenway-alpha',
      { x: -339.35, y: 1.20, z: 361.93 }, 0)
    const built = { ...context, builtTerrainWorkIds: ['works1:bridge:-86:91:z'] }
    const [x, , z] = view.player.position
    const gx = Math.ceil(x / 4 - 0.5), gz = Math.ceil(z / 4 - 0.5)
    const remoteX = -335.35, remoteGX = Math.ceil(remoteX / 4 - 0.5)
    const disconnected = { ...view, player: { ...view.player,
      position: [remoteX, view.player.position[1], z] as const },
    map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.id === `tile-${remoteGX + 3}-${gz + 3}`
        || ['tile--83-92', 'tile--83-93', 'tile--83-94', 'tile--83-95', 'tile--83-96']
          .includes(tile.id) })) } }
    expect(publicV27StarterGuide(disconnected, works, built).summary)
      .toBe('Fen deck: retrace a known dry approach')
    const pits = { ...built, openPitColumns: [[-1, 0], [1, 0], [0, -1], [0, 1]]
      .map(([dx, dz]) => ({ gx: gx + dx, gz: gz + dz, openDepth: 2 })) }
    const noRoute = publicV27StarterGuide(view, works, pits)
    expect(noRoute.summary).toBe('Fen deck: retrace a known dry approach')
    expect(noRoute.action).toContain('No known dry route')
    expect(noRoute.action).not.toMatch(/: [NSEW]+, about/)
  })

  it('selects a locally revealed saved Fen bridge instead of an earlier hidden bridge ID', () => {
    const seed = 'greenway-alpha'
    const candidates = mireglassRouteSites(seed).filter((route) => route.kind === 'bridge')
      .map((route) => resolveTerrainWorkSite(seed,
        `works1:bridge:${Math.ceil(route.from.x / 4 - 0.5)}:${Math.ceil(route.from.z / 4 - 0.5) + 1}:z`))
      .filter((site) => site?.kind === 'bridge' && site.obstacle === 'fen_channel')
      .sort((a, b) => a!.id.localeCompare(b!.id))
    const [first, local] = candidates
    expect(local).toBeDefined()
    if (!first || !local || first.kind !== 'bridge' || local.kind !== 'bridge')
      throw new Error('Expected two supported Fen bridges')
    const { view, works, context } = postDigFenFixture(seed, local.from, 0)
    const firstOnly = first.footprintTileIds.find((id) =>
      !local.footprintTileIds.includes(id))!
    expect(first.id.localeCompare(local.id)).toBeLessThan(0)
    expect(view.map.tiles.some((tile) => tile.id === firstOnly && tile.discovered)).toBe(true)
    const masked = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.id !== firstOnly })) } }
    const stage = publicV27StarterGuide(masked, works, { ...context,
      builtTerrainWorkIds: [first.id, local.id] })
    expect(stage.summary).toBe('Fen deck: cross lengthwise to the far bank')
    expect(stage.action).not.toContain(first.id)
  })

  it.each(['greenway-alpha', 'wizard-realms'])('guides a crossed %s Fen bridge toward Slate on known dry ground', (seed) => {
    const authored = mireglassRouteSites(seed).filter((site) => site.kind === 'bridge')
      .sort((a, b) => Math.abs(a.from.x + 344) - Math.abs(b.from.x + 344))[0]!
    const bridgeId = seed === 'greenway-alpha' ? 'works1:bridge:-86:91:z'
      : `works1:bridge:${Math.ceil(authored.from.x / 4 - 0.5)}:${Math.ceil(authored.from.z / 4 - 0.5) + 1}:z`
    const bridgeSite = resolveTerrainWorkSite(seed, bridgeId)!
    if (bridgeSite.kind !== 'bridge') throw new Error('Expected a saved Fen bridge')
    const far = seed === 'greenway-alpha' ? { x: -343.37, y: 1.20, z: 368.69 }
      : { ...bridgeSite.to, z: bridgeSite.to.z + 1 }
    const strip = seed === 'greenway-alpha' ? { x: -336.32, y: 1.20, z: 414.88 }
      : { ...bridgeSite.to, z: bridgeSite.to.z + 46 }
    for (const position of [far, strip]) {
      const fixture = postDigFenFixture(seed, position, 0)
      const cx = Math.ceil(position.x / 4 - 0.5), cz = Math.ceil(position.z / 4 - 0.5)
      const view = { ...fixture.view, map: { ...fixture.view.map,
        tiles: fixture.view.map.tiles.map((tile) => ({ ...tile,
          discovered: Math.abs(tile.gridX - 3 - cx) <= 4
            && Math.abs(tile.gridZ - 3 - cz) <= 4 })) } }
      const { works, context } = fixture
      expect(view.map.tiles).toHaveLength(33 * 33)
      expect(view.terrain).toHaveLength(31 * 31)
      const saved = { ...context, builtTerrainWorkIds: [bridgeId],
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...bridgeSite.footprintTileIds,
          ...view.map.tiles.filter((tile) => tile.discovered).map((tile) => tile.id)])].sort()) }
      const stage = publicV27StarterGuide(view, works, saved)
      expect(stage.summary).toContain('Slate')
      expect(stage.action).toMatch(/: [NSEW]+, about \d+ m to the next known safe turn/)
      expect(stage.action).toContain('revealed dry ground')
      expect(stage.action).not.toMatch(/works1:|tile-|mireglass_reach\/route\/|\b[xyz] -?\d/)
      expect(publicV27StarterGuide({ ...view, player: { ...view.player,
        position: [position.x + 0.02, position.y, position.z] as const } }, works, saved).action)
        .toBe(stage.action)
    }
  })

  it('keeps the post-Fen Slate cue behind saved discovery, crossing, cache, and ladder gates', () => {
    const seed = 'greenway-alpha', bridgeId = 'works1:bridge:-86:91:z'
    const site = resolveTerrainWorkSite(seed, bridgeId)!
    if (site.kind !== 'bridge') throw new Error('Expected a Fen bridge')
    const { view, works, context } = postDigFenFixture(seed,
      { x: -343.37, y: 1.20, z: 368.69 }, 0)
    const saved = { ...context, builtTerrainWorkIds: [bridgeId],
      discoveryMask: encodeDiscoveredTileIds(site.footprintTileIds) }
    expect(publicV27StarterGuide(view, works, saved).summary).toContain('Slate approach')
    expect(publicV27StarterGuide(view, works, { ...saved,
      discoveryMask: encodeDiscoveredTileIds(site.footprintTileIds.slice(1)) }).summary)
      .toBe('Mireglass Reach')
    expect(publicV27StarterGuide(view, works, { ...saved,
      mireglassCacheRevealed: true }).summary).toBe('Mireglass Reach')
    const slate = mireglassRouteSites(seed).find((route) => route.kind === 'ladder')!
    expect(publicV27StarterGuide(view, works, { ...saved,
      authoredSlateLadderId: slate.id }).summary).toBe('Mireglass Reach')
    expect(publicV27StarterGuide(view, works, { ...saved,
      regionalSlateLadderBuilt: true }).summary).toBe('Mireglass Reach')
    const genericSlate = enumerateTerrainWorkSites(seed,
      { minGX: -108, maxGX: -98, minGZ: 104, maxGZ: 112 })
      .find((candidate) => candidate.kind === 'ladder'
        && candidate.obstacle === 'slate_cliff')!.id
    expect(resolveTerrainWorkSite(seed, genericSlate)?.obstacle).toBe('slate_cliff')
    expect(publicV27StarterGuide(view, works, { ...saved,
      builtTerrainWorkIds: [bridgeId, genericSlate] }).summary).toBe('Mireglass Reach')
    expect(publicV27StarterGuide({ ...view, skillXp: { ...view.skillXp,
      excavation: 0 } }, works, saved).summary).toContain('Excavation Lv2')
    const nearSource = { ...view, player: { ...view.player,
      position: [site.from.x, site.from.y, site.from.z] as const } }
    expect(publicV27StarterGuide(nearSource, works, saved).summary).toContain('Fen deck')
  })

  it('does not invent a Slate bearing across fog, open pits, or an unconnected map', () => {
    const seed = 'greenway-alpha', bridgeId = 'works1:bridge:-86:91:z'
    const site = resolveTerrainWorkSite(seed, bridgeId)!
    if (site.kind !== 'bridge') throw new Error('Expected a Fen bridge')
    const { view, works, context } = postDigFenFixture(seed,
      { x: -336.32, y: 1.20, z: 414.88 }, 0)
    const saved = { ...context, builtTerrainWorkIds: [bridgeId],
      discoveryMask: encodeDiscoveredTileIds(site.footprintTileIds) }
    const [x, , z] = view.player.position
    const gx = Math.ceil(x / 4 - 0.5), gz = Math.ceil(z / 4 - 0.5)
    const isolated = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.gridX - 3 === gx && tile.gridZ - 3 === gz })) } }
    const noRoute = publicV27StarterGuide(isolated, works, saved)
    expect(noRoute.summary).toBe('Slate approach: reveal or retrace safe ground')
    expect(noRoute.action).not.toMatch(/: [NSEW]+, about/)
    expect(noRoute.action).toContain('No known dry continuation')
    const pits = { ...saved, openPitColumns: [[-1, 0], [1, 0], [0, -1], [0, 1]]
      .map(([dx, dz]) => ({ gx: gx + dx, gz: gz + dz, openDepth: 2 })) }
    const blocked = publicV27StarterGuide(view, works, pits)
    expect(blocked.summary).toBe('Slate approach: reveal or retrace safe ground')
    expect(blocked.action).not.toMatch(/: [NSEW]+, about/)
    const start = worldTileAtGrid(seed, gx, gz), west = worldTileAtGrid(seed, gx - 1, gz)
    expect(west.terrain).not.toBe('wetland')
    expect(mireglassMoveBarrier(seed, start.center, west.center)).toBeNull()
    const twoCells = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.id === start.id || tile.id === west.id })) } }
    expect(publicV27StarterGuide(twoCells, works, saved).action)
      .toMatch(/: [NSEW]+, about \d+ m to the next known safe turn/)
    const steep = { ...twoCells, map: { ...twoCells.map,
      tiles: twoCells.map.tiles.map((tile) => tile.id === west.id
        ? { ...tile, elevationMeters: start.center.y + 3 } : tile) } }
    expect(publicV27StarterGuide(steep, works, saved).action)
      .not.toMatch(/: [NSEW]+, about/)
  })

  it('keeps saved Fen discovery after its footprint leaves the local map window', () => {
    const seed = 'greenway-alpha', bridgeId = 'works1:bridge:-86:91:z'
    const site = resolveTerrainWorkSite(seed, bridgeId)!
    if (site.kind !== 'bridge') throw new Error('Expected a Fen bridge')
    const later = worldTileAtGrid(seed, -84, 113).center
    const { view, works, context } = postDigFenFixture(seed, later, 0)
    expect(view.map.tiles).toHaveLength(33 * 33)
    expect(site.footprintTileIds.some((id) => view.map.tiles.some((tile) => tile.id === id)))
      .toBe(false)
    const stage = publicV27StarterGuide(view, works, { ...context,
      builtTerrainWorkIds: [bridgeId],
      discoveryMask: encodeDiscoveredTileIds(site.footprintTileIds) })
    expect(stage.summary).toContain('Slate approach')
    expect(stage.action).not.toContain(bridgeId)
  })

  it.each([[-412.98, 430.49], [-413.04, 431.64]])('hands a saved Slate ladder off-lane pose at x=%s,z=%s back to its east entry', (x, z) => {
    const seed = 'greenway-alpha'
    const site = resolvePublicV23Site(seed, 'works5:ladder:mireglass-slate:W:-103:4311')!
    const position = { x, y: 0.84, z }
    expect(terrainWorkSupportAt({ ...site, obstacle: 'slate_cliff' }, position).floorY)
      .toBeNull()
    const base = createPublicV23Root(seed).head.state
    const support = resolvePublicV23Surface(base, position, [site.id])!
    expect(support.floorY).toBeCloseTo(position.y)
    const runtime = createPublicV23StreamTerrain({ ...base, movementOwner: 'streamed',
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.discoveryMask), support.tileId])].sort()),
      player: { ...base.player, position: { ...position, y: support.floorY },
        verticalVelocity: 0 } }, [site.id])
    expect(runtime.advance([{ type: 'move', delta: { x: 0,
      z: z > site.from.z ? -0.2 : 0.2 } }],
      { atomicOnRejection: true }).rejections).toMatchObject([{ code: 'slate_cliff' }])
    for (let step = 0; step < 26; step += 1)
      expect(runtime.advance([{ type: 'move', delta: { x: 0.2, z: 0 } }],
        { atomicOnRejection: true }).rejections).toEqual([])
    expect(runtime.state.player.position.x).toBeGreaterThan(site.approach.x)
    const { view, works, context } = postDigFenFixture(seed, position, 0)
    const projected = { ...view, regionalLadders: { builtSites: [site], preview: null } }
    const saved = { ...context, builtTerrainWorkIds: ['works1:bridge:-86:91:z'],
      regionalSlateLadderBuilt: true,
      discoveryMask: encodeDiscoveredTileIds([...new Set(site.footprintTileIds)].sort()) }
    const stage = publicV27StarterGuide(projected, works, saved)
    expect(stage.summary).toContain('Slate ladder')
    expect(stage.action).toMatch(/east.*before.*align.*west/i)
    expect(stage.action).not.toMatch(/gather 4 logs|build a ladder/i)
    const blocked = publicV27StarterGuide(projected, works, { ...saved,
      openPitColumns: [{ gx: Math.ceil(site.approach.x / 4 - 0.5),
        gz: Math.ceil(site.approach.z / 4 - 0.5), openDepth: 2 }] })
    expect(blocked.summary).toBe('Slate ladder: retrace a known dry approach')
    expect(blocked.action).not.toContain('Retreat east')
    const arrived = { ...projected, player: { ...projected.player,
      position: [runtime.state.player.position.x, runtime.state.player.position.y,
        runtime.state.player.position.z] as const } }
    const aligned = publicV27StarterGuide(arrived, works, saved)
    expect(aligned.summary).toBe('Slate ladder: align on the dry east approach')
    expect(aligned.action).toMatch(/align.*center.*then.*west/i)
    const sourcePit = publicV27StarterGuide(arrived, works, { ...saved,
      openPitColumns: [{ gx: Math.ceil(site.from.x / 4 - 0.5),
        gz: Math.ceil(site.from.z / 4 - 0.5), openDepth: 2 }] })
    expect(sourcePit.summary).toBe('Slate ladder: retrace a known dry approach')
    expect(sourcePit.action).not.toMatch(/: [NSEW]+, about/)
    const sourceTile = worldTileAtGrid(seed, Math.ceil(site.from.x / 4 - 0.5),
      Math.ceil(site.from.z / 4 - 0.5))
    const hiddenSource = { ...arrived, map: { ...arrived.map,
      tiles: arrived.map.tiles.map((tile) => tile.id === sourceTile.id
        ? { ...tile, discovered: false } : tile) } }
    expect(publicV27StarterGuide(hiddenSource, works, saved).summary)
      .toBe('Slate ladder: retrace a known dry approach')
  })

  it('continues west only on the saved Slate centerline, then releases the cue on the upper floor or cache', () => {
    const seed = 'greenway-alpha'
    const site = resolvePublicV23Site(seed, 'works5:ladder:mireglass-slate:W:-103:4311')!
    const { view, works, context } = postDigFenFixture(seed, site.from, 0)
    const saved = { ...context, regionalSlateLadderBuilt: true,
      builtTerrainWorkIds: ['works1:bridge:-86:91:z'],
      discoveryMask: encodeDiscoveredTileIds([...new Set(site.footprintTileIds)].sort()) }
    const projected = { ...view, regionalLadders: { builtSites: [site], preview: null } }
    const mid = { x: (site.from.x + site.to.x) / 2, z: site.from.z }
    const floor = terrainWorkSupportAt({ ...site, obstacle: 'slate_cliff' }, mid).floorY!
    for (const position of [site.from, { ...mid, y: floor }]) {
      const stage = publicV27StarterGuide({ ...projected, player: { ...view.player,
        position: [position.x, position.y, position.z] as const } }, works, saved)
      expect(stage.summary).toBe('Slate ladder: climb west on the saved rungs')
      expect(stage.action).toContain('Continue west straight')
    }
    const upper = { ...projected, player: { ...view.player,
      position: [site.to.x, site.to.y, site.to.z] as const } }
    expect(publicV27StarterGuide(upper, works, saved).summary).toBe('Mireglass Reach')
    const upperRim = { x: -415, y: site.to.y, z: 431.64 }
    expect(mireglassPlateauAt(seed, -416, 432)).not.toBeNull()
    expect(terrainWorkSupportAt({ ...site, obstacle: 'slate_cliff' }, upperRim).floorY)
      .toBeNull()
    expect(resolvePublicV23Surface(createPublicV23Root(seed).head.state,
      upperRim, [site.id])?.floorY).toBeCloseTo(upperRim.y)
    const rim = { ...projected, player: { ...view.player,
      position: [upperRim.x, upperRim.y, upperRim.z] as const } }
    expect(publicV27StarterGuide(rim, works, saved).summary).toBe('Mireglass Reach')
    expect(publicV27StarterGuide(rim, works, { ...saved,
      mireglassCacheRevealed: true }).summary).toBe('Mireglass Reach')
    expect(publicV27StarterGuide(projected, works, { ...saved,
      mireglassCacheRevealed: true }).summary).toBe('Mireglass Reach')
  })

  it('uses only a connected revealed dry lower approach for a saved Slate ladder', () => {
    const seed = 'greenway-alpha'
    const site = resolvePublicV23Site(seed, 'works5:ladder:mireglass-slate:W:-103:4311')!
    const position = { x: site.approach.x + 8, y: site.approach.y,
      z: site.approach.z }
    const { view, works, context } = postDigFenFixture(seed, position, 0)
    const saved = { ...context, regionalSlateLadderBuilt: true,
      builtTerrainWorkIds: ['works1:bridge:-86:91:z'],
      discoveryMask: encodeDiscoveredTileIds([...new Set(site.footprintTileIds)].sort()) }
    const projected = { ...view, regionalLadders: { builtSites: [site], preview: null } }
    const route = publicV27StarterGuide(projected, works, saved)
    expect(route.summary).toBe('Slate ladder: follow a known dry approach')
    expect(route.action).toMatch(/: [NSEW]+, about \d+ m to the next known safe turn/)
    const isolated = { ...projected, map: { ...projected.map,
      tiles: projected.map.tiles.map((tile) => ({ ...tile,
        discovered: tile.id === worldTileAtGrid(seed,
          Math.ceil(position.x / 4 - 0.5), Math.ceil(position.z / 4 - 0.5)).id
          || site.footprintTileIds.includes(tile.id) })) } }
    const noRoute = publicV27StarterGuide(isolated, works, saved)
    expect(noRoute.summary).toBe('Slate ladder: retrace a known dry approach')
    expect(noRoute.action).not.toMatch(/: [NSEW]+, about/)
    expect(publicV27StarterGuide(projected, works, { ...saved,
      openPitColumns: [{ gx: Math.ceil(site.approach.x / 4 - 0.5),
        gz: Math.ceil(site.approach.z / 4 - 0.5), openDepth: 2 }] }).action)
      .not.toMatch(/: [NSEW]+, about/)
    const approachTile = worldTileAtGrid(seed,
      Math.ceil(site.approach.x / 4 - 0.5), Math.ceil(site.approach.z / 4 - 0.5))
    for (const tileChange of [{ terrain: 'wetland' },
      { elevationMeters: approachTile.center.y + 3 }]) {
      const unsafe = { ...projected, map: { ...projected.map,
        tiles: projected.map.tiles.map((tile) => tile.id === approachTile.id
          ? { ...tile, ...tileChange } : tile) } }
      const stage = publicV27StarterGuide(unsafe, works, saved)
      expect(stage.summary).toBe('Slate ladder: retrace a known dry approach')
      expect(stage.action).not.toMatch(/: [NSEW]+, about/)
    }
    expect(publicV27StarterGuide(projected, works, { ...saved,
      discoveryMask: encodeDiscoveredTileIds(site.footprintTileIds.slice(1)
        .filter((id, index, ids) => ids.indexOf(id) === index).sort()) }).summary)
      .toBe('Mireglass Reach')
  })

  it('chooses the nearest validated saved Slate site without fabricating one for another seed', () => {
    const seed = 'greenway-alpha'
    const north = resolvePublicV23Site(seed, 'works5:ladder:mireglass-slate:W:-103:4306')!
    const south = resolvePublicV23Site(seed, 'works5:ladder:mireglass-slate:W:-103:4334')!
    const { view, works, context } = postDigFenFixture(seed, south.from, 0)
    const mask = encodeDiscoveredTileIds([...new Set([
      ...north.footprintTileIds, ...south.footprintTileIds])].sort())
    const projected = { ...view, regionalLadders: { builtSites: [north, south], preview: null } }
    const saved = { ...context, regionalSlateLadderBuilt: true,
      builtTerrainWorkIds: ['works1:bridge:-86:91:z'], discoveryMask: mask }
    expect(publicV27StarterGuide(projected, works, saved).summary)
      .toBe('Slate ladder: climb west on the saved rungs')
    expect(publicV27StarterGuide({ ...projected, seed: 'wizard-realms' }, works, saved).summary)
      .toBe('Mireglass Reach')
    expect(publicV27StarterGuide(projected, works, { ...saved,
      regionalSlateLadderBuilt: false }).summary).toBe('Mireglass Reach')
  })

  it('shows the saved climb in the near-West rendered guide instead of the stale build note', () => {
    const seed = 'greenway-alpha', start = v31Start(seed)
    const site = resolvePublicV23Site(seed, 'works5:ladder:mireglass-slate:W:-103:4311')!
    const fen = resolveTerrainWorkSite(seed, 'works1:bridge:-86:91:z')!
    const river = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const position = { x: -413.04, y: site.from.y, z: 431.64 }
    const state = { ...start.head.state, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(start.head.state.discoveryMask),
        ...site.footprintTileIds, ...fen.footprintTileIds,
        worldTileAtGrid(seed, Math.ceil(position.x / 4 - 0.5),
          Math.ceil(position.z / 4 - 0.5)).id])].sort()),
      player: { ...start.head.state.player, position,
        inventory: [...start.head.state.player.inventory,
          { itemId: 'field_spade' as const, quantity: 1 }],
        skillXp: { ...start.head.state.player.skillXp, excavation: 30 } },
      mireglass: { ...start.head.state.mireglass, fringeMarkerStudied: true },
      terrainWorks: { ...start.head.state.terrainWorks, builtWorkIds: [fen.id] } }
    const shaped: PublicV31Start = { ...start, head: { ...start.head, state,
      regionalWorks: { builtLadderIds: [site.id] },
      riverBridgeIds: [river.id], claimedBridgeheadId: river.id } }
    const factory = new IDBFactory()
    const render = (saved: PublicV31Start) => renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v31', start: saved, locks, store: createAtomicV31Store(factory),
      sourceStore: createAtomicV30Store(factory), v29Store: createAtomicV29Store(factory),
      v28Store: createAtomicV28Store(factory), v27Store: createAtomicV27Store(factory),
      v26Store: createAtomicV26Store(factory), v25Store: createAtomicV25Store(factory),
      v24Store: createAtomicV24Store(factory), v23Store: createAtomicV23Store(factory),
      v17Store: createAtomicV17Store(factory) }))
    const html = render(shaped)
    expect(html).toContain('<summary>Slate ladder: retreat east to align</summary>')
    expect(html).not.toContain('Gather 4 logs; use B Works')
    expect(html).not.toContain('class="v23-guide v23-guide-west"')
    const approach = render({ ...shaped, head: { ...shaped.head, state: { ...state,
      player: { ...state.player, position: { x: site.approach.x + 0.16,
        y: site.approach.y, z: 431.64 } } } } })
    expect(approach).toContain('<summary>Slate ladder: align on the dry east approach</summary>')
    const upper = render({ ...shaped, head: { ...shaped.head, state: { ...state,
      player: { ...state.player, position: { x: -415, y: site.to.y, z: 431.64 } } } } })
    expect(upper).not.toContain('Slate ladder:')
    expect(upper).not.toContain('Gather 4 logs; use B Works')
    expect(upper).not.toContain('class="v23-guide v23-guide-west"')
    const authored = mireglassRouteSites(seed).find((route) => route.kind === 'ladder')!
    const authoredFen = mireglassRouteSites(seed).find((route) => route.kind === 'bridge')!
    const authoredState = { ...state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(state.discoveryMask),
        worldTileAtGrid(seed, Math.ceil(authored.from.x / 4 - 0.5),
          Math.ceil(authored.from.z / 4 - 0.5)).id,
        worldTileAtGrid(seed, Math.ceil(authored.to.x / 4 - 0.5),
          Math.ceil(authored.to.z / 4 - 0.5)).id,
        worldTileAtGrid(seed, -106, 108).id])].sort()),
      player: { ...state.player, position: { x: -425.79,
        y: worldTileAtGrid(seed, -106, 108).center.y, z: 430.08 },
        learnedSpellIds: [...state.player.learnedSpellIds, 'wayfinder_glow' as const] },
      mireglass: { ...state.mireglass, builtRoutes: { bridge: authoredFen.id,
        ladder: authored.id } } }
    const shelf = render({ ...shaped, head: { ...shaped.head, state: authoredState,
      regionalWorks: { builtLadderIds: [] } } })
    expect(shelf).toContain('<summary>Upper Slate shelf: cast Glow; north green is below</summary>')
    expect(shelf).not.toContain('class="v23-guide v23-guide-west"')
    const returnedState = { ...state, player: { ...state.player,
      position: { x: -414.07, y: site.to.y, z: 431.73 },
      inventory: [...state.player.inventory, { itemId: 'mireglass_reach/item/seal' as const,
        quantity: 1 }] }, mireglass: { ...state.mireglass,
        cacheRevealed: true, cacheExcavated: true } }
    const returned = render({ ...shaped, head: { ...shaped.head, state: returnedState } })
    expect(returned).toContain('<summary>Slate return: align at the upper dry foot</summary>')
  }, 30_000)

  it.each(['greenway-alpha', 'wizard-realms'])('guides a learned-Glow %s player across the elevated upper shelf', (seed) => {
    const position = { x: -425.79, y: 2.4, z: 430.08 }
    const ladderSite = mireglassRouteSites(seed).find((site) => site.kind === 'ladder')!
    const { view, works, context } = postDigFenFixture(seed, position, 0)
    const from = worldTileAtGrid(seed, Math.ceil(ladderSite.from.x / 4 - 0.5),
      Math.ceil(ladderSite.from.z / 4 - 0.5))
    const to = worldTileAtGrid(seed, Math.ceil(ladderSite.to.x / 4 - 0.5),
      Math.ceil(ladderSite.to.z / 4 - 0.5))
    const saved = { ...context, authoredFenBridgeId: mireglassRouteSites(seed)
      .find((site) => site.kind === 'bridge')!.id,
      authoredSlateLadderId: ladderSite.id, grounded: true,
      discoveryMask: encodeDiscoveredTileIds([from.id, to.id].sort()) }
    const learned = { ...view, learnedSpellIds: ['wayfinder_glow' as const],
      checkedActionChoices: [{ id: 'mireglass:cast:wayfinder_glow', actionable: false,
        reason: 'No new nearby magic is in reach.' }] }
    const stage = publicV27StarterGuide(learned, works, saved)
    expect(stage.summary).toBe('Upper Slate shelf: search the western high ground')
    expect(stage.action).toContain('western upper shelf')
    expect(stage.action).toContain('north of the Slate cliff is lower')
    expect(stage.action).not.toMatch(/: [NSEW]+, about \d+ m/)
    expect(stage.action).not.toMatch(/tile-|mireglass_reach\/dig\/|\b[xyz] -?\d/)
    expect(publicV27StarterGuide({ ...learned, player: { ...learned.player,
      position: [position.x + 0.02, position.y, position.z] as const } }, works, saved).action)
      .toBe(stage.action)
    const interior = worldTileAtGrid(seed, -106, 112)
    const farther = publicV27StarterGuide({ ...learned, player: { ...learned.player,
      position: [position.x, interior.center.y, 448.08] as const } }, works, saved)
    expect(farther).toEqual(stage)
    const cast = publicV27StarterGuide({ ...learned, checkedActionChoices: [{
      id: 'mireglass:cast:wayfinder_glow', actionable: true, reason: null }] }, works, saved)
    expect(cast.summary).toMatch(/Upper Slate shelf:.*cast Glow/i)
    expect(cast.action).toContain('Cast Wayfinder Glow now')
    expect(publicV27StarterGuide(learned, works, { ...saved,
      mireglassCacheRevealed: true }).summary).not.toContain('Upper Slate shelf:')
  })

  it.each(['greenway-alpha', 'wizard-realms'])('gives a stable western shelf clue from the %s east-side and threshold poses', (seed) => {
    const ladder = mireglassRouteSites(seed).find((site) => site.kind === 'ladder')!
    const from = worldTileAtGrid(seed, Math.ceil(ladder.from.x / 4 - 0.5),
      Math.ceil(ladder.from.z / 4 - 0.5))
    const to = worldTileAtGrid(seed, Math.ceil(ladder.to.x / 4 - 0.5),
      Math.ceil(ladder.to.z / 4 - 0.5))
    const mask = encodeDiscoveredTileIds([from.id, to.id].sort())
    const poses = [[-380.19, 452.93], [-378.44, 473.02], [-377.94, 478.76],
      [-377.94, 477.98], [-377.94, 478.02]] as const
    const actions = poses.map(([x, z], index) => {
      const tile = worldTileAtGrid(seed, Math.ceil(x / 4 - 0.5),
        Math.ceil(z / 4 - 0.5))
      expect(mireglassPlateauAt(seed, tile.center.x, tile.center.z)).not.toBeNull()
      const { view, works, context } = postDigFenFixture(seed,
        { x, y: tile.center.y, z }, 0)
      const discovered = { ...view, learnedSpellIds: ['wayfinder_glow' as const],
        checkedActionChoices: [{ id: 'mireglass:cast:wayfinder_glow', actionable: false,
          reason: 'No new nearby magic is in reach.' }],
        map: { ...view.map, tiles: view.map.tiles.map((entry) => ({ ...entry,
          discovered: index % 2 === 0 || entry.id !== to.id })) } }
      const saved = { ...context, grounded: true, authoredSlateLadderId: ladder.id,
        authoredFenBridgeId: mireglassRouteSites(seed)
          .find((site) => site.kind === 'bridge')!.id, discoveryMask: mask }
      const stage = publicV27StarterGuide(discovered, works, saved)
      expect(stage.summary).toBe('Upper Slate shelf: search the western high ground')
      expect(stage.action).toContain('Old survey records place the buried seal somewhere on the western upper shelf')
      expect(stage.action).toContain('short east-west passes: check the current Glow action about every two map cells along a pass')
      expect(stage.action).toContain('shift about two cells between passes where clear, then sweep back')
      expect(stage.action).toContain('Glow only reveals the hidden seal when cast nearby')
      expect(stage.action).not.toMatch(/: [NSEW]+, about \d+ m|tile-|\b[xyz] -?\d|guaranteed path|already searched/)
      expect(publicV27StarterGuide(structuredClone(discovered), works,
        structuredClone(saved))).toEqual(stage)
      return stage.action
    })
    expect(new Set(actions).size).toBe(1)
  })

  it.each(['greenway-alpha', 'wizard-realms'])('keeps the %s shelf copy stable with fog and blocked map cells', (seed) => {
    const position = { x: -432.28, y: worldTileAtGrid(seed, -108, 120).center.y, z: 479.20 }
    const ladderSite = mireglassRouteSites(seed).find((site) => site.kind === 'ladder')!
    const { view, works, context } = postDigFenFixture(seed, position, 0)
    const from = worldTileAtGrid(seed, Math.ceil(ladderSite.from.x / 4 - 0.5),
      Math.ceil(ladderSite.from.z / 4 - 0.5))
    const to = worldTileAtGrid(seed, Math.ceil(ladderSite.to.x / 4 - 0.5),
      Math.ceil(ladderSite.to.z / 4 - 0.5))
    const unknown = worldTileAtGrid(seed, -108, 124)
    const revealed = { ...view, learnedSpellIds: ['wayfinder_glow' as const],
      map: { ...view.map, tiles: view.map.tiles.map((tile) => ({ ...tile,
        discovered: tile.id !== unknown.id })) },
      checkedActionChoices: [{ id: 'mireglass:cast:wayfinder_glow', actionable: false,
        reason: 'No new nearby magic is in reach.' }] }
    const saved = { ...context, authoredFenBridgeId: mireglassRouteSites(seed)
      .find((site) => site.kind === 'bridge')!.id,
      authoredSlateLadderId: ladderSite.id, grounded: true,
      discoveryMask: encodeDiscoveredTileIds([from.id, to.id].sort()) }
    const stage = publicV27StarterGuide(revealed, works, saved)
    expect(stage.summary).toBe('Upper Slate shelf: search the western high ground')
    expect(stage.action).toContain('map marks discovered elevation, not safe passage')
    expect(stage.action).toContain('Glow only reveals the hidden seal when cast nearby')
    expect(stage.action).not.toMatch(/: [NSEW]+, about \d+ m|tile-|\b[xyz] -?\d/)
    expect(publicV27StarterGuide({ ...revealed, player: { ...revealed.player,
      position: [position.x + 0.02, position.y, position.z] as const } }, works, saved).action)
      .toBe(stage.action)
    const noUnknown = { ...revealed, map: { ...revealed.map,
      tiles: revealed.map.tiles.map((tile) => ({ ...tile, discovered: true })) } }
    expect(publicV27StarterGuide(noUnknown, works, saved)).toEqual(stage)
    const neighbors = [[-108, 123], [-107, 124], [-109, 124], [-108, 125]] as const
    const neighborIds = new Set(neighbors.map(([gx, gz]) => worldTileAtGrid(seed, gx, gz).id))
    for (const change of [{ terrain: 'wetland' as const },
      { elevationMeters: position.y + 3 }, { elevationMeters: position.y - 0.5 }]) {
      const blocked = { ...revealed, map: { ...revealed.map,
        tiles: revealed.map.tiles.map((tile) => neighborIds.has(tile.id)
          ? { ...tile, ...change } : tile) } }
      expect(publicV27StarterGuide(blocked, works, saved)).toEqual(stage)
    }
    expect(publicV27StarterGuide(revealed, works, { ...saved,
      openPitColumns: neighbors.map(([gx, gz]) => ({ gx, gz, openDepth: 2 })) }))
      .toEqual(stage)
    const cast = publicV27StarterGuide({ ...revealed, checkedActionChoices: [{
      id: 'mireglass:cast:wayfinder_glow', actionable: true, reason: null }] }, works, saved)
    expect(cast.summary).toMatch(/cast Glow/i)
    expect(cast.action).toContain('Cast Wayfinder Glow now')
    expect(publicV27StarterGuide(revealed, works, { ...saved,
      mireglassCacheRevealed: true }).summary).not.toContain('Upper Slate shelf:')
  })

  it('does not route a grounded upper-rim player into the green lower ground north of Slate', () => {
    const seed = 'greenway-alpha', position = { x: -425.79, y: 2.4, z: 430.08 }
    const upper = worldTileAtGrid(seed, -106, 108)
    const lower = worldTileAtGrid(seed, -106, 107)
    expect(mireglassPlateauAt(seed, upper.center.x, upper.center.z)).not.toBeNull()
    expect(mireglassPlateauAt(seed, lower.center.x, lower.center.z)).toBeNull()
    expect(mireglassMoveBarrier(seed, upper.center, lower.center)).toBe('slate_cliff')
    const ladderSite = mireglassRouteSites(seed).find((site) => site.kind === 'ladder')!
    const { view, works, context } = postDigFenFixture(seed, position, 0)
    const from = worldTileAtGrid(seed, Math.ceil(ladderSite.from.x / 4 - 0.5),
      Math.ceil(ladderSite.from.z / 4 - 0.5))
    const to = worldTileAtGrid(seed, Math.ceil(ladderSite.to.x / 4 - 0.5),
      Math.ceil(ladderSite.to.z / 4 - 0.5))
    const isolated = { ...view, learnedSpellIds: ['wayfinder_glow' as const],
      map: { ...view.map, tiles: view.map.tiles.map((tile) => ({ ...tile,
        discovered: tile.id === upper.id || tile.id === lower.id })) } }
    const stage = publicV27StarterGuide(isolated, works, { ...context,
      authoredFenBridgeId: mireglassRouteSites(seed)
        .find((site) => site.kind === 'bridge')!.id,
      authoredSlateLadderId: ladderSite.id, grounded: true,
      discoveryMask: encodeDiscoveredTileIds([from.id, to.id].sort()) })
    expect(stage.summary).toBe('Upper Slate shelf: search the western high ground')
    expect(stage.action).toContain('north of the Slate cliff is lower')
    expect(stage.action).toContain('unknown or pitted ground is uncertified')
    expect(stage.action).not.toMatch(/: [NSEW]+, about/)
    const south = worldTileAtGrid(seed, -106, 109)
    expect(mireglassPlateauAt(seed, south.center.x, south.center.z)).not.toBeNull()
    const twoUpper = { ...isolated, map: { ...isolated.map,
      tiles: isolated.map.tiles.map((tile) => ({ ...tile,
        discovered: tile.id === upper.id || tile.id === south.id })) } }
    const saved = { ...context,
      authoredFenBridgeId: mireglassRouteSites(seed)
        .find((site) => site.kind === 'bridge')!.id,
      authoredSlateLadderId: ladderSite.id, grounded: true,
      discoveryMask: encodeDiscoveredTileIds([from.id, to.id].sort()) }
    expect(publicV27StarterGuide(twoUpper, works, saved)).toEqual(stage)
    for (const tileChange of [{ discovered: false }, { terrain: 'wetland' },
      { elevationMeters: upper.center.y + 3 },
      { elevationMeters: upper.center.y - 0.5 }]) {
      const blocked = { ...twoUpper, map: { ...twoUpper.map,
        tiles: twoUpper.map.tiles.map((tile) => tile.id === south.id
          ? { ...tile, ...tileChange } : tile) } }
      expect(publicV27StarterGuide(blocked, works, saved).action)
        .not.toMatch(/: [NSEW]+, about/)
    }
    expect(publicV27StarterGuide(twoUpper, works, { ...saved,
      openPitColumns: [{ gx: -106, gz: 109, openDepth: 2 }] }).action)
      .not.toMatch(/: [NSEW]+, about/)
  })

  it.each(['greenway-alpha', 'wizard-realms'])('accepts discovered authored and generic %s Slate climbs, not a hidden or lower-side route', (seed) => {
    const position = { x: -425.79, y: 2.4, z: 430.08 }
    const authored = mireglassRouteSites(seed).find((site) => site.kind === 'ladder')!
    const generic = enumerateTerrainWorkSites(seed,
      { minGX: -108, maxGX: -98, minGZ: 104, maxGZ: 112 })
      .find((site) => site.kind === 'ladder' && site.obstacle === 'slate_cliff')!
    expect(generic).toBeDefined()
    const { view, works, context } = postDigFenFixture(seed, position, 0)
    const learned = { ...view, learnedSpellIds: ['wayfinder_glow' as const] }
    const base = { ...context, grounded: true, authoredFenBridgeId: mireglassRouteSites(seed)
      .find((site) => site.kind === 'bridge')!.id }
    const from = worldTileAtGrid(seed, Math.ceil(authored.from.x / 4 - 0.5),
      Math.ceil(authored.from.z / 4 - 0.5))
    const to = worldTileAtGrid(seed, Math.ceil(authored.to.x / 4 - 0.5),
      Math.ceil(authored.to.z / 4 - 0.5))
    const authoredMask = encodeDiscoveredTileIds([from.id, to.id].sort())
    const genericMask = encodeDiscoveredTileIds([...new Set(generic.footprintTileIds)].sort())
    for (const saved of [{ ...base, authoredSlateLadderId: authored.id,
      discoveryMask: authoredMask }, { ...base, builtTerrainWorkIds: [generic.id],
      discoveryMask: genericMask }]) {
      const stage = publicV27StarterGuide(learned, works, saved)
      expect(stage.summary).toBe('Upper Slate shelf: search the western high ground')
      expect(stage.action).not.toMatch(/: [NSEW]+, about \d+ m/)
      expect(publicV27StarterGuide({ ...learned, player: { ...learned.player,
        position: [authored.from.x, authored.from.y, authored.from.z] as const } },
      works, saved).summary).not.toContain('Upper Slate shelf:')
      expect(publicV27StarterGuide(learned, works, { ...saved,
        grounded: false }).summary).not.toContain('Upper Slate shelf:')
      expect(publicV27StarterGuide({ ...learned, learnedSpellIds: [] }, works, saved).summary)
        .not.toContain('Upper Slate shelf:')
    }
    expect(publicV27StarterGuide(learned, works, { ...base,
      authoredSlateLadderId: authored.id,
      discoveryMask: encodeDiscoveredTileIds([from.id]) }).summary)
      .not.toContain('Upper Slate shelf:')
    expect(publicV27StarterGuide(learned, works, { ...base,
      builtTerrainWorkIds: [generic.id],
      discoveryMask: encodeDiscoveredTileIds(generic.footprintTileIds.slice(1)
        .filter((id, index, ids) => ids.indexOf(id) === index).sort()) }).summary)
      .not.toContain('Upper Slate shelf:')
  })

  it('accepts a projected discovered regional Slate climb without using the hidden cache', () => {
    const seed = 'greenway-alpha', position = { x: -425.79, y: 2.4, z: 430.08 }
    const site = resolvePublicV23Site(seed, 'works5:ladder:mireglass-slate:W:-103:4311')!
    const { view, works, context } = postDigFenFixture(seed, position, 0)
    const projected = { ...view, learnedSpellIds: ['wayfinder_glow' as const],
      regionalLadders: { builtSites: [site], preview: null } }
    const saved = { ...context, grounded: true, regionalSlateLadderBuilt: true,
      authoredFenBridgeId: mireglassRouteSites(seed).find((route) => route.kind === 'bridge')!.id,
      discoveryMask: encodeDiscoveredTileIds([...new Set(site.footprintTileIds)].sort()) }
    const stage = publicV27StarterGuide(projected, works, saved)
    expect(stage.summary).toBe('Upper Slate shelf: search the western high ground')
    expect(stage.action).not.toMatch(/: [NSEW]+, about \d+ m/)
    expect(stage.action).not.toMatch(/tile-|mireglass_reach\/dig\/|\b[xyz] -?\d/)
    expect(publicV27StarterGuide({ ...projected,
      regionalLadders: { builtSites: [], preview: null } }, works, saved).summary)
      .not.toContain('Upper Slate shelf:')
  })

  it('guides a seal owner from the published upper-side off-lane Slate return pose', () => {
    const seed = 'greenway-alpha'
    const site = resolvePublicV23Site(seed, 'works5:ladder:mireglass-slate:W:-103:4311')!
    const position = { x: -414.07, y: site.to.y, z: 431.73 }
    const { view, works, context } = postDigFenFixture(seed, position, 0)
    const seal = { id: 'inventory-mireglass_reach/item/seal',
      itemId: 'mireglass_reach/item/seal' as const, name: 'Mireglass seal', quantity: 1 }
    const owned = { ...view, backpack: { ...view.backpack,
      stacks: [...view.backpack.stacks, seal] },
      regionalLadders: { builtSites: [site], preview: null } }
    const saved = { ...context, grounded: true, mireglassCacheRevealed: true,
      mireglassCacheExcavated: true, regionalSlateLadderBuilt: true,
      discoveryMask: encodeDiscoveredTileIds([...site.footprintTileIds].sort()) }
    const offLane = publicV27StarterGuide(owned, works, saved)
    expect(offLane.summary).toBe('Slate return: align at the upper dry foot')
    expect(offLane.action).toMatch(/retreat west.*upper rung end.*align sideways.*upper dry-foot mark.*walk east straight/i)
    expect(offLane.action).not.toMatch(/\b[xyz] -?\d|tile-|teleport|unknown.*safe/i)
    const firstRefusal = publicV27StarterGuide({ ...owned, player: { ...owned.player,
      position: [-415.17, site.to.y, 431.94] as const } }, works, saved)
    expect(firstRefusal).toEqual(offLane)
    const centered = publicV27StarterGuide({ ...owned, player: { ...owned.player,
      position: [-417, site.to.y, site.to.z] as const } }, works, saved)
    expect(centered.summary).toBe('Slate return: descend the saved rungs')
    expect(centered.action).toMatch(/walk east straight.*rung lane/i)
    const far = publicV27StarterGuide({ ...owned, player: { ...owned.player,
      position: [-380, site.to.y, 452] as const } }, works, saved)
    expect(far.summary).toBe('Mireglass Reach')
    for (const noCue of [
      publicV27StarterGuide(owned, works, { ...saved, mireglassCacheExcavated: false }),
      publicV27StarterGuide({ ...owned, backpack: { ...owned.backpack,
        stacks: owned.backpack.stacks.filter((stack) => stack.itemId !== seal.itemId) } }, works, saved),
      publicV27StarterGuide(owned, works, { ...saved,
        discoveryMask: encodeDiscoveredTileIds(site.footprintTileIds.slice(1)) }),
      publicV27StarterGuide(owned, works, { ...saved, regionalSlateLadderBuilt: false }),
      publicV27StarterGuide({ ...owned, regionalLadders: { builtSites: [], preview: null } }, works, saved),
      publicV27StarterGuide({ ...owned, player: { ...owned.player,
        position: [site.from.x, site.from.y, site.from.z] as const } }, works, saved),
    ]) expect(noCue.summary).not.toContain('Slate return:')
  })

  it('asks for revelation at a dry Slate-side frontier without naming an unknown step', () => {
    const seed = 'greenway-alpha', bridgeId = 'works1:bridge:-86:91:z'
    const site = resolveTerrainWorkSite(seed, bridgeId)!
    if (site.kind !== 'bridge') throw new Error('Expected a Fen bridge')
    const position = worldTileAtGrid(seed, -93, 104).center
    const { view, works, context } = postDigFenFixture(seed, position, 0)
    const onlyHere = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.id === worldTileAtGrid(seed, -93, 104).id })) } }
    const stage = publicV27StarterGuide(onlyHere, works, { ...context,
      builtTerrainWorkIds: [bridgeId],
      discoveryMask: encodeDiscoveredTileIds(site.footprintTileIds) })
    expect(stage.summary).toBe('Slate approach: reveal the next safe ground')
    expect(stage.action).toContain('Expose neighboring ground')
    expect(stage.action).not.toMatch(/: [NSEW]+, about/)
  })

  it('does not point across the Slate cliff and hands off at a discovered west-face site', () => {
    const seed = 'greenway-alpha', bridgeId = 'works1:bridge:-86:91:z'
    const bridgeSite = resolveTerrainWorkSite(seed, bridgeId)!
    if (bridgeSite.kind !== 'bridge') throw new Error('Expected a Fen bridge')
    const pairs = [] as Array<[ReturnType<typeof worldTileAtGrid>, ReturnType<typeof worldTileAtGrid>]>
    for (let gx = -108; gx <= -98; gx++) for (let gz = 105; gz <= 112; gz++) {
      const from = worldTileAtGrid(seed, gx, gz)
      const to = worldTileAtGrid(seed, gx, gz - 1)
      if (from.terrain !== 'wetland' && to.terrain !== 'wetland'
        && mireglassMoveBarrier(seed, from.center, to.center) === 'slate_cliff')
        pairs.push([from, to])
    }
    const pair = pairs[0]
    if (!pair) throw new Error('Missing Slate cliff barrier pair')
    const [from, to] = pair
    const { view, works, context } = postDigFenFixture(seed, from.center, 0)
    const known = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.id === from.id || tile.id === to.id })) } }
    const saved = { ...context, builtTerrainWorkIds: [bridgeId],
      discoveryMask: encodeDiscoveredTileIds(bridgeSite.footprintTileIds) }
    expect(publicV27StarterGuide(known, works, saved).action)
      .not.toMatch(/: [NSEW]+, about/)
    const west = [430.6, 433.4].map((z) =>
      resolvePublicV23Site(seed, `works5:ladder:mireglass-slate:W:-103:${Math.round(z * 10)}`))
      .find((site) => site !== null)
    if (!west) throw new Error('Missing supported west-face site')
    const nearWest = { ...view, player: { ...view.player,
      position: [-412, worldTileAtGrid(seed, -103, 104).center.y, 416] as const } }
    expect(publicV27StarterGuide(nearWest, works, saved).summary).toContain('Slate approach')
    expect(publicV27StarterGuide(nearWest, works, { ...saved,
      discoveryMask: encodeDiscoveredTileIds([
        ...new Set([...bridgeSite.footprintTileIds, ...west.footprintTileIds])].sort()) }).summary)
      .toBe('Mireglass Reach')
  })

  it.each(['greenway-alpha', 'wizard-realms'])('hands a zero-log %s Fen visit to a safe timber search', (seed) => {
    const site = mireglassRouteSites(seed).find((candidate) => candidate.kind === 'bridge')!
    const { view, works, context } = postDigFenFixture(seed, site.from, 0)
    const stage = publicV27StarterGuide(view, works, context)
    expect(stage.summary).toBe('Fen logs: find and chop dry-side timber before Works')
    expect(stage.action).toContain('No reachable revealed dry frontier')
    expect(stage.action).not.toMatch(/: [NSEW]+, about/)
    expect(stage.action).not.toContain('footprint is fully revealed nearby')
    expect(stage.action).not.toMatch(/tile-|mireglass_reach\/resource\/|\b[xyz] -?\d/)
    expect(publicV27StarterGuide({ ...view, backpack: { ...view.backpack,
      stacks: [...view.backpack.stacks, { ...view.backpack.stacks[0]!,
        itemId: 'logs', quantity: 8 }] } }, works, context).summary)
      .toBe('Fen bank: gather 8 logs and check Works')
  })

  it('searches safely inside the timber pocket at the observed #134 pose without mistaking an herb for a tree', () => {
    const seed = 'greenway-alpha'
    const position = { x: -308, y: worldTileAtGrid(seed, -77, 80).center.y, z: 319 }
    const { view, works, context } = postDigFenFixture(seed, position, 0)
    const herb = { id: 'mireglass_reach/herb/nearby', kind: 'herb' as const,
      label: 'Marsh herb patch', position: [-308, position.y, 320] as const,
      available: true }
    const withHerb = { ...view, resources: [...view.resources, herb],
      map: { ...view.map, tiles: view.map.tiles.map((tile) =>
        ({ ...tile, discovered: tile.id === worldTileAtGrid(seed, -77, 80).id,
          hasResource: tile.id === worldTileAtGrid(seed, -77, 80).id })) } }
    const stage = publicV27StarterGuide(withHerb, works, context)
    expect(stage.summary).toBe('Fen logs: find and chop dry-side timber before Works')
    expect(stage.action).toContain('Reveal nearby pocket ground')
    expect(stage.action).toContain('dot may be an herb')
    expect(stage.action).not.toMatch(/: [NSEW]+, about/)
  })

  it('uses only discovered, undepleted, dry authored timber for a local Chop cue', () => {
    const seed = 'greenway-alpha'
    const tree = mireglassResources(seed).find((resource) => resource.phase === 'before_bridge'
      && resource.tile.terrain === 'loam' && resource.tile.center.x < -304)!
    expect(tree).toBeDefined()
    const { view, works, context } = postDigFenFixture(seed, tree.tile.center, 0)
    const node = { id: tree.id, kind: 'tree' as const, label: 'Mireglass timber',
      position: [tree.tile.center.x, tree.tile.center.y, tree.tile.center.z] as const,
      available: true }
    const visible = { ...view, resources: [...view.resources, node],
      nearbyInteraction: { kind: 'resource' as const, targetId: `mireglass:chop:${tree.id}`,
        label: 'Chop Mireglass timber', action: 'Chop', actionable: true } }
    expect(publicV27StarterGuide(visible, works, context).action)
      .toContain('usable dry-side timber tree is in reach')
    const frontierWithTree = { ...visible, map: { ...visible.map,
      tiles: visible.map.tiles.map((tile) => ({ ...tile,
        discovered: tile.id === tree.tile.id })) } }
    expect(publicV27StarterGuide(frontierWithTree, works, context).action)
      .toContain('usable dry-side timber tree is in reach')
    expect(publicV27StarterGuide({ ...visible, nearbyInteraction: {
      ...visible.nearbyInteraction, targetId: 'mireglass:forage:nearby-herb',
      label: 'Gather marsh herb', action: 'Gather' } }, works, context).action)
      .not.toContain('usable dry-side timber tree is in reach')
    const hidden = { ...visible, map: { ...visible.map, tiles: visible.map.tiles.map((tile) =>
      tile.id === tree.tile.id ? { ...tile, discovered: false } : tile) } }
    expect(publicV27StarterGuide(hidden, works, context).action)
      .not.toContain('usable dry-side timber tree is in reach')
    const wet = { ...visible, map: { ...visible.map, tiles: visible.map.tiles.map((tile) =>
      tile.id === tree.tile.id ? { ...tile, terrain: 'wetland' as const } : tile) } }
    expect(publicV27StarterGuide(wet, works, context).action)
      .not.toContain('usable dry-side timber tree is in reach')
    expect(publicV27StarterGuide(visible, works, { ...context,
      depletedMireglassResourceIds: [tree.id] }).action)
      .not.toContain('usable dry-side timber tree is in reach')
    const adjacent = [[-1, 0], [0, -1], [1, 0], [0, 1]].map(([dx, dz]) =>
      worldTileAtGrid(seed, tree.tile.gridX - 3 + dx, tree.tile.gridZ - 3 + dz))
      .find((tile) => tile.terrain !== 'wetland'
        && Math.abs(tile.center.y - tree.tile.center.y) <= 0.8
        && mireglassMoveBarrier(seed, tile.center, tree.tile.center) === null
        && mireglassMoveBarrier(seed, tree.tile.center, tile.center) === null)
    if (!adjacent) throw new Error('Missing safe adjacent timber approach')
    const approaching = postDigFenFixture(seed, adjacent.center, 0)
    const routed = publicV27StarterGuide({ ...approaching.view,
      resources: [...approaching.view.resources, node] }, approaching.works, approaching.context)
    expect(routed.summary).toBe('Fen logs: find and chop dry-side timber before Works')
    expect(routed.action).toContain('revealed dry-side timber tree is ahead')
    expect(routed.action).not.toContain(tree.id)
  })

  it('admits no timber bearing without a connected discovered dry step and preserves stage gates', () => {
    const seed = 'greenway-alpha'
    const { view, works, context } = postDigFenFixture(seed, undefined, 0)
    const [x, , z] = view.player.position
    const isolated = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.gridX - 3 === Math.ceil(x / 4 - 0.5)
        && tile.gridZ - 3 === Math.ceil(z / 4 - 0.5) })) } }
    const fallback = publicV27StarterGuide(isolated, works, context)
    expect(fallback.summary).toBe('Fen logs: find and chop dry-side timber before Works')
    expect(fallback.action).toContain('No reachable revealed dry frontier')
    expect(fallback.action).not.toMatch(/: [NSEW]+, about/)
    expect(publicV27StarterGuide(view, works, { ...context,
      authoredFenBridgeId: 'mireglass_reach/route/fen_bridge' }).summary).toBe('Mireglass Reach')
    expect(publicV27StarterGuide({ ...view, skillXp: { ...view.skillXp,
      excavation: 0 } }, works, context).summary).toContain('Excavation Lv2')
    expect(publicV27StarterGuide(view, works, { ...context,
      mireglassCacheRevealed: true }).summary).toBe('Mireglass Reach')
  })

  it('does not certify an edge-of-cell ray through an unknown wet corner', () => {
    const seed = 'wizard-realms'
    const start = worldTileAtGrid(seed, -68, 89)
    const position = { x: -270.1, y: start.center.y, z: 357.9 }
    const { view, works, context } = postDigFenFixture(seed, position)
    const path = new Set([[-68, 89], [-69, 89], [-69, 90], [-70, 90]]
      .map(([gx, gz]) => worldTileAtGrid(seed, gx, gz).id))
    const corner = worldTileAtGrid(seed, -68, 90)
    expect(corner.terrain).toBe('wetland')
    expect(path.has(corner.id)).toBe(false)
    const known = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: path.has(tile.id) })) } }
    const stage = publicV27StarterGuide(known, works, context)
    expect(stage.summary).toBe('Fen bank: follow a known dry waypoint')
    expect(stage.action).not.toContain('WSW, about 10 m')
    expect(stage.action).toContain('WNW, about 6 m to the next known safe turn')
  })

  it('leaves the closed timber-pocket edge only through a discovered safe interior cell', () => {
    const seed = 'greenway-alpha'
    const start = worldTileAtGrid(seed, -83, 84)
    const interior = worldTileAtGrid(seed, -83, 83)
    expect(start.center.x).toBe(-332)
    expect(start.center.z).toBe(336)
    expect(interior.terrain).not.toBe('wetland')
    expect(Math.abs(start.center.y - interior.center.y)).toBeLessThanOrEqual(0.8)
    expect(mireglassMoveBarrier(seed, start.center, interior.center)).toBeNull()
    const position = { x: -332.93, y: start.center.y, z: 337.19 }
    const { view, works, context } = postDigFenFixture(seed, position, 0)
    const known = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.id === start.id || tile.id === interior.id })) } }
    const stage = publicV27StarterGuide(known, works, context)
    expect(stage.summary).toBe('Fen logs: find and chop dry-side timber before Works')
    expect(stage.action).toMatch(/: [NSEW]+, about \d+ m to the next known safe turn/)
    const hidden = { ...known, map: { ...known.map, tiles: known.map.tiles.map((tile) =>
      tile.id === interior.id ? { ...tile, discovered: false } : tile) } }
    const fallback = publicV27StarterGuide(hidden, works, context)
    expect(fallback.action).toContain('Reveal nearby pocket ground')
    expect(fallback.action).not.toMatch(/: [NSEW]+, about/)
  })

  it('routes from the authentic #146 pose to a revealed dry frontier, never into its unknown neighbor', () => {
    const seed = 'greenway-alpha'
    const start = worldTileAtGrid(seed, -84, 81)
    const position = { x: -336.25, y: 1.19, z: 323.76 }
    const { view, works, context } = postDigFenFixture(seed, position, 0)
    expect(start.terrain).not.toBe('wetland')
    const neighbors = [[-85, 81], [-84, 82], [-83, 81], [-84, 80]]
      .map(([gx, gz]) => worldTileAtGrid(seed, gx, gz))
      .filter((tile) => tile.center.x >= -336 && tile.center.x < -304
        && tile.center.z >= 304 && tile.center.z < 336)
    const dryNeighbor = neighbors.find((tile) => tile.terrain !== 'wetland'
      && Math.abs(tile.center.y - start.center.y) <= 0.8
      && mireglassMoveBarrier(seed, start.center, tile.center) === null
      && mireglassMoveBarrier(seed, tile.center, start.center) === null)
    expect(dryNeighbor).toBeDefined()
    const knownIds = new Set([start.id, ...neighbors.map((tile) => tile.id)])
    const known = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: knownIds.has(tile.id) })) } }
    const unknownPocket = known.map.tiles.some((tile) => !tile.discovered
      && (tile.gridX - 3) * 4 >= -336 && (tile.gridX - 3) * 4 < -304
      && (tile.gridZ - 3) * 4 >= 304 && (tile.gridZ - 3) * 4 < 336)
    expect(unknownPocket).toBe(true)
    const stage = publicV27StarterGuide(known, works, context)
    expect(stage.summary).toBe('Fen logs: find and chop dry-side timber before Works')
    expect(stage.action).toMatch(/: [NSEW]+, about \d+ m to the next known safe turn/)
    expect(stage.action).toMatch(/[Rr]eveal nearby pocket ground/)
    const shifted = publicV27StarterGuide({ ...known, player: { ...known.player,
      position: [position.x + 0.02, position.y, position.z] as const } }, works, context)
    expect(shifted.action).toBe(stage.action)
    const hidden = { ...known, map: { ...known.map, tiles: known.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.id === start.id })) } }
    expect(publicV27StarterGuide(hidden, works, context).action).not.toMatch(/: [NSEW]+, about/)
  })

  it.each(['greenway-alpha', 'wizard-realms'])('uses a known %s pocket frontier only while unexplored ground remains', (seed) => {
    const pocket = [] as ReturnType<typeof worldTileAtGrid>[]
    for (let gx = -83; gx <= -79; gx += 1)
      for (let gz = 77; gz <= 82; gz += 1) pocket.push(worldTileAtGrid(seed, gx, gz))
    const start = pocket.find((tile) => tile.terrain !== 'wetland')!
    expect(start).toBeDefined()
    const { view, works, context } = postDigFenFixture(seed, start.center, 0)
    const frontier = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.id === start.id })) } }
    const stage = publicV27StarterGuide(frontier, works, context)
    expect(stage.action).toContain('Reveal nearby pocket ground from here')
    expect(stage.action).not.toMatch(/: [NSEW]+, about/)
    expect(publicV27StarterGuide(view, works, context).action)
      .toContain('No reachable revealed dry frontier')
    expect(publicV27StarterGuide({ ...frontier, backpack: { ...frontier.backpack,
      stacks: [...frontier.backpack.stacks, { ...frontier.backpack.stacks[0]!,
        itemId: 'logs', quantity: 8 }] } }, works, context).summary)
      .toMatch(/^Fen bank:/)
  })

  it('does not replace a missing pocket frontier with a merely closer dry waypoint', () => {
    const seed = 'greenway-alpha'
    const { view, works, context } = postDigFenFixture(seed, undefined, 0)
    const full = publicV27StarterGuide(view, works, context)
    expect(full.action).toContain('No reachable revealed dry frontier')
    expect(full.action).not.toMatch(/: [NSEW]+, about/)
    const [x, , z] = view.player.position
    const gx = Math.ceil(x / 4 - 0.5), gz = Math.ceil(z / 4 - 0.5)
    const start = worldTileAtGrid(seed, gx, gz)
    const distance = (tile: ReturnType<typeof worldTileAtGrid>) => Math.hypot(
      Math.max(-336 - tile.center.x, 0, tile.center.x + 308),
      Math.max(304 - tile.center.z, 0, tile.center.z - 332))
    const progress = [[-1, 0], [0, 1], [1, 0], [0, -1]]
      .map(([dx, dz]) => worldTileAtGrid(seed, gx + dx, gz + dz))
      .find((tile) => tile.terrain !== 'wetland'
        && distance(tile) < distance(start)
        && Math.abs(tile.center.y - start.center.y) <= 0.8
        && mireglassMoveBarrier(seed, start.center, tile.center) === null
        && mireglassMoveBarrier(seed, tile.center, start.center) === null)
    expect(progress).toBeDefined()
    const disconnected = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.id === start.id || tile.id === progress?.id })) } }
    expect(disconnected.map.tiles.some((tile) => !tile.discovered
      && (tile.gridX - 3) * 4 >= -336 && (tile.gridX - 3) * 4 < -304
      && (tile.gridZ - 3) * 4 >= 304 && (tile.gridZ - 3) * 4 < 336)).toBe(true)
    const noFrontier = publicV27StarterGuide(disconnected, works, context)
    expect(noFrontier.action).toContain('No reachable revealed dry frontier')
    expect(noFrontier.action).not.toMatch(/: [NSEW]+, about/)
  })

  it.each(['greenway-alpha', 'wizard-realms'])('stops Fen guidance for either saved %s bridge ledger and preserves later stages', (seed) => {
    const { view, works, context } = postDigFenFixture(seed)
    const authored = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const terrain = enumerateTerrainWorkSites(seed,
      { minGX: -96, maxGX: -81, minGZ: 84, maxGZ: 99 })
      .find((site) => site.kind === 'bridge' && site.obstacle === 'fen_channel')!
    expect(terrain).toBeDefined()
    expect(publicV27StarterGuide(view, works,
      { ...context, authoredFenBridgeId: authored.id }).summary).toBe('Mireglass Reach')
    expect(publicV27StarterGuide(view, works,
      { ...context, builtTerrainWorkIds: [terrain.id] }).summary).toBe('Mireglass Reach')
    expect(publicV27StarterGuide({ ...view, skillXp: { ...view.skillXp,
      excavation: 0 } }, works, context).summary).toContain('Excavation Lv2')
    const revealed = { ...view, map: { ...view.map,
      guidance: 'Equip a field spade and excavate the revealed seal cache.' } }
    expect(publicV27StarterGuide(revealed, works,
      { ...context, mireglassCacheRevealed: true }).action)
      .toBe('Equip a field spade and excavate the revealed seal cache.')
    expect(publicV27StarterGuide({ ...revealed, map: { ...revealed.map,
      guidance: 'Return to the salvager to trade, then explore onward.' } }, works,
    { ...context, mireglassCacheRevealed: true }).action)
      .toBe('Return to the salvager to trade, then explore onward.')
  })

  it('does not call a wet, steep, or open-pit Fen waypoint a known safe turn', () => {
    const seed = 'greenway-alpha', { view, works, context } = postDigFenFixture('greenway-alpha')
    const [x, , z] = view.player.position
    const gx = Math.ceil(x / 4 - 0.5), gz = Math.ceil(z / 4 - 0.5)
    const start = worldTileAtGrid(seed, gx, gz)
    const next = [[gx - 1, gz], [gx, gz + 1]].map(([nx, nz]) =>
      worldTileAtGrid(seed, nx, nz)).find((tile) => tile.terrain !== 'wetland'
        && Math.abs(tile.center.y - start.center.y) <= 0.8
        && mireglassMoveBarrier(seed, start.center, tile.center) === null)
    if (!next) throw new Error('Missing dry adjacent Fen approach cell')
    const known = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.id === start.id || tile.id === next.id })) } }
    expect(publicV27StarterGuide(known, works, context).summary)
      .toBe('Fen bank: follow a known dry waypoint')
    const changed = (update: (tile: WizardViewProjection['map']['tiles'][number]) =>
      WizardViewProjection['map']['tiles'][number]) => ({ ...known, map: { ...known.map,
      tiles: known.map.tiles.map((tile) => tile.id === next.id ? update(tile) : tile) } })
    expect(publicV27StarterGuide(changed((tile) => ({ ...tile, terrain: 'wetland' })),
      works, context).summary).toBe('Fen bank: reveal adjacent safe ground')
    expect(publicV27StarterGuide(changed((tile) => ({ ...tile,
      elevationMeters: start.center.y + 3 })), works, context).summary)
      .toBe('Fen bank: reveal adjacent safe ground')
    expect(publicV27StarterGuide(known, works, { ...context,
      openPitColumns: [{ gx: next.gridX - 3, gz: next.gridZ - 3,
        openDepth: 2 }] }).summary).toBe('Fen bank: reveal adjacent safe ground')
  })

  it('does not guide across a saved Slate barrier while charting the Fen approach', () => {
    const seed = 'greenway-alpha'
    const pairs = [] as Array<[ReturnType<typeof worldTileAtGrid>, ReturnType<typeof worldTileAtGrid>]>
    for (let gx = -110; gx <= -90; gx++) for (let gz = 101; gz <= 116; gz++) {
      const from = worldTileAtGrid(seed, gx, gz)
      const to = worldTileAtGrid(seed, gx, gz - 1)
      if (from.terrain !== 'wetland' && to.terrain !== 'wetland'
        && mireglassMoveBarrier(seed, from.center, to.center) === 'slate_cliff') {
        pairs.push([from, to])
      }
    }
    const pair = pairs[0]
    if (!pair) throw new Error('Missing dry Slate barrier pair')
    const [from, to] = pair
    const { view, works, context } = postDigFenFixture(seed, from.center)
    const known = { ...view, map: { ...view.map, tiles: view.map.tiles.map((tile) =>
      ({ ...tile, discovered: tile.id === from.id || tile.id === to.id })) } }
    expect(publicV27StarterGuide(known, works, context).summary)
      .toBe('Fen bank: reveal adjacent safe ground')
  })

  it.each(['greenway-alpha', 'wizard-realms'])('rejoins the %s salvager trail after straying east into Wilderness', (seed) => {
    const base = toViewProjection(createWizardWorld(seed), [])
    const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const marker = mireglassAnchors(seed).fringeMarker.tile.center
    const trail = mireglassApproachTrail(seed)
    const position = seed === 'greenway-alpha'
      ? [-79.11, 1.26, 101.63] as const
      : [marker.x + 28.89, marker.y, marker.z - 2.37] as const
    const view = withKnownLocalGround({ ...base, player: { ...base.player, position },
      map: { ...base.map, title: 'Wilderness' } }, position, 16, 15)
    const works = { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] }
    const context = { movementOwner: 'streamed' as const, riverBridgeBuilt: true,
      riverBridgeId: site.id, claimedBridgeheadId: site.id,
      fringeMarkerStudied: true, fieldSpadeOwned: false, mireglassCacheRevealed: false }
    expect(position[2]).toBeGreaterThan(site.to.z)
    const stage = publicV27StarterGuide(view, works, context)
    expect(trail.length).toBeGreaterThan(8)
    expect(stage.action).toContain('Rejoin the marked dry trail:')
    expect(stage.action).toMatch(/about \d+ m to the next safe turn/)
    expect(stage.action).toContain('At the salvager, buy a field spade.')
    expect(stage.action).not.toContain('frontier marker')
    expect(stage.action).not.toMatch(/\b[xyz] -?\d/)
    expect(publicV27StarterGuide(view, works, { ...context, fringeMarkerStudied: false }).action)
      .toContain('Mireglass frontier marker:')
    expect(publicV27StarterGuide(view, works, { ...context, fieldSpadeOwned: true }).action)
      .not.toContain('Buy a field spade')
    expect(publicV27StarterGuide({ ...view, player: { ...view.player,
      position: [position[0] - 12, position[1], position[2]] as const } }, works, context).action)
      .not.toBe(stage.action)
    const tiny = publicV27StarterGuide({ ...view, player: { ...view.player,
      position: [position[0] + 0.02, position[1], position[2]] as const } }, works, context)
    expect(tiny.action).toBe(stage.action)
  })

  it('uses a shorter dry leg where a corpus seed has wetland on the direct salvager line', () => {
    const seed = 'mireglass-corpus-13'
    const base = toViewProjection(createWizardWorld(seed), [])
    const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const trail = mireglassApproachTrail(seed)
    const marker = trail[0], salvager = trail.at(-1)!
    const directSteps = Math.ceil(Math.hypot(salvager.x - marker.x, salvager.z - marker.z))
    expect(Array.from({ length: directSteps + 1 }, (_, step) => {
      const x = marker.x + (salvager.x - marker.x) * step / directSteps
      const z = marker.z + (salvager.z - marker.z) * step / directSteps
      return worldTileAtGrid(seed, Math.ceil(x / 4 - 0.5), Math.ceil(z / 4 - 0.5)).terrain
    })).toContain('wetland')
    const works = { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] }
    const context = { movementOwner: 'streamed' as const, riverBridgeBuilt: true,
      riverBridgeId: site.id, claimedBridgeheadId: site.id,
      fringeMarkerStudied: true, fieldSpadeOwned: false, mireglassCacheRevealed: false }
    const at = (index: number) => publicV27StarterGuide({ ...base,
      player: { ...base.player, position: [trail[index].x, trail[index].y,
        trail[index].z] as const } }, works, context).action
    expect(at(0)).toContain('SW, about 23 m to the next dry waypoint.')
    expect(at(80)).toContain('SSW, about 18 m to the next dry waypoint.')
    expect(at(80)).not.toContain(`about ${directSteps} m`)
  })

  it('routes known dry ground around a wetland-separated nearby trail in corpus 13', () => {
      const seed = 'mireglass-corpus-13', x = -276, z = 272
      const base = toViewProjection(createWizardWorld(seed), [])
      const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
      const position = [x, 0, z] as const
      const view = withKnownLocalGround({ ...base, player: { ...base.player, position },
        map: { ...base.map, title: 'Wilderness' } }, position, 16, 15)
      const works = { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] }
      const context = { movementOwner: 'streamed' as const, riverBridgeBuilt: true,
        riverBridgeId: site.id, claimedBridgeheadId: site.id,
        fringeMarkerStudied: true, fieldSpadeOwned: false, mireglassCacheRevealed: false }
      const action = publicV27StarterGuide(view, works, context).action
      expect(action).toMatch(/Rejoin the marked dry trail: [NSEW]+, about \d+ m to the next safe turn/)
      expect(action).not.toContain('No known dry connection')
      expect(publicV27StarterGuide({ ...view, player: { ...view.player,
        position: [x + 0.02, 0, z] as const } }, works, context).action).toBe(action)
    })

  it('does not invent a 68 m rejoin outside the production-sized local window', () => {
    const seed = 'greenway-alpha', base = toViewProjection(createWizardWorld(seed), [])
    const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const position = [-40, 0, 104] as const
    const view = withKnownLocalGround({ ...base, player: { ...base.player, position },
      map: { ...base.map, title: 'Wilderness' } }, position, 16, 15)
    expect(view.map.tiles).toHaveLength(33 * 33)
    expect(view.terrain).toHaveLength(31 * 31)
    const action = publicV27StarterGuide(view,
      { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] },
      { movementOwner: 'streamed', riverBridgeBuilt: true,
        riverBridgeId: site.id, claimedBridgeheadId: site.id,
        fringeMarkerStudied: true, fieldSpadeOwned: false, mireglassCacheRevealed: false }).action
    expect(action).toContain('No known dry connection to the marked trail.')
  })

  it('admits no invented bearing where discovered cells have no dry trail connection', () => {
    const seed = 'greenway-alpha', base = toViewProjection(createWizardWorld(seed), [])
    const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const position = [-40, 0, 104] as const
    const local = withKnownLocalGround({ ...base, player: { ...base.player, position },
      map: { ...base.map, title: 'Wilderness' } }, position)
    const currentId = worldTileAtGrid(seed, -10, 26).id
    const view = { ...local, map: { ...local.map,
      tiles: local.map.tiles.filter((tile) => tile.id === currentId) } }
    const action = publicV27StarterGuide(view,
      { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] },
      { movementOwner: 'streamed', riverBridgeBuilt: true,
        riverBridgeId: site.id, claimedBridgeheadId: site.id,
        fringeMarkerStudied: true, fieldSpadeOwned: false, mireglassCacheRevealed: false }).action
    expect(action).toContain('No known dry connection to the marked trail.')
    expect(action).toContain('Retrace explored ground or reveal another safe route')
    expect(action).not.toMatch(/: [NSEW]+, about/)
  })

  it('does not step across a saved height discontinuity while rejoining', () => {
    const seed = 'greenway-alpha', base = toViewProjection(createWizardWorld(seed), [])
    const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const position = [-40, 0, 104] as const
    const local = withKnownLocalGround({ ...base, player: { ...base.player, position },
      map: { ...base.map, title: 'Wilderness' } }, position)
    const startId = worldTileAtGrid(seed, -10, 26).id
    const blocked = { ...local, map: { ...local.map, tiles: local.map.tiles.map((tile) =>
      tile.id === startId ? tile : { ...tile, elevationMeters:
        (local.terrain.find((cell) => cell.id === tile.id)?.height ?? 0) + 3 }) } }
    const action = publicV27StarterGuide(blocked,
      { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] },
      { movementOwner: 'streamed', riverBridgeBuilt: true,
        riverBridgeId: site.id, claimedBridgeheadId: site.id,
        fringeMarkerStudied: true, fieldSpadeOwned: false, mireglassCacheRevealed: false }).action
    expect(action).toContain('No known dry connection to the marked trail.')
  })

  it('does not route through a known two-depth open pit without a pit ladder', () => {
    const seed = 'greenway-alpha', base = toViewProjection(createWizardWorld(seed), [])
    const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const position = [-79.11, 1.26, 101.63] as const
    const local = withKnownLocalGround({ ...base, player: { ...base.player, position },
      map: { ...base.map, title: 'Wilderness' } }, position, 16, 15)
    const adjacent = [[-21, 25], [-19, 25], [-20, 24], [-20, 26]] as const
    const pits = adjacent.map(([gx, gz]) => worldTileAtGrid(seed, gx, gz))
    const pitHeights = new Map(pits.map((pit) => [pit.id, pit.center.y - 0.8]))
    const view = { ...local,
      terrain: local.terrain.map((cell) => pitHeights.has(cell.id)
        ? { ...cell, position: [cell.position[0], pitHeights.get(cell.id)!, cell.position[2]] as const,
          height: pitHeights.get(cell.id)! } : cell),
      map: { ...local.map, tiles: local.map.tiles.map((tile) =>
        pitHeights.has(tile.id) ? { ...tile, elevationMeters: pitHeights.get(tile.id)! } : tile) } }
    const works = { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] }
    const context = { movementOwner: 'streamed' as const, riverBridgeBuilt: true,
      riverBridgeId: site.id, claimedBridgeheadId: site.id,
      fringeMarkerStudied: true, fieldSpadeOwned: false, mireglassCacheRevealed: false }
    expect(publicV27StarterGuide(view, works, context).action).toContain('next safe turn')
    const openPitColumns = adjacent.map(([gx, gz]) => ({ gx, gz,
      openDepth: 2, pitLadder: false }))
    const blocked = publicV27StarterGuide(view, works,
      { ...context, openPitColumns }).action
    expect(blocked).toContain('No known dry connection to the marked trail.')
    expect(blocked).not.toMatch(/: [NSEW]+, about/)
  })

  it('keeps local rejoin work bounded across repeated guide renders', () => {
    const seed = 'mireglass-corpus-13', base = toViewProjection(createWizardWorld(seed), [])
    const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const position = [-276, 0, 272] as const
    const view = withKnownLocalGround({ ...base, player: { ...base.player, position },
      map: { ...base.map, title: 'Wilderness' } }, position)
    const works = { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] }
    const context = { movementOwner: 'streamed' as const, riverBridgeBuilt: true,
      riverBridgeId: site.id, claimedBridgeheadId: site.id,
      fringeMarkerStudied: true, fieldSpadeOwned: false, mireglassCacheRevealed: false }
    const started = performance.now()
    for (let index = 0; index < 25; index += 1)
      expect(publicV27StarterGuide(view, works, context).action).toContain('next safe turn')
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(1_000)
  })

  it('uses saved river stages without inventing a distant post or overriding Mireglass', () => {
    const base = toViewProjection(createWizardWorld('wizard-realms'), [])
    const site = resolvePublicV28RiverBridge(base.seed, 'works6:river-bridge:-43')!
    const works = { builtLadderIds: [ladder], builtBridgeIds: [], dugTileIds: [] }
    const at = (z: number) => ({ ...base, player: { ...base.player,
      position: [site.from.x, site.from.y, z] as const } })
    const context = { movementOwner: 'streamed' as const, riverBridgeBuilt: true,
      riverBridgeId: site.id, claimedBridgeheadId: null }
    const source = publicV27StarterGuide(at(site.from.z), works, context)
    expect(source.action).toContain('dry source bank to cross')
    const onDeck = publicV27StarterGuide(at((site.from.z + site.to.z) / 2), works, context)
    expect(onDeck.summary).toBe('On the saved river bridge')
    expect(onDeck.action).not.toContain('cross')
    const far = at(site.exit.z)
    const hidden = publicV27StarterGuide(far, works, context)
    expect(hidden.action).not.toContain('post')
    expect(hidden.action).not.toContain('cross')
    const post = { bridgeId: site.id, position: [site.exit.x, site.exit.y,
      site.exit.z] as const, tileId: site.footprintTileIds.at(-1)!,
      claimed: false, claimReady: true, reward: 'basic-pick' as const }
    const discovered = publicV27StarterGuide({ ...far, v30Bridgehead: post }, works, context)
    expect(discovered.action).toContain('discovered River Works post')
    expect(discovered.action).toContain('claim its one-time find')
    expect(discovered.action).not.toContain('cross')
    const claimedContext = { ...context, claimedBridgeheadId: site.id }
    const claimedFar = publicV27StarterGuide(far, works, claimedContext)
    expect(claimedFar.action).toContain('Mireglass frontier marker')
    expect(claimedFar.action).not.toContain('cross')
    const studiedContext = { ...claimedContext, fringeMarkerStudied: true,
      fieldSpadeOwned: false, mireglassCacheRevealed: false }
    expect(publicV27StarterGuide(at(site.from.z), works, studiedContext).action)
      .toContain('Greenway Outfitters')
    expect(publicV27StarterGuide(at((site.from.z + site.to.z) / 2), works, studiedContext).summary)
      .toBe('On the saved river bridge')
    expect(publicV27StarterGuide({ ...far, v30Bridgehead: post }, works,
      { ...studiedContext, claimedBridgeheadId: null }).action)
      .toContain('claim its one-time find')
    const returned = publicV27StarterGuide(at(site.from.z), works, claimedContext)
    expect(returned.action).toContain('Greenway Outfitters')
    expect(returned.action).toContain('choose to cross again')
    const mireglass = publicV27StarterGuide({ ...far, map: { ...far.map,
      title: 'Mireglass Reach', guidance: 'Equip a field spade and excavate the revealed seal cache.' } },
    works, claimedContext)
    expect(mireglass.action).toBe('Equip a field spade and excavate the revealed seal cache.')
    expect(mireglass.summary).toBe('Mireglass Reach')
    const unrelated = publicV27StarterGuide({ ...far, v30Bridgehead: post }, works,
      { ...context, riverBridgeId: 'works6:river-bridge:-14' })
    expect(unrelated.action).not.toContain('discovered River Works post')
    const unbuilt = publicV27StarterGuide({ ...far, v30Bridgehead: post }, works,
      { ...context, riverBridgeBuilt: false })
    expect(unbuilt.action).not.toContain('claim its one-time find')
    const noHint = publicV27StarterGuide({ ...far,
      map: { ...far.map, title: 'Mireglass Reach', guidance: undefined } }, works,
    { movementOwner: 'streamed', riverBridgeBuilt: false })
    expect(noHint.action).not.toContain('frontier marker')
  })

  it('gates concise route, store and dig guidance to V27 and follows built routes', () => {
    const start = guide('v27', false, false)
    expect(start).toContain('First steps: 8-log South creek bridge')
    expect(start).toContain('first 8 logs for the South creek bridge')
    expect(start).toContain('then 4 for the north ladder and 8 more for a connected-river bridge')
    expect(start).toContain('Not every river bank supports a bridge')
    expect(start).toContain('Buy boots at Greenway Outfitters to run')
    expect(start).toContain('spade for click-to-dig')
    expect(guide('v27', true, false)).toContain('Ladder ready: find a river crossing')
    expect(guide('v27', false, true)).toContain('Bridge ready: cross to the far bank')
    expect(guide('v27', true, true)).toContain('Ladder ready: find a river crossing')
    expect(guide('v27', true, true)).not.toContain('connected-river bridge saved')
    expect(guide('v26', false, false)).not.toContain('Not every river bank supports a bridge')
  })

  it('uses carried inventory for log choices and gives a truthful full-pack action', () => {
    const base = toViewProjection(createWizardWorld('greenway-alpha'), [])
    const axe = base.backpack.stacks[0]!
    const withLogs = (quantity: number) => ({ ...base, backpack: { ...base.backpack,
      stacks: [{ ...axe, id: 'logs-test', itemId: 'logs', quantity }] } })
    const emptyWorks = { builtBridgeIds: [], builtLadderIds: [], dugTileIds: [] }
    expect(publicV27StarterGuide(withLogs(4), emptyWorks).action)
      .toContain('8-log South creek bridge (4/8)')
    expect(publicV27StarterGuide(withLogs(8), emptyWorks).action)
      .toContain('Build a marked Ready South creek bridge with 8 logs')
    expect(publicV27StarterGuide(withLogs(20), emptyWorks).summary).not.toContain('Pack full')
    const full = publicV27StarterGuide({ ...base, backpack: { ...base.backpack,
      stacks: [{ ...axe, id: 'stone-test', itemId: 'stone', name: 'Stone', quantity: 20 }] } }, emptyWorks)
    expect(full.summary).toContain('Pack full')
    expect(full.action).toContain('sell carried stone at Greenway Outfitters')
    expect(full.action).toContain('Excavated terrain-bag materials cannot be sold yet')
    expect(full.action).not.toContain('sell terrain-bag')
    const soilBag = publicV27StarterGuide({ ...base,
      backpack: { ...base.backpack, stacks: [] },
      v26TerrainBag: { soil: base.backpack.capacity, stone: 0, iron_ore: 0,
        gold_ore: 0, diamond: 0 } }, emptyWorks)
    expect(soilBag.action).toContain('use Fill on an open pit in reach')
    expect(soilBag.action).not.toContain('sell carried stone')
  })

  it('prioritizes both saved routes over a full Greenway pack', () => {
    const base = toViewProjection(createWizardWorld('greenway-alpha'), [])
    const full = { ...base, backpack: { ...base.backpack,
      stacks: [{ ...base.backpack.stacks[0]!, id: 'stone-test', itemId: 'stone', name: 'Stone',
        quantity: base.backpack.capacity }] } }
    const works = { builtLadderIds: [ladder], builtBridgeIds: [bridge], dugTileIds: [] }
    const stage = publicV27StarterGuide(full, works,
      { movementOwner: 'greenway', riverBridgeBuilt: true })
    expect(stage.summary).toBe('Routes ready: connected-river bridge saved')
    expect(stage.action).toContain('use its saved deck from a dry bank to cross')
    expect(stage.action).not.toContain('Pack full')
  })

  it('keeps legacy full-pack sale copy while describing V29 terrain-bag sales', () => {
    const base = toViewProjection(createWizardWorld('greenway-alpha'), [])
    const full = { ...base, backpack: { ...base.backpack, stacks: [] },
      v26TerrainBag: { soil: base.backpack.capacity, stone: 0, iron_ore: 0,
        gold_ore: 0, diamond: 0 } }
    const works = { builtLadderIds: [], builtBridgeIds: [], dugTileIds: [] }
    expect(publicV27StarterGuide(full, works).action)
      .toContain('Excavated terrain-bag materials cannot be sold yet')
    const v29 = publicV27StarterGuide({ ...full, v29Mining: {
      tools: { basicPickOwned: false, enchantedPickOwned: false, activePick: null },
      offers: [], bids: { soil: 1, stone: 3, iron_ore: 8, gold_ore: 15, diamond: 60 },
      bag: full.v26TerrainBag, excavationLevel: 1, atOutfitters: false } }, works)
    expect(v29.action).toContain('Sell excavated terrain-bag materials at Greenway Outfitters')
    expect(v29.action).not.toContain('cannot be sold yet')
  })
})

describe('controller-local active-view memo', () => {
  it('reduces held-step view clones while UI-only rerenders and rejected frames reuse one view', () => {
    const baseline = { movementOwner: 'greenway' as const, tick: 0,
      player: createPublicV23Root('greenway-alpha').head.state.player,
      activeTiles: [worldTileAtGrid('greenway-alpha', 0, 0)],
      activeKnownTileIds: [] as string[], pendingBoundary: false }
    let status = { saveRevision: 0, pendingFrames: 0 }
    const view = vi.fn(() => structuredClone(baseline))
    const runtime = { status: () => status, view }
    const memo: Parameters<typeof publicV23ReadActiveView>[1] = { current: null }
    const first = publicV23ReadActiveView(runtime, memo)
    expect(publicV23ReadActiveView(runtime, memo)).toBe(first) // UI-only rerender.
    for (let step = 1; step <= 17; step++) {
      expect(publicV23ReadActiveView(runtime, memo)).toBe(memo.current?.value) // Timed check.
      publicV23ReadActiveView(runtime, memo) // Before movement.
      status = { ...status, pendingFrames: step } // One accepted frame.
      const after = publicV23ReadActiveView(runtime, memo)
      expect(publicV23ReadActiveView(runtime, memo)).toBe(after) // React render.
    }
    expect(view).toHaveBeenCalledTimes(18) // Previously four reads per held step.
    const rejected = publicV23ReadActiveView(runtime, memo)
    expect(rejected).toBe(memo.current?.value)
    expect(view).toHaveBeenCalledTimes(18)
    for (const mutation of ['save', 'action', 'return-home', 'v31-soil']) {
      status = { saveRevision: status.saveRevision + 1, pendingFrames: 0 }
      expect(publicV23ReadActiveView(runtime, memo)).not.toBe(rejected)
      expect(view).toHaveBeenCalledTimes(19 + ['save', 'action', 'return-home', 'v31-soil']
        .indexOf(mutation))
    }
    const replacementView = vi.fn(() => structuredClone(baseline))
    publicV23ReadActiveView({ status: () => status, view: replacementView }, memo)
    expect(replacementView).toHaveBeenCalledOnce()
  })

  it('matches a fresh V31 view through rejected and accepted frames and a checked save', async () => {
    const start = v31Start(), runtime = createPublicV31ControllerRuntime(start, v31Writer(start))
    const memo = { current: null }
    const first = publicV23ReadActiveView(runtime, memo)
    expect(first).toEqual(runtime.view())
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 100, z: 0 } }], false)
      .rejections.length).toBeGreaterThan(0)
    expect(publicV23ReadActiveView(runtime, memo)).toBe(first)
    expect(publicV23ReadActiveView(runtime, memo)).toEqual(runtime.view())
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.02, z: 0 } }], false)
      .rejections).toEqual([])
    const moved = publicV23ReadActiveView(runtime, memo)
    expect(moved).not.toBe(first)
    expect(moved).toEqual(runtime.view())
    expect(moved.player.position).not.toEqual(first.player.position)
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    const saved = publicV23ReadActiveView(runtime, memo)
    expect(saved).not.toBe(moved)
    expect(saved).toEqual(runtime.view())
    expect(saved).toMatchObject({ movementOwner: moved.movementOwner,
      activeKnownTileIds: moved.activeKnownTileIds,
      player: { yaw: moved.player.yaw, verticalVelocity: moved.player.verticalVelocity,
        equipment: moved.player.equipment } })
    expect(saved.activeTiles).toEqual(runtime.view().activeTiles)
  }, 60_000)

  it('invalidates after a real checked equipment action', async () => {
    const root = createPublicV23Root('greenway-alpha')
    let current = { ...root, head: { ...root.head, state: { ...root.head.state,
      player: { ...root.head.state.player,
        inventory: [...root.head.state.player.inventory,
          { itemId: 'leather_boots' as const, quantity: 1 }] } } } }
    const runtime = createPublicV23ControllerRuntime(current,
      async (revision, lineage, witness) => {
        const next = revision === current.head.saveRevision
          ? applyPublicV23Witness({ state: current.head.state,
            greenwayWorks: current.head.greenwayWorks,
            regionalWorks: current.head.regionalWorks }, witness) : null
        if (!next || 'rejection' in next)
          return { ok: false as const, reason: 'action-rejected' }
        current = { lineage, head: { ...current.head, ...next.progress,
          saveRevision: revision + 1, witness } }
        return { ok: true as const, value: current }
      })
    const memo = { current: null }
    const before = publicV23ReadActiveView(runtime, memo)
    expect(before.player.equipment.feet).not.toBe('leather_boots')
    expect(await runtime.action({ kind: 'legacy-action', intent: {
      type: 'equip_item', itemId: 'leather_boots', slot: 'feet' } }))
      .toMatchObject({ status: 'saved' })
    const after = publicV23ReadActiveView(runtime, memo)
    expect(after).not.toBe(before)
    expect(after.player.equipment.feet).toBe('leather_boots')
    expect(after).toEqual(runtime.view())
    expect(after.activeTiles).toEqual(before.activeTiles)
    expect(after.activeKnownTileIds).toEqual(before.activeKnownTileIds)
    expect(runtime.status()).toMatchObject({ saveRevision: 1, pendingFrames: 0 })
  })

  it('invalidates after a checked V31 soil placement without aliasing its runtime view', async () => {
    let start = v31Start()
    let site: { gx: number; gz: number } | null = null
    for (let gx = -10; gx <= 10 && !site; gx++) for (let gz = -10; gz <= 10; gz++) {
      const position = { x: (gx - 1) * 4, z: gz * 4 }
      const support = publicV17StarterSupportAt({ seed: start.head.state.seed,
        profile: start.head.state.generationProfile,
        route: start.head.state.greenway.routes.find((route) =>
          route.id === 'greenway_ladder') ?? null,
        built: false, greenwayWorks: start.head.greenwayWorks }, position)
      if (support?.kind !== 'ground') continue
      const candidate: PublicV31Start = { ...start, head: { ...start.head,
        terrain: { ...start.head.terrain,
          bag: { ...start.head.terrain.bag, soil: 1 } },
        state: { ...start.head.state,
          discoveryMask: encodeDiscoveredTileIds([...new Set([
            ...decodeDiscoveredTileIds(start.head.state.discoveryMask),
            `tile-${gx + 3}-${gz + 3}`])].sort()),
          player: { ...start.head.state.player, position: { ...position, y: support.floorY },
            inventory: [...start.head.state.player.inventory,
              { itemId: 'field_spade' as const, quantity: 1 }],
            equipment: { ...start.head.state.player.equipment, mainHand: 'field_spade' } } } } }
      if (replayPublicV31Witness(candidate.head, { kind: 'soil-place/v1', gx, gz })) {
        start = candidate; site = { gx, gz }
      }
    }
    if (!site) throw new Error('No checked V31 soil fixture')
    const runtime = createPublicV31ControllerRuntime(start, v31Writer(start))
    const memo = { current: null }
    const before = publicV23ReadActiveView(runtime, memo)
    expect(await runtime.action({ kind: 'soil-place/v1', ...site }))
      .toMatchObject({ status: 'saved' })
    const after = publicV23ReadActiveView(runtime, memo)
    expect(after).not.toBe(before)
    expect(after).toEqual(runtime.view())
    expect(runtime.preview().raisedSoilCells).toEqual([site])
    expect(runtime.view()).not.toBe(after)
  }, 60_000)

  it('invalidates after a writer-stamped checked return home', async () => {
    const seed = 'wizard-realms', v23 = createPublicV23Root(seed)
    const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
    const point = { x: 12, z: 4 }
    const support = publicV17StarterSupportAt({ seed,
      profile: v24.head.state.generationProfile,
      route: v24.head.state.greenway.routes.find((route) =>
        route.id === 'greenway_ladder') ?? null,
      built: false, greenwayWorks: v24.head.greenwayWorks }, point)
    if (!support) throw new Error('Missing trapped fixture support')
    const shaped = decodePublicV23Progress({ state: { ...v24.head.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(v24.head.state.discoveryMask),
        'tile-6-4'])].sort()),
      player: { ...v24.head.state.player,
        position: { ...point, y: support.floorY } } },
      greenwayWorks: v24.head.greenwayWorks,
      regionalWorks: v24.head.regionalWorks }, seed)
    if (!shaped) throw new Error('Invalid trapped fixture')
    const v25 = createPublicV25Root({ head: { ...v24.head, ...shaped,
      saveRevision: 1, witness: { kind: 'checkpoint' as const } },
      lineage: v24.lineage })
    const v26 = createPublicV26Root({ head: { ...v25.head, saveRevision: 1,
      witness: { kind: 'checkpoint' as const }, excavation: {
      columns: [{ gx: 3, gz: 1, depth: 8 }], bag: { ...v25.head.excavation.bag } } },
      lineage: v25.lineage })
    const start = { head: v26.head, lineage: v26.lineage }
    const runtime = createPublicV26ControllerRuntime(start,
      async () => ({ ok: false as const, reason: 'unexpected-frame-write' }),
      async (revision, lineage) => {
        const witness = { kind: 'return-home/v1' as const, atMs: 10_000 }
        const { state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs } = start.head
        const next = replayPublicV26Witness({ state, greenwayWorks, regionalWorks,
          terrain, nextHomeAtMs }, witness)
        return next ? { ok: true as const, value: { lineage, head: { ...start.head,
          ...next, saveRevision: revision + 1, witness } } }
          : { ok: false as const, reason: 'not_trapped' }
      })
    const memo = { current: null }
    const before = publicV23ReadActiveView(runtime, memo)
    expect(await runtime.returnHome()).toMatchObject({ status: 'saved' })
    const after = publicV23ReadActiveView(runtime, memo)
    expect(after).not.toBe(before)
    expect(after).toEqual(runtime.view())
    expect(after.player.position).not.toEqual(before.player.position)
    expect(runtime.status()).toMatchObject({ saveRevision: 1, pendingFrames: 0 })
  }, 30_000)
})
