import { createPublicV43ControllerRuntime } from './PublicV43ControllerRuntime'
import { sameStrictBoundedRaw } from './domain/strictBoundedRaw'
import { checkPublicV44RidePreviewStep, confirmPublicV44GroundMountAction,
  decodePublicV44GroundMountWitness,
  PUBLIC_V44_MAX_RIDE_BATCH } from './domain/publicWorldV44GroundMount'
import type { PublicV44GroundMountProgress,
  PublicV44GroundMountWitness } from './domain/publicWorldV44GroundMount'
import { projectPublicV43MountTraining } from './domain/publicWorldV43MountTraining'
import { decodePublicV44CheckedSuccessor } from './domain/publicWorldV44Snapshot'
import type { PublicV44Root, PublicV44Witness } from './domain/publicWorldV44Snapshot'
import type { PublicV44Operation, PublicV44Start } from './domain/publicWorldV44Flow'
import type { PublicV43Start } from './domain/publicWorldV43Flow'

type Writer = (revision: number, lineage: PublicV44Start['lineage'],
  witness: PublicV44Witness) => Promise<PublicV44Operation<PublicV44Start>>
type HomeWriter = (revision: number, lineage: PublicV44Start['lineage']) =>
  Promise<PublicV44Operation<PublicV44Start>>
type V43Runtime = ReturnType<typeof createPublicV43ControllerRuntime>
type InheritedAction = Parameters<V43Runtime['action']>[0]
type RideFrame = Extract<PublicV44GroundMountWitness, { intents: unknown }>

