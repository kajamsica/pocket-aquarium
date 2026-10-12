import { createPublicV34ControllerRuntime } from './PublicV34ControllerRuntime'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import { exactPublicV23 } from './domain/publicWorldV23Snapshot'
import type { PublicV33Progress } from './domain/publicWorldV33Migration'
import { decodePublicV33Witness } from './domain/publicWorldV33Snapshot'
import { PUBLIC_V34_SCHEMA } from './domain/publicWorldV34Snapshot'
import type { PublicV34Start } from './domain/publicWorldV34Flow'
import { confirmPublicV35LedgerAction,
  decodePublicV35LedgerWitness } from './domain/publicWorldV35LedgerAction'
import type { PublicV35LedgerWitness, PublicV35Progress } from './domain/publicWorldV35LedgerAction'
import { decodePublicV35Head, decodePublicV35Lineage,
  replayPublicV35Witness } from './domain/publicWorldV35Snapshot'
import type { PublicV35Witness } from './domain/publicWorldV35Snapshot'
import type { PublicV35Operation, PublicV35Start } from './domain/publicWorldV35Flow'

type Writer = (revision: number, lineage: PublicV35Start['lineage'],
  witness: PublicV35Witness) => Promise<PublicV35Operation<PublicV35Start>>
type ReturnHomeWriter = (revision: number, lineage: PublicV35Start['lineage']) =>
  Promise<PublicV35Operation<PublicV35Start>>
type V34Action = Parameters<ReturnType<typeof createPublicV34ControllerRuntime>['action']>[0]

const inherited = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells }: PublicV35Progress):
  PublicV33Progress => ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells })
const progress = ({ head }: PublicV35Start): PublicV35Progress => ({
  ...inherited(head), ledgerSurveyBridgeId: head.ledgerSurveyBridgeId,
  ledgerClaimReward: head.ledgerClaimReward })

/** V34 is an inner simulation shell. Its lineage and witness never reach the V35 writer. */
function asV34Start(start: PublicV35Start): PublicV34Start {
  const { lineage, head } = start
  return { lineage: { origin: 'v33-migration', rulesProfile: 'self-contained/v1',
    seed: lineage.seed, sourceRevision: 0, genesis: structuredClone(lineage.genesis) },
  head: { ...structuredClone(inherited(head)), schemaVersion: PUBLIC_V34_SCHEMA,
    saveRevision: head.saveRevision, witness: decodePublicV33Witness(head.witness) } }
}

/** Every durable action is checked against the V35 writer's own replayable reply. */
export function createPublicV35ControllerRuntime(initial: PublicV35Start,
  write: Writer, returnHomeWrite?: ReturnHomeWriter) {
  let committed: PublicV35Start = structuredClone(initial)
  let blockedReason: string | null = null
  let busy = false
  const freeze = (reason: string) => {
    blockedReason = reason
    return { status: 'blocked' as const, reason }
  }
  const checked = (reply: PublicV35Operation<PublicV35Start>, revision: number,
    witness: PublicV35Witness, expected: PublicV35Progress) => {
    if (!reply.ok) return { ok: false as const, reason: reply.reason }
    try {
      const { head, lineage } = reply.value
      if (!exactPublicV23(reply.value, ['head', 'lineage'])
        || !decodePublicV35Lineage(lineage)
        || !decodePublicV35Head(head, lineage)
        || !samePublicV14Value(lineage, committed.lineage)
        || head.saveRevision !== revision + 1
        || !samePublicV14Value(head.witness, witness)
        || !samePublicV14Value(progress(reply.value), expected))
        return { ok: false as const, reason: 'writer-mismatch' }
      committed = structuredClone(reply.value)
      return { ok: true as const, value: asV34Start(committed) }
    } catch { return { ok: false as const, reason: 'writer-mismatch' } }
  }
  const makeCore = () => createPublicV34ControllerRuntime(asV34Start(committed),
    async (revision, _simulationLineage, witness) => {
      if (revision !== committed.head.saveRevision)
        return { ok: false as const, reason: 'revision-changed' }
      const expected = replayPublicV35Witness(progress(committed), witness)
      if (!expected) return { ok: false as const, reason: 'local-replay' }
      try { return checked(await write(revision, structuredClone(committed.lineage),
        structuredClone(witness)), revision, witness, expected) }
      catch { return { ok: false as const, reason: 'storage-error' } }
    }, returnHomeWrite ? async (revision) => {
      if (revision !== committed.head.saveRevision)
        return { ok: false as const, reason: 'revision-changed' }
      try {
        const reply = await returnHomeWrite(revision, structuredClone(committed.lineage))
        if (!reply.ok) return reply
        const witness = decodePublicV33Witness(reply.value.head.witness)
        const expected = witness?.kind === 'return-home/v1'
          ? replayPublicV35Witness(progress(committed), witness) : null
        return witness && expected ? checked(reply, revision, witness, expected)
          : { ok: false as const, reason: 'writer-mismatch' }
      } catch { return { ok: false as const, reason: 'storage-error' } }
    } : undefined)
  let core = makeCore()
  return {
    committed: () => structuredClone(committed),
    preview: () => ({ ...core.preview(), ledgerSurveyBridgeId: committed.head.ledgerSurveyBridgeId,
      ledgerClaimReward: committed.head.ledgerClaimReward }),
    view: () => core.view(),
    status: () => blockedReason ? { ...core.status(), gate: 'blocked' as const, blockedReason }
      : busy ? { ...core.status(), gate: 'barrier' as const } : core.status(),
    idleFrameNeeded: () => blockedReason !== null || busy || core.idleFrameNeeded(),
    advanceFrame: (...args: Parameters<typeof core.advanceFrame>) =>
      blockedReason || busy ? { events: [], rejections: [{ intentIndex: 0,
        intentType: args[0][0]?.type ?? 'move' as const, code: 'unavailable_here' as const,
        message: 'Movement is paused for a checked write.' }] }
        : core.advanceFrame(...args),
    save: () => blockedReason ? Promise.resolve(freeze(blockedReason))
      : busy ? Promise.resolve({ status: 'busy' as const }) : core.save(),
    returnHome: () => blockedReason ? Promise.resolve(freeze(blockedReason))
      : busy ? Promise.resolve({ status: 'busy' as const }) : core.returnHome(),
    async action(raw: V34Action | PublicV35LedgerWitness) {
      if (blockedReason) return freeze(blockedReason)
      if (busy) return { status: 'busy' as const }
      const ledger = decodePublicV35LedgerWitness(raw)
      if (!ledger) return core.action(raw as V34Action)
      busy = true
      try {
        const saved = await core.save()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const before = progress(committed)
        const checkedAction = confirmPublicV35LedgerAction(before, ledger)
        if ('rejection' in checkedAction)
          return { status: 'rejected' as const, reason: checkedAction.rejection }
        const expected = replayPublicV35Witness(before, ledger)
        if (!expected) return freeze('local-replay')
        const revision = committed.head.saveRevision
        const reply = await write(revision, structuredClone(committed.lineage), ledger)
        const result = checked(reply, revision, ledger, expected)
        if (!result.ok) return freeze(result.reason)
        core = makeCore()
        return { status: 'saved' as const, events: [], resetWalkRequested: false }
      } catch { return freeze('storage-error') }
      finally { busy = false }
    },
  }
}
