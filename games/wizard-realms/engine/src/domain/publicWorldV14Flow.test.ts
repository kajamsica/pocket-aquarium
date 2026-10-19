import { IDBDatabase as FakeDatabase, IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV13Store } from './atomicV13Database'
import { createAtomicV14Store } from './atomicV14Database'
import { encodeDiscoveredTileIds } from './discoveryMask'
import { createFreshPublicWorld } from './publicWorldState'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { withPublicV11Highland } from './publicWorldV11State'
import { encodePublicV11Head, PUBLIC_V11_SCHEMA } from './publicWorldV11Snapshot'
import { createPublicV13MigrationHead, decodePublicV13Head } from './publicWorldV13Snapshot'
import { inspectPublicV14, resumePublicV14, startFreshPublicV14,
  commitPublicV14FrameBatch, commitPublicV14GreenwayAction,
  commitPublicV14Snapshot, commitPublicV14TerrainWork } from './publicWorldV14Flow'
import type { PublicV14Start } from './publicWorldV14Flow'
import { advancePublicV14GreenwayAction } from './publicWorldV14Actions'
import { advancePublicV14GreenwayFrame } from './publicWorldV14GreenwayFrame'
import { createFreshPublicV14Head, decodePublicV14Head,
  encodePublicV14Head, PUBLIC_V14_MAX_FRAME_BATCH } from './publicWorldV14Snapshot'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { confirmPublicV14TerrainWork } from './publicWorldV14TerrainWork'
import * as v14Snapshot from './publicWorldV14Snapshot'
import { resolvePublicV14Surface } from './publicWorldV14Terrain'
import { starterCliffSupportAt } from './starterCliffMovement'
import { starterCliffAdvanceMove } from './starterCliffMovement'
import { starterCliffCanonicalSite, STARTER_CLIFF_SITE_ID } from './starterCliffProfile'
import { PUBLIC_V11_BOOTS_LISTING_ID, PUBLIC_V11_BOOTS_PRICE } from './publicWorldGait'
import { validatePublicV14State } from './publicWorldV14Validation'
import { resolveTerrainWorkSite } from './terrainWorks'

const locks = { request: async <T,>(name: string, options: { mode: 'exclusive' },
  callback: () => T | Promise<T>): Promise<T> => {
  expect(name).toBe('wizard-realms:world:v6:root:exclusive')
  expect(options).toEqual({ mode: 'exclusive' })
  return callback()
} }
const next = (state: Awaited<ReturnType<typeof startFreshPublicV14>>) => {
  if (!state.ok) throw new Error('Missing v14 start')
  return { ...structuredClone(state.value.state), tick: state.value.state.tick + 1 }
}
const idle = (start: PublicV14Start) => advancePublicV14GreenwayFrame(start.state, [],
  { walkRequested: false }).state
