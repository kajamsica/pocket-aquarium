import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { previewPublicV16GreenwayWork } from './domain/publicWorldV16GreenwayWork'
import { publicWorldV16TileAtGrid, resolvePublicV16GreenwaySite } from './domain/publicWorldV16GreenwaySites'
import type { PublicV16GreenwaySite } from './domain/publicWorldV16GreenwaySites'
import { publicV16StarterSupportAt } from './domain/publicWorldV16StarterMovement'
import { createFreshPublicV16Head } from './domain/publicWorldV16Snapshot'
import type { PublicV16Progress } from './domain/publicWorldV16Validation'
import { publicWorldV16ViewProjection } from './PublicV16WorldView'
import type { PublicV16ActiveView } from './PublicV16WorldView'
import { WizardHud } from './view/WizardHud'
import { WizardMap } from './view/WizardMap'
import { savedTerrainWorkVisuals } from './view/WizardScene'
import { savedWorkKeyboardIntent } from './view/WizardSurface'

const seed = 'wizard-realms'
const fresh = (worldSeed = seed): PublicV16Progress => {
  const { head } = createFreshPublicV16Head(worldSeed)
  return { state: head.state, greenwayWorks: head.greenwayWorks }
}
function site<T extends PublicV16GreenwaySite>(id: string, worldSeed = seed): T {
  const value = resolvePublicV16GreenwaySite(worldSeed, id)
  if (!value) throw new Error(`Missing site ${id}`)
  return value as T
}
function reveal(progress: PublicV16Progress, ids: readonly string[]): PublicV16Progress {
  return { ...progress, state: { ...progress.state,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(progress.state.discoveryMask), ...ids])].sort()) } }
}
function logs(progress: PublicV16Progress, quantity: number): PublicV16Progress {
  return { ...progress, state: { ...progress.state, player: { ...progress.state.player,
    inventory: [...progress.state.player.inventory, { itemId: 'logs', quantity }] } } }
}
function at(progress: PublicV16Progress, x: number, z: number): PublicV16Progress {
  const state = progress.state
  const route = state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
  const support = publicV16StarterSupportAt({ seed: state.seed,
    profile: state.generationProfile, route,
    built: state.greenway.builtRouteIds.includes('greenway_ladder'),
    greenwayWorks: progress.greenwayWorks }, { x, z })
  if (!support) throw new Error('Test pose is unsupported.')
  return { ...progress, state: { ...state, player: { ...state.player,
    position: { x, y: support.floorY, z } } } }
}
const activeFor = (progress: PublicV16Progress): PublicV16ActiveView => ({
  movementOwner: progress.state.movementOwner, tick: progress.state.tick,
  player: structuredClone(progress.state.player), pendingBoundary: false,
  activeKnownTileIds: discoveredTileIdsInActiveWindow(progress.state.discoveryMask,
    progress.state.player.position),
  activeTiles: progress.state.greenway.tiles.map((tile) => publicWorldV16TileAtGrid(
    progress.state.seed, tile.gridX - 3, tile.gridZ - 3)),
})
const project = (progress: PublicV16Progress, kind: 'bridge' | 'ladder' | 'dig' = 'bridge',
  bodyYaw = Math.PI) =>
  publicWorldV16ViewProjection(progress, activeFor(progress), [], null,
    null, false, { kind, bodyYaw, modeActive: true, actionsEnabled: true })

