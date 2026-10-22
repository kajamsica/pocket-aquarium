import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import './atomicV41Database'
import { createAtomicV44Store } from './atomicV44Database'
import { createAtomicV45Store, PUBLIC_V45_DATABASE_NAME } from './atomicV45Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
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
import { confirmPublicV45RideFrame } from './publicWorldV45RideAction'
import { createPublicV45Genesis, PUBLIC_V45_SCHEMA } from './publicWorldV45Migration'
import { decodePublicV45CheckedSuccessor, decodePublicV45Root }
  from './publicWorldV45Snapshot'
import type { PublicV45Root, PublicV45Witness } from './publicWorldV45Snapshot'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'
import { waystationRiverSite } from './waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const idle = { kind: 'frame-batch/v1' as const,
  frames: [{ intents: [], walkRequested: true }] }
const ride: PublicV45Witness = { kind: 'sedgehorn-assisted-ride-frame/v1',
  intents: [{ type: 'move', delta: { x: 0.2, z: 0 } }] }

// Reuse the checked V45 fixture route from publicWorldV45Snapshot.test.ts.
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

function mountedGenesis(): PublicV45Root {
  const parked = createPublicV44Root(matureRoot())
  const witness = { kind: 'sedgehorn-mount/v1' as const }
  const mounted = confirmPublicV44GroundMountAction({ v43: parked.head.v43,
    groundMount: parked.head.groundMount }, witness).progress
  if (!mounted) throw new Error('Invalid V44 mount fixture')
  const source = decodePublicV44Root({ lineage: parked.lineage,
    previous: parked.head, head: { ...mounted,
      schemaVersion: PUBLIC_V44_SCHEMA, saveRevision: 1, witness } })
  if (!source) throw new Error('Invalid mounted V44 fixture')
  return createPublicV45Genesis(source)
}

function successor(before: PublicV45Root): PublicV45Root {
  const { schemaVersion: _schema, saveRevision: _revision,
    witness: _prior, ...flat } = before.head
  const progress = confirmPublicV45RideFrame(flat, ride).progress
  if (!progress) throw new Error('Invalid V45 ride fixture')
  const checked = decodePublicV45CheckedSuccessor(before, { lineage: before.lineage,
    previous: before.head, head: { ...progress, schemaVersion: PUBLIC_V45_SCHEMA,
      saveRevision: before.head.saveRevision + 1, witness: ride } })
  if (!checked) throw new Error('Invalid checked V45 fixture edge')
  return checked
}

function open(factory: IDBFactory, name = PUBLIC_V45_DATABASE_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1)
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

