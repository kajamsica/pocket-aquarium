import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import './atomicV41Database'
import { createAtomicV43Store } from './atomicV43Database'
import { createAtomicV44PromotionStore } from './atomicV44Promotion'
import { createAtomicV45Store, PUBLIC_V45_DATABASE_NAME } from './atomicV45Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { MIREGLASS_RING_ID, mireglassAnchors, mireglassFairyRing } from './mireglassContent'
import { createFreshPublicV42Root, decodePublicV42Root, PUBLIC_V42_SCHEMA }
  from './publicWorldV42Snapshot'
import type { PublicV42Root } from './publicWorldV42Snapshot'
import { createFreshPublicV43Root, createPublicV43Root,
  decodePublicV43CheckedSuccessor, decodePublicV43Root, replayPublicV43Witness,
  PUBLIC_V43_SCHEMA } from './publicWorldV43Snapshot'
import type { PublicV43Root } from './publicWorldV43Snapshot'
import { confirmPublicV44GroundMountAction } from './publicWorldV44GroundMount'
import { createPublicV44Root, decodePublicV44Root, PUBLIC_V44_DATABASE_NAME,
  PUBLIC_V44_SCHEMA } from './publicWorldV44Snapshot'
import type { PublicV44Root } from './publicWorldV44Snapshot'
import { createPublicV45Genesis, PUBLIC_V45_SCHEMA } from './publicWorldV45Migration'
import * as v45Migration from './publicWorldV45Migration'
import { confirmPublicV45Action } from './publicWorldV45RideAction'
import { decodePublicV45Root } from './publicWorldV45Snapshot'
import type { PublicV45Root } from './publicWorldV45Snapshot'
import { commitPublicV45, inspectPublicV45, resumePublicV45,
  requestPublicV45ReturnHome, startPublicV45 } from './publicWorldV45Flow'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'
import { waystationRiverSite } from './waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const ride = { kind: 'sedgehorn-assisted-ride-frame/v1' as const,
  intents: [{ type: 'move' as const, delta: { x: 0.2, z: 0 } }] as const }
const idle = { kind: 'frame-batch/v1' as const,
  frames: [{ intents: [], walkRequested: true }] }
const locks = { request: async <T>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>): Promise<T> => body() }

function eligibleSource(): PublicV42Root {
  const fresh = createFreshPublicV42Root(seed)
  const site = resolveSedgehornFamiliarSite(fresh.head)!
  const bridge = waystationRiverSite(seed)!
  const nearby: string[] = []
  for (const tile of [site.tracks, site.shelter, site.dryApproach, site.keeper]) {
    const gx = Math.round(tile.center.x / WORLD_CELL_METERS)
    const gz = Math.round(tile.center.z / WORLD_CELL_METERS)
    for (let x = gx - 1; x <= gx + 1; x++)
      for (let z = gz - 1; z <= gz + 1; z++)
        nearby.push(worldTileAtGrid(seed, x, z).id)
  }
  const genesis = { ...fresh.lineage.genesis, southbankReached: true,
    riverBridgeIds: [bridge.id], state: { ...fresh.head.state,
      tick: 1300, eventSequence: 10, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(fresh.head.state.discoveryMask),
        ...bridge.footprintTileIds, ...nearby,
      ])].sort()), player: { ...fresh.head.state.player,
        position: { ...site.keeper.center }, verticalVelocity: 0 } } }
  const source: PublicV42Root = { lineage: { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed, sourceRevision: 4, genesis },
    previous: null, head: { ...structuredClone(genesis),
      schemaVersion: PUBLIC_V42_SCHEMA, saveRevision: 0, witness: null } }
  if (!decodePublicV42Root(source)) throw new Error('Invalid V42 fixture')
  return source
}

