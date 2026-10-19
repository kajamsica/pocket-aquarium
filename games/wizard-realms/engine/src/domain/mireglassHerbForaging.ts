import { isValidMireglassRegionProgress, isValidMireglassV6Player } from './mireglassExpedition'
import type { MireglassRegionProgress, MireglassV6Player } from './mireglassExpedition'
import { mireglassHerbPatches } from './mireglassHerbPatches'

export const HERB_CYCLE_TICKS = 6000

export interface HerbHarvestEntry {
  readonly patchId: string
  readonly cycle: number
}

export type MireglassHerbRegionProgress = MireglassRegionProgress & {
  readonly herbHarvestCycles: readonly HerbHarvestEntry[]
}

export type MireglassHerbForageResult =
  | { player: MireglassV6Player; region: MireglassHerbRegionProgress;
    event: { type: 'herb_foraged'; patchId: string; itemId: 'marsh_herb'; quantity: 1; cycle: number; xp: 0 }; rejection?: never }
  | { player: MireglassV6Player; region: MireglassHerbRegionProgress;
    rejection: { code: 'invalid_value' | 'invalid_progress' | 'seed_mismatch' | 'not_found'
      | 'already_harvested' | 'too_far' | 'capacity'; message: string }; event?: never }

function validHarvestCycles(value: unknown, patchIds: ReadonlySet<string>, currentCycle: number): value is readonly HerbHarvestEntry[] {
  if (!Array.isArray(value)) return false
  let previousId = ''
  return value.every((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)
      || Object.keys(entry).length !== 2
      || !('patchId' in entry) || typeof entry.patchId !== 'string'
      || !patchIds.has(entry.patchId) || entry.patchId <= previousId
      || !('cycle' in entry) || !Number.isSafeInteger(entry.cycle)
      || (entry.cycle as number) < 0 || (entry.cycle as number) > currentCycle) return false
    previousId = entry.patchId
    return true
  })
}

/** Grants one marsh herb from a canonical patch once per authoritative simulation cycle. */
export function applyMireglassHerbForage(
  seed: string, player: MireglassV6Player, region: MireglassHerbRegionProgress, tick: number, patchId: string,
): MireglassHerbForageResult {
  const reject = (code: NonNullable<MireglassHerbForageResult['rejection']>['code'], message: string): MireglassHerbForageResult =>
    ({ player, region, rejection: { code, message } })
  if (!Number.isSafeInteger(tick) || tick < 0 || typeof patchId !== 'string' || !patchId) {
    return reject('invalid_value', 'Herb forage tick or patch ID is invalid.')
  }
  if (!isValidMireglassV6Player(player) || !isValidMireglassRegionProgress(region)) {
    return reject('invalid_progress', 'Mireglass player or region is invalid.')
  }
  if (typeof seed !== 'string' || region.seed !== (seed || 'wizard-realms')) {
    return reject('seed_mismatch', 'Mireglass region belongs to another world.')
  }

  const patches = mireglassHerbPatches(region.seed)
  const cycle = Math.floor(tick / HERB_CYCLE_TICKS)
  if (!validHarvestCycles(region.herbHarvestCycles, new Set(patches.map(({ id }) => id)), cycle)) {
    return reject('invalid_progress', 'Herb harvest history is invalid.')
  }
  const patch = patches.find(({ id }) => id === patchId)
  if (!patch) return reject('not_found', 'Canonical herb patch does not exist.')
  const previous = region.herbHarvestCycles.find((entry) => entry.patchId === patchId)
  if (previous && previous.cycle >= cycle) return reject('already_harvested', 'Herb patch has already been harvested this cycle.')
  if (Math.hypot(player.position.x - patch.tile.center.x, player.position.y - patch.tile.center.y,
    player.position.z - patch.tile.center.z) > 3) return reject('too_far', 'Herb patch is out of reach.')
  const carried = player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)
    + player.tradeSlots.reduce((sum, slot) => sum + slot.quantity, 0)
  if (carried + 1 > player.backpackCapacity) return reject('capacity', 'Backpack cannot hold the herb.')

  const nextPlayer = structuredClone(player)
  const herbs = nextPlayer.inventory.find((stack) => stack.itemId === 'marsh_herb')
  if (herbs) herbs.quantity += 1
  else nextPlayer.inventory.push({ itemId: 'marsh_herb', quantity: 1 })
  const herbHarvestCycles = [...region.herbHarvestCycles.filter((entry) => entry.patchId !== patchId),
    { patchId, cycle }].sort((a, b) => a.patchId < b.patchId ? -1 : a.patchId > b.patchId ? 1 : 0)
  return { player: nextPlayer, region: { ...region, herbHarvestCycles },
    event: { type: 'herb_foraged', patchId, itemId: 'marsh_herb', quantity: 1, cycle, xp: 0 } }
}
