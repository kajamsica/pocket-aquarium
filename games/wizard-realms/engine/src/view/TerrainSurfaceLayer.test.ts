import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { mireglassBermFaceRowAt, mireglassFenDepthAt, mireglassFenRowAt,
  mireglassPlateauCliffBetween } from '../domain/mireglassTerrain'
import type { WizardTerrainCell } from './contracts'
import { buildTerrainSurfaceGeometry, createTerrainSurfaceSampler } from './TerrainSurfaceLayer'

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
    expect(matchingHeights(sides, -2, 0).some((height) => Math.abs(height + 0.72) < 0.00001)).toBe(true)
    const first = surface([tiles[0]], tiles)
    expect(matchingHeights(first.top, 2, 0)[0]).toBeCloseTo(matchingHeights(top, 2, 0)[0])
    expect(hasFaceAt(first.sides, 'x', 2)).toBe(true)
    first.top.dispose(); first.sides.dispose()
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
