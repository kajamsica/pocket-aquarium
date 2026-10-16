import { createPublicV42ControllerRuntime } from './PublicV42ControllerRuntime'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import type { PublicV42Start } from './domain/publicWorldV42Flow'
import { INITIAL_IRON_HALL_REWARD, PUBLIC_V42_PROGRESS_KEYS,
  resolvePublicV42CrestAfterDefeat } from './domain/publicWorldV42RewardAction'
import type { PublicV42RewardProgress } from './domain/publicWorldV42RewardAction'
import { decodePublicV42Witness, PUBLIC_V42_SCHEMA } from './domain/publicWorldV42Snapshot'
import type { PublicV42Witness } from './domain/publicWorldV42Snapshot'
import type { PublicV43Operation, PublicV43Start } from './domain/publicWorldV43Flow'
import { decodePublicV43CheckedSuccessor, replayPublicV43Witness } from './domain/publicWorldV43Snapshot'
import type { PublicV43Witness } from './domain/publicWorldV43Snapshot'
import type { PublicV43FamiliarProgress } from './domain/publicWorldV43FamiliarAction'

type Writer = (revision: number, lineage: PublicV43Start['lineage'], witness: PublicV43Witness) =>
  Promise<PublicV43Operation<PublicV43Start>>
type HomeWriter = (revision: number, lineage: PublicV43Start['lineage']) =>
  Promise<PublicV43Operation<PublicV43Start>>

const parentProgress = (head: PublicV43FamiliarProgress) => Object.fromEntries(
  PUBLIC_V42_PROGRESS_KEYS.map((key) => [key, head[key]])) as PublicV42RewardProgress

/** A disposable V42 control shell. Its writes are always checked V43 writes. */
export function createPublicV43ControllerRuntime(initial: PublicV43Start,
  write: Writer, homeWrite?: HomeWriter) {
  let committed = structuredClone(initial)
  const shellLineage = { origin: 'v41-migration' as const,
    rulesProfile: 'iron-hall-rewards/v1' as const, seed: committed.lineage.seed,
    sourceRevision: 0, genesis: resolvePublicV42CrestAfterDefeat({
      ...parentProgress(committed.lineage.genesis),
      ironHallReward: structuredClone(INITIAL_IRON_HALL_REWARD) }) }
  const asV42 = (start: PublicV43Start, witness = decodePublicV42Witness(
    start.head.witness) ?? { kind: 'checkpoint' as const }): PublicV42Start => ({
    lineage: shellLineage,
    head: { ...parentProgress(start.head), schemaVersion: PUBLIC_V42_SCHEMA,
      saveRevision: start.head.saveRevision + 1,
      witness },
  })
  const checkedWrite = async (revision: number, requested: PublicV42Witness | null,
    run: () => Promise<PublicV43Operation<PublicV43Start>>) => {
    if (revision !== committed.head.saveRevision + 1)
      return { ok: false as const, reason: 'revision-changed' }
    const before = committed
    const reply = await run()
    if (!reply.ok) return reply
    const witness = requested ?? (reply.value.head.witness?.kind === 'return-home/v1'
      ? reply.value.head.witness : null)
    if (!witness || requested &&
      !samePublicV14Value(reply.value.head.witness, requested))
      return { ok: false as const, reason: 'writer-mismatch' }
    const expected = replayPublicV43Witness(before.head, witness)
    const next = decodePublicV43CheckedSuccessor(
      { ...before, previous: null }, { lineage: reply.value.lineage,
        previous: before.head, head: reply.value.head })
    if (!expected || !next)
      return { ok: false as const, reason: 'writer-mismatch' }
    committed = structuredClone(reply.value)
    return { ok: true as const, value: asV42(committed, witness) }
  }
  const runtime = createPublicV42ControllerRuntime(asV42(committed),
    (revision, _lineage, witness) => checkedWrite(revision, witness,
      () => write(committed.head.saveRevision, structuredClone(committed.lineage), witness)),
    homeWrite ? (revision) => checkedWrite(revision, null,
      () => homeWrite(committed.head.saveRevision, structuredClone(committed.lineage))) : undefined)
  return {
    ...runtime,
    committed: () => structuredClone(committed),
    preview: () => ({ ...runtime.preview(), familiar: structuredClone(committed.head.familiar),
      ...(committed.head.mountTraining
        ? { mountTraining: structuredClone(committed.head.mountTraining) } : {}) }),
  }
}