function matureRoot(): PublicV43Root {
  let root = createPublicV43Root(eligibleSource())
  for (let i = 0; i < 3; i++) {
    const progress = replayPublicV43Witness(root.head, idle)!
    root = decodePublicV43CheckedSuccessor(root, { lineage: root.lineage,
      previous: root.head, head: { ...progress, schemaVersion: PUBLIC_V43_SCHEMA,
        saveRevision: root.head.saveRevision + 1, witness: idle } })!
  }
  const site = resolveSedgehornFamiliarSite(root.head)!
  const careWitnesses = [0, 600, 1200].map((tick, index) => ({
    kind: 'sedgehorn-care/v1' as const, tick, eventSequence: index + 1 }))
  const claimed = (head: PublicV43Root['head']) => ({ ...head,
    familiar: { ...head.familiar, phase: 'claimed' as const,
      routeChoice: 'shelter' as const, position: { ...site.keeper.center },
      trust: 2, creatureCareXp: 40, stationKnown: true },
    mountTraining: { careWitnesses },
    greenwayOrder: { claimedAtSequence: null },
    greenwayBagUpgrade: { claimedAtSequence: null },
    state: { ...head.state, player: { ...head.state.player,
      position: { ...site.keeper.center },
      inventory: [...head.state.player.inventory,
        { itemId: 'leather_boots' as const, quantity: 1 }],
      equipment: { ...head.state.player.equipment, feet: 'leather_boots' as const },
      coins: head.state.player.coins + 25, xp: head.state.player.xp + 40,
      level: 1 + Math.floor((head.state.player.xp + 40) / 100) } } })
  const checked = decodePublicV43Root({ ...root,
    previous: claimed(root.previous!), head: claimed(root.head) })
  if (!checked) throw new Error('Invalid mature V43 fixture')
  return checked
}

let mountedCache: PublicV44Root | undefined
function mountedV44Root(): PublicV44Root {
  if (!mountedCache) {
    const parked = createPublicV44Root(matureRoot())
    const witness = { kind: 'sedgehorn-mount/v1' as const }
    const mounted = confirmPublicV44GroundMountAction({ v43: parked.head.v43,
      groundMount: parked.head.groundMount }, witness).progress
    if (!mounted) throw new Error('Invalid V44 mount fixture')
    mountedCache = decodePublicV44Root({ lineage: parked.lineage,
      previous: parked.head, head: { ...mounted,
        schemaVersion: PUBLIC_V44_SCHEMA, saveRevision: 1, witness } }) ?? undefined
    if (!mountedCache) throw new Error('Invalid mounted V44 fixture')
  }
  return structuredClone(mountedCache)
}

function trappedV44Root(): PublicV44Root {
  const source = matureRoot()
  const point = { x: 12, z: 4 }
  const support = publicV17StarterSupportAt({ seed,
    profile: source.head.state.generationProfile,
    route: source.head.state.greenway.routes.find((entry) =>
      entry.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: source.head.greenwayWorks }, point)
  if (!support || support.kind !== 'ground') throw new Error('Missing pit floor')
  const trapped = (head: PublicV43Root['head']) => ({ ...head,
    terrain: { ...head.terrain, columns: [{ gx: 3, gz: 1,
      openDepth: 8, rewardDepth: 8, pitLadder: false }] },
    state: { ...head.state, movementOwner: 'greenway' as const,
      player: { ...head.state.player, verticalVelocity: 0,
        position: { ...point, y: support.floorY } } } })
  const checked = decodePublicV43Root({ ...source,
    previous: trapped(source.previous!), head: trapped(source.head) })
  if (!checked) throw new Error('Invalid trapped V43 fixture')
  return createPublicV44Root(checked)
}

function saleV44Root(): PublicV44Root {
  const root = matureRoot()
  const salvager = mireglassAnchors(seed).salvager.tile
  const atSalvager = (head: PublicV43Root['head']) => ({ ...head,
    state: { ...head.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(head.state.discoveryMask), salvager.id])].sort()),
      player: { ...head.state.player, position: { ...salvager.center },
        inventory: [...head.state.player.inventory,
          { itemId: 'marsh_herb' as const, quantity: 3 }] } } })
  const checked = decodePublicV43Root({ ...root,
    previous: atSalvager(root.previous!), head: atSalvager(root.head) })
  if (!checked) throw new Error('Invalid sale V43 fixture')
  return createPublicV44Root(checked)
}

