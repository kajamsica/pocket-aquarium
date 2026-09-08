import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** The renderer may carve inward freely, but outward knobs must stay inside the
 * collision ellipsoids' existing 1.2x padding. */
export const LIVE_ROCK_MIN_RADIUS = 0.58
export const LIVE_ROCK_MAX_RADIUS = 1.17
export const LIVE_ROCK_SEED_OFFSET = 29

export interface LiveRockSurfaceSample {
  readonly position: THREE.Vector3
  readonly normal: THREE.Vector3
}

export interface LiveRockCollisionField {
  readonly surfaceClearance: (worldPoint: THREE.Vector3, outwardNormal: THREE.Vector3) => number
}

const COLLISION_FIELD_AZIMUTH_SAMPLES = 96
const COLLISION_FIELD_POLAR_SEGMENTS = 48
const COLLISION_FIELD_POLAR_SAMPLES = COLLISION_FIELD_POLAR_SEGMENTS + 1
const TWO_PI = Math.PI * 2

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

/** Sample the rendered compound hull's outer silhouette in the world XY plane.
 * This is intentionally a build-time batch for deterministic surface circuits,
 * not a per-frame raycast path. */
export function createLiveRockSurfaceContour(seed: number, position: THREE.Vector3,
  rotation: THREE.Euler, scale: THREE.Vector3, sampleCount = 128): LiveRockSurfaceSample[] {
  const count = Math.max(32, Math.floor(sampleCount / 4) * 4)
  const geometry = createLiveRockGeometry(seed)
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.copy(position)
  mesh.rotation.copy(rotation)
  mesh.scale.copy(scale)
  mesh.updateMatrixWorld(true)

  const raycaster = new THREE.Raycaster()
  const radial = new THREE.Vector3()
  const rayDirection = new THREE.Vector3()
  const rayOrigin = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
  const rayDistance = Math.max(scale.x, scale.y, scale.z) * LIVE_ROCK_MAX_RADIUS * 2 + .5
  const samples: LiveRockSurfaceSample[] = []

  try {
    for (let index = 0; index <= count; index += 1) {
      const angle = Math.PI * 1.5 - index / count * Math.PI * 2
      radial.set(Math.cos(angle), Math.sin(angle), 0)
      rayOrigin.copy(position).addScaledVector(radial, rayDistance)
      rayDirection.copy(radial).negate()
      raycaster.set(rayOrigin, rayDirection)
      const hit = raycaster.intersectObject(mesh, false)[0]
      if (!hit) throw new Error(`Unable to sample live-rock contour at ${angle}`)
      const normal = hit.normal
        ? hit.normal.clone().applyNormalMatrix(normalMatrix)
        : hit.face?.normal.clone().applyNormalMatrix(normalMatrix) ?? radial.clone()
      normal.normalize()
      if (normal.dot(radial) < 0) normal.negate()
      samples.push({ position: hit.point.clone(), normal })
    }
  } finally {
    geometry.dispose()
    material.dispose()
  }

  return samples
}

