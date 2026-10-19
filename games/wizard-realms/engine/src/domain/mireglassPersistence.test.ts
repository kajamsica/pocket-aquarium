import { describe, expect, it } from 'vitest'
import { createGeneratedWorld } from './generation'
import { mireglassAnchors, mireglassResources } from './mireglassContent'
import { mireglassRouteSites } from './mireglassRouteSites'
import { MIREGLASS_SAVE_KEY, MIREGLASS_SAVE_SCHEMA_VERSION,
  parseMireglassWorld, serializeMireglassWorld } from './mireglassPersistence'
import { createMireglassWorld, createMireglassWorldFromState } from './mireglassWorld'
import type { MireglassWorldRuntime } from './mireglassWorld'
import { serializeWizardWorld } from './persistence'

const seed = 'mireglass-save-contract'
const source = () => createMireglassWorld(seed).state
const mutate = (change: (save: any) => void) => {
  const save = JSON.parse(serializeMireglassWorld(source()))
  change(save)
  return JSON.stringify(save)
}
const walkNear = (world: MireglassWorldRuntime, destination: { x: number; z: number }) => {
  for (let step = 0; step < 200; step += 1) {
    const { x, z } = world.state.player.position
    const dx = destination.x - x
    const dz = destination.z - z
    const distance = Math.hypot(dx, dz)
    if (distance < 1) return
    const length = Math.min(3.9, distance)
    const result = world.advance([{ type: 'move', delta: { x: dx / distance * length, z: dz / distance * length } }])
    expect(result.rejections, `movement toward ${destination.x},${destination.z}`).toEqual([])
  }
  throw new Error('Mireglass test journey did not reach its destination.')
}

