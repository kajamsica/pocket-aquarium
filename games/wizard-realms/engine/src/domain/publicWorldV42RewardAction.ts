import { discoveryMaskHasTileId } from './discoveryMask'
import { hashSeed } from './generation'
import { HIGHLAND_WINDWARD_STEP } from './highlandWindContent'
import { ironHallQuartermasterSite } from './ironHallQuartermasterSite'
import { ironHallSite } from './ironHallSite'
import { decodePublicV14FrameWitness } from './publicWorldV14Snapshot'
import type { PublicV14Frame } from './publicWorldV14Snapshot'
import { samePublicV14Value } from './publicWorldV14Validation'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV31HasRaisedSoilCell } from './publicWorldV31Soil'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { previewPublicV37FrameBatch } from './publicWorldV37Movement'
import { replayPublicV40Witness } from './publicWorldV40Snapshot'
import { decodePublicV41CombatProgress, PUBLIC_V41_PROGRESS_KEYS,
  previewPublicV41CombatActions, previewValidatedPublicV41CombatActions,
  replayPublicV41CombatFrameBatch } from './publicWorldV41CombatAction'
import type { PublicV41CombatProgress } from './publicWorldV41CombatAction'
import { waystationRiverSite } from './waystationRiverContent'
import type { Vec3 } from './types'

export type IronHallRewardState = Readonly<{
  crestOutcome: 'unrolled' | 'won' | 'missed'
  questClaimed: boolean
  vestOwned: boolean
  vestEquipped: boolean
  vestDurability: number
  spar: Readonly<{ active: boolean; strikeAtTick: number;
    nextReadyTick: number; strikesResolved: number }>
}>
export type PublicV42RewardProgress = PublicV41CombatProgress & Readonly<{
  ironHallReward: IronHallRewardState
}>
export type PublicV42RewardWitness = Readonly<{ kind: 'ironhall-claim/v1'
  | 'ironhall-vest-equip/v1' | 'ironhall-vest-unequip/v1'
  | 'ironhall-vest-repair/v1' | 'ironhall-spar/v1' }>
export type PublicV42RewardRejection = 'invalid_value' | 'invalid_progress'
  | 'requires_crossing' | 'wrong_region' | 'not_grounded' | 'unsafe_source'
  | 'unrevealed' | 'too_far' | 'ward_not_defeated' | 'crest_unresolved'
  | 'already_claimed' | 'not_claimed' | 'not_owned' | 'already_equipped'
  | 'not_equipped' | 'depleted' | 'already_full' | 'insufficient_coins'
  | 'cannot_change_gear' | 'spar_active' | 'cooldown'
export type PublicV42RewardResult = Readonly<{ progress: PublicV42RewardProgress;
  rejection?: never }> | Readonly<{ progress?: never;
    rejection: PublicV42RewardRejection }>

export const INITIAL_IRON_HALL_REWARD: IronHallRewardState = Object.freeze({
  crestOutcome: 'unrolled', questClaimed: false, vestOwned: false,
  vestEquipped: false, vestDurability: 0,
  spar: Object.freeze({ active: false, strikeAtTick: 0,
    nextReadyTick: 0, strikesResolved: 0 }),
})
export const PUBLIC_V42_PROGRESS_KEYS = [...PUBLIC_V41_PROGRESS_KEYS, 'ironHallReward'] as const
const rewardKeys = Object.keys(INITIAL_IRON_HALL_REWARD)
const sparKeys = Object.keys(INITIAL_IRON_HALL_REWARD.spar)
const safeCounter = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const horizontal = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z)

