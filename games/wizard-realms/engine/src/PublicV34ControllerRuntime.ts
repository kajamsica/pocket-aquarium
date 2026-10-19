import { createPublicV33ControllerRuntime } from './PublicV33ControllerRuntime'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import { exactPublicV23 } from './domain/publicWorldV23Snapshot'
import type { PublicV33Progress } from './domain/publicWorldV33Migration'
import { decodePublicV33Witness, replayPublicV33Witness } from './domain/publicWorldV33Snapshot'
import type { PublicV33Witness } from './domain/publicWorldV33Snapshot'
import type { PublicV33Start } from './domain/publicWorldV33Flow'
import { decodePublicV34Lineage, PUBLIC_V34_SCHEMA } from './domain/publicWorldV34Snapshot'
import type { PublicV34Operation, PublicV34Start } from './domain/publicWorldV34Flow'

type Writer = (revision: number, lineage: PublicV34Start['lineage'],
  witness: PublicV33Witness) => Promise<PublicV34Operation<PublicV34Start>>
type ReturnHomeWriter = (revision: number, lineage: PublicV34Start['lineage']) =>
  Promise<PublicV34Operation<PublicV34Start>>

const progress = ({ head }: PublicV34Start): PublicV33Progress => ({
  state: head.state, greenwayWorks: head.greenwayWorks,
  regionalWorks: head.regionalWorks, terrain: head.terrain,
  nextHomeAtMs: head.nextHomeAtMs, riverBridgeIds: head.riverBridgeIds,
  miningTools: head.miningTools, claimedBridgeheadId: head.claimedBridgeheadId,
  raisedSoilCells: head.raisedSoilCells })

/** Legacy controllers inspect five nested lineage links only to build inner simulations. */
function simulationLineage(): PublicV33Start['lineage'] {
  let link: unknown = { simulationOnly: 'v34' }
  for (let depth = 0; depth < 5; depth++) link = { sourceReceipt: { lineage: link } }
  return link as PublicV33Start['lineage']
}

/** The shell never crosses the V34 writer or the public committed() boundary. */
export function createPublicV34ControllerRuntime(initial: PublicV34Start,
  write: Writer, returnHomeWrite?: ReturnHomeWriter) {
  let committed: PublicV34Start = structuredClone({ head: initial.head, lineage: initial.lineage })
  const shell = simulationLineage()
  const asV33Start = (start: PublicV34Start): PublicV33Start => ({
    lineage: structuredClone(shell),
    head: { ...structuredClone(progress(start)), schemaVersion: 'wizard-world/v33',
      saveRevision: start.head.saveRevision,
      witness: decodePublicV33Witness(start.head.witness) } })
  const checked = (reply: PublicV34Operation<PublicV34Start>, revision: number,
    witness: PublicV33Witness, expected: PublicV33Progress) => {
    if (!reply.ok) return { ok: false as const, reason: reply.reason }
    try {
      const { head, lineage } = reply.value
      if (!exactPublicV23(reply.value, ['head', 'lineage'])
        || !exactPublicV23(head, ['state', 'greenwayWorks', 'regionalWorks', 'terrain',
        'nextHomeAtMs', 'riverBridgeIds', 'miningTools', 'claimedBridgeheadId',
        'raisedSoilCells', 'schemaVersion', 'saveRevision', 'witness'])
        || head.schemaVersion !== PUBLIC_V34_SCHEMA || head.saveRevision !== revision + 1
        || !decodePublicV34Lineage(lineage)
        || !samePublicV14Value(lineage, committed.lineage)
        || !samePublicV14Value(head.witness, witness)
        || !samePublicV14Value(progress(reply.value), expected))
        return { ok: false as const, reason: 'writer-mismatch' }
      committed = structuredClone(reply.value)
      return { ok: true as const, value: asV33Start(committed) }
    } catch { return { ok: false as const, reason: 'writer-mismatch' } }
  }
  const core = createPublicV33ControllerRuntime(asV33Start(committed),
    async (revision, _simulationLineage, witness, inheritedProof) => {
      if (revision !== committed.head.saveRevision)
        return { ok: false as const, reason: 'revision-changed' }
      const inherited = witness.kind === 'frame-batch/v1' && inheritedProof
        ? inheritedProof(revision, witness) : null
      const checkedFrame = inherited && samePublicV14Value(inherited, core.preview())
        ? inherited : null
      const expected = checkedFrame ?? replayPublicV33Witness(progress(committed), witness)
      if (!expected) return { ok: false as const, reason: 'local-replay' }
      try { return checked(await write(revision, structuredClone(committed.lineage),
        structuredClone(witness)), revision, witness, expected) }
      catch { return { ok: false as const, reason: 'storage-error' } }
    }, returnHomeWrite ? async (revision, _simulationLineage) => {
      if (revision !== committed.head.saveRevision)
        return { ok: false as const, reason: 'revision-changed' }
      try {
        const reply = await returnHomeWrite(revision, structuredClone(committed.lineage))
        if (!reply.ok) return reply
        const witness = decodePublicV33Witness(reply.value.head.witness)
        const expected = witness?.kind === 'return-home/v1'
          ? replayPublicV33Witness(progress(committed), witness) : null
        return witness && expected ? checked(reply, revision, witness, expected)
          : { ok: false as const, reason: 'writer-mismatch' }
      } catch { return { ok: false as const, reason: 'storage-error' } }
    } : undefined)
  return { ...core, committed: () => structuredClone(committed) }
}
