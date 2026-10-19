import { discoveryMaskHasTileId } from './discoveryMask'
import { highlandLandmark, highlandStoneNodes } from './highlandContent'
import { preservesPublicV13History } from './publicV13History'
import { preservesPublicV17GreenwayWorks } from './publicWorldV17Validation'
import { samePublicV14Value } from './publicWorldV14Validation'
import { publicV28BridgeSitesValid } from './publicWorldV28RiverBridgeAction'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { canonicalClaim } from './publicWorldV30Snapshot'
import type { PublicV30Progress } from './publicWorldV30Migration'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { decodePublicV31Witness, publicV31RaisedSoilConserved,
  replayPublicV31Witness } from './publicWorldV31Snapshot'
import type { PublicV31Witness } from './publicWorldV31Snapshot'
import { confirmPublicV32HighlandAction, decodePublicV32HighlandWitness } from './publicWorldV32Highland'
import type { PublicV32HighlandWitness } from './publicWorldV32Highland'
import { createPublicV32Migration, decodePublicV32Lineage,
  PUBLIC_V32_SCHEMA } from './publicWorldV32Migration'
import type { PublicV32Lineage, PublicV32Progress } from './publicWorldV32Migration'

export type PublicV32Witness = PublicV31Witness | PublicV32HighlandWitness
export type PublicV32Head = PublicV32Progress & Readonly<{
  schemaVersion: typeof PUBLIC_V32_SCHEMA; saveRevision: number; witness: PublicV32Witness | null
}>
export type PublicV32Root = Readonly<{ lineage: PublicV32Lineage;
  head: PublicV32Head; previous: PublicV32Head | null }>

const owned = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells }: PublicV32Progress):
  PublicV32Progress => ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells })
const inherited = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId }: PublicV32Progress): PublicV30Progress =>
  ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs, riverBridgeIds,
    miningTools, claimedBridgeheadId })

export function createPublicV32Root(rawV31Root: unknown): PublicV32Root {
  const { lineage, progress } = createPublicV32Migration(rawV31Root)
  return { lineage, head: { ...progress, schemaVersion: PUBLIC_V32_SCHEMA,
    saveRevision: 0, witness: null }, previous: null }
}

const genesisHead = (lineage: PublicV32Lineage): PublicV32Head => {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...progress } = lineage.sourceReceipt.head
  return { ...owned(progress), schemaVersion: PUBLIC_V32_SCHEMA,
    saveRevision: 0, witness: null }
}

export function decodePublicV32Witness(value: unknown): PublicV32Witness | null {
  return decodePublicV32HighlandWitness(value) ?? decodePublicV31Witness(value)
}

/** Old actions retain their V31 authority and may not mutate Highland progress. */
export function replayPublicV32Witness(before: PublicV32Progress,
  rawWitness: unknown): PublicV32Progress | null {
  const witness = decodePublicV32Witness(rawWitness)
  const progress = decodePublicV31ActionProgress(owned(before))
  if (!witness || !progress) return null
  if (witness.kind === 'highland-discover/v1' || witness.kind === 'highland-extract/v1')
    return confirmPublicV32HighlandAction(progress, witness).progress ?? null
  const next = replayPublicV31Witness(progress, witness)
  return next && samePublicV14Value(next.state.highland, progress.state.highland)
    ? next : null
}

function decodeHead(value: unknown, lineage: PublicV32Lineage,
  genesis: PublicV32Head): PublicV32Head | null {
  try {
    if (!exactPublicV23(value, ['schemaVersion', 'saveRevision', 'state',
      'greenwayWorks', 'regionalWorks', 'terrain', 'nextHomeAtMs', 'riverBridgeIds',
      'miningTools', 'claimedBridgeheadId', 'raisedSoilCells', 'witness'])
      || value.schemaVersion !== PUBLIC_V32_SCHEMA || !Number.isSafeInteger(value.saveRevision)
      || (value.saveRevision as number) < 0) return null
    const progress = decodePublicV31ActionProgress({ state: value.state,
      greenwayWorks: value.greenwayWorks, regionalWorks: value.regionalWorks,
      terrain: value.terrain, nextHomeAtMs: value.nextHomeAtMs,
      riverBridgeIds: value.riverBridgeIds, miningTools: value.miningTools,
      claimedBridgeheadId: value.claimedBridgeheadId,
      raisedSoilCells: value.raisedSoilCells } as PublicV32Progress)
    if (!progress || progress.state.seed !== lineage.seed) return null
    if (value.saveRevision === 0) return samePublicV14Value(value, genesis)
      ? structuredClone(value) as PublicV32Head : null
    const witness = decodePublicV32Witness(value.witness)
    if (witness?.kind === 'highland-extract/v1'
      && !highlandStoneNodes(progress.state.seed).some(({ id }) => id === witness.nodeId))
      return null
    return witness ? { ...progress, schemaVersion: PUBLIC_V32_SCHEMA,
      saveRevision: value.saveRevision as number, witness } : null
  } catch { return null }
}

export function decodePublicV32Head(value: unknown,
  rawLineage: PublicV32Lineage): PublicV32Head | null {
  const lineage = decodePublicV32Lineage(rawLineage)
  return lineage ? decodeHead(value, lineage, genesisHead(lineage)) : null
}

