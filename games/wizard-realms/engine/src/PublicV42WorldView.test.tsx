import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { mireglassFrontierRoute, mireglassV42FullApproachTrail } from './domain/mireglassApproachTrail'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { confirmPublicV17GreenwayWork } from './domain/publicWorldV17GreenwayWork'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { createFreshPublicV42Root } from './domain/publicWorldV42Snapshot'
import { createFreshPublicWorld } from './domain/publicWorldState'
import { publicWorldViewProjection } from './PublicWorldView'
import { projectPublicV42FrontierRoute, projectPublicV42IronHall } from './PublicV42WorldView'
import type { WizardViewProjection } from './view/contracts'
import { WizardHud } from './view/WizardHud'
import { WizardMap } from './view/WizardMap'

const seed = 'wizard-realms'
const idOf = (point: { x: number; z: number }) => `tile-${point.x / 4 + 3}-${point.z / 4 + 3}`
const root = () => createFreshPublicV42Root(seed)
const carrier = () => publicWorldViewProjection(
  createFreshPublicWorld(seed, 'greenway-classic-v1'), [], null)
function checkedBridge(id: string) {
  const fresh = root().head
  const site = resolvePublicV17GreenwaySite(seed, id)
  if (!site || site.kind !== 'bridge') throw new Error(`Missing bridge ${id}`)
  const point = { x: site.from.x, z: site.from.z - 0.6 }
  const y = publicV17StarterSupportAt({ seed, profile: fresh.state.generationProfile,
    route: fresh.state.greenway.routes[0] ?? null, built: false,
    greenwayWorks: fresh.greenwayWorks }, point)?.floorY
  if (y === undefined) throw new Error('No dry bridge stance')
  const known = [...new Set([...decodeDiscoveredTileIds(fresh.state.discoveryMask),
    ...site.footprintTileIds])].sort()
  const result = confirmPublicV17GreenwayWork({ state: { ...fresh.state,
    discoveryMask: encodeDiscoveredTileIds(known), player: { ...fresh.state.player,
      position: { ...point, y }, inventory: [...fresh.state.player.inventory,
        { itemId: 'logs', quantity: 8 }] } }, greenwayWorks: fresh.greenwayWorks }, id)
  if (!result.progress) throw new Error(`Bridge build rejected: ${result.rejection}`)
  return { ...fresh, state: result.progress.state,
    greenwayWorks: result.progress.greenwayWorks }
}

