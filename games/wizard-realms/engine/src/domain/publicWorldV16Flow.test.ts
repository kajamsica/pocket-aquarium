import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV15Store } from './atomicV15Database'
import { createAtomicV16Store } from './atomicV16Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { nearbyWorldTileIds, PUBLIC_SPELL_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { createPublicV16ContinuousSession } from './publicWorldV16ContinuousSession'
import { advancePublicV16GreenwayAction,
  advancePublicV16GreenwayFrame } from './publicWorldV16GreenwayFrame'
import { commitPublicV16FrameBatch, commitPublicV16GreenwayAction,
  commitPublicV16GreenwayWork, commitPublicV16Snapshot, inspectPublicV16, resumePublicV16,
  startFreshPublicV16, startMigratedPublicV16 } from './publicWorldV16Flow'
import { inspectPublicV15, startFreshPublicV15,
  commitPublicV15FrameBatch } from './publicWorldV15Flow'
import type { PublicV15Start } from './publicWorldV15Flow'
import { publicWorldV15SuppressedStarterResourceIds } from './publicWorldV15StarterSites'
import { resolvePublicV16GreenwaySite } from './publicWorldV16GreenwaySites'
import { publicV16StarterSupportAt } from './publicWorldV16StarterMovement'
import { createFreshPublicV16Head, encodePublicV16Head,
  PUBLIC_V16_DATABASE_NAME } from './publicWorldV16Snapshot'
import { decodePublicV16Progress } from './publicWorldV16Validation'
import { validatePublicV14State } from './publicWorldV14Validation'

