import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { mireglassAnchors } from './mireglassContent'
import { mireglassFenRowAt } from './mireglassTerrain'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV26ValleyRimPassage } from './publicWorldV26ValleyRim'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { resolveIronHallCrestOutcome } from './publicWorldV42RewardAction'
import { createFreshPublicV43Root, decodePublicV43Progress }
  from './publicWorldV43Snapshot'
import { confirmPublicV45Action, confirmPublicV45RideFrame,
  PUBLIC_V45_MAX_RIDE_BATCH }
  from './publicWorldV45RideAction'
import type { PublicV45Progress } from './publicWorldV45RideAction'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const ride = (x: number, z = 0) => ({ kind: 'sedgehorn-assisted-ride-frame/v1',
  intents: [{ type: 'move', delta: { x, z } }] })

function at(x: number, z: number, boots = false): PublicV45Progress {
  const head = createFreshPublicV43Root(seed).head
  const site = resolveSedgehornFamiliarSite(head)!
  const floor = resolvePublicV23Surface(head.state, { x, z }, [])
  if (!floor) throw new Error('Missing fixture floor')
  const gx = Math.ceil(x / WORLD_CELL_METERS - 0.5)
  const gz = Math.ceil(z / WORLD_CELL_METERS - 0.5)
  const nearby = Array.from({ length: 9 }, (_, index) => worldTileAtGrid(seed,
    gx + index % 3 - 1, gz + Math.floor(index / 3) - 1).id)
  const player = head.state.player
  const state = { ...head.state, tick: 1300, eventSequence: 10,
    movementOwner: 'streamed' as const,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(head.state.discoveryMask), ...nearby])].sort()),
    player: { ...player, position: { x, y: floor.floorY, z }, verticalVelocity: 0,
      inventory: boots ? [...player.inventory, { itemId: 'leather_boots' as const,
        quantity: 1 }] : player.inventory,
      equipment: boots ? { ...player.equipment, feet: 'leather_boots' as const }
        : player.equipment,
      coins: player.coins + 25, xp: player.xp + 40,
      level: 1 + Math.floor((player.xp + 40) / 100) } }
  const familiar = { ...head.familiar, phase: 'claimed' as const,
    routeChoice: 'shelter' as const, position: { ...site.keeper.center },
    trust: 2, creatureCareXp: 40, stationKnown: true }
  const mountTraining = { careWitnesses: [0, 600, 1200].map((tick, index) => ({
    kind: 'sedgehorn-care/v1' as const, tick, eventSequence: index + 1 })) }
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...flat } = head
  const progress = decodePublicV43Progress({ ...flat, state, familiar, mountTraining })
  if (!progress) throw new Error('Invalid mature Sedgehorn fixture')
  return { ...progress, groundMount: { mode: 'riding', parkedPosition: null },
    tack: 'legacy' }
}

