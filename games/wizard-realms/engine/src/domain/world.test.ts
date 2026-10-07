import { describe, expect, it } from 'vitest'
import {
  advanceWizardWorld, createWizardProjection, createWizardWorld, restoreWizardWorld, serializeWizardWorld,
  type EquipmentSlot, type WizardEvent, type WizardIntent, type WizardWorldState,
} from './index'
import { areaAt, STORE_HALF_DEPTH, STORE_HALF_WIDTH, terrainHeightAt } from './generation'
import { isRestorableWizardSave } from './persistence'
import { storeSellUnitPrice } from './world'

const copy = (state: WizardWorldState): WizardWorldState => JSON.parse(JSON.stringify(state)) as WizardWorldState
const clearanceSeeds = ['expedition-19078', 'expedition-870', 'expedition-8407', 'expedition-11820', 'expedition-4', 'expedition-1']

function expectResourceClearance(state: WizardWorldState) {
  const landmarks = [
    { id: 'spawn', position: state.player.position },
    ...state.stores.map(({ id, position }) => ({ id, position })),
    ...state.fairyRings.map(({ id, position }) => ({ id, position })),
    ...state.routes.flatMap((route) => [
      { id: `${route.id}:from`, position: route.from }, { id: `${route.id}:to`, position: route.to },
    ]),
  ]
  let nearest = { distance: Infinity, resourceId: '', landmarkId: '' }
  for (const resource of state.resources) for (const landmark of landmarks) {
    const distance = Math.hypot(resource.position.x - landmark.position.x, resource.position.z - landmark.position.z)
    if (distance < nearest.distance) nearest = { distance, resourceId: resource.id, landmarkId: landmark.id }
  }
  expect(nearest.distance, `${state.seed}: ${nearest.resourceId} near ${nearest.landmarkId}`).toBeGreaterThanOrEqual(1.5)
  let storeOverlap = ''
  for (const resource of state.resources) for (const store of state.stores) {
    if (Math.abs(resource.position.x - store.position.x) < STORE_HALF_WIDTH + 0.2
      && Math.abs(resource.position.z - store.position.z) < STORE_HALF_DEPTH + 0.2) {
      storeOverlap ||= `${resource.id} inside ${store.id}`
    }
  }
  expect(storeOverlap, state.seed).toBe('')
}

