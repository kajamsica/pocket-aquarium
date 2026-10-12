import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { publicV14InsideGreenway } from './publicWorldV14Boundary'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicWorldV16TileAtGrid } from './publicWorldV16GreenwaySites'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { applyPublicV26TerrainAction } from './publicWorldV26TerrainAction'
import { emptyPublicV26TerrainLedger, fillPublicV26Column } from './publicWorldV26TerrainLedger'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { applyPublicV29DeepDig, decodePublicV29DeepDigAction } from './publicWorldV29DeepDigAction'
import type { PublicV29Progress } from './publicWorldV29Migration'
import { worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const action = (gx: number, gz: number) => ({ kind: 'deep-dig' as const, gx, gz })
const id = (gx: number, gz: number) => `tile-${gx + 3}-${gz + 3}`

function at(gx = 1, gz = 0, depth = 2, excavationLevel = 2,
  activePick: null | 'basic' | 'enchanted' = 'basic'): PublicV29Progress {
  const { head } = createPublicV23Root(seed)
  const x = gx * 4, z = gz * 4, owner = publicV14InsideGreenway({ x, z })
  const support = owner ? publicV17StarterSupportAt({ seed,
    profile: head.state.generationProfile, route: head.state.greenway.routes[0] ?? null,
    built: false, greenwayWorks: head.greenwayWorks }, { x, z })
    : resolvePublicV23Surface(head.state, { x, z }, head.regionalWorks.builtLadderIds)
  if (!support) throw new Error('Missing ground')
  const xp = (excavationLevel - 1) * 30
  const state = { ...head.state, movementOwner: owner ? 'greenway' as const : 'streamed' as const,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(head.state.discoveryMask), id(gx, gz)])].sort()),
    player: { ...head.state.player, xp, level: 1 + Math.floor(xp / 100),
      skillXp: { ...head.state.player.skillXp, excavation: xp },
      position: { x, y: support.floorY, z } } }
  const old = decodePublicV23Progress({ state, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks }, seed)
  if (!old) throw new Error('Invalid old progress fixture')
  return { ...old, terrain: depth ? { ...emptyPublicV26TerrainLedger(), columns: [
    { gx, gz, openDepth: depth, rewardDepth: depth, pitLadder: false }] }
    : emptyPublicV26TerrainLedger(), nextHomeAtMs: 0, riverBridgeIds: [],
  miningTools: { basicPickOwned: true, enchantedPickOwned: activePick === 'enchanted', activePick } }
}

