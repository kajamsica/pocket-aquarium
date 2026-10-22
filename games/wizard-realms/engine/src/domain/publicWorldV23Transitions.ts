import { decodePublicV14FrameWitness } from './publicWorldV14Snapshot'
import type { PublicV14FrameWitness } from './publicWorldV14Snapshot'
import { createPublicV17ContinuousSession,
  createPublicV17SessionFromDecodedV23 } from './publicWorldV17ContinuousSession'
import type { PublicV17GroundStepPolicy } from './publicWorldV17StarterMovement'
import { createFreshPublicV17Lineage } from './publicWorldV17Snapshot'
import { advancePublicV17GreenwayAction } from './publicWorldV17GreenwayFrame'
import { confirmPublicV17GreenwayWork } from './publicWorldV17GreenwayWork'
import { confirmPublicV14TerrainWork } from './publicWorldV14TerrainWork'
import { createPublicV23StreamTerrain, resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV14InsideGreenway } from './publicWorldV14Boundary'
import { publicV11Gait } from './publicWorldGait'
import { discoveryMaskHasTileId, encodeDiscoveredTileIds } from './discoveryMask'
import { settleTradeListings, stepRng } from './world'
import { confirmPublicV23Work, decodePublicV23Progress, exactPublicV23 } from './publicWorldV23Snapshot'
import type { PublicV23Progress, PublicV23Witness } from './publicWorldV23Snapshot'
import { publicV23CorridorsOverlap, publicV23WorkCorridor, resolvePublicV23Site } from './publicWorldV23Sites'
import type { PublicWorldEvent, PublicWorldRejection } from './publicWorldRuntime'
import type { StreamedWorldIntent } from './streamedWorld'

const MAX_TERMINAL_DRY_DESCENT_METERS = 0.10

/** Trusted version policy, never decoded from a witness. Ordinary gait is checked first. */
export type PublicV23StreamedMovePolicy = (before: PublicV23Progress,
  frame: PublicV14FrameWitness['frames'][number]) => (
    | Readonly<{ delta: Readonly<{ x: number; z: number }>
      settle: (after: PublicV23Progress) => PublicV23Progress }>
    | Readonly<{ substeps: readonly [Readonly<{ x: number; z: number }>,
      Readonly<{ x: number; z: number }>]
      settle: (after: PublicV23Progress) => PublicV23Progress }>
  ) | null

const actionKeys = {
  equip_item: ['itemId', 'slot'], unequip_item: ['slot'], harvest: ['resourceId'],
  buy_store_listing: ['storeId', 'listingId'], sell_to_store: ['storeId', 'itemId', 'quantity'],
  build_route: ['routeId', 'siteId'], study_inscription: ['inscriptionId'], cast_spell: ['spellId'],
} as const

export function decodePublicV23Witness(value: unknown): PublicV23Witness | null {
  try {
    const frames = decodePublicV14FrameWitness(value)
    if (frames) return frames
    if (exactPublicV23(value, ['kind']) && value.kind === 'checkpoint') return { kind: 'checkpoint' }
    if (exactPublicV23(value, ['kind', 'id']) && (value.kind === 'regional-work' || value.kind === 'legacy-work')
      && typeof value.id === 'string' && value.id.length <= 160) return { kind: value.kind, id: value.id }
    if (!exactPublicV23(value, ['kind', 'intent']) || value.kind !== 'legacy-action') return null
    const intent = value.intent
    if (!intent || typeof intent !== 'object') return null
    const type = Object.getOwnPropertyDescriptor(intent, 'type')?.value
    if (!Object.hasOwn(actionKeys, type)) return null
    const fields = actionKeys[type as keyof typeof actionKeys]
    if (!exactPublicV23(intent, ['type', ...fields]) || !fields.every((field) => field === 'quantity'
      ? Number.isSafeInteger(intent[field]) && (intent[field] as number) > 0
      : typeof intent[field] === 'string' && intent[field].length > 0 && intent[field].length <= 160)) return null
    return structuredClone(value) as PublicV23Witness
  } catch { return null }
}

export function publicV23LegacyWorkOccupied(progress: PublicV23Progress, id: string): boolean {
  const corridor = publicV23WorkCorridor(progress.state.seed, id)
  return !!corridor && progress.regionalWorks.builtLadderIds.some((built) => {
    const site = resolvePublicV23Site(progress.state.seed, built)
    return !site || publicV23CorridorsOverlap(site.corridor, corridor)
  })
}

