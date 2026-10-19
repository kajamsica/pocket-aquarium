import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV17Store } from './atomicV17Database'
import { createAtomicV23Store } from './atomicV23Database'
import { createAtomicV24Store } from './atomicV24Database'
import { createAtomicV25Store } from './atomicV25Database'
import { createAtomicV26Store } from './atomicV26Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { startFreshPublicV17 } from './publicWorldV17Flow'
import { encodePublicV17Head, PUBLIC_V17_DATABASE_NAME } from './publicWorldV17Snapshot'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { inspectPublicV23, startPublicV23 } from './publicWorldV23Flow'
import { startFreshPublicV24World, startPublicV24 } from './publicWorldV24Flow'
import { commitPublicV25, startPublicV25 } from './publicWorldV25Flow'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV25StratumAt } from './publicWorldV25Strata'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { applyPublicV26TerrainAction } from './publicWorldV26TerrainAction'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import { commitPublicV26, inspectPublicV26, requestPublicV26ReturnHome,
  resumePublicV26, startPublicV26 } from './publicWorldV26Flow'
import { worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const move = (x: number, z: number) => ({ kind: 'frame-batch/v1' as const,
  frames: [{ intents: [{ type: 'move' as const, delta: { x, z } }], walkRequested: false }] })
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
    v24: createAtomicV24Store(factory), v25: createAtomicV25Store(factory),
    v26: createAtomicV26Store(factory) }
}
type World = ReturnType<typeof world>
const inspect = (w: World) => inspectPublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17)
const start = (w: World, receipt: Parameters<typeof startPublicV26>[7]) =>
  startPublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17, seed, receipt)
const resume = (w: World, revision: number, lineage: unknown) =>
  resumePublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17, revision, lineage)
const commit = (w: World, revision: number, lineage: unknown,
  witness: Parameters<typeof commitPublicV26>[8]) =>
  commitPublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17, revision, lineage, witness)
const returnHome = (w: World, revision: number, lineage: unknown) =>
  requestPublicV26ReturnHome(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17, revision, lineage)
async function startOld(w: World) {
  const v24 = await startFreshPublicV24World(w.locks, w.v24, w.v23, w.v17, seed)
  if (!v24.ok) throw new Error(v24.reason)
  const v25 = await startPublicV25(w.locks, w.v25, w.v24, w.v23, w.v17,
    seed, v24.value)
  if (!v25.ok) throw new Error(v25.reason)
  return v25.value
}
async function startNew(w: World) {
  const checked = await inspect(w)
  if (!checked.ok || checked.value.status !== 'migration-available')
    throw new Error('Missing checked V25 receipt')
  const started = await start(w, checked.value.sourceReceipt)
  if (!started.ok) throw new Error(started.reason)
  return started.value
}
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
async function startOldAt(w: World, point: { x: number; z: number }, digCell?: { gx: number; gz: number }) {
  const fresh = await startFreshPublicV17(w.locks, w.v17, seed)
  if (!fresh.ok) throw new Error(fresh.reason)
  const before = fresh.value
  const floor = publicV17StarterSupportAt({ seed, profile: before.state.generationProfile,
    route: before.state.greenway.routes[0] ?? null, built: false,
    greenwayWorks: before.greenwayWorks }, point)?.floorY
  if (floor === undefined) throw new Error('Missing support')
  const player = { ...before.state.player, position: { ...point, y: floor },
    inventory: digCell ? [...before.state.player.inventory,
      { itemId: 'field_spade' as const, quantity: 1 }] : before.state.player.inventory,
    equipment: digCell ? { ...before.state.player.equipment,
      mainHand: 'field_spade' as const } : before.state.player.equipment }
  const discoveryMask = digCell ? encodeDiscoveredTileIds([...new Set([
    ...decodeDiscoveredTileIds(before.state.discoveryMask),
    `tile-${digCell.gx + 3}-${digCell.gz + 3}`])].sort()) : before.state.discoveryMask
  const positioned = { ...before, state: { ...before.state, player, discoveryMask } }
  for (const [slot, revision] of [['previous', 1], ['head', 2]] as const)
    await putV17(w.factory, slot, { saveRevision: revision,
      value: encodePublicV17Head(positioned, revision, fresh.value.lineage) })
  const checked = await inspectPublicV23(w.locks, w.v23, w.v17)
  if (!checked.ok || checked.value.status !== 'migration-available')
    throw new Error('Missing checked V17 receipt')
  const v23 = await startPublicV23(w.locks, w.v23, w.v17, seed, checked.value.sourceReceipt)
  if (!v23.ok) throw new Error(v23.reason)
  const v24 = await startPublicV24(w.locks, w.v24, w.v23, w.v17,
    seed, { head: v23.value.head, lineage: v23.value.lineage })
  if (!v24.ok) throw new Error(v24.reason)
  const v25 = await startPublicV25(w.locks, w.v25, w.v24, w.v23, w.v17, seed, v24.value)
  if (!v25.ok) throw new Error(v25.reason)
}

