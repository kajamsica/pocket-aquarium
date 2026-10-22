import type { PublicV45EntryBindings } from './PublicV45Entry'
import type { PublicV45SaveAck, PublicV45SaveTransport } from './PublicV45SaveTransport'
import { resumePublicV45 } from './domain/publicWorldV45Flow'
import type { PublicV45Operation, PublicV45Start } from './domain/publicWorldV45Flow'
import { decodePublicV45Root, decodePublicV45Witness }
  from './domain/publicWorldV45Snapshot'
import type { PublicV45Witness } from './domain/publicWorldV45Snapshot'
import { sameStrictBoundedRaw } from './domain/strictBoundedRaw'

type Lineage = PublicV45Start['lineage']
const blocked = (reason: string) => ({ ok: false as const, reason })
const progressTerminal = (start: PublicV45Start) => ({
  tick: start.head.state.tick,
  position: start.head.state.player.position,
  yaw: start.head.state.player.yaw,
  groundMountMode: start.head.groundMount.mode,
})

/** READY Worker writes only. A compact ACK is not a usable save until read back. */
export function createPublicV45WorkerBindings(transport: PublicV45SaveTransport,
  bindings: PublicV45EntryBindings, readCurrent: () => PublicV45Start) {
  let nextRequestId = 1
  const snapshot = (revision: number, lineage: Lineage) => {
    if (!Number.isSafeInteger(revision) || revision < 0
      || revision >= Number.MAX_SAFE_INTEGER) return null
    try {
      const current = readCurrent()
      if (revision !== current.head.saveRevision
        || !sameStrictBoundedRaw(lineage, current.lineage, 3 << 20)
        || !sameStrictBoundedRaw(current, current, 3 << 20)) return null
      const detached = structuredClone(current)
      return sameStrictBoundedRaw(detached, current, 3 << 20) ? detached : null
    } catch { return null }
  }
  const readBack = async (before: PublicV45Start,
    requested: PublicV45Witness | null, requestId: number,
    ack: PublicV45SaveAck & { requestId: number }):
    Promise<PublicV45Operation<PublicV45Start>> => {
    if (ack.epoch !== transport.epoch || ack.requestId !== requestId
      || ack.baseRevision !== before.head.saveRevision
      || ack.nextRevision !== ack.baseRevision + 1 || ack.frameCount !== 0)
      return blocked('worker-ack-mismatch')
    try {
      const resumed = await resumePublicV45(bindings.locks, bindings.store,
        bindings.v44Store, ack.nextRevision, before.lineage)
      if (!resumed.ok) return blocked('worker-readback-failed')
      const after = resumed.value
      const candidate = { lineage: after.lineage, previous: before.head,
        head: after.head }
      const checked = decodePublicV45Root(candidate)
      if (!checked || !sameStrictBoundedRaw(checked, candidate, 3 << 20)
        || !sameStrictBoundedRaw(after.lineage, before.lineage, 3 << 20)
        || after.head.saveRevision !== ack.nextRevision
        || !sameStrictBoundedRaw(ack.terminal, progressTerminal(after), 1024)
        || (requested === null ? after.head.witness?.kind !== 'return-home/v1'
          : !sameStrictBoundedRaw(after.head.witness, requested, 1 << 18)))
        return blocked('worker-readback-mismatch')
      return { ok: true, value: after }
    } catch { return blocked('worker-readback-failed') }
  }
  const nextId = () => Number.isSafeInteger(nextRequestId) ? nextRequestId++ : null
  return {
    ridePort: transport,
    async write(revision: number, lineage: Lineage, witness: PublicV45Witness):
      Promise<PublicV45Operation<PublicV45Start>> {
      const before = snapshot(revision, lineage)
      if (!before) return blocked('writer-mismatch')
      let requested: PublicV45Witness
      try {
        if (!sameStrictBoundedRaw(witness, witness, 1 << 18))
          return blocked('invalid-witness')
        requested = structuredClone(witness)
        const decoded = decodePublicV45Witness(requested)
        if (!decoded || decoded.kind === 'return-home/v1'
          || decoded.kind === 'sedgehorn-assisted-ride-batch/v1'
          || !sameStrictBoundedRaw(decoded, requested, 1 << 18))
          return blocked('invalid-witness')
      } catch { return blocked('invalid-witness') }
      const requestId = nextId()
      if (requestId === null) return blocked('request-id-exhausted')
      try {
        const outcome = await transport.commitAction({ requestId,
          expectedRevision: revision, witness: requested })
        if (outcome.status === 'blocked') return blocked(outcome.durability === 'unknown'
          ? 'worker-outcome-unknown' : outcome.reason)
        return readBack(before, requested, requestId, outcome.ack)
      } catch { return blocked('worker-outcome-unknown') }
    },
    async homeWrite(revision: number, lineage: Lineage):
      Promise<PublicV45Operation<PublicV45Start>> {
      const before = snapshot(revision, lineage)
      if (!before) return blocked('writer-mismatch')
      const requestId = nextId()
      if (requestId === null) return blocked('request-id-exhausted')
      try {
        const outcome = await transport.requestReturnHome({ requestId,
          expectedRevision: revision })
        if (outcome.status === 'blocked') return blocked(outcome.durability === 'unknown'
          ? 'worker-outcome-unknown' : outcome.reason)
        return readBack(before, null, requestId, outcome.ack)
      } catch { return blocked('worker-outcome-unknown') }
    },
  }
}
