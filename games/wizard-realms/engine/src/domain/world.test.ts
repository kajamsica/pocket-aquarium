import { describe, expect, it } from 'vitest'
import {
  advanceWizardWorld, createWizardWorld, restoreWizardWorld, serializeWizardWorld,
  type WizardWorldState,
} from './index'

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
    expect(first.resources.map((resource) => [resource.tileId, resource.kind]))
      .toEqual(first.tiles.map((tile) => [tile.id, resourceKindForBiome(tile.biome)]))
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
    expect(serializeWizardWorld(rejected.state)).toBe(before)
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
    expect(serializeWizardWorld(rejected.state)).toBe(beforeRejected)

    state = copy(discoveredSource.state)
    state.player.position = { ...target.position }
    const discoveredTarget = advanceWizardWorld(state, [{ type: 'discover_fairy_ring', ringId: target.id }]).state
    state = copy(discoveredTarget)
    state.player.position = { ...source.position }
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

  it('restores a save with next-tick equivalence', () => {
    const initial = advanceWizardWorld(createWizardWorld('greenway-alpha'), [{ type: 'look', yawDelta: 0.2, pitchDelta: -0.1 }]).state
    const restored = restoreWizardWorld(serializeWizardWorld(initial))
    const intent = { type: 'move' as const, delta: { x: 0.1, y: 0, z: -0.1 } }
    expect(advanceWizardWorld(restored, [intent])).toEqual(advanceWizardWorld(initial, [intent]))
  })
})

function resourceKindForBiome(biome: WizardWorldState['tiles'][number]['biome']) {
  return biome === 'temperate_forest' ? 'tree' : biome === 'marsh' ? 'herb' : biome === 'dry_highland' ? 'stone' : 'ore'
}
