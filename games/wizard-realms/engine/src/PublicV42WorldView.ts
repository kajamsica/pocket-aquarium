import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { highlandRidgeMoveBarrier } from './domain/highlandRidge'
import { ironHallQuartermasterSite } from './domain/ironHallQuartermasterSite'
import { mireglassFrontierRoute, mireglassFullApproachTrail, mireglassV42BridgeId,
  mireglassV42FullApproachTrail } from './domain/mireglassApproachTrail'
import { mireglassMoveBarrier } from './domain/mireglassMovementGate'
import { PUBLIC_V16_GREENWAY_CENTER_BRIDGE_ID } from './domain/publicWorldV16GreenwaySites'
import { publicV25RiverTouchesSegment } from './domain/publicWorldV25RiverSweep'
import { previewPublicV42IronHallActions } from './domain/publicWorldV42RewardAction'
import type { PublicV42RewardProgress, PublicV42RewardRejection } from './domain/publicWorldV42RewardAction'
import { waystationRiverSite } from './domain/waystationRiverContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './domain/worldChunks'
import { projectPublicV41IronHall } from './PublicV41WorldView'
import { publicV42IronHallRejectionHint } from './view/publicV42IronHallQuest'
import type { WizardViewProjection } from './view/contracts'

const tileId = (point: { x: number; z: number }) =>
  `tile-${Math.ceil(point.x / 4 - 0.5) + 3}-${Math.ceil(point.z / 4 - 0.5) + 3}`
const chunkMeters = 64
const v42CenterBridgeId = 'works4:bridge:greenway-creek:0'
const routeCueCache = new Map<string, ReturnType<typeof routeCueForUncached>>()
function routeCueForUncached(seed: string, bridgeId: string) {
  const route = mireglassFrontierRoute(seed, bridgeId)
  const v42Points = mireglassV42FullApproachTrail(seed, bridgeId)
  const v42Trail = new Set(v42Points.map(tileId))
  const legacyOnlyPoints = mireglassFullApproachTrail(seed)
    .filter((point) => !v42Trail.has(tileId(point)))
  const deckTileIds = new Set(route.points.slice(2, 4).map(tileId))
  return { route, v42Points, v42Trail, legacyOnlyPoints, deckTileIds }
}
function routeCueFor(seed: string, bridgeId: string) {
  const key = JSON.stringify([seed, bridgeId])
  const cached = routeCueCache.get(key)
  if (cached) return cached
  const cue = routeCueForUncached(seed, bridgeId)
  routeCueCache.set(key, cue)
  if (routeCueCache.size > 8) routeCueCache.delete(routeCueCache.keys().next().value!)
  return cue
}
const bridgeGuidance = (built: boolean, center: boolean) => {
  const label = center ? 'center Greenway creek bridge' : 'Greenway creek bridge'
  return built
    ? `Mireglass route: cross the built ${label}, then follow the revealed dry frontier trail to the marker.`
    : `Mireglass route: build the ${label} before crossing, then follow the revealed dry frontier trail to the marker.`
}

const copperleafRouteCache = new Map<string, ReturnType<typeof copperleafRouteUncached>>()
function copperleafRouteUncached(seed: string) {
  const site = waystationRiverSite(seed)
  if (!site || site.exit.x > 192 || site.exit.z > 48
    || site.exit.x % WORLD_CELL_METERS || site.exit.z % WORLD_CELL_METERS) return null
  const gridPoints: { x: number; z: number }[] = []
  for (let z = site.exit.z; z <= 48; z += WORLD_CELL_METERS) {
    gridPoints.push({ x: site.exit.x, z })
  }
  for (let x = site.exit.x + WORLD_CELL_METERS; x <= 192; x += WORLD_CELL_METERS) {
    gridPoints.push({ x, z: 48 })
  }
  for (let z = 48 + WORLD_CELL_METERS; z <= 96; z += WORLD_CELL_METERS) {
    gridPoints.push({ x: 192, z })
  }
  try {
    const tiles = gridPoints.map((point) => worldTileAtGrid(seed,
      point.x / WORLD_CELL_METERS, point.z / WORLD_CELL_METERS))
    if (tiles.some((tile) => tile.terrain !== 'loam'
      || tile.biome !== 'temperate_forest')) return null
    for (let index = 1; index < tiles.length; index++) {
      const before = tiles[index - 1].center
      const after = tiles[index].center
      if (Math.abs(after.y - before.y) > 0.55
        || publicV25RiverTouchesSegment(seed, before, after)
        || highlandRidgeMoveBarrier(before, after)
        || mireglassMoveBarrier(seed, before, after)) return null
    }
    return { bridgeId: site.id, tileIds: new Set(tiles.map((tile) => tile.id)),
      gladeTileId: tiles[tiles.length - 1].id }
  } catch { return null }
}
function copperleafRoute(seed: string) {
  if (copperleafRouteCache.has(seed)) return copperleafRouteCache.get(seed)!
  const route = copperleafRouteUncached(seed)
  copperleafRouteCache.set(seed, route)
  if (copperleafRouteCache.size > 8) copperleafRouteCache.delete(copperleafRouteCache.keys().next().value!)
  return route
}

