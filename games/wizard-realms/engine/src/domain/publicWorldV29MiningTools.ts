import { decodePublicV23Progress, exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { publicV28BridgeSitesValid } from './publicWorldV28RiverBridgeAction'
import { decodePublicV28BridgeIds } from './publicWorldV28Snapshot'
import type { PublicV29Progress } from './publicWorldV29Migration'

export type PublicV29PickTier = 'basic' | 'enchanted'
export type PublicV29MiningTools = Readonly<{ basicPickOwned: boolean;
  enchantedPickOwned: boolean; activePick: null | PublicV29PickTier }>
export type PublicV29MiningToolAction = Readonly<{ kind: 'buy' | 'equip'; tier: PublicV29PickTier }>
export type PublicV29MiningToolWitness = Readonly<{
  kind: 'mining-tool/v1'; action: PublicV29MiningToolAction }>
export type PublicV29MiningToolRejection = 'invalid_action' | 'invalid_progress'
  | 'unavailable_here' | 'too_far' | 'already_owned' | 'not_owned'
  | 'already_equipped' | 'insufficient_coins' | 'skill_locked' | 'invalid_value'

export const PUBLIC_V29_PICK_PRICES: Readonly<Record<PublicV29PickTier, number>> =
  { basic: 35, enchanted: 240 }
export const PUBLIC_V29_ENCHANTED_PICK_MIN_LEVEL = 25
const ownerKey = (tier: PublicV29PickTier) => tier === 'basic'
  ? 'basicPickOwned' as const : 'enchantedPickOwned' as const

export function emptyPublicV29MiningTools(): PublicV29MiningTools {
  return { basicPickOwned: false, enchantedPickOwned: false, activePick: null }
}

export function decodePublicV29MiningTools(value: unknown): PublicV29MiningTools | null {
  try {
    if (!exactPublicV23(value, ['basicPickOwned', 'enchantedPickOwned', 'activePick'])
      || typeof value.basicPickOwned !== 'boolean'
      || typeof value.enchantedPickOwned !== 'boolean'
      || value.activePick !== null && value.activePick !== 'basic'
        && value.activePick !== 'enchanted'
      || value.activePick === 'basic' && !value.basicPickOwned
      || value.activePick === 'enchanted' && !value.enchantedPickOwned) return null
    structuredClone(value)
    return { basicPickOwned: value.basicPickOwned,
      enchantedPickOwned: value.enchantedPickOwned, activePick: value.activePick }
  } catch { return null }
}

export function decodePublicV29MiningToolAction(value: unknown): PublicV29MiningToolAction | null {
  try {
    if (!exactPublicV23(value, ['kind', 'tier'])
      || value.kind !== 'buy' && value.kind !== 'equip'
      || value.tier !== 'basic' && value.tier !== 'enchanted') return null
    structuredClone(value)
    return { kind: value.kind, tier: value.tier }
  } catch { return null }
}

export function decodePublicV29MiningToolWitness(value: unknown): PublicV29MiningToolWitness | null {
  try {
    if (!exactPublicV23(value, ['kind', 'action']) || value.kind !== 'mining-tool/v1') return null
    const action = decodePublicV29MiningToolAction(value.action)
    return action ? { kind: 'mining-tool/v1', action } : null
  } catch { return null }
}

/** Checked action input shared by V29-only store and excavation transitions. */
export function decodePublicV29ActionProgress(value: PublicV29Progress): PublicV29Progress | null {
  try {
    if (!exactPublicV23(value, ['state', 'greenwayWorks', 'regionalWorks', 'terrain',
      'nextHomeAtMs', 'riverBridgeIds', 'miningTools'])
      || !Number.isSafeInteger(value.nextHomeAtMs) || value.nextHomeAtMs < 0) return null
    const old = decodePublicV23Progress({ state: value.state,
      greenwayWorks: value.greenwayWorks, regionalWorks: value.regionalWorks }, value.state.seed)
    const terrain = decodePublicV26TerrainLedger(value.terrain)
    const ids = decodePublicV28BridgeIds(value.riverBridgeIds)
    const miningTools = decodePublicV29MiningTools(value.miningTools)
    if (!old || !terrain || !ids || !miningTools
      || miningTools.activePick !== null && old.state.player.equipment.mainHand !== null) return null
    const progress = { ...old, terrain, nextHomeAtMs: value.nextHomeAtMs,
      riverBridgeIds: ids, miningTools }
    return publicV28BridgeSitesValid(progress) ? progress : null
  } catch { return null }
}

/** V29-only virtual offers. Historical inventory and store listings stay unchanged. */
export function applyPublicV29MiningToolAction(rawProgress: PublicV29Progress, rawAction: unknown):
  Readonly<{ progress: PublicV29Progress; rejection?: never }>
  | Readonly<{ progress?: never; rejection: PublicV29MiningToolRejection }> {
  const action = decodePublicV29MiningToolAction(rawAction)
  if (!action) return { rejection: 'invalid_action' }
  const progress = decodePublicV29ActionProgress(rawProgress)
  if (!progress) return { rejection: 'invalid_progress' }
  const { state, miningTools } = progress, { player } = state
  const key = ownerKey(action.tier)
  if (action.kind === 'buy') {
    if (state.movementOwner !== 'greenway') return { rejection: 'unavailable_here' }
    const store = state.greenway.stores.find((entry) => entry.id === 'store-greenway')
    if (!store || Math.hypot(player.position.x - store.position.x,
      player.position.y - store.position.y, player.position.z - store.position.z) > 3)
      return { rejection: 'too_far' }
    if (miningTools[key]) return { rejection: 'already_owned' }
    if (action.tier === 'enchanted'
      && 1 + Math.floor(player.skillXp.excavation / 30) < PUBLIC_V29_ENCHANTED_PICK_MIN_LEVEL)
      return { rejection: 'skill_locked' }
    if (player.coins < PUBLIC_V29_PICK_PRICES[action.tier]) return { rejection: 'insufficient_coins' }
  } else {
    if (!miningTools[key]) return { rejection: 'not_owned' }
    if (miningTools.activePick === action.tier && player.equipment.mainHand === null)
      return { rejection: 'already_equipped' }
  }
  if (!Number.isSafeInteger(state.eventSequence + 1)) return { rejection: 'invalid_value' }
  const next: PublicV29Progress = { ...progress,
    state: { ...state, eventSequence: state.eventSequence + 1,
      player: action.kind === 'buy' ? { ...player, coins: player.coins - PUBLIC_V29_PICK_PRICES[action.tier] }
        : { ...player, equipment: { ...player.equipment, mainHand: null } } },
    miningTools: action.kind === 'buy' ? { ...miningTools, [key]: true }
      : { ...miningTools, activePick: action.tier } }
  const checked = decodePublicV29ActionProgress(next)
  return checked ? { progress: checked } : { rejection: 'invalid_value' }
}