const seed = 'wizard-realms'
const move = [{ type: 'move' as const, delta: { x: 0.16, z: 0 } }]
const frames = [{ intents: move, walkRequested: true }]
const locks = (() => {
  let active = false
  return { request: async <T,>(name: string, options: { mode: 'exclusive' },
    callback: () => Promise<T>): Promise<T> => {
    expect(name).toBe('wizard-realms:world:v6:root:exclusive')
    expect(options).toEqual({ mode: 'exclusive' })
    if (active) throw new Error('Nested world lock')
    active = true
    try { return await callback() } finally { active = false }
  } }
})()
async function putRaw(factory: IDBFactory, key: string, value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(PUBLIC_V16_DATABASE_NAME, 1)
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

describe('v16 checked flow and native session', () => {
  it('allows magic on validated v16 bridge and dug support while other actions stay restricted', () => {
    const base = createFreshPublicV16Head(seed).head
    const bridge = resolvePublicV16GreenwaySite(seed, 'works3:bridge:1')
    if (!bridge || bridge.kind !== 'bridge' || bridge.blockingResourceIds.length) {
      throw new Error('Missing clear bridge')
    }
    const bridgeWorks = { builtBridgeIds: [bridge.id], builtLadderIds: [], dugTileIds: [] }
    const bridgePoint = { x: bridge.from.x, z: bridge.supportPath[1].z }
    const bridgeY = publicV16StarterSupportAt({ seed, profile: base.state.generationProfile,
      route: base.state.greenway.routes[0], built: false,
      greenwayWorks: bridgeWorks }, bridgePoint)?.floorY
    if (bridgeY === undefined) throw new Error('Missing bridge deck support')
    const bridgeState = { ...base.state, greenway: { ...base.state.greenway,
      studiedInscriptionIds: ['greenway_waystone' as const] },
    player: { ...base.state.player, xp: 80,
      skillXp: { ...base.state.player.skillXp, construction: 80 },
      learnedSpellIds: ['wayfinder_glow' as const],
      position: { ...bridgePoint, y: bridgeY } } }
    const bridgeProgress = { state: bridgeState, greenwayWorks: bridgeWorks }
    expect(decodePublicV16Progress(bridgeProgress, seed)).not.toBeNull()
    expect(validatePublicV14State(bridgeState, seed)).toBeNull()
    const cast = advancePublicV16GreenwayAction(bridgeProgress,
      { type: 'cast_spell', spellId: 'wayfinder_glow' })
    expect(cast.rejections).toEqual([])
    expect(cast.progress.state.player.position).toEqual(bridgeState.player.position)
    expect(cast.events[0]).toMatchObject({ type: 'spell_cast' })
    expect(decodePublicV16Progress(cast.progress, seed)).not.toBeNull()
    expect(advancePublicV16GreenwayAction(bridgeProgress,
      { type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' })
      .rejections[0]?.code).toBe('unavailable_here')

    const dig = resolvePublicV16GreenwaySite(seed, 'works3:dig:1:3')
    if (!dig || dig.kind !== 'dig') throw new Error('Missing canonical dig site')
    const digWorks = { builtBridgeIds: [], builtLadderIds: [], dugTileIds: [dig.id] }
    const digPoint = { x: dig.center.x, z: dig.center.z }
    const dugY = publicV16StarterSupportAt({ seed, profile: base.state.generationProfile,
      route: base.state.greenway.routes[0], built: false,
      greenwayWorks: digWorks }, digPoint)?.floorY
    if (dugY === undefined) throw new Error('Missing dug support')
    const dugState = { ...base.state, greenway: { ...base.state.greenway,
      studiedInscriptionIds: ['greenway_waystone' as const] },
    player: { ...base.state.player, xp: 30,
      skillXp: { ...base.state.player.skillXp, excavation: 30 },
      learnedSpellIds: ['wayfinder_glow' as const],
      position: { ...digPoint, y: dugY } } }
    const dugProgress = { state: dugState, greenwayWorks: digWorks }
    expect(decodePublicV16Progress(dugProgress, seed)).not.toBeNull()
    expect(validatePublicV14State(dugState, seed)).toBeNull()
    const dugCast = advancePublicV16GreenwayAction(dugProgress,
      { type: 'cast_spell', spellId: 'wayfinder_glow' })
    expect(dugCast.rejections).toEqual([])
    expect(dugCast.progress.state.player.position).toEqual(dugState.player.position)
    expect(dugCast.events[0]).toMatchObject({ type: 'spell_cast' })
    expect(decodePublicV16Progress(dugCast.progress, seed)).not.toBeNull()
  })

  it('checks and replays waystone study and new-tile spell XP, rejecting reward tampering', async () => {
    const factory = new FakeFactory(), store = createAtomicV16Store(factory)
    const fresh = await startFreshPublicV16(locks, store, seed)
    if (!fresh.ok) throw new Error(fresh.reason)
    const lineage = fresh.value.lineage
    const study = { type: 'study_inscription' as const,
      inscriptionId: 'greenway_waystone' as const }
    const cast = { type: 'cast_spell' as const, spellId: 'wayfinder_glow' as const }
    expect(advancePublicV16GreenwayAction({ state: fresh.value.state,
      greenwayWorks: fresh.value.greenwayWorks }, study).rejections[0]?.code).toBe('too_far')
    expect(await commitPublicV16GreenwayAction(locks, store, cast, 0, lineage))
      .toEqual({ ok: false, reason: 'action-rejected' })
    const approach = Array.from({ length: 16 }, () => ({ intents: [{ type: 'move' as const,
      delta: { x: 0.1, z: 0.1 } }], walkRequested: true }))
    const arrived = await commitPublicV16FrameBatch(locks, store, approach, 0, lineage)
    expect(arrived.ok, arrived.ok ? '' : arrived.reason).toBe(true)
    if (!arrived.ok) return
    const before = { state: arrived.value.start.state,
      greenwayWorks: arrived.value.start.greenwayWorks }
    const localStudy = advancePublicV16GreenwayAction(before, study)
    expect(localStudy.rejections).toEqual([])
    const studied = await commitPublicV16GreenwayAction(locks, store, study, 1, lineage)
    expect(studied.ok, studied.ok ? '' : studied.reason).toBe(true)
    if (!studied.ok) return
    expect(studied.value.start).toMatchObject({ saveRevision: 2,
      state: { greenway: { studiedInscriptionIds: ['greenway_waystone'] },
        player: { learnedSpellIds: ['wayfinder_glow'] } } })
    expect(studied.value.events).toEqual(localStudy.events)
    expect(await resumePublicV16(locks, store, 2, lineage)).toEqual({ ok: true,
      value: studied.value.start })
    expect(await commitPublicV16GreenwayAction(locks, store, study, 2, lineage))
      .toEqual({ ok: false, reason: 'action-rejected' })
    const expected = nearbyWorldTileIds(studied.value.start.state.player.position,
      PUBLIC_SPELL_REVEAL_RADIUS_METERS).filter((id) =>
        !decodeDiscoveredTileIds(studied.value.start.state.discoveryMask).includes(id))
    const localCast = advancePublicV16GreenwayAction({ state: studied.value.start.state,
      greenwayWorks: studied.value.start.greenwayWorks }, cast)
    expect(localCast.rejections).toEqual([])
    const casted = await commitPublicV16GreenwayAction(locks, store, cast, 2, lineage)
    expect(casted.ok, casted.ok ? '' : casted.reason).toBe(true)
    if (!casted.ok) return
    expect(casted.value.events).toEqual(localCast.events)
    expect(casted.value.events[0]).toMatchObject({ type: 'spell_cast',
      revealedTileIds: expected, revealedDigSiteIds: [] })
    expect(casted.value.start.state.player.skillXp).toMatchObject({
      spellcraft: expected.length * 10, wayfinding: expected.length * 10 })
    expect(await inspectPublicV16(locks, store)).toEqual({ ok: true,
      value: { status: 'valid', start: casted.value.start } })
    const repeated = await commitPublicV16GreenwayAction(locks, store, cast, 3, lineage)
    expect(repeated.ok, repeated.ok ? '' : repeated.reason).toBe(true)
    if (!repeated.ok) return
    expect(repeated.value.events).toMatchObject([{ type: 'spell_cast',
      revealedTileIds: [], revealedDigSiteIds: [] }])
    expect(repeated.value.events).toHaveLength(1)
    expect(repeated.value.start.state.player.skillXp).toEqual(casted.value.start.state.player.skillXp)
    expect(await resumePublicV16(locks, store, 4, lineage)).toEqual({ ok: true,
      value: repeated.value.start })
    const raw = await store.read()
    if (raw.status !== 'ok') throw new Error('Missing v16 root')
    const tampered = structuredClone(raw.head) as { value: {
      state: { player: { skillXp: { wayfinding: number } } } } }
    tampered.value.state.player.skillXp.wayfinding++
    await putRaw(factory, 'head', tampered)
    expect(await inspectPublicV16(locks, store)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v16-history' } })
  })

  it('creates a distinct root and persists only a replayed bounded frame', async () => {
    const factory = new FakeFactory(), store = createAtomicV16Store(factory)
    expect(await inspectPublicV16(locks, store)).toEqual({ ok: true,
      value: { status: 'missing' } })
    const fresh = await startFreshPublicV16(locks, store, seed)
    expect(fresh.ok).toBe(true)
    if (!fresh.ok) return
    const session = createPublicV16ContinuousSession(fresh.value)
    const local = advancePublicV16GreenwayFrame({ state: fresh.value.state,
      greenwayWorks: fresh.value.greenwayWorks }, move, { walkRequested: true })
    expect(local.rejections).toEqual([])
    expect(session.advanceFrame(move, { walkRequested: true }).rejections).toEqual([])
    expect(session.previewSnapshot()).toEqual(local.progress)
    expect(session.snapshotForSave()).toMatchObject({ status: 'ready', progress: local.progress })
    const saved = await commitPublicV16FrameBatch(locks, store, frames, 0, fresh.value.lineage)
    expect(saved.ok, saved.ok ? '' : saved.reason).toBe(true)
    if (!saved.ok) return
    expect(saved.value.start.saveRevision).toBe(1)
    expect(saved.value.start.state.player.position).toEqual(local.progress.state.player.position)
    expect(await inspectPublicV16(locks, store)).toEqual({ ok: true,
      value: { status: 'valid', start: saved.value.start } })
    expect(await resumePublicV16(locks, store, 1, fresh.value.lineage))
      .toEqual({ ok: true, value: saved.value.start })
    expect(await commitPublicV16FrameBatch(locks, store, frames, 0, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect((await factory.databases()).map((db) => db.name)).toEqual([PUBLIC_V16_DATABASE_NAME])
  })

  it('rejects generic reward edits and verifies raw frame history before any later write', async () => {
    const factory = new FakeFactory(), store = createAtomicV16Store(factory)
    const fresh = await startFreshPublicV16(locks, store, seed)
    if (!fresh.ok) throw new Error(fresh.reason)
    const { state, greenwayWorks, lineage } = fresh.value
    const fabricated = { state: { ...state, player: { ...state.player,
      xp: state.player.xp + 80,
      skillXp: { ...state.player.skillXp, construction: 80 } } },
    greenwayWorks: { ...greenwayWorks, builtBridgeIds: ['works3:bridge:0'] } }
    expect(await commitPublicV16Snapshot(locks, store, fabricated, 0, lineage))
      .toEqual({ ok: false, reason: 'action-required' })
    expect(await commitPublicV16Snapshot(locks, store,
      { state, greenwayWorks }, 0, lineage)).toMatchObject({ ok: true,
      value: { saveRevision: 1 } })
    expect(await commitPublicV16FrameBatch(locks, store, frames, 1, lineage))
      .toMatchObject({ ok: true, value: { start: { saveRevision: 2 } } })
    const raw = await store.read()
    if (raw.status !== 'ok') throw new Error('Missing v16 root')
    const tampered = structuredClone(raw.head) as { saveRevision: number;
      value: { state: { player: { coins: number } } } }
    tampered.value.state.player.coins++
    await putRaw(factory, 'head', tampered)
    expect(await inspectPublicV16(locks, store)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'invalid-v16-history' } })
    expect((await commitPublicV16Snapshot(locks, store,
      { state, greenwayWorks }, 2, lineage)).ok).toBe(false)
  })

  it('migrates only a checked, still identical v15 source under one shared lock', async () => {
    const factory = new FakeFactory(), v15 = createAtomicV15Store(factory)
    const v16 = createAtomicV16Store(factory)
    const old = await startFreshPublicV15(locks, v15, seed)
    if (!old.ok) throw new Error(old.reason)
    const before = await v15.read()
    const migrated = await startMigratedPublicV16(locks, v16, v15, old.value)
    expect(migrated.ok, migrated.ok ? '' : migrated.reason).toBe(true)
    if (!migrated.ok) return
    expect(migrated.value.lineage.origin).toBe('v15-migration')
    expect(migrated.value.state).toEqual(old.value.state)
    expect(migrated.value.greenwayWorks).toEqual({ builtBridgeIds: [],
      builtLadderIds: [], dugTileIds: [] })
    expect(await v15.read()).toEqual(before)
    expect(await inspectPublicV16(locks, v16)).toEqual({ ok: true,
      value: { status: 'valid', start: migrated.value } })
  })

  it('rejects a changed source revision, state, flags, or lineage before genesis writes', async () => {
    const factory = new FakeFactory(), v15 = createAtomicV15Store(factory)
    const v16 = createAtomicV16Store(factory)
    const old = await startFreshPublicV15(locks, v15, seed)
    if (!old.ok) throw new Error(old.reason)
    expect(await commitPublicV15FrameBatch(locks, v15, frames, 0, old.value.lineage))
      .toMatchObject({ ok: true })
    expect(await startMigratedPublicV16(locks, v16, v15, old.value))
      .toEqual({ ok: false, reason: 'source-changed' })
    const inspected = await inspectPublicV15(locks, v15)
    if (!inspected.ok || inspected.value.status !== 'valid') throw new Error('Missing v15 start')
    const current = inspected.value.start
    const changedState: PublicV15Start = { ...current, state: { ...current.state,
      player: { ...current.state.player, coins: current.state.player.coins + 1 } } }
    expect(await startMigratedPublicV16(locks, v16, v15, changedState))
      .toEqual({ ok: false, reason: 'source-changed' })
    const changedFlags: PublicV15Start = { ...current,
      state: { ...current.state, player: { ...current.state.player,
        xp: 80, skillXp: { ...current.state.player.skillXp, construction: 80 } } },
      starterWorks: { bridgeBuilt: true, bankCacheDug: false } }
    expect(await startMigratedPublicV16(locks, v16, v15, changedFlags))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect(await startMigratedPublicV16(locks, v16, v15, { ...current,
      lineage: { ...current.lineage, rulesProfile: 'starter-crossing/v1' } as never }))
      .toEqual({ ok: false, reason: 'invalid-source' })
    expect(await inspectPublicV16(locks, v16)).toEqual({ ok: true,
      value: { status: 'missing' } })
  })

  it('applies core actions only at real, unsuppressed v16 ground poses', async () => {
    const store = createAtomicV16Store(new FakeFactory())
    const fresh = await startFreshPublicV16(locks, store, seed)
    if (!fresh.ok) throw new Error(fresh.reason)
    const suppressed = publicWorldV15SuppressedStarterResourceIds(seed,
      fresh.value.state.greenway.resources)[0]
    expect(suppressed).toBeDefined()
    expect(await commitPublicV16GreenwayAction(locks, store,
      { type: 'harvest', resourceId: suppressed }, 0, fresh.value.lineage))
      .toEqual({ ok: false, reason: 'action-rejected' })
    const equipped = await commitPublicV16GreenwayAction(locks, store,
      { type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' },
      0, fresh.value.lineage)
    expect(equipped.ok, equipped.ok ? '' : equipped.reason).toBe(true)
    expect(await inspectPublicV16(locks, store)).toMatchObject({ ok: true,
      value: { status: 'valid', start: { saveRevision: 1,
        state: { player: { equipment: { mainHand: 'woodcutters_axe' } } } } } })
  })

  it('checks a work against the current root and replays its one-time reward', async () => {
    const factory = new FakeFactory(), store = createAtomicV16Store(factory)
    const fresh = await startFreshPublicV16(locks, store, seed)
    if (!fresh.ok) throw new Error(fresh.reason)
    const site = resolvePublicV16GreenwaySite(seed, 'works3:bridge:1')
    if (!site || site.kind !== 'bridge' || site.blockingResourceIds.length) {
      throw new Error('Missing clear shifted bridge')
    }
    const state = fresh.value.state
    const point = { x: site.from.x, z: site.from.z - 0.6 }
    const floor = publicV16StarterSupportAt({ seed, profile: state.generationProfile,
      route: state.greenway.routes[0] ?? null, built: false,
      greenwayWorks: fresh.value.greenwayWorks }, point)?.floorY
    if (floor === undefined) throw new Error('Missing approach floor')
    const ready = { state: { ...state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(state.discoveryMask), ...site.footprintTileIds,
      ])].sort()),
      player: { ...state.player, position: { ...point, y: floor },
        inventory: [...state.player.inventory, { itemId: 'logs' as const, quantity: 8 }] } },
    greenwayWorks: fresh.value.greenwayWorks }
    // The isolated fixture begins at an accepted last-two checkpoint.
    await putRaw(factory, 'previous', { saveRevision: 1,
      value: encodePublicV16Head(ready, 1, fresh.value.lineage) })
    await putRaw(factory, 'head', { saveRevision: 2,
      value: encodePublicV16Head(ready, 2, fresh.value.lineage) })
    expect(await inspectPublicV16(locks, store)).toMatchObject({ ok: true,
      value: { status: 'valid', start: { saveRevision: 2 } } })
    const built = await commitPublicV16GreenwayWork(locks, store, site.id, 2,
      fresh.value.lineage)
    expect(built.ok, built.ok ? '' : built.reason).toBe(true)
    if (!built.ok) return
    expect(built.value.event).toMatchObject({ kind: 'bridge', logsSpent: 8, xp: 80 })
    expect(built.value.start.greenwayWorks.builtBridgeIds).toEqual([site.id])
    expect(await inspectPublicV16(locks, store)).toEqual({ ok: true,
      value: { status: 'valid', start: built.value.start } })
    expect(await commitPublicV16GreenwayWork(locks, store, site.id, 3,
      fresh.value.lineage)).toEqual({ ok: false, reason: 'already_done' })
  })
})
