import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
// Initialize V41 ancestry before the cross-version V43 module graph.
import './atomicV41Database'
import { createAtomicV42Store } from './atomicV42Database'
import { createAtomicV43Store } from './atomicV43Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { confirmPublicV43FamiliarAction } from './publicWorldV43FamiliarAction'
import { projectPublicV43MountTraining } from './publicWorldV43MountTraining'
import { commitPublicV43, inspectPublicV43, resumePublicV43,
  startFreshPublicV43, startPublicV43 } from './publicWorldV43Flow'
import { createFreshPublicV42Root, decodePublicV42Root,
  replayPublicV42Witness, PUBLIC_V42_DATABASE_NAME,
  PUBLIC_V42_SCHEMA } from './publicWorldV42Snapshot'
import type { PublicV42Root } from './publicWorldV42Snapshot'
import { createFreshPublicV43Root, createPublicV43Root,
  decodePublicV43CheckedSuccessor, decodePublicV43Root,
  decodePublicV43Witness,
  replayPublicV43Witness, PUBLIC_V43_DATABASE_NAME,
  PUBLIC_V43_SCHEMA } from './publicWorldV43Snapshot'
import type { PublicV43Root, PublicV43Witness } from './publicWorldV43Snapshot'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'
import { sameStrictBoundedRaw } from './strictBoundedRaw'
import { waystationRiverSite } from './waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const locks = { request: async (_name: string, _options: unknown,
  body: () => Promise<unknown>) => body() }
const idle = { kind: 'frame-batch/v1' as const,
  frames: [{ intents: [], walkRequested: true }] }

async function putRaw(factory: IDBFactory, name: string, raw: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').put(raw, 'root')
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}

async function getRaw(factory: IDBFactory, name: string): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const raw = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction('records', 'readonly')
    const request = tx.objectStore('records').get('root')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return raw
}

/** A checked V42 migration fixture parked at the revealed wetland clues. */
function eligibleV42(herbQuantity = 1): PublicV42Root {
  const fresh = createFreshPublicV42Root(seed)
  const site = resolveSedgehornFamiliarSite(fresh.head)!
  const bridge = waystationRiverSite(seed)!
  const anchors = [site.tracks, site.habitat, site.shelter,
    site.dryApproach, site.keeper]
  const tiles: string[] = []
  const minX = Math.floor(Math.min(...anchors.map(({ center }) => center.x))
    / WORLD_CELL_METERS) - 2
  const maxX = Math.ceil(Math.max(...anchors.map(({ center }) => center.x))
    / WORLD_CELL_METERS) + 2
  const minZ = Math.floor(Math.min(...anchors.map(({ center }) => center.z))
    / WORLD_CELL_METERS) - 2
  const maxZ = Math.ceil(Math.max(...anchors.map(({ center }) => center.z))
    / WORLD_CELL_METERS) + 2
  for (let gx = minX; gx <= maxX; gx += 1)
    for (let gz = minZ; gz <= maxZ; gz += 1)
      tiles.push(worldTileAtGrid(seed, gx, gz).id)
  const genesis = { ...fresh.lineage.genesis, southbankReached: true,
    riverBridgeIds: [bridge.id], state: { ...fresh.head.state,
      movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(fresh.head.state.discoveryMask),
        ...bridge.footprintTileIds, ...tiles,
      ])].sort()),
      player: { ...fresh.head.state.player,
        position: { ...site.tracks.center }, verticalVelocity: 0,
        inventory: [...fresh.head.state.player.inventory,
          { itemId: 'marsh_herb' as const, quantity: herbQuantity },
          { itemId: 'logs' as const, quantity: 2 }] } } }
  const root: PublicV42Root = { lineage: { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed, sourceRevision: 4, genesis },
    previous: null, head: { ...structuredClone(genesis), schemaVersion: PUBLIC_V42_SCHEMA,
      saveRevision: 0, witness: null } }
  expect(decodePublicV42Root(root)).not.toBeNull()
  return root
}

function earnedV42History(): PublicV42Root {
  const base = eligibleV42()
  const bridge = waystationRiverSite(seed)!
  const genesis = { ...base.lineage.genesis,
    ledgerSurveyBridgeId: bridge.id,
    claimedBridgeheadId: bridge.id,
    signalVantageInspected: true,
    waystationClaimed: true,
    ironHall: { ...base.lineage.genesis.ironHall, combatXp: 7 } }
  const source: PublicV42Root = { lineage: { ...base.lineage, genesis },
    previous: null, head: { ...structuredClone(genesis), schemaVersion: PUBLIC_V42_SCHEMA,
      saveRevision: 0, witness: null } }
  expect(decodePublicV42Root(source)).not.toBeNull()
  return source
}

function next43(root: PublicV43Root, witness: PublicV43Witness): PublicV43Root {
  const checkedWitness = decodePublicV43Witness(witness)
  expect(checkedWitness).not.toBeNull()
  const progress = replayPublicV43Witness(root.head, checkedWitness)
  expect(progress, `V43 rejected ${witness.kind}`).not.toBeNull()
  const next: PublicV43Root = { lineage: root.lineage, previous: root.head,
    head: { ...progress!, schemaVersion: PUBLIC_V43_SCHEMA,
      saveRevision: root.head.saveRevision + 1, witness: checkedWitness! } }
  expect(decodePublicV43CheckedSuccessor(root, next)).not.toBeNull()
  return next
}

