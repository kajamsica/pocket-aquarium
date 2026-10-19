import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { publicWorldV16TileAtGrid } from './publicWorldV16GreenwaySites'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV25StratumAt } from './publicWorldV25Strata'
import type { PublicV26Progress } from './publicWorldV26Migration'
import { applyPublicV26TerrainAction, decodePublicV26TerrainAction } from './publicWorldV26TerrainAction'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const id = (gx: number, gz: number) => `tile-${gx + 3}-${gz + 3}`
const action = (kind: 'dig' | 'fill', gx: number, gz: number) => ({ kind, gx, gz })
const expectRejected = (result: ReturnType<typeof applyPublicV26TerrainAction>, reason: string) =>
  expect(result).toEqual({ rejection: reason })

function at(gx: number, gz: number, equipped = true): PublicV26Progress {
  const { head } = createPublicV23Root(seed)
  const base = { state: head.state, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks }
  const x = gx * 4, z = gz * 4
  const support = publicV17StarterSupportAt({ seed, profile: base.state.generationProfile,
    route: base.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: base.greenwayWorks }, { x, z })
  if (!support || support.kind !== 'ground') throw new Error('Fixture needs ordinary Greenway ground')
  const player = structuredClone(base.state.player)
  player.position = { x, y: support.floorY, z }
  if (!player.inventory.some((stack) => stack.itemId === 'field_spade')) {
    player.inventory.push({ itemId: 'field_spade', quantity: 1 })
  }
  player.equipment.mainHand = equipped ? 'field_spade' : null
  const discoveryMask = encodeDiscoveredTileIds([...new Set([
    ...decodeDiscoveredTileIds(base.state.discoveryMask), id(gx, gz)])].sort())
  const old = decodePublicV23Progress({ ...base, state: { ...base.state, player, discoveryMask } }, seed)
  if (!old) throw new Error('Fixture must be valid old progress')
  return { ...old, terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0 }
}

function target(): { gx: number; gz: number; progress: PublicV26Progress } {
  for (let gz = -5; gz <= 1; gz += 1) for (let gx = -6; gx <= 6; gx += 1) {
    if (gx === 0 && gz === 0 || publicV25RiverCellAtGrid(seed, gx, gz)
      || worldTileAtGrid(seed, gx, gz).terrain !== 'loam'
      || publicV25StratumAt(seed, gx, gz, 0).material !== 'soil') continue
    try {
      const progress = at(gx, gz)
      if ('progress' in applyPublicV26TerrainAction(progress, action('dig', gx, gz))) {
        return { gx, gz, progress }
      }
    } catch { /* This cell has no valid starting support. */ }
  }
  throw new Error('No ordinary reachable soil fixture')
}