describe('Wizard world domain', () => {
  it('generates identical worlds for the same seed and different worlds for another seed', () => {
    const first = createWizardWorld('greenway-alpha')
    const replay = createWizardWorld('greenway-alpha')
    const other = createWizardWorld('greenway-beta')
    expect(replay).toEqual(first)
    expect(other.rng).not.toEqual(first.rng)
    expect(other.tiles.map((tile) => [tile.biome, tile.terrain, tile.elevation]))
      .not.toEqual(first.tiles.map((tile) => [tile.biome, tile.terrain, tile.elevation]))
    expect(first.resources.filter((resource) => resource.id.startsWith('resource-')).map((resource) => [resource.tileId, resource.kind]))
      .toEqual(first.tiles.map((tile) => [tile.id, resourceKindForBiome(tile.biome)]))
    const journeyTrees = first.resources.filter((resource) => resource.id.startsWith('greenway-journey-tree-'))
    expect(journeyTrees).toHaveLength(4)
    expect(journeyTrees.every((tree) => areaAt(first.areas, tree.position.x, tree.position.z).id === 'greenway')).toBe(true)
    expect(replay.routes).toEqual(first.routes)
    expect(replay.areas).toEqual(first.areas)
  })

  it.each(clearanceSeeds)('keeps resources clear of landmarks for %s', (seed) => {
    expectResourceClearance(createWizardWorld(seed))
  })

  it('keeps resources clear across 20000 expedition seeds', () => {
    for (let index = 0; index < 20000; index += 1) expectResourceClearance(createWizardWorld(`expedition-${index}`))
  }, 30_000)

  it.each(clearanceSeeds)('keeps four obtainable Greenway trees for %s', (seed) => {
    let state = advanceWizardWorld(createWizardWorld(seed), [{ type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' }]).state
    const trees = state.resources.filter((resource) => resource.id.startsWith('greenway-journey-tree-'))
    expect(trees).toHaveLength(4)
    for (const tree of trees) {
      expect(areaAt(state.areas, tree.position.x, tree.position.z).id).toBe('greenway')
      state.player.position = { ...tree.position }
      for (let hit = 0; hit < 2; hit += 1) {
        const harvest = advanceWizardWorld(state, [{ type: 'harvest', resourceId: tree.id }])
        expect(harvest.rejections).toEqual([])
        state = harvest.state
      }
    }
    expect(state.player.inventory.find((stack) => stack.itemId === 'logs')?.quantity).toBeGreaterThanOrEqual(10)
  })

  it('harvests an in-range tree and rejects invalid harvest without mutation', () => {
    let state = copy(createWizardWorld('greenway-alpha'))
    const tree = state.resources.find((resource) => resource.kind === 'tree')!
    state.player.position = { ...tree.position }
    state = advanceWizardWorld(state, [{ type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' }]).state
    const firstHit = advanceWizardWorld(state, [{ type: 'harvest', resourceId: tree.id }])
    expect(firstHit.events[0]?.type).toBe('resource_damaged')
    const harvested = advanceWizardWorld(firstHit.state, [{ type: 'harvest', resourceId: tree.id }])
    expect(harvested.events[0]?.type).toBe('resource_harvested')
    expect(harvested.state.player.inventory).toContainEqual({ itemId: 'logs', quantity: 3 })
    expect(harvested.state.player.xp).toBe(20)

    const invalid = createWizardWorld('greenway-alpha')
    const before = serializeWizardWorld(invalid)
    const rejected = advanceWizardWorld(invalid, [{ type: 'harvest', resourceId: tree.id }])
    expect(rejected.rejections[0]?.code).toBe('too_far')
    expect(serializeWizardWorld(invalid)).toBe(before)
    expect(rejected.state.player).toEqual(invalid.player)
    expect(rejected.state.tick).toBe(invalid.tick + 1)
  })

  it('discovers rings, rejects undiscovered travel, and teleports between discovered rings', () => {
    let state = copy(createWizardWorld('greenway-alpha'))
    const [source, target] = state.fairyRings
    state.player.position = { ...source.position }
    const discoveredSource = advanceWizardWorld(state, [{ type: 'discover_fairy_ring', ringId: source.id }])
    expect(discoveredSource.events[0]?.type).toBe('fairy_ring_discovered')
    const beforeRejected = serializeWizardWorld(discoveredSource.state)
    const rejected = advanceWizardWorld(discoveredSource.state, [{ type: 'teleport_fairy_ring', sourceRingId: source.id, targetRingId: target.id }])
    expect(rejected.rejections[0]?.code).toBe('undiscovered')
    expect(serializeWizardWorld(discoveredSource.state)).toBe(beforeRejected)
    expect(rejected.state.player).toEqual(discoveredSource.state.player)
    expect(rejected.state.tick).toBe(discoveredSource.state.tick + 1)

    state = copy(discoveredSource.state)
    state.player.position = { ...target.position }
    const discoveredTarget = advanceWizardWorld(state, [{ type: 'discover_fairy_ring', ringId: target.id }]).state
    state = copy(discoveredTarget)
    state.player.position = { ...source.position }
    expect(advanceWizardWorld(state, [{ type: 'teleport_fairy_ring', sourceRingId: source.id, targetRingId: target.id }]).rejections[0]?.code).toBe('locked_area')
    state.builtRouteIds = ['greenway_ladder', 'highland_bridge']
    const teleported = advanceWizardWorld(state, [{ type: 'teleport_fairy_ring', sourceRingId: source.id, targetRingId: target.id }])
    expect(teleported.events[0]?.type).toBe('fairy_ring_teleported')
    expect(teleported.state.player.position).toEqual(target.position)
  })

  it('buys and equips store gear', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    const store = state.stores[0]
    const listing = store.listings[0]
    state.player.position = { ...store.position }
    const bought = advanceWizardWorld(state, [{ type: 'buy_store_listing', storeId: store.id, listingId: listing.id }])
    expect(bought.events[0]?.type).toBe('store_item_bought')
    expect(bought.state.player.coins).toBe(100)
    expect(bought.state.player.inventory).toContainEqual({ itemId: 'apprentice_hat', quantity: 1 })
    const equipped = advanceWizardWorld(bought.state, [{ type: 'equip_item', itemId: 'apprentice_hat', slot: 'head' }])
    expect(equipped.state.player.equipment.head).toBe('apprentice_hat')
  })

  it.each([
    { slot: 'head', itemId: 'apprentice_hat' },
    { slot: 'chest', itemId: 'traveler_tunic' },
    { slot: 'legs', itemId: 'trail_leggings' },
    { slot: 'feet', itemId: 'leather_boots' },
    { slot: 'mainHand', itemId: 'woodcutters_axe' },
    { slot: 'offHand', itemId: 'wooden_shield' },
  ] as const)('unequips $slot without removing its owned $itemId', ({ slot, itemId }) => {
    const state = createWizardWorld('unequip-slots')
    if (itemId !== 'woodcutters_axe') state.player.inventory.push({ itemId, quantity: 1 })
    const otherSlot = slot === 'mainHand' ? 'head' : 'mainHand'
    const otherItemId = slot === 'mainHand' ? 'apprentice_hat' : 'woodcutters_axe'
    if (otherItemId === 'apprentice_hat') state.player.inventory.push({ itemId: otherItemId, quantity: 1 })
    state.player.equipment[otherSlot] = otherItemId
    const equipped = advanceWizardWorld(state, [{ type: 'equip_item', itemId, slot }])
    expect(equipped.rejections).toEqual([])
    const before = serializeWizardWorld(equipped.state)
    const unequipped = advanceWizardWorld(equipped.state, [{ type: 'unequip_item', slot }])
    expect(unequipped.rejections).toEqual([])
    expect(unequipped.events).toEqual([{ type: 'item_unequipped', itemId, slot, sequence: 2, tick: 2 }])
    expect(unequipped.state.player.equipment).toEqual({ ...equipped.state.player.equipment, [slot]: null })
    expect(unequipped.state.player.inventory).toEqual(equipped.state.player.inventory)
    expect(serializeWizardWorld(equipped.state)).toBe(before)
  })

  it('rejects empty and unknown equipment slots without mutation', () => {
    const state = createWizardWorld('unequip-slots')
    const before = serializeWizardWorld(state)
    for (const slot of ['head', 'unknown', 'toString']) {
      const rejected = advanceWizardWorld(state, [{ type: 'unequip_item', slot: slot as EquipmentSlot }])
      expect(rejected.rejections[0]?.code).toBe('invalid_value')
      expect(rejected.events).toEqual([])
      expect(rejected.state.player).toEqual(state.player)
      expect(rejected.state.eventSequence).toBe(state.eventSequence)
      expect(serializeWizardWorld(state)).toBe(before)
    }
  })

  it('replays unequip deterministically and preserves its result through save restoration', () => {
    const state = createWizardWorld('unequip-replay')
    state.player.inventory.push({ itemId: 'apprentice_hat', quantity: 1 })
    const equipped = advanceWizardWorld(state, [{ type: 'equip_item', itemId: 'apprentice_hat', slot: 'head' }])
    const intent = { type: 'unequip_item' as const, slot: 'head' as const }
    const first = advanceWizardWorld(equipped.state, [intent])
    expect(advanceWizardWorld(equipped.state, [intent])).toEqual(first)
    const restored = restoreWizardWorld(serializeWizardWorld(first.state))
    expect(restored.player.equipment.head).toBeNull()
    expect(restored.player.inventory).toEqual(first.state.player.inventory)
    expect(advanceWizardWorld(restored, [{ type: 'equip_item', itemId: 'apprentice_hat', slot: 'head' }])).toEqual(
      advanceWizardWorld(first.state, [{ type: 'equip_item', itemId: 'apprentice_hat', slot: 'head' }]),
    )
  })

  it.each([
    { storeId: 'store-greenway', itemId: 'logs', unitPrice: 2 },
    { storeId: 'store-greenway', itemId: 'marsh_herb', unitPrice: 3 },
    { storeId: 'store-greenway', itemId: 'stone', unitPrice: 1 },
    { storeId: 'store-greenway', itemId: 'iron_ore', unitPrice: 4 },
    { storeId: 'store-highland', itemId: 'logs', unitPrice: 1 },
    { storeId: 'store-highland', itemId: 'marsh_herb', unitPrice: 5 },
    { storeId: 'store-highland', itemId: 'stone', unitPrice: 3 },
    { storeId: 'store-highland', itemId: 'iron_ore', unitPrice: 7 },
  ] as const)('sells $itemId to $storeId for $unitPrice coins each', ({ storeId, itemId, unitPrice }) => {
    const state = createWizardWorld('regional-sale')
    const store = state.stores.find((candidate) => candidate.id === storeId)!
    state.player.position = { ...store.position }
    state.player.inventory.push({ itemId, quantity: 2 })
    const before = serializeWizardWorld(state)
    const sold = advanceWizardWorld(state, [{ type: 'sell_to_store', storeId, itemId, quantity: 2 }])

    expect(storeSellUnitPrice(storeId, itemId)).toBe(unitPrice)
    expect(sold.rejections).toEqual([])
    expect(sold.events).toEqual([{ type: 'store_item_sold', storeId, itemId, quantity: 2, unitPrice, totalPrice: 2 * unitPrice, sequence: 1, tick: 1 }])
    expect(sold.state.player.inventory.some((stack) => stack.itemId === itemId)).toBe(false)
    expect(sold.state.player.coins).toBe(state.player.coins + 2 * unitPrice)
    expect(sold.state.stores).toEqual(state.stores)
    expect(serializeWizardWorld(state)).toBe(before)
  })

  it('returns through the ladder and sells carried logs beside Greenway Outfitters', () => {
    const state = createWizardWorld('regional-sale')
    const ladder = state.routes.find((route) => route.id === 'greenway_ladder')!
    const store = state.stores.find((candidate) => candidate.id === 'store-greenway')!
    state.builtRouteIds.push(ladder.id)
    state.player.position = { ...ladder.to }
    state.player.inventory.push({ itemId: 'logs', quantity: 3 })

    const returned = advanceWizardWorld(state, [{ type: 'traverse_route', routeId: ladder.id }])
    expect(returned.state.player.position).toEqual(ladder.from)
    const approached = advanceWizardWorld(returned.state, [
      { type: 'move', delta: { x: -4, y: 0, z: 0 } },
      { type: 'move', delta: { x: 0, y: 0, z: 1 } },
    ])
    expect(approached.rejections).toEqual([])
    expect(Math.hypot(approached.state.player.position.x - store.position.x, approached.state.player.position.z - store.position.z)).toBeLessThan(3)
    const sold = advanceWizardWorld(approached.state, [{ type: 'sell_to_store', storeId: store.id, itemId: 'logs', quantity: 3 }])
    expect(sold.rejections).toEqual([])
    expect(sold.events).toEqual([{ type: 'store_item_sold', storeId: store.id, itemId: 'logs', quantity: 3, unitPrice: 2, totalPrice: 6, sequence: approached.state.eventSequence + 1, tick: approached.state.tick + 1 }])
    expect(sold.state.player.inventory.some((stack) => stack.itemId === 'logs')).toBe(false)
    expect(sold.state.player.coins).toBe(approached.state.player.coins + 6)
  })

  it('rejects invalid, distant, unsupported, unowned, and equipped-copy sales without changing player state', () => {
    const state = createWizardWorld('regional-sale')
    const store = state.stores[0]
    state.player.position = { ...store.position }
    state.player.inventory.push({ itemId: 'logs', quantity: 2 })
    const cases: Array<{ intent: WizardIntent; code: string }> = [
      ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((quantity) => ({ intent: { type: 'sell_to_store' as const, storeId: store.id, itemId: 'logs' as const, quantity }, code: 'invalid_value' })),
      { intent: { type: 'sell_to_store', storeId: 'missing', itemId: 'logs', quantity: 1 }, code: 'not_found' },
      { intent: { type: 'sell_to_store', storeId: store.id, itemId: 'woodcutters_axe', quantity: 1 }, code: 'invalid_value' },
      { intent: { type: 'sell_to_store', storeId: store.id, itemId: 'logs', quantity: 3 }, code: 'not_owned' },
    ]
    expect(storeSellUnitPrice('missing', 'logs')).toBeNull()
    expect(storeSellUnitPrice(store.id, 'woodcutters_axe')).toBeNull()
    for (const { intent, code } of cases) {
      const before = serializeWizardWorld(state)
      const rejected = advanceWizardWorld(state, [intent])
      expect(rejected.rejections[0]?.code).toBe(code)
      expect(rejected.events).toEqual([])
      expect(rejected.state.player).toEqual(state.player)
      expect(serializeWizardWorld(state)).toBe(before)
    }

    const far = copy(state)
    far.player.position = { ...state.player.position, x: state.player.position.x + 4 }
    const distant = advanceWizardWorld(far, [{ type: 'sell_to_store', storeId: store.id, itemId: 'logs', quantity: 1 }])
    expect(distant.rejections[0]?.code).toBe('too_far')
    expect(distant.events).toEqual([])
    expect(distant.state.player.inventory).toEqual(far.player.inventory)
    expect(distant.state.player.coins).toBe(far.player.coins)

    const equipped = copy(state)
    equipped.player.equipment.mainHand = 'logs'
    const reserved = advanceWizardWorld(equipped, [{ type: 'sell_to_store', storeId: store.id, itemId: 'logs', quantity: 2 }])
    expect(reserved.rejections[0]?.code).toBe('not_owned')
    expect(reserved.events).toEqual([])
    expect(reserved.state.player).toEqual(equipped.player)

    const maxCoins = copy(state)
    maxCoins.player.coins = Number.MAX_SAFE_INTEGER
    const overflow = advanceWizardWorld(maxCoins, [{ type: 'sell_to_store', storeId: store.id, itemId: 'logs', quantity: 1 }])
    expect(overflow.rejections[0]?.code).toBe('invalid_value')
    expect(overflow.events).toEqual([])
    expect(overflow.state.player).toEqual(maxCoins.player)
  })

  it('replays a sale deterministically and continues identically after save restoration', () => {
    const state = createWizardWorld('regional-sale')
    const store = state.stores[0]
    state.player.position = { ...store.position }
    state.player.inventory.push({ itemId: 'logs', quantity: 5 })
    const before = serializeWizardWorld(state)
    const intent = { type: 'sell_to_store' as const, storeId: store.id, itemId: 'logs' as const, quantity: 2 }
    const first = advanceWizardWorld(state, [intent])
    expect(advanceWizardWorld(state, [intent])).toEqual(first)
    expect(serializeWizardWorld(state)).toBe(before)
    const restored = restoreWizardWorld(serializeWizardWorld(first.state))
    expect(restored.schemaVersion).toBe('wizard-world/v3')
    expect(restored.player.inventory).toEqual(first.state.player.inventory)
    expect(restored.player.coins).toBe(first.state.player.coins)
    const second = { ...intent, quantity: 3 }
    expect(advanceWizardWorld(restored, [second])).toEqual(advanceWizardWorld(first.state, [second]))
  })

  it('stops at a store wall and preserves legal diagonal sliding without rejections', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    const store = state.stores[0]
    state.player.position = { x: store.position.x, y: store.position.y, z: store.position.z + 1.81 }
    const stopped = advanceWizardWorld(state, [{ type: 'move', delta: { x: 0, y: 0, z: -0.16 } }])
    expect(stopped.rejections).toEqual([])
    expect(stopped.events).toEqual([])
    expect(stopped.state.player.position).toEqual(state.player.position)

    const slid = advanceWizardWorld(state, [{ type: 'move', delta: { x: 0.12, y: 0, z: -0.12 } }])
    expect(slid.rejections).toEqual([])
    expect(slid.events.map((entry) => entry.type)).toEqual(['player_moved'])
    expect(slid.state.player.position.x).toBeCloseTo(state.player.position.x + 0.12)
    expect(slid.state.player.position.z).toBe(state.player.position.z)
  })

  it('blocks four-meter store tunneling and lets an inside saved position move outward', () => {
    let state = copy(createWizardWorld('greenway-alpha'))
    const store = state.stores[0]
    state.player.position = { x: store.position.x, y: store.position.y, z: store.position.z + 1.9 }
    const tunnel = advanceWizardWorld(state, [{ type: 'move', delta: { x: 0, y: 0, z: -4 } }])
    expect(tunnel.rejections).toEqual([])
    expect(tunnel.events).toEqual([])
    expect(tunnel.state.player.position).toEqual(state.player.position)

    state.player.position = { ...store.position }
    for (let step = 0; step < 12; step += 1) {
      state = advanceWizardWorld(state, [{ type: 'move', delta: { x: 0, y: 0, z: 0.16 } }]).state
    }
    expect(state.player.position.z).toBeGreaterThan(store.position.z + 1.8)
  })

  it('keeps store purchases in range from outside the collision footprint', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    const store = state.stores[0]
    state.player.position = { x: store.position.x, y: store.position.y, z: store.position.z + 1.81 }
    const bought = advanceWizardWorld(state, [{ type: 'buy_store_listing', storeId: store.id, listingId: store.listings[0].id }])
    expect(bought.rejections).toEqual([])
    expect(bought.events[0]?.type).toBe('store_item_bought')
  })

  it('preserves the exact trace and input world over 1000 W+D intents', () => {
    const input = createWizardWorld('greenway-alpha')
    const before = serializeWizardWorld(input)
    const intents: WizardIntent[] = []
    const expectedEvents: WizardEvent[] = []
    let { x, y, z } = input.player.position
    let { yaw } = input.player
    for (let step = 0; step < 500; step += 1) {
      intents.push({ type: 'look', yawDelta: 0.007, pitchDelta: 0 })
      yaw += 0.007
      expectedEvents.push({ type: 'player_looked', sequence: step * 2 + 1, tick: 1, yaw, pitch: 0 })
      intents.push({ type: 'move', delta: { x: 0.005, y: 0, z: -0.005 } })
      x += 0.005
      z -= 0.005
      y = Math.max(y, terrainHeightAt(input.tiles, x, z))
      expectedEvents.push({ type: 'player_moved', sequence: step * 2 + 2, tick: 1, position: { x, y, z } })
    }

    const result = advanceWizardWorld(input, intents)
    expect(result.events).toEqual(expectedEvents)
    expect(result.rejections).toEqual([])
    expect(result.state.player.position).toEqual({ x, y, z })
    expect(result.state.player.yaw).toBe(yaw)
    expect(result.state.eventSequence).toBe(1000)
    expect(serializeWizardWorld(input)).toBe(before)
  })

  it('creates and cancels a trade listing', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    state.player.inventory.push({ itemId: 'logs', quantity: 2 })
    const listed = advanceWizardWorld(state, [{ type: 'create_trade_listing', slotIndex: 0, itemId: 'logs', quantity: 1, unitPrice: 7 }])
    expect(listed.state.player.tradeSlots[0]).toMatchObject({ itemId: 'logs', quantity: 1, unitPrice: 7 })
    expect(listed.state.player.inventory).toContainEqual({ itemId: 'logs', quantity: 1 })
    const cancelled = advanceWizardWorld(listed.state, [{ type: 'cancel_trade_listing', slotIndex: 0 }])
    expect(cancelled.state.player.tradeSlots[0].itemId).toBeNull()
    expect(cancelled.state.player.inventory).toContainEqual({ itemId: 'logs', quantity: 2 })
  })

  it('returns escrow into a full backpack and rejects impossible cancellation transactionally', () => {
    const full = copy(createWizardWorld('greenway-alpha'))
    full.player.inventory.push({ itemId: 'logs', quantity: 19 })
    const listed = advanceWizardWorld(full, [{ type: 'create_trade_listing', slotIndex: 0, itemId: 'logs', quantity: 1, unitPrice: 7 }]).state
    const cancelled = advanceWizardWorld(listed, [{ type: 'cancel_trade_listing', slotIndex: 0 }])
    expect(cancelled.rejections).toEqual([])
    expect(cancelled.state.player.inventory).toContainEqual({ itemId: 'logs', quantity: 19 })
    expect(cancelled.state.player.tradeSlots[0].itemId).toBeNull()

    const corrupt = copy(listed)
    corrupt.player.inventory = [{ itemId: 'logs', quantity: 20 }]
    const before = structuredClone(corrupt.player)
    const rejected = advanceWizardWorld(corrupt, [{ type: 'cancel_trade_listing', slotIndex: 0 }])
    expect(rejected.rejections[0]?.code).toBe('capacity')
    expect(rejected.state.player).toEqual(before)
    expect(corrupt.player).toEqual(before)
  })

  it('keeps equipped ownership out of escrow and prevents one item filling two slots', () => {
    let state = advanceWizardWorld(createWizardWorld('greenway-alpha'), [
      { type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' },
    ]).state
    const listed = advanceWizardWorld(state, [
      { type: 'create_trade_listing', slotIndex: 0, itemId: 'woodcutters_axe', quantity: 1, unitPrice: 7 },
    ])
    expect(listed.rejections[0]?.code).toBe('not_owned')
    expect(listed.state.player.equipment.mainHand).toBe('woodcutters_axe')
    expect(listed.state.player.inventory).toContainEqual({ itemId: 'woodcutters_axe', quantity: 1 })
    expect(listed.state.player.tradeSlots[0].itemId).toBeNull()

    state = copy(state)
    state.player.inventory.push({ itemId: 'oak_wand', quantity: 1 })
    state = advanceWizardWorld(state, [{ type: 'equip_item', itemId: 'oak_wand', slot: 'mainHand' }]).state
    const duplicate = advanceWizardWorld(state, [{ type: 'equip_item', itemId: 'oak_wand', slot: 'offHand' }])
    expect(duplicate.rejections[0]?.code).toBe('not_owned')
    expect(duplicate.state.player.equipment).toMatchObject({ mainHand: 'oak_wand', offHand: null })
  })

  it('places world anchors on terrain and advances jump physics at fixed idle ticks', () => {
    const state = createWizardWorld('greenway-alpha')
    for (const positioned of [...state.resources, ...state.stores, ...state.fairyRings]) {
      expect(positioned.position.y).toBe(terrainHeightAt(state.tiles, positioned.position.x, positioned.position.z))
    }
    expect(state.player.position.y).toBe(terrainHeightAt(state.tiles, 0, 0))

    const idle = advanceWizardWorld(state, [])
    expect(idle.state.tick).toBe(1)
    expect(idle.state.rng.simulation).not.toBe(state.rng.simulation)
    expect(state.tick).toBe(0)

    const jumped = advanceWizardWorld(idle.state, [{ type: 'jump' }])
    expect(jumped.events[0]?.type).toBe('player_jumped')
    expect(jumped.state.player.position.y).toBeGreaterThan(idle.state.player.position.y)
    let landed = jumped.state
    for (let tick = 0; tick < 30; tick += 1) landed = advanceWizardWorld(landed, []).state
    expect(landed.player.position.y).toBe(terrainHeightAt(landed.tiles, landed.player.position.x, landed.player.position.z))
    expect(landed.player.verticalVelocity).toBe(0)
  })

  it('repairs terrain height and invalid equipment ownership when restoring saves', () => {
    const source = JSON.parse(serializeWizardWorld(createWizardWorld('greenway-alpha'))) as WizardWorldState
    source.player.position.y = -100
    source.fairyRings.forEach((ring) => { ring.position.y = -100 })
    source.player.inventory.push({ itemId: 'oak_wand', quantity: 1 })
    source.player.equipment = { head: 'woodcutters_axe', chest: null, legs: null, feet: null,
      mainHand: 'oak_wand', offHand: 'oak_wand' }
    const restored = restoreWizardWorld(JSON.stringify(source))
    expect(restored.player.position.y).toBe(terrainHeightAt(restored.tiles, restored.player.position.x, restored.player.position.z))
    expect(restored.fairyRings.every((ring) => ring.position.y === terrainHeightAt(restored.tiles, ring.position.x, ring.position.z))).toBe(true)
    expect(restored.player.equipment).toMatchObject({ head: null, mainHand: 'oak_wand', offHand: null })

    const unowned = copy(source)
    unowned.player.inventory = []
    unowned.player.equipment.mainHand = 'woodcutters_axe'
    expect(restoreWizardWorld(JSON.stringify(unowned)).player.equipment.mainHand).toBeNull()
  })

  it('restores a save with next-tick equivalence', () => {
    const initial = advanceWizardWorld(createWizardWorld('greenway-alpha'), [{ type: 'look', yawDelta: 0.2, pitchDelta: -0.1 }]).state
    const restored = restoreWizardWorld(serializeWizardWorld(initial))
    const intent = { type: 'move' as const, delta: { x: 0.1, y: 0, z: -0.1 } }
    expect(advanceWizardWorld(restored, [intent])).toEqual(advanceWizardWorld(initial, [intent]))
  })

  it('builds the exact ladder and bridge progression, enforces boundaries, and traverses both ways', () => {
    let state = copy(createWizardWorld('greenway-alpha'))
    state.player.inventory.push({ itemId: 'logs', quantity: 4 }, { itemId: 'logs', quantity: 6 })
    state.player.xp = 40
    state.player.level = 1
    const ladder = state.routes.find((route) => route.id === 'greenway_ladder')!
    state.player.position = { ...ladder.from }

    const lockedMove = advanceWizardWorld(state, [{ type: 'move', delta: { x: 0, y: 0, z: -0.2 } }])
    expect(lockedMove.rejections[0]?.code).toBe('locked_area')
    expect(lockedMove.state.player.position).toEqual(state.player.position)

    const builtLadder = advanceWizardWorld(state, [{ type: 'build_route', routeId: 'greenway_ladder' }])
    expect(builtLadder.state.player.inventory).toContainEqual({ itemId: 'logs', quantity: 6 })
    expect(builtLadder.state.player.xp).toBe(100)
    expect(builtLadder.state.player.level).toBe(2)
    expect(builtLadder.state.builtRouteIds).toEqual(['greenway_ladder'])
    expect(builtLadder.state.unlockedRecipeIds).toEqual(['greenway_ladder', 'highland_bridge'])
    expect(builtLadder.events.map((entry) => entry.type)).toEqual(['route_built', 'recipe_unlocked'])

    const crossedLadder = advanceWizardWorld(builtLadder.state, [{ type: 'traverse_route', routeId: 'greenway_ladder' }])
    expect(crossedLadder.state.player.position).toEqual(ladder.to)
    expect(crossedLadder.events.map((entry) => entry.type)).toEqual(['route_used', 'tile_discovered'])
    const returnedLadder = advanceWizardWorld(crossedLadder.state, [{ type: 'traverse_route', routeId: 'greenway_ladder' }])
    expect(returnedLadder.state.player.position).toEqual(ladder.from)

    const bridge = returnedLadder.state.routes.find((route) => route.id === 'highland_bridge')!
    state = copy(returnedLadder.state)
    state.player.position = { ...bridge.from }
    const builtBridge = advanceWizardWorld(state, [{ type: 'build_route', routeId: 'highland_bridge' }])
    expect(builtBridge.state.player.inventory.find((stack) => stack.itemId === 'logs')).toBeUndefined()
    expect(builtBridge.state.player.xp).toBe(180)
    expect(builtBridge.state.builtRouteIds).toEqual(['greenway_ladder', 'highland_bridge'])
    const crossedBridge = advanceWizardWorld(builtBridge.state, [{ type: 'traverse_route', routeId: 'highland_bridge' }])
    expect(crossedBridge.state.player.position).toEqual(bridge.to)
    expect(advanceWizardWorld(crossedBridge.state, [{ type: 'traverse_route', routeId: 'highland_bridge' }]).state.player.position).toEqual(bridge.from)
  })

  it('slides along a locked area boundary while preserving the blocked component', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    state.player.position = { x: 0, y: terrainHeightAt(state.tiles, 0, -4), z: -4 }
    const result = advanceWizardWorld(state, [{ type: 'move', delta: { x: 0.12, y: 0, z: -0.12 } }])
    expect(result.rejections).toEqual([])
    expect(result.events.map((entry) => entry.type)).toEqual(['player_moved'])
    expect(result.state.player.position.x).toBeCloseTo(0.12)
    expect(result.state.player.position.z).toBe(-4)
    expect(areaAt(result.state.areas, result.state.player.position.x, result.state.player.position.z).id).toBe('greenway')
  })

  it('keeps the classic public profile and its exact 12-meter movement limits', () => {
    expect(createWizardWorld('greenway-alpha')).toEqual(createWizardWorld('greenway-alpha', 'greenway-classic-v1'))
    for (const [x, z, dx, dz, edgeX, edgeZ] of [
      [-11, 8, -4, 0, -12, 8], [11, 8, 4, 0, 12, 8],
      [0, 11, 0, 4, 0, 12], [-8, -11, 0, -4, -8, -12],
    ]) {
      const state = createWizardWorld('greenway-alpha')
      state.player.position = { x, y: terrainHeightAt(state.tiles, x, z), z }
      const moved = advanceWizardWorld(state, [{ type: 'move', delta: { x: dx, y: 0, z: dz } }])
      expect(moved.rejections).toEqual([])
      expect(moved.state.player.position).toMatchObject({ x: edgeX, z: edgeZ })
    }
  })

  it('reaches all four expanded grid edges while clamping outside movement', () => {
    for (const [x, z, dx, dz, edgeX, edgeZ] of [
      [-28, 16, -4, 0, -30, 16], [32, 16, 4, 0, 34, 16],
      [16, -28, 0, -4, 16, -30], [16, 32, 0, 4, 16, 34],
    ]) {
      const state = createWizardWorld('region-0', 'greenway-expanded-v1')
      expect(state.tiles).toHaveLength(256)
      state.player.position = { x, y: terrainHeightAt(state.tiles, x, z), z }
      const moved = advanceWizardWorld(state, [{ type: 'move', delta: { x: dx, y: 0, z: dz } }])
      expect(moved.rejections).toEqual([])
      expect(moved.state.player.position).toMatchObject({ x: edgeX, z: edgeZ })
      const beyond = advanceWizardWorld(moved.state, [{ type: 'move', delta: { x: dx, y: 0, z: dz } }])
      expect(beyond.state.player.position).toMatchObject({ x: edgeX, z: edgeZ })
    }
  })

  it('keeps expanded regions route-locked and replays movement after save restoration', () => {
    const state = createWizardWorld('region-0', 'greenway-expanded-v1')
    state.player.position = { x: -20, y: terrainHeightAt(state.tiles, -20, -4), z: -4 }
    const locked = advanceWizardWorld(state, [{ type: 'move', delta: { x: 0, y: 0, z: -0.2 } }])
    expect(locked.rejections[0]?.code).toBe('locked_area')
    expect(locked.events).toEqual([])
    expect(locked.state.player.position).toEqual(state.player.position)
    expect(locked.state.discoveredTileIds).toEqual(state.discoveredTileIds)

    state.player.position = { ...state.routes[0].from }
    state.player.inventory.push({ itemId: 'logs', quantity: 4 })
    const built = advanceWizardWorld(state, [{ type: 'build_route', routeId: 'greenway_ladder' }])
    const crossed = advanceWizardWorld(built.state, [{ type: 'traverse_route', routeId: 'greenway_ladder' }])
    expect(crossed.rejections).toEqual([])
    expect(areaAt(crossed.state.areas, crossed.state.player.position.x, crossed.state.player.position.z).id).toBe('northern_ridge')
    const restored = restoreWizardWorld(serializeWizardWorld(crossed.state))
    expect(restored.generationProfile).toBe('greenway-expanded-v1')
    expect(restored.tiles).toHaveLength(256)
    const northward = { type: 'move' as const, delta: { x: 0, y: 0, z: -4 } }
    expect(advanceWizardWorld(restored, [northward])).toEqual(advanceWizardWorld(crossed.state, [northward]))
    expect(advanceWizardWorld(restored, [northward]).state.player.position.z).toBe(-12)
  })

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)(
    'discovers the Eastern Highland tile at the bridge boundary in %s', (profile) => {
      const state = createWizardWorld('greenway-alpha', profile)
      const bridge = state.routes.find((route) => route.id === 'highland_bridge')!
      state.builtRouteIds = ['greenway_ladder', 'highland_bridge']
      state.player.position = { ...bridge.from }
      const crossed = advanceWizardWorld(state, [{ type: 'traverse_route', routeId: bridge.id }])

      expect(crossed.rejections).toEqual([])
      expect(crossed.state.player.position).toEqual({ ...bridge.to, x: 6, z: -8 })
      expect(crossed.events).toEqual([
        { type: 'route_used', routeId: bridge.id, fromAreaId: 'northern_ridge', toAreaId: 'eastern_highland', position: bridge.to, sequence: 1, tick: 1 },
        { type: 'tile_discovered', tileId: 'tile-5-1', sequence: 2, tick: 1 },
      ])
      const projection = createWizardProjection(crossed.state)
      expect(projection.currentTile.id).toBe('tile-5-1')
      expect(areaAt(crossed.state.areas, projection.currentTile.center.x, projection.currentTile.center.z).id).toBe('eastern_highland')
      expect(crossed.state.discoveredTileIds).toContain('tile-5-1')
      expect(crossed.state.discoveredTileIds).not.toContain('tile-4-1')

      const returned = advanceWizardWorld(crossed.state, [{ type: 'traverse_route', routeId: bridge.id }])
      expect(returned.events.map((entry) => entry.type)).toEqual(['route_used', 'tile_discovered'])
      expect(returned.events[1]).toMatchObject({ tileId: 'tile-4-1' })
      const crossedAgain = advanceWizardWorld(returned.state, [{ type: 'traverse_route', routeId: bridge.id }])
      expect(crossedAgain.events.map((entry) => entry.type)).toEqual(['route_used'])
      expect(crossedAgain.state.discoveredTileIds).toEqual(returned.state.discoveredTileIds)
    },
  )

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)(
    'discovers newly walked Northern Ridge tiles once and replays them after restore in %s', (profile) => {
      const state = createWizardWorld('greenway-alpha', profile)
      const ladder = state.routes.find((route) => route.id === 'greenway_ladder')!
      state.builtRouteIds = ['greenway_ladder']
      state.player.position = { ...ladder.from }
      const crossed = advanceWizardWorld(state, [{ type: 'traverse_route', routeId: ladder.id }])
      expect(crossed.events.map((entry) => entry.type)).toEqual(['route_used', 'tile_discovered'])
      const northward = { type: 'move' as const, delta: { x: 0, y: 0, z: -4 } }
      const walked = advanceWizardWorld(crossed.state, [northward])
      expect(walked.rejections).toEqual([])
      expect(walked.events.map((entry) => entry.type)).toEqual(['player_moved', 'tile_discovered'])
      expect(walked.events[1]).toMatchObject({ tileId: 'tile-3-0', sequence: 4, tick: 2 })
      expect(walked.state.discoveredTileIds).toContain('tile-3-0')

      const smallStep = { type: 'move' as const, delta: { x: 0.1, y: 0, z: 0 } }
      const repeated = advanceWizardWorld(walked.state, [smallStep])
      expect(repeated.events.map((entry) => entry.type)).toEqual(['player_moved'])
      expect(repeated.state.discoveredTileIds).toEqual(walked.state.discoveredTileIds)
      expect(advanceWizardWorld(restoreWizardWorld(serializeWizardWorld(walked.state)), [smallStep])).toEqual(repeated)
    },
  )

  it('reveals expanded outer tiles on walking while blocked movement keeps fog unchanged', () => {
    const state = createWizardWorld('region-0', 'greenway-expanded-v1')
    state.player.position = { x: 12, y: terrainHeightAt(state.tiles, 12, 0), z: 0 }
    expect(state.discoveredTileIds).not.toContain('tile-7-3')
    const walked = advanceWizardWorld(state, [{ type: 'move', delta: { x: 4, y: 0, z: 0 } }])
    expect(walked.events.map((entry) => entry.type)).toEqual(['player_moved', 'tile_discovered'])
    expect(walked.events[1]).toMatchObject({ tileId: 'tile-7-3' })
    expect(walked.state.discoveredTileIds).toContain('tile-7-3')

    const edge = createWizardWorld('region-0', 'greenway-expanded-v1')
    edge.player.position = { x: 34, y: terrainHeightAt(edge.tiles, 34, 16), z: 16 }
    const blocked = advanceWizardWorld(edge, [{ type: 'move', delta: { x: 4, y: 0, z: 0 } }])
    expect(blocked.state.player.position).toEqual(edge.player.position)
    expect(blocked.events.map((entry) => entry.type)).toEqual(['player_moved'])
    expect(blocked.state.discoveredTileIds).toEqual(edge.discoveredTileIds)
    const rejected = advanceWizardWorld(edge, [{ type: 'move', delta: { x: 5, y: 0, z: 0 } }])
    expect(rejected.rejections[0]?.code).toBe('invalid_value')
    expect(rejected.events).toEqual([])
    expect(rejected.state.discoveredTileIds).toEqual(edge.discoveredTileIds)
  })

  it('rejects route construction atomically and keeps previously revealed tiles unchanged', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    const ladder = state.routes.find((route) => route.id === 'greenway_ladder')!
    state.player.position = { ...ladder.from }
    const beforePlayer = structuredClone(state.player)
    const beforeFog = [...state.discoveredTileIds]
    const rejected = advanceWizardWorld(state, [{ type: 'build_route', routeId: 'greenway_ladder' }])
    expect(rejected.rejections[0]?.code).toBe('not_owned')
    expect(rejected.state.player).toEqual(beforePlayer)
    expect(rejected.state.builtRouteIds).toEqual([])
    expect(rejected.state.discoveredTileIds).toEqual(beforeFog)
    expect(rejected.state.tick).toBe(state.tick + 1)

    const looked = advanceWizardWorld(state, [{ type: 'look', yawDelta: 1, pitchDelta: 0 }])
    const moved = advanceWizardWorld(looked.state, [{ type: 'move', delta: { x: 0.1, y: 0, z: 0 } }])
    expect(moved.state.discoveredTileIds).toEqual(beforeFog)
  })

  it('migrates v1 progress deterministically and filters v2 progress identifiers', () => {
    const source = createWizardWorld('greenway-alpha')
    source.tick = 11
    source.eventSequence = 7
    source.rng.simulation = 54321
    source.player.coins = 42
    source.player.inventory.push({ itemId: 'logs', quantity: 2 })
    source.player.equipment.mainHand = 'woodcutters_axe'
    source.resources[0].health = 0
    source.resources[0].depleted = true
    source.stores[0].listings[0].stock = 1
    const legacy = JSON.parse(serializeWizardWorld(source)) as unknown as Record<string, unknown>
    legacy.schemaVersion = 'wizard-world/v1'
    legacy.resources = source.resources.filter((resource) => !resource.id.startsWith('greenway-journey-tree-'))
    delete legacy.contentRevision
    delete legacy.generationProfile
    delete legacy.areas
    delete legacy.routes
    delete legacy.recipes
    delete legacy.builtRouteIds
    delete legacy.unlockedRecipeIds
    delete legacy.discoveredTileIds
    delete (legacy.player as Record<string, unknown>).verticalVelocity
    expect(isRestorableWizardSave(JSON.stringify(legacy), 'greenway-classic-v1')).toBe(true)
    const migrated = restoreWizardWorld(JSON.stringify(legacy))
    expect(migrated.schemaVersion).toBe('wizard-world/v3')
    expect(migrated.contentRevision).toBe('greenway-region-v1')
    expect(migrated.seed).toBe(source.seed)
    expect(migrated.generationProfile).toBe('greenway-classic-v1')
    expect(migrated.tick).toBe(11)
    expect(migrated.eventSequence).toBe(7)
    expect(migrated.rng.simulation).toBe(54321)
    expect(migrated.player.coins).toBe(42)
    expect(migrated.player.inventory).toEqual(source.player.inventory)
    expect(migrated.player.equipment).toEqual(source.player.equipment)
    expect(migrated.resources[0]).toEqual(source.resources[0])
    expect(migrated.stores[0].listings[0].stock).toBe(1)
    expect(migrated.builtRouteIds).toEqual([])
    expect(migrated.unlockedRecipeIds).toEqual(['greenway_ladder'])
    expect(migrated.discoveredTileIds.length).toBeGreaterThan(0)

    const corrupt = JSON.parse(serializeWizardWorld(migrated)) as Record<string, unknown>
    corrupt.builtRouteIds = ['highland_bridge', 'greenway_ladder', 'greenway_ladder', 'bogus']
    corrupt.unlockedRecipeIds = ['highland_bridge', 'bogus', 'greenway_ladder']
    corrupt.discoveredTileIds = [migrated.tiles[0].id, 'bogus', migrated.tiles[0].id]
    const corruptPlayer = corrupt.player as Record<string, unknown>
    corruptPlayer.xp = 100
    const restored = restoreWizardWorld(JSON.stringify(corrupt))
    expect(restored.builtRouteIds).toEqual(['greenway_ladder', 'highland_bridge'])
    expect(restored.unlockedRecipeIds).toEqual(['greenway_ladder', 'highland_bridge'])
    expect(restored.discoveredTileIds).toEqual([...new Set([...migrated.discoveredTileIds, migrated.tiles[0].id])].sort())
    expect(advanceWizardWorld(restored, [])).toEqual(advanceWizardWorld(restoreWizardWorld(serializeWizardWorld(restored)), []))
  })

  it('quarantines a built Highland bridge restored below its minimum level', () => {
    const corrupt = copy(createWizardWorld('greenway-alpha'))
    corrupt.builtRouteIds = ['greenway_ladder', 'highland_bridge']
    corrupt.unlockedRecipeIds = ['greenway_ladder', 'highland_bridge']
    corrupt.player.xp = 0
    corrupt.player.level = 1
    const bridge = corrupt.routes.find((route) => route.id === 'highland_bridge')!
    corrupt.player.position = { ...bridge.to }

    const restored = restoreWizardWorld(serializeWizardWorld(corrupt))
    expect(restored.builtRouteIds).toEqual(['greenway_ladder'])
    expect(restored.unlockedRecipeIds).toEqual(['greenway_ladder'])
    const before = { ...restored.player.position }
    const traversed = advanceWizardWorld(restored, [{ type: 'traverse_route', routeId: 'highland_bridge' }])
    expect(traversed.rejections[0]?.code).toBe('recipe_locked')
    expect(traversed.state.player.position).toEqual(before)
  })
})

function resourceKindForBiome(biome: WizardWorldState['tiles'][number]['biome']) {
  return biome === 'temperate_forest' ? 'tree' : biome === 'marsh' ? 'herb' : biome === 'dry_highland' ? 'stone' : 'ore'
}
