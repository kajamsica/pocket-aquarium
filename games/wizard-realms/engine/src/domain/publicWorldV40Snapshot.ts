import { highlandStoneNodes } from './highlandContent'
import { waystationRiverSite } from './waystationRiverContent'
import { samePublicV14Value } from './publicWorldV14Validation'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV32Monotonic, publicV32Preserves } from './publicWorldV32Snapshot'
import { createFreshPublicV39Root, decodePublicV39Root,
  decodePublicV39Witness, replayPublicV39Witness } from './publicWorldV39Snapshot'
import type { PublicV39Root, PublicV39Witness } from './publicWorldV39Snapshot'
import { PUBLIC_V39_PROGRESS_KEYS } from './publicWorldV39RingAction'
import type { PublicV39RingProgress } from './publicWorldV39RingAction'
import { confirmPublicV40WaystationAction, decodePublicV40WaystationProgress,
  decodePublicV40WaystationWitness, PUBLIC_V40_PROGRESS_KEYS } from './publicWorldV40WaystationAction'
import type { PublicV40WaystationProgress, PublicV40WaystationWitness } from './publicWorldV40WaystationAction'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export const PUBLIC_V40_SCHEMA = 'wizard-world/v40' as const
export const PUBLIC_V40_DATABASE_NAME = 'wizard-realms:world:v40'
const FRESH_SEED = 'wizard-realms'
const freshV39Head = createFreshPublicV39Root(FRESH_SEED).head

function inheritedProgressOf(raw: PublicV39RingProgress): PublicV39RingProgress {
  return Object.fromEntries(PUBLIC_V39_PROGRESS_KEYS.map((key) => [key, raw[key]])) as
    unknown as PublicV39RingProgress
}
function progressOf(raw: PublicV40WaystationProgress): PublicV40WaystationProgress {
  return Object.fromEntries(PUBLIC_V40_PROGRESS_KEYS.map((key) => [key, raw[key]])) as
    unknown as PublicV40WaystationProgress
}
const canonicalFreshGenesis: PublicV40WaystationProgress = {
  ...inheritedProgressOf(freshV39Head), timberBartered: false,
  southbankReached: false, waystationClaimed: false }

export type PublicV40Witness = PublicV39Witness | PublicV40WaystationWitness
export type PublicV40Lineage = Readonly<{ rulesProfile: 'waystation-repair/v1';
  seed: string; genesis: PublicV40WaystationProgress }> & (
    Readonly<{ origin: 'v39-migration'; sourceRevision: number }>
    | Readonly<{ origin: 'fresh'; sourceRevision: null }>)
export type PublicV40Head = PublicV40WaystationProgress & Readonly<{
  schemaVersion: typeof PUBLIC_V40_SCHEMA; saveRevision: number;
  witness: PublicV40Witness | null }>
export type PublicV40Root = Readonly<{ lineage: PublicV40Lineage;
  head: PublicV40Head; previous: PublicV40Head | null }>

const headKeys = ['schemaVersion', 'saveRevision', ...PUBLIC_V40_PROGRESS_KEYS, 'witness'] as const
const genesisHead = (lineage: PublicV40Lineage): PublicV40Head => ({
  ...lineage.genesis, schemaVersion: PUBLIC_V40_SCHEMA,
  saveRevision: 0, witness: null })

export const decodePublicV40Progress = decodePublicV40WaystationProgress

/** Copy a checked V39 head into a separate V40 lineage without touching its source. */
export function createPublicV40Root(source: PublicV39Root): PublicV40Root {
  const checked = decodePublicV39Root(source)
  if (!checked) throw new RangeError('Invalid checked V39 source root')
  if (!waystationRiverSite(checked.head.state.seed))
    throw new RangeError('Unsupported Waystation river site')
  const genesis: PublicV40WaystationProgress = {
    ...structuredClone(inheritedProgressOf(checked.head)), timberBartered: false,
    southbankReached: false, waystationClaimed: false }
  const lineage: PublicV40Lineage = { origin: 'v39-migration',
    rulesProfile: 'waystation-repair/v1', seed: genesis.state.seed,
    sourceRevision: checked.head.saveRevision, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function createFreshPublicV40Root(seed: string): PublicV40Root {
  if (seed !== FRESH_SEED) throw new RangeError('Invalid fresh seed')
  if (!waystationRiverSite(seed)) throw new RangeError('Unsupported Waystation river site')
  const genesis = structuredClone(canonicalFreshGenesis)
  const lineage: PublicV40Lineage = { origin: 'fresh',
    rulesProfile: 'waystation-repair/v1', seed, sourceRevision: null, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function decodePublicV40Lineage(value: unknown): PublicV40Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'rulesProfile', 'seed',
      'sourceRevision', 'genesis']) || value.rulesProfile !== 'waystation-repair/v1'
      || typeof value.seed !== 'string' || !value.seed || value.seed.length > 128
      || !waystationRiverSite(value.seed)
      || !(value.origin === 'fresh' && value.sourceRevision === null
        || value.origin === 'v39-migration'
          && Number.isSafeInteger(value.sourceRevision)
          && (value.sourceRevision as number) >= 0)) return null
    const genesis = decodePublicV40Progress(value.genesis)
    if (!genesis || genesis.state.seed !== value.seed
      || genesis.timberBartered || genesis.southbankReached
      || genesis.waystationClaimed) return null
    if (value.origin === 'fresh') return value.seed === FRESH_SEED
      && samePublicV14Value(genesis, canonicalFreshGenesis) ? { origin: 'fresh',
        rulesProfile: 'waystation-repair/v1', seed: value.seed,
        sourceRevision: null, genesis } : null
    return { origin: 'v39-migration', rulesProfile: 'waystation-repair/v1',
      seed: value.seed, sourceRevision: value.sourceRevision as number, genesis }
  } catch { return null }
}

