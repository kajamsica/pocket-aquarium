import { describe, expect, it } from 'vitest'
import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { createPublicV23StreamTerrain, resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { publicWorldV16TileAtGrid } from './domain/publicWorldV16GreenwaySites'
import { createPublicV23Root, decodePublicV23Progress } from './domain/publicWorldV23Snapshot'
import { emptyPublicV26TerrainLedger } from './domain/publicWorldV26TerrainLedger'
import { confirmPublicV28RiverBridge } from './domain/publicWorldV28RiverBridgeAction'
import { resolvePublicV28RiverBridge } from './domain/publicWorldV28RiverBridgeSites'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import type { PublicV28Progress } from './domain/publicWorldV28Migration'
import { replayPublicV28FramesWithEvents } from './domain/publicWorldV28Replay'
import { projectPublicV28Pose } from './domain/publicWorldV28RiverSupport'
import { publicWorldV23ViewProjection } from './PublicV23WorldView'
import { publicWorldV26ViewProjection } from './PublicV26WorldView'
import { displayPublicV28RiverBridge, publicWorldV28ViewProjection } from './PublicV28WorldView'
import { savedTerrainWorkVisuals, terrainWorkStructureGeometry } from './view/WizardScene'

const seed = 'greenway-alpha'
const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-14')!
const work = { kind: 'bridge' as const, modeActive: true, actionsEnabled: true,
  bodyYaw: Math.PI, aimX: site.from.x }

function ready(): PublicV28Progress {
  const { head } = createPublicV23Root(seed)
  const floor = resolvePublicV23Surface(head.state, site.from, [])
  if (!floor) throw new Error('Missing canonical source bank')
  const state = { ...head.state, movementOwner: 'streamed' as const,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(head.state.discoveryMask), ...site.footprintTileIds])].sort()),
    player: { ...head.state.player, position: { ...site.from, y: floor.floorY },
      inventory: [...head.state.player.inventory, { itemId: 'logs' as const, quantity: 12 }] } }
  const old = decodePublicV23Progress({ state, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks }, seed)
  if (!old) throw new Error('Invalid source-bank fixture')
  return { ...old, terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0,
    riverBridgeIds: [] }
}

function carrierFor(progress: PublicV28Progress) {
  const { state } = progress
  const active = { movementOwner: state.movementOwner, tick: state.tick,
    player: structuredClone(state.player), pendingBoundary: false,
    activeKnownTileIds: discoveredTileIdsInActiveWindow(state.discoveryMask,
      state.player.position),
    activeTiles: state.movementOwner === 'greenway' ? state.greenway.tiles.map((tile) =>
      publicWorldV16TileAtGrid(seed, tile.center.x / 4, tile.center.z / 4))
      : createPublicV23StreamTerrain(state,
        progress.regionalWorks.builtLadderIds).activeTiles() }
  const base = publicWorldV23ViewProjection(progress, active, [], null, null, false,
    { kind: 'bridge', bodyYaw: Math.PI, aimX: site.from.x, aimZ: null,
      modeActive: true, actionsEnabled: true })
  return publicWorldV26ViewProjection(progress, base)
}

