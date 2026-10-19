import { preservesPublicV13History } from './publicV13History'
import { preservesPublicV17GreenwayWorks } from './publicWorldV17Validation'
import { samePublicV14Value } from './publicWorldV14Validation'
import { publicV25StratumAt } from './publicWorldV25Strata'
import { publicV26TerrainConserved } from './publicWorldV26TerrainConservation'
import { publicV28BridgeSitesValid } from './publicWorldV28RiverBridgeAction'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { canonicalClaim, decodePublicV30Witness,
  replayPublicV30Witness } from './publicWorldV30Snapshot'
import type { PublicV30Witness } from './publicWorldV30Snapshot'
import type { PublicV30Progress } from './publicWorldV30Migration'
import { createPublicV31Migration, decodePublicV31Lineage,
  PUBLIC_V31_SCHEMA } from './publicWorldV31Migration'
import type { PublicV31Lineage, PublicV31Progress } from './publicWorldV31Migration'
import { replayPublicV31FramesWithEvents,
  replayPublicV31ReturnHome } from './publicWorldV31Movement'
import { confirmPublicV31SoilAction, decodePublicV31ActionProgress,
  decodePublicV31SoilWitness, publicV31HasRaisedSoilCell } from './publicWorldV31Soil'
import type { PublicV31SoilWitness } from './publicWorldV31Soil'

export type PublicV31Witness = PublicV30Witness | PublicV31SoilWitness
export type PublicV31Head = PublicV31Progress & Readonly<{
  schemaVersion: typeof PUBLIC_V31_SCHEMA; saveRevision: number; witness: PublicV31Witness | null
}>
export type PublicV31Root = Readonly<{ lineage: PublicV31Lineage;
  head: PublicV31Head; previous: PublicV31Head | null }>

const inherited = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId }: PublicV30Progress): PublicV30Progress =>
  ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs, riverBridgeIds,
    miningTools, claimedBridgeheadId })
const owned = ({ raisedSoilCells, ...rest }: PublicV31Progress): PublicV31Progress =>
  ({ ...inherited(rest), raisedSoilCells })

export function createPublicV31Root(rawV30Root: unknown): PublicV31Root {
  const { lineage, progress } = createPublicV31Migration(rawV30Root)
  return { lineage, head: { ...progress, schemaVersion: PUBLIC_V31_SCHEMA,
    saveRevision: 0, witness: null }, previous: null }
}

const genesisHead = (lineage: PublicV31Lineage): PublicV31Head => ({
  ...inherited(lineage.sourceReceipt.head), raisedSoilCells: [],
  schemaVersion: PUBLIC_V31_SCHEMA, saveRevision: 0, witness: null,
})

export function decodePublicV31Witness(value: unknown): PublicV31Witness | null {
  return decodePublicV30Witness(value) ?? decodePublicV31SoilWitness(value)
}

/** Deterministic replay. V30 mutations retain the V31 ledger exactly. */
export function replayPublicV31Witness(before: PublicV31Progress,
  rawWitness: unknown): PublicV31Progress | null {
  const witness = decodePublicV31Witness(rawWitness)
  const progress = decodePublicV31ActionProgress(owned(before))
  if (!witness || !progress) return null
  if (witness.kind === 'soil-place/v1' || witness.kind === 'soil-remove/v1')
    return confirmPublicV31SoilAction(progress, witness).progress ?? null
  if (witness.kind === 'terrain-action/v1' && witness.action.kind === 'dig'
    && publicV31HasRaisedSoilCell(progress.raisedSoilCells,
      witness.action.gx, witness.action.gz)) {
    return confirmPublicV31SoilAction(progress, { kind: 'soil-remove/v1',
      gx: witness.action.gx, gz: witness.action.gz }).progress ?? null
  }
  if (witness.kind === 'deep-dig' && publicV31HasRaisedSoilCell(progress.raisedSoilCells,
    witness.gx, witness.gz)) return null
  if (witness.kind === 'frame-batch/v1')
    return replayPublicV31FramesWithEvents(progress, witness.frames)?.progress ?? null
  if (witness.kind === 'return-home/v1')
    return replayPublicV31ReturnHome(progress, witness.atMs)
  const next = replayPublicV30Witness(inherited(progress), witness)
  return next ? decodePublicV31ActionProgress({ ...next,
    raisedSoilCells: progress.raisedSoilCells }) : null
}

