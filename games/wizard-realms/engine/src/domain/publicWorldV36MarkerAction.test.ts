import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { emptyPublicV29MiningTools } from './publicWorldV29MiningTools'
import { confirmPublicV36MarkerAction as confirm,
  decodePublicV36MarkerWitness as decode, previewPublicV36MarkerAction as preview } from './publicWorldV36MarkerAction'
import type { PublicV36MarkerProgress } from './publicWorldV36MarkerAction'

const seed = 'wizard-realms', bridgeId = 'works6:river-bridge:-14'
const ladderId = 'works4:ladder:greenway-north-cliff:11'
const creekId = 'works4:bridge:greenway-creek:0'
const witness = { kind: 'marker-claim/v1' as const }

function ready(): PublicV36MarkerProgress {
  const { head } = createPublicV23Root(seed)
  const bridge = resolvePublicV28RiverBridge(seed, bridgeId)!
  const salvager = mireglassAnchors(seed).salvager.tile.center
  const floor = resolvePublicV23Surface(head.state, salvager, [])?.floorY
  if (!bridge || floor === undefined) throw new Error('Missing canonical sites')
  const state = { ...head.state, movementOwner: 'streamed' as const,
    mireglass: { ...head.state.mireglass, fringeMarkerStudied: true,
      cacheRevealed: true, cacheExcavated: true },
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(head.state.discoveryMask), ...bridge.footprintTileIds,
      mireglassAnchors(seed).sealCache.tile.id, mireglassAnchors(seed).fringeMarker.tile.id,
      mireglassAnchors(seed).salvager.tile.id])].sort()),
    player: { ...head.state.player, position: { ...salvager, y: floor },
      xp: 250, level: 3, skillXp: { ...head.state.player.skillXp,
        construction: 140, excavation: 70, spellcraft: 10, wayfinding: 10 },
      learnedSpellIds: ['wayfinder_glow' as const] } }
  return { state, greenwayWorks: { ...head.greenwayWorks, builtBridgeIds: [creekId],
    builtLadderIds: [ladderId] }, regionalWorks: head.regionalWorks,
    terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0,
    riverBridgeIds: [bridgeId], miningTools: emptyPublicV29MiningTools(),
    claimedBridgeheadId: creekId, raisedSoilCells: [],
    ledgerSurveyBridgeId: bridgeId, ledgerClaimReward: 'coins', markerClaimReward: null }
}

