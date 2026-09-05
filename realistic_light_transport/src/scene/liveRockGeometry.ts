import * as THREE from 'three'

/** The renderer may carve inward freely, but outward knobs must stay inside the
 * collision ellipsoids' existing 1.2x padding. */
export const LIVE_ROCK_MIN_RADIUS = 0.72
export const LIVE_ROCK_MAX_RADIUS = 1.08

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
  let radius = 0.94

  for (let wave = 0; wave < 3; wave += 1) {
    seededDirection(seed, 20 + wave * 3, axis)
    const frequency = 2.7 + wave * 1.55 + unit(seed, 22 + wave * 3) * 0.7
    const phase = unit(seed, 23 + wave * 3) * Math.PI * 2
    radius += Math.sin(normal.dot(axis) * frequency + phase) * (0.052 - wave * 0.009)
  }

  // Reef rock is worn rather than crystalline. This smaller ridged term breaks up
  // smooth balloon silhouettes without producing needle-like spikes.
  seededDirection(seed, 45, axis)
  const ridge = Math.abs(Math.sin(normal.dot(axis) * 10.5 + unit(seed, 46) * Math.PI * 2))
  radius += (ridge - 0.5) * 0.035

  for (let knob = 0; knob < 5; knob += 1) {
    seededDirection(seed, 60 + knob * 2, axis)
    radius += localizedLobe(normal, axis, 0.13 + unit(seed, 61 + knob * 2) * 0.08)
      * (0.045 + unit(seed, 80 + knob) * 0.045)
  }

  for (let crevice = 0; crevice < 6; crevice += 1) {
    seededDirection(seed, 100 + crevice * 2, axis)
    radius -= localizedLobe(normal, axis, 0.08 + unit(seed, 101 + crevice * 2) * 0.09)
      * (0.055 + unit(seed, 120 + crevice) * 0.055)
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

  for (let index = 0; index < position.count; index += 3) {
    a.fromBufferAttribute(position, index)
    b.fromBufferAttribute(position, index + 1)
    c.fromBufferAttribute(position, index + 2)
    faceNormal.subVectors(c, b).cross(a.clone().sub(b))
    accumulated.get(keys[index])?.add(faceNormal)
    accumulated.get(keys[index + 1])?.add(faceNormal)
    accumulated.get(keys[index + 2])?.add(faceNormal)
  }

  keys.forEach((key, index) => {
    const averaged = accumulated.get(key)?.normalize() ?? new THREE.Vector3(0, 1, 0)
    normal.setXYZ(index, averaged.x, averaged.y, averaged.z)
  })
  geometry.setAttribute('normal', normal)
}

/** Create one deterministic, eroded live-rock hull. A per-piece hull gives the rockscape
 * genuinely different silhouettes while REEF_ROCKS remains the transform and collision
 * authority. */
export function createLiveRockGeometry(seed: number, detail = 3) {
  const geometry = new THREE.IcosahedronGeometry(1, detail)
  const position = geometry.getAttribute('position')
  const direction = new THREE.Vector3()

  for (let index = 0; index < position.count; index += 1) {
    direction.fromBufferAttribute(position, index).normalize()
    direction.multiplyScalar(liveRockRadiusAt(direction, seed))
    position.setXYZ(index, direction.x, direction.y, direction.z)
  }

  position.needsUpdate = true
  // PolyhedronGeometry duplicates vertices at UV seams. Average normals by the final
  // position so knobs read as water-worn limestone, not a low-poly crystal.
  computeErodedNormals(geometry)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
