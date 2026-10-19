import { highlandStoneNodes } from './highlandContent'
import { samePublicV14Value } from './publicWorldV14Validation'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { publicV32Monotonic, publicV32Preserves } from './publicWorldV32Snapshot'
import { decodePublicV33Witness, replayPublicV33Witness } from './publicWorldV33Snapshot'
import type { PublicV33Witness } from './publicWorldV33Snapshot'
import type { PublicV33Progress } from './publicWorldV33Migration'
import { PUBLIC_V34_SCHEMA } from './publicWorldV34Snapshot'
import type { PublicV34Head } from './publicWorldV34Snapshot'
import { confirmPublicV35LedgerAction, decodePublicV35LedgerWitness } from './publicWorldV35LedgerAction'
import type { PublicV35LedgerWitness, PublicV35Progress } from './publicWorldV35LedgerAction'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export const PUBLIC_V35_SCHEMA = 'wizard-world/v35' as const
export const PUBLIC_V35_DATABASE_NAME = 'wizard-realms:world:v35'
export type PublicV35Witness = PublicV33Witness | PublicV35LedgerWitness
export type PublicV35Lineage = Readonly<{ origin: 'v34-migration';
  rulesProfile: 'outfitters-ledger/v1'; seed: string; sourceRevision: number;
  genesis: PublicV33Progress }>
export type PublicV35Head = PublicV35Progress & Readonly<{
  schemaVersion: typeof PUBLIC_V35_SCHEMA; saveRevision: number;
  witness: PublicV35Witness | null }>
export type PublicV35Root = Readonly<{ lineage: PublicV35Lineage;
  head: PublicV35Head; previous: PublicV35Head | null }>

const inheritedKeys = ['state', 'greenwayWorks', 'regionalWorks', 'terrain',
  'nextHomeAtMs', 'riverBridgeIds', 'miningTools', 'claimedBridgeheadId',
  'raisedSoilCells'] as const
const progressKeys = [...inheritedKeys, 'ledgerSurveyBridgeId', 'ledgerClaimReward'] as const
const headKeys = ['schemaVersion', 'saveRevision', ...progressKeys, 'witness'] as const
const inherited = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells }: PublicV33Progress):
  PublicV33Progress => ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells })
const progressOf = ({ ledgerSurveyBridgeId, ledgerClaimReward,
  ...head }: PublicV35Progress): PublicV35Progress => ({ ...inherited(head),
    ledgerSurveyBridgeId, ledgerClaimReward })
const genesisHead = (lineage: PublicV35Lineage): PublicV35Head => ({
  ...lineage.genesis, ledgerSurveyBridgeId: null, ledgerClaimReward: null,
  schemaVersion: PUBLIC_V35_SCHEMA, saveRevision: 0, witness: null })

export function createPublicV35Root(sourceHead: PublicV34Head): PublicV35Root {
  if (!exactPublicV23(sourceHead, ['schemaVersion', 'saveRevision',
    ...inheritedKeys, 'witness']) || sourceHead.schemaVersion !== PUBLIC_V34_SCHEMA
    || !Number.isSafeInteger(sourceHead.saveRevision) || sourceHead.saveRevision < 0
    || !decodePublicV31ActionProgress(inherited(sourceHead)))
    throw new RangeError('Invalid checked V34 source head')
  const genesis = structuredClone(inherited(sourceHead))
  const lineage: PublicV35Lineage = { origin: 'v34-migration',
    rulesProfile: 'outfitters-ledger/v1', seed: genesis.state.seed,
    sourceRevision: sourceHead.saveRevision, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function decodePublicV35Lineage(value: unknown): PublicV35Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'rulesProfile', 'seed',
      'sourceRevision', 'genesis']) || value.origin !== 'v34-migration'
      || value.rulesProfile !== 'outfitters-ledger/v1' || typeof value.seed !== 'string'
      || !value.seed || value.seed.length > 128 || !Number.isSafeInteger(value.sourceRevision)
      || (value.sourceRevision as number) < 0
      || !exactPublicV23(value.genesis, inheritedKeys)) return null
    const genesis = decodePublicV31ActionProgress(value.genesis as PublicV33Progress)
    return genesis?.state.seed === value.seed ? { origin: 'v34-migration',
      rulesProfile: 'outfitters-ledger/v1', seed: value.seed,
      sourceRevision: value.sourceRevision as number, genesis } : null
  } catch { return null }
}

export function decodePublicV35Witness(value: unknown): PublicV35Witness | null {
  return decodePublicV35LedgerWitness(value) ?? decodePublicV33Witness(value)
}

/** Every edge recomputes the ledger sidecar from its checked witness. */
export function replayPublicV35Witness(before: PublicV35Progress,
  rawWitness: unknown): PublicV35Progress | null {
  const witness = decodePublicV35Witness(rawWitness)
  if (!witness) return null
  if (witness.kind === 'ledger-survey/v1' || witness.kind === 'ledger-deliver/v1')
    return confirmPublicV35LedgerAction(before, witness).progress ?? null
  const next = replayPublicV33Witness(inherited(before), witness)
  return next ? { ...next, ledgerSurveyBridgeId: before.ledgerSurveyBridgeId,
    ledgerClaimReward: before.ledgerClaimReward } : null
}

