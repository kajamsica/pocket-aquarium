import { DISCOVERY_MASK_BYTES } from './discoveryMask'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import type { PublicV8Head } from './publicWorldV8Snapshot'
import type { PublicV9Head } from './publicWorldV9Snapshot'
import { decodePublicV10Head } from './publicWorldV10Snapshot'
import type { PublicV10Head } from './publicWorldV10Snapshot'
import { decodePublicV11Head, encodePublicV11Head, isValidPublicV11SourceReceipt,
  PUBLIC_V11_SCHEMA } from './publicWorldV11Snapshot'
import type { PublicV11Head, PublicV11SourceReceipt } from './publicWorldV11Snapshot'
import { withPublicV11Highland } from './publicWorldV11State'
import { isValidPublicWorldV12State, withPublicV12Windstep } from './publicWorldV12State'
import type { PublicWorldV12State } from './publicWorldV12State'

export const PUBLIC_V12_SCHEMA = 'wizard-world/v12'
export const PUBLIC_V12_RESCUE_SCHEMA = 'wizard-world/v12-rescue'
// Alpha saves are currently far smaller. Cap untrusted rescue text before
// JSON parsing or re-stringifying its nested snapshot and source receipt.
const MAX_PUBLIC_V12_RESCUE_BYTES = 8 * 1024 * 1024

/** Necessary early bound, so an oversized old source is never parsed for a rescue. */
export function publicV12RescueSourceFitsCap(value: unknown): boolean {
  try {
    const source = value as PublicV12SourceReceipt | null
    const bytes = source?.sourceV11Receipt?.sourceV10Lineage?.sourceV9Lineage?.sourceV7Bytes
    return typeof bytes === 'string' && bytes.length < MAX_PUBLIC_V12_RESCUE_BYTES
  } catch { return false }
}

export type PublicV12Head = Omit<PublicV11Head, 'schemaVersion' | 'state'> & {
  readonly schemaVersion: typeof PUBLIC_V12_SCHEMA
  readonly state: PublicV11Head['state'] & {
    readonly windContentRevision: PublicWorldV12State['windContentRevision']
    readonly windstep: PublicWorldV12State['windstep']
  }
}
/** Stored once in the v12 lineage slot, never copied into each head. */
export type PublicV12SourceReceipt = {
  readonly sourceV11Head: PublicV11Head
  readonly sourceV11Receipt: PublicV11SourceReceipt
}
export type PublicV12PortableSnapshot = Omit<PublicV12Head, 'state'> & {
  readonly state: PublicWorldV12State
}
export type PublicV12Rescue = {
  readonly schemaVersion: typeof PUBLIC_V12_RESCUE_SCHEMA
  readonly snapshot: PublicV12PortableSnapshot
  readonly sourceReceipt: PublicV12SourceReceipt
}

const HEAD_KEYS = ['schemaVersion', 'saveRevision', 'bootstrap', 'state']
const STATE_KEYS = ['seed', 'generationProfile', 'movementOwner', 'tick', 'rng',
  'eventSequence', 'player', 'discoveryMask', 'greenway', 'mireglass',
  'fieldCampTileIds', 'terrainRevision', 'highlandContentRevision', 'highland',
  'windContentRevision', 'windstep']
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

/** The head is a v11-compatible typed base plus one strict Windward overlay. */
export function encodePublicV12Head(state: PublicWorldV12State,
  bootstrap: PublicV6BootstrapRoot | null, saveRevision: number): PublicV12Head {
  if (!isValidPublicWorldV12State(state, bootstrap)) throw new RangeError('Invalid public v12 world state.')
  const { windContentRevision, windstep, ...v11 } = state
  const base = encodePublicV11Head(v11, bootstrap, saveRevision)
  return { ...base, schemaVersion: PUBLIC_V12_SCHEMA,
    state: { ...base.state, windContentRevision, windstep } }
}

export function decodePublicV12Head(value: unknown): {
  state: PublicWorldV12State; bootstrap: PublicV6BootstrapRoot | null; saveRevision: number
} | null {
  try {
    if (!exact(value, HEAD_KEYS) || value.schemaVersion !== PUBLIC_V12_SCHEMA
      || !exact(value.state, STATE_KEYS)) return null
    const { windContentRevision, windstep, ...state } = value.state
    const mask = value.state.discoveryMask
    if (!(mask instanceof Uint8Array) || mask.length !== DISCOVERY_MASK_BYTES) return null
    const base = decodePublicV11Head({ ...value, schemaVersion: PUBLIC_V11_SCHEMA, state })
    if (!base) return null
    const actual = { ...base.state, windContentRevision, windstep }
    if (!isValidPublicWorldV12State(actual, base.bootstrap)) return null
    const canonical = encodePublicV12Head(actual, base.bootstrap, base.saveRevision)
    return sameValue(canonical, value) ? { ...base, state: actual } : null
  } catch { return null }
}

