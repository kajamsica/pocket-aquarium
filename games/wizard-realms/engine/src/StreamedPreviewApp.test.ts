import { describe, expect, it } from 'vitest'
import { createStreamedWorld, mireglassRouteSites } from './domain'
import {
  MIREGLASS_DEV_SPAWN, PREVIEW_MAP_LEGEND, mireglassVisualTerrainAt, streamedControlIntents, streamedMapTitle, streamedProjection, streamedStartForSearch,
} from './StreamedPreviewApp'
import { visibleTerrainCells } from './view/visibleTerrain'

describe('streamed preview adapter', () => {
  it('limits the atlas to 17 by 17 local cells at origin and across a Mireglass chunk crossing', () => {
    const origin = createStreamedWorld('preview-map')
    const originMap = streamedProjection(origin, origin.state, []).map
    expect(originMap.title).toBe('Streamed terrain local atlas (unsaved preview)')
    expect(originMap.legend).toBe(PREVIEW_MAP_LEGEND)
    expect(originMap.tiles).toHaveLength(17 * 17)
    const originTile = origin.tileAtWorld(0, 0)!
    expect(originMap.player).toEqual({ gridX: originTile.gridX, gridZ: originTile.gridZ, yaw: 0 })
    expect(originMap.tiles.find((tile) => tile.id === origin.state.discoveredTileIds[0])?.discovered).toBe(true)
    expect(originMap.tiles.some((tile) => !tile.discovered && tile.terrain === null && tile.biome === null)).toBe(true)

    const mireglass = createStreamedWorld('preview-map', { x: -320, z: 288 })
    const beforeChunks = mireglass.activeChunkCoordinates()
    const before = streamedProjection(mireglass, mireglass.state, []).map
    expect(before.title).toBe('Mireglass Reach local atlas (unsaved preview)')
    expect(before.tiles).toHaveLength(17 * 17)

    const crossed = mireglass.advance([{ type: 'move', delta: { x: -4, z: 0 } }])
    expect(crossed.rejections).toEqual([])
    expect(mireglass.activeChunkCoordinates()).not.toEqual(beforeChunks)
    const after = streamedProjection(mireglass, crossed.state, []).map
    expect(after.title).toBe(before.title)
    expect(after.tiles).toHaveLength(17 * 17)
    for (const map of [before, after]) {
      expect(new Set(map.tiles.map((tile) => tile.gridX)).size).toBe(17)
      expect(new Set(map.tiles.map((tile) => tile.gridZ)).size).toBe(17)
    }
    expect(after.player.gridX).toBe(before.player.gridX - 1)
    expect(Math.min(...after.tiles.map((tile) => tile.gridX))).toBe(Math.min(...before.tiles.map((tile) => tile.gridX)) - 1)
    expect(mireglass.activeChunkCount()).toBe(9)
  })

  it('labels only positions inside the Mireglass core as Mireglass', () => {
    expect(streamedMapTitle(MIREGLASS_DEV_SPAWN)).toBe('Mireglass Reach local atlas (unsaved preview)')
    expect(streamedMapTitle({ x: 0, z: 0 })).toBe('Streamed terrain local atlas (unsaved preview)')
    expect(streamedMapTitle({ x: -256, z: 288 })).toBe('Streamed terrain local atlas (unsaved preview)')
  })

  it('tags only authored Mireglass terrain and one adjacent wetland rim for bounded visual detail', () => {
    expect(mireglassVisualTerrainAt({ x: -448, z: 256 }, 'loam')).toBe('loam')
    expect(mireglassVisualTerrainAt({ x: -260, z: 508 }, 'rocky')).toBe('rocky')
    for (const point of [{ x: -452, z: 320 }, { x: -256, z: 320 }, { x: -400, z: 512 }]) {
      expect(mireglassVisualTerrainAt(point, 'wetland')).toBe('wetland')
      expect(mireglassVisualTerrainAt(point, 'loam')).toBeUndefined()
    }
    for (const point of [{ x: -456, z: 320 }, { x: -252, z: 320 }, { x: -400, z: 516 }, { x: 0, z: 0 }]) {
      expect(mireglassVisualTerrainAt(point, 'wetland')).toBeUndefined()
    }

    const runtime = createStreamedWorld('preview-map', MIREGLASS_DEV_SPAWN)
    const projection = streamedProjection(runtime, runtime.state, [])
    expect(visibleTerrainCells(projection.terrain, projection.player.position)).toHaveLength(17 * 17)
    for (const cell of projection.terrain) {
      const source = runtime.tileAtWorld(cell.position[0], cell.position[2])!
      expect(cell.mireglassTerrain).toBe(mireglassVisualTerrainAt(source.center, source.terrain))
    }
    expect(projection.terrain.some((cell) => cell.mireglassTerrain === 'wetland')).toBe(true)
    expect(projection.terrain.find((cell) => cell.mireglassTerrain === 'wetland')?.color).toBe('#385b57')
  })

  it('maps W and S to facing-relative movement and A and D to pivot intents', () => {
    const forward = streamedControlIntents(0, [0, 1])
    expect(forward).toHaveLength(1)
    expect(forward[0]).toMatchObject({ type: 'move', delta: { z: -0.16 } })
    if (forward[0]?.type !== 'move') throw new Error('Expected movement intent')
    expect(forward[0].delta.x).toBeCloseTo(0)

    const backward = streamedControlIntents(0, [0, -1])
    expect(backward).toHaveLength(1)
    expect(backward[0]).toMatchObject({ type: 'move', delta: { z: 0.16 } })
    expect(streamedControlIntents(0, [-1, 0])).toEqual([{ type: 'look', yawDelta: 0.13, pitchDelta: 0 }])
    expect(streamedControlIntents(0, [1, 0])).toEqual([{ type: 'look', yawDelta: -0.13, pitchDelta: 0 }])
    expect(streamedControlIntents(0, [0, 0])).toEqual([])
    const turnedForward = streamedControlIntents(-Math.PI / 2, [0, 1])
    expect(turnedForward[0]?.type).toBe('move')
    if (turnedForward[0]?.type !== 'move') throw new Error('Expected movement intent')
    expect(turnedForward[0].delta.x).toBeCloseTo(0.16)
    expect(turnedForward[0].delta.z).toBeCloseTo(0)
  })

  it('enables the Mireglass query spawn only in development', () => {
    expect(streamedStartForSearch('?spawn=mireglass', true)).toEqual(MIREGLASS_DEV_SPAWN)
    expect(streamedStartForSearch('?spawn=mireglass', false)).toBeUndefined()
    for (const [spawn, kind] of [['fen', 'bridge'], ['berm', 'ladder']] as const) {
      const position = streamedStartForSearch(`?spawn=${spawn}`, true)!
      const site = mireglassRouteSites('greenway-alpha').find((candidate) => candidate.kind === kind)!
      expect(position).toEqual({ x: site.from.x, z: site.from.z - 4 })
      expect(createStreamedWorld('greenway-alpha', position).tileAtWorld(position.x, position.z)?.terrain).toBe('loam')
      expect(streamedStartForSearch(`?spawn=${spawn}`, false)).toBeUndefined()
    }
    expect(streamedStartForSearch('?spawn=other', true)).toBeUndefined()
    expect(streamedStartForSearch('?campaign=mireglass', true)).toBeUndefined()
  })
})
