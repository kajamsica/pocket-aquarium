import type { PublicV23StreamedMovePolicy } from './publicWorldV23Transitions'
import type { PublicV31Progress } from './publicWorldV31Migration'
import { projectPublicV31Pose, publicV31EffectiveStepAccepted } from './publicWorldV31Support'
import { publicV43FamiliarTouchesForbiddenSupport,
  publicV43FamiliarTouchesUnrevealedCell } from './publicWorldV43FamiliarFollower'
import type { PublicWorldEvent } from './publicWorldRuntime'

type TwoSubstepAssistance = Extract<NonNullable<ReturnType<PublicV23StreamedMovePolicy>>,
  { substeps: unknown }>
type CheckedFrame = Readonly<{ progress: PublicV31Progress; events: readonly PublicWorldEvent[] }>

/** Additional V45 mounted dry-ride gate after one checked V31 frame. V44 riding
 * already forbids swept pits and soil lifts, including routes a walking player
 * could use. This is not a general V31 walking validator and never advances time. */
export function publicV45AssistedPathSupported(before: PublicV31Progress,
  checked: CheckedFrame, assisted: TwoSubstepAssistance): boolean {
  try {
    const steps = assisted.substeps
    if (!Array.isArray(steps) || steps.length !== 2) return false
    const moves = checked.events.filter((event) => event.type === 'player_moved')
    if (moves.length !== 2) return false
    const [mid, final] = moves
    const tick = checked.progress.state.tick
    if (before.state.movementOwner !== 'streamed'
      || checked.progress.state.movementOwner !== 'streamed'
      || tick !== before.state.tick + 1 || mid.tick !== tick || final.tick !== tick
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
    for (const [from, to] of [[start, mid.position], [mid.position, final.position]]) {
      if (publicV43FamiliarTouchesUnrevealedCell(before.state.discoveryMask, from, to)
        || publicV43FamiliarTouchesForbiddenSupport(before.state.seed, from, to,
          before.terrain.columns, before.raisedSoilCells)) return false
    }
    const startPose = projectPublicV31Pose(before, start)
    const midPose = projectPublicV31Pose(before, mid.position)
    const finalPose = projectPublicV31Pose(before, final.position)
    return !!startPose && !!midPose && !!finalPose
      && startPose.support === 'terrain' && midPose.support === 'terrain'
      && finalPose.support === 'terrain'
      && publicV31EffectiveStepAccepted(startPose, midPose, before.terrain)
      && publicV31EffectiveStepAccepted(midPose, finalPose, before.terrain)
  } catch { return false }
}