/** V43 remains a disposable control shell; only the V44 checked writer persists changes. */
export function createPublicV44ControllerRuntime(initial: PublicV44Start, write: Writer,
  homeWrite?: HomeWriter) {
  let committed = structuredClone(initial)
  let ridePreview: PublicV44GroundMountProgress = { v43: committed.head.v43,
    groundMount: committed.head.groundMount }
  let rideFrames: RideFrame[] = []
  let directBusy = false, directBlocked: string | null = null
  const gate = () => directBlocked
    ? { status: 'blocked' as const, reason: directBlocked }
    : directBusy ? { status: 'busy' as const } : null
  const accept = (before: PublicV44Start, witness: PublicV44Witness | null,
    reply: PublicV44Operation<PublicV44Start>): PublicV44Operation<PublicV44Start> => {
    if (!reply.ok) return reply
    const checked = decodePublicV44CheckedSuccessor(
      { ...before, previous: null } as PublicV44Root,
      { lineage: reply.value.lineage, previous: before.head, head: reply.value.head })
    if (!checked || (witness
      ? !sameStrictBoundedRaw(checked.head.witness, witness, 3 << 20)
      : checked.head.witness?.kind !== 'return-home/v1'))
      return { ok: false, reason: 'writer-mismatch' }
    committed = structuredClone(reply.value)
    ridePreview = { v43: committed.head.v43, groundMount: committed.head.groundMount }
    return reply
  }
  const writeInherited = async (revision: number, lineage: PublicV43Start['lineage'],
    witness: Parameters<Parameters<typeof createPublicV43ControllerRuntime>[1]>[2]) => {
    const nested = committed.head.v43
    if (revision !== nested.head.saveRevision
      || !sameStrictBoundedRaw(lineage, nested.lineage, 3 << 20))
      return { ok: false as const, reason: 'revision-changed' }
    const before = committed
    const result = accept(before, witness, await write(before.head.saveRevision,
      structuredClone(before.lineage), witness))
    return result.ok
      ? { ok: true as const, value: { head: result.value.head.v43.head,
        lineage: result.value.head.v43.lineage } }
      : result
  }
  const makeShell = () => createPublicV43ControllerRuntime({
    head: committed.head.v43.head, lineage: committed.head.v43.lineage }, writeInherited)
  let runtime = makeShell()
  const isRiding = () => committed.head.groundMount.mode === 'riding'
  const mountView = () => {
    const { groundMount, v43 } = ridePreview
    const mature = projectPublicV43MountTraining(v43.head)?.mature === true
    const current = groundMount.mode === 'riding' ? runtime.preview().state.player : null
    const position = current ? current.position
      : groundMount.parkedPosition ?? v43.head.familiar.position
    return { ...structuredClone(groundMount), mature,
      visible: mature && v43.head.familiar.phase === 'claimed',
      position: structuredClone(position), yaw: current?.yaw ?? v43.head.state.player.yaw }
  }
  const flushRide = async () => {
    if (!rideFrames.length) return { status: 'unchanged' as const }
    const before = committed
    const witness = { kind: 'sedgehorn-ride-batch/v1' as const,
      frames: structuredClone(rideFrames) }
    try {
      const reply = accept(before, witness, await write(before.head.saveRevision,
        structuredClone(before.lineage), witness))
      if (!reply.ok) {
        directBlocked = reply.reason
        return { status: 'blocked' as const, reason: reply.reason }
      }
      rideFrames = []
      runtime = makeShell()
      return { status: 'saved' as const, events: [], resetWalkRequested: false }
    } catch {
      directBlocked = 'storage-error'
      return { status: 'blocked' as const, reason: directBlocked }
    }
  }
  const rejectFrame = (intents: Parameters<V43Runtime['advanceFrame']>[0],
    code: 'invalid_frame' | 'terrain_missing' | 'unavailable_here', message: string) => ({
    events: [], rejections: [{ intentIndex: 0, intentType: intents[0]?.type ?? 'move',
      code, message }] })
  return {
    committed: () => structuredClone(committed),
    groundMount: mountView,
    view: () => runtime.view(),
    preview: () => ({ ...runtime.preview(), groundMount: mountView() }),
    status: () => {
      const base = runtime.status()
      if (!isRiding()) return directBlocked ? { ...base, gate: 'blocked' as const,
        blockedReason: directBlocked } : directBusy
        ? { ...base, gate: 'barrier' as const } : base
      const pendingFrames = rideFrames.length
      return { ...base, pendingFrames,
        checkpointRecommended: pendingFrames >= PUBLIC_V44_MAX_RIDE_BATCH / 2,
        checkpointRequired: pendingFrames >= PUBLIC_V44_MAX_RIDE_BATCH,
        gate: directBlocked ? 'blocked' as const : directBusy ? 'barrier' as const
          : pendingFrames >= PUBLIC_V44_MAX_RIDE_BATCH ? 'cap-paused' as const
            : base.gate,
        blockedReason: directBlocked ?? base.blockedReason }
    },
    idleFrameNeeded: () => !isRiding() && !gate() && runtime.idleFrameNeeded(),
    advanceFrame(...args: Parameters<V43Runtime['advanceFrame']>) {
      if (gate()) return rejectFrame(args[0], 'unavailable_here',
        'Movement is paused for a checked write.')
      if (!isRiding()) return runtime.advanceFrame(...args)
      if (rideFrames.length >= PUBLIC_V44_MAX_RIDE_BATCH)
        return rejectFrame(args[0], 'unavailable_here',
          'Saving the current Sedgehorn ride before moving farther.')
      const witness = decodePublicV44GroundMountWitness({
        kind: 'sedgehorn-ride-frame/v2', intents: args[0] })
      if (witness?.kind !== 'sedgehorn-ride-frame/v2')
        return rejectFrame(args[0], 'invalid_frame',
          'The Sedgehorn cannot jump or use this movement.')
      const before = runtime.preview()
      const projected = runtime.advanceFrame(args[0], false)
      if (projected.rejections.length) return projected
      const rejection = checkPublicV44RidePreviewStep(before, runtime.preview(), witness)
      if (rejection) {
        runtime = makeShell()
        for (const accepted of rideFrames) {
          if (runtime.advanceFrame(accepted.intents, false).rejections.length) {
            directBlocked = 'preview-desync'
            return rejectFrame(args[0], 'unavailable_here',
              'The Sedgehorn ride preview is out of sync. Movement is paused.')
          }
        }
        if (!sameStrictBoundedRaw(runtime.preview(), before, 3 << 20)) {
          directBlocked = 'preview-desync'
          return rejectFrame(args[0], 'unavailable_here',
            'The Sedgehorn ride preview is out of sync. Movement is paused.')
        }
        return rejectFrame(args[0], 'terrain_missing',
          `The Sedgehorn cannot ride safely here (${rejection}).`)
      }
      rideFrames.push(witness)
      return projected
    },
    async save() {
      const stopped = gate()
      if (stopped) return stopped
      if (!isRiding()) return runtime.save()
      directBusy = true
      try { return await flushRide() } finally { directBusy = false }
    },
    async returnHome() {
      const stopped = gate()
      if (stopped) return stopped
      if (isRiding()) return { status: 'rejected' as const,
        reason: 'must-dismount' as const }
      if (!homeWrite) return { status: 'rejected' as const,
        reason: 'unavailable_here' as const }
      directBusy = true
      try {
        const saved = await runtime.save()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const before = committed
        const reply = accept(before, null, await homeWrite(before.head.saveRevision,
          structuredClone(before.lineage)))
        if (!reply.ok) {
          if (reply.reason === 'not_trapped' || reply.reason === 'cooldown')
            return { status: 'rejected' as const, reason: reply.reason }
          directBlocked = reply.reason
          return { status: 'blocked' as const, reason: reply.reason }
        }
        runtime = makeShell()
        return { status: 'saved' as const, events: [], resetWalkRequested: false }
      } catch {
        directBlocked = 'storage-error'
        return { status: 'blocked' as const, reason: directBlocked }
      } finally { directBusy = false }
    },
    async action(raw: InheritedAction | PublicV44GroundMountWitness) {
      const stopped = gate()
      if (stopped) return stopped
      if (!raw || typeof raw !== 'object' || !('kind' in raw))
        return { status: 'rejected' as const, reason: 'invalid_value' as const }
      if (raw.kind !== 'sedgehorn-mount/v1' && raw.kind !== 'sedgehorn-dismount/v1')
        return isRiding() || raw.kind.startsWith('sedgehorn-')
          ? { status: 'rejected' as const, reason: 'unavailable_here' as const }
          : runtime.action(raw as InheritedAction)
      directBusy = true
      try {
        const saved = isRiding() ? await flushRide() : await runtime.save()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const witness = { kind: raw.kind }
        const checked = confirmPublicV44GroundMountAction({ v43: committed.head.v43,
          groundMount: committed.head.groundMount }, witness)
        if (!checked.progress) return { status: 'rejected' as const,
          reason: checked.rejection }
        const before = committed
        const reply = accept(before, witness, await write(before.head.saveRevision,
          structuredClone(before.lineage), witness))
        if (!reply.ok) {
          directBlocked = reply.reason
          return { status: 'blocked' as const, reason: reply.reason }
        }
        runtime = makeShell()
        return { status: 'saved' as const, events: [], resetWalkRequested: false }
      } catch {
        directBlocked = 'storage-error'
        return { status: 'blocked' as const, reason: directBlocked }
      } finally { directBusy = false }
    },
  }
}
