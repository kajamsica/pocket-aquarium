import { highlandStoneNodes } from './highlandContent'
import { ironHallSite } from './ironHallSite'
import { samePublicV14Value } from './publicWorldV14Validation'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV32Monotonic, publicV32Preserves } from './publicWorldV32Snapshot'
import { createFreshPublicV40Root, decodePublicV40Root,
  decodePublicV40Witness, replayPublicV40Witness } from './publicWorldV40Snapshot'
import type { PublicV40Root, PublicV40Witness } from './publicWorldV40Snapshot'
import { PUBLIC_V40_PROGRESS_KEYS } from './publicWorldV40WaystationAction'
import type { PublicV40WaystationProgress } from './publicWorldV40WaystationAction'
import { confirmPublicV41CombatAction, decodePublicV41CombatProgress,
  decodePublicV41CombatWitness, INITIAL_IRON_HALL_COMBAT,
  PUBLIC_V41_PROGRESS_KEYS, replayPublicV41CombatFrameBatch } from './publicWorldV41CombatAction'
import type { PublicV41CombatProgress, PublicV41CombatWitness } from './publicWorldV41CombatAction'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export const PUBLIC_V41_SCHEMA = 'wizard-world/v41' as const
export const PUBLIC_V41_DATABASE_NAME = 'wizard-realms:world:v41'
const FRESH_SEED = 'wizard-realms'

function inheritedProgressOf(raw: PublicV40WaystationProgress): PublicV40WaystationProgress {
  return Object.fromEntries(PUBLIC_V40_PROGRESS_KEYS.map((key) => [key, raw[key]])) as
    unknown as PublicV40WaystationProgress
}
function progressOf(raw: PublicV41CombatProgress): PublicV41CombatProgress {
  return Object.fromEntries(PUBLIC_V41_PROGRESS_KEYS.map((key) => [key, raw[key]])) as
    unknown as PublicV41CombatProgress
}
const canonicalFreshGenesis: PublicV41CombatProgress = {
  ...inheritedProgressOf(createFreshPublicV40Root(FRESH_SEED).head),
  ironHall: structuredClone(INITIAL_IRON_HALL_COMBAT) }

export type PublicV41Witness = PublicV40Witness | PublicV41CombatWitness
export type PublicV41Lineage = Readonly<{ rulesProfile: 'iron-hall-combat/v1';
  seed: string; genesis: PublicV41CombatProgress }> & (
    Readonly<{ origin: 'v40-migration'; sourceRevision: number }>
    | Readonly<{ origin: 'fresh'; sourceRevision: null }>)
export type PublicV41Head = PublicV41CombatProgress & Readonly<{
  schemaVersion: typeof PUBLIC_V41_SCHEMA; saveRevision: number;
  witness: PublicV41Witness | null }>
export type PublicV41Root = Readonly<{ lineage: PublicV41Lineage;
  head: PublicV41Head; previous: PublicV41Head | null }>

const headKeys = ['schemaVersion', 'saveRevision', ...PUBLIC_V41_PROGRESS_KEYS, 'witness'] as const
const genesisHead = (lineage: PublicV41Lineage): PublicV41Head => ({
  ...lineage.genesis, schemaVersion: PUBLIC_V41_SCHEMA,
  saveRevision: 0, witness: null })

export const decodePublicV41Progress = decodePublicV41CombatProgress

/** Copy a checked V40 head into a separate V41 lineage without touching its source. */
export function createPublicV41Root(source: PublicV40Root): PublicV41Root {
  const checked = decodePublicV40Root(source)
  if (!checked) throw new RangeError('Invalid checked V40 source root')
  const inherited = inheritedProgressOf(checked.head)
  if (!ironHallSite(inherited)) throw new RangeError('Unsupported Iron Hall site')
  const genesis: PublicV41CombatProgress = {
    ...structuredClone(inherited), ironHall: structuredClone(INITIAL_IRON_HALL_COMBAT) }
  const lineage: PublicV41Lineage = { origin: 'v40-migration',
    rulesProfile: 'iron-hall-combat/v1', seed: genesis.state.seed,
    sourceRevision: checked.head.saveRevision, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function createFreshPublicV41Root(seed: string): PublicV41Root {
  if (seed !== FRESH_SEED) throw new RangeError('Invalid fresh seed')
  const genesis = structuredClone(canonicalFreshGenesis)
  if (!ironHallSite(genesis)) throw new RangeError('Unsupported Iron Hall site')
  const lineage: PublicV41Lineage = { origin: 'fresh',
    rulesProfile: 'iron-hall-combat/v1', seed, sourceRevision: null, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function decodePublicV41Lineage(value: unknown): PublicV41Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'rulesProfile', 'seed',
      'sourceRevision', 'genesis']) || value.rulesProfile !== 'iron-hall-combat/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128
      || !(value.origin === 'fresh' && value.sourceRevision === null
        || value.origin === 'v40-migration'
          && Number.isSafeInteger(value.sourceRevision)
          && (value.sourceRevision as number) >= 0)) return null
    const genesis = decodePublicV41Progress(value.genesis)
    if (!genesis || genesis.state.seed !== value.seed || !ironHallSite(genesis)
      || !samePublicV14Value(genesis.ironHall, INITIAL_IRON_HALL_COMBAT)) return null
    if (value.origin === 'fresh') return value.seed === FRESH_SEED
      && samePublicV14Value(genesis, canonicalFreshGenesis) ? { origin: 'fresh',
        rulesProfile: 'iron-hall-combat/v1', seed: value.seed,
        sourceRevision: null, genesis } : null
    return { origin: 'v40-migration', rulesProfile: 'iron-hall-combat/v1',
      seed: value.seed, sourceRevision: value.sourceRevision as number, genesis }
  } catch { return null }
}

