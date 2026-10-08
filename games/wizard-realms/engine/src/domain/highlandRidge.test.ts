import { describe, expect, it } from 'vitest'
import { HIGHLAND_CONTENT_REVISION } from './highlandContent'
import {
  HIGHLAND_RIDGE_REVISION, highlandRidgeCellAt, highlandRidgeCellAtWorld,
  highlandRidgeMoveBarrier, highlandRidgeRecoveryTarget,
} from './highlandRidge'
import { worldTileAtGrid } from './worldChunks'

describe('Highland ridge mask', () => {
  it('is a separate fixed revision and does not vary with the world seed', () => {
    expect(HIGHLAND_RIDGE_REVISION).toBe('highland-ridge-v1')
    expect(HIGHLAND_RIDGE_REVISION).not.toBe(HIGHLAND_CONTENT_REVISION)
    for (const seed of ['highland-a', 'highland-b', '']) {
      const cell = worldTileAtGrid(seed, 560 / 4, -472 / 4).center
      expect(highlandRidgeCellAt(cell.x, cell.z)).toBe('rock')
      expect(highlandRidgeCellAt(cell.x, -468)).toBe('gallery')
    }
  })

  it('uses exactly two gallery rows inside the bounded 4 m footprint', () => {
    for (let x = 560; x <= 596; x += 4) {
      for (let z = -520; z <= -416; z += 4) {
        expect(highlandRidgeCellAt(x, z)).toBe(z === -468 || z === -464 ? 'gallery' : 'rock')
      }
    }
    for (const [x, z] of [[556, -468], [600, -468], [560, -524], [560, -412],
      [562, -468], [560, -466], [NaN, -468]]) {
      expect(highlandRidgeCellAt(x, z)).toBeNull()
    }
  })

  it('allows the gallery in both directions and blocks its rock walls', () => {
    for (const z of [-468, -464]) {
      expect(highlandRidgeMoveBarrier({ x: 556, z }, { x: 560, z })).toBeNull()
      expect(highlandRidgeMoveBarrier({ x: 560, z }, { x: 556, z })).toBeNull()
      expect(highlandRidgeMoveBarrier({ x: 596, z }, { x: 600, z })).toBeNull()
      expect(highlandRidgeMoveBarrier({ x: 600, z }, { x: 596, z })).toBeNull()
    }
    expect(highlandRidgeMoveBarrier({ x: 580, z: -468 }, { x: 580, z: -472 })).toBe('ridge_rock')
    expect(highlandRidgeMoveBarrier({ x: 580, z: -464 }, { x: 580, z: -460 })).toBe('ridge_rock')
    expect(highlandRidgeMoveBarrier({ x: 557, z: -472 }, { x: 559, z: -472 })).toBe('ridge_rock')
  })

  it('blocks swept diagonal side cells and exact corner cuts', () => {
    expect(highlandRidgeMoveBarrier({ x: 557, z: -471 }, { x: 559, z: -469 })).toBe('ridge_rock')
    expect(highlandRidgeMoveBarrier({ x: 557, z: -471.1 }, { x: 559, z: -469.1 })).toBe('ridge_rock')
    expect(highlandRidgeMoveBarrier({ x: 557, z: -470.9 }, { x: 559, z: -468.9 })).toBeNull()
  })

  it('matches lower-center ownership at exact half-cell ties', () => {
    expect(highlandRidgeMoveBarrier({ x: 557, z: -472 }, { x: 558, z: -472 })).toBeNull()
    expect(highlandRidgeMoveBarrier({ x: 558, z: -472 }, { x: 558.001, z: -472 })).toBe('ridge_rock')
    expect(highlandRidgeMoveBarrier({ x: 558, z: -468 }, { x: 558.001, z: -468 })).toBeNull()
  })

  it('lets a legacy player leave rock but never re-enter from open ground', () => {
    expect(highlandRidgeMoveBarrier({ x: 560, z: -472 }, { x: 557, z: -472 })).toBeNull()
    expect(highlandRidgeMoveBarrier({ x: 560, z: -472 }, { x: 560, z: -468 })).toBeNull()
    expect(highlandRidgeMoveBarrier({ x: 557, z: -472 }, { x: 560, z: -472 })).toBe('ridge_rock')
    expect(highlandRidgeMoveBarrier({ x: 560, z: -468 }, { x: 560, z: -472 })).toBe('ridge_rock')
  })

  it('leaves unrelated terrain alone and fails closed on invalid or long moves', () => {
    expect(highlandRidgeMoveBarrier({ x: 0, z: 0 }, { x: 4, z: 0 })).toBeNull()
    expect(highlandRidgeMoveBarrier({ x: NaN, z: 0 }, { x: 0, z: 0 })).toBe('ridge_rock')
    expect(highlandRidgeMoveBarrier({ x: 0, z: 0 }, { x: Infinity, z: 0 })).toBe('ridge_rock')
    expect(highlandRidgeMoveBarrier({ x: 0, z: 0 }, { x: 5, z: 0 })).toBe('ridge_rock')
  })

  it('snaps world positions with lower-center half-cell ties', () => {
    expect(highlandRidgeCellAtWorld(558, -500)).toBeNull()
    expect(highlandRidgeCellAtWorld(558.001, -500)).toBe('rock')
    expect(highlandRidgeCellAtWorld(580, -470)).toBe('rock')
    expect(highlandRidgeCellAtWorld(580, -469.999)).toBe('gallery')
    expect(highlandRidgeCellAtWorld(NaN, -500)).toBeNull()
  })

  it('selects the nearest deterministic open center for an old rock-position save', () => {
    expect(highlandRidgeRecoveryTarget(580, -500)).toEqual({ x: 600, z: -500, distance: 20 })
    expect(highlandRidgeRecoveryTarget(580, -470)).toEqual({ x: 580, z: -468, distance: 2 })
    expect(highlandRidgeRecoveryTarget(578, -500)).toEqual({ x: 556, z: -500, distance: 22 })
    expect(highlandRidgeRecoveryTarget(580, -468)).toBeNull()
    expect(highlandRidgeRecoveryTarget(558, -500)).toBeNull()
    expect(highlandRidgeRecoveryTarget(Infinity, -500)).toBeNull()
  })
})
