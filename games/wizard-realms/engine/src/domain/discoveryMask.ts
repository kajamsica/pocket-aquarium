import { WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

const GRID_WIDTH = WORLD_GRID_MAX - WORLD_GRID_MIN + 1

export const DISCOVERY_MASK_BYTES = GRID_WIDTH ** 2 / 8
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)
const typedArrayLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype, 'length')!.get!
const typedArrayBrand = Object.getOwnPropertyDescriptor(
  typedArrayPrototype, Symbol.toStringTag)!.get!

function canonicalTileBitIndex(id: unknown): number | null {
  if (typeof id !== 'string') return null
  const match = /^tile-(-?\d+)-(-?\d+)$/.exec(id)
  if (!match) return null
  const idX = Number(match[1])
  const idZ = Number(match[2])
  const gx = idX - 3
  const gz = idZ - 3
  if (!Number.isSafeInteger(idX) || !Number.isSafeInteger(idZ)
    || id !== `tile-${idX}-${idZ}`
    || gx < WORLD_GRID_MIN || gx > WORLD_GRID_MAX
    || gz < WORLD_GRID_MIN || gz > WORLD_GRID_MAX) return null
  return (gz - WORLD_GRID_MIN) * GRID_WIDTH + (gx - WORLD_GRID_MIN)
}

/** A typed mask has exactly one bit for every tile in the fixed world grid. */
export function isValidDiscoveryMask(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Object.getPrototypeOf(value) === Uint8Array.prototype
    && typedArrayBrand.call(value) === 'Uint8Array'
    && typedArrayLength.call(value) === DISCOVERY_MASK_BYTES
}

/** Invalid masks and noncanonical or out-of-grid IDs never prove discovery. */
export function discoveryMaskHasTileId(mask: unknown, id: unknown): boolean {
  if (!isValidDiscoveryMask(mask)) return false
  const bitIndex = canonicalTileBitIndex(id)
  return bitIndex !== null && (mask[bitIndex >> 3] & (1 << (bitIndex & 7))) !== 0
}

/** Tests inclusion directly on mask bytes, without constructing tile IDs. */
export function isDiscoveryMaskSubset(subset: unknown, superset: unknown): boolean {
  if (!isValidDiscoveryMask(subset) || !isValidDiscoveryMask(superset)) return false
  for (let index = 0; index < DISCOVERY_MASK_BYTES; index++) {
    if ((subset[index] & ~superset[index]) !== 0) return false
  }
  return true
}

export function encodeDiscoveredTileIds(ids: readonly string[]): Uint8Array {
  const mask = new Uint8Array(DISCOVERY_MASK_BYTES)
  let previousId: string | null = null
  for (const id of ids) {
    const bitIndex = canonicalTileBitIndex(id)
    if (bitIndex === null) throw new RangeError('Invalid discovered tile ID.')
    if (previousId !== null && id <= previousId) {
      throw new RangeError('Discovered tile IDs must be sorted and unique.')
    }
    mask[bitIndex >> 3] |= 1 << (bitIndex & 7)
    previousId = id
  }
  return mask
}

export function decodeDiscoveredTileIds(mask: Uint8Array): string[] {
  if (mask.length !== DISCOVERY_MASK_BYTES) throw new RangeError('Invalid discovery mask length.')
  const ids: string[] = []
  for (let byteIndex = 0; byteIndex < mask.length; byteIndex += 1) {
    const byte = mask[byteIndex]
    if (byte === 0) continue
    for (let bit = 0; bit < 8; bit += 1) {
      if ((byte & (1 << bit)) === 0) continue
      const bitIndex = byteIndex * 8 + bit
      const gx = bitIndex % GRID_WIDTH + WORLD_GRID_MIN
      const gz = Math.floor(bitIndex / GRID_WIDTH) + WORLD_GRID_MIN
      ids.push(`tile-${gx + 3}-${gz + 3}`)
    }
  }
  return ids.sort()
}
