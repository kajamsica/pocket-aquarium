import { STARTER_CLIFF_PROFILE } from './starterCliffProfile'
import type { PublicWorldIntent } from './publicWorldRuntime'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import { createFreshPublicV14State, samePublicV14Value,
  validatePublicV14State } from './publicWorldV14Validation'

export const PUBLIC_V14_SCHEMA = 'wizard-world/v14' as const
export type PublicV14State = Omit<PublicV13Head['state'], 'generationProfile' | 'movementOwner'> & {
  readonly generationProfile: typeof STARTER_CLIFF_PROFILE
  readonly movementOwner: 'greenway' | 'streamed'
}
export type PublicV14Head = Readonly<{
  schemaVersion: typeof PUBLIC_V14_SCHEMA
  saveRevision: number
  bootstrap: null
  state: PublicV14State
  frameWitness?: PublicV14FrameWitness
}>
export type PublicV14Frame = Readonly<{
  intents: readonly PublicWorldIntent[]
  walkRequested: boolean
}>
export type PublicV14FrameWitness = Readonly<{
  kind: 'frame-batch/v1'
  frames: readonly PublicV14Frame[]
}>
export const PUBLIC_V14_MAX_FRAME_BATCH = 128
export type PublicV14Lineage = Readonly<{
  origin: 'fresh'
  seed: string
  generationProfile: typeof STARTER_CLIFF_PROFILE
}>

const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype
      && Reflect.ownKeys(value).length === keys.length
      && keys.every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
      })
  } catch { return false }
}
const denseArray = (value: unknown, maxLength: number): value is unknown[] => {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > maxLength) return false
    const keys = Reflect.ownKeys(value)
    if (keys.length !== value.length + 1 || keys[value.length] !== 'length') return false
    for (let index = 0; index < value.length; index++) {
      const key = String(index), descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (keys[index] !== key || !descriptor?.enumerable
        || !Object.hasOwn(descriptor, 'value')) return false
    }
    return true
  } catch { return false }
}

/** A bounded, data-only transcript. Its recorded intentions are not gameplay authority. */
export function decodePublicV14FrameWitness(value: unknown): PublicV14FrameWitness | null {
  try {
    if (!exact(value, ['kind', 'frames']) || value.kind !== 'frame-batch/v1'
      || !denseArray(value.frames, PUBLIC_V14_MAX_FRAME_BATCH)
      || value.frames.length < 1) return null
    const frames: PublicV14Frame[] = []
    for (let frameIndex = 0; frameIndex < value.frames.length; frameIndex++) {
      const rawFrame = value.frames[frameIndex]
      if (!exact(rawFrame, ['intents', 'walkRequested'])
        || typeof rawFrame.walkRequested !== 'boolean'
        || !denseArray(rawFrame.intents, 2)) return null
      const intents: PublicWorldIntent[] = []
      for (let intentIndex = 0; intentIndex < rawFrame.intents.length; intentIndex++) {
        const intent = rawFrame.intents[intentIndex]
        if (exact(intent, ['type']) && intent.type === 'jump') {
          intents.push({ type: 'jump' }); continue
        }
        if (exact(intent, ['type', 'yawDelta', 'pitchDelta']) && intent.type === 'look'
          && Number.isFinite(intent.yawDelta) && Number.isFinite(intent.pitchDelta)
          && Math.abs(intent.yawDelta as number) <= 1e6
          && Math.abs(intent.pitchDelta as number) <= 1e6) {
          intents.push({ type: 'look', yawDelta: intent.yawDelta as number,
            pitchDelta: intent.pitchDelta as number }); continue
        }
        if (exact(intent, ['type', 'delta']) && intent.type === 'move'
          && exact(intent.delta, ['x', 'z'])
          && Number.isFinite(intent.delta.x) && Number.isFinite(intent.delta.z)
          && Math.hypot(intent.delta.x as number, intent.delta.z as number) <= 0.24 + 1e-9) {
          intents.push({ type: 'move', delta: { x: intent.delta.x as number,
            z: intent.delta.z as number } }); continue
        }
        return null
      }
      if (intents.length === 2 && (intents[0].type !== 'look' || intents[1].type !== 'move')) return null
      frames.push({ intents, walkRequested: rawFrame.walkRequested })
    }
    // Reject Proxy-backed inputs after validating every descriptor.
    structuredClone(value)
    return { kind: 'frame-batch/v1', frames }
  } catch { return null }
}

