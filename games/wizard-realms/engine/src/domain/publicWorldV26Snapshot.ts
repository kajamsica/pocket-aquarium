import { preservesPublicV13History } from './publicV13History'
import { backpackSlotsUsed } from './backpackSlots'
import { preservesPublicV17GreenwayWorks } from './publicWorldV17Validation'
import { samePublicV14Value } from './publicWorldV14Validation'
import { decodePublicV14FrameWitness } from './publicWorldV14Snapshot'
import type { PublicV14Frame } from './publicWorldV14Snapshot'
import { decodePublicV23Progress, exactPublicV23 } from './publicWorldV23Snapshot'
import { visitPublicV23Frames } from './publicWorldV23Transitions'
import { decodePublicV24Witness, replayPublicV24Witness } from './publicWorldV24Snapshot'
import type { PublicV24Progress, PublicV24Witness } from './publicWorldV24Snapshot'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicV25RiverPassage } from './publicWorldV25Passage'
import { createPublicV26Migration, decodePublicV26Lineage, PUBLIC_V26_SCHEMA } from './publicWorldV26Migration'
import type { PublicV26Lineage, PublicV26Progress } from './publicWorldV26Migration'
import { projectPublicV26Pose } from './publicWorldV26Pose'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { applyPublicV26PitLadderAction, decodePublicV26PitLadderAction } from './publicWorldV26PitLadder'
import type { PublicV26PitLadderAction } from './publicWorldV26PitLadder'
import { applyPublicV26TerrainAction, decodePublicV26TerrainAction } from './publicWorldV26TerrainAction'
import type { PublicV26TerrainAction } from './publicWorldV26TerrainAction'
import { decodePublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { publicV26TerrainConserved } from './publicWorldV26TerrainConservation'
import { publicV26ValleyRimPassage } from './publicWorldV26ValleyRim'
import type { PublicV26LadderSpan } from './publicWorldV26ValleyRim'
import { starterCliffFace } from './starterCliffProfile'

export type PublicV26Witness = PublicV24Witness | Readonly<{
  kind: 'terrain-action/v1'; action: PublicV26TerrainAction
}> | Readonly<{
  kind: 'pit-ladder/v1'; action: PublicV26PitLadderAction
}> | Readonly<{
  kind: 'return-home/v1'; atMs: number
}>
export type PublicV26Head = PublicV26Progress & Readonly<{
  schemaVersion: typeof PUBLIC_V26_SCHEMA; saveRevision: number; witness: PublicV26Witness | null
}>
export type PublicV26Root = Readonly<{ lineage: PublicV26Lineage;
  head: PublicV26Head; previous: PublicV26Head | null }>
const progress = ({ state, greenwayWorks, regionalWorks }: PublicV26Progress): PublicV24Progress =>
  ({ state, greenwayWorks, regionalWorks })
const ownedProgress = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs }: PublicV26Progress):
  PublicV26Progress => ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs })

export function createPublicV26Root(rawV25Receipt: unknown): PublicV26Root {
  const { lineage, progress: migrated } = createPublicV26Migration(rawV25Receipt)
  return { lineage, head: { ...migrated, schemaVersion: PUBLIC_V26_SCHEMA,
    saveRevision: 0, witness: null }, previous: null }
}

export function publicV26SavedLadderSpans(owned: PublicV24Progress): PublicV26LadderSpan[] | null {
  const { state, greenwayWorks } = owned, seed = state.seed
  const route = state.greenway.routes.find((entry) => entry.id === 'greenway_ladder')
  const built = state.greenway.builtRouteIds.includes('greenway_ladder')
  const authored = route && starterCliffFace(seed, route, state.generationProfile, built)
  if (built && !authored) return null
  const spans: PublicV26LadderSpan[] = authored
    ? [{ x: authored.from.x, widthMeters: authored.width }] : []
  for (const id of greenwayWorks.builtLadderIds) {
    const site = resolvePublicV17GreenwaySite(seed, id)
    if (!site || site.kind !== 'ladder') return null
    spans.push({ x: site.from.x, widthMeters: site.widthMeters })
  }
  return spans
}

