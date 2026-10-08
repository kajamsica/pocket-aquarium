import { describe, expect, it } from 'vitest'
import { areaAt, createGeneratedWorld, STORE_HALF_DEPTH, STORE_HALF_WIDTH, terrainHeightAt } from './generation'
import { isRestorableWizardSave, restoreWizardWorld, serializeWizardWorld } from './persistence'
import type { WizardWorldState } from './types'
import { advanceWizardWorld } from './world'

function asLegacySave(state: WizardWorldState, version: 'wizard-world/v1' | 'wizard-world/v2' | 'wizard-world/v3') {
  const save = JSON.parse(serializeWizardWorld(state)) as Record<string, unknown>
  const player = save.player as Record<string, unknown>
  const stores = save.stores as Array<{ listings: Array<{ id: string }> }>
  save.schemaVersion = version
  save.contentRevision = version === 'wizard-world/v3' ? 'greenway-region-v1' : undefined
  stores[0].listings = stores[0].listings.filter((listing) => listing.id !== 'spade')
  for (const field of ['inscriptions', 'digSites', 'studiedInscriptionIds', 'revealedDigSiteIds', 'excavatedDigSiteIds']) delete save[field]
  delete player.skillXp
  delete player.learnedSpellIds
  if (version === 'wizard-world/v1') {
    for (const field of ['generationProfile', 'areas', 'routes', 'recipes', 'builtRouteIds', 'unlockedRecipeIds', 'discoveredTileIds']) delete save[field]
    delete player.verticalVelocity
  }
  return save
}

