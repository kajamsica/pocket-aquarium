/** V41 copy isolation, inherited replay, combat phases, and checked persistence. */
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV40Store } from './atomicV40Database'
import { createAtomicV41Store } from './atomicV41Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { highlandLandmark } from './highlandContent'
import { ironHallSite } from './ironHallSite'
import { commitPublicV41, resumePublicV41, startFreshPublicV41,
  startPublicV41 } from './publicWorldV41Flow'
import { createFreshPublicV39Root, decodePublicV39Root,
  PUBLIC_V39_SCHEMA } from './publicWorldV39Snapshot'
import type { PublicV39Root } from './publicWorldV39Snapshot'
import { createFreshPublicV40Root, createPublicV40Root, decodePublicV40Root,
  replayPublicV40Witness, PUBLIC_V40_DATABASE_NAME, PUBLIC_V40_SCHEMA } from './publicWorldV40Snapshot'
import type { PublicV40Root } from './publicWorldV40Snapshot'
import { INITIAL_IRON_HALL_COMBAT, PUBLIC_V41_PROGRESS_KEYS } from './publicWorldV41CombatAction'
import { enumerateTerrainWorkSites } from './terrainWorks'
import { createFreshPublicV41Root, createPublicV41Root,
  decodePublicV41CheckedSuccessor, decodePublicV41Root, replayPublicV41Witness,
  PUBLIC_V41_DATABASE_NAME, PUBLIC_V41_SCHEMA } from './publicWorldV41Snapshot'
import type { PublicV41Root, PublicV41Witness } from './publicWorldV41Snapshot'
import { waystationRiverSite } from './waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'
import type { Vec3 } from './types'

const seed = 'wizard-realms'
const bridge = waystationRiverSite(seed)!
const site = ironHallSite(createFreshPublicV40Root(seed).head)!
const locks = { request: async (_name: string, _options: unknown,
  body: () => Promise<unknown>) => body() }
const frame = { intents: [], walkRequested: true } as const
const frames = (count: number) => ({ kind: 'frame-batch/v1' as const,
  frames: Array.from({ length: count }, () => ({ ...frame })) })
const study = { kind: 'ironhall-study/v1' as const }
const engage = { kind: 'ironhall-engage/v1' as const }
const bolt = { kind: 'ironhall-bolt/v1' as const }

function v39At(position: Vec3, tiles: string[] = []): PublicV39Root {
  const fresh = createFreshPublicV39Root(seed)
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...base } = fresh.head
  const tile = worldTileAtGrid(seed,
    Math.ceil(position.x / WORLD_CELL_METERS - 0.5),
    Math.ceil(position.z / WORLD_CELL_METERS - 0.5))
  const progress = { ...base, riverBridgeIds: [bridge.id],
    state: { ...base.state, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask), tile.id,
        ...bridge.footprintTileIds, ...tiles])].sort()),
      player: { ...base.state.player, position, verticalVelocity: 0 } } }
  const source: PublicV39Root = { lineage: { origin: 'v38-migration',
    rulesProfile: 'ringkeeper-trail/v1', seed, sourceRevision: 9, genesis: progress },
  previous: null, head: { ...progress, schemaVersion: PUBLIC_V39_SCHEMA,
    saveRevision: 0, witness: null } }
  if (!decodePublicV39Root(source)) throw new Error('Invalid V39 fixture')
  return source
}

/** A checked, pruned V40 root may retain its already witnessed crossing. */
function crossedV40At(position = site.alcove.center): PublicV40Root {
  const base = createPublicV40Root(v39At(position,
    [site.alcove.id, site.ward.id, site.door.id]))
  const previous = { ...base.head, southbankReached: true,
    saveRevision: 2, witness: frames(1) }
  const progress = replayPublicV40Witness(previous, frames(1))
  if (!progress) throw new Error('Invalid V40 frame fixture')
  const root: PublicV40Root = { lineage: base.lineage, previous,
    head: { ...progress, schemaVersion: PUBLIC_V40_SCHEMA,
      saveRevision: 3, witness: frames(1) } }
  if (!decodePublicV40Root(root)) throw new Error('Invalid checked V40 fixture')
  return root
}

