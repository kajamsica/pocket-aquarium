import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV32Root } from './publicWorldV32Snapshot'
import type { PublicV32Root } from './publicWorldV32Snapshot'
import type { PublicV32Progress } from './publicWorldV32Migration'

export const PUBLIC_V33_SCHEMA = 'wizard-world/v33' as const
export const PUBLIC_V33_DATABASE_NAME = 'wizard-realms:world:v33'
export type PublicV33SourceReceipt = PublicV32Root
export type PublicV33Lineage = Readonly<{ origin: 'v32-migration'; seed: string;
  rulesProfile: 'fairy-ring-link/v1'; sourceReceipt: PublicV33SourceReceipt }>
export type PublicV33Progress = PublicV32Progress

/** A V33 copy pins the complete checked V32 root, including its raw prior slot. */
export function decodePublicV33SourceReceipt(value: unknown): PublicV33SourceReceipt | null {
  try { return decodePublicV32Root(value) ? structuredClone(value) as PublicV32Root : null }
  catch { return null }
}

export function decodePublicV33Lineage(value: unknown): PublicV33Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'seed', 'rulesProfile', 'sourceReceipt'])
      || value.origin !== 'v32-migration' || value.rulesProfile !== 'fairy-ring-link/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128) return null
    const sourceReceipt = decodePublicV33SourceReceipt(value.sourceReceipt)
    return sourceReceipt?.head.state.seed === value.seed && sourceReceipt.lineage.seed === value.seed
      ? { origin: 'v32-migration', seed: value.seed,
        rulesProfile: 'fairy-ring-link/v1', sourceReceipt } : null
  } catch { return null }
}

export function createPublicV33Migration(rawSource: unknown): {
  lineage: PublicV33Lineage; progress: PublicV33Progress } {
  const sourceReceipt = decodePublicV33SourceReceipt(rawSource)
  if (!sourceReceipt) throw new RangeError('Invalid V32 source receipt')
  const { state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells } = sourceReceipt.head
  return { lineage: { origin: 'v32-migration', seed: state.seed,
    rulesProfile: 'fairy-ring-link/v1', sourceReceipt },
    progress: structuredClone({ state, greenwayWorks, regionalWorks, terrain,
      nextHomeAtMs, riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells }) }
}
