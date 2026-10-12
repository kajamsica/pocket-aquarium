import { highlandStoneNodes } from './highlandContent'
import { samePublicV14Value } from './publicWorldV14Validation'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { publicV32Monotonic, publicV32Preserves } from './publicWorldV32Snapshot'
import { PUBLIC_V33_SCHEMA } from './publicWorldV33Migration'
import { decodePublicV33Witness, replayPublicV33Witness } from './publicWorldV33Snapshot'
import type { PublicV33Head, PublicV33Witness } from './publicWorldV33Snapshot'
import type { PublicV33Progress } from './publicWorldV33Migration'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export const PUBLIC_V34_SCHEMA = 'wizard-world/v34' as const
export const PUBLIC_V34_DATABASE_NAME = 'wizard-realms:world:v34'
export type PublicV34Lineage = Readonly<{ origin: 'v33-migration';
  rulesProfile: 'self-contained/v1'; seed: string; sourceRevision: number;
  genesis: PublicV33Progress }>
export type PublicV34Head = PublicV33Progress & Readonly<{
  schemaVersion: typeof PUBLIC_V34_SCHEMA; saveRevision: number;
  witness: PublicV33Witness | null }>
export type PublicV34Root = Readonly<{ lineage: PublicV34Lineage;
  head: PublicV34Head; previous: PublicV34Head | null }>

const progressKeys = ['state', 'greenwayWorks', 'regionalWorks', 'terrain',
  'nextHomeAtMs', 'riverBridgeIds', 'miningTools', 'claimedBridgeheadId',
  'raisedSoilCells'] as const
const headKeys = ['schemaVersion', 'saveRevision', ...progressKeys, 'witness'] as const
const progressOf = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells }: PublicV33Progress):
  PublicV33Progress => ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells })

export function createPublicV34Root(sourceHead: PublicV33Head): PublicV34Root {
  if (!exactPublicV23(sourceHead, headKeys)
    || sourceHead.schemaVersion !== PUBLIC_V33_SCHEMA
    || !Number.isSafeInteger(sourceHead.saveRevision) || sourceHead.saveRevision < 0
    || !decodePublicV31ActionProgress(progressOf(sourceHead)))
    throw new RangeError('Invalid checked V33 source head')
  const genesis = structuredClone(progressOf(sourceHead))
  return { lineage: { origin: 'v33-migration', rulesProfile: 'self-contained/v1',
    seed: genesis.state.seed, sourceRevision: sourceHead.saveRevision, genesis },
    head: { ...structuredClone(genesis), schemaVersion: PUBLIC_V34_SCHEMA,
      saveRevision: 0, witness: null }, previous: null }
}

export function decodePublicV34Lineage(value: unknown): PublicV34Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'rulesProfile', 'seed',
      'sourceRevision', 'genesis']) || value.origin !== 'v33-migration'
      || value.rulesProfile !== 'self-contained/v1' || typeof value.seed !== 'string'
      || !value.seed || value.seed.length > 128
      || !Number.isSafeInteger(value.sourceRevision) || (value.sourceRevision as number) < 0
      || !exactPublicV23(value.genesis, progressKeys)) return null
    const genesis = decodePublicV31ActionProgress(value.genesis as PublicV33Progress)
    return genesis?.state.seed === value.seed ? { origin: 'v33-migration',
      rulesProfile: 'self-contained/v1', seed: value.seed,
      sourceRevision: value.sourceRevision as number, genesis } : null
  } catch { return null }
}

function decodeHead(value: unknown, lineage: PublicV34Lineage): PublicV34Head | null {
  try {
    if (!exactPublicV23(value, headKeys) || value.schemaVersion !== PUBLIC_V34_SCHEMA
      || !Number.isSafeInteger(value.saveRevision) || (value.saveRevision as number) < 0)
      return null
    const progress = decodePublicV31ActionProgress(Object.fromEntries(progressKeys.map((key) =>
      [key, value[key]])) as PublicV33Progress)
    if (!progress || progress.state.seed !== lineage.seed) return null
    if (value.saveRevision === 0) return value.witness === null
      && samePublicV14Value(progress, lineage.genesis)
      ? { ...progress, schemaVersion: PUBLIC_V34_SCHEMA, saveRevision: 0, witness: null } : null
    const witness = decodePublicV33Witness(value.witness)
    if (!witness || witness.kind === 'highland-extract/v1'
      && !highlandStoneNodes(lineage.seed).some(({ id }) => id === witness.nodeId)) return null
    return { ...progress, schemaVersion: PUBLIC_V34_SCHEMA,
      saveRevision: value.saveRevision as number, witness }
  } catch { return null }
}

/** Compact three-slot authority; revision one also proves its previous transition. */
export function decodePublicV34Root(value: unknown): PublicV34Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV34Lineage(value.lineage)
    const head = lineage && decodeHead(value.head, lineage)
    const previous = lineage && value.previous !== null
      ? decodeHead(value.previous, lineage) : null
    if (!lineage || !head || (head.saveRevision === 0 ? value.previous !== null
      : !previous || head.saveRevision !== previous.saveRevision + 1 || !head.witness)) return null
    if (!publicV32Preserves(lineage.genesis, head, lineage.seed)
      || previous && (!publicV32Preserves(lineage.genesis, previous, lineage.seed)
        || !publicV32Monotonic(previous, head))) return null
    if (!previous) return { lineage, head, previous: null }
    if (previous.saveRevision === 0 && !samePublicV14Value(previous, {
      ...lineage.genesis, schemaVersion: PUBLIC_V34_SCHEMA,
      saveRevision: 0, witness: null })) return null
    if (previous.saveRevision === 1 && !samePublicV14Value(
      replayPublicV33Witness(lineage.genesis, previous.witness), progressOf(previous))) return null
    return samePublicV14Value(replayPublicV33Witness(progressOf(previous), head.witness),
      progressOf(head)) ? { lineage, head, previous } : null
  } catch { return null }
}

/** The store supplies an already checked private prior root from a one-use proof. */
export function decodePublicV34CheckedSuccessor(before: PublicV34Root,
  value: unknown): PublicV34Root | null {
  try {
    if (exactPublicV23(value, ['lineage', 'head', 'previous'])
      && sameStrictBoundedRaw([value.lineage, value.previous],
        [before.lineage, before.head], 3 << 20)) {
      const head = decodeHead(value.head, before.lineage)
      if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
        || !publicV32Preserves(before.lineage.genesis, head, before.lineage.seed)
        || !publicV32Monotonic(before.head, head)
        || !samePublicV14Value(replayPublicV33Witness(progressOf(before.head), head.witness),
          progressOf(head))) return null
      return { lineage: before.lineage, previous: before.head, head }
    }
    const candidate = decodePublicV34Root(value)
    return candidate && samePublicV14Value(candidate.lineage, before.lineage)
      && samePublicV14Value(candidate.previous, before.head) ? candidate : null
  } catch { return null }
}
