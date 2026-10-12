import { describe, expect, it } from 'vitest'
import { highlandCorridorCells, highlandLandmark, highlandStoneNodes } from './highlandContent'
import { terrainHeightAt } from './generation'
import { actPublicV10Mireglass } from './publicWorldActions'
import { mireglassAnchors } from './mireglassContent'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import { mireglassRouteSites } from './mireglassRouteSites'
import { PUBLIC_RUN_STEP_METERS, PUBLIC_WALK_STEP_METERS, publicV11Gait } from './publicWorldGait'
import { createPublicV11RouteSupport } from './publicV11RouteSupport'
import { actPublicV11Highland, actPublicV11Mireglass, buyPublicV11Boots,
  advancePublicWorldV11Frame, applyFieldCampV11Action } from './publicWorldV11Authority'
import { advancePublicWorldV10Frame } from './publicWorldRuntime'
import { createFreshPublicWorld } from './publicWorldState'
import { parsePublicV10World, serializePublicV10World } from './publicWorldV10Snapshot'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { isValidPublicWorldV10State, withPublicV10TerrainRevision } from './publicWorldV10State'
import { decodePublicV11Head, encodePublicV11Head,
  parsePublicV11World, serializePublicV11World } from './publicWorldV11Snapshot'
import { isValidPublicWorldV11State, withPublicV11Highland } from './publicWorldV11State'
import type { PublicWorldV11State } from './publicWorldV11State'
import { createStreamedWorldFromState } from './streamedWorld'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const fresh = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
  withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1')))))
const node = highlandStoneNodes(seed)[0]
const camp = worldTileAtGrid(seed, -76, 100)

describe('public v11 footwear gait', () => {
  const move = (x: number) => [{ type: 'move' as const, delta: { x, z: 0 } }]
  const booted = (): PublicWorldV11State => ({ ...fresh, player: { ...fresh.player,
    inventory: [...fresh.player.inventory, { itemId: 'leather_boots', quantity: 1 }],
    equipment: { ...fresh.player.equipment, feet: 'leather_boots' } } })

  it('derives walk-only barefoot and waders, run-default boots, and requested walking', () => {
    expect(publicV11Gait(null, false)).toMatchObject({ pace: 'walk', canRun: false,
      metersPerStep: PUBLIC_WALK_STEP_METERS, reason: 'Barefoot: walk only' })
    expect(publicV11Gait('mireglass_reach/item/waders', false)).toMatchObject({ pace: 'walk',
      canRun: false, reason: 'Fen waders: walk only' })
    expect(publicV11Gait('leather_boots', false)).toMatchObject({ pace: 'run', canRun: true,
      metersPerStep: PUBLIC_RUN_STEP_METERS })
    expect(publicV11Gait('leather_boots', true)).toMatchObject({ pace: 'walk', canRun: true,
      metersPerStep: PUBLIC_WALK_STEP_METERS })
  })

  it('enforces the equipped pace before Greenway or streamed collision, without changing rejected state', () => {
    const rejectedBarefoot = advancePublicWorldV11Frame(fresh, move(0.24))
    expect(rejectedBarefoot.rejections).toMatchObject([{ code: 'invalid_value', intentType: 'move' }])
    expect(rejectedBarefoot.state).toBe(fresh)
    expect(rejectedBarefoot.events).toEqual([])
    expect(advancePublicWorldV11Frame(fresh, move(0.16)).rejections).toEqual([])
    const boots = booted()
    expect(isValidPublicWorldV11State(boots, null)).toBe(true)
    const running = advancePublicWorldV11Frame(boots, move(0.24))
    expect(running.rejections).toEqual([])
    expect(running.state.player.position.x - boots.player.position.x).toBeCloseTo(0.24)
    const chosenWalk = advancePublicWorldV11Frame(boots, move(0.24), null, true)
    expect(chosenWalk.rejections).toMatchObject([{ code: 'invalid_value', intentType: 'move' }])
    expect(chosenWalk.state).toBe(boots)
    expect(advancePublicWorldV11Frame(boots, move(0.16), null, true).rejections).toEqual([])
    const waders: PublicWorldV11State = { ...fresh, player: { ...fresh.player,
      inventory: [...fresh.player.inventory, { itemId: 'mireglass_reach/item/waders', quantity: 1 }],
      equipment: { ...fresh.player.equipment, feet: 'mireglass_reach/item/waders' } },
      mireglass: { ...fresh.mireglass, shopStock: {
        ...fresh.mireglass.shopStock, 'mireglass_reach/item/waders': 1 } } }
    expect(isValidPublicWorldV11State(waders, null)).toBe(true)
    expect(advancePublicWorldV11Frame(waders, move(0.24)).rejections)
      .toMatchObject([{ code: 'invalid_value' }])
  })

  it('sells one boot pair only from nearby Outfitters for 25g, then equips and saves it', () => {
    const store = fresh.greenway.stores.find((entry) => entry.id === 'store-greenway')!
    const near: PublicWorldV11State = { ...fresh, player: { ...fresh.player,
      position: { ...store.position } } }
    const original = JSON.stringify(near)
    const bought = buyPublicV11Boots(near, store.id)
    expect(bought.rejection).toBeUndefined()
    expect(bought.event).toMatchObject({ type: 'store_item_bought', itemId: 'leather_boots',
      price: 25, sequence: near.eventSequence + 1 })
    expect(bought.state.player.coins).toBe(near.player.coins - 25)
    expect(bought.state.player.inventory).toContainEqual({ itemId: 'leather_boots', quantity: 1 })
    expect(JSON.stringify(near)).toBe(original)
    expect(buyPublicV11Boots(bought.state, store.id)).toMatchObject({ state: bought.state,
      rejection: { message: 'You already own leather boots.' } })
    const equipped = advancePublicWorldV11Frame(bought.state,
      [{ type: 'equip_item', itemId: 'leather_boots', slot: 'feet' }])
    expect(equipped.rejections).toEqual([])
    expect(equipped.state.player.equipment.feet).toBe('leather_boots')
    expect(advancePublicWorldV11Frame(equipped.state,
      [{ type: 'equip_item', itemId: 'leather_boots', slot: 'feet' }]).rejections)
      .toMatchObject([{ code: 'invalid_value' }])
    expect(parsePublicV11World(serializePublicV11World(equipped.state, null, 1))?.state)
      .toEqual(equipped.state)
    expect(Object.keys(equipped.state).sort()).toEqual(Object.keys(near).sort())
  })

  it('rejects absent store, distance, low balance, and full bag without spending', () => {
    const store = fresh.greenway.stores.find((entry) => entry.id === 'store-greenway')!
    const near: PublicWorldV11State = { ...fresh, player: { ...fresh.player,
      position: { ...store.position } } }
    const cases: Array<[PublicWorldV11State, string]> = [
      [fresh, store.id],
      [near, 'store-not-outfitters'],
      [{ ...near, player: { ...near.player, coins: 24 } }, store.id],
      [{ ...near, player: { ...near.player,
        backpackCapacity: near.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0) } }, store.id],
    ]
    for (const [state, storeId] of cases) {
      const before = JSON.stringify(state)
      const result = buyPublicV11Boots(state, storeId)
      expect(result.rejection).toBeDefined()
      expect(result.state).toBe(state)
      expect(result.event).toBeUndefined()
      expect(JSON.stringify(state)).toBe(before)
    }
  })

  it('still blocks a booted run step into Highland ridge rock', () => {
    const gallery = worldTileAtGrid(seed, 145, -117)
    const atGallery = atMireglass(gallery.center, booted())
    const start = { ...atGallery, player: { ...atGallery.player,
      position: { ...atGallery.player.position, z: -469.95 } } }
    const blocked = advancePublicWorldV11Frame(start,
      [{ type: 'move', delta: { x: 0, z: -0.24 } }])
    expect(blocked.rejections).toMatchObject([{ code: 'ridge_rock' }])
    expect(blocked.state).toBe(start)
    expect(blocked.events).toEqual([])
  })

  it('keeps valid v10-owned boots unequippable in Mireglass while v11 opts in', () => {
    const owned = { ...fresh, player: { ...fresh.player,
      inventory: [...fresh.player.inventory, { itemId: 'leather_boots' as const, quantity: 1 }] } }
    const v11 = atMireglass(camp.center, owned)
    const { highland: _progress, highlandContentRevision: _revision, ...v10 } = v11
    expect(isValidPublicWorldV10State(v10, null)).toBe(true)
    expect(isValidPublicWorldV11State(v11, null)).toBe(true)
    const old = actPublicV10Mireglass(v10, { type: 'equip_item', itemId: 'leather_boots' })
    expect(old.rejection).toMatchObject({ code: 'invalid_value' })
    expect(old.state).toBe(v10)
    const current = actPublicV11Mireglass(v11, { type: 'equip_item', itemId: 'leather_boots' })
    expect(current.rejection).toBeUndefined()
    expect(current.event).toMatchObject({ type: 'item_equipped', itemId: 'leather_boots', slot: 'feet' })
    expect(current.state.player.equipment.feet).toBe('leather_boots')
  })

  it('unequips v11 boots in streamed terrain without losing the pair or changing older rules', () => {
    const wearing = atMireglass(camp.center, booted())
    const removed = actPublicV11Mireglass(wearing, { type: 'unequip_item', slot: 'feet' })
    expect(removed.rejection).toBeUndefined()
    expect(removed.event).toMatchObject({ type: 'item_unequipped', itemId: 'leather_boots',
      slot: 'feet', sequence: wearing.eventSequence + 1, tick: wearing.tick })
    expect(removed.state.player.equipment.feet).toBeNull()
    expect(removed.state.player.inventory).toContainEqual({ itemId: 'leather_boots', quantity: 1 })
    expect(publicV11Gait(removed.state.player.equipment.feet, false).pace).toBe('walk')
    expect(isValidPublicWorldV11State(removed.state, null)).toBe(true)
    expect(parsePublicV11World(serializePublicV11World(removed.state, null, 1))?.state).toEqual(removed.state)
    expect(actPublicV11Mireglass(removed.state, { type: 'unequip_item', slot: 'feet' }))
      .toMatchObject({ state: removed.state, rejection: { code: 'invalid_value' } })
    expect(actPublicV11Mireglass(booted(), { type: 'unequip_item', slot: 'feet' }))
      .toMatchObject({ rejection: { code: 'unavailable_here' } })
    const { highland: _progress, highlandContentRevision: _revision, ...v10 } = wearing
    expect(actPublicV10Mireglass(v10, { type: 'unequip_item', slot: 'feet' } as never).rejection)
      .toMatchObject({ code: 'invalid_value' })
  })
})

