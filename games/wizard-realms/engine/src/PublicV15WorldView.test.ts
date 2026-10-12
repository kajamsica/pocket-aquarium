import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { encodeDiscoveredTileIds } from './domain/discoveryMask'
import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { createPublicV15ContinuousSession } from './domain/publicWorldV15ContinuousSession'
import { createFreshPublicV15Head } from './domain/publicWorldV15Snapshot'
import { publicV15StarterSupportAt } from './domain/publicWorldV15StarterMovement'
import { publicWorldV15StarterSites, publicWorldV15StarterTileAtGrid,
  publicWorldV15SuppressedStarterResourceIds } from './domain/publicWorldV15StarterSites'
import { confirmPublicV15StarterWork,
  previewPublicV15StarterWork } from './domain/publicWorldV15StarterWork'
import type { PublicV15Progress } from './domain/publicWorldV15Validation'
import type { PublicV14State } from './domain/publicWorldV14Snapshot'
import { publicWorldV14ViewProjection } from './PublicV14WorldView'
import { publicWorldV15ViewProjection } from './PublicV15WorldView'
import type { PublicV15ActiveView } from './PublicV15WorldView'
import { WizardHud } from './view/WizardHud'
import { savedTerrainWorkVisuals } from './view/WizardScene'

const seed = 'greenway-alpha'
const fresh = (): PublicV15Progress => {
  const { head } = createFreshPublicV15Head(seed)
  return { state: head.state, starterWorks: head.starterWorks }
}
const sites = () => {
  const [bridge, dig] = publicWorldV15StarterSites(seed)
  if (bridge.kind !== 'bridge' || dig.kind !== 'dig') throw new Error('Invalid sites')
  return { bridge, dig }
}
const activeFor = ({ state }: PublicV15Progress): PublicV15ActiveView => ({
  movementOwner: state.movementOwner, tick: state.tick, player: structuredClone(state.player),
  pendingBoundary: false,
  activeKnownTileIds: discoveredTileIdsInActiveWindow(state.discoveryMask, state.player.position),
  activeTiles: state.greenway.tiles.map((tile) => publicWorldV15StarterTileAtGrid(seed,
    tile.gridX - 3, tile.gridZ - 3)),
})
const project = (progress: PublicV15Progress, kind: 'bridge' | 'dig' = 'bridge',
  modeActive = true) => publicWorldV15ViewProjection(progress, activeFor(progress), [], null,
  null, false, { kind, bodyYaw: kind === 'bridge' ? Math.PI : -Math.PI / 2,
    modeActive, actionsEnabled: true })
const at = (progress: PublicV15Progress, x: number, z: number): PublicV15Progress => {
  const { state, starterWorks } = progress
  const route = state.greenway.routes.find((entry) => entry.id === 'greenway_ladder')!
  const support = publicV15StarterSupportAt({ seed, profile: state.generationProfile,
    route, built: state.greenway.builtRouteIds.includes('greenway_ladder'),
    starterWorks }, { x, z })
  if (!support) throw new Error('No v15 support at test pose')
  return { ...progress, state: { ...state,
    player: { ...state.player, position: { x, y: support.floorY, z }, verticalVelocity: 0 } } }
}
const reveal = (progress: PublicV15Progress, ids: readonly string[]): PublicV15Progress => ({
  ...progress, state: { ...progress.state, discoveryMask: encodeDiscoveredTileIds([
    ...new Set([...discoveredTileIdsInActiveWindow(progress.state.discoveryMask,
      progress.state.player.position), ...ids]),
  ].sort()) },
})
const withLogs = (progress: PublicV15Progress): PublicV15Progress => ({
  ...progress, state: { ...progress.state, player: { ...progress.state.player,
    inventory: [...progress.state.player.inventory, { itemId: 'logs' as const, quantity: 8 }],
  } },
})

