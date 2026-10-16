import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createPublicV42ControllerRuntime } from './PublicV42ControllerRuntime'
import { createAtomicV42Store } from './domain/atomicV42Database'
import { projectPublicV31Pose } from './domain/publicWorldV31Support'
import { commitPublicV42 } from './domain/publicWorldV42Flow'
import type { PublicV42SavePhase } from './domain/publicWorldV42Flow'
import { createFreshPublicV41Root } from './domain/publicWorldV41Snapshot'
import { createPublicV42Root, replayPublicV42Witness } from './domain/publicWorldV42Snapshot'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { decodePublicV42RewardProgress } from './domain/publicWorldV42RewardAction'
import { STARTER_CLIFF_SITE_ID } from './domain/starterCliffProfile'

const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>) => body() }

function starterAt(point: { x: number; z: number }, yaw = 0, built = true) {
  const root = createPublicV42Root(createFreshPublicV41Root('wizard-realms'))
  const greenway = { ...root.head.state.greenway,
    builtRouteIds: built ? ['greenway_ladder' as const] : root.head.state.greenway.builtRouteIds,
    routes: root.head.state.greenway.routes.map((route) => built && route.id === 'greenway_ladder'
      ? { ...route, siteId: STARTER_CLIFF_SITE_ID } : route) }
  const support = publicV17StarterSupportAt({ seed: root.head.state.seed,
    profile: root.head.state.generationProfile,
    route: greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built, greenwayWorks: root.head.greenwayWorks }, point)
  if (!support) throw Error('Missing starter support')
  const start = { ...root, head: { ...root.head, state: { ...root.head.state, greenway,
    player: { ...root.head.state.player, yaw,
      position: { ...point, y: support.floorY }, xp: root.head.state.player.xp + (built ? 60 : 0),
      skillXp: { ...root.head.state.player.skillXp,
        construction: root.head.state.player.skillXp.construction + (built ? 60 : 0) } } } } }
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...before } = start.head
  if (!decodePublicV42RewardProgress(before)) throw Error('Invalid starter fixture')
  return { start, before }
}

