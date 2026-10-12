import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { ironHallSite } from './domain/ironHallSite'
import { previewPublicV41CombatAction } from './domain/publicWorldV41CombatAction'
import type { PublicV41CombatProgress, PublicV41CombatWitness } from './domain/publicWorldV41CombatAction'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from './domain/worldChunks'
import { publicV41IronHallRejectionHint } from './view/publicV41IronHallQuest'
import type { WizardViewProjection } from './view/contracts'

/** A discovery-gated world cue. Combat state and outcomes remain checked-writer owned. */
export function projectPublicV41IronHall(progress: PublicV41CombatProgress,
  carrier: WizardViewProjection): WizardViewProjection {
  const site = ironHallSite(progress)
  const revealed = !!site && discoveryMaskHasTileId(progress.state.discoveryMask, site.alcove.id)
  const marker = site && revealed ? {
    alcove: [site.alcove.center.x, site.alcove.center.y, site.alcove.center.z] as const,
    ward: [site.ward.center.x, site.ward.center.y, site.ward.center.z] as const,
    door: [site.door.center.x, site.door.center.y, site.door.center.z] as const,
    revealed: true,
  } : null
  const preview = (kind: PublicV41CombatWitness['kind']) => {
    const rejection = previewPublicV41CombatAction(progress, { kind }).rejection
    return { rejection, hint: rejection ? publicV41IronHallRejectionHint(rejection) : null }
  }
  const hall = progress.ironHall
  const overview = carrier.map.overview
  const chunkMeters = WORLD_CELL_METERS * WORLD_CHUNK_CELLS
  const chunkX = site ? Math.floor(site.alcove.center.x / chunkMeters) : 0
  const chunkZ = site ? Math.floor(site.alcove.center.z / chunkMeters) : 0
  const projected: WizardViewProjection = { ...carrier,
    v41IronHallSite: marker,
    v41IronHall: { health: hall.playerHealth, wardHealth: hall.wardHealth,
      phase: hall.phase, phaseUntilTick: hall.phaseUntilTick,
      learnedBolt: hall.learnedBolt, wardDefeated: hall.wardDefeated,
      study: preview('ironhall-study/v1'), engage: preview('ironhall-engage/v1'),
      bolt: preview('ironhall-bolt/v1'), guard: preview('ironhall-guard/v1'),
      rest: preview('ironhall-rest/v1') },
    ...(revealed && overview ? { map: { ...carrier.map, overview: () => {
      const shown = overview()
      return { ...shown, cells: shown.cells.map((cell) => cell.gridX === chunkX
        && cell.gridZ === chunkZ && cell.discoveredCells > 0
        ? { ...cell, markers: [...cell.markers, 'Iron Hall'] } : cell) }
    } } } : {}),
  }
  return projected
}