function decodeHead(value: unknown, lineage: PublicV31Lineage,
  genesis: PublicV31Head): PublicV31Head | null {
  try {
    if (!exactPublicV23(value, ['schemaVersion', 'saveRevision', 'state',
      'greenwayWorks', 'regionalWorks', 'terrain', 'nextHomeAtMs', 'riverBridgeIds',
      'miningTools', 'claimedBridgeheadId', 'raisedSoilCells', 'witness'])
      || value.schemaVersion !== PUBLIC_V31_SCHEMA || !Number.isSafeInteger(value.saveRevision)
      || (value.saveRevision as number) < 0) return null
    const progress = decodePublicV31ActionProgress({ state: value.state,
      greenwayWorks: value.greenwayWorks, regionalWorks: value.regionalWorks,
      terrain: value.terrain, nextHomeAtMs: value.nextHomeAtMs,
      riverBridgeIds: value.riverBridgeIds, miningTools: value.miningTools,
      claimedBridgeheadId: value.claimedBridgeheadId,
      raisedSoilCells: value.raisedSoilCells } as PublicV31Progress)
    if (!progress || progress.state.seed !== lineage.seed) return null
    if (value.saveRevision === 0) return samePublicV14Value(value, genesis)
      ? structuredClone(value) as PublicV31Head : null
    const witness = decodePublicV31Witness(value.witness)
    return witness ? { ...progress, schemaVersion: PUBLIC_V31_SCHEMA,
      saveRevision: value.saveRevision as number, witness } : null
  } catch { return null }
}

export function decodePublicV31Head(value: unknown,
  rawLineage: PublicV31Lineage): PublicV31Head | null {
  const lineage = decodePublicV31Lineage(rawLineage)
  return lineage ? decodeHead(value, lineage, genesisHead(lineage)) : null
}

/** Bagged and placed soil together may never exceed source soil plus earned strata. */
export function publicV31RaisedSoilConserved(genesis: PublicV31Progress,
  candidate: PublicV31Progress, seed: string): boolean {
  if (!publicV26TerrainConserved(genesis.terrain, candidate.terrain, seed)) return false
  const baseline = new Map(genesis.terrain.columns.map((column) =>
    [`${column.gx},${column.gz}`, column.rewardDepth]))
  let allowed = genesis.terrain.bag.soil + genesis.raisedSoilCells.length
  for (const column of candidate.terrain.columns) {
    const from = baseline.get(`${column.gx},${column.gz}`) ?? 0
    for (let layer = from; layer < column.rewardDepth; layer += 1) {
      if (publicV25StratumAt(seed, column.gx, column.gz, layer).material === 'soil') allowed += 1
    }
  }
  return candidate.terrain.bag.soil + candidate.raisedSoilCells.length <= allowed
}

const preserves = (genesis: PublicV31Head, next: PublicV31Head, seed: string) =>
  preservesPublicV13History(genesis.state as never, next.state as never)
  && preservesPublicV17GreenwayWorks(genesis.greenwayWorks, next.greenwayWorks, seed)
  && genesis.regionalWorks.builtLadderIds.every((id) =>
    next.regionalWorks.builtLadderIds.includes(id))
  && publicV31RaisedSoilConserved(genesis, next, seed)
  && publicV28BridgeSitesValid(inherited(next))
  && canonicalClaim(inherited(next))
  && next.state.player.xp >= genesis.state.player.xp + next.riverBridgeIds.length * 80
  && next.state.player.skillXp.construction >=
    genesis.state.player.skillXp.construction + next.riverBridgeIds.length * 80
const monotonic = (before: PublicV31Head, next: PublicV31Head) =>
  before.riverBridgeIds.every((id) => next.riverBridgeIds.includes(id))
  && (!before.miningTools.basicPickOwned || next.miningTools.basicPickOwned)
  && (!before.miningTools.enchantedPickOwned || next.miningTools.enchantedPickOwned)
  && (before.claimedBridgeheadId === null
    || before.claimedBridgeheadId === next.claimedBridgeheadId)

/** Full pinned V30 ancestry, conservation, and three-slot witness replay. */
export function decodePublicV31Root(value: unknown): PublicV31Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV31Lineage(value.lineage)
    const genesis = lineage && genesisHead(lineage)
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
      replayPublicV31Witness(owned(genesis), previous.witness), owned(previous))) return null
    return samePublicV14Value(replayPublicV31Witness(owned(previous), head.witness), owned(head))
      ? { lineage, head, previous } : null
  } catch { return null }
}

/** Used only after a locked check proves unchanged lineage and previous head. */
export function decodePublicV31CheckedSuccessor(before: PublicV31Root,
  value: unknown): PublicV31Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const genesis = genesisHead(before.lineage)
    const head = decodeHead(value.head, before.lineage, genesis)
    if (!head || !head.witness || head.saveRevision !== before.head.saveRevision + 1
      || !preserves(genesis, head, before.lineage.seed)
      || !monotonic(before.head, head)
      || !samePublicV14Value(replayPublicV31Witness(owned(before.head), head.witness),
        owned(head))) return null
    return { lineage: before.lineage, previous: before.head, head }
  } catch { return null }
}
