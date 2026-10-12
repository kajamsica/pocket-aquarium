import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV31Root } from './publicWorldV31Snapshot'
import type { PublicV31Root } from './publicWorldV31Snapshot'
import type { PublicV31Progress } from './publicWorldV31Migration'

export const PUBLIC_V32_SCHEMA = 'wizard-world/v32' as const
export const PUBLIC_V32_DATABASE_NAME = 'wizard-realms:world:v32'
export type PublicV32SourceReceipt = PublicV31Root
export type PublicV32Lineage = Readonly<{ origin: 'v31-migration'; seed: string;
  rulesProfile: 'highland-quarry/v1'; sourceReceipt: PublicV32SourceReceipt }>
export type PublicV32Progress = PublicV31Progress

/** A V32 copy pins the complete checked V31 root, including its raw prior slot. */
export function decodePublicV32SourceReceipt(value: unknown): PublicV32SourceReceipt | null {
  try { return decodePublicV31Root(value) ? structuredClone(value) as PublicV31Root : null }
  catch { return null }
}

export function decodePublicV32Lineage(value: unknown): PublicV32Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'seed', 'rulesProfile', 'sourceReceipt'])
      || value.origin !== 'v31-migration' || value.rulesProfile !== 'highland-quarry/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128) return null
    const sourceReceipt = decodePublicV32SourceReceipt(value.sourceReceipt)
    return sourceReceipt?.head.state.seed === value.seed && sourceReceipt.lineage.seed === value.seed
      ? { origin: 'v31-migration', seed: value.seed,
        rulesProfile: 'highland-quarry/v1', sourceReceipt } : null
  } catch { return null }
}

export function createPublicV32Migration(rawSource: unknown): {
  lineage: PublicV32Lineage; progress: PublicV32Progress } {
  const sourceReceipt = decodePublicV32SourceReceipt(rawSource)
  if (!sourceReceipt) throw new RangeError('Invalid V31 source receipt')
  const { state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells } = sourceReceipt.head
  return { lineage: { origin: 'v31-migration', seed: state.seed,
    rulesProfile: 'highland-quarry/v1', sourceReceipt },
    progress: structuredClone({ state, greenwayWorks, regionalWorks, terrain,
      nextHomeAtMs, riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells }) }
}
