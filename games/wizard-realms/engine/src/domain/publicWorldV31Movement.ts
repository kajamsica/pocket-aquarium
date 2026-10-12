import { samePublicV14Value } from './publicWorldV14Validation'
import { decodePublicV14FrameWitness } from './publicWorldV14Snapshot'
import type { PublicV14Frame } from './publicWorldV14Snapshot'
import { replayPublicV28FramesWithEvents } from './publicWorldV28Replay'
import { canonicalClaim, replayPublicV30FramesWithEvents,
  replayPublicV30Witness } from './publicWorldV30Snapshot'
import type { PublicV30Progress } from './publicWorldV30Migration'
import type { PublicV31Progress } from './publicWorldV31Migration'
import { decodePublicV31RaisedSoilCells } from './publicWorldV31Soil'
import { projectPublicV31Pose, publicV31EffectiveStepAccepted } from './publicWorldV31Support'
import { applyPublicV31ReturnHome } from './publicWorldV31Escape'
import type { PublicWorldEvent } from './publicWorldRuntime'

const EPSILON = 1e-6
const inherited = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId }: PublicV31Progress): PublicV30Progress =>
  ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds, miningTools, claimedBridgeheadId })

/** The old checked frame path remains a mandatory gate; V31 checks every effective step. */
export function replayPublicV31FramesWithEvents(before: PublicV31Progress,
  frames: readonly PublicV14Frame[], allowAirborne = false):
  { progress: PublicV31Progress; events: readonly PublicWorldEvent[] } | null {
  try {
    const cells = decodePublicV31RaisedSoilCells(before.raisedSoilCells)
    const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames })
    if (!cells || !witness || !canonicalClaim(inherited(before))
      || !projectPublicV31Pose(before)) return null
    if (cells.length === 0) {
      const old = inherited(before)
      if (!allowAirborne) {
        const checked = replayPublicV30FramesWithEvents(old, witness)
        return checked ? { progress: { ...checked.progress, raisedSoilCells: cells },
          events: checked.events } : null
      }
      const observed = replayPublicV28FramesWithEvents(old, witness.frames, true)
      return observed ? { progress: { ...observed.progress,
        miningTools: old.miningTools, claimedBridgeheadId: old.claimedBridgeheadId,
        raisedSoilCells: cells }, events: observed.events } : null
    }
    let current = before
    const events: PublicWorldEvent[] = []
    for (const frame of witness.frames) {
      const observed = replayPublicV28FramesWithEvents(current, [frame], allowAirborne)
      if (!observed) return null
      const next = { ...current, ...observed.progress }
      const startPose = projectPublicV31Pose(current), endPose = projectPublicV31Pose(next)
      if (!startPose || !endPose || !publicV31EffectiveStepAccepted(startPose,
        endPose, current.terrain)) return null
      current = next
      events.push(...observed.events)
    }
    if (!allowAirborne) {
      // A complete V30 replay remains mandatory, even when each V28 frame passed.
      const checked = replayPublicV30Witness(inherited(before), witness)
      const pose = projectPublicV31Pose(current)
      if (!checked || !samePublicV14Value(inherited(current), checked)
        || !pose || current.state.player.verticalVelocity !== 0
        || Math.abs(pose.effective.position.y - pose.effective.floorY) > EPSILON) return null
    }
    return { progress: current, events }
  } catch { return null }
}

/** V31-only escape checks the lifted top when inherited V30 still sees an exit. */
export function replayPublicV31ReturnHome(before: PublicV31Progress,
  atMs: number): PublicV31Progress | null {
  return applyPublicV31ReturnHome(before, atMs)
}
