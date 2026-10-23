import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { emptyPublicV29MiningTools } from './publicWorldV29MiningTools'
import { replayPublicV35Witness } from './publicWorldV35Snapshot'
import { starterCliffCanonicalSite } from './starterCliffProfile'
import { confirmPublicV35LedgerAction as confirm,
  decodePublicV35LedgerWitness as decode, previewPublicV35LedgerAction as preview } from './publicWorldV35LedgerAction'
import type { PublicV35Progress } from './publicWorldV35LedgerAction'

const seed = 'wizard-realms', bridgeId = 'works6:river-bridge:-14'
const ladderId = 'works4:ladder:greenway-north-cliff:11'
const creekId = 'works4:bridge:greenway-creek:0'

function ready(): PublicV35Progress {
  const { head } = createPublicV23Root(seed)
  const bridge = resolvePublicV28RiverBridge(seed, bridgeId)!
  if (!bridge || !resolvePublicV17GreenwaySite(seed, ladderId)
    || !resolvePublicV17GreenwaySite(seed, creekId)) throw new Error('Missing route')
  const floor = resolvePublicV23Surface(head.state, bridge.exit, [])?.floorY
  if (floor === undefined) throw new Error('Missing survey ground')
  return { state: { ...head.state, movementOwner: 'streamed',
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(head.state.discoveryMask), ...bridge.footprintTileIds])].sort()),
    player: { ...head.state.player, position: { ...bridge.exit, y: floor },
      xp: 140, level: 2, skillXp: { ...head.state.player.skillXp, construction: 140 } } },
  greenwayWorks: { ...head.greenwayWorks, builtBridgeIds: [creekId],
    builtLadderIds: [ladderId] }, regionalWorks: head.regionalWorks,
  terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0,
  riverBridgeIds: [bridgeId], miningTools: emptyPublicV29MiningTools(),
  claimedBridgeheadId: creekId, raisedSoilCells: [],
  ledgerSurveyBridgeId: null, ledgerClaimReward: null }
}

