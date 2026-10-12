import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TerrainWorkSite } from '../domain/terrainWorks'
import { starterCliffCanonicalFace } from '../domain/starterCliffProfile'
import type { WizardSavedTerrainWorksView, WizardViewProjection } from './contracts'
import { greenwayWorkRouteNotes, mapHeadingRotation, OverviewGrid, RouteKey, WizardMap } from './WizardMap'

type RouteSite = Extract<TerrainWorkSite, { kind: 'bridge' | 'ladder' }>
const bridge: RouteSite = {
  id: 'works4:bridge:greenway-creek:0', kind: 'bridge', obstacle: 'fen_channel',
  from: { x: 0, y: 0, z: 4 }, to: { x: 0, y: 0, z: 12 },
  approach: { x: 0, y: 0, z: 0 }, exit: { x: 0, y: 0, z: 16 },
  supportPath: [{ x: 0, y: 0, z: 4 }, { x: 0, y: 0.16, z: 8 }, { x: 0, y: 0, z: 12 }],
  footprintTileIds: ['bridge-near', 'bridge-water', 'bridge-far'], widthMeters: 1.6,
  logCost: 8, rewardClass: 'construction',
}
const ladder: RouteSite = {
  id: 'works4:ladder:greenway-north-cliff:11', kind: 'ladder', obstacle: 'slate_cliff',
  from: { x: 1.1, y: 0, z: -4 }, to: { x: 1.1, y: 1.5, z: -8 },
  approach: { x: 1.1, y: 0, z: 0 }, exit: { x: 1.1, y: 1.5, z: -12 },
  supportPath: [{ x: 1.1, y: 0, z: -4 }, { x: 1.1, y: 0, z: -5.35 },
    { x: 1.1, y: 1.5, z: -6 }, { x: 1.1, y: 1.5, z: -8 }],
  footprintTileIds: ['ladder-lower', 'ladder-upper'], widthMeters: 1.05,
  logCost: 4, rewardClass: 'construction',
}
const dig: Extract<TerrainWorkSite, { kind: 'dig' }> = {
  id: 'works4:dig:bank:4:12', kind: 'dig', obstacle: 'suitable_ground',
  center: { x: 4, y: 0, z: 12 }, loweredCenter: { x: 4, y: -0.24, z: 12 },
  footprintTileIds: ['dig-patch'], depthMeters: 0.24, rewardClass: 'stone',
}
const nearDig: Extract<TerrainWorkSite, { kind: 'dig' }> = {
  ...dig, id: 'works4:dig:bank:-16:0', center: { x: -16, y: 0, z: 0 },
  loweredCenter: { x: -16, y: -0.24, z: 0 }, footprintTileIds: ['near-dig-patch'],
}
const farDig12: Extract<TerrainWorkSite, { kind: 'dig' }> = {
  ...dig, id: 'works4:dig:bank:0:12', center: { x: 0, y: 0, z: 12 },
  loweredCenter: { x: 0, y: -0.24, z: 12 }, footprintTileIds: ['far-dig-12'],
}
const farDig16: Extract<TerrainWorkSite, { kind: 'dig' }> = {
  ...dig, id: 'works4:dig:bank:0:16', center: { x: 0, y: 0, z: 16 },
  loweredCenter: { x: 0, y: -0.24, z: 16 }, footprintTileIds: ['far-dig-16'],
}
const tiles = (hidden: string[] = []) => [...bridge.footprintTileIds,
  ...ladder.footprintTileIds, ...dig.footprintTileIds, ...nearDig.footprintTileIds,
  ...farDig12.footprintTileIds, ...farDig16.footprintTileIds].map((id) => ({
  id, discovered: !hidden.includes(id),
}))
const works = (builtSites: WizardSavedTerrainWorksView['builtSites'] = [bridge],
  suggestedSites: TerrainWorkSite[] = [ladder, dig]): WizardSavedTerrainWorksView => ({
  context: 'works4-greenway', builtSites, suggestedSites, dugTileIds: [], preview: null,
})
const notes = (position: readonly [number, number, number],
  hidden: string[] = [], saved = works()) =>
  greenwayWorkRouteNotes(position, tiles(hidden), saved).join(' ')
