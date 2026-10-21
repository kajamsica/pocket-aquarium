import { discoveryMaskHasTileId, encodeDiscoveredTileIds } from './discoveryMask'
import { backpackSlotsAfterAdd } from './backpackSlots'
import { publicBootPurchaseCandidate } from './publicBootPurchase'
import { nearbyWorldTileIds, PUBLIC_SPELL_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { advancePublicV14GreenwayFrame } from './publicWorldV14GreenwayFrame'
import type { PublicV14GreenwayFrameResult } from './publicWorldV14GreenwayFrame'
import { PUBLIC_V11_BOOTS_LISTING_ID, PUBLIC_V11_BOOTS_PRICE } from './publicWorldGait'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './publicWorldRuntime'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { starterCliffPoseValid } from './starterCliffMovement'
import { STARTER_CLIFF_PROFILE, STARTER_CLIFF_SITE_ID,
  starterCliffCanonicalSite } from './starterCliffProfile'
import type { Vec3 } from './types'
import { storeSellUnitPrice } from './world'

const INTERACT_DISTANCE = 3
const TREE_YIELD = 4
const TREE_XP = 20
const LADDER_COST = 4
const LADDER_XP = 60

type ActionBody =
  | { type: 'item_equipped'; itemId: 'woodcutters_axe' | 'field_spade'; slot: 'mainHand' }
  | { type: 'item_equipped' | 'item_unequipped'; itemId: 'leather_boots'; slot: 'feet' }
  | { type: 'store_item_bought'; storeId: string; listingId: typeof PUBLIC_V11_BOOTS_LISTING_ID;
      itemId: 'leather_boots'; price: number }
  | { type: 'store_item_bought'; storeId: string; listingId: 'spade';
      itemId: 'field_spade'; price: number }
  | { type: 'store_item_sold'; storeId: string; itemId: 'stone'; quantity: number;
      unitPrice: number; totalPrice: number }
  | { type: 'resource_damaged'; resourceId: string; health: number }
  | { type: 'resource_harvested'; resourceId: string; itemId: 'logs'; quantity: number; xp: number }
  | { type: 'route_built'; routeId: 'greenway_ladder'; siteId: typeof STARTER_CLIFF_SITE_ID;
      logCost: number; xp: number }
  | { type: 'skill_xp_gained'; skillId: 'woodcutting' | 'construction' | 'spellcraft' | 'wayfinding'; xp: number }
  | { type: 'recipe_unlocked'; recipeId: 'highland_bridge' }
  | { type: 'inscription_studied'; inscriptionId: 'greenway_waystone'; spellId: 'wayfinder_glow' }
  | { type: 'spell_cast'; spellId: 'wayfinder_glow'; revealedTileIds: string[];
      revealedDigSiteIds: [] }
  | { type: 'tile_discovered'; tileId: string }

function reject(state: PublicV14State, intent: PublicWorldIntent,
  code: PublicWorldRejection['code'], message: string): PublicV14GreenwayFrameResult {
  return { state, events: [], rejections: [{ intentIndex: 0, intentType: intent.type,
    code, message }] }
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const owned = (inventory: readonly { itemId: string; quantity: number }[], itemId: string) =>
  inventory.filter((stack) => stack.itemId === itemId)
    .reduce((count, stack) => count + stack.quantity, 0)
const levelForXp = (xp: number) => 1 + Math.floor(xp / 100)

/** Finish the action with the same 50 ms clock, RNG, gravity and market step as movement. */
function finish(before: PublicV14State, candidate: PublicV14State,
  intent: PublicWorldIntent, bodies: ActionBody[]): PublicV14GreenwayFrameResult {
  const unlock = candidate.greenway.builtRouteIds.includes('greenway_ladder')
    && candidate.player.level >= 2
    && !candidate.greenway.unlockedRecipeIds.includes('highland_bridge')
  if (unlock) {
    candidate = { ...candidate, greenway: { ...candidate.greenway,
      unlockedRecipeIds: [...candidate.greenway.unlockedRecipeIds, 'highland_bridge' as const].sort() } }
    bodies.push({ type: 'recipe_unlocked', recipeId: 'highland_bridge' })
  }
  if (!Number.isSafeInteger(before.tick + 1)
    || !Number.isSafeInteger(before.eventSequence + bodies.length)) {
    return reject(before, intent, 'invalid_value', 'The world clock is exhausted.')
  }
  const events = bodies.map((body, index) => ({ ...body, tick: before.tick + 1,
    sequence: before.eventSequence + index + 1 })) as PublicWorldEvent[]
  const stepped = advancePublicV14GreenwayFrame({ ...candidate,
    eventSequence: before.eventSequence + events.length }, [], { walkRequested: false })
  if (stepped.rejections.length) return reject(before, intent, 'invalid_value',
    'The action cannot advance the world frame.')
  return { state: stepped.state, events: [...events, ...stepped.events], rejections: [] }
}

/** A pure candidate transition. The v14 snapshot validator and writer own persistence. */
export function advancePublicV14GreenwayAction(state: PublicV14State,
  intent: PublicWorldIntent, allowWayfinderGlow = false,
  wayfinderPosition = state.player.position): PublicV14GreenwayFrameResult {
  if (state.generationProfile !== STARTER_CLIFF_PROFILE || state.movementOwner !== 'greenway') {
    throw new RangeError('A validated starter-cliff Greenway state is required.')
  }
  if (!intent) throw new TypeError('An action is required.')
  if (intent.type !== 'equip_item' && intent.type !== 'unequip_item'
    && intent.type !== 'buy_store_listing' && intent.type !== 'sell_to_store'
    && intent.type !== 'harvest' && intent.type !== 'build_route'
    && !(allowWayfinderGlow && (intent.type === 'study_inscription'
      || intent.type === 'cast_spell'))) {
    return reject(state, intent, 'unavailable_here',
      'Instant route traversal and this action are unavailable in the starter cliff.')
  }
  const route = state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
  if (!starterCliffPoseValid({ seed: state.seed, profile: state.generationProfile,
    route, built: state.greenway.builtRouteIds.includes('greenway_ladder') },
  state.player.position, state.player.verticalVelocity)) {
    return reject(state, intent, 'airborne', 'Finish the movement before interacting.')
  }

  if (intent.type === 'study_inscription') {
    const inscription = state.greenway.inscriptions.find((entry) =>
      entry.id === 'greenway_waystone' && entry.spellId === 'wayfinder_glow')
    if (intent.inscriptionId !== 'greenway_waystone' || !inscription) return reject(state,
      intent, 'not_found', 'Only the canonical Greenway waystone can be studied here.')
    if (state.greenway.studiedInscriptionIds.includes(inscription.id)) return reject(state,
      intent, 'already_studied', 'The Greenway waystone was already studied.')
    if (distance(wayfinderPosition, inscription.position) > INTERACT_DISTANCE) return reject(state,
      intent, 'too_far', 'Move closer to the Greenway waystone.')
    return finish(state, { ...state, greenway: { ...state.greenway,
      studiedInscriptionIds: [...state.greenway.studiedInscriptionIds, inscription.id].sort() },
    player: { ...state.player, learnedSpellIds: [...new Set([
      ...state.player.learnedSpellIds, inscription.spellId])].sort() } }, intent,
    [{ type: 'inscription_studied', inscriptionId: inscription.id,
      spellId: inscription.spellId }])
  }

  if (intent.type === 'cast_spell') {
    if (intent.spellId !== 'wayfinder_glow') return reject(state, intent, 'not_found',
      'Only Wayfinder Glow can be cast here.')
    if (!state.player.learnedSpellIds.includes(intent.spellId)) return reject(state,
      intent, 'unlearned_spell', 'Study the Greenway waystone before casting Wayfinder Glow.')
    const revealedTileIds = nearbyWorldTileIds(wayfinderPosition,
      PUBLIC_SPELL_REVEAL_RADIUS_METERS)
      .filter((id) => !discoveryMaskHasTileId(state.discoveryMask, id))
    const xp = revealedTileIds.length * 10
    if (xp && (!Number.isSafeInteger(state.player.skillXp.spellcraft + xp)
      || !Number.isSafeInteger(state.player.skillXp.wayfinding + xp))) return reject(state,
      intent, 'invalid_value', 'Experience is exhausted.')
    const discoveryMask = new Uint8Array(state.discoveryMask)
    const bits = encodeDiscoveredTileIds(revealedTileIds)
    for (let byte = 0; byte < discoveryMask.length; byte++) discoveryMask[byte] |= bits[byte]
    const bodies: ActionBody[] = [{ type: 'spell_cast', spellId: intent.spellId,
      revealedTileIds, revealedDigSiteIds: [] },
    ...revealedTileIds.map((tileId) => ({ type: 'tile_discovered' as const, tileId }))]
    if (xp) bodies.push({ type: 'skill_xp_gained', skillId: 'spellcraft', xp },
      { type: 'skill_xp_gained', skillId: 'wayfinding', xp })
    return finish(state, { ...state, discoveryMask, player: { ...state.player,
      skillXp: { ...state.player.skillXp,
        spellcraft: state.player.skillXp.spellcraft + xp,
        wayfinding: state.player.skillXp.wayfinding + xp } } }, intent, bodies)
  }

  if (intent.type === 'equip_item') {
    if ((intent.itemId === 'woodcutters_axe' || intent.itemId === 'field_spade')
      && intent.slot === 'mainHand') {
      if (owned(state.player.inventory, intent.itemId) < 1) {
        return reject(state, intent, 'not_owned', 'The tool is not in the backpack.')
      }
      if (state.player.equipment.mainHand === intent.itemId) {
        return reject(state, intent, 'not_owned', 'The tool is already equipped.')
      }
      return finish(state, { ...state, player: { ...state.player,
        equipment: { ...state.player.equipment, mainHand: intent.itemId } } }, intent,
      [{ type: 'item_equipped', itemId: intent.itemId, slot: 'mainHand' }])
    }
    if (intent.itemId !== 'leather_boots' || intent.slot !== 'feet') return reject(state,
      intent, 'unavailable_here', 'Only starter boots, the axe and the field spade can be equipped here.')
    if (owned(state.player.inventory, 'leather_boots') < 1) return reject(state,
      intent, 'not_owned', 'Buy leather boots before equipping them.')
    if (state.player.equipment.feet === 'leather_boots') return reject(state,
      intent, 'not_owned', 'Leather boots are already equipped.')
    return finish(state, { ...state, player: { ...state.player,
      equipment: { ...state.player.equipment, feet: 'leather_boots' } } }, intent,
    [{ type: 'item_equipped', itemId: 'leather_boots', slot: 'feet' }])
  }

  if (intent.type === 'unequip_item') {
    if (intent.slot !== 'feet' || state.player.equipment.feet !== 'leather_boots') {
      return reject(state, intent, 'invalid_value', 'No leather boots are equipped in Feet.')
    }
    return finish(state, { ...state, player: { ...state.player,
      equipment: { ...state.player.equipment, feet: null } } }, intent,
    [{ type: 'item_unequipped', itemId: 'leather_boots', slot: 'feet' }])
  }

  if (intent.type === 'buy_store_listing') {
    if (intent.listingId === 'spade') {
      const store = state.greenway.stores[0]
      const listing = store.listings.find((entry) => entry.id === 'spade'
        && entry.itemId === 'field_spade')
      if (intent.storeId !== 'store-greenway' || store.id !== 'store-greenway' || !listing) return reject(state,
        intent, 'not_found', 'The canonical field spade listing is unavailable.')
      if (distance(state.player.position, store.position) > INTERACT_DISTANCE) return reject(state,
        intent, 'too_far', 'Move closer to Greenway Outfitters.')
      if (owned(state.player.inventory, 'field_spade') > 0
        || state.player.tradeSlots.some((slot) => slot.itemId === 'field_spade')) return reject(state,
        intent, 'not_owned', 'A field spade is already owned.')
      if (listing.stock < 1) return reject(state, intent, 'out_of_stock', 'Field spades are out of stock.')
      if (state.player.coins < listing.price) return reject(state,
        intent, 'insufficient_coins', 'Not enough coins for a field spade.')
      if (backpackSlotsAfterAdd(state.player.inventory, state.player.tradeSlots, 'field_spade', 1)
        > state.player.backpackCapacity) return reject(state,
        intent, 'capacity', 'The backpack is full.')
      return finish(state, { ...state, greenway: { ...state.greenway,
        stores: [{ ...store, listings: store.listings.map((offer) => offer.id === listing.id
          ? { ...offer, stock: offer.stock - 1 } : offer) }, state.greenway.stores[1]] },
      player: { ...state.player, coins: state.player.coins - listing.price,
        inventory: [...state.player.inventory, { itemId: 'field_spade', quantity: 1 }] } }, intent,
      [{ type: 'store_item_bought', storeId: store.id, listingId: 'spade',
        itemId: 'field_spade', price: listing.price }])
    }
    if (intent.listingId !== PUBLIC_V11_BOOTS_LISTING_ID) return reject(state,
      intent, 'unavailable_here', 'Only the virtual leather boots offer is available here.')
    const purchase = publicBootPurchaseCandidate(state, intent.storeId)
    if ('rejection' in purchase) {
      const codes: Record<string, PublicWorldRejection['code']> = {
        'Move closer to Greenway Outfitters.': 'too_far',
        'Not enough coins for leather boots.': 'insufficient_coins',
        'The backpack is full.': 'capacity',
      }
      return reject(state, intent, codes[purchase.rejection] ?? 'unavailable_here',
        purchase.rejection)
    }
    return finish(state, { ...state, player: purchase.player }, intent,
    [{ type: 'store_item_bought', storeId: intent.storeId,
      listingId: PUBLIC_V11_BOOTS_LISTING_ID, itemId: 'leather_boots',
      price: PUBLIC_V11_BOOTS_PRICE }])
  }

  if (intent.type === 'sell_to_store') {
    const store = state.greenway.stores.find((entry) => entry.id === 'store-greenway')
    if (intent.storeId !== 'store-greenway' || intent.itemId !== 'stone' || !store) return reject(state,
      intent, 'not_found', 'Only stone can be sold at Greenway Outfitters here.')
    if (!Number.isSafeInteger(intent.quantity) || intent.quantity < 1) return reject(state,
      intent, 'invalid_value', 'Sale quantity must be a positive whole number.')
    if (distance(state.player.position, store.position) > INTERACT_DISTANCE) return reject(state,
      intent, 'too_far', 'Move closer to Greenway Outfitters.')
    if (owned(state.player.inventory, 'stone') < intent.quantity) return reject(state,
      intent, 'not_owned', 'Not enough stone to sell.')
    const unitPrice = storeSellUnitPrice(store.id, 'stone')
    const totalPrice = intent.quantity * (unitPrice ?? 0)
    if (unitPrice === null || !Number.isSafeInteger(totalPrice)
      || !Number.isSafeInteger(state.player.coins + totalPrice)) return reject(state,
        intent, 'invalid_value', 'The stone sale exceeds the coin range.')
    let remaining = intent.quantity
    const inventory = state.player.inventory.map((stack) => {
      if (stack.itemId !== 'stone' || remaining === 0) return stack
      const sold = Math.min(remaining, stack.quantity)
      remaining -= sold
      return { ...stack, quantity: stack.quantity - sold }
    }).filter((stack) => stack.quantity > 0)
    return finish(state, { ...state, player: { ...state.player,
      coins: state.player.coins + totalPrice, inventory } }, intent,
    [{ type: 'store_item_sold', storeId: store.id, itemId: 'stone',
      quantity: intent.quantity, unitPrice, totalPrice }])
  }

  if (intent.type === 'harvest') {
    const resource = state.greenway.resources.find((entry) => entry.id === intent.resourceId)
    if (!resource || resource.kind !== 'tree') return reject(state, intent, 'not_found',
      'This tree does not exist in the starter world.')
    if (resource.depleted) return reject(state, intent, 'depleted', 'This tree is depleted.')
    if (distance(state.player.position, resource.position) > INTERACT_DISTANCE) {
      return reject(state, intent, 'too_far', 'Move closer to the tree.')
    }
    if (state.player.equipment.mainHand !== 'woodcutters_axe') {
      return reject(state, intent, 'requires_axe', 'Equip the woodcutter axe first.')
    }
    const finalHit = resource.health === 1
    if (finalHit && backpackSlotsAfterAdd(state.player.inventory, state.player.tradeSlots, 'logs', TREE_YIELD)
      > state.player.backpackCapacity) {
      return reject(state, intent, 'capacity', 'The backpack cannot hold four logs.')
    }
    if (finalHit && (!Number.isSafeInteger(state.player.xp + TREE_XP)
      || !Number.isSafeInteger(state.player.skillXp.woodcutting + TREE_XP))) {
      return reject(state, intent, 'invalid_value', 'Experience is exhausted.')
    }
    const resources = state.greenway.resources.map((entry) => entry.id === resource.id
      ? { ...entry, health: entry.health - 1, depleted: finalHit } : entry)
    if (!finalHit) return finish(state, { ...state, greenway: { ...state.greenway,
      resources } }, intent, [{ type: 'resource_damaged', resourceId: resource.id,
      health: resource.health - 1 }])
    const inventory = state.player.inventory.map((stack) => stack.itemId === 'logs'
      ? { ...stack, quantity: stack.quantity + TREE_YIELD } : stack)
    if (!inventory.some((stack) => stack.itemId === 'logs')) {
      inventory.push({ itemId: 'logs', quantity: TREE_YIELD })
    }
    const xp = state.player.xp + TREE_XP
    return finish(state, { ...state, greenway: { ...state.greenway, resources },
      player: { ...state.player, xp, level: levelForXp(xp), inventory,
        skillXp: { ...state.player.skillXp,
          woodcutting: state.player.skillXp.woodcutting + TREE_XP } } }, intent,
    [{ type: 'resource_harvested', resourceId: resource.id, itemId: 'logs',
      quantity: TREE_YIELD, xp: TREE_XP },
    { type: 'skill_xp_gained', skillId: 'woodcutting', xp: TREE_XP }])
  }

  const site = starterCliffCanonicalSite(state.seed)
  if (intent.routeId !== 'greenway_ladder' || intent.siteId !== STARTER_CLIFF_SITE_ID) {
    return reject(state, intent, 'not_found', 'This is not the canonical starter cliff site.')
  }
  if (state.greenway.builtRouteIds.includes('greenway_ladder')) {
    return reject(state, intent, 'already_built', 'The starter ladder is complete.')
  }
  const sourceTile = state.greenway.tiles.find((tile) =>
    tile.center.x === site.from.x && tile.center.z === site.from.z)
  if (!sourceTile || !discoveryMaskHasTileId(state.discoveryMask, sourceTile.id)) {
    return reject(state, intent, 'undiscovered', 'Discover the foot of the cliff first.')
  }
  if (distance(state.player.position, site.from) > INTERACT_DISTANCE) {
    return reject(state, intent, 'too_far', 'Approach the foot of the cliff.')
  }
  const recipe = state.greenway.recipes.find((entry) => entry.id === 'greenway_ladder')
  if (!recipe || recipe.logCost !== LADDER_COST || recipe.xpReward !== LADDER_XP
    || !state.greenway.unlockedRecipeIds.includes('greenway_ladder')) {
    return reject(state, intent, 'recipe_locked', 'The starter ladder recipe is unavailable.')
  }
  if (owned(state.player.inventory, 'logs') < LADDER_COST) {
    return reject(state, intent, 'not_owned', 'The starter ladder needs four logs.')
  }
  if (!Number.isSafeInteger(state.player.xp + LADDER_XP)
    || !Number.isSafeInteger(state.player.skillXp.construction + LADDER_XP)) {
    return reject(state, intent, 'invalid_value', 'Experience is exhausted.')
  }
  let left = LADDER_COST
  const inventory = state.player.inventory.map((stack) => {
    if (stack.itemId !== 'logs' || left === 0) return stack
    const spent = Math.min(left, stack.quantity)
    left -= spent
    return { ...stack, quantity: stack.quantity - spent }
  }).filter((stack) => stack.quantity > 0)
  const xp = state.player.xp + LADDER_XP
  return finish(state, { ...state, greenway: { ...state.greenway,
    routes: state.greenway.routes.map((entry) => entry.id === 'greenway_ladder'
      ? { ...entry, from: site.from, to: site.to, siteId: site.id } : entry),
    builtRouteIds: [...state.greenway.builtRouteIds, 'greenway_ladder' as const].sort() },
  player: { ...state.player, inventory, xp, level: levelForXp(xp),
    skillXp: { ...state.player.skillXp,
      construction: state.player.skillXp.construction + LADDER_XP } } }, intent,
  [{ type: 'route_built', routeId: 'greenway_ladder', siteId: STARTER_CLIFF_SITE_ID,
    logCost: LADDER_COST, xp: LADDER_XP },
  { type: 'skill_xp_gained', skillId: 'construction', xp: LADDER_XP }])
}