export function decodePublicV14Lineage(value: unknown): PublicV14Lineage | null {
  try {
    if (!exact(value, ['origin', 'seed', 'generationProfile'])) return null
    const origin = Object.getOwnPropertyDescriptor(value, 'origin')?.value
    const seed = Object.getOwnPropertyDescriptor(value, 'seed')?.value
    const profile = Object.getOwnPropertyDescriptor(value, 'generationProfile')?.value
    if (origin !== 'fresh' || typeof seed !== 'string' || !seed || seed.length > 128
      || profile !== STARTER_CLIFF_PROFILE) return null
    // A Proxy can imitate plain descriptors, but cannot cross this clone boundary.
    const owned = structuredClone(value)
    if (!exact(owned, ['origin', 'seed', 'generationProfile'])
      || owned.origin !== origin || owned.seed !== seed || owned.generationProfile !== profile) return null
    return { origin: 'fresh', seed, generationProfile: STARTER_CLIFF_PROFILE }
  } catch { return null }
}

/** A standalone compact head; no v11/v12 source, v13 lease, or legacy witness. */
export function decodePublicV14Head(value: unknown, rawLineage: unknown): PublicV14Head | null {
  try {
    const lineage = decodePublicV14Lineage(rawLineage)
    const hasWitness = value !== null && typeof value === 'object'
      && Reflect.ownKeys(value).includes('frameWitness')
    if (!lineage || !exact(value, hasWitness
      ? ['schemaVersion', 'saveRevision', 'bootstrap', 'state', 'frameWitness']
      : ['schemaVersion', 'saveRevision', 'bootstrap', 'state'])
      || value.schemaVersion !== PUBLIC_V14_SCHEMA || value.bootstrap !== null
      || !Number.isSafeInteger(value.saveRevision) || (value.saveRevision as number) < 0) return null
    const frameWitness = hasWitness ? decodePublicV14FrameWitness(value.frameWitness) : null
    if (hasWitness && (!frameWitness || value.saveRevision === 0)) return null
    const state = validatePublicV14State(value.state, lineage.seed)
    if (!state || state.generationProfile !== lineage.generationProfile) return null
    if (value.saveRevision === 0
      && !samePublicV14Value(state, createFreshPublicV14State(lineage.seed))) return null
    return { schemaVersion: PUBLIC_V14_SCHEMA, saveRevision: value.saveRevision as number,
      bootstrap: null, state, ...(frameWitness ? { frameWitness } : {}) }
  } catch { return null }
}

export function createFreshPublicV14Head(seed: string): {
  lineage: PublicV14Lineage; head: PublicV14Head
} {
  const state = createFreshPublicV14State(seed)
  const lineage: PublicV14Lineage = { origin: 'fresh', seed,
    generationProfile: STARTER_CLIFF_PROFILE }
  const head = decodePublicV14Head({ schemaVersion: PUBLIC_V14_SCHEMA,
    saveRevision: 0, bootstrap: null, state }, lineage)
  if (!head) throw new RangeError('Invalid fresh v14 world.')
  return { lineage, head }
}

export function encodePublicV14Head(state: PublicV14State, saveRevision: number,
  lineage: PublicV14Lineage, frameWitness?: PublicV14FrameWitness): PublicV14Head {
  const head = decodePublicV14Head({ schemaVersion: PUBLIC_V14_SCHEMA,
    saveRevision, bootstrap: null, state, ...(frameWitness ? { frameWitness } : {}) }, lineage)
  if (!head) throw new RangeError('Invalid v14 world head.')
  return head
}
