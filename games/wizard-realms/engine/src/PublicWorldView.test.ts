import { describe, expect, it } from 'vitest'
import { terrainHeightAt } from './domain/generation'
import { resolveFieldCampSite } from './domain/fieldCamp'
import { MIREGLASS_RING_ID, mireglassAnchors, mireglassFairyRing } from './domain/mireglassContent'
import { mireglassRouteSites } from './domain/mireglassRouteSites'
import { advancePublicWorld } from './domain/publicWorldRuntime'
import { createFreshPublicWorld, type PublicWorldState } from './domain/publicWorldState'
import { createStreamedWorld } from './domain/streamedWorld'
import { PUBLIC_V7_SCHEMA, parsePublicV7PlayableRoot, serializePublicV7World, withFreshPublicV7Herbs } from './domain/publicWorldV7'
import { WORLD_GRID_MAX, WORLD_GRID_MIN, worldTileAtGrid } from './domain/worldChunks'
import { publicWorldOverview, publicWorldViewProjection } from './PublicWorldView'
import type { WizardFieldCampView } from './view/contracts'

const seed = 'greenway-alpha'

describe('public v6 read-only view adapter', () => {
  it('omits the optional camp contract and markers for older callers', () => {
    const state = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const view = publicWorldViewProjection(state, [], null)
    expect(view).not.toHaveProperty('fieldCamp')
    expect(view.map.tiles.every((tile) => !Object.hasOwn(tile, 'hasCamp'))).toBe(true)
    expect(publicWorldOverview(state).cells.flatMap((cell) => cell.markers)).not.toContain('Field camp')
  })

  it('maps a camp by canonical tile ID and keeps its lazy overview consistent across travel', () => {
    const site = resolveFieldCampSite(seed, worldTileAtGrid(seed, -76, 100).id)!
    const { x, y, z } = site.tile.center
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const streamed = createStreamedWorld(seed, site.tile.center)
    const state: PublicWorldState = { ...fresh, movementOwner: 'streamed',
      player: { ...fresh.player, position: streamed.state.player.position },
      discoveredTileIds: [site.tileId] }
    const fieldCamp: WizardFieldCampView = { camps: [{ tileId: site.tileId, position: [x, y, z] }],
      preview: { tileId: worldTileAtGrid(seed, -70, 100).id, position: null,
        rejection: { code: 'too_far', message: 'The camp site is out of reach.' } }, selectionEnabled: true }
    const before = JSON.stringify(state)
    const view = publicWorldViewProjection(state, [], null, null, fieldCamp)
    expect(view.fieldCamp).toBe(fieldCamp)
    expect(view.map.tiles.filter((tile) => tile.hasCamp).map((tile) => tile.id)).toEqual([site.tileId])
    expect(view.map.tiles.find((tile) => tile.hasCamp)).toMatchObject({
      gridX: site.gridX + 3, gridZ: site.gridZ + 3, discovered: true })
    expect(view.map.tiles.filter((tile) => !tile.discovered).every((tile) =>
      !tile.hasCamp && tile.terrain === null)).toBe(true)
    const overview = view.map.overview!()
    expect(view.map.overview!()).toBe(overview)
    expect(overview).toEqual(publicWorldOverview(state, fieldCamp.camps))
    expect(overview.cells.filter((cell) => cell.markers.includes('Field camp')))
      .toEqual([expect.objectContaining({ gridX: Math.floor(site.gridX / 16),
        gridZ: Math.floor(site.gridZ / 16), discoveredCells: 1, terrain: site.tile.terrain })])
    expect(JSON.stringify(state)).toBe(before)
    const returned = publicWorldViewProjection({ ...state, movementOwner: 'greenway',
      player: fresh.player }, [], null, null, fieldCamp)
    expect(returned.map.tiles.some((tile) => tile.hasCamp)).toBe(false)
    expect(returned.map.overview!().cells.flatMap((cell) => cell.markers)).toContain('Field camp')
    const fogged = publicWorldViewProjection({ ...state, discoveredTileIds: [] }, [], null, null, fieldCamp)
    expect(fogged.map.tiles.some((tile) => tile.hasCamp)).toBe(false)
    expect(fogged.map.overview!().cells.flatMap((cell) => cell.markers)).not.toContain('Field camp')
  })

  it.each([
    ['greenway-classic-v1', -12],
    ['greenway-expanded-v1', -28],
  ] as const)('shows the %s west trail only after studying the waystone without revealing fog', (profile, exitX) => {
    const fresh = createFreshPublicWorld(seed, profile)
    const beforeStudy = publicWorldViewProjection(fresh, [], null)
    expect(beforeStudy.map.tiles.some((tile) => tile.hasWestTrail)).toBe(false)
    expect(beforeStudy.map.guidance).toBeUndefined()
    expect(beforeStudy.landmarks).toBeUndefined()

    const studied: PublicWorldState = { ...fresh,
      greenway: { ...fresh.greenway, studiedInscriptionIds: ['greenway_waystone'] },
      player: { ...fresh.player, learnedSpellIds: ['wayfinder_glow'] } }
    const before = JSON.stringify(studied)
    const view = publicWorldViewProjection(studied, [], null)
    const trailTile = view.map.tiles.find((tile) => tile.hasWestTrail)
    expect(trailTile).toBeDefined()
    expect(trailTile?.gridZ).toBe(3)
    expect(trailTile?.discovered).toBe(studied.discoveredTileIds.includes(trailTile!.id))
    expect(trailTile?.terrain).toEqual(trailTile?.discovered ? expect.any(String) : null)
    expect(view.landmarks).toEqual([expect.objectContaining({
      id: 'greenway/landmark/west_trail_gate', kind: 'west-trail-gate',
      position: [exitX + 1.5, expect.any(Number), 0],
    })])
    expect(view.map.legend).toContain('⇦ west trail to Mireglass')
    expect(view.map.guidance).toBe("Next: Head north to the fog at Greenway's edge, then cast Wayfinder Glow.")
    expect(JSON.stringify(studied)).toBe(before)
  })

  it.each([
    ['Greenway', 0, 0],
    ['Northern Ridge', 0, -8],
    ['Eastern Highland', 8, -8],
  ] as const)('names %s while keeping the active Greenway lesson ahead of the west trail',
    (title, x, z) => {
      const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
      const state: PublicWorldState = { ...fresh,
        greenway: { ...fresh.greenway, studiedInscriptionIds: ['greenway_waystone'] },
        player: { ...fresh.player, learnedSpellIds: ['wayfinder_glow'],
          position: { x, y: terrainHeightAt(fresh.greenway.tiles, x, z), z } } }
      const projection = publicWorldViewProjection(state, [], null)
      expect(projection.map.title).toBe(title)
      expect(projection.map.guidance).toBe("Next: Head north to the fog at Greenway's edge, then cast Wayfinder Glow.")
      expect(projection.map.tiles.find((tile) => tile.hasWestTrail)?.terrain).toEqual(
        projection.map.tiles.find((tile) => tile.hasWestTrail)?.discovered ? expect.any(String) : null)
    })

  it('keeps the live fresh-player Glow lesson on M at x -1.4, z -4', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const state: PublicWorldState = { ...fresh,
      greenway: { ...fresh.greenway, studiedInscriptionIds: ['greenway_waystone'] },
      player: { ...fresh.player, learnedSpellIds: ['wayfinder_glow'],
        position: { x: -1.4, y: terrainHeightAt(fresh.greenway.tiles, -1.4, -4), z: -4 } } }
    const view = publicWorldViewProjection(state, [], null)
    expect(view.map.guidance).toBe("Next: Head north to the fog at Greenway's edge, then cast Wayfinder Glow.")
    expect(view.map.guidance).not.toContain('West to Mireglass')
  })

  it('shows the west-trail hint after the Greenway quest is complete', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const completed: PublicWorldState = { ...fresh,
      greenway: { ...fresh.greenway,
        studiedInscriptionIds: ['greenway_waystone'],
        excavatedDigSiteIds: ['practice_mound', 'ridge_cache'],
        revealedDigSiteIds: ['ridge_cache'],
        builtRouteIds: ['greenway_ladder', 'highland_bridge'] },
      player: { ...fresh.player,
        learnedSpellIds: ['wayfinder_glow'],
        skillXp: { ...fresh.player.skillXp, spellcraft: 10 },
        discoveredRingIds: ['ring-greenway', 'ring-highland'] } }
    expect(publicWorldViewProjection(completed, [], null).map.guidance)
      .toBe('West to Mireglass: follow the marked dry gap near z≈0, about 12 m from here.')
  })

  it('projects only saved discoveries into a bounded world overview and preserves fog on reload', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const outpost = mireglassAnchors(seed).salvager.tile
    const remoteId = worldTileAtGrid(seed, WORLD_GRID_MAX, WORLD_GRID_MAX).id
    const state = withFreshPublicV7Herbs({ ...fresh,
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds, outpost.id, remoteId])].sort() })
    const before = JSON.stringify(state)
    const overview = publicWorldOverview(state)
    expect(overview.cells.length).toBeLessThanOrEqual(32 * 32)
    expect(overview.cells.reduce((count, cell) => count + cell.discoveredCells, 0))
      .toBe(state.discoveredTileIds.length)
    const outpostChunk = overview.cells.find((cell) => cell.markers.includes('Mireglass salvager'))
    expect(outpostChunk).toMatchObject({ discoveredCells: 1, terrain: outpost.terrain, biome: outpost.biome })
    const fog = overview.cells.find((cell) => cell.id === 'chunk--2-1')
    expect(fog).toMatchObject({ discoveredCells: 0, terrain: null, biome: null, markers: [] })
    expect(JSON.stringify(state)).toBe(before)

    const bytes = serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA, saveRevision: 0,
      bootstrap: null, migrationSourceV6Bytes: null, state })
    const restored = parsePublicV7PlayableRoot(bytes)
    expect(restored).not.toBeNull()
    expect(publicWorldOverview(restored!.state)).toEqual(overview)
    expect(publicWorldViewProjection(restored!.state, [], null).map.overview?.()).toEqual(overview)

    const firstView = publicWorldViewProjection(state, [], null)
    expect(firstView.map.overview?.()).toBe(firstView.map.overview?.())
    const bridge = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const built = { ...state, mireglass: { ...state.mireglass,
      builtRoutes: { ...state.mireglass.builtRoutes, bridge: bridge.id } } }
    const builtOverview = publicWorldViewProjection(built, [], null).map.overview?.()
    expect(overview.cells.flatMap((cell) => cell.markers)).not.toContain('bridge built')
    expect(builtOverview?.cells.flatMap((cell) => cell.markers)).toContain('bridge built')

    const edges = publicWorldOverview({ ...fresh, discoveredTileIds: [
      worldTileAtGrid(seed, WORLD_GRID_MIN, WORLD_GRID_MIN).id, remoteId,
    ] })
    expect(edges.cells).toHaveLength(32 * 32)
    expect(edges.cells.filter((cell) => cell.discoveredCells > 0)).toHaveLength(2)
    expect(edges.cells.filter((cell) => cell.discoveredCells === 0).every((cell) =>
      cell.terrain === null && cell.biome === null)).toBe(true)
  })

  it.each([
    ['greenway-classic-v1', -12, 49],
    ['greenway-expanded-v1', -30, 256],
  ] as const)('projects the %s Greenway save and edge without changing authority', (profile, edgeX, tileCount) => {
    const fresh = createFreshPublicWorld(seed, profile)
    const greenway = structuredClone(fresh.greenway)
    greenway.stores[0].listings[0].stock = 1
    const edge: PublicWorldState = { ...fresh, greenway, player: { ...fresh.player,
      position: { x: edgeX, y: terrainHeightAt(fresh.greenway.tiles, edgeX, 0), z: 0 },
      coins: 73 } }
    const before = JSON.stringify(edge)
    const view = publicWorldViewProjection(edge, ['Old Greenway progress'], null)
    expect(view.player.position).toEqual([edgeX, edge.player.position.y, 0])
    expect(view.terrain).toHaveLength(tileCount)
    expect(view.map.tiles).toHaveLength(tileCount)
    expect(view.stores).toHaveLength(2)
    expect(view.stores[0].listings[0].stock).toBe(1)
    expect(view.coins).toBe(73)
    expect(view.recentEvents).toEqual(['Old Greenway progress'])
    expect(JSON.stringify(edge)).toBe(before)
    expect(edge.movementOwner).toBe('greenway')
  })

  it('keeps a returned Mireglass item visible in Greenway inventory and equipment', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const returned: PublicWorldState = { ...fresh, player: { ...fresh.player,
      inventory: [...fresh.player.inventory,
        { itemId: 'mireglass_reach/item/waders', quantity: 1 },
        { itemId: 'mireglass_reach/item/seal', quantity: 1 }],
      equipment: { ...fresh.player.equipment, feet: 'mireglass_reach/item/waders' } } }
    const before = JSON.stringify(returned)
    const view = publicWorldViewProjection(returned, [], null)
    expect(view.backpack.stacks).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'mireglass_reach/item/waders', name: 'Fen waders', equippableSlots: ['feet'] }),
      expect.objectContaining({ itemId: 'mireglass_reach/item/seal', name: 'Mireglass seal' }),
    ]))
    expect(view.equipment.feet).toMatchObject({ itemId: 'mireglass_reach/item/waders', name: 'Fen waders' })
    expect(JSON.stringify(returned)).toBe(before)
  })

  it('lists Mireglass travel only at the Greenway ring after its remote ring was discovered', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const before = publicWorldViewProjection(fresh, [], null)
    expect(before.fairyRings.flatMap((ring) => ring.destinations).some((target) =>
      target.ringId === MIREGLASS_RING_ID)).toBe(false)
    const discovered: PublicWorldState = { ...fresh, player: { ...fresh.player,
      discoveredRingIds: ['ring-greenway', MIREGLASS_RING_ID] } }
    const after = publicWorldViewProjection(discovered, [], null)
    expect(after.fairyRings.find((ring) => ring.id === 'ring-greenway')?.destinations)
      .toContainEqual({ ringId: MIREGLASS_RING_ID, label: 'Mireglass Ring', discovered: true })
    expect(after.fairyRings.find((ring) => ring.id === 'ring-highland')?.destinations.some((target) =>
      target.ringId === MIREGLASS_RING_ID)).toBe(false)
  })

  it('switches to the streamed Mireglass map and landmark without a second player', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const outboundEdge: PublicWorldState = { ...fresh, player: { ...fresh.player,
      position: { x: -12, y: terrainHeightAt(fresh.greenway.tiles, -12, 0), z: 0 } } }
    const crossed = advancePublicWorld(outboundEdge, { type: 'move', delta: { x: -4, z: 0 } })
    expect(crossed.rejections).toEqual([])
    const approach = publicWorldViewProjection(crossed.state, [], null)
    expect(approach.map.title).toContain('Mireglass')
    expect(approach.player.position).toEqual([
      crossed.state.player.position.x, crossed.state.player.position.y, crossed.state.player.position.z,
    ])
    expect(approach.map.tiles.length).toBeGreaterThan(49)
    expect(approach.terrain.some((cell) => cell.mireglassTrailSegment)).toBe(true)
    expect(approach.map.tiles.some((tile) => tile.hasFrontierTrail && !tile.discovered && tile.terrain === null)).toBe(true)
    expect(approach.map.legend).toContain('· dry frontier trail')

    const marker = mireglassAnchors(seed).fringeMarker.tile.center
    const streamed = createStreamedWorld(seed, marker)
    const bridge = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const atMarker: PublicWorldState = { ...crossed.state,
      player: { ...crossed.state.player, position: streamed.state.player.position,
        inventory: [...crossed.state.player.inventory,
          { itemId: 'mireglass_reach/item/waders', quantity: 1 }],
        equipment: { ...crossed.state.player.equipment, feet: 'mireglass_reach/item/waders' } },
      discoveredTileIds: [...streamed.state.discoveredTileIds],
      mireglass: { ...crossed.state.mireglass, fringeMarkerStudied: true,
        builtRoutes: { ...crossed.state.mireglass.builtRoutes, bridge: bridge.id } } }
    const before = JSON.stringify(atMarker)
    const view = publicWorldViewProjection(atMarker, ['Marker studied'], null)
    expect(view.map.title).toContain('Mireglass')
    expect(view.landmarks).toContainEqual(expect.objectContaining({ kind: 'frontier-marker', studied: true }))
    expect(view.routes.find((route) => route.id === bridge.routeId)?.built).toBe(true)
    expect(view.recentEvents).toEqual(['Marker studied'])
    expect(view.backpack.stacks[0]?.itemId).toBe(atMarker.player.inventory[0]?.itemId)
    expect(view.equipment.feet).toMatchObject({ itemId: 'mireglass_reach/item/waders', name: 'Fen waders' })
    expect(JSON.stringify(atMarker)).toBe(before)
  })

  it('reuses the bounded presentation terrain until the active chunk window or seed changes', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const firstStream = createStreamedWorld(seed, { x: -120, z: 130 })
    const firstState: PublicWorldState = { ...fresh, movementOwner: 'streamed',
      player: { ...fresh.player, position: firstStream.state.player.position },
      discoveredTileIds: firstStream.state.discoveredTileIds }
    const before = JSON.stringify(firstState)
    const first = publicWorldViewProjection(firstState, [], null)
    const repeated = publicWorldViewProjection(firstState, [], null)
    expect(repeated.terrain).toBe(first.terrain)
    expect(JSON.stringify(firstState)).toBe(before)

    const nextStream = createStreamedWorld(seed, { x: -40, z: 130 })
    const nextState: PublicWorldState = { ...firstState,
      player: { ...firstState.player, position: nextStream.state.player.position },
      discoveredTileIds: nextStream.state.discoveredTileIds }
    const next = publicWorldViewProjection(nextState, [], null)
    expect(next.terrain).not.toBe(first.terrain)
    expect(next.map.tiles.some((tile) => tile.id === nextStream.tileAtWorld(-40, 130)?.id)).toBe(true)

    const otherSeed = 'mireglass-other-seed'
    const otherStream = createStreamedWorld(otherSeed, { x: -40, z: 130 })
    const other = publicWorldViewProjection({ ...nextState, seed: otherSeed,
      player: { ...nextState.player, position: otherStream.state.player.position },
      discoveredTileIds: otherStream.state.discoveredTileIds }, [], null)
    expect(other.terrain).not.toBe(next.terrain)
  })

  it('marks only the revealed seal cache on the current streamed map', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const cache = mireglassAnchors(seed).sealCache.tile.center
    const streamed = createStreamedWorld(seed, cache)
    const atCache: PublicWorldState = { ...fresh, movementOwner: 'streamed',
      player: { ...fresh.player, position: streamed.state.player.position },
      discoveredTileIds: [...streamed.state.discoveredTileIds],
      mireglass: { ...fresh.mireglass, cacheRevealed: true } }
    const view = publicWorldViewProjection(atCache, [], null)
    expect(view.landmarks).toContainEqual(expect.objectContaining({ kind: 'seal-cache', revealed: true, excavated: false }))
    expect(view.map.tiles.filter((tile) => tile.hasCache).map((tile) => tile.id)).toEqual([mireglassAnchors(seed).sealCache.tile.id])
  })

  it('renders the active outpost ring, maps it only on discovered terrain, and gates the return path', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const ring = mireglassFairyRing(seed)
    const streamed = createStreamedWorld(seed, ring.tile.center)
    const atRing: PublicWorldState = { ...fresh, movementOwner: 'streamed',
      player: { ...fresh.player, position: streamed.state.player.position },
      discoveredTileIds: [...streamed.state.discoveredTileIds] }
    const before = JSON.stringify(atRing)
    const unlinked = publicWorldViewProjection(atRing, [], null)
    expect(unlinked.fairyRings).toEqual([expect.objectContaining({
      id: MIREGLASS_RING_ID, discovered: false, destinations: [],
    })])
    expect(unlinked.nearbyInteraction).toMatchObject({ kind: 'fairy-ring', action: 'Discover', actionable: true })
    expect(unlinked.map.tiles.filter((tile) => tile.hasRing).map((tile) => tile.id)).toEqual([ring.tile.id])
    const adjacent = createStreamedWorld(seed, { x: ring.tile.center.x + 4, z: ring.tile.center.z })
    const fogged = publicWorldViewProjection({ ...atRing,
      player: { ...atRing.player, position: adjacent.state.player.position },
      discoveredTileIds: adjacent.state.discoveredTileIds }, [], null)
    expect(fogged.fairyRings).toHaveLength(1)
    expect(fogged.map.tiles.filter((tile) => tile.hasRing)).toEqual([])
    const discovered: PublicWorldState = { ...atRing, player: { ...atRing.player,
      discoveredRingIds: [MIREGLASS_RING_ID] } }
    expect(publicWorldViewProjection(discovered, [], null).fairyRings[0].destinations).toEqual([])
    const linked: PublicWorldState = { ...discovered, player: { ...discovered.player,
      discoveredRingIds: ['ring-greenway', MIREGLASS_RING_ID] } }
    const view = publicWorldViewProjection(linked, [], null)
    expect(view.fairyRings[0].destinations).toEqual([
      { ringId: 'ring-greenway', label: 'Greenway Ring', discovered: true },
    ])
    expect(view.nearbyInteraction).toMatchObject({ action: 'Choose destination', actionable: false })
    expect(JSON.stringify(atRing)).toBe(before)
  })
})
