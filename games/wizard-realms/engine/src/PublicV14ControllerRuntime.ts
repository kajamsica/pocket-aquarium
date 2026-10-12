import { createPublicV14ContinuousSession } from './domain/publicWorldV14ContinuousSession'
import type { PublicV14ContinuousSession, PublicV14SessionFrame } from './domain/publicWorldV14ContinuousSession'
import type { PublicV14ActionCommit, PublicV14FrameBatchCommit,
  PublicV14Operation, PublicV14Start, PublicV14TerrainWorkCommit } from './domain/publicWorldV14Flow'
import type { PublicTerrainWorkEvent } from './domain/publicTerrainWorkAction'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './domain/publicWorldRuntime'
import { decodePublicV14FrameWitness, PUBLIC_V14_MAX_FRAME_BATCH } from './domain/publicWorldV14Snapshot'
import type { PublicV14Frame, PublicV14Lineage, PublicV14State } from './domain/publicWorldV14Snapshot'
import { samePublicV14Value } from './domain/publicWorldV14Validation'

const CHECKPOINT_AT = 64
const JUMP_RESERVE = 32
type Gate = 'open' | 'barrier' | 'blocked'
export type PublicV14ControllerWriters = Readonly<{
  frames: (frames: readonly PublicV14Frame[], revision: number,
    lineage: PublicV14Lineage) => Promise<PublicV14Operation<PublicV14FrameBatchCommit>>
  action: (intent: PublicWorldIntent, revision: number,
    lineage: PublicV14Lineage) => Promise<PublicV14Operation<PublicV14ActionCommit>>
  work?: (id: string, revision: number,
    lineage: PublicV14Lineage) => Promise<PublicV14Operation<PublicV14TerrainWorkCommit>>
}>
export type PublicV14ControllerOutcome =
  | Readonly<{ status: 'saved'; events: readonly PublicWorldEvent[];
    resetWalkRequested: boolean; workEvent?: PublicTerrainWorkEvent }>
  | Readonly<{ status: 'unchanged' | 'deferred-airborne' | 'busy' }>
  | Readonly<{ status: 'rejected' | 'blocked'; reason: string }>

const feetChanged = (events: readonly PublicWorldEvent[]) => events.some((event) =>
  (event.type === 'item_equipped' || event.type === 'item_unequipped') && event.slot === 'feet')

