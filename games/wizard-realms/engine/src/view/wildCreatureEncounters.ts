import { WORLD_CELL_METERS } from '../domain/worldChunks'
import type { Vec3, WizardTerrainCell, WizardViewProjection } from './contracts'

export interface WildCreatureEncounter {
  readonly id: string
  readonly label: string
  readonly modelId: string
  readonly position: Vec3
  readonly scale: number
  readonly yaw: number
  readonly idleClip: 'Idle'
  readonly hiddenNodes: readonly string[]
}

const WILD_SITES = [
  { id: 'barrow-mole', label: 'Wild Barrow', x: 528, z: -496,
    hiddenNodes: ['BM_blanket', 'BM_girths', 'BM_guard.L', 'BM_guard.R',
      'BM_head_harness', 'BM_lead_lines', 'BM_plate1', 'BM_plate2', 'BM_plate3',
      'BM_plate4', 'BM_plate5', 'BM_saddle', 'BM_snout_band', 'BM_stirrups'] },
  { id: 'cragclaw-gecko', label: 'Wild Cragclaw', x: 656, z: -468,
    hiddenNodes: ['CG_blanket', 'CG_bridle', 'CG_reins', 'CG_saddle',
      'CG_stirrups', 'CG_straps'] },
  { id: 'ironback-beetle', label: 'Wild Ironback', x: 480, z: -484,
    hiddenNodes: ['IB_blanket', 'IB_bundle', 'IB_cargo_straps', 'IB_girths',
      'IB_guide_lines', 'IB_hooks', 'IB_panniers', 'IB_saddle', 'IB_stirrup_pegs'] },
  { id: 'reedskipper-newt', label: 'Wild Reedskipper', x: -344, z: 340,
    hiddenNodes: ['RN_blanket', 'RN_bridle', 'RN_girths', 'RN_reins',
      'RN_saddle', 'RN_stirrups'] },
] as const

/** Visual-only encounters on checked, revealed ground; never a capture or collision source. */
export function visibleWildCreatureEncounters(revealedTerrain: readonly WizardTerrainCell[],
  playerPosition: Vec3,
  openPitColumns: WizardViewProjection['v26OpenPitColumns']): readonly WildCreatureEncounter[] {
  const visible: WildCreatureEncounter[] = []
  for (const site of WILD_SITES) {
    const dx = site.x - playerPosition[0], dz = site.z - playerPosition[2]
    if (dx * dx + dz * dz > 60 * 60) continue
    if (openPitColumns?.some(({ gx, gz, openDepth }) =>
      gx === site.x / WORLD_CELL_METERS && gz === site.z / WORLD_CELL_METERS && openDepth > 0)) continue
    const cell = revealedTerrain.find((candidate) => candidate.position[0] === site.x
      && candidate.position[2] === site.z
      && candidate.size[0] === WORLD_CELL_METERS && candidate.size[1] === WORLD_CELL_METERS)
    if (!cell) continue
    visible.push({ id: site.id, label: site.label, modelId: site.id,
      position: [site.x, cell.position[1], site.z], scale: 1, yaw: 0,
      idleClip: 'Idle', hiddenNodes: site.hiddenNodes })
    if (visible.length === 2) break
  }
  return visible
}
