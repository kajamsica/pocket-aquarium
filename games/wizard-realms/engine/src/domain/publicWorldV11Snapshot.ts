import { DISCOVERY_MASK_BYTES } from './discoveryMask'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { decodePublicV8Head } from './publicWorldV8Snapshot'
import type { PublicV8Head } from './publicWorldV8Snapshot'
import { decodePublicV9Head } from './publicWorldV9Snapshot'
import type { PublicV9Head } from './publicWorldV9Snapshot'
import { decodePublicV10Head, encodePublicV10Head, isValidPublicV10SourceReceipt } from './publicWorldV10Snapshot'
import type { PublicV10Head, PublicV10SourceReceipt } from './publicWorldV10Snapshot'
import { isValidPublicWorldV11State, withPublicV11Highland } from './publicWorldV11State'
import type { PublicWorldV11State } from './publicWorldV11State'

export const PUBLIC_V11_SCHEMA = 'wizard-world/v11'
export const PUBLIC_V11_RESCUE_SCHEMA = 'wizard-world/v11-rescue'

export type PublicV11Head = Omit<PublicV10Head, 'schemaVersion' | 'state'> & {
  readonly schemaVersion: typeof PUBLIC_V11_SCHEMA
  readonly state: PublicV10Head['state'] & {
    readonly highlandContentRevision: PublicWorldV11State['highlandContentRevision']
    readonly highland: PublicWorldV11State['highland']
  }
}
export type PublicV11SourceReceipt = {
  readonly sourceV10Head: PublicV10Head
  readonly sourceV10Lineage: PublicV10SourceReceipt
}
export type PublicV11PortableSnapshot = Omit<PublicV11Head, 'state'> & { readonly state: PublicWorldV11State }
export type PublicV11Rescue = {
  readonly schemaVersion: typeof PUBLIC_V11_RESCUE_SCHEMA
  readonly snapshot: PublicV11PortableSnapshot
  readonly sourceReceipt: PublicV11SourceReceipt
}

const HEAD_KEYS = ['schemaVersion', 'saveRevision', 'bootstrap', 'state']
const STATE_KEYS = ['seed', 'generationProfile', 'movementOwner', 'tick', 'rng',
  'eventSequence', 'player', 'discoveryMask', 'greenway', 'mireglass',
  'fieldCampTileIds', 'terrainRevision', 'highlandContentRevision', 'highland']
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length
      && a.every((byte, index) => byte === b[index])
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object'
    || Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<PropertyKey, unknown>
  const right = b as Record<PropertyKey, unknown>
  const keys = Reflect.ownKeys(left)
  return keys.length === Reflect.ownKeys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
}

/** Typed IndexedDB head retains the effective v10 terrain pose and v11 quarry ledger. */
export function encodePublicV11Head(state: PublicWorldV11State,
  bootstrap: PublicV6BootstrapRoot | null, saveRevision: number): PublicV11Head {
  if (!isValidPublicWorldV11State(state, bootstrap)) throw new RangeError('Invalid public v11 world state.')
  const { highlandContentRevision, highland, ...v10 } = state
  const previous = encodePublicV10Head(v10, bootstrap, saveRevision)
  return { ...previous, schemaVersion: PUBLIC_V11_SCHEMA,
    state: { ...previous.state, highlandContentRevision, highland } }
}

export function decodePublicV11Head(value: unknown): {
  state: PublicWorldV11State; bootstrap: PublicV6BootstrapRoot | null; saveRevision: number
} | null {
  try {
    if (!exact(value, HEAD_KEYS) || value.schemaVersion !== PUBLIC_V11_SCHEMA
      || !exact(value.state, STATE_KEYS)) return null
    const { highlandContentRevision, highland, ...state } = value.state
    const candidate = value as PublicV11Head
    const mask = candidate.state.discoveryMask
    if (!(mask instanceof Uint8Array) || mask.length !== DISCOVERY_MASK_BYTES) return null
    const prior = decodePublicV10Head({ ...value, schemaVersion: 'wizard-world/v10', state })
    if (!prior) return null
    const actual = { ...prior.state, highlandContentRevision, highland }
    if (!isValidPublicWorldV11State(actual, prior.bootstrap)) return null
    const expected = encodePublicV11Head(actual, prior.bootstrap, prior.saveRevision)
    return sameValue(expected, value) ? { ...prior, state: actual } : null
  } catch { return null }
}

