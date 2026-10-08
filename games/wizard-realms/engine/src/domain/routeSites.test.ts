import { describe, expect, it } from 'vitest'
import { areaAt, createGeneratedWorld } from './generation'
import { canonicalRouteSites, routeBuildOptions } from './routeSites'
import type { RouteId, RouteSite, WizardWorldState } from './types'

const clone = (state: WizardWorldState): WizardWorldState => JSON.parse(JSON.stringify(state)) as WizardWorldState
const seeds = ['greenway-alpha', 'route-1', 'route-2', 'route-3', 'route-4', 'route-5', 'route-6', 'route-7']

function readyAt(state: WizardWorldState, site: RouteSite): boolean {
  const nearby = clone(state)
  nearby.player.position = { ...site.from }
  return routeBuildOptions(nearby).find((option) => option.id === site.id)?.status === 'ready'
}

function provision(state: WizardWorldState, routeId: RouteId): WizardWorldState {
  const prepared = clone(state)
  prepared.player.inventory.push({ itemId: 'logs', quantity: 10 })
  prepared.discoveredTileIds = prepared.tiles.map((tile) => tile.id)
  if (routeId === 'highland_bridge') {
    const ladder = prepared.routes.find((route) => route.id === 'greenway_ladder')!
    const anchor = canonicalRouteSites(prepared).find((site) => site.id === 'greenway_ladder:x:0')!
    ladder.from = { ...anchor.from }
    ladder.to = { ...anchor.to }
    ladder.siteId = anchor.id
    prepared.builtRouteIds.push(ladder.id)
    prepared.unlockedRecipeIds.push('highland_bridge')
    prepared.player.xp = 100
    prepared.player.level = 2
  }
  return prepared
}

