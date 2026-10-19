/** V42 migration, replay, tamper resistance, and atomic save proof. */
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV41Store } from './atomicV41Database'
import { createAtomicV42Store } from './atomicV42Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { ironHallQuartermasterSite } from './ironHallQuartermasterSite'
import { ironHallSite } from './ironHallSite'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { commitPublicV42, resumePublicV42, startFreshPublicV42,
  startPublicV42, requestPublicV42ReturnHome } from './publicWorldV42Flow'
import { createFreshPublicV39Root, decodePublicV39Root,
  PUBLIC_V39_SCHEMA } from './publicWorldV39Snapshot'
import type { PublicV39Root } from './publicWorldV39Snapshot'
import { createFreshPublicV40Root, createPublicV40Root, decodePublicV40Root,
  replayPublicV40Witness,
  PUBLIC_V40_SCHEMA } from './publicWorldV40Snapshot'
import type { PublicV40Root } from './publicWorldV40Snapshot'
import { createPublicV41Root, decodePublicV41CheckedSuccessor,
  decodePublicV41Root, replayPublicV41Witness, PUBLIC_V41_DATABASE_NAME,
  PUBLIC_V41_SCHEMA } from './publicWorldV41Snapshot'
import type { PublicV41Root, PublicV41Witness } from './publicWorldV41Snapshot'
import { resolveIronHallCrestOutcome } from './publicWorldV42RewardAction'
import { createFreshPublicV42Root, createPublicV42Root,
  decodePublicV42CheckedSuccessor, decodePublicV42Root, replayPublicV42Witness,
  PUBLIC_V42_DATABASE_NAME, PUBLIC_V42_SCHEMA } from './publicWorldV42Snapshot'
import type { PublicV42Root, PublicV42Witness } from './publicWorldV42Snapshot'
import { waystationRiverSite } from './waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const bridge = waystationRiverSite(seed)!
const hall = ironHallSite(createFreshPublicV40Root(seed).head)!
const quartermaster = ironHallQuartermasterSite(createFreshPublicV40Root(seed).head)!
const locks = { request: async (_name: string, _options: unknown,
  body: () => Promise<unknown>) => body() }
const frames = (count: number) => ({ kind: 'frame-batch/v1' as const,
  frames: Array.from({ length: count }, () => ({ intents: [], walkRequested: true })) })
const moving = (count: number, z: number, x = 0) => ({ kind: 'frame-batch/v1' as const,
  frames: Array.from({ length: count }, () => ({ intents: [{ type: 'move' as const,
    delta: { x, z } }], walkRequested: true })) })
const study = { kind: 'ironhall-study/v1' } as const
const engage = { kind: 'ironhall-engage/v1' } as const
const bolt = { kind: 'ironhall-bolt/v1' } as const
const claim = { kind: 'ironhall-claim/v1' } as const
const spar = { kind: 'ironhall-spar/v1' } as const
const repair = { kind: 'ironhall-vest-repair/v1' } as const

function crossedV40(): PublicV40Root {
  const fresh = createFreshPublicV39Root(seed)
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...base } = fresh.head
  const position = hall.alcove.center
  const tile = worldTileAtGrid(seed,
    Math.ceil(position.x / WORLD_CELL_METERS - 0.5),
    Math.ceil(position.z / WORLD_CELL_METERS - 0.5))
  const genesis = { ...base, riverBridgeIds: [bridge.id],
    state: { ...base.state, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask), tile.id,
        ...bridge.footprintTileIds, hall.alcove.id, hall.ward.id,
        hall.door.id, quartermaster.id])].sort()),
      player: { ...base.state.player, position, verticalVelocity: 0 } } }
  const v39: PublicV39Root = { lineage: { origin: 'v38-migration',
    rulesProfile: 'ringkeeper-trail/v1', seed, sourceRevision: 9, genesis },
    previous: null, head: { ...genesis, schemaVersion: PUBLIC_V39_SCHEMA,
      saveRevision: 0, witness: null } }
  expect(decodePublicV39Root(v39)).not.toBeNull()
  const base40 = createPublicV40Root(v39)
  const previous = { ...base40.head, southbankReached: true,
    saveRevision: 2, witness: frames(1) }
  const progress = replayPublicV40Witness(previous, frames(1))!
  const v40: PublicV40Root = { lineage: base40.lineage, previous,
    head: { ...progress, schemaVersion: PUBLIC_V40_SCHEMA,
      saveRevision: 3, witness: frames(1) } }
  expect(decodePublicV40Root(v40)).not.toBeNull()
  return v40
}

