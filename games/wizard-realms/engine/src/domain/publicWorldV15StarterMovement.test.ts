import { describe, expect, it } from 'vitest'
import { publicV15StarterAdvanceMove, publicV15StarterPoseValid,
  publicV15StarterSupportAt } from './publicWorldV15StarterMovement'
import type { PublicV15StarterMovementContext } from './publicWorldV15StarterMovement'
import { STARTER_CLIFF_PROFILE, starterCliffCanonicalSite } from './starterCliffProfile'
import type { Vec3 } from './types'

const seeds = ['greenway-alpha', 'region-0', 'wizard-realms', 'starter-seed-17', '']
function context(seed: string, bridgeBuilt = false,
  bankCacheDug = false): PublicV15StarterMovementContext {
  const site = starterCliffCanonicalSite(seed)
  return { seed, profile: STARTER_CLIFF_PROFILE, built: false,
    route: { id: 'greenway_ladder', name: 'Greenway ladder', fromAreaId: 'greenway',
      toAreaId: 'northern_ridge', siteId: site.id, from: site.from, to: site.to },
    starterWorks: { bridgeBuilt, bankCacheDug } }
}
const at = (world: PublicV15StarterMovementContext, x: number, z: number): Vec3 => ({
  x, z, y: publicV15StarterSupportAt(world, { x, z })!.floorY,
})
const move = (world: PublicV15StarterMovementContext, from: Vec3,
  x: number, z: number, velocity = 0) =>
  publicV15StarterAdvanceMove(world, from, { x, z }, velocity)

describe('v15 starter crossing support and movement', () => {
  it.each(seeds)('blocks the real wet gap before construction for seed %s', (seed) => {
    const world = context(seed)
    expect(publicV15StarterSupportAt(world, { x: 0, z: 8 })).toBeNull()
    expect(publicV15StarterSupportAt(world, { x: 0, z: 6 })).not.toBeNull()
    expect(publicV15StarterSupportAt(world, { x: -10, z: 8 })).not.toBeNull()
    expect(publicV15StarterSupportAt(world, { x: 10, z: 8 })).toBeNull()
    expect(move(world, at(world, 0, 5.9), 0, 6.1)).toMatchObject({
      accepted: false, reason: 'creek_blocked',
    })
    expect(move(world, at(world, 3, 5.9), 3, 6.1)).toMatchObject({
      accepted: false, reason: 'creek_blocked',
    })
    // The seam may be crossed within one fixed frame only after the bridge exists.
    expect(move(world, at(world, 0, 6 - 1e-4), 0, 6 + 1e-4).accepted).toBe(false)
    expect(move(world, at(world, 0, 5.9), 0, 6).accepted).toBe(true)
    expect(publicV15StarterPoseValid(world, { x: 0, y: 0, z: 8 }, 0)).toBe(false)
  })

  it.each(seeds)('supports a continuous narrow bridge in both directions for seed %s', (seed) => {
    const world = context(seed, true)
    let pose = at(world, 0, 3.9)
    for (let i = 20; i <= 61; i++) {
      const z = Number((i / 5).toFixed(2))
      const result = move(world, pose, 0, z)
      expect(result.accepted, `northbound at z=${z}`).toBe(true)
      if (!result.accepted) return
      pose = result.position
      expect(publicV15StarterPoseValid(world, pose, 0)).toBe(true)
      if (z >= 4 && z <= 12) expect(result.support.kind).toBe('bridge')
    }
    expect(pose.z).toBe(12.2)
    for (let i = 60; i >= 19; i--) {
      const z = Number((i / 5).toFixed(2))
      const result = move(world, pose, 0, z)
      expect(result.accepted, `southbound at z=${z}`).toBe(true)
      if (!result.accepted) return
      pose = result.position
      expect(publicV15StarterPoseValid(world, pose, 0)).toBe(true)
    }
    expect(pose.z).toBe(3.8)
  })

  it('rejects side-entry, off-width and diagonal seam cuts after construction', () => {
    const world = context('greenway-alpha', true)
    const unbuilt = context('greenway-alpha')
    expect(publicV15StarterSupportAt(world, { x: 0.8, z: 8 })?.kind).toBe('bridge')
    expect(publicV15StarterSupportAt(world, { x: 0.81, z: 8 })).toBeNull()
    for (const [from, to] of [
      [[0.81, 5.9], [0.81, 6.1]],
      [[0.86, 5.9], [0.75, 6.1]],
      [[0.75, 5.9], [0.86, 6.1]],
      [[0.85, 5], [0.75, 5]],
      [[0.75, 5], [0.85, 5]],
    ] as const) {
      expect(move(world, at(world, from[0], from[1]), to[0], to[1]))
        .toMatchObject({ accepted: false, reason: 'off_bridge' })
    }
    expect(move(world, at(world, 0, 5.9), 0, 6.1).accepted).toBe(true)
    expect(move(world, at(world, 0.7, 5.9), 0.6, 6.1).accepted).toBe(true)
    const cornerFrom = at(world, 10.05, 6.1)
    expect(move(world, cornerFrom, 9.9, 5.95))
      .toMatchObject({ accepted: false, reason: 'off_bridge' })
    expect(move(unbuilt, at(unbuilt, 10.05, 6.1), 9.9, 5.95))
      .toMatchObject({ accepted: false, reason: 'creek_blocked' })
  })

  it.each(seeds)('lowers only the authored dig patch, then requires its new saved height for seed %s', (seed) => {
    const before = context(seed, true)
    const after = context(seed, true, true)
    const undug = at(before, 4, 12)
    const dug = at(after, 4, 12)
    expect(dug.y).toBeCloseTo(undug.y - 0.24)
    expect(publicV15StarterPoseValid(before, undug, 0)).toBe(true)
    expect(publicV15StarterPoseValid(after, undug, 0)).toBe(false)
    expect(publicV15StarterPoseValid(after, dug, 0)).toBe(true)
    expect(publicV15StarterPoseValid(after, dug, 0.1)).toBe(false)
    expect(publicV15StarterSupportAt(after, { x: 1.7, z: 12 })?.floorY)
      .toBe(publicV15StarterSupportAt(before, { x: 1.7, z: 12 })?.floorY)
    expect(move(after, { ...dug, y: undug.y }, 4, 12))
      .toMatchObject({ accepted: false, reason: 'invalid_pose' })
    expect(move(after, at(after, 1.9, 12), 2.1, 12).accepted).toBe(true)
  })

  it('keeps v14 cliff rules and rejects invalid speed, height and profile', () => {
    const world = context('greenway-alpha', true)
    expect(move(world, at(world, 0, -5.9), 0, -6.05))
      .toMatchObject({ accepted: false, reason: 'cliff_blocked' })
    expect(move(world, at(world, 0, 5.8), 0, 6.1))
      .toMatchObject({ accepted: false, reason: 'invalid_move' })
    expect(move(world, { ...at(world, 0, 5.8), y: NaN }, 0, 5.9))
      .toMatchObject({ accepted: false, reason: 'invalid_move' })
    expect(move(world, { ...at(world, 0, 5.8), y: at(world, 0, 5.8).y + 0.1 }, 0, 5.9))
      .toMatchObject({ accepted: false, reason: 'invalid_pose' })
    expect(move({ ...world, profile: 'legacy' }, at(world, 0, 5.8), 0, 5.9))
      .toMatchObject({ accepted: false, reason: 'wrong_profile' })
  })
})
