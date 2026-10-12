import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV27Lineage } from './publicWorldV27Migration'
import type { PublicV27Lineage, PublicV27Progress } from './publicWorldV27Migration'
import { decodePublicV27Head } from './publicWorldV27Snapshot'
import type { PublicV27Head } from './publicWorldV27Snapshot'

export const PUBLIC_V28_SCHEMA = 'wizard-world/v28' as const
export const PUBLIC_V28_DATABASE_NAME = 'wizard-realms:world:v28'
export type PublicV28SourceReceipt = Readonly<{ head: PublicV27Head; lineage: PublicV27Lineage }>
export type PublicV28Lineage = Readonly<{ origin: 'v27-migration'; seed: string;
  rulesProfile: 'connected-river-bridges/v1'; sourceReceipt: PublicV28SourceReceipt }>
export type PublicV28Progress = PublicV27Progress & Readonly<{ riverBridgeIds: readonly string[] }>

/** Shape proof only. The flow checks the complete live V27 ancestry under one lock. */
export function decodePublicV28SourceReceipt(value: unknown): PublicV28SourceReceipt | null {
  try {
    if (!exactPublicV23(value, ['head', 'lineage'])) return null
    const lineage = decodePublicV27Lineage(value.lineage)
    const head = lineage && decodePublicV27Head(value.head, lineage)
    return head && lineage ? { head, lineage } : null
  } catch { return null }
}

export function decodePublicV28Lineage(value: unknown): PublicV28Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'seed', 'rulesProfile', 'sourceReceipt'])
      || value.origin !== 'v27-migration' || value.rulesProfile !== 'connected-river-bridges/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128) return null
    const sourceReceipt = decodePublicV28SourceReceipt(value.sourceReceipt)
    return sourceReceipt?.head.state.seed === value.seed && sourceReceipt.lineage.seed === value.seed
      ? { origin: 'v27-migration', seed: value.seed,
        rulesProfile: 'connected-river-bridges/v1', sourceReceipt } : null
  } catch { return null }
}

export function createPublicV28Migration(rawSource: unknown): {
  lineage: PublicV28Lineage; progress: PublicV28Progress } {
  const sourceReceipt = decodePublicV28SourceReceipt(rawSource)
  if (!sourceReceipt) throw new RangeError('Invalid V27 source receipt')
  const { state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs } = sourceReceipt.head
  return { lineage: { origin: 'v27-migration', seed: state.seed,
    rulesProfile: 'connected-river-bridges/v1', sourceReceipt: structuredClone(sourceReceipt) },
    progress: { ...structuredClone({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs }),
      riverBridgeIds: [] } }
}
