import { describe, expect, it } from 'vitest'
import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { publicWorldV16TileAtGrid } from './domain/publicWorldV16GreenwaySites'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { createPublicV23Root, decodePublicV23Progress } from './domain/publicWorldV23Snapshot'
import type { PublicV24Progress } from './domain/publicWorldV24Snapshot'
import type { PublicV26Progress } from './domain/publicWorldV26Migration'
import { emptyPublicV26TerrainLedger } from './domain/publicWorldV26TerrainLedger'
import { publicWorldV17ViewProjection } from './PublicV17WorldView'
import type { PublicV17ActiveView } from './PublicV17WorldView'
import { publicWorldV26ViewProjection } from './PublicV26WorldView'

const seed = 'wizard-realms'
const ladderId = 'works4:ladder:greenway-north-cliff:-20'

function oldAt(x: number, z: number, builtLadderId?: string): PublicV24Progress {
  const { head } = createPublicV23Root(seed)
  const base = { state: head.state, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks }
  const greenwayWorks = builtLadderId ? { ...base.greenwayWorks,
    builtLadderIds: [builtLadderId] } : base.greenwayWorks
  const route = base.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
  const support = publicV17StarterSupportAt({ seed,
    profile: base.state.generationProfile, route,
    built: base.state.greenway.builtRouteIds.includes('greenway_ladder'), greenwayWorks },
  { x, z })
  if (!support) throw new Error('Missing old support')
  const construction = builtLadderId ? 60 : 0
  const checked = decodePublicV23Progress({ ...base, greenwayWorks,
    state: { ...base.state, player: { ...base.state.player,
      xp: base.state.player.xp + construction,
      skillXp: { ...base.state.player.skillXp,
        construction: base.state.player.skillXp.construction + construction },
      position: { x, y: support.floorY, z } } } }, seed)
  if (!checked) throw new Error('Invalid old fixture')
  return checked
}

function carrierFor(progress: PublicV24Progress) {
  const { state } = progress
  const active: PublicV17ActiveView = {
    movementOwner: state.movementOwner, tick: state.tick,
    player: structuredClone(state.player), pendingBoundary: false,
    activeKnownTileIds: discoveredTileIdsInActiveWindow(state.discoveryMask,
      state.player.position),
    activeTiles: state.greenway.tiles.map((tile) => publicWorldV16TileAtGrid(
      seed, tile.gridX - 3, tile.gridZ - 3)),
  }
  return publicWorldV17ViewProjection({ state, greenwayWorks: progress.greenwayWorks },
    active, [], null)
}

const v26 = (progress: PublicV24Progress, depth = 0): PublicV26Progress => ({
  ...progress, nextHomeAtMs: 0,
  terrain: { ...emptyPublicV26TerrainLedger(), columns: depth
    ? [{ gx: 3, gz: 1, openDepth: depth, rewardDepth: depth, pitLadder: false }] : [] },
})

