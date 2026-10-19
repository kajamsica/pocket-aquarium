import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV17Store } from './atomicV17Database'
import { createAtomicV23Store } from './atomicV23Database'
import { createAtomicV24Store } from './atomicV24Database'
import { encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS,
  PUBLIC_SPELL_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { applyPublicV24MireglassAction } from './publicWorldV24MireglassAction'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { encodePublicV17Head, PUBLIC_V17_DATABASE_NAME } from './publicWorldV17Snapshot'
import { commitPublicV17Snapshot, startFreshPublicV17 } from './publicWorldV17Flow'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import { commitPublicV23, inspectPublicV23, startPublicV23 } from './publicWorldV23Flow'
import { PUBLIC_V24_DATABASE_NAME } from './publicWorldV24Snapshot'
import { commitPublicV24, inspectPublicV24, inspectPublicV24UnderLock, resumePublicV24,
  startFreshPublicV24World, startPublicV24 } from './publicWorldV24Flow'

const seed = 'greenway-alpha'
function locks() {
  let active = false
  return { request: async <T,>(name: string, _options: { mode: 'exclusive' }, body: () => T | Promise<T>) => {
    expect(name).toBe(PUBLIC_V7_LOCK_NAME)
    if (active) throw new Error('Nested lock')
    active = true
    try { return await body() } finally { active = false }
  } }
}
function stores() {
  const factory = new IDBFactory()
  return { factory, gate: locks(), v17: createAtomicV17Store(factory),
    v23: createAtomicV23Store(factory), v24: createAtomicV24Store(factory) }
}
function inspectWhileLocked(world: ReturnType<typeof stores>) {
  return world.gate.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' },
    () => inspectPublicV24UnderLock(world.v24, world.v23, world.v17))
}
async function putRecord(factory: IDBFactory, name: string, key: string, value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').put(value, key)
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  }) } finally { db.close() }
}
async function promoted(world: ReturnType<typeof stores>) {
  const v23 = await startPublicV23(world.gate, world.v23, world.v17, seed, null)
  if (!v23.ok) throw new Error(v23.reason)
  const inspected = await inspectPublicV24(world.gate, world.v24, world.v23, world.v17)
  if (!inspected.ok || inspected.value.status !== 'migration-available') throw new Error('Missing V23 receipt')
  const v24 = await startPublicV24(world.gate, world.v24, world.v23, world.v17,
    seed, inspected.value.sourceReceipt)
  if (!v24.ok) throw new Error(v24.reason)
  return { v23: v23.value, v24: v24.value }
}

