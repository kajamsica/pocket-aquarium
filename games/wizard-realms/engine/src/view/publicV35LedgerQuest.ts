import { backpackSlotsUsed } from '../domain/backpackSlots'
import { resolvePublicV17GreenwaySite } from '../domain/publicWorldV17GreenwaySites'
import { resolvePublicV28RiverBridge } from '../domain/publicWorldV28RiverBridgeSites'
import type { WizardViewProjection } from './contracts'

export type PublicV35LedgerQuestFacts = Readonly<{
  claimedBridgeheadId: string | null
  riverBridgeIds: readonly string[]
  greenwayWorks: Readonly<{ builtLadderIds: readonly string[] }>
  ledgerSurveyBridgeId: string | null
  ledgerClaimReward: 'traveler_tunic' | 'coins' | null
  terrain: Readonly<{ bag: Readonly<{ stone: number }> }>
}>

export type PublicV35LedgerQuest = Readonly<{
  id: 'outfitters-ledger/v1'
  title: "Outfitters' Ledger"
  stage: 'first-find' | 'route' | 'survey' | 'sample' | 'return' | 'complete'
  objective: string
  reward: string
  complete: boolean
}>

/** Read-only journal state. The checked V35 save owns survey and delivery. */
export function publicV35LedgerQuest(view: WizardViewProjection,
  facts: PublicV35LedgerQuestFacts): PublicV35LedgerQuest {
  const base = { id: 'outfitters-ledger/v1', title: "Outfitters' Ledger" } as const
  const finish = (stage: PublicV35LedgerQuest['stage'], objective: string,
    reward: string): PublicV35LedgerQuest => ({ ...base, stage, objective, reward,
      complete: stage === 'complete' })
  const pendingReward = 'Survey: 20 Wayfinding and character XP. Delivery: 40 more of each, plus 50 coins and a Traveler Tunic, or 85 coins if you already own the tunic.'

  if (facts.ledgerClaimReward !== null) return finish('complete',
    'The stone sample was delivered to Greenway Outfitters. The saved Outfitters’ Ledger reward is claimed.',
    facts.ledgerClaimReward === 'traveler_tunic'
      ? 'Saved delivery reward: 50 coins and a Traveler Tunic, plus 40 Wayfinding and character XP. The earlier survey granted 20 of each.'
      : 'Saved delivery reward: 85 coins, plus 40 Wayfinding and character XP. The earlier survey granted 20 of each.')

  if (facts.ledgerSurveyBridgeId !== null) {
    if (facts.terrain.bag.stone > 0) return finish('return',
      'Carry one excavated terrain-bag stone back to Greenway Outfitters. Approach the store on the ground and use Deliver.', pendingReward)
    const mining = view.v29Mining?.tools
    const pick = mining?.activePick === 'enchanted'
      ? 'equip your enchanted pick'
      : mining?.basicPickOwned ? 'equip your basic pick'
        : 'get a basic pick at Greenway Outfitters and equip it'
    const room = backpackSlotsUsed(view.backpack.stacks,
      view.tradeListings.map((listing) => ({ itemId: listing?.itemId ?? null,
        quantity: listing?.quantity ?? 0 })),
      Object.values(view.v26TerrainBag ?? {}).reduce((sum, quantity) => sum + quantity, 0))
      >= view.backpack.capacity
      ? 'Your pack is full; use or sell carried materials to make room. ' : ''
    return finish('sample', `${room}Return to Greenway or a streamed area with active terrain controls. Move within 5 m of clear, revealed dry loam; equip a field spade, select Dig, and tap the same ground cell twice to remove its two soil layers. Then ${pick}, select Mine, and tap the exposed stone layer. Keep one stone in your terrain bag.`, pendingReward)
  }

  if (facts.claimedBridgeheadId === null) return finish('first-find',
    'Complete and claim The Surveyor’s First Find at a saved River Works bridgehead before starting the Ledger route.', pendingReward)

  const ladderBuilt = facts.greenwayWorks.builtLadderIds.some((id) =>
    resolvePublicV17GreenwaySite(view.seed, id)?.kind === 'ladder')
  const riverBridge = facts.riverBridgeIds.map((id) =>
    resolvePublicV28RiverBridge(view.seed, id)).find((site) => site !== null)
  if (!ladderBuilt || !riverBridge) return finish('route', !ladderBuilt
    ? riverBridge
      ? 'Build or use a marked north cliff ladder with 4 logs, then return west to your saved connected-river bridge.'
      : 'Build or use a marked north cliff ladder with 4 logs, then carry 8 logs west to build a connected-river bridge at a Ready dry-bank site.'
    : 'Carry 8 logs up your saved north cliff ladder. Stay north of the cliff lip on the upper shelf, go west past the rock return, then turn south on revealed dry ground to the connected river. Follow its dry bank until a site is marked Ready. Build there, then cross.', pendingReward)

  return finish('survey',
    'Cross your saved connected-river bridge. Reach its revealed dry far-bank exit and use Survey at the River Works post.', pendingReward)
}
