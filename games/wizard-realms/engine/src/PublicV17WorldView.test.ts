import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { enumeratePublicV16GreenwaySites, publicWorldV16TileAtGrid } from './domain/publicWorldV16GreenwaySites'
import { confirmPublicV17GreenwayWork } from './domain/publicWorldV17GreenwayWork'
import { placementId, resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { createPublicV17ContinuousSession } from './domain/publicWorldV17ContinuousSession'
import { createFreshPublicV17Head, encodePublicV17Head } from './domain/publicWorldV17Snapshot'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { resolvePublicV14Surface } from './domain/publicWorldV14Terrain'
import type { PublicV17Progress } from './domain/publicWorldV17Validation'
import { decodePublicV17Progress } from './domain/publicWorldV17Validation'
import { publicWorldV17ViewProjection } from './PublicV17WorldView'
import type { PublicV17ActiveView } from './PublicV17WorldView'
import { WizardHud } from './view/WizardHud'
import { WizardMap } from './view/WizardMap'
import { savedTerrainWorkMarkers, savedTerrainWorkVisuals, TerrainWorkStructure } from './view/WizardScene'
import { savedWorkKeyboardIntent } from './view/WizardSurface'
import { PUBLIC_VISUAL_RADIUS_CELLS, visibleTerrainCells } from './view/visibleTerrain'
import * as visibleTerrain from './view/visibleTerrain'
import type { WizardViewProjection } from './view/contracts'

const seed = 'wizard-realms'
const fresh = (worldSeed = seed): PublicV17Progress => {
  const { head } = createFreshPublicV17Head(worldSeed)
  return { state: head.state, greenwayWorks: head.greenwayWorks }
}
const site = (kind: 'bridge' | 'ladder', aimX: number, worldSeed = seed) => {
  const id = placementId(kind, aimX)
  const found = id && resolvePublicV17GreenwaySite(worldSeed, id)
  if (!found || found.kind !== kind) throw new Error(`Missing ${kind} at ${aimX}`)
  return found
}
const reveal = (progress: PublicV17Progress, ids: readonly string[]): PublicV17Progress => ({
  ...progress, state: { ...progress.state,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(progress.state.discoveryMask), ...ids])].sort()) },
})
const logs = (progress: PublicV17Progress, quantity: number): PublicV17Progress => ({
  ...progress, state: { ...progress.state, player: { ...progress.state.player,
    inventory: [...progress.state.player.inventory, { itemId: 'logs', quantity }] } },
})
function at(progress: PublicV17Progress, x: number, z: number): PublicV17Progress {
  const { state, greenwayWorks } = progress
  const route = state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
  const support = publicV17StarterSupportAt({ seed: state.seed,
    profile: state.generationProfile, route,
    built: state.greenway.builtRouteIds.includes('greenway_ladder'), greenwayWorks },
  { x, z })
  if (!support) throw new Error('Unsupported test pose')
  return { ...progress, state: { ...state, player: { ...state.player,
    position: { x, y: support.floorY, z } } } }
}
const activeFor = (progress: PublicV17Progress): PublicV17ActiveView => ({
  movementOwner: progress.state.movementOwner, tick: progress.state.tick,
  player: structuredClone(progress.state.player), pendingBoundary: false,
  activeKnownTileIds: discoveredTileIdsInActiveWindow(progress.state.discoveryMask,
    progress.state.player.position),
  activeTiles: progress.state.greenway.tiles.map((tile) => publicWorldV16TileAtGrid(
    progress.state.seed, tile.gridX - 3, tile.gridZ - 3)),
})
const project = (progress: PublicV17Progress, kind: 'bridge' | 'ladder' | 'dig',
  aimX: number | null, modeActive = true) => publicWorldV17ViewProjection(progress, activeFor(progress), [], null,
  null, false, { kind, bodyYaw: Math.PI, aimX, modeActive, actionsEnabled: true })

