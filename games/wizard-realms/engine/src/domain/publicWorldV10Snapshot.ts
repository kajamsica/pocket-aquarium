import { createActiveWorldTerrain } from './activeWorldTerrain'
import { DISCOVERY_MASK_BYTES } from './discoveryMask'
import { parsePublicV7PlayableRoot } from './publicWorldV7'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { decodePublicV8Head, encodePublicV8Head } from './publicWorldV8Snapshot'
import type { PublicV8Head } from './publicWorldV8Snapshot'
import { decodePublicV9Head, encodePublicV9Head, isValidPublicV9SourceReceipt } from './publicWorldV9Snapshot'
import type { PublicV9Head, PublicV9SourceReceipt } from './publicWorldV9Snapshot'
import { isValidPublicWorldV10State, publicV10BaseGroundWitness } from './publicWorldV10State'
import type { PublicWorldV10State } from './publicWorldV10State'

export const PUBLIC_V10_SCHEMA = 'wizard-world/v10'
export const PUBLIC_V10_RESCUE_SCHEMA = 'wizard-world/v10-rescue'

export type PublicV10Head = Omit<PublicV9Head, 'schemaVersion' | 'state'> & {
  readonly schemaVersion: typeof PUBLIC_V10_SCHEMA
  readonly state: PublicV9Head['state'] & { readonly terrainRevision: PublicWorldV10State['terrainRevision'] }
}
export type PublicV10SourceReceipt = {
  readonly sourceV9Head: PublicV9Head
  readonly sourceV9Lineage: PublicV9SourceReceipt
}
export type PublicV10PortableSnapshot = Omit<PublicV10Head, 'state'> & { readonly state: PublicWorldV10State }
export type PublicV10Rescue = {
  readonly schemaVersion: typeof PUBLIC_V10_RESCUE_SCHEMA
  readonly snapshot: PublicV10PortableSnapshot
  readonly sourceReceipt: PublicV10SourceReceipt
}

const HEAD_KEYS = ['schemaVersion', 'saveRevision', 'bootstrap', 'state']
const STATE_KEYS = ['seed', 'generationProfile', 'movementOwner', 'tick', 'rng',
  'eventSequence', 'player', 'discoveryMask', 'greenway', 'mireglass',
  'fieldCampTileIds', 'terrainRevision']
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

/** The typed head keeps the real pose, even when it is below v9's seed ground. */
export function encodePublicV10Head(state: PublicWorldV10State,
  bootstrap: PublicV6BootstrapRoot | null, saveRevision: number): PublicV10Head {
  if (!isValidPublicWorldV10State(state, bootstrap)) throw new RangeError('Invalid public v10 world state.')
  const witness = publicV10BaseGroundWitness(state)
  const v9 = encodePublicV9Head(witness, bootstrap, saveRevision)
  return { ...v9, schemaVersion: PUBLIC_V10_SCHEMA,
    state: { ...v9.state, player: state.player, terrainRevision: state.terrainRevision } }
}

export function decodePublicV10Head(value: unknown): {
  state: PublicWorldV10State; bootstrap: PublicV6BootstrapRoot | null; saveRevision: number
} | null {
  try {
    if (!exact(value, HEAD_KEYS) || value.schemaVersion !== PUBLIC_V10_SCHEMA
      || !exact(value.state, STATE_KEYS)) return null
    const { terrainRevision, ...state } = value.state
    const candidate = value as PublicV10Head
    const mask = candidate.state.discoveryMask
    if (!(mask instanceof Uint8Array) || mask.length !== DISCOVERY_MASK_BYTES) return null
    // Decode through the old codec with a detached seed-ground witness. The
    // v10 validator below separately proves the real persisted pose.
    let witnessPlayer = candidate.state.player
    if (candidate.state.movementOwner === 'streamed') {
      const position = candidate.state.player.position
      const terrain = createActiveWorldTerrain(candidate.state.seed)
      terrain.activate(position)
      const base = terrain.tileAtWorld(position.x, position.z)
      if (!base) return null
      witnessPlayer = { ...candidate.state.player,
        position: { ...position, y: Math.max(position.y, base.center.y) } }
    }
    const provisional = decodePublicV9Head({ ...value, schemaVersion: 'wizard-world/v9',
      state: { ...state, player: witnessPlayer } })
    if (!provisional) return null
    const actual = { ...provisional.state, player: candidate.state.player, terrainRevision }
    if (!isValidPublicWorldV10State(actual, provisional.bootstrap)) return null
    const expected = encodePublicV10Head(actual, provisional.bootstrap, provisional.saveRevision)
    return sameValue(expected, value) ? { ...provisional, state: actual } : null
  } catch { return null }
}

/** Validate the immutable v9 source and its original v8/v7 lineage. */
export function isValidPublicV10SourceReceipt(value: unknown): value is PublicV10SourceReceipt {
  try {
    if (!exact(value, ['sourceV9Head', 'sourceV9Lineage'])
      || !isValidPublicV9SourceReceipt(value.sourceV9Lineage)) return false
    const head = decodePublicV9Head(value.sourceV9Head)
    const v8 = decodePublicV8Head(value.sourceV9Lineage.sourceV8Head)
    if (!head || !v8 || head.state.seed !== v8.state.seed
      || head.state.generationProfile !== v8.state.generationProfile
      || !sameValue(head.bootstrap, v8.bootstrap)) return false
    if (v8.saveRevision === 0) {
      const v7 = parsePublicV7PlayableRoot(value.sourceV9Lineage.sourceV7Bytes)
      if (!v7 || !sameValue(value.sourceV9Lineage.sourceV8Head,
        encodePublicV8Head(v7.state, v7.bootstrap, 0))) return false
    }
    if (head.saveRevision === 0) {
      const initial = encodePublicV9Head({ ...v8.state, fieldCampTileIds: [] }, v8.bootstrap, 0)
      if (!sameValue(initial, value.sourceV9Head)) return false
    }
    return true
  } catch { return false }
}

