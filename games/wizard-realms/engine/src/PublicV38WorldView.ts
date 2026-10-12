import { discoveryMaskHasTileId } from './domain/discoveryMask'
import { HIGHLAND_SIGNAL_BEARING, highlandSignalVane } from './domain/highlandSignalContent'
import { previewPublicV38SignalAction } from './domain/publicWorldV38SignalAction'
import type { PublicV38SignalProgress, PublicV38SignalRejection } from './domain/publicWorldV38SignalAction'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from './domain/worldChunks'
import { publicV38SignalQuest } from './view/publicV38SignalQuest'
import type { WizardViewProjection } from './view/contracts'

const hints: Record<PublicV38SignalRejection, string> = {
  invalid_value: 'This Signal action cannot be checked. Reload before trying again.',
  invalid_progress: 'The checked adventure is unavailable. Reload before trying again.',
  unavailable_here: 'Travel to the dry Highland trail for this Signal step.',
  not_grounded: 'Land on supported dry ground before using the Signal.',
  undiscovered: 'Study Quarry Crown before inspecting the Signal vane.',
  unrevealed: 'Explore until the landmark is revealed on your map.',
  too_far: 'Move within 3 m of the landmark before using this action.',
  not_learned: 'Study the Windward Step glyph at Quarry Crown first.',
  not_active: 'Cast Windward Step on the dry Highland trail, then inspect the vane.',
  not_practiced: 'Walk a real Windward-assisted westbound step on the final dry approach.',
  already_inspected: 'The Signal vane was already inspected. Return to Quarry Crown.',
  requires_vantage: 'Inspect the Signal vane before claiming at Quarry Crown.',
  already_claimed: 'The Signal reward was already claimed and saved.',
}

/** Only checked progress can reveal the optional chapter or its map bearing. */
export function projectPublicV38Signal(progress: PublicV38SignalProgress,
  base: WizardViewProjection): WizardViewProjection {
  const vane = highlandSignalVane(progress.state.seed)
  const known = discoveryMaskHasTileId(progress.state.discoveryMask, vane.tile.id)
  const projected: WizardViewProjection = { ...base,
    v38SignalVane: known ? { position: [vane.tile.center.x, vane.tile.center.y,
      vane.tile.center.z], inspected: progress.signalVantageInspected } : null }
  const inspect = previewPublicV38SignalAction(progress, { kind: 'signal-vantage/v1' }).rejection
  const claim = previewPublicV38SignalAction(progress, { kind: 'signal-claim/v1' }).rejection
  const quest = publicV38SignalQuest(projected, {
    signalVantageInspected: progress.signalVantageInspected,
    signalClaimed: progress.signalClaimed,
    practicedRouteIndices: progress.state.windstep.practicedRouteIndices,
    inspect: { rejection: inspect, hint: inspect ? hints[inspect] : null },
    claim: { rejection: claim, hint: claim ? hints[claim] : null },
  })
  const overview = base.map.overview
  const chunkMeters = WORLD_CELL_METERS * WORLD_CHUNK_CELLS
  const bearingChunkX = Math.floor(HIGHLAND_SIGNAL_BEARING.x / chunkMeters)
  const bearingChunkZ = Math.floor(HIGHLAND_SIGNAL_BEARING.z / chunkMeters)
  return { ...projected, v38SignalQuest: quest,
    ...(progress.signalClaimed && overview ? { map: { ...base.map,
      overview: () => { const shown = overview(); return { ...shown,
        cells: shown.cells.map((cell) => cell.gridX === bearingChunkX
          && cell.gridZ === bearingChunkZ ? { ...cell,
            markers: [...cell.markers, `${HIGHLAND_SIGNAL_BEARING.label} bearing (clue)`] } : cell) } } } }
      : {}),
  }
}
