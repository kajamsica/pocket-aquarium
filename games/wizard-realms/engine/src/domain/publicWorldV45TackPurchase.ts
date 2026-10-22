import { projectPublicV31Pose } from './publicWorldV31Support'
import { GREENWAY_BAG_UPGRADE } from './publicWorldV43BagUpgrade'
import { projectPublicV43MountTraining } from './publicWorldV43MountTraining'
import type { PublicV45Progress } from './publicWorldV45RideAction'

export const SEDGEHORN_TACK_PRICE = 240

export type PublicV45PurchasedTackProgress = Omit<PublicV45Progress, 'tack'> &
  Readonly<{ tack: 'purchased' }>
export type PublicV45TackPurchaseRejection = 'already_owned' | 'not_parked'
  | 'not_mature' | 'wrong_region' | 'not_grounded' | 'too_far'
  | 'insufficient_coins' | 'invalid_value'
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
  if (state.movementOwner !== 'greenway') return reject('wrong_region')
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
  const store = state.greenway.stores.find((entry) =>
    entry.id === GREENWAY_BAG_UPGRADE.storeId)
  if (!store) return reject('wrong_region')
  if (Math.hypot(state.player.position.x - store.position.x,
    state.player.position.y - store.position.y,
    state.player.position.z - store.position.z) > 3) return reject('too_far')
  if (coins < SEDGEHORN_TACK_PRICE) return reject('insufficient_coins')
  return { progress: { ...before, tack: 'purchased', state: { ...state,
    eventSequence: sequence, player: { ...state.player,
      coins: coins - SEDGEHORN_TACK_PRICE } } } }
}
