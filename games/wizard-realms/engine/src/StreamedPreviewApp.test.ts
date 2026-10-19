import { describe, expect, it } from 'vitest'
import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createStreamedTerrainWorkTrial, createStreamedWorld, mireglassRouteSites } from './domain'
import { createMireglassWorld } from './domain/mireglassWorld'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './domain/publicWorldDiscovery'
import { createFreshPublicWorld } from './domain/publicWorldState'
import { resolveTerrainWorkSite } from './domain/terrainWorks'
import { mireglassViewProjection } from './MireglassPlayableApp'
import { publicWorldViewProjection } from './PublicWorldView'
import { landscapeDressingFor } from './view/landscapeDressing'
import {
  HIGHLAND_RIDGE_DEV_SPAWN, HIGHLAND_RIDGE_RECOVERY_DEV_SPAWN, MIREGLASS_DEV_SPAWN,
  PREVIEW_MAP_LEGEND, mireglassVisualTerrainAt,
  streamedControlIntents, streamedMapTitle, streamedPreviewRuntimeForSearch, streamedProjection,
  streamedStartForSearch, streamedTrialCandidates,
} from './StreamedPreviewApp'
import { WizardHud } from './view/WizardHud'
import { WizardMap } from './view/WizardMap'
import { sceneTerrainFor } from './view/WizardScene'
import { visibleTerrainCells } from './view/visibleTerrain'

