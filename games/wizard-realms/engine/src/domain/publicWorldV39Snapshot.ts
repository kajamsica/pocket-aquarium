import { highlandStoneNodes } from './highlandContent'
import { samePublicV14Value } from './publicWorldV14Validation'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV32Monotonic, publicV32Preserves } from './publicWorldV32Snapshot'
import { createFreshPublicV38Root, decodePublicV38Root,
  decodePublicV38Witness, replayPublicV38Witness } from './publicWorldV38Snapshot'
import type { PublicV38Root, PublicV38Witness } from './publicWorldV38Snapshot'
import { confirmPublicV39RingAction, decodePublicV39RingProgress, decodePublicV39RingWitness,
  PUBLIC_V39_PROGRESS_KEYS } from './publicWorldV39RingAction'
import type { PublicV39RingProgress, PublicV39RingWitness } from './publicWorldV39RingAction'
import type { PublicV38SignalProgress } from './publicWorldV38SignalAction'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export const PUBLIC_V39_SCHEMA = 'wizard-world/v39' as const
export const PUBLIC_V39_DATABASE_NAME = 'wizard-realms:world:v39'
const FRESH_SEED = 'wizard-realms'
const freshV38Head = createFreshPublicV38Root(FRESH_SEED).head
const canonicalFreshGenesis: PublicV39RingProgress = {
  ...inheritedProgressOf(freshV38Head), quarryRingDiscovered: false,
  ringLinkEstablished: false, ringOutboundCompleted: false,
  ringReturnCompleted: false, ringkeeperClaimed: false }

export type PublicV39Witness = PublicV38Witness | PublicV39RingWitness
export type PublicV39Lineage = Readonly<{ rulesProfile: 'ringkeeper-trail/v1';
  seed: string; genesis: PublicV39RingProgress }> & (
    Readonly<{ origin: 'v38-migration'; sourceRevision: number }>
    | Readonly<{ origin: 'fresh'; sourceRevision: null }>)
export type PublicV39Head = PublicV39RingProgress & Readonly<{
  schemaVersion: typeof PUBLIC_V39_SCHEMA; saveRevision: number;
  witness: PublicV39Witness | null }>
export type PublicV39Root = Readonly<{ lineage: PublicV39Lineage;
  head: PublicV39Head; previous: PublicV39Head | null }>

const headKeys = ['schemaVersion', 'saveRevision', ...PUBLIC_V39_PROGRESS_KEYS, 'witness'] as const
function inheritedProgressOf({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells,
  ledgerSurveyBridgeId, ledgerClaimReward, markerClaimReward,
  signalVantageInspected, signalClaimed }: PublicV38SignalProgress):
  PublicV38SignalProgress { return { state, greenwayWorks, regionalWorks, terrain,
    nextHomeAtMs, riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells,
    ledgerSurveyBridgeId, ledgerClaimReward, markerClaimReward,
    signalVantageInspected, signalClaimed } }
function progressOf({ quarryRingDiscovered, ringLinkEstablished, ringOutboundCompleted,
  ringReturnCompleted, ringkeeperClaimed,
  ...inherited }: PublicV39RingProgress): PublicV39RingProgress {
  return { ...inheritedProgressOf(inherited), quarryRingDiscovered, ringLinkEstablished,
    ringOutboundCompleted, ringReturnCompleted, ringkeeperClaimed }
}
const genesisHead = (lineage: PublicV39Lineage): PublicV39Head => ({
  ...lineage.genesis, schemaVersion: PUBLIC_V39_SCHEMA,
  saveRevision: 0, witness: null })

export const decodePublicV39Progress = decodePublicV39RingProgress

/** Copy only a checked V38 head. V38's database and root remain untouched. */
export function createPublicV39Root(source: PublicV38Root): PublicV39Root {
  const checked = decodePublicV38Root(source)
  if (!checked) throw new RangeError('Invalid checked V38 source root')
  const genesis: PublicV39RingProgress = { ...structuredClone(inheritedProgressOf(checked.head)),
    quarryRingDiscovered: false, ringLinkEstablished: false,
    ringOutboundCompleted: false, ringReturnCompleted: false, ringkeeperClaimed: false }
  const lineage: PublicV39Lineage = { origin: 'v38-migration',
    rulesProfile: 'ringkeeper-trail/v1', seed: genesis.state.seed,
    sourceRevision: checked.head.saveRevision, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function createFreshPublicV39Root(seed: string): PublicV39Root {
  if (seed !== FRESH_SEED) throw new RangeError('Invalid fresh seed')
  const genesis = structuredClone(canonicalFreshGenesis)
  const lineage: PublicV39Lineage = { origin: 'fresh',
    rulesProfile: 'ringkeeper-trail/v1', seed, sourceRevision: null, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function decodePublicV39Lineage(value: unknown): PublicV39Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'rulesProfile', 'seed',
      'sourceRevision', 'genesis']) || value.rulesProfile !== 'ringkeeper-trail/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128
      || !(value.origin === 'fresh' && value.sourceRevision === null
        || value.origin === 'v38-migration'
          && Number.isSafeInteger(value.sourceRevision)
          && (value.sourceRevision as number) >= 0)) return null
    const genesis = decodePublicV39Progress(value.genesis)
    if (!genesis || genesis.state.seed !== value.seed
      || genesis.quarryRingDiscovered || genesis.ringLinkEstablished
      || genesis.ringOutboundCompleted || genesis.ringReturnCompleted
      || genesis.ringkeeperClaimed) return null
    if (value.origin === 'fresh') return value.seed === FRESH_SEED
      && samePublicV14Value(genesis, canonicalFreshGenesis) ? { origin: 'fresh',
        rulesProfile: 'ringkeeper-trail/v1', seed: value.seed,
        sourceRevision: null, genesis } : null
    return { origin: 'v38-migration', rulesProfile: 'ringkeeper-trail/v1',
      seed: value.seed, sourceRevision: value.sourceRevision as number, genesis }
  } catch { return null }
}

