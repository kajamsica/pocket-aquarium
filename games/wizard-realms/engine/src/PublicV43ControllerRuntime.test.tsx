import { IDBFactory } from 'fake-indexeddb'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { publicV14MovementIntents } from './PublicV14Controller'
import { PublicV23Controller, publicV42SavePhaseReporter } from './PublicV23Controller'
import { createPublicV17InputTrace } from './PublicV17InputScheduler'
import { createPublicV43ControllerRuntime } from './PublicV43ControllerRuntime'
import { createAtomicV42Store } from './domain/atomicV42Database'
import { createAtomicV43Store } from './domain/atomicV43Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { projectPublicV31Pose } from './domain/publicWorldV31Support'
import { commitPublicV43, resumePublicV43, startFreshPublicV43,
  startPublicV43 } from './domain/publicWorldV43Flow'
import type { PublicV43Start } from './domain/publicWorldV43Flow'
import { createFreshPublicV42Root, PUBLIC_V42_SCHEMA } from './domain/publicWorldV42Snapshot'
import type { PublicV42Root } from './domain/publicWorldV42Snapshot'
import { createPublicV43FamiliarProgress } from './domain/publicWorldV43FamiliarAction'
import { decodePublicV43CheckedSuccessor, replayPublicV43Witness,
  createPublicV43Root, PUBLIC_V43_SCHEMA } from './domain/publicWorldV43Snapshot'
import type { PublicV43Root, PublicV43Witness } from './domain/publicWorldV43Snapshot'
import { resolveSedgehornFamiliarSite } from './domain/sedgehornFamiliarContent'
import { waystationRiverSite } from './domain/waystationRiverContent'
import { worldTileAtGrid } from './domain/worldChunks'
import type { WizardViewProjection } from './view/contracts'
import { WizardHud } from './view/WizardHud'

const probe = vi.hoisted(() => ({ projection: null as WizardViewProjection | null,
  greenwayLogOrder: null as ReactNode }))
vi.mock('./view/WizardSurface', () => ({ WizardSurface: ({ projection, greenwayLogOrder }: {
  projection: WizardViewProjection; greenwayLogOrder?: ReactNode }) => {
  probe.projection = projection; probe.greenwayLogOrder = greenwayLogOrder; return null } }))
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

function atGreenwayStore(logs: number): PublicV43Start {
  const source = createFreshPublicV42Root('wizard-realms')
  const store = source.head.state.greenway.stores.find((entry) => entry.id === 'store-greenway')!
  const genesis = { ...source.lineage.genesis, state: { ...source.head.state,
    player: { ...source.head.state.player, position: { ...store.position },
      inventory: [...source.head.state.player.inventory,
        { itemId: 'logs' as const, quantity: logs }] } } }
  const v42: PublicV42Root = { lineage: { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed: 'wizard-realms', sourceRevision: 0, genesis },
  previous: null, head: { ...structuredClone(genesis), schemaVersion: PUBLIC_V42_SCHEMA,
    saveRevision: 0, witness: null } }
  const v43 = createPublicV43Root(v42)
  return { head: v43.head, lineage: v43.lineage }
}