describe('V26 clicked terrain action', () => {
  it('uses the authored dry Greenway bank, not the raw wet tile, without drying streamed land', () => {
    for (const [gx, gz] of [[0, 4], [-2, 4]] as const) {
      expect(worldTileAtGrid(seed, gx, gz).terrain).toBe('wetland')
      expect(publicWorldV16TileAtGrid(seed, gx, gz).terrain).toBe('loam')
      expect(publicV26TerrainCellIsWet(seed, gx, gz, 'greenway')).toBe(false)
      expect(publicV26TerrainCellIsWet(seed, gx, gz, 'streamed')).toBe(true)
    }
    expect(publicV26TerrainCellIsWet(seed, 1, 0, 'greenway')).toBe(false)
    expect(publicV26TerrainCellIsWet(seed, 1, 0, 'streamed')).toBe(false)
    expect(publicV25RiverCellAtGrid(seed, 0, 2)).toBe(true)
    expect(publicV26TerrainCellIsWet(seed, 0, 2, 'greenway')).toBe(true)
  })

  it('digs and fills a revealed reachable V16 bank cell that raw terrain calls wet', () => {
    let exercised = false
    for (const gz of [3, 4]) for (let gx = -2; gx <= 2; gx += 1) {
      if (publicV25RiverCellAtGrid(seed, gx, gz)
        || worldTileAtGrid(seed, gx, gz).terrain !== 'wetland') continue
      let progress: PublicV26Progress
      try { progress = at(gx, gz) } catch { continue }
      const dug = applyPublicV26TerrainAction(progress, action('dig', gx, gz)).progress
      if (!dug) continue
      const filled = applyPublicV26TerrainAction(dug, action('fill', gx, gz)).progress
      expect(filled?.terrain.columns.find((column) => column.gx === gx && column.gz === gz))
        .toMatchObject({ openDepth: 0 })
      exercised = true
    }
    expect(exercised).toBe(true)
  })

  it('decodes exact canonical input only', () => {
    expect(decodePublicV26TerrainAction(action('dig', 2, -1))).toEqual(action('dig', 2, -1))
    expect(decodePublicV26TerrainAction({ ...action('dig', 2, -1), eligible: true })).toBeNull()
    expect(decodePublicV26TerrainAction(action('dig', 256, 0))).toBeNull()
    expect(decodePublicV26TerrainAction({ kind: 'mine', gx: 2, gz: -1 })).toBeNull()
    expect(decodePublicV26TerrainAction(Object.create(action('dig', 2, -1)))).toBeNull()
  })

  it('derives a soil reward from location and awards one XP event without mutating input', () => {
    const { gx, gz, progress } = target(), before = structuredClone(progress)
    const result = applyPublicV26TerrainAction(progress, action('dig', gx, gz))
    if (!result.progress) throw new Error(result.rejection)
    expect(result.progress.terrain.bag.soil).toBe(1)
    expect(result.progress.terrain.columns).toEqual([{ gx, gz, openDepth: 1,
      rewardDepth: 1, pitLadder: false }])
    expect(result.progress.state.player.xp).toBe(progress.state.player.xp + 30)
    expect(result.progress.state.player.skillXp.excavation)
      .toBe(progress.state.player.skillXp.excavation + 30)
    expect(result.progress.state.eventSequence).toBe(progress.state.eventSequence + 1)
    expect(progress).toEqual(before)
    expect(applyPublicV26TerrainAction(progress, action('dig', gx, gz))).toEqual(result)
  })

  it('rejects missing tool, wet/home/unrevealed/far targets and exhausted capacity', () => {
    const { gx, gz, progress } = target()
    const unarmed = { ...progress, state: { ...progress.state,
      player: { ...progress.state.player, equipment: { ...progress.state.player.equipment,
        mainHand: null } } } }
    expectRejected(applyPublicV26TerrainAction(unarmed, action('dig', gx, gz)), 'requires_tool')
    const hidden = { ...progress, state: { ...progress.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(progress.state.discoveryMask)
        .filter((tile) => tile !== id(gx, gz))) } }
    expectRejected(applyPublicV26TerrainAction(hidden, action('dig', gx, gz)), 'unrevealed')
    expectRejected(applyPublicV26TerrainAction(progress, action('dig', 0, 0)), 'occupied')
    const wetGz = 2
    const wet = { ...progress, state: { ...progress.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(progress.state.discoveryMask), id(gx, wetGz)])].sort()) } }
    expectRejected(applyPublicV26TerrainAction(wet, action('dig', gx, wetGz)), 'wet')
    const farGx = gx + (gx <= 0 ? 5 : -5)
    const far = { ...progress, state: { ...progress.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(progress.state.discoveryMask), id(farGx, gz)])].sort()) } }
    expectRejected(applyPublicV26TerrainAction(far, action('dig', farGx, gz)), 'too_far')
    const carried = progress.state.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)
      + progress.state.player.tradeSlots.reduce((sum, slot) => sum + slot.quantity, 0)
    const full = { ...progress, state: { ...progress.state, player: { ...progress.state.player,
      backpackCapacity: carried } } }
    expectRejected(applyPublicV26TerrainAction(full, action('dig', gx, gz)), 'capacity')
    const bagFull = { ...progress, terrain: { ...progress.terrain,
      bag: { ...progress.terrain.bag, soil: 1 } }, state: { ...progress.state,
      player: { ...progress.state.player, backpackCapacity: carried + 1 } } }
    expectRejected(applyPublicV26TerrainAction(bagFull, action('dig', gx, gz)), 'capacity')
    const store = { gx: -1, gz: 0 }
    const byStore = { ...progress, state: { ...progress.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(progress.state.discoveryMask), id(store.gx, store.gz)])].sort()) } }
    expectRejected(applyPublicV26TerrainAction(byStore, action('dig', store.gx, store.gz)), 'occupied')
  })

  it('uses geology and tier gates at the clicked location', () => {
    let found = false
    for (let gz = -5; gz <= 1 && !found; gz += 1) for (let gx = -6; gx <= 6 && !found; gx += 1) {
      if (publicV25RiverCellAtGrid(seed, gx, gz)
        || worldTileAtGrid(seed, gx, gz).terrain === 'wetland'
        || publicV25StratumAt(seed, gx, gz, 0).material !== 'stone') continue
      try {
        const progress = at(gx, gz)
        const result = applyPublicV26TerrainAction(progress, action('dig', gx, gz))
        if (result.rejection !== 'requires_tool') continue
        expect(progress.terrain.bag.stone).toBe(0)
        found = true
      } catch { /* Not valid ordinary ground. */ }
    }
    expect(found).toBe(true)
  })

  it('fills from bag soil and reopens without another material or XP', () => {
    const { gx, gz, progress } = target()
    const dig = applyPublicV26TerrainAction(progress, action('dig', gx, gz)).progress
    if (!dig) throw new Error('Expected dig')
    const unarmed = { ...dig, state: { ...dig.state, player: { ...dig.state.player,
      equipment: { ...dig.state.player.equipment, mainHand: null } } } }
    const before = structuredClone(unarmed)
    expectRejected(applyPublicV26TerrainAction(unarmed, action('fill', gx, gz)), 'requires_tool')
    expect(unarmed).toEqual(before)
    const notOwned = { ...unarmed, state: { ...unarmed.state, player: { ...unarmed.state.player,
      inventory: unarmed.state.player.inventory.filter((stack) => stack.itemId !== 'field_spade') } } }
    expectRejected(applyPublicV26TerrainAction(notOwned, action('fill', gx, gz)), 'requires_tool')
    const filled = applyPublicV26TerrainAction(dig, action('fill', gx, gz)).progress
    if (!filled) throw new Error('Expected fill')
    expect(filled.terrain.bag.soil).toBe(0)
    expect(filled.terrain.columns[0]).toMatchObject({ openDepth: 0, rewardDepth: 1 })
    const reopened = applyPublicV26TerrainAction(filled, action('dig', gx, gz)).progress
    if (!reopened) throw new Error('Expected re-dig')
    expect(reopened.terrain.bag.soil).toBe(0)
    expect(reopened.terrain.columns[0]).toMatchObject({ openDepth: 1, rewardDepth: 1 })
    expect(reopened.state.player.xp).toBe(dig.state.player.xp)
    expect(reopened.state.eventSequence).toBe(dig.state.eventSequence)
  })
})