/** A post-Waystation map cue, never a new traversal or discovery authority. */
export function projectPublicV42CopperleafRoute(progress: PublicV42RewardProgress,
  carrier: WizardViewProjection): WizardViewProjection {
  if (!progress.southbankReached) return carrier
  const { state } = progress
  const route = copperleafRoute(state.seed)
  if (!route || !progress.riverBridgeIds.includes(route.bridgeId)) return carrier
  const known = (id: string) => discoveryMaskHasTileId(state.discoveryMask, id)
  const visible = (id: string) => route.tileIds.has(id) && known(id)
  const gladeKnown = known(route.gladeTileId)
  const onRoute = state.movementOwner === 'streamed'
    && visible(tileId(state.player.position))
  const shownTiles = carrier.map.tiles.map((tile) => tile.discovered && visible(tile.id)
    ? { ...tile, hasFrontierTrail: true } : tile)
  const anyShown = carrier.map.tiles.some((tile) => tile.discovered && visible(tile.id))
  const overview = carrier.map.overview
  return { ...carrier, map: { ...carrier.map,
    ...(onRoute && !carrier.map.guidancePriority
      ? { title: gladeKnown ? 'Copperleaf Hollow' : 'Southbank Woods' } : {}),
    ...(onRoute && !carrier.map.guidancePriority ? { guidance: gladeKnown
      ? 'Copperleaf Hollow found. Return north, west, then north along the discovered trail to the saved Windward Waystation river bridge.'
      : 'From the saved river bridge, follow discovered dry ground south, east, then south into the woods.' } : {}),
    ...(anyShown ? { legend: `${(carrier.map.legend ?? '▲ you · ? unexplored')
      .replace(/ · southbank trail/g, '')} · southbank trail` } : {}),
    tiles: shownTiles,
    ...(gladeKnown && overview ? { overview: () => {
      const shown = overview()
      return { ...shown, cells: shown.cells.map((cell) => cell.gridX === 3
        && cell.gridZ === 1 && cell.discoveredCells > 0
        && !cell.markers.includes('Copperleaf Hollow')
        ? { ...cell, markers: [...cell.markers, 'Copperleaf Hollow'] } : cell) }
    } } : {}),
  } }
}

