import { createActiveWorldTerrain } from './activeWorldTerrain'
import { DISCOVERY_MASK_BYTES, discoveryMaskHasTileId, isValidDiscoveryMask } from './discoveryMask'
import { createGeneratedWorld } from './generation'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { PUBLIC_START_TILE_ID } from './publicWorldDiscovery'
import type { PublicV12Head } from './publicWorldV12Snapshot'
import { isValidPublicWorldV12State } from './publicWorldV12State'
import { restoreWizardWorld } from './persistence'

const COMPACT_STATE_KEYS = ['seed', 'generationProfile', 'movementOwner', 'tick', 'rng',
  'eventSequence', 'player', 'discoveryMask', 'greenway', 'mireglass',
  'fieldCampTileIds', 'terrainRevision', 'highlandContentRevision', 'highland',
  'windContentRevision', 'windstep']
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!
const arrayBufferMaxByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'maxByteLength')?.get

/** Reject oversized or accessor-backed trees before cloning caller-owned input. */
function boundedCloneInput(value: object, rootMask: Uint8Array): boolean {
  const pending: unknown[] = [value]
  const seen = new WeakSet<object>()
  let nodes = 0, fields = 0, textUnits = 0
  while (pending.length) {
    const entry = pending.pop()
    if (typeof entry === 'string' && (textUnits += entry.length) > 8 * 1024 * 1024) return false
    if (typeof entry === 'bigint') return false
    if (typeof entry !== 'object' || entry === null) continue
    if (seen.has(entry)) continue
    seen.add(entry)
    if (++nodes > 20_000) return false
    if (ArrayBuffer.isView(entry)) {
      if (entry !== rootMask) return false
      continue
    }
    if (Array.isArray(entry) ? entry.length > 1_024
      || Object.getPrototypeOf(entry) !== Array.prototype
      : Object.getPrototypeOf(entry) !== Object.prototype) return false
    const keys = Reflect.ownKeys(entry)
    fields += keys.length
    if (keys.length > (Array.isArray(entry) ? 1_025 : 64) || fields > 50_000) return false
    for (const key of keys) {
      if (typeof key === 'string' && (textUnits += key.length) > 8 * 1024 * 1024) return false
      const field = Object.getOwnPropertyDescriptor(entry, key)
      if (!field || !Object.hasOwn(field, 'value')) return false
      pending.push(field.value)
    }
  }
  return true
}

/** Bounded exact compact shape clone only, not a world-state or source-head proof. */
export function cloneBoundedPublicV12CompactShape(value: unknown): PublicV12Head['state'] | null {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)
      || Reflect.ownKeys(value).length !== COMPACT_STATE_KEYS.length
      || !COMPACT_STATE_KEYS.every((key) => Object.hasOwn(value, key))) return null
    const maskField = Object.getOwnPropertyDescriptor(value, 'discoveryMask')
    if (!maskField || !Object.hasOwn(maskField, 'value')
      || !isValidDiscoveryMask(maskField.value)) return null
    const rootMask = maskField.value
    const backing = typedArrayBuffer.call(rootMask)
    if (typedArrayByteOffset.call(rootMask) !== 0
      || arrayBufferByteLength.call(backing) !== DISCOVERY_MASK_BYTES
      || arrayBufferMaxByteLength !== undefined
        && arrayBufferMaxByteLength.call(backing) !== DISCOVERY_MASK_BYTES
      || !boundedCloneInput(value, rootMask)) return null
    // Structured clone rejects Proxy objects; a canonical backing buffer caps
    // the clone to the exact mask bytes, and the returned mask is copied again.
    const detached = structuredClone(value) as PublicV12Head['state']
    if (!isValidDiscoveryMask(detached.discoveryMask)) return null
    return { ...detached, discoveryMask: new Uint8Array(detached.discoveryMask) }
  } catch { return null }
}

/** IDB-normalized plain masks only; caller must validate and bound bootstrap first.
 * Exotic legacy sources use the old decoder; returns owned state, never narrows input. */
export function validatePublicWorldV12CompactState(value: unknown,
  bootstrap: PublicV6BootstrapRoot | null): PublicV12Head['state'] | null {
  try {
    const state = cloneBoundedPublicV12CompactShape(value)
    if (!state) return null
    const mask = state.discoveryMask
    const expectedTiles = state.generationProfile === 'greenway-classic-v1' ? 49
      : state.generationProfile === 'greenway-expanded-v1' ? 256 : 0
    const tiles = state.greenway?.tiles
    const camps = state.fieldCampTileIds
    if (!expectedTiles || !Array.isArray(tiles) || tiles.length !== expectedTiles
      || !Array.isArray(camps) || camps.length > 1
      || state.movementOwner !== 'greenway' && state.movementOwner !== 'streamed') return null
    const baseline = bootstrap ? restoreWizardWorld(bootstrap.greenwaySaveBytes)
      : createGeneratedWorld(state.seed, state.generationProfile)
    if (!Array.isArray(baseline.discoveredTileIds)
      || baseline.discoveredTileIds.length > expectedTiles) return null
    const witness = new Set<string>()
    const keep = (id: unknown) => {
      if (typeof id === 'string' && discoveryMaskHasTileId(mask, id)) witness.add(id)
    }
    keep(PUBLIC_START_TILE_ID)
    for (let index = 0; index < expectedTiles; index++) keep(tiles[index]?.id)
    for (let index = 0; index < baseline.discoveredTileIds.length; index++) {
      keep(baseline.discoveredTileIds[index])
    }
    if (camps.length === 1) keep(camps[0])
    if (state.movementOwner === 'streamed') {
      const position = state.player.position
      for (const facts of [undefined, { cachePitDug: state.mireglass.cacheExcavated },
        { cachePitDug: state.mireglass.cacheExcavated, highlandRidge: true as const }]) {
        const terrain = createActiveWorldTerrain(state.seed, facts)
        terrain.activate(position)
        const ground = terrain.tileAtWorld(position.x, position.z)
        if (!ground) return null
        keep(ground.id)
      }
    }
    const { discoveryMask: _mask, ...fields } = state
    return isValidPublicWorldV12State({ ...fields,
      discoveredTileIds: [...witness].sort() }, bootstrap) ? state : null
  } catch { return null }
}
