export const SPECTRAL_BAND_COUNT = 6 as const

export type SixBandSpectrum = readonly [number, number, number, number, number, number]

// These game-scale weights preserve the broad visible-water trend and average to one,
// so the snapshot attenuation remains the broadband control.
export const VISIBLE_SPECTRAL_BANDS = [
  { name: 'violet', wavelengthNanometers: 410, relativeAbsorption: 0.74,
    displayRgb: [0.42, 0.12, 0.88], refractionOffsetUv: 0.0035 },
  { name: 'blue', wavelengthNanometers: 450, relativeAbsorption: 0.5,
    displayRgb: [0.08, 0.33, 1], refractionOffsetUv: 0.0022 },
  { name: 'cyan', wavelengthNanometers: 490, relativeAbsorption: 0.46,
    displayRgb: [0, 0.88, 1], refractionOffsetUv: 0.0009 },
  { name: 'green', wavelengthNanometers: 530, relativeAbsorption: 0.72,
    displayRgb: [0.23, 1, 0.25], refractionOffsetUv: -0.0004 },
  { name: 'amber', wavelengthNanometers: 590, relativeAbsorption: 1.34,
    displayRgb: [1, 0.57, 0.06], refractionOffsetUv: -0.002 },
  { name: 'red', wavelengthNanometers: 650, relativeAbsorption: 2.24,
    displayRgb: [1, 0.06, 0.02], refractionOffsetUv: -0.0035 },
] as const

export interface SpectralTransportTelemetry {
  readonly spectralBands: typeof SPECTRAL_BAND_COUNT
  readonly renderScale: number
  readonly meanVisibleTransmittance: number
  readonly chromaticSpreadPixels: number
}

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

export function sampleSpectralTransmittance(
  depthMeters: number,
  attenuationPerMeter: number,
  interfaceTransmission = 1,
): SixBandSpectrum {
  const depth = Math.max(0, finiteOr(depthMeters, 0))
  const attenuation = Math.max(0, finiteOr(attenuationPerMeter, 0))
  const transmission = clamp(finiteOr(interfaceTransmission, 1), 0, 1)
  return VISIBLE_SPECTRAL_BANDS.map((band) =>
    transmission * Math.exp(-attenuation * band.relativeAbsorption * depth),
  ) as unknown as SixBandSpectrum
}

export function recombineSpectralRgb(
  spectrum: SixBandSpectrum,
): readonly [number, number, number] {
  const rgb = [0, 0, 0]
  const weights = [0, 0, 0]
  VISIBLE_SPECTRAL_BANDS.forEach((band, bandIndex) => {
    band.displayRgb.forEach((response, channel) => {
      rgb[channel] += Math.max(0, finiteOr(spectrum[bandIndex], 0)) * response
      weights[channel] += response
    })
  })
  return [0, 1, 2].map((channel) =>
    rgb[channel] / Math.max(weights[channel], Number.EPSILON),
  ) as unknown as readonly [number, number, number]
}

export function estimateSpectralTransport(
  depthMeters: number,
  attenuationPerMeter: number,
  interfaceTransmission: number,
  renderScale: number,
  targetWidthPixels: number,
): SpectralTransportTelemetry {
  const spectrum = sampleSpectralTransmittance(
    depthMeters, attenuationPerMeter, interfaceTransmission,
  )
  const offsets = VISIBLE_SPECTRAL_BANDS.map((band) => band.refractionOffsetUv)
  return {
    spectralBands: SPECTRAL_BAND_COUNT,
    renderScale: Math.max(0, finiteOr(renderScale, 0)),
    meanVisibleTransmittance:
      spectrum.reduce((sum, value) => sum + value, 0) / SPECTRAL_BAND_COUNT,
    chromaticSpreadPixels:
      (Math.max(...offsets) - Math.min(...offsets))
      * Math.max(0, finiteOr(targetWidthPixels, 0)),
  }
}
