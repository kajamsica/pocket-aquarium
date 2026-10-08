import { describe, expect, it } from 'vitest'
import { createGeneratedWorld, terrainHeightAt } from './generation'
import { isValidMireglassRegionProgress, isValidMireglassV6Player } from './mireglassExpedition'
import { serializeWizardWorld } from './persistence'
import { commitLegacyImportToPublicV6, inspectLegacyImportSource } from './publicWorldV6'
import { advancePublicWorld, advancePublicWorldFrame } from './publicWorldRuntime'
import type { PublicWorldIntent } from './publicWorldRuntime'
import { createFreshPublicWorld, createPublicWorldFromBootstrap } from './publicWorldState'
import type { PublicWorldState } from './publicWorldState'
import type { GenerationProfile } from './types'

const seed = 'greenway-alpha'
const classic = 'greenway-classic-v1'
const expanded = 'greenway-expanded-v1'
const walkMeters = 0.16
const nextSimulationRng = (value: number) => {
  let next = value | 0
  next ^= next << 13
  next ^= next >>> 17
  next ^= next << 5
  return next >>> 0 || 1
}

function atEdge(profile: GenerationProfile, x: number, z = 0): PublicWorldState {
  const fresh = createFreshPublicWorld(seed, profile)
  return { ...fresh, player: { ...fresh.player,
    position: { x, y: terrainHeightAt(fresh.greenway.tiles, x, z), z } } }
}

function importedExpandedEdge(): PublicWorldState {
  const legacy = createGeneratedWorld(seed, expanded)
  legacy.player.position = { x: -30, y: terrainHeightAt(legacy.tiles, -30, 0), z: 0 }
  legacy.tick = 37
  legacy.eventSequence = 12
  legacy.player.coins = 73
  legacy.player.inventory.push({ itemId: 'field_spade', quantity: 1 })
  legacy.player.equipment.mainHand = 'field_spade'
  legacy.stores[0].listings[0].stock -= 1
  const key = 'wizard-realms:world:expanded:v4'
  const bytes = serializeWizardWorld(legacy)
  const values = new Map([[key, bytes]])
  const storage = {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => { values.set(name, value) },
  }
  const inspected = inspectLegacyImportSource(storage, expanded)
  expect(inspected.status).toBe('available')
  if (inspected.status !== 'available') throw new Error('Expected a compatible expanded edge save.')
  const committed = commitLegacyImportToPublicV6(storage, inspected)
  expect(committed.status).toBe('committed')
  if (committed.status !== 'committed') throw new Error('Expected a public import root.')
  expect(storage.getItem(key)).toBe(bytes)
  return createPublicWorldFromBootstrap(committed.root)
}

function turnAndWalk(yaw: number, key: 'A' | 'D', meters: number): PublicWorldIntent[] {
  const yawDelta = key === 'A' ? 0.13 : -0.13
  const facing = yaw + yawDelta
  return [
    { type: 'look', yawDelta, pitchDelta: 0 },
    { type: 'move', delta: { x: -Math.sin(facing) * meters, z: -Math.cos(facing) * meters } },
  ]
}

function expectOneFrame(before: PublicWorldState, after: ReturnType<typeof advancePublicWorldFrame>) {
  expect(after.rejections).toEqual([])
  expect(after.state.tick).toBe(before.tick + 1)
  expect(after.state.rng.simulation).toBe(nextSimulationRng(before.rng.simulation))
  expect(after.state.eventSequence).toBe(before.eventSequence + after.events.length)
  expect(after.events.map(({ sequence }) => sequence))
    .toEqual(after.events.map((_, index) => before.eventSequence + index + 1))
  expect(after.events.every(({ tick }) => tick === before.tick + 1)).toBe(true)
  expect(after.events.slice(0, 2).map(({ type }) => type)).toEqual(['player_looked', 'player_moved'])
}

