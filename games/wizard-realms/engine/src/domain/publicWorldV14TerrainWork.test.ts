import { describe, expect, it } from 'vitest'
import { backpackSlotsUsed } from './backpackSlots'
import { encodeDiscoveredTileIds } from './discoveryMask'
import { confirmPublicV14TerrainWork, previewPublicV14TerrainWork } from './publicWorldV14TerrainWork'
import { createFreshPublicV14Head } from './publicWorldV14Snapshot'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { resolvePublicV14Surface } from './publicWorldV14Terrain'
import { validatePublicV14State } from './publicWorldV14Validation'
import { resolveTerrainWorkSite } from './terrainWorks'
import type { TerrainWorkSite } from './terrainWorks'

const seed = 'greenway-alpha'
const bridgeId = 'works1:bridge:-102:92:z'
const ladderId = 'works1:ladder:-103:108:W'
const digId = 'tile--64-76'
const base = () => createFreshPublicV14Head(seed).head.state
const site = (id: string): TerrainWorkSite => {
  const found = resolveTerrainWorkSite(seed, id)
  if (!found) throw new Error(`Missing canonical ${id}`)
  return found
}
function discovered(state: PublicV14State, ids: readonly string[]) {
  const mask = new Uint8Array(state.discoveryMask)
  const bits = encodeDiscoveredTileIds([...new Set(ids)].sort())
  for (let index = 0; index < mask.length; index++) mask[index] |= bits[index]
  return mask
}
function at(id: string): PublicV14State {
  const work = site(id), initial = base()
  const seen = work.kind === 'dig' ? work.footprintTileIds[0] : work.footprintTileIds[1]
  const points = work.kind === 'dig'
    ? [{ x: work.center.x + 2.5, z: work.center.z },
      { x: work.center.x - 2.5, z: work.center.z },
      { x: work.center.x, z: work.center.z + 2.5 },
      { x: work.center.x, z: work.center.z - 2.5 }]
    : [{ x: work.from.x, z: work.from.z }]
  for (const point of points) {
    const floor = resolvePublicV14Surface(initial, point)
    if (!floor) continue
    const state: PublicV14State = { ...initial, tick: 1, movementOwner: 'streamed',
      discoveryMask: discovered(initial, [floor.tileId, seen]),
      player: { ...initial.player, position: { ...point, y: floor.floorY },
        backpackCapacity: 30,
        inventory: [...initial.player.inventory.filter((stack) =>
          stack.itemId !== 'logs' && stack.itemId !== 'field_spade'),
        { itemId: 'logs', quantity: 12 }, { itemId: 'field_spade', quantity: 1 }],
        equipment: { ...initial.player.equipment, mainHand: 'field_spade' } } }
    if (validatePublicV14State(state, seed)) return state
  }
  throw new Error(`No valid streamed approach for ${id}`)
}
const count = (state: PublicV14State, id: string) => state.player.inventory
  .filter((stack) => stack.itemId === id).reduce((sum, stack) => sum + stack.quantity, 0)
const rejectUnchanged = (state: PublicV14State, id: unknown, code: string) => {
  const before = structuredClone(state)
  const result = confirmPublicV14TerrainWork(state, id)
  expect(result.rejection).toBe(code)
  expect(result.candidate).toBeUndefined()
  expect(result.event).toBeUndefined()
  expect(state).toEqual(before)
}

