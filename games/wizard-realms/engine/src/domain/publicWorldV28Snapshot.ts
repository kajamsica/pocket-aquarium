import { preservesPublicV13History } from './publicV13History'
import { preservesPublicV17GreenwayWorks } from './publicWorldV17Validation'
import { samePublicV14Value } from './publicWorldV14Validation'
import { decodePublicV23Progress, exactPublicV23 } from './publicWorldV23Snapshot'
import { replayPublicV27Witness, decodePublicV27Witness } from './publicWorldV27Snapshot'
import type { PublicV27Witness } from './publicWorldV27Snapshot'
import { decodePublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { publicV26TerrainConserved } from './publicWorldV26TerrainConservation'
import { confirmPublicV28RiverBridge, publicV28BridgeSitesValid } from './publicWorldV28RiverBridgeAction'
import { parsePublicV28RiverBridgeId } from './publicWorldV28RiverBridgeSites'
import { replayPublicV28FramesWithEvents } from './publicWorldV28Replay'
import { projectPublicV28Pose, publicV28ResolvedRiverBridges,
  PUBLIC_V28_MAX_RIVER_BRIDGES } from './publicWorldV28RiverSupport'
import { createPublicV28Migration, decodePublicV28Lineage, PUBLIC_V28_SCHEMA } from './publicWorldV28Migration'
import type { PublicV28Lineage, PublicV28Progress,
  PublicV28SourceReceipt } from './publicWorldV28Migration'

export type PublicV28Witness = PublicV27Witness | Readonly<{ kind: 'river-bridge/v1'; id: string }>
export type PublicV28Head = PublicV28Progress & Readonly<{
  schemaVersion: typeof PUBLIC_V28_SCHEMA; saveRevision: number; witness: PublicV28Witness | null
}>
export type PublicV28Root = Readonly<{ lineage: PublicV28Lineage;
  head: PublicV28Head; previous: PublicV28Head | null }>
export const PUBLIC_V28_BRIDGE_LIMIT = PUBLIC_V28_MAX_RIVER_BRIDGES

const ownedProgress = ({ state, greenwayWorks, regionalWorks, terrain,
  nextHomeAtMs, riverBridgeIds }: PublicV28Progress): PublicV28Progress =>
  ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs, riverBridgeIds })

/** Canonical ledger syntax, ordering, and cap; site eligibility remains an action-time proof. */
export function decodePublicV28BridgeIds(value: unknown): readonly string[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > PUBLIC_V28_BRIDGE_LIMIT
      || Reflect.ownKeys(value).length !== value.length + 1) return null
    let previous = ''
    for (let index = 0; index < value.length; index++) {
      const field = Object.getOwnPropertyDescriptor(value, String(index))
      const id = field?.value
      if (!field?.enumerable || !Object.hasOwn(field, 'value')
        || parsePublicV28RiverBridgeId(id) === null || previous && previous >= id) return null
      previous = id
    }
    return [...value]
  } catch { return null }
}

export function createPublicV28Root(rawV27Receipt: unknown): PublicV28Root {
  const { lineage, progress } = createPublicV28Migration(rawV27Receipt)
  return { lineage, head: { ...progress, schemaVersion: PUBLIC_V28_SCHEMA,
    saveRevision: 0, witness: null }, previous: null }
}

const genesisHead = ({ head }: PublicV28SourceReceipt): PublicV28Head => ({
  state: head.state, greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
  terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs, riverBridgeIds: [],
  schemaVersion: PUBLIC_V28_SCHEMA, saveRevision: 0, witness: null })

export function decodePublicV28Witness(value: unknown): PublicV28Witness | null {
  const inherited = decodePublicV27Witness(value)
  if (inherited) return inherited
  return exactPublicV23(value, ['kind', 'id']) && value.kind === 'river-bridge/v1'
    && parsePublicV28RiverBridgeId(value.id) !== null
    ? { kind: 'river-bridge/v1', id: value.id as string } : null
}
export function replayPublicV28Witness(before: PublicV28Progress,
  rawWitness: unknown): PublicV28Progress | null {
  const witness = decodePublicV28Witness(rawWitness)
  if (!witness || !publicV28BridgeSitesValid(before)) return null
  if (witness.kind === 'river-bridge/v1')
    return confirmPublicV28RiverBridge(before, witness.id).progress ?? null
  if (witness.kind === 'frame-batch/v1') {
    const moved = replayPublicV28FramesWithEvents(before, witness.frames)?.progress ?? null
    return moved && publicV28BridgeSitesValid(moved) ? moved : null
  }
  const v28Keys = ['state', 'greenwayWorks', 'regionalWorks', 'terrain',
    'nextHomeAtMs', 'riverBridgeIds']
  if (!exactPublicV23(before, v28Keys)
    && !exactPublicV23(before, [...v28Keys, 'schemaVersion', 'saveRevision', 'witness'])) return null
  const replayed = replayPublicV27Witness({ state: before.state,
    greenwayWorks: before.greenwayWorks, regionalWorks: before.regionalWorks,
    terrain: before.terrain, nextHomeAtMs: before.nextHomeAtMs }, witness)
  const next = replayed ? { ...replayed, riverBridgeIds: [...before.riverBridgeIds] } : null
  return next && publicV28BridgeSitesValid(next) ? next : null
}

