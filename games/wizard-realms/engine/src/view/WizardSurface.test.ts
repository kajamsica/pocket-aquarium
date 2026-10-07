import { describe, expect, it } from 'vitest'
import { cameraOrbitFromDrag, movementVector } from './WizardSurface'

describe('third-person control grammar', () => {
  it('keeps forward, backward, and pivot axes independent', () => {
    expect(movementVector(new Set(['KeyW']))).toEqual([0, 1])
    expect(movementVector(new Set(['KeyS']))).toEqual([0, -1])
    expect(movementVector(new Set(['KeyA']))).toEqual([-1, 0])
    expect(movementVector(new Set(['KeyD']))).toEqual([1, 0])
    expect(movementVector(new Set(['KeyW', 'KeyD']))).toEqual([1, 1])
  })

  it('changes camera orbit only from drag deltas and clamps pitch', () => {
    expect(cameraOrbitFromDrag([0, 0.28], [25, -10])).toEqual([-0.1, 0.25])
    expect(cameraOrbitFromDrag([0, 0.7], [0, 100])).toEqual([0, 0.72])
    expect(cameraOrbitFromDrag([0, 0.1], [0, -100])).toEqual([0, 0.08])
  })
})
