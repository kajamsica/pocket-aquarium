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
  confirmPublicV44GroundMountAction, decodePublicV44GroundMountProgress,
  decodePublicV44GroundMountSuccessor,
  decodePublicV44GroundMountWitness } from './publicWorldV44GroundMount'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'
import { waystationRiverSite } from './waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

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
function matureRoot(playerOffset = 0, animalOffset = 0): PublicV43Root {
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
