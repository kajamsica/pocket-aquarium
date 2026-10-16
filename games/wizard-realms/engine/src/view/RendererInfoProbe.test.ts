import { describe, expect, it } from 'vitest'
import type { WebGLInfo } from 'three'
import { createRendererInfoSampler, rendererInfoProbeEnabled } from './RendererInfoProbe'

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
      rendererInfoFrame: 12, calls: 81, triangles: 42_000,
      geometries: 19, textures: 7, programs: 2 })
    expect(report?.limitations).toContain('shadow-pass attribution is not guaranteed')
    info.render.calls = 99
    expect(report?.calls).toBe(81)
    expect(sample(4_000, 17, info)).toBeNull()
    expect(sample(5_000, 17, { ...info, programs: null })?.programs).toBeNull()
  })
})