/** Exact V42 overlay. The legacy item and skill decoders remain untouched. */
export function decodePublicV42RewardProgress(raw: unknown): PublicV42RewardProgress | null {
  try {
    if (!exactPublicV23(raw, PUBLIC_V42_PROGRESS_KEYS)
      || !exactPublicV23(raw.ironHallReward, rewardKeys)) return null
    const reward = raw.ironHallReward
    if (!exactPublicV23(reward.spar, sparKeys)
      || !['unrolled', 'won', 'missed'].includes(reward.crestOutcome as string)
      || typeof reward.questClaimed !== 'boolean'
      || typeof reward.vestOwned !== 'boolean'
      || typeof reward.vestEquipped !== 'boolean'
      || !safeCounter(reward.vestDurability) || reward.vestDurability > 12
      || typeof reward.spar.active !== 'boolean'
      || ![reward.spar.strikeAtTick, reward.spar.nextReadyTick,
        reward.spar.strikesResolved].every(safeCounter)) return null
    const inherited = decodePublicV41CombatProgress(Object.fromEntries(
      PUBLIC_V41_PROGRESS_KEYS.map((key) => [key, raw[key]])))
    if (!inherited
      || inherited.ironHall.wardDefeated !== (reward.crestOutcome !== 'unrolled')
      || reward.crestOutcome !== 'unrolled'
        && reward.crestOutcome !== resolveIronHallCrestOutcome(inherited.state.seed)
      || reward.questClaimed && (!inherited.ironHall.wardDefeated
        || !reward.vestOwned)
      || reward.vestOwned !== reward.questClaimed
      || !reward.vestOwned && (reward.vestEquipped || reward.vestDurability !== 0)
      || reward.vestEquipped && reward.vestDurability === 0
      || reward.spar.active && (!reward.questClaimed
        || inherited.ironHall.engaged
        || (reward.spar.strikeAtTick as number) <= inherited.state.tick
        || (reward.spar.strikeAtTick as number) - inherited.state.tick > 20
        || (reward.spar.nextReadyTick as number) > inherited.state.tick)
      || !reward.spar.active && reward.spar.strikeAtTick !== 0
      || ((reward.spar.strikesResolved as number) === 0)
        !== (reward.spar.nextReadyTick === 0)
      || (reward.spar.strikesResolved as number) > 0 && !reward.questClaimed) return null
    return { ...inherited, ironHallReward: structuredClone(reward) as IronHallRewardState }
  } catch { return null }
}

/** Strict payload-free intent, with no client-selected reward, target or damage. */
export function decodePublicV42RewardWitness(raw: unknown): PublicV42RewardWitness | null {
  try {
    if (!exactPublicV23(raw, ['kind']) || ![
      'ironhall-claim/v1', 'ironhall-vest-equip/v1',
      'ironhall-vest-unequip/v1', 'ironhall-vest-repair/v1',
      'ironhall-spar/v1',
    ].includes(raw.kind as string)) return null
    structuredClone(raw)
    return { kind: raw.kind as PublicV42RewardWitness['kind'] }
  } catch { return null }
}

/** One seed and one encounter ID decide a permanent cosmetic entitlement. */
export function resolveIronHallCrestOutcome(seed: string): 'won' | 'missed' {
  return hashSeed(`${seed}:iron-hall-clockwork-ward/v1`) % 10 === 0
    ? 'won' : 'missed'
}

/** Called at the checked first defeat, or while constructing a checked V41 copy. */
export function resolvePublicV42CrestAfterDefeat(
  progress: PublicV42RewardProgress): PublicV42RewardProgress {
  if (!progress.ironHall.wardDefeated
    || progress.ironHallReward.crestOutcome !== 'unrolled') return progress
  return { ...progress, ironHallReward: { ...progress.ironHallReward,
    crestOutcome: resolveIronHallCrestOutcome(progress.state.seed) } }
}

function progressOf(raw: PublicV42RewardProgress): PublicV42RewardProgress | null {
  return decodePublicV42RewardProgress(Object.fromEntries(
    PUBLIC_V42_PROGRESS_KEYS.map((key) => [key, raw[key]])))
}

type RewardPreflight = Readonly<{ rejection: PublicV42RewardRejection }>
  | Readonly<{ quartermaster: NonNullable<ReturnType<typeof ironHallQuartermasterSite>>;
    site: NonNullable<ReturnType<typeof ironHallSite>>;
    pose: NonNullable<ReturnType<typeof projectPublicV31Pose>> }>

