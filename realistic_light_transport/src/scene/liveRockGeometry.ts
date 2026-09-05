import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** The renderer may carve inward freely, but outward knobs must stay inside the
 * collision ellipsoids' existing 1.2x padding. */
export const LIVE_ROCK_MIN_RADIUS = 0.58
export const LIVE_ROCK_MAX_RADIUS = 1.17

function unit(seed: number, salt: number) {
  const value = Math.sin((seed + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function seededDirection(seed: number, salt: number, target: THREE.Vector3) {
  const y = unit(seed, salt) * 2 - 1
  const angle = unit(seed, salt + 1) * Math.PI * 2
  const radius = Math.sqrt(Math.max(0, 1 - y * y))
  return target.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
}

function localizedLobe(direction: THREE.Vector3, center: THREE.Vector3, width: number) {
  return THREE.MathUtils.smoothstep(direction.dot(center), 1 - width, 1) ** 2
}

/** A star-shaped displacement field keeps triangles from folding through one another.
 * Broad lobes form the silhouette, localized positive lobes form knobs, and negative
 * lobes form eroded pits and crevices. */
export function liveRockRadiusAt(direction: THREE.Vector3, seed: number) {
  const normal = direction.clone().normalize()
  const axis = new THREE.Vector3()
  let radius = 0.9

  for (let wave = 0; wave < 3; wave += 1) {
    seededDirection(seed, 20 + wave * 3, axis)
    const frequency = 2.7 + wave * 1.55 + unit(seed, 22 + wave * 3) * 0.7
    const phase = unit(seed, 23 + wave * 3) * Math.PI * 2
    radius += Math.sin(normal.dot(axis) * frequency + phase) * (0.082 - wave * 0.014)
  }

  // Reef rock is worn rather than crystalline. This smaller ridged term breaks up
  // smooth balloon silhouettes without producing needle-like spikes.
  seededDirection(seed, 45, axis)
  const ridge = Math.abs(Math.sin(normal.dot(axis) * 10.5 + unit(seed, 46) * Math.PI * 2))
  radius += (ridge - 0.5) * 0.065

  for (let knob = 0; knob < 7; knob += 1) {
    seededDirection(seed, 60 + knob * 2, axis)
    radius += localizedLobe(normal, axis, 0.14 + unit(seed, 61 + knob * 2) * 0.12)
      * (0.075 + unit(seed, 80 + knob) * 0.07)
  }

  for (let crevice = 0; crevice < 8; crevice += 1) {
    seededDirection(seed, 100 + crevice * 2, axis)
    radius -= localizedLobe(normal, axis, 0.09 + unit(seed, 101 + crevice * 2) * 0.11)
      * (0.095 + unit(seed, 120 + crevice) * 0.085)
  }

  return THREE.MathUtils.clamp(radius, LIVE_ROCK_MIN_RADIUS, LIVE_ROCK_MAX_RADIUS)
}

function computeErodedNormals(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  const normal = new THREE.BufferAttribute(new Float32Array(position.count * 3), 3)
  const accumulated = new Map<string, THREE.Vector3>()
  const keys = Array.from({ length: position.count }, (_, index) => {
    const key = `${position.getX(index).toFixed(5)}:${position.getY(index).toFixed(5)}:${position.getZ(index).toFixed(5)}`
    if (!accumulated.has(key)) accumulated.set(key, new THREE.Vector3())
    return key
  })
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const faceNormal = new THREE.Vector3()
  const faceNormals = Array.from({ length: position.count }, () => new THREE.Vector3())

  for (let index = 0; index < position.count; index += 3) {
    a.fromBufferAttribute(position, index)
    b.fromBufferAttribute(position, index + 1)
    c.fromBufferAttribute(position, index + 2)
    faceNormal.subVectors(c, b).cross(a.clone().sub(b))
    accumulated.get(keys[index])?.add(faceNormal)
    accumulated.get(keys[index + 1])?.add(faceNormal)
    accumulated.get(keys[index + 2])?.add(faceNormal)
    faceNormals[index].copy(faceNormal).normalize()
    faceNormals[index + 1].copy(faceNormal).normalize()
    faceNormals[index + 2].copy(faceNormal).normalize()
  }

  keys.forEach((key, index) => {
    const averaged = accumulated.get(key)?.normalize().multiplyScalar(0.74)
      .addScaledVector(faceNormals[index], 0.26).normalize() ?? new THREE.Vector3(0, 1, 0)
    normal.setXYZ(index, averaged.x, averaged.y, averaged.z)
  })
  geometry.setAttribute('normal', normal)
}

function deformHull(seed: number, detail: number) {
  const geometry = new THREE.IcosahedronGeometry(1, detail)
  const position = geometry.getAttribute('position')
  const direction = new THREE.Vector3()
  for (let index = 0; index < position.count; index += 1) {
    direction.fromBufferAttribute(position, index).normalize()
    direction.multiplyScalar(liveRockRadiusAt(direction, seed))
    position.setXYZ(index, direction.x, direction.y, direction.z)
  }
  position.needsUpdate = true
  return geometry
}

function transformHull(geometry: THREE.BufferGeometry, position: THREE.Vector3,
  scale: THREE.Vector3, rotation: THREE.Euler) {
  const matrix = new THREE.Matrix4().compose(position,
    new THREE.Quaternion().setFromEuler(rotation), scale)
  return geometry.applyMatrix4(matrix)
}

/** Create one deterministic, eroded live-rock hull. A per-piece hull gives the rockscape
 * genuinely different silhouettes while REEF_ROCKS remains the transform and collision
 * authority. */
export function createLiveRockGeometry(seed: number, detail = 3) {
  const hulls: THREE.BufferGeometry[] = [transformHull(
    deformHull(seed, detail),
    new THREE.Vector3(),
    new THREE.Vector3(0.84, 0.78, 0.82),
    new THREE.Euler(),
  )]

  // Large overlapping limestone lobes create broken shoulders and ledges that remain
  // legible from the tank camera. Their seams read as natural crevices, while the
  // bounded compound hull remains fully inside the collision authority's ellipsoid.
  for (let lobe = 0; lobe < 5; lobe += 1) {
    const azimuth = unit(seed, 201 + lobe * 7) * Math.PI * 2
    const distance = 0.42 + unit(seed, 202 + lobe * 7) * 0.14
    const isShelf = lobe < 3
    const offset = new THREE.Vector3(
      Math.cos(azimuth) * distance,
      (unit(seed, 203 + lobe * 7) - 0.42) * (isShelf ? 0.7 : 0.9),
      Math.sin(azimuth) * distance,
    )
    const scale = isShelf
      ? new THREE.Vector3(
        0.4 + unit(seed, 204 + lobe * 7) * 0.17,
        0.16 + unit(seed, 205 + lobe * 7) * 0.1,
        0.34 + unit(seed, 206 + lobe * 7) * 0.16,
      )
      : new THREE.Vector3(
        0.25 + unit(seed, 204 + lobe * 7) * 0.14,
        0.3 + unit(seed, 205 + lobe * 7) * 0.17,
        0.25 + unit(seed, 206 + lobe * 7) * 0.14,
      )
    const rotation = new THREE.Euler(
      (unit(seed, 207 + lobe * 7) - 0.5) * 0.5,
      unit(seed, 208 + lobe * 7) * Math.PI,
      (unit(seed, 209 + lobe * 7) - 0.5) * 0.42,
    )
    hulls.push(transformHull(deformHull(seed + 37 + lobe * 11, Math.max(1, detail - 2)),
      offset, scale, rotation))
  }

  const geometry = mergeGeometries(hulls)
  hulls.forEach((hull) => hull.dispose())
  if (!geometry) throw new Error('Unable to assemble procedural live-rock geometry')
  const position = geometry.getAttribute('position')
  let outerRadius = 0
  const vertex = new THREE.Vector3()
  for (let index = 0; index < position.count; index += 1) {
    outerRadius = Math.max(outerRadius, vertex.fromBufferAttribute(position, index).length())
  }
  if (outerRadius > LIVE_ROCK_MAX_RADIUS) {
    geometry.scale(LIVE_ROCK_MAX_RADIUS / outerRadius, LIVE_ROCK_MAX_RADIUS / outerRadius,
      LIVE_ROCK_MAX_RADIUS / outerRadius)
  }
  position.needsUpdate = true
  // PolyhedronGeometry duplicates vertices at UV seams. Average normals by the final
  // position so knobs read as water-worn limestone, not a low-poly crystal.
  computeErodedNormals(geometry)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