describe('V24 source-pinned flow', () => {
  it('returns public inspection parity under one caller-owned lock without leaking proofs', async () => {
    const world = stores()
    expect(await inspectWhileLocked(world)).toEqual({ status: 'blocked', reason: 'source-v23-missing' })
    const v23 = await startPublicV23(world.gate, world.v23, world.v17, seed, null)
    if (!v23.ok) throw new Error(v23.reason)
    const available = await inspectWhileLocked(world)
    expect(available).toEqual({ status: 'migration-available', sourceReceipt: v23.value })
    expect(await inspectPublicV24(world.gate, world.v24, world.v23, world.v17))
      .toEqual({ ok: true, value: available })
    expect(Object.keys(available).sort()).toEqual(['sourceReceipt', 'status'])
    const started = await startPublicV24(world.gate, world.v24, world.v23, world.v17,
      seed, { head: v23.value.head, lineage: v23.value.lineage })
    if (!started.ok) throw new Error(started.reason)
    const valid = await inspectWhileLocked(world)
    expect(valid).toEqual({ status: 'valid', start: started.value })
    expect(Object.keys(valid).sort()).toEqual(['start', 'status'])
    expect(await inspectPublicV24(world.gate, world.v24, world.v23, world.v17))
      .toEqual({ ok: true, value: valid })
  })

  it('acquires one non-nested world lock for checked fresh genesis', async () => {
    const world = stores()
    let acquisitions = 0, active = false
    const counting = { request: async <T,>(name: string, options: { mode: 'exclusive' },
      body: () => T | Promise<T>): Promise<T> => {
      expect(name).toBe(PUBLIC_V7_LOCK_NAME)
      expect(options).toEqual({ mode: 'exclusive' })
      expect(active).toBe(false)
      acquisitions++
      active = true
      try { return await body() } finally { active = false }
    } }
    const started = await startFreshPublicV24World(counting, world.v24, world.v23,
      world.v17, seed)
    expect(acquisitions).toBe(1)
    if (!started.ok) throw new Error(started.reason)
    expect(await world.v17.readChecked()).toMatchObject({ status: 'ok',
      head: expect.anything() })
    expect((await world.v23.readChecked()).status).toBe('valid')
    expect((await world.v24.readChecked()).status).toBe('valid')
  })

  it('requires V23, migrates without modifying it, replays a checkpoint, and rejects stale CAS revision', async () => {
    const world = stores()
    expect(await inspectPublicV24(world.gate, world.v24, world.v23, world.v17))
      .toEqual({ ok: true, value: { status: 'blocked', reason: 'source-v23-missing' } })
    const { v23, v24 } = await promoted(world)
    expect(v24.head.state).toEqual(v23.head.state)
    expect(v24.lineage.sourceReceipt).toEqual(v23)
    expect((await inspectPublicV23(world.gate, world.v23, world.v17)))
      .toEqual({ ok: true, value: { status: 'valid', start: v23 } })
    const phases: Array<{ phase: string; durationMs: number }> = []
    const saved = await commitPublicV24(world.gate, world.v24, world.v23, world.v17,
      0, v24.lineage, { kind: 'checkpoint' }, (sample) => { phases.push(sample) })
    if (!saved.ok) throw new Error(saved.reason)
    expect(saved.value.head.saveRevision).toBe(1)
    expect(phases.map((sample) => sample.phase)).toEqual([
      'lock-wait', 'v24-validated-cache-hit', 'v24-checked-read',
      'v23-checked-read', 'v17-source-inspection', 'source-receipt-compare',
      'v23-v17-source-inspection', 'witness-apply',
      'atomic-candidate-preflight', 'idb-open', 'cas-read-put', 'transaction-completion'])
    for (const sample of phases) {
      expect(Object.keys(sample).sort()).toEqual(['durationMs', 'phase'])
      expect(Number.isFinite(sample.durationMs)).toBe(true)
      expect(sample.durationMs).toBeGreaterThanOrEqual(0)
    }
    expect(await resumePublicV24(world.gate, createAtomicV24Store(world.factory), world.v23,
      world.v17, 1, v24.lineage)).toEqual(saved)
    expect(await commitPublicV24(world.gate, world.v24, world.v23, world.v17,
      0, v24.lineage, { kind: 'checkpoint' }, () => { throw new Error('trace failed') }))
      .toEqual({ ok: false, reason: 'revision-changed' })
    const savedWithBrokenTrace = await commitPublicV24(world.gate, world.v24, world.v23,
      world.v17, 1, v24.lineage, { kind: 'checkpoint' }, () => { throw new Error('trace failed') })
    expect(savedWithBrokenTrace.ok).toBe(true)
    if (savedWithBrokenTrace.ok) expect(savedWithBrokenTrace.value.head.saveRevision).toBe(2)
    expect((await world.v23.readChecked())).toMatchObject({ status: 'valid', root: v23 })
  })

  it('fails closed on source drift and on a partial V24 target without changing either root', async () => {
    const world = stores(), { v23, v24 } = await promoted(world)
    const targetBefore = await world.v24.readChecked()
    if (targetBefore.status !== 'valid') throw new Error('Missing promoted target')
    const advanced = await commitPublicV23(world.gate, world.v23, world.v17,
      0, v23.lineage, { kind: 'checkpoint' })
    expect(advanced.ok).toBe(true)
    expect(await inspectPublicV24(world.gate, world.v24, world.v23, world.v17))
      .toEqual({ ok: true, value: { status: 'blocked', reason: 'source-changed' } })
    expect(await inspectWhileLocked(world)).toEqual({ status: 'blocked', reason: 'source-changed' })
    expect(await resumePublicV24(world.gate, world.v24, world.v23, world.v17,
      0, v24.lineage)).toEqual({ ok: false, reason: 'source-changed' })
    expect(await world.v24.readChecked()).toMatchObject({ status: 'valid', root: targetBefore.root })

    const partial = stores()
    await startPublicV23(partial.gate, partial.v23, partial.v17, seed, null)
    await putRecord(partial.factory, PUBLIC_V24_DATABASE_NAME, 'stray', { incomplete: true })
    expect(await inspectPublicV24(partial.gate, partial.v24, partial.v23, partial.v17))
      .toEqual({ ok: true, value: { status: 'blocked', reason: 'invalid-v24-root' } })
    expect(await inspectWhileLocked(partial)).toEqual({ status: 'blocked', reason: 'invalid-v24-root' })
  })

  it('rejects transitive V17 source drift through the under-lock V23 inspection', async () => {
    const world = stores(), source = await startFreshPublicV17(world.gate, world.v17, seed)
    if (!source.ok) throw new Error(source.reason)
    expect(await inspectPublicV24(world.gate, world.v24, world.v23, world.v17))
      .toEqual({ ok: true, value: { status: 'blocked', reason: 'source-v23-missing' } })
    const inspected = await inspectPublicV23(world.gate, world.v23, world.v17)
    if (!inspected.ok || inspected.value.status !== 'migration-available') throw new Error('Missing V17 receipt')
    const v23 = await startPublicV23(world.gate, world.v23, world.v17,
      seed, inspected.value.sourceReceipt)
    if (!v23.ok) throw new Error(v23.reason)
    const v24 = await startPublicV24(world.gate, world.v24, world.v23, world.v17,
      seed, { head: v23.value.head, lineage: v23.value.lineage })
    expect(v24.ok).toBe(true)
    expect((await commitPublicV17Snapshot(world.gate, world.v17,
      { state: source.value.state, greenwayWorks: source.value.greenwayWorks },
      0, source.value.lineage)).ok).toBe(true)
    expect(await inspectPublicV24(world.gate, world.v24, world.v23, world.v17))
      .toEqual({ ok: true, value: { status: 'blocked', reason: 'source-changed' } })
    expect(await inspectWhileLocked(world)).toEqual({ status: 'blocked', reason: 'source-changed' })
  })

  it('commits a typed Mireglass action by replay from a validated migrated pose', async () => {
    const world = stores(), source = await startFreshPublicV17(world.gate, world.v17, seed)
    if (!source.ok) throw new Error(source.reason)
    const point = mireglassAnchors(seed).fringeMarker.tile.center
    const surface = resolvePublicV23Surface(source.value.state, point, [])!
    const discoveryMask = new Uint8Array(source.value.state.discoveryMask)
    const discovered = encodeDiscoveredTileIds(nearbyWorldTileIds(point,
      PUBLIC_WALK_REVEAL_RADIUS_METERS))
    for (let i = 0; i < discoveryMask.length; i++) discoveryMask[i] |= discovered[i]
    const state = { ...source.value.state, movementOwner: 'streamed' as const,
      discoveryMask, player: { ...source.value.state.player,
        position: { x: point.x, y: surface.floorY, z: point.z } } }
    for (const [slot, revision] of [['previous', 1], ['head', 2]] as const)
      await putRecord(world.factory, PUBLIC_V17_DATABASE_NAME, slot,
        { saveRevision: revision, value: encodePublicV17Head({ state,
          greenwayWorks: source.value.greenwayWorks }, revision, source.value.lineage) })
    const v23Inspection = await inspectPublicV23(world.gate, world.v23, world.v17)
    if (!v23Inspection.ok || v23Inspection.value.status !== 'migration-available')
      throw new Error('Invalid reached V17 source')
    const v23 = await startPublicV23(world.gate, world.v23, world.v17,
      seed, v23Inspection.value.sourceReceipt)
    if (!v23.ok) throw new Error(v23.reason)
    const receipt = { head: v23.value.head, lineage: v23.value.lineage }
    const v24 = await startPublicV24(world.gate, world.v24, world.v23, world.v17, seed, receipt)
    if (!v24.ok) throw new Error(v24.reason)
    const action = { kind: 'mireglass-action/v1' as const,
      action: { type: 'study_fringe_marker' as const } }
    const saved = await commitPublicV24(world.gate, world.v24, world.v23, world.v17,
      0, v24.value.lineage, action)
    if (!saved.ok) throw new Error(saved.reason)
    expect(saved.value.head.state.mireglass).not.toEqual(v24.value.head.state.mireglass)
    expect(await resumePublicV24(world.gate, world.v24, world.v23, world.v17,
      1, v24.value.lineage)).toEqual(saved)
    expect(await commitPublicV24(world.gate, world.v24, world.v23, world.v17,
      1, v24.value.lineage, { kind: 'mireglass-action/v1',
        action: { type: 'traverse_route', siteId: 'forged' } } as never))
      .toEqual({ ok: false, reason: 'invalid-witness' })
    const wideWitness = { kind: 'mireglass-action/v1' as const,
      action: { type: 'cast_wayfinder_glow_wide' as const } }
    const expected = applyPublicV24MireglassAction({ state: saved.value.head.state,
      greenwayWorks: saved.value.head.greenwayWorks,
      regionalWorks: saved.value.head.regionalWorks }, wideWitness.action)
    if (!expected.progress) throw new Error(expected.rejection)
    const annulus = nearbyWorldTileIds(point, PUBLIC_SPELL_REVEAL_RADIUS_METERS)
      .filter((id) => !nearbyWorldTileIds(point, PUBLIC_WALK_REVEAL_RADIUS_METERS).includes(id))
    expect(expected.events[0]).toMatchObject({ type: 'terrain_revealed',
      revealedTileIds: annulus, xp: 10 * Math.min(annulus.length, 13) })
    const wide = await commitPublicV24(world.gate, world.v24, world.v23, world.v17,
      1, v24.value.lineage, wideWitness)
    if (!wide.ok) throw new Error(wide.reason)
    expect(wide.value.head.witness).toEqual(wideWitness)
    expect(wide.value.head.state).toEqual(expected.progress.state)
    expect(await resumePublicV24(world.gate, createAtomicV24Store(world.factory), world.v23,
      world.v17, 2, v24.value.lineage)).toEqual(wide)
    expect((await createAtomicV24Store(world.factory).readChecked()).status).toBe('valid')
  })
})