function rewardPreflight(progress: PublicV42RewardProgress): RewardPreflight {
  try {
    const { state } = progress, { player } = state
    const quartermaster = ironHallQuartermasterSite(progress)
    const site = ironHallSite(progress)
    const bridge = waystationRiverSite(state.seed)
    if (!quartermaster || !site || !bridge) return { rejection: 'invalid_progress' }
    if (!progress.southbankReached || !progress.riverBridgeIds.includes(bridge.id))
      return { rejection: 'requires_crossing' }
    if (state.movementOwner !== 'streamed') return { rejection: 'wrong_region' }
    const pose = projectPublicV31Pose(progress)
    if (!pose || player.verticalVelocity !== 0 || pose.support !== 'terrain'
      || Math.abs(pose.effective.position.y - pose.effective.floorY) > 1e-6)
      return { rejection: 'not_grounded' }
    if (publicV25RiverCellAtGrid(state.seed, pose.cell.gx, pose.cell.gz)
      || publicV26TerrainCellIsWet(state.seed, pose.cell.gx, pose.cell.gz, 'streamed')
      || progress.terrain.columns.some(({ gx, gz, openDepth }) =>
        gx === pose.cell.gx && gz === pose.cell.gz && openDepth > 0)
      || publicV31HasRaisedSoilCell(progress.raisedSoilCells, pose.cell.gx, pose.cell.gz))
      return { rejection: 'unsafe_source' }
    return { quartermaster, site, pose }
  } catch { return { rejection: 'invalid_progress' } }
}

function confirmDecodedRewardAction(progress: PublicV42RewardProgress,
  witness: PublicV42RewardWitness, preflight?: RewardPreflight): PublicV42RewardResult {
  const reject = (rejection: PublicV42RewardRejection): PublicV42RewardResult => ({ rejection })
  try {
    const { state, ironHall: hall, ironHallReward: reward } = progress
    const { player } = state, kind = witness.kind
    if (!safeCounter(state.eventSequence + 1)) return reject('invalid_value')
    let nextReward: IronHallRewardState = reward
    let nextHall = hall, nextPlayer = player
    if (kind === 'ironhall-vest-equip/v1' || kind === 'ironhall-vest-unequip/v1') {
      if (!reward.vestOwned) return reject('not_owned')
      if (hall.engaged || reward.spar.active) return reject('cannot_change_gear')
      if (kind === 'ironhall-vest-equip/v1') {
        if (reward.vestEquipped) return reject('already_equipped')
        if (reward.vestDurability === 0) return reject('depleted')
        nextReward = { ...reward, vestEquipped: true }
      } else {
        if (!reward.vestEquipped) return reject('not_equipped')
        nextReward = { ...reward, vestEquipped: false }
      }
    } else {
      const checked = preflight ?? rewardPreflight(progress)
      if ('rejection' in checked) return reject(checked.rejection)
      const { quartermaster, site, pose } = checked
      const destination = kind === 'ironhall-spar/v1' ? site.ward : quartermaster
      if (!discoveryMaskHasTileId(state.discoveryMask, destination.id)) return reject('unrevealed')
      if (distance(pose.effective.position, destination.center) > 3) return reject('too_far')
      if (hall.engaged || reward.spar.active) return reject('spar_active')
      if (kind === 'ironhall-claim/v1') {
        if (reward.questClaimed) return reject('already_claimed')
        if (!hall.wardDefeated) return reject('ward_not_defeated')
        if (reward.crestOutcome === 'unrolled') return reject('crest_unresolved')
        const coins = player.coins + 60, xp = player.xp + 70
        const combatXp = hall.combatXp + 70
        if (![coins, xp, combatXp].every(safeCounter)) return reject('invalid_value')
        nextReward = { ...reward, questClaimed: true, vestOwned: true,
          vestEquipped: true, vestDurability: 12 }
        nextHall = { ...hall, combatXp }
        nextPlayer = { ...player, coins, xp, level: 1 + Math.floor(xp / 100) }
      } else if (kind === 'ironhall-vest-repair/v1') {
        if (!reward.vestOwned) return reject('not_owned')
        if (reward.vestDurability === 12) return reject('already_full')
        if (player.coins < 18) return reject('insufficient_coins')
        nextReward = { ...reward, vestDurability: 12 }
        nextPlayer = { ...player, coins: player.coins - 18 }
      } else {
        if (!reward.questClaimed) return reject('not_claimed')
        if (!hall.wardDefeated) return reject('ward_not_defeated')
        if (state.tick < reward.spar.nextReadyTick) return reject('cooldown')
        if (!safeCounter(state.tick + 20)) return reject('invalid_value')
        nextReward = { ...reward, spar: { ...reward.spar,
          active: true, strikeAtTick: state.tick + 20 } }
      }
    }
    const next: PublicV42RewardProgress = { ...progress, ironHall: nextHall,
      ironHallReward: nextReward,
      state: { ...state, eventSequence: state.eventSequence + 1, player: nextPlayer } }
    return decodePublicV42RewardProgress(next) ? { progress: next } : reject('invalid_value')
  } catch { return reject('invalid_progress') }
}