describe('canonical construction sites', () => {
  it('guides the observed ladder preview toward its source foot as the player moves', () => {
    const state = provision(createGeneratedWorld('greenway-alpha'), 'greenway_ladder')
    const site = canonicalRouteSites(state).find((candidate) => candidate.id === 'greenway_ladder:x:0')!
    const preview = () => routeBuildOptions(state).find((option) => option.id === site.id)!
    state.player.position = { ...site.from, x: 9.1 }
    const before = JSON.stringify(state)
    expect(preview()).toMatchObject({ status: 'too_far', reason: 'Source foot: 9m west. Approach from Greenway.' })
    expect(JSON.stringify(state)).toBe(before)
    state.player.position = { ...site.from, x: -5.6, z: 1.6 }
    expect(preview()).toMatchObject({ status: 'too_far', reason: 'Source foot: 6m east and 6m north. Approach from Greenway.' })
    state.player.position = { ...site.from, x: 3.01 }
    expect(preview().status).toBe('too_far')
    state.player.position = { ...site.from, x: 3 }
    expect(preview()).toMatchObject({ status: 'ready', reason: 'Ready to build.' })
    state.player.inventory = []
    expect(preview()).toMatchObject({ status: 'needs_logs', reason: 'Requires 4 logs.' })
  })

  it('points bridge previews to the source bank and preserves source-area authority', () => {
    const state = provision(createGeneratedWorld('greenway-alpha'), 'highland_bridge')
    const site = canonicalRouteSites(state).find((candidate) => candidate.id === 'highland_bridge:z:-8')!
    const preview = () => routeBuildOptions(state).find((option) => option.id === site.id)!
    state.player.position = { ...site.from, x: 0, z: -12 }
    expect(preview()).toMatchObject({ status: 'too_far', reason: 'Source foot: 4m east and 4m south. Approach from Northern Ridge.' })
    state.player.position = { ...site.to }
    expect(preview()).toMatchObject({ status: 'too_far', reason: 'Source foot: 2m west. Approach from Northern Ridge.' })
    state.player.position = { ...site.from }
    expect(preview()).toMatchObject({ status: 'ready', reason: 'Ready to build.' })
    state.resources[0].position = { ...site.from }
    expect(preview()).toMatchObject({ status: 'obstructed', reason: 'Clear the resource from this site.' })
    state.resources[0].depleted = true
    state.routes.find((route) => route.id === site.routeId)!.siteId = site.id
    state.builtRouteIds.push(site.routeId)
    expect(preview()).toMatchObject({ status: 'built', reason: 'This route is complete here.' })
    state.routes.find((route) => route.id === site.routeId)!.siteId = 'highland_bridge:z:-10'
    expect(preview()).toMatchObject({ status: 'locked', reason: 'This route is complete at another site.' })
  })

  it('explains which prerequisite unlocks the Highland bridge', () => {
    const state = createGeneratedWorld('greenway-alpha')
    const bridgeId = 'highland_bridge:z:-8'
    expect(routeBuildOptions(state).find((option) => option.id === bridgeId)).toMatchObject({
      status: 'locked', reason: 'Build the Greenway ladder first.',
    })
    const withLadder = provision(state, 'highland_bridge')
    withLadder.player.xp = 0
    withLadder.player.level = 1
    withLadder.unlockedRecipeIds = withLadder.unlockedRecipeIds.filter((id) => id !== 'highland_bridge')
    expect(routeBuildOptions(withLadder).find((option) => option.id === bridgeId)).toMatchObject({
      status: 'locked', reason: 'Reach level 2 to unlock this route.',
    })
  })

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)(
    'includes the legacy anchors and correct area-side endpoints in %s', (profile) => {
      const state = createGeneratedWorld('greenway-alpha', profile)
      const sites = canonicalRouteSites(state)
      const ladder = sites.find((site) => site.id === 'greenway_ladder:x:0')!
      const bridge = sites.find((site) => site.id === 'highland_bridge:z:-8')!
      expect(ladder).toMatchObject({ routeId: 'greenway_ladder', from: { x: 0, z: -4 }, to: { x: 0, z: -8 } })
      expect(bridge).toMatchObject({ routeId: 'highland_bridge', from: { x: 4, z: -8 }, to: { x: 6, z: -8 } })
      expect(ladder.from).toEqual(state.routes[0].from)
      expect(ladder.to).toEqual(state.routes[0].to)
      expect(bridge.from).toEqual(state.routes[1].from)
      expect(bridge.to).toEqual(state.routes[1].to)
      for (const site of sites) {
        const route = state.routes.find((candidate) => candidate.id === site.routeId)!
        expect(areaAt(state.areas, site.from.x, site.from.z).id).toBe(route.fromAreaId)
        expect(areaAt(state.areas, site.to.x, site.to.z).id).toBe(route.toAreaId)
      }
      expect(new Set(sites.map((site) => site.id)).size).toBe(sites.length)
      expect(sites.filter((site) => site.routeId === 'greenway_ladder').length).toBeGreaterThan(2)
      expect(sites.filter((site) => site.routeId === 'highland_bridge').length).toBeGreaterThan(2)
    },
  )

  it.each(['greenway-classic-v1', 'greenway-expanded-v1'] as const)(
    'offers at least two physically usable placements per route across seeds in %s', (profile) => {
      const shortages: string[] = []
      for (const seed of seeds) for (const routeId of ['greenway_ladder', 'highland_bridge'] as const) {
        const prepared = provision(createGeneratedWorld(seed, profile), routeId)
        const ready = canonicalRouteSites(prepared).filter((site) => site.routeId === routeId && readyAt(prepared, site))
        if (seed === 'greenway-alpha' && routeId === 'greenway_ladder') {
          expect(ready.map((site) => site.id)).toEqual(expect.arrayContaining(['greenway_ladder:x:-2', 'greenway_ladder:x:2']))
        }
        if (ready.length < 2) shortages.push(`${seed}:${routeId}:${ready.length}`)
      }
      expect(shortages).toEqual([])
    },
  )

  it('lets a depleted resource free an otherwise usable site without changing its ID or geometry', () => {
    const state = provision(createGeneratedWorld('route-1'), 'greenway_ladder')
    const site = canonicalRouteSites(state).find((candidate) => candidate.routeId === 'greenway_ladder'
      && candidate.id !== 'greenway_ladder:x:0' && readyAt(state, candidate))!
    state.player.position = { ...site.from }
    state.resources[0].position = { ...site.from }
    expect(routeBuildOptions(state).find((option) => option.id === site.id)).toMatchObject({ status: 'obstructed' })
    state.resources[0].depleted = true
    expect(routeBuildOptions(state).find((option) => option.id === site.id)).toMatchObject({ status: 'ready' })
    expect(canonicalRouteSites(state).find((candidate) => candidate.id === site.id)).toEqual(site)
  })
})
