import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV36Store } from './atomicV36Database'
import { createAtomicV37Store } from './atomicV37Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { highlandCorridorCells, highlandLandmark } from './highlandContent'
import { HIGHLAND_WINDWARD_STEP } from './highlandWindContent'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { samePublicV14Value } from './publicWorldV14Validation'
import type { PublicV36MarkerProgress } from './publicWorldV36MarkerAction'
import { PUBLIC_V36_DATABASE_NAME, PUBLIC_V36_SCHEMA, createFreshPublicV36Root,
  decodePublicV36Root, replayPublicV36Witness } from './publicWorldV36Snapshot'
import type { PublicV36Root } from './publicWorldV36Snapshot'
import { commitPublicV37, inspectPublicV37, requestPublicV37ReturnHome, resumePublicV37,
  startFreshPublicV37, startPublicV37 } from './publicWorldV37Flow'
import { PUBLIC_V37_DATABASE_NAME, PUBLIC_V37_SCHEMA, createFreshPublicV37Root,
  createPublicV37Root, decodePublicV37CheckedSuccessor, decodePublicV37Head,
  decodePublicV37Lineage, decodePublicV37Progress, decodePublicV37Root,
  decodePublicV37Witness, replayPublicV37Witness } from './publicWorldV37Snapshot'
import type { PublicV37Root, PublicV37Witness } from './publicWorldV37Snapshot'
import { confirmPublicV37WindwardAction as confirm, decodePublicV37WindwardWitness,
  previewPublicV37WindwardAction as preview } from './publicWorldV37WindwardAction'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'

const seed = 'wizard-realms'
const study = { kind: 'windward-study/v1' as const }
const cast = { kind: 'windward-cast/v1' as const }
const checkpoint = { kind: 'checkpoint' as const }
const locks = { request: vi.fn(async (_name: string, _options: unknown,
  body: () => Promise<unknown>) => body()) }

/** Decoder-checked synthetic V36 at the real glyph, not a fresh-player journey. */
function sourceAtGlyph(zOffset = 0): PublicV36Root {
  const base = createFreshPublicV36Root(seed), glyph = highlandLandmark(seed)
  const point = { ...glyph.tile.center, z: glyph.tile.center.z + zOffset }
  const floor = resolvePublicV23Surface(base.head.state, point, [])?.floorY
  if (floor === undefined) throw new Error('Missing Quarry Crown surface')
  const ids = [...new Set([...decodeDiscoveredTileIds(base.head.state.discoveryMask),
    ...highlandCorridorCells().map(({ x, z }) => `tile-${x / 4 + 3}-${z / 4 + 3}`),
    glyph.tile.id])].sort()
  const progress: PublicV36MarkerProgress = { ...base.lineage.genesis, markerClaimReward: null,
    state: { ...base.head.state, movementOwner: 'streamed',
      highland: { ...base.head.state.highland, landmarkDiscovered: true },
      discoveryMask: encodeDiscoveredTileIds(ids), player: { ...base.head.state.player,
        position: { ...point, y: floor } } } }
  const { markerClaimReward: _marker, ...genesis } = progress
  const source: PublicV36Root = { lineage: { origin: 'v35-migration',
    rulesProfile: 'old-marker/v1', seed, sourceRevision: 9, genesis }, previous: null,
    head: { ...progress, schemaVersion: PUBLIC_V36_SCHEMA, saveRevision: 0, witness: null } }
  if (!decodePublicV36Root(source)) throw new Error('Invalid synthetic V36 glyph fixture')
  return source
}

