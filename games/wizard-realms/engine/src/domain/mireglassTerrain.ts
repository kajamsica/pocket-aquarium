/** Authored, smoothly blended ground forms for the first streamed content revision. */
export const MIREGLASS_CONTENT_REVISION = 'mireglass-reach-v1' as const
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
const toward = (value: number, target: number, weight: number) => value + (target - value) * weight

/** A one-revision terrain layer. It never touches the preserved Greenway cells. */
export function mireglassTerrainAt(x: number, z: number, climate: { elevation: number; temperature: number; moisture: number }) {
  let { elevation, temperature, moisture } = climate
  const alder = weightAt(x, z, MIREGLASS_ENVELOPES.bellAlder)
  moisture = toward(moisture, Math.max(moisture, 0.80), alder)
  elevation = toward(elevation, Math.min(elevation, 0.45), alder)

  const channel = weightAt(x, z, MIREGLASS_ENVELOPES.fenChannel)
  moisture = toward(moisture, Math.max(moisture, 0.86), channel)
  elevation = toward(elevation, Math.min(elevation, 0.28), channel)

  const outpost = weightAt(x, z, MIREGLASS_ENVELOPES.salvager)
  moisture = toward(moisture, Math.min(moisture, 0.52), outpost)
  elevation = toward(elevation, 0.50, outpost)

  const berm = weightAt(x, z, MIREGLASS_ENVELOPES.slateBerm)
  moisture = toward(moisture, Math.min(moisture, 0.38), berm)
  elevation = toward(elevation, Math.max(elevation, 0.72), berm)

  const cache = weightAt(x, z, MIREGLASS_ENVELOPES.sealCache)
  moisture = toward(moisture, Math.min(moisture, 0.50), cache)
  elevation = toward(elevation, 0.48, cache)

  return { elevation: clamp01(elevation), temperature: clamp01(temperature), moisture: clamp01(moisture) }
}
