import { createElement, createRef, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { advanceWizardWorld, createWizardWorld, serializeWizardWorld, type WizardWorldState } from './domain'
import { createGeneratedWorld } from './domain/generation'
import { EQUIPMENT_SLOTS, WizardHud } from './view/WizardHud'
import { WizardMap } from './view/WizardMap'
import App, {
  IDLE_CLOCK, MAX_CATCH_UP_STEPS, OBJECTIVE_STYLES, PIVOT_RADIANS_PER_TICK, accumulateElapsed, controlIntents, intentForView,
  loadWorld, movementIntent, objectiveFor, persistWorld, resetSavedWorld, retainOpenStoreId, runBatch, stepBatch, toViewProjection, worldProfileForSearch, type BatchSink,
} from './App'

const copy = (state: WizardWorldState): WizardWorldState => JSON.parse(JSON.stringify(state)) as WizardWorldState
const withAxeEquipped = (state: WizardWorldState) => { state.player.equipment.mainHand = 'woodcutters_axe'; return state }
const withLogs = (state: WizardWorldState, quantity: number) => { state.player.inventory.push({ itemId: 'logs', quantity }); return state }

describe('Wizard view adapter', () => {
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
    expect(projection.routes).toHaveLength(2)
    expect(projection.map.tiles).toHaveLength(state.tiles.length)
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
    expect(tiles.filter((tile) => tile.hasResource).length).toBeGreaterThan(0)

    state.discoveredTileIds = ['tile-2-3']
    const fogged = toViewProjection(state, []).map.tiles
    expect(fogged.filter((tile) => tile.hasStore).map((tile) => tile.id)).toEqual(['tile-2-3'])
    expect(fogged.some((tile) => tile.hasRing)).toBe(false)
    expect(fogged.filter((tile) => !tile.discovered).every((tile) => tile.terrain === null && tile.biome === null && !tile.hasResource && !tile.hasStore && !tile.hasRing && !tile.hasRouteSite)).toBe(true)
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
    expect(marked(state)).toEqual({ stores: ['tile-2-3'], rings: ['tile-4-3'] })
    state.player.position = { ...state.routes.find((route) => route.id === 'highland_bridge')!.from }
    const crossed = advanceWizardWorld(state, [{ type: 'traverse_route', routeId: 'highland_bridge' }])
    expect(crossed.rejections).toEqual([])
    expect(crossed.state.discoveredTileIds).toContain('tile-5-1')
    expect(marked(crossed.state)).toEqual({ stores: ['tile-5-2', 'tile-2-3'], rings: ['tile-5-1', 'tile-4-3'] })
    expect(toViewProjection(crossed.state, []).map.player).toEqual({ gridX: 5, gridZ: 1, yaw: 0 })
  })

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)('marks one discovered build endpoint per unlocked, unbuilt route in the %s atlas', (profile) => {
    const state = createGeneratedWorld('greenway-alpha', profile)
    state.discoveredTileIds = state.tiles.map((tile) => tile.id)
    const routeSites = () => toViewProjection(state, []).map.tiles.filter((tile) => tile.hasRouteSite).map((tile) => tile.id).sort()
    expect(routeSites()).toEqual(['tile-3-2'])

    state.unlockedRecipeIds.push('highland_bridge')
    expect(routeSites()).toEqual(['tile-3-2', 'tile-4-1'])
    state.discoveredTileIds = ['tile-3-2']
    expect(routeSites()).toEqual(['tile-3-2'])
    state.builtRouteIds.push('greenway_ladder')
    expect(routeSites()).toEqual([])
    state.discoveredTileIds = state.tiles.map((tile) => tile.id)
    expect(routeSites()).toEqual(['tile-4-1'])
    state.builtRouteIds.push('highland_bridge')
    expect(routeSites()).toEqual([])
  })

  it('renders the route marker and legend without hiding the player when standing at the build site', () => {
    const state = createWizardWorld('greenway-alpha')
    const render = () => renderToStaticMarkup(createElement(WizardMap, {
      projection: toViewProjection(state, []), open: true, onToggle: () => {}, buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>(),
    }))
    const atlas = render()
    expect(atlas).toMatch(/aria-label="tile-3-2:[^"]*route build site"[^>]*><b>◇<\/b>/)
    expect(atlas.match(/<b>◇<\/b>/g)).toHaveLength(1)
    expect(atlas).toContain('◇ route build site')

    state.player.position = { ...state.routes[0].from }
    expect(render()).toMatch(/aria-label="tile-3-2:[^"]*player location, route build site"[^>]*><b[^>]*>▲<\/b>/)
  })

  it('keeps the player marker above a store and the expanded atlas north-up', () => {
    const state = createGeneratedWorld('greenway-alpha', 'greenway-expanded-v1')
    state.discoveredTileIds = state.tiles.map((tile) => tile.id)
    state.player.position = { ...state.tiles.find((tile) => tile.id === 'tile-2-3')!.center }
    const projection = toViewProjection(state, [])
    expect(projection.map.tiles.find((tile) => tile.id === 'tile-2-3')?.hasStore).toBe(true)
    expect(projection.map.player).toEqual({ gridX: 2, gridZ: 3, yaw: 0 })
    const markup = renderToStaticMarkup(createElement(WizardMap, {
      projection, open: true, onToggle: () => {}, buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>(),
    }))
    expect(markup).toContain('aria-label="North-up world map, negative Z is north"')
    expect(markup.indexOf('tile--4--4:')).toBeLessThan(markup.indexOf('tile-11-11:'))
    expect(markup).toMatch(/aria-label="tile-2-3:[^"]*player location"[^>]*><b[^>]*>▲<\/b>/)
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
    expect(intentForView(state, { type: 'interact' })).toEqual({ type: 'build_route', routeId: ladder.id })
    state.builtRouteIds.push(ladder.id)
    state.player.position = { ...bridge.from }
    expect(intentForView(state, { type: 'interact' })).toEqual({ type: 'build_route', routeId: bridge.id })
    state.builtRouteIds.push(bridge.id)
    state.player.position = { ...highlandRing.position }
    expect(intentForView(state, { type: 'interact' })).toEqual({ type: 'discover_fairy_ring', ringId: highlandRing.id })
    state.player.position = { ...greenwayRing.position }
    expect(intentForView(state, { type: 'interact' })).toEqual({ type: 'discover_fairy_ring', ringId: greenwayRing.id })
  })

  it('maps jump, store, equipment, trade, and ring controls to exact domain intents', () => {
    const state = createWizardWorld('greenway-alpha')
    const before = JSON.stringify(state)
    expect(intentForView(state, { type: 'jump' })).toEqual({ type: 'jump' })
    expect(intentForView(state, { type: 'store.select-listing', storeId: 'store-greenway', listingId: 'hat' })).toEqual({ type: 'buy_store_listing', storeId: 'store-greenway', listingId: 'hat' })
    expect(intentForView(state, { type: 'equipment.equip', stackId: 'inventory-woodcutters_axe', slot: 'mainHand' })).toEqual({ type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' })
    expect(intentForView(state, { type: 'equipment.equip', stackId: 'inventory-wooden_shield', slot: 'offHand' })).toEqual({ type: 'equip_item', itemId: 'wooden_shield', slot: 'offHand' })
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

  it('renders Main hand and Off hand labels and marks the equipped backpack stack as Equipped', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    state.player.equipment.mainHand = 'woodcutters_axe'
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection: toViewProjection(state, []), onIntent: () => {} }))
    expect(markup).toContain('<div class="wr-slot" data-slot="mainHand"><small>Main hand</small><b>Woodcutter axe</b></div>')
    expect(markup).toContain('<div class="wr-slot" data-slot="offHand"><small>Off hand</small><b>Empty</b></div>')
    expect(markup).not.toMatch(/<small>(focus|hands)<\/small>/i)
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('>Equipped</button>')
    expect(markup).toContain('<b>Woodcutter axe</b><small>×1</small>')

    const unequipped = renderToStaticMarkup(createElement(WizardHud, { projection: toViewProjection(createWizardWorld('greenway-alpha'), []), onIntent: () => {} }))
    expect(unequipped).toContain('aria-pressed="false"')
    expect(unequipped).toContain('>Equip</button>')
    expect(unequipped).not.toContain('>Equipped</button>')
  })

  it('recognizes equipment in every compatible slot instead of offering an invalid re-equip', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    state.player.inventory.push({ itemId: 'oak_wand', quantity: 1 })
    state.player.equipment.offHand = 'oak_wand'
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection: toViewProjection(state, []), onIntent: () => {} }))
    const wandRow = markup.match(/<div class="wr-item">(?:(?!<div class="wr-item">).)*?<b>Oak wand<\/b>(?:(?!<\/div>).)*?<\/div>/)?.[0]
    expect(wandRow).toBeDefined()
    expect(wandRow).toContain('aria-pressed="true"')
    expect(wandRow).toContain('disabled=""')
    expect(wandRow).toContain('>Equipped</button>')
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
    expect(objectiveFor(fresh)).toBe('Equip the woodcutter axe from your backpack.')
    expect(JSON.stringify(fresh)).toBe(before)

    const unowned = copy(fresh)
    unowned.player.inventory = []
    expect(objectiveFor(unowned)).toBe('Buy a woodcutter axe at Greenway Outfitters.')

    const state = withAxeEquipped(copy(fresh))
    expect(objectiveFor(state)).toBe('Gather logs from Greenway oaks (0/4), then build the Greenway ladder north.')
    withLogs(state, 2)
    expect(objectiveFor(state)).toBe('Gather logs from Greenway oaks (2/4), then build the Greenway ladder north.')
    withLogs(state, 3)
    expect(objectiveFor(state)).toBe('Build the Greenway ladder north (4 logs).')

    state.builtRouteIds = ['greenway_ladder']
    state.player.inventory = state.player.inventory.filter((stack) => stack.itemId !== 'logs')
    withLogs(state, 1)
    expect(objectiveFor(state)).toBe('Gather logs from Greenway oaks (1/6), then build the Highland bridge east along the ridge.')
    withLogs(state, 5)
    expect(objectiveFor(state)).toBe('Build the Highland bridge east along the ridge (6 logs).')

    state.builtRouteIds = ['greenway_ladder', 'highland_bridge']
    expect(objectiveFor(state)).toBe('Cross the Highland bridge east and discover the Highland fairy ring.')

    state.player.discoveredRingIds = ['ring-greenway', 'ring-highland']
    expect(objectiveFor(state)).toBe('Quest complete: fairy rings linked. Explore, trade, or travel to Highland again.')
    state.player.position = { ...state.fairyRings.find((ring) => ring.id === 'ring-highland')!.position }
    expect(objectiveFor(state)).toBe('Quest complete: both fairy rings are linked. Use the Highland Ring to travel home.')
  })

  it('keeps the objective complete after traveling home and back to Highland', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
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
    const state = withAxeEquipped(copy(createWizardWorld('greenway-alpha')))
    state.builtRouteIds = ['greenway_ladder', 'highland_bridge']

    state.player.discoveredRingIds = []
    expect(objectiveFor(state)).toBe('Cross the Highland bridge east and discover the Highland fairy ring.')

    state.player.discoveredRingIds = ['ring-greenway']
    expect(objectiveFor(state)).toBe('Cross the Highland bridge east and discover the Highland fairy ring.')

    state.player.discoveredRingIds = ['ring-highland']
    expect(objectiveFor(state)).toBe('Return to the Greenway and discover its fairy ring near the start to link travel home.')

    state.player.discoveredRingIds = ['ring-highland', 'ring-greenway']
    expect(objectiveFor(state)).toBe(linked)

    const earlyGreenway = withAxeEquipped(copy(createWizardWorld('greenway-alpha')))
    earlyGreenway.player.discoveredRingIds = ['ring-greenway']
    expect(objectiveFor(earlyGreenway)).toBe('Gather logs from Greenway oaks (0/4), then build the Greenway ladder north.')
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
    const classicSave = serializeWizardWorld(classic)
    const saves = new Map([['wizard-realms:world:v2', classicSave], ['wizard-realms:world:v1', 'legacy-progress']])
    const readKeys: string[] = []
    const storage = {
      getItem: (key: string) => { readKeys.push(key); return saves.get(key) ?? null },
      setItem: (key: string, value: string) => { saves.set(key, value) },
    }
    const expanded = loadWorld(storage, 'greenway-expanded-v1')
    expect(readKeys).toEqual(['wizard-realms:world:expanded:v1'])
    expect(expanded.generationProfile).toBe('greenway-expanded-v1')
    expect(expanded.tiles).toHaveLength(256)
    expanded.tick = 12
    expect(persistWorld(storage, expanded, 'greenway-expanded-v1')).toBe(true)
    expect(saves.get('wizard-realms:world:expanded:v1')).toBe(serializeWizardWorld(expanded))
    expect(persistWorld(storage, expanded)).toBe(false)
    expect(saves.get('wizard-realms:world:v2')).toBe(classicSave)
    expect(saves.get('wizard-realms:world:v1')).toBe('legacy-progress')
    expect(loadWorld(storage, 'greenway-expanded-v1')).toEqual(expanded)
    expect(loadWorld(storage)).toEqual(classic)
    classic.tick = 9
    expect(persistWorld(storage, classic)).toBe(true)
    expect(saves.get('wizard-realms:world:v2')).toBe(serializeWizardWorld(classic))
    expect(saves.get('wizard-realms:world:expanded:v1')).toBe(serializeWizardWorld(expanded))
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
    expect(operations).toEqual(['set:wizard-realms:world:expanded:v1', 'set:wizard-realms:world:expanded:v1'])
    expect(restarted).toEqual(createWizardWorld('expanded-second', 'greenway-expanded-v1'))
    expect(loadWorld(storage, 'greenway-expanded-v1')).toEqual(restarted)
    expect(saves.get('wizard-realms:world:v2')).toBe(classicSave)
    expect(saves.get('wizard-realms:world:v1')).toBe('legacy-progress')
  })

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)('preserves incompatible %s save bytes through repeated autosave batches', (profile) => {
    const key = profile === 'greenway-classic-v1' ? 'wizard-realms:world:v2' : 'wizard-realms:world:expanded:v1'
    const otherProfile = profile === 'greenway-classic-v1' ? 'greenway-expanded-v1' : 'greenway-classic-v1'
    const incompatibleSaves = [
      'not-json',
      'null',
      JSON.stringify({ schemaVersion: 'wizard-world/v3', seed: 'future', generationProfile: profile }),
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

  it('preserves an invalid active legacy save without creating a classic v2 save', () => {
    const legacy = '{"schemaVersion":"wizard-world/v3","seed":"future"}'
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
    expect(saves.has('wizard-realms:world:v2')).toBe(false)
  })

  it('persists valid current and legacy classic saves after their next batch', () => {
    const original = createWizardWorld('known-progress')
    const oldV2 = JSON.stringify({ ...original, generationProfile: undefined })
    const legacyV1 = JSON.stringify({ ...original, schemaVersion: 'wizard-world/v1', generationProfile: undefined })
    for (const [key, saved] of [['wizard-realms:world:v2', oldV2], ['wizard-realms:world:v1', legacyV1]] as const) {
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
      expect(saves.get('wizard-realms:world:v2')).toBe(serializeWizardWorld(next))
    }
  })

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)('replaces a blocked %s save only through explicit reset', (profile) => {
    const key = profile === 'greenway-classic-v1' ? 'wizard-realms:world:v2' : 'wizard-realms:world:expanded:v1'
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
    expect(operations).toEqual(profile === 'greenway-classic-v1'
      ? ['set:wizard-realms:world:v2', 'remove:wizard-realms:world:v1']
      : ['set:wizard-realms:world:expanded:v1'])
    expect(saves.get(key)).toBe(serializeWizardWorld(fresh))
    expect(saves.get('wizard-realms:world:v1')).toBe(profile === 'greenway-classic-v1' ? undefined : 'legacy')
    expect(persistWorld(storage, stepBatch(fresh, [], [0, 0], 50).state, profile)).toBe(true)
    expect(saves.get(key)).not.toBe(original)
  })

  it.each([
    ['greenway-classic-v1', '', 'wizard-realms:world:v2'],
    ['greenway-expanded-v1', '?devRegion=expanded', 'wizard-realms:world:expanded:v1'],
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

  it('writes a fresh seeded world before clearing the legacy save', () => {
    const saves = new Map([['wizard-realms:world:v2', 'previous'], ['wizard-realms:world:v1', 'legacy']])
    const operations: string[] = []
    const storage = {
      setItem: (key: string, value: string) => { operations.push(`set:${key}`); saves.set(key, value) },
      removeItem: (key: string) => { operations.push(`remove:${key}`); saves.delete(key) },
    }
    const fresh = resetSavedWorld(storage)
    expect(operations).toEqual(['set:wizard-realms:world:v2', 'remove:wizard-realms:world:v1'])
    expect(saves.get('wizard-realms:world:v2')).toBe(serializeWizardWorld(fresh))
    expect(saves.has('wizard-realms:world:v1')).toBe(false)
    expect(fresh.seed).toBe('greenway-alpha')
    expect(fresh.builtRouteIds).toEqual([])
    expect(fresh.player.equipment.mainHand).toBeNull()
    expect(JSON.stringify(fresh)).toBe(JSON.stringify(createWizardWorld('greenway-alpha')))
  })

  it('resets into an explicit alternate seed', () => {
    const removed: string[] = []
    const fresh = resetSavedWorld({ setItem: () => {}, removeItem: (key) => { removed.push(key) } }, 'greenway-beta')
    expect(removed).toEqual(['wizard-realms:world:v1'])
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
    const serialized = serializeWizardWorld(saved)
    expect(loadWorld({ getItem: (key) => key === 'wizard-realms:world:v2' ? serialized : null })).toEqual(saved)

    const legacy = JSON.stringify({ ...saved, schemaVersion: 'wizard-world/v1' })
    expect(loadWorld({ getItem: (key) => key === 'wizard-realms:world:v1' ? legacy : null })).toMatchObject({
      schemaVersion: 'wizard-world/v2', seed: 'greenway-beta', tick: 7, builtRouteIds: ['greenway_ladder'],
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
    else state.routes[0].from = { ...state.player.position }
    expect(toViewProjection(state, []).nearbyInteraction?.kind).toBe(kind)
    expect(intentForView(state, { type: 'interact' })).not.toBeNull()
    expect(retainOpenStoreId(state, store.id)).toBe(store.id)
    const open = toViewProjection(state, [], store.id)
    expect(open.nearbyInteraction).toMatchObject({ kind: 'store', targetId: store.id, action: 'Store open', actionable: false })
    expect(intentForView(state, { type: 'interact' }, store.id)).toBeNull()
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection: open, onIntent: () => {} }))
    expect(markup).toContain(`<header>${store.name}</header>`)
    expect(markup.match(/class="wr-panel wr-context"/g)).toHaveLength(1)
  })

  it('maps route construction and traversal through the nearest route scaffold', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    state.resources.forEach((resource) => { resource.depleted = true })
    const ladder = state.routes.find((route) => route.id === 'greenway_ladder')!
    state.player.position = { ...ladder.from }
    expect(toViewProjection(state, []).nearbyInteraction).toMatchObject({ kind: 'route', action: 'Build', actionable: true })
    expect(intentForView(state, { type: 'interact' })).toEqual({ type: 'build_route', routeId: 'greenway_ladder' })
    state.builtRouteIds.push('greenway_ladder')
    expect(toViewProjection(state, []).nearbyInteraction).toMatchObject({ kind: 'route', action: 'Cross', actionable: true })
    expect(intentForView(state, { type: 'interact' })).toEqual({ type: 'traverse_route', routeId: 'greenway_ladder' })
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
