import { preservesPublicV13History } from './publicV13History'
import { preservesPublicV17GreenwayWorks } from './publicWorldV17Validation'
import { samePublicV14Value } from './publicWorldV14Validation'
import type { PublicV14Frame } from './publicWorldV14Snapshot'
import { decodePublicV23Progress, exactPublicV23 } from './publicWorldV23Snapshot'
import { visitPublicV23FramesWithEvents } from './publicWorldV23Transitions'
import type { PublicV23StreamedMovePolicy } from './publicWorldV23Transitions'
import type { PublicV24Progress } from './publicWorldV24Snapshot'
import { publicV25RiverPassage } from './publicWorldV25Passage'
import type { PublicV45DryRideAdmission } from './publicWorldV45DryRideAdmission'
import { decodePublicV26Witness, publicV26SavedLadderSpans,
  replayPublicV26Witness } from './publicWorldV26Snapshot'
import type { PublicV26Witness } from './publicWorldV26Snapshot'
import { projectPublicV26Pose } from './publicWorldV26Pose'
import { decodePublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { publicV26TerrainConserved } from './publicWorldV26TerrainConservation'
import { publicV26ValleyRimPassage } from './publicWorldV26ValleyRim'
import { createPublicV27Migration, decodePublicV27Lineage, PUBLIC_V27_SCHEMA } from './publicWorldV27Migration'
import type { PublicV27Lineage, PublicV27Progress } from './publicWorldV27Migration'
import type { PublicWorldEvent } from './publicWorldRuntime'

export type PublicV27Witness = PublicV26Witness
export type PublicV27Head = PublicV27Progress & Readonly<{
  schemaVersion: typeof PUBLIC_V27_SCHEMA; saveRevision: number; witness: PublicV27Witness | null
}>
export type PublicV27Root = Readonly<{ lineage: PublicV27Lineage;
  head: PublicV27Head; previous: PublicV27Head | null }>
const movementPolicy = { maxOrdinaryGroundStepMeters: 0.8 } as const
const progress = ({ state, greenwayWorks, regionalWorks }: PublicV27Progress): PublicV24Progress =>
  ({ state, greenwayWorks, regionalWorks })
const ownedProgress = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs }: PublicV27Progress):
  PublicV27Progress => ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs })

export function createPublicV27Root(rawV26Receipt: unknown): PublicV27Root {
  const { lineage, progress: migrated } = createPublicV27Migration(rawV26Receipt)
  return { lineage, head: { ...migrated, schemaVersion: PUBLIC_V27_SCHEMA,
    saveRevision: 0, witness: null }, previous: null }
}

/** Preserve river, rim and excavated-pit rules before allowing ordinary dry 0.8 m steps. */
function acceptsSegment(before: PublicV24Progress, after: PublicV24Progress,
  terrain: PublicV27Progress['terrain'], admission?: PublicV45DryRideAdmission): boolean {
  const from = before.state.player.position, to = after.state.player.position
  const start = projectPublicV26Pose(before, terrain), end = projectPublicV26Pose(after, terrain)
  if (!start || !end) return false
  if (from.x !== to.x || from.z !== to.z) {
    const spans = publicV26SavedLadderSpans(before)
    if (!spans || !publicV25RiverPassage(before, from, to, admission).ok
      || !publicV26ValleyRimPassage(before.state.seed, from, to, spans).ok) return false
  }
  const heightChange = end.effective.floorY - start.effective.floorY
  const pit = start.effective.floorY < start.carrier.floorY - 1e-6
    || end.effective.floorY < end.carrier.floorY - 1e-6
  if (pit) {
    if (Math.abs(heightChange) <= 0.55 + 1e-6) return true
    return Math.abs(end.carrier.floorY - start.carrier.floorY) <= 0.55 + 1e-6
      && (start.cell.gx !== end.cell.gx || start.cell.gz !== end.cell.gz)
      && [start, end].some((pose) => pose.effective.floorY < pose.carrier.floorY - 1e-6
        && terrain.columns.some((column) => column.gx === pose.cell.gx
          && column.gz === pose.cell.gz && column.openDepth > 0 && column.pitLadder))
  }
  const ordinary = (start.support === 'ground' || start.support === 'terrain')
    && (end.support === 'ground' || end.support === 'terrain')
  if (Math.abs(heightChange) <= (ordinary ? movementPolicy.maxOrdinaryGroundStepMeters : 0.55) + 1e-6)
    return true
  return start.support === 'ladder' || end.support === 'ladder'
    || start.support === 'bridge' || end.support === 'bridge'
}