describe('V42-only center bridge route presentation', () => {
  it('recognizes a checked fresh works4 bridge and its exact deck tile', () => {
    const id = 'works4:bridge:greenway-creek:0'
    const built = checkedBridge(id)
    const route = mireglassFrontierRoute(seed, id)
    const tile = { ...carrier().map.tiles[0], id: idOf(route.points[2]),
      discovered: true, terrain: 'loam' as const }
    const shown = projectPublicV42FrontierRoute(built, { ...carrier(), map: {
      ...carrier().map, tiles: [tile], guidance: 'West to Mireglass: use the dry west exit.' } })
    expect(built.greenwayWorks.builtBridgeIds).toEqual([id])
    expect(shown.map.guidance).toContain('cross the built center Greenway creek bridge')
    expect(shown.map.tiles[0].hasFrontierTrail).toBe(true)
    expect(shown.map.overview?.().cells.flatMap((cell) => cell.markers))
      .not.toContain('Center creek bridge to Mireglass (build required)')
  })

  it('follows an off-center checked works4 span but ignores wrong-site bridge IDs', () => {
    const id = 'works4:bridge:greenway-creek:-60'
    const built = checkedBridge(id)
    const route = mireglassFrontierRoute(seed, id)
    const placedTileId = idOf({ x: -8, z: route.points[1].z })
    const centerTileId = idOf({ x: 0, z: route.points[1].z })
    const tile = { ...carrier().map.tiles[0], discovered: true, terrain: 'loam' as const }
    const input = { ...carrier(), map: { ...carrier().map,
      tiles: [{ ...tile, id: placedTileId }, { ...tile, id: centerTileId }],
      guidance: 'West to Mireglass: follow the dry west trail.' } }
    const shown = projectPublicV42FrontierRoute(built, input)
    expect(route.points[1].x).toBe(-6)
    expect(shown.map.guidance).toContain('cross the built Greenway creek bridge')
    expect(shown.map.tiles[0].hasCenterBridgeRoute).toBe(false)
    expect(shown.map.tiles[1].hasCenterBridgeRoute).toBe(false)
    const learned = { ...built, state: { ...built.state, greenway: { ...built.state.greenway,
      studiedInscriptionIds: ['greenway_waystone' as const] } } }
    const marked = projectPublicV42FrontierRoute(learned, input)
    expect(marked.map.tiles[0].hasCenterBridgeRoute).toBe(true)
    expect(marked.map.tiles[1].hasCenterBridgeRoute).toBe(false)
    const wrongBank = projectPublicV42FrontierRoute({ ...learned,
      state: { ...learned.state, movementOwner: 'greenway' as const,
        player: { ...learned.state.player, position: route.points[4] } } }, {
      ...input, map: { ...input.map, title: 'Open Wilderness' } })
    expect(wrongBank.map.title).toBe('Open Wilderness')
    const wrong = projectPublicV42FrontierRoute({ ...root().head,
      greenwayWorks: { ...root().head.greenwayWorks,
        builtBridgeIds: ['works4:bridge:greenway-creek:00', 'works3:ladder:1'] } }, input)
    expect(wrong.map.guidance).toContain('build the center Greenway creek bridge')
    expect(wrong.map.guidance).not.toContain('cross the built')
  })

  it('keeps legacy west cues outside V42 and renders the learned center bridge without revealing fog', () => {
    const fresh = root().head
    const progress = { ...fresh, state: { ...fresh.state, greenway: { ...fresh.state.greenway,
      studiedInscriptionIds: ['greenway_waystone' as const] } } }
    const bridge = mireglassFrontierRoute(seed)
    const bridgeId = idOf(bridge.points[1])
    const fog = carrier().map.tiles.find((tile) => !tile.discovered)!
    const base = carrier()
    const west = { ...fog, id: 'tile--17-3', gridX: -17, gridZ: 3,
      hasWestTrail: true }
    const approach = { ...fog, id: bridgeId, gridX: bridge.points[1].x / 4 + 3,
      gridZ: bridge.points[1].z / 4 + 3, hasWestTrail: false }
    const deck = { ...approach, id: idOf(bridge.points[2]),
      gridZ: bridge.points[2].z / 4 + 3, discovered: true,
      terrain: 'loam', biome: 'creek bank' }
    const overview = { player: { gridX: 0, gridZ: 0, yaw: 0 }, cells: [
      { id: 'chunk--1-0', gridX: -1, gridZ: 0, discoveredCells: 0,
        terrain: null, biome: null, markers: ['West trail to Mireglass'] },
      { id: 'chunk-0-0', gridX: 0, gridZ: 0, discoveredCells: 0,
        terrain: null, biome: null, markers: [] },
    ] }
    const input: WizardViewProjection = { ...base, map: { ...base.map,
      player: { gridX: 99, gridZ: 99, yaw: 0 },
      tiles: [west, approach, deck], guidance: 'West to Mireglass: follow the marked dry gap near z≈0.',
      overview: () => overview }, savedTerrainWorks: { builtSites: [], dugTileIds: [],
        actionsEnabled: false, preview: { selected: null, nearby: [],
          guidance: 'Follow the west trail to Mireglass to find Fen, Slate, and loam Works.' } } }
    const unlearned = projectPublicV42FrontierRoute(fresh, input)
    expect(unlearned.map.legend).not.toContain('west trail to Mireglass')
    expect(unlearned.map.tiles[1].hasCenterBridgeRoute).toBe(false)
    expect(input.map.tiles[0].hasWestTrail).toBe(true)
    const shown = projectPublicV42IronHall(progress, input)
    expect(shown.map.tiles[0]).toMatchObject({ hasWestTrail: false, hasFrontierTrail: false })
    expect(shown.map.tiles[1]).toMatchObject({ hasCenterBridgeRoute: true,
      discovered: false, terrain: null })
    expect(shown.map.tiles[2].hasFrontierTrail).toBe(false)
    expect(shown.map.guidance).toContain('build the center Greenway creek bridge before crossing')
    expect(shown.map.guidance).not.toContain('dry gap near z≈0')
    expect(shown.savedTerrainWorks?.preview?.guidance).toContain('build the center Greenway creek bridge')
    expect(shown.map.overview!().cells.flatMap((cell) => cell.markers)).toContain(
      'Center creek bridge to Mireglass (build required)')
    expect(shown.map.overview!().cells.flatMap((cell) => cell.markers)).not.toContain(
      'West trail to Mireglass')
    const built = projectPublicV42FrontierRoute({ ...progress,
      greenwayWorks: { ...progress.greenwayWorks,
        builtBridgeIds: [bridge.requiredBridgeId] } }, input)
    expect(built.map.guidance).toContain('cross the built center Greenway creek bridge')
    expect(built.map.tiles[2].hasFrontierTrail).toBe(true)
    expect(built.map.overview!().cells.flatMap((cell) => cell.markers)).toContain(
      'Center creek bridge to Mireglass built')
    expect(built.map.overview!().cells.flatMap((cell) => cell.markers)).not.toContain(
      'Center creek bridge to Mireglass (build required)')
    expect(overview.cells[0].markers).toEqual(['West trail to Mireglass'])
    const markup = renderToStaticMarkup(createElement(WizardMap, { projection: shown,
      open: true, onToggle: () => {}, onIntent: () => {},
      buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>() }))
    expect(markup).toContain(`${bridgeId}: unexplored, center creek bridge toward Mireglass; build before crossing`)
    expect(markup).toMatch(/center creek bridge toward Mireglass; build before crossing[^\"]*"><b>⇣<\/b>/)
    expect(markup).not.toContain('west trail to Mireglass')
    const hud = renderToStaticMarkup(createElement(WizardHud, { projection: shown,
      onIntent: () => {} }))
    expect(hud).toContain('Mireglass Works are beyond the center Greenway creek bridge')
    expect(hud).not.toContain('Follow the ⇦ west trail')
  })

  it('marks only discovered V42 trail tiles, names its frontier and removes the obsolete west connector', () => {
    const fresh = root().head
    const trailPoint = mireglassV42FullApproachTrail(seed).find((point) =>
      point.x === -80 && point.z === 56)!
    const knownTile = { ...carrier().map.tiles[0], id: idOf(trailPoint),
      gridX: trailPoint.x / 4 + 3, gridZ: trailPoint.z / 4 + 3,
      discovered: true, terrain: 'loam', biome: 'Mireglass', hasFrontierTrail: false }
    const oldTile = { ...knownTile, id: 'tile--17-3', gridX: -17, gridZ: 3,
      hasFrontierTrail: true }
    const base = carrier()
    const input = { ...base, map: { ...base.map, title: 'Open Wilderness',
      tiles: [knownTile, oldTile] } }
    const atTrail = { ...fresh, state: { ...fresh.state, movementOwner: 'streamed' as const,
      player: { ...fresh.state.player, position: trailPoint } } }
    const trail = projectPublicV42FrontierRoute(atTrail, input)
    expect(trail.map.title).toBe('Mireglass Reach')
    expect(trail.map.tiles[0].hasFrontierTrail).toBe(true)
    expect(trail.map.tiles[1].hasFrontierTrail).toBe(false)
    const betweenCenters = projectPublicV42FrontierRoute({ ...atTrail,
      state: { ...atTrail.state, player: { ...atTrail.state.player,
        position: { ...trailPoint, x: trailPoint.x + 0.2, z: trailPoint.z + 0.2 } } } }, input)
    expect(betweenCenters.map.title).toBe('Mireglass Reach')
    expect(betweenCenters.map.guidance).toContain('build the center Greenway creek bridge')
    const atOld = { ...fresh, state: { ...fresh.state, movementOwner: 'streamed' as const,
      player: { ...fresh.state.player, position: { x: -80, y: 0, z: 4 } } } }
    const west = projectPublicV42FrontierRoute(atOld, { ...input,
      map: { ...input.map, title: 'Mireglass Reach' } })
    expect(west.map.title).toBe('Open Wilderness')
    expect(west.map.tiles[1].hasFrontierTrail).toBe(false)
  })
})
