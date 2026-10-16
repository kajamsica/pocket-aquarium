import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { publicV14MovementIntents } from './PublicV14Controller'
import { PublicV23Controller } from './PublicV23Controller'
import { createPublicV43ControllerRuntime } from './PublicV43ControllerRuntime'
import { createAtomicV42Store } from './domain/atomicV42Database'
import { createAtomicV43Store } from './domain/atomicV43Database'
import { projectPublicV31Pose } from './domain/publicWorldV31Support'
import { commitPublicV43, resumePublicV43, startFreshPublicV43,
  startPublicV43 } from './domain/publicWorldV43Flow'
import type { PublicV43Start } from './domain/publicWorldV43Flow'
import { createFreshPublicV42Root } from './domain/publicWorldV42Snapshot'
import type { WizardViewProjection } from './view/contracts'

const probe = vi.hoisted(() => ({ projection: null as WizardViewProjection | null }))
vi.mock('./view/WizardSurface', () => ({ WizardSurface: ({ projection }: {
  projection: WizardViewProjection }) => { probe.projection = projection; return null } }))
const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>) => body() }

async function setup() {
  const factory = new IDBFactory(), store = createAtomicV43Store(factory)
  const v42Store = createAtomicV42Store(factory)
  const started = await startFreshPublicV43(locks, store, v42Store, 'wizard-realms')
  expect(started.ok).toBe(true)
  if (!started.ok) throw Error(started.reason)
  const makeRuntime = (start: PublicV43Start) => createPublicV43ControllerRuntime(start,
    (revision, lineage, witness) => commitPublicV43(locks, store, v42Store,
      revision, lineage, witness))
  return { factory, store, v42Store, start: started.value, makeRuntime }
}

describe('V43 checked controller bridge', () => {
  it('renders the V42 projection under an explicit V43 controller without changing V42', async () => {
    const { start, store, v42Store } = await setup()
    const source = await v42Store.readChecked()
    const html = renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v43', start, locks, store, v42Store }))
    expect(html).toContain('data-public-version="v43"')
    expect(probe.projection?.v42IronHall).toMatchObject({ questClaimed: false,
      vestOwned: false, crestOutcome: 'unrolled' })
    expect(await v42Store.readChecked()).toEqual(source)
  }, 120_000)

  it('commits turn and movement frames through V43 and continues after checked reload', async () => {
    const { factory, start, makeRuntime, v42Store } = await setup()
    const source = await v42Store.readChecked()
    const runtime = makeRuntime(start)
    for (let index = 0; index < 8; index++) {
      const yaw = runtime.preview().state.player.yaw
      expect(runtime.advanceFrame(publicV14MovementIntents(yaw, [1, 1], 0.16), true)
        .rejections).toEqual([])
    }
    const moved = runtime.preview().state.player
    expect(moved.yaw).not.toBe(start.head.state.player.yaw)
    expect(moved.position).not.toEqual(start.head.state.player.position)
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    const reopened = createAtomicV43Store(factory)
    expect(await reopened.readChecked()).toMatchObject({ status: 'valid', root: { head: {
      saveRevision: 1, witness: { kind: 'frame-batch/v1' },
      state: { player: { yaw: moved.yaw, position: moved.position } } } } })
    const resumed = await resumePublicV43(locks, reopened, v42Store, 1, start.lineage)
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) throw Error(resumed.reason)
    const continued = makeRuntime(resumed.value)
    expect(continued.advanceFrame(publicV14MovementIntents(moved.yaw, [0, 1], 0.16), true)
      .rejections).toEqual([])
    expect(await continued.save()).toMatchObject({ status: 'saved' })
    expect(await reopened.readChecked()).toMatchObject({ status: 'valid', root: { head: {
      saveRevision: 2, state: { player: { position: continued.preview().state.player.position } } } } })
    expect(await v42Store.readChecked()).toEqual(source)
  }, 120_000)

  it('blocks stale and conflicted writes without claiming a local save', async () => {
    const { start, makeRuntime, store } = await setup()
    const first = makeRuntime(start), stale = makeRuntime(start)
    const frame = (runtime: ReturnType<typeof makeRuntime>) => runtime.advanceFrame(
      publicV14MovementIntents(runtime.preview().state.player.yaw, [0, 1], 0.16), true)
    expect(frame(first).rejections).toEqual([])
    expect(await first.save()).toMatchObject({ status: 'saved' })
    expect(frame(stale).rejections).toEqual([])
    expect(await stale.save()).toMatchObject({ status: 'blocked', reason: 'revision-changed' })
    expect(stale.status().gate).toBe('blocked')
    expect(await store.readChecked()).toMatchObject({ status: 'valid', root: { head: {
      saveRevision: 1 } } })
    const conflicted = createPublicV43ControllerRuntime(start,
      async () => ({ ok: false as const, reason: 'successor-conflict' }))
    expect(frame(conflicted).rejections).toEqual([])
    expect(await conflicted.save()).toEqual({ status: 'blocked', reason: 'successor-conflict' })
    expect(conflicted.status().gate).toBe('blocked')
  }, 120_000)

  it('waits for a jump to land before committing its full frame batch', async () => {
    const { start, store, makeRuntime } = await setup()
    const runtime = makeRuntime(start)
    expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'deferred-airborne' })
    for (let index = 0; index < 40; index++) {
      const preview = runtime.preview(), pose = projectPublicV31Pose(preview)
      if (preview.state.player.verticalVelocity === 0 && pose
        && Math.abs(pose.effective.position.y - pose.effective.floorY) < 1e-6) break
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    }
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(await store.readChecked()).toMatchObject({ status: 'valid', root: { head: {
      saveRevision: 1, witness: { kind: 'frame-batch/v1' } } } })
  }, 120_000)

  it('commits movement from a checked V42 migration without changing its source root', async () => {
    const factory = new IDBFactory(), v42Store = createAtomicV42Store(factory)
    const store = createAtomicV43Store(factory), source = createFreshPublicV42Root('wizard-realms')
    const missing = await v42Store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V42 source')
    expect(await v42Store.commit(missing.proof, source)).toBe('committed')
    const started = await startPublicV43(locks, store, v42Store, 0)
    expect(started.ok).toBe(true)
    if (!started.ok) throw Error(started.reason)
    const runtime = createPublicV43ControllerRuntime(started.value,
      (revision, lineage, witness) => commitPublicV43(locks, store, v42Store,
        revision, lineage, witness))
    expect(runtime.advanceFrame(publicV14MovementIntents(
      runtime.preview().state.player.yaw, [0, 1], 0.16), true).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(await store.readChecked()).toMatchObject({ status: 'valid', root: { head: {
      saveRevision: 1, witness: { kind: 'frame-batch/v1' } } } })
    expect(await v42Store.readForPromotion()).toMatchObject({ status: 'valid', root: source })
  }, 120_000)
})