/** Geography fixtures now travel through legal 50 ms public steps. */
function walkV11(state: PublicWorldV11State, delta: { x: number; z: number }) {
  const count = Math.ceil(Math.hypot(delta.x, delta.z) / 0.16)
  const target = { x: state.player.position.x + delta.x, z: state.player.position.z + delta.z }
  const events: ReturnType<typeof advancePublicWorldV11Frame>['events'] = []
  let current = state
  for (let index = 0; index < count; index++) {
    const step = index === count - 1
      ? { x: target.x - current.player.position.x, z: target.z - current.player.position.z }
      : { x: delta.x / count, z: delta.z / count }
    const result = advancePublicWorldV11Frame(current, [{ type: 'move', delta: step }])
    if (result.rejections.length) return { ...result, events: [...events, ...result.events] }
    current = result.state
    events.push(...result.events)
  }
  return { state: current, events, rejections: [] as ReturnType<typeof advancePublicWorldV11Frame>['rejections'] }
}

function atMireglass(position: { x: number; y: number; z: number },
  state: PublicWorldV11State = fresh): PublicWorldV11State {
  const tile = worldTileAtGrid(seed, position.x / 4, position.z / 4)
  return { ...state, movementOwner: 'streamed',
    player: { ...state.player, position: { ...position }, verticalVelocity: 0 },
    discoveredTileIds: [...new Set([...state.discoveredTileIds, tile.id])].sort() }
}

function atQuarry(): PublicWorldV11State {
  return { ...fresh, movementOwner: 'streamed',
    player: { ...fresh.player, position: { ...node.tile.center }, xp: 40, level: 1,
      inventory: [...fresh.player.inventory, { itemId: 'field_spade', quantity: 1 }],
      equipment: { ...fresh.player.equipment, mainHand: 'field_spade' },
      skillXp: { ...fresh.player.skillXp, excavation: 30 } },
    discoveredTileIds: [...new Set([...fresh.discoveredTileIds, node.tile.id])].sort(),
    highland: { ...fresh.highland, landmarkDiscovered: true } }
}

