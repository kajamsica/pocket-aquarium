import { describe, expect, it } from 'vitest'
import { STARTER_CLIFF_PROFILE, starterCliffCanonicalSite } from './starterCliffProfile'
import { starterCliffAdvanceMove, starterCliffPoseValid, starterCliffSupportAt } from './starterCliffMovement'
import type { StarterCliffMovementContext } from './starterCliffMovement'
import { starterCliffGroundYAt } from './starterCliffWorld'
import type { Vec3 } from './types'

const seed = 'greenway-alpha'
const site = starterCliffCanonicalSite(seed)
const context = (built: boolean): StarterCliffMovementContext => ({
  seed, profile: STARTER_CLIFF_PROFILE, built,
  route: { id: 'greenway_ladder', name: 'Greenway ladder',
    fromAreaId: 'greenway', toAreaId: 'northern_ridge', siteId: site.id,
    from: site.from, to: site.to },
})
const at = (x: number, z: number, built = false): Vec3 => ({
  x, z, y: starterCliffSupportAt(context(built), { x, z })!.floorY,
})
const move = (world: StarterCliffMovementContext, from: Vec3, x: number, z: number,
  velocity = 0) => starterCliffAdvanceMove(world, from, { x, z }, velocity)

describe('starter cliff movement and pose policy', () => {
  it('sweeps the cliff seam for unbuilt, off-width and diagonal crossings', () => {
    const unbuilt = context(false)
    expect(move(unbuilt, at(0, -5.9), 0, -6.05)).toMatchObject({
      accepted: false, reason: 'cliff_blocked',
    })
    expect(starterCliffAdvanceMove(unbuilt, at(0, -5.9), { x: 0, z: -6.05 }, 0,
      { maxOrdinaryGroundStepMeters: 0.8 })).toMatchObject({
      accepted: false, reason: 'cliff_blocked',
    })
    expect(move(context(true), at(0.7, -5.9, true), 0.7, -6.05)).toMatchObject({
      accepted: false, reason: 'cliff_blocked',
    })
    expect(move(context(true), at(0.7, -5.9, true), 0.5, -6)).toMatchObject({
      accepted: false, reason: 'off_ladder',
    })
    expect(move(context(true), at(2, -5.9, true), 2, -6.05)).toMatchObject({
      accepted: false, reason: 'cliff_blocked',
    })
    expect(move(context(true), at(0, -5.2, true), 0, -6.2)).toMatchObject({
      accepted: false, reason: 'invalid_move',
    })
  })

  it('climbs and descends the built face through ordinary fixed-frame moves', () => {
    const built = context(true)
    let pose = at(0, -5.2, true)
    const ascent: number[] = [pose.y]
    for (const z of [-5.3, -5.4, -5.5, -5.6, -5.7, -5.8, -5.9, -6, -6.1]) {
      const result = move(built, pose, 0, z)
      expect(result.accepted, `ascent at ${z}`).toBe(true)
      if (!result.accepted) return
      pose = result.position
      ascent.push(pose.y)
      expect(starterCliffPoseValid(built, pose, 0)).toBe(true)
    }
    expect(ascent.slice(1).every((height, i) => height >= ascent[i])).toBe(true)
    expect(pose.y - ascent[0]).toBeCloseTo(1.56, 10)
    const descent: number[] = [pose.y]
    for (const z of [-6, -5.9, -5.8, -5.7, -5.6, -5.5, -5.4, -5.3, -5.2]) {
      const result = move(built, pose, 0, z)
      expect(result.accepted, `descent at ${z}`).toBe(true)
      if (!result.accepted) return
      pose = result.position
      descent.push(pose.y)
    }
    expect(descent.slice(1).every((height, i) => height <= descent[i])).toBe(true)
    expect(pose.y).toBeCloseTo(ascent[0], 10)
  })

  it('allows a centered angled approach and rejects a lateral exit mid-climb', () => {
    const built = context(true)
    const approach = move(built, at(0.35, -5.3, true), 0.25, -5.5)
    expect(approach.accepted).toBe(true)
    const middle = at(0.45, -5.7, true)
    expect(move(built, middle, 0.6, -5.7)).toMatchObject({
      accepted: false, reason: 'off_ladder',
    })
    expect(move(built, middle, 0.45, -5.8).accepted).toBe(true)
  })

  it('rejects sideways entry onto a raised rung, including diagonal edge cuts', () => {
    const built = context(true)
    const outside = at(0.55, -5.7, true)
    expect(move(built, outside, 0.5, -5.7)).toMatchObject({
      accepted: false, reason: 'off_ladder',
    })
    expect(move(built, outside, 0.5, -5.78)).toMatchObject({
      accepted: false, reason: 'off_ladder',
    })
    const inside = at(0.5, -5.7, true)
    expect(move(built, inside, 0.55, -5.7)).toMatchObject({
      accepted: false, reason: 'off_ladder',
    })
    expect(move(built, inside, 0.55, -5.78)).toMatchObject({
      accepted: false, reason: 'off_ladder',
    })
  })

  it('uses the same exact support to prove a reloaded mid-climb pose', () => {
    const built = context(true)
    const midway = move(built, at(0, -5.5, true), 0, -5.65)
    expect(midway.accepted).toBe(true)
    if (!midway.accepted) return
    const restored = JSON.parse(JSON.stringify(midway.position)) as Vec3
    expect(starterCliffPoseValid(built, restored, 0)).toBe(true)
    expect(starterCliffPoseValid(context(false), restored, 0)).toBe(false)
    expect(starterCliffPoseValid(built, { ...restored, y: restored.y + 0.1 }, 0)).toBe(false)
    expect(starterCliffPoseValid(built, restored, 1)).toBe(false)
    expect(move(built, restored, 0, -5.8).accepted).toBe(true)
  })

  it('provides no off-ladder or unbuilt support and rejects jump and profile skips', () => {
    const built = context(true)
    const on = starterCliffSupportAt(built, { x: 0.5, z: -5.7 })!
    const off = starterCliffSupportAt(built, { x: 0.55, z: -5.7 })!
    expect(on.kind).toBe('ladder')
    expect(off).toEqual({ kind: 'ground', floorY: starterCliffGroundYAt(seed, 0.55, -5.7),
      progress: null })
    expect(starterCliffSupportAt(context(false), { x: 0, z: -5.7 })!.kind).toBe('ground')
    expect(move(built, { ...at(0, -5.9, true), y: at(0, -5.9, true).y + 0.5 },
      0, -6.05, 5)).toMatchObject({ accepted: false, reason: 'invalid_pose' })
    const legacy = { ...built, profile: 'greenway-expanded-v1' }
    expect(starterCliffSupportAt(legacy, { x: 0, z: -5.7 })).toBeNull()
    expect(move(legacy, at(0, -5.9, true), 0, -6.05)).toMatchObject({
      accepted: false, reason: 'wrong_profile',
    })
  })
})
