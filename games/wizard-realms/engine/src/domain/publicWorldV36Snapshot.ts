import { highlandStoneNodes } from './highlandContent'
import { samePublicV14Value } from './publicWorldV14Validation'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { publicV32Monotonic, publicV32Preserves } from './publicWorldV32Snapshot'
import { decodePublicV35Root, decodePublicV35Witness,
  replayPublicV35Witness } from './publicWorldV35Snapshot'
import type { PublicV35Root, PublicV35Witness } from './publicWorldV35Snapshot'
import type { PublicV35Progress } from './publicWorldV35LedgerAction'
import freshGenesis from './publicWorldV36FreshGenesis.json'
import { confirmPublicV36MarkerAction, decodePublicV36MarkerWitness } from './publicWorldV36MarkerAction'
import type { PublicV36MarkerProgress, PublicV36MarkerWitness } from './publicWorldV36MarkerAction'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export const PUBLIC_V36_SCHEMA = 'wizard-world/v36' as const
export const PUBLIC_V36_DATABASE_NAME = 'wizard-realms:world:v36'
const FRESH_SEED = 'wizard-realms'
const canonicalFreshGenesis = { ...freshGenesis,
  state: { ...freshGenesis.state,
    discoveryMask: Uint8Array.from(freshGenesis.state.discoveryMask) } } as unknown as PublicV35Progress
export type PublicV36Witness = PublicV35Witness | PublicV36MarkerWitness
export type PublicV36Lineage = Readonly<{ rulesProfile: 'old-marker/v1';
  seed: string; genesis: PublicV35Progress }> & (
    Readonly<{ origin: 'v35-migration'; sourceRevision: number }>
    | Readonly<{ origin: 'fresh'; sourceRevision: null }>)
export type PublicV36Head = PublicV36MarkerProgress & Readonly<{
  schemaVersion: typeof PUBLIC_V36_SCHEMA; saveRevision: number;
  witness: PublicV36Witness | null }>
export type PublicV36Root = Readonly<{ lineage: PublicV36Lineage;
  head: PublicV36Head; previous: PublicV36Head | null }>

const baseKeys = ['state', 'greenwayWorks', 'regionalWorks', 'terrain',
  'nextHomeAtMs', 'riverBridgeIds', 'miningTools', 'claimedBridgeheadId',
  'raisedSoilCells'] as const
const progressKeys = [...baseKeys, 'ledgerSurveyBridgeId', 'ledgerClaimReward'] as const
const headKeys = ['schemaVersion', 'saveRevision', ...progressKeys,
  'markerClaimReward', 'witness'] as const
const progressOf = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells,
  ledgerSurveyBridgeId, ledgerClaimReward, markerClaimReward }: PublicV36MarkerProgress):
  PublicV36MarkerProgress => ({ state, greenwayWorks, regionalWorks, terrain,
    nextHomeAtMs, riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells,
    ledgerSurveyBridgeId, ledgerClaimReward, markerClaimReward })
const genesisHead = (lineage: PublicV36Lineage): PublicV36Head => ({
  ...lineage.genesis, markerClaimReward: null, schemaVersion: PUBLIC_V36_SCHEMA,
  saveRevision: 0, witness: null })

function decodeProgress(raw: unknown): PublicV36MarkerProgress | null {
  try {
    if (!exactPublicV23(raw, [...progressKeys, 'markerClaimReward'])) return null
    const old = decodePublicV31ActionProgress(Object.fromEntries(baseKeys.map((key) =>
      [key, raw[key]])) as PublicV35Progress)
    if (!old) return null
    const survey = raw.ledgerSurveyBridgeId, ledger = raw.ledgerClaimReward
    const marker = raw.markerClaimReward
    if (survey !== null && (typeof survey !== 'string'
      || !resolvePublicV28RiverBridge(old.state.seed, survey)
      || !old.riverBridgeIds.includes(survey) || old.claimedBridgeheadId === null)
      || ledger !== null && (survey === null || ledger !== 'traveler_tunic'
        && ledger !== 'coins')
      || marker !== null && (ledger === null || marker !== 'fen_waders'
        && marker !== 'coins')) return null
    return { ...old, ledgerSurveyBridgeId: survey as string | null,
      ledgerClaimReward: ledger as PublicV35Progress['ledgerClaimReward'],
      markerClaimReward: marker as PublicV36MarkerProgress['markerClaimReward'] }
  } catch { return null }
}