describe('public v6 authority handoff', () => {
  it('settles an escrowed Greenway listing during a Mireglass expedition without a second player', () => {
    const edge = atEdge(classic, -12)
    const ready: PublicWorldState = { ...edge, tick: 596,
      player: { ...edge.player, inventory: [...edge.player.inventory, { itemId: 'logs', quantity: 1 }] } }
    const listed = advancePublicWorldFrame(ready, [
      { type: 'create_trade_listing', slotIndex: 0, itemId: 'logs', quantity: 1, unitPrice: 3 },
    ])
    expect(listed.rejections).toEqual([])
    expect(listed.state.player.tradeSlots[0].itemId).toBe('logs')
    const outbound = advancePublicWorldFrame(listed.state, [{ type: 'move', delta: { x: -4, z: 0 } }])
    expect(outbound.rejections).toEqual([])
    expect(outbound.state.movementOwner).toBe('streamed')
    const beforeSale = advancePublicWorldFrame(outbound.state, [])
    expect(beforeSale.state.tick).toBe(599)
    const settled = advancePublicWorldFrame(beforeSale.state, [])
    const replay = advancePublicWorldFrame(beforeSale.state, [])
    expect(settled).toEqual(replay)
    expect(settled.state.tick).toBe(600)
    expect(settled.state.movementOwner).toBe('streamed')
    expect(settled.state.player.coins).toBe(ready.player.coins + 3)
    expect(settled.state.player.tradeSlots[0].itemId).toBeNull()
    expect(settled.events).toContainEqual({ type: 'trade_listing_sold', slotIndex: 0,
      itemId: 'logs', quantity: 1, unitPrice: 3, totalPrice: 3,
      tick: 600, sequence: beforeSale.state.eventSequence + 1 })
    expect(settled.state.eventSequence).toBe(beforeSale.state.eventSequence + settled.events.length)
    expect(advancePublicWorldFrame(settled.state, []).events.some((event) => event.type === 'trade_listing_sold')).toBe(false)
  })

  it.each(['A', 'D'] as const)('applies W+%s as one Greenway look-then-move frame', (key) => {
    const start = createFreshPublicWorld(seed, classic)
    const intents = turnAndWalk(start.player.yaw, key, walkMeters)
    const result = advancePublicWorldFrame(start, intents)
    expectOneFrame(start, result)
    expect(result.state.movementOwner).toBe('greenway')
    expect(result.state.player.yaw).toBeCloseTo(key === 'A' ? 0.13 : -0.13)
    const move = intents[1]
    if (move.type !== 'move') throw new Error('Expected movement intent.')
    expect(result.state.player.position.x).toBeCloseTo(start.player.position.x + move.delta.x)
    expect(result.state.player.position.z).toBeCloseTo(start.player.position.z + move.delta.z)
    expect(Math.sign(result.state.player.position.x)).toBe(key === 'A' ? -1 : 1)
  })

  it.each(['A', 'D'] as const)('applies W+%s as one streamed frame and preserves replay', (key) => {
    const westFacing = { ...atEdge(classic, -12), player: { ...atEdge(classic, -12).player,
      yaw: Math.PI / 2 } }
    const out = advancePublicWorld(westFacing, { type: 'move', delta: { x: -4, z: 0 } })
    expect(out.rejections).toEqual([])
    const intents = turnAndWalk(out.state.player.yaw, key, walkMeters)
    const result = advancePublicWorldFrame(out.state, intents)
    const replay = advancePublicWorldFrame(out.state, intents)
    expect(result).toEqual(replay)
    expectOneFrame(out.state, result)
    expect(result.state.movementOwner).toBe('streamed')
    const move = intents[1]
    if (move.type !== 'move') throw new Error('Expected movement intent.')
    expect(result.state.player.position.x).toBeCloseTo(out.state.player.position.x + move.delta.x)
    expect(result.state.player.position.z).toBeCloseTo(out.state.player.position.z + move.delta.z)
    expect(Math.sign(result.state.player.position.z)).toBe(key === 'A' ? 1 : -1)
    const next = advancePublicWorldFrame(result.state, [{ type: 'look', yawDelta: 0.02, pitchDelta: 0 }])
    expect(next.rejections).toEqual([])
    expect(next.state.tick).toBe(result.state.tick + 1)
  })

  it.each([
    [classic, -12], [expanded, -30],
  ] as const)('applies W+A and W+D at the %s seam with one owner and one tick', (profile, edgeX) => {
    for (const key of ['A', 'D'] as const) {
      const edge = atEdge(profile, edgeX)
      const westFacing: PublicWorldState = { ...edge, player: { ...edge.player, yaw: Math.PI / 2 } }
      const outwardIntents = turnAndWalk(westFacing.player.yaw, key, walkMeters)
      const outbound = advancePublicWorldFrame(westFacing, outwardIntents)
      expectOneFrame(westFacing, outbound)
      expect(outbound.state.movementOwner).toBe('streamed')
      expect(outbound.state.player.position.x).toBeLessThan(edgeX)
      expect(Math.sign(outbound.state.player.position.z)).toBe(key === 'A' ? 1 : -1)

      const eastFacing: PublicWorldState = { ...outbound.state,
        player: { ...outbound.state.player, yaw: -Math.PI / 2 } }
      const returnIntents = turnAndWalk(eastFacing.player.yaw, key, walkMeters)
      const inbound = advancePublicWorldFrame(eastFacing, returnIntents)
      expectOneFrame(eastFacing, inbound)
      expect(inbound.state.movementOwner).toBe('greenway')
      expect(inbound.state.player.position.x).toBeCloseTo(edgeX)
      expect(inbound.state.player.position.z).toBeCloseTo(0)
      expect(outbound.state.tick).toBe(westFacing.tick + 1)
      expect(inbound.state.tick).toBe(westFacing.tick + 2)
    }
  })

  it('rejects a wrong or invalid frame atomically, including an otherwise valid look', () => {
    const start = createFreshPublicWorld(seed, classic)
    const frame = turnAndWalk(start.player.yaw, 'A', 1.5)
    const reversed = advancePublicWorldFrame(start, [frame[1], frame[0]])
    expect(reversed.rejections).toMatchObject([{ code: 'invalid_frame' }])
    expect(reversed.state).toBe(start)
    const invalidMove = advancePublicWorldFrame(start, [frame[0],
      { type: 'move', delta: { x: Infinity, z: 0 } }])
    expect(invalidMove.rejections).toMatchObject([{ code: 'invalid_value', intentIndex: 1 }])
    expect(invalidMove.state).toBe(start)
    expect(invalidMove.events).toEqual([])
    const edge = atEdge(classic, -12, 4)
    const blocked = advancePublicWorldFrame(edge, turnAndWalk(Math.PI / 2, 'D', 4))
    expect(blocked.rejections).toMatchObject([{ code: 'off_connector', intentIndex: 1 }])
    expect(blocked.state).toBe(edge)
    expect(blocked.events).toEqual([])

    const out = advancePublicWorld(atEdge(classic, -12), { type: 'move', delta: { x: -4, z: 0 } })
    expect(out.rejections).toEqual([])
    const badStreamFrame = advancePublicWorldFrame(out.state, [
      { type: 'look', yawDelta: 1_000_001, pitchDelta: 0 },
      { type: 'move', delta: { x: -walkMeters, z: 0 } },
    ])
    expect(badStreamFrame.rejections).toMatchObject([{ code: 'invalid_value', intentIndex: 0 }])
    expect(badStreamFrame.state).toBe(out.state)
    expect(badStreamFrame.events).toEqual([])
    const goodFrame = turnAndWalk(out.state.player.yaw, 'A', walkMeters)
    const retried = advancePublicWorldFrame(out.state, goodFrame)
    expect(retried.rejections).toEqual([])
    expect(advancePublicWorldFrame(out.state, goodFrame)).toEqual(retried)
  })

  it('runs a Greenway v5 action with complete detached facts and one authoritative player', () => {
    const original = createFreshPublicWorld(seed, classic)
    const result = advancePublicWorld(original, { type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' })
    expect(result.rejections).toEqual([])
    expect(result.events.map(({ type }) => type)).toContain('item_equipped')
    expect(result.state.tick).toBe(original.tick + 1)
    expect(result.state.eventSequence).toBe(original.eventSequence + result.events.length)
    expect(result.state.player.equipment.mainHand).toBe('woodcutters_axe')
    expect(result.state.player.inventory).toEqual(original.player.inventory)
    expect(result.state.greenway.tiles).toEqual(original.greenway.tiles)
    expect(Object.hasOwn(result.state.greenway, 'player')).toBe(false)
    expect(Object.hasOwn(result.state.mireglass, 'player')).toBe(false)
    expect(original.player.equipment.mainHand).toBeNull()
  })

  it.each([
    [classic, -12, -4, 4], [expanded, -30, -2, 2],
  ] as const)('crosses %s southwest seam out and back in one tick per move', (profile, edgeX, outDx, backDx) => {
    const edge = atEdge(profile, edgeX)
    const originalGreenway = edge.greenway
    const out = advancePublicWorld(edge, { type: 'move', delta: { x: outDx, z: 0 } })
    expect(out.rejections).toEqual([])
    expect(out.state.movementOwner).toBe('streamed')
    expect(out.state.player.position.x).toBe(edgeX + outDx)
    expect(out.state.tick).toBe(edge.tick + 1)
    expect(out.state.eventSequence).toBe(edge.eventSequence + out.events.length)
    expect(out.state.rng.simulation).toBe(nextSimulationRng(edge.rng.simulation))
    expect(out.events[0]).toMatchObject({ type: 'player_moved', tick: edge.tick + 1 })
    expect(out.state.greenway).toBe(originalGreenway)
    expect(edge.player.position.x).toBe(edgeX)
    expect(edge.movementOwner).toBe('greenway')

    const withRegionFacts: PublicWorldState = {
      ...out.state,
      player: { ...out.state.player,
        coins: 100,
        inventory: [...out.state.player.inventory, { itemId: 'mireglass_reach/item/waders', quantity: 1 }],
        equipment: { ...out.state.player.equipment, feet: 'mireglass_reach/item/waders' },
        learnedSpellIds: ['wayfinder_glow'] },
      mireglass: { ...out.state.mireglass, fringeMarkerStudied: true,
        shopStock: { ...out.state.mireglass.shopStock, 'mireglass_reach/item/waders': 1 } },
    }
    expect(isValidMireglassV6Player(withRegionFacts.player)).toBe(true)
    expect(isValidMireglassRegionProgress(withRegionFacts.mireglass, seed)).toBe(true)
    const back = advancePublicWorld(withRegionFacts, { type: 'move', delta: { x: backDx, z: 0 } })
    expect(back.rejections).toEqual([])
    expect(back.state.movementOwner).toBe('greenway')
    expect(back.state.player.position.x).toBe(edgeX)
    expect(back.state.tick).toBe(withRegionFacts.tick + 1)
    expect(back.state.eventSequence).toBe(withRegionFacts.eventSequence + back.events.length)
    expect(back.state.rng.simulation).toBe(nextSimulationRng(withRegionFacts.rng.simulation))
    expect(back.state.player.equipment.feet).toBe('mireglass_reach/item/waders')
    expect(back.state.player.inventory).toContainEqual({ itemId: 'mireglass_reach/item/waders', quantity: 1 })
    expect(back.state.mireglass).toEqual(withRegionFacts.mireglass)
    expect(back.state.greenway.tiles).toEqual(originalGreenway.tiles)
    expect(Object.hasOwn(back.state.greenway, 'player')).toBe(false)
    const unequipped = advancePublicWorld(back.state, { type: 'unequip_item', slot: 'feet' })
    expect(unequipped.rejections).toEqual([])
    expect(unequipped.events).toContainEqual(expect.objectContaining({
      type: 'item_unequipped', itemId: 'mireglass_reach/item/waders', slot: 'feet',
    }))
    expect(unequipped.state.player.equipment.feet).toBeNull()
    expect(unequipped.state.player.inventory).toContainEqual({ itemId: 'mireglass_reach/item/waders', quantity: 1 })
  })

  it('preserves an imported expanded save at x=-30 until a valid southwest exit', () => {
    const imported = importedExpandedEdge()
    expect(imported.player.position.x).toBe(-30)
    expect(imported.movementOwner).toBe('greenway')
    expect(imported.tick).toBe(37)
    expect(imported.player.coins).toBe(73)
    expect(imported.player.equipment.mainHand).toBe('field_spade')
    const look = advancePublicWorld(imported, { type: 'look', yawDelta: 0.1, pitchDelta: 0 })
    expect(look.rejections).toEqual([])
    expect(look.state.player.position.x).toBe(-30)
    expect(look.state.movementOwner).toBe('greenway')
    const out = advancePublicWorld(look.state, { type: 'move', delta: { x: -2, z: 0 } })
    expect(out.rejections).toEqual([])
    expect(out.state.player.position.x).toBe(-32)
    expect(out.state.movementOwner).toBe('streamed')
    expect(out.state.player.coins).toBe(73)
    expect(out.state.player.equipment.mainHand).toBe('field_spade')
    expect(out.state.greenway.stores[0].listings[0].stock).toBe(imported.greenway.stores[0].listings[0].stock)
    expect(out.state.tick).toBe(39)
  })

  it('rejects off-connector exits and invalid streamed destinations atomically', () => {
    const offConnector = atEdge(classic, -12, 4)
    const rejected = advancePublicWorld(offConnector, { type: 'move', delta: { x: -4, z: 0 } })
    expect(rejected.rejections).toMatchObject([{ code: 'off_connector' }])
    expect(rejected.state).toBe(offConnector)
    expect(rejected.events).toEqual([])

    const edge = atEdge(expanded, -30)
    const badYaw: PublicWorldState = { ...edge, player: { ...edge.player, yaw: 1_000_001 } }
    const invalid = advancePublicWorld(badYaw, { type: 'move', delta: { x: -2, z: 0 } })
    expect(invalid.rejections).toMatchObject([{ code: 'terrain_missing' }])
    expect(invalid.state).toBe(badYaw)
    expect(invalid.events).toEqual([])
    expect(badYaw.tick).toBe(edge.tick)
    expect(badYaw.eventSequence).toBe(edge.eventSequence)
    expect(badYaw.rng).toEqual(edge.rng)

    const out = advancePublicWorld(atEdge(classic, -12), { type: 'move', delta: { x: -4, z: 0 } })
    expect(out.rejections).toEqual([])
    const offReturn: PublicWorldState = { ...out.state, player: { ...out.state.player,
      position: { ...out.state.player.position, z: 4 } } }
    const rejectedReturn = advancePublicWorld(offReturn, { type: 'move', delta: { x: 4, z: 0 } })
    expect(rejectedReturn.rejections).toMatchObject([{ code: 'off_connector' }])
    expect(rejectedReturn.state).toBe(offReturn)
    const invalidReturn: PublicWorldState = { ...out.state, discoveredTileIds: [] }
    const rejectedValidation = advancePublicWorld(invalidReturn, { type: 'move', delta: { x: 4, z: 0 } })
    expect(rejectedValidation.rejections).toMatchObject([{ code: 'terrain_missing' }])
    expect(rejectedValidation.state).toBe(invalidReturn)
    expect(rejectedValidation.events).toEqual([])
  })

  it('advances streamed travel once per step and replays the same state deterministically', () => {
    const out = advancePublicWorld(atEdge(classic, -12), { type: 'move', delta: { x: -4, z: 0 } })
    expect(out.rejections).toEqual([])
    const intent = { type: 'move', delta: { x: -4, z: 0 } } as const
    const first = advancePublicWorld(out.state, intent)
    const replay = advancePublicWorld(out.state, intent)
    expect(first).toEqual(replay)
    expect(first.state.movementOwner).toBe('streamed')
    expect(first.state.player.position.x).toBe(-20)
    expect(first.state.tick).toBe(out.state.tick + 1)
    expect(first.state.eventSequence).toBe(out.state.eventSequence + first.events.length)
    expect(first.state.rng.simulation).toBe(nextSimulationRng(out.state.rng.simulation))
    const reverse = advancePublicWorld(first.state, { type: 'move', delta: { x: 4, z: 0 } })
    expect(reverse.rejections).toEqual([])
    expect(reverse.state.player.position.x).toBe(-16)
    expect(reverse.state.tick).toBe(first.state.tick + 1)
  })
})