describe('pure v14 streamed terrain work', () => {
  it.each([[bridgeId, 8, 80], [ladderId, 4, 60]] as const)(
    'builds canonical %s for logs and construction XP without a source lease', (id, cost, xp) => {
      const state = at(id), before = structuredClone(state)
      expect(previewPublicV14TerrainWork(state, id).rejection).toBeNull()
      const result = confirmPublicV14TerrainWork(state, id)
      expect(result.rejection).toBeUndefined()
      expect(result.event).toEqual({ type: 'terrain_work_built', id,
        tick: state.tick, sequence: state.eventSequence + 1,
        logsSpent: cost, stoneGained: 0, xp })
      expect(result.candidate?.terrainWorks.builtWorkIds).toEqual([id])
      expect(count(result.candidate!, 'logs')).toBe(12 - cost)
      expect(result.candidate?.player.skillXp.construction).toBe(xp)
      expect(result.candidate?.player.xp).toBe(xp)
      expect(result.candidate?.tick).toBe(state.tick)
      expect(validatePublicV14State(result.candidate, seed)).not.toBeNull()
      expect(state).toEqual(before)
      rejectUnchanged(result.candidate!, id, 'already_done')
    })

  it('digs from supported nearby ground, with an equipped owned spade and free capacity', () => {
    const state = at(digId), before = structuredClone(state)
    expect(previewPublicV14TerrainWork(state, digId).rejection).toBeNull()
    const result = confirmPublicV14TerrainWork(state, digId)
    expect(result.event).toEqual({ type: 'terrain_work_dug', id: digId,
      tick: state.tick, sequence: state.eventSequence + 1,
      logsSpent: 0, stoneGained: 1, xp: 30 })
    expect(result.candidate?.terrainWorks.dugTileIds).toEqual([digId])
    expect(count(result.candidate!, 'stone')).toBe(1)
    expect(result.candidate?.player.skillXp.excavation).toBe(30)
    expect(validatePublicV14State(result.candidate, seed)).not.toBeNull()
    expect(state).toEqual(before)
  })

  it('agrees that digging under the player requires stepping off the target tile', () => {
    const beside = at(digId), work = site(digId)
    if (work.kind !== 'dig') throw new Error('Expected dig fixture')
    for (const point of [work.center, { x: work.center.x + 1.9,
      z: work.center.z + 1.9 }]) {
      const floor = resolvePublicV14Surface(beside, point)!
      const onTarget: PublicV14State = { ...beside,
        player: { ...beside.player, position: { ...point, y: floor.floorY } } }
      expect(validatePublicV14State(onTarget, seed)).not.toBeNull()
      expect(previewPublicV14TerrainWork(onTarget, digId).rejection).toBe('occupied')
      rejectUnchanged(onTarget, digId, 'occupied')
    }
    expect(confirmPublicV14TerrainWork(beside, digId).candidate).toBeDefined()
  })

  it('rechecks stale preview materials, spade, capacity and discovery at confirmation', () => {
    const bridge = at(bridgeId)
    expect(previewPublicV14TerrainWork(bridge, bridgeId).rejection).toBeNull()
    const withoutLogs = { ...bridge, player: { ...bridge.player,
      inventory: bridge.player.inventory.filter((stack) => stack.itemId !== 'logs') } }
    expect(previewPublicV14TerrainWork(withoutLogs, bridgeId).site?.id).toBe(bridgeId)
    rejectUnchanged(withoutLogs, bridgeId, 'not_owned')
    const dig = at(digId)
    rejectUnchanged({ ...dig, player: { ...dig.player,
      equipment: { ...dig.player.equipment, mainHand: null } } }, digId, 'requires_spade')
    const used = backpackSlotsUsed(dig.player.inventory, dig.player.tradeSlots)
    const full = { ...dig, player: { ...dig.player, backpackCapacity: used } }
    expect(validatePublicV14State(full, seed)).not.toBeNull()
    rejectUnchanged(full, digId, 'capacity')
    const work = site(bridgeId)
    if (work.kind === 'dig') throw new Error('Expected bridge')
    const farFloor = resolvePublicV14Surface(bridge, work.to)!
    const far = { ...bridge,
      player: { ...bridge.player, position: { ...work.to, y: farFloor.floorY } },
      discoveryMask: discovered(bridge, [farFloor.tileId]) }
    expect(validatePublicV14State(far, seed)).not.toBeNull()
    rejectUnchanged(far, bridgeId, 'too_far')
    const near = { x: work.from.x + 0.625 * (work.approach.x - work.from.x),
      z: work.from.z + 0.625 * (work.approach.z - work.from.z) }
    const nearFloor = resolvePublicV14Surface(bridge, near)!
    expect(nearFloor.tileId).not.toBe(work.footprintTileIds[1])
    const hidden = { ...bridge,
      player: { ...bridge.player, position: { ...near, y: nearFloor.floorY } },
      discoveryMask: discovered(base(), [nearFloor.tileId]) }
    expect(previewPublicV14TerrainWork(hidden, bridgeId).rejection).toBe('undiscovered')
    rejectUnchanged(hidden, bridgeId, 'undiscovered')
  })

  it('rejects phantom, unsupported and occupied sites atomically', () => {
    const state = at(bridgeId)
    rejectUnchanged(state, 'works1:bridge:9999:9999:z', 'invalid_site')
    rejectUnchanged(base(), bridgeId, 'unavailable_here')
    rejectUnchanged({ ...state, player: { ...state.player,
      position: { ...state.player.position, y: state.player.position.y + 0.2 } } },
    bridgeId, 'invalid_progress')
    rejectUnchanged({ ...state, movementOwner: 'greenway' }, bridgeId, 'invalid_progress')
    const approachDig = 'tile--95-93'
    const dig = at(approachDig)
    const occupied: PublicV14State = { ...dig,
      player: { ...dig.player, xp: 80,
        skillXp: { ...dig.player.skillXp, construction: 80 } },
      mireglass: { ...dig.mireglass, builtRoutes: { ...dig.mireglass.builtRoutes,
        bridge: 'mireglass_reach/route/fen_bridge/-98/92' } } }
    expect(validatePublicV14State(occupied, seed)).not.toBeNull()
    rejectUnchanged(occupied, approachDig, 'occupied')
  })
})
