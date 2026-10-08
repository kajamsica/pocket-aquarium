import { describe, expect, it } from 'vitest'
import { highlandCorridorCells, HIGHLAND_LANDMARK } from './highlandContent'
import {
  HIGHLAND_WIND_CONTENT_REVISION, HIGHLAND_WIND_SPELL_CATALOG, HIGHLAND_WINDWARD_STEP,
  highlandWindAssistMultiplier, highlandWindCastWindow, highlandWindTrailLocation,
  isHighlandWindTrailSegmentIndex, isHighlandWindWestboundTrailStep,
} from './highlandWindContent'

const seed = 'greenway-alpha'
const route = highlandCorridorCells()
const trailStart = route.findIndex(({ x, z }) => x === 96 && z === 0)

describe('Highland Windward Step content contract', () => {
  it('pins Quarry Crown learning, bounded cast time, and a safe movement scalar', () => {
    expect(HIGHLAND_WIND_CONTENT_REVISION).toBe('highland-windward-step-v1')
    expect(HIGHLAND_WIND_SPELL_CATALOG.windward_step).toBe(HIGHLAND_WINDWARD_STEP)
    expect(HIGHLAND_WINDWARD_STEP.learnedAtLandmarkId).toBe(HIGHLAND_LANDMARK.id)
    expect(HIGHLAND_WINDWARD_STEP.durationTicks).toBeGreaterThan(0)
    expect(HIGHLAND_WINDWARD_STEP.durationTicks).toBeLessThan(HIGHLAND_WINDWARD_STEP.cooldownTicks)
    expect(HIGHLAND_WINDWARD_STEP.speedMultiplier).toBeGreaterThan(1)
    expect(HIGHLAND_WINDWARD_STEP.speedMultiplier).toBeLessThanOrEqual(1.25)
    expect(HIGHLAND_WINDWARD_STEP.maxAssistedStepMeters).toBe(0.2)
    expect(HIGHLAND_WINDWARD_STEP.maxAssistedStepMeters).toBeLessThan(4)
    expect(Object.isFrozen(HIGHLAND_WIND_SPELL_CATALOG)).toBe(true)
    expect(Object.isFrozen(HIGHLAND_WINDWARD_STEP)).toBe(true)
    expect(highlandWindCastWindow(100)).toEqual({ activeUntilTick: 1300, readyAtTick: 1900 })
    expect(Object.isFrozen(highlandWindCastWindow(100))).toBe(true)
    expect(highlandWindCastWindow(Number.MAX_SAFE_INTEGER - 1800)).toEqual({
      activeUntilTick: Number.MAX_SAFE_INTEGER - 600, readyAtTick: Number.MAX_SAFE_INTEGER,
    })
    for (const invalid of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER - 1799]) {
      expect(highlandWindCastWindow(invalid)).toBeNull()
    }
  })

  it('locates canonical segments and rejects the connector and points outside the narrow trail', () => {
    expect(trailStart).toBe(21)
    expect(highlandWindTrailLocation({ x: 96, z: 0 })).toEqual({
      segmentIndex: trailStart, routeMeters: 84, deviationMeters: 0,
    })
    expect(isHighlandWindTrailSegmentIndex(trailStart)).toBe(true)
    expect(isHighlandWindTrailSegmentIndex(route.length - 2)).toBe(true)
    expect(isHighlandWindTrailSegmentIndex(trailStart - 1)).toBe(false)
    expect(isHighlandWindTrailSegmentIndex(route.length - 1)).toBe(false)
    for (const invalid of [-1, 1.5, Infinity, NaN, null, '21']) {
      expect(isHighlandWindTrailSegmentIndex(invalid)).toBe(false)
    }
    expect(highlandWindTrailLocation({ x: 100, z: 0 })).toEqual({
      segmentIndex: trailStart, routeMeters: 88, deviationMeters: 0,
    })
    expect(highlandWindTrailLocation({ x: 100, z: -2 })).toEqual({
      segmentIndex: trailStart + 1, routeMeters: 90, deviationMeters: 0,
    })
    expect(highlandWindTrailLocation(route.at(-1)!)).toEqual({
      segmentIndex: route.length - 2, routeMeters: 988, deviationMeters: 0,
    })
    const last = route.at(-1)!
    const beforeLast = route.at(-2)!
    expect(highlandWindTrailLocation(route[trailStart - 1])).toBeNull()
    expect(highlandWindTrailLocation({ x: last.x + (last.x - beforeLast.x) * 0.025,
      z: last.z + (last.z - beforeLast.z) * 0.025 })).toBeNull()
    expect(highlandWindTrailLocation({ x: 95.9, z: 0 })).toBeNull()
    expect(highlandWindTrailLocation({ x: 100, z: 1 })).toBeNull()
    expect(highlandWindTrailLocation({ x: NaN, z: 0 })).toBeNull()
    expect(highlandWindTrailLocation({ x: Infinity, z: 0 })).toBeNull()
    expect(Object.isFrozen(highlandWindTrailLocation({ x: 100, z: -2 }))).toBe(true)
  })

  it('allows only short, dry, westbound steps on the authored trail over representative seeds', () => {
    for (const worldSeed of [seed, 'wizard-realms', 'mireglass-corpus-79']) {
      for (let index = trailStart + 1; index < route.length; index += 1) {
        const from = route[index]
        const previous = route[index - 1]
        const west = { x: from.x + (previous.x - from.x) * 0.05,
          z: from.z + (previous.z - from.z) * 0.05 }
        expect(isHighlandWindWestboundTrailStep(worldSeed, from, west),
          `${worldSeed} reverse trail segment ${index}`).toBe(true)
        expect(isHighlandWindWestboundTrailStep(worldSeed, west, from),
          `${worldSeed} outbound trail segment ${index}`).toBe(false)
      }
    }
    expect(isHighlandWindWestboundTrailStep(seed, { x: 100, z: -2 }, { x: 100, z: -1.8 })).toBe(true)
    expect(isHighlandWindWestboundTrailStep(seed, { x: 100, z: -2 }, { x: 100, z: -2.2 })).toBe(false)
    expect(isHighlandWindWestboundTrailStep(seed, { x: 96, z: 0 }, { x: 95.8, z: 0 })).toBe(false)
    expect(isHighlandWindWestboundTrailStep(seed, { x: 100, z: 1 }, { x: 99.8, z: 1 })).toBe(false)
    expect(isHighlandWindWestboundTrailStep(seed, { x: 100, z: 0 }, { x: 99.79, z: 0 })).toBe(false)
    expect(isHighlandWindWestboundTrailStep(seed, { x: 100, z: 0 }, { x: 100, z: 0 })).toBe(false)
    expect(isHighlandWindWestboundTrailStep(seed, { x: NaN, z: 0 }, { x: 99.8, z: 0 })).toBe(false)
  }, 30_000)

  it('never gives an assist without an active spell, foot travel, and an accepted move', () => {
    const input = { seed, from: { x: 100, z: 0 }, to: { x: 99.8, z: 0 },
      spellActive: true, onFoot: true, movementAccepted: true }
    expect(highlandWindAssistMultiplier(input)).toBe(1.25)
    expect(highlandWindAssistMultiplier({ ...input, spellActive: false })).toBe(1)
    expect(highlandWindAssistMultiplier({ ...input, onFoot: false })).toBe(1)
    expect(highlandWindAssistMultiplier({ ...input, movementAccepted: false })).toBe(1)
    expect(highlandWindAssistMultiplier({ ...input, to: { x: 100.2, z: 0 } })).toBe(1)
    expect(highlandWindAssistMultiplier({ ...input, to: { x: 99.79, z: 0 } })).toBe(1)
  })
})
