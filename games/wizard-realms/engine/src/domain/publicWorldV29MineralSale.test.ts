import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { emptyPublicV29MiningTools } from './publicWorldV29MiningTools'
import type { PublicV29Progress } from './publicWorldV29Migration'
import { applyPublicV29MineralSale, decodePublicV29MineralSale,
  PUBLIC_V29_MINERAL_BIDS } from './publicWorldV29MineralSale'
import type { PublicV29Mineral } from './publicWorldV29MineralSale'

function fixture(material: PublicV29Mineral, quantity = 2): PublicV29Progress {
  const { head } = createPublicV23Root('wizard-realms')
  const store = head.state.greenway.stores.find((entry) => entry.id === 'store-greenway')!
  const support = publicV17StarterSupportAt({ seed: head.state.seed,
    profile: head.state.generationProfile,
    route: head.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: head.greenwayWorks }, store.position)
  if (!support) throw new Error('Missing Outfitters support')
  const terrain = emptyPublicV26TerrainLedger()
  return { state: { ...head.state, player: { ...head.state.player,
    position: { ...store.position, y: support.floorY } } },
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
  terrain: { ...terrain, bag: { ...terrain.bag, [material]: quantity } },
  nextHomeAtMs: 0, riverBridgeIds: [], miningTools: emptyPublicV29MiningTools() }
}
const sell = (material: PublicV29Mineral, quantity = 1) =>
  ({ kind: 'sell-mineral/v1', material, quantity } as const)

describe('V29 checked mineral sale', () => {
  it('decodes only bounded exact data, never a client price or store position', () => {
    expect(decodePublicV29MineralSale(sell('soil', 256))).toEqual(sell('soil', 256))
    for (const raw of [sell('soil', 0), sell('soil', 257), sell('soil', 1.5),
      { ...sell('diamond'), unitPrice: 0 }, { ...sell('stone'), storeId: 'store-highland' },
      { ...sell('stone'), material: 'ancient_relic' }, { ...sell('stone'), quantity: NaN }])
      expect(decodePublicV29MineralSale(raw)).toBeNull()
  })

  it.each(Object.entries(PUBLIC_V29_MINERAL_BIDS) as [PublicV29Mineral, number][])(
    'sells mined %s at its fixed %i coin bid and leaves other material untouched',
    (material, unitPrice) => {
      const before = fixture(material), copy = structuredClone(before)
      const result = applyPublicV29MineralSale(before, sell(material))
      if (!result.progress) throw new Error(`Sale rejected: ${result.rejection}`)
      expect(result.progress.terrain.bag).toEqual({ ...before.terrain.bag, [material]: 1 })
      expect(result.progress.state.player.coins).toBe(before.state.player.coins + unitPrice)
      expect(result.progress.state.eventSequence).toBe(before.state.eventSequence + 1)
      expect(result.event).toEqual({ type: 'mineral_sold', material, quantity: 1,
        unitPrice, totalPrice: unitPrice, tick: before.state.tick,
        sequence: before.state.eventSequence + 1 })
      expect(before).toEqual(copy)
    })

  it('rejects unavailable, distant, unowned, and forged-store sales without changing progress', () => {
    const near = fixture('stone', 1), home = createPublicV23Root('wizard-realms')
      .head.state.player.position
    const far = { ...near, state: { ...near.state,
      player: { ...near.state.player, position: home } } }
    expect(applyPublicV29MineralSale(far, sell('stone'))).toEqual({ rejection: 'too_far' })
    const point = { x: 100, z: 0 }
    const support = resolvePublicV23Surface(near.state, point, [])
    if (!support) throw new Error('Missing streamed support fixture')
    const streamed = { ...near, state: { ...near.state,
      movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(near.state.discoveryMask),
        `tile-${Math.ceil(point.x / 4 - 0.5) + 3}-${Math.ceil(point.z / 4 - 0.5) + 3}`])].sort()),
      player: { ...near.state.player,
        position: { ...point, y: support.floorY } } } }
    expect(applyPublicV29MineralSale(streamed, sell('stone')))
      .toEqual({ rejection: 'unavailable_here' })
    expect(applyPublicV29MineralSale(near, sell('stone', 2)))
      .toEqual({ rejection: 'not_owned' })
    expect(applyPublicV29MineralSale(fixture('stone', 0), sell('stone')))
      .toEqual({ rejection: 'not_owned' })
    const [outfitters, highland] = near.state.greenway.stores
    const stores: typeof near.state.greenway.stores = [
      { ...outfitters, position: { ...outfitters.position, x: outfitters.position.x + 1 } },
      highland]
    const forged = { ...near, state: { ...near.state,
      greenway: { ...near.state.greenway, stores } } }
    expect(applyPublicV29MineralSale(forged, sell('stone')))
      .toEqual({ rejection: 'invalid_progress' })
  })

  it('uses safe coin and event arithmetic and never fabricates bag quantity', () => {
    const before = fixture('diamond', 1)
    const overflow = { ...before, state: { ...before.state,
      player: { ...before.state.player, coins: Number.MAX_SAFE_INTEGER } } }
    expect(applyPublicV29MineralSale(overflow, sell('diamond')))
      .toEqual({ rejection: 'invalid_value' })
    const sequenceOverflow = { ...before, state: { ...before.state,
      eventSequence: Number.MAX_SAFE_INTEGER } }
    expect(applyPublicV29MineralSale(sequenceOverflow, sell('diamond')))
      .toEqual({ rejection: 'invalid_value' })
    expect(applyPublicV29MineralSale(before, sell('diamond', 2)))
      .toEqual({ rejection: 'not_owned' })
  })
})
