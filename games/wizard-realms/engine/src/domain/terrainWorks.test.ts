import { describe, expect, it } from 'vitest'
import { mireglassAnchors } from './mireglassContent'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { mireglassRouteSites } from './mireglassRouteSites'
import { MIREGLASS_CORE } from './mireglassTerrain'
import { enumerateTerrainWorkSites, parseTerrainWorkId, resolveTerrainWorkSite } from './terrainWorks'
import { worldTileAtGrid } from './worldChunks'

const seeds = ['greenway-alpha', 'mireglass-corpus-0', 'mireglass-corpus-1', 'mireglass-corpus-7']
const bridgeWindow = { minGX: -110, maxGX: -95, minGZ: 88, maxGZ: 94 }
const ladderWindow = { minGX: -110, maxGX: -95, minGZ: 104, maxGZ: 111 }
const geometryKey = (kind: string, from: { x: number; z: number }, to: { x: number; z: number }) =>
  `${kind}:${from.x}:${from.z}:${to.x}:${to.z}`
const walkable = (seed: string, start: { x: number; z: number }, goal: { x: number; z: number }) => {
  const queue = [start], seen = new Set([`${start.x}:${start.z}`])
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i]
    if (from.x === goal.x && from.z === goal.z) return true
    for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
      const to = { x: from.x + dx, z: from.z + dz }, key = `${to.x}:${to.z}`
      if (seen.has(key) || to.x < MIREGLASS_CORE.minX || to.x > MIREGLASS_CORE.maxX
        || to.z < MIREGLASS_CORE.minZ || to.z > MIREGLASS_CORE.maxZ
        || mireglassMoveBarrier(seed, from, to) || mireglassMoveBarrier(seed, to, from)) continue
      seen.add(key); queue.push(to)
    }
  }
  return false
}

