import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { parsePublicV7PlayableRoot } from './publicWorldV7'
import type { PublicWorldV7State } from './publicWorldV7'
import { decodePublicV8Head, encodePublicV8Head, PUBLIC_V8_SCHEMA } from './publicWorldV8Snapshot'
import type { PublicV8Head } from './publicWorldV8Snapshot'
import { isValidPublicWorldV9State } from './publicWorldV9State'
import type { PublicWorldV9State } from './publicWorldV9State'

export const PUBLIC_V9_SCHEMA = 'wizard-world/v9'
export type PublicV9Head = Omit<PublicV8Head, 'schemaVersion' | 'state'> & {
  readonly schemaVersion: typeof PUBLIC_V9_SCHEMA
  readonly state: PublicV8Head['state'] & { readonly fieldCampTileIds: readonly string[] }
}
export type PublicV9SourceReceipt = {
  readonly sourceV8Head: PublicV8Head
  readonly sourceV7Bytes: string
}
export type PublicV9PortableSnapshot = Omit<PublicV9Head, 'state'> & { readonly state: PublicWorldV9State }
export const PUBLIC_V9_RESCUE_SCHEMA = 'wizard-world/v9-rescue'
export type PublicV9Rescue = {
  readonly schemaVersion: typeof PUBLIC_V9_RESCUE_SCHEMA
  readonly snapshot: PublicV9PortableSnapshot
  readonly sourceReceipt: PublicV9SourceReceipt
}

const HEAD_KEYS = ['schemaVersion', 'saveRevision', 'bootstrap', 'state']
const STATE_KEYS = ['seed', 'generationProfile', 'movementOwner', 'tick', 'rng',
  'eventSequence', 'player', 'discoveryMask', 'greenway', 'mireglass', 'fieldCampTileIds']
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

export function encodePublicV9Head(state: PublicWorldV9State,
  bootstrap: PublicV6BootstrapRoot | null, saveRevision: number): PublicV9Head {
  const { fieldCampTileIds, ...v7State } = state
  const head = encodePublicV8Head(v7State, bootstrap, saveRevision)
  if (!isValidPublicWorldV9State(state, head.bootstrap)) throw new RangeError('Invalid public v9 world state.')
  return { ...head, schemaVersion: PUBLIC_V9_SCHEMA, state: { ...head.state, fieldCampTileIds } }
}

export function decodePublicV9Head(value: unknown): {
  state: PublicWorldV9State; bootstrap: PublicV6BootstrapRoot | null; saveRevision: number
} | null {
  try {
    if (!exact(value, HEAD_KEYS) || value.schemaVersion !== PUBLIC_V9_SCHEMA
      || !exact(value.state, STATE_KEYS)) return null
    const { fieldCampTileIds, ...v8State } = value.state
    const decoded = decodePublicV8Head({ ...value, schemaVersion: PUBLIC_V8_SCHEMA, state: v8State })
    if (!decoded) return null
    const state = { ...decoded.state, fieldCampTileIds }
    return isValidPublicWorldV9State(state, decoded.bootstrap) ? { ...decoded, state } : null
  } catch { return null }
}

export function isValidPublicV9SourceReceipt(value: unknown): value is PublicV9SourceReceipt {
  try {
    if (!exact(value, ['sourceV8Head', 'sourceV7Bytes']) || typeof value.sourceV7Bytes !== 'string') return false
    const head = decodePublicV8Head(value.sourceV8Head)
    const root = parsePublicV7PlayableRoot(value.sourceV7Bytes)
    return !!head && !!root && head.state.seed === root.state.seed
      && head.state.generationProfile === root.state.generationProfile && sameValue(head.bootstrap, root.bootstrap)
  } catch { return false }
}

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

/** Compare the complete validated source, including every typed mask byte and exact v7 text. */
export function samePublicV9SourceReceipt(a: unknown, b: unknown): boolean {
  return isValidPublicV9SourceReceipt(a) && isValidPublicV9SourceReceipt(b)
    && a.sourceV7Bytes === b.sourceV7Bytes && sameValue(a.sourceV8Head, b.sourceV8Head)
}

/** Portable JSON uses tile IDs; Uint8Array's default JSON encoding is not a save format. */
export function serializePublicV9World(state: PublicWorldV9State,
  bootstrap: PublicV6BootstrapRoot | null, saveRevision: number): string {
  const checked = encodePublicV9Head(state, bootstrap, saveRevision)
  const bytes = JSON.stringify({ ...checked, state })
  if (!parsePublicV9World(bytes)) throw new RangeError('Invalid public v9 export.')
  return bytes
}

