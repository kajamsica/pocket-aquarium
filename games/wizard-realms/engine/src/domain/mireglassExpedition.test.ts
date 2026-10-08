import { describe, expect, it } from 'vitest'
import { createGeneratedWorld } from './generation'
import { MIREGLASS_RING_ID, mireglassAnchors, mireglassFairyRing, mireglassResources } from './mireglassContent'
import {
  applyMireglassExpeditionAction, createMireglassRegionProgress, createMireglassV6Player,
  isValidMireglassRegionProgress, isValidMireglassV6Player, MIREGLASS_OUTPOST_CATALOG,
  mireglassGlowRevealableTileIds,
} from './mireglassExpedition'
import type {
  MireglassExpeditionAction, MireglassExpeditionResult, MireglassItemId, MireglassRegionProgress, MireglassV6Player,
} from './mireglassExpedition'
import { mireglassRouteSites } from './mireglassRouteSites'
import { isRestorableWizardSave, serializeWizardWorld } from './persistence'
import type { PlayerState, Vec3 } from './types'
import { worldTileAtGrid } from './worldChunks'

const seed = 'mireglass-expedition-actions'
const anchors = mireglassAnchors(seed)
const trees = mireglassResources(seed)
const sites = mireglassRouteSites(seed)
const bridge = sites.find(({ kind }) => kind === 'bridge')!
const otherBridge = sites.find(({ kind, id }) => kind === 'bridge' && id !== bridge.id)!
const ladder = sites.find(({ kind }) => kind === 'ladder')!
const seal = 'mireglass_reach/item/seal'
const waders = 'mireglass_reach/item/waders'
const at = (player: MireglassV6Player, position: Vec3): MireglassV6Player =>
  ({ ...player, position: { ...position } })
const count = (player: MireglassV6Player, itemId: MireglassItemId) => player.inventory
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

function rejected(result: MireglassExpeditionResult, code: NonNullable<MireglassExpeditionResult['rejection']>['code'],
  player: MireglassV6Player, region: MireglassRegionProgress) {
  expect(result.rejection?.code).toBe(code)
  expect(result.event).toBeUndefined()
  expect(result.player).toBe(player)
  expect(result.region).toBe(region)
}

