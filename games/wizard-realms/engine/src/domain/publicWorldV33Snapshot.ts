import { highlandStoneNodes } from './highlandContent'
import { samePublicV14Value } from './publicWorldV14Validation'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { confirmPublicV33FairyRingAction,
  decodePublicV33FairyRingWitness } from './publicWorldV33FairyRing'
import type { PublicV33FairyRingWitness } from './publicWorldV33FairyRing'
import { createPublicV33Migration, decodePublicV33Lineage,
  PUBLIC_V33_SCHEMA } from './publicWorldV33Migration'
import type { PublicV33Lineage, PublicV33Progress } from './publicWorldV33Migration'
import { decodePublicV32Witness, publicV32Monotonic, publicV32Preserves,
  replayPublicV32Witness } from './publicWorldV32Snapshot'
import type { PublicV32Witness } from './publicWorldV32Snapshot'

export type PublicV33Witness = PublicV32Witness | PublicV33FairyRingWitness
export type PublicV33Head = PublicV33Progress & Readonly<{
  schemaVersion: typeof PUBLIC_V33_SCHEMA; saveRevision: number; witness: PublicV33Witness | null
}>
export type PublicV33Root = Readonly<{ lineage: PublicV33Lineage;
  head: PublicV33Head; previous: PublicV33Head | null }>

const owned = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells }: PublicV33Progress):
  PublicV33Progress => ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells })

export function createPublicV33Root(rawV32Root: unknown): PublicV33Root {
  const { lineage, progress } = createPublicV33Migration(rawV32Root)
  return { lineage, head: { ...progress, schemaVersion: PUBLIC_V33_SCHEMA,
    saveRevision: 0, witness: null }, previous: null }
}

const genesisHead = (lineage: PublicV33Lineage): PublicV33Head => {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...progress } = lineage.sourceReceipt.head
  return { ...owned(progress), schemaVersion: PUBLIC_V33_SCHEMA,
    saveRevision: 0, witness: null }
}

export function decodePublicV33Witness(value: unknown): PublicV33Witness | null {
  return decodePublicV33FairyRingWitness(value) ?? decodePublicV32Witness(value)
}

/** Inherited actions retain their V32 authority; fairy actions use the V33 reducer. */
export function replayPublicV33Witness(before: PublicV33Progress,
  rawWitness: unknown): PublicV33Progress | null {
  const witness = decodePublicV33Witness(rawWitness)
  const progress = decodePublicV31ActionProgress(owned(before))
  if (!witness || !progress) return null
  if (witness.kind === 'fairy-ring-discover/v1' || witness.kind === 'fairy-ring-travel/v1')
    return confirmPublicV33FairyRingAction(progress, witness).progress ?? null
  return replayPublicV32Witness(progress, witness)
}

function decodeHead(value: unknown, lineage: PublicV33Lineage,
  genesis: PublicV33Head): PublicV33Head | null {
  try {
    if (!exactPublicV23(value, ['schemaVersion', 'saveRevision', 'state',
      'greenwayWorks', 'regionalWorks', 'terrain', 'nextHomeAtMs', 'riverBridgeIds',
      'miningTools', 'claimedBridgeheadId', 'raisedSoilCells', 'witness'])
      || value.schemaVersion !== PUBLIC_V33_SCHEMA || !Number.isSafeInteger(value.saveRevision)
      || (value.saveRevision as number) < 0) return null
    const progress = decodePublicV31ActionProgress({ state: value.state,
      greenwayWorks: value.greenwayWorks, regionalWorks: value.regionalWorks,
      terrain: value.terrain, nextHomeAtMs: value.nextHomeAtMs,
      riverBridgeIds: value.riverBridgeIds, miningTools: value.miningTools,
      claimedBridgeheadId: value.claimedBridgeheadId,
      raisedSoilCells: value.raisedSoilCells } as PublicV33Progress)
    if (!progress || progress.state.seed !== lineage.seed) return null
    if (value.saveRevision === 0) return samePublicV14Value(value, genesis)
      ? structuredClone(value) as PublicV33Head : null
    const witness = decodePublicV33Witness(value.witness)
    if (witness?.kind === 'highland-extract/v1'
      && !highlandStoneNodes(progress.state.seed).some(({ id }) => id === witness.nodeId))
      return null
    return witness ? { ...progress, schemaVersion: PUBLIC_V33_SCHEMA,
      saveRevision: value.saveRevision as number, witness } : null
  } catch { return null }
}

export function decodePublicV33Head(value: unknown,
  rawLineage: PublicV33Lineage): PublicV33Head | null {
  const lineage = decodePublicV33Lineage(rawLineage)
  return lineage ? decodeHead(value, lineage, genesisHead(lineage)) : null
}

/** Complete V32 ancestry, V32 conservation, and exact three-slot witness replay. */
export function decodePublicV33Root(value: unknown): PublicV33Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV33Lineage(value.lineage)
    const genesis = lineage && genesisHead(lineage)
    const head = lineage && genesis && decodeHead(value.head, lineage, genesis)
    if (!lineage || !genesis || !head) return null
    const previous = value.previous === null ? null : decodeHead(value.previous, lineage, genesis)
    if (head.saveRevision === 0 ? value.previous !== null : !previous
      || head.saveRevision !== previous.saveRevision + 1 || !head.witness) return null
    if (!publicV32Preserves(genesis, head, lineage.seed)
      || previous && (!publicV32Preserves(genesis, previous, lineage.seed)
        || !publicV32Monotonic(previous, head))) return null
    if (!previous) return { lineage, head, previous: null }
    if (previous.saveRevision === 1 && !samePublicV14Value(
      replayPublicV33Witness(owned(genesis), previous.witness), owned(previous))) return null
    return samePublicV14Value(replayPublicV33Witness(owned(previous), head.witness), owned(head))
      ? { lineage, head, previous } : null
  } catch { return null }
}

/** Used only after a locked check proves unchanged lineage and previous head. */
export function decodePublicV33CheckedSuccessor(before: PublicV33Root,
  value: unknown): PublicV33Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const genesis = genesisHead(before.lineage)
    const head = decodeHead(value.head, before.lineage, genesis)
    if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
      || !publicV32Preserves(genesis, head, before.lineage.seed)
      || !publicV32Monotonic(before.head, head)
      || !samePublicV14Value(replayPublicV33Witness(owned(before.head), head.witness),
        owned(head))) return null
    return { lineage: before.lineage, previous: before.head, head }
  } catch { return null }
}
