import { describe, expect, it } from 'vitest'
import { discoveryMaskHasTileId, encodeDiscoveredTileIds } from './discoveryMask'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { advancePublicV14BoundaryFrame, publicV14InsideGreenway } from './publicWorldV14Boundary'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { createFreshPublicV14State, validatePublicV14State } from './publicWorldV14Validation'
import { starterCliffSupportAt } from './starterCliffMovement'
import { starterCliffWorldTileAtGrid } from './starterCliffWorld'
import { resolvePublicV14Surface } from './publicWorldV14Terrain'
import { stepRng } from './world'

const seed = 'greenway-alpha'
const cell = (value: number) => Math.ceil(value / 4 - 0.5)
const tile = (sourceSeed: string, x: number, z: number) =>
  starterCliffWorldTileAtGrid(sourceSeed, cell(x), cell(z))
const move = (x: number, z: number) => [{ type: 'move' as const, delta: { x, z } }]
const frame = (state: PublicV14State, dx: number, dz: number) =>
  advancePublicV14BoundaryFrame(state, move(dx, dz), { walkRequested: true })
function at(x: number, z: number, owner: PublicV14State['movementOwner'] = 'greenway',
  sourceSeed = seed): PublicV14State {
  const base = createFreshPublicV14State(sourceSeed)
  const point = { x, z }
  const floor = owner === 'greenway'
    ? starterCliffSupportAt({ seed: sourceSeed, profile: base.generationProfile,
      route: base.greenway.routes[0], built: false }, point)!.floorY
    : resolvePublicV14Surface(base, point)!.floorY
  const mask = new Uint8Array(base.discoveryMask)
  const bit = encodeDiscoveredTileIds([tile(sourceSeed, x, z).id])
  for (let index = 0; index < mask.length; index++) mask[index] |= bit[index]
  return { ...base, movementOwner: owner, discoveryMask: mask,
    player: { ...base.player, position: { ...point, y: floor } } }
}
const edges = [
  { name: 'west', x: -30, z: 0, dx: -0.16, dz: 0 },
  { name: 'east', x: 34, z: 0, dx: 0.16, dz: 0 },
  { name: 'south', x: 0, z: -30, dx: 0, dz: -0.16 },
  { name: 'north', x: 0, z: 34, dx: 0, dz: 0.16 },
] as const
function dryEdge(edge: typeof edges[number]) {
  for (let value = -28; value <= 32; value += 4) {
    const x = edge.dx ? edge.x : value, z = edge.dz ? edge.z : value
    if (tile(seed, x, z).terrain === 'wetland'
      || tile(seed, x + edge.dx, z + edge.dz).terrain === 'wetland') continue
    const state = at(x, z)
    const result = frame(state, edge.dx, edge.dz)
    if (result.candidate) return { state, result, dx: edge.dx, dz: edge.dz }
  }
  throw new Error(`No dry ${edge.name} v14 crossing found.`)
}

