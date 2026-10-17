import { describe, expect, it } from 'vitest'
import { GREENWAY_LOG_ORDER, greenwayOrderWouldArbitrage } from './greenwayProcurementOrder'
import { MIREGLASS_OUTPOST_SELL_PRICES } from './mireglassExpedition'
import { PUBLIC_V25_BEDROCK_LAYER, publicV25StratumAt } from './publicWorldV25Strata'
import { PUBLIC_V29_MINERAL_BIDS } from './publicWorldV29MineralSale'
import { PUBLIC_V29_PICK_PRICES } from './publicWorldV29MiningTools'
import { PUBLIC_V29_SCHEMA } from './publicWorldV29Migration'
import { PUBLIC_V11_BOOTS_PRICE } from './publicWorldGait'
import { createFreshPublicV42Root } from './publicWorldV42Snapshot'
import { storeSellUnitPrice } from './world'

const seed = 'wizard-realms'
const fresh = () => createFreshPublicV42Root(seed).head.state

describe('economy contracts across the opening, shops, and excavation', () => {
  it('keeps posted shop purchases above any reachable instant resale bid', () => {
    const world = fresh()
    const listings = world.greenway.stores.flatMap((store) => store.listings)
    expect(listings.length).toBeGreaterThan(0)
    for (const listing of listings) {
      const bestBid = Math.max(0, ...world.greenway.stores.map((store) =>
        storeSellUnitPrice(store.id, listing.itemId) ?? 0))
      expect(bestBid, `${listing.itemId} buy-to-store round trip`).toBeLessThan(listing.price)
    }
    const spade = listings.find((listing) => listing.itemId === 'field_spade')
    expect(spade).toBeDefined()
    expect(world.player.coins - PUBLIC_V11_BOOTS_PRICE - spade!.price
      - PUBLIC_V29_PICK_PRICES.basic).toBeGreaterThanOrEqual(0)
  })

  it('keeps the finite log order a modest premium over ordinary sale without buyback arbitrage', () => {
    const world = fresh()
    const regularSale = MIREGLASS_OUTPOST_SELL_PRICES.logs * GREENWAY_LOG_ORDER.quantity
    expect(storeSellUnitPrice(GREENWAY_LOG_ORDER.destinationStoreId, 'logs'))
      .toBe(MIREGLASS_OUTPOST_SELL_PRICES.logs)
    expect(GREENWAY_LOG_ORDER.payCoins).toBeGreaterThan(regularSale)
    expect(GREENWAY_LOG_ORDER.payCoins).toBeLessThanOrEqual(regularSale * 1.5)
    const postedLogBuyPrices = world.greenway.stores.flatMap((store) => store.listings)
      .filter((listing) => listing.itemId === GREENWAY_LOG_ORDER.itemId)
      .map((listing) => listing.price)
    expect(greenwayOrderWouldArbitrage(postedLogBuyPrices)).toBe(false)
  })

  it('bounds gross deep-geology sale potential over the maximum 256 saved columns', () => {
    const world = fresh()
    let grossCoins = 0
    let layers = 0
    for (let gx = -8; gx < 8; gx += 1) {
      for (let gz = -8; gz < 8; gz += 1) {
        for (let layer = 0; layer < PUBLIC_V25_BEDROCK_LAYER; layer += 1) {
          const { material } = publicV25StratumAt(seed, gx, gz, layer)
          if (material === 'bedrock') throw new Error('Bedrock appeared before the depth cap')
          grossCoins += PUBLIC_V29_MINERAL_BIDS[material]
          layers += 1
        }
      }
    }
    expect(layers).toBe(256 * PUBLIC_V25_BEDROCK_LAYER)
    // Geological gross value only: reaching, mining, carrying, and selling every layer is not assumed.
    expect(grossCoins).toBeGreaterThan(50 * world.player.coins)
    expect(grossCoins).toBeLessThan(150 * world.player.coins)
  })

  it('pins V29 replay tariffs so future price tuning requires a new rules version', () => {
    expect(PUBLIC_V29_SCHEMA).toBe('wizard-world/v29')
    expect(PUBLIC_V29_MINERAL_BIDS).toEqual({
      soil: 1, stone: 3, iron_ore: 8, gold_ore: 15, diamond: 60,
    })
    expect(PUBLIC_V29_PICK_PRICES).toEqual({ basic: 35, enchanted: 240 })
  })
})
