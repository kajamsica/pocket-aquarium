import { hashSeed } from './generation'

/** Authored ground forms for the first streamed region. V3 closes both route bypasses. */
export const MIREGLASS_CONTENT_REVISION = 'mireglass-reach-v3' as const
export const MIREGLASS_CORE = Object.freeze({ minX: -448, maxX: -256, minZ: 256, maxZ: 512 })
export const MIREGLASS_FEN_BACK = 508
export const MIREGLASS_PLATEAU = Object.freeze({ minX: -440, maxX: -360, maxZ: 504 })

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

/** The shallow meander joins deep side channels and a deep back channel on the 4 m grid. */
export function mireglassFenDepthAt(seed: string, x: number, z: number): 'shallow' | 'deep' | null {
  if (x % 4 !== 0 || z % 4 !== 0 || x < MIREGLASS_CORE.minX || x > MIREGLASS_CORE.maxX) return null
  const row = mireglassFenRowAt(seed, x)
  if (z >= MIREGLASS_FEN_BACK && z <= MIREGLASS_FEN_BACK + 8) return 'deep'
  if ((x === MIREGLASS_CORE.minX || x === MIREGLASS_CORE.maxX) && z >= row && z < MIREGLASS_FEN_BACK) return 'deep'
  // Join each 4 m bend orthogonally; a diagonal-only meander leaves a walkable corner.
  if (z === row || (x > MIREGLASS_CORE.minX && z === mireglassFenRowAt(seed, x - 4))) return 'shallow'
  return null
}

/** The cache sits on the elevated floor; every exposed dry edge is a rocky rim. */
export function mireglassPlateauAt(seed: string, x: number, z: number): 'rim' | 'interior' | null {
  if (x % 4 !== 0 || z % 4 !== 0 || x < MIREGLASS_PLATEAU.minX || x > MIREGLASS_PLATEAU.maxX
    || z < mireglassBermFaceRowAt(seed, x) || z > MIREGLASS_PLATEAU.maxZ) return null
  return x === MIREGLASS_PLATEAU.minX || x === MIREGLASS_PLATEAU.maxX
    || z <= mireglassBermFaceRowAt(seed, x) + 4 || z === MIREGLASS_PLATEAU.maxZ ? 'rim' : 'interior'
}

/** A cardinal seam where the authored high floor meets its lower surroundings. */
export function mireglassPlateauCliffBetween(seed: string, x: number, z: number, nextX: number, nextZ: number): boolean {
  if (Math.abs(nextX - x) + Math.abs(nextZ - z) !== 4) return false
  return (mireglassPlateauAt(seed, x, z) !== null) !== (mireglassPlateauAt(seed, nextX, nextZ) !== null)
}

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

  // The far basin remains traversable between the ring and the plateau.
  if (x > MIREGLASS_CORE.minX && x < MIREGLASS_CORE.maxX
    && z >= mireglassFenRowAt(seed, x) + 4 && z < MIREGLASS_FEN_BACK) {
    elevation = 0.40
    moisture = 0.54
  }

  // Dry banks make the deep sides and back visible as a bounded channel.
  const sideBank = (x === MIREGLASS_CORE.minX - 4 || x === MIREGLASS_CORE.minX + 4
    || x === MIREGLASS_CORE.maxX - 4 || x === MIREGLASS_CORE.maxX + 4)
    && z >= 380 && z <= MIREGLASS_FEN_BACK + 8
  const backBank = (z === MIREGLASS_FEN_BACK - 4 || z === MIREGLASS_FEN_BACK + 12)
    && x >= MIREGLASS_CORE.minX && x <= MIREGLASS_CORE.maxX
  if (sideBank || backBank) {
    elevation = 0.40
    moisture = 0.54
  }

  const outpost = weightAt(x, z, MIREGLASS_ENVELOPES.salvager)
  moisture = toward(moisture, Math.min(moisture, 0.52), outpost)
  elevation = toward(elevation, 0.50, outpost)

  const plateau = mireglassPlateauAt(seed, x, z)
  if (plateau) {
    elevation = 0.80
    moisture = plateau === 'rim' ? 0.34 : 0.50
  } else if (x >= MIREGLASS_PLATEAU.minX && x <= MIREGLASS_PLATEAU.maxX) {
    const offset = z - mireglassBermFaceRowAt(seed, x)
    if (offset === -4 || offset === -8) {
      elevation = offset === -4 ? 0.28 : 0.34
      moisture = 0.54
    }
  } else if ((x === MIREGLASS_PLATEAU.minX - 4 || x === MIREGLASS_PLATEAU.maxX + 4)
    && z >= mireglassBermFaceRowAt(seed, x === MIREGLASS_PLATEAU.minX - 4
      ? MIREGLASS_PLATEAU.minX : MIREGLASS_PLATEAU.maxX) && z <= MIREGLASS_PLATEAU.maxZ) {
    elevation = 0.28
    moisture = 0.54
  }

  const fenDepth = mireglassFenDepthAt(seed, x, z)
  if (fenDepth) {
    elevation = fenDepth === 'deep' ? 0.18 : 0.30
    moisture = 0.90
  }

  return { elevation: clamp01(elevation), temperature: clamp01(temperature), moisture: clamp01(moisture) }
}
