import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV25Lineage } from './publicWorldV25Migration'
import type { PublicV25Lineage } from './publicWorldV25Migration'
import { decodePublicV25Head } from './publicWorldV25Snapshot'
import type { PublicV25Head } from './publicWorldV25Snapshot'
import { migratePublicV25ExcavationLedger } from './publicWorldV26TerrainLedger'
import type { PublicV26TerrainLedger } from './publicWorldV26TerrainLedger'

export const PUBLIC_V26_SCHEMA = 'wizard-world/v26' as const
export const PUBLIC_V26_DATABASE_NAME = 'wizard-realms:world:v26'
export type PublicV26SourceReceipt = Readonly<{ head: PublicV25Head; lineage: PublicV25Lineage }>
export type PublicV26Lineage = Readonly<{ origin: 'v25-migration'; seed: string;
  rulesProfile: 'physical-starter-valley/v1'; sourceReceipt: PublicV26SourceReceipt }>
export type PublicV26Progress = Readonly<Pick<PublicV25Head, 'state' | 'greenwayWorks' | 'regionalWorks'>
  & { terrain: PublicV26TerrainLedger; nextHomeAtMs: number }>

/** Shape proof only. The flow must recheck the complete live V25 root under one lock. */
export function decodePublicV26SourceReceipt(value: unknown): PublicV26SourceReceipt | null {
  try {
    if (!exactPublicV23(value, ['head', 'lineage'])) return null
    const lineage = decodePublicV25Lineage(value.lineage)
    const head = lineage && decodePublicV25Head(value.head, lineage)
    return head && lineage ? { head, lineage } : null
  } catch { return null }
}

export function decodePublicV26Lineage(value: unknown): PublicV26Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'seed', 'rulesProfile', 'sourceReceipt'])
      || value.origin !== 'v25-migration' || value.rulesProfile !== 'physical-starter-valley/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128) return null
    const sourceReceipt = decodePublicV26SourceReceipt(value.sourceReceipt)
    return sourceReceipt?.head.state.seed === value.seed && sourceReceipt.lineage.seed === value.seed
      ? { origin: 'v25-migration', seed: value.seed,
        rulesProfile: 'physical-starter-valley/v1', sourceReceipt } : null
  } catch { return null }
}

export function createPublicV26Migration(rawSource: unknown): {
  lineage: PublicV26Lineage; progress: PublicV26Progress } {
  const sourceReceipt = decodePublicV26SourceReceipt(rawSource)
  if (!sourceReceipt) throw new RangeError('Invalid V25 source receipt')
  const { state, greenwayWorks, regionalWorks, excavation } = sourceReceipt.head
  const terrain = migratePublicV25ExcavationLedger(excavation)
  if (!terrain) throw new RangeError('Invalid V25 excavation ledger')
  if (terrain.columns.some((column) => column.gx === 0 && column.gz === 0 && column.openDepth > 0))
    throw new RangeError('V25 source has an open home column')
  return { lineage: { origin: 'v25-migration', seed: state.seed,
    rulesProfile: 'physical-starter-valley/v1', sourceReceipt },
    progress: { ...structuredClone({ state, greenwayWorks, regionalWorks }), terrain, nextHomeAtMs: 0 } }
}
