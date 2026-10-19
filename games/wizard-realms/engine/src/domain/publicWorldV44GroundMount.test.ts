import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { createFreshPublicV42Root, decodePublicV42Root, PUBLIC_V42_SCHEMA }
  from './publicWorldV42Snapshot'
import type { PublicV42Root } from './publicWorldV42Snapshot'
import { createPublicV43Root, decodePublicV43CheckedSuccessor,
  decodePublicV43Root, replayPublicV43Witness, PUBLIC_V43_SCHEMA }
  from './publicWorldV43Snapshot'
import type { PublicV43Root, PublicV43Witness } from './publicWorldV43Snapshot'
import { createPublicV44GroundMountProgress,
  checkPublicV44RidePreviewStep, confirmPublicV44GroundMountAction,
  decodePublicV44GroundMountProgress,
  decodePublicV44GroundMountSuccessor,
  decodePublicV44GroundMountWitness, PUBLIC_V44_MAX_RIDE_BATCH }
  from './publicWorldV44GroundMount'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'
import { waystationRiverSite } from './waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

const seed = 'wizard-realms'
const idle = { kind: 'frame-batch/v1' as const,
  frames: [{ intents: [], walkRequested: true }] }

function eligibleSource(): PublicV42Root {
  const fresh = createFreshPublicV42Root(seed)
  const site = resolveSedgehornFamiliarSite(fresh.head)!
  const bridge = waystationRiverSite(seed)!
  const nearby: string[] = []
  for (const tile of [site.tracks, site.shelter, site.dryApproach, site.keeper]) {
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
        ...bridge.footprintTileIds, ...nearby,
      ])].sort()), player: { ...fresh.head.state.player,
        position: { ...site.keeper.center }, verticalVelocity: 0 } } }
  const source: PublicV42Root = { lineage: { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed, sourceRevision: 4, genesis },
    previous: null, head: { ...structuredClone(genesis),
      schemaVersion: PUBLIC_V42_SCHEMA, saveRevision: 0, witness: null } }
  expect(decodePublicV42Root(source)).not.toBeNull()
  return source
}

function next(root: PublicV43Root, witness: PublicV43Witness): PublicV43Root {
  const progress = replayPublicV43Witness(root.head, witness)
  expect(progress).not.toBeNull()
  const raw: PublicV43Root = { lineage: root.lineage, previous: root.head,
    head: { ...progress!, schemaVersion: PUBLIC_V43_SCHEMA,
      saveRevision: root.head.saveRevision + 1, witness } }
  const checked = decodePublicV43CheckedSuccessor(root, raw)
  expect(checked).not.toBeNull()
  return checked!
}

/** V43 accepts coherent older offline-history rewrites. Its own care suite
 * separately proves the full earned route and three spaced checked writes. */
function matureRoot(playerOffset = 0, animalOffset = 0,
  boots = false): PublicV43Root {
  let root = createPublicV43Root(eligibleSource())
  for (let i = 0; i < 3; i++) root = next(root, idle)
  const site = resolveSedgehornFamiliarSite(root.head)!
  const careWitnesses = [0, 600, 1200].map((tick, index) => ({
    kind: 'sedgehorn-care/v1' as const, tick, eventSequence: index + 1 }))
  const fabricated = (head: PublicV43Root['head']) => ({ ...head,
    familiar: { ...head.familiar, phase: 'claimed' as const,
      routeChoice: 'shelter' as const, position: { ...site.keeper.center,
        x: site.keeper.center.x + animalOffset },
      trust: 2, creatureCareXp: 40, stationKnown: true },
    mountTraining: { careWitnesses },
    state: { ...head.state, player: { ...head.state.player,
      position: { ...site.keeper.center,
        x: site.keeper.center.x - playerOffset },
      inventory: boots ? [...head.state.player.inventory,
        { itemId: 'leather_boots' as const, quantity: 1 }]
        : head.state.player.inventory,
      equipment: boots ? { ...head.state.player.equipment,
        feet: 'leather_boots' as const } : head.state.player.equipment,
      coins: head.state.player.coins + 25, xp: head.state.player.xp + 40,
      level: 1 + Math.floor((head.state.player.xp + 40) / 100) } } })
  const checked = decodePublicV43Root({ ...root,
    previous: fabricated(root.previous!), head: fabricated(root.head) })
  expect(checked).not.toBeNull()
  return checked!
}

