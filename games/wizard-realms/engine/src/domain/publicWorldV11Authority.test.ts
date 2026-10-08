import { describe, expect, it } from 'vitest'
import { highlandCorridorCells, highlandLandmark, highlandStoneNodes } from './highlandContent'
import { terrainHeightAt } from './generation'
import { mireglassAnchors } from './mireglassContent'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import { mireglassRouteSites } from './mireglassRouteSites'
import { actPublicV11Highland, actPublicV11Mireglass,
  advancePublicWorldV11Frame, applyFieldCampV11Action } from './publicWorldV11Authority'
import { advancePublicWorldV10Frame } from './publicWorldRuntime'
import { createFreshPublicWorld } from './publicWorldState'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { isValidPublicWorldV11State, withPublicV11Highland } from './publicWorldV11State'
import type { PublicWorldV11State } from './publicWorldV11State'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const fresh = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
  withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1')))))
const node = highlandStoneNodes(seed)[0]
const camp = worldTileAtGrid(seed, -76, 100)

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

  it.each(['greenway-alpha', 'wizard-realms'])('permits the east seam for %s but leaves v10 west-only', (worldSeed) => {
    const seedFresh = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
      withFreshPublicV7Herbs(createFreshPublicWorld(worldSeed, 'greenway-classic-v1')))))
    const edge = worldTileAtGrid(worldSeed, 3, 0)
    const eastern = { ...seedFresh, player: { ...seedFresh.player,
      position: { x: 12, y: terrainHeightAt(seedFresh.greenway.tiles, 12, 0), z: 0 } },
      discoveredTileIds: [...new Set([...seedFresh.discoveredTileIds, edge.id])].sort() }
    const step = [{ type: 'move' as const, delta: { x: 4, z: 0 } }]
    expect(isValidPublicWorldV11State(eastern, null)).toBe(true)
    const crossed = advancePublicWorldV11Frame(eastern, step)
    expect(crossed.rejections).toEqual([])
    expect(crossed.state.movementOwner).toBe('streamed')
    expect(crossed.state.player.position.x).toBe(16)
    expect(crossed.state.tick).toBe(eastern.tick + 1)
    const back = advancePublicWorldV11Frame(crossed.state,
      [{ type: 'move', delta: { x: -4, z: 0 } }])
    expect(back.rejections).toEqual([])
    expect(back.state.movementOwner).toBe('greenway')
    expect(back.state.player.position.x).toBe(12)
    expect(back.state.tick).toBe(crossed.state.tick + 1)
    expect(isValidPublicWorldV11State(back.state, null)).toBe(true)
    const { highland: _h, highlandContentRevision: _r, ...v10 } = eastern
    expect(advancePublicWorldV10Frame(v10, step).rejections).toMatchObject([{ code: 'off_connector' }])
  })

  it('crosses the expanded 34-to-36 seam and returns without changing ownership twice', () => {
    const expanded = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
      withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-expanded-v1')))))
    const edge = worldTileAtGrid(seed, 8, 0)
    const start = { ...expanded, player: { ...expanded.player,
      position: { x: 34, y: terrainHeightAt(expanded.greenway.tiles, 34, 0), z: 0 } },
      discoveredTileIds: [...new Set([...expanded.discoveredTileIds, edge.id])].sort() }
    expect(isValidPublicWorldV11State(start, null)).toBe(true)
    const outbound = advancePublicWorldV11Frame(start, [{ type: 'move', delta: { x: 2, z: 0 } }])
    expect(outbound.rejections).toEqual([])
    expect(outbound.state.movementOwner).toBe('streamed')
    expect(outbound.state.player.position.x).toBe(36)
    const inbound = advancePublicWorldV11Frame(outbound.state,
      [{ type: 'move', delta: { x: -2, z: 0 } }])
    expect(inbound.rejections).toEqual([])
    expect(inbound.state.movementOwner).toBe('greenway')
    expect(inbound.state.player.position.x).toBe(34)
    expect(inbound.state.tick).toBe(start.tick + 2)
  })

  it('preserves the existing west crossing and rejects off-connector east attempts atomically', () => {
    const westTile = worldTileAtGrid(seed, -3, 0)
    const westStart: PublicWorldV11State = { ...fresh,
      player: { ...fresh.player, position: { x: -12,
        y: terrainHeightAt(fresh.greenway.tiles, -12, 0), z: 0 } },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds, westTile.id])].sort() }
    const { highland: _h, highlandContentRevision: _r, ...v10 } = westStart
    const westMove = [{ type: 'move' as const, delta: { x: -4, z: 0 } }]
    const old = advancePublicWorldV10Frame(v10, westMove)
    const newer = advancePublicWorldV11Frame(westStart, westMove)
    expect(newer.rejections).toEqual(old.rejections)
    expect(newer.state.movementOwner).toBe(old.state.movementOwner)
    expect(newer.state.player.position).toEqual(old.state.player.position)
    expect(newer.events).toEqual(old.events)

    const eastTile = worldTileAtGrid(seed, 3, 1)
    const offRoute: PublicWorldV11State = { ...fresh,
      player: { ...fresh.player, position: { x: 12,
        y: terrainHeightAt(fresh.greenway.tiles, 12, 4), z: 4 } },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds, eastTile.id])].sort() }
    const blocked = advancePublicWorldV11Frame(offRoute,
      [{ type: 'move', delta: { x: 4, z: 0 } }])
    expect(blocked.rejections).toMatchObject([{ code: 'off_connector' }])
    expect(blocked.state).toBe(offRoute)
    expect(blocked.events).toEqual([])
  })

  it('blocks Highland rock only in v11 while allowing gallery travel and v10 movement', () => {
    const gallery = worldTileAtGrid(seed, 145, -117)
    const start = atMireglass(gallery.center)
    const intoRock = [{ type: 'move' as const, delta: { x: 0, z: -4 } }]
    expect(isValidPublicWorldV11State(start, null)).toBe(true)
    const blocked = advancePublicWorldV11Frame(start, intoRock)
    expect(blocked.rejections).toMatchObject([{ code: 'ridge_rock' }])
    expect(blocked.state).toBe(start)
    expect(blocked.events).toEqual([])

    const alongGallery = advancePublicWorldV11Frame(start,
      [{ type: 'move', delta: { x: 4, z: 0 } }])
    expect(alongGallery.rejections).toEqual([])
    expect(alongGallery.state.player.position).toMatchObject({ x: 584, z: -468 })

    const { highland: _progress, highlandContentRevision: _revision, ...v10 } = start
    const older = advancePublicWorldV10Frame(v10, intoRock)
    expect(older.rejections).toEqual([])
    expect(older.state.player.position).toMatchObject({ x: 580, z: -472 })
  })

  it('lets a v11 save already inside new rock escape and blocks re-entry', () => {
    const rock = worldTileAtGrid(seed, 145, -118)
    const saved = atMireglass(rock.center)
    expect(isValidPublicWorldV11State(saved, null)).toBe(true)
    const escaped = advancePublicWorldV11Frame(saved,
      [{ type: 'move', delta: { x: 0, z: 4 } }])
    expect(escaped.rejections).toEqual([])
    expect(escaped.state.player.position).toMatchObject({ x: 580, z: -468 })
    const reentered = advancePublicWorldV11Frame(escaped.state,
      [{ type: 'move', delta: { x: 0, z: -4 } }])
    expect(reentered.rejections).toMatchObject([{ code: 'ridge_rock' }])
    expect(reentered.state).toBe(escaped.state)
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
      const frame = advancePublicWorldV11Frame(state,
        [{ type: 'move', delta: { x: to.x - from.x, z: to.z - from.z } }])
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
      const frame = advancePublicWorldV11Frame(state,
        [{ type: 'move', delta: { x: to.x - from.x, z: to.z - from.z } }])
      expect(frame.rejections, `inbound cell ${i}`).toEqual([])
      state = frame.state
    }
    expect(state.player.position.x).toBe(12)
    expect(state.player.position.z).toBe(0)
    expect(state.movementOwner).toBe('greenway')
    expect(state.tick).toBe(seeded.tick + 2 * (route.length - 1))
  })

  it('discovers the landmark only after walking into range, once, without a second player clock', () => {
    const landmark = highlandLandmark(seed)
    const west = { ...fresh, movementOwner: 'streamed' as const,
      player: { ...fresh.player, position: { ...landmark.tile.center, x: 452 } },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds,
        landmark.tile.id, `tile-${452 / 4 + 3}-${-432 / 4 + 3}`])].sort() }
    expect(isValidPublicWorldV11State(west, null)).toBe(true)
    const approach = advancePublicWorldV11Frame(west,
      [{ type: 'move', delta: { x: 4, z: 0 } }])
    expect(approach.rejections).toEqual([])
    expect(approach.state.highland.landmarkDiscovered).toBe(true)
    expect(approach.events.at(-1)).toMatchObject({ type: 'highland_landmark_discovered',
      landmarkId: landmark.id, sequence: approach.state.eventSequence, tick: approach.state.tick })
    expect(approach.state.tick).toBe(west.tick + 1)
    const again = advancePublicWorldV11Frame(approach.state,
      [{ type: 'move', delta: { x: 1, z: 0 } }])
    expect(again.rejections).toEqual([])
    expect(again.events.filter((event) => event.type === 'highland_landmark_discovered')).toEqual([])
  })

  it('uses detached movement and a single intent snapshot when a caller getter mutates its state', () => {
    const landmark = highlandLandmark(seed)
    const startTile = worldTileAtGrid(seed, 452 / 4, -432 / 4)
    const source: PublicWorldV11State = { ...fresh, movementOwner: 'streamed',
      player: { ...fresh.player, position: { x: 452, y: startTile.center.y, z: -432 } },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds, startTile.id])].sort() }
    expect(isValidPublicWorldV11State(source, null)).toBe(true)
    let getterReads = 0
    const delta = { z: 0 } as { x: number; z: number }
    Object.defineProperty(delta, 'x', { enumerable: true, get() {
      getterReads += 1
      source.player.position.x = 456
      return getterReads === 1 ? 4 : 0
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
