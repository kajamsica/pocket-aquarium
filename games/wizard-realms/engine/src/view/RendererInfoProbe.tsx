import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import type { WebGLInfo } from 'three'

const SAMPLE_PERIOD_MS = 2_000
const LIMITATIONS = 'Previous renderer.info frame, not GPU time or visible-only cost; shadow-pass attribution is not guaranteed. Memory counters are resource counts, not bytes.'

export function rendererInfoProbeEnabled(search: string, development: boolean): boolean {
  const query = new URLSearchParams(search)
  return development && query.get('dev') === '1' && query.get('rendererProbe') === '1'
}

export function createRendererInfoSampler(periodMs = SAMPLE_PERIOD_MS) {
  let previousSampleAtMs: number | null = null
  return (nowMs: number, frameIntervalMs: number, info: Pick<WebGLInfo, 'render' | 'memory' | 'programs'>) => {
    if (previousSampleAtMs === null) {
      previousSampleAtMs = nowMs
      return null
    }
    const sampleIntervalMs = nowMs - previousSampleAtMs
    if (sampleIntervalMs < periodMs) return null
    previousSampleAtMs = nowMs
    return {
      timestamp: new Date().toISOString(),
      sampleIntervalMs,
      frameIntervalMs,
      rendererInfoFrame: info.render.frame,
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? null,
      limitations: LIMITATIONS,
    }
  }
}

export function RendererInfoProbe() {
  const sample = useMemo(() => createRendererInfoSampler(), [])
  // R3F useFrame runs before Canvas renders; renderer.info still describes the previous render.
  useFrame(({ gl }, delta) => {
    const report = sample(performance.now(), delta * 1_000, gl.info)
    if (report) console.info('[wizard.renderer.info]', report)
  })
  return null
}