export function publicV27MovementSegmentAccepted(before: PublicV27Progress,
  after: PublicV27Progress): boolean {
  try {
    const prior = decodePublicV23Progress(progress(before), before?.state?.seed)
    const next = decodePublicV23Progress(progress(after), before?.state?.seed)
    const terrain = decodePublicV26TerrainLedger(before.terrain)
    return !!prior && !!next && !!terrain && samePublicV14Value(terrain, after.terrain)
      && before.nextHomeAtMs === after.nextHomeAtMs && acceptsSegment(prior, next, terrain)
  } catch { return false }
}

/** V27 frame replay provides authoritative event effects for the controller and writer. */
export function replayPublicV27FramesWithEvents(before: PublicV27Progress,
  frames: readonly PublicV14Frame[], allowAirborne = false,
  streamedMove?: PublicV23StreamedMovePolicy, admission?: PublicV45DryRideAdmission):
  { progress: PublicV27Progress; events: readonly PublicWorldEvent[] } | null {
  try {
    const terrain = decodePublicV26TerrainLedger(before.terrain)
    if (!terrain || !Number.isSafeInteger(before.nextHomeAtMs)
      || before.nextHomeAtMs < 0) return null
    const next = visitPublicV23FramesWithEvents(progress(before), frames, (prior, after) =>
      acceptsSegment(prior, after, terrain, admission), allowAirborne, movementPolicy, streamedMove)
    return next && projectPublicV26Pose(next.progress, terrain)
      ? { progress: { ...next.progress, terrain, nextHomeAtMs: before.nextHomeAtMs },
        events: next.events } : null
  } catch { return null }
}

/** Airborne preview stays local; every intermediate segment keeps the V27 durable gate. */
export function previewPublicV27Frames(before: PublicV27Progress,
  frames: readonly PublicV14Frame[]): PublicV27Progress | null {
  return replayPublicV27FramesWithEvents(before, frames, true)?.progress ?? null
}

export const decodePublicV27Witness = decodePublicV26Witness

/** Reuse V26 work actions, but frame witnesses replay only through the opt-in V27 policy. */
export function replayPublicV27Witness(before: PublicV27Progress,
  rawWitness: unknown): PublicV27Progress | null {
  const witness = decodePublicV27Witness(rawWitness)
  if (!witness) return null
  if (witness.kind !== 'frame-batch/v1') return replayPublicV26Witness(before, witness)
  return replayPublicV27FramesWithEvents(before, witness.frames)?.progress ?? null
}

export function decodePublicV27Head(value: unknown, rawLineage: PublicV27Lineage): PublicV27Head | null {
  try {
    const lineage = decodePublicV27Lineage(rawLineage)
    if (!lineage || !exactPublicV23(value, ['schemaVersion', 'saveRevision', 'state',
      'greenwayWorks', 'regionalWorks', 'terrain', 'nextHomeAtMs', 'witness'])
      || value.schemaVersion !== PUBLIC_V27_SCHEMA || !Number.isSafeInteger(value.saveRevision)
      || (value.saveRevision as number) < 0 || !Number.isSafeInteger(value.nextHomeAtMs)
      || (value.nextHomeAtMs as number) < 0) return null
    const old = decodePublicV23Progress({ state: value.state, greenwayWorks: value.greenwayWorks,
      regionalWorks: value.regionalWorks }, lineage.seed)
    const terrain = decodePublicV26TerrainLedger(value.terrain)
    if (!old || !terrain || !projectPublicV26Pose(old, terrain)) return null
    if (value.saveRevision === 0) return samePublicV14Value(value,
      createPublicV27Root(lineage.sourceReceipt).head) ? structuredClone(value) as PublicV27Head : null
    const witness = decodePublicV27Witness(value.witness)
    return witness ? { ...old, terrain, nextHomeAtMs: value.nextHomeAtMs as number,
      schemaVersion: PUBLIC_V27_SCHEMA, saveRevision: value.saveRevision as number, witness } : null
  } catch { return null }
}

