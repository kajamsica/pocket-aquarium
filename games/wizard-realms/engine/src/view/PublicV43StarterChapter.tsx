import { publicV25StratumAt } from '../domain/publicWorldV25Strata'
import { resolvePublicV17GreenwaySite } from '../domain/publicWorldV17GreenwaySites'
import { projectPublicV43GreenwayQuestChain }
  from '../domain/publicWorldV43GreenwayQuestChain'
import type { PublicV43Progress } from '../domain/publicWorldV43Snapshot'

export type PublicV43StarterChapterStage = 'gather' | 'crossing' | 'spade'
  | 'dig' | 'stone-find' | 'carpenter-order' | 'complete'

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
  const farBankLoamColumns = head.terrain.columns.filter(({ gx, gz }) =>
    farBank(gx, gz) && publicV25StratumAt(state.seed, gx, gz, 0).material === 'soil')
  const rewardedFarBankDig = farBankLoamColumns.some(({ rewardDepth }) => rewardDepth > 0)
  const rewardedFarBankStone = farBankLoamColumns.some(({ gx, gz, rewardDepth }) =>
    rewardDepth > 2 && publicV25StratumAt(state.seed, gx, gz, 2).material === 'stone')
  const exposedFarBankStone = farBankLoamColumns.some(({ openDepth }) => openDepth >= 2)
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
    'Cross the creek bridge. With the field spade equipped, choose Terrain Dig and tap clear, revealed dry loam within 5 m on the far bank. This is the first of two soil layers in the same column.',
    'A rewarded soil dig gives 30 character XP, 30 Excavation XP, and 1 terrain-bag soil.')
  if (!rewardedFarBankStone) return step('stone-find', 5,
    exposedFarBankStone
      ? `${head.miningTools.activePick === null
        ? head.miningTools.basicPickOwned
          ? 'Open Backpack, then Mining tools, and equip your basic pick. '
          : 'Get a basic pick at Greenway Outfitters and equip it from Backpack. '
        : ''}Choose Terrain Mine and tap that same clear, revealed dry far-bank loam column within 5 m to uncover stone.`
      : `${spadeEquipped ? '' : 'Equip the field spade. '}Continue Terrain Dig on the same safe, revealed dry far-bank loam column until both soil layers are open. If you filled the hole, reopen those layers first. Then equip your basic pick from Backpack, choose Terrain Mine, and tap that column.`,
    'The first checked stone find gives 30 character XP, 30 Excavation XP, and 1 terrain-bag stone. Placing soil is optional; Outfitters buys stone for 3 coins.')
  if (!orderClaimed) return step('carpenter-order', 6,
    logs >= 4
      ? 'Return across the creek with 4 surplus logs. At Greenway Outfitters, open the store panel and deliver the one-time carpenter order.'
      : `Chop another nearby oak twice for 4 surplus logs (${logs}/4 carried), then return to Greenway Outfitters. Open the store panel and deliver the one-time carpenter order.`,
    'The carpenter order pays 10 coins and no character XP.')
  return { stage: 'complete', title,
    objective: 'The creek crossing, rewarded loam dig, first far-bank stone find, and one-time carpenter order are recorded. Placing soil remains optional.',
    progressLabel: 'Chapter complete, 6 of 6 steps',
    reward: 'World actions awarded Woodcutting, Construction, and Excavation XP. The one-time River Works find, terrain-bag stone, and 10-coin carpenter order were earned through their own actions.',
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
