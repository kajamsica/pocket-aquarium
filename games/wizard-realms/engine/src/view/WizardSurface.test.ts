import { describe, expect, it } from 'vitest'
import { cameraOrbitFromDrag, movementVector, releaseHeldControls } from './WizardSurface'
import { mapSheetMode, mapToggleForKey } from './WizardMap'

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

  it('toggles the map from keyboard and selects a mobile full-screen sheet', () => {
    expect(mapToggleForKey(false, 'KeyM')).toBe(true)
    expect(mapToggleForKey(true, 'KeyM')).toBe(false)
    expect(mapToggleForKey(false, 'KeyW')).toBe(false)
    expect(mapSheetMode(719)).toBe('sheet')
    expect(mapSheetMode(720)).toBe('modal')
  })

  it.each(['window blur', 'document visibility loss'])('releases W/S/A/D after %s', () => {
    const held = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD'])
    expect(releaseHeldControls(held)).toEqual([0, 0])
    expect(held.size).toBe(0)
    expect(movementVector(held)).toEqual([0, 0])
  })
})
