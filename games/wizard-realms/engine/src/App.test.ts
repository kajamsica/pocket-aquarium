import { describe, expect, it } from 'vitest'
import { createWizardWorld, type WizardWorldState } from './domain'
import { OBJECTIVE_STYLES, PIVOT_RADIANS_PER_TICK, controlIntents, intentForView, movementIntent, objectiveFor, resetSavedWorld, toViewProjection } from './App'

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
    expect(projection.equipment.focus).toBeNull()
    expect(projection.equipment.hands).toBeNull()
    expect(projection.player.position).toEqual([state.player.position.x, state.player.position.y, state.player.position.z])
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

  it('maps jump, store, equipment, trade, and ring controls to exact domain intents', () => {
    const state = createWizardWorld('greenway-alpha')
    const before = JSON.stringify(state)
    expect(intentForView(state, { type: 'jump' })).toEqual({ type: 'jump' })
    expect(intentForView(state, { type: 'store.select-listing', storeId: 'store-greenway', listingId: 'hat' })).toEqual({ type: 'buy_store_listing', storeId: 'store-greenway', listingId: 'hat' })
    expect(intentForView(state, { type: 'equipment.equip', stackId: 'inventory-woodcutters_axe', slot: 'focus' })).toEqual({ type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' })
    expect(intentForView(state, { type: 'equipment.equip', stackId: 'inventory-wooden_shield', slot: 'hands' })).toEqual({ type: 'equip_item', itemId: 'wooden_shield', slot: 'offHand' })
    expect(intentForView(state, { type: 'trade.create-listing', stackId: 'inventory-logs', slot: 2, quantity: 1, unitPrice: 5 })).toEqual({ type: 'create_trade_listing', itemId: 'logs', slotIndex: 2, quantity: 1, unitPrice: 5 })
    expect(intentForView(state, { type: 'trade.cancel-listing', slot: 2 })).toEqual({ type: 'cancel_trade_listing', slotIndex: 2 })
    expect(intentForView(state, { type: 'fairy-ring.teleport', ringId: 'ring-greenway', destinationRingId: 'ring-highland' })).toEqual({ type: 'teleport_fairy_ring', sourceRingId: 'ring-greenway', targetRingId: 'ring-highland' })
    expect(JSON.stringify(state)).toBe(before)
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
    expect(objectiveFor(state)).toBe('Greenway linked. Use a fairy ring to travel home.')
  })

  it('only announces linked travel once both fairy rings are discovered', () => {
    const linked = 'Greenway linked. Use a fairy ring to travel home.'
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
    const mobile = /@media\(max-width:719px\)\{(.*?)\}\n@media/s.exec(OBJECTIVE_STYLES)?.[1]
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

  it('keeps mobile prompt, context, and event surfaces out of the objective band', () => {
    const mobile = /@media\(max-width:719px\)\{(.*?)\}\n@media/s.exec(OBJECTIVE_STYLES)![1]
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
    for (const surface of ['.wr-surface .wr-prompt', '.wr-surface .wr-context', '.wr-surface .wr-events']) {
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
    expect(OBJECTIVE_STYLES).toContain('.wr-surface:has(.wr-context) .wr-backpack{display:none}')
  })

  it('restarts by clearing current and legacy saves and recreating the seeded world', () => {
    const removed: string[] = []
    const storage = { removeItem: (key: string) => { removed.push(key) } }
    const fresh = resetSavedWorld(storage)
    expect(removed).toEqual(['wizard-realms:world:v2', 'wizard-realms:world:v1'])
    expect(fresh.seed).toBe('greenway-alpha')
    expect(fresh.builtRouteIds).toEqual([])
    expect(fresh.player.equipment.mainHand).toBeNull()
    expect(JSON.stringify(fresh)).toBe(JSON.stringify(createWizardWorld('greenway-alpha')))
  })

  it('renders store and discovered-ring context as honest non-actionable prompts', () => {
    const storeState = copy(createWizardWorld('greenway-alpha'))
    storeState.resources.forEach((resource) => { resource.depleted = true })
    storeState.player.position = { ...storeState.stores[0].position }
    expect(toViewProjection(storeState, []).nearbyInteraction).toMatchObject({ kind: 'store', action: 'Store open', actionable: false })
    expect(intentForView(storeState, { type: 'interact' })).toBeNull()

    const ringState = copy(createWizardWorld('greenway-alpha'))
    ringState.resources.forEach((resource) => { resource.depleted = true })
    ringState.player.discoveredRingIds = ringState.fairyRings.map((ring) => ring.id)
    ringState.player.position = { ...ringState.fairyRings[0].position }
    expect(toViewProjection(ringState, []).nearbyInteraction).toMatchObject({ kind: 'fairy-ring', action: 'Choose destination', actionable: false })
    expect(intentForView(ringState, { type: 'interact' })).toBeNull()
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
    expect(toViewProjection(state, []).nearbyInteraction).toMatchObject({ kind: 'store', targetId: store.id, action: 'Store open' })

    state.player.position = { ...bridge.to }
    expect(toViewProjection(state, []).nearbyInteraction).toMatchObject({ kind: 'route', targetId: bridge.id, action: 'Cross', actionable: true })
    expect(intentForView(state, { type: 'interact' })).toEqual({ type: 'traverse_route', routeId: bridge.id })
  })
})
