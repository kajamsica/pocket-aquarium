import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  createLiveRockGeometry,
  LIVE_ROCK_MAX_RADIUS,
  LIVE_ROCK_MIN_RADIUS,
  liveRockRadiusAt,
} from './liveRockGeometry'

function positionsFor(seed: number) {
  const geometry = createLiveRockGeometry(seed)
  const positions = Array.from(geometry.getAttribute('position').array)
  geometry.dispose()
  return positions
}

describe('live rock geometry', () => {
  it('replays the same seed and gives different rocks distinct silhouettes', () => {
    expect(positionsFor(4)).toEqual(positionsFor(4))
    expect(positionsFor(4)).not.toEqual(positionsFor(5))
  })

  it('forms substantial knobs and crevices inside the existing collision envelope', () => {
    const geometry = createLiveRockGeometry(8)
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const radii = Array.from({ length: position.count }, (_, index) =>
      new THREE.Vector3().fromBufferAttribute(position, index).length())

    expect(Math.min(...radii)).toBeGreaterThanOrEqual(LIVE_ROCK_MIN_RADIUS - 1e-6)
    expect(Math.max(...radii)).toBeLessThanOrEqual(LIVE_ROCK_MAX_RADIUS + 1e-6)
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.18)
    expect(geometry.boundingSphere?.radius).toBeLessThan(1.2)
    for (let index = 0; index < normal.count; index += 1) {
      const direction = new THREE.Vector3().fromBufferAttribute(position, index).normalize()
      const surfaceNormal = new THREE.Vector3().fromBufferAttribute(normal, index)
      expect(surfaceNormal.length()).toBeCloseTo(1, 5)
      expect(surfaceNormal.dot(direction)).toBeGreaterThan(0.45)
    }
    geometry.dispose()
  })

  it('returns finite bounded radii for arbitrary sample directions', () => {
    for (let index = 0; index < 120; index += 1) {
      const direction = new THREE.Vector3(
        Math.sin(index * 1.7),
        Math.cos(index * 0.83),
        Math.sin(index * 0.41 + 1),
      )
      const radius = liveRockRadiusAt(direction, 17)
      expect(Number.isFinite(radius)).toBe(true)
      expect(radius).toBeGreaterThanOrEqual(LIVE_ROCK_MIN_RADIUS)
      expect(radius).toBeLessThanOrEqual(LIVE_ROCK_MAX_RADIUS)
    }
  })
})
