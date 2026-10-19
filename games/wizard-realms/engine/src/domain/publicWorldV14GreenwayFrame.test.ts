import { describe, expect, it } from 'vitest'
import { discoveryMaskHasTileId } from './discoveryMask'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { advancePublicV14GreenwayFrame } from './publicWorldV14GreenwayFrame'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { createFreshPublicV14State, validatePublicV14State } from './publicWorldV14Validation'
import { starterCliffPoseValid, starterCliffSupportAt } from './starterCliffMovement'
import { STARTER_CLIFF_SITE_ID } from './starterCliffProfile'

const seed = 'greenway-alpha'
const frame = (state: PublicV14State, intents: Parameters<typeof advancePublicV14GreenwayFrame>[1]) =>
  advancePublicV14GreenwayFrame(state, intents, { walkRequested: true })
const move = (x: number, z: number) => [{ type: 'move' as const, delta: { x, z } }]
const at = (state: PublicV14State, x: number, z: number) => {
  const context = { seed, profile: state.generationProfile,
    route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: state.greenway.builtRouteIds.includes('greenway_ladder') }
  return { x, y: starterCliffSupportAt(context, { x, z })!.floorY, z }
}
const unbuilt = (x: number, z: number): PublicV14State => {
  const base = createFreshPublicV14State(seed)
  return { ...base, player: { ...base.player, position: at(base, x, z) } }
}
const built = (x = 0, z = -5.2): PublicV14State => {
  const base = createFreshPublicV14State(seed)
  const state = { ...base, greenway: { ...base.greenway,
    routes: base.greenway.routes.map((route) => route.id === 'greenway_ladder'
      ? { ...route, siteId: STARTER_CLIFF_SITE_ID } : route),
    builtRouteIds: ['greenway_ladder' as const] },
  player: { ...base.player, xp: 60,
    skillXp: { ...base.player.skillXp, construction: 60 } } }
  return { ...state, player: { ...state.player, position: at(state, x, z) } }
}

describe('dormant v14 Greenway fixed frame', () => {
  it('climbs and descends the actual 1.56 m face with ordinary W/S frames', () => {
    let state = built()
    expect(validatePublicV14State(state, seed)).not.toBeNull()
    const lower = state.player.position.y
    const heights = [lower]
    for (let step = 0; step < 9; step++) {
      const result = frame(state, move(0, -0.1))
      expect(result.rejections, `ascent frame ${step}`).toEqual([])
      state = result.state
      heights.push(state.player.position.y)
      expect(starterCliffPoseValid({ seed, profile: state.generationProfile,
        route: state.greenway.routes[0], built: true }, state.player.position,
      state.player.verticalVelocity)).toBe(true)
      if (step === 4) expect(validatePublicV14State(state, seed)).not.toBeNull()
    }
    expect(heights.slice(1).every((height, i) => height >= heights[i])).toBe(true)
    expect(state.player.position.y - lower).toBeCloseTo(1.56, 10)
    const middle = structuredClone(state)
    expect(frame(middle, move(0, 0.1))).toEqual(frame(state, move(0, 0.1)))
    for (let step = 0; step < 9; step++) {
      const result = frame(state, move(0, 0.1))
      expect(result.rejections, `descent frame ${step}`).toEqual([])
      state = result.state
    }
    expect(state.player.position.y).toBeCloseTo(lower, 10)
  })

  it('keeps rejected unbuilt, off-width, diagonal and side-entry moves atomic', () => {
    const cases = [
      { state: unbuilt(0, -5.9), delta: move(0, -0.15) },
      { state: built(0.7, -5.9), delta: move(0, -0.15) },
      { state: built(0.7, -5.9), delta: move(-0.2, -0.1) },
      { state: built(0.55, -5.7), delta: move(-0.05, 0) },
      { state: built(0.55, -5.7), delta: move(-0.05, -0.08) },
    ]
    for (const { state, delta } of cases) {
      const before = structuredClone(state)
      const result = frame(state, delta)
      expect(result.state).toBe(state)
      expect(result.events).toEqual([])
      expect(result.rejections).toHaveLength(1)
      expect(state).toEqual(before)
    }
    const beforeLook = built(0.55, -5.7)
    const lookThenBlocked = advancePublicV14GreenwayFrame(beforeLook,
      [{ type: 'look', yawDelta: 0.2, pitchDelta: 0 }, ...move(-0.05, -0.08)],
      { walkRequested: true })
    expect(lookThenBlocked.state).toBe(beforeLook)
    expect(lookThenBlocked.events).toEqual([])
    expect(lookThenBlocked.rejections[0]?.code).toBe('off_connector')
  })

  it('keeps jump airborne in memory, blocks a seam skip, then lands before save proof', () => {
    let state = built(0, -6.1)
    const jumped = frame(state, [{ type: 'jump' }])
    expect(jumped.rejections).toEqual([])
    state = jumped.state
    expect(state.player.position.y - at(state, 0, -6.1).y).toBeCloseTo(0.25, 10)
    expect(state.player.verticalVelocity).toBeCloseTo(4.51, 10)
    expect(validatePublicV14State(state, seed)).toBeNull()
    const skip = frame(state, move(0, 0.15))
    expect(skip.state).toBe(state)
    expect(skip.rejections).toHaveLength(1)
    for (let step = 0; step < 30 && state.player.verticalVelocity !== 0; step++) {
      state = frame(state, []).state
    }
    expect(state.player.verticalVelocity).toBe(0)
    expect(state.player.position.y).toBeCloseTo(at(state, 0, -6.1).y, 10)
    expect(validatePublicV14State(state, seed)).not.toBeNull()
  })

  it('advances look, clock, RNG and exact nearby discovery without mutating input', () => {
    const state = createFreshPublicV14State(seed)
    expect(frame(state, move(0, -0.17)).rejections[0]?.code).toBe('invalid_value')
    const before = structuredClone(state)
    const result = frame(state, [{ type: 'look', yawDelta: 0.2, pitchDelta: 0.1 },
      ...move(0, -0.16)])
    expect(result.rejections).toEqual([])
    expect(result.state.tick).toBe(state.tick + 1)
    expect(result.state.rng.simulation).not.toBe(state.rng.simulation)
    expect(result.state.player.yaw).toBeCloseTo(state.player.yaw + 0.2)
    expect(result.state.player.pitch).toBeCloseTo(state.player.pitch + 0.1)
    const expected = nearbyWorldTileIds(result.state.player.position,
      PUBLIC_WALK_REVEAL_RADIUS_METERS).filter((id) =>
      !discoveryMaskHasTileId(state.discoveryMask, id))
    const discovered = result.events.filter((event) => event.type === 'tile_discovered')
    expect(discovered.map((event) => event.tileId)).toEqual(expected)
    expect(result.state.eventSequence).toBe(state.eventSequence + result.events.length)
    expect(expected.every((id) => discoveryMaskHasTileId(result.state.discoveryMask, id))).toBe(true)
    expect(state).toEqual(before)
    expect(frame(structuredClone(state), [{ type: 'look', yawDelta: 0.2, pitchDelta: 0.1 },
      ...move(0, -0.16)])).toEqual(result)
  })

  it('fences outbound travel even though its ground exists beyond the Greenway', () => {
    const base = createFreshPublicV14State(seed)
    const state = { ...base, player: { ...base.player, position: at(base, 34, 0) } }
    const result = frame(state, move(0.16, 0))
    expect(result.state).toBe(state)
    expect(result.events).toEqual([])
    expect(result.rejections[0]?.code).toBe('unavailable_here')
  })
})
