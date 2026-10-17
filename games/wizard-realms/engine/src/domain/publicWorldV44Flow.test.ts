import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import './atomicV41Database'
import { createAtomicV43Store } from './atomicV43Database'
import { createAtomicV44Store } from './atomicV44Database'
import { createFreshPublicV43Root, decodePublicV43CheckedSuccessor,
  createPublicV43Root, decodePublicV43Root, replayPublicV43Witness,
  PUBLIC_V43_SCHEMA } from './publicWorldV43Snapshot'
import type { PublicV43Root } from './publicWorldV43Snapshot'
import { createFreshPublicV42Root, decodePublicV42Root,
  PUBLIC_V42_SCHEMA } from './publicWorldV42Snapshot'
import type { PublicV42Root } from './publicWorldV42Snapshot'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'
import { waystationRiverSite } from './waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'
import { commitPublicV44, inspectPublicV44, resumePublicV44,
  startPublicV44 } from './publicWorldV44Flow'
import { createPublicV44Root, decodePublicV44Root,
  PUBLIC_V44_DATABASE_NAME } from './publicWorldV44Snapshot'

const seed = 'wizard-realms'
const locks = { request: async <T>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>): Promise<T> => body() }
const idle = { kind: 'frame-batch/v1' as const,
  frames: [{ intents: [], walkRequested: true }] }

