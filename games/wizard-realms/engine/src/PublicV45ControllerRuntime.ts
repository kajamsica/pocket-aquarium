import { createPublicV43ControllerRuntime } from './PublicV43ControllerRuntime'
import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { createPublicV23StreamTerrain } from './domain/publicWorldV14Terrain'
import { publicWorldV16TileAtGrid } from './domain/publicWorldV16GreenwaySites'
import { projectPublicV43MountTraining } from './domain/publicWorldV43MountTraining'
import { decodePublicV43Witness, PUBLIC_V43_SCHEMA } from './domain/publicWorldV43Snapshot'
import type { PublicV43Start } from './domain/publicWorldV43Flow'
import { confirmPublicV45Action, decodePublicV45RideFrameWitness,
  PUBLIC_V45_MAX_RIDE_BATCH } from './domain/publicWorldV45RideAction'
import type { PublicV45Progress, PublicV45RideFrameWitness }
  from './domain/publicWorldV45RideAction'
import type { PublicV45RideBatchWitness } from './domain/publicWorldV45RideAction'
import { decodePublicV45Root } from './domain/publicWorldV45Snapshot'
import type { PublicV45Witness } from './domain/publicWorldV45Snapshot'
import { consumePublicV45CommitReceipt } from './domain/publicWorldV45Flow'
import type { PublicV45Operation, PublicV45Start } from './domain/publicWorldV45Flow'
import { sameStrictBoundedRaw } from './domain/strictBoundedRaw'

type Writer = (revision: number, lineage: PublicV45Start['lineage'],
  witness: PublicV45Witness) => Promise<PublicV45Operation<PublicV45Start>>
type HomeWriter = (revision: number, lineage: PublicV45Start['lineage']) =>
  Promise<PublicV45Operation<PublicV45Start>>
type Shell = ReturnType<typeof createPublicV43ControllerRuntime>
type ShellAction = Parameters<Shell['action']>[0]
type RideAck = Readonly<{ epoch: string; batchId: number; baseRevision: number;
  nextRevision: number; frameCount: number; terminal: Readonly<{
    tick: number; position: PublicV45Progress['state']['player']['position'];
    yaw: number; groundMountMode: 'riding' }> }>
type RideSavePort = Readonly<{ epoch: string;
  commitRideBatch: (input: Readonly<{ batchId: number; expectedRevision: number;
    witness: PublicV45RideBatchWitness }>) => Promise<
      { status: 'committed'; ack: RideAck } | { status: 'blocked'; reason: string;
        durability: 'not-committed' | 'unknown' }>;
  onFatal: (listener: (reason: string) => void) => () => void }>
type RideFlight = Readonly<{ id: number; before: PublicV45Start;
  witness: PublicV45RideBatchWitness; end: PublicV45Progress }>
const progressOf = ({ schemaVersion: _schema, saveRevision: _revision,
  witness: _witness, ...progress }: PublicV45Start['head']): PublicV45Progress => progress

/** Effects own this lifecycle; a speculative render never subscribes or disposes. */
export function createPublicV45RuntimeLifecycle(runtime: Readonly<{
  activate: () => void; deactivate: () => void; dispose: () => void }>) {
  let mounted = false, generation = 0
  return { mount: () => {
    mounted = true; ++generation; runtime.activate()
    return () => {
      mounted = false; runtime.deactivate()
      const closing = ++generation
      queueMicrotask(() => {
        if (!mounted && generation === closing) runtime.dispose()
      })
    }
  } }
}

