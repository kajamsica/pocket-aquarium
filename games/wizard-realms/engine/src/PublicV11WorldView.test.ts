import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { highlandLandmark, highlandStoneNodes } from './domain/highlandContent'
import { mireglassAnchors } from './domain/mireglassContent'
import { mireglassRouteSites } from './domain/mireglassRouteSites'
import { canonicalRouteSites } from './domain/routeSites'
import { PUBLIC_V11_BOOTS_LISTING_ID, PUBLIC_V11_BOOTS_PRICE } from './domain/publicWorldGait'
import { createFreshPublicWorld } from './domain/publicWorldState'
import { withFreshPublicV7Herbs } from './domain/publicWorldV7'
import { withFreshPublicV9Camps } from './domain/publicWorldV9State'
import { withPublicV10TerrainRevision } from './domain/publicWorldV10State'
import { withPublicV11Highland, type PublicWorldV11State } from './domain/publicWorldV11State'
import { createStreamedWorld } from './domain/streamedWorld'
import { WORLD_CELL_METERS, worldTileAtGrid } from './domain/worldChunks'
import { highlandExtractionFor, highlandMapTiles, highlandTerrainFor, publicV11PracticeDigHint,
  publicWorldV11ViewProjection } from './PublicV11WorldView'
import { publicWorldViewProjection } from './PublicWorldView'
import { greenwayForPublicView } from './PublicWizardApp'
import { WizardHud } from './view/WizardHud'
import { RouteKey, WizardMap } from './view/WizardMap'
import { mireglassConstructionGeometry } from './view/WizardScene'

const seed = 'greenway-alpha'
const fresh = () => withPublicV11Highland(withPublicV10TerrainRevision(
  withFreshPublicV9Camps(withFreshPublicV7Herbs(
    createFreshPublicWorld(seed, 'greenway-classic-v1')))))
const at = (state: PublicWorldV11State, x: number, z: number): PublicWorldV11State => {
  const streamed = createStreamedWorld(seed, { x, z })
  return { ...state, movementOwner: 'streamed', player: { ...state.player,
    position: streamed.state.player.position } }
}
const tileIdAt = (point: { x: number; z: number }) => worldTileAtGrid(seed,
  Math.ceil(point.x / WORLD_CELL_METERS - 0.5), Math.ceil(point.z / WORLD_CELL_METERS - 0.5)).id