describe('Mireglass terrain work geometry', () => {
  it('parses only canonical, bounded-grid IDs', () => {
    expect(parseTerrainWorkId('works1:bridge:-102:92:z'))
      .toEqual({ kind: 'bridge', gx: -102, gz: 92, axis: 'z' })
    expect(parseTerrainWorkId('works1:ladder:-103:108:W'))
      .toEqual({ kind: 'ladder', gx: -103, gz: 108, direction: 'W' })
    expect(parseTerrainWorkId('tile--64-76')).toEqual({ kind: 'dig', gx: -67, gz: 73 })
    for (const id of ['works1:bridge:-0102:92:z', 'works1:bridge:-0:92:z',
      'works1:bridge:-102:92:y', 'works1:ladder:-103:108:NE', 'tile--064-76',
      'tile-9007199254740993-76', 'works1:bridge:Infinity:92:z', '', null]) {
      expect(parseTerrainWorkId(id), String(id)).toBeNull()
    }
    expect(resolveTerrainWorkSite('greenway-alpha', 'works1:bridge:0:0:z')).toBeNull()
    expect(resolveTerrainWorkSite('greenway-alpha', 'tile-3-3')).toBeNull()
  })

  it('finds additional real fen spans and slate faces across four deterministic seeds', () => {
    for (const seed of seeds) {
      const catalog = new Set(mireglassRouteSites(seed).map((site) =>
        geometryKey(site.kind, site.from, site.to)))
      const bridgeSites = enumerateTerrainWorkSites(seed, bridgeWindow)
      const ladderSites = enumerateTerrainWorkSites(seed, ladderWindow)
      expect(bridgeSites.some((site) => site.kind === 'bridge'
        && catalog.has(geometryKey(site.kind, site.from, site.to)))).toBe(true)
      expect(ladderSites.some((site) => site.kind === 'ladder'
        && catalog.has(geometryKey(site.kind, site.from, site.to)))).toBe(true)
      const bridges = bridgeSites
        .filter((site) => site.kind === 'bridge' && !catalog.has(geometryKey(site.kind, site.from, site.to)))
      const ladders = ladderSites
        .filter((site) => site.kind === 'ladder' && !catalog.has(geometryKey(site.kind, site.from, site.to)))
      expect(bridges.length, `${seed} extra bridges`).toBeGreaterThanOrEqual(2)
      expect(ladders.length, `${seed} extra ladders`).toBeGreaterThanOrEqual(2)
      for (const site of [...bridges, ...ladders]) {
        if (site.kind === 'dig') throw new Error('Structure candidate was a dig site.')
        expect(site.supportPath[0]).toEqual(site.from)
        expect(site.supportPath.at(-1)).toEqual(site.to)
        expect(mireglassMoveBarrier(seed, site.from, site.to)).toBe(site.obstacle)
        expect(site.footprintTileIds.length).toBe(site.kind === 'bridge' ? 5 : 4)
      }
    }
  })

  it('offers a continuous support path at a valuable extra bridge and ladder', () => {
    const bridge = resolveTerrainWorkSite(seeds[0], 'works1:bridge:-102:92:z')
    const ladder = resolveTerrainWorkSite(seeds[0], 'works1:ladder:-103:108:W')
    expect(bridge?.kind).toBe('bridge')
    expect(ladder?.kind).toBe('ladder')
    if (bridge?.kind !== 'bridge' || ladder?.kind !== 'ladder') return
    expect(bridge.from).toMatchObject({ x: -408, z: 364 })
    expect(bridge.to).toMatchObject({ x: -408, z: 372 })
    expect(bridge.supportPath[1].y).toBeGreaterThan(bridge.from.y)
    expect(ladder.from).toMatchObject({ x: -412, y: 0.8400000000000001, z: 432 })
    expect(ladder.to).toMatchObject({ x: -416, y: 2.4000000000000004, z: 432 })
    expect(ladder.supportPath[1].z).toBe(ladder.supportPath[2].z)
    expect(ladder.supportPath[2].y - ladder.supportPath[1].y).toBeCloseTo(1.56)
    const anchors = mireglassAnchors(seeds[0])
    expect(walkable(seeds[0], anchors.salvager.tile.center, bridge.from)).toBe(true)
    expect(walkable(seeds[0], bridge.from, bridge.to)).toBe(false)
    expect(walkable(seeds[0], bridge.to, ladder.from)).toBe(true)
    expect(walkable(seeds[0], ladder.from, ladder.to)).toBe(false)
    expect(walkable(seeds[0], ladder.to, anchors.sealCache.tile.center)).toBe(true)
  })

  it('accepts safe non-marked loam and rejects wet, occupied and cliff-edge digs', () => {
    const seed = seeds[0]
    const site = resolveTerrainWorkSite(seed, 'tile--64-76')
    expect(site).toMatchObject({ kind: 'dig', rewardClass: 'stone', depthMeters: 0.24,
      center: { x: -268, z: 292 } })
    if (site?.kind === 'dig') expect(site.center.y - site.loweredCenter.y).toBeCloseTo(0.24)
    const occupiedId = mireglassAnchors(seed).salvager.tile.id
    const wetId = worldTileAtGrid(seed, -102, 92).id
    const cliffFoot = worldTileAtGrid(seed, -103, 108)
    expect(worldTileAtGrid(seed, -102, 92).terrain).toBe('wetland')
    expect(cliffFoot.terrain).toBe('loam')
    expect(resolveTerrainWorkSite(seed, occupiedId)).toBeNull()
    expect(resolveTerrainWorkSite(seed, wetId)).toBeNull()
    expect(resolveTerrainWorkSite(seed, cliffFoot.id)).toBeNull()
    expect(resolveTerrainWorkSite(seed, mireglassAnchors(seed).sealCache.tile.id)).toBeNull()
  })

  it('enumerates only a bounded local window, deterministically and without out-of-core sites', () => {
    const seed = seeds[0]
    const first = enumerateTerrainWorkSites(seed, bridgeWindow)
    expect(enumerateTerrainWorkSites(seed, bridgeWindow)).toEqual(first)
    expect(new Set(first.map((site) => site.id)).size).toBe(first.length)
    expect(first.map((site) => site.id)).toEqual([...first.map((site) => site.id)].sort())
    expect(enumerateTerrainWorkSites(seed, { minGX: 0, maxGX: 1, minGZ: 0, maxGZ: 1 })).toEqual([])
    expect(first.every((site) => site.kind === 'dig'
      ? site.center.x > MIREGLASS_CORE.minX && site.center.x < MIREGLASS_CORE.maxX
      : site.from.x >= MIREGLASS_CORE.minX && site.to.x <= MIREGLASS_CORE.maxX)).toBe(true)
    expect(() => enumerateTerrainWorkSites(seed,
      { minGX: -110, maxGX: -94, minGZ: 88, maxGZ: 94 })).toThrow(RangeError)
    expect(() => enumerateTerrainWorkSites(seed,
      { minGX: -100, maxGX: -101, minGZ: 88, maxGZ: 94 })).toThrow(RangeError)
    expect(() => enumerateTerrainWorkSites(7 as never, bridgeWindow)).toThrow(TypeError)
    expect(() => enumerateTerrainWorkSites(null as never, bridgeWindow)).toThrow(TypeError)
    expect(() => enumerateTerrainWorkSites(seed, null as never)).toThrow(RangeError)
    expect(() => enumerateTerrainWorkSites(seed, undefined as never)).toThrow(RangeError)
  })
})
