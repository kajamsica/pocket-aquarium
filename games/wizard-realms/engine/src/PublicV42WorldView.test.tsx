import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { mireglassFrontierRoute, mireglassV42FullApproachTrail } from './domain/mireglassApproachTrail'
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

describe('V42-only center bridge route presentation', () => {
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