describe('pure v14 owner boundary', () => {
  it('opts in only V27-style dry diagonal owner joins in both directions', () => {
    const sourceSeed = 'wizard-realms'
    const origin = at(14.05, 33.95, 'greenway', sourceSeed)
    const forward = move(-0.1, 0.1)
    const back = move(0.1, -0.1)
    const walk = { walkRequested: true }
    const policy = { maxOrdinaryGroundStepMeters: 0.8 } as const
    const target = { x: 13.95, z: 34.05 }
    const rise = Math.abs(origin.player.position.y
      - starterCliffSupportAt({ seed: sourceSeed, profile: origin.generationProfile,
        route: origin.greenway.routes[0], built: false }, target)!.floorY)
    expect(rise).toBeGreaterThan(0.55)
    expect(rise).toBeLessThan(0.8)
    expect(validatePublicV14State(origin, sourceSeed)).not.toBeNull()
    expect(advancePublicV14BoundaryFrame(origin, forward, walk).candidate).toBeNull()
    const crossed = advancePublicV14BoundaryFrame(origin, forward, walk, policy)
    expect(crossed.rejections).toEqual([])
    expect(crossed.candidate?.movementOwner).toBe('streamed')
    if (!crossed.candidate) return
    expect(validatePublicV14State(crossed.candidate, sourceSeed)).not.toBeNull()
    expect(advancePublicV14BoundaryFrame(crossed.candidate, back, walk).candidate).toBeNull()
    const returned = advancePublicV14BoundaryFrame(crossed.candidate, back, walk, policy)
    expect(returned.rejections).toEqual([])
    expect(returned.candidate?.movementOwner).toBe('greenway')
    expect(returned.candidate?.player.position.x).toBeCloseTo(origin.player.position.x)
    expect(returned.candidate?.player.position.z).toBeCloseTo(origin.player.position.z)
    expect(returned.candidate?.player.position.y).toBeCloseTo(origin.player.position.y)
  })
  it.each(edges)('crosses the $name edge and returns with one tick per direction', (edge) => {
    const { state, result, dx, dz } = dryEdge(edge)
    expect(validatePublicV14State(state, seed)).not.toBeNull()
    expect(result.rejections).toEqual([])
    expect(result.candidate?.movementOwner).toBe('streamed')
    expect(result.candidate?.tick).toBe(state.tick + 1)
    expect(result.candidate?.rng.simulation).toBe(stepRng(state.rng.simulation))
    expect(result.candidate?.eventSequence).toBe(state.eventSequence + result.events.length)
    expect(result.events.map((event) => event.sequence)).toEqual(
      result.events.map((_, index) => state.eventSequence + index + 1))
    const expected = nearbyWorldTileIds(result.candidate!.player.position,
      PUBLIC_WALK_REVEAL_RADIUS_METERS).filter((id) =>
      !discoveryMaskHasTileId(state.discoveryMask, id))
    expect(result.events.filter((event) => event.type === 'tile_discovered')
      .map((event) => event.tileId)).toEqual(expected)
    const returned = frame(result.candidate!, -dx, -dz)
    expect(returned.rejections).toEqual([])
    expect(returned.candidate?.movementOwner).toBe('greenway')
    expect(returned.candidate?.player.position).toEqual(state.player.position)
    expect(returned.candidate?.tick).toBe(state.tick + 2)
    expect(returned.candidate?.rng.simulation).toBe(stepRng(result.candidate!.rng.simulation))
    expect(returned.candidate?.eventSequence)
      .toBe(result.candidate!.eventSequence + returned.events.length)
    expect(validatePublicV14State(returned.candidate, seed)).not.toBeNull()
  })

  it('uses inclusive owner edges but lower-center tile ties', () => {
    for (const point of [{ x: -30, z: 0 }, { x: 34, z: 0 },
      { x: 0, z: -30 }, { x: 0, z: 34 }]) expect(publicV14InsideGreenway(point)).toBe(true)
    expect(publicV14InsideGreenway({ x: -30 - 1e-7, z: 0 })).toBe(false)
    expect(publicV14InsideGreenway({ x: 34 + 1e-7, z: 0 })).toBe(false)
    expect(cell(-30)).toBe(-8)
    expect(cell(34)).toBe(8)
    expect(tile(seed, -30, 0).id).toBe('tile--5-3')
  })

  it('checks all four diagonal corner cuts and blocks a side-only wet cell', () => {
    for (const [x, z, sx, sz] of [[-30, -30, -1, -1], [-30, 34, -1, 1],
      [34, -30, 1, -1], [34, 34, 1, 1]]) {
      const from = { x: x - sx * 0.05, z: z - sz * 0.05 }
      const state = at(from.x, from.z)
      const before = structuredClone(state)
      const result = frame(state, sx * 0.1, sz * 0.1)
      if (result.candidate) {
        expect(result.candidate.movementOwner).toBe('streamed')
        expect(validatePublicV14State(result.candidate, seed)).not.toBeNull()
      } else expect(result.events).toEqual([])
      expect(state).toEqual(before)
    }
    let found = false
    for (let index = 0; index < 240 && !found; index++) {
      const sourceSeed = index ? `boundary-wet-${index}` : seed
      for (const edge of edges) for (let grid = -28; grid <= 32 && !found; grid += 4) {
        for (const direction of [-1, 1]) {
          const axis = grid + 2
          const from = edge.dx
            ? { x: edge.x - Math.sign(edge.dx) * 0.05, z: axis - direction * 0.05 }
            : { x: axis - direction * 0.05, z: edge.z - Math.sign(edge.dz) * 0.05 }
          const to = edge.dx
            ? { x: edge.x + Math.sign(edge.dx) * 0.05, z: axis + direction * 0.05 }
            : { x: axis + direction * 0.05, z: edge.z + Math.sign(edge.dz) * 0.05 }
          const sides = [starterCliffWorldTileAtGrid(sourceSeed, cell(from.x), cell(to.z)),
            starterCliffWorldTileAtGrid(sourceSeed, cell(to.x), cell(from.z))]
          if (tile(sourceSeed, from.x, from.z).terrain === 'wetland'
            || tile(sourceSeed, to.x, to.z).terrain === 'wetland'
            || !sides.some((side) => side.terrain === 'wetland')) continue
          const state = at(from.x, from.z, 'greenway', sourceSeed)
          const before = structuredClone(state)
          const result = advancePublicV14BoundaryFrame(state,
            [{ type: 'look', yawDelta: 0.2, pitchDelta: 0 },
              ...move(to.x - from.x, to.z - from.z)], { walkRequested: true })
          if (result.rejections[0]?.code !== 'terrain_missing') continue
          expect(advancePublicV14BoundaryFrame(state,
            [{ type: 'look', yawDelta: 0.2, pitchDelta: 0 },
              ...move(to.x - from.x, to.z - from.z)], { walkRequested: true },
            { maxOrdinaryGroundStepMeters: 0.8 }).rejections[0]?.code).toBe('terrain_missing')
          expect(result.candidate).toBeNull()
          expect(result.events).toEqual([])
          expect(state).toEqual(before)
          found = true
          break
        }
      }
    }
    expect(found).toBe(true)
  })

  it('rejects airborne, overstep, noncrossing, cliff-skip and world-edge attempts atomically', () => {
    const edge = dryEdge(edges[0]).state
    const airborne = { ...edge, player: { ...edge.player,
      position: { ...edge.player.position, y: edge.player.position.y + 0.25 }, verticalVelocity: 4.51 } }
    for (const [state, dx, dz, code] of [
      [airborne, -0.16, 0, 'airborne'], [edge, -0.17, 0, 'invalid_value'],
      [edge, 0.16, 0, 'unavailable_here'], [at(0, -5.9), 0, -0.16, 'unavailable_here'],
      [at(1022, 0, 'streamed'), 0.16, 0, 'out_of_bounds'],
      [at(-1026 + 1e-7, 0, 'streamed'), -0.16, 0, 'out_of_bounds'],
    ] as const) {
      const before = structuredClone(state)
      const result = frame(state, dx, dz)
      expect(result.candidate).toBeNull()
      expect(result.rejections[0]?.code).toBe(code)
      expect(result.events).toEqual([])
      expect(state).toEqual(before)
    }
    expect(advancePublicV14BoundaryFrame(at(1022, 0, 'streamed'), move(0.16, 0),
      { walkRequested: true }, { maxOrdinaryGroundStepMeters: 0.8 })
      .rejections[0]?.code).toBe('out_of_bounds')
  })

  it('settles one due market tick after look, move and discovery', () => {
    const edge = dryEdge(edges[0]).state
    const listing = { ...edge, tick: 599, player: { ...edge.player,
      tradeSlots: [{ ...edge.player.tradeSlots[0], itemId: 'logs' as const,
        quantity: 1, unitPrice: 2 }, ...edge.player.tradeSlots.slice(1)] as typeof edge.player.tradeSlots } }
    const result = advancePublicV14BoundaryFrame(listing,
      [{ type: 'look', yawDelta: 0.1, pitchDelta: 0.02 }, ...move(-0.16, 0)],
      { walkRequested: true })
    expect(result.rejections).toEqual([])
    expect(result.events.slice(0, 2).map((event) => event.type)).toEqual(['player_looked', 'player_moved'])
    expect(result.events.filter((event) => event.type === 'trade_listing_sold')).toHaveLength(1)
    expect(result.candidate?.player.coins).toBe(edge.player.coins + 2)
    expect(result.candidate?.eventSequence).toBe(listing.eventSequence + result.events.length)
  })
})
