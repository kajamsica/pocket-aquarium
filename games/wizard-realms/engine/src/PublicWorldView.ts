import { objectiveFor, toViewProjection } from './App'
import { mireglassViewProjection } from './MireglassPlayableApp'
import { createActiveWorldTerrain, type ActiveWorldTerrain } from './domain/activeWorldTerrain'
import type { TerrainFacts } from './domain/mireglassCachePitOverlay'
import { resolveFieldCampSite } from './domain/fieldCamp'
import { areaAt, terrainHeightAt } from './domain/generation'
import { MIREGLASS_CONTENT_REVISION, MIREGLASS_RING_ID, mireglassAnchors, mireglassFairyRing } from './domain/mireglassContent'
import { mireglassRouteSites } from './domain/mireglassRouteSites'
import type { MireglassWorldRuntime, MireglassWorldState } from './domain/mireglassWorld'
import type { PublicWorldState } from './domain/publicWorldState'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS, WORLD_CHUNK_MAX, WORLD_CHUNK_MIN,
  WORLD_GRID_MAX, WORLD_GRID_MIN, worldTileAtGrid } from './domain/worldChunks'
import type { PlayerState, WizardWorldState } from './domain/types'
import type { WizardFieldCamp, WizardFieldCampView, WizardItemStack, WizardViewProjection, WizardWorldOverview } from './view/contracts'

const V6_ITEM_NAMES: Readonly<Record<string, string>> = {
  'mireglass_reach/item/seal': 'Mireglass seal',
  'mireglass_reach/item/waders': 'Fen waders',
}

function namedV6Stack(stack: WizardItemStack | null): WizardItemStack | null {
  if (!stack || !V6_ITEM_NAMES[stack.itemId]) return stack
  return {
    ...stack, name: V6_ITEM_NAMES[stack.itemId],
    ...(stack.itemId === 'mireglass_reach/item/waders' ? { equippableSlots: ['feet'] as const } : {}),
  }
}

