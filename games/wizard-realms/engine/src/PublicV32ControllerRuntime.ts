import { createPublicV31ControllerRuntime } from './PublicV31ControllerRuntime'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import type { PublicWorldIntent } from './domain/publicWorldRuntime'
import type { PublicV31Start } from './domain/publicWorldV31Flow'
import { decodePublicV31Witness } from './domain/publicWorldV31Snapshot'
import type { PublicV32Operation, PublicV32Start } from './domain/publicWorldV32Flow'
import type { PublicV32Progress } from './domain/publicWorldV32Migration'
import { confirmPublicV32HighlandAction,
  decodePublicV32HighlandWitness } from './domain/publicWorldV32Highland'
import type { PublicV32HighlandWitness } from './domain/publicWorldV32Highland'
import { decodePublicV32Witness, replayPublicV32Witness } from './domain/publicWorldV32Snapshot'
import type { PublicV32Witness } from './domain/publicWorldV32Snapshot'

type Writer = (revision: number, lineage: PublicV32Start['lineage'],
  witness: PublicV32Witness, frameProof?: (revision: number,
    witness: unknown) => PublicV32Progress | null) => Promise<PublicV32Operation<PublicV32Start>>
type ReturnHomeWriter = (revision: number, lineage: PublicV32Start['lineage']) =>
  Promise<PublicV32Operation<PublicV32Start>>
type V31Action = Parameters<ReturnType<typeof createPublicV31ControllerRuntime>['action']>[0]

const progress = ({ head }: PublicV32Start): PublicV32Progress => ({
  state: head.state, greenwayWorks: head.greenwayWorks,
  regionalWorks: head.regionalWorks, terrain: head.terrain,
  nextHomeAtMs: head.nextHomeAtMs, riverBridgeIds: head.riverBridgeIds,
  miningTools: head.miningTools, claimedBridgeheadId: head.claimedBridgeheadId,
  raisedSoilCells: head.raisedSoilCells })

const asV31Start = (start: PublicV32Start): PublicV31Start => ({
  lineage: structuredClone(start.lineage.sourceReceipt.lineage),
  head: { ...structuredClone(progress(start)), schemaVersion: 'wizard-world/v31',
    saveRevision: start.head.saveRevision,
    witness: decodePublicV31Witness(start.head.witness) } })

