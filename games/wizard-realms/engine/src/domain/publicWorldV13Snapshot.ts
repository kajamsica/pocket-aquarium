import { DISCOVERY_MASK_BYTES, isDiscoveryMaskSubset, isValidDiscoveryMask } from './discoveryMask'
import { HIGHLAND_WIND_CONTENT_REVISION } from './highlandWindContent'
import { parsePublicV6BootstrapRoot } from './publicWorldV6'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { validatePublicWorldV12CompactState } from './publicWorldV12CompactValidation'
import { decodePublicV11Head, PUBLIC_V11_SCHEMA } from './publicWorldV11Snapshot'
import type { PublicV11Head } from './publicWorldV11Snapshot'
import { decodePublicV12Head, PUBLIC_V12_SCHEMA } from './publicWorldV12Snapshot'
import type { PublicV12Head } from './publicWorldV12Snapshot'
import { provePublicWorldV13Pose } from './publicWorldV13Pose'
import { resolvePublicV13SourceLease } from './publicWorldV13SourceReader'
import type { PublicV13SourceLease } from './publicWorldV13SourceReader'
import { emptyTerrainWorkLedger } from './terrainWorkLedger'
import type { TerrainWorkLedger } from './terrainWorkLedger'

export const PUBLIC_V13_SCHEMA = 'wizard-world/v13'
export type PublicV13Head = Omit<PublicV12Head, 'schemaVersion' | 'state'> & {
  readonly schemaVersion: typeof PUBLIC_V13_SCHEMA
  readonly state: PublicV12Head['state'] & { readonly terrainWorks: TerrainWorkLedger }
}
export type PublicV13SourceLineage =
  | { readonly sourceSchemaVersion: typeof PUBLIC_V11_SCHEMA; readonly sourceHead: PublicV11Head }
  | { readonly sourceSchemaVersion: typeof PUBLIC_V12_SCHEMA; readonly sourceHead: PublicV12Head }

const HEAD_KEYS = ['schemaVersion', 'saveRevision', 'bootstrap', 'state']
const LINEAGE_KEYS = ['sourceSchemaVersion', 'sourceHead']
const STATE_KEYS = ['seed', 'generationProfile', 'movementOwner', 'tick', 'rng',
  'eventSequence', 'player', 'discoveryMask', 'greenway', 'mireglass',
  'fieldCampTileIds', 'terrainRevision', 'highlandContentRevision', 'highland',
  'windContentRevision', 'windstep', 'terrainWorks']
const SOURCE_V11_KEYS = STATE_KEYS.slice(0, 14)
const SOURCE_V12_KEYS = STATE_KEYS.slice(0, 16)
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)
const viewBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!
const viewOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!
const bufferBytes = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!
const bufferMaxBytes = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'maxByteLength')?.get

const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === keys.length
  && keys.every((key) => {
    const field = Object.getOwnPropertyDescriptor(value, key)
    return field?.enumerable && Object.hasOwn(field, 'value')
  })

/** Descriptor-only bounded copy, including the exact backing size of typed masks. */
function detached(value: unknown): unknown {
  // The v6 bootstrap parser permits up to 32 MiB by itself; leave room for
  // the selected head's other fields without admitting an unbounded tree.
  const MAX_TEXT_UNITS = 64 * 1024 * 1024
  let nodes = 0, fields = 0, text = 0, masks = 0
  const seen = new WeakMap<object, unknown>()
  const active = new WeakSet<object>()
  const copy = (item: unknown, depth: number): unknown => {
    if (typeof item === 'string') {
      if ((text += item.length) > MAX_TEXT_UNITS) throw new RangeError('Text cap')
      return item
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new RangeError('Nonfinite number')
      return item
    }
    if (item === null || typeof item === 'boolean') return item
    if (typeof item !== 'object' || depth > 64 || active.has(item)) throw new RangeError('Shape')
    if (seen.has(item)) return seen.get(item)
    if (++nodes > 20_000) throw new RangeError('Node cap')
    if (ArrayBuffer.isView(item)) {
      // An exact head or head-only lineage has one discovery mask. Reject a
      // second view before allocating another 32 KiB copy.
      if (++masks > 1) throw new RangeError('Mask count')
      if (!isValidDiscoveryMask(item) || viewOffset.call(item) !== 0) throw new RangeError('Mask')
      const backing = viewBuffer.call(item)
      if (bufferBytes.call(backing) !== DISCOVERY_MASK_BYTES
        || bufferMaxBytes && bufferMaxBytes.call(backing) !== DISCOVERY_MASK_BYTES) {
        throw new RangeError('Mask backing')
      }
      const mask = new Uint8Array(item)
      seen.set(item, mask)
      return mask
    }
    const array = Array.isArray(item)
    if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype)) {
      throw new RangeError('Prototype')
    }
    const keys = Reflect.ownKeys(item)
    if (array) {
      const length = Object.getOwnPropertyDescriptor(item, 'length')?.value
      if (!Number.isSafeInteger(length) || length > 1_024 || keys.length !== length + 1) {
        throw new RangeError('Array length')
      }
      const result: unknown[] = []
      seen.set(item, result)
      active.add(item)
      for (let index = 0; index < length; index++) {
        const field = Object.getOwnPropertyDescriptor(item, String(index))
        if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw new RangeError('Array field')
        result.push(copy(field.value, depth + 1))
      }
      if ((fields += length) > 50_000) throw new RangeError('Field cap')
      active.delete(item)
      return result
    }
    if (keys.length > 64 || (fields += keys.length) > 50_000) throw new RangeError('Field cap')
    const result: Record<string, unknown> = {}
    seen.set(item, result)
    active.add(item)
    for (const key of keys) {
      if (typeof key !== 'string') throw new RangeError('Symbol key')
      const field = Object.getOwnPropertyDescriptor(item, key)
      if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw new RangeError('Object field')
      if ((text += key.length) > MAX_TEXT_UNITS) throw new RangeError('Key cap')
      Object.defineProperty(result, key, { value: copy(field.value, depth + 1),
        enumerable: true, configurable: true, writable: true })
    }
    active.delete(item)
    return result
  }
  return copy(value, 0)
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length
      && a.every((byte, index) => byte === b[index])
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object'
    || Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && same(left[key], right[key]))
}