export function publicV32Preserves(genesis: PublicV32Progress,
  next: PublicV32Progress, seed: string): boolean {
  const baseline = genesis.state.highland.stoneNodes
  const nodes = next.state.highland.stoneNodes
  const newlyExtracted = nodes.filter((entry, index) =>
    entry.readyAtTick > baseline[index].readyAtTick).length
  const newlyBuiltBridges = next.riverBridgeIds.filter((id) =>
    !genesis.riverBridgeIds.includes(id)).length
  const heldStone = (head: PublicV32Progress) => head.state.player.inventory
    .filter((row) => row.itemId === 'stone').reduce((sum, row) => sum + row.quantity, 0)
    + head.state.player.tradeSlots.filter((row) => row.itemId === 'stone')
      .reduce((sum, row) => sum + row.quantity, 0)
  const oneShotStone = next.state.greenway.excavatedDigSiteIds
    .filter((id) => !genesis.state.greenway.excavatedDigSiteIds.includes(id))
    .reduce((sum, id) => {
      const site = next.state.greenway.digSites.find((row) => row.id === id)
      return sum + (site?.reward.itemId === 'stone' ? site.reward.quantity : 0)
    }, 0)
    + next.state.mireglass.dugStumpIds.filter((id) =>
      !genesis.state.mireglass.dugStumpIds.includes(id)).length
    + next.state.terrainWorks.dugTileIds.filter((id) =>
      !genesis.state.terrainWorks.dugTileIds.includes(id)).length
    + next.greenwayWorks.dugTileIds.filter((id) =>
      !genesis.greenwayWorks.dugTileIds.includes(id)).length
  // The node only records its latest recovery time. This is a physical upper
  // bound on possible V32 harvests, not an authentication of old local saves.
  const quarryStone = nodes.reduce((sum, entry, index) => {
    const earliest = Math.max(genesis.state.tick, baseline[index].readyAtTick)
    return sum + 2 * Math.max(0, Math.floor((entry.readyAtTick - earliest) / 3000))
  }, 0)
  return preservesPublicV13History(genesis.state as never, next.state as never)
    && preservesPublicV17GreenwayWorks(genesis.greenwayWorks, next.greenwayWorks, seed)
    && genesis.regionalWorks.builtLadderIds.every((id) =>
      next.regionalWorks.builtLadderIds.includes(id))
    && publicV31RaisedSoilConserved(genesis, next, seed)
    && publicV28BridgeSitesValid(inherited(next))
    && canonicalClaim(inherited(next))
    && next.state.player.xp >= genesis.state.player.xp + newlyBuiltBridges * 80
      + newlyExtracted * 20
    && next.state.player.skillXp.construction >=
      genesis.state.player.skillXp.construction + newlyBuiltBridges * 80
    && next.state.player.skillXp.excavation >=
      genesis.state.player.skillXp.excavation + newlyExtracted * 20
    && heldStone(next) <= heldStone(genesis) + oneShotStone + quarryStone
    && (!genesis.state.highland.landmarkDiscovered
      || next.state.highland.landmarkDiscovered)
    && (genesis.state.highland.landmarkDiscovered
      || !next.state.highland.landmarkDiscovered
      || discoveryMaskHasTileId(next.state.discoveryMask, highlandLandmark(seed).tile.id))
    && nodes.every((entry, index) => entry.readyAtTick >= baseline[index].readyAtTick)
}

export function publicV32Monotonic(before: PublicV32Progress,
  next: PublicV32Progress): boolean {
  return before.riverBridgeIds.every((id) => next.riverBridgeIds.includes(id))
    && (!before.miningTools.basicPickOwned || next.miningTools.basicPickOwned)
    && (!before.miningTools.enchantedPickOwned || next.miningTools.enchantedPickOwned)
    && (before.claimedBridgeheadId === null
      || before.claimedBridgeheadId === next.claimedBridgeheadId)
    && (!before.state.highland.landmarkDiscovered
      || next.state.highland.landmarkDiscovered)
    && next.state.highland.stoneNodes.every((entry, index) =>
      entry.readyAtTick >= before.state.highland.stoneNodes[index].readyAtTick)
}

/** Complete V31 ancestry, structural conservation, and three-slot witness replay. */
export function decodePublicV32Root(value: unknown): PublicV32Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV32Lineage(value.lineage)
    const genesis = lineage && genesisHead(lineage)
    const head = lineage && genesis && decodeHead(value.head, lineage, genesis)
    if (!lineage || !genesis || !head) return null
    const previous = value.previous === null ? null : decodeHead(value.previous, lineage, genesis)
    if (head.saveRevision === 0 ? value.previous !== null : !previous
      || head.saveRevision !== previous.saveRevision + 1 || !head.witness) return null
    if (!publicV32Preserves(genesis, head, lineage.seed)
      || previous && (!publicV32Preserves(genesis, previous, lineage.seed)
        || !publicV32Monotonic(previous, head))) return null
    if (!previous) return { lineage, head, previous: null }
    if (previous.saveRevision === 1 && !samePublicV14Value(
      replayPublicV32Witness(owned(genesis), previous.witness), owned(previous))) return null
    return samePublicV14Value(replayPublicV32Witness(owned(previous), head.witness), owned(head))
      ? { lineage, head, previous } : null
  } catch { return null }
}

/** Used only after a locked check proves unchanged lineage and previous head. */
export function decodePublicV32CheckedSuccessor(before: PublicV32Root,
  value: unknown): PublicV32Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const genesis = genesisHead(before.lineage)
    const head = decodeHead(value.head, before.lineage, genesis)
    if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
      || !publicV32Preserves(genesis, head, before.lineage.seed)
      || !publicV32Monotonic(before.head, head)
      || !samePublicV14Value(replayPublicV32Witness(owned(before.head), head.witness),
        owned(head))) return null
    return { lineage: before.lineage, previous: before.head, head }
  } catch { return null }
}