/** V31 owns movement and inherited actions. Every durable write is replayed as V32. */
export function createPublicV32ControllerRuntime(initial: PublicV32Start,
  write: Writer, returnHomeWrite?: ReturnHomeWriter, privateFrameProof = false) {
  let committed = structuredClone(initial)
  let blockedReason: string | null = null
  let busy = false
  const freeze = (reason: string) => {
    blockedReason = reason
    return { status: 'blocked' as const, reason }
  }
  const checkedReply = (reply: PublicV32Operation<PublicV32Start>, revision: number,
    witness: PublicV32Witness, expected: PublicV32Progress) => {
    if (!reply.ok) return { ok: false as const, reason: reply.reason }
    try {
      if (reply.value.head.schemaVersion !== 'wizard-world/v32'
        || reply.value.head.saveRevision !== revision + 1
        || !samePublicV14Value(reply.value.lineage, committed.lineage)
        || !samePublicV14Value(reply.value.head.witness, witness)
        || !samePublicV14Value(progress(reply.value), expected))
        return { ok: false as const, reason: 'writer-mismatch' }
      committed = structuredClone(reply.value)
      return { ok: true as const, value: committed }
    } catch { return { ok: false as const, reason: 'writer-mismatch' } }
  }
  const makeCore = () => createPublicV31ControllerRuntime(asV31Start(committed),
    async (revision, _lineage, witness, inheritedProof) => {
      if (revision !== committed.head.saveRevision)
        return { ok: false as const, reason: 'revision-changed' }
      const before = progress(committed)
      let checkedFrame: PublicV32Progress | null = null
      if (privateFrameProof && witness.kind === 'frame-batch/v1' && inheritedProof) {
        const inherited = inheritedProof(revision, witness)
        if (inherited && samePublicV14Value(inherited, core.preview())
          && samePublicV14Value(inherited.state.highland, before.state.highland))
          checkedFrame = inherited
      }
      const expected = checkedFrame ?? replayPublicV32Witness(before, witness)
      if (!expected) return { ok: false as const, reason: 'local-replay' }
      const savedWitness = checkedFrame ? structuredClone(witness) : null
      const savedProgress = savedWitness ? structuredClone(checkedFrame) : null
      let consumed = false
      const proof = savedWitness && savedProgress ? (candidateRevision: number,
        candidateWitness: unknown) => {
        if (consumed) return null
        consumed = true
        return candidateRevision === revision
          && samePublicV14Value(candidateWitness, savedWitness)
          ? savedProgress : null
      } : undefined
      try {
        const reply = proof
          ? await write(revision, structuredClone(committed.lineage), structuredClone(witness), proof)
          : await write(revision, structuredClone(committed.lineage), structuredClone(witness))
        const checked = checkedReply(reply, revision, witness, expected)
        return checked.ok ? { ok: true as const, value: asV31Start(checked.value) }
          : checked
      } catch { return { ok: false as const, reason: 'storage-error' } }
    }, returnHomeWrite ? async (revision) => {
      if (revision !== committed.head.saveRevision)
        return { ok: false as const, reason: 'revision-changed' }
      try {
        const reply = await returnHomeWrite(revision, structuredClone(committed.lineage))
        if (!reply.ok) return reply
        const witness = decodePublicV32Witness(reply.value.head.witness)
        const expected = witness?.kind === 'return-home/v1'
          ? replayPublicV32Witness(progress(committed), witness) : null
        if (!witness || !expected) return { ok: false as const, reason: 'writer-mismatch' }
        const checked = checkedReply(reply, revision, witness, expected)
        return checked.ok ? { ok: true as const, value: asV31Start(checked.value) }
          : checked
      } catch { return { ok: false as const, reason: 'storage-error' } }
    } : undefined, privateFrameProof)
  let core = makeCore()
  return {
    committed: () => structuredClone(committed),
    preview: (): PublicV32Progress => core.preview(),
    view: () => core.view(),
    status: () => blockedReason ? { ...core.status(), gate: 'blocked' as const, blockedReason }
      : busy ? { ...core.status(), gate: 'barrier' as const } : core.status(),
    idleFrameNeeded: () => blockedReason !== null || busy || core.idleFrameNeeded(),
    advanceFrame(intents: readonly PublicWorldIntent[], walkRequested: boolean) {
      if (blockedReason || busy) return { events: [], rejections: [{ intentIndex: 0,
        intentType: intents[0]?.type ?? 'move' as const, code: 'unavailable_here' as const,
        message: 'Movement is paused for a checked write.' }] }
      return core.advanceFrame(intents, walkRequested)
    },
    save: () => blockedReason ? Promise.resolve(freeze(blockedReason))
      : busy ? Promise.resolve({ status: 'busy' as const }) : core.save(),
    returnHome: () => blockedReason ? Promise.resolve(freeze(blockedReason))
      : busy ? Promise.resolve({ status: 'busy' as const }) : core.returnHome(),
    async action(raw: V31Action | PublicV32HighlandWitness) {
      if (blockedReason) return freeze(blockedReason)
      if (busy) return { status: 'busy' as const }
      const highland = decodePublicV32HighlandWitness(raw)
      if (!highland) return core.action(raw as V31Action)
      busy = true
      try {
        // A Highland action cannot race or silently discard a pending movement batch.
        const saved = await core.save()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const before = progress(committed)
        const checkedAction = confirmPublicV32HighlandAction(before, highland)
        if ('rejection' in checkedAction)
          return { status: 'rejected' as const, reason: checkedAction.rejection }
        const expected = replayPublicV32Witness(before, highland)
        if (!expected) return freeze('local-replay')
        const revision = committed.head.saveRevision
        const reply = await write(revision, structuredClone(committed.lineage), highland)
        const checked = checkedReply(reply, revision, highland, expected)
        if (!checked.ok) return freeze(checked.reason)
        core = makeCore()
        return { status: 'saved' as const, events: [], resetWalkRequested: false }
      } catch { return freeze('storage-error') }
      finally { busy = false }
    },
  }
}
