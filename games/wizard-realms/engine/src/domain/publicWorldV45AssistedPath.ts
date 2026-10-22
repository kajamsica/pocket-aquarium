import type { PublicV23StreamedMovePolicy } from './publicWorldV23Transitions'
import type { PublicV31Progress } from './publicWorldV31Migration'
import { projectPublicV31Pose, publicV31EffectiveStepAccepted } from './publicWorldV31Support'
import type { PublicWorldEvent } from './publicWorldRuntime'

type TwoSubstepAssistance = Extract<NonNullable<ReturnType<PublicV23StreamedMovePolicy>>,
  { substeps: unknown }>
type CheckedFrame = Readonly<{ progress: PublicV31Progress; events: readonly PublicWorldEvent[] }>

/** Additional V45 gate after one checked V31 frame. It never advances the simulation. */
export function publicV45AssistedPathSupported(before: PublicV31Progress,
  checked: CheckedFrame, assisted: TwoSubstepAssistance): boolean {
  try {
    const steps = assisted.substeps
    if (!Array.isArray(steps) || steps.length !== 2) return false
    const moves = checked.events.filter((event) => event.type === 'player_moved')
    if (moves.length !== 2) return false
    const [mid, final] = moves
    const tick = checked.progress.state.tick
    if (tick !== before.state.tick + 1 || mid.tick !== tick || final.tick !== tick
      || !Number.isSafeInteger(mid.sequence) || !Number.isSafeInteger(final.sequence)
      || mid.sequence <= before.state.eventSequence || final.sequence <= mid.sequence
      || final.sequence > checked.progress.state.eventSequence) return false
    const start = before.state.player.position
    const expectedMid = { x: start.x + steps[0].x, z: start.z + steps[0].z }
    const expectedFinal = { x: expectedMid.x + steps[1].x,
      z: expectedMid.z + steps[1].z }
    const terminal = checked.progress.state.player.position
    if (mid.position.x !== expectedMid.x || mid.position.z !== expectedMid.z
      || final.position.x !== expectedFinal.x || final.position.z !== expectedFinal.z
      || final.position.x !== terminal.x || final.position.y !== terminal.y
      || final.position.z !== terminal.z) return false
    const startPose = projectPublicV31Pose(before, start)
    const midPose = projectPublicV31Pose(before, mid.position)
    const finalPose = projectPublicV31Pose(before, final.position)
    return !!startPose && !!midPose && !!finalPose
      && publicV31EffectiveStepAccepted(startPose, midPose, before.terrain)
      && publicV31EffectiveStepAccepted(midPose, finalPose, before.terrain)
  } catch { return false }
}