function bootstrapOf(value: unknown): PublicV6BootstrapRoot | null | undefined {
  if (value === null) return null
  if (typeof value !== 'object' || value === null) return undefined
  const bytes = JSON.stringify(value)
  return bytes.length <= 32 * 1024 * 1024 ? parsePublicV6BootstrapRoot(bytes) ?? undefined : undefined
}

type CheckedSource = { lineage: PublicV13SourceLineage }
function compactSource(value: unknown): CheckedSource | null {
  try {
    const owned = detached(value)
    if (!exact(owned, LINEAGE_KEYS)) return null
    const keys = owned.sourceSchemaVersion === PUBLIC_V11_SCHEMA ? SOURCE_V11_KEYS
      : owned.sourceSchemaVersion === PUBLIC_V12_SCHEMA ? SOURCE_V12_KEYS : null
    if (!keys || !exact(owned.sourceHead, HEAD_KEYS)
      || owned.sourceHead.schemaVersion !== owned.sourceSchemaVersion
      || !Number.isSafeInteger(owned.sourceHead.saveRevision)
      || (owned.sourceHead.saveRevision as number) < 0
      || !exact(owned.sourceHead.state, keys)
      || !isValidDiscoveryMask(owned.sourceHead.state.discoveryMask)) return null
    return { lineage: owned as PublicV13SourceLineage }
  } catch { return null }
}

/** Flow input copies only; neither shape copy is a source or world-state proof. */
export function cloneBoundedPublicV13StateShape(value: unknown): PublicV13Head['state'] | null {
  try {
    const owned = detached(value)
    return exact(owned, STATE_KEYS) && isValidDiscoveryMask(owned.discoveryMask)
      ? owned as PublicV13Head['state'] : null
  } catch { return null }
}
export function cloneBoundedPublicV13SourceShape(value: unknown): PublicV13SourceLineage | null {
  return compactSource(value)?.lineage ?? null
}

function checkedSource(value: unknown): CheckedSource | null {
  const source = compactSource(value)
  if (!source) return null
  const { sourceSchemaVersion, sourceHead } = source.lineage
  return (sourceSchemaVersion === PUBLIC_V11_SCHEMA ? decodePublicV11Head(sourceHead)
    : decodePublicV12Head(sourceHead)) ? source : null
}

function migratedState(source: CheckedSource): PublicV13Head['state'] {
  const wind = source.lineage.sourceSchemaVersion === PUBLIC_V11_SCHEMA
    ? { windContentRevision: HIGHLAND_WIND_CONTENT_REVISION,
      windstep: { learned: false, activeUntilTick: 0, nextCastTick: 0,
        practicedRouteIndices: [] } } : {}
  return { ...source.lineage.sourceHead.state, ...wind,
    terrainWorks: emptyTerrainWorkLedger() } as PublicV13Head['state']
}

/** Head-only lineage shape and legacy head validity, not live-source or CAS proof. */
export function decodePublicV13SourceLineage(value: unknown): PublicV13SourceLineage | null {
  return checkedSource(value)?.lineage ?? null
}

/** A compact validated head. Its position is the original v13 Y, never the v12 witness Y. */
export function decodePublicV13Head(value: unknown, lineage: unknown): PublicV13Head | null {
  return validateHead(value, () => checkedSource(lineage))
}

