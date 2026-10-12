import { createPublicV35ControllerRuntime } from './PublicV35ControllerRuntime'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import { exactPublicV23 } from './domain/publicWorldV23Snapshot'
import { confirmPublicV36MarkerAction,
  decodePublicV36MarkerWitness } from './domain/publicWorldV36MarkerAction'
import type { PublicV36MarkerProgress,
  PublicV36MarkerWitness } from './domain/publicWorldV36MarkerAction'
import { decodePublicV35Witness, PUBLIC_V35_SCHEMA } from './domain/publicWorldV35Snapshot'
import type { PublicV35Start } from './domain/publicWorldV35Flow'
import { decodePublicV36Head, decodePublicV36Lineage,
  replayPublicV36Witness } from './domain/publicWorldV36Snapshot'
import type { PublicV36Witness } from './domain/publicWorldV36Snapshot'
import type { PublicV36Operation, PublicV36Start } from './domain/publicWorldV36Flow'

type Writer = (revision: number, lineage: PublicV36Start['lineage'],
  witness: PublicV36Witness) => Promise<PublicV36Operation<PublicV36Start>>
type ReturnHomeWriter = (revision: number, lineage: PublicV36Start['lineage']) =>
  Promise<PublicV36Operation<PublicV36Start>>
type V35Action = Parameters<ReturnType<typeof createPublicV35ControllerRuntime>['action']>[0]

const progress = ({ head }: PublicV36Start): PublicV36MarkerProgress => {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness, ...value } = head
  return value
}

/** A synthetic V35 shell simulates inherited actions; its lineage is never persisted. */
function asV35Start(start: PublicV36Start): PublicV35Start {
  const { ledgerSurveyBridgeId: _survey, ledgerClaimReward: _claim,
    ...genesis } = start.lineage.genesis
  const { markerClaimReward: _marker, schemaVersion: _schema,
    saveRevision: _revision, witness: _witness, ...old } = start.head
  return { lineage: { origin: 'v34-migration', rulesProfile: 'outfitters-ledger/v1',
    seed: start.lineage.seed, sourceRevision: 0, genesis: structuredClone(genesis) },
  head: { ...structuredClone(old), schemaVersion: PUBLIC_V35_SCHEMA,
    saveRevision: start.head.saveRevision + 1,
    witness: decodePublicV35Witness(start.head.witness)
      ?? { kind: 'return-home/v1', atMs: 0 } } }
}

/** Only the V36 writer receives durable actions, including inherited V35 controls. */
export function createPublicV36ControllerRuntime(initial: PublicV36Start,
  write: Writer, returnHomeWrite?: ReturnHomeWriter) {
  let committed: PublicV36Start = structuredClone(initial)
  let blockedReason: string | null = null
  let busy = false
  const freeze = (reason: string) => {
    blockedReason = reason
    return { status: 'blocked' as const, reason }
  }
  const checked = (reply: PublicV36Operation<PublicV36Start>, revision: number,
    witness: PublicV36Witness, expected: PublicV36MarkerProgress) => {
    if (!reply.ok) return { ok: false as const, reason: reply.reason }
    try {
      const { head, lineage } = reply.value
      if (!exactPublicV23(reply.value, ['head', 'lineage'])
        || !decodePublicV36Lineage(lineage)
        || !decodePublicV36Head(head, lineage)
        || !samePublicV14Value(lineage, committed.lineage)
        || head.saveRevision !== revision + 1
        || !samePublicV14Value(head.witness, witness)
        || !samePublicV14Value(progress(reply.value), expected))
        return { ok: false as const, reason: 'writer-mismatch' }
      committed = structuredClone(reply.value)
      return { ok: true as const, value: asV35Start(committed) }
    } catch { return { ok: false as const, reason: 'writer-mismatch' } }
  }
  const makeCore = () => createPublicV35ControllerRuntime(asV35Start(committed),
    async (simulationRevision, _simulationLineage, witness) => {
      const revision = committed.head.saveRevision
      if (simulationRevision !== revision + 1)
        return { ok: false as const, reason: 'revision-changed' }
      const expected = replayPublicV36Witness(progress(committed), witness)
      if (!expected) return { ok: false as const, reason: 'local-replay' }
      try { return checked(await write(revision, structuredClone(committed.lineage),
        structuredClone(witness)), revision, witness, expected) }
      catch { return { ok: false as const, reason: 'storage-error' } }
    }, returnHomeWrite ? async (simulationRevision) => {
      const revision = committed.head.saveRevision
      if (simulationRevision !== revision + 1)
        return { ok: false as const, reason: 'revision-changed' }
      try {
        const reply = await returnHomeWrite(revision, structuredClone(committed.lineage))
        if (!reply.ok) return reply
        const witness = decodePublicV35Witness(reply.value.head.witness)
        const expected = witness?.kind === 'return-home/v1'
          ? replayPublicV36Witness(progress(committed), witness) : null
        return witness && expected ? checked(reply, revision, witness, expected)
          : { ok: false as const, reason: 'writer-mismatch' }
      } catch { return { ok: false as const, reason: 'storage-error' } }
    } : undefined)
  let core = makeCore()
  return {
    committed: () => structuredClone(committed),
    preview: () => ({ ...core.preview(),
      markerClaimReward: committed.head.markerClaimReward }),
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
    async action(raw: V35Action | PublicV36MarkerWitness) {
      if (blockedReason) return freeze(blockedReason)
      if (busy) return { status: 'busy' as const }
      const marker = decodePublicV36MarkerWitness(raw)
      if (!marker) return core.action(raw as V35Action)
      busy = true
      try {
        const saved = await core.save()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const before = progress(committed)
        const checkedAction = confirmPublicV36MarkerAction(before, marker)
        if ('rejection' in checkedAction)
          return { status: 'rejected' as const, reason: checkedAction.rejection }
        const expected = replayPublicV36Witness(before, marker)
        if (!expected) return freeze('local-replay')
        const revision = committed.head.saveRevision
        const result = checked(await write(revision, structuredClone(committed.lineage), marker),
          revision, marker, expected)
        if (!result.ok) return freeze(result.reason)
        core = makeCore()
        return { status: 'saved' as const, events: [], resetWalkRequested: false }
      } catch { return freeze('storage-error') }
      finally { busy = false }
    },
  }
}
