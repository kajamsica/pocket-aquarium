import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WizardViewIntent } from './view'
import { intentForView } from './App'
import { mireglassActionChoices, mireglassNextObjective } from './MireglassPlayableApp'
import { publicWorldViewProjection } from './PublicWorldView'
import { createGeneratedWorld } from './domain/generation'
import { mireglassAnchors, mireglassFairyRing } from './domain/mireglassContent'
import { mireglassHerbPatches } from './domain/mireglassHerbPatches'
import { mireglassRouteSites } from './domain/mireglassRouteSites'
import { mireglassFenRowAt } from './domain/mireglassTerrain'
import { mireglassMoveBarrier } from './domain/mireglassMovementGate'
import { applyFieldCampAction } from './domain/fieldCamp'
import { WORLD_CELL_METERS, worldTileAtGrid } from './domain/worldChunks'
import { encodePublicV8Head } from './domain/publicWorldV8Snapshot'
import { parsePublicV9Rescue } from './domain/publicWorldV9Snapshot'
import { encodePublicV9Head } from './domain/publicWorldV9Snapshot'
import { parsePublicV10Rescue } from './domain/publicWorldV10Snapshot'
import { encodePublicV10Head } from './domain/publicWorldV10Snapshot'
import { withPublicV10TerrainRevision } from './domain/publicWorldV10State'
import { classifyStreamedRegion, highlandStoneNodes } from './domain/highlandContent'
import { parsePublicV11Rescue } from './domain/publicWorldV11Snapshot'
import { withPublicV11Highland } from './domain/publicWorldV11State'
import { withFreshPublicV9Camps } from './domain/publicWorldV9State'
import { actPublicMireglass } from './domain/publicWorldActions'
import { advancePublicWorldFrame, advancePublicWorldV10Frame, type PublicWorldAdvanceResult } from './domain/publicWorldRuntime'
import { createFreshPublicWorld } from './domain/publicWorldState'
import {
  PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_STAGE_KEY,
  commitPublicV7World, createPublicV7StateFromV6Root, migratePublicV6ToV7, serializePublicV7World, withFreshPublicV7Herbs,
} from './domain/publicWorldV7'
import { readPublicV7RecoverySnapshot } from './domain/publicWorldV7Recovery'
import { PUBLIC_V6_BACKUP_KEY, PUBLIC_V6_ROOT_KEY, PUBLIC_V6_SCHEMA, PUBLIC_V6_STAGE_KEY,
  commitLegacyImportToPublicV6, inspectLegacyImportSource, commitPublicV6World, loadPublicV6Root, parsePublicV6PlayableRoot,
  readPublicV6RecoverySnapshot, serializePublicV6World } from './domain/publicWorldV6'
import { serializeWizardWorld } from './domain/persistence'
import { createFixedInputClock, createTimedMovementSampler, recordTimedMovement, sampleFixedInputBatch } from './view/timedInput'
import { WizardMap } from './view/WizardMap'
import {
  PUBLIC_V6_LOCK_NAME, advancePublicControls, appendMessages, commitPublicSnapshot, greenwayForPublicView,
  importPublicWorld, inspectPublicEntry, mireglassForPublicView, publicFreshForkChoiceCopy,
  publicPendingV7StageGuidance, publicRecoveryChoices,
  publicV7RecoveryChoices, recoverPublicWorld, resumePublicWorld, startFreshPublicWorld,
  unsavedPublicWorldBytes, publicWorldEventText,
  publicAreaTitle, publicFrameMessages, publicHerbChoices, publicHerbGuidancePriority,
  publicHerbMapGuidance, publicHerbRouteHint,
  publicRegionTransitionText,
  publicFieldCampView, requirePublicV9State, requirePublicV10State, requirePublicV11State,
  unsavedPublicV9Bytes, unsavedPublicV10Bytes, unsavedPublicV11Bytes,
  publicSaveableVersion, publicTravelFlushNeeded,
  PublicWizardApp, type PublicLockProvider, type PublicV8PlayableSession,
} from './PublicWizardApp'

const seed = 'greenway-alpha'
const legacyKey = 'wizard-realms:world:v5'
let dispatch: (intent: WizardViewIntent) => void
vi.mock('./view', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./view')>()
  return { ...actual, WizardSurface: (props: Parameters<typeof actual.WizardSurface>[0]) => {
    dispatch = props.onIntent
    return createElement(actual.WizardSurface, props)
  } }
})
function memoryStorage() {
  const values = new Map<string, string>()
  const writes: string[] = []
  return { values, writes, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push(key); values.set(key, value) } }
}
function webLocks() {
  const names: string[] = []
  const provider: PublicLockProvider = { request: async (_name, options, callback) => {
    names.push(_name)
    expect(options).toEqual({ mode: 'exclusive' })
    return callback()
  } }
  return { provider, names }
}

describe('public v8 play session seam', () => {
  it('queues a newer idle trade settlement but not a duplicate blur of the same version', () => {
    const base = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const before = { ...base, tick: 599, player: { ...base.player, tradeSlots: [
      { ...base.player.tradeSlots[0], itemId: 'logs' as const, quantity: 1, unitPrice: 3 },
      base.player.tradeSlots[1], base.player.tradeSlots[2], base.player.tradeSlots[3],
    ] as typeof base.player.tradeSlots } }
    const pendingTravelVersion = 1
    const sold = advancePublicControls(before, [[]], [])
    expect(sold.events.map((event) => event.type)).toContain('trade_listing_sold')
    expect(sold.state.player.coins).toBe(before.player.coins + 3)
    expect(sold.state.player.tradeSlots[0].itemId).toBeNull()
    const settledVersion = publicSaveableVersion(pendingTravelVersion, sold.events)
    expect(publicTravelFlushNeeded(true, settledVersion, pendingTravelVersion)).toBe(true)
    expect(publicTravelFlushNeeded(true, settledVersion, settledVersion)).toBe(false)
    const idle = advancePublicControls(sold.state, [[]], [])
    expect(idle.events).toEqual([])
    expect(publicSaveableVersion(settledVersion, idle.events)).toBe(settledVersion)
  })

  it('renders the supplied world immediately while the no-prop v7 entry stays gated', () => {
    const state = withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))
    const source = commitPublicV7World(memoryStorage(), state, null)
    if (source.status !== 'committed') throw new Error(source.status)
    const session: PublicV8PlayableSession = { start: { state, saveRevision: 3, sourceV7Bytes: source.bytes },
      commit: async () => ({ ok: true, value: { state, saveRevision: 4, sourceV7Bytes: source.bytes } }) }
    const v8 = renderToStaticMarkup(createElement(PublicWizardApp, { v8Session: session }))
    expect(v8).toContain('Public v8 save #3 loaded')
    expect(v8).toContain(`loaded at tick ${state.tick}`)
    expect(v8).toContain('World / Save')
    expect(v8).toContain('.wr-public[data-owner=greenway] .wr-public-panel{right:318px;top:160px;width:min(315px,calc(100vw - 636px))')
    expect(v8).toContain('.wr-public[data-owner=greenway] .wr-public-panel[data-collapsed=false]{inset:8px;width:auto;max-height:none')
    expect(v8).toContain('.wr-public[data-owner=greenway] .wr-public-panel[data-collapsed=true]{left:50%;right:auto;top:124px;transform:translateX(-50%);width:104px')
    expect(v8).toContain('.wr-public-panel[data-collapsed=false]{inset:8px;width:auto;max-height:none')
    expect(v8).not.toContain('Choose how to begin.')
    const v7 = renderToStaticMarkup(createElement(PublicWizardApp))
    expect(v7).toContain('Checking this device for a Wizard Realms save')
    expect(v7).toContain('Choose how to begin.')
    const needsSpade = { ...state, player: { ...state.player, learnedSpellIds: ['wayfinder_glow' as const],
      skillXp: { ...state.player.skillXp, spellcraft: 1 }, position: { ...state.player.position, x: -11, z: 8 } } }
    const bearing = renderToStaticMarkup(createElement(PublicWizardApp, {
      v8Session: { ...session, start: { ...session.start, state: needsSpade } },
    }))
    expect(bearing).toMatch(/class="wr-public-next"[^>]*><strong>Next:<\/strong> Greenway Outfitters: [^.]+\. Buy a field spade\./)
    expect(bearing).not.toContain('line-clamp')
  })
})

