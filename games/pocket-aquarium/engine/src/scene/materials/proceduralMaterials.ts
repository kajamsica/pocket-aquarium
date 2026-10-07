import * as THREE from 'three'

export type ProceduralMaterialKind = 'reef-rock' | 'aragonite-sand' | 'coral-tissue'

export interface ProceduralMaterialOptions {
  readonly seed?: number
  readonly size?: number
}

export interface ProceduralMaterialFields {
  readonly size: number
  readonly albedo: Float32Array
  readonly normal: Float32Array
  readonly roughness: Float32Array
  readonly fluorescence: Float32Array | null
}

export interface ProceduralMaterialTextures {
  readonly albedoMap: THREE.DataTexture
  readonly normalMap: THREE.DataTexture
  readonly roughnessMap: THREE.DataTexture
  readonly emissiveMap: THREE.DataTexture | null
  readonly dispose: () => void
}

export const PROCEDURAL_TEXTURE_SIZE = { minimum: 16, default: 128, maximum: 256 } as const

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount
const fade = (value: number) => value * value * (3 - 2 * value)
const wrap = (value: number, period: number) => ((value % period) + period) % period

function hash2(x: number, y: number, seed: number) {
  let hash = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041)
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177)
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295
}

function periodicNoise(u: number, v: number, cells: number, seed: number) {
  const px = u * cells
  const py = v * cells
  const x = Math.floor(px)
  const y = Math.floor(py)
  const tx = fade(px - x)
  const ty = fade(py - y)
  const a = hash2(wrap(x, cells), wrap(y, cells), seed)
  const b = hash2(wrap(x + 1, cells), wrap(y, cells), seed)
  const c = hash2(wrap(x, cells), wrap(y + 1, cells), seed)
  const d = hash2(wrap(x + 1, cells), wrap(y + 1, cells), seed)
  return mix(mix(a, b, tx), mix(c, d, tx), ty)
}

function fractalNoise(u: number, v: number, seed: number, frequencies: readonly number[]) {
  let value = 0
  let weight = 0.56
  let totalWeight = 0
  for (let octave = 0; octave < frequencies.length; octave += 1) {
    value += periodicNoise(u, v, frequencies[octave], seed + octave * 101) * weight
    totalWeight += weight
    weight *= 0.52
  }
  return value / totalWeight
}

function periodicCellDistance(u: number, v: number, cells: number, seed: number) {
  const px = u * cells
  const py = v * cells
  const cellX = Math.floor(px)
  const cellY = Math.floor(py)
  let nearest = 2
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const x = cellX + offsetX
      const y = cellY + offsetY
      const wrappedX = wrap(x, cells)
      const wrappedY = wrap(y, cells)
      const dx = x + hash2(wrappedX, wrappedY, seed) - px
      const dy = y + hash2(wrappedX, wrappedY, seed + 47) - py
      nearest = Math.min(nearest, Math.hypot(dx, dy))
    }
  }
  return clamp01(nearest / Math.SQRT2)
}

function textureSize(requested: number = PROCEDURAL_TEXTURE_SIZE.default) {
  const finite = Number.isFinite(requested) ? Math.round(requested) : PROCEDURAL_TEXTURE_SIZE.default
  return Math.min(PROCEDURAL_TEXTURE_SIZE.maximum, Math.max(PROCEDURAL_TEXTURE_SIZE.minimum, finite))
}

function setRgb(target: Float32Array, pixel: number, red: number, green: number, blue: number) {
  const offset = pixel * 3
  target[offset] = clamp01(red)
  target[offset + 1] = clamp01(green)
  target[offset + 2] = clamp01(blue)
}

