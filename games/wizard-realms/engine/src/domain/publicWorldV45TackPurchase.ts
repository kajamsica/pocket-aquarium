import { discoveryMaskHasTileId } from './discoveryMask'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { GREENWAY_BAG_UPGRADE } from './publicWorldV43BagUpgrade'
import { publicV43FamiliarTouchesForbiddenSupport }
  from './publicWorldV43FamiliarFollower'
import { projectPublicV43MountTraining } from './publicWorldV43MountTraining'
import type { PublicV45Progress } from './publicWorldV45RideAction'
import { worldTileAtGrid } from './worldChunks'

export const SEDGEHORN_TACK_PRICE = 240

export type PublicV45PurchasedTackProgress = Omit<PublicV45Progress, 'tack'> &
  Readonly<{ tack: 'purchased' }>
export type PublicV45TackPurchaseRejection = 'already_owned' | 'not_parked'
  | 'not_mature' | 'wrong_region' | 'not_grounded' | 'too_far'
  | 'unrevealed' | 'insufficient_coins' | 'invalid_value'
export type PublicV45TackPurchaseResult = Readonly<{
  progress: PublicV45PurchasedTackProgress; rejection?: never
}> | Readonly<{ progress?: never; rejection: PublicV45TackPurchaseRejection }>

/** A V45-only, fixed-price purchase. The caller supplies no price or location. */
export function confirmPublicV45TackPurchase(before: PublicV45Progress):
  PublicV45TackPurchaseResult {
  const reject = (rejection: PublicV45TackPurchaseRejection):
    PublicV45TackPurchaseResult => ({ rejection })
  if (before.tack !== 'not_owned') return reject('already_owned')
  if (before.groundMount.mode !== 'parked') return reject('not_parked')
  const { state } = before
  const atOutfitters = state.movementOwner === 'greenway'
  if (!atOutfitters && state.movementOwner !== 'streamed') return reject('wrong_region')
  const coins = state.player.coins, sequence = state.eventSequence + 1
  if (!Number.isSafeInteger(coins) || !Number.isSafeInteger(sequence))
    return reject('invalid_value')
  const pose = projectPublicV31Pose(before)
  if (state.player.verticalVelocity !== 0 || !pose
    || pose.support !== 'ground' && pose.support !== 'terrain'
    || Math.abs(state.player.position.y - pose.effective.floorY) > 1e-6)
    return reject('not_grounded')
  if (before.familiar.phase !== 'claimed'
    || projectPublicV43MountTraining(before)?.mature !== true) return reject('not_mature')
  const position = state.player.position
  if (atOutfitters) {
    const store = state.greenway.stores.find((entry) =>
      entry.id === GREENWAY_BAG_UPGRADE.storeId)
    if (!store) return reject('wrong_region')
    if (Math.hypot(position.x - store.position.x,
      position.y - store.position.y,
      position.z - store.position.z) > 3) return reject('too_far')
  } else {
    const keeper = resolveSedgehornFamiliarSite(before)?.keeper
    if (!keeper) return reject('wrong_region')
    if (!discoveryMaskHasTileId(state.discoveryMask, keeper.id))
      return reject('unrevealed')
    const surface = resolvePublicV23Surface(state, position,
      before.regionalWorks.builtLadderIds)
    if (!surface || surface.support !== 'terrain' || pose.support !== 'terrain'
      || worldTileAtGrid(state.seed, pose.cell.gx, pose.cell.gz).terrain === 'wetland'
      || Math.abs(position.y - surface.floorY) > 1e-6
      || !discoveryMaskHasTileId(state.discoveryMask, surface.tileId)
      || publicV43FamiliarTouchesForbiddenSupport(state.seed,
        position, position, before.terrain.columns, before.raisedSoilCells))
      return reject('not_grounded')
    if (Math.hypot(position.x - keeper.center.x,
      position.y - keeper.center.y,
      position.z - keeper.center.z) > 3) return reject('too_far')
  }
  if (coins < SEDGEHORN_TACK_PRICE) return reject('insufficient_coins')
  return { progress: { ...before, tack: 'purchased', state: { ...state,
    eventSequence: sequence, player: { ...state.player,
      coins: coins - SEDGEHORN_TACK_PRICE } } } }
}
