import { createPublicV16ContinuousSession } from './domain/publicWorldV16ContinuousSession'
import type { PublicV16ContinuousSession, PublicV16SessionFrame } from './domain/publicWorldV16ContinuousSession'
import { advancePublicV16GreenwayAction } from './domain/publicWorldV16GreenwayFrame'
import type { PublicV16Operation, PublicV16Start, PublicV16ActionCommit, PublicV16WorkCommit } from './domain/publicWorldV16Flow'
import { confirmPublicV16GreenwayWork } from './domain/publicWorldV16GreenwayWork'
import { confirmPublicV14TerrainWork } from './domain/publicWorldV14TerrainWork'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './domain/publicWorldRuntime'
import { decodePublicV14FrameWitness, PUBLIC_V14_MAX_FRAME_BATCH } from './domain/publicWorldV14Snapshot'
import type { PublicV14Frame } from './domain/publicWorldV14Snapshot'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import type { PublicV16Lineage } from './domain/publicWorldV16Snapshot'
import type { PublicV16Progress } from './domain/publicWorldV16Validation'

const CHECKPOINT_AT = 64
const JUMP_RESERVE = 32
type Gate = 'open' | 'checkpointing' | 'barrier' | 'blocked'
export type PublicV16ControllerWriters = Readonly<{
  frames: (frames: readonly PublicV14Frame[], revision: number,
    lineage: PublicV16Lineage) => Promise<PublicV16Operation<PublicV16ActionCommit>>
  action: (intent: PublicWorldIntent, revision: number,
    lineage: PublicV16Lineage) => Promise<PublicV16Operation<PublicV16ActionCommit>>
  greenwayWork: (id: string, revision: number,
    lineage: PublicV16Lineage) => Promise<PublicV16Operation<PublicV16WorkCommit>>
  work: (id: string, revision: number,
    lineage: PublicV16Lineage) => Promise<PublicV16Operation<PublicV16WorkCommit>>
}>
export type PublicV16ControllerOutcome =
  | Readonly<{ status: 'saved'; events: readonly PublicWorldEvent[];
    resetWalkRequested: boolean; workEvent?: PublicV16WorkCommit['event'] }>
  | Readonly<{ status: 'unchanged' | 'deferred-airborne' | 'busy' }>
  | Readonly<{ status: 'rejected' | 'blocked'; reason: string }>

const feetChanged = (events: readonly PublicWorldEvent[]) => events.some((event) =>
  (event.type === 'item_equipped' || event.type === 'item_unequipped') && event.slot === 'feet')

