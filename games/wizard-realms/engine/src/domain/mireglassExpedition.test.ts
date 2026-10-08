import { describe, expect, it } from 'vitest'
import { createGeneratedWorld } from './generation'
import { mireglassAnchors, mireglassResources } from './mireglassContent'
import { applyMireglassExpeditionAction, createMireglassExpeditionProgress, MIREGLASS_OUTPOST_CATALOG } from './mireglassExpedition'
import type { MireglassExpeditionAction, MireglassExpeditionProgress, MireglassExpeditionResult, MireglassItemId } from './mireglassExpedition'
import { mireglassRouteSites } from './mireglassRouteSites'
import { isRestorableWizardSave, serializeWizardWorld } from './persistence'
import type { PlayerState, Vec3 } from './types'

const seed = 'mireglass-expedition-actions'
const anchors = mireglassAnchors(seed)
const trees = mireglassResources(seed)
const sites = mireglassRouteSites(seed)
const bridge = sites.find(({ kind }) => kind === 'bridge')!
const otherBridge = sites.find(({ kind, id }) => kind === 'bridge' && id !== bridge.id)!
const ladder = sites.find(({ kind }) => kind === 'ladder')!
const seal = 'mireglass_reach/item/seal'
const waders = 'mireglass_reach/item/waders'
const count = (progress: MireglassExpeditionProgress, itemId: MireglassItemId) => progress.player.inventory
  .filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.quantity, 0)

function earnedPlayer(): PlayerState {
  const player = createGeneratedWorld(seed).player
  player.learnedSpellIds = ['wayfinder_glow']
  player.skillXp.excavation = 30
  return player
}

function accepted(result: MireglassExpeditionResult): Exclude<MireglassExpeditionResult, { rejection: object }> {
  expect(result.rejection).toBeUndefined()
  expect(result.event).toBeDefined()
  return result as Exclude<MireglassExpeditionResult, { rejection: object }>
}

function rejected(result: MireglassExpeditionResult, code: NonNullable<MireglassExpeditionResult['rejection']>['code'], original: MireglassExpeditionProgress) {
  expect(result.rejection?.code).toBe(code)
  expect(result.event).toBeUndefined()
  expect(result.newPosition).toBeUndefined()
  expect(result.progress).toBe(original)
}

