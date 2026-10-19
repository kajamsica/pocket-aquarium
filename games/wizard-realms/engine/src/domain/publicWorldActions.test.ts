import { describe, expect, it } from 'vitest'
import { mireglassAnchors, mireglassResources } from './mireglassContent'
import { isValidMireglassRegionProgress, isValidMireglassV6Player } from './mireglassExpedition'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import { mireglassRouteSites } from './mireglassRouteSites'
import { actPublicMireglass } from './publicWorldActions'
import type { PublicMireglassActionResult } from './publicWorldActions'
import { advancePublicWorldFrame } from './publicWorldRuntime'
import { createFreshPublicWorld } from './publicWorldState'
import type { PublicWorldState } from './publicWorldState'
import { isValidPublicWorldV7State, withFreshPublicV7Herbs } from './publicWorldV7'
import { createStreamedWorldFromState } from './streamedWorld'
import type { Vec3 } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seed = 'public-mireglass-actions'
const base = createFreshPublicWorld(seed, 'greenway-classic-v1')
const anchors = mireglassAnchors(seed)
const tree = mireglassResources(seed)[0]
const routes = mireglassRouteSites(seed)
const bridge = routes.find(({ kind }) => kind === 'bridge')!
const ladder = routes.find(({ kind }) => kind === 'ladder')!

const tileId = (position: Vec3) => worldTileAtGrid(seed,
  position.x / WORLD_CELL_METERS, position.z / WORLD_CELL_METERS).id
function at(position: Vec3, state: PublicWorldState = base): PublicWorldState {
  return { ...state, movementOwner: 'streamed', player: { ...state.player, position: { ...position }, verticalVelocity: 0 },
    discoveredTileIds: [...new Set([...state.discoveredTileIds, tileId(position)])].sort() }
}
function accepted(result: PublicMireglassActionResult): Extract<PublicMireglassActionResult, { event: object }> {
  expect(result.rejection).toBeUndefined()
  expect(result.event).toBeDefined()
  return result as Extract<PublicMireglassActionResult, { event: object }>
}
function rejected(result: PublicMireglassActionResult, code: string, original: PublicWorldState) {
  expect(result.rejection?.code).toBe(code)
  expect(result.event).toBeUndefined()
  expect(result.state).toBe(original)
}
function saveCompatible(state: PublicWorldState) {
  expect(isValidMireglassV6Player(state.player)).toBe(true)
  expect(isValidMireglassRegionProgress(state.mireglass, seed)).toBe(true)
  expect(() => createStreamedWorldFromState({ seed, tick: state.tick,
    player: { position: state.player.position, yaw: state.player.yaw, pitch: state.player.pitch,
      verticalVelocity: state.player.verticalVelocity }, discoveredTileIds: state.discoveredTileIds })).not.toThrow()
}

