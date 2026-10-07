import { describe, expect, it } from 'vitest'
import { createWizardWorld, type WizardWorldState } from './domain'
import { intentForView, movementIntent, toViewProjection } from './App'

const copy = (state: WizardWorldState): WizardWorldState => JSON.parse(JSON.stringify(state)) as WizardWorldState

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
    expect(projection.recentEvents).toEqual(['Visible event'])
    expect(projection.equipment.focus).toBeNull()
    expect(projection.equipment.hands).toBeNull()
  })

  it('maps movement relative to yaw at the bounded per-tick speed', () => {
    const state = createWizardWorld('greenway-alpha')
    expect(movementIntent(state, [0, 1])).toEqual({ type: 'move', delta: { x: 0, y: 0, z: -0.16 } })
    state.player.yaw = -Math.PI / 2
    const forward = movementIntent(state, [0, 1])
    expect(forward?.type).toBe('move')
    if (!forward || forward.type !== 'move') throw new Error('Expected a movement intent')
    expect(Math.hypot(forward.delta.x, forward.delta.z)).toBeCloseTo(0.16)
    expect(forward.delta.x).toBeCloseTo(0.16)
    expect(movementIntent(state, [0, 0])).toBeNull()
  })

  it('maps look, store, equipment, trade, and ring controls to exact domain intents', () => {
    const state = createWizardWorld('greenway-alpha')
    const before = JSON.stringify(state)
    expect(intentForView(state, { type: 'look', delta: [0.25, -0.1] })).toEqual({ type: 'look', yawDelta: -0.25, pitchDelta: 0.1 })
    expect(intentForView(state, { type: 'store.select-listing', storeId: 'store-greenway', listingId: 'hat' })).toEqual({ type: 'buy_store_listing', storeId: 'store-greenway', listingId: 'hat' })
    expect(intentForView(state, { type: 'equipment.equip', stackId: 'inventory-woodcutters_axe', slot: 'focus' })).toEqual({ type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' })
    expect(intentForView(state, { type: 'equipment.equip', stackId: 'inventory-wooden_shield', slot: 'hands' })).toEqual({ type: 'equip_item', itemId: 'wooden_shield', slot: 'offHand' })
    expect(intentForView(state, { type: 'trade.create-listing', stackId: 'inventory-logs', slot: 2, quantity: 1, unitPrice: 5 })).toEqual({ type: 'create_trade_listing', itemId: 'logs', slotIndex: 2, quantity: 1, unitPrice: 5 })
    expect(intentForView(state, { type: 'trade.cancel-listing', slot: 2 })).toEqual({ type: 'cancel_trade_listing', slotIndex: 2 })
    expect(intentForView(state, { type: 'fairy-ring.teleport', ringId: 'ring-greenway', destinationRingId: 'ring-highland' })).toEqual({ type: 'teleport_fairy_ring', sourceRingId: 'ring-greenway', targetRingId: 'ring-highland' })
    expect(JSON.stringify(state)).toBe(before)
  })

  it('resolves interaction to the closest actionable tree or undiscovered ring', () => {
    const state = copy(createWizardWorld('greenway-alpha'))
    const tree = state.resources.find((resource) => resource.kind === 'tree')!
    state.player.position = { ...tree.position }
    expect(intentForView(state, { type: 'interact' })).toEqual({ type: 'harvest', resourceId: tree.id })

    const ringState = copy(createWizardWorld('greenway-alpha'))
    ringState.resources.forEach((resource) => { resource.depleted = true })
    ringState.player.position = { ...ringState.fairyRings[0].position }
    expect(intentForView(ringState, { type: 'interact' })).toEqual({ type: 'discover_fairy_ring', ringId: ringState.fairyRings[0].id })
  })
})
