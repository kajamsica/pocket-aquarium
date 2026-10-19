import type { PublicV14State } from './publicWorldV14Snapshot'
import { samePublicV14Value } from './publicWorldV14Validation'
import type { PublicV15Start } from './publicWorldV15Flow'
import { createFreshPublicV15Head, decodePublicV15Lineage } from './publicWorldV15Snapshot'
import type { PublicV15Lineage, PublicV15StarterWorks } from './publicWorldV15Snapshot'
import { decodePublicV15Progress } from './publicWorldV15Validation'
import { PUBLIC_V16_GREENWAY_AUTHORED_DIG_ID,
  PUBLIC_V16_GREENWAY_CENTER_BRIDGE_ID } from './publicWorldV16GreenwaySites'

export type PublicV16GreenwayWorks = Readonly<{
  builtBridgeIds: readonly string[]
  builtLadderIds: readonly string[]
  dugTileIds: readonly string[]
}>

/** A detached v15 value receipt, not proof of a checked storage read. */
export type PublicV16MigrationSource = Readonly<{
  saveRevision: number
  lineage: PublicV15Lineage
  state: PublicV14State
  starterWorks: PublicV15StarterWorks
}>

export type PublicV16MappedStart = Readonly<{
  sourceReceipt: PublicV16MigrationSource
  state: PublicV14State
  greenwayWorks: PublicV16GreenwayWorks
}>

/** Only the later under-lock writer may treat this pure mapping as a migration. */
export function mapValidatedV15ToV16Start(start: unknown): PublicV16MappedStart | null {
  try {
    const keys = ['state', 'starterWorks', 'bootstrap', 'saveRevision', 'lineage']
    if (start === null || typeof start !== 'object' || Array.isArray(start)
      || Object.getPrototypeOf(start) !== Object.prototype
      || Reflect.ownKeys(start).length !== keys.length
      || !keys.every((key) => {
        const field = Object.getOwnPropertyDescriptor(start, key)
        return field?.enumerable && Object.hasOwn(field, 'value')
      })) return null
    const raw = start as PublicV15Start
    if (raw.bootstrap !== null || !Number.isSafeInteger(raw.saveRevision)
      || raw.saveRevision < 0) return null
    const lineage = decodePublicV15Lineage(raw.lineage)
    if (!lineage) return null
    const progress = decodePublicV15Progress({ state: raw.state,
      starterWorks: raw.starterWorks }, lineage.seed)
    if (!progress || raw.saveRevision === 0
      && (progress.starterWorks.bridgeBuilt || progress.starterWorks.bankCacheDug
        || !samePublicV14Value(progress.state,
          createFreshPublicV15Head(lineage.seed).head.state))) return null

    const sourceReceipt: PublicV16MigrationSource = {
      saveRevision: raw.saveRevision, lineage,
      state: structuredClone(progress.state),
      starterWorks: { ...progress.starterWorks },
    }
    const greenwayWorks: PublicV16GreenwayWorks = Object.freeze({
      builtBridgeIds: Object.freeze(progress.starterWorks.bridgeBuilt
        ? [PUBLIC_V16_GREENWAY_CENTER_BRIDGE_ID] : []),
      builtLadderIds: Object.freeze([] as string[]),
      dugTileIds: Object.freeze(progress.starterWorks.bankCacheDug
        ? [PUBLIC_V16_GREENWAY_AUTHORED_DIG_ID] : []),
    })
    return { sourceReceipt, state: progress.state, greenwayWorks }
  } catch { return null }
}