describe('isolated Mireglass expedition action authority', () => {
  it('starts from a complete generated v5 player without hidden progression', () => {
    const source = createGeneratedWorld(seed).player
    const fresh = createMireglassExpeditionProgress(seed)
    expect(fresh.player).toEqual(source)
    expect(fresh.player).not.toBe(source)
    expect(fresh.player).toMatchObject({ coins: 120, xp: 0, level: 1, backpackCapacity: 20,
      equipment: { head: null, chest: null, legs: null, feet: null, mainHand: null, offHand: null },
      learnedSpellIds: [], skillXp: { excavation: 0 } })
    expect(count(fresh, 'woodcutters_axe')).toBe(1)
    expect(fresh).toMatchObject({ builtRoutes: { bridge: null, ladder: null },
      cacheRevealed: false, cacheExcavated: false,
      shopStock: { field_spade: 3, [waders]: 2 } })
    rejected(applyMireglassExpeditionAction(seed, anchors.sealCache.tile.center, fresh,
      { type: 'cast_wayfinder_glow' }), 'unlearned_spell', fresh)
    rejected(applyMireglassExpeditionAction(seed, trees[0].tile.center, fresh,
      { type: 'chop_tree', resourceId: trees[0].id }), 'requires_axe', fresh)
    expect(() => createMireglassExpeditionProgress(seed, { ...source, skillXp: { ...source.skillXp, excavation: -1 } }))
      .toThrow(RangeError)
  })

  it('imports every validated v5 player fact by value and preserves unrelated facts through an action', () => {
    const source = earnedPlayer()
    source.coins = 247
    source.xp = 135
    source.level = 2
    source.yaw = 1.2
    source.pitch = -0.3
    source.verticalVelocity = 0.4
    source.inventory = [
      { itemId: 'apprentice_hat', quantity: 1 }, { itemId: 'traveler_tunic', quantity: 1 },
      { itemId: 'trail_leggings', quantity: 1 }, { itemId: 'leather_boots', quantity: 1 },
      { itemId: 'woodcutters_axe', quantity: 1 }, { itemId: 'wooden_shield', quantity: 1 },
      { itemId: 'field_spade', quantity: 1 }, { itemId: 'oak_wand', quantity: 1 },
      { itemId: 'logs', quantity: 1 },
    ]
    source.equipment = { head: 'apprentice_hat', chest: 'traveler_tunic', legs: 'trail_leggings',
      feet: 'leather_boots', mainHand: 'woodcutters_axe', offHand: 'wooden_shield' }
    source.tradeSlots = [
      { slotIndex: 0, itemId: 'stone', quantity: 2, unitPrice: 5 },
      { slotIndex: 1, itemId: 'marsh_herb', quantity: 1, unitPrice: 4 },
      { slotIndex: 2, itemId: null, quantity: 0, unitPrice: 0 },
      { slotIndex: 3, itemId: null, quantity: 0, unitPrice: 0 },
    ]
    source.discoveredRingIds = ['ring-greenway', 'ring-highland']
    source.skillXp = { woodcutting: 12, construction: 60, wayfinding: 7, spellcraft: 9, excavation: 30 }
    const v5World = createGeneratedWorld(seed)
    v5World.player = source
    expect(isRestorableWizardSave(serializeWizardWorld(v5World), v5World.generationProfile)).toBe(true)
    const sourceBytes = JSON.stringify(source)
    const imported = createMireglassExpeditionProgress(seed, source)
    expect(imported.player).toEqual(source)
    expect(imported.player.position).toEqual(source.position)
    expect(imported.player.inventory).not.toBe(source.inventory)
    expect(imported.player.equipment).not.toBe(source.equipment)
    expect(imported.player.tradeSlots).not.toBe(source.tradeSlots)
    expect(imported.player.skillXp).not.toBe(source.skillXp)
    expect(JSON.stringify(source)).toBe(sourceBytes)

    const chopped = accepted(applyMireglassExpeditionAction(seed, trees[0].tile.center, imported,
      { type: 'chop_tree', resourceId: trees[0].id })).progress
    expect(JSON.stringify(source)).toBe(sourceBytes)
    expect(imported.player).toEqual(source)
    expect(chopped.player.coins).toBe(247)
    expect(chopped.player.level).toBe(2)
    expect(chopped.player.xp).toBe(155)
    expect(chopped.player.position).toEqual(trees[0].tile.center)
    expect(chopped.player.verticalVelocity).toBe(0.4)
    expect(chopped.player.yaw).toBe(1.2)
    expect(chopped.player.pitch).toBe(-0.3)
    expect(chopped.player.equipment).toEqual(source.equipment)
    expect(chopped.player.tradeSlots).toEqual(source.tradeSlots)
    expect(chopped.player.discoveredRingIds).toEqual(source.discoveredRingIds)
    expect(chopped.player.learnedSpellIds).toEqual(source.learnedSpellIds)
    expect(chopped.player.inventory.filter(({ itemId }) => itemId !== 'logs'))
      .toEqual(source.inventory.filter(({ itemId }) => itemId !== 'logs'))
    expect(count(chopped, 'logs')).toBe(5)
    expect(chopped.player.skillXp).toEqual({ ...source.skillXp, woodcutting: 32 })
    expect(JSON.parse(JSON.stringify(chopped))).toEqual(chopped)
  })

  it('completes the outbound sequence using one player, both route directions, and one seal', () => {
    let progress = createMireglassExpeditionProgress(seed, earnedPlayer())
    const step = (position: Vec3, action: MireglassExpeditionAction) => {
      const prior = progress
      const result = accepted(applyMireglassExpeditionAction(seed, position, progress, action))
      expect(progress).toBe(prior)
      progress = result.progress
      return result
    }
    step(anchors.salvager.tile.center, { type: 'buy_item', itemId: 'field_spade' })
    step(trees[0].tile.center, { type: 'equip_item', itemId: 'woodcutters_axe' })
    for (const tree of trees.filter(({ phase }) => phase === 'before_bridge')) {
      expect(step(tree.tile.center, { type: 'chop_tree', resourceId: tree.id }).event)
        .toMatchObject({ itemId: 'logs', quantity: 4, xp: 20 })
    }
    expect(count(progress, 'logs')).toBe(12)
    expect(step(bridge.from, { type: 'build_route', siteId: bridge.id }).event)
      .toMatchObject({ siteId: bridge.id, logCost: 8, xp: 80 })
    expect(count(progress, 'logs')).toBe(4)
    const crossed = step(bridge.from, { type: 'traverse_route', siteId: bridge.id, from: 'from' })
    expect(crossed.newPosition).toEqual(bridge.to)
    expect(crossed.progress.player.position).toEqual(bridge.to)
    expect(step(bridge.to, { type: 'traverse_route', siteId: bridge.id, from: 'to' }).newPosition).toEqual(bridge.from)
    for (const tree of trees.filter(({ phase }) => phase === 'after_bridge')) step(tree.tile.center, { type: 'chop_tree', resourceId: tree.id })
    expect(count(progress, 'logs')).toBe(16)
    expect(step(ladder.from, { type: 'build_route', siteId: ladder.id }).event)
      .toMatchObject({ siteId: ladder.id, logCost: 4, xp: 60 })
    expect(step(ladder.from, { type: 'traverse_route', siteId: ladder.id, from: 'from' }).newPosition).toEqual(ladder.to)
    expect(step(anchors.sealCache.tile.center, { type: 'cast_wayfinder_glow' }).event)
      .toMatchObject({ cacheId: anchors.sealCache.id, xp: 10 })
    step(anchors.sealCache.tile.center, { type: 'equip_item', itemId: 'field_spade' })
    expect(step(anchors.sealCache.tile.center, { type: 'excavate_cache' }).event)
      .toMatchObject({ itemId: seal, quantity: 1, xp: 40 })
    expect(count(progress, seal)).toBe(1)
    expect(step(ladder.to, { type: 'traverse_route', siteId: ladder.id, from: 'to' }).newPosition).toEqual(ladder.from)
    expect(step(anchors.salvager.tile.center, { type: 'sell_item', itemId: seal, quantity: 1 }).event)
      .toMatchObject({ unitPrice: 80, totalPrice: 80 })
    expect(progress.player.coins).toBe(182)
    expect(step(anchors.salvager.tile.center, { type: 'buy_item', itemId: waders }).event)
      .toMatchObject({ price: 150, stockRemaining: 1 })
    expect(step(anchors.salvager.tile.center, { type: 'equip_item', itemId: waders }).event)
      .toMatchObject({ slot: 'feet' })
    expect(progress).toMatchObject({ player: { coins: 32, xp: 310, level: 4,
      equipment: { mainHand: 'field_spade', feet: waders },
      skillXp: { woodcutting: 120, construction: 140, spellcraft: 10, wayfinding: 10, excavation: 70 } },
    cacheRevealed: true, cacheExcavated: true, builtRoutes: { bridge: bridge.id, ladder: ladder.id } })
    expect(count(progress, 'logs')).toBe(12)
    expect(count(progress, seal)).toBe(0)
    expect(count(progress, waders)).toBe(1)
    expect(progress.depletedResourceIds).toHaveLength(6)
    rejected(applyMireglassExpeditionAction(seed, trees[0].tile.center, progress,
      { type: 'chop_tree', resourceId: trees[0].id }), 'depleted', progress)
    rejected(applyMireglassExpeditionAction(seed, anchors.sealCache.tile.center, progress,
      { type: 'cast_wayfinder_glow' }), 'already_revealed', progress)
    rejected(applyMireglassExpeditionAction(seed, anchors.sealCache.tile.center, progress,
      { type: 'excavate_cache' }), 'already_excavated', progress)
    rejected(applyMireglassExpeditionAction(seed, bridge.from, progress,
      { type: 'build_route', siteId: otherBridge.id }), 'already_built', progress)
  })

  it('rejects noncanonical or unreachable actions and protects held capacity', () => {
    const fresh = createMireglassExpeditionProgress(seed)
    const tree = trees[0]
    rejected(applyMireglassExpeditionAction(seed, { ...tree.tile.center, x: tree.tile.center.x + 3.01 }, fresh,
      { type: 'chop_tree', resourceId: tree.id }), 'too_far', fresh)
    rejected(applyMireglassExpeditionAction(seed, tree.tile.center, fresh,
      { type: 'chop_tree', resourceId: 'forged-tree' }), 'not_found', fresh)
    const axe = accepted(applyMireglassExpeditionAction(seed, tree.tile.center, fresh,
      { type: 'equip_item', itemId: 'woodcutters_axe' })).progress
    const full = { ...axe, player: { ...axe.player, inventory: [...axe.player.inventory, { itemId: 'logs' as const, quantity: 16 }] } }
    rejected(applyMireglassExpeditionAction(seed, tree.tile.center, full,
      { type: 'chop_tree', resourceId: tree.id }), 'capacity', full)
    const escrowed = { ...axe, player: { ...axe.player,
      inventory: [...axe.player.inventory, { itemId: 'logs' as const, quantity: 15 }],
      tradeSlots: [{ slotIndex: 0 as const, itemId: 'stone' as const, quantity: 1, unitPrice: 2 },
        ...axe.player.tradeSlots.slice(1)] as typeof axe.player.tradeSlots } }
    rejected(applyMireglassExpeditionAction(seed, tree.tile.center, escrowed,
      { type: 'chop_tree', resourceId: tree.id }), 'capacity', escrowed)
    const chopped = accepted(applyMireglassExpeditionAction(seed, tree.tile.center, axe,
      { type: 'chop_tree', resourceId: tree.id })).progress
    expect(applyMireglassExpeditionAction(seed, tree.tile.center, axe,
      { type: 'chop_tree', resourceId: tree.id })).toEqual({ progress: chopped,
      event: { type: 'tree_chopped', resourceId: tree.id, itemId: 'logs', quantity: 4, xp: 20 } })
    rejected(applyMireglassExpeditionAction(seed, tree.tile.center, chopped,
      { type: 'chop_tree', resourceId: tree.id }), 'depleted', chopped)
    rejected(applyMireglassExpeditionAction(seed, bridge.from, fresh,
      { type: 'build_route', siteId: bridge.id }), 'not_owned', fresh)
    rejected(applyMireglassExpeditionAction(seed, bridge.from, fresh,
      { type: 'build_route', siteId: 'forged-site' }), 'not_found', fresh)
    rejected(applyMireglassExpeditionAction(seed, bridge.from, fresh,
      { type: 'traverse_route', siteId: bridge.id, from: 'from' }), 'not_built', fresh)
    const funded = { ...fresh, player: { ...fresh.player,
      inventory: [...fresh.player.inventory, { itemId: 'logs' as const, quantity: 8 }] } }
    rejected(applyMireglassExpeditionAction(seed, bridge.to, funded,
      { type: 'build_route', siteId: bridge.id }), 'too_far', funded)
    const built = accepted(applyMireglassExpeditionAction(seed, bridge.from, funded,
      { type: 'build_route', siteId: bridge.id })).progress
    rejected(applyMireglassExpeditionAction(seed, otherBridge.from, built,
      { type: 'traverse_route', siteId: otherBridge.id, from: 'from' }), 'not_built', built)
    rejected(applyMireglassExpeditionAction(seed, { ...bridge.from, x: bridge.from.x + 3.01 }, built,
      { type: 'traverse_route', siteId: bridge.id, from: 'from' }), 'too_far', built)
    expect(accepted(applyMireglassExpeditionAction(seed, bridge.to, built,
      { type: 'traverse_route', siteId: bridge.id, from: 'to' })).newPosition).toEqual(bridge.from)
  })

  it('enforces reveal, excavation level, spade, reach, and reward capacity', () => {
    const fresh = createMireglassExpeditionProgress(seed)
    rejected(applyMireglassExpeditionAction(seed, anchors.sealCache.tile.center, fresh,
      { type: 'excavate_cache' }), 'site_hidden', fresh)
    const learned = createMireglassExpeditionProgress(seed, earnedPlayer())
    rejected(applyMireglassExpeditionAction(seed, { ...anchors.sealCache.tile.center, x: anchors.sealCache.tile.center.x + 8.01 }, learned,
      { type: 'cast_wayfinder_glow' }), 'too_far', learned)
    const revealed = accepted(applyMireglassExpeditionAction(seed, anchors.sealCache.tile.center, learned,
      { type: 'cast_wayfinder_glow' })).progress
    rejected(applyMireglassExpeditionAction(seed, anchors.sealCache.tile.center, revealed,
      { type: 'excavate_cache' }), 'requires_spade', revealed)
    const withSpade = accepted(applyMireglassExpeditionAction(seed, anchors.salvager.tile.center, revealed,
      { type: 'buy_item', itemId: 'field_spade' })).progress
    const equipped = accepted(applyMireglassExpeditionAction(seed, anchors.sealCache.tile.center, withSpade,
      { type: 'equip_item', itemId: 'field_spade' })).progress
    const novice = { ...equipped, player: { ...equipped.player,
      skillXp: { ...equipped.player.skillXp, excavation: 29 } } }
    rejected(applyMireglassExpeditionAction(seed, anchors.sealCache.tile.center, novice,
      { type: 'excavate_cache' }), 'skill_locked', novice)
    const full = { ...equipped, player: { ...equipped.player,
      inventory: [...equipped.player.inventory, { itemId: 'logs' as const, quantity: 18 }] } }
    rejected(applyMireglassExpeditionAction(seed, anchors.sealCache.tile.center, full,
      { type: 'excavate_cache' }), 'capacity', full)
    rejected(applyMireglassExpeditionAction(seed, { ...anchors.sealCache.tile.center, z: anchors.sealCache.tile.center.z + 3.01 }, equipped,
      { type: 'excavate_cache' }), 'too_far', equipped)
  })

  it('enforces outpost prices, stock, positive sales, and seed integrity', () => {
    const fresh = createMireglassExpeditionProgress(seed)
    const atOutpost = anchors.salvager.tile.center
    rejected(applyMireglassExpeditionAction(seed, { ...atOutpost, z: atOutpost.z + 3.01 }, fresh,
      { type: 'buy_item', itemId: 'field_spade' }), 'too_far', fresh)
    rejected(applyMireglassExpeditionAction(seed, atOutpost, fresh,
      { type: 'buy_item', itemId: waders }), 'insufficient_coins', fresh)
    rejected(applyMireglassExpeditionAction(seed, atOutpost, fresh,
      { type: 'sell_item', itemId: 'logs', quantity: 0 }), 'invalid_value', fresh)
    rejected(applyMireglassExpeditionAction(seed, atOutpost, fresh,
      { type: 'sell_item', itemId: 'logs', quantity: 1 }), 'not_owned', fresh)
    rejected(applyMireglassExpeditionAction(seed, atOutpost, fresh,
      { type: 'equip_item', itemId: 'field_spade' }), 'not_owned', fresh)
    const withLogs = { ...fresh, player: { ...fresh.player,
      inventory: [...fresh.player.inventory, { itemId: 'logs' as const, quantity: 4 }] } }
    const sold = accepted(applyMireglassExpeditionAction(seed, atOutpost, withLogs,
      { type: 'sell_item', itemId: 'logs', quantity: 4 }))
    expect(sold.event).toMatchObject({ unitPrice: 2, totalPrice: 8 })
    expect(sold.progress.player.coins).toBe(128)
    const full = { ...fresh, player: { ...fresh.player,
      inventory: [...fresh.player.inventory, { itemId: 'logs' as const, quantity: 19 }] } }
    rejected(applyMireglassExpeditionAction(seed, atOutpost, full,
      { type: 'buy_item', itemId: 'field_spade' }), 'capacity', full)
    let stock = fresh
    for (let i = 0; i < MIREGLASS_OUTPOST_CATALOG.field_spade.stock; i += 1) {
      stock = accepted(applyMireglassExpeditionAction(seed, atOutpost, stock,
        { type: 'buy_item', itemId: 'field_spade' })).progress
    }
    expect(stock.shopStock.field_spade).toBe(0)
    rejected(applyMireglassExpeditionAction(seed, atOutpost, stock,
      { type: 'buy_item', itemId: 'field_spade' }), 'out_of_stock', stock)
    rejected(applyMireglassExpeditionAction('another-seed', atOutpost, fresh,
      { type: 'buy_item', itemId: 'field_spade' }), 'seed_mismatch', fresh)
    rejected(applyMireglassExpeditionAction(seed, { x: NaN, y: 0, z: 0 }, fresh,
      { type: 'buy_item', itemId: 'field_spade' }), 'invalid_value', fresh)
    expect(applyMireglassExpeditionAction(seed, atOutpost, fresh,
      null as unknown as MireglassExpeditionAction).rejection)
      .toMatchObject({ code: 'invalid_value', actionType: 'unknown' })
    const negative = { ...fresh, player: { ...fresh.player, coins: -1 } }
    rejected(applyMireglassExpeditionAction(seed, atOutpost, negative,
      { type: 'buy_item', itemId: 'field_spade' }), 'invalid_progress', negative)
    expect(createMireglassExpeditionProgress('')).toEqual(createMireglassExpeditionProgress('wizard-realms'))
  })
})
