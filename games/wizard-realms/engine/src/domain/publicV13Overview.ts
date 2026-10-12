import { discoveryMaskHasTileId, isValidDiscoveryMask } from './discoveryMask'
import { resolveFieldCampSite } from './fieldCamp'
import { highlandLandmark } from './highlandContent'
import { MIREGLASS_RING_ID, mireglassAnchors, mireglassFairyRing } from './mireglassContent'
import { mireglassRouteSites } from './mireglassRouteSites'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import { resolveTerrainWorkSite } from './terrainWorks'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS, WORLD_CHUNK_MAX, WORLD_CHUNK_MIN,
  WORLD_GRID_MIN, worldTileAtGrid } from './worldChunks'
import type { WizardWorldOverview } from '../view/contracts'

const CHUNKS = WORLD_CHUNK_MAX - WORLD_CHUNK_MIN + 1
const GRID_ROW_BYTES = CHUNKS * WORLD_CHUNK_CELLS / 8
const CHUNK_METERS = WORLD_CELL_METERS * WORLD_CHUNK_CELLS
const chunkIndex = (x: number, z: number) => (z - WORLD_CHUNK_MIN) * CHUNKS + x - WORLD_CHUNK_MIN

/** On-demand overview: 32 KiB of bits become at most 1024 chunk summaries, never tile-ID history. */
export function publicV13Overview(state: PublicV13Head['state']): WizardWorldOverview {
  const mask = state.discoveryMask
  if (!isValidDiscoveryMask(mask)) throw new RangeError('Invalid compact discovery mask.')
  const counts = new Uint16Array(CHUNKS * CHUNKS)
  const sampleX = new Int16Array(counts.length), sampleZ = new Int16Array(counts.length)
  const player = { gridX: Math.floor(state.player.position.x / CHUNK_METERS),
    gridZ: Math.floor(state.player.position.z / CHUNK_METERS), yaw: state.player.yaw }
  let minX = player.gridX, maxX = player.gridX, minZ = player.gridZ, maxZ = player.gridZ
  const include = (x: number, z: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
  }
  for (let index = 0; index < mask.length; index += 1) {
    const byte = mask[index]
    if (!byte) continue
    const row = Math.floor(index / GRID_ROW_BYTES), column = index % GRID_ROW_BYTES
    const x = WORLD_CHUNK_MIN + Math.floor(column / 2)
    const z = WORLD_CHUNK_MIN + Math.floor(row / WORLD_CHUNK_CELLS)
    const chunk = chunkIndex(x, z)
    if (counts[chunk] === 0) {
      sampleX[chunk] = WORLD_GRID_MIN + column * 8 + Math.log2(byte & -byte)
      sampleZ[chunk] = WORLD_GRID_MIN + row
      include(x, z)
    }
    const pairs = byte - ((byte >> 1) & 0x55)
    const quads = (pairs & 0x33) + ((pairs >> 2) & 0x33)
    counts[chunk] += (quads + (quads >> 4)) & 0x0f
  }

  const markers = new Map<number, string[]>()
  const knownAt = (position: { x: number; z: number }) => discoveryMaskHasTileId(mask,
    `tile-${Math.round(position.x / WORLD_CELL_METERS) + 3}-${Math.round(position.z / WORLD_CELL_METERS) + 3}`)
  const mark = (position: { x: number; z: number }, label: string, saved = false) => {
    if (!saved && !knownAt(position)) return
    const x = Math.floor(position.x / CHUNK_METERS), z = Math.floor(position.z / CHUNK_METERS)
    if (x < WORLD_CHUNK_MIN || x > WORLD_CHUNK_MAX || z < WORLD_CHUNK_MIN || z > WORLD_CHUNK_MAX) return
    const chunk = chunkIndex(x, z)
    markers.set(chunk, [...(markers.get(chunk) ?? []), label])
    include(x, z)
  }
  for (const store of state.greenway.stores) mark(store.position, store.name)
  for (const ring of state.greenway.fairyRings) {
    if (state.player.discoveredRingIds.includes(ring.id) && knownAt(ring.position)) {
      mark(ring.position, ring.name)
    }
  }
  const mireglassRing = mireglassFairyRing(state.seed)
  if (state.player.discoveredRingIds.includes(MIREGLASS_RING_ID)) {
    mark(mireglassRing.tile.center, 'Mireglass Ring')
  }
  for (const route of state.greenway.routes) {
    if (state.greenway.builtRouteIds.includes(route.id)) {
      mark(route.from, route.id === 'greenway_ladder' ? 'Greenway low steps built'
        : 'Highland bridge built', true)
    }
  }
  if (state.greenway.studiedInscriptionIds.includes('greenway_waystone')) {
    const waystone = state.greenway.inscriptions.find((entry) => entry.id === 'greenway_waystone')
    if (waystone) mark(waystone.position, waystone.name, true)
    const westernX = Math.min(...state.greenway.tiles.map((tile) => tile.center.x))
    mark({ x: westernX, z: 0 }, 'West trail to Mireglass', true)
  }
  for (const id of state.fieldCampTileIds) {
    const camp = resolveFieldCampSite(state.seed, id)
    if (camp) mark(camp.tile.center, 'Field camp', true)
  }
  const anchors = mireglassAnchors(state.seed)
  mark(anchors.salvager.tile.center, 'Mireglass salvager')
  mark(anchors.bellAlder.tile.center, 'Bell Alder')
  if (state.mireglass.fringeMarkerStudied) mark(anchors.fringeMarker.tile.center, 'Frontier marker', true)
  if (state.mireglass.cacheRevealed) mark(anchors.sealCache.tile.center, 'Revealed seal cache', true)
  for (const route of mireglassRouteSites(state.seed)) {
    if (state.mireglass.builtRoutes[route.kind] === route.id) {
      mark(route.from, `${route.kind} built`, true)
    }
  }
  for (const id of [...state.terrainWorks.builtWorkIds, ...state.terrainWorks.dugTileIds]) {
    const work = resolveTerrainWorkSite(state.seed, id)
    if (work) mark(work.kind === 'dig' ? work.center : work.from,
      work.kind === 'bridge' ? 'Fen bridge built'
        : work.kind === 'ladder' ? 'Slate ladder built' : 'Loam dug', true)
  }
  if (state.highland.landmarkDiscovered) mark(highlandLandmark(state.seed).tile.center,
    'Quarry Crown', true)

  const cells: WizardWorldOverview['cells'][number][] = []
  for (let z = Math.max(WORLD_CHUNK_MIN, minZ - 4); z <= Math.min(WORLD_CHUNK_MAX, maxZ + 4); z += 1) {
    for (let x = Math.max(WORLD_CHUNK_MIN, minX - 4); x <= Math.min(WORLD_CHUNK_MAX, maxX + 4); x += 1) {
      const chunk = chunkIndex(x, z)
      const sample = counts[chunk] ? worldTileAtGrid(state.seed, sampleX[chunk], sampleZ[chunk]) : null
      cells.push({ id: `chunk-${x}-${z}`, gridX: x, gridZ: z,
        discoveredCells: counts[chunk], terrain: sample?.terrain ?? null, biome: sample?.biome ?? null,
        markers: markers.get(chunk) ?? [] })
    }
  }
  return { cells, player }
}
