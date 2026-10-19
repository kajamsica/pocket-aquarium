import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV35Store } from './atomicV35Database'
import { createAtomicV36Store } from './atomicV36Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { emptyPublicV29MiningTools } from './publicWorldV29MiningTools'
import { PUBLIC_V34_SCHEMA } from './publicWorldV34Snapshot'
import type { PublicV34Head } from './publicWorldV34Snapshot'
import { PUBLIC_V35_DATABASE_NAME, createPublicV35Root,
  decodePublicV35Root, replayPublicV35Witness } from './publicWorldV35Snapshot'
import { commitPublicV36, inspectPublicV36, requestPublicV36ReturnHome,
  resumePublicV36, startFreshPublicV36, startPublicV36 } from './publicWorldV36Flow'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'

function fixture() {
  const { head } = createPublicV23Root('wizard-realms')
  const sourceHead: PublicV34Head = { schemaVersion: PUBLIC_V34_SCHEMA,
    saveRevision: 0, witness: null, state: head.state,
    greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
    terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0,
    riverBridgeIds: [], miningTools: emptyPublicV29MiningTools(),
    claimedBridgeheadId: null, raisedSoilCells: [] }
  const sourceRoot = createPublicV35Root(sourceHead), original = structuredClone(sourceRoot)
  const source = { readChecked: vi.fn(async () => ({ status: 'valid', root: sourceRoot })) }
  const factory = new IDBFactory(), store = createAtomicV36Store(factory)
  const locks = { request: vi.fn(async (_name: string, _options: unknown,
    body: () => Promise<unknown>) => body()) }
  return { sourceRoot, original, source, factory, store, locks }
}

