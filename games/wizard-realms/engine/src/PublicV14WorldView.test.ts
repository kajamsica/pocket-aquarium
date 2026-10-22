import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { discoveryMaskHasTileId, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './domain/publicWorldDiscovery'
import { PUBLIC_V11_BOOTS_LISTING_ID } from './domain/publicWorldGait'
import { advancePublicV14GreenwayAction } from './domain/publicWorldV14Actions'
import { advancePublicV14BoundaryFrame } from './domain/publicWorldV14Boundary'
import { createPublicV14ContinuousSession } from './domain/publicWorldV14ContinuousSession'
import { advancePublicV14GreenwayFrame } from './domain/publicWorldV14GreenwayFrame'
import { createFreshPublicV14Head } from './domain/publicWorldV14Snapshot'
import type { PublicV14State } from './domain/publicWorldV14Snapshot'
import { createPublicV14StreamTerrain } from './domain/publicWorldV14Terrain'
import { resolvePublicV14Surface } from './domain/publicWorldV14Terrain'
import { validatePublicV14State } from './domain/publicWorldV14Validation'
import { starterCliffSupportAt } from './domain/starterCliffMovement'
import { STARTER_CLIFF_SITE_ID, starterCliffCanonicalFace,
  starterCliffCanonicalSite } from './domain/starterCliffProfile'
import { starterCliffWorldTileAtGrid } from './domain/starterCliffWorld'
import { resolveTerrainWorkSite } from './domain/terrainWorks'
import { publicWorldV14ViewProjection } from './PublicV14WorldView'
import { WizardHud } from './view/WizardHud'

const seed = 'greenway-alpha'
const fresh = () => createFreshPublicV14Head(seed)
const viewFor = (state: PublicV14State) => ({ movementOwner: state.movementOwner,
  tick: state.tick, player: structuredClone(state.player), pendingBoundary: false,
  activeKnownTileIds: discoveredTileIdsInActiveWindow(state.discoveryMask, state.player.position),
  activeTiles: state.movementOwner === 'greenway' ? state.greenway.tiles
    : createPublicV14StreamTerrain(state).activeTiles() })
const standing = (state: PublicV14State, x: number, z: number): PublicV14State => {
  const floor = starterCliffSupportAt({ seed: state.seed, profile: state.generationProfile,
    route: state.greenway.routes[0],
    built: state.greenway.builtRouteIds.includes('greenway_ladder') }, { x, z })?.floorY
  if (floor === undefined) throw new Error('No ground at test pose')
  return { ...state, player: { ...state.player,
    position: { x, y: floor, z }, verticalVelocity: 0 } }
}
const project = (state: PublicV14State, selected: string | null = null,
  open: string | null = null, walkRequested = false) =>
  publicWorldV14ViewProjection(state, viewFor(state), [], selected, open, walkRequested)
const knownTree = (state: PublicV14State) => state.greenway.resources.find((resource) =>
  resource.kind === 'tree' && discoveryMaskHasTileId(state.discoveryMask, resource.tileId)
  && Math.hypot(resource.position.x + 5, resource.position.z + 1) > 3)!

describe('pure v14 view projection', () => {
  it('uses fresh saved facts and the bounded session window, never an old low-step projection', () => {
    const { head, lineage } = fresh()
    const session = createPublicV14ContinuousSession({ state: head.state,
      bootstrap: null, saveRevision: 0, lineage })
    const state = session.previewSnapshot()
    const before = structuredClone(state)
    const view = publicWorldV14ViewProjection(state, session.view(), ['hello'], null)
    expect(view.starterCliff).toEqual({ face: starterCliffCanonicalFace(seed), ladder: null })
    expect(view.routes).toEqual([expect.objectContaining({ id: 'greenway_ladder',
      label: 'Starter cliff ladder', built: false, logCost: 4 })])
    expect(view.buildSites.map((site) => site.id)).toEqual([STARTER_CLIFF_SITE_ID])
    expect(view.buildSites[0]).toMatchObject({ discovered: true, status: 'too_far' })
    expect(view.map.guidance).toContain('Starter cliff ladder')
    expect(view.map.guidance).not.toContain('low steps')
    expect(view.visualWorld?.terrain).toHaveLength(256)
    expect(view.visualWorld?.discoveredTileIds.every((id) =>
      view.map.tiles.some((tile) => tile.id === id && tile.discovered))).toBe(true)
    expect(view.map.tiles.filter((tile) => !tile.discovered)
      .every((tile) => tile.terrain === null && tile.biome === null
        && !tile.hasRouteSite && !tile.hasBuiltRoute && !tile.hasResource)).toBe(true)
    expect(view.stores.find((store) => store.id === 'store-greenway')?.listings)
      .toEqual([{ id: PUBLIC_V11_BOOTS_LISTING_ID, name: 'Leather boots', price: 25 },
        { id: 'spade', name: 'Field spade', price: 18, stock: 3 }])
    expect(view.stores.flatMap((store) => store.listings).map((listing) => listing.id))
      .toEqual([PUBLIC_V11_BOOTS_LISTING_ID, 'spade'])
    expect(view.backpack.stacks).toContainEqual(expect.objectContaining({
      itemId: 'woodcutters_axe', quantity: 1, equippableSlots: ['mainHand'] }))
    expect(view.gait).toMatchObject({ pace: 'walk', canRun: false })
    expect(view.savedTerrainWorks).toBeUndefined()
    expect(view.fieldCamp).toBeUndefined()
    expect(view.highlandExtraction).toBeUndefined()
    expect(view.unavailableActions).toBeUndefined()
    expect(state).toEqual(before)
  })

  it('previews only a ready discovered canonical site, then renders the saved ladder as built', () => {
    let state = fresh().head.state
    const tree = knownTree(state)
    state = standing(state, tree.position.x, tree.position.z)
    state = advancePublicV14GreenwayAction(state,
      { type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' }).state
    state = advancePublicV14GreenwayAction(state,
      { type: 'harvest', resourceId: tree.id }).state
    state = advancePublicV14GreenwayAction(state,
      { type: 'harvest', resourceId: tree.id }).state
    const site = starterCliffCanonicalSite(seed)
    state = standing(state, site.from.x, site.from.z)
    const ready = project(state, STARTER_CLIFF_SITE_ID)
    expect(ready.buildSites).toMatchObject([{ id: STARTER_CLIFF_SITE_ID,
      status: 'ready', logCost: 4 }])
    expect(ready.starterCliff?.ladder).toBe('preview')
    expect(ready.selectedBuildSiteId).toBe(STARTER_CLIFF_SITE_ID)
    expect(project(state, 'greenway_ladder:x:2').selectedBuildSiteId).toBeNull()
    const built = advancePublicV14GreenwayAction(state,
      { type: 'build_route', routeId: 'greenway_ladder', siteId: STARTER_CLIFF_SITE_ID })
    expect(built.rejections).toEqual([])
    const finished = project(built.state, STARTER_CLIFF_SITE_ID)
    expect(finished.starterCliff?.ladder).toBe('built')
    expect(finished.routes[0].built).toBe(true)
    expect(finished.buildSites[0].status).toBe('built')
    expect(finished.selectedBuildSiteId).toBeNull()
    expect(finished.map.tiles.find((tile) => tile.id === 'tile-3-2')?.hasBuiltRoute).toBe(true)
  })

  it('guides a blocked west-rim walker to a discovered dry exit without revealing hidden ground', () => {
    const base = fresh().head.state
    const built = { ...base, greenway: { ...base.greenway,
      builtRouteIds: ['greenway_ladder' as const] } }
    const atWetRim = standing(built, -29.8, 5.8)
    expect(starterCliffWorldTileAtGrid(seed, -7, 1).id).toBe('tile--4-4')
    const discovered = [...new Set([
      ...discoveredTileIdsInActiveWindow(base.discoveryMask, base.player.position),
      ...nearbyWorldTileIds(atWetRim.player.position, PUBLIC_WALK_REVEAL_RADIUS_METERS),
    ])].sort()
    const blocked = { ...atWetRim, discoveryMask: encodeDiscoveredTileIds(discovered) }
    expect(advancePublicV14BoundaryFrame(standing(blocked, -30, 5.8),
      [{ type: 'move', delta: { x: -0.16, z: 0 } }], { walkRequested: true })
      .rejections[0]?.message).toBe('The crossing touches unsupported wetland.')
    expect(project(blocked).map.guidance).toMatch(/dry west exit.*6 m north.*cross west/i)
    const concealed = { ...blocked, discoveryMask: encodeDiscoveredTileIds(
      discovered.filter((id) => id !== 'tile--6-3')) }
    expect(project(concealed).map.guidance).not.toMatch(/dry west exit/i)
    expect(project(standing(blocked, -30, 0)).map.guidance).not.toMatch(/wetland blocks/i)
  })

  it('keeps Build disabled during a valid jump near a discovered ladder, then restores ready on landing', () => {
    let state = fresh().head.state
    const tree = knownTree(state)
    state = standing(state, tree.position.x, tree.position.z)
    state = advancePublicV14GreenwayAction(state,
      { type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' }).state
    for (let hit = 0; hit < 2; hit++) state = advancePublicV14GreenwayAction(state,
      { type: 'harvest', resourceId: tree.id }).state
    const site = starterCliffCanonicalSite(seed)
    state = standing(state, site.from.x, site.from.z)
    expect(validatePublicV14State(state, seed)).not.toBeNull()
    const jumped = advancePublicV14GreenwayFrame(state, [{ type: 'jump' }], { walkRequested: false })
    expect(jumped.rejections).toEqual([])
    expect(jumped.state.player.verticalVelocity).not.toBe(0)
    expect(advancePublicV14GreenwayAction(jumped.state, { type: 'build_route',
      routeId: 'greenway_ladder', siteId: STARTER_CLIFF_SITE_ID }).rejections[0]?.code).toBe('airborne')
    const airborne = project(jumped.state, STARTER_CLIFF_SITE_ID)
    expect(airborne.player.verticalVelocity).toBe(jumped.state.player.verticalVelocity)
    expect(airborne.buildSites[0]).toMatchObject({ status: 'obstructed', reason: expect.stringContaining('Land') })
    expect(airborne.starterCliff?.ladder).toBeNull()
    expect(renderToStaticMarkup(createElement(WizardHud, { projection: airborne,
      onIntent: () => {} }))).toMatch(/<button[^>]*disabled=""[^>]*>Build<\/button>/)
    state = jumped.state
    for (let frame = 0; frame < 40 && state.player.verticalVelocity !== 0; frame++) {
      state = advancePublicV14GreenwayFrame(state, [], { walkRequested: false }).state
    }
    expect(validatePublicV14State(state, seed)).not.toBeNull()
    expect(project(state).player.verticalVelocity).toBe(0)
    expect(project(state, STARTER_CLIFF_SITE_ID).buildSites[0].status).toBe('ready')
  })

  it('shows only actionable tree/Outfitters prompts and the virtual boots offer', () => {
    let state = fresh().head.state
    const tree = knownTree(state)
    const atTree = project(standing(state, tree.position.x, tree.position.z))
    expect(atTree.nearbyInteraction).toMatchObject({ kind: 'resource',
      targetId: tree.id, action: 'Equip axe', actionable: false })
    state = advancePublicV14GreenwayAction(standing(state, tree.position.x, tree.position.z),
      { type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' }).state
    expect(project(state).nearbyInteraction).toMatchObject({ kind: 'resource',
      action: 'Chop', actionable: true })
    state = standing(state, -5, -1)
    const atStore = project(state)
    expect(atStore.nearbyInteraction).toMatchObject({ kind: 'store',
      targetId: 'store-greenway', actionable: true })
    expect(atStore.openStoreId).toBeNull()
    expect(project(state, null, 'store-greenway').openStoreId).toBe('store-greenway')
    const bought = advancePublicV14GreenwayAction(state,
      { type: 'buy_store_listing', storeId: 'store-greenway',
        listingId: PUBLIC_V11_BOOTS_LISTING_ID })
    expect(bought.rejections).toEqual([])
    expect(project(bought.state).coins).toBe(95)
    expect(project(bought.state).stores[0].listings).toEqual([
      { id: 'spade', name: 'Field spade', price: 18, stock: 3 }])
    const worn = advancePublicV14GreenwayAction(bought.state,
      { type: 'equip_item', itemId: 'leather_boots', slot: 'feet' }).state
    expect(project(worn).gait).toMatchObject({ pace: 'run', canRun: true })
    expect(project(worn, null, null, true).gait).toMatchObject({ pace: 'walk', canRun: true })
  })

  it('chooses the nearer generated oak or Outfitters in their shared range, with store ties', () => {
    const source = createFreshPublicV14Head('wizard-realms').head.state
    const store = source.greenway.stores[0]
    const tree = source.greenway.resources.find((resource) => resource.id === 'resource-tile-2-3')!
    expect(tree.kind).toBe('tree')
    expect(tree.position.y).toBe(store.position.y)
    expect(Math.hypot(tree.position.x - store.position.x,
      tree.position.z - store.position.z)).toBeLessThan(3)
    const state = { ...source, discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...discoveredTileIdsInActiveWindow(source.discoveryMask, source.player.position), tree.tileId,
    ])].sort()) }
    const atTree = standing(state, tree.position.x, tree.position.z)
    const treeView = project(atTree)
    expect(treeView.nearbyInteraction).toMatchObject({ kind: 'resource', targetId: tree.id,
      action: 'Equip axe', actionable: false })
    expect(treeView.nearbyStoreId).toBe(store.id)
    const equipped = advancePublicV14GreenwayAction(atTree,
      { type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' })
    const actionableView = project(equipped.state)
    expect(actionableView.nearbyInteraction).toMatchObject({ kind: 'resource',
      targetId: tree.id, action: 'Chop', actionable: true })
    expect(actionableView.visualWorld?.resources.find((resource) =>
      resource.id === actionableView.nearbyInteraction?.targetId))
      .toMatchObject({ id: tree.id, kind: 'tree', available: true })
    expect(project(atTree, null, store.id)).toMatchObject({ openStoreId: store.id,
      nearbyInteraction: null })
    expect(advancePublicV14GreenwayAction(atTree, { type: 'buy_store_listing',
      storeId: store.id, listingId: 'spade' }).rejections).toEqual([])
    expect(project(standing(state, store.position.x, store.position.z)).nearbyInteraction)
      .toMatchObject({ kind: 'store', targetId: store.id, action: 'Open store' })
    const tie = standing(state, (tree.position.x + store.position.x) / 2,
      (tree.position.z + store.position.z) / 2)
    expect(project(tie).nearbyInteraction).toMatchObject({ kind: 'store', targetId: store.id })
  })

  it('shows stocked spade and owned stone at Outfitters, then hides a duplicate or empty stock', () => {
    const atStore = standing(fresh().head.state, -5, -1)
    const withStone = { ...atStore, player: { ...atStore.player, inventory: [
      ...atStore.player.inventory, { itemId: 'stone' as const, quantity: 3 }] } }
    const before = structuredClone(withStone)
    const view = project(withStone, null, 'store-greenway')
    expect(view.openStoreId).toBe('store-greenway')
    expect(view.stores[0].sellOffers).toEqual([
      { itemId: 'stone', name: 'Stone', quantity: 3, unitPrice: 1 }])
    expect(view.backpack.stacks).toContainEqual(expect.objectContaining({ itemId: 'stone', quantity: 3 }))
    expect(withStone).toEqual(before)
    const bought = advancePublicV14GreenwayAction(atStore,
      { type: 'buy_store_listing', storeId: 'store-greenway', listingId: 'spade' })
    expect(bought.rejections).toEqual([])
    expect(project(bought.state).stores[0].listings.map((listing) => listing.id))
      .not.toContain('spade')
    expect(project(bought.state).backpack.stacks).toContainEqual(expect.objectContaining({
      itemId: 'field_spade', name: 'Field spade', equippableSlots: ['mainHand'] }))
    const equipped = advancePublicV14GreenwayAction(bought.state,
      { type: 'equip_item', itemId: 'field_spade', slot: 'mainHand' })
    expect(equipped.rejections).toEqual([])
    expect(project(equipped.state).equipment.mainHand).toMatchObject({
      itemId: 'field_spade', name: 'Field spade', equippableSlots: ['mainHand'] })
    const store = atStore.greenway.stores[0]
    const empty: PublicV14State = { ...atStore, greenway: { ...atStore.greenway, stores: [
      { ...store, listings: store.listings.map((listing) => listing.id === 'spade'
        ? { ...listing, stock: 0 } : listing) }, atStore.greenway.stores[1]] } }
    expect(project(empty).stores[0].listings.map((listing) => listing.id)).not.toContain('spade')
    expect(project(fresh().head.state).openStoreId).toBeNull()
  })

  it('hides store offers and nearby tree actions in a jump, then restores the same store preference on landing', () => {
    const atStore = standing(fresh().head.state, -5, -1)
    expect(project(atStore, null, 'store-greenway').openStoreId).toBe('store-greenway')
    const jumped = advancePublicV14GreenwayFrame(atStore, [{ type: 'jump' }], { walkRequested: false })
    expect(jumped.rejections).toEqual([])
    const airborne = project(jumped.state, null, 'store-greenway')
    expect(airborne.openStoreId).toBeNull()
    expect(airborne.nearbyStoreId).toBeNull()
    expect(airborne.nearbyInteraction).toBeNull()
    expect(renderToStaticMarkup(createElement(WizardHud, { projection: airborne,
      onIntent: () => {} }))).not.toContain('data-store-panel')
    let landed = jumped.state
    for (let frame = 0; frame < 40 && landed.player.verticalVelocity !== 0; frame++) {
      landed = advancePublicV14GreenwayFrame(landed, [], { walkRequested: false }).state
    }
    expect(project(landed, null, 'store-greenway').openStoreId).toBe('store-greenway')
    const tree = knownTree(landed)
    const nearTree = standing(landed, tree.position.x, tree.position.z)
    const treeJump = advancePublicV14GreenwayFrame(nearTree, [{ type: 'jump' }], { walkRequested: false })
    expect(treeJump.rejections).toEqual([])
    expect(project(treeJump.state).nearbyInteraction).toBeNull()
    expect(project(nearTree).nearbyInteraction?.kind).toBe('resource')
  })

  it('rejects stale or foreign active windows before constructing map or scene objects', () => {
    const state = fresh().head.state, active = viewFor(state)
    expect(() => publicWorldV14ViewProjection(state, { ...active, tick: 1 }, [], null))
      .toThrow(RangeError)
    expect(() => publicWorldV14ViewProjection(state, { ...active, player: {
      ...active.player, position: { ...active.player.position, x: 1 } } }, [], null))
      .toThrow(RangeError)
    expect(() => publicWorldV14ViewProjection(state, { ...active,
      activeTiles: [...active.activeTiles, active.activeTiles[0]] }, [], null))
      .toThrow(RangeError)
    expect(() => publicWorldV14ViewProjection(state, { ...active,
      activeKnownTileIds: ['tile-999-999'] }, [], null)).toThrow(RangeError)
  })

  it('keeps streamed scenery bounded and fogged, with unsupported interactions off', () => {
    const base = fresh().head.state
    const tile = starterCliffWorldTileAtGrid(seed, 9, 0)
    const state = validatePublicV14State({ ...base, movementOwner: 'streamed',
      player: { ...base.player, position: { ...tile.center } },
      discoveryMask: encodeDiscoveredTileIds([...new Set([...discoveredTileIdsInActiveWindow(
        base.discoveryMask, base.player.position), tile.id])].sort()) }, seed)
    expect(state).not.toBeNull()
    const view = project(state!)
    expect(view.unavailableActions).toBe(true)
    expect(view.nearbyInteraction).toBeNull()
    expect(view.buildSites).toEqual([])
    expect(view.visualWorld!.terrain.length).toBeLessThanOrEqual(31 * 31)
    expect(view.map.tiles.length).toBeLessThanOrEqual(33 * 33)
    expect(view.map.tiles.some((entry) => !entry.discovered)).toBe(true)
    expect(view.map.tiles.filter((entry) => !entry.discovered)
      .every((entry) => !entry.hasRouteSite && !entry.hasBuiltRoute && entry.terrain === null))
      .toBe(true)
    expect(view.savedTerrainWorks).toMatchObject({ builtSites: [], dugTileIds: [],
      preview: null, actionsEnabled: false })
  })

  it.each([
    ['bridge', 'works1:bridge:-102:92:z'],
    ['ladder', 'works1:ladder:-103:108:W'],
    ['dig', 'tile--64-76'],
  ] as const)('keeps discovered %s Works previews read-only and hidden footprints absent',
    (kind, id) => {
      const site = resolveTerrainWorkSite(seed, id)!
      expect(site.kind).toBe(kind)
      const point = site.kind === 'dig' ? site.center : site.from
      const base = fresh().head.state
      const atPoint = { ...base, movementOwner: 'streamed' as const,
        player: { ...base.player, position: { ...point } } }
      const floor = resolvePublicV14Surface(atPoint, point)?.floorY
      expect(floor).toBeDefined()
      const mask = encodeDiscoveredTileIds([...new Set([
        ...discoveredTileIdsInActiveWindow(base.discoveryMask, base.player.position),
        ...site.footprintTileIds,
      ])].sort())
      const state = validatePublicV14State({ ...atPoint,
        player: { ...atPoint.player, position: { ...point, y: floor } },
        discoveryMask: mask }, seed)
      expect(state).not.toBeNull()
      const full = publicWorldV14ViewProjection(state!, viewFor(state!), [], null,
        null, false, { kind, bodyYaw: 0 })
      expect(full.savedTerrainWorks?.actionsEnabled).toBe(false)
      expect(full.savedTerrainWorks?.preview?.nearby.map((candidate) => candidate.site.id))
        .toContain(id)
      expect(full.savedTerrainWorks?.suggestedSites?.map((candidate) => candidate.id))
        .toContain(id)
      expect(full.savedTerrainWorks?.suggestedSites?.length).toBeLessThanOrEqual(5)
      expect(full.savedTerrainWorks?.suggestedSites?.every((candidate) => candidate.kind === kind))
        .toBe(true)
      expect(full.savedTerrainWorks?.preview?.nearby.find((candidate) => candidate.site.id === id))
        .toMatchObject(kind === 'bridge'
          ? { rejection: 'not_owned', reason: 'Gather 8 logs.' }
          : kind === 'ladder' ? { rejection: 'not_owned', reason: 'Gather 4 logs.' }
            : { rejection: 'occupied', reason: 'Move off this footprint.' })
      const closed = publicWorldV14ViewProjection(state!, viewFor(state!), [], null,
        null, false, { kind, bodyYaw: 0, modeActive: false, actionsEnabled: true })
      expect(closed.savedTerrainWorks).toMatchObject({ modeActive: false,
        selectedKind: kind, actionsEnabled: true, suggestedSites: [], preview: null })
      expect(publicWorldV14ViewProjection(fresh().head.state,
        viewFor(fresh().head.state), [], null, null, false,
        { kind, bodyYaw: 0, modeActive: true, actionsEnabled: true }).savedTerrainWorks)
        .toBeUndefined()
      const xp = kind === 'bridge' ? 80 : kind === 'ladder' ? 60 : 30
      const completedRaw = { ...state!, eventSequence: state!.eventSequence + 1,
        terrainWorks: { builtWorkIds: kind === 'dig' ? [] : [id],
          dugTileIds: kind === 'dig' ? [id] : [] },
        player: { ...state!.player, xp: state!.player.xp + xp,
          level: 1 + Math.floor((state!.player.xp + xp) / 100),
          skillXp: { ...state!.player.skillXp,
            construction: state!.player.skillXp.construction + (kind === 'dig' ? 0 : xp),
            excavation: state!.player.skillXp.excavation + (kind === 'dig' ? xp : 0) },
          position: state!.player.position } }
      const floorAfter = resolvePublicV14Surface(completedRaw, completedRaw.player.position)?.floorY
      expect(floorAfter).toBeDefined()
      const completed = validatePublicV14State({ ...completedRaw,
        player: { ...completedRaw.player, position: { ...completedRaw.player.position,
          y: floorAfter! } } }, seed)
      expect(completed).not.toBeNull()
      const after = publicWorldV14ViewProjection(completed!, viewFor(completed!), [], null,
        null, false, { kind, bodyYaw: 0 })
      expect(after.savedTerrainWorks?.suggestedSites?.map((candidate) => candidate.id))
        .not.toContain(id)
      expect(after.savedTerrainWorks?.preview?.nearby.map((candidate) => candidate.site.id))
        .not.toContain(id)
      if (kind === 'dig') return
      const readyState = validatePublicV14State({ ...state,
        player: { ...state!.player, inventory: [...state!.player.inventory,
          { itemId: 'logs', quantity: site.kind === 'bridge' ? 8 : 4 }] } }, seed)
      expect(readyState).not.toBeNull()
      const ready = publicWorldV14ViewProjection(readyState!, viewFor(readyState!), [], null,
        null, false, { kind, bodyYaw: 0, modeActive: true, actionsEnabled: true })
      expect(ready.savedTerrainWorks?.preview?.nearby.find((candidate) => candidate.site.id === id))
        .toMatchObject({ rejection: null, reason: 'Ready to build here.' })
      const hidden = site.footprintTileIds.find((tileId) => tileId !==
        `tile-${Math.ceil(point.x / 4 - .5) + 3}-${Math.ceil(point.z / 4 - .5) + 3}`)!
      const concealed = validatePublicV14State({ ...state,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...discoveredTileIdsInActiveWindow(base.discoveryMask, base.player.position),
          ...site.footprintTileIds.filter((tileId) => tileId !== hidden),
        ])].sort()) }, seed)
      expect(concealed).not.toBeNull()
      const partial = publicWorldV14ViewProjection(concealed!, viewFor(concealed!), [], null,
        null, false, { kind, bodyYaw: 0 })
      expect(partial.savedTerrainWorks?.preview?.nearby.map((candidate) => candidate.site.id))
        .not.toContain(id)
      expect(partial.savedTerrainWorks?.suggestedSites?.map((candidate) => candidate.id))
        .not.toContain(id)
      const anchorId = `tile-${Math.ceil(point.x / 4 - .5) + 3}-${Math.ceil(point.z / 4 - .5) + 3}`
      const outsideWindow = viewFor(state!)
      const clipped = publicWorldV14ViewProjection(state!, { ...outsideWindow,
        activeTiles: outsideWindow.activeTiles.filter((tile) => tile.id !== anchorId) }, [], null,
        null, false, { kind, bodyYaw: 0 })
      expect(clipped.savedTerrainWorks?.preview?.nearby.map((candidate) => candidate.site.id))
        .not.toContain(id)
      expect(clipped.savedTerrainWorks?.suggestedSites?.map((candidate) => candidate.id))
        .not.toContain(id)
    })

  it('does not reveal a visible saved bridge whose full footprint is undiscovered', () => {
    const bridge = resolveTerrainWorkSite(seed, 'works1:bridge:-102:92:z')!
    if (bridge.kind !== 'bridge') throw new Error('Missing canonical bridge')
    const base = fresh().head.state
    const saved = { ...base, tick: 1, movementOwner: 'streamed' as const,
      terrainWorks: { builtWorkIds: [bridge.id], dugTileIds: [] },
      player: { ...base.player, xp: 110, level: 2,
        skillXp: { ...base.player.skillXp, construction: 80 } } }
    const surface = resolvePublicV14Surface(saved, bridge.from)!
    const discovered = encodeDiscoveredTileIds([...new Set([
      ...discoveredTileIdsInActiveWindow(base.discoveryMask, base.player.position),
      surface.tileId,
    ])].sort())
    const state = validatePublicV14State({ ...saved,
      player: { ...saved.player, position: { ...bridge.from, y: surface.floorY } },
      discoveryMask: discovered }, seed)
    expect(state).not.toBeNull()
    expect(discoveryMaskHasTileId(state!.discoveryMask, bridge.footprintTileIds[0])).toBe(false)
    const view = project(state!)
    expect(view.savedTerrainWorks).toMatchObject({ builtSites: [], dugTileIds: [],
      actionsEnabled: false })
  })
})
