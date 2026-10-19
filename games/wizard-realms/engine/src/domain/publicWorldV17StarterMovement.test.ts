import { describe, expect, it } from 'vitest'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import type { PublicV16GreenwaySite } from './publicWorldV16GreenwaySites'
import { publicV16StarterAdvanceMove, publicV16StarterSupportAt } from './publicWorldV16StarterMovement'
import { publicV17StarterAdvanceMove, publicV17StarterPoseValid,
  publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import type { PublicV17StarterMovementContext } from './publicWorldV17StarterMovement'
import { STARTER_CLIFF_PROFILE, starterCliffCanonicalSite } from './starterCliffProfile'
import type { Vec3 } from './types'

const seed = 'wizard-realms'
type Bridge = Extract<PublicV16GreenwaySite, { kind: 'bridge' }>
type Ladder = Extract<PublicV16GreenwaySite, { kind: 'ladder' }>
function findSite(kind: 'bridge' | 'ladder'): Bridge | Ladder {
  const limit = kind === 'bridge' ? 91 : 294
  const obstacle = kind === 'bridge' ? 'greenway-creek' : 'greenway-north-cliff'
  for (let q = 1; q <= limit; q++) for (const signed of [q, -q]) {
    const site = resolvePublicV17GreenwaySite(seed, `works4:${kind}:${obstacle}:${signed}`)
    if (site?.kind === kind) return site as Bridge | Ladder
  }
  throw new Error(`No works4 ${kind} site resolved for the test seed.`)
}
function world(bridges: string[] = [], ladders: string[] = [], digs: string[] = []):
  PublicV17StarterMovementContext {
  const center = starterCliffCanonicalSite(seed)
  return { seed, profile: STARTER_CLIFF_PROFILE, built: false,
    route: { id: 'greenway_ladder', name: 'Greenway ladder', fromAreaId: 'greenway',
      toAreaId: 'northern_ridge', siteId: center.id, from: center.from, to: center.to },
    greenwayWorks: { builtBridgeIds: bridges, builtLadderIds: ladders, dugTileIds: digs } }
}
function at(context: PublicV17StarterMovementContext, x: number, z: number): Vec3 {
  return { x, z, y: publicV17StarterSupportAt(context, { x, z })!.floorY }
}
const move = (context: PublicV17StarterMovementContext, from: Vec3, x: number, z: number) =>
  publicV17StarterAdvanceMove(context, from, { x, z }, 0)

describe('v17 movement over saved free-placed works', () => {
  it('does not turn a saved open-pit wall into ordinary ground', () => {
    const site = resolvePublicV17GreenwaySite(seed, 'works3:dig:2:5')
    if (site?.kind !== 'dig') throw new Error('Missing pit fixture')
    const context = world([], [], [site.id])
    const pit = at(context, site.center.x + 1.95, site.center.z)
    const rim = at(context, site.center.x + 2.05, site.center.z)
    expect(Math.abs(rim.y - pit.y)).toBeGreaterThan(0.55)
    expect(Math.abs(rim.y - pit.y)).toBeLessThan(0.8)
    for (const [from, to] of [[pit, rim], [rim, pit]]) {
      expect(publicV17StarterAdvanceMove(context, from, to, 0,
        { maxOrdinaryGroundStepMeters: 0.8 }))
        .toMatchObject({ accepted: false, reason: 'cliff_blocked' })
    }
  })

  it('opts ordinary dry ground into a 0.8 m step without changing the north rim or creek', () => {
    const context = world()
    const from = at(context, 13.95, 4)
    expect(move(context, from, 14.05, 4))
      .toMatchObject({ accepted: false, reason: 'cliff_blocked' })
    expect(publicV17StarterAdvanceMove(context, from, { x: 14.05, z: 4 }, 0,
      { maxOrdinaryGroundStepMeters: 0.8 }))
      .toMatchObject({ accepted: true, position: at(context, 14.05, 4) })

    const rim = at(context, -28, -5.95)
    expect(publicV17StarterAdvanceMove(context, rim, { x: -28, z: -6.05 }, 0,
      { maxOrdinaryGroundStepMeters: 0.8 }))
      .toMatchObject({ accepted: false, reason: 'cliff_blocked' })
    const bank = at(context, 0, 5.95)
    expect(publicV17StarterAdvanceMove(context, bank, { x: 0, z: 6.05 }, 0,
      { maxOrdinaryGroundStepMeters: 0.8 }))
      .toMatchObject({ accepted: false, reason: 'creek_blocked' })
  })

  it('preserves frozen works3 support and collision decisions', () => {
    const context = world(['works3:bridge:0'], [], ['works3:dig:1:3'])
    for (const point of [{ x: 0, z: 8 }, { x: 4, z: 14 }, { x: 0, z: -5.9 }]) {
      expect(publicV17StarterSupportAt(context, point))
        .toEqual(publicV16StarterSupportAt(context, point))
    }
    const start = at(context, 0, 5.9)
    expect(move(context, start, 0, 6.1))
      .toEqual(publicV16StarterAdvanceMove(context, start, { x: 0, z: 6.1 }, 0))
  })

  it('crosses a built works4 bridge in both directions, never an unbuilt lane', () => {
    const bridge = findSite('bridge') as Bridge, x = bridge.from.x
    const halfWidth = bridge.widthMeters / 2
    const empty = world(), built = world([bridge.id])
    expect(publicV17StarterSupportAt(empty, { x, z: 8 })).toBeNull()
    expect(move(empty, at(empty, x, 5.9), x, 6.1))
      .toMatchObject({ accepted: false, reason: 'creek_blocked' })
    let pose = at(built, x, 3.8)
    for (let index = 0; index <= 42; index++) {
      const next = move(built, pose, x, Number((4 + index * 0.2).toFixed(2)))
      expect(next.accepted, `northbound step ${index}`).toBe(true)
      if (!next.accepted) return
      pose = next.position
      expect(publicV17StarterPoseValid(built, pose, 0)).toBe(true)
    }
    for (let index = 0; index <= 42; index++) {
      const next = move(built, pose, x, Number((12.2 - index * 0.2).toFixed(2)))
      expect(next.accepted, `southbound step ${index}`).toBe(true)
      if (!next.accepted) return
      pose = next.position
    }
    expect(publicV17StarterPoseValid(built, pose, 0)).toBe(true)
    expect(publicV17StarterSupportAt(built, { x: x + halfWidth + 0.1, z: 8 })).toBeNull()
    expect(move(built, at(built, x + halfWidth - 0.05, 8), x + halfWidth + 0.1, 8))
      .toMatchObject({ accepted: false, reason: 'off_bridge' })
    expect(move(built, at(built, x + halfWidth + 0.15, 5.9),
      x + halfWidth + 0.05, 6.1))
      .toMatchObject({ accepted: false, reason: 'off_bridge' })
  })

  it('can step off and back onto a built bridge on dry banks without leaving its wet rails', () => {
    const bridge = resolvePublicV17GreenwaySite(seed, 'works4:bridge:greenway-creek:0') as Bridge
    const built = world([bridge.id])
    for (const z of [5, 10.1, 11]) {
      const deck = at(built, 0.75, z)
      const bank = at(built, 0.85, z)
      expect(move(built, deck, 0.85, z), `exit at dry z=${z}`)
        .toMatchObject({ accepted: true, position: bank })
      expect(move(built, bank, 0.75, z), `reenter at dry z=${z}`)
        .toMatchObject({ accepted: true, position: deck })
      expect(publicV17StarterPoseValid(built, bank, 0)).toBe(true)
    }
    expect(move(built, at(built, 0.75, 10.1), 0.85, 9.9))
      .toMatchObject({ accepted: false, reason: 'off_bridge' })
    const guided = move(built, at(built, 0.85, 10.1), 0.85, 9.9)
    expect(guided.accepted).toBe(true)
    if (guided.accepted) {
      expect(guided.position.x).toBeLessThan(0.85)
      expect(guided.position.z).toBeGreaterThan(10)
    }
    expect(move(built, at(built, 0.75, 8), 0.85, 8))
      .toMatchObject({ accepted: false, reason: 'off_bridge' })
    const restored = world(['works3:bridge:0'])
    const savedDeckPose = at(restored, 0.75, 11)
    expect(publicV17StarterPoseValid(restored, savedDeckPose, 0)).toBe(true)
    expect(move(restored, savedDeckPose, 0.85, 11).accepted).toBe(true)
  })

  it('guides near-axial forward presses from either dry bank into a built deck in legal steps', () => {
    const bridge = resolvePublicV17GreenwaySite(seed, 'works4:bridge:greenway-creek:0') as Bridge
    const built = world([bridge.id])
    for (const [startZ, direction, wetZ] of [[5.9, 1, 6], [10.1, -1, 10]] as const) {
      for (const stride of [0.16, 0.24]) {
        let pose = at(built, 1.4, startZ)
        let entered = false
        for (let step = 0; step < 8; step++) {
          const next = move(built, pose, pose.x, pose.z + direction * stride)
          expect(next.accepted, `entry step ${step} from z=${startZ}, stride=${stride}`).toBe(true)
          if (!next.accepted) return
          expect(Math.hypot(next.position.x - pose.x, next.position.z - pose.z))
            .toBeLessThanOrEqual(stride + 1e-6)
          expect(publicV17StarterPoseValid(world([bridge.id]), next.position, 0)).toBe(true)
          if (Math.abs(pose.x) > bridge.widthMeters / 2) {
            expect(direction > 0 ? next.position.z < wetZ : next.position.z > wetZ).toBe(true)
          }
          pose = next.position
          if (next.support.kind === 'bridge') { entered = true; break }
        }
        expect(entered, `deck entry from z=${startZ}, stride=${stride}`).toBe(true)
        const wetStep = move(built, pose, pose.x, pose.z + direction * stride)
        expect(wetStep.accepted).toBe(true)
        if (wetStep.accepted) expect(wetStep.support.kind).toBe('bridge')
      }
    }
  })

  it('does not assist off-side, diagonal, away-from-creek, or unbuilt entries', () => {
    const bridge = resolvePublicV17GreenwaySite(seed, 'works4:bridge:greenway-creek:0') as Bridge
    const built = world([bridge.id])
    const farSide = at(built, 1.6, 10.1)
    expect(move(built, farSide, 1.6, 9.94))
      .toMatchObject({ accepted: false, reason: 'off_bridge' })
    const nearOffSide = at(built, 1.6, 5.9)
    expect(move(built, nearOffSide, 1.6, 6.06))
      .toMatchObject({ accepted: false, reason: 'off_bridge' })
    const nearSide = at(built, 1.4, 5.9)
    expect(move(built, nearSide, 1.25, 6.05))
      .toMatchObject({ accepted: false, reason: 'off_bridge' })
    expect(move(built, at(built, 1.4, 10.1), 1.4, 10.26))
      .toMatchObject({ accepted: true, position: at(built, 1.4, 10.26) })
    expect(move(world(), at(world(), 1.4, 5.9), 1.4, 5.96))
      .toMatchObject({ accepted: true, position: at(world(), 1.4, 5.96) })
    expect(move(world(), at(world(), 1.4, 5.9), 1.4, 6.06))
      .toMatchObject({ accepted: false, reason: 'creek_blocked' })
    const other = resolvePublicV17GreenwaySite(seed,
      'works4:bridge:greenway-creek:-14') as Bridge
    const onlyOther = world([other.id])
    const from = at(onlyOther, -0.1, 10.1)
    const guided = move(onlyOther, from, -0.1, 9.94)
    expect(guided.accepted).toBe(true)
    if (guided.accepted) {
      expect(guided.position.x).toBeLessThan(from.x)
      expect(guided.position.z).toBeGreaterThan(10)
    }
  })

  it('finishes the T171 saved deck pose with modest heading drift and a full continuous stride', () => {
    const built = world(['works4:bridge:greenway-creek:0'])
    const mapHeading = 3.212, yaw = 2 * Math.PI - mapHeading, stride = 0.16
    const from = at(built, -0.8, 9.9)
    // The north-up map arrow displays -yaw; movement uses -sin(yaw), -cos(yaw).
    const next = move(built, from, from.x - Math.sin(yaw) * stride,
      from.z - Math.cos(yaw) * stride)
    expect(next.accepted).toBe(true)
    if (!next.accepted) return
    expect(Math.hypot(next.position.x - from.x, next.position.z - from.z))
      .toBeCloseTo(stride, 10)
    expect(next.position.x).toBeGreaterThanOrEqual(-0.8)
    expect(next.position.z).toBeGreaterThan(10)
    expect(publicV17StarterPoseValid(built, next.position, 0)).toBe(true)
  })

  it('keeps drifting deck traversals within the rails in both directions through each dry foot', () => {
    const built = world(['works4:bridge:greenway-creek:0'])
    for (const stride of [0.16, 0.24]) for (const direction of [1, -1]) {
      for (const [startX, drift] of [[0.1, -0.071], [0.799999, 0.34],
        [-0.799999, -0.34]]) {
        const approach = startX === 0.1 ? -2.3 : 5.9
        let pose = at(built, startX, direction > 0 ? approach : startX === 0.1 ? 12.1 : 10.1)
        const steps = Math.ceil((12.3 - approach) / stride)
        for (let step = 0; step < steps; step++) {
          const dx = stride * drift / Math.hypot(1, drift)
          const dz = direction * Math.sqrt(stride * stride - dx * dx)
          const next = move(built, pose, pose.x + dx, pose.z + dz)
          expect(next.accepted, `stride=${stride}, direction=${direction}, step=${step}`).toBe(true)
          if (!next.accepted) return
          expect(Math.hypot(next.position.x - pose.x, next.position.z - pose.z))
            .toBeCloseTo(stride, 10)
          expect(publicV17StarterPoseValid(built, next.position, 0)).toBe(true)
          if (next.position.z > 6 && next.position.z <= 10) {
            expect(Math.abs(next.position.x)).toBeLessThanOrEqual(0.8)
          }
          pose = next.position
        }
        expect(direction > 0 ? pose.z > 12 : pose.z < approach).toBe(true)
      }
    }
  })

  it('does not turn sideways, steep diagonal, airborne, off-side, or unbuilt moves into deck travel', () => {
    const built = world(['works4:bridge:greenway-creek:0'])
    const from = at(built, -0.8, 8)
    for (const [dx, dz] of [[-0.16, 0], [-0.08, 0.16], [-0.01, 0.01]]) {
      expect(move(built, from, from.x + dx, from.z + dz))
        .toMatchObject({ accepted: false, reason: 'off_bridge' })
    }
    expect(publicV17StarterAdvanceMove(built, { ...from, y: from.y + 0.1 },
      { x: -0.81, z: 8.16 }, 1))
      .toMatchObject({ accepted: false, reason: 'off_bridge' })
    expect(move(built, at(built, -1.6, 5.9), -1.61, 6.06))
      .toMatchObject({ accepted: false, reason: 'off_bridge' })
    expect(move(world(), from, -0.81, 8.16))
      .toMatchObject({ accepted: false, reason: 'invalid_pose' })
  })

  it('climbs and descends a built works4 ladder and fails closed on forged IDs', () => {
    const ladder = findSite('ladder') as Ladder, x = ladder.supportPath[1].x
    const built = world([], [ladder.id])
    expect(move(world(), at(world(), x, -5.9), x, -6.1).accepted).toBe(false)
    let pose = at(built, x, -5.2)
    for (const z of [-5.4, -5.6, -5.8, -6, -6.2, -6.4,
      -6.2, -6, -5.8, -5.6, -5.4, -5.2]) {
      const next = move(built, pose, x, z)
      expect(next.accepted, `ladder step z=${z}`).toBe(true)
      if (!next.accepted) return
      pose = next.position
      expect(publicV17StarterPoseValid(built, pose, 0)).toBe(true)
    }
    expect(move(built, at(built, x + 0.45, -5.8), x + 0.56, -5.8))
      .toMatchObject({ accepted: false, reason: 'off_ladder' })
    expect(move(built, at(built, x + 0.55, -5.8), x + 0.45, -5.9))
      .toMatchObject({ accepted: false, reason: 'off_ladder' })
    for (const invalid of [world(['works4:bridge:greenway-creek:00']),
      world([ladder.id]), world([], [ladder.id, ladder.id])]) {
      expect(publicV17StarterSupportAt(invalid, { x: 0, z: 0 })).toBeNull()
      expect(move(invalid, { x: 0, y: 0, z: 0 }, 0.1, 0))
        .toMatchObject({ accepted: false, reason: 'invalid_pose' })
    }
  })

  it('can recover from the T203 off-lane lower-cliff pose by approaching the dry foot', () => {
    const ladder = findSite('ladder') as Ladder
    const built = world([], [ladder.id])
    let pose = at(built, 0.5, -5.9)
    expect(move(built, pose, 0.7, -5.9))
      .toMatchObject({ accepted: false, reason: 'off_ladder' })
    for (const [x, z] of [
      [0.5, -5.7], [0.5, -5.5], [0.5, -5.3], [0.5, -5.1],
      [0.7, -5.1], [0.9, -5.1], [ladder.from.x, -5.1],
      [ladder.from.x, -5.3], [ladder.from.x, -5.5],
      [ladder.from.x, -5.7], [ladder.from.x, -5.9],
      [ladder.from.x, -6.1], [ladder.from.x, -6.3],
    ] as const) {
      const next = move(built, pose, x, z)
      expect(next.accepted, `detour to x=${x}, z=${z}`).toBe(true)
      if (!next.accepted) return
      pose = next.position
    }
    expect(pose.y).toBeGreaterThan(at(built, 0.5, -5.9).y)
  })
})
