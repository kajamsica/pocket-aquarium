import { describe, expect, it } from 'vitest'
import { publicV14MovementIntents } from './PublicV14Controller'
import { createPublicV45ControllerRuntime } from './PublicV45ControllerRuntime'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { createFreshPublicV42Root, decodePublicV42Root, PUBLIC_V42_SCHEMA }
  from './domain/publicWorldV42Snapshot'
import type { PublicV42Root } from './domain/publicWorldV42Snapshot'
import { createPublicV43Root, decodePublicV43CheckedSuccessor,
  decodePublicV43Root, replayPublicV43Witness, PUBLIC_V43_SCHEMA }
  from './domain/publicWorldV43Snapshot'
import type { PublicV43Root } from './domain/publicWorldV43Snapshot'
import { createPublicV44Root } from './domain/publicWorldV44Snapshot'
import { confirmPublicV45Action } from './domain/publicWorldV45RideAction'
import { PUBLIC_V45_MAX_RIDE_BATCH } from './domain/publicWorldV45RideAction'
import { createPublicV45Genesis, PUBLIC_V45_SCHEMA }
  from './domain/publicWorldV45Migration'
import { decodePublicV45Root } from './domain/publicWorldV45Snapshot'
import type { PublicV45Root, PublicV45Witness } from './domain/publicWorldV45Snapshot'
import { resolveSedgehornFamiliarSite } from './domain/sedgehornFamiliarContent'
import { sameStrictBoundedRaw } from './domain/strictBoundedRaw'
import { waystationRiverSite } from './domain/waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './domain/worldChunks'

function matureSource(careCount = 3): PublicV43Root {
  const seed = 'wizard-realms'
  const fresh = createFreshPublicV42Root(seed)
  const site = resolveSedgehornFamiliarSite(fresh.head)!
  const bridge = waystationRiverSite(seed)!
  const nearby: string[] = []
  for (const tile of [site.tracks, site.shelter, site.dryApproach,
    site.keeper, site.careStation]) {
    const gx = Math.round(tile.center.x / WORLD_CELL_METERS)
    const gz = Math.round(tile.center.z / WORLD_CELL_METERS)
    for (let x = gx - 1; x <= gx + 1; x++)
      for (let z = gz - 1; z <= gz + 1; z++)
        nearby.push(worldTileAtGrid(seed, x, z).id)
  }
  const genesis = { ...fresh.lineage.genesis, southbankReached: true,
    riverBridgeIds: [bridge.id], state: { ...fresh.head.state,
      tick: 1300, eventSequence: 10, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(fresh.head.state.discoveryMask),
        ...bridge.footprintTileIds, ...nearby])].sort()),
      player: { ...fresh.head.state.player, position: { ...(careCount < 3
        ? site.careStation.center : site.keeper.center) }, verticalVelocity: 0,
        ...(careCount < 3 ? { coins: 300, inventory: [
          ...fresh.head.state.player.inventory,
          { itemId: 'marsh_herb' as const, quantity: 1 }] } : {}) } } }
  const v42: PublicV42Root = { lineage: { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed, sourceRevision: 4, genesis },
    previous: null, head: { ...structuredClone(genesis), schemaVersion: PUBLIC_V42_SCHEMA,
      saveRevision: 0, witness: null } }
  if (!decodePublicV42Root(v42)) throw new Error('Invalid V42 fixture')
  let root = createPublicV43Root(v42)
  const idle = { kind: 'frame-batch/v1' as const,
    frames: [{ intents: [], walkRequested: true }] }
  for (let index = 0; index < 3; index++) {
    const progress = replayPublicV43Witness(root.head, idle)!
    root = decodePublicV43CheckedSuccessor(root, { lineage: root.lineage,
      previous: root.head, head: { ...progress, schemaVersion: PUBLIC_V43_SCHEMA,
        saveRevision: root.head.saveRevision + 1, witness: idle } })!
  }
  const careWitnesses = [0, 600, 1200].map((tick, index) => ({
    kind: 'sedgehorn-care/v1' as const, tick, eventSequence: index + 1 }))
  const claimed = (head: PublicV43Root['head']) => ({ ...head,
    familiar: { ...head.familiar, phase: 'claimed' as const,
      routeChoice: 'shelter' as const, position: { ...site.keeper.center },
      trust: 2, creatureCareXp: 40, stationKnown: true },
    mountTraining: { careWitnesses: careWitnesses.slice(0, careCount) }, state: { ...head.state,
      player: { ...head.state.player, position: { ...(careCount < 3
        ? site.careStation.center : site.keeper.center) },
        coins: careCount < 3 ? 300 : head.state.player.coins + 25,
        xp: head.state.player.xp + 40,
        level: 1 + Math.floor((head.state.player.xp + 40) / 100) } } })
  const checked = decodePublicV43Root({ ...root,
    previous: claimed(root.previous!), head: claimed(root.head) })
  if (!checked) throw new Error('Invalid mature V43 fixture')
  return checked
}