describe('v17 Greenway aimed Works view', () => {
  it('preserves complete map projections across fresh, partial, built, and dug states', () => {
    const bridge = site('bridge', 0)
    const dig = resolvePublicV17GreenwaySite(seed, 'works3:dig:1:3')
    if (!dig || dig.kind !== 'dig') throw new Error('Missing canonical dig fixture')
    const builtBefore = logs(reveal(at(fresh(), bridge.from.x, 2),
      bridge.footprintTileIds), 8)
    const built = confirmPublicV17GreenwayWork(builtBefore, bridge.id).progress
    if (!built) throw new Error('Missing checked built bridge fixture')
    const base = fresh()
    const dug = { ...base, greenwayWorks: { ...base.greenwayWorks,
      dugTileIds: [dig.id] }, state: { ...base.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask), ...dig.footprintTileIds])].sort()),
      player: { ...base.state.player, xp: base.state.player.xp + 30,
        skillXp: { ...base.state.player.skillXp, excavation: 30 } } } }
    const views = {
      fresh: project(fresh(), 'bridge', null, false),
      partial: project(reveal(fresh(), bridge.footprintTileIds.slice(0, -1)),
        'bridge', bridge.from.x, false),
      built: project(built, 'bridge', null, false),
      dug: project(dug, 'dig', null, false),
    }
    for (const view of Object.values(views)) {
      expect(view.map.tiles.some((tile) => !tile.discovered)).toBe(true)
      expect(view.map.tiles.every((tile) => tile.discovered
        || (!tile.hasResource && !tile.hasWaystone && !tile.hasRouteSite
          && !tile.hasBuiltRoute && !tile.hasDigSite))).toBe(true)
    }
    expect(views.partial.savedTerrainWorks?.suggestedSites?.some((work) =>
      work.id === bridge.id)).toBe(false)
    expect(views.built.map.tiles.find((tile) => tile.id === bridge.footprintTileIds[1])
      ?.hasBuiltRoute).toBe(true)
    expect(views.dug.map.tiles.find((tile) => tile.id === dig.footprintTileIds[0])
      ?.elevationMeters).toBe(dig.loweredCenter.y)
    expect(views.dug.visualWorld?.terrain.find((tile) => tile.id === dig.footprintTileIds[0])
      ?.position[1]).toBe(dig.loweredCenter.y)
    expect(project(dug, 'dig', null, false).visualWorld?.terrain)
      .toBe(views.dug.visualWorld?.terrain)
    const digest = (view: WizardViewProjection) => {
      const json = JSON.stringify(view)
      let hash = 0xcbf29ce484222325n
      for (let index = 0; index < json.length; index++) {
        hash = (hash ^ BigInt(json.charCodeAt(index))) * 0x100000001b3n
          & 0xffffffffffffffffn
      }
      return `${json.length}:${hash.toString(16)}`
    }
    // Complete V17 projection content, including the canonical visual-only halo.
    expect(Object.fromEntries(Object.entries(views).map(([name, view]) =>
      [name, digest(view)]))).toEqual({
      fresh: '171344:16a0c70436d2fbfe',
      partial: '171341:1dfe0ce29fe6e209',
      built: '171786:17cc5013720080c5',
      dug: '171664:1a17e1fe38e6fe3b',
    })
  })

  it('keeps seeded ground continuous past the starter presentation seam without extending authority', () => {
    const start = fresh()
    const before = project(start, 'bridge', null, false)
    const seamTile = publicWorldV16TileAtGrid(seed, 9, 0)
    const shown = before.visualWorld!.terrain.find((cell) => cell.id === seamTile.id)
    expect(before.terrain.some((cell) => cell.id === seamTile.id)).toBe(false)
    expect(shown).toMatchObject({ position: [seamTile.center.x, seamTile.center.y,
      seamTile.center.z], climate: seamTile.biome })
    expect(shown?.position[1]).toBe(resolvePublicV14Surface(start.state,
      seamTile.center)?.terrainY)
    expect(before.visualWorld!.discoveredTileIds).not.toContain(seamTile.id)
    expect(before.visualWorld!.terrain).toHaveLength(23 * 23)

    const walked = at(start, 32, 0)
    const nearEdge = project(walked, 'bridge', null, false)
    expect(nearEdge.visualWorld!.terrain.some((cell) => cell.id === seamTile.id)).toBe(true)
    expect(nearEdge.visualWorld!.terrain).toHaveLength(23 * 23)
    expect(project(start, 'bridge', null, false).visualWorld!.terrain).toEqual(before.visualWorld!.terrain)

    const revealed = reveal(walked, [seamTile.id])
    const resumed = structuredClone(revealed)
    expect(project(resumed, 'bridge', null, false).visualWorld!.discoveredTileIds)
      .toContain(seamTile.id)
  })

  it('keeps cached dig geometry separate from the live projected site and discovery', () => {
    const dig = enumeratePublicV16GreenwaySites(seed, {
      minGX: -3, maxGX: 3, minGZ: 2, maxGZ: 4,
    }).find((entry) => entry.kind === 'dig')
    if (!dig || dig.kind !== 'dig') throw new Error('Missing Greenway dig fixture')
    const undiscovered = fresh()
    const discovered = reveal(undiscovered, dig.footprintTileIds)
    const projected = project(discovered, 'dig', null, false)
      .savedTerrainWorks?.suggestedSites?.find((entry) => entry.id === dig.id)
    if (!projected || projected.kind !== 'dig') throw new Error('Dig site not projected')
    ;(projected.center as { x: number }).x = 1_000_000
    ;(projected.footprintTileIds as string[])[0] = 'forged-tile'
    const repeated = project(discovered, 'dig', null, false)
      .savedTerrainWorks?.suggestedSites?.find((entry) => entry.id === dig.id)
    expect(repeated).toMatchObject({ center: dig.center,
      footprintTileIds: dig.footprintTileIds })
    const hidden = project(undiscovered, 'dig', null, false)
    expect(hidden.savedTerrainWorks?.suggestedSites?.some((entry) => entry.id === dig.id))
      .toBe(false)
  })

  it('offers two separated snapped sites per obstacle across seeds only after full discovery', () => {
    for (const worldSeed of [seed, 'greenway-alpha']) {
      const pairs = [
        [site('bridge', 0, worldSeed), site('bridge', 4.7, worldSeed)],
        [site('ladder', 1.1, worldSeed), site('ladder', -2.9, worldSeed)],
      ] as const
      for (const [first, second] of pairs) {
        expect(Math.abs(first.from.x - second.from.x)).toBeGreaterThanOrEqual(4)
        const partial = reveal(fresh(worldSeed), [
          ...first.footprintTileIds, ...second.footprintTileIds.slice(0, -1),
        ])
        expect(activeFor(partial).activeKnownTileIds).not.toContain(second.footprintTileIds.at(-1))
        const partialView = project(partial, first.kind, null, false)
        expect(partialView.savedTerrainWorks?.suggestedSites?.some((entry) => entry.id === second.id))
          .toBe(false)
        const full = reveal(partial, second.footprintTileIds)
        const fullView = project(full, first.kind, null, false)
        const suggestions = fullView.savedTerrainWorks?.suggestedSites ?? []
        expect(suggestions.map((entry) => entry.id)).toEqual(expect.arrayContaining([first.id, second.id]))
        expect(suggestions.filter((entry) => entry.id === first.id)).toHaveLength(1)
        expect(suggestions.filter((entry) => entry.id === second.id)).toHaveLength(1)
        const markers = savedTerrainWorkMarkers(fullView.savedTerrainWorks, fullView.terrain)
        expect(markers.filter((entry) => entry.id === first.id)).toHaveLength(1)
        expect(markers.filter((entry) => entry.id === second.id)).toHaveLength(1)
        expect(fullView.map.tiles.find((tile) => tile.id === second.footprintTileIds[1])?.hasRouteSite)
          .toBe(true)
      }
    }
  })

  it('keeps an unbuilt route cue after another site of the same kind is built', () => {
    for (const [kind, firstX, secondX, approachZ] of [
      ['bridge', 0, 4.7, 2], ['ladder', 1.1, -2.9, -3],
    ] as const) {
      const first = site(kind, firstX), second = site(kind, secondX)
      const progress = logs(reveal(at(fresh(), firstX, approachZ), [
        ...first.footprintTileIds, ...second.footprintTileIds,
      ]), first.logCost)
      const confirmed = confirmPublicV17GreenwayWork(progress, first.id)
      expect(confirmed.rejection).toBeUndefined()
      if (!confirmed.progress) continue
      const view = project(confirmed.progress, kind, null, false)
      expect(view.savedTerrainWorks?.builtSites.map((entry) => entry.id)).toContain(first.id)
      expect(view.savedTerrainWorks?.suggestedSites?.filter((entry) => entry.id === first.id))
        .toHaveLength(0)
      expect(view.savedTerrainWorks?.suggestedSites?.filter((entry) => entry.id === second.id))
        .toHaveLength(1)
      expect(savedTerrainWorkVisuals(view.savedTerrainWorks, view.terrain)
        .filter((entry) => entry.site.id === first.id && entry.built)).toHaveLength(1)
      expect(savedTerrainWorkMarkers(view.savedTerrainWorks, view.terrain)
        .filter((entry) => entry.id === second.id)).toHaveLength(1)
      expect(view.map.tiles.find((tile) => tile.id === first.footprintTileIds[1])?.hasBuiltRoute)
        .toBe(true)
      expect(view.map.tiles.find((tile) => tile.id === second.footprintTileIds[1])?.hasRouteSite)
        .toBe(true)
    }
  })

  it('suppresses only the site physically overlapping a nearby completed bridge', () => {
    const overlapping = site('bridge', 0.1), far = site('bridge', 4.7)
    const progress = logs(reveal(at(fresh(), 0.1, 2), [
      ...overlapping.footprintTileIds, ...far.footprintTileIds,
    ]), overlapping.logCost)
    const confirmed = confirmPublicV17GreenwayWork(progress, overlapping.id)
    expect(confirmed.rejection).toBeUndefined()
    if (!confirmed.progress) return
    const suggestions = project(confirmed.progress, 'bridge', null, false)
      .savedTerrainWorks?.suggestedSites ?? []
    expect(suggestions.some((entry) => entry.id === site('bridge', 0).id)).toBe(false)
    expect(suggestions.some((entry) => entry.id === far.id)).toBe(true)
  })

  it('omits a second discovered site when one footprint tile leaves the visual window', () => {
    const first = site('bridge', 0), second = site('bridge', 4.7)
    const select = visibleTerrainCells
    const spy = vi.spyOn(visibleTerrain, 'visibleTerrainCells').mockImplementation((cells, player, radius) =>
      select(cells, player, radius).filter((cell) => cell.id !== second.footprintTileIds[0]))
    try {
      const view = project(reveal(fresh(), [
        ...first.footprintTileIds, ...second.footprintTileIds,
      ]), 'bridge', null, false)
      expect(view.savedTerrainWorks?.suggestedSites?.some((entry) => entry.id === first.id))
        .toBe(true)
      expect(view.savedTerrainWorks?.suggestedSites?.some((entry) => entry.id === second.id))
        .toBe(false)
      expect(view.map.tiles.find((tile) => tile.id === second.footprintTileIds[1])?.hasRouteSite)
        .toBe(false)
      expect(savedTerrainWorkMarkers(view.savedTerrainWorks, view.terrain)
        .some((entry) => entry.id === second.id)).toBe(false)
    } finally { spy.mockRestore() }
  })

  it('projects every real jump frame but never accepts an airborne durable checkpoint or malformed view pose', () => {
    const { head, lineage } = createFreshPublicV17Head(seed)
    const session = createPublicV17ContinuousSession({ state: head.state,
      greenwayWorks: head.greenwayWorks, saveRevision: 0, lineage })
    expect(session.advanceFrame([{ type: 'jump' }], { walkRequested: true }).rejections).toEqual([])
    let airborneFrames = 0
    for (let frame = 0; frame < 32; frame++) {
      const progress = session.previewSnapshot()
      const active = session.view()
      expect(() => publicWorldV17ViewProjection(progress, active, [], null)).not.toThrow()
      if (progress.state.player.verticalVelocity === 0) break
      airborneFrames++
      expect(decodePublicV17Progress(progress, seed)).toBeNull()
      expect(session.snapshotForSave().status).toBe('deferred-airborne')
      expect(() => encodePublicV17Head(progress, 1, lineage)).toThrow()
      if (airborneFrames === 1) {
        const player = progress.state.player
        const malformed = [
          { ...player, position: { ...player.position, y: player.position.y - 100 } },
          { ...player, position: { ...player.position, y: player.position.y + 100 } },
          { ...player, position: { ...player.position, x: 1_000_000 } },
          { ...player, verticalVelocity: Number.POSITIVE_INFINITY },
          { ...player, verticalVelocity: 6 },
          { ...player, verticalVelocity: -51 },
          { ...player, verticalVelocity: 0 },
        ]
        for (const forgedPlayer of malformed) {
          const forged = { ...progress, state: { ...progress.state, player: forgedPlayer } }
          expect(() => publicWorldV17ViewProjection(forged, activeFor(forged), [], null)).toThrow()
        }
      }
      expect(session.advanceFrame([], { walkRequested: true }).rejections).toEqual([])
    }
    expect(airborneFrames).toBeGreaterThan(1)
    expect(session.snapshotForSave().status).toBe('ready')
    expect(decodePublicV17Progress(session.previewSnapshot(), seed)).not.toBeNull()
  })

  it('keeps the route key after the expanded grid and reveals exact work positions only after discovery', () => {
    const markup = (progress: PublicV17Progress, kind: 'bridge' | 'ladder' | 'dig', aimX: number | null,
      modeActive = true) =>
      renderToStaticMarkup(createElement(WizardMap, {
        projection: project(progress, kind, aimX, modeActive), open: true,
        onToggle: () => {}, onIntent: () => {},
        buttonRef: { current: null }, closeRef: { current: null },
      }))
    const key = (html: string) => html.match(/<section class="wr-map-route-key"[^>]*>.*?<\/section>/)?.[0] ?? ''
    const status = (html: string, name: string) =>
      key(html).match(new RegExp(`<li><b>${name}</b>.*?<small>(.*?)</small>`))?.[1] ?? ''
    const freshMap = markup(fresh(), 'bridge', 0)
    expect(freshMap.indexOf('aria-label="Greenway route key"')).toBeLessThan(freshMap.indexOf('class="wr-map-work-guide"'))
    const localMapStart = freshMap.indexOf('class="wr-map-local"')
    const expandedGrid = freshMap.indexOf('class="wr-map-grid"', localMapStart)
    expect(expandedGrid).toBeGreaterThan(localMapStart)
    expect(expandedGrid).toBeLessThan(freshMap.indexOf('aria-label="Greenway route key"'))
    expect(key(freshMap)).toContain('South creek · Bridge')
    expect(key(freshMap)).toContain('North cliff · Ladder')
    expect(key(freshMap)).toContain('Dry loam · Dig')
    expect(key(freshMap)).toContain('equipped field spade + free bag slot')
    expect(key(freshMap)).not.toContain('Discovered at x')

    const bridge = site('bridge', 0)
    const partial = markup(reveal(fresh(), bridge.footprintTileIds.slice(0, -1)), 'bridge', 0)
    expect(key(partial)).not.toContain('Discovered at x')
    const discovered = markup(logs(reveal(at(fresh(), 0, 2), bridge.footprintTileIds), 8), 'bridge', 0)
    expect(key(discovered)).toContain(`◇ Discovered at x ${bridge.from.x}, z ${bridge.from.z} · Ready`)
    const bridgeClosed = project(reveal(fresh(), bridge.footprintTileIds), 'bridge', 0, false)
    expect(bridgeClosed.savedTerrainWorks?.preview).toBeNull()
    expect(status(markup(reveal(fresh(), bridge.footprintTileIds), 'bridge', 0, false), 'South creek · Bridge'))
      .toBe(`◇ Discovered candidate at x ${bridge.from.x}, z ${bridge.from.z} · Aim in Works to inspect.`)
    expect(status(markup(reveal(fresh(), bridge.footprintTileIds), 'ladder', 0), 'South creek · Bridge'))
      .toBe(`◇ Discovered candidate at x ${bridge.from.x}, z ${bridge.from.z} · Aim in Works to inspect.`)

    const ladder = site('ladder', 1.1)
    const ladderProgress = reveal(fresh(), ladder.footprintTileIds)
    const ladderClosed = project(ladderProgress, 'ladder', ladder.from.x, false)
    expect(ladderClosed.savedTerrainWorks?.preview).toBeNull()
    expect(status(markup(ladderProgress, 'ladder', ladder.from.x, false), 'North cliff · Ladder'))
      .toBe(`◇ Discovered candidate at x ${ladder.from.x}, z ${ladder.from.z} · Aim in Works to inspect.`)
    expect(status(markup(ladderProgress, 'bridge', ladder.from.x), 'North cliff · Ladder'))
      .toBe(`◇ Discovered candidate at x ${ladder.from.x}, z ${ladder.from.z} · Aim in Works to inspect.`)

    const starterOnly = renderToStaticMarkup(createElement(WizardMap, {
      projection: { ...ladderClosed, starterCliff: { ...ladderClosed.starterCliff!, ladder: 'built' } },
      open: true, onToggle: () => {}, onIntent: () => {},
      buttonRef: { current: null }, closeRef: { current: null },
    }))
    expect(status(starterOnly, 'North cliff · Ladder'))
      .toBe(`◇ Discovered candidate at x ${ladder.from.x}, z ${ladder.from.z} · Aim in Works to inspect.`)

    const dig = enumeratePublicV16GreenwaySites(seed, {
      minGX: -3, maxGX: 3, minGZ: 2, maxGZ: 4,
    }).find((entry) => entry.kind === 'dig')
    if (!dig) throw new Error('Missing Greenway dig fixture')
    const knownDig = markup(reveal(fresh(), dig.footprintTileIds), 'bridge', null)
    expect(key(knownDig)).toContain(`⌄ Discovered at x ${dig.center.x}, z ${dig.center.z}`)
  })

  it('shows only fully discovered unsaved structure and dig markers without enabling confirmation', () => {
    const bridge = site('bridge', 0), ladder = site('ladder', 1.1)
    const dig = enumeratePublicV16GreenwaySites(seed, {
      minGX: -3, maxGX: 3, minGZ: 2, maxGZ: 4,
    }).find((entry) => entry.kind === 'dig')
    if (!dig) throw new Error('Missing Greenway dig fixture')
    const initial = project(fresh(), 'bridge', null, false)
    for (const suggested of initial.savedTerrainWorks?.suggestedSites ?? []) {
      expect(suggested.footprintTileIds.every((id) =>
        initial.visualWorld?.discoveredTileIds.includes(id))).toBe(true)
    }
    expect(initial.savedTerrainWorks?.suggestedSites?.some((entry) => entry.id === bridge.id)).toBe(false)
    expect(initial.savedTerrainWorks?.suggestedSites?.some((entry) => entry.id === ladder.id)).toBe(true)
    expect(savedWorkKeyboardIntent('KeyF', initial.savedTerrainWorks)).toBeNull()
    expect(savedTerrainWorkMarkers(initial.savedTerrainWorks, initial.terrain)
      .some((marker) => marker.id === bridge.id)).toBe(false)
    expect(savedTerrainWorkMarkers(initial.savedTerrainWorks,
      initial.terrain.filter(({ id }) => id !== ladder.footprintTileIds[0]))
      .some((marker) => marker.id === ladder.id)).toBe(false)
    const discovered = project(reveal(fresh(), [...bridge.footprintTileIds,
      ...ladder.footprintTileIds, ...dig.footprintTileIds]), 'bridge', null, false)
    expect(discovered.savedTerrainWorks?.preview).toBeNull()
    expect(discovered.savedTerrainWorks?.suggestedSites?.map((entry) => entry.id))
      .toEqual(expect.arrayContaining([bridge.id, ladder.id, dig.id]))
    expect(savedTerrainWorkMarkers(discovered.savedTerrainWorks, discovered.terrain)
      .map((marker) => marker.id)).toEqual(expect.arrayContaining([bridge.id, ladder.id, dig.id]))
    expect(discovered.map.tiles.find((tile) => tile.id === bridge.footprintTileIds[1])?.hasRouteSite).toBe(true)
    expect(discovered.map.tiles.find((tile) => tile.id === ladder.footprintTileIds[1])?.hasRouteSite).toBe(true)
    expect(savedWorkKeyboardIntent('KeyF', discovered.savedTerrainWorks)).toBeNull()

    for (const structure of [bridge, ladder]) {
      const ready = logs(reveal(at(fresh(), structure.from.x,
        structure.kind === 'bridge' ? 2 : -3), structure.footprintTileIds), structure.logCost)
      const built = confirmPublicV17GreenwayWork(ready, structure.id)
      expect(built.rejection).toBeUndefined()
      if (!built.progress) continue
      const view = project(built.progress, structure.kind, null, false)
      expect(view.savedTerrainWorks?.suggestedSites?.some((entry) => entry.kind === structure.kind)).toBe(false)
      expect(savedTerrainWorkMarkers(view.savedTerrainWorks, view.terrain)
        .some((marker) => marker.kind === structure.kind)).toBe(false)
      expect(view.savedTerrainWorks?.builtSites.some((entry) => entry.id === structure.id)).toBe(true)
    }
  })

  it('drops a candidate marker when one footprint tile crosses the visual radius edge', () => {
    const bridge = site('bridge', 0)
    const view = project(reveal(fresh(), bridge.footprintTileIds), 'bridge', null, false)
    const footprint = bridge.footprintTileIds.map((id) => {
      const match = /^tile-(-?\d+)-(-?\d+)$/.exec(id)
      if (!match) throw new Error('Bad tile fixture')
      return { id, position: [(Number(match[1]) - 3) * 4, 0,
        (Number(match[2]) - 3) * 4] as const, size: [4, 4] as const } as WizardViewProjection['terrain'][number]
    })
    const edge = Array.from({ length: 81 }, (_, index) => ({
      id: `zzedge-${index}`, position: [0, 0, (index - 40) * 4] as const,
      size: [4, 4] as const,
    } as WizardViewProjection['terrain'][number]))
    const all = [...footprint, ...edge]
    const near = visibleTerrainCells(all, [0, 0, 60], PUBLIC_VISUAL_RADIUS_CELLS)
    const clipped = visibleTerrainCells(all, [0, 0, 64], PUBLIC_VISUAL_RADIUS_CELLS)
    expect(savedTerrainWorkMarkers(view.savedTerrainWorks, near).map(({ id }) => id)).toContain(bridge.id)
    expect(clipped.some(({ id }) => id === bridge.footprintTileIds[0])).toBe(false)
    expect(savedTerrainWorkMarkers(view.savedTerrainWorks, clipped)
      .some(({ id }) => id === bridge.id)).toBe(false)
  })

  it('keeps an aimed site actionable but omits its map marker and coordinates at a clipped visual edge', () => {
    const bridge = site('bridge', 0)
    const select = visibleTerrainCells
    const spy = vi.spyOn(visibleTerrain, 'visibleTerrainCells').mockImplementation((cells, player, radius) =>
      select(cells, player, radius).filter((cell) => cell.id !== bridge.footprintTileIds[0]))
    try {
      const view = project(logs(reveal(at(fresh(), 0, 2), bridge.footprintTileIds), 8), 'bridge', 0)
      expect(view.terrain.some((cell) => cell.id === bridge.footprintTileIds[0])).toBe(false)
      expect(view.savedTerrainWorks?.preview?.selected).toMatchObject({
        site: { id: bridge.id }, rejection: null,
      })
      expect(savedWorkKeyboardIntent('KeyF', view.savedTerrainWorks))
        .toEqual({ type: 'saved-work.confirm', id: bridge.id })
      expect(view.map.tiles.find((tile) => tile.id === bridge.footprintTileIds[1])?.hasRouteSite).toBe(false)
      expect(savedTerrainWorkMarkers(view.savedTerrainWorks, view.terrain)
        .some((marker) => marker.id === bridge.id)).toBe(false)
      const html = renderToStaticMarkup(createElement(WizardMap, {
        projection: view, open: true, onToggle: () => {}, onIntent: () => {},
        buttonRef: { current: null }, closeRef: { current: null },
      }))
      const key = html.match(/<section class="wr-map-route-key"[^>]*>.*?<\/section>/)?.[0] ?? ''
      expect(key).not.toContain(`Discovered at x ${bridge.from.x}, z ${bridge.from.z}`)
    } finally { spy.mockRestore() }
  })

  it('snaps one desired creek X, follows a second aim, and enables F only at checked ready sites', () => {
    const a = site('bridge', 0), b = site('bridge', 0.1)
    const progress = logs(reveal(at(fresh(), 0, 2),
      [...a.footprintTileIds, ...b.footprintTileIds]), 8)
    const before = structuredClone(progress)
    const first = project(progress, 'bridge', 0.01)
    const second = project(progress, 'bridge', 0.11)
    expect(first.savedTerrainWorks?.context).toBe('works4-greenway')
    expect(first.savedTerrainWorks?.preview?.selected).toMatchObject({
      site: { id: a.id, from: { x: 0 } }, rejection: null })
    expect(second.savedTerrainWorks?.preview?.selected).toMatchObject({
      site: { id: b.id, from: { x: 0.1 } }, rejection: null })
    expect(first.savedTerrainWorks?.preview?.nearby).toHaveLength(1)
    expect(second.savedTerrainWorks?.preview?.nearby).toHaveLength(1)
    expect(savedWorkKeyboardIntent('KeyF', first.savedTerrainWorks))
      .toEqual({ type: 'saved-work.confirm', id: a.id })
    expect(savedWorkKeyboardIntent('KeyF', second.savedTerrainWorks))
      .toEqual({ type: 'saved-work.confirm', id: b.id })
    expect(savedTerrainWorkVisuals(first.savedTerrainWorks, first.terrain))
      .toMatchObject([{ site: { id: a.id }, built: false, blocked: false }])
    expect(progress).toEqual(before)
  })

  it('renders blocked ghost and exact reason without offering keyboard confirmation', () => {
    const bridge = site('bridge', 0)
    const progress = reveal(at(fresh(), 0, 2), bridge.footprintTileIds)
    const view = project(progress, 'bridge', 0)
    expect(view.savedTerrainWorks?.preview?.selected).toMatchObject({
      site: { id: bridge.id }, rejection: 'not_owned',
      reason: 'Gather 8 logs.',
    })
    const [ghost] = savedTerrainWorkVisuals(view.savedTerrainWorks, view.terrain)
    expect(ghost).toMatchObject({ site: { id: bridge.id }, built: false, blocked: true })
    expect(renderToStaticMarkup(createElement(TerrainWorkStructure, {
      site: ghost.site, built: ghost.built, blocked: ghost.blocked,
    }))).toContain('blocked preview')
    expect(savedWorkKeyboardIntent('KeyF', view.savedTerrainWorks)).toBeNull()
    const hud = renderToStaticMarkup(createElement(WizardHud, {
      projection: view, onIntent: () => {},
    }))
    expect(hud).toContain('aria-label="Structure position along obstacle"')
    expect(hud).toContain('aria-label="Use avatar facing"')
    expect(hud).toContain('Gather 8 logs.')
    expect(hud).toContain('disabled="" aria-label="Confirm selected saved work"')
  })

  it('never displays or confirms a partly undiscovered footprint, even across two columns', () => {
    const bridge = site('bridge', 1.2)
    expect(bridge.footprintTileIds.length).toBe(10)
    const revealed = logs(reveal(at(fresh(), bridge.from.x, 2),
      bridge.footprintTileIds.slice(0, -1)), 8)
    const view = project(revealed, 'bridge', bridge.from.x)
    expect(view.savedTerrainWorks?.preview?.selected).toBeNull()
    expect(view.savedTerrainWorks?.preview?.guidance)
      .toContain('Discover both ends')
    expect(savedTerrainWorkVisuals(view.savedTerrainWorks, view.terrain)).toEqual([])
    expect(savedWorkKeyboardIntent('KeyF', view.savedTerrainWorks)).toBeNull()
    expect(view.map.tiles.some((tile) => !tile.discovered && tile.hasRouteSite)).toBe(false)
  })

  it('shows an upright ladder, keeps built works4 support, and teaches digging and stone sales', () => {
    const ladder = site('ladder', 1.1)
    const prepared = logs(reveal(at(fresh(), ladder.from.x, -3),
      ladder.footprintTileIds), 4)
    const before = project(prepared, 'ladder', ladder.from.x)
    expect(before.savedTerrainWorks?.preview?.selected?.site).toMatchObject({
      id: ladder.id, kind: 'ladder', supportPath: ladder.supportPath,
    })
    expect(before.savedTerrainWorks?.preview?.selected?.rejection).toBeNull()
    const built = confirmPublicV17GreenwayWork(prepared, ladder.id)
    expect(built.rejection).toBeUndefined()
    if (!built.progress) return
    const after = project(built.progress, 'ladder', ladder.from.x)
    expect(after.savedTerrainWorks?.builtSites).toMatchObject([{ id: ladder.id,
      kind: 'ladder', supportPath: ladder.supportPath }])
    const map = renderToStaticMarkup(createElement(WizardMap, {
      projection: after, open: true, onToggle: () => {}, onIntent: () => {},
      buttonRef: { current: null }, closeRef: { current: null },
    }))
    expect(map).toContain('upright ladder')
    expect(map).toContain(`✓ Built at x ${ladder.from.x}, z ${ladder.from.z}`)
    expect(map).toContain('one stone and 30 Excavation XP')
    expect(map).toContain('sell the stone at Greenway Outfitters')
  })

  it('explains unsupported snapped positions and keeps the old Greenway dig sites', () => {
    const noBridge = project(fresh(), 'bridge', 100)
    expect(noBridge.savedTerrainWorks?.preview?.selected).toBeNull()
    expect(noBridge.savedTerrainWorks?.preview?.guidance).toContain('No supported bridge')
    const dig = project(fresh(), 'dig', null)
    expect(dig.savedTerrainWorks?.context).toBe('works4-greenway')
    expect(dig.map.guidance).toContain('8 logs')
  })
})
