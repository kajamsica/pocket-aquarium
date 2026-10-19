import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV37Store } from './atomicV37Database'
import { createAtomicV38Store } from './atomicV38Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { highlandCorridorCells, highlandLandmark } from './highlandContent'
import { highlandSignalVane } from './highlandSignalContent'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { samePublicV14Value } from './publicWorldV14Validation'
import { commitPublicV38, inspectPublicV38, resumePublicV38,
  startFreshPublicV38, startPublicV38 } from './publicWorldV38Flow'
import { PUBLIC_V37_DATABASE_NAME, PUBLIC_V37_SCHEMA, createFreshPublicV37Root,
  decodePublicV37Root } from './publicWorldV37Snapshot'
import type { PublicV37Root } from './publicWorldV37Snapshot'
import { PUBLIC_V38_DATABASE_NAME, PUBLIC_V38_SCHEMA, createFreshPublicV38Root,
  createPublicV38Root, decodePublicV38CheckedSuccessor, decodePublicV38Root,
  decodePublicV38Witness, replayPublicV38Witness } from './publicWorldV38Snapshot'
import type { PublicV38Root, PublicV38Witness } from './publicWorldV38Snapshot'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'

const seed = 'wizard-realms'
const inspect = { kind: 'signal-vantage/v1' as const }
const claim = { kind: 'signal-claim/v1' as const }
const study = { kind: 'windward-study/v1' as const }
const cast = { kind: 'windward-cast/v1' as const }
const idle = { kind: 'frame-batch/v1' as const, frames: [{ intents: [], walkRequested: true }] }
const locks = { request: vi.fn(async (_name: string, _options: unknown,
  body: () => Promise<unknown>) => body()) }

/** Checked V37 source fixture at an authored landmark, not a fresh-player journey. */
function v37At(which: 'crown' | 'vane', wind = false, tick = 0): PublicV37Root {
  const fresh = createFreshPublicV37Root(seed)
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...base } = fresh.head
  const tile = which === 'vane' ? highlandSignalVane(seed).tile : highlandLandmark(seed).tile
  const state = { ...base.state, tick, movementOwner: 'streamed' as const,
    highland: { ...base.state.highland, landmarkDiscovered: true },
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(base.state.discoveryMask),
      ...highlandCorridorCells().map(({ x, z }) => `tile-${x / 4 + 3}-${z / 4 + 3}`),
      tile.id])].sort()),
    windstep: wind ? { learned: true, activeUntilTick: 1200, nextCastTick: 1800,
      practicedRouteIndices: [highlandSignalVane(seed).routeIndex - 1] }
      : base.state.windstep }
  const floor = resolvePublicV23Surface(state, tile.center, [])?.floorY
  if (floor === undefined) throw new Error('Missing authored landmark surface')
  const progress = { ...base, state: { ...state, player: { ...state.player,
    position: { ...tile.center, y: floor } } } }
  const source: PublicV37Root = { lineage: { origin: 'v36-migration',
    rulesProfile: 'windward-step/v1', seed, sourceRevision: 9, genesis: progress },
  previous: null, head: { ...progress, schemaVersion: PUBLIC_V37_SCHEMA,
    saveRevision: 0, witness: null } }
  if (!decodePublicV37Root(source)) throw new Error('Invalid checked V37 fixture')
  return source
}

function successor(root: PublicV38Root, witness: PublicV38Witness): PublicV38Root {
  const progress = replayPublicV38Witness(root.head, witness)
  if (!progress) throw new Error(`Rejected ${witness.kind}`)
  return { lineage: root.lineage, previous: root.head, head: { ...progress,
    schemaVersion: PUBLIC_V38_SCHEMA, saveRevision: root.head.saveRevision + 1, witness } }
}

async function putRaw(factory: IDBFactory, name: string, raw: unknown, key = 'root') {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('records', 'readwrite')
    tx.objectStore('records').put(raw, key)
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  database.close()
}

