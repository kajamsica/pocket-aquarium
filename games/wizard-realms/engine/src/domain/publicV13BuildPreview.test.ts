import { describe, expect, it } from 'vitest'
import { backpackSlotsUsed } from './backpackSlots'
import { encodeDiscoveredTileIds } from './discoveryMask'
import { selectPublicV13BuildPreview } from './publicV13BuildPreview'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import { createFreshPublicWorld } from './publicWorldState'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { withPublicV11Highland } from './publicWorldV11State'
import { withPublicV12Windstep } from './publicWorldV12State'
import { emptyTerrainWorkLedger } from './terrainWorkLedger'
import { enumerateTerrainWorkSites, parseTerrainWorkId, resolveTerrainWorkSite } from './terrainWorks'
import type { TerrainWorkSite, TerrainWorkWindow } from './terrainWorks'

const seed = 'greenway-alpha'
const bridgeId = 'works1:bridge:-102:92:z'
const ladderId = 'works1:ladder:-103:108:W'
const digId = 'tile--64-76'
const base = withPublicV12Windstep(withPublicV11Highland(withPublicV10TerrainRevision(
  withFreshPublicV9Camps(withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))))))
const site = (id: string) => {
  const found = resolveTerrainWorkSite(seed, id)
  if (!found) throw new Error(`Missing canonical site: ${id}`)
  return found
}
const windowFor = (id: string): TerrainWorkWindow => {
  const anchor = parseTerrainWorkId(id)!
  return { minGX: anchor.gx - 7, maxGX: anchor.gx + 8,
    minGZ: anchor.gz - 7, maxGZ: anchor.gz + 8 }
}
const target = (candidate: TerrainWorkSite) => candidate.kind === 'dig' ? candidate.center
  : { x: (candidate.from.x + candidate.to.x) / 2,
    z: (candidate.from.z + candidate.to.z) / 2 }
const yawTo = (state: PublicV13Head['state'], candidate: TerrainWorkSite) => {
  const point = target(candidate)
  return Math.atan2(state.player.position.x - point.x, state.player.position.z - point.z)
}
function at(candidate: TerrainWorkSite, discovered = candidate.footprintTileIds): PublicV13Head['state'] {
  const { discoveredTileIds, ...source } = base
  const position = candidate.kind === 'dig' ? candidate.center : candidate.from
  return { ...source, movementOwner: 'streamed',
    discoveryMask: encodeDiscoveredTileIds([...new Set([...discoveredTileIds, ...discovered])].sort()),
    terrainWorks: emptyTerrainWorkLedger(),
    player: { ...source.player, position: { ...position }, verticalVelocity: 0,
      backpackCapacity: 30,
      inventory: [...source.player.inventory, { itemId: 'logs', quantity: 12 },
        { itemId: 'field_spade', quantity: 1 }],
      equipment: { ...source.player.equipment, mainHand: 'field_spade' } } }
}
const preview = (state: PublicV13Head['state'], candidate: TerrainWorkSite,
  sites: readonly TerrainWorkSite[] = [candidate], yaw = yawTo(state, candidate)) =>
  selectPublicV13BuildPreview(state, windowFor(candidate.id), sites, candidate.kind, yaw)