function reachableSoilCell(mustTrap = false) {
  const { head } = createPublicV23Root(seed)
  for (let gz = -5; gz <= 1; gz++) for (let gx = -6; gx <= 6; gx++) {
    if (gx === 0 && gz === 0 || publicV25RiverCellAtGrid(seed, gx, gz)
      || worldTileAtGrid(seed, gx, gz).terrain !== 'loam'
      || publicV25StratumAt(seed, gx, gz, 0).material !== 'soil') continue
    const point = { x: gx * 4, z: gz * 4 }
    const support = publicV17StarterSupportAt({ seed, profile: head.state.generationProfile,
      route: head.state.greenway.routes[0] ?? null, built: false,
      greenwayWorks: head.greenwayWorks }, point)
    if (!support || support.kind !== 'ground') continue
    const state = { ...head.state, discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(head.state.discoveryMask),
      `tile-${gx + 3}-${gz + 3}`])].sort()), player: { ...head.state.player,
      position: { ...point, y: support.floorY },
      inventory: [...head.state.player.inventory, { itemId: 'field_spade' as const, quantity: 1 }],
      equipment: { ...head.state.player.equipment, mainHand: 'field_spade' as const } } }
    const progress = { state, greenwayWorks: head.greenwayWorks,
      regionalWorks: head.regionalWorks, terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0 }
    if (!applyPublicV26TerrainAction(progress, { kind: 'dig', gx, gz }).progress) continue
    if (mustTrap) {
      const pit = { ...progress, terrain: { ...progress.terrain,
        columns: [{ gx, gz, openDepth: 2, rewardDepth: 2, pitLadder: false }] } }
      if (!applyPublicV26ReturnHome(pit, 10_000).progress) continue
    }
    return { gx, gz, point }
  }
  throw new Error('No reachable soil cell')
}