/** Validate the exact v11 anchor and its separately pinned earlier receipt. */
export function isValidPublicV12SourceReceipt(value: unknown): value is PublicV12SourceReceipt {
  try {
    if (!exact(value, ['sourceV11Head', 'sourceV11Receipt'])
      || !isValidPublicV11SourceReceipt(value.sourceV11Receipt)) return false
    const v11 = decodePublicV11Head(value.sourceV11Head)
    const v10 = decodePublicV10Head(value.sourceV11Receipt.sourceV10Head)
    if (!v11 || !v10 || v11.state.seed !== v10.state.seed
      || v11.state.generationProfile !== v10.state.generationProfile
      || !sameValue(v11.bootstrap, v10.bootstrap)
      || v10.state.fieldCampTileIds.length > v11.state.fieldCampTileIds.length
      || !v10.state.fieldCampTileIds.every((id, index) => v11.state.fieldCampTileIds[index] === id)
      || v10.state.mireglass.cacheExcavated && !v11.state.mireglass.cacheExcavated) return false
    if (v11.saveRevision === 0) {
      const initial = encodePublicV11Head(withPublicV11Highland(v10.state), v10.bootstrap, 0)
      if (!sameValue(initial, value.sourceV11Head)) return false
    }
    return true
  } catch { return false }
}

export function samePublicV12SourceReceipt(a: unknown, b: unknown): boolean {
  return isValidPublicV12SourceReceipt(a) && isValidPublicV12SourceReceipt(b) && sameValue(a, b)
}

/** Revision zero must be the exact additive upgrade of the pinned v11 head. */
export function isPublicV12MigrationHead(head: unknown, sourceReceipt: unknown): boolean {
  if (!isValidPublicV12SourceReceipt(sourceReceipt)) return false
  const decoded = decodePublicV12Head(head)
  if (!decoded || decoded.saveRevision !== 0) return false
  const source = decodePublicV11Head(sourceReceipt.sourceV11Head)!
  return sameValue(decoded.bootstrap, source.bootstrap)
    && sameValue(decoded.state, withPublicV12Windstep(source.state))
}

/** Portable world export contains tile IDs, not a JSON-unsafe typed mask. */
export function serializePublicV12World(state: PublicWorldV12State,
  bootstrap: PublicV6BootstrapRoot | null, saveRevision: number): string {
  const head = encodePublicV12Head(state, bootstrap, saveRevision)
  const bytes = JSON.stringify({ ...head, state })
  if (!parsePublicV12World(bytes)) throw new RangeError('Invalid public v12 export.')
  return bytes
}

export function parsePublicV12World(bytes: string): PublicV12PortableSnapshot | null {
  try {
    if (typeof bytes !== 'string' || bytes.length > 96 * 1024 * 1024) return null
    const value: unknown = JSON.parse(bytes)
    if (!exact(value, HEAD_KEYS) || value.schemaVersion !== PUBLIC_V12_SCHEMA) return null
    const head = encodePublicV12Head(value.state as PublicWorldV12State,
      value.bootstrap as PublicV6BootstrapRoot | null, value.saveRevision as number)
    const canonical = { ...head, state: value.state as PublicWorldV12State }
    return sameValue(canonical, value) ? canonical : null
  } catch { return null }
}