describe('V42 copied movement frames', () => {
  it('keeps ordinary incremental preview equal to full checked replay', () => {
    const root = createPublicV42Root(createFreshPublicV41Root('wizard-realms'))
    const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
      ...before } = root.head
    const runtime = createPublicV42ControllerRuntime({ head: root.head,
      lineage: root.lineage }, async () => ({ ok: false, reason: 'not-called' }))
    const frame = { intents: [{ type: 'move' as const, delta: { x: 0, z: 0.16 } }],
      walkRequested: false }
    for (let tick = 0; tick < 32; tick++) {
      expect(runtime.advanceFrame(frame.intents, frame.walkRequested).rejections).toEqual([])
    }
    expect(runtime.status().pendingFrames).toBe(32)
    expect(replayPublicV42Witness(before, { kind: 'frame-batch/v1',
      frames: Array.from({ length: 32 }, () => frame) })).toEqual(runtime.preview())
  })
  it('previews the west-return dry descent until a landed batch can be checked', async () => {
    const root = createPublicV42Root(createFreshPublicV41Root('wizard-realms'))
    const point = { x: -31.051937972725487, z: -6.017874871957181 }
    const floor = resolvePublicV23Surface(root.head.state, point, [])
    const landing = resolvePublicV23Surface(root.head.state,
      { x: point.x, z: point.z + 0.16 }, [])
    expect(floor?.floorY).toBeCloseTo(1.6089652476925116)
    expect(landing?.floorY).toBeCloseTo(1.3816894797750405)
    const head = { ...root.head, state: { ...root.head.state, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(root.head.state.discoveryMask),
        floor!.tileId, landing!.tileId])].sort()),
      player: { ...root.head.state.player, position: { ...point, y: floor!.floorY } } } }
    const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
      ...before } = head
    expect(decodePublicV42RewardProgress(before)).not.toBeNull()
    let writes = 0
    const runtime = createPublicV42ControllerRuntime({ ...root, head },
      async () => { writes++; return { ok: false, reason: 'diagnostic-writer' } })
    const move = { intents: [{ type: 'move' as const, delta: { x: 0, z: 0.16 } }],
      walkRequested: false }
    const idle = { intents: [], walkRequested: false }
    expect(runtime.advanceFrame(move.intents, false).rejections).toEqual([])
    expect(runtime.preview().state.player.verticalVelocity).toBeLessThan(0)
    expect(await runtime.save()).toMatchObject({ status: 'deferred-airborne' })
    expect(writes).toBe(0)
    for (let frame = 0; frame < 4; frame++)
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(runtime.preview().state.player.verticalVelocity).toBe(0)
    expect(runtime.preview().state.player.position.y).toBeCloseTo(landing!.floorY)
    const witness = { kind: 'frame-batch/v1', frames: [move, idle, idle, idle, idle] }
    expect(replayPublicV42Witness(before, witness)).toEqual(runtime.preview())
    expect(await runtime.save()).toMatchObject({ status: 'blocked', reason: 'diagnostic-writer' })
    expect(writes).toBe(1)
  })
  it('explains an off-axis blocked climb without changing the requested move', () => {
    const yaw = -0.13, { start, before } = starterAt({ x: 1.2, z: -5.9 }, yaw)
    const runtime = createPublicV42ControllerRuntime(start,
      async () => ({ ok: false, reason: 'not-called' }))
    const frame = { kind: 'frame-batch/v1' as const,
      frames: [{ intents: [{ type: 'move' as const, delta: {
        x: -Math.sin(yaw) * 0.16, z: -Math.cos(yaw) * 0.16 } }],
      walkRequested: false }] }
    expect(replayPublicV42Witness(before, frame)).toBeNull()
    expect(runtime.advanceFrame(frame.frames[0].intents, false).rejections)
      .toEqual([expect.objectContaining({ code: 'terrain_missing',
        message: expect.stringContaining('center of its lower foot') })])
    expect(runtime.preview()).toEqual(before)
    expect(runtime.status().pendingFrames).toBe(0)
  })
  it('explains off-axis descent only when the centered ladder is built', () => {
    const move = [{ type: 'move' as const, delta: { x: 0, z: 0.16 } }]
    const { start, before } = starterAt({ x: 1.2, z: -6.1 })
    const runtime = createPublicV42ControllerRuntime(start,
      async () => ({ ok: false, reason: 'not-called' }))
    expect(runtime.advanceFrame(move, false).rejections)
      .toEqual([expect.objectContaining({ message:
        expect.stringContaining('center of its upper foot') })])
    expect(runtime.preview()).toEqual(before)
    const unbuilt = starterAt({ x: 1.2, z: -6.1 }, 0, false)
    const blocked = createPublicV42ControllerRuntime(unbuilt.start,
      async () => ({ ok: false, reason: 'not-called' }))
    expect(blocked.advanceFrame(move, false).rejections)
      .toEqual([expect.objectContaining({ message: 'This move cannot be replayed safely.' })])
  })
  it('keeps centered starter-ladder climb and descent replayable', () => {
    const { start, before } = starterAt({ x: 0, z: -5.2 })
    const runtime = createPublicV42ControllerRuntime(start,
      async () => ({ ok: false, reason: 'not-called' }))
    const frames = [...Array.from({ length: 8 }, () => ({ intents: [{ type: 'move' as const,
      delta: { x: 0, z: -0.16 } }], walkRequested: false })),
    ...Array.from({ length: 8 }, () => ({ intents: [{ type: 'move' as const,
      delta: { x: 0, z: 0.16 } }], walkRequested: false }))]
    for (const frame of frames)
      expect(runtime.advanceFrame(frame.intents, frame.walkRequested).rejections).toEqual([])
    expect(runtime.preview().state.player.position.z).toBeCloseTo(-5.2)
    expect(replayPublicV42Witness(before, { kind: 'frame-batch/v1', frames }))
      .toEqual(runtime.preview())
  })
  it('previews the airborne frames and saves the landed batch through V42', async () => {
    const source = createFreshPublicV41Root('wizard-realms')
    const root = createPublicV42Root(source)
    const store = createAtomicV42Store(new IDBFactory())
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V42 target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const runtime = createPublicV42ControllerRuntime({ head: root.head,
      lineage: root.lineage }, (revision, lineage, witness) =>
      commitPublicV42(locks, store, revision, lineage, witness))

    expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    expect(runtime.preview().state.player.verticalVelocity).toBeGreaterThan(0)
    expect(await runtime.save()).toMatchObject({ status: 'deferred-airborne' })
    for (let frame = 0; frame < 40; frame++) {
      const current = runtime.preview(), pose = projectPublicV31Pose(current)
      if (current.state.player.verticalVelocity === 0 && pose
        && Math.abs(pose.effective.position.y - pose.effective.floorY) < 1e-6) break
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    }
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(await store.readChecked()).toMatchObject({ status: 'valid', root: {
      head: { witness: { kind: 'frame-batch/v1' } } } })
  })

  it('traces opt-in V42 checkpoint phases without changing its checked write', async () => {
    const root = createPublicV42Root(createFreshPublicV41Root('wizard-realms'))
    const store = createAtomicV42Store(new IDBFactory())
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V42 target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const phases: PublicV42SavePhase[] = []
    const trace = (sample: PublicV42SavePhase) => { phases.push(sample) }
    const runtime = createPublicV42ControllerRuntime({ head: root.head,
      lineage: root.lineage }, (revision, lineage, witness) =>
      commitPublicV42(locks, store, revision, lineage, witness, trace), undefined, trace)
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(phases.map(({ phase }) => phase)).toEqual([
      'grounded-check', 'witness-decode', 'local-frame-replay', 'local-frame-compare',
      'lock-wait', 'store-read', 'writer-preflight', 'writer-replay', 'candidate-clone', 'store-commit',
      'writer-await', 'reply-check-clone'])
    expect(phases.every(({ durationMs }) => Number.isFinite(durationMs)
      && durationMs >= 0)).toBe(true)
    expect(await store.readChecked()).toMatchObject({ status: 'valid', root: {
      head: { saveRevision: 1, witness: { kind: 'frame-batch/v1' } } } })

    const throwing = createPublicV42ControllerRuntime(runtime.committed(),
      (revision, lineage, witness) => commitPublicV42(locks, store, revision, lineage,
        witness, () => { throw Error('diagnostic failure') }), undefined,
      () => { throw Error('diagnostic failure') })
    expect(throwing.advanceFrame([], false).rejections).toEqual([])
    expect(await throwing.save()).toMatchObject({ status: 'saved' })
    expect(await store.readChecked()).toMatchObject({ status: 'valid', root: {
      head: { saveRevision: 2 } } })
  })
})