async function saveFrame(store: ReturnType<typeof createAtomicV14Store>, start: PublicV14Start,
  intents: Parameters<typeof advancePublicV14GreenwayFrame>[1]): Promise<PublicV14Start> {
  const frame = advancePublicV14GreenwayFrame(start.state, intents, { walkRequested: false })
  if (frame.rejections.length) throw new Error(`Frame rejected: ${frame.rejections[0].code}`)
  const saved = await commitPublicV14Snapshot(locks, store, frame.state,
    start.saveRevision, start.lineage)
  if (!saved.ok) throw new Error(`Frame save rejected: ${saved.reason}`)
  return saved.value
}
async function walkNear(store: ReturnType<typeof createAtomicV14Store>, initial: PublicV14Start,
  point: { x: number; z: number }, radius: number): Promise<PublicV14Start> {
  let start = initial
  for (let step = 0; step < 300; step++) {
    const dx = point.x - start.state.player.position.x
    const dz = point.z - start.state.player.position.z
    const distance = Math.hypot(dx, dz)
    if (distance <= radius) return start
    const travel = Math.min(0.16, distance - radius / 2)
    start = await saveFrame(store, start, [{ type: 'move', delta: {
      x: dx / distance * travel, z: dz / distance * travel } }])
  }
  throw new Error('Could not reach target')
}
async function putRaw(factory: IDBFactory, key: string, value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('wizard-realms:world:v14', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite')
      transaction.objectStore('records').put(value, key)
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
}
const BRIDGE_WORK = 'works1:bridge:-102:92:z'
const LADDER_WORK = 'works1:ladder:-103:108:W'
const DIG_WORK = 'tile--64-76'
/** Isolated writer fixture, deliberately not a journey reachable from fresh v14. */
function syntheticWorkState(base: PublicV14State, id: string, onTarget = false): PublicV14State {
  const site = resolveTerrainWorkSite(base.seed, id)!
  const seen = site.kind === 'dig' ? site.footprintTileIds[0] : site.footprintTileIds[1]
  const points = site.kind === 'dig' ? onTarget ? [site.center]
    : [{ x: site.center.x + 2.5, z: site.center.z },
      { x: site.center.x - 2.5, z: site.center.z },
      { x: site.center.x, z: site.center.z + 2.5 },
      { x: site.center.x, z: site.center.z - 2.5 }]
    : [site.from]
  for (const point of points) {
    const surface = resolvePublicV14Surface(base, point)
    if (!surface) continue
    const discoveryMask = new Uint8Array(base.discoveryMask)
    const bits = encodeDiscoveredTileIds([...new Set([surface.tileId, seen])].sort())
    for (let index = 0; index < bits.length; index++) discoveryMask[index] |= bits[index]
    const state: PublicV14State = { ...base, tick: 1, movementOwner: 'streamed',
      discoveryMask, player: { ...base.player,
        position: { ...point, y: surface.floorY }, backpackCapacity: 30,
        inventory: [...base.player.inventory.filter((stack) =>
          stack.itemId !== 'logs' && stack.itemId !== 'field_spade'),
        { itemId: 'logs', quantity: 12 }, { itemId: 'field_spade', quantity: 1 }],
        equipment: { ...base.player.equipment, mainHand: 'field_spade' } } }
    if (validatePublicV14State(state, base.seed)) return state
  }
  throw new Error(`No valid synthetic work pose for ${id}`)
}
async function syntheticWorkRoot(factory: IDBFactory, id: string, onTarget = false) {
  const store = createAtomicV14Store(factory)
  const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
  if (!fresh.ok) throw new Error('Missing fresh v14')
  const state = syntheticWorkState(fresh.value.state, id, onTarget)
  await putRaw(factory, 'previous', { saveRevision: 1,
    value: encodePublicV14Head(state, 1, fresh.value.lineage) })
  await putRaw(factory, 'head', { saveRevision: 2,
    value: encodePublicV14Head(state, 2, fresh.value.lineage) })
  expect((await inspectPublicV14(locks, store))).toMatchObject({ ok: true,
    value: { status: 'valid' } })
  return { store, state, lineage: fresh.value.lineage }
}
/** Isolated stone-holding fixture, not a fresh-world acquisition proof. */
async function syntheticStoneRoot(factory: IDBFactory) {
  const store = createAtomicV14Store(factory)
  const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
  if (!fresh.ok) throw new Error('Missing fresh v14')
  const base = fresh.value.state
  const shop = base.greenway.stores[0]
  const support = starterCliffSupportAt({ seed: base.seed, profile: base.generationProfile,
    route: base.greenway.routes[0], built: false }, shop.position)!
  const state: PublicV14State = { ...base, tick: 1,
    player: { ...base.player, position: { ...shop.position, y: support.floorY },
      inventory: [...base.player.inventory, { itemId: 'stone', quantity: 3 }] } }
  expect(validatePublicV14State(state, base.seed)).not.toBeNull()
  await putRaw(factory, 'previous', { saveRevision: 1,
    value: encodePublicV14Head(state, 1, fresh.value.lineage) })
  await putRaw(factory, 'head', { saveRevision: 2,
    value: encodePublicV14Head(state, 2, fresh.value.lineage) })
  return { store, state, lineage: fresh.value.lineage }
}

describe('dormant independent v14 flow', () => {
  it('starts only an empty root, resumes the exact revision, and never creates an old root', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV14Store(factory)
    expect(await inspectPublicV14(locks, store)).toEqual({ ok: true, value: { status: 'missing' } })
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    expect(fresh.ok).toBe(true)
    if (!fresh.ok) return
    expect(fresh.value.saveRevision).toBe(0)
    const raw = await store.read()
    expect(raw.status).toBe('ok')
    if (raw.status !== 'ok') return
    expect(raw.previous).toBeNull()
    expect(raw.lineage).toEqual(fresh.value.lineage)
    expect(decodePublicV14Head((raw.head as { value: unknown }).value, raw.lineage)?.state)
      .toEqual(fresh.value.state)
    expect(await resumePublicV14(locks, store, 0, fresh.value.lineage))
      .toEqual({ ok: true, value: fresh.value })
    expect(await startFreshPublicV14(locks, store, 'another-seed'))
      .toEqual({ ok: false, reason: 'root-present' })
    expect((await factory.databases()).map((entry) => entry.name))
      .toEqual(['wizard-realms:world:v14'])
  })

  it('commits a bounded Greenway batch with a replayable raw witness', async () => {
    const store = createAtomicV14Store(new FakeFactory())
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const frames = [
      { intents: [{ type: 'look', yawDelta: 0.1, pitchDelta: 0.02 },
        { type: 'move', delta: { x: 0.16, z: 0 } }], walkRequested: true },
      { intents: [{ type: 'move', delta: { x: 0.16, z: 0 } }], walkRequested: true },
      { intents: [], walkRequested: false },
    ]
    const committed = await commitPublicV14FrameBatch(locks, store, frames, 0, fresh.value.lineage)
    expect(committed.ok).toBe(true)
    if (!committed.ok) return
    expect(committed.value.start.saveRevision).toBe(1)
    expect(committed.value.start.state.tick).toBe(3)
    expect(committed.value.events.some((event) => event.type === 'player_moved')).toBe(true)
    const raw = await store.read()
    if (raw.status !== 'ok') throw new Error('Missing raw v14')
    expect((raw.head as { value: { frameWitness: unknown } }).value.frameWitness)
      .toEqual({ kind: 'frame-batch/v1', frames })
    expect(await inspectPublicV14(locks, store)).toEqual({ ok: true,
      value: { status: 'valid', start: committed.value.start } })
    expect(await resumePublicV14(locks, store, 1, fresh.value.lineage))
      .toEqual({ ok: true, value: committed.value.start })
  })

  it('rejects unsupported, oversized, airborne and stale frame batches', async () => {
    const store = createAtomicV14Store(new FakeFactory())
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const idleFrame = { intents: [], walkRequested: false }
    expect(await commitPublicV14FrameBatch(locks, store, [], 0, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'invalid-frames' })
    expect(await commitPublicV14FrameBatch(locks, store,
      Array(PUBLIC_V14_MAX_FRAME_BATCH + 1).fill(idleFrame), 0, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'invalid-frames' })
    expect(await commitPublicV14FrameBatch(locks, store, [
      { intents: [{ type: 'harvest', resourceId: 'greenway-journey-tree-0' }],
        walkRequested: false }], 0, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'invalid-frames' })
    expect(await commitPublicV14FrameBatch(locks, store, [
      { intents: [{ type: 'jump' }], walkRequested: false }], 0, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'frame-rejected' })
    const saved = await commitPublicV14FrameBatch(locks, store, [idleFrame], 0,
      fresh.value.lineage)
    expect(saved.ok).toBe(true)
    expect(await commitPublicV14FrameBatch(locks, store, [idleFrame], 0,
      fresh.value.lineage)).toEqual({ ok: false, reason: 'revision-changed' })
  })

  it('lets only one concurrent batch claim a v14 save revision', async () => {
    const factory = new FakeFactory()
    const first = createAtomicV14Store(factory), second = createAtomicV14Store(factory)
    const fresh = await startFreshPublicV14(locks, first, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const frames = [{ intents: [], walkRequested: false }]
    const attempts = await Promise.all([
      commitPublicV14FrameBatch(locks, first, frames, 0, fresh.value.lineage),
      commitPublicV14FrameBatch(locks, second, frames, 0, fresh.value.lineage),
    ])
    expect(attempts.filter((result) => result.ok)).toHaveLength(1)
    expect(attempts.filter((result) => !result.ok)).toHaveLength(1)
    expect((await inspectPublicV14(locks, first)).ok).toBe(true)
  })

  it('defers an airborne jump but saves its grounded landing in one checked batch', async () => {
    const store = createAtomicV14Store(new FakeFactory())
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const landed = await commitPublicV14FrameBatch(locks, store, [
      { intents: [{ type: 'jump' }], walkRequested: false },
      ...Array(25).fill({ intents: [], walkRequested: false }),
    ], 0, fresh.value.lineage)
    expect(landed.ok).toBe(true)
    if (!landed.ok) return
    expect(landed.value.start.state.player.verticalVelocity).toBe(0)
    expect(landed.value.start.state.tick).toBe(26)
    expect(await inspectPublicV14(locks, store)).toEqual({ ok: true,
      value: { status: 'valid', start: landed.value.start } })
  })

  it('blocks a mutated raw frame witness or forged end state on inspection', async () => {
    for (const mutate of [
      (head: { frameWitness: { frames: { intents: { delta: { x: number } }[] }[] } }) => {
        head.frameWitness.frames[0].intents[0].delta.x = 0.08
      },
      (head: { state: { player: { coins: number } } }) => { head.state.player.coins += 1 },
    ]) {
      const factory = new FakeFactory(), store = createAtomicV14Store(factory)
      const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
      if (!fresh.ok) throw new Error('Missing fresh v14')
      expect((await commitPublicV14FrameBatch(locks, store, [
        { intents: [{ type: 'move', delta: { x: 0.16, z: 0 } }], walkRequested: true },
      ], 0, fresh.value.lineage)).ok).toBe(true)
      const raw = await store.read()
      if (raw.status !== 'ok') throw new Error('Missing raw v14')
      const head = structuredClone((raw.head as { value: unknown }).value)
      mutate(head as never)
      await putRaw(factory, 'head', { saveRevision: 1, value: head })
      expect(await inspectPublicV14(locks, store)).toEqual({ ok: true,
        value: { status: 'blocked', reason: 'invalid-v14-history' } })
    }
  })

  it('persists streamed movement and both owner crossings across bounded batches', async () => {
    const store = createAtomicV14Store(new FakeFactory())
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const move = (x: number) => ({ intents: [{ type: 'move', delta: { x, z: 0 } }],
      walkRequested: true })
    const first = await commitPublicV14FrameBatch(locks, store,
      Array(128).fill(move(0.16)), 0, fresh.value.lineage)
    expect(first.ok, first.ok ? '' : first.reason).toBe(true)
    if (!first.ok) return
    expect(first.value.start.state.player.position.x).toBeCloseTo(20.48)
    const second = await commitPublicV14FrameBatch(locks, store, [
      ...Array(84).fill(move(0.16)), move(0.08), move(0.16),
    ], 1, fresh.value.lineage)
    expect(second.ok, second.ok ? '' : second.reason).toBe(true)
    if (!second.ok) return
    expect(second.value.start.state.movementOwner).toBe('streamed')
    expect(await inspectPublicV14(locks, store)).toEqual({ ok: true,
      value: { status: 'valid', start: second.value.start } })
    const returned = await commitPublicV14FrameBatch(locks, store,
      [move(0.16), move(-0.16), move(-0.16)], 2, fresh.value.lineage)
    expect(returned.ok, returned.ok ? '' : returned.reason).toBe(true)
    if (!returned.ok) return
    expect(returned.value.start.state.movementOwner).toBe('greenway')
    expect(returned.value.start.state.tick).toBe(217)
    expect(returned.value.start.state.player.position.x).toBeCloseTo(34)
    expect(await inspectPublicV14(locks, store)).toEqual({ ok: true,
      value: { status: 'valid', start: returned.value.start } })
    expect(await resumePublicV14(locks, store, 3, fresh.value.lineage))
      .toEqual({ ok: true, value: returned.value.start })
  }, 60_000)

  it.each([
    [BRIDGE_WORK, 'terrain_work_built', 8, 80],
    [LADDER_WORK, 'terrain_work_built', 4, 60],
    [DIG_WORK, 'terrain_work_dug', 0, 30],
  ] as const)('commits checked streamed work %s against an isolated valid fixture',
    async (id, eventType, logsSpent, xp) => {
      const { store, state, lineage } = await syntheticWorkRoot(new FakeFactory(), id)
      const pure = confirmPublicV14TerrainWork(state, id)
      expect(pure.candidate).toBeDefined()
      expect(await commitPublicV14Snapshot(locks, store, pure.candidate, 2, lineage))
        .toEqual({ ok: false, reason: 'action-required' })
      const saved = await commitPublicV14TerrainWork(locks, store, id, 2, lineage)
      expect(saved.ok).toBe(true)
      if (!saved.ok) return
      expect(saved.value.event).toMatchObject({ type: eventType, id, logsSpent, xp,
        tick: state.tick, sequence: state.eventSequence + 1 })
      expect(saved.value.start.state).toEqual(pure.candidate)
      expect(saved.value.start.saveRevision).toBe(3)
      expect(await inspectPublicV14(locks, store)).toEqual({ ok: true,
        value: { status: 'valid', start: saved.value.start } })
      expect(await resumePublicV14(locks, store, 3, lineage))
        .toEqual({ ok: true, value: saved.value.start })
    })

  it('rejects on-tile dig and stale or concurrent work commits without changing raw slots', async () => {
    const occupied = await syntheticWorkRoot(new FakeFactory(), DIG_WORK, true)
    const before = await occupied.store.read()
    expect(await commitPublicV14TerrainWork(locks, occupied.store, DIG_WORK, 2,
      occupied.lineage)).toEqual({ ok: false, reason: 'action-rejected' })
    expect(await occupied.store.read()).toEqual(before)
    const factory = new FakeFactory()
    const ready = await syntheticWorkRoot(factory, BRIDGE_WORK)
    const second = createAtomicV14Store(factory)
    const results = await Promise.all([
      commitPublicV14TerrainWork(locks, ready.store, BRIDGE_WORK, 2, ready.lineage),
      commitPublicV14TerrainWork(locks, second, BRIDGE_WORK, 2, ready.lineage),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
    expect(await commitPublicV14TerrainWork(locks, ready.store, BRIDGE_WORK, 2,
      ready.lineage)).toEqual({ ok: false, reason: 'revision-changed' })
  })

  it('blocks valid-shaped raw work with forged site, unspent logs or extra XP', async () => {
    for (const kind of ['site', 'logs', 'xp'] as const) {
      const factory = new FakeFactory()
      const { store, state, lineage } = await syntheticWorkRoot(factory, BRIDGE_WORK)
      const action = confirmPublicV14TerrainWork(state, BRIDGE_WORK)
      if (!action.candidate) throw new Error('Missing checked bridge candidate')
      let forged = structuredClone(action.candidate)
      if (kind === 'site') forged = { ...forged, terrainWorks: { ...forged.terrainWorks,
        builtWorkIds: [LADDER_WORK] } }
      if (kind === 'logs') forged.player.inventory.find((entry) => entry.itemId === 'logs')!.quantity += 1
      if (kind === 'xp') {
        forged.player.xp++
        forged.player.skillXp.construction++
      }
      expect(validatePublicV14State(forged, forged.seed), kind).not.toBeNull()
      const raw = await store.read()
      if (raw.status !== 'ok') throw new Error('Missing synthetic v14 records')
      await putRaw(factory, 'previous', raw.head)
      await putRaw(factory, 'head', { saveRevision: 3,
        value: encodePublicV14Head(forged, 3, lineage) })
      expect(await inspectPublicV14(locks, store)).toEqual({ ok: true,
        value: { status: 'blocked', reason: 'invalid-v14-history' } })
    }
  })

  it('allows one of two concurrent genesis calls and rejects stale revision CAS', async () => {
    const factory = new FakeFactory()
    const first = createAtomicV14Store(factory), second = createAtomicV14Store(factory)
    const outcomes = await Promise.all([
      startFreshPublicV14(locks, first, 'greenway-alpha'),
      startFreshPublicV14(locks, second, 'greenway-alpha'),
    ])
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1)
    const winner = outcomes.find((result) => result.ok)!
    if (!winner.ok) return
    const candidate = idle(winner.value)
    const saved = await commitPublicV14Snapshot(locks, first, candidate,
      winner.value.saveRevision, winner.value.lineage)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.value.saveRevision).toBe(1)
    expect(await commitPublicV14Snapshot(locks, second, candidate, 0, winner.value.lineage))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await resumePublicV14(locks, second, 0, winner.value.lineage))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await resumePublicV14(locks, second, 1,
      { ...winner.value.lineage, seed: 'forged' }))
      .toEqual({ ok: false, reason: 'lineage-changed' })
  })

  it('fails closed when caller lineage is a throwing Proxy on resume or save', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV14Store(factory)
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const hostile = new Proxy(fresh.value.lineage, {
      get() { throw new Error('caller getter must not run') },
    })
    await expect(Promise.resolve().then(() => resumePublicV14(locks, store, 0, hostile)))
      .resolves.toEqual({ ok: false, reason: 'invalid-expectation' })
    await expect(Promise.resolve().then(() => commitPublicV14Snapshot(locks, store,
      next(fresh), 0, hostile)))
      .resolves.toEqual({ ok: false, reason: 'invalid-expectation' })
  })

  it('treats a failed canonical genesis reconstruction during checked read as storage error', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV14Store(factory)
    expect((await startFreshPublicV14(locks, store, 'greenway-alpha')).ok).toBe(true)
    const spy = vi.spyOn(v14Snapshot, 'createFreshPublicV14Head').mockImplementationOnce(() => {
      throw new Error('injected reconstruction failure')
    })
    try { await expect(store.readChecked()).resolves.toEqual({ status: 'storage-error' }) }
    finally { spy.mockRestore() }
  })

  it('rolls back an aborted transaction and blocks malformed history slots', async () => {
    const factory = new FakeFactory()
    const store = createAtomicV14Store(factory)
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const before = await store.read()
    const original = FakeDatabase.prototype.transaction
    const spy = vi.spyOn(FakeDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase, names, mode, options) {
      const transaction = original.call(this, names, mode, options)
      if (mode === 'readwrite') queueMicrotask(() => transaction.abort())
      return transaction
    })
    try {
      expect(await commitPublicV14Snapshot(locks, store, idle(fresh.value), 0, fresh.value.lineage))
        .toEqual({ ok: false, reason: 'storage-error' })
    } finally { spy.mockRestore() }
    expect(await store.read()).toEqual(before)
    await putRaw(factory, 'previous', { saveRevision: 0, value: null })
    expect(await inspectPublicV14(locks, store)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v14-records' } })
    expect(await startFreshPublicV14(locks, store, 'greenway-alpha'))
      .toEqual({ ok: false, reason: 'invalid-v14-records' })
  })

  it('requires a checked D1 action to spend four logs and build the starter ladder', async () => {
    const store = createAtomicV14Store(new FakeFactory())
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const action = { type: 'build_route' as const, routeId: 'greenway_ladder' as const,
      siteId: STARTER_CLIFF_SITE_ID }
    const before = await store.read()
    expect(await commitPublicV14GreenwayAction(locks, store, action, 0, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'action-rejected' })
    expect(await store.read()).toEqual(before)

    const equipped = await commitPublicV14GreenwayAction(locks, store,
      { type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' },
      fresh.value.saveRevision, fresh.value.lineage)
    expect(equipped.ok).toBe(true)
    if (!equipped.ok) return
    const tree = equipped.value.start.state.greenway.resources.find((resource) =>
      resource.id === 'greenway-journey-tree-0')!
    let prepared = await walkNear(store, equipped.value.start, tree.position, 1.5)
    for (let hit = 0; hit < 2; hit++) {
      const harvested = await commitPublicV14GreenwayAction(locks, store,
        { type: 'harvest', resourceId: tree.id }, prepared.saveRevision, prepared.lineage)
      expect(harvested.ok).toBe(true)
      if (!harvested.ok) return
      prepared = harvested.value.start
    }
    expect(prepared.state.player.inventory).toContainEqual({ itemId: 'logs', quantity: 4 })
    const site = starterCliffCanonicalSite('greenway-alpha')
    prepared = await walkNear(store, prepared, site.from, 0.4)
    const forged = structuredClone(prepared.state)
    forged.greenway.builtRouteIds.push('greenway_ladder')
    forged.greenway.routes[0].siteId = STARTER_CLIFF_SITE_ID
    forged.player.xp += 60
    forged.player.skillXp.construction += 60
    expect(await commitPublicV14Snapshot(locks, store, forged, prepared.saveRevision,
      fresh.value.lineage))
      .toEqual({ ok: false, reason: 'action-required' })
    const built = await commitPublicV14GreenwayAction(locks, store, action, prepared.saveRevision,
      fresh.value.lineage)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.value.start.saveRevision).toBe(prepared.saveRevision + 1)
    expect(built.value.start.state.greenway.builtRouteIds).toContain('greenway_ladder')
    expect(built.value.start.state.player.inventory.some((stack) => stack.itemId === 'logs'))
      .toBe(false)
    expect(built.value.events.some((event) => event.type === 'route_built')).toBe(true)
    expect(await resumePublicV14(locks, store, built.value.start.saveRevision, fresh.value.lineage)).toEqual({ ok: true,
      value: built.value.start })
    expect(await commitPublicV14GreenwayAction(locks, store, action, prepared.saveRevision,
      fresh.value.lineage)).toEqual({ ok: false, reason: 'revision-changed' })
    const ladderFoot = await walkNear(store, built.value.start, { x: 0, z: -5.35 }, 0.04)
    const up = await saveFrame(store, ladderFoot, [{ type: 'move', delta: { x: 0, z: -0.1 } }])
    expect(up.state.player.position.y).toBeGreaterThan(ladderFoot.state.player.position.y)
    const down = await saveFrame(store, up, [{ type: 'move', delta: { x: 0, z: 0.1 } }])
    expect(down.state.player.position.y).toBeLessThan(up.state.player.position.y)
    expect(await resumePublicV14(locks, store, down.saveRevision, down.lineage))
      .toEqual({ ok: true, value: down })
  }, 30_000)

  it('keeps generic saves from introducing streamed ownership or terrain work', async () => {
    const store = createAtomicV14Store(new FakeFactory())
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const point = { x: 34.001, z: 0 }
    const surface = resolvePublicV14Surface(fresh.value.state, point)!
    const streamed = next(fresh)
    streamed.movementOwner = 'streamed'
    streamed.player.position = { ...point, y: surface.floorY }
    const bit = encodeDiscoveredTileIds([surface.tileId])
    for (let index = 0; index < bit.length; index++) streamed.discoveryMask[index] |= bit[index]
    expect(await commitPublicV14Snapshot(locks, store, streamed, 0, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'boundary-required' })
    const work = next(fresh)
    work.terrainWorks = { builtWorkIds: [], dugTileIds: ['tile--64-76'] }
    work.player.xp = 30
    work.player.skillXp.excavation = 30
    expect(await commitPublicV14Snapshot(locks, store, work, 0, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'action-required' })
    expect((await store.read() as { head: { saveRevision: number } }).head.saveRevision).toBe(0)
  })

  it('rejects non-replayed raw owner, ladder and boots history on inspection', async () => {
    for (const kind of ['owner', 'ladder', 'boots'] as const) {
      const store = createAtomicV14Store(new FakeFactory())
      const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
      if (!fresh.ok) throw new Error('Missing fresh v14')
      const candidate = { ...structuredClone(fresh.value.state), tick: 1 }
      if (kind === 'owner') {
        const point = { x: 34.001, z: 0 }
        const surface = resolvePublicV14Surface(candidate, point)!
        candidate.movementOwner = 'streamed'
        candidate.player.position = { ...point, y: surface.floorY }
        const bit = encodeDiscoveredTileIds([surface.tileId])
        for (let index = 0; index < bit.length; index++) candidate.discoveryMask[index] |= bit[index]
      } else if (kind === 'ladder') {
        candidate.greenway = { ...candidate.greenway,
          builtRouteIds: ['greenway_ladder'],
          routes: candidate.greenway.routes.map((route) => route.id === 'greenway_ladder'
            ? { ...route, siteId: STARTER_CLIFF_SITE_ID } : route) }
        candidate.player.xp = 60
        candidate.player.skillXp.construction = 60
      } else {
        candidate.player.coins -= PUBLIC_V11_BOOTS_PRICE
        candidate.player.inventory.push({ itemId: 'leather_boots', quantity: 1 })
      }
      const forged = encodePublicV14Head(candidate, 1, fresh.value.lineage)
      const read = await store.readChecked()
      if (read.status !== 'ok' || !read.proof) throw new Error('Missing v14 proof')
      expect(await store.commit(0, fresh.value.lineage,
        { saveRevision: 1, value: forged }, undefined, read.proof)).toBe('committed')
      expect(await inspectPublicV14(locks, store)).toEqual({ ok: true,
        value: { status: 'blocked', reason: 'invalid-v14-history' } })
    }
  })

  it('bounds same-owner displacement by elapsed 50 ms frames', async () => {
    const store = createAtomicV14Store(new FakeFactory())
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const teleport = next(fresh)
    teleport.player.position = { x: 4, y: starterCliffSupportAt({ seed: teleport.seed,
      profile: teleport.generationProfile, route: teleport.greenway.routes[0],
      built: false }, { x: 4, z: 0 })!.floorY, z: 0 }
    expect(await commitPublicV14Snapshot(locks, store, teleport, 0, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'invalid-v14-history' })
  })

  it('rejects valid-shaped but unreplayed gameplay facts in generic saves and raw history', async () => {
    const mutators = {
      logs: (state: ReturnType<typeof next>) => state.player.inventory.push(
        { itemId: 'logs', quantity: 4 }),
      axe: (state: ReturnType<typeof next>) => { state.player.equipment.mainHand = 'woodcutters_axe' },
      coins: (state: ReturnType<typeof next>) => { state.player.coins += 100 },
      xp: (state: ReturnType<typeof next>) => {
        state.player.xp += 20
        state.player.skillXp.woodcutting += 20
      },
      resource: (state: ReturnType<typeof next>) => {
        state.greenway.resources[0].health = 0
        state.greenway.resources[0].depleted = true
      },
      stock: (state: ReturnType<typeof next>) => { state.greenway.stores[0].listings[0].stock -= 1 },
    }
    for (const [name, mutate] of Object.entries(mutators)) {
      const factory = new FakeFactory(), store = createAtomicV14Store(factory)
      const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
      if (!fresh.ok) throw new Error('Missing fresh v14')
      const candidate = next(fresh)
      mutate(candidate)
      expect(validatePublicV14State(candidate, 'greenway-alpha'), name).not.toBeNull()
      const attempted = await commitPublicV14Snapshot(locks, store, candidate, 0,
        fresh.value.lineage)
      expect(attempted.ok, name).toBe(false)
      const forged = encodePublicV14Head(candidate, 1, fresh.value.lineage)
      await putRaw(factory, 'previous', { saveRevision: 0,
        value: createFreshPublicV14Head('greenway-alpha').head })
      await putRaw(factory, 'head', { saveRevision: 1, value: forged })
      const inspected = await inspectPublicV14(locks, store)
      expect(inspected.ok && inspected.value.status === 'blocked', name).toBe(true)
    }
  })

  it('rejects a 0.24 m unsupported Greenway seam hop in raw head history', async () => {
    const factory = new FakeFactory(), store = createAtomicV14Store(factory)
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const context = { seed: 'greenway-alpha', profile: fresh.value.state.generationProfile,
      route: fresh.value.state.greenway.routes[0], built: false }
    const high = { x: 0.8, z: -6.12 }, low = { x: 0.8, z: -5.88 }
    const before = { ...structuredClone(fresh.value.state), tick: 100, eventSequence: 100 }
    before.player.position = { ...high, y: starterCliffSupportAt(context, high)!.floorY }
    const after = { ...structuredClone(before), tick: 101, eventSequence: 101 }
    after.player.position = { ...low, y: starterCliffSupportAt(context, low)!.floorY }
    expect(starterCliffAdvanceMove(context, before.player.position, low, 0).accepted).toBe(false)
    expect(validatePublicV14State(before, before.seed)).not.toBeNull()
    expect(validatePublicV14State(after, after.seed)).not.toBeNull()
    await putRaw(factory, 'previous', { saveRevision: 1,
      value: encodePublicV14Head(before, 1, fresh.value.lineage) })
    await putRaw(factory, 'head', { saveRevision: 2,
      value: encodePublicV14Head(after, 2, fresh.value.lineage) })
    const inspected = await inspectPublicV14(locks, store)
    expect(inspected.ok && inspected.value.status === 'blocked').toBe(true)
  })

  it('rejects the same unsupported seam hop through generic save', async () => {
    const store = createAtomicV14Store(new FakeFactory())
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const low = { x: 0.8, z: -5.88 }, high = { x: 0.8, z: -6.12 }
    let current = await walkNear(store, fresh.value, low, 0.05)
    current = await saveFrame(store, current, [{ type: 'move', delta: {
      x: low.x - current.state.player.position.x,
      z: low.z - current.state.player.position.z } }])
    const context = { seed: current.state.seed, profile: current.state.generationProfile,
      route: current.state.greenway.routes[0], built: false }
    expect(starterCliffAdvanceMove(context, current.state.player.position, high, 0).accepted)
      .toBe(false)
    const candidate = idle(current)
    candidate.player.position = { ...high, y: starterCliffSupportAt(context, high)!.floorY }
    expect(validatePublicV14State(candidate, candidate.seed)).not.toBeNull()
    expect(await commitPublicV14Snapshot(locks, store, candidate, current.saveRevision,
      current.lineage)).toEqual({ ok: false, reason: 'invalid-v14-history' })
  }, 30_000)

  it('accepts boots purchase and feet changes only through checked D1 actions', async () => {
    const store = createAtomicV14Store(new FakeFactory())
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const shop = fresh.value.state.greenway.stores.find((entry) => entry.id === 'store-greenway')!
    const prepared = await walkNear(store, fresh.value, shop.position, 1.5)
    const purchase = { type: 'buy_store_listing' as const, storeId: 'store-greenway',
      listingId: PUBLIC_V11_BOOTS_LISTING_ID }
    const forged = { ...structuredClone(prepared.state), tick: prepared.state.tick + 1,
      player: { ...structuredClone(prepared.state.player),
        coins: prepared.state.player.coins - PUBLIC_V11_BOOTS_PRICE,
        inventory: [...prepared.state.player.inventory,
          { itemId: 'leather_boots' as const, quantity: 1 }] } }
    expect(await commitPublicV14Snapshot(locks, store, forged, prepared.saveRevision,
      fresh.value.lineage))
      .toEqual({ ok: false, reason: 'action-required' })
    const debitOnly = { ...structuredClone(prepared.state), tick: prepared.state.tick + 1 }
    debitOnly.player.coins -= PUBLIC_V11_BOOTS_PRICE
    expect(await commitPublicV14Snapshot(locks, store, debitOnly, prepared.saveRevision,
      fresh.value.lineage))
      .toEqual({ ok: false, reason: 'action-required' })
    const bought = await commitPublicV14GreenwayAction(locks, store, purchase,
      prepared.saveRevision,
      fresh.value.lineage)
    expect(bought.ok).toBe(true)
    if (!bought.ok) return
    expect(bought.value.start.state.player.coins).toBe(120 - PUBLIC_V11_BOOTS_PRICE)
    expect(bought.value.start.state.player.inventory).toContainEqual({ itemId: 'leather_boots',
      quantity: 1 })
    expect(bought.value.events.some((event) => event.type === 'store_item_bought')).toBe(true)
    const forgedFeet = { ...structuredClone(bought.value.start.state),
      tick: bought.value.start.state.tick + 1 }
    forgedFeet.player.equipment.feet = 'leather_boots'
    expect(await commitPublicV14Snapshot(locks, store, forgedFeet,
      bought.value.start.saveRevision, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'action-required' })
    const equipped = await commitPublicV14GreenwayAction(locks, store,
      { type: 'equip_item', itemId: 'leather_boots', slot: 'feet' },
      bought.value.start.saveRevision, fresh.value.lineage)
    expect(equipped.ok).toBe(true)
    if (!equipped.ok) return
    expect(equipped.value.start.state.player.equipment.feet).toBe('leather_boots')
    const unequipped = await commitPublicV14GreenwayAction(locks, store,
      { type: 'unequip_item', slot: 'feet' }, equipped.value.start.saveRevision,
      fresh.value.lineage)
    expect(unequipped.ok).toBe(true)
    if (!unequipped.ok) return
    expect(unequipped.value.start.state.player.equipment.feet).toBeNull()
    expect(await resumePublicV14(locks, store, unequipped.value.start.saveRevision,
      fresh.value.lineage)).toEqual({ ok: true,
      value: unequipped.value.start })
  }, 30_000)

  it('buys and equips the canonical field spade through checked Greenway actions', async () => {
    const store = createAtomicV14Store(new FakeFactory())
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const prepared = await walkNear(store, fresh.value, fresh.value.state.greenway.stores[0].position, 1.5)
    const purchase = { type: 'buy_store_listing' as const, storeId: 'store-greenway',
      listingId: 'spade' }
    const pure = advancePublicV14GreenwayAction(prepared.state, purchase)
    expect(pure.rejections).toEqual([])
    expect(await commitPublicV14Snapshot(locks, store, pure.state, prepared.saveRevision,
      prepared.lineage)).toEqual({ ok: false, reason: 'action-required' })
    const bought = await commitPublicV14GreenwayAction(locks, store, purchase,
      prepared.saveRevision, prepared.lineage)
    expect(bought.ok).toBe(true)
    if (!bought.ok) return
    expect(bought.value.start.state).toEqual(pure.state)
    expect(bought.value.start.state.player.coins).toBe(102)
    expect(bought.value.start.state.player.inventory).toContainEqual({ itemId: 'field_spade', quantity: 1 })
    expect(bought.value.start.state.greenway.stores[0].listings.find((entry) =>
      entry.id === 'spade')?.stock).toBe(2)
    const equipped = await commitPublicV14GreenwayAction(locks, store,
      { type: 'equip_item', itemId: 'field_spade', slot: 'mainHand' },
      bought.value.start.saveRevision, prepared.lineage)
    expect(equipped.ok).toBe(true)
    if (!equipped.ok) return
    expect(equipped.value.start.state.player.equipment.mainHand).toBe('field_spade')
    expect(await resumePublicV14(locks, store, equipped.value.start.saveRevision,
      prepared.lineage)).toEqual({ ok: true, value: equipped.value.start })
  }, 30_000)

  it('sells only carried stone through checked action replay and CAS', async () => {
    const factory = new FakeFactory()
    const { store, state, lineage } = await syntheticStoneRoot(factory)
    const intent = { type: 'sell_to_store' as const, storeId: 'store-greenway',
      itemId: 'stone' as const, quantity: 2 }
    const pure = advancePublicV14GreenwayAction(state, intent)
    expect(pure.rejections).toEqual([])
    expect(await commitPublicV14Snapshot(locks, store, pure.state, 2, lineage))
      .toEqual({ ok: false, reason: 'action-required' })
    const raw = await store.read()
    if (raw.status !== 'ok') throw new Error('Missing stone fixture records')
    for (const kind of ['price', 'quantity'] as const) {
      const forged = structuredClone(pure.state)
      if (kind === 'price') forged.player.coins++
      else forged.player.inventory.find((stack) => stack.itemId === 'stone')!.quantity++
      expect(validatePublicV14State(forged, forged.seed)).not.toBeNull()
      await putRaw(factory, 'previous', raw.head)
      await putRaw(factory, 'head', { saveRevision: 3,
        value: encodePublicV14Head(forged, 3, lineage) })
      expect(await inspectPublicV14(locks, store)).toEqual({ ok: true,
        value: { status: 'blocked', reason: 'invalid-v14-history' } })
    }
    await putRaw(factory, 'previous', raw.previous)
    await putRaw(factory, 'head', raw.head)
    const second = createAtomicV14Store(factory)
    const attempts = await Promise.all([
      commitPublicV14GreenwayAction(locks, store, intent, 2, lineage),
      commitPublicV14GreenwayAction(locks, second, intent, 2, lineage),
    ])
    expect(attempts.filter((result) => result.ok)).toHaveLength(1)
    const winner = attempts.find((result) => result.ok)!
    if (!winner.ok) return
    expect(winner.value.start.state).toEqual(pure.state)
    expect(winner.value.events).toContainEqual(expect.objectContaining({ type: 'store_item_sold',
      quantity: 2, totalPrice: 2 }))
    expect(winner.value.start.state.player.coins).toBe(122)
    expect(winner.value.start.state.player.inventory).toContainEqual({ itemId: 'stone', quantity: 1 })
    expect(await commitPublicV14GreenwayAction(locks, store, intent, 2, lineage))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await inspectPublicV14(locks, store)).toEqual({ ok: true,
      value: { status: 'valid', start: winner.value.start } })
  })

  it('rejects forged raw spade stock, price, inventory and stone material deltas', async () => {
    const factory = new FakeFactory(), store = createAtomicV14Store(factory)
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const prepared = await walkNear(store, fresh.value, fresh.value.state.greenway.stores[0].position, 1.5)
    const pure = advancePublicV14GreenwayAction(prepared.state,
      { type: 'buy_store_listing', storeId: 'store-greenway', listingId: 'spade' })
    expect(pure.rejections).toEqual([])
    const raw = await store.read()
    if (raw.status !== 'ok') throw new Error('Missing v14 head')
    for (const kind of ['stock', 'coins', 'spade', 'stone'] as const) {
      const forged = structuredClone(pure.state)
      if (kind === 'stock') forged.greenway.stores[0].listings.find((entry) =>
        entry.id === 'spade')!.stock--
      if (kind === 'coins') forged.player.coins++
      if (kind === 'spade') forged.player.inventory = forged.player.inventory.filter((entry) =>
        entry.itemId !== 'field_spade')
      if (kind === 'stone') forged.player.inventory.push({ itemId: 'stone', quantity: 1 })
      expect(validatePublicV14State(forged, forged.seed), kind).not.toBeNull()
      await putRaw(factory, 'previous', raw.head)
      await putRaw(factory, 'head', { saveRevision: prepared.saveRevision + 1,
        value: encodePublicV14Head(forged, prepared.saveRevision + 1, prepared.lineage) })
      expect(await inspectPublicV14(locks, store)).toEqual({ ok: true,
        value: { status: 'blocked', reason: 'invalid-v14-history' } })
    }
  }, 30_000)

  it('replays a look plus move and an identical no-op without granting gameplay facts', async () => {
    const store = createAtomicV14Store(new FakeFactory())
    const fresh = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!fresh.ok) throw new Error('Missing fresh v14')
    const moved = await saveFrame(store, fresh.value, [
      { type: 'look', yawDelta: 0.2, pitchDelta: 0.1 },
      { type: 'move', delta: { x: 0.1, z: 0 } },
    ])
    expect(moved.state.player.position.x).toBeGreaterThan(fresh.value.state.player.position.x)
    expect(moved.state.player.yaw).toBeCloseTo(0.2)
    const saved = await commitPublicV14Snapshot(locks, store, structuredClone(moved.state),
      moved.saveRevision, moved.lineage)
    expect(saved).toEqual({ ok: true, value: { ...moved, saveRevision: moved.saveRevision + 1 } })
    expect(await inspectPublicV14(locks, store)).toEqual({ ok: true,
      value: { status: 'valid', start: saved.ok ? saved.value : undefined } })
  })

  it('preserves and replays a preexisting v13 database root byte for byte', async () => {
    const factory = new FakeFactory()
    const legacy = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
      withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1')))))
    const lineage = { sourceSchemaVersion: PUBLIC_V11_SCHEMA,
      sourceHead: encodePublicV11Head(legacy, null, 0) }
    const oldHead = createPublicV13MigrationHead(lineage)!
    const oldStore = createAtomicV13Store(factory)
    const empty = await oldStore.readChecked()
    if (empty.status !== 'ok' || !empty.proof) throw new Error('Missing v13 empty proof')
    expect(await oldStore.commit(null, null, { saveRevision: 0, value: oldHead }, lineage,
      empty.proof)).toBe('committed')
    const before = await oldStore.read()
    expect(before.status).toBe('ok')
    const v14 = createAtomicV14Store(factory)
    const fresh = await startFreshPublicV14(locks, v14, 'greenway-alpha')
    expect(fresh.ok).toBe(true)
    if (!fresh.ok) return
    const batch = await commitPublicV14FrameBatch(locks, v14,
      [{ intents: [], walkRequested: false }], 0, fresh.value.lineage)
    expect(batch.ok).toBe(true)
    if (!batch.ok) return
    const near = await walkNear(v14, batch.value.start,
      fresh.value.state.greenway.stores[0].position, 1.5)
    expect((await commitPublicV14GreenwayAction(locks, v14,
      { type: 'buy_store_listing', storeId: 'store-greenway', listingId: 'spade' },
      near.saveRevision, near.lineage)).ok).toBe(true)
    const workState = syntheticWorkState(fresh.value.state, BRIDGE_WORK)
    await putRaw(factory, 'previous', { saveRevision: 1,
      value: encodePublicV14Head(workState, 1, fresh.value.lineage) })
    await putRaw(factory, 'head', { saveRevision: 2,
      value: encodePublicV14Head(workState, 2, fresh.value.lineage) })
    expect((await commitPublicV14TerrainWork(locks, v14, BRIDGE_WORK, 2,
      fresh.value.lineage)).ok).toBe(true)
    const after = await oldStore.read()
    expect(after).toEqual(before)
    if (after.status !== 'ok') return
    expect(decodePublicV13Head((after.head as { value: unknown }).value, after.lineage))
      .toEqual(oldHead)
    expect((await factory.databases()).map((entry) => entry.name).sort())
      .toEqual(['wizard-realms:world:v13', 'wizard-realms:world:v14'])
  }, 30_000)
})