async function putRaw(factory: IDBFactory, raw: unknown, key = 'root') {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(PUBLIC_V44_DATABASE_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').put(raw, key)
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}

async function setup() {
  const factory = new IDBFactory()
  const source = createAtomicV43Store(factory)
  const target = createAtomicV44Store(factory)
  const fresh = createFreshPublicV43Root(seed)
  const missing = await source.readChecked()
  expect(missing.status).toBe('missing')
  if (missing.status !== 'missing') throw new Error('Missing V43 proof')
  expect(await source.commit(missing.proof, fresh)).toBe('committed')
  return { factory, source, target, fresh }
}

/** An already V43-accepted mature state, not a proof of the earning journey.
 * The V43 care suite independently covers the checked quest and care path. */
function matureSource(): PublicV43Root {
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
  const v42: PublicV42Root = { lineage: { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed, sourceRevision: 4, genesis },
    previous: null, head: { ...structuredClone(genesis),
      schemaVersion: PUBLIC_V42_SCHEMA, saveRevision: 0, witness: null } }
  expect(decodePublicV42Root(v42)).not.toBeNull()
  let v43 = createPublicV43Root(v42)
  for (let i = 0; i < 3; i++) {
    const progress = replayPublicV43Witness(v43.head, idle)!
    const next: PublicV43Root = { lineage: v43.lineage, previous: v43.head,
      head: { ...progress, schemaVersion: PUBLIC_V43_SCHEMA,
        saveRevision: v43.head.saveRevision + 1, witness: idle } }
    v43 = decodePublicV43CheckedSuccessor(v43, next)!
  }
  const careWitnesses = [0, 600, 1200].map((tick, index) => ({
    kind: 'sedgehorn-care/v1' as const, tick, eventSequence: index + 1 }))
  const mature = (head: PublicV43Root['head']) => ({ ...head,
    familiar: { ...head.familiar, phase: 'claimed' as const,
      routeChoice: 'shelter' as const, position: { ...site.keeper.center },
      trust: 2, creatureCareXp: 40, stationKnown: true },
    mountTraining: { careWitnesses },
    state: { ...head.state, player: { ...head.state.player,
      coins: head.state.player.coins + 25, xp: head.state.player.xp + 40,
      level: 1 + Math.floor((head.state.player.xp + 40) / 100) } } })
  const accepted = decodePublicV43Root({ ...v43,
    previous: mature(v43.previous!), head: mature(v43.head) })
  expect(accepted).not.toBeNull()
  return accepted!
}

describe('V44 checked local import and writer', () => {
  it('imports an exact checked V43 source, replays a monotonic witness, and reloads', async () => {
    const { factory, source, target, fresh } = await setup()
    const old = await source.readChecked()
    expect(await inspectPublicV44(locks, target, source)).toEqual({ ok: true,
      value: { status: 'migration-available', sourceRevision: 0 } })
    expect(await startPublicV44(locks, target, source, 1)).toEqual({ ok: false,
      reason: 'source-revision-changed' })
    const started = await startPublicV44(locks, target, source, 0)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.value.head.saveRevision).toBe(0)
    expect(started.value.lineage.source).toEqual(fresh)
    expect((await source.readChecked())).toMatchObject({ status: 'valid',
      root: old.status === 'valid' ? old.root : undefined })
    const advanced = await commitPublicV44(locks, target, source, 0,
      started.value.lineage, idle)
    expect(advanced.ok).toBe(true)
    if (!advanced.ok) return
    expect(advanced.value.head.saveRevision).toBe(1)
    expect(advanced.value.head.v43.head.saveRevision).toBe(1)
    const reloaded = createAtomicV44Store(factory)
    const checked = await reloaded.readChecked()
    expect(checked).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1 }, previous: { saveRevision: 0 } } })
    if (checked.status !== 'valid') throw new Error('Missing checked V44 root')
    expect(decodePublicV44Root({ ...checked.root, head: { ...checked.root.head,
      witness: { kind: 'sedgehorn-mount/v1' } } })).toBeNull()
    expect(decodePublicV44Root({ ...checked.root, previous: {
      ...checked.root.previous, saveRevision: 2 } })).toBeNull()
    expect(await resumePublicV44(locks, reloaded, source, 1,
      started.value.lineage)).toEqual({ ok: true, value: advanced.value })
    expect(await commitPublicV44(locks, reloaded, source, 0,
      started.value.lineage, idle)).toEqual({ ok: false,
      reason: 'revision-changed' })
  })

  it('consumes each proof once and resolves simultaneous writers by atomic CAS', async () => {
    const { source, target } = await setup()
    const first = await startPublicV44(locks, target, source, 0)
    if (!first.ok) throw new Error(first.reason)
    const read = await target.readChecked()
    if (read.status !== 'valid') throw new Error('Missing V44 proof')
    const invalid = { ...read.root, head: { ...read.root.head,
      saveRevision: 1 } }
    expect(await target.commit(read.proof, invalid)).toBe('invalid')
    expect(await target.commit(read.proof, read.root)).toBe('invalid')
    const outcomes = await Promise.all([0, 1].map(() => commitPublicV44(
      locks, target, source, 0, first.value.lineage, idle)))
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1)
    expect(outcomes.filter((result) => !result.ok).map((result) =>
      result.ok ? '' : result.reason)).toEqual(['revision-changed'])
    expect((await target.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1 } } })
  })

  it('fails closed on legacy source drift, malformed target and lineage tampering', async () => {
    const { factory, source, target } = await setup()
    const started = await startPublicV44(locks, target, source, 0)
    if (!started.ok) throw new Error(started.reason)
    const v43 = await source.readChecked()
    if (v43.status !== 'valid') throw new Error('Missing V43 proof')
    const progress = replayPublicV43Witness(v43.root.head, idle)
    expect(progress).not.toBeNull()
    const next: PublicV43Root = { lineage: v43.root.lineage,
      previous: v43.root.head, head: { ...progress!,
        schemaVersion: PUBLIC_V43_SCHEMA, saveRevision: 1, witness: idle } }
    expect(decodePublicV43CheckedSuccessor(v43.root, next)).not.toBeNull()
    expect(await source.commit(v43.proof, next)).toBe('committed')
    expect(await resumePublicV44(locks, target, source, 0,
      started.value.lineage)).toEqual({ ok: false, reason: 'source-changed' })
    expect(await commitPublicV44(locks, target, source, 0,
      started.value.lineage, idle)).toEqual({ ok: false,
      reason: 'source-changed' })
    expect((await target.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0 } } })

    const root = createPublicV44Root(next)
    expect(decodePublicV44Root(root)).not.toBeNull()
    expect(decodePublicV44Root({ ...root, lineage: { ...root.lineage,
      sourceRevision: 0 } })).toBeNull()
    expect(decodePublicV44Root({ ...root, head: { ...root.head,
      groundMount: { mode: 'riding', parkedPosition: null } } })).toBeNull()
    await putRaw(factory, { ...root, previous: { forged: true } })
    expect((await target.readChecked())).toEqual({ status: 'blocked',
      reason: 'invalid-v44-root' })
  })

  it('rejects extra database records and client return-home timestamps', async () => {
    const { factory, source, target } = await setup()
    const started = await startPublicV44(locks, target, source, 0)
    if (!started.ok) throw new Error(started.reason)
    expect(await commitPublicV44(locks, target, source, 0,
      started.value.lineage, { kind: 'return-home/v1', atMs: 10 } as never))
      .toEqual({ ok: false, reason: 'invalid-witness' })
    await putRaw(factory, { unexpected: true }, 'extra')
    expect((await target.readChecked())).toEqual({ status: 'blocked',
      reason: 'invalid-v44-root' })
  })

  it('persists mount and dismount witnesses with independent V44 revisions', async () => {
    const factory = new IDBFactory()
    const source = createAtomicV43Store(factory), target = createAtomicV44Store(factory)
    const old = await source.readChecked()
    if (old.status !== 'missing') throw new Error('Expected empty source')
    const mature = matureSource()
    expect(await source.commit(old.proof, mature)).toBe('invalid')
    // A legacy mature V43 save is imported only after its own checked read.
    const sourceName = 'wizard-realms:world:v43'
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(sourceName, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite')
      tx.objectStore('records').put(mature, 'root')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
    })
    db.close()
    expect((await source.readChecked()).status).toBe('valid')
    const started = await startPublicV44(locks, target, source,
      mature.head.saveRevision)
    if (!started.ok) throw new Error(started.reason)
    const mounted = await commitPublicV44(locks, target, source, 0,
      started.value.lineage, { kind: 'sedgehorn-mount/v1' })
    expect(mounted).toMatchObject({ ok: true,
      value: { head: { saveRevision: 1, groundMount: { mode: 'riding' },
        v43: { head: { saveRevision: mature.head.saveRevision } } } } })
    const reload = createAtomicV44Store(factory)
    expect(await reload.readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1, groundMount: { mode: 'riding' } } } })
    const parked = await commitPublicV44(locks, reload, source, 1,
      started.value.lineage, { kind: 'sedgehorn-dismount/v1' })
    expect(parked).toMatchObject({ ok: true,
      value: { head: { saveRevision: 2, groundMount: { mode: 'parked' },
        v43: { head: { saveRevision: mature.head.saveRevision } } } } })
    expect((await createAtomicV44Store(factory).readChecked())).toMatchObject({
      status: 'valid', root: { head: { saveRevision: 2 },
        previous: { saveRevision: 1 } } })
  }, 20_000)
})
