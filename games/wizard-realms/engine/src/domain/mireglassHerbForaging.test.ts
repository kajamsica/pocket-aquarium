import { describe, expect, it } from 'vitest'
import { createMireglassRegionProgress, createMireglassV6Player } from './mireglassExpedition'
import type { MireglassV6Player } from './mireglassExpedition'
import {
  applyMireglassHerbForage, HERB_CYCLE_TICKS,
} from './mireglassHerbForaging'
import type { MireglassHerbForageResult, MireglassHerbRegionProgress } from './mireglassHerbForaging'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import type { MireglassHerbPatch } from './mireglassHerbPatches'

const seed = 'wizard-realms'
const patches = mireglassHerbPatches(seed)
const byId = [...patches].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const region = (): MireglassHerbRegionProgress =>
  ({ ...createMireglassRegionProgress(seed), herbHarvestCycles: [] })
const at = (patch: MireglassHerbPatch, player = createMireglassV6Player(seed)): MireglassV6Player =>
  ({ ...player, position: { ...patch.tile.center } })
const herbCount = (player: MireglassV6Player) => player.inventory
  .filter((stack) => stack.itemId === 'marsh_herb').reduce((sum, stack) => sum + stack.quantity, 0)

function accepted(result: MireglassHerbForageResult) {
  expect(result.rejection).toBeUndefined()
  expect(result.event).toBeDefined()
  return result as Extract<MireglassHerbForageResult, { event: object }>
}

function rejected(result: MireglassHerbForageResult,
  code: NonNullable<MireglassHerbForageResult['rejection']>['code'],
  player: MireglassV6Player, progress: MireglassHerbRegionProgress) {
  expect(result.rejection?.code).toBe(code)
  expect(result.event).toBeUndefined()
  expect(result.player).toBe(player)
  expect(result.region).toBe(progress)
}

