import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV28Head } from './publicWorldV28Snapshot'
import type { PublicV28Head } from './publicWorldV28Snapshot'
import { decodePublicV28Lineage } from './publicWorldV28Migration'
import type { PublicV28Lineage, PublicV28Progress } from './publicWorldV28Migration'
import { emptyPublicV29MiningTools } from './publicWorldV29MiningTools'
import type { PublicV29MiningTools } from './publicWorldV29MiningTools'

export type { PublicV29MiningTools } from './publicWorldV29MiningTools'

export const PUBLIC_V29_SCHEMA = 'wizard-world/v29' as const
export const PUBLIC_V29_DATABASE_NAME = 'wizard-realms:world:v29'
export type PublicV29SourceReceipt = Readonly<{ head: PublicV28Head; lineage: PublicV28Lineage }>
export type PublicV29Lineage = Readonly<{ origin: 'v28-migration'; seed: string;
  rulesProfile: 'deep-excavation/v1'; sourceReceipt: PublicV29SourceReceipt }>
export type PublicV29Progress = PublicV28Progress & Readonly<{ miningTools: PublicV29MiningTools }>

/** Shape proof only. The V29 flow also checks the complete live V28 ancestry under one lock. */
export function decodePublicV29SourceReceipt(value: unknown): PublicV29SourceReceipt | null {
  try {
    if (!exactPublicV23(value, ['head', 'lineage'])) return null
    const lineage = decodePublicV28Lineage(value.lineage)
    const head = lineage && decodePublicV28Head(value.head, lineage)
    return head && lineage ? { head, lineage } : null
  } catch { return null }
}

export function decodePublicV29Lineage(value: unknown): PublicV29Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'seed', 'rulesProfile', 'sourceReceipt'])
      || value.origin !== 'v28-migration' || value.rulesProfile !== 'deep-excavation/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128) return null
    const sourceReceipt = decodePublicV29SourceReceipt(value.sourceReceipt)
    return sourceReceipt?.head.state.seed === value.seed && sourceReceipt.lineage.seed === value.seed
      ? { origin: 'v28-migration', seed: value.seed,
        rulesProfile: 'deep-excavation/v1', sourceReceipt } : null
  } catch { return null }
}

export function createPublicV29Migration(rawSource: unknown): {
  lineage: PublicV29Lineage; progress: PublicV29Progress } {
  const sourceReceipt = decodePublicV29SourceReceipt(rawSource)
  if (!sourceReceipt) throw new RangeError('Invalid V28 source receipt')
  const { state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds } = sourceReceipt.head
  return { lineage: { origin: 'v28-migration', seed: state.seed,
    rulesProfile: 'deep-excavation/v1', sourceReceipt: structuredClone(sourceReceipt) },
    progress: { ...structuredClone({ state, greenwayWorks, regionalWorks, terrain,
      nextHomeAtMs, riverBridgeIds }), miningTools: emptyPublicV29MiningTools() } }
}
