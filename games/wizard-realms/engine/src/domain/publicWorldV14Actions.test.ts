import { describe, expect, it } from 'vitest'
import { advancePublicV14GreenwayAction } from './publicWorldV14Actions'
import { advancePublicV14GreenwayFrame } from './publicWorldV14GreenwayFrame'
import { discoveryMaskHasTileId } from './discoveryMask'
import { nearbyWorldTileIds, PUBLIC_SPELL_REVEAL_RADIUS_METERS,
  PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { PUBLIC_V11_BOOTS_LISTING_ID, PUBLIC_V11_BOOTS_PRICE,
  publicV11Gait } from './publicWorldGait'
import { encodePublicV14Head } from './publicWorldV14Snapshot'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { createFreshPublicV14Head } from './publicWorldV14Snapshot'
import { validatePublicV14State } from './publicWorldV14Validation'
import { starterCliffSupportAt } from './starterCliffMovement'
import { STARTER_CLIFF_SITE_ID, starterCliffCanonicalSite } from './starterCliffProfile'

const seed = 'greenway-alpha'
const fresh = () => createFreshPublicV14Head(seed)
const standing = (state: PublicV14State, x: number, z: number): PublicV14State => {
  const floor = starterCliffSupportAt({ seed, profile: state.generationProfile,
    route: state.greenway.routes[0],
    built: state.greenway.builtRouteIds.includes('greenway_ladder') }, { x, z })?.floorY
  if (floor === undefined) throw new Error('No ground at test pose')
  return { ...state, player: { ...state.player,
    position: { x, y: floor, z }, verticalVelocity: 0 } }
}
const byTree = (state: PublicV14State, id = 'greenway-journey-tree-0') => {
  const tree = state.greenway.resources.find((entry) => entry.id === id)
  if (!tree) throw new Error(`Missing ${id}`)
  return standing(state, tree.position.x, tree.position.z)
}
const action = (state: PublicV14State, intent: Parameters<typeof advancePublicV14GreenwayAction>[1]) =>
  advancePublicV14GreenwayAction(state, intent)
const equip = { type: 'equip_item' as const, itemId: 'woodcutters_axe' as const,
  slot: 'mainHand' as const }
const chop = (resourceId = 'greenway-journey-tree-0') =>
  ({ type: 'harvest' as const, resourceId })
const build = (siteId: string = STARTER_CLIFF_SITE_ID) =>
  ({ type: 'build_route' as const, routeId: 'greenway_ladder' as const, siteId })
const boots = { type: 'buy_store_listing' as const, storeId: 'store-greenway',
  listingId: PUBLIC_V11_BOOTS_LISTING_ID }
const wearBoots = { type: 'equip_item' as const, itemId: 'leather_boots' as const,
  slot: 'feet' as const }
const removeBoots = { type: 'unequip_item' as const, slot: 'feet' as const }
const spade = { type: 'buy_store_listing' as const, storeId: 'store-greenway',
  listingId: 'spade' }
const equipSpade = { type: 'equip_item' as const, itemId: 'field_spade' as const,
  slot: 'mainHand' as const }
const sellStone = (quantity: number) => ({ type: 'sell_to_store' as const,
  storeId: 'store-greenway', itemId: 'stone' as const, quantity })
const atOutfitters = (state: PublicV14State) => {
  const store = state.greenway.stores.find((entry) => entry.id === 'store-greenway')!
  return standing(state, store.position.x, store.position.z)
}

describe('pure v14 starter-cliff actions', () => {
  it('keeps legacy magic closed and admits only the v16 canonical waystone study', () => {
    const base = fresh().head.state
    const study = { type: 'study_inscription' as const,
      inscriptionId: 'greenway_waystone' as const }
    expect(action(base, study).rejections[0]?.code).toBe('unavailable_here')
    expect(action(base, { type: 'cast_spell', spellId: 'wayfinder_glow' })
      .rejections[0]?.code).toBe('unavailable_here')
    expect(advancePublicV14GreenwayAction(base, study, true).rejections[0]?.code).toBe('too_far')
    const near = standing(base, 3, 3)
    const before = structuredClone(near)
    expect(advancePublicV14GreenwayAction(near,
      { type: 'study_inscription', inscriptionId: 'unknown' as never }, true)
      .rejections[0]?.code).toBe('not_found')
    const studied = advancePublicV14GreenwayAction(near, study, true)
    expect(studied.rejections).toEqual([])
    expect(studied.events).toMatchObject([{ type: 'inscription_studied',
      inscriptionId: 'greenway_waystone', spellId: 'wayfinder_glow',
      tick: 1, sequence: 1 }])
    expect(studied.state.greenway.studiedInscriptionIds).toEqual(['greenway_waystone'])
    expect(studied.state.player.learnedSpellIds).toEqual(['wayfinder_glow'])
    expect(validatePublicV14State(studied.state, seed)).not.toBeNull()
    expect(near).toEqual(before)
    expect(advancePublicV14GreenwayAction(studied.state, study, true))
      .toMatchObject({ state: studied.state, events: [],
        rejections: [{ code: 'already_studied' }] })
  })

  it('casts a 24 m canonical discovery circle and awards skill XP only for new tiles', () => {
    const near = standing(fresh().head.state, 3, 3)
    const cast = { type: 'cast_spell' as const, spellId: 'wayfinder_glow' as const }
    expect(advancePublicV14GreenwayAction(near, cast, true)
      .rejections[0]?.code).toBe('unlearned_spell')
    const studied = advancePublicV14GreenwayAction(near,
      { type: 'study_inscription', inscriptionId: 'greenway_waystone' }, true).state
    const expected = nearbyWorldTileIds(studied.player.position,
      PUBLIC_SPELL_REVEAL_RADIUS_METERS)
      .filter((id) => !discoveryMaskHasTileId(studied.discoveryMask, id))
    const walking = new Set(nearbyWorldTileIds(studied.player.position,
      PUBLIC_WALK_REVEAL_RADIUS_METERS))
    expect(expected.some((id) => !walking.has(id))).toBe(true)
    const revealed = advancePublicV14GreenwayAction(studied, cast, true)
    expect(revealed.rejections).toEqual([])
    expect(revealed.events[0]).toMatchObject({ type: 'spell_cast',
      spellId: 'wayfinder_glow', revealedTileIds: expected, revealedDigSiteIds: [] })
    expect(revealed.events.map((event) => event.type)).toEqual([
      'spell_cast', ...expected.map(() => 'tile_discovered'),
      'skill_xp_gained', 'skill_xp_gained',
    ])
    expect(revealed.events.map((event) => event.sequence))
      .toEqual(revealed.events.map((_, index) => studied.eventSequence + index + 1))
    expect(revealed.events.every((event) => event.tick === studied.tick + 1)).toBe(true)
    expect(revealed.state.player.skillXp.spellcraft).toBe(expected.length * 10)
    expect(revealed.state.player.skillXp.wayfinding).toBe(expected.length * 10)
    expect(revealed.state.player.xp).toBe(studied.player.xp)
    expect(revealed.state.eventSequence).toBe(studied.eventSequence + revealed.events.length)
    expect(expected.every((id) => discoveryMaskHasTileId(revealed.state.discoveryMask, id))).toBe(true)
    expect(validatePublicV14State(revealed.state, seed)).not.toBeNull()
    const repeated = advancePublicV14GreenwayAction(revealed.state, cast, true)
    expect(repeated.rejections).toEqual([])
    expect(repeated.events).toMatchObject([{ type: 'spell_cast',
      revealedTileIds: [], revealedDigSiteIds: [] }])
    expect(repeated.events).toHaveLength(1)
    expect(repeated.state.player.skillXp).toEqual(revealed.state.player.skillXp)
    expect(validatePublicV14State(repeated.state, seed)).not.toBeNull()
  })

  it('buys one canonical 18g field spade with stock debit and equips it in mainHand', () => {
    const base = atOutfitters(fresh().head.state)
    const before = structuredClone(base)
    const bought = action(base, spade)
    expect(bought.rejections).toEqual([])
    expect(bought.events).toMatchObject([{ type: 'store_item_bought',
      storeId: 'store-greenway', listingId: 'spade', itemId: 'field_spade',
      price: 18, tick: 1, sequence: 1 }])
    expect(bought.state.player.coins).toBe(102)
    expect(bought.state.player.inventory).toContainEqual({ itemId: 'field_spade', quantity: 1 })
    expect(bought.state.greenway.stores[0].listings.find((listing) => listing.id === 'spade')?.stock).toBe(2)
    expect(bought.state.tick).toBe(1)
    expect(validatePublicV14State(bought.state, seed)).not.toBeNull()
    expect(base).toEqual(before)
    const worn = action(bought.state, equipSpade)
    expect(worn.rejections).toEqual([])
    expect(worn.events).toMatchObject([{ type: 'item_equipped', itemId: 'field_spade',
      slot: 'mainHand', tick: 2, sequence: 2 }])
    expect(worn.state.player.equipment.mainHand).toBe('field_spade')
    expect(validatePublicV14State(worn.state, seed)).not.toBeNull()
  })

  it('rejects forged, distant, depleted, unaffordable, full and duplicate spade purchases atomically', () => {
    const near = atOutfitters(fresh().head.state)
    const emptyStock: PublicV14State = { ...near, greenway: { ...near.greenway,
      stores: [{ ...near.greenway.stores[0], listings: near.greenway.stores[0].listings.map((listing) =>
        listing.id === 'spade' ? { ...listing, stock: 0 } : listing) }, near.greenway.stores[1]] } }
    const cases = [
      { state: fresh().head.state, intent: spade, code: 'too_far' },
      { state: near, intent: { ...spade, storeId: 'store-highland' }, code: 'not_found' },
      { state: near, intent: { ...spade, listingId: 'hat' }, code: 'unavailable_here' },
      { state: emptyStock, intent: spade, code: 'out_of_stock' },
      { state: { ...near, player: { ...near.player, coins: 17 } }, intent: spade,
        code: 'insufficient_coins' },
      { state: { ...near, player: { ...near.player, backpackCapacity: 1 } }, intent: spade,
        code: 'capacity' },
    ]
    for (const { state, intent, code } of cases) {
      const before = structuredClone(state)
      const denied = action(state, intent)
      expect(denied.state).toBe(state)
      expect(denied.events).toEqual([])
      expect(denied.rejections[0]?.code).toBe(code)
      expect(state).toEqual(before)
    }
    const bought = action(near, spade).state
    const duplicate = action(bought, spade)
    expect(duplicate.state).toBe(bought)
    expect(duplicate.rejections[0]?.code).toBe('not_owned')
    expect(action(near, equipSpade).rejections[0]?.code).toBe('not_owned')
    const worn = action(bought, equipSpade).state
    expect(action(worn, equipSpade)).toMatchObject({ state: worn, events: [],
      rejections: [{ code: 'not_owned' }] })
  })

  it('sells carried dig stone at Greenway’s existing 1g bid and rejects invalid sales atomically', () => {
    const near = atOutfitters(fresh().head.state)
    const returned: PublicV14State = { ...near, player: { ...near.player,
      inventory: [...near.player.inventory, { itemId: 'stone', quantity: 3 }] } }
    expect(validatePublicV14State(returned, seed)).not.toBeNull()
    const before = structuredClone(returned)
    const sold = action(returned, sellStone(2))
    expect(sold.rejections).toEqual([])
    expect(sold.events).toMatchObject([{ type: 'store_item_sold',
      storeId: 'store-greenway', itemId: 'stone', quantity: 2,
      unitPrice: 1, totalPrice: 2, tick: 1, sequence: 1 }])
    expect(sold.state.player.coins).toBe(122)
    expect(sold.state.player.inventory).toContainEqual({ itemId: 'stone', quantity: 1 })
    expect(validatePublicV14State(sold.state, seed)).not.toBeNull()
    expect(returned).toEqual(before)
    const cases = [
      { state: returned, intent: sellStone(0), code: 'invalid_value' },
      { state: returned, intent: sellStone(0.5), code: 'invalid_value' },
      { state: returned, intent: sellStone(4), code: 'not_owned' },
      { state: near, intent: sellStone(1), code: 'not_owned' },
      { state: returned, intent: { ...sellStone(1), storeId: 'store-highland' }, code: 'not_found' },
      { state: { ...returned, player: { ...returned.player,
        position: fresh().head.state.player.position } }, intent: sellStone(1), code: 'too_far' },
      { state: { ...returned, player: { ...returned.player,
        coins: Number.MAX_SAFE_INTEGER } }, intent: sellStone(1), code: 'invalid_value' },
    ]
    for (const { state, intent, code } of cases) {
      const snapshot = structuredClone(state)
      const denied = action(state, intent)
      expect(denied.state).toBe(state)
      expect(denied.events).toEqual([])
      expect(denied.rejections[0]?.code).toBe(code)
      expect(state).toEqual(snapshot)
    }
  })

  it('buys the virtual Outfitters boots for exactly 25 coins, then runs by default only when worn', () => {
    const base = atOutfitters(fresh().head.state)
    expect(publicV11Gait(base.player.equipment.feet, false))
      .toMatchObject({ canRun: false, pace: 'walk', metersPerStep: 0.16 })
    const barefootRun = advancePublicV14GreenwayFrame(base,
      [{ type: 'move', delta: { x: 0.24, z: 0 } }], { walkRequested: false })
    expect(barefootRun.rejections[0]?.code).toBe('invalid_value')
    const purchased = action(base, boots)
    expect(purchased.rejections).toEqual([])
    expect(purchased.state.player.coins).toBe(base.player.coins - PUBLIC_V11_BOOTS_PRICE)
    expect(purchased.state.player.inventory.find((entry) => entry.itemId === 'leather_boots'))
      .toMatchObject({ quantity: 1 })
    expect(purchased.events).toMatchObject([{ type: 'store_item_bought',
      storeId: 'store-greenway', listingId: PUBLIC_V11_BOOTS_LISTING_ID,
      itemId: 'leather_boots', price: PUBLIC_V11_BOOTS_PRICE, tick: 1, sequence: 1 }])
    expect(purchased.state.tick).toBe(1)
    expect(validatePublicV14State(purchased.state, seed)).not.toBeNull()
    const equipped = action(purchased.state, wearBoots)
    expect(equipped.rejections).toEqual([])
    expect(equipped.state.player.equipment.feet).toBe('leather_boots')
    expect(publicV11Gait(equipped.state.player.equipment.feet, false))
      .toMatchObject({ canRun: true, pace: 'run', metersPerStep: 0.24 })
    expect(publicV11Gait(equipped.state.player.equipment.feet, true))
      .toMatchObject({ canRun: true, pace: 'walk', metersPerStep: 0.16 })
    expect(advancePublicV14GreenwayFrame(equipped.state,
      [{ type: 'move', delta: { x: 0.24, z: 0 } }], { walkRequested: false }).rejections).toEqual([])
    expect(advancePublicV14GreenwayFrame(equipped.state,
      [{ type: 'move', delta: { x: 0.24, z: 0 } }], { walkRequested: true })
      .rejections[0]?.code).toBe('invalid_value')
    expect(advancePublicV14GreenwayFrame(equipped.state,
      [{ type: 'move', delta: { x: 0.16, z: 0 } }], { walkRequested: true }).rejections).toEqual([])
    expect(validatePublicV14State(equipped.state, seed)).not.toBeNull()
    expect(encodePublicV14Head(equipped.state, 1, fresh().lineage).state).toEqual(equipped.state)
    const barefoot = action(equipped.state, removeBoots)
    expect(barefoot.rejections).toEqual([])
    expect(barefoot.events).toMatchObject([{ type: 'item_unequipped',
      itemId: 'leather_boots', slot: 'feet' }])
    expect(publicV11Gait(barefoot.state.player.equipment.feet, false).canRun).toBe(false)
  })

  it('rejects distant, unaffordable, full-pack, duplicate and wrong-listing purchases atomically', () => {
    const base = fresh().head.state
    const near = atOutfitters(base)
    const cases = [
      { state: base, intent: boots, message: 'Move closer to Greenway Outfitters.' },
      { state: { ...near, player: { ...near.player, coins: 24 } },
        intent: boots, message: 'Not enough coins for leather boots.' },
      { state: { ...near, player: { ...near.player, backpackCapacity: 1 } },
        intent: boots, message: 'The backpack is full.' },
      { state: near, intent: { ...boots, storeId: 'store-highland' },
        message: 'Leather boots are sold only at Greenway Outfitters.' },
      { state: near, intent: { ...boots, listingId: 'hat' },
        message: 'Only the virtual leather boots offer is available here.' },
    ]
    for (const { state, intent, message } of cases) {
      const before = structuredClone(state)
      const denied = action(state, intent)
      expect(denied.state).toBe(state)
      expect(denied.events).toEqual([])
      expect(denied.rejections[0]?.message).toBe(message)
      expect(state).toEqual(before)
    }
    const purchased = action(near, boots).state
    const duplicate = action(purchased, boots)
    expect(duplicate.state).toBe(purchased)
    expect(duplicate.events).toEqual([])
    expect(duplicate.rejections[0]?.message).toBe('You already own leather boots.')
    const notOwned = action(near, wearBoots)
    expect(notOwned.state).toBe(near)
    expect(notOwned.events).toEqual([])
    expect(notOwned.rejections[0]?.code).toBe('not_owned')
    const equipped = action(purchased, wearBoots).state
    const noOp = action(equipped, wearBoots)
    expect(noOp.state).toBe(equipped)
    expect(noOp.events).toEqual([])
    const removed = action(equipped, removeBoots).state
    const twice = action(removed, removeBoots)
    expect(twice.state).toBe(removed)
    expect(twice.events).toEqual([])
  })

  it('rejects equipping the sole axe twice without advancing the world', () => {
    const first = action(fresh().head.state, equip)
    expect(first.rejections).toEqual([])
    const before = structuredClone(first.state)
    const repeated = action(first.state, equip)
    expect(repeated.state).toBe(first.state)
    expect(repeated.events).toEqual([])
    expect(repeated.rejections).toMatchObject([{ intentIndex: 0,
      intentType: 'equip_item', code: 'not_owned' }])
    expect(first.state).toEqual(before)
  })

  it('requires the backpack axe to be equipped and harvests a tree into four logs', () => {
    let state = byTree(fresh().head.state)
    const before = structuredClone(state)
    const denied = action(state, chop())
    expect(denied.state).toBe(state)
    expect(denied.events).toEqual([])
    expect(denied.rejections[0]?.code).toBe('requires_axe')
    expect(state).toEqual(before)
    const equipped = action(state, equip)
    const idle = advancePublicV14GreenwayFrame(state, [], { walkRequested: false })
    expect(equipped.rejections).toEqual([])
    expect(equipped.events.map((event) => event.type)).toEqual(['item_equipped'])
    expect(equipped.events[0]).toMatchObject({ tick: 1, sequence: 1 })
    expect(equipped.state.tick).toBe(1)
    expect(equipped.state.rng).toEqual(idle.state.rng)
    state = equipped.state
    const first = action(state, chop())
    expect(first.events.map((event) => event.type)).toEqual(['resource_damaged'])
    expect(first.state.greenway.resources.find((entry) => entry.id === chop().resourceId)?.health).toBe(1)
    state = first.state
    const second = action(state, chop())
    expect(second.rejections).toEqual([])
    expect(second.events.map((event) => event.type))
      .toEqual(['resource_harvested', 'skill_xp_gained'])
    expect(second.state.player.inventory.find((stack) => stack.itemId === 'logs')?.quantity).toBe(4)
    expect(second.state.player.skillXp.woodcutting).toBe(20)
    expect(second.state.player.xp).toBe(20)
    expect(second.state.greenway.resources.find((entry) => entry.id === chop().resourceId))
      .toMatchObject({ health: 0, depleted: true })
    expect(second.state.tick).toBe(3)
    expect(second.state.eventSequence).toBe(4)
    expect(validatePublicV14State(second.state, seed)).not.toBeNull()
    expect(encodePublicV14Head(second.state, 1, fresh().lineage).state).toEqual(second.state)
  })

  it('spends exactly four logs only at the canonical site, then permits ordinary ladder movement', () => {
    let state = byTree(fresh().head.state)
    state = action(state, equip).state
    state = action(state, chop()).state
    state = action(state, chop()).state
    const site = starterCliffCanonicalSite(seed)
    state = standing(state, site.from.x, site.from.z)
    const before = structuredClone(state)
    const placed = action(state, build())
    expect(placed.rejections).toEqual([])
    expect(state).toEqual(before)
    expect(placed.events.map((event) => event.type))
      .toEqual(['route_built', 'skill_xp_gained'])
    expect(placed.state.greenway.routes.find((route) => route.id === 'greenway_ladder'))
      .toMatchObject({ siteId: STARTER_CLIFF_SITE_ID, from: site.from, to: site.to })
    expect(placed.state.greenway.builtRouteIds).toContain('greenway_ladder')
    expect(placed.state.player.inventory.find((stack) => stack.itemId === 'logs')).toBeUndefined()
    expect(placed.state.player.skillXp.construction).toBe(60)
    expect(validatePublicV14State(placed.state, seed)).not.toBeNull()
    state = standing(placed.state, 0, -5.3)
    const climbed = advancePublicV14GreenwayFrame(state,
      [{ type: 'move', delta: { x: 0, z: -0.1 } }], { walkRequested: true })
    expect(climbed.rejections).toEqual([])
    expect(climbed.state.player.position.y).toBeGreaterThan(state.player.position.y)
  })

  it('unlocks the highland bridge at level two without granting a teleport', () => {
    let state = action(byTree(fresh().head.state), equip).state
    for (const treeId of ['greenway-journey-tree-0', 'greenway-journey-tree-1']) {
      state = byTree(state, treeId)
      state = action(state, chop(treeId)).state
      state = action(state, chop(treeId)).state
    }
    const site = starterCliffCanonicalSite(seed)
    const result = action(standing(state, site.from.x, site.from.z), build())
    expect(result.events.map((event) => event.type))
      .toEqual(['route_built', 'skill_xp_gained', 'recipe_unlocked'])
    expect(result.state.player.level).toBe(2)
    expect(result.state.greenway.unlockedRecipeIds).toContain('highland_bridge')
    expect(validatePublicV14State(result.state, seed)).not.toBeNull()
    const instant = action(result.state,
      { type: 'traverse_route', routeId: 'greenway_ladder' })
    expect(instant.state).toBe(result.state)
    expect(instant.events).toEqual([])
    expect(instant.rejections[0]?.code).toBe('unavailable_here')
  })

  it('rejects phantom sites, insufficient logs, distant interactions and depleted trees atomically', () => {
    const base = fresh().head.state
    const nearSite = standing(base, 0, -4)
    const cases = [
      { state: nearSite, intent: build('greenway_ladder:x:2'), code: 'not_found' },
      { state: nearSite, intent: build(), code: 'not_owned' },
      { state: base, intent: chop(), code: 'too_far' },
      { state: base, intent: { type: 'traverse_route' as const,
        routeId: 'greenway_ladder' as const }, code: 'unavailable_here' },
    ]
    for (const { state, intent, code } of cases) {
      const before = structuredClone(state)
      const result = action(state, intent)
      expect(result.state).toBe(state)
      expect(result.events).toEqual([])
      expect(result.rejections[0]?.code).toBe(code)
      expect(state).toEqual(before)
    }
    let state = action(byTree(base), equip).state
    state = action(state, chop()).state
    state = action(state, chop()).state
    const depleted = action(state, chop())
    expect(depleted.state).toBe(state)
    expect(depleted.rejections[0]?.code).toBe('depleted')
  })
})
