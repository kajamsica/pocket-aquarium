import { highlandStoneNodes } from './highlandContent'
import { samePublicV14Value } from './publicWorldV14Validation'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV32Monotonic, publicV32Preserves } from './publicWorldV32Snapshot'
import { PUBLIC_V37_PROGRESS_KEYS } from './publicWorldV37WindwardAction'
import { createFreshPublicV37Root, decodePublicV37Progress, decodePublicV37Root,
  decodePublicV37Witness, replayPublicV37Witness } from './publicWorldV37Snapshot'
import type { PublicV37Root, PublicV37Witness } from './publicWorldV37Snapshot'
import { confirmPublicV38SignalAction, decodePublicV38SignalWitness,
  PUBLIC_V38_PROGRESS_KEYS } from './publicWorldV38SignalAction'
import type { PublicV38SignalProgress, PublicV38SignalWitness } from './publicWorldV38SignalAction'
import type { PublicV36MarkerProgress } from './publicWorldV36MarkerAction'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export const PUBLIC_V38_SCHEMA = 'wizard-world/v38' as const
export const PUBLIC_V38_DATABASE_NAME = 'wizard-realms:world:v38'
const FRESH_SEED = 'wizard-realms'
const freshV37Head = createFreshPublicV37Root(FRESH_SEED).head
const canonicalFreshGenesis: PublicV38SignalProgress = {
  ...inheritedProgressOf(freshV37Head), signalVantageInspected: false, signalClaimed: false }

export type PublicV38Witness = PublicV37Witness | PublicV38SignalWitness
export type PublicV38Lineage = Readonly<{ rulesProfile: 'highland-signal/v1';
  seed: string; genesis: PublicV38SignalProgress }> & (
    Readonly<{ origin: 'v37-migration'; sourceRevision: number }>
    | Readonly<{ origin: 'fresh'; sourceRevision: null }>)
export type PublicV38Head = PublicV38SignalProgress & Readonly<{
  schemaVersion: typeof PUBLIC_V38_SCHEMA; saveRevision: number;
  witness: PublicV38Witness | null }>
export type PublicV38Root = Readonly<{ lineage: PublicV38Lineage;
  head: PublicV38Head; previous: PublicV38Head | null }>

const headKeys = ['schemaVersion', 'saveRevision', ...PUBLIC_V38_PROGRESS_KEYS, 'witness'] as const
function inheritedProgressOf({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells,
  ledgerSurveyBridgeId, ledgerClaimReward, markerClaimReward }: PublicV36MarkerProgress):
  PublicV36MarkerProgress { return { state, greenwayWorks, regionalWorks, terrain,
    nextHomeAtMs, riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells,
    ledgerSurveyBridgeId, ledgerClaimReward, markerClaimReward } }
function progressOf({ signalVantageInspected, signalClaimed,
  ...inherited }: PublicV38SignalProgress): PublicV38SignalProgress {
  return { ...inheritedProgressOf(inherited), signalVantageInspected, signalClaimed }
}
const genesisHead = (lineage: PublicV38Lineage): PublicV38Head => ({
  ...lineage.genesis, schemaVersion: PUBLIC_V38_SCHEMA,
  saveRevision: 0, witness: null })

export function decodePublicV38Progress(raw: unknown): PublicV38SignalProgress | null {
  try {
    if (!exactPublicV23(raw, PUBLIC_V38_PROGRESS_KEYS)
      || typeof raw.signalVantageInspected !== 'boolean'
      || typeof raw.signalClaimed !== 'boolean'
      || raw.signalClaimed && !raw.signalVantageInspected) return null
    const inherited = decodePublicV37Progress(Object.fromEntries(
      PUBLIC_V37_PROGRESS_KEYS.map((key) => [key, raw[key]])))
    return inherited ? { ...inherited,
      signalVantageInspected: raw.signalVantageInspected,
      signalClaimed: raw.signalClaimed } : null
  } catch { return null }
}

/** Copy only a checked V37 head. V37's database and root remain untouched. */
export function createPublicV38Root(source: PublicV37Root): PublicV38Root {
  const checked = decodePublicV37Root(source)
  if (!checked) throw new RangeError('Invalid checked V37 source root')
  const genesis: PublicV38SignalProgress = { ...structuredClone(inheritedProgressOf(checked.head)),
    signalVantageInspected: false, signalClaimed: false }
  const lineage: PublicV38Lineage = { origin: 'v37-migration',
    rulesProfile: 'highland-signal/v1', seed: genesis.state.seed,
    sourceRevision: checked.head.saveRevision, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function createFreshPublicV38Root(seed: string): PublicV38Root {
  if (seed !== FRESH_SEED) throw new RangeError('Invalid fresh seed')
  const genesis = structuredClone(canonicalFreshGenesis)
  const lineage: PublicV38Lineage = { origin: 'fresh',
    rulesProfile: 'highland-signal/v1', seed, sourceRevision: null, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function decodePublicV38Lineage(value: unknown): PublicV38Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'rulesProfile', 'seed',
      'sourceRevision', 'genesis']) || value.rulesProfile !== 'highland-signal/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128
      || !(value.origin === 'fresh' && value.sourceRevision === null
        || value.origin === 'v37-migration'
          && Number.isSafeInteger(value.sourceRevision)
          && (value.sourceRevision as number) >= 0)) return null
    const genesis = decodePublicV38Progress(value.genesis)
    if (!genesis || genesis.state.seed !== value.seed
      || genesis.signalVantageInspected || genesis.signalClaimed) return null
    if (value.origin === 'fresh') return value.seed === FRESH_SEED
      && samePublicV14Value(genesis, canonicalFreshGenesis) ? { origin: 'fresh',
        rulesProfile: 'highland-signal/v1', seed: value.seed,
        sourceRevision: null, genesis } : null
    return { origin: 'v37-migration', rulesProfile: 'highland-signal/v1',
      seed: value.seed, sourceRevision: value.sourceRevision as number, genesis }
  } catch { return null }
}

