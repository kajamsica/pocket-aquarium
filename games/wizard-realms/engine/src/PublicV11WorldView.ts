import { HIGHLAND_CORE, HIGHLAND_LANDMARK, classifyStreamedRegion, highlandCorridorCells,
  highlandLandmark, highlandStoneNodes } from './domain/highlandContent'
import type { PublicWorldV11State } from './domain/publicWorldV11State'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from './domain/worldChunks'
import { publicWorldViewProjection } from './PublicWorldView'
import type { WizardFieldCampView, WizardMapTile, WizardTerrainCell, WizardViewProjection,
  WizardWorldOverview } from './view/contracts'

type Point = Readonly<{ x: number; z: number }>
const key = (point: Point) => `${point.x}:${point.z}`
const route = highlandCorridorCells()
const routeIndex = new Map(route.map((point, index) => [key(point), index]))
const trailSegments = new Map<string, { from: readonly [number, number]; to: readonly [number, number] }>()
const lateHighlandCells = new Set<string>()
const midpoint = (a: Point, b: Point): readonly [number, number] => [(a.x + b.x) / 2, (a.z + b.z) / 2]
for (const [index, point] of route.entries()) {
  trailSegments.set(key(point), {
    from: index === 0 ? [point.x, point.z] : midpoint(route[index - 1], point),
    to: index === route.length - 1 ? [point.x, point.z] : midpoint(point, route[index + 1]),
  })
  if (point.x < 384) continue
  for (let dx = -8; dx <= 8; dx += WORLD_CELL_METERS) for (let dz = -8; dz <= 8; dz += WORLD_CELL_METERS) {
    if (dx * dx + dz * dz <= 64) lateHighlandCells.add(key({ x: point.x + dx, z: point.z + dz }))
  }
}

const inCore = ({ x, z }: Point) => x >= HIGHLAND_CORE.minX && x <= HIGHLAND_CORE.maxX
  && z >= HIGHLAND_CORE.minZ && z <= HIGHLAND_CORE.maxZ
const isAuthoredHighlandCell = (point: Point) => inCore(point) || lateHighlandCells.has(key(point))
const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
const bearing = (from: Point, to: Point) => compass[(Math.round(Math.atan2(to.x - from.x, from.z - to.z)
  / (Math.PI / 4)) + 8) % 8]
const distance2 = (from: Point, to: Point) => Math.hypot(from.x - to.x, from.z - to.z)
const distance3 = (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) =>
  Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z)
const quantity = (state: PublicWorldV11State, itemId: string) => state.player.inventory
  .filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.quantity, 0)
const packUsed = (state: PublicWorldV11State) => state.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)
  + state.player.tradeSlots.reduce((sum, slot) => sum + slot.quantity, 0)

const terrainCache = new WeakMap<readonly WizardTerrainCell[], { seed: string; dressed: readonly WizardTerrainCell[] }>()

/** V11 scenery tracks the pinned dry path and quarry, without changing collision or tile authority. */
export function highlandTerrainFor(cells: readonly WizardTerrainCell[], seed: string): readonly WizardTerrainCell[] {
  const cached = terrainCache.get(cells)
  if (cached?.seed === seed) return cached.dressed
  const dressed = cells.map((cell) => {
    const point = { x: cell.position[0], z: cell.position[2] }
    const segment = trailSegments.get(key(point))
    const surface: WizardTerrainCell['highlandSurface'] = isAuthoredHighlandCell(point)
      ? 'quarry' : segment ? 'trail' : undefined
    return surface || segment ? { ...cell,
      ...(surface ? { highlandSurface: surface } : {}),
      ...(segment ? { highlandTrailSegment: segment } : {}),
    } : cell
  })
  terrainCache.set(cells, { seed, dressed })
  return dressed
}

/** A tile is known only after the same saved discovery mask used by the base map. */
export function highlandMapTiles(tiles: readonly WizardMapTile[], state: PublicWorldV11State): readonly WizardMapTile[] {
  const landmarkId = highlandLandmark(state.seed).tile.id
  const nodes = new Map(highlandStoneNodes(state.seed).map((node) => [node.tile.id, node.id]))
  const readiness = new Map(state.highland.stoneNodes.map(({ id, readyAtTick }) => [id, state.tick >= readyAtTick]))
  return tiles.map((tile) => {
    if (!tile.discovered) return tile
    const point = { x: (tile.gridX - 3) * WORLD_CELL_METERS,
      z: (tile.gridZ - 3) * WORLD_CELL_METERS }
    const nodeId = nodes.get(tile.id)
    return { ...tile,
      ...(routeIndex.has(key(point)) ? { hasHighlandTrail: true } : {}),
      ...(tile.id === landmarkId ? { hasHighlandLandmark: true } : {}),
      ...(nodeId ? { hasHighlandNode: true, highlandNodeReady: readiness.get(nodeId) === true } : {}),
    }
  })
}

