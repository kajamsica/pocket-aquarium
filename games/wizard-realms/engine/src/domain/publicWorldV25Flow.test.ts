import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV17Store } from './atomicV17Database'
import { createAtomicV23Store } from './atomicV23Database'
import { createAtomicV24Store } from './atomicV24Database'
import { createAtomicV25Store } from './atomicV25Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { commitPublicV17GreenwayWork, startFreshPublicV17 } from './publicWorldV17Flow'
import { encodePublicV17Head, PUBLIC_V17_DATABASE_NAME } from './publicWorldV17Snapshot'
import type { PublicV17Lineage } from './publicWorldV17Snapshot'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import type { PublicV17Progress } from './publicWorldV17Validation'
import { inspectPublicV23, startPublicV23 } from './publicWorldV23Flow'
import { commitPublicV24, inspectPublicV24, startFreshPublicV24World, startPublicV24 } from './publicWorldV24Flow'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import { commitPublicV25, inspectPublicV25, inspectPublicV25UnderLock,
  resumePublicV25, startPublicV25 } from './publicWorldV25Flow'

const seed = 'wizard-realms'
const move = (z: number) => ({ kind: 'frame-batch/v1' as const,
  frames: [{ intents: [{ type: 'move' as const, delta: { x: 0, z } }], walkRequested: false }] })
function world() {
  const factory = new IDBFactory()
  let active = false, acquisitions = 0
  const locks = { request: async <T,>(name: string, options: { mode: 'exclusive' },
    body: () => T | Promise<T>): Promise<T> => {
    expect(name).toBe(PUBLIC_V7_LOCK_NAME)
    expect(options).toEqual({ mode: 'exclusive' })
    if (active) throw new Error('Nested lock')
    active = true; acquisitions++
    try { return await body() } finally { active = false }
  } }
  return { factory, locks, acquisitions: () => acquisitions,
    v17: createAtomicV17Store(factory), v23: createAtomicV23Store(factory),
    v24: createAtomicV24Store(factory), v25: createAtomicV25Store(factory) }
}
type World = ReturnType<typeof world>
const inspect = (w: World) => inspectPublicV25(w.locks, w.v25, w.v24, w.v23, w.v17)
const start = (w: World, receipt: Parameters<typeof startPublicV25>[6]) =>
  startPublicV25(w.locks, w.v25, w.v24, w.v23, w.v17, seed, receipt)
const commit = (w: World, revision: number, lineage: Parameters<typeof commitPublicV25>[6],
  witness: Parameters<typeof commitPublicV25>[7]) =>
  commitPublicV25(w.locks, w.v25, w.v24, w.v23, w.v17, revision, lineage, witness)