export function decodePublicV38Witness(raw: unknown): PublicV38Witness | null {
  return decodePublicV38SignalWitness(raw) ?? decodePublicV37Witness(raw)
}

/** Inherited replay cannot change the V38-only flags. */
export function replayPublicV38Witness(before: PublicV38SignalProgress,
  raw: unknown): PublicV38SignalProgress | null {
  const witness = decodePublicV38Witness(raw)
  if (!witness) return null
  const progress = progressOf(before)
  if (witness.kind === 'signal-vantage/v1' || witness.kind === 'signal-claim/v1')
    return confirmPublicV38SignalAction(progress, witness).progress ?? null
  const inherited = replayPublicV37Witness(inheritedProgressOf(progress), witness)
  return inherited ? { ...inherited,
    signalVantageInspected: progress.signalVantageInspected,
    signalClaimed: progress.signalClaimed } : null
}

const monotonic = (a: PublicV38SignalProgress, b: PublicV38SignalProgress) =>
  (a.ledgerSurveyBridgeId === null || a.ledgerSurveyBridgeId === b.ledgerSurveyBridgeId)
  && (a.ledgerClaimReward === null || a.ledgerClaimReward === b.ledgerClaimReward)
  && (a.markerClaimReward === null || a.markerClaimReward === b.markerClaimReward)
  && (!a.state.windstep.learned || b.state.windstep.learned)
  && a.state.windstep.activeUntilTick <= b.state.windstep.activeUntilTick
  && a.state.windstep.nextCastTick <= b.state.windstep.nextCastTick
  && a.state.windstep.practicedRouteIndices.every((index) =>
    b.state.windstep.practicedRouteIndices.includes(index))
  && (!a.signalVantageInspected || b.signalVantageInspected)
  && (!a.signalClaimed || b.signalClaimed)

function decodeHead(raw: unknown, lineage: PublicV38Lineage): PublicV38Head | null {
  try {
    if (!exactPublicV23(raw, headKeys) || raw.schemaVersion !== PUBLIC_V38_SCHEMA
      || !Number.isSafeInteger(raw.saveRevision) || (raw.saveRevision as number) < 0) return null
    const progress = decodePublicV38Progress(Object.fromEntries(
      PUBLIC_V38_PROGRESS_KEYS.map((key) => [key, raw[key]])))
    if (!progress || progress.state.seed !== lineage.seed) return null
    if (raw.saveRevision === 0) return samePublicV14Value(raw, genesisHead(lineage))
      ? structuredClone(raw) as PublicV38Head : null
    const witness = decodePublicV38Witness(raw.witness)
    if (!witness || witness.kind === 'highland-extract/v1'
      && !highlandStoneNodes(lineage.seed).some(({ id }) => id === witness.nodeId)) return null
    return { ...progress, schemaVersion: PUBLIC_V38_SCHEMA,
      saveRevision: raw.saveRevision as number, witness }
  } catch { return null }
}

export function decodePublicV38Head(raw: unknown,
  rawLineage: PublicV38Lineage): PublicV38Head | null {
  const lineage = decodePublicV38Lineage(rawLineage)
  return lineage ? decodeHead(raw, lineage) : null
}

export function decodePublicV38Root(raw: unknown): PublicV38Root | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV38Lineage(raw.lineage)
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
      replayPublicV38Witness(genesisHead(lineage), previous.witness),
      progressOf(previous))) return null
    return samePublicV14Value(replayPublicV38Witness(progressOf(previous), head.witness),
      progressOf(head)) ? { lineage, head, previous } : null
  } catch { return null }
}

export function decodePublicV38CheckedSuccessor(before: PublicV38Root,
  raw: unknown): PublicV38Root | null {
  try {
    if (exactPublicV23(raw, ['lineage', 'head', 'previous'])
      && sameStrictBoundedRaw([raw.lineage, raw.previous],
        [before.lineage, before.head], 3 << 20)) {
      const head = decodeHead(raw.head, before.lineage)
      if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
        || !publicV32Preserves(before.lineage.genesis, head, before.lineage.seed)
        || !publicV32Monotonic(before.head, head) || !monotonic(before.head, head)
        || !samePublicV14Value(replayPublicV38Witness(progressOf(before.head), head.witness),
          progressOf(head))) return null
      return { lineage: before.lineage, previous: before.head, head }
    }
    const candidate = decodePublicV38Root(raw)
    return candidate && samePublicV14Value(candidate.lineage, before.lineage)
      && samePublicV14Value(candidate.previous, before.head) ? candidate : null
  } catch { return null }
}
