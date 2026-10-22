import { highlandStoneNodes } from './highlandContent'
import { samePublicV14Value } from './publicWorldV14Validation'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { publicV32Monotonic, publicV32Preserves } from './publicWorldV32Snapshot'
import { decodePublicV42Root, decodePublicV42Witness,
  createFreshPublicV42Root, replayPublicV42Witness } from './publicWorldV42Snapshot'
import type { PublicV42Root, PublicV42Witness } from './publicWorldV42Snapshot'
import { PUBLIC_V42_PROGRESS_KEYS, previewPublicV42RewardFrameBatch }
  from './publicWorldV42RewardAction'
import type { PublicV42RewardProgress } from './publicWorldV42RewardAction'
import { confirmPublicV43FamiliarAction, createPublicV43FamiliarProgress,
  decodePublicV43FamiliarProgress, decodePublicV43FamiliarWitness,
  PUBLIC_V43_PROGRESS_KEYS } from './publicWorldV43FamiliarAction'
import type { PublicV43FamiliarProgress,
  PublicV43FamiliarWitness } from './publicWorldV43FamiliarAction'
import { advancePublicV43FamiliarFollower } from './publicWorldV43FamiliarFollower'
import { confirmPublicV43LogOrder, createPublicV43LogOrder,
  decodePublicV43LogOrderState, decodePublicV43LogOrderWitness }
  from './publicWorldV43LogOrder'
import type { PublicV43LogOrderProgress,
  PublicV43LogOrderWitness } from './publicWorldV43LogOrder'
import { confirmPublicV43BagUpgrade, createPublicV43BagUpgrade,
  decodePublicV43BagUpgradeState, decodePublicV43BagUpgradeWitness }
  from './publicWorldV43BagUpgrade'
import type { PublicV43BagUpgradeProgress,
  PublicV43BagUpgradeWitness } from './publicWorldV43BagUpgrade'
import { confirmPublicV43MountTraining, createPublicV43MountTraining,
  decodePublicV43MountTrainingProgress,
  decodePublicV43MountTrainingWitness } from './publicWorldV43MountTraining'
import type { PublicV43MountTraining,
  PublicV43MountTrainingProgress,
  PublicV43MountTrainingWitness } from './publicWorldV43MountTraining'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

export const PUBLIC_V43_SCHEMA = 'wizard-world/v43' as const
export const PUBLIC_V43_DATABASE_NAME = 'wizard-realms:world:v43'
const FRESH_SEED = 'wizard-realms'

function parentOf(raw: PublicV43FamiliarProgress): PublicV42RewardProgress {
  return Object.fromEntries(PUBLIC_V42_PROGRESS_KEYS.map((key) => [key, raw[key]])) as
    PublicV42RewardProgress
}
function parentV43Of(raw: PublicV43Progress): PublicV43FamiliarProgress {
  return Object.fromEntries(PUBLIC_V43_PROGRESS_KEYS.map((key) =>
    [key, raw[key]])) as PublicV43FamiliarProgress
}
function progressOf(raw: PublicV43Progress): PublicV43Progress {
  const familiar = parentV43Of(raw)
  return { ...familiar,
    ...(Object.hasOwn(raw, 'mountTraining') && { mountTraining: raw.mountTraining }),
    ...(Object.hasOwn(raw, 'greenwayOrder') && { greenwayOrder: raw.greenwayOrder }),
    ...(Object.hasOwn(raw, 'greenwayBagUpgrade')
      && { greenwayBagUpgrade: raw.greenwayBagUpgrade }) }
}
function decodeProgress(raw: unknown): PublicV43Progress | null {
  try {
    if (raw === null || typeof raw !== 'object') return null
    const mount = Object.hasOwn(raw, 'mountTraining')
    const order = Object.hasOwn(raw, 'greenwayOrder')
    const bag = Object.hasOwn(raw, 'greenwayBagUpgrade')
    if (!exactPublicV23(raw, [...PUBLIC_V43_PROGRESS_KEYS,
      ...(mount ? ['mountTraining'] : []), ...(order ? ['greenwayOrder'] : []),
      ...(bag ? ['greenwayBagUpgrade'] : [])])) return null
    const source = raw as PublicV43Progress
    const familiar = decodePublicV43FamiliarProgress(parentV43Of(source))
    const checkedMount = familiar && mount && decodePublicV43MountTrainingProgress({
      ...familiar, mountTraining: source.mountTraining })
    const checkedOrder = familiar && order && decodePublicV43LogOrderState(
      source.greenwayOrder, familiar.state.eventSequence)
    const checkedBag = familiar && bag && decodePublicV43BagUpgradeState(
      source.greenwayBagUpgrade, familiar.state.eventSequence,
      familiar.state.player.backpackCapacity)
    if (!familiar || mount && !checkedMount || order && !checkedOrder
      || bag && !checkedBag) return null
    return { ...familiar,
      ...(checkedMount && { mountTraining: checkedMount.mountTraining }),
      ...(checkedOrder && { greenwayOrder: checkedOrder }),
      ...(checkedBag && { greenwayBagUpgrade: checkedBag }) }
  } catch { return null }
}
export { decodeProgress as decodePublicV43Progress }
function preserveOverlays(before: PublicV43Progress,
  after: PublicV43FamiliarProgress | null): PublicV43Progress | null {
  if (!after) return null
  return decodeProgress({ ...after,
    ...(Object.hasOwn(before, 'mountTraining')
      && { mountTraining: before.mountTraining }),
    ...(Object.hasOwn(before, 'greenwayOrder')
      && { greenwayOrder: before.greenwayOrder }),
    ...(Object.hasOwn(before, 'greenwayBagUpgrade')
      && { greenwayBagUpgrade: before.greenwayBagUpgrade }) })
}
const canonicalFreshGenesis = createPublicV43FamiliarProgress(
  createFreshPublicV42Root(FRESH_SEED).head)