/** Checked retained pair after maturation and travel edges have aged out. */
function purchaseReadyRoot(): PublicV45Root {
  const root = matureRoot()
  const store = root.head.state.greenway.stores.find(({ id }) => id === 'store-greenway')!
  const ring = root.head.state.greenway.fairyRings.find(({ id }) => id === 'ring-greenway')!
  const ringTile = worldTileAtGrid(seed, Math.ceil(ring.position.x / WORLD_CELL_METERS - .5),
    Math.ceil(ring.position.z / WORLD_CELL_METERS - .5))
  const mireRing = mireglassFairyRing(seed).tile
  const prepared = (head: PublicV43Root['head']) => ({ ...head,
    mountTraining: { careWitnesses: head.mountTraining!.careWitnesses.slice(0, 2) },
    state: { ...head.state, movementOwner: 'greenway' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(head.state.discoveryMask), ringTile.id,
        mireRing.id])].sort()),
      player: { ...head.state.player, position: { ...store.position }, coins: 300,
        discoveredRingIds: ['ring-greenway', MIREGLASS_RING_ID] } } })
  const imported = decodePublicV43Root({ ...root,
    previous: prepared(root.previous!), head: prepared(root.head) })
  if (!imported) throw new Error('Invalid purchase V43 fixture')
  const genesis = createPublicV45Genesis(createPublicV44Root(imported))
  if (genesis.head.tack !== 'not_owned') throw new Error('Expected unowned V45 genesis')
  const care = { kind: 'sedgehorn-care/v1' as const,
    tick: genesis.head.state.tick, eventSequence: genesis.head.state.eventSequence + 1 }
  const previous = { ...genesis.head, saveRevision: 3, witness: idle,
    mountTraining: { careWitnesses: [...genesis.head.mountTraining!.careWitnesses, care] },
    state: { ...genesis.head.state, eventSequence: care.eventSequence } }
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...flat } = previous
  const progress = confirmPublicV45Action(flat, idle).progress
  const ready = progress && decodePublicV45Root({ lineage: genesis.lineage, previous,
    head: { ...progress, schemaVersion: PUBLIC_V45_SCHEMA,
      saveRevision: 4, witness: idle } })
  if (!ready) throw new Error('Invalid retained purchase V45 fixture')
  return ready
}

