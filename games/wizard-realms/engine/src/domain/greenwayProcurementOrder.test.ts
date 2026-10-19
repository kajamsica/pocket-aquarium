import { describe, expect, it } from 'vitest'
import { createFreshPublicV42Root } from './publicWorldV42Snapshot'
import { decodePublicV42RewardProgress } from './publicWorldV42RewardAction'
import type { GreenwayProcurementProgress } from './greenwayProcurementOrder'
import { decodeGreenwayProcurementProgress, decodeGreenwayProcurementWitness,
  fulfillGreenwayProcurementOrder, GREENWAY_LOG_ORDER,
  greenwayOrderWouldArbitrage } from './greenwayProcurementOrder'

const fulfill = { kind: 'fulfill-greenway-logs/v1' } as const

function ready(logs: number = GREENWAY_LOG_ORDER.quantity): GreenwayProcurementProgress {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...source } = createFreshPublicV42Root('wizard-realms').head
  const store = source.state.greenway.stores.find((entry) =>
    entry.id === GREENWAY_LOG_ORDER.destinationStoreId)!
  const progress: GreenwayProcurementProgress = { ...source,
    greenwayOrder: { claimedAtSequence: null },
    state: { ...source.state, player: { ...source.state.player,
      position: { ...store.position },
      inventory: [...source.state.player.inventory, { itemId: 'logs', quantity: logs }] } } }
  expect(decodePublicV42RewardProgress(source)).not.toBeNull()
  expect(decodeGreenwayProcurementProgress(progress)).not.toBeNull()
  return progress
}

describe('finite Greenway procurement order', () => {
  it('shows quantity, destination, payment, route uses and a recovery source', () => {
    expect(GREENWAY_LOG_ORDER).toMatchObject({ destinationStoreId: 'store-greenway',
      itemId: 'logs', quantity: 4, payCoins: 10 })
    expect(GREENWAY_LOG_ORDER.routeUses).toEqual(expect.arrayContaining([
      expect.stringContaining('ladder'), expect.stringContaining('bridge'),
      expect.stringContaining('other trees'),
    ]))
  })

  it('fulfills exactly once, atomically, including after a persisted structured-clone reload', () => {
    const before = ready()
    const result = fulfillGreenwayProcurementOrder(before, fulfill)
    expect(result.rejection).toBeUndefined()
    expect(result.event).toEqual({ type: 'npc_order_fulfilled',
      orderId: GREENWAY_LOG_ORDER.id, itemId: 'logs', quantity: 4,
      payCoins: 10, storeId: 'store-greenway', tick: before.state.tick,
      sequence: before.state.eventSequence + 1 })
    expect(result.progress!.state.player.coins).toBe(before.state.player.coins + 10)
    expect(result.progress!.state.player.inventory.find((entry) =>
      entry.itemId === 'logs')).toBeUndefined()
    expect(result.progress!.greenwayOrder.claimedAtSequence)
      .toBe(result.progress!.state.eventSequence)
    expect(before.greenwayOrder.claimedAtSequence).toBeNull()
    expect(before.state.player.inventory.find((entry) => entry.itemId === 'logs')?.quantity)
      .toBe(4)
    expect(fulfillGreenwayProcurementOrder(result.progress, fulfill).rejection)
      .toBe('already_fulfilled')
    const reloaded = structuredClone(result.progress)
    expect(decodeGreenwayProcurementProgress(reloaded)).not.toBeNull()
    expect(fulfillGreenwayProcurementOrder(reloaded, fulfill).rejection)
      .toBe('already_fulfilled')
  })

  it('accepts a full backpack because fulfillment removes logs and adds only coins', () => {
    const normal = ready()
    const occupied = normal.state.player.inventory.reduce((sum, stack) =>
      sum + (stack.itemId === 'logs' ? 0 : stack.quantity), 0)
    const full = ready(normal.state.player.backpackCapacity - occupied)
    expect(full.state.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0))
      .toBe(full.state.player.backpackCapacity)
    const result = fulfillGreenwayProcurementOrder(full, fulfill)
    expect(result.rejection).toBeUndefined()
    expect(result.progress!.state.player.inventory.find((stack) =>
      stack.itemId === 'logs')?.quantity).toBe(full.state.player.backpackCapacity
        - occupied - GREENWAY_LOG_ORDER.quantity)
  })

  it('does not alter the source for insufficient stock, remote or wrong-region requests', () => {
    const tooFew = ready(3), snapshot = JSON.stringify(tooFew)
    expect(fulfillGreenwayProcurementOrder(tooFew, fulfill).rejection).toBe('not_owned')
    expect(JSON.stringify(tooFew)).toBe(snapshot)
    const remote = ready()
    remote.state.player.position = { ...createFreshPublicV42Root('wizard-realms')
      .head.state.player.position }
    expect(fulfillGreenwayProcurementOrder(remote, fulfill).rejection).toBe('too_far')
    const inGreenway = ready()
    const otherRegion = { ...inGreenway,
      state: { ...inGreenway.state, movementOwner: 'streamed' as const } }
    expect(fulfillGreenwayProcurementOrder(otherRegion, fulfill).rejection)
      .toBe('invalid_progress')
  })

  it('rejects forged reward payloads, completion claims and coin overflow', () => {
    expect(decodeGreenwayProcurementWitness({ ...fulfill, payCoins: 1000 })).toBeNull()
    expect(fulfillGreenwayProcurementOrder(ready(), { ...fulfill, quantity: 1 }).rejection)
      .toBe('invalid_action')
    const before = ready()
    expect(decodeGreenwayProcurementProgress({ ...before,
      greenwayOrder: { claimedAtSequence: before.state.eventSequence + 1 } }))
      .toBeNull()
    expect(decodeGreenwayProcurementProgress({ ...before,
      greenwayOrder: { claimedAtSequence: null, reset: true } })).toBeNull()
    const rich = ready()
    rich.state.player.coins = Number.MAX_SAFE_INTEGER
    expect(fulfillGreenwayProcurementOrder(rich, fulfill).rejection).toBe('invalid_value')
  })

  it('never creates a cheap-buy-to-order arbitrage at reachable prices', () => {
    expect(greenwayOrderWouldArbitrage([])).toBe(false)
    expect(greenwayOrderWouldArbitrage([3, 5])).toBe(false)
    expect(greenwayOrderWouldArbitrage([2, 5])).toBe(true)
    expect(greenwayOrderWouldArbitrage([Number.NaN])).toBe(true)
  })
})
