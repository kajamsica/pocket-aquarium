import { describe, expect, it } from 'vitest'
import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mireglassAnchors, mireglassFairyRing, mireglassResources } from './domain/mireglassContent'
import { mireglassHerbPatches } from './domain/mireglassHerbPatches'
import { mireglassApproachTrail, mireglassV42FullApproachTrail } from './domain/mireglassApproachTrail'
import { mireglassBermFaceRowAt } from './domain/mireglassTerrain'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS,
  PUBLIC_SPELL_REVEAL_RADIUS_METERS } from './domain/publicWorldDiscovery'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { applyPublicV24MireglassAction } from './domain/publicWorldV24MireglassAction'
import { createPublicV23Root, type PublicV23Progress } from './domain/publicWorldV23Snapshot'
import { worldTileAtGrid } from './domain/worldChunks'
import type { ReadonlyWorldTile } from './domain/activeWorldTerrain'
import type { PublicV17ActiveView } from './PublicV17WorldView'
import { projectPublicV24Mireglass } from './PublicV24MireglassView'
import type { WizardViewProjection } from './view/contracts'
import { WizardMap } from './view/WizardMap'

const seed = 'wizard-realms'
function at(tile: ReadonlyWorldTile, discovered = true, worldSeed = seed) {
  const head = createPublicV23Root(worldSeed).head
  const player = { ...head.state.player, position: { ...tile.center }, verticalVelocity: 0 }
  const progress: PublicV23Progress = { state: { ...head.state, movementOwner: 'streamed', player },
    greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }
  const active: PublicV17ActiveView = { movementOwner: 'streamed', tick: progress.state.tick,
    player, activeTiles: [tile], activeKnownTileIds: discovered ? [tile.id] : [], pendingBoundary: false }
  const cell = { id: tile.id, position: [tile.center.x, tile.center.y, tile.center.z] as const,
    size: [4, 4] as const, height: tile.center.y, climate: tile.biome }
  const mapTile = { id: tile.id, gridX: tile.gridX, gridZ: tile.gridZ,
    terrain: discovered ? tile.terrain : null, biome: discovered ? tile.biome : null,
    discovered, hasResource: false, hasStore: false, hasRing: false,
    hasRouteSite: false, hasBuiltRoute: false }
  const base = { terrain: [cell], resources: [], stores: [], fairyRings: [], landmarks: [],
    nearbyInteraction: null, starterCliff: {}, unavailableActions: true,
    backpack: { capacity: player.backpackCapacity, stacks: [] },
    savedTerrainWorks: { builtSites: [], dugTileIds: [], preview: null },
    regionalLadders: { builtSites: [], preview: null },
    visualWorld: { terrain: [cell], resources: [], stores: [], fairyRings: [],
      inscriptions: [], digSites: [], landmarks: [], routes: [], buildSites: [],
      discoveredTileIds: discovered ? [tile.id] : [] },
    map: { title: 'mireglass_reach', tiles: [mapTile], player: { gridX: tile.gridX,
      gridZ: tile.gridZ, yaw: 0 } },
  } as unknown as WizardViewProjection
  return { progress, active, base }
}