describe('V45 checked assisted Sedgehorn ride', () => {
  it('matches sequential checked frames for motion, turns, blocked paths, and bad progress', () => {
    const turn = { kind: 'sedgehorn-assisted-ride-frame/v1' as const,
      intents: [{ type: 'look' as const, yawDelta: 0.04, pitchDelta: 0 }] }
    const valid = at(36, 4, true)
    const cases = [
      { before: valid, frames: [ride(0.02), ride(-0.02)] },
      { before: valid, frames: [turn, ride(0.02), turn] },
      { before: at(36, 11, true), frames: [ride(0, 0.18)] },
      { before: { ...valid, tack: 'forged' } as unknown as PublicV45Progress,
        frames: [ride(0.02)] },
    ]
    for (const { before, frames } of cases) {
      const original = structuredClone(before)
      let current = before
      const events = [] as NonNullable<ReturnType<typeof confirmPublicV45RideFrame>['events']>[number][]
      let rejection: ReturnType<typeof confirmPublicV45RideFrame>['rejection']
      for (const frame of frames) {
        const result = confirmPublicV45RideFrame(current, frame)
        if (!result.progress) { rejection = result.rejection; break }
        current = result.progress
        events.push(...result.events)
      }
      const batch = confirmPublicV45Action(before,
        { kind: 'sedgehorn-assisted-ride-batch/v1', frames })
      expect(batch).toEqual(rejection ? { rejection } : { progress: current, events })
      expect(before).toEqual(original)
    }
    const malformed = [ride(0.02), ride(0.02)]
    delete malformed[1]
    expect(confirmPublicV45Action(valid,
      { kind: 'sedgehorn-assisted-ride-batch/v1', frames: malformed }))
      .toEqual({ rejection: 'invalid_witness' })
  }, 30_000)

  it('rejects a whole checked batch when a later dry frame leaves the revealed area', () => {
    const before = at(36, 4, true)
    const saved = structuredClone(before)
    const frame = ride(0.2)
    expect(confirmPublicV45RideFrame(before, frame).progress).toBeDefined()
    const witness = { kind: 'sedgehorn-assisted-ride-batch/v1',
      frames: Array.from({ length: PUBLIC_V45_MAX_RIDE_BATCH }, () => frame) }
    const result = confirmPublicV45Action(before, witness)
    expect(result.progress).toBeUndefined()
    expect(result.rejection).toBe('ride_blocked')
    expect(before).toEqual(saved)
  }, 30_000)

  it('dispatches exact mount and dismount witnesses without mutating the source', () => {
    const site = resolveSedgehornFamiliarSite(createFreshPublicV43Root(seed).head)!
    const rider = at(site.keeper.center.x, site.keeper.center.z)
    const parked: PublicV45Progress = { ...rider,
      groundMount: { mode: 'parked', parkedPosition: null } }
    const saved = structuredClone(parked)
    const mounted = confirmPublicV45Action(parked, { kind: 'sedgehorn-mount/v1' })
    expect(mounted.rejection).toBeUndefined()
    expect(mounted.events).toEqual([])
    expect(mounted.progress!.groundMount.mode).toBe('riding')
    const dismounted = confirmPublicV45Action(mounted.progress!,
      { kind: 'sedgehorn-dismount/v1' })
    expect(dismounted.rejection).toBeUndefined()
    expect(dismounted.events).toEqual([])
    expect(dismounted.progress!.groundMount).toEqual({ mode: 'parked',
      parkedPosition: parked.state.player.position })
    expect(confirmPublicV45Action(parked, { kind: 'sedgehorn-mount/v1',
      price: 0 }).rejection).toBe('invalid_witness')
    expect(confirmPublicV45Action({ ...parked, tack: 'not_owned' },
      { kind: 'sedgehorn-mount/v1' }).rejection).toBe('tack_required')
    expect(confirmPublicV45Action(parked, { kind: 'sedgehorn-dismount/v1' })
      .rejection).toBe('not_riding')
    expect(parked).toEqual(saved)
  })

  it('dispatches fixed-price tack purchase only from an exact witness', () => {
    const head = createFreshPublicV43Root(seed).head
    const store = head.state.greenway.stores
      .find((entry) => entry.id === 'store-greenway')!
    const site = resolveSedgehornFamiliarSite(head)!
    const familiar = { ...head.familiar, phase: 'claimed' as const,
      routeChoice: 'shelter' as const, position: { ...site.keeper.center },
      trust: 2, creatureCareXp: 40, stationKnown: true }
    const mountTraining = { careWitnesses: [0, 600, 1200].map((tick, index) => ({
      kind: 'sedgehorn-care/v1' as const, tick, eventSequence: index + 1 })) }
    const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
      ...flat } = head
    const progress = decodePublicV43Progress({ ...flat, familiar, mountTraining,
      state: { ...head.state, tick: 1300, eventSequence: 10,
        player: { ...head.state.player, position: { ...store.position }, coins: 300,
          xp: head.state.player.xp + 40 } } })
    if (!progress) throw new Error('Invalid Greenway purchase fixture')
    const before: PublicV45Progress = { ...progress, tack: 'not_owned',
      groundMount: { mode: 'parked', parkedPosition: null } }
    const saved = structuredClone(before)
    const bought = confirmPublicV45Action(before, { kind: 'buy-sedgehorn-tack/v1' })
    expect(bought.rejection).toBeUndefined()
    expect(bought.events).toEqual([])
    expect(bought.progress!.tack).toBe('purchased')
    expect(bought.progress!.state.player.coins).toBe(60)
    expect(confirmPublicV45Action(bought.progress!,
      { kind: 'buy-sedgehorn-tack/v1' }).rejection).toBe('already_owned')
    expect(confirmPublicV45Action(before, { kind: 'buy-sedgehorn-tack/v1',
      price: 0 }).rejection).toBe('invalid_witness')
    expect(confirmPublicV45Action({ ...before, groundMount: {
      mode: 'riding', parkedPosition: null } },
    { kind: 'buy-sedgehorn-tack/v1' }).rejection).toBe('not_parked')
    expect(before).toEqual(saved)
  })

  it('dispatches a checked herb sale with bounded quantity and no client price', () => {
    const salvager = mireglassAnchors(seed).salvager.tile
    const rider = at(salvager.center.x, salvager.center.z)
    const before: PublicV45Progress = { ...rider, tack: 'not_owned',
      groundMount: { mode: 'parked', parkedPosition: null },
      state: { ...rider.state,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(rider.state.discoveryMask), salvager.id,
        ])].sort()), player: { ...rider.state.player, coins: 10,
          inventory: [{ itemId: 'marsh_herb', quantity: 3 }] } } }
    const saved = structuredClone(before)
    const sold = confirmPublicV45Action(before,
      { kind: 'sell-marsh-herb/v1', quantity: 2 })
    expect(sold.rejection).toBeUndefined()
    expect(sold.events).toEqual([])
    expect(sold.progress!.state.player.coins).toBe(26)
    expect(sold.progress!.state.player.inventory).toEqual([
      { itemId: 'marsh_herb', quantity: 1 }])
    expect(confirmPublicV45Action(before, { kind: 'sell-marsh-herb/v1',
      quantity: 2, unitPrice: 999 }).rejection).toBe('invalid_witness')
    expect(confirmPublicV45Action(before, { kind: 'sell-marsh-herb/v1',
      quantity: 0 }).rejection).toBe('invalid_quantity')
    expect(confirmPublicV45Action(before, { kind: 'sell-marsh-herb/v1',
      quantity: '2' }).rejection).toBe('invalid_quantity')
    expect(confirmPublicV45Action({ ...before, groundMount: {
      mode: 'riding', parkedPosition: null } },
    { kind: 'sell-marsh-herb/v1', quantity: 1 }).rejection).toBe('not_eligible')
    expect(before).toEqual(saved)
  })

  it('replays ordinary V43 frames only while parked without mount or tack changes', () => {
    const riding = at(36, 4)
    const parked: PublicV45Progress = { ...riding, groundMount: {
      mode: 'parked', parkedPosition: null } }
    const saved = structuredClone(parked)
    const frame = { kind: 'frame-batch/v1', frames: [{ intents: [],
      walkRequested: true }] }
    const result = confirmPublicV45Action(parked, frame)
    expect(result.rejection).toBeUndefined()
    expect(result.events).toEqual([])
    expect(result.progress!.state.tick).toBe(parked.state.tick + 1)
    expect(result.progress!.groundMount).toEqual(parked.groundMount)
    expect(result.progress!.tack).toBe(parked.tack)
    expect(parked).toEqual(saved)
    expect(confirmPublicV45Action(riding, frame).rejection).toBe('not_eligible')
    expect(confirmPublicV45Action(parked, { ...frame, speed: 2 }).rejection)
      .toBe('invalid_witness')
    expect(confirmPublicV45Action(parked, ride(0.16)).rejection).toBe('not_eligible')
  })

  it('makes a barefoot rider faster than walking with one tick and two ordered moves', () => {
    const before = { ...at(36, 4), greenwayOrder: { claimedAtSequence: null },
      greenwayBagUpgrade: { claimedAtSequence: null } }
    const saved = structuredClone(before)
    const witness = ride(0.16)
    const result = confirmPublicV45RideFrame(before, witness)
    expect(result.rejection).toBeUndefined()
    const after = result.progress!
    expect(after.state.player.position.x - before.state.player.position.x)
      .toBeCloseTo(0.16 * 5 / 3)
    expect(after.state.tick).toBe(before.state.tick + 1)
    const moves = result.events!.filter((event) => event.type === 'player_moved')
    expect(moves).toHaveLength(2)
    expect(moves[0].sequence).toBeLessThan(moves[1].sequence)
    expect(moves[1].position).toEqual(after.state.player.position)
    expect(after.familiar).toEqual(before.familiar)
    expect(after.mountTraining).toEqual(before.mountTraining)
    expect(after.ironHallReward).toEqual(before.ironHallReward)
    expect(after.greenwayOrder).toEqual(before.greenwayOrder)
    expect(after.greenwayBagUpgrade).toEqual(before.greenwayBagUpgrade)
    expect(after.groundMount).toEqual(before.groundMount)
    expect(after.tack).toBe('legacy')
    expect(confirmPublicV45RideFrame({ ...before, tack: 'purchased' }, witness)
      .rejection).toBeUndefined()
    expect(confirmPublicV45Action({ ...before, tack: 'purchased' }, witness)
      .rejection).toBeUndefined()
    expect(before).toEqual(saved)
  })

  it('admits optional look plus a booted ride beyond foot-running pace', () => {
    const before = at(36, 4, true)
    const result = confirmPublicV45RideFrame(before, {
      kind: 'sedgehorn-assisted-ride-frame/v1', intents: [
        { type: 'look', yawDelta: 0.02, pitchDelta: 0 },
        { type: 'move', delta: { x: 0.2, z: 0 } },
      ] })
    expect(result.rejection).toBeUndefined()
    expect(result.progress!.state.player.position.x - before.state.player.position.x)
      .toBeCloseTo(1 / 3)
    expect(result.progress!.state.tick).toBe(before.state.tick + 1)
  })

  it('preserves the exact v1 position of a previously admitted ride frame', () => {
    const before = at(36, 4, true)
    const saved = structuredClone(before)
    const oldLeg = 0.2 * 5 / 6
    const result = confirmPublicV45RideFrame(before, ride(0.2))
    expect(result.rejection).toBeUndefined()
    expect(result.events!.filter((event) => event.type === 'player_moved')[0].position.x)
      .toBe(36 + oldLeg)
    expect(result.progress!.state.player.position.x).toBe((36 + oldLeg) + oldLeg)
    expect(result.progress!.state.player.position.z).toBe(4)
    expect(before).toEqual(saved)
  })

  it('admits a maximum booted step at large coordinates but rejects an over-limit witness', () => {
    const base = at(-375.375688, 348.856846, true)
    const before = { ...base, state: { ...base.state, player: { ...base.state.player,
      yaw: -3.25 } } }
    const saved = structuredClone(before)
    const delta = { x: -Math.sin(before.state.player.yaw) * 0.24,
      z: -Math.cos(before.state.player.yaw) * 0.24 }
    const result = confirmPublicV45RideFrame(before, ride(delta.x, delta.z))
    expect(result.rejection).toBeUndefined()
    expect(result.progress!.state.player.position.z).toBeGreaterThan(before.state.player.position.z)
    expect(confirmPublicV45RideFrame(before, ride(delta.x * 1.001,
      delta.z * 1.001)).rejection).toBe('invalid_witness')
    expect(before).toEqual(saved)
  })

  it.each([false, true])('settles a dry descent with remote bridge=%s', (bridge) => {
    const base = at(41.85, -56, true)
    const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-14')!
    const before = bridge ? { ...base, riverBridgeIds: [site.id],
      state: { ...base.state, discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask), ...site.footprintTileIds,
      ])].sort()) } } : base
    expect(decodePublicV43Progress(Object.fromEntries(Object.entries(before)
      .filter(([key]) => key !== 'groundMount' && key !== 'tack')))).not.toBeNull()
    const result = confirmPublicV45RideFrame(before, ride(0.18))
    expect(result.rejection).toBeUndefined()
    expect(result.progress!.state.player.position.x).toBeCloseTo(42.15)
    expect(result.progress!.state.player.position.y).toBeCloseTo(1.3470645734)
    const moves = result.events!.filter((event) => event.type === 'player_moved')
    expect(moves).toHaveLength(2)
    expect(moves[0].position.y).toBeCloseTo(before.state.player.position.y)
    expect(moves[1].position).toEqual(result.progress!.state.player.position)
  })

  it('rejects forged witness fields, eligibility, and active per-frame modes', () => {
    const before = at(36, 4, true)
    expect(confirmPublicV45RideFrame(before, { ...ride(0.2), admission: {} }).rejection)
      .toBe('invalid_witness')
    expect(confirmPublicV45RideFrame(before, ride(0.2).intents).rejection)
      .toBe('invalid_witness')
    expect(confirmPublicV45RideFrame(before, ride(0.25)).rejection)
      .toBe('invalid_witness')
    expect(confirmPublicV45RideFrame({ ...before, tack: 'not_owned' }, ride(0.2)).rejection)
      .toBe('not_eligible')
    expect(confirmPublicV45RideFrame({ ...before, groundMount: {
      mode: 'parked', parkedPosition: null } }, ride(0.2)).rejection)
      .toBe('not_eligible')
    expect(confirmPublicV45RideFrame({ ...before, mountTraining: {
      careWitnesses: before.mountTraining!.careWitnesses.slice(0, 2) } }, ride(0.2)).rejection)
      .toBe('not_eligible')
    const ward = { ...before, ironHall: { ...before.ironHall,
      learnedBolt: true, engaged: true, phase: 'windup' as const,
      phaseUntilTick: before.state.tick + 20 } }
    expect(confirmPublicV45RideFrame(ward, ride(0.2)).rejection).toBe('competing_mode')
    const spar = { ...before, ironHall: { ...before.ironHall,
      learnedBolt: true, wardDefeated: true, phase: 'defeated' as const,
      wardHealth: 0 }, ironHallReward: { ...before.ironHallReward,
      crestOutcome: resolveIronHallCrestOutcome(seed), questClaimed: true,
      vestOwned: true, vestDurability: 12,
      spar: { active: true, strikeAtTick: before.state.tick + 10,
        nextReadyTick: 0, strikesResolved: 0 } } }
    expect(confirmPublicV45RideFrame(spar, ride(0.2)).rejection).toBe('competing_mode')
    const wind = { ...before, state: { ...before.state,
      highland: { ...before.state.highland, landmarkDiscovered: true },
      windstep: { ...before.state.windstep, learned: true,
        activeUntilTick: before.state.tick + 1200,
        nextCastTick: before.state.tick + 1800 } } }
    expect(confirmPublicV45RideFrame(wind, ride(0.2)).rejection).toBe('competing_mode')
  })

  it('blocks swept pit, raised soil, and hidden corner even when endpoints look safe', () => {
    const base = at(-197.92, -18.04, true)
    const scale = 0.15 / Math.hypot(0.2, 0.12)
    const witness = ride(-0.2 * scale, 0.12 * scale)
    const pit = { ...base, terrain: { ...base.terrain,
      columns: [{ gx: -49, gz: -4, openDepth: 2, rewardDepth: 2,
        pitLadder: false }] } }
    expect(confirmPublicV45RideFrame(pit, witness).rejection).toBe('ride_blocked')
    const soil = { ...base, raisedSoilCells: [{ gx: -49, gz: -4 }] }
    expect(confirmPublicV45RideFrame(soil, witness).rejection).toBe('ride_blocked')
    const hidden = { ...base, state: { ...base.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(
        base.state.discoveryMask).filter((id) => id !== 'tile--46--1')) } }
    expect(confirmPublicV45RideFrame(hidden, witness).rejection).toBe('ride_blocked')
  })

  it('keeps wet, Mireglass, and valley-rim passages closed', () => {
    const wet = at(36, 11, true)
    expect(confirmPublicV45RideFrame(wet, ride(0, 0.18)).progress).toBeUndefined()
    const fenRow = mireglassFenRowAt(seed, -352)
    const mireglass = at(-352, fenRow - 2.1, true)
    const fen = ride(0, 0.18)
    expect(mireglassMoveBarrier(seed, mireglass.state.player.position,
      { ...mireglass.state.player.position, z: fenRow - 1.8 })).not.toBeNull()
    expect(confirmPublicV45RideFrame(mireglass, fen).progress).toBeUndefined()
    // The starter rim is inside Greenway ownership, so V45 cannot mount there.
    expect(publicV26ValleyRimPassage(seed, { x: 28, z: -5.9 },
      { x: 28, z: -6.2 }, []).ok).toBe(false)
  })
})
