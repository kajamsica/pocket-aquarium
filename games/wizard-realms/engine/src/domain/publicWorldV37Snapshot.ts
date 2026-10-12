import { highlandStoneNodes } from './highlandContent'
import { samePublicV14Value } from './publicWorldV14Validation'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV32Monotonic, publicV32Preserves } from './publicWorldV32Snapshot'
import { createFreshPublicV36Root, decodePublicV36Root, decodePublicV36Witness,
  replayPublicV36Witness } from './publicWorldV36Snapshot'
import type { PublicV36Root, PublicV36Witness } from './publicWorldV36Snapshot'
import { confirmPublicV37WindwardAction, decodePublicV37WindwardWitness,
  decodePublicV37WindwardProgress, PUBLIC_V37_PROGRESS_KEYS } from './publicWorldV37WindwardAction'
import type { PublicV37WindwardWitness } from './publicWorldV37WindwardAction'
import { replayPublicV37FrameBatch } from './publicWorldV37Movement'
import type { PublicV36MarkerProgress } from './publicWorldV36MarkerAction'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export const PUBLIC_V37_SCHEMA = 'wizard-world/v37' as const
export const PUBLIC_V37_DATABASE_NAME = 'wizard-realms:world:v37'
const FRESH_SEED = 'wizard-realms'
const canonicalFreshGenesis = progressOf(createFreshPublicV36Root(FRESH_SEED).head)
export type PublicV37Witness = PublicV36Witness | PublicV37WindwardWitness
export type PublicV37Lineage = Readonly<{ rulesProfile: 'windward-step/v1';
  seed: string; genesis: PublicV36MarkerProgress }> & (
    Readonly<{ origin: 'v36-migration'; sourceRevision: number }>
    | Readonly<{ origin: 'fresh'; sourceRevision: null }>)
export type PublicV37Head = PublicV36MarkerProgress & Readonly<{
  schemaVersion: typeof PUBLIC_V37_SCHEMA; saveRevision: number;
  witness: PublicV37Witness | null }>
export type PublicV37Root = Readonly<{ lineage: PublicV37Lineage;
  head: PublicV37Head; previous: PublicV37Head | null }>

const progressKeys = PUBLIC_V37_PROGRESS_KEYS
const headKeys = ['schemaVersion', 'saveRevision', ...progressKeys, 'witness'] as const
export const decodePublicV37Progress = decodePublicV37WindwardProgress
function progressOf({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells,
  ledgerSurveyBridgeId, ledgerClaimReward, markerClaimReward }: PublicV36MarkerProgress):
  PublicV36MarkerProgress { return { state, greenwayWorks, regionalWorks, terrain,
    nextHomeAtMs, riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells,
    ledgerSurveyBridgeId, ledgerClaimReward, markerClaimReward } }
const genesisHead = (lineage: PublicV37Lineage): PublicV37Head => ({
  ...lineage.genesis, schemaVersion: PUBLIC_V37_SCHEMA,
  saveRevision: 0, witness: null })

export function createPublicV37Root(source: PublicV36Root): PublicV37Root {
  const checked = decodePublicV36Root(source)
  if (!checked) throw new RangeError('Invalid checked V36 source root')
  const { schemaVersion: _schema, saveRevision: sourceRevision,
    witness: _witness, ...progress } = checked.head
  const genesis = structuredClone(progress)
  const lineage: PublicV37Lineage = { origin: 'v36-migration',
    rulesProfile: 'windward-step/v1', seed: genesis.state.seed, sourceRevision, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function createFreshPublicV37Root(seed: string): PublicV37Root {
  if (seed !== FRESH_SEED) throw new RangeError('Invalid fresh seed')
  const genesis = structuredClone(canonicalFreshGenesis)
  const lineage: PublicV37Lineage = { origin: 'fresh',
    rulesProfile: 'windward-step/v1', seed, sourceRevision: null, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function decodePublicV37Lineage(value: unknown): PublicV37Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'rulesProfile', 'seed',
      'sourceRevision', 'genesis']) || value.rulesProfile !== 'windward-step/v1'
      || typeof value.seed !== 'string'
      || !value.seed || value.seed.length > 128
      || !(value.origin === 'fresh' && value.sourceRevision === null
        || value.origin === 'v36-migration'
          && Number.isSafeInteger(value.sourceRevision)
          && (value.sourceRevision as number) >= 0)
      || !exactPublicV23(value.genesis, progressKeys)) return null
    const genesis = decodePublicV37Progress(value.genesis)
    if (!genesis || genesis.state.seed !== value.seed) return null
    if (value.origin === 'fresh') return value.seed === FRESH_SEED
      && samePublicV14Value(genesis, canonicalFreshGenesis) ? { origin: 'fresh',
        rulesProfile: 'windward-step/v1', seed: value.seed, sourceRevision: null, genesis } : null
    return { origin: 'v36-migration', rulesProfile: 'windward-step/v1', seed: value.seed,
      sourceRevision: value.sourceRevision as number, genesis }
  } catch { return null }
}