function collisionFieldRadiusAt(radii: Float32Array, x: number, y: number, z: number) {
  const length = Math.sqrt(x * x + y * y + z * z)
  if (length < 1e-8) return radii[0]

  let azimuth = Math.atan2(z, x)
  if (azimuth < 0) azimuth += TWO_PI
  const azimuthCoordinate = azimuth / TWO_PI * COLLISION_FIELD_AZIMUTH_SAMPLES
  const azimuthFloor = Math.floor(azimuthCoordinate)
  const azimuth0 = azimuthFloor % COLLISION_FIELD_AZIMUTH_SAMPLES
  const azimuth1 = (azimuth0 + 1) % COLLISION_FIELD_AZIMUTH_SAMPLES
  const azimuthBlend = azimuthCoordinate - azimuthFloor

  const polarCoordinate = Math.acos(THREE.MathUtils.clamp(y / length, -1, 1))
    / Math.PI * COLLISION_FIELD_POLAR_SEGMENTS
  const polar0 = Math.min(COLLISION_FIELD_POLAR_SEGMENTS - 1, Math.floor(polarCoordinate))
  const polar1 = polar0 + 1
  const polarBlend = polarCoordinate - polar0
  const row0 = polar0 * COLLISION_FIELD_AZIMUTH_SAMPLES
  const row1 = polar1 * COLLISION_FIELD_AZIMUTH_SAMPLES

  const radius0 = THREE.MathUtils.lerp(radii[row0 + azimuth0], radii[row0 + azimuth1],
    azimuthBlend)
  const radius1 = THREE.MathUtils.lerp(radii[row1 + azimuth0], radii[row1 + azimuth1],
    azimuthBlend)
  return THREE.MathUtils.lerp(radius0, radius1, polarBlend)
}

/** Build a compact signed-clearance field from the exact transformed render mesh.
 * Raycasting is confined to construction; runtime queries interpolate retained numbers. */
