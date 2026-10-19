import { describe, expect, it } from 'vitest'
import { PUBLIC_RUN_STEP_METERS } from './publicWorldGait'
import { publicV15StarterSupportAt } from './publicWorldV15StarterMovement'
import { resolvePublicV16GreenwaySite } from './publicWorldV16GreenwaySites'
import type { PublicV16GreenwaySite } from './publicWorldV16GreenwaySites'
import { publicV16StarterAdvanceMove, publicV16StarterPoseValid,
  publicV16StarterSupportAt } from './publicWorldV16StarterMovement'
import type { PublicV16StarterMovementContext } from './publicWorldV16StarterMovement'
import { STARTER_CLIFF_PROFILE, starterCliffCanonicalSite } from './starterCliffProfile'
import { starterCliffGroundYAt } from './starterCliffWorld'
import type { Vec3 } from './types'

const seed = 'wizard-realms'
type Bridge = Extract<PublicV16GreenwaySite, { kind: 'bridge' }>
type Ladder = Extract<PublicV16GreenwaySite, { kind: 'ladder' }>
type Dig = Extract<PublicV16GreenwaySite, { kind: 'dig' }>
const site = <T extends PublicV16GreenwaySite>(id: string) =>
  resolvePublicV16GreenwaySite(seed, id) as T | null

function world(bridges: string[] = [], ladders: string[] = [], digs: string[] = [],
  authoredLadder = false): PublicV16StarterMovementContext {
  const center = starterCliffCanonicalSite(seed)
  return { seed, profile: STARTER_CLIFF_PROFILE, built: authoredLadder,
    route: { id: 'greenway_ladder', name: 'Greenway ladder', fromAreaId: 'greenway',
      toAreaId: 'northern_ridge', siteId: center.id, from: center.from, to: center.to },
    greenwayWorks: { builtBridgeIds: bridges, builtLadderIds: ladders, dugTileIds: digs } }
}
const at = (context: PublicV16StarterMovementContext, x: number, z: number): Vec3 => ({
  x, z, y: publicV16StarterSupportAt(context, { x, z })!.floorY,
})
const move = (context: PublicV16StarterMovementContext, from: Vec3, x: number, z: number) =>
  publicV16StarterAdvanceMove(context, from, { x, z }, 0)

