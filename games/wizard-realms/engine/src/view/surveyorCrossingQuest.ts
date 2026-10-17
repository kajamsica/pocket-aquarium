import { resolvePublicV17GreenwaySite } from '../domain/publicWorldV17GreenwaySites'
import { resolvePublicV28RiverBridge } from '../domain/publicWorldV28RiverBridgeSites'
import type { PublicV16GreenwayWorks } from '../domain/publicWorldV16Migration'
import type { WizardViewProjection } from './contracts'

export type SurveyorCrossingQuest = Readonly<{
  id: 'surveyor-first-find/v1'
  title: "The Surveyor's First Find"
  stage: 'gather' | 'build' | 'cross' | 'claim' | 'complete'
  objective: string
  reward: string
  complete: boolean
}>

/** Read-only V34 journal state. The checked works and claim remain the only authority. */
export function surveyorCrossingQuest(view: WizardViewProjection,
  works: Pick<PublicV16GreenwayWorks, 'builtBridgeIds'>,
  riverBridgeIds: readonly string[],
  claimedBridgeheadId: string | null): SurveyorCrossingQuest {
  const base = { id: 'surveyor-first-find/v1', title: "The Surveyor's First Find" } as const
  const finish = (stage: SurveyorCrossingQuest['stage'], objective: string,
    reward: string): SurveyorCrossingQuest => ({ ...base, stage, objective, reward,
      complete: stage === 'complete' })
  const actionXp = 'Chopping oaks earns Woodcutting XP; building a bridge earns Construction XP.'
  const creekBridges = works.builtBridgeIds.map((id) =>
    resolvePublicV17GreenwaySite(view.seed, id)).filter((site) => site?.kind === 'bridge')
  const riverBridges = riverBridgeIds.map((id) =>
    resolvePublicV28RiverBridge(view.seed, id)).filter((site) => site !== null)
  const bridges = [...creekBridges, ...riverBridges]
  if (claimedBridgeheadId !== null && bridges.some((site) => site.id === claimedBridgeheadId))
    return finish('complete',
      'The surveyor’s one-time River Works find is claimed. Your saved bridge remains open for the next journey.',
      `${actionXp} The saved claim does not say whether the find awarded a basic pick or 35 coins.`)
  const findReward = 'The one-time River Works find grants a basic pick, or 35 coins if you already own one.'

  const logs = view.backpack.stacks.reduce((total, stack) =>
    total + (stack.itemId === 'logs' ? stack.quantity : 0), 0)
  const bridge = bridges.find((site) => site.id === view.v30Bridgehead?.bridgeId)
    ?? bridges[0]
  if (bridge) {
    const post = view.v30Bridgehead?.bridgeId === bridge.id ? view.v30Bridgehead : null
    const reward = post?.claimReady && post.reward
      ? `${actionXp} Claiming this find grants ${post.reward === 'coins' ? '35 coins' : 'a basic pick'}.`
      : `${actionXp} ${findReward}`
    if (post && view.player.position[2] > bridge.to.z) return finish('claim', post.claimReady
      ? 'At the River Works post on the dry far bank, use Claim to collect its one-time find.'
      : 'Follow the dry far-bank exit to the River Works post, approach it, then use Claim.', reward)
    return finish('cross', bridge.obstacle === 'connected_river'
      ? 'Return to your saved connected-river bridge. Follow its deck to the dry far-bank exit and find the surveyor’s post.'
      : 'Return to your saved Greenway creek bridge. Follow its deck to the dry far-bank exit and find the surveyor’s post.', reward)
  }
  const equipAxe = view.equipment.mainHand?.itemId !== 'woodcutters_axe'
    && view.backpack.stacks.some((stack) => stack.itemId === 'woodcutters_axe' && stack.quantity > 0)
    ? 'Equip Woodcutter axe from Backpack. ' : ''
  const magicCue = view.learnedSpellIds.includes('wayfinder_glow')
    ? 'cast Glow near fog'
    : 'study nearby waystone, then cast Glow near fog'
  return logs >= 8
    ? finish('build', 'Find a marked Ready dry-bank bridge site in Greenway. Open Works and build its crossing with 8 logs.', `${actionXp} ${findReward}`)
    : finish('gather', `${equipAxe}Chop oaks for ${8 - logs} more ${8 - logs === 1 ? 'log' : 'logs'} (${logs}/8) for a creek bridge. Optional: ${magicCue}; bridge still needed.`, `${actionXp} ${findReward}`)
}
