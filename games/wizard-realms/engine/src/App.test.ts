import { createElement, createRef, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { advanceWizardWorld, createWizardWorld, serializeWizardWorld, type WizardWorldState } from './domain'
import { createGeneratedWorld } from './domain/generation'
import { routeBuildOptions } from './domain/routeSites'
import { EQUIPMENT_SLOTS, WizardHud } from './view/WizardHud'
import { WizardMap } from './view/WizardMap'
import App, {
  IDLE_CLOCK, MAX_CATCH_UP_STEPS, OBJECTIVE_STYLES, PIVOT_RADIANS_PER_TICK, accumulateElapsed, controlIntents, eventText, intentForView,
  loadWorld, movementIntent, objectiveFor, persistWorld, recoverablePriorSaveKey, recoverPriorSavedWorld, resetSavedWorld, retainOpenStoreId, runBatch, stepBatch, toViewProjection, worldProfileForSearch, type BatchSink,
} from './App'

const copy = (state: WizardWorldState): WizardWorldState => JSON.parse(JSON.stringify(state)) as WizardWorldState
const withAxeEquipped = (state: WizardWorldState) => { state.player.equipment.mainHand = 'woodcutters_axe'; return state }
const withLogs = (state: WizardWorldState, quantity: number) => { state.player.inventory.push({ itemId: 'logs', quantity }); return state }
const legacyStores = (state: WizardWorldState) => state.stores.map((store) => ({
  ...store, listings: store.listings.filter((listing) => listing.id !== 'spade'),
}))
const legacyV1Resources = (state: WizardWorldState) => state.resources.filter((resource) => !resource.id.startsWith('greenway-journey-tree-'))
const legacyV4Save = (state: WizardWorldState) => JSON.stringify({
  ...state, schemaVersion: 'wizard-world/v4', contentRevision: 'greenway-region-v2',
  routes: state.routes.map(({ siteId: _siteId, ...route }) => route),
})
const withFirstRegionCompleted = (state: WizardWorldState) => {
  state.player.learnedSpellIds = ['wayfinder_glow']
  state.player.skillXp.spellcraft = 40
  state.revealedDigSiteIds = ['ridge_cache']
  state.excavatedDigSiteIds = ['practice_mound', 'ridge_cache']
  return state
}

describe('Wizard view adapter', () => {
  it('announces completed market sales with the actual proceeds', () => {
    expect(eventText({ type: 'trade_listing_sold', slotIndex: 0, itemId: 'logs', quantity: 2,
      unitPrice: 3, totalPrice: 6, sequence: 4, tick: 600 }))
      .toBe('A market buyer paid 6g for 2 Greenway logs.')
    expect(eventText({ type: 'store_item_sold', storeId: 'store-greenway', itemId: 'ancient_relic',
      quantity: 1, unitPrice: 25, totalPrice: 25, sequence: 5, tick: 601 }))
      .toBe('Sold 1 Ancient relic for 25g.')
  })
  it('projects all world surfaces without mutating authoritative state', () => {
    const state = createWizardWorld('greenway-alpha')
    const before = JSON.stringify(state)
    const projection = toViewProjection(state, [{ id: 1, text: 'Visible event' }])
    expect(JSON.stringify(state)).toBe(before)
    expect(projection.seed).toBe('greenway-alpha')
    expect(projection.terrain).toHaveLength(state.tiles.length)
    expect(projection.resources).toHaveLength(state.resources.length)
    expect(projection.stores).toHaveLength(2)
    expect(projection.fairyRings).toHaveLength(2)
    expect(projection.inscriptions).toHaveLength(1)
    expect(projection.digSites).toHaveLength(2)
    expect(projection.digSites.find((site) => site.id === 'practice_mound')).toMatchObject({ revealed: true, excavated: false })
    expect(projection.digSites.find((site) => site.id === 'ridge_cache')).toMatchObject({ revealed: false, excavated: false })
    expect(projection.learnedSpellIds).toEqual([])
    expect(projection.skillXp).toEqual(state.player.skillXp)
    expect(projection.routes).toHaveLength(2)
    expect(projection.map.tiles).toHaveLength(state.tiles.length)
    expect(projection.map.tiles.find((tile) => tile.id === 'tile-4-4')?.hasWaystone).toBe(true)
    expect(projection.map.tiles.some((tile) => !tile.discovered && tile.terrain === null && tile.biome === null)).toBe(true)
    expect(projection.recentEvents).toEqual(['Visible event'])
    expect(projection.equipment.mainHand).toBeNull()
    expect(projection.equipment.offHand).toBeNull()
    expect(projection.player.position).toEqual([state.player.position.x, state.player.position.y, state.player.position.z])
  })

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)('puts each landmark on one nearest tile in the %s atlas', (profile) => {
    const state = createGeneratedWorld('greenway-alpha', profile)
    state.discoveredTileIds = state.tiles.map((tile) => tile.id)
    const tiles = toViewProjection(state, []).map.tiles
    expect(tiles).toHaveLength(profile === 'greenway-classic-v1' ? 49 : 256)
    expect(tiles.filter((tile) => tile.hasStore).map((tile) => tile.id)).toEqual(['tile-5-2', 'tile-2-3'])
    expect(tiles.filter((tile) => tile.hasRing).map((tile) => tile.id)).toEqual(['tile-5-1', 'tile-4-3'])
    expect(tiles.filter((tile) => tile.hasWaystone).map((tile) => tile.id)).toEqual(['tile-4-4'])
    expect(tiles.filter((tile) => tile.hasResource).length).toBeGreaterThan(0)

    state.discoveredTileIds = ['tile-2-3']
    const fogged = toViewProjection(state, []).map.tiles
    expect(fogged.filter((tile) => tile.hasStore).map((tile) => tile.id)).toEqual(['tile-2-3'])
    expect(fogged.some((tile) => tile.hasRing)).toBe(false)
    expect(fogged.some((tile) => tile.hasWaystone)).toBe(false)
    expect(fogged.filter((tile) => !tile.discovered).every((tile) => tile.terrain === null && tile.biome === null && !tile.hasResource && !tile.hasStore && !tile.hasRing && !tile.hasWaystone && !tile.hasRouteSite && !tile.hasBuiltRoute)).toBe(true)
  })

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)('hides Highland landmarks until entry in the %s atlas', (profile) => {
    const state = createGeneratedWorld('greenway-alpha', profile)
    const marked = (world: WizardWorldState) => {
      const tiles = toViewProjection(world, []).map.tiles
      return {
        stores: tiles.filter((tile) => tile.hasStore).map((tile) => tile.id),
        rings: tiles.filter((tile) => tile.hasRing).map((tile) => tile.id),
      }
    }
    expect(state.discoveredTileIds).toContain('tile-5-2')
    expect(marked(state)).toEqual({ stores: ['tile-2-3'], rings: ['tile-4-3'] })

    state.builtRouteIds = ['greenway_ladder', 'highland_bridge']
    state.routes[0].siteId = 'greenway_ladder:x:0'
    state.routes[1].siteId = 'highland_bridge:z:-8'
    expect(marked(state)).toEqual({ stores: ['tile-2-3'], rings: ['tile-4-3'] })
    state.player.position = { ...state.routes.find((route) => route.id === 'highland_bridge')!.from }
    const crossed = advanceWizardWorld(state, [{ type: 'traverse_route', routeId: 'highland_bridge' }])
    expect(crossed.rejections).toEqual([])
    expect(crossed.state.discoveredTileIds).toContain('tile-5-1')
    expect(marked(crossed.state)).toEqual({ stores: ['tile-5-2', 'tile-2-3'], rings: ['tile-5-1', 'tile-4-3'] })
    expect(toViewProjection(crossed.state, []).map.player).toEqual({ gridX: 5, gridZ: 1, yaw: 0 })
  })

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)('marks discovered candidate sites and the chosen completed route in the %s atlas', (profile) => {
    const state = createGeneratedWorld('greenway-alpha', profile)
    state.discoveredTileIds = state.tiles.map((tile) => tile.id)
    const routeSites = () => toViewProjection(state, []).map.tiles.filter((tile) => tile.hasRouteSite).map((tile) => tile.id).sort()
    const builtRoutes = () => toViewProjection(state, []).map.tiles.filter((tile) => tile.hasBuiltRoute).map((tile) => tile.id).sort()
    const ladderSites = toViewProjection(state, []).buildSites.filter((site) => site.routeId === 'greenway_ladder')
    expect(ladderSites.length).toBeGreaterThan(1)
    expect(ladderSites.find((site) => site.id === 'greenway_ladder:x:-12')?.label)
      .toBe('Greenway ladder, site 12m west of center')
    expect(routeSites().length).toBeGreaterThan(0)
    expect(builtRoutes()).toEqual([])

    state.unlockedRecipeIds.push('highland_bridge')
    const bridgeSites = toViewProjection(state, []).buildSites.filter((site) => site.routeId === 'highland_bridge')
    expect(bridgeSites.length).toBeGreaterThan(1)
    expect(bridgeSites.find((site) => site.id === 'highland_bridge:z:-8')?.label)
      .toBe('Highland bridge, crosses east; site 8m north of center')
    state.discoveredTileIds = [state.tiles.find((tile) => tile.id === 'tile-3-2')!.id]
    expect(toViewProjection(state, []).buildSites.some((site) => !site.discovered)).toBe(true)
    expect(routeSites().every((id) => state.discoveredTileIds.includes(id))).toBe(true)
    const chosenLadder = routeBuildOptions(state).find((site) => site.routeId === 'greenway_ladder' && site.id !== 'greenway_ladder:x:0')!
    state.routes[0].from = { ...chosenLadder.from }
    state.routes[0].to = { ...chosenLadder.to }
    state.routes[0].siteId = chosenLadder.id
    state.builtRouteIds.push('greenway_ladder')
    state.discoveredTileIds = state.tiles.map((tile) => tile.id)
    expect(routeSites().length).toBeGreaterThan(0)
    expect(builtRoutes()).toHaveLength(1)
    expect(routeSites().length).toBeGreaterThan(0)
    const chosenBridge = routeBuildOptions(state).find((site) => site.routeId === 'highland_bridge')!
    state.routes[1].from = { ...chosenBridge.from }
    state.routes[1].to = { ...chosenBridge.to }
    state.routes[1].siteId = chosenBridge.id
    state.builtRouteIds.push('highland_bridge')
    expect(routeSites()).toEqual([])
    expect(builtRoutes()).toHaveLength(2)
  })

  it('renders the route marker and legend without hiding the player when standing at the build site', () => {
    const state = createWizardWorld('greenway-alpha')
    const render = () => renderToStaticMarkup(createElement(WizardMap, {
      projection: toViewProjection(state, []), open: true, onToggle: () => {}, onIntent: () => {}, buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>(),
    }))
    const atlas = render()
    expect(atlas).toContain('route build site')
    expect(atlas).toContain('◇ route build site')

    state.player.position = { ...state.routes[0].from }
    expect(render()).toContain('player location')
    state.player.position = { ...state.tiles.find((tile) => tile.id === 'tile-3-3')!.center }
    state.routes[0].siteId = 'greenway_ladder:x:0'
    state.builtRouteIds.push('greenway_ladder')
    expect(render()).toContain('completed route')
    expect(render()).toContain('✓ completed route')
  })

  it('shows a fresh ladder site and its distance reason even before walking north', () => {
    const state = withLogs(createWizardWorld('greenway-alpha'), 8)
    const projection = toViewProjection(state, [])
    expect(projection.routes.find((route) => route.id === 'greenway_ladder'))
      .toMatchObject({ unlocked: true, built: false, logCost: 4 })
    expect(projection.buildSites.find((site) => site.id === 'greenway_ladder:x:0'))
      .toMatchObject({ discovered: true, status: 'too_far', reason: 'Source foot: 4m north. Approach from Greenway.' })
    const markup = renderToStaticMarkup(createElement(WizardMap, {
      projection, open: true, onToggle: () => {}, onIntent: () => {},
      buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>(),
    }))
    expect(markup).toContain('Preview Greenway ladder, site center')
    expect(markup).toContain('Source foot: 4m north. Approach from Greenway.')
  })

  it('keeps the player marker above a store and the expanded atlas north-up', () => {
    const state = createGeneratedWorld('greenway-alpha', 'greenway-expanded-v1')
    state.discoveredTileIds = state.tiles.map((tile) => tile.id)
    state.player.position = { ...state.tiles.find((tile) => tile.id === 'tile-2-3')!.center }
    const projection = toViewProjection(state, [])
    expect(projection.map.tiles.find((tile) => tile.id === 'tile-2-3')?.hasStore).toBe(true)
    expect(projection.map.player).toEqual({ gridX: 2, gridZ: 3, yaw: 0 })
    const markup = renderToStaticMarkup(createElement(WizardMap, {
      projection, open: true, onToggle: () => {}, onIntent: () => {}, buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>(),
    }))
    expect(markup).toContain('aria-label="North-up world map, negative Z is north"')
    expect(markup.indexOf('tile--4--4:')).toBeLessThan(markup.indexOf('tile-11-11:'))
    expect(markup).toMatch(/aria-label="tile-2-3:[^"]*player location, store"[^>]*><b[^>]*>▲<\/b><small[^>]*>S<\/small>/)
  })

  it('maps W/S to facing-relative movement and A/D to pivot without strafing', () => {
    const state = createWizardWorld('greenway-alpha')
    expect(movementIntent(state, [0, 1])).toEqual({ type: 'move', delta: { x: 0, y: 0, z: -0.16 } })
    expect(movementIntent(state, [1, 0])).toBeNull()
    expect(PIVOT_RADIANS_PER_TICK).toBe(0.13)
    expect(controlIntents(state, [1, 0])).toEqual([{ type: 'look', yawDelta: -0.13, pitchDelta: 0 }])
    expect(controlIntents(state, [-1, 0])).toEqual([{ type: 'look', yawDelta: 0.13, pitchDelta: 0 }])
    expect(controlIntents(state, [0, 0])).toEqual([])
    const pivotingForward = controlIntents(state, [1, 1])
    expect(pivotingForward).toHaveLength(2)
    expect(pivotingForward[0]).toEqual({ type: 'look', yawDelta: -0.13, pitchDelta: 0 })
    expect(pivotingForward[1]?.type).toBe('move')
    expect(Math.ceil(Math.PI / PIVOT_RADIANS_PER_TICK) * 50).toBeLessThanOrEqual(1250)
    state.player.yaw = -Math.PI / 2
    const forward = movementIntent(state, [0, 1])
    expect(forward?.type).toBe('move')
    if (!forward || forward.type !== 'move') throw new Error('Expected a movement intent')
    expect(Math.hypot(forward.delta.x, forward.delta.z)).toBeCloseTo(0.16)
    expect(forward.delta.x).toBeCloseTo(0.16)
    expect(movementIntent(state, [0, 0])).toBeNull()
  })

  it('keeps moving tangentially after turning along a locked boundary', () => {
    let state = createWizardWorld('greenway-alpha')
    state.player.position = { x: 0, y: state.player.position.y, z: -4 }
    const headOn = advanceWizardWorld(state, controlIntents(state, [0, 1]))
    expect(headOn.rejections[0]?.code).toBe('locked_area')
    expect(headOn.state.player.position.x).toBe(0)

    for (let step = 0; step < 9; step += 1) state = advanceWizardWorld(state, controlIntents(state, [1, 1])).state
    expect(state.player.yaw).toBeCloseTo(-9 * PIVOT_RADIANS_PER_TICK)
    expect(state.player.position.x).toBeGreaterThan(0)
    expect(state.player.position.z).toBe(-4)
    const afterTurn = advanceWizardWorld(state, controlIntents(state, [0, 1]))
    expect(afterTurn.rejections).toEqual([])
    expect(afterTurn.state.player.position.x).toBeGreaterThan(state.player.position.x)
    expect(afterTurn.state.player.position.z).toBe(-4)
    expect(afterTurn.state.tick).toBe(state.tick + 1)
  })

  it('offers the required interaction at each seeded progression landmark', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    const ladder = state.routes.find((route) => route.id === 'greenway_ladder')!
    const bridge = state.routes.find((route) => route.id === 'highland_bridge')!
    const greenwayRing = state.fairyRings.find((ring) => ring.id === 'ring-greenway')!
    const highlandRing = state.fairyRings.find((ring) => ring.id === 'ring-highland')!
    const store = state.stores.find((shop) => shop.id === 'store-greenway')!

    state.player.position = { ...store.position }
    expect(toViewProjection(state, []).nearbyInteraction?.targetId).toBe(store.id)
    state.player.inventory.push({ itemId: 'logs', quantity: 10 })
    state.player.position = { ...ladder.from }
    const ladderSite = routeBuildOptions(state).find((site) => site.routeId === ladder.id && site.id === 'greenway_ladder:x:0')!
    expect(intentForView(state, { type: 'build-site.confirm', siteId: ladderSite.id })).toEqual({ type: 'build_route', routeId: ladder.id, siteId: ladderSite.id })
    state.builtRouteIds.push(ladder.id)
    state.player.position = { ...bridge.from }
    const bridgeSite = routeBuildOptions(state).find((site) => site.routeId === bridge.id && site.id === 'highland_bridge:z:-8')!
    expect(intentForView(state, { type: 'build-site.confirm', siteId: bridgeSite.id })).toEqual({ type: 'build_route', routeId: bridge.id, siteId: bridgeSite.id })
    state.builtRouteIds.push(bridge.id)
    state.player.position = { ...highlandRing.position }
    expect(intentForView(state, { type: 'interact' })).toEqual({ type: 'discover_fairy_ring', ringId: highlandRing.id })
    state.player.position = { ...greenwayRing.position }
    expect(intentForView(state, { type: 'interact' })).toEqual({ type: 'discover_fairy_ring', ringId: greenwayRing.id })
  })

  it('maps jump, store, equipment, magic, excavation, trade, and ring controls to exact domain intents', () => {
    const state = createWizardWorld('greenway-alpha')
    const before = JSON.stringify(state)
    expect(intentForView(state, { type: 'jump' })).toEqual({ type: 'jump' })
    expect(intentForView(state, { type: 'build-site.select', siteId: 'greenway_ladder:x:0' })).toBeNull()
    expect(intentForView(state, { type: 'build-site.confirm', siteId: 'forged' })).toBeNull()
    expect(intentForView(state, { type: 'field-camp.select', tileId: 'tile--73-103' })).toBeNull()
    expect(intentForView(state, { type: 'field-camp.confirm', tileId: 'tile--73-103' })).toBeNull()
    expect(intentForView(state, { type: 'store.select-listing', storeId: 'store-greenway', listingId: 'hat' })).toEqual({ type: 'buy_store_listing', storeId: 'store-greenway', listingId: 'hat' })
    expect(intentForView(state, { type: 'equipment.equip', stackId: 'inventory-woodcutters_axe', slot: 'mainHand' })).toEqual({ type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' })
    expect(intentForView(state, { type: 'equipment.equip', stackId: 'inventory-wooden_shield', slot: 'offHand' })).toEqual({ type: 'equip_item', itemId: 'wooden_shield', slot: 'offHand' })
    expect(intentForView(state, { type: 'inscription.study', inscriptionId: 'greenway_waystone' })).toEqual({ type: 'study_inscription', inscriptionId: 'greenway_waystone' })
    expect(intentForView(state, { type: 'spell.cast', spellId: 'wayfinder_glow' })).toEqual({ type: 'cast_spell', spellId: 'wayfinder_glow' })
    expect(intentForView(state, { type: 'dig-site.excavate', digSiteId: 'practice_mound' })).toEqual({ type: 'dig_site', digSiteId: 'practice_mound' })
    expect(intentForView(state, { type: 'trade.create-listing', stackId: 'inventory-logs', slot: 2, quantity: 1, unitPrice: 5 })).toEqual({ type: 'create_trade_listing', itemId: 'logs', slotIndex: 2, quantity: 1, unitPrice: 5 })
    expect(intentForView(state, { type: 'trade.cancel-listing', slot: 2 })).toEqual({ type: 'cancel_trade_listing', slotIndex: 2 })
    expect(intentForView(state, { type: 'fairy-ring.teleport', ringId: 'ring-greenway', destinationRingId: 'ring-highland' })).toEqual({ type: 'teleport_fairy_ring', sourceRingId: 'ring-greenway', targetRingId: 'ring-highland' })
    expect(JSON.stringify(state)).toBe(before)
  })

  it('projects equipment under canonical mainHand/offHand slots with no alias slots', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    state.player.inventory.push({ itemId: 'wooden_shield', quantity: 1 })
    state.player.equipment.mainHand = 'woodcutters_axe'
    state.player.equipment.offHand = 'wooden_shield'
    const projection = toViewProjection(state, [])
    expect(Object.keys(projection.equipment).sort()).toEqual(['chest', 'feet', 'head', 'legs', 'mainHand', 'offHand'])
    expect(projection.equipment).not.toHaveProperty('focus')
    expect(projection.equipment).not.toHaveProperty('hands')
    expect(projection.equipment.mainHand).toMatchObject({ id: 'inventory-woodcutters_axe', name: 'Woodcutter axe' })
    expect(projection.equipment.offHand).toMatchObject({ id: 'inventory-wooden_shield', name: 'Wooden shield' })
    const axeStack = projection.backpack.stacks.find((stack) => stack.id === 'inventory-woodcutters_axe')!
    const shieldStack = projection.backpack.stacks.find((stack) => stack.id === 'inventory-wooden_shield')!
    expect(axeStack.equippableSlots).toEqual(['mainHand'])
    expect(shieldStack.equippableSlots).toEqual(['offHand'])
    expect([...EQUIPMENT_SLOTS].sort()).toEqual(Object.keys(projection.equipment).sort())
  })

  it('renders Main hand and Off hand labels and offers to unequip the equipped backpack stack', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    state.player.equipment.mainHand = 'woodcutters_axe'
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection: toViewProjection(state, []), onIntent: () => {} }))
    expect(markup).toContain('<div class="wr-slot" data-slot="mainHand"><small>Main hand</small><b>Woodcutter axe</b><button')
    expect(markup).toContain('<div class="wr-slot" data-slot="offHand"><small>Off hand</small><b>Empty</b></div>')
    expect(markup).not.toMatch(/<small>(focus|hands)<\/small>/i)
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('>Unequip</button>')
    expect(markup).toContain('<b>Woodcutter axe</b><small>×1</small>')

    const unequipped = renderToStaticMarkup(createElement(WizardHud, { projection: toViewProjection(createWizardWorld('greenway-alpha'), []), onIntent: () => {} }))
    expect(unequipped).toContain('aria-pressed="false"')
    expect(unequipped).toContain('>Equip</button>')
    expect(unequipped).not.toContain('>Unequip</button>')
  })

  it('recognizes equipment in every compatible slot and offers unequip instead of re-equip', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    state.player.inventory.push({ itemId: 'oak_wand', quantity: 1 })
    state.player.equipment.offHand = 'oak_wand'
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection: toViewProjection(state, []), onIntent: () => {} }))
    const wandRow = markup.match(/<div class="wr-item">(?:(?!<div class="wr-item">).)*?<b>Oak wand<\/b>(?:(?!<\/div>).)*?<\/div>/)?.[0]
    expect(wandRow).toBeDefined()
    expect(wandRow).toContain('aria-pressed="true"')
    expect(wandRow).not.toContain('disabled=""')
    expect(wandRow).toContain('>Unequip Off hand</button>')
    expect(wandRow).not.toContain('>Equip</button>')
  })

  it('equips the axe through the view intent and then harvests in the authoritative domain', () => {
    let state = createWizardWorld('greenway-alpha')
    const tree = state.resources.find((resource) => resource.kind === 'tree')!
    state = { ...state, player: { ...state.player, position: { ...tree.position } } }
    const equip = intentForView(state, { type: 'equipment.equip', stackId: 'inventory-woodcutters_axe', slot: 'mainHand' })!
    const equipped = advanceWizardWorld(state, [equip])
    expect(equipped.rejections).toEqual([])
    expect(equipped.state.player.equipment.mainHand).toBe('woodcutters_axe')
    const harvest = intentForView(equipped.state, { type: 'interact' })
    expect(harvest).toEqual({ type: 'harvest', resourceId: tree.id })
    const harvested = advanceWizardWorld(equipped.state, [harvest!])
    expect(harvested.rejections).toEqual([])
    expect(harvested.events.some((event) => event.type === 'resource_damaged' || event.type === 'resource_harvested')).toBe(true)
  })

  it('resolves interaction to the closest actionable tree or undiscovered ring', () => {
    const state = withAxeEquipped(copy(createWizardWorld('greenway-alpha')))
    const tree = state.resources.find((resource) => resource.kind === 'tree')!
    state.player.position = { ...tree.position }
    expect(toViewProjection(state, []).nearbyInteraction).toMatchObject({ kind: 'resource', action: 'Chop', actionable: true })
    expect(intentForView(state, { type: 'interact' })).toEqual({ type: 'harvest', resourceId: tree.id })

    const ringState = copy(createWizardWorld('greenway-alpha'))
    ringState.resources.forEach((resource) => { resource.depleted = true })
    ringState.player.position = { ...ringState.fairyRings[0].position }
    expect(intentForView(ringState, { type: 'interact' })).toEqual({ type: 'discover_fairy_ring', ringId: ringState.fairyRings[0].id })
  })

  it('offers Equip axe at a tree when the axe is owned but unequipped, and Needs axe when unowned', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    const tree = state.resources.find((resource) => resource.kind === 'tree')!
    state.player.position = { ...tree.position }
    expect(toViewProjection(state, []).nearbyInteraction).toMatchObject({ kind: 'resource', action: 'Equip axe', actionable: true })
    expect(intentForView(state, { type: 'interact' })).toEqual({ type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' })

    state.player.inventory = state.player.inventory.filter((stack) => stack.itemId !== 'woodcutters_axe')
    expect(toViewProjection(state, []).nearbyInteraction).toMatchObject({ kind: 'resource', action: 'Needs axe', actionable: false })
    expect(intentForView(state, { type: 'interact' })).toBeNull()
  })

  it('derives the guided objective from authoritative world state without mutating it', () => {
    const fresh = createWizardWorld('greenway-alpha')
    const before = JSON.stringify(fresh)
    expect(objectiveFor(fresh)).toBe('Greenway waystone: 3m east and 3m south. Study it to learn Wayfinder Glow.')
    expect(JSON.stringify(fresh)).toBe(before)

    const studied = copy(fresh)
    studied.player.learnedSpellIds = ['wayfinder_glow']
    studied.studiedInscriptionIds = ['greenway_waystone']
    expect(objectiveFor(studied)).toBe("Head north to the fog at Greenway's edge, then cast Wayfinder Glow.")

    const unowned = withFirstRegionCompleted(copy(fresh))
    unowned.player.inventory = []
    expect(objectiveFor(unowned)).toBe('Greenway Outfitters: 5m west and 1m north. Buy a woodcutter axe.')

    const state = withAxeEquipped(withFirstRegionCompleted(copy(fresh)))
    expect(objectiveFor(state)).toBe('Gather logs from Greenway oaks (0/4), then choose a ladder site on the map.')
    withLogs(state, 2)
    expect(objectiveFor(state)).toBe('Gather logs from Greenway oaks (2/4), then choose a ladder site on the map.')
    withLogs(state, 3)
    expect(objectiveFor(state)).toBe('Go north to a ◇ ladder site, choose it on the map, then Build (4 logs).')

    state.builtRouteIds = ['greenway_ladder']
    state.player.inventory = state.player.inventory.filter((stack) => stack.itemId !== 'logs')
    withLogs(state, 1)
    expect(objectiveFor(state)).toBe('Gather logs from Greenway oaks (1/6), then choose a bridge site on the map.')
    withLogs(state, 5)
    expect(objectiveFor(state)).toBe('Choose a Highland bridge site on the map and build it (6 logs).')

    state.builtRouteIds = ['greenway_ladder', 'highland_bridge']
    expect(objectiveFor(state)).toBe('Cross the Highland bridge east and discover the Highland fairy ring.')

    state.player.discoveredRingIds = ['ring-greenway', 'ring-highland']
    expect(objectiveFor(state)).toBe('Quest complete: fairy rings linked. Explore, trade, or travel to Highland again.')
    state.player.position = { ...state.fairyRings.find((ring) => ring.id === 'ring-highland')!.position }
    expect(objectiveFor(state)).toBe('Quest complete: both fairy rings are linked. Use the Highland Ring to travel home.')
  })

  it('updates waystone bearings from the real inscription and calls for Study in reach', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    const waystone = state.inscriptions.find((inscription) => inscription.id === 'greenway_waystone')!
    state.player.position = { ...waystone.position, x: waystone.position.x + 5 }
    expect(objectiveFor(state)).toContain('5m west')
    state.player.position = { ...waystone.position, z: waystone.position.z + 5 }
    expect(objectiveFor(state)).toContain('5m north')
    state.player.position = { ...waystone.position, x: waystone.position.x - 2 }
    expect(objectiveFor(state)).toBe('Study the Greenway waystone to learn Wayfinder Glow.')
    waystone.position = { ...waystone.position, x: -6, z: -4 }
    state.player.position = { ...state.player.position, x: 0, z: 0 }
    expect(objectiveFor(state)).toContain('6m west and 4m north')
    state.player.learnedSpellIds.push('wayfinder_glow')
    expect(objectiveFor(state)).toContain('cast Wayfinder Glow')
  })

  it('guides study, spell practice, tool-gated excavation, and a return sale', () => {
    const state = createWizardWorld('greenway-alpha')
    state.player.learnedSpellIds = ['wayfinder_glow']
    expect(objectiveFor(state)).toContain('cast Wayfinder Glow')
    state.player.skillXp.spellcraft = 40
    expect(objectiveFor(state)).toContain('Buy a field spade')
    state.revealedDigSiteIds.push('ridge_cache')
    expect(objectiveFor(state)).toContain('Buy a field spade')
    state.player.inventory.push({ itemId: 'field_spade', quantity: 1 })
    expect(objectiveFor(state)).toContain('Equip the field spade')
    state.player.equipment.mainHand = 'field_spade'
    expect(objectiveFor(state)).toContain('practice mound')
    state.excavatedDigSiteIds.push('practice_mound')
    expect(objectiveFor(state)).toContain('woodcutter axe')
    state.builtRouteIds.push('greenway_ladder')
    expect(objectiveFor(state)).toContain('ridge cache')
    state.excavatedDigSiteIds.push('ridge_cache')
    state.player.inventory.push({ itemId: 'ancient_relic', quantity: 1 })
    expect(objectiveFor(state)).toContain('Sell the ancient relic')
    expect(objectiveFor(state)).toContain('Greenway Outfitters')
    state.player.position = { ...state.player.position, x: 0, z: -8 }
    expect(objectiveFor(state)).toContain('Cross the Greenway ladder south')
    state.player.position = { ...state.player.position, x: 0, z: 0 }
    state.player.inventory = state.player.inventory.filter((stack) => stack.itemId !== 'ancient_relic')
    expect(objectiveFor(state)).toContain('bridge site')
  })

  it('guides spade buyers to Outfitters by identity even when Arcanum is nearer', () => {
    const state = createWizardWorld('greenway-alpha')
    state.player.learnedSpellIds = ['wayfinder_glow']
    state.player.skillXp.spellcraft = 40
    const store = state.stores.find((candidate) => candidate.id === 'store-greenway')!
    const arcanum = state.stores.find((candidate) => candidate.id === 'store-highland')!
    state.stores.reverse()
    state.player.position = { ...arcanum.position }
    expect(objectiveFor(state)).toBe('Greenway Outfitters: 13m west and 5m south. Buy a field spade.')
    state.player.position = { ...store.position, x: -7.2, z: 8.3 }
    expect(objectiveFor(state)).toBe('Greenway Outfitters: 2m east and 9m north. Buy a field spade.')

    store.position = { x: -8, y: 0, z: 6 }
    state.player.position = { x: -2.4, y: 0, z: 0.4 }
    const before = JSON.stringify(state)
    expect(objectiveFor(state)).toBe('Greenway Outfitters: 6m west and 6m south. Buy a field spade.')
    expect(JSON.stringify(state)).toBe(before)
    state.player.position = { x: -12, y: 0, z: 10 }
    expect(objectiveFor(state)).toBe('Greenway Outfitters: 4m east and 4m north. Buy a field spade.')
    state.player.position = { ...store.position, z: store.position.z + 3.01 }
    expect(objectiveFor(state)).toBe('Greenway Outfitters: 3m north. Buy a field spade.')
    state.player.position = { ...store.position, z: store.position.z + 3 }
    expect(objectiveFor(state)).toBe('Buy a field spade at Greenway Outfitters.')
  })

  it('guides axe purchases and relic sales to Outfitters, including local actions', () => {
    const state = withFirstRegionCompleted(createWizardWorld('greenway-alpha'))
    state.player.inventory = []
    const store = state.stores.find((candidate) => candidate.id === 'store-greenway')!
    state.player.position = { ...store.position, x: store.position.x - 5 }
    expect(objectiveFor(state)).toBe('Greenway Outfitters: 5m east. Buy a woodcutter axe.')
    state.player.position = { ...store.position, z: store.position.z + 2 }
    expect(objectiveFor(state)).toBe('Buy a woodcutter axe at Greenway Outfitters.')
    state.builtRouteIds = ['greenway_ladder']
    state.player.inventory.push({ itemId: 'ancient_relic', quantity: 1 })
    expect(objectiveFor(state)).toBe('Sell the ancient relic for 25g at Greenway Outfitters.')
    state.player.position = { ...store.position, x: store.position.x + 5 }
    expect(objectiveFor(state)).toBe('Greenway Outfitters: 5m west. Sell the ancient relic for 25g.')
    state.player.position = { ...store.position, z: -8 }
    expect(objectiveFor(state)).toBe('Cross the Greenway ladder south. Greenway Outfitters: 7m south. Sell the ancient relic for 25g.')
  })

  it('points to the authoritative practice mound after the spade is equipped', () => {
    const state = createWizardWorld('greenway-alpha')
    const mound = state.digSites.find((site) => site.id === 'practice_mound')!
    state.player.learnedSpellIds = ['wayfinder_glow']
    state.player.skillXp.spellcraft = 40
    state.player.inventory.push({ itemId: 'field_spade', quantity: 1 })
    state.player.equipment.mainHand = 'field_spade'
    state.player.position = { x: -2.7, y: mound.position.y, z: 0.8 }
    const before = JSON.stringify(state)
    expect(objectiveFor(state)).toBe('Greenway practice mound: 10m east and 2m south. Excavate it to train excavation.')
    expect(JSON.stringify(state)).toBe(before)
    state.player.position = { ...mound.position, x: mound.position.x - 5, z: mound.position.z + 4 }
    expect(objectiveFor(state)).toBe('Greenway practice mound: 5m east and 4m north. Excavate it to train excavation.')
    mound.position = { ...mound.position, x: -3, z: -2 }
    state.player.position = { ...mound.position, x: mound.position.x - 2 }
    expect(objectiveFor(state)).toBe('Excavate the Greenway practice mound to train excavation.')
  })

  it('explains how to cross a built ladder before the ridge cache is revealed', () => {
    const state = createWizardWorld('greenway-alpha')
    state.player.learnedSpellIds = ['wayfinder_glow']
    state.player.skillXp.spellcraft = 40
    state.excavatedDigSiteIds = ['practice_mound']
    state.builtRouteIds = ['greenway_ladder']
    expect(objectiveFor(state)).toContain('press E to cross north')
    state.player.position = { ...state.player.position, x: 0, z: -8 }
    expect(objectiveFor(state)).toContain('Cast Wayfinder Glow near the northern ridge')
  })

  it('marks a revealed ridge cache on the map and guides an already-crossed player northwest', () => {
    const state = createWizardWorld('greenway-alpha')
    state.player.learnedSpellIds = ['wayfinder_glow']
    state.player.skillXp.spellcraft = 40
    state.excavatedDigSiteIds = ['practice_mound']
    state.builtRouteIds = ['greenway_ladder']
    state.revealedDigSiteIds = ['ridge_cache']
    state.player.equipment.mainHand = 'field_spade'
    state.player.position = { ...state.player.position, x: 0, z: -8 }
    state.discoveredTileIds = state.tiles.map((tile) => tile.id)
    expect(toViewProjection(state, []).map.tiles.filter((tile) => tile.hasCache)).toHaveLength(1)
    expect(objectiveFor(state)).toContain('Search northwest of the ladder')
    state.excavatedDigSiteIds.push('ridge_cache')
    expect(toViewProjection(state, []).map.tiles.filter((tile) => tile.hasCache)).toHaveLength(0)
  })

  it('keeps the objective complete after traveling home and back to Highland', () => {
    const state = withFirstRegionCompleted(copy(createWizardWorld('greenway-alpha')))
    state.builtRouteIds = ['greenway_ladder', 'highland_bridge']
    state.player.discoveredRingIds = ['ring-greenway', 'ring-highland']
    const greenway = state.fairyRings.find((ring) => ring.id === 'ring-greenway')!.position
    const highland = state.fairyRings.find((ring) => ring.id === 'ring-highland')!.position
    for (const position of [highland, greenway, highland]) {
      state.player.position = { ...position }
      expect(objectiveFor(state)).toMatch(/^Quest complete:/)
    }
  })

  it('only announces linked travel once both fairy rings are discovered', () => {
    const linked = 'Quest complete: fairy rings linked. Explore, trade, or travel to Highland again.'
    const state = withAxeEquipped(withFirstRegionCompleted(copy(createWizardWorld('greenway-alpha'))))
    state.builtRouteIds = ['greenway_ladder', 'highland_bridge']

    state.player.discoveredRingIds = []
    expect(objectiveFor(state)).toBe('Cross the Highland bridge east and discover the Highland fairy ring.')

    state.player.discoveredRingIds = ['ring-greenway']
    expect(objectiveFor(state)).toBe('Cross the Highland bridge east and discover the Highland fairy ring.')

    state.player.discoveredRingIds = ['ring-highland']
    expect(objectiveFor(state)).toBe('Return to the Greenway and discover its fairy ring near the start to link travel home.')

    state.player.discoveredRingIds = ['ring-highland', 'ring-greenway']
    expect(objectiveFor(state)).toBe(linked)

    const earlyGreenway = withAxeEquipped(withFirstRegionCompleted(copy(createWizardWorld('greenway-alpha'))))
    earlyGreenway.player.discoveredRingIds = ['ring-greenway']
    expect(objectiveFor(earlyGreenway)).toBe('Gather logs from Greenway oaks (0/4), then choose a ladder site on the map.')
  })

  it('reflows the objective pill above the mobile touch controls instead of a nowrap overlay', () => {
    const mobile = /@media\(max-width:719px\)[^{]*\{(.*?)\}\n@media/s.exec(OBJECTIVE_STYLES)?.[1]
    expect(mobile).toBeDefined()
    const pill = /\.wr-objective\{([^}]*)\}/.exec(mobile!)?.[1] ?? ''
    const button = /\.wr-objective button\{([^}]*)\}/.exec(mobile!)?.[1] ?? ''
    expect(pill).toContain('white-space:normal')
    expect(pill).toContain('left:10px;right:10px')
    expect(pill).toContain('transform:none')
    const bottom = /bottom:calc\((\d+)px \+ env\(safe-area-inset-bottom/.exec(pill)
    expect(bottom).not.toBeNull()
    // .wr-touch occupies 14px inset + 2 x 58px d-pad rows + 5px gap = 135px from the bottom edge.
    expect(Number(bottom![1])).toBeGreaterThanOrEqual(135)
    expect(button).toContain('min-width:44px')
    expect(button).toContain('min-height:44px')
  })

  it('keeps mobile prompt and context surfaces out of the objective band', () => {
    const mobile = /@media\(max-width:719px\)[^{]*\{(.*?)\}\n@media/s.exec(OBJECTIVE_STYLES)![1]
    const rules = [...mobile.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selectors, body]) => ({ selectors: selectors.split(',').map((selector) => selector.trim()), body }))
    const declaration = (selector: string, property: string) => rules
      .filter((rule) => rule.selectors.includes(selector))
      .flatMap((rule) => rule.body.split(';'))
      .filter((entry) => entry.startsWith(`${property}:`)).pop()?.slice(property.length + 1)
    const px = (value: string | undefined) => Number(/^(?:calc\()?(\d+)px/.exec(value ?? '')?.[1] ?? NaN)

    const objectiveBottom = px(declaration('.wr-objective', 'bottom'))
    const objectiveMaxHeight = px(declaration('.wr-objective', 'max-height'))
    expect(objectiveBottom).toBeGreaterThanOrEqual(135)
    expect(objectiveMaxHeight).toBeGreaterThan(0)
    expect(px(declaration('.wr-objective span', 'max-height'))).toBeLessThanOrEqual(objectiveMaxHeight - 10)
    expect(declaration('.wr-objective span', 'overflow-y')).toBe('auto')

    const objectiveTop = objectiveBottom + objectiveMaxHeight
    for (const surface of ['.wr-surface .wr-prompt', '.wr-surface .wr-context']) {
      const value = declaration(surface, 'bottom')
      expect(value ?? '', `${surface} must be repositioned on mobile`).toContain('env(safe-area-inset-bottom')
      expect(px(value), `${surface} must sit above the objective band (${objectiveTop}px)`).toBeGreaterThanOrEqual(objectiveTop + 8)
    }
    expect(declaration('.wr-surface .wr-context', 'overflow-y')).toBe('auto')
    expect(declaration('.wr-surface .wr-context', 'max-height')).toContain('100vh')
    expect(mobile).not.toContain('pointer-events:none')
    expect(mobile).not.toContain('display:none')
  })

  it('removes the backpack collision while a compact-height context panel is open', () => {
    expect(OBJECTIVE_STYLES).toContain('@media(max-width:719px) and (max-height:590px)')
    expect(OBJECTIVE_STYLES).toContain('.wr-surface:has(.wr-context) .wr-backpack,.wr-surface .wr-events{display:none}')
  })

  it('uses the landscape control gap for the objective and keeps the prompt above the wizard', () => {
    const breakpoint = '@media(min-width:720px) and (max-width:900px) and (max-height:590px)'
    const landscape = OBJECTIVE_STYLES.split(breakpoint)[1]
    expect(landscape).toContain('.wr-objective{left:210px;right:96px;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:none}')
    expect(landscape).toContain('.wr-surface .wr-prompt{top:66px;bottom:auto}')
    expect(OBJECTIVE_STYLES).toContain('.wr-surface:has(.wr-context) .wr-backpack{display:none}')
    expect(OBJECTIVE_STYLES).toContain('.wr-surface .wr-context{left:8px;top:64px;bottom:auto;transform:none;box-sizing:border-box;width:min(300px,34vw);max-height:calc(100vh - 194px);overflow-y:auto}')
    expect(OBJECTIVE_STYLES).toContain('.wr-objective button{flex:none;min-width:44px;min-height:44px}')
  })

  it('selects the expanded preview only for the explicit query value', () => {
    expect(worldProfileForSearch('')).toBe('greenway-classic-v1')
    expect(worldProfileForSearch('?devRegion=expanded')).toBe('greenway-expanded-v1')
    expect(worldProfileForSearch('?other=1&devRegion=expanded')).toBe('greenway-expanded-v1')
    expect(worldProfileForSearch('?devRegion=classic')).toBe('greenway-classic-v1')
  })

  it('loads and persists expanded progress without reading or changing classic saves', () => {
    const classic = createWizardWorld('classic-progress')
    classic.tick = 8
    const classicSave = JSON.stringify({ ...classic, stores: legacyStores(classic), schemaVersion: 'wizard-world/v2', contentRevision: undefined })
    const saves = new Map([['wizard-realms:world:v2', classicSave], ['wizard-realms:world:v1', 'legacy-progress']])
    const readKeys: string[] = []
    const storage = {
      getItem: (key: string) => { readKeys.push(key); return saves.get(key) ?? null },
      setItem: (key: string, value: string) => { saves.set(key, value) },
    }
    const expanded = loadWorld(storage, 'greenway-expanded-v1')
    expect(readKeys).toEqual(['wizard-realms:world:expanded:v4', 'wizard-realms:world:expanded:v3', 'wizard-realms:world:expanded:v2', 'wizard-realms:world:expanded:v1'])
    expect(expanded.generationProfile).toBe('greenway-expanded-v1')
    expect(expanded.tiles).toHaveLength(256)
    expanded.tick = 12
    expect(persistWorld(storage, expanded, 'greenway-expanded-v1')).toBe(true)
    expect(saves.get('wizard-realms:world:expanded:v4')).toBe(serializeWizardWorld(expanded))
    expect(persistWorld(storage, expanded)).toBe(false)
    expect(saves.get('wizard-realms:world:v2')).toBe(classicSave)
    expect(saves.get('wizard-realms:world:v1')).toBe('legacy-progress')
    expect(loadWorld(storage, 'greenway-expanded-v1')).toEqual(expanded)
    expect(loadWorld(storage)).toMatchObject({ seed: classic.seed, tick: 8, generationProfile: 'greenway-classic-v1' })
    classic.tick = 9
    expect(persistWorld(storage, classic)).toBe(true)
    expect(saves.get('wizard-realms:world:v5')).toBe(serializeWizardWorld(classic))
    expect(saves.get('wizard-realms:world:v2')).toBe(classicSave)
    expect(saves.get('wizard-realms:world:expanded:v4')).toBe(serializeWizardWorld(expanded))
  })

  it('restarts only the expanded preview and reloads its new seed', () => {
    const classicSave = serializeWizardWorld(createWizardWorld('classic-progress'))
    const saves = new Map([['wizard-realms:world:v2', classicSave], ['wizard-realms:world:v1', 'legacy-progress']])
    const operations: string[] = []
    const storage = {
      getItem: (key: string) => saves.get(key) ?? null,
      setItem: (key: string, value: string) => { operations.push(`set:${key}`); saves.set(key, value) },
      removeItem: (key: string) => { operations.push(`remove:${key}`); saves.delete(key) },
    }
    resetSavedWorld(storage, 'expanded-first', createWizardWorld, 'greenway-expanded-v1')
    const restarted = resetSavedWorld(storage, 'expanded-second', createWizardWorld, 'greenway-expanded-v1')
    expect(operations).toEqual(['set:wizard-realms:world:expanded:v4', 'set:wizard-realms:world:expanded:v4'])
    expect(restarted).toEqual(createWizardWorld('expanded-second', 'greenway-expanded-v1'))
    expect(loadWorld(storage, 'greenway-expanded-v1')).toEqual(restarted)
    expect(saves.get('wizard-realms:world:v2')).toBe(classicSave)
    expect(saves.get('wizard-realms:world:v1')).toBe('legacy-progress')
  })

  it('migrates an expanded v2 save into a new key without changing its source bytes', () => {
    const prior = createWizardWorld('old-expanded', 'greenway-expanded-v1')
    prior.tick = 19
    prior.player.coins = 73
    prior.player.inventory.push({ itemId: 'logs', quantity: 4 })
    prior.resources[0].health = 0
    prior.resources[0].depleted = true
    const oldBytes = JSON.stringify({ ...prior, stores: legacyStores(prior), schemaVersion: 'wizard-world/v2', contentRevision: undefined })
    const saves = new Map([['wizard-realms:world:expanded:v1', oldBytes]])
    const storage = {
      getItem: (key: string) => saves.get(key) ?? null,
      setItem: (key: string, value: string) => { saves.set(key, value) },
    }
    const migrated = loadWorld(storage, 'greenway-expanded-v1')
    expect(migrated).toMatchObject({ seed: prior.seed, tick: 19, generationProfile: 'greenway-expanded-v1', player: { coins: 73, inventory: prior.player.inventory } })
    expect(migrated.resources.find((resource) => resource.id === prior.resources[0].id)).toMatchObject({ health: 0, depleted: true })
    expect(persistWorld(storage, migrated, 'greenway-expanded-v1')).toBe(true)
    expect(saves.get('wizard-realms:world:expanded:v1')).toBe(oldBytes)
    expect(saves.get('wizard-realms:world:expanded:v4')).toBe(serializeWizardWorld(migrated))
    expect(loadWorld(storage, 'greenway-expanded-v1')).toEqual(migrated)
  })

  it('preserves a structurally incomplete old v2 save instead of overwriting it during migration', () => {
    const damaged = '{"schemaVersion":"wizard-world/v2","seed":"damaged","generationProfile":"greenway-classic-v1"}'
    const saves = new Map([['wizard-realms:world:v2', damaged]])
    const storage = {
      getItem: (key: string) => saves.get(key) ?? null,
      setItem: (key: string, value: string) => { saves.set(key, value) },
    }
    const freshInMemory = loadWorld(storage)
    expect(freshInMemory.seed).toBe('greenway-alpha')
    expect(persistWorld(storage, freshInMemory)).toBe(false)
    expect(saves.get('wizard-realms:world:v2')).toBe(damaged)
    expect(saves.has('wizard-realms:world:v5')).toBe(false)
  })

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)('preserves incompatible %s save bytes through repeated autosave batches', (profile) => {
    const key = profile === 'greenway-classic-v1' ? 'wizard-realms:world:v5' : 'wizard-realms:world:expanded:v4'
    const otherProfile = profile === 'greenway-classic-v1' ? 'greenway-expanded-v1' : 'greenway-classic-v1'
    const incompatibleSaves = [
      'not-json',
      'null',
      JSON.stringify({ schemaVersion: 'wizard-world/v4', seed: 'future', generationProfile: profile }),
      JSON.stringify({ ...createWizardWorld('future-revision', profile), contentRevision: 'greenway-region-v99' }),
      serializeWizardWorld(createWizardWorld('wrong-profile', otherProfile)),
      JSON.stringify({ schemaVersion: 'wizard-world/v2', seed: 'unknown-profile', generationProfile: 'unknown' }),
      JSON.stringify({ schemaVersion: 'wizard-world/v1', seed: 'v1-wrong-profile', generationProfile: otherProfile }),
      ...(profile === 'greenway-expanded-v1' ? [JSON.stringify({ schemaVersion: 'wizard-world/v1', seed: 'legacy-classic' })] : []),
    ]
    for (const incompatible of incompatibleSaves) {
      const saves = new Map([[key, incompatible]])
      const writes: string[] = []
      const storage = {
        getItem: (itemKey: string) => saves.get(itemKey) ?? null,
        setItem: (itemKey: string, value: string) => { writes.push(itemKey); saves.set(itemKey, value) },
      }
      let world = loadWorld(storage, profile)
      let clock = IDLE_CLOCK
      expect(world.generationProfile).toBe(profile)
      for (const nowMs of [0, 50, 100, 150]) {
        const result = runBatch({ clock, nowMs, world, queued: [], movement: [0, 0] }, {
          commit: () => {}, persist: (state) => { expect(persistWorld(storage, state, profile)).toBe(false) },
        })
        clock = result.clock
        world = result.world
        expect(saves.get(key)).toBe(incompatible)
      }
      expect(world.tick).toBe(3)
      expect(writes).toEqual([])
    }
  })

  it('revalidates an externally changed save after a locally verified autosave', () => {
    const key = 'wizard-realms:world:v5'
    const saves = new Map<string, string>()
    const storage = {
      getItem: (itemKey: string) => saves.get(itemKey) ?? null,
      setItem: (itemKey: string, value: string) => { saves.set(itemKey, value) },
    }
    const local = createWizardWorld('local-cache')
    expect(persistWorld(storage, local)).toBe(true)
    const external = '{"schemaVersion":"wizard-world/v5","seed":"future"}'
    saves.set(key, external)
    expect(persistWorld(storage, local)).toBe(false)
    expect(saves.get(key)).toBe(external)
  })

  it('refuses to overwrite a valid save with a forged selected route site', () => {
    const key = 'wizard-realms:world:v5'
    const saves = new Map<string, string>()
    const storage = {
      getItem: (itemKey: string) => saves.get(itemKey) ?? null,
      setItem: (itemKey: string, value: string) => { saves.set(itemKey, value) },
    }
    const valid = createWizardWorld('route-save-guard')
    expect(persistWorld(storage, valid)).toBe(true)
    const originalBytes = saves.get(key)
    const forged = copy(valid)
    forged.builtRouteIds.push('greenway_ladder')
    forged.routes[0].siteId = 'greenway_ladder:x:999'
    expect(persistWorld(storage, forged)).toBe(false)
    expect(saves.get(key)).toBe(originalBytes)
  })

  it('backs up an incompatible newest save before recovering a valid v4 expedition', () => {
    const prior = createWizardWorld('saved-expedition', 'greenway-expanded-v1')
    prior.builtRouteIds.push('greenway_ladder')
    prior.player.coins = 87
    const priorBytes = legacyV4Save(prior)
    const invalid = copy(prior)
    const invalidBytes = serializeWizardWorld(invalid)
    const saves = new Map([
      ['wizard-realms:world:expanded:v4', invalidBytes],
      ['wizard-realms:world:expanded:v3', priorBytes],
    ])
    const storage = {
      getItem: (key: string) => saves.get(key) ?? null,
      setItem: (key: string, bytes: string) => { saves.set(key, bytes) },
    }
    expect(recoverablePriorSaveKey(storage, 'greenway-expanded-v1')).toBe('wizard-realms:world:expanded:v3')
    expect(loadWorld(storage, 'greenway-expanded-v1').seed).toBe('greenway-alpha')
    const recovered = recoverPriorSavedWorld(storage, 'greenway-expanded-v1', 'test-1')!
    expect(recovered.seed).toBe(prior.seed)
    expect(recovered.player.coins).toBe(87)
    expect(recovered.routes[0].siteId).toBe('greenway_ladder:x:0')
    expect(saves.get('wizard-realms:world:expanded:v4:recovery-backup:test-1')).toBe(invalidBytes)
    expect(saves.get('wizard-realms:world:expanded:v3')).toBe(priorBytes)
    expect(saves.get('wizard-realms:world:expanded:v4')).toBe(serializeWizardWorld(recovered))
    expect(loadWorld(storage, 'greenway-expanded-v1')).toEqual(recovered)
    expect(recoverablePriorSaveKey(storage, 'greenway-expanded-v1')).toBeNull()
  })

  it('preserves an invalid active legacy save without creating a classic v5 save', () => {
    const legacy = '{"schemaVersion":"wizard-world/v4","seed":"future"}'
    const saves = new Map([['wizard-realms:world:v1', legacy]])
    const storage = {
      getItem: (key: string) => saves.get(key) ?? null,
      setItem: (key: string, value: string) => { saves.set(key, value) },
    }
    let world = loadWorld(storage)
    let clock = IDLE_CLOCK
    for (const nowMs of [0, 50, 100]) {
      const result = runBatch({ clock, nowMs, world, queued: [], movement: [0, 0] }, {
        commit: () => {}, persist: (state) => { expect(persistWorld(storage, state)).toBe(false) },
      })
      clock = result.clock
      world = result.world
    }
    expect(world.tick).toBe(2)
    expect(saves.get('wizard-realms:world:v1')).toBe(legacy)
    expect(saves.has('wizard-realms:world:v5')).toBe(false)
  })

  it('persists valid current and legacy classic saves after their next batch', () => {
    const original = createWizardWorld('known-progress')
    const oldV2 = JSON.stringify({ ...original, stores: legacyStores(original), schemaVersion: 'wizard-world/v2', generationProfile: undefined, contentRevision: undefined })
    const legacyV1 = JSON.stringify({
      schemaVersion: 'wizard-world/v1', seed: original.seed, tick: original.tick, fixedStepMs: original.fixedStepMs,
      rng: original.rng, tiles: original.tiles, resources: legacyV1Resources(original), stores: legacyStores(original),
      fairyRings: original.fairyRings, player: original.player, eventSequence: original.eventSequence,
    })
    const oldV3 = JSON.stringify({ ...original, stores: legacyStores(original), schemaVersion: 'wizard-world/v3', contentRevision: 'greenway-region-v1' })
    for (const [key, saved] of [['wizard-realms:world:v5', serializeWizardWorld(original)], ['wizard-realms:world:v4', legacyV4Save(original)], ['wizard-realms:world:v3', oldV3], ['wizard-realms:world:v2', oldV2], ['wizard-realms:world:v1', legacyV1]] as const) {
      const saves = new Map<string, string>([[key, saved]])
      const storage = {
        getItem: (itemKey: string) => saves.get(itemKey) ?? null,
        setItem: (itemKey: string, value: string) => { saves.set(itemKey, value) },
      }
      const world = loadWorld(storage)
      expect(world.seed).toBe('known-progress')
      expect(world.generationProfile).toBe('greenway-classic-v1')
      const next = stepBatch(world, [], [0, 0], 50).state
      expect(persistWorld(storage, next)).toBe(true)
      expect(saves.get('wizard-realms:world:v5')).toBe(serializeWizardWorld(next))
      if (key !== 'wizard-realms:world:v5') expect(saves.get(key)).toBe(saved)
    }
  })

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)('replaces a blocked %s save only through explicit reset', (profile) => {
    const key = profile === 'greenway-classic-v1' ? 'wizard-realms:world:v5' : 'wizard-realms:world:expanded:v4'
    const original = '{"schemaVersion":"wizard-world/v3","seed":"future"}'
    const saves = new Map([[key, original], ['wizard-realms:world:v1', 'legacy']])
    const operations: string[] = []
    const storage = {
      getItem: (itemKey: string) => saves.get(itemKey) ?? null,
      setItem: (itemKey: string, value: string) => { operations.push(`set:${itemKey}`); saves.set(itemKey, value) },
      removeItem: (itemKey: string) => { operations.push(`remove:${itemKey}`); saves.delete(itemKey) },
    }
    expect(persistWorld(storage, loadWorld(storage, profile), profile)).toBe(false)
    expect(saves.get(key)).toBe(original)
    const fresh = resetSavedWorld(storage, 'confirmed-new-expedition', createWizardWorld, profile)
    expect(operations).toEqual([`set:${key}`])
    expect(saves.get(key)).toBe(serializeWizardWorld(fresh))
    expect(saves.get('wizard-realms:world:v1')).toBe('legacy')
    expect(persistWorld(storage, stepBatch(fresh, [], [0, 0], 50).state, profile)).toBe(true)
    expect(saves.get(key)).not.toBe(original)
  })

  it.each([
    ['greenway-classic-v1', '', 'wizard-realms:world:v5'],
    ['greenway-expanded-v1', '?devRegion=expanded', 'wizard-realms:world:expanded:v4'],
  ] as const)('renders the %s save warning only for an incompatible active save', (profile, search, key) => {
    const saves = new Map<string, string>([[key, '{"schemaVersion":"wizard-world/v3","seed":"future"}']])
    vi.stubGlobal('window', { location: { search }, localStorage: { getItem: (itemKey: string) => saves.get(itemKey) ?? null }, ResizeObserver: class {} })
    try {
      expect(renderToStaticMarkup(createElement(App))).toContain('role="alert">Play is unsaved. Existing save is preserved.')
      saves.set(key, serializeWizardWorld(createWizardWorld('valid', profile)))
      expect(renderToStaticMarkup(createElement(App))).not.toContain('role="alert"')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('writes a fresh seeded world under v5 while retaining the legacy backup', () => {
    const saves = new Map([['wizard-realms:world:v2', 'previous'], ['wizard-realms:world:v1', 'legacy']])
    const operations: string[] = []
    const storage = {
      setItem: (key: string, value: string) => { operations.push(`set:${key}`); saves.set(key, value) },
      removeItem: (key: string) => { operations.push(`remove:${key}`); saves.delete(key) },
    }
    const fresh = resetSavedWorld(storage)
    expect(operations).toEqual(['set:wizard-realms:world:v5'])
    expect(saves.get('wizard-realms:world:v5')).toBe(serializeWizardWorld(fresh))
    expect(saves.get('wizard-realms:world:v2')).toBe('previous')
    expect(saves.get('wizard-realms:world:v1')).toBe('legacy')
    expect(fresh.seed).toBe('greenway-alpha')
    expect(fresh.builtRouteIds).toEqual([])
    expect(fresh.player.equipment.mainHand).toBeNull()
    expect(JSON.stringify(fresh)).toBe(JSON.stringify(createWizardWorld('greenway-alpha')))
  })

  it('resets into an explicit alternate seed', () => {
    const removed: string[] = []
    const fresh = resetSavedWorld({ setItem: () => {}, removeItem: (key) => { removed.push(key) } }, 'greenway-beta')
    expect(removed).toEqual([])
    expect(fresh).toEqual(createWizardWorld('greenway-beta'))
    expect(fresh.tiles).not.toEqual(createWizardWorld('greenway-alpha').tiles)
  })

  it('preserves both saves if generation or serialization fails', () => {
    const saves = new Map([['wizard-realms:world:v2', 'previous'], ['wizard-realms:world:v1', 'legacy']])
    const before = [...saves]
    const storage = { setItem: (key: string, value: string) => { saves.set(key, value) }, removeItem: (key: string) => { saves.delete(key) } }
    expect(() => resetSavedWorld(storage, 'unqualifiable', () => { throw new Error('No safe world') })).toThrow('No safe world')
    const circular = createWizardWorld('greenway-alpha') as WizardWorldState & { self?: WizardWorldState }
    circular.self = circular
    expect(() => resetSavedWorld(storage, 'greenway-alpha', () => circular)).toThrow()
    expect([...saves]).toEqual(before)
  })

  it('preserves both saves when the new save write fails', () => {
    const saves = new Map([['wizard-realms:world:v2', 'previous'], ['wizard-realms:world:v1', 'legacy']])
    const before = [...saves]
    const storage = { setItem: () => { throw new Error('Write blocked') }, removeItem: (key: string) => { saves.delete(key) } }
    expect(() => resetSavedWorld(storage)).toThrow('Write blocked')
    expect([...saves]).toEqual(before)
  })

  it('reloads saved alternate-seed progress from current and legacy keys', () => {
    const saved = copy(createWizardWorld('greenway-beta'))
    saved.tick = 7
    saved.player.coins = 83
    saved.player.inventory.push({ itemId: 'logs', quantity: 3 })
    saved.builtRouteIds.push('greenway_ladder')
    saved.routes.find((route) => route.id === 'greenway_ladder')!.siteId = 'greenway_ladder:x:0'
    const serialized = serializeWizardWorld(saved)
    expect(loadWorld({ getItem: (key) => key === 'wizard-realms:world:v5' ? serialized : null })).toEqual(saved)

    const legacy = JSON.stringify({ ...saved, resources: legacyV1Resources(saved), stores: legacyStores(saved), schemaVersion: 'wizard-world/v1' })
    expect(loadWorld({ getItem: (key) => key === 'wizard-realms:world:v1' ? legacy : null })).toMatchObject({
      schemaVersion: 'wizard-world/v5', seed: 'greenway-beta', tick: 7, builtRouteIds: ['greenway_ladder'],
      player: { coins: 83, inventory: saved.player.inventory },
    })
  })

  it('opens store listings only by interaction, exposes Close, and preserves ring guidance', () => {
    const storeState = copy(createWizardWorld('greenway-alpha'))
    storeState.resources.forEach((resource) => { resource.depleted = true })
    storeState.player.position = { ...storeState.stores[0].position }
    const closed = toViewProjection(storeState, [])
    expect(closed.nearbyInteraction).toMatchObject({ kind: 'store', action: 'Open store', actionable: true })
    expect(closed.openStoreId).toBeNull()
    const closedMarkup = renderToStaticMarkup(createElement(WizardHud, { projection: closed, onIntent: () => {} }))
    expect(closedMarkup).toContain('<b>Open store</b>Greenway Outfitters')
    expect(closedMarkup).not.toContain('wr-panel wr-context')
    expect(intentForView(storeState, { type: 'interact' })).toBeNull()
    const open = toViewProjection(storeState, [], storeState.stores[0].id)
    expect(open.nearbyInteraction).toMatchObject({ kind: 'store', action: 'Store open', actionable: false })
    const openMarkup = renderToStaticMarkup(createElement(WizardHud, { projection: open, onIntent: () => {} }))
    expect(openMarkup).toContain('>Close</button>')
    expect(openMarkup).toContain('<b>Apprentice hat</b>')
    const emitted: unknown[] = []
    const hud = WizardHud({ projection: open, onIntent: (intent) => emitted.push(intent) })
    const panel = (hud.props.children as unknown[]).find((child) => isValidElement<{ className?: string }>(child) && child.props.className === 'wr-panel wr-context')
    if (!isValidElement<{ children: unknown[] }>(panel)) throw new Error('Expected store panel')
    const close = panel.props.children.find((child) => isValidElement<{ children?: unknown }>(child) && child.props.children === 'Close')
    if (!isValidElement<{ onClick: () => void }>(close)) throw new Error('Expected Close button')
    close.props.onClick()
    expect(emitted).toEqual([{ type: 'store.close' }])
    expect(intentForView(storeState, { type: 'store.close' })).toBeNull()

    const ringState = copy(createWizardWorld('greenway-alpha'))
    ringState.resources.forEach((resource) => { resource.depleted = true })
    ringState.player.discoveredRingIds = ringState.fairyRings.map((ring) => ring.id)
    ringState.player.position = { ...ringState.fairyRings[0].position }
    expect(toViewProjection(ringState, []).nearbyInteraction).toMatchObject({ kind: 'fairy-ring', action: 'Choose destination', actionable: false })
    expect(intentForView(ringState, { type: 'interact' })).toBeNull()
    ringState.player.discoveredRingIds = [ringState.fairyRings[0].id]
    expect(toViewProjection(ringState, []).nearbyInteraction).toMatchObject({ kind: 'fairy-ring', action: 'Find another ring', actionable: false })
  })

  it('makes the shop the E target when an incidental tree is closer', () => {
    const state = createWizardWorld('greenway-alpha')
    const store = state.stores[0]
    const nearbyTree = state.resources.find((resource) => resource.kind === 'tree')!
    nearbyTree.position = { ...store.position, x: store.position.x - 0.4 }
    state.player.position = { ...store.position, x: store.position.x - 0.3 }
    const projection = toViewProjection(state, [])
    expect(projection.nearbyInteraction).toMatchObject({ kind: 'store', targetId: store.id, action: 'Open store' })
    expect(projection.nearbyStoreId).toBe(store.id)
    expect(intentForView(state, { type: 'interact' })).toBeNull()
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection, onIntent: vi.fn() }))
    expect(markup).toContain(`aria-label="Open ${store.name}"`)
    expect(intentForView(state, { type: 'store.open', storeId: store.id })).toBeNull()
  })

  it('projects regional material offers and routes a committed sale back into saved progress', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    state.player.position = { ...state.stores[0].position }
    state.player.inventory.push({ itemId: 'logs', quantity: 3 }, { itemId: 'marsh_herb', quantity: 2 })
    state.player.equipment.mainHand = 'woodcutters_axe'
    const projection = toViewProjection(state, [], state.stores[0].id)
    expect(projection.stores[0].sellOffers).toEqual([
      { itemId: 'logs', name: 'Greenway logs', quantity: 3, unitPrice: 2 },
      { itemId: 'marsh_herb', name: 'Marsh herb', quantity: 2, unitPrice: 3 },
    ])
    expect(projection.stores[1].sellOffers).toEqual([
      { itemId: 'logs', name: 'Greenway logs', quantity: 3, unitPrice: 1 },
      { itemId: 'marsh_herb', name: 'Marsh herb', quantity: 2, unitPrice: 5 },
    ])
    const intent = intentForView(state, { type: 'store.sell-item', storeId: state.stores[0].id, itemId: 'logs', quantity: 3 }, state.stores[0].id)
    expect(intent).toEqual({ type: 'sell_to_store', storeId: state.stores[0].id, itemId: 'logs', quantity: 3 })
    if (!intent) throw new Error('Expected a sale intent')
    const result = advanceWizardWorld(state, [intent])
    expect(result.rejections).toEqual([])
    expect(result.state.player.coins).toBe(state.player.coins + 6)
    expect(result.state.player.inventory.some((stack) => stack.itemId === 'logs')).toBe(false)
    expect(loadWorld({ getItem: (key) => key === 'wizard-realms:world:v5' ? serializeWizardWorld(result.state) : null })).toEqual(result.state)
  })

  it('maps unequip through authority and projects the cleared visual slot after reload', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    state.player.equipment.mainHand = 'woodcutters_axe'
    expect(toViewProjection(state, []).equipment.mainHand?.itemId).toBe('woodcutters_axe')
    const intent = intentForView(state, { type: 'equipment.unequip', slot: 'mainHand' })
    expect(intent).toEqual({ type: 'unequip_item', slot: 'mainHand' })
    if (!intent) throw new Error('Expected an unequip intent')
    const result = advanceWizardWorld(state, [intent])
    expect(result.rejections).toEqual([])
    expect(toViewProjection(result.state, []).equipment.mainHand).toBeNull()
    expect(result.state.player.inventory).toEqual(state.player.inventory)
    expect(loadWorld({ getItem: (key) => key === 'wizard-realms:world:v5' ? serializeWizardWorld(result.state) : null }).player.equipment.mainHand).toBeNull()
  })

  it('forgets an open store on departure so returning does not reopen it', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    state.resources.forEach((resource) => { resource.depleted = true })
    const store = state.stores[0]
    state.player.position = { ...store.position }
    expect(retainOpenStoreId(state, store.id)).toBe(store.id)
    state.player.position = { ...store.position, x: store.position.x + 10 }
    const closed = retainOpenStoreId(state, store.id)
    expect(closed).toBeNull()
    expect(toViewProjection(state, [], store.id).openStoreId).toBeNull()
    state.player.position = { ...store.position }
    expect(retainOpenStoreId(state, closed)).toBeNull()
    expect(toViewProjection(state, [], closed).openStoreId).toBeNull()
  })

  it.each(['resource', 'fairy-ring', 'route'] as const)('keeps an open store active when a nearer %s appears', (kind) => {
    const state = copy(createWizardWorld('greenway-alpha'))
    state.resources.forEach((resource) => { resource.depleted = true })
    const store = state.stores[0]
    state.player.position = { ...store.position, x: store.position.x + 1 }
    if (kind === 'resource') {
      const tree = state.resources.find((resource) => resource.kind === 'tree')!
      tree.depleted = false
      tree.position = { ...state.player.position }
    } else if (kind === 'fairy-ring') state.fairyRings[0].position = { ...state.player.position }
    else { state.routes[0].from = { ...state.player.position }; state.builtRouteIds.push(state.routes[0].id) }
    expect(toViewProjection(state, []).nearbyInteraction?.kind).toBe(kind === 'resource' ? 'store' : kind)
    expect(intentForView(state, { type: 'interact' }) === null).toBe(kind === 'resource')
    expect(retainOpenStoreId(state, store.id)).toBe(store.id)
    const open = toViewProjection(state, [], store.id)
    expect(open.nearbyInteraction).toMatchObject({ kind: 'store', targetId: store.id, action: 'Store open', actionable: false })
    expect(intentForView(state, { type: 'interact' }, store.id)).toBeNull()
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection: open, onIntent: () => {} }))
    expect(markup).toContain(`<header>${store.name}</header>`)
    expect(markup.match(/class="wr-panel wr-context"/g)).toHaveLength(1)
  })

  it('lets E study a nearby unlearned waystone even when an oak is closer', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    const waystone = state.inscriptions.find((inscription) => inscription.id === 'greenway_waystone')!
    const oak = state.resources.find((resource) => resource.kind === 'tree')!
    state.player.position = { ...waystone.position }
    oak.position = { ...waystone.position }
    expect(toViewProjection(state, []).nearbyInteraction)
      .toMatchObject({ kind: 'inscription', targetId: waystone.id, action: 'Study', actionable: true })
    const intent = intentForView(state, { type: 'interact' })
    expect(intent).toEqual({ type: 'study_inscription', inscriptionId: waystone.id })
    const studied = advanceWizardWorld(state, [intent!])
    expect(studied.rejections).toEqual([])
    expect(studied.events.some((event) => event.type === 'inscription_studied')).toBe(true)
    expect(studied.state.player.learnedSpellIds).toContain('wayfinder_glow')
  })

  it('uses E to excavate a visible mound instead of switching from spade to a closer oak', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    const mound = state.digSites.find((site) => site.id === 'practice_mound')!
    const oak = state.resources.find((resource) => resource.kind === 'tree')!
    state.player.position = { ...mound.position }
    oak.position = { ...mound.position }
    state.player.inventory.push({ itemId: 'field_spade', quantity: 1 })
    state.player.equipment.mainHand = 'field_spade'
    expect(toViewProjection(state, []).nearbyInteraction)
      .toMatchObject({ kind: 'dig-site', targetId: mound.id, action: 'Excavate', actionable: true })
    const intent = intentForView(state, { type: 'interact' })
    expect(intent).toEqual({ type: 'dig_site', digSiteId: mound.id })
    const dug = advanceWizardWorld(state, [intent!])
    expect(dug.rejections).toEqual([])
    expect(dug.state.excavatedDigSiteIds).toContain(mound.id)
    expect(dug.state.player.equipment.mainHand).toBe('field_spade')

    state.player.equipment.mainHand = 'woodcutters_axe'
    expect(toViewProjection(state, []).nearbyInteraction)
      .toMatchObject({ kind: 'dig-site', action: 'Equip spade', actionable: true })
    expect(intentForView(state, { type: 'interact' }))
      .toEqual({ type: 'equip_item', itemId: 'field_spade', slot: 'mainHand' })
  })

  it('selects construction independently of nearest interaction and only crosses a built route', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    state.resources.forEach((resource) => { resource.depleted = true })
    const ladder = state.routes.find((route) => route.id === 'greenway_ladder')!
    state.player.position = { ...ladder.from }
    const site = routeBuildOptions(state).find((candidate) => candidate.id === 'greenway_ladder:x:0')!
    expect(toViewProjection(state, [], null, site.id).selectedBuildSiteId).toBe(site.id)
    expect(toViewProjection(state, []).nearbyInteraction?.kind).not.toBe('route')
    expect(intentForView(state, { type: 'build-site.confirm', siteId: site.id })).toEqual({ type: 'build_route', routeId: 'greenway_ladder', siteId: site.id })
    ladder.siteId = site.id
    state.builtRouteIds.push('greenway_ladder')
    const oak = state.resources.find((resource) => resource.kind === 'tree')!
    oak.depleted = false
    oak.position = { ...state.player.position, x: state.player.position.x + 0.1 }
    expect(toViewProjection(state, []).nearbyInteraction).toMatchObject({ kind: 'route', action: 'Cross', actionable: true })
    expect(intentForView(state, { type: 'interact' })).toEqual({ type: 'traverse_route', routeId: 'greenway_ladder' })
  })

  it('commits and reloads a non-default ladder chosen in the atlas', () => {
    const state = createWizardWorld('greenway-alpha')
    state.player.inventory.push({ itemId: 'logs', quantity: 4 })
    state.discoveredTileIds = state.tiles.map((tile) => tile.id)
    const site = routeBuildOptions(state).find((candidate) => candidate.id === 'greenway_ladder:x:-2')!
    state.player.position = { ...site.from }
    expect(routeBuildOptions(state).find((candidate) => candidate.id === site.id)?.status).toBe('ready')
    const projection = toViewProjection(state, [], null, site.id)
    expect(projection.selectedBuildSiteId).toBe(site.id)
    expect(projection.buildSites.find((candidate) => candidate.id === site.id)).toMatchObject({ discovered: true, status: 'ready' })
    const intent = intentForView(state, { type: 'build-site.confirm', siteId: site.id })
    expect(intent).toEqual({ type: 'build_route', routeId: 'greenway_ladder', siteId: site.id })
    if (!intent) throw new Error('Expected selected build intent')
    const built = advanceWizardWorld(state, [intent])
    expect(built.rejections).toEqual([])
    expect(built.state.routes[0]).toMatchObject({ siteId: site.id, from: site.from, to: site.to })
    expect(built.state.player.inventory.some((stack) => stack.itemId === 'logs')).toBe(false)
    const saves = new Map<string, string>()
    const storage = {
      getItem: (key: string) => saves.get(key) ?? null,
      setItem: (key: string, bytes: string) => { saves.set(key, bytes) },
    }
    expect(persistWorld(storage, built.state)).toBe(true)
    const reloaded = loadWorld(storage)
    expect(reloaded.routes[0]).toEqual(built.state.routes[0])
    expect(toViewProjection(reloaded, []).map.tiles.some((tile) => tile.hasBuiltRoute)).toBe(true)
  })

  it('keeps Highland store access and reverse bridge traversal distinct at generated anchors', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    state.resources.forEach((resource) => { resource.depleted = true })
    state.builtRouteIds = ['greenway_ladder', 'highland_bridge']
    const bridge = state.routes.find((route) => route.id === 'highland_bridge')!
    const store = state.stores.find((candidate) => candidate.id === 'store-highland')!
    const ring = state.fairyRings.find((candidate) => candidate.id === 'ring-highland')!
    expect(new Set([[bridge.to.x, bridge.to.z], [store.position.x, store.position.z], [ring.position.x, ring.position.z]].map(String)).size).toBe(3)

    state.player.position = { ...store.position }
    expect(toViewProjection(state, []).nearbyInteraction).toMatchObject({ kind: 'store', targetId: store.id, action: 'Open store', actionable: true })

    state.player.position = { ...bridge.to }
    expect(toViewProjection(state, []).nearbyInteraction).toMatchObject({ kind: 'route', targetId: bridge.id, action: 'Cross', actionable: true })
    expect(intentForView(state, { type: 'interact' })).toEqual({ type: 'traverse_route', routeId: bridge.id })
  })
})