/** Three-slot checked replay preserves the exact V26 migration source and terrain budget. */
export function decodePublicV27Root(value: unknown): PublicV27Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV27Lineage(value.lineage)
    const head = lineage && decodePublicV27Head(value.head, lineage)
    if (!lineage || !head) return null
    const previous = value.previous === null ? null : decodePublicV27Head(value.previous, lineage)
    if (head.saveRevision === 0 ? value.previous !== null : !previous
      || head.saveRevision !== previous.saveRevision + 1 || !head.witness) return null
    const genesis = createPublicV27Root(lineage.sourceReceipt).head
    const preserves = (prior: PublicV27Head, next: PublicV27Head) =>
      preservesPublicV13History(prior.state as never, next.state as never)
      && preservesPublicV17GreenwayWorks(prior.greenwayWorks, next.greenwayWorks, lineage.seed)
      && prior.regionalWorks.builtLadderIds.every((id) => next.regionalWorks.builtLadderIds.includes(id))
    const conserved = (candidate: PublicV27Head) =>
      publicV26TerrainConserved(genesis.terrain, candidate.terrain, lineage.seed)
    if (!preserves(genesis, head) || !conserved(head)
      || previous && (!preserves(genesis, previous) || !conserved(previous))) return null
    if (!previous) return { lineage, head, previous: null }
    if (previous.saveRevision === 1 && !samePublicV14Value(
      replayPublicV27Witness(ownedProgress(genesis), previous.witness), ownedProgress(previous))) return null
    const replayed = replayPublicV27Witness(ownedProgress(previous), head.witness)
    return samePublicV14Value(replayed, ownedProgress(head)) ? { lineage, head, previous } : null
  } catch { return null }
}

/** Only for a successor whose lineage and previous head exactly match a checked root.
 * The atomic store establishes those raw equality guards before calling this path. */
export function decodePublicV27CheckedSuccessor(before: PublicV27Root,
  value: unknown): PublicV27Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])
      || !exactPublicV23(value.head, ['schemaVersion', 'saveRevision', 'state',
        'greenwayWorks', 'regionalWorks', 'terrain', 'nextHomeAtMs', 'witness'])
      || value.head.schemaVersion !== PUBLIC_V27_SCHEMA
      || !Number.isSafeInteger(value.head.saveRevision)
      || value.head.saveRevision !== before.head.saveRevision + 1
      || !Number.isSafeInteger(value.head.nextHomeAtMs)
      || (value.head.nextHomeAtMs as number) < 0) return null
    const old = decodePublicV23Progress({ state: value.head.state,
      greenwayWorks: value.head.greenwayWorks,
      regionalWorks: value.head.regionalWorks }, before.lineage.seed)
    const terrain = decodePublicV26TerrainLedger(value.head.terrain)
    const witness = decodePublicV27Witness(value.head.witness)
    if (!old || !terrain || !witness || !projectPublicV26Pose(old, terrain)) return null
    const head: PublicV27Head = { ...old, terrain, nextHomeAtMs: value.head.nextHomeAtMs as number,
      schemaVersion: PUBLIC_V27_SCHEMA, saveRevision: value.head.saveRevision, witness }
    const source = before.lineage.sourceReceipt.head
    const genesis: PublicV27Head = { state: source.state, greenwayWorks: source.greenwayWorks,
      regionalWorks: source.regionalWorks, terrain: source.terrain,
      nextHomeAtMs: source.nextHomeAtMs, schemaVersion: PUBLIC_V27_SCHEMA,
      saveRevision: 0, witness: null }
    if (!preservesPublicV13History(genesis.state as never, head.state as never)
      || !preservesPublicV17GreenwayWorks(genesis.greenwayWorks, head.greenwayWorks,
        before.lineage.seed)
      || !genesis.regionalWorks.builtLadderIds.every((id) =>
        head.regionalWorks.builtLadderIds.includes(id))
      || !publicV26TerrainConserved(genesis.terrain, head.terrain, before.lineage.seed)
      || !samePublicV14Value(replayPublicV27Witness(ownedProgress(before.head), head.witness),
        ownedProgress(head))) return null
    return { lineage: before.lineage, previous: before.head, head }
  } catch { return null }
}
