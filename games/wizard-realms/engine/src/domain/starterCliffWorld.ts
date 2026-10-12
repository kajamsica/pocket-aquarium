import { createGeneratedWorld, terrainHeightAt } from './generation'
import { STARTER_CLIFF_PROFILE, starterCliffCanonicalFace, starterCliffCanonicalSite,
  starterCliffTile } from './starterCliffProfile'
import type { StarterCliffFace } from './starterCliffProfile'
import type { RouteSite, Vec3, WizardWorldState, WorldTile } from './types'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN, worldChunk,
  worldTileAtGrid } from './worldChunks'
import type { WorldChunk } from './worldChunks'

/** Unsaved construction facts for a future versioned root, never a v5 save. */
export type StarterCliffGreenwayFacts = Readonly<{
  seed: string
  profile: typeof STARTER_CLIFF_PROFILE
  tiles: WizardWorldState['tiles']
  resources: WizardWorldState['resources']
  stores: WizardWorldState['stores']
  fairyRings: WizardWorldState['fairyRings']
  inscriptions: WizardWorldState['inscriptions']
  digSites: WizardWorldState['digSites']
  routes: WizardWorldState['routes']
  playerStart: Vec3
  routeSites: readonly RouteSite[]
  ladderFace: StarterCliffFace
}>

function normalizedSeed(seed: string): string {
  if (typeof seed !== 'string') throw new TypeError('Starter cliff seed must be a string.')
  return seed || 'wizard-realms'
}

/** Same canonical cell IDs and climate as the streamed world, with only this profile's uplift. */
export function starterCliffWorldTileAtGrid(seed: string, gx: number, gz: number): WorldTile {
  const sourceSeed = normalizedSeed(seed)
  return starterCliffTile(sourceSeed, STARTER_CLIFF_PROFILE, worldTileAtGrid(sourceSeed, gx, gz))
}

/** Generation-only height lookup. Ticket B owns support floors and collision. */
export function starterCliffGroundYAt(seed: string, x: number, z: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  const gx = Math.ceil(x / WORLD_CELL_METERS - 0.5)
  const gz = Math.ceil(z / WORLD_CELL_METERS - 0.5)
  if (gx < WORLD_GRID_MIN || gx > WORLD_GRID_MAX || gz < WORLD_GRID_MIN || gz > WORLD_GRID_MAX) return null
  return starterCliffWorldTileAtGrid(seed, gx, gz).center.y
}

/** A bounded scene/runtime chunk reader for the future profile, with legacy chunks untouched. */
export function starterCliffWorldChunk(seed: string, chunkX: number, chunkZ: number): WorldChunk {
  const sourceSeed = normalizedSeed(seed)
  const base = worldChunk(sourceSeed, chunkX, chunkZ)
  return { chunkX, chunkZ, tiles: base.tiles.map((tile) =>
    starterCliffTile(sourceSeed, STARTER_CLIFF_PROFILE, tile)) }
}

/**
 * Pure v14 genesis input. The returned geometry must be merged only by a new-root
 * constructor; it is deliberately not a restorable legacy WizardWorldState.
 */
export function createStarterCliffGreenwayFacts(seed: string): StarterCliffGreenwayFacts {
  const sourceSeed = normalizedSeed(seed)
  const baseline = createGeneratedWorld(sourceSeed, 'greenway-expanded-v1')
  const tiles = baseline.tiles.map((tile) => starterCliffTile(sourceSeed, STARTER_CLIFF_PROFILE, tile))
  const onGround = (point: Vec3): Vec3 => ({ x: point.x,
    y: terrainHeightAt(tiles, point.x, point.z), z: point.z })
  const routeSites = [starterCliffCanonicalSite(sourceSeed)]
  const routes = baseline.routes.map((route) => ({ ...route,
    from: onGround(route.from), to: onGround(route.to) }))
  return {
    seed: sourceSeed, profile: STARTER_CLIFF_PROFILE, tiles,
    resources: baseline.resources.map((resource) => ({ ...resource,
      position: onGround(resource.position) })),
    stores: [
      { ...baseline.stores[0], position: onGround(baseline.stores[0].position) },
      { ...baseline.stores[1], position: onGround(baseline.stores[1].position) },
    ],
    fairyRings: baseline.fairyRings.map((ring) => ({ ...ring, position: onGround(ring.position) })),
    inscriptions: baseline.inscriptions.map((inscription) => ({ ...inscription,
      position: onGround(inscription.position) })),
    digSites: baseline.digSites.map((site) => ({ ...site, position: onGround(site.position) })),
    routes, playerStart: onGround(baseline.player.position), routeSites,
    ladderFace: starterCliffCanonicalFace(sourceSeed),
  }
}