describe('public v6 Mireglass actions', () => {
  it('gates Greenway ownership, invalid actions and sequence exhaustion without mutating state', () => {
    rejected(actPublicMireglass(base, { type: 'study_fringe_marker' }), 'unavailable_here', base)
    const marker = at(anchors.fringeMarker.tile.center)
    rejected(actPublicMireglass(marker, { type: 'unknown' } as never), 'invalid_value', marker)
    const exhausted = { ...marker, eventSequence: Number.MAX_SAFE_INTEGER }
    rejected(actPublicMireglass(exhausted, { type: 'study_fringe_marker' }), 'invalid_value', exhausted)
  })

  it('studies the marker using one authoritative player and one event sequence, not a movement tick', () => {
    const marker = at(anchors.fringeMarker.tile.center)
    const before = JSON.stringify(marker)
    const studied = accepted(actPublicMireglass(marker, { type: 'study_fringe_marker' }))
    expect(studied.event).toMatchObject({ type: 'fringe_marker_studied', sequence: marker.eventSequence + 1 })
    expect(studied.state.player.learnedSpellIds).toContain('wayfinder_glow')
    expect(studied.state.mireglass.fringeMarkerStudied).toBe(true)
    expect(studied.state.greenway).toBe(marker.greenway)
    expect(studied.state.tick).toBe(marker.tick)
    expect(studied.state.rng).toBe(marker.rng)
    expect(JSON.stringify(marker)).toBe(before)
    saveCompatible(studied.state)
  })

  it('enforces owned tools, chops and digs, then buys, sells and visibly equips at the outpost', () => {
    let state = at(tree.tile.center)
    rejected(actPublicMireglass(state, { type: 'chop_tree', resourceId: tree.id }), 'requires_axe', state)
    state = accepted(actPublicMireglass(state, { type: 'equip_item', itemId: 'woodcutters_axe' })).state
    state = accepted(actPublicMireglass(state, { type: 'chop_tree', resourceId: tree.id })).state
    expect(state.mireglass.depletedResourceIds).toContain(tree.id)
    expect(state.player.inventory.find(({ itemId }) => itemId === 'logs')?.quantity).toBe(4)
    rejected(actPublicMireglass(state, { type: 'dig_tree_stump', resourceId: tree.id }), 'requires_spade', state)
    state = at(anchors.salvager.tile.center, state)
    state = accepted(actPublicMireglass(state, { type: 'buy_item', itemId: 'field_spade' })).state
    expect(state.mireglass.shopStock.field_spade).toBe(2)
    state = accepted(actPublicMireglass(state, { type: 'sell_item', itemId: 'logs', quantity: 1 })).state
    state = accepted(actPublicMireglass(state, { type: 'equip_item', itemId: 'field_spade' })).state
    expect(state.player.equipment.mainHand).toBe('field_spade')
    state = at(tree.tile.center, state)
    state = accepted(actPublicMireglass(state, { type: 'dig_tree_stump', resourceId: tree.id })).state
    expect(state.mireglass.dugStumpIds).toContain(tree.id)
    expect(state.player.inventory.find(({ itemId }) => itemId === 'stone')?.quantity).toBe(1)
    expect(state.eventSequence).toBe(base.eventSequence + 6)
    saveCompatible(state)
  })

  it('builds alternate route kinds and validates both crossing directions with destination discovery', () => {
    for (const site of [bridge, ladder]) {
      let state = at(site.from)
      state = { ...state, player: { ...state.player,
        inventory: [...state.player.inventory, { itemId: 'logs', quantity: site.logCost }] } }
      const built = accepted(actPublicMireglass(state, { type: 'build_route', siteId: site.id }))
      expect(built.event).toMatchObject({ type: 'route_built', sequence: state.eventSequence + 1 })
      expect(built.state.mireglass.builtRoutes[site.kind]).toBe(site.id)
      const crossed = accepted(actPublicMireglass(built.state,
        { type: 'traverse_route', siteId: site.id, from: 'from' }))
      expect(crossed.state.player.position).toEqual(site.to)
      expect(crossed.state.discoveredTileIds).toContain(tileId(site.to))
      expect(crossed.event).toMatchObject({ type: 'route_traversed', sequence: state.eventSequence + 2 })
      saveCompatible(crossed.state)
      const returned = accepted(actPublicMireglass(crossed.state,
        { type: 'traverse_route', siteId: site.id, from: 'to' }))
      expect(returned.state.player.position).toEqual(site.from)
      expect(returned.state.greenway).toBe(state.greenway)
      saveCompatible(returned.state)
    }
  })

  it('reveals and excavates the cache through a learned spell, skill and tool gate', () => {
    const marker = at(anchors.fringeMarker.tile.center)
    const studied = accepted(actPublicMireglass(marker, { type: 'study_fringe_marker' }))
    let state = at(anchors.sealCache.tile.center, studied.state)
    rejected(actPublicMireglass(state, { type: 'excavate_cache' }), 'site_hidden', state)
    const cast = accepted(actPublicMireglass(state, { type: 'cast_wayfinder_glow' }))
    expect(cast.event.type).toBe('cache_revealed')
    expect(cast.state.discoveredTileIds.length).toBeGreaterThan(state.discoveredTileIds.length)
    expect(cast.state.eventSequence).toBe(state.eventSequence + 1)
    expect(cast.state.tick).toBe(state.tick)
    state = cast.state
    rejected(actPublicMireglass(state, { type: 'excavate_cache' }), 'requires_spade', state)
    state = { ...state, player: { ...state.player, skillXp: { ...state.player.skillXp, excavation: 30 },
      inventory: [...state.player.inventory, { itemId: 'field_spade', quantity: 1 }],
      equipment: { ...state.player.equipment, mainHand: 'field_spade' } } }
    const excavated = accepted(actPublicMireglass(state, { type: 'excavate_cache' }))
    expect(excavated.state.mireglass.cacheExcavated).toBe(true)
    expect(excavated.state.player.inventory).toContainEqual({ itemId: 'mireglass_reach/item/seal', quantity: 1 })
    saveCompatible(excavated.state)
  })

  it('rejects a route transition atomically if the streamed destination snapshot cannot validate', () => {
    const prepared = at(bridge.from)
    const invalid = { ...prepared, discoveredTileIds: [...prepared.discoveredTileIds, 'not-a-tile'],
      mireglass: { ...prepared.mireglass, builtRoutes: { ...prepared.mireglass.builtRoutes, bridge: bridge.id } } }
    rejected(actPublicMireglass(invalid, { type: 'traverse_route', siteId: bridge.id, from: 'from' }),
      'invalid_destination', invalid)
    expect(invalid.eventSequence).toBe(prepared.eventSequence)
    expect(invalid.player.position).toEqual(bridge.from)
  })
})