/** Dormant controller substrate. Only injected checked C2/D1 writers can commit history. */
export function createPublicV14ControllerRuntime(initial: PublicV14Start,
  writers: PublicV14ControllerWriters) {
  let committed = structuredClone(initial)
  let session: PublicV14ContinuousSession = createPublicV14ContinuousSession(committed)
  const pending: PublicV14Frame[] = []
  let gate: Gate = 'open'
  let blockedReason: string | null = null
  const freeze = (reason: string): PublicV14ControllerOutcome => {
    gate = 'blocked'
    blockedReason = reason
    return { status: 'blocked', reason }
  }
  const rebase = (next: PublicV14Start, expectedRevision: number,
    expectedState?: PublicV14State) => {
    if (next.saveRevision !== expectedRevision + 1
      || !samePublicV14Value(next.lineage, committed.lineage)
      || expectedState && !samePublicV14Value(next.state, expectedState)) {
      throw new RangeError('The writer returned an unrelated v14 head.')
    }
    const owned = structuredClone(next)
    const receiving = createPublicV14ContinuousSession(owned)
    committed = owned
    session = receiving
    pending.length = 0
  }
  /** Caller has already installed the barrier; rejection keeps preview and transcript intact. */
  const flush = async (): Promise<PublicV14ControllerOutcome> => {
    if (!pending.length) return { status: 'unchanged' }
    let expected: PublicV14State
    try {
      const readiness = session.snapshotForSave()
      if (readiness.status === 'deferred-airborne') return { status: 'deferred-airborne' }
      expected = readiness.state
    } catch { return freeze('invalid-state') }
    const revision = committed.saveRevision
    try {
      const result = await writers.frames(structuredClone(pending), revision,
        structuredClone(committed.lineage))
      if (!result.ok) return freeze(result.reason)
      rebase(result.value.start, revision, expected)
      return { status: 'saved', events: result.value.events, resetWalkRequested: false }
    } catch { return freeze('storage-error') }
  }
  const unavailable = (intents: readonly PublicWorldIntent[], message: string): PublicV14SessionFrame => ({
    events: [], rejections: [{ intentIndex: 0, intentType: intents?.[0]?.type ?? 'move',
      code: 'unavailable_here', message } satisfies PublicWorldRejection],
  })

  return {
    view: () => session.view(),
    preview: () => session.previewSnapshot(),
    status: () => ({ gate: gate === 'open' && pending.length >= PUBLIC_V14_MAX_FRAME_BATCH
      ? 'cap-paused' as const : gate, blockedReason,
    saveRevision: committed.saveRevision, pendingFrames: pending.length,
    checkpointRecommended: pending.length >= CHECKPOINT_AT,
    checkpointRequired: pending.length >= PUBLIC_V14_MAX_FRAME_BATCH }),
    advanceFrame(intents: readonly PublicWorldIntent[], walkRequested: boolean): PublicV14SessionFrame {
      if (gate !== 'open') return unavailable(intents, 'Movement is paused for a write or recovery.')
      if (pending.length >= PUBLIC_V14_MAX_FRAME_BATCH) {
        return unavailable(intents, 'Checkpoint the 128 recorded frames before moving.')
      }
      if (pending.length > PUBLIC_V14_MAX_FRAME_BATCH - JUMP_RESERVE
        && intents?.some((intent) => intent?.type === 'jump' || intent?.type === 'move')) {
        return unavailable(intents, 'Checkpoint before moving to reserve landing frames.')
      }
      const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1',
        frames: [{ intents, walkRequested }] })
      if (!witness) return { events: [], rejections: [{ intentIndex: 0,
        intentType: intents?.[0]?.type ?? 'move', code: 'invalid_frame',
        message: 'Only canonical replayable v14 frames are accepted.' }] }
      const frame = witness.frames[0]
      const result = session.advanceFrame(frame.intents, { walkRequested: frame.walkRequested })
      if (!result.rejections.length) pending.push(frame)
      return result
    },
    async save(): Promise<PublicV14ControllerOutcome> {
      if (gate === 'blocked') return { status: 'blocked', reason: blockedReason! }
      if (gate !== 'open') return { status: 'busy' }
      if (!pending.length) return { status: 'unchanged' }
      gate = 'barrier'
      const outcome = await flush()
      if (outcome.status !== 'blocked') gate = 'open'
      return outcome
    },
    async action(intent: PublicWorldIntent): Promise<PublicV14ControllerOutcome> {
      if (gate === 'blocked') return { status: 'blocked', reason: blockedReason! }
      if (gate !== 'open') return { status: 'busy' }
      gate = 'barrier'
      const checkpoint = await flush()
      if (checkpoint.status === 'blocked') return checkpoint
      if (checkpoint.status === 'deferred-airborne') {
        gate = 'open'
        return checkpoint
      }
      if (session.view().movementOwner !== 'greenway') {
        gate = 'open'
        return { status: 'rejected', reason: 'unavailable_here' }
      }
      const revision = committed.saveRevision
      try {
        const result = await writers.action(structuredClone(intent), revision,
          structuredClone(committed.lineage))
        if (!result.ok) {
          if (result.reason === 'action-rejected') {
            gate = 'open'
            return { status: 'rejected', reason: result.reason }
          }
          return freeze(result.reason)
        }
        rebase(result.value.start, revision)
        gate = 'open'
        return { status: 'saved', events: result.value.events,
          resetWalkRequested: feetChanged(result.value.events) }
      } catch { return freeze('storage-error') }
    },
    async buildWork(id: string): Promise<PublicV14ControllerOutcome> {
      if (gate === 'blocked') return { status: 'blocked', reason: blockedReason! }
      if (gate !== 'open') return { status: 'busy' }
      gate = 'barrier'
      const checkpoint = await flush()
      if (checkpoint.status === 'blocked') return checkpoint
      if (checkpoint.status === 'deferred-airborne') {
        gate = 'open'
        return checkpoint
      }
      if (session.view().movementOwner !== 'streamed' || !writers.work) {
        gate = 'open'
        return { status: 'rejected', reason: 'unavailable_here' }
      }
      const revision = committed.saveRevision
      try {
        const result = await writers.work(id, revision, structuredClone(committed.lineage))
        if (!result.ok) {
          if (result.reason === 'action-rejected') {
            gate = 'open'
            return { status: 'rejected', reason: result.reason }
          }
          return freeze(result.reason)
        }
        rebase(result.value.start, revision)
        gate = 'open'
        return { status: 'saved', events: [], resetWalkRequested: false,
          workEvent: result.value.event }
      } catch { return freeze('storage-error') }
    },
  }
}
