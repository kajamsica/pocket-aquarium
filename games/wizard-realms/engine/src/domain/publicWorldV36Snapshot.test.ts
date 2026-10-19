import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV36Store } from './atomicV36Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { samePublicV14Value } from './publicWorldV14Validation'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import { createPublicV26Root } from './publicWorldV26Snapshot'
import { createPublicV27Root } from './publicWorldV27Snapshot'
import { createPublicV28Root } from './publicWorldV28Snapshot'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { emptyPublicV29MiningTools } from './publicWorldV29MiningTools'
import { createPublicV29Root } from './publicWorldV29Snapshot'
import { createPublicV30Root } from './publicWorldV30Snapshot'
import { createPublicV31Root } from './publicWorldV31Snapshot'
import { createPublicV32Root } from './publicWorldV32Snapshot'
import { createPublicV33Root } from './publicWorldV33Snapshot'
import { createPublicV34Root } from './publicWorldV34Snapshot'
import { PUBLIC_V34_SCHEMA } from './publicWorldV34Snapshot'
import type { PublicV34Head } from './publicWorldV34Snapshot'
import { createPublicV35Root } from './publicWorldV35Snapshot'
import type { PublicV36MarkerProgress } from './publicWorldV36MarkerAction'
import { PUBLIC_V36_DATABASE_NAME, createFreshPublicV36Root, createPublicV36Root,
  decodePublicV36CheckedSuccessor, decodePublicV36Root,
  replayPublicV36Witness } from './publicWorldV36Snapshot'

function source() {
  const { head } = createPublicV23Root('wizard-realms')
  const old: PublicV34Head = { schemaVersion: PUBLIC_V34_SCHEMA, saveRevision: 0,
    witness: null, state: head.state, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks, terrain: emptyPublicV26TerrainLedger(),
    nextHomeAtMs: 0, riverBridgeIds: [], miningTools: emptyPublicV29MiningTools(),
    claimedBridgeheadId: null, raisedSoilCells: [] }
  return createPublicV35Root(old)
}

function readyMarker(): PublicV36MarkerProgress {
  const seed = 'wizard-realms', bridgeId = 'works6:river-bridge:-14'
  const { head } = createPublicV23Root(seed)
  const anchors = mireglassAnchors(seed), bridge = resolvePublicV28RiverBridge(seed, bridgeId)
  const salvager = anchors.salvager.tile.center
  const floor = resolvePublicV23Surface(head.state, salvager, [])?.floorY
  if (!bridge || floor === undefined) throw new Error('Missing canonical marker sites')
  return { state: { ...head.state, movementOwner: 'streamed',
    mireglass: { ...head.state.mireglass, fringeMarkerStudied: true,
      cacheRevealed: true, cacheExcavated: true },
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(head.state.discoveryMask), ...bridge.footprintTileIds,
      anchors.sealCache.tile.id, anchors.fringeMarker.tile.id,
      anchors.salvager.tile.id])].sort()),
    player: { ...head.state.player, position: { ...salvager, y: floor },
      xp: 250, level: 3, skillXp: { ...head.state.player.skillXp,
        construction: 140, excavation: 70, spellcraft: 10, wayfinding: 10 },
      learnedSpellIds: ['wayfinder_glow'] } },
  greenwayWorks: { ...head.greenwayWorks,
    builtBridgeIds: ['works4:bridge:greenway-creek:0'],
    builtLadderIds: ['works4:ladder:greenway-north-cliff:11'] },
  regionalWorks: head.regionalWorks, terrain: emptyPublicV26TerrainLedger(),
  nextHomeAtMs: 0, riverBridgeIds: [bridgeId],
  miningTools: emptyPublicV29MiningTools(),
  claimedBridgeheadId: 'works4:bridge:greenway-creek:0', raisedSoilCells: [],
  ledgerSurveyBridgeId: bridgeId, ledgerClaimReward: 'coins',
  markerClaimReward: null }
}