describe('public v9 play session', () => {
  function fixture() {
    const storage = memoryStorage()
    storage.values.set(legacyKey, serializeWizardWorld(createGeneratedWorld(seed)))
    const legacy = inspectLegacyImportSource(storage, 'greenway-classic-v1')
    if (legacy.status !== 'available') throw new Error(legacy.status)
    const imported = commitLegacyImportToPublicV6(storage, legacy)
    if (imported.status !== 'committed') throw new Error(imported.status)
    const base = createPublicV7StateFromV6Root(imported.root)
    const tile = worldTileAtGrid(seed, -76, 100)
    const state = { ...withFreshPublicV9Camps(base), movementOwner: 'streamed' as const,
      player: { ...base.player, position: { ...tile.center }, inventory: [...base.player.inventory,
        { itemId: 'logs' as const, quantity: 4 }, { itemId: 'stone' as const, quantity: 1 }] },
      discoveredTileIds: [...new Set([...base.discoveredTileIds, tile.id])].sort() }
    const receipt = { sourceV8Head: encodePublicV8Head(base, imported.root, 3),
      sourceV7Bytes: serializePublicV7World({ schemaVersion: 'wizard-world/v7', state: base,
        saveRevision: 2, bootstrap: imported.root, migrationSourceV6Bytes: JSON.stringify(imported.root) }) }
    return { state, receipt, tile, position: [tile.center.x, tile.center.y, tile.center.z], bootstrap: imported.root }
  }

  it('previews canonical sites without spending and gates selection to an unblocked v9 frontier', () => {
    const f = fixture(), before = JSON.stringify(f.state)
    expect(publicFieldCampView(f.state, f.tile.id, f.receipt, false))
      .toMatchObject({ camps: [], selectionEnabled: true, preview: { tileId: f.tile.id, position: f.position, rejection: null } })
    expect(publicFieldCampView(f.state, null, f.receipt, false).preview).toBeNull()
    expect(JSON.stringify(f.state)).toBe(before)
    expect(publicFieldCampView(f.state, 'tile-0-0', f.receipt, false).preview?.rejection?.code).toBe('invalid_site')
    expect(publicFieldCampView(f.state, f.tile.id, f.receipt, true)).toMatchObject({ selectionEnabled: false, preview: null })
    expect(publicFieldCampView({ ...f.state, movementOwner: 'greenway' }, f.tile.id, f.receipt, false).selectionEnabled).toBe(false)
  })

  it('guides an unbuilt camp from Greenway through the marker to the basin approach', () => {
    const f = fixture()
    const at = (x: number, z: number, movementOwner: 'greenway' | 'streamed' = 'streamed') => ({
      ...f.state, movementOwner, player: { ...f.state.player,
        position: { ...f.state.player.position, x, z } },
    })
    const home = publicFieldCampView(at(0, 0, 'greenway'), null, f.receipt, false)
    const marker = publicFieldCampView(at(-107, 105), null, f.receipt, false)
    const approach = publicFieldCampView(at(-264, 272), null, f.receipt, false)
    expect(home.selectionEnabled).toBe(false)
    expect(home.guidance).toContain('SW of here, about 360 m direct')
    expect(marker.guidance).toContain('SW of here, about 210 m direct')
    expect(approach.guidance).toContain('approach is here')
    for (const view of [home, marker, approach]) {
      expect(view.guidance).toContain('before the fen bridge')
      expect(view.guidance).toContain('4 logs + 1 stone')
      expect(view.guidance).toContain('bridge costs 8 logs')
      expect(view.guidance).toContain('reserve 4 additional logs')
      expect(view.guidance).toContain('⌂ appears on discovered suitable ground')
      expect(view.guidance).not.toMatch(/tile-\d/)
    }
    expect(publicFieldCampView(at(-107, 105), null, f.receipt, true).guidance).toBeNull()
    expect(publicFieldCampView({ ...f.state, fieldCampTileIds: [f.tile.id] }, null, f.receipt, false).guidance).toBeNull()
  })

  it('uses the same secondary camp guidance in the collapsed HUD, controls and expanded map', () => {
    const f = fixture()
    const state = { ...f.state, player: { ...f.state.player,
      position: { ...f.state.player.position, x: -107, z: 105 } } }
    const camp = publicFieldCampView(state, null, f.receipt, false)
    const guidance = camp.guidance!
    const html = renderToStaticMarkup(createElement(PublicWizardApp, { v9Session: {
      start: { state, saveRevision: 7, sourceReceipt: f.receipt },
      commit: async () => ({ ok: false as const, reason: 'source-changed' }),
    } }))
    expect(html.split(guidance)).toHaveLength(3)
    expect(html).toContain(`<strong>Next:</strong> ${mireglassNextObjective(mireglassForPublicView(state)).label}`)
    const projection = publicWorldViewProjection(state, [], null, null, camp)
    const map = renderToStaticMarkup(createElement(WizardMap, { projection, open: true,
      onToggle: () => {}, onIntent: () => {}, buttonRef: createRef<HTMLButtonElement>(),
      closeRef: createRef<HTMLButtonElement>() }))
    expect(map).toContain(guidance)
  })

  it('keeps camp IDs through controls and frontier actions, then exports the actual bootstrap and next v9 revision', () => {
    const f = fixture()
    const placed = applyFieldCampAction(f.state, f.tile.id, f.bootstrap)
    expect(placed.rejection).toBeUndefined()
    const moved = advancePublicControls(placed.state, [[{ type: 'move', delta: { x: 0.1, z: 0 } }]], [])
    expect(moved.rejections).toEqual([])
    expect(moved.events.some((event) => event.type === 'player_moved')).toBe(true)
    const equipped = actPublicMireglass(moved.state, { type: 'equip_item', itemId: 'woodcutters_axe' })
    expect(equipped.rejection).toBeUndefined()
    const next = requirePublicV9State(equipped.state, placed.state)
    expect(next.fieldCampTileIds).toEqual([f.tile.id])
    const bytes = unsavedPublicV9Bytes(next, f.receipt, 7)
    const rescue = parsePublicV9Rescue(bytes!)
    expect(rescue?.schemaVersion).toBe('wizard-world/v9-rescue')
    expect(rescue?.sourceReceipt).toEqual(f.receipt)
    expect(rescue?.snapshot).toMatchObject({ schemaVersion: 'wizard-world/v9', saveRevision: 8, bootstrap: f.bootstrap,
      state: { fieldCampTileIds: [f.tile.id] } })
    expect(publicFieldCampView(next, f.tile.id, f.receipt, false)).toEqual({
      selectionEnabled: false, guidance: null, preview: null, camps: [{ tileId: f.tile.id, position: f.position }] })
    expect(() => requirePublicV9State({ ...next, fieldCampTileIds: [] } as typeof next, next)).toThrow('camp history')
    const ring = mireglassFairyRing(seed)
    const atRing = { ...next, player: { ...next.player, position: ring.tile.center,
      discoveredRingIds: [ring.id, 'ring-greenway'].sort() },
      discoveredTileIds: [...new Set([...next.discoveredTileIds, ring.tile.id])].sort() }
    const home = advancePublicControls(atRing, [[{ type: 'teleport_fairy_ring',
      sourceRingId: ring.id, targetRingId: 'ring-greenway' }]], [])
    expect(home.rejections).toEqual([])
    expect(home.state.movementOwner).toBe('greenway')
    const returned = advancePublicControls(home.state, [[{ type: 'teleport_fairy_ring',
      sourceRingId: 'ring-greenway', targetRingId: ring.id }]], [])
    expect(returned.rejections).toEqual([])
    expect(returned.state.movementOwner).toBe('streamed')
    expect(requirePublicV9State(returned.state, next).fieldCampTileIds).toEqual([f.tile.id])
    expect(unsavedPublicV9Bytes(next, f.receipt, Number.MAX_SAFE_INTEGER)).toBeNull()
    const html = renderToStaticMarkup(createElement(PublicWizardApp, { v9Session: {
      start: { state: next, saveRevision: 7, sourceReceipt: f.receipt },
      commit: async () => ({ ok: false as const, reason: 'source-changed' }),
    } }))
    expect(html).toContain('Public v9 save #7 loaded')
    expect(html).toContain(`loaded at tick ${next.tick}`)
    expect(html).not.toContain('line-clamp')
    expect(html).toContain('overflow:auto;text-align:left;pointer-events:auto')
    expect(html).toContain('.wr-public:has([data-store-panel],.wr-build-preview) .wr-public-panel{display:none}')
    expect(html).toContain('tabindex="0"')
  })

  it('cancels without a save, clears camp selection for routes, and confirms once against the live world', async () => {
    const f = fixture()
    const commit = vi.fn(async () => ({ ok: false as const, reason: 'source-changed' }))
    renderToStaticMarkup(createElement(PublicWizardApp, { v9Session: {
      start: { state: f.state, saveRevision: 7, sourceReceipt: f.receipt }, commit,
    } }))
    const before = JSON.stringify(f.state)
    dispatch({ type: 'field-camp.select', tileId: f.tile.id })
    dispatch({ type: 'field-camp.select', tileId: null })
    dispatch({ type: 'field-camp.confirm', tileId: f.tile.id })
    dispatch({ type: 'field-camp.select', tileId: f.tile.id })
    dispatch({ type: 'build-site.select', siteId: null })
    dispatch({ type: 'field-camp.confirm', tileId: f.tile.id })
    await Promise.resolve()
    expect(commit).not.toHaveBeenCalled()
    expect(JSON.stringify(f.state)).toBe(before)
    dispatch({ type: 'field-camp.select', tileId: f.tile.id })
    dispatch({ type: 'field-camp.confirm', tileId: f.tile.id })
    dispatch({ type: 'field-camp.confirm', tileId: f.tile.id })
    await Promise.resolve()
    expect(commit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fieldCampTileIds: [f.tile.id],
      player: expect.objectContaining({ xp: f.state.player.xp + 30 }) }), 7, f.receipt)
    await Promise.resolve()
    dispatch({ type: 'field-camp.confirm', tileId: f.tile.id })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('uses the v10 camp adapter and keeps terrain plus source receipt in the session rescue', async () => {
    const f = fixture()
    const state = withPublicV10TerrainRevision(f.state)
    const sourceReceipt = { sourceV9Head: encodePublicV9Head(f.state, f.bootstrap, 7),
      sourceV9Lineage: f.receipt }
    const expected = advancePublicWorldV10Frame(state, [{ type: 'move', delta: { x: 0.1, z: 0 } }], f.bootstrap)
    const controls = advancePublicControls(state, [[{ type: 'move', delta: { x: 0.1, z: 0 } }]], [], f.bootstrap)
    expect(controls).toEqual(expected)
    expect(requirePublicV10State(controls.state, state).terrainRevision).toBe('mireglass-cache-pit-v1')
    expect(publicFieldCampView(state, f.tile.id, sourceReceipt, false).preview?.rejection).toBeNull()
    const rescue = parsePublicV10Rescue(unsavedPublicV10Bytes(state, sourceReceipt, 7)!)
    expect(rescue?.snapshot).toMatchObject({ schemaVersion: 'wizard-world/v10', saveRevision: 8,
      state: { terrainRevision: 'mireglass-cache-pit-v1' } })
    expect(rescue?.sourceReceipt).toEqual(sourceReceipt)
    const commit = vi.fn(async () => ({ ok: false as const, reason: 'source-changed' }))
    const html = renderToStaticMarkup(createElement(PublicWizardApp, { v10Session: {
      start: { state, saveRevision: 7, sourceReceipt }, commit,
    } }))
    expect(html).toContain('Public v10 save #7 loaded')
    dispatch({ type: 'field-camp.select', tileId: f.tile.id })
    dispatch({ type: 'field-camp.confirm', tileId: f.tile.id })
    await Promise.resolve()
    expect(commit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      terrainRevision: 'mireglass-cache-pit-v1', fieldCampTileIds: [f.tile.id],
    }), 7, sourceReceipt)
  })

  it('routes a v10 frontier equipment action through its validated save session', async () => {
    const f = fixture()
    const state = withPublicV10TerrainRevision(f.state)
    const sourceReceipt = { sourceV9Head: encodePublicV9Head(f.state, f.bootstrap, 7),
      sourceV9Lineage: f.receipt }
    const commit = vi.fn(async () => ({ ok: false as const, reason: 'source-changed' }))
    renderToStaticMarkup(createElement(PublicWizardApp, { v10Session: {
      start: { state, saveRevision: 7, sourceReceipt }, commit,
    } }))
    dispatch({ type: 'equipment.equip', stackId: 'inventory-woodcutters_axe', slot: 'mainHand' })
    await Promise.resolve()
    expect(commit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      terrainRevision: 'mireglass-cache-pit-v1', player: expect.objectContaining({
        equipment: expect.objectContaining({ mainHand: 'woodcutters_axe' }),
      }),
    }), 7, sourceReceipt)
  })

  it('routes v11 frames and quarry extraction through the distinct v11 save session', async () => {
    const f = fixture()
    const v10 = withPublicV10TerrainRevision(f.state)
    const v10Receipt = { sourceV9Head: encodePublicV9Head(f.state, f.bootstrap, 7),
      sourceV9Lineage: f.receipt }
    const sourceReceipt = { sourceV10Head: encodePublicV10Head(v10, f.bootstrap, 7),
      sourceV10Lineage: v10Receipt }
    const node = highlandStoneNodes(f.state.seed)[0]
    const base = withPublicV11Highland(v10)
    const state = { ...base, movementOwner: 'streamed' as const,
      player: { ...base.player, position: { ...node.tile.center }, equipment: {
        ...base.player.equipment, mainHand: 'field_spade' as const },
        inventory: [...base.player.inventory, { itemId: 'field_spade' as const, quantity: 1 }],
        skillXp: { ...base.player.skillXp, excavation: 30 } },
      discoveredTileIds: [...new Set([...base.discoveredTileIds, node.tile.id])].sort(),
      highland: { ...base.highland, landmarkDiscovered: true } }
    const controls = advancePublicControls(state, [[]], [], f.bootstrap)
    expect(requirePublicV11State(controls.state, state).highlandContentRevision).toBe('highland-quarry-v1')
    expect(requirePublicV11State(controls.state).highland).toEqual(state.highland)
    const rescue = parsePublicV11Rescue(unsavedPublicV11Bytes(state, sourceReceipt, 7)!)
    expect(rescue?.snapshot).toMatchObject({ schemaVersion: 'wizard-world/v11', saveRevision: 8,
      state: { highlandContentRevision: 'highland-quarry-v1' } })
    expect(rescue?.sourceReceipt).toEqual(sourceReceipt)
    const commit = vi.fn(async () => ({ ok: false as const, reason: 'source-changed' }))
    const html = renderToStaticMarkup(createElement(PublicWizardApp, { v11Session: {
      start: { state, saveRevision: 7, sourceReceipt }, commit,
    } }))
    expect(html).toContain('Public v11 save #7 loaded')
    expect(html).toContain('Highland')
    dispatch({ type: 'highland.extract', nodeId: node.id })
    await Promise.resolve()
    expect(commit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      highlandContentRevision: 'highland-quarry-v1',
      highland: expect.objectContaining({ stoneNodes: expect.arrayContaining([
        expect.objectContaining({ id: node.id, readyAtTick: state.tick + 3000 }),
      ]) }),
      player: expect.objectContaining({ skillXp: expect.objectContaining({ excavation: 50 }) }),
    }), 7, sourceReceipt)
    const interactCommit = vi.fn(async () => ({ ok: false as const, reason: 'source-changed' }))
    renderToStaticMarkup(createElement(PublicWizardApp, { v11Session: {
      start: { state, saveRevision: 7, sourceReceipt }, commit: interactCommit,
    } }))
    dispatch({ type: 'interact' })
    await Promise.resolve()
    expect(interactCommit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      highland: expect.objectContaining({ stoneNodes: expect.arrayContaining([
        expect.objectContaining({ id: node.id, readyAtTick: state.tick + 3000 }),
      ]) }),
    }), 7, sourceReceipt)
    const equipCommit = vi.fn(async () => ({ ok: false as const, reason: 'source-changed' }))
    const unequipped = { ...state, player: { ...state.player,
      equipment: { ...state.player.equipment, mainHand: null } } }
    renderToStaticMarkup(createElement(PublicWizardApp, { v11Session: {
      start: { state: unequipped, saveRevision: 7, sourceReceipt }, commit: equipCommit,
    } }))
    dispatch({ type: 'equipment.equip', stackId: 'inventory-field_spade', slot: 'mainHand' })
    await Promise.resolve()
    expect(equipCommit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      player: expect.objectContaining({ equipment: expect.objectContaining({ mainHand: 'field_spade' }) }),
    }), 7, sourceReceipt)
  })

  it('keeps the bounded fen detour visible after its outer bank enters wilderness', () => {
    const f = fixture()
    const v10 = withPublicV10TerrainRevision(f.state)
    const sourceReceipt = { sourceV10Head: encodePublicV10Head(v10, f.bootstrap, 7),
      sourceV10Lineage: { sourceV9Head: encodePublicV9Head(f.state, f.bootstrap, 7),
        sourceV9Lineage: f.receipt } }
    const tile = worldTileAtGrid(seed, -63, 94)
    const base = withPublicV11Highland(v10)
    const state = { ...base, player: { ...base.player, position: { ...tile.center } },
      discoveredTileIds: [...new Set([...base.discoveredTileIds, tile.id])].sort() }
    expect(classifyStreamedRegion(seed, state.player.position)).toBe('wilderness')
    const html = renderToStaticMarkup(createElement(PublicWizardApp, { v11Session: {
      start: { state, saveRevision: 7, sourceReceipt },
      commit: vi.fn(async () => ({ ok: false as const, reason: 'source-changed' })),
    } }))
    expect(html).toContain('move N outside its edge')
    expect(html).not.toContain('Gather marsh herb')
    let northZ = Infinity
    for (let x = -448; x <= -256; x += WORLD_CELL_METERS) {
      northZ = Math.min(northZ, mireglassFenRowAt(seed, x))
    }
    northZ -= 2 * WORLD_CELL_METERS
    const northTile = worldTileAtGrid(seed, -63, northZ / WORLD_CELL_METERS)
    const northState = { ...state, player: { ...state.player, position: { ...northTile.center } },
      discoveredTileIds: [...new Set([...state.discoveredTileIds, northTile.id])].sort() }
    expect(classifyStreamedRegion(seed, northState.player.position)).toBe('wilderness')
    const northHtml = renderToStaticMarkup(createElement(PublicWizardApp, { v11Session: {
      start: { state: northState, saveRevision: 7, sourceReceipt },
      commit: vi.fn(async () => ({ ok: false as const, reason: 'source-changed' })),
    } }))
    expect(northHtml).toContain('Turn W')
    expect(northHtml).not.toContain('Gather marsh herb')
  })
})

