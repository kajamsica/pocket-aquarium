import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createActiveWorldTerrain } from './domain/activeWorldTerrain'
import type { ReadonlyWorldTile } from './domain/activeWorldTerrain'
import { encodeDiscoveredTileIds } from './domain/discoveryMask'
import { highlandLandmark, highlandStoneNodes } from './domain/highlandContent'
import { PUBLIC_V11_BOOTS_LISTING_ID } from './domain/publicWorldGait'
import * as overviewModule from './domain/publicV13Overview'
import type { PublicV13ContinuousSession } from './domain/publicWorldV13ContinuousSession'
import type { PublicV13Head } from './domain/publicWorldV13Snapshot'
import { createFreshPublicWorld } from './domain/publicWorldState'
import { withFreshPublicV7Herbs } from './domain/publicWorldV7'
import { withFreshPublicV9Camps } from './domain/publicWorldV9State'
import { withPublicV10TerrainRevision } from './domain/publicWorldV10State'
import { withPublicV11Highland } from './domain/publicWorldV11State'
import { withPublicV12Windstep } from './domain/publicWorldV12State'
import { emptyTerrainWorkLedger } from './domain/terrainWorkLedger'
import { resolveTerrainWorkSite } from './domain/terrainWorks'
import { publicWorldV12ViewProjection } from './PublicV12WorldView'
import { publicWorldV13ViewProjection } from './PublicV13WorldView'
import { WizardHud } from './view/WizardHud'

const seed = 'greenway-alpha'
const v12 = withPublicV12Windstep(withPublicV11Highland(withPublicV10TerrainRevision(
  withFreshPublicV9Camps(withFreshPublicV7Herbs(
    createFreshPublicWorld(seed, 'greenway-classic-v1'))))))
type State = PublicV13Head['state']
type Active = ReturnType<PublicV13ContinuousSession['view']>
const compact = (ids: readonly string[] = v12.discoveredTileIds): State => {
  const { discoveredTileIds: _ids, ...legacy } = v12
  return { ...legacy, discoveryMask: encodeDiscoveredTileIds([...new Set(ids)].sort()),
    terrainWorks: emptyTerrainWorkLedger() }
}
const green = (state: State): Extract<Active, { movementOwner: 'greenway' }> => ({
  movementOwner: 'greenway', tick: state.tick,
  player: state.player, knownGreenwayTileIds: [] })
const stream = (state: State, activeTiles: readonly ReadonlyWorldTile[]): Extract<Active,
  { movementOwner: 'streamed' }> => ({
  movementOwner: 'streamed', tick: state.tick, player: state.player,
  activeKnownTileIds: [], activeTiles,
})
const atStream = (state: State, x: number, z: number): [State, readonly ReadonlyWorldTile[]] => {
  const terrain = createActiveWorldTerrain(seed, { cachePitDug: state.mireglass.cacheExcavated,
    highlandRidge: true })
  terrain.activate({ x, z })
  const tile = terrain.tileAtWorld(x, z)!
  return [{ ...state, movementOwner: 'streamed', player: { ...state.player,
    position: { ...tile.center } }, discoveryMask: encodeDiscoveredTileIds([tile.id]) },
  terrain.activeTiles()]
}

