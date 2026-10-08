import { WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

const GRID_WIDTH = WORLD_GRID_MAX - WORLD_GRID_MIN + 1

export const DISCOVERY_MASK_BYTES = GRID_WIDTH ** 2 / 8

export function encodeDiscoveredTileIds(ids: readonly string[]): Uint8Array {
  const mask = new Uint8Array(DISCOVERY_MASK_BYTES)
  let previousId: string | null = null
  for (const id of ids) {
    if (typeof id !== 'string') throw new RangeError('Invalid discovered tile ID.')
    const match = /^tile-(-?\d+)-(-?\d+)$/.exec(id)
    if (!match) throw new RangeError('Invalid discovered tile ID.')
    const idX = Number(match[1])
    const idZ = Number(match[2])
    const gx = idX - 3
    const gz = idZ - 3
    if (!Number.isSafeInteger(idX) || !Number.isSafeInteger(idZ)
      || id !== `tile-${idX}-${idZ}`
      || gx < WORLD_GRID_MIN || gx > WORLD_GRID_MAX
      || gz < WORLD_GRID_MIN || gz > WORLD_GRID_MAX) {
      throw new RangeError('Invalid discovered tile ID.')
    }
    if (previousId !== null && id <= previousId) {
      throw new RangeError('Discovered tile IDs must be sorted and unique.')
    }
    const bitIndex = (gz - WORLD_GRID_MIN) * GRID_WIDTH + (gx - WORLD_GRID_MIN)
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