function next41(root: PublicV41Root, witness: PublicV41Witness): PublicV41Root {
  const progress = replayPublicV41Witness(root.head, witness)
  if (!progress) throw new Error(`V41 rejected ${witness.kind}`)
  const next: PublicV41Root = { lineage: root.lineage, previous: root.head,
    head: { ...progress, schemaVersion: PUBLIC_V41_SCHEMA,
      saveRevision: root.head.saveRevision + 1, witness } }
  if (!decodePublicV41CheckedSuccessor(root, next))
    throw new Error(`V41 edge rejected ${witness.kind}`)
  return next
}

function defeatedV41(): PublicV41Root {
  let root = createPublicV41Root(crossedV40())
  for (const witness of [study, engage, frames(20), bolt, frames(12), bolt,
    frames(12), bolt] as PublicV41Witness[]) root = next41(root, witness)
  expect(root.head.ironHall.wardDefeated).toBe(true)
  expect(decodePublicV41Root(root)).not.toBeNull()
  return root
}

function next42(root: PublicV42Root, witness: PublicV42Witness): PublicV42Root {
  const progress = replayPublicV42Witness(root.head, witness)
  if (!progress) throw new Error(`V42 rejected ${witness.kind}`)
  const next: PublicV42Root = { lineage: root.lineage, previous: root.head,
    head: { ...progress, schemaVersion: PUBLIC_V42_SCHEMA,
      saveRevision: root.head.saveRevision + 1, witness } }
  if (!decodePublicV42CheckedSuccessor(root, next))
    throw new Error(`V42 edge rejected ${witness.kind}`)
  return next
}