describe('wizard generation profiles', () => {
  it('restores an old v2 save without a profile as the exact classic world', () => {
    const classic = createGeneratedWorld('legacy-progress')
    classic.tick = 17
    classic.eventSequence = 9
    classic.rng.simulation = 123456
    classic.player.coins = 71
    classic.player.xp = 100
    classic.player.level = 2
    classic.player.position = { ...classic.routes[1].to }
    classic.player.inventory.push({ itemId: 'logs', quantity: 3 })
    classic.player.equipment.mainHand = 'woodcutters_axe'
    classic.player.discoveredRingIds = classic.fairyRings.map((ring) => ring.id)
    classic.builtRouteIds = ['greenway_ladder', 'highland_bridge']
    classic.unlockedRecipeIds = ['greenway_ladder', 'highland_bridge']
    classic.resources[0].health = 0
    classic.resources[0].depleted = true
    classic.resources[0].position = { ...classic.tiles[0].center, x: classic.tiles[0].center.x + 0.1 }
    classic.stores[0].position = { x: -2, y: terrainHeightAt(classic.tiles, -2, 2), z: 2 }
    classic.stores[0].listings[0].stock = 1
    classic.stores[0].listings[0].price = 25
    classic.stores[0].listings[1].stock = 0
    const oldSave = asLegacySave(classic, 'wizard-world/v2')
    delete oldSave.generationProfile

    expect(isRestorableWizardSave(JSON.stringify(oldSave), 'greenway-classic-v1')).toBe(true)
    expect(isRestorableWizardSave(JSON.stringify(oldSave), 'greenway-expanded-v1')).toBe(false)
    const restored = restoreWizardWorld(JSON.stringify(oldSave))
    expect(restored).toEqual(classic)
    expect(restored.schemaVersion).toBe('wizard-world/v4')
    expect(restored.contentRevision).toBe('greenway-region-v2')
    expect(restored.tiles).toHaveLength(49)
    expect(restored.generationProfile).toBe('greenway-classic-v1')
    expect(restored.stores[0].position).toEqual(classic.stores[0].position)
    expect(restored.stores[0].listings.map((listing) => [listing.id, listing.stock])).toEqual([['hat', 1], ['axe', 0], ['spade', 3]])
    expect(restoreWizardWorld(serializeWizardWorld(restored))).toEqual(restored)
    expect(() => restoreWizardWorld(JSON.stringify({ ...oldSave, generationProfile: 'unknown' }))).toThrow('Invalid or unsupported')
  })

  it('migrates an authentic v1 shape without route or area fields and keeps the new systems untouched', () => {
    const classic = createGeneratedWorld('authentic-v1')
    classic.tick = 8
    classic.rng.simulation = 6789
    classic.player.coins = 37
    classic.player.inventory.push({ itemId: 'logs', quantity: 2 })
    classic.resources[0].health = 0
    classic.resources[0].depleted = true
    classic.stores[0].listings[0].stock = 1
    const oldSave = asLegacySave(classic, 'wizard-world/v1')
    oldSave.resources = (oldSave.resources as Array<{ id: string }>).filter((resource) => !resource.id.startsWith('greenway-journey-tree-'))
    expect(isRestorableWizardSave(JSON.stringify(oldSave), 'greenway-classic-v1')).toBe(true)
    expect(isRestorableWizardSave(JSON.stringify(oldSave), 'greenway-expanded-v1')).toBe(false)
    expect(restoreWizardWorld(JSON.stringify(oldSave))).toEqual(classic)
    expect(isRestorableWizardSave(JSON.stringify({ ...oldSave, stores: [] }), 'greenway-classic-v1')).toBe(false)
  })

  it('clears a legacy tree from a new dig site without losing its depletion or rewriting the source', () => {
    const world = createGeneratedWorld('old-tree-position')
    const oldSave = asLegacySave(world, 'wizard-world/v3')
    const resource = (oldSave.resources as Array<{ position: { x: number; y: number; z: number }; health: number; depleted: boolean }>)[0]
    resource.position = { ...world.digSites[0].position }
    resource.health = 0
    resource.depleted = true
    const bytes = JSON.stringify(oldSave)
    const restored = restoreWizardWorld(bytes)
    expect(restored.resources[0].health).toBe(0)
    expect(restored.resources[0].depleted).toBe(true)
    expect(Math.hypot(restored.resources[0].position.x - world.digSites[0].position.x,
      restored.resources[0].position.z - world.digSites[0].position.z)).toBeGreaterThanOrEqual(1.5)
    expect(JSON.stringify(oldSave)).toBe(bytes)
  })

  it('keeps new landmarks clear of the original v1 shop and ring anchors', () => {
    const oldSave = asLegacySave(createGeneratedWorld('original-v1-anchors'), 'wizard-world/v1')
    oldSave.resources = (oldSave.resources as Array<{ id: string }>).filter((resource) => !resource.id.startsWith('greenway-journey-tree-'))
    const stores = oldSave.stores as Array<{ position: { x: number; y: number; z: number } }>
    const rings = oldSave.fairyRings as Array<{ position: { x: number; y: number; z: number } }>
    stores[0].position = { x: -2, y: 0, z: 2 }
    stores[1].position = { x: 8, y: 0, z: 8 }
    rings[1].position = { x: 8, y: 0, z: 8 }
    const restored = restoreWizardWorld(JSON.stringify(oldSave))
    for (const landmark of [...restored.inscriptions, ...restored.digSites]) {
      for (const store of restored.stores) {
        expect(Math.abs(landmark.position.x - store.position.x) > STORE_HALF_WIDTH
          || Math.abs(landmark.position.z - store.position.z) > STORE_HALF_DEPTH).toBe(true)
      }
      for (const ring of restored.fairyRings) {
        expect(Math.hypot(landmark.position.x - ring.position.x,
          landmark.position.z - ring.position.z)).toBeGreaterThanOrEqual(1.5)
      }
    }
  })

  it('migrates expanded v2 progress without changing the generated region or player', () => {
    const expanded = createGeneratedWorld('expanded-legacy', 'greenway-expanded-v1')
    expanded.tick = 23
    expanded.eventSequence = 12
    expanded.rng.simulation = 876543
    expanded.player.coins = 93
    expanded.player.inventory.push({ itemId: 'logs', quantity: 5 })
    expanded.player.equipment.mainHand = 'woodcutters_axe'
    expanded.resources[0].health = 0
    expanded.resources[0].depleted = true
    expanded.stores[1].listings[0].stock = 1
    expanded.builtRouteIds = ['greenway_ladder']
    expanded.discoveredTileIds = [...new Set([...expanded.discoveredTileIds, expanded.tiles[0].id])].sort()
    const oldSave = asLegacySave(expanded, 'wizard-world/v2')

    expect(isRestorableWizardSave(JSON.stringify(oldSave), 'greenway-expanded-v1')).toBe(true)
    expect(isRestorableWizardSave(JSON.stringify(oldSave), 'greenway-classic-v1')).toBe(false)
    expect(restoreWizardWorld(JSON.stringify(oldSave))).toEqual(expanded)
  })

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)('requires an exact v4 revision and structural save fields for %s', (profile) => {
    const current = createGeneratedWorld('guarded-save', profile)
    current.tick = 6
    current.player.coins = 92
    current.resources[0].health = 0
    current.resources[0].depleted = true
    current.stores[0].listings[0].stock = 1
    const serialized = serializeWizardWorld(current)
    const raw = JSON.parse(serialized) as Record<string, unknown>
    const otherProfile = profile === 'greenway-classic-v1' ? 'greenway-expanded-v1' : 'greenway-classic-v1'
    expect(isRestorableWizardSave(serialized, profile)).toBe(true)
    expect(isRestorableWizardSave(serialized, otherProfile)).toBe(false)
    const missing = (field: string) => { const copy = { ...raw }; delete copy[field]; return JSON.stringify(copy) }
    const altered = (change: (copy: Record<string, unknown>) => void) => {
      const copy = JSON.parse(serialized) as Record<string, unknown>
      change(copy)
      return JSON.stringify(copy)
    }
    const invalid = [
      'not-json', 'null', '[]',
      JSON.stringify({ ...raw, schemaVersion: 'wizard-world/v5' }),
      JSON.stringify({ ...raw, contentRevision: 'unknown' }),
      JSON.stringify({ ...raw, generationProfile: 'unknown' }),
      JSON.stringify({ ...raw, seed: '' }),
      JSON.stringify({ ...raw, player: {} }),
      missing('contentRevision'), missing('generationProfile'), missing('tiles'), missing('resources'),
      missing('stores'), missing('fairyRings'), missing('areas'), missing('rng'),
      missing('routes'), missing('recipes'), missing('builtRouteIds'), missing('unlockedRecipeIds'), missing('discoveredTileIds'),
      missing('inscriptions'), missing('digSites'), missing('studiedInscriptionIds'), missing('revealedDigSiteIds'), missing('excavatedDigSiteIds'),
      JSON.stringify({ ...raw, player: { ...(raw.player as object), skillXp: undefined } }),
      JSON.stringify({ ...raw, player: { ...(raw.player as object), learnedSpellIds: undefined } }),
      altered((copy) => { (copy.stores as Array<{ listings: unknown[] }>)[0].listings.pop() }),
      altered((copy) => { (copy.tiles as Array<{ id: string }>)[0].id = 'unknown-tile' }),
      altered((copy) => { (copy.digSites as Array<{ id: string }>)[1].id = 'practice_mound' }),
      altered((copy) => { ((copy.player as Record<string, unknown>).skillXp as Record<string, unknown>).excavation = -1 }),
      altered((copy) => { (copy.inscriptions as Array<{ position: { x: number } }>)[0].position.x = -2 }),
    ]
    for (const save of invalid) {
      expect(isRestorableWizardSave(save, profile), save).toBe(false)
      expect(() => restoreWizardWorld(save), save).toThrow('Invalid or unsupported')
    }

    const v2 = asLegacySave(current, 'wizard-world/v2')
    expect(isRestorableWizardSave(JSON.stringify(v2), profile)).toBe(true)
    const missingRoute = { ...v2 }
    delete missingRoute.builtRouteIds
    expect(isRestorableWizardSave(JSON.stringify(missingRoute), profile)).toBe(false)
    expect(isRestorableWizardSave(JSON.stringify({ ...v2, rng: {} }), profile)).toBe(false)

    const v3 = asLegacySave(current, 'wizard-world/v3')
    expect(isRestorableWizardSave(JSON.stringify(v3), profile)).toBe(true)
    expect(restoreWizardWorld(JSON.stringify(v3))).toEqual(current)
    expect(isRestorableWizardSave(JSON.stringify({ ...v3, contentRevision: 'greenway-region-v2' }), profile)).toBe(false)
    expect(isRestorableWizardSave(JSON.stringify({ ...v3, contentRevision: undefined }), profile)).toBe(false)
    expect(isRestorableWizardSave(JSON.stringify({ ...v3, stores: [] }), profile)).toBe(false)
  })

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)('round-trips v4 discovery progress for %s', (profile) => {
    const current = createGeneratedWorld('excavated-progress', profile)
    current.tick = 89
    current.eventSequence = 41
    current.player.skillXp = { woodcutting: 20, construction: 60, wayfinding: 90, spellcraft: 50, excavation: 70 }
    current.player.learnedSpellIds = ['wayfinder_glow']
    current.studiedInscriptionIds = ['greenway_waystone']
    current.revealedDigSiteIds = ['ridge_cache']
    current.excavatedDigSiteIds = ['practice_mound', 'ridge_cache']
    current.player.inventory.push({ itemId: 'field_spade', quantity: 1 }, { itemId: 'ancient_relic', quantity: 1 })
    current.player.equipment.mainHand = 'field_spade'
    current.stores[0].listings[2].stock = 2
    expect(restoreWizardWorld(serializeWizardWorld(current))).toEqual(current)
  })

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)('preserves invalid v4 pack bytes without autosave for %s', (profile) => {
    const current = createGeneratedWorld('pack-capacity-guard', profile)
    current.player.inventory = [{ itemId: 'woodcutters_axe', quantity: 1 }, { itemId: 'logs', quantity: 17 }]
    current.player.tradeSlots[0] = { slotIndex: 0, itemId: 'logs', quantity: 2, unitPrice: 7 }
    const validBytes = serializeWizardWorld(current)
    expect(restoreWizardWorld(validBytes)).toEqual(current)
    const altered = (change: (player: WizardWorldState['player']) => void) => {
      const copy = JSON.parse(validBytes) as WizardWorldState
      change(copy.player)
      return JSON.stringify(copy)
    }
    const malformed = [
      altered((player) => { player.backpackCapacity = 0 }),
      altered((player) => { player.backpackCapacity = 1_001 }),
      altered((player) => { player.inventory[1].quantity = 18 }),
      altered((player) => { player.tradeSlots[0].quantity = 3 }),
      altered((player) => { player.tradeSlots[1].quantity = 1 }),
    ]
    for (const originalBytes of malformed) {
      let storedBytes = originalBytes
      let writeCount = 0
      for (let tick = 0; tick < 5; tick += 1) {
        if (isRestorableWizardSave(storedBytes, profile)) {
          storedBytes = serializeWizardWorld(restoreWizardWorld(storedBytes))
          writeCount += 1
        }
      }
      expect(isRestorableWizardSave(originalBytes, profile), originalBytes).toBe(false)
      expect(() => restoreWizardWorld(originalBytes), originalBytes).toThrow('Invalid or unsupported')
      expect(writeCount, originalBytes).toBe(0)
      expect(storedBytes, originalBytes).toBe(originalBytes)
    }
  })

  it.each([
    ['wizard-world/v1', 'greenway-classic-v1'],
    ['wizard-world/v2', 'greenway-classic-v1'],
    ['wizard-world/v2', 'greenway-expanded-v1'],
    ['wizard-world/v3', 'greenway-classic-v1'],
    ['wizard-world/v3', 'greenway-expanded-v1'],
  ] as const)('rejects incomplete %s %s payloads before guarded autosave', (version, profile) => {
    const current = createGeneratedWorld(`incomplete-${version}-${profile}`, profile)
    current.resources[0].health = 0
    current.resources[0].depleted = true
    current.stores[0].listings[0].stock = 1
    const source = asLegacySave(current, version)
    if (version === 'wizard-world/v1') source.resources = (source.resources as Array<{ id: string }>)
      .filter((resource) => !resource.id.startsWith('greenway-journey-tree-'))
    const validBytes = JSON.stringify(source)
    expect(isRestorableWizardSave(validBytes, profile)).toBe(true)

    for (const tamper of ['missing-resource', 'duplicate-resource', 'missing-listing', 'duplicate-listing'] as const) {
      const payload = JSON.parse(validBytes) as Record<string, unknown>
      const resources = payload.resources as Array<{ id: string }>
      const listings = (payload.stores as Array<{ listings: Array<{ id: string }> }>)[0].listings
      if (tamper === 'missing-resource') resources.splice(0, 1)
      if (tamper === 'duplicate-resource') resources[0] = { ...resources[1] }
      if (tamper === 'missing-listing') listings.splice(0, 1)
      if (tamper === 'duplicate-listing') listings[0] = { ...listings[1] }
      const originalBytes = JSON.stringify(payload)
      let storedBytes = originalBytes
      let writeCount = 0
      for (let tick = 0; tick < 5; tick += 1) {
        if (isRestorableWizardSave(storedBytes, profile)) {
          storedBytes = serializeWizardWorld(restoreWizardWorld(storedBytes))
          writeCount += 1
        }
      }
      expect(isRestorableWizardSave(originalBytes, profile), tamper).toBe(false)
      expect(() => restoreWizardWorld(originalBytes), tamper).toThrow('Invalid or unsupported')
      expect(writeCount, tamper).toBe(0)
      expect(storedBytes, tamper).toBe(originalBytes)
    }
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

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)('generates fixed v4 discovery content for %s', (profile) => {
    const world = createGeneratedWorld('discovery-content', profile)
    expect(world.schemaVersion).toBe('wizard-world/v4')
    expect(world.contentRevision).toBe('greenway-region-v2')
    expect(world.inscriptions.map((inscription) => [inscription.id, inscription.position.x, inscription.position.z, inscription.spellId]))
      .toEqual([['greenway_waystone', 3, 3, 'wayfinder_glow']])
    expect(world.digSites.map((site) => [site.id, site.position.x, site.position.z, site.visibleFromStart,
      site.minimumExcavationLevel, site.reward, site.xpReward])).toEqual([
      ['practice_mound', 7, 3, true, 1, { itemId: 'stone', quantity: 2 }, 30],
      ['ridge_cache', -6, -9, false, 2, { itemId: 'ancient_relic', quantity: 1 }, 40],
    ])
    expect(world.stores[0].listings.find((listing) => listing.id === 'spade')).toEqual({
      id: 'spade', itemId: 'field_spade', price: 18, stock: 3,
    })
    expect(world.player.skillXp).toEqual({ woodcutting: 0, construction: 0, wayfinding: 0, spellcraft: 0, excavation: 0 })
    expect(world.player.learnedSpellIds).toEqual([])
    expect(world.studiedInscriptionIds).toEqual([])
    expect(world.revealedDigSiteIds).toEqual([])
    expect(world.excavatedDigSiteIds).toEqual([])
    const oldShop = { x: -2, z: 2 }
    expect(Math.abs(world.inscriptions[0].position.x - oldShop.x) > STORE_HALF_WIDTH
      || Math.abs(world.inscriptions[0].position.z - oldShop.z) > STORE_HALF_DEPTH).toBe(true)
  })

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
        ...expanded.fairyRings.map((ring) => ring.position), ...expanded.inscriptions.map((inscription) => inscription.position),
        ...expanded.digSites.map((site) => site.position), ...expanded.routes.flatMap((route) => [route.from, route.to])]
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