/** A receipt pins the exact v10 head and the complete older lineage. */
export function isValidPublicV11SourceReceipt(value: unknown): value is PublicV11SourceReceipt {
  try {
    if (!exact(value, ['sourceV10Head', 'sourceV10Lineage'])
      || !isValidPublicV10SourceReceipt(value.sourceV10Lineage)) return false
    const v10 = decodePublicV10Head(value.sourceV10Head)
    const v9 = decodePublicV9Head(value.sourceV10Lineage.sourceV9Head)
    const v8 = decodePublicV8Head(value.sourceV10Lineage.sourceV9Lineage.sourceV8Head)
    if (!v10 || !v9 || !v8
      || v10.state.seed !== v9.state.seed || v10.state.generationProfile !== v9.state.generationProfile
      || !sameValue(v10.bootstrap, v9.bootstrap)
      || v9.state.fieldCampTileIds.length > v10.state.fieldCampTileIds.length
      || !v9.state.fieldCampTileIds.every((id, index) => v10.state.fieldCampTileIds[index] === id)
      || v9.state.mireglass.cacheExcavated && !v10.state.mireglass.cacheExcavated) return false
    if (v10.saveRevision === 0) {
      const initial = encodePublicV10Head({ ...v9.state, terrainRevision: v10.state.terrainRevision },
        v9.bootstrap, 0)
      if (!sameValue(initial, value.sourceV10Head)) return false
    }
    return true
  } catch { return false }
}

export function samePublicV11SourceReceipt(a: unknown, b: unknown): boolean {
  return isValidPublicV11SourceReceipt(a) && isValidPublicV11SourceReceipt(b) && sameValue(a, b)
}

export function serializePublicV11World(state: PublicWorldV11State,
  bootstrap: PublicV6BootstrapRoot | null, saveRevision: number): string {
  const checked = encodePublicV11Head(state, bootstrap, saveRevision)
  const bytes = JSON.stringify({ ...checked, state })
  if (!parsePublicV11World(bytes)) throw new RangeError('Invalid public v11 export.')
  return bytes
}

export function parsePublicV11World(bytes: string): PublicV11PortableSnapshot | null {
  try {
    if (typeof bytes !== 'string' || bytes.length > 96 * 1024 * 1024) return null
    const value: unknown = JSON.parse(bytes)
    if (!exact(value, HEAD_KEYS) || value.schemaVersion !== PUBLIC_V11_SCHEMA) return null
    const head = encodePublicV11Head(value.state as PublicWorldV11State,
      value.bootstrap as PublicV6BootstrapRoot | null, value.saveRevision as number)
    return { ...head, state: value.state as PublicWorldV11State }
  } catch { return null }
}

function portableHead(head: PublicV8Head | PublicV9Head | PublicV10Head) {
  return { ...head, state: { ...head.state, discoveryMask: Array.from(head.state.discoveryMask) } }
}

