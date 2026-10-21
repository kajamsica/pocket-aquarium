import { backpackSlotsUsed } from './backpackSlots'
import { mireglassAnchors } from './mireglassContent'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { projectPublicV31Pose } from './publicWorldV31Support'
import type { PublicV33Progress } from './publicWorldV33Migration'
import type { PublicV35Progress } from './publicWorldV35LedgerAction'

export type PublicV36MarkerProgress = PublicV35Progress & Readonly<{
  markerClaimReward: 'fen_waders' | 'coins' | null
}>
export type PublicV36MarkerWitness = Readonly<{ kind: 'marker-claim/v1' }>
export type PublicV36MarkerReward = Exclude<PublicV36MarkerProgress['markerClaimReward'], null>
export type PublicV36MarkerRejection = 'invalid_value' | 'invalid_progress'
  | 'requires_ledger' | 'marker_unstudied' | 'cache_hidden' | 'cache_not_excavated'
  | 'unavailable_here' | 'not_grounded' | 'too_far' | 'capacity' | 'already_claimed'
export type PublicV36MarkerPreview = Readonly<{
  rejection: PublicV36MarkerRejection | null
  reward: PublicV36MarkerReward | null
}>
export type PublicV36MarkerResult = Readonly<{
  progress: PublicV36MarkerProgress; reward: PublicV36MarkerReward; rejection?: never
}> | Readonly<{ progress?: never; reward?: never; rejection: PublicV36MarkerRejection }>

const inherited = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells }: PublicV36MarkerProgress):
  PublicV33Progress => ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells })

export function decodePublicV36MarkerWitness(value: unknown): PublicV36MarkerWitness | null {
  try {
    if (!exactPublicV23(value, ['kind']) || value.kind !== 'marker-claim/v1') return null
    structuredClone(value)
    return { kind: 'marker-claim/v1' }
  } catch { return null }
}

type Checked = Readonly<{ progress: PublicV36MarkerProgress; reward: PublicV36MarkerReward }>
  | Readonly<{ rejection: PublicV36MarkerRejection }>

function checked(raw: PublicV36MarkerProgress, rawWitness: unknown): Checked {
  const reject = (rejection: PublicV36MarkerRejection): Checked => ({ rejection })
  if (!decodePublicV36MarkerWitness(rawWitness)) return reject('invalid_value')
  try {
    if (raw.markerClaimReward !== null && raw.markerClaimReward !== 'fen_waders'
      && raw.markerClaimReward !== 'coins'
      || raw.ledgerClaimReward !== null && raw.ledgerClaimReward !== 'traveler_tunic'
        && raw.ledgerClaimReward !== 'coins'
      || raw.ledgerSurveyBridgeId !== null && typeof raw.ledgerSurveyBridgeId !== 'string'
      || raw.ledgerClaimReward !== null && raw.ledgerSurveyBridgeId === null
      || raw.markerClaimReward !== null && raw.ledgerClaimReward === null)
      return reject('invalid_progress')
    const old = decodePublicV31ActionProgress(inherited(raw))
    if (!old) return reject('invalid_progress')
    const progress: PublicV36MarkerProgress = { ...old,
      ledgerSurveyBridgeId: raw.ledgerSurveyBridgeId,
      ledgerClaimReward: raw.ledgerClaimReward,
      markerClaimReward: raw.markerClaimReward }
    if (progress.ledgerSurveyBridgeId !== null &&
      (!resolvePublicV28RiverBridge(old.state.seed, progress.ledgerSurveyBridgeId)
        || !old.riverBridgeIds.includes(progress.ledgerSurveyBridgeId)
        || old.claimedBridgeheadId === null)) return reject('invalid_progress')
    const { state } = progress, { player } = state
    if (progress.markerClaimReward !== null) return reject('already_claimed')
    if (progress.ledgerClaimReward === null) return reject('requires_ledger')
    if (!state.mireglass.fringeMarkerStudied) return reject('marker_unstudied')
    if (!state.mireglass.cacheRevealed) return reject('cache_hidden')
    if (!state.mireglass.cacheExcavated) return reject('cache_not_excavated')
    if (state.movementOwner !== 'streamed') return reject('unavailable_here')
    const pose = projectPublicV31Pose(old)
    if (!pose || player.verticalVelocity !== 0 || pose.support !== 'terrain'
      || Math.abs(player.position.y - pose.carrier.floorY) > 1e-6
      || Math.abs(pose.effective.floorY - pose.carrier.floorY) > 1e-6)
      return reject('not_grounded')
    const salvager = mireglassAnchors(state.seed).salvager.tile.center
    if (Math.hypot(player.position.x - salvager.x, player.position.y - salvager.y,
      player.position.z - salvager.z) > 3) return reject('too_far')
    const owned = player.inventory.some((stack) =>
      stack.itemId === 'mireglass_reach/item/waders' && stack.quantity > 0)
      || player.tradeSlots.some((slot) =>
        slot.itemId === 'mireglass_reach/item/waders' && slot.quantity > 0)
    const reward = owned ? 'coins' : 'fen_waders'
    const bagCount = Object.values(progress.terrain.bag).reduce((sum, count) => sum + count, 0)
    const carried = backpackSlotsUsed(player.inventory, player.tradeSlots, bagCount)
    if (!Number.isSafeInteger(carried)) return reject('invalid_value')
    if (!owned && carried + 1 > player.backpackCapacity) return reject('capacity')
    if (![state.eventSequence + 1, player.xp + 50, player.skillXp.spellcraft + 50,
      player.coins + (owned ? 230 : 80)].every(Number.isSafeInteger)) return reject('invalid_value')
    return { progress, reward }
  } catch { return reject('invalid_progress') }
}

/** Advisory only. The locked V36 writer reruns this rule against its own head. */
export function previewPublicV36MarkerAction(progress: PublicV36MarkerProgress,
  witness: unknown): PublicV36MarkerPreview {
  const result = checked(progress, witness)
  return { rejection: 'rejection' in result ? result.rejection : null,
    reward: 'reward' in result ? result.reward : null }
}

/** Pure one-time transition. The witness never selects a reward or target pose. */
export function confirmPublicV36MarkerAction(progress: PublicV36MarkerProgress,
  rawWitness: unknown): PublicV36MarkerResult {
  const result = checked(progress, rawWitness)
  if ('rejection' in result) return { rejection: result.rejection }
  const { state } = result.progress, { player } = state, reward = result.reward
  const xp = player.xp + 50
  const next: PublicV36MarkerProgress = { ...result.progress, markerClaimReward: reward,
    state: { ...state, eventSequence: state.eventSequence + 1,
      player: { ...player, xp, level: 1 + Math.floor(xp / 100),
        skillXp: { ...player.skillXp, spellcraft: player.skillXp.spellcraft + 50 },
        coins: player.coins + (reward === 'coins' ? 230 : 80),
        inventory: reward === 'fen_waders'
          ? [...player.inventory, { itemId: 'mireglass_reach/item/waders', quantity: 1 }]
          : player.inventory } } }
  return decodePublicV31ActionProgress(inherited(next))
    ? { progress: next, reward } : { rejection: 'invalid_value' }
}