export function samePublicV10SourceReceipt(a: unknown, b: unknown): boolean {
  return isValidPublicV10SourceReceipt(a) && isValidPublicV10SourceReceipt(b)
    && sameValue(a, b)
}

/** Portable world export uses IDs rather than a JSON-unsafe Uint8Array. */
export function serializePublicV10World(state: PublicWorldV10State,
  bootstrap: PublicV6BootstrapRoot | null, saveRevision: number): string {
  const checked = encodePublicV10Head(state, bootstrap, saveRevision)
  const bytes = JSON.stringify({ ...checked, state })
  if (!parsePublicV10World(bytes)) throw new RangeError('Invalid public v10 export.')
  return bytes
}

export function parsePublicV10World(bytes: string): PublicV10PortableSnapshot | null {
  try {
    if (typeof bytes !== 'string' || bytes.length > 96 * 1024 * 1024) return null
    const value: unknown = JSON.parse(bytes)
    if (!exact(value, HEAD_KEYS) || value.schemaVersion !== PUBLIC_V10_SCHEMA) return null
    const head = encodePublicV10Head(value.state as PublicWorldV10State,
      value.bootstrap as PublicV6BootstrapRoot | null, value.saveRevision as number)
    return { ...head, state: value.state as PublicWorldV10State }
  } catch { return null }
}

/** Array bytes are explicit so JSON never silently turns a typed mask into numeric object keys. */
function portableHead(head: PublicV8Head | PublicV9Head) {
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

function validRescueOrigin(snapshot: PublicV10PortableSnapshot,
  source: PublicV10SourceReceipt): boolean {
  const v9 = decodePublicV9Head(source.sourceV9Head)!
  if (snapshot.state.seed !== v9.state.seed
    || snapshot.state.generationProfile !== v9.state.generationProfile
    || !sameValue(snapshot.bootstrap, v9.bootstrap)) return false
  // A later rescue may add a camp or excavation, but it cannot erase work
  // already present in the immutable v9 source receipt.
  if (v9.state.fieldCampTileIds.length > snapshot.state.fieldCampTileIds.length
    || !v9.state.fieldCampTileIds.every((id, index) => snapshot.state.fieldCampTileIds[index] === id)
    || v9.state.mireglass.cacheExcavated && !snapshot.state.mireglass.cacheExcavated) return false
  if (snapshot.saveRevision === 0) {
    const { terrainRevision: _revision, ...state } = snapshot.state
    if (!sameValue(state, v9.state)) return false
  }
  return true
}

export function serializePublicV10Rescue(state: PublicWorldV10State,
  bootstrap: PublicV6BootstrapRoot | null, saveRevision: number,
  sourceReceipt: PublicV10SourceReceipt): string {
  if (!isValidPublicV10SourceReceipt(sourceReceipt)) throw new RangeError('Invalid public v10 rescue source.')
  const snapshot = parsePublicV10World(serializePublicV10World(state, bootstrap, saveRevision))!
  const bytes = JSON.stringify({ schemaVersion: PUBLIC_V10_RESCUE_SCHEMA, snapshot,
    sourceV9Head: portableHead(sourceReceipt.sourceV9Head),
    sourceV9Lineage: { sourceV8Head: portableHead(sourceReceipt.sourceV9Lineage.sourceV8Head),
      sourceV7Bytes: sourceReceipt.sourceV9Lineage.sourceV7Bytes } })
  const parsed = parsePublicV10Rescue(bytes)
  if (!parsed || !samePublicV10SourceReceipt(parsed.sourceReceipt, sourceReceipt)) {
    throw new RangeError('Invalid public v10 rescue origin.')
  }
  return bytes
}

/** Consistency check only; recovery still requires live-source comparison and CAS. */
export function parsePublicV10Rescue(bytes: string): PublicV10Rescue | null {
  try {
    if (typeof bytes !== 'string' || bytes.length > 3 * 96 * 1024 * 1024) return null
    const value: unknown = JSON.parse(bytes)
    if (!exact(value, ['schemaVersion', 'snapshot', 'sourceV9Head', 'sourceV9Lineage'])
      || value.schemaVersion !== PUBLIC_V10_RESCUE_SCHEMA
      || !exact(value.sourceV9Lineage, ['sourceV8Head', 'sourceV7Bytes'])
      || typeof value.sourceV9Lineage.sourceV7Bytes !== 'string') return null
    const snapshot = parsePublicV10World(JSON.stringify(value.snapshot))
    if (!snapshot) return null
    const sourceReceipt = { sourceV9Head: restoreHeadMask(value.sourceV9Head),
      sourceV9Lineage: { sourceV8Head: restoreHeadMask(value.sourceV9Lineage.sourceV8Head),
        sourceV7Bytes: value.sourceV9Lineage.sourceV7Bytes } }
    if (!isValidPublicV10SourceReceipt(sourceReceipt)
      || !validRescueOrigin(snapshot, sourceReceipt)) return null
    return { schemaVersion: PUBLIC_V10_RESCUE_SCHEMA, snapshot, sourceReceipt }
  } catch { return null }
}