describe('V38 checked migration and three-slot replay', () => {
  it('pins fresh genesis and copies only a checked V37 head without changing its source', () => {
    const fresh = createFreshPublicV38Root(seed), source = v37At('crown')
    const original = structuredClone(source), copied = createPublicV38Root(source)
    expect(PUBLIC_V38_DATABASE_NAME).not.toBe(PUBLIC_V37_DATABASE_NAME)
    expect(fresh).toMatchObject({ lineage: { origin: 'fresh', sourceRevision: null,
      rulesProfile: 'highland-signal/v1' }, head: { schemaVersion: PUBLIC_V38_SCHEMA,
      saveRevision: 0, signalVantageInspected: false, signalClaimed: false } })
    expect(decodePublicV38Root(fresh)).toEqual(fresh)
    expect(copied).toMatchObject({ lineage: { origin: 'v37-migration', sourceRevision: 0,
      rulesProfile: 'highland-signal/v1' }, head: { saveRevision: 0,
        signalVantageInspected: false, signalClaimed: false } })
    expect(copied.head.state).toEqual(source.head.state)
    expect(decodePublicV38Root(copied)).toEqual(copied)
    expect(source).toEqual(original)
    copied.head.state.discoveryMask[0] ^= 1
    expect(source).toEqual(original)
    expect(() => createFreshPublicV38Root('other-seed')).toThrow('Invalid fresh seed')
    expect(() => createPublicV38Root({ ...source,
      head: { ...source.head, saveRevision: 1 } })).toThrow('Invalid checked V37 source root')
    expect(decodePublicV38Root({ ...fresh, extra: true })).toBeNull()
    expect(decodePublicV38Root({ ...fresh, head: { ...fresh.head,
      signalClaimed: true } })).toBeNull()
    expect(decodePublicV38Root({ ...fresh, lineage: { ...fresh.lineage,
      sourceRevision: 0 } })).toBeNull()
  })

  it('replays inherited study, cast and frames while preserving both V38 flags', () => {
    const crown = createPublicV38Root(v37At('crown'))
    const studied = successor(crown, study), active = successor(studied, cast)
    expect(decodePublicV38CheckedSuccessor(crown, studied)).toEqual(studied)
    expect(decodePublicV38CheckedSuccessor(studied, active)).toEqual(active)
    expect(active.head.state.windstep.learned).toBe(true)
    expect(active.head.state.windstep.activeUntilTick).toBe(1200)
    expect(active.head.signalVantageInspected).toBe(false)
    expect(active.head.signalClaimed).toBe(false)
    expect(decodePublicV38Root(active)).toEqual(active)
    const vantage = createPublicV38Root(v37At('vane', true))
    const inspected = successor(vantage, inspect), moved = successor(inspected, idle)
    expect(inspected.head.signalVantageInspected).toBe(true)
    expect(moved.head.signalVantageInspected).toBe(true)
    expect(moved.head.signalClaimed).toBe(false)
    expect(decodePublicV38CheckedSuccessor(inspected, moved)).toEqual(moved)
    expect(decodePublicV38Root(moved)).toEqual(moved)
    expect(decodePublicV38CheckedSuccessor(inspected, { ...moved,
      head: { ...moved.head, signalVantageInspected: false } })).toBeNull()
    expect(decodePublicV38CheckedSuccessor(inspected, { ...moved,
      previous: vantage.head })).toBeNull()
    expect(decodePublicV38Root({ ...moved, head: { ...moved.head,
      state: { ...moved.head.state, player: { ...moved.head.state.player,
        coins: moved.head.state.player.coins + 30 } } } })).toBeNull()
    expect(decodePublicV38Witness({ ...inspect, position: vantage.head.state.player.position }))
      .toBeNull()
    expect(decodePublicV38Witness({ ...claim, reward: 30 })).toBeNull()
  })

  it('starts fresh only in an empty V38 store and refuses missing or blocked V37 sources', async () => {
    const factory = new IDBFactory(), source = createAtomicV37Store(factory)
    const target = createAtomicV38Store(factory)
    expect(await startPublicV38(locks as never, target, source, 0)).toEqual({ ok: false,
      reason: 'source-missing' })
    expect(await target.readChecked()).toMatchObject({ status: 'missing' })
    expect(await startFreshPublicV38(undefined, target, seed)).toEqual({ ok: false,
      reason: 'lock-unavailable' })
    expect(await startFreshPublicV38(locks as never, target, seed)).toMatchObject({ ok: true,
      value: { head: { saveRevision: 0 }, lineage: { origin: 'fresh' } } })
    expect(await source.readChecked()).toMatchObject({ status: 'missing' })
    const malformedFactory = new IDBFactory()
    await putRaw(malformedFactory, PUBLIC_V37_DATABASE_NAME, { invalid: true })
    const blockedSource = createAtomicV37Store(malformedFactory)
    const untouched = createAtomicV38Store(malformedFactory)
    expect(await startPublicV38(locks as never, untouched, blockedSource, 0))
      .toEqual({ ok: false, reason: 'invalid-v37-root' })
    expect(await untouched.readChecked()).toMatchObject({ status: 'missing' })
  })

  it('blocks malformed targets, stale migration revisions, and stale CAS without writing V37', async () => {
    const factory = new IDBFactory(), source = createAtomicV37Store(factory)
    const original = v37At('crown')
    await putRaw(factory, PUBLIC_V37_DATABASE_NAME, original)
    const target = createAtomicV38Store(factory)
    expect(await inspectPublicV38(locks as never, target)).toEqual({ ok: true,
      value: { status: 'migration-available' } })
    expect(await startPublicV38(locks as never, target, source, 1)).toEqual({ ok: false,
      reason: 'source-revision-changed' })
    expect(await startPublicV38(locks as never, target, source, -1)).toEqual({ ok: false,
      reason: 'invalid-source-revision' })
    const started = await startPublicV38(locks as never, target, source, 0)
    if (!started.ok) throw new Error(started.reason)
    expect(started.value.lineage).toMatchObject({ origin: 'v37-migration', sourceRevision: 0 })
    expect(await startPublicV38(locks as never, target, source, 0)).toEqual({ ok: false,
      reason: 'target-conflict' })
    expect(await source.readChecked()).toMatchObject({ status: 'valid', root: original })
    const other = createAtomicV38Store(factory), left = await target.readChecked()
    const right = await other.readChecked()
    if (left.status !== 'valid' || right.status !== 'valid') throw new Error('Expected checked V38')
    const next = successor(left.root, study)
    expect(await target.commit(left.proof, next)).toBe('committed')
    expect(await target.commit(left.proof, next)).toBe('invalid')
    expect(await other.commit(right.proof, next)).toBe('revision-changed')
    expect(await resumePublicV38(locks as never, other, 0, started.value.lineage))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await resumePublicV38(locks as never, other, 1, started.value.lineage))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 1 } } })
    await putRaw(factory, PUBLIC_V38_DATABASE_NAME, { invalid: true })
    expect(await target.readChecked()).toEqual({ status: 'blocked', reason: 'invalid-v38-root' })
    expect(await startFreshPublicV38(locks as never, target, seed)).toEqual({ ok: false,
      reason: 'invalid-v38-root' })
    expect(await source.readChecked()).toMatchObject({ status: 'valid', root: original })
    expect(locks.request).toHaveBeenCalledWith(PUBLIC_V7_LOCK_NAME,
      { mode: 'exclusive' }, expect.any(Function))
  })

  it('saves one claimed edge and reloads it, then refuses repeat and forged reward', async () => {
    const factory = new IDBFactory(), store = createAtomicV38Store(factory)
    const base = createPublicV38Root(v37At('crown', true, 1800))
    // Three-slot saves can carry a pruned, checked earlier journey. This fixture
    // models the returned Crown head, not the player's full route to the vane.
    const returned = { ...base.head, signalVantageInspected: true,
      saveRevision: 2, witness: { kind: 'checkpoint' as const } }
    const preclaim = { lineage: base.lineage, previous: returned,
      head: { ...returned, saveRevision: 3 } } as PublicV38Root
    expect(decodePublicV38Root(preclaim)).toEqual(preclaim)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected empty V38 store')
    expect(await store.commit(missing.proof, preclaim)).toBe('invalid')
    await putRaw(factory, PUBLIC_V38_DATABASE_NAME, preclaim)
    const committed = await commitPublicV38(locks as never, store, 3, base.lineage, claim)
    if (!committed.ok) throw new Error(committed.reason)
    const claimed = committed.value.head
    expect(claimed.saveRevision).toBe(4)
    expect(claimed.state.player.coins).toBe(returned.state.player.coins + 30)
    expect(claimed.state.player.xp).toBe(returned.state.player.xp + 35)
    expect(claimed.state.player.skillXp.spellcraft)
      .toBe(returned.state.player.skillXp.spellcraft + 35)
    const reloaded = await createAtomicV38Store(factory).readChecked()
    expect(reloaded).toMatchObject({ status: 'valid', root: { head: {
      saveRevision: 4, signalVantageInspected: true, signalClaimed: true } } })
    expect(await commitPublicV38(locks as never, store, 4, base.lineage, claim))
      .toEqual({ ok: false, reason: 'already_claimed' })
    expect(await commitPublicV38(locks as never, store, 3, base.lineage, claim))
      .toEqual({ ok: false, reason: 'revision-changed' })
    if (reloaded.status !== 'valid') throw new Error('Expected checked V38 reload')
    const forged = { ...reloaded.root, head: { ...claimed, state: {
      ...claimed.state, player: { ...claimed.state.player,
        coins: claimed.state.player.coins + 1 } } } }
    expect(decodePublicV38Root(forged)).toBeNull()
    expect(samePublicV14Value(reloaded.root.head, claimed)).toBe(true)
    const resumed = await commitPublicV38(locks as never, store, 4, base.lineage, idle)
    if (!resumed.ok) throw new Error(resumed.reason)
    expect(resumed.value.head).toMatchObject({ saveRevision: 5,
      signalVantageInspected: true, signalClaimed: true })
    expect(await createAtomicV38Store(factory).readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 5, signalVantageInspected: true, signalClaimed: true } } })
    const recast = await commitPublicV38(locks as never, store, 5, base.lineage, cast)
    if (!recast.ok) throw new Error(recast.reason)
    expect(recast.value.head).toMatchObject({ saveRevision: 6,
      signalVantageInspected: true, signalClaimed: true })
    expect(recast.value.head.state.windstep.activeUntilTick).toBe(3001)
    expect(await createAtomicV38Store(factory).readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 6, signalVantageInspected: true, signalClaimed: true } } })
  })
})
