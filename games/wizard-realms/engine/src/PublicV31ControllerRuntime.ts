import { createPublicV30ControllerRuntime } from './PublicV30ControllerRuntime'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import type { PublicWorldIntent } from './domain/publicWorldRuntime'
import { replayPublicV28FramesWithEvents } from './domain/publicWorldV28Replay'
import { decodePublicV30Witness, replayPublicV30Witness } from './domain/publicWorldV30Snapshot'
import type { PublicV30Start } from './domain/publicWorldV30Flow'
import type { PublicV31Operation, PublicV31Start } from './domain/publicWorldV31Flow'
import type { PublicV31Progress } from './domain/publicWorldV31Migration'
import type { PublicV30Progress } from './domain/publicWorldV30Migration'
import { replayPublicV31FramesWithEvents } from './domain/publicWorldV31Movement'
import { replayPublicV31Witness, decodePublicV31Witness } from './domain/publicWorldV31Snapshot'
import type { PublicV31Witness } from './domain/publicWorldV31Snapshot'
import { confirmPublicV31SoilAction, decodePublicV31ActionProgress,
  publicV31HasRaisedSoilCell } from './domain/publicWorldV31Soil'
import { projectPublicV31Pose } from './domain/publicWorldV31Support'
import type { PublicV31SoilWitness } from './domain/publicWorldV31Soil'

type Writer = (revision: number, lineage: PublicV31Start['lineage'],
  witness: PublicV31Witness, frameProof?: (revision: number,
    witness: unknown) => PublicV31Progress | null) => Promise<PublicV31Operation<PublicV31Start>>
type ReturnHomeWriter = (revision: number, lineage: PublicV31Start['lineage']) =>
  Promise<PublicV31Operation<PublicV31Start>>
type V30Action = Parameters<ReturnType<typeof createPublicV30ControllerRuntime>['action']>[0]

const progress = ({ head }: PublicV31Start): PublicV31Progress => ({
  state: head.state, greenwayWorks: head.greenwayWorks,
  regionalWorks: head.regionalWorks, terrain: head.terrain,
  nextHomeAtMs: head.nextHomeAtMs, riverBridgeIds: head.riverBridgeIds,
  miningTools: head.miningTools, claimedBridgeheadId: head.claimedBridgeheadId,
  raisedSoilCells: head.raisedSoilCells })
const asV30Start = (start: PublicV31Start): PublicV30Start => ({
  lineage: structuredClone(start.lineage.sourceReceipt.lineage),
  head: { state: structuredClone(start.head.state),
    greenwayWorks: structuredClone(start.head.greenwayWorks),
    regionalWorks: structuredClone(start.head.regionalWorks),
    terrain: structuredClone(start.head.terrain), nextHomeAtMs: start.head.nextHomeAtMs,
    riverBridgeIds: [...start.head.riverBridgeIds],
    miningTools: structuredClone(start.head.miningTools),
    claimedBridgeheadId: start.head.claimedBridgeheadId,
    schemaVersion: 'wizard-world/v30', saveRevision: start.head.saveRevision,
    witness: decodePublicV30Witness(start.head.witness) } })

