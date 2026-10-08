import { describe, expect, it } from 'vitest'
import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createGeneratedWorld } from './domain/generation'
import { mireglassApproachTrail } from './domain/mireglassApproachTrail'
import { mireglassAnchors, mireglassResources } from './domain/mireglassContent'
import { mireglassRouteSites } from './domain/mireglassRouteSites'
import { createMireglassWorld } from './domain/mireglassWorld'
import type { StreamedWorldIntent } from './domain/streamedWorld'
import { MIREGLASS_SAVE_KEY, serializeMireglassWorld } from './domain/mireglassPersistence'
import { worldTileAtGrid } from './domain/worldChunks'
import { WizardMap } from './view/WizardMap'
import { keyboardMovementIntents } from './view/WizardSurface'
import { createFixedInputClock, createTimedMovementSampler, sampleFixedInputBatch } from './view/timedInput'
import {
  bearingText, createMireglassDevWorld, loadMireglassDevWorld, mireglassActionChoices, mireglassBarrierAfterResult, mireglassOutpostQuote,
  mireglassApproachTerrain, mireglassNearestInteractChoice, mireglassNextObjective, mireglassViewProjection,
  recordMireglassViewMovement, saveMireglassDevWorld, shouldAutosaveMireglassTravel,
} from './MireglassPlayableApp'

const seed = 'greenway-alpha'
const V5_KEY = 'wizard-realms:world:v5'
function memoryStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) }, values }
}