describe('Fixed-step scheduler', () => {
  const world = () => createWizardWorld('greenway-alpha')
  const recordingSink = () => {
    const calls = { commit: 0, persist: 0, messages: [] as string[] }
    const sink: BatchSink = {
      commit: (_state, messages) => { calls.commit += 1; calls.messages.push(...messages) },
      persist: () => { calls.persist += 1 },
    }
    return { sink, calls }
  }

  it('runs exactly ten 50 ms steps for a 500 ms backlog below the catch-up cap', () => {
    expect(MAX_CATCH_UP_STEPS).toBeGreaterThanOrEqual(10)
    const batch = stepBatch(world(), [], [0, 0], 500)
    expect(batch.steps).toBe(10)
    expect(batch.remainderMs).toBe(0)
    expect(batch.state.tick).toBe(world().tick + 10)
  })

  it('caps catch-up at MAX_CATCH_UP_STEPS and discards the excess backlog', () => {
    const batch = stepBatch(world(), [], [0, 0], MAX_CATCH_UP_STEPS * 50 + 730)
    expect(batch.steps).toBe(MAX_CATCH_UP_STEPS)
    expect(batch.remainderMs).toBe(0)
  })

  it('carries the fractional remainder into the next callback', () => {
    const first = stepBatch(world(), [], [0, 0], 130)
    expect(first).toMatchObject({ steps: 2, remainderMs: 30 })
    const second = stepBatch(first.state, [], [0, 0], first.remainderMs + 70)
    expect(second).toMatchObject({ steps: 2, remainderMs: 0 })
    expect(stepBatch(world(), [], [0, 0], 49)).toMatchObject({ steps: 0, remainderMs: 49 })
  })

  it('produces the same state as sequential fixed-step advancement', () => {
    let sequential = world()
    for (let step = 0; step < 10; step += 1) sequential = advanceWizardWorld(sequential, controlIntents(sequential, [1, 1])).state
    const batch = stepBatch(world(), [], [1, 1], 500)
    expect(batch.state).toEqual(sequential)
    expect(batch.state.player.yaw).toBeCloseTo(world().player.yaw - 10 * PIVOT_RADIANS_PER_TICK)
  })

  it('applies a queued discrete intent once while held movement runs every catch-up step', () => {
    const start = world()
    const batch = stepBatch(start, [{ type: 'jump' }], [0, 1], 250)
    expect(batch.steps).toBe(5)
    expect(batch.events.filter((event) => event.type === 'player_jumped')).toHaveLength(1)
    expect(batch.events.map((event) => event.tick)).toEqual([...batch.events.map((event) => event.tick)].sort((a, b) => a - b))
    const travelled = Math.hypot(batch.state.player.position.x - start.player.position.x, batch.state.player.position.z - start.player.position.z)
    expect(travelled).toBeCloseTo(5 * 0.16, 5)
  })

  it('resets elapsed time on visibility change so resume does not replay the hidden interval', () => {
    let clock = accumulateElapsed(IDLE_CLOCK, 1000)
    expect(clock.accumulatedMs).toBe(0)
    clock = accumulateElapsed(clock, 1050)
    expect(clock.accumulatedMs).toBe(50)
    clock = IDLE_CLOCK
    const resumed = accumulateElapsed(clock, 61050)
    expect(resumed.accumulatedMs).toBe(0)
    expect(accumulateElapsed(resumed, 61100).accumulatedMs).toBe(50)
    expect(accumulateElapsed(resumed, 61000).accumulatedMs).toBe(0)
  })

  it('persists and commits at most once per callback batch and leaves the queue intact until a step runs', () => {
    const { sink, calls } = recordingSink()
    const start = world()
    const idle = runBatch({ clock: IDLE_CLOCK, nowMs: 0, world: start, queued: [{ type: 'jump' }], movement: [0, 0] }, sink)
    expect(idle).toMatchObject({ queueConsumed: false, world: start, clock: { lastMs: 0, accumulatedMs: 0 } })
    const partial = runBatch({ clock: idle.clock, nowMs: 20, world: start, queued: [{ type: 'jump' }], movement: [0, 0] }, sink)
    expect(partial).toMatchObject({ queueConsumed: false, clock: { lastMs: 20, accumulatedMs: 20 } })
    expect(calls).toMatchObject({ commit: 0, persist: 0 })

    const busy = runBatch({ clock: partial.clock, nowMs: 520, world: start, queued: [{ type: 'jump' }], movement: [0, 1] }, sink)
    expect(busy.queueConsumed).toBe(true)
    expect(busy.clock).toEqual({ lastMs: 520, accumulatedMs: 20 })
    expect(busy.world.tick).toBe(start.tick + 10)
    expect(calls).toMatchObject({ commit: 1, persist: 1 })
    expect(calls.messages.filter((text) => text === 'You spring over the trail.')).toHaveLength(1)
  })
})