describe('unmounted compact v13 world projection', () => {
  it('keeps real Greenway inventory, coins, store stock, boots listing and trade from v12', () => {
    const state = compact()
    const prior = publicWorldV12ViewProjection(v12, ['hello'], null)
    const view = publicWorldV13ViewProjection(state, green(state), ['hello'], null)
    expect(view.backpack).toEqual(prior.backpack)
    expect(view.coins).toBe(prior.coins)
    expect(view.equipment).toEqual(prior.equipment)
    expect(view.tradeListings).toEqual(prior.tradeListings)
    expect(view.stores).toEqual(prior.stores)
    expect(view.stores.flatMap((store) => store.listings).map((listing) => listing.id))
      .toContain(PUBLIC_V11_BOOTS_LISTING_ID)
    expect(view.terrainWorkTrial).toBeUndefined()
    expect(view.savedTerrainWorks).toEqual({ builtSites: [], dugTileIds: [], preview: null })
  })

  it('rejects stale owner, tick and pose instead of mixing unrelated state and active tiles', () => {
    const state = compact()
    const view = green(state)
    expect(() => publicWorldV13ViewProjection(state, { ...view, tick: view.tick + 1 }, [], null))
      .toThrow(RangeError)
    expect(() => publicWorldV13ViewProjection(state, { ...view, movementOwner: 'streamed',
      activeKnownTileIds: [], activeTiles: [] },
      [], null)).toThrow(RangeError)
    expect(() => publicWorldV13ViewProjection(state, { ...view, player: { ...view.player,
      position: { ...view.player.position, x: view.player.position.x + 1 } } }, [], null))
      .toThrow(RangeError)
  })

  it('uses the active effective ground for a saved dig and keeps that work out of the trial kit', () => {
    const dig = resolveTerrainWorkSite(seed, 'tile--64-76')!
    if (dig.kind !== 'dig') throw new Error('Expected the canonical dig site.')
    const original = compact([dig.id])
    const [onTile, baseTiles] = atStream(original, dig.center.x, dig.center.z)
    const effective = baseTiles.map((tile) => tile.id === dig.id
      ? { ...tile, center: { ...tile.center, y: tile.center.y - .24 } } : tile)
    const state: State = { ...onTile,
      terrainWorks: { builtWorkIds: [], dugTileIds: [dig.id] },
      player: { ...onTile.player, position: { ...onTile.player.position,
        y: onTile.player.position.y - .24 } } }
    const before = structuredClone(state)
    const projection = publicWorldV13ViewProjection(state, stream(state, effective), [], null)
    expect(projection.terrain.find((cell) => cell.id === dig.id)?.position[1])
      .toBeCloseTo(dig.loweredCenter.y)
    expect(projection.visualWorld?.terrain.find((cell) => cell.id === dig.id)?.position[1])
      .toBeCloseTo(dig.loweredCenter.y)
    expect(projection.map.tiles.find((tile) => tile.id === dig.id)?.elevationMeters)
      .toBeCloseTo(dig.loweredCenter.y)
    expect(projection.savedTerrainWorks.dugTileIds).toEqual([dig.id])
    expect(projection.terrainWorkTrial).toBeUndefined()
    expect(state).toEqual(before)
  })

  it('projects only locally active built geometry and makes streamed prompts read-only', () => {
    const bridge = resolveTerrainWorkSite(seed, 'works1:bridge:-102:92:z')!
    if (bridge.kind !== 'bridge') throw new Error('Expected the canonical bridge site.')
    const [onTile, tiles] = atStream(compact(), bridge.from.x, bridge.from.z)
    const state: State = { ...onTile, terrainWorks: { builtWorkIds: [bridge.id], dugTileIds: [] } }
    const local = publicWorldV13ViewProjection(state, stream(state, tiles), [], null)
    expect(local.savedTerrainWorks.builtSites).toEqual([bridge])
    expect(local.nearbyInteraction?.actionable).not.toBe(true)
    expect(local.map.tiles.find((tile) => tile.id === bridge.footprintTileIds[1]))
      .toMatchObject({ discovered: true, hasBuiltRoute: true })
    expect(local.map.tiles.find((tile) => tile.id === bridge.footprintTileIds[2]))
      .toMatchObject({ discovered: false, hasBuiltRoute: false })
    const [far, farTiles] = atStream(state, 700, 700)
    expect(publicWorldV13ViewProjection(far, stream(far, farTiles), [], null)
      .savedTerrainWorks.builtSites).toEqual([])
  })

  it('keeps a discovered, bounded bridge preview distinct from the saved work ledger', () => {
    const bridge = resolveTerrainWorkSite(seed, 'works1:bridge:-102:92:z')!
    if (bridge.kind !== 'bridge') throw new Error('Expected the canonical bridge site.')
    const [onTile, tiles] = atStream(compact(), bridge.from.x, bridge.from.z)
    const state: State = { ...onTile,
      discoveryMask: encodeDiscoveredTileIds([...bridge.footprintTileIds].sort()) }
    const view = publicWorldV13ViewProjection(state, stream(state, tiles), [], null, null,
      { window: { minGX: -102, maxGX: -102, minGZ: 92, maxGZ: 92 },
        sites: [bridge], kind: 'bridge', bodyYaw: Math.PI })
    expect(view.savedTerrainWorks.builtSites).toEqual([])
    expect(view.savedTerrainWorks.preview?.selected?.site.id).toBe(bridge.id)
    expect(view.savedTerrainWorks.preview?.selected?.benefit).toContain('Fen channel')
    expect(view.terrainWorkTrial).toBeUndefined()
  })

  it('retains saved Windward Step status but never offers unsupported v13 actions', () => {
    const crown = highlandLandmark(seed)
    const [atCrown, tiles] = atStream(compact(), crown.tile.center.x, crown.tile.center.z)
    const state: State = { ...atCrown,
      highland: { ...atCrown.highland, landmarkDiscovered: true },
      windstep: { ...atCrown.windstep, learned: true } }
    const view = publicWorldV13ViewProjection(state, stream(state, tiles), [], null)
    expect(view.windwardStep?.learned).toBe(true)
    expect(view.windwardStep?.glyph?.canStudy).toBe(false)
    expect(view.windwardStep?.canCast).toBe(false)
    expect(view.windwardStep?.unavailableReason).toContain('unavailable')
  })

  it('does not offer quarry extraction even when the old projection considers it ready', () => {
    const node = highlandStoneNodes(seed)[0]
    const [onTile, tiles] = atStream(compact(), node.tile.center.x, node.tile.center.z)
    const state: State = { ...onTile,
      highland: { ...onTile.highland, landmarkDiscovered: true },
      player: { ...onTile.player,
        inventory: [...onTile.player.inventory, { itemId: 'field_spade', quantity: 1 }],
        equipment: { ...onTile.player.equipment, mainHand: 'field_spade' },
        skillXp: { ...onTile.player.skillXp, excavation: 30 } } }
    const { discoveryMask: _mask, terrainWorks: _works, ...legacy } = state
    const old = publicWorldV12ViewProjection({ ...legacy,
      discoveredTileIds: [node.tile.id] }, [], null)
    expect(old.highlandExtraction?.actionable).toBe(true)
    const view = publicWorldV13ViewProjection(state, stream(state, tiles), [], null)
    expect(view.highlandExtraction).toBeUndefined()
    expect(view.nearbyInteraction).toMatchObject({ actionable: false })
    const hud = renderToStaticMarkup(createElement(WizardHud, { projection: view,
      onIntent: () => {} }))
    expect(hud).not.toContain('aria-label="Extract quarry stone"')
    expect(hud).not.toContain('<b>Extract</b>')
  })

  it('defers the whole-mask overview until requested and caches it per projection', () => {
    const state = compact()
    const scan = vi.spyOn(overviewModule, 'publicV13Overview')
    try {
      const view = publicWorldV13ViewProjection(state, green(state), [], null)
      expect(scan).not.toHaveBeenCalled()
      const first = view.map.overview!()
      expect(first.cells.length).toBeGreaterThan(0)
      expect(view.map.overview!()).toBe(first)
      expect(scan).toHaveBeenCalledTimes(1)
    } finally { scan.mockRestore() }
  })
})
