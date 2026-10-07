import { describe, expect, it } from 'vitest'
import { areaAt, createGeneratedWorld, STORE_HALF_DEPTH, STORE_HALF_WIDTH, terrainHeightAt } from './generation'
import { restoreWizardWorld, serializeWizardWorld } from './persistence'
import { advanceWizardWorld } from './world'

describe('wizard generation profiles', () => {
  it('restores an old v2 save without a profile as the exact classic world', () => {
    const classic = createGeneratedWorld('legacy-progress')
    classic.tick = 17
    classic.player.coins = 71
    classic.player.xp = 100
    classic.player.level = 2
    classic.player.position = { ...classic.routes[1].to }
    classic.player.discoveredRingIds = classic.fairyRings.map((ring) => ring.id)
    classic.builtRouteIds = ['greenway_ladder', 'highland_bridge']
    classic.unlockedRecipeIds = ['greenway_ladder', 'highland_bridge']
    classic.resources[0].health = 0
    classic.resources[0].depleted = true
    classic.resources[0].position = { ...classic.tiles[0].center, x: classic.tiles[0].center.x + 0.1 }
    classic.stores[0].position = { x: -2, y: terrainHeightAt(classic.tiles, -2, 2), z: 2 }
    const oldSave = JSON.parse(serializeWizardWorld(classic)) as Record<string, unknown>
    delete oldSave.generationProfile

    const restored = restoreWizardWorld(JSON.stringify(oldSave))
    expect(restored).toEqual(classic)
    expect(restored.tiles).toHaveLength(49)
    expect(restored.generationProfile).toBe('greenway-classic-v1')
    expect(restored.stores[0].position).toEqual(classic.stores[0].position)
    expect(restoreWizardWorld(serializeWizardWorld(restored))).toEqual(restored)
    expect(restoreWizardWorld(JSON.stringify({ ...oldSave, generationProfile: 'unknown' }))).toEqual(classic)
  })

  it('keeps the fresh Greenway shop visible beside the rear spawn sightline across 100 seeds', () => {
    for (let index = 0; index < 100; index += 1) for (const profile of ['greenway-classic-v1', 'greenway-expanded-v1'] as const) {
      const world = createGeneratedWorld(`region-${index}`, profile)
      const shop = world.stores[0]
      const spawn = world.player.position
      const rearCameraZ = spawn.z + 5.6 // Conservative horizontal reach of the 853x480 compact camera.
      const missesCorridor = (halfWidth: number, halfDepth: number) =>
        Math.abs(shop.position.x - spawn.x) > halfWidth
        || shop.position.z + halfDepth < spawn.z || shop.position.z - halfDepth > rearCameraZ
      expect(world.player.yaw).toBe(0)
      expect(missesCorridor(STORE_HALF_WIDTH, STORE_HALF_DEPTH), `${world.seed}: shop footprint blocks spawn`).toBe(true)
      expect(missesCorridor(2.4, 2.4), `${world.seed}: shop roof blocks spawn`).toBe(true)
      expect(areaAt(world.areas, shop.position.x, shop.position.z).id).toBe('greenway')
      expect(Math.hypot(shop.position.x - spawn.x, shop.position.z - spawn.z)).toBeLessThan(6)
      for (const resource of world.resources) {
        expect(Math.abs(resource.position.x - shop.position.x) >= STORE_HALF_WIDTH + 0.2
          || Math.abs(resource.position.z - shop.position.z) >= STORE_HALF_DEPTH + 0.2,
        `${world.seed}: ${resource.id} overlaps the shop`).toBe(true)
      }
      for (const ring of world.fairyRings) {
        expect(Math.abs(ring.position.x - shop.position.x) >= STORE_HALF_WIDTH + 1.7
          || Math.abs(ring.position.z - shop.position.z) >= STORE_HALF_DEPTH + 1.7,
        `${world.seed}: ${ring.id} overlaps the shop`).toBe(true)
      }
      for (const route of world.routes) {
        expect(Math.max(route.from.x, route.to.x) + 0.7 <= shop.position.x - STORE_HALF_WIDTH
          || Math.min(route.from.x, route.to.x) - 0.7 >= shop.position.x + STORE_HALF_WIDTH
          || Math.max(route.from.z, route.to.z) + 0.7 <= shop.position.z - STORE_HALF_DEPTH
          || Math.min(route.from.z, route.to.z) - 0.7 >= shop.position.z + STORE_HALF_DEPTH,
        `${world.seed}: ${route.id} overlaps the shop`).toBe(true)
      }
    }
  }, 30_000)

  it('builds and restores 100 deterministic 16 by 16 sparse regions without moving the core', () => {
    for (let index = 0; index < 100; index += 1) {
      const seed = `region-${index}`
      const classic = createGeneratedWorld(seed)
      const expanded = createGeneratedWorld(seed, 'greenway-expanded-v1')
      const coreTileIds = new Set(classic.tiles.map((tile) => tile.id))
      const coreResourceIds = new Set(classic.resources.map((resource) => resource.id))
      const coreTiles = expanded.tiles.filter((tile) => coreTileIds.has(tile.id))
      const coreResources = expanded.resources.filter((resource) => coreResourceIds.has(resource.id))

      expect(expanded.generationProfile).toBe('greenway-expanded-v1')
      expect(expanded.tiles).toHaveLength(256)
      expect([Math.min(...expanded.tiles.map((tile) => tile.gridX)), Math.max(...expanded.tiles.map((tile) => tile.gridX))]).toEqual([-4, 11])
      expect([Math.min(...expanded.tiles.map((tile) => tile.gridZ)), Math.max(...expanded.tiles.map((tile) => tile.gridZ))]).toEqual([-4, 11])
      expect(coreTiles).toEqual(classic.tiles)
      expect(coreResources).toEqual(classic.resources)
      expect(expanded.resources.length).toBeLessThanOrEqual(130)
      expect(new Set(expanded.resources.map((resource) => resource.kind))).toEqual(new Set(['tree', 'herb', 'stone', 'ore']))
      const journeyTrees = expanded.resources.filter((resource) => resource.id.startsWith('greenway-journey-tree-'))
      expect(journeyTrees).toHaveLength(4)
      expect(journeyTrees.every((resource) => resource.kind === 'tree' && resource.maxHealth === 2
        && areaAt(expanded.areas, resource.position.x, resource.position.z).id === 'greenway')).toBe(true)
      expect(expanded.stores).toEqual(classic.stores)
      expect(expanded.fairyRings).toEqual(classic.fairyRings)
      expect(expanded.routes).toEqual(classic.routes)
      expect(expanded.discoveredTileIds).toEqual(classic.discoveredTileIds)
      expect(expanded.discoveredTileIds.every((id) => coreTileIds.has(id))).toBe(true)
      for (const tile of expanded.tiles) {
        expect(expanded.areas.some((area) => tile.center.x >= area.minX && tile.center.x <= area.maxX
          && tile.center.z >= area.minZ && tile.center.z <= area.maxZ), `${seed}: ${tile.id} has no area`).toBe(true)
      }
      for (const [x, z] of [[-30, -30], [-30, 34], [34, -30], [34, 34]]) {
        expect(expanded.areas.some((area) => x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ)).toBe(true)
      }

      const landmarks = [expanded.player.position, ...expanded.stores.map((store) => store.position),
        ...expanded.fairyRings.map((ring) => ring.position), ...expanded.routes.flatMap((route) => [route.from, route.to])]
      for (const resource of expanded.resources) {
        for (const anchor of landmarks) {
          expect(Math.hypot(resource.position.x - anchor.x, resource.position.z - anchor.z), `${seed}: ${resource.id}`).toBeGreaterThanOrEqual(1.5)
        }
        for (const store of expanded.stores) {
          const outside = Math.abs(resource.position.x - store.position.x) >= STORE_HALF_WIDTH + 0.2
            || Math.abs(resource.position.z - store.position.z) >= STORE_HALF_DEPTH + 0.2
          expect(outside, `${seed}: ${resource.id} inside ${store.id}`).toBe(true)
        }
      }
      expect(createGeneratedWorld(seed, 'greenway-expanded-v1')).toEqual(expanded)
      expect(restoreWizardWorld(serializeWizardWorld(expanded))).toEqual(expanded)
    }
  }, 30_000)

  it('keeps at least ten starter logs harvestable in the expanded profile', () => {
    let state = createGeneratedWorld('region-starter', 'greenway-expanded-v1')
    state = advanceWizardWorld(state, [{ type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' }]).state
    for (const tree of state.resources.filter((resource) => resource.id.startsWith('greenway-journey-tree-'))) {
      state.player.position = { ...tree.position }
      for (let hit = 0; hit < 2; hit += 1) {
        const result = advanceWizardWorld(state, [{ type: 'harvest', resourceId: tree.id }])
        expect(result.rejections).toEqual([])
        state = result.state
      }
    }
    expect(state.player.inventory.find((stack) => stack.itemId === 'logs')?.quantity).toBeGreaterThanOrEqual(10)
  })
})