export function decodePublicV41Witness(raw: unknown): PublicV41Witness | null {
  return decodePublicV41CombatWitness(raw) ?? decodePublicV40Witness(raw)
}

/** Inherited actions retain combat state; frame batches advance it at each V40 frame. */
export function replayPublicV41Witness(before: PublicV41CombatProgress,
  raw: unknown): PublicV41CombatProgress | null {
  const witness = decodePublicV41Witness(raw)
  if (!witness) return null
  const progress = progressOf(before)
  if (witness.kind === 'ironhall-study/v1' || witness.kind === 'ironhall-engage/v1'
    || witness.kind === 'ironhall-bolt/v1' || witness.kind === 'ironhall-guard/v1'
    || witness.kind === 'ironhall-rest/v1')
    return confirmPublicV41CombatAction(progress, witness).progress ?? null
  if (witness.kind === 'frame-batch/v1')
    return replayPublicV41CombatFrameBatch(progress, witness)
  const inherited = replayPublicV40Witness(inheritedProgressOf(progress), witness)
  return inherited ? { ...inherited, ironHall: progress.ironHall } : null
}

const monotonic = (a: PublicV41CombatProgress, b: PublicV41CombatProgress) =>
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

function decodeHead(raw: unknown, lineage: PublicV41Lineage): PublicV41Head | null {
  try {
    if (!exactPublicV23(raw, headKeys) || raw.schemaVersion !== PUBLIC_V41_SCHEMA
      || !Number.isSafeInteger(raw.saveRevision) || (raw.saveRevision as number) < 0) return null
    const progress = decodePublicV41Progress(Object.fromEntries(
      PUBLIC_V41_PROGRESS_KEYS.map((key) => [key, raw[key]])))
    if (!progress || progress.state.seed !== lineage.seed) return null
    if (raw.saveRevision === 0) return samePublicV14Value(raw, genesisHead(lineage))
      ? structuredClone(raw) as PublicV41Head : null
    const witness = decodePublicV41Witness(raw.witness)
    if (!witness || witness.kind === 'highland-extract/v1'
      && !highlandStoneNodes(lineage.seed).some(({ id }) => id === witness.nodeId)) return null
    return { ...progress, schemaVersion: PUBLIC_V41_SCHEMA,
      saveRevision: raw.saveRevision as number, witness }
  } catch { return null }
}

export function decodePublicV41Head(raw: unknown,
  rawLineage: PublicV41Lineage): PublicV41Head | null {
  const lineage = decodePublicV41Lineage(rawLineage)
  return lineage ? decodeHead(raw, lineage) : null
}

export function decodePublicV41Root(raw: unknown): PublicV41Root | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV41Lineage(raw.lineage)
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
      replayPublicV41Witness(genesisHead(lineage), previous.witness),
      progressOf(previous))) return null
    return samePublicV14Value(replayPublicV41Witness(progressOf(previous), head.witness),
      progressOf(head)) ? { lineage, head, previous } : null
  } catch { return null }
}

export function decodePublicV41CheckedSuccessor(before: PublicV41Root,
  raw: unknown): PublicV41Root | null {
  try {
    if (exactPublicV23(raw, ['lineage', 'head', 'previous'])
      && sameStrictBoundedRaw([raw.lineage, raw.previous],
        [before.lineage, before.head], 3 << 20)) {
      const head = decodeHead(raw.head, before.lineage)
      if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
        || !publicV32Preserves(before.lineage.genesis, head, before.lineage.seed)
        || !publicV32Monotonic(before.head, head) || !monotonic(before.head, head)
        || !samePublicV14Value(replayPublicV41Witness(progressOf(before.head), head.witness),
          progressOf(head))) return null
      return { lineage: before.lineage, previous: before.head, head }
    }
    const candidate = decodePublicV41Root(raw)
    return candidate && samePublicV14Value(candidate.lineage, before.lineage)
      && samePublicV14Value(candidate.previous, before.head) ? candidate : null
  } catch { return null }
}