describe('separate Mireglass v6 save codec', () => {
  it('round-trips a complete and progressed campaign without changing v5 or input bytes', () => {
    expect(MIREGLASS_SAVE_KEY).not.toBe('wizard-realms:world:v5')
    const tree = mireglassResources(seed)[0]
    const world = createMireglassWorld(seed, undefined, tree.tile.center)
    expect(world.act({ type: 'equip_item', itemId: 'woodcutters_axe' }).event?.type).toBe('item_equipped')
    expect(world.act({ type: 'chop_tree', resourceId: tree.id }).event?.type).toBe('tree_chopped')
    const state = structuredClone(world.state)
    const before = JSON.stringify(state)
    const bytes = serializeMireglassWorld(state)
    const restored = parseMireglassWorld(bytes, seed)
    expect(restored).toEqual(state)
    expect(JSON.stringify(state)).toBe(before)
    expect(serializeMireglassWorld(restored!)).toBe(bytes)
    expect(Object.isFrozen(restored)).toBe(true)
    expect(Object.isFrozen(restored!.player.inventory)).toBe(true)
    state.player.coins = 999
    expect(restored!.player.coins).not.toBe(999)
    expect(JSON.parse(bytes).schemaVersion).toBe(MIREGLASS_SAVE_SCHEMA_VERSION)
  })

  it('accepts action-produced routes, spell study, and a recovered seal', () => {
    const bridge = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const builder = createGeneratedWorld(seed).player
    builder.position = { ...bridge.from }
    builder.inventory.push({ itemId: 'logs', quantity: bridge.logCost })
    const bridgeWorld = createMireglassWorld(seed, builder)
    expect(bridgeWorld.act({ type: 'build_route', siteId: bridge.id }).event?.type).toBe('route_built')
    expect(parseMireglassWorld(serializeMireglassWorld(bridgeWorld.state), seed)).toEqual(bridgeWorld.state)

    const marker = mireglassAnchors(seed).fringeMarker.tile.center
    const studyWorld = createMireglassWorld(seed, undefined, marker)
    expect(studyWorld.act({ type: 'study_fringe_marker' }).event?.type).toBe('fringe_marker_studied')
    expect(parseMireglassWorld(serializeMireglassWorld(studyWorld.state), seed)).toEqual(studyWorld.state)

    const cache = mireglassAnchors(seed).sealCache.tile.center
    const excavator = createGeneratedWorld(seed).player
    excavator.position = { ...cache }
    excavator.inventory.push({ itemId: 'field_spade', quantity: 1 })
    excavator.equipment.mainHand = 'field_spade'
    excavator.skillXp.excavation = 30
    excavator.learnedSpellIds.push('wayfinder_glow')
    const cacheWorld = createMireglassWorld(seed, excavator)
    expect(cacheWorld.act({ type: 'cast_wayfinder_glow' }).event?.type).toBe('cache_revealed')
    expect(cacheWorld.act({ type: 'excavate_cache' }).event?.type).toBe('cache_excavated')
    expect(parseMireglassWorld(serializeMireglassWorld(cacheWorld.state), seed)).toEqual(cacheWorld.state)
  })

  it('resumes one earned marker, shop, timber, stump, and route journey', () => {
    const anchors = mireglassAnchors(seed)
    const trees = mireglassResources(seed).filter(({ phase }) => phase === 'before_bridge').slice(1)
    const bridge = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const world = createMireglassWorld(seed, undefined, anchors.fringeMarker.tile.center)
    expect(world.act({ type: 'study_fringe_marker' }).event?.type).toBe('fringe_marker_studied')
    walkNear(world, anchors.salvager.tile.center)
    expect(world.act({ type: 'buy_item', itemId: 'field_spade' }).event?.type).toBe('item_bought')
    expect(world.act({ type: 'equip_item', itemId: 'woodcutters_axe' }).event?.type).toBe('item_equipped')
    for (const tree of trees) {
      walkNear(world, tree.tile.center)
      expect(world.act({ type: 'chop_tree', resourceId: tree.id }).event?.type).toBe('tree_chopped')
    }
    expect(world.act({ type: 'equip_item', itemId: 'field_spade' }).event?.type).toBe('item_equipped')
    expect(world.act({ type: 'dig_tree_stump', resourceId: trees[1].id }).event?.type).toBe('tree_stump_dug')
    walkNear(world, bridge.from)
    expect(world.act({ type: 'build_route', siteId: bridge.id }).event?.type).toBe('route_built')
    const restored = parseMireglassWorld(serializeMireglassWorld(world.state), seed)
    expect(restored).toEqual(world.state)
    const reversed = JSON.parse(serializeMireglassWorld(world.state))
    reversed.expedition.depletedResourceIds.reverse()
    expect(parseMireglassWorld(JSON.stringify(reversed), seed)).toBeNull()
    const resumed = createMireglassWorldFromState(restored!)
    expect(resumed.state).toEqual(world.state)
    expect(resumed.act({ type: 'traverse_route', siteId: bridge.id, from: 'from' }))
      .toEqual(world.act({ type: 'traverse_route', siteId: bridge.id, from: 'from' }))
  })

  it('refuses malformed, v5, foreign-seed, and foreign-revision saves', () => {
    const bytes = serializeMireglassWorld(source())
    expect(parseMireglassWorld('{', seed)).toBeNull()
    expect(parseMireglassWorld(bytes, 'another-seed')).toBeNull()
    expect(parseMireglassWorld(bytes, '')).toBeNull()
    expect(parseMireglassWorld(serializeWizardWorld(createGeneratedWorld(seed)), seed)).toBeNull()
    expect(parseMireglassWorld(mutate((save) => { save.schemaVersion = 'wizard-world/v5' }), seed)).toBeNull()
    expect(parseMireglassWorld(mutate((save) => { save.contentRevision = 'mireglass-reach-v2' }), seed)).toBeNull()
    expect(parseMireglassWorld(mutate((save) => { save.expedition.seed = 'another-seed' }), seed)).toBeNull()
    expect(parseMireglassWorld(mutate((save) => { save.unknown = true }), seed)).toBeNull()
  })

  it('rejects nonfinite or non-safe physics and forged discoveries', () => {
    const invalid: Array<(save: any) => void> = [
      (save) => { save.tick = Number.MAX_SAFE_INTEGER + 1 },
      (save) => { save.tick = -1 },
      (save) => { save.player.position.x = 10_000 },
      (save) => { save.player.position.y = -10_000 },
      (save) => { save.player.position.y = 1_001 },
      (save) => { save.player.yaw = 1_000_001 },
      (save) => { save.player.pitch = Math.PI },
      (save) => { save.player.verticalVelocity = 51 },
      (save) => { save.discoveredTileIds = [] },
      (save) => { save.discoveredTileIds = ['tile-9999-9999', ...save.discoveredTileIds] },
      (save) => { save.discoveredTileIds.push(save.discoveredTileIds[0]) },
    ]
    for (const change of invalid) {
      const bytes = mutate(change)
      expect(parseMireglassWorld(bytes, seed), bytes).toBeNull()
    }
    const nan = structuredClone(source())
    nan.player.position.x = Number.NaN
    expect(() => serializeMireglassWorld(nan)).toThrow('Invalid Mireglass world state')
  })

  it('rejects invented route, resource, stock, item, and progression facts', () => {
    const treeId = mireglassResources(seed)[0].id
    const invalid: Array<(save: any) => void> = [
      (save) => { save.expedition.builtRoutes.bridge = 'invented-site' },
      (save) => { save.expedition.builtRoutes.bridge = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!.id },
      (save) => { save.expedition.depletedResourceIds = ['invented-tree'] },
      (save) => { save.expedition.dugStumpIds = [treeId] },
      (save) => { save.expedition.depletedResourceIds = [treeId] },
      (save) => { save.expedition.cacheExcavated = true },
      (save) => { save.expedition.cacheRevealed = true },
      (save) => { save.expedition.fringeMarkerStudied = true },
      (save) => { save.expedition.shopStock.field_spade = 99 },
      (save) => { save.expedition.shopStock.field_spade = 2 },
      (save) => { save.expedition.shopStock['mireglass_reach/item/waders'] = 1 },
      (save) => { save.player.inventory.push({ itemId: 'mireglass_reach/item/seal', quantity: 1 }) },
      (save) => { save.player.inventory.push({ itemId: 'invented-item', quantity: 1 }) },
      (save) => { save.player.inventory[0].extra = 1 },
      (save) => { save.expedition.builtRoutes.other = 'invented-site' },
    ]
    for (const change of invalid) {
      const bytes = mutate(change)
      expect(parseMireglassWorld(bytes, seed), bytes).toBeNull()
    }
  })
})
