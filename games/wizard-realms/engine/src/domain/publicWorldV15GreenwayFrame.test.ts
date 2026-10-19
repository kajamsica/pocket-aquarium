import { describe, expect, it } from 'vitest'
import { advancePublicV15GreenwayFrame } from './publicWorldV15GreenwayFrame'
import { publicV15StarterSupportAt } from './publicWorldV15StarterMovement'
import { createFreshPublicV14State } from './publicWorldV14Validation'
import type { PublicV15Progress } from './publicWorldV15Validation'

const seed = 'greenway-alpha'
const walk = { walkRequested: true }
const move = (z: number) => [{ type: 'move' as const, delta: { x: 0, z } }]
function at(z: number, bridgeBuilt: boolean): PublicV15Progress {
  const state = createFreshPublicV14State(seed)
  const starterWorks = { bridgeBuilt, bankCacheDug: false }
  const context = { seed, profile: state.generationProfile,
    route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: false, starterWorks }
  const support = publicV15StarterSupportAt(context, { x: 0, z })
  if (!support) throw new Error('Missing test support.')
  return { state: { ...state, player: { ...state.player,
    position: { x: 0, y: support.floorY, z } } }, starterWorks }
}

describe('v15 Greenway native frame', () => {
  it('keeps an unbuilt creek move atomic, including a preceding look', () => {
    const progress = at(5.92, false)
    const before = structuredClone(progress)
    const result = advancePublicV15GreenwayFrame(progress,
      [{ type: 'look', yawDelta: 0.2, pitchDelta: 0 }, ...move(0.16)], walk)
    expect(result.progress).toBe(progress)
    expect(result.events).toEqual([])
    expect(result.rejections[0]?.code).toBe('locked_area')
    expect(progress).toEqual(before)
  })

  it('walks the built bridge, retaining the starter-work flags through every frame', () => {
    let progress = at(5.92, true)
    for (let step = 0; step < 40; step++) {
      const result = advancePublicV15GreenwayFrame(progress, move(0.16), walk)
      expect(result.rejections, `step ${step}`).toEqual([])
      expect(result.progress.starterWorks).toEqual({ bridgeBuilt: true, bankCacheDug: false })
      progress = result.progress
    }
    expect(progress.state.player.position.z).toBeCloseTo(12.32, 10)
    expect(progress.state.tick).toBe(40)
    expect(progress.state.player.verticalVelocity).toBe(0)
  })

  it('preserves v14 turn and barefoot gait limits around the new creek', () => {
    const progress = at(5, false)
    const tooFast = advancePublicV15GreenwayFrame(progress, move(0.24), walk)
    expect(tooFast.progress).toBe(progress)
    expect(tooFast.rejections[0]?.code).toBe('invalid_value')
    const turned = advancePublicV15GreenwayFrame(progress,
      [{ type: 'look', yawDelta: 0.3, pitchDelta: 0.1 }], walk)
    expect(turned.rejections).toEqual([])
    expect(turned.progress.state.player.yaw).toBeCloseTo(progress.state.player.yaw + 0.3)
    expect(turned.progress.starterWorks).toBe(progress.starterWorks)
  })
})
