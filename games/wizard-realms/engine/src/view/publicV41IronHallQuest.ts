import type { WizardViewProjection } from './contracts'
import type { PublicV41CombatRejection } from '../domain/publicWorldV41CombatAction'

export type PublicV41IronHallActionPreview = Readonly<{
  rejection: PublicV41CombatRejection | null
  hint: string | null
}>

const rejectionHint: Readonly<Record<PublicV41CombatRejection, string>> = {
  invalid_value: 'The checked action is unavailable right now.',
  invalid_progress: 'This save cannot safely perform the action.',
  requires_crossing: 'Cross and record the Waystation river bridge first.',
  wrong_region: 'Return to the Iron Hall area.',
  not_grounded: 'Stand on solid ground first.',
  unsafe_source: 'Move off water, raised soil, or an open pit.',
  unrevealed: 'Discover this part of Iron Hall first.',
  too_far: 'Move closer to the marked Hall site.',
  already_learned: 'Arc Bolt is already learned.',
  not_learned: 'Study Arc Bolt at the alcove first.',
  already_engaged: 'The ward is already engaged.',
  not_engaged: 'Engage the ward before using combat actions.',
  cooldown: 'Wait for the action cooldown to finish.',
  ward_defeated: 'The ward is already defeated.',
  cannot_rest: 'Rest at the alcove only when the ward is dormant.',
  already_full: 'Health is already full.',
}

export const publicV41IronHallRejectionHint = (rejection: PublicV41CombatRejection) =>
  rejectionHint[rejection]

export type PublicV41IronHallView = Readonly<{
  health: number
  wardHealth: number
  phase: 'dormant' | 'windup' | 'recovery' | 'defeated'
  phaseUntilTick: number
  learnedBolt: boolean
  wardDefeated: boolean
  study: PublicV41IronHallActionPreview
  engage: PublicV41IronHallActionPreview
  bolt: PublicV41IronHallActionPreview
  guard: PublicV41IronHallActionPreview
  rest: PublicV41IronHallActionPreview
}>

export type PublicV41IronHallQuest = Readonly<{
  id: 'iron-hall-watch/v1'
  title: 'Iron Hall Watch'
  stage: 'cross' | 'find' | 'study' | 'rest' | 'engage' | 'avoid' | 'strike' | 'defeated'
  next: string
  objective: string
  status: string
  complete: boolean
}>

/** A read-only battle cue. The V41 action and frame replay own all health and combat state. */
export function publicV41IronHallQuest(view: WizardViewProjection): PublicV41IronHallQuest | null {
  const hall = view.v41IronHall
  if (!hall) return null
  const remaining = Math.max(0, hall.phaseUntilTick - view.tick)
  const status = `Health ${hall.health}/12 · Ward ${hall.wardHealth}/9 · ${hall.phase === 'windup'
    ? `Slam in ${remaining} ticks` : hall.phase === 'recovery'
      ? `Ward recovering for ${remaining} ticks` : hall.wardDefeated ? 'Ward defeated' : 'Ward idle'}`
  const finish = (stage: PublicV41IronHallQuest['stage'], next: string,
    objective: string): PublicV41IronHallQuest => ({
    id: 'iron-hall-watch/v1', title: 'Iron Hall Watch', stage, next, objective, status,
    complete: stage === 'defeated',
  })
  if (hall.wardDefeated) return finish('defeated', 'Ward defeated',
    'The clockwork ward is defeated and stays defeated after reload. The quartermaster and armor reward belong to the next chapter.')
  if (view.v40WaystationQuest && !['return', 'complete'].includes(view.v40WaystationQuest.stage))
    return finish('cross', 'Repair the crossing',
      'Build the Waystation river bridge, reach its south bank, and record the crossing before approaching Iron Hall.')
  if (!view.v41IronHallSite?.revealed) return finish('find', 'Find the hall',
    'Follow the dry trail south of the repaired Waystation bridge to find the Iron Hall alcove.')
  if (!hall.learnedBolt) return finish('study', 'Study Arc Bolt',
    'At the dry alcove, study the runestone to learn Arc Bolt before confronting the ward.')
  if (hall.phase === 'windup') return finish('avoid', 'Avoid or guard the slam',
    `The ward is winding up. Leave its glowing 2.7 m ring or guard before the slam in ${remaining} ticks.`)
  if (hall.phase === 'recovery') return finish('strike', 'Strike during recovery',
    'The ward is recovering. Cast Arc Bolt from within 7 m when its checked cooldown is ready.')
  if (hall.health < 12) return finish('rest', 'Recover at the alcove',
    'Retreat to the dry alcove and rest to restore health, then engage the ward again.')
  return finish('engage', 'Engage the ward',
    'Approach the clockwork ward on dry ground and engage. Read its tell, dodge or guard, then cast Arc Bolt.')
}
