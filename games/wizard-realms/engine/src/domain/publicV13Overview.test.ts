import { describe, expect, it, vi } from 'vitest'
import * as maskCodec from './discoveryMask'
import { DISCOVERY_MASK_BYTES, encodeDiscoveredTileIds } from './discoveryMask'
import { resolveFieldCampSite } from './fieldCamp'
import { MIREGLASS_RING_ID, mireglassAnchors, mireglassFairyRing } from './mireglassContent'
import { mireglassRouteSites } from './mireglassRouteSites'
import { publicV13Overview } from './publicV13Overview'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import { createFreshPublicWorld } from './publicWorldState'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { withPublicV11Highland } from './publicWorldV11State'
import { withPublicV12Windstep } from './publicWorldV12State'
import { emptyTerrainWorkLedger } from './terrainWorkLedger'
import { WORLD_GRID_MAX, WORLD_GRID_MIN, worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const base = withPublicV12Windstep(withPublicV11Highland(withPublicV10TerrainRevision(
  withFreshPublicV9Camps(withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))))))
const tileIdAt = (x: number, z: number) => worldTileAtGrid(seed, Math.round(x / 4), Math.round(z / 4)).id
const compact = (ids: readonly string[]): PublicV13Head['state'] => {
  const { discoveredTileIds: _old, ...source } = base
  return { ...source, discoveryMask: encodeDiscoveredTileIds([...new Set(ids)].sort()),
    terrainWorks: emptyTerrainWorkLedger() }
}
const labels = (state: PublicV13Head['state']) => publicV13Overview(state).cells
  .flatMap((cell) => cell.markers)

