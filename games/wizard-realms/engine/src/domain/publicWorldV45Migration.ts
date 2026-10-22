import { exactPublicV23 } from './publicWorldV23Snapshot'
import { projectPublicV43MountTraining } from './publicWorldV43MountTraining'
import { decodePublicV43Progress } from './publicWorldV43Snapshot'
import type { PublicV43Progress } from './publicWorldV43Snapshot'
import type { PublicV44GroundMountState } from './publicWorldV44GroundMount'
import { decodePublicV44Root } from './publicWorldV44Snapshot'
import type { PublicV44Root } from './publicWorldV44Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export const PUBLIC_V45_SCHEMA = 'wizard-world/v45' as const
export type PublicV45Lineage = Readonly<{
  origin: 'v44-migration'
  source: PublicV44Root
  sourceRevision: number
  seed: string
}>
export type PublicV45Head = PublicV43Progress & Readonly<{
  groundMount: PublicV44GroundMountState
  tack: 'not_owned' | 'legacy'
  schemaVersion: typeof PUBLIC_V45_SCHEMA
  saveRevision: 0
  witness: null
}>
export type PublicV45Genesis = Readonly<{
  lineage: PublicV45Lineage
  head: PublicV45Head
  previous: null
}>

/** Only call with a V44 root already returned by decodePublicV44Root. */
export function createPublicV45GenesisFromCheckedSource(
  source: PublicV44Root): PublicV45Genesis {
  const { schemaVersion: _schema, saveRevision: _revision,
    witness: _witness, ...flat } = source.head.v43.head
  const progress = decodePublicV43Progress(flat)
  if (!progress) throw new RangeError('Invalid V43 progress in V44 source root')
  const lineage: PublicV45Lineage = { origin: 'v44-migration',
    source: structuredClone(source), sourceRevision: source.head.saveRevision,
    seed: source.head.v43.head.state.seed }
  const tack = progress.familiar.phase === 'claimed'
    && projectPublicV43MountTraining(progress)?.mature === true
    ? 'legacy' : 'not_owned'
  return { lineage, head: { ...structuredClone(progress),
    groundMount: structuredClone(source.head.groundMount), tack,
    schemaVersion: PUBLIC_V45_SCHEMA, saveRevision: 0, witness: null },
    previous: null }
}

/** Pin the complete checked V44 source and start a flat V43 progress head. */
export function createPublicV45Genesis(rawV44: PublicV44Root): PublicV45Genesis {
  const source = decodePublicV44Root(rawV44)
  if (!source) throw new RangeError('Invalid checked V44 source root')
  return createPublicV45GenesisFromCheckedSource(source)
}

/** Only the deterministic V44-import genesis is accepted here. */
export function decodePublicV45Genesis(raw: unknown): PublicV45Genesis | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'head', 'previous'])
      || raw.previous !== null
      || !exactPublicV23(raw.lineage, ['origin', 'source',
        'sourceRevision', 'seed'])
      || raw.lineage.origin !== 'v44-migration') return null
    const source = decodePublicV44Root(raw.lineage.source)
    if (!source || raw.lineage.sourceRevision !== source.head.saveRevision
      || raw.lineage.seed !== source.head.v43.head.state.seed) return null
    const expected = createPublicV45GenesisFromCheckedSource(source)
    return sameStrictBoundedRaw(raw.head, expected.head, 3 << 20)
      ? expected : null
  } catch { return null }
}
