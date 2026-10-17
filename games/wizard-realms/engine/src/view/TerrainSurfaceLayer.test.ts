import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { mireglassBermFaceRowAt, mireglassFenDepthAt, mireglassFenRowAt,
  mireglassPlateauCliffBetween } from '../domain/mireglassTerrain'
import { publicV25RiverCellAtGrid } from '../domain/publicWorldV25River'
import { publicV26ValleyRimSegments } from '../domain/publicWorldV26ValleyRim'
import type { WizardTerrainCell } from './contracts'
import { buildDiscoveryEdgeGeometry, buildTerrainSurfaceGeometry,
  createTerrainSurfaceSampler, DISCOVERY_FOG_COLOR } from './TerrainSurfaceLayer'
import { buildV26ValleyRimGeometry } from './V26ValleyRimLayer'

const seed = 'greenway-alpha'
const cell = (x: number, y: number, z: number, color = '#56824b'): WizardTerrainCell => ({
  id: `tile-${x}-${z}`, position: [x, y, z], size: [4, 4], height: y + 0.7,
  climate: 'temperate_forest', color,
})
const appearance = (tile: WizardTerrainCell) => ({
  top: new THREE.Color(tile.color), side: new THREE.Color('#5a4330'),
})
const surface = (visible: WizardTerrainCell[], all = visible) =>
  buildTerrainSurfaceGeometry(seed, visible, all, appearance)
const matchingHeights = (geometry: THREE.BufferGeometry, x: number, z: number) => {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  const heights: number[] = []
  for (let index = 0; index < positions.count; index += 1) {
    if (positions.getX(index) === x && positions.getZ(index) === z) heights.push(positions.getY(index))
  }
  return heights
}
const hasFaceAt = (geometry: THREE.BufferGeometry, axis: 'x' | 'z', coordinate: number) => {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < positions.count; index += 3) {
    if ([index, index + 1, index + 2].every((vertex) =>
      (axis === 'x' ? positions.getX(vertex) : positions.getZ(vertex)) === coordinate)) return true
  }
  return false
}

