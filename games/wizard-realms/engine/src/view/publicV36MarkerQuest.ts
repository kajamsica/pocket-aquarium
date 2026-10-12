import { mireglassAnchors } from '../domain/mireglassContent'
import type { WizardViewProjection } from './contracts'

export type PublicV36MarkerQuestFacts = Readonly<{
  ledgerClaimReward: 'traveler_tunic' | 'coins' | null
  markerClaimReward: 'fen_waders' | 'coins' | null
  state: Readonly<{ mireglass: Readonly<{
    fringeMarkerStudied: boolean
    cacheRevealed: boolean
    cacheExcavated: boolean
  }> }>
}>

export type PublicV36MarkerQuest = Readonly<{
  id: 'beneath-old-marker/v1'
  title: 'Beneath the Old Marker'
  stage: 'ledger' | 'trail' | 'marker' | 'cast' | 'training' | 'cache' | 'salvager' | 'complete'
  objective: string
  reward: string
  active: boolean
  complete: boolean
}>

const claimReward = 'The salvager pays 50 Spellcraft and character XP, plus 80 coins and unequipped Fen Waders. If you already own or listed the waders, the payout is 230 coins instead. Spellcasting and excavation grant their own action XP.'

/** Read-only stage copy. The checked V36 save owns every milestone and reward. */
export function publicV36MarkerQuest(view: WizardViewProjection,
  facts: PublicV36MarkerQuestFacts): PublicV36MarkerQuest {
  const base = { id: 'beneath-old-marker/v1', title: 'Beneath the Old Marker' } as const
  const finish = (stage: PublicV36MarkerQuest['stage'], objective: string,
    reward = claimReward): PublicV36MarkerQuest => ({ ...base, stage, objective, reward,
      active: stage !== 'ledger', complete: stage === 'complete' })

  if (facts.markerClaimReward !== null) return finish('complete',
    'The sealed cache was uncovered and your reward was claimed at the Mireglass salvager.',
    facts.markerClaimReward === 'fen_waders'
      ? 'Saved claim: 80 coins, unequipped Fen Waders, and 50 Spellcraft and character XP. Fen Waders are travel clothing, not armor; equipping them replaces running boots and makes you walk.'
      : 'Saved claim: 230 coins and 50 Spellcraft and character XP. You already owned or listed Fen Waders. Ordinary spell and dig actions granted their own XP.')

  if (facts.ledgerClaimReward === null) return finish('ledger',
    "Finish Outfitters' Ledger first. Beneath the Old Marker starts after its delivery reward is claimed.")

  const region = facts.state.mireglass
  if (!region.fringeMarkerStudied) {
    const marker = mireglassAnchors(view.seed).fringeMarker.tile.center
    const nearby = Math.hypot(view.player.position[0] - marker.x,
      view.player.position[2] - marker.z) < 24
    return nearby ? finish('marker',
      'Approach and study the Mireglass frontier marker. Its inscription teaches Wayfinder Glow if you have not learned it.')
      : finish('trail',
        'Follow the revealed dry trail west from Greenway into Mireglass. Find the frontier marker; the map and visible stone landmark guide the route.')
  }

  if (!region.cacheRevealed) return finish('cast',
    'Follow the dry Mireglass trail beyond the marker toward the western seal ground. Cast Wayfinder Glow near the hidden cache to reveal it; casting grants its ordinary Spellcraft and Wayfinding XP.')

  const excavationLevel = 1 + Math.floor(view.skillXp.excavation / 30)
  const spadeOwned = view.backpack.stacks.some((stack) =>
    stack.itemId === 'field_spade' && stack.quantity > 0)
    || view.equipment.mainHand?.itemId === 'field_spade'
  if (!region.cacheExcavated && excavationLevel < 2) return finish('training',
    `${spadeOwned ? 'Equip your field spade' : 'Buy a field spade at Greenway Outfitters or the Mireglass salvager'}; chop a Mireglass tree, then dig its stump for Excavation XP. Reach level 2 before opening the revealed seal cache. The stump dig grants its own XP and stone.`)

  if (!region.cacheExcavated) return finish('cache',
    `${spadeOwned ? 'Equip your field spade' : 'Buy and equip a field spade at Greenway Outfitters or the Mireglass salvager'}, then approach and excavate the revealed seal cache. Free one pack space for its seal. The cache dig grants its own Excavation XP; the seal can be kept or sold.`)

  return finish('salvager',
    'Return to the Mireglass salvager on dry ground and use Claim. The saved excavation proves this chapter even if you sold the seal. Free one pack space if you do not already own or list Fen Waders.')
}

export function publicV36MarkerRejectionMessage(rejection: string): string {
  const messages: Record<string, string> = {
    invalid_value: 'This claim request is invalid.', invalid_progress: 'The checked quest state is unavailable.',
    requires_ledger: "Claim Outfitters' Ledger first.", marker_unstudied: 'Study the Mireglass frontier marker first.',
    cache_hidden: 'Cast Wayfinder Glow near the hidden seal cache first.',
    cache_not_excavated: 'Excavate the revealed seal cache first.',
    unavailable_here: 'Return to the active Mireglass region.', too_far: 'Move within 3 m of the Mireglass salvager.',
    not_grounded: 'Stand on dry ground before claiming.', capacity: 'Free one pack space for Fen Waders.',
    already_claimed: 'This quest reward is already claimed.',
  }
  return messages[rejection] ?? 'The checked claim is not ready.'
}
