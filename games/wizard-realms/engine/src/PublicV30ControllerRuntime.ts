import { samePublicV14Value } from './domain/publicWorldV14Validation'
import type { PublicWorldIntent } from './domain/publicWorldRuntime'
import { confirmPublicV30BridgeheadClaim } from './domain/publicWorldV30BridgeheadAction'
import type { PublicV30BridgeheadWitness } from './domain/publicWorldV30BridgeheadAction'
import type { PublicV29Start } from './domain/publicWorldV29Flow'
import type { PublicV29Progress } from './domain/publicWorldV29Migration'
import { canonicalClaim, decodePublicV30Witness,
  replayPublicV30Witness } from './domain/publicWorldV30Snapshot'
import type { PublicV30Witness } from './domain/publicWorldV30Snapshot'
import type { PublicV30Operation, PublicV30Start } from './domain/publicWorldV30Flow'
import type { PublicV30Progress } from './domain/publicWorldV30Migration'
import { createPublicV29ControllerRuntime } from './PublicV29ControllerRuntime'

type Writer = (revision: number, lineage: PublicV30Start['lineage'],
  witness: PublicV30Witness, frameProof?: (revision: number,
    witness: unknown) => PublicV30Progress | null) => Promise<PublicV30Operation<PublicV30Start>>
type ReturnHomeWriter = (revision: number, lineage: PublicV30Start['lineage']) =>
  Promise<PublicV30Operation<PublicV30Start>>
type V29Action = Parameters<ReturnType<typeof createPublicV29ControllerRuntime>['action']>[0]

const progress = ({ head }: PublicV30Start): PublicV30Progress => ({
  state: head.state, greenwayWorks: head.greenwayWorks,
  regionalWorks: head.regionalWorks, terrain: head.terrain,
  nextHomeAtMs: head.nextHomeAtMs, riverBridgeIds: [...head.riverBridgeIds],
  miningTools: head.miningTools, claimedBridgeheadId: head.claimedBridgeheadId })
const asV29Start = (start: PublicV30Start,
  witness: PublicV29Start['head']['witness'] = null): PublicV29Start => ({
  lineage: structuredClone(start.lineage.sourceReceipt.lineage),
  head: { state: structuredClone(start.head.state),
    greenwayWorks: structuredClone(start.head.greenwayWorks),
    regionalWorks: structuredClone(start.head.regionalWorks),
    terrain: structuredClone(start.head.terrain), nextHomeAtMs: start.head.nextHomeAtMs,
    riverBridgeIds: [...start.head.riverBridgeIds],
    miningTools: structuredClone(start.head.miningTools),
    schemaVersion: 'wizard-world/v29', saveRevision: start.head.saveRevision, witness } })