export function parsePublicV9World(bytes: string): PublicV9PortableSnapshot | null {
  try {
    if (typeof bytes !== 'string' || bytes.length > 96 * 1024 * 1024) return null
    const value: unknown = JSON.parse(bytes)
    if (!exact(value, HEAD_KEYS) || value.schemaVersion !== PUBLIC_V9_SCHEMA) return null
    const head = encodePublicV9Head(value.state as PublicWorldV9State,
      value.bootstrap as PublicV6BootstrapRoot | null, value.saveRevision as number)
    return { ...head, state: value.state as PublicWorldV9State }
  } catch { return null }
}

function validRescueOrigin(snapshot: PublicV9PortableSnapshot, receipt: PublicV9SourceReceipt): boolean {
  const source = decodePublicV8Head(receipt.sourceV8Head)!
  if (snapshot.state.seed !== source.state.seed || snapshot.state.generationProfile !== source.state.generationProfile
    || !sameValue(snapshot.bootstrap, source.bootstrap)) return false
  if (source.saveRevision === 0) {
    const root = parsePublicV7PlayableRoot(receipt.sourceV7Bytes)!
    if (!samePublicV9SourceReceipt(receipt, { sourceV7Bytes: receipt.sourceV7Bytes,
      sourceV8Head: encodePublicV8Head(root.state, root.bootstrap, 0) })) return false
  }
  if (snapshot.saveRevision === 0) {
    const { fieldCampTileIds, ...state } = snapshot.state
    if (fieldCampTileIds.length !== 0 || !samePublicV9SourceReceipt(receipt, {
      sourceV7Bytes: receipt.sourceV7Bytes,
      sourceV8Head: encodePublicV8Head(state, snapshot.bootstrap, source.saveRevision),
    })) return false
  }
  return true
}

/** Export source evidence without treating JSON's default Uint8Array representation as portable. */
export function serializePublicV9Rescue(state: PublicWorldV9State, bootstrap: PublicV6BootstrapRoot | null,
  saveRevision: number, sourceReceipt: PublicV9SourceReceipt): string {
  if (!isValidPublicV9SourceReceipt(sourceReceipt)) throw new RangeError('Invalid public v9 rescue source.')
  const snapshot = parsePublicV9World(serializePublicV9World(state, bootstrap, saveRevision))!
  const source = decodePublicV8Head(sourceReceipt.sourceV8Head)!
  const bytes = JSON.stringify({ schemaVersion: PUBLIC_V9_RESCUE_SCHEMA, snapshot,
    sourceV7Bytes: sourceReceipt.sourceV7Bytes,
    sourceV8Head: { schemaVersion: PUBLIC_V8_SCHEMA, ...source } })
  const parsed = parsePublicV9Rescue(bytes)
  if (!parsed || !samePublicV9SourceReceipt(parsed.sourceReceipt, sourceReceipt)) {
    throw new RangeError('Invalid public v9 rescue origin.')
  }
  return bytes
}

/** Read-only consistency check, not external authentication or permission to overwrite a live save.
 * A self-consistent edited file still needs live-source comparison and explicit archive/CAS recovery. */
export function parsePublicV9Rescue(bytes: string): PublicV9Rescue | null {
  try {
    if (typeof bytes !== 'string' || bytes.length > 3 * 96 * 1024 * 1024) return null
    const value: unknown = JSON.parse(bytes)
    if (!exact(value, ['schemaVersion', 'snapshot', 'sourceV7Bytes', 'sourceV8Head'])
      || value.schemaVersion !== PUBLIC_V9_RESCUE_SCHEMA || typeof value.sourceV7Bytes !== 'string'
      || !exact(value.sourceV8Head, HEAD_KEYS) || value.sourceV8Head.schemaVersion !== PUBLIC_V8_SCHEMA) return null
    const snapshot = parsePublicV9World(JSON.stringify(value.snapshot))
    if (!snapshot) return null
    const portable = value.sourceV8Head
    const sourceReceipt = { sourceV7Bytes: value.sourceV7Bytes,
      sourceV8Head: encodePublicV8Head(portable.state as PublicWorldV7State,
        portable.bootstrap as PublicV6BootstrapRoot | null, portable.saveRevision as number) }
    if (!isValidPublicV9SourceReceipt(sourceReceipt) || !validRescueOrigin(snapshot, sourceReceipt)) return null
    return { schemaVersion: PUBLIC_V9_RESCUE_SCHEMA, snapshot, sourceReceipt }
  } catch { return null }
}