describe('Mireglass Bell Alder herb foraging', () => {
  it('grants one existing marsh herb without XP, then rejects replay of that patch in the same cycle', () => {
    const player = at(byId[0])
    const progress = region()
    const first = accepted(applyMireglassHerbForage(seed, player, progress, 0, byId[0].id))
    expect(first.event).toEqual({ type: 'herb_foraged', patchId: byId[0].id,
      itemId: 'marsh_herb', quantity: 1, cycle: 0, xp: 0 })
    expect(herbCount(first.player)).toBe(herbCount(player) + 1)
    expect(first.player.xp).toBe(player.xp)
    expect(first.player.skillXp).toEqual(player.skillXp)
    expect(first.region.herbHarvestCycles).toEqual([{ patchId: byId[0].id, cycle: 0 }])
    rejected(applyMireglassHerbForage(seed, first.player, first.region, HERB_CYCLE_TICKS - 1,
      byId[0].id), 'already_harvested', first.player, first.region)
  })

  it('harvests a different patch in the same cycle and keeps entries unique and sorted by patch ID', () => {
    expect(byId.length).toBeGreaterThan(1)
    const high = byId.at(-1)!
    const low = byId[0]
    const first = accepted(applyMireglassHerbForage(seed, at(high), region(), 10, high.id))
    const second = accepted(applyMireglassHerbForage(seed, at(low, first.player), first.region, 10, low.id))
    expect(herbCount(second.player)).toBe(2)
    expect(second.region.herbHarvestCycles).toEqual([
      { patchId: low.id, cycle: 0 }, { patchId: high.id, cycle: 0 },
    ])
  })

  it('regrows at the exact 6000-tick boundary and replaces the last cycle for that patch', () => {
    const player = at(byId[0])
    const first = accepted(applyMireglassHerbForage(seed, player, region(), HERB_CYCLE_TICKS - 1, byId[0].id))
    const second = accepted(applyMireglassHerbForage(seed, first.player, first.region, HERB_CYCLE_TICKS, byId[0].id))
    expect(herbCount(second.player)).toBe(2)
    expect(second.region.herbHarvestCycles).toEqual([{ patchId: byId[0].id, cycle: 1 }])
    rejected(applyMireglassHerbForage(seed, second.player, second.region, 0, byId[0].id),
      'invalid_progress', second.player, second.region)
  })

  it('enforces authoritative 3 m reach and backpack capacity including trade slots', () => {
    const patch = byId[0]
    const progress = region()
    const near = at(patch)
    const far = { ...near, position: { ...near.position, x: near.position.x + 3.001 } }
    rejected(applyMireglassHerbForage(seed, far, progress, 0, patch.id), 'too_far', far, progress)
    accepted(applyMireglassHerbForage(seed,
      { ...near, position: { ...near.position, x: near.position.x + 3 } }, progress, 0, patch.id))
    const full = { ...near, backpackCapacity: near.inventory.reduce((sum, stack) => sum + stack.quantity, 0) }
    rejected(applyMireglassHerbForage(seed, full, progress, 0, patch.id), 'capacity', full, progress)
    const escrowFull = structuredClone(near)
    escrowFull.backpackCapacity = full.backpackCapacity + 1
    escrowFull.tradeSlots[0] = { slotIndex: 0, itemId: 'logs', quantity: 1, unitPrice: 1 }
    rejected(applyMireglassHerbForage(seed, escrowFull, progress, 0, patch.id),
      'capacity', escrowFull, progress)
  })

  it('rejects unknown patches, invalid ticks, seed mismatch, and malformed harvest history', () => {
    const patch = byId[0]
    const player = at(patch)
    const progress = region()
    rejected(applyMireglassHerbForage(seed, player, progress, 0, 'forged-herb'), 'not_found', player, progress)
    for (const tick of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      rejected(applyMireglassHerbForage(seed, player, progress, tick, patch.id), 'invalid_value', player, progress)
    }
    rejected(applyMireglassHerbForage('other-world', player, progress, 0, patch.id),
      'seed_mismatch', player, progress)
    const forged = { ...progress, herbHarvestCycles: [{ patchId: 'forged-herb', cycle: 0 }] }
    rejected(applyMireglassHerbForage(seed, player, forged, 0, patch.id), 'invalid_progress', player, forged)
    const duplicate = { ...progress, herbHarvestCycles: [
      { patchId: patch.id, cycle: 0 }, { patchId: patch.id, cycle: 1 },
    ] }
    rejected(applyMireglassHerbForage(seed, player, duplicate, HERB_CYCLE_TICKS * 2, patch.id),
      'invalid_progress', player, duplicate)
    const unsorted = { ...progress, herbHarvestCycles: [
      { patchId: byId[1].id, cycle: 0 }, { patchId: byId[0].id, cycle: 0 },
    ] }
    rejected(applyMireglassHerbForage(seed, player, unsorted, 0, patch.id), 'invalid_progress', player, unsorted)
  })

  it('is deterministic and does not mutate player or region inputs', () => {
    const player = at(byId[0])
    const progress = region()
    const originalPlayer = structuredClone(player)
    const originalRegion = structuredClone(progress)
    const first = accepted(applyMireglassHerbForage(seed, player, progress, 0, byId[0].id))
    const second = accepted(applyMireglassHerbForage(seed, player, progress, 0, byId[0].id))
    expect(first).toEqual(second)
    expect(first.player).not.toBe(player)
    expect(first.region).not.toBe(progress)
    expect(player).toEqual(originalPlayer)
    expect(progress).toEqual(originalRegion)
    const harvestedPlayer = structuredClone(first.player)
    const harvestedRegion = structuredClone(first.region)
    rejected(applyMireglassHerbForage(seed, first.player, first.region, 0, byId[0].id),
      'already_harvested', first.player, first.region)
    expect(first.player).toEqual(harvestedPlayer)
    expect(first.region).toEqual(harvestedRegion)
  })
})
