import { describe, expect, it } from 'vitest'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import type { PublicV29Progress } from './publicWorldV29Migration'
import { applyPublicV29MiningToolAction, decodePublicV29MiningToolAction,
  decodePublicV29MiningTools, decodePublicV29MiningToolWitness,
  emptyPublicV29MiningTools } from './publicWorldV29MiningTools'

function fixture(): PublicV29Progress {
  const { head } = createPublicV23Root('wizard-realms')
  const store = head.state.greenway.stores[0]
  const support = publicV17StarterSupportAt({ seed: head.state.seed,
    profile: head.state.generationProfile,
    route: head.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: head.greenwayWorks }, store.position)
  if (!support) throw new Error('Missing Outfitters support')
  return { state: { ...head.state, player: { ...head.state.player,
    position: { ...store.position, y: support.floorY } } },
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
  terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0, riverBridgeIds: [],
  miningTools: emptyPublicV29MiningTools() }
}

const act = (progress: PublicV29Progress, kind: 'buy' | 'equip', tier: 'basic' | 'enchanted') =>
  applyPublicV29MiningToolAction(progress, { kind, tier })

describe('V29 virtual mining tools', () => {
  it('strictly decodes the canonical sidecar and exact witnesses', () => {
    expect(decodePublicV29MiningTools(emptyPublicV29MiningTools()))
      .toEqual({ basicPickOwned: false, enchantedPickOwned: false, activePick: null })
    expect(decodePublicV29MiningTools({ basicPickOwned: false,
      enchantedPickOwned: false, activePick: 'basic' })).toBeNull()
    expect(decodePublicV29MiningTools({ ...emptyPublicV29MiningTools(), coins: 99 })).toBeNull()
    expect(decodePublicV29MiningToolAction({ kind: 'buy', tier: 'basic' }))
      .toEqual({ kind: 'buy', tier: 'basic' })
    expect(decodePublicV29MiningToolAction({ kind: 'buy', tier: 'basic', price: 0 })).toBeNull()
    expect(decodePublicV29MiningToolWitness({ kind: 'mining-tool/v1',
      action: { kind: 'equip', tier: 'enchanted' } }))
      .toEqual({ kind: 'mining-tool/v1', action: { kind: 'equip', tier: 'enchanted' } })
    expect(decodePublicV29MiningToolWitness({ kind: 'mining-tool/v1',
      action: { kind: 'equip', tier: 'enchanted' }, owned: true })).toBeNull()
  })

  it('buys the one canonical basic pick for 35 coins, then equips it without old inventory entries', () => {
    const before = fixture(), copy = structuredClone(before)
    const bought = act(before, 'buy', 'basic').progress
    if (!bought) throw new Error('Basic purchase rejected')
    expect(bought.state.player.coins).toBe(before.state.player.coins - 35)
    expect(bought.miningTools).toEqual({ basicPickOwned: true,
      enchantedPickOwned: false, activePick: null })
    expect(bought.state.player.inventory).toEqual(before.state.player.inventory)
    expect(bought.state.greenway.stores).toEqual(before.state.greenway.stores)
    expect(act(bought, 'buy', 'basic')).toEqual({ rejection: 'already_owned' })
    const withSpade = { ...bought, state: { ...bought.state,
      player: { ...bought.state.player, inventory: [...bought.state.player.inventory,
        { itemId: 'field_spade' as const, quantity: 1 }],
      equipment: { ...bought.state.player.equipment, mainHand: 'field_spade' as const } } } }
    const equipped = act(withSpade, 'equip', 'basic').progress
    if (!equipped) throw new Error('Basic equip rejected')
    expect(equipped.miningTools.activePick).toBe('basic')
    expect(equipped.state.player.equipment.mainHand).toBeNull()
    expect(equipped.state.player.inventory).toContainEqual({ itemId: 'field_spade', quantity: 1 })
    expect(act(equipped, 'equip', 'basic')).toEqual({ rejection: 'already_equipped' })
    expect(before).toEqual(copy)
  })

  it('requires Greenway proximity, ownership, and the enchanted level and price', () => {
    const near = fixture()
    expect(act(near, 'equip', 'basic')).toEqual({ rejection: 'not_owned' })
    expect(act(near, 'buy', 'enchanted')).toEqual({ rejection: 'skill_locked' })
    const home = createPublicV23Root('wizard-realms').head.state.player.position
    const far = { ...near, state: { ...near.state, player: { ...near.state.player,
      position: home } } }
    expect(act(far, 'buy', 'basic')).toEqual({ rejection: 'too_far' })
    const skilled = { ...near, state: { ...near.state,
      player: { ...near.state.player, xp: 720, level: 8,
        skillXp: { ...near.state.player.skillXp, excavation: 720 } } } }
    expect(act(skilled, 'buy', 'enchanted')).toEqual({ rejection: 'insufficient_coins' })
    const funded = { ...skilled, state: { ...skilled.state,
      player: { ...skilled.state.player, coins: 240 } } }
    const bought = act(funded, 'buy', 'enchanted').progress
    if (!bought) throw new Error('Enchanted purchase rejected')
    expect(bought.state.player.coins).toBe(0)
    expect(bought.miningTools.enchantedPickOwned).toBe(true)
    expect(act(bought, 'equip', 'enchanted').progress?.miningTools.activePick).toBe('enchanted')
  })

  it('rejects impossible sidecar/equipment combinations and client authority fields', () => {
    const before = fixture()
    expect(applyPublicV29MiningToolAction(before,
      { kind: 'buy', tier: 'basic', price: 0 })).toEqual({ rejection: 'invalid_action' })
    const impossible = { ...before, miningTools: { basicPickOwned: true,
      enchantedPickOwned: false, activePick: 'basic' as const }, state: { ...before.state,
      player: { ...before.state.player,
        equipment: { ...before.state.player.equipment, mainHand: 'woodcutters_axe' as const } } } }
    expect(act(impossible, 'buy', 'enchanted')).toEqual({ rejection: 'invalid_progress' })
  })
})