describe('v15 native public view', () => {
  it('uses the authored creek cells and omits canonical suppressed resources', () => {
    const progress = fresh()
    const before = structuredClone(progress)
    const view = project(progress)
    const { bridge } = sites()
    const gap = view.terrain.find((cell) => cell.id === bridge.footprintTileIds[2])
    expect(gap?.climate).toBe('marsh')
    expect(view.map.tiles.find((tile) => tile.id === bridge.footprintTileIds[2]))
      .toMatchObject({ terrain: 'wetland', biome: 'marsh' })
    const suppressed = publicWorldV15SuppressedStarterResourceIds(seed,
      progress.state.greenway.resources)
    expect(suppressed.length).toBeGreaterThan(0)
    expect(view.resources.some((resource) => suppressed.includes(resource.id))).toBe(false)
    expect(view.visualWorld?.resources.some((resource) => suppressed.includes(resource.id))).toBe(false)
    expect(progress).toEqual(before)
  })

  it('accepts the real native session view at a fresh v15 start', () => {
    const { head, lineage } = createFreshPublicV15Head(seed)
    const session = createPublicV15ContinuousSession({ state: head.state,
      starterWorks: head.starterWorks, saveRevision: 0, lineage })
    const view = publicWorldV15ViewProjection(session.previewSnapshot(), session.view(),
      [], null, null, false, { kind: 'bridge', bodyYaw: Math.PI,
        modeActive: true, actionsEnabled: true })
    expect(view.terrain).toHaveLength(256)
    expect(view.savedTerrainWorks).toMatchObject({ modeActive: true,
      selectedKind: 'bridge', actionsEnabled: true })
  })

  it('keeps a hidden footprint out of Works and map markers', () => {
    const { bridge } = sites()
    const progress = at(fresh(), bridge.from.x, bridge.from.z)
    const hidden = reveal(progress, bridge.footprintTileIds.slice(0, 2))
    expect(previewPublicV15StarterWork(hidden, bridge.id).rejection).toBe('undiscovered')
    const view = project(hidden)
    expect(view.savedTerrainWorks?.preview?.nearby).toEqual([])
    expect(view.savedTerrainWorks?.preview?.selected).toBeNull()
    expect(view.map.tiles.find((tile) => tile.id === bridge.footprintTileIds[1])?.hasRouteSite)
      .toBe(false)
    expect(view.map.tiles.filter((tile) => !tile.discovered)
      .every((tile) => tile.terrain === null && !tile.hasResource && !tile.hasDigSite))
      .toBe(true)
  })

  it('uses the pure checked rejection and presents the exact bridge cost and benefit', () => {
    const { bridge } = sites()
    const known = reveal(at(fresh(), bridge.from.x, bridge.from.z), bridge.footprintTileIds)
    const checked = previewPublicV15StarterWork(known, bridge.id)
    const lacking = project(known)
    const candidate = lacking.savedTerrainWorks?.preview?.selected
    expect(checked.rejection).toBe('not_owned')
    expect(candidate).toMatchObject({ site: { id: bridge.id, kind: 'bridge', logCost: 8 },
      rejection: checked.rejection, reason: expect.stringContaining('8 logs'),
      benefit: expect.stringContaining('narrow supported deck') })
    const hud = renderToStaticMarkup(createElement(WizardHud, { projection: lacking,
      onIntent: () => {} }))
    expect(hud).toContain('Gather 8 logs')
    expect(hud).toContain('Costs 8 logs')
    expect(lacking.map.guidance).toContain('8 logs')
    expect(project(withLogs(fresh())).map.guidance).toContain('Walk south')
    const stocked = withLogs(known)
    expect(previewPublicV15StarterWork(stocked, bridge.id).rejection).toBeNull()
    expect(project(stocked).savedTerrainWorks?.preview?.selected?.rejection).toBeNull()
    expect(project(stocked, 'bridge', false).savedTerrainWorks?.preview).toBeNull()
  })

  it('shows the saved deck, far-bank dig, and stone return stages from native flags', () => {
    const { bridge, dig } = sites()
    const ready = withLogs(reveal(at(fresh(), bridge.from.x, bridge.from.z),
      [...bridge.footprintTileIds, ...dig.footprintTileIds]))
    const built = confirmPublicV15StarterWork(ready, bridge.id)
    expect(built.rejection).toBeUndefined()
    if (!built.progress) throw new Error('Bridge should build')
    const afterBridge = project(built.progress)
    expect(afterBridge.savedTerrainWorks?.builtSites.map((site) => site.id)).toContain(bridge.id)
    expect(savedTerrainWorkVisuals(afterBridge.savedTerrainWorks, afterBridge.terrain))
      .toMatchObject([{ site: { id: bridge.id, obstacle: 'fen_channel' }, built: true }])
    expect(afterBridge.map.tiles.find((tile) => tile.id === bridge.footprintTileIds[1])?.hasBuiltRoute)
      .toBe(true)
    expect(afterBridge.map.guidance).toMatch(/cross.*bridge/i)
    const byDig = at(built.progress, dig.adjacentStance.x, dig.adjacentStance.z)
    expect(previewPublicV15StarterWork(byDig, dig.id).rejection).toBe('requires_spade')
    expect(project(byDig, 'dig').savedTerrainWorks?.preview?.selected)
      .toMatchObject({ rejection: 'requires_spade', reason: 'Own and equip a field spade.' })
    const prepared: PublicV15Progress = { ...byDig, state: { ...byDig.state,
      player: { ...byDig.state.player,
        inventory: [...byDig.state.player.inventory, { itemId: 'field_spade', quantity: 1 }],
        equipment: { ...byDig.state.player.equipment, mainHand: 'field_spade' },
      } } }
    expect(previewPublicV15StarterWork(prepared, dig.id).rejection).toBeNull()
    const dug = confirmPublicV15StarterWork(prepared, dig.id)
    expect(dug.rejection).toBeUndefined()
    if (!dug.progress) throw new Error('Patch should dig')
    const afterDig = project(dug.progress, 'dig')
    expect(afterDig.savedTerrainWorks?.dugTileIds).toContain(dig.footprintTileIds[0])
    expect(afterDig.map.tiles.find((tile) => tile.id === dig.footprintTileIds[0]))
      .toMatchObject({ elevationMeters: dig.loweredCenter.y, hasDigSite: false })
    expect(afterDig.terrain.find((cell) => cell.id === dig.footprintTileIds[0])?.position[1])
      .toBe(dig.loweredCenter.y)
    expect(afterDig.map.guidance).toMatch(/return.*Outfitters.*sell.*stone/i)
    const outfitters = dug.progress.state.greenway.stores.find((store) =>
      store.id === 'store-greenway')!
    const returned = project(at(dug.progress, outfitters.position.x, outfitters.position.z))
    expect(returned.stores.find((store) => store.id === 'store-greenway')?.sellOffers)
      .toMatchObject([{ itemId: 'stone', quantity: 1 }])
  })

  it('rejects a stale v14 terrain window and an oversized active tile set', () => {
    const progress = fresh()
    const native = activeFor(progress)
    const stale = { ...native, activeTiles: progress.state.greenway.tiles }
    expect(() => publicWorldV15ViewProjection(progress, stale, [], null))
      .toThrow(/differs from v15 terrain/)
    expect(() => publicWorldV15ViewProjection(progress, {
      ...native, activeTiles: Array.from({ length: 9 * 16 ** 2 + 1 }, () => native.activeTiles[0]),
    }, [], null)).toThrow(/bounded frame/)
  })

  it('leaves the v14 view and saved state unchanged', () => {
    const progress = fresh()
    const state: PublicV14State = progress.state
    const v14Active = { ...activeFor(progress), activeTiles: state.greenway.tiles }
    const old = publicWorldV14ViewProjection(state, v14Active, [], null)
    project(progress)
    const again = publicWorldV14ViewProjection(state, v14Active, [], null)
    expect(again).toEqual(old)
    expect(again.savedTerrainWorks).toBeUndefined()
  })
})