/** Projection from saved discovery IDs only; undiscovered chunks never sample terrain. */
export function publicWorldOverview(state: PublicWorldState, camps: readonly WizardFieldCamp[] = []): WizardWorldOverview {
  const discovered = new Set(state.discoveredTileIds)
  const chunks = new Map<string, { x: number; z: number; count: number; sampleX: number; sampleZ: number }>()
  const markers = new Map<string, string[]>()
  const chunkKey = (x: number, z: number) => `${x}:${z}`
  const atChunk = (x: number, z: number) => ({
    x: Math.floor(x / (WORLD_CELL_METERS * WORLD_CHUNK_CELLS)),
    z: Math.floor(z / (WORLD_CELL_METERS * WORLD_CHUNK_CELLS)),
  })
  for (const id of discovered) {
    const match = /^tile-(-?\d+)-(-?\d+)$/.exec(id)
    if (!match) continue
    const gx = Number(match[1]) - 3
    const gz = Number(match[2]) - 3
    if (!Number.isSafeInteger(gx) || !Number.isSafeInteger(gz)
      || gx < WORLD_GRID_MIN || gx > WORLD_GRID_MAX || gz < WORLD_GRID_MIN || gz > WORLD_GRID_MAX
      || id !== `tile-${gx + 3}-${gz + 3}`) continue
    const x = Math.floor(gx / WORLD_CHUNK_CELLS)
    const z = Math.floor(gz / WORLD_CHUNK_CELLS)
    const key = chunkKey(x, z)
    const current = chunks.get(key)
    if (current) current.count += 1
    else chunks.set(key, { x, z, count: 1, sampleX: gx, sampleZ: gz })
  }
  const knownTile = (position: { x: number; z: number }) =>
    discovered.has(`tile-${Math.round(position.x / WORLD_CELL_METERS) + 3}-${Math.round(position.z / WORLD_CELL_METERS) + 3}`)
  const mark = (position: { x: number; z: number }, label: string, known = knownTile(position)) => {
    if (!known) return
    const { x, z } = atChunk(position.x, position.z)
    if (x < WORLD_CHUNK_MIN || x > WORLD_CHUNK_MAX || z < WORLD_CHUNK_MIN || z > WORLD_CHUNK_MAX) return
    const key = chunkKey(x, z)
    markers.set(key, [...(markers.get(key) ?? []), label])
  }

  for (const camp of camps) {
    mark({ x: camp.position[0], z: camp.position[2] }, 'Field camp', discovered.has(camp.tileId))
  }
  for (const store of state.greenway.stores) mark(store.position, store.name)
  for (const ring of state.greenway.fairyRings) {
    mark(ring.position, ring.name, state.player.discoveredRingIds.includes(ring.id) && knownTile(ring.position))
  }
  for (const route of state.greenway.routes) {
    if (state.greenway.builtRouteIds.includes(route.id)) mark(route.from, `${route.name} built`)
  }
  if (state.greenway.studiedInscriptionIds.includes('greenway_waystone')) {
    const waystone = state.greenway.inscriptions.find((entry) => entry.id === 'greenway_waystone')
    if (waystone) mark(waystone.position, waystone.name, true)
    const westernX = Math.min(...state.greenway.tiles.map((tile) => tile.center.x))
    mark({ x: westernX, z: 0 }, 'West trail to Mireglass', true)
  }
  const anchors = mireglassAnchors(state.seed)
  mark(anchors.salvager.tile.center, 'Mireglass salvager')
  mark(anchors.bellAlder.tile.center, 'Bell Alder')
  if (state.mireglass.fringeMarkerStudied) mark(anchors.fringeMarker.tile.center, 'Frontier marker', true)
  if (state.mireglass.cacheRevealed) mark(anchors.sealCache.tile.center, 'Revealed seal cache', true)
  const mireglassRing = mireglassFairyRing(state.seed)
  mark(mireglassRing.tile.center, 'Mireglass Ring',
    state.player.discoveredRingIds.includes(MIREGLASS_RING_ID) && knownTile(mireglassRing.tile.center))
  if (state.mireglass.builtRoutes.bridge || state.mireglass.builtRoutes.ladder) {
    const sites = mireglassRouteSites(state.seed)
    for (const site of sites) {
      if (state.mireglass.builtRoutes[site.kind] === site.id) mark(site.from, `${site.kind} built`, true)
    }
  }

  const player = atChunk(state.player.position.x, state.player.position.z)
  const positions = [player, ...chunks.values(), ...[...markers.keys()].map((key) => {
    const [x, z] = key.split(':').map(Number)
    return { x, z }
  })]
  const minX = Math.max(WORLD_CHUNK_MIN, Math.min(...positions.map(({ x }) => x)) - 1)
  const maxX = Math.min(WORLD_CHUNK_MAX, Math.max(...positions.map(({ x }) => x)) + 1)
  const minZ = Math.max(WORLD_CHUNK_MIN, Math.min(...positions.map(({ z }) => z)) - 1)
  const maxZ = Math.min(WORLD_CHUNK_MAX, Math.max(...positions.map(({ z }) => z)) + 1)
  const cells: WizardWorldOverview['cells'][number][] = []
  for (let z = minZ; z <= maxZ; z += 1) for (let x = minX; x <= maxX; x += 1) {
    const key = chunkKey(x, z)
    const visited = chunks.get(key)
    const sample = visited ? worldTileAtGrid(state.seed, visited.sampleX, visited.sampleZ) : null
    cells.push({ id: `chunk-${x}-${z}`, gridX: x, gridZ: z,
      discoveredCells: visited?.count ?? 0, terrain: sample?.terrain ?? null,
      biome: sample?.biome ?? null, markers: markers.get(key) ?? [] })
  }
  return { cells, player: { gridX: player.x, gridZ: player.z, yaw: state.player.yaw } }
}

/** Reassemble a transient read model, never another mutable or persisted player. */
function greenwayView(state: PublicWorldState, messages: readonly string[],
  selectedSiteId: string | null, openStoreId: string | null): WizardViewProjection {
  const world: WizardWorldState = {
    ...state.greenway, seed: state.seed, generationProfile: state.generationProfile,
    tick: state.tick, rng: state.rng, eventSequence: state.eventSequence,
    player: state.player as PlayerState,
    discoveredTileIds: [...state.discoveredTileIds],
  }
  const projection = toViewProjection(world, messages.map((text, id) => ({ id, text })),
    openStoreId, selectedSiteId)
  const trailKnown = state.greenway.studiedInscriptionIds.includes('greenway_waystone')
  const westernX = Math.min(...state.greenway.tiles.map((tile) => tile.center.x))
  const westernTile = trailKnown ? state.greenway.tiles.find((tile) =>
    tile.center.x === westernX && tile.center.z === 0) : undefined
  const objective = objectiveFor(world)
  const map = { ...projection.map,
    title: areaAt(state.greenway.areas, state.player.position.x, state.player.position.z).name,
    ...(westernTile ? {
      tiles: projection.map.tiles.map((tile) => ({ ...tile,
        hasWestTrail: tile.id === westernTile.id })),
      legend: '▲ you · ⇦ west trail to Mireglass · W waystone · ✦ revealed cache · ◇ route build site · ✓ completed route · S store · R fairy ring · • resource · ? unexplored',
      guidance: objective.startsWith('Quest complete:')
        ? `West to Mireglass: follow the marked dry gap near z≈0, about ${Math.round(Math.hypot(
          state.player.position.x - westernTile.center.x, state.player.position.z))} m from here.`
        : `Next: ${objective}`,
    } : {}),
  }
  const tradeListing = (index: 0 | 1 | 2 | 3) => {
    const listing = projection.tradeListings[index]
    return listing ? { ...listing,
      itemName: V6_ITEM_NAMES[state.player.tradeSlots[index].itemId ?? ''] ?? listing.itemName } : null
  }
  return {
    ...projection,
    map,
    fairyRings: projection.fairyRings.map((ring) => ring.id === 'ring-greenway'
      && state.player.discoveredRingIds.includes(MIREGLASS_RING_ID)
      ? { ...ring, destinations: [...ring.destinations,
        { ringId: MIREGLASS_RING_ID, label: 'Mireglass Ring', discovered: true }] }
      : ring),
    ...(westernTile ? {
      landmarks: [{ id: 'greenway/landmark/west_trail_gate' as const,
        kind: 'west-trail-gate' as const,
        position: [westernTile.center.x + 1.5,
          terrainHeightAt(state.greenway.tiles, westernTile.center.x + 1.5, 0), 0] as const }],
    } : {}),
    backpack: { ...projection.backpack, stacks: projection.backpack.stacks.map((stack) => namedV6Stack(stack)!) },
    equipment: {
      head: namedV6Stack(projection.equipment.head), chest: namedV6Stack(projection.equipment.chest),
      legs: namedV6Stack(projection.equipment.legs), feet: namedV6Stack(projection.equipment.feet),
      mainHand: namedV6Stack(projection.equipment.mainHand), offHand: namedV6Stack(projection.equipment.offHand),
    },
    tradeListings: [tradeListing(0), tradeListing(1), tradeListing(2), tradeListing(3)],
  }
}

