import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV43FamiliarProgress, PUBLIC_V43_PROGRESS_KEYS }
  from './publicWorldV43FamiliarAction'
import type { PublicV43FamiliarProgress } from './publicWorldV43FamiliarAction'

export const GREENWAY_BAG_UPGRADE = Object.freeze({
  storeId: 'store-greenway', price: 70, extraSlots: 8,
  initialCapacity: 20, upgradedCapacity: 28,
} as const)

export type PublicV43BagUpgradeState = Readonly<{ claimedAtSequence: number | null }>
export type PublicV43BagUpgradeProgress = PublicV43FamiliarProgress & Readonly<{
  greenwayBagUpgrade: PublicV43BagUpgradeState
}>
export type PublicV43BagUpgradeWitness = Readonly<{ kind: 'buy-greenway-backpack/v1' }>
export type PublicV43BagUpgradeRejection = 'invalid_action' | 'invalid_progress'
  | 'already_purchased' | 'unavailable_here' | 'too_far' | 'airborne'
  | 'insufficient_coins' | 'invalid_value'
export type PublicV43BagUpgradeResult = Readonly<{
  progress: PublicV43BagUpgradeProgress; rejection?: never
}> | Readonly<{ progress?: never; rejection: PublicV43BagUpgradeRejection }>

const familiarOnly = (raw: Record<string, unknown>) => Object.fromEntries(
  PUBLIC_V43_PROGRESS_KEYS.map((key) => [key, raw[key]]))
const safeCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function decodePublicV43BagUpgradeState(raw: unknown,
  eventSequence: number, backpackCapacity: number): PublicV43BagUpgradeState | null {
  try {
    if (!safeCount(eventSequence) || !exactPublicV23(raw, ['claimedAtSequence'])) return null
    const claimed = raw.claimedAtSequence
    if (claimed === null) return backpackCapacity === GREENWAY_BAG_UPGRADE.initialCapacity
      ? { claimedAtSequence: null } : null
    return safeCount(claimed) && claimed >= 1 && claimed <= eventSequence
      && backpackCapacity === GREENWAY_BAG_UPGRADE.upgradedCapacity
      ? { claimedAtSequence: claimed } : null
  } catch { return null }
}

/** Older V43 heads omit the overlay; the accepted purchase witness creates it. */
export function createPublicV43BagUpgrade(source: PublicV43FamiliarProgress):
  PublicV43BagUpgradeProgress | null {
  const familiar = decodePublicV43FamiliarProgress(familiarOnly(source))
  return familiar?.state.player.backpackCapacity === GREENWAY_BAG_UPGRADE.initialCapacity
    ? { ...familiar, greenwayBagUpgrade: { claimedAtSequence: null } } : null
}

export function decodePublicV43BagUpgradeProgress(raw: unknown):
  PublicV43BagUpgradeProgress | null {
  try {
    if (!exactPublicV23(raw, [...PUBLIC_V43_PROGRESS_KEYS, 'greenwayBagUpgrade'])) return null
    const familiar = decodePublicV43FamiliarProgress(familiarOnly(raw))
    const bag = familiar && decodePublicV43BagUpgradeState(raw.greenwayBagUpgrade,
      familiar.state.eventSequence, familiar.state.player.backpackCapacity)
    return familiar && bag ? { ...familiar, greenwayBagUpgrade: bag } : null
  } catch { return null }
}

export function decodePublicV43BagUpgradeWitness(raw: unknown): PublicV43BagUpgradeWitness | null {
  try {
    if (!exactPublicV23(raw, ['kind']) || raw.kind !== 'buy-greenway-backpack/v1') return null
    structuredClone(raw)
    return { kind: 'buy-greenway-backpack/v1' }
  } catch { return null }
}

/** Fixed-price, one-time purchase: client data cannot choose the cost or capacity. */
export function confirmPublicV43BagUpgrade(raw: PublicV43BagUpgradeProgress,
  witness: unknown): PublicV43BagUpgradeResult {
  if (!decodePublicV43BagUpgradeWitness(witness)) return { rejection: 'invalid_action' }
  const before = decodePublicV43BagUpgradeProgress(raw)
  if (!before) return { rejection: 'invalid_progress' }
  if (before.greenwayBagUpgrade.claimedAtSequence !== null)
    return { rejection: 'already_purchased' }
  const { state } = before
  if (state.movementOwner !== 'greenway') return { rejection: 'unavailable_here' }
  if (state.player.verticalVelocity !== 0) return { rejection: 'airborne' }
  const store = state.greenway.stores.find((entry) => entry.id === GREENWAY_BAG_UPGRADE.storeId)
  if (!store) return { rejection: 'unavailable_here' }
  if (Math.hypot(state.player.position.x - store.position.x,
    state.player.position.y - store.position.y,
    state.player.position.z - store.position.z) > 3) return { rejection: 'too_far' }
  if (state.player.coins < GREENWAY_BAG_UPGRADE.price)
    return { rejection: 'insufficient_coins' }
  const sequence = state.eventSequence + 1
  if (!Number.isSafeInteger(sequence)) return { rejection: 'invalid_value' }
  const candidate = { ...before,
    greenwayBagUpgrade: { claimedAtSequence: sequence },
    state: { ...state, eventSequence: sequence,
      player: { ...state.player, coins: state.player.coins - GREENWAY_BAG_UPGRADE.price,
        backpackCapacity: GREENWAY_BAG_UPGRADE.upgradedCapacity } } }
  const progress = decodePublicV43BagUpgradeProgress(candidate)
  return progress ? { progress } : { rejection: 'invalid_value' }
}
