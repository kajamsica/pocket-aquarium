import { MIREGLASS_CONTENT_REVISION } from './mireglassContent'
import {
  isValidMireglassRegionProgress, isValidMireglassV6Player, MIREGLASS_OUTPOST_CATALOG,
} from './mireglassExpedition'
import type { MireglassV6Player } from './mireglassExpedition'
import type { MireglassWorldState } from './mireglassWorld'
import { createStreamedWorldFromState } from './streamedWorld'

/** Deliberately separate from the v5 Greenway key and save schema. */
export const MIREGLASS_SAVE_KEY = 'wizard-realms:world:mireglass:v6'
export const MIREGLASS_SAVE_SCHEMA_VERSION = 'wizard-mireglass/v6'

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const fields = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const WORLD_FIELDS = ['seed', 'contentRevision', 'tick', 'player', 'discoveredTileIds', 'expedition']
const PLAYER_FIELDS = ['position', 'verticalVelocity', 'yaw', 'pitch', 'coins', 'xp', 'level',
  'backpackCapacity', 'inventory', 'equipment', 'tradeSlots', 'discoveredRingIds', 'skillXp', 'learnedSpellIds']
const REGION_FIELDS = ['contentRevision', 'seed', 'depletedResourceIds', 'dugStumpIds', 'builtRoutes',
  'fringeMarkerStudied', 'cacheRevealed', 'cacheExcavated', 'shopStock']
const EQUIPMENT_FIELDS = ['head', 'chest', 'legs', 'feet', 'mainHand', 'offHand']
const SKILL_FIELDS = ['woodcutting', 'construction', 'wayfinding', 'spellcraft', 'excavation']

function hasExactShape(state: Record<string, unknown>): boolean {
  const player = state.player
  const region = state.expedition
  return fields(player, PLAYER_FIELDS) && fields(region, REGION_FIELDS)
    && fields(player.position, ['x', 'y', 'z'])
    && fields(player.equipment, EQUIPMENT_FIELDS) && fields(player.skillXp, SKILL_FIELDS)
    && Array.isArray(player.inventory)
    && player.inventory.every((stack) => fields(stack, ['itemId', 'quantity']))
    && Array.isArray(player.tradeSlots)
    && player.tradeSlots.every((slot) => fields(slot, ['slotIndex', 'itemId', 'quantity', 'unitPrice']))
    && fields(region.builtRoutes, ['bridge', 'ladder'])
    && fields(region.shopStock, ['field_spade', 'mireglass_reach/item/waders'])
}

function totalOwned(player: MireglassV6Player, itemId: string): number {
  return player.inventory.filter((entry) => entry.itemId === itemId)
    .reduce((total, entry) => total + entry.quantity, 0)
    + player.tradeSlots.filter((slot) => slot.itemId === itemId)
      .reduce((total, slot) => total + slot.quantity, 0)
}

const sortedIds = (ids: readonly string[]) => ids.every((id, index) => index === 0 || ids[index - 1] < id)

function validProgressCorrelations(state: MireglassWorldState): boolean {
  const { player, expedition } = state
  const { skillXp } = player
  const builtXp = (expedition.builtRoutes.bridge ? 80 : 0) + (expedition.builtRoutes.ladder ? 60 : 0)
  const earnedXp = expedition.depletedResourceIds.length * 20 + expedition.dugStumpIds.length * 30
    + builtXp + (expedition.cacheRevealed ? 10 : 0) + (expedition.cacheExcavated ? 40 : 0)
  const purchasedSpades = MIREGLASS_OUTPOST_CATALOG.field_spade.stock - expedition.shopStock.field_spade
  const purchasedWaders = MIREGLASS_OUTPOST_CATALOG['mireglass_reach/item/waders'].stock
    - expedition.shopStock['mireglass_reach/item/waders']
  const sealCount = totalOwned(player, 'mireglass_reach/item/seal')
  return player.xp >= earnedXp
    && skillXp.woodcutting >= expedition.depletedResourceIds.length * 20
    && skillXp.construction >= builtXp
    && skillXp.excavation >= expedition.dugStumpIds.length * 30 + (expedition.cacheExcavated ? 40 : 0)
    && (!expedition.fringeMarkerStudied || player.learnedSpellIds.includes('wayfinder_glow'))
    && (!expedition.cacheRevealed || player.learnedSpellIds.includes('wayfinder_glow')
      && skillXp.spellcraft >= 10 && skillXp.wayfinding >= 10)
    && totalOwned(player, 'field_spade') >= purchasedSpades
    && totalOwned(player, 'mireglass_reach/item/waders') >= purchasedWaders
    && sealCount <= 1 && (expedition.cacheExcavated || sealCount === 0)
}

/** Shared content proof; a public Greenway-owned pose is checked against v5 terrain instead. */
export function isValidMireglassWorldContent(value: unknown, expectedSeed: string): value is MireglassWorldState {
  if (typeof expectedSeed !== 'string' || !expectedSeed || !fields(value, WORLD_FIELDS)
    || value.seed !== expectedSeed || value.contentRevision !== MIREGLASS_CONTENT_REVISION
    || !Number.isSafeInteger(value.tick) || (value.tick as number) < 0
    || !hasExactShape(value) || !isValidMireglassV6Player(value.player)
    || !isValidMireglassRegionProgress(value.expedition, expectedSeed)
    || !Array.isArray(value.discoveredTileIds)) return false
  const state = value as unknown as MireglassWorldState
  if (state.player.position.y > 1_000
    || !sortedIds(state.expedition.depletedResourceIds) || !sortedIds(state.expedition.dugStumpIds)
    || !validProgressCorrelations(state)) return false
  return true
}

function validState(value: unknown, expectedSeed: string): value is MireglassWorldState {
  if (!isValidMireglassWorldContent(value, expectedSeed)) return false
  try {
    createStreamedWorldFromState({
      seed: value.seed, tick: value.tick,
      player: {
        position: value.player.position, yaw: value.player.yaw,
        pitch: value.player.pitch, verticalVelocity: value.player.verticalVelocity,
      },
      discoveredTileIds: value.discoveredTileIds,
    })
  } catch { return false }
  return true
}

function freezeTree(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const child of Object.values(value)) freezeTree(child)
  Object.freeze(value)
}

/** Rejects invalid states rather than silently writing a corrupt save. */
export function serializeMireglassWorld(state: MireglassWorldState): string {
  if (!validState(state, state?.seed)) throw new RangeError('Invalid Mireglass world state.')
  return JSON.stringify({ schemaVersion: MIREGLASS_SAVE_SCHEMA_VERSION, ...state })
}

/** Returns a detached, frozen snapshot or null; it never writes storage or upgrades v5 saves. */
export function parseMireglassWorld(raw: string, expectedSeed: string): MireglassWorldState | null {
  if (typeof raw !== 'string' || raw.length > 16 * 1024 * 1024) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!fields(parsed, ['schemaVersion', ...WORLD_FIELDS])
    || parsed.schemaVersion !== MIREGLASS_SAVE_SCHEMA_VERSION) return null
  const { schemaVersion: _schemaVersion, ...state } = parsed
  if (!validState(state, expectedSeed)) return null
  freezeTree(state)
  return state
}
