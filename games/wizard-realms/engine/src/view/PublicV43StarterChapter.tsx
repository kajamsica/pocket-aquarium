import { publicV25StratumAt } from '../domain/publicWorldV25Strata'
import { resolvePublicV17GreenwaySite } from '../domain/publicWorldV17GreenwaySites'
import { projectPublicV43GreenwayQuestChain }
  from '../domain/publicWorldV43GreenwayQuestChain'
import type { PublicV43Progress } from '../domain/publicWorldV43Snapshot'

export type PublicV43StarterChapterStage = 'gather' | 'crossing' | 'spade'
  | 'dig' | 'soil-step' | 'carpenter-order' | 'complete'

export type PublicV43StarterChapterProjection = Readonly<{
  stage: PublicV43StarterChapterStage
  title: 'The Creekside Errand'
  objective: string
  progressLabel: string
  reward: string
  complete: boolean
}>

const title = 'The Creekside Errand' as const
const farBank = (gx: number, gz: number) => gz >= 4 && gz <= 8 && Math.abs(gx) <= 7

/** Chapter guidance only. Checked world actions remain the sole owners of rewards and saves. */
export function projectPublicV43StarterChapter(
  head: PublicV43Progress): PublicV43StarterChapterProjection {
  const creek = projectPublicV43GreenwayQuestChain(head).find((quest) =>
    quest.id === 'creek-span/v1')!
  const { state } = head
  const logs = state.player.inventory.reduce((sum, stack) =>
    sum + (stack.itemId === 'logs' ? stack.quantity : 0), 0)
  const bridgeBuilt = head.greenwayWorks.builtBridgeIds.some((id) => {
    const site = resolvePublicV17GreenwaySite(state.seed, id)
    return site?.kind === 'bridge' && site.obstacle === 'greenway_creek'
  })
  const rewardedFarBankDig = head.terrain.columns.some(({ gx, gz, rewardDepth }) =>
    farBank(gx, gz) && rewardDepth > 0
    && publicV25StratumAt(state.seed, gx, gz, 0).material === 'soil')
  const raisedFarBankStep = head.raisedSoilCells.some(({ gx, gz }) => farBank(gx, gz))
  const spadeEquipped = state.player.equipment.mainHand === 'field_spade'
    && state.player.inventory.some((stack) =>
      stack.itemId === 'field_spade' && stack.quantity > 0)
  const spadeOwned = state.player.inventory.some((stack) =>
    stack.itemId === 'field_spade' && stack.quantity > 0)
  const orderClaimed = head.greenwayOrder?.claimedAtSequence != null
  const step = (stage: PublicV43StarterChapterStage, number: number,
    objective: string, reward: string): PublicV43StarterChapterProjection => ({
    stage, title, objective, progressLabel: `Chapter step ${number} of 6`,
    reward, complete: false })

  if (!bridgeBuilt && logs < 8) return step('gather', 1, creek.objective,
    'Each felled oak gives 4 logs, 20 character XP, and 20 Woodcutting XP.')
  if (!bridgeBuilt || head.claimedBridgeheadId === null) return step('crossing', 2,
    creek.objective,
    head.claimedBridgeheadId === null
      ? 'Building gives 80 character XP and 80 Construction XP. The one-time River Works claim gives a basic pick, or 35 coins if you already own one.'
      : 'Building gives 80 character XP and 80 Construction XP. The one-time River Works claim was already used elsewhere.')
  if (!rewardedFarBankDig && !spadeEquipped) return step('spade', 3,
    spadeOwned
      ? 'Open Backpack and equip your field spade as the main-hand tool. Cross the saved creek bridge for the next task.'
      : 'Buy a field spade from Greenway Outfitters, then equip it from Backpack. Sell spare materials there if you need coins.',
    'Equipping has no payout. A first rewarded loam dig gives soil and Excavation XP.')
  if (!rewardedFarBankDig) return step('dig', 4,
    'Cross the creek bridge. With the field spade equipped, choose Terrain Dig and tap clear, revealed dry loam within 5 m on the far bank. One soil-bearing layer is enough.',
    'A rewarded soil dig gives 30 character XP, 30 Excavation XP, and 1 terrain-bag soil.')
  if (!raisedFarBankStep) return step('soil-step', 5,
    `${spadeEquipped ? '' : 'Equip the field spade. '}${head.terrain.bag.soil > 0
      ? 'Choose Terrain Place soil. Follow the far bank to a dry clearing beyond the protected bridge corridor, then tap a different clear, revealed cell within 5 m of where you stand.'
      : 'Your terrain bag has no soil. Dig another safe, revealed dry loam cell, then choose Terrain Place soil on a different clear far-bank cell within 5 m.'} Avoid the open dig hole, protected bridge corridor, and trees or other resource cells. One placement raises a 0.4 m step; it does not make a bridge.`,
    'Placing soil spends 1 terrain-bag soil. It gives no extra XP or coins.')
  if (!orderClaimed) return step('carpenter-order', 6,
    logs >= 4
      ? 'Return across the creek with 4 surplus logs. At Greenway Outfitters, open the store panel and deliver the one-time carpenter order.'
      : `Chop another nearby oak twice for 4 surplus logs (${logs}/4 carried), then return to Greenway Outfitters. Open the store panel and deliver the one-time carpenter order.`,
    'The carpenter order pays 10 coins and no character XP.')
  return { stage: 'complete', title,
    objective: 'The creek crossing, rewarded loam dig, raised far-bank step, and one-time carpenter order are recorded. Keep the step raised to keep this chapter complete.',
    progressLabel: 'Chapter complete, 6 of 6 steps',
    reward: 'World actions awarded Woodcutting, Construction, and Excavation XP. The one-time River Works find and 10-coin carpenter order were claimed through their own actions.',
    complete: true }
}

export function PublicV43StarterChapter({ head }: { head: PublicV43Progress }) {
  const chapter = projectPublicV43StarterChapter(head)
  return <section aria-label="Starter chapter" data-starter-chapter={chapter.stage}>
    <h2>Chapter 1: {chapter.title}</h2>
    <p><strong>{chapter.progressLabel}</strong></p>
    <p>{chapter.objective}</p>
    <p><small>{chapter.reward}</small></p>
    <p><small>Chapter instructions live in this journal. The Outfitters keeper is scenery for now; stand near the store and use its panel to buy supplies or deliver logs.</small></p>
    <p><small>Later: seek the north-cliff ladder, learn Wayfinder Glow, and follow the Sedgehorn trail.</small></p>
  </section>
}