/** V43 supplies parked controls, but every durable write goes through V45. */
export function createPublicV45ControllerRuntime(initial: PublicV45Start, write: Writer,
  homeWrite?: HomeWriter, ridePort?: RideSavePort) {
  let committed = structuredClone(initial)
  let ridePreview = progressOf(committed.head)
  let rideFrames: PublicV45RideFrameWitness[] = []
  let directBusy = false, directBlocked: string | null = null
  let inFlight: RideFlight | null = null
  let flightPromise: Promise<void> | null = null
  let nextBatchId = 1, drainRequested = false
  let wakeFatal = () => {}
  const fatalSignal = new Promise<void>((resolve) => { wakeFatal = resolve })
  const statusListeners = new Set<() => void>()
  const notifyStatus = () => {
    for (const listener of statusListeners) try { listener() }
    catch { /* UI listeners cannot change save authority. */ }
  }
  let unsubscribeFatal: (() => void) | null = null, disposed = false
  const onFatal = (reason: string) => {
    directBlocked = reason || 'worker-failed'
    wakeFatal()
    notifyStatus()
  }
  const gate = () => directBlocked
    ? { status: 'blocked' as const, reason: directBlocked }
    : directBusy ? { status: 'busy' as const } : null
  const asV43 = (start: PublicV45Start): PublicV43Start => {
    const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
      groundMount: _mount, tack: _tack, ...progress } = start.head
    return { lineage: start.lineage.source.head.v43.lineage,
      head: { ...progress, schemaVersion: PUBLIC_V43_SCHEMA,
        saveRevision: start.head.saveRevision,
        witness: start.head.saveRevision === 0 ? null
          : decodePublicV43Witness(start.head.witness) ?? { kind: 'checkpoint' } } }
  }
  const accept = (before: PublicV45Start, requested: PublicV45Witness | null,
    reply: PublicV45Operation<PublicV45Start>) => {
    if (!reply.ok) return reply
    if (!consumePublicV45CommitReceipt(reply, before, requested)) {
      const witness = reply.value.head.witness
      const expected = witness && confirmPublicV45Action(progressOf(before.head), witness)
      const checked = decodePublicV45Root({ lineage: reply.value.lineage,
        previous: before.head, head: reply.value.head })
      if (!checked || !expected?.progress
        || !sameStrictBoundedRaw(reply.value.lineage, before.lineage, 3 << 20)
        || !sameStrictBoundedRaw(progressOf(reply.value.head), expected.progress, 3 << 20)
        || (requested ? !sameStrictBoundedRaw(witness, requested, 3 << 20)
          : witness?.kind !== 'return-home/v1'))
        return { ok: false as const, reason: 'writer-mismatch' }
    }
    committed = structuredClone(reply.value)
    ridePreview = progressOf(committed.head)
    return reply
  }
  const writeInherited = async (revision: number, lineage: PublicV43Start['lineage'],
    witness: Parameters<Parameters<typeof createPublicV43ControllerRuntime>[1]>[2]) => {
    const projected = asV43(committed)
    if (revision !== projected.head.saveRevision
      || !sameStrictBoundedRaw(lineage, projected.lineage, 3 << 20))
      return { ok: false as const, reason: 'revision-changed' }
    const before = committed
    const reply = accept(before, witness, await write(before.head.saveRevision,
      structuredClone(before.lineage), witness))
    return reply.ok ? { ok: true as const, value: asV43(reply.value) } : reply
  }
  const makeShell = () => createPublicV43ControllerRuntime(asV43(committed), writeInherited)
  let runtime = makeShell()
  const isRiding = () => ridePreview.groundMount.mode === 'riding'
  const mountView = () => {
    const { groundMount, familiar, state } = ridePreview
    const mature = projectPublicV43MountTraining(ridePreview)?.mature === true
    const position = groundMount.mode === 'riding' ? state.player.position
      : groundMount.parkedPosition ?? familiar.position
    return { ...structuredClone(groundMount), mature,
      visible: mature && familiar.phase === 'claimed',
      position: structuredClone(position), yaw: state.player.yaw }
  }
  const blockRide = (reason: string) => {
    directBlocked = reason || 'worker-failed'; notifyStatus()
  }
  const launchRide = () => {
    if (!ridePort || inFlight || !rideFrames.length || directBlocked) return
    const flight: RideFlight = { id: nextBatchId++, before: committed,
      witness: { kind: 'sedgehorn-assisted-ride-batch/v1',
        frames: structuredClone(rideFrames) }, end: structuredClone(ridePreview) }
    rideFrames = []
    inFlight = flight
    notifyStatus()
    flightPromise = Promise.resolve().then(() => ridePort.commitRideBatch({
      batchId: flight.id, expectedRevision: flight.before.head.saveRevision,
      witness: flight.witness })).then((outcome) => {
      if (directBlocked || inFlight !== flight) return
      if (outcome.status !== 'committed') { blockRide(outcome.reason); return }
      const { ack } = outcome
      const { state, groundMount } = flight.end
      if (ack.epoch !== ridePort.epoch || ack.batchId !== flight.id
        || ack.baseRevision !== flight.before.head.saveRevision
        || ack.nextRevision !== ack.baseRevision + 1
        || ack.frameCount !== flight.witness.frames.length
        || groundMount.mode !== 'riding'
        || !sameStrictBoundedRaw(ack.terminal, {
          tick: state.tick, position: state.player.position,
          yaw: state.player.yaw, groundMountMode: groundMount.mode }, 1024)
        || committed.head.saveRevision !== ack.baseRevision) {
        blockRide('ride-ack-mismatch')
        return
      }
      committed = { lineage: flight.before.lineage,
        head: { ...flight.end, schemaVersion: flight.before.head.schemaVersion,
          saveRevision: ack.nextRevision, witness: flight.witness } }
      inFlight = null
      notifyStatus()
      if (rideFrames.length >= PUBLIC_V45_MAX_RIDE_BATCH || drainRequested)
        launchRide()
    }).catch(() => { if (!directBlocked) blockRide('worker-failed') })
  }
  const drainRide = async () => {
    const hadFrames = Boolean(inFlight || rideFrames.length)
    drainRequested = true
    try {
      while ((inFlight || rideFrames.length) && !directBlocked) {
        if (!inFlight) launchRide()
        if (!flightPromise) { blockRide('worker-failed'); break }
        await Promise.race([flightPromise, fatalSignal])
      }
      if (directBlocked) return { status: 'blocked' as const,
        reason: directBlocked }
      if (hadFrames) runtime = makeShell()
      return hadFrames ? { status: 'saved' as const, events: [],
        resetWalkRequested: false } : { status: 'unchanged' as const }
    } finally { drainRequested = false }
  }
  const flushRide = async () => {
    if (ridePort) return drainRide()
    if (!rideFrames.length) return { status: 'unchanged' as const }
    const before = committed
    const previewBeforeWrite = ridePreview
    const witness = { kind: 'sedgehorn-assisted-ride-batch/v1' as const,
      frames: structuredClone(rideFrames) }
    try {
      const reply = accept(before, witness, await write(before.head.saveRevision,
        structuredClone(before.lineage), witness))
      if (!reply.ok) {
        blockRide(reply.reason)
        return { status: 'blocked' as const, reason: reply.reason }
      }
      if (!sameStrictBoundedRaw(previewBeforeWrite, progressOf(reply.value.head), 3 << 20)) {
        blockRide('preview-desync')
        return { status: 'blocked' as const, reason: directBlocked }
      }
      rideFrames = []
      runtime = makeShell()
      return { status: 'saved' as const, events: [], resetWalkRequested: false }
    } catch {
      blockRide('storage-error')
      return { status: 'blocked' as const, reason: directBlocked }
    }
  }
  const rejectFrame = (intents: Parameters<Shell['advanceFrame']>[0],
    code: 'invalid_frame' | 'terrain_missing' | 'unavailable_here', message: string) => ({
      events: [], rejections: [{ intentIndex: 0, intentType: intents[0]?.type ?? 'move',
        code, message }] })
  return {
    committed: () => structuredClone(committed),
    activate() {
      if (!disposed && ridePort && !unsubscribeFatal)
        unsubscribeFatal = ridePort.onFatal(onFatal)
    },
    deactivate() { unsubscribeFatal?.(); unsubscribeFatal = null },
    subscribeStatus(listener: () => void) {
      statusListeners.add(listener)
      return () => { statusListeners.delete(listener) }
    },
    groundMount: mountView,
    view: () => {
      if (!isRiding()) return runtime.view()
      const { state, regionalWorks } = ridePreview
      const activeTiles = state.movementOwner === 'greenway'
        ? state.greenway.tiles.map((tile) => publicWorldV16TileAtGrid(state.seed,
          tile.center.x / 4, tile.center.z / 4))
        : createPublicV23StreamTerrain(state, regionalWorks.builtLadderIds).activeTiles()
      return { movementOwner: state.movementOwner, tick: state.tick,
        player: structuredClone(state.player), activeTiles: structuredClone(activeTiles),
        activeKnownTileIds: discoveredTileIdsInActiveWindow(state.discoveryMask,
          state.player.position), pendingBoundary: false }
    },
    preview: () => ({ ...runtime.preview(), ...(isRiding() ? ridePreview : {}),
      groundMount: mountView(), tack: ridePreview.tack }),
    status: () => {
      const base = { ...runtime.status(), durableRevision: committed.head.saveRevision }
      if (!isRiding()) return directBlocked ? { ...base, gate: 'blocked' as const,
        blockedReason: directBlocked } : directBusy
          ? { ...base, gate: 'barrier' as const } : base
      const pendingFrames = rideFrames.length
        + (inFlight?.witness.frames.length ?? 0)
      return { ...base, pendingFrames,
        checkpointRecommended: pendingFrames >= PUBLIC_V45_MAX_RIDE_BATCH / 2,
        checkpointRequired: pendingFrames >= (ridePort
          ? 2 * PUBLIC_V45_MAX_RIDE_BATCH : PUBLIC_V45_MAX_RIDE_BATCH),
        gate: directBlocked ? 'blocked' as const : directBusy ? 'barrier' as const
          : rideFrames.length >= PUBLIC_V45_MAX_RIDE_BATCH
            ? 'cap-paused' as const : base.gate,
        blockedReason: directBlocked ?? base.blockedReason }
    },
    idleFrameNeeded: () => !isRiding() && !gate() && runtime.idleFrameNeeded(),
    advanceFrame(...args: Parameters<Shell['advanceFrame']>) {
      if (gate()) return rejectFrame(args[0], 'unavailable_here',
        'Movement is paused for a checked write.')
      if (!isRiding()) return runtime.advanceFrame(...args)
      if (rideFrames.length >= PUBLIC_V45_MAX_RIDE_BATCH)
        return rejectFrame(args[0], 'unavailable_here',
          'Saving the current Sedgehorn ride before moving farther.')
      const witness = decodePublicV45RideFrameWitness({
        kind: 'sedgehorn-assisted-ride-frame/v1', intents: args[0] })
      if (!witness) return rejectFrame(args[0], 'invalid_frame',
        'The Sedgehorn cannot jump or use this movement.')
      const checked = confirmPublicV45Action(ridePreview, witness)
      if (!checked.progress) return rejectFrame(args[0], 'terrain_missing',
        `The Sedgehorn cannot ride safely here (${checked.rejection}).`)
      ridePreview = checked.progress
      rideFrames.push(witness)
      if (ridePort && rideFrames.length === PUBLIC_V45_MAX_RIDE_BATCH)
        launchRide()
      return { events: [...checked.events], rejections: [] }
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
          blockRide(reply.reason)
          return { status: 'blocked' as const, reason: reply.reason }
        }
        runtime = makeShell()
        return { status: 'saved' as const, events: [], resetWalkRequested: false }
      } catch {
        blockRide('storage-error')
        return { status: 'blocked' as const, reason: directBlocked }
      } finally { directBusy = false }
    },
    async action(raw: ShellAction | PublicV45Witness) {
      const stopped = gate()
      if (stopped) return stopped
      if (!raw || typeof raw !== 'object' || !('kind' in raw))
        return { status: 'rejected' as const, reason: 'invalid_value' as const }
      if (raw.kind !== 'sedgehorn-mount/v1' && raw.kind !== 'sedgehorn-dismount/v1'
        && raw.kind !== 'buy-sedgehorn-tack/v1' && raw.kind !== 'sell-marsh-herb/v1')
        return isRiding() || (raw.kind.startsWith('sedgehorn-')
          && raw.kind !== 'sedgehorn-care/v1')
          ? { status: 'rejected' as const, reason: 'unavailable_here' as const }
          : runtime.action(raw as ShellAction)
      const ridingCheck = isRiding() ? confirmPublicV45Action(ridePreview, raw) : null
      if (ridingCheck && !ridingCheck.progress)
        return { status: 'rejected' as const, reason: ridingCheck.rejection }
      directBusy = true
      try {
        const saved = isRiding() ? await flushRide() : await runtime.save()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const checked = confirmPublicV45Action(progressOf(committed.head), raw)
        if (!checked.progress) return { status: 'rejected' as const,
          reason: checked.rejection }
        const before = committed
        const reply = accept(before, raw, await write(before.head.saveRevision,
          structuredClone(before.lineage), raw))
        if (!reply.ok) {
          blockRide(reply.reason)
          return { status: 'blocked' as const, reason: reply.reason }
        }
        runtime = makeShell()
        return { status: 'saved' as const, events: [], resetWalkRequested: false }
      } catch {
        blockRide('storage-error')
        return { status: 'blocked' as const, reason: directBlocked }
      } finally { directBusy = false }
    },
    dispose() {
      unsubscribeFatal?.(); unsubscribeFatal = null
      disposed = true; statusListeners.clear()
    },
  }
}
