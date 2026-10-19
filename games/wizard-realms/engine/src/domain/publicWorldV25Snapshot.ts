import { preservesPublicV13History } from './publicV13History'
import { preservesPublicV17GreenwayWorks } from './publicWorldV17Validation'
import { samePublicV14Value } from './publicWorldV14Validation'
import { decodePublicV23Progress, exactPublicV23 } from './publicWorldV23Snapshot'
import { visitPublicV23Frames } from './publicWorldV23Transitions'
import { decodePublicV24Witness, replayPublicV24Witness } from './publicWorldV24Snapshot'
import type { PublicV24Progress, PublicV24Witness } from './publicWorldV24Snapshot'
import { decodePublicV25ExcavationLedger, emptyPublicV25ExcavationLedger } from './publicWorldV25Excavation'
import type { PublicV25ExcavationLedger } from './publicWorldV25Excavation'
import { createPublicV25Migration, decodePublicV25Lineage, PUBLIC_V25_SCHEMA } from './publicWorldV25Migration'
import type { PublicV25Lineage } from './publicWorldV25Migration'
import { publicV25RiverPassage } from './publicWorldV25Passage'

export type PublicV25Head = PublicV24Progress & Readonly<{
  schemaVersion: typeof PUBLIC_V25_SCHEMA; saveRevision: number
  excavation: PublicV25ExcavationLedger; witness: PublicV24Witness | null
}>
export type PublicV25Root = Readonly<{ lineage: PublicV25Lineage;
  head: PublicV25Head; previous: PublicV25Head | null }>

export function createPublicV25Root(rawV24Receipt: unknown): PublicV25Root {
  const { lineage, progress } = createPublicV25Migration(rawV24Receipt)
  return { lineage, head: { ...progress, schemaVersion: PUBLIC_V25_SCHEMA,
    saveRevision: 0, excavation: emptyPublicV25ExcavationLedger(), witness: null }, previous: null }
}

/** Head shape proof. Root replay is checked separately below. */
export function decodePublicV25Head(value: unknown, lineage: PublicV25Lineage): PublicV25Head | null {
  try {
    const checkedLineage = decodePublicV25Lineage(lineage)
    if (!checkedLineage || !exactPublicV23(value, ['schemaVersion', 'saveRevision', 'state',
      'greenwayWorks', 'regionalWorks', 'excavation', 'witness'])
      || value.schemaVersion !== PUBLIC_V25_SCHEMA || !Number.isSafeInteger(value.saveRevision)
      || (value.saveRevision as number) < 0) return null
    const owned = decodePublicV23Progress({ state: value.state, greenwayWorks: value.greenwayWorks,
      regionalWorks: value.regionalWorks }, checkedLineage.seed)
    const excavation = decodePublicV25ExcavationLedger(value.excavation)
    if (!owned || !excavation) return null
    if (value.saveRevision === 0) return samePublicV14Value(value,
      createPublicV25Root(checkedLineage.sourceReceipt).head) ? structuredClone(value) as PublicV25Head : null
    const witness = decodePublicV24Witness(value.witness)
    return witness ? { ...owned, schemaVersion: PUBLIC_V25_SCHEMA,
      saveRevision: value.saveRevision as number, excavation, witness } : null
  } catch { return null }
}

const progress = ({ state, greenwayWorks, regionalWorks }: PublicV25Head): PublicV24Progress =>
  ({ state, greenwayWorks, regionalWorks })

/** Exact three-slot root proof, including every frame's V25 river crossing. */
export function decodePublicV25Root(value: unknown): PublicV25Root | null {
  try {
    if (!exactPublicV23(value, ['lineage', 'head', 'previous'])) return null
    const lineage = decodePublicV25Lineage(value.lineage)
    const head = lineage && decodePublicV25Head(value.head, lineage)
    if (!lineage || !head) return null
    const previous = value.previous === null ? null : decodePublicV25Head(value.previous, lineage)
    if (head.saveRevision === 0 ? value.previous !== null : !previous
      || head.saveRevision !== previous.saveRevision + 1 || !head.witness) return null
    const genesis = createPublicV25Root(lineage.sourceReceipt).head
    const preserves = (prior: PublicV25Head, next: PublicV25Head) =>
      preservesPublicV13History(prior.state as never, next.state as never)
      && preservesPublicV17GreenwayWorks(prior.greenwayWorks, next.greenwayWorks, lineage.seed)
      && prior.regionalWorks.builtLadderIds.every((id) => next.regionalWorks.builtLadderIds.includes(id))
    if (!preserves(genesis, head) || previous && !preserves(genesis, previous)) return null
    if (!previous) return { lineage, head, previous: null }
    if (!samePublicV14Value(previous.excavation, head.excavation)) return null
    const replayed = head.witness?.kind === 'frame-batch/v1'
      ? visitPublicV23Frames(progress(previous), head.witness.frames, (before, after) =>
        publicV25RiverPassage(before, before.state.player.position, after.state.player.position).ok)
      : replayPublicV24Witness(progress(previous), head.witness)
    if (!samePublicV14Value(replayed, progress(head))) return null
    return { lineage, head, previous }
  } catch { return null }
}