describe('v16 Greenway physical support', () => {
  it('blocks water before construction and crosses only a built shifted lane', () => {
    const available = [-2, -1, 0, 1, 2].map((gx) =>
      site<Bridge>(`works3:bridge:${gx}`)).filter((value): value is Bridge => !!value)
    const shifted = available.find((value) => Math.abs(value.from.x
      - Number(value.id.split(':')[2]) * 4) > 1e-6)
    expect(shifted).toBeDefined()
    const bridge = shifted!
    const empty = world()
    const built = world([bridge.id])
    expect(publicV16StarterSupportAt(empty, { x: bridge.from.x, z: 8 })).toBeNull()
    expect(move(empty, at(empty, bridge.from.x, 5.9), bridge.from.x, 6.1))
      .toMatchObject({ accepted: false, reason: 'creek_blocked' })
    let pose = at(built, bridge.from.x, 3.8)
    for (let step = 0; step < 43; step++) {
      const z = Number((4 + step * 0.2).toFixed(2))
      const next = move(built, pose, bridge.from.x, z)
      expect(next.accepted, `bridge progress z=${z}`).toBe(true)
      if (!next.accepted) return
      pose = next.position
      expect(publicV16StarterPoseValid(built, pose, 0)).toBe(true)
    }
    expect(pose.z).toBe(12.4)
    expect(publicV16StarterSupportAt(built, { x: bridge.from.x + 0.9, z: 8 })).toBeNull()
    expect(publicV16StarterSupportAt(built, { x: bridge.from.x + 4, z: 8 })).toBeNull()
    expect(move(built, at(built, bridge.from.x + 0.85, 5.9),
      bridge.from.x + 0.75, 6.1))
      .toMatchObject({ accepted: false, reason: 'off_bridge' })
  })

  it('climbs and descends a built alternate ladder, but blocks its unbuilt face', () => {
    const ladder = [-3, -2, -1, 1, 2, 3].map((gx) =>
      site<Ladder>(`works3:ladder:${gx}`)).find((value): value is Ladder => !!value)!
    expect(ladder).toBeDefined()
    const x = ladder.supportPath[1].x
    const empty = world()
    const built = world([], [ladder.id])
    expect(move(empty, at(empty, x, -5.9), x, -6.1).accepted).toBe(false)
    let pose = at(built, x, -5.2)
    for (let step = 0; step < 6; step++) {
      const z = Number((-5.4 - step * 0.2).toFixed(2))
      const next = move(built, pose, x, z)
      expect(next.accepted, `ladder ascent z=${z}`).toBe(true)
      if (!next.accepted) return
      pose = next.position
      expect(publicV16StarterPoseValid(built, pose, 0)).toBe(true)
    }
    for (let step = 0; step < 6; step++) {
      const z = Number((-6.2 + step * 0.2).toFixed(2))
      const next = move(built, pose, x, z)
      expect(next.accepted, `ladder descent z=${z}`).toBe(true)
      if (!next.accepted) return
      pose = next.position
    }
    expect(move(built, at(built, x + 0.55, -5.8), x + 0.45, -5.9))
      .toMatchObject({ accepted: false, reason: 'off_ladder' })
    expect(move(built, at(built, x + 0.56, -5.9), x + 0.46, -6.1))
      .toMatchObject({ accepted: false, reason: 'off_ladder' })
  })

  it('lowers a dry dig cell, validates the new pose, and permits a neighboring step', () => {
    const dig = site<Dig>('works3:dig:1:3')!
    expect(dig).toBeDefined()
    const before = world()
    const after = world([], [], [dig.id])
    const oldPose = at(before, dig.center.x, dig.center.z)
    const lowered = at(after, dig.center.x, dig.center.z)
    expect(lowered.y).toBeCloseTo(oldPose.y - 0.24)
    expect(publicV16StarterPoseValid(after, oldPose, 0)).toBe(false)
    expect(publicV16StarterPoseValid(after, lowered, 0)).toBe(true)
    const dx = Math.sign(dig.center.x - dig.adjacentStance.x)
    const dz = Math.sign(dig.center.z - dig.adjacentStance.z)
    const outside = at(after, dig.center.x - dx * 2.1, dig.center.z - dz * 2.1)
    const inside = { x: dig.center.x - dx * 1.9, z: dig.center.z - dz * 1.9 }
    expect(move(after, outside, inside.x, inside.z).accepted).toBe(true)
  })

  it('rejects swept diagonal water cuts, excessive steps and forged ledgers', () => {
    const bridge = site<Bridge>('works3:bridge:0')!
    const built = world([bridge.id])
    const off = at(built, bridge.from.x + 0.85, 5.9)
    expect(move(built, off, bridge.from.x + 0.75, 6.1))
      .toMatchObject({ accepted: false, reason: 'off_bridge' })
    expect(move(built, at(built, bridge.from.x, 5.7),
      bridge.from.x, 5.7 + PUBLIC_RUN_STEP_METERS + 0.01))
      .toMatchObject({ accepted: false, reason: 'invalid_move' })
    for (const invalid of [world(['works3:bridge:099']), world([bridge.id, bridge.id]),
      world(['works3:dig:1:3']), world(['works3:bridge:2', bridge.id])]) {
      expect(publicV16StarterSupportAt(invalid, { x: 0, z: 0 })).toBeNull()
      expect(publicV16StarterPoseValid(invalid, { x: 0, y: 0, z: 0 }, 0)).toBe(false)
      expect(move(invalid, { x: 0, y: 0, z: 0 }, 0.1, 0))
        .toMatchObject({ accepted: false, reason: 'invalid_pose' })
    }
  })

  it('keeps the migrated center bridge and authored route independently traversable', () => {
    const context = world(['works3:bridge:0'], [], ['works3:dig:1:3'], true)
    expect(move(context, at(context, 0, 5.9), 0, 6.1).accepted).toBe(true)
    expect(move(context, at(context, 0, -5.9), 0, -6.1).accepted).toBe(true)
    expect(publicV16StarterSupportAt(context, { x: 0, z: -5.7 })?.kind).toBe('ladder')
  })

  it('preserves migrated v15 floor heights at bank, dig and cliff cell boundaries', () => {
    const migrated = world(['works3:bridge:0'], [], ['works3:dig:1:3'], true)
    const legacy = { ...migrated, starterWorks: { bridgeBuilt: true, bankCacheDug: true } }
    const points = [
      ...[1.9999, 2, 2.0001, 5.9999, 6, 6.0001].map((x) => ({ x, z: 12 })),
      ...[9.9999, 10, 10.0001, 13.9999, 14, 14.0001].map((z) => ({ x: 4, z })),
      ...[3.9999, 4, 4.0001, 5.9999, 6, 6.0001, 9.9999, 10,
        10.0001, 11.9999, 12, 12.0001].map((z) => ({ x: 0, z })),
      ...[-6.0001, -6, -5.9999, -5.35, -5.3499].map((z) => ({ x: 0, z })),
    ]
    for (const point of points) {
      const oldSupport = publicV15StarterSupportAt(legacy, point)
      const newSupport = publicV16StarterSupportAt(migrated, point)
      expect(newSupport?.kind, `support kind at ${JSON.stringify(point)}`)
        .toBe(oldSupport?.kind)
      expect(newSupport?.floorY, `floor at ${JSON.stringify(point)}`)
        .toBe(oldSupport?.floorY)
      if (oldSupport) expect(publicV16StarterPoseValid(migrated,
        { ...point, y: oldSupport.floorY }, 0)).toBe(true)
    }
  })

  it('joins shifted site support to the same source cell heights', () => {
    const bridge = [-2, -1, 1, 2].map((gx) => site<Bridge>(`works3:bridge:${gx}`))
      .find((value): value is Bridge => !!value && value.from.x !== Number(value.id.split(':')[2]) * 4)!
    const ladder = [-3, -2, -1, 1, 2, 3].map((gx) =>
      site<Ladder>(`works3:ladder:${gx}`)).find((value): value is Ladder => !!value)!
    expect(bridge).toBeDefined()
    expect(ladder).toBeDefined()
    const built = world([bridge.id], [ladder.id])
    for (const edge of [bridge.from, bridge.to]) {
      expect(publicV16StarterSupportAt(built, edge)?.floorY)
        .toBe(starterCliffGroundYAt(seed, edge.x, edge.z))
    }
    const [faceFrom, faceTo] = [ladder.supportPath[1], ladder.supportPath[2]]
    expect(publicV16StarterSupportAt(built, faceFrom)?.floorY)
      .toBe(starterCliffGroundYAt(seed, faceFrom.x, faceFrom.z + 0.0001))
    expect(publicV16StarterSupportAt(built, faceTo)?.floorY)
      .toBe(starterCliffGroundYAt(seed, faceTo.x, faceTo.z - 0.0001))
  })
})
