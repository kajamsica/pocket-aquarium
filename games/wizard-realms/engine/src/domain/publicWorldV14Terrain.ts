import { createActiveWorldTerrain } from './activeWorldTerrain'
import type { ReadonlyWorldTile } from './activeWorldTerrain'
import { discoveredTileIdsInActiveWindow } from './publicV13DiscoveryWindow'
import { createPublicV11RouteSupport } from './publicV11RouteSupport'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { STARTER_CLIFF_PROFILE, starterCliffTile } from './starterCliffProfile'
import { isValidTerrainWorkLedger } from './terrainWorkLedger'
import { createTerrainWorkRuntimeHooks } from './terrainWorkRuntimeHooks'
import { terrainWorkSupportAt } from './terrainWorkSupport'
import { resolveTerrainWorkSite } from './terrainWorks'
import type { TerrainWorkSite } from './terrainWorks'
import { resolvePublicV23Site } from './publicWorldV23Sites'
import { createStreamedWorldFromState } from './streamedWorld'
import type { StreamedWorldRuntime, StreamedWorldTrialHooks } from './streamedWorld'
import type { WorldTile } from './types'
import { WORLD_CELL_METERS } from './worldChunks'

type BuiltWork = Exclude<TerrainWorkSite, { kind: 'dig' }>
type Point = Readonly<{ x: number; z: number }>
// At a 64 m chunk seam the nearest tile can belong to the adjacent chunk.
const surfaceTileCenter = (point: Point): Point => ({
  x: Math.ceil(point.x / WORLD_CELL_METERS - 0.5) * WORLD_CELL_METERS,
  z: Math.ceil(point.z / WORLD_CELL_METERS - 0.5) * WORLD_CELL_METERS,
})
export type PublicV14Surface = Readonly<{
  tileId: string
  /** Tile Y after cache pit, starter cliff, and dug-work overlays. */
  terrainY: number
  floorY: number
  support: 'terrain' | 'work' | 'authored_route'
}>

function regionalLadders(seed: string, ids: readonly string[]): BuiltWork[] {
  if (!Array.isArray(ids) || ids.length > 32) throw new RangeError('Invalid regional ladder ledger.')
  return ids.map((id, index) => {
    if (typeof id !== 'string' || index > 0 && ids[index - 1] >= id) {
      throw new RangeError('Invalid regional ladder ledger.')
    }
    const site = resolvePublicV23Site(seed, id)
    if (!site) throw new RangeError('Invalid regional ladder ID.')
    return { ...site, obstacle: 'slate_cliff' as const }
  })
}

