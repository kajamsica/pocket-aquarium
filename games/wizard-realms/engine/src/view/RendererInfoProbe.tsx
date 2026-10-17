import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import type { WebGLInfo } from 'three'

const SAMPLE_PERIOD_MS = 2_000
const MAX_FRAME_INTERVALS = 512
const LIMITATIONS = 'useFrame intervals are frame pacing, not GPU timings; droppedFrames counts discarded samples, not missed displays. renderer.info describes the previous frame, not visible-only cost; shadow-pass attribution is not guaranteed. Memory counters are resource counts, not bytes.'

export function rendererInfoProbeEnabled(search: string, development: boolean): boolean {
  const query = new URLSearchParams(search)
  return development && query.get('dev') === '1' && query.get('rendererProbe') === '1'
}

export function createRendererInfoSampler(periodMs = SAMPLE_PERIOD_MS) {
  let previousSampleAtMs: number | null = null
  const frameIntervals: number[] = []
  let observedFrames = 0
  let droppedFrames = 0
  return (nowMs: number, frameIntervalMs: number, info: Pick<WebGLInfo, 'render' | 'memory' | 'programs'>) => {
    if (previousSampleAtMs === null) {
      previousSampleAtMs = nowMs
      return null
    }
    if (Number.isFinite(frameIntervalMs) && frameIntervalMs >= 0) {
      observedFrames += 1
      frameIntervals.push(frameIntervalMs)
      if (frameIntervals.length > MAX_FRAME_INTERVALS) {
        frameIntervals.shift()
        droppedFrames += 1
      }
    }
    const sampleIntervalMs = nowMs - previousSampleAtMs
    if (sampleIntervalMs < periodMs) return null
    previousSampleAtMs = nowMs
    const sortedIntervals = [...frameIntervals].sort((a, b) => a - b)
    const percentile = (fraction: number) => sortedIntervals[Math.ceil(fraction * sortedIntervals.length) - 1] ?? null
    const report = {
      timestamp: new Date().toISOString(),
      sampleIntervalMs,
      frameIntervalMs,
      frameIntervalP50Ms: percentile(0.5),
      frameIntervalP95Ms: percentile(0.95),
      frameIntervalMaxMs: sortedIntervals.at(-1) ?? null,
      observedFrames,
      droppedFrames,
      rendererInfoFrame: info.render.frame,
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? null,
      limitations: LIMITATIONS,
    }
    frameIntervals.length = 0
    observedFrames = 0
    droppedFrames = 0
    return report
  }
}

export type RendererInfoReport = NonNullable<ReturnType<ReturnType<typeof createRendererInfoSampler>>>

/** Keep downloadable traces numeric and bounded; the trace already records event time. */
export function rendererInfoTraceSample(report: RendererInfoReport) {
  const { sampleIntervalMs, frameIntervalMs, frameIntervalP50Ms, frameIntervalP95Ms,
    frameIntervalMaxMs, observedFrames, droppedFrames, rendererInfoFrame, calls,
    triangles, geometries, textures, programs } = report
  return { sampleIntervalMs, frameIntervalMs, frameIntervalP50Ms, frameIntervalP95Ms,
    frameIntervalMaxMs, observedFrames, droppedFrames, rendererInfoFrame, calls,
    triangles, geometries, textures, programs }
}

export function RendererInfoProbe({ onSample }: {
  onSample?: (sample: ReturnType<typeof rendererInfoTraceSample>) => void
}) {
  const sample = useMemo(() => createRendererInfoSampler(), [])
  // R3F useFrame runs before Canvas renders; renderer.info still describes the previous render.
  useFrame(({ gl }, delta) => {
    const report = sample(performance.now(), delta * 1_000, gl.info)
    if (report) {
      onSample?.(rendererInfoTraceSample(report))
      console.info('[wizard.renderer.info]', report)
    }
  })
  return null
}
