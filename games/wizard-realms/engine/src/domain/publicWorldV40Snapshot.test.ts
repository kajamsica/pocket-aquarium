/** V40 save isolation, checked replay and Waystation durability across reloads. */
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV39Store } from './atomicV39Database'
import { createAtomicV40Store } from './atomicV40Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { highlandLandmark } from './highlandContent'
import { highlandQuarryRing } from './highlandQuarryRingContent'
import { samePublicV14Value } from './publicWorldV14Validation'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { commitPublicV40, resumePublicV40, startFreshPublicV40,
  startPublicV40 } from './publicWorldV40Flow'
import { createFreshPublicV39Root, decodePublicV39Root,
  PUBLIC_V39_DATABASE_NAME, PUBLIC_V39_SCHEMA } from './publicWorldV39Snapshot'
import type { PublicV39Root } from './publicWorldV39Snapshot'
import { createFreshPublicV40Root, createPublicV40Root,
  decodePublicV40CheckedSuccessor, decodePublicV40Root, replayPublicV40Witness,
  PUBLIC_V40_DATABASE_NAME, PUBLIC_V40_SCHEMA } from './publicWorldV40Snapshot'
import type { PublicV40Head, PublicV40Root, PublicV40Witness } from './publicWorldV40Snapshot'
import * as waystationContent from './waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'
import type { Vec3 } from './types'

const seed = 'wizard-realms'
const site = waystationContent.waystationRiverSite(seed)!
const idle = { kind: 'frame-batch/v1' as const,
  frames: [{ intents: [], walkRequested: true }] }
const barter = { kind: 'waystation-barter/v1' as const }
const cross = { kind: 'waystation-cross/v1' as const }
const claim = { kind: 'waystation-claim/v1' as const }
const outbound = { kind: 'ringkeeper-travel/v1' as const,
  direction: 'greenway-to-highland' as const }
const locks = { request: vi.fn(async (_name: string, _options: unknown,
  body: () => Promise<unknown>) => body()) }

function revealed(...ids: string[]) {
  return encodeDiscoveredTileIds([...new Set(ids)].sort())
}

/** V39 migration genesis may start at an authored, already revealed location. */
function v39At(position: Vec3, owner: 'greenway' | 'streamed',
  options: { tiles?: string[]; stone?: number; built?: boolean;
    signalInspected?: boolean; greenwayRing?: boolean } = {}): PublicV39Root {
  const fresh = createFreshPublicV39Root(seed)
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...base } = fresh.head
  const player = base.state.player
  const currentTile = worldTileAtGrid(seed,
    Math.ceil(position.x / WORLD_CELL_METERS - 0.5),
    Math.ceil(position.z / WORLD_CELL_METERS - 0.5))
  const progress = { ...base,
    riverBridgeIds: options.built ? [site.id] : base.riverBridgeIds,
    signalVantageInspected: options.signalInspected ?? false,
    state: { ...base.state, movementOwner: owner,
      discoveryMask: revealed(...decodeDiscoveredTileIds(base.state.discoveryMask),
        currentTile.id, ...(options.tiles ?? []),
        ...(options.built ? site.footprintTileIds : [])),
      player: { ...player, position, verticalVelocity: 0,
        inventory: options.stone ? [...player.inventory,
          { itemId: 'stone' as const, quantity: options.stone }] : player.inventory,
        discoveredRingIds: options.greenwayRing
          ? [...new Set([...player.discoveredRingIds, 'ring-greenway'])].sort()
          : player.discoveredRingIds } } }
  const source: PublicV39Root = { lineage: { origin: 'v38-migration',
    rulesProfile: 'ringkeeper-trail/v1', seed, sourceRevision: 9, genesis: progress },
  previous: null, head: { ...progress, schemaVersion: PUBLIC_V39_SCHEMA,
    saveRevision: 0, witness: null } }
  if (!decodePublicV39Root(source)) throw new Error('Invalid checked V39 fixture')
  return source
}

function successor(root: PublicV40Root, witness: PublicV40Witness): PublicV40Root {
  const progress = replayPublicV40Witness(root.head, witness)
  if (!progress) throw new Error(`Rejected ${witness.kind}`)
  return { lineage: root.lineage, previous: root.head,
    head: { ...progress, schemaVersion: PUBLIC_V40_SCHEMA,
      saveRevision: root.head.saveRevision + 1, witness } }
}