function validFacts(progress: PublicV35Progress): boolean {
  const survey = progress.ledgerSurveyBridgeId, claim = progress.ledgerClaimReward
  if (survey === null) return claim === null
  if (typeof survey !== 'string' || !resolvePublicV28RiverBridge(progress.state.seed, survey)
    || !progress.riverBridgeIds.includes(survey) || progress.claimedBridgeheadId === null)
    return false
  return claim === null || claim === 'traveler_tunic' || claim === 'coins'
}

function factsMonotonic(before: PublicV35Progress, next: PublicV35Progress): boolean {
  return (before.ledgerSurveyBridgeId === null
    || before.ledgerSurveyBridgeId === next.ledgerSurveyBridgeId)
    && (before.ledgerClaimReward === null
      || before.ledgerClaimReward === next.ledgerClaimReward)
}

function decodeHead(value: unknown, lineage: PublicV35Lineage): PublicV35Head | null {
  try {
    if (!exactPublicV23(value, headKeys) || value.schemaVersion !== PUBLIC_V35_SCHEMA
      || !Number.isSafeInteger(value.saveRevision) || (value.saveRevision as number) < 0)
      return null
    const old = decodePublicV31ActionProgress(Object.fromEntries(inheritedKeys.map((key) =>
      [key, value[key]])) as PublicV33Progress)
    if (!old || old.state.seed !== lineage.seed) return null
    const progress: PublicV35Progress = { ...old,
      ledgerSurveyBridgeId: value.ledgerSurveyBridgeId as string | null,
      ledgerClaimReward: value.ledgerClaimReward as PublicV35Progress['ledgerClaimReward'] }
    if (!validFacts(progress)) return null
    if (value.saveRevision === 0) return samePublicV14Value(value, genesisHead(lineage))
      ? structuredClone(value) as PublicV35Head : null
    const witness = decodePublicV35Witness(value.witness)
    if (!witness || witness.kind === 'highland-extract/v1'
      && !highlandStoneNodes(lineage.seed).some(({ id }) => id === witness.nodeId)) return null
    return { ...progress, schemaVersion: PUBLIC_V35_SCHEMA,
      saveRevision: value.saveRevision as number, witness }
  } catch { return null }
}

export function decodePublicV35Head(value: unknown,
  rawLineage: PublicV35Lineage): PublicV35Head | null {
  const lineage = decodePublicV35Lineage(rawLineage)
  return lineage ? decodeHead(value, lineage) : null
}

/** Three saved slots prove the previous edge and the current checked action. */
export function decodePublicV35Root(value: unknown): PublicV35Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV35Lineage(value.lineage)
    const head = lineage && decodeHead(value.head, lineage)
    const previous = lineage && value.previous !== null
      ? decodeHead(value.previous, lineage) : null
    if (!lineage || !head || (head.saveRevision === 0 ? value.previous !== null
      : !previous || head.saveRevision !== previous.saveRevision + 1 || !head.witness)) return null
    if (!publicV32Preserves(lineage.genesis, head, lineage.seed)
      || !factsMonotonic(genesisHead(lineage), head)
      || previous && (!publicV32Preserves(lineage.genesis, previous, lineage.seed)
        || !publicV32Monotonic(previous, head) || !factsMonotonic(previous, head))) return null
    if (!previous) return { lineage, head, previous: null }
    if (previous.saveRevision === 0
      && !samePublicV14Value(previous, genesisHead(lineage))) return null
    if (previous.saveRevision === 1 && !samePublicV14Value(
      replayPublicV35Witness(genesisHead(lineage), previous.witness), progressOf(previous)))
      return null
    return samePublicV14Value(replayPublicV35Witness(progressOf(previous), head.witness),
      progressOf(head)) ? { lineage, head, previous } : null
  } catch { return null }
}

/** A locked store supplies the prior root from a one-use proof. */
export function decodePublicV35CheckedSuccessor(before: PublicV35Root,
  value: unknown): PublicV35Root | null {
  try {
    if (exactPublicV23(value, ['lineage', 'head', 'previous'])
      && sameStrictBoundedRaw([value.lineage, value.previous],
        [before.lineage, before.head], 3 << 20)) {
      const head = decodeHead(value.head, before.lineage)
      if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
        || !publicV32Preserves(before.lineage.genesis, head, before.lineage.seed)
        || !publicV32Monotonic(before.head, head)
        || !factsMonotonic(before.head, head)
        || !samePublicV14Value(replayPublicV35Witness(progressOf(before.head), head.witness),
          progressOf(head))) return null
      return { lineage: before.lineage, previous: before.head, head }
    }
    const candidate = decodePublicV35Root(value)
    return candidate && samePublicV14Value(candidate.lineage, before.lineage)
      && samePublicV14Value(candidate.previous, before.head) ? candidate : null
  } catch { return null }
}