describe('V28 connected-river Works view overlay', () => {
  it('projects a checked Ready choice and renders the exact canonical deck path', () => {
    const progress = ready(), carrier = carrierFor(progress)
    const view = publicWorldV28ViewProjection(progress, carrier, work)
    const selected = view.savedTerrainWorks?.preview?.selected
    expect(selected).toMatchObject({ site: { id: site.id }, rejection: null })
    expect(view.savedTerrainWorks?.context).toBe('v28-river')
    expect(view.savedTerrainWorks?.suggestedSites?.some((candidate) => candidate.id === site.id))
      .toBe(true)
    expect(selected?.site.kind).toBe('bridge')
    if (selected?.site.kind !== 'bridge') throw new Error('Missing bridge choice')
    expect(selected.site.supportPath).toEqual(site.supportPath)
    expect(displayPublicV28RiverBridge(site).supportPath).toBe(site.supportPath)
    const segments = terrainWorkStructureGeometry(selected.site)
    expect(segments).toHaveLength(site.supportPath.length - 1)
    expect(segments.every((segment) => segment.deckLift === 0.035)).toBe(true)
    expect(savedTerrainWorkVisuals(view.savedTerrainWorks, view.terrain))
      .toEqual([expect.objectContaining({ site: selected.site, built: false })])
    expect(view.map.tiles.find((tile) => tile.id === site.footprintTileIds[1])?.hasRouteSite)
      .toBe(true)
  })

  it('never shows a hidden or unsupported footprint as a choice, ghost, or map marker', () => {
    const progress = ready()
    const hidden = { ...progress, state: { ...progress.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(
        progress.state.discoveryMask).filter((id) => id !== site.footprintTileIds[2])) } }
    const view = publicWorldV28ViewProjection(hidden, carrierFor(hidden), work)
    expect(view.savedTerrainWorks?.preview?.selected).toBeNull()
    expect(view.savedTerrainWorks?.preview?.guidance).toMatch(/Reveal the full dry approach/)
    expect(view.savedTerrainWorks?.suggestedSites?.some((candidate) => candidate.id === site.id))
      .toBe(false)
    expect(savedTerrainWorkVisuals(view.savedTerrainWorks, view.terrain)
      .some((entry) => entry.site.id === site.id)).toBe(false)
    expect(view.map.tiles.find((tile) => tile.id === site.footprintTileIds[1])?.hasRouteSite)
      .toBe(false)
    const unsupportedGX = [-20, -19, -18, -17, -16, -15, -13, -12, -11, -10, -9, -8]
      .find((gx) => !resolvePublicV28RiverBridge(seed, `works6:river-bridge:${gx}`))
    if (unsupportedGX === undefined) throw new Error('Expected an unsupported neighboring bank')
    const unsupported = publicWorldV28ViewProjection(progress, carrierFor(progress),
      { ...work, aimX: unsupportedGX * 4 })
    expect(unsupported.savedTerrainWorks?.preview?.selected).toBeNull()
    expect(unsupported.savedTerrainWorks?.preview?.guidance)
      .toMatch(/No supported crossing at this river column/)
  })

  it('uses the checked rejection and saved ledger, then lifts the visible avatar on the deck', () => {
    const progress = ready()
    const empty = { ...progress, state: { ...progress.state,
      player: { ...progress.state.player, inventory: [] } } }
    expect(publicWorldV28ViewProjection(empty, carrierFor(empty), work)
      .savedTerrainWorks?.preview?.selected?.reason).toBe('Gather 8 logs before confirming this crossing.')
    const blocked = publicWorldV28ViewProjection(empty, carrierFor(empty), work)
    expect(savedTerrainWorkVisuals(blocked.savedTerrainWorks, blocked.terrain)
      .find((entry) => entry.site.id === site.id)).toMatchObject({ built: false, blocked: true })
    const confirmed = confirmPublicV28RiverBridge(progress, site.id)
    if ('rejection' in confirmed) throw new Error(`Bridge rejected: ${confirmed.rejection}`)
    const built = publicWorldV28ViewProjection(confirmed.progress,
      carrierFor(confirmed.progress), work)
    expect(built.savedTerrainWorks?.builtSites.find((entry) => entry.id === site.id)
      ?.supportPath).toEqual(site.supportPath)
    expect(built.savedTerrainWorks?.preview?.selected).toBeNull()
    expect(built.map.tiles.find((tile) => tile.id === site.footprintTileIds[2])?.hasBuiltRoute)
      .toBe(true)
    const moved = replayPublicV28FramesWithEvents(confirmed.progress,
      Array.from({ length: 25 }, () => ({ intents: [{ type: 'move' as const,
        delta: { x: 0, z: 0.16 } }], walkRequested: false })))?.progress
    if (!moved) throw new Error('Saved bridge crossing failed')
    const pose = projectPublicV28Pose(moved, moved.terrain, moved.riverBridgeIds)
    expect(pose?.bridgeId).toBe(site.id)
    expect(publicWorldV28ViewProjection(moved, carrierFor(moved), work).player.position[1])
      .toBeCloseTo(pose!.effective.position.y)
  })

  it('leaves the inherited Greenway view unchanged when there is no new bridge', () => {
    const { head } = createPublicV23Root(seed)
    const progress: PublicV28Progress = { state: head.state,
      greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
      terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0, riverBridgeIds: [] }
    const carrier = carrierFor(progress)
    const shown = publicWorldV28ViewProjection(progress, carrier, work)
    expect(shown.savedTerrainWorks).toEqual(carrier.savedTerrainWorks)
    expect(shown.map).toEqual(carrier.map)
    expect(shown.player).toEqual(carrier.player)
    expect(shown.v28TravelContinuity).toBeUndefined()
  })

  it('retains canonical saved Greenway ladder feet as map memory after streamed handoff', () => {
    const ladderId = 'works4:ladder:greenway-north-cliff:11'
    const ladder = resolvePublicV17GreenwaySite(seed, ladderId)
    if (ladder?.kind !== 'ladder') throw new Error('Missing canonical saved ladder fixture')
    const base = ready()
    const progress = { ...base, greenwayWorks: { ...base.greenwayWorks,
      builtLadderIds: [ladderId] } }
    const shown = publicWorldV28ViewProjection(progress, carrierFor(progress),
      { ...work, modeActive: false })
    expect(shown.v28TravelContinuity).toEqual({ position: shown.player.position,
      greenwayLadders: [{ id: ladderId,
        from: [ladder.from.x, ladder.from.y, ladder.from.z],
        to: [ladder.to.x, ladder.to.y, ladder.to.z] }] })
    expect(shown.savedTerrainWorks?.builtSites).toHaveLength(0)
  })

  it('does not replace an older bridge preview merely because an X reticle is set', () => {
    const progress = ready()
    const far = { x: site.from.x, z: site.from.z - 24 }
    const floor = resolvePublicV23Surface(progress.state, far, [])
    if (!floor) throw new Error('Missing dry far-bank fixture')
    const moved = { ...progress, state: { ...progress.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(progress.state.discoveryMask),
        `tile-${far.x / 4 + 3}-${far.z / 4 + 3}`])].sort()),
      player: { ...progress.state.player,
        position: { ...far, y: floor.floorY } } } }
    const carrier = carrierFor(moved)
    const legacy = { site: displayPublicV28RiverBridge(site), distanceMeters: 1,
      angleRadians: 0, benefit: 'Existing bridge preview', rejection: null,
      reason: 'Existing bridge is ready.' }
    const shown = publicWorldV28ViewProjection(moved, { ...carrier,
      savedTerrainWorks: { builtSites: [], dugTileIds: [],
        preview: { selected: legacy, nearby: [legacy], guidance: null } } },
    { ...work, aimX: far.x })
    expect(shown.savedTerrainWorks?.preview?.selected).toEqual(legacy)
    expect(shown.savedTerrainWorks?.context).not.toBe('v28-river')
  })

  it('keeps an older checked bridge choice even near the V25 river when no V28 site is aimed', () => {
    const progress = ready(), carrier = carrierFor(progress)
    const unsupportedGX = [-20, -19, -18, -17, -16, -15, -13, -12, -11, -10]
      .find((gx) => !resolvePublicV28RiverBridge(seed, `works6:river-bridge:${gx}`))
    if (unsupportedGX === undefined) throw new Error('Expected an unsupported river column')
    const legacy = { site: { ...displayPublicV28RiverBridge(site), id: 'works3:older' },
      distanceMeters: 1, angleRadians: 0, benefit: 'Older checked bridge',
      rejection: null, reason: 'Older work is ready.' }
    const shown = publicWorldV28ViewProjection(progress, { ...carrier,
      savedTerrainWorks: { builtSites: [], dugTileIds: [],
        preview: { selected: legacy, nearby: [legacy], guidance: null } } },
    { ...work, aimX: unsupportedGX * 4 })
    expect(shown.savedTerrainWorks?.preview?.selected).toEqual(legacy)
    expect(shown.savedTerrainWorks?.context).not.toBe('v28-river')
  })
})