function claimedV42(): PublicV42Root {
  const base = createPublicV42Root(defeatedV41())
  return next42(next42(base, moving(12, -0.16)), claim)
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

describe('V42 checked save and reward replay', () => {
  it('reports a reachable return-home request as not_trapped without a write', async () => {
    const store = createAtomicV42Store(new IDBFactory())
    const started = await startFreshPublicV42(locks as never, store, seed)
    if (!started.ok) throw new Error(started.reason)
    const before = await store.readChecked()
    if (before.status !== 'valid') throw new Error('Missing fresh V42 root')
    expect(await requestPublicV42ReturnHome(locks as never, store,
      started.value.head.saveRevision, started.value.lineage))
      .toEqual({ ok: false, reason: 'not_trapped' })
    const after = await store.readChecked()
    expect(after.status).toBe('valid')
    if (after.status === 'valid') expect(after.root).toEqual(before.root)
  })

  it('copies only checked V41, keeps its source bytes, and pins fresh genesis', async () => {
    const fresh = createFreshPublicV42Root(seed)
    expect(fresh).toMatchObject({ lineage: { origin: 'fresh', sourceRevision: null,
      rulesProfile: 'iron-hall-rewards/v1' }, head: { schemaVersion: PUBLIC_V42_SCHEMA,
        ironHallReward: { crestOutcome: 'unrolled', questClaimed: false } } })
    expect(decodePublicV42Root(fresh)).toEqual(fresh)
    expect(PUBLIC_V42_DATABASE_NAME).not.toBe(PUBLIC_V41_DATABASE_NAME)
    expect(() => createFreshPublicV42Root('other-seed')).toThrow('Invalid fresh seed')

    const source = defeatedV41(), bytes = JSON.stringify(source)
    const copied = createPublicV42Root(source)
    expect(copied).toMatchObject({ lineage: { origin: 'v41-migration',
      sourceRevision: source.head.saveRevision }, head: { saveRevision: 0,
        ironHallReward: { crestOutcome: resolveIronHallCrestOutcome(seed) } } })
    expect(decodePublicV42Root(copied)).toEqual(copied)
    expect(JSON.stringify(source)).toBe(bytes)
    expect(() => createPublicV42Root({ ...source, head: {
      ...source.head, ironHall: { ...source.head.ironHall, combatXp: 999 } } }))
      .toThrow('Invalid checked V41 source root')

    const factory = new IDBFactory(), oldStore = createAtomicV41Store(factory)
    const target = createAtomicV42Store(factory)
    await putRaw(factory, PUBLIC_V41_DATABASE_NAME, source)
    const sourceBefore = await oldStore.readChecked()
    expect(await startPublicV42(locks as never, target, oldStore,
      source.head.saveRevision - 1)).toEqual({ ok: false,
        reason: 'source-revision-changed' })
    expect(await startPublicV42(locks as never, target, oldStore,
      source.head.saveRevision)).toMatchObject({ ok: true,
        value: { head: { saveRevision: 0 } } })
    expect(JSON.stringify(await oldStore.readChecked())).toBe(JSON.stringify(sourceBefore))
    expect(JSON.stringify(source)).toBe(bytes)
    expect(await startPublicV42(locks as never, target, oldStore,
      source.head.saveRevision)).toEqual({ ok: false, reason: 'target-conflict' })

    const other = new IDBFactory(), broken = createAtomicV42Store(other)
    await putRaw(other, PUBLIC_V42_DATABASE_NAME, { invalid: true })
    expect(await broken.readChecked()).toEqual({ status: 'blocked',
      reason: 'invalid-v42-root' })
    expect(await startFreshPublicV42(locks as never, broken, seed))
      .toEqual({ ok: false, reason: 'invalid-v42-root' })
    expect(await startFreshPublicV42(locks as never,
      createAtomicV42Store(new IDBFactory()), seed))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 0 } } })
  }, 20000)

  it('records a missed crest when a checked alternate-seed V41 ward is copied', () => {
    const source = createPublicV41Root(crossedV40())
    const alternateSeed = 'greenway-alpha'
    expect(resolveIronHallCrestOutcome(seed)).toBe('won')
    expect(resolveIronHallCrestOutcome(alternateSeed)).toBe('missed')
    const altState = createPublicV23Root(alternateSeed).head.state
    const altHall = ironHallSite({ ...source.head, state: altState })!
    const altBridge = waystationRiverSite(alternateSeed)!
    const position = altHall.alcove.center
    const tile = worldTileAtGrid(alternateSeed,
      Math.ceil(position.x / WORLD_CELL_METERS - 0.5),
      Math.ceil(position.z / WORLD_CELL_METERS - 0.5))
    const genesis = { ...source.lineage.genesis,
      riverBridgeIds: [altBridge.id],
      state: { ...altState, movementOwner: 'streamed' as const,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(altState.discoveryMask), tile.id,
          ...altBridge.footprintTileIds, altHall.alcove.id, altHall.ward.id,
          altHall.door.id])].sort()),
        player: { ...altState.player, position, verticalVelocity: 0 } } }
    let migrated: PublicV41Root = { lineage: { ...source.lineage,
      seed: alternateSeed, genesis }, previous: null,
      head: { ...genesis, schemaVersion: PUBLIC_V41_SCHEMA,
        saveRevision: 0, witness: null } }
    expect(decodePublicV41Root(migrated)).not.toBeNull()
    for (const witness of [study, engage, frames(20), bolt, frames(12), bolt,
      frames(12), bolt] as PublicV41Witness[]) migrated = next41(migrated, witness)
    expect(migrated.head.ironHall.wardDefeated).toBe(true)
    const copied = createPublicV42Root(migrated)
    expect(copied.head.ironHallReward.crestOutcome).toBe('missed')
    expect(decodePublicV42Root(copied)).toEqual(copied)
  }, 20000)

  it('matches per-frame spar replay, then saves wear and priced repair', async () => {
    const claimed = claimedV42()
    const nearWard = next42(next42(claimed, moving(42, 0.16)), moving(12, 0, 0.16))
    expect(Math.hypot(nearWard.head.state.player.position.x - hall.ward.center.x,
      nearWard.head.state.player.position.z - hall.ward.center.z)).toBeLessThan(3)
    const started = next42(nearWard, spar)
    const batch = frames(20)
    const whole = replayPublicV42Witness(started.head, batch)!
    let each = started.head as typeof whole
    for (const single of batch.frames) each = replayPublicV42Witness(each,
      { kind: 'frame-batch/v1', frames: [{ ...single }] })!
    expect(whole).toEqual(each)
    const struck = next42(started, batch)
    expect(struck.head.ironHall.playerHealth).toBe(started.head.ironHall.playerHealth - 2)
    expect(struck.head.ironHallReward).toMatchObject({ vestDurability: 11,
      spar: { active: false, strikesResolved: 1 } })
    expect(struck.head.state.player.coins).toBe(started.head.state.player.coins)
    expect(struck.head.state.player.xp).toBe(started.head.state.player.xp)
    expect(struck.head.ironHallReward.crestOutcome)
      .toBe(started.head.ironHallReward.crestOutcome)
    expect(replayPublicV42Witness(struck.head, spar)).toBeNull()
    expect(decodePublicV42Root(struck)).toEqual(struck)

    const returned = next42(next42(struck, moving(12, 0, -0.16)), moving(42, -0.16))
    const repaired = next42(returned, repair)
    expect(repaired.head.ironHallReward.vestDurability).toBe(12)
    expect(repaired.head.state.player.coins).toBe(returned.head.state.player.coins - 18)
    expect(repaired.head.ironHallReward.questClaimed).toBe(true)
    expect(replayPublicV42Witness(repaired.head, repair)).toBeNull()
    expect(decodePublicV42Root(repaired)).toEqual(repaired)
    const factory = new IDBFactory(), store = createAtomicV42Store(factory)
    await putRaw(factory, PUBLIC_V42_DATABASE_NAME, returned)
    const savePhases: string[] = []
    const saved = await commitPublicV42(locks as never, store,
      returned.head.saveRevision, returned.lineage, repair,
      (sample) => savePhases.push(sample.phase))
    expect(saved).toMatchObject({ ok: true,
      value: { head: { ironHallReward: { vestDurability: 12 } } } })
    expect(savePhases).toContain('atomic-readChecked-decode')
    expect(savePhases).toContain('atomic-commit-cas')
    expect(savePhases).toContain('atomic-commit-tx-completion')
    expect(await createAtomicV42Store(factory).readChecked())
      .toMatchObject({ status: 'valid', root: repaired })
  }, 30000)

  it('refuses malformed witnesses and forged reward, vest, health and lineage', () => {
    const base = createPublicV42Root(defeatedV41())
    const checkpoint = next42(base, { kind: 'checkpoint' })
    const forged = (head: PublicV42Root['head']) =>
      decodePublicV42CheckedSuccessor(base, { ...checkpoint, head })
    expect(forged({ ...checkpoint.head, state: { ...checkpoint.head.state,
      player: { ...checkpoint.head.state.player,
        coins: checkpoint.head.state.player.coins + 60 } } })).toBeNull()
    expect(forged({ ...checkpoint.head, ironHall: { ...checkpoint.head.ironHall,
      playerHealth: 1 } })).toBeNull()
    expect(forged({ ...checkpoint.head, ironHallReward: {
      ...checkpoint.head.ironHallReward, questClaimed: true,
      vestOwned: true, vestEquipped: true, vestDurability: 12 } })).toBeNull()
    expect(forged({ ...checkpoint.head, ironHallReward: {
      ...checkpoint.head.ironHallReward, vestDurability: 3 } })).toBeNull()
    expect(decodePublicV42Root({ ...checkpoint, head: {
      ...checkpoint.head, witness: { kind: claim.kind, coins: 600 } } }))
      .toBeNull()
    expect(decodePublicV42Root({ ...base, lineage: {
      ...base.lineage, rulesProfile: 'forged' } })).toBeNull()
    expect(decodePublicV42Root({ ...base, head: {
      ...base.head, ironHallReward: { ...base.head.ironHallReward,
        crestOutcome: 'unrolled' } } })).toBeNull()
  }, 20000)

  it('rejects stale CAS and reloads a claim without repeating rewards', async () => {
    const factory = new IDBFactory(), source = createAtomicV41Store(factory)
    const target = createAtomicV42Store(factory), old = defeatedV41()
    await putRaw(factory, PUBLIC_V41_DATABASE_NAME, old)
    const start = await startPublicV42(locks as never, target, source,
      old.head.saveRevision)
    if (!start.ok) throw new Error(start.reason)
    const lineage = start.value.lineage
    const left = await target.readChecked(), right = await target.readChecked()
    if (left.status !== 'valid' || right.status !== 'valid') throw new Error('Missing V42 root')
    const advanced = next42(left.root, { kind: 'checkpoint' })
    expect(await target.commit(left.proof, advanced)).toBe('committed')
    expect(await target.commit(right.proof, advanced)).toBe('revision-changed')
    expect(await commitPublicV42(locks as never, target, 0, lineage, claim))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await resumePublicV42(locks as never, target, 1, lineage))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 1 } } })
    const approached = await commitPublicV42(locks as never, target, 1,
      lineage, moving(12, -0.16))
    expect(approached).toMatchObject({ ok: true,
      value: { head: { saveRevision: 2 } } })
    const claimed = await commitPublicV42(locks as never, target, 2, lineage, claim)
    expect(claimed).toMatchObject({ ok: true, value: { head: {
      saveRevision: 3, ironHallReward: { questClaimed: true,
        vestOwned: true, vestDurability: 12 } } } })
    if (!approached.ok || !claimed.ok) throw new Error('Claim was not saved')
    expect(claimed.value.head.state.player.coins - approached.value.head.state.player.coins)
      .toBe(60)
    expect(claimed.value.head.state.player.xp - approached.value.head.state.player.xp)
      .toBe(70)
    expect(claimed.value.head.ironHall.combatXp - approached.value.head.ironHall.combatXp)
      .toBe(70)
    expect(await createAtomicV42Store(factory).readChecked())
      .toMatchObject({ status: 'valid', root: { head: claimed.ok ? claimed.value.head : null } })
    expect(await commitPublicV42(locks as never, target, 3, lineage, claim))
      .toEqual({ ok: false, reason: 'already_claimed' })
    expect(advanced.head.ironHallReward).toEqual(left.root.head.ironHallReward)
    expect(advanced.head.riverBridgeIds).toContain(bridge.id)
    expect(advanced.head.southbankReached).toBe(true)
    const current = await target.readChecked()
    if (current.status !== 'valid') throw new Error('Claim reload blocked')
    const checkpoint = next42(current.root, { kind: 'checkpoint' })
    expect(decodePublicV42Root({ ...checkpoint, head: { ...checkpoint.head,
      ironHallReward: { ...checkpoint.head.ironHallReward,
        questClaimed: false, vestOwned: false, vestEquipped: false,
        vestDurability: 0 } } })).toBeNull()
    expect(await source.readChecked()).toMatchObject({ status: 'valid', root: old })
  }, 20000)
})
