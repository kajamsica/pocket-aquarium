import { STARTER_CLIFF_PROFILE } from './starterCliffProfile'
import { createFreshPublicV14Head, decodePublicV14FrameWitness,
  decodePublicV14Lineage, PUBLIC_V14_SCHEMA } from './publicWorldV14Snapshot'
import type { PublicV14FrameWitness, PublicV14Head, PublicV14Lineage,
  PublicV14State } from './publicWorldV14Snapshot'
import { publicWorldV15SuppressedStarterResourceIds } from './publicWorldV15StarterSites'
import { decodePublicV15Progress } from './publicWorldV15Validation'
import { samePublicV14Value, validatePublicV14State } from './publicWorldV14Validation'

export const PUBLIC_V15_SCHEMA = 'wizard-world/v15' as const
export const PUBLIC_V15_RULES_PROFILE = 'starter-crossing/v2' as const
export const PUBLIC_V15_LEGACY_RULES_PROFILE = 'starter-crossing/v1' as const
export const PUBLIC_V15_DATABASE_NAME = 'wizard-realms:world:v15' as const

/** The P28 shell keeps the v14 core inert; v15-only starter facts live outside it. */
export type PublicV15StarterWorks = Readonly<{ bridgeBuilt: boolean; bankCacheDug: boolean }>
export type PublicV15ResourceClearance = Readonly<{ suppressedResourceIds: readonly string[] }>
export type PublicV15Lineage = Readonly<PublicV14Lineage & {
  rulesProfile: typeof PUBLIC_V15_RULES_PROFILE
}>
export type PublicV15Head = Readonly<{
  schemaVersion: typeof PUBLIC_V15_SCHEMA
  saveRevision: number
  bootstrap: null
  state: PublicV14State
  starterWorks: PublicV15StarterWorks
  resourceClearance: PublicV15ResourceClearance
  frameWitness?: PublicV14FrameWitness
}>

const EMPTY_STARTER_WORKS: PublicV15StarterWorks = Object.freeze({
  bridgeBuilt: false, bankCacheDug: false,
})
function canonicalResourceClearance(seed: string): PublicV15ResourceClearance {
  const resources = createFreshPublicV14Head(seed).head.state.greenway.resources
  return { suppressedResourceIds: publicWorldV15SuppressedStarterResourceIds(seed, resources) }
}
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
const denseOrdinaryStrings = (value: unknown, expectedLength: number): value is string[] => {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length !== expectedLength) return false
    const keys = Reflect.ownKeys(value)
    if (keys.length !== expectedLength + 1 || keys[expectedLength] !== 'length') return false
    const length = Object.getOwnPropertyDescriptor(value, 'length')
    if (!length || length.enumerable || length.configurable || !length.writable
      || length.value !== expectedLength) return false
    for (let index = 0; index < expectedLength; index++) {
      if (keys[index] !== String(index)) return false
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable
        || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'string') return false
    }
    return true
  } catch { return false }
}

export function publicV15ToV14Lineage(lineage: PublicV15Lineage): PublicV14Lineage {
  return { origin: lineage.origin, seed: lineage.seed,
    generationProfile: lineage.generationProfile }
}

export function decodePublicV15Lineage(value: unknown): PublicV15Lineage | null {
  try {
    if (!exact(value, ['origin', 'seed', 'generationProfile', 'rulesProfile'])
      || value.rulesProfile !== PUBLIC_V15_RULES_PROFILE) return null
    const old = decodePublicV14Lineage({ origin: value.origin, seed: value.seed,
      generationProfile: value.generationProfile })
    if (!old) return null
    const cloned = structuredClone(value)
    if (!exact(cloned, ['origin', 'seed', 'generationProfile', 'rulesProfile'])
      || cloned.rulesProfile !== PUBLIC_V15_RULES_PROFILE) return null
    return { ...old, rulesProfile: PUBLIC_V15_RULES_PROFILE }
  } catch { return null }
}

/** V1 experimental roots are recognizable but never silently resumed under V2 rules. */
export function isLegacyPublicV15Lineage(value: unknown): boolean {
  try {
    if (!exact(value, ['origin', 'seed', 'generationProfile', 'rulesProfile'])
      || value.rulesProfile !== PUBLIC_V15_LEGACY_RULES_PROFILE) return false
    const old = decodePublicV14Lineage({ origin: value.origin, seed: value.seed,
      generationProfile: value.generationProfile })
    if (!old) return false
    const cloned = structuredClone(value)
    return exact(cloned, ['origin', 'seed', 'generationProfile', 'rulesProfile'])
      && cloned.rulesProfile === PUBLIC_V15_LEGACY_RULES_PROFILE
  } catch { return false }
}