function acceptsSegment(before: PublicV24Progress, after: PublicV24Progress,
  terrain: PublicV26Progress['terrain']): boolean {
  const from = before.state.player.position, to = after.state.player.position
  const start = projectPublicV26Pose(before, terrain), end = projectPublicV26Pose(after, terrain)
  if (!start || !end) return false
  if (from.x !== to.x || from.z !== to.z) {
    const spans = publicV26SavedLadderSpans(before)
    if (!spans || !publicV25RiverPassage(before, from, to).ok
      || !publicV26ValleyRimPassage(before.state.seed, from, to, spans).ok) return false
  }
  const heightChange = end.effective.floorY - start.effective.floorY
  if (Math.abs(heightChange) <= 0.55 + 1e-6) return true
  const pit = start.effective.floorY < start.carrier.floorY - 1e-6
    || end.effective.floorY < end.carrier.floorY - 1e-6
  if (pit) return Math.abs(end.carrier.floorY - start.carrier.floorY) <= 0.55 + 1e-6
    && (start.cell.gx !== end.cell.gx || start.cell.gz !== end.cell.gz)
    && [start, end].some((pose) => pose.effective.floorY < pose.carrier.floorY - 1e-6
      && terrain.columns.some((column) => column.gx === pose.cell.gx
        && column.gz === pose.cell.gz && column.openDepth > 0 && column.pitLadder))
  return !pit && (start.support === 'ladder' || end.support === 'ladder'
    || start.support === 'bridge' || end.support === 'bridge')
}

export function publicV26MovementSegmentAccepted(before: PublicV26Progress,
  after: PublicV26Progress): boolean {
  try {
    const prior = decodePublicV23Progress(progress(before), before?.state?.seed)
    const next = decodePublicV23Progress(progress(after), before?.state?.seed)
    const terrain = decodePublicV26TerrainLedger(before.terrain)
    return !!prior && !!next && !!terrain && samePublicV14Value(terrain, after.terrain)
      && before.nextHomeAtMs === after.nextHomeAtMs && acceptsSegment(prior, next, terrain)
  } catch { return false }
}

/** Local-only airborne preview. Every intermediate segment uses the durable river/rim/floor gate. */
export function previewPublicV26Frames(before: PublicV26Progress,
  frames: readonly PublicV14Frame[]): PublicV26Progress | null {
  try {
    const old = decodePublicV23Progress(progress(before), before?.state?.seed)
    const terrain = decodePublicV26TerrainLedger(before.terrain)
    const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames })
    if (!old || !terrain || !witness || !Number.isSafeInteger(before.nextHomeAtMs)
      || before.nextHomeAtMs < 0 || !projectPublicV26Pose(old, terrain)) return null
    const next = visitPublicV23Frames(old, witness.frames, (prior, after) =>
      acceptsSegment(prior, after, terrain), true)
    return next ? { ...next, terrain, nextHomeAtMs: before.nextHomeAtMs } : null
  } catch { return null }
}

/** Replay only inherited actions against the unchanged V26 terrain ledger. */
export function replayPublicV26InheritedWitness(before: PublicV26Progress,
  rawWitness: unknown): PublicV26Progress | null {
  try {
    const witness = decodePublicV24Witness(rawWitness)
    const old = decodePublicV23Progress(progress(before), before?.state?.seed)
    const terrain = decodePublicV26TerrainLedger(before.terrain)
    const start = old && terrain && projectPublicV26Pose(old, terrain)
    if (!witness || !old || !terrain || !Number.isSafeInteger(before.nextHomeAtMs)
      || before.nextHomeAtMs < 0 || !start) return null
    const next = witness.kind === 'frame-batch/v1'
      ? visitPublicV23Frames(old, witness.frames, (prior, after) =>
        acceptsSegment(prior, after, terrain))
      : replayPublicV24Witness(old, witness)
    if (!next) return null
    const terrainUnits = Object.values(terrain.bag).reduce((total, quantity) => total + quantity, 0)
    const beforeUsed = backpackSlotsUsed(old.state.player.inventory, old.state.player.tradeSlots, terrainUnits)
    const afterUsed = backpackSlotsUsed(next.state.player.inventory, next.state.player.tradeSlots, terrainUnits)
    if (afterUsed > next.state.player.backpackCapacity && afterUsed > beforeUsed) return null
    const end = projectPublicV26Pose(next, terrain)
    if (!end) return null
    const from = old.state.player.position, to = next.state.player.position
    const cacheFloorDrop = witness.kind === 'mireglass-action/v1'
      && witness.action.type === 'excavate_cache'
      && old.state.mireglass.cacheRevealed && !old.state.mireglass.cacheExcavated
      && next.state.mireglass.cacheRevealed && next.state.mireglass.cacheExcavated
      && from.x === to.x && from.z === to.z
      && start.cell.gx === end.cell.gx && start.cell.gz === end.cell.gz
      && Math.abs(from.y - start.carrier.floorY) <= 1e-6
      && Math.abs(to.y - end.carrier.floorY) <= 1e-6
      && Math.abs(start.effective.floorY - start.carrier.floorY) <= 1e-6
      && Math.abs(end.effective.floorY - end.carrier.floorY) <= 1e-6
    if (witness.kind !== 'frame-batch/v1' && !acceptsSegment(old, next, terrain)
      && !cacheFloorDrop) return null
    return { ...next, terrain, nextHomeAtMs: before.nextHomeAtMs }
  } catch { return null }
}