function nextRoutePoint(position: Point, returning: boolean): Point {
  let nearest = 0
  let nearestDistance = Infinity
  for (const [index, point] of route.entries()) {
    const distance = distance2(position, point)
    if (distance < nearestDistance) { nearestDistance = distance; nearest = index }
  }
  return route[Math.max(0, Math.min(route.length - 1, nearest + (returning ? -12 : 12)))]
}

function highlandGuidance(state: PublicWorldV11State, region: 'highland_quarry' | 'wilderness'): string {
  const from = state.player.position
  const carryingStone = quantity(state, 'stone') > 0 && state.highland.landmarkDiscovered
  const routePoint = nextRoutePoint(from, carryingStone)
  if (carryingStone) return `Return west along the pale quarry path (${bearing(from, routePoint)}, about ${Math.round(distance2(from, routePoint))} m to the next bend). Greenway Outfitters buys stone.`
  if (region === 'wilderness') {
    if (from.x < 8) return 'Uncharted wilderness. Return to a discovered trail or Greenway; no Mireglass objective is pinned here.'
    return `Follow the walked pale-stone path toward the highland (${bearing(from, routePoint)}, about ${Math.round(distance2(from, routePoint))} m to the next bend). Undiscovered ground stays hidden.`
  }
  const landmark = HIGHLAND_LANDMARK
  if (!state.highland.landmarkDiscovered) return `The wind-carved Quarry Crown lies ${bearing(from, landmark)}, about ${Math.round(distance2(from, landmark))} m away. Approach it on foot.`
  const ready = highlandStoneNodes(state.seed).filter((node) => state.highland.stoneNodes
    .some((entry) => entry.id === node.id && state.tick >= entry.readyAtTick))
  if (!ready.length) {
    const nextTick = Math.min(...state.highland.stoneNodes.map(({ readyAtTick }) => readyAtTick))
    return `All stone shelves are recovering (about ${Math.ceil((nextTick - state.tick) / 20)} s). Return west to trade or wait.`
  }
  const knownReady = ready.filter((node) => state.discoveredTileIds.includes(node.tile.id))
  if (!knownReady.length) return 'Survey the exposed rock east of Quarry Crown. Stone shelves appear on the map only after you walk to them.'
  const closest = knownReady.reduce((best, candidate) => distance2(from, candidate.tile.center)
    < distance2(from, best.tile.center) ? candidate : best)
  return `Search the exposed stone shelf ${bearing(from, closest.tile.center)}, about ${Math.round(distance2(from, closest.tile.center))} m away. Equip a field spade; Excavation Lv2 required.`
}

export function highlandExtractionFor(state: PublicWorldV11State) {
  const discovered = new Set(state.discoveredTileIds)
  const node = highlandStoneNodes(state.seed)
    .filter((candidate) => distance3(state.player.position, candidate.tile.center) <= 3)
    .sort((left, right) => distance3(state.player.position, left.tile.center)
      - distance3(state.player.position, right.tile.center) || left.id.localeCompare(right.id))[0]
  if (!node) return undefined
  const readyAtTick = state.highland.stoneNodes.find((entry) => entry.id === node.id)?.readyAtTick
  let reason = 'Ready: +2 stone and 20 Excavation XP'
  if (!state.highland.landmarkDiscovered) reason = 'Approach and discover Quarry Crown first'
  else if (!discovered.has(node.tile.id)) reason = 'Walk the outcrop to chart its tile'
  else if (quantity(state, 'field_spade') < 1) reason = 'A field spade is required'
  else if (state.player.equipment.mainHand !== 'field_spade') reason = 'Equip your field spade'
  else if (state.player.skillXp.excavation < 30) reason = 'Excavation Lv2 required'
  else if (packUsed(state) + 2 > state.player.backpackCapacity) reason = 'Make room for 2 stone'
  else if (readyAtTick === undefined || state.tick < readyAtTick)
    reason = `Regrowing (about ${Math.ceil(((readyAtTick ?? state.tick) - state.tick) / 20)} s)`
  return { nodeId: node.id, label: 'Highland stone outcrop', actionable: reason.startsWith('Ready:'), reason }
}

function highlandOverview(state: PublicWorldV11State, overview: WizardWorldOverview): WizardWorldOverview {
  const known = new Set(state.discoveredTileIds)
  const markers = new Map<string, string[]>()
  const add = (tileId: string, x: number, z: number, label: string) => {
    if (!known.has(tileId)) return
    const chunk = `${Math.floor(x / (WORLD_CELL_METERS * WORLD_CHUNK_CELLS))}:${Math.floor(z / (WORLD_CELL_METERS * WORLD_CHUNK_CELLS))}`
    markers.set(chunk, [...(markers.get(chunk) ?? []), label])
  }
  const landmark = highlandLandmark(state.seed)
  if (state.highland.landmarkDiscovered) add(landmark.tile.id, landmark.tile.center.x,
    landmark.tile.center.z, 'Quarry Crown')
  for (const node of highlandStoneNodes(state.seed)) {
    const entry = state.highland.stoneNodes.find(({ id }) => id === node.id)
    add(node.tile.id, node.tile.center.x, node.tile.center.z,
      entry && state.tick < entry.readyAtTick ? 'Stone shelf recovering' : 'Stone shelf')
  }
  return { ...overview, cells: overview.cells.map((cell) => ({ ...cell,
    markers: [...cell.markers, ...(markers.get(`${cell.gridX}:${cell.gridZ}`) ?? [])] })) }
}