export function createLiveRockCollisionField(seed: number, position: THREE.Vector3,
  rotation: THREE.Euler, scale: THREE.Vector3): LiveRockCollisionField {
  const sampleCount = COLLISION_FIELD_AZIMUTH_SAMPLES * COLLISION_FIELD_POLAR_SAMPLES
  const radii = new Float32Array(sampleCount)
  const normals = new Float32Array(sampleCount * 3)
  const geometry = createLiveRockGeometry(seed)
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.copy(position)
  mesh.rotation.copy(rotation)
  mesh.scale.copy(scale)
  mesh.updateMatrixWorld(true)

  const raycaster = new THREE.Raycaster()
  const radial = new THREE.Vector3()
  const rayOrigin = new THREE.Vector3()
  const rayDirection = new THREE.Vector3()
  const sampledNormal = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
  const rayDistance = Math.max(scale.x, scale.y, scale.z) * LIVE_ROCK_MAX_RADIUS * 2 + .5
  const hits: THREE.Intersection[] = []

  try {
    for (let polarIndex = 0; polarIndex < COLLISION_FIELD_POLAR_SAMPLES; polarIndex += 1) {
      const polar = polarIndex / COLLISION_FIELD_POLAR_SEGMENTS * Math.PI
      const radialY = Math.cos(polar)
      const radialRadius = Math.sin(polar)
      for (let azimuthIndex = 0; azimuthIndex < COLLISION_FIELD_AZIMUTH_SAMPLES;
        azimuthIndex += 1) {
        const sampleIndex = polarIndex * COLLISION_FIELD_AZIMUTH_SAMPLES + azimuthIndex
        const azimuth = azimuthIndex / COLLISION_FIELD_AZIMUTH_SAMPLES * TWO_PI
        radial.set(Math.cos(azimuth) * radialRadius, radialY,
          Math.sin(azimuth) * radialRadius)
        rayOrigin.copy(position).addScaledVector(radial, rayDistance)
        rayDirection.copy(radial).negate()
        raycaster.set(rayOrigin, rayDirection)
        raycaster.far = rayDistance * 2
        hits.length = 0
        raycaster.intersectObject(mesh, false, hits)
        const hit = hits[0]
        if (!hit) throw new Error(`Unable to sample live-rock collision field at ${polar}, ${azimuth}`)

        radii[sampleIndex] = hit.point.distanceTo(position)
        sampledNormal.copy(hit.normal ?? hit.face?.normal ?? radial).applyNormalMatrix(normalMatrix)
        if (sampledNormal.dot(radial) < 0) sampledNormal.negate()
        sampledNormal.normalize()
        normals[sampleIndex * 3] = sampledNormal.x
        normals[sampleIndex * 3 + 1] = sampledNormal.y
        normals[sampleIndex * 3 + 2] = sampledNormal.z
      }
    }

    // Splat exact vertices plus face interiors only into their neighboring angular
    // samples. This encloses narrow knobs without restoring a coarse global envelope
    // around visible cavities.
    const positions = geometry.getAttribute('position')
    const surfaceNormals = geometry.getAttribute('normal')
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const sample = new THREE.Vector3()
    const normalA = new THREE.Vector3()
    const normalB = new THREE.Vector3()
    const normalC = new THREE.Vector3()
    const sampleNormal = new THREE.Vector3()
    const includeSample = (point: THREE.Vector3, outward: THREE.Vector3) => {
      const x = point.x - position.x
      const y = point.y - position.y
      const z = point.z - position.z
      const length = Math.sqrt(x * x + y * y + z * z)
      let azimuth = Math.atan2(z, x)
      if (azimuth < 0) azimuth += TWO_PI
      const azimuthCoordinate = azimuth / TWO_PI * COLLISION_FIELD_AZIMUTH_SAMPLES
      const azimuthFloor = Math.floor(azimuthCoordinate)
      const azimuth0 = azimuthFloor % COLLISION_FIELD_AZIMUTH_SAMPLES
      const azimuth1 = (azimuth0 + 1) % COLLISION_FIELD_AZIMUTH_SAMPLES
      const polarCoordinate = Math.acos(THREE.MathUtils.clamp(y / length, -1, 1))
        / Math.PI * COLLISION_FIELD_POLAR_SEGMENTS
      const polar0 = Math.min(COLLISION_FIELD_POLAR_SEGMENTS - 1,
        Math.floor(polarCoordinate))
      const polar1 = polar0 + 1
      const candidateRadius = length + 1e-5
      if (outward.x * x + outward.y * y + outward.z * z < 0) outward.negate()
      const neighborIndices = [
        polar0 * COLLISION_FIELD_AZIMUTH_SAMPLES + azimuth0,
        polar0 * COLLISION_FIELD_AZIMUTH_SAMPLES + azimuth1,
        polar1 * COLLISION_FIELD_AZIMUTH_SAMPLES + azimuth0,
        polar1 * COLLISION_FIELD_AZIMUTH_SAMPLES + azimuth1,
      ]
      for (const neighborIndex of neighborIndices) {
        if (radii[neighborIndex] >= candidateRadius) continue
        radii[neighborIndex] = candidateRadius
        normals[neighborIndex * 3] = outward.x
        normals[neighborIndex * 3 + 1] = outward.y
        normals[neighborIndex * 3 + 2] = outward.z
      }
    }
    for (let index = 0; index < positions.count; index += 3) {
      a.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld)
      b.fromBufferAttribute(positions, index + 1).applyMatrix4(mesh.matrixWorld)
      c.fromBufferAttribute(positions, index + 2).applyMatrix4(mesh.matrixWorld)
      normalA.fromBufferAttribute(surfaceNormals, index).applyNormalMatrix(normalMatrix)
      normalB.fromBufferAttribute(surfaceNormals, index + 1).applyNormalMatrix(normalMatrix)
      normalC.fromBufferAttribute(surfaceNormals, index + 2).applyNormalMatrix(normalMatrix)
      includeSample(a, normalA)
      includeSample(b, normalB)
      includeSample(c, normalC)
      includeSample(sample.copy(a).add(b).multiplyScalar(.5),
        sampleNormal.copy(normalA).add(normalB).normalize())
      includeSample(sample.copy(b).add(c).multiplyScalar(.5),
        sampleNormal.copy(normalB).add(normalC).normalize())
      includeSample(sample.copy(c).add(a).multiplyScalar(.5),
        sampleNormal.copy(normalC).add(normalA).normalize())
      includeSample(sample.copy(a).add(b).add(c).multiplyScalar(1 / 3),
        sampleNormal.copy(normalA).add(normalB).add(normalC).normalize())
    }
    for (const poleRow of [0, COLLISION_FIELD_POLAR_SEGMENTS]) {
      const start = poleRow * COLLISION_FIELD_AZIMUTH_SAMPLES
      let poleRadius = 0
      for (let index = start; index < start + COLLISION_FIELD_AZIMUTH_SAMPLES; index += 1) {
        poleRadius = Math.max(poleRadius, radii[index])
      }
      for (let index = start; index < start + COLLISION_FIELD_AZIMUTH_SAMPLES; index += 1) {
        radii[index] = poleRadius
      }
    }
  } finally {
    geometry.dispose()
    material.dispose()
  }

  const centerX = position.x
  const centerY = position.y
  const centerZ = position.z
  return {
    surfaceClearance(worldPoint, outwardNormal) {
      const x = worldPoint.x - centerX
      const y = worldPoint.y - centerY
      const z = worldPoint.z - centerZ
      const distance = Math.sqrt(x * x + y * y + z * z)
      if (distance < 1e-8) {
        outwardNormal.set(0, 1, 0)
        return -radii[0]
      }

      let azimuth = Math.atan2(z, x)
      if (azimuth < 0) azimuth += TWO_PI
      const azimuthCoordinate = azimuth / TWO_PI * COLLISION_FIELD_AZIMUTH_SAMPLES
      const azimuthFloor = Math.floor(azimuthCoordinate)
      const azimuth0 = azimuthFloor % COLLISION_FIELD_AZIMUTH_SAMPLES
      const azimuth1 = (azimuth0 + 1) % COLLISION_FIELD_AZIMUTH_SAMPLES
      const azimuthBlend = azimuthCoordinate - azimuthFloor
      const polarCoordinate = Math.acos(THREE.MathUtils.clamp(y / distance, -1, 1))
        / Math.PI * COLLISION_FIELD_POLAR_SEGMENTS
      const polar0 = Math.min(COLLISION_FIELD_POLAR_SEGMENTS - 1, Math.floor(polarCoordinate))
      const polar1 = polar0 + 1
      const polarBlend = polarCoordinate - polar0
      const row0 = polar0 * COLLISION_FIELD_AZIMUTH_SAMPLES
      const row1 = polar1 * COLLISION_FIELD_AZIMUTH_SAMPLES
      const index00 = row0 + azimuth0
      const index01 = row0 + azimuth1
      const index10 = row1 + azimuth0
      const index11 = row1 + azimuth1
      const weight00 = (1 - azimuthBlend) * (1 - polarBlend)
      const weight01 = azimuthBlend * (1 - polarBlend)
      const weight10 = (1 - azimuthBlend) * polarBlend
      const weight11 = azimuthBlend * polarBlend

      outwardNormal.set(
        normals[index00 * 3] * weight00 + normals[index01 * 3] * weight01
          + normals[index10 * 3] * weight10 + normals[index11 * 3] * weight11,
        normals[index00 * 3 + 1] * weight00 + normals[index01 * 3 + 1] * weight01
          + normals[index10 * 3 + 1] * weight10 + normals[index11 * 3 + 1] * weight11,
        normals[index00 * 3 + 2] * weight00 + normals[index01 * 3 + 2] * weight01
          + normals[index10 * 3 + 2] * weight10 + normals[index11 * 3 + 2] * weight11,
      )
      if (outwardNormal.lengthSq() < 1e-8) outwardNormal.set(x, y, z)
      outwardNormal.normalize()
      const radialX = x / distance
      const radialY = y / distance
      const radialZ = z / distance
      if (outwardNormal.x * radialX + outwardNormal.y * radialY
        + outwardNormal.z * radialZ < 0) outwardNormal.negate()
      const normalAlignment = Math.max(.2, outwardNormal.x * radialX
        + outwardNormal.y * radialY + outwardNormal.z * radialZ)
      return (distance - collisionFieldRadiusAt(radii, x, y, z)) * normalAlignment
    },
  }
}
