import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassAnchors, mireglassFairyRing, mireglassResources } from './mireglassContent'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import { mireglassRouteSites } from './mireglassRouteSites'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS,
  PUBLIC_SPELL_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import type { PublicV23Progress } from './publicWorldV23Snapshot'
import { applyPublicV24MireglassAction, decodePublicV24MireglassAction } from './publicWorldV24MireglassAction'
import type { PublicV24MireglassAction } from './publicWorldV24MireglassAction'
import { createPublicV24Root, decodePublicV24Head, decodePublicV24Root, replayPublicV24Witness } from './publicWorldV24Snapshot'

const seed = 'greenway-alpha'
const fresh = (worldSeed = seed): PublicV23Progress => {
  const { head } = createPublicV23Root(worldSeed)
  return { state: head.state, greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }
}
const stand = (progress: PublicV23Progress, x: number, z: number): PublicV23Progress => {
  const state = { ...progress.state, movementOwner: 'streamed' as const }
  const surface = resolvePublicV23Surface(state, { x, z }, progress.regionalWorks.builtLadderIds)!
  expect(surface).not.toBeNull()
  const mask = encodeDiscoveredTileIds([...new Set([
    ...decodeDiscoveredTileIds(state.discoveryMask), surface.tileId,
  ])].sort())
  const next = { ...progress, state: { ...state, discoveryMask: mask,
    player: { ...state.player, position: { x, y: surface.floorY, z } } } }
  expect(decodePublicV23Progress(next, progress.state.seed)).not.toBeNull()
  return next
}
const act = (progress: PublicV23Progress, action: PublicV24MireglassAction) => {
  const result = applyPublicV24MireglassAction(progress, action)
  if ('rejection' in result) throw new Error(result.rejection)
  expect(result.progress.state.eventSequence).toBe(progress.state.eventSequence + 1)
  expect(result.events).toHaveLength(1)
  expect(result.events[0].sequence).toBe(result.progress.state.eventSequence)
  expect(decodePublicV23Progress(result.progress, progress.state.seed)).not.toBeNull()
  return result.progress
}
const give = (progress: PublicV23Progress, itemId: 'woodcutters_axe' | 'field_spade' | 'logs'
  | 'leather_boots' | 'mireglass_reach/item/waders', quantity = 1) => {
  const player = structuredClone(progress.state.player)
  const stack = player.inventory.find((entry) => entry.itemId === itemId)
  if (stack) stack.quantity += quantity
  else player.inventory.push({ itemId, quantity })
  return { ...progress, state: { ...progress.state, player } }
}