describe('v11 walking over selected built routes', () => {
  it('rejects a forged mid-rise Slate pose above low ground but below ladder support in saves and rehydration', () => {
    const site = mireglassRouteSites(seed).find((candidate) => candidate.kind === 'ladder')!
    const ready = atMireglass(site.from, { ...fresh, player: { ...fresh.player,
      inventory: [...fresh.player.inventory, { itemId: 'logs', quantity: site.logCost }] } })
    const built = actPublicV11Mireglass(ready, { type: 'build_route', siteId: site.id })
    expect(built.rejection).toBeUndefined()
    const rising = walkV11(built.state, { x: 0, z: 1.76 })
    expect(rising.rejections).toEqual([])
    const lowGroundY = site.from.y
    expect(rising.state.player.position.y).toBeGreaterThan(lowGroundY + 0.1)
    const forged: PublicWorldV11State = { ...rising.state,
      player: { ...rising.state.player, position: { ...rising.state.player.position,
        y: lowGroundY + 0.1 } } }
    const resume = () => createStreamedWorldFromState({ seed: forged.seed, tick: forged.tick,
      player: { position: forged.player.position, yaw: forged.player.yaw,
        pitch: forged.player.pitch, verticalVelocity: forged.player.verticalVelocity },
      discoveredTileIds: forged.discoveredTileIds,
    }, { cachePitDug: forged.mireglass.cacheExcavated, highlandRidge: true,
      routeSupport: createPublicV11RouteSupport(forged) })
    expect(resume).toThrow('Invalid streamed-world snapshot position.')
    expect(isValidPublicWorldV11State(forged, null)).toBe(false)
    expect(() => encodePublicV11Head(forged, null, 1)).toThrow('Invalid public v11 world state.')
    const supportFloor = createPublicV11RouteSupport(rising.state)
      .at(rising.state.player.position)!.floorY
    const barelyBelow = { ...rising.state, player: { ...rising.state.player,
      position: { ...rising.state.player.position, y: supportFloor - 1e-9 } } }
    expect(isValidPublicWorldV11State(barelyBelow, null)).toBe(false)
    const validHead = encodePublicV11Head(rising.state, null, 1)
    const forgedHead = { ...validHead, state: { ...validHead.state, player: forged.player } }
    expect(decodePublicV11Head(forgedHead)).toBeNull()
  })

  it('walks the authored Greenway ladder and Highland bridge without opening unbuilt area seams', () => {
    const ladder = fresh.greenway.routes.find((route) => route.id === 'greenway_ladder')!
    const sourceTile = worldTileAtGrid(seed, 0, -1)
    const ready: PublicWorldV11State = { ...fresh,
      player: { ...fresh.player, position: { ...ladder.from }, xp: 40,
        inventory: [...fresh.player.inventory, { itemId: 'logs', quantity: 10 }] },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds, sourceTile.id])].sort() }
    expect(advancePublicWorldV11Frame(ready,
      [{ type: 'move', delta: { x: 0, z: -0.16 } }]).rejections)
      .toMatchObject([{ code: 'locked_area' }])
    const builtLadder = advancePublicWorldV11Frame(ready,
      [{ type: 'build_route', routeId: ladder.id, siteId: 'greenway_ladder:x:0' }])
    expect(builtLadder.rejections).toEqual([])
    const besideLadder: PublicWorldV11State = { ...builtLadder.state,
      player: { ...builtLadder.state.player,
        position: { ...builtLadder.state.player.position, x: ladder.from.x + 1.2 } } }
    expect(isValidPublicWorldV11State(besideLadder, null)).toBe(true)
    expect(advancePublicWorldV11Frame(besideLadder,
      [{ type: 'move', delta: { x: 0, z: -0.16 } }]).rejections)
      .toMatchObject([{ code: 'locked_area' }])
    const running: PublicWorldV11State = { ...builtLadder.state, player: { ...builtLadder.state.player,
      inventory: [...builtLadder.state.player.inventory, { itemId: 'leather_boots', quantity: 1 }],
      equipment: { ...builtLadder.state.player.equipment, feet: 'leather_boots' } } }
    expect(isValidPublicWorldV11State(running, null)).toBe(true)
    const runStep = advancePublicWorldV11Frame(running,
      [{ type: 'move', delta: { x: 0, z: -0.24 } }])
    expect(runStep.rejections).toEqual([])
    expect(runStep.state.player.position.z).toBeCloseTo(ladder.from.z - 0.24)
    expect(advancePublicWorldV11Frame(running,
      [{ type: 'move', delta: { x: 0, z: -0.24 } }], null, true).rejections)
      .toMatchObject([{ code: 'invalid_value' }])
    const toRidge = walkV11(builtLadder.state, { x: 0, z: -4 })
    expect(toRidge.rejections).toEqual([])
    expect(toRidge.state.player.position.z).toBeCloseTo(ladder.to.z)
    expect(toRidge.state.tick - builtLadder.state.tick).toBe(25)
    const fromRidge = walkV11(toRidge.state, { x: 0, z: 4 })
    expect(fromRidge.rejections).toEqual([])
    expect(fromRidge.state.player.position.z).toBeCloseTo(ladder.from.z)
    const { highland: _oldProgress, highlandContentRevision: _oldRevision, ...olderLadder } = builtLadder.state
    expect(advancePublicWorldV10Frame(olderLadder,
      [{ type: 'move', delta: { x: 0, z: -0.16 } }]).rejections)
      .toMatchObject([{ code: 'locked_area' }])

    const bridge = fresh.greenway.routes.find((route) => route.id === 'highland_bridge')!
    const bridgeSource = worldTileAtGrid(seed, 1, -2)
    const atBridge: PublicWorldV11State = { ...fromRidge.state,
      player: { ...fromRidge.state.player, position: { ...bridge.from } },
      discoveredTileIds: [...new Set([...fromRidge.state.discoveredTileIds, bridgeSource.id])].sort() }
    expect(isValidPublicWorldV11State(atBridge, null)).toBe(true)
    expect(advancePublicWorldV11Frame(atBridge,
      [{ type: 'move', delta: { x: 0.16, z: 0 } }]).rejections)
      .toMatchObject([{ code: 'locked_area' }])
    const builtBridge = advancePublicWorldV11Frame(atBridge,
      [{ type: 'build_route', routeId: bridge.id, siteId: 'highland_bridge:z:-8' }])
    expect(builtBridge.rejections).toEqual([])
    const toHighland = walkV11(builtBridge.state, { x: 2, z: 0 })
    expect(toHighland.rejections).toEqual([])
    expect(toHighland.state.player.position.x).toBeCloseTo(bridge.to.x)
    const fromHighland = walkV11(toHighland.state, { x: -2, z: 0 })
    expect(fromHighland.rejections).toEqual([])
    expect(fromHighland.state.player.position.x).toBeCloseTo(bridge.from.x)
    const { highland: _progress, highlandContentRevision: _revision, ...olderBridge } = builtBridge.state
    expect(advancePublicWorldV10Frame(olderBridge,
      [{ type: 'move', delta: { x: 0.16, z: 0 } }]).rejections)
      .toMatchObject([{ code: 'locked_area' }])
  })

  it.each(['bridge', 'ladder'] as const)('crosses the Mireglass %s by ordinary steps in both directions, with a mid-route save', (kind) => {
    const site = mireglassRouteSites(seed).find((candidate) => candidate.kind === kind)!
    const ready = atMireglass(site.from, { ...fresh, player: { ...fresh.player,
      inventory: [...fresh.player.inventory, { itemId: 'logs', quantity: site.logCost }] } })
    const unbuilt = walkV11(ready, { x: site.to.x - site.from.x, z: site.to.z - site.from.z })
    expect(unbuilt.rejections[0]?.code).toBe(kind === 'bridge' ? 'fen_channel' : 'slate_cliff')
    const built = actPublicV11Mireglass(ready, { type: 'build_route', siteId: site.id })
    expect(built.rejection).toBeUndefined()
    let current = built.state
    const midpoint = { x: (site.from.x + site.to.x) / 2,
      z: kind === 'ladder' ? site.from.z + 2.16 : (site.from.z + site.to.z) / 2 }
    const toMiddle = walkV11(current, { x: midpoint.x - current.player.position.x,
      z: midpoint.z - current.player.position.z })
    expect(toMiddle.rejections).toEqual([])
    current = toMiddle.state
    expect(current.player.position.x).toBeCloseTo(midpoint.x)
    expect(current.player.position.z).toBeCloseTo(midpoint.z)
    if (kind === 'ladder') {
      expect(current.player.position.y).toBeGreaterThan(site.from.y)
      expect(current.player.position.y).toBeLessThan(site.to.y)
      const { highland: _progress, highlandContentRevision: _revision, ...older } = current
      expect(isValidPublicWorldV10State(older, null)).toBe(false)
      expect(decodePublicV11Head(encodePublicV11Head(current, null, 1))?.state).toEqual(current)
      const belowSupport = { ...current, player: { ...current.player,
        position: { ...current.player.position, y: site.from.y } } }
      expect(isValidPublicWorldV11State(belowSupport, null)).toBe(false)
    }
    const loaded = parsePublicV11World(serializePublicV11World(current, null, 1))?.state
    expect(loaded).toEqual(current)
    const far = walkV11(loaded!, { x: site.to.x - midpoint.x, z: site.to.z - midpoint.z })
    expect(far.rejections).toEqual([])
    expect(far.state.player.position.x).toBeCloseTo(site.to.x)
    expect(far.state.player.position.z).toBeCloseTo(site.to.z)
    expect(far.state.player.position.y).toBeCloseTo(site.to.y)
    const returned = walkV11(far.state, { x: site.from.x - site.to.x, z: site.from.z - site.to.z })
    expect(returned.rejections).toEqual([])
    expect(returned.state.player.position.x).toBeCloseTo(site.from.x)
    expect(returned.state.player.position.z).toBeCloseTo(site.from.z)
    expect(returned.state.player.position.y).toBeCloseTo(site.from.y)
    expect([...toMiddle.events, ...far.events, ...returned.events]
      .filter((event) => event.type === 'player_moved').length).toBeGreaterThan(3)
  })

  it('keeps the fen and cliff closed at an unbuilt or other selected site, including diagonal escape', () => {
    for (const kind of ['bridge', 'ladder'] as const) {
      const sites = mireglassRouteSites(seed).filter((site) => site.kind === kind)
      const selected = sites[0]
      const other = sites[1]
      const ready = atMireglass(selected.from, { ...fresh, player: { ...fresh.player,
        inventory: [...fresh.player.inventory, { itemId: 'logs', quantity: selected.logCost }] } })
      const built = actPublicV11Mireglass(ready, { type: 'build_route', siteId: selected.id })
      expect(built.rejection).toBeUndefined()
      const wrong = walkV11(atMireglass(other.from, built.state),
        { x: other.to.x - other.from.x, z: other.to.z - other.from.z })
      expect(wrong.rejections[0]?.code).toBe(kind === 'bridge' ? 'fen_channel' : 'slate_cliff')
      const atBuilt = built.state
      const halfway = walkV11(atBuilt, { x: 0, z: kind === 'bridge' ? 4 : 1.6 })
      expect(halfway.rejections).toEqual([])
      const offDeck = walkV11(halfway.state, { x: 1.6, z: kind === 'bridge' ? 1.6 : 0.8 })
      expect(offDeck.rejections[0]?.code).toBe(kind === 'bridge' ? 'fen_channel' : 'slate_cliff')
    }
  })
})