/** V30 simulates legacy controls; V31 checks the lift before preview or any write. */
export function createPublicV31ControllerRuntime(initial: PublicV31Start,
  write: Writer, returnHomeWrite?: ReturnHomeWriter, privateFrameProof = false) {
  let committed = structuredClone(initial)
  let blockedReason: string | null = null
  let busy = false
  const freeze = (reason: string) => {
    blockedReason = reason
    return { status: 'blocked' as const, reason }
  }
  const checkedReply = (reply: PublicV31Operation<PublicV31Start>, revision: number,
    witness: PublicV31Witness, expected: PublicV31Progress) => {
    if (!reply.ok) return { ok: false as const, reason: reply.reason }
    try {
      if (reply.value.head.schemaVersion !== 'wizard-world/v31'
        || reply.value.head.saveRevision !== revision + 1
        || !samePublicV14Value(reply.value.lineage, committed.lineage)
        || !samePublicV14Value(reply.value.head.witness, witness)
        || !samePublicV14Value(progress(reply.value), expected))
        return { ok: false as const, reason: 'writer-mismatch' }
      committed = structuredClone(reply.value)
      return { ok: true as const, value: committed }
    } catch { return { ok: false as const, reason: 'writer-mismatch' } }
  }
  const makeCore = () => createPublicV30ControllerRuntime(asV30Start(committed),
    async (revision, _lineage, witness, inheritedProof) => {
      if (revision !== committed.head.saveRevision)
        return { ok: false as const, reason: 'revision-changed' }
      const before = progress(committed)
      let checkedFrame: PublicV31Progress | null = null
      if (privateFrameProof && witness.kind === 'frame-batch/v1' && inheritedProof) {
        const checkedBefore = decodePublicV31ActionProgress(before)
        if (checkedBefore && checkedBefore.raisedSoilCells.length === 0
          && samePublicV14Value(checkedBefore, before)) {
          const inherited: PublicV30Progress | null = inheritedProof(revision, witness)
          if (inherited && samePublicV14Value(inherited, core.preview())) {
            const candidate = { ...inherited, raisedSoilCells: checkedBefore.raisedSoilCells }
            const pose = projectPublicV31Pose(candidate)
            if (pose && candidate.state.player.verticalVelocity === 0
              && Math.abs(pose.effective.position.y - pose.effective.floorY) <= 1e-6)
              checkedFrame = candidate
          }
        }
      }
      const expected = checkedFrame ?? replayPublicV31Witness(before, witness)
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
        return checked.ok ? { ok: true as const, value: asV30Start(checked.value) }
          : checked
      } catch { return { ok: false as const, reason: 'storage-error' } }
    }, undefined, privateFrameProof)
  let core = makeCore()
  const preview = (): PublicV31Progress => ({ ...core.preview(),
    raisedSoilCells: structuredClone(committed.head.raisedSoilCells) })
  return {
    committed: () => structuredClone(committed),
    preview,
    view: () => core.view(),
    status: () => blockedReason ? { ...core.status(), gate: 'blocked' as const, blockedReason }
      : busy ? { ...core.status(), gate: 'barrier' as const } : core.status(),
    idleFrameNeeded: () => blockedReason !== null || busy || core.idleFrameNeeded(),
    advanceFrame(intents: readonly PublicWorldIntent[], walkRequested: boolean) {
      if (blockedReason || busy) return { events: [], rejections: [{ intentIndex: 0,
        intentType: intents[0]?.type ?? 'move' as const, code: 'unavailable_here' as const,
        message: 'Movement is paused for a checked write.' }] }
      if (committed.head.raisedSoilCells.length) {
        const frame = { intents, walkRequested }, before = preview()
        if (!replayPublicV31FramesWithEvents(before, [frame], true)) {
          // Let the inherited controller retain its specific river/cliff rejection.
          if (replayPublicV28FramesWithEvents(before, [frame], true))
            return { events: [], rejections: [{ intentIndex: 0,
              intentType: intents[0]?.type ?? 'move' as const,
              code: 'terrain_missing' as const,
              message: 'This raised soil step is too high from here.' }] }
        }
      }
      return core.advanceFrame(intents, walkRequested)
    },
    save: () => blockedReason ? Promise.resolve(freeze(blockedReason))
      : busy ? Promise.resolve({ status: 'busy' as const }) : core.save(),
    async returnHome() {
      if (blockedReason) return freeze(blockedReason)
      if (busy) return { status: 'busy' as const }
      if (!returnHomeWrite) return { status: 'rejected' as const, reason: 'unavailable_here' }
      busy = true
      try {
        const saved = await core.save()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const revision = committed.head.saveRevision
        const reply = await returnHomeWrite(revision, structuredClone(committed.lineage))
        if (!reply.ok) return reply.reason === 'not_trapped' || reply.reason === 'cooldown'
          || reply.reason === 'frame-rejected'
          ? { status: 'rejected' as const, reason: reply.reason } : freeze(reply.reason)
        const witness = decodePublicV31Witness(reply.value.head.witness)
        const expected = witness?.kind === 'return-home/v1'
          ? replayPublicV31Witness(progress(committed), witness) : null
        if (!witness || !expected) return freeze('writer-mismatch')
        const checked = checkedReply(reply, revision, witness, expected)
        if (!checked.ok) return freeze(checked.reason)
        core = makeCore()
        return { status: 'saved' as const, events: [], resetWalkRequested: false }
      } catch { return freeze('storage-error') }
      finally { busy = false }
    },
    async action(raw: V30Action | PublicV31SoilWitness) {
      if (blockedReason) return freeze(blockedReason)
      if (busy) return { status: 'busy' as const }
      const witness = decodePublicV31Witness(raw)
      const raisedDig = witness?.kind === 'terrain-action/v1'
        && witness.action.kind === 'dig'
        && publicV31HasRaisedSoilCell(committed.head.raisedSoilCells,
          witness.action.gx, witness.action.gz)
      if (!raisedDig && witness?.kind !== 'soil-place/v1'
        && witness?.kind !== 'soil-remove/v1') {
        if (!witness || !committed.head.raisedSoilCells.length)
          return core.action(raw as V30Action)
        busy = true
        try {
          const saved = await core.save()
          if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
          const before = progress(committed)
          const { raisedSoilCells: _cells, ...old } = before
          if (replayPublicV30Witness(old, witness)
            && !replayPublicV31Witness(before, witness))
            return { status: 'rejected' as const, reason: 'soil_overlap' }
          return await core.action(raw as V30Action)
        } catch { return freeze('storage-error') }
        finally { busy = false }
      }
      busy = true
      try {
        const saved = await core.save()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const before = progress(committed)
        const soil = raisedDig ? { kind: 'soil-remove/v1' as const,
          gx: witness.action.gx, gz: witness.action.gz } : witness as PublicV31SoilWitness
        const checkedSoil = confirmPublicV31SoilAction(before, soil)
        if (checkedSoil.rejection) return { status: 'rejected' as const,
          reason: checkedSoil.rejection }
        const expected = replayPublicV31Witness(before, witness)
        if (!expected) return freeze('local-replay')
        const revision = committed.head.saveRevision
        const reply = await write(revision, structuredClone(committed.lineage),
          structuredClone(witness))
        const checked = checkedReply(reply, revision, witness, expected)
        if (!checked.ok) return freeze(checked.reason)
        core = makeCore()
        return { status: 'saved' as const, events: [], resetWalkRequested: false }
      } catch { return freeze('storage-error') }
      finally { busy = false }
    },
  }
}