/** A v15 head is never a v14 head, even when the core state still has v14 gameplay rules. */
export function decodePublicV15Head(value: unknown, rawLineage: unknown): PublicV15Head | null {
  try {
    const lineage = decodePublicV15Lineage(rawLineage)
    const withWitness = value !== null && typeof value === 'object'
      && Reflect.ownKeys(value).includes('frameWitness')
    if (!lineage || !exact(value, withWitness
      ? ['schemaVersion', 'saveRevision', 'bootstrap', 'state', 'starterWorks',
        'resourceClearance', 'frameWitness']
      : ['schemaVersion', 'saveRevision', 'bootstrap', 'state', 'starterWorks',
        'resourceClearance'])
      || value.schemaVersion !== PUBLIC_V15_SCHEMA
      || !exact(value.starterWorks, ['bridgeBuilt', 'bankCacheDug'])
      || typeof value.starterWorks.bridgeBuilt !== 'boolean'
      || typeof value.starterWorks.bankCacheDug !== 'boolean'
      || !exact(value.resourceClearance, ['suppressedResourceIds'])) return null
    const clearance = canonicalResourceClearance(lineage.seed)
    if (!denseOrdinaryStrings(value.resourceClearance.suppressedResourceIds,
      clearance.suppressedResourceIds.length)
      || !value.resourceClearance.suppressedResourceIds.every((id, index) =>
        id === clearance.suppressedResourceIds[index])) return null
    if (value.bootstrap !== null || !Number.isSafeInteger(value.saveRevision)
      || (value.saveRevision as number) < 0) return null
    const frameWitness = withWitness ? decodePublicV14FrameWitness(value.frameWitness) : null
    if (withWitness && (!frameWitness || value.saveRevision === 0)) return null
    const progress = decodePublicV15Progress({ state: value.state,
      starterWorks: value.starterWorks }, lineage.seed)
    if (!progress) return null
    if (value.saveRevision === 0 && (progress.starterWorks.bridgeBuilt
      || progress.starterWorks.bankCacheDug
      || !samePublicV14Value(progress.state, createFreshPublicV14Head(lineage.seed).head.state))) {
      return null
    }
    structuredClone(value)
    return { schemaVersion: PUBLIC_V15_SCHEMA, saveRevision: value.saveRevision as number,
      bootstrap: null, state: progress.state, starterWorks: progress.starterWorks,
      resourceClearance: clearance,
      ...(frameWitness ? { frameWitness } : {}) }
  } catch { return null }
}

export function createFreshPublicV15Head(seed: string): {
  lineage: PublicV15Lineage; head: PublicV15Head
} {
  const old = createFreshPublicV14Head(seed)
  const lineage: PublicV15Lineage = { origin: 'fresh', seed,
    generationProfile: STARTER_CLIFF_PROFILE, rulesProfile: PUBLIC_V15_RULES_PROFILE }
  const head = decodePublicV15Head({ schemaVersion: PUBLIC_V15_SCHEMA,
    saveRevision: 0, bootstrap: null, state: old.head.state,
    starterWorks: { ...EMPTY_STARTER_WORKS },
    resourceClearance: canonicalResourceClearance(seed) }, lineage)
  if (!head) throw new RangeError('Invalid fresh v15 world.')
  return { lineage, head }
}

export function encodePublicV15Head(state: PublicV14State, saveRevision: number,
  lineage: PublicV15Lineage, frameWitness?: PublicV14FrameWitness,
  starterWorks: PublicV15StarterWorks = EMPTY_STARTER_WORKS,
  resourceClearance: PublicV15ResourceClearance = canonicalResourceClearance(lineage.seed)): PublicV15Head {
  const head = decodePublicV15Head({ schemaVersion: PUBLIC_V15_SCHEMA,
    saveRevision, bootstrap: null, state, starterWorks, resourceClearance,
    ...(frameWitness ? { frameWitness } : {}) }, lineage)
  if (!head) throw new RangeError('Invalid v15 world head.')
  return head
}

export function publicV15ToV14Head(head: PublicV15Head): PublicV14Head {
  if (head.starterWorks.bridgeBuilt || head.starterWorks.bankCacheDug
    || !validatePublicV14State(head.state, head.state.seed)) {
    throw new RangeError('A native v15 head cannot be projected as v14 authority.')
  }
  return { schemaVersion: PUBLIC_V14_SCHEMA, saveRevision: head.saveRevision,
    bootstrap: null, state: head.state,
    ...(head.frameWitness ? { frameWitness: head.frameWitness } : {}) }
}

// Kept adjacent to the envelope so its replay witness remains the v14 bounded format.
export { decodePublicV14FrameWitness }