describe('compact public obstacle-build preview', () => {
  it.each([[bridgeId, 8, 'shallow Fen', '80 Construction'],
    [ladderId, 4, '1.56 m Slate', '60 Construction'],
    [digId, 0, 'Lower loam', '30 Excavation']] as const)(
    'advises a real ready %s without mutating compact state', (id, cost, benefit, xp) => {
      const candidate = site(id), state = at(candidate)
      const before = structuredClone(state), mask = state.discoveryMask
      const result = preview(state, candidate)
      expect(result.selected?.site).toEqual(candidate)
      expect(result.selected?.rejection).toBeNull()
      expect(result.selected?.reason).toMatch(/^Ready to /)
      expect(result.selected?.benefit).toContain(benefit)
      expect(result.selected?.benefit).toContain(xp)
      if (cost) expect(result.selected?.benefit).toContain(`${cost} logs`)
      else expect(result.selected?.benefit).toContain('Stone and 4 logs can make a camp')
      expect(result.nearby).toHaveLength(1)
      expect(result.guidance).toBeNull()
      expect(state).toEqual(before)
      expect(state.discoveryMask).toBe(mask)
    })

  it('hides an incomplete bridge footprint and asks for exploration, never a full ghost', () => {
    const candidate = site(bridgeId)
    const state = at(candidate, [candidate.footprintTileIds[1]])
    const result = preview(state, candidate)
    expect(result.selected).toBeNull()
    expect(result.nearby).toEqual([])
    expect(result.guidance).toBe('Explore the far bank before previewing a bridge.')
  })

  it('uses body yaw rather than camera aim, a 30-degree cone and a 16 m local radius', () => {
    const candidate = site(ladderId), state = at(candidate)
    expect(preview(state, candidate).selected?.site.id).toBe(ladderId)
    expect(preview(state, candidate, [candidate], yawTo(state, candidate) + Math.PI / 6 - 0.001)
      .selected?.site.id).toBe(ladderId)
    expect(preview(state, candidate, [candidate], yawTo(state, candidate) + Math.PI / 6 + 0.001)
      .selected).toBeNull()
    expect(preview(state, candidate, [candidate], yawTo(state, candidate) + Math.PI).selected).toBeNull()
    const far: PublicV13Head['state'] = { ...state, player: { ...state.player,
      position: { ...state.player.position, z: state.player.position.z + 20 } } }
    expect(preview(far, candidate).selected).toBeNull()
  })

  it('keeps a discovered site behind the player tappable without drawing an aim ghost', () => {
    const candidate = site(ladderId), state = at(candidate)
    const behind = preview(state, candidate, [candidate], yawTo(state, candidate) + Math.PI)
    expect(behind.selected).toBeNull()
    expect(behind.nearby.map(({ site }) => site.id)).toEqual([ladderId])
    expect(behind.nearby[0].distanceMeters).toBeCloseTo(2)
    expect(behind.guidance).toBeNull()
    const hidden = at(candidate, [candidate.footprintTileIds[0]])
    expect(preview(hidden, candidate, [candidate], yawTo(hidden, candidate) + Math.PI))
      .toMatchObject({ selected: null, nearby: [], guidance: null })
  })

  it('uses action-authority reach, log, spade, capacity and already-built reasons', () => {
    const bridge = site(bridgeId), ladder = site(ladderId), dig = site(digId)
    const readyBridge = at(bridge)
    const farBridge: PublicV13Head['state'] = { ...readyBridge, player: { ...readyBridge.player,
      position: { ...readyBridge.player.position, z: readyBridge.player.position.z - 4 } } }
    expect(preview(farBridge, bridge).selected).toMatchObject({ rejection: 'too_far',
      reason: 'Move within 3 m of the source foot.' })
    const shortBridge: PublicV13Head['state'] = { ...readyBridge, player: { ...readyBridge.player,
      inventory: readyBridge.player.inventory.map((stack) => stack.itemId === 'logs'
        ? { ...stack, quantity: 7 } : stack) } }
    expect(preview(shortBridge, bridge).selected).toMatchObject({ rejection: 'not_owned',
      reason: 'Gather 8 logs before building.' })
    const fullBridge: PublicV13Head['state'] = { ...readyBridge, player: { ...readyBridge.player,
      backpackCapacity: backpackSlotsUsed(readyBridge.player.inventory, readyBridge.player.tradeSlots) } }
    expect(preview(fullBridge, bridge).selected?.rejection).toBeNull()
    const readyLadder = at(ladder)
    const shortLadder: PublicV13Head['state'] = { ...readyLadder, player: { ...readyLadder.player,
      inventory: readyLadder.player.inventory.map((stack) => stack.itemId === 'logs'
        ? { ...stack, quantity: 3 } : stack) } }
    expect(preview(shortLadder, ladder).selected).toMatchObject({ rejection: 'not_owned',
      reason: 'Gather 4 logs before building.' })
    const readyDig = at(dig)
    const noSpade: PublicV13Head['state'] = { ...readyDig, player: { ...readyDig.player,
      equipment: { ...readyDig.player.equipment, mainHand: null } } }
    expect(preview(noSpade, dig).selected).toMatchObject({ rejection: 'requires_spade',
      reason: 'Own and equip a field spade to dig.' })
    const used = backpackSlotsUsed(readyDig.player.inventory, readyDig.player.tradeSlots)
    const full: PublicV13Head['state'] = { ...readyDig, player: { ...readyDig.player,
      backpackCapacity: used } }
    expect(preview(full, dig).selected).toMatchObject({ rejection: 'capacity',
      reason: 'Free one backpack slot for the stone.' })
    const built: PublicV13Head['state'] = { ...readyBridge,
      terrainWorks: { builtWorkIds: [bridge.id], dugTileIds: [] } }
    expect(preview(built, bridge).selected).toMatchObject({ rejection: 'already_done',
      reason: 'Already built here.' })

    const occupiedDig = site('tile--95-93'), atOccupied = at(occupiedDig)
    const occupied: PublicV13Head['state'] = { ...atOccupied,
      mireglass: { ...atOccupied.mireglass, builtRoutes: { ...atOccupied.mireglass.builtRoutes,
        bridge: 'mireglass_reach/route/fen_bridge/-98/92' } } }
    expect(preview(occupied, occupiedDig).selected).toMatchObject({ rejection: 'occupied',
      reason: 'This footprint overlaps another work or camp.' })
  })

  it('ranks angle before distance, then canonical ID, and caps nearby choices at five', () => {
    const window = { minGX: -74, maxGX: -59, minGZ: 66, maxGZ: 81 }
    const digs = enumerateTerrainWorkSites(seed, window).filter((candidate) => candidate.kind === 'dig')
    expect(digs.length).toBeGreaterThanOrEqual(6)
    const chosen = digs.slice(0, 6)
    const state = at(chosen[0], chosen.flatMap((candidate) => candidate.footprintTileIds))
    const { x, z } = state.player.position
    const positions = [[0, -8], [0, -3], [0, -3], [0.2, -2], [0.4, -2], [0.6, -2]]
    const cached = chosen.map((candidate, index) => ({ ...candidate,
      center: { ...candidate.center, x: x + positions[index][0], z: z + positions[index][1] } }))
    const first = selectPublicV13BuildPreview(state, window, cached, 'dig', 0)
    const replay = selectPublicV13BuildPreview(state, window, [...cached].reverse(), 'dig', 0)
    const expected = [chosen[1].id, chosen[2].id, chosen[0].id, chosen[3].id, chosen[4].id]
    expect(first.nearby.map(({ site }) => site.id)).toEqual(expected)
    expect(replay.nearby.map(({ site }) => site.id)).toEqual(expected)
    expect(first.selected?.site.id).toBe(expected[0])
    expect(first.nearby).toHaveLength(5)
  })

  it('rejects a stale or oversized cached window instead of scanning an unbounded list', () => {
    const candidate = site(digId), state = at(candidate)
    const window = windowFor(candidate.id)
    expect(() => selectPublicV13BuildPreview(state, { ...window, maxGX: window.maxGX + 1 },
      [candidate], 'dig', 0)).toThrow(RangeError)
    expect(() => selectPublicV13BuildPreview(state, window,
      Array(1793).fill(candidate), 'dig', 0)).toThrow(RangeError)
    expect(() => selectPublicV13BuildPreview(state, window,
      [candidate, candidate], 'dig', 0)).toThrow(RangeError)
  })
})
