import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { previewPublicV40WaystationAction } from './domain/publicWorldV40WaystationAction'
import type { PublicV40WaystationProgress } from './domain/publicWorldV40WaystationAction'
import { waystationRiverSite } from './domain/waystationRiverContent'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from './domain/worldChunks'
import { publicV40WaystationQuest, publicV40WaystationRejectionHint } from './view/publicV40WaystationQuest'
import type { WizardViewProjection } from './view/contracts'

/** V40 adds only discovery-gated cues. V28 remains the bridge geometry and Works authority. */
export function projectPublicV40Waystation(progress: PublicV40WaystationProgress,
  carrier: WizardViewProjection): WizardViewProjection {
  const site = waystationRiverSite(progress.state.seed)
  const approachTile = site?.footprintTileIds[0]
  const revealed = !!approachTile
    && discoveryMaskHasTileId(progress.state.discoveryMask, approachTile)
  const player = progress.state.player.position
  const nearApproach = !!site && revealed && progress.state.movementOwner === 'streamed'
    && Math.hypot(player.x - site.approach.x, player.z - site.approach.z) <= 12
  const built = !!site && progress.riverBridgeIds.includes(site.id)
  const marker = site && revealed ? { id: site.id,
    approach: [site.approach.x, site.approach.y, site.approach.z] as const,
    exit: [site.exit.x, site.exit.y, site.exit.z] as const,
    built, revealed: true } : null
  const overview = carrier.map.overview
  const chunkMeters = WORLD_CELL_METERS * WORLD_CHUNK_CELLS
  const chunkX = site ? Math.floor(site.approach.x / chunkMeters) : 0
  const chunkZ = site ? Math.floor(site.approach.z / chunkMeters) : 0
  const projected: WizardViewProjection = { ...carrier,
    ...(nearApproach ? { unavailableActions: undefined } : {}),
    v40WaystationSite: marker,
    map: { ...carrier.map,
      tiles: carrier.map.tiles.map((tile) => tile.id === approachTile && tile.discovered
        ? { ...tile, hasRouteSite: tile.hasRouteSite || !built,
          hasBuiltRoute: tile.hasBuiltRoute || built } : tile),
      ...(revealed && overview ? { overview: () => {
        const shown = overview()
        return { ...shown, cells: shown.cells.map((cell) => cell.gridX === chunkX
          && cell.gridZ === chunkZ && cell.discoveredCells > 0
          ? { ...cell, markers: [...cell.markers, 'Windward Waystation'] } : cell) }
      } } : {}),
    },
  }
  const preview = (kind: 'waystation-barter/v1' | 'waystation-cross/v1' | 'waystation-claim/v1') => {
    const rejection = previewPublicV40WaystationAction(progress, { kind }).rejection
    return { rejection, hint: rejection ? publicV40WaystationRejectionHint(rejection) : null }
  }
  return { ...projected, v40WaystationQuest: publicV40WaystationQuest(projected, {
    timberBartered: progress.timberBartered,
    southbankReached: progress.southbankReached,
    waystationClaimed: progress.waystationClaimed,
    barter: preview('waystation-barter/v1'),
    cross: preview('waystation-cross/v1'),
    claim: preview('waystation-claim/v1'),
  }) }
}
