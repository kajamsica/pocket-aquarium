import { preservesPublicV13History } from './publicV13History'
import { preservesPublicV17GreenwayWorks } from './publicWorldV17Validation'
import { samePublicV14Value } from './publicWorldV14Validation'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import type { PublicV23StreamedMovePolicy } from './publicWorldV23Transitions'
import type { PublicV45DryRideAdmission } from './publicWorldV45DryRideAdmission'
import { publicV26TerrainConserved } from './publicWorldV26TerrainConservation'
import { publicV28BridgeSitesValid } from './publicWorldV28RiverBridgeAction'
import { replayPublicV28FramesWithEvents } from './publicWorldV28Replay'
import { projectPublicV28Pose } from './publicWorldV28RiverSupport'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { decodePublicV29ActionProgress } from './publicWorldV29MiningTools'
import { decodePublicV29Witness, replayPublicV29Witness } from './publicWorldV29Snapshot'
import type { PublicV29Witness } from './publicWorldV29Snapshot'
import type { PublicV29Progress } from './publicWorldV29Migration'
import { confirmPublicV30BridgeheadClaim } from './publicWorldV30BridgeheadAction'
import type { PublicV30BridgeheadWitness } from './publicWorldV30BridgeheadAction'
import { createPublicV30Migration, decodePublicV30Lineage,
  PUBLIC_V30_SCHEMA } from './publicWorldV30Migration'
import type { PublicV30Lineage, PublicV30Progress,
  PublicV30SourceReceipt } from './publicWorldV30Migration'
import type { PublicWorldEvent } from './publicWorldRuntime'

export type PublicV30Witness = PublicV29Witness | PublicV30BridgeheadWitness
export type PublicV30Head = PublicV30Progress & Readonly<{
  schemaVersion: typeof PUBLIC_V30_SCHEMA; saveRevision: number; witness: PublicV30Witness | null
}>
export type PublicV30Root = Readonly<{ lineage: PublicV30Lineage;
  head: PublicV30Head; previous: PublicV30Head | null }>

const inherited = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools }: PublicV30Progress): PublicV29Progress =>
  ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs, riverBridgeIds, miningTools })
const owned = (progress: PublicV30Progress): PublicV30Progress =>
  ({ ...inherited(progress), claimedBridgeheadId: progress.claimedBridgeheadId })

export function canonicalClaim(progress: PublicV30Progress): boolean {
  const id = progress.claimedBridgeheadId
  if (id === null) return true
  if (typeof id !== 'string') return false
  const site = resolvePublicV17GreenwaySite(progress.state.seed, id)
  if (site?.kind === 'bridge') return progress.greenwayWorks.builtBridgeIds.includes(site.id)
  const river = resolvePublicV28RiverBridge(progress.state.seed, id)
  return !!river && progress.riverBridgeIds.includes(river.id)
}

export function createPublicV30Root(rawV29Receipt: unknown): PublicV30Root {
  const { lineage, progress } = createPublicV30Migration(rawV29Receipt)
  return { lineage, head: { ...progress, schemaVersion: PUBLIC_V30_SCHEMA,
    saveRevision: 0, witness: null }, previous: null }
}

const genesisHead = ({ head }: PublicV30SourceReceipt): PublicV30Head => ({
  state: head.state, greenwayWorks: head.greenwayWorks,
  regionalWorks: head.regionalWorks, terrain: head.terrain,
  nextHomeAtMs: head.nextHomeAtMs, riverBridgeIds: head.riverBridgeIds,
  miningTools: head.miningTools, claimedBridgeheadId: null,
  schemaVersion: PUBLIC_V30_SCHEMA, saveRevision: 0, witness: null })

export function decodePublicV30Witness(value: unknown): PublicV30Witness | null {
  const prior = decodePublicV29Witness(value)
  if (prior) return prior
  try {
    return exactPublicV23(value, ['kind', 'bridgeId'])
      && value.kind === 'bridgehead-claim/v1'
      && typeof value.bridgeId === 'string' && value.bridgeId.length > 0
      && value.bridgeId.length <= 128
      ? { kind: 'bridgehead-claim/v1', bridgeId: value.bridgeId } : null
  } catch { return null }
}

/** One checked V28 frame replay supplies both V30 state and authoritative events. */
export function replayPublicV30FramesWithEvents(before: PublicV30Progress,
  rawWitness: unknown, streamedMove?: PublicV23StreamedMovePolicy,
  admission?: PublicV45DryRideAdmission): { progress: PublicV30Progress;
    events: readonly PublicWorldEvent[] } | null {
  const witness = decodePublicV30Witness(rawWitness)
  if (witness?.kind !== 'frame-batch/v1' || !canonicalClaim(before)) return null
  const prior = inherited(before)
  if (!publicV28BridgeSitesValid(prior)) return null
  const observed = replayPublicV28FramesWithEvents(prior, witness.frames, false, streamedMove, admission)
  if (!observed || !publicV28BridgeSitesValid(observed.progress)) return null
  const activePick = observed.progress.state.player.equipment.mainHand === null
    ? before.miningTools.activePick : null
  return { progress: { ...observed.progress,
    miningTools: { ...before.miningTools, activePick },
    claimedBridgeheadId: before.claimedBridgeheadId }, events: observed.events }
}

