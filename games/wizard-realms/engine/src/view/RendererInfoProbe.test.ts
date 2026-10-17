import { describe, expect, it } from 'vitest'
import type { WebGLInfo } from 'three'
import { createRendererInfoSampler, rendererInfoProbeEnabled, rendererInfoTraceSample } from './RendererInfoProbe'

describe('opt-in renderer info probe', () => {
  it('requires both explicit query flags and a development build', () => {
    expect(rendererInfoProbeEnabled('?dev=1&rendererProbe=1', true)).toBe(true)
    expect(rendererInfoProbeEnabled('?dev=1', true)).toBe(false)
    expect(rendererInfoProbeEnabled('?rendererProbe=1', true)).toBe(false)
    expect(rendererInfoProbeEnabled('?dev=0&rendererProbe=1', true)).toBe(false)
    expect(rendererInfoProbeEnabled('?dev=1&rendererProbe=1', false)).toBe(false)
  })

  it('emits at most one copied previous-frame snapshot per two seconds', () => {
    const sample = createRendererInfoSampler()
    const info = {
      render: { frame: 12, calls: 81, triangles: 42_000 },
      memory: { geometries: 19, textures: 7 },
      programs: [{}, {}],
    } as unknown as Pick<WebGLInfo, 'render' | 'memory' | 'programs'>
    expect(sample(1_000, 16.7, info)).toBeNull()
    expect(sample(2_999, 16.7, info)).toBeNull()
    const report = sample(3_000, 18, info)
    expect(report).toMatchObject({ sampleIntervalMs: 2_000, frameIntervalMs: 18,
      frameIntervalP50Ms: 16.7, frameIntervalP95Ms: 18, frameIntervalMaxMs: 18,
      observedFrames: 2, droppedFrames: 0,
      rendererInfoFrame: 12, calls: 81, triangles: 42_000,
      geometries: 19, textures: 7, programs: 2 })
    expect(report?.limitations).toContain('shadow-pass attribution is not guaranteed')
    expect(report?.limitations).toContain('not GPU timings')
    info.render.calls = 99
    expect(report?.calls).toBe(81)
    expect(sample(4_000, 17, info)).toBeNull()
    expect(sample(5_000, 17, { ...info, programs: null })).toMatchObject({
      programs: null, observedFrames: 2, droppedFrames: 0,
      frameIntervalP50Ms: 17, frameIntervalP95Ms: 17, frameIntervalMaxMs: 17,
    })
  })

  it('bounds the interval window and reports discarded old samples', () => {
    const sample = createRendererInfoSampler()
    const info = {
      render: { frame: 1, calls: 1, triangles: 1 },
      memory: { geometries: 1, textures: 1 },
      programs: [],
    } as unknown as Pick<WebGLInfo, 'render' | 'memory' | 'programs'>
    expect(sample(1_000, 8, info)).toBeNull()
    for (let frame = 1; frame < 520; frame += 1) {
      expect(sample(1_000 + frame, 8, info)).toBeNull()
    }
    expect(sample(3_000, 100, info)).toMatchObject({
      observedFrames: 520, droppedFrames: 8,
      frameIntervalP50Ms: 8, frameIntervalP95Ms: 8, frameIntervalMaxMs: 100,
    })
  })

  it('provides only numeric renderer fields for an opt-in downloadable trace', () => {
    const sample = createRendererInfoSampler(1)
    const info = { render: { frame: 1, calls: 3, triangles: 9 },
      memory: { geometries: 2, textures: 4 }, programs: null,
    } as unknown as Pick<WebGLInfo, 'render' | 'memory' | 'programs'>
    sample(1, 16, info)
    const report = sample(2, 17, info)
    expect(report).not.toBeNull()
    const traceSample = rendererInfoTraceSample(report!)
    expect(traceSample).toMatchObject({ calls: 3, triangles: 9,
      frameIntervalP50Ms: 17, programs: null })
    expect(Object.values(traceSample).every((value) => value === null
      || typeof value === 'number')).toBe(true)
    expect(traceSample).not.toHaveProperty('timestamp')
    expect(traceSample).not.toHaveProperty('limitations')
  })
})