describe('V24 Mireglass read adapter', () => {
  it.each(['greenway-alpha', 'wizard-realms'])('marks only discovered natural upper shelf in %s', (worldSeed) => {
    const x = -400
    const row = mireglassBermFaceRowAt(worldSeed, x)
    const upper = worldTileAtGrid(worldSeed, x / 4, (row + 12) / 4)
    const rim = worldTileAtGrid(worldSeed, x / 4, row / 4)
    const lower = worldTileAtGrid(worldSeed, x / 4, (row - 4) / 4)
    expect(upper.terrain).toBe('loam')
    expect(rim.terrain).toBe('rocky')
    expect(lower.terrain).toBe('loam')
    const flag = (tile: typeof upper) => {
      const input = at(tile, true, worldSeed)
      return projectPublicV24Mireglass(input.base, input.progress, input.active)
        .projection.map.tiles[0].hasNaturalMireglassShelf
    }
    expect(flag(upper)).toBe(true)
    expect(flag(rim)).toBe(true)
    expect(flag(lower)).toBe(false)

    const hidden = at(upper, false, worldSeed)
    const stale = { ...hidden.base, map: { ...hidden.base.map,
      tiles: [{ ...hidden.base.map.tiles[0], hasNaturalMireglassShelf: true }] } }
    expect(projectPublicV24Mireglass(stale, hidden.progress, hidden.active)
      .projection.map.tiles[0].hasNaturalMireglassShelf).toBe(false)
    const input = at(upper, true, worldSeed)
    const staleKnown = { ...input.active, activeKnownTileIds: [] }
    expect(projectPublicV24Mireglass(input.base, input.progress, staleKnown)
      .projection.map.tiles[0].hasNaturalMireglassShelf).toBe(false)
    const pit = projectPublicV24Mireglass(input.base, { ...input.progress,
      terrain: { columns: [{ gx: upper.center.x / 4, gz: upper.center.z / 4,
        openDepth: 1 }] } }, input.active)
    expect(pit.projection.map.tiles[0].hasNaturalMireglassShelf).toBe(false)
    const loweredMap = { ...input.base, map: { ...input.base.map,
      tiles: [{ ...input.base.map.tiles[0], elevationMeters: upper.center.y - 0.4 }] } }
    expect(projectPublicV24Mireglass(loweredMap, input.progress, input.active)
      .projection.map.tiles[0].hasNaturalMireglassShelf).toBe(false)

    const cache = at(mireglassAnchors(worldSeed).sealCache.tile, true, worldSeed)
    const before = projectPublicV24Mireglass(cache.base, cache.progress, cache.active)
    expect(before.projection.map.tiles[0]).toMatchObject({ hasCache: false,
      hasNaturalMireglassShelf: true })
    const excavated = { ...cache.progress, state: { ...cache.progress.state,
      mireglass: { ...cache.progress.state.mireglass,
        cacheRevealed: true, cacheExcavated: true } } }
    expect(projectPublicV24Mireglass(cache.base, excavated, cache.active)
      .projection.map.tiles[0].hasNaturalMireglassShelf).toBe(false)
  })

  it.each(['greenway-alpha', 'wizard-realms'])('shows only discovered %s trail cells in the local map and accessibility text', (worldSeed) => {
    const trailPoint = mireglassApproachTrail(worldSeed)[8]
    const trailTile = worldTileAtGrid(worldSeed, trailPoint.x / 4, trailPoint.z / 4)
    const known = at(trailTile, true, worldSeed)
    const marked = projectPublicV24Mireglass(known.base, known.progress, known.active)
    expect(marked.projection.map.tiles[0].hasFrontierTrail).toBe(true)
    expect(marked.projection.map.legend).toContain('marked frontier trail')
    const html = renderToStaticMarkup(createElement(WizardMap, { projection: {
      ...marked.projection, routes: [], buildSites: [] },
      open: true, onToggle: () => {}, onIntent: () => {},
      buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>() }))
    expect(html).toContain(`${trailTile.id}: ${trailTile.biome}, player location, marked frontier trail`)

    const fogged = at(trailTile, false, worldSeed)
    const fogBase = { ...fogged.base, map: { ...fogged.base.map,
      tiles: [{ ...fogged.base.map.tiles[0], hasFrontierTrail: true }] } }
    const hidden = projectPublicV24Mireglass(fogBase, fogged.progress, fogged.active)
    expect(hidden.projection.map.tiles[0]).toMatchObject({ discovered: false,
      hasFrontierTrail: false, terrain: null })
    const fogHtml = renderToStaticMarkup(createElement(WizardMap, { projection: {
      ...hidden.projection, routes: [], buildSites: [] },
      open: true, onToggle: () => {}, onIntent: () => {},
      buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>() }))
    expect(fogHtml).not.toContain(`${trailTile.id}: unexplored, player location, marked frontier trail`)
    expect(hidden.projection.map.tiles[0].hasCache).toBeFalsy()
  })

  it('keeps a discovered Wilderness trail dot map-only, with no Mireglass checked action', () => {
    const input = at(mireglassAnchors(seed).fringeMarker.tile)
    const wilderness = { ...input.base, map: { ...input.base.map, title: 'Wilderness' } }
    const output = projectPublicV24Mireglass(wilderness, input.progress, input.active)
    expect(output.projection.map.title).toBe('Wilderness')
    expect(output.projection.map.tiles[0].hasFrontierTrail).toBe(true)
    expect(output.projection.map.legend).toContain('marked frontier trail')
    expect(output.choices).toEqual([])
    expect(output.defaultInteractionId).toBeNull()
    expect(output.projection.checkedActionChoices).toBe(wilderness.checkedActionChoices)
    expect(output.projection.nearbyInteraction).toBe(wilderness.nearbyInteraction)
  })
  it('projects the V42 center-bridge approach as Mireglass without changing legacy wilderness', () => {
    const tile = worldTileAtGrid(seed, -20, 14) // x -80, z 56: V42 route, not the old z=0 connector.
    expect(mireglassV42FullApproachTrail(seed).some((point) =>
      point.x === tile.center.x && point.z === tile.center.z)).toBe(true)
    const input = at(tile)
    const wilderness = { ...input.base, map: { ...input.base.map, title: 'Open Wilderness' } }
    const before = JSON.stringify(input.progress)
    const legacy = projectPublicV24Mireglass(wilderness, input.progress, input.active)
    expect(legacy.projection.map.title).toBe('Open Wilderness')
    expect(legacy.choices).toEqual([])
    const learned = { ...input.progress, state: { ...input.progress.state,
      player: { ...input.progress.state.player,
        learnedSpellIds: ['wayfinder_glow' as const] } } }
    const active = { ...input.active, player: learned.state.player }
    const current = projectPublicV24Mireglass(wilderness, learned, active, 'v42-center-bridge')
    expect(current.projection.map.title).toBe('Mireglass Reach')
    expect(current.projection.unavailableActions).toBeUndefined()
    expect(current.projection.map.tiles[0].hasFrontierTrail).toBe(true)
    expect(current.choices.map((choice) => choice.id)).toContain('mireglass:cast:wayfinder_glow')
    expect(current.projection.map.guidance).toContain('center Greenway creek bridge')
    const hidden = at(tile, false)
    const hiddenView = projectPublicV24Mireglass({ ...hidden.base,
      map: { ...hidden.base.map, title: 'Open Wilderness' } }, hidden.progress,
    hidden.active, 'v42-center-bridge')
    expect(hiddenView.projection.map.tiles[0]).toMatchObject({ discovered: false,
      terrain: null, hasFrontierTrail: false })
    expect(hiddenView.projection.resources).toEqual([])
    expect(JSON.stringify(input.progress)).toBe(before)
  })

  it('exposes the discovered V42 frontier marker interaction despite the inherited wilderness title', () => {
    const input = at(mireglassAnchors(seed).fringeMarker.tile)
    const wilderness = { ...input.base, map: { ...input.base.map, title: 'Open Wilderness' } }
    expect(projectPublicV24Mireglass(wilderness, input.progress, input.active).choices).toEqual([])
    const current = projectPublicV24Mireglass(wilderness, input.progress, input.active,
      'v42-center-bridge')
    expect(current.defaultInteractionId).toBe('mireglass:study:fringe_marker')
    expect(current.projection.nearbyInteraction?.actionable).toBe(true)
  })

  it.each([0, 1])('does not reactivate V24 choices on the obsolete V42 west-only connector at z=%i', (gridZ) => {
    const input = at(worldTileAtGrid(seed, -20, gridZ))
    const legacyTitle = { ...input.base, map: { ...input.base.map,
      title: 'mireglass_reach' } }
    const current = projectPublicV24Mireglass(legacyTitle, input.progress,
      input.active, 'v42-center-bridge')
    expect(current.choices).toEqual([])
    expect(current.defaultInteractionId).toBeNull()
    expect(current.projection.unavailableActions).toBe(true)
    expect(current.projection.map.tiles[0].hasFrontierTrail).toBe(false)
  })
  it('leaves Greenway projections untouched', () => {
    const input = at(mireglassAnchors(seed).fringeMarker.tile)
    const greenway = { ...input.progress, state: { ...input.progress.state,
      movementOwner: 'greenway' as const } }
    const output = projectPublicV24Mireglass(input.base, greenway, input.active)
    expect(output.projection).toBe(input.base)
    expect(output.choices).toEqual([])
  })

  it('gates the marker by discovery and retains V23 Works while enabling E', () => {
    const tile = mireglassAnchors(seed).fringeMarker.tile
    const hidden = at(tile, false)
    expect(projectPublicV24Mireglass(hidden.base, hidden.progress, hidden.active)
      .projection.landmarks).toEqual([])
    const input = at(tile)
    const output = projectPublicV24Mireglass(input.base, input.progress, input.active)
    expect(output.projection.landmarks?.map((marker) => marker.id)).toContain(
      'mireglass_reach/landmark/fringe_marker')
    expect(output.defaultInteractionId).toBe('mireglass:study:fringe_marker')
    expect(output.projection.nearbyInteraction?.actionable).toBe(true)
    expect(output.projection.starterCliff).toBeUndefined()
    expect(output.projection.unavailableActions).toBeUndefined()
    expect(output.projection.savedTerrainWorks).toBe(input.base.savedTerrainWorks)
    expect(output.projection.regionalLadders).toBe(input.base.regionalLadders)
    expect(output.projection.visualWorld?.discoveredTileIds).toBe(
      input.base.visualWorld?.discoveredTileIds)
  })

  it('projects canonical tree, herb, ring, outpost, and revealed cache without auto-trading', () => {
    const tree = at(mireglassResources(seed)[0].tile)
    expect(projectPublicV24Mireglass(tree.base, tree.progress, tree.active)
      .projection.resources.some((node) => node.kind === 'tree')).toBe(true)
    const herb = at(mireglassHerbPatches(seed)[0].tile)
    expect(projectPublicV24Mireglass(herb.base, herb.progress, herb.active)
      .choices.some((choice) => choice.action.type === 'forage_herb')).toBe(true)
    const ring = at(mireglassFairyRing(seed).tile)
    expect(projectPublicV24Mireglass(ring.base, ring.progress, ring.active)
      .projection.fairyRings).toHaveLength(1)
    const outpost = at(mireglassAnchors(seed).salvager.tile)
    const trade = projectPublicV24Mireglass(outpost.base, outpost.progress, outpost.active)
    expect(trade.projection.stores[0].listings).toHaveLength(2)
    expect(trade.projection.nearbyStoreId).toBe(mireglassAnchors(seed).salvager.id)
    expect(trade.projection.nearbyInteraction).toMatchObject({ kind: 'store',
      targetId: mireglassAnchors(seed).salvager.id, actionable: true })
    expect(trade.choices.filter((choice) => choice.action.type === 'buy_item')
      .every((choice) => !choice.genericInteract)).toBe(true)
    expect(trade.defaultInteractionId).toBeNull()
    expect(trade.projection.nearbyInteraction?.action).toBe('Open salvager trade')
    const cache = at(mireglassAnchors(seed).sealCache.tile)
    const hiddenCache = projectPublicV24Mireglass(cache.base, cache.progress, cache.active)
    expect(hiddenCache.projection.map.tiles[0].hasCache).toBe(false)
    expect(hiddenCache.projection.landmarks?.some((marker) => marker.kind === 'seal-cache'))
      .toBe(false)
    const revealed = { ...cache.progress, state: { ...cache.progress.state,
      mireglass: { ...cache.progress.state.mireglass, cacheRevealed: true } } }
    expect(projectPublicV24Mireglass(cache.base, revealed, cache.active)
      .projection.landmarks?.some((marker) => marker.kind === 'seal-cache')).toBe(true)
  })

  it('gives only discovered, available dry timber a tree silhouette and map identity', () => {
    const tree = mireglassResources(seed).find((node) => node.tile.terrain === 'loam')!
    const input = at(tree.tile)
    const mapMarkup = (projection: WizardViewProjection) =>
      renderToStaticMarkup(createElement(WizardMap, { projection: {
        ...projection, routes: [], buildSites: [], map: { ...projection.map,
          player: { ...projection.map.player, gridX: projection.map.player.gridX + 1 } } },
        open: true, onToggle: () => {}, onIntent: () => {},
        buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>() }))
    const shown = projectPublicV24Mireglass(input.base, input.progress, input.active)
    expect(shown.projection.resources.find((node) => node.id === tree.id)).toMatchObject({
      available: true, visualKind: 'mireglass-timber',
    })
    expect(shown.projection.visualWorld?.resources.find((node) => node.id === tree.id)
      ?.visualKind).toBe('mireglass-timber')
    expect(shown.projection.map.tiles[0].hasMireglassTimber).toBe(true)
    const map = mapMarkup(shown.projection)
    expect(map).toContain('♣ harvestable timber · • marsh herb/resource')
    expect(map).toContain(`${tree.tile.id}: ${tree.tile.biome}, harvestable dry Mireglass timber`)
    expect(map).toContain('>♣</b>')

    const depleted = { ...input.progress, state: { ...input.progress.state,
      mireglass: { ...input.progress.state.mireglass,
        depletedResourceIds: [tree.id] } } }
    const spentBase = { ...input.base, map: { ...input.base.map,
      tiles: [{ ...input.base.map.tiles[0], hasResource: true }] } }
    const spent = projectPublicV24Mireglass(spentBase, depleted, input.active)
    expect(spent.projection.resources.find((node) => node.id === tree.id)).toMatchObject({
      available: false,
    })
    expect(spent.projection.resources.find((node) => node.id === tree.id)?.visualKind)
      .toBeUndefined()
    expect(spent.projection.map.tiles[0]).toMatchObject({ hasResource: true,
      hasMireglassTimber: false })
    expect(mapMarkup(spent.projection)).not.toContain('harvestable dry Mireglass timber')
    expect(mapMarkup(spent.projection)).not.toContain('>♣</b>')

    const hidden = at(tree.tile, false)
    const hiddenBase = { ...hidden.base, map: { ...hidden.base.map,
      tiles: [{ ...hidden.base.map.tiles[0], hasResource: true,
        hasMireglassTimber: true }] } }
    const fogged = projectPublicV24Mireglass(hiddenBase, hidden.progress, hidden.active)
    expect(fogged.projection.resources.some((node) => node.id === tree.id)).toBe(false)
    expect(fogged.projection.map.tiles[0].hasMireglassTimber).toBe(false)
    expect(mapMarkup(fogged.projection)).not.toContain('harvestable dry Mireglass timber')

    const wetTile = { ...tree.tile, terrain: 'wetland' as const }
    const wet = projectPublicV24Mireglass(input.base, input.progress,
      { ...input.active, activeTiles: [wetTile] })
    expect(wet.projection.resources.find((node) => node.id === tree.id)?.visualKind)
      .toBeUndefined()
    expect(wet.projection.map.tiles[0].hasMireglassTimber).toBe(false)
    expect(mapMarkup(wet.projection)).not.toContain('>♣</b>')

    const pit = projectPublicV24Mireglass(input.base, { ...input.progress,
      terrain: { columns: [{ gx: tree.tile.gridX - 3, gz: tree.tile.gridZ - 3,
        openDepth: 1 }] } }, input.active)
    expect(pit.projection.resources.find((node) => node.id === tree.id)?.visualKind)
      .toBeUndefined()
    expect(pit.projection.map.tiles[0].hasMireglassTimber).toBe(false)

    const herb = at(mireglassHerbPatches(seed)[0].tile)
    const forage = projectPublicV24Mireglass(herb.base, herb.progress, herb.active)
    expect(forage.projection.map.tiles[0]).toMatchObject({ hasResource: true,
      hasMireglassTimber: false })
    expect(mapMarkup(forage.projection)).toContain('>•</b>')
  })

  it('offers an explicit boots switch after waders only when owned and grounded', () => {
    const input = at(mireglassAnchors(seed).fringeMarker.tile)
    const player = { ...input.progress.state.player,
      inventory: [...input.progress.state.player.inventory, { itemId: 'leather_boots' as const,
        quantity: 1 }, { itemId: 'mireglass_reach/item/waders' as const, quantity: 1 }],
      equipment: { ...input.progress.state.player.equipment, feet: 'mireglass_reach/item/waders' as const } }
    const progress = { ...input.progress, state: { ...input.progress.state, player } }
    const active = { ...input.active, player }
    const view = projectPublicV24Mireglass(input.base, progress, active)
    const choice = view.choices.find(
      (entry) => entry.id === 'mireglass:equip:leather_boots')
    expect(choice).toMatchObject({ action: { type: 'equip_item', itemId: 'leather_boots' },
      genericInteract: false, actionable: true, disabledReason: null })
    expect(view.projection.checkedEquipmentChoices?.find((entry) => entry.itemId === 'leather_boots'))
      .toMatchObject({ actionable: true, reason: null })
    expect(view.defaultInteractionId).not.toBe('mireglass:equip:leather_boots')
    const withoutBoots = { ...player, inventory: player.inventory.filter(
      (stack) => stack.itemId !== 'leather_boots') }
    expect(projectPublicV24Mireglass(input.base,
      { ...progress, state: { ...progress.state, player: withoutBoots } },
      { ...active, player: withoutBoots }).choices.some((entry) =>
      entry.id === 'mireglass:equip:leather_boots')).toBe(false)
    const wearingBoots = { ...player, equipment: { ...player.equipment,
      feet: 'leather_boots' as const } }
    expect(projectPublicV24Mireglass(input.base,
      { ...progress, state: { ...progress.state, player: wearingBoots } },
      { ...active, player: wearingBoots }).choices.some((entry) =>
      entry.id === 'mireglass:equip:leather_boots')).toBe(false)
    const airborne = { ...player, verticalVelocity: 1 }
    expect(projectPublicV24Mireglass(input.base,
      { ...progress, state: { ...progress.state, player: airborne } },
      { ...active, player: airborne }).choices.find((entry) =>
      entry.id === 'mireglass:equip:leather_boots')).toMatchObject({
      actionable: false, disabledReason: 'Stand on grounded terrain to interact.',
    })
  })

  it('disables generic and explicit choices when pose or sequence blocks checked actions', () => {
    const input = at(mireglassAnchors(seed).fringeMarker.tile)
    const player = { ...input.progress.state.player,
      inventory: [...input.progress.state.player.inventory.filter((stack) =>
        stack.itemId !== 'field_spade'), { itemId: 'field_spade' as const, quantity: 1 }] }
    const progress = { ...input.progress, state: { ...input.progress.state, player } }
    const active = { ...input.active, player }
    const markerId = 'mireglass:study:fringe_marker'
    const equipId = 'mireglass:equip:field_spade'
    const grounded = projectPublicV24Mireglass(input.base, progress, active)
    expect(grounded.choices.find((choice) => choice.id === markerId)?.actionable).toBe(true)
    expect(grounded.choices.find((choice) => choice.id === equipId)?.actionable).toBe(true)
    expect(grounded.defaultInteractionId).toBe(markerId)
    const assertUnavailable = (view: ReturnType<typeof projectPublicV24Mireglass>, reason: string) => {
      for (const id of [markerId, equipId]) {
        expect(view.choices.find((choice) => choice.id === id)).toMatchObject({
          actionable: false, disabledReason: reason,
        })
        expect(view.projection.checkedActionChoices?.find((choice) => choice.id === id))
          .toMatchObject({ actionable: false, reason })
      }
      expect(view.defaultInteractionId).toBeNull()
      expect(view.projection.nearbyInteraction?.actionable).toBe(false)
    }
    const airborne = { ...player, verticalVelocity: 1 }
    assertUnavailable(projectPublicV24Mireglass(input.base,
      { ...progress, state: { ...progress.state, player: airborne } },
      { ...active, player: airborne }), 'Stand on grounded terrain to interact.')
    // Projection-only fixture: an exhausted sequence cannot be committed as a new checked event.
    assertUnavailable(projectPublicV24Mireglass(input.base,
      { ...progress, state: { ...progress.state, eventSequence: Number.MAX_SAFE_INTEGER } },
      active), 'The world event sequence cannot advance.')
  })

  it('publishes checked Glow and salvager reasons, including stock, funds, and coin overflow', () => {
    const marker = at(mireglassAnchors(seed).fringeMarker.tile)
    const known = nearbyWorldTileIds(marker.progress.state.player.position,
      PUBLIC_SPELL_REVEAL_RADIUS_METERS)
    const learned = { ...marker.progress, state: { ...marker.progress.state,
      player: { ...marker.progress.state.player,
        learnedSpellIds: ['wayfinder_glow' as const] } } }
    const glow = projectPublicV24Mireglass(marker.base, learned,
      { ...marker.active, player: learned.state.player, activeKnownTileIds: known })
    expect(glow.projection.checkedActionChoices?.find((choice) =>
      choice.id === 'mireglass:cast:wayfinder_glow')).toMatchObject({ actionable: false,
        reason: 'No new terrain or cache is within Wayfinder Glow reach.' })

    const outpost = at(mireglassAnchors(seed).salvager.tile)
    const player = { ...outpost.progress.state.player, coins: 0,
      inventory: [...outpost.progress.state.player.inventory,
        { itemId: 'logs' as const, quantity: 2 }] }
    const progress = { ...outpost.progress, state: { ...outpost.progress.state, player,
      mireglass: { ...outpost.progress.state.mireglass, shopStock: {
        ...outpost.progress.state.mireglass.shopStock, field_spade: 0 } } } }
    const trade = projectPublicV24Mireglass(outpost.base, progress,
      { ...outpost.active, player })
    const checked = trade.projection.checkedActionChoices ?? []
    expect(checked.find((entry) => entry.id === 'mireglass:buy:field_spade'))
      .toMatchObject({ actionable: false, reason: 'Item is out of stock.' })
    expect(checked.find((entry) => entry.id === 'mireglass:buy:mireglass_reach/item/waders'))
      .toMatchObject({ actionable: false, reason: 'Not enough coins.' })
    const rich = { ...player, coins: Number.MAX_SAFE_INTEGER }
    const overflow = projectPublicV24Mireglass(outpost.base,
      { ...progress, state: { ...progress.state, player: rich } },
      { ...outpost.active, player: rich })
    expect(overflow.projection.checkedActionChoices?.find((entry) =>
      entry.id === 'mireglass:sell-all:logs')).toMatchObject({ actionable: false,
        reason: 'Coin total would exceed safe limits.' })
  })

  it.each(['greenway-alpha', 'wizard-realms'])('checks the wide Glow choice against writer results in %s', (worldSeed) => {
    const input = at(mireglassAnchors(worldSeed).fringeMarker.tile, true, worldSeed)
    const known = [...new Set([...decodeDiscoveredTileIds(input.progress.state.discoveryMask),
      ...nearbyWorldTileIds(input.progress.state.player.position,
        PUBLIC_WALK_REVEAL_RADIUS_METERS)])].sort()
    const player = { ...input.progress.state.player,
      learnedSpellIds: ['wayfinder_glow' as const] }
    const progress = { ...input.progress, state: { ...input.progress.state,
      player, discoveryMask: encodeDiscoveredTileIds(known) } }
    const active = { ...input.active, player, activeKnownTileIds: known }
    const view = projectPublicV24Mireglass(input.base, progress, active)
    const choice = view.choices.find((item) => item.id === 'mireglass:cast:wayfinder_glow')
    expect(choice).toMatchObject({ action: { type: 'cast_wayfinder_glow_wide' },
      actionable: true, disabledReason: null })
    expect(view.projection.checkedActionChoices?.find((item) => item.id === choice?.id))
      .toMatchObject({ actionable: true, reason: null })
    expect(view.projection.landmarks?.some((item) => item.kind === 'seal-cache')).toBe(false)
    const written = applyPublicV24MireglassAction(progress, choice!.action)
    if (!written.progress) throw new Error(written.rejection)
    const expected = nearbyWorldTileIds(player.position, PUBLIC_SPELL_REVEAL_RADIUS_METERS)
      .filter((id) => !known.includes(id))
    expect(written.events[0]).toMatchObject({ type: 'terrain_revealed',
      revealedTileIds: expected, xp: 10 * Math.min(expected.length, 13) })
    expect(written.progress.state.mireglass.cacheRevealed).toBe(false)
    const repeated = projectPublicV24Mireglass(input.base, written.progress,
      { ...active, player: written.progress.state.player,
        activeKnownTileIds: [...known, ...expected] })
    expect(repeated.choices.find((item) => item.id === choice?.id))
      .toMatchObject({ actionable: false,
        disabledReason: 'No new terrain or cache is within Wayfinder Glow reach.' })
    const started = performance.now()
    for (let i = 0; i < 20; i++) projectPublicV24Mireglass(input.base, progress, active)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('adds fen-wader feet-slot metadata only in the V24 overlay', () => {
    const input = at(mireglassAnchors(seed).salvager.tile)
    const stack = { id: 'inventory-mireglass_reach/item/waders',
      itemId: 'mireglass_reach/item/waders', name: 'Fen waders', quantity: 1 }
    const base = { ...input.base, backpack: { capacity: 20, stacks: [stack] } }
    const projection = projectPublicV24Mireglass(base, input.progress, input.active).projection
    expect(base.backpack.stacks[0]).not.toHaveProperty('equippableSlots')
    expect(projection.backpack.stacks[0].equippableSlots).toEqual(['feet'])
  })
})