export function decodePublicV26Witness(value: unknown): PublicV26Witness | null {
  try {
    const inherited = decodePublicV24Witness(value)
    if (inherited) return inherited
    if (exactPublicV23(value, ['kind', 'atMs']) && value.kind === 'return-home/v1'
      && Number.isSafeInteger(value.atMs) && (value.atMs as number) >= 0) {
      return { kind: 'return-home/v1', atMs: value.atMs as number }
    }
    if (!exactPublicV23(value, ['kind', 'action'])) return null
    if (value.kind === 'terrain-action/v1') {
      const action = decodePublicV26TerrainAction(value.action)
      return action ? { kind: 'terrain-action/v1', action } : null
    }
    if (value.kind === 'pit-ladder/v1') {
      const action = decodePublicV26PitLadderAction(value.action)
      return action ? { kind: 'pit-ladder/v1', action } : null
    }
    return null
  } catch { return null }
}

export function replayPublicV26Witness(before: PublicV26Progress,
  rawWitness: unknown): PublicV26Progress | null {
  const witness = decodePublicV26Witness(rawWitness)
  if (!witness) return null
  if (witness.kind === 'terrain-action/v1')
    return applyPublicV26TerrainAction(before, witness.action).progress ?? null
  if (witness.kind === 'pit-ladder/v1')
    return applyPublicV26PitLadderAction(before, witness.action).progress ?? null
  if (witness.kind === 'return-home/v1')
    return applyPublicV26ReturnHome(before, witness.atMs).progress ?? null
  return replayPublicV26InheritedWitness(before, witness)
}

/** Exact head shape, including old-carrier and effective-pose validity. */
export function decodePublicV26Head(value: unknown, rawLineage: PublicV26Lineage): PublicV26Head | null {
  try {
    const lineage = decodePublicV26Lineage(rawLineage)
    if (!lineage || !exactPublicV23(value, ['schemaVersion', 'saveRevision', 'state',
      'greenwayWorks', 'regionalWorks', 'terrain', 'nextHomeAtMs', 'witness'])
      || value.schemaVersion !== PUBLIC_V26_SCHEMA || !Number.isSafeInteger(value.saveRevision)
      || (value.saveRevision as number) < 0 || !Number.isSafeInteger(value.nextHomeAtMs)
      || (value.nextHomeAtMs as number) < 0) return null
    const old = decodePublicV23Progress({ state: value.state, greenwayWorks: value.greenwayWorks,
      regionalWorks: value.regionalWorks }, lineage.seed)
    const terrain = decodePublicV26TerrainLedger(value.terrain)
    if (!old || !terrain || !projectPublicV26Pose(old, terrain)) return null
    if (value.saveRevision === 0) return samePublicV14Value(value,
      createPublicV26Root(lineage.sourceReceipt).head) ? structuredClone(value) as PublicV26Head : null
    const witness = decodePublicV26Witness(value.witness)
    return witness ? { ...old, terrain, nextHomeAtMs: value.nextHomeAtMs as number,
      schemaVersion: PUBLIC_V26_SCHEMA, saveRevision: value.saveRevision as number, witness } : null
  } catch { return null }
}

/** Three-slot proof replays the latest witnessed step and preserves inherited history. */
export function decodePublicV26Root(value: unknown): PublicV26Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV26Lineage(value.lineage)
    const head = lineage && decodePublicV26Head(value.head, lineage)
    if (!lineage || !head) return null
    const previous = value.previous === null ? null : decodePublicV26Head(value.previous, lineage)
    if (head.saveRevision === 0 ? value.previous !== null : !previous
      || head.saveRevision !== previous.saveRevision + 1 || !head.witness) return null
    const genesis = createPublicV26Root(lineage.sourceReceipt).head
    const preserves = (prior: PublicV26Head, next: PublicV26Head) =>
      preservesPublicV13History(prior.state as never, next.state as never)
      && preservesPublicV17GreenwayWorks(prior.greenwayWorks, next.greenwayWorks, lineage.seed)
      && prior.regionalWorks.builtLadderIds.every((id) => next.regionalWorks.builtLadderIds.includes(id))
    const conserved = (candidate: PublicV26Head) =>
      publicV26TerrainConserved(genesis.terrain, candidate.terrain, lineage.seed)
    if (!preserves(genesis, head) || !conserved(head)
      || previous && (!preserves(genesis, previous) || !conserved(previous))) return null
    if (!previous) return { lineage, head, previous: null }
    if (previous.saveRevision === 1 && !samePublicV14Value(
      replayPublicV26Witness(ownedProgress(genesis), previous.witness), ownedProgress(previous))) return null
    const replayed = replayPublicV26Witness(ownedProgress(previous), head.witness)
    return samePublicV14Value(replayed, ownedProgress(head)) ? { lineage, head, previous } : null
  } catch { return null }
}