function restoreHeadMask(value: unknown): unknown {
  if (!exact(value, HEAD_KEYS) || typeof value.state !== 'object' || value.state === null
    || Array.isArray(value.state)) return null
  const state = value.state as Record<string, unknown>
  const bytes = state.discoveryMask
  if (!Array.isArray(bytes) || bytes.length !== DISCOVERY_MASK_BYTES
    || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null
  return { ...value, state: { ...state, discoveryMask: Uint8Array.from(bytes) } }
}

function validRescueOrigin(snapshot: PublicV11PortableSnapshot,
  source: PublicV11SourceReceipt): boolean {
  const v10 = decodePublicV10Head(source.sourceV10Head)!
  if (snapshot.state.seed !== v10.state.seed
    || snapshot.state.generationProfile !== v10.state.generationProfile
    || !sameValue(snapshot.bootstrap, v10.bootstrap)
    || v10.state.fieldCampTileIds.length > snapshot.state.fieldCampTileIds.length
    || !v10.state.fieldCampTileIds.every((id, index) => snapshot.state.fieldCampTileIds[index] === id)
    || v10.state.mireglass.cacheExcavated && !snapshot.state.mireglass.cacheExcavated) return false
  if (snapshot.saveRevision === 0
    && !sameValue(snapshot.state, withPublicV11Highland(v10.state))) return false
  return true
}

export function serializePublicV11Rescue(state: PublicWorldV11State,
  bootstrap: PublicV6BootstrapRoot | null, saveRevision: number,
  sourceReceipt: PublicV11SourceReceipt): string {
  if (!isValidPublicV11SourceReceipt(sourceReceipt)) throw new RangeError('Invalid public v11 rescue source.')
  const snapshot = parsePublicV11World(serializePublicV11World(state, bootstrap, saveRevision))!
  const bytes = JSON.stringify({ schemaVersion: PUBLIC_V11_RESCUE_SCHEMA, snapshot,
    sourceV10Head: portableHead(sourceReceipt.sourceV10Head),
    sourceV10Lineage: { sourceV9Head: portableHead(sourceReceipt.sourceV10Lineage.sourceV9Head),
      sourceV9Lineage: { sourceV8Head: portableHead(sourceReceipt.sourceV10Lineage.sourceV9Lineage.sourceV8Head),
        sourceV7Bytes: sourceReceipt.sourceV10Lineage.sourceV9Lineage.sourceV7Bytes } } })
  const parsed = parsePublicV11Rescue(bytes)
  if (!parsed || !samePublicV11SourceReceipt(parsed.sourceReceipt, sourceReceipt)) {
    throw new RangeError('Invalid public v11 rescue origin.')
  }
  return bytes
}

/** Portable recovery still requires live-source comparison and CAS before import. */
export function parsePublicV11Rescue(bytes: string): PublicV11Rescue | null {
  try {
    if (typeof bytes !== 'string' || bytes.length > 4 * 96 * 1024 * 1024) return null
    const value: unknown = JSON.parse(bytes)
    if (!exact(value, ['schemaVersion', 'snapshot', 'sourceV10Head', 'sourceV10Lineage'])
      || value.schemaVersion !== PUBLIC_V11_RESCUE_SCHEMA
      || !exact(value.sourceV10Lineage, ['sourceV9Head', 'sourceV9Lineage'])
      || !exact(value.sourceV10Lineage.sourceV9Lineage, ['sourceV8Head', 'sourceV7Bytes'])
      || typeof value.sourceV10Lineage.sourceV9Lineage.sourceV7Bytes !== 'string') return null
    const snapshot = parsePublicV11World(JSON.stringify(value.snapshot))
    if (!snapshot) return null
    const sourceReceipt = { sourceV10Head: restoreHeadMask(value.sourceV10Head),
      sourceV10Lineage: { sourceV9Head: restoreHeadMask(value.sourceV10Lineage.sourceV9Head),
        sourceV9Lineage: { sourceV8Head: restoreHeadMask(value.sourceV10Lineage.sourceV9Lineage.sourceV8Head),
          sourceV7Bytes: value.sourceV10Lineage.sourceV9Lineage.sourceV7Bytes } } }
    if (!isValidPublicV11SourceReceipt(sourceReceipt)
      || !validRescueOrigin(snapshot, sourceReceipt)) return null
    return { schemaVersion: PUBLIC_V11_RESCUE_SCHEMA, snapshot, sourceReceipt }
  } catch { return null }
}
