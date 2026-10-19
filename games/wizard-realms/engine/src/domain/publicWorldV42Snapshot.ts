import { highlandStoneNodes } from './highlandContent'
import { ironHallQuartermasterSite } from './ironHallQuartermasterSite'
import { samePublicV14Value } from './publicWorldV14Validation'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV32Monotonic, publicV32Preserves } from './publicWorldV32Snapshot'
import { PUBLIC_V41_PROGRESS_KEYS } from './publicWorldV41CombatAction'
import type { PublicV41CombatProgress } from './publicWorldV41CombatAction'
import { createFreshPublicV41Root, decodePublicV41Root,
  decodePublicV41Witness, replayPublicV41Witness } from './publicWorldV41Snapshot'
import type { PublicV41Root, PublicV41Witness } from './publicWorldV41Snapshot'
import { confirmPublicV42RewardAction, decodePublicV42RewardProgress,
  decodePublicV42RewardWitness, INITIAL_IRON_HALL_REWARD,
  PUBLIC_V42_PROGRESS_KEYS, replayPublicV42RewardFrameBatch,
  resolvePublicV42CrestAfterDefeat } from './publicWorldV42RewardAction'
import type { PublicV42RewardProgress, PublicV42RewardWitness } from './publicWorldV42RewardAction'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export const PUBLIC_V42_SCHEMA = 'wizard-world/v42' as const
export const PUBLIC_V42_DATABASE_NAME = 'wizard-realms:world:v42'
const FRESH_SEED = 'wizard-realms'

function inheritedProgressOf(raw: PublicV41CombatProgress): PublicV41CombatProgress {
  return Object.fromEntries(PUBLIC_V41_PROGRESS_KEYS.map((key) => [key, raw[key]])) as
    PublicV41CombatProgress
}
function progressOf(raw: PublicV42RewardProgress): PublicV42RewardProgress {
  return Object.fromEntries(PUBLIC_V42_PROGRESS_KEYS.map((key) => [key, raw[key]])) as
    PublicV42RewardProgress
}
const canonicalFreshGenesis: PublicV42RewardProgress = {
  ...inheritedProgressOf(createFreshPublicV41Root(FRESH_SEED).head),
  ironHallReward: structuredClone(INITIAL_IRON_HALL_REWARD) }

export type PublicV42Witness = PublicV41Witness | PublicV42RewardWitness
export type PublicV42Lineage = Readonly<{ rulesProfile: 'iron-hall-rewards/v1';
  seed: string; genesis: PublicV42RewardProgress }> & (
    Readonly<{ origin: 'v41-migration'; sourceRevision: number }>
    | Readonly<{ origin: 'fresh'; sourceRevision: null }>)
export type PublicV42Head = PublicV42RewardProgress & Readonly<{
  schemaVersion: typeof PUBLIC_V42_SCHEMA; saveRevision: number;
  witness: PublicV42Witness | null }>
export type PublicV42Root = Readonly<{ lineage: PublicV42Lineage;
  head: PublicV42Head; previous: PublicV42Head | null }>

const headKeys = ['schemaVersion', 'saveRevision', ...PUBLIC_V42_PROGRESS_KEYS, 'witness'] as const
const genesisHead = (lineage: PublicV42Lineage): PublicV42Head => ({
  ...structuredClone(lineage.genesis), schemaVersion: PUBLIC_V42_SCHEMA,
  saveRevision: 0, witness: null })

export const decodePublicV42Progress = decodePublicV42RewardProgress

/** Copy only the checked V41 head into a distinct V42 lineage. */
export function createPublicV42Root(source: PublicV41Root): PublicV42Root {
  const checked = decodePublicV41Root(source)
  if (!checked) throw new RangeError('Invalid checked V41 source root')
  const inherited = structuredClone(inheritedProgressOf(checked.head))
  const initial: PublicV42RewardProgress = {
    ...inherited, ironHallReward: structuredClone(INITIAL_IRON_HALL_REWARD) }
  const genesis = checked.head.ironHall.wardDefeated
    ? resolvePublicV42CrestAfterDefeat(initial) : initial
  if (!ironHallQuartermasterSite(genesis)) throw new RangeError('Unsupported quartermaster site')
  const lineage: PublicV42Lineage = { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed: genesis.state.seed,
    sourceRevision: checked.head.saveRevision, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function createFreshPublicV42Root(seed: string): PublicV42Root {
  if (seed !== FRESH_SEED) throw new RangeError('Invalid fresh seed')
  const genesis = structuredClone(canonicalFreshGenesis)
  if (!ironHallQuartermasterSite(genesis)) throw new RangeError('Unsupported quartermaster site')
  const lineage: PublicV42Lineage = { origin: 'fresh',
    rulesProfile: 'iron-hall-rewards/v1', seed, sourceRevision: null, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function decodePublicV42Lineage(value: unknown): PublicV42Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'rulesProfile', 'seed',
      'sourceRevision', 'genesis']) || value.rulesProfile !== 'iron-hall-rewards/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128
      || !(value.origin === 'fresh' && value.sourceRevision === null
        || value.origin === 'v41-migration'
          && Number.isSafeInteger(value.sourceRevision)
          && (value.sourceRevision as number) >= 0)) return null
    const genesis = decodePublicV42Progress(value.genesis)
    if (!genesis || genesis.state.seed !== value.seed
      || !ironHallQuartermasterSite(genesis)) return null
    const expected = resolvePublicV42CrestAfterDefeat({ ...genesis,
      ironHallReward: structuredClone(INITIAL_IRON_HALL_REWARD) })
    if (!samePublicV14Value(genesis.ironHallReward, expected.ironHallReward)) return null
    if (value.origin === 'fresh') return value.seed === FRESH_SEED
      && samePublicV14Value(genesis, canonicalFreshGenesis) ? { origin: 'fresh',
        rulesProfile: 'iron-hall-rewards/v1', seed: value.seed,
        sourceRevision: null, genesis } : null
    return { origin: 'v41-migration', rulesProfile: 'iron-hall-rewards/v1',
      seed: value.seed, sourceRevision: value.sourceRevision as number, genesis }
  } catch { return null }
}