/** Correct only V42 presentation; old saves retain their west-trail map contract. */
export function projectPublicV42FrontierRoute(progress: PublicV42RewardProgress,
  carrier: WizardViewProjection): WizardViewProjection {
  const { state } = progress
  const bridgeId = mireglassV42BridgeId(state.seed, progress.greenwayWorks.builtBridgeIds)
  const { route, v42Points, v42Trail, legacyOnlyPoints, deckTileIds } = routeCueFor(state.seed, bridgeId)
  const built = progress.greenwayWorks.builtBridgeIds.includes(route.requiredBridgeId)
  const center = bridgeId === v42CenterBridgeId
    || bridgeId === PUBLIC_V16_GREENWAY_CENTER_BRIDGE_ID
  const learned = state.greenway.studiedInscriptionIds.includes('greenway_waystone')
  const bridgeTileId = tileId(route.points[1])
  const nearPlayer = (point: { x: number; z: number }) => Math.hypot(
    state.player.position.x - point.x, state.player.position.z - point.z) <= 8
  const onNewTrail = state.movementOwner === 'streamed' && v42Points.some(nearPlayer)
  const onOldConnector = state.movementOwner === 'streamed' && !onNewTrail
    && legacyOnlyPoints.some(nearPlayer)
  const staleGuidance = /West to Mireglass:|west trail to Mireglass|dry west trail|dry west exit|west from Greenway into Mireglass|Mireglass remains west/i
  const replaceOld = (value: string) => value.replace(
    /West to Mireglass:[^.!?]*[.!?]?|Follow the west trail to Mireglass[^.!?]*[.!?]?|Follow the dry west trail[^.!?]*[.!?]?|Dry west exit[^.!?]*[.!?]?|Follow the revealed dry trail west from Greenway into Mireglass[^.!?]*[.!?]?|Mireglass remains west[.!?]?/gi,
    bridgeGuidance(built, center))
  const guidance = onNewTrail && !state.mireglass.fringeMarkerStudied
    ? bridgeGuidance(built, center)
    : staleGuidance.test(carrier.map.guidance ?? '')
      ? replaceOld(carrier.map.guidance!) : carrier.map.guidance
  const overview = carrier.map.overview
  const legend = (carrier.map.legend ?? '▲ you · ? unexplored')
    .replace(/ · ⇦ west trail to Mireglass/g, '')
  const bridgeChunkX = Math.floor(route.points[1].x / chunkMeters)
  const bridgeChunkZ = Math.floor(route.points[1].z / chunkMeters)
  const landmarkVisible = (entry: { id: string }) => entry.id !== 'greenway/landmark/west_trail_gate'
  const projected: WizardViewProjection = { ...carrier,
    v42FrontierBridgeId: bridgeId,
    landmarks: carrier.landmarks?.filter(landmarkVisible),
    ...(carrier.savedTerrainWorks?.preview?.guidance
      && staleGuidance.test(carrier.savedTerrainWorks.preview.guidance)
      ? { savedTerrainWorks: { ...carrier.savedTerrainWorks,
        preview: { ...carrier.savedTerrainWorks.preview,
          guidance: replaceOld(carrier.savedTerrainWorks.preview.guidance) } } } : {}),
    ...(carrier.visualWorld ? { visualWorld: { ...carrier.visualWorld,
      landmarks: carrier.visualWorld.landmarks.filter(landmarkVisible) } } : {}),
    ...(carrier.v36MarkerQuest?.stage === 'trail' ? { v36MarkerQuest: {
      ...carrier.v36MarkerQuest,
      objective: `${bridgeGuidance(built, center)} The map and visible stone landmark guide the route.`,
    } } : {}),
    map: { ...carrier.map,
      ...(onNewTrail ? { title: 'Mireglass Reach' }
        : onOldConnector && carrier.map.title === 'Mireglass Reach'
          || onOldConnector && carrier.map.title === 'mireglass_reach'
          ? { title: 'Open Wilderness' } : {}),
      guidance,
      legend: learned
        ? `${legend} · ⇣ ${center ? 'center creek' : 'Greenway creek'} bridge toward Mireglass ${built ? '(built)' : '(build before crossing)'}`
        : legend,
      tiles: carrier.map.tiles.map((tile) => ({ ...tile,
        hasWestTrail: false,
        hasCenterBridgeRoute: learned && tile.id === bridgeTileId,
        hasFrontierTrail: tile.discovered && v42Trail.has(tile.id)
          && (built || !deckTileIds.has(tile.id)),
      })),
      ...(overview && learned ? { overview: () => {
        const shown = overview()
        return { ...shown, cells: shown.cells.map((cell) => {
          const markers = cell.markers.filter((label) => label !== 'West trail to Mireglass')
          if (cell.gridX === bridgeChunkX && cell.gridZ === bridgeChunkZ) markers.push(
            built ? `${center ? 'Center creek' : 'Greenway creek'} bridge to Mireglass built`
              : `${center ? 'Center creek' : 'Greenway creek'} bridge to Mireglass (build required)`)
          return markers.length === cell.markers.length && markers.every((label, index) =>
            label === cell.markers[index]) ? cell : { ...cell, markers }
        }) }
      } } : {}),
    },
  }
  return projectPublicV42CopperleafRoute(progress, projected)
}

/** Discovery-gated presentation of the V42 writer's reward state and preflight. */
export function projectPublicV42IronHall(progress: PublicV42RewardProgress,
  carrier: WizardViewProjection): WizardViewProjection {
  const { combat, reward: [claim, equip, unequip, repair, sparStart] } =
    previewPublicV42IronHallActions(progress)
  const inherited = projectPublicV42FrontierRoute(progress,
    projectPublicV41IronHall(progress, carrier, combat))
  const site = ironHallQuartermasterSite(progress)
  const revealed = !!site && discoveryMaskHasTileId(progress.state.discoveryMask, site.id)
  const preview = (rejection: PublicV42RewardRejection | null) => {
    return { rejection, hint: rejection ? publicV42IronHallRejectionHint(rejection) : null }
  }
  const reward = progress.ironHallReward
  return { ...inherited,
    v42QuartermasterSite: site && revealed
      ? { position: [site.center.x, site.center.y, site.center.z], revealed: true }
      : null,
    v42IronHall: {
      crestOutcome: reward.crestOutcome,
      questClaimed: reward.questClaimed,
      vestOwned: reward.vestOwned,
      vestEquipped: reward.vestEquipped,
      vestDurability: reward.vestDurability,
      spar: reward.spar,
      claim: preview(claim.rejection), equip: preview(equip.rejection),
      unequip: preview(unequip.rejection), repair: preview(repair.rejection),
      sparStart: preview(sparStart.rejection),
    },
  }
}