describe('Mireglass playable dev adapter', () => {
  it('integrates timestamped keyboard taps once while preserving touch tap intents', () => {
    const keys = new Set<string>()
    const sampler = createTimedMovementSampler(0)
    const clock = createFixedInputClock(0)
    const queued: StreamedWorldIntent[] = []
    for (const intent of keyboardMovementIntents(keys, 'KeyA', true, 10)) {
      if (intent.type === 'movement' || intent.type === 'movement.tap') recordMireglassViewMovement(sampler, queued, intent, 0, 10)
    }
    for (const intent of keyboardMovementIntents(keys, 'KeyA', false, 110)) {
      if (intent.type === 'movement' || intent.type === 'movement.tap') recordMireglassViewMovement(sampler, queued, intent, 0, 110)
    }
    expect(queued).toEqual([])
    const samples = sampleFixedInputBatch(sampler, clock, 150, 50, 12)
    expect(samples.reduce((turn, vector) => turn + vector[0] * 0.13, 0)).toBeCloseTo(-0.26)
    recordMireglassViewMovement(sampler, queued, { type: 'movement.tap', vector: [1, 0] }, 0, 150)
    expect(queued).toEqual([{ type: 'look', yawDelta: -0.13, pitchDelta: 0 }])
  })
  it('dresses only dry approach cells with joining path segments', () => {
    const positions = [[0, 0], [4, 0], [4, 4], [12, 0], [8, 8], [60, 60]] as const
    const cells = positions.map(([x, z], index) => ({ id: `cell-${index}`,
      position: [x, 0, z] as const, size: [4, 4] as const, height: 2, climate: 'temperate_forest' }))
    const tiles = cells.map((cell, index) => ({ id: cell.id, terrain: index === 4 ? 'wetland' : 'loam' }))
    const trail = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }]
    const dressed = mireglassApproachTerrain(cells, tiles, trail)
    expect(dressed[0]).toMatchObject({ mireglassApproach: true,
      mireglassTrailSegment: { from: [0, 0], to: [2, 0] } })
    expect(dressed[1]).toMatchObject({ mireglassApproach: true,
      mireglassTrailSegment: { from: [2, 0], to: [4, 2] } })
    expect(dressed[2]).toMatchObject({ mireglassApproach: true })
    expect(dressed[2].mireglassTrailSegment?.from).toEqual(dressed[1].mireglassTrailSegment?.to)
    expect(dressed[3]).not.toHaveProperty('mireglassTrailSegment')
    expect(dressed[4]).toBe(cells[4])
    expect(dressed[5]).toBe(cells[5])
    expect(mireglassApproachTerrain(cells, tiles, trail)).toBe(dressed)
  })

  it('uses the validated dry trail between its actual world anchors', () => {
    const trail = mireglassApproachTrail(seed)
    const anchors = mireglassAnchors(seed)
    expect(trail[0]).toEqual(anchors.fringeMarker.tile.center)
    expect(trail.at(-1)).toEqual(anchors.salvager.tile.center)
  })

  it('starts at the frontier with ordinary items, no learned spell, and no automatic progress', () => {
    const world = createMireglassDevWorld(seed)
    const marker = mireglassAnchors(seed).fringeMarker.tile.center
    expect(world.state.player.position).toEqual(marker)
    expect(world.state.player.inventory).toEqual([{ itemId: 'woodcutters_axe', quantity: 1 }])
    expect(world.state.player.learnedSpellIds).toEqual([])
    expect(world.state.expedition.fringeMarkerStudied).toBe(false)
    expect(mireglassActionChoices(world.state).map((choice) => choice.action.type)).toContain('study_fringe_marker')
    expect(mireglassNextObjective(world.state).position).toEqual(marker)

    const result = world.act({ type: 'study_fringe_marker' })
    expect(result.event?.type).toBe('fringe_marker_studied')
    expect(world.state.player.learnedSpellIds).toContain('wayfinder_glow')
    expect(world.state.expedition.fringeMarkerStudied).toBe(true)
    expect(mireglassActionChoices(world.state).map((choice) => choice.action.type)).toContain('cast_wayfinder_glow')
    expect(mireglassNextObjective(world.state).position).toEqual(mireglassAnchors(seed).salvager.tile.center)
  })

  it('shows only in-reach stump actions and leaves authoritative prerequisites to the reducer', () => {
    const tree = mireglassResources(seed)[0]
    const world = createMireglassWorld(seed, undefined, tree.tile.center)
    expect(mireglassActionChoices(world.state).map((choice) => choice.action.type)).toContain('chop_tree')
    const denied = world.act({ type: 'chop_tree', resourceId: tree.id })
    expect(denied.rejection?.code).toBe('requires_axe')
    world.act({ type: 'equip_item', itemId: 'woodcutters_axe' })
    expect(world.act({ type: 'chop_tree', resourceId: tree.id }).event?.type).toBe('tree_chopped')
    expect(mireglassActionChoices(world.state).map((choice) => choice.action.type)).toContain('dig_tree_stump')
    expect(world.act({ type: 'dig_tree_stump', resourceId: tree.id }).rejection?.code).toBe('requires_spade')
  })

  it('keeps E on world interactions instead of repeatedly swapping equipment or buying stock', () => {
    const tree = mireglassResources(seed)[0]
    const source = createGeneratedWorld(seed).player
    source.position = { ...tree.tile.center }
    source.inventory.push({ itemId: 'field_spade', quantity: 1 })
    source.equipment.mainHand = 'field_spade'
    const world = createMireglassWorld(seed, source)
    expect(mireglassNearestInteractChoice(world.state)?.action).toEqual({ type: 'chop_tree', resourceId: tree.id })
    expect(world.act({ type: 'equip_item', itemId: 'woodcutters_axe' }).event?.type).toBe('item_equipped')
    expect(world.act(mireglassNearestInteractChoice(world.state)!.action).event?.type).toBe('tree_chopped')
    expect(mireglassNearestInteractChoice(world.state)?.action).toEqual({ type: 'dig_tree_stump', resourceId: tree.id })
    const atMarker = createMireglassDevWorld(seed)
    expect(atMarker.act({ type: 'study_fringe_marker' }).event?.type).toBe('fringe_marker_studied')
    expect(mireglassNearestInteractChoice(atMarker.state)).toBeUndefined()
  })

  it('projects real player gear, inventory, discovery, and only the chosen built route', () => {
    const site = mireglassRouteSites(seed).find((candidate) => candidate.kind === 'bridge')!
    const source = createGeneratedWorld(seed).player
    source.position = { ...site.from }
    source.inventory.push({ itemId: 'logs', quantity: 8 })
    source.equipment.mainHand = 'woodcutters_axe'
    const world = createMireglassWorld(seed, source)
    const before = mireglassViewProjection(world, world.state, [], null)
    expect(before.backpack.stacks.find((stack) => stack.itemId === 'logs')?.quantity).toBe(8)
    expect(before.equipment.mainHand?.itemId).toBe('woodcutters_axe')
    expect(before.coins).toBe(source.coins)
    expect(before.skillXp).toEqual(source.skillXp)
    expect(before.learnedSpellIds).toEqual([])
    expect(before.map.title).toContain('(v6)')
    expect(before.map.tiles).toHaveLength(17 * 17)
    expect(before.map.tiles.filter((tile) => tile.discovered).length).toBe(1)

    expect(world.act({ type: 'build_route', siteId: site.id }).event?.type).toBe('route_built')
    const after = mireglassViewProjection(world, world.state, [], null)
    expect(after.routes.find((route) => route.id === site.routeId)?.built).toBe(true)
    expect(after.routes.find((route) => route.id === site.routeId)?.from).toEqual([site.from.x, site.from.y, site.from.z])
    expect(after.buildSites.filter((candidate) => candidate.status === 'built').map((candidate) => candidate.id)).toEqual([site.id])
    expect(after.backpack.stacks.find((stack) => stack.itemId === 'logs')).toBeUndefined()
    expect(after.skillXp.construction).toBeGreaterThan(before.skillXp.construction)
  })

  it('projects only discovered Mireglass landmarks and follows the real reveal and excavation state', () => {
    const anchors = mireglassAnchors(seed)
    const markerWorld = createMireglassWorld(seed, undefined, anchors.fringeMarker.tile.center)
    const marker = mireglassViewProjection(markerWorld, markerWorld.state, [], null)
    expect(marker.terrain.some((cell) => cell.mireglassTrailSegment)).toBe(true)
    expect(marker.landmarks).toContainEqual({
      id: anchors.fringeMarker.id, kind: 'frontier-marker',
      position: [anchors.fringeMarker.tile.center.x, anchors.fringeMarker.tile.center.y, anchors.fringeMarker.tile.center.z],
      studied: false,
    })
    expect(marker.landmarks?.some((landmark) => landmark.kind === 'seal-cache')).toBe(false)
    expect(markerWorld.act({ type: 'study_fringe_marker' }).event?.type).toBe('fringe_marker_studied')
    expect(mireglassViewProjection(markerWorld, markerWorld.state, [], null).landmarks)
      .toContainEqual(expect.objectContaining({ kind: 'frontier-marker', studied: true }))

    const source = createGeneratedWorld(seed).player
    source.position = { ...anchors.sealCache.tile.center }
    source.learnedSpellIds = ['wayfinder_glow']
    source.inventory.push({ itemId: 'field_spade', quantity: 1 })
    source.equipment.mainHand = 'field_spade'
    source.skillXp.excavation = 30
    const cacheWorld = createMireglassWorld(seed, source)
    const cache = () => mireglassViewProjection(cacheWorld, cacheWorld.state, [], null).landmarks
      ?.find((landmark) => landmark.kind === 'seal-cache')
    expect(cache()).toMatchObject({ revealed: false, excavated: false })
    expect(cacheWorld.act({ type: 'cast_wayfinder_glow' }).event?.type).toBe('cache_revealed')
    expect(cache()).toMatchObject({ revealed: true, excavated: false })
    expect(cacheWorld.act({ type: 'excavate_cache' }).event?.type).toBe('cache_excavated')
    expect(cache()).toMatchObject({ revealed: true, excavated: true })
  })

  it('shows a cache marker only after an adjacent Glow cast, without revealing it early', () => {
    const cache = mireglassAnchors(seed).sealCache
    const neighbor = worldTileAtGrid(seed, cache.tile.gridX - 2, cache.tile.gridZ - 3)
    const source = createGeneratedWorld(seed).player
    source.position = { ...neighbor.center }
    source.learnedSpellIds = ['wayfinder_glow']
    const world = createMireglassWorld(seed, source)
    const projected = () => mireglassViewProjection(world, world.state, [], null)
    const cacheMapTile = () => projected().map.tiles.find((tile) => tile.id === cache.tile.id)
    const mapHtml = () => renderToStaticMarkup(createElement(WizardMap, {
      projection: projected(), open: true, onToggle: () => {}, onIntent: () => {},
      buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>(),
    }))
    expect(world.state.discoveredTileIds).not.toContain(cache.tile.id)
    expect(cacheMapTile()?.hasCache).toBe(false)
    expect(mapHtml()).not.toContain('revealed seal cache')

    expect(world.act({ type: 'cast_wayfinder_glow' }).event?.type).toBe('cache_revealed')
    expect(world.state.discoveredTileIds).toContain(cache.tile.id)
    expect(projected().landmarks).toContainEqual(expect.objectContaining({
      id: cache.id, revealed: true, excavated: false,
    }))
    expect(cacheMapTile()).toMatchObject({ discovered: true, hasCache: true })
    expect(mapHtml()).toContain('revealed seal cache')
    expect(mapHtml()).toContain('<b>✦</b>')
  })

  it('projects a revealed cache from a valid older v6 save whose cache tile is still fogged', () => {
    const cache = mireglassAnchors(seed).sealCache
    const neighbor = worldTileAtGrid(seed, cache.tile.gridX - 2, cache.tile.gridZ - 3)
    const source = createGeneratedWorld(seed).player
    source.position = { ...neighbor.center }
    source.learnedSpellIds = ['wayfinder_glow']
    const world = createMireglassWorld(seed, source)
    expect(world.act({ type: 'cast_wayfinder_glow' }).event?.type).toBe('cache_revealed')
    const olderSnapshot = { ...world.state,
      discoveredTileIds: world.state.discoveredTileIds.filter((id) => id !== cache.tile.id) }
    const storage = memoryStorage()
    storage.setItem(MIREGLASS_SAVE_KEY, serializeMireglassWorld(olderSnapshot))
    const loaded = loadMireglassDevWorld(storage, seed)
    expect(loaded.mode).toBe('resumed')
    expect(loaded.runtime.state.discoveredTileIds).not.toContain(cache.tile.id)
    const projection = mireglassViewProjection(loaded.runtime, loaded.runtime.state, [], null)
    expect(projection.landmarks).toContainEqual(expect.objectContaining({
      id: cache.id, revealed: true, excavated: false,
    }))
    expect(projection.map.tiles.find((tile) => tile.id === cache.tile.id)).toMatchObject({
      discovered: false, terrain: null, hasCache: true,
    })
  })

  it('keeps a barrier until an actual traversal or move and reports a new held-input block', () => {
    const bridge = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const source = createGeneratedWorld(seed).player
    source.position = { ...bridge.from }
    source.inventory.push({ itemId: 'logs', quantity: bridge.logCost })
    const world = createMireglassWorld(seed, source)
    expect(world.act({ type: 'build_route', siteId: bridge.id }).event?.type).toBe('route_built')
    let barrier = mireglassBarrierAfterResult(null, world.advance([{ type: 'move', delta: { x: 0, z: 4 } }]))
    expect(barrier).toBe('The fen channel needs a built bridge.')
    barrier = mireglassBarrierAfterResult(barrier, world.advance([]))
    expect(barrier).toBe('The fen channel needs a built bridge.')
    barrier = mireglassBarrierAfterResult(barrier, world.act({ type: 'equip_item', itemId: 'woodcutters_axe' }))
    expect(barrier).toBe('The fen channel needs a built bridge.')

    barrier = mireglassBarrierAfterResult(barrier, world.act({ type: 'traverse_route', siteId: bridge.id, from: 'from' }))
    expect(barrier).toBeNull()
    barrier = mireglassBarrierAfterResult(barrier, world.advance([{ type: 'move', delta: { x: 0, z: -4 } }]))
    expect(barrier).toBe('The fen channel needs a built bridge.')
    barrier = mireglassBarrierAfterResult(barrier, world.advance([{ type: 'move', delta: { x: 0, z: 4 } }]))
    expect(barrier).toBeNull()
  })

  it('renders useful compass bearings from world coordinates', () => {
    const origin = { x: 0, z: 0 }
    expect(bearingText(origin, { x: 0, z: -8 })).toBe('N')
    expect(bearingText(origin, { x: 8, z: 0 })).toBe('E')
    expect(bearingText(origin, { x: -8, z: 8 })).toBe('SW')
    expect(bearingText(origin, { x: 0.2, z: 0.2 })).toBe('here')
  })

  it('quotes the regional seal price at the outpost before the player owns a seal', () => {
    const source = createGeneratedWorld(seed).player
    source.position = { ...mireglassAnchors(seed).salvager.tile.center }
    source.inventory.push({ itemId: 'logs', quantity: 2 })
    const world = createMireglassWorld(seed, source)
    expect(mireglassOutpostQuote(world.state)).toContain('Mireglass seals for 80 coins')
    expect(mireglassViewProjection(world, world.state, [], null).stores[0].sellOffers)
      .toContainEqual({ itemId: 'logs', name: 'Logs', quantity: 2, unitPrice: 2 })
    expect(mireglassOutpostQuote(createMireglassDevWorld(seed).state)).toBeNull()
  })

  it('guides both the outward crossings and the return trip through built routes', () => {
    const bridge = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const ladder = mireglassRouteSites(seed).find((site) => site.kind === 'ladder')!
    const initial = createMireglassDevWorld(seed).state
    const advanced = { ...initial,
      player: { ...initial.player,
        inventory: [...initial.player.inventory, { itemId: 'field_spade' as const, quantity: 1 }, { itemId: 'logs' as const, quantity: 12 }],
        position: { ...bridge.from }, skillXp: { ...initial.player.skillXp, excavation: 30 } },
      expedition: { ...initial.expedition, fringeMarkerStudied: true,
        builtRoutes: { bridge: bridge.id, ladder: null } },
    }
    expect(mireglassNextObjective(advanced).label).toBe('Cross the built fen bridge')
    const across = { ...advanced, player: { ...advanced.player, position: { ...ladder.from } },
      expedition: { ...advanced.expedition, builtRoutes: { bridge: bridge.id, ladder: ladder.id } } }
    expect(mireglassNextObjective(across).label).toBe('Climb the built slate ladder')
    const searching = { ...across, player: { ...across.player, position: { ...ladder.to } } }
    expect(mireglassNextObjective(searching)).toMatchObject({ searchArea: true })
    expect(mireglassNextObjective(searching).position).not.toEqual(mireglassAnchors(seed).sealCache.tile.center)
    const returning = { ...across, player: { ...across.player,
      inventory: [...across.player.inventory, { itemId: 'mireglass_reach/item/seal' as const, quantity: 1 }],
      position: { ...ladder.to } },
      expedition: { ...across.expedition, cacheRevealed: true, cacheExcavated: true } }
    expect(mireglassNextObjective(returning).label).toBe('Descend the built slate ladder')
    expect(mireglassNextObjective({ ...returning, player: { ...returning.player, position: { ...bridge.to } } }).label)
      .toBe('Return across the built fen bridge')
    const sold = { ...returning, player: { ...returning.player,
      inventory: returning.player.inventory.filter((stack) => stack.itemId !== 'mireglass_reach/item/seal'),
      position: { ...mireglassAnchors(seed).salvager.tile.center } } }
    expect(mireglassNextObjective(sold).label).toBe('Buy fen waders with the seal proceeds')
    const equipped = { ...sold, player: { ...sold.player,
      inventory: [...sold.player.inventory, { itemId: 'mireglass_reach/item/waders' as const, quantity: 1 }],
      equipment: { ...sold.player.equipment, feet: 'mireglass_reach/item/waders' as const } } }
    expect(mireglassNextObjective(equipped).complete).toBe(true)
  })

  it('saves and reloads through only the v6 key, preserving the v5 bytes', () => {
    const storage = memoryStorage()
    const v5Bytes = '{"v5":"unchanged"}'
    storage.setItem(V5_KEY, v5Bytes)
    const initial = loadMireglassDevWorld(storage, seed)
    expect(initial.mode).toBe('fresh')
    const world = initial.runtime
    expect(world.act({ type: 'study_fringe_marker' }).event?.type).toBe('fringe_marker_studied')
    const before = JSON.stringify(world.state)
    expect(saveMireglassDevWorld(storage, world.state)).toEqual({ ok: true })
    const v6Bytes = storage.getItem(MIREGLASS_SAVE_KEY)
    expect(v6Bytes).toContain('wizard-mireglass/v6')
    const resumed = loadMireglassDevWorld(storage, seed)
    expect(resumed.mode).toBe('resumed')
    expect(JSON.stringify(resumed.runtime.state)).toBe(before)
    expect(storage.getItem(V5_KEY)).toBe(v5Bytes)
    expect(storage.values.size).toBe(2)
  })

  it('preserves invalid v6 bytes until the explicit replacement path writes a fresh save', () => {
    const storage = memoryStorage()
    const invalidBytes = '{"schemaVersion":"old-v6","progress":"keep this"}'
    storage.setItem(MIREGLASS_SAVE_KEY, invalidBytes)
    const loaded = loadMireglassDevWorld(storage, seed)
    expect(loaded.mode).toBe('invalid')
    expect(loaded.runtime.state.expedition.fringeMarkerStudied).toBe(false)
    expect(storage.getItem(MIREGLASS_SAVE_KEY)).toBe(invalidBytes)
    expect(saveMireglassDevWorld(storage, createMireglassDevWorld(seed).state)).toEqual({ ok: true })
    expect(storage.getItem(MIREGLASS_SAVE_KEY)).not.toBe(invalidBytes)
    expect(loadMireglassDevWorld(storage, seed).mode).toBe('resumed')
  })

  it('reports storage failures and gates movement autosaves to five seconds', () => {
    const unavailable = { getItem: (_key: string): string | null => { throw new Error('denied') } }
    expect(loadMireglassDevWorld(unavailable, seed).mode).toBe('storage-error')
    const full = { setItem: (_key: string, _value: string) => { throw new Error('quota') } }
    expect(saveMireglassDevWorld(full, createMireglassDevWorld(seed).state)).toMatchObject({ ok: false })
    expect(shouldAutosaveMireglassTravel(false, 0, 10_000)).toBe(false)
    expect(shouldAutosaveMireglassTravel(true, 0, 4_999)).toBe(false)
    expect(shouldAutosaveMireglassTravel(true, 0, 5_000)).toBe(true)
  })
})
