import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV26Lineage } from './publicWorldV26Migration'
import type { PublicV26Lineage, PublicV26Progress } from './publicWorldV26Migration'
import { decodePublicV26Head } from './publicWorldV26Snapshot'
import type { PublicV26Head } from './publicWorldV26Snapshot'

export const PUBLIC_V27_SCHEMA = 'wizard-world/v27' as const
export const PUBLIC_V27_DATABASE_NAME = 'wizard-realms:world:v27'
export type PublicV27SourceReceipt = Readonly<{ head: PublicV26Head; lineage: PublicV26Lineage }>
export type PublicV27Lineage = Readonly<{ origin: 'v26-migration'; seed: string;
  rulesProfile: 'connected-dry-ground/v1'; sourceReceipt: PublicV27SourceReceipt }>
export type PublicV27Progress = PublicV26Progress

/** Shape proof only. The flow checks the complete live V26 and V25 chains under one lock. */
export function decodePublicV27SourceReceipt(value: unknown): PublicV27SourceReceipt | null {
  try {
    if (!exactPublicV23(value, ['head', 'lineage'])) return null
    const lineage = decodePublicV26Lineage(value.lineage)
    const head = lineage && decodePublicV26Head(value.head, lineage)
    return head && lineage ? { head, lineage } : null
  } catch { return null }
}

export function decodePublicV27Lineage(value: unknown): PublicV27Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'seed', 'rulesProfile', 'sourceReceipt'])
      || value.origin !== 'v26-migration' || value.rulesProfile !== 'connected-dry-ground/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128) return null
    const sourceReceipt = decodePublicV27SourceReceipt(value.sourceReceipt)
    return sourceReceipt?.head.state.seed === value.seed && sourceReceipt.lineage.seed === value.seed
      ? { origin: 'v26-migration', seed: value.seed,
        rulesProfile: 'connected-dry-ground/v1', sourceReceipt } : null
  } catch { return null }
}

export function createPublicV27Migration(rawSource: unknown): {
  lineage: PublicV27Lineage; progress: PublicV27Progress } {
  const sourceReceipt = decodePublicV27SourceReceipt(rawSource)
  if (!sourceReceipt) throw new RangeError('Invalid V26 source receipt')
  const { state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs } = sourceReceipt.head
  return { lineage: { origin: 'v26-migration', seed: state.seed,
    rulesProfile: 'connected-dry-ground/v1', sourceReceipt: structuredClone(sourceReceipt) },
    progress: structuredClone({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs }) }
}