function validateHead(value: unknown, getSource: () => CheckedSource | null): PublicV13Head | null {
  try {
    const owned = detached(value)
    if (!exact(owned, HEAD_KEYS) || owned.schemaVersion !== PUBLIC_V13_SCHEMA
      || !Number.isSafeInteger(owned.saveRevision) || (owned.saveRevision as number) < 0
      || !exact(owned.state, STATE_KEYS)) return null
    const source = getSource()
    if (!source) return null
    const head = owned as PublicV13Head
    const bootstrap = bootstrapOf(head.bootstrap)
    const origin = source.lineage.sourceHead
    if (bootstrap === undefined || !same(bootstrap, origin.bootstrap)) return null
    const { terrainWorks, ...inherited } = head.state
    const proof = provePublicWorldV13Pose(inherited, terrainWorks)
    if (!proof || !validatePublicWorldV12CompactState(proof.witness, bootstrap)
      || head.state.seed !== origin.state.seed
      || head.state.generationProfile !== origin.state.generationProfile) return null
    if (head.saveRevision === 0) {
      if (!same(head.state, migratedState(source))) return null
    } else {
      const earlier = origin.state
      if (earlier.tick > head.state.tick || earlier.eventSequence > head.state.eventSequence
        || !isDiscoveryMaskSubset(origin.state.discoveryMask,
          head.state.discoveryMask)
        || earlier.fieldCampTileIds.length > head.state.fieldCampTileIds.length
        || !earlier.fieldCampTileIds.every((id, index) => head.state.fieldCampTileIds[index] === id)
        || earlier.mireglass.cacheExcavated && !head.state.mireglass.cacheExcavated
        || earlier.mireglass.builtRoutes.bridge !== null
          && earlier.mireglass.builtRoutes.bridge !== head.state.mireglass.builtRoutes.bridge
        || earlier.mireglass.builtRoutes.ladder !== null
          && earlier.mireglass.builtRoutes.ladder !== head.state.mireglass.builtRoutes.ladder
        || earlier.highland.landmarkDiscovered && !head.state.highland.landmarkDiscovered
        || earlier.highland.stoneNodes.length !== head.state.highland.stoneNodes.length
        || earlier.highland.stoneNodes.some((node, index) =>
          node.id !== head.state.highland.stoneNodes[index]?.id
          || node.readyAtTick > head.state.highland.stoneNodes[index].readyAtTick)
        || source.lineage.sourceSchemaVersion === PUBLIC_V12_SCHEMA
          && 'windstep' in earlier
          && (earlier.windstep.learned && !head.state.windstep.learned
            || earlier.windstep.activeUntilTick > head.state.windstep.activeUntilTick
            || earlier.windstep.nextCastTick > head.state.windstep.nextCastTick
            || earlier.windstep.practicedRouteIndices.some((index) =>
              !head.state.windstep.practicedRouteIndices.includes(index)))) return null
    }
    return head
  } catch { return null }
}

/** Encode from a compact v13 state; old schemas and lineage slots are untouched. */
export function encodePublicV13Head(state: PublicV13Head['state'],
  bootstrap: PublicV6BootstrapRoot | null, saveRevision: number,
  lineage: PublicV13SourceLineage): PublicV13Head {
  const head = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA, saveRevision, bootstrap,
    state }, lineage)
  if (!head) throw new RangeError('Invalid public v13 world head.')
  return head
}

/** Exact revision-zero upgrade of the selected independently validated v11 or v12 head. */
export function createPublicV13MigrationHead(lineage: unknown): PublicV13Head | null {
  return migrationHead(checkedSource(lineage))
}

function migrationHead(source: CheckedSource | null): PublicV13Head | null {
  if (!source) return null
  const origin = source.lineage.sourceHead
  return validateHead({ schemaVersion: PUBLIC_V13_SCHEMA, saveRevision: 0,
    bootstrap: origin.bootstrap, state: migratedState(source) }, () => source)
}

/** Flow-internal only. Resolve the proof-bound P8B lease, never a caller's
 * claimed compact source or P9B decoded fields. P9C compares stored lineage
 * with the resolved source separately before accepting a stored head. */
export function decodePublicV13HeadWithSource(value: unknown,
  lease: PublicV13SourceLease): PublicV13Head | null {
  return validateHead(value, () => compactSource(resolvePublicV13SourceLease(lease)))
}

/** Same lease requirement as decodePublicV13HeadWithSource. */
export function createPublicV13MigrationHeadWithSource(
  lease: PublicV13SourceLease): PublicV13Head | null {
  return migrationHead(compactSource(resolvePublicV13SourceLease(lease)))
}
