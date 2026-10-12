import { STARTER_CLIFF_PROFILE } from './starterCliffProfile'
import { createFreshPublicV14State, samePublicV14Value } from './publicWorldV14Validation'
import { decodePublicV14FrameWitness } from './publicWorldV14Snapshot'
import type { PublicV14FrameWitness, PublicV14State } from './publicWorldV14Snapshot'
import { mapValidatedV15ToV16Start } from './publicWorldV16Migration'
import type { PublicV16GreenwayWorks, PublicV16MigrationSource } from './publicWorldV16Migration'
import { decodePublicV16Progress } from './publicWorldV16Validation'
import type { PublicV16Progress } from './publicWorldV16Validation'

export const PUBLIC_V16_SCHEMA = 'wizard-world/v16' as const
export const PUBLIC_V16_RULES_PROFILE = 'greenway-works/v1' as const
export const PUBLIC_V16_DATABASE_NAME = 'wizard-realms:world:v16' as const

export type PublicV16Lineage = Readonly<{
  origin: 'fresh' | 'v15-migration'
  seed: string
  generationProfile: typeof STARTER_CLIFF_PROFILE
  rulesProfile: typeof PUBLIC_V16_RULES_PROFILE
  sourceReceipt: PublicV16MigrationSource | null
}>
export type PublicV16Head = Readonly<{
  schemaVersion: typeof PUBLIC_V16_SCHEMA
  saveRevision: number
  bootstrap: null
  state: PublicV14State
  greenwayWorks: PublicV16GreenwayWorks
  frameWitness?: PublicV14FrameWitness
}>

const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype
      && Reflect.ownKeys(value).length === keys.length
      && keys.every((key) => {
        const field = Object.getOwnPropertyDescriptor(value, key)
        return !!field?.enumerable && Object.hasOwn(field, 'value')
      })
  } catch { return false }
}

function mappedSource(value: unknown) {
  if (!exact(value, ['saveRevision', 'lineage', 'state', 'starterWorks'])) return null
  const mapped = mapValidatedV15ToV16Start({ ...value, bootstrap: null })
  return mapped && samePublicV14Value(mapped.sourceReceipt, value) ? mapped : null
}

export function decodePublicV16Lineage(value: unknown): PublicV16Lineage | null {
  try {
    if (!exact(value, ['origin', 'seed', 'generationProfile', 'rulesProfile', 'sourceReceipt'])
      || value.origin !== 'fresh' && value.origin !== 'v15-migration'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128
      || value.generationProfile !== STARTER_CLIFF_PROFILE
      || value.rulesProfile !== PUBLIC_V16_RULES_PROFILE) return null
    if (value.origin === 'fresh' ? value.sourceReceipt !== null
      : !mappedSource(value.sourceReceipt)
        || (value.sourceReceipt as PublicV16MigrationSource).lineage.seed !== value.seed) return null
    const owned = structuredClone(value) as PublicV16Lineage
    if (!samePublicV14Value(value, owned)) return null
    return owned
  } catch { return null }
}

/** The head envelope is separate from every earlier schema and database. */
export function decodePublicV16Head(value: unknown, rawLineage: unknown): PublicV16Head | null {
  try {
    const lineage = decodePublicV16Lineage(rawLineage)
    const withWitness = value !== null && typeof value === 'object'
      && Reflect.ownKeys(value).includes('frameWitness')
    if (!lineage || !exact(value, withWitness
      ? ['schemaVersion', 'saveRevision', 'bootstrap', 'state', 'greenwayWorks', 'frameWitness']
      : ['schemaVersion', 'saveRevision', 'bootstrap', 'state', 'greenwayWorks'])
      || value.schemaVersion !== PUBLIC_V16_SCHEMA || value.bootstrap !== null
      || !Number.isSafeInteger(value.saveRevision) || (value.saveRevision as number) < 0) return null
    const frameWitness = withWitness ? decodePublicV14FrameWitness(value.frameWitness) : null
    if (withWitness && (!frameWitness || value.saveRevision === 0)) return null
    const progress = decodePublicV16Progress({ state: value.state,
      greenwayWorks: value.greenwayWorks }, lineage.seed)
    if (!progress) return null
    if (value.saveRevision === 0) {
      const mapped = lineage.origin === 'v15-migration'
        ? mappedSource(lineage.sourceReceipt) : null
      if (lineage.origin === 'v15-migration' && !mapped) return null
      const initialState = mapped?.state ?? createFreshPublicV14State(lineage.seed)
      const initialWorks = mapped?.greenwayWorks ?? {
        builtBridgeIds: [], builtLadderIds: [], dugTileIds: [] }
      if (!samePublicV14Value(progress.state, initialState)
        || !samePublicV14Value(progress.greenwayWorks, initialWorks)) return null
    }
    structuredClone(value)
    return { schemaVersion: PUBLIC_V16_SCHEMA, saveRevision: value.saveRevision as number,
      bootstrap: null, state: progress.state, greenwayWorks: progress.greenwayWorks,
      ...(frameWitness ? { frameWitness } : {}) }
  } catch { return null }
}

export function createFreshPublicV16Head(seed: string): {
  lineage: PublicV16Lineage; head: PublicV16Head
} {
  const lineage: PublicV16Lineage = { origin: 'fresh', seed,
    generationProfile: STARTER_CLIFF_PROFILE, rulesProfile: PUBLIC_V16_RULES_PROFILE,
    sourceReceipt: null }
  const head = decodePublicV16Head({ schemaVersion: PUBLIC_V16_SCHEMA,
    saveRevision: 0, bootstrap: null, state: createFreshPublicV14State(seed),
    greenwayWorks: { builtBridgeIds: [], builtLadderIds: [], dugTileIds: [] } }, lineage)
  if (!head) throw new RangeError('Invalid fresh v16 world.')
  return { lineage, head }
}

/** This pure helper does not prove the receipt came from an under-lock v15 read. */
export function createMigratedPublicV16Head(sourceStart: unknown): {
  lineage: PublicV16Lineage; head: PublicV16Head
} | null {
  const mapped = mapValidatedV15ToV16Start(sourceStart)
  if (!mapped) return null
  const lineage: PublicV16Lineage = { origin: 'v15-migration', seed: mapped.state.seed,
    generationProfile: STARTER_CLIFF_PROFILE, rulesProfile: PUBLIC_V16_RULES_PROFILE,
    sourceReceipt: mapped.sourceReceipt }
  const head = decodePublicV16Head({ schemaVersion: PUBLIC_V16_SCHEMA,
    saveRevision: 0, bootstrap: null, state: mapped.state,
    greenwayWorks: mapped.greenwayWorks }, lineage)
  return head ? { lineage, head } : null
}

export function encodePublicV16Head(progress: PublicV16Progress, saveRevision: number,
  lineage: PublicV16Lineage, frameWitness?: PublicV14FrameWitness): PublicV16Head {
  const head = decodePublicV16Head({ schemaVersion: PUBLIC_V16_SCHEMA,
    saveRevision, bootstrap: null, state: progress.state, greenwayWorks: progress.greenwayWorks,
    ...(frameWitness ? { frameWitness } : {}) }, lineage)
  if (!head) throw new RangeError('Invalid v16 world head.')
  return head
}
