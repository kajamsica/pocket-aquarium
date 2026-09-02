import { describe, expect, it } from 'vitest'

import {
  SPECTRAL_BAND_COUNT,
  VISIBLE_SPECTRAL_BANDS,
  estimateSpectralTransport,
  recombineSpectralRgb,
  sampleSpectralTransmittance,
} from './spectralTransport'

describe('six-band visible-light transport', () => {
  it('keeps the fixed bands ordered from violet through red', () => {
    expect(SPECTRAL_BAND_COUNT).toBe(6)
    expect(VISIBLE_SPECTRAL_BANDS.map((band) => band.name)).toEqual(
      ['violet', 'blue', 'cyan', 'green', 'amber', 'red'],
    )
    expect(VISIBLE_SPECTRAL_BANDS.map((band) => band.wavelengthNanometers))
      .toEqual([410, 450, 490, 530, 590, 650])
  })

  it('applies the interface once and attenuates each band independently', () => {
    const surface = sampleSpectralTransmittance(0, 0.78, 0.96)
    const deep = sampleSpectralTransmittance(1.2, 0.78, 0.96)

    expect(surface.every((value) => value === 0.96)).toBe(true)
    expect(deep.every((value, index) => value < surface[index])).toBe(true)
    expect(deep[5]).toBeLessThan(deep[4])
    expect(deep[4]).toBeLessThan(deep[1])
    expect(deep[0]).toBeLessThan(deep[2])
  })

  it('recombines an unattenuated spectrum to neutral display RGB', () => {
    const rgb = recombineSpectralRgb([1, 1, 1, 1, 1, 1])
    expect(rgb[0]).toBeCloseTo(1, 12)
    expect(rgb[1]).toBeCloseTo(1, 12)
    expect(rgb[2]).toBeCloseTo(1, 12)
  })

  it('reports the same band mean and bounded target-space chromatic spread', () => {
    const spectrum = sampleSpectralTransmittance(0.28, 0.78, 0.96)
    const telemetry = estimateSpectralTransport(0.28, 0.78, 0.96, 0.65, 640)
    const expectedMean = spectrum.reduce((sum, value) => sum + value, 0) / 6
    expect(telemetry).toEqual({
      spectralBands: 6,
      renderScale: 0.65,
      meanVisibleTransmittance: expectedMean,
      chromaticSpreadPixels: 4.48,
    })
    expect(telemetry.meanVisibleTransmittance).toBeGreaterThan(0)
    expect(telemetry.meanVisibleTransmittance).toBeLessThan(0.96)
  })
})
