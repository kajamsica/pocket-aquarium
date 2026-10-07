import { describe, expect, it } from 'vitest'

import { createFlowField, diagnoseFlowField, estimateCanonicalFlowRegime, estimateFlowScalars, sampleFlowField, stepFlowField } from './flowField'

describe('reduced-order incompressible flow field', () => {
  it('creates independent balanced and cinematic SI-unit grids', () => {
    const balanced = createFlowField()
    const independent = createFlowField()
    const cinematic = createFlowField({ quality: 'cinematic' })

    expect([balanced.columns, balanced.rows, balanced.pressureIterations]).toEqual([24, 12, 12])
    expect([cinematic.columns, cinematic.rows, cinematic.pressureIterations]).toEqual([32, 16, 20])
    expect([balanced.widthMeters, balanced.heightMeters]).toEqual([1.2, 0.5])
    expect([balanced.velocityX === independent.velocityX, balanced.velocityY === independent.velocityY, balanced.pressure === independent.pressure]).toEqual([false, false, false])
  })

  it('is deterministic, samples normalized coordinates, and enforces no-through walls', () => {
    let first = createFlowField()
    let second = createFlowField()
    for (let step = 0; step < 40; step += 1) {
      first = stepFlowField(first, 1 / 60, 0.7)
      second = stepFlowField(second, 1 / 60, 0.7)
    }

    expect([first.velocityX, first.velocityY]).toEqual([second.velocityX, second.velocityY])
    expect(sampleFlowField(first, -1, 2)).toEqual(sampleFlowField(first, 0, 1))
    for (let row = 0; row < first.rows; row += 1) {
      expect(first.velocityX[row * (first.columns + 1)]).toBe(0)
      expect(first.velocityX[row * (first.columns + 1) + first.columns]).toBe(0)
    }
    for (let column = 0; column < first.columns; column += 1) {
      expect(first.velocityY[column]).toBe(0)
      expect(first.velocityY[first.rows * first.columns + column]).toBe(0)
    }
  })

  it('materially reduces divergence through pressure projection', () => {
    const projected = stepFlowField(createFlowField(), 1 / 30, 1)
    const diagnosis = diagnoseFlowField(projected)

    expect(diagnosis.divergenceBeforeProjection).toBeGreaterThan(0)
    expect(diagnosis.maximumDivergence).toBeLessThan(diagnosis.divergenceBeforeProjection * 0.8)
    expect(Number.isFinite(diagnosis.pressureResidual) && diagnosis.pressureResidual >= 0).toBe(true)
  })

  it('remains finite and bounded over a long deterministic run', () => {
    let field = createFlowField({ quality: 'cinematic' })
    for (let step = 0; step < 600; step += 1) field = stepFlowField(field, 1 / 60, 0.85)
    const diagnosis = diagnoseFlowField(field)
    const estimate = estimateFlowScalars(field)
    const sample = sampleFlowField(field, 0.37, 0.61)
    const values = [...field.velocityX, ...field.velocityY, ...field.pressure, ...Object.values(diagnosis), ...Object.values(sample)]

    expect(values.every(Number.isFinite)).toBe(true)
    expect(diagnosis.peakSpeedMetersPerSecond).toBeLessThanOrEqual(0.45)
    expect(diagnosis.lowFlowFraction >= 0 && diagnosis.lowFlowFraction <= 1).toBe(true)
    expect(diagnosis.meanSpeedMetersPerSecond).toBe(estimate.meanSpeedMetersPerSecond)
    expect(diagnosis.meanShearPerSecond).toBe(estimate.meanShearPerSecond)
  })

  it('returns identical canonical scalars to biology and renderer consumers', () => {
    const powers = [0, 0.62, 1]
    const regimes = powers.map((power) => {
      const biologyFacing = estimateCanonicalFlowRegime(power)
      const rendererFacing = estimateCanonicalFlowRegime(power)

      expect(rendererFacing).toBe(biologyFacing)
      expect(Object.isFrozen(rendererFacing)).toBe(true)
      expect(Object.values(rendererFacing).every(Number.isFinite)).toBe(true)
      return rendererFacing
    })

    expect(regimes[0].meanSpeedMetersPerSecond).toBeLessThan(regimes[1].meanSpeedMetersPerSecond)
    expect(regimes[1].meanSpeedMetersPerSecond).toBeLessThan(regimes[2].meanSpeedMetersPerSecond)
    expect(regimes[0].lowFlowFraction).toBeGreaterThan(regimes[1].lowFlowFraction)
    expect(regimes[1].lowFlowFraction).toBeGreaterThan(regimes[2].lowFlowFraction)
  })
})
