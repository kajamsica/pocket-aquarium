import { describe, expect, it } from 'vitest'
import { MIREGLASS_CONTENT_REVISION, MIREGLASS_CORE, mireglassAnchors } from './mireglassContent'
import { MIREGLASS_ENVELOPES } from './mireglassTerrain'
import { worldTileAtGrid } from './worldChunks'

describe('Mireglass Reach authored anchor placement', () => {
  it('pins the new core and places unique, stable anchors outside legacy Greenway', () => {
    expect(MIREGLASS_CONTENT_REVISION).toBe('mireglass-reach-v1')
    expect(MIREGLASS_CORE).toEqual({ minX: -448, maxX: -256, minZ: 256, maxZ: 512 })
    const anchors = mireglassAnchors('mireglass-seed')
    expect(Object.keys(anchors)).toEqual(['fringeMarker', 'salvager', 'bellAlder', 'fenChannel', 'slateBerm', 'sealCache'])
    expect(new Set(Object.values(anchors).map(({ id }) => id)).size).toBe(6)
    expect(new Set(Object.values(anchors).map(({ tile }) => tile.id)).size).toBe(6)
    expect(Object.values(anchors).every(({ tile }) => tile.center.x < -30 && tile.center.z > 30)).toBe(true)
    for (const [key, { tile }] of Object.entries(anchors)) {
      const envelope = MIREGLASS_ENVELOPES[key as keyof typeof MIREGLASS_ENVELOPES]
      expect(tile.center.x).toBeGreaterThanOrEqual(envelope.minX)
      expect(tile.center.x).toBeLessThan(envelope.maxX)
      expect(tile.center.z).toBeGreaterThanOrEqual(envelope.minZ)
      expect(tile.center.z).toBeLessThan(envelope.maxZ)
    }
    expect(anchors.bellAlder.tile.terrain).toBe('wetland')
    expect(anchors.fenChannel.tile.terrain).toBe('wetland')
    expect(anchors.salvager.tile.terrain).toBe('loam')
    expect(anchors.slateBerm.tile.terrain).toBe('rocky')
    expect(anchors.sealCache.tile.terrain).toBe('loam')
    expect(mireglassAnchors('mireglass-seed')).toEqual(anchors)
    expect(mireglassAnchors('')).toEqual(mireglassAnchors('wizard-realms'))
    for (const { tile } of Object.values(anchors)) {
      expect(tile).toEqual(worldTileAtGrid('mireglass-seed', tile.gridX - 3, tile.gridZ - 3))
    }
  })

  it('finds eligible wetland anchors across a fixed 100-seed content corpus', () => {
    for (let index = 0; index < 100; index += 1) {
      const seed = `mireglass-corpus-${index}`
      let anchors: ReturnType<typeof mireglassAnchors>
      try { anchors = mireglassAnchors(seed) } catch (error) { throw new Error(`${seed}: ${error}`) }
      expect(anchors.bellAlder.tile.terrain).toBe('wetland')
      expect(anchors.fenChannel.tile.terrain).toBe('wetland')
      expect(anchors.salvager.tile.terrain).toBe('loam')
      expect(anchors.slateBerm.tile.terrain).toBe('rocky')
      expect(anchors.sealCache.tile.terrain).toBe('loam')
    }
  })

  it('blends authored ground forms without a sharp adjacent-cell height step', () => {
    for (const seed of ['mireglass-corpus-0', 'mireglass-corpus-25', 'mireglass-corpus-50', 'mireglass-corpus-75']) {
      for (const envelope of Object.values(MIREGLASS_ENVELOPES)) {
        for (let z = envelope.minZ - 12; z <= envelope.maxZ + 12; z += 4) {
          for (let x = envelope.minX - 12; x <= envelope.maxX + 12; x += 4) {
            const tile = worldTileAtGrid(seed, x / 4, z / 4)
            const east = worldTileAtGrid(seed, x / 4 + 1, z / 4)
            const south = worldTileAtGrid(seed, x / 4, z / 4 + 1)
            expect(Math.abs(tile.center.y - east.center.y)).toBeLessThanOrEqual(0.9)
            expect(Math.abs(tile.center.y - south.center.y)).toBeLessThanOrEqual(0.9)
          }
        }
      }
    }
  })
})