/** Replays intentions, including discovery and clock effects; never accepts a proposed pose.
 * allowAirborne is a view-only result. Durable dispatch always leaves it false.
 */
export function advancePublicV23Frames(before: PublicV23Progress,
  frames: PublicV14FrameWitness['frames'], allowAirborne = false): PublicV23Progress | null {
  return framesResult(before, frames, allowAirborne).progress
}

/** Observe replay once per accepted frame. Airborne output is view-only, never a durable save. */
export function visitPublicV23Frames(before: PublicV23Progress,
  frames: PublicV14FrameWitness['frames'],
  visit: (beforeFrame: PublicV23Progress, afterFrame: PublicV23Progress) => boolean,
  allowAirborne = false, policy?: PublicV17GroundStepPolicy): PublicV23Progress | null {
  return framesResult(before, frames, allowAirborne, visit, policy).progress
}

/** Versioned callers may retain authoritative events from the same checked frame replay. */
export function visitPublicV23FramesWithEvents(before: PublicV23Progress,
  frames: PublicV14FrameWitness['frames'],
  visit: (beforeFrame: PublicV23Progress, afterFrame: PublicV23Progress) => boolean,
  allowAirborne = false, policy?: PublicV17GroundStepPolicy,
  streamedMove?: PublicV23StreamedMovePolicy):
  { progress: PublicV23Progress; events: PublicWorldEvent[] } | null {
  const result = framesResult(before, frames, allowAirborne, visit, policy, streamedMove)
  return result.progress ? { progress: result.progress, events: result.events } : null
}

/** Read-only local preview; diagnostics come from the same replay used by the checked writer. */
export function previewPublicV23Frames(before: PublicV23Progress,
  frames: PublicV14FrameWitness['frames'], allowAirborne = false) {
  const { progress, rejection, rejectedFrameIndex } = framesResult(before, frames, allowAirborne)
  return { progress, rejection, rejectedFrameIndex }
}

