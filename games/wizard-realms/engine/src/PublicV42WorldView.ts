import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { ironHallQuartermasterSite } from './domain/ironHallQuartermasterSite'
import { mireglassFrontierRoute, mireglassFullApproachTrail,
  mireglassV42FullApproachTrail } from './domain/mireglassApproachTrail'
import { previewPublicV42RewardActions } from './domain/publicWorldV42RewardAction'
import type { PublicV42RewardProgress, PublicV42RewardRejection } from './domain/publicWorldV42RewardAction'
import { projectPublicV41IronHall } from './PublicV41WorldView'
import { publicV42IronHallRejectionHint } from './view/publicV42IronHallQuest'
import type { WizardViewProjection } from './view/contracts'

const tileId = (point: { x: number; z: number }) =>
  `tile-${Math.ceil(point.x / 4 - 0.5) + 3}-${Math.ceil(point.z / 4 - 0.5) + 3}`
const chunkMeters = 64
const routeCueCache = new Map<string, ReturnType<typeof routeCueForUncached>>()
function routeCueForUncached(seed: string) {
  const route = mireglassFrontierRoute(seed)
  const v42Points = mireglassV42FullApproachTrail(seed)
  const v42Trail = new Set(v42Points.map(tileId))
  const legacyOnlyPoints = mireglassFullApproachTrail(seed)
    .filter((point) => !v42Trail.has(tileId(point)))
  const deckTileIds = new Set(route.points.slice(2, 4).map(tileId))
  return { route, v42Points, v42Trail, legacyOnlyPoints, deckTileIds }
}
function routeCueFor(seed: string) {
  const cached = routeCueCache.get(seed)
  if (cached) return cached
  const cue = routeCueForUncached(seed)
  routeCueCache.set(seed, cue)
  if (routeCueCache.size > 8) routeCueCache.delete(routeCueCache.keys().next().value!)
  return cue
}
const bridgeGuidance = (built: boolean) => built
  ? 'Mireglass route: cross the built center Greenway creek bridge, then follow the revealed dry frontier trail to the marker.'
  : 'Mireglass route: build the center Greenway creek bridge before crossing, then follow the revealed dry frontier trail to the marker.'

/** Correct only V42 presentation; old saves retain their west-trail map contract. */
export function projectPublicV42FrontierRoute(progress: PublicV42RewardProgress,
  carrier: WizardViewProjection): WizardViewProjection {
  const { state } = progress
  const { route, v42Points, v42Trail, legacyOnlyPoints, deckTileIds } = routeCueFor(state.seed)
  const built = progress.greenwayWorks.builtBridgeIds.includes(route.requiredBridgeId)
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
    bridgeGuidance(built))
  const guidance = onNewTrail && !state.mireglass.fringeMarkerStudied
    ? bridgeGuidance(built)
    : staleGuidance.test(carrier.map.guidance ?? '')
      ? replaceOld(carrier.map.guidance!) : carrier.map.guidance
  const overview = carrier.map.overview
  const legend = (carrier.map.legend ?? '▲ you · ? unexplored')
    .replace(/ · ⇦ west trail to Mireglass/g, '')
  const bridgeChunkX = Math.floor(route.points[1].x / chunkMeters)
  const bridgeChunkZ = Math.floor(route.points[1].z / chunkMeters)
  const landmarkVisible = (entry: { id: string }) => entry.id !== 'greenway/landmark/west_trail_gate'
  return { ...carrier,
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
      objective: `${bridgeGuidance(built)} The map and visible stone landmark guide the route.`,
    } } : {}),
    map: { ...carrier.map,
      ...(onNewTrail ? { title: 'Mireglass Reach' }
        : onOldConnector && carrier.map.title === 'Mireglass Reach'
          || onOldConnector && carrier.map.title === 'mireglass_reach'
          ? { title: 'Open Wilderness' } : {}),
      guidance,
      legend: learned
        ? `${legend} · ⇣ center creek bridge toward Mireglass (build before crossing)`
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
            built ? 'Center creek bridge to Mireglass built'
              : 'Center creek bridge to Mireglass (build required)')
          return markers.length === cell.markers.length && markers.every((label, index) =>
            label === cell.markers[index]) ? cell : { ...cell, markers }
        }) }
      } } : {}),
    },
  }
}

/** Discovery-gated presentation of the V42 writer's reward state and preflight. */
export function projectPublicV42IronHall(progress: PublicV42RewardProgress,
  carrier: WizardViewProjection): WizardViewProjection {
  const inherited = projectPublicV42FrontierRoute(progress,
    projectPublicV41IronHall(progress, carrier))
  const site = ironHallQuartermasterSite(progress)
  const revealed = !!site && discoveryMaskHasTileId(progress.state.discoveryMask, site.id)
  const [claim, equip, unequip, repair, sparStart] = previewPublicV42RewardActions(progress, [
    'ironhall-claim/v1', 'ironhall-vest-equip/v1', 'ironhall-vest-unequip/v1',
    'ironhall-vest-repair/v1', 'ironhall-spar/v1',
  ])
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
