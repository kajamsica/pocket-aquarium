import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createPublicV36ControllerRuntime } from './PublicV36ControllerRuntime'
import { createAtomicV36Store } from './domain/atomicV36Database'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { mireglassAnchors } from './domain/mireglassContent'
import { emptyPublicV26TerrainLedger } from './domain/publicWorldV26TerrainLedger'
import { emptyPublicV29MiningTools } from './domain/publicWorldV29MiningTools'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { resolvePublicV28RiverBridge } from './domain/publicWorldV28RiverBridgeSites'
import { PUBLIC_V34_SCHEMA } from './domain/publicWorldV34Snapshot'
import type { PublicV34Head } from './domain/publicWorldV34Snapshot'
import { createPublicV35Root } from './domain/publicWorldV35Snapshot'
import { commitPublicV36, startPublicV36 } from './domain/publicWorldV36Flow'
import type { PublicV36Start } from './domain/publicWorldV36Flow'
import { createPublicV36Root, replayPublicV36Witness } from './domain/publicWorldV36Snapshot'
import type { PublicV36Witness } from './domain/publicWorldV36Snapshot'

describe('V36 controller adapter', () => {
  it('saves inherited movement only through V36 and keeps a rejected marker claim inert', async () => {
    const { head } = createPublicV23Root('wizard-realms')
    const v34: PublicV34Head = { schemaVersion: PUBLIC_V34_SCHEMA,
      saveRevision: 0, witness: null, state: head.state,
      greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
      terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0,
      riverBridgeIds: [], miningTools: emptyPublicV29MiningTools(),
      claimedBridgeheadId: null, raisedSoilCells: [] }
    const v35 = createPublicV35Root(v34), sourceBefore = structuredClone(v35)
    const source = { readChecked: vi.fn(async () => ({ status: 'valid', root: v35 })) }
    const store = createAtomicV36Store(new IDBFactory())
    const locks = { request: async (_name: string, _options: unknown,
      body: () => Promise<unknown>) => body() }
    const started = await startPublicV36(locks as never, store, source as never,
      v35.head.saveRevision)
    if (!started.ok) throw Error(started.reason)
    const write = vi.fn((revision: number, lineage: typeof started.value.lineage,
      witness: Parameters<typeof commitPublicV36>[4]) =>
      commitPublicV36(locks as never, store, revision, lineage, witness))
    const runtime = createPublicV36ControllerRuntime(started.value, write)
    expect(runtime.preview().markerClaimReward).toBeNull()
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0][0]).toBe(0)
    expect(write.mock.calls[0][1]).toEqual(started.value.lineage)
    expect(runtime.committed().head.saveRevision).toBe(1)
    expect(await runtime.action({ kind: 'marker-claim/v1' }))
      .toMatchObject({ status: 'rejected', reason: 'requires_ledger' })
    expect(write).toHaveBeenCalledOnce()
    expect(await store.readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1, markerClaimReward: null } } })
    expect(v35).toEqual(sourceBefore)
    expect(source.readChecked).toHaveBeenCalledOnce()
  }, 120_000)

  it('claims the marker, rebuilds the inherited shell, then saves another frame', async () => {
    const seed = 'wizard-realms', { head } = createPublicV23Root(seed)
    const bridgeId = 'works6:river-bridge:-14'
    const bridge = resolvePublicV28RiverBridge(seed, bridgeId)!
    const anchors = mireglassAnchors(seed), salvager = anchors.salvager.tile.center
    const floor = resolvePublicV23Surface(head.state, salvager, [])?.floorY
    if (floor === undefined) throw Error('Missing salvage site')
    const v34: PublicV34Head = { schemaVersion: PUBLIC_V34_SCHEMA,
      saveRevision: 0, witness: null, state: head.state,
      greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
      terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0,
      riverBridgeIds: [], miningTools: emptyPublicV29MiningTools(),
      claimedBridgeheadId: null, raisedSoilCells: [] }
    const migrated = createPublicV36Root(createPublicV35Root(v34))
    const start: PublicV36Start = { lineage: migrated.lineage, head: {
      ...migrated.head, saveRevision: 1, witness: { kind: 'return-home/v1', atMs: 0 },
      markerClaimReward: null, ledgerSurveyBridgeId: bridgeId, ledgerClaimReward: 'coins',
      riverBridgeIds: [bridgeId], claimedBridgeheadId: 'works4:bridge:greenway-creek:0',
      greenwayWorks: { ...head.greenwayWorks,
        builtBridgeIds: ['works4:bridge:greenway-creek:0'],
        builtLadderIds: ['works4:ladder:greenway-north-cliff:11'] },
      state: { ...head.state, movementOwner: 'streamed',
        mireglass: { ...head.state.mireglass, fringeMarkerStudied: true,
          cacheRevealed: true, cacheExcavated: true },
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(head.state.discoveryMask), ...bridge.footprintTileIds,
          anchors.sealCache.tile.id, anchors.fringeMarker.tile.id,
          anchors.salvager.tile.id])].sort()),
        player: { ...head.state.player, position: { ...salvager, y: floor },
          xp: 250, level: 3, skillXp: { ...head.state.player.skillXp,
            construction: 140, excavation: 70, spellcraft: 10, wayfinding: 10 },
          learnedSpellIds: ['wayfinder_glow'] } } } }
    let saved = structuredClone(start)
    const write = vi.fn(async (revision: number, lineage: PublicV36Start['lineage'],
      witness: PublicV36Witness) => {
      const next = replayPublicV36Witness(saved.head, witness)
      if (!next || revision !== saved.head.saveRevision) return { ok: false as const,
        reason: 'replay-rejected' }
      saved = { lineage, head: { ...saved.head, ...next, witness,
        saveRevision: revision + 1 } }
      return { ok: true as const, value: structuredClone(saved) }
    })
    const runtime = createPublicV36ControllerRuntime(start, write)
    expect(await runtime.action({ kind: 'marker-claim/v1' }))
      .toMatchObject({ status: 'saved' })
    expect(runtime.preview().markerClaimReward).toBe('fen_waders')
    expect(runtime.committed().head.saveRevision).toBe(2)
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(runtime.committed().head.saveRevision).toBe(3)
    expect(runtime.preview().markerClaimReward).toBe('fen_waders')
    expect(write.mock.calls.map((call) => call[2].kind))
      .toEqual(['marker-claim/v1', 'frame-batch/v1'])
  }, 120_000)
})
