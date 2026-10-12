import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { createPublicV26Root } from './domain/publicWorldV26Snapshot'
import { createPublicV27Root } from './domain/publicWorldV27Snapshot'
import { resolvePublicV28RiverBridge } from './domain/publicWorldV28RiverBridgeSites'
import { createPublicV28Root } from './domain/publicWorldV28Snapshot'
import { createPublicV29Root } from './domain/publicWorldV29Snapshot'
import { confirmPublicV30BridgeheadClaim,
  previewPublicV30BridgeheadClaim } from './domain/publicWorldV30BridgeheadAction'
import type { PublicV30Progress } from './domain/publicWorldV30Migration'
import { localPublicV30BridgeheadPost, projectPublicV30WorldView } from './PublicV30WorldView'
import type { WizardViewProjection } from './view/contracts'

const seed = 'wizard-realms'
const bridgeIds = ['works3:bridge:1', 'works4:bridge:greenway-creek:0',
  'works6:river-bridge:-14'] as const
type Bridge = NonNullable<ReturnType<typeof resolvePublicV28RiverBridge>>
  | Extract<NonNullable<ReturnType<typeof resolvePublicV17GreenwaySite>>, { kind: 'bridge' }>

let freshProgress: PublicV30Progress | null = null
function fresh(): PublicV30Progress {
  if (freshProgress) return freshProgress
  const v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...progress } = v29.head
  freshProgress = { ...progress, claimedBridgeheadId: null }
  return freshProgress
}

function atFarExit(id: string): { progress: PublicV30Progress; site: Bridge } {
  const initial = fresh()
  const greenway = resolvePublicV17GreenwaySite(seed, id)
  const site = greenway?.kind === 'bridge' ? greenway
    : resolvePublicV28RiverBridge(seed, id)
  if (!site) throw new Error(`Missing canonical bridge ${id}`)
  const old = site.obstacle === 'greenway_creek'
  const greenwayWorks = old ? { ...initial.greenwayWorks, builtBridgeIds: [id] }
    : initial.greenwayWorks
  const floor = old ? publicV17StarterSupportAt({ seed,
    profile: initial.state.generationProfile,
    route: initial.state.greenway.routes[0] ?? null,
    built: false, greenwayWorks }, site.exit)?.floorY
    : resolvePublicV23Surface(initial.state, site.exit, [])?.floorY
  if (floor === undefined) throw new Error(`Missing dry far exit ${id}`)
  return { site, progress: { ...initial, greenwayWorks,
    riverBridgeIds: old ? [] : [id],
    state: { ...initial.state, movementOwner: old ? 'greenway' : 'streamed',
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(initial.state.discoveryMask), ...site.footprintTileIds])].sort()),
      player: { ...initial.state.player, xp: initial.state.player.xp + 80,
        skillXp: { ...initial.state.player.skillXp, construction: 80 },
        position: { ...site.exit, y: floor } } } } }
}

function carrier(progress: PublicV30Progress, site: Bridge): WizardViewProjection {
  const gx = Math.ceil(site.exit.x / 4 - 0.5), gz = Math.ceil(site.exit.z / 4 - 0.5)
  const tileId = `tile-${gx + 3}-${gz + 3}`
  const cell = { id: tileId, position: [gx * 4, site.exit.y, gz * 4],
    size: [4, 4], height: 0.7, climate: 'meadow' }
  return { seed, player: { position: [progress.state.player.position.x,
    progress.state.player.position.y, progress.state.player.position.z] },
    savedTerrainWorks: { builtSites: [{ id: site.id, kind: 'bridge',
      obstacle: 'fen_channel', from: site.from, to: site.to, approach: site.approach,
      exit: site.exit, supportPath: site.supportPath,
      footprintTileIds: site.footprintTileIds, widthMeters: site.widthMeters,
      logCost: 8, rewardClass: 'construction' }], dugTileIds: [], preview: null },
    visualWorld: { terrain: [cell], discoveredTileIds: [tileId] },
    map: { tiles: [{ id: tileId, discovered: true }] },
  } as unknown as WizardViewProjection
}

