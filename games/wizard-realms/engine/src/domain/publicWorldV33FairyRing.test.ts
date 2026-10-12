import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createPublicV33ControllerRuntime } from '../PublicV33ControllerRuntime'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { MIREGLASS_RING_ID, mireglassFairyRing } from './mireglassContent'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { nearbyWorldTileIds } from './publicWorldDiscovery'
import { createFreshPublicV17Head } from './publicWorldV17Snapshot'
import { decodePublicV17Progress } from './publicWorldV17Validation'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createPublicV24Root, decodePublicV24Root } from './publicWorldV24Snapshot'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import { createPublicV26Root } from './publicWorldV26Snapshot'
import { createPublicV27Root } from './publicWorldV27Snapshot'
import { createPublicV28Root } from './publicWorldV28Snapshot'
import { createPublicV29Root } from './publicWorldV29Snapshot'
import { createPublicV30Root } from './publicWorldV30Snapshot'
import { createPublicV31Root } from './publicWorldV31Snapshot'
import { createPublicV32Root, decodePublicV32Root,
  replayPublicV32Witness } from './publicWorldV32Snapshot'
import type { PublicV32Progress } from './publicWorldV32Migration'
import { confirmPublicV33FairyRingAction, decodePublicV33FairyRingWitness } from './publicWorldV33FairyRing'
import { createPublicV33Root, decodePublicV33CheckedSuccessor,
  decodePublicV33Root, replayPublicV33Witness } from './publicWorldV33Snapshot'
import type { PublicV33Witness } from './publicWorldV33Snapshot'
import type { PublicV33Start } from './publicWorldV33Flow'
import { createAtomicV33Store } from './atomicV33Database'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'
import { projectPublicV33FairyRingView } from '../PublicV33WorldView'
import type { WizardViewProjection } from '../view/contracts'

const seed = 'wizard-realms'
const greenway = { kind: 'fairy-ring-discover/v1' as const, ringId: 'ring-greenway' as const }
const out = { kind: 'fairy-ring-travel/v1' as const, sourceRingId: 'ring-greenway' as const,
  targetRingId: MIREGLASS_RING_ID }
const back = { kind: 'fairy-ring-travel/v1' as const, sourceRingId: MIREGLASS_RING_ID,
  targetRingId: 'ring-greenway' as const }
const owned = ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
  riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells }: PublicV32Progress):
  PublicV32Progress => ({ state, greenwayWorks, regionalWorks, terrain, nextHomeAtMs,
    riverBridgeIds, miningTools, claimedBridgeheadId, raisedSoilCells })

function source() {
  const v17 = createFreshPublicV17Head(seed)
  const ring = v17.head.state.greenway.fairyRings.find(({ id }) => id === greenway.ringId)!
  const tile = worldTileAtGrid(seed, Math.ceil(ring.position.x / WORLD_CELL_METERS - 0.5),
    Math.ceil(ring.position.z / WORLD_CELL_METERS - 0.5))
  const floor = publicV17StarterSupportAt({ seed, profile: v17.head.state.generationProfile,
    route: v17.head.state.greenway.routes.find(({ id }) => id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: v17.head.greenwayWorks }, ring.position)!
  const state = { ...v17.head.state,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(v17.head.state.discoveryMask), tile.id])].sort()),
    player: { ...v17.head.state.player, position: { ...ring.position, y: floor.floorY } } }
  expect(decodePublicV17Progress({ state, greenwayWorks: v17.head.greenwayWorks }, seed))
    .not.toBeNull()
  const v23 = createPublicV23Root(seed, { state, greenwayWorks: v17.head.greenwayWorks,
    saveRevision: 1, lineage: v17.lineage })
  const v24 = createPublicV24Root(v23)
  expect(decodePublicV24Root(v24)).not.toBeNull()
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
  const v31 = createPublicV31Root(v30)
  return { v32: createPublicV32Root(v31), ring, tile }
}

function atMireglass(progress: PublicV32Progress): PublicV32Progress {
  const target = mireglassFairyRing(seed).tile
  const floor = resolvePublicV23Surface(progress.state, target.center,
    progress.regionalWorks.builtLadderIds)!
  return { ...progress, state: { ...progress.state, movementOwner: 'streamed',
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(progress.state.discoveryMask), target.id])].sort()),
    player: { ...progress.state.player, position: { ...target.center, y: floor.floorY },
      discoveredRingIds: [...progress.state.player.discoveredRingIds, MIREGLASS_RING_ID] } } }
}

