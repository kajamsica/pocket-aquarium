import { createGeneratedWorld, terrainHeightAt } from './generation'
import { isValidMireglassWorldContent } from './mireglassPersistence'
import { isRestorableWizardSave, restoreWizardWorld, serializeWizardWorld } from './persistence'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import type { PublicWorldState } from './publicWorldState'
import { createStreamedWorldFromState } from './streamedWorld'
import type { GenerationProfile, WizardWorldState } from './types'
import { WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

const STATE_FIELDS = ['seed', 'generationProfile', 'movementOwner', 'tick', 'rng',
  'eventSequence', 'player', 'discoveredTileIds', 'greenway', 'mireglass']
const DETACHED_FIELDS = new Set(['seed', 'generationProfile', 'tick', 'rng',
  'eventSequence', 'player', 'discoveredTileIds'])
const V6_ITEMS = new Set(['mireglass_reach/item/seal', 'mireglass_reach/item/waders'])
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const validCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0

/** Match v5's movement clamp, including expanded Greenway's half-tile outer edge. */
export function legacyMovementEnvelope(world: Pick<WizardWorldState, 'generationProfile' | 'tiles'>) {
  const edge = world.generationProfile === 'greenway-expanded-v1'
    ? Math.abs(world.tiles[1].center.x - world.tiles[0].center.x) / 2 : 0
  return {
    minX: Math.min(...world.tiles.map((tile) => tile.center.x)) - edge,
    maxX: Math.max(...world.tiles.map((tile) => tile.center.x)) + edge,
    minZ: Math.min(...world.tiles.map((tile) => tile.center.z)) - edge,
    maxZ: Math.max(...world.tiles.map((tile) => tile.center.z)) + edge,
  }
}

function canonicalDiscovery(ids: unknown): ids is string[] {
  if (!Array.isArray(ids)) return false
  let previous = ''
  for (const id of ids) {
    if (typeof id !== 'string' || (previous && id <= previous)) return false
    const match = /^tile-(-?\d+)-(-?\d+)$/.exec(id)
    if (!match) return false
    const x = Number(match[1]) - 3
    const z = Number(match[2]) - 3
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z)
      || x < WORLD_GRID_MIN || x > WORLD_GRID_MAX || z < WORLD_GRID_MIN || z > WORLD_GRID_MAX
      || id !== `tile-${x + 3}-${z + 3}`) return false
    previous = id
  }
  return true
}

/**
 * The v5 parser is the source of truth for complete detached Greenway facts. This
 * witness exists only during validation: it is never saved as a second player.
 */
function greenwayWitness(state: PublicWorldState, baseline: WizardWorldState): WizardWorldState {
  const player = structuredClone(state.player)
  player.inventory = player.inventory.filter((stack) => !V6_ITEMS.has(stack.itemId))
  player.tradeSlots = player.tradeSlots.map((slot) => V6_ITEMS.has(slot.itemId ?? '')
    ? { slotIndex: slot.slotIndex, itemId: null, quantity: 0, unitPrice: 0 } : slot) as typeof player.tradeSlots
  if (player.equipment.feet === 'mireglass_reach/item/waders') player.equipment.feet = null
  if (state.movementOwner === 'streamed') player.position = { ...baseline.player.position }
  // Mireglass XP can raise the actual level while the v5 highland recipe remains
  // locked until Greenway's next authoritative action. Normalize only the witness.
  if (state.greenway.builtRouteIds.includes('greenway_ladder')
    && !state.greenway.unlockedRecipeIds.includes('highland_bridge')) {
    player.xp = Math.min(player.xp, 99)
    player.level = 1
  }
  return {
    ...state.greenway, seed: state.seed, generationProfile: state.generationProfile,
    tick: state.tick, rng: state.rng, eventSequence: state.eventSequence,
    discoveredTileIds: state.discoveredTileIds.filter((id) =>
      state.greenway.tiles.some((tile) => tile.id === id)),
    player: player as WizardWorldState['player'],
  }
}

/** Pure, owner-specific validation. A Greenway-owned pose is never tested against streamed terrain. */
export function isValidPublicWorldState(value: unknown, bootstrap: PublicV6BootstrapRoot | null): value is PublicWorldState {
  if (!exact(value, STATE_FIELDS) || typeof value.seed !== 'string' || !value.seed
    || (value.generationProfile !== 'greenway-classic-v1' && value.generationProfile !== 'greenway-expanded-v1')
    || (value.movementOwner !== 'greenway' && value.movementOwner !== 'streamed')
    || !validCount(value.tick) || !validCount(value.eventSequence)
    || !canonicalDiscovery(value.discoveredTileIds) || !record(value.greenway)) return false
  const state = value as unknown as PublicWorldState
  const profile = state.generationProfile as GenerationProfile
  let baseline: WizardWorldState
  try {
    baseline = bootstrap ? restoreWizardWorld(bootstrap.greenwaySaveBytes)
      : createGeneratedWorld(state.seed, profile)
  } catch { return false }
  if (baseline.seed !== state.seed || baseline.generationProfile !== profile
    || bootstrap && (bootstrap.seed !== state.seed || bootstrap.source.profile !== profile)
    || !exact(state.greenway, Object.keys(baseline).filter((key) => !DETACHED_FIELDS.has(key)))
    || !isValidMireglassWorldContent({
      seed: state.seed, contentRevision: state.mireglass?.contentRevision,
      tick: state.tick, player: state.player,
      discoveredTileIds: state.discoveredTileIds, expedition: state.mireglass,
    }, state.seed)) return false

  let witness: WizardWorldState
  try { witness = greenwayWitness(state, baseline) } catch { return false }
  if (!isRestorableWizardSave(serializeWizardWorld(witness), profile)
    || state.greenway.builtRouteIds.includes('highland_bridge') && state.player.level < 2
    || bootstrap && (state.tick < baseline.tick || state.eventSequence < baseline.eventSequence
      || !baseline.builtRouteIds.every((id) => state.greenway.builtRouteIds.includes(id))
      || !baseline.studiedInscriptionIds.every((id) => state.greenway.studiedInscriptionIds.includes(id))
      || !baseline.revealedDigSiteIds.every((id) => state.greenway.revealedDigSiteIds.includes(id))
      || !baseline.excavatedDigSiteIds.every((id) => state.greenway.excavatedDigSiteIds.includes(id))
      || !baseline.discoveredTileIds.every((id) => state.discoveredTileIds.includes(id)))) return false

  if (state.movementOwner === 'greenway') {
    const { x, y, z } = state.player.position
    const bounds = legacyMovementEnvelope(witness)
    return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
      && y >= terrainHeightAt(witness.tiles, x, z)
  }
  try {
    createStreamedWorldFromState({
      seed: state.seed, tick: state.tick,
      player: {
        position: state.player.position, yaw: state.player.yaw, pitch: state.player.pitch,
        verticalVelocity: state.player.verticalVelocity,
      },
      discoveredTileIds: state.discoveredTileIds,
    })
    return true
  } catch { return false }
}