// Presentation owns one bounded tile window. The mutable campaign runtime remains the sole authority.
let mireglassTerrainReader: { seed: string; cachePitDug: boolean; terrain: ActiveWorldTerrain; campSites: Map<string, boolean> } | null = null

function campSiteSuitable(seed: string, tileId: string): boolean {
  const cache = mireglassTerrainReader?.seed === seed ? mireglassTerrainReader.campSites : null
  if (!cache) return false
  const cached = cache.get(tileId)
  if (cached !== undefined) return cached
  const suitable = resolveFieldCampSite(seed, tileId) !== null
  cache.set(tileId, suitable)
  return suitable
}

/** Only the tile-read methods are supplied to the existing Mireglass projection. */
function mireglassView(state: PublicWorldState, messages: readonly string[],
  selectedSiteId: string | null, terrainFacts?: TerrainFacts): WizardViewProjection {
  const cachePitDug = terrainFacts?.cachePitDug === true
  if (mireglassTerrainReader?.seed !== state.seed || mireglassTerrainReader.cachePitDug !== cachePitDug) {
    mireglassTerrainReader = { seed: state.seed, cachePitDug,
      terrain: createActiveWorldTerrain(state.seed, terrainFacts), campSites: new Map() }
  }
  const terrain = mireglassTerrainReader.terrain
  terrain.activate(state.player.position)
  const tileReader = {
    activeTiles: () => terrain.activeTiles(),
    tileAtWorld: (x: number, z: number) => terrain.tileAtWorld(x, z),
  }
  const world: MireglassWorldState = {
    seed: state.seed, contentRevision: MIREGLASS_CONTENT_REVISION, tick: state.tick,
    player: state.player, discoveredTileIds: state.discoveredTileIds, expedition: state.mireglass,
  }
  // mireglassViewProjection reads exactly these two tile methods; it never calls advance or act.
  return mireglassViewProjection(tileReader as MireglassWorldRuntime, world, messages, selectedSiteId)
}

/** One public player and facts projected through the existing region-specific view adapters. */
export function publicWorldViewProjection(state: PublicWorldState, messages: readonly string[],
  selectedSiteId: string | null, openStoreId: string | null = null,
  fieldCamp?: WizardFieldCampView, terrainFacts?: TerrainFacts): WizardViewProjection {
  const projection = state.movementOwner === 'greenway'
    ? greenwayView(state, messages, selectedSiteId, openStoreId)
    : mireglassView(state, messages, selectedSiteId, terrainFacts)
  let overview: WizardWorldOverview | undefined
  const campTileIds = new Set(fieldCamp?.camps.map((camp) => camp.tileId))
  return { ...projection, ...(fieldCamp ? { fieldCamp } : {}), map: { ...projection.map,
    ...(fieldCamp ? { tiles: projection.map.tiles.map((tile) => ({ ...tile,
      hasCamp: tile.discovered && campTileIds.has(tile.id),
      ...(fieldCamp.selectionEnabled && state.movementOwner === 'streamed' && tile.discovered
        ? { campSuitable: campSiteSuitable(state.seed, tile.id) } : {}) })) } : {}),
    overview: () => overview ??= publicWorldOverview(state, fieldCamp?.camps) } }
}