describe('V36 checked Beneath the Old Marker claim', () => {
  it('accepts only exact cloneable witness and does not mutate a rejection', () => {
    const before = ready(), saved = structuredClone(before)
    expect(decode(witness)).toEqual(witness)
    for (const bad of [{ kind: 'marker-claim/v1', reward: 'coins' },
      { kind: 'marker-claim/v1', position: { x: 0, y: 0, z: 0 } },
      new Proxy(witness, {}),
      Object.create({ kind: 'marker-claim/v1' }),
      Object.defineProperty({}, 'kind', { get: () => 'marker-claim/v1', enumerable: true })]) {
      expect(decode(bad)).toBeNull()
      expect(confirm(before, bad)).toEqual({ rejection: 'invalid_value' })
    }
    expect(before).toEqual(saved)
  })

  it('requires the prior quest, marker, reveal, excavation, streamed grounded reach', () => {
    const before = ready(), withState = (patch: object) => ({ ...before,
      state: { ...before.state, ...patch } })
    expect(confirm({ ...before, ledgerClaimReward: null }, witness).rejection).toBe('requires_ledger')
    expect(confirm(withState({ mireglass: { ...before.state.mireglass,
      fringeMarkerStudied: false } }), witness).rejection).toBe('marker_unstudied')
    expect(confirm(withState({ mireglass: { ...before.state.mireglass,
      cacheRevealed: false, cacheExcavated: false } }), witness).rejection).toBe('cache_hidden')
    expect(confirm(withState({ mireglass: { ...before.state.mireglass,
      cacheExcavated: false } }), witness).rejection).toBe('cache_not_excavated')
    const store = before.state.greenway.stores[0].position
    const storeFloor = resolvePublicV23Surface(before.state, store, [])?.floorY
    if (storeFloor === undefined) throw new Error('Missing Greenway floor')
    expect(confirm(withState({ movementOwner: 'greenway', player: { ...before.state.player,
      position: { ...store, y: storeFloor } } }), witness).rejection).toBe('unavailable_here')
    expect(confirm(withState({ player: { ...before.state.player,
      verticalVelocity: 1 } }), witness).rejection).toBe('invalid_progress')
    const marker = mireglassAnchors(seed).fringeMarker.tile.center
    const markerFloor = resolvePublicV23Surface(before.state, marker, [])?.floorY
    if (markerFloor === undefined) throw new Error('Missing marker floor')
    expect(confirm(withState({ player: { ...before.state.player,
      position: { ...marker, y: markerFloor } } }), witness).rejection).toBe('too_far')
  })

  it('pays waders once after the seal was sold, without changing equipped boots', () => {
    const before = ready()
    expect(before.state.player.inventory.some((row) => row.itemId === 'mireglass_reach/item/seal'))
      .toBe(false)
    const oldEquipment = structuredClone(before.state.player.equipment)
    expect(preview(before, witness)).toEqual({ rejection: null, reward: 'fen_waders' })
    const result = confirm(before, witness)
    if (!result.progress) throw new Error(result.rejection)
    const next = result.progress, player = next.state.player
    expect(result.reward).toBe('fen_waders')
    expect(next.markerClaimReward).toBe('fen_waders')
    expect(next.state.eventSequence).toBe(before.state.eventSequence + 1)
    expect(player).toMatchObject({ xp: before.state.player.xp + 50,
      coins: before.state.player.coins + 80, level: 4 })
    expect(player.skillXp.spellcraft).toBe(before.state.player.skillXp.spellcraft + 50)
    expect(player.inventory).toContainEqual({ itemId: 'mireglass_reach/item/waders', quantity: 1 })
    expect(player.equipment).toEqual(oldEquipment)
    expect(confirm(next, witness)).toEqual({ rejection: 'already_claimed' })
    expect(before.markerClaimReward).toBeNull()
  })

  it.each(['inventory', 'escrow'] as const)('pays coins when waders are in %s', (where) => {
    const before = ready(), player = structuredClone(before.state.player)
    if (where === 'inventory') player.inventory.push({ itemId: 'mireglass_reach/item/waders', quantity: 1 })
    else player.tradeSlots[0] = { slotIndex: 0, itemId: 'mireglass_reach/item/waders',
      quantity: 1, unitPrice: 150 }
    player.backpackCapacity = player.inventory.reduce((sum, row) => sum + row.quantity, 0)
      + player.tradeSlots.reduce((sum, row) => sum + row.quantity, 0)
    const eligible = { ...before, state: { ...before.state, player } }
    const result = confirm(eligible, witness)
    if (!result.progress) throw new Error(result.rejection)
    expect(result.reward).toBe('coins')
    expect(result.progress.state.player.coins).toBe(player.coins + 230)
    expect(result.progress.state.player.inventory).toEqual(player.inventory)
    expect(result.progress.state.player.tradeSlots).toEqual(player.tradeSlots)
  })

  it('blocks only the item branch on full capacity and rejects overflow', () => {
    const before = ready(), player = structuredClone(before.state.player)
    player.backpackCapacity = player.inventory.reduce((sum, row) => sum + row.quantity, 0)
      + player.tradeSlots.reduce((sum, row) => sum + row.quantity, 0)
    const full = { ...before, state: { ...before.state, player } }
    expect(confirm(full, witness)).toEqual({ rejection: 'capacity' })
    expect(full.markerClaimReward).toBeNull()
    expect(confirm({ ...before, state: { ...before.state,
      player: { ...before.state.player, coins: Number.MAX_SAFE_INTEGER } } }, witness).rejection)
      .toBe('invalid_value')
    expect(confirm({ ...before, state: { ...before.state,
      eventSequence: Number.MAX_SAFE_INTEGER } }, witness).rejection).toBe('invalid_value')
    expect(confirm({ ...before, state: { ...before.state,
      player: { ...before.state.player, skillXp: { ...before.state.player.skillXp,
        spellcraft: Number.MAX_SAFE_INTEGER } } } }, witness).rejection).toBe('invalid_value')
  })
})
