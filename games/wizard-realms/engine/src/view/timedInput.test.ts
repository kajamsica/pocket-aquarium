import { describe, expect, it } from 'vitest'
import { createFixedInputClock, createTimedMovementSampler, recordTimedMovement, sampleFixedInputBatch, sampleTimedMovement } from './timedInput'

const STEP_MS = 50
const METERS_PER_STEP = 0.16
const RADIANS_PER_STEP = 0.13

function simulateStalledCallback(key: 'W' | 'S' | 'A' | 'D', heldMs: number) {
  const sampler = createTimedMovementSampler(0)
  const vector = key === 'W' ? [0, 1] as const : key === 'S' ? [0, -1] as const
    : key === 'A' ? [-1, 0] as const : [1, 0] as const
  recordTimedMovement(sampler, 10, vector)
  recordTimedMovement(sampler, 10 + heldMs, [0, 0])
  const finalStep = STEP_MS * Math.ceil((10 + heldMs) / STEP_MS)
  let forward = 0
  let turn = 0
  // No callback ran while the key was down. The catch-up callback processes these windows together.
  for (let endMs = STEP_MS; endMs <= finalStep; endMs += STEP_MS) {
    const sampled = sampleTimedMovement(sampler, endMs)
    forward += sampled[1] * METERS_PER_STEP
    turn += sampled[0] * RADIANS_PER_STEP
  }
  return { forward, turn }
}