describe('Mireglass player and region action authority', () => {
  it('creates a separate region overlay and a complete fresh v5-derived player without hidden progression', () => {
    const source = createGeneratedWorld(seed).player
    const player = createMireglassV6Player(seed)
    const region = createMireglassRegionProgress(seed)
    expect(player).toEqual(source)
    expect(player).not.toBe(source)
    expect(player).toMatchObject({ coins: 120, xp: 0, level: 1, backpackCapacity: 20,
      equipment: { head: null, chest: null, legs: null, feet: null, mainHand: null, offHand: null },
      learnedSpellIds: [], skillXp: { excavation: 0 } })
    expect(count(player, 'woodcutters_axe')).toBe(1)
    expect(region).toMatchObject({ builtRoutes: { bridge: null, ladder: null },
      fringeMarkerStudied: false, dugStumpIds: [], cacheRevealed: false, cacheExcavated: false,
      shopStock: { field_spade: 3, [waders]: 2 } })
    expect(region).not.toHaveProperty('player')
    expect(isValidMireglassV6Player(player)).toBe(true)
    expect(isValidMireglassRegionProgress(region, seed)).toBe(true)
    const nearCache = at(player, anchors.sealCache.tile.center)
    rejected(applyMireglassExpeditionAction(seed, nearCache, region,
      { type: 'cast_wayfinder_glow' }), 'unlearned_spell', nearCache, region)
    const nearTree = at(player, trees[0].tile.center)
    rejected(applyMireglassExpeditionAction(seed, nearTree, region,
      { type: 'chop_tree', resourceId: trees[0].id }), 'requires_axe', nearTree, region)
    expect(() => createMireglassV6Player(seed,
      { ...source, skillXp: { ...source.skillXp, excavation: -1 } })).toThrow(RangeError)
  })

  it('discovers the outpost fairy ring only at authoritative 3m reach and never rediscovers it', () => {
    const player = createMireglassV6Player(seed)
    const region = createMireglassRegionProgress(seed)
    const ring = mireglassFairyRing(seed)
    const tooFar = at(player, { ...ring.tile.center, x: ring.tile.center.x + 3.01 })
    rejected(applyMireglassExpeditionAction(seed, tooFar, region,
      { type: 'discover_fairy_ring' }), 'too_far', tooFar, region)
    const inReach = at(player, { ...ring.tile.center, x: ring.tile.center.x + 3 })
    const before = JSON.stringify(inReach)
    const discovered = accepted(applyMireglassExpeditionAction(seed, inReach, region,
      { type: 'discover_fairy_ring' }))
    expect(discovered.event).toEqual({ type: 'fairy_ring_discovered', ringId: MIREGLASS_RING_ID })
    expect(discovered.player.discoveredRingIds).toEqual([MIREGLASS_RING_ID])
    expect(discovered.player).not.toBe(inReach)
    expect(discovered.region).toBe(region)
    expect(JSON.stringify(inReach)).toBe(before)
    expect(isValidMireglassV6Player(discovered.player)).toBe(true)
    rejected(applyMireglassExpeditionAction(seed, discovered.player, region,
      { type: 'discover_fairy_ring' }), 'already_discovered', discovered.player, region)
  })

  it('deep-copies every validated v5 player fact and leaves the imported source bytes unchanged', () => {
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
    const player = createMireglassV6Player(seed, source)
    const region = createMireglassRegionProgress(seed)
    expect(player).toEqual(source)
    expect(player.position).toEqual(source.position)
    expect(player.inventory).not.toBe(source.inventory)
    expect(player.equipment).not.toBe(source.equipment)
    expect(player.tradeSlots).not.toBe(source.tradeSlots)
    expect(player.skillXp).not.toBe(source.skillXp)
    const nearTree = at(player, trees[0].tile.center)
    const chopped = accepted(applyMireglassExpeditionAction(seed, nearTree, region,
      { type: 'chop_tree', resourceId: trees[0].id }))
    expect(JSON.stringify(source)).toBe(sourceBytes)
    expect(player).toEqual(source)
    expect(chopped.player).toMatchObject({ coins: 247, xp: 155, level: 2,
      position: trees[0].tile.center, verticalVelocity: 0.4, yaw: 1.2, pitch: -0.3 })
    expect(chopped.player.equipment).toEqual(source.equipment)
    expect(chopped.player.tradeSlots).toEqual(source.tradeSlots)
    expect(chopped.player.discoveredRingIds).toEqual(source.discoveredRingIds)
    expect(chopped.player.learnedSpellIds).toEqual(source.learnedSpellIds)
    expect(chopped.player.inventory.filter(({ itemId }) => itemId !== 'logs'))
      .toEqual(source.inventory.filter(({ itemId }) => itemId !== 'logs'))
    expect(count(chopped.player, 'logs')).toBe(5)
    expect(chopped.player.skillXp).toEqual({ ...source.skillXp, woodcutting: 32 })
    expect(JSON.parse(JSON.stringify({ player: chopped.player, region: chopped.region })))
      .toEqual({ player: chopped.player, region: chopped.region })
  })

  it('reveals new 4 m terrain by the bell alder once and awards only discovery XP', () => {
    const player = at(createMireglassV6Player(seed, earnedPlayer()), anchors.bellAlder.tile.center)
    const region = createMireglassRegionProgress(seed)
    const known = [anchors.bellAlder.tile.id]
    const revealedTileIds = mireglassGlowRevealableTileIds(seed, player.position, known)
    expect(revealedTileIds).toContain(worldTileAtGrid(seed,
      player.position.x / 4 + 1, player.position.z / 4).id)
    expect(revealedTileIds).not.toContain(worldTileAtGrid(seed,
      player.position.x / 4 + 3, player.position.z / 4).id)
    expect(revealedTileIds.length).toBeGreaterThan(0)
    const cast = accepted(applyMireglassExpeditionAction(seed, player, region,
      { type: 'cast_wayfinder_glow' }, known))
    expect(cast.event).toEqual({ type: 'terrain_revealed', spellId: 'wayfinder_glow',
      revealedTileIds, xp: revealedTileIds.length * 10 })
    expect(cast.region).toBe(region)
    expect(cast.player.xp - player.xp).toBe(revealedTileIds.length * 10)
    expect(cast.player.skillXp.spellcraft - player.skillXp.spellcraft).toBe(revealedTileIds.length * 10)
    expect(cast.player.skillXp.wayfinding - player.skillXp.wayfinding).toBe(revealedTileIds.length * 10)
    const discovered = [...known, ...revealedTileIds].sort()
    expect(mireglassGlowRevealableTileIds(seed, player.position, discovered)).toEqual([])
    rejected(applyMireglassExpeditionAction(seed, cast.player, cast.region,
      { type: 'cast_wayfinder_glow' }, discovered), 'already_revealed', cast.player, cast.region)
  })

  it('earns both prerequisites from a fresh player and completes the outbound journey', () => {
    let player = createMireglassV6Player(seed)
    let region = createMireglassRegionProgress(seed)
    const knownCacheTiles = mireglassGlowRevealableTileIds(seed, anchors.sealCache.tile.center, [])
    const step = (position: Vec3 | null, action: MireglassExpeditionAction) => {
      if (position) player = at(player, position) // The streamed movement authority supplies this updated player.
      const priorPlayer = player
      const priorRegion = region
      const result = accepted(applyMireglassExpeditionAction(seed, player, region, action, knownCacheTiles))
      expect(player).toBe(priorPlayer)
      expect(region).toBe(priorRegion)
      player = result.player
      region = result.region
      return result
    }
    step(trees[0].tile.center, { type: 'equip_item', itemId: 'woodcutters_axe' })
    step(null, { type: 'chop_tree', resourceId: trees[0].id })
    step(anchors.salvager.tile.center, { type: 'buy_item', itemId: 'field_spade' })
    step(trees[0].tile.center, { type: 'equip_item', itemId: 'field_spade' })
    expect(step(null, { type: 'dig_tree_stump', resourceId: trees[0].id }).event)
      .toMatchObject({ itemId: 'stone', quantity: 1, xp: 30 })
    expect(player.skillXp.excavation).toBe(30)
    expect(step(anchors.fringeMarker.tile.center, { type: 'study_fringe_marker' }).event)
      .toMatchObject({ markerId: anchors.fringeMarker.id, spellId: 'wayfinder_glow', learned: true })
    expect(player.learnedSpellIds).toContain('wayfinder_glow')
    step(trees[1].tile.center, { type: 'equip_item', itemId: 'woodcutters_axe' })
    for (const tree of trees.filter(({ phase, id }) => phase === 'before_bridge' && id !== trees[0].id)) {
      expect(step(tree.tile.center, { type: 'chop_tree', resourceId: tree.id }).event)
        .toMatchObject({ itemId: 'logs', quantity: 4, xp: 20 })
    }
    expect(count(player, 'logs')).toBe(12)
    expect(step(bridge.from, { type: 'build_route', siteId: bridge.id }).event)
      .toMatchObject({ siteId: bridge.id, logCost: 8, xp: 80 })
    expect(count(player, 'logs')).toBe(4)
    expect(step(null, { type: 'traverse_route', siteId: bridge.id, from: 'from' }).player.position).toEqual(bridge.to)
    expect(step(null, { type: 'traverse_route', siteId: bridge.id, from: 'to' }).player.position).toEqual(bridge.from)
    for (const tree of trees.filter(({ phase }) => phase === 'after_bridge')) step(tree.tile.center, { type: 'chop_tree', resourceId: tree.id })
    expect(count(player, 'logs')).toBe(16)
    expect(step(ladder.from, { type: 'build_route', siteId: ladder.id }).event)
      .toMatchObject({ siteId: ladder.id, logCost: 4, xp: 60 })
    expect(step(null, { type: 'traverse_route', siteId: ladder.id, from: 'from' }).player.position).toEqual(ladder.to)
    expect(step(anchors.sealCache.tile.center, { type: 'cast_wayfinder_glow' }).event)
      .toMatchObject({ cacheId: anchors.sealCache.id, xp: 10 })
    rejected(applyMireglassExpeditionAction(seed, player, region,
      { type: 'cast_wayfinder_glow' }, knownCacheTiles), 'already_revealed', player, region)
    step(null, { type: 'equip_item', itemId: 'field_spade' })
    expect(step(null, { type: 'excavate_cache' }).event)
      .toMatchObject({ itemId: seal, quantity: 1, xp: 40 })
    expect(count(player, seal)).toBe(1)
    expect(step(ladder.to, { type: 'traverse_route', siteId: ladder.id, from: 'to' }).player.position).toEqual(ladder.from)
    expect(step(anchors.salvager.tile.center, { type: 'sell_item', itemId: seal, quantity: 1 }).event)
      .toMatchObject({ unitPrice: 80, totalPrice: 80 })
    expect(player.coins).toBe(182)
    expect(step(null, { type: 'buy_item', itemId: waders }).event)
      .toMatchObject({ price: 150, stockRemaining: 1 })
    expect(step(null, { type: 'equip_item', itemId: waders }).event)
      .toMatchObject({ slot: 'feet' })
    expect(player).toMatchObject({ coins: 32, xp: 340, level: 4,
      equipment: { mainHand: 'field_spade', feet: waders },
      skillXp: { woodcutting: 120, construction: 140, spellcraft: 10, wayfinding: 10, excavation: 70 } })
    expect(region).toMatchObject({ fringeMarkerStudied: true, dugStumpIds: [trees[0].id],
      cacheRevealed: true, cacheExcavated: true,
      builtRoutes: { bridge: bridge.id, ladder: ladder.id } })
    expect(count(player, 'logs')).toBe(12)
    expect(count(player, seal)).toBe(0)
    expect(count(player, waders)).toBe(1)
    expect(region.depletedResourceIds).toHaveLength(6)
    rejected(applyMireglassExpeditionAction(seed, player, region,
      { type: 'chop_tree', resourceId: trees[0].id }), 'depleted', player, region)
    rejected(applyMireglassExpeditionAction(seed, player, region,
      { type: 'excavate_cache' }), 'already_excavated', player, region)
    rejected(applyMireglassExpeditionAction(seed, player, region,
      { type: 'build_route', siteId: otherBridge.id }), 'already_built', player, region)
    rejected(applyMireglassExpeditionAction(seed, player, region,
      { type: 'dig_tree_stump', resourceId: trees[0].id }), 'already_dug', player, region)
    rejected(applyMireglassExpeditionAction(seed, player, region,
      { type: 'study_fringe_marker' }), 'already_studied', player, region)
  })

  it('derives reach only from player.position, ignoring a forged action position', () => {
    const player = createMireglassV6Player(seed)
    const region = createMireglassRegionProgress(seed)
    const forged = { type: 'chop_tree', resourceId: trees[0].id, position: trees[0].tile.center } as MireglassExpeditionAction
    rejected(applyMireglassExpeditionAction(seed, player, region, forged), 'too_far', player, region)
    const nearTree = at(player, trees[0].tile.center)
    rejected(applyMireglassExpeditionAction(seed, nearTree, region,
      { type: 'chop_tree', resourceId: trees[0].id }), 'requires_axe', nearTree, region)
    const armed = accepted(applyMireglassExpeditionAction(seed, nearTree, region,
      { type: 'equip_item', itemId: 'woodcutters_axe' }))
    const tooFar = at(armed.player, { ...trees[0].tile.center, x: trees[0].tile.center.x + 3.01 })
    rejected(applyMireglassExpeditionAction(seed, tooFar, region, forged), 'too_far', tooFar, region)
    const full = { ...armed.player, inventory: [...armed.player.inventory, { itemId: 'logs' as const, quantity: 16 }] }
    rejected(applyMireglassExpeditionAction(seed, full, region,
      { type: 'chop_tree', resourceId: trees[0].id }), 'capacity', full, region)
    const escrowed = { ...armed.player,
      inventory: [...armed.player.inventory, { itemId: 'logs' as const, quantity: 15 }],
      tradeSlots: [{ slotIndex: 0 as const, itemId: 'stone' as const, quantity: 1, unitPrice: 2 },
        ...armed.player.tradeSlots.slice(1)] as typeof armed.player.tradeSlots }
    rejected(applyMireglassExpeditionAction(seed, escrowed, region,
      { type: 'chop_tree', resourceId: trees[0].id }), 'capacity', escrowed, region)
    const chopped = accepted(applyMireglassExpeditionAction(seed, armed.player, region,
      { type: 'chop_tree', resourceId: trees[0].id }))
    expect(applyMireglassExpeditionAction(seed, armed.player, region,
      { type: 'chop_tree', resourceId: trees[0].id })).toEqual(chopped)
    rejected(applyMireglassExpeditionAction(seed, chopped.player, chopped.region,
      { type: 'chop_tree', resourceId: trees[0].id }), 'depleted', chopped.player, chopped.region)
  })

  it('accepts only a canonical built route, with exact material cost and endpoint reach', () => {
    const player = createMireglassV6Player(seed)
    const region = createMireglassRegionProgress(seed)
    const nearBridge = at(player, bridge.from)
    rejected(applyMireglassExpeditionAction(seed, nearBridge, region,
      { type: 'build_route', siteId: bridge.id }), 'not_owned', nearBridge, region)
    rejected(applyMireglassExpeditionAction(seed, nearBridge, region,
      { type: 'build_route', siteId: 'forged-site' }), 'not_found', nearBridge, region)
    rejected(applyMireglassExpeditionAction(seed, nearBridge, region,
      { type: 'traverse_route', siteId: bridge.id, from: 'from' }), 'not_built', nearBridge, region)
    const funded = { ...nearBridge, inventory: [...nearBridge.inventory, { itemId: 'logs' as const, quantity: 8 }] }
    const farBank = at(funded, bridge.to)
    rejected(applyMireglassExpeditionAction(seed, farBank, region,
      { type: 'build_route', siteId: bridge.id }), 'too_far', farBank, region)
    const built = accepted(applyMireglassExpeditionAction(seed, funded, region,
      { type: 'build_route', siteId: bridge.id }))
    expect(count(built.player, 'logs')).toBe(0)
    expect(built.player.skillXp.construction).toBe(80)
    const otherSite = at(built.player, otherBridge.from)
    rejected(applyMireglassExpeditionAction(seed, otherSite, built.region,
      { type: 'traverse_route', siteId: otherBridge.id, from: 'from' }), 'not_built', otherSite, built.region)
    const crossed = accepted(applyMireglassExpeditionAction(seed, built.player, built.region,
      { type: 'traverse_route', siteId: bridge.id, from: 'from' }))
    expect(crossed.player.position).toEqual(bridge.to)
    expect(crossed.player.verticalVelocity).toBe(0)
    expect(accepted(applyMireglassExpeditionAction(seed, crossed.player, crossed.region,
      { type: 'traverse_route', siteId: bridge.id, from: 'to' })).player.position).toEqual(bridge.from)
  })

  it('enforces cache prerequisites, shop prices and stock, plus invalid-state rejection', () => {
    const region = createMireglassRegionProgress(seed)
    const fresh = createMireglassV6Player(seed)
    const atCache = at(fresh, anchors.sealCache.tile.center)
    rejected(applyMireglassExpeditionAction(seed, atCache, region,
      { type: 'excavate_cache' }), 'site_hidden', atCache, region)
    const learned = createMireglassV6Player(seed, earnedPlayer())
    const farCache = at(learned, { ...anchors.sealCache.tile.center, x: anchors.sealCache.tile.center.x + 8.01 })
    const farTileId = worldTileAtGrid(seed, (anchors.sealCache.tile.center.x + 8) / 4,
      anchors.sealCache.tile.center.z / 4).id
    const fog = accepted(applyMireglassExpeditionAction(seed, farCache, region,
      { type: 'cast_wayfinder_glow' }, [farTileId]))
    expect(fog.event.type).toBe('terrain_revealed')
    if (fog.event.type !== 'terrain_revealed') throw new Error('Expected terrain discovery.')
    expect(fog.region.cacheRevealed).toBe(false)
    const revealed = accepted(applyMireglassExpeditionAction(seed,
      at(fog.player, anchors.sealCache.tile.center), fog.region,
      { type: 'cast_wayfinder_glow' }, [farTileId, ...fog.event.revealedTileIds, anchors.sealCache.tile.id]))
    rejected(applyMireglassExpeditionAction(seed, revealed.player, revealed.region,
      { type: 'excavate_cache' }), 'requires_spade', revealed.player, revealed.region)
    const withSpade = accepted(applyMireglassExpeditionAction(seed, at(revealed.player, anchors.salvager.tile.center), revealed.region,
      { type: 'buy_item', itemId: 'field_spade' }))
    const equipped = accepted(applyMireglassExpeditionAction(seed, at(withSpade.player, anchors.sealCache.tile.center), withSpade.region,
      { type: 'equip_item', itemId: 'field_spade' }))
    const novice = { ...equipped.player, skillXp: { ...equipped.player.skillXp, excavation: 29 } }
    rejected(applyMireglassExpeditionAction(seed, novice, equipped.region,
      { type: 'excavate_cache' }), 'skill_locked', novice, equipped.region)
    const full = { ...equipped.player, inventory: [...equipped.player.inventory, { itemId: 'logs' as const, quantity: 18 }] }
    rejected(applyMireglassExpeditionAction(seed, full, equipped.region,
      { type: 'excavate_cache' }), 'capacity', full, equipped.region)
    const atOutpost = at(fresh, anchors.salvager.tile.center)
    rejected(applyMireglassExpeditionAction(seed, atOutpost, region,
      { type: 'buy_item', itemId: waders }), 'insufficient_coins', atOutpost, region)
    rejected(applyMireglassExpeditionAction(seed, atOutpost, region,
      { type: 'sell_item', itemId: 'logs', quantity: 0 }), 'invalid_value', atOutpost, region)
    rejected(applyMireglassExpeditionAction(seed, atOutpost, region,
      { type: 'sell_item', itemId: 'logs', quantity: 1 }), 'not_owned', atOutpost, region)
    let stockedPlayer = atOutpost
    let stockedRegion = region
    for (let i = 0; i < MIREGLASS_OUTPOST_CATALOG.field_spade.stock; i += 1) {
      const bought = accepted(applyMireglassExpeditionAction(seed, stockedPlayer, stockedRegion,
        { type: 'buy_item', itemId: 'field_spade' }))
      stockedPlayer = bought.player
      stockedRegion = bought.region
    }
    expect(stockedRegion.shopStock.field_spade).toBe(0)
    rejected(applyMireglassExpeditionAction(seed, stockedPlayer, stockedRegion,
      { type: 'buy_item', itemId: 'field_spade' }), 'out_of_stock', stockedPlayer, stockedRegion)
    rejected(applyMireglassExpeditionAction('another-seed', atOutpost, region,
      { type: 'buy_item', itemId: 'field_spade' }), 'seed_mismatch', atOutpost, region)
    const invalidPlayer = { ...atOutpost, coins: -1 }
    rejected(applyMireglassExpeditionAction(seed, invalidPlayer, region,
      { type: 'buy_item', itemId: 'field_spade' }), 'invalid_progress', invalidPlayer, region)
    expect(createMireglassRegionProgress('')).toEqual(createMireglassRegionProgress('wizard-realms'))
  })

  it('rejects unearned marker and stump actions, full packs, and XP overflow', () => {
    const region = createMireglassRegionProgress(seed)
    const fresh = createMireglassV6Player(seed)
    rejected(applyMireglassExpeditionAction(seed, fresh, region,
      { type: 'study_fringe_marker' }), 'too_far', fresh, region)
    const markerPlayer = at(fresh, anchors.fringeMarker.tile.center)
    const studied = accepted(applyMireglassExpeditionAction(seed, markerPlayer, region,
      { type: 'study_fringe_marker' }))
    expect(studied.player.learnedSpellIds).toEqual(['wayfinder_glow'])
    expect(fresh.learnedSpellIds).toEqual([])
    rejected(applyMireglassExpeditionAction(seed, studied.player, studied.region,
      { type: 'study_fringe_marker' }), 'already_studied', studied.player, studied.region)
    const imported = createMireglassV6Player(seed, earnedPlayer())
    expect(accepted(applyMireglassExpeditionAction(seed, at(imported, anchors.fringeMarker.tile.center), region,
      { type: 'study_fringe_marker' })).event).toMatchObject({ learned: false })

    const tree = trees[0]
    const nearTree = at(fresh, tree.tile.center)
    rejected(applyMireglassExpeditionAction(seed, nearTree, region,
      { type: 'dig_tree_stump', resourceId: 'forged-tree' }), 'not_found', nearTree, region)
    rejected(applyMireglassExpeditionAction(seed, nearTree, region,
      { type: 'dig_tree_stump', resourceId: tree.id }), 'not_depleted', nearTree, region)
    const armed = accepted(applyMireglassExpeditionAction(seed, nearTree, region,
      { type: 'equip_item', itemId: 'woodcutters_axe' }))
    const chopped = accepted(applyMireglassExpeditionAction(seed, armed.player, region,
      { type: 'chop_tree', resourceId: tree.id }))
    rejected(applyMireglassExpeditionAction(seed, chopped.player, chopped.region,
      { type: 'dig_tree_stump', resourceId: tree.id }), 'requires_spade', chopped.player, chopped.region)
    const bought = accepted(applyMireglassExpeditionAction(seed, at(chopped.player, anchors.salvager.tile.center), chopped.region,
      { type: 'buy_item', itemId: 'field_spade' }))
    const spade = accepted(applyMireglassExpeditionAction(seed, at(bought.player, tree.tile.center), bought.region,
      { type: 'equip_item', itemId: 'field_spade' }))
    const tooFar = at(spade.player, { ...tree.tile.center, x: tree.tile.center.x + 3.01 })
    rejected(applyMireglassExpeditionAction(seed, tooFar, spade.region,
      { type: 'dig_tree_stump', resourceId: tree.id }), 'too_far', tooFar, spade.region)
    const full = { ...spade.player, inventory: [...spade.player.inventory, { itemId: 'logs' as const, quantity: 14 }] }
    rejected(applyMireglassExpeditionAction(seed, full, spade.region,
      { type: 'dig_tree_stump', resourceId: tree.id }), 'capacity', full, spade.region)
    const maxXp = { ...spade.player, xp: Number.MAX_SAFE_INTEGER,
      level: 1 + Math.floor(Number.MAX_SAFE_INTEGER / 100) }
    expect(isValidMireglassV6Player(maxXp)).toBe(true)
    rejected(applyMireglassExpeditionAction(seed, maxXp, spade.region,
      { type: 'dig_tree_stump', resourceId: tree.id }), 'invalid_value', maxXp, spade.region)
  })

  it('validates canonical region IDs and complete v6 player records for persistence', () => {
    const region = createMireglassRegionProgress(seed)
    const player = createMireglassV6Player(seed)
    expect(isValidMireglassRegionProgress(region, seed)).toBe(true)
    expect(isValidMireglassRegionProgress(region, 'other-seed')).toBe(false)
    expect(isValidMireglassRegionProgress({ ...region, depletedResourceIds: ['forged-tree'] })).toBe(false)
    expect(isValidMireglassRegionProgress({ ...region, depletedResourceIds: [trees[0].id, trees[0].id] })).toBe(false)
    expect(isValidMireglassRegionProgress({ ...region, dugStumpIds: [trees[0].id] })).toBe(false)
    expect(isValidMireglassRegionProgress({ ...region, depletedResourceIds: [trees[0].id],
      dugStumpIds: [trees[0].id] })).toBe(true)
    expect(isValidMireglassRegionProgress({ ...region, depletedResourceIds: [trees[0].id],
      dugStumpIds: [trees[0].id, trees[0].id] })).toBe(false)
    expect(isValidMireglassRegionProgress({ ...region, builtRoutes: { bridge: ladder.id, ladder: null } })).toBe(false)
    expect(isValidMireglassRegionProgress({ ...region, builtRoutes: { bridge: bridge.id, ladder: ladder.id } })).toBe(true)
    expect(isValidMireglassV6Player({})).toBe(false)
    expect(isValidMireglassV6Player({ ...player, equipment: { ...player.equipment,
      head: 'mireglass_reach/item/waders' } })).toBe(false)
    expect(isValidMireglassV6Player({ ...player, learnedSpellIds: ['wayfinder_glow', 'wayfinder_glow'] })).toBe(false)
    expect(isValidMireglassV6Player({ ...player, discoveredRingIds: [MIREGLASS_RING_ID] })).toBe(true)
    expect(isValidMireglassV6Player({ ...player, discoveredRingIds: [MIREGLASS_RING_ID, MIREGLASS_RING_ID] })).toBe(false)
    expect(isValidMireglassV6Player({ ...player, discoveredRingIds: ['forged-ring'] })).toBe(false)
    expect(isValidMireglassV6Player({ ...player, inventory: [{ itemId: 'forged-item', quantity: 1 }] })).toBe(false)
  })
})