describe('public v6 app boundary', () => {
  it('renders the public shop sale as player-facing feedback', () => {
    expect(publicWorldEventText({ type: 'store_item_sold', storeId: 'store-greenway',
      itemId: 'ancient_relic', quantity: 1, unitPrice: 25, totalPrice: 25,
      tick: 1, sequence: 1 })).toBe('Sold 1 Ancient relic for 25g.')
  })
  it('keeps a spell reveal visible after tile and skill events', () => {
    const result: PublicWorldAdvanceResult = { state: createFreshPublicWorld(seed, 'greenway-classic-v1'),
      events: [
        { type: 'spell_cast', spellId: 'wayfinder_glow', revealedTileIds: ['tile-a', 'tile-b'],
          revealedDigSiteIds: ['ridge_cache'], tick: 1, sequence: 1 },
        ...Array.from({ length: 8 }, (_, index) => ({ type: 'tile_discovered' as const,
          tileId: `tile-${index}`, tick: 1, sequence: index + 2 })),
        { type: 'skill_xp_gained', skillId: 'wayfinding', xp: 80, tick: 1, sequence: 10 },
        { type: 'skill_xp_gained', skillId: 'spellcraft', xp: 80, tick: 1, sequence: 11 },
      ], rejections: [] }
    expect(publicFrameMessages(result).at(-1)).toContain('Wayfinder Glow reveals 2 map tiles and 1 buried site')
    expect(publicFrameMessages(result)).not.toContain('The map reveals a new tile.')
  })
  it('keeps projection messages stable across repeated blocked frames while preserving new feedback', () => {
    const state = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const blocked: PublicWorldAdvanceResult = { state, events: [], rejections: [{ intentIndex: 0,
      intentType: 'move', code: 'fen_channel', message: 'Streamed movement was rejected: fen_channel.' }] }
    const first = appendMessages(['Welcome'], publicFrameMessages(blocked), true)
    expect(first.at(-1)).toBe('The fen channel needs a bridge. Build the Fen bridge from a marked bank (8 logs), then use its Cross action.')
    let repeated = first
    for (let frame = 0; frame < 20; frame += 1) repeated = appendMessages(repeated, publicFrameMessages(blocked), true)
    expect(repeated).toBe(first)

    const bridgeBuilt = { ...state, mireglass: { ...state.mireglass, builtRoutes: {
      ...state.mireglass.builtRoutes, bridge: 'built-fen-bridge' } } }
    const builtText = publicFrameMessages({ ...blocked, state: bridgeBuilt })[0]
    expect(builtText).toBe('The fen channel cannot be swum across. Use “Cross Fen bridge” (or “Return by Fen bridge” from the far bank) when in reach.')

    const changed = appendMessages(first, publicFrameMessages({ ...blocked, rejections: [{ ...blocked.rejections[0],
      code: 'slate_cliff', message: 'Streamed movement was rejected: slate_cliff.' }] }), true)
    expect(changed).not.toBe(first)
    expect(changed.at(-1)).toBe('The slate cliff needs a ladder. Build the Slate ladder from its marked base (4 logs), then use its Cross action.')
    const ladderBuilt = { ...bridgeBuilt, mireglass: { ...bridgeBuilt.mireglass, builtRoutes: {
      ...bridgeBuilt.mireglass.builtRoutes, ladder: 'built-slate-ladder' } } }
    expect(publicFrameMessages({ ...blocked, state: ladderBuilt, rejections: [{ ...blocked.rejections[0],
      code: 'slate_cliff', message: 'Streamed movement was rejected: slate_cliff.' }] })[0])
      .toBe('The slate cliff cannot be walked up. Use “Cross Slate ladder” (or “Return by Slate ladder” from above) when in reach.')
    const action = appendMessages(changed, ['Chopped timber: +4 logs and woodcutting XP.'])
    expect(appendMessages(action, ['Chopped timber: +4 logs and woodcutting XP.'])).not.toBe(action)
  })
  it('names the actual Greenway area after crossing a route', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    expect(publicAreaTitle(fresh)).toBe('Greenway')
    const ridge = { ...fresh, player: { ...fresh.player, position: { ...fresh.player.position, x: 0, z: -8 } } }
    expect(publicAreaTitle(ridge)).toBe('Northern Ridge')
    const highland = { ...ridge, player: { ...ridge.player, position: { ...ridge.player.position, x: 6 } } }
    expect(publicAreaTitle(highland)).toBe('Eastern Highland')
    expect(publicAreaTitle({ ...ridge, movementOwner: 'streamed' })).toBe('Mireglass Reach')
  })
  it('announces the region boundary instead of retaining an unrelated old message', () => {
    const greenway = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const mireglass = { ...greenway, movementOwner: 'streamed' as const }
    expect(publicRegionTransitionText(greenway, mireglass)).toContain('Entered Mireglass Reach')
    expect(publicRegionTransitionText(mireglass, greenway)).toBe('Returned to Greenway.')
    expect(publicRegionTransitionText(greenway, greenway)).toBeNull()
  })
  it('offers Bell Alder gathering only for an in-reach available v7 patch', () => {
    const patch = mireglassHerbPatches(seed)[0]
    const fresh = withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))
    expect(publicHerbChoices(fresh)).toEqual([])
    expect(publicHerbRouteHint(fresh)).toContain('Bell Alder')
    const near = { ...fresh, movementOwner: 'streamed' as const,
      player: { ...fresh.player, position: { ...patch.tile.center } },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds, patch.tile.id])].sort() }
    expect(publicHerbChoices(near)).toMatchObject([{ label: 'Gather marsh herb',
      action: { type: 'forage_herb', patchId: patch.id } }])
    expect(publicHerbRouteHint(near)).toBe('Gather the dry Bell Alder marsh herb here, then bring it to Greenway.')
    const picked = actPublicMireglass(near, { type: 'forage_herb', patchId: patch.id })
    expect(picked.rejection).toBeUndefined()
    expect(publicHerbChoices(picked.state)).toEqual([])
    expect(publicHerbRouteHint(picked.state)).toContain('Greenway Outfitters')
    expect(publicHerbGuidancePriority(picked.state, false)).toBe(true)
    expect(publicHerbGuidancePriority({ ...picked.state, movementOwner: 'greenway' }, false)).toBe(true)
    expect(publicHerbGuidancePriority(fresh, false)).toBe(false)
    expect(publicHerbChoices({ ...picked.state, tick: 6_000 })).toHaveLength(1)
  })

  it('routes Bell Alder guidance down the built Slate ladder from the upper shelf', () => {
    const fresh = withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))
    const ladder = mireglassRouteSites(seed).filter((site) => site.kind === 'ladder')
      .sort((a, b) => Math.hypot(a.to.x + 372, a.to.z - 428)
        - Math.hypot(b.to.x + 372, b.to.z - 428))[0]
    const bridge = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const built = { ...fresh, movementOwner: 'streamed' as const,
      mireglass: { ...fresh.mireglass, builtRoutes: { bridge: bridge.id, ladder: ladder.id } } }
    const positionAt = (x: number, z: number) => ({ x, z,
      y: worldTileAtGrid(seed, Math.ceil(x / WORLD_CELL_METERS - 0.5),
        Math.ceil(z / WORLD_CELL_METERS - 0.5)).center.y })
    for (const [x, z] of [[-387.4, 447], [-358, 466]]) {
      const upper = { ...built, player: { ...built.player, position: positionAt(x, z) } }
      const hint = publicHerbRouteHint(upper)
      expect(hint).toContain('built Slate ladder')
      expect(hint).toContain('Return by Slate ladder')
      expect(hint).not.toMatch(/Find a dry Bell Alder herb patch .* m direct/)
      expect(publicHerbMapGuidance('Expedition complete.', true, hint)).toBe(`Next: ${hint}`)
      const carrying = { ...upper, player: { ...upper.player,
        inventory: [...upper.player.inventory, { itemId: 'marsh_herb' as const, quantity: 1 }] } }
      expect(publicHerbRouteHint(carrying)).toContain('built Slate ladder')
      expect(publicHerbRouteHint(carrying)).toContain('Return by Slate ladder')
      expect(publicHerbRouteHint(carrying)).not.toContain('Fen bridge')
    }

    const atTop = { ...built, player: { ...built.player, position: { ...ladder.to } } }
    expect(publicHerbRouteHint(atTop)).toContain('“Return by Slate ladder” here')
    const carryingAtTop = { ...atTop, player: { ...atTop.player,
      inventory: [...atTop.player.inventory, { itemId: 'marsh_herb' as const, quantity: 1 }] } }
    expect(publicHerbRouteHint(carryingAtTop)).toContain('“Return by Slate ladder” here')
    const descent = mireglassActionChoices(mireglassForPublicView(atTop))
      .find((choice) => choice.label === 'Return by Slate ladder')
    expect(descent?.action).toEqual({ type: 'traverse_route', siteId: ladder.id, from: 'to' })
    const descended = actPublicMireglass(atTop, descent!.action)
    expect(descended.rejection).toBeUndefined()
    expect(descended.state.player.position).toEqual(ladder.from)
    expect(publicHerbRouteHint(descended.state)).toContain('Return by Fen bridge')
    const carryingDescended = actPublicMireglass(carryingAtTop, descent!.action)
    expect(carryingDescended.rejection).toBeUndefined()
    expect(publicHerbRouteHint(carryingDescended.state)).toContain('Return by Fen bridge')

    const patch = mireglassHerbPatches(seed)[0]
    const atPatch = { ...descended.state,
      player: { ...descended.state.player, position: { ...patch.tile.center } } }
    expect(publicHerbChoices(atPatch)[0]?.action).toEqual({ type: 'forage_herb', patchId: patch.id })
    expect(publicHerbRouteHint(atPatch)).toBe('Gather the dry Bell Alder marsh herb here, then bring it to Greenway.')
    expect(publicHerbRouteHint({ ...atTop, mireglass: fresh.mireglass })).toMatch(/ m direct, then bring it to Greenway\.$/)
    expect(publicHerbRouteHint(createFreshPublicWorld(seed, 'greenway-classic-v1'))).toBeNull()
  })

  it('routes Bell Alder trips through the built Fen bridge from either bank', () => {
    const fresh = withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))
    const bridge = mireglassRouteSites(seed).filter((site) => site.kind === 'bridge')
      .sort((a, b) => Math.abs(a.to.x + 344) - Math.abs(b.to.x + 344))[0]
    const built = { ...fresh, movementOwner: 'streamed' as const,
      mireglass: { ...fresh.mireglass, builtRoutes: { ...fresh.mireglass.builtRoutes, bridge: bridge.id } } }
    const positionAt = (x: number, z: number) => ({ x, z,
      y: worldTileAtGrid(seed, Math.ceil(x / WORLD_CELL_METERS - 0.5),
        Math.ceil(z / WORLD_CELL_METERS - 0.5)).center.y })
    for (const [x, z] of [[-345.5, 366.1], [-338.1, 368.3]]) {
      const south = { ...built, player: { ...built.player, position: positionAt(x, z) } }
      const hint = publicHerbRouteHint(south)
      expect(hint).toMatch(/built Fen bridge|“Return by Fen bridge” here/)
      expect(hint).toContain('Return by Fen bridge')
      expect(hint).not.toMatch(/Find a dry Bell Alder herb patch .* m direct/)
      expect(publicHerbMapGuidance('Expedition complete.', true, hint)).toBe(`Next: ${hint}`)
      const carrying = { ...south, player: { ...south.player,
        inventory: [...south.player.inventory, { itemId: 'marsh_herb' as const, quantity: 1 }] } }
      expect(publicHerbRouteHint(carrying)).toContain('Return by Fen bridge')
    }

    const atSouthEnd = { ...built, player: { ...built.player, position: { ...bridge.to } } }
    expect(publicHerbRouteHint(atSouthEnd)).toContain('“Return by Fen bridge” here')
    const crossing = mireglassActionChoices(mireglassForPublicView(atSouthEnd))
      .find((choice) => choice.label === 'Return by Fen bridge')
    expect(crossing?.action).toEqual({ type: 'traverse_route', siteId: bridge.id, from: 'to' })
    const crossed = actPublicMireglass(atSouthEnd, crossing!.action)
    expect(crossed.rejection).toBeUndefined()
    expect(crossed.state.player.position).toEqual(bridge.from)
    expect(mireglassActionChoices(mireglassForPublicView(crossed.state))
      .find((choice) => choice.label === 'Cross Fen bridge')?.action)
      .toEqual({ type: 'traverse_route', siteId: bridge.id, from: 'from' })
    expect(publicHerbRouteHint(crossed.state)).toMatch(/^Find a dry Bell Alder herb patch /)

    const patch = mireglassHerbPatches(seed)[0]
    const atPatch = { ...crossed.state,
      player: { ...crossed.state.player, position: { ...patch.tile.center } } }
    expect(publicHerbChoices(atPatch)[0]?.action).toEqual({ type: 'forage_herb', patchId: patch.id })
    const carryingNorth = { ...atPatch, player: { ...atPatch.player,
      inventory: [...atPatch.player.inventory, { itemId: 'marsh_herb' as const, quantity: 1 }] } }
    expect(publicHerbRouteHint(carryingNorth)).toBe('Take 1 marsh herb back to Greenway Outfitters to sell for 3g each.')
    const carryingSouth = { ...atSouthEnd, player: { ...atSouthEnd.player,
      inventory: [...atSouthEnd.player.inventory, { itemId: 'marsh_herb' as const, quantity: 1 }] } }
    expect(publicHerbRouteHint(carryingSouth)).toContain('“Return by Fen bridge” here')
    const returned = actPublicMireglass(carryingSouth,
      { type: 'traverse_route', siteId: bridge.id, from: 'to' })
    expect(returned.rejection).toBeUndefined()
    expect(returned.state.player.position).toEqual(bridge.from)
    expect(publicHerbRouteHint(returned.state)).toBe('Take 1 marsh herb back to Greenway Outfitters to sell for 3g each.')

    expect(publicHerbRouteHint({ ...atSouthEnd, mireglass: fresh.mireglass }))
      .toMatch(/ m direct, then bring it to Greenway\.$/)
    expect(publicHerbRouteHint({ ...carryingNorth, movementOwner: 'greenway' }))
      .toBe('Take 1 marsh herb back to Greenway Outfitters to sell for 3g each.')
  })

  it('keeps the indicated south-bank approach dry for every built bridge site', () => {
    const fresh = withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))
    const bridges = mireglassRouteSites(seed).filter((site) => site.kind === 'bridge')
    const patch = mireglassHerbPatches(seed)[0]
    const walkIsDry = (from: { x: number; z: number }, to: { x: number; z: number }) => {
      const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z))
      for (let step = 0; step < steps; step += 1) {
        const a = { x: from.x + (to.x - from.x) * step / steps,
          z: from.z + (to.z - from.z) * step / steps }
        const b = { x: from.x + (to.x - from.x) * (step + 1) / steps,
          z: from.z + (to.z - from.z) * (step + 1) / steps }
        expect(mireglassMoveBarrier(seed, a, b)).toBeNull()
      }
    }
    const positionAt = (x: number, z: number) => ({ x, z,
      y: worldTileAtGrid(seed, Math.ceil(x / WORLD_CELL_METERS - 0.5),
        Math.ceil(z / WORLD_CELL_METERS - 0.5)).center.y })
    for (const [x, z] of [[-345.5, 366.1], [-338.1, 368.3]]) for (const bridge of bridges) {
      const state = { ...fresh, movementOwner: 'streamed' as const,
        mireglass: { ...fresh.mireglass, builtRoutes: { ...fresh.mireglass.builtRoutes, bridge: bridge.id } },
        player: { ...fresh.player, position: positionAt(x, z) } }
      const startX = Math.ceil(x / WORLD_CELL_METERS - 0.5) * WORLD_CELL_METERS
      let safeZ = -Infinity
      for (let gridX = Math.min(startX, bridge.to.x) - WORLD_CELL_METERS;
        gridX <= Math.max(startX, bridge.to.x); gridX += WORLD_CELL_METERS) {
        safeZ = Math.max(safeZ, mireglassFenRowAt(seed, gridX))
      }
      safeZ += 2 * WORLD_CELL_METERS
      walkIsDry({ x, z }, { x, z: safeZ })
      walkIsDry({ x, z: safeZ }, { x: bridge.to.x, z: safeZ })
      walkIsDry({ x: bridge.to.x, z: safeZ }, bridge.to)
      let northZ = Infinity
      for (let gridX = Math.min(bridge.from.x, patch.tile.center.x) - WORLD_CELL_METERS;
        gridX <= Math.max(bridge.from.x, patch.tile.center.x); gridX += WORLD_CELL_METERS) {
        northZ = Math.min(northZ, mireglassFenRowAt(seed, gridX))
      }
      northZ -= 2 * WORLD_CELL_METERS
      walkIsDry(bridge.from, { x: bridge.from.x, z: northZ })
      walkIsDry({ x: bridge.from.x, z: northZ }, { x: patch.tile.center.x, z: northZ })
      walkIsDry({ x: patch.tile.center.x, z: northZ }, patch.tile.center)
      const first = publicHerbRouteHint(state)
      expect(first, bridge.id).toContain('Return by Fen bridge')
      if (Math.hypot(x - bridge.to.x, z - bridge.to.z) > 3) {
        expect(first, bridge.id).toMatch(/Move S .*dry route along the south bank/)
        const corridor = { ...state, player: { ...state.player, position: positionAt(x, safeZ) } }
        expect(publicHerbRouteHint(corridor), bridge.id).toMatch(/Follow the dry south bank [EW]/)
      }
      for (const offset of [-0.9, 0, 0.9]) {
        walkIsDry({ x: bridge.to.x + offset, z: safeZ }, bridge.to)
        const aligned = { ...state, player: { ...state.player,
          position: positionAt(bridge.to.x + offset, safeZ) } }
        expect(publicHerbRouteHint(aligned), bridge.id).toContain('Approach the built Fen bridge N')
      }
    }
  })

  it('guides a player behind the deep back channel around its dry outer edge', () => {
    const fresh = withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))
    const bridge = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const positionAt = (x: number, z: number) => ({ x, z,
      y: worldTileAtGrid(seed, Math.ceil(x / WORLD_CELL_METERS - 0.5),
        Math.ceil(z / WORLD_CELL_METERS - 0.5)).center.y })
    const behind = { ...fresh, movementOwner: 'streamed' as const,
      mireglass: { ...fresh.mireglass, builtRoutes: { ...fresh.mireglass.builtRoutes, bridge: bridge.id } },
      player: { ...fresh.player, position: positionAt(-344, 520) } }
    expect(mireglassMoveBarrier(seed, { x: -344, z: 520 }, { x: -344, z: 516 }))
      .toBe('fen_channel')
    expect(publicHerbRouteHint(behind)).toContain('deep back channel')
    expect(publicHerbRouteHint(behind)).toContain('Move E')
    const carrying = { ...behind, player: { ...behind.player,
      inventory: [...behind.player.inventory, { itemId: 'marsh_herb' as const, quantity: 1 }] } }
    expect(publicHerbRouteHint(carrying)).toContain('deep back channel')

    const east = { ...behind, player: { ...behind.player, position: positionAt(-252, 520) } }
    expect(publicHerbRouteHint(east)).toContain('move N')
    let northZ = Infinity
    for (let x = -448; x <= -256; x += WORLD_CELL_METERS) {
      northZ = Math.min(northZ, mireglassFenRowAt(seed, x))
    }
    northZ -= 2 * WORLD_CELL_METERS
    const north = { ...east, player: { ...east.player, position: positionAt(-252, northZ) } }
    expect(publicHerbRouteHint(north)).toContain('Turn W')
    const inside = { ...north, player: { ...north.player, position: positionAt(-256, northZ) } }
    expect(publicHerbRouteHint(inside)).toMatch(/^Find a dry Bell Alder herb patch /)
    const far = { ...behind, player: { ...behind.player, position: positionAt(700, 500) } }
    expect(publicHerbRouteHint(far)).toMatch(/^Find a dry Bell Alder herb patch /)
    expect(publicHerbRouteHint({ ...carrying, player: { ...carrying.player, position: far.player.position } }))
      .toBe('Take 1 marsh herb back to Greenway Outfitters to sell for 3g each.')

    const patch = mireglassHerbPatches(seed)[0]
    const path = [{ x: -344, z: 520 }, { x: -252, z: 520 },
      { x: -252, z: northZ }, patch.tile.center]
    for (let leg = 0; leg < path.length - 1; leg += 1) {
      const from = path[leg], to = path[leg + 1]
      const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z))
      for (let step = 0; step < steps; step += 1) {
        const a = { x: from.x + (to.x - from.x) * step / steps,
          z: from.z + (to.z - from.z) * step / steps }
        const b = { x: from.x + (to.x - from.x) * (step + 1) / steps,
          z: from.z + (to.z - from.z) * (step + 1) / steps }
        expect(mireglassMoveBarrier(seed, a, b)).toBeNull()
      }
    }
  })

  it('keeps the map aligned with the herb route after the seal expedition is complete', () => {
    expect(publicHerbMapGuidance('Expedition complete.', true, 'Find a Bell Alder patch SW, about 40 m direct.'))
      .toBe('Next: Find a Bell Alder patch SW, about 40 m direct.')
    expect(publicHerbMapGuidance('Expedition complete.', false, 'Find a Bell Alder patch.'))
      .toBe('Expedition complete.')
    expect(publicHerbMapGuidance('Expedition complete.', true, null)).toBe('Expedition complete.')
  })

  it('shows authored Greenway purchase feedback instead of an event type label', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const store = fresh.greenway.stores[0]
    const atStore = { ...fresh, player: { ...fresh.player, position: { ...store.position } } }
    const bought = advancePublicWorldFrame(atStore, [{ type: 'buy_store_listing',
      storeId: store.id, listingId: store.listings.find((listing) => listing.itemId === 'field_spade')!.id }])
    expect(bought.rejections).toEqual([])
    expect(bought.events.map(publicWorldEventText)).toContain('Purchased Field spade.')
    expect(publicWorldEventText({ type: 'item_unequipped', itemId: 'mireglass_reach/item/waders',
      slot: 'feet', tick: 1, sequence: 1 })).toBe('Unequipped Fen waders.')
  })
  it('holds first Greenway entry behind an explicit start and resumes its validated root', async () => {
    const storage = memoryStorage()
    const { provider, names } = webLocks()
    const entry = await inspectPublicEntry(storage, provider)
    expect(entry.ok && entry.value.root.status).toBe('missing')
    expect(storage.writes).toEqual([])
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.value.state.movementOwner).toBe('greenway')
    expect(loadPublicV6Root(storage).status).toBe('valid-playable')
    const resumed = await resumePublicWorld(storage, provider, started.value.bytes)
    expect(resumed).toEqual(started)
    expect(names.every((name) => name === PUBLIC_V6_LOCK_NAME)).toBe(true)
    expect(storage.writes).not.toContain(legacyKey)
  })

  it('imports a legacy Greenway only after selection and never rewrites v5 bytes', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    const legacy = createGeneratedWorld(seed, 'greenway-classic-v1')
    legacy.player.coins = 77
    const bytes = serializeWizardWorld(legacy)
    storage.values.set(legacyKey, bytes)
    const entry = await inspectPublicEntry(storage, provider)
    expect(entry.ok).toBe(true)
    if (!entry.ok || entry.value.classic.status !== 'available') return
    expect(storage.writes).toEqual([])
    const imported = await importPublicWorld(storage, provider, entry.value.classic)
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.value.state.player.coins).toBe(77)
    expect(storage.getItem(legacyKey)).toBe(bytes)
    expect(storage.writes).not.toContain(legacyKey)
    const root = loadPublicV6Root(storage)
    expect(root.status).toBe('valid-playable')
    if (root.status === 'valid-playable') expect(root.root.bootstrap?.source.bytes).toBe(bytes)
  })

  it('requires explicit confirmation for a new world when any legacy save exists', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    storage.values.set(legacyKey, serializeWizardWorld(createGeneratedWorld(seed)))
    const denied = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(denied).toEqual({ ok: false, reason: 'legacy-present' })
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBeNull()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', true)
    expect(started.ok).toBe(true)
    expect(storage.writes).not.toContain(legacyKey)
  })

  it('keeps Greenway UI actions separate from one sampled look-and-move frame', () => {
    const state = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const equip = intentForView(greenwayForPublicView(state),
      { type: 'equipment.equip', stackId: 'inventory-woodcutters_axe', slot: 'mainHand' })
    expect(equip).toEqual({ type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' })
    const result = advancePublicControls(state, [[equip!]], [[-1, 1]])
    expect(result.rejections).toEqual([])
    expect(result.state.player.equipment.mainHand).toBe('woodcutters_axe')
    expect(result.state.tick).toBe(state.tick + 2)
    expect(result.events.map((event) => event.type)).toEqual(expect.arrayContaining(['item_equipped', 'player_looked', 'player_moved']))
    expect(result.state.player.position).not.toEqual(state.player.position)
  })

  it('commits a queued action even when blur arrives before the next movement sample', () => {
    const state = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const result = advancePublicControls(state,
      [[{ type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' }]], [])
    expect(result.rejections).toEqual([])
    expect(result.events.map((event) => event.type)).toContain('item_equipped')
    expect(result.state.player.equipment.mainHand).toBe('woodcutters_axe')
    expect(result.state.tick).toBe(state.tick + 1)
  })

  it('uses timestamped Mireglass movement and authoritative nearby action results', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const marker = mireglassAnchors(seed).fringeMarker.tile
    const state = { ...fresh, movementOwner: 'streamed' as const,
      player: { ...fresh.player, position: { ...marker.center } },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds, marker.id])].sort() }
    const choice = mireglassActionChoices(mireglassForPublicView(state))
      .find((candidate) => candidate.action.type === 'study_fringe_marker')
    expect(choice).toBeDefined()
    const studied = actPublicMireglass(state, choice!.action)
    expect(studied.event?.type).toBe('fringe_marker_studied')
    const sampler = createTimedMovementSampler(0)
    const clock = createFixedInputClock(0)
    recordTimedMovement(sampler, 10, [1, 0])
    recordTimedMovement(sampler, 210, [0, 0])
    const samples = sampleFixedInputBatch(sampler, clock, 1_200, 50, 12)
    const turned = advancePublicControls(studied.state, [], samples)
    expect(turned.rejections).toEqual([])
    expect(turned.state.movementOwner).toBe('streamed')
    expect(turned.state.player.yaw).toBeCloseTo(studied.state.player.yaw - 0.52)
    expect(turned.state.tick).toBe(studied.state.tick + 12)
    const walked = advancePublicControls(studied.state, [], [[0, 1]])
    expect(walked.rejections).toEqual([])
    expect(walked.events.map((event) => event.type)).toContain('player_moved')
    expect(walked.state.player.position).not.toEqual(studied.state.player.position)
  })

  it('blocks stale cross-tab saves and unsupported Web Locks without touching v5', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const stepped = advancePublicControls(started.value.state, [], [[0, 1]])
    const current = await commitPublicSnapshot(storage, provider, stepped.state, started.value.bytes)
    expect(current.ok).toBe(true)
    const stale = await commitPublicSnapshot(storage, provider, stepped.state, started.value.bytes)
    expect(stale).toEqual({ ok: false, reason: 'root-changed' })
    const noLocks = await commitPublicSnapshot(storage, undefined, stepped.state,
      current.ok ? current.value.bytes : started.value.bytes)
    expect(noLocks.ok).toBe(false)
    expect(storage.writes).not.toContain(legacyKey)
  })

  it('exports a valid standalone snapshot of unsaved progress without changing storage or state', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const progressed = advancePublicControls(started.value.state, [], [[0, 1]]).state
    const beforeState = JSON.stringify(progressed)
    const beforeWrites = [...storage.writes]
    const exported = unsavedPublicWorldBytes(progressed, started.value.bytes)
    const parsed = exported ? parsePublicV6PlayableRoot(exported) : null
    expect(parsed?.state).toEqual(progressed)
    expect(parsed?.saveRevision).toBe(1)
    expect(storage.writes).toEqual(beforeWrites)
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(started.value.bytes)
    expect(JSON.stringify(progressed)).toBe(beforeState)
    expect(unsavedPublicWorldBytes(progressed, null)).toBeNull()
    expect(unsavedPublicWorldBytes(progressed, '{invalid root')).toBeNull()
  })

  it('preserves a pending stage and refuses to resume or import across it', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    storage.values.set('wizard-realms:world:v6:stage', 'unfinished-other-save')
    const resumed = await resumePublicWorld(storage, provider, started.value.bytes)
    expect(resumed).toEqual({ ok: false, reason: 'pending-stage' })
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(started.value.bytes)
    expect(storage.getItem('wizard-realms:world:v6:stage')).toBe('unfinished-other-save')
  })

  it('offers validated pending stage and committed root as explicit choices, then archives before promoting stage', async () => {
    const storage = memoryStorage()
    const { provider, names } = webLocks()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const root = loadPublicV6Root(storage)
    expect(root.status).toBe('valid-playable')
    if (root.status !== 'valid-playable') return
    const moved = advancePublicControls(root.root.state, [], [[0, 1]])
    const stagedBytes = serializePublicV6World({ schemaVersion: PUBLIC_V6_SCHEMA,
      saveRevision: root.root.saveRevision + 1, bootstrap: root.root.bootstrap, state: moved.state })
    storage.values.set(PUBLIC_V6_STAGE_KEY, stagedBytes)
    const entry = await inspectPublicEntry(storage, provider)
    expect(entry.ok).toBe(true)
    if (!entry.ok || entry.value.recovery.status !== 'available') return
    expect(publicRecoveryChoices(entry.value.recovery.snapshot).map((choice) => choice.source))
      .toEqual(expect.arrayContaining(['root', 'stage']))
    const recovered = await recoverPublicWorld(storage, provider, 'stage', entry.value.recovery.snapshot)
    expect(recovered.ok).toBe(true)
    if (!recovered.ok) return
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(stagedBytes)
    expect(storage.getItem(PUBLIC_V6_STAGE_KEY)).toBe(stagedBytes)
    expect(JSON.parse(storage.getItem(recovered.value.archiveKey)!)).toMatchObject({
      selectedSource: 'stage', rootBytes: started.value.bytes, stageBytes: stagedBytes,
    })
    expect(names.every((name) => name === PUBLIC_V6_LOCK_NAME)).toBe(true)
    const reread = await inspectPublicEntry(storage, provider)
    expect(reread.ok && reread.value.root.status).toBe('valid-playable')
    expect(reread.ok && reread.value.artifacts.status === 'available'
      && reread.value.artifacts.stage.status).toBe('settled')
  })

  it('recovers invalid root from a verified backup without discarding the invalid bytes', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    storage.values.set(PUBLIC_V6_BACKUP_KEY, started.value.bytes)
    storage.values.set(PUBLIC_V6_ROOT_KEY, '{corrupt root')
    const entry = await inspectPublicEntry(storage, provider)
    expect(entry.ok).toBe(true)
    if (!entry.ok || entry.value.recovery.status !== 'available') return
    expect(entry.value.root.status).toBe('invalid')
    expect(publicRecoveryChoices(entry.value.recovery.snapshot).map((choice) => choice.source))
      .toEqual(['stage', 'backup'])
    const recovered = await recoverPublicWorld(storage, provider, 'backup', entry.value.recovery.snapshot)
    expect(recovered.ok).toBe(true)
    if (!recovered.ok) return
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(started.value.bytes)
    expect(storage.getItem(PUBLIC_V6_STAGE_KEY)).toBe(started.value.bytes)
    expect(JSON.parse(storage.getItem(recovered.value.archiveKey)!)).toMatchObject({
      selectedSource: 'backup', rootBytes: '{corrupt root', backupBytes: started.value.bytes,
    })
    expect(storage.writes).not.toContain(legacyKey)
  })

  it('refuses a stale displayed choice without archive or save writes', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const inspected = readPublicV6RecoverySnapshot(storage)
    expect(inspected.status).toBe('available')
    if (inspected.status !== 'available') return
    storage.values.set(PUBLIC_V6_STAGE_KEY, '{changed in another tab')
    const before = [...storage.writes]
    const refused = await recoverPublicWorld(storage, provider, 'root', inspected.snapshot)
    expect(refused).toEqual({ ok: false, reason: 'snapshot-changed' })
    expect(storage.writes).toEqual(before)
    expect(storage.getItem(PUBLIC_V6_STAGE_KEY)).toBe('{changed in another tab')
    expect([...storage.values.keys()].some((key) => key.includes(':archive:'))).toBe(false)
  })

  it('does not mutate bytes for an invalid candidate, missing lock, or storage failure', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const inspected = readPublicV6RecoverySnapshot(storage)
    expect(inspected.status).toBe('available')
    if (inspected.status !== 'available') return
    const before = [...storage.writes]
    expect(await recoverPublicWorld(storage, provider, 'backup', inspected.snapshot))
      .toEqual({ ok: false, reason: 'invalid-source' })
    expect(await recoverPublicWorld(storage, undefined, 'root', inspected.snapshot))
      .toEqual({ ok: false, reason: 'lock-unavailable' })
    expect(await recoverPublicWorld({ getItem: storage.getItem, setItem: () => { throw Error('quota') } },
      provider, 'root', inspected.snapshot)).toEqual({ ok: false, reason: 'storage-error' })
    expect(storage.writes).toEqual(before)
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(started.value.bytes)
  })
})

