/** V42 quartermaster authority and repeatable spar, independent of UI affordances. */
import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { ironHallQuartermasterSite } from './ironHallQuartermasterSite'
import { ironHallSite } from './ironHallSite'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createFreshPublicV41Root } from './publicWorldV41Snapshot'
import { confirmPublicV42RewardAction, decodePublicV42RewardProgress,
  decodePublicV42RewardWitness, INITIAL_IRON_HALL_REWARD,
  previewPublicV42RewardFrameBatch, replayPublicV42RewardFrameBatch,
  resolveIronHallCrestOutcome,
  resolvePublicV42CrestAfterDefeat } from './publicWorldV42RewardAction'
import type { PublicV42RewardProgress, PublicV42RewardWitness } from './publicWorldV42RewardAction'
import { replayPublicV42Witness } from './publicWorldV42Snapshot'
import { waystationRiverSite } from './waystationRiverContent'

const claim = { kind: 'ironhall-claim/v1' } as const
const equip = { kind: 'ironhall-vest-equip/v1' } as const
const unequip = { kind: 'ironhall-vest-unequip/v1' } as const
const repair = { kind: 'ironhall-vest-repair/v1' } as const
const spar = { kind: 'ironhall-spar/v1' } as const
const idle = { intents: [], walkRequested: true } as const
const frames = (count: number) => ({ kind: 'frame-batch/v1' as const,
  frames: Array.from({ length: count }, () => idle) })
const move = (count: number) => ({ kind: 'frame-batch/v1' as const,
  frames: Array.from({ length: count }, () => ({
    intents: [{ type: 'move' as const, delta: { x: 0.16, z: 0 } }],
    walkRequested: true })) })
const jumping = (moveCount = 0) => ({ kind: 'frame-batch/v1' as const,
  frames: [{ intents: [{ type: 'jump' as const }], walkRequested: true },
    ...move(moveCount).frames, ...frames(24 - moveCount).frames] })

function at(progress: PublicV42RewardProgress,
  position: Readonly<{ x: number; y: number; z: number }>): PublicV42RewardProgress {
  return { ...progress, state: { ...progress.state, player: {
    ...progress.state.player, position: { ...position }, verticalVelocity: 0 } } }
}

function ready(seed = 'wizard-realms', defeated = true): PublicV42RewardProgress {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...fresh } = createFreshPublicV41Root('wizard-realms').head
  const base = { ...fresh, state: seed === 'wizard-realms' ? fresh.state
    : createPublicV23Root(seed).head.state }
  const site = ironHallSite(base)!, quartermaster = ironHallQuartermasterSite(base)!
  const bridge = waystationRiverSite(seed)!
  expect(site).not.toBeNull()
  expect(quartermaster).not.toBeNull()
  const progress: PublicV42RewardProgress = {
    ...base, southbankReached: true, riverBridgeIds: [bridge.id],
    ironHall: defeated ? { ...base.ironHall, learnedBolt: true,
      wardDefeated: true, wardHealth: 0, phase: 'defeated', combatXp: 6 }
      : base.ironHall,
    ironHallReward: structuredClone(INITIAL_IRON_HALL_REWARD),
    state: { ...base.state, movementOwner: 'streamed',
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask),
        ...bridge.footprintTileIds, site.alcove.id, site.ward.id,
        quartermaster.id])].sort()),
      player: { ...base.state.player, position: { ...quartermaster.center },
        verticalVelocity: 0 } },
  }
  const resolved = resolvePublicV42CrestAfterDefeat(progress)
  expect(decodePublicV42RewardProgress(resolved)).not.toBeNull()
  return resolved
}

function accepted(progress: PublicV42RewardProgress,
  witness: PublicV42RewardWitness): PublicV42RewardProgress {
  const result = confirmPublicV42RewardAction(progress, witness)
  expect(result.rejection).toBeUndefined()
  expect(result.progress?.state.eventSequence).toBe(progress.state.eventSequence + 1)
  return result.progress!
}

function claimed(seed?: string): PublicV42RewardProgress {
  return accepted(ready(seed), claim)
}

