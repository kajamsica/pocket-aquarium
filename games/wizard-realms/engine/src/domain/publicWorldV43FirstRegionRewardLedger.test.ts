import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { GREENWAY_LOG_ORDER } from './greenwayProcurementOrder'
import { ironHallQuartermasterSite } from './ironHallQuartermasterSite'
import { ironHallSite } from './ironHallSite'
import { resolvePublicV42CrestAfterDefeat } from './publicWorldV42RewardAction'
import { createFreshPublicV42Root, decodePublicV42Root,
  PUBLIC_V42_SCHEMA } from './publicWorldV42Snapshot'
import type { PublicV42Root } from './publicWorldV42Snapshot'
import { createPublicV43Root, decodePublicV43CheckedSuccessor,
  replayPublicV43Witness, PUBLIC_V43_SCHEMA } from './publicWorldV43Snapshot'
import type { PublicV43Root, PublicV43Witness } from './publicWorldV43Snapshot'
import { waystationRiverSite } from './waystationRiverContent'

const seed = 'wizard-realms'

function migratedSource(genesis: PublicV42Root['lineage']['genesis']): PublicV42Root {
  const source: PublicV42Root = { lineage: { origin: 'v41-migration',
    rulesProfile: 'iron-hall-rewards/v1', seed, sourceRevision: 0, genesis },
  previous: null, head: { ...structuredClone(genesis), schemaVersion: PUBLIC_V42_SCHEMA,
    saveRevision: 0, witness: null } }
  expect(decodePublicV42Root(source)).not.toBeNull()
  return source
}

function accepted(root: PublicV43Root, witness: PublicV43Witness): PublicV43Root {
  const progress = replayPublicV43Witness(root.head, witness)
  expect(progress, witness.kind).not.toBeNull()
  const next: PublicV43Root = { lineage: root.lineage, previous: root.head,
    head: { ...progress!, schemaVersion: PUBLIC_V43_SCHEMA,
      saveRevision: root.head.saveRevision + 1, witness } }
  expect(decodePublicV43CheckedSuccessor(root, next), witness.kind).not.toBeNull()
  return next
}

describe('V43 checked first-region reward ledger', () => {
  it('pays the fixed first Greenway NPC order once without minting character XP', () => {
    const fresh = createFreshPublicV42Root(seed)
    const store = fresh.head.state.greenway.stores.find(({ id }) =>
      id === GREENWAY_LOG_ORDER.destinationStoreId)!
    const genesis = { ...fresh.lineage.genesis, state: { ...fresh.head.state,
      player: { ...fresh.head.state.player, position: { ...store.position },
        inventory: [...fresh.head.state.player.inventory,
          { itemId: 'logs' as const, quantity: 4 }] } } }
    const before = createPublicV43Root(migratedSource(genesis))
    const after = accepted(before, { kind: 'fulfill-greenway-logs/v1' })
    expect(after.head.state.player.coins - before.head.state.player.coins).toBe(10)
    expect(after.head.state.player.xp - before.head.state.player.xp).toBe(0)
    expect(after.head.state.player.inventory.find(({ itemId }) => itemId === 'logs'))
      .toBeUndefined()
    expect(after.head.greenwayOrder?.claimedAtSequence).toBe(after.head.state.eventSequence)
    expect(replayPublicV43Witness(after.head,
      { kind: 'fulfill-greenway-logs/v1' })).toBeNull()
  })

  it('inherits the one-time Iron Hall quest payout and visible vest through checked V43 replay', () => {
    const fresh = createFreshPublicV42Root(seed)
    const quartermaster = ironHallQuartermasterSite(fresh.head)!
    const hall = ironHallSite(fresh.head)!
    const bridge = waystationRiverSite(seed)!
    const progress = { ...fresh.lineage.genesis, southbankReached: true,
      riverBridgeIds: [bridge.id],
      ironHall: { ...fresh.head.ironHall, learnedBolt: true,
        wardDefeated: true, wardHealth: 0, phase: 'defeated' as const, combatXp: 6 },
      state: { ...fresh.head.state, movementOwner: 'streamed' as const,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(fresh.head.state.discoveryMask),
          ...bridge.footprintTileIds, hall.alcove.id, hall.ward.id,
          quartermaster.id,
        ])].sort()),
        player: { ...fresh.head.state.player,
          position: { ...quartermaster.center }, verticalVelocity: 0 } } }
    const genesis = resolvePublicV42CrestAfterDefeat(progress)
    const before = createPublicV43Root(migratedSource(genesis))
    const after = accepted(before, { kind: 'ironhall-claim/v1' })
    expect(after.head.state.player.coins - before.head.state.player.coins).toBe(60)
    expect(after.head.state.player.xp - before.head.state.player.xp).toBe(70)
    expect(after.head.ironHall.combatXp - before.head.ironHall.combatXp).toBe(70)
    expect(after.head.ironHallReward).toMatchObject({ questClaimed: true,
      vestOwned: true, vestEquipped: true, vestDurability: 12 })
    expect(replayPublicV43Witness(after.head, { kind: 'ironhall-claim/v1' })).toBeNull()
  })
})