/** Pure action for the V42 checked writer to replay against its locked head. */
export function confirmPublicV42RewardAction(raw: PublicV42RewardProgress,
  rawWitness: unknown): PublicV42RewardResult {
  const witness = decodePublicV42RewardWitness(rawWitness)
  if (!witness) return { rejection: 'invalid_value' }
  const progress = progressOf(raw)
  return progress ? confirmDecodedRewardAction(progress, witness)
    : { rejection: 'invalid_progress' }
}

export function previewPublicV42RewardAction(progress: PublicV42RewardProgress,
  witness: unknown): Readonly<{ rejection: PublicV42RewardRejection | null }> {
  return { rejection: confirmPublicV42RewardAction(progress, witness).rejection ?? null }
}

/** Read-only view batch: validate once, then preserve every checked action's rejection. */
export function previewPublicV42RewardActions(progress: PublicV42RewardProgress,
  kinds: readonly PublicV42RewardWitness['kind'][]): readonly Readonly<{
    rejection: PublicV42RewardRejection | null }>[] {
  const decoded = progressOf(progress)
  return decoded ? previewValidatedPublicV42RewardActions(decoded, kinds)
    : kinds.map((kind) => ({ rejection: decodePublicV42RewardWitness({ kind })
      ? 'invalid_progress' : 'invalid_value' }))
}

function previewValidatedPublicV42RewardActions(progress: PublicV42RewardProgress,
  kinds: readonly PublicV42RewardWitness['kind'][]): readonly Readonly<{
    rejection: PublicV42RewardRejection | null }>[] {
  const witnesses = kinds.map((kind) => decodePublicV42RewardWitness({ kind }))
  const preflight = witnesses.some((witness) => witness
    && witness.kind !== 'ironhall-vest-equip/v1'
    && witness.kind !== 'ironhall-vest-unequip/v1') ? rewardPreflight(progress) : undefined
  return witnesses.map((witness) => ({ rejection: !witness ? 'invalid_value'
    : confirmDecodedRewardAction(progress, witness, preflight).rejection ?? null }))
}

/** One strict read decode for both Iron Hall action trays; writer paths stay separate. */
export function previewPublicV42IronHallActions(progress: PublicV42RewardProgress) {
  const combatKinds = ['ironhall-study/v1', 'ironhall-engage/v1', 'ironhall-bolt/v1',
    'ironhall-guard/v1', 'ironhall-rest/v1'] as const
  const rewardKinds = ['ironhall-claim/v1', 'ironhall-vest-equip/v1',
    'ironhall-vest-unequip/v1', 'ironhall-vest-repair/v1', 'ironhall-spar/v1'] as const
  const decoded = progressOf(progress)
  if (decoded) {
    const { ironHallReward: _reward, ...combatProgress } = decoded
    return {
      combat: previewValidatedPublicV41CombatActions(combatProgress, combatKinds),
      reward: previewValidatedPublicV42RewardActions(decoded, rewardKinds),
    }
  }
  return {
    combat: previewPublicV41CombatActions(progress, combatKinds),
    reward: rewardKinds.map(() => ({ rejection: 'invalid_progress' as const })),
  }
}

function resolveSparStrike(current: PublicV42RewardProgress): PublicV42RewardProgress | null {
  const { spar } = current.ironHallReward
  if (!spar.active || current.state.tick < spar.strikeAtTick) return current
  const site = ironHallSite(current)
  if (!site || !safeCounter(current.state.tick + 45)
    || !safeCounter(spar.strikesResolved + 1)) return null
  const hit = horizontal(current.state.player.position, site.ward.center) <= 2.7
  const armored = hit && current.ironHallReward.vestEquipped
    && current.ironHallReward.vestDurability > 0
  const damage = hit ? armored ? 2 : 4 : 0
  const vestDurability = current.ironHallReward.vestDurability - (armored ? 1 : 0)
  const knockout = current.ironHall.playerHealth <= damage
  if (knockout && !safeCounter(current.ironHall.knockouts + 1)) return null
  return { ...current,
    ironHall: { ...current.ironHall,
      playerHealth: knockout ? 6 : current.ironHall.playerHealth - damage,
      knockouts: current.ironHall.knockouts + (knockout ? 1 : 0) },
    ironHallReward: { ...current.ironHallReward, vestDurability,
      vestEquipped: vestDurability > 0 && current.ironHallReward.vestEquipped,
      spar: { active: false, strikeAtTick: 0,
        nextReadyTick: current.state.tick + 45,
        strikesResolved: spar.strikesResolved + 1 } },
    state: knockout ? { ...current.state,
      player: { ...current.state.player, position: { ...site.alcove.center },
        verticalVelocity: 0 } } : current.state }
}