export function decodePublicV42Witness(raw: unknown): PublicV42Witness | null {
  return decodePublicV42RewardWitness(raw) ?? decodePublicV41Witness(raw)
}

/** Inherited actions keep reward state; only first ward defeat resolves its crest. */
export function replayPublicV42Witness(before: PublicV42RewardProgress,
  raw: unknown): PublicV42RewardProgress | null {
  const witness = decodePublicV42Witness(raw)
  const progress = decodePublicV42Progress(progressOf(before))
  if (!witness || !progress) return null
  if (decodePublicV42RewardWitness(witness))
    return confirmPublicV42RewardAction(progress, witness).progress ?? null
  if (witness.kind === 'frame-batch/v1')
    return replayPublicV42RewardFrameBatch(progress, witness)
  const inherited = replayPublicV41Witness(inheritedProgressOf(progress), witness)
  if (!inherited) return null
  const next: PublicV42RewardProgress = { ...inherited,
    ironHallReward: progress.ironHallReward }
  return !progress.ironHall.wardDefeated && next.ironHall.wardDefeated
    ? resolvePublicV42CrestAfterDefeat(next) : next
}

const inheritedMonotonic = (a: PublicV42RewardProgress, b: PublicV42RewardProgress) =>
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
  && (!a.timberBartered || b.timberBartered)
  && (!a.southbankReached || b.southbankReached)
  && (!a.waystationClaimed || b.waystationClaimed)
  && (!a.ironHall.learnedBolt || b.ironHall.learnedBolt)
  && (!a.ironHall.wardDefeated || b.ironHall.wardDefeated)
  && a.ironHall.combatXp <= b.ironHall.combatXp
  && a.ironHall.knockouts <= b.ironHall.knockouts

const monotonic = (a: PublicV42RewardProgress, b: PublicV42RewardProgress) =>
  inheritedMonotonic(a, b)
  && (a.ironHallReward.crestOutcome === 'unrolled'
    || a.ironHallReward.crestOutcome === b.ironHallReward.crestOutcome)
  && (!a.ironHallReward.questClaimed || b.ironHallReward.questClaimed)
  && (!a.ironHallReward.vestOwned || b.ironHallReward.vestOwned)
  && a.ironHallReward.spar.strikesResolved <= b.ironHallReward.spar.strikesResolved
  && (!b.ironHallReward.questClaimed || b.state.player.xp >= a.state.player.xp
    + (a.ironHallReward.questClaimed ? 0 : 70))
  && (!b.ironHallReward.questClaimed || b.ironHall.combatXp >= a.ironHall.combatXp
    + (a.ironHallReward.questClaimed ? 0 : 70))

function decodeHead(raw: unknown, lineage: PublicV42Lineage): PublicV42Head | null {
  try {
    if (!exactPublicV23(raw, headKeys) || raw.schemaVersion !== PUBLIC_V42_SCHEMA
      || !Number.isSafeInteger(raw.saveRevision) || (raw.saveRevision as number) < 0) return null
    const progress = decodePublicV42Progress(Object.fromEntries(
      PUBLIC_V42_PROGRESS_KEYS.map((key) => [key, raw[key]])))
    if (!progress || progress.state.seed !== lineage.seed) return null
    if (raw.saveRevision === 0) return samePublicV14Value(raw, genesisHead(lineage))
      ? structuredClone(raw) as PublicV42Head : null
    const witness = decodePublicV42Witness(raw.witness)
    if (!witness || witness.kind === 'highland-extract/v1'
      && !highlandStoneNodes(lineage.seed).some(({ id }) => id === witness.nodeId)) return null
    return { ...progress, schemaVersion: PUBLIC_V42_SCHEMA,
      saveRevision: raw.saveRevision as number, witness }
  } catch { return null }
}

export function decodePublicV42Head(raw: unknown,
  rawLineage: PublicV42Lineage): PublicV42Head | null {
  const lineage = decodePublicV42Lineage(rawLineage)
  return lineage ? decodeHead(raw, lineage) : null
}

export function decodePublicV42Root(raw: unknown): PublicV42Root | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV42Lineage(raw.lineage)
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
      replayPublicV42Witness(genesisHead(lineage), previous.witness),
      progressOf(previous))) return null
    return samePublicV14Value(replayPublicV42Witness(progressOf(previous), head.witness),
      progressOf(head)) ? { lineage, head, previous } : null
  } catch { return null }
}

export function decodePublicV42CheckedSuccessor(before: PublicV42Root,
  raw: unknown): PublicV42Root | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'head', 'previous'])
      || !sameStrictBoundedRaw([raw.lineage, raw.previous],
        [before.lineage, before.head], 3 << 20)) return null
    const head = decodeHead(raw.head, before.lineage)
    if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
      || !publicV32Preserves(before.lineage.genesis, head, before.lineage.seed)
      || !publicV32Monotonic(before.head, head) || !monotonic(before.head, head)
      || !samePublicV14Value(replayPublicV42Witness(progressOf(before.head), head.witness),
        progressOf(head))) return null
    return { lineage: before.lineage, previous: before.head, head }
  } catch { return null }
}