export function decodePublicV37Witness(raw: unknown): PublicV37Witness | null {
  return decodePublicV37WindwardWitness(raw) ?? decodePublicV36Witness(raw)
}

export function replayPublicV37Witness(before: PublicV36MarkerProgress,
  raw: unknown): PublicV36MarkerProgress | null {
  const witness = decodePublicV37Witness(raw)
  if (!witness) return null
  const progress = progressOf(before)
  if (witness.kind === 'windward-study/v1' || witness.kind === 'windward-cast/v1')
    return confirmPublicV37WindwardAction(progress, witness).progress ?? null
  return witness.kind === 'frame-batch/v1'
    ? replayPublicV37FrameBatch(progress, witness)
    : replayPublicV36Witness(progress, witness)
}

const monotonic = (a: PublicV36MarkerProgress, b: PublicV36MarkerProgress) =>
  (a.ledgerSurveyBridgeId === null || a.ledgerSurveyBridgeId === b.ledgerSurveyBridgeId)
  && (a.ledgerClaimReward === null || a.ledgerClaimReward === b.ledgerClaimReward)
  && (a.markerClaimReward === null || a.markerClaimReward === b.markerClaimReward)
  && (!a.state.windstep.learned || b.state.windstep.learned)
  && a.state.windstep.activeUntilTick <= b.state.windstep.activeUntilTick
  && a.state.windstep.nextCastTick <= b.state.windstep.nextCastTick
  && a.state.windstep.practicedRouteIndices.every((index) =>
    b.state.windstep.practicedRouteIndices.includes(index))

function decodeHead(raw: unknown, lineage: PublicV37Lineage): PublicV37Head | null {
  try {
    if (!exactPublicV23(raw, headKeys) || raw.schemaVersion !== PUBLIC_V37_SCHEMA
      || !Number.isSafeInteger(raw.saveRevision) || (raw.saveRevision as number) < 0) return null
    const progress = decodePublicV37Progress(Object.fromEntries(progressKeys.map((key) => [key, raw[key]])))
    if (!progress || progress.state.seed !== lineage.seed) return null
    if (raw.saveRevision === 0) return samePublicV14Value(raw, genesisHead(lineage))
      ? structuredClone(raw) as PublicV37Head : null
    const witness = decodePublicV37Witness(raw.witness)
    if (!witness || witness.kind === 'highland-extract/v1'
      && !highlandStoneNodes(lineage.seed).some(({ id }) => id === witness.nodeId)) return null
    return { ...progress, schemaVersion: PUBLIC_V37_SCHEMA,
      saveRevision: raw.saveRevision as number, witness }
  } catch { return null }
}

export function decodePublicV37Head(raw: unknown,
  rawLineage: PublicV37Lineage): PublicV37Head | null {
  const lineage = decodePublicV37Lineage(rawLineage)
  return lineage ? decodeHead(raw, lineage) : null
}

export function decodePublicV37Root(raw: unknown): PublicV37Root | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV37Lineage(raw.lineage)
    const head = lineage && decodeHead(raw.head, lineage)
    const previous = lineage && raw.previous !== null
      ? decodeHead(raw.previous, lineage) : null
    if (!lineage || !head || (head.saveRevision === 0 ? raw.previous !== null
      : !previous || head.saveRevision !== previous.saveRevision + 1 || !head.witness)
      || !publicV32Preserves(lineage.genesis, head, lineage.seed)
      || !monotonic(genesisHead(lineage), head)
      || previous && (!publicV32Preserves(lineage.genesis, previous, lineage.seed)
        || !publicV32Monotonic(previous, head) || !monotonic(previous, head))) return null
    if (!previous) return { lineage, head, previous: null }
    if (previous.saveRevision === 0
      && !samePublicV14Value(previous, genesisHead(lineage))) return null
    if (previous.saveRevision === 1 && !samePublicV14Value(
      replayPublicV37Witness(genesisHead(lineage), previous.witness),
      progressOf(previous))) return null
    return samePublicV14Value(replayPublicV37Witness(progressOf(previous), head.witness),
      progressOf(head)) ? { lineage, head, previous } : null
  } catch { return null }
}

export function decodePublicV37CheckedSuccessor(before: PublicV37Root,
  raw: unknown): PublicV37Root | null {
  try {
    if (exactPublicV23(raw, ['lineage', 'head', 'previous'])
      && sameStrictBoundedRaw([raw.lineage, raw.previous],
        [before.lineage, before.head], 3 << 20)) {
      const head = decodeHead(raw.head, before.lineage)
      if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
        || !publicV32Preserves(before.lineage.genesis, head, before.lineage.seed)
        || !publicV32Monotonic(before.head, head) || !monotonic(before.head, head)
        || !samePublicV14Value(replayPublicV37Witness(progressOf(before.head), head.witness),
          progressOf(head))) return null
      return { lineage: before.lineage, previous: before.head, head }
    }
    const candidate = decodePublicV37Root(raw)
    return candidate && samePublicV14Value(candidate.lineage, before.lineage)
      && samePublicV14Value(candidate.previous, before.head) ? candidate : null
  } catch { return null }
}
