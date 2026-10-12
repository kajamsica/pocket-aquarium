import { discoveryMaskHasTileId } from './discoveryMask'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV31HasRaisedSoilCell } from './publicWorldV31Soil'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { decodePublicV39RingProgress, PUBLIC_V39_PROGRESS_KEYS } from './publicWorldV39RingAction'
import type { PublicV39RingProgress } from './publicWorldV39RingAction'
import { waystationRiverSite } from './waystationRiverContent'
import type { Vec3 } from './types'

export type PublicV40WaystationProgress = PublicV39RingProgress & Readonly<{
  timberBartered: boolean
  southbankReached: boolean
  waystationClaimed: boolean
}>
export type PublicV40WaystationWitness = Readonly<{
  kind: 'waystation-barter/v1' | 'waystation-cross/v1' | 'waystation-claim/v1'
}>
export type PublicV40WaystationRejection = 'invalid_value' | 'invalid_progress'
  | 'wrong_region' | 'not_grounded' | 'unsafe_source' | 'unrevealed'
  | 'too_far' | 'already_bartered' | 'already_built' | 'not_owned'
  | 'capacity' | 'not_built' | 'already_crossed' | 'requires_crossing'
  | 'already_claimed'
export type PublicV40WaystationResult = Readonly<{
  progress: PublicV40WaystationProgress; rejection?: never
}> | Readonly<{ progress?: never; rejection: PublicV40WaystationRejection }>

export const PUBLIC_V40_PROGRESS_KEYS = [...PUBLIC_V39_PROGRESS_KEYS,
  'timberBartered', 'southbankReached', 'waystationClaimed'] as const

const REACH = 3
const EPSILON = 1e-6

export function decodePublicV40WaystationProgress(raw: unknown): PublicV40WaystationProgress | null {
  try {
    if (!exactPublicV23(raw, PUBLIC_V40_PROGRESS_KEYS)) return null
    const { timberBartered, southbankReached, waystationClaimed } = raw
    if ([timberBartered, southbankReached, waystationClaimed]
      .some((flag) => typeof flag !== 'boolean')
      || waystationClaimed && !southbankReached) return null
    const inherited = decodePublicV39RingProgress(Object.fromEntries(
      PUBLIC_V39_PROGRESS_KEYS.map((key) => [key, raw[key]])))
    const site = inherited && waystationRiverSite(inherited.state.seed)
    if (!inherited || !site || southbankReached
      && !inherited.riverBridgeIds.includes(site.id)) return null
    return { ...inherited, timberBartered: timberBartered as boolean,
      southbankReached: southbankReached as boolean,
      waystationClaimed: waystationClaimed as boolean }
  } catch { return null }
}

/** A witness carries no coordinate, bridge ID, item count or reward. */
export function decodePublicV40WaystationWitness(raw: unknown): PublicV40WaystationWitness | null {
  try {
    if (!exactPublicV23(raw, ['kind'])
      || raw.kind !== 'waystation-barter/v1' && raw.kind !== 'waystation-cross/v1'
        && raw.kind !== 'waystation-claim/v1') return null
    structuredClone(raw)
    return { kind: raw.kind }
  } catch { return null }
}

