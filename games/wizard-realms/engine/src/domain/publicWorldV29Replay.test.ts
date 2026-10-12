import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import { createPublicV26Root } from './publicWorldV26Snapshot'
import { createPublicV27Root } from './publicWorldV27Snapshot'
import { createPublicV28Root } from './publicWorldV28Snapshot'
import type { PublicV29Progress } from './publicWorldV29Migration'
import { createPublicV29Root, decodePublicV29CheckedSuccessor,
  decodePublicV29Root, decodePublicV29Witness, replayPublicV29Witness } from './publicWorldV29Snapshot'
import type { PublicV29Root, PublicV29Witness } from './publicWorldV29Snapshot'

function genesis() {
  const v23 = createPublicV23Root('wizard-realms')
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  return createPublicV29Root({ head: v28.head, lineage: v28.lineage })
}

function successor(before: PublicV29Root, witness: PublicV29Witness): PublicV29Root {
  const progress = replayPublicV29Witness(before.head, witness)
  if (!progress) throw new Error(`Rejected ${witness.kind}`)
  const candidate = { lineage: before.lineage, previous: before.head,
    head: { ...before.head, ...progress, saveRevision: before.head.saveRevision + 1, witness } }
  const checked = decodePublicV29CheckedSuccessor(before, candidate)
  if (!checked) throw new Error(`Unchecked ${witness.kind}`)
  expect(decodePublicV29Root(candidate)).toEqual(checked)
  return checked
}

function minedCell(): PublicV29Progress {
  const { head } = createPublicV23Root('wizard-realms')
  const x = 4, z = 0
  const support = publicV17StarterSupportAt({ seed: head.state.seed,
    profile: head.state.generationProfile, route: head.state.greenway.routes[0] ?? null,
    built: false, greenwayWorks: head.greenwayWorks }, { x, z })
  if (!support) throw new Error('Missing mining support')
  const old = decodePublicV23Progress({ greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks, state: { ...head.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(head.state.discoveryMask), 'tile-4-3'])].sort()),
      player: { ...head.state.player, xp: 60, level: 1,
        skillXp: { ...head.state.player.skillXp, excavation: 60 },
        position: { x, y: support.floorY, z } } } }, head.state.seed)
  if (!old) throw new Error('Invalid mining fixture')
  return { ...old, terrain: { ...emptyPublicV26TerrainLedger(), columns: [
    { gx: 1, gz: 0, openDepth: 2, rewardDepth: 2, pitLadder: false }],
    bag: { soil: 2, stone: 0, iron_ore: 0, gold_ore: 0, diamond: 0 } },
  nextHomeAtMs: 0, riverBridgeIds: [], miningTools: { basicPickOwned: true,
    enchantedPickOwned: false, activePick: 'basic' } }
}

describe('V29 exact mining witness replay', () => {
  it('rejects client price, reward, extra keys, and malformed deep-dig or sale payloads', () => {
    const good = [
      { kind: 'mining-tool/v1', action: { kind: 'buy', tier: 'basic' } },
      { kind: 'deep-dig', gx: 1, gz: 0 },
      { kind: 'sell-mineral/v1', material: 'stone', quantity: 1 },
    ]
    good.forEach((witness) => expect(decodePublicV29Witness(witness)).toEqual(witness))
    for (const forged of [
      { ...good[0], price: 0 },
      { ...good[0], action: { kind: 'buy', tier: 'basic', coins: 999 } },
      { ...good[1], reward: 'diamond' },
      { ...good[1], gx: 1.5 },
      { ...good[2], unitPrice: 999 },
      { ...good[2], quantity: 0 },
    ]) expect(decodePublicV29Witness(forged)).toBeNull()
  })

  it('replays a real walk to Outfitters, unique purchase, equip, and legacy hand swap through checked roots', () => {
    let root = genesis()
    const home = root.head.state.player.position
    const store = root.head.state.greenway.stores.find((entry) => entry.id === 'store-greenway')
    if (!store) throw new Error('Missing Outfitters')
    const steps = 40
    const frame = { kind: 'frame-batch/v1' as const, frames: Array.from({ length: steps }, () => ({
      intents: [{ type: 'move' as const, delta: {
        x: (store.position.x - home.x) / steps,
        z: (store.position.z - home.z) / steps } }], walkRequested: false })) }
    root = successor(root, frame)
    expect(Math.hypot(root.head.state.player.position.x - store.position.x,
      root.head.state.player.position.y - store.position.y,
      root.head.state.player.position.z - store.position.z)).toBeLessThanOrEqual(3)
    const bought = successor(root, { kind: 'mining-tool/v1', action: { kind: 'buy', tier: 'basic' } })
    expect(bought.head.miningTools).toEqual({ basicPickOwned: true,
      enchantedPickOwned: false, activePick: null })
    expect(bought.head.state.player.coins).toBe(root.head.state.player.coins - 35)
    expect(replayPublicV29Witness(bought.head,
      { kind: 'mining-tool/v1', action: { kind: 'buy', tier: 'basic' } })).toBeNull()
    root = successor(bought, { kind: 'mining-tool/v1', action: { kind: 'equip', tier: 'basic' } })
    expect(root.head.miningTools.activePick).toBe('basic')
    expect(root.head.state.player.equipment.mainHand).toBeNull()
    const swapped = successor(root, { kind: 'legacy-action', intent: {
      type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' } })
    expect(swapped.head.state.player.equipment.mainHand).toBe('woodcutters_axe')
    expect(swapped.head.miningTools.activePick).toBeNull()
    expect(decodePublicV29Root({ ...swapped, head: { ...swapped.head,
      miningTools: { ...swapped.head.miningTools, activePick: 'basic' } } })).toBeNull()
  }, 60_000)

  it('derives one stone from saved geology, then sells only the owned bag quantity at Outfitters', () => {
    const before = minedCell(), copy = structuredClone(before)
    const dug = replayPublicV29Witness(before, { kind: 'deep-dig', gx: 1, gz: 0 })
    if (!dug) throw new Error('Rejected canonical deeper dig')
    expect(dug.terrain.columns[0]).toMatchObject({ openDepth: 3, rewardDepth: 3 })
    expect(dug.terrain.bag.stone).toBe(1)
    expect(replayPublicV29Witness(before,
      { kind: 'deep-dig', gx: 1, gz: 0, material: 'diamond' })).toBeNull()
    const store = dug.state.greenway.stores.find((entry) => entry.id === 'store-greenway')
    if (!store) throw new Error('Missing Outfitters')
    const floor = publicV17StarterSupportAt({ seed: dug.state.seed,
      profile: dug.state.generationProfile, route: dug.state.greenway.routes[0] ?? null,
      built: false, greenwayWorks: dug.greenwayWorks }, store.position)
    if (!floor) throw new Error('Missing store support')
    const atStore: PublicV29Progress = { ...dug, state: { ...dug.state,
      player: { ...dug.state.player,
        position: { ...store.position, y: floor.floorY } } } }
    const sold = replayPublicV29Witness(atStore,
      { kind: 'sell-mineral/v1', material: 'stone', quantity: 1 })
    if (!sold) throw new Error('Rejected canonical mineral sale')
    expect(sold.terrain.bag.stone).toBe(0)
    expect(sold.state.player.coins).toBe(atStore.state.player.coins + 3)
    expect(replayPublicV29Witness(sold,
      { kind: 'sell-mineral/v1', material: 'stone', quantity: 1 })).toBeNull()
    expect(replayPublicV29Witness(dug,
      { kind: 'sell-mineral/v1', material: 'stone', quantity: 1 })).toBeNull()
    expect(before).toEqual(copy)
  })
})
