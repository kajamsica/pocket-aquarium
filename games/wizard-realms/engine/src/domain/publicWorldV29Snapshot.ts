import { preservesPublicV13History } from './publicV13History'
import { preservesPublicV17GreenwayWorks } from './publicWorldV17Validation'
import { samePublicV14Value } from './publicWorldV14Validation'
import { decodePublicV23Progress, exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { publicV26TerrainConserved } from './publicWorldV26TerrainConservation'
import { publicV28BridgeSitesValid } from './publicWorldV28RiverBridgeAction'
import { projectPublicV28Pose, publicV28ResolvedRiverBridges } from './publicWorldV28RiverSupport'
import { decodePublicV28BridgeIds, decodePublicV28Witness,
  replayPublicV28Witness } from './publicWorldV28Snapshot'
import type { PublicV28Witness } from './publicWorldV28Snapshot'
import { replayPublicV27Witness } from './publicWorldV27Snapshot'
import { applyPublicV29DeepDig, decodePublicV29DeepDigAction } from './publicWorldV29DeepDigAction'
import type { PublicV29DeepDigAction } from './publicWorldV29DeepDigAction'
import { applyPublicV29MineralSale, decodePublicV29MineralSale } from './publicWorldV29MineralSale'
import type { PublicV29MineralSale } from './publicWorldV29MineralSale'
import { applyPublicV29MiningToolAction, decodePublicV29MiningToolWitness,
  decodePublicV29MiningTools, emptyPublicV29MiningTools } from './publicWorldV29MiningTools'
import type { PublicV29MiningToolWitness } from './publicWorldV29MiningTools'
import { createPublicV29Migration, decodePublicV29Lineage, PUBLIC_V29_SCHEMA } from './publicWorldV29Migration'
import type { PublicV29Lineage, PublicV29Progress,
  PublicV29SourceReceipt } from './publicWorldV29Migration'

export type PublicV29Witness = PublicV28Witness | PublicV29MiningToolWitness
  | PublicV29DeepDigAction | PublicV29MineralSale
export type PublicV29Head = PublicV29Progress & Readonly<{
  schemaVersion: typeof PUBLIC_V29_SCHEMA; saveRevision: number; witness: PublicV29Witness | null
}>
export type PublicV29Root = Readonly<{ lineage: PublicV29Lineage;
  head: PublicV29Head; previous: PublicV29Head | null }>

const owned = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools }: PublicV29Progress): PublicV29Progress =>
  ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs, riverBridgeIds, miningTools })

export function createPublicV29Root(rawV28Receipt: unknown): PublicV29Root {
  const { lineage, progress } = createPublicV29Migration(rawV28Receipt)
  return { lineage, head: { ...progress, schemaVersion: PUBLIC_V29_SCHEMA,
    saveRevision: 0, witness: null }, previous: null }
}

const genesisHead = ({ head }: PublicV29SourceReceipt): PublicV29Head => ({
  state: head.state, greenwayWorks: head.greenwayWorks,
  regionalWorks: head.regionalWorks, terrain: head.terrain,
  nextHomeAtMs: head.nextHomeAtMs, riverBridgeIds: head.riverBridgeIds,
  miningTools: emptyPublicV29MiningTools(),
  schemaVersion: PUBLIC_V29_SCHEMA, saveRevision: 0, witness: null })

export function decodePublicV29Witness(value: unknown): PublicV29Witness | null {
  return decodePublicV28Witness(value) ?? decodePublicV29MiningToolWitness(value)
    ?? decodePublicV29DeepDigAction(value) ?? decodePublicV29MineralSale(value)
}

export function replayPublicV29Witness(before: PublicV29Progress,
  rawWitness: unknown): PublicV29Progress | null {
  const witness = decodePublicV29Witness(rawWitness)
  if (!witness) return null
  if (witness.kind === 'mining-tool/v1')
    return applyPublicV29MiningToolAction(owned(before), witness.action).progress ?? null
  if (witness.kind === 'deep-dig')
    return applyPublicV29DeepDig(owned(before), witness).progress ?? null
  if (witness.kind === 'sell-mineral/v1')
    return applyPublicV29MineralSale(owned(before), witness).progress ?? null
  if (witness.kind === 'terrain-action/v1' || witness.kind === 'pit-ladder/v1'
    || witness.kind === 'return-home/v1') {
    // V26 actions require their exact old progress shape, without V28/V29 sidecars.
    const old = { state: before.state, greenwayWorks: before.greenwayWorks,
      regionalWorks: before.regionalWorks, terrain: before.terrain,
      nextHomeAtMs: before.nextHomeAtMs }
    const replayed = replayPublicV27Witness(old, witness)
    const next = replayed && { ...replayed, riverBridgeIds: before.riverBridgeIds }
    return next && publicV28BridgeSitesValid(next)
      && projectPublicV28Pose(next, next.terrain, next.riverBridgeIds)
      ? { ...next, miningTools: before.miningTools } : null
  }
  const next = replayPublicV28Witness({ state: before.state,
    greenwayWorks: before.greenwayWorks, regionalWorks: before.regionalWorks,
    terrain: before.terrain, nextHomeAtMs: before.nextHomeAtMs,
    riverBridgeIds: before.riverBridgeIds }, witness)
  if (!next) return null
  const activePick = next.state.player.equipment.mainHand === null
    ? before.miningTools.activePick : null
  return { ...next, miningTools: { ...before.miningTools, activePick } }
}