describe('streamed preview adapter', () => {
  it('uses preview discovery for 3D ground and scenery without losing old discoveries', () => {
    const { runtime } = streamedPreviewRuntimeForSearch('?devRegion=streamed', true)
    const project = () => streamedProjection(runtime, runtime.state, [], false, undefined, [], true)
    const initial = project()
    expect(initial.previewSceneDiscoveryIds).toEqual(runtime.state.discoveredTileIds)
    const first = sceneTerrainFor(initial)
    expect(first.revealedTerrain).toHaveLength(49)
    expect(first.unchartedFringe).toHaveLength(240)
    expect(first.revealedTerrain.every((cell) => initial.previewSceneDiscoveryIds?.includes(cell.id))).toBe(true)
    expect(first.unchartedFringe.every((cell) => !initial.previewSceneDiscoveryIds?.includes(cell.id))).toBe(true)
    const dressing = landscapeDressingFor(first.revealedTerrain)
    expect(dressing.length).toBeGreaterThan(0)
    expect(landscapeDressingFor(initial.terrain).length).toBeGreaterThan(dressing.length)
    expect(dressing.every(({ position: [x, , z] }) => first.revealedTerrain.some((cell) =>
      Math.abs(cell.position[0] - x) < 2 && Math.abs(cell.position[2] - z) < 2))).toBe(true)

    expect(runtime.advance([{ type: 'move', delta: { x: 4, z: 0 } }],
      { nearbyDiscovery: true }).rejections).toEqual([])
    const afterMove = sceneTerrainFor(project())
    expect(afterMove.revealedTerrain.length).toBeGreaterThan(first.revealedTerrain.length)
    expect(runtime.advance([{ type: 'move', delta: { x: -4, z: 0 } }],
      { nearbyDiscovery: true }).rejections).toEqual([])
    const returned = sceneTerrainFor(project())
    expect(returned.revealedTerrain.length).toBeGreaterThan(first.revealedTerrain.length)
    expect(first.revealedTerrain.every((cell) => returned.revealedTerrain.some((known) => known.id === cell.id)))
      .toBe(true)
  })

  it('masks trial scenery to nearby discovery without changing Mireglass or public projections', () => {
    const { runtime } = streamedPreviewRuntimeForSearch('?devRegion=streamed&trial=works', true)
    expect(runtime.state.discoveredTileIds).toHaveLength(49)
    const trialProjection = streamedProjection(runtime, runtime.state, [], false, undefined, [], true)
    expect(trialProjection.previewSceneDiscoveryIds).toEqual(runtime.state.discoveredTileIds)
    expect(sceneTerrainFor(trialProjection).revealedTerrain).toHaveLength(49)
    expect(sceneTerrainFor(trialProjection).unchartedFringe).toHaveLength(240)

    const mireglass = createMireglassWorld('greenway-alpha')
    expect(mireglassViewProjection(mireglass, mireglass.state, [], null))
      .not.toHaveProperty('previewSceneDiscoveryIds')
    const publicProjection = publicWorldViewProjection(
      createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'), [], null)
    expect(publicProjection).not.toHaveProperty('previewSceneDiscoveryIds')
    expect(publicProjection.visualWorld?.discoveredTileIds).toBeDefined()
    expect(sceneTerrainFor(publicProjection).unchartedFringe.length).toBeGreaterThan(0)
  })

  it('starts ordinary preview with a bounded neighborhood and keeps discovery across a return crossing', () => {
    const { runtime, trial } = streamedPreviewRuntimeForSearch('?devRegion=streamed', true)
    expect(trial).toBeNull()
    const initial = nearbyWorldTileIds(runtime.state.player.position, PUBLIC_WALK_REVEAL_RADIUS_METERS)
    expect(runtime.state.discoveredTileIds).toEqual(initial)
    expect(initial).toHaveLength(49)
    const moved = runtime.advance([{ type: 'move', delta: { x: 4, z: 0 } }], { nearbyDiscovery: true })
    expect(moved.rejections).toEqual([])
    expect(moved.state.discoveredTileIds).toEqual([...new Set([...initial,
      ...nearbyWorldTileIds(moved.state.player.position, PUBLIC_WALK_REVEAL_RADIUS_METERS)])].sort())

    const crossing = createStreamedWorld('chunk-crossing', { x: 0, z: 0 }, undefined, undefined, true)
    for (let x = 4; x <= 64; x += 4) {
      expect(crossing.advance([{ type: 'move', delta: { x: 4, z: 0 } }],
        { nearbyDiscovery: true }).rejections).toEqual([])
    }
    const atFarBank = crossing.state.discoveredTileIds
    expect(crossing.state.player.position.x).toBe(64)
    expect(atFarBank).toContain('tile-3-3')
    expect(atFarBank).toContain('tile-23-3') // 16 m beyond x=64
    for (let x = 60; x >= 0; x -= 4) {
      expect(crossing.advance([{ type: 'move', delta: { x: -4, z: 0 } }],
        { nearbyDiscovery: true }).rejections).toEqual([])
    }
    expect(crossing.state.player.position.x).toBe(0)
    expect(crossing.state.discoveredTileIds).toBe(atFarBank)
    expect(crossing.activeChunkCount()).toBe(9)

    const unsavedTrial = streamedPreviewRuntimeForSearch('?devRegion=streamed&trial=works', true).trial!
    expect(unsavedTrial.state.discoveredTileIds).toHaveLength(49)
  })

  it('gates the unsaved trial to the development query and starts at a reachable canonical bridge', () => {
    const query = '?devRegion=streamed&trial=works'
    const { runtime, trial } = streamedPreviewRuntimeForSearch(query, true)
    if (!trial) throw new Error('Trial runtime was not created')
    expect(runtime).toBe(trial)
    const bridge = resolveTerrainWorkSite('greenway-alpha', 'works1:bridge:-102:92:z')!
    if (bridge.kind !== 'bridge') throw new Error('Missing canonical bridge')
    expect(trial.state.player.position).toMatchObject(bridge.from)
    expect(streamedTrialCandidates(trial, trial.state.player.position).map((site) => site.id))
      .toContain(bridge.id)
    expect(trial.preview(bridge.id).rejection).toBeNull()
    for (const disabled of [streamedPreviewRuntimeForSearch(query, false),
      streamedPreviewRuntimeForSearch('?devRegion=streamed', true),
      streamedPreviewRuntimeForSearch('?trial=works', true)]) {
      expect(disabled.trial).toBeNull()
      expect(disabled.runtime.state.player.position.x).toBe(0)
    }
    for (const [spawn, id] of [['works-ladder', 'works1:ladder:-103:108:W'],
      ['works-dig', 'tile--64-76']] as const) {
      const variant = streamedPreviewRuntimeForSearch(`${query}&spawn=${spawn}`, true).trial!
      const site = resolveTerrainWorkSite('greenway-alpha', id)!
      const point = site.kind === 'dig' ? site.center : site.from
      expect(variant.state.player.position).toMatchObject(point)
      expect(variant.preview(id).rejection).toBeNull()
      expect(streamedTrialCandidates(variant, variant.state.player.position).map((candidate) => candidate.id))
        .toContain(id)
      const view = streamedProjection(variant, variant.state, [], false, {
        kit: variant.trialState.kit, bootsEquipped: variant.bootsEquipped,
        candidates: [{ site, rejection: null }], selectedId: null,
        selectedSite: null, selectedRejection: null, builtSites: [],
      })
      expect(view.map.guidance).toContain(`discovered ${site.kind} site at x ${point.x}, z ${point.z} (here, 0 m on the map)`)
      const occupied = view.map.tiles.find((tile) => tile.gridX === view.map.player.gridX
        && tile.gridZ === view.map.player.gridZ)
      expect(occupied).toMatchObject(site.kind === 'dig' ? { hasDigSite: true } : { hasRouteSite: true })
      const mapHtml = renderToStaticMarkup(createElement(WizardMap, { projection: view, open: true,
        onToggle: () => {}, onIntent: () => {}, buttonRef: createRef<HTMLButtonElement>(),
        closeRef: createRef<HTMLButtonElement>() }))
      const occupiedMarkup = mapHtml.match(new RegExp(
        `aria-label="${occupied!.id}:[^"]*${site.kind === 'dig' ? ', dig site' : ', route build site'}"[^>]*><b[^>]*>▲</b><small[^>]*>([^<]*)</small>`))
      expect(occupiedMarkup?.[1]).toBe(site.kind === 'dig' ? '⌄' : '◇')
    }
  })

  it('updates nearby work membership across the 16 m boundary within one 4 m tile', () => {
    const site = resolveTerrainWorkSite('greenway-alpha', 'tile--64-76')!
    if (site.kind !== 'dig') throw new Error('Missing canonical dig')
    let position = { x: site.center.x + 15.8, y: site.center.y, z: site.center.z }
    const nearby = { nearbyCandidates: () => Math.hypot(position.x - site.center.x,
      position.z - site.center.z) <= 16 ? [site] : [] }
    const gridX = (x: number) => Math.ceil(x / 4 - 0.5)
    expect(streamedTrialCandidates(nearby, position).map((candidate) => candidate.id)).toEqual([site.id])
    const firstGrid = gridX(position.x)
    position = { ...position, x: site.center.x + 16.2 }
    expect(gridX(position.x)).toBe(firstGrid)
    expect(streamedTrialCandidates(nearby, position)).toEqual([])
  })

  it('projects effective dug ground and an accessible, explicitly unsaved work choice', () => {
    const trial = streamedPreviewRuntimeForSearch('?devRegion=streamed&trial=works&spawn=works-dig', true).trial!
    const id = 'tile--64-76'
    const chosen = trial.nearbyCandidates().find((site) => site.id === id)!
    if (chosen.kind !== 'dig') throw new Error('Missing canonical dig')
    const trialView = { kit: trial.trialState.kit, bootsEquipped: trial.bootsEquipped,
      candidates: [{ site: chosen, rejection: trial.preview(id).rejection }],
      selectedId: id, selectedSite: chosen, selectedRejection: null,
      builtSites: trial.builtSites() }
    const before = streamedProjection(trial, trial.state, [], false, trialView)
    const html = renderToStaticMarkup(createElement(WizardHud,
      { projection: before, onIntent: () => {} }))
    expect(html).toContain('aria-label="Unsaved terrain-work trial"')
    expect(html).toContain(`Select Loam dig ${id}`)
    expect(html).toContain('Confirm Loam dig')
    expect(html).toContain('+1 stone, 30 Excavation XP, lowered ground')
    expect(html).toContain('Equip trial boots')
    expect(html).toContain('Barefoot means walking only')
    expect(html).toContain('Stone helps build a field camp in the full game')
    expect(html).toContain(`x ${chosen.center.x}, z ${chosen.center.z}`)
    expect(html).toContain('Each restart reloads and resets all UNSAVED works')
    expect(html).toContain('The 12-log kit cannot build two eight-log bridges')
    expect(html).toContain('A bridge crosses shallow Fen water; a ladder climbs the slate cliff')
    expect(html).toContain('href="?devRegion=streamed&amp;trial=works&amp;spawn=works-ladder"')
    expect(html).toContain('>Restart at bridge (UNSAVED reset)</a>')
    expect(html).toContain('>Restart at ladder (UNSAVED reset)</a>')
    expect(html).toContain('>Restart at dig (UNSAVED reset)</a>')
    expect(html).toContain('min-height:44px')
    expect(before.map.guidance).toContain('discovered dig site')
    expect(before.map.guidance).toContain('Only completed crossings can be walked')
    expect(before.map.tiles.find((tile) => tile.id === id)?.elevationMeters).toBeUndefined()
    expect(trial.confirm(id).event?.type).toBe('terrain_work_dug')
    const after = streamedProjection(trial, trial.state, [], false, undefined, trial.trialState.dugTileIds)
    expect(after.map.tiles.find((tile) => tile.id === id)?.elevationMeters)
      .toBe(trial.tileAtWorld(chosen.center.x, chosen.center.z)?.center.y)
    expect(after.terrain.find((cell) => cell.id === id)?.position[1])
      .toBe(after.map.tiles.find((tile) => tile.id === id)?.elevationMeters)
  })

  it('guides nearby built ladder ascent and descent without exposing unbuilt, distant or ordinary sites', () => {
    const seed = 'greenway-alpha'
    const west = resolveTerrainWorkSite(seed, 'works1:ladder:-103:108:W')!
    const south = resolveTerrainWorkSite(seed, 'works1:ladder:-100:108:S')!
    if (west.kind !== 'ladder' || south.kind !== 'ladder') throw new Error('Missing canonical ladders')
    const renderAt = (trial: ReturnType<typeof createStreamedTerrainWorkTrial>,
      position: { x: number; y: number; z: number }) => {
      const state = { ...trial.state, player: { ...trial.state.player, position } }
      const projection = streamedProjection(trial, state, [], false, {
        kit: trial.trialState.kit, bootsEquipped: trial.bootsEquipped,
        candidates: [], selectedId: null, selectedSite: null,
        selectedRejection: null, builtSites: trial.builtSites(),
      })
      return renderToStaticMarkup(createElement(WizardHud, { projection, onIntent: () => {} }))
    }
    const westTrial = createStreamedTerrainWorkTrial(seed, west.from)
    expect(renderAt(westTrial, west.from)).not.toContain('Built Slate ladder:')
    expect(westTrial.confirm(west.id).event?.type).toBe('terrain_work_built')
    for (const foot of [west.from, west.to]) {
      const html = renderAt(westTrial, foot)
      expect(html).toContain('Built Slate ladder:')
      expect(html).toContain(`lower foot x ${west.from.x}, z ${west.from.z}, face west, then move forward with W to climb`)
      expect(html).toContain(`upper foot x ${west.to.x}, z ${west.to.z}, face east, then move forward with W to descend`)
      expect(html).toContain('Stay centered near z 432 (ladder width 1.05 m)')
    }
    expect(renderAt(westTrial, { ...west.from, x: west.from.x + 8 })).not.toContain('Built Slate ladder:')

    const southTrial = createStreamedTerrainWorkTrial(seed, south.from)
    expect(southTrial.confirm(south.id).event?.type).toBe('terrain_work_built')
    for (const foot of [south.from, south.to]) {
      const html = renderAt(southTrial, foot)
      expect(html).toContain('face south, then move forward with W to climb')
      expect(html).toContain('face north, then move forward with W to descend')
      expect(html).toContain('Stay centered near x -400 (ladder width 1.05 m)')
    }
    const ordinary = createStreamedWorld(seed)
    expect(renderToStaticMarkup(createElement(WizardHud,
      { projection: streamedProjection(ordinary, ordinary.state, []), onIntent: () => {} })))
      .not.toContain('Built Slate ladder:')
  })

  it('visibly distinguishes discovered Slate ladder choices sharing one lower foot', () => {
    const seed = 'greenway-alpha'
    const west = resolveTerrainWorkSite(seed, 'works1:ladder:-103:108:W')!
    const south = resolveTerrainWorkSite(seed, 'works1:ladder:-103:108:S')!
    if (west.kind !== 'ladder' || south.kind !== 'ladder') throw new Error('Missing canonical ladder pair')
    expect(west.from).toEqual(south.from)
    const trial = createStreamedTerrainWorkTrial(seed, west.from)
    const choices = [west, south].map((site) => ({ site, rejection: trial.preview(site.id).rejection }))
    const projection = streamedProjection(trial, trial.state, [], false, {
      kit: trial.trialState.kit, bootsEquipped: trial.bootsEquipped,
      candidates: choices, selectedId: null,
      selectedSite: null, selectedRejection: null, builtSites: [],
    })
    expect(projection.terrainWorkTrial?.candidates.map(({ site }) => site.id)).toEqual([west.id, south.id])
    const html = renderToStaticMarkup(createElement(WizardHud, { projection, onIntent: () => {} }))
    const cardFor = (id: string) => html.match(new RegExp(
      `aria-label="Select Slate ladder ${id}"[^>]*>([\\s\\S]*?)<\\/button>`))?.[1]
    const westCard = cardFor(west.id), southCard = cardFor(south.id)
    expect(westCard).not.toEqual(southCard)
    expect(westCard).toContain(`Climbs west to upper foot x ${west.to.x}, z ${west.to.z}`)
    expect(southCard).toContain(`Climbs south to upper foot x ${south.to.x}, z ${south.to.z}`)
    const fogged = streamedProjection(trial, { ...trial.state, discoveredTileIds: [] }, [], false, {
      kit: trial.trialState.kit, bootsEquipped: trial.bootsEquipped,
      candidates: choices, selectedId: null,
      selectedSite: null, selectedRejection: null, builtSites: [],
    })
    expect(fogged.terrainWorkTrial?.candidates).toEqual([])
    const foggedHtml = renderToStaticMarkup(createElement(WizardHud, { projection: fogged, onIntent: () => {} }))
    expect(foggedHtml).not.toContain('Climbs west to upper foot')
    expect(foggedHtml).not.toContain('Climbs south to upper foot')
  })

  it('does not turn distant or fogged work into map or HUD directions, and leaves non-trial UI unchanged', () => {
    const trial = streamedPreviewRuntimeForSearch('?devRegion=streamed&trial=works', true).trial!
    const ladder = resolveTerrainWorkSite('greenway-alpha', 'works1:ladder:-103:108:W')!
    const bridge = resolveTerrainWorkSite('greenway-alpha', 'works1:bridge:-102:92:z')!
    if (ladder.kind !== 'ladder' || bridge.kind !== 'bridge') throw new Error('Missing trial fixtures')
    expect(trial.state.discoveredTileIds).not.toContain(ladder.footprintTileIds[1])
    const trialView = { kit: trial.trialState.kit, bootsEquipped: trial.bootsEquipped,
      candidates: [{ site: ladder, rejection: null }, { site: bridge, rejection: null }],
      selectedId: null, selectedSite: null, selectedRejection: null, builtSites: [] }
    const nearby = streamedProjection(trial, trial.state, [], false, trialView)
    expect(nearby.terrainWorkTrial?.candidates.map(({ site }) => site.id)).toEqual([bridge.id])
    expect(nearby.map.guidance).toContain(`discovered bridge site at x ${bridge.from.x}, z ${bridge.from.z}`)
    expect(nearby.map.guidance).not.toContain(`x ${ladder.from.x}, z ${ladder.from.z}`)
    const shifted = { ...trial.state, player: { ...trial.state.player,
      position: { ...trial.state.player.position, x: bridge.from.x - 8, z: bridge.from.z + 8 } } }
    const shiftedView = streamedProjection(trial, shifted, [], false, trialView)
    expect(shiftedView.map.guidance).toContain('(NE, 11 m on the map)')
    expect(renderToStaticMarkup(createElement(WizardHud,
      { projection: shiftedView, onIntent: () => {} }))).toContain(`NE · 11 m on map · x ${bridge.from.x}, z ${bridge.from.z}`)
    const noKnownSite = streamedProjection(trial, trial.state, [], false,
      { ...trialView, candidates: [{ site: ladder, rejection: null }] })
    expect(noKnownSite.terrainWorkTrial?.candidates).toEqual([])
    expect(noKnownSite.map.guidance).toContain('no discovered work site within 16 m')
    expect(renderToStaticMarkup(createElement(WizardHud,
      { projection: noKnownSite, onIntent: () => {} }))).not.toContain(`x ${ladder.from.x}, z ${ladder.from.z}`)
    const fogged = streamedProjection(trial, { ...trial.state, discoveredTileIds: [] }, [], false,
      { ...trialView, candidates: [{ site: bridge, rejection: null }] })
    expect(fogged.terrainWorkTrial?.candidates).toEqual([])
    expect(fogged.map.guidance).not.toContain(`x ${bridge.from.x}, z ${bridge.from.z}`)

    const ordinary = createStreamedWorld('greenway-alpha')
    const ordinaryView = streamedProjection(ordinary, ordinary.state, [])
    expect(ordinaryView.map.guidance).toBeUndefined()
    expect(ordinaryView.terrainWorkTrial).toBeUndefined()
    expect(renderToStaticMarkup(createElement(WizardHud,
      { projection: ordinaryView, onIntent: () => {} }))).not.toContain('Restart at ladder')
  })

  it('limits the atlas to 17 by 17 local cells at origin and across a Mireglass chunk crossing', () => {
    const origin = createStreamedWorld('preview-map')
    const originMap = streamedProjection(origin, origin.state, []).map
    expect(originMap.title).toBe('Streamed terrain local atlas (unsaved preview)')
    expect(originMap.legend).toBe(PREVIEW_MAP_LEGEND)
    expect(originMap.tiles).toHaveLength(17 * 17)
    const originTile = origin.tileAtWorld(0, 0)!
    expect(originMap.player).toEqual({ gridX: originTile.gridX, gridZ: originTile.gridZ, yaw: 0 })
    expect(originMap.tiles.find((tile) => tile.id === origin.state.discoveredTileIds[0])?.discovered).toBe(true)
    expect(originMap.tiles.some((tile) => !tile.discovered && tile.terrain === null && tile.biome === null)).toBe(true)

    const mireglass = createStreamedWorld('preview-map', { x: -320, z: 288 })
    const beforeChunks = mireglass.activeChunkCoordinates()
    const before = streamedProjection(mireglass, mireglass.state, []).map
    expect(before.title).toBe('Mireglass Reach local atlas (unsaved preview)')
    expect(before.tiles).toHaveLength(17 * 17)

    const crossed = mireglass.advance([{ type: 'move', delta: { x: -4, z: 0 } }])
    expect(crossed.rejections).toEqual([])
    expect(mireglass.activeChunkCoordinates()).not.toEqual(beforeChunks)
    const after = streamedProjection(mireglass, crossed.state, []).map
    expect(after.title).toBe(before.title)
    expect(after.tiles).toHaveLength(17 * 17)
    for (const map of [before, after]) {
      expect(new Set(map.tiles.map((tile) => tile.gridX)).size).toBe(17)
      expect(new Set(map.tiles.map((tile) => tile.gridZ)).size).toBe(17)
    }
    expect(after.player.gridX).toBe(before.player.gridX - 1)
    expect(Math.min(...after.tiles.map((tile) => tile.gridX))).toBe(Math.min(...before.tiles.map((tile) => tile.gridX)) - 1)
    expect(mireglass.activeChunkCount()).toBe(9)
  })

  it('labels only positions inside the Mireglass core as Mireglass', () => {
    expect(streamedMapTitle(MIREGLASS_DEV_SPAWN)).toBe('Mireglass Reach local atlas (unsaved preview)')
    expect(streamedMapTitle({ x: 0, z: 0 })).toBe('Streamed terrain local atlas (unsaved preview)')
    expect(streamedMapTitle({ x: -256, z: 288 })).toBe('Streamed terrain local atlas (unsaved preview)')
  })

  it('tags only authored Mireglass terrain and one adjacent wetland rim for bounded visual detail', () => {
    expect(mireglassVisualTerrainAt({ x: -448, z: 256 }, 'loam')).toBe('loam')
    expect(mireglassVisualTerrainAt({ x: -260, z: 508 }, 'rocky')).toBe('rocky')
    for (const point of [{ x: -452, z: 320 }, { x: -256, z: 320 }, { x: -400, z: 512 }]) {
      expect(mireglassVisualTerrainAt(point, 'wetland')).toBe('wetland')
      expect(mireglassVisualTerrainAt(point, 'loam')).toBeUndefined()
    }
    for (const point of [{ x: -456, z: 320 }, { x: -252, z: 320 }, { x: -400, z: 516 }, { x: 0, z: 0 }]) {
      expect(mireglassVisualTerrainAt(point, 'wetland')).toBeUndefined()
    }

    const runtime = createStreamedWorld('preview-map', MIREGLASS_DEV_SPAWN)
    const projection = streamedProjection(runtime, runtime.state, [])
    expect(visibleTerrainCells(projection.terrain, projection.player.position)).toHaveLength(17 * 17)
    for (const cell of projection.terrain) {
      const source = runtime.tileAtWorld(cell.position[0], cell.position[2])!
      expect(cell.mireglassTerrain).toBe(mireglassVisualTerrainAt(source.center, source.terrain))
    }
    expect(projection.terrain.some((cell) => cell.mireglassTerrain === 'wetland')).toBe(true)
    expect(projection.terrain.find((cell) => cell.mireglassTerrain === 'wetland')?.color).toBe('#385b57')
  })

  it('maps W and S to facing-relative movement and A and D to pivot intents', () => {
    const forward = streamedControlIntents(0, [0, 1])
    expect(forward).toHaveLength(1)
    expect(forward[0]).toMatchObject({ type: 'move', delta: { z: -0.16 } })
    if (forward[0]?.type !== 'move') throw new Error('Expected movement intent')
    expect(forward[0].delta.x).toBeCloseTo(0)

    const backward = streamedControlIntents(0, [0, -1])
    expect(backward).toHaveLength(1)
    expect(backward[0]).toMatchObject({ type: 'move', delta: { z: 0.16 } })
    expect(streamedControlIntents(0, [-1, 0])).toEqual([{ type: 'look', yawDelta: 0.13, pitchDelta: 0 }])
    expect(streamedControlIntents(0, [1, 0])).toEqual([{ type: 'look', yawDelta: -0.13, pitchDelta: 0 }])
    expect(streamedControlIntents(0, [0, 0])).toEqual([])
    const turnedForward = streamedControlIntents(-Math.PI / 2, [0, 1])
    expect(turnedForward[0]?.type).toBe('move')
    if (turnedForward[0]?.type !== 'move') throw new Error('Expected movement intent')
    expect(turnedForward[0].delta.x).toBeCloseTo(0.16)
    expect(turnedForward[0].delta.z).toBeCloseTo(0)
    expect(streamedControlIntents(0, [0, 1], 0.24)[0]).toMatchObject({ type: 'move', delta: { z: -0.24 } })
  })

  it('enables the Mireglass query spawn only in development', () => {
    expect(streamedStartForSearch('?spawn=mireglass', true)).toEqual(MIREGLASS_DEV_SPAWN)
    expect(streamedStartForSearch('?spawn=mireglass', false)).toBeUndefined()
    for (const [spawn, kind] of [['fen', 'bridge'], ['berm', 'ladder']] as const) {
      const position = streamedStartForSearch(`?spawn=${spawn}`, true)!
      const site = mireglassRouteSites('greenway-alpha').find((candidate) => candidate.kind === kind)!
      expect(position).toEqual({ x: site.from.x, z: site.from.z - 4 })
      expect(createStreamedWorld('greenway-alpha', position).tileAtWorld(position.x, position.z)?.terrain).toBe('loam')
      expect(streamedStartForSearch(`?spawn=${spawn}`, false)).toBeUndefined()
    }
    expect(streamedStartForSearch('?spawn=other', true)).toBeUndefined()
    expect(streamedStartForSearch('?campaign=mireglass', true)).toBeUndefined()
  })

  it('gates the ridge mouth, movement fact, and terrain tags to the development preview query', () => {
    const query = '?devRegion=streamed&spawn=ridge'
    expect(streamedStartForSearch(query, true)).toEqual(HIGHLAND_RIDGE_DEV_SPAWN)
    expect(streamedStartForSearch(query, false)).toBeUndefined()
    expect(streamedStartForSearch('?spawn=ridge', true)).toBeUndefined()
    const { runtime, ridgeActive } = streamedPreviewRuntimeForSearch(query, true)
    expect(ridgeActive).toBe(true)
    expect(runtime.state.player.position).toMatchObject(HIGHLAND_RIDGE_DEV_SPAWN)

    const plain = streamedProjection(runtime, runtime.state, [])
    expect(plain.highlandRidgeActive).toBeUndefined()
    expect(plain.terrain.every((cell) => !Object.hasOwn(cell, 'highlandRidgeCell'))).toBe(true)
    const ridge = streamedProjection(runtime, runtime.state, [], ridgeActive)
    const cellAt = (x: number, z: number) => ridge.terrain.find((cell) =>
      cell.position[0] === x && cell.position[2] === z)
    expect(ridge.highlandRidgeActive).toBe(true)
    expect(cellAt(560, -472)?.highlandRidgeCell).toBe('rock')
    expect(cellAt(560, -468)?.highlandRidgeCell).toBe('gallery')
    expect(cellAt(556, -472)?.highlandRidgeCell).toBeUndefined()
    expect(streamedProjection(runtime, runtime.state, []).terrain
      .every((cell) => !Object.hasOwn(cell, 'highlandRidgeCell'))).toBe(true)

    expect(runtime.advance([{ type: 'move', delta: { x: 4, z: 0 } }]).rejections).toEqual([])
    expect(runtime.advance([{ type: 'move', delta: { x: 4, z: 0 } }]).rejections).toEqual([])
    expect(runtime.advance([{ type: 'move', delta: { x: 0, z: -4 } }]).rejections)
      .toMatchObject([{ code: 'ridge_rock' }])

    for (const disabled of [streamedPreviewRuntimeForSearch(query, false),
      streamedPreviewRuntimeForSearch('?spawn=ridge', true),
      streamedPreviewRuntimeForSearch('?devRegion=streamed', true)]) {
      expect(disabled.ridgeActive).toBe(false)
      expect(disabled.runtime.state.player.position.x).toBe(0)
      expect(streamedProjection(disabled.runtime, disabled.runtime.state, [], disabled.ridgeActive)
        .highlandRidgeActive).toBeUndefined()
    }
  })

  it('starts the unsaved old-save visual simulation inside rock only on the development query', () => {
    const query = '?devRegion=streamed&spawn=ridge-recovery'
    expect(streamedStartForSearch(query, true)).toEqual(HIGHLAND_RIDGE_RECOVERY_DEV_SPAWN)
    expect(streamedStartForSearch(query, false)).toBeUndefined()
    expect(streamedStartForSearch('?spawn=ridge-recovery', true)).toBeUndefined()
    const { runtime, ridgeActive, ridgeRecovery } = streamedPreviewRuntimeForSearch(query, true)
    expect(runtime.state.player.position).toMatchObject(HIGHLAND_RIDGE_RECOVERY_DEV_SPAWN)
    expect(ridgeActive).toBe(true)
    expect(ridgeRecovery).toBe(true)
    const projection = streamedProjection(runtime, runtime.state, [], ridgeActive)
    expect(projection.highlandRidgeActive).toBe(true)
    expect(projection.terrain.find((cell) => cell.position[0] === 580
      && cell.position[2] === -500)?.highlandRidgeCell).toBe('rock')
    for (let step = 0; step < 5; step += 1) {
      expect(runtime.advance([{ type: 'move', delta: { x: 4, z: 0 } }]).rejections).toEqual([])
    }
    expect(runtime.state.player.position.x).toBe(600)
    expect(runtime.advance([{ type: 'move', delta: { x: -4, z: 0 } }]).rejections)
      .toMatchObject([{ code: 'ridge_rock' }])

    for (const disabled of [streamedPreviewRuntimeForSearch(query, false),
      streamedPreviewRuntimeForSearch('?spawn=ridge-recovery', true)]) {
      expect(disabled.ridgeActive).toBe(false)
      expect(disabled.ridgeRecovery).toBe(false)
      expect(disabled.runtime.state.player.position.x).toBe(0)
    }
    expect(streamedPreviewRuntimeForSearch('?devRegion=streamed&spawn=ridge', true)
      .ridgeRecovery).toBe(false)
  })
})