describe('V26 source-pinned flow', () => {
  it('starts from the checked V25 chain under one lock and saves independently', async () => {
    const w = world()
    expect(await inspect(w)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-v23-missing' } })
    const old = await startOld(w), oldRoot = await w.v25.readChecked()
    const checked = await inspect(w)
    if (!checked.ok || checked.value.status !== 'migration-available')
      throw new Error('Missing checked V25 receipt')
    expect(checked.value.sourceReceipt).toEqual(old)
    const before = w.acquisitions(), started = await start(w, checked.value.sourceReceipt)
    expect(w.acquisitions() - before).toBe(1)
    if (!started.ok) throw new Error(started.reason)
    expect(started.value.lineage.sourceReceipt).toEqual(old)
    expect(started.value.head.saveRevision).toBe(0)
    expect(await resume(w, 0, started.value.lineage)).toEqual(started)
    const saved = await commit(w, 0, started.value.lineage, { kind: 'checkpoint' })
    if (!saved.ok) throw new Error(saved.reason)
    expect(saved.value.head.terrain).toEqual(started.value.head.terrain)
    expect(saved.value.head.nextHomeAtMs).toBe(0)
    expect(await resume(w, 1, started.value.lineage)).toEqual(saved)
    expect(await w.v25.readChecked()).toEqual(oldRoot)
    expect(await start(w, checked.value.sourceReceipt)).toEqual({ ok: false, reason: 'target-conflict' })
  }, 30_000)

  it('blocks every entrypoint when the pinned live V25 source advances', async () => {
    const w = world(), old = await startOld(w), started = await startNew(w)
    const advanced = await commitPublicV25(w.locks, w.v25, w.v24, w.v23, w.v17,
      0, old.lineage, { kind: 'checkpoint' })
    if (!advanced.ok) throw new Error(advanced.reason)
    expect(await inspect(w)).toEqual({ ok: true, value: { status: 'blocked', reason: 'source-changed' } })
    expect(await resume(w, 0, started.lineage)).toEqual({ ok: false, reason: 'source-changed' })
    expect(await commit(w, 0, started.lineage, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect(await commit(w, 0, started.lineage,
      { kind: 'terrain-action/v1', action: { kind: 'dig', gx: 0, gz: 0 } }))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect((await w.v26.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0 } } })
    const stale = world(), staleOld = await startOld(stale), available = await inspect(stale)
    if (!available.ok || available.value.status !== 'migration-available')
      throw new Error('Missing checked V25 receipt')
    const changed = await commitPublicV25(stale.locks, stale.v25, stale.v24, stale.v23, stale.v17,
      0, staleOld.lineage, { kind: 'checkpoint' })
    if (!changed.ok) throw new Error(changed.reason)
    expect(await start(stale, available.value.sourceReceipt))
      .toEqual({ ok: false, reason: 'source-changed' })
  }, 30_000)

  it('rejects stale revision, forged lineage, and unsupported action without changing the root', async () => {
    const w = world()
    await startOld(w)
    const started = await startNew(w)
    expect(await commit(w, 0, { ...started.lineage, seed: 'forged' }, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'lineage-changed' })
    expect(await commit(w, 0, started.lineage, { kind: 'dig-column/v1', gx: 1, gz: 1 } as never))
      .toEqual({ ok: false, reason: 'invalid-witness' })
    const saved = await commit(w, 0, started.lineage, { kind: 'checkpoint' })
    if (!saved.ok) throw new Error(saved.reason)
    expect(await resume(w, 0, started.lineage)).toEqual({ ok: false, reason: 'revision-changed' })
    expect(await commit(w, 0, started.lineage, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect((await w.v26.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1 } } })
  }, 30_000)

  it('rejects north-wall and river crossings without consuming a save revision', async () => {
    const dry = world()
    await startOldAt(dry, { x: 12, z: 4 })
    const dryStart = await startNew(dry)
    expect((await commit(dry, 0, dryStart.lineage, move(0.1, 0))).ok).toBe(true)
    for (const [point, delta] of [
      [{ x: 28, z: -5.95 }, { x: 0, z: -0.1 }],
      [{ x: 12, z: 5.9 }, { x: 0, z: 0.16 }],
    ] as const) {
      const w = world()
      await startOldAt(w, point)
      const started = await startNew(w)
      expect(await commit(w, 0, started.lineage, move(delta.x, delta.z)))
        .toEqual({ ok: false, reason: 'frame-rejected' })
      expect((await w.v26.readChecked())).toMatchObject({ status: 'valid',
        root: { head: { saveRevision: 0 } } })
    }
  }, 30_000)

  it('persists checked dig and fill witnesses without mutating V25 or duplicating rewards', async () => {
    const { gx, gz, point } = reachableSoilCell(), w = world()
    await startOldAt(w, point, { gx, gz })
    const oldRoot = await w.v25.readChecked(), started = await startNew(w)
    const dig = { kind: 'terrain-action/v1' as const,
      action: { kind: 'dig' as const, gx, gz } }
    const fill = { kind: 'terrain-action/v1' as const,
      action: { kind: 'fill' as const, gx, gz } }
    const dug = await commit(w, 0, started.lineage, dig)
    if (!dug.ok) throw new Error(dug.reason)
    expect(dug.value.head.terrain.bag.soil).toBe(1)
    expect(dug.value.head.terrain.columns).toEqual([{ gx, gz, openDepth: 1,
      rewardDepth: 1, pitLadder: false }])
    expect(await resume(w, 1, started.lineage)).toEqual(dug)
    expect(await commit(w, 0, started.lineage, fill))
      .toEqual({ ok: false, reason: 'revision-changed' })
    const filled = await commit(w, 1, started.lineage, fill)
    if (!filled.ok) throw new Error(filled.reason)
    expect(filled.value.head.terrain.bag.soil).toBe(0)
    expect(filled.value.head.terrain.columns[0]).toMatchObject({ openDepth: 0, rewardDepth: 1 })
    const reopened = await commit(w, 2, started.lineage, dig)
    if (!reopened.ok) throw new Error(reopened.reason)
    expect(reopened.value.head.terrain.bag.soil).toBe(0)
    expect(reopened.value.head.state.player.xp).toBe(dug.value.head.state.player.xp)
    expect(await resume(w, 3, started.lineage)).toEqual(reopened)
    expect(await w.v25.readChecked()).toEqual(oldRoot)
    expect(await commit(w, 3, started.lineage,
      { ...dig, action: { ...dig.action, eligible: true } } as never))
      .toEqual({ ok: false, reason: 'invalid-witness' })
    expect(await commit(w, 3, started.lineage,
      { kind: 'terrain-action/v1', action: { kind: 'dig', gx: 0, gz: 0 } }))
      .toEqual({ ok: false, reason: 'frame-rejected' })
  }, 30_000)

  it('stamps and saves return-home only for an excavated trapped player', async () => {
    const { gx, gz, point } = reachableSoilCell(true), w = world()
    await startOldAt(w, point, { gx, gz })
    const oldRoot = await w.v25.readChecked(), started = await startNew(w)
    const dig = { kind: 'terrain-action/v1' as const,
      action: { kind: 'dig' as const, gx, gz } }
    expect(await returnHome(w, 0, started.lineage)).toEqual({ ok: false, reason: 'not_trapped' })
    const once = await commit(w, 0, started.lineage, dig)
    if (!once.ok) throw new Error(once.reason)
    const twice = await commit(w, 1, started.lineage, dig)
    if (!twice.ok) throw new Error(twice.reason)
    expect(twice.value.head.terrain.columns[0].openDepth).toBe(2)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    try {
      const locksBefore = w.acquisitions()
      const saved = await returnHome(w, 2, started.lineage)
      expect(w.acquisitions() - locksBefore).toBe(1)
      if (!saved.ok) throw new Error(saved.reason)
      expect(saved.value.head.witness).toEqual({ kind: 'return-home/v1', atMs: 10_000 })
      expect(saved.value.head.nextHomeAtMs).toBe(1_810_000)
      expect(saved.value.head.state.player.position).toMatchObject({ x: 0, z: 0 })
      expect(saved.value.head.terrain).toEqual(twice.value.head.terrain)
      expect(saved.value.head.state.player.inventory).toEqual(twice.value.head.state.player.inventory)
      expect(await resume(w, 3, started.lineage)).toEqual(saved)
      expect(await w.v25.readChecked()).toEqual(oldRoot)
      expect(await commit(w, 3, started.lineage, { kind: 'return-home/v1', atMs: 2_000_000 }))
        .toEqual({ ok: false, reason: 'invalid-witness' })
      expect(await returnHome(w, 2, started.lineage))
        .toEqual({ ok: false, reason: 'revision-changed' })
      expect(await returnHome(w, 3, started.lineage))
        .toEqual({ ok: false, reason: 'cooldown' })
    } finally { clock.mockRestore() }
  }, 30_000)

  it('blocks return-home on stale V25 source without a V26 write', async () => {
    const w = world(), old = await startOld(w), started = await startNew(w)
    const advanced = await commitPublicV25(w.locks, w.v25, w.v24, w.v23, w.v17,
      0, old.lineage, { kind: 'checkpoint' })
    if (!advanced.ok) throw new Error(advanced.reason)
    expect(await returnHome(w, 0, started.lineage))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect((await w.v26.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0 } } })
  }, 30_000)
})
