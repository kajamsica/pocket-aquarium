import { describe, expect, it } from 'vitest'
import { encodeDiscoveredTileIds } from './domain/discoveryMask'
import { HIGHLAND_LANDMARK, highlandLandmark, highlandStoneNodes } from './domain/highlandContent'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { emptyPublicV26TerrainLedger } from './domain/publicWorldV26TerrainLedger'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { publicV26ValleyRimPassage } from './domain/publicWorldV26ValleyRim'
import { publicV25RiverCellAtGrid } from './domain/publicWorldV25River'
import type { PublicV32Progress } from './domain/publicWorldV32Migration'
import type { WorldTile } from './domain/types'
import { worldTileAtGrid } from './domain/worldChunks'
import { projectPublicV32WorldView, PUBLIC_V32_CROWN_INTERACTION_ID,
  publicV32NodeInteractionId } from './PublicV32WorldView'
import type { WizardViewProjection } from './view/contracts'

const seed = 'greenway-alpha'
const crown = highlandLandmark(seed)
const nodes = highlandStoneNodes(seed)

function fixture(tile: WorldTile, revealedIds: readonly string[], options?: {
  studied?: boolean; spade?: boolean; excavationXp?: number; readyAtTick?: number;
  stone?: number; tick?: number; air?: boolean }, worldSeed = seed): PublicV32Progress {
  const start = createPublicV23Root(worldSeed).head
  const surface = resolvePublicV23Surface(start.state, tile.center, [])
  if (!surface) throw new Error('Missing Highland surface')
  const inventory = [...start.state.player.inventory,
    ...(options?.spade ? [{ itemId: 'field_spade' as const, quantity: 1 }] : []),
    ...(options?.stone ? [{ itemId: 'stone' as const, quantity: options.stone }] : [])]
  return { state: { ...start.state, tick: options?.tick ?? start.state.tick,
    movementOwner: 'streamed', discoveryMask: encodeDiscoveredTileIds([...revealedIds].sort()),
    player: { ...start.state.player,
      position: { x: tile.center.x, y: surface.floorY + (options?.air ? 1 : 0),
        z: tile.center.z }, verticalVelocity: options?.air ? 1 : 0,
      inventory, equipment: { ...start.state.player.equipment,
        mainHand: options?.spade ? 'field_spade' : start.state.player.equipment.mainHand },
      skillXp: { ...start.state.player.skillXp,
        excavation: options?.excavationXp ?? start.state.player.skillXp.excavation } },
    highland: { ...start.state.highland, landmarkDiscovered: options?.studied ?? false,
      stoneNodes: start.state.highland.stoneNodes.map((row) => ({ ...row,
        readyAtTick: row.id === nodes[0].id ? options?.readyAtTick ?? row.readyAtTick
          : row.readyAtTick })) } },
    greenwayWorks: start.greenwayWorks, regionalWorks: start.regionalWorks,
    terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0, riverBridgeIds: [],
    miningTools: { basicPickOwned: false, enchantedPickOwned: false, activePick: null },
    claimedBridgeheadId: null, raisedSoilCells: [] }
}

function carrier(progress: PublicV32Progress, tiles: readonly WorldTile[],
  shownIds: readonly string[], mapIds: readonly string[] = shownIds): WizardViewProjection {
  const terrain = tiles.map((tile) => ({ id: tile.id,
    position: [tile.center.x, tile.center.y, tile.center.z] as const,
    size: [4, 4] as const, height: 0.7, climate: tile.biome }))
  const mapTiles = tiles.map((tile) => ({ id: tile.id, gridX: tile.gridX,
    gridZ: tile.gridZ, discovered: mapIds.includes(tile.id),
    terrain: mapIds.includes(tile.id) ? tile.terrain : null,
    biome: mapIds.includes(tile.id) ? tile.biome : null,
    hasResource: false, hasStore: false, hasRing: false,
    hasRouteSite: false, hasBuiltRoute: false }))
  return { seed: progress.state.seed, player: { position: [progress.state.player.position.x,
    progress.state.player.position.y, progress.state.player.position.z] },
  terrain, resources: [], landmarks: [], visualWorld: { terrain,
    discoveredTileIds: [...shownIds], resources: [], landmarks: [] },
  map: { tiles: mapTiles, overview: () => ({ player: { gridX: 0, gridZ: 0, yaw: 0 },
    cells: [{ id: 'quarry-chunk', gridX: Math.floor(crown.tile.center.x / 64),
      gridZ: Math.floor(crown.tile.center.z / 64), discoveredCells: 1,
      terrain: 'rocky', biome: 'highland', markers: [] }] }) },
  nearbyInteraction: null, checkedActionChoices: [],
  } as unknown as WizardViewProjection
}

