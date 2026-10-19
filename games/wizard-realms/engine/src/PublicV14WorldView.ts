import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { classifyStreamedRegion } from './domain/highlandContent'
import type { MireglassItemId } from './domain/mireglassExpedition'
import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { previewPublicV14TerrainWork } from './domain/publicWorldV14TerrainWork'
import { PUBLIC_V11_BOOTS_LISTING_ID, PUBLIC_V11_BOOTS_PRICE,
  publicV11Gait } from './domain/publicWorldGait'
import type { PublicV14ContinuousSession } from './domain/publicWorldV14ContinuousSession'
import type { PublicV14State } from './domain/publicWorldV14Snapshot'
import { starterCliffPoseValid } from './domain/starterCliffMovement'
import { STARTER_CLIFF_SITE_ID, starterCliffCanonicalFace,
  starterCliffCanonicalSite } from './domain/starterCliffProfile'
import { starterCliffWorldTileAtGrid } from './domain/starterCliffWorld'
import { enumerateTerrainWorkSites, resolveTerrainWorkSite } from './domain/terrainWorks'
import type { TerrainWorkSite } from './domain/terrainWorks'
import type { Vec3 } from './domain/types'
import { storeSellUnitPrice } from './domain/world'
import { activeChunkCoordinates, WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from './domain/worldChunks'
import { highlandTerrainFor } from './PublicV11WorldView'
import type { EquipmentSlot, WizardItemStack, WizardMapTile,
  WizardViewProjection } from './view/contracts'
import { visibleMapTiles } from './view/visibleMap'
import { PUBLIC_VISUAL_RADIUS_CELLS, visibleTerrainCells } from './view/visibleTerrain'

type Active = ReturnType<PublicV14ContinuousSession['view']>
export type PublicV14WorkPreviewInput = Readonly<{
  kind: TerrainWorkSite['kind']; bodyYaw: number; modeActive?: boolean; actionsEnabled?: boolean
}>
let cachedWorkSites: { key: string; sites: readonly TerrainWorkSite[] } | null = null
const point = (value: Vec3): readonly [number, number, number] => [value.x, value.y, value.z]
const grid = (value: number) => Math.ceil(value / WORLD_CELL_METERS - 0.5)
const tileIdAt = (value: { x: number; z: number }) =>
  `tile-${grid(value.x) + 3}-${grid(value.z) + 3}`
const distance = (left: Vec3, right: Vec3) =>
  Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
const colors = { loam: '#56824b', wetland: '#466f62', rocky: '#7b765e', snow: '#d4e3df' }
const itemNames: Partial<Record<MireglassItemId, string>> = {
  woodcutters_axe: 'Woodcutter axe', logs: 'Greenway logs', leather_boots: 'Leather boots',
  field_spade: 'Field spade',
  'mireglass_reach/item/seal': 'Mireglass seal',
  'mireglass_reach/item/waders': 'Fen waders',
}
const item = (itemId: MireglassItemId, quantity: number): WizardItemStack => ({
  id: `inventory-${itemId}`, itemId,
  name: itemNames[itemId] ?? itemId.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()),
  quantity,
  ...(itemId === 'woodcutters_axe' || itemId === 'field_spade'
    ? { equippableSlots: ['mainHand' as const] }
    : itemId === 'leather_boots' ? { equippableSlots: ['feet' as const] } : {}),
})