describe('atomic V45 checked root storage', () => {
  it('commits only a revision-zero genesis, resumes it, and leaves V44 untouched', async () => {
    const factory = new IDBFactory(), store = createAtomicV45Store(factory)
    const v44 = createPublicV44Root(createFreshPublicV43Root(seed))
    await record(factory, PUBLIC_V44_DATABASE_NAME, 'root', v44)
    const v44Bytes = JSON.stringify(await record(factory, PUBLIC_V44_DATABASE_NAME, 'root'))
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected empty V45 store')
    const genesis = createPublicV45Genesis(v44)
    const supplied = structuredClone(genesis)
    const committed = store.commit(missing.proof, supplied)
    ;(supplied.head as { saveRevision: number }).saveRevision = 77
    expect(await committed).toBe('committed')
    expect(await store.commit(missing.proof, genesis)).toBe('invalid')
    expect(await record(factory, PUBLIC_V45_DATABASE_NAME, 'root')).toEqual(genesis)
    expect(await createAtomicV45Store(factory).readChecked()).toMatchObject({
      status: 'valid', root: genesis })
    expect(JSON.stringify(await record(factory, PUBLIC_V44_DATABASE_NAME, 'root')))
      .toBe(v44Bytes)
    expect((await createAtomicV44Store(factory).readChecked()).status).toBe('valid')
  }, 30_000)

  it('persists one and two checked ride commits across a reopened store', async () => {
    const factory = new IDBFactory(), store = createAtomicV45Store(factory)
    const genesis = mountedGenesis()
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected empty V45 store')
    expect(await store.commit(missing.proof, genesis)).toBe('committed')
    const firstRead = await store.readChecked()
    if (firstRead.status !== 'valid') throw new Error('Expected genesis root')
    const first = successor(firstRead.root)
    expect(await store.commit(firstRead.proof, first)).toBe('committed')
    const restarted = createAtomicV45Store(factory)
    const secondRead = await restarted.readChecked()
    if (secondRead.status !== 'valid') throw new Error('Expected first ride')
    expect(secondRead.root).toEqual(first)
    const second = successor(secondRead.root)
    expect(await restarted.commit(secondRead.proof, second)).toBe('committed')
    expect((await createAtomicV45Store(factory).readChecked())).toMatchObject({
      status: 'valid', root: second })
    expect((await record(factory, PUBLIC_V45_DATABASE_NAME, 'root'))).toEqual(second)
  }, 30_000)

  it('consumes proofs once and rejects stale and competing writers by CAS', async () => {
    const factory = new IDBFactory(), store = createAtomicV45Store(factory)
    const genesis = mountedGenesis()
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected empty store')
    expect(await store.commit(missing.proof, genesis)).toBe('committed')
    const stale = await store.readChecked(), current = await store.readChecked()
    if (stale.status !== 'valid' || current.status !== 'valid')
      throw new Error('Expected two checked roots')
    const next = successor(current.root)
    expect(await store.commit(current.proof, next)).toBe('committed')
    expect(await store.commit(stale.proof, successor(stale.root)))
      .toBe('revision-changed')
    expect(await store.commit(stale.proof, next)).toBe('invalid')
    const first = await store.readChecked(), second = await store.readChecked()
    if (first.status !== 'valid' || second.status !== 'valid')
      throw new Error('Expected competing proofs')
    const outcomes = await Promise.all([
      store.commit(first.proof, successor(first.root)),
      store.commit(second.proof, successor(second.root))])
    expect(outcomes.sort()).toEqual(['committed', 'revision-changed'])
    expect((await store.readChecked())).toMatchObject({
      status: 'valid', root: { head: { saveRevision: 2 } } })
  }, 30_000)

  it('rejects forged, truncated, and oversized candidates without writing', async () => {
    const factory = new IDBFactory(), store = createAtomicV45Store(factory)
    const genesis = mountedGenesis()
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected empty store')
    const forgedGenesis = { ...genesis, head: { ...genesis.head, tack: 'not_owned' } }
    expect(await store.commit(missing.proof, forgedGenesis as PublicV45Root))
      .toBe('invalid')
    expect(await record(factory, PUBLIC_V45_DATABASE_NAME, 'root')).toBeUndefined()
    const validMissing = await store.readChecked()
    if (validMissing.status !== 'missing') throw new Error('Expected fresh proof')
    expect(await store.commit(validMissing.proof, genesis)).toBe('committed')
    const before = JSON.stringify(await record(factory, PUBLIC_V45_DATABASE_NAME, 'root'))
    const first = successor(genesis)
    for (const candidate of [
      { ...first, previous: null },
      { ...first, head: { ...first.head, saveRevision: 4 } },
      { ...first, padding: 'x'.repeat(1_600_000) },
    ]) {
      const read = await store.readChecked()
      if (read.status !== 'valid') throw new Error('Expected checked root')
      expect(await store.commit(read.proof, candidate as PublicV45Root)).toBe('invalid')
      expect(JSON.stringify(await record(factory, PUBLIC_V45_DATABASE_NAME, 'root')))
        .toBe(before)
    }
  }, 30_000)

  it('blocks malformed, extra-key, torn, oversized, and absent-store reads', async () => {
    const malformed = new IDBFactory(), extra = new IDBFactory()
    const torn = new IDBFactory(), oversized = new IDBFactory()
    const absentStore = new IDBFactory()
    await record(malformed, PUBLIC_V45_DATABASE_NAME, 'root', { forged: true })
    const genesis = mountedGenesis(), first = successor(genesis)
    await record(extra, PUBLIC_V45_DATABASE_NAME, 'root', genesis)
    await record(extra, PUBLIC_V45_DATABASE_NAME, 'unexpected', { forged: true })
    await record(torn, PUBLIC_V45_DATABASE_NAME, 'root', { ...first, previous: null })
    await record(oversized, PUBLIC_V45_DATABASE_NAME, 'root', { ...genesis,
      padding: 'x'.repeat(1_600_000) })
    const created = absentStore.open(PUBLIC_V45_DATABASE_NAME, 1)
    await new Promise<void>((resolve, reject) => {
      created.onupgradeneeded = () => created.result.createObjectStore('other')
      created.onsuccess = () => { created.result.close(); resolve() }
      created.onerror = () => reject(created.error)
    })
    for (const factory of [malformed, extra, torn, oversized])
      expect((await createAtomicV45Store(factory).readChecked()).status).toBe('blocked')
    expect(await createAtomicV45Store(absentStore).readChecked()).toEqual({
      status: 'blocked', reason: 'invalid-v45-records' })
  }, 30_000)

  it('fails closed on a newer database version', async () => {
    const factory = new IDBFactory()
    const request = factory.open(PUBLIC_V45_DATABASE_NAME, 2)
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => request.result.createObjectStore('records')
      request.onsuccess = () => { request.result.close(); resolve() }
      request.onerror = () => reject(request.error)
    })
    expect(await createAtomicV45Store(factory).readChecked()).toEqual({
      status: 'blocked', reason: 'storage-error' })
  })

  it('returns on blocked open without a terminal event and closes a late success', async () => {
    const close = vi.fn()
    const request = { result: { close }, onupgradeneeded: null,
      onblocked: null, onerror: null, onsuccess: null } as unknown as IDBOpenDBRequest
    const factory = { open: () => request } as unknown as IDBFactory
    const read = createAtomicV45Store(factory).readChecked()
    request.onblocked?.call(request, {} as IDBVersionChangeEvent)
    expect(await Promise.race([read,
      new Promise((resolve) => setTimeout(() => resolve('pending'), 20))]))
      .toEqual({ status: 'blocked', reason: 'storage-error' })
    request.onsuccess?.call(request, {} as Event)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
