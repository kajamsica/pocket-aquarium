import { describe, expect, it } from 'vitest'
import { createGeneratedWorld, terrainHeightAt } from './generation'
import { mireglassApproachTrail, mireglassGreenwayToMarkerTrail } from './mireglassApproachTrail'
import { mireglassAnchors, mireglassResources } from './mireglassContent'
import type { MireglassExpeditionAction } from './mireglassExpedition'
import { mireglassRouteSites } from './mireglassRouteSites'
import { serializeWizardWorld } from './persistence'
import { actPublicMireglass } from './publicWorldActions'
import { advancePublicWorldFrame } from './publicWorldRuntime'
import { createPublicWorldFromBootstrap } from './publicWorldState'
import type { PublicWorldState } from './publicWorldState'
import { commitLegacyImportToPublicV6, commitPublicV6World, inspectLegacyImportSource,
  loadPublicV6Root, PUBLIC_V6_ROOT_KEY } from './publicWorldV6'
import type { Vec3 } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const legacyKey = 'wizard-realms:world:v5'
const anchors = mireglassAnchors(seed)
const trees = mireglassResources(seed).slice(0, 4)
const sites = mireglassRouteSites(seed)
const bridge = sites.find(({ kind }) => kind === 'bridge')!
const ladder = sites.find(({ kind }) => kind === 'ladder')!

function memoryStorage(legacyBytes: string) {
  const values = new Map([[legacyKey, legacyBytes]])
  const writes: string[] = []
  return { values, writes, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push(key); values.set(key, value) } }
}

function assertOnePlayer(state: PublicWorldState) {
  expect(state.movementOwner === 'greenway' || state.movementOwner === 'streamed').toBe(true)
  expect(Object.hasOwn(state, 'player')).toBe(true)
  expect(Object.hasOwn(state.greenway, 'player')).toBe(false)
  expect(Object.hasOwn(state.mireglass, 'player')).toBe(false)
}

function move(state: PublicWorldState, target: Readonly<Vec3>): PublicWorldState {
  const before = state
  const result = advancePublicWorldFrame(state, [{ type: 'move', delta: {
    x: target.x - state.player.position.x, z: target.z - state.player.position.z } }])
  expect(result.rejections).toEqual([])
  expect(result.state.player.position.x).toBe(target.x)
  expect(result.state.player.position.z).toBe(target.z)
  expect(result.state.tick).toBe(before.tick + 1)
  expect(result.state.eventSequence).toBe(before.eventSequence + result.events.length)
  expect(result.state.rng.simulation).not.toBe(before.rng.simulation)
  assertOnePlayer(result.state)
  return result.state
}

function act(state: PublicWorldState, action: MireglassExpeditionAction): PublicWorldState {
  const result = actPublicMireglass(state, action)
  expect(result.rejection).toBeUndefined()
  if (!result.event) throw new Error(`Mireglass action ${action.type} was rejected: ${result.rejection?.code}`)
  expect(result.event.sequence).toBe(state.eventSequence + 1)
  expect(result.state.eventSequence).toBe(state.eventSequence + 1)
  expect(result.state.tick).toBe(state.tick)
  expect(result.state.rng).toEqual(state.rng)
  assertOnePlayer(result.state)
  return result.state
}

function walkPath(state: PublicWorldState, path: readonly Readonly<Vec3>[]): PublicWorldState {
  for (const target of path) state = move(state, target)
  return state
}

/** Only distant content-site setup uses this test-only pose; no inventory, skills or progress are forged. */
function atContentSite(state: PublicWorldState, position: Readonly<Vec3>): PublicWorldState {
  const tile = worldTileAtGrid(seed, position.x / WORLD_CELL_METERS, position.z / WORLD_CELL_METERS)
  return { ...state, player: { ...state.player, position: { ...position }, verticalVelocity: 0 },
    discoveredTileIds: [...new Set([...state.discoveredTileIds, tile.id])].sort() }
}

