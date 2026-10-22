import { discoveryMaskHasTileId } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { publicV43FamiliarTouchesForbiddenSupport }
  from './publicWorldV43FamiliarFollower'
import type { PublicV45Progress } from './publicWorldV45RideAction'
import { worldTileAtGrid } from './worldChunks'

export const MIREGLASS_HERB_UNIT_PRICE = 8
export type PublicV45HerbSaleRejection = 'invalid_quantity' | 'not_eligible'
  | 'unavailable_here' | 'too_far' | 'unrevealed' | 'unsafe_pose'
  | 'not_owned' | 'invalid_value'
export type PublicV45HerbSaleResult = Readonly<{
  progress: PublicV45Progress; rejection?: never
}> | Readonly<{ progress?: never; rejection: PublicV45HerbSaleRejection }>

/** Fixed-price V45 sale at the revealed Mireglass salvager. No V44 stock changes. */
export function confirmPublicV45HerbSale(before: PublicV45Progress,
  quantity: number): PublicV45HerbSaleResult {
  const reject = (rejection: PublicV45HerbSaleRejection): PublicV45HerbSaleResult =>
    ({ rejection })
  try {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 256)
      return reject('invalid_quantity')
    if (before.groundMount.mode !== 'parked') return reject('not_eligible')
    const { state } = before
    if (state.movementOwner !== 'streamed') return reject('unavailable_here')
    const position = state.player.position
    const salvager = mireglassAnchors(state.seed).salvager.tile
    if (!discoveryMaskHasTileId(state.discoveryMask, salvager.id))
      return reject('unrevealed')
    const surface = resolvePublicV23Surface(state, position,
      before.regionalWorks.builtLadderIds)
    const pose = projectPublicV31Pose(before, position)
    if (!surface || !pose || surface.support !== 'terrain'
      || pose.support !== 'terrain'
      || worldTileAtGrid(state.seed, pose.cell.gx, pose.cell.gz).terrain === 'wetland'
      || state.player.verticalVelocity !== 0
      || Math.abs(position.y - surface.floorY) > 1e-6
      || Math.abs(position.y - pose.effective.floorY) > 1e-6
      || !discoveryMaskHasTileId(state.discoveryMask, surface.tileId)
      || publicV43FamiliarTouchesForbiddenSupport(state.seed,
        position, position, before.terrain.columns, before.raisedSoilCells))
      return reject('unsafe_pose')
    if (Math.hypot(position.x - salvager.center.x,
      position.y - salvager.center.y,
      position.z - salvager.center.z) > 3) return reject('too_far')
    const inventory = state.player.inventory
    let remaining = quantity
    const afterInventory = inventory.flatMap((stack) => {
      if (stack.itemId !== 'marsh_herb' || remaining === 0) return [stack]
      const taken = Math.min(stack.quantity, remaining)
      remaining -= taken
      return taken === stack.quantity ? [] : [{ ...stack,
        quantity: stack.quantity - taken }]
    })
    if (remaining !== 0) return reject('not_owned')
    const coins = state.player.coins + quantity * MIREGLASS_HERB_UNIT_PRICE
    const eventSequence = state.eventSequence + 1
    if (!Number.isSafeInteger(coins) || !Number.isSafeInteger(eventSequence))
      return reject('invalid_value')
    return { progress: { ...before, state: { ...state, eventSequence,
      player: { ...state.player, coins, inventory: afterInventory } } } }
  } catch { return reject('invalid_value') }
}