describe('V43 familiar checked save', () => {
  it('reuses the checked succession proof for one save', async () => {
    const factory = new IDBFactory(), oldStore = createAtomicV42Store(factory)
    const store = createAtomicV43Store(factory)
    await putRaw(factory, PUBLIC_V42_DATABASE_NAME, eligibleV42())
    const started = await startPublicV43(locks as never, store, oldStore, 0)
    if (!started.ok) throw new Error(started.reason)
    const checkedReads = vi.spyOn(store, 'readChecked')
    const saved = await commitPublicV43(locks as never, store, oldStore,
      started.value.head.saveRevision, started.value.lineage,
      { kind: 'familiar-tracks/v1' })
    expect(saved).toMatchObject({ ok: true, value: { head: { saveRevision: 1 } } })
    expect(checkedReads).toHaveBeenCalledTimes(1)
    expect((await createAtomicV43Store(factory).readChecked())).toMatchObject({
      status: 'valid', root: { head: { saveRevision: 1 } } })
  })

  it('rejects a competing root change after the reused proof', async () => {
    const factory = new IDBFactory(), oldStore = createAtomicV42Store(factory)
    const store = createAtomicV43Store(factory)
    await putRaw(factory, PUBLIC_V42_DATABASE_NAME, eligibleV42())
    const started = await startPublicV43(locks as never, store, oldStore, 0)
    if (!started.ok) throw new Error(started.reason)
    const readChecked = store.readChecked.bind(store)
    let competitor: PublicV43Root | null = null
    const racingStore = { ...store, async readChecked() {
      const read = await readChecked()
      if (read.status === 'valid' && !competitor) {
        competitor = next43(read.root, { kind: 'familiar-tracks/v1' })
        await putRaw(factory, PUBLIC_V43_DATABASE_NAME, competitor)
      }
      return read
    } }
    expect(await commitPublicV43(locks as never, racingStore, oldStore,
      started.value.head.saveRevision, started.value.lineage,
      { kind: 'familiar-tracks/v1' }))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect((await store.readChecked())).toMatchObject({ status: 'valid', root: competitor })
  })

  it('rejects a V44 reservation between the reused proof and commit', async () => {
    const factory = new IDBFactory(), oldStore = createAtomicV42Store(factory)
    const store = createAtomicV43Store(factory)
    await putRaw(factory, PUBLIC_V42_DATABASE_NAME, eligibleV42())
    const started = await startPublicV43(locks as never, store, oldStore, 0)
    if (!started.ok) throw new Error(started.reason)
    const commit = store.commit.bind(store)
    const racingStore = { ...store, async commit(proof: object, next: PublicV43Root) {
      const promotion = await store.readForPromotion()
      if (promotion.status !== 'valid') throw new Error('Expected valid V43 promotion')
      expect(await store.transitionSuccessor(promotion.proof, 'pending')).toBe('committed')
      return commit(proof, next)
    } }
    expect(await commitPublicV43(locks as never, racingStore, oldStore,
      started.value.head.saveRevision, started.value.lineage,
      { kind: 'familiar-tracks/v1' }))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await store.readForPromotion()).toMatchObject({
      status: 'valid', marker: { phase: 'pending' },
      root: { head: { saveRevision: started.value.head.saveRevision } } })
  })

  it('pins a fresh canonical root and copies only a checked V42 source', () => {
    const fresh = createFreshPublicV43Root(seed)
    expect(fresh).toMatchObject({ lineage: { origin: 'fresh',
      rulesProfile: 'sedgehorn-familiar/v1', sourceRevision: null },
    head: { schemaVersion: PUBLIC_V43_SCHEMA, saveRevision: 0,
      familiar: { phase: 'search' } } })
    expect(decodePublicV43Root(fresh)).toEqual(fresh)
    expect(() => createFreshPublicV43Root('another-seed')).toThrow('Invalid fresh seed')
    expect(PUBLIC_V43_DATABASE_NAME).not.toBe(PUBLIC_V42_DATABASE_NAME)

    const source = eligibleV42(), bytes = JSON.stringify(source)
    const migrated = createPublicV43Root(source)
    expect(migrated).toMatchObject({ lineage: { origin: 'v42-migration',
      sourceRevision: source.head.saveRevision }, head: { saveRevision: 0,
        familiar: { phase: 'search' } } })
    expect(decodePublicV43Root(migrated)).toEqual(migrated)
    expect(JSON.stringify(source)).toBe(bytes)
    expect(() => createPublicV43Root({ ...source, head: { ...source.head,
      state: { ...source.head.state, tick: source.head.state.tick + 1 } } }))
      .toThrow('Invalid checked V42 source root')
  })

  it('bootstraps a fenced fresh V42 source and resumes the V43 handoff', async () => {
    const factory = new IDBFactory(), oldStore = createAtomicV42Store(factory)
    const store = createAtomicV43Store(factory)
    expect(await startFreshPublicV43(undefined, store, oldStore, seed))
      .toEqual({ ok: false, reason: 'lock-unavailable' })
    expect(await oldStore.readForPromotion()).toEqual({ status: 'missing' })
    const started = await startFreshPublicV43(locks as never, store, oldStore, seed)
    expect(started).toMatchObject({ ok: true, value: {
      head: { saveRevision: 0 }, lineage: { origin: 'v42-migration',
        sourceRevision: 0 } } })
    const promoted = await oldStore.readForPromotion()
    expect(promoted).toMatchObject({ status: 'valid',
      root: createFreshPublicV42Root(seed), marker: { phase: 'finalized',
        sourceRevision: 0 } })
    expect((await oldStore.readChecked()).status).toBe('blocked')
    expect(await startFreshPublicV43(locks as never, store, oldStore, seed))
      .toEqual(started)
    expect(await inspectPublicV43(locks as never, store, oldStore))
      .toMatchObject({ ok: true, value: { status: 'valid' } })
    expect(await resumePublicV43(locks as never, store, oldStore, 0,
      started.ok ? started.value.lineage : null)).toEqual(started)
  })

  it('requires explicit migration for an unfenced V42 save', async () => {
    const factory = new IDBFactory(), oldStore = createAtomicV42Store(factory)
    const store = createAtomicV43Store(factory), root = createFreshPublicV42Root(seed)
    await putRaw(factory, PUBLIC_V42_DATABASE_NAME, root)
    expect(await startFreshPublicV43(locks as never, store, oldStore, seed))
      .toEqual({ ok: false, reason: 'migration-required' })
    expect((await oldStore.readForPromotion())).toMatchObject({ status: 'valid',
      root, marker: null })
    expect((await store.readChecked()).status).toBe('missing')
    expect(await startPublicV43(locks as never, store, oldStore, 0))
      .toMatchObject({ ok: true })
  })

  it('recovers a pending canonical fresh marker and rejects divergent targets', async () => {
    const factory = new IDBFactory(), oldStore = createAtomicV42Store(factory)
    const store = createAtomicV43Store(factory)
    expect(await oldStore.bootstrapFreshSuccessor(seed)).toBe('committed')
    expect(await startFreshPublicV43(locks as never, store, oldStore, seed))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 0 } } })
    expect((await oldStore.readForPromotion())).toMatchObject({ status: 'valid',
      marker: { phase: 'finalized' } })

    const otherFactory = new IDBFactory()
    const otherOld = createAtomicV42Store(otherFactory)
    const otherTarget = createAtomicV43Store(otherFactory)
    expect(await otherOld.bootstrapFreshSuccessor(seed)).toBe('committed')
    const originalRoot = await getRaw(otherFactory, PUBLIC_V42_DATABASE_NAME)
    await putRaw(otherFactory, PUBLIC_V43_DATABASE_NAME,
      createFreshPublicV43Root(seed))
    expect(await startFreshPublicV43(locks as never, otherTarget, otherOld, seed))
      .toEqual({ ok: false, reason: 'target-conflict' })
    expect(await getRaw(otherFactory, PUBLIC_V42_DATABASE_NAME)).toEqual(originalRoot)
    expect((await otherOld.readForPromotion())).toMatchObject({ status: 'valid',
      marker: { phase: 'conflict' } })
  })

  it('keeps V42 absent when fresh input or an existing target is unsafe', async () => {
    const factory = new IDBFactory(), oldStore = createAtomicV42Store(factory)
    const store = createAtomicV43Store(factory)
    expect(await startFreshPublicV43(locks as never, store, oldStore, 'other'))
      .toEqual({ ok: false, reason: 'invalid-seed' })
    await putRaw(factory, PUBLIC_V43_DATABASE_NAME, createFreshPublicV43Root(seed))
    expect(await startFreshPublicV43(locks as never, store, oldStore, seed))
      .toEqual({ ok: false, reason: 'target-conflict' })
    expect(await oldStore.readForPromotion()).toEqual({ status: 'missing' })
  })

  it('rejects a marked V42 migration source as a fresh start', async () => {
    const factory = new IDBFactory(), oldStore = createAtomicV42Store(factory)
    const store = createAtomicV43Store(factory), root = eligibleV42()
    await putRaw(factory, PUBLIC_V42_DATABASE_NAME, root)
    const read = await oldStore.readForPromotion()
    if (read.status !== 'valid') throw new Error('Expected checked V42 source')
    expect(await oldStore.transitionSuccessor(read.proof, 'pending')).toBe('committed')
    const sourceBytes = JSON.stringify(await getRaw(factory, PUBLIC_V42_DATABASE_NAME))
    expect(await startFreshPublicV43(locks as never, store, oldStore, seed))
      .toEqual({ ok: false, reason: 'source-conflict' })
    expect((await oldStore.readForPromotion())).toMatchObject({ status: 'valid',
      marker: { phase: 'pending' } })
    expect(JSON.stringify(await getRaw(factory, PUBLIC_V42_DATABASE_NAME)))
      .toBe(sourceBytes)
    expect((await store.readChecked()).status).toBe('missing')
  })

  it('replays one familiar action, a grounded frame, and exact save/resume', async () => {
    const factory = new IDBFactory(), oldStore = createAtomicV42Store(factory)
    const store = createAtomicV43Store(factory), source = eligibleV42()
    const sourceBytes = JSON.stringify(source)
    await putRaw(factory, PUBLIC_V42_DATABASE_NAME, source)
    expect(sameStrictBoundedRaw(source, await getRaw(factory, PUBLIC_V42_DATABASE_NAME),
      3 << 20), `source bytes ${sourceBytes.length}`).toBe(true)
    expect(await inspectPublicV43(locks as never, store, oldStore))
      .toEqual({ ok: true, value: { status: 'migration-available' } })
    expect(await startPublicV43(locks as never, store, oldStore, 1))
      .toEqual({ ok: false, reason: 'source-revision-changed' })
    const start = await startPublicV43(locks as never, store, oldStore, 0)
    if (!start.ok) throw new Error(start.reason)
    expect(start.value.head.familiar.phase).toBe('search')
    expect(await commitPublicV43(locks as never, store, oldStore,
      start.value.head.saveRevision, start.value.lineage,
      { kind: 'familiar-tracks/v1' })).toMatchObject({ ok: true,
        value: { head: { saveRevision: 1, familiar: { phase: 'tracks' } } } })
    const afterTracks = await store.readChecked()
    if (afterTracks.status !== 'valid') throw new Error('Missing V43 root')
    expect(await commitPublicV43(locks as never, store, oldStore,
      afterTracks.root.head.saveRevision, afterTracks.root.lineage, idle))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 2 } } })
    const saved = await store.readChecked()
    if (saved.status !== 'valid') throw new Error('Missing saved V43 root')
    expect(saved.root.head.state.tick).toBe(source.head.state.tick + 1)
    expect(saved.root.head.familiar.phase).toBe('tracks')
    expect(await resumePublicV43(locks as never, store, oldStore,
      saved.root.head.saveRevision, saved.root.lineage)).toMatchObject({ ok: true,
        value: { head: { saveRevision: 2 } } })
    expect(JSON.stringify(await getRaw(factory, PUBLIC_V42_DATABASE_NAME))).toBe(sourceBytes)
    expect(await commitPublicV43(locks as never, store, oldStore,
      1, saved.root.lineage, { kind: 'familiar-tracks/v1' }))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await commitPublicV43(locks as never, store, oldStore,
      2, saved.root.lineage, { kind: 'familiar-tracks/v1' }))
      .toEqual({ ok: false, reason: 'wrong_stage' })
    expect((await store.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 2 } } })
  })

  it('recovers pending handoffs without reopening the V42 writer', async () => {
    const factory = new IDBFactory(), source = eligibleV42()
    const oldStore = createAtomicV42Store(factory), store = createAtomicV43Store(factory)
    await putRaw(factory, PUBLIC_V42_DATABASE_NAME, source)
    const bytes = JSON.stringify(await getRaw(factory, PUBLIC_V42_DATABASE_NAME))
    const before = await oldStore.readForPromotion()
    if (before.status !== 'valid') throw new Error('Expected checked source')
    expect(await oldStore.transitionSuccessor(before.proof, 'pending')).toBe('committed')
    expect((await oldStore.readChecked()).status).toBe('blocked')
    expect(await inspectPublicV43(locks as never, store, oldStore))
      .toEqual({ ok: true, value: { status: 'migration-available' } })
    expect(await startPublicV43(locks as never, store, oldStore, 0))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 0 } } })
    expect((await oldStore.readForPromotion())).toMatchObject({ status: 'valid',
      marker: { phase: 'finalized', sourceRevision: 0,
        sourceFingerprint: before.sourceFingerprint } })
    expect(JSON.stringify(await getRaw(factory, PUBLIC_V42_DATABASE_NAME))).toBe(bytes)

    const secondFactory = new IDBFactory(), secondSource = eligibleV42()
    const secondOld = createAtomicV42Store(secondFactory)
    const secondTarget = createAtomicV43Store(secondFactory)
    await putRaw(secondFactory, PUBLIC_V42_DATABASE_NAME, secondSource)
    const pending = await secondOld.readForPromotion()
    if (pending.status !== 'valid') throw new Error('Expected second checked source')
    expect(await secondOld.transitionSuccessor(pending.proof, 'pending')).toBe('committed')
    await putRaw(secondFactory, PUBLIC_V43_DATABASE_NAME,
      createPublicV43Root(secondSource))
    expect(await inspectPublicV43(locks as never, secondTarget, secondOld))
      .toMatchObject({ ok: true, value: { status: 'valid' } })
    expect((await secondOld.readForPromotion())).toMatchObject({ status: 'valid',
      marker: { phase: 'finalized' } })
  })

  it('blocks ambiguous unfenced legacy targets without freezing V42', async () => {
    const factory = new IDBFactory(), source = eligibleV42()
    const oldStore = createAtomicV42Store(factory), store = createAtomicV43Store(factory)
    const otherSource: PublicV42Root = { ...source, lineage: {
      ...source.lineage, origin: 'v41-migration', sourceRevision: 5 } }
    expect(decodePublicV42Root(otherSource)).not.toBeNull()
    expect(createPublicV43Root(otherSource).lineage)
      .toEqual(createPublicV43Root(source).lineage)
    await putRaw(factory, PUBLIC_V42_DATABASE_NAME, source)
    const legacy = createPublicV43Root(otherSource)
    await putRaw(factory, PUBLIC_V43_DATABASE_NAME, legacy)
    const legacyBytes = JSON.stringify(await getRaw(factory, PUBLIC_V43_DATABASE_NAME))
    expect(await inspectPublicV43(locks as never, store, oldStore))
      .toEqual({ ok: true, value: { status: 'blocked',
        reason: 'ambiguous-legacy-target' } })
    expect((await oldStore.readForPromotion())).toMatchObject({ status: 'valid',
      marker: null })
    expect((await oldStore.readChecked()).status).toBe('valid')
    expect(JSON.stringify(await getRaw(factory, PUBLIC_V43_DATABASE_NAME)))
      .toBe(legacyBytes)

    const conflictFactory = new IDBFactory(), conflictSource = eligibleV42()
    const conflictOld = createAtomicV42Store(conflictFactory)
    const conflictTarget = createAtomicV43Store(conflictFactory)
    await putRaw(conflictFactory, PUBLIC_V42_DATABASE_NAME, conflictSource)
    const validOther = createFreshPublicV43Root(seed)
    await putRaw(conflictFactory, PUBLIC_V43_DATABASE_NAME, validOther)
    const targetBytes = JSON.stringify(await getRaw(conflictFactory, PUBLIC_V43_DATABASE_NAME))
    expect(await inspectPublicV43(locks as never, conflictTarget, conflictOld))
      .toEqual({ ok: true, value: { status: 'blocked',
        reason: 'ambiguous-legacy-target' } })
    expect((await conflictOld.readForPromotion())).toMatchObject({ status: 'valid',
      marker: null })
    expect(JSON.stringify(await getRaw(conflictFactory, PUBLIC_V43_DATABASE_NAME)))
      .toBe(targetBytes)
  })

  it('blocks a finalized handoff whose checked target disappeared', async () => {
    const factory = new IDBFactory(), source = eligibleV42()
    const oldStore = createAtomicV42Store(factory), store = createAtomicV43Store(factory)
    await putRaw(factory, PUBLIC_V42_DATABASE_NAME, source)
    expect(await startPublicV43(locks as never, store, oldStore, 0))
      .toMatchObject({ ok: true })
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(PUBLIC_V43_DATABASE_NAME, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite')
      tx.objectStore('records').delete('root')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
    })
    db.close()
    expect(await inspectPublicV43(locks as never, store, oldStore))
      .toEqual({ ok: true, value: { status: 'blocked', reason: 'target-conflict' } })
    expect((await oldStore.readForPromotion())).toMatchObject({ status: 'valid',
      marker: { phase: 'conflict' } })
    expect((await store.readChecked()).status).toBe('missing')
  })

  it('does not fence an unfenced V42 source on a transient V43 read failure', async () => {
    const factory = new IDBFactory(), root = eligibleV42()
    const oldStore = createAtomicV42Store(factory), store = createAtomicV43Store(factory)
    const transient = { ...store, readChecked: async () =>
      ({ status: 'blocked' as const, reason: 'storage-error' }) }
    await putRaw(factory, PUBLIC_V42_DATABASE_NAME, root)
    expect(await inspectPublicV43(locks as never, transient, oldStore))
      .toEqual({ ok: true, value: { status: 'blocked', reason: 'storage-error' } })
    expect(await startPublicV43(locks as never, transient, oldStore, 0))
      .toEqual({ ok: false, reason: 'storage-error' })
    const promotion = await oldStore.readForPromotion()
    expect(promotion.status === 'valid' && promotion.marker).toBeNull()
    const checked = await oldStore.readChecked()
    if (checked.status !== 'valid') throw new Error('V42 writer unexpectedly fenced')
    const progress = replayPublicV42Witness(checked.root.head, idle)
    if (!progress) throw new Error('Expected valid V42 idle frame')
    expect(await oldStore.commit(checked.proof, { lineage: checked.root.lineage,
      previous: checked.root.head, head: { ...progress, schemaVersion: PUBLIC_V42_SCHEMA,
        saveRevision: checked.root.head.saveRevision + 1, witness: idle } }))
      .toBe('committed')
  })

  it('keeps pending and finalized markers unchanged on transient V43 read failures', async () => {
    for (const phase of ['pending', 'finalized'] as const) {
      const factory = new IDBFactory(), root = eligibleV42()
      const oldStore = createAtomicV42Store(factory), store = createAtomicV43Store(factory)
      const transient = { ...store, readChecked: async () =>
        ({ status: 'blocked' as const, reason: 'storage-error' }) }
      await putRaw(factory, PUBLIC_V42_DATABASE_NAME, root)
      if (phase === 'finalized') {
        expect(await startPublicV43(locks as never, store, oldStore, 0))
          .toMatchObject({ ok: true })
      } else {
        const read = await oldStore.readForPromotion()
        if (read.status !== 'valid') throw new Error('Expected checked V42 source')
        expect(await oldStore.transitionSuccessor(read.proof, 'pending'))
          .toBe('committed')
      }
      expect(await inspectPublicV43(locks as never, transient, oldStore))
        .toEqual({ ok: true, value: { status: 'blocked', reason: 'storage-error' } })
      expect((await oldStore.readForPromotion())).toMatchObject({ status: 'valid',
        marker: { phase } })
    }
  })

  it('rejects forged state, position, reward and payloads at replay and CAS', async () => {
    const root = createPublicV43Root(eligibleV42())
    const tracked = next43(root, { kind: 'familiar-tracks/v1' })
    expect(decodePublicV43Root(tracked)).toEqual(tracked)
    const forged = { ...tracked, head: { ...tracked.head, familiar: {
      ...tracked.head.familiar, position: { x: 999, y: 0, z: 999 } } } }
    expect(decodePublicV43Root(forged)).toBeNull()
    const reset = { ...tracked, head: { ...tracked.head,
      familiar: { ...tracked.head.familiar, phase: 'search' as const } } }
    expect(decodePublicV43Root(reset)).toBeNull()
    const inflated = { ...tracked, head: { ...tracked.head,
      state: { ...tracked.head.state, player: { ...tracked.head.state.player,
        coins: tracked.head.state.player.coins + 25 } } } }
    expect(decodePublicV43Root(inflated)).toBeNull()
    expect(replayPublicV43Witness(root.head,
      { kind: 'familiar-tracks/v1', position: { x: 0, y: 0, z: 0 } }))
      .toBeNull()
    expect(replayPublicV43Witness(root.head,
      { kind: 'familiar-claim/v1', rewardCoins: 10000 })).toBeNull()
    const extra = { ...tracked, head: { ...tracked.head, injected: true } }
    expect(decodePublicV43Root(extra)).toBeNull()
    const factory = new IDBFactory(), store = createAtomicV43Store(factory)
    const empty = await store.readChecked()
    if (empty.status !== 'missing') throw new Error('Expected missing V43')
    expect(await store.commit(empty.proof, root)).toBe('committed')
    const before = await store.readChecked()
    if (before.status !== 'valid') throw new Error('Missing V43 root')
    expect(await store.commit(before.proof, forged)).toBe('invalid')
    expect((await store.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0 } } })
  })

  it('rejects a stale atomic proof after another checked writer wins', async () => {
    const store = createAtomicV43Store(new IDBFactory())
    const first = await store.readChecked()
    const second = await store.readChecked()
    if (first.status !== 'missing' || second.status !== 'missing')
      throw new Error('Expected two missing proofs')
    const fresh = createFreshPublicV43Root(seed)
    expect(await store.commit(first.proof, fresh)).toBe('committed')
    expect(await store.commit(second.proof, fresh)).toBe('revision-changed')
    const accepted = await store.readChecked()
    const stale = await store.readChecked()
    if (accepted.status !== 'valid' || stale.status !== 'valid')
      throw new Error('Expected two valid proofs')
    const next = next43(accepted.root, idle)
    expect(await store.commit(accepted.proof, next)).toBe('committed')
    expect(await store.commit(stale.proof, next)).toBe('revision-changed')
    expect((await store.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1 } } })
  })

  it('rejects a forged rev>=3 previous that erases inherited V42 history', () => {
    let root = createPublicV43Root(earnedV42History())
    root = next43(root, idle)
    root = next43(root, idle)
    root = next43(root, idle)
    expect(root.head.saveRevision).toBe(3)
    for (const [name, edit] of [
      ['signal', (head: typeof root.head) => ({ ...head,
        signalVantageInspected: false })],
      ['ledger', (head: typeof root.head) => ({ ...head,
        ledgerSurveyBridgeId: null })],
      ['waystation', (head: typeof root.head) => ({ ...head,
        waystationClaimed: false })],
      ['combat', (head: typeof root.head) => ({ ...head,
        ironHall: { ...head.ironHall, combatXp: 0 } })],
    ] as const) {
      const previous = edit(root.previous!)
      const head = edit(root.head)
      const forged = { ...root, previous, head }
      expect(replayPublicV43Witness(previous, idle), name).not.toBeNull()
      expect(decodePublicV43Root(forged), name).toBeNull()
    }
  })

  it('documents the two-head offline history trust boundary', () => {
    let root = createPublicV43Root(eligibleV42())
    root = next43(root, idle)
    root = next43(root, idle)
    root = next43(root, idle)
    const site = resolveSedgehornFamiliarSite(root.head)!
    const fabricate = (head: typeof root.head) => ({ ...head,
      familiar: { ...head.familiar, phase: 'claimed' as const,
        routeChoice: 'shelter' as const, position: { ...site.keeper.center },
        trust: 2, creatureCareXp: 40, stationKnown: true },
      state: { ...head.state, player: { ...head.state.player,
        coins: head.state.player.coins + 25,
        xp: head.state.player.xp + 40 } } })
    const forged = { ...root, previous: fabricate(root.previous!),
      head: fabricate(root.head) }
    expect(replayPublicV43Witness(forged.previous, idle)).not.toBeNull()
    // A coherent local rewrite older than the retained pair cannot be proven
    // false from this record alone. Checked writers still reject fabricated
    // immediate successors; local IndexedDB is not an anti-cheat authority.
    expect(decodePublicV43Root(forged)).not.toBeNull()
  })

  it('saves a claim and three spaced care witnesses across reloads', async () => {
    const source = eligibleV42(4)
    let root = createPublicV43Root(source)
    root = next43(root, { kind: 'familiar-tracks/v1' })
    const site = resolveSedgehornFamiliarSite(root.head)!
    for (let index = 0; index < 210; index += 1) {
      const player = root.head.state.player.position
      if (Math.hypot(player.x - site.shelter.center.x,
        player.z - site.shelter.center.z) < 2) break
      const dx = site.shelter.center.x - player.x
      const dz = site.shelter.center.z - player.z
      const scale = Math.min(0.16, Math.hypot(dx, dz)) / Math.hypot(dx, dz)
      const witness = { kind: 'frame-batch/v1' as const,
        frames: [{ intents: [{ type: 'move' as const,
          delta: { x: dx * scale, z: dz * scale } }], walkRequested: true }] }
      const next = replayPublicV43Witness(root.head, witness)
      expect(next, `rejected frame ${index} at ${player.x}, ${player.z}`).not.toBeNull()
      root = { lineage: root.lineage, previous: root.head,
        head: { ...next!, schemaVersion: PUBLIC_V43_SCHEMA,
          saveRevision: root.head.saveRevision + 1, witness } }
    }
    expect(Math.hypot(root.head.state.player.position.x - site.shelter.center.x,
      root.head.state.player.position.z - site.shelter.center.z)).toBeLessThan(2)
    root = next43(root, { kind: 'familiar-herb/v1' })
    root = next43(root, { kind: 'familiar-shelter/v1' })
    root = next43(root, { kind: 'familiar-escort/v1' })
    const beforeJump = root.head.familiar.position
    let landed: Extract<PublicV43Witness, { kind: 'frame-batch/v1' }> | null = null
    for (let count = 1; count <= 40; count += 1) {
      const candidate = { kind: 'frame-batch/v1' as const,
        frames: [{ intents: [{ type: 'jump' as const }], walkRequested: true },
          ...Array.from({ length: count }, () => idle.frames[0])] }
      if (replayPublicV42Witness(root.head, candidate)) { landed = candidate; break }
    }
    expect(landed).not.toBeNull()
    expect(replayPublicV43Witness(root.head, { kind: 'frame-batch/v1',
      frames: landed!.frames.slice(0, -1) })).toBeNull()
    root = next43(root, landed!)
    expect(Math.hypot(root.head.familiar.position.x - beforeJump.x,
      root.head.familiar.position.z - beforeJump.z)).toBeLessThanOrEqual(0.200001)
    for (let index = 0; index < 100; index += 1) {
      if (Math.hypot(root.head.familiar.position.x - site.shelter.center.x,
        root.head.familiar.position.z - site.shelter.center.z) < 1.5) break
      root = next43(root, idle)
    }
    expect(root.head.familiar.waitReason).toBe('none')
    for (let index = 0; index < 200; index += 1) {
      const player = root.head.state.player.position
      const dx = site.keeper.center.x - player.x
      const dz = site.keeper.center.z - player.z
      const distance = Math.hypot(dx, dz)
      if (distance < 0.15) break
      const scale = Math.min(0.16, distance) / distance
      root = next43(root, { kind: 'frame-batch/v1', frames: [{
        intents: [{ type: 'move', delta: { x: dx * scale, z: dz * scale } }],
        walkRequested: true }] })
    }
    for (let index = 0; index < 100; index += 1) {
      if (Math.hypot(root.head.familiar.position.x - site.keeper.center.x,
        root.head.familiar.position.z - site.keeper.center.z) < 2.5) break
      root = next43(root, idle)
    }
    expect(Math.hypot(root.head.familiar.position.x - site.keeper.center.x,
      root.head.familiar.position.z - site.keeper.center.z)).toBeLessThan(3)
    root = next43(root, { kind: 'familiar-return/v1' })
    const returnedRoot = root
    const beforeClaim = root.head
    root = next43(root, { kind: 'familiar-claim/v1' })
    expect(root.head.familiar).toMatchObject({ phase: 'claimed',
      stationKnown: true, creatureCareXp: 40 })
    expect(root.head.state.player.coins - beforeClaim.state.player.coins).toBe(25)
    expect(root.head.state.player.xp - beforeClaim.state.player.xp).toBe(40)
    expect(decodePublicV43Root(root)).not.toBeNull()
    const factory = new IDBFactory(), store = createAtomicV43Store(factory)
    const oldStore = createAtomicV42Store(factory)
    await putRaw(factory, PUBLIC_V42_DATABASE_NAME, source)
    expect(await startPublicV43(locks as never, store, oldStore, 0))
      .toMatchObject({ ok: true })
    await putRaw(factory, PUBLIC_V43_DATABASE_NAME, returnedRoot)
    expect(await commitPublicV43(locks as never, store, oldStore,
      returnedRoot.head.saveRevision, returnedRoot.lineage,
      { kind: 'familiar-claim/v1' })).toMatchObject({ ok: true,
        value: { head: { saveRevision: root.head.saveRevision,
          familiar: { phase: 'claimed' } } } })
    const saved = await store.readChecked()
    expect(saved.status).toBe('valid')
    if (saved.status !== 'valid') return
    expect(await resumePublicV43(locks as never, store, oldStore,
      root.head.saveRevision, root.lineage)).toMatchObject({ ok: true,
        value: { head: { familiar: { phase: 'claimed' } } } })
    expect(await commitPublicV43(locks as never, store, oldStore,
      root.head.saveRevision, root.lineage, { kind: 'familiar-claim/v1' }))
      .toEqual({ ok: false, reason: 'already_claimed' })
    const after = await store.readChecked()
    expect(after.status).toBe('valid')
    if (after.status === 'valid') {
      expect(after.root.head.state.player.coins).toBe(root.head.state.player.coins)
      expect(after.root.head.saveRevision).toBe(root.head.saveRevision)
    }
    if (after.status !== 'valid') throw new Error('Missing claimed root')
    expect(Object.hasOwn(after.root.head, 'mountTraining')).toBe(false)
    let careRoot = after.root
    for (let index = 0; index < 210; index += 1) {
      const player = careRoot.head.state.player.position
      const dx = site.careStation.center.x - player.x
      const dz = site.careStation.center.z - player.z
      const distance = Math.hypot(dx, dz)
      if (distance < 2) break
      const scale = Math.min(0.16, distance) / distance
      careRoot = next43(careRoot, { kind: 'frame-batch/v1', frames: [{
        intents: [{ type: 'move', delta: { x: dx * scale, z: dz * scale } }],
        walkRequested: true }] })
    }
    expect(Math.hypot(careRoot.head.state.player.position.x - site.careStation.center.x,
      careRoot.head.state.player.position.z - site.careStation.center.z)).toBeLessThan(2)
    await putRaw(factory, PUBLIC_V43_DATABASE_NAME, careRoot)
    expect((await store.readChecked()).status).toBe('valid')

    let head = careRoot.head
    const save = async (witness: PublicV43Witness) => {
      const result = await commitPublicV43(locks as never, store, oldStore,
        head.saveRevision, careRoot.lineage, witness)
      expect(result, `rejected ${witness.kind}`).toMatchObject({ ok: true })
      if (!result.ok) throw new Error(result.reason)
      head = result.value.head
      return head
    }
    const waitTicks = async (ticks: number) => {
      while (ticks > 0) {
        const count = Math.min(ticks, 128)
        await save({ kind: 'frame-batch/v1',
          frames: Array.from({ length: count }, () => idle.frames[0]) })
        ticks -= count
      }
    }
    const care = { kind: 'sedgehorn-care/v1' } as const
    const startingXp = head.state.player.xp
    const firstCare = await save(care)
    expect(firstCare.mountTraining?.careWitnesses).toEqual([{ ...care,
      tick: careRoot.head.state.tick,
      eventSequence: careRoot.head.state.eventSequence + 1 }])
    expect(projectPublicV43MountTraining(firstCare)).toMatchObject({ careCount: 1,
      careXp: 5, mature: false })
    expect(await commitPublicV43(locks as never, store, oldStore,
      firstCare.saveRevision - 1, careRoot.lineage, care))
      .toEqual({ ok: false, reason: 'revision-changed' })
    const firstRead = await store.readChecked()
    expect(firstRead).toMatchObject({ status: 'valid',
      root: { head: { mountTraining: firstCare.mountTraining } } })
    await waitTicks(599)
    const beforeTooSoon = JSON.stringify(await getRaw(factory, PUBLIC_V43_DATABASE_NAME))
    expect(await commitPublicV43(locks as never, store, oldStore,
      head.saveRevision, careRoot.lineage, care))
      .toEqual({ ok: false, reason: 'too_soon' })
    expect(JSON.stringify(await getRaw(factory, PUBLIC_V43_DATABASE_NAME)))
      .toBe(beforeTooSoon)
    const held = await store.readChecked()
    if (held.status !== 'valid') throw new Error('Missing held care root')
    const { mountTraining: _removed, ...withoutMount } = held.root.head
    expect(decodePublicV43Root({ ...held.root, head: withoutMount })).toBeNull()
    await waitTicks(1)
    const secondCare = await save(care)
    expect(projectPublicV43MountTraining(secondCare)).toMatchObject({ careCount: 2,
      careXp: 10, mature: false })
    await waitTicks(600)
    const thirdCare = await save(care)
    expect(thirdCare.mountTraining?.careWitnesses.map(({ tick }) => tick))
      .toEqual([firstCare.state.tick, firstCare.state.tick + 600,
        firstCare.state.tick + 1200])
    expect(projectPublicV43MountTraining(thirdCare)).toEqual({ careCount: 3,
      careXp: 15, lastCareTick: firstCare.state.tick + 1200, mature: true })
    expect(thirdCare.state.player.xp).toBe(startingXp)
    expect(thirdCare.familiar.creatureCareXp).toBe(40)
    expect(thirdCare.state.player.inventory.filter(({ itemId }) =>
      itemId === 'marsh_herb')).toEqual([])
    const reloaded = await store.readChecked()
    if (reloaded.status !== 'valid') throw new Error('Missing mature care root')
    expect(reloaded.root.head).toEqual(thirdCare)
    expect(await resumePublicV43(locks as never, store, oldStore,
      thirdCare.saveRevision, careRoot.lineage)).toMatchObject({ ok: true,
        value: { head: { mountTraining: thirdCare.mountTraining } } })
    expect(await commitPublicV43(locks as never, store, oldStore,
      thirdCare.saveRevision, careRoot.lineage, care))
      .toEqual({ ok: false, reason: 'already_mature' })
    const forgedCounter = { ...reloaded.root, head: { ...thirdCare,
      mountTraining: { ...thirdCare.mountTraining, careCount: 3 } } }
    expect(decodePublicV43Root(forgedCounter)).toBeNull()
    const forgedPast = { ...reloaded.root, head: { ...thirdCare,
      mountTraining: { careWitnesses: thirdCare.mountTraining!.careWitnesses
        .map((event, index) => index === 0 ? { ...event, tick: event.tick + 1 }
          : event) } } }
    expect(decodePublicV43Root(forgedPast)).toBeNull()
    expect(await store.commit(reloaded.proof, forgedPast as PublicV43Root)).toBe('invalid')
  }, 300000)

  it('rejects malformed progress, blocked target and failed migration without V42 writes', async () => {
    const source = eligibleV42(), bytes = JSON.stringify(source)
    const factory = new IDBFactory(), oldStore = createAtomicV42Store(factory)
    const store = createAtomicV43Store(factory)
    await putRaw(factory, PUBLIC_V42_DATABASE_NAME, source)
    await putRaw(factory, PUBLIC_V43_DATABASE_NAME, { malformed: true })
    expect(await store.readChecked()).toEqual({ status: 'blocked',
      reason: 'invalid-v43-root' })
    expect(await startPublicV43(locks as never, store, oldStore, 0))
      .toEqual({ ok: false, reason: 'invalid-v43-root' })
    expect(JSON.stringify(source)).toBe(bytes)
    const oldRead = await oldStore.readChecked()
    expect(oldRead.status).toBe('valid')
    expect(JSON.stringify(await getRaw(factory, PUBLIC_V42_DATABASE_NAME))).toBe(bytes)
    const missing = createAtomicV42Store(new IDBFactory())
    expect(await startPublicV43(locks as never,
      createAtomicV43Store(new IDBFactory()), missing, 0))
      .toEqual({ ok: false, reason: 'source-missing' })
    const badFactory = new IDBFactory()
    await putRaw(badFactory, PUBLIC_V42_DATABASE_NAME, { malformed: true })
    const untouched = createAtomicV43Store(badFactory)
    expect(await startPublicV43(locks as never, untouched,
      createAtomicV42Store(badFactory), 0))
      .toEqual({ ok: false, reason: 'invalid-v42-root' })
    expect((await untouched.readChecked()).status).toBe('missing')
  })
})