/** V11-only read model. Older public versions continue using their original projection unchanged. */
export function publicWorldV11ViewProjection(state: PublicWorldV11State, messages: readonly string[],
  selectedSiteId: string | null, openStoreId: string | null = null,
  fieldCamp?: WizardFieldCampView): WizardViewProjection {
  const base = publicWorldViewProjection(state, messages, selectedSiteId, openStoreId,
    fieldCamp, { cachePitDug: state.mireglass.cacheExcavated })
  const overview = base.map.overview
  let highlandOverviewCache: WizardWorldOverview | undefined
  const withOverview = (projection: WizardViewProjection): WizardViewProjection => ({ ...projection,
    map: { ...projection.map, ...(overview ? { overview: () =>
      highlandOverviewCache ??= highlandOverview(state, overview()) } : {}) } })
  if (state.movementOwner === 'greenway') {
    if (!base.map.guidance?.startsWith('West to Mireglass:')) return withOverview(base)
    const east = state.greenway.tiles.filter((tile) => tile.center.z === 0)
      .sort((a, b) => b.center.x - a.center.x)[0]
    if (!east) return withOverview(base)
    return withOverview({ ...base, map: { ...base.map,
      title: base.map.title,
      legend: `${base.map.legend ?? '▲ you · ? unexplored'} · ⇨ east trail toward Highland Quarry`,
      guidance: quantity(state, 'stone') > 0 && state.highland.landmarkDiscovered
        ? 'Sell quarry stone at Greenway Outfitters, or carry it to another known buyer.'
        : `A second frontier begins at the eastern Greenway path, ${bearing(state.player.position, east.center)} about ${Math.round(distance2(state.player.position, east.center))} m from here. Mireglass remains west.`,
      tiles: base.map.tiles.map((tile) => tile.discovered && tile.id === east.id
        ? { ...tile, hasEastTrail: true } : tile),
    } })
  }
  const region = classifyStreamedRegion(state.seed, state.player.position)
  if (region === 'mireglass_reach') return withOverview(base)
  const active = new Set(base.terrain.map((cell) => cell.id))
  const landmark = highlandLandmark(state.seed)
  const nodeStates = new Map(state.highland.stoneNodes.map((node) => [node.id, node.readyAtTick]))
  const extraction = region === 'highland_quarry' ? highlandExtractionFor(state) : undefined
  const quarryNodes = region === 'highland_quarry' ? highlandStoneNodes(state.seed)
    .filter((node) => active.has(node.tile.id)).map((node) => ({
      id: node.id, kind: 'ore' as const, visualKind: 'highland-stone' as const,
      label: 'Highland stone outcrop',
      position: [node.tile.center.x, node.tile.center.y, node.tile.center.z] as const,
      available: state.tick >= (nodeStates.get(node.id) ?? Infinity),
    })) : []
  return withOverview({ ...base,
    terrain: highlandTerrainFor(base.terrain, state.seed),
    resources: quarryNodes,
    stores: [], fairyRings: [], routes: [], buildSites: [], selectedBuildSiteId: null,
    landmarks: region === 'highland_quarry' && active.has(landmark.tile.id)
      ? [{ id: HIGHLAND_LANDMARK.id, kind: 'quarry-crown',
        position: [landmark.tile.center.x, landmark.tile.center.y, landmark.tile.center.z],
        discovered: state.highland.landmarkDiscovered }] : [],
    nearbyStoreId: null, openStoreId: null,
    nearbyInteraction: extraction ? { kind: 'resource', targetId: extraction.nodeId,
      label: extraction.label, action: extraction.actionable ? 'Extract' : extraction.reason,
      actionable: extraction.actionable } : null,
    ...(extraction ? { highlandExtraction: extraction } : {}),
    ...(region === 'highland_quarry' ? { ambience: 'highland-wind' as const } : {}),
    map: { ...base.map,
      title: region === 'highland_quarry' ? 'Highland Quarry' : 'Uncharted wilderness',
      guidance: highlandGuidance(state, region),
      legend: '▲ you · · walked quarry path · Q Quarry Crown · ◆ ready stone · ◌ recovering stone · C field camp · ? unexplored',
      tiles: highlandMapTiles(base.map.tiles, state),
    },
  })
}