function framesResult(before: PublicV23Progress, frames: PublicV14FrameWitness['frames'], allowAirborne = false,
  visit?: (beforeFrame: PublicV23Progress, afterFrame: PublicV23Progress) => boolean,
  policy?: PublicV17GroundStepPolicy, streamedMove?: PublicV23StreamedMovePolicy):
  { progress: PublicV23Progress | null; events: PublicWorldEvent[];
    rejection: PublicWorldRejection | null; rejectedFrameIndex: number | null } {
  const failed = (rejection: PublicWorldRejection | null = null, rejectedFrameIndex: number | null = null) =>
    ({ progress: null, events: [], rejection, rejectedFrameIndex })
  try {
    let progress = decodePublicV23Progress(before, before.state.seed)
    const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames })
    if (!progress || !witness) return failed()
    let legacy: ReturnType<typeof createPublicV17ContinuousSession> | null = null
    let stream: ReturnType<typeof createPublicV23StreamTerrain> | null = null
    const events: PublicWorldEvent[] = []
    for (const [frameIndex, frame] of witness.frames.entries()) {
      const previous = progress
      const old: PublicV23Progress['state'] = progress.state
      const move = frame.intents.find((intent) => intent.type === 'move')
      const crossing = move?.type === 'move' && publicV14InsideGreenway({
        x: old.player.position.x + move.delta.x, z: old.player.position.z + move.delta.z })
        !== publicV14InsideGreenway(old.player.position)
      if (old.movementOwner === 'greenway' || crossing) {
        legacy ??= frameIndex === 0 && old.movementOwner === 'greenway' && !crossing
          ? createPublicV17SessionFromDecodedV23({ state: old,
            greenwayWorks: progress.greenwayWorks }, old.seed, 1, policy)
          : createPublicV17ContinuousSession({ state: old, greenwayWorks: progress.greenwayWorks,
            saveRevision: 1, lineage: createFreshPublicV17Lineage(old.seed) }, policy)
        const result = legacy.advanceFrame(frame.intents, { walkRequested: frame.walkRequested })
        if (result.rejections.length) return failed(result.rejections[0], frameIndex)
        events.push(...result.events)
        progress = { ...legacy.previewSnapshot(), regionalWorks: progress.regionalWorks }
        stream = null
        if (progress.state.movementOwner === 'streamed') legacy = null
        if (visit && !visit(previous, progress)) return failed()
        continue
      }
      if (move?.type === 'move' && Math.hypot(move.delta.x, move.delta.z)
        > publicV11Gait(old.player.equipment.feet, frame.walkRequested).metersPerStep + 1e-9) return failed()
      const assisted: ReturnType<PublicV23StreamedMovePolicy> = move?.type === 'move'
        ? streamedMove?.(progress, frame) ?? null : null
      if (assisted) {
        if ('delta' in assisted) {
          if (!Number.isFinite(assisted.delta.x) || !Number.isFinite(assisted.delta.z)
            || Math.hypot(assisted.delta.x, assisted.delta.z) > 0.2 + 1e-9) return failed()
        } else {
          const raw = move?.type === 'move' ? move.delta : null
          const rawLength = raw ? Math.hypot(raw.x, raw.z) : 0
          const steps = assisted.substeps
          if (!raw || !Number.isFinite(rawLength) || rawLength <= 0
            || !Array.isArray(steps) || steps.length !== 2) return failed()
          const lengths = steps.map((step) => Math.hypot(step.x, step.z))
          if (steps.some((step, index) => !Number.isFinite(step.x) || !Number.isFinite(step.z)
            || !Number.isFinite(lengths[index]) || lengths[index] <= 0 || lengths[index] > 0.2 + 1e-9
            || raw.x * step.x + raw.z * step.z <= 0
            || Math.abs(raw.x * step.z - raw.z * step.x) > 1e-8 * rawLength * lengths[index])
            || lengths[0] + lengths[1] > Math.min(0.4, rawLength * 5 / 3) + 1e-9) return failed()
          const from = old.player.position
          const between = { x: from.x + steps[0].x, z: from.z + steps[0].z }
          const to = { x: between.x + steps[1].x, z: between.z + steps[1].z }
          if (publicV14InsideGreenway(from) !== publicV14InsideGreenway(between)
            || publicV14InsideGreenway(from) !== publicV14InsideGreenway(to)) return failed()
        }
      }
      const intents = assisted ? frame.intents.flatMap<StreamedWorldIntent>((intent) => intent.type !== 'move'
        ? [intent as StreamedWorldIntent]
        : 'delta' in assisted ? [{ ...intent, delta: assisted.delta }]
          : assisted.substeps.map((delta) => ({ ...intent, delta }))) : frame.intents
      stream ??= createPublicV23StreamTerrain(old, progress.regionalWorks.builtLadderIds)
      const result = stream.advance(intents as StreamedWorldIntent[],
        { atomicOnRejection: true, nearbyDiscovery: true })
      if (result.rejections.length) {
        const rejection = result.rejections[0]
        return failed({ ...rejection,
          message: `Streamed movement was rejected: ${rejection.code}.` }, frameIndex)
      }
      // Only a newly accepted terminal base-terrain descent may settle. Earlier frame
      // events and the cached stream retain their original physics witness.
      const target = result.state.player.position
      const sourceFloor: ReturnType<typeof resolvePublicV23Surface> = !allowAirborne
        && frameIndex === witness.frames.length - 1 && move?.type === 'move'
        && old.player.verticalVelocity === 0
        ? resolvePublicV23Surface(old, old.player.position, progress.regionalWorks.builtLadderIds) : null
      const targetFloor: ReturnType<typeof resolvePublicV23Surface> = sourceFloor
        ? resolvePublicV23Surface(old, target, progress.regionalWorks.builtLadderIds) : null
      const drop = sourceFloor && targetFloor ? sourceFloor.floorY - targetFloor.floorY : 0
      const settledPosition: PublicV23Progress['state']['player']['position'] | null =
        sourceFloor?.support === 'terrain' && targetFloor?.support === 'terrain'
        && sourceFloor.tileId !== targetFloor.tileId && drop > 0
        && drop <= MAX_TERMINAL_DRY_DESCENT_METERS
        && Math.abs(old.player.position.y - sourceFloor.floorY) <= 1e-6
        && result.state.player.verticalVelocity >= -0.5
        && result.state.player.verticalVelocity < 0
        && target.y >= targetFloor.floorY - 1e-6
        && target.y - targetFloor.floorY <= MAX_TERMINAL_DRY_DESCENT_METERS
        ? { ...target, y: targetFloor.floorY } : null
      const movedPlayer: typeof result.state.player = settledPosition ? { ...result.state.player,
        position: settledPosition, verticalVelocity: 0 } : result.state.player
      let sequence = old.eventSequence
      const added: string[] = []
      for (const event of result.events) {
        if (event.type === 'tile_discovered') {
          if (discoveryMaskHasTileId(old.discoveryMask, event.tileId)) continue
          added.push(event.tileId)
        }
        events.push({ ...event, ...(settledPosition && event.type === 'player_moved'
          ? { position: settledPosition } : {}), sequence: ++sequence } as PublicWorldEvent)
      }
      const tick = old.tick + 1, mask = new Uint8Array(old.discoveryMask)
      const bits = encodeDiscoveredTileIds(added)
      for (let index = 0; index < mask.length; index++) mask[index] |= bits[index]
      const sale = settleTradeListings({ ...old.player, ...movedPlayer }, tick, sequence)
      if (![tick, sale.eventSequence].every(Number.isSafeInteger)) return failed()
      events.push(...sale.events)
      progress = { ...progress, state: { ...old, tick, eventSequence: sale.eventSequence,
        rng: { ...old.rng, simulation: stepRng(old.rng.simulation) }, discoveryMask: mask, player: sale.player } }
      if (assisted) {
        const settled: PublicV23Progress = assisted.settle(progress)
        if (settled !== progress) stream = null
        progress = settled
      }
      if (visit && !visit(previous, progress)) return failed()
    }
    const validated = allowAirborne ? progress : decodePublicV23Progress(progress, before.state.seed)
    return validated ? { progress: validated, events, rejection: null, rejectedFrameIndex: null } : failed()
  } catch { return failed() }
}

