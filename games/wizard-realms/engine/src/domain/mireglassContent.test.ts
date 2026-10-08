import { describe, expect, it } from 'vitest'
import { legacyTileAtGrid } from './generation'
import { MIREGLASS_CONTENT_REVISION, MIREGLASS_CORE, mireglassAnchors, mireglassResources } from './mireglassContent'
import { MIREGLASS_ENVELOPES, MIREGLASS_FEN_BACK, MIREGLASS_PLATEAU,
  mireglassBermFaceRowAt, mireglassFenDepthAt, mireglassFenRowAt, mireglassPlateauAt,
  mireglassPlateauCliffBetween } from './mireglassTerrain'
import { worldTileAtGrid } from './worldChunks'

describe('Mireglass Reach authored anchor placement', () => {
  it('pins the new core and places unique, stable anchors outside legacy Greenway', () => {
    // V3 changes the seeded ground and anchor rankings to close both route bypasses.
    expect(MIREGLASS_CONTENT_REVISION).toBe('mireglass-reach-v3')
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

  it('reserves enough uniquely placed timber on both sides of the first crossing', () => {
    for (let index = 0; index < 100; index += 1) {
      const seed = `mireglass-corpus-${index}`
      const anchors = mireglassAnchors(seed)
      const resources = mireglassResources(seed)
      expect(resources).toHaveLength(6)
      expect(resources.filter((resource) => resource.phase === 'before_bridge')).toHaveLength(3)
      expect(resources.filter((resource) => resource.phase === 'after_bridge')).toHaveLength(3)
      expect(resources.reduce((logs, resource) => logs + resource.logs, 0)).toBe(24)
      expect(new Set(resources.map((resource) => resource.id)).size).toBe(6)
      expect(resources).toEqual(mireglassResources(seed))
      for (const resource of resources) {
        expect(resource.id).toBe(`mireglass_reach/resource/${resource.tile.gridX - 3}/${resource.tile.gridZ - 3}/0`)
        expect(resource.tile).toEqual(worldTileAtGrid(seed, resource.tile.gridX - 3, resource.tile.gridZ - 3))
        for (const anchor of Object.values(anchors)) {
          expect(Math.hypot(resource.tile.center.x - anchor.tile.center.x, resource.tile.center.z - anchor.tile.center.z)).toBeGreaterThanOrEqual(4)
        }
      }
    }
  })

  it('renders a closed shallow and deep fen ring with no side or back detour across 100 seeds', () => {
    const minX = MIREGLASS_CORE.minX - 8
    const maxX = MIREGLASS_CORE.maxX + 8
    const minZ = 344
    const maxZ = MIREGLASS_FEN_BACK + 16
    const key = (x: number, z: number) => `${x},${z}`
    for (let index = 0; index < 100; index += 1) {
      const seed = `mireglass-corpus-${index}`
      const wet = new Set<string>()
      for (let z = minZ; z <= maxZ; z += 4) for (let x = minX; x <= maxX; x += 4) {
        const depth = mireglassFenDepthAt(seed, x, z)
        if (depth === null) continue
        wet.add(key(x, z))
        const tile = worldTileAtGrid(seed, x / 4, z / 4)
        expect(tile.terrain, `${seed} visible fen (${x}, ${z})`).toBe('wetland')
        expect(tile.elevation).toBe(depth === 'deep' ? 0.18 : 0.30)
        expect(tile.moisture).toBe(0.90)
      }
      for (let x = MIREGLASS_CORE.minX; x <= MIREGLASS_CORE.maxX; x += 4) {
        expect(wet.has(key(x, mireglassFenRowAt(seed, x))), `${seed} front x=${x}`).toBe(true)
        if (x > MIREGLASS_CORE.minX) {
          expect(wet.has(key(x, mireglassFenRowAt(seed, x - 4))), `${seed} meander stitch x=${x}`).toBe(true)
        }
        for (let z = MIREGLASS_FEN_BACK; z <= MIREGLASS_FEN_BACK + 8; z += 4) {
          expect(mireglassFenDepthAt(seed, x, z), `${seed} back (${x}, ${z})`).toBe('deep')
        }
      }
      for (const x of [MIREGLASS_CORE.minX, MIREGLASS_CORE.maxX]) {
        for (let z = mireglassFenRowAt(seed, x); z < MIREGLASS_FEN_BACK; z += 4) {
          expect(mireglassFenDepthAt(seed, x, z), `${seed} side (${x}, ${z})`).toBe('deep')
        }
      }
      for (const x of [MIREGLASS_CORE.minX - 4, MIREGLASS_CORE.minX + 4,
        MIREGLASS_CORE.maxX - 4, MIREGLASS_CORE.maxX + 4]) {
        expect(worldTileAtGrid(seed, x / 4, 400 / 4).terrain, `${seed} dry side bank x=${x}`).toBe('loam')
      }

      // Eight-neighbor dry movement must stay inside the ring, including meander corners.
      const start = [-352, 400] as const
      const seen = new Set<string>([key(...start)])
      const queue: [number, number][] = [[...start]]
      let escaped = false
      for (let cursor = 0; cursor < queue.length && !escaped; cursor += 1) {
        const [x, z] = queue[cursor]
        for (let dx = -4; dx <= 4; dx += 4) for (let dz = -4; dz <= 4; dz += 4) {
          if (dx === 0 && dz === 0) continue
          const nextX = x + dx
          const nextZ = z + dz
          const next = key(nextX, nextZ)
          if (wet.has(next) || seen.has(next)) continue
          if (nextX <= minX || nextX >= maxX || nextZ <= minZ || nextZ >= maxZ) escaped = true
          else { seen.add(next); queue.push([nextX, nextZ]) }
        }
      }
      expect(escaped, `${seed} fen detour`).toBe(false)
    }
  }, 30_000)

  it('renders a high cache floor enclosed by rocky south, east, and west rises and a wet far edge', () => {
    for (let index = 0; index < 100; index += 1) {
      const seed = `mireglass-corpus-${index}`
      const tile = (x: number, z: number) => worldTileAtGrid(seed, x / 4, z / 4)
      for (let x = MIREGLASS_PLATEAU.minX; x <= MIREGLASS_PLATEAU.maxX; x += 4) {
        const row = mireglassBermFaceRowAt(seed, x)
        expect(mireglassPlateauAt(seed, x, row)).toBe('rim')
        expect(tile(x, row - 8).terrain).toBe('loam')
        expect(tile(x, row - 4).terrain).toBe('loam')
        expect(tile(x, row).center.y - tile(x, row - 4).center.y).toBeCloseTo(1.56, 8)
        expect(mireglassPlateauCliffBetween(seed, x, row - 4, x, row)).toBe(true)
        for (let z = row; z <= MIREGLASS_PLATEAU.maxZ; z += 4) {
          const zone = mireglassPlateauAt(seed, x, z)
          expect(zone, `${seed} plateau (${x}, ${z})`).not.toBeNull()
          expect(tile(x, z).elevation).toBe(0.80)
          expect(tile(x, z).terrain).toBe(zone === 'rim' ? 'rocky' : 'loam')
        }
        expect(tile(x, MIREGLASS_PLATEAU.maxZ).terrain).toBe('rocky')
        expect(tile(x, MIREGLASS_FEN_BACK).terrain).toBe('wetland')
        expect(tile(x, MIREGLASS_PLATEAU.maxZ).center.y - tile(x, MIREGLASS_FEN_BACK).center.y).toBeGreaterThan(1.2)
      }
      for (const [edgeX, outsideX] of [[MIREGLASS_PLATEAU.minX, MIREGLASS_PLATEAU.minX - 4],
        [MIREGLASS_PLATEAU.maxX, MIREGLASS_PLATEAU.maxX + 4]]) {
        for (let z = mireglassBermFaceRowAt(seed, edgeX); z <= MIREGLASS_PLATEAU.maxZ; z += 4) {
          expect(tile(edgeX, z).terrain, `${seed} side rim (${edgeX}, ${z})`).toBe('rocky')
          expect(tile(outsideX, z).terrain).toBe('loam')
          expect(tile(edgeX, z).center.y - tile(outsideX, z).center.y).toBeGreaterThan(1.2)
          expect(mireglassPlateauCliffBetween(seed, edgeX, z, outsideX, z)).toBe(true)
        }
      }
      const cache = mireglassAnchors(seed).sealCache.tile
      expect(mireglassPlateauAt(seed, cache.center.x, cache.center.z)).toBe('interior')
      expect(cache.terrain).toBe('loam')
      expect(cache.elevation).toBe(0.80)
    }
  }, 30_000)

  it('preserves Greenway and provides seeded, locally crossable fen and climbable slate faces across 100 seeds', () => {
    const fenCounts: number[] = []
    const bermCounts: number[] = []
    for (let index = 0; index < 100; index += 1) {
      const seed = `mireglass-corpus-${index}`
      for (let gz = -7; gz <= 8; gz += 1) for (let gx = -7; gx <= 8; gx += 1) {
        expect(worldTileAtGrid(seed, gx, gz)).toEqual(legacyTileAtGrid(seed, gx + 3, gz + 3))
      }

      let fenCandidates = 0
      let adjacentFenCandidates = 0
      let previousFenCandidate = false
      let previousFenRow = NaN
      const fenRows = new Set<number>()
      for (let x = MIREGLASS_CORE.minX; x <= MIREGLASS_CORE.maxX; x += 4) {
        const row = mireglassFenRowAt(seed, x)
        fenRows.add(row)
        expect(mireglassFenRowAt(seed, x)).toBe(row)
        expect(row % 4).toBe(0)
        expect(row).toBeGreaterThanOrEqual(MIREGLASS_ENVELOPES.fenChannel.minZ)
        expect(row).toBeLessThan(MIREGLASS_ENVELOPES.fenChannel.maxZ)
        expect(Math.abs(row - mireglassFenRowAt(seed, x + 4))).toBeLessThanOrEqual(4)
        const tile = (z: number) => worldTileAtGrid(seed, x / 4, z / 4)
        const wetRows = []
        for (let z = MIREGLASS_ENVELOPES.fenChannel.minZ; z < MIREGLASS_ENVELOPES.fenChannel.maxZ; z += 4) {
          if (tile(z).terrain === 'wetland') wetRows.push(z)
        }
        const ringRows = Array.from({ length: (MIREGLASS_ENVELOPES.fenChannel.maxZ - MIREGLASS_ENVELOPES.fenChannel.minZ) / 4 },
          (_, offset) => MIREGLASS_ENVELOPES.fenChannel.minZ + offset * 4)
          .filter((z) => mireglassFenDepthAt(seed, x, z) !== null)
        expect(wetRows, `${seed} fen x=${x}`).toEqual(ringRows)
        const southBank = tile(row + 4)
        const northBank = tile(row - 4)
        const southApproach = tile(row + 8)
        const northApproach = tile(row - 8)
        const candidate = [southBank, northBank, southApproach, northApproach].every(({ terrain }) => terrain === 'loam')
          && Math.abs(southBank.center.z - northBank.center.z) === 8
          && Math.abs(tile(row).center.y - southBank.center.y) <= 0.9
          && Math.abs(tile(row).center.y - northBank.center.y) <= 0.9
          && Math.abs(southBank.center.y - southApproach.center.y) <= 0.9
          && Math.abs(northBank.center.y - northApproach.center.y) <= 0.9
        const inRouteEnvelope = x >= MIREGLASS_ENVELOPES.fenChannel.minX && x < MIREGLASS_ENVELOPES.fenChannel.maxX
        if (candidate && inRouteEnvelope) fenCandidates += 1
        if (candidate && previousFenCandidate && inRouteEnvelope && row === previousFenRow) adjacentFenCandidates += 1
        previousFenCandidate = candidate && inRouteEnvelope
        previousFenRow = row
      }
      expect(fenRows.size, `${seed} fen meander`).toBeGreaterThan(1)
      expect(fenCandidates, seed).toBeGreaterThanOrEqual(2)
      expect(adjacentFenCandidates, seed).toBeGreaterThanOrEqual(1)
      fenCounts.push(fenCandidates)

      let bermCandidates = 0
      let adjacentBermCandidates = 0
      let previousBermCandidate = false
      let previousBermRow = NaN
      const bermRows = new Set<number>()
      for (let x = MIREGLASS_ENVELOPES.slateBerm.minX; x < MIREGLASS_ENVELOPES.slateBerm.maxX; x += 4) {
        const row = mireglassBermFaceRowAt(seed, x)
        bermRows.add(row)
        expect(mireglassBermFaceRowAt(seed, x)).toBe(row)
        expect(row % 4).toBe(0)
        expect(row).toBeGreaterThanOrEqual(MIREGLASS_ENVELOPES.slateBerm.minZ)
        expect(row).toBeLessThan(MIREGLASS_ENVELOPES.slateBerm.maxZ)
        expect(Math.abs(row - mireglassBermFaceRowAt(seed, x + 4))).toBeLessThanOrEqual(4)
        const tile = (z: number) => worldTileAtGrid(seed, x / 4, z / 4)
        const top = tile(row)
        const foot = tile(row - 4)
        expect(top.center.z - foot.center.z).toBe(4)
        const rise = top.center.y - foot.center.y
        const candidate = top.terrain === 'rocky' && foot.terrain === 'loam' && rise >= 1.2 && rise <= 2
        if (candidate) bermCandidates += 1
        if (candidate && previousBermCandidate && row === previousBermRow) adjacentBermCandidates += 1
        previousBermCandidate = candidate
        previousBermRow = row
        for (const z of [row, row + 4, row + 8, row + 12]) {
          expect(Math.abs(tile(z).center.y - tile(z + 4).center.y), `${seed} berm far-side ramp x=${x} z=${z}`).toBeLessThanOrEqual(0.9)
        }
      }
      expect(bermRows.size, `${seed} berm meander`).toBeGreaterThan(1)
      expect(bermCandidates, seed).toBeGreaterThanOrEqual(2)
      expect(adjacentBermCandidates, seed).toBeGreaterThanOrEqual(1)
      bermCounts.push(bermCandidates)
    }
    console.info(`Mireglass corpus candidates: fen ${Math.min(...fenCounts)}..${Math.max(...fenCounts)}, berm ${Math.min(...bermCounts)}..${Math.max(...bermCounts)}`)
  }, 30_000)

  it('keeps non-cliff adjacent-cell height steps at or below 0.9 m across the authored envelopes', () => {
    let maxStep = 0
    const envelopes = [
      { minX: MIREGLASS_CORE.minX - 12, maxX: MIREGLASS_CORE.maxX + 12,
        minZ: MIREGLASS_ENVELOPES.bellAlder.minZ - 12, maxZ: MIREGLASS_FEN_BACK + 16 },
      MIREGLASS_ENVELOPES.fringeMarker,
      MIREGLASS_ENVELOPES.salvager,
    ]
    for (let index = 0; index < 100; index += 1) {
      const seed = `mireglass-corpus-${index}`
      for (const envelope of envelopes) {
        for (let z = envelope.minZ - 12; z <= envelope.maxZ + 12; z += 4) {
          for (let x = envelope.minX - 12; x <= envelope.maxX + 12; x += 4) {
            const tile = worldTileAtGrid(seed, x / 4, z / 4)
            for (const [nextX, nextZ] of [[x + 4, z], [x, z + 4]]) {
              const next = worldTileAtGrid(seed, nextX / 4, nextZ / 4)
              const step = Math.abs(tile.center.y - next.center.y)
              if (mireglassPlateauCliffBetween(seed, x, z, nextX, nextZ)) {
                expect(step, `${seed} rocky cliff (${x}, ${z}) -> (${nextX}, ${nextZ})`).toBeGreaterThan(1.2)
              } else {
                maxStep = Math.max(maxStep, step)
                expect(step, `${seed} non-cliff seam (${x}, ${z}) -> (${nextX}, ${nextZ})`).toBeLessThanOrEqual(0.9)
              }
            }
          }
        }
      }
    }
    console.info(`Mireglass corpus maximum non-cliff height step: ${maxStep.toFixed(3)} m`)
  }, 30_000)
})