describe('V43 checked controller bridge', () => {
  it('routes the fixed carpenter order through the checked V43 action and remembers its claim', async () => {
    let saved = atGreenwayStore(4)
    const writer = async (revision: number, _lineage: PublicV43Start['lineage'],
      witness: PublicV43Witness) => {
      if (revision !== saved.head.saveRevision)
        return { ok: false as const, reason: 'revision-changed' }
      const next = replayPublicV43Witness(saved.head, witness)
      if (!next) return { ok: false as const, reason: 'action-rejected' }
      saved = { lineage: saved.lineage, head: { ...next, schemaVersion: PUBLIC_V43_SCHEMA,
        saveRevision: revision + 1, witness } }
      return { ok: true as const, value: saved }
    }
    const runtime = createPublicV43ControllerRuntime(saved, writer)
    expect(await runtime.action({ kind: 'fulfill-greenway-logs/v1', quantity: 1 } as never))
      .toMatchObject({ status: 'rejected', reason: 'invalid_value' })
    expect(await runtime.action({ kind: 'fulfill-greenway-logs/v1' }))
      .toMatchObject({ status: 'saved' })
    expect(runtime.preview().greenwayOrder?.claimedAtSequence).toBeGreaterThan(0)
    expect(runtime.preview().state.player.inventory.some((row) => row.itemId === 'logs'))
      .toBe(false)
    expect(runtime.preview().state.player.coins).toBe(atGreenwayStore(4).head.state.player.coins + 10)
    expect(await runtime.action({ kind: 'fulfill-greenway-logs/v1' }))
      .toMatchObject({ status: 'rejected', reason: 'already_fulfilled' })
    const resumed = createPublicV43ControllerRuntime(saved, writer)
    expect(resumed.preview().greenwayOrder).toEqual(runtime.preview().greenwayOrder)
    expect(await resumed.action({ kind: 'fulfill-greenway-logs/v1' }))
      .toMatchObject({ status: 'rejected', reason: 'already_fulfilled' })
    const poor = createPublicV43ControllerRuntime(atGreenwayStore(3), writer)
    expect(await poor.action({ kind: 'fulfill-greenway-logs/v1' }))
      .toMatchObject({ status: 'rejected', reason: 'not_owned' })
  })

  it('shows the fixed order inside the Greenway store, with insufficient-log feedback', async () => {
    const { store, v42Store } = await setup()
    renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v43', start: atGreenwayStore(3), locks, store, v42Store }))
    const poorOrder = renderToStaticMarkup(createElement('div', null, probe.greenwayLogOrder))
    expect(poorOrder).toContain('3/4 logs carried')
    expect(poorOrder).toContain('disabled=""')
    const insufficient = renderToStaticMarkup(createElement(WizardHud, {
      projection: { ...probe.projection!, openStoreId: 'store-greenway' },
      onIntent: () => {}, greenwayLogOrder: probe.greenwayLogOrder }))
    expect(insufficient).toContain('Greenway carpenter order')
    expect(insufficient).toContain('Gather more from Greenway oaks.')
    renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v43', start: atGreenwayStore(4), locks, store, v42Store }))
    const readyOrder = renderToStaticMarkup(createElement('div', null, probe.greenwayLogOrder))
    expect(readyOrder).toContain('4/4 logs carried')
    expect(readyOrder).not.toContain('disabled=""')
    const ready = renderToStaticMarkup(createElement(WizardHud, {
      projection: { ...probe.projection!, openStoreId: 'store-greenway' },
      onIntent: () => {}, greenwayLogOrder: probe.greenwayLogOrder }))
    expect(ready).toContain('Deliver 4 logs · 10 coins')
    expect(ready).toContain('[data-public-version=v43] .wr-context[data-store-panel]')
  }, 120_000)

  it('rejects unavailable familiar actions without a write on the fresh V43 start', async () => {
    const { start, makeRuntime, store } = await setup()
    const runtime = makeRuntime(start)
    expect(await runtime.action({ kind: 'familiar-claim/v1' }))
      .toMatchObject({ status: 'rejected', reason: 'requires_crossing' })
    expect(await runtime.action({ kind: 'sedgehorn-care/v1' }))
      .toMatchObject({ status: 'rejected', reason: 'not_claimed' })
    expect(await runtime.action({ kind: 'familiar-tracks/v1', x: 999 } as never))
      .toMatchObject({ status: 'rejected', reason: 'invalid_value' })
    expect(runtime.preview().familiar.phase).toBe('search')
    expect(await store.readChecked()).toMatchObject({ status: 'valid', root: { head: {
      saveRevision: 0 } } })
  }, 120_000)

  it('saves a checked familiar step, reloads its phase, and refuses a duplicate', async () => {
    const factory = new IDBFactory(), store = createAtomicV43Store(factory)
    const base = createFreshPublicV42Root('wizard-realms').head
    const site = resolveSedgehornFamiliarSite(base)!, bridge = waystationRiverSite(base.state.seed)!
    const pocket = [] as string[]
    const gx = Math.floor(site.tracks.center.x / 4), gz = Math.floor(site.tracks.center.z / 4)
    for (let x = gx - 1; x <= gx + 1; x++) for (let z = gz - 1; z <= gz + 1; z++)
      pocket.push(worldTileAtGrid(base.state.seed, x, z).id)
    const source = { ...base, southbankReached: true,
      riverBridgeIds: [bridge.id], state: { ...base.state,
        movementOwner: 'streamed' as const,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(base.state.discoveryMask),
          ...bridge.footprintTileIds, ...pocket])].sort()),
        player: { ...base.state.player, position: { ...site.tracks.center },
          verticalVelocity: 0 } } }
    const genesis = createPublicV43FamiliarProgress(source)!
    expect(genesis).not.toBeNull()
    const lineage: PublicV43Root['lineage'] = { origin: 'v42-migration',
      rulesProfile: 'sedgehorn-familiar/v1', seed: source.state.seed,
      sourceRevision: 0, genesis }
    const head: PublicV43Root['head'] = { ...genesis, schemaVersion: PUBLIC_V43_SCHEMA,
      saveRevision: 0, witness: null }
    const missing = await store.readChecked()
    expect(missing.status).toBe('missing')
    if (missing.status !== 'missing') throw Error('Expected empty V43 fixture store')
    expect(await store.commit(missing.proof, { lineage, previous: null, head }))
      .toBe('committed')
    const persistedStart = await store.readChecked()
    if (persistedStart.status !== 'valid') throw Error('Missing checked fixture start')
    let releaseWrite: (() => void) | undefined
    let enteredWrite: (() => void) | undefined
    const writerEntered = new Promise<void>((resolve) => { enteredWrite = resolve })
    const writerHeld = new Promise<void>((resolve) => { releaseWrite = resolve })
    let pauseFamiliar = true
    const write = async (revision: number, _lineage: PublicV43Root['lineage'],
      witness: PublicV43Witness) => {
      if (pauseFamiliar && witness.kind === 'familiar-tracks/v1') {
        pauseFamiliar = false
        enteredWrite?.()
        await writerHeld
      }
      const read = await store.readChecked()
      if (read.status !== 'valid' || read.root.head.saveRevision !== revision)
        return { ok: false as const, reason: 'revision-changed' }
      const next = replayPublicV43Witness(read.root.head, witness)
      if (!next) return { ok: false as const, reason: 'action-rejected' }
      const successor: PublicV43Root = { lineage: read.root.lineage,
        previous: read.root.head, head: { ...next, schemaVersion: PUBLIC_V43_SCHEMA,
          saveRevision: revision + 1, witness } }
      expect(decodePublicV43CheckedSuccessor(read.root, successor)).not.toBeNull()
      const committed = await store.commit(read.proof, successor)
      return committed === 'committed'
        ? { ok: true as const, value: { head: successor.head, lineage: successor.lineage } }
        : { ok: false as const, reason: committed }
    }
    const runtime = createPublicV43ControllerRuntime({
      lineage: persistedStart.root.lineage, head: persistedStart.root.head }, write)
    const initialPosition = runtime.preview().state.player.position
    const claiming = runtime.action({ kind: 'familiar-tracks/v1' })
    await writerEntered
    try {
      expect(runtime.status()).toMatchObject({ gate: 'barrier', pendingFrames: 0 })
      expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections)
        .toMatchObject([{ code: 'unavailable_here' }])
      expect(await runtime.save()).toEqual({ status: 'busy' })
      expect(await runtime.returnHome()).toEqual({ status: 'busy' })
      expect(await runtime.action({ kind: 'familiar-tracks/v1' }))
        .toEqual({ status: 'busy' })
      expect(await runtime.action({ kind: 'ironhall-claim/v1' }))
        .toEqual({ status: 'busy' })
      expect(runtime.status().pendingFrames).toBe(0)
    } finally { releaseWrite?.() }
    expect(await claiming)
      .toEqual({ status: 'saved', events: [], resetWalkRequested: false })
    expect(runtime.preview().state.player.position).toEqual(initialPosition)
    expect(runtime.preview().familiar.phase).toBe('tracks')
    expect(runtime.advanceFrame([], true).rejections).toEqual([])
    expect(runtime.status().pendingFrames).toBe(1)
    const reopened = createAtomicV43Store(factory)
    const checked = await reopened.readChecked()
    expect(checked).toMatchObject({ status: 'valid', root: { head: {
      saveRevision: 1, familiar: { phase: 'tracks' }, witness: {
        kind: 'familiar-tracks/v1' } } } })
    if (checked.status !== 'valid') throw Error('Missing checked familiar save')
    const resumed = createPublicV43ControllerRuntime({ lineage: checked.root.lineage,
      head: checked.root.head }, write)
    expect(resumed.preview().familiar.phase).toBe('tracks')
    expect(await resumed.action({ kind: 'familiar-tracks/v1' }))
      .toMatchObject({ status: 'rejected', reason: 'wrong_stage' })
    expect(resumed.advanceFrame([], true).rejections).toEqual([])
    expect(await resumed.save()).toMatchObject({ status: 'saved' })
    expect(await reopened.readChecked()).toMatchObject({ status: 'valid', root: {
      head: { saveRevision: 2, familiar: { phase: 'tracks' } } } })
  }, 120_000)

  it('does not label V43 UI save callbacks as V42-only phases', () => {
    const trace = createPublicV17InputTrace()
    expect(publicV42SavePhaseReporter('v43', trace)).toBeUndefined()
    expect(JSON.parse(trace.json()).records).toEqual([])
    const v42 = publicV42SavePhaseReporter('v42', trace)
    expect(v42).toBeTypeOf('function')
    v42!({ phase: 'ui-message', durationMs: 1 })
    expect(JSON.parse(trace.json()).records).toMatchObject([
      { event: 'controller.save.phase', data: { phase: 'ui-message', durationMs: 1 } },
    ])
  })

  it('renders the V42 projection under an explicit V43 controller without changing V42', async () => {
    const { start, store, v42Store } = await setup()
    const source = await v42Store.readChecked()
    const html = renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v43', start, locks, store, v42Store }))
    expect(html).toContain('data-public-version="v43"')
    expect(html).toContain('Quest Journal · Next: Creek Span')
    expect(html).toContain('nearby oaks (4 logs per oak)')
    expect(html).toContain('class="v43-familiar"')
    expect(html).not.toContain('data-quest-journal="v43"')
    expect(html).toContain(':has(.wr-context) .v43-familiar')
    expect(html).toContain(':has(.wr-surface[data-backpack-open="true"]) .v43-familiar')
    const mobileLegacySuppression = '[data-public-v23]:has(.wr-v35-quest[data-expanded="true"]) .v43-familiar{display:none}'
    const mobileRule = `@media(max-width:719px){${mobileLegacySuppression}}`
    expect(html).toContain(mobileRule)
    expect(html.slice(0, html.indexOf(mobileRule))).not.toContain(mobileLegacySuppression)
    expect(html).toContain('.v43-familiar:not([open]){top:316px;width:calc(100vw - 560px)}')
    expect(html).toContain('@media(max-width:719px){[data-public-v23] .v43-familiar:not([open]){top:260px;left:16px;right:auto}}')
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