describe('lazy compact v13 world overview', () => {
  it('counts every dense mask bit in at most 1024 summaries without a full tile-ID decoder', () => {
    const state = { ...compact([]), discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(255) }
    const before = new Uint8Array(state.discoveryMask)
    const decode = vi.spyOn(maskCodec, 'decodeDiscoveredTileIds').mockImplementation(() => {
      throw new Error('A whole-mask tile-ID decode is forbidden.')
    })
    try {
      const overview = publicV13Overview(state)
      expect(overview.cells).toHaveLength(32 * 32)
      expect(overview.cells.every((cell) => cell.discoveredCells === 256)).toBe(true)
      expect(overview.cells.reduce((sum, cell) => sum + cell.discoveredCells, 0)).toBe(262_144)
      expect(overview.cells[0]).toMatchObject({ id: 'chunk--16--16', gridX: -16, gridZ: -16,
        terrain: worldTileAtGrid(seed, WORLD_GRID_MIN, WORLD_GRID_MIN).terrain })
      expect(overview.cells.at(-1)).toMatchObject({ id: 'chunk-15-15', gridX: 15, gridZ: 15 })
      expect(decode).not.toHaveBeenCalled()
      expect(state.discoveryMask).toEqual(before)
    } finally { decode.mockRestore() }
  })

  it('retains far discovered chunks after the player leaves, including sparse samples', () => {
    const west = worldTileAtGrid(seed, WORLD_GRID_MIN, WORLD_GRID_MIN)
    const east = worldTileAtGrid(seed, WORLD_GRID_MAX, WORLD_GRID_MAX)
    const home = worldTileAtGrid(seed, 0, 0)
    const state = compact([west.id, east.id, home.id])
    const before = structuredClone(state)
    const overview = publicV13Overview(state)
    expect(overview.cells).toHaveLength(1024)
    expect(overview.cells.reduce((sum, cell) => sum + cell.discoveredCells, 0)).toBe(3)
    expect(overview.cells.find((cell) => cell.id === 'chunk--16--16')).toMatchObject({
      discoveredCells: 1, terrain: west.terrain, biome: west.biome })
    expect(overview.cells.find((cell) => cell.id === 'chunk-15-15')).toMatchObject({
      discoveredCells: 1, terrain: east.terrain, biome: east.biome })
    expect(overview.player).toEqual({ gridX: 0, gridZ: 0, yaw: state.player.yaw })
    expect(state).toEqual(before)
  })

  it('hides unknown stores and rings, then marks only saved and mask-known places', () => {
    const store = base.greenway.stores[0]
    const ring = base.greenway.fairyRings.find((candidate) => candidate.id === 'ring-greenway')!
    const empty = compact([])
    expect(labels(empty)).not.toContain(store.name)
    expect(labels(empty)).not.toContain(ring.name)
    const discovered = { ...compact([tileIdAt(store.position.x, store.position.z),
      tileIdAt(ring.position.x, ring.position.z)]),
    player: { ...empty.player, discoveredRingIds: [...empty.player.discoveredRingIds, ring.id] } }
    expect(labels(discovered)).toContain(store.name)
    expect(labels(discovered)).toContain(ring.name)
    const ringUnknown = { ...discovered,
      player: { ...discovered.player, discoveredRingIds: [] } }
    expect(labels(ringUnknown)).not.toContain(ring.name)
    expect(labels(discovered)).not.toContain('Bell Alder')
    const bell = mireglassAnchors(seed).bellAlder.tile
    expect(labels({ ...discovered, discoveryMask: encodeDiscoveredTileIds(
      [bell.id, tileIdAt(store.position.x, store.position.z),
        tileIdAt(ring.position.x, ring.position.z)].sort()) })).toContain('Bell Alder')
  })

  it('marks player-built camp and canonical work from saved IDs without revealing other terrain', () => {
    const camp = resolveFieldCampSite(seed, worldTileAtGrid(seed, -76, 100).id)!
    const workBridgeId = 'works1:bridge:-102:92:z'
    const workDigId = 'tile--64-76'
    const state: PublicV13Head['state'] = { ...compact([]),
      fieldCampTileIds: [camp.tileId],
      terrainWorks: { builtWorkIds: [workBridgeId], dugTileIds: [workDigId] } }
    const overview = publicV13Overview(state)
    const markers = overview.cells.flatMap((cell) => cell.markers)
    expect(markers).toContain('Field camp')
    expect(markers).toContain('Fen bridge built')
    expect(markers).toContain('Loam dug')
    expect(overview.cells.reduce((sum, cell) => sum + cell.discoveredCells, 0)).toBe(0)
    expect(overview.cells.filter((cell) => cell.discoveredCells === 0)
      .every((cell) => cell.terrain === null && cell.biome === null)).toBe(true)
  })

  it('uses saved route knowledge but still requires the ring mask bit', () => {
    const bridge = mireglassRouteSites(seed).find((route) => route.kind === 'bridge')!
    const unknownRing: PublicV13Head['state'] = { ...compact([]),
      player: { ...base.player, discoveredRingIds: [...base.player.discoveredRingIds,
        MIREGLASS_RING_ID] },
      greenway: { ...base.greenway, builtRouteIds: ['greenway_ladder'] },
      mireglass: { ...base.mireglass,
        builtRoutes: { ...base.mireglass.builtRoutes, bridge: bridge.id } } }
    expect(labels(unknownRing)).toContain('Greenway low steps built')
    expect(labels(unknownRing)).toContain('bridge built')
    expect(labels(unknownRing)).not.toContain('Mireglass Ring')
    const ring = mireglassFairyRing(seed).tile
    expect(labels({ ...unknownRing, discoveryMask: encodeDiscoveredTileIds([ring.id]) }))
      .toContain('Mireglass Ring')
  })

  it('keeps the studied waystone and West trail as knowledge, not terrain revelation', () => {
    const empty = compact([])
    const waystone = base.greenway.inscriptions.find((entry) => entry.id === 'greenway_waystone')!
    expect(labels(empty)).not.toContain(waystone.name)
    expect(labels(empty)).not.toContain('West trail to Mireglass')
    const studied: PublicV13Head['state'] = { ...empty,
      greenway: { ...empty.greenway, studiedInscriptionIds: ['greenway_waystone'] } }
    const overview = publicV13Overview(studied)
    expect(overview.cells.flatMap((cell) => cell.markers)).toEqual(expect.arrayContaining([
      waystone.name, 'West trail to Mireglass',
    ]))
    expect(overview.cells.reduce((sum, cell) => sum + cell.discoveredCells, 0)).toBe(0)
  })
})
