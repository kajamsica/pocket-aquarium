import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import {
  PROCEDURAL_TEXTURE_SIZE,
  createProceduralMaterialTextures,
  synthesizeProceduralMaterialFields,
  type ProceduralMaterialKind,
} from './proceduralMaterials'

const kinds: ProceduralMaterialKind[] = ['reef-rock', 'aragonite-sand', 'coral-tissue']

function spatialRange(values: Float32Array, channels = 1) {
  let minimum = Infinity
  let maximum = -Infinity
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (index % channels === 0) {
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
    }
    expect(Number.isFinite(value)).toBe(true)
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(1)
  }
  return maximum - minimum
}

describe('procedural reef material fields', () => {
  it('is deterministic for a seed and changes for a different seed', () => {
    const first = synthesizeProceduralMaterialFields('reef-rock', { seed: 73, size: 32 })
    const repeated = synthesizeProceduralMaterialFields('reef-rock', { seed: 73, size: 32 })
    const changed = synthesizeProceduralMaterialFields('reef-rock', { seed: 74, size: 32 })

    expect(repeated.albedo).toEqual(first.albedo)
    expect(repeated.normal).toEqual(first.normal)
    expect(repeated.roughness).toEqual(first.roughness)
    expect(changed.albedo).not.toEqual(first.albedo)
  })

  it.each(kinds)('keeps %s fields bounded with measurable spatial variance', (kind) => {
    const fields = synthesizeProceduralMaterialFields(kind, { seed: 19, size: 32 })

    expect(fields.size).toBe(32)
    expect(fields.albedo).toHaveLength(32 * 32 * 3)
    expect(fields.normal).toHaveLength(32 * 32 * 3)
    expect(fields.roughness).toHaveLength(32 * 32)
    expect(spatialRange(fields.albedo, 3)).toBeGreaterThan(0.02)
    expect(spatialRange(fields.normal, 3)).toBeGreaterThan(0.02)
    expect(spatialRange(fields.roughness)).toBeGreaterThan(0.02)
    if (kind === 'aragonite-sand') expect(fields.fluorescence).toBeNull()
    else expect(spatialRange(fields.fluorescence as Float32Array, 3)).toBeGreaterThan(0.02)
  })

  it('bounds requested resolution without requiring a canvas', () => {
    expect(synthesizeProceduralMaterialFields('aragonite-sand', { size: 2 }).size).toBe(
      PROCEDURAL_TEXTURE_SIZE.minimum,
    )
    expect(synthesizeProceduralMaterialFields('aragonite-sand', { size: 999 }).size).toBe(
      PROCEDURAL_TEXTURE_SIZE.maximum,
    )
    expect(typeof document).toBe('undefined')
  })
})

describe('procedural reef material textures', () => {
  it('constructs repeatable color-correct maps and disposes each exactly once', () => {
    const maps = createProceduralMaterialTextures('coral-tissue', { seed: 5, size: 24 })
    const textures = [maps.albedoMap, maps.normalMap, maps.roughnessMap, maps.emissiveMap as THREE.DataTexture]
    const disposal = textures.map((texture) => vi.spyOn(texture, 'dispose'))

    expect(textures.every((texture) => texture.isDataTexture)).toBe(true)
    expect(textures.every((texture) => texture.image.width === 24 && texture.image.height === 24)).toBe(true)
    expect(textures.every((texture) => texture.wrapS === THREE.RepeatWrapping && texture.wrapT === THREE.RepeatWrapping)).toBe(true)
    expect(maps.albedoMap.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(maps.emissiveMap?.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(maps.normalMap.colorSpace).toBe(THREE.NoColorSpace)
    expect(maps.roughnessMap.colorSpace).toBe(THREE.NoColorSpace)

    maps.dispose()
    maps.dispose()
    for (const dispose of disposal) expect(dispose).toHaveBeenCalledTimes(1)
  })
})
