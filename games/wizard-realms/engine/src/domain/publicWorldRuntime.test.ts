import { describe, expect, it } from 'vitest'
import { createGeneratedWorld, terrainHeightAt } from './generation'
import { isValidMireglassRegionProgress, isValidMireglassV6Player } from './mireglassExpedition'
import { serializeWizardWorld } from './persistence'
import { commitLegacyImportToPublicV6, inspectLegacyImportSource } from './publicWorldV6'
import { advancePublicWorld } from './publicWorldRuntime'
import { createFreshPublicWorld, createPublicWorldFromBootstrap } from './publicWorldState'
import type { PublicWorldState } from './publicWorldState'
import type { GenerationProfile } from './types'

const seed = 'greenway-alpha'
const classic = 'greenway-classic-v1'
const expanded = 'greenway-expanded-v1'
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

describe('public v6 authority handoff', () => {
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
