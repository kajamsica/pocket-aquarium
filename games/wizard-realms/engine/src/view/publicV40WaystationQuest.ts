import type { WizardViewProjection } from './contracts'
import type { PublicV40WaystationRejection } from '../domain/publicWorldV40WaystationAction'

export type PublicV40WaystationActionPreview = Readonly<{
  rejection: PublicV40WaystationRejection | null
  hint: string | null
}>

export type PublicV40WaystationQuestFacts = Readonly<{
  timberBartered: boolean
  southbankReached: boolean
  waystationClaimed: boolean
  barter: PublicV40WaystationActionPreview
  cross: PublicV40WaystationActionPreview
  claim: PublicV40WaystationActionPreview
}>

export type PublicV40WaystationQuest = Readonly<{
  id: 'waystation-repair/v1'
  title: 'Windward Waystation'
  stage: 'find' | 'choose-materials' | 'build' | 'cross' | 'return' | 'complete'
  objective: string
  reward: string
  complete: boolean
  barter: PublicV40WaystationActionPreview
  cross: PublicV40WaystationActionPreview
  claim: PublicV40WaystationActionPreview
}>

const reward = 'Claim at Greenway Outfitters after crossing: 45 coins, 45 Wayfinding XP, and 45 character XP. The repaired bridge remains usable.'

const rejectionHint: Readonly<Record<PublicV40WaystationRejection, string>> = {
  invalid_value: 'The checked action is unavailable right now.',
  invalid_progress: 'This save cannot safely perform the action.',
  wrong_region: 'Move into the required area before trying again.',
  not_grounded: 'Stand still on solid ground before trying again.',
  unsafe_source: 'Move off water, raised soil, or an open pit.',
  unrevealed: 'Discover the crossing and its dry bank first.',
  too_far: 'Move within 3 m of the marked place.',
  already_bartered: 'The one-time stone barter was already used.',
  already_built: 'The bridge is already built.',
  not_owned: 'Carry two stone in your backpack or terrain bag.',
  capacity: 'Make backpack room for the barter logs after spending stone.',
  not_built: 'Build the marked bridge with B Works first.',
  already_crossed: 'The south-bank crossing was already recorded.',
  requires_crossing: 'Cross the bridge and record the far bank first.',
  already_claimed: 'The Waystation reward was already claimed.',
}

export const publicV40WaystationRejectionHint = (rejection: PublicV40WaystationRejection) =>
  rejectionHint[rejection]

/** Read-only cues. V40 checked actions and normal Works own every material and reward change. */
export function publicV40WaystationQuest(view: WizardViewProjection,
  facts: PublicV40WaystationQuestFacts): PublicV40WaystationQuest {
  const finish = (stage: PublicV40WaystationQuest['stage'], objective: string): PublicV40WaystationQuest => ({
    id: 'waystation-repair/v1', title: 'Windward Waystation', stage, objective, reward,
    complete: stage === 'complete', barter: facts.barter, cross: facts.cross, claim: facts.claim,
  })
  if (facts.waystationClaimed) return finish('complete',
    'Waystation repaired and reward claimed. The saved river bridge remains open for travel.')
  if (facts.southbankReached) return finish('return',
    'Return to Greenway Outfitters and claim the Waystation repair reward.')
  const site = view.v40WaystationSite
  if (!site?.revealed) return finish('find',
    'Follow the eastbound Highland trail to find the broken crossing at the river.')
  if (site.built) return finish('cross',
    'Cross the built river bridge to its dry south bank, then record the crossing there.')
  const logs = view.backpack.stacks.reduce((total, stack) => total +
    (stack.itemId === 'logs' ? stack.quantity : 0), 0)
  if (logs >= 8) return finish('build',
    'You have 8 logs. At the north bank, use normal B Works to build the marked river bridge.')
  if (facts.timberBartered) return finish('choose-materials',
    `The one-time stone barter is spent. Gather ${8 - logs} more logs, then build the marked bridge with B Works.`)
  const stones = view.backpack.stacks.reduce((total, stack) => total +
    (stack.itemId === 'stone' ? stack.quantity : 0), 0) + (view.v26TerrainBag?.stone ?? 0)
  return finish('choose-materials',
    `Choose materials: gather ${8 - logs} more logs, or barter 2 quarried stone at the north-bank stockpile (${stones}/2 stone carried across backpack and terrain bag). Then build with B Works.`)
}
