import { describe, expect, it } from 'vitest'
import { createGeneratedWorld } from './generation'
import { mireglassAnchors, mireglassResources } from './mireglassContent'
import { mireglassGlowRevealableTileIds } from './mireglassExpedition'
import { parseMireglassWorld, serializeMireglassWorld } from './mireglassPersistence'
import { mireglassBermFaceRowAt, mireglassFenRowAt } from './mireglassTerrain'
import { mireglassRouteSites } from './mireglassRouteSites'
import type { StreamedWorldIntent } from './streamedWorld'
import { createMireglassWorld, createMireglassWorldFromState } from './mireglassWorld'
import type { MireglassWorldState } from './mireglassWorld'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seed = 'mireglass-campaign-composition'
const move = (x: number, z = 0): StreamedWorldIntent => ({ type: 'move', delta: { x, z } })

describe('Mireglass campaign runtime', () => {
  it('starts with one complete v5-derived player and permits an explicit fresh dev start without progression', () => {
    const fresh = createMireglassWorld(seed)
    expect(Object.keys(fresh.state).sort()).toEqual([
      'contentRevision', 'discoveredTileIds', 'expedition', 'player', 'seed', 'tick',
    ])
    expect(fresh.state.player).toEqual(createGeneratedWorld(seed).player)
    expect(fresh.state.tick).toBe(0)
    expect(fresh.state.player.position.x).toBe(0)
    expect(fresh.state.expedition).toMatchObject({
      seed, builtRoutes: { bridge: null, ladder: null }, cacheRevealed: false, cacheExcavated: false,
    })
    expect(fresh.activeChunkCount()).toBe(9)

    const dev = createMireglassWorld(seed, undefined, { x: -288, z: 288 })
    expect(dev.state.player.position).toEqual(worldTileAtGrid(seed, -72, 72).center)
    expect(dev.state.player.inventory).toEqual(fresh.state.player.inventory)
    expect(dev.state.player.equipment).toEqual(fresh.state.player.equipment)
    expect(dev.state.player.skillXp).toEqual(fresh.state.player.skillXp)
    expect(dev.state.player.learnedSpellIds).toEqual([])
    expect(() => createMireglassWorld(seed, createGeneratedWorld(seed).player,
      { x: -288, z: 288 })).toThrow(RangeError)
  })

  it('replays streamed movement deterministically while preserving every imported v5 player fact', () => {
    const source = createGeneratedWorld(seed).player
    source.coins = 247
    source.yaw = 0.2
    source.pitch = -0.1
    source.inventory.push({ itemId: 'field_spade', quantity: 1 })
    source.equipment.mainHand = 'field_spade'
    source.tradeSlots[0] = { slotIndex: 0, itemId: 'stone', quantity: 1, unitPrice: 5 }
    source.discoveredRingIds = ['ring-greenway']
    source.learnedSpellIds = ['wayfinder_glow']
    source.skillXp.excavation = 30
    source.position.y += 0.5
    source.verticalVelocity = 0.4
    const sourceBytes = JSON.stringify(source)
    const left = createMireglassWorld(seed, source)
    const right = createMireglassWorld(seed, source)
    expect(left.state.player.position).toEqual(source.position)
    expect(left.state.player.verticalVelocity).toBe(0.4)
    const before = left.state
    const beforeBytes = JSON.stringify(before)
    const script: StreamedWorldIntent[][] = [
      [move(4), { type: 'look', yawDelta: 0.3, pitchDelta: 0.2 }],
      [{ type: 'jump' }],
      [move(4)],
      [],
    ]
    for (const intents of script) expect(left.advance(intents)).toEqual(right.advance(intents))
    expect(left.state.tick).toBe(script.length)
    expect(left.state.player.position.x).toBe(8)
    expect(left.state.player.yaw).toBeCloseTo(0.5)
    expect(left.state.player.pitch).toBeCloseTo(0.1)
    expect(left.state.player.coins).toBe(247)
    expect(left.state.player.inventory).toEqual(source.inventory)
    expect(left.state.player.equipment).toEqual(source.equipment)
    expect(left.state.player.tradeSlots).toEqual(source.tradeSlots)
    expect(left.state.player.discoveredRingIds).toEqual(source.discoveredRingIds)
    expect(left.state.player.learnedSpellIds).toEqual(source.learnedSpellIds)
    expect(left.state.player.skillXp).toEqual(source.skillXp)
    expect(JSON.stringify(before)).toBe(beforeBytes)
    expect(JSON.stringify(source)).toBe(sourceBytes)
    expect(Object.isFrozen(before.player.inventory)).toBe(true)
  })

  it.each([
    { name: 'fen channel', from: { x: -352, z: mireglassFenRowAt(seed, -352) - 4 }, delta: { x: 0, z: 4 }, code: 'fen_channel' },
    { name: 'slate cliff', from: { x: -400, z: mireglassBermFaceRowAt(seed, -400) - 4 }, delta: { x: 0, z: 4 }, code: 'slate_cliff' },
  ])('keeps the $name barrier and its chunk window intact', ({ from, delta, code }) => {
    const world = createMireglassWorld(seed, undefined, from)
    const before = world.state
    const chunks = world.activeChunkCoordinates()
    const result = world.advance([{ type: 'move', delta }])
    expect(result.rejections).toEqual([{ intentIndex: 0, intentType: 'move', code }])
    expect(result.events).toEqual([])
    expect(result.state.player.position).toEqual(before.player.position)
    expect(result.state.discoveredTileIds).toEqual(before.discoveredTileIds)
    expect(world.activeChunkCoordinates()).toEqual(chunks)
    expect(result.state.tick).toBe(1)
  })

  it('rejects actions without touching campaign state or active chunks and never repeats a tree reward', () => {
    const tree = mireglassResources(seed)[0]
    const world = createMireglassWorld(seed, undefined, tree.tile.center)
    const before = world.state
    const chunks = world.activeChunkCoordinates()
    const rejected = world.act({ type: 'chop_tree', resourceId: tree.id })
    expect(rejected.rejection?.code).toBe('requires_axe')
    expect(rejected.state).toBe(before)
    expect(world.activeChunkCoordinates()).toEqual(chunks)
    expect(world.act({ type: 'equip_item', itemId: 'woodcutters_axe' }).event?.type).toBe('item_equipped')
    const chopped = world.act({ type: 'chop_tree', resourceId: tree.id })
    expect(chopped.event?.type).toBe('tree_chopped')
    expect(world.state.player.inventory.find(({ itemId }) => itemId === 'logs')?.quantity).toBe(4)
    const rewarded = world.state
    const repeated = world.act({ type: 'chop_tree', resourceId: tree.id })
    expect(repeated.rejection?.code).toBe('depleted')
    expect(repeated.state).toBe(rewarded)
    expect(world.state.player.xp).toBe(20)
    expect(world.activeChunkCoordinates()).toEqual(chunks)
  })

  it('reveals bell-alder fog in the streamed world and restores it from a v6 save', () => {
    const alder = mireglassAnchors(seed).bellAlder
    const source = createGeneratedWorld(seed).player
    source.position = { ...alder.tile.center }
    source.learnedSpellIds = ['wayfinder_glow']
    const world = createMireglassWorld(seed, source)
    const before = world.state
    const tileIds = mireglassGlowRevealableTileIds(seed, before.player.position, before.discoveredTileIds)
    expect(tileIds.length).toBeGreaterThan(0)
    const cast = world.act({ type: 'cast_wayfinder_glow' })
    expect(cast.event).toEqual({ type: 'terrain_revealed', spellId: 'wayfinder_glow',
      revealedTileIds: tileIds, xp: tileIds.length * 10 })
    expect(world.state.expedition.cacheRevealed).toBe(false)
    expect(world.state.discoveredTileIds).toEqual([...new Set([...before.discoveredTileIds, ...tileIds])].sort())
    const east = worldTileAtGrid(seed, alder.tile.center.x / WORLD_CELL_METERS + 1,
      alder.tile.center.z / WORLD_CELL_METERS)
    expect(tileIds).toContain(east.id)
    expect(world.tileAtWorld(east.center.x, east.center.z)).toEqual(east)
    expect(world.activeTiles()).toContainEqual(east)
    const rewarded = world.state
    const repeated = world.act({ type: 'cast_wayfinder_glow' })
    expect(repeated.rejection?.code).toBe('already_revealed')
    expect(repeated.state).toBe(rewarded)

    const save = serializeMireglassWorld(world.state)
    const parsed = parseMireglassWorld(save, seed)
    expect(parsed).not.toBeNull()
    const resumed = createMireglassWorldFromState(parsed!)
    expect(resumed.state).toEqual(world.state)
    expect(resumed.tileAtWorld(east.center.x, east.center.z)).toEqual(east)
    const restored = resumed.state
    expect(resumed.act({ type: 'cast_wayfinder_glow' }).rejection?.code).toBe('already_revealed')
    expect(resumed.state).toBe(restored)
    const originalMove = world.advance([move(4)])
    const resumedMove = resumed.advance([move(4)])
    expect(resumedMove).toEqual(originalMove)
    expect(resumedMove.state.player.position.x).toBe(east.center.x)
    expect(resumedMove.events).not.toContainEqual({ type: 'tile_discovered', tick: 1, tileId: east.id })
  })

  it('reveals the hidden seal cache and nearby fog in one cast, with no repeat reward', () => {
    const cache = mireglassAnchors(seed).sealCache
    const source = createGeneratedWorld(seed).player
    source.position = { ...cache.tile.center }
    source.learnedSpellIds = ['wayfinder_glow']
    const world = createMireglassWorld(seed, source)
    const before = world.state
    const tileIds = mireglassGlowRevealableTileIds(seed, before.player.position, before.discoveredTileIds)
    const cast = world.act({ type: 'cast_wayfinder_glow' })
    expect(cast.event).toEqual({ type: 'cache_revealed', cacheId: cache.id,
      spellId: 'wayfinder_glow', revealedTileIds: tileIds, xp: (tileIds.length + 1) * 10 })
    expect(world.state.expedition.cacheRevealed).toBe(true)
    expect(world.state.discoveredTileIds).toEqual([...new Set([...before.discoveredTileIds, ...tileIds])].sort())
    expect(world.state.player.skillXp.spellcraft).toBe((tileIds.length + 1) * 10)
    const rewarded = world.state
    expect(world.act({ type: 'cast_wayfinder_glow' }).rejection?.code).toBe('already_revealed')
    expect(world.state).toBe(rewarded)
    expect(parseMireglassWorld(serializeMireglassWorld(world.state), seed)).not.toBeNull()
  })

  it('traverses the selected canonical bridge in both directions with atomic discovery and no duplicate build XP', () => {
    const sites = mireglassRouteSites(seed)
    const bridge = sites.find(({ kind }) => kind === 'bridge')!
    const other = sites.find(({ kind, id }) => kind === 'bridge' && id !== bridge.id)!
    const source = createGeneratedWorld(seed).player
    source.position = { ...bridge.from }
    source.yaw = 0.4
    source.pitch = -0.2
    source.inventory.push({ itemId: 'logs', quantity: bridge.logCost })
    const sourceBytes = JSON.stringify(source)
    const world = createMireglassWorld(seed, source)
    world.advance([{ type: 'look', yawDelta: 0.1, pitchDelta: 0.05 }])
    const built = world.act({ type: 'build_route', siteId: bridge.id })
    expect(built.event?.type).toBe('route_built')
    expect(world.state.expedition.builtRoutes.bridge).toBe(bridge.id)
    expect(world.state.player.xp).toBe(80)
    const beforeCross = world.state
    const beforeChunks = world.activeChunkCoordinates()
    const wrong = world.act({ type: 'traverse_route', siteId: other.id, from: 'from' })
    expect(wrong.rejection?.code).toBe('not_built')
    expect(wrong.state).toBe(beforeCross)
    expect(world.activeChunkCoordinates()).toEqual(beforeChunks)

    const outbound = world.act({ type: 'traverse_route', siteId: bridge.id, from: 'from' })
    const targetTile = worldTileAtGrid(seed, bridge.to.x / WORLD_CELL_METERS, bridge.to.z / WORLD_CELL_METERS)
    expect(outbound.event).toMatchObject({ type: 'route_traversed', siteId: bridge.id, from: 'from' })
    expect(world.state.player.position).toEqual(bridge.to)
    expect(world.state.player.verticalVelocity).toBe(0)
    expect(world.state.player.yaw).toBeCloseTo(0.5)
    expect(world.state.player.pitch).toBeCloseTo(-0.15)
    expect(world.state.tick).toBe(1)
    expect(world.state.discoveredTileIds).toContain(targetTile.id)
    expect(world.tileAtWorld(bridge.to.x, bridge.to.z)).toEqual(targetTile)
    expect(world.activeTiles()).toContainEqual(targetTile)
    expect(world.activeChunkCoordinates()).toContainEqual({
      chunkX: Math.floor(bridge.to.x / 64), chunkZ: Math.floor(bridge.to.z / 64),
    })
    expect(world.activeChunkCount()).toBe(9)
    expect(beforeCross.player.position).toEqual(bridge.from)

    const discovery = world.state.discoveredTileIds
    expect(world.act({ type: 'traverse_route', siteId: bridge.id, from: 'to' }).event?.type).toBe('route_traversed')
    expect(world.state.player.position).toEqual(bridge.from)
    expect(world.state.discoveredTileIds).toEqual(discovery)
    expect(world.tileAtWorld(bridge.from.x, bridge.from.z)).toEqual(
      worldTileAtGrid(seed, bridge.from.x / WORLD_CELL_METERS, bridge.from.z / WORLD_CELL_METERS))
    const afterReturn = world.state
    expect(world.act({ type: 'build_route', siteId: bridge.id }).rejection?.code).toBe('already_built')
    expect(world.state).toBe(afterReturn)
    expect(world.state.player.xp).toBe(80)
    expect(JSON.stringify(source)).toBe(sourceBytes)
  })

  it('roundtrips full v6 progress and continues movement and route actions deterministically', () => {
    const bridge = mireglassRouteSites(seed).find(({ kind }) => kind === 'bridge')!
    const imported = createGeneratedWorld(seed).player
    imported.position = { ...bridge.from }
    imported.coins = 231
    imported.inventory.push({ itemId: 'logs', quantity: bridge.logCost })
    imported.learnedSpellIds = ['wayfinder_glow']
    const original = createMireglassWorld(seed, imported)
    expect(original.act({ type: 'equip_item', itemId: 'woodcutters_axe' }).event?.type).toBe('item_equipped')
    expect(original.act({ type: 'build_route', siteId: bridge.id }).event?.type).toBe('route_built')
    original.advance([{ type: 'look', yawDelta: 0.3, pitchDelta: -0.1 }])
    original.advance([{ type: 'jump' }])
    const snapshot = JSON.parse(JSON.stringify(original.state)) as MireglassWorldState
    const snapshotBytes = JSON.stringify(snapshot)
    const resumed = createMireglassWorldFromState(snapshot)
    expect(resumed.state).toEqual(snapshot)
    expect(resumed.state.player).not.toBe(snapshot.player)
    expect(resumed.state.expedition).not.toBe(snapshot.expedition)
    expect(resumed.state.player.inventory).not.toBe(snapshot.player.inventory)
    expect(resumed.activeChunkCoordinates()).toEqual(original.activeChunkCoordinates())
    expect(resumed.activeChunkCount()).toBe(original.activeChunkCount())
    expect(resumed.advance([move(1)])).toEqual(original.advance([move(1)]))
    const traverse = { type: 'traverse_route', siteId: bridge.id, from: 'from' } as const
    expect(resumed.act(traverse)).toEqual(original.act(traverse))
    expect(resumed.state.player.position).toEqual(bridge.to)
    expect(resumed.state.player.coins).toBe(231)
    expect(resumed.state.player.learnedSpellIds).toEqual(['wayfinder_glow'])
    expect(resumed.state.expedition.builtRoutes.bridge).toBe(bridge.id)
    expect(JSON.stringify(snapshot)).toBe(snapshotBytes)
    expect(Object.isFrozen(snapshot.player)).toBe(false)
    snapshot.player.coins = 0
    expect(resumed.state.player.coins).toBe(231)
  })

  it('rejects tampered v6 snapshots before exposing a runtime', () => {
    const snapshot = structuredClone(createMireglassWorld(seed).state)
    const invalid: unknown[] = [
      { ...snapshot, seed: '' },
      { ...snapshot, contentRevision: 'forged-revision' },
      { ...snapshot, tick: -1 },
      { ...snapshot, player: { ...snapshot.player, xp: -1 } },
      { ...snapshot, player: { ...snapshot.player, yaw: 1_000_001 } },
      { ...snapshot, player: { ...snapshot.player,
        position: { ...snapshot.player.position, y: snapshot.player.position.y - 10 } } },
      { ...snapshot, expedition: { ...snapshot.expedition, seed: 'another-seed' } },
      { ...snapshot, expedition: { ...snapshot.expedition,
        builtRoutes: { ...snapshot.expedition.builtRoutes, bridge: 'forged-site' } } },
      { ...snapshot, discoveredTileIds: [] },
      { ...snapshot, discoveredTileIds: [...snapshot.discoveredTileIds, ...snapshot.discoveredTileIds] },
    ]
    for (const value of invalid) {
      expect(() => createMireglassWorldFromState(value as MireglassWorldState)).toThrow(RangeError)
    }
  })
})