describe('public v7 Bell Alder foraging', () => {
  it('uses the authoritative tick, one event sequence, and the same saved player', () => {
    const patch = mireglassHerbPatches(seed)[0]
    const state = at(patch.tile.center, withFreshPublicV7Herbs(base))
    const before = JSON.stringify(state)
    const first = accepted(actPublicMireglass(state, { type: 'forage_herb', patchId: patch.id }))
    expect(first.event).toMatchObject({ type: 'herb_foraged', patchId: patch.id,
      quantity: 1, sequence: state.eventSequence + 1 })
    expect(first.state.tick).toBe(state.tick)
    expect(first.state.player.inventory).toContainEqual({ itemId: 'marsh_herb', quantity: 1 })
    expect(first.state.greenway).toBe(state.greenway)
    expect(JSON.stringify(state)).toBe(before)
    expect(isValidPublicWorldV7State(first.state, null)).toBe(true)
    rejected(actPublicMireglass(first.state, { type: 'forage_herb', patchId: patch.id }),
      'already_harvested', first.state)
    const regrown = accepted(actPublicMireglass({ ...first.state, tick: 6_000 },
      { type: 'forage_herb', patchId: patch.id }))
    expect(regrown.state.player.inventory).toContainEqual({ itemId: 'marsh_herb', quantity: 2 })
    expect(isValidPublicWorldV7State(regrown.state, null)).toBe(true)
  })

  it('returns the gathered item to the existing Greenway single-player economy exactly once', () => {
    const patch = mireglassHerbPatches(seed)[0]
    const fresh = withFreshPublicV7Herbs(base)
    const harvested = accepted(actPublicMireglass(at(patch.tile.center, fresh),
      { type: 'forage_herb', patchId: patch.id }))
    const store = fresh.greenway.stores.find((candidate) => candidate.id === 'store-greenway')!
    const returned = { ...harvested.state, movementOwner: 'greenway' as const,
      player: { ...harvested.state.player, position: { ...store.position }, verticalVelocity: 0 } }
    const sold = advancePublicWorldFrame(returned,
      [{ type: 'sell_to_store', storeId: store.id, itemId: 'marsh_herb', quantity: 1 }])
    expect(sold.rejections).toEqual([])
    expect(sold.events).toMatchObject([{ type: 'store_item_sold', itemId: 'marsh_herb',
      quantity: 1, totalPrice: 3 }])
    expect(sold.state.player.coins).toBe(returned.player.coins + 3)
    expect(sold.state.player.inventory.some((stack) => stack.itemId === 'marsh_herb')).toBe(false)
    expect(isValidPublicWorldV7State(sold.state, null)).toBe(true)
    const replay = advancePublicWorldFrame(sold.state,
      [{ type: 'sell_to_store', storeId: store.id, itemId: 'marsh_herb', quantity: 1 }])
    expect(replay.rejections).toMatchObject([{ code: 'not_owned' }])
    expect(replay.state).toBe(sold.state)
  })
})
