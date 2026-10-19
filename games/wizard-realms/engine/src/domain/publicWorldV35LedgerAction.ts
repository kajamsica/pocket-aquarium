import { discoveryMaskHasTileId } from './discoveryMask'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { projectPublicV28Pose } from './publicWorldV28RiverSupport'
import type { PublicV33Progress } from './publicWorldV33Migration'
import type { Vec3 } from './types'

export type PublicV35Progress = PublicV33Progress & Readonly<{
  ledgerSurveyBridgeId: string | null
  ledgerClaimReward: 'traveler_tunic' | 'coins' | null
}>
export type PublicV35LedgerWitness = Readonly<{
  kind: 'ledger-survey/v1'; bridgeId: string
}> | Readonly<{ kind: 'ledger-deliver/v1' }>
export type PublicV35LedgerReward = Exclude<PublicV35Progress['ledgerClaimReward'], null>
export type PublicV35LedgerRejection = 'invalid_progress' | 'invalid_site'
  | 'requires_first_find' | 'requires_survey' | 'not_built' | 'undiscovered'
  | 'unavailable_here' | 'too_far' | 'no_stone' | 'already_surveyed'
  | 'already_claimed' | 'invalid_value'
export type PublicV35LedgerPreview = Readonly<{
  site: Readonly<{ id: string; exit: Readonly<Vec3> }> | null
  rejection: PublicV35LedgerRejection | null
  reward: PublicV35LedgerReward | null
}>
export type PublicV35LedgerResult = Readonly<{
  progress: PublicV35Progress; reward: PublicV35LedgerReward | null; rejection?: never
}> | Readonly<{
  progress?: never; reward?: never; rejection: PublicV35LedgerRejection
}>

const inherited = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells }: PublicV35Progress):
  PublicV33Progress => ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells })

export function decodePublicV35LedgerWitness(value: unknown): PublicV35LedgerWitness | null {
  try {
    if (exactPublicV23(value, ['kind']) && value.kind === 'ledger-deliver/v1') {
      structuredClone(value)
      return { kind: 'ledger-deliver/v1' }
    }
    if (exactPublicV23(value, ['kind', 'bridgeId'])
      && value.kind === 'ledger-survey/v1'
      && typeof value.bridgeId === 'string' && value.bridgeId.length > 0) {
      structuredClone(value)
      return { kind: 'ledger-survey/v1', bridgeId: value.bridgeId }
    }
  } catch { /* Malformed or non-cloneable witnesses are never authority. */ }
  return null
}

type Checked = Readonly<{
  progress: PublicV35Progress
  site: PublicV35LedgerPreview['site']
  reward: PublicV35LedgerReward | null
}> | Readonly<{
  rejection: PublicV35LedgerRejection
  site: PublicV35LedgerPreview['site']
}>