describe('V36 checked marker persistence', () => {
  it('pins the fixed-seed fresh fixture to the pure constructor chain', () => {
    const pair = ({ head, lineage }: { head: unknown; lineage: unknown }) => ({ head, lineage })
    const v23 = createPublicV23Root('wizard-realms')
    const v24 = createPublicV24Root(pair(v23))
    const v25 = createPublicV25Root(pair(v24))
    const v26 = createPublicV26Root(pair(v25))
    const v27 = createPublicV27Root(pair(v26))
    const v28 = createPublicV28Root(pair(v27))
    const v29 = createPublicV29Root(pair(v28))
    const v30 = createPublicV30Root(pair(v29))
    const v31 = createPublicV31Root(v30)
    const v32 = createPublicV32Root(v31)
    const v33 = createPublicV33Root(v32)
    const v34 = createPublicV34Root(v33.head)
    const v35 = createPublicV35Root(v34.head)
    const genesis = createPublicV36Root(v35).lineage.genesis
    expect(samePublicV14Value(genesis,
      createFreshPublicV36Root('wizard-realms').lineage.genesis)).toBe(true)
  }, 30_000)

  it('creates a canonical fresh V36 world with exact independent lineage', () => {
    const fresh = createFreshPublicV36Root('wizard-realms')
    expect(() => createFreshPublicV36Root('other-seed')).toThrow('Invalid fresh seed')
    const starter = createPublicV23Root('wizard-realms')
    expect(fresh.lineage).toMatchObject({ origin: 'fresh', sourceRevision: null,
      rulesProfile: 'old-marker/v1', seed: 'wizard-realms' })
    expect(fresh.head).toMatchObject({ saveRevision: 0, witness: null,
      ledgerSurveyBridgeId: null, ledgerClaimReward: null, markerClaimReward: null,
      state: { player: { xp: starter.head.state.player.xp,
        coins: starter.head.state.player.coins } } })
    expect(fresh.head.state.player).toEqual(starter.head.state.player)
    expect(samePublicV14Value(decodePublicV36Root(fresh), fresh)).toBe(true)
    expect(decodePublicV36Root({ ...fresh, lineage: { ...fresh.lineage,
      origin: 'v35-migration', sourceRevision: null } })).toBeNull()
    expect(decodePublicV36Root({ ...fresh, lineage: { ...fresh.lineage,
      origin: 'fresh', sourceRevision: 0 } })).toBeNull()
    expect(decodePublicV36Root({ ...fresh, lineage: { ...fresh.lineage,
      seed: 'other-seed' } })).toBeNull()
    const alteredMask = structuredClone(fresh)
    alteredMask.lineage.genesis.state.discoveryMask[0] ^= 1
    expect(decodePublicV36Root(alteredMask)).toBeNull()
    expect(decodePublicV36Root({ ...fresh, lineage: { ...fresh.lineage,
      genesis: { ...fresh.lineage.genesis, state: { ...fresh.lineage.genesis.state,
        player: { ...fresh.lineage.genesis.state.player,
          coins: fresh.lineage.genesis.state.player.coins + 1 } } } } })).toBeNull()
    const checkpoint = { kind: 'checkpoint' as const }
    const replayed = replayPublicV36Witness(fresh.head, checkpoint)
    if (!replayed) throw new Error('Fresh inherited checkpoint did not replay')
    const next = { lineage: fresh.lineage, previous: fresh.head,
      head: { ...fresh.head, ...replayed, saveRevision: 1, witness: checkpoint } }
    expect(decodePublicV36CheckedSuccessor(fresh, next)).toEqual(next)
  }, 30_000)

  it('checks a fresh root after reload without rebuilding the constructor chain', async () => {
    const root = createFreshPublicV36Root('wizard-realms')
    vi.resetModules()
    const reloaded = await import('./publicWorldV36Snapshot')
    expect(samePublicV14Value(reloaded.decodePublicV36Root(root), root)).toBe(true)
  }, 30_000)

  it('copies only a checked V35 root into independent exact V36 genesis', () => {
    const old = source(), original = structuredClone(old)
    const fresh = createPublicV36Root(old)
    expect(PUBLIC_V36_DATABASE_NAME).not.toBe('wizard-realms:world:v35')
    expect(fresh.head).toMatchObject({ schemaVersion: 'wizard-world/v36',
      saveRevision: 0, markerClaimReward: null, ledgerClaimReward: null })
    expect(decodePublicV36Root(fresh)).toEqual(fresh)
    expect(old).toEqual(original)
    expect(() => createPublicV36Root({ ...old, head: { ...old.head,
      ledgerClaimReward: 'coins' } })).toThrow('Invalid checked V35')
    expect(decodePublicV36Root({ ...fresh, extra: 1 })).toBeNull()
    expect(decodePublicV36Root({ ...fresh, head: { ...fresh.head,
      markerClaimReward: 'coins' } })).toBeNull()
  })

  it('replays inherited action and rejects forged reward, witness, or prior', () => {
    const root = createPublicV36Root(source())
    const witness = { kind: 'checkpoint' as const }
    const replayed = replayPublicV36Witness(root.head, witness)
    if (!replayed) throw new Error('Inherited action did not replay')
    const next = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...replayed, witness, saveRevision: 1 } }
    expect(decodePublicV36CheckedSuccessor(root, next)).toEqual(next)
    expect(decodePublicV36Root(next)).toEqual(next)
    expect(decodePublicV36CheckedSuccessor(root, { ...next,
      head: { ...next.head, markerClaimReward: 'coins' } })).toBeNull()
    expect(decodePublicV36CheckedSuccessor(root, { ...next,
      previous: { ...root.head, saveRevision: 1 } })).toBeNull()
    expect(decodePublicV36Root({ ...next, head: { ...next.head,
      witness: { kind: 'marker-claim/v1', reward: 'coins' } } })).toBeNull()
  })

  it('uses a distinct one-use CAS proof and refuses corrupt stored roots', async () => {
    const factory = new IDBFactory(), store = createAtomicV36Store(factory)
    const first = await store.readChecked()
    if (first.status !== 'missing') throw new Error('Expected missing V36 root')
    const root = createPublicV36Root(source())
    expect(await store.commit(first.proof, root)).toBe('committed')
    expect(await store.commit(first.proof, root)).toBe('invalid')
    const left = await store.readChecked(), right = await store.readChecked()
    if (left.status !== 'valid' || right.status !== 'valid') throw new Error('Missing V36 root')
    const witness = { kind: 'checkpoint' as const }
    const progress = replayPublicV36Witness(left.root.head, witness)
    if (!progress) throw new Error('Inherited action did not replay')
    const next = { lineage: left.root.lineage, previous: left.root.head,
      head: { ...left.root.head, ...progress, saveRevision: 1, witness } }
    expect(await store.commit(left.proof, next)).toBe('committed')
    expect(await store.commit(right.proof, next)).toBe('revision-changed')
    expect(await createAtomicV36Store(factory).readChecked()).toMatchObject({
      status: 'valid', root: { head: { saveRevision: 1 } } })
    const bad = await store.readChecked()
    if (bad.status !== 'valid') throw new Error('Missing V36 root')
    expect(await store.commit(bad.proof, { ...bad.root,
      head: { ...bad.root.head, markerClaimReward: 'coins' } })).toBe('invalid')
    expect(await store.readChecked()).toMatchObject({ status: 'valid',
      root: { head: { markerClaimReward: null } } })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(PUBLIC_V36_DATABASE_NAME, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('records', 'readwrite')
      tx.objectStore('records').put({ forged: true }, 'root')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    database.close()
    expect(await store.readChecked()).toEqual({ status: 'blocked',
      reason: 'invalid-v36-root' })
  })

  it('replays the claim once and preserves its payout through inherited movement', () => {
    const progress = readyMarker()
    const { markerClaimReward: _marker, ...genesis } = progress
    const lineage = { origin: 'v35-migration' as const,
      rulesProfile: 'old-marker/v1' as const, seed: progress.state.seed,
      sourceRevision: 9, genesis }
    const root = { lineage, previous: null, head: { ...progress,
      schemaVersion: 'wizard-world/v36' as const, saveRevision: 0,
      witness: null } }
    expect(decodePublicV36Root(root)).toEqual(root)
    const witness = { kind: 'marker-claim/v1' as const }
    const claimed = replayPublicV36Witness(root.head, witness)
    if (!claimed) throw new Error('Marker claim did not replay')
    const next = { lineage, previous: root.head,
      head: { ...root.head, ...claimed, saveRevision: 1, witness } }
    expect(next.head.markerClaimReward).toBe('fen_waders')
    expect(decodePublicV36CheckedSuccessor(root, next)).toEqual(next)
    expect(decodePublicV36Root(next)).toEqual(next)
    expect(replayPublicV36Witness(next.head, witness)).toBeNull()
    const moved = replayPublicV36Witness(next.head, { kind: 'checkpoint' })
    if (!moved) throw new Error('Inherited checkpoint did not replay after claim')
    expect(moved.markerClaimReward).toBe('fen_waders')
    expect(decodePublicV36Root({ lineage, previous: next.head,
      head: { ...next.head, ...moved, saveRevision: 2,
        witness: { kind: 'checkpoint' } } })).not.toBeNull()
  })
})