describe('public v7 recovery choices', () => {
  it('shows only the current root after a migrated resolver publishes ahead of old stage and backup', () => {
    const storage = memoryStorage()
    const v6 = commitPublicV6World(storage, createFreshPublicWorld(seed, 'greenway-classic-v1'), null)
    if (v6.status !== 'committed') throw new Error(v6.status)
    const migrated = migratePublicV6ToV7(storage, v6.bytes)
    if (migrated.status !== 'committed') throw new Error(migrated.status)
    const pending = commitPublicV7World(storage, migrated.root.state, migrated.bytes)
    if (pending.status !== 'committed') throw new Error(pending.status)
    const newerV6 = commitPublicV6World(storage, { ...v6.root.state,
      player: { ...v6.root.state.player, coins: v6.root.state.player.coins + 7 } }, v6.bytes)
    if (newerV6.status !== 'committed') throw new Error(newerV6.status)
    const currentRoot = serializePublicV7World({ ...pending.root,
      saveRevision: pending.root.saveRevision + 1, migrationSourceV6Bytes: newerV6.bytes })
    storage.values.set(PUBLIC_V7_ROOT_KEY, currentRoot)
    storage.values.set(PUBLIC_V7_STAGE_KEY, pending.bytes)
    storage.values.set(PUBLIC_V7_BACKUP_KEY, pending.bytes)
    const read = readPublicV7RecoverySnapshot(storage)
    if (read.status !== 'available') throw new Error(read.status)
    expect(publicV7RecoveryChoices(read.snapshot, storage).map((choice) => choice.source)).toEqual(['root'])
    expect(publicV7RecoveryChoices(read.snapshot, { getItem: (key: string) => {
      if (key === PUBLIC_V6_ROOT_KEY) throw new Error('unreadable')
      return storage.getItem(key)
    } })).toEqual([])
  })

  it('hides fresh old candidates when a later v6 fork exists, and keeps ordinary pending saves available', () => {
    const storage = memoryStorage()
    const fresh = commitPublicV7World(storage,
      withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1')), null)
    if (fresh.status !== 'committed') throw new Error(fresh.status)
    const pending = commitPublicV7World(storage, fresh.root.state, fresh.bytes)
    if (pending.status !== 'committed') throw new Error(pending.status)
    storage.values.set(PUBLIC_V7_ROOT_KEY, fresh.bytes)
    const ordinary = readPublicV7RecoverySnapshot(storage)
    if (ordinary.status !== 'available') throw new Error(ordinary.status)
    expect(publicV7RecoveryChoices(ordinary.snapshot, storage).map((choice) => choice.source))
      .toEqual(['root', 'stage', 'backup'])

    const v6Storage = memoryStorage()
    const v6 = commitPublicV6World(v6Storage, createFreshPublicWorld(seed, 'greenway-classic-v1'), null)
    if (v6.status !== 'committed') throw new Error(v6.status)
    const boundRoot = serializePublicV7World({ ...fresh.root,
      saveRevision: fresh.root.saveRevision + 1, migrationSourceV6Bytes: v6.bytes })
    storage.values.set(PUBLIC_V6_ROOT_KEY, v6.bytes)
    storage.values.set(PUBLIC_V7_ROOT_KEY, boundRoot)
    storage.values.set(PUBLIC_V7_STAGE_KEY, fresh.bytes)
    storage.values.set(PUBLIC_V7_BACKUP_KEY, fresh.bytes)
    const fork = readPublicV7RecoverySnapshot(storage)
    if (fork.status !== 'available') throw new Error(fork.status)
    expect(publicV7RecoveryChoices(fork.snapshot, storage).map((choice) => choice.source)).toEqual(['root'])
  })
})

describe('fresh v7 fork choice copy', () => {
  it('distinguishes the current root, pending newer save, and later v6 branch at both taps', () => {
    const current = publicFreshForkChoiceCopy('continue-v7')
    const pending = publicFreshForkChoiceCopy('use-v7-stage')
    const laterV6 = publicFreshForkChoiceCopy('use-v6')
    expect(current.label).toContain('current fresh v7 journey')
    expect(current.confirmation).toContain('current fresh v7 journey')
    expect(current.result).toContain('current fresh v7 journey')
    expect(pending.label).toContain('pending newer fresh v7 save')
    expect(pending.confirmation).toContain('pending newer fresh v7 save')
    expect(pending.result).toContain('pending newer fresh v7 save')
    expect(laterV6.label).toContain('later v6 save')
    expect(laterV6.confirmation).toContain('later v6 save')
    expect(laterV6.result).toContain('later v6 save')
    expect(new Set([current.label, pending.label, laterV6.label]).size).toBe(3)
  })

  it('explains an interrupted fresh start and later v6 branch without implying automatic repair', () => {
    const eligible = publicPendingV7StageGuidance(true, false)
    expect(eligible).toContain('fresh v7 start was interrupted')
    expect(eligible).toContain('later v6 save')
    expect(eligible).toContain('Choose explicitly')
    expect(eligible).toContain('Both branches will be archived')
    expect(eligible).toContain('v6 save stays unchanged')

    const unavailable = publicPendingV7StageGuidance(false, false)
    expect(unavailable).toContain('Keep this site data and all saves')
    expect(unavailable).toContain('Reload only rechecks storage')
    expect(publicPendingV7StageGuidance(false, true)).toBeNull()
  })
})
