import { createPublicV15ContinuousSession } from './domain/publicWorldV15ContinuousSession'
import type { PublicV15ContinuousSession, PublicV15SessionFrame } from './domain/publicWorldV15ContinuousSession'
import { advancePublicV15GreenwayAction } from './domain/publicWorldV15Flow'
import type { PublicV15Operation, PublicV15Start } from './domain/publicWorldV15Flow'
import { confirmPublicV14TerrainWork } from './domain/publicWorldV14TerrainWork'
import { confirmPublicV15StarterWork } from './domain/publicWorldV15StarterWork'
import type { PublicTerrainWorkEvent } from './domain/publicTerrainWorkAction'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './domain/publicWorldRuntime'
import { decodePublicV14FrameWitness, PUBLIC_V14_MAX_FRAME_BATCH } from './domain/publicWorldV14Snapshot'
import type { PublicV14Frame } from './domain/publicWorldV14Snapshot'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import type { PublicV15Lineage } from './domain/publicWorldV15Snapshot'
import type { PublicV15Progress } from './domain/publicWorldV15Validation'

const CHECKPOINT_AT = 64
const JUMP_RESERVE = 32
type Gate = 'open' | 'barrier' | 'blocked'
type EventCommit = Readonly<{ start: PublicV15Start; events: readonly PublicWorldEvent[] }>
type WorkCommit = Readonly<{ start: PublicV15Start; event: PublicTerrainWorkEvent }>
export type PublicV15ControllerWriters = Readonly<{
  frames: (frames: readonly PublicV14Frame[], revision: number,
    lineage: PublicV15Lineage) => Promise<PublicV15Operation<EventCommit>>
  action: (intent: PublicWorldIntent, revision: number,
    lineage: PublicV15Lineage) => Promise<PublicV15Operation<EventCommit>>
  work: (id: string, revision: number,
    lineage: PublicV15Lineage) => Promise<PublicV15Operation<WorkCommit>>
  starterWork: (id: string, revision: number,
    lineage: PublicV15Lineage) => Promise<PublicV15Operation<WorkCommit>>
}>
export type PublicV15ControllerOutcome =
  | Readonly<{ status: 'saved'; events: readonly PublicWorldEvent[];
    resetWalkRequested: boolean; workEvent?: PublicTerrainWorkEvent }>
  | Readonly<{ status: 'unchanged' | 'deferred-airborne' | 'busy' }>
  | Readonly<{ status: 'rejected' | 'blocked'; reason: string }>

const feetChanged = (events: readonly PublicWorldEvent[]) => events.some((event) =>
  (event.type === 'item_equipped' || event.type === 'item_unequipped') && event.slot === 'feet')

