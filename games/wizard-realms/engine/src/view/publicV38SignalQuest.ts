import { highlandSignalVane } from '../domain/highlandSignalContent'
import type { WizardViewProjection } from './contracts'

export type PublicV38SignalActionPreview = Readonly<{
  rejection: string | null
  hint: string | null
}>

export type PublicV38SignalQuestFacts = Readonly<{
  signalVantageInspected: boolean
  signalClaimed: boolean
  practicedRouteIndices: readonly number[]
  inspect: PublicV38SignalActionPreview
  claim: PublicV38SignalActionPreview
}>

export type PublicV38SignalQuest = Readonly<{
  id: 'highland-signal/v1'
  title: 'Highland Signal'
  stage: 'study' | 'cast' | 'cross' | 'vane' | 'return' | 'complete'
  objective: string
  reward: string
  complete: boolean
  inspect: PublicV38SignalActionPreview
  claim: PublicV38SignalActionPreview
}>

const reward = 'Claim at Quarry Crown: 30 coins, 35 Spellcraft XP, 35 character XP, and a saved Stormline Foothill map bearing. The bearing is a clue, not revealed terrain.'

/** Journal copy only. Checked witnesses, movement, and rewards belong to the V38 writer. */
export function publicV38SignalQuest(view: WizardViewProjection,
  facts: PublicV38SignalQuestFacts): PublicV38SignalQuest {
  const finish = (stage: PublicV38SignalQuest['stage'], objective: string): PublicV38SignalQuest => ({
    id: 'highland-signal/v1', title: 'Highland Signal', stage, objective, reward,
    complete: stage === 'complete', inspect: facts.inspect, claim: facts.claim,
  })
  if (facts.signalClaimed) return finish('complete',
    'The Signal reward was claimed at Quarry Crown. Follow the saved Stormline Foothill bearing on the map to explore further.')
  if (facts.signalVantageInspected) {
    const crown = view.landmarks?.find((landmark) => landmark.kind === 'quarry-crown')
    const nearCrown = crown && Math.hypot(view.player.position[0] - crown.position[0],
      view.player.position[2] - crown.position[2]) < 12
    return finish('return', nearCrown
      ? 'At Quarry Crown, use Claim to collect the checked Signal reward.'
      : 'Return along the dry Highland trail to Quarry Crown, then claim the Signal reward.')
  }
  if (!view.windwardStep?.learned) return finish('study',
    'Find Quarry Crown on the dry Highland trail and study its wind-cut glyph to learn Windward Step.')
  const approach = highlandSignalVane(view.seed).routeIndex
  if (!facts.practicedRouteIndices.some((index) => index >= approach - 3 && index <= approach + 1)) {
    return view.windwardStep.activeSeconds > 0
      ? finish('cross', 'Windward Step is active. Walk the dry Highland trail toward the signal vane; a real assisted crossing is required.')
      : finish('cast', 'Cast Windward Step on the dry Highland trail, then walk its supported route toward the signal vane.')
  }
  const vane = view.v38SignalVane?.position
  const nearVane = vane && Math.hypot(view.player.position[0] - vane[0],
    view.player.position[2] - vane[2]) < 12
  return finish('vane', nearVane
    ? 'At the signal vane, use Inspect while Windward Step is active.'
    : 'Follow the dry Highland trail to its signal vane, then inspect it while Windward Step is active.')
}
