/** V39 save integrity across checked V38 copy, replay, and the Ringkeeper round trip. */
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV38Store } from './atomicV38Database'
import { createAtomicV39Store } from './atomicV39Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { highlandQuarryRing } from './highlandQuarryRingContent'
import { samePublicV14Value } from './publicWorldV14Validation'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { commitPublicV39, inspectPublicV39, resumePublicV39,
  startFreshPublicV39, startPublicV39 } from './publicWorldV39Flow'
import { createFreshPublicV38Root, decodePublicV38Root, replayPublicV38Witness,
  PUBLIC_V38_DATABASE_NAME, PUBLIC_V38_SCHEMA } from './publicWorldV38Snapshot'
import type { PublicV38Head, PublicV38Root } from './publicWorldV38Snapshot'
import { createFreshPublicV39Root, createPublicV39Root,
  decodePublicV39CheckedSuccessor, decodePublicV39Root, replayPublicV39Witness,
  PUBLIC_V39_DATABASE_NAME, PUBLIC_V39_SCHEMA } from './publicWorldV39Snapshot'
import type { PublicV39Head, PublicV39Root, PublicV39Witness } from './publicWorldV39Snapshot'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const discover = { kind: 'ringkeeper-discover/v1' as const }
const link = { kind: 'ringkeeper-link/v1' as const }
const outbound = { kind: 'ringkeeper-travel/v1' as const,
  direction: 'greenway-to-highland' as const }
const homebound = { kind: 'ringkeeper-travel/v1' as const,
  direction: 'highland-to-greenway' as const }
const claim = { kind: 'ringkeeper-claim/v1' as const }
const idle = { kind: 'frame-batch/v1' as const,
  frames: [{ intents: [], walkRequested: true }] }
const locks = { request: vi.fn(async (_name: string, _options: unknown,
  body: () => Promise<unknown>) => body()) }

/** A checked V38 source at the Greenway ring, with both route tiles already revealed. */
function v38AtGreenway(): PublicV38Root {
  const { head } = createFreshPublicV38Root(seed)
  const ring = head.state.greenway.fairyRings.find(({ id }) => id === 'ring-greenway')
  if (!ring) throw new Error('Missing Greenway ring')
  const tile = worldTileAtGrid(seed,
    Math.ceil(ring.position.x / WORLD_CELL_METERS - 0.5),
    Math.ceil(ring.position.z / WORLD_CELL_METERS - 0.5))
  const floor = publicV17StarterSupportAt({ seed,
    profile: head.state.generationProfile,
    route: head.state.greenway.routes.find(({ id }) => id === 'greenway_ladder') ?? null,
    built: head.state.greenway.builtRouteIds.includes('greenway_ladder'),
    greenwayWorks: head.greenwayWorks }, ring.position)
  if (!floor) throw new Error('Missing Greenway support')
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...base } = head
  const progress = { ...base, state: { ...base.state,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(base.state.discoveryMask), tile.id,
      highlandQuarryRing(seed).tile.id])].sort()),
    player: { ...base.state.player,
      discoveredRingIds: [...new Set([...base.state.player.discoveredRingIds,
        'ring-greenway'])].sort(),
      position: { ...ring.position, y: floor.floorY } } } }
  const source: PublicV38Root = { lineage: { origin: 'v37-migration',
    rulesProfile: 'highland-signal/v1', seed, sourceRevision: 7, genesis: progress },
  previous: null, head: { ...progress, schemaVersion: PUBLIC_V38_SCHEMA,
    saveRevision: 0, witness: null } }
  if (!decodePublicV38Root(source)) throw new Error('Invalid checked V38 fixture')
  return source
}

