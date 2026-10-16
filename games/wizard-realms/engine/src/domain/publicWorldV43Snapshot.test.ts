import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV42Store } from './atomicV42Database'
import { createAtomicV43Store } from './atomicV43Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { confirmPublicV43FamiliarAction } from './publicWorldV43FamiliarAction'
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
function eligibleV42(): PublicV42Root {
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
          { itemId: 'marsh_herb' as const, quantity: 1 },
          { itemId: 'logs' as const, quantity: 2 }] } } }
  const root: PublicV42Root = { lineage: { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed, sourceRevision: 4, genesis },
    previous: null, head: { ...genesis, schemaVersion: PUBLIC_V42_SCHEMA,
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
    previous: null, head: { ...genesis, schemaVersion: PUBLIC_V42_SCHEMA,
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

  it('replays one familiar action, a grounded frame, and exact save/resume', async () => {
    const factory = new IDBFactory(), oldStore = createAtomicV42Store(factory)
    const store = createAtomicV43Store(factory), source = eligibleV42()
    const sourceBytes = JSON.stringify(source)
    await putRaw(factory, PUBLIC_V42_DATABASE_NAME, source)
    expect(await inspectPublicV43(locks as never, store))
      .toEqual({ ok: true, value: { status: 'migration-available' } })
    expect(await startPublicV43(locks as never, store, oldStore, 1))
      .toEqual({ ok: false, reason: 'source-revision-changed' })
    const start = await startPublicV43(locks as never, store, oldStore, 0)
    if (!start.ok) throw new Error(start.reason)
    expect(start.value.head.familiar.phase).toBe('search')
    expect(await commitPublicV43(locks as never, store,
      start.value.head.saveRevision, start.value.lineage,
      { kind: 'familiar-tracks/v1' })).toMatchObject({ ok: true,
        value: { head: { saveRevision: 1, familiar: { phase: 'tracks' } } } })
    const afterTracks = await store.readChecked()
    if (afterTracks.status !== 'valid') throw new Error('Missing V43 root')
    expect(await commitPublicV43(locks as never, store,
      afterTracks.root.head.saveRevision, afterTracks.root.lineage, idle))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 2 } } })
    const saved = await store.readChecked()
    if (saved.status !== 'valid') throw new Error('Missing saved V43 root')
    expect(saved.root.head.state.tick).toBe(source.head.state.tick + 1)
    expect(saved.root.head.familiar.phase).toBe('tracks')
    expect(await resumePublicV43(locks as never, store,
      saved.root.head.saveRevision, saved.root.lineage)).toMatchObject({ ok: true,
        value: { head: { saveRevision: 2 } } })
    expect(JSON.stringify(await getRaw(factory, PUBLIC_V42_DATABASE_NAME))).toBe(sourceBytes)
    expect(await commitPublicV43(locks as never, store,
      1, saved.root.lineage, { kind: 'familiar-tracks/v1' }))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await commitPublicV43(locks as never, store,
      2, saved.root.lineage, { kind: 'familiar-tracks/v1' }))
      .toEqual({ ok: false, reason: 'wrong_stage' })
    expect((await store.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 2 } } })
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

  it('replays escort to the keeper, saves the claim once, and rejects a second payout', async () => {
    let root = createPublicV43Root(eligibleV42())
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
    await putRaw(factory, PUBLIC_V43_DATABASE_NAME, returnedRoot)
    expect(await commitPublicV43(locks as never, store,
      returnedRoot.head.saveRevision, returnedRoot.lineage,
      { kind: 'familiar-claim/v1' })).toMatchObject({ ok: true,
        value: { head: { saveRevision: root.head.saveRevision,
          familiar: { phase: 'claimed' } } } })
    const saved = await store.readChecked()
    expect(saved.status).toBe('valid')
    if (saved.status !== 'valid') return
    expect(await resumePublicV43(locks as never, store,
      root.head.saveRevision, root.lineage)).toMatchObject({ ok: true,
        value: { head: { familiar: { phase: 'claimed' } } } })
    expect(await commitPublicV43(locks as never, store,
      root.head.saveRevision, root.lineage, { kind: 'familiar-claim/v1' }))
      .toEqual({ ok: false, reason: 'already_claimed' })
    const after = await store.readChecked()
    expect(after.status).toBe('valid')
    if (after.status === 'valid') {
      expect(after.root.head.state.player.coins).toBe(root.head.state.player.coins)
      expect(after.root.head.saveRevision).toBe(root.head.saveRevision)
    }
  }, 120000)

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
    if (oldRead.status === 'valid') expect(oldRead.root).toEqual(decodePublicV42Root(source))
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
    expect(await startFreshPublicV43(locks as never,
      createAtomicV43Store(new IDBFactory()), seed)).toMatchObject({ ok: true,
        value: { head: { saveRevision: 0 } } })
  })
})
