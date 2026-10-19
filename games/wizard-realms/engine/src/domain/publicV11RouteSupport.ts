import { canonicalRouteSites } from './routeSites'
import { mireglassRouteSites } from './mireglassRouteSites'
import { PUBLIC_RUN_STEP_METERS } from './publicWorldGait'
import type { PublicWorldV11State } from './publicWorldV11State'
import type { Vec3, WizardWorldState } from './types'

export type PublicV11RouteKind = 'greenway_ladder' | 'highland_bridge' | 'fen_bridge' | 'slate_ladder'
export type PublicV11BuiltRoute = Readonly<{
  id: string
  kind: PublicV11RouteKind
  from: Readonly<Vec3>
  to: Readonly<Vec3>
}>
export type PublicV11RoutePosition = Readonly<{
  route: PublicV11BuiltRoute
  progress: number
  floorY: number
}>
export interface PublicV11RouteSupport {
  at(position: { x: number; z: number }): PublicV11RoutePosition | null
  crossing(from: { x: number; z: number }, to: { x: number; z: number }): PublicV11BuiltRoute | null
  clearsMireglassBarrier(from: { x: number; z: number }, to: { x: number; z: number },
    barrier: 'fen_channel' | 'slate_cliff'): boolean
  floorY(position: { x: number; z: number }, groundY: number): number
}

type RouteState = Pick<PublicWorldV11State, 'seed' | 'generationProfile' | 'greenway' | 'mireglass'
  | 'tick' | 'rng' | 'eventSequence' | 'player' | 'discoveredTileIds'>

function builtRoutes(state: RouteState): PublicV11BuiltRoute[] {
  const legacy = state.greenway.builtRouteIds.length === 0 ? [] : canonicalRouteSites({
    ...state.greenway, seed: state.seed, generationProfile: state.generationProfile,
    tick: state.tick, rng: state.rng, eventSequence: state.eventSequence,
    player: state.player, discoveredTileIds: state.discoveredTileIds } as WizardWorldState).filter((site) =>
    state.greenway.builtRouteIds.includes(site.routeId)
    && state.greenway.routes.some((route) => route.id === site.routeId && route.siteId === site.id))
    .map((site) => ({ id: site.id, kind: site.routeId, from: site.from, to: site.to }))
  const regional = mireglassRouteSites(state.seed).filter((site) =>
    state.mireglass.builtRoutes[site.kind] === site.id)
    .map((site) => ({ id: site.id,
      kind: site.kind === 'bridge' ? 'fen_bridge' as const : 'slate_ladder' as const,
      from: site.from, to: site.to }))
  return [...legacy, ...regional]
}

function halfWidthFor(route: PublicV11BuiltRoute): number {
  // The Greenway low treads are 1.5 m wide in the scene.
  return route.kind === 'slate_ladder' ? 0.43 : route.kind === 'fen_bridge' ? 0.72
    : route.kind === 'greenway_ladder' ? 0.75 : 0.7
}

function positionOn(route: PublicV11BuiltRoute, position: { x: number; z: number }): PublicV11RoutePosition | null {
  const dx = route.to.x - route.from.x
  const dz = route.to.z - route.from.z
  const length = Math.hypot(dx, dz)
  const along = ((position.x - route.from.x) * dx + (position.z - route.from.z) * dz) / length
  const side = Math.abs((position.x - route.from.x) * dz - (position.z - route.from.z) * dx) / length
  if (along < -1e-8 || along > length + 1e-8 || side > halfWidthFor(route) + 1e-8) return null
  const progress = Math.max(0, Math.min(1, along / length))
  // The Slate ladder is a steep, 0.65 m structure at the tile seam, not a 4 m ramp.
  const climb = route.kind === 'slate_ladder'
    ? Math.max(0, Math.min(1, (along - (length - 0.65) / 2) / 0.65)) : progress
  const elevation = route.to.y - route.from.y
  const deckCrown = route.kind === 'fen_bridge' ? 0.16 * Math.sin(Math.PI * progress) : 0
  return { route, progress, floorY: route.from.y + elevation * climb + deckCrown }
}

/** One fixed step may straddle a legacy route endpoint and its area seam. */
function nearLegacyEndpoint(route: PublicV11BuiltRoute, position: { x: number; z: number }): boolean {
  if (route.kind !== 'greenway_ladder' && route.kind !== 'highland_bridge') return false
  const dx = route.to.x - route.from.x
  const dz = route.to.z - route.from.z
  const length = Math.hypot(dx, dz)
  const along = ((position.x - route.from.x) * dx + (position.z - route.from.z) * dz) / length
  const side = Math.abs((position.x - route.from.x) * dz - (position.z - route.from.z) * dx) / length
  return along >= -PUBLIC_RUN_STEP_METERS - 1e-8
    && along <= length + PUBLIC_RUN_STEP_METERS + 1e-8
    && side <= halfWidthFor(route) + 1e-8
}

/** Route occupancy is reconstructed from selected built IDs, never saved as another state field. */
export function createPublicV11RouteSupport(state: RouteState): PublicV11RouteSupport {
  const routes = builtRoutes(state)
  const at = (position: { x: number; z: number }) => {
    for (const route of routes) {
      const found = positionOn(route, position)
      if (found) return found
    }
    return null
  }
  const crossing = (from: { x: number; z: number }, to: { x: number; z: number }) => {
    for (const route of routes) {
      const start = positionOn(route, from)
      const end = positionOn(route, to)
      if (start && end) return route
      if ((start || end)
        && Math.hypot(to.x - from.x, to.z - from.z) <= PUBLIC_RUN_STEP_METERS + 1e-8
        && nearLegacyEndpoint(route, from)
        && nearLegacyEndpoint(route, to)) return route
    }
    return null
  }
  return {
    at, crossing,
    clearsMireglassBarrier(from, to, barrier) {
      const route = crossing(from, to)
      return route !== null && (barrier === 'fen_channel' && route.kind === 'fen_bridge'
        || barrier === 'slate_cliff' && route.kind === 'slate_ladder')
    },
    floorY(position, groundY) {
      const support = at(position)
      return support && (support.route.kind === 'fen_bridge' || support.route.kind === 'slate_ladder')
        ? support.floorY : groundY
    },
  }
}

/** UI can derive climb/bridge presentation from the same selected built route support. */
export function publicV11RouteAtPosition(state: RouteState,
  position: { x: number; z: number }): PublicV11RoutePosition | null {
  return createPublicV11RouteSupport(state).at(position)
}