describe('V33 checked fairy-ring lineage and action', () => {
  it('saves a frame batch through V33 and rejects a forged asynchronous reply', async () => {
    const root = createPublicV33Root(source().v32)
    let current: PublicV33Start = { head: root.head, lineage: root.lineage }
    const write = vi.fn(async (revision: number, lineage: PublicV33Start['lineage'],
      witness: PublicV33Witness) => {
      const next = replayPublicV33Witness(owned(current.head), witness)
      if (!next) return { ok: false as const, reason: 'frame-rejected' }
      current = { lineage, head: { ...current.head, ...next,
        saveRevision: revision + 1, witness } }
      return { ok: true as const, value: structuredClone(current) }
    })
    const runtime = createPublicV33ControllerRuntime(current, write)
    for (let index = 0; index < 12; index++)
      expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.001, pitchDelta: 0 }], false)
        .rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0]).toHaveLength(3)
    expect(write.mock.calls[0][2]).toMatchObject({ kind: 'frame-batch/v1',
      frames: expect.arrayContaining([expect.objectContaining({ walkRequested: false })]) })
    expect(runtime.committed()).toEqual(current)
    expect(runtime.preview().state.player.discoveredRingIds)
      .toEqual(root.head.state.player.discoveredRingIds)
    expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    expect(await runtime.save()).toEqual({ status: 'deferred-airborne' })
    expect(write).toHaveBeenCalledOnce()
    for (let index = 0; index < 40 && runtime.preview().state.player.verticalVelocity !== 0;
      index++) expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(runtime.preview().state.player.verticalVelocity).toBe(0)
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(write).toHaveBeenCalledTimes(2)
    expect(runtime.committed()).toEqual(current)

    const forged = createPublicV33ControllerRuntime(current, async (revision, lineage, witness) => {
      const next = replayPublicV33Witness(owned(current.head), witness)!
      return { ok: true as const, value: { lineage, head: { ...current.head, ...next,
        state: { ...next.state, player: { ...next.state.player,
          coins: next.state.player.coins + 20 } },
        saveRevision: revision + 1, witness } } }
    })
    expect(forged.advanceFrame([{ type: 'look', yawDelta: 0.001, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await forged.save()).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(forged.committed()).toEqual(current)
  }, 120_000)
  it('pins the exact V32 source and rejects extra, altered, or forged roots', () => {
    const { v32 } = source(), root = createPublicV33Root(v32)
    expect(decodePublicV32Root(v32)).toEqual(v32)
    expect(root.lineage.sourceReceipt).toEqual(v32)
    expect(decodePublicV33Root(root)).toEqual(root)
    expect(decodePublicV33Root({ ...root, extra: true })).toBeNull()
    expect(decodePublicV33Root({ ...root, lineage: { ...root.lineage,
      sourceReceipt: { ...v32, previous: { forged: true } } } })).toBeNull()
    expect(decodePublicV33Root({ ...root, head: { ...root.head,
      state: { ...root.head.state, player: { ...root.head.state.player,
        coins: root.head.state.player.coins + 1 } } } })).toBeNull()
  }, 120_000)

  it('rejects malformed and denied actions without changing input', () => {
    const { v32, ring, tile } = source(), start = owned(v32.head)
    const frozen = structuredClone(start)
    for (const witness of [{ ...greenway, x: 1 }, { ...out, targetRingId: out.sourceRingId },
      { ...out, destination: { x: 0 } }, { kind: 'fairy-ring-travel/v1',
        sourceRingId: 'unknown', targetRingId: MIREGLASS_RING_ID }])
      expect(decodePublicV33FairyRingWitness(witness)).toBeNull()
    expect(confirmPublicV33FairyRingAction(start, out).rejection).toBe('undiscovered')
    expect(confirmPublicV33FairyRingAction(atMireglass(start), greenway).rejection)
      .toBe('wrong_region')
    expect(confirmPublicV33FairyRingAction({ ...start, state: { ...start.state,
      player: { ...start.state.player, verticalVelocity: 1 } } }, greenway).rejection)
      .toBe('invalid_progress')
    expect(confirmPublicV33FairyRingAction({ ...start, state: { ...start.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(start.state.discoveryMask)
        .filter((id) => id !== tile.id)) } }, greenway).rejection).toBe('invalid_progress')
    const farther = { ...ring.position, x: ring.position.x + 10 }
    const support = publicV17StarterSupportAt({ seed, profile: start.state.generationProfile,
      route: start.state.greenway.routes.find(({ id }) => id === 'greenway_ladder') ?? null,
      built: false, greenwayWorks: start.greenwayWorks }, farther)!
    const remote = { ...start, state: { ...start.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(start.state.discoveryMask),
        ...nearbyWorldTileIds(farther, 8)])].sort()),
      player: { ...start.state.player,
        position: { ...farther, y: support.floorY } } } }
    expect(confirmPublicV33FairyRingAction(remote, greenway).rejection).toBe('too_far')
    expect(confirmPublicV33FairyRingAction(start, greenway).progress).toBeDefined()
    expect(start).toEqual(frozen)
  }, 120_000)

  it('replays discovery and both travel directions, then accepts a future frame', () => {
    const { v32 } = source()
    const root = createPublicV33Root(v32)
    const discovered = replayPublicV33Witness(owned(root.head), greenway)!
    const first = decodePublicV33CheckedSuccessor(root, { lineage: root.lineage,
      previous: root.head, head: { ...root.head, ...discovered,
        saveRevision: 1, witness: greenway } })!
    expect(first.head.state.player.discoveredRingIds).toContain(greenway.ringId)
    expect(decodePublicV33Root(first)).toEqual(first)
    expect(decodePublicV33CheckedSuccessor(root, { lineage: root.lineage,
      previous: root.head, head: { ...first.head, state: { ...first.head.state,
        player: { ...first.head.state.player,
          coins: first.head.state.player.coins + 1 } } } })).toBeNull()
    expect(replayPublicV32Witness(owned(v32.head), { kind: 'checkpoint' }))
      .toEqual(owned(v32.head))
    expect(replayPublicV32Witness(owned(v32.head), greenway)).toBeNull()
    expect(replayPublicV33Witness(owned(first.head), out)).toBeNull()
    const ready = atMireglass(owned(first.head))
    expect(confirmPublicV33FairyRingAction(ready, back).progress).toBeDefined()
    const atGreenway = confirmPublicV33FairyRingAction(ready, back).progress!
    expect(atGreenway.state.movementOwner).toBe('greenway')
    expect(atGreenway.state.tick).toBe(ready.state.tick + 1)
    expect(atGreenway.state.eventSequence).toBe(ready.state.eventSequence + 1)
    expect(atGreenway.state.player.verticalVelocity).toBe(0)
    const hiddenTarget = { ...atGreenway, state: { ...atGreenway.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(
        atGreenway.state.discoveryMask).filter((id) => id !== mireglassFairyRing(seed).tile.id)) } }
    expect(confirmPublicV33FairyRingAction(hiddenTarget, out).rejection).toBe('unrevealed')
    const outbound = confirmPublicV33FairyRingAction(atGreenway, out).progress!
    expect(outbound.state.movementOwner).toBe('streamed')
    expect(outbound.state.player.position.x).toBe(mireglassFairyRing(seed).tile.center.x)
    expect(confirmPublicV33FairyRingAction(outbound, back).progress).toBeDefined()
    const frame = replayPublicV33Witness(outbound, { kind: 'frame-batch/v1',
      frames: [{ intents: [{ type: 'move', delta: { x: 0.1, z: 0 } }],
        walkRequested: false }] })
    expect(frame?.state.tick).toBe(outbound.state.tick + 1)
    expect(frame?.state.player.position.x).not.toBe(outbound.state.player.position.x)
  }, 120_000)

  it('consumes proofs once and rejects a stale competing CAS write', async () => {
    const { v32 } = source(), factory = new IDBFactory()
    const store = createAtomicV33Store(factory, 'v33-test-cas')
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected empty V33 store')
    const root = createPublicV33Root(v32)
    expect(await store.commit(missing.proof, root)).toBe('committed')
    expect(await store.commit(missing.proof, root)).toBe('invalid')
    const stale = await store.readChecked(), fresh = await store.readChecked()
    if (stale.status !== 'valid' || fresh.status !== 'valid') throw new Error('Missing saved root')
    const progress = replayPublicV33Witness(owned(root.head), greenway)!
    const next = { lineage: root.lineage, previous: root.head, head: { ...root.head,
      ...progress, saveRevision: 1, witness: greenway } }
    expect(decodePublicV33CheckedSuccessor(root, next)).toEqual(decodePublicV33Root(next))
    const forged = { ...next, lineage: { ...next.lineage,
      sourceReceipt: { ...next.lineage.sourceReceipt,
        head: { ...next.lineage.sourceReceipt.head,
          state: { ...next.lineage.sourceReceipt.head.state,
            player: { ...next.lineage.sourceReceipt.head.state.player,
              coins: next.lineage.sourceReceipt.head.state.player.coins + 1 } } } } } }
    const forgedRead = await store.readChecked()
    if (forgedRead.status !== 'valid') throw new Error('Missing root before forged source')
    expect(await store.commit(forgedRead.proof, forged)).toBe('invalid')
    expect(next.lineage.sourceReceipt.head.state).toEqual(next.previous.state)
    const aliased = { ...next, lineage: { ...next.lineage,
      sourceReceipt: { ...next.lineage.sourceReceipt,
        head: { ...next.lineage.sourceReceipt.head, state: next.previous.state } } } }
    const aliasRead = await store.readChecked()
    if (aliasRead.status !== 'valid') throw new Error('Missing root before cross-slot alias')
    expect(await store.commit(aliasRead.proof, aliased)).toBe('invalid')
    Object.preventExtensions(aliased)
    const nonExtensibleRead = await store.readChecked()
    if (nonExtensibleRead.status !== 'valid') throw new Error('Missing root before sealed alias')
    expect(await store.commit(nonExtensibleRead.proof, aliased)).toBe('invalid')
    expect(await store.commit(fresh.proof, next)).toBe('committed')
    expect(await store.commit(stale.proof, next)).toBe('revision-changed')
    const saved = await store.readChecked()
    expect(saved.status === 'valid' && saved.root.head.saveRevision).toBe(1)
    if (saved.status !== 'valid') throw new Error('Missing saved successor')
    const second = { lineage: saved.root.lineage, previous: saved.root.head,
      head: { ...saved.root.head, saveRevision: 2,
        witness: { kind: 'checkpoint' as const } } }
    expect(decodePublicV33CheckedSuccessor(saved.root, second)).toEqual(decodePublicV33Root(second))
    expect(await store.commit(saved.proof, second)).toBe('committed')
    expect(await store.readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 2 } } })
    expect(await store.commit({}, next)).toBe('invalid')
  }, 120_000)

  it('projects only active revealed rings and does not enable V32 travel', () => {
    const { v32, tile } = source(), progress = owned(v32.head)
    const position = progress.state.player.position
    const mapTile = { id: tile.id, gridX: tile.gridX, gridZ: tile.gridZ,
      terrain: tile.terrain, biome: tile.biome, discovered: true, hasResource: false,
      hasStore: false, hasRing: false, hasRouteSite: false, hasBuiltRoute: false }
    const carrier = { seed, player: { position: [position.x, position.y, position.z],
      yaw: 0, pitch: 0 }, starterCliff: {}, fairyRings: [], terrain: [{ id: tile.id }],
      visualWorld: { terrain: [{ id: tile.id }], discoveredTileIds: [tile.id], fairyRings: [] },
      map: { tiles: [mapTile] }, nearbyInteraction: null } as unknown as WizardViewProjection
    const projected = projectPublicV33FairyRingView(progress, carrier)
    expect(projected.v33FairyTravel).toBe(true)
    expect(projected.fairyRings).toMatchObject([{ id: greenway.ringId,
      discovered: false, destinations: [{ ringId: MIREGLASS_RING_ID, discovered: false }] }])
    expect(projected.nearbyInteraction).toMatchObject({ targetId: greenway.ringId,
      action: 'Discover Greenway Ring', actionable: true })
    expect(projected.map.tiles[0].hasRing).toBe(true)
    expect(carrier.v33FairyTravel).toBeUndefined()
    expect(carrier.fairyRings).toEqual([])
    expect(projectPublicV33FairyRingView(progress, { ...carrier,
      visualWorld: { ...carrier.visualWorld!, discoveredTileIds: [] } }).fairyRings).toEqual([])
    expect(projectPublicV33FairyRingView(progress, { ...carrier,
      map: { ...carrier.map, tiles: [{ ...mapTile, discovered: false }] } }).fairyRings).toEqual([])
    expect(decodePublicV32Root(v32)).toEqual(v32)
    expect(replayPublicV33Witness(progress, out)).toBeNull()
  }, 120_000)
})

async function putV33Raw(factory: IDBFactory, name: string, key: string, value: unknown) {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('records', 'readwrite')
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onabort = () => { db.close(); reject(tx.error) }
      tx.objectStore('records').put(value, key)
    }
  })
}

describe('V33 raw source envelope', () => {
  it('returns one native record without a proof and blocks extra keys', async () => {
    const factory = new IDBFactory(), name = 'v33-raw-envelope'
    const store = createAtomicV33Store(factory, name)
    expect(await store.readRawSourceEnvelope()).toEqual({ status: 'missing' })
    await putV33Raw(factory, name, 'root', { synthetic: true })
    expect(await store.readRawSourceEnvelope()).toEqual({ status: 'valid',
      raw: { synthetic: true } })
    await putV33Raw(factory, name, 'extra', 1)
    expect(await store.readRawSourceEnvelope()).toEqual({ status: 'blocked',
      reason: 'invalid-v33-root' })
  })

  it('maps a failed IndexedDB open to a storage block', async () => {
    const store = createAtomicV33Store({ open: () => { throw new Error('failed') } } as never)
    expect(await store.readRawSourceEnvelope()).toEqual({ status: 'blocked',
      reason: 'storage-error' })
  })
})