function atStore(progress: PublicV35Progress, stone = 1): PublicV35Progress {
  const store = progress.state.greenway.stores.find((row) => row.id === 'store-greenway')!
  const floor = publicV17StarterSupportAt({ seed,
    profile: progress.state.generationProfile,
    route: progress.state.greenway.routes.find((row) => row.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: progress.greenwayWorks }, store.position)?.floorY
  if (floor === undefined) throw new Error('Missing Outfitters ground')
  return { ...progress, terrain: { ...progress.terrain,
    bag: { ...progress.terrain.bag, stone } }, state: { ...progress.state,
      movementOwner: 'greenway', player: { ...progress.state.player,
        position: { ...store.position, y: floor } } } }
}

describe('V35 checked Outfitters Ledger authority', () => {
  it('accepts only exact witnesses and rejects missing route, claim, pose and repeats', () => {
    const before = ready(), witness = { kind: 'ledger-survey/v1' as const, bridgeId }
    expect(decode(witness)).toEqual(witness)
    expect(decode({ ...witness, reward: 'coins' })).toBeNull()
    expect(decode({ kind: 'ledger-deliver/v1', coins: 999 })).toBeNull()
    expect(confirm(before, { ...witness, reward: 'coins' })).toEqual({ rejection: 'invalid_value' })
    expect(confirm({ ...before, claimedBridgeheadId: null }, witness).rejection)
      .toBe('requires_first_find')
    expect(confirm({ ...before, riverBridgeIds: [] }, witness).rejection).toBe('not_built')
    expect(confirm({ ...before, greenwayWorks: { ...before.greenwayWorks,
      builtLadderIds: [] } }, witness).rejection).toBe('not_built')
    const starterSite = starterCliffCanonicalSite(seed)
    const canonicalOnly = { ...before,
      state: { ...before.state, greenway: { ...before.state.greenway,
        routes: before.state.greenway.routes.map((route) => route.id === 'greenway_ladder'
          ? { ...route, siteId: starterSite.id, from: starterSite.from, to: starterSite.to }
          : route),
        builtRouteIds: [...before.state.greenway.builtRouteIds, 'greenway_ladder' as const],
        unlockedRecipeIds: [...before.state.greenway.unlockedRecipeIds,
          'highland_bridge' as const].sort() } },
      greenwayWorks: { ...before.greenwayWorks, builtLadderIds: [] } }
    expect(preview(canonicalOnly, witness).rejection).toBeNull()
    expect(confirm(canonicalOnly, witness).progress?.ledgerSurveyBridgeId).toBe(bridgeId)
    expect(confirm(before, { ...witness, bridgeId: creekId }).rejection).toBe('invalid_site')
    const farBank = resolvePublicV28RiverBridge(seed, bridgeId)!.approach
    const farFloor = resolvePublicV23Surface(before.state, farBank, [])!.floorY
    expect(confirm({ ...before, state: { ...before.state,
      player: { ...before.state.player,
        position: { ...farBank, y: farFloor } } } }, witness).rejection).toBe('too_far')
    expect(preview(before, witness).rejection).toBeNull()
    const result = confirm(before, witness)
    if (!result.progress) throw new Error(result.rejection)
    expect(result.progress.state.player.xp).toBe(before.state.player.xp + 20)
    expect(result.progress.state.player.skillXp.wayfinding)
      .toBe(before.state.player.skillXp.wayfinding + 20)
    expect(confirm(result.progress, witness).rejection).toBe('already_surveyed')
    expect(before.ledgerSurveyBridgeId).toBeNull()
  })

  it.each([false, true])('pays exact one-time branch, prior tunic owner=%s', (owned) => {
    const surveyed = confirm(ready(), { kind: 'ledger-survey/v1', bridgeId }).progress
    if (!surveyed) throw new Error('Survey failed')
    const placed = atStore(surveyed)
    const before = owned ? { ...placed, state: { ...placed.state,
      player: { ...placed.state.player, inventory: [...placed.state.player.inventory,
        { itemId: 'traveler_tunic' as const, quantity: 1 }] } } } : placed
    const delivered = confirm(before, { kind: 'ledger-deliver/v1' })
    if (!delivered.progress) throw new Error(delivered.rejection)
    const next = delivered.progress, player = next.state.player
    expect(delivered.reward).toBe(owned ? 'coins' : 'traveler_tunic')
    expect(next.terrain.bag.stone).toBe(0)
    expect(player.xp).toBe(before.state.player.xp + 40)
    expect(player.skillXp.wayfinding).toBe(before.state.player.skillXp.wayfinding + 40)
    expect(player.coins).toBe(before.state.player.coins + (owned ? 85 : 50))
    expect(player.inventory.filter((row) => row.itemId === 'traveler_tunic')).toHaveLength(1)
    expect(player.equipment.chest).toBe(owned ? before.state.player.equipment.chest : 'traveler_tunic')
    expect(confirm(next, { kind: 'ledger-deliver/v1' }).rejection).toBe('already_claimed')
    expect(replayPublicV35Witness(next, { kind: 'checkpoint' })).toMatchObject({
      ledgerClaimReward: owned ? 'coins' : 'traveler_tunic',
      state: { player: { coins: player.coins, xp: player.xp } },
    })
    expect(before.terrain.bag.stone).toBe(1)
  })

  it('requires sample and grounded Outfitters reach, rejecting overflow', () => {
    const unsurveyed = atStore(ready())
    expect(confirm(unsurveyed, { kind: 'ledger-deliver/v1' }).rejection).toBe('requires_survey')
    const surveyed = { ...unsurveyed, ledgerSurveyBridgeId: bridgeId }
    expect(confirm(atStore(surveyed, 0), { kind: 'ledger-deliver/v1' }).rejection)
      .toBe('no_stone')
    const home = createPublicV23Root(seed).head.state.player.position
    expect(confirm({ ...surveyed, state: { ...surveyed.state,
      player: { ...surveyed.state.player, position: home } } },
    { kind: 'ledger-deliver/v1' }).rejection).toBe('too_far')
    expect(confirm({ ...surveyed, state: { ...surveyed.state,
      player: { ...surveyed.state.player, coins: Number.MAX_SAFE_INTEGER } } },
    { kind: 'ledger-deliver/v1' }).rejection).toBe('invalid_value')
  })
})