describe('public v6 Greenway to Mireglass journey', () => {
  it('imports, walks out, develops the region, saves and reloads, then returns with one player and intact v5 bytes', () => {
    const legacy = createGeneratedWorld(seed, 'greenway-classic-v1')
    // A legal v5 edge save shortens only the already-covered Greenway approach.
    legacy.player.position = { x: -12, y: terrainHeightAt(legacy.tiles, -12, 0), z: 0 }
    const legacyBytes = serializeWizardWorld(legacy)
    const storage = memoryStorage(legacyBytes)
    const inspected = inspectLegacyImportSource(storage, 'greenway-classic-v1')
    expect(inspected.status).toBe('available')
    if (inspected.status !== 'available') throw new Error('Valid legacy save did not inspect.')
    const imported = commitLegacyImportToPublicV6(storage, inspected)
    expect(imported.status).toBe('committed')
    if (imported.status !== 'committed') throw new Error('Legacy import did not commit.')
    let state = createPublicWorldFromBootstrap(imported.root)
    assertOnePlayer(state)
    expect(storage.values.get(legacyKey)).toBe(legacyBytes)

    const outbound = advancePublicWorldFrame(state, [
      { type: 'look', yawDelta: Math.PI / 2, pitchDelta: 0 },
      { type: 'move', delta: { x: -4, z: 0 } },
    ])
    expect(outbound.rejections).toEqual([])
    expect(outbound.state.movementOwner).toBe('streamed')
    expect(outbound.state.tick).toBe(state.tick + 1)
    expect(outbound.state.eventSequence).toBe(state.eventSequence + outbound.events.length)
    state = outbound.state
    let expectedBytes = storage.values.get(PUBLIC_V6_ROOT_KEY)!
    const checkpoint = (world: PublicWorldState) => {
      const saved = commitPublicV6World(storage, world, expectedBytes)
      expect(saved.status).toBe('committed')
      if (saved.status !== 'committed') throw new Error(`Public save failed: ${saved.status}`)
      expectedBytes = saved.bytes
      const loaded = loadPublicV6Root(storage)
      expect(loaded.status).toBe('valid-playable')
      if (loaded.status !== 'valid-playable') throw new Error('Public save did not reload.')
      expect(loaded.root.state).toEqual(world)
      assertOnePlayer(loaded.root.state)
      return loaded.root.state
    }
    state = checkpoint(state)

    const connector = mireglassGreenwayToMarkerTrail(seed)
    const outboundIndex = connector.findIndex(({ x, z }) => x === -16 && z === 0)
    expect(outboundIndex).toBeGreaterThan(0)
    state = walkPath(state, connector.slice(outboundIndex + 1))
    expect(state.player.position.x).toBe(anchors.fringeMarker.tile.center.x)
    expect(state.player.position.z).toBe(anchors.fringeMarker.tile.center.z)
    state = act(state, { type: 'study_fringe_marker' })
    expect(state.player.learnedSpellIds).toContain('wayfinder_glow')
    state = act(state, { type: 'equip_item', itemId: 'woodcutters_axe' })

    for (const tree of trees) {
      state = atContentSite(state, tree.tile.center)
      state = act(state, { type: 'chop_tree', resourceId: tree.id })
    }
    expect(state.player.inventory.find(({ itemId }) => itemId === 'logs')?.quantity).toBe(16)
    state = atContentSite(state, anchors.salvager.tile.center)
    state = act(state, { type: 'sell_item', itemId: 'logs', quantity: 1 })
    state = act(state, { type: 'buy_item', itemId: 'field_spade' })
    state = act(state, { type: 'equip_item', itemId: 'field_spade' })
    state = atContentSite(state, trees[0].tile.center)
    state = act(state, { type: 'dig_tree_stump', resourceId: trees[0].id })
    expect(state.player.skillXp.excavation).toBeGreaterThanOrEqual(30)

    for (const site of [bridge, ladder]) {
      state = atContentSite(state, site.from)
      state = act(state, { type: 'build_route', siteId: site.id })
      state = act(state, { type: 'traverse_route', siteId: site.id, from: 'from' })
      expect(state.player.position).toEqual(site.to)
      state = act(state, { type: 'traverse_route', siteId: site.id, from: 'to' })
      expect(state.player.position).toEqual(site.from)
    }
    expect(state.mireglass.builtRoutes).toEqual({ bridge: bridge.id, ladder: ladder.id })
    state = atContentSite(state, anchors.sealCache.tile.center)
    state = act(state, { type: 'cast_wayfinder_glow' })
    expect(state.mireglass.cacheRevealed).toBe(true)
    state = act(state, { type: 'excavate_cache' })
    expect(state.mireglass.cacheExcavated).toBe(true)
    state = checkpoint(state)

    state = atContentSite(state, anchors.salvager.tile.center)
    state = act(state, { type: 'sell_item', itemId: 'mireglass_reach/item/seal', quantity: 1 })
    const approach = mireglassApproachTrail(seed)
    state = walkPath(state, [...approach].reverse().slice(1))
    state = walkPath(state, [...connector].reverse().slice(1, connector.length - outboundIndex))
    expect(state.player.position.x).toBe(-16)
    expect(state.player.position.z).toBe(0)
    const inbound = advancePublicWorldFrame(state, [{ type: 'move', delta: { x: 4, z: 0 } }])
    expect(inbound.rejections).toEqual([])
    expect(inbound.state.movementOwner).toBe('greenway')
    expect(inbound.state.tick).toBe(state.tick + 1)
    expect(inbound.state.eventSequence).toBe(state.eventSequence + inbound.events.length)
    state = checkpoint(inbound.state)
    expect(state.mireglass.cacheExcavated).toBe(true)
    expect(state.mireglass.builtRoutes).toEqual({ bridge: bridge.id, ladder: ladder.id })
    expect(state.player.skillXp.excavation).toBeGreaterThanOrEqual(30)
    expect(state.player.learnedSpellIds).toContain('wayfinder_glow')
    expect(state.greenway).toEqual(createPublicWorldFromBootstrap(imported.root).greenway)
    expect(storage.values.get(legacyKey)).toBe(legacyBytes)
    expect(storage.writes).not.toContain(legacyKey)
  })
})