/** Local previews are never promoted to authority; only a matching checked writer can rebase. */
export function createPublicV15ControllerRuntime(initial: PublicV15Start,
  writers: PublicV15ControllerWriters) {
  if (initial.bootstrap !== null) throw new RangeError('A native v15 start is required.')
  let committed = structuredClone(initial)
  let session: PublicV15ContinuousSession = createPublicV15ContinuousSession(committed)
  const pending: PublicV14Frame[] = []
  const pendingEvents: PublicWorldEvent[] = []
  let gate: Gate = 'open'
  let blockedReason: string | null = null
  const freeze = (reason: string): PublicV15ControllerOutcome => {
    gate = 'blocked'
    blockedReason = reason
    return { status: 'blocked', reason }
  }
  const rebase = (next: PublicV15Start, expectedRevision: number,
    expected: PublicV15Progress): boolean => {
    try {
      if (next.bootstrap !== null || next.saveRevision !== expectedRevision + 1
        || !samePublicV14Value(next.lineage, committed.lineage)
        || !samePublicV14Value({ state: next.state, starterWorks: next.starterWorks }, expected)) {
        return false
      }
      const owned = structuredClone(next)
      const receiving = createPublicV15ContinuousSession(owned)
      committed = owned
      session = receiving
      pending.length = 0
      pendingEvents.length = 0
      return true
    } catch { return false }
  }
  const flush = async (): Promise<PublicV15ControllerOutcome> => {
    if (!pending.length) return { status: 'unchanged' }
    let expected: PublicV15Progress
    try {
      const readiness = session.snapshotForSave()
      if (readiness.status === 'deferred-airborne') return { status: 'deferred-airborne' }
      expected = readiness.progress
    } catch { return freeze('invalid-state') }
    const revision = committed.saveRevision
    let result: PublicV15Operation<EventCommit>
    try { result = await writers.frames(structuredClone(pending), revision,
      structuredClone(committed.lineage)) }
    catch { return freeze('storage-error') }
    try {
      if (!result.ok) return freeze(typeof result.reason === 'string'
        ? result.reason : 'writer-mismatch')
      if (!samePublicV14Value(result.value.events, pendingEvents)
        || !rebase(result.value.start, revision, expected)) return freeze('writer-mismatch')
      return { status: 'saved', events: result.value.events, resetWalkRequested: false }
    } catch { return freeze('writer-mismatch') }
  }
  const unavailable = (intents: readonly PublicWorldIntent[], message: string): PublicV15SessionFrame => ({
    events: [], rejections: [{ intentIndex: 0, intentType: intents?.[0]?.type ?? 'move',
      code: 'unavailable_here', message } satisfies PublicWorldRejection],
  })
  const checkedWork = async (id: string, owner: 'greenway' | 'streamed'):
    Promise<PublicV15ControllerOutcome> => {
    if (gate === 'blocked') return { status: 'blocked', reason: blockedReason! }
    if (gate !== 'open') return { status: 'busy' }
    gate = 'barrier'
    const checkpoint = await flush()
    if (checkpoint.status === 'blocked') return checkpoint
    if (checkpoint.status === 'deferred-airborne') {
      gate = 'open'
      return checkpoint
    }
    if (session.view().movementOwner !== owner) {
      gate = 'open'
      return { status: 'rejected', reason: 'unavailable_here' }
    }
    const before = session.previewSnapshot()
    let expected: PublicV15Progress
    let expectedEvent: PublicTerrainWorkEvent
    if (owner === 'greenway') {
      const candidate = confirmPublicV15StarterWork(before, id)
      if (!candidate.progress) {
        gate = 'open'
        return { status: 'rejected', reason: candidate.rejection }
      }
      expected = candidate.progress
      expectedEvent = candidate.event
    } else {
      const candidate = confirmPublicV14TerrainWork(before.state, id)
      if (!candidate.candidate) {
        gate = 'open'
        return { status: 'rejected', reason: candidate.rejection }
      }
      expected = { state: candidate.candidate, starterWorks: before.starterWorks }
      expectedEvent = candidate.event
    }
    const revision = committed.saveRevision
    let result: PublicV15Operation<WorkCommit>
    try { result = await (owner === 'greenway' ? writers.starterWork : writers.work)(id,
      revision, structuredClone(committed.lineage)) }
    catch { return freeze('storage-error') }
    try {
      if (!result.ok) {
        if (result.reason === 'action-rejected') {
          gate = 'open'
          return { status: 'rejected', reason: result.reason }
        }
        return freeze(typeof result.reason === 'string' ? result.reason : 'writer-mismatch')
      }
      if (!samePublicV14Value(result.value.event, expectedEvent)
        || !rebase(result.value.start, revision, expected)) return freeze('writer-mismatch')
      gate = 'open'
      return { status: 'saved', events: [], resetWalkRequested: false,
        workEvent: result.value.event }
    } catch { return freeze('writer-mismatch') }
  }

  return {
    view: () => session.view(),
    preview: () => session.previewSnapshot(),
    status: () => ({ gate: gate === 'open' && pending.length >= PUBLIC_V14_MAX_FRAME_BATCH
      ? 'cap-paused' as const : gate, blockedReason,
    saveRevision: committed.saveRevision, pendingFrames: pending.length,
    checkpointRecommended: pending.length >= CHECKPOINT_AT,
    checkpointRequired: pending.length >= PUBLIC_V14_MAX_FRAME_BATCH }),
    advanceFrame(intents: readonly PublicWorldIntent[], walkRequested: boolean): PublicV15SessionFrame {
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
        message: 'Only canonical replayable v15 frames are accepted.' }] }
      const frame = witness.frames[0]
      const result = session.advanceFrame(frame.intents, { walkRequested: frame.walkRequested })
      if (!result.rejections.length) {
        pending.push(frame)
        pendingEvents.push(...result.events)
      }
      return result
    },
    async save(): Promise<PublicV15ControllerOutcome> {
      if (gate === 'blocked') return { status: 'blocked', reason: blockedReason! }
      if (gate !== 'open') return { status: 'busy' }
      if (!pending.length) return { status: 'unchanged' }
      gate = 'barrier'
      const outcome = await flush()
      if (outcome.status !== 'blocked') gate = 'open'
      return outcome
    },
    async action(intent: PublicWorldIntent): Promise<PublicV15ControllerOutcome> {
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
      const before = session.previewSnapshot()
      const candidate = advancePublicV15GreenwayAction(before, intent)
      if (candidate.rejections.length) {
        gate = 'open'
        return { status: 'rejected', reason: 'action-rejected' }
      }
      const revision = committed.saveRevision
      let result: PublicV15Operation<EventCommit>
      try { result = await writers.action(structuredClone(intent), revision,
        structuredClone(committed.lineage)) }
      catch { return freeze('storage-error') }
      try {
        if (!result.ok) {
          if (result.reason === 'action-rejected') {
            gate = 'open'
            return { status: 'rejected', reason: result.reason }
          }
          return freeze(typeof result.reason === 'string' ? result.reason : 'writer-mismatch')
        }
        if (!samePublicV14Value(result.value.events, candidate.events)
          || !rebase(result.value.start, revision, candidate.progress)) return freeze('writer-mismatch')
        gate = 'open'
        return { status: 'saved', events: result.value.events,
          resetWalkRequested: feetChanged(result.value.events) }
      } catch { return freeze('writer-mismatch') }
    },
    buildWork: (id: string) => checkedWork(id, 'streamed'),
    buildStarterWork: (id: string) => checkedWork(id, 'greenway'),
  }
}
