import { discoveryMaskHasTileId } from './discoveryMask'
import { highlandCorridorCells } from './highlandContent'
import { HIGHLAND_WINDWARD_STEP, highlandWindTrailLocation,
  isHighlandWindWestboundTrailStep } from './highlandWindContent'
import { decodePublicV14FrameWitness } from './publicWorldV14Snapshot'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import type { PublicV23StreamedMovePolicy } from './publicWorldV23Transitions'
import { publicV25RiverTouchesSegment } from './publicWorldV25RiverSweep'
import { publicV26SavedLadderSpans } from './publicWorldV26Snapshot'
import { publicV26ValleyRimPassage } from './publicWorldV26ValleyRim'
import { replayPublicV31FramesWithEvents } from './publicWorldV31Movement'
import { projectPublicV31Pose, publicV31EffectiveStepAccepted } from './publicWorldV31Support'
import type { PublicV36MarkerProgress } from './publicWorldV36MarkerAction'
import { decodePublicV37WindwardProgress,
  PUBLIC_V37_PROGRESS_KEYS } from './publicWorldV37WindwardAction'

/** Shared private policy for durable replay and provisional whole-batch observation. */
function replayFrames(before: PublicV36MarkerProgress,
  rawWitness: unknown, allowAirborne: boolean): PublicV36MarkerProgress | null {
  try {
    const witness = decodePublicV14FrameWitness(rawWitness)
    // V37's checked progress decoder covers the inherited state; newer callers carry overlays.
    const checked = witness && decodePublicV37WindwardProgress(Object.fromEntries(
      PUBLIC_V37_PROGRESS_KEYS.map((key) => [key, before[key]])))
    if (!witness || !checked) return null
    const policy: PublicV23StreamedMovePolicy = (current, frame) => {
      const progress = { ...checked, ...current }, { state } = progress
      const move = frame.intents.find((intent) => intent.type === 'move')
      const length = move?.type === 'move' ? Math.hypot(move.delta.x, move.delta.z) : 0
      const pose = projectPublicV31Pose(progress)
      if (!move || move.type !== 'move' || length === 0 || length > 0.16 + 1e-9
        || !state.windstep.learned || state.tick >= state.windstep.activeUntilTick
        || state.movementOwner !== 'streamed' || state.player.verticalVelocity !== 0
        || !pose || pose.support !== 'terrain'
        || Math.abs(pose.effective.position.y - pose.effective.floorY) > 1e-6) return null
      const from = state.player.position, start = highlandWindTrailLocation(from)
      const normal = { x: from.x + move.delta.x, z: from.z + move.delta.z }
      const rawEnd = { x: from.x + move.delta.x * HIGHLAND_WINDWARD_STEP.speedMultiplier,
        z: from.z + move.delta.z * HIGHLAND_WINDWARD_STEP.speedMultiplier }
      const vertex = start && highlandCorridorCells()[start.segmentIndex]
      const end = vertex && Math.hypot(rawEnd.x - vertex.x, rawEnd.z - vertex.z) <= 1e-9
        ? vertex : rawEnd
      const arrival = highlandWindTrailLocation(end), normalEnd = highlandWindTrailLocation(normal)
      if (!start || !arrival || !normalEnd
        || start.routeMeters - normalEnd.routeMeters < length * 0.9
        || start.routeMeters - arrival.routeMeters < length * 0.9
        || arrival.segmentIndex < start.segmentIndex
          && arrival.deviationMeters > start.deviationMeters + 1e-9
        || !isHighlandWindWestboundTrailStep(state.seed, from, normal)
        || !isHighlandWindWestboundTrailStep(state.seed, from, end)
        || publicV25RiverTouchesSegment(state.seed, from, end)) return null
      const spans = publicV26SavedLadderSpans(current)
      if (!spans || !publicV26ValleyRimPassage(state.seed, from, end, spans).ok) return null
      let previousPose = pose
      for (const point of [from, { x: (from.x + end.x) / 2,
        z: (from.z + end.z) / 2 }, end]) {
        const floor = resolvePublicV23Surface(state, point, progress.regionalWorks.builtLadderIds)
        if (!floor || !discoveryMaskHasTileId(state.discoveryMask, floor.tileId)) return null
        const sample = projectPublicV31Pose(progress, { ...point, y: floor.floorY })
        if (!sample || sample.support !== 'terrain'
          || progress.terrain.columns.some((column) => column.openDepth > 0
            && column.gx === sample.cell.gx && column.gz === sample.cell.gz)
          || !publicV31EffectiveStepAccepted(previousPose, sample, progress.terrain)) return null
        previousPose = sample
      }
      return { delta: { x: end.x - from.x, z: end.z - from.z }, settle: (after) => {
        const actual = after.state.player.position, windstep = after.state.windstep
        const landed = projectPublicV31Pose({ ...progress, ...after })
        // Credit only realized, grounded segment crossings, retaining V12's once-only ledger.
        if (Math.abs(actual.x - end.x) > 1e-9 || Math.abs(actual.z - end.z) > 1e-9
          || after.state.player.verticalVelocity !== 0 || !landed
          || Math.abs(landed.effective.position.y - landed.effective.floorY) > 1e-6
          || arrival.segmentIndex >= start.segmentIndex
          || windstep.practicedRouteIndices.includes(arrival.segmentIndex)) return after
        const indices = [...windstep.practicedRouteIndices, arrival.segmentIndex].sort((a, b) => a - b)
        const reward = indices.length % 4 === 0 ? 1 : 0, player = after.state.player
        const xp = player.xp + reward, spellcraft = player.skillXp.spellcraft + reward
        const eventSequence = after.state.eventSequence + reward
        if (![xp, spellcraft, eventSequence].every(Number.isSafeInteger)) throw new RangeError('Windward XP overflow')
        return { ...after, state: { ...after.state, eventSequence,
          windstep: { ...windstep, practicedRouteIndices: indices },
          player: { ...player, xp, level: 1 + Math.floor(xp / 100),
            skillXp: { ...player.skillXp, spellcraft } } } }
      } }
    }
    const next = replayPublicV31FramesWithEvents(checked, witness.frames, allowAirborne, policy)?.progress
    return next ? { ...next, ledgerSurveyBridgeId: checked.ledgerSurveyBridgeId,
      ledgerClaimReward: checked.ledgerClaimReward, markerClaimReward: checked.markerClaimReward } : null
  } catch { return null }
}

/** Normal witnesses stay unchanged. Only this version derives an assisted impulse. */
export function replayPublicV37FrameBatch(before: PublicV36MarkerProgress,
  rawWitness: unknown): PublicV36MarkerProgress | null {
  return replayFrames(before, rawWitness, false)
}

/** Always replay the whole pending batch from its committed, grounded origin. */
export function previewPublicV37FrameBatch(before: PublicV36MarkerProgress,
  rawWitness: unknown): PublicV36MarkerProgress | null {
  const strict = replayPublicV37FrameBatch(before, rawWitness)
  if (strict) return strict
  const observed = replayFrames(before, rawWitness, true)
  const pose = observed && projectPublicV31Pose(observed)
  return observed && pose && (observed.state.player.verticalVelocity !== 0
    || Math.abs(pose.effective.position.y - pose.effective.floorY) > 1e-6) ? observed : null
}