describe('V44 ground Sedgehorn domain seam', () => {
  it('requires a checked mature claim and rejects forged ride state', () => {
    const fresh = createPublicV44GroundMountProgress(createPublicV43Root(eligibleSource()))!
    expect(confirmPublicV44GroundMountAction(fresh,
      { kind: 'sedgehorn-mount/v1' })).toEqual({ rejection: 'not_mature' })
    expect(decodePublicV44GroundMountProgress({ ...fresh,
      groundMount: { mode: 'riding', parkedPosition: null } })).toBeNull()
    expect(decodePublicV44GroundMountWitness({ kind: 'sedgehorn-mount/v1',
      position: { x: 0, y: 0, z: 0 } })).toBeNull()
    expect(decodePublicV44GroundMountWitness({ kind: 'sedgehorn-ride-frame/v1',
      intents: [{ type: 'jump' }] })).toBeNull()
    expect(confirmPublicV44GroundMountAction(fresh,
      { kind: 'return-home/v1', atMs: Number.MAX_SAFE_INTEGER }))
      .toEqual({ rejection: 'invalid_witness' })
  })

  it('mounts, replays a checked ordinary ground step, parks, and cannot remount remotely', () => {
    const base = createPublicV44GroundMountProgress(matureRoot())!
    const mounted = confirmPublicV44GroundMountAction(base,
      { kind: 'sedgehorn-mount/v1' }).progress
    expect(mounted?.groundMount.mode).toBe('riding')
    expect(decodePublicV44GroundMountSuccessor(base,
      { kind: 'sedgehorn-mount/v1' }, mounted)).not.toBeNull()
    expect(confirmPublicV44GroundMountAction(mounted!,
      { kind: 'sedgehorn-mount/v1' })).toEqual({ rejection: 'already_riding' })
    const ride = { kind: 'sedgehorn-ride-frame/v1',
      intents: [{ type: 'move', delta: { x: 0.1, z: 0 } }] } as const
    const advanced = confirmPublicV44GroundMountAction(mounted!, ride).progress
    expect(advanced?.v43.head.saveRevision).toBe(mounted!.v43.head.saveRevision + 1)
    expect(advanced?.v43.head.state.player.position.x).toBeCloseTo(
      mounted!.v43.head.state.player.position.x + 0.1)
    expect(decodePublicV44GroundMountSuccessor(mounted!, ride,
      advanced)).not.toBeNull()
    expect(decodePublicV44GroundMountSuccessor(mounted!, ride,
      { ...advanced, groundMount: { mode: 'parked', parkedPosition: null } }))
      .toBeNull()
    const parked = confirmPublicV44GroundMountAction(advanced!,
      { kind: 'sedgehorn-dismount/v1' }).progress
    expect(parked?.groundMount).toEqual({ mode: 'parked',
      parkedPosition: advanced!.v43.head.state.player.position })
    expect(decodePublicV44GroundMountSuccessor(advanced!,
      { kind: 'sedgehorn-dismount/v1' }, parked)).not.toBeNull()
    expect(confirmPublicV44GroundMountAction(parked!,
      { kind: 'sedgehorn-dismount/v1' })).toEqual({ rejection: 'not_riding' })
  })

  it('replays a bounded ride batch through every checked intermediate step', () => {
    const mounted = confirmPublicV44GroundMountAction(
      createPublicV44GroundMountProgress(matureRoot())!,
      { kind: 'sedgehorn-mount/v1' }).progress!
    const frame = { kind: 'sedgehorn-ride-frame/v1',
      intents: [{ type: 'move', delta: { x: 0.05, z: 0 } }] } as const
    const batch = { kind: 'sedgehorn-ride-batch/v1',
      frames: [frame, frame, frame] } as const
    const advanced = confirmPublicV44GroundMountAction(mounted, batch).progress
    expect(advanced?.v43.head.saveRevision).toBe(mounted.v43.head.saveRevision + 3)
    expect(advanced?.v43.head.state.tick).toBe(mounted.v43.head.state.tick + 3)
    expect(advanced?.v43.head.state.player.position.x).toBeCloseTo(
      mounted.v43.head.state.player.position.x + 0.15)
    expect(decodePublicV44GroundMountSuccessor(mounted, batch, advanced))
      .not.toBeNull()
    expect(decodePublicV44GroundMountSuccessor(mounted, batch,
      { ...advanced, v43: mounted.v43 })).toBeNull()
  })

  it('reuses only a detached, byte-equivalent checked ride batch', () => {
    const mounted = confirmPublicV44GroundMountAction(
      createPublicV44GroundMountProgress(matureRoot())!,
      { kind: 'sedgehorn-mount/v1' }).progress!
    const frame = { kind: 'sedgehorn-ride-frame/v1' as const,
      intents: [{ type: 'move' as const, delta: { x: 0.05, z: 0 } }] }
    const batch = { kind: 'sedgehorn-ride-batch/v1' as const,
      frames: [frame, structuredClone(frame)] }
    const advanced = confirmPublicV44GroundMountAction(mounted, batch).progress!
    expect(sameStrictBoundedRaw(mounted, structuredClone(mounted), 3 << 20)).toBe(true)
    expect(sameStrictBoundedRaw(advanced, structuredClone(advanced), 3 << 20)).toBe(true)

    const first = decodePublicV44GroundMountSuccessor(mounted, batch, advanced)
    expect(first).toEqual(advanced)
    const hit = decodePublicV44GroundMountSuccessor(structuredClone(mounted),
      structuredClone(batch), structuredClone(advanced))
    expect(hit).toEqual(advanced)
    expect(hit).not.toBe(first)
    ;(hit as { v43: { head: { state: { player: {
      position: { x: number } } } } } }).v43.head.state.player.position.x = 999
    expect(decodePublicV44GroundMountSuccessor(mounted, batch, advanced))
      .toEqual(advanced)

    const changedBefore = structuredClone(mounted)
    changedBefore.v43.head.state.player.position.x += 0.01
    expect(decodePublicV44GroundMountSuccessor(changedBefore, batch, advanced))
      .toBeNull()
    const changedAfter = structuredClone(advanced)
    changedAfter.v43.head.state.player.position.x += 0.01
    expect(decodePublicV44GroundMountSuccessor(mounted, batch, changedAfter))
      .toBeNull()
    const changedWitness = structuredClone(batch)
    changedWitness.frames[0].intents[0].delta.x = 0.04
    expect(decodePublicV44GroundMountSuccessor(mounted, changedWitness, advanced))
      .toBeNull()
    const changedLineage = structuredClone(mounted)
    Object.assign(changedLineage.v43.lineage, { seed: 'different-seed' })
    expect(decodePublicV44GroundMountSuccessor(changedLineage, batch, advanced))
      .toBeNull()
    expect(decodePublicV44GroundMountSuccessor(mounted, batch,
      { ...advanced, malformed: true })).toBeNull()
    expect(decodePublicV44GroundMountSuccessor(mounted, batch,
      { ...advanced, oversized: 'x'.repeat((3 << 20) + 1) })).toBeNull()

    const next = confirmPublicV44GroundMountAction(advanced, batch).progress!
    expect(decodePublicV44GroundMountSuccessor(advanced, batch, next))
      .toEqual(next)
    expect(next.v43.head.saveRevision).toBe(advanced.v43.head.saveRevision + 2)
    expect(decodePublicV44GroundMountSuccessor(mounted, batch, advanced))
      .toEqual(advanced)
  }, 60_000)

  it('matches checked single-frame replay at one and 32 idle frames', () => {
    const mounted = confirmPublicV44GroundMountAction(
      createPublicV44GroundMountProgress(matureRoot())!,
      { kind: 'sedgehorn-mount/v1' }).progress!
    const frame = { kind: 'sedgehorn-ride-frame/v1', intents: [] } as const
    for (const count of [1, PUBLIC_V44_MAX_RIDE_BATCH]) {
      const frames = Array(count).fill(frame)
      const batch = { kind: 'sedgehorn-ride-batch/v1', frames } as const
      let sequential = mounted
      for (const step of frames)
        sequential = confirmPublicV44GroundMountAction(sequential, step).progress!
      const batched = confirmPublicV44GroundMountAction(mounted, batch).progress
      expect(batched).toEqual(sequential)
      expect(decodePublicV44GroundMountSuccessor(mounted, batch, batched))
        .not.toBeNull()
    }
  }, 60_000)

  it('rejects malformed or blocked ride batches without partial progress', () => {
    const mounted = confirmPublicV44GroundMountAction(
      createPublicV44GroundMountProgress(matureRoot())!,
      { kind: 'sedgehorn-mount/v1' }).progress!
    const before = JSON.stringify(mounted)
    const frame = { kind: 'sedgehorn-ride-frame/v1',
      intents: [{ type: 'move', delta: { x: 0.05, z: 0 } }] } as const
    const invalid = [
      { kind: 'sedgehorn-ride-batch/v1', frames: [] },
      { kind: 'sedgehorn-ride-batch/v1',
        frames: Array(PUBLIC_V44_MAX_RIDE_BATCH + 1).fill(frame) },
      { kind: 'sedgehorn-ride-batch/v1', frames: [frame, { kind: 'sedgehorn-mount/v1' }] },
      { kind: 'sedgehorn-ride-batch/v1', frames: [frame,
        { kind: 'sedgehorn-ride-frame/v1', intents: [{ type: 'jump' }] }] },
      { kind: 'sedgehorn-ride-batch/v1', frames: [frame], position: { x: 0, y: 0, z: 0 } },
      { kind: 'sedgehorn-ride-batch/v1', frames: new Array(2) },
    ]
    for (const witness of invalid) {
      expect(decodePublicV44GroundMountWitness(witness)).toBeNull()
      expect(confirmPublicV44GroundMountAction(mounted, witness))
        .toEqual({ rejection: 'invalid_witness' })
    }
    expect(confirmPublicV44GroundMountAction(mounted,
      { kind: 'sedgehorn-ride-batch/v1', frames: [frame,
        { kind: 'sedgehorn-ride-frame/v1', intents: [{ type: 'move',
          delta: { x: 0.24, z: 0 } }] }] }))
      .toEqual({ rejection: 'ride_blocked' })
    expect(confirmPublicV44GroundMountAction(mounted,
      { kind: 'sedgehorn-ride-batch/v1', frames: [
        ...Array(16).fill({ kind: 'sedgehorn-ride-frame/v1', intents: [] }),
        { kind: 'sedgehorn-ride-frame/v1', intents: [{ type: 'move',
          delta: { x: 0.24, z: 0 } }] }, frame] }))
      .toEqual({ rejection: 'ride_blocked' })
    expect(JSON.stringify(mounted)).toBe(before)
  })

  it('keeps V1 walking replay while V2 and mixed batches use checked boots pace', () => {
    const mounted = confirmPublicV44GroundMountAction(
      createPublicV44GroundMountProgress(matureRoot(0, 0, true))!,
      { kind: 'sedgehorn-mount/v1' }).progress!
    const run = { kind: 'sedgehorn-ride-frame/v2',
      intents: [{ type: 'move', delta: { x: 0.24, z: 0 } }] } as const
    expect(confirmPublicV44GroundMountAction(mounted,
      { ...run, kind: 'sedgehorn-ride-frame/v1' }))
      .toEqual({ rejection: 'ride_blocked' })
    const advanced = confirmPublicV44GroundMountAction(mounted, run).progress
    expect(advanced?.v43.head.state.player.position.x).toBeCloseTo(
      mounted.v43.head.state.player.position.x + 0.24)
    expect(decodePublicV44GroundMountSuccessor(mounted, run, advanced))
      .not.toBeNull()
    const walk = { kind: 'sedgehorn-ride-frame/v1',
      intents: [{ type: 'move', delta: { x: 0.1, z: 0 } }] } as const
    const mixed = { kind: 'sedgehorn-ride-batch/v1', frames: [walk, run] } as const
    const batched = confirmPublicV44GroundMountAction(mounted, mixed).progress
    expect(batched?.v43.head.saveRevision).toBe(mounted.v43.head.saveRevision + 2)
    expect(batched?.v43.head.state.player.position.x).toBeCloseTo(
      mounted.v43.head.state.player.position.x + 0.34)
    expect(decodePublicV44GroundMountSuccessor(mounted, mixed, batched))
      .not.toBeNull()
    expect(confirmPublicV44GroundMountAction(mounted,
      { kind: 'sedgehorn-ride-frame/v2', intents: [{ type: 'move',
        delta: { x: 0.241, z: 0 } }] }))
      .toEqual({ rejection: 'invalid_witness' })
    expect(confirmPublicV44GroundMountAction(mounted,
      { kind: 'sedgehorn-ride-frame/v2', intents: [{ type: 'jump' }] }))
      .toEqual({ rejection: 'invalid_witness' })
    const barefoot = confirmPublicV44GroundMountAction(
      createPublicV44GroundMountProgress(matureRoot())!,
      { kind: 'sedgehorn-mount/v1' }).progress!
    expect(confirmPublicV44GroundMountAction(barefoot, run))
      .toEqual({ rejection: 'ride_blocked' })
    expect(confirmPublicV44GroundMountAction(barefoot,
      { kind: 'sedgehorn-ride-frame/v2', intents: [{ type: 'move',
        delta: { x: 0.16, z: 0 } }] }).progress?.v43.head.state.player.position.x)
      .toBeCloseTo(barefoot.v43.head.state.player.position.x + 0.16)
    expect(decodePublicV44GroundMountSuccessor(mounted, walk,
      confirmPublicV44GroundMountAction(mounted, walk).progress)).not.toBeNull()
  })

  it('admits V1 and V2 previews only when the checked ride step is safe', () => {
    for (const [boots, witness] of [
      [false, { kind: 'sedgehorn-ride-frame/v1',
        intents: [{ type: 'move', delta: { x: 0.1, z: 0 } }] }],
      [true, { kind: 'sedgehorn-ride-frame/v2',
        intents: [{ type: 'move', delta: { x: 0.24, z: 0 } }] }],
    ] as const) {
      const mounted = confirmPublicV44GroundMountAction(
        createPublicV44GroundMountProgress(matureRoot(0, 0, boots))!,
        { kind: 'sedgehorn-mount/v1' }).progress!
      const before = mounted.v43.head
      const after = confirmPublicV44GroundMountAction(mounted, witness).progress!.v43.head
      expect(checkPublicV44RidePreviewStep(before, after, witness)).toBeNull()
      expect(checkPublicV44RidePreviewStep(before, {
        ...after, state: { ...after.state, tick: after.state.tick + 1 },
      }, witness)).toBe('ride_blocked')
      expect(checkPublicV44RidePreviewStep(before, {
        ...after, state: { ...after.state, player: { ...after.state.player,
          position: { ...after.state.player.position,
            x: after.state.player.position.x + 0.01 } } },
      }, witness)).toBe('ride_blocked')
      expect(checkPublicV44RidePreviewStep(before, {
        ...after, state: { ...after.state, player: { ...after.state.player,
          verticalVelocity: 1 } },
      }, witness)).toBe('ride_blocked')
      expect(checkPublicV44RidePreviewStep(before, after,
        { ...witness, intents: [{ type: 'jump' }] })).toBe('invalid_witness')
      expect(checkPublicV44RidePreviewStep(before, after,
        { ...witness, position: { x: 0, y: 0, z: 0 } })).toBe('invalid_witness')
    }
  })

  it('uses the animal position, not the keeper marker, for initial mounting range', () => {
    const separated = createPublicV44GroundMountProgress(matureRoot(1.8, 1.8))!
    const site = resolveSedgehornFamiliarSite(separated.v43.head)!
    expect(Math.hypot(separated.v43.head.state.player.position.x
      - site.keeper.center.x, separated.v43.head.state.player.position.z
      - site.keeper.center.z)).toBeLessThan(3)
    expect(Math.hypot(separated.v43.head.familiar.position.x
      - site.keeper.center.x, separated.v43.head.familiar.position.z
      - site.keeper.center.z)).toBeLessThan(3)
    expect(confirmPublicV44GroundMountAction(separated,
      { kind: 'sedgehorn-mount/v1' })).toEqual({ rejection: 'too_far' })
  })

  it('never lets mounted input bypass the inherited movement or jump contract', () => {
    const mounted = confirmPublicV44GroundMountAction(
      createPublicV44GroundMountProgress(matureRoot())!,
      { kind: 'sedgehorn-mount/v1' }).progress!
    const before = JSON.stringify(mounted)
    expect(confirmPublicV44GroundMountAction(mounted,
      { kind: 'sedgehorn-ride-frame/v1', intents: [{ type: 'move',
        delta: { x: 0.24, z: 0 } }] })).toEqual({ rejection: 'ride_blocked' })
    expect(confirmPublicV44GroundMountAction(mounted,
      { kind: 'frame-batch/v1', frames: [{ intents: [{ type: 'move',
        delta: { x: 0.1, z: 0 } }], walkRequested: true }] }))
      .toEqual({ rejection: 'invalid_witness' })
    expect(confirmPublicV44GroundMountAction(mounted,
      { kind: 'sedgehorn-ride-frame/v1', intents: [{ type: 'jump' }] }))
      .toEqual({ rejection: 'invalid_witness' })
    expect(JSON.stringify(mounted)).toBe(before)
  })
})
