import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  FALLBACK_LIVE_ROCKSCAPE,
  resolveLiveRockVisualPlan,
  sandVisualPlan,
} from './ReefHabitat'
import type { PocketRockView } from '../integration/pocketAquariumBridge'
import { REEF_ROCKS } from './reefLayout'

function rockWithBiology(biology: PocketRockView['biology']): PocketRockView {
  return {
    id: 7, index: 0,
    position: [0, -1, 0], rotation: [0, 0, 0], scale: [1, 1, 1], biology,
  }
}

describe('live-rock visual planning', () => {
  it('keeps immature rock sandy and preserves the fixed fallback transforms', () => {
    const rock = rockWithBiology({ diatom: 0, nuisanceAlgae: 0, coralline: 0, encruster: 0 })
    const plan = resolveLiveRockVisualPlan(rock)
    const hsl = { h: 0, s: 0, l: 0 }
    new THREE.Color(plan.baseColor).getHSL(hsl)

    expect(hsl.h).toBeGreaterThan(.08)
    expect(hsl.h).toBeLessThan(.13)
    expect(hsl.s).toBeGreaterThan(.18)
    expect(hsl.l).toBeGreaterThan(.55)
    expect(Object.values(plan.visiblePatches).every((patches) => patches.length === 0)).toBe(true)
    expect(FALLBACK_LIVE_ROCKSCAPE).toHaveLength(REEF_ROCKS.length)
    FALLBACK_LIVE_ROCKSCAPE.forEach((fallback, index) => {
      const source = REEF_ROCKS[index]
      expect(fallback.index).toBe(index)
      expect(fallback.position).toEqual([source.position.x, source.position.y, source.position.z])
      expect(fallback.rotation).toEqual([source.rotation.x, source.rotation.y, source.rotation.z])
      expect(fallback.scale).toEqual([source.scale.x, source.scale.y, source.scale.z])
    })
  })

  it('reveals stable patch prefixes monotonically and keeps biology channels independent', () => {
    const low = resolveLiveRockVisualPlan(rockWithBiology({
      diatom: .28, nuisanceAlgae: .14, coralline: .42, encruster: .1,
    }))
    const highDiatom = resolveLiveRockVisualPlan(rockWithBiology({
      diatom: .86, nuisanceAlgae: .14, coralline: .42, encruster: .1,
    }))

    expect(highDiatom.visiblePatches.diatom.slice(0, low.visiblePatches.diatom.length))
      .toEqual(low.visiblePatches.diatom)
    expect(highDiatom.visiblePatches.diatom.length).toBeGreaterThan(low.visiblePatches.diatom.length)
    expect(highDiatom.visiblePatches.nuisanceAlgae).toEqual(low.visiblePatches.nuisanceAlgae)
    expect(highDiatom.visiblePatches.coralline).toEqual(low.visiblePatches.coralline)
    expect(highDiatom.visiblePatches.encruster).toEqual(low.visiblePatches.encruster)
  })

  it('bounds each biology channel before resolving visibility', () => {
    const plan = resolveLiveRockVisualPlan(rockWithBiology({
      diatom: -2, nuisanceAlgae: Number.NaN, coralline: 2, encruster: 1,
    }))

    expect(plan.visiblePatches.diatom).toHaveLength(0)
    expect(plan.visiblePatches.nuisanceAlgae).toHaveLength(0)
    expect(plan.visiblePatches.coralline).toHaveLength(7)
    expect(plan.visiblePatches.encruster).toHaveLength(7)
  })
})

describe('sand condition rendering', () => {
  it('keeps a clean bed pale and adds bounded local dirt as husbandry declines', () => {
    const clean = sandVisualPlan({ detritus: 0, surfaceFilm: 0, turnover: 1, cleanliness: 1 })
    const dirty = sandVisualPlan({ detritus: .8, surfaceFilm: .7, turnover: .1, cleanliness: .2 })
    expect(clean.detritusInstances).toBe(0)
    expect(clean.filmInstances).toBe(0)
    expect(dirty.detritusInstances).toBeGreaterThan(0)
    expect(dirty.filmInstances).toBeGreaterThan(0)
    expect(dirty.baseColor).not.toBe(clean.baseColor)
  })
})