function assertActive(state: PublicV14State, active: Active): void {
  const shown = active?.player, saved = state.player
  if (!shown || active.movementOwner !== state.movementOwner || active.tick !== state.tick
    || shown.position.x !== saved.position.x || shown.position.y !== saved.position.y
    || shown.position.z !== saved.position.z || shown.yaw !== saved.yaw
    || shown.pitch !== saved.pitch || shown.verticalVelocity !== saved.verticalVelocity
    || !Array.isArray(active.activeTiles) || active.activeTiles.length < 1
    || active.activeTiles.length > 9 * WORLD_CHUNK_CELLS ** 2) {
    throw new RangeError('The v14 view and active terrain must describe the same bounded frame.')
  }
  const known = discoveredTileIdsInActiveWindow(state.discoveryMask, saved.position)
  if (known.length !== active.activeKnownTileIds?.length
    || known.some((id, index) => id !== active.activeKnownTileIds[index])) {
    throw new RangeError('The v14 view has stale discovery facts.')
  }
  const greenway = new Map(state.greenway.tiles.map((tile) => [tile.id, tile]))
  const chunks = new Set(activeChunkCoordinates(saved.position)
    .map(({ chunkX, chunkZ }) => `${chunkX}:${chunkZ}`))
  const seen = new Set<string>()
  if (state.movementOwner === 'greenway' && active.activeTiles.length !== greenway.size) {
    throw new RangeError('The active Greenway window is incomplete.')
  }
  for (const tile of active.activeTiles) {
    if (seen.has(tile.id) || tile.id !== `tile-${tile.gridX}-${tile.gridZ}`
      || tile.center.x !== (tile.gridX - 3) * WORLD_CELL_METERS
      || tile.center.z !== (tile.gridZ - 3) * WORLD_CELL_METERS
      || (state.movementOwner === 'greenway'
        ? greenway.get(tile.id)?.center.y !== tile.center.y
        : !chunks.has(`${Math.floor((tile.gridX - 3) / WORLD_CHUNK_CELLS)}:${Math.floor((tile.gridZ - 3) / WORLD_CHUNK_CELLS)}`))) {
      throw new RangeError('The active v14 window contains foreign or duplicate terrain.')
    }
    seen.add(tile.id)
  }
}

/** Discovered-only, bounded Works choices. The checked writer remains authoritative. */
function savedWorksFor(state: PublicV14State, visible: ReadonlySet<string>,
  request?: PublicV14WorkPreviewInput): WizardViewProjection['savedTerrainWorks'] {
  const builtSites = state.terrainWorks.builtWorkIds.flatMap((id) => {
    const site = resolveTerrainWorkSite(state.seed, id)
    return site && site.kind !== 'dig'
      && site.footprintTileIds.every((tileId) => discoveryMaskHasTileId(state.discoveryMask, tileId))
      && site.footprintTileIds.some((tileId) => visible.has(tileId))
      ? [site] : []
  })
  const dugTileIds = state.terrainWorks.dugTileIds.filter((id) => visible.has(id)
    && discoveryMaskHasTileId(state.discoveryMask, id))
  const controls = { builtSites, dugTileIds, actionsEnabled: request?.actionsEnabled === true,
    suggestedSites: [] as readonly TerrainWorkSite[],
    ...(request?.modeActive !== undefined ? { modeActive: request.modeActive,
      selectedKind: request.kind } : {}) }
  if (!request || request.modeActive === false) return { ...controls, preview: null }
  if (!Number.isFinite(request.bodyYaw) || !['bridge', 'ladder', 'dig'].includes(request.kind)) {
    throw new RangeError('A finite v14 Works preview heading and kind are required.')
  }
  if (classifyStreamedRegion(state.seed, state.player.position) !== 'mireglass_reach') {
    return { ...controls, preview: { selected: null, nearby: [],
      guidance: 'Follow the west trail to Mireglass to find Fen, Slate, and loam Works.' } }
  }
  const gx = grid(state.player.position.x), gz = grid(state.player.position.z)
  const key = `${state.seed}:${gx}:${gz}`
  if (cachedWorkSites?.key !== key) cachedWorkSites = { key,
    sites: enumerateTerrainWorkSites(state.seed, {
      minGX: gx - 4, maxGX: gx + 4, minGZ: gz - 4, maxGZ: gz + 4 }) }
  const sites = cachedWorkSites.sites
  const faceX = -Math.sin(request.bodyYaw), faceZ = -Math.cos(request.bodyYaw)
  const nearby = sites.filter((site) => site.kind === request.kind
    && site.footprintTileIds.every((id) => discoveryMaskHasTileId(state.discoveryMask, id))
    && !state.terrainWorks.builtWorkIds.includes(site.id)
    && !state.terrainWorks.dugTileIds.includes(site.id)
    && visible.has(tileIdAt(site.kind === 'dig' ? site.center : site.from)))
    .flatMap((site) => {
      const target = site.kind === 'dig' ? site.center : site.from
      const dx = target.x - state.player.position.x, dz = target.z - state.player.position.z
      const distanceMeters = Math.hypot(dx, dz)
      if (distanceMeters > 16) return []
      const angleRadians = distanceMeters < 1e-9 ? 0
        : Math.atan2(Math.abs(faceX * dz - faceZ * dx), faceX * dx + faceZ * dz)
      const benefit = site.kind === 'dig' ? 'Lower loam by 0.24 m and gain stone.'
        : site.kind === 'bridge' ? 'Cross a shallow Fen channel; costs 8 logs.'
          : 'Climb a Slate cliff; costs 4 logs.'
      return [{ site, distanceMeters, angleRadians, benefit }]
    }).sort((a, b) => a.angleRadians - b.angleRadians
      || a.distanceMeters - b.distanceMeters || a.site.id.localeCompare(b.site.id)).slice(0, 5)
    .map((choice) => {
      const rejection = previewPublicV14TerrainWork(state, choice.site.id).rejection
      const reason = rejection === null ? choice.site.kind === 'dig' ? 'Ready to dig here.' : 'Ready to build here.'
        : rejection === 'not_owned' ? choice.site.kind === 'dig' ? 'Own a field spade.'
          : `Gather ${choice.site.logCost} logs.`
          : rejection === 'requires_spade' ? 'Own and equip a field spade.'
            : rejection === 'capacity' ? 'Free one backpack slot.'
              : rejection === 'occupied' ? 'Move off this footprint.'
                : rejection === 'too_far' ? 'Move within 3 m of this site.' : `Unavailable: ${rejection}.`
      return { ...choice, rejection, reason }
    })
  return { ...controls, suggestedSites: nearby.map(({ site }) => site), preview: {
    selected: nearby.find(({ angleRadians }) => angleRadians <= Math.PI / 6) ?? null,
    nearby, guidance: nearby.length ? null : 'Explore nearby ground to discover Works sites.' } }
}