if (!canonicalFreshGenesis) throw new Error('Missing canonical V43 familiar site')

export type PublicV43Witness = PublicV42Witness | PublicV43FamiliarWitness
  | PublicV43MountTrainingWitness | PublicV43LogOrderWitness
  | PublicV43BagUpgradeWitness
export type PublicV43Progress = PublicV43FamiliarProgress & Readonly<{
  mountTraining?: PublicV43MountTraining
  greenwayOrder?: PublicV43LogOrderProgress['greenwayOrder']
  greenwayBagUpgrade?: PublicV43BagUpgradeProgress['greenwayBagUpgrade']
}>
export type PublicV43Lineage = Readonly<{ rulesProfile: 'sedgehorn-familiar/v1';
  seed: string; genesis: PublicV43FamiliarProgress }> & (
    Readonly<{ origin: 'v42-migration'; sourceRevision: number }>
    | Readonly<{ origin: 'fresh'; sourceRevision: null }>)
export type PublicV43Head = PublicV43Progress & Readonly<{
  schemaVersion: typeof PUBLIC_V43_SCHEMA; saveRevision: number;
  witness: PublicV43Witness | null }>
export type PublicV43Root = Readonly<{ lineage: PublicV43Lineage;
  head: PublicV43Head; previous: PublicV43Head | null }>

const headKeys = ['schemaVersion', 'saveRevision', ...PUBLIC_V43_PROGRESS_KEYS,
  'witness'] as const
const mountHeadKeys = [...headKeys, 'mountTraining'] as const
const orderHeadKeys = [...headKeys, 'greenwayOrder'] as const
const mountOrderHeadKeys = [...headKeys, 'mountTraining', 'greenwayOrder'] as const
const bagHeadKeys = [...headKeys, 'greenwayBagUpgrade'] as const
const mountBagHeadKeys = [...headKeys, 'mountTraining', 'greenwayBagUpgrade'] as const
const orderBagHeadKeys = [...headKeys, 'greenwayOrder', 'greenwayBagUpgrade'] as const
const mountOrderBagHeadKeys = [...headKeys, 'mountTraining', 'greenwayOrder',
  'greenwayBagUpgrade'] as const
const genesisHead = (lineage: PublicV43Lineage): PublicV43Head => ({
  ...structuredClone(lineage.genesis), schemaVersion: PUBLIC_V43_SCHEMA,
  saveRevision: 0, witness: null })