/** V41's phase clock, applied when V42 needs whole-flight movement. */
function resolveCombatAfterFlightFrame(current: PublicV42RewardProgress):
  PublicV42RewardProgress | null {
  const h = current.ironHall
  if (!h.engaged || h.wardDefeated) return current
  const site = ironHallSite(current)
  if (!site) return null
  const distance = horizontal(current.state.player.position, site.ward.center)
  if (distance > 12) return { ...current, ironHall: { ...h,
    engaged: false, wardHealth: 9, phase: 'dormant', phaseUntilTick: 0 } }
  if (h.phase === 'recovery' && current.state.tick >= h.phaseUntilTick) {
    if (!safeCounter(current.state.tick + 20)) return null
    return { ...current, ironHall: { ...h, phase: 'windup',
      phaseUntilTick: current.state.tick + 20 } }
  }
  if (h.phase !== 'windup' || current.state.tick < h.phaseUntilTick) return current
  const damage = distance <= 2.7
    ? current.state.tick <= h.guardUntilTick ? 1 : 4 : 0
  if (h.playerHealth <= damage) {
    if (!safeCounter(h.knockouts + 1)) return null
    return { ...current, ironHall: { ...h, engaged: false, playerHealth: 6,
      wardHealth: 9, phase: 'dormant', phaseUntilTick: 0,
      knockouts: h.knockouts + 1 },
    state: { ...current.state, player: { ...current.state.player,
      position: { ...site.alcove.center }, verticalVelocity: 0 } } }
  }
  if (!safeCounter(current.state.tick + 15)) return null
  return { ...current, ironHall: { ...h, playerHealth: h.playerHealth - damage,
    phase: 'recovery', phaseUntilTick: current.state.tick + 15 } }
}

function flightFrames(before: PublicV42RewardProgress,
  frames: readonly PublicV14Frame[], allowAirborne: boolean): PublicV42RewardProgress | null {
  const batch = { kind: 'frame-batch/v1' as const, frames }
  if (!before.ironHall.engaged && !before.ironHallReward.spar.active) {
    const moved = allowAirborne
      ? previewPublicV37FrameBatch(before, batch)
      : replayPublicV40Witness(before, batch)
    if (!moved) return null
    const next = { ...before, ...moved }
    return allowAirborne && next.state.player.verticalVelocity !== 0
      ? next : decodePublicV42RewardProgress(next)
  }
  let current = before, origin = before
  let segment: PublicV14Frame[] = []
  let unobservedTravel = 0
  const site = ironHallSite(before)
  if (!site) return null
  for (const [index, frame] of frames.entries()) {
    segment.push(frame)
    const tick = current.state.tick + 1
    if (!safeCounter(tick)) return null
    const move = frame.intents.find((intent) => intent.type === 'move')
    unobservedTravel += move?.type === 'move'
      ? Math.hypot(move.delta.x, move.delta.z)
        * Math.max(1, HIGHLAND_WINDWARD_STEP.speedMultiplier) : 0
    // Observe every strike and final state. While fighting, sample movement
    // before its maximum possible travel could cross the retreat radius.
    const observe = segment.length === 1 || index === frames.length - 1
      || current.ironHall.engaged && horizontal(current.state.player.position,
        site.ward.center) + unobservedTravel > 12
      || current.ironHall.engaged && current.ironHall.phaseUntilTick <= tick
      || current.ironHallReward.spar.active
        && current.ironHallReward.spar.strikeAtTick <= tick
    const moved = observe ? previewPublicV37FrameBatch(origin,
      { kind: 'frame-batch/v1', frames: segment }) : null
    if (observe && (!moved || moved.state.tick !== tick)) return null
    if (moved) unobservedTravel = 0
    const knockouts = current.ironHall.knockouts
    const advanced = resolveCombatAfterFlightFrame(moved
      ? { ...current, ...moved }
      : { ...current, state: { ...current.state, tick } })
    const next = advanced && resolveSparStrike(advanced)
    if (!next) return null
    current = next
    if (current.ironHall.knockouts > knockouts) {
      origin = current
      segment = []
      unobservedTravel = 0
    }
  }
  if (segment.length && !allowAirborne) {
    const checked = replayPublicV40Witness(origin,
      { kind: 'frame-batch/v1', frames: segment })
    if (!checked || !samePublicV14Value(checked.state, current.state)) return null
  }
  return allowAirborne && current.state.player.verticalVelocity !== 0
    ? current : decodePublicV42RewardProgress(current)
}