describe('V30 River Works bridgehead view', () => {
  it.each(bridgeIds)('shows a local discovered saved %s far-exit post from checked preview', (id) => {
    const { progress, site } = atFarExit(id)
    const base = carrier(progress, site)
    const shown = projectPublicV30WorldView(progress, base)
    expect(shown.v30Bridgehead).toMatchObject({ bridgeId: id, claimed: false,
      claimReady: true, reward: 'basic-pick' })
    expect(shown.v30Bridgehead?.tileId).toBe(base.visualWorld?.terrain[0]?.id)
    expect(Math.abs(shown.v30Bridgehead!.position[0] - site.exit.x)).toBeLessThan(2)
    expect(Math.abs(shown.v30Bridgehead!.position[0]
      - base.visualWorld!.terrain[0]!.position[0])).toBeLessThan(2)
    expect(shown.v30Bridgehead?.position[2]).toBe(site.exit.z)
    expect(shown.map.tiles).toEqual([expect.objectContaining({ hasBridgeheadPost: true })])
  })

  it('keeps the post informational after claim and Ready only when the checked preview permits', () => {
    const { progress, site } = atFarExit(bridgeIds[1])
    const base = carrier(progress, site)
    const claimed = confirmPublicV30BridgeheadClaim(progress, site.id).progress
    if (!claimed) throw new Error('Expected checked bridgehead claim')
    expect(localPublicV30BridgeheadPost(claimed, carrier(claimed, site)))
      .toMatchObject({ claimed: true, claimReady: false, reward: null })
    const nearFloor = publicV17StarterSupportAt({ seed,
      profile: progress.state.generationProfile,
      route: progress.state.greenway.routes[0] ?? null,
      built: false, greenwayWorks: progress.greenwayWorks }, site.from)?.floorY
    if (nearFloor === undefined) throw new Error('Missing dry near bank')
    const tooFar = { ...progress, state: { ...progress.state,
      player: { ...progress.state.player,
        position: { ...site.from, y: nearFloor } } } }
    expect(previewPublicV30BridgeheadClaim(tooFar, site.id).rejection).toBe('too_far')
    expect(localPublicV30BridgeheadPost(tooFar, carrier(tooFar, site)))
      .toMatchObject({ claimed: false, claimReady: false, reward: null })
    expect(base.v30Bridgehead).toBeUndefined()
  })

  it('retains the post without running the full preview when far, claimed, or in the wrong owner', () => {
    const { progress, site } = atFarExit(bridgeIds[1])
    const tracked = (candidate: PublicV30Progress) => {
      let previewReads = 0
      const observed = { ...candidate }
      Object.defineProperty(observed, 'miningTools', { get: () => {
        previewReads += 1
        return candidate.miningTools
      } })
      return { observed, reads: () => previewReads }
    }
    const far = tracked({ ...progress, state: { ...progress.state,
      player: { ...progress.state.player, position: { ...site.exit, x: site.exit.x + 4 } } } })
    expect(localPublicV30BridgeheadPost(far.observed, carrier(far.observed, site)))
      .toMatchObject({ bridgeId: site.id, claimReady: false, reward: null })
    expect(far.reads()).toBe(0)
    const wrongOwner = tracked({ ...progress, state: { ...progress.state, movementOwner: 'streamed' } })
    expect(localPublicV30BridgeheadPost(wrongOwner.observed, carrier(wrongOwner.observed, site)))
      .toMatchObject({ bridgeId: site.id, claimReady: false, reward: null })
    expect(wrongOwner.reads()).toBe(0)
    const claimed = tracked({ ...progress, claimedBridgeheadId: site.id })
    expect(localPublicV30BridgeheadPost(claimed.observed, carrier(claimed.observed, site)))
      .toMatchObject({ bridgeId: site.id, claimed: true, claimReady: false, reward: null })
    expect(claimed.reads()).toBe(0)
    const near = tracked(progress)
    expect(localPublicV30BridgeheadPost(near.observed, carrier(near.observed, site)))
      .toMatchObject({ bridgeId: site.id, claimReady: true, reward: 'basic-pick' })
    expect(near.reads()).toBeGreaterThan(0)
  })

  it('leaves V29 presentation unchanged without a locally streamed, discovered saved exit', () => {
    const { progress, site } = atFarExit(bridgeIds[2])
    const base = carrier(progress, site)
    const exitTile = base.visualWorld!.terrain[0]!
    const cases = [
      { ...base, savedTerrainWorks: { ...base.savedTerrainWorks!, builtSites: [] } },
      { ...base, visualWorld: { ...base.visualWorld!, terrain: [] } },
      { ...base, visualWorld: { ...base.visualWorld!, discoveredTileIds: [] } },
      { ...base, map: { ...base.map, tiles: [{ ...base.map.tiles[0]!, discovered: false }] } },
      { ...base, visualWorld: { ...base.visualWorld!, terrain: [{ ...exitTile,
        position: [exitTile.position[0] + 4, exitTile.position[1], exitTile.position[2]] as const }] } },
    ]
    for (const hiddenOrRemote of cases) {
      expect(localPublicV30BridgeheadPost(progress, hiddenOrRemote)).toBeNull()
      expect(projectPublicV30WorldView(progress, hiddenOrRemote)).toBe(hiddenOrRemote)
      expect(hiddenOrRemote.v30Bridgehead).toBeUndefined()
    }
    const unbuilt = { ...progress, riverBridgeIds: [] }
    expect(localPublicV30BridgeheadPost(unbuilt, base)).toBeNull()
  })
})