function open(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function record(factory: IDBFactory, name: string, key: string,
  next?: unknown): Promise<unknown> {
  const db = await open(factory, name)
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('records', next === undefined ? 'readonly' : 'readwrite')
      const records = tx.objectStore('records')
      const request = next === undefined ? records.get(key) : records.put(next, key)
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}

async function setup(root: PublicV44Root = createPublicV44Root(
  createFreshPublicV43Root(seed))) {
  const factory = new IDBFactory()
  await record(factory, PUBLIC_V44_DATABASE_NAME, 'root', root)
  return { factory, root, source: createAtomicV44PromotionStore(factory),
    store: createAtomicV45Store(factory) }
}

describe('V45 fenced source-only flow', () => {
  it('rejects client Return Home timestamps and a nontrapped request', async () => {
    const { factory, source, store } = await setup()
    const started = await startPublicV45(locks, store, source, 0)
    if (!started.ok) throw new Error(started.reason)
    const old = JSON.stringify(await record(factory, PUBLIC_V44_DATABASE_NAME, 'root'))
    expect(await commitPublicV45(locks, store, source, 0,
      started.value.lineage, { kind: 'return-home/v1', atMs: 10 } as never))
      .toEqual({ ok: false, reason: 'invalid-witness' })
    expect(await requestPublicV45ReturnHome(locks, store, source, 0,
      started.value.lineage)).toEqual({ ok: false, reason: 'not_trapped' })
    expect(JSON.stringify(await record(factory, PUBLIC_V44_DATABASE_NAME, 'root')))
      .toBe(old)
    expect((await store.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0 } } })
  })

  it('mints, replays, reloads, and cools down a trapped Return Home', async () => {
    const { factory, source, store } = await setup(trappedV44Root())
    const started = await startPublicV45(locks, store, source, 0)
    if (!started.ok) throw new Error(started.reason)
    const old = JSON.stringify(await record(factory, PUBLIC_V44_DATABASE_NAME, 'root'))
    const marker = await record(factory, PUBLIC_V44_DATABASE_NAME, 'v45-successor')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    try {
      const saved = await requestPublicV45ReturnHome(locks, store, source, 0,
        started.value.lineage)
      if (!saved.ok) throw new Error(saved.reason)
      expect(saved.value.head.witness).toEqual({ kind: 'return-home/v1', atMs: 10_000 })
      expect(saved.value.head.nextHomeAtMs).toBe(1_810_000)
      expect(saved.value.head.state.player.position).toMatchObject({ x: 0, z: 0 })
      expect(saved.value.head.groundMount.mode).toBe('parked')
      expect(await resumePublicV45(locks, createAtomicV45Store(factory), source, 1,
        started.value.lineage)).toEqual({ ok: true, value: {
          head: saved.value.head, lineage: saved.value.lineage } })
      expect(await requestPublicV45ReturnHome(locks, store, source, 1,
        started.value.lineage)).toEqual({ ok: false, reason: 'cooldown' })
      expect(await commitPublicV45(locks, store, source, 1,
        started.value.lineage, { kind: 'return-home/v1', atMs: 2_000_000 } as never))
        .toEqual({ ok: false, reason: 'invalid-witness' })
      expect(JSON.stringify(await record(factory, PUBLIC_V44_DATABASE_NAME, 'root')))
        .toBe(old)
      expect(await record(factory, PUBLIC_V44_DATABASE_NAME, 'v45-successor'))
        .toEqual(marker)
    } finally { clock.mockRestore() }
  }, 30_000)

  it('requires dismounting before Return Home', async () => {
    const { source, store } = await setup(mountedV44Root())
    const started = await startPublicV45(locks, store, source, 1)
    if (!started.ok) throw new Error(started.reason)
    expect(await requestPublicV45ReturnHome(locks, store, source, 0,
      started.value.lineage)).toEqual({ ok: false, reason: 'must-dismount' })
    expect((await store.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0 } } })
  }, 30_000)

  it('inspects without reservation, starts checked genesis, and resumes a fenced save', async () => {
    const { factory, root, source, store } = await setup()
    const ancestor = createAtomicV43Store(factory)
    const missing = await ancestor.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected empty V43 database')
    expect(await ancestor.commit(missing.proof, root.lineage.source)).toBe('committed')
    const v44Bytes = JSON.stringify(await record(factory, PUBLIC_V44_DATABASE_NAME, 'root'))
    expect(await inspectPublicV45(locks, store, source)).toEqual({ ok: true,
      value: { status: 'migration-available', sourceRevision: 0 } })
    expect((await source.readForPromotion())).toMatchObject({ status: 'valid', marker: null })
    expect(await record(factory, PUBLIC_V45_DATABASE_NAME, 'root')).toBeUndefined()
    expect(await startPublicV45(locks, store, source, 1)).toEqual({ ok: false,
      reason: 'source-revision-changed' })
    const started = await startPublicV45(locks, store, source, 0)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.value.head.saveRevision).toBe(0)
    expect((await source.readForPromotion())).toMatchObject({ status: 'valid',
      marker: { phase: 'finalized', sourceRevision: 0 } })
    expect(JSON.stringify(await record(factory, PUBLIC_V44_DATABASE_NAME, 'root')))
      .toBe(v44Bytes)
    expect((await ancestor.readForPromotion())).toMatchObject({ status: 'valid', marker: null })
    expect(await resumePublicV45(locks, createAtomicV45Store(factory), source, 0,
      started.value.lineage)).toEqual(started)
    expect(await resumePublicV45(locks, store, source, 1,
      started.value.lineage)).toEqual({ ok: false, reason: 'revision-changed' })
    expect(await resumePublicV45(locks, store, source, 0,
      { forged: true })).toEqual({ ok: false, reason: 'lineage-changed' })
    expect(await commitPublicV45(locks, store, source, 0,
      started.value.lineage, ride)).toEqual({ ok: false, reason: 'not_eligible' })
    const v44Marker = await record(factory, PUBLIC_V44_DATABASE_NAME, 'v45-successor')
    const parked = await commitPublicV45(locks, store, source, 0,
      started.value.lineage, idle)
    if (!parked.ok) throw new Error(parked.reason)
    expect(parked.value.head.saveRevision).toBe(1)
    expect(parked.value.head.witness).toEqual(idle)
    expect(parked.value.events).toEqual([])
    expect(await createAtomicV45Store(factory).readChecked()).toMatchObject({
      status: 'valid', root: { head: { saveRevision: 1, witness: idle } } })
    expect(await resumePublicV45(locks, createAtomicV45Store(factory), source, 1,
      started.value.lineage)).toMatchObject({ ok: true,
      value: { head: { saveRevision: 1 } } })
    expect(await commitPublicV45(locks, store, source, 0,
      started.value.lineage, idle)).toEqual({ ok: false, reason: 'revision-changed' })
    expect(JSON.stringify(await record(factory, PUBLIC_V44_DATABASE_NAME, 'root')))
      .toBe(v44Bytes)
    expect(await record(factory, PUBLIC_V44_DATABASE_NAME, 'v45-successor'))
      .toEqual(v44Marker)
  }, 30_000)

  it('preflights an invalid or oversized genesis before reserving V44', async () => {
    const { factory, source, store } = await setup()
    const transition = vi.spyOn(source, 'transitionSuccessor')
    const realRead = source.readForPromotion.bind(source)
    const sourceRead = vi.spyOn(source, 'readForPromotion').mockImplementation(async () => {
      const read = await realRead()
      return read.status === 'valid' ? { ...read,
        root: { ...read.root, previous: { forged: true } } as unknown as PublicV44Root } : read
    })
    expect(await startPublicV45(locks, store, source, 0)).toEqual({ ok: false,
      reason: 'invalid-source' })
    sourceRead.mockRestore()
    const realGenesis = v45Migration.createPublicV45Genesis
    const tooLarge = vi.spyOn(v45Migration, 'createPublicV45Genesis')
      .mockImplementation((v44) => ({ ...realGenesis(v44),
        padding: 'x'.repeat(1_600_000) }) as never)
    try { expect(await startPublicV45(locks, store, source, 0)).toEqual({
      ok: false, reason: 'invalid-source' }) }
    finally { tooLarge.mockRestore() }
    expect(transition).not.toHaveBeenCalled()
    expect((await source.readForPromotion())).toMatchObject({ status: 'valid', marker: null })
    expect(await record(factory, PUBLIC_V45_DATABASE_NAME, 'root')).toBeUndefined()
  }, 30_000)

  it('recovers pending with missing or matching target, but blocks ambiguous and mismatched targets', async () => {
    const { factory, root, source, store } = await setup()
    const old = await source.readForPromotion()
    if (old.status !== 'valid') throw new Error('Expected V44 source')
    expect(await source.transitionSuccessor(old.proof, 'pending')).toBe('committed')
    expect(await inspectPublicV45(locks, store, source)).toEqual({ ok: true,
      value: { status: 'migration-available', sourceRevision: 0 } })
    expect((await source.readForPromotion())).toMatchObject({ status: 'valid',
      marker: { phase: 'pending' } })
    expect((await startPublicV45(locks, store, source, 0)).ok).toBe(true)
    expect((await source.readForPromotion())).toMatchObject({ status: 'valid',
      marker: { phase: 'finalized' } })
    const matching = await setup(root)
    const pending = await matching.source.readForPromotion()
    if (pending.status !== 'valid') throw new Error('Expected pending proof')
    expect(await matching.source.transitionSuccessor(pending.proof, 'pending'))
      .toBe('committed')
    const missing = await matching.store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected V45 target')
    expect(await matching.store.commit(missing.proof, createPublicV45Genesis(root)))
      .toBe('committed')
    expect(await inspectPublicV45(locks, matching.store, matching.source))
      .toMatchObject({ ok: true, value: { status: 'valid' } })
    expect((await matching.source.readForPromotion())).toMatchObject({ status: 'valid',
      marker: { phase: 'finalized' } })
    const ambiguous = await setup(root)
    const empty = await ambiguous.store.readChecked()
    if (empty.status !== 'missing') throw new Error('Expected empty target')
    expect(await ambiguous.store.commit(empty.proof, createPublicV45Genesis(root)))
      .toBe('committed')
    expect(await startPublicV45(locks, ambiguous.store, ambiguous.source, 0))
      .toEqual({ ok: false, reason: 'ambiguous-legacy-target' })
    expect((await ambiguous.source.readForPromotion())).toMatchObject({ status: 'valid',
      marker: null })
    const different = await setup(root)
    const differentRead = await different.source.readForPromotion()
    if (differentRead.status !== 'valid') throw new Error('Expected source')
    expect(await different.source.transitionSuccessor(differentRead.proof, 'pending'))
      .toBe('committed')
    const differentTarget = await different.store.readChecked()
    if (differentTarget.status !== 'missing') throw new Error('Expected empty target')
    expect(await different.store.commit(differentTarget.proof,
      createPublicV45Genesis(mountedV44Root()))).toBe('committed')
    expect(await startPublicV45(locks, different.store, different.source, 0))
      .toEqual({ ok: false, reason: 'target-conflict' })
    expect(await different.source.readForPromotion()).toEqual({ status: 'blocked',
      reason: 'successor-conflict' })
    expect(await record(factory, PUBLIC_V45_DATABASE_NAME, 'root')).toBeDefined()
  }, 90_000)

  it('rejects source drift and transient target errors without falsely conflicting', async () => {
    const { factory, source, store } = await setup()
    const transition = source.transitionSuccessor.bind(source)
    const race = vi.spyOn(source, 'transitionSuccessor').mockImplementation(
      async (proof, phase, onBlocked) => {
        await record(factory, PUBLIC_V44_DATABASE_NAME, 'root', mountedV44Root())
        return transition(proof, phase, onBlocked)
      })
    expect(await startPublicV45(locks, store, source, 0)).toEqual({ ok: false,
      reason: 'revision-changed' })
    race.mockRestore()
    expect(await record(factory, PUBLIC_V45_DATABASE_NAME, 'root')).toBeUndefined()
    const clean = await setup()
    const transitions = vi.spyOn(clean.source, 'transitionSuccessor')
    vi.spyOn(clean.store, 'readChecked').mockResolvedValueOnce({ status: 'blocked',
      reason: 'storage-error' })
    expect(await startPublicV45(locks, clean.store, clean.source, 0))
      .toEqual({ ok: false, reason: 'storage-error' })
    expect(transitions).not.toHaveBeenCalled()
    expect((await clean.source.readForPromotion())).toMatchObject({
      status: 'valid', marker: null })
  }, 60_000)

  it('fails promptly on a blocked V45 open and leaves V44 unreserved', async () => {
    const { source } = await setup()
    const close = vi.fn()
    const request = { result: { close }, onupgradeneeded: null,
      onblocked: null, onerror: null, onsuccess: null } as unknown as IDBOpenDBRequest
    let opened!: () => void
    const ready = new Promise<void>((resolve) => { opened = resolve })
    const blockedStore = createAtomicV45Store({ open: () => {
      opened(); return request } } as unknown as IDBFactory)
    const start = startPublicV45(locks, blockedStore, source, 0)
    await ready
    request.onblocked?.call(request, {} as IDBVersionChangeEvent)
    expect(await Promise.race([start,
      new Promise((resolve) => setTimeout(() => resolve('pending'), 20))]))
      .toEqual({ ok: false, reason: 'storage-error' })
    expect((await source.readForPromotion())).toMatchObject({ status: 'valid', marker: null })
    request.onsuccess?.call(request, {} as Event)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('commits only checked ride witnesses and rejects stale competing writers', async () => {
    const { factory, source, store } = await setup(mountedV44Root())
    const started = await startPublicV45(locks, store, source, 1)
    if (!started.ok) throw new Error(started.reason)
    expect(await commitPublicV45(locks, store, source, 0,
      started.value.lineage, { ...ride, speed: 99 } as never)).toEqual({
      ok: false, reason: 'invalid-witness' })
    expect((await store.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0 } } })
    expect(await commitPublicV45(locks, store, source, 0,
      started.value.lineage, idle)).toEqual({ ok: false, reason: 'not_eligible' })
    const outcomes = await Promise.all([0, 1].map(() => commitPublicV45(
      locks, store, source, 0, started.value.lineage, ride)))
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1)
    expect(outcomes.filter((result) => !result.ok).map((result) =>
      result.ok ? '' : result.reason)).toEqual(['revision-changed'])
    const first = outcomes.find((result) => result.ok)
    if (!first?.ok) throw new Error('Missing checked ride')
    expect(first.value.head.saveRevision).toBe(1)
    expect(first.value.events.some((event) => event.type === 'player_moved')).toBe(true)
    expect(await commitPublicV45(locks, store, source, 0,
      started.value.lineage, ride)).toEqual({ ok: false, reason: 'revision-changed' })
    expect(await resumePublicV45(locks, store, source, 1,
      started.value.lineage)).toMatchObject({ ok: true,
        value: { head: { saveRevision: 1 } } })
    const parked = await commitPublicV45(locks, store, source, 1,
      started.value.lineage, { kind: 'sedgehorn-dismount/v1' })
    if (!parked.ok) throw new Error(parked.reason)
    expect(parked.value.head.groundMount.mode).toBe('parked')
    expect(parked.value.head.groundMount.parkedPosition)
      .toEqual(parked.value.head.state.player.position)
    expect(await commitPublicV45(locks, store, source, 1,
      started.value.lineage, { kind: 'sedgehorn-mount/v1' })).toEqual({
        ok: false, reason: 'revision-changed' })
    const mounted = await commitPublicV45(locks, store, source, 2,
      started.value.lineage, { kind: 'sedgehorn-mount/v1' })
    if (!mounted.ok) throw new Error(mounted.reason)
    expect(mounted.value.head.groundMount.mode).toBe('riding')
    expect(await createAtomicV45Store(factory).readChecked()).toMatchObject({
      status: 'valid', root: { head: { saveRevision: 3,
        witness: { kind: 'sedgehorn-mount/v1' } } } })
    expect((await record(factory, PUBLIC_V45_DATABASE_NAME, 'root'))).toBeDefined()
  }, 90_000)

  it('persists a checked herb sale and reloads without rewriting V44 or its marker', async () => {
    const { factory, source, store } = await setup(saleV44Root())
    const started = await startPublicV45(locks, store, source, 0)
    if (!started.ok) throw new Error(started.reason)
    const rootBytes = JSON.stringify(await record(factory, PUBLIC_V44_DATABASE_NAME, 'root'))
    const marker = await record(factory, PUBLIC_V44_DATABASE_NAME, 'v45-successor')
    expect(await commitPublicV45(locks, store, source, 0,
      started.value.lineage, { kind: 'sell-marsh-herb/v1', quantity: 2,
        unitPrice: 999 } as never)).toEqual({ ok: false, reason: 'invalid-witness' })
    const sold = await commitPublicV45(locks, store, source, 0,
      started.value.lineage, { kind: 'sell-marsh-herb/v1', quantity: 2 })
    if (!sold.ok) throw new Error(sold.reason)
    expect(sold.value.head.state.player.coins)
      .toBe(started.value.head.state.player.coins + 16)
    expect(sold.value.head.state.player.inventory.filter(({ itemId }) =>
      itemId === 'marsh_herb')).toEqual([{ itemId: 'marsh_herb', quantity: 1 }])
    expect(await resumePublicV45(locks, createAtomicV45Store(factory), source, 1,
      started.value.lineage)).toMatchObject({ ok: true,
        value: { head: { saveRevision: 1,
          witness: { kind: 'sell-marsh-herb/v1', quantity: 2 } } } })
    expect(await commitPublicV45(locks, store, source, 0,
      started.value.lineage, { kind: 'sell-marsh-herb/v1', quantity: 1 }))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(JSON.stringify(await record(factory, PUBLIC_V44_DATABASE_NAME, 'root')))
      .toBe(rootBytes)
    expect(await record(factory, PUBLIC_V44_DATABASE_NAME, 'v45-successor'))
      .toEqual(marker)
  }, 60_000)

  it('persists paid tack through witnessed travel, mount, ride, dismount, and reload', async () => {
    const ready = purchaseReadyRoot()
    const { factory, source, store } = await setup(ready.lineage.source)
    const started = await startPublicV45(locks, store, source, 0)
    if (!started.ok) throw new Error(started.reason)
    // Seed a checked retained save; every purchase and travel edge below uses Flow.
    await record(factory, PUBLIC_V45_DATABASE_NAME, 'root', ready)
    expect(await createAtomicV45Store(factory).readChecked()).toMatchObject({
      status: 'valid', root: { head: { saveRevision: 4, tack: 'not_owned' } } })
    const v44Bytes = JSON.stringify(await record(factory, PUBLIC_V44_DATABASE_NAME, 'root'))
    const marker = await record(factory, PUBLIC_V44_DATABASE_NAME, 'v45-successor')
    const write = async (kind: Parameters<typeof commitPublicV45>[5]) => {
      const read = await store.readChecked()
      if (read.status !== 'valid') throw new Error('Expected checked V45 root')
      const saved = await commitPublicV45(locks, store, source,
        read.root.head.saveRevision, ready.lineage, kind)
      if (!saved.ok) throw new Error(`${String(kind.kind)}: ${saved.reason}`)
      return saved.value.head
    }
    const bought = await write({ kind: 'buy-sedgehorn-tack/v1' })
    expect(bought.tack).toBe('purchased')
    expect(bought.state.player.coins).toBe(60)
    const walkTo = async (target: { x: number; z: number }, limit: number) => {
      for (let index = 0; index < limit; index++) {
        const read = await store.readChecked()
        if (read.status !== 'valid') throw new Error('Expected checked V45 root')
        const at = read.root.head.state.player.position
        const distance = Math.hypot(target.x - at.x, target.z - at.z)
        if (distance < 1.5) return read.root.head
        const frames = Array.from({ length: Math.min(128, Math.ceil(distance / .16)) },
          () => ({ intents: [{ type: 'move' as const,
            delta: { x: (target.x - at.x) * .16 / distance,
              z: (target.z - at.z) * .16 / distance } }], walkRequested: true }))
        await write({ kind: 'frame-batch/v1', frames })
      }
      throw new Error('Checked walking route did not reach target')
    }
    const greenRing = bought.state.greenway.fairyRings
      .find(({ id }) => id === 'ring-greenway')!
    await walkTo(greenRing.position, 2)
    const arrived = await write({ kind: 'fairy-ring-travel/v1',
      sourceRingId: 'ring-greenway', targetRingId: MIREGLASS_RING_ID })
    expect(arrived.state.movementOwner).toBe('streamed')
    const keeper = resolveSedgehornFamiliarSite(arrived)!.keeper.center
    const nearby = await walkTo(keeper, 10)
    expect(nearby.tack).toBe('purchased')
    const mounted = await write({ kind: 'sedgehorn-mount/v1' })
    expect(mounted.groundMount.mode).toBe('riding')
    const ridden = await write(ride)
    expect(ridden.tack).toBe('purchased')
    const parked = await write({ kind: 'sedgehorn-dismount/v1' })
    expect(parked.groundMount.parkedPosition)
      .toEqual(parked.state.player.position)
    expect(await createAtomicV45Store(factory).readChecked()).toMatchObject({
      status: 'valid', root: { head: { saveRevision: parked.saveRevision,
        tack: 'purchased', groundMount: { mode: 'parked' } } } })
    expect(await resumePublicV45(locks, createAtomicV45Store(factory), source,
      parked.saveRevision, ready.lineage)).toMatchObject({ ok: true,
        value: { head: { tack: 'purchased', saveRevision: parked.saveRevision } } })
    expect(JSON.stringify(await record(factory, PUBLIC_V44_DATABASE_NAME, 'root')))
      .toBe(v44Bytes)
    expect(await record(factory, PUBLIC_V44_DATABASE_NAME, 'v45-successor'))
      .toEqual(marker)
  }, 180_000)
})
