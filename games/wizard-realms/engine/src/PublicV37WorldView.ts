import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { highlandLandmark } from './domain/highlandContent'
import type { PublicV36MarkerProgress } from './domain/publicWorldV36MarkerAction'
import { projectPublicV31Pose } from './domain/publicWorldV31Support'
import { previewPublicV37WindwardAction } from './domain/publicWorldV37WindwardAction'
import type { WizardViewProjection } from './view/contracts'

/** Checked V37 action readiness replaces the inherited disabled V13 spell projection. */
export function projectPublicV37Windward(progress: PublicV36MarkerProgress,
  base: WizardViewProjection): WizardViewProjection {
  const { state } = progress, glyph = highlandLandmark(state.seed)
  const known = state.highland.landmarkDiscovered
    && discoveryMaskHasTileId(state.discoveryMask, glyph.tile.id)
  const pose = projectPublicV31Pose(progress)
  const grounded = !!pose && state.player.verticalVelocity === 0
    && Math.abs(pose.effective.position.y - pose.effective.floorY) <= 1e-6
  const activeSeconds = Math.ceil(Math.max(0, state.windstep.activeUntilTick - state.tick) / 20)
  const cooldownSeconds = Math.ceil(Math.max(0, state.windstep.nextCastTick - state.tick) / 20)
  return { ...base, windwardStep: { learned: state.windstep.learned,
    checkedActions: true,
    glyph: known ? { position: [glyph.tile.center.x, glyph.tile.center.y, glyph.tile.center.z],
      canStudy: previewPublicV37WindwardAction(progress, { kind: 'windward-study/v1' }).rejection === null } : null,
    activeSeconds: grounded ? activeSeconds : 0, cooldownSeconds,
    canCast: state.movementOwner === 'streamed' && previewPublicV37WindwardAction(progress, { kind: 'windward-cast/v1' }).rejection === null,
    ...(activeSeconds ? { unavailableReason: grounded
      ? `Charged for ${activeSeconds}s. Safe, revealed westbound walking steps gain 25% on the dry Highland trail.`
      : 'Windward Step is charged. Land on the dry Highland trail to use it.' } : {}),
    ...(base.windwardStep?.stoneReturn ? { stoneReturn: base.windwardStep.stoneReturn } : {}) } }
}