describe('V32 discovered Highland view', () => {
  it('shows a visible Crown study prompt before activation and leaves the carrier unchanged', () => {
    const progress = fixture(crown.tile, [crown.tile.id])
    const base = carrier(progress, [crown.tile], [crown.tile.id])
    const before = JSON.stringify(base)
    const view = projectPublicV32WorldView(progress, base)
    expect(view.nearbyInteraction).toMatchObject({ targetId: PUBLIC_V32_CROWN_INTERACTION_ID,
      kind: 'other', label: 'Quarry Crown', actionable: true })
    expect(view.checkedActionChoices).toContainEqual({ id: PUBLIC_V32_CROWN_INTERACTION_ID,
      actionable: true, reason: null })
    expect(view.map.tiles[0]).toMatchObject({ hasHighlandLandmark: true })
    expect(view.visualWorld?.landmarks).toContainEqual({ id: HIGHLAND_LANDMARK.id,
      kind: 'quarry-crown', position: [crown.tile.center.x, crown.tile.center.y,
        crown.tile.center.z], discovered: false })
    expect(view.map.guidance).toContain('study it')
    expect(view.map.overview?.().cells[0].markers).toContain('Quarry Crown')
    expect(JSON.stringify(base)).toBe(before)
    expect(view.visualWorld?.terrain).toBe(base.visualWorld?.terrain)
  })

  it('keeps Crown and outcrops hidden when mask, map, or active scene has not revealed them', () => {
    for (const [revealed, mapShown, sceneShown] of [
      [false, false, false], [true, false, true], [true, true, false],
    ] as const) {
      const progress = fixture(crown.tile, revealed ? [crown.tile.id, nodes[0].tile.id] : [])
      const view = projectPublicV32WorldView(progress, carrier(progress,
        [crown.tile, nodes[0].tile], sceneShown ? [crown.tile.id, nodes[0].tile.id] : [],
        mapShown ? [crown.tile.id, nodes[0].tile.id] : []))
      expect(view.visualWorld?.landmarks).toEqual([])
      expect(view.visualWorld?.resources).toEqual([])
      expect(view.nearbyInteraction).toBeNull()
      expect(view.map.tiles.some((tile) => tile.hasHighlandLandmark || tile.hasHighlandNode))
        .toBe(false)
    }
    const unwalked = fixture(crown.tile, [])
    const view = projectPublicV32WorldView(unwalked,
      carrier(unwalked, [crown.tile], [crown.tile.id]))
    expect(view.map.overview?.().cells[0].markers).toEqual([])
  })

  it('offers the nearest discovered stone shelf with explicit locks, recovery, and checked ID', () => {
    const tile = nodes[0].tile
    const progress = fixture(tile, [tile.id, crown.tile.id], {
      studied: true, spade: true, excavationXp: 30 })
    const base = carrier(progress, [tile], [tile.id])
    const ready = projectPublicV32WorldView(progress, base)
    expect(ready.nearbyInteraction).toMatchObject({ kind: 'resource',
      targetId: publicV32NodeInteractionId(nodes[0].id), actionable: true })
    expect(ready.highlandExtraction).toMatchObject({ nodeId: nodes[0].id,
      actionable: true })
    expect(ready.visualWorld?.resources).toContainEqual({ id: nodes[0].id,
      kind: 'ore', visualKind: 'highland-stone', label: 'Highland stone outcrop',
      position: [tile.center.x, tile.center.y, tile.center.z], available: true })
    expect(ready.map.tiles[0]).toMatchObject({ hasHighlandNode: true,
      highlandNodeReady: true })
    expect(ready.map.overview?.().cells[0].markers).toContain('Quarry Crown studied')
    const noStudy = projectPublicV32WorldView({ ...progress,
      state: { ...progress.state, highland: { ...progress.state.highland,
        landmarkDiscovered: false } } }, base)
    expect(noStudy.nearbyInteraction?.action).toContain('Study Quarry Crown first')
    const noTool = projectPublicV32WorldView(fixture(tile, [tile.id], {
      studied: true, excavationXp: 30 }), base)
    expect(noTool.nearbyInteraction?.action).toContain('Buy a field spade')
    const noSkill = projectPublicV32WorldView(fixture(tile, [tile.id], {
      studied: true, spade: true, excavationXp: 0 }), base)
    expect(noSkill.nearbyInteraction?.action).toContain('Excavation Lv2')
    const recovering = projectPublicV32WorldView(fixture(tile, [tile.id], {
      studied: true, spade: true, excavationXp: 30,
      readyAtTick: 3000 }), base)
    expect(recovering.nearbyInteraction?.action).toContain('recovering')
    expect(recovering.map.tiles[0].highlandNodeReady).toBe(false)
    expect(recovering.visualWorld?.resources[0].available).toBe(false)
  })

  it('does not replace first-region guidance before the eastern crossing, but points stone west', () => {
    const progress = fixture(crown.tile, [crown.tile.id], { studied: true,
      stone: 2 })
    const view = projectPublicV32WorldView(progress, carrier(progress,
      [crown.tile], [crown.tile.id]))
    expect(view.map.guidance).toContain('Greenway Outfitters buys stone')
    expect(view.map.guidance).toContain('west')
    const other = fixture(crown.tile, [crown.tile.id], { studied: true })
    expect(projectPublicV32WorldView(other,
      carrier(other, [crown.tile], [crown.tile.id])).map.guidance)
      .toContain('Stone shelves appear only after you walk')
  })

  it('marks only charted eastern trail cells and leaves early Greenway instructions intact', () => {
    const start = createPublicV23Root(seed).head
    const east = start.state.greenway.tiles.filter((tile) => tile.center.z === 0)
      .sort((left, right) => right.center.x - left.center.x)[0]
    const next = worldTileAtGrid(seed, east.center.x / 4 + 1, 0)
    const progress: PublicV32Progress = { state: { ...start.state,
      discoveryMask: encodeDiscoveredTileIds([east.id]) },
      greenwayWorks: start.greenwayWorks, regionalWorks: start.regionalWorks,
      terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0, riverBridgeIds: [],
      miningTools: { basicPickOwned: false, enchantedPickOwned: false, activePick: null },
      claimedBridgeheadId: null, raisedSoilCells: [] }
    const base = { ...carrier(progress, [east, next], [east.id]),
      map: { ...carrier(progress, [east, next], [east.id]).map,
        guidance: 'First gather wood and learn how to build.' } }
    const view = projectPublicV32WorldView(progress, base)
    expect(view.map.tiles.find((tile) => tile.id === east.id)).toMatchObject({
      discovered: true })
    expect(view.map.tiles.find((tile) => tile.id === east.id)?.hasEastTrail).toBeUndefined()
    expect(view.map.tiles.find((tile) => tile.id === east.id)?.hasHighlandTrail).toBeUndefined()
    expect(view.map.tiles.find((tile) => tile.id === next.id)?.hasHighlandTrail)
      .toBeUndefined()
    expect(view.map.guidance).toBe('First gather wood and learn how to build.')
  })

  it('marks the x30 east-return wall and sends the charted Greenway exit back to its saved north ladder', () => {
    const start = createPublicV23Root(seed).head
    const east = start.state.greenway.tiles.filter((tile) => tile.center.z === 0)
      .sort((left, right) => right.center.x - left.center.x)[0]
    const point = { x: 28.1, z: 0.3 }
    const support = publicV17StarterSupportAt({ seed,
      profile: start.state.generationProfile,
      route: start.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null,
      built: false, greenwayWorks: start.greenwayWorks }, point)
    if (!support) throw new Error('Missing east Greenway floor')
    const ladder = Array.from({ length: 280 }, (_, index) => index - 140)
      .map((q) => resolvePublicV17GreenwaySite(seed,
        `works4:ladder:greenway-north-cliff:${q}`))
      .find((site) => site?.kind === 'ladder')
    if (!ladder || ladder.kind !== 'ladder') throw new Error('Missing saved north ladder fixture')
    const works = { ...start.greenwayWorks, builtLadderIds: [ladder.id] }
    const progress: PublicV32Progress = { state: { ...start.state,
      discoveryMask: encodeDiscoveredTileIds([east.id]),
      player: { ...start.state.player, position: { ...point, y: support.floorY } } },
      greenwayWorks: works, regionalWorks: start.regionalWorks,
      terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0, riverBridgeIds: [],
      miningTools: { basicPickOwned: false, enchantedPickOwned: false, activePick: null },
      claimedBridgeheadId: null, raisedSoilCells: [] }
    expect(progress.state.greenway.builtRouteIds).not.toContain('greenway_ladder')
    const baseline = carrier(progress, [east], [east.id])
    const view = projectPublicV32WorldView(progress, { ...baseline,
      map: { ...baseline.map, guidance: 'Return west to the old objective.' } })
    expect(publicV26ValleyRimPassage(seed, { x: 29.9, z: 0.3 },
      { x: 30.1, z: 0.3 }, [{ x: ladder.from.x, widthMeters: ladder.widthMeters }]))
      .toEqual({ ok: false, reason: 'rock-return-blocked' })
    expect(view.map.tiles[0].hasEastTrail).toBeUndefined()
    expect(view.map.tiles[0].hasHighlandTrail).toBeUndefined()
    expect(view.map.guidance).toContain('Return')
    expect(view.map.guidance).toContain('saved north ladder')
    expect(view.map.guidance).toContain('stay north of the cliff until past x30')
    expect(view.map.guidance).toContain('supported ground to descend east of the wall')
    expect(view.map.guidance).not.toContain('Walk east to chart the trail')

    const upper = { x: 28.1, z: -8 }
    const upperSupport = publicV17StarterSupportAt({ seed,
      profile: start.state.generationProfile,
      route: start.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null,
      built: false, greenwayWorks: works }, upper)
    if (!upperSupport) throw new Error('Missing upper Greenway floor')
    const upperProgress = { ...progress, state: { ...progress.state,
      player: { ...progress.state.player,
        position: { ...upper, y: upperSupport.floorY } } } }
    const upperBase = carrier(upperProgress, [east], [east.id])
    const upperView = projectPublicV32WorldView(upperProgress, upperBase)
    expect(upperView.map.tiles[0].hasEastTrail).toBeUndefined()
    expect(upperView.map.guidance).toContain('stay north of the cliff')
    expect(upperView.map.guidance).toContain('past x30')
  })

  it('charts only dry first-bend cells and guides the default save around the wet river edge', () => {
    const at = (x: number, z: number) => worldTileAtGrid(seed, x / 4, z / 4)
    const dryStart = at(68, 0)
    const dryNorth = at(68, -4)
    const dryEast = at(96, -4)
    const dryJoin = at(100, -4)
    const oldDry = at(92, 0)
    const wetWest = at(96, 0)
    const wetEast = at(100, 0)
    const tiles = [dryStart, dryNorth, dryEast, dryJoin, oldDry, wetWest, wetEast]
    const ids = tiles.map((tile) => tile.id)
    expect(publicV25RiverCellAtGrid(seed, 24, 0)).toBe(true)
    expect(publicV25RiverCellAtGrid(seed, 25, 0)).toBe(true)
    const start = fixture(dryStart, ids)
    const edge = { x: 93.93, z: -1.29 }
    const support = resolvePublicV23Surface(start.state, edge, [])
    if (!support) throw new Error('Missing first-bend support')
    const progress = { ...start, state: { ...start.state,
      player: { ...start.state.player, position: { ...edge, y: support.floorY } } } }
    const view = projectPublicV32WorldView(progress, carrier(progress, tiles, ids))
    const marked = (id: string) => view.map.tiles.find((tile) => tile.id === id)?.hasHighlandTrail
    expect(marked(dryStart.id)).toBe(true)
    expect(marked(dryNorth.id)).toBe(true)
    expect(marked(dryEast.id)).toBe(true)
    expect(marked(dryJoin.id)).toBe(true)
    expect(marked(oldDry.id)).toBeUndefined()
    expect(marked(wetWest.id)).toBeUndefined()
    expect(marked(wetEast.id)).toBeUndefined()
    expect(view.map.guidance).toContain('Backtrack west along dry ground')
    expect(view.map.guidance).toContain('x68 north-bypass entrance')
    expect(view.map.guidance).toContain('turn north')
    expect(view.map.guidance).toContain('before heading east')

    const unseen = projectPublicV32WorldView(progress, carrier(progress, tiles,
      ids.filter((id) => id !== dryEast.id)))
    expect(unseen.map.tiles.find((tile) => tile.id === dryEast.id)?.hasHighlandTrail)
      .toBeUndefined()
    const bankSupport = resolvePublicV23Surface(start.state, dryNorth.center, [])
    if (!bankSupport) throw new Error('Missing dry bank support')
    const bankProgress = { ...start, state: { ...start.state,
      player: { ...start.state.player, position: { ...dryNorth.center,
        y: bankSupport.floorY } } } }
    const bank = projectPublicV32WorldView(bankProgress, carrier(bankProgress, tiles, ids))
    expect(bank.map.guidance).toContain('dry bank east near z -4')
  })

  it('uses the same safe north-bank display connector for an earlier-wet procedural seed', () => {
    const alternateSeed = 'route-probe-150'
    const at = (x: number, z: number) => worldTileAtGrid(alternateSeed, x / 4, z / 4)
    const dryStart = at(68, 0)
    const dryNorth = at(68, -4)
    const dryJoin = at(100, -4)
    const oldWet = at(92, 0)
    const tiles = [dryStart, dryNorth, dryJoin, oldWet]
    const ids = tiles.map((tile) => tile.id)
    expect(publicV25RiverCellAtGrid(alternateSeed, 23, 0)).toBe(true)
    const progress = fixture(dryStart, ids, undefined, alternateSeed)
    const view = projectPublicV32WorldView(progress, carrier(progress, tiles, ids))
    expect(view.map.tiles.find((tile) => tile.id === oldWet.id)?.hasHighlandTrail)
      .toBeUndefined()
    for (const dry of [dryStart, dryNorth, dryJoin]) {
      expect(view.map.tiles.find((tile) => tile.id === dry.id)?.hasHighlandTrail).toBe(true)
    }
    expect(view.map.guidance).toContain('turn north')
  })

  it('rejects a foreign carrier seed or X/Z pose', () => {
    const progress = fixture(crown.tile, [crown.tile.id])
    const base = carrier(progress, [crown.tile], [crown.tile.id])
    expect(() => projectPublicV32WorldView(progress, { ...base, seed: 'other' }))
      .toThrow(RangeError)
    expect(() => projectPublicV32WorldView(progress, { ...base,
      player: { ...base.player, position: [999, base.player.position[1], 0] } }))
      .toThrow(RangeError)
  })
})