/** Inherited travel and actions run in memory; every write is a checked V30 witness. */
export function createPublicV30ControllerRuntime(initial: PublicV30Start, write: Writer,
  returnHomeWrite?: ReturnHomeWriter, privateFrameProof = false) {
  let committed = structuredClone(initial)
  let blockedReason: string | null = null
  let claimBusy = false
  const freeze = (reason: string) => {
    blockedReason = reason
    return { status: 'blocked' as const, reason }
  }
  const checkedReply = (reply: PublicV30Operation<PublicV30Start>, revision: number,
    witness: PublicV30Witness, expected: PublicV30Progress) => {
    if (!reply.ok) return { ok: false as const, reason: reply.reason }
    try {
      if (reply.value.head.schemaVersion !== 'wizard-world/v30'
        || reply.value.head.saveRevision !== revision + 1
        || !samePublicV14Value(reply.value.lineage, committed.lineage)
        || !samePublicV14Value(reply.value.head.witness, witness)
        || !samePublicV14Value(progress(reply.value), expected))
        return { ok: false as const, reason: 'writer-mismatch' }
      committed = structuredClone(reply.value)
      return { ok: true as const, value: asV29Start(committed,
        witness.kind === 'bridgehead-claim/v1' ? null : witness) }
    } catch { return { ok: false as const, reason: 'writer-mismatch' } }
  }
  const makeCore = () => createPublicV29ControllerRuntime(asV29Start(committed),
    async (revision, _lineage, witness, frameExpected) => {
      const before = progress(committed)
      let checkedFrame: PublicV30Progress | null = null
      if (witness.kind === 'frame-batch/v1' && revision === committed.head.saveRevision
        && frameExpected && canonicalClaim(before)) {
        try {
          const activePick = frameExpected.state.player.equipment.mainHand === null
            ? before.miningTools.activePick : null
          const preview: PublicV29Progress = { ...core.preview(),
            miningTools: { ...before.miningTools, activePick } }
          if (samePublicV14Value(frameExpected, preview)) {
            const candidate = { ...frameExpected,
              claimedBridgeheadId: before.claimedBridgeheadId }
            if (canonicalClaim(candidate)) checkedFrame = candidate
          }
        } catch { /* A malformed private proof takes the ordinary replay path. */ }
      }
      const expected = checkedFrame ?? replayPublicV30Witness(before, witness)
      if (!expected || revision !== committed.head.saveRevision)
        return { ok: false as const, reason: 'local-replay' }
      const savedWitness = checkedFrame && privateFrameProof ? structuredClone(witness) : null
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
        return checkedReply(reply, revision, witness, expected)
      }
      catch { return { ok: false as const, reason: 'storage-error' } }
    }, returnHomeWrite ? async (revision) => {
      if (revision !== committed.head.saveRevision)
        return { ok: false as const, reason: 'revision-changed' }
      try {
        const reply = await returnHomeWrite(revision, structuredClone(committed.lineage))
        if (!reply.ok) return reply
        const witness = decodePublicV30Witness(reply.value.head.witness)
        const expected = witness?.kind === 'return-home/v1'
          ? replayPublicV30Witness(progress(committed), witness) : null
        return witness && expected ? checkedReply(reply, revision, witness, expected)
          : { ok: false as const, reason: 'writer-mismatch' }
      } catch { return { ok: false as const, reason: 'storage-error' } }
    } : undefined)
  let core = makeCore()
  return {
    committed: () => structuredClone(committed),
    preview: (): PublicV30Progress => ({ ...core.preview(),
      claimedBridgeheadId: committed.head.claimedBridgeheadId }),
    view: () => core.view(),
    status: () => blockedReason ? { ...core.status(), gate: 'blocked' as const, blockedReason }
      : claimBusy ? { ...core.status(), gate: 'barrier' as const } : core.status(),
    idleFrameNeeded: () => blockedReason !== null || claimBusy || core.idleFrameNeeded(),
    advanceFrame(intents: readonly PublicWorldIntent[], walkRequested: boolean) {
      if (!blockedReason && !claimBusy) return core.advanceFrame(intents, walkRequested)
      return { events: [], rejections: [{ intentIndex: 0,
        intentType: intents[0]?.type ?? 'move' as const, code: 'unavailable_here' as const,
        message: 'Movement is paused for a checked write.' }] }
    },
    save: () => blockedReason ? Promise.resolve(freeze(blockedReason))
      : claimBusy ? Promise.resolve({ status: 'busy' as const }) : core.save(),
    returnHome: () => blockedReason ? Promise.resolve(freeze(blockedReason))
      : claimBusy ? Promise.resolve({ status: 'busy' as const }) : core.returnHome(),
    async action(raw: V29Action | PublicV30BridgeheadWitness) {
      if (blockedReason) return freeze(blockedReason)
      if (claimBusy) return { status: 'busy' as const }
      const witness = decodePublicV30Witness(raw)
      if (witness?.kind !== 'bridgehead-claim/v1')
        return core.action(raw as V29Action)
      claimBusy = true
      try {
        const saved = await core.save()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const before = progress(committed)
        const claim = confirmPublicV30BridgeheadClaim(before, witness.bridgeId)
        if (claim.rejection) return { status: 'rejected' as const, reason: claim.rejection }
        const revision = committed.head.saveRevision
        const checked = checkedReply(await write(revision, structuredClone(committed.lineage),
          structuredClone(witness)), revision, witness, claim.progress)
        if (!checked.ok) return freeze(checked.reason)
        core = makeCore()
        return { status: 'saved' as const, events: [], resetWalkRequested: false,
          bridgeheadReward: claim.reward }
      } catch { return freeze('storage-error') }
      finally { claimBusy = false }
    },
  }
}
