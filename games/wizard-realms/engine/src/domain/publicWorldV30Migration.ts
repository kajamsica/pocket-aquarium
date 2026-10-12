import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV29Head } from './publicWorldV29Snapshot'
import type { PublicV29Head } from './publicWorldV29Snapshot'
import type { PublicV29Lineage, PublicV29Progress } from './publicWorldV29Migration'

export const PUBLIC_V30_SCHEMA = 'wizard-world/v30' as const
export const PUBLIC_V30_DATABASE_NAME = 'wizard-realms:world:v30'
export type PublicV30SourceReceipt = Readonly<{ head: PublicV29Head; lineage: PublicV29Lineage }>
export type PublicV30Lineage = Readonly<{ origin: 'v29-migration'; seed: string;
  rulesProfile: 'river-bridgehead/v1'; sourceReceipt: PublicV30SourceReceipt }>
export type PublicV30Progress = PublicV29Progress & Readonly<{ claimedBridgeheadId: string | null }>

/** Shape proof only. The flow pins the complete live V29 ancestry under one lock. */
export function decodePublicV30SourceReceipt(value: unknown): PublicV30SourceReceipt | null {
  try {
    if (!exactPublicV23(value, ['head', 'lineage'])) return null
    // The V29 head decoder validates the complete lineage itself. Preserve that
    // checked receipt instead of decoding its long ancestry a second time.
    const head = decodePublicV29Head(value.head, value.lineage as PublicV29Lineage)
    return head ? { head, lineage: structuredClone(value.lineage) as PublicV29Lineage } : null
  } catch { return null }
}

export function decodePublicV30Lineage(value: unknown): PublicV30Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'seed', 'rulesProfile', 'sourceReceipt'])
      || value.origin !== 'v29-migration' || value.rulesProfile !== 'river-bridgehead/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128) return null
    const sourceReceipt = decodePublicV30SourceReceipt(value.sourceReceipt)
    return sourceReceipt?.head.state.seed === value.seed && sourceReceipt.lineage.seed === value.seed
      ? { origin: 'v29-migration', seed: value.seed,
        rulesProfile: 'river-bridgehead/v1', sourceReceipt } : null
  } catch { return null }
}

export function createPublicV30Migration(rawSource: unknown): {
  lineage: PublicV30Lineage; progress: PublicV30Progress } {
  const sourceReceipt = decodePublicV30SourceReceipt(rawSource)
  if (!sourceReceipt) throw new RangeError('Invalid V29 source receipt')
  const { state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds, miningTools } = sourceReceipt.head
  return { lineage: { origin: 'v29-migration', seed: state.seed,
    rulesProfile: 'river-bridgehead/v1', sourceReceipt: structuredClone(sourceReceipt) },
    progress: { ...structuredClone({ state, greenwayWorks, regionalWorks, terrain,
      nextHomeAtMs, riverBridgeIds, miningTools }), claimedBridgeheadId: null } }
}