describe('V29 checked deeper digging', () => {
  it('passes the marked V16 dry-bank surface gate for Mine while preserving the remaining checks', () => {
    const gx = -2, gz = 4
    expect(worldTileAtGrid(seed, gx, gz).terrain).toBe('wetland')
    expect(publicWorldV16TileAtGrid(seed, gx, gz).terrain).toBe('loam')
    const ready = at(gx, gz, 2, 2, null)
    expect(applyPublicV29DeepDig(ready, action(gx, gz)))
      .toEqual({ rejection: 'requires_pick' })
    const result = applyPublicV29DeepDig(at(gx, gz, 2, 2, 'basic'), action(gx, gz))
    expect(result.rejection).not.toBe('wet')
  })

  it('accepts only an exact canonical clicked cell', () => {
    expect(decodePublicV29DeepDigAction(action(1, 0))).toEqual(action(1, 0))
    for (const forged of [{ ...action(1, 0), eligible: true }, action(256, 0),
      { kind: 'deep-dig', gx: 1.1, gz: 0 }, { kind: 'dig', gx: 1, gz: 0 },
      Object.create(action(1, 0))]) expect(decodePublicV29DeepDigAction(forged)).toBeNull()
  })

  it('reuses spade-dug layers, awards the canonical stone once, and preserves anti-farm depth', () => {
    const initial = at(1, 0, 0, 1, null)
    const player = { ...initial.state.player, inventory: [...initial.state.player.inventory,
      { itemId: 'field_spade' as const, quantity: 1 }],
    equipment: { ...initial.state.player.equipment, mainHand: 'field_spade' as const } }
    let old: PublicV29Progress = { ...initial, state: { ...initial.state, player } }
    for (let step = 0; step < 2; step++) {
      const result = applyPublicV26TerrainAction({ state: old.state,
        greenwayWorks: old.greenwayWorks, regionalWorks: old.regionalWorks,
        terrain: old.terrain, nextHomeAtMs: old.nextHomeAtMs }, { kind: 'dig', gx: 1, gz: 0 })
      if (!result.progress) throw new Error(result.rejection)
      old = { ...old, ...result.progress }
    }
    const ready = { ...old, miningTools: { basicPickOwned: true,
      enchantedPickOwned: false, activePick: 'basic' as const }, state: { ...old.state,
      player: { ...old.state.player, equipment: { ...old.state.player.equipment, mainHand: null } } } }
    const before = structuredClone(ready)
    const result = applyPublicV29DeepDig(ready, action(1, 0))
    if (!result.progress) throw new Error(result.rejection)
    expect(result.progress.terrain.columns[0]).toMatchObject({ openDepth: 3, rewardDepth: 3 })
    expect(result.progress.terrain.bag).toMatchObject({ soil: 2, stone: 1 })
    expect(result.progress.state.player.skillXp.excavation).toBe(90)
    expect(result.progress.state.eventSequence).toBe(ready.state.eventSequence + 1)
    expect(ready).toEqual(before)
    const filled = fillPublicV26Column(result.progress.terrain, { gx: 1, gz: 0, eligible: true })
    if (!filled.ok) throw new Error(filled.reason)
    const redig = applyPublicV29DeepDig({ ...result.progress, terrain: filled.ledger }, action(1, 0))
    if (!redig.progress) throw new Error(redig.rejection)
    expect(redig.progress.terrain.bag.stone).toBe(1)
    expect(redig.progress.terrain.columns[0]).toMatchObject({ openDepth: 3, rewardDepth: 3 })
    expect(redig.progress.state.player.xp).toBe(result.progress.state.player.xp)
    expect(redig.progress.state.eventSequence).toBe(result.progress.state.eventSequence)
  })

  it('rejects missing tools, skill, capacity, bedrock, wet and undiscovered targets', () => {
    const ready = at()
    expect(applyPublicV29DeepDig({ ...ready, miningTools: { ...ready.miningTools,
      activePick: null } }, action(1, 0))).toEqual({ rejection: 'requires_pick' })
    expect(applyPublicV29DeepDig(at(1, 0, 2, 1), action(1, 0)))
      .toEqual({ rejection: 'skill_locked' })
    const carried = ready.state.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)
    expect(applyPublicV29DeepDig({ ...ready, state: { ...ready.state,
      player: { ...ready.state.player, backpackCapacity: carried } } }, action(1, 0)))
      .toEqual({ rejection: 'capacity' })
    expect(applyPublicV29DeepDig(at(1, 0, 12, 25, 'enchanted'), action(1, 0)))
      .toEqual({ rejection: 'bedrock' })
    expect(applyPublicV29DeepDig(ready, action(10, 10))).toEqual({ rejection: 'unrevealed' })
    expect(applyPublicV29DeepDig({ ...ready, state: { ...ready.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(ready.state.discoveryMask), id(1, 2)])].sort()) } }, action(1, 2)))
      .toEqual({ rejection: 'wet' })
  })

  it('derives iron, gold and diamond from seeded strata and enforces their tiers', () => {
    for (const [gx, gz, depth, level, material] of [
      [-2, 1, 3, 5, 'iron_ore'], [-2, -6, 5, 12, 'gold_ore'],
      [10, -3, 8, 25, 'diamond'],
    ] as const) {
      const basic = at(gx, gz, depth, level)
      if (material === 'diamond') expect(applyPublicV29DeepDig(basic, action(gx, gz)))
        .toEqual({ rejection: 'requires_enchanted_pick' })
      const result = applyPublicV29DeepDig(at(gx, gz, depth, level,
        material === 'diamond' ? 'enchanted' : 'basic'), action(gx, gz))
      if (!result.progress) throw new Error(`${material}: ${result.rejection}`)
      expect(result.progress.terrain.bag[material]).toBe(1)
      expect(result.progress.terrain.columns[0]).toMatchObject({ openDepth: depth + 1,
        rewardDepth: depth + 1 })
    }
  })

  it('keeps pit ladders, saved bridge banks and the home cell clear', () => {
    const pit = at(), ladder = { ...pit, terrain: { ...pit.terrain,
      columns: pit.terrain.columns.map((column) => ({ ...column, pitLadder: true })) } }
    expect(applyPublicV29DeepDig(ladder, action(1, 0))).toEqual({ rejection: 'occupied' })
    const bridge = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-14')
    if (!bridge) throw new Error('Missing canonical bridge')
    const bank = at(-14, bridge.from.z / 4, 0, 2)
    const saved = { ...bank, riverBridgeIds: [bridge.id], state: { ...bank.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(bank.state.discoveryMask), ...bridge.footprintTileIds])].sort()) } }
    expect(applyPublicV29DeepDig(saved, action(-14, bridge.from.z / 4)))
      .toEqual({ rejection: 'occupied' })
    expect(applyPublicV29DeepDig(at(1, 0), action(0, 0)))
      .toEqual({ rejection: 'occupied' })
  })
})
