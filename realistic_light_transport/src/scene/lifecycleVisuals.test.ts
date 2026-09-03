import { describe, expect, it } from 'vitest'

import { suspendedParticleProfile } from './ReefHabitat'

describe('lifecycle-driven suspended water', () => {
  it('renders no suspended particles in a dry commissioning tank', () => {
    expect(suspendedParticleProfile('commissioning', 0, 0.78).visibleCount).toBe(0)
  })

  it('makes cycling and ugly water denser, larger, warmer, and more opaque', () => {
    const cycling = suspendedParticleProfile('cycling', 1, 1.02)
    const ugly = suspendedParticleProfile('ugly_phase', 1, 1.4)
    const young = suspendedParticleProfile('young_reef', 1, 0.78)

    expect(cycling.visibleCount).toBeGreaterThan(young.visibleCount)
    expect(ugly.visibleCount).toBeGreaterThan(cycling.visibleCount)
    expect(cycling.size).toBeGreaterThan(young.size)
    expect(ugly.size).toBeGreaterThan(cycling.size)
    expect(cycling.opacity).toBeGreaterThan(young.opacity)
    expect(ugly.opacity).toBeGreaterThan(cycling.opacity)
    expect(cycling.suspendedColor).toBe('#c9c3a1')
    expect(ugly.suspendedColor).toBe('#d0a462')
  })

  it('keeps stabilizing and young reef water subtle and scales particles with fill', () => {
    const cycling = suspendedParticleProfile('cycling', 1, 0.9)
    const stabilizing = suspendedParticleProfile('stabilizing', 1, 0.9)
    const young = suspendedParticleProfile('young_reef', 1, 0.9)
    const halfFilled = suspendedParticleProfile('cycling', 0.5, 0.9)

    expect(stabilizing.visibleCount).toBeLessThan(cycling.visibleCount)
    expect(young.visibleCount).toBeLessThan(stabilizing.visibleCount)
    expect(halfFilled.visibleCount).toBe(Math.round(cycling.visibleCount / 2))
  })

  it('deterministically clamps out-of-range fill and optical attenuation', () => {
    const clamped = suspendedParticleProfile('ugly_phase', 2, 99)
    const upperBound = suspendedParticleProfile('ugly_phase', 1, 1.4)

    expect(clamped.visibleCount).toBe(upperBound.visibleCount)
    expect(clamped.size).toBeCloseTo(upperBound.size)
    expect(clamped.opacity).toBeCloseTo(upperBound.opacity)
    expect(clamped.suspendedColor).toBe(upperBound.suspendedColor)
    expect(clamped.detritusColor).toBe(upperBound.detritusColor)
    expect(suspendedParticleProfile('young_reef', -1, -1).visibleCount).toBe(0)
  })
})
