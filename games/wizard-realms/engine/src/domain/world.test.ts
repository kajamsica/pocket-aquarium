import { describe, expect, it } from 'vitest'
import {
  advanceWizardWorld, createWizardWorld, restoreWizardWorld, serializeWizardWorld,
  type WizardWorldState,
} from './index'
import { areaAt, terrainHeightAt } from './generation'

const copy = (state: WizardWorldState): WizardWorldState => JSON.parse(JSON.stringify(state)) as WizardWorldState

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

  it('rejects route construction atomically and reveals fog only through traversal', () => {
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
    const legacy = JSON.parse(serializeWizardWorld(createWizardWorld('greenway-alpha'))) as unknown as Record<string, unknown>
    legacy.schemaVersion = 'wizard-world/v1'
    delete legacy.builtRouteIds
    delete legacy.unlockedRecipeIds
    delete legacy.discoveredTileIds
    const migrated = restoreWizardWorld(JSON.stringify(legacy))
    expect(migrated.schemaVersion).toBe('wizard-world/v2')
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