describe('public v11 Highland authority', () => {
  it('accepts a canonical quarry node exactly once per cooldown and awards one event', () => {
    const ready = atQuarry()
    expect(isValidPublicWorldV11State(ready, null)).toBe(true)
    const original = JSON.stringify(ready)
    const mined = actPublicV11Highland(ready, { type: 'extract_highland_stone', nodeId: node.id })
    expect(mined.rejection).toBeUndefined()
    if (mined.rejection) return
    expect(mined.event).toMatchObject({ type: 'highland_stone_extracted', nodeId: node.id,
      itemId: 'stone', quantity: 2, xp: 20, sequence: ready.eventSequence + 1, tick: ready.tick })
    expect(mined.state.tick).toBe(ready.tick)
    expect(mined.state.rng).toBe(ready.rng)
    expect(mined.state.player.inventory).toContainEqual({ itemId: 'stone', quantity: 2 })
    expect(mined.state.player.xp).toBe(60)
    expect(mined.state.player.skillXp.excavation).toBe(50)
    expect(mined.state.highland.stoneNodes.find(({ id }) => id === node.id)?.readyAtTick).toBe(3000)
    expect(isValidPublicWorldV11State(mined.state, null)).toBe(true)
    expect(JSON.stringify(ready)).toBe(original)
    const duplicate = actPublicV11Highland(mined.state, { type: 'extract_highland_stone', nodeId: node.id })
    expect(duplicate.state).toBe(mined.state)
    expect(duplicate.rejection?.code).toBe('recovering')
    const recovered = actPublicV11Highland({ ...mined.state, tick: 3000 },
      { type: 'extract_highland_stone', nodeId: node.id })
    expect(recovered.rejection).toBeUndefined()
    expect(recovered.state.player.inventory).toContainEqual({ itemId: 'stone', quantity: 4 })
  })

  it('awards exactly two stone with duplicate valid stacks and enforces total capacity', () => {
    const base = atQuarry()
    const duplicate: PublicWorldV11State = { ...base, player: { ...base.player,
      inventory: [...base.player.inventory,
        { itemId: 'stone', quantity: 1 }, { itemId: 'stone', quantity: 2 }] } }
    expect(isValidPublicWorldV11State(duplicate, null)).toBe(true)
    const before = duplicate.player.inventory
      .filter(({ itemId }) => itemId === 'stone').reduce((sum, stack) => sum + stack.quantity, 0)
    const mined = actPublicV11Highland(duplicate, { type: 'extract_highland_stone', nodeId: node.id })
    expect(mined.rejection).toBeUndefined()
    expect(mined.event?.quantity).toBe(2)
    expect(mined.state.player.inventory.filter(({ itemId }) => itemId === 'stone'))
      .toEqual([{ itemId: 'stone', quantity: 3 }, { itemId: 'stone', quantity: 2 }])
    const after = mined.state.player.inventory
      .filter(({ itemId }) => itemId === 'stone').reduce((sum, stack) => sum + stack.quantity, 0)
    expect(after - before).toBe(2)
    expect(duplicate.player.inventory.filter(({ itemId }) => itemId === 'stone'))
      .toEqual([{ itemId: 'stone', quantity: 1 }, { itemId: 'stone', quantity: 2 }])
    expect(isValidPublicWorldV11State(mined.state, null)).toBe(true)

    const full: PublicWorldV11State = { ...duplicate, player: { ...duplicate.player,
      backpackCapacity: duplicate.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0) + 1 } }
    expect(isValidPublicWorldV11State(full, null)).toBe(true)
    const rejected = actPublicV11Highland(full, { type: 'extract_highland_stone', nodeId: node.id })
    expect(rejected.rejection?.code).toBe('capacity')
    expect(rejected.state).toBe(full)
    expect(rejected.event).toBeUndefined()
  })

  it('rejects invalid nodes, hidden sites, range, tool, skill, capacity and overflow without mutation', () => {
    const ready = atQuarry()
    const cases: Array<[PublicWorldV11State, string, string]> = [
      [ready, 'made-up-node', 'not_found'],
      [{ ...ready, highland: { ...ready.highland, landmarkDiscovered: false } }, node.id, 'undiscovered'],
      [{ ...ready, discoveredTileIds: ready.discoveredTileIds.filter((id) => id !== node.tile.id) }, node.id, 'invalid_progress'],
      [{ ...ready, player: { ...ready.player,
        position: { x: node.tile.center.x - 2.5,
          y: Math.max(node.tile.center.y,
            worldTileAtGrid(seed, node.tile.center.x / 4 - 1, node.tile.center.z / 4).center.y),
          z: node.tile.center.z } },
        discoveredTileIds: [...new Set([...ready.discoveredTileIds.filter((id) => id !== node.tile.id),
          worldTileAtGrid(seed, node.tile.center.x / 4 - 1, node.tile.center.z / 4).id])].sort() },
      node.id, 'undiscovered'],
      [{ ...ready, player: { ...ready.player, position: { ...highlandLandmark(seed).tile.center } },
        discoveredTileIds: [...new Set([...ready.discoveredTileIds, highlandLandmark(seed).tile.id])].sort() }, node.id, 'too_far'],
      [{ ...ready, player: { ...ready.player,
        equipment: { ...ready.player.equipment, mainHand: null } } }, node.id, 'requires_spade'],
      [{ ...ready, player: { ...ready.player,
        inventory: ready.player.inventory.filter((stack) => stack.itemId !== 'field_spade'),
        equipment: { ...ready.player.equipment, mainHand: null } } }, node.id, 'requires_spade'],
      [{ ...ready, player: { ...ready.player, skillXp: { ...ready.player.skillXp, excavation: 29 } } }, node.id, 'skill_locked'],
      [{ ...ready, player: { ...ready.player, backpackCapacity: 2 } }, node.id, 'capacity'],
      [{ ...ready, tick: Number.MAX_SAFE_INTEGER - 2999 }, node.id, 'invalid_value'],
    ]
    for (const [state, nodeId, code] of cases) {
      const before = JSON.stringify(state)
      const result = actPublicV11Highland(state, { type: 'extract_highland_stone', nodeId })
      expect(result.rejection?.code).toBe(code)
      expect(result.state).toBe(state)
      expect(result.event).toBeUndefined()
      expect(JSON.stringify(state)).toBe(before)
    }
  })

  it.each([
    ['greenway-alpha', 'east', 12, 0, 4, 0],
    ['wizard-realms', 'east', 12, 0, 4, 0],
    ['greenway-alpha', 'south', 8, 12, 0, 4],
    ['wizard-realms', 'south', 8, 12, 0, 4],
  ] as const)('crosses for %s through the dry %s seam in v10 and v11 with save and return',
    (worldSeed, _edge, x, z, dx, dz) => {
    const seedFresh = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
      withFreshPublicV7Herbs(createFreshPublicWorld(worldSeed, 'greenway-classic-v1')))))
    const edge = worldTileAtGrid(worldSeed, x / 4, z / 4)
    const start = { ...seedFresh, player: { ...seedFresh.player,
      position: { x, y: terrainHeightAt(seedFresh.greenway.tiles, x, z), z } },
      discoveredTileIds: [...new Set([...seedFresh.discoveredTileIds, edge.id])].sort() }
    const step = [{ type: 'move' as const, delta: { x: dx, z: dz } }]
    const reverse = [{ type: 'move' as const, delta: { x: -dx, z: -dz } }]
    expect(isValidPublicWorldV11State(start, null)).toBe(true)
    const crossed = walkV11(start, step[0].delta)
    expect(crossed.rejections).toEqual([])
    expect(crossed.state.movementOwner).toBe('streamed')
    expect(crossed.state.player.position).toMatchObject({ x: x + dx, z: z + dz })
    expect(crossed.state.discoveredTileIds).toContain(worldTileAtGrid(worldSeed,
      (x + dx) / 4, (z + dz) / 4).id)
    expect(parsePublicV11World(serializePublicV11World(crossed.state, null, 1))?.state).toEqual(crossed.state)
    const back = walkV11(crossed.state, reverse[0].delta)
    expect(back.rejections).toEqual([])
    expect(back.state.movementOwner).toBe('greenway')
    expect(back.state.player.position).toMatchObject({ x, z })
    expect(back.state.tick).toBe(crossed.state.tick + 25)
    expect(isValidPublicWorldV11State(back.state, null)).toBe(true)
    expect(parsePublicV11World(serializePublicV11World(back.state, null, 2))?.state).toEqual(back.state)
    const { highland: _h, highlandContentRevision: _r, ...v10 } = start
    const older = advancePublicWorldV10Frame(v10, step)
    expect(older.rejections).toEqual([])
    expect(older.state.movementOwner).toBe('streamed')
    expect(older.state.player.position).toMatchObject({ x: x + dx, z: z + dz })
    expect(parsePublicV10World(serializePublicV10World(older.state, null, 1))?.state).toEqual(older.state)
    const olderReturn = advancePublicWorldV10Frame(older.state, reverse)
    expect(olderReturn.rejections).toEqual([])
    expect(olderReturn.state.movementOwner).toBe('greenway')
    expect(olderReturn.state.player.position).toMatchObject({ x, z })
    expect(parsePublicV10World(serializePublicV10World(olderReturn.state, null, 2))?.state)
      .toEqual(olderReturn.state)
  })

  it('crosses the expanded 34-to-36 seam and returns without changing ownership twice', () => {
    const expanded = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
      withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-expanded-v1')))))
    const edge = worldTileAtGrid(seed, 8, 0)
    const start = { ...expanded, player: { ...expanded.player,
      position: { x: 34, y: terrainHeightAt(expanded.greenway.tiles, 34, 0), z: 0 } },
      discoveredTileIds: [...new Set([...expanded.discoveredTileIds, edge.id])].sort() }
    expect(isValidPublicWorldV11State(start, null)).toBe(true)
    const outbound = walkV11(start, { x: 2, z: 0 })
    expect(outbound.rejections).toEqual([])
    expect(outbound.state.movementOwner).toBe('streamed')
    expect(outbound.state.player.position.x).toBe(36)
    const inbound = walkV11(outbound.state, { x: -2, z: 0 })
    expect(inbound.rejections).toEqual([])
    expect(inbound.state.movementOwner).toBe('greenway')
    expect(inbound.state.player.position.x).toBe(34)
    expect(inbound.state.tick).toBe(start.tick + 26)
  })

  it('preserves the west crossing and permits a dry east crossing away from its marker', () => {
    const westTile = worldTileAtGrid(seed, -3, 0)
    const westStart: PublicWorldV11State = { ...fresh,
      player: { ...fresh.player, position: { x: -12,
        y: terrainHeightAt(fresh.greenway.tiles, -12, 0), z: 0 } },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds, westTile.id])].sort() }
    const { highland: _h, highlandContentRevision: _r, ...v10 } = westStart
    const westMove = [{ type: 'move' as const, delta: { x: -4, z: 0 } }]
    const old = advancePublicWorldV10Frame(v10, westMove)
    const newer = walkV11(westStart, westMove[0].delta)
    expect(newer.rejections).toEqual(old.rejections)
    expect(newer.state.movementOwner).toBe(old.state.movementOwner)
    expect(newer.state.player.position).toEqual(old.state.player.position)
    const westReturn = [{ type: 'move' as const, delta: { x: 4, z: 0 } }]
    const oldBack = advancePublicWorldV10Frame(old.state, westReturn)
    const newerBack = walkV11(newer.state, westReturn[0].delta)
    expect(oldBack.rejections).toEqual([])
    expect(newerBack.rejections).toEqual([])
    expect(oldBack.state.movementOwner).toBe('greenway')
    expect(newerBack.state.movementOwner).toBe('greenway')
    expect(newerBack.state.player.position).toMatchObject({
      x: oldBack.state.player.position.x, z: oldBack.state.player.position.z })

    const eastTile = worldTileAtGrid(seed, 3, 1)
    const offRoute: PublicWorldV11State = { ...fresh,
      player: { ...fresh.player, position: { x: 12,
        y: terrainHeightAt(fresh.greenway.tiles, 12, 4), z: 4 } },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds, eastTile.id])].sort() }
    const crossed = walkV11(offRoute, { x: 4, z: 0 })
    expect(crossed.rejections).toEqual([])
    expect(crossed.state.movementOwner).toBe('streamed')
    expect(crossed.state.player.position).toMatchObject({ x: 16, z: 4 })
    const returned = walkV11(crossed.state, { x: -4, z: 0 })
    expect(returned.rejections).toEqual([])
    expect(returned.state.movementOwner).toBe('greenway')
    expect(returned.state.player.position).toMatchObject({ x: 12, z: 4 })
  })

  it('returns through the northern perimeter after building and traversing the authored ladder', () => {
    const siteId = 'greenway_ladder:x:0'
    const source = fresh.greenway.routes.find((route) => route.id === 'greenway_ladder')!.from
    const sourceTile = worldTileAtGrid(seed, 0, -1)
    const ready: PublicWorldV11State = { ...fresh,
      player: { ...fresh.player, position: { ...source },
        inventory: [...fresh.player.inventory, { itemId: 'logs', quantity: 4 }] },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds, sourceTile.id])].sort() }
    const built = advancePublicWorldV11Frame(ready,
      [{ type: 'build_route', routeId: 'greenway_ladder', siteId }])
    expect(built.rejections).toEqual([])
    expect(built.events[0]).toMatchObject({ type: 'route_built', routeId: 'greenway_ladder', siteId })
    const traversed = advancePublicWorldV11Frame(built.state,
      [{ type: 'traverse_route', routeId: 'greenway_ladder' }])
    expect(traversed.rejections).toEqual([])
    expect(traversed.state.player.position).toMatchObject({ x: 0, z: -8 })
    const atEdge = walkV11(traversed.state, { x: 0, z: -4 })
    expect(atEdge.rejections).toEqual([])
    const out = walkV11(atEdge.state, { x: 0, z: -4 })
    expect(out.rejections).toEqual([])
    expect(out.state.movementOwner).toBe('streamed')
    const back = walkV11(out.state, { x: 0, z: 4 })
    expect(back.rejections).toEqual([])
    expect(back.state.movementOwner).toBe('greenway')
    expect(back.state.player.position).toMatchObject({ x: 0, z: -12 })
    expect(back.state.greenway.builtRouteIds).toContain('greenway_ladder')
    expect(isValidPublicWorldV11State(back.state, null)).toBe(true)

    const { highland: _progress, highlandContentRevision: _revision, ...v10Ready } = ready
    const olderBuilt = advancePublicWorldV10Frame(v10Ready,
      [{ type: 'build_route', routeId: 'greenway_ladder', siteId }])
    expect(olderBuilt.rejections).toEqual([])
    const olderTraversed = advancePublicWorldV10Frame(olderBuilt.state,
      [{ type: 'traverse_route', routeId: 'greenway_ladder' }])
    expect(olderTraversed.rejections).toEqual([])
    const olderEdge = advancePublicWorldV10Frame(olderTraversed.state,
      [{ type: 'move', delta: { x: 0, z: -4 } }])
    expect(olderEdge.rejections).toEqual([])
    const olderOut = advancePublicWorldV10Frame(olderEdge.state,
      [{ type: 'move', delta: { x: 0, z: -4 } }])
    expect(olderOut.rejections).toEqual([])
    expect(olderOut.state.movementOwner).toBe('streamed')
    const olderBack = advancePublicWorldV10Frame(olderOut.state,
      [{ type: 'move', delta: { x: 0, z: 4 } }])
    expect(olderBack.rejections).toEqual([])
    expect(olderBack.state.movementOwner).toBe('greenway')
    expect(olderBack.state.player.position).toMatchObject({ x: 0, z: -12 })
    expect(olderBack.state.greenway.builtRouteIds).toContain('greenway_ladder')
  })

  it('rejects a wetland perimeter move atomically in v10 and v11', () => {
    const sourceTile = worldTileAtGrid(seed, 0, 3)
    expect(worldTileAtGrid(seed, 0, 4).terrain).toBe('wetland')
    const start: PublicWorldV11State = { ...fresh,
      player: { ...fresh.player, position: { x: 0,
        y: terrainHeightAt(fresh.greenway.tiles, 0, 12), z: 12 } },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds, sourceTile.id])].sort() }
    const intents = [{ type: 'look' as const, yawDelta: 0.1, pitchDelta: 0 },
      { type: 'move' as const, delta: { x: 0, z: 0.16 } }]
    const blocked = advancePublicWorldV11Frame(start, intents)
    expect(blocked.rejections).toMatchObject([{ code: 'terrain_missing', intentIndex: 1 }])
    expect(blocked.state).toBe(start)
    expect(blocked.events).toEqual([])
    const { highland: _progress, highlandContentRevision: _revision, ...v10 } = start
    const older = advancePublicWorldV10Frame(v10, [{ ...intents[0] },
      { type: 'move', delta: { x: 0, z: 4 } }])
    expect(older.rejections).toMatchObject([{ code: 'terrain_missing', intentIndex: 1 }])
    expect(older.state).toBe(v10)
    expect(older.events).toEqual([])
  })

  it('keeps a world-boundary step atomic in v10 and v11', () => {
    const baseEdge = atMireglass(worldTileAtGrid(seed, -256, 0).center)
    const edge = { ...baseEdge, player: { ...baseEdge.player,
      position: { ...baseEdge.player.position, x: -1025.99 } } }
    const step = [{ type: 'move' as const, delta: { x: -0.16, z: 0 } }]
    const blocked = advancePublicWorldV11Frame(edge, step)
    expect(blocked.rejections).toMatchObject([{ code: 'out_of_bounds' }])
    expect(blocked.state).toBe(edge)
    expect(blocked.events).toEqual([])
    const { highland: _progress, highlandContentRevision: _revision, ...v10 } = edge
    const older = advancePublicWorldV10Frame(v10,
      [{ type: 'move', delta: { x: -4, z: 0 } }])
    expect(older.rejections).toMatchObject([{ code: 'out_of_bounds' }])
    expect(older.state).toBe(v10)
    expect(older.events).toEqual([])
  })

  it('blocks Highland rock only in v11 while allowing gallery travel and v10 movement', () => {
    const gallery = worldTileAtGrid(seed, 145, -117)
    const start = atMireglass(gallery.center)
    const edgeStart = { ...start, player: { ...start.player,
      position: { ...start.player.position, z: -469.95 } } }
    const intoRock = [{ type: 'move' as const, delta: { x: 0, z: -0.16 } }]
    expect(isValidPublicWorldV11State(start, null)).toBe(true)
    expect(isValidPublicWorldV11State(edgeStart, null)).toBe(true)
    const blocked = advancePublicWorldV11Frame(edgeStart, intoRock)
    expect(blocked.rejections).toMatchObject([{ code: 'ridge_rock' }])
    expect(blocked.state).toBe(edgeStart)
    expect(blocked.events).toEqual([])

    const alongGallery = walkV11(start, { x: 4, z: 0 })
    expect(alongGallery.rejections).toEqual([])
    expect(alongGallery.state.player.position).toMatchObject({ x: 584, z: -468 })

    const { highland: _progress, highlandContentRevision: _revision, ...v10 } = start
    const older = advancePublicWorldV10Frame(v10,
      [{ type: 'move', delta: { x: 0, z: -4 } }])
    expect(older.rejections).toEqual([])
    expect(older.state.player.position).toMatchObject({ x: 580, z: -472 })
  })

  it('lets a v11 save already inside new rock escape and blocks re-entry', () => {
    const rock = worldTileAtGrid(seed, 145, -118)
    const saved = atMireglass(rock.center)
    expect(isValidPublicWorldV11State(saved, null)).toBe(true)
    const escaped = walkV11(saved, { x: 0, z: 4 })
    expect(escaped.rejections).toEqual([])
    expect(escaped.state.player.position).toMatchObject({ x: 580, z: -468 })
    const reentered = walkV11(escaped.state, { x: 0, z: -4 })
    expect(reentered.rejections).toMatchObject([{ code: 'ridge_rock' }])
    expect(reentered.state.player.position.z).toBeGreaterThan(-470)
  })

  it.each(['greenway-alpha', 'wizard-realms'])('walks the pinned route both ways for %s', (worldSeed) => {
    const seeded = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
      withFreshPublicV7Herbs(createFreshPublicWorld(worldSeed, 'greenway-classic-v1')))))
    const startTile = worldTileAtGrid(worldSeed, 3, 0)
    let state: PublicWorldV11State = { ...seeded,
      player: { ...seeded.player, position: {
        x: 12, y: terrainHeightAt(seeded.greenway.tiles, 12, 0), z: 0 } },
      discoveredTileIds: [...new Set([...seeded.discoveredTileIds, startTile.id])].sort() }
    const route = highlandCorridorCells()
    expect(route[0]).toEqual({ x: 12, z: 0 })
    for (let i = 1; i < route.length; i++) {
      const from = route[i - 1]
      const to = route[i]
      const frame = walkV11(state, { x: to.x - from.x, z: to.z - from.z })
      expect(frame.rejections, `outbound cell ${i}`).toEqual([])
      state = frame.state
      expect(state.player.position.x).toBe(to.x)
      expect(state.player.position.z).toBe(to.z)
      expect(state.movementOwner).toBe('streamed')
      if (i % 64 === 0) expect(isValidPublicWorldV11State(state, null)).toBe(true)
    }
    expect(state.highland.landmarkDiscovered).toBe(true)
    for (let i = route.length - 2; i >= 0; i--) {
      const from = route[i + 1]
      const to = route[i]
      const frame = walkV11(state, { x: to.x - from.x, z: to.z - from.z })
      expect(frame.rejections, `inbound cell ${i}`).toEqual([])
      state = frame.state
    }
    expect(state.player.position.x).toBe(12)
    expect(state.player.position.z).toBe(0)
    expect(state.movementOwner).toBe('greenway')
    expect(state.tick).toBe(seeded.tick + 50 * (route.length - 1))
  })

  it('discovers the landmark only after walking into range, once, without a second player clock', () => {
    const landmark = highlandLandmark(seed)
    const west = { ...fresh, movementOwner: 'streamed' as const,
      player: { ...fresh.player, position: { ...landmark.tile.center, x: 452 } },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds,
        landmark.tile.id, `tile-${452 / 4 + 3}-${-432 / 4 + 3}`])].sort() }
    expect(isValidPublicWorldV11State(west, null)).toBe(true)
    const approach = walkV11(west, { x: 4, z: 0 })
    expect(approach.rejections).toEqual([])
    expect(approach.state.highland.landmarkDiscovered).toBe(true)
    expect(approach.events.at(-1)).toMatchObject({ type: 'highland_landmark_discovered',
      landmarkId: landmark.id, sequence: approach.state.eventSequence, tick: approach.state.tick })
    expect(approach.state.tick).toBe(west.tick + 25)
    const again = walkV11(approach.state, { x: 1, z: 0 })
    expect(again.rejections).toEqual([])
    expect(again.events.filter((event) => event.type === 'highland_landmark_discovered')).toEqual([])
  })

  it('uses detached movement and a single intent snapshot when a caller getter mutates its state', () => {
    const landmark = highlandLandmark(seed)
    const startTile = worldTileAtGrid(seed, 456 / 4, -432 / 4)
    const source: PublicWorldV11State = { ...fresh, movementOwner: 'streamed',
      player: { ...fresh.player, position: { x: 455.84, y: startTile.center.y, z: -432 } },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds, startTile.id])].sort() }
    expect(isValidPublicWorldV11State(source, null)).toBe(true)
    let getterReads = 0
    const delta = { z: 0 } as { x: number; z: number }
    Object.defineProperty(delta, 'x', { enumerable: true, get() {
      getterReads += 1
      source.player.position.x = 456
      return getterReads === 1 ? 0.16 : 0
    } })
    const moved = advancePublicWorldV11Frame(source, [{ type: 'move', delta }])
    expect(moved.rejections).toEqual([])
    expect(getterReads).toBe(1)
    expect(moved.state.player.position.x).toBe(456)
    expect(moved.state.highland.landmarkDiscovered).toBe(true)
    expect(moved.events.at(-1)).toMatchObject({ type: 'highland_landmark_discovered',
      landmarkId: landmark.id, sequence: moved.state.eventSequence })
    expect(isValidPublicWorldV11State(moved.state, null)).toBe(true)
  })

  it('keeps v11 quarry progress while building and traversing a Mireglass bridge and foraging', () => {
    const bridge = mireglassRouteSites(seed).find(({ kind }) => kind === 'bridge')!
    const progressed: PublicWorldV11State = { ...fresh, highland: { landmarkDiscovered: true,
      stoneNodes: fresh.highland.stoneNodes.map((entry, index) => index === 0
        ? { ...entry, readyAtTick: 3000 } : entry) } }
    const ready = atMireglass(bridge.from, { ...progressed,
      player: { ...progressed.player,
        inventory: [...progressed.player.inventory, { itemId: 'logs', quantity: 8 }] } })
    expect(isValidPublicWorldV11State(ready, null)).toBe(true)
    const built = actPublicV11Mireglass(ready, { type: 'build_route', siteId: bridge.id })
    expect(built.rejection).toBeUndefined()
    expect(built.event).toMatchObject({ type: 'route_built', sequence: ready.eventSequence + 1 })
    expect(built.state.highland).toBe(ready.highland)
    expect(built.state.mireglass.builtRoutes.bridge).toBe(bridge.id)
    const crossed = actPublicV11Mireglass(built.state,
      { type: 'traverse_route', siteId: bridge.id, from: 'from' })
    expect(crossed.rejection).toBeUndefined()
    expect(crossed.state.player.position).toEqual(bridge.to)
    expect(crossed.state.highland).toBe(ready.highland)
    expect(isValidPublicWorldV11State(crossed.state, null)).toBe(true)

    const patch = mireglassHerbPatches(seed)[0]
    const atPatch = atMireglass(patch.tile.center, crossed.state)
    const foraged = actPublicV11Mireglass(atPatch, { type: 'forage_herb', patchId: patch.id })
    expect(foraged.rejection).toBeUndefined()
    expect(foraged.event).toMatchObject({ type: 'herb_foraged', sequence: atPatch.eventSequence + 1 })
    expect(foraged.state.player.inventory).toContainEqual({ itemId: 'marsh_herb', quantity: 1 })
    expect(foraged.state.highland).toBe(ready.highland)
    expect(isValidPublicWorldV11State(foraged.state, null)).toBe(true)
  })

  it('preserves cache terrain and quarry progress through v11 camp placement', () => {
    const cache = mireglassAnchors(seed).sealCache.tile
    const prepared: PublicWorldV11State = atMireglass(cache.center, { ...fresh,
      player: { ...fresh.player, xp: 40, level: 1,
        inventory: [...fresh.player.inventory, { itemId: 'field_spade', quantity: 1 }],
        equipment: { ...fresh.player.equipment, mainHand: 'field_spade' },
        learnedSpellIds: ['wayfinder_glow'],
        skillXp: { ...fresh.player.skillXp, wayfinding: 10, spellcraft: 10, excavation: 30 } },
      mireglass: { ...fresh.mireglass, fringeMarkerStudied: true, cacheRevealed: true },
      highland: { ...fresh.highland, landmarkDiscovered: true } })
    expect(isValidPublicWorldV11State(prepared, null)).toBe(true)
    const dug = actPublicV11Mireglass(prepared, { type: 'excavate_cache' })
    expect(dug.rejection).toBeUndefined()
    expect(dug.state.mireglass.cacheExcavated).toBe(true)
    expect(dug.state.highland).toBe(prepared.highland)
    let landed = dug.state
    for (let i = 0; i < 60 && landed.player.position.y > 1.65; i++) {
      landed = advancePublicWorldV11Frame(landed, []).state
    }
    expect(landed.player.position.y).toBe(1.65)
    const onCamp = atMireglass(camp.center, { ...landed,
      player: { ...landed.player, inventory: [...landed.player.inventory,
        { itemId: 'logs', quantity: 4 }, { itemId: 'stone', quantity: 1 }] } })
    const placed = applyFieldCampV11Action(onCamp, camp.id)
    expect(placed.rejection).toBeUndefined()
    expect(placed.event).toMatchObject({ type: 'field_camp_placed',
      sequence: onCamp.eventSequence + 1 })
    expect(placed.state.fieldCampTileIds).toEqual([camp.id])
    expect(placed.state.mireglass.cacheExcavated).toBe(true)
    expect(placed.state.highland).toBe(onCamp.highland)
    expect(isValidPublicWorldV11State(placed.state, null)).toBe(true)
    const replay = applyFieldCampV11Action(placed.state, camp.id)
    expect(replay.rejection?.code).toBe('already_built')
    expect(replay.state).toBe(placed.state)
  })

  it('keeps rejected legacy actions and malformed v11 state atomic', () => {
    const misplaced = atQuarry()
    const patch = mireglassHerbPatches(seed)[0]
    const tooFar = actPublicV11Mireglass(misplaced, { type: 'forage_herb', patchId: patch.id })
    expect(tooFar.rejection?.code).toBe('too_far')
    expect(tooFar.state).toBe(misplaced)
    expect(tooFar.event).toBeUndefined()
    const badCamp = applyFieldCampV11Action(misplaced, node.tile.id)
    expect(badCamp.rejection?.code).toBe('invalid_site')
    expect(badCamp.state).toBe(misplaced)
    const malformed = { ...misplaced, highlandContentRevision: 'wrong' } as unknown as PublicWorldV11State
    expect(actPublicV11Mireglass(malformed, { type: 'forage_herb', patchId: patch.id }))
      .toMatchObject({ state: malformed, rejection: { code: 'invalid_progress' } })
    expect(applyFieldCampV11Action(malformed, camp.id))
      .toMatchObject({ state: malformed, rejection: { code: 'invalid_progress' } })
  })
})
