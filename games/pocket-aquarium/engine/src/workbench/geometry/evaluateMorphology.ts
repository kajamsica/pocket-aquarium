import * as THREE from 'three'

import type { MorphologyProfileV1 } from '../../specimens/specimenProfile'

export interface GeometryDigest {
  readonly value: string
  readonly vertices: number
  readonly indices: number
  readonly triangles: number
}

export interface EvaluatedMorphology {
  readonly geometry: THREE.BufferGeometry
  readonly digest: GeometryDigest
}

function interpolate(profile: MorphologyProfileV1, x: number) {
  const stations = profile.controlStations
  if (x <= stations[0].x) return stations[0]
  if (x >= stations[stations.length - 1].x) return stations[stations.length - 1]
  const rightIndex = stations.findIndex((station) => station.x >= x)
  const left = stations[rightIndex - 1]
  const right = stations[rightIndex]
  const t = (x - left.x) / (right.x - left.x)
  return {
    x,
    dorsalHeight: THREE.MathUtils.lerp(left.dorsalHeight, right.dorsalHeight, t),
    ventralDepth: THREE.MathUtils.lerp(left.ventralDepth, right.ventralDepth, t),
    halfWidth: THREE.MathUtils.lerp(left.halfWidth, right.halfWidth, t),
    centerY: THREE.MathUtils.lerp(left.centerY, right.centerY, t),
    centerZ: THREE.MathUtils.lerp(left.centerZ, right.centerZ, t),
  }
}

function hash(values: Iterable<number>) {
  let result = 0x811c9dc5
  for (const value of values) result = Math.imul(result ^ value, 0x01000193)
  return (result >>> 0).toString(16).padStart(8, '0')
}

export function evaluateMorphology(profile: MorphologyProfileV1): EvaluatedMorphology {
  const segments = profile.sampling.ringSampleCount
  const power = 2 / profile.sampling.crossSectionExponent
  const positions: number[] = []
  const indices: number[] = []
  const sections = profile.sampling.ringPositions.map((x) => interpolate(profile, x))
  for (const section of sections) {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = segment / segments * Math.PI * 2
      const side = Math.sin(angle)
      const vertical = Math.cos(angle)
      const signedPower = (value: number) => Math.sign(value) * Math.abs(value) ** power
      positions.push(section.x, section.centerY + signedPower(side) * section.halfWidth,
        section.centerZ + signedPower(vertical) * (vertical >= 0 ? section.dorsalHeight : section.ventralDepth))
    }
  }
  for (let ring = 0; ring < sections.length - 1; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments
      const a = ring * segments + segment
      const b = ring * segments + next
      const c = (ring + 1) * segments + segment
      const d = (ring + 1) * segments + next
      indices.push(a, c, d, a, d, b)
    }
  }
  const tailCenter = positions.length / 3
  positions.push(sections[0].x, sections[0].centerY, sections[0].centerZ)
  const headCenter = positions.length / 3
  positions.push(sections.at(-1)!.x, sections.at(-1)!.centerY, sections.at(-1)!.centerZ)
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments
    indices.push(tailCenter, next, segment)
    const head = (sections.length - 1) * segments
    indices.push(headCenter, head + segment, head + next)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const quantized = positions.map((value) => Math.round(value * 1e9)).concat(indices)
  const vertices = positions.length / 3
  return { geometry, digest: { value: hash(quantized), vertices, indices: indices.length, triangles: indices.length / 3 } }
}
