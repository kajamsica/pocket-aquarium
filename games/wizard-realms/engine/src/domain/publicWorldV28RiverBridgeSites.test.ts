import { describe, expect, it } from 'vitest'
import { publicV25RiverCellAtGrid, publicV25RiverCenterZ } from './publicWorldV25River'
import { enumeratePublicV28RiverBridges, parsePublicV28RiverBridgeId,
  publicV28RiverBridgeId, resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { WORLD_GRID_MAX, WORLD_GRID_MIN, worldTileAtGrid } from './worldChunks'

const SEED = 'greenway-alpha'

describe('V28 connected-river bridge sites', () => {
  it('resolves the off-starter Greenway crossing from V25 cells and complete support', () => {
    const site = resolvePublicV28RiverBridge(SEED, 'works6:river-bridge:-14')
    expect(site).not.toBeNull()
    expect(site).toMatchObject({ id: 'works6:river-bridge:-14', kind: 'bridge',
      obstacle: 'connected_river', approach: { x: -56, z: 4 }, from: { x: -56, z: 8 },
      to: { x: -56, z: 16 }, exit: { x: -56, z: 20 },
      widthMeters: 1.6, logCost: 8, xpReward: 80, rewardClass: 'construction' })
    expect(site!.wetGapTileIds).toEqual([worldTileAtGrid(SEED, -14, 3).id])
    expect(site!.footprintTileIds).toEqual([1, 2, 3, 4, 5]
      .map((gz) => worldTileAtGrid(SEED, -14, gz).id))
    expect(site!.supportPath.map(({ z }) => z)).toEqual([8, 12, 16])
    expect(site!.supportPath[1].y).toBeGreaterThan(worldTileAtGrid(SEED, -14, 3).center.y)
    expect(site!.corridor).toMatchObject({ center: { x: -56, z: 12 },
      normal: { x: 0, z: 1 }, tangent: { x: 1, z: 0 }, halfLength: 4 })
    expect(resolvePublicV28RiverBridge(SEED, site!.id)).toEqual(site)
  })

  it('parses only strict, canonical in-world column IDs', () => {
    expect(parsePublicV28RiverBridgeId('works6:river-bridge:0')).toBe(0)
    expect(parsePublicV28RiverBridgeId('works6:river-bridge:-14')).toBe(-14)
    expect(publicV28RiverBridgeId(WORLD_GRID_MIN)).toBe(`works6:river-bridge:${WORLD_GRID_MIN}`)
    expect(publicV28RiverBridgeId(WORLD_GRID_MAX)).toBe(`works6:river-bridge:${WORLD_GRID_MAX}`)
    for (const id of ['works6:river-bridge:-0', 'works6:river-bridge:00',
      'works6:river-bridge:+1', 'works6:river-bridge:01', 'works6:river-bridge:-01',
      'works6:river-bridge:1.0', 'works6:river-bridge: 1', 'works6:river-bridge:1:3',
      'works6:river-bridge:256', 'works6:river-bridge:-257', 'works4:bridge:-14',
      14, null]) {
      expect(parsePublicV28RiverBridgeId(id), String(id)).toBeNull()
      expect(resolvePublicV28RiverBridge(SEED, id), String(id)).toBeNull()
    }
    for (const column of [WORLD_GRID_MIN - 1, WORLD_GRID_MAX + 1, 1.5, NaN]) {
      expect(() => publicV28RiverBridgeId(column)).toThrow(RangeError)
    }
    for (const seed of ['', 'x'.repeat(129), null as never]) {
      expect(resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-14')).toBeNull()
    }
  })

  it('rejects the Greenway owner buffer and derives dry, low-grade banks for every accepted site', () => {
    for (let gx = -9; gx <= 10; gx++) {
      expect(resolvePublicV28RiverBridge(SEED, publicV28RiverBridgeId(gx))).toBeNull()
    }
    let accepted = 0
    for (let gx = WORLD_GRID_MIN; gx <= WORLD_GRID_MAX; gx++) {
      const site = resolvePublicV28RiverBridge(SEED, publicV28RiverBridgeId(gx))
      if (!site) continue
      accepted++
      expect(site.footprintTileIds).toHaveLength(site.wetGapTileIds.length + 4)
      expect(new Set(site.footprintTileIds).size).toBe(site.footprintTileIds.length)
      expect(site.supportPath).toHaveLength(site.wetGapTileIds.length + 2)
      for (const bank of [site.approach, site.from, site.to, site.exit]) {
        const gz = bank.z / 4
        expect(worldTileAtGrid(SEED, gx, gz).terrain).toBe('loam')
        expect(publicV25RiverCellAtGrid(SEED, gx, gz)).toBe(false)
        if (bank === site.approach || bank === site.exit) {
          for (const sideGX of [gx - 1, gx + 1]) {
            expect(publicV25RiverCellAtGrid(SEED, sideGX, gz)).toBe(false)
          }
        }
      }
      expect(Math.abs(site.from.y - site.approach.y)).toBeLessThanOrEqual(0.55)
      expect(Math.abs(site.to.y - site.from.y)).toBeLessThanOrEqual(0.55)
      expect(Math.abs(site.exit.y - site.to.y)).toBeLessThanOrEqual(0.55)
    }
    expect(accepted).toBeGreaterThan(2)
  })

  it('can bridge both wet rows at a bend without trusting a caller-supplied span', () => {
    const seeds = [SEED, 'wizard-realms', 'river-eastern-snow']
    const bent = seeds.flatMap((seed) => Array.from({ length: WORLD_GRID_MAX - WORLD_GRID_MIN - 1 },
      (_, index) => {
        const gx = WORLD_GRID_MIN + 1 + index
        return resolvePublicV28RiverBridge(seed, publicV28RiverBridgeId(gx))
      }).filter((site) => site?.wetGapTileIds.length === 2))
    expect(bent.length).toBeGreaterThan(0)
    const site = bent[0]!
    expect(site.supportPath).toHaveLength(4)
    expect(site.footprintTileIds).toHaveLength(6)
    expect(site.supportPath[1].y).toBe(site.supportPath[2].y)
    expect(site.to.z - site.from.z).toBe(12)
  })

  it('enumerates only complete sites in one bounded visible window', () => {
    const window = { minGX: -16, maxGX: -12, minGZ: 0, maxGZ: 6 }
    const sites = enumeratePublicV28RiverBridges(SEED, window)
    expect(sites.map(({ id }) => id)).toContain('works6:river-bridge:-14')
    expect(sites.every((site) => site.footprintTileIds.every((_, index) => {
      const gz = site.approach.z / 4 + index
      return gz >= window.minGZ && gz <= window.maxGZ
    }))).toBe(true)
    expect(enumeratePublicV28RiverBridges(SEED, { ...window, minGZ: 2 })
      .map(({ id }) => id)).not.toContain('works6:river-bridge:-14')
    for (const bad of [{ ...window, maxGX: 0 }, { ...window, minGX: -257 },
      { ...window, maxGZ: -1 }, { ...window, minGX: -14.5 }, null as never]) {
      expect(() => enumeratePublicV28RiverBridges(SEED, bad)).toThrow(RangeError)
    }
  })
})