describe('v16 Greenway read model', () => {
  it('projects only the discovered canonical waystone and its studied state', () => {
    const progress = fresh()
    const canonical = progress.state.greenway.inscriptions.find((entry) =>
      entry.id === 'greenway_waystone')!
    const view = project(progress)
    expect(view.inscriptions).toEqual([{ id: canonical.id, name: canonical.name,
      position: [canonical.position.x, canonical.position.y, canonical.position.z],
      spellId: canonical.spellId, studied: false }])
    expect(view.visualWorld?.inscriptions).toEqual(view.inscriptions)
    expect(view.map.tiles.filter((tile) => tile.hasWaystone).map((tile) => tile.id))
      .toEqual(['tile-4-4'])
    expect(view.map.tiles.filter((tile) => !tile.discovered).every((tile) =>
      !tile.hasWaystone)).toBe(true)
    expect(view.map.legend).toContain('W waystone')

    const studied = { ...progress, state: { ...progress.state,
      greenway: { ...progress.state.greenway, studiedInscriptionIds: [canonical.id] },
      player: { ...progress.state.player, learnedSpellIds: ['wayfinder_glow' as const] } } }
    expect(project(studied).inscriptions[0]?.studied).toBe(true)
  })

  it('keeps the closed-map next step concise and the expanded guide tied to discovered sites', () => {
    const progress = fresh()
    const view = publicWorldV16ViewProjection(progress, activeFor(progress), [], null,
      null, false, { kind: 'bridge', bodyYaw: 0, modeActive: false, actionsEnabled: true })
    const hud = renderToStaticMarkup(createElement(WizardHud, {
      projection: view, onIntent: () => {},
    }))
    const map = renderToStaticMarkup(createElement(WizardMap, { projection: view,
      open: true, onToggle: () => {}, onIntent: () => {},
      buttonRef: { current: null }, closeRef: { current: null },
    }))
    expect(view.map.guidance).toContain('South of spawn')
    expect(view.map.guidance).toContain('8 logs')
    expect(hud).toContain(view.map.guidance)
    expect(map).toContain('B Works, then 1 Bridge, 2 Ladder, or 3 Dig')
    expect(map).toContain('press F when the selected preview says Ready')
    expect(map).toContain('limited to discovered obstacle sites')
    expect(map).toContain('freeform placement is a future system')
    expect(map).toContain('far-bank dry loam')
    expect(map).toContain('within 4 m')
    expect(map).toContain('one stone plus 30 Excavation XP')
    expect(map).toContain('Outfitters buys the stone')
    expect(map).toContain('fixed starter cliff ladder')
    expect(map).toContain('selected Works preview')
    expect(view.map.tiles.filter((tile) => !tile.discovered).every((tile) =>
      !tile.hasRouteSite && !tile.hasDigSite)).toBe(true)
  })

  it('shows current and next pace while boots permit the v16 Walk/Run toggle', () => {
    const initial = fresh()
    const progress = { ...initial, state: { ...initial.state, player: {
      ...initial.state.player,
      inventory: [...initial.state.player.inventory, { itemId: 'leather_boots' as const,
        quantity: 1 }],
      equipment: { ...initial.state.player.equipment, feet: 'leather_boots' as const },
    } } }
    const render = (walkRequested: boolean) => {
      const view = publicWorldV16ViewProjection(progress, activeFor(progress), [], null,
        null, walkRequested)
      return renderToStaticMarkup(createElement(WizardHud, {
        projection: view, onIntent: () => {},
      }))
    }
    expect(render(false)).toContain('Run now in leather boots; R or Walk/Run switches to Walk.')
    expect(render(true)).toContain('Walk now in leather boots; R or Walk/Run switches to Run.')
    expect(render(false)).toContain('aria-label="Toggle Walk/Run pace" aria-pressed="false"')
    const barefoot = renderToStaticMarkup(createElement(WizardHud, {
      projection: publicWorldV16ViewProjection(initial, activeFor(initial), [], null),
      onIntent: () => {},
    }))
    expect(barefoot).toContain('Walk now: barefoot walking only. Outfitters boots enable Run by default.')
    expect(barefoot).toContain('aria-label="Toggle Walk/Run pace" aria-pressed="true" disabled=""')
  })

  it('uses v16 bank terrain and keeps undiscovered candidates in fog', () => {
    const progress = fresh()
    const before = structuredClone(progress)
    const bridge = site<Extract<PublicV16GreenwaySite, { kind: 'bridge' }>>('works3:bridge:0')
    const active = activeFor(progress)
    expect(active.activeTiles).toHaveLength(256)
    expect(Math.max(...active.activeTiles.map((tile) => tile.gridX))
      - Math.min(...active.activeTiles.map((tile) => tile.gridX))).toBe(15)
    const view = publicWorldV16ViewProjection(progress, active, [], null,
      null, false, { kind: 'bridge', bodyYaw: Math.PI, modeActive: true })
    const bank = publicWorldV16TileAtGrid(seed, 0, 3)
    expect(view.map.tiles.find((tile) => tile.id === bank.id)?.terrain)
      .toBe(bank.terrain)
    expect(view.savedTerrainWorks?.preview?.nearby).toEqual([])
    expect(view.map.tiles.find((tile) => tile.id === bridge.footprintTileIds[1])?.hasRouteSite)
      .toBe(false)
    expect(view.map.tiles.filter((tile) => !tile.discovered).every((tile) =>
      tile.terrain === null && !tile.hasResource && !tile.hasDigSite)).toBe(true)
    expect(progress).toEqual(before)
  })

  it('rejects a duplicated canonical active tile even when the window still has 256 entries', () => {
    const progress = fresh()
    const active = activeFor(progress)
    const duplicate = [...active.activeTiles]
    duplicate[1] = duplicate[0]
    expect(() => publicWorldV16ViewProjection(progress,
      { ...active, activeTiles: duplicate }, [], null)).toThrow('v16 terrain')
  })

  it('presents a discovered bridge with D’s checked rejection, bearing, cost and benefit', () => {
    const bridge = site<Extract<PublicV16GreenwaySite, { kind: 'bridge' }>>('works3:bridge:0')
    const progress = reveal(at(fresh(), bridge.from.x, 2), bridge.footprintTileIds)
    const checked = previewPublicV16GreenwayWork(progress, bridge.id)
    const view = project(progress)
    expect(view.savedTerrainWorks?.preview?.selected).toMatchObject({
      site: { id: bridge.id, kind: 'bridge', supportPath: bridge.supportPath },
      rejection: checked.rejection, reason: expect.stringContaining('8 logs'),
      benefit: expect.stringContaining('80 Construction XP'),
    })
    expect(view.savedTerrainWorks?.preview?.selected?.angleRadians).toBeLessThan(Math.PI / 6)
    expect(view.savedTerrainWorks?.preview?.selected?.distanceMeters).toBeLessThan(3)
    expect(view.map.tiles.find((tile) => tile.id === bridge.footprintTileIds[1])?.hasRouteSite)
      .toBe(true)
  })

  it('confirms a ready discovered bridge when the heading misses its aim cone', () => {
    const bridge = site<Extract<PublicV16GreenwaySite, { kind: 'bridge' }>>('works3:bridge:1')
    const progress = logs(reveal(at(fresh(), bridge.from.x, bridge.from.z - 0.6),
      bridge.footprintTileIds), 8)
    expect(previewPublicV16GreenwayWork(progress, bridge.id).rejection).toBeNull()
    const view = project(progress, 'bridge', 0)
    expect(view.savedTerrainWorks?.preview?.nearby.find((choice) =>
      choice.site.id === bridge.id)?.angleRadians).toBeGreaterThan(Math.PI / 6)
    expect(view.savedTerrainWorks?.preview?.selected?.site.id).toBe(bridge.id)
    expect(savedTerrainWorkVisuals(view.savedTerrainWorks, view.terrain))
      .toMatchObject([{ site: { id: bridge.id }, built: false }])
    expect(savedWorkKeyboardIntent('KeyF', view.savedTerrainWorks))
      .toEqual({ type: 'saved-work.confirm', id: bridge.id })
    const hud = renderToStaticMarkup(createElement(WizardHud, {
      projection: view, onIntent: () => {},
    }))
    expect(hud).toContain('Selected Creek bridge')
    expect(hud).toContain(`x ${Number(bridge.from.x.toFixed(1))}, z ${Number(bridge.from.z.toFixed(1))}`)
    expect(hud).toContain('aria-label="Confirm selected saved work"')
    expect(hud).toContain('Confirm Creek bridge')
  })

  it('confirms a ready discovered ladder when looking away from its face', () => {
    const ladder = [-3, -2, -1, 2, 3].map((gx) =>
      resolvePublicV16GreenwaySite(seed, `works3:ladder:${gx}`))
      .find((value): value is Extract<PublicV16GreenwaySite, { kind: 'ladder' }> =>
        value?.kind === 'ladder' && value.blockingResourceIds.length === 0)!
    const progress = logs(reveal(at(fresh(), ladder.from.x, ladder.from.z + 0.6),
      ladder.footprintTileIds), 4)
    expect(previewPublicV16GreenwayWork(progress, ladder.id).rejection).toBeNull()
    const view = project(progress, 'ladder', Math.PI)
    expect(view.savedTerrainWorks?.preview?.selected).toMatchObject({
      site: { id: ladder.id }, rejection: null,
    })
    expect(view.savedTerrainWorks?.preview?.selected?.angleRadians).toBeGreaterThan(Math.PI / 6)
    expect(savedTerrainWorkVisuals(view.savedTerrainWorks, view.terrain))
      .toMatchObject([{ site: { id: ladder.id }, built: false }])
    expect(savedWorkKeyboardIntent('KeyF', view.savedTerrainWorks))
      .toEqual({ type: 'saved-work.confirm', id: ladder.id })
    expect(renderToStaticMarkup(createElement(WizardHud, {
      projection: view, onIntent: () => {},
    }))).toContain('Confirm North cliff ladder')
  })

  it('keeps a blocked aimed site visible but never offers F', () => {
    const blockedSeed = 'p29-seed-0'
    const bridge = site<Extract<PublicV16GreenwaySite, { kind: 'bridge' }>>(
      'works3:bridge:1', blockedSeed)
    const progress = logs(reveal(at(fresh(blockedSeed), bridge.from.x,
      bridge.from.z - 0.6), bridge.footprintTileIds), 8)
    expect(previewPublicV16GreenwayWork(progress, bridge.id).rejection).toBe('occupied')
    const view = project(progress, 'bridge', Math.PI)
    expect(view.savedTerrainWorks?.preview?.selected).toMatchObject({
      site: { id: bridge.id }, rejection: 'occupied', reason: expect.stringContaining('Chop'),
    })
    expect(savedWorkKeyboardIntent('KeyF', view.savedTerrainWorks)).toBeNull()
    expect(renderToStaticMarkup(createElement(WizardHud, {
      projection: view, onIntent: () => {},
    }))).toContain('disabled="" aria-label="Confirm selected saved work"')
  })

  it('does not select or offer an incompletely discovered ready site', () => {
    const bridge = site<Extract<PublicV16GreenwaySite, { kind: 'bridge' }>>('works3:bridge:1')
    const revealed = reveal(at(fresh(), bridge.from.x, bridge.from.z - 0.6),
      bridge.footprintTileIds)
    const hidden = logs({ ...revealed, state: { ...revealed.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(revealed.state.discoveryMask)
        .filter((id) => id !== bridge.footprintTileIds[4])) } }, 8)
    expect(previewPublicV16GreenwayWork(hidden, bridge.id).rejection).toBe('undiscovered')
    const view = project(hidden, 'bridge', 0)
    expect(view.savedTerrainWorks?.preview?.nearby.some((choice) => choice.site.id === bridge.id))
      .toBe(false)
    expect(view.savedTerrainWorks?.preview?.selected?.site.id).not.toBe(bridge.id)
    expect(savedWorkKeyboardIntent('KeyF', view.savedTerrainWorks)).toBeNull()
  })

  it('switches explicitly between adjacent ready bridge sites as aim changes', () => {
    const a = site<Extract<PublicV16GreenwaySite, { kind: 'bridge' }>>('works3:bridge:0')
    const b = site<Extract<PublicV16GreenwaySite, { kind: 'bridge' }>>('works3:bridge:1')
    const x = (a.from.x + b.from.x) / 2 + Math.sign(b.from.x - a.from.x) * 0.1
    const z = Math.min(a.from.z, b.from.z) - 0.6
    const progress = logs(reveal(at(fresh(), x, z),
      [...a.footprintTileIds, ...b.footprintTileIds]), 8)
    expect(previewPublicV16GreenwayWork(progress, a.id).rejection).toBeNull()
    expect(previewPublicV16GreenwayWork(progress, b.id).rejection).toBeNull()
    const yawTo = (work: typeof a) => Math.atan2(
      progress.state.player.position.x - work.from.x,
      progress.state.player.position.z - work.from.z)
    const first = project(progress, 'bridge', yawTo(a))
    const second = project(progress, 'bridge', yawTo(b))
    const unaligned = project(progress, 'bridge', 0)
    expect(first.savedTerrainWorks?.preview?.selected?.site.id).toBe(a.id)
    expect(second.savedTerrainWorks?.preview?.selected?.site.id).toBe(b.id)
    expect(unaligned.savedTerrainWorks?.preview?.selected?.site.id).toBe(b.id)
    expect(savedWorkKeyboardIntent('KeyF', first.savedTerrainWorks))
      .toEqual({ type: 'saved-work.confirm', id: a.id })
    expect(savedWorkKeyboardIntent('KeyF', second.savedTerrainWorks))
      .toEqual({ type: 'saved-work.confirm', id: b.id })
    for (const [view, work] of [[first, a], [second, b]] as const) {
      expect(renderToStaticMarkup(createElement(WizardHud, {
        projection: view, onIntent: () => {},
      }))).toContain(`Selected Creek bridge · ${work.from.x < x ? 'W' : 'E'}`)
    }
  })

  it('shows only a fully visible built deck and the actual bridge pose', () => {
    const bridge = site<Extract<PublicV16GreenwaySite, { kind: 'bridge' }>>('works3:bridge:0')
    const built = { ...fresh(), greenwayWorks: {
      builtBridgeIds: [bridge.id], builtLadderIds: [], dugTileIds: [] } }
    const progress = at(reveal({ ...built, state: { ...built.state,
      player: { ...built.state.player, xp: 80,
        skillXp: { ...built.state.player.skillXp, construction: 80 } } } },
    bridge.footprintTileIds), bridge.from.x, 8)
    const view = project(progress)
    expect(view.player.position[1]).toBe(progress.state.player.position.y)
    expect(view.savedTerrainWorks?.builtSites).toMatchObject([{ id: bridge.id,
      kind: 'bridge', supportPath: bridge.supportPath }])
    expect(view.map.tiles.find((tile) => tile.id === bridge.footprintTileIds[1])?.hasBuiltRoute)
      .toBe(true)
  })

  it('projects a built alternate ladder as a rung-ready ladder and lowers a dug tile', () => {
    const ladder = [-3, -2, -1, 1, 2, 3].map((gx) =>
      resolvePublicV16GreenwaySite(seed, `works3:ladder:${gx}`))
      .find((value): value is Extract<PublicV16GreenwaySite, { kind: 'ladder' }> =>
        value?.kind === 'ladder' && value.blockingResourceIds.length === 0)!
    const dig = site<Extract<PublicV16GreenwaySite, { kind: 'dig' }>>('works3:dig:1:3')
    const works = { builtBridgeIds: [], builtLadderIds: [ladder.id], dugTileIds: [dig.id] }
    const initial = fresh()
    const progress = at(reveal({ ...initial, greenwayWorks: works,
      state: { ...initial.state, player: { ...initial.state.player,
        xp: 90, skillXp: { ...initial.state.player.skillXp,
          construction: 60, excavation: 30 } } } },
    [...ladder.footprintTileIds, ...dig.footprintTileIds]), ladder.from.x, -4)
    const view = project(progress, 'ladder')
    expect(view.savedTerrainWorks?.context).toBe('works3-greenway')
    expect(view.savedTerrainWorks?.builtSites).toMatchObject([{ id: ladder.id,
      kind: 'ladder', supportPath: ladder.supportPath }])
    expect(view.savedTerrainWorks?.dugTileIds).toContain(dig.footprintTileIds[0])
    expect(view.terrain.find((cell) => cell.id === dig.footprintTileIds[0])?.position[1])
      .toBe(dig.loweredCenter.y)
    expect(view.map.tiles.find((tile) => tile.id === dig.footprintTileIds[0])?.elevationMeters)
      .toBe(dig.loweredCenter.y)
  })

  it('explains a tree-blocked potential site without advertising it as ready', () => {
    const blockedSeed = 'p29-seed-0'
    const bridge = site<Extract<PublicV16GreenwaySite, { kind: 'bridge' }>>(
      'works3:bridge:1', blockedSeed)
    expect(bridge.blockingResourceIds.length).toBeGreaterThan(0)
    const progress = reveal(at(fresh(blockedSeed), bridge.from.x, 2), bridge.footprintTileIds)
    const checked = previewPublicV16GreenwayWork(progress, bridge.id)
    const view = project(progress)
    expect(checked.rejection).toBe('occupied')
    expect(view.savedTerrainWorks?.preview?.nearby.find((choice) => choice.site.id === bridge.id))
      .toMatchObject({ rejection: 'occupied', reason: expect.stringContaining('Chop') })
    const built: PublicV16Progress = { ...progress,
      greenwayWorks: { ...progress.greenwayWorks, builtBridgeIds: [bridge.id] },
      state: { ...progress.state, greenway: { ...progress.state.greenway,
        resources: progress.state.greenway.resources.map((resource) =>
          bridge.blockingResourceIds.includes(resource.id)
            ? { ...resource, health: 0, depleted: true } : resource) },
        player: { ...progress.state.player, xp: 80,
          skillXp: { ...progress.state.player.skillXp, construction: 80 } } } }
    const completed = project(built)
    expect(completed.savedTerrainWorks?.builtSites.map((value) => value.id)).toContain(bridge.id)
    expect(completed.resources.some((resource) =>
      bridge.blockingResourceIds.includes(resource.id))).toBe(false)
  })

  it('gives dig-only 4 m reach and adjacent-stance guidance without changing bridge reach', () => {
    const dig = site<Extract<PublicV16GreenwaySite, { kind: 'dig' }>>('works3:dig:1:3')
    const farDig = reveal(at(fresh(), dig.center.x + 5, dig.center.z), dig.footprintTileIds)
    expect(project(farDig, 'dig').savedTerrainWorks?.preview?.nearby
      .find((choice) => choice.site.id === dig.id)).toMatchObject({
      rejection: 'too_far', reason: expect.stringContaining('within 4 m'),
    })
    const onDig = reveal(at(fresh(), dig.center.x, dig.center.z), dig.footprintTileIds)
    expect(project(onDig, 'dig').savedTerrainWorks?.preview?.nearby
      .find((choice) => choice.site.id === dig.id)).toMatchObject({
      rejection: 'occupied', reason: expect.stringContaining('not on it'),
    })

    const bridge = site<Extract<PublicV16GreenwaySite, { kind: 'bridge' }>>('works3:bridge:0')
    const farBridge = reveal(at(fresh(), bridge.from.x + 5, bridge.from.z), bridge.footprintTileIds)
    expect(project(farBridge).savedTerrainWorks?.preview?.nearby
      .find((choice) => choice.site.id === bridge.id)).toMatchObject({
      rejection: 'too_far', reason: 'Move within 3 m of this site.',
    })
  })
})
