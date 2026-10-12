import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV30Root } from './publicWorldV30Snapshot'
import type { PublicV30Root } from './publicWorldV30Snapshot'
import type { PublicV30Progress } from './publicWorldV30Migration'
import type { PublicV31RaisedSoilCell } from './publicWorldV31Soil'

export const PUBLIC_V31_SCHEMA = 'wizard-world/v31' as const
export const PUBLIC_V31_DATABASE_NAME = 'wizard-realms:world:v31'
export type PublicV31SourceReceipt = PublicV30Root
export type PublicV31Lineage = Readonly<{ origin: 'v30-migration'; seed: string;
  rulesProfile: 'raised-soil/v1'; sourceReceipt: PublicV31SourceReceipt }>
export type PublicV31Progress = PublicV30Progress & Readonly<{
  raisedSoilCells: readonly PublicV31RaisedSoilCell[] }>

/** Pin the complete checked V30 root, including its historical ancestry and raw source bytes. */
export function decodePublicV31SourceReceipt(value: unknown): PublicV31SourceReceipt | null {
  try { return decodePublicV30Root(value) ? structuredClone(value) as PublicV30Root : null }
  catch { return null }
}

export function decodePublicV31Lineage(value: unknown): PublicV31Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'seed', 'rulesProfile', 'sourceReceipt'])
      || value.origin !== 'v30-migration' || value.rulesProfile !== 'raised-soil/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128) return null
    const sourceReceipt = decodePublicV31SourceReceipt(value.sourceReceipt)
    return sourceReceipt?.head.state.seed === value.seed && sourceReceipt.lineage.seed === value.seed
      ? { origin: 'v30-migration', seed: value.seed,
        rulesProfile: 'raised-soil/v1', sourceReceipt } : null
  } catch { return null }
}

export function createPublicV31Migration(rawSource: unknown): {
  lineage: PublicV31Lineage; progress: PublicV31Progress } {
  const sourceReceipt = decodePublicV31SourceReceipt(rawSource)
  if (!sourceReceipt) throw new RangeError('Invalid V30 source receipt')
  const { state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds, miningTools, claimedBridgeheadId } = sourceReceipt.head
  return { lineage: { origin: 'v30-migration', seed: state.seed,
    rulesProfile: 'raised-soil/v1', sourceReceipt },
    progress: { ...structuredClone({ state, greenwayWorks, regionalWorks, terrain,
      nextHomeAtMs, riverBridgeIds, miningTools, claimedBridgeheadId }), raisedSoilCells: [] } }
}