export function replayPublicV30Witness(before: PublicV30Progress,
  rawWitness: unknown): PublicV30Progress | null {
  const witness = decodePublicV30Witness(rawWitness)
  if (!witness) return null
  if (witness.kind === 'frame-batch/v1')
    return replayPublicV30FramesWithEvents(before, witness)?.progress ?? null
  if (!canonicalClaim(before)) return null
  if (witness.kind === 'bridgehead-claim/v1')
    return confirmPublicV30BridgeheadClaim(before, witness.bridgeId).progress ?? null
  const replayed = replayPublicV29Witness(inherited(before), witness)
  return replayed ? { ...replayed, claimedBridgeheadId: before.claimedBridgeheadId } : null
}

function decodeHead(value: unknown, lineage: PublicV30Lineage,
  genesis: PublicV30Head): PublicV30Head | null {
  try {
    if (!exactPublicV23(value, ['schemaVersion', 'saveRevision', 'state',
      'greenwayWorks', 'regionalWorks', 'terrain', 'nextHomeAtMs',
      'riverBridgeIds', 'miningTools', 'claimedBridgeheadId', 'witness'])
      || value.schemaVersion !== PUBLIC_V30_SCHEMA || !Number.isSafeInteger(value.saveRevision)
      || (value.saveRevision as number) < 0) return null
    const progress = decodePublicV29ActionProgress({ state: value.state,
      greenwayWorks: value.greenwayWorks, regionalWorks: value.regionalWorks,
      terrain: value.terrain, nextHomeAtMs: value.nextHomeAtMs,
      riverBridgeIds: value.riverBridgeIds, miningTools: value.miningTools } as PublicV29Progress)
    if (!progress || !projectPublicV28Pose(progress, progress.terrain, progress.riverBridgeIds))
      return null
    const claimedBridgeheadId = value.claimedBridgeheadId
    const next: PublicV30Progress = { ...progress,
      claimedBridgeheadId: claimedBridgeheadId as string | null }
    if (!canonicalClaim(next)) return null
    if (value.saveRevision === 0) return samePublicV14Value(value, genesis)
      ? structuredClone(value) as PublicV30Head : null
    const witness = decodePublicV30Witness(value.witness)
    return witness ? { ...next, schemaVersion: PUBLIC_V30_SCHEMA,
      saveRevision: value.saveRevision as number, witness } : null
  } catch { return null }
}

export function decodePublicV30Head(value: unknown,
  rawLineage: PublicV30Lineage): PublicV30Head | null {
  const lineage = decodePublicV30Lineage(rawLineage)
  return lineage ? decodeHead(value, lineage, genesisHead(lineage.sourceReceipt)) : null
}

const preserves = (genesis: PublicV30Head, next: PublicV30Head, seed: string) =>
  preservesPublicV13History(genesis.state as never, next.state as never)
  && preservesPublicV17GreenwayWorks(genesis.greenwayWorks, next.greenwayWorks, seed)
  && genesis.regionalWorks.builtLadderIds.every((id) =>
    next.regionalWorks.builtLadderIds.includes(id))
  && publicV26TerrainConserved(genesis.terrain, next.terrain, seed)
  && publicV28BridgeSitesValid(inherited(next))
  && next.state.player.xp >= genesis.state.player.xp + next.riverBridgeIds.length * 80
  && next.state.player.skillXp.construction >=
    genesis.state.player.skillXp.construction + next.riverBridgeIds.length * 80
const monotonic = (before: PublicV30Head, next: PublicV30Head) =>
  before.riverBridgeIds.every((id) => next.riverBridgeIds.includes(id))
  && (!before.miningTools.basicPickOwned || next.miningTools.basicPickOwned)
  && (!before.miningTools.enchantedPickOwned || next.miningTools.enchantedPickOwned)
  && (before.claimedBridgeheadId === null
    || before.claimedBridgeheadId === next.claimedBridgeheadId)

/** Complete reload validator, including pinned V29 source and three-slot replay. */
export function decodePublicV30Root(value: unknown): PublicV30Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV30Lineage(value.lineage)
    const genesis = lineage && genesisHead(lineage.sourceReceipt)
    const head = lineage && genesis && decodeHead(value.head, lineage, genesis)
    if (!lineage || !genesis || !head) return null
    const previous = value.previous === null ? null : decodeHead(value.previous, lineage, genesis)
    if (head.saveRevision === 0 ? value.previous !== null : !previous
      || head.saveRevision !== previous.saveRevision + 1 || !head.witness) return null
    if (!preserves(genesis, head, lineage.seed)
      || previous && (!preserves(genesis, previous, lineage.seed)
        || !monotonic(previous, head))) return null
    if (!previous) return { lineage, head, previous: null }
    if (previous.saveRevision === 1 && !samePublicV14Value(
      replayPublicV30Witness(owned(genesis), previous.witness), owned(previous))) return null
    return samePublicV14Value(replayPublicV30Witness(owned(previous), head.witness), owned(head))
      ? { lineage, head, previous } : null
  } catch { return null }
}

/** Only for a successor whose lineage and previous head match a checked raw proof. */
export function decodePublicV30CheckedSuccessor(before: PublicV30Root,
  value: unknown): PublicV30Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const genesis = genesisHead(before.lineage.sourceReceipt)
    const head = decodeHead(value.head, before.lineage, genesis)
    if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
      || !preserves(genesis, head, before.lineage.seed)
      || !monotonic(before.head, head)
      || !samePublicV14Value(replayPublicV30Witness(owned(before.head), head.witness),
        owned(head))) return null
    return { lineage: before.lineage, previous: before.head, head }
  } catch { return null }
}