function checkedWriter(genesis: PublicV45Root) {
  let current = genesis
  const writes: PublicV45Witness[] = []
  return { writes, current: () => current,
    write: async (revision: number, lineage: PublicV45Root['lineage'],
      witness: PublicV45Witness) => {
      writes.push(witness)
      if (revision !== current.head.saveRevision
        || !sameStrictBoundedRaw(lineage, current.lineage, 3 << 20))
        return { ok: false as const, reason: 'revision-changed' }
      const { schemaVersion: _schema, saveRevision: _revision,
        witness: _prior, ...before } = current.head
      const checked = confirmPublicV45Action(before, witness)
      if (!checked.progress) return { ok: false as const, reason: checked.rejection }
      const next = decodePublicV45Root({ lineage: current.lineage,
        previous: current.head, head: { ...checked.progress,
          schemaVersion: PUBLIC_V45_SCHEMA, saveRevision: revision + 1, witness } })
      if (!next) return { ok: false as const, reason: 'invalid-successor' }
      current = next
      return { ok: true as const, value: { head: next.head, lineage: next.lineage } }
    } }
}

type RidePort = NonNullable<Parameters<typeof createPublicV45ControllerRuntime>[3]>
type RideInput = Parameters<RidePort['commitRideBatch']>[0]
type RideOutcome = Awaited<ReturnType<RidePort['commitRideBatch']>>
type RideAck = Extract<RideOutcome, { status: 'committed' }>['ack']
async function queuedRider() {
  const genesis = createPublicV45Genesis(createPublicV44Root(matureSource()))
  const writer = checkedWriter(genesis)
  const pending: { input: RideInput; resolve: (outcome: RideOutcome) => void }[] = []
  let fatal: ((reason: string) => void) | null = null
  const port: RidePort = { epoch: 'test-session',
    commitRideBatch: (input) => new Promise((resolve) => { pending.push({ input, resolve }) }),
    onFatal: (listener) => { fatal = listener; return () => { fatal = null } } }
  const runtime = createPublicV45ControllerRuntime(genesis, writer.write, undefined, port)
  expect(await runtime.action({ kind: 'sedgehorn-mount/v1' }))
    .toMatchObject({ status: 'saved' })
  const settle = async (index: number, alter: (ack: RideAck) => RideAck = (ack) => ack) => {
    const { input, resolve } = pending[index]!
    const reply = await writer.write(input.expectedRevision,
      writer.current().lineage, input.witness)
    if (!reply.ok) throw new Error(reply.reason)
    const { state, groundMount } = reply.value.head
    if (groundMount.mode !== 'riding') throw new Error('Not riding')
    resolve({ status: 'committed', ack: alter({ epoch: port.epoch,
      batchId: input.batchId, baseRevision: input.expectedRevision,
      nextRevision: reply.value.head.saveRevision,
      frameCount: input.witness.frames.length,
      terminal: { tick: state.tick, position: state.player.position,
        yaw: state.player.yaw, groundMountMode: groundMount.mode } }) })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { runtime, writer, pending, settle, fail: (reason: string) => fatal?.(reason) }
}
const turn = (delta: number) => [{ type: 'look' as const,
  yawDelta: delta, pitchDelta: 0 }]

describe('V45 controller runtime', () => {
  it('continues checked V43 Sedgehorn care after V44 import while parked', async () => {
    const genesis = createPublicV45Genesis(createPublicV44Root(matureSource(2)))
    const writer = checkedWriter(genesis)
    const runtime = createPublicV45ControllerRuntime(genesis, writer.write)
    expect(runtime.preview().mountTraining?.careWitnesses).toHaveLength(2)
    expect(runtime.preview().state.player.coins).toBe(300)
    expect(await runtime.action({ kind: 'sedgehorn-care/v1', extra: true } as never))
      .toMatchObject({ status: 'rejected', reason: 'invalid_value' })
    expect(await runtime.action({ kind: 'sedgehorn-unknown/v1' } as never))
      .toMatchObject({ status: 'rejected', reason: 'unavailable_here' })
    expect(await runtime.action({ kind: 'sedgehorn-care/v1' }))
      .toEqual({ status: 'saved', events: [], resetWalkRequested: false })
    expect(writer.writes.at(-1)?.kind).toBe('sedgehorn-care/v1')
    expect(runtime.committed().head.mountTraining?.careWitnesses).toHaveLength(3)
    expect(runtime.committed().head.saveRevision).toBe(genesis.head.saveRevision + 1)
  }, 30_000)

  it('fully checks a writer reply with no durable Flow receipt', async () => {
    const genesis = createPublicV45Genesis(createPublicV44Root(matureSource()))
    const runtime = createPublicV45ControllerRuntime(genesis,
      async (revision, lineage, witness) => ({ ok: true,
        value: { head: { ...genesis.head, saveRevision: revision + 1, witness },
          lineage } }))
    expect(await runtime.action({ kind: 'sedgehorn-mount/v1' }))
      .toMatchObject({ status: 'blocked', reason: 'writer-mismatch' })
  })

  it('keeps assisted preview transient and writes one checked bounded ride batch', async () => {
    const genesis = createPublicV45Genesis(createPublicV44Root(matureSource()))
    const writer = checkedWriter(genesis)
    const { writes } = writer
    const runtime = createPublicV45ControllerRuntime(genesis, writer.write)
    expect(runtime.advanceFrame([], true).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writes.at(-1)?.kind).toBe('frame-batch/v1')
    expect(await runtime.action({ kind: 'sedgehorn-mount/v1' })).toMatchObject({
      status: 'saved' })
    const count = writes.length
    const beforeTurn = runtime.preview().state.player
    const turn = publicV14MovementIntents(beforeTurn.yaw, [1, 0], 0.24)
    expect(turn).toHaveLength(1)
    expect(runtime.advanceFrame(turn, false).rejections).toEqual([])
    const turnedYaw = runtime.preview().state.player.yaw
    expect(turnedYaw).not.toBe(beforeTurn.yaw)
    expect(runtime.preview().state.player.position).toEqual(beforeTurn.position)
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: 99, pitchDelta: 0 }], false)
      .rejections).toHaveLength(1)
    expect(runtime.preview().state.player.yaw).toBe(turnedYaw)
    expect(runtime.preview().state.player.position).toEqual(beforeTurn.position)
    const frame = [{ type: 'move' as const, delta: { x: 0.12, z: 0 } }]
    const initial = runtime.preview().state.player.position.x
    expect(runtime.advanceFrame(frame, false).rejections).toEqual([])
    expect(runtime.advanceFrame(frame, false).rejections).toEqual([])
    expect(runtime.preview().state.player.position.x).toBeGreaterThan(initial + 0.3)
    expect(writes).toHaveLength(count)
    const beforeBad = runtime.preview().state.player.position
    expect(await runtime.action({ kind: 'buy-sedgehorn-tack/v1' }))
      .toMatchObject({ status: 'rejected' })
    expect(writes).toHaveLength(count)
    expect(runtime.preview().state.player.position).toEqual(beforeBad)
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 9, z: 0 } }], false)
      .rejections).toHaveLength(1)
    expect(runtime.preview().state.player.position).toEqual(beforeBad)
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writes).toHaveLength(count + 1)
    expect(writes.at(-1)).toMatchObject({ kind: 'sedgehorn-assisted-ride-batch/v1',
      frames: [{ kind: 'sedgehorn-assisted-ride-frame/v1', intents: turn },
        { kind: 'sedgehorn-assisted-ride-frame/v1' },
        { kind: 'sedgehorn-assisted-ride-frame/v1' }] })
    expect(runtime.committed().head.state.player.position)
      .toEqual(runtime.preview().state.player.position)
    const resumed = createPublicV45ControllerRuntime(writer.current(),
      async () => ({ ok: false, reason: 'read-only' }))
    expect(resumed.preview().state.player.yaw).toBe(turnedYaw)
  }, 30_000)

  it('continues checked preview during A, caps B, and drains exact ACKs without a snap',
    async () => {
      const { runtime, pending, settle, writer } = await queuedRider()
      const base = runtime.committed().head.saveRevision
      for (let index = 0; index < PUBLIC_V45_MAX_RIDE_BATCH; index++)
        expect(runtime.advanceFrame(turn(index % 2 ? -0.04 : 0.04), false)
          .rejections).toEqual([])
      await Promise.resolve()
      expect(pending).toHaveLength(1)
      expect(runtime.status().durableRevision).toBe(base)
      for (let index = 0; index < PUBLIC_V45_MAX_RIDE_BATCH; index++)
        expect(runtime.advanceFrame(turn(index % 2 ? -0.04 : 0.04), false)
          .rejections).toEqual([])
      const latest = structuredClone(runtime.preview().state)
      expect(runtime.status()).toMatchObject({ pendingFrames:
        2 * PUBLIC_V45_MAX_RIDE_BATCH, gate: 'cap-paused' })
      expect(runtime.advanceFrame(turn(0.04), false).rejections).toHaveLength(1)
      expect(runtime.preview().state).toEqual(latest)
      let saved = false
      const saving = runtime.save().then((result) => { saved = true; return result })
      expect(saved).toBe(false)
      await settle(0)
      expect(runtime.committed().head.saveRevision).toBe(base + 1)
      expect(runtime.preview().state).toEqual(latest)
      expect(pending).toHaveLength(2)
      expect(saved).toBe(false)
      await settle(1)
      expect(await saving).toMatchObject({ status: 'saved' })
      expect(runtime.status()).toMatchObject({ pendingFrames: 0,
        durableRevision: base + 2 })
      expect(runtime.preview().state).toEqual(latest)
      expect(runtime.committed().head.state).toEqual(latest)
      expect(writer.writes.filter((witness) => witness.kind
        === 'sedgehorn-assisted-ride-batch/v1')).toHaveLength(2)
    }, 30_000)

  it('freezes unsaved preview on a wrong or replayed ACK', async () => {
    const first = await queuedRider()
    for (let index = 0; index < PUBLIC_V45_MAX_RIDE_BATCH; index++)
      expect(first.runtime.advanceFrame(turn(0.04), false).rejections).toEqual([])
    await Promise.resolve()
    expect(first.runtime.advanceFrame(turn(-0.04), false).rejections).toEqual([])
    const preview = structuredClone(first.runtime.preview().state)
    await first.settle(0, (ack) => ({ ...ack, batchId: ack.batchId + 1 }))
    expect(first.runtime.status()).toMatchObject({ gate: 'blocked',
      blockedReason: 'ride-ack-mismatch', pendingFrames:
        PUBLIC_V45_MAX_RIDE_BATCH + 1 })
    expect(first.runtime.preview().state).toEqual(preview)
    expect(first.runtime.advanceFrame(turn(0.04), false).rejections).toHaveLength(1)

    const second = await queuedRider()
    for (let index = 0; index < 2 * PUBLIC_V45_MAX_RIDE_BATCH; index++)
      expect(second.runtime.advanceFrame(turn(index % 2 ? -0.04 : 0.04), false)
        .rejections).toEqual([])
    await Promise.resolve()
    const firstAckId = second.pending[0]!.input.batchId
    await second.settle(0)
    await second.settle(1, (ack) => ({ ...ack, batchId: firstAckId }))
    expect(second.runtime.status()).toMatchObject({ gate: 'blocked',
      blockedReason: 'ride-ack-mismatch', pendingFrames: PUBLIC_V45_MAX_RIDE_BATCH })
  }, 30_000)

  it('freezes on worker fatal without discarding unacknowledged frames', async () => {
    const { runtime, fail } = await queuedRider()
    for (let index = 0; index < PUBLIC_V45_MAX_RIDE_BATCH + 1; index++)
      expect(runtime.advanceFrame(turn(index % 2 ? -0.04 : 0.04), false)
        .rejections).toEqual([])
    fail('worker-crashed')
    expect(runtime.status()).toMatchObject({ gate: 'blocked',
      blockedReason: 'worker-crashed', pendingFrames: PUBLIC_V45_MAX_RIDE_BATCH + 1 })
    expect(await runtime.save()).toMatchObject({ status: 'blocked',
      reason: 'worker-crashed' })
    runtime.dispose()
  }, 30_000)

  it('does not retry an uncertain Worker write', async () => {
    const { runtime, pending } = await queuedRider()
    for (let index = 0; index < PUBLIC_V45_MAX_RIDE_BATCH; index++)
      expect(runtime.advanceFrame(turn(index % 2 ? -0.04 : 0.04), false)
        .rejections).toEqual([])
    await Promise.resolve()
    pending[0]!.resolve({ status: 'blocked', reason: 'storage-error',
      durability: 'unknown' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runtime.status()).toMatchObject({ gate: 'blocked',
      blockedReason: 'storage-error', pendingFrames: PUBLIC_V45_MAX_RIDE_BATCH })
    expect(pending).toHaveLength(1)
    expect(await runtime.save()).toMatchObject({ status: 'blocked',
      reason: 'storage-error' })
  }, 30_000)
})
