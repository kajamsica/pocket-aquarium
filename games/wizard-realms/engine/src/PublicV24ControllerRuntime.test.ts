import { describe, expect, it } from 'vitest'
import { createPublicV23ControllerRuntime,
  createPublicV24ControllerRuntime } from './PublicV23ControllerRuntime'
import type { PublicV24SavePhase } from './PublicV23ControllerRuntime'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { mireglassAnchors } from './domain/mireglassContent'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { createPublicV23Root, decodePublicV23Progress } from './domain/publicWorldV23Snapshot'
import { applyPublicV23Witness } from './domain/publicWorldV23Transitions'
import { applyPublicV24MireglassAction } from './domain/publicWorldV24MireglassAction'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import type { PublicV24Witness } from './domain/publicWorldV24Snapshot'
import type { PublicV24Start } from './domain/publicWorldV24Flow'

const seed = 'greenway-alpha'

function atMarker(): PublicV24Start {
  const source = createPublicV23Root(seed)
  const root = createPublicV24Root({ head: source.head, lineage: source.lineage })
  const point = mireglassAnchors(seed).fringeMarker.tile.center
  const state = { ...root.head.state, movementOwner: 'streamed' as const }
  const surface = resolvePublicV23Surface(state, point, root.head.regionalWorks.builtLadderIds)
  if (!surface) throw new Error('Marker has no surface')
  const discoveryMask = encodeDiscoveredTileIds([...new Set([
    ...decodeDiscoveredTileIds(state.discoveryMask), surface.tileId,
  ])].sort())
  const progress = decodePublicV23Progress({ state: { ...state, discoveryMask,
    player: { ...state.player, position: { x: point.x, y: surface.floorY, z: point.z } } },
    greenwayWorks: root.head.greenwayWorks, regionalWorks: root.head.regionalWorks }, seed)
  if (!progress) throw new Error('Invalid marker fixture')
  return { lineage: root.lineage, head: { ...root.head, ...progress } }
}

function v24Runtime(failAction = false, onSavePhase?: (sample: PublicV24SavePhase) => void) {
  let server = atMarker()
  const writes: PublicV24Witness[] = []
  const runtime = createPublicV24ControllerRuntime(server, async (revision, lineage, witness) => {
    writes.push(witness)
    if (failAction && witness.kind === 'mireglass-action/v1')
      return { ok: false, reason: 'source-changed' }
    const before = { state: server.head.state, greenwayWorks: server.head.greenwayWorks,
      regionalWorks: server.head.regionalWorks }
    const result = witness.kind === 'mireglass-action/v1'
      ? applyPublicV24MireglassAction(before, witness.action)
      : applyPublicV23Witness(before, witness)
    if ('rejection' in result) return { ok: false, reason: result.rejection ?? 'rejected' }
    server = { lineage, head: { ...server.head, ...result.progress,
      saveRevision: revision + 1, witness } }
    return { ok: true, value: server }
  }, onSavePhase)
  return { runtime, writes }
}

describe('shared V23/V24 controller runtime', () => {
  it('reports four opt-in checkpoint phases without changing the checked save', async () => {
    const phases: PublicV24SavePhase[] = []
    const observed = v24Runtime(false, (sample) => { phases.push(sample) })
    const plain = v24Runtime()
    expect(observed.runtime.advanceFrame([], false).rejections).toEqual([])
    expect(plain.runtime.advanceFrame([], false).rejections).toEqual([])
    expect(await observed.runtime.save()).toEqual(await plain.runtime.save())
    expect(phases.map((sample) => sample.phase)).toEqual([
      'witness-decode', 'local-frame-replay', 'writer-await', 'reply-check-clone'])
    for (const sample of phases) {
      expect(Object.keys(sample).sort()).toEqual(['durationMs', 'pendingFrames', 'phase'])
      expect(sample.pendingFrames).toBe(1)
      expect(Number.isFinite(sample.durationMs)).toBe(true)
      expect(sample.durationMs).toBeGreaterThanOrEqual(0)
    }
    expect(await observed.runtime.save()).toEqual({ status: 'unchanged' })
    expect(phases).toHaveLength(4)
    const brokenDiagnostics = v24Runtime(false, () => { throw new Error('trace failed') })
    expect(brokenDiagnostics.runtime.advanceFrame([], false).rejections).toEqual([])
    expect((await brokenDiagnostics.runtime.save()).status).toBe('saved')
  })

  it('keeps the V23 64-frame recommendation and 128-frame cap', async () => {
    const runtime = createPublicV23ControllerRuntime(createPublicV23Root(seed),
      async () => ({ ok: false, reason: 'source-changed' }))
    for (let index = 0; index < 128; index++) {
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
      if (index === 63) expect(runtime.status().checkpointRecommended).toBe(true)
    }
    expect(runtime.status()).toMatchObject({ pendingFrames: 128,
      checkpointRequired: true, gate: 'cap-paused' })
    expect(runtime.advanceFrame([], false).rejections).toHaveLength(1)
    expect(await runtime.save()).toEqual({ status: 'blocked', reason: 'source-changed' })
    expect(runtime.status().pendingFrames).toBe(128)
  })

  it('flushes pending travel before one typed V24 marker action', async () => {
    const { runtime, writes } = v24Runtime()
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(runtime.status().pendingFrames).toBe(1)
    const result = await runtime.action({ kind: 'mireglass-action/v1',
      action: { type: 'study_fringe_marker' } })
    expect(result.status).toBe('saved')
    expect(writes.map((witness) => witness.kind)).toEqual([
      'frame-batch/v1', 'mireglass-action/v1'])
    expect(runtime.status()).toMatchObject({ saveRevision: 2, pendingFrames: 0, gate: 'open' })
    expect(runtime.preview().state.mireglass.fringeMarkerStudied).toBe(true)
    expect(runtime.committed().head.state.mireglass.fringeMarkerStudied).toBe(true)
  })

  it('blocks on a failed V24 action write without claiming its result', async () => {
    const { runtime, writes } = v24Runtime(true)
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(await runtime.action({ kind: 'mireglass-action/v1',
      action: { type: 'study_fringe_marker' } })).toEqual({ status: 'blocked', reason: 'source-changed' })
    expect(writes.map((witness) => witness.kind)).toEqual([
      'frame-batch/v1', 'mireglass-action/v1'])
    expect(runtime.status()).toMatchObject({ saveRevision: 1, pendingFrames: 0, gate: 'blocked' })
    expect(runtime.preview().state.mireglass.fringeMarkerStudied).toBe(false)
    expect(await runtime.save()).toEqual({ status: 'blocked', reason: 'source-changed' })
  })

  it('rejects a V24 writer reply that advances revision without the expected progress', async () => {
    const start = atMarker()
    const runtime = createPublicV24ControllerRuntime(start, async (revision, lineage, witness) =>
      ({ ok: true, value: { lineage, head: { ...start.head,
        saveRevision: revision + 1, witness } } }))
    expect(await runtime.action({ kind: 'mireglass-action/v1',
      action: { type: 'study_fringe_marker' } })).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(runtime.status()).toMatchObject({ saveRevision: 0, gate: 'blocked' })
    expect(runtime.preview().state.mireglass.fringeMarkerStudied).toBe(false)
  })
})
