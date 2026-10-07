import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  createLiveRockCollisionField,
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

    expect(Math.max(...radii)).toBeLessThanOrEqual(LIVE_ROCK_MAX_RADIUS + 1e-6)
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.5)
    expect(radii.filter((radius) => radius > 0.98).length).toBeGreaterThan(20)
    expect(position.count).toBeGreaterThan(1800)
    expect(geometry.boundingSphere?.radius).toBeLessThan(1.2)
    for (let index = 0; index < normal.count; index += 1) {
      const surfaceNormal = new THREE.Vector3().fromBufferAttribute(normal, index)
      expect(surfaceNormal.length()).toBeCloseTo(1, 5)
      expect(Number.isFinite(surfaceNormal.x + surfaceNormal.y + surfaceNormal.z)).toBe(true)
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

  it('conservatively encloses the transformed rendered hull and returns a finite far clearance', () => {
    const seed = 11
    const position = new THREE.Vector3(1.3, -0.4, 0.7)
    const rotation = new THREE.Euler(0.28, 0.71, -0.19)
    const scale = new THREE.Vector3(1.55, 0.62, 0.91)
    const field = createLiveRockCollisionField(seed, position, rotation, scale)
    const geometry = createLiveRockGeometry(seed)
    const sourcePositions = Array.from(geometry.getAttribute('position').array)
    const transform = new THREE.Matrix4().compose(position,
      new THREE.Quaternion().setFromEuler(rotation), scale)
    const point = new THREE.Vector3()
    const normal = new THREE.Vector3()
    let maximumVertexClearance = -Infinity

    const vertices = geometry.getAttribute('position')
    for (let index = 0; index < vertices.count; index += 1) {
      point.fromBufferAttribute(vertices, index).applyMatrix4(transform)
      maximumVertexClearance = Math.max(maximumVertexClearance,
        field.surfaceClearance(point, normal))
    }
    expect(maximumVertexClearance).toBeLessThanOrEqual(1e-4)
    expect(maximumVertexClearance).toBeGreaterThanOrEqual(-1e-3)

    const farPoint = position.clone().add(new THREE.Vector3(5, 3, -4))
    const farClearance = field.surfaceClearance(farPoint, normal)
    expect(farClearance).toBeGreaterThan(0)
    expect(Number.isFinite(farClearance + normal.x + normal.y + normal.z)).toBe(true)
    expect(normal.length()).toBeCloseTo(1)
    expect(normal.dot(farPoint.clone().sub(position).normalize())).toBeGreaterThan(0)
    expect(Array.from(geometry.getAttribute('position').array)).toEqual(sourcePositions)
    geometry.dispose()
  })

  it('honors rotation and keeps repeated queries stable without retaining render objects', () => {
    const seed = 19
    const position = new THREE.Vector3(-0.8, 0.5, 1.1)
    const scale = new THREE.Vector3(1.7, 0.58, 0.86)
    const rotation = new THREE.Euler(0.35, 0.82, -0.16)
    const rotated = createLiveRockCollisionField(seed, position, rotation, scale)
    const unrotated = createLiveRockCollisionField(seed, position, new THREE.Euler(), scale)
    const query = position.clone().add(new THREE.Vector3(1.05, 0.24, 0.52))
    const rotatedNormal = new THREE.Vector3()
    const unrotatedNormal = new THREE.Vector3()
    const clearance = rotated.surfaceClearance(query, rotatedNormal)

    expect(Math.abs(clearance - unrotated.surfaceClearance(query, unrotatedNormal)))
      .toBeGreaterThan(0.02)
    const orientation = new THREE.Quaternion().setFromEuler(rotation)
    const longAxisPoint = position.clone().add(new THREE.Vector3(1, 0, 0).applyQuaternion(orientation))
    const shortAxisPoint = position.clone().add(new THREE.Vector3(0, 1, 0).applyQuaternion(orientation))
    expect(rotated.surfaceClearance(shortAxisPoint, new THREE.Vector3())
      - rotated.surfaceClearance(longAxisPoint, new THREE.Vector3())).toBeGreaterThan(0.5)
    for (let index = 0; index < 8; index += 1) {
      const repeatedNormal = new THREE.Vector3()
      expect(rotated.surfaceClearance(query, repeatedNormal)).toBeCloseTo(clearance, 12)
      expect(repeatedNormal.distanceTo(rotatedNormal)).toBeLessThanOrEqual(1e-12)
    }
    expect(Object.keys(rotated)).toEqual(['surfaceClearance'])
  })
})
