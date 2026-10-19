import { describe, expect, it } from 'vitest'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import {
  MIREGLASS_CORE, mireglassBermFaceRowAt, mireglassFenDepthAt, mireglassFenRowAt, mireglassPlateauAt,
} from './mireglassTerrain'
import { worldTileAtGrid } from './worldChunks'

const seeds = Array.from({ length: 100 }, (_, index) => `mireglass-corpus-${index}`)
const checkBothDirections = (
  seed: string, from: { x: number; z: number }, to: { x: number; z: number },
  expected: ReturnType<typeof mireglassMoveBarrier>,
) => {
  expect(mireglassMoveBarrier(seed, from, to), `${seed} forward ${JSON.stringify({ from, to })}`).toBe(expected)
  expect(mireglassMoveBarrier(seed, to, from), `${seed} reverse ${JSON.stringify({ from, to })}`).toBe(expected)
}

describe('Mireglass ordinary movement gate', () => {
  it('blocks the shallow front and deep side and back ring across the seed corpus', () => {
    for (const seed of seeds) {
      const x = -352
      const row = mireglassFenRowAt(seed, x)
      expect(mireglassFenDepthAt(seed, x, row)).toBe('shallow')
      checkBothDirections(seed, { x, z: row - 4 }, { x, z: row }, 'fen_channel')
      checkBothDirections(seed, { x: MIREGLASS_CORE.minX - 4, z: 400 }, { x: MIREGLASS_CORE.minX, z: 400 }, 'fen_channel')
      checkBothDirections(seed, { x: MIREGLASS_CORE.maxX + 4, z: 400 }, { x: MIREGLASS_CORE.maxX, z: 400 }, 'fen_channel')
      checkBothDirections(seed, { x, z: 520 }, { x, z: 516 }, 'fen_channel')
    }
  })

  it('blocks exact diagonal corner cuts and swept slivers through the fen', () => {
    for (const seed of seeds) {
      let corner: { x: number; z: number } | null = null
      for (let x = MIREGLASS_CORE.minX + 4; x < MIREGLASS_CORE.maxX && !corner; x += 4) {
        for (let z = 352; z <= 376; z += 4) {
          if (mireglassFenDepthAt(seed, x, z) !== null
            && mireglassFenDepthAt(seed, x - 4, z) === null
            && mireglassFenDepthAt(seed, x, z - 4) === null) {
            corner = { x, z }
            break
          }
        }
      }
      expect(corner, `${seed} fen corner`).not.toBeNull()
      if (!corner) continue
      const { x, z } = corner
      const from = { x: x - 3, z: z - 1 }
      const to = { x: x - 1, z: z - 3 }
      expect(mireglassFenDepthAt(seed, x - 4, z)).toBeNull()
      expect(mireglassFenDepthAt(seed, x, z - 4)).toBeNull()
      checkBothDirections(seed, from, to, 'fen_channel')
      checkBothDirections(seed, { x: x - 3, z: z - 0.9 }, { x: x - 1, z: z - 2.9 }, 'fen_channel')
    }
  })

  it('blocks the slate south, west, and east seams, including diagonal and corner moves', () => {
    for (const seed of seeds) {
      const x = -400
      const row = mireglassBermFaceRowAt(seed, x)
      expect(mireglassPlateauAt(seed, x, row)).not.toBeNull()
      checkBothDirections(seed, { x, z: row - 4 }, { x, z: row }, 'slate_cliff')
      checkBothDirections(seed, { x: -444, z: 460 }, { x: -440, z: 460 }, 'slate_cliff')
      checkBothDirections(seed, { x: -356, z: 460 }, { x: -360, z: 460 }, 'slate_cliff')
      checkBothDirections(seed, { x: x - 1, z: row - 3 }, { x: x + 1, z: row - 1 }, 'slate_cliff')

      const westRow = mireglassBermFaceRowAt(seed, -440)
      expect(mireglassPlateauAt(seed, -440, westRow)).toBe('rim')
      checkBothDirections(seed, { x: -443, z: westRow - 1 }, { x: -441, z: westRow - 3 }, 'slate_cliff')
      checkBothDirections(seed, { x: -443, z: westRow - 0.9 }, { x: -441, z: westRow - 2.9 }, 'slate_cliff')
    }
  })

  it('keeps dry approaches, exact lower-cell edge ties, and unrelated wetland traversable', () => {
    for (const seed of seeds) {
      const x = -352
      const row = mireglassFenRowAt(seed, x)
      checkBothDirections(seed, { x, z: row - 12 }, { x, z: row - 8 }, null)
      checkBothDirections(seed, { x, z: row + 8 }, { x, z: row + 12 }, null)
      checkBothDirections(seed, { x: -450, z: 400 }, { x: -450, z: 401 }, null)

      const south = mireglassBermFaceRowAt(seed, -400)
      checkBothDirections(seed, { x: -400, z: south - 2 }, { x: -399, z: south - 2 }, null)
      checkBothDirections(seed, { x: -442, z: 460 }, { x: -442, z: 461 }, null)
      checkBothDirections(seed, { x: -400, z: 460 }, { x: -399, z: 460 }, null)
    }

    const wetland = worldTileAtGrid('mireglass-seed', -368 / 4, 336 / 4)
    expect(wetland.terrain).toBe('wetland')
    expect(mireglassFenDepthAt('mireglass-seed', -368, 336)).toBeNull()
    checkBothDirections('mireglass-seed', { x: -368, z: 336 }, { x: -367, z: 336 }, null)
  })

  it('fails closed on invalid coordinates and overlong direct calls', () => {
    expect(mireglassMoveBarrier('seed', { x: NaN, z: 0 }, { x: 0, z: 0 })).toBe('fen_channel')
    expect(mireglassMoveBarrier('seed', { x: 0, z: 0 }, { x: Infinity, z: 0 })).toBe('fen_channel')
    expect(mireglassMoveBarrier('seed', { x: 0, z: 0 }, { x: 5, z: 0 })).toBe('fen_channel')
  })
})