const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/** Pure checked transition. The V40 writer replays it against its locked head. */
export function confirmPublicV40WaystationAction(raw: PublicV40WaystationProgress,
  rawWitness: unknown): PublicV40WaystationResult {
  const reject = (rejection: PublicV40WaystationRejection): PublicV40WaystationResult =>
    ({ rejection })
  const witness = decodePublicV40WaystationWitness(rawWitness)
  if (!witness) return reject('invalid_value')
  let progress: PublicV40WaystationProgress | null
  try { progress = decodePublicV40WaystationProgress(Object.fromEntries(
    PUBLIC_V40_PROGRESS_KEYS.map((key) => [key, raw[key]]))) }
  catch { return reject('invalid_progress') }
  if (!progress) return reject('invalid_progress')
  try {
    const { state } = progress, { player } = state
    const site = waystationRiverSite(state.seed)
    if (!site) return reject('invalid_progress')
    const kind = witness.kind
    const owner = kind === 'waystation-claim/v1' ? 'greenway' : 'streamed'
    if (state.movementOwner !== owner) return reject('wrong_region')
    const pose = projectPublicV31Pose(progress)
    if (!pose || player.verticalVelocity !== 0
      || pose.support !== (owner === 'greenway' ? 'ground' : 'terrain')
      || Math.abs(pose.effective.position.y - pose.effective.floorY) > EPSILON)
      return reject('not_grounded')
    if (publicV25RiverCellAtGrid(state.seed, pose.cell.gx, pose.cell.gz)
      || publicV26TerrainCellIsWet(state.seed, pose.cell.gx, pose.cell.gz, owner)
      || progress.terrain.columns.some(({ gx, gz, openDepth }) =>
        gx === pose.cell.gx && gz === pose.cell.gz && openDepth > 0)
      || publicV31HasRaisedSoilCell(progress.raisedSoilCells, pose.cell.gx, pose.cell.gz))
      return reject('unsafe_source')
    if (!Number.isSafeInteger(state.eventSequence + 1)) return reject('invalid_value')
    if (kind === 'waystation-barter/v1') {
      if (progress.timberBartered) return reject('already_bartered')
      if (progress.riverBridgeIds.includes(site.id)) return reject('already_built')
      if (!discoveryMaskHasTileId(state.discoveryMask, site.footprintTileIds[0]))
        return reject('unrevealed')
      if (distance(pose.effective.position, site.approach) > REACH) return reject('too_far')
      const stoneOwned = player.inventory.filter(({ itemId }) => itemId === 'stone')
        .reduce((sum, stack) => sum + stack.quantity, 0)
      if (stoneOwned < 2) return reject('not_owned')
      const used = player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)
      if (!Number.isSafeInteger(used + 6) || used + 6 > player.backpackCapacity)
        return reject('capacity')
      let remaining = 2, logsAdded = false
      const inventory = player.inventory.flatMap((stack) => {
        if (stack.itemId === 'stone' && remaining) {
          const spent = Math.min(remaining, stack.quantity)
          remaining -= spent
          return stack.quantity === spent ? [] : [{ ...stack, quantity: stack.quantity - spent }]
        }
        if (stack.itemId === 'logs' && !logsAdded) {
          logsAdded = true
          return [{ ...stack, quantity: stack.quantity + 8 }]
        }
        return [stack]
      })
      if (!logsAdded) inventory.push({ itemId: 'logs', quantity: 8 })
      if (inventory.some(({ quantity }) => !Number.isSafeInteger(quantity)))
        return reject('invalid_value')
      const next: PublicV40WaystationProgress = { ...progress, timberBartered: true,
        state: { ...state, eventSequence: state.eventSequence + 1,
          player: { ...player, inventory } } }
      return decodePublicV40WaystationProgress(next) ? { progress: next } : reject('invalid_value')
    }
    if (kind === 'waystation-cross/v1') {
      if (progress.southbankReached) return reject('already_crossed')
      if (!progress.riverBridgeIds.includes(site.id)) return reject('not_built')
      if (!discoveryMaskHasTileId(state.discoveryMask,
        site.footprintTileIds[site.footprintTileIds.length - 1])) return reject('unrevealed')
      if (pose.effective.position.z <= site.to.z
        || distance(pose.effective.position, site.exit) > REACH) return reject('too_far')
      const next: PublicV40WaystationProgress = { ...progress, southbankReached: true,
        state: { ...state, eventSequence: state.eventSequence + 1 } }
      return decodePublicV40WaystationProgress(next) ? { progress: next } : reject('invalid_value')
    }
    if (progress.waystationClaimed) return reject('already_claimed')
    if (!progress.southbankReached) return reject('requires_crossing')
    if (!progress.riverBridgeIds.includes(site.id)) return reject('not_built')
    const store = state.greenway.stores.find(({ id }) => id === 'store-greenway')
    if (!store) return reject('invalid_progress')
    if (distance(pose.effective.position, store.position) > REACH) return reject('too_far')
    const coins = player.coins + 45, wayfinding = player.skillXp.wayfinding + 45
    const xp = player.xp + 45
    if (![coins, wayfinding, xp].every(Number.isSafeInteger)) return reject('invalid_value')
    const next: PublicV40WaystationProgress = { ...progress, waystationClaimed: true,
      state: { ...state, eventSequence: state.eventSequence + 1,
        player: { ...player, coins, xp, level: 1 + Math.floor(xp / 100),
          skillXp: { ...player.skillXp, wayfinding } } } }
    return decodePublicV40WaystationProgress(next) ? { progress: next } : reject('invalid_value')
  } catch { return reject('invalid_progress') }
}

/** Advisory only. The locked writer confirms again against its own head. */
export function previewPublicV40WaystationAction(progress: PublicV40WaystationProgress,
  witness: unknown): Readonly<{ rejection: PublicV40WaystationRejection | null }> {
  return { rejection: confirmPublicV40WaystationAction(progress, witness).rejection ?? null }
}
