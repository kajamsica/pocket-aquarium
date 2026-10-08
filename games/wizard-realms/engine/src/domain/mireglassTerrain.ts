import { hashSeed } from './generation'

/** Authored ground forms for the first streamed region. */
export const MIREGLASS_CONTENT_REVISION = 'mireglass-reach-v2' as const
export const MIREGLASS_CORE = Object.freeze({ minX: -448, maxX: -256, minZ: 256, maxZ: 512 })

export interface TerrainEnvelope { minX: number; maxX: number; minZ: number; maxZ: number }

export const MIREGLASS_ENVELOPES = Object.freeze({
  fringeMarker: { minX: -112, maxX: -80, minZ: 80, maxZ: 112 },
  salvager: { minX: -304, maxX: -272, minZ: 272, maxZ: 304 },
  bellAlder: { minX: -400, maxX: -336, minZ: 320, maxZ: 352 },
  fenChannel: { minX: -392, maxX: -320, minZ: 352, maxZ: 376 },
  slateBerm: { minX: -432, maxX: -368, minZ: 416, maxZ: 448 },
  sealCache: { minX: -432, maxX: -400, minZ: 464, maxZ: 496 },
} satisfies Record<string, TerrainEnvelope>)

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const smoothstep = (value: number) => {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}
const weightAt = (x: number, z: number, envelope: TerrainEnvelope) =>
  smoothstep((x - envelope.minX) / 8) * smoothstep((envelope.maxX - x) / 8)
  * smoothstep((z - envelope.minZ) / 8) * smoothstep((envelope.maxZ - z) / 8)
const lateralWeightAt = (x: number, envelope: TerrainEnvelope, margin = 8) =>
  smoothstep((x - envelope.minX + margin) / margin) * smoothstep((envelope.maxX + margin - x) / margin)
const toward = (value: number, target: number, weight: number) => value + (target - value) * weight

const rowAt = (seed: string, x: number, centerZ: number, name: string) => {
  const phase = hashSeed(`${seed || 'wizard-realms'}:${MIREGLASS_CONTENT_REVISION}:${name}`) / 4294967296 * Math.PI * 2
  return centerZ + 4 * Math.round(Math.sin((x - MIREGLASS_CORE.minX) / 12 + phase))
}

export const mireglassFenRowAt = (seed: string, x: number) => rowAt(seed, x, 364, 'fen-row')
export const mireglassBermFaceRowAt = (seed: string, x: number) => rowAt(seed, x, 432, 'berm-face-row')

/** A one-revision terrain layer. It never touches the preserved Greenway cells. */
export function mireglassTerrainAt(seed: string, x: number, z: number, climate: { elevation: number; temperature: number; moisture: number }) {
  let { elevation, temperature, moisture } = climate
  const alder = weightAt(x, z, MIREGLASS_ENVELOPES.bellAlder)
  moisture = toward(moisture, Math.max(moisture, 0.80), alder)
  elevation = toward(elevation, Math.min(elevation, 0.45), alder)

  const fen = MIREGLASS_ENVELOPES.fenChannel
  if (x >= MIREGLASS_CORE.minX - 8 && x <= MIREGLASS_CORE.maxX + 8 && z >= fen.minZ - 16 && z <= fen.maxZ + 16) {
    const distance = Math.abs(z - mireglassFenRowAt(seed, x))
    const channel = lateralWeightAt(x, MIREGLASS_CORE) * smoothstep((24 - distance) / 8)
    moisture = toward(moisture, distance === 0 ? Math.max(moisture, 0.88) : Math.min(moisture, 0.54), channel)
    elevation = toward(elevation, distance === 0 ? Math.min(elevation, 0.30) : 0.40, channel)
  }

  const outpost = weightAt(x, z, MIREGLASS_ENVELOPES.salvager)
  moisture = toward(moisture, Math.min(moisture, 0.52), outpost)
  elevation = toward(elevation, 0.50, outpost)

  const berm = MIREGLASS_ENVELOPES.slateBerm
  if (x >= berm.minX - 12 && x <= berm.maxX + 12 && z >= berm.minZ && z <= berm.maxZ) {
    const offset = z - mireglassBermFaceRowAt(seed, x)
    if (offset >= -12 && offset <= 12) {
      const weight = lateralWeightAt(x, berm, 12)
      elevation = toward(elevation, offset < 0 ? 0.22 - offset * 0.015 : 0.80 - offset * 0.03, weight)
      moisture = toward(moisture, offset < 0 ? 0.54 : offset <= 4 ? 0.34 : 0.58, weight)
    }
  }

  const cache = weightAt(x, z, MIREGLASS_ENVELOPES.sealCache)
  moisture = toward(moisture, Math.min(moisture, 0.50), cache)
  elevation = toward(elevation, 0.48, cache)

  return { elevation: clamp01(elevation), temperature: clamp01(temperature), moisture: clamp01(moisture) }
}
