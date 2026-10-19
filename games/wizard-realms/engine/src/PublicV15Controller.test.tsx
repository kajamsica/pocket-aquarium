import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { publicV15CheckpointDue, publicV15CheckpointWithWorkMode,
  publicV15IdleWorksSampler, publicV15WorkRouteForView,
  PublicV15Controller } from './PublicV15Controller'
import { createPublicV15ControllerRuntime } from './PublicV15ControllerRuntime'
import { publicWorldV15ViewProjection } from './PublicV15WorldView'
import { createAtomicV15Store } from './domain/atomicV15Database'
import { encodeDiscoveredTileIds } from './domain/discoveryMask'
import { createPublicV15ContinuousSession } from './domain/publicWorldV15ContinuousSession'
import type { PublicV15Start } from './domain/publicWorldV15Flow'
import { createFreshPublicV15Head } from './domain/publicWorldV15Snapshot'
import { publicWorldV15StarterSites } from './domain/publicWorldV15StarterSites'
import { createTimedMovementSampler, recordTimedMovement } from './view/timedInput'
import { savedWorkKeyboardIntent } from './view/WizardSurface'

const seed = 'greenway-alpha'
const fresh = (): PublicV15Start => {
  const { head, lineage } = createFreshPublicV15Head(seed)
  return { state: head.state, starterWorks: head.starterWorks, bootstrap: null,
    saveRevision: 0, lineage }
}
const readyBridge = () => {
  const start = fresh()
  const bridge = publicWorldV15StarterSites(seed)[0]
  if (bridge.kind !== 'bridge') throw new Error('Missing bridge fixture')
  const mask = new Uint8Array(start.state.discoveryMask)
  const revealed = encodeDiscoveredTileIds(bridge.footprintTileIds)
  for (let index = 0; index < mask.length; index++) mask[index] |= revealed[index]
  return { start: { ...start, saveRevision: 1, state: { ...start.state,
    tick: 1, discoveryMask: mask, player: { ...start.state.player,
      position: { ...bridge.from }, inventory: [...start.state.player.inventory,
        { itemId: 'logs' as const, quantity: 8 }] } } }, bridge }
}

describe('v15 playable controller, still unmounted from the route', () => {
  it('renders the separate native v15 surface without opening a save', () => {
    const markup = renderToStaticMarkup(createElement(PublicV15Controller, {
      start: fresh(), locks: { request: async <T,>(_name: string,
        _options: { mode: 'exclusive' }, callback: () => T | Promise<T>) => callback() },
      store: createAtomicV15Store(new FakeFactory()),
    }))
    expect(markup).toContain('data-public-v15="true"')
    expect(markup).toContain('data-owner="greenway"')
    expect(markup).toContain('W/S move')
    expect(markup).toContain('Works Off')
    expect(markup).not.toContain('data-public-v14="true"')
  })

  it('routes only a current ready preview to the matching v15 Works writer', () => {
    const { start, bridge } = readyBridge()
    const session = createPublicV15ContinuousSession(start)
    const view = publicWorldV15ViewProjection(session.previewSnapshot(), session.view(),
      [], null, null, false, { kind: 'bridge', bodyYaw: Math.PI,
        modeActive: true, actionsEnabled: true })
    expect(view.savedTerrainWorks?.preview?.selected).toMatchObject({
      site: { id: bridge.id }, rejection: null })
    expect(publicV15WorkRouteForView(view, bridge.id, 'greenway')).toBe('starter')
    expect(publicV15WorkRouteForView(view, bridge.id, 'streamed')).toBeNull()
    expect(publicV15WorkRouteForView(view, 'works1:bridge:-102:92:z', 'greenway')).toBeNull()
    expect(savedWorkKeyboardIntent('KeyF', view.savedTerrainWorks))
      .toEqual({ type: 'saved-work.confirm', id: bridge.id })
    expect(savedWorkKeyboardIntent('Digit3', view.savedTerrainWorks))
      .toEqual({ type: 'saved-work.kind', kind: 'dig' })
    const dormant = { ...view, savedTerrainWorks: { ...view.savedTerrainWorks!, modeActive: false } }
    expect(publicV15WorkRouteForView(dormant, bridge.id, 'greenway')).toBeNull()
    const stale = { ...view, controllerActionsEnabled: false }
    expect(publicV15WorkRouteForView(stale, bridge.id, 'greenway')).toBeNull()
    const choice = view.savedTerrainWorks!.preview!.selected!
    const streamId = 'works1:bridge:-102:92:z'
    const streamed = { ...view, savedTerrainWorks: { ...view.savedTerrainWorks!,
      preview: { ...view.savedTerrainWorks!.preview!, selected: { ...choice,
        site: { ...choice.site, id: streamId } } } } }
    expect(publicV15WorkRouteForView(streamed, streamId, 'streamed')).toBe('streamed')
    expect(publicV15WorkRouteForView(streamed, streamId, 'greenway')).toBeNull()
  })

  it('pauses idle Greenway Works, flushes pending frames, and preserves work mode', async () => {
    const start = fresh()
    let runtime: ReturnType<typeof createPublicV15ControllerRuntime>
    runtime = createPublicV15ControllerRuntime(start, {
      frames: vi.fn(async (frames, revision, lineage) => {
        const session = createPublicV15ContinuousSession(start)
        for (const frame of frames) session.advanceFrame(frame.intents,
          { walkRequested: frame.walkRequested })
        const ready = session.snapshotForSave()
        if (ready.status === 'deferred-airborne') throw new Error('Unexpected airborne save')
        return { ok: true as const, value: { start: { ...ready.progress,
          bootstrap: null, saveRevision: revision + 1, lineage }, events: [] } }
      }),
      action: vi.fn(async () => ({ ok: false as const, reason: 'action-rejected' })),
      work: vi.fn(async () => ({ ok: false as const, reason: 'action-rejected' })),
      starterWork: vi.fn(async () => ({ ok: false as const, reason: 'action-rejected' })),
    })
    const sampler = createTimedMovementSampler(0)
    expect(publicV15IdleWorksSampler(runtime.view(), true,
      { held: [0, 0], tap: null, jump: false, sampler }, 50)?.cursorMs).toBe(50)
    recordTimedMovement(sampler, 25, [0, 1])
    expect(publicV15IdleWorksSampler(runtime.view(), true,
      { held: [0, 0], tap: null, jump: false, sampler }, 50)).toBeNull()
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(publicV15CheckpointDue(runtime.status(), false, true)).toBe(true)
    const mode = { current: true }
    expect((await publicV15CheckpointWithWorkMode(runtime, mode)).status).toBe('saved')
    expect(mode.current).toBe(true)
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0 })
    for (let index = 0; index < 128; index++) {
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    }
    expect(runtime.status()).toMatchObject({ gate: 'cap-paused', pendingFrames: 128 })
    expect(publicV15CheckpointDue(runtime.status(), false)).toBe(true)
  })
})
