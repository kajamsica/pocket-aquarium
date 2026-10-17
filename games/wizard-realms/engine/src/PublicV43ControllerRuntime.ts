import { createPublicV42ControllerRuntime } from './PublicV42ControllerRuntime'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import type { PublicV42Start } from './domain/publicWorldV42Flow'
import { INITIAL_IRON_HALL_REWARD, PUBLIC_V42_PROGRESS_KEYS,
  resolvePublicV42CrestAfterDefeat } from './domain/publicWorldV42RewardAction'
import type { PublicV42RewardProgress } from './domain/publicWorldV42RewardAction'
import { decodePublicV42Witness, PUBLIC_V42_SCHEMA } from './domain/publicWorldV42Snapshot'
import type { PublicV43Operation, PublicV43Start } from './domain/publicWorldV43Flow'
import { decodePublicV43CheckedSuccessor, replayPublicV43Witness } from './domain/publicWorldV43Snapshot'
import type { PublicV43Witness } from './domain/publicWorldV43Snapshot'
import { confirmPublicV43FamiliarAction, decodePublicV43FamiliarWitness,
  PUBLIC_V43_PROGRESS_KEYS } from './domain/publicWorldV43FamiliarAction'
import type { PublicV43FamiliarProgress } from './domain/publicWorldV43FamiliarAction'
import { confirmPublicV43MountTraining, createPublicV43MountTraining,
  decodePublicV43MountTrainingWitness } from './domain/publicWorldV43MountTraining'
import type { PublicV43MountTrainingProgress } from './domain/publicWorldV43MountTraining'
import { confirmPublicV43LogOrder, createPublicV43LogOrder,
  decodePublicV43LogOrderWitness } from './domain/publicWorldV43LogOrder'
import type { PublicV43LogOrderProgress } from './domain/publicWorldV43LogOrder'

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
  const checkedWrite = async (revision: number, requested: PublicV43Witness | null,
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
    return { ok: true as const, value: asV42(committed,
      decodePublicV42Witness(witness) ?? undefined) }
  }
  const createShell = () => createPublicV42ControllerRuntime(asV42(committed),
    (revision, _lineage, witness) => checkedWrite(revision, witness,
      () => write(committed.head.saveRevision, structuredClone(committed.lineage), witness)),
    homeWrite ? (revision) => checkedWrite(revision, null,
      () => homeWrite(committed.head.saveRevision, structuredClone(committed.lineage))) : undefined)
  let runtime = createShell()
  let directBusy = false, directBlocked: string | null = null
  const directGate = () => directBlocked
    ? { status: 'blocked' as const, reason: directBlocked }
    : directBusy ? { status: 'busy' as const } : null
  return {
    view: () => runtime.view(),
    status: () => directBlocked ? { ...runtime.status(), gate: 'blocked' as const,
      blockedReason: directBlocked } : directBusy ? { ...runtime.status(), gate: 'barrier' as const }
      : runtime.status(),
    idleFrameNeeded: () => !directGate() && runtime.idleFrameNeeded(),
    advanceFrame: (...args: Parameters<typeof runtime.advanceFrame>) => directGate()
      ? { events: [], rejections: [{ intentIndex: 0,
        intentType: args[0][0]?.type ?? 'move', code: 'unavailable_here' as const,
        message: 'Movement is paused for a checked write.' }] }
      : runtime.advanceFrame(...args),
    save: () => directGate() ?? runtime.save(),
    returnHome: () => directGate() ?? runtime.returnHome(),
    committed: () => structuredClone(committed),
    preview: () => ({ ...runtime.preview(), familiar: structuredClone(committed.head.familiar),
      ...(committed.head.mountTraining
        ? { mountTraining: structuredClone(committed.head.mountTraining) } : {}),
      ...(committed.head.greenwayOrder
        ? { greenwayOrder: structuredClone(committed.head.greenwayOrder) } : {}) }),
    async action(raw: Parameters<typeof runtime.action>[0] | PublicV43Witness) {
      const gate = directGate()
      if (gate) return gate
      const familiar = decodePublicV43FamiliarWitness(raw)
      const care = decodePublicV43MountTrainingWitness(raw)
      const order = decodePublicV43LogOrderWitness(raw)
      if (!familiar && !care && !order && raw && typeof raw === 'object' && 'kind' in raw
        && typeof raw.kind === 'string' && (raw.kind.startsWith('familiar-')
          || raw.kind === 'sedgehorn-care/v1' || raw.kind === 'fulfill-greenway-logs/v1'))
        return { status: 'rejected' as const, reason: 'invalid_value' }
      if (!familiar && !care && !order) return runtime.action(raw as Parameters<typeof runtime.action>[0])
      directBusy = true
      try {
        const saved = await runtime.save()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const witness = (familiar ?? care ?? order)!
        const current = Object.fromEntries(PUBLIC_V43_PROGRESS_KEYS.map((key) =>
          [key, committed.head[key]])) as PublicV43FamiliarProgress
        const training = care && (committed.head.mountTraining
          ? { ...current, mountTraining: committed.head.mountTraining } as
            PublicV43MountTrainingProgress : createPublicV43MountTraining(current))
        const procurement = order && (committed.head.greenwayOrder
          ? { ...current, greenwayOrder: committed.head.greenwayOrder } as
            PublicV43LogOrderProgress : createPublicV43LogOrder(current))
        const rejection = familiar
          ? confirmPublicV43FamiliarAction(current, familiar).rejection
          : care && training ? confirmPublicV43MountTraining(training, care).rejection
            : order && procurement ? confirmPublicV43LogOrder(procurement, order).rejection
              : 'invalid_progress'
        if (rejection) return { status: 'rejected' as const, reason: rejection }
        const revision = committed.head.saveRevision
        const result = await checkedWrite(revision + 1, witness, () => write(revision,
          structuredClone(committed.lineage), witness))
        if (!result.ok) {
          directBlocked = result.reason
          return { status: 'blocked' as const, reason: result.reason }
        }
        runtime = createShell()
        return { status: 'saved' as const, events: [], resetWalkRequested: false }
      } catch {
        directBlocked = 'storage-error'
        return { status: 'blocked' as const, reason: directBlocked }
      } finally { directBusy = false }
    },
  }
}