describe('v11 Highland read-only projection', () => {
  it('shows the saved Greenway practice dig after building routes without exposing hidden caches', () => {
    const start = fresh()
    const mound = start.greenway.digSites.find((site) => site.id === 'practice_mound')!
    const moundTileId = tileIdAt(mound.position)
    const built: PublicWorldV11State = { ...start,
      discoveredTileIds: [...new Set([...start.discoveredTileIds, moundTileId])].sort(),
      greenway: { ...start.greenway, builtRouteIds: ['greenway_ladder', 'highland_bridge'] } }
    const view = publicWorldV11ViewProjection(built, [], null)
    expect(publicV11PracticeDigHint(start)).toBeNull()
    expect(publicV11PracticeDigHint(built)).toContain('2 stone and 30 Excavation XP')
    expect(publicV11PracticeDigHint(built)).toContain('field spade')
    expect(view.map.tiles.find((tile) => tile.id === moundTileId)?.hasDigSite).toBe(true)
    expect(view.map.tiles.some((tile) => tile.hasCache)).toBe(false)
    const map = renderToStaticMarkup(createElement(WizardMap, { projection: view, open: true,
      onToggle: () => {}, onIntent: () => {}, buttonRef: createRef<HTMLButtonElement>(),
      closeRef: createRef<HTMLButtonElement>() }))
    expect(map).toContain('⌄ practice mound')
    expect(map).toContain('dig site')
    expect(map).toContain('<b>⌄</b>')
    expect(publicWorldViewProjection(built, [], null).map.tiles.some((tile) => tile.hasDigSite)).toBe(false)

    const fogged = { ...built, discoveredTileIds: built.discoveredTileIds.filter((id) => id !== moundTileId) }
    expect(publicWorldV11ViewProjection(fogged, [], null).map.tiles.some((tile) => tile.hasDigSite)).toBe(false)
    const dug = { ...built, greenway: { ...built.greenway, excavatedDigSiteIds: ['practice_mound' as const] } }
    expect(publicWorldV11ViewProjection(dug, [], null).map.tiles.some((tile) => tile.hasDigSite)).toBe(false)
    expect(publicV11PracticeDigHint(dug)).toBeNull()
  })

  it('keeps a world-wide v11 route marker and distinguishes low steps, bridge decks, and the steep Slate face', () => {
    const start = fresh()
    const v11 = publicWorldV11ViewProjection(start, [], null)
    const v10 = publicWorldViewProjection(start, [], null)
    expect(v11.physicalRoutes).toEqual({ active: null })
    expect(v10.physicalRoutes).toBeUndefined()
    const greenway = canonicalRouteSites(greenwayForPublicView(start))
    const stepSite = greenway.find((site) => site.routeId === 'greenway_ladder')!
    const bridgeSite = greenway.find((site) => site.routeId === 'highland_bridge')!
    const slate = mireglassRouteSites(seed).find((site) => site.kind === 'ladder')!
    const fen = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const viewRoute = (id: string, from: typeof stepSite.from, to: typeof stepSite.to) => ({ id,
      from: [from.x, from.y, from.z] as const, to: [to.x, to.y, to.z] as const })
    const steps = mireglassConstructionGeometry(viewRoute(stepSite.routeId, stepSite.from, stepSite.to), true)!
    const bridge = mireglassConstructionGeometry(viewRoute(bridgeSite.routeId,
      bridgeSite.from, bridgeSite.to), true)!
    const ladder = mireglassConstructionGeometry(viewRoute(slate.routeId, slate.from, slate.to), true)!
    const fenDeck = mireglassConstructionGeometry(viewRoute(fen.routeId, fen.from, fen.to), true)!
    expect(steps.kind).toBe('ramp')
    expect(steps.run).toBeCloseTo(4)
    expect(Math.abs(steps.rise)).toBeLessThan(0.6)
    expect(bridge.kind).toBe('bridge')
    expect(bridge.run).toBeCloseTo(2)
    expect(bridge.deckLift + 0.135).toBeCloseTo(0.02)
    expect(fenDeck.deckLift + 0.135).toBeCloseTo(0.18)
    expect(ladder.kind).toBe('ladder')
    expect(ladder.rise).toBeCloseTo(1.56)
    expect(ladder.run).toBeCloseTo(0.65)
    expect(mireglassConstructionGeometry(viewRoute(stepSite.routeId,
      stepSite.from, stepSite.to))).toBeNull()
  })

  it('gives v11 walk-through route directions while old projection retains E-only copy', () => {
    const start = fresh()
    const site = canonicalRouteSites(greenwayForPublicView(start))
      .find((candidate) => candidate.routeId === 'greenway_ladder')!
    const built: PublicWorldV11State = { ...start,
      player: { ...start.player, position: { ...site.from } },
      greenway: { ...start.greenway, builtRouteIds: ['greenway_ladder'],
        routes: start.greenway.routes.map((route) => route.id === 'greenway_ladder'
          ? { ...route, siteId: site.id, from: site.from, to: site.to } : route) } }
    const v11 = publicWorldV11ViewProjection(built, [], null)
    const old = publicWorldViewProjection(built, [], null)
    expect(v11.physicalRoutes?.active?.route.kind).toBe('greenway_ladder')
    const away = publicWorldV11ViewProjection({ ...built, player: start.player }, [], null)
    expect(away.physicalRoutes).toEqual({ active: null })
    expect(away.routes.find((route) => route.id === 'greenway_ladder')?.built).toBe(true)
    expect(v11.map.guidance).toContain('Walk the low Greenway steps one step at a time')
    expect(old.physicalRoutes).toBeUndefined()
    const routeProps = { routes: v11.routes, buildSites: v11.buildSites,
      selectedBuildSiteId: null, onSelect: () => {} }
    const walkMap = renderToStaticMarkup(createElement(RouteKey, { ...routeProps, physicalRoutes: true }))
    const oldMap = renderToStaticMarkup(createElement(RouteKey, routeProps))
    expect(walkMap).toContain('Walk the low steps one step at a time')
    expect(walkMap).toContain('Approach the foot on your side until Cross appears; press E or tap Interact as a shortcut. You can also walk across the built route.')
    expect(walkMap).not.toContain('Within 3 m of either foot')
    expect(walkMap).not.toContain('Walking into the edge alone will not cross it')
    expect(oldMap).toContain('Within 3 m of either foot, press E to cross')
    expect(oldMap).toContain('Walking into the edge alone will not cross it')
    const otherRoutes = renderToStaticMarkup(createElement(RouteKey, { ...routeProps,
      routes: [{ ...v11.routes[0], id: 'highland_bridge', built: true },
        { ...v11.routes[0], id: 'mireglass_reach/route/slate_ladder', built: true }],
      physicalRoutes: true }))
    expect(otherRoutes).toContain('Walk across the bridge deck one step at a time')
    expect(otherRoutes).toContain('Walk into the ladder face and climb one step at a time')
    const hud = renderToStaticMarkup(createElement(WizardHud, { projection: v11,
      onIntent: () => {} }))
    if (v11.nearbyInteraction?.kind === 'route') expect(hud).toContain('walk along it; E/Interact shortcut')
  })

  it('shows a built Greenway route from its known source foot without revealing the far bank', () => {
    const start = fresh()
    const site = canonicalRouteSites(greenwayForPublicView(start))
      .find((candidate) => candidate.routeId === 'greenway_ladder')!
    const sourceId = tileIdAt(site.from)
    const destinationId = tileIdAt(site.to)
    expect(sourceId).not.toBe(destinationId)
    const nearSource: PublicWorldV11State = { ...start,
      player: { ...start.player, position: { ...site.from } },
      discoveredTileIds: [sourceId],
      greenway: { ...start.greenway, builtRouteIds: ['greenway_ladder'],
        routes: start.greenway.routes.map((route) => route.id === 'greenway_ladder'
          ? { ...route, siteId: site.id, from: site.from, to: site.to } : route) } }
    const v11 = publicWorldV11ViewProjection(nearSource, [], null)
    const old = publicWorldViewProjection(nearSource, [], null)
    expect(v11.visualWorld?.routes.find((route) => route.id === site.routeId)?.built).toBe(true)
    expect(old.visualWorld?.routes.some((route) => route.id === site.routeId)).toBe(false)
    expect(v11.visualWorld?.discoveredTileIds).not.toContain(destinationId)
    expect(v11.map.tiles.find((tile) => tile.id === destinationId)?.discovered).toBe(false)
    const farKnown = publicWorldV11ViewProjection({ ...nearSource,
      discoveredTileIds: [destinationId] }, [], null)
    expect(farKnown.visualWorld?.routes.some((route) => route.id === site.routeId)).toBe(false)
    const unbuilt = publicWorldV11ViewProjection({ ...nearSource,
      greenway: { ...nearSource.greenway, builtRouteIds: [] } }, [], null)
    expect(unbuilt.visualWorld?.routes.some((route) => route.id === site.routeId)).toBe(false)
  })

  it('shows a built Mireglass route from its known source foot without revealing the far bank', () => {
    const site = mireglassRouteSites(seed).find((candidate) => candidate.kind === 'bridge')!
    const sourceId = tileIdAt(site.from)
    const destinationId = tileIdAt(site.to)
    expect(sourceId).not.toBe(destinationId)
    const start = at(fresh(), site.from.x, site.from.z)
    const nearSource: PublicWorldV11State = { ...start, discoveredTileIds: [sourceId],
      mireglass: { ...start.mireglass, builtRoutes: { ...start.mireglass.builtRoutes,
        bridge: site.id } } }
    const v11 = publicWorldV11ViewProjection(nearSource, [], null)
    const old = publicWorldViewProjection(nearSource, [], null)
    expect(v11.visualWorld?.routes.find((route) => route.id === site.routeId)?.built).toBe(true)
    expect(old.visualWorld?.routes.some((route) => route.id === site.routeId)).toBe(false)
    expect(v11.visualWorld?.discoveredTileIds).not.toContain(destinationId)
    expect(v11.map.tiles.find((tile) => tile.id === destinationId)?.discovered).toBe(false)
    expect(v11.nearbyInteraction).toMatchObject({ kind: 'route', targetId: site.id, actionable: true })
    expect(v11.nearbyInteraction?.label).toContain('center on the planks, face S')
    expect(v11.map.guidance).toContain('Center on the bridge planks')
    const offDeck = publicWorldV11ViewProjection({ ...nearSource,
      player: at(start, site.from.x + 1.98, site.from.z).player }, [], null)
    expect(offDeck.physicalRoutes?.active).toBeNull()
    expect(offDeck.nearbyInteraction?.label).toContain('center on the planks, face S')
    const farBank = publicWorldV11ViewProjection({ ...nearSource,
      player: at(start, site.to.x, site.to.z).player,
      discoveredTileIds: [sourceId, destinationId] }, [], null)
    expect(farBank.nearbyInteraction?.label).toContain('center on the planks, face N')
    const unbuilt = publicWorldV11ViewProjection({ ...nearSource,
      mireglass: { ...nearSource.mireglass, builtRoutes: { ...nearSource.mireglass.builtRoutes,
        bridge: null } } }, [], null)
    expect(unbuilt.nearbyInteraction?.label).not.toContain('center on the planks')
  })

  it('offers 25g boots only in v11 Greenway Outfitters until owned', () => {
    const start = fresh()
    const original = JSON.stringify(start)
    const v11 = publicWorldV11ViewProjection(start, [], null)
    const older = publicWorldViewProjection(start, [], null)
    expect(v11.stores.find((store) => store.id === 'store-greenway')?.listings)
      .toContainEqual({ id: PUBLIC_V11_BOOTS_LISTING_ID, name: 'Leather boots',
        price: PUBLIC_V11_BOOTS_PRICE })
    expect(older.stores.find((store) => store.id === 'store-greenway')?.listings
      .some((listing) => listing.id === PUBLIC_V11_BOOTS_LISTING_ID)).toBe(false)
    expect(JSON.stringify(start)).toBe(original)
    const owned = { ...start, player: { ...start.player,
      inventory: [...start.player.inventory, { itemId: 'leather_boots' as const, quantity: 1 }] } }
    expect(publicWorldV11ViewProjection(owned, [], null).stores.find((store) =>
      store.id === 'store-greenway')?.listings.some((listing) =>
      listing.id === PUBLIC_V11_BOOTS_LISTING_ID)).toBe(false)
  })

  it('marks only walked quarry ground, keeps fog unknown, and changes no old v10 projection', () => {
    const node = highlandStoneNodes(seed)[0]
    const landmark = highlandLandmark(seed)
    const start = fresh()
    const state = at({ ...start, discoveredTileIds: [node.tile.id, landmark.tile.id],
      highland: { ...start.highland, landmarkDiscovered: true } }, node.tile.center.x, node.tile.center.z)
    const before = JSON.stringify(state)
    const view = publicWorldV11ViewProjection(state, [], null)
    expect(view.map.title).toBe('Highland Quarry')
    expect(view.map.guidance).toContain('stone shelf')
    expect(view.ambience).toBe('highland-wind')
    expect(view.terrain.some((cell) => cell.highlandSurface === 'quarry')).toBe(true)
    expect(view.terrain.some((cell) => cell.highlandTrailSegment)).toBe(true)
    expect(view.resources.filter((resource) => resource.visualKind === 'highland-stone')).toHaveLength(4)
    expect(view.resources.every((resource) => resource.available)).toBe(true)
    expect(view.visualWorld?.terrain.find((cell) => cell.id === node.tile.id)?.highlandSurface).toBe('quarry')
    expect(view.visualWorld?.resources.some((resource) => resource.id === node.id
      && resource.visualKind === 'highland-stone')).toBe(true)
    expect(view.map.tiles.find((tile) => tile.id === node.tile.id)).toMatchObject({
      discovered: true, hasHighlandNode: true, highlandNodeReady: true })
    expect(view.map.tiles.filter((tile) => !tile.discovered).every((tile) =>
      tile.terrain === null && !tile.hasHighlandNode && !tile.hasHighlandLandmark
      && !tile.hasHighlandTrail)).toBe(true)
    expect(JSON.stringify(state)).toBe(before)
    const old = publicWorldViewProjection(start, [], null)
    expect(old.map.tiles.every((tile) => !Object.hasOwn(tile, 'hasHighlandNode'))).toBe(true)
    expect(old.terrain.every((cell) => !Object.hasOwn(cell, 'highlandSurface'))).toBe(true)
  })

  it('uses the committed recovery ledger for visible depletion and regrowth', () => {
    const node = highlandStoneNodes(seed)[0]
    const start = fresh()
    const depleted = at({ ...start,
      discoveredTileIds: [node.tile.id, highlandLandmark(seed).tile.id],
      highland: { ...start.highland, landmarkDiscovered: true,
        stoneNodes: start.highland.stoneNodes.map((entry) => entry.id === node.id
          ? { ...entry, readyAtTick: 3000 } : entry) } }, node.tile.center.x, node.tile.center.z)
    const before = publicWorldV11ViewProjection(depleted, [], null)
    expect(before.resources.find((resource) => resource.id === node.id)?.available).toBe(false)
    expect(before.map.tiles.find((tile) => tile.id === node.tile.id)?.highlandNodeReady).toBe(false)
    expect(before.highlandExtraction?.reason).toContain('field spade')
    const recovered = publicWorldV11ViewProjection({ ...depleted, tick: 3000 }, [], null)
    expect(recovered.resources.find((resource) => resource.id === node.id)?.available).toBe(true)
    expect(recovered.map.tiles.find((tile) => tile.id === node.tile.id)?.highlandNodeReady).toBe(true)
  })

  it('projects exactly the authority 3D reach and prerequisites, never makes blocked extraction actionable', () => {
    const node = highlandStoneNodes(seed)[0]
    const start = fresh()
    const onNode = at({ ...start, discoveredTileIds: [node.tile.id],
      highland: { ...start.highland, landmarkDiscovered: true } }, node.tile.center.x, node.tile.center.z)
    expect(highlandExtractionFor(onNode)).toMatchObject({ nodeId: node.id, actionable: false,
      reason: 'A field spade is required' })
    const owned = { ...onNode, player: { ...onNode.player,
      inventory: [...onNode.player.inventory, { itemId: 'field_spade' as const, quantity: 1 }] } }
    expect(highlandExtractionFor(owned)?.reason).toBe('Equip your field spade')
    const equipped = { ...owned, player: { ...owned.player,
      equipment: { ...owned.player.equipment, mainHand: 'field_spade' as const } } }
    expect(highlandExtractionFor(equipped)?.reason).toBe('Excavation Lv2 required')
    const skilled = { ...equipped, player: { ...equipped.player,
      skillXp: { ...equipped.player.skillXp, excavation: 30 } } }
    expect(highlandExtractionFor(skilled)?.actionable).toBe(true)
    expect(publicWorldV11ViewProjection(skilled, [], null).nearbyInteraction).toMatchObject({
      targetId: node.id, action: 'Extract', actionable: true })
    const full = { ...skilled, player: { ...skilled.player,
      backpackCapacity: skilled.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0) + 1 } }
    expect(highlandExtractionFor(full)?.reason).toBe('Make room for 2 stone')
    const escrowFull = { ...skilled, player: { ...skilled.player,
      backpackCapacity: skilled.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0) + 2,
      tradeSlots: [{ ...skilled.player.tradeSlots[0], itemId: 'logs' as const, quantity: 1, unitPrice: 1 },
        skilled.player.tradeSlots[1], skilled.player.tradeSlots[2], skilled.player.tradeSlots[3]] as typeof skilled.player.tradeSlots } }
    expect(highlandExtractionFor(escrowFull)?.reason).toBe('Make room for 2 stone')
    const elevated = { ...skilled, player: { ...skilled.player,
      position: { ...skilled.player.position, y: node.tile.center.y + 3.01 } } }
    expect(highlandExtractionFor(elevated)).toBeUndefined()
  })

  it('names early eastern terrain wilderness and leaves Mireglass visuals out of that region', () => {
    const start = fresh()
    const eastern = at(start, 100, 0)
    const view = publicWorldV11ViewProjection(eastern, [], null)
    expect(view.map.title).toBe('Uncharted wilderness')
    expect(view.map.guidance).toContain('highland')
    expect(view.map.guidance).not.toContain('Mireglass Reach')
    expect(view.routes).toEqual([])
    expect(view.landmarks).toEqual([])
    expect(view.terrain.some((cell) => cell.highlandTrailSegment)).toBe(true)
    const western = at(start, -392, 332)
    const old = publicWorldViewProjection(western, [], null)
    const v11 = publicWorldV11ViewProjection(western, [], null)
    expect(v11.map.title).toBe(old.map.title)
    expect(v11.map.guidance).toBe(old.map.guidance)
    expect(v11.terrain).toBe(old.terrain)
  })

  it('keeps the unstudied Frontier marker as the off-trail Next target without exposing Fen sites', () => {
    const state = at(fresh(), -170, 211)
    const markerTile = mireglassAnchors(seed).fringeMarker.tile
    const marker = markerTile.center
    expect(state.mireglass.fringeMarkerStudied).toBe(false)
    expect(marker).toMatchObject({ x: -108, z: 104 })
    const before = JSON.stringify(state)
    const view = publicWorldV11ViewProjection(state, [], null)
    expect(view.map.title).toBe('Uncharted wilderness')
    expect(view.map.guidance).toContain('Next: Frontier marker')
    expect(view.map.guidance).toContain('NE, about 124 m direct')
    expect(view.routes).toEqual([])
    expect(view.buildSites).toEqual([])
    expect(view.map.tiles.filter((tile) => !tile.discovered).every((tile) =>
      !tile.hasRouteSite && !tile.hasCache)).toBe(true)
    const map = renderToStaticMarkup(createElement(WizardMap, { projection: view, open: true,
      onToggle: () => {}, onIntent: () => {}, buttonRef: createRef<HTMLButtonElement>(),
      closeRef: createRef<HTMLButtonElement>() }))
    expect(map).toContain('aria-label="Map guidance"')
    expect(map).toContain('Next: Frontier marker')
    expect(map).not.toContain('Slate ladder')
    expect(map).not.toContain('Fen bridge')
    expect(JSON.stringify(state)).toBe(before)
    const carryingStone: PublicWorldV11State = { ...state,
      player: { ...state.player, inventory: [...state.player.inventory,
        { itemId: 'stone', quantity: 1 }] },
      highland: { ...state.highland, landmarkDiscovered: true } }
    expect(publicWorldV11ViewProjection(carryingStone, [], null).map.guidance)
      .toContain('Next: Frontier marker. NE, about 124 m direct')
    const quarry = highlandLandmark(seed).tile.center
    expect(publicWorldV11ViewProjection(at(carryingStone, quarry.x, quarry.z), [], null).map.guidance)
      .toContain('Return west along the pale quarry path')
    const studied = { ...state, discoveredTileIds: [...state.discoveredTileIds,
      markerTile.id].sort(),
    mireglass: { ...state.mireglass, fringeMarkerStudied: true } }
    expect(publicWorldV11ViewProjection(studied, [], null).map.guidance)
      .toContain('known dry trail at the studied Frontier marker: NE, about 124 m direct')
  })

  it('tags visible ridge rock and gallery only in the v11 projection', () => {
    const state = at(fresh(), 552, -466)
    const view = publicWorldV11ViewProjection(state, [], null)
    const cellAt = (x: number, z: number) => view.terrain.find((cell) =>
      cell.position[0] === x && cell.position[2] === z)
    expect(view.highlandRidgeActive).toBe(true)
    expect(cellAt(560, -472)?.highlandRidgeCell).toBe('rock')
    expect(cellAt(560, -468)?.highlandRidgeCell).toBe('gallery')
    expect(cellAt(560, -464)?.highlandRidgeCell).toBe('gallery')
    expect(cellAt(556, -472)?.highlandRidgeCell).toBeUndefined()
    expect(view.terrain.some((cell) => cell.highlandRidgeCell)).toBe(true)

    const base = publicWorldViewProjection(state, [], null)
    expect(base.highlandRidgeActive).toBeUndefined()
    expect(base.terrain.every((cell) => !Object.hasOwn(cell, 'highlandRidgeCell'))).toBe(true)
  })

  it('guides an old saved pose inside ridge rock without moving or rewriting it', () => {
    const state = at(fresh(), 580, -500)
    const saved = JSON.stringify(state)
    const view = publicWorldV11ViewProjection(state, [], null)
    expect(view.map.guidance).toContain('Old save inside newly raised ridge rock')
    expect(view.map.guidance).toContain('Ridge scenery is temporarily hidden')
    expect(view.map.guidance).toContain('Walk E about 20 m to the nearest open cell')
    expect(view.player.position).toEqual([state.player.position.x, state.player.position.y,
      state.player.position.z])
    expect(JSON.stringify(state)).toBe(saved)
    const map = renderToStaticMarkup(createElement(WizardMap, { projection: view, open: true,
      onToggle: () => {}, onIntent: () => {},
      buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>() }))
    expect(map).toContain('aria-label="Map guidance"')
    expect(map).toContain('Walk E about 20 m to the nearest open cell')

    const open = publicWorldV11ViewProjection(at(fresh(), 580, -468), [], null)
    expect(open.map.guidance).not.toContain('Old save')
    expect(open.map.guidance).not.toContain('temporarily hidden')
  })

  it('caches bounded visual terrain and includes only discovered Highland markers in the overview', () => {
    const start = fresh()
    const trail = worldTileAtGrid(seed, 96 / 4, 0)
    const node = highlandStoneNodes(seed)[0]
    const landmark = highlandLandmark(seed)
    const state = at({ ...start, discoveredTileIds: [trail.id, node.tile.id, landmark.tile.id],
      highland: { ...start.highland, landmarkDiscovered: true } }, node.tile.center.x, node.tile.center.z)
    const view = publicWorldV11ViewProjection(state, [], null)
    expect(view.map.overview?.()).toBe(view.map.overview?.())
    expect(view.map.overview?.().cells.flatMap((cell) => cell.markers)).toContain('Quarry Crown')
    expect(view.map.overview?.().cells.flatMap((cell) => cell.markers)).toContain('Stone shelf')
    expect(highlandTerrainFor(view.terrain, seed)).toBe(highlandTerrainFor(view.terrain, seed))
    const hidden = publicWorldV11ViewProjection({ ...state, discoveredTileIds: [] }, [], null)
    expect(hidden.visualWorld?.resources.some((resource) => resource.visualKind === 'highland-stone')).toBe(false)
    expect(hidden.map.overview?.().cells.flatMap((cell) => cell.markers)).not.toContain('Quarry Crown')
    expect(hidden.map.overview?.().cells.flatMap((cell) => cell.markers)).not.toContain('Stone shelf')
    const tiles = highlandMapTiles(hidden.map.tiles, state)
    expect(tiles.filter((tile) => !tile.discovered).every((tile) =>
      !tile.hasHighlandNode && !tile.hasHighlandLandmark)).toBe(true)
  })

  it('renders an accessible Quarry Crown map cue and explicit extraction action without claiming audio', () => {
    const node = highlandStoneNodes(seed)[0]
    const landmark = highlandLandmark(seed)
    const start = fresh()
    const state = at({ ...start,
      discoveredTileIds: [node.tile.id, landmark.tile.id],
      player: { ...start.player, inventory: [...start.player.inventory,
        { itemId: 'field_spade', quantity: 1 }],
      equipment: { ...start.player.equipment, mainHand: 'field_spade' },
      skillXp: { ...start.player.skillXp, excavation: 30 } },
      highland: { ...start.highland, landmarkDiscovered: true } }, node.tile.center.x, node.tile.center.z)
    const view = publicWorldV11ViewProjection(state, [], null)
    const map = renderToStaticMarkup(createElement(WizardMap, { projection: view, open: true,
      onToggle: () => {}, onIntent: () => {},
      buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>() }))
    expect(map).toContain('aria-label="Highland wind"')
    expect(map).toContain('aria-label="North-up world map')
    expect(map).toContain('Quarry Crown')
    expect(map).toContain('ready stone shelf')
    expect(map).not.toContain('audio')
    const hud = renderToStaticMarkup(createElement(WizardHud, { projection: view, onIntent: () => {} }))
    expect(hud).toContain('aria-label="Extract quarry stone"')
    expect(hud).toContain('<b>Extract</b>Highland stone outcrop')
  })
})
