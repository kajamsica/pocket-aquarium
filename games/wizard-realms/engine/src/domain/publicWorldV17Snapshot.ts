import { STARTER_CLIFF_PROFILE } from './starterCliffProfile'
import { createFreshPublicV14State, samePublicV14Value } from './publicWorldV14Validation'
import { decodePublicV14FrameWitness } from './publicWorldV14Snapshot'
import type { PublicV14FrameWitness, PublicV14State } from './publicWorldV14Snapshot'
import { mapValidatedV16ToV17Start } from './publicWorldV17Migration'
import type { PublicV17GreenwayWorks, PublicV17MigrationSource } from './publicWorldV17Migration'
import { decodePublicV17Progress } from './publicWorldV17Validation'
import type { PublicV17Progress } from './publicWorldV17Validation'

export const PUBLIC_V17_SCHEMA = 'wizard-world/v17' as const
export const PUBLIC_V17_RULES_PROFILE = 'greenway-freeplace/v1' as const
export const PUBLIC_V17_DATABASE_NAME = 'wizard-realms:world:v17' as const

export type PublicV17Lineage = Readonly<{
  origin: 'fresh' | 'v16-migration'
  seed: string
  generationProfile: typeof STARTER_CLIFF_PROFILE
  rulesProfile: typeof PUBLIC_V17_RULES_PROFILE
  sourceReceipt: PublicV17MigrationSource | null
}>
export type PublicV17Head = Readonly<{
  schemaVersion: typeof PUBLIC_V17_SCHEMA
  saveRevision: number
  bootstrap: null
  state: PublicV14State
  greenwayWorks: PublicV17GreenwayWorks
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
  if (!exact(value, ['saveRevision', 'lineage', 'state', 'greenwayWorks'])) return null
  const mapped = mapValidatedV16ToV17Start({ ...value, bootstrap: null })
  return mapped && samePublicV14Value(mapped.sourceReceipt, value) ? mapped : null
}

export function decodePublicV17Lineage(value: unknown): PublicV17Lineage | null {
  try {
    if (!exact(value, ['origin', 'seed', 'generationProfile', 'rulesProfile', 'sourceReceipt'])
      || value.origin !== 'fresh' && value.origin !== 'v16-migration'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128
      || value.generationProfile !== STARTER_CLIFF_PROFILE
      || value.rulesProfile !== PUBLIC_V17_RULES_PROFILE) return null
    if (value.origin === 'fresh' ? value.sourceReceipt !== null
      : !mappedSource(value.sourceReceipt)
        || (value.sourceReceipt as PublicV17MigrationSource).lineage.seed !== value.seed) return null
    const owned = structuredClone(value) as PublicV17Lineage
    if (!samePublicV14Value(value, owned)) return null
    return owned
  } catch { return null }
}

/** The head envelope is separate from every earlier schema and database. */
export function decodePublicV17Head(value: unknown, rawLineage: unknown): PublicV17Head | null {
  try {
    const lineage = decodePublicV17Lineage(rawLineage)
    const withWitness = value !== null && typeof value === 'object'
      && Reflect.ownKeys(value).includes('frameWitness')
    if (!lineage || !exact(value, withWitness
      ? ['schemaVersion', 'saveRevision', 'bootstrap', 'state', 'greenwayWorks', 'frameWitness']
      : ['schemaVersion', 'saveRevision', 'bootstrap', 'state', 'greenwayWorks'])
      || value.schemaVersion !== PUBLIC_V17_SCHEMA || value.bootstrap !== null
      || !Number.isSafeInteger(value.saveRevision) || (value.saveRevision as number) < 0) return null
    const frameWitness = withWitness ? decodePublicV14FrameWitness(value.frameWitness) : null
    if (withWitness && (!frameWitness || value.saveRevision === 0)) return null
    const progress = decodePublicV17Progress({ state: value.state,
      greenwayWorks: value.greenwayWorks }, lineage.seed)
    if (!progress) return null
    if (value.saveRevision === 0) {
      const mapped = lineage.origin === 'v16-migration'
        ? mappedSource(lineage.sourceReceipt) : null
      if (lineage.origin === 'v16-migration' && !mapped) return null
      const initialState = mapped?.state ?? createFreshPublicV14State(lineage.seed)
      const initialWorks = mapped?.greenwayWorks ?? {
        builtBridgeIds: [], builtLadderIds: [], dugTileIds: [] }
      if (!samePublicV14Value(progress.state, initialState)
        || !samePublicV14Value(progress.greenwayWorks, initialWorks)) return null
    }
    structuredClone(value)
    return { schemaVersion: PUBLIC_V17_SCHEMA, saveRevision: value.saveRevision as number,
      bootstrap: null, state: progress.state, greenwayWorks: progress.greenwayWorks,
      ...(frameWitness ? { frameWitness } : {}) }
  } catch { return null }
}

/** Fresh lineage is independent of genesis state; validate it without generating a world. */
export function createFreshPublicV17Lineage(seed: string): PublicV17Lineage {
  const lineage = decodePublicV17Lineage({ origin: 'fresh', seed,
    generationProfile: STARTER_CLIFF_PROFILE, rulesProfile: PUBLIC_V17_RULES_PROFILE,
    sourceReceipt: null })
  if (!lineage) throw new RangeError('Invalid v14 seed.')
  return lineage
}

export function createFreshPublicV17Head(seed: string): {
  lineage: PublicV17Lineage; head: PublicV17Head
} {
  const lineage: PublicV17Lineage = { origin: 'fresh', seed,
    generationProfile: STARTER_CLIFF_PROFILE, rulesProfile: PUBLIC_V17_RULES_PROFILE,
    sourceReceipt: null }
  const head = decodePublicV17Head({ schemaVersion: PUBLIC_V17_SCHEMA,
    saveRevision: 0, bootstrap: null, state: createFreshPublicV14State(seed),
    greenwayWorks: { builtBridgeIds: [], builtLadderIds: [], dugTileIds: [] } }, lineage)
  if (!head) throw new RangeError('Invalid fresh v17 world.')
  return { lineage, head }
}

/** This pure helper does not prove the receipt came from an under-lock v16 read. */
export function createMigratedPublicV17Head(sourceStart: unknown): {
  lineage: PublicV17Lineage; head: PublicV17Head
} | null {
  const mapped = mapValidatedV16ToV17Start(sourceStart)
  if (!mapped) return null
  const lineage: PublicV17Lineage = { origin: 'v16-migration', seed: mapped.state.seed,
    generationProfile: STARTER_CLIFF_PROFILE, rulesProfile: PUBLIC_V17_RULES_PROFILE,
    sourceReceipt: mapped.sourceReceipt }
  const head = decodePublicV17Head({ schemaVersion: PUBLIC_V17_SCHEMA,
    saveRevision: 0, bootstrap: null, state: mapped.state,
    greenwayWorks: mapped.greenwayWorks }, lineage)
  return head ? { lineage, head } : null
}

export function encodePublicV17Head(progress: PublicV17Progress, saveRevision: number,
  lineage: PublicV17Lineage, frameWitness?: PublicV14FrameWitness): PublicV17Head {
  const head = decodePublicV17Head({ schemaVersion: PUBLIC_V17_SCHEMA,
    saveRevision, bootstrap: null, state: progress.state, greenwayWorks: progress.greenwayWorks,
    ...(frameWitness ? { frameWitness } : {}) }, lineage)
  if (!head) throw new RangeError('Invalid v17 world head.')
  return head
}