const renderedMap = (saved: WizardSavedTerrainWorksView | undefined,
  hidden: string[] = [], includePlayer = true, yaw = 0,
  position: WizardViewProjection['player']['position'] = [-4.2, 0, 5.2], v26Terrain = false,
  extra: Partial<WizardViewProjection> = {}) =>
  renderToStaticMarkup(createElement(WizardMap, {
    projection: { ...(includePlayer ? { player: { position } } : {}),
      ...(v26Terrain ? { v26ValleyRimSegments: [] } : {}),
      savedTerrainWorks: saved, routes: [], buildSites: [], selectedBuildSiteId: null,
      map: { tiles: tiles(hidden).map((tile, index) => ({ ...tile,
        gridX: index, gridZ: 0, terrain: null, biome: null })),
      player: { gridX: 0, gridZ: 0, yaw } }, ...extra } as unknown as WizardViewProjection,
    open: true, onToggle: () => {}, onIntent: () => {},
    buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>(),
  }))

describe('precise Greenway work route map guidance', () => {
  it('shows live guidance, the expanded grid, and its legend before route reference text', () => {
    const map: WizardViewProjection['map'] = { guidance: 'Current route guidance',
      legend: 'Current map legend', player: { gridX: 0, gridZ: 0, yaw: 0 },
      tiles: tiles().map((tile, gridX) => ({ ...tile, gridX, gridZ: 0,
        terrain: 'loam', biome: 'meadow', hasResource: false, hasStore: false,
        hasRing: false, hasRouteSite: false, hasBuiltRoute: false })) }
    const shown = renderedMap(works(), [], true, 0, [0, 0, 0], false, { map })
    const guidance = shown.indexOf('aria-label="Map guidance"')
    const grid = shown.indexOf('aria-label="North-up world map, negative Z is north"')
    const legend = shown.indexOf('Current map legend')
    const routeKey = shown.indexOf('aria-label="Greenway route key"')
    expect(guidance).toBeGreaterThan(-1)
    expect(routeKey).toBeGreaterThan(-1)
    expect(guidance).toBeLessThan(grid)
    expect(grid).toBeLessThan(legend)
    expect(legend).toBeLessThan(routeKey)
    expect(shown).toContain('Precise Greenway route guidance')
    expect(shown).toContain('class="wr-map-local"')
    expect(shown).toContain('class="wr-map-legend"')
    expect(shown).toContain('.wr-map-local:has(.wr-map-route-key)>.wr-map-route-key{grid-column:2;grid-row:2/span 2}')
    expect(shown).toContain('.wr-map-local:has(.wr-map-route-key)>.wr-map-grid,.wr-map-local:has(.wr-map-route-key)>.wr-map-camp-window{grid-column:1;grid-row:2')
    const streamed = renderedMap({ ...works(), context: 'v28-river' }, [], true,
      0, [0, 0, 0], true, { map })
    expect(streamed.indexOf('aria-label="Map guidance"')).toBeGreaterThan(-1)
    expect(streamed.indexOf('aria-label="Map guidance"')).toBeLessThan(
      streamed.indexOf('aria-label="North-up world map, negative Z is north"'))
    expect(streamed.indexOf('Current map legend')).toBeLessThan(
      streamed.indexOf('aria-label="Saved local works"'))
    expect(renderedMap(works(), [], true, 0, [0, 0, 0], true, { map }))
      .not.toContain('aria-label="Map guidance"')
    expect(renderedMap(works(), [], true, 0, [0, 0, 0], true,
      { map: { ...map, guidancePriority: true } }))
      .toContain('aria-label="Map guidance"')
  })

  it('distinguishes natural Mireglass upper shelf in compact and expanded maps without overriding soil or pits', () => {
    const cells = ['high', 'low', 'unknown', 'raised', 'lowered'].map((name, gridX) => ({
      id: `tile-${name}`, gridX, gridZ: 0, terrain: name === 'unknown' ? null : 'loam',
      biome: name === 'unknown' ? null : 'meadow', discovered: name !== 'unknown',
      hasResource: false, hasStore: false, hasRing: false,
      hasRouteSite: false, hasBuiltRoute: false,
      hasNaturalMireglassShelf: name !== 'low',
      ...(name === 'raised' ? { hasRaisedSoil: true, elevationMeters: 2.8 }
        : name === 'lowered' ? { elevationMeters: 1.6 } : {}),
    }))
    const projection = { seed: 'greenway-alpha', routes: [], buildSites: [],
      map: { title: 'Mireglass Reach', tiles: cells,
        legend: '▲ you · ? unexplored', player: { gridX: 1, gridZ: 0, yaw: 0 } } } as unknown as WizardViewProjection
    const html = (open: boolean) => renderToStaticMarkup(createElement(WizardMap, {
      projection, open, onToggle: () => {}, onIntent: () => {},
      buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>(),
    }))
    const expanded = html(true)
    expect(expanded).toContain('tile-high: meadow, natural upper shelf')
    expect(expanded).not.toContain('tile-low: meadow, natural upper shelf')
    expect(expanded).not.toContain('tile-unknown: unexplored, natural upper shelf')
    expect(expanded).toContain('tile-raised: meadow, raised soil top at 2.80 m')
    expect(expanded).toContain('tile-lowered: meadow, lowered ground at 1.60 m')
    const raisedCell = expanded.match(/<span [^>]*class="wr-map-tile"[^>]*aria-label="tile-raised:[^"]*"/)?.[0]
    const loweredCell = expanded.match(/<span [^>]*class="wr-map-tile"[^>]*aria-label="tile-lowered:[^"]*"/)?.[0]
    expect(raisedCell).toContain('background:#56824b')
    expect(raisedCell).toContain('box-shadow:inset 0 0 0 2px #9fdcb3')
    expect(loweredCell).toContain('background:#56824b')
    expect(loweredCell).toContain('box-shadow:inset 0 0 0 2px #d3a66f')
    expect(expanded).toContain('discovered natural upper shelf')
    expect(expanded).toContain('role="img"')
    const compact = html(false)
    expect(compact).toContain('wr-map-compact')
    expect(compact).toContain('tile-high: meadow, natural upper shelf')
    expect(compact).toContain('background:#91ab82')
    const noShelf = { ...projection, map: { ...projection.map, tiles: cells.map((tile) => ({
      ...tile, hasNaturalMireglassShelf: false })) } }
    expect(renderToStaticMarkup(createElement(WizardMap, { projection: noShelf, open: true,
      onToggle: () => {}, onIntent: () => {}, buttonRef: createRef<HTMLButtonElement>(),
      closeRef: createRef<HTMLButtonElement>() }))).not.toContain('discovered natural upper shelf')
  })

  it('labels a discovered V31 soil lift upward without calling it lowered ground', () => {
    const map: WizardViewProjection['map'] = { player: { gridX: 0, gridZ: 0, yaw: 0 },
      tiles: tiles().map((tile, index) => ({ ...tile, gridX: index, gridZ: 0,
        terrain: 'loam', biome: 'meadow', hasResource: false, hasStore: false,
        hasRing: false, hasRouteSite: false, hasBuiltRoute: false,
        ...(tile.id === 'bridge-near' ? { hasRaisedSoil: true, elevationMeters: 1.4 } : {}) })) }
    const shown = renderedMap(works(), [], true, 0, [-4.2, 0, 5.2], true,
      { map, v31Soil: { raisedCells: [{ gx: 0, gz: 0 }], soilAvailable: 1 } })
    expect(shown).toContain('bridge-near: meadow, player location, raised soil top at 1.40 m')
    expect(shown).toContain('▴ raised soil')
    expect(shown).not.toContain('bridge-near: meadow, lowered ground')
    expect(shown).toContain('Dig on a raised cell removes that lift first')
    const historical = renderedMap(works(), [], true, 0, [-4.2, 0, 5.2], true,
      { map: { ...map, tiles: map.tiles.map((tile) => ({ ...tile,
        hasRaisedSoil: undefined })) } })
    expect(historical).not.toContain('▴ raised soil')
  })

  it('marks only the V30 discovered River Works post and gives truthful return guidance', () => {
    const post = { bridgeId: bridge.id, position: [0, 0, 16] as const,
      tileId: 'bridge-far', claimed: false, claimReady: true,
      reward: 'basic-pick' as const }
    const map: WizardViewProjection['map'] = { player: { gridX: 0, gridZ: 0, yaw: 0 },
      tiles: tiles().map((tile, index) => ({ ...tile, gridX: index, gridZ: 0,
        terrain: 'loam', biome: 'meadow', hasResource: false, hasStore: false,
        hasRing: false, hasRouteSite: false, hasBuiltRoute: false,
        hasBridgeheadPost: tile.id === post.tileId })) }
    const v29 = renderedMap(works())
    expect(v29).not.toContain('River Works bridgehead')
    const shown = renderedMap(works(), [], true, 0, [-4.2, 0, 5.2], false,
      { v30Bridgehead: post, map })
    expect(shown).toContain('bridge-far: meadow, River Works survey post')
    expect(shown).toContain('P River Works post')
    expect(shown).toContain('The checked claim appears only when you are grounded and in reach')
    expect(shown).toContain('the field spade remains needed for soil')
    const claimed = renderedMap(works(), [], true, 0, [-4.2, 0, 5.2], false,
      { v30Bridgehead: { ...post, claimed: true, claimReady: false, reward: null }, map })
    expect(claimed).toContain('The one-time crossing reward is recorded')
    expect(claimed).toContain('Return to Greenway Outfitters to sell recovered material')
    expect(claimed).toContain('ore is not guaranteed')
  })

  it('counts V29 visible open excavations separately from marked Works digs', () => {
    const mining = {
      tools: { basicPickOwned: false, enchantedPickOwned: false, activePick: null },
      offers: [], bids: { soil: 1, stone: 3, iron_ore: 8, gold_ore: 15, diamond: 60 },
      bag: { soil: 1, stone: 0, iron_ore: 0, gold_ore: 0, diamond: 0 },
      excavationLevel: 2, atOutfitters: false,
    } satisfies NonNullable<WizardViewProjection['v29Mining']>
    const saved = works([], [])
    const one = renderedMap(saved, [], true, 0, [0, 0, 0], true,
      { v29Mining: mining, v26OpenPitColumns: [{ gx: 0, gz: 1, openDepth: 1 }] })
    expect(one).toContain('0 marked Works digs; 1 visible open excavated column')
    expect(one).not.toContain('0 dug cells')
    const none = renderedMap(saved, [], true, 0, [0, 0, 0], true,
      { v29Mining: mining, v26OpenPitColumns: [] })
    expect(none).toContain('0 visible open excavated columns')
    const older = renderedMap({ ...saved, dugTileIds: ['old-a', 'old-b'] },
      [], true, 0, [0, 0, 0], true, { v26OpenPitColumns: [{ gx: 0, gz: 1, openDepth: 1 }] })
    expect(older).toContain('2 dug cells')
    expect(older).not.toContain('visible open excavated')
  })

  it('keeps global Greenway ladder memory distinct from nearby V28 Works at owner handoff', () => {
    const saved: WizardSavedTerrainWorksView = { builtSites: [], dugTileIds: [],
      actionsEnabled: true, modeActive: false, selectedKind: 'bridge', preview: null }
    const route = { id: 'greenway_ladder', label: 'Greenway ladder',
      from: [0, 1, -4], to: [0, 2.56, -8], built: false, unlocked: true,
      logCost: 4 } as WizardViewProjection['routes'][number]
    const continuity = { position: [-21.25, 1, -8.5] as const,
      greenwayLadders: [{ id: 'works4:ladder:greenway-north-cliff:11',
        from: [1.1, 0, -4] as const, to: [1.1, 1.5, -8] as const }] }
    const streamed = renderedMap(saved, [], true, 0, continuity.position, true,
      { v28TravelContinuity: continuity, routes: [route], unavailableActions: true })
    expect(streamed).toContain('Current position: x -21.25, y 1.00, z -8.50 m')
    expect(streamed).toContain('Saved Greenway Works ladders (global): 1')
    expect(streamed).toContain('Lower foot x 1.10, z -4.00; upper foot x 1.10, z -8.00')
    expect(streamed).toContain('Nearby visible saved works: 0 bridge or ladder')
    expect(streamed).toContain('retrace revealed dry ground')
    expect(streamed).not.toContain('No discovered starter cliff foot yet')
    expect(streamed).not.toContain('Route roadmap:')
    const older = renderedMap(saved, [], true, 0, continuity.position, true,
      { routes: [route], unavailableActions: true })
    expect(older).toContain('Saved local works: 0 bridge or ladder')
    expect(older).toContain('No discovered Greenway low-steps site yet')
  })

  it('uses V28 connected-river guidance instead of generic Fen and arbitrary Fill advice', () => {
    const river = { ...bridge, id: 'works6:river-bridge:-14' }
    const choice = { site: river, distanceMeters: 2, angleRadians: 0,
      rejection: null, reason: 'Ready: checked dry source bank.', benefit: 'One saved deck.' }
    const saved: WizardSavedTerrainWorksView = { context: 'v28-river', builtSites: [],
      suggestedSites: [river], dugTileIds: [], actionsEnabled: true, modeActive: true,
      selectedKind: 'bridge', preview: { selected: choice, nearby: [choice],
        guidance: 'Follow the bank to a marked crossing.' } }
    const map = renderedMap(saved, [], true, 0, [-4.2, 0, 5.2], true)
    expect(map).toContain('How to build a supported connected-river bridge')
    expect(map).toContain('not every bank supports a bridge')
    expect(map).toContain('Fill restores an open excavated pit')
    expect(map).toContain('On touch, open Works, tap the river crossing')
    expect(map).toContain('Follow the bank to a marked crossing.')
    expect(map).not.toContain('Bridge: Fen channel')
  })

  it('shows V26 spade terrain guidance without the fixed Works Dig route', () => {
    const map = renderedMap(works(), [], true, 0, [0, 0, 0], true)
    expect(map).toContain('Ground · Dig/Fill')
    expect(map).toContain('tap nearby revealed dry ground')
    expect(map).not.toContain('B, 3, F')
    expect(map).not.toContain('B Works, 3 Dig')
    expect(greenwayWorkRouteNotes([0, 0, 0], tiles(), works(), null, true).join(' '))
      .not.toContain('dry-loam patch choice')
  })

  it('points both north-up map arrows toward actual W movement at cardinal headings', () => {
    const overview = (yaw: number) => renderToStaticMarkup(createElement(OverviewGrid, {
      overview: { player: { gridX: 0, gridZ: 0, yaw }, cells: [{ id: 'here', gridX: 0,
        gridZ: 0, discoveredCells: 1, terrain: 'loam', biome: 'meadow', markers: [] }] },
    }))
    for (const [yaw, rotation] of [[0, 0], [Math.PI / 2, -Math.PI / 2],
      [-Math.PI / 2, Math.PI / 2]]) {
      expect(mapHeadingRotation(yaw)).toBe(rotation)
      expect(renderedMap(undefined, [], true, yaw))
        .toContain(`transform:rotate(${rotation}rad)`)
      expect(overview(yaw)).toContain(`transform:rotate(${rotation}rad)`)
    }
  })

  it('calls a built starter cliff route a rung ladder, but retains low-steps copy for the older route', () => {
    const route = { id: 'greenway_ladder', label: 'Greenway ladder',
      from: [0, 1, -4], to: [0, 2.56, -8], built: true, unlocked: true, logCost: 4 } as WizardViewProjection['routes'][number]
    const hiddenSite = { id: 'hidden-ladder', routeId: route.id, label: 'Hidden ladder at x 7',
      from: [7, 1, -4], to: [7, 2.56, -8], logCost: 4, status: 'ready',
      reason: 'Ready', discovered: false } as WizardViewProjection['buildSites'][number]
    const props = { routes: [route], buildSites: [hiddenSite], selectedBuildSiteId: null,
      onSelect: () => {}, physicalRoutes: true }
    const steep = renderToStaticMarkup(createElement(RouteKey, { ...props,
      starterCliff: { face: starterCliffCanonicalFace('greenway-alpha'), ladder: 'built' } }))
    expect(steep).toContain('Climb the steep rung ladder')
    expect(steep).not.toContain('Walk the low steps')
    expect(steep).not.toContain('Hidden ladder at x 7')
    const older = renderToStaticMarkup(createElement(RouteKey, props))
    expect(older).toContain('Walk the low steps')
    expect(older).not.toContain('Climb the steep rung ladder')
    expect(older).not.toContain('Hidden ladder at x 7')
  })

  it('gives a west-of-bridge player exact position and a dry approach before crossing', () => {
    const guide = notes([-4.2, 0, 5.2])
    expect(guide).toContain('x -4.2, z 5.2 m')
    expect(guide).toContain('▲ marks a 4 m cell, not exact alignment')
    expect(guide).toContain('Retreat or stay north on dry ground to z 3.0 or less; then move east along that dry bank to x 0.0 before moving south to foot z 4.0')
    expect(guide).toContain('north/shop dry bank and align at foot x 0.0, z 4.0')
    expect(guide).toContain('lane x -0.8 to 0.8')
    expect(guide).toContain('Face south and walk straight to opposite dry foot x 0.0, z 12.0')
    expect(guide).toContain('Do not enter water beside the deck')
  })

  it('switches to the far-bank foot and reverse crossing direction', () => {
    const guide = notes([2, 0, 11])
    expect(guide).toContain('Retreat or stay south on dry ground to z 13.0 or more; then move west along that dry bank to x 0.0 before moving north to foot z 12.0')
    expect(guide).toContain('south/far dry bank and align at foot x 0.0, z 12.0')
    expect(guide).toContain('Face north and walk straight to opposite dry foot x 0.0, z 4.0')
    const onDeck = notes([0.2, 0, 8])
    expect(onDeck).toContain('On the bridge: stay within x -0.8 to 0.8')
    expect(onDeck).not.toContain('Stay on the north/shop dry bank')
  })

  it('routes creek-edge approaches to a dry staging line before either lateral turn', () => {
    const west = notes([-6.3, 0, 6.3])
    expect(west).toContain('Retreat or stay north on dry ground to z 3.0 or less; then move east along that dry bank to x 0.0 before moving south to foot z 4.0')
    expect(west).not.toContain('Move east along dry ground toward x 0.0 first')
    const east = notes([6.3, 0, 6.3])
    expect(east).toContain('Retreat or stay north on dry ground to z 3.0 or less; then move west along that dry bank to x 0.0 before moving south to foot z 4.0')
    const far = notes([6.3, 0, 10.7])
    expect(far).toContain('Retreat or stay south on dry ground to z 13.0 or more; then move west along that dry bank to x 0.0 before moving north to foot z 12.0')
    const shifted = { ...bridge, from: { ...bridge.from, x: -1.4 }, to: { ...bridge.to, x: -1.4 } }
    expect(notes([-6.3, 0, 6.3], [], works([shifted], [])))
      .toContain('move east along that dry bank to x -1.4 before moving south to foot z 4.0')
  })

  it('distinguishes a ladder and a revealed dry-loam dig reward loop', () => {
    const guide = notes([0, 0, 0])
    expect(guide).toContain('Discovered cliff ladder: lower foot x 1.1, z -4.0; upper foot x 1.1, z -8.0')
    expect(guide).toContain('B Works, 2 Ladder, aim, then F when Ready')
    expect(guide).toContain('Revealed far-bank dry-loam patch choice: x 4.0, z 12.0')
    expect(guide).toContain('Stand beside a patch within 4 m, not on it')
    expect(guide).toContain('field spade')
    expect(guide).toContain('B Works, 3 Dig; check Works Selected x/z and Ready before F')
    expect(guide).toContain('one stone and 30 Excavation XP; sell the stone at Outfitters')
    const builtLadder = notes([0, 0, 0], [], works([bridge, ladder], [dig]))
    expect(builtLadder).toContain('Built cliff ladder: lower foot')
    expect(builtLadder).toContain('face north and W to climb; S descends')
  })

  it('prefers a revealed far-bank dig, but labels a near-only patch honestly', () => {
    const both = works([bridge], [nearDig, dig])
    expect(notes([0, 0, 0], [], both))
      .toContain('Revealed far-bank dry-loam patch choice: x 4.0, z 12.0')
    const bothMap = renderedMap(both)
    expect(bothMap).toContain('Far bank · Dig')
    expect(bothMap).toContain('Discovered at x 4, z 12')
    expect(bothMap).not.toContain('Discovered at x -16')

    const nearOnly = works([bridge], [nearDig])
    expect(notes([0, 0, 0], [], nearOnly))
      .toContain('Revealed near-bank dry-loam patch choice: x -16.0, z 0.0')
    const nearMap = renderedMap(nearOnly)
    expect(nearMap).toContain('Near bank · Dig')
    expect(nearMap).toContain('Discovered at x -16, z 0')
    expect(nearMap).not.toContain('Across the creek')

    const hiddenFar = renderedMap(both, ['dig-patch'])
    expect(hiddenFar).toContain('Near bank · Dig')
    expect(hiddenFar).toContain('Discovered at x -16, z 0')
    expect(hiddenFar).not.toContain('Discovered at x 4, z 12')
    expect(notes([0, 0, 0], ['near-dig-patch', 'dig-patch'], both))
      .not.toContain('dry-loam patch choice')
  })

  it('shows both revealed nearby dig choices when no built support occupies either patch', () => {
    const selected = { site: farDig16, angleRadians: 0, distanceMeters: 3.1,
      rejection: null, reason: 'Ready', benefit: 'Dig stone' }
    const nearby = { ...works([], [farDig12, farDig16]),
      preview: { selected, nearby: [selected], guidance: null } }
    const guide = notes([-0.9, 0, 13], [], nearby)
    expect(guide).toContain('patch choices: x 0.0, z 12.0; x 0.0, z 16.0')
    expect(guide).toContain('map coordinates are options, not the automatic Works target')
    expect(guide).toContain('check Works Selected x/z and Ready before F')
    const map = renderedMap(nearby, [], true, 0, [-0.9, 0, 13])
    expect(map).toContain('Discovered at x 0, z 12; x 0, z 16')
    expect(map).toContain('Map choices, not Works selection')
    const hidden = renderedMap(nearby, ['far-dig-16'], true, 0, [-0.9, 0, 13])
    expect(hidden).not.toContain('x 0, z 16')
  })

  it('omits the x 0, z 12 dig patch occupied by a built creek bridge foot', () => {
    const built = works([bridge], [farDig12, farDig16])
    const guide = notes([-0.9, 0, 13], [], built)
    expect(guide).toContain('Revealed far-bank dry-loam patch choice: x 0.0, z 16.0')
    expect(guide).not.toContain('patch choices: x 0.0, z 12.0')
    const map = renderedMap(built, [], true, 0, [-0.9, 0, 13])
    expect(map).toContain('Discovered at x 0, z 16')
    expect(map).not.toContain('Discovered at x 0, z 12')
    expect(map).toContain('check Works Selected x/z and Ready before F')
  })

  it('does not disclose locations from incomplete footprints or non-Greenway works', () => {
    const guide = notes([-4, 0, 5], ['bridge-far', 'ladder-upper', 'dig-patch'])
    expect(guide).toContain('You are at x -4.0, z 5.0 m')
    expect(guide).not.toContain('Built bridge')
    expect(guide).not.toContain('dry ground to z 3.0')
    expect(guide).not.toContain('cliff ladder')
    expect(guide).not.toContain('patch x 4.0')
    expect(notes([0, 0, 0], [], { ...works(), context: 'works3-greenway' })).toBe('')
    expect(notes([0, 0, 0], [], works([], [bridge])))
      .toContain('Water is blocked until B Works, 1 Bridge, aim, then F when Ready')
    expect(notes([0, 0, 0], [], { ...works(), dugTileIds: ['dig-patch'] }))
      .not.toContain('Revealed far-bank dry-loam patch')
  })

  it('keeps every rendered route-key coordinate hidden until its whole footprint is discovered', () => {
    const hidden = ['bridge-far', 'ladder-upper']
    const suggested = works([], [bridge, ladder])
    const partialSuggestion = renderedMap(suggested, hidden)
    expect(partialSuggestion).not.toContain('Discovered candidate at x 0')
    expect(partialSuggestion).not.toContain('Discovered candidate at x 1.1')
    expect(renderedMap(suggested)).toContain('Discovered candidate at x 0')
    expect(renderedMap(suggested)).toContain('Discovered candidate at x 1.1')

    const choice = { site: bridge, angleRadians: 0, distanceMeters: 2,
      rejection: null, reason: 'Ready', benefit: 'Bridge crossing' }
    const nearby = { ...works([], []), preview: { selected: choice,
      nearby: [choice], guidance: null } }
    expect(renderedMap(nearby, ['bridge-far'])).not.toContain('Discovered at x 0')
    expect(renderedMap(nearby)).toContain('Discovered at x 0')

    const built = works([bridge, ladder], [])
    const partialBuilt = renderedMap(built, hidden)
    expect(partialBuilt).not.toContain('Built at x 0')
    expect(partialBuilt).not.toContain('Built at x 1.1')
    expect(partialBuilt).not.toContain('Built Works north cliff ladder')
    expect(renderedMap(built)).toContain('Built at x 0')
    expect(renderedMap(built)).toContain('Built at x 1.1')
  })

  it('keeps legacy map projections without a V17 player position renderable', () => {
    const html = renderedMap(undefined, [], false)
    expect(html).toContain('Greenway atlas')
    expect(html).not.toContain('You are at x')
  })

  it('reports the player elevation alongside exact map coordinates', () => {
    const html = renderedMap(works(), [], true, 0, [1.23, 1.56, -8.7])
    expect(html).toContain('You are at x 1.2, z -8.7 m, elevation 1.6 m.')
  })
})