/** Check and copy a V42 source. No source field or record is mutated. */
export function createPublicV43Root(source: PublicV42Root): PublicV43Root {
  const checked = decodePublicV42Root(source)
  if (!checked) throw new RangeError('Invalid checked V42 source root')
  const genesis = createPublicV43FamiliarProgress(checked.head)
  if (!genesis) throw new RangeError('Unsupported familiar site')
  const lineage: PublicV43Lineage = { origin: 'v42-migration',
    rulesProfile: 'sedgehorn-familiar/v1', seed: genesis.state.seed,
    sourceRevision: checked.head.saveRevision, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function createFreshPublicV43Root(seed: string): PublicV43Root {
  if (seed !== FRESH_SEED) throw new RangeError('Invalid fresh seed')
  const genesis = structuredClone(canonicalFreshGenesis!)
  const lineage: PublicV43Lineage = { origin: 'fresh',
    rulesProfile: 'sedgehorn-familiar/v1', seed,
    sourceRevision: null, genesis }
  return { lineage, head: genesisHead(lineage), previous: null }
}

export function decodePublicV43Lineage(raw: unknown): PublicV43Lineage | null {
  try {
    if (!exactPublicV23(raw, ['origin', 'rulesProfile', 'seed',
      'sourceRevision', 'genesis']) || raw.rulesProfile !== 'sedgehorn-familiar/v1'
      || typeof raw.seed !== 'string' || !raw.seed || raw.seed.length > 128
      || !(raw.origin === 'fresh' && raw.sourceRevision === null
        || raw.origin === 'v42-migration'
          && Number.isSafeInteger(raw.sourceRevision)
          && (raw.sourceRevision as number) >= 0)) return null
    const genesis = decodePublicV43FamiliarProgress(raw.genesis)
    const initial = genesis && createPublicV43FamiliarProgress(parentOf(genesis))
    if (!genesis || !initial || genesis.state.seed !== raw.seed
      || !samePublicV14Value(genesis.familiar, initial.familiar)) return null
    if (raw.origin === 'fresh') return raw.seed === FRESH_SEED
      && samePublicV14Value(genesis, canonicalFreshGenesis)
      ? { origin: 'fresh', rulesProfile: 'sedgehorn-familiar/v1',
        seed: raw.seed, sourceRevision: null, genesis } : null
    return { origin: 'v42-migration', rulesProfile: 'sedgehorn-familiar/v1',
      seed: raw.seed, sourceRevision: raw.sourceRevision as number, genesis }
  } catch { return null }
}

export function decodePublicV43Witness(raw: unknown): PublicV43Witness | null {
  return decodePublicV43BagUpgradeWitness(raw)
    ?? decodePublicV43MountTrainingWitness(raw)
    ?? decodePublicV43LogOrderWitness(raw)
    ?? decodePublicV43FamiliarWitness(raw) ?? decodePublicV42Witness(raw)
}

function replayFrames(before: PublicV43FamiliarProgress,
  witness: Extract<PublicV42Witness, { kind: 'frame-batch/v1' }>):
  PublicV43FamiliarProgress | null {
  // The whole V42 batch is authoritative. Prefix previews only locate accepted
  // grounded poses at which the familiar may take one bounded follower step.
  const parent = replayPublicV42Witness(parentOf(before), witness)
  if (!parent) return null
  let current = before
  if (before.familiar.phase === 'escort') {
    for (let index = 1; index <= witness.frames.length; index += 1) {
      const prefix = { kind: 'frame-batch/v1' as const,
        frames: witness.frames.slice(0, index) }
      const projected = previewPublicV42RewardFrameBatch(parentOf(before), prefix)
      if (!projected) return null
      const pose = projectPublicV31Pose(projected)
      if (!pose) return null
      if (projected.state.player.verticalVelocity !== 0
        || Math.abs(pose.effective.position.y - pose.effective.floorY) > 1e-6)
        continue
      const advanced = advancePublicV43FamiliarFollower(current, projected)
      if (!advanced) return null
      current = advanced
    }
  }
  const next = { ...parent, familiar: current.familiar }
  return decodePublicV43FamiliarProgress(next)
}

/** Intent-only replay. A care edge creates or extends the optional training overlay. */
export function replayPublicV43Witness(beforeRaw: PublicV43Progress,
  raw: unknown): PublicV43Progress | null {
  const witness = decodePublicV43Witness(raw)
  const before = decodeProgress(progressOf(beforeRaw))
  if (!witness || !before) return null
  if (witness.kind === 'sedgehorn-care/v1') {
    const training = Object.hasOwn(before, 'mountTraining')
      ? { ...parentV43Of(before), mountTraining: before.mountTraining } as
        PublicV43MountTrainingProgress
      : createPublicV43MountTraining(parentV43Of(before))
    const after = training && confirmPublicV43MountTraining(training, witness).progress
    return after ? decodeProgress({ ...after,
      ...(Object.hasOwn(before, 'greenwayOrder')
        && { greenwayOrder: before.greenwayOrder }),
      ...(Object.hasOwn(before, 'greenwayBagUpgrade')
        && { greenwayBagUpgrade: before.greenwayBagUpgrade }) }) : null
  }
  if (witness.kind === 'fulfill-greenway-logs/v1') {
    const order = Object.hasOwn(before, 'greenwayOrder')
      ? { ...parentV43Of(before), greenwayOrder: before.greenwayOrder } as
        PublicV43LogOrderProgress
      : createPublicV43LogOrder(parentV43Of(before))
    const after = order && confirmPublicV43LogOrder(order, witness).progress
    return after ? decodeProgress({ ...after,
      ...(Object.hasOwn(before, 'mountTraining')
        && { mountTraining: before.mountTraining }),
      ...(Object.hasOwn(before, 'greenwayBagUpgrade')
        && { greenwayBagUpgrade: before.greenwayBagUpgrade }) }) : null
  }
  if (witness.kind === 'buy-greenway-backpack/v1') {
    const bag = Object.hasOwn(before, 'greenwayBagUpgrade')
      ? { ...parentV43Of(before), greenwayBagUpgrade: before.greenwayBagUpgrade } as
        PublicV43BagUpgradeProgress
      : createPublicV43BagUpgrade(parentV43Of(before))
    const after = bag && confirmPublicV43BagUpgrade(bag, witness).progress
    return after ? decodeProgress({ ...after,
      ...(Object.hasOwn(before, 'mountTraining')
        && { mountTraining: before.mountTraining }),
      ...(Object.hasOwn(before, 'greenwayOrder')
        && { greenwayOrder: before.greenwayOrder }) }) : null
  }
  const familiar = decodePublicV43FamiliarProgress(parentV43Of(before))
  if (!familiar) return null
  if (decodePublicV43FamiliarWitness(witness))
    return preserveOverlays(before,
      confirmPublicV43FamiliarAction(familiar, witness).progress ?? null)
  if (witness.kind === 'frame-batch/v1')
    return preserveOverlays(before, replayFrames(familiar, witness))
  const parent = replayPublicV42Witness(parentOf(familiar), witness)
  const next = parent && { ...parent, familiar: familiar.familiar }
  return preserveOverlays(before, next ? decodePublicV43FamiliarProgress(next) : null)
}

const phaseOrder = ['search', 'tracks', 'fed', 'route-ready',
  'escort', 'returned', 'claimed'] as const
/** Keep V42's inherited history invariants when V43 decodes older heads. */
function inheritedMonotonic(a: PublicV43FamiliarProgress,
  b: PublicV43FamiliarProgress): boolean {
  return (a.ledgerSurveyBridgeId === null
      || a.ledgerSurveyBridgeId === b.ledgerSurveyBridgeId)
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
}
export function publicV43Monotonic(a: PublicV43Progress, b: PublicV43Progress): boolean {
  const before = a.familiar, after = b.familiar
  return inheritedMonotonic(a, b)
    && (!Object.hasOwn(a, 'greenwayOrder') || Object.hasOwn(b, 'greenwayOrder'))
    && (a.greenwayOrder?.claimedAtSequence === null
      || a.greenwayOrder?.claimedAtSequence === undefined
      || b.greenwayOrder?.claimedAtSequence === a.greenwayOrder.claimedAtSequence)
    && (!Object.hasOwn(a, 'greenwayBagUpgrade')
      || Object.hasOwn(b, 'greenwayBagUpgrade'))
    && (a.greenwayBagUpgrade?.claimedAtSequence === null
      || a.greenwayBagUpgrade?.claimedAtSequence === undefined
      || b.greenwayBagUpgrade?.claimedAtSequence
        === a.greenwayBagUpgrade.claimedAtSequence)
    && before.id === after.id
    && phaseOrder.indexOf(before.phase) <= phaseOrder.indexOf(after.phase)
    && before.trust <= after.trust
    && before.creatureCareXp <= after.creatureCareXp
    && (!before.calmed || after.calmed)
    && (!before.stationKnown || after.stationKnown)
    && (before.routeChoice === null || before.routeChoice === after.routeChoice)
    && (!a.ironHallReward.questClaimed || b.ironHallReward.questClaimed)
    && (!a.ironHallReward.vestOwned || b.ironHallReward.vestOwned)
    && (a.ironHallReward.crestOutcome === 'unrolled'
      || a.ironHallReward.crestOutcome === b.ironHallReward.crestOutcome)
    && a.ironHallReward.spar.strikesResolved <= b.ironHallReward.spar.strikesResolved
    && (!b.ironHallReward.questClaimed || b.state.player.xp >= a.state.player.xp
      + (a.ironHallReward.questClaimed ? 0 : 70))
    && (!b.ironHallReward.questClaimed || b.ironHall.combatXp >= a.ironHall.combatXp
      + (a.ironHallReward.questClaimed ? 0 : 70))
    && (after.phase !== 'claimed' || b.state.player.xp >= a.state.player.xp
      + (before.phase === 'claimed' ? 0 : 40))
}

function decodeHead(raw: unknown, lineage: PublicV43Lineage): PublicV43Head | null {
  try {
    if (!(exactPublicV23(raw, headKeys) || exactPublicV23(raw, mountHeadKeys)
      || exactPublicV23(raw, orderHeadKeys)
      || exactPublicV23(raw, mountOrderHeadKeys)
      || exactPublicV23(raw, bagHeadKeys)
      || exactPublicV23(raw, mountBagHeadKeys)
      || exactPublicV23(raw, orderBagHeadKeys)
      || exactPublicV23(raw, mountOrderBagHeadKeys))
      || raw.schemaVersion !== PUBLIC_V43_SCHEMA
      || !Number.isSafeInteger(raw.saveRevision) || (raw.saveRevision as number) < 0)
      return null
    const progress = decodeProgress(progressOf(raw as PublicV43Progress))
    if (!progress || progress.state.seed !== lineage.seed) return null
    if (raw.saveRevision === 0) return samePublicV14Value(raw, genesisHead(lineage))
      ? structuredClone(raw) as PublicV43Head : null
    const witness = decodePublicV43Witness(raw.witness)
    if (!witness || witness.kind === 'highland-extract/v1'
      && !highlandStoneNodes(lineage.seed).some(({ id }) => id === witness.nodeId))
      return null
    return { ...progress, schemaVersion: PUBLIC_V43_SCHEMA,
      saveRevision: raw.saveRevision as number, witness }
  } catch { return null }
}

/** Check the retained two-head replay and monotonic facts. Offline local storage
 * is not an anti-cheat boundary: a coherent rewrite of older, evicted history
 * cannot be distinguished without a trusted authority or complete history. */
export function decodePublicV43Root(raw: unknown): PublicV43Root | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV43Lineage(raw.lineage)
    const head = lineage && decodeHead(raw.head, lineage)
    const previous = lineage && raw.previous !== null
      ? decodeHead(raw.previous, lineage) : null
    if (!lineage || !head || (head.saveRevision === 0 ? raw.previous !== null
      : !previous || head.saveRevision !== previous.saveRevision + 1 || !head.witness)
      || !publicV32Preserves(lineage.genesis, head, lineage.seed)
      || !publicV43Monotonic(genesisHead(lineage), head)
      || previous && (!publicV32Preserves(lineage.genesis, previous, lineage.seed)
        || !publicV32Monotonic(previous, head)
        || !publicV43Monotonic(previous, head))) return null
    if (!previous) return { lineage, head, previous: null }
    if (previous.saveRevision === 0
      && !samePublicV14Value(previous, genesisHead(lineage))) return null
    if (previous.saveRevision === 1 && !samePublicV14Value(
      replayPublicV43Witness(genesisHead(lineage), previous.witness),
      progressOf(previous))) return null
    return samePublicV14Value(replayPublicV43Witness(progressOf(previous), head.witness),
      progressOf(head)) ? { lineage, head, previous } : null
  } catch { return null }
}

export function decodePublicV43CheckedSuccessor(before: PublicV43Root,
  raw: unknown): PublicV43Root | null {
  try {
    if (!exactPublicV23(raw, ['lineage', 'head', 'previous'])
      || !sameStrictBoundedRaw([raw.lineage, raw.previous],
        [before.lineage, before.head], 3 << 20)) return null
    const head = decodeHead(raw.head, before.lineage)
    if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
      || !publicV32Preserves(before.lineage.genesis, head, before.lineage.seed)
      || !publicV32Monotonic(before.head, head)
      || !publicV43Monotonic(before.head, head)
      || !samePublicV14Value(replayPublicV43Witness(progressOf(before.head), head.witness),
        progressOf(head))) return null
    return { lineage: before.lineage, previous: before.head, head }
  } catch { return null }
}