function decodeHead(value: unknown, lineage: PublicV29Lineage,
  genesis: PublicV29Head): PublicV29Head | null {
  try {
    if (!exactPublicV23(value, ['schemaVersion', 'saveRevision', 'state',
      'greenwayWorks', 'regionalWorks', 'terrain', 'nextHomeAtMs',
      'riverBridgeIds', 'miningTools', 'witness'])
      || value.schemaVersion !== PUBLIC_V29_SCHEMA || !Number.isSafeInteger(value.saveRevision)
      || (value.saveRevision as number) < 0 || !Number.isSafeInteger(value.nextHomeAtMs)
      || (value.nextHomeAtMs as number) < 0) return null
    const old = decodePublicV23Progress({ state: value.state,
      greenwayWorks: value.greenwayWorks,
      regionalWorks: value.regionalWorks }, lineage.seed)
    const terrain = decodePublicV26TerrainLedger(value.terrain)
    const riverBridgeIds = decodePublicV28BridgeIds(value.riverBridgeIds)
    const miningTools = decodePublicV29MiningTools(value.miningTools)
    if (!old || !terrain || !riverBridgeIds || !miningTools
      || miningTools.activePick !== null && old.state.player.equipment.mainHand !== null
      || !publicV28ResolvedRiverBridges(lineage.seed, riverBridgeIds)
      || !projectPublicV28Pose(old, terrain, riverBridgeIds)) return null
    if (value.saveRevision === 0) return samePublicV14Value(value, genesis)
      ? structuredClone(value) as PublicV29Head : null
    const witness = decodePublicV29Witness(value.witness)
    return witness ? { ...old, terrain, nextHomeAtMs: value.nextHomeAtMs as number,
      riverBridgeIds, miningTools, schemaVersion: PUBLIC_V29_SCHEMA,
      saveRevision: value.saveRevision as number, witness } : null
  } catch { return null }
}

export function decodePublicV29Head(value: unknown,
  rawLineage: PublicV29Lineage): PublicV29Head | null {
  const lineage = decodePublicV29Lineage(rawLineage)
  return lineage ? decodeHead(value, lineage, genesisHead(lineage.sourceReceipt)) : null
}

const preserves = (genesis: PublicV29Head, next: PublicV29Head, seed: string) =>
  preservesPublicV13History(genesis.state as never, next.state as never)
  && preservesPublicV17GreenwayWorks(genesis.greenwayWorks, next.greenwayWorks, seed)
  && genesis.regionalWorks.builtLadderIds.every((id) =>
    next.regionalWorks.builtLadderIds.includes(id))
  && publicV26TerrainConserved(genesis.terrain, next.terrain, seed)
  && publicV28BridgeSitesValid(owned(next))
  && next.state.player.xp >= genesis.state.player.xp + next.riverBridgeIds.length * 80
  && next.state.player.skillXp.construction >=
    genesis.state.player.skillXp.construction + next.riverBridgeIds.length * 80
const keepsBridgesAndTools = (before: PublicV29Head, next: PublicV29Head) =>
  before.riverBridgeIds.every((id) => next.riverBridgeIds.includes(id))
  && (!before.miningTools.basicPickOwned || next.miningTools.basicPickOwned)
  && (!before.miningTools.enchantedPickOwned || next.miningTools.enchantedPickOwned)

/** Complete reload validator, including pinned V28 source and three-slot replay. */
export function decodePublicV29Root(value: unknown): PublicV29Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV29Lineage(value.lineage)
    const genesis = lineage && genesisHead(lineage.sourceReceipt)
    const head = lineage && genesis && decodeHead(value.head, lineage, genesis)
    if (!lineage || !genesis || !head) return null
    const previous = value.previous === null ? null : decodeHead(value.previous, lineage, genesis)
    if (head.saveRevision === 0 ? value.previous !== null : !previous
      || head.saveRevision !== previous.saveRevision + 1 || !head.witness) return null
    if (!preserves(genesis, head, lineage.seed)
      || previous && (!preserves(genesis, previous, lineage.seed)
        || !keepsBridgesAndTools(previous, head))) return null
    if (!previous) return { lineage, head, previous: null }
    if (previous.saveRevision === 1 && !samePublicV14Value(
      replayPublicV29Witness(owned(genesis), previous.witness), owned(previous))) return null
    return samePublicV14Value(replayPublicV29Witness(owned(previous), head.witness), owned(head))
      ? { lineage, head, previous } : null
  } catch { return null }
}

/** Only for a successor whose canonical lineage and previous head match a checked proof. */
export function decodePublicV29CheckedSuccessor(before: PublicV29Root,
  value: unknown): PublicV29Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const genesis = genesisHead(before.lineage.sourceReceipt)
    const head = decodeHead(value.head, before.lineage, genesis)
    if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
      || !preserves(genesis, head, before.lineage.seed)
      || !keepsBridgesAndTools(before.head, head)
      || !samePublicV14Value(replayPublicV29Witness(owned(before.head), head.witness),
        owned(head))) return null
    return { lineage: before.lineage, previous: before.head, head }
  } catch { return null }
}