export function decodePublicV40Witness(raw: unknown): PublicV40Witness | null {
  return decodePublicV40WaystationWitness(raw) ?? decodePublicV39Witness(raw)
}

/** An inherited V39 action may not change any V40-only progress flag. */
export function replayPublicV40Witness(before: PublicV40WaystationProgress,
  raw: unknown): PublicV40WaystationProgress | null {
  const witness = decodePublicV40Witness(raw)
  if (!witness) return null
  const progress = progressOf(before)
  if (witness.kind === 'waystation-barter/v1' || witness.kind === 'waystation-cross/v1'
    || witness.kind === 'waystation-claim/v1')
    return confirmPublicV40WaystationAction(progress, witness).progress ?? null
  const inherited = replayPublicV39Witness(inheritedProgressOf(progress), witness)
  return inherited ? { ...inherited, timberBartered: progress.timberBartered,
    southbankReached: progress.southbankReached,
    waystationClaimed: progress.waystationClaimed } : null
}

const monotonic = (a: PublicV40WaystationProgress, b: PublicV40WaystationProgress) =>
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

function decodeHead(raw: unknown, lineage: PublicV40Lineage): PublicV40Head | null {
  try {
    if (!exactPublicV23(raw, headKeys) || raw.schemaVersion !== PUBLIC_V40_SCHEMA
      || !Number.isSafeInteger(raw.saveRevision) || (raw.saveRevision as number) < 0) return null
    const progress = decodePublicV40Progress(Object.fromEntries(
      PUBLIC_V40_PROGRESS_KEYS.map((key) => [key, raw[key]])))
    if (!progress || progress.state.seed !== lineage.seed) return null
    if (raw.saveRevision === 0) return samePublicV14Value(raw, genesisHead(lineage))
      ? structuredClone(raw) as PublicV40Head : null
    const witness = decodePublicV40Witness(raw.witness)
    if (!witness || witness.kind === 'highland-extract/v1'
      && !highlandStoneNodes(lineage.seed).some(({ id }) => id === witness.nodeId)) return null
    return { ...progress, schemaVersion: PUBLIC_V40_SCHEMA,
      saveRevision: raw.saveRevision as number, witness }
  } catch { return null }
}

export function decodePublicV40Head(raw: unknown,
  rawLineage: PublicV40Lineage): PublicV40Head | null {
  const lineage = decodePublicV40Lineage(rawLineage)
  return lineage ? decodeHead(raw, lineage) : null
}

export function decodePublicV40Root(raw: unknown): PublicV40Root | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV40Lineage(raw.lineage)
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
      replayPublicV40Witness(genesisHead(lineage), previous.witness),
      progressOf(previous))) return null
    return samePublicV14Value(replayPublicV40Witness(progressOf(previous), head.witness),
      progressOf(head)) ? { lineage, head, previous } : null
  } catch { return null }
}

export function decodePublicV40CheckedSuccessor(before: PublicV40Root,
  raw: unknown): PublicV40Root | null {
  try {
    if (exactPublicV23(raw, ['lineage', 'head', 'previous'])
      && sameStrictBoundedRaw([raw.lineage, raw.previous],
        [before.lineage, before.head], 3 << 20)) {
      const head = decodeHead(raw.head, before.lineage)
      if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
        || !publicV32Preserves(before.lineage.genesis, head, before.lineage.seed)
        || !publicV32Monotonic(before.head, head) || !monotonic(before.head, head)
        || !samePublicV14Value(replayPublicV40Witness(progressOf(before.head), head.witness),
          progressOf(head))) return null
      return { lineage: before.lineage, previous: before.head, head }
    }
    const candidate = decodePublicV40Root(raw)
    return candidate && samePublicV14Value(candidate.lineage, before.lineage)
      && samePublicV14Value(candidate.previous, before.head) ? candidate : null
  } catch { return null }
}
