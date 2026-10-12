import { discoveryMaskHasTileId } from './discoveryMask'
import { decodePublicV23Progress, exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import type { PublicV26Progress } from './publicWorldV26Migration'
import { projectPublicV26Pose } from './publicWorldV26Pose'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import { decodePublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

export type PublicV26PitLadderAction = Readonly<{ kind: 'place-pit-ladder'; gx: number; gz: number }>
export type PublicV26PitLadderResult = Readonly<{ progress: PublicV26Progress; rejection?: never }>
  | Readonly<{ progress?: never; rejection: string }>
const inGrid = (value: unknown): value is number => Number.isSafeInteger(value)
  && (value as number) >= WORLD_GRID_MIN && (value as number) <= WORLD_GRID_MAX

export function decodePublicV26PitLadderAction(value: unknown): PublicV26PitLadderAction | null {
  try {
    return exactPublicV23(value, ['kind', 'gx', 'gz']) && value.kind === 'place-pit-ladder'
      && inGrid(value.gx) && inGrid(value.gz) && !!structuredClone(value)
      ? { kind: 'place-pit-ladder', gx: value.gx, gz: value.gz } : null
  } catch { return null }
}

function checkedProgress(value: unknown): PublicV26Progress | null {
  try {
    if (!exactPublicV23(value, ['state', 'greenwayWorks', 'regionalWorks', 'terrain', 'nextHomeAtMs'])
      || !Number.isSafeInteger(value.nextHomeAtMs) || (value.nextHomeAtMs as number) < 0) return null
    const seed = (value.state as { seed?: unknown }).seed
    if (typeof seed !== 'string') return null
    const old = decodePublicV23Progress({ state: value.state,
      greenwayWorks: value.greenwayWorks, regionalWorks: value.regionalWorks }, seed)
    const terrain = decodePublicV26TerrainLedger(value.terrain)
    return old && terrain ? { ...old, terrain, nextHomeAtMs: value.nextHomeAtMs as number } : null
  } catch { return null }
}

/** Builds a saved pit escape from owned logs, never from client-supplied eligibility. */
export function applyPublicV26PitLadderAction(rawProgress: PublicV26Progress,
  rawAction: unknown): PublicV26PitLadderResult {
  const reject = (rejection: string): PublicV26PitLadderResult => ({ rejection })
  const action = decodePublicV26PitLadderAction(rawAction)
  if (!action) return reject('invalid_action')
  const progress = checkedProgress(rawProgress)
  if (!progress) return reject('invalid_progress')
  try {
    const { gx, gz } = action, { state, terrain } = progress
    if (gx === 0 && gz === 0) return reject('occupied')
    if (!discoveryMaskHasTileId(state.discoveryMask, `tile-${gx + 3}-${gz + 3}`)) {
      return reject('unrevealed')
    }
    if (publicV25RiverCellAtGrid(state.seed, gx, gz)
      || publicV26TerrainCellIsWet(state.seed, gx, gz, state.movementOwner)) return reject('wet')
    const pose = projectPublicV26Pose(progress, terrain)
    if (!pose || state.player.verticalVelocity !== 0
      || Math.abs(pose.effective.position.y - pose.effective.floorY) > 1e-6) {
      return reject('invalid_pose')
    }
    if (pose.cell.gx !== gx || pose.cell.gz !== gz) return reject('wrong_cell')
    if (pose.support !== 'ground' && pose.support !== 'terrain') return reject('occupied')
    if (Math.hypot(pose.effective.position.x - gx * WORLD_CELL_METERS,
      pose.effective.position.z - gz * WORLD_CELL_METERS) > 3) return reject('too_far')
    const index = terrain.columns.findIndex((column) => column.gx === gx && column.gz === gz)
    const column = terrain.columns[index]
    if (!column || column.openDepth < 2) return reject('needs_depth')
    if (column.pitLadder) return reject('already_done')
    const player = state.player, logs = player.inventory.filter((stack) => stack.itemId === 'logs')
      .reduce((sum, stack) => sum + stack.quantity, 0)
    if (logs < 4) return reject('not_owned')
    const xp = player.xp + 60, construction = player.skillXp.construction + 60
    const sequence = state.eventSequence + 1
    if (![xp, construction, sequence].every(Number.isSafeInteger)) return reject('invalid_value')
    let spend = 4
    const inventory = player.inventory.map((stack) => {
      if (stack.itemId !== 'logs') return stack
      const taken = Math.min(spend, stack.quantity)
      spend -= taken
      return { ...stack, quantity: stack.quantity - taken }
    }).filter((stack) => stack.quantity > 0)
    const nextTerrain = decodePublicV26TerrainLedger({ ...terrain,
      columns: terrain.columns.map((entry, i) => i === index ? { ...entry, pitLadder: true } : entry) })
    if (!nextTerrain) return reject('invalid_value')
    const next = checkedProgress({ ...progress, terrain: nextTerrain, state: { ...state,
      eventSequence: sequence, player: { ...player, inventory, xp,
        level: 1 + Math.floor(xp / 100), skillXp: { ...player.skillXp, construction } } } })
    return next ? { progress: next } : reject('invalid_value')
  } catch { return reject('invalid_progress') }
}