describe('V36 locked copy and checked flow', () => {
  it('starts fresh under lock without reading or writing V35, then refuses overwrite', async () => {
    const f = fixture()
    const started = await startFreshPublicV36(f.locks as never, f.store, 'wizard-realms')
    if (!started.ok) throw new Error(started.reason)
    expect(started.value.lineage).toMatchObject({ origin: 'fresh', sourceRevision: null })
    expect(started.value.head).toMatchObject({ saveRevision: 0,
      ledgerClaimReward: null, markerClaimReward: null })
    expect(f.source.readChecked).not.toHaveBeenCalled()
    expect(await createAtomicV35Store(f.factory).readChecked()).toMatchObject({ status: 'missing' })
    expect(await startFreshPublicV36(f.locks as never, f.store, 'wizard-realms'))
      .toEqual({ ok: false, reason: 'target-conflict' })
    expect(await createAtomicV36Store(f.factory).readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0 }, lineage: { origin: 'fresh' } } })
    const next = await commitPublicV36(f.locks as never, f.store, 0,
      started.value.lineage, { kind: 'checkpoint' })
    expect(next).toMatchObject({ ok: true, value: { head: { saveRevision: 1 } } })
    expect(await resumePublicV36(f.locks as never, createAtomicV36Store(f.factory), 1,
      started.value.lineage)).toMatchObject({ ok: true, value: {
        lineage: { origin: 'fresh' }, head: { saveRevision: 1 } } })
    expect(f.sourceRoot).toEqual(f.original)
    expect(f.locks.request).toHaveBeenCalledWith(PUBLIC_V7_LOCK_NAME,
      { mode: 'exclusive' }, expect.any(Function))
  }, 30_000)

  it('does not replace a blocked target or create on an unavailable lock', async () => {
    const f = fixture()
    const blocked = { readChecked: vi.fn(async () => ({ status: 'blocked',
      reason: 'invalid-v36-root' })), commit: vi.fn() }
    expect(await startFreshPublicV36(f.locks as never,
      blocked as never, 'wizard-realms')).toEqual({ ok: false,
        reason: 'invalid-v36-root' })
    expect(blocked.commit).not.toHaveBeenCalled()
    expect(await startFreshPublicV36(undefined, f.store, 'wizard-realms'))
      .toEqual({ ok: false, reason: 'lock-unavailable' })
    expect(f.source.readChecked).not.toHaveBeenCalled()
  })

  it('copies a whole V35 root once, preserves the source and replays inherited actions', async () => {
    const f = fixture()
    expect(await inspectPublicV36(f.locks as never, f.store)).toEqual({ ok: true,
      value: { status: 'migration-available' } })
    const started = await startPublicV36(f.locks as never, f.store, f.source as never, 0)
    if (!started.ok) throw new Error(started.reason)
    expect(f.sourceRoot).toEqual(f.original)
    expect(f.source.readChecked).toHaveBeenCalledOnce()
    expect(started.value.lineage.sourceRevision).toBe(f.sourceRoot.head.saveRevision)
    expect(await startPublicV36(f.locks as never, f.store, f.source as never, 0))
      .toEqual({ ok: false, reason: 'target-conflict' })
    expect(await resumePublicV36(f.locks as never, f.store, 0, started.value.lineage))
      .toMatchObject({ ok: true, value: { head: { saveRevision: 0 } } })
    const next = await commitPublicV36(f.locks as never, f.store, 0,
      started.value.lineage, { kind: 'checkpoint' })
    expect(next).toMatchObject({ ok: true, value: { head: { saveRevision: 1 } } })
    expect(await createAtomicV36Store(f.factory).readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1, witness: { kind: 'checkpoint' } } } })
    expect(await commitPublicV36(f.locks as never, f.store, 0,
      started.value.lineage, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await resumePublicV36(f.locks as never, f.store, 1,
      { ...started.value.lineage, seed: 'forged' })).toEqual({ ok: false,
      reason: 'lineage-changed' })
    expect(f.locks.request).toHaveBeenCalledWith(PUBLIC_V7_LOCK_NAME,
      { mode: 'exclusive' }, expect.any(Function))
    expect(f.sourceRoot).toEqual(f.original)
  })

  it('requires the selected checked V35 revision inside the copy lock', async () => {
    const f = fixture()
    expect(await startPublicV36(f.locks as never, f.store, f.source as never, -1))
      .toEqual({ ok: false, reason: 'invalid-source-revision' })
    expect(await startPublicV36(f.locks as never, f.store, f.source as never, 1))
      .toEqual({ ok: false, reason: 'source-revision-changed' })
    expect(await f.store.readChecked()).toMatchObject({ status: 'missing' })
    expect(f.sourceRoot).toEqual(f.original)
    expect(f.locks.request).toHaveBeenCalledWith(PUBLIC_V7_LOCK_NAME,
      { mode: 'exclusive' }, expect.any(Function))
  })

  it('refuses absent or malformed sources and never writes the V35 source', async () => {
    const f = fixture()
    f.source.readChecked.mockResolvedValueOnce({ status: 'missing' } as never)
    expect(await startPublicV36(f.locks as never, f.store, f.source as never, 0))
      .toEqual({ ok: false, reason: 'source-missing' })
    f.source.readChecked.mockResolvedValueOnce({ status: 'blocked',
      reason: 'invalid-v35-root' } as never)
    expect(await startPublicV36(f.locks as never, f.store, f.source as never, 0))
      .toEqual({ ok: false, reason: 'invalid-v35-root' })
    f.source.readChecked.mockResolvedValueOnce({ status: 'valid', root: {
      ...f.sourceRoot, head: { ...f.sourceRoot.head, extra: true } } } as never)
    expect(await startPublicV36(f.locks as never, f.store, f.source as never, 0))
      .toEqual({ ok: false, reason: 'invalid-source' })
    expect(await f.store.readChecked()).toMatchObject({ status: 'missing' })
    expect(f.sourceRoot).toEqual(f.original)
    const corruptTarget = { readChecked: vi.fn(async () => ({ status: 'blocked',
      reason: 'invalid-v36-root' })) }
    expect(await inspectPublicV36(f.locks as never, corruptTarget as never))
      .toEqual({ ok: true, value: { status: 'blocked', reason: 'invalid-v36-root' } })
    expect(await startPublicV36(f.locks as never, corruptTarget as never, f.source as never, 0))
      .toEqual({ ok: false, reason: 'invalid-v36-root' })
  })

  it('rejects premature or forged claims, preserving revision and reward', async () => {
    const f = fixture()
    const started = await startPublicV36(f.locks as never, f.store, f.source as never, 0)
    if (!started.ok) throw new Error(started.reason)
    const lineage = started.value.lineage
    expect(await commitPublicV36(f.locks as never, f.store, 0, lineage,
      { kind: 'marker-claim/v1' })).toEqual({ ok: false, reason: 'requires_ledger' })
    expect(await commitPublicV36(f.locks as never, f.store, 0, lineage,
      { kind: 'marker-claim/v1', reward: 'coins' } as never))
      .toEqual({ ok: false, reason: 'invalid-witness' })
    expect(await commitPublicV36(f.locks as never, f.store, 0, lineage,
      { kind: 'ledger-deliver/v1' }))
      .toEqual({ ok: false, reason: 'requires_survey' })
    expect(await f.store.readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0, markerClaimReward: null } } })
    expect(await requestPublicV36ReturnHome(f.locks as never, f.store, 0, lineage))
      .toEqual({ ok: false, reason: 'frame-rejected' })
    expect(await inspectPublicV36(undefined, f.store))
      .toEqual({ ok: false, reason: 'lock-unavailable' })
  })

  it('claims through the real store from a decoder-checked synthetic V35 near-quest fixture', async () => {
    const f = fixture(), seed = f.sourceRoot.head.state.seed
    const bridgeId = 'works6:river-bridge:-14'
    const bridge = resolvePublicV28RiverBridge(seed, bridgeId)
    const anchors = mireglassAnchors(seed)
    const salvager = anchors.salvager.tile.center
    const floor = resolvePublicV23Surface(f.sourceRoot.head.state, salvager, [])?.floorY
    if (!bridge || floor === undefined) throw new Error('Missing canonical near-quest sites')
    const sourceHead: PublicV34Head = { ...f.sourceRoot.lineage.genesis,
      schemaVersion: PUBLIC_V34_SCHEMA, saveRevision: 7, witness: { kind: 'checkpoint' },
      state: { ...f.sourceRoot.head.state, movementOwner: 'streamed',
        mireglass: { ...f.sourceRoot.head.state.mireglass,
          fringeMarkerStudied: true, cacheRevealed: true, cacheExcavated: true },
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(f.sourceRoot.head.state.discoveryMask),
          ...bridge.footprintTileIds, anchors.fringeMarker.tile.id,
          anchors.sealCache.tile.id, anchors.salvager.tile.id])].sort()),
        player: { ...f.sourceRoot.head.state.player,
          position: { ...salvager, y: floor }, xp: 250, level: 3,
          skillXp: { ...f.sourceRoot.head.state.player.skillXp,
            construction: 140, excavation: 70, spellcraft: 10, wayfinding: 10 },
          learnedSpellIds: ['wayfinder_glow'],
          inventory: [...f.sourceRoot.head.state.player.inventory,
            { itemId: 'leather_boots', quantity: 1 }],
          equipment: { ...f.sourceRoot.head.state.player.equipment,
            feet: 'leather_boots' } } },
      greenwayWorks: { ...f.sourceRoot.head.greenwayWorks,
        builtBridgeIds: ['works4:bridge:greenway-creek:0'],
        builtLadderIds: ['works4:ladder:greenway-north-cliff:11'] },
      riverBridgeIds: [bridgeId],
      claimedBridgeheadId: 'works4:bridge:greenway-creek:0' }
    const genesis = createPublicV35Root(sourceHead)
    const prior = { ...genesis.head, saveRevision: 8,
      witness: { kind: 'ledger-deliver/v1' as const },
      ledgerSurveyBridgeId: bridgeId, ledgerClaimReward: 'coins' as const,
      state: { ...genesis.head.state, eventSequence: genesis.head.state.eventSequence + 2,
        player: { ...genesis.head.state.player, coins: genesis.head.state.player.coins + 85,
          xp: genesis.head.state.player.xp + 60, level: 4,
          skillXp: { ...genesis.head.state.player.skillXp,
            wayfinding: genesis.head.state.player.skillXp.wayfinding + 60 } } } }
    const checkpoint = { kind: 'checkpoint' as const }
    const replayed = replayPublicV35Witness(prior, checkpoint)
    if (!replayed) throw new Error('V35 checkpoint fixture did not replay')
    const sourceRoot = { lineage: genesis.lineage, previous: prior,
      head: { ...prior, ...replayed, saveRevision: 9, witness: checkpoint } }
    expect(decodePublicV35Root(sourceRoot)).toEqual(sourceRoot)
    expect(decodePublicV35Root({ ...sourceRoot, head: { ...sourceRoot.head,
      ledgerClaimReward: null } })).toBeNull()
    const sourceOriginal = structuredClone(sourceRoot)
    const sourceStore = createAtomicV35Store(f.factory)
    expect(await sourceStore.readChecked()).toMatchObject({ status: 'missing' })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = f.factory.open(PUBLIC_V35_DATABASE_NAME, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('records', 'readwrite')
      tx.objectStore('records').put(sourceRoot, 'root')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    database.close()
    expect(await sourceStore.readChecked()).toMatchObject({ status: 'valid', root: sourceRoot })

    const started = await startPublicV36(f.locks as never, f.store, sourceStore, 9)
    if (!started.ok) throw new Error(started.reason)
    const before = started.value.head, lineage = started.value.lineage
    expect(before.markerClaimReward).toBeNull()
    expect(before.state.player.equipment.feet).toBe('leather_boots')
    const claimed = await commitPublicV36(f.locks as never, f.store, 0, lineage,
      { kind: 'marker-claim/v1' })
    if (!claimed.ok) throw new Error(claimed.reason)
    expect(claimed.value.head).toMatchObject({ saveRevision: 1,
      witness: { kind: 'marker-claim/v1' }, markerClaimReward: 'fen_waders' })
    const paid = claimed.value.head.state.player
    expect(paid.coins).toBe(before.state.player.coins + 80)
    expect(paid.xp).toBe(before.state.player.xp + 50)
    expect(claimed.value.head.state.eventSequence).toBe(before.state.eventSequence + 1)
    expect(paid.skillXp.spellcraft).toBe(before.state.player.skillXp.spellcraft + 50)
    expect(paid.inventory).toContainEqual({ itemId: 'mireglass_reach/item/waders', quantity: 1 })
    expect(paid.equipment).toEqual(before.state.player.equipment)
    expect(await createAtomicV36Store(f.factory).readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1, markerClaimReward: 'fen_waders' } } })
    expect(await commitPublicV36(f.locks as never, f.store, 1, lineage,
      { kind: 'marker-claim/v1' })).toEqual({ ok: false, reason: 'already_claimed' })
    expect(await commitPublicV36(f.locks as never, f.store, 0, lineage,
      { kind: 'marker-claim/v1' })).toEqual({ ok: false, reason: 'revision-changed' })
    const continued = await commitPublicV36(f.locks as never, f.store, 1, lineage, checkpoint)
    if (!continued.ok) throw new Error(continued.reason)
    expect(continued.value.head).toMatchObject({ saveRevision: 2,
      witness: checkpoint, markerClaimReward: 'fen_waders' })
    expect(await resumePublicV36(f.locks as never, createAtomicV36Store(f.factory), 2,
      lineage)).toMatchObject({ ok: true, value: { head: { saveRevision: 2,
        markerClaimReward: 'fen_waders', state: { player: { coins: paid.coins,
          xp: paid.xp, equipment: { feet: 'leather_boots' } } } } } })
    expect(await sourceStore.readChecked()).toMatchObject({ status: 'valid', root: sourceOriginal })
    expect(f.locks.request).toHaveBeenCalledWith(PUBLIC_V7_LOCK_NAME,
      { mode: 'exclusive' }, expect.any(Function))
  })
})