function successor(root: PublicV41Root, witness: PublicV41Witness): PublicV41Root {
  const progress = replayPublicV41Witness(root.head, witness)
  if (!progress) throw new Error(`Rejected ${witness.kind}`)
  const next: PublicV41Root = { lineage: root.lineage, previous: root.head,
    head: { ...progress, schemaVersion: PUBLIC_V41_SCHEMA,
      saveRevision: root.head.saveRevision + 1, witness } }
  if (!decodePublicV41CheckedSuccessor(root, next)) throw new Error(`Invalid ${witness.kind} edge`)
  return next
}

async function putRaw(factory: IDBFactory, name: string, raw: unknown) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('records', 'readwrite')
    tx.objectStore('records').put(raw, 'root')
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  database.close()
}

describe('V41 checked copy and combat save replay', () => {
  it('creates a separate fresh lineage and copies only a checked V40 head', async () => {
    const fresh = createFreshPublicV41Root(seed)
    expect(fresh).toMatchObject({ lineage: { origin: 'fresh', sourceRevision: null,
      rulesProfile: 'iron-hall-combat/v1' }, head: { schemaVersion: PUBLIC_V41_SCHEMA,
        ironHall: INITIAL_IRON_HALL_COMBAT } })
    expect(decodePublicV41Root(fresh)).toEqual(fresh)
    expect(PUBLIC_V41_DATABASE_NAME).not.toBe(PUBLIC_V40_DATABASE_NAME)
    expect(() => createFreshPublicV41Root('other-seed')).toThrow('Invalid fresh seed')

    const source = crossedV40At(), original = structuredClone(source)
    const copied = createPublicV41Root(source)
    expect(copied.lineage).toMatchObject({ origin: 'v40-migration',
      sourceRevision: source.head.saveRevision, rulesProfile: 'iron-hall-combat/v1' })
    expect(copied.head.state).toEqual(source.head.state)
    expect(copied.head.ironHall).toEqual(INITIAL_IRON_HALL_COMBAT)
    expect(decodePublicV41Root(copied)).toEqual(copied)
    copied.head.state.discoveryMask[0] ^= 1
    expect(source).toEqual(original)
    expect(() => createPublicV41Root({ ...source,
      head: { ...source.head, saveRevision: 4 } })).toThrow('Invalid checked V40 source root')

    const factory = new IDBFactory(), oldStore = createAtomicV40Store(factory)
    const target = createAtomicV41Store(factory)
    await putRaw(factory, PUBLIC_V40_DATABASE_NAME, source)
    expect(await startPublicV41(locks as never, target, oldStore, 2))
      .toEqual({ ok: false, reason: 'source-revision-changed' })
    const before = await oldStore.readChecked()
    const started = await startPublicV41(locks as never, target, oldStore, 3)
    expect(started).toMatchObject({ ok: true, value: { head: { saveRevision: 0 } } })
    expect(await oldStore.readChecked()).toEqual(before)
    expect(await startPublicV41(locks as never, target, oldStore, 3))
      .toEqual({ ok: false, reason: 'target-conflict' })
    expect(await createAtomicV41Store(factory).readChecked())
      .toMatchObject({ status: 'valid', root: { lineage: { sourceRevision: 3 } } })
    const blocked = createAtomicV41Store(factory, 'malformed-v41-target')
    await putRaw(factory, 'malformed-v41-target', { invalid: true })
    expect(await startPublicV41(locks as never, blocked, oldStore, 3))
      .toEqual({ ok: false, reason: 'invalid-v41-root' })
    expect(await oldStore.readChecked()).toEqual(before)
  })

  it('starts fresh without opening a V40 source and blocks malformed targets', async () => {
    const factory = new IDBFactory(), source = createAtomicV40Store(factory)
    const target = createAtomicV41Store(factory)
    expect(await startFreshPublicV41(locks as never, target, seed))
      .toMatchObject({ ok: true, value: { lineage: { origin: 'fresh' } } })
    expect(await source.readChecked()).toMatchObject({ status: 'missing' })
    expect(await target.readChecked()).toMatchObject({ status: 'valid' })
    const brokenFactory = new IDBFactory(), broken = createAtomicV41Store(brokenFactory)
    await putRaw(brokenFactory, PUBLIC_V41_DATABASE_NAME, { invalid: true })
    expect(await broken.readChecked()).toEqual({ status: 'blocked', reason: 'invalid-v41-root' })
    expect(await startFreshPublicV41(locks as never, broken, seed))
      .toEqual({ ok: false, reason: 'invalid-v41-root' })
    expect(await startPublicV41(locks as never, broken, source, 0))
      .toEqual({ ok: false, reason: 'source-missing' })
    expect(await source.readChecked()).toMatchObject({ status: 'missing' })
  })

  it('retains inherited Works, Waystation, Ring, and Signal progress after combat', () => {
    const studied = successor(createPublicV41Root(crossedV40At()), study)
    const combat = studied.head.ironHall
    const checkpoint = replayPublicV41Witness(studied.head, { kind: 'checkpoint' })!
    expect(checkpoint.ironHall).toEqual(combat)
    expect(checkpoint.greenwayWorks).toEqual(studied.head.greenwayWorks)
    expect(checkpoint.regionalWorks).toEqual(studied.head.regionalWorks)
    expect(checkpoint.riverBridgeIds).toContain(bridge.id)
    expect(checkpoint.southbankReached).toBe(true)
    const legacy = replayPublicV40Witness(studied.head, { kind: 'checkpoint' })!
    for (const key of PUBLIC_V41_PROGRESS_KEYS.filter((key) => key !== 'ironHall'))
      expect(checkpoint[key]).toEqual(legacy[key])

    const work = enumerateTerrainWorkSites(seed, {
      minGX: -110, maxGX: -95, minGZ: 100, maxGZ: 115,
    }).find((candidate) => candidate.kind !== 'dig')!
    const worked = replayPublicV41Witness({ ...studied.head,
      state: { ...studied.head.state,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(studied.head.state.discoveryMask),
          ...work.footprintTileIds])].sort()),
        player: { ...studied.head.state.player, position: work.from,
          inventory: [...studied.head.state.player.inventory,
            { itemId: 'logs', quantity: work.logCost }] } } },
    { kind: 'legacy-work', id: work.id })
    expect(worked).toMatchObject({ ironHall: combat,
      state: { terrainWorks: { builtWorkIds: [work.id] } } })

    const ringAt = crossedV40At().head.state.greenway.fairyRings
      .find(({ id }) => id === 'ring-greenway')!
    const ringProgress = { ...studied.head, state: { ...studied.head.state,
      movementOwner: 'greenway' as const, player: { ...studied.head.state.player,
        position: ringAt.position,
        discoveredRingIds: ['ring-greenway'] } },
      quarryRingDiscovered: true, ringLinkEstablished: false }
    const linked = replayPublicV41Witness(ringProgress, { kind: 'ringkeeper-link/v1' })
    expect(linked).toMatchObject({ ringLinkEstablished: true, ironHall: combat })
    const store = studied.head.state.greenway.stores.find(({ id }) => id === 'store-greenway')!
    const claimed = replayPublicV41Witness({ ...studied.head,
      state: { ...studied.head.state, movementOwner: 'greenway',
        player: { ...studied.head.state.player, position: store.position } } },
    { kind: 'waystation-claim/v1' })
    expect(claimed).toMatchObject({ waystationClaimed: true, ironHall: combat })
    const crown = highlandLandmark(seed).tile
    const signaled = replayPublicV41Witness({ ...studied.head,
      signalVantageInspected: true,
      state: { ...studied.head.state,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(studied.head.state.discoveryMask), crown.id])].sort()),
        player: { ...studied.head.state.player, position: crown.center } } },
    { kind: 'signal-claim/v1' })
    expect(signaled).toMatchObject({ signalClaimed: true, ironHall: combat })
  })

  it('replays every frame identically to V40 and checks only the final edge', () => {
    const engaged = successor(successor(createPublicV41Root(crossedV40At()), study), engage)
    const batch = frames(20)
    const whole = replayPublicV41Witness(engaged.head, batch)!
    let each = engaged.head as typeof whole
    for (const single of batch.frames) each = replayPublicV41Witness(each,
      { kind: 'frame-batch/v1', frames: [single] })!
    expect(whole).toEqual(each)
    const old = replayPublicV40Witness(engaged.head, batch)!
    for (const key of PUBLIC_V41_PROGRESS_KEYS.filter((key) => key !== 'ironHall'))
      expect(whole[key]).toEqual(old[key])
    expect(whole.ironHall).toMatchObject({ phase: 'recovery', playerHealth: 12 })
    const saved = successor(engaged, batch)
    expect(decodePublicV41Root(saved)).toEqual(saved)
    expect(decodePublicV41Root({ ...saved, previous: {
      ...saved.previous!, ironHall: { ...saved.previous!.ironHall, playerHealth: 8 } } }))
      .toBeNull()
    expect(decodePublicV41CheckedSuccessor(engaged, { ...saved,
      previous: { ...engaged.head, saveRevision: engaged.head.saveRevision - 1 } }))
      .toBeNull()
  })

  it('rejects health, defeat, XP, witness, and lineage forgery', () => {
    const base = createPublicV41Root(crossedV40At()), studied = successor(base, study)
    const forged = (head: PublicV41Root['head']) =>
      decodePublicV41CheckedSuccessor(base, { ...studied, head })
    expect(forged({ ...studied.head, ironHall: {
      ...studied.head.ironHall, playerHealth: 11 } })).toBeNull()
    expect(forged({ ...studied.head, ironHall: {
      ...studied.head.ironHall, wardHealth: 0, wardDefeated: true,
      phase: 'defeated' } })).toBeNull()
    expect(forged({ ...studied.head, ironHall: {
      ...studied.head.ironHall, combatXp: 70 } })).toBeNull()
    expect(forged({ ...studied.head, state: { ...studied.head.state,
      player: { ...studied.head.state.player,
        xp: studied.head.state.player.xp + 70 } } })).toBeNull()
    expect(decodePublicV41Root({ ...studied, head: { ...studied.head,
      witness: { kind: 'ironhall-study/v1', damage: 9 } } })).toBeNull()
    expect(decodePublicV41Root({ ...studied, lineage: {
      ...studied.lineage, rulesProfile: 'fake' } })).toBeNull()
    expect(decodePublicV41Root({ ...base, head: { ...base.head,
      ironHall: { ...base.head.ironHall, playerHealth: 8 } } })).toBeNull()
  })

  it('reloads dormant, windup, recovery, and defeated phases with stale CAS rejected', async () => {
    const factory = new IDBFactory(), target = createAtomicV41Store(factory)
    const source = createAtomicV40Store(factory), v40 = crossedV40At()
    await putRaw(factory, PUBLIC_V40_DATABASE_NAME, v40)
    const start = await startPublicV41(locks as never, target, source, 3)
    if (!start.ok) throw new Error(start.reason)
    const lineage = start.value.lineage
    const commit = async (revision: number, witness: PublicV41Witness) => {
      const result = await commitPublicV41(locks as never, target, revision, lineage, witness)
      if (!result.ok) throw new Error(result.reason)
      const reloaded = await createAtomicV41Store(factory).readChecked()
      if (reloaded.status !== 'valid') throw new Error('V41 reload blocked')
      expect(reloaded.root.head).toEqual(result.value.head)
      expect(await resumePublicV41(locks as never, target, revision + 1, lineage))
        .toMatchObject({ ok: true, value: { head: { saveRevision: revision + 1 } } })
      return result.value.head
    }
    expect((await createAtomicV41Store(factory).readChecked()))
      .toMatchObject({ status: 'valid', root: { head: { ironHall: { phase: 'dormant' } } } })
    expect((await commit(0, study)).ironHall.phase).toBe('dormant')
    expect((await commit(1, engage)).ironHall.phase).toBe('windup')
    const left = await target.readChecked(), right = await target.readChecked()
    if (left.status !== 'valid' || right.status !== 'valid') throw new Error('Missing phase root')
    const advanced = successor(left.root, frames(20))
    expect(await target.commit(left.proof, advanced)).toBe('committed')
    expect(await target.commit(right.proof, advanced)).toBe('revision-changed')
    expect(await commitPublicV41(locks as never, target, 2, lineage, bolt))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect((await createAtomicV41Store(factory).readChecked()))
      .toMatchObject({ status: 'valid', root: { head: { ironHall: { phase: 'recovery' } } } })
    expect((await commit(3, bolt)).ironHall.wardHealth).toBe(6)
    await commit(4, frames(12))
    expect((await commit(5, bolt)).ironHall.wardHealth).toBe(3)
    await commit(6, frames(12))
    const defeated = await commit(7, bolt)
    expect(defeated.ironHall).toMatchObject({ phase: 'defeated', wardDefeated: true,
      wardHealth: 0, combatXp: 6 })
    expect(await commitPublicV41(locks as never, target, 8, lineage, bolt))
      .toEqual({ ok: false, reason: 'not_engaged' })
    expect(await source.readChecked()).toMatchObject({ status: 'valid', root: v40 })
  }, 20000)
})