function successor(root: PublicV37Root, witness: PublicV37Witness): PublicV37Root {
  const progress = replayPublicV37Witness(root.head, witness)
  if (!progress) throw new Error(`Rejected ${witness.kind}`)
  return { lineage: root.lineage, previous: root.head, head: { ...root.head,
    ...progress, saveRevision: root.head.saveRevision + 1, witness } }
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

describe('V37 checked Windward actions and persistence', () => {
  it('accepts only exact payload-free witnesses and leaves rejected progress untouched', () => {
    const before = createPublicV37Root(sourceAtGlyph()).head, saved = structuredClone(before)
    expect(decodePublicV37WindwardWitness(study)).toEqual(study)
    expect(decodePublicV37WindwardWitness(cast)).toEqual(cast)
    const bad = [null, { kind: 'windward-study/v1', learned: true },
      { kind: 'windward-cast/v1', activeUntilTick: 1200 },
      { kind: 'windward-cast/v1', position: before.state.player.position },
      new Proxy(study, {}), Object.create(study),
      Object.defineProperty({}, 'kind', { get: () => study.kind, enumerable: true })]
    for (const witness of bad) {
      expect(decodePublicV37WindwardWitness(witness)).toBeNull()
      expect(decodePublicV37Witness(witness)).toBeNull()
      expect(confirm(before, witness)).toEqual({ rejection: 'invalid_value' })
    }
    expect(confirm({ ...before, state: { ...before.state,
      windstep: { ...before.state.windstep, extra: true } } } as never, study))
      .toEqual({ rejection: 'invalid_progress' })
    expect(before).toEqual(saved)
  })

  it('requires discovered, revealed, close and grounded study, then refuses repeats', () => {
    const before = createPublicV37Root(sourceAtGlyph()).head
    const withState = (patch: object) => ({ ...before, state: { ...before.state, ...patch } })
    expect(confirm(withState({ highland: { ...before.state.highland,
      landmarkDiscovered: false } }), study)).toEqual({ rejection: 'undiscovered' })
    expect(confirm(withState({ discoveryMask: createFreshPublicV36Root(seed).head.state.discoveryMask }),
      study).rejection).toBe('invalid_progress')
    expect(confirm(withState({ player: { ...before.state.player,
      position: { ...before.state.player.position, y: before.state.player.position.y + 1 },
      verticalVelocity: 1 } }), study).progress).toBeUndefined()
    const remote = highlandCorridorCells().at(-1)!
    const floor = resolvePublicV23Surface(before.state, remote, [])!.floorY
    expect(confirm(withState({ player: { ...before.state.player,
      position: { ...remote, y: floor } } }), study)).toEqual({ rejection: 'too_far' })
    expect(confirm(createFreshPublicV37Root(seed).head, study).rejection).toBe('unavailable_here')
    expect(confirm(before, cast)).toEqual({ rejection: 'not_learned' })
    expect(preview(before, study)).toEqual({ rejection: null })
    const studied = confirm(before, study).progress!
    expect(studied.state.windstep).toEqual({ ...before.state.windstep, learned: true })
    expect(studied.state.tick).toBe(before.state.tick)
    expect(studied.state.eventSequence).toBe(before.state.eventSequence + 1)
    expect(studied.state.player).toEqual(before.state.player)
    expect(confirm(studied, study)).toEqual({ rejection: 'already_learned' })
  })

  it('derives paired cast clocks and enforces cooldown at active expiry and exact ready tick', () => {
    const before = confirm(createPublicV37Root(sourceAtGlyph()).head, study).progress!
    const result = confirm(before, cast)
    if (!result.progress) throw new Error(result.rejection)
    const active = result.progress, wind = active.state.windstep
    expect(wind).toEqual({ ...before.state.windstep,
      activeUntilTick: before.state.tick + HIGHLAND_WINDWARD_STEP.durationTicks,
      nextCastTick: before.state.tick + HIGHLAND_WINDWARD_STEP.cooldownTicks })
    expect(active.state.player).toEqual(before.state.player)
    expect(confirm(active, cast)).toEqual({ rejection: 'cooldown' })
    const at = (tick: number) => ({ ...active, state: { ...active.state, tick } })
    expect(confirm(at(wind.activeUntilTick), cast)).toEqual({ rejection: 'cooldown' })
    expect(confirm(at(wind.nextCastTick - 1), cast)).toEqual({ rejection: 'cooldown' })
    expect(confirm(at(wind.nextCastTick), cast).progress?.state.windstep)
      .toMatchObject({ activeUntilTick: wind.nextCastTick + 1200, nextCastTick: wind.nextCastTick + 1800 })
    const hidden = { ...before, state: { ...before.state,
      discoveryMask: createFreshPublicV36Root(seed).head.state.discoveryMask } }
    expect(confirm(hidden, cast).progress).toBeUndefined()
    const off = { x: 480, z: -432 }, surface = resolvePublicV23Surface(before.state, off, [])!
    const revealed = encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(before.state.discoveryMask), surface.tileId])].sort())
    expect(confirm({ ...before, state: { ...before.state, discoveryMask: revealed,
      player: { ...before.state.player, position: { ...off, y: surface.floorY } } } }, cast))
      .toEqual({ rejection: 'not_on_trail' })
    expect(confirm({ ...before, state: { ...before.state, tick: Number.MAX_SAFE_INTEGER } }, cast))
      .toEqual({ rejection: 'invalid_value' })
    expect(confirm({ ...before, state: { ...before.state, eventSequence: Number.MAX_SAFE_INTEGER } },
      cast)).toEqual({ rejection: 'invalid_value' })
  })

  it('uses the canonical fresh seed and keeps V36 migration detached and fully checked', () => {
    const old = sourceAtGlyph(), original = structuredClone(old)
    const root = createPublicV37Root(old), fresh = createFreshPublicV37Root(seed)
    expect(PUBLIC_V37_DATABASE_NAME).not.toBe(PUBLIC_V36_DATABASE_NAME)
    expect(root.lineage).toMatchObject({ origin: 'v36-migration', sourceRevision: 0,
      rulesProfile: 'windward-step/v1' })
    expect(decodePublicV37Root(root)).toEqual(root)
    expect(fresh.lineage).toMatchObject({ origin: 'fresh', sourceRevision: null, seed })
    expect(fresh.lineage.genesis).toEqual(createPublicV37Root(createFreshPublicV36Root(seed)).lineage.genesis)
    expect(fresh.head.schemaVersion).toBe(PUBLIC_V37_SCHEMA)
    expect(() => createFreshPublicV37Root('other-seed')).toThrow('Invalid fresh seed')
    expect(() => createPublicV37Root({ ...old, head: { ...old.head,
      state: { ...old.head.state, windstep: { ...old.head.state.windstep, learned: true } } } }))
      .toThrow('Invalid checked V36 source root')
    root.head.state.discoveryMask[0] ^= 1
    expect(old).toEqual(original)
    expect(decodePublicV37Root({ ...fresh, extra: true })).toBeNull()
    expect(decodePublicV37Lineage({ ...fresh.lineage, sourceRevision: 0 })).toBeNull()
    expect(decodePublicV37Lineage({ ...fresh.lineage,
      genesis: { ...fresh.lineage.genesis, state: { ...fresh.head.state,
        player: { ...fresh.head.state.player, coins: fresh.head.state.player.coins + 1 } } } })).toBeNull()
  })

  it('replays one checked spell edge and rejects forged learning, clocks, reward, witness and prior', () => {
    const root = createPublicV37Root(sourceAtGlyph()), studied = successor(root, study)
    const active = successor(studied, cast)
    expect(decodePublicV37Head(active.head, active.lineage)).toEqual(active.head)
    expect(decodePublicV37Progress(active.lineage.genesis)).toEqual(active.lineage.genesis)
    expect(decodePublicV37CheckedSuccessor(root, studied)).toEqual(studied)
    expect(decodePublicV37CheckedSuccessor(studied, active)).toEqual(active)
    expect(decodePublicV37Root(structuredClone(active))).toEqual(active)
    expect(decodePublicV37CheckedSuccessor(root, active)).toBeNull()
    for (const patch of [
      { state: { ...studied.head.state, windstep: root.head.state.windstep } },
      { state: { ...studied.head.state, player: { ...studied.head.state.player,
        coins: studied.head.state.player.coins + 1 } } },
      { markerClaimReward: 'coins' }, { witness: cast }, { extra: true },
    ]) expect(decodePublicV37CheckedSuccessor(root, { ...studied,
      head: { ...studied.head, ...patch } })).toBeNull()
    expect(decodePublicV37Root({ ...active, head: { ...active.head, state: { ...active.head.state,
      windstep: { ...active.head.state.windstep, activeUntilTick: 1201 } } } })).toBeNull()
    expect(decodePublicV37CheckedSuccessor(root, { ...studied,
      previous: { ...root.head, saveRevision: 1 } })).toBeNull()
    expect(replayPublicV37Witness(active.head, study)).toBeNull()
    const inherited = replayPublicV37Witness(active.head, checkpoint)
    expect(samePublicV14Value(inherited, replayPublicV36Witness(active.head, checkpoint))).toBe(true)
    expect(decodePublicV37Root(successor(active, checkpoint))).not.toBeNull()
  })

  it('starts fresh under lock, blocks malformed targets and never writes an older database', async () => {
    const factory = new IDBFactory(), store = createAtomicV37Store(factory)
    expect(await inspectPublicV37(locks as never, store)).toEqual({ ok: true,
      value: { status: 'migration-available' } })
    expect(await startFreshPublicV37(undefined, store, seed)).toEqual({ ok: false,
      reason: 'lock-unavailable' })
    const started = await startFreshPublicV37(locks as never, store, seed)
    expect(started).toMatchObject({ ok: true, value: { head: { saveRevision: 0 },
      lineage: { origin: 'fresh' } } })
    expect(await createAtomicV36Store(factory).readChecked()).toMatchObject({ status: 'missing' })
    expect(await startFreshPublicV37(locks as never, store, seed)).toEqual({ ok: false,
      reason: 'target-conflict' })
    await putRaw(factory, PUBLIC_V37_DATABASE_NAME, { forged: true })
    expect(await store.readChecked()).toEqual({ status: 'blocked', reason: 'invalid-v37-root' })
    expect(await startFreshPublicV37(locks as never, store, seed)).toEqual({ ok: false,
      reason: 'invalid-v37-root' })
    expect(locks.request).toHaveBeenCalledWith(PUBLIC_V7_LOCK_NAME,
      { mode: 'exclusive' }, expect.any(Function))
  })

  it('copies only the chosen V36 revision and saves learning, clocks and pose across close/reopen', async () => {
    const factory = new IDBFactory(), source = createAtomicV36Store(factory)
    const old = sourceAtGlyph(), original = structuredClone(old)
    await putRaw(factory, PUBLIC_V36_DATABASE_NAME, old)
    const store = createAtomicV37Store(factory)
    expect(await startPublicV37(locks as never, store, source, 1)).toEqual({ ok: false,
      reason: 'source-revision-changed' })
    expect(await startPublicV37(locks as never, store, source, -1)).toEqual({ ok: false,
      reason: 'invalid-source-revision' })
    const started = await startPublicV37(locks as never, store, source, 0)
    if (!started.ok) throw new Error(started.reason)
    const lineage = started.value.lineage
    expect(await commitPublicV37(locks as never, store, 0, lineage, cast)).toEqual({ ok: false,
      reason: 'not_learned' })
    expect(await commitPublicV37(locks as never, store, 0, lineage,
      { ...study, xp: 999 } as never)).toEqual({ ok: false, reason: 'invalid-witness' })
    expect(await commitPublicV37(locks as never, store, 0, lineage, study))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 1 } } })
    expect(await commitPublicV37(locks as never, store, 1, lineage, cast))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 2 } } })
    expect(await commitPublicV37(locks as never, store, 2, lineage, cast)).toEqual({ ok: false,
      reason: 'cooldown' })
    expect(await commitPublicV37(locks as never, store, 1, lineage, study)).toEqual({ ok: false,
      reason: 'revision-changed' })
    expect(await resumePublicV37(locks as never, createAtomicV37Store(factory), 2, lineage))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 2, state: {
        player: { position: old.head.state.player.position }, windstep: {
          learned: true, activeUntilTick: 1200, nextCastTick: 1800, practicedRouteIndices: [] } } } } })
    expect(await resumePublicV37(locks as never, store, 2, { ...lineage, seed: 'forged' }))
      .toEqual({ ok: false, reason: 'lineage-changed' })
    expect(await requestPublicV37ReturnHome(locks as never, store, 2, lineage))
      .toEqual({ ok: false, reason: 'frame-rejected' })
    expect(await source.readChecked()).toMatchObject({ status: 'valid', root: original })
  })

  it('refuses absent, blocked or falsely checked sources without creating V37 or writing V36', async () => {
    const store = createAtomicV37Store(new IDBFactory()), root = sourceAtGlyph()
    const source = { readChecked: vi.fn(async () => ({ status: 'missing' })), commit: vi.fn() }
    expect(await startPublicV37(locks as never, store, source as never, 0))
      .toEqual({ ok: false, reason: 'source-missing' })
    source.readChecked.mockResolvedValueOnce({ status: 'blocked', reason: 'invalid-v36-root' } as never)
    expect(await startPublicV37(locks as never, store, source as never, 0))
      .toEqual({ ok: false, reason: 'invalid-v36-root' })
    source.readChecked.mockResolvedValueOnce({ status: 'valid', root: {
      ...root, head: { ...root.head, extra: true } } } as never)
    expect(await startPublicV37(locks as never, store, source as never, 0))
      .toEqual({ ok: false, reason: 'invalid-source' })
    expect(await store.readChecked()).toMatchObject({ status: 'missing' })
    expect(source.commit).not.toHaveBeenCalled()
  })

  it('binds a one-use proof to one edge and rejects a cross-tab stale CAS or extra record', async () => {
    const factory = new IDBFactory(), store = createAtomicV37Store(factory)
    const root = createPublicV37Root(sourceAtGlyph()), first = await store.readChecked()
    if (first.status !== 'missing') throw new Error('Expected missing V37')
    expect(await store.commit(first.proof, root)).toBe('committed')
    expect(await store.commit(first.proof, root)).toBe('invalid')
    const left = await store.readChecked(), rightStore = createAtomicV37Store(factory)
    const right = await rightStore.readChecked()
    if (left.status !== 'valid' || right.status !== 'valid') throw new Error('Expected valid V37')
    const next = successor(root, study)
    expect(await store.commit(left.proof, next)).toBe('committed')
    expect(await rightStore.commit(right.proof, next)).toBe('revision-changed')
    const read = await rightStore.readChecked()
    if (read.status !== 'valid') throw new Error('Expected valid V37')
    expect(await rightStore.commit(read.proof, successor(successor(next, cast), checkpoint)))
      .toBe('invalid')
    expect(await rightStore.readChecked()).toMatchObject({ status: 'valid', root: {
      head: { saveRevision: 1, state: { windstep: { learned: true, activeUntilTick: 0 } } } } })
    await putRaw(factory, PUBLIC_V37_DATABASE_NAME, true, 'extra')
    expect(await rightStore.readChecked()).toEqual({ status: 'blocked', reason: 'invalid-v37-root' })
  })

  it('saves the measured assisted suffix step through checked replay and reload, preserving V36', async () => {
    const factory = new IDBFactory(), source = createAtomicV36Store(factory)
    const old = sourceAtGlyph(1), original = structuredClone(old)
    await putRaw(factory, PUBLIC_V36_DATABASE_NAME, old)
    const store = createAtomicV37Store(factory)
    const start = await startPublicV37(locks as never, store, source, 0)
    if (!start.ok) throw new Error(start.reason)
    const lineage = start.value.lineage
    const studied = await commitPublicV37(locks as never, store, 0, lineage, study)
    if (!studied.ok) throw new Error(studied.reason)
    const active = await commitPublicV37(locks as never, store, 1, lineage, cast)
    if (!active.ok) throw new Error(active.reason)
    const witness = { kind: 'frame-batch/v1' as const, frames: [{
      intents: [{ type: 'move' as const, delta: { x: 0, z: 0.16 } }], walkRequested: true }] }
    const before = active.value.head
    const ordinary = replayPublicV36Witness(before, witness)
    expect(ordinary?.state.player.position.z).toBeCloseTo(before.state.player.position.z + 0.16, 9)
    const preview = replayPublicV37Witness(before, witness)
    expect(preview?.state.player.position.z).toBeCloseTo(before.state.player.position.z + 0.20, 9)
    const moved = await commitPublicV37(locks as never, store, 2, lineage, witness)
    if (!moved.ok) throw new Error(moved.reason)
    expect(moved.value.head.state).toEqual(preview!.state)
    const reloaded = await resumePublicV37(locks as never, createAtomicV37Store(factory), 3, lineage)
    expect(reloaded).toEqual(moved)
    expect(moved.value.head.state.windstep).toEqual(before.state.windstep)
    expect(moved.value.head.state.tick).toBe(before.state.tick + 1)
    const crossing = { ...witness, frames: Array.from({ length: 14 }, () => witness.frames[0]) }
    const practiced = await commitPublicV37(locks as never, store, 3, lineage, crossing)
    if (!practiced.ok) throw new Error(practiced.reason)
    expect(practiced.value.head.state.player.position.z).toBeCloseTo(-428, 9)
    expect(practiced.value.head.state.windstep.practicedRouteIndices).toHaveLength(1)
    expect(practiced.value.head.state.player.xp).toBe(before.state.player.xp)
    expect(await resumePublicV37(locks as never, createAtomicV37Store(factory), 4, lineage))
      .toEqual(practiced)
    const retrace = { kind: 'frame-batch/v1' as const, frames: [
      { intents: [{ type: 'move' as const, delta: { x: 0, z: -0.16 } }], walkRequested: true },
      { intents: [{ type: 'move' as const, delta: { x: 0, z: 0.128 } }], walkRequested: true },
    ] }
    const repeated = await commitPublicV37(locks as never, store, 4, lineage, retrace)
    if (!repeated.ok) throw new Error(repeated.reason)
    expect(repeated.value.head.state.windstep.practicedRouteIndices)
      .toEqual(practiced.value.head.state.windstep.practicedRouteIndices)
    expect(repeated.value.head.state.player.xp).toBe(practiced.value.head.state.player.xp)
    expect(await source.readChecked()).toMatchObject({ status: 'valid', root: original })
  })
})