describe('continuous terrain surface', () => {
  it('keeps a V31 placed-soil top flat with a 0.4 m vertical edge', () => {
    const worldSeed = 'wizard-realms'
    const rim = publicV26ValleyRimSegments(worldSeed, [])
    const tiles = [cell(12, 1.4, 4), cell(16, 1, 4)]
    const raised = [{ gx: 3, gz: 1 }]
    const v27 = { rimSegments: rim, openPitColumns: [] }
    const sampler = createTerrainSurfaceSampler(worldSeed, tiles, appearance, true, v27, raised)
    expect(sampler.linked(tiles[0], tiles[1])).toBe(false)
    expect(sampler.presentationTargetYAt(13.99, 4, 1.4)).toBeCloseTo(1.4)
    expect(sampler.presentationTargetYAt(14.01, 4, 1)).toBeCloseTo(1)
    const mesh = buildTerrainSurfaceGeometry(worldSeed, tiles, tiles, appearance,
      rim, true, [], raised)
    const edge = matchingHeights(mesh.top, 14, 4).sort()
    expect(edge).toHaveLength(2)
    expect(edge[0]).toBeCloseTo(1)
    expect(edge[1]).toBeCloseTo(1.4)
    expect(hasFaceAt(mesh.sides, 'x', 14)).toBe(true)
    mesh.top.dispose(); mesh.sides.dispose()
  })

  it('links a V27 ordinary 0.655 m dry lip into a slope while V26 retains its fascia', () => {
    const worldSeed = 'wizard-realms'
    const rim = publicV26ValleyRimSegments(worldSeed, [])
    const tiles = [cell(12, 1, 4), cell(16, 1.6549226409010587, 4)]
    const old = buildTerrainSurfaceGeometry(worldSeed, tiles, tiles, appearance, rim)
    const next = buildTerrainSurfaceGeometry(worldSeed, tiles, tiles, appearance, rim, true, [])
    const missingRim = buildTerrainSurfaceGeometry(worldSeed, tiles, tiles, appearance,
      undefined, true, [])
    const missingPits = buildTerrainSurfaceGeometry(worldSeed, tiles, tiles, appearance,
      rim, true)
    expect(hasFaceAt(old.sides, 'x', 14)).toBe(true)
    expect(hasFaceAt(next.sides, 'x', 14)).toBe(false)
    expect(hasFaceAt(missingRim.sides, 'x', 14)).toBe(true)
    expect(hasFaceAt(missingPits.sides, 'x', 14)).toBe(true)
    matchingHeights(old.top, 14, 4).sort().forEach((height, index) =>
      expect(height).toBeCloseTo(tiles[index].position[1]))
    matchingHeights(next.top, 14, 4).forEach((height) =>
      expect(height).toBeCloseTo((tiles[0].position[1] + tiles[1].position[1]) / 2))
    const v27 = { rimSegments: rim, openPitColumns: [] }
    const atLimit = [cell(12, 1, 4), cell(16, 1.8, 4)]
    const overLimit = [cell(12, 1, 4), cell(16, 1.801, 4)]
    expect(createTerrainSurfaceSampler(worldSeed, atLimit, appearance, true, v27)
      .linked(atLimit[0], atLimit[1])).toBe(true)
    expect(createTerrainSurfaceSampler(worldSeed, overLimit, appearance, true, v27)
      .linked(overLimit[0], overLimit[1])).toBe(false)
    old.top.dispose(); old.sides.dispose()
    next.top.dispose(); next.sides.dispose()
    missingRim.top.dispose(); missingRim.sides.dispose()
    missingPits.top.dispose(); missingPits.sides.dispose()
  })

  it('does not smooth a saved pit, authored north rim, or seeded river bank in V27', () => {
    const worldSeed = 'wizard-realms'
    const rim = publicV26ValleyRimSegments(worldSeed, [])
    const ordinary = [cell(12, 1, 4), cell(16, 1.6, 4)]
    const pit = createTerrainSurfaceSampler(worldSeed, ordinary, appearance, true,
      { rimSegments: rim, openPitColumns: [{ gx: 3, gz: 1, openDepth: 1 }] })
    expect(pit.linked(ordinary[0], ordinary[1])).toBe(false)
    const pitMesh = buildTerrainSurfaceGeometry(worldSeed, ordinary, ordinary, appearance, rim, true,
      [{ gx: 3, gz: 1, openDepth: 1 }])
    expect(hasFaceAt(pitMesh.sides, 'x', 14)).toBe(true)
    pitMesh.top.dispose(); pitMesh.sides.dispose()

    const north = [cell(-28, 1.721, -8), cell(-28, 1, -4)]
    const northWithAperture = publicV26ValleyRimSegments(worldSeed,
      [{ x: -28, widthMeters: 0.5 }])
    expect(northWithAperture.some((segment) => segment.ladderAperture
      && segment.from.x < -28 && segment.to.x > -28)).toBe(true)
    const northSampler = createTerrainSurfaceSampler(worldSeed, north, appearance, true,
      { rimSegments: northWithAperture, openPitColumns: [] })
    expect(northSampler.linked(north[0], north[1])).toBe(false)
    const northMesh = buildTerrainSurfaceGeometry(worldSeed, north, north, appearance,
      northWithAperture, true, [])
    const northHeights = matchingHeights(northMesh.top, -28, -6).sort()
    expect(northHeights).toHaveLength(2)
    expect(northHeights[0]).toBeCloseTo(1)
    expect(northHeights[1]).toBeCloseTo(1.721)
    northMesh.top.dispose(); northMesh.sides.dispose()

    expect(publicV25RiverCellAtGrid(worldSeed, 0, 1)).toBe(false)
    expect(publicV25RiverCellAtGrid(worldSeed, 0, 2)).toBe(true)
    const river = [cell(0, 1, 4), cell(0, 1.6, 8)]
    const riverSampler = createTerrainSurfaceSampler(worldSeed, river, appearance, true,
      { rimSegments: rim, openPitColumns: [] })
    expect(riverSampler.linked(river[0], river[1])).toBe(false)
    const riverMesh = buildTerrainSurfaceGeometry(worldSeed, river, river, appearance, rim, true, [])
    expect(hasFaceAt(riverMesh.sides, 'z', 6)).toBe(true)
    riverMesh.top.dispose(); riverMesh.sides.dispose()
  })

  it('keeps the V27 presentation height on its rendered ordinary slope, but not across protected edges', () => {
    const worldSeed = 'wizard-realms'
    const rim = publicV26ValleyRimSegments(worldSeed, [])
    const ordinary = [cell(12, 1, 4), cell(16, 1.6549226409010587, 4)]
    const v26 = createTerrainSurfaceSampler(worldSeed, ordinary, appearance, true)
    const v27 = createTerrainSurfaceSampler(worldSeed, ordinary, appearance, true,
      { rimSegments: rim, openPitColumns: [] })
    const left = v27.presentationTargetYAt(13.99, 4, ordinary[0].position[1])
    const right = v27.presentationTargetYAt(14.01, 4, ordinary[1].position[1])
    expect(left).toBeCloseTo(1.3258244175)
    expect(right).toBeCloseTo(1.3290989897)
    expect(right - left).toBeLessThan(0.01)
    expect(v26.presentationTargetYAt(14.01, 4, ordinary[1].position[1])
      - v26.presentationTargetYAt(13.99, 4, ordinary[0].position[1])).toBeGreaterThan(0.6)
    expect(v27.presentationTargetYAt(14.01, 4, ordinary[1].position[1] + 0.5) - right)
      .toBeCloseTo(0.5)

    const pit = createTerrainSurfaceSampler(worldSeed, ordinary, appearance, true,
      { rimSegments: rim, openPitColumns: [{ gx: 3, gz: 1, openDepth: 1 }] })
    expect(pit.presentationTargetYAt(14.01, 4, ordinary[1].position[1])
      - pit.presentationTargetYAt(13.99, 4, ordinary[0].position[1])).toBeGreaterThan(0.6)
    const north = [cell(-28, 1.721, -8), cell(-28, 1, -4)]
    const northSampler = createTerrainSurfaceSampler(worldSeed, north, appearance, true,
      { rimSegments: rim, openPitColumns: [] })
    expect(northSampler.presentationTargetYAt(-28, -6.01, north[0].position[1])
      - northSampler.presentationTargetYAt(-28, -5.99, north[1].position[1])).toBeGreaterThan(0.7)
    const river = [cell(0, 1, 4), cell(0, 1.6, 8)]
    const riverSampler = createTerrainSurfaceSampler(worldSeed, river, appearance, true,
      { rimSegments: rim, openPitColumns: [] })
    expect(riverSampler.presentationTargetYAt(0, 6.01, river[1].position[1])
      - riverSampler.presentationTargetYAt(0, 5.99, river[0].position[1])).toBeGreaterThan(0.5)
  })

  it('keeps a V26 one-layer pit center and edge at their exact lowered height', () => {
    const tiles = [cell(0, 0.6, 0), cell(4, 1, 0)]
    const classic = surface(tiles)
    matchingHeights(classic.top, 2, 0).forEach((height) => expect(height).toBeCloseTo(0.8))
    expect(hasFaceAt(classic.sides, 'x', 2)).toBe(false)
    const physical = buildTerrainSurfaceGeometry(seed, tiles, tiles, appearance, [])
    expect(matchingHeights(physical.top, 0, 0)[0]).toBeCloseTo(0.6)
    expect(matchingHeights(physical.top, 2, 0)[0]).toBeCloseTo(0.6)
    expect(matchingHeights(physical.top, 2, 0)[1]).toBeCloseTo(1)
    expect(hasFaceAt(physical.sides, 'x', 2)).toBe(true)
    const sampler = createTerrainSurfaceSampler(seed, tiles, appearance, true)
    expect(sampler.presentationTargetYAt(0, 0, 0.6)).toBeCloseTo(0.6)
    classic.top.dispose(); classic.sides.dispose()
    physical.top.dispose(); physical.sides.dispose()
  })

  it('leaves the saved north-rim aperture clear of both old fascia and new rock', () => {
    const segments = publicV26ValleyRimSegments(seed, [{ x: -2, widthMeters: 1.05 }])
    const tiles = [-4, 0].flatMap((x) => [cell(x, 0, -4), cell(x, 1.56, -8)])
    const classic = surface(tiles)
    const physical = buildTerrainSurfaceGeometry(seed, tiles, tiles, appearance, segments)
    const rim = buildV26ValleyRimGeometry(segments, tiles)
    expect(hasFaceAt(classic.sides, 'z', -6)).toBe(true)
    expect(hasFaceAt(physical.sides, 'z', -6)).toBe(false)
    const positions = rim.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < positions.count; index += 1) {
      expect(positions.getX(index) > -2.524 && positions.getX(index) < -1.476).toBe(false)
    }
    classic.top.dispose(); classic.sides.dispose()
    physical.top.dispose(); physical.sides.dispose(); rim.dispose()
  })

  it('feathers only the outside of the discovered patch into the unknown-field colour', () => {
    const center = cell(0, 1, 0)
    const east = cell(4, 1, 0)
    const one = buildDiscoveryEdgeGeometry(seed, [center], [center, east], appearance)
    const joined = buildDiscoveryEdgeGeometry(seed, [center, east], [center, east], appearance)
    const positions = one.getAttribute('position') as THREE.BufferAttribute
    const colors = one.getAttribute('color') as THREE.BufferAttribute
    expect(positions.count).toBe(48) // Four perimeter edges, each split into two gradient quads.
    expect(joined.getAttribute('position').count).toBe(72) // Shared edge is no longer fogged.
    expect(colors.itemSize).toBe(4)
    expect(colors.getW(0)).toBe(0)
    expect(colors.getW(1)).toBe(1)
    expect(colors.getX(1)).toBeCloseTo(new THREE.Color(DISCOVERY_FOG_COLOR).r)
    one.dispose(); joined.dispose()
  })

  it('keeps the presentation target continuous across a 0.641 m cell step and preserves jump height', () => {
    const tiles = [cell(0, 1, -8), cell(4, 1.641, -8)]
    const sampler = createTerrainSurfaceSampler(seed, tiles, appearance)
    const left = sampler.presentationTargetYAt(1.99, -8, tiles[0].position[1])
    const seam = sampler.presentationTargetYAt(2, -8, tiles[0].position[1])
    const right = sampler.presentationTargetYAt(2.01, -8, tiles[1].position[1])
    expect(left).toBeCloseTo(1.3188975)
    expect(seam).toBeCloseTo(1.3205)
    expect(right).toBeCloseTo(1.3221025)
    expect(right - left).toBeLessThan(0.01)
    const heldPoseY = 1.79010027
    expect(Math.abs((heldPoseY + (right - heldPoseY) * 0.2)
      - (heldPoseY + (left - heldPoseY) * 0.2))).toBeLessThan(0.001)
    expect(sampler.presentationTargetYAt(2.01, -8, tiles[1].position[1] + 0.72) - right).toBeCloseTo(0.72)
    expect(tiles.map((tile) => tile.position[1])).toEqual([1, 1.641])
  })

  it('keeps authoritative center heights and colors while joining ordinary neighbors without an interior wall', () => {
    const tiles = [cell(0, 1, 0, '#56824b'), cell(4, 1.2, 0, '#6b9250')]
    const { top, sides } = surface(tiles)
    const positions = top.getAttribute('position') as THREE.BufferAttribute
    const colors = top.getAttribute('color') as THREE.BufferAttribute
    const normals = top.getAttribute('normal') as THREE.BufferAttribute
    expect(positions.getY(0)).toBe(1)
    expect(positions.getY(9)).toBeCloseTo(1.2)
    expect(colors.getX(0)).toBeCloseTo(new THREE.Color('#56824b').r)
    for (const z of [-2, 0, 2]) {
      const heights = matchingHeights(top, 2, z)
      expect(heights).toHaveLength(2)
      heights.forEach((height) => expect(height).toBeCloseTo(1.1))
    }
    for (const axis of ['getX', 'getY', 'getZ'] as const) {
      expect(normals[axis](4)).toBeCloseTo(normals[axis](17))
    }
    expect(hasFaceAt(sides, 'x', 2)).toBe(false)
    expect(hasFaceAt(sides, 'x', -2)).toBe(false) // Bounded scene edge, not world edge.
    const first = surface([tiles[0]], tiles)
    expect(matchingHeights(first.top, 2, 0)[0]).toBeCloseTo(matchingHeights(top, 2, 0)[0])
    expect(hasFaceAt(first.sides, 'x', 2)).toBe(false) // A hidden adjacent tile is fog, not a cliff.
    first.top.dispose(); first.sides.dispose()
    top.dispose(); sides.dispose()
  })

  it('closes only a genuine canonical world face, not a dry render cutoff', () => {
    const cutoff = surface([cell(32, 1, 0)])
    expect(hasFaceAt(cutoff.sides, 'x', 34)).toBe(false)
    const westernEdge = { ...cell(-1024, 1, 0), id: 'tile--253-3' }
    const world = surface([westernEdge])
    expect(hasFaceAt(world.sides, 'x', -1026)).toBe(true)
    cutoff.top.dispose(); cutoff.sides.dispose()
    world.top.dispose(); world.sides.dispose()
  })

  it('gives pale terrain broad color mass while keeping neighboring seams identical', () => {
    const tiles = [cell(0, 1, 0, '#d4e3df'), cell(4, 1, 0, '#d4e3df')]
      .map((tile) => ({ ...tile, climate: 'alpine' }))
    const { top, sides } = surface(tiles)
    const colors = top.getAttribute('color') as THREE.BufferAttribute
    const pale = new THREE.Color('#d4e3df')
    expect(colors.getX(0)).toBeLessThan(pale.r * 0.8)
    expect(colors.getY(0)).toBeLessThan(pale.g * 0.8)
    for (const channel of ['getX', 'getY', 'getZ'] as const) {
      expect(colors[channel](4)).toBeCloseTo(colors[channel](17))
    }
    top.dispose(); sides.dispose()
  })

  it('keeps an authored Mireglass plateau cliff discontinuous even for a small test step', () => {
    const x = -400
    const z = mireglassBermFaceRowAt(seed, x)
    expect(mireglassPlateauCliffBetween(seed, x, z, x, z - 4)).toBe(true)
    const tiles = [cell(x, 1.5, z), cell(x, 1.3, z - 4)]
    const { top, sides } = surface(tiles)
    const seam = z - 2
    const cliffHeights = matchingHeights(top, x, seam).sort()
    expect(cliffHeights).toHaveLength(2)
    expect(cliffHeights[0]).toBeCloseTo(1.3)
    expect(cliffHeights[1]).toBeCloseTo(1.5)
    expect(hasFaceAt(sides, 'z', seam)).toBe(true)
    top.dispose(); sides.dispose()
  })

  it('leaves a bank face where fixed-height Mireglass water meets dry ground', () => {
    const x = -360
    const wetZ = mireglassFenRowAt(seed, x)
    const dryZ = [wetZ - 4, wetZ + 4].find((z) => !mireglassFenDepthAt(seed, x, z))!
    const { top, sides } = surface([cell(x, 0.9, wetZ), cell(x, 1.2, dryZ)])
    const seam = (wetZ + dryZ) / 2
    expect(matchingHeights(top, x, seam)).toHaveLength(2)
    expect(hasFaceAt(sides, 'z', seam)).toBe(true)
    top.dispose(); sides.dispose()
  })

})