/** A pruned three-slot history keeps the last real replay edge. */
function pruned(root: PublicV40Root, previous: PublicV40Head): PublicV40Root {
  const progress = replayPublicV40Witness(previous, idle)
  if (!progress) throw new Error('Invalid inherited frame')
  const next: PublicV40Root = { lineage: root.lineage, previous,
    head: { ...progress, schemaVersion: PUBLIC_V40_SCHEMA,
      saveRevision: previous.saveRevision + 1, witness: idle } }
  if (!decodePublicV40Root(next)) throw new Error('Invalid pruned V40 fixture')
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

describe('V40 checked copy and Waystation save replay', () => {
  it('pins fresh genesis and copies only a checked V39 head, leaving its source intact', () => {
    const fresh = createFreshPublicV40Root(seed)
    const source = v39At(site.approach, 'streamed', {
      tiles: [site.footprintTileIds[0]], stone: 2 })
    const original = structuredClone(source), copied = createPublicV40Root(source)
    expect(PUBLIC_V40_DATABASE_NAME).not.toBe(PUBLIC_V39_DATABASE_NAME)
    expect(fresh).toMatchObject({ lineage: { origin: 'fresh', sourceRevision: null,
      rulesProfile: 'waystation-repair/v1' }, head: { schemaVersion: PUBLIC_V40_SCHEMA,
        timberBartered: false, southbankReached: false, waystationClaimed: false } })
    expect(decodePublicV40Root(fresh)).toEqual(fresh)
    expect(copied.lineage).toMatchObject({ origin: 'v39-migration',
      sourceRevision: 0, rulesProfile: 'waystation-repair/v1' })
    expect(copied.head.state).toEqual(source.head.state)
    expect(decodePublicV40Root(copied)).toEqual(copied)
    expect(source).toEqual(original)
    copied.head.state.discoveryMask[0] ^= 1
    expect(source).toEqual(original)
    expect(() => createFreshPublicV40Root('other-seed')).toThrow('Invalid fresh seed')
    expect(() => createPublicV40Root({ ...source,
      head: { ...source.head, saveRevision: 1 } })).toThrow('Invalid checked V39 source root')
  })

  it('starts a fresh V40 store without creating a V39 source', async () => {
    const factory = new IDBFactory(), source = createAtomicV39Store(factory)
    const target = createAtomicV40Store(factory)
    expect(await startFreshPublicV40(locks as never, target, seed))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 0 },
        lineage: { origin: 'fresh', sourceRevision: null } } })
    expect(await target.readChecked()).toMatchObject({ status: 'valid' })
    expect(await source.readChecked()).toMatchObject({ status: 'missing' })
  })

  it('rejects a selector-unavailable migration and malformed target without writing V39', async () => {
    const source = v39At(site.approach, 'streamed')
    const factory = new IDBFactory(), oldStore = createAtomicV39Store(factory)
    const target = createAtomicV40Store(factory)
    await putRaw(factory, PUBLIC_V39_DATABASE_NAME, source)
    const original = (await oldStore.readChecked())
    const valid = createPublicV40Root(source)
    const unavailable = vi.spyOn(waystationContent, 'waystationRiverSite')
      .mockReturnValue(null)
    try {
      expect(() => createPublicV40Root(source)).toThrow('Unsupported Waystation river site')
      expect(decodePublicV40Root(valid)).toBeNull()
    } finally { unavailable.mockRestore() }
    expect(decodePublicV40Root({ ...valid, lineage: { ...valid.lineage,
      rulesProfile: 'wrong' } })).toBeNull()
    expect(decodePublicV40Root({ ...valid, head: { ...valid.head,
      waystationClaimed: true } })).toBeNull()
    await putRaw(factory, PUBLIC_V40_DATABASE_NAME, { invalid: true })
    expect(await target.readChecked()).toEqual({ status: 'blocked',
      reason: 'invalid-v40-root' })
    expect(await startPublicV40(locks as never, target, oldStore, 0))
      .toEqual({ ok: false, reason: 'invalid-v40-root' })
    expect(await startFreshPublicV40(locks as never, target, seed))
      .toEqual({ ok: false, reason: 'invalid-v40-root' })
    expect(await oldStore.readChecked()).toEqual(original)
  })

  it('keeps V39 read-only through migration and refuses stale source, CAS and lineage', async () => {
    const factory = new IDBFactory(), sourceStore = createAtomicV39Store(factory)
    const target = createAtomicV40Store(factory), source = v39At(site.approach,
      'streamed', { tiles: [site.footprintTileIds[0]], stone: 2 })
    await putRaw(factory, PUBLIC_V39_DATABASE_NAME, source)
    expect(await startPublicV40(locks as never, target, sourceStore, 1))
      .toEqual({ ok: false, reason: 'source-revision-changed' })
    const started = await startPublicV40(locks as never, target, sourceStore, 0)
    if (!started.ok) throw new Error(started.reason)
    expect((await sourceStore.readChecked())).toMatchObject({ status: 'valid', root: source })
    const left = await target.readChecked(), right = await target.readChecked()
    if (left.status !== 'valid' || right.status !== 'valid') throw new Error('Missing V40 root')
    const next = successor(left.root, barter)
    expect(await target.commit(left.proof, next)).toBe('committed')
    expect(await target.commit(right.proof, next)).toBe('revision-changed')
    expect(await commitPublicV40(locks as never, target, 0, started.value.lineage, barter))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await resumePublicV40(locks as never, target, 1,
      { ...started.value.lineage, sourceRevision: 5 }))
      .toEqual({ ok: false, reason: 'lineage-changed' })
    expect((await sourceStore.readChecked())).toMatchObject({ status: 'valid', root: source })
  })

  it('replays barter exactly once and rejects material, reward and prior-edge forgery', () => {
    const source = v39At(site.approach, 'streamed', {
      tiles: [site.footprintTileIds[0]], stone: 2 })
    const root = createPublicV40Root(source), traded = successor(root, barter)
    expect(traded.head.timberBartered).toBe(true)
    expect(decodePublicV40CheckedSuccessor(root, traded)).toEqual(traded)
    expect(decodePublicV40Root(traded)).toEqual(traded)
    const stones = (inventory: typeof traded.head.state.player.inventory) => inventory
      .filter(({ itemId }) => itemId === 'stone')
      .reduce((sum, stack) => sum + stack.quantity, 0)
    const logs = (inventory: typeof traded.head.state.player.inventory) => inventory
      .filter(({ itemId }) => itemId === 'logs')
      .reduce((sum, stack) => sum + stack.quantity, 0)
    expect(stones(traded.head.state.player.inventory))
      .toBe(stones(root.head.state.player.inventory) - 2)
    expect(logs(traded.head.state.player.inventory))
      .toBe(logs(root.head.state.player.inventory) + 8)
    expect(replayPublicV40Witness(traded.head, barter)).toBeNull()
    const settled = successor(traded, idle)
    expect(decodePublicV40Root(settled)).toEqual(settled)
    expect(decodePublicV40Root({ ...settled, previous: {
      ...settled.previous!, timberBartered: false } })).toBeNull()
    expect(decodePublicV40CheckedSuccessor(root, { ...traded,
      previous: null })).toBeNull()
    expect(decodePublicV40CheckedSuccessor(root, { ...traded, head: {
      ...traded.head, state: { ...traded.head.state, player: {
        ...traded.head.state.player, coins: traded.head.state.player.coins + 45 } } } }))
      .toBeNull()
    expect(decodePublicV40CheckedSuccessor(root, { ...traded, head: {
      ...traded.head, state: { ...traded.head.state, player: {
        ...traded.head.state.player, inventory: [...traded.head.state.player.inventory,
          { itemId: 'logs', quantity: 1 }] } } } })).toBeNull()
    expect(replayPublicV40Witness(root.head, { ...barter, logs: 999 })).toBeNull()
  })

  it('preserves Waystation flags through inherited Ringkeeper and Signal witnesses', () => {
    const greenway = createFreshPublicV39Root(seed).head.state.greenway
    const ring = greenway.fairyRings.find(({ id }) => id === 'ring-greenway')!
    const ringTile = worldTileAtGrid(seed,
      Math.ceil(ring.position.x / WORLD_CELL_METERS - 0.5),
      Math.ceil(ring.position.z / WORLD_CELL_METERS - 0.5))
    const floor = publicV17StarterSupportAt({ seed,
      profile: createFreshPublicV39Root(seed).head.state.generationProfile,
      route: greenway.routes.find(({ id }) => id === 'greenway_ladder') ?? null,
      built: greenway.builtRouteIds.includes('greenway_ladder'),
      greenwayWorks: createFreshPublicV39Root(seed).head.greenwayWorks }, ring.position)!
    const source = v39At({ ...ring.position, y: floor.floorY }, 'greenway', {
      tiles: [ringTile.id, highlandQuarryRing(seed).tile.id], greenwayRing: true })
    const base = createPublicV40Root(source)
    const linked = pruned(base, { ...base.head, timberBartered: true,
      quarryRingDiscovered: true, ringLinkEstablished: true,
      saveRevision: 2, witness: idle })
    const traveled = successor(linked, outbound)
    expect(decodePublicV40CheckedSuccessor(linked, traveled)).toEqual(traveled)
    expect(traveled.head).toMatchObject({ timberBartered: true,
      ringOutboundCompleted: true, southbankReached: false, waystationClaimed: false })

    const crown = highlandLandmark(seed).tile
    const crownSource = v39At(crown.center, 'streamed', {
      tiles: [crown.id], built: true, signalInspected: true })
    const signalBase = createPublicV40Root(crownSource)
    const completed = pruned(signalBase, { ...signalBase.head,
      southbankReached: true, waystationClaimed: true,
      saveRevision: 2, witness: idle })
    const signaled = successor(completed, { kind: 'signal-claim/v1' })
    expect(decodePublicV40CheckedSuccessor(completed, signaled)).toEqual(signaled)
    expect(signaled.head).toMatchObject({ signalClaimed: true,
      southbankReached: true, waystationClaimed: true })
  })

  it('saves the selected bridge, checked crossing and one-time payout across reload', async () => {
    const far = createPublicV40Root(v39At(site.exit, 'streamed', { built: true }))
    const crossed = successor(far, cross)
    expect(decodePublicV40CheckedSuccessor(far, crossed)).toEqual(crossed)
    expect(crossed.head).toMatchObject({ southbankReached: true,
      riverBridgeIds: [site.id] })
    const store = createFreshPublicV39Root(seed).head.state.greenway.stores
      .find(({ id }) => id === 'store-greenway')!
    const source = v39At(store.position, 'greenway', { built: true })
    const base = createPublicV40Root(source)
    const returned = pruned(base, { ...base.head, southbankReached: true,
      saveRevision: 2, witness: idle })
    const factory = new IDBFactory(), target = createAtomicV40Store(factory)
    await putRaw(factory, PUBLIC_V40_DATABASE_NAME, returned)
    const initial = returned.head.state.player
    const paid = await commitPublicV40(locks as never, target, 3, returned.lineage, claim)
    if (!paid.ok) throw new Error(paid.reason)
    expect(paid.value.head).toMatchObject({ waystationClaimed: true,
      riverBridgeIds: [site.id], state: { player: {
        coins: initial.coins + 45, xp: initial.xp + 45,
        skillXp: { wayfinding: initial.skillXp.wayfinding + 45 } } } })
    expect(await commitPublicV40(locks as never, target, 4, returned.lineage, claim))
      .toEqual({ ok: false, reason: 'already_claimed' })
    const reloaded = await createAtomicV40Store(factory).readChecked()
    if (reloaded.status !== 'valid') throw new Error('Invalid V40 reload')
    expect(reloaded.root.head.riverBridgeIds).toContain(site.id)
    expect(samePublicV14Value(reloaded.root.head, paid.value.head)).toBe(true)
    expect(await resumePublicV40(locks as never, target, 4, returned.lineage))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 4 } } })
    expect(replayPublicV40Witness(reloaded.root.head, idle)).toMatchObject({
      waystationClaimed: true, southbankReached: true,
      riverBridgeIds: [site.id] })
    expect(replayPublicV40Witness(base.head, cross)).toBeNull()
  })
})
