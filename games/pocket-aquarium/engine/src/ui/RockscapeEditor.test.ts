import { describe, expect, it } from 'vitest'

import type { PocketRockView } from '../integration/pocketAquariumBridge'
import { changedRockTransform, offsetRockPosition, resizeRock, rotateRock } from './RockscapeEditor'

const rock = (overrides: Partial<PocketRockView> = {}): PocketRockView => ({
  id: 2,
  index: 2,
  position: [0, -1, 0],
  rotation: [0, 0, 0],
  scale: [.5, .5, .5],
  biology: { diatom: .2, nuisanceAlgae: .1, coralline: .3, encruster: 0 },
  ...overrides,
})

describe('rockscape editor draft safety', () => {
  it('keeps position and scale previews inside authoritative root bounds', () => {
    expect(offsetRockPosition([2.2, -1, -.9], 0, .12)).toEqual([2.2, -1, -.9])
    expect(offsetRockPosition([2.2, -1, -.9], 2, -.12)).toEqual([2.2, -1, -.9])
    expect(resizeRock([.18, .5, .9], -.2)).toEqual([.18, .3, .7])
    expect(resizeRock([.18, .5, .9], .2)).toEqual([.38, .7, .9])
  })

  it('wraps yaw instead of previewing an out-of-bounds rotation', () => {
    const rotated = rotateRock([0, Math.PI - .01, 0], .2)
    expect(rotated[1]).toBeGreaterThanOrEqual(-Math.PI)
    expect(rotated[1]).toBeLessThanOrEqual(Math.PI)
    expect(rotated[1]).toBeLessThan(0)
  })

  it('returns only fields deliberately changed from the editor base', () => {
    const original = rock()
    expect(changedRockTransform(original, rock({ position: [.2, -1, 0] })))
      .toEqual({ position: [.2, -1, 0] })
    expect(changedRockTransform(original, rock({ biology: { ...original.biology, diatom: .9 } })))
      .toBeNull()
    expect(changedRockTransform(original, original)).toBeNull()
  })
})
