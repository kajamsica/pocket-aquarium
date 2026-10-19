import { describe, expect, it } from 'vitest'
import { HIGHLAND_WIND_CONTENT_REVISION, HIGHLAND_WINDWARD_STEP,
  isHighlandWindTrailSegmentIndex } from './highlandWindContent'
import { highlandCorridorCells } from './highlandContent'
import { createFreshPublicWorld } from './publicWorldState'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { isValidPublicWorldV11State, withPublicV11Highland } from './publicWorldV11State'
import { isValidPublicWorldV12State, withPublicV12Windstep } from './publicWorldV12State'

const seed = 'greenway-alpha'
const v11 = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
  withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1')))))
const v12 = withPublicV12Windstep(v11)
const firstSegment = highlandCorridorCells()
  .findIndex((_, index) => isHighlandWindTrailSegmentIndex(index))
const learned = { ...v12, highland: { ...v12.highland, landmarkDiscovered: true },
  windstep: { ...v12.windstep, learned: true } }

describe('public v12 Windward Step state', () => {
  it('migrates a valid v11 state once without changing its source or older keyset', () => {
    const before = structuredClone(v11)
    expect(isValidPublicWorldV11State(v11, null)).toBe(true)
    expect(v12.windContentRevision).toBe(HIGHLAND_WIND_CONTENT_REVISION)
    expect(v12.windstep).toEqual({ learned: false, activeUntilTick: 0,
      nextCastTick: 0, practicedRouteIndices: [] })
    expect(isValidPublicWorldV12State(v12, null)).toBe(true)
    expect(isValidPublicWorldV11State(v12, null)).toBe(false)
    expect(isValidPublicWorldV12State(v11, null)).toBe(false)
    expect(v11).toEqual(before)
    expect(Reflect.ownKeys(v11)).not.toContain('windContentRevision')
    expect(Reflect.ownKeys(v11)).not.toContain('windstep')
    expect(() => withPublicV12Windstep(v12)).toThrow(RangeError)
    const withRevision = { ...v11, windContentRevision: HIGHLAND_WIND_CONTENT_REVISION }
    const withWindstep = { ...v11, windstep: {} }
    expect(() => withPublicV12Windstep(withRevision)).toThrow(RangeError)
    expect(() => withPublicV12Windstep(withWindstep)).toThrow(RangeError)
  })

  it('accepts a learned spell, a complete cast pair, and sorted canonical route practice', () => {
    expect(firstSegment).toBeGreaterThanOrEqual(0)
    expect(isHighlandWindTrailSegmentIndex(firstSegment + 1)).toBe(true)
    expect(isValidPublicWorldV12State(learned, null)).toBe(true)
    const practiced = { ...learned, tick: 100,
      windstep: { learned: true, activeUntilTick: 100 + HIGHLAND_WINDWARD_STEP.durationTicks,
        nextCastTick: 100 + HIGHLAND_WINDWARD_STEP.cooldownTicks,
        practicedRouteIndices: [firstSegment, firstSegment + 1] } }
    expect(isValidPublicWorldV12State(practiced, null)).toBe(true)
    // Cast clocks survive expiry; the validator must not demand that the old
    // active deadline still be in the future.
    expect(isValidPublicWorldV12State({ ...practiced, tick: 2500 }, null)).toBe(true)
  })

  it('rejects unknown or hidden own keys at both levels, and a changed content revision', () => {
    for (const candidate of [
      { ...v12, unexpected: true },
      { ...v12, windContentRevision: 'future-wind' },
      { ...v12, windstep: { ...v12.windstep, unexpected: true } },
    ]) expect(isValidPublicWorldV12State(candidate, null)).toBe(false)
    const hiddenRoot = { ...v12 }
    Object.defineProperty(hiddenRoot, 'hidden', { value: true })
    expect(isValidPublicWorldV12State(hiddenRoot, null)).toBe(false)
    const hiddenLedger = { ...v12.windstep }
    Object.defineProperty(hiddenLedger, 'hidden', { value: true })
    expect(isValidPublicWorldV12State({ ...v12, windstep: hiddenLedger }, null)).toBe(false)
  })

  it('rejects learning before Quarry Crown and any unlearned progress', () => {
    expect(isValidPublicWorldV12State({ ...v12,
      windstep: { ...v12.windstep, learned: true } }, null)).toBe(false)
    expect(isValidPublicWorldV12State({ ...v12,
      windstep: { ...v12.windstep, practicedRouteIndices: [firstSegment] } }, null)).toBe(false)
    expect(isValidPublicWorldV12State({ ...v12,
      windstep: { ...v12.windstep, activeUntilTick: 1200, nextCastTick: 1800 } }, null)).toBe(false)
    expect(isValidPublicWorldV12State({ ...learned,
      windstep: { ...learned.windstep, practicedRouteIndices: [firstSegment] } }, null)).toBe(false)
  })

  it('rejects forged segment indices, duplicates, and unsorted practice', () => {
    for (const indices of [[-1], [0], [1.5], [Number.MAX_SAFE_INTEGER],
      [firstSegment, firstSegment], [firstSegment + 1, firstSegment]]) {
      const candidate = { ...learned, tick: 100, windstep: { ...learned.windstep,
        activeUntilTick: 1300, nextCastTick: 1900, practicedRouteIndices: indices } }
      expect(isValidPublicWorldV12State(candidate, null)).toBe(false)
    }
  })

  it('rejects partial, independent, non-integer, negative, and over-future cast clocks', () => {
    const withClocks = (tick: number, activeUntilTick: number, nextCastTick: number) =>
      ({ ...learned, tick, windstep: { ...learned.windstep, activeUntilTick, nextCastTick } })
    expect(isValidPublicWorldV12State(withClocks(100, 1300, 1900), null)).toBe(true)
    expect(isValidPublicWorldV12State(withClocks(100, 1201, 1801), null)).toBe(true)
    for (const [tick, active, next] of [
      [100, 1300, 0], [100, 0, 1900], [100, 1300, 1901], [100, 1301, 1900],
      [100, 1300, 1800], [100, 1300, 1900.5], [100, -1, 1900],
      [100, 1301, 1901],
      [0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ]) expect(isValidPublicWorldV12State(withClocks(tick, active, next), null)).toBe(false)
  })

  it('accepts the largest safe cast window and rejects overflowing or remote future clocks', () => {
    const tick = Number.MAX_SAFE_INTEGER - HIGHLAND_WINDWARD_STEP.cooldownTicks
    const nearMax = { ...learned, tick, windstep: { ...learned.windstep,
      activeUntilTick: tick + HIGHLAND_WINDWARD_STEP.durationTicks,
      nextCastTick: Number.MAX_SAFE_INTEGER } }
    expect(isValidPublicWorldV11State({ ...v11, tick }, null)).toBe(true)
    expect(isValidPublicWorldV12State(nearMax, null)).toBe(true)
    expect(isValidPublicWorldV12State({ ...nearMax, tick: tick - 1 }, null)).toBe(false)
    expect(isValidPublicWorldV12State({ ...nearMax, windstep: { ...nearMax.windstep,
      nextCastTick: Number.MAX_SAFE_INTEGER + 1 } }, null)).toBe(false)
  })
})