describe('V42 Iron Hall reward authority', () => {
  it('uses supported dry quartermasters and one seed-bound crest result', () => {
    for (const seed of ['wizard-realms', 'greenway-alpha']) {
      const before = ready(seed, false), site = ironHallQuartermasterSite(before)!
      expect([site.center.x, site.center.z]).toEqual([80, 24])
      expect(site.terrain).toBe('loam')
      expect(resolvePublicV42CrestAfterDefeat(before)).toBe(before)
      expect(confirmPublicV42RewardAction(before, claim).rejection)
        .toBe('ward_not_defeated')
      const defeated = ready(seed)
      expect(defeated.ironHallReward.crestOutcome)
        .toBe(resolveIronHallCrestOutcome(seed))
      expect(resolvePublicV42CrestAfterDefeat(defeated)).toBe(defeated)
    }
    expect(resolveIronHallCrestOutcome('wizard-realms')).toBe('won')
    expect(resolveIronHallCrestOutcome('greenway-alpha')).toBe('missed')
  })

  it('grants exact coins, character XP, Combat XP and a worn vest once per supported seed', () => {
    for (const seed of ['wizard-realms', 'greenway-alpha']) {
      const before = ready(seed), after = accepted(before, claim)
      expect(after.state.player.coins - before.state.player.coins).toBe(60)
      expect(after.state.player.xp - before.state.player.xp).toBe(70)
      expect(after.ironHall.combatXp - before.ironHall.combatXp).toBe(70)
      expect(after.state.player.level).toBe(1 + Math.floor(after.state.player.xp / 100))
      expect(after.ironHallReward).toMatchObject({ questClaimed: true,
        vestOwned: true, vestEquipped: true, vestDurability: 12,
        crestOutcome: before.ironHallReward.crestOutcome })
      expect(after.state.player.inventory).toEqual(before.state.player.inventory)
      expect(confirmPublicV42RewardAction(after, claim).rejection).toBe('already_claimed')
      expect(after.ironHallReward.spar.strikesResolved).toBe(0)
    }
  })

  it('refuses remote, hidden, airborne, ungrounded, premature and overflow claims', () => {
    const base = ready(), quartermaster = ironHallQuartermasterSite(base)!
    expect(confirmPublicV42RewardAction({ ...base, southbankReached: false }, claim).rejection)
      .toBe('requires_crossing')
    expect(confirmPublicV42RewardAction({ ...base, state: { ...base.state,
      movementOwner: 'greenway', player: { ...base.state.player,
        position: base.state.greenway.stores[0].position } } }, claim).rejection)
      .toBe('wrong_region')
    const hiddenPosition = { x: 80, z: 26.1 }
    const hiddenFloor = resolvePublicV23Surface(base.state, hiddenPosition,
      base.regionalWorks.builtLadderIds)!.floorY
    const nearHidden = at(base, { ...hiddenPosition, y: hiddenFloor })
    expect(decodePublicV42RewardProgress(nearHidden)).not.toBeNull()
    const hidden = { ...nearHidden, state: { ...nearHidden.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(
        nearHidden.state.discoveryMask).filter((id) => id !== quartermaster.id)) } }
    // The state decoder also rejects a nearby pose whose discovery mask omits
    // the adjacent quartermaster tile; either way the hidden site cannot pay.
    expect(confirmPublicV42RewardAction(hidden, claim).rejection).toBe('invalid_progress')
    // Checked replay stores only landed frames; a forged airborne head is invalid.
    expect(confirmPublicV42RewardAction({ ...base, state: { ...base.state,
      player: { ...base.state.player, verticalVelocity: 1 } } }, claim).rejection)
      .toBe('invalid_progress')
    expect(confirmPublicV42RewardAction(at(base, ironHallSite(base)!.ward.center),
      claim).rejection).toBe('too_far')
    const rich = { ...base, state: { ...base.state, player: { ...base.state.player,
      coins: Number.MAX_SAFE_INTEGER } } }
    expect(confirmPublicV42RewardAction(rich, claim).rejection).toBe('invalid_value')
    expect(confirmPublicV42RewardAction(base, { ...claim, coins: 600 }).rejection)
      .toBe('invalid_value')
    expect(decodePublicV42RewardWitness({ ...claim, coins: 600 })).toBeNull()
    expect(decodePublicV42RewardProgress({ ...base,
      ironHallReward: { ...base.ironHallReward, crestOutcome: 'unrolled' } })).toBeNull()
  })

  it('persists equip state, refuses gear changes in a spar and cannot equip depleted armor', () => {
    const owned = claimed(), bare = accepted(owned, unequip)
    expect(bare.ironHallReward).toMatchObject({ vestEquipped: false,
      vestOwned: true, vestDurability: 12 })
    expect(confirmPublicV42RewardAction(bare, unequip).rejection).toBe('not_equipped')
    const worn = accepted(bare, equip)
    expect(worn.ironHallReward.vestEquipped).toBe(true)
    expect(confirmPublicV42RewardAction(worn, equip).rejection).toBe('already_equipped')
    const ward = at(worn, ironHallSite(worn)!.ward.center)
    const active = accepted(ward, spar)
    expect(confirmPublicV42RewardAction(active, unequip).rejection)
      .toBe('cannot_change_gear')
    expect(confirmPublicV42RewardAction(active, spar).rejection).toBe('spar_active')
    const depleted = { ...bare, ironHallReward: { ...bare.ironHallReward,
      vestDurability: 0 } }
    expect(decodePublicV42RewardProgress(depleted)).not.toBeNull()
    expect(confirmPublicV42RewardAction(depleted, equip).rejection).toBe('depleted')
    expect(confirmPublicV42RewardAction(ready(), equip).rejection).toBe('not_owned')
  })

  it('resolves one strike at tick 20 using actual position, then enforces cooldown', () => {
    const owned = claimed(), ward = at(owned, ironHallSite(owned)!.ward.center)
    expect(confirmPublicV42RewardAction(owned, spar).rejection).toBe('too_far')
    expect(confirmPublicV42RewardAction(at(ready(), ironHallSite(owned)!.ward.center),
      spar).rejection).toBe('not_claimed')
    const active = accepted(ward, spar)
    expect(active.ironHallReward.spar).toMatchObject({ active: true,
      strikeAtTick: ward.state.tick + 20 })
    const before = replayPublicV42RewardFrameBatch(active, frames(19))!
    expect(before.ironHall.playerHealth).toBe(active.ironHall.playerHealth)
    expect(before.ironHallReward.vestDurability).toBe(12)
    const hit = replayPublicV42RewardFrameBatch(before, frames(1))!
    expect(hit.ironHall.playerHealth).toBe(active.ironHall.playerHealth - 2)
    expect(hit.ironHallReward).toMatchObject({ vestDurability: 11,
      vestEquipped: true, spar: { active: false, strikesResolved: 1,
        nextReadyTick: hit.state.tick + 45 } })
    expect(replayPublicV42RewardFrameBatch(active, frames(20))).toEqual(hit)
    expect(replayPublicV42RewardFrameBatch(hit, frames(1))!.ironHall.playerHealth)
      .toBe(hit.ironHall.playerHealth)
    expect(confirmPublicV42RewardAction(hit, spar).rejection).toBe('cooldown')
    const readyAgain = replayPublicV42RewardFrameBatch(hit, frames(45))!
    expect(confirmPublicV42RewardAction(readyAgain, spar).rejection).toBeUndefined()
    const dodge = replayPublicV42RewardFrameBatch(active, move(20))!
    expect(dodge.state.player.position.x).toBeGreaterThan(
      active.state.player.position.x + 2.7)
    expect(dodge.ironHall.playerHealth).toBe(active.ironHall.playerHealth)
    expect(dodge.ironHallReward.vestDurability).toBe(12)
    expect(dodge.ironHallReward.spar.strikesResolved).toBe(1)
    expect(dodge.state.player.coins).toBe(active.state.player.coins)
    expect(dodge.state.player.xp).toBe(active.state.player.xp)
    expect(dodge.ironHall.combatXp).toBe(active.ironHall.combatXp)
    expect(dodge.ironHallReward.crestOutcome).toBe(active.ironHallReward.crestOutcome)
  })

  it('makes an unarmored hit four, depletes protection, and recovers a knockout locally', () => {
    const owned = claimed(), ward = at(owned, ironHallSite(owned)!.ward.center)
    const bare = accepted(ward, unequip)
    const unarmored = replayPublicV42RewardFrameBatch(accepted(bare, spar), frames(20))!
    expect(unarmored.ironHall.playerHealth).toBe(8)
    expect(unarmored.ironHallReward.vestDurability).toBe(12)
    const last = { ...ward, ironHallReward: { ...ward.ironHallReward,
      vestDurability: 1 }, ironHall: { ...ward.ironHall, playerHealth: 2 },
      nextHomeAtMs: 123456 }
    expect(decodePublicV42RewardProgress(last)).not.toBeNull()
    const active = accepted(last, spar)
    const prestrike = replayPublicV42RewardFrameBatch(active, frames(19))!
    expect(prestrike).not.toBeNull()
    const downed = replayPublicV42RewardFrameBatch(prestrike, frames(1))!
    expect(downed.ironHall).toMatchObject({ playerHealth: 6, knockouts: 1 })
    expect(downed.state.player.position).toEqual(ironHallSite(downed)!.alcove.center)
    expect(downed.ironHallReward).toMatchObject({ vestOwned: true,
      vestEquipped: false, vestDurability: 0 })
    expect(downed.nextHomeAtMs).toBe(123456)
    expect(downed.state.player.coins).toBe(last.state.player.coins)
    expect(downed.ironHallReward.questClaimed).toBe(true)
  })

  it('checks the actual airborne position at the spar strike, then saves the landed jump', () => {
    const owned = claimed(), ward = at(owned, ironHallSite(owned)!.ward.center)
    const active = accepted(ward, spar), still = jumping(), fleeing = jumping(19)
    const at19 = previewPublicV42RewardFrameBatch(active,
      { ...still, frames: still.frames.slice(0, 19) })!
    expect(at19.state.player.verticalVelocity).not.toBe(0)
    expect(at19.ironHall.playerHealth).toBe(12)
    expect(at19.ironHallReward.vestDurability).toBe(12)
    const hit = previewPublicV42RewardFrameBatch(active,
      { ...still, frames: still.frames.slice(0, 20) })!
    expect(hit.state.tick).toBe(active.state.tick + 20)
    expect(hit.ironHall.playerHealth).toBe(10)
    expect(hit.ironHallReward).toMatchObject({ vestDurability: 11,
      spar: { active: false, strikesResolved: 1 } })
    const landed = replayPublicV42RewardFrameBatch(active, still)!
    expect(landed.state.player.verticalVelocity).toBe(0)
    expect(landed.ironHall.playerHealth).toBe(10)
    expect(landed.ironHallReward.vestDurability).toBe(11)
    expect(landed.ironHallReward.spar.strikesResolved).toBe(1)
    expect(previewPublicV42RewardFrameBatch(active, still)).toEqual(landed)
    const dodge = previewPublicV42RewardFrameBatch(active,
      { ...fleeing, frames: fleeing.frames.slice(0, 20) })!
    expect(dodge.state.player.position.x).toBeGreaterThan(
      active.state.player.position.x + 2.7)
    expect(dodge.ironHall.playerHealth).toBe(12)
    expect(dodge.ironHallReward.vestDurability).toBe(12)
    expect(dodge.ironHallReward.spar.strikesResolved).toBe(1)
    const dodgedLanding = replayPublicV42RewardFrameBatch(active, fleeing)!
    expect(dodgedLanding.ironHall.playerHealth).toBe(12)
    expect(dodgedLanding.ironHallReward.vestDurability).toBe(12)
    expect(dodgedLanding.ironHallReward.spar.strikesResolved).toBe(1)
  })

  it('replays the inherited ward strike and knockout through a landed jump', () => {
    const base = ready('wizard-realms', false), site = ironHallSite(base)!
    const studied = replayPublicV42Witness(at(base, site.alcove.center),
      { kind: 'ironhall-study/v1' })!
    const engaged = replayPublicV42Witness(at(studied, site.ward.center),
      { kind: 'ironhall-engage/v1' })!
    const flight = jumping(), at19 = previewPublicV42RewardFrameBatch(engaged,
      { ...flight, frames: flight.frames.slice(0, 19) })!
    expect(at19.ironHall.playerHealth).toBe(12)
    const strike = previewPublicV42RewardFrameBatch(engaged,
      { ...flight, frames: flight.frames.slice(0, 20) })!
    expect(strike.ironHall).toMatchObject({ playerHealth: 8, phase: 'recovery' })
    const landed = replayPublicV42RewardFrameBatch(engaged, flight)!
    expect(landed.ironHall.playerHealth).toBe(8)
    expect(previewPublicV42RewardFrameBatch(engaged, flight)).toEqual(landed)
    const lethal = { ...engaged, ironHall: { ...engaged.ironHall, playerHealth: 4 } }
    expect(decodePublicV42RewardProgress(lethal)).not.toBeNull()
    const downed = replayPublicV42RewardFrameBatch(lethal, flight)!
    expect(downed.ironHall).toMatchObject({ playerHealth: 6, knockouts: 1,
      engaged: false, phase: 'dormant' })
    expect(downed.state.player.position).toEqual(site.alcove.center)
  })

  it('repairs only nearby for 18 coins, without debiting refused actions', () => {
    const owned = claimed(), worn = { ...owned, ironHallReward: {
      ...owned.ironHallReward, vestDurability: 11 } }
    const repaired = accepted(worn, repair)
    expect(repaired.ironHallReward.vestDurability).toBe(12)
    expect(repaired.state.player.coins).toBe(worn.state.player.coins - 18)
    expect(confirmPublicV42RewardAction(repaired, repair).rejection).toBe('already_full')
    const remote = at(worn, ironHallSite(worn)!.ward.center)
    expect(confirmPublicV42RewardAction(remote, repair).rejection).toBe('too_far')
    expect(remote.state.player.coins).toBe(worn.state.player.coins)
    const poor = { ...worn, state: { ...worn.state, player: {
      ...worn.state.player, coins: 17 } } }
    expect(confirmPublicV42RewardAction(poor, repair).rejection).toBe('insufficient_coins')
    expect(poor.state.player.coins).toBe(17)
    expect(confirmPublicV42RewardAction(ready(), repair).rejection).toBe('not_owned')
  })
})