export function synthesizeProceduralMaterialFields(
  kind: ProceduralMaterialKind,
  options: ProceduralMaterialOptions = {},
): ProceduralMaterialFields {
  const size = textureSize(options.size)
  const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed as number) : 1
  const pixels = size * size
  const albedo = new Float32Array(pixels * 3)
  const height = new Float32Array(pixels)
  const normal = new Float32Array(pixels * 3)
  const roughness = new Float32Array(pixels)
  const fluorescence = kind === 'aragonite-sand' ? null : new Float32Array(pixels * 3)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const pixel = y * size + x
      const u = x / size
      const v = y / size
      const broad = fractalNoise(u, v, seed, [3, 7, 15, 31])
      const fine = fractalNoise(u, v, seed + 701, [11, 23, 47])

      if (kind === 'reef-rock') {
        const pore = clamp01((0.29 - periodicCellDistance(u, v, 11, seed + 211)) * 4.2)
        const encrusting = clamp01((fractalNoise(u, v, seed + 991, [5, 13, 29]) - 0.63) * 5.2)
        height[pixel] = clamp01(0.3 + broad * 0.62 - pore * 0.42 + fine * 0.08)
        roughness[pixel] = clamp01(0.7 + fine * 0.25 - pore * 0.13)
        setRgb(albedo, pixel, 0.28 + broad * 0.27 + encrusting * 0.18, 0.27 + broad * 0.23, 0.24 + broad * 0.2 + encrusting * 0.14)
        if (fluorescence) setRgb(fluorescence, pixel, encrusting * 0.28, encrusting * 0.04, encrusting * 0.34)
      } else if (kind === 'aragonite-sand') {
        const grain = 1 - periodicCellDistance(u, v, 37, seed + 313)
        height[pixel] = clamp01(0.28 + grain * 0.54 + fine * 0.18)
        roughness[pixel] = clamp01(0.78 + grain * 0.17 - broad * 0.05)
        setRgb(albedo, pixel, 0.68 + grain * 0.25, 0.62 + grain * 0.25, 0.48 + grain * 0.27)
      } else {
        const polyp = clamp01((0.32 - periodicCellDistance(u, v, 8, seed + 419)) * 4.8)
        const ridge = 0.5 + 0.5 * Math.sin((u * 9 + v * 5 + broad * 1.8) * Math.PI * 2)
        height[pixel] = clamp01(0.32 + broad * 0.28 + ridge * 0.14 + polyp * 0.35)
        roughness[pixel] = clamp01(0.42 + fine * 0.24 - polyp * 0.12)
        setRgb(albedo, pixel, 0.42 + broad * 0.27 + polyp * 0.18, 0.12 + broad * 0.13, 0.28 + broad * 0.28 + polyp * 0.12)
        if (fluorescence) setRgb(fluorescence, pixel, polyp * 0.82 + ridge * 0.06, polyp * 0.12, polyp * 0.54 + broad * 0.08)
      }
    }
  }

  const normalStrength = kind === 'aragonite-sand' ? 2.4 : kind === 'reef-rock' ? 3.2 : 1.8
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const pixel = y * size + x
      const dx = height[y * size + wrap(x + 1, size)] - height[y * size + wrap(x - 1, size)]
      const dy = height[wrap(y + 1, size) * size + x] - height[wrap(y - 1, size) * size + x]
      const inverseLength = 1 / Math.hypot(dx * normalStrength, dy * normalStrength, 1)
      setRgb(normal, pixel, 0.5 - dx * normalStrength * inverseLength * 0.5, 0.5 - dy * normalStrength * inverseLength * 0.5, 0.5 + inverseLength * 0.5)
    }
  }

  return { size, albedo, normal, roughness, fluorescence }
}

function dataTexture(values: Float32Array, channels: 1 | 3, size: number, colorSpace: THREE.ColorSpace, name: string) {
  const data = new Uint8Array(size * size * 4)
  for (let pixel = 0; pixel < size * size; pixel += 1) {
    const source = pixel * channels
    const target = pixel * 4
    data[target] = Math.round(clamp01(values[source]) * 255)
    data[target + 1] = Math.round(clamp01(values[source + (channels === 3 ? 1 : 0)]) * 255)
    data[target + 2] = Math.round(clamp01(values[source + (channels === 3 ? 2 : 0)]) * 255)
    data[target + 3] = 255
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.name = name
  texture.colorSpace = colorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

export function createProceduralMaterialTextures(
  kind: ProceduralMaterialKind,
  options: ProceduralMaterialOptions = {},
): ProceduralMaterialTextures {
  const fields = synthesizeProceduralMaterialFields(kind, options)
  const prefix = `reef-room:${kind}`
  const albedoMap = dataTexture(fields.albedo, 3, fields.size, THREE.SRGBColorSpace, `${prefix}:albedo`)
  const normalMap = dataTexture(fields.normal, 3, fields.size, THREE.NoColorSpace, `${prefix}:normal`)
  const roughnessMap = dataTexture(fields.roughness, 1, fields.size, THREE.NoColorSpace, `${prefix}:roughness`)
  const emissiveMap = fields.fluorescence
    ? dataTexture(fields.fluorescence, 3, fields.size, THREE.SRGBColorSpace, `${prefix}:fluorescence`)
    : null
  let disposed = false
  return {
    albedoMap,
    normalMap,
    roughnessMap,
    emissiveMap,
    dispose: () => {
      if (disposed) return
      disposed = true
      albedoMap.dispose()
      normalMap.dispose()
      roughnessMap.dispose()
      emissiveMap?.dispose()
    },
  }
}
