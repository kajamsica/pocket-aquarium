import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV15Store } from './atomicV15Database'
import { advancePublicV15GreenwayAction, commitPublicV15FrameBatch,
  commitPublicV15GreenwayAction, commitPublicV15Snapshot,
  commitPublicV15StarterWork, inspectPublicV15, resumePublicV15,
  startFreshPublicV15 } from './publicWorldV15Flow'
import { createFreshPublicV15Head, decodePublicV15Head,
  encodePublicV15Head, PUBLIC_V15_LEGACY_RULES_PROFILE } from './publicWorldV15Snapshot'
import { PUBLIC_V15_STARTER_BRIDGE_ID,
  publicWorldV15StarterSites, publicWorldV15SuppressedStarterResourceIds } from './publicWorldV15StarterSites'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { publicV15StarterSupportAt } from './publicWorldV15StarterMovement'

const locks = { request: async <T,>(name: string, options: { mode: 'exclusive' },
  callback: () => T | Promise<T>): Promise<T> => {
  expect(name).toBe('wizard-realms:world:v6:root:exclusive')
  expect(options).toEqual({ mode: 'exclusive' })
  return callback()
} }
const seed = 'greenway-alpha'
const idle = [{ intents: [], walkRequested: false }]
async function putRaw(factory: IDBFactory, key: string, value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('wizard-realms:world:v15', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite')
      transaction.objectStore('records').put(value, key)
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
}

describe('native v15 checked flow', () => {
  it('creates only a v15 v2 root, returns flags, and resumes the exact revision', async () => {
    const factory = new FakeFactory(), store = createAtomicV15Store(factory)
    expect(await inspectPublicV15(locks, store)).toEqual({
      ok: true, value: { status: 'missing' },
    })
    const fresh = await startFreshPublicV15(locks, store, seed)
    expect(fresh.ok).toBe(true)
    if (!fresh.ok) return
    expect(fresh.value.starterWorks).toEqual({ bridgeBuilt: false, bankCacheDug: false })
    expect(fresh.value.lineage.rulesProfile).toBe('starter-crossing/v2')
    const raw = await store.read()
    if (raw.status !== 'ok') throw new Error('Missing v15 root')
    expect(raw.previous).toBeNull()
    expect(decodePublicV15Head((raw.head as { value: unknown }).value, raw.lineage)?.state)
      .toEqual(fresh.value.state)
    expect(await resumePublicV15(locks, store, 0, fresh.value.lineage))
      .toEqual({ ok: true, value: fresh.value })
    expect(await startFreshPublicV15(locks, store, seed))
      .toEqual({ ok: false, reason: 'root-present' })
    expect((await factory.databases()).map((entry) => entry.name))
      .toEqual(['wizard-realms:world:v15'])
  })

  it('commits only a bounded, replayable native frame witness and rejects a stale CAS', async () => {
    const store = createAtomicV15Store(new FakeFactory())
    const fresh = await startFreshPublicV15(locks, store, seed)
    if (!fresh.ok) throw new Error(fresh.reason)
    const frames = [{ intents: [{ type: 'move', delta: { x: 0.16, z: 0 } }],
      walkRequested: true }, ...idle]
    const saved = await commitPublicV15FrameBatch(locks, store, frames,
      fresh.value.saveRevision, fresh.value.lineage)
    expect(saved.ok, saved.ok ? '' : saved.reason).toBe(true)
    if (!saved.ok) return
    expect(saved.value.start.state.tick).toBe(2)
    expect(saved.value.start.starterWorks).toEqual(fresh.value.starterWorks)
    const raw = await store.read()
    if (raw.status !== 'ok') throw new Error('Missing v15 root')
    expect((raw.head as { value: { frameWitness: unknown } }).value.frameWitness)
      .toEqual({ kind: 'frame-batch/v1', frames })
    expect(await inspectPublicV15(locks, store)).toEqual({ ok: true,
      value: { status: 'valid', start: saved.value.start } })
    expect(await resumePublicV15(locks, store, 1, fresh.value.lineage))
      .toEqual({ ok: true, value: saved.value.start })
    expect(await commitPublicV15FrameBatch(locks, store, idle, 0, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await commitPublicV15FrameBatch(locks, store, [], 1, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'invalid-frames' })
  })

  it('rejects generic flag, material and XP fabrication without changing the root', async () => {
    const store = createAtomicV15Store(new FakeFactory())
    const fresh = await startFreshPublicV15(locks, store, seed)
    if (!fresh.ok) throw new Error(fresh.reason)
    const { state, starterWorks, lineage } = fresh.value
    const forged = [
      { state, starterWorks: { ...starterWorks, bridgeBuilt: true } },
      { state: { ...state, player: { ...state.player,
        inventory: [...state.player.inventory, { itemId: 'logs', quantity: 8 }] } }, starterWorks },
      { state: { ...state, player: { ...state.player, xp: state.player.xp + 10 } }, starterWorks },
    ]
    for (const candidate of forged) {
      expect((await commitPublicV15Snapshot(locks, store, candidate, 0, lineage)).ok).toBe(false)
    }
    expect(await commitPublicV15Snapshot(locks, store, { state, starterWorks }, 0, lineage))
      .toMatchObject({ ok: true, value: { saveRevision: 1 } })
    expect(await inspectPublicV15(locks, store)).toMatchObject({ ok: true,
      value: { status: 'valid', start: { saveRevision: 1, starterWorks } } })
  })

  it('blocks tampered raw witnesses and unproved starter flags on inspection', async () => {
    for (const mutate of [
      (head: { frameWitness: { frames: { intents: { delta: { x: number } }[] }[] } }) => {
        head.frameWitness.frames[0].intents[0].delta.x = 0.08
      },
      (head: { state: { player: { coins: number } } }) => { head.state.player.coins += 1 },
      (head: { starterWorks: { bridgeBuilt: boolean }; state: { player: {
        xp: number; skillXp: { construction: number } } } }) => {
        head.starterWorks.bridgeBuilt = true
        head.state.player.xp += 80
        head.state.player.skillXp.construction += 80
      },
    ]) {
      const factory = new FakeFactory(), store = createAtomicV15Store(factory)
      const fresh = await startFreshPublicV15(locks, store, seed)
      if (!fresh.ok) throw new Error(fresh.reason)
      expect((await commitPublicV15FrameBatch(locks, store, [{
        intents: [{ type: 'move', delta: { x: 0.16, z: 0 } }],
        walkRequested: true,
      }], 0, fresh.value.lineage)).ok).toBe(true)
      const raw = await store.read()
      if (raw.status !== 'ok') throw new Error('Missing raw head')
      const head = structuredClone((raw.head as { value: unknown }).value)
      mutate(head as never)
      await putRaw(factory, 'head', { saveRevision: 1, value: head })
      expect(await inspectPublicV15(locks, store)).toEqual({ ok: true,
        value: { status: 'blocked', reason: 'invalid-v15-history' } })
    }
  })

  it('requires exact canonical genesis in both raw head and raw previous slots', async () => {
    for (const tamperPrevious of [false, true]) {
      const factory = new FakeFactory(), store = createAtomicV15Store(factory)
      const fresh = await startFreshPublicV15(locks, store, seed)
      if (!fresh.ok) throw new Error(fresh.reason)
      if (tamperPrevious) expect((await commitPublicV15FrameBatch(locks, store,
        idle, 0, fresh.value.lineage)).ok).toBe(true)
      const raw = await store.read()
      if (raw.status !== 'ok') throw new Error('Missing raw slots')
      const key = tamperPrevious ? 'previous' : 'head'
      const record = structuredClone((tamperPrevious ? raw.previous : raw.head) as {
        saveRevision: number; value: { state: { player: { coins: number } } }
      })
      record.value.state.player.coins += 1
      await putRaw(factory, key, record)
      const inspected = await inspectPublicV15(locks, store)
      expect(inspected).toMatchObject({ ok: true, value: { status: 'blocked' } })
      expect(await resumePublicV15(locks, store, Number(tamperPrevious), fresh.value.lineage))
        .toMatchObject({ ok: false })
    }
  })

  it('rejects suppressed harvest and hidden starter work without spending anything', async () => {
    const store = createAtomicV15Store(new FakeFactory())
    const fresh = await startFreshPublicV15(locks, store, seed)
    if (!fresh.ok) throw new Error(fresh.reason)
    const resourceId = publicWorldV15SuppressedStarterResourceIds(seed,
      fresh.value.state.greenway.resources)[0]
    expect(resourceId).toBeDefined()
    expect(advancePublicV15GreenwayAction(fresh.value,
      { type: 'harvest', resourceId }).rejections[0]?.code).toBe('not_found')
    expect(await commitPublicV15GreenwayAction(locks, store,
      { type: 'harvest', resourceId }, 0, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'action-rejected' })
    expect(await commitPublicV15StarterWork(locks, store,
      PUBLIC_V15_STARTER_BRIDGE_ID, 0, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'undiscovered' })
    expect(await inspectPublicV15(locks, store)).toMatchObject({ ok: true,
      value: { status: 'valid', start: { saveRevision: 0 } } })
  })

  it('commits a native starter bridge from a checked isolated work fixture', async () => {
    // This fixture tests the last-two-record writer, not a fresh-world acquisition journey.
    const factory = new FakeFactory(), store = createAtomicV15Store(factory)
    const fresh = await startFreshPublicV15(locks, store, seed)
    if (!fresh.ok) throw new Error(fresh.reason)
    const [bridge] = publicWorldV15StarterSites(seed)
    if (bridge.kind !== 'bridge') throw new Error('Missing bridge')
    const state = fresh.value.state
    const y = publicV15StarterSupportAt({ seed, profile: state.generationProfile,
      route: state.greenway.routes[0], built: false,
      starterWorks: fresh.value.starterWorks }, bridge.from)?.floorY
    if (y === undefined) throw new Error('Missing bridge approach support')
    const ready = { ...state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(state.discoveryMask), ...bridge.footprintTileIds,
      ])].sort()),
      player: { ...state.player,
        position: { x: bridge.from.x, y, z: bridge.from.z },
        inventory: [...state.player.inventory, { itemId: 'logs' as const, quantity: 8 }] } }
    const previous = encodePublicV15Head(ready, 1, fresh.value.lineage)
    const head = encodePublicV15Head(ready, 2, fresh.value.lineage)
    await putRaw(factory, 'previous', { saveRevision: 1, value: previous })
    await putRaw(factory, 'head', { saveRevision: 2, value: head })
    expect(await inspectPublicV15(locks, store)).toMatchObject({ ok: true,
      value: { status: 'valid', start: { saveRevision: 2 } } })
    const built = await commitPublicV15StarterWork(locks, store,
      PUBLIC_V15_STARTER_BRIDGE_ID, 2, fresh.value.lineage)
    expect(built.ok, built.ok ? '' : built.reason).toBe(true)
    if (!built.ok) return
    expect(built.value.start.starterWorks.bridgeBuilt).toBe(true)
    expect(built.value.start.state.player.inventory.find((stack) => stack.itemId === 'logs'))
      .toBeUndefined()
    expect(built.value.event).toMatchObject({ id: PUBLIC_V15_STARTER_BRIDGE_ID,
      logsSpent: 8, xp: 80 })
    expect(await inspectPublicV15(locks, store)).toEqual({ ok: true,
      value: { status: 'valid', start: built.value.start } })
    expect(await commitPublicV15StarterWork(locks, store,
      PUBLIC_V15_STARTER_BRIDGE_ID, 2, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'revision-changed' })
  })

  it('blocks legacy v1 records and leaves their raw slots untouched', async () => {
    const factory = new FakeFactory(), store = createAtomicV15Store(factory)
    expect((await store.read()).status).toBe('ok')
    const fresh = createFreshPublicV15Head(seed)
    const legacy = { ...fresh.lineage, rulesProfile: PUBLIC_V15_LEGACY_RULES_PROFILE }
    await putRaw(factory, 'lineage', legacy)
    await putRaw(factory, 'head', { saveRevision: 0, value: fresh.head })
    expect(await inspectPublicV15(locks, store)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'legacy-v15-root' } })
    expect(await startFreshPublicV15(locks, store, seed))
      .toEqual({ ok: false, reason: 'legacy-v15-root' })
    const raw = await store.read()
    expect(raw.status).toBe('ok')
    if (raw.status === 'ok') expect(raw.lineage).toEqual(legacy)
  })
})
