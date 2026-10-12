import type { WizardViewProjection } from './contracts'
import type { PublicV42RewardRejection } from '../domain/publicWorldV42RewardAction'
import { publicV41IronHallQuest } from './publicV41IronHallQuest'

export type PublicV42IronHallActionPreview = Readonly<{
  rejection: PublicV42RewardRejection | null
  hint: string | null
}>

/** Checked V42 facts and action previews. This view never decides or grants a reward. */
export type PublicV42IronHallView = Readonly<{
  crestOutcome: 'unrolled' | 'won' | 'missed'
  questClaimed: boolean
  vestOwned: boolean
  vestEquipped: boolean
  vestDurability: number
  spar: Readonly<{ active: boolean; strikeAtTick: number; nextReadyTick: number; strikesResolved: number }>
  claim: PublicV42IronHallActionPreview
  equip: PublicV42IronHallActionPreview
  unequip: PublicV42IronHallActionPreview
  repair: PublicV42IronHallActionPreview
  sparStart: PublicV42IronHallActionPreview
}>

const rejectionHints: Readonly<Record<PublicV42RewardRejection, string>> = {
  invalid_value: 'The checked action is unavailable right now.',
  invalid_progress: 'This save cannot safely perform the action.',
  requires_crossing: 'Record the Waystation crossing first.',
  wrong_region: 'Return to Iron Hall.',
  not_grounded: 'Stand on solid ground first.',
  unsafe_source: 'Move off water, raised soil, or an open pit.',
  unrevealed: 'Discover this part of Iron Hall first.',
  too_far: 'Move within 3 m of the marked Hall site.',
  ward_not_defeated: 'Defeat the clockwork ward first.',
  crest_unresolved: 'The first ward defeat must resolve its crest outcome.',
  not_claimed: 'Claim the Iron Hall reward first.',
  already_claimed: 'The Iron Hall reward was already claimed.',
  not_owned: 'Claim the Guard Vest first.',
  already_equipped: 'The Guard Vest is already equipped.',
  not_equipped: 'The Guard Vest is already unequipped.',
  depleted: 'Repair the depleted Guard Vest at the quartermaster.',
  already_full: 'The Guard Vest is already at full durability.',
  insufficient_coins: 'Repair costs 18 coins.',
  cannot_change_gear: 'Finish the fight or spar before changing gear.',
  cooldown: 'Wait for the practice ward to reset.',
  spar_active: 'The practice ward is already winding up.',
}

export const publicV42IronHallRejectionHint = (rejection: PublicV42RewardRejection) =>
  rejectionHints[rejection]

export const publicV42IronHallActionHint = (action: PublicV42IronHallActionPreview) =>
  action.hint ?? (action.rejection ? publicV42IronHallRejectionHint(action.rejection) : null)

export type PublicV42IronHallQuest = Readonly<{
  id: 'iron-hall-watch/v2'
  title: 'Iron Hall Watch'
  next: string
  objective: string
  reward: string
  status: string
  complete: boolean
}>

/** Journal language follows checked facts; undiscovered sites are never named on the map. */
export function publicV42IronHallQuest(view: WizardViewProjection): PublicV42IronHallQuest | null {
  const reward = view.v42IronHall
  const hall = view.v41IronHall
  if (!reward || !hall) return null
  const base = publicV41IronHallQuest(view)
  const finish = (next: string, objective: string, status: string, complete: boolean): PublicV42IronHallQuest =>
    ({ id: 'iron-hall-watch/v2', title: 'Iron Hall Watch', next, objective,
      reward: '60 coins, 70 character XP, 70 Combat XP, and the Guard Vest.', status, complete })
  if (!hall.wardDefeated) return finish(base?.next ?? 'Defeat the ward',
    base?.objective ?? 'Find the Iron Hall ward.', base?.status ?? 'Iron Hall watch', false)
  const crest = reward.crestOutcome === 'won' ? 'Crest found' : reward.crestOutcome === 'missed'
    ? 'No crest this time' : 'Crest unresolved'
  if (!reward.questClaimed) return finish('Return to the quartermaster',
    view.v42QuartermasterSite?.revealed
      ? 'Return to the Iron Hall quartermaster on foot to claim your reward.'
      : 'Explore the dry hall approach to find the quartermaster and claim your reward.',
    `Ward defeated · ${crest}`, false)
  const spar = reward.spar.active
    ? `Practice slam in ${Math.max(0, reward.spar.strikeAtTick - view.tick)} ticks`
    : view.tick < reward.spar.nextReadyTick
      ? `Practice ward resets in ${reward.spar.nextReadyTick - view.tick} ticks`
      : 'Practice ward ready'
  return finish('Practice, repair, then Iron Hall Depths',
    'The Guard Vest is yours. Test it against the practice ward, repair it with the quartermaster, then seek the lower Iron Hall challenge.',
    `${crest} · Vest ${reward.vestDurability}/12 · ${spar}`, true)
}