/** The three-slot format retains only the final edge of a previously walked return. */
function returnedRoot(): PublicV39Root {
  const base = createPublicV39Root(v38AtGreenway())
  const previous: PublicV39Head = { ...base.head, quarryRingDiscovered: true,
    saveRevision: 2, witness: idle }
  const progress = replayPublicV39Witness(previous, idle)
  if (!progress) throw new Error('Invalid inherited V38 frame fixture')
  const root: PublicV39Root = { lineage: base.lineage, previous,
    head: { ...progress, schemaVersion: PUBLIC_V39_SCHEMA,
      saveRevision: 3, witness: idle } }
  if (!decodePublicV39Root(root)) throw new Error('Invalid pruned V39 fixture')
  return root
}

function successor(root: PublicV39Root, witness: PublicV39Witness): PublicV39Root {
  const progress = replayPublicV39Witness(root.head, witness)
  if (!progress) throw new Error(`Rejected ${witness.kind}`)
  return { lineage: root.lineage, previous: root.head,
    head: { ...progress, schemaVersion: PUBLIC_V39_SCHEMA,
      saveRevision: root.head.saveRevision + 1, witness } }
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

describe('V39 checked migration and Ringkeeper save replay', () => {
  it('pins fresh genesis and copies a checked V38 head without modifying its source', () => {
    const fresh = createFreshPublicV39Root(seed), source = v38AtGreenway()
    const original = structuredClone(source), copied = createPublicV39Root(source)
    expect(PUBLIC_V39_DATABASE_NAME).not.toBe(PUBLIC_V38_DATABASE_NAME)
    expect(fresh).toMatchObject({ lineage: { origin: 'fresh', sourceRevision: null,
      rulesProfile: 'ringkeeper-trail/v1' }, head: { schemaVersion: PUBLIC_V39_SCHEMA,
        quarryRingDiscovered: false, ringLinkEstablished: false,
        ringOutboundCompleted: false, ringReturnCompleted: false,
        ringkeeperClaimed: false } })
    expect(decodePublicV39Root(fresh)).toEqual(fresh)
    expect(copied.lineage).toMatchObject({ origin: 'v38-migration', sourceRevision: 0,
      rulesProfile: 'ringkeeper-trail/v1' })
    expect(copied.head.state).toEqual(source.head.state)
    expect(decodePublicV39Root(copied)).toEqual(copied)
    expect(source).toEqual(original)
    copied.head.state.discoveryMask[0] ^= 1
    expect(source).toEqual(original)
    expect(() => createFreshPublicV39Root('other-seed')).toThrow('Invalid fresh seed')
    expect(() => createPublicV39Root({ ...source, head: { ...source.head,
      saveRevision: 1 } })).toThrow('Invalid checked V38 source root')
  })

  it('preserves prior V38 Signal flags when copying a checked pruned source', () => {
    const base = v38AtGreenway()
    const previous: PublicV38Head = { ...base.head, signalVantageInspected: true,
      signalClaimed: true, saveRevision: 2, witness: idle }
    const progress = replayPublicV38Witness(previous, idle)
    if (!progress) throw new Error('Invalid V38 inherited frame')
    const source: PublicV38Root = { lineage: base.lineage, previous,
      head: { ...progress, schemaVersion: PUBLIC_V38_SCHEMA,
        saveRevision: 3, witness: idle } }
    expect(decodePublicV38Root(source)).toEqual(source)
    const copy = createPublicV39Root(source)
    expect(copy.lineage.sourceRevision).toBe(3)
    expect(copy.head).toMatchObject({ signalVantageInspected: true,
      signalClaimed: true, quarryRingDiscovered: false,
      ringLinkEstablished: false, ringkeeperClaimed: false })
    expect(decodePublicV39Root(copy)).toEqual(copy)
  })

  it('starts independently fresh only when V39 is missing, leaving V38 absent', async () => {
    const factory = new IDBFactory(), source = createAtomicV38Store(factory)
    const target = createAtomicV39Store(factory)
    expect(await startFreshPublicV39(locks as never, target, seed))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 0 },
        lineage: { origin: 'fresh', sourceRevision: null } } })
    expect(await target.readChecked()).toMatchObject({ status: 'valid' })
    expect(await source.readChecked()).toMatchObject({ status: 'missing' })
    expect(await startFreshPublicV39(locks as never, target, seed))
      .toEqual({ ok: false, reason: 'target-conflict' })
  })

  it('refuses malformed flag chains, forged successors, and rollback of the prior edge', () => {
    const fresh = createFreshPublicV39Root(seed), returned = returnedRoot()
    expect(decodePublicV39Root({ ...fresh, head: { ...fresh.head,
      ringkeeperClaimed: true } })).toBeNull()
    expect(decodePublicV39Root({ ...fresh, lineage: { ...fresh.lineage,
      sourceRevision: 0 } })).toBeNull()
    expect(decodePublicV39Root({ ...fresh, extra: true })).toBeNull()
    const linked = successor(returned, link)
    expect(decodePublicV39CheckedSuccessor(returned, linked)).toEqual(linked)
    expect(decodePublicV39Root(linked)).toEqual(linked)
    expect(decodePublicV39CheckedSuccessor(returned, { ...linked,
      previous: returned.previous })).toBeNull()
    expect(decodePublicV39CheckedSuccessor(returned, { ...linked,
      head: { ...linked.head, quarryRingDiscovered: false } })).toBeNull()
    expect(decodePublicV39CheckedSuccessor(returned, { ...linked,
      head: { ...linked.head, state: { ...linked.head.state, player: {
        ...linked.head.state.player, coins: linked.head.state.player.coins + 25 } } } }))
      .toBeNull()
    expect(replayPublicV39Witness(returned.head, { ...link, reward: 25 })).toBeNull()
  })

  it('keeps V38 read-only, refuses malformed V39 targets and stale source or CAS', async () => {
    const factory = new IDBFactory(), source = createAtomicV38Store(factory)
    const target = createAtomicV39Store(factory), original = v38AtGreenway()
    await putRaw(factory, PUBLIC_V38_DATABASE_NAME, original)
    expect(await inspectPublicV39(locks as never, target)).toEqual({ ok: true,
      value: { status: 'migration-available' } })
    expect(await startPublicV39(locks as never, target, source, 1))
      .toEqual({ ok: false, reason: 'source-revision-changed' })
    expect(await startPublicV39(locks as never, target, source, -1))
      .toEqual({ ok: false, reason: 'invalid-source-revision' })
    const started = await startPublicV39(locks as never, target, source, 0)
    if (!started.ok) throw new Error(started.reason)
    expect(await source.readChecked()).toMatchObject({ status: 'valid', root: original })
    expect(await startPublicV39(locks as never, target, source, 0))
      .toEqual({ ok: false, reason: 'target-conflict' })
    const other = createAtomicV39Store(factory), left = await target.readChecked()
    const right = await other.readChecked()
    if (left.status !== 'valid' || right.status !== 'valid') throw new Error('Missing V39 root')
    const next = successor(left.root, idle)
    expect(await target.commit(left.proof, next)).toBe('committed')
    expect(await other.commit(right.proof, next)).toBe('revision-changed')
    expect(await target.commit(left.proof, next)).toBe('invalid')
    expect(await commitPublicV39(locks as never, target, 0, started.value.lineage, idle))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await commitPublicV39(locks as never, target, 1,
      { ...started.value.lineage, sourceRevision: 5 }, idle))
      .toEqual({ ok: false, reason: 'lineage-changed' })
    expect(await resumePublicV39(locks as never, target, 0, started.value.lineage))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await resumePublicV39(locks as never, target, 1,
      { ...started.value.lineage, sourceRevision: 5 }))
      .toEqual({ ok: false, reason: 'lineage-changed' })
    await putRaw(factory, PUBLIC_V39_DATABASE_NAME, { invalid: true })
    expect(await target.readChecked()).toEqual({ status: 'blocked',
      reason: 'invalid-v39-root' })
    expect(await startFreshPublicV39(locks as never, target, seed))
      .toEqual({ ok: false, reason: 'invalid-v39-root' })
    expect(await startPublicV39(locks as never, target, source, 0))
      .toEqual({ ok: false, reason: 'invalid-v39-root' })
    expect(await source.readChecked()).toMatchObject({ status: 'valid', root: original })
  })

  it('replays inherited V38 frames after link and claim while preserving all five flags', async () => {
    const factory = new IDBFactory(), store = createAtomicV39Store(factory)
    const returned = returnedRoot()
    await putRaw(factory, PUBLIC_V39_DATABASE_NAME, returned)
    let revision = returned.head.saveRevision
    const commit = async (witness: PublicV39Witness) => {
      const result = await commitPublicV39(locks as never, store, revision,
        returned.lineage, witness)
      if (!result.ok) throw new Error(`${witness.kind}: ${result.reason}`)
      revision = result.value.head.saveRevision
      return result.value.head
    }
    const linked = await commit(link)
    const afterLink = await commit(idle)
    const { schemaVersion: _schemaA, saveRevision: _revisionA,
      witness: _witnessA, ...afterLinkProgress } = afterLink
    expect(afterLinkProgress).toEqual(replayPublicV39Witness(linked, idle))
    expect(afterLink.ringLinkEstablished).toBe(true)
    expect(afterLink.quarryRingDiscovered).toBe(true)
    expect(afterLink.ringOutboundCompleted).toBe(false)
    expect(afterLink.state.tick).toBeGreaterThanOrEqual(linked.state.tick)
    const out = await commit(outbound)
    expect(out.state.movementOwner).toBe('streamed')
    expect(out.ringOutboundCompleted).toBe(true)
    expect(out.state.player.discoveredRingIds).not.toContain('ring-highland-quarry')
    const back = await commit(homebound)
    expect(back.state.movementOwner).toBe('greenway')
    expect(back.ringReturnCompleted).toBe(true)
    const startingCoins = back.state.player.coins
    const startingXp = back.state.player.xp
    const startingWayfinding = back.state.player.skillXp.wayfinding
    const startingSpellcraft = back.state.player.skillXp.spellcraft
    const paid = await commit(claim)
    expect(paid.ringkeeperClaimed).toBe(true)
    expect(paid.state.player.coins).toBe(startingCoins + 25)
    expect(paid.state.player.xp).toBe(startingXp + 35)
    expect(paid.state.player.skillXp.wayfinding).toBe(startingWayfinding + 30)
    expect(paid.state.player.skillXp.spellcraft).toBe(startingSpellcraft + 20)
    expect(await commitPublicV39(locks as never, store, revision,
      returned.lineage, claim)).toEqual({ ok: false, reason: 'already_claimed' })
    const afterClaim = await commit(idle)
    const { schemaVersion: _schemaB, saveRevision: _revisionB,
      witness: _witnessB, ...afterClaimProgress } = afterClaim
    expect(afterClaimProgress).toEqual(replayPublicV39Witness(paid, idle))
    expect(afterClaim).toMatchObject({ quarryRingDiscovered: true,
      ringLinkEstablished: true, ringOutboundCompleted: true,
      ringReturnCompleted: true, ringkeeperClaimed: true })
    expect(afterClaim.state.player.coins).toBe(paid.state.player.coins)
    const reloaded = await createAtomicV39Store(factory).readChecked()
    expect(reloaded).toMatchObject({ status: 'valid', root: { head: {
      saveRevision: revision, ringkeeperClaimed: true } } })
    if (reloaded.status !== 'valid') throw new Error('Invalid V39 reload')
    expect(samePublicV14Value(reloaded.root.head, afterClaim)).toBe(true)
    expect(await resumePublicV39(locks as never, store, revision, returned.lineage))
      .toMatchObject({ ok: true, value: { head: { saveRevision: revision } } })
  })
})