export function createPublicV36Root(source: PublicV35Root): PublicV36Root {
  const checked = decodePublicV35Root(source)
  if (!checked) throw new RangeError('Invalid checked V35 source root')
  const { schemaVersion: _schema, saveRevision: sourceRevision,
    witness: _witness, ...progress } = checked.head
  const genesis = structuredClone(progress)
  const lineage: PublicV36Lineage = { origin: 'v35-migration',
    rulesProfile: 'old-marker/v1', seed: genesis.state.seed, sourceRevision, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function createFreshPublicV36Root(seed: string): PublicV36Root {
  if (seed !== FRESH_SEED) throw new RangeError('Invalid fresh seed')
  const genesis = structuredClone(canonicalFreshGenesis)
  const lineage: PublicV36Lineage = { origin: 'fresh',
    rulesProfile: 'old-marker/v1', seed, sourceRevision: null, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function decodePublicV36Lineage(value: unknown): PublicV36Lineage | null {
  try {
    if (!exactPublicV23(value, ['origin', 'rulesProfile', 'seed',
      'sourceRevision', 'genesis']) || value.rulesProfile !== 'old-marker/v1'
      || typeof value.seed !== 'string'
      || !value.seed || value.seed.length > 128
      || !(value.origin === 'fresh' && value.sourceRevision === null
        || value.origin === 'v35-migration'
          && Number.isSafeInteger(value.sourceRevision)
          && (value.sourceRevision as number) >= 0)
      || !exactPublicV23(value.genesis, progressKeys)) return null
    const decoded = decodeProgress({ ...value.genesis, markerClaimReward: null })
    if (!decoded || decoded.state.seed !== value.seed) return null
    const { markerClaimReward: _marker, ...genesis } = decoded
    if (value.origin === 'fresh') return value.seed === FRESH_SEED
      && samePublicV14Value(genesis, canonicalFreshGenesis) ? { origin: 'fresh',
        rulesProfile: 'old-marker/v1', seed: value.seed, sourceRevision: null, genesis } : null
    return { origin: 'v35-migration', rulesProfile: 'old-marker/v1', seed: value.seed,
      sourceRevision: value.sourceRevision as number, genesis }
  } catch { return null }
}

export function decodePublicV36Witness(raw: unknown): PublicV36Witness | null {
  return decodePublicV36MarkerWitness(raw) ?? decodePublicV35Witness(raw)
}

export function replayPublicV36Witness(before: PublicV36MarkerProgress,
  raw: unknown): PublicV36MarkerProgress | null {
  const witness = decodePublicV36Witness(raw)
  if (!witness) return null
  if (witness.kind === 'marker-claim/v1')
    return confirmPublicV36MarkerAction(before, witness).progress ?? null
  const next = replayPublicV35Witness(before, witness)
  return next ? { ...next, markerClaimReward: before.markerClaimReward } : null
}

const monotonic = (a: PublicV36MarkerProgress, b: PublicV36MarkerProgress) =>
  (a.ledgerSurveyBridgeId === null || a.ledgerSurveyBridgeId === b.ledgerSurveyBridgeId)
  && (a.ledgerClaimReward === null || a.ledgerClaimReward === b.ledgerClaimReward)
  && (a.markerClaimReward === null || a.markerClaimReward === b.markerClaimReward)

function decodeHead(raw: unknown, lineage: PublicV36Lineage): PublicV36Head | null {
  try {
    if (!exactPublicV23(raw, headKeys) || raw.schemaVersion !== PUBLIC_V36_SCHEMA
      || !Number.isSafeInteger(raw.saveRevision) || (raw.saveRevision as number) < 0) return null
    const progress = decodeProgress(Object.fromEntries([...progressKeys,
      'markerClaimReward'].map((key) => [key, raw[key]])))
    if (!progress || progress.state.seed !== lineage.seed) return null
    if (raw.saveRevision === 0) return samePublicV14Value(raw, genesisHead(lineage))
      ? structuredClone(raw) as PublicV36Head : null
    const witness = decodePublicV36Witness(raw.witness)
    if (!witness || witness.kind === 'highland-extract/v1'
      && !highlandStoneNodes(lineage.seed).some(({ id }) => id === witness.nodeId)) return null
    return { ...progress, schemaVersion: PUBLIC_V36_SCHEMA,
      saveRevision: raw.saveRevision as number, witness }
  } catch { return null }
}

export function decodePublicV36Head(raw: unknown,
  rawLineage: PublicV36Lineage): PublicV36Head | null {
  const lineage = decodePublicV36Lineage(rawLineage)
  return lineage ? decodeHead(raw, lineage) : null
}

export function decodePublicV36Root(raw: unknown): PublicV36Root | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV36Lineage(raw.lineage)
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
      replayPublicV36Witness(genesisHead(lineage), previous.witness),
      progressOf(previous))) return null
    return samePublicV14Value(replayPublicV36Witness(progressOf(previous), head.witness),
      progressOf(head)) ? { lineage, head, previous } : null
  } catch { return null }
}

export function decodePublicV36CheckedSuccessor(before: PublicV36Root,
  raw: unknown): PublicV36Root | null {
  try {
    if (exactPublicV23(raw, ['lineage', 'head', 'previous'])
      && sameStrictBoundedRaw([raw.lineage, raw.previous],
        [before.lineage, before.head], 3 << 20)) {
      const head = decodeHead(raw.head, before.lineage)
      if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
        || !publicV32Preserves(before.lineage.genesis, head, before.lineage.seed)
        || !publicV32Monotonic(before.head, head) || !monotonic(before.head, head)
        || !samePublicV14Value(replayPublicV36Witness(progressOf(before.head), head.witness),
          progressOf(head))) return null
      return { lineage: before.lineage, previous: before.head, head }
    }
    const candidate = decodePublicV36Root(raw)
    return candidate && samePublicV14Value(candidate.lineage, before.lineage)
      && samePublicV14Value(candidate.previous, before.head) ? candidate : null
  } catch { return null }
}