async function putV17(factory: IDBFactory, slot: 'previous' | 'head', value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(PUBLIC_V17_DATABASE_NAME, 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').put(value, slot)
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  }) } finally { db.close() }
}
async function pinV17Progress(w: World, progress: PublicV17Progress,
  lineage: PublicV17Lineage, previousRevision: number) {
  for (const [slot, revision] of [['previous', previousRevision],
    ['head', previousRevision + 1]] as const)
    await putV17(w.factory, slot, { saveRevision: revision,
      value: encodePublicV17Head(progress, revision, lineage) })
}
async function promoteV17(w: World) {
  const inspected = await inspectPublicV23(w.locks, w.v23, w.v17)
  if (!inspected.ok || inspected.value.status !== 'migration-available')
    throw new Error('Missing checked V17 receipt')
  const v23 = await startPublicV23(w.locks, w.v23, w.v17, seed, inspected.value.sourceReceipt)
  if (!v23.ok) throw new Error(v23.reason)
  const v24 = await startPublicV24(w.locks, w.v24, w.v23, w.v17, seed,
    { head: v23.value.head, lineage: v23.value.lineage })
  if (!v24.ok) throw new Error(v24.reason)
  return v24.value
}
async function atGreenway(w: World, point: { x: number; z: number }, bridgeId?: string) {
  const fresh = await startFreshPublicV17(w.locks, w.v17, seed)
  if (!fresh.ok) throw new Error(fresh.reason)
  let progress: PublicV17Progress = fresh.value, previousRevision = 1
  if (bridgeId) {
    const site = resolvePublicV17GreenwaySite(seed, bridgeId)
    if (!site || site.kind !== 'bridge') throw new Error('Missing bridge site')
    const approach = { x: site.from.x, z: site.from.z - 0.6 }
    const floor = publicV17StarterSupportAt({ seed, profile: progress.state.generationProfile,
      route: progress.state.greenway.routes[0] ?? null, built: false,
      greenwayWorks: progress.greenwayWorks }, approach)?.floorY
    if (floor === undefined) throw new Error('Missing bridge approach')
    progress = { ...progress, state: { ...progress.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(progress.state.discoveryMask), ...site.footprintTileIds])].sort()),
      player: { ...progress.state.player, position: { ...approach, y: floor },
        inventory: [...progress.state.player.inventory, { itemId: 'logs', quantity: 8 }] } } }
    await pinV17Progress(w, progress, fresh.value.lineage, 1)
    const built = await commitPublicV17GreenwayWork(w.locks, w.v17, bridgeId, 2,
      fresh.value.lineage)
    if (!built.ok) throw new Error(built.reason)
    expect(built.value.start.greenwayWorks.builtBridgeIds).toContain(bridgeId)
    progress = built.value.start; previousRevision = 4
  }
  const support = publicV17StarterSupportAt({ seed, profile: progress.state.generationProfile,
    route: progress.state.greenway.routes[0] ?? null, built: false,
    greenwayWorks: progress.greenwayWorks }, point)
  if (!support) throw new Error('Missing target support')
  progress = { ...progress, state: { ...progress.state,
    player: { ...progress.state.player, position: { ...point, y: support.floorY } } } }
  await pinV17Progress(w, progress, fresh.value.lineage, previousRevision)
  return promoteV17(w)
}
async function startCheckedV25(w: World) {
  const inspection = await inspect(w)
  if (!inspection.ok || inspection.value.status !== 'migration-available')
    throw new Error('Missing checked V24 receipt')
  const result = await start(w, inspection.value.sourceReceipt)
  if (!result.ok) throw new Error(result.reason)
  return result.value
}
describe('V25 source-pinned flow', () => {
  it('exposes live checked reads without taking a nested world lock', async () => {
    const w = world()
    const underLock = () => w.locks.request(PUBLIC_V7_LOCK_NAME, { mode: 'exclusive' },
      () => inspectPublicV25UnderLock(w.v25, w.v24, w.v23, w.v17))
    expect(await underLock()).toEqual({ status: 'blocked', reason: 'source-v23-missing' })
    const source = await startFreshPublicV24World(w.locks, w.v24, w.v23, w.v17, seed)
    if (!source.ok) throw new Error(source.reason)
    const missing = await underLock()
    if (missing.status !== 'missing') throw new Error('Expected missing V25 target')
    expect(missing.target.status).toBe('missing')
    expect(missing.sourceReceipt).toEqual(source.value)
    const started = await start(w, missing.sourceReceipt)
    if (!started.ok) throw new Error(started.reason)
    const valid = await underLock()
    if (valid.status !== 'valid') throw new Error('Expected valid V25 target')
    expect(valid.start).toEqual(started.value)
    expect(valid.target.root.lineage.sourceReceipt).toEqual(source.value)
    const advanced = await commitPublicV24(w.locks, w.v24, w.v23, w.v17,
      0, source.value.lineage, { kind: 'checkpoint' })
    if (!advanced.ok) throw new Error(advanced.reason)
    expect(await underLock()).toEqual({ status: 'blocked', reason: 'source-changed' })
  })
  it('migrates the checked V17 to V24 chain under one lock and saves independently', async () => {
    const w = world()
    expect(await inspect(w)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-v23-missing' } })
    const v24 = await startFreshPublicV24World(w.locks, w.v24, w.v23, w.v17, seed)
    if (!v24.ok) throw new Error(v24.reason)
    const oldRoot = await w.v24.readChecked()
    const checked = await inspect(w)
    if (!checked.ok || checked.value.status !== 'migration-available')
      throw new Error('Missing checked source receipt')
    expect(checked.value.sourceReceipt).toEqual(v24.value)
    const before = w.acquisitions()
    const started = await start(w, checked.value.sourceReceipt)
    expect(w.acquisitions() - before).toBe(1)
    if (!started.ok) throw new Error(started.reason)
    expect(started.value.lineage.sourceReceipt).toEqual(v24.value)
    expect(started.value.head.saveRevision).toBe(0)
    expect(await inspect(w)).toEqual({ ok: true,
      value: { status: 'valid', start: started.value } })
    const saved = await commit(w, 0, started.value.lineage, { kind: 'checkpoint' })
    if (!saved.ok) throw new Error(saved.reason)
    expect(saved.value.head.excavation).toEqual(started.value.head.excavation)
    expect(await resumePublicV25(w.locks, createAtomicV25Store(w.factory), w.v24,
      w.v23, w.v17, 1, started.value.lineage)).toEqual(saved)
    expect(await w.v24.readChecked()).toEqual(oldRoot)
    expect(await start(w, checked.value.sourceReceipt)).toEqual({ ok: false, reason: 'target-conflict' })
  })
  it('rejects stale source, revision, CAS proof, and forged witness without changing the root', async () => {
    const w = world(), source = await startFreshPublicV24World(w.locks, w.v24,
      w.v23, w.v17, seed)
    if (!source.ok) throw new Error(source.reason)
    const changed = await commitPublicV24(w.locks, w.v24, w.v23, w.v17,
      0, source.value.lineage, { kind: 'checkpoint' })
    if (!changed.ok) throw new Error(changed.reason)
    expect(await start(w, source.value)).toEqual({ ok: false, reason: 'source-changed' })
    const started = await startCheckedV25(w)
    const stale = await w.v25.readChecked()
    if (stale.status !== 'valid') throw new Error('Missing V25 CAS proof')
    const saved = await commit(w, 0, started.lineage, { kind: 'checkpoint' })
    if (!saved.ok) throw new Error(saved.reason)
    expect(await w.v25.commit(stale.proof, { lineage: stale.root.lineage,
      previous: stale.root.head, head: { ...stale.root.head,
        saveRevision: 1, witness: { kind: 'checkpoint' } } })).toBe('revision-changed')
    expect(await commit(w, 0, started.lineage, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await commit(w, 1, started.lineage, { kind: 'dig', gx: 1 } as never))
      .toEqual({ ok: false, reason: 'invalid-witness' })
    expect(await resumePublicV25(w.locks, w.v25, w.v24, w.v23, w.v17,
      1, { ...started.lineage, seed: 'forged' })).toEqual({ ok: false, reason: 'lineage-changed' })
    const sourceAdvanced = await commitPublicV24(w.locks, w.v24, w.v23, w.v17,
      1, source.value.lineage, { kind: 'checkpoint' })
    if (!sourceAdvanced.ok) throw new Error(sourceAdvanced.reason)
    expect(await inspect(w)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-changed' } })
    expect(await commit(w, 1, started.lineage, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect((await w.v25.readChecked()).status).toBe('valid')
  })

  it('accepts dry frames but blocks wet entry and two-frame wet return before CAS', async () => {
    const dry = world()
    await atGreenway(dry, { x: 12, z: 5.7 })
    const dryStart = await startCheckedV25(dry)
    const drySaved = await commit(dry, 0, dryStart.lineage, move(0.1))
    expect(drySaved.ok).toBe(true)

    const wet = world()
    await atGreenway(wet, { x: 12, z: 5.9 })
    const wetStart = await startCheckedV25(wet)
    const entered = await commit(wet, 0, wetStart.lineage, move(0.16))
    expect(entered).toEqual({ ok: false, reason: 'river-needs-bridge' })
    const returned = await commit(wet, 0, wetStart.lineage, { kind: 'frame-batch/v1',
      frames: [...move(0.16).frames, ...move(-0.16).frames] })
    expect(returned).toEqual({ ok: false, reason: 'river-needs-bridge' })
    expect((await wet.v25.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0 } } })
  })

  it('accepts movement on a saved bridge deck after full source-chain inspection', async () => {
    const w = world(), id = 'works3:bridge:1'
    const site = resolvePublicV17GreenwaySite(seed, id)
    if (!site || site.kind !== 'bridge') throw new Error('Missing bridge site')
    const old = await atGreenway(w, site.gapCenter, id)
    expect(old.head.greenwayWorks.builtBridgeIds).toContain(id)
    const started = await startCheckedV25(w)
    expect(started.head.greenwayWorks.builtBridgeIds).toContain(id)
    const saved = await commit(w, 0, started.lineage, move(0.16))
    if (!saved.ok) throw new Error(saved.reason)
    expect(saved.value.head.state.player.position.z)
      .toBeCloseTo(started.head.state.player.position.z + 0.16)
    expect((await w.v24.readChecked())).toMatchObject({ status: 'valid',
      root: { head: old.head } })
  })
})