/** Version-native read model. The session owns movement and checked actions own changes. */
export function publicWorldV14ViewProjection(state: PublicV14State, active: Active,
  messages: readonly string[], selectedSiteId: string | null,
  openStoreId: string | null = null, walkRequested = false,
  workPreview?: PublicV14WorkPreviewInput): WizardViewProjection {
  assertActive(state, active)
  const player = state.player, greenway = state.movementOwner === 'greenway'
  const known = new Set(active.activeKnownTileIds)
  const tiles = greenway ? state.greenway.tiles : active.activeTiles
  const cells = highlandTerrainFor(tiles.map((tile) => ({
    id: tile.id, position: point(tile.center), size: [WORLD_CELL_METERS, WORLD_CELL_METERS] as const,
    height: 0.7 + tile.elevation * 3, climate: tile.biome, color: colors[tile.terrain],
  })), state.seed)
  const terrain = visibleTerrainCells(cells, point(player.position), PUBLIC_VISUAL_RADIUS_CELLS)
  const visible = new Set(terrain.map((cell) => cell.id))
  const savedTerrainWorks = greenway ? undefined : savedWorksFor(state, visible, workPreview)
  const shown = (position: Vec3) => visible.has(tileIdAt(position)) && known.has(tileIdAt(position))
  const site = starterCliffCanonicalSite(state.seed)
  const siteKnown = greenway && discoveryMaskHasTileId(state.discoveryMask, tileIdAt(site.from))
  const built = state.greenway.builtRouteIds.includes('greenway_ladder')
  const route = state.greenway.routes.find((entry) => entry.id === 'greenway_ladder')!
  const grounded = starterCliffPoseValid({ seed: state.seed, profile: state.generationProfile,
    route, built }, player.position, player.verticalVelocity)
  const logs = state.player.inventory.filter((stack) => stack.itemId === 'logs')
    .reduce((total, stack) => total + stack.quantity, 0)
  const cost = state.greenway.recipes.find((recipe) => recipe.id === 'greenway_ladder')?.logCost ?? 4
  const status = built ? 'built' : !state.greenway.unlockedRecipeIds.includes('greenway_ladder')
    ? 'locked' : distance(player.position, site.from) > 3 ? 'too_far'
      : !grounded ? 'obstructed' : logs < cost ? 'needs_logs' : 'ready'
  const reason = status === 'built' ? 'The ladder is complete.'
    : status === 'locked' ? 'Learn the starter ladder recipe first.'
      : status === 'too_far' ? 'Move within 3 m of the discovered cliff foot.'
        : status === 'obstructed' ? 'Land on supported ground before building.'
          : status === 'needs_logs' ? `Chop trees until you carry ${cost} logs.`
          : `Ready: spend ${cost} logs to build the ladder.`
  const buildSites: WizardViewProjection['buildSites'] = siteKnown ? [{
    id: STARTER_CLIFF_SITE_ID, routeId: 'greenway_ladder', label: 'Starter cliff ladder',
    from: point(site.from), to: point(site.to), logCost: cost, status, reason, discovered: true,
  }] : []
  const selected = !built && siteKnown && selectedSiteId === STARTER_CLIFF_SITE_ID
    ? STARTER_CLIFF_SITE_ID : null
  const routes: WizardViewProjection['routes'] = [{ id: route.id, label: 'Starter cliff ladder',
    from: point(route.from), to: point(route.to), built,
    unlocked: state.greenway.unlockedRecipeIds.includes('greenway_ladder'), logCost: cost }]
  const resources: WizardViewProjection['resources'] = state.greenway.resources
    .filter((resource) => resource.kind === 'tree' && shown(resource.position))
    .map((resource) => ({ id: resource.id, kind: 'tree', label: 'Greenway oak',
      position: point(resource.position), available: !resource.depleted }))
  const ownsBoots = state.player.inventory.some((stack) => stack.itemId === 'leather_boots')
    || state.player.tradeSlots.some((slot) => slot.itemId === 'leather_boots')
  const ownsSpade = state.player.inventory.some((stack) => stack.itemId === 'field_spade')
    || state.player.tradeSlots.some((slot) => slot.itemId === 'field_spade')
  const stoneQuantity = state.player.inventory.filter((stack) => stack.itemId === 'stone')
    .reduce((total, stack) => total + stack.quantity, 0)
  const stonePrice = storeSellUnitPrice('store-greenway', 'stone')
  const stores: WizardViewProjection['stores'] = state.greenway.stores
    .filter((store) => shown(store.position)).map((store) => {
      const spade = store.id === 'store-greenway' ? store.listings.find((listing) =>
        listing.id === 'spade' && listing.itemId === 'field_spade' && listing.stock > 0) : null
      return { id: store.id, name: store.name, position: point(store.position),
        sellOffers: store.id === 'store-greenway' && stoneQuantity > 0 && stonePrice !== null
          ? [{ itemId: 'stone', name: 'Stone', quantity: stoneQuantity, unitPrice: stonePrice }] : [],
        listings: store.id === 'store-greenway'
          ? [...(!ownsBoots ? [{ id: PUBLIC_V11_BOOTS_LISTING_ID,
            name: 'Leather boots', price: PUBLIC_V11_BOOTS_PRICE }] : []),
            ...(spade && !ownsSpade ? [{ id: spade.id, name: 'Field spade',
              price: spade.price, stock: spade.stock }] : [])] : [] }
    })
  const outfitters = stores.find((store) => store.id === 'store-greenway')
  const storeDistance = outfitters ? distance(player.position, state.greenway.stores[0].position) : Infinity
  const storeNear = grounded && outfitters && storeDistance <= 3
  const open = storeNear && openStoreId === 'store-greenway' ? openStoreId : null
  const resourceDistance = (resource: WizardViewProjection['resources'][number]) =>
    distance(player.position, { x: resource.position[0], y: resource.position[1],
      z: resource.position[2] })
  const nearbyTree = resources.filter((resource) => resource.available
    && resourceDistance(resource) <= 3)
    .sort((left, right) => Math.hypot(player.position.x - left.position[0],
      player.position.z - left.position[2]) - Math.hypot(player.position.x - right.position[0],
      player.position.z - right.position[2]) || left.id.localeCompare(right.id))[0]
  const treeCloser = nearbyTree && resourceDistance(nearbyTree) < storeDistance
  const nearbyInteraction: WizardViewProjection['nearbyInteraction'] = !greenway || !grounded ? null
    : storeNear && !open && !treeCloser ? { kind: 'store', targetId: 'store-greenway',
      label: 'Greenway Outfitters', action: 'Open store', actionable: true }
      : !open && nearbyTree ? { kind: 'resource', targetId: nearbyTree.id,
        label: nearbyTree.label,
        action: player.equipment.mainHand === 'woodcutters_axe' ? 'Chop' : 'Equip axe',
        actionable: player.equipment.mainHand === 'woodcutters_axe' } : null
  const equipped = (slot: EquipmentSlot) => player.equipment[slot]
    ? item(player.equipment[slot], 1) : null
  const equipment = { head: equipped('head'), chest: equipped('chest'),
    legs: equipped('legs'), feet: equipped('feet'), mainHand: equipped('mainHand'),
    offHand: equipped('offHand') }
  const trade = (index: 0 | 1 | 2 | 3) => {
    const slot = player.tradeSlots[index]
    return slot.itemId ? { id: `trade-${index}`, itemName: item(slot.itemId, 1).name,
      quantity: slot.quantity, unitPrice: slot.unitPrice } : null
  }
  const gait = publicV11Gait(player.equipment.feet, walkRequested)
  const tileWindow = visibleMapTiles(tiles, grid(player.position.x) + 3,
    grid(player.position.z) + 3)
  const mapTiles: WizardMapTile[] = tileWindow.map((tile) => {
    const discovered = known.has(tile.id)
    return { id: tile.id, gridX: tile.gridX, gridZ: tile.gridZ,
      terrain: discovered ? tile.terrain : null, biome: discovered ? tile.biome : null,
      discovered, hasResource: discovered && resources.some((resource) =>
        tileIdAt({ x: resource.position[0], z: resource.position[2] }) === tile.id && resource.available),
      hasStore: discovered && tileIdAt(state.greenway.stores[0].position) === tile.id,
      hasRing: false, hasRouteSite: discovered && siteKnown && !built && tileIdAt(site.from) === tile.id,
      hasBuiltRoute: discovered && built && tileIdAt(site.from) === tile.id }
  })
  const westRimWet = greenway && player.position.x >= -30 && player.position.x <= -26
    && player.position.z > 2 && player.position.z <= 6
    && [grid(player.position.x), grid(player.position.x) - 1].some((gx) =>
      starterCliffWorldTileAtGrid(state.seed, gx, grid(player.position.z)).terrain === 'wetland')
  const dryWestExitKnown = westRimWet && [-7, -8, -9].every((gx) => {
    const tile = starterCliffWorldTileAtGrid(state.seed, gx, 0)
    return known.has(tile.id) && tile.terrain !== 'wetland'
  })
  const guidance = dryWestExitKnown
    ? `Dry west exit about ${Math.max(1, Math.round(player.position.z))} m north. Stay on this bank, then cross west.`
    : !greenway ? 'Walk to chart nearby ground. Unexplored terrain stays hidden.'
    : built ? 'Starter cliff ladder built. Face north and walk with W to climb, or S to descend.'
      : !siteKnown ? 'Explore Greenway’s north edge to discover the cliff foot. Trees supply ladder logs.'
        : status === 'ready' ? `Starter cliff ladder ready. Select its discovered map site to spend ${cost} logs.`
          : `Starter cliff ladder: ${reason} Each oak takes two chops and yields four logs.`
  return { seed: state.seed, tick: state.tick,
    player: { position: point(player.position), yaw: player.yaw, pitch: player.pitch,
      verticalVelocity: player.verticalVelocity },
    terrain, visualWorld: { terrain, resources, stores, fairyRings: [], inscriptions: [],
      digSites: [], landmarks: [], routes, buildSites,
      discoveredTileIds: [...known].filter((id) => visible.has(id)) },
    resources, stores, fairyRings: [], inscriptions: [], digSites: [], routes, buildSites,
    selectedBuildSiteId: selected, skillXp: { ...player.skillXp },
    learnedSpellIds: [...player.learnedSpellIds],
    ...(savedTerrainWorks ? { savedTerrainWorks } : {}),
    starterCliff: { face: starterCliffCanonicalFace(state.seed),
      ladder: built ? 'built' : selected && status === 'ready' ? 'preview' : null },
    highlandRidgeActive: true, ...(greenway ? {} : { unavailableActions: true as const }),
    map: { tiles: mapTiles, player: { gridX: grid(player.position.x) + 3,
      gridZ: grid(player.position.z) + 3, yaw: player.yaw },
      title: greenway ? 'Greenway' : classifyStreamedRegion(state.seed, player.position),
      legend: '▲ you · ◇ discovered ladder site · ✓ built ladder · S Outfitters · • oak · ? unexplored',
      guidance },
    openStoreId: open, nearbyStoreId: storeNear && !open ? 'store-greenway' : null,
    nearbyInteraction,
    backpack: { capacity: player.backpackCapacity,
      stacks: player.inventory.map((stack) => item(stack.itemId, stack.quantity)) },
    coins: player.coins, experience: { xp: player.xp,
      nextLevelXp: player.level * 100, level: player.level }, equipment,
    gait: { pace: gait.pace, canRun: gait.canRun, reason: gait.reason },
    tradeListings: [trade(0), trade(1), trade(2), trade(3)], recentEvents: [...messages],
  }
}