function projection(state: PublicV14State, regional: readonly BuiltWork[] = []) {
  if (state.generationProfile !== STARTER_CLIFF_PROFILE) {
    throw new RangeError('A starter-cliff profile is required.')
  }
  const seed = state.seed
  const context = { seed, fieldCampTileIds: state.fieldCampTileIds,
    authoredBuiltRouteIds: [state.mireglass.builtRoutes.bridge,
      state.mireglass.builtRoutes.ladder].filter((id): id is string => id !== null) }
  if (!isValidTerrainWorkLedger(state.terrainWorks, context)) {
    throw new RangeError('Invalid v14 terrain-work ledger.')
  }
  const built = state.terrainWorks.builtWorkIds.map((id) => resolveTerrainWorkSite(seed, id))
  if (built.some((site) => !site || site.kind === 'dig')) {
    throw new RangeError('Invalid v14 built terrain work.')
  }
  const sites = [...(built as BuiltWork[]), ...regional]
  const dug = new Set(state.terrainWorks.dugTileIds)
  const work = createTerrainWorkRuntimeHooks(() => sites, () => dug).hooks
  // The old helper owns only Mireglass bridge/ladder geometry here. An empty
  // Greenway built list prevents its legacy four-meter ladder from appearing.
  const authored = createPublicV11RouteSupport({ ...state,
    generationProfile: 'greenway-expanded-v1',
    greenway: { ...state.greenway, builtRouteIds: [] }, discoveredTileIds: [] })
  const facts = { cachePitDug: state.mireglass.cacheExcavated, highlandRidge: true as const,
    routeSupport: authored }
  const cliffCache = new WeakMap<ReadonlyWorldTile, ReadonlyWorldTile>()
  const cliffTile = (base: ReadonlyWorldTile): ReadonlyWorldTile => {
    const known = cliffCache.get(base)
    if (known) return known
    const elevated = starterCliffTile(seed, STARTER_CLIFF_PROFILE, base as WorldTile)
    const tile = elevated === base ? base : Object.freeze({ ...elevated,
      center: Object.freeze({ ...elevated.center }) })
    cliffCache.set(base, tile)
    return tile
  }
  let activeBase: readonly ReadonlyWorldTile[] | null = null
  let activeCliff: readonly ReadonlyWorldTile[] = []
  const hooks: StreamedWorldTrialHooks = {
    barrier: work.barrier,
    tile: (base) => work.tile(cliffTile(base)),
    activeTiles(base) {
      if (base !== activeBase) {
        activeBase = base
        activeCliff = base.map(cliffTile)
      }
      return work.activeTiles(activeCliff)
    },
    groundY: work.groundY,
    supportsStep: work.supportsStep,
  }
  const surface = (base: ReadonlyWorldTile, point: Point): PublicV14Surface => {
    const tile = hooks.tile(base)
    const workY = hooks.groundY(point, tile)
    const onRoute = authored.at(point)
    const authoredFloor = onRoute && (onRoute.route.kind === 'fen_bridge'
      || onRoute.route.kind === 'slate_ladder')
    return { tileId: tile.id, terrainY: tile.center.y,
      floorY: authored.floorY(point, workY),
      support: authoredFloor ? 'authored_route'
        : sites.some((site) => terrainWorkSupportAt(site, point).floorY !== null)
          ? 'work' : 'terrain' }
  }
  return { facts, hooks, surface }
}

/** Streamed-owner floor proof; Greenway ladder poses must use B instead. */
export function resolvePublicV14Surface(state: PublicV14State,
  position: Point): PublicV14Surface | null {
  try {
    const adapter = projection(state)
    const terrain = createActiveWorldTerrain(state.seed, adapter.facts)
    terrain.activate(surfaceTileCenter(position), 0)
    const tile = terrain.tileAtWorld(position.x, position.z)
    return tile ? adapter.surface(tile, position) : null
  } catch { return null }
}

/** Dormant stream reader; only use as movement authority outside Greenway. */
export function createPublicV14StreamTerrain(state: PublicV14State): StreamedWorldRuntime {
  const adapter = projection(state)
  const player = state.player
  const known = discoveredTileIdsInActiveWindow(state.discoveryMask, player.position)
  return createStreamedWorldFromState({ seed: state.seed, tick: state.tick,
    player: { position: player.position, yaw: player.yaw, pitch: player.pitch,
      verticalVelocity: player.verticalVelocity }, discoveredTileIds: known },
  adapter.facts, adapter.hooks)
}

/** V23 movement authority consumes only canonical, persisted regional IDs. */
export function resolvePublicV23Surface(state: PublicV14State, position: Point,
  builtLadderIds: readonly string[]): PublicV14Surface | null {
  try {
    const adapter = projection(state, regionalLadders(state.seed, builtLadderIds))
    const terrain = createActiveWorldTerrain(state.seed, adapter.facts)
    terrain.activate(surfaceTileCenter(position), 0)
    const tile = terrain.tileAtWorld(position.x, position.z)
    return tile ? adapter.surface(tile, position) : null
  } catch { return null }
}

export function createPublicV23StreamTerrain(state: PublicV14State,
  builtLadderIds: readonly string[]): StreamedWorldRuntime {
  const adapter = projection(state, regionalLadders(state.seed, builtLadderIds))
  const player = state.player
  const known = discoveredTileIdsInActiveWindow(state.discoveryMask, player.position)
  return createStreamedWorldFromState({ seed: state.seed, tick: state.tick,
    player: { position: player.position, yaw: player.yaw, pitch: player.pitch,
      verticalVelocity: player.verticalVelocity }, discoveredTileIds: known },
  adapter.facts, adapter.hooks)
}