function checked(raw: PublicV35Progress, rawWitness: unknown): Checked {
  const reject = (rejection: PublicV35LedgerRejection,
    site: PublicV35LedgerPreview['site'] = null): Checked => ({ rejection, site })
  try {
    if (raw?.ledgerSurveyBridgeId !== null
      && typeof raw?.ledgerSurveyBridgeId !== 'string'
      || raw?.ledgerClaimReward !== null && raw?.ledgerClaimReward !== 'traveler_tunic'
        && raw?.ledgerClaimReward !== 'coins'
      || raw.ledgerClaimReward !== null && raw.ledgerSurveyBridgeId === null) {
      return reject('invalid_progress')
    }
    const old = decodePublicV31ActionProgress(inherited(raw))
    if (!old) return reject('invalid_progress')
    const progress: PublicV35Progress = { ...old,
      ledgerSurveyBridgeId: raw.ledgerSurveyBridgeId,
      ledgerClaimReward: raw.ledgerClaimReward }
    if (progress.ledgerSurveyBridgeId !== null) {
      const saved = resolvePublicV28RiverBridge(old.state.seed, progress.ledgerSurveyBridgeId)
      if (!saved || !old.riverBridgeIds.includes(saved.id)
        || old.claimedBridgeheadId === null) return reject('invalid_progress')
    }
    const witness = decodePublicV35LedgerWitness(rawWitness)
    if (!witness) return reject('invalid_value')
    const { state } = progress, { player } = state
    if (witness.kind === 'ledger-survey/v1') {
      const site = resolvePublicV28RiverBridge(state.seed, witness.bridgeId)
      if (!site) return reject('invalid_site')
      const located = { id: site.id, exit: site.exit }
      if (old.claimedBridgeheadId === null) return reject('requires_first_find', located)
      if (progress.ledgerSurveyBridgeId !== null) return reject('already_surveyed', located)
      if (!progress.riverBridgeIds.includes(site.id)) return reject('not_built', located)
      if (!progress.greenwayWorks.builtLadderIds.some((id) =>
        resolvePublicV17GreenwaySite(state.seed, id)?.kind === 'ladder')) {
        return reject('not_built', located)
      }
      if (!discoveryMaskHasTileId(state.discoveryMask,
        site.footprintTileIds[site.footprintTileIds.length - 1])) {
        return reject('undiscovered', located)
      }
      if (state.movementOwner !== 'streamed') return reject('unavailable_here', located)
      const position = player.position
      const pose = projectPublicV28Pose(old, progress.terrain, progress.riverBridgeIds)
      if (!pose || player.verticalVelocity !== 0 || pose.support !== 'terrain'
        || Math.abs(position.y - pose.carrier.floorY) > 1e-6
        || Math.abs(pose.effective.floorY - pose.carrier.floorY) > 1e-6
        || position.z <= site.to.z
        || Math.hypot(position.x - site.exit.x, position.y - site.exit.y,
          position.z - site.exit.z) > 3) return reject('too_far', located)
      if (![state.eventSequence + 1, player.xp + 20,
        player.skillXp.wayfinding + 20].every(Number.isSafeInteger)) {
        return reject('invalid_value', located)
      }
      return { progress, site: located, reward: null }
    }
    if (progress.ledgerSurveyBridgeId === null) return reject('requires_survey')
    if (progress.ledgerClaimReward !== null) return reject('already_claimed')
    if (progress.terrain.bag.stone < 1) return reject('no_stone')
    if (state.movementOwner !== 'greenway') return reject('unavailable_here')
    const store = state.greenway.stores.find((entry) => entry.id === 'store-greenway')
    if (!store) return reject('invalid_progress')
    const pose = projectPublicV28Pose(old, progress.terrain, progress.riverBridgeIds)
    if (!pose || player.verticalVelocity !== 0 || pose.support !== 'ground'
      || Math.abs(player.position.y - pose.carrier.floorY) > 1e-6
      || Math.abs(pose.effective.floorY - pose.carrier.floorY) > 1e-6
      || Math.hypot(player.position.x - store.position.x,
        player.position.y - store.position.y, player.position.z - store.position.z) > 3) {
      return reject('too_far')
    }
    const owned = player.inventory.some((stack) =>
      stack.itemId === 'traveler_tunic' && stack.quantity > 0)
      || player.tradeSlots.some((slot) =>
        slot.itemId === 'traveler_tunic' && slot.quantity > 0)
    const reward = owned ? 'coins' : 'traveler_tunic'
    if (![state.eventSequence + 1, player.xp + 40,
      player.skillXp.wayfinding + 40, player.coins + (owned ? 85 : 50)]
      .every(Number.isSafeInteger)) return reject('invalid_value')
    return { progress, site: null, reward }
  } catch { return reject('invalid_progress') }
}

/** Advisory only. The locked writer confirms the witness against its own head. */
export function previewPublicV35LedgerAction(progress: PublicV35Progress,
  witness: unknown): PublicV35LedgerPreview {
  const result = checked(progress, witness)
  return { site: result.site,
    rejection: 'rejection' in result ? result.rejection : null,
    reward: 'reward' in result ? result.reward : null }
}

/** Pure checked transition; neither witness selects a payout branch. */
export function confirmPublicV35LedgerAction(progress: PublicV35Progress,
  rawWitness: unknown): PublicV35LedgerResult {
  const result = checked(progress, rawWitness)
  if ('rejection' in result) return { rejection: result.rejection }
  const witness = decodePublicV35LedgerWitness(rawWitness)!
  const { state } = result.progress, { player } = state
  const survey = witness.kind === 'ledger-survey/v1'
  const xp = survey ? 20 : 40
  const reward = result.reward
  const next: PublicV35Progress = { ...result.progress,
    ledgerSurveyBridgeId: survey ? result.site!.id : result.progress.ledgerSurveyBridgeId,
    ledgerClaimReward: survey ? null : reward,
    terrain: survey ? result.progress.terrain : { ...result.progress.terrain,
      bag: { ...result.progress.terrain.bag, stone: result.progress.terrain.bag.stone - 1 } },
    state: { ...state, eventSequence: state.eventSequence + 1,
      player: { ...player, xp: player.xp + xp,
        level: 1 + Math.floor((player.xp + xp) / 100),
        skillXp: { ...player.skillXp, wayfinding: player.skillXp.wayfinding + xp },
        coins: player.coins + (survey ? 0 : reward === 'coins' ? 85 : 50),
        inventory: reward === 'traveler_tunic'
          ? [...player.inventory, { itemId: 'traveler_tunic', quantity: 1 }] : player.inventory,
        equipment: reward === 'traveler_tunic'
          ? { ...player.equipment, chest: 'traveler_tunic' } : player.equipment } } }
  return decodePublicV31ActionProgress(inherited(next))
    ? { progress: next, reward } : { rejection: 'invalid_value' }
}