function replayFrames(before: PublicV42RewardProgress, rawWitness: unknown,
  allowAirborne: boolean): PublicV42RewardProgress | null {
  const witness = decodePublicV14FrameWitness(rawWitness)
  let current = progressOf(before)
  if (!witness || !current) return null
  if (witness.frames.some((frame) => frame.intents.some((intent) => intent.type === 'jump')))
    return flightFrames(current, witness.frames, allowAirborne)
  // Without an active ward or spar, V41/V42 add no per-frame effects. Let the
  // inherited movement authority replay the batch once instead of decoding
  // every full V40/V41 layer for each frame. Keep the original path for
  // step-down flights and any batch the inherited authority cannot confirm.
  if (!current.ironHall.engaged && !current.ironHallReward.spar.active) {
    const moved = replayPublicV40Witness(current, witness)
    if (moved) return decodePublicV42RewardProgress({ ...current, ...moved })
  }
  const origin = current
  for (const frame of witness.frames) {
    const moved = replayPublicV41CombatFrameBatch(current,
      { kind: 'frame-batch/v1', frames: [frame] })
    if (!moved) {
      // A dry step-down can be valid movement whose intermediate frame is
      // airborne. Preserve V41's grounded replay for every other rejection.
      const provisional = previewPublicV37FrameBatch(current,
        { kind: 'frame-batch/v1', frames: [frame] })
      const pose = provisional && projectPublicV31Pose(provisional)
      if (!provisional || !pose || provisional.state.player.verticalVelocity === 0
        && Math.abs(pose.effective.position.y - pose.effective.floorY) <= 1e-6)
        return null
      return flightFrames(origin, witness.frames, allowAirborne)
    }
    current = resolveSparStrike({ ...moved, ironHallReward: current.ironHallReward })
    if (!current) return null
  }
  return decodePublicV42RewardProgress(current)
}

/** Checked full-batch replay admits completed flight while resolving strikes per frame. */
export function replayPublicV42RewardFrameBatch(before: PublicV42RewardProgress,
  rawWitness: unknown): PublicV42RewardProgress | null {
  return replayFrames(before, rawWitness, false)
}

/** Whole-batch observation may be airborne; the checked writer still waits for landing. */
export function previewPublicV42RewardFrameBatch(before: PublicV42RewardProgress,
  rawWitness: unknown): PublicV42RewardProgress | null {
  const witness = decodePublicV14FrameWitness(rawWitness)
  const frame = witness?.frames.length === 1 ? witness.frames[0] : null
  if (frame && frame.intents.length > 0 && frame.intents.every((intent) =>
    intent.type === 'look' || intent.type === 'move')) {
    // Without combat or spar, V40 is the same movement authority. Admit only
    // a fully decoded, grounded V42 result; leave every uncertain case below.
    const current = progressOf(before)
    if (current && !current.ironHall.engaged && !current.ironHallReward.spar.active
      && current.state.player.verticalVelocity === 0) {
      const pose = projectPublicV31Pose(current)
      if (pose && Math.abs(pose.effective.position.y - pose.effective.floorY) <= 1e-6) {
        const moved = replayPublicV40Witness(current, witness)
        if (moved && moved.state.player.verticalVelocity === 0) {
          const next = decodePublicV42RewardProgress({ ...current, ...moved })
          const nextPose = next && projectPublicV31Pose(next)
          if (next && nextPose
            && Math.abs(nextPose.effective.position.y - nextPose.effective.floorY) <= 1e-6)
            return next
        }
      }
    }
  }
  return replayPublicV42RewardFrameBatch(before, rawWitness)
    ?? replayFrames(before, rawWitness, true)
}