describe('timestamped fixed-step movement sampling', () => {
  it.each([20, 100, 200, 500])('preserves a %ims W/S press released between stalled callbacks', (heldMs) => {
    expect(simulateStalledCallback('W', heldMs).forward).toBeCloseTo(heldMs / STEP_MS * METERS_PER_STEP, 5)
    expect(simulateStalledCallback('S', heldMs).forward).toBeCloseTo(-heldMs / STEP_MS * METERS_PER_STEP, 5)
  })

  it.each([20, 100, 200, 500])('turns for the actual %ims A/D held interval without adding a second tap', (heldMs) => {
    expect(simulateStalledCallback('A', heldMs).turn).toBeCloseTo(-heldMs / STEP_MS * RADIANS_PER_STEP, 5)
    expect(simulateStalledCallback('D', heldMs).turn).toBeCloseTo(heldMs / STEP_MS * RADIANS_PER_STEP, 5)
  })

  it('continues a held key at the normal fixed-step rate', () => {
    const sampler = createTimedMovementSampler(0)
    recordTimedMovement(sampler, 10, [0, 1])
    expect(sampleTimedMovement(sampler, 50)).toEqual([0, 0.8])
    expect(sampleTimedMovement(sampler, 100)).toEqual([0, 1])
    expect(sampleTimedMovement(sampler, 150)).toEqual([0, 1])
  })

  it.each([20, 100, 200, 500])('integrates a %ims down-up pair in one stalled callback', (heldMs) => {
    const sampler = createTimedMovementSampler(0)
    const clock = createFixedInputClock(0)
    recordTimedMovement(sampler, 10, [0, 1])
    recordTimedMovement(sampler, 10 + heldMs, [0, 0])
    const callbackAt = STEP_MS * Math.ceil((10 + heldMs) / STEP_MS)
    const samples = sampleFixedInputBatch(sampler, clock, callbackAt, STEP_MS, 12)
    expect(samples.reduce((distance, sample) => distance + sample[1] * METERS_PER_STEP, 0))
      .toBeCloseTo(heldMs / STEP_MS * METERS_PER_STEP, 5)
    expect(sampleFixedInputBatch(sampler, clock, callbackAt, STEP_MS, 12)).toEqual([])
  })

  it('drops catch-up time beyond twelve steps instead of replaying it later', () => {
    const sampler = createTimedMovementSampler(0)
    const clock = createFixedInputClock(0)
    recordTimedMovement(sampler, 0, [0, 1])
    const samples = sampleFixedInputBatch(sampler, clock, 2_000, STEP_MS, 12)
    expect(samples).toHaveLength(12)
    expect(samples.reduce((distance, sample) => distance + sample[1] * METERS_PER_STEP, 0))
      .toBeCloseTo(12 * METERS_PER_STEP)
    expect(sampler.cursorMs).toBe(2_000)
    expect(sampleFixedInputBatch(sampler, clock, 2_000, STEP_MS, 12)).toEqual([])
    expect(sampleFixedInputBatch(sampler, clock, 2_050, STEP_MS, 12)).toEqual([[0, 1]])
  })

  it.each([
    { key: 'W', vector: [0, 1] as const, heldMs: 20, distance: 0.064, turn: 0 },
    { key: 'W', vector: [0, 1] as const, heldMs: 200, distance: 0.64, turn: 0 },
    { key: 'S', vector: [0, -1] as const, heldMs: 200, distance: -0.64, turn: 0 },
    { key: 'A', vector: [-1, 0] as const, heldMs: 20, distance: 0, turn: -0.052 },
    { key: 'A', vector: [-1, 0] as const, heldMs: 200, distance: 0, turn: -0.52 },
    { key: 'D', vector: [1, 0] as const, heldMs: 200, distance: 0, turn: 0.52 },
  ])('preserves a $heldMs ms $key press when next callback arrives at 1200 ms', ({ vector, heldMs, distance, turn }) => {
    const sampler = createTimedMovementSampler(0)
    const clock = createFixedInputClock(0)
    recordTimedMovement(sampler, 10, vector)
    recordTimedMovement(sampler, 10 + heldMs, [0, 0])
    const samples = sampleFixedInputBatch(sampler, clock, 1_200, STEP_MS, 12)
    expect(samples).toHaveLength(12)
    expect(samples.reduce((sum, sample) => sum + sample[1] * METERS_PER_STEP, 0)).toBeCloseTo(distance, 5)
    expect(samples.reduce((sum, sample) => sum + sample[0] * RADIANS_PER_STEP, 0)).toBeCloseTo(turn, 5)
    expect(sampleFixedInputBatch(sampler, clock, 1_250, STEP_MS, 12)).toEqual([[0, 0]])
  })

  it('keeps a late tap in the same stalled callback rather than keeping only early windows', () => {
    const sampler = createTimedMovementSampler(0)
    const clock = createFixedInputClock(0)
    recordTimedMovement(sampler, 1_160, [0, 1])
    recordTimedMovement(sampler, 1_180, [0, 0])
    const samples = sampleFixedInputBatch(sampler, clock, 1_200, STEP_MS, 12)
    expect(samples).toHaveLength(12)
    expect(samples.reduce((sum, sample) => sum + sample[1] * METERS_PER_STEP, 0)).toBeCloseTo(0.064, 5)
  })

  it('keeps separated movement and turns in input order without oversized authority steps', () => {
    const sampler = createTimedMovementSampler(0)
    const clock = createFixedInputClock(0)
    recordTimedMovement(sampler, 10, [0, 1])
    recordTimedMovement(sampler, 210, [0, 0])
    recordTimedMovement(sampler, 900, [1, 0])
    recordTimedMovement(sampler, 1_100, [0, 0])
    const samples = sampleFixedInputBatch(sampler, clock, 1_200, STEP_MS, 12)
    expect(samples).toHaveLength(12)
    expect(samples.reduce((sum, sample) => sum + sample[1] * METERS_PER_STEP, 0)).toBeCloseTo(0.64, 5)
    expect(samples.reduce((sum, sample) => sum + sample[0] * RADIANS_PER_STEP, 0)).toBeCloseTo(0.52, 5)
    expect(samples.findIndex((sample) => sample[1] > 0))
      .toBeLessThan(samples.findIndex((sample) => sample[0] > 0))
    expect(samples.every(([turn, travel]) => Math.abs(turn) <= 1 && Math.abs(travel) <= 1)).toBe(true)
    expect(sampleFixedInputBatch(sampler, clock, 1_250, STEP_MS, 12)).toEqual([[0, 0]])
  })

  it('skips a long idle stall and bounds queued input transitions', () => {
    const sampler = createTimedMovementSampler(0)
    const clock = createFixedInputClock(0)
    for (let index = 0; index < 1_000; index++) {
      recordTimedMovement(sampler, index + 1, [0, index % 2 === 0 ? 1 : 0])
    }
    expect(sampler.changes.length).toBeLessThanOrEqual(256)
    expect(sampleFixedInputBatch(sampler, clock, 3_600_000, STEP_MS, 12)).toHaveLength(12)
    expect(sampler.cursorMs).toBe(3_600_000)
    expect(sampler.changes).toEqual([])
  })

  it('does not turn an overflowed idle prefix into phantom held movement', () => {
    const sampler = createTimedMovementSampler(0)
    const clock = createFixedInputClock(0)
    for (let index = 0; index < 257; index++) {
      recordTimedMovement(sampler, 1_000_000 + index, [0, index % 2 === 0 ? 1 : 0])
    }
    const samples = sampleFixedInputBatch(sampler, clock, 1_000_300, STEP_MS, 12)
    expect(samples).toHaveLength(12)
    expect(samples.reduce((sum, sample) => sum + sample[1] * METERS_PER_STEP, 0)).toBeCloseTo(0.5504, 5)
    expect(sampler.cursorMs).toBe(1_000_300)
  })
})