describe('V26 read-only world view overlay', () => {
  it('shows only saved pit ladders on matching revealed canonical 4 m cells', () => {
    const dug = v26(oldAt(12, 4), 2)
    const column = { ...dug.terrain.columns[0], pitLadder: true }
    const progress = { ...dug, terrain: { ...dug.terrain, columns: [column,
      { gx: 200, gz: 200, openDepth: 2, rewardDepth: 2, pitLadder: true }] } }
    const carrier = carrierFor(progress)
    const original = carrier.visualWorld!.terrain.find((cell) =>
      cell.position[0] === 12 && cell.position[2] === 4)!
    const revealed = { ...carrier, visualWorld: { ...carrier.visualWorld!,
      discoveredTileIds: [original.id] } }
    const view = publicWorldV26ViewProjection(progress, revealed)
    expect(view.v26OpenPitColumns).toEqual([{ gx: 3, gz: 1, openDepth: 2 }])
    expect(view.v26PitLadders).toEqual([{ cellId: original.id, gx: 3, gz: 1,
      floorY: original.position[1] - 0.8, rimY: original.position[1] }])
    expect(view.visualWorld?.terrain.find((cell) => cell.id === original.id)?.position[1])
      .toBeCloseTo(view.v26PitLadders[0].floorY)
    expect(view.v26PitLadderOpportunity).toBeUndefined()
    expect(publicWorldV26ViewProjection(progress, { ...carrier,
      visualWorld: { ...carrier.visualWorld!, discoveredTileIds: [] } }).v26PitLadders)
      .toEqual([])
    expect(publicWorldV26ViewProjection(progress, { ...carrier,
      visualWorld: { ...carrier.visualWorld!, discoveredTileIds: [] } }).v26OpenPitColumns)
      .toEqual([])
    expect(publicWorldV26ViewProjection(progress, { ...revealed,
      visualWorld: { ...revealed.visualWorld!, terrain: revealed.visualWorld!.terrain.map((cell) =>
        cell.id === original.id ? { ...cell, size: [8, 8] as const } : cell) } }).v26PitLadders)
      .toEqual([])
    expect(publicWorldV26ViewProjection(progress, { ...revealed,
      visualWorld: { ...revealed.visualWorld!, terrain: revealed.visualWorld!.terrain.map((cell) =>
        cell.id === original.id ? { ...cell, size: [8, 8] as const } : cell) } }).v26OpenPitColumns)
      .toEqual([])
  })

  it('projects a read-only copy of all checked excavation materials separately from inventory', () => {
    const dug = v26(oldAt(12, 4), 1)
    const bag = { ...dug.terrain.bag, soil: 2, iron_ore: 1 }
    const progress = { ...dug, terrain: { ...dug.terrain, bag } }
    const carrier = carrierFor(progress)
    const view = publicWorldV26ViewProjection(progress, carrier)
    expect(view.v26TerrainBag).toEqual({ soil: 2, stone: 0, iron_ore: 1,
      gold_ore: 0, diamond: 0 })
    expect(view.v26TerrainBag).not.toBe(bag)
    expect(view.backpack).toBe(carrier.backpack)
  })

  it('offers four-log pit ladder help only in the current saved open pit at depth two or deeper', () => {
    const dug = v26(oldAt(12, 4), 2)
    const carrier = carrierFor(dug)
    const pitCell = carrier.visualWorld!.terrain.find((cell) =>
      cell.position[0] === 12 && cell.position[2] === 4)!
    const revealed = { ...carrier, visualWorld: { ...carrier.visualWorld!,
      discoveredTileIds: [pitCell.id] } }
    expect(publicWorldV26ViewProjection(dug, revealed).v26OpenPitColumns)
      .toEqual([{ gx: 3, gz: 1, openDepth: 2 }])
    expect(publicWorldV26ViewProjection(dug, revealed).v26PitLadders).toEqual([])
    expect(publicWorldV26ViewProjection(dug, carrier).v26PitLadderOpportunity)
      .toEqual({ gx: 3, gz: 1, logCost: 4 })
    const shallow = v26(dug, 1)
    expect(publicWorldV26ViewProjection(shallow, carrier).v26PitLadderOpportunity)
      .toBeUndefined()
    const built = { ...dug, terrain: { ...dug.terrain,
      columns: [{ ...dug.terrain.columns[0], pitLadder: true }] } }
    expect(publicWorldV26ViewProjection(built, carrier).v26PitLadderOpportunity)
      .toBeUndefined()
    const elsewhere = { ...dug, terrain: { ...dug.terrain,
      columns: [{ ...dug.terrain.columns[0], gx: 4 }] } }
    expect(publicWorldV26ViewProjection(elsewhere, carrier).v26PitLadderOpportunity)
      .toBeUndefined()
  })

  it('puts avatar and both visible 4 m terrain tops on the same effective floor', () => {
    const progress = v26(oldAt(12, 4), 2)
    const carrier = carrierFor(progress)
    const beforeProgress = structuredClone(progress)
    const beforePlayer = structuredClone(carrier.player)
    const beforeTerrain = structuredClone(carrier.terrain)
    const beforeVisual = structuredClone(carrier.visualWorld?.terrain)
    const original = carrier.terrain.find((cell) =>
      cell.position[0] === 12 && cell.position[2] === 4)
    expect(original).toBeDefined()

    const view = publicWorldV26ViewProjection(progress, carrier)
    const cell = view.terrain.find((entry) => entry.id === original?.id)
    const visualCell = view.visualWorld?.terrain.find((entry) => entry.id === original?.id)
    expect(view.player.position[1]).toBeCloseTo(carrier.player.position[1] - 0.8)
    expect(cell?.position[1]).toBeCloseTo(view.player.position[1])
    expect(visualCell?.position[1]).toBeCloseTo(view.player.position[1])
    expect(cell?.height).toBeCloseTo(original!.height - 0.8)
    expect(visualCell?.height).toBeCloseTo(original!.height - 0.8)
    expect(view.terrain.find((entry) => entry.id !== original?.id)?.position)
      .toEqual(carrier.terrain.find((entry) => entry.id !== original?.id)?.position)
    expect(progress).toEqual(beforeProgress)
    expect(carrier.player).toEqual(beforePlayer)
    expect(carrier.terrain).toEqual(beforeTerrain)
    expect(carrier.visualWorld?.terrain).toEqual(beforeVisual)
  })

  it('projects the closed north seam and only the saved Works ladder aperture at x=-2', () => {
    const old = oldAt(12, 4)
    const closedCarrier = carrierFor(old)
    const closed = publicWorldV26ViewProjection(v26(old), closedCarrier)
    expect(closed.v26ValleyRimSegments.filter((segment) => segment.ladderAperture))
      .toEqual([])
    expect(closed.v26ValleyRimSegments[0]).toMatchObject({
      from: { x: -30, z: -6 }, to: { x: 30, z: -6 } })

    const built = oldAt(12, 4, ladderId)
    const builtCarrier = carrierFor(built)
    const view = publicWorldV26ViewProjection(v26(built), builtCarrier)
    const aperture = view.v26ValleyRimSegments.find((segment) => segment.ladderAperture)
    expect(aperture).toMatchObject({ from: { x: -2.525, z: -6 },
      to: { x: -1.475, z: -6 } })
    expect(view.v26ValleyRimSegments.filter((segment) => segment.kind === 'rock-return'))
      .toHaveLength(2)
    expect(view.routes).toBe(builtCarrier.routes)
    expect(view.buildSites).toBe(builtCarrier.buildSites)
  })

  it('rejects a carrier with a different seed or any old-player coordinate', () => {
    const progress = v26(oldAt(12, 4))
    const carrier = carrierFor(progress)
    expect(() => publicWorldV26ViewProjection(progress,
      { ...carrier, seed: 'another-seed' })).toThrow(RangeError)
    for (const index of [0, 1, 2]) {
      const position = [...carrier.player.position] as [number, number, number]
      position[index] += 0.1
      expect(() => publicWorldV26ViewProjection(progress,
        { ...carrier, player: { ...carrier.player, position } })).toThrow(RangeError)
    }
  })
})
