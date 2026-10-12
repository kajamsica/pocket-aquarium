import type { PublicV14State } from './publicWorldV14Snapshot'
import { samePublicV14Value } from './publicWorldV14Validation'
import type { PublicV16Start } from './publicWorldV16Flow'
import type { PublicV16GreenwayWorks } from './publicWorldV16Migration'
import { createFreshPublicV16Head, decodePublicV16Lineage } from './publicWorldV16Snapshot'
import type { PublicV16Lineage } from './publicWorldV16Snapshot'
import { decodePublicV16Progress } from './publicWorldV16Validation'

export type PublicV17GreenwayWorks = PublicV16GreenwayWorks

/** A detached source receipt. The v17 writer must still inspect v16 under lock. */
export type PublicV17MigrationSource = Readonly<{
  saveRevision: number
  lineage: PublicV16Lineage
  state: PublicV14State
  greenwayWorks: PublicV16GreenwayWorks
}>

export type PublicV17MappedStart = Readonly<{
  sourceReceipt: PublicV17MigrationSource
  state: PublicV14State
  greenwayWorks: PublicV16GreenwayWorks
}>

/** Pure projection; it does not authenticate the under-lock source read. */
export function mapValidatedV16ToV17Start(start: unknown): PublicV17MappedStart | null {
  try {
    const keys = ['state', 'greenwayWorks', 'bootstrap', 'saveRevision', 'lineage']
    if (start === null || typeof start !== 'object' || Array.isArray(start)
      || Object.getPrototypeOf(start) !== Object.prototype
      || Reflect.ownKeys(start).length !== keys.length
      || !keys.every((key) => {
        const field = Object.getOwnPropertyDescriptor(start, key)
        return field?.enumerable && Object.hasOwn(field, 'value')
      })) return null
    const raw = start as PublicV16Start
    if (raw.bootstrap !== null || !Number.isSafeInteger(raw.saveRevision)
      || raw.saveRevision < 0) return null
    const lineage = decodePublicV16Lineage(raw.lineage)
    if (!lineage) return null
    const progress = decodePublicV16Progress({ state: raw.state,
      greenwayWorks: raw.greenwayWorks }, lineage.seed)
    if (!progress) return null
    if (raw.saveRevision === 0 && lineage.origin === 'fresh') {
      const fresh = createFreshPublicV16Head(lineage.seed).head
      if (!samePublicV14Value(progress, { state: fresh.state,
        greenwayWorks: fresh.greenwayWorks })) return null
    }

    const sourceReceipt: PublicV17MigrationSource = {
      saveRevision: raw.saveRevision, lineage,
      state: structuredClone(progress.state),
      greenwayWorks: structuredClone(progress.greenwayWorks),
    }
    return { sourceReceipt, state: progress.state,
      greenwayWorks: progress.greenwayWorks }
  } catch { return null }
}