function portableHead(head: PublicV8Head | PublicV9Head | PublicV10Head | PublicV11Head) {
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

function validRescueOrigin(snapshot: PublicV12PortableSnapshot,
  source: PublicV12SourceReceipt): boolean {
  const v11 = decodePublicV11Head(source.sourceV11Head)!
  if (snapshot.state.seed !== v11.state.seed
    || snapshot.state.generationProfile !== v11.state.generationProfile
    || !sameValue(snapshot.bootstrap, v11.bootstrap)
    || v11.state.fieldCampTileIds.length > snapshot.state.fieldCampTileIds.length
    || !v11.state.fieldCampTileIds.every((id, index) => snapshot.state.fieldCampTileIds[index] === id)
    || v11.state.mireglass.cacheExcavated && !snapshot.state.mireglass.cacheExcavated
    || v11.state.highland.landmarkDiscovered && !snapshot.state.highland.landmarkDiscovered
    || v11.state.highland.stoneNodes.some((node, index) =>
      node.id !== snapshot.state.highland.stoneNodes[index]?.id
      || node.readyAtTick > snapshot.state.highland.stoneNodes[index].readyAtTick)) return false
  if (snapshot.saveRevision === 0
    && !sameValue(snapshot.state, withPublicV12Windstep(v11.state))) return false
  return true
}

/** Rescue is read-only evidence; importing still needs live-source checks and CAS. */
export function serializePublicV12Rescue(state: PublicWorldV12State,
  bootstrap: PublicV6BootstrapRoot | null, saveRevision: number,
  sourceReceipt: PublicV12SourceReceipt): string {
  if (!publicV12RescueSourceFitsCap(sourceReceipt)) throw new RangeError('Public v12 rescue source exceeds 8 MiB.')
  if (!isValidPublicV12SourceReceipt(sourceReceipt)) throw new RangeError('Invalid public v12 rescue source.')
  const snapshot = parsePublicV12World(serializePublicV12World(state, bootstrap, saveRevision))!
  const bytes = JSON.stringify({ schemaVersion: PUBLIC_V12_RESCUE_SCHEMA, snapshot,
    sourceV11Head: portableHead(sourceReceipt.sourceV11Head),
    sourceV11Receipt: { sourceV10Head: portableHead(sourceReceipt.sourceV11Receipt.sourceV10Head),
      sourceV10Lineage: {
        sourceV9Head: portableHead(sourceReceipt.sourceV11Receipt.sourceV10Lineage.sourceV9Head),
        sourceV9Lineage: {
          sourceV8Head: portableHead(sourceReceipt.sourceV11Receipt.sourceV10Lineage.sourceV9Lineage.sourceV8Head),
          sourceV7Bytes: sourceReceipt.sourceV11Receipt.sourceV10Lineage.sourceV9Lineage.sourceV7Bytes,
        },
      },
    },
  })
  const parsed = parsePublicV12Rescue(bytes)
  if (!parsed || !samePublicV12SourceReceipt(parsed.sourceReceipt, sourceReceipt)) {
    throw new RangeError('Invalid public v12 rescue origin.')
  }
  return bytes
}

export function parsePublicV12Rescue(bytes: string): PublicV12Rescue | null {
  try {
    if (typeof bytes !== 'string' || bytes.length > MAX_PUBLIC_V12_RESCUE_BYTES
      || new TextEncoder().encode(bytes).byteLength > MAX_PUBLIC_V12_RESCUE_BYTES) return null
    const value: unknown = JSON.parse(bytes)
    if (!exact(value, ['schemaVersion', 'snapshot', 'sourceV11Head', 'sourceV11Receipt'])
      || value.schemaVersion !== PUBLIC_V12_RESCUE_SCHEMA
      || !exact(value.sourceV11Receipt, ['sourceV10Head', 'sourceV10Lineage'])
      || !exact(value.sourceV11Receipt.sourceV10Lineage, ['sourceV9Head', 'sourceV9Lineage'])
      || !exact(value.sourceV11Receipt.sourceV10Lineage.sourceV9Lineage,
        ['sourceV8Head', 'sourceV7Bytes'])
      || typeof value.sourceV11Receipt.sourceV10Lineage.sourceV9Lineage.sourceV7Bytes !== 'string') return null
    const snapshot = parsePublicV12World(JSON.stringify(value.snapshot))
    if (!snapshot) return null
    const sourceReceipt = {
      sourceV11Head: restoreHeadMask(value.sourceV11Head),
      sourceV11Receipt: {
        sourceV10Head: restoreHeadMask(value.sourceV11Receipt.sourceV10Head),
        sourceV10Lineage: {
          sourceV9Head: restoreHeadMask(value.sourceV11Receipt.sourceV10Lineage.sourceV9Head),
          sourceV9Lineage: {
            sourceV8Head: restoreHeadMask(value.sourceV11Receipt.sourceV10Lineage.sourceV9Lineage.sourceV8Head),
            sourceV7Bytes: value.sourceV11Receipt.sourceV10Lineage.sourceV9Lineage.sourceV7Bytes,
          },
        },
      },
    }
    if (!isValidPublicV12SourceReceipt(sourceReceipt)
      || !validRescueOrigin(snapshot, sourceReceipt)) return null
    return { schemaVersion: PUBLIC_V12_RESCUE_SCHEMA, snapshot, sourceReceipt }
  } catch { return null }
}
