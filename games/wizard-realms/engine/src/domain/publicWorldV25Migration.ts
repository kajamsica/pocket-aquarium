import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV24Head, decodePublicV24Lineage } from './publicWorldV24Snapshot'
import type { PublicV24Head, PublicV24Lineage, PublicV24Progress } from './publicWorldV24Snapshot'
import { relocatePublicV25RiverSource } from './publicWorldV25MigrationPose'
import type { PublicV25Relocation } from './publicWorldV25MigrationPose'

export const PUBLIC_V25_SCHEMA = 'wizard-world/v25' as const
export const PUBLIC_V25_DATABASE_NAME = 'wizard-realms:world:v25'
export type PublicV25SourceReceipt = Readonly<{ head: PublicV24Head; lineage: PublicV24Lineage }>
export type PublicV25Lineage = Readonly<{ origin: 'v24-migration'; seed: string;
  rulesProfile: 'connected-river/v1'; sourceReceipt: PublicV25SourceReceipt }>

/** Shape proof only. The future flow must check the complete live V24 root under lock. */
export function decodePublicV25SourceReceipt(value: unknown): PublicV25SourceReceipt | null {
  try {
    if (!exactPublicV23(value, ['head', 'lineage'])) return null
    const lineage = decodePublicV24Lineage(value.lineage)
    const head = lineage && decodePublicV24Head(value.head, lineage)
    return head && lineage ? { head, lineage } : null
  } catch { return null }
}

export function decodePublicV25Lineage(value: unknown): PublicV25Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'seed', 'rulesProfile', 'sourceReceipt'])
      || value.origin !== 'v24-migration' || value.rulesProfile !== 'connected-river/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128) return null
    const sourceReceipt = decodePublicV25SourceReceipt(value.sourceReceipt)
    return sourceReceipt?.head.state.seed === value.seed && sourceReceipt.lineage.seed === value.seed
      ? { origin: 'v24-migration', seed: value.seed, rulesProfile: 'connected-river/v1', sourceReceipt }
      : null
  } catch { return null }
}

export function createPublicV25Migration(rawSource: unknown): {
  lineage: PublicV25Lineage; progress: PublicV24Progress; relocation: PublicV25Relocation | null } {
  const sourceReceipt = decodePublicV25SourceReceipt(rawSource)
  if (!sourceReceipt) throw new RangeError('Invalid V24 source receipt')
  const { state, greenwayWorks, regionalWorks } = sourceReceipt.head
  const mapped = relocatePublicV25RiverSource({ state, greenwayWorks, regionalWorks })
  if (!mapped) throw new RangeError('Unplaceable V24 source pose')
  return { lineage: { origin: 'v24-migration', seed: state.seed,
    rulesProfile: 'connected-river/v1', sourceReceipt },
    progress: mapped.progress, relocation: mapped.relocation }
}
