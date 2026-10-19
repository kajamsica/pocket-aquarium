import { createPublicV32ControllerRuntime } from './PublicV32ControllerRuntime'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import type { PublicWorldIntent } from './domain/publicWorldRuntime'
import type { PublicV32Start } from './domain/publicWorldV32Flow'
import { decodePublicV32Witness } from './domain/publicWorldV32Snapshot'
import type { PublicV33Operation, PublicV33Start } from './domain/publicWorldV33Flow'
import { confirmPublicV33FairyRingAction,
  decodePublicV33FairyRingWitness } from './domain/publicWorldV33FairyRing'
import type { PublicV33FairyRingWitness } from './domain/publicWorldV33FairyRing'
import type { PublicV33Progress } from './domain/publicWorldV33Migration'
import { decodePublicV33Witness, replayPublicV33Witness } from './domain/publicWorldV33Snapshot'
import type { PublicV33Witness } from './domain/publicWorldV33Snapshot'

type Writer = (revision: number, lineage: PublicV33Start['lineage'],
  witness: PublicV33Witness, frameProof?: (revision: number,
    witness: unknown) => PublicV33Progress | null) => Promise<PublicV33Operation<PublicV33Start>>
type ReturnHomeWriter = (revision: number, lineage: PublicV33Start['lineage']) =>
  Promise<PublicV33Operation<PublicV33Start>>
type V32Action = Parameters<ReturnType<typeof createPublicV32ControllerRuntime>['action']>[0]

const progress = ({ head }: PublicV33Start): PublicV33Progress => ({
  state: head.state, greenwayWorks: head.greenwayWorks,
  regionalWorks: head.regionalWorks, terrain: head.terrain,
  nextHomeAtMs: head.nextHomeAtMs, riverBridgeIds: head.riverBridgeIds,
  miningTools: head.miningTools, claimedBridgeheadId: head.claimedBridgeheadId,
  raisedSoilCells: head.raisedSoilCells })

const asV32Start = (start: PublicV33Start): PublicV32Start => ({
  lineage: structuredClone(start.lineage.sourceReceipt.lineage),
  head: { ...structuredClone(progress(start)), schemaVersion: 'wizard-world/v32',
    saveRevision: start.head.saveRevision,
    witness: decodePublicV32Witness(start.head.witness) } })

/** V32 owns inherited play. Ring travel commits one checked V33 witness, then rebuilds it. */
export function createPublicV33ControllerRuntime(initial: PublicV33Start,
  write: Writer, returnHomeWrite?: ReturnHomeWriter) {
  let committed = structuredClone(initial)
  let blockedReason: string | null = null
  let busy = false
  const freeze = (reason: string) => {
    blockedReason = reason
    return { status: 'blocked' as const, reason }
  }
  const checkedReply = (reply: PublicV33Operation<PublicV33Start>, revision: number,
    witness: PublicV33Witness, expected: PublicV33Progress) => {
    if (!reply.ok) return { ok: false as const, reason: reply.reason }
    try {
      if (reply.value.head.schemaVersion !== 'wizard-world/v33'
        || reply.value.head.saveRevision !== revision + 1
        || !samePublicV14Value(reply.value.lineage, committed.lineage)
        || !samePublicV14Value(reply.value.head.witness, witness)
        || !samePublicV14Value(progress(reply.value), expected))
        return { ok: false as const, reason: 'writer-mismatch' }
      committed = structuredClone(reply.value)
      return { ok: true as const, value: committed }
    } catch { return { ok: false as const, reason: 'writer-mismatch' } }
  }
  const makeCore = () => createPublicV32ControllerRuntime(asV32Start(committed),
    async (revision, _lineage, witness, inheritedProof) => {
      if (revision !== committed.head.saveRevision)
        return { ok: false as const, reason: 'revision-changed' }
      const before = progress(committed)
      let checkedFrame: PublicV33Progress | null = null
      if (witness.kind === 'frame-batch/v1' && inheritedProof) {
        const inherited = inheritedProof(revision, witness)
        if (inherited && samePublicV14Value(inherited, core.preview())
          && samePublicV14Value(inherited.state.player.discoveredRingIds,
            before.state.player.discoveredRingIds)
          && samePublicV14Value(inherited.state.greenway.fairyRings,
            before.state.greenway.fairyRings)) checkedFrame = inherited
      }
      const expected = checkedFrame ?? replayPublicV33Witness(before, witness)
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
        return checked.ok ? { ok: true as const, value: asV32Start(checked.value) }
          : checked
      } catch { return { ok: false as const, reason: 'storage-error' } }
    }, returnHomeWrite ? async (revision) => {
      if (revision !== committed.head.saveRevision)
        return { ok: false as const, reason: 'revision-changed' }
      try {
        const reply = await returnHomeWrite(revision, structuredClone(committed.lineage))
        if (!reply.ok) return reply
        const witness = decodePublicV33Witness(reply.value.head.witness)
        const expected = witness?.kind === 'return-home/v1'
          ? replayPublicV33Witness(progress(committed), witness) : null
        if (!witness || !expected) return { ok: false as const, reason: 'writer-mismatch' }
        const checked = checkedReply(reply, revision, witness, expected)
        return checked.ok ? { ok: true as const, value: asV32Start(checked.value) }
          : checked
      } catch { return { ok: false as const, reason: 'storage-error' } }
    } : undefined, true)
  let core = makeCore()
  return {
    committed: () => structuredClone(committed),
    preview: (): PublicV33Progress => core.preview(),
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
    async action(raw: V32Action | PublicV33FairyRingWitness) {
      if (blockedReason) return freeze(blockedReason)
      if (busy) return { status: 'busy' as const }
      const fairy = decodePublicV33FairyRingWitness(raw)
      if (!fairy) return core.action(raw as V32Action)
      busy = true
      try {
        const saved = await core.save()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const before = progress(committed)
        const checkedAction = confirmPublicV33FairyRingAction(before, fairy)
        if ('rejection' in checkedAction)
          return { status: 'rejected' as const, reason: checkedAction.rejection }
        const expected = replayPublicV33Witness(before, fairy)
        if (!expected) return freeze('local-replay')
        const revision = committed.head.saveRevision
        const reply = await write(revision, structuredClone(committed.lineage), fairy)
        const checked = checkedReply(reply, revision, fairy, expected)
        if (!checked.ok) return freeze(checked.reason)
        core = makeCore()
        return { status: 'saved' as const, events: [], resetWalkRequested: false }
      } catch { return freeze('storage-error') }
      finally { busy = false }
    },
  }
}