describe('V24 Mireglass checked action adapter', () => {
  it.each(['greenway-alpha', 'wizard-realms'])('accepts exact wide survey from a grounded 16 m discovery circle in %s', (worldSeed) => {
    const marker = mireglassAnchors(worldSeed).fringeMarker.tile.center
    const grounded = stand(fresh(worldSeed), marker.x, marker.z)
    const known = [...new Set([...decodeDiscoveredTileIds(grounded.state.discoveryMask),
      ...nearbyWorldTileIds(marker, PUBLIC_WALK_REVEAL_RADIUS_METERS)])].sort()
    const start = { ...grounded, state: { ...grounded.state,
      discoveryMask: encodeDiscoveredTileIds(known),
      player: { ...grounded.state.player,
        learnedSpellIds: ['wayfinder_glow' as const] } } }
    const action = { type: 'cast_wayfinder_glow_wide' as const }
    expect(decodePublicV24MireglassAction(action)).toEqual(action)
    expect(decodePublicV24MireglassAction({ ...action, radius: 24 })).toBeNull()
    expect(decodePublicV24MireglassAction({ ...action, revealedTileIds: [] })).toBeNull()
    expect(applyPublicV24MireglassAction(start, { type: 'cast_wayfinder_glow' }))
      .toEqual({ rejection: 'already_revealed' })
    const result = applyPublicV24MireglassAction(start, action)
    if (!result.progress) throw new Error(result.rejection)
    const expected = nearbyWorldTileIds(marker, PUBLIC_SPELL_REVEAL_RADIUS_METERS)
      .filter((id) => !known.includes(id))
    expect(result.events[0]).toMatchObject({ type: 'terrain_revealed',
      revealedTileIds: expected, xp: 10 * Math.min(expected.length, 13) })
    expect(result.progress.state.mireglass.cacheRevealed).toBe(false)
    expect(decodeDiscoveredTileIds(result.progress.state.discoveryMask)).toEqual(
      [...new Set([...known, ...expected])].sort())
    expect(result.progress.state.tick).toBe(start.state.tick)
    expect(result.progress.state.rng).toEqual(start.state.rng)
    expect(applyPublicV24MireglassAction(result.progress, action))
      .toEqual({ rejection: 'already_revealed' })
    expect(applyPublicV24MireglassAction({ ...start, state: { ...start.state,
      player: { ...start.state.player, verticalVelocity: 1 } } }, action))
      .toEqual({ rejection: 'invalid-progress' })
  })

  it('accepts only exact bounded requests and rejects old teleport and proposed results', () => {
    expect(decodePublicV24MireglassAction({ type: 'study_fringe_marker' })).toEqual({ type: 'study_fringe_marker' })
    for (const raw of [{ type: 'traverse_route', siteId: 'x', from: 'from' },
      { type: 'study_fringe_marker', player: {} }, { type: 'chop_tree', resourceId: 'x'.repeat(161) },
      { type: 'sell_item', itemId: 'logs', quantity: 0 },
      { type: 'buy_item', itemId: 'ancient_relic' },
      Object.create({ type: 'study_fringe_marker' })]) {
      expect(decodePublicV24MireglassAction(raw)).toBeNull()
    }
    expect(applyPublicV24MireglassAction(fresh(), { type: 'study_fringe_marker' }))
      .toEqual({ rejection: 'unavailable_here' })
    expect(applyPublicV24MireglassAction(fresh(), { type: 'traverse_route', siteId: 'x', from: 'from' }))
      .toEqual({ rejection: 'invalid-action' })
  })

  it('studies the marker and discovers the ring without changing movement clock or RNG', () => {
    const marker = mireglassAnchors(seed).fringeMarker.tile.center
    const start = stand(fresh(), marker.x, marker.z)
    const studied = act(start, { type: 'study_fringe_marker' })
    expect(studied.state.mireglass.fringeMarkerStudied).toBe(true)
    expect(studied.state.player.learnedSpellIds).toContain('wayfinder_glow')
    expect(studied.state.tick).toBe(start.state.tick)
    expect(studied.state.rng).toEqual(start.state.rng)
    expect(applyPublicV24MireglassAction(start, { type: 'study_fringe_marker' }))
      .toEqual(applyPublicV24MireglassAction(start, { type: 'study_fringe_marker' }))
    expect(applyPublicV24MireglassAction(studied, { type: 'study_fringe_marker' }))
      .toEqual({ rejection: 'already_studied' })
    const ring = mireglassFairyRing(seed).tile.center
    const discovered = act(stand(studied, ring.x, ring.z), { type: 'discover_fairy_ring' })
    expect(discovered.state.player.discoveredRingIds).toContain('ring-mireglass')
  })

  it('re-equips owned boots after waders through an exact replayed action', () => {
    const marker = mireglassAnchors(seed).fringeMarker.tile.center
    const owned = give(give(fresh(), 'leather_boots'), 'mireglass_reach/item/waders')
    const wearingWaders = stand({ ...owned, state: { ...owned.state,
      player: { ...owned.state.player, equipment: { ...owned.state.player.equipment,
        feet: 'mireglass_reach/item/waders' } } } }, marker.x, marker.z)
    const action = { type: 'equip_item' as const, itemId: 'leather_boots' as const }
    const witness = { kind: 'mireglass-action/v1' as const, action }
    expect(decodePublicV24MireglassAction(action)).toEqual(action)
    expect(decodePublicV24MireglassAction({ ...action, proposedFeet: 'leather_boots' })).toBeNull()
    const equipped = act(wearingWaders, action)
    expect(equipped.state.player.equipment.feet).toBe('leather_boots')
    expect(equipped.state.tick).toBe(wearingWaders.state.tick)
    expect(equipped.state.rng).toEqual(wearingWaders.state.rng)
    expect(replayPublicV24Witness(wearingWaders, witness)).toEqual(equipped)
    expect(decodePublicV24Root(createPublicV24Root(createPublicV23Root(seed)))).not.toBeNull()
    expect(applyPublicV24MireglassAction(equipped, action))
      .toEqual({ rejection: 'already_equipped' })
    const unowned = { ...wearingWaders, state: { ...wearingWaders.state,
      player: { ...wearingWaders.state.player, inventory: wearingWaders.state.player.inventory
        .filter((stack) => stack.itemId !== 'leather_boots') } } }
    expect(applyPublicV24MireglassAction(unowned, action)).toEqual({ rejection: 'not_owned' })
    const airborne = { ...wearingWaders, state: { ...wearingWaders.state,
      player: { ...wearingWaders.state.player, verticalVelocity: 1 } } }
    const saved = structuredClone(airborne)
    expect(applyPublicV24MireglassAction(airborne, action)).toHaveProperty('rejection')
    expect(airborne).toEqual(saved)
  })

  it('chops timber, digs its stump, and gathers an herb once per cycle', () => {
    const tree = mireglassResources(seed)[0]
    let start = stand(give(give(fresh(), 'woodcutters_axe'), 'field_spade'),
      tree.tile.center.x, tree.tile.center.z)
    start = { ...start, state: { ...start.state, player: { ...start.state.player,
      equipment: { ...start.state.player.equipment, mainHand: 'woodcutters_axe' } } } }
    const chopped = act(start, { type: 'chop_tree', resourceId: tree.id })
    expect(chopped.state.mireglass.depletedResourceIds).toContain(tree.id)
    expect(chopped.state.player.inventory.find((entry) => entry.itemId === 'logs')?.quantity).toBeGreaterThanOrEqual(4)
    const spade = act(chopped, { type: 'equip_item', itemId: 'field_spade' })
    const dug = act(spade, { type: 'dig_tree_stump', resourceId: tree.id })
    expect(dug.state.mireglass.dugStumpIds).toContain(tree.id)
    expect(dug.state.player.skillXp.excavation).toBeGreaterThanOrEqual(30)
    const herb = mireglassHerbPatches(seed)[0]
    const atHerb = stand(dug, herb.tile.center.x, herb.tile.center.z)
    const gathered = act(atHerb, { type: 'forage_herb', patchId: herb.id })
    expect(gathered.state.mireglass.herbHarvestCycles).toContainEqual({ patchId: herb.id, cycle: 0 })
    expect(applyPublicV24MireglassAction(gathered, { type: 'forage_herb', patchId: herb.id }))
      .toEqual({ rejection: 'already_harvested' })
  })

  it('builds an authored fen bridge and rejects distant or over-capacity gathering', () => {
    const site = mireglassRouteSites(seed).find((candidate) => candidate.kind === 'bridge')!
    const starting = stand(give(fresh(), 'logs', 8), site.from.x, site.from.z)
    const built = act(starting, { type: 'build_route', siteId: site.id })
    expect(built.state.mireglass.builtRoutes.bridge).toBe(site.id)
    expect(built.state.player.skillXp.construction - starting.state.player.skillXp.construction).toBe(80)
    const tree = mireglassResources(seed)[0]
    expect(applyPublicV24MireglassAction(starting,
      { type: 'chop_tree', resourceId: tree.id })).toEqual({ rejection: 'too_far' })
    const atTree = stand(give(fresh(), 'woodcutters_axe'), tree.tile.center.x, tree.tile.center.z)
    const player = structuredClone(atTree.state.player)
    player.equipment.mainHand = 'woodcutters_axe'
    player.backpackCapacity = player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)
      + player.tradeSlots.reduce((sum, slot) => sum + slot.quantity, 0)
    const full = { ...atTree, state: { ...atTree.state, player } }
    expect(decodePublicV23Progress(full, seed)).not.toBeNull()
    expect(applyPublicV24MireglassAction(full,
      { type: 'chop_tree', resourceId: tree.id })).toEqual({ rejection: 'capacity' })
  })

  it('casts Glow from saved discovery, excavates a revealed seal, and trades at the outpost', () => {
    const cache = mireglassAnchors(seed).sealCache.tile.center
    const player = structuredClone(fresh().state.player)
    player.skillXp.excavation = 30
    player.xp += 30
    player.level = 1 + Math.floor(player.xp / 100)
    player.learnedSpellIds.push('wayfinder_glow')
    player.equipment.mainHand = 'field_spade'
    player.inventory.push({ itemId: 'field_spade', quantity: 1 })
    const initial = fresh()
    const near = stand({ ...initial, state: { ...initial.state, player } }, cache.x + 2.1, cache.z)
    const revealed = act(near, { type: 'cast_wayfinder_glow' })
    expect(revealed.state.mireglass.cacheRevealed).toBe(true)
    expect(decodeDiscoveredTileIds(revealed.state.discoveryMask).length)
      .toBeGreaterThan(decodeDiscoveredTileIds(near.state.discoveryMask).length)
    const dug = act(revealed, { type: 'excavate_cache' })
    expect(dug.state.player.position).toEqual(revealed.state.player.position)
    expect(dug.state.mireglass.cacheExcavated).toBe(true)
    expect(dug.state.player.inventory).toContainEqual({ itemId: 'mireglass_reach/item/seal', quantity: 1 })
    const store = mireglassAnchors(seed).salvager.tile.center
    const atStore = stand(dug, store.x, store.z)
    const sold = act(atStore, { type: 'sell_item', itemId: 'mireglass_reach/item/seal', quantity: 1 })
    expect(sold.state.player.coins).toBe(atStore.state.player.coins + 80)
    const bought = act(sold, { type: 'buy_item', itemId: 'field_spade' })
    expect(bought.state.mireglass.shopStock.field_spade).toBe(sold.state.mireglass.shopStock.field_spade - 1)
  })

  it.each(['greenway-alpha', 'wizard-realms'])('excavates while grounded on the cache cell in %s', (worldSeed) => {
    const cache = mireglassAnchors(worldSeed).sealCache.tile.center
    const initial = fresh(worldSeed)
    const player = structuredClone(initial.state.player)
    player.skillXp.excavation = 30
    player.xp += 30
    player.level = 1 + Math.floor(player.xp / 100)
    player.learnedSpellIds.push('wayfinder_glow')
    player.equipment.mainHand = 'field_spade'
    player.inventory.push({ itemId: 'field_spade', quantity: 1 })
    const atCache = stand({ ...initial, state: { ...initial.state, player } }, cache.x, cache.z)
    const revealed = act(atCache, { type: 'cast_wayfinder_glow' })
    expect(revealed.state.player.position.y).toBe(cache.y)
    const dug = applyPublicV24MireglassAction(revealed, { type: 'excavate_cache' })
    expect(dug).toHaveProperty('progress')
    if (!dug.progress) throw new Error('Expected checked excavation to succeed.')
    const next = dug.progress
    expect(next.state.mireglass.cacheExcavated).toBe(true)
    expect(next.state.player.position).toEqual({ ...revealed.state.player.position, y: 1.65 })
    expect(next.state.player.verticalVelocity).toBe(0)
    expect(resolvePublicV23Surface(next.state, next.state.player.position,
      next.regionalWorks.builtLadderIds)?.floorY).toBe(1.65)
    expect(next.state.player.inventory.filter((stack) =>
      stack.itemId === 'mireglass_reach/item/seal')).toEqual([
      { itemId: 'mireglass_reach/item/seal', quantity: 1 },
    ])
    expect(next.state.tick).toBe(revealed.state.tick)
    expect(next.state.rng).toEqual(revealed.state.rng)
    expect(decodePublicV23Progress(structuredClone(next), worldSeed)).toEqual(next)
    const root = createPublicV24Root(createPublicV23Root(worldSeed))
    const savedHead = { ...next, schemaVersion: root.head.schemaVersion, saveRevision: 1,
      witness: { kind: 'mireglass-action/v1' as const, action: { type: 'excavate_cache' as const } } }
    expect(decodePublicV24Head(structuredClone(savedHead), root.lineage)).toEqual(savedHead)
    expect(replayPublicV24Witness(revealed, { kind: 'mireglass-action/v1',
      action: { type: 'excavate_cache' } })).toEqual(next)
    const saved = structuredClone(next)
    expect(applyPublicV24MireglassAction(next, { type: 'excavate_cache' }))
      .toEqual({ rejection: 'already_excavated' })
    expect(next).toEqual(saved)
  })
})