/** Local previews are advisory. Only an exact checked writer response can rebase. */
export function createPublicV16ControllerRuntime(initial: PublicV16Start,
  writers: PublicV16ControllerWriters) {
  if (initial.bootstrap !== null) throw new RangeError('A native v16 start is required.')
  let committed = structuredClone(initial)
  let session: PublicV16ContinuousSession = createPublicV16ContinuousSession(committed)
  const pending: PublicV14Frame[] = []
  const pendingEvents: PublicWorldEvent[] = []
  let gate: Gate = 'open'
  let blockedReason: string | null = null
  const freeze = (reason: string): PublicV16ControllerOutcome => {
    gate = 'blocked'
    blockedReason = reason
    return { status: 'blocked', reason }
  }
  const rebase = (next: PublicV16Start, revision: number,
    expected: PublicV16Progress, savedFrames = pending.length,
    savedEvents = pendingEvents.length): boolean => {
    try {
      const owned = structuredClone(next)
      if (!samePublicV14Value(owned, { ...expected, bootstrap: null,
        saveRevision: revision + 1, lineage: committed.lineage })) return false
      const receiving = createPublicV16ContinuousSession(owned)
      const tailEvents: PublicWorldEvent[] = []
      for (const frame of pending.slice(savedFrames)) {
        const replay = receiving.advanceFrame(frame.intents,
          { walkRequested: frame.walkRequested })
        if (replay.rejections.length) return false
        tailEvents.push(...replay.events)
      }
      if (!samePublicV14Value(tailEvents, pendingEvents.slice(savedEvents))
        || savedFrames < pending.length
          && !samePublicV14Value(receiving.previewSnapshot(), session.previewSnapshot())) return false
      committed = owned
      session = receiving
      pending.splice(0, savedFrames)
      pendingEvents.splice(0, savedEvents)
      return true
    } catch { return false }
  }
  const flush = async (): Promise<PublicV16ControllerOutcome> => {
    if (!pending.length) return { status: 'unchanged' }
    let expected: PublicV16Progress
    let batch: readonly PublicV14Frame[]
    let expectedEvents: PublicWorldEvent[]
    try {
      const readiness = session.snapshotForSave()
      if (readiness.status === 'deferred-airborne') return { status: 'deferred-airborne' }
      expected = structuredClone(readiness.progress)
      batch = Object.freeze(structuredClone(pending).map((frame) => {
        for (const intent of frame.intents) {
          if (intent.type === 'move') Object.freeze(intent.delta)
          Object.freeze(intent)
        }
        Object.freeze(frame.intents)
        return Object.freeze(frame)
      }))
      expectedEvents = structuredClone(pendingEvents)
    } catch { return freeze('invalid-state') }
    const revision = committed.saveRevision
    let result: PublicV16Operation<PublicV16ActionCommit>
    try { result = await writers.frames(batch, revision,
      structuredClone(committed.lineage)) }
    catch { return freeze('storage-error') }
    try {
      if (!result.ok) return freeze(typeof result.reason === 'string'
        ? result.reason : 'writer-mismatch')
      if (!samePublicV14Value(result.value.events, expectedEvents)
        || !rebase(result.value.start, revision, expected,
          batch.length, expectedEvents.length)) return freeze('writer-mismatch')
      return { status: 'saved', events: result.value.events, resetWalkRequested: false }
    } catch { return freeze('writer-mismatch') }
  }
  const unavailable = (intents: readonly PublicWorldIntent[], message: string): PublicV16SessionFrame => ({
    events: [], rejections: [{ intentIndex: 0, intentType: intents?.[0]?.type ?? 'move',
      code: 'unavailable_here', message } satisfies PublicWorldRejection],
  })
  const checkedWork = async (id: string, owner: 'greenway' | 'streamed'):
    Promise<PublicV16ControllerOutcome> => {
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
    let expected: PublicV16Progress
    let expectedEvent: PublicV16WorkCommit['event']
    if (owner === 'greenway') {
      const candidate = confirmPublicV16GreenwayWork(before, id)
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
      expected = { state: candidate.candidate, greenwayWorks: before.greenwayWorks }
      expectedEvent = candidate.event
    }
    const revision = committed.saveRevision
    let result: PublicV16Operation<PublicV16WorkCommit>
    try { result = await (owner === 'greenway' ? writers.greenwayWork : writers.work)(id,
      revision, structuredClone(committed.lineage)) }
    catch { return freeze('storage-error') }
    try {
      if (!result.ok) {
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
    advanceFrame(intents: readonly PublicWorldIntent[], walkRequested: boolean): PublicV16SessionFrame {
      if (gate !== 'open' && gate !== 'checkpointing') {
        return unavailable(intents, 'Movement is paused for a write or recovery.')
      }
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
        message: 'Only canonical replayable v16 frames are accepted.' }] }
      const frame = witness.frames[0]
      const result = session.advanceFrame(frame.intents, { walkRequested: frame.walkRequested })
      if (!result.rejections.length) {
        let events: readonly PublicWorldEvent[]
        try { events = structuredClone(result.events) }
        catch {
          freeze('invalid-state')
          return unavailable(intents, 'Movement is paused for recovery.')
        }
        pending.push(frame)
        pendingEvents.push(...events)
      }
      return result
    },
    async save(): Promise<PublicV16ControllerOutcome> {
      if (gate === 'blocked') return { status: 'blocked', reason: blockedReason! }
      if (gate !== 'open') return { status: 'busy' }
      if (!pending.length) return { status: 'unchanged' }
      gate = 'checkpointing'
      const outcome = await flush()
      if (outcome.status !== 'blocked') gate = 'open'
      return outcome
    },
    async action(intent: PublicWorldIntent): Promise<PublicV16ControllerOutcome> {
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
      const candidate = advancePublicV16GreenwayAction(session.previewSnapshot(), intent)
      if (candidate.rejections.length) {
        gate = 'open'
        return { status: 'rejected', reason: 'action-rejected' }
      }
      const revision = committed.saveRevision
      let result: PublicV16Operation<PublicV16ActionCommit>
      try { result = await writers.action(structuredClone(intent), revision,
        structuredClone(committed.lineage)) }
      catch { return freeze('storage-error') }
      try {
        if (!result.ok) {
          return freeze(typeof result.reason === 'string' ? result.reason : 'writer-mismatch')
        }
        if (!samePublicV14Value(result.value.events, candidate.events)
          || !rebase(result.value.start, revision, candidate.progress)) return freeze('writer-mismatch')
        gate = 'open'
        return { status: 'saved', events: result.value.events,
          resetWalkRequested: feetChanged(result.value.events) }
      } catch { return freeze('writer-mismatch') }
    },
    buildGreenwayWork: (id: string) => checkedWork(id, 'greenway'),
    buildWork: (id: string) => checkedWork(id, 'streamed'),
  }
}
