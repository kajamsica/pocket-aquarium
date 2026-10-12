import { DISCOVERY_MASK_BYTES } from './discoveryMask'
import { preservesPublicV13History } from './publicV13History'
import type { PublicV13Start } from './publicWorldV13Flow'
import { createPublicV13MigrationHead, decodePublicV13Head,
  decodePublicV13SourceLineage, PUBLIC_V13_SCHEMA } from './publicWorldV13Snapshot'
import type { PublicV13Head, PublicV13SourceLineage } from './publicWorldV13Snapshot'

export const PUBLIC_V13_RESCUE_SCHEMA = 'wizard-world/v13-rescue'
const MAX_BYTES = 8 * 1024 * 1024
const NEGATIVE_ZERO = '$v13NegativeZero'
type Rescue = Readonly<{ savedBase: PublicV13Head; unsavedCandidate: PublicV13Head | null;
  sourceLineage: PublicV13SourceLineage }>

const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key))

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true
  }
  return false
}

function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) return false
  if (left instanceof Uint8Array || right instanceof Uint8Array) return left instanceof Uint8Array
    && right instanceof Uint8Array && left.length === right.length
    && left.every((byte, index) => byte === right[index])
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>
  const keys = Reflect.ownKeys(a)
  return keys.length === Reflect.ownKeys(b).length && keys.every((key) => typeof key === 'string'
    && Object.hasOwn(b, key) && same(a[key], b[key]))
}

function checked(savedBase: unknown, unsavedCandidate: unknown,
  sourceLineage: unknown): Rescue | null {
  const lineage = decodePublicV13SourceLineage(sourceLineage)
  const sourceZero = lineage && createPublicV13MigrationHead(lineage)
  const base = lineage && decodePublicV13Head(savedBase, lineage)
  if (!lineage || !sourceZero || !base || !preservesPublicV13History(sourceZero.state, base.state)) return null
  if (unsavedCandidate === null) return { savedBase: base, unsavedCandidate: null, sourceLineage: lineage }
  const candidate = decodePublicV13Head(unsavedCandidate, lineage)
  if (!candidate || !Number.isSafeInteger(base.saveRevision + 1)
    || candidate.saveRevision !== base.saveRevision + 1 || candidate.state.tick <= base.state.tick
    || !preservesPublicV13History(base.state, candidate.state)
    || !preservesPublicV13History(sourceZero.state, candidate.state)
    || !same(base.state.terrainWorks, candidate.state.terrainWorks)) return null
  return { savedBase: base, unsavedCandidate: candidate, sourceLineage: lineage }
}

function portableHead(head: PublicV13Head | PublicV13SourceLineage['sourceHead']) {
  return { ...head, state: { ...head.state, discoveryMask: Array.from(head.state.discoveryMask) } }
}

function restoreHead(value: unknown): unknown {
  if (!exact(value, ['schemaVersion', 'saveRevision', 'bootstrap', 'state'])
    || !value.state || typeof value.state !== 'object' || Array.isArray(value.state)) return null
  const state = value.state as Record<string, unknown>
  const bytes = state.discoveryMask
  if (!Array.isArray(bytes) || bytes.length !== DISCOVERY_MASK_BYTES
    || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null
  return { ...value, state: { ...state, discoveryMask: Uint8Array.from(bytes) } }
}

function stringifyBounded(value: unknown): string {
  let textUnits = 0
  const bytes = JSON.stringify(value, (key, item: unknown) => {
    if (hasLoneSurrogate(key) || typeof item === 'string' && hasLoneSurrogate(item)) {
      throw new RangeError('Public v13 rescue contains malformed Unicode.')
    }
    textUnits += key.length + (typeof item === 'string' ? item.length : 0)
    if (textUnits > MAX_BYTES) throw new RangeError('Public v13 rescue exceeds 8 MiB.')
    return typeof item === 'number' && Object.is(item, -0) ? { [NEGATIVE_ZERO]: true } : item
  })
  if (new TextEncoder().encode(bytes).byteLength > MAX_BYTES) {
    throw new RangeError('Public v13 rescue exceeds 8 MiB.')
  }
  return bytes
}

/** Offline evidence only. Neither this packet nor its parser proves the live CAS head. */
export function serializePublicV13Rescue(savedStart: PublicV13Start,
  unsavedCandidate: PublicV13Head['state'] | null): string {
  const base = savedStart && { schemaVersion: PUBLIC_V13_SCHEMA,
    saveRevision: savedStart.saveRevision, bootstrap: savedStart.bootstrap, state: savedStart.state }
  const candidate = unsavedCandidate === null ? null : savedStart && {
    schemaVersion: PUBLIC_V13_SCHEMA, saveRevision: savedStart.saveRevision + 1,
    bootstrap: savedStart.bootstrap, state: unsavedCandidate }
  const valid = checked(base, candidate, savedStart?.sourceLineage)
  if (!valid || !same(base, valid.savedBase)
    || candidate !== null && !same(candidate, valid.unsavedCandidate)) {
    throw new RangeError('Invalid public v13 rescue history.')
  }
  const bytes = stringifyBounded({ schemaVersion: PUBLIC_V13_RESCUE_SCHEMA,
    sourceLineage: { sourceSchemaVersion: valid.sourceLineage.sourceSchemaVersion,
      sourceHead: portableHead(valid.sourceLineage.sourceHead) },
    savedBase: portableHead(valid.savedBase),
    unsavedCandidate: valid.unsavedCandidate ? portableHead(valid.unsavedCandidate) : null })
  const roundtrip = parsePublicV13Rescue(bytes)
  if (!roundtrip || !same(roundtrip, valid)) throw new RangeError('Invalid public v13 rescue roundtrip.')
  return bytes
}

/** Strict read-only packet validation. Import still needs a new live-source decision and CAS. */
export function parsePublicV13Rescue(bytes: string): Rescue | null {
  try {
    if (typeof bytes !== 'string' || bytes.length > MAX_BYTES
      || new TextEncoder().encode(bytes).byteLength > MAX_BYTES) return null
    const value: unknown = JSON.parse(bytes, (key, item: unknown) => {
      if (hasLoneSurrogate(key) || typeof item === 'string' && hasLoneSurrogate(item)) {
        throw new RangeError('Public v13 rescue contains malformed Unicode.')
      }
      if (item && typeof item === 'object' && !Array.isArray(item)
        && Object.hasOwn(item, NEGATIVE_ZERO)) {
        if (!exact(item, [NEGATIVE_ZERO]) || item[NEGATIVE_ZERO] !== true) throw new RangeError('Invalid numeric tag.')
        return -0
      }
      return item
    })
    if (!exact(value, ['schemaVersion', 'sourceLineage', 'savedBase', 'unsavedCandidate'])
      || value.schemaVersion !== PUBLIC_V13_RESCUE_SCHEMA
      || !exact(value.sourceLineage, ['sourceSchemaVersion', 'sourceHead'])) return null
    const lineage = { ...value.sourceLineage, sourceHead: restoreHead(value.sourceLineage.sourceHead) }
    const base = restoreHead(value.savedBase)
    const candidate = value.unsavedCandidate === null ? null : restoreHead(value.unsavedCandidate)
    if (!base || value.unsavedCandidate !== null && !candidate) return null
    const valid = checked(base, candidate, lineage)
    return valid && same(base, valid.savedBase) && same(candidate, valid.unsavedCandidate)
      && same(lineage, valid.sourceLineage) ? valid : null
  } catch { return null }
}