function decodeHead(value: unknown, lineage: PublicV28Lineage, genesis: PublicV28Head): PublicV28Head | null {
  try {
    if (!exactPublicV23(value, ['schemaVersion', 'saveRevision', 'state',
      'greenwayWorks', 'regionalWorks', 'terrain', 'nextHomeAtMs', 'riverBridgeIds', 'witness'])
      || value.schemaVersion !== PUBLIC_V28_SCHEMA || !Number.isSafeInteger(value.saveRevision)
      || (value.saveRevision as number) < 0 || !Number.isSafeInteger(value.nextHomeAtMs)
      || (value.nextHomeAtMs as number) < 0) return null
    const ids = decodePublicV28BridgeIds(value.riverBridgeIds)
    const old = decodePublicV23Progress({ state: value.state, greenwayWorks: value.greenwayWorks,
      regionalWorks: value.regionalWorks }, lineage.seed)
    const terrain = decodePublicV26TerrainLedger(value.terrain)
    if (!ids || !old || !terrain || !publicV28ResolvedRiverBridges(lineage.seed, ids)
      || !projectPublicV28Pose(old, terrain, ids)) return null
    if (value.saveRevision === 0) return samePublicV14Value(value, genesis)
      ? structuredClone(value) as PublicV28Head : null
    const witness = decodePublicV28Witness(value.witness)
    return witness ? { ...old, terrain, nextHomeAtMs: value.nextHomeAtMs as number,
      riverBridgeIds: ids, schemaVersion: PUBLIC_V28_SCHEMA,
      saveRevision: value.saveRevision as number, witness } : null
  } catch { return null }
}

export function decodePublicV28Head(value: unknown, rawLineage: PublicV28Lineage): PublicV28Head | null {
  const lineage = decodePublicV28Lineage(rawLineage)
  return lineage ? decodeHead(value, lineage, genesisHead(lineage.sourceReceipt)) : null
}

/** Three-slot replay keeps the V27 source exact and checks every V28 bridge witness. */
export function decodePublicV28Root(value: unknown): PublicV28Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV28Lineage(value.lineage)
    const genesis = lineage && genesisHead(lineage.sourceReceipt)
    const head = lineage && genesis && decodeHead(value.head, lineage, genesis)
    if (!lineage || !head) return null
    const previous = value.previous === null ? null : decodeHead(value.previous, lineage, genesis!)
    if (head.saveRevision === 0 ? value.previous !== null : !previous
      || head.saveRevision !== previous.saveRevision + 1 || !head.witness) return null
    const preserves = (prior: PublicV28Head, next: PublicV28Head) =>
      preservesPublicV13History(prior.state as never, next.state as never)
      && preservesPublicV17GreenwayWorks(prior.greenwayWorks, next.greenwayWorks, lineage.seed)
      && prior.regionalWorks.builtLadderIds.every((id) => next.regionalWorks.builtLadderIds.includes(id))
    const conserved = (candidate: PublicV28Head) =>
      publicV26TerrainConserved(genesis.terrain, candidate.terrain, lineage.seed)
    const bridgeProgressValid = (candidate: PublicV28Head) =>
      publicV28BridgeSitesValid(ownedProgress(candidate))
      && candidate.state.player.xp >= genesis.state.player.xp + candidate.riverBridgeIds.length * 80
      && candidate.state.player.skillXp.construction >=
        genesis.state.player.skillXp.construction + candidate.riverBridgeIds.length * 80
    if (!preserves(genesis, head) || !conserved(head) || !bridgeProgressValid(head)
      || previous && (!preserves(genesis, previous) || !conserved(previous))) return null
    if (previous && (!bridgeProgressValid(previous)
      || previous.riverBridgeIds.some((id) => !head.riverBridgeIds.includes(id)))) return null
    if (!previous) return { lineage, head, previous: null }
    if (previous.saveRevision === 1 && !samePublicV14Value(
      replayPublicV28Witness(ownedProgress(genesis), previous.witness), ownedProgress(previous))) return null
    const replayed = replayPublicV28Witness(ownedProgress(previous), head.witness)
    return samePublicV14Value(replayed, ownedProgress(head)) ? { lineage, head, previous } : null
  } catch { return null }
}

/** The atomic store calls this only after a checked proof establishes that the
 * candidate's canonical lineage and previous head are unchanged raw values. */
export function decodePublicV28CheckedSuccessor(before: PublicV28Root,
  value: unknown): PublicV28Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const genesis = genesisHead(before.lineage.sourceReceipt)
    const head = decodeHead(value.head, before.lineage, genesis)
    if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
      || !preservesPublicV13History(genesis.state as never, head.state as never)
      || !preservesPublicV17GreenwayWorks(genesis.greenwayWorks, head.greenwayWorks,
        before.lineage.seed)
      || !genesis.regionalWorks.builtLadderIds.every((id) =>
        head.regionalWorks.builtLadderIds.includes(id))
      || !publicV26TerrainConserved(genesis.terrain, head.terrain, before.lineage.seed)
      || !publicV28BridgeSitesValid(ownedProgress(head))
      || head.state.player.xp < genesis.state.player.xp + head.riverBridgeIds.length * 80
      || head.state.player.skillXp.construction <
        genesis.state.player.skillXp.construction + head.riverBridgeIds.length * 80
      || before.head.riverBridgeIds.some((id) => !head.riverBridgeIds.includes(id))
      || !samePublicV14Value(replayPublicV28Witness(ownedProgress(before.head), head.witness),
        ownedProgress(head))) return null
    return { lineage: before.lineage, previous: before.head, head }
  } catch { return null }
}