export function decodePublicV39Witness(raw: unknown): PublicV39Witness | null {
  return decodePublicV39RingWitness(raw) ?? decodePublicV38Witness(raw)
}

/** Inherited replay cannot change the V39-only flags. */
export function replayPublicV39Witness(before: PublicV39RingProgress,
  raw: unknown): PublicV39RingProgress | null {
  const witness = decodePublicV39Witness(raw)
  if (!witness) return null
  const progress = progressOf(before)
  if (witness.kind === 'ringkeeper-discover/v1' || witness.kind === 'ringkeeper-link/v1'
    || witness.kind === 'ringkeeper-travel/v1' || witness.kind === 'ringkeeper-claim/v1')
    return confirmPublicV39RingAction(progress, witness).progress ?? null
  const inherited = replayPublicV38Witness(inheritedProgressOf(progress), witness)
  return inherited ? { ...inherited,
    quarryRingDiscovered: progress.quarryRingDiscovered,
    ringLinkEstablished: progress.ringLinkEstablished,
    ringOutboundCompleted: progress.ringOutboundCompleted,
    ringReturnCompleted: progress.ringReturnCompleted,
    ringkeeperClaimed: progress.ringkeeperClaimed } : null
}

const monotonic = (a: PublicV39RingProgress, b: PublicV39RingProgress) =>
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
  && (!a.quarryRingDiscovered || b.quarryRingDiscovered)
  && (!a.ringLinkEstablished || b.ringLinkEstablished)
  && (!a.ringOutboundCompleted || b.ringOutboundCompleted)
  && (!a.ringReturnCompleted || b.ringReturnCompleted)
  && (!a.ringkeeperClaimed || b.ringkeeperClaimed)

function decodeHead(raw: unknown, lineage: PublicV39Lineage): PublicV39Head | null {
  try {
    if (!exactPublicV23(raw, headKeys) || raw.schemaVersion !== PUBLIC_V39_SCHEMA
      || !Number.isSafeInteger(raw.saveRevision) || (raw.saveRevision as number) < 0) return null
    const progress = decodePublicV39Progress(Object.fromEntries(
      PUBLIC_V39_PROGRESS_KEYS.map((key) => [key, raw[key]])))
    if (!progress || progress.state.seed !== lineage.seed) return null
    if (raw.saveRevision === 0) return samePublicV14Value(raw, genesisHead(lineage))
      ? structuredClone(raw) as PublicV39Head : null
    const witness = decodePublicV39Witness(raw.witness)
    if (!witness || witness.kind === 'highland-extract/v1'
      && !highlandStoneNodes(lineage.seed).some(({ id }) => id === witness.nodeId)) return null
    return { ...progress, schemaVersion: PUBLIC_V39_SCHEMA,
      saveRevision: raw.saveRevision as number, witness }
  } catch { return null }
}

export function decodePublicV39Head(raw: unknown,
  rawLineage: PublicV39Lineage): PublicV39Head | null {
  const lineage = decodePublicV39Lineage(rawLineage)
  return lineage ? decodeHead(raw, lineage) : null
}

export function decodePublicV39Root(raw: unknown): PublicV39Root | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV39Lineage(raw.lineage)
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
      replayPublicV39Witness(genesisHead(lineage), previous.witness),
      progressOf(previous))) return null
    return samePublicV14Value(replayPublicV39Witness(progressOf(previous), head.witness),
      progressOf(head)) ? { lineage, head, previous } : null
  } catch { return null }
}

export function decodePublicV39CheckedSuccessor(before: PublicV39Root,
  raw: unknown): PublicV39Root | null {
  try {
    if (exactPublicV23(raw, ['lineage', 'head', 'previous'])
      && sameStrictBoundedRaw([raw.lineage, raw.previous],
        [before.lineage, before.head], 3 << 20)) {
      const head = decodeHead(raw.head, before.lineage)
      if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
        || !publicV32Preserves(before.lineage.genesis, head, before.lineage.seed)
        || !publicV32Monotonic(before.head, head) || !monotonic(before.head, head)
        || !samePublicV14Value(replayPublicV39Witness(progressOf(before.head), head.witness),
          progressOf(head))) return null
      return { lineage: before.lineage, previous: before.head, head }
    }
    const candidate = decodePublicV39Root(raw)
    return candidate && samePublicV14Value(candidate.lineage, before.lineage)
      && samePublicV14Value(candidate.previous, before.head) ? candidate : null
  } catch { return null }
}