export function applyPublicV23Witness(before: PublicV23Progress, rawWitness: unknown):
  { progress: PublicV23Progress; events: readonly PublicWorldEvent[] } | { rejection: string } {
  const witness = decodePublicV23Witness(rawWitness)
  const owned = decodePublicV23Progress(before, before?.state?.seed)
  if (!witness || !owned) return { rejection: 'invalid-witness' }
  if (witness.kind === 'checkpoint') return { progress: owned, events: [] }
  if (witness.kind === 'frame-batch/v1') {
    const result = framesResult(owned, witness.frames)
    return result.progress ? { progress: result.progress, events: result.events } : { rejection: 'frame-rejected' }
  }
  if (witness.kind === 'regional-work') {
    const result = confirmPublicV23Work(owned, witness.id)
    return 'progress' in result ? { progress: result.progress, events: [] } : result
  }
  let candidate: PublicV23Progress | null = null, events: readonly PublicWorldEvent[] = []
  if (witness.kind === 'legacy-work') {
    if (publicV23LegacyWorkOccupied(owned, witness.id)) return { rejection: 'occupied' }
    if (owned.state.movementOwner === 'greenway') {
      const result = confirmPublicV17GreenwayWork({ state: owned.state, greenwayWorks: owned.greenwayWorks }, witness.id)
      if (!result.progress) return { rejection: result.rejection }
      candidate = { ...result.progress, regionalWorks: owned.regionalWorks }
    } else {
      const result = confirmPublicV14TerrainWork(owned.state, witness.id)
      if (!result.candidate) return { rejection: result.rejection }
      candidate = { ...owned, state: result.candidate }
    }
  } else {
    const result = advancePublicV17GreenwayAction({ state: owned.state, greenwayWorks: owned.greenwayWorks }, witness.intent)
    if (result.rejections.length) return { rejection: result.rejections[0].code }
    candidate = { ...result.progress, regionalWorks: owned.regionalWorks }; events = result.events
  }
  const progress = candidate && decodePublicV23Progress(candidate, owned.state.seed)
  return progress ? { progress, events } : { rejection: 'invalid-progress' }
}

export function replayPublicV23Witness(before: PublicV23Progress, witness: PublicV23Witness): PublicV23Progress | null {
  const result = applyPublicV23Witness(before, witness)
  return 'progress' in result ? result.progress : null
}
