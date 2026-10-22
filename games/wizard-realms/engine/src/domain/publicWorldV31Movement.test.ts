import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import type { PublicV23Progress } from './publicWorldV23Snapshot'
import { resolvePublicV23Site } from './publicWorldV23Sites'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { replayPublicV28FramesWithEvents } from './publicWorldV28Replay'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { projectPublicV28Pose } from './publicWorldV28RiverSupport'
import { replayPublicV29Witness } from './publicWorldV29Snapshot'
import { canonicalClaim, replayPublicV30FramesWithEvents,
  replayPublicV30Witness } from './publicWorldV30Snapshot'
import type { PublicV30Progress } from './publicWorldV30Migration'
import { decodePublicV29ActionProgress } from './publicWorldV29MiningTools'
import type { PublicV31Progress } from './publicWorldV31Migration'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { replayPublicV31FramesWithEvents, replayPublicV31ReturnHome } from './publicWorldV31Movement'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { createPublicV45DryRideAdmission } from './publicWorldV45DryRideAdmission'

const seed = 'wizard-realms'
const move = (x: number, z: number) => [{ intents: [{ type: 'move' as const,
  delta: { x, z } }], walkRequested: false }]

function at(x: number, z: number): PublicV31Progress {
  const { head } = createPublicV23Root(seed)
  const point = { x, z }
  const support = publicV17StarterSupportAt({ seed,
    profile: head.state.generationProfile,
    route: head.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: head.greenwayWorks }, point)
  if (!support) throw new Error('Missing Greenway floor')
  const old = decodePublicV23Progress({ state: { ...head.state,
    player: { ...head.state.player,
      position: { ...point, y: support.floorY } } },
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }, seed)
  if (!old) throw new Error('Invalid V31 movement fixture')
  return { ...old, terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0,
    riverBridgeIds: [], miningTools: { basicPickOwned: false,
      enchantedPickOwned: false, activePick: null }, claimedBridgeheadId: null,
    raisedSoilCells: [] }
}

function streamedBootsAt(point = { x: 36, z: 4 }): PublicV31Progress {
  const { head } = createPublicV23Root(seed)
  const floor = resolvePublicV23Surface(head.state, point, [])
  if (!floor) throw new Error('Missing dry streamed floor')
  const old = decodePublicV23Progress({ state: { ...head.state,
    movementOwner: 'streamed',
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(head.state.discoveryMask), floor.tileId])].sort()),
    player: { ...head.state.player, position: { ...point, y: floor.floorY },
      inventory: [...head.state.player.inventory, { itemId: 'leather_boots', quantity: 1 }],
      equipment: { ...head.state.player.equipment, feet: 'leather_boots' } } },
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }, seed)
  if (!old) throw new Error('Invalid dry streamed ride fixture')
  return { ...old, terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0,
    riverBridgeIds: [], miningTools: { basicPickOwned: false,
      enchantedPickOwned: false, activePick: null }, claimedBridgeheadId: null,
    raisedSoilCells: [] }
}

function oldV30Frame(before: PublicV30Progress, frames: ReturnType<typeof move>) {
  if (!canonicalClaim(before)) return null
  const replayed = replayPublicV29Witness({ state: before.state,
    greenwayWorks: before.greenwayWorks, regionalWorks: before.regionalWorks,
    terrain: before.terrain, nextHomeAtMs: before.nextHomeAtMs,
    riverBridgeIds: before.riverBridgeIds, miningTools: before.miningTools },
  { kind: 'frame-batch/v1', frames })
  return replayed ? { ...replayed, claimedBridgeheadId: before.claimedBridgeheadId } : null
}

describe('V31 effective soil support and checked movement', () => {
  it.each([false, true])('admits one dry 0.3 m frame without an extra tick, remote soil=%s', (soil) => {
    const base = streamedBootsAt()
    const before: PublicV31Progress = soil ? { ...base, raisedSoilCells: [{ gx: 3, gz: -4 }],
      state: { ...base.state, discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask), 'tile-6--1'])].sort()) } } : base
    const saved = structuredClone(before), from = before.state.player.position
    const middle = { ...from, x: from.x + 0.15 }, to = { ...from, x: from.x + 0.3 }
    const admission = createPublicV45DryRideAdmission(from, middle, to)
    const assisted = { substeps: [{ x: 0.15, z: 0 }, { x: 0.15, z: 0 }] as const,
      settle: (after: PublicV23Progress) => after }
    const frames = move(0.2, 0), policy = () => assisted
    expect(admission).not.toBeNull()
    expect(replayPublicV31FramesWithEvents(before, frames, false, policy)).toBeNull()
    const checked = replayPublicV31FramesWithEvents(before, frames, false, policy, admission!)
    expect(checked).not.toBeNull()
    expect(checked!.progress.state.player.position.x).toBeCloseTo(to.x)
    expect(checked!.progress.state.tick).toBe(before.state.tick + 1)
    expect(checked!.events.filter((event) => event.type === 'player_moved')).toHaveLength(2)
    expect(checked!.events.filter((event) => event.type === 'player_moved')
      .every((event) => event.tick === checked!.progress.state.tick)).toBe(true)
    expect(before).toEqual(saved)
  })
  it('does not turn an admitted long wet span into a bridge crossing', () => {
    const before = streamedBootsAt({ x: 36, z: 11 })
    const from = before.state.player.position
    const admission = createPublicV45DryRideAdmission(from,
      { ...from, z: from.z + 0.15 }, { ...from, z: from.z + 0.3 })
    const assisted = { substeps: [{ x: 0, z: 0.15 }, { x: 0, z: 0.15 }] as const,
      settle: (after: PublicV23Progress) => after }
    expect(admission).not.toBeNull()
    expect(replayPublicV31FramesWithEvents(before, move(0, 0.2), false,
      () => assisted, admission!)).toBeNull()
  })
  it.each([false, true])('settles the same admitted dry descent with remote bridge=%s', (bridge) => {
    const base = streamedBootsAt({ x: 41.85, z: -56 })
    const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-14')!
    const before: PublicV31Progress = bridge ? { ...base, riverBridgeIds: [site.id],
      state: { ...base.state, discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask), ...site.footprintTileIds])].sort()) } } : base
    expect(decodePublicV31ActionProgress(before)).not.toBeNull()
    const saved = structuredClone(before), from = before.state.player.position
    expect(from.y).toBeCloseTo(1.4092623804)
    const endFloor = resolvePublicV23Surface(before.state, { x: 42.15, z: -56 }, [])
    expect(endFloor?.floorY).toBeCloseTo(1.3470645734)
    const admission = createPublicV45DryRideAdmission(from,
      { ...from, x: from.x + 0.15 }, { x: 42.15, y: endFloor!.floorY, z: -56 })
    const assisted = { substeps: [{ x: 0.15, z: 0 }, { x: 0.15, z: 0 }] as const,
      settle: (after: PublicV23Progress) => after }
    const frames = move(0.2, 0), policy = () => assisted
    expect(admission).not.toBeNull()
    expect(replayPublicV31FramesWithEvents(before, frames, false, policy)).toBeNull()
    const checked = replayPublicV31FramesWithEvents(before, frames, false, policy, admission!)
    expect(checked).not.toBeNull()
    expect(checked!.progress.state.player.position).toEqual({ x: 42.15, y: endFloor!.floorY, z: -56 })
    expect(checked!.progress.state.tick).toBe(before.state.tick + 1)
    const moved = checked!.events.filter((event) => event.type === 'player_moved')
    expect(moved).toHaveLength(2)
    expect(moved[0]).toMatchObject({ tick: checked!.progress.state.tick,
      position: { x: 42, y: from.y, z: -56 } })
    expect(moved[1]).toMatchObject({ tick: checked!.progress.state.tick,
      position: checked!.progress.state.player.position })
    expect(before).toEqual(saved)
  })
  it('retreats from the off-lane Slate upper pose, aligns on the shelf, and descends the saved rung', () => {
    const farSeed = 'greenway-alpha', { head } = createPublicV23Root(farSeed)
    const site = resolvePublicV23Site(farSeed, 'works5:ladder:mireglass-slate:W:-103:4311')!
    const point = { x: -414.07, z: 431.73 }
    const surface = resolvePublicV23Surface(head.state, point, [site.id])!
    expect(surface.floorY).toBeCloseTo(2.4)
    const old = decodePublicV23Progress({ state: { ...head.state,
      movementOwner: 'streamed',
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(head.state.discoveryMask), ...site.footprintTileIds,
        surface.tileId])].sort()),
      player: { ...head.state.player, xp: 60,
        skillXp: { ...head.state.player.skillXp, construction: 60 },
        position: { ...point, y: surface.floorY }, verticalVelocity: 0 } },
    greenwayWorks: head.greenwayWorks, regionalWorks: { builtLadderIds: [site.id] } }, farSeed)
    expect(old).not.toBeNull()
    const before: PublicV31Progress = { ...old!, terrain: emptyPublicV26TerrainLedger(),
      nextHomeAtMs: 0, riverBridgeIds: [],
      miningTools: { basicPickOwned: false, enchantedPickOwned: false, activePick: null },
      claimedBridgeheadId: null, raisedSoilCells: [] }
    expect(decodePublicV31ActionProgress(before)).not.toBeNull()
    expect(replayPublicV31FramesWithEvents(before, move(0, -0.16))).toBeNull()
    let current = before
    for (const [leg, count, dx, dz] of [
      ['retreat', 15, -0.16, 0],
      ['align', 4, 0, -0.1575],
      ['descend', 27, 0.16, 0],
    ] as const) {
      for (let index = 0; index < count; index++) {
        const result = replayPublicV31FramesWithEvents(current, move(dx, dz))
        expect(result, `${leg} frame ${index + 1} from ${JSON.stringify(current.state.player.position)}`).not.toBeNull()
        current = result!.progress
      }
      if (leg === 'retreat') {
        expect(current.state.player.position.x).toBeLessThan(site.to.x)
        expect(current.state.player.position.y).toBeCloseTo(site.to.y)
      }
      if (leg === 'align') {
        expect(current.state.player.position.z).toBeCloseTo(site.to.z)
        expect(current.state.player.position.y).toBeCloseTo(site.to.y)
      }
    }
    expect(current.state.player.position.x).toBeCloseTo(-412.15)
    expect(current.state.player.position.z).toBeCloseTo(site.from.z)
    expect(current.state.player.position.y).toBeCloseTo(site.from.y)
  })

  it('preserves the exact V28 pose with no lift, then raises only effective dry support', () => {
    const empty = at(4, 0)
    expect(projectPublicV31Pose(empty)).toEqual(projectPublicV28Pose(empty,
      empty.terrain, empty.riverBridgeIds))
    const lifted = { ...empty, raisedSoilCells: [{ gx: 1, gz: 0 }] }
    const base = projectPublicV28Pose(empty, empty.terrain, [])!
    const pose = projectPublicV31Pose(lifted)!
    expect(pose.carrier).toEqual(base.carrier)
    expect(pose.effective.floorY).toBeCloseTo(base.effective.floorY + 0.4)
    expect(pose.effective.position.y).toBeCloseTo(pose.effective.floorY)
    expect(projectPublicV31Pose({ ...lifted, raisedSoilCells: [
      { gx: 1, gz: 0 }, { gx: 1, gz: 0 }] })).toBeNull()
    expect(projectPublicV31Pose({ ...lifted, terrain: { ...lifted.terrain,
      columns: [{ gx: 1, gz: 0, openDepth: 1, rewardDepth: 1, pitLadder: false }] } })).toBeNull()
  })

  it('delegates an empty sidecar to complete V30 replay and retains V28 events', () => {
    const before = at(0, 0), frames = move(0.1, 0)
    const actual = replayPublicV31FramesWithEvents(before, frames)
    const old = replayPublicV30Witness(before, { kind: 'frame-batch/v1', frames })
    const events = replayPublicV28FramesWithEvents(before, frames)?.events
    expect(actual?.progress).toEqual({ ...old, raisedSoilCells: [] })
    expect(actual?.events).toEqual(events)
  })

  it('matches the old V29-to-V28 frame proof for valid, blocked, pick, and forged inputs', () => {
    const base = at(0, 0)
    const ownedPick = { ...base, miningTools: { basicPickOwned: true,
      enchantedPickOwned: false, activePick: 'basic' as const } }
    const swappedHand = { ...ownedPick, state: { ...ownedPick.state,
      player: { ...ownedPick.state.player, equipment: { ...ownedPick.state.player.equipment,
        mainHand: 'woodcutters_axe' as const } } } }
    expect(oldV30Frame(base, move(0.1, 0))).not.toBeNull()
    expect(oldV30Frame(at(12, 5.9), move(0, 0.16))).toBeNull()
    expect(oldV30Frame(ownedPick, move(0.1, 0))?.miningTools.activePick).toBe('basic')
    expect(oldV30Frame(swappedHand, move(0.1, 0))?.miningTools.activePick).toBeNull()
    const cases: [PublicV31Progress, ReturnType<typeof move>][] = [
      [base, move(0.1, 0)],
      [at(12, 5.9), move(0, 0.16)],
      [ownedPick, move(0.1, 0)],
      [swappedHand, move(0.1, 0)],
      [{ ...base, claimedBridgeheadId: 'forged-bridge' }, move(0.1, 0)],
    ]
    for (const [before, frames] of cases) {
      const witness = { kind: 'frame-batch/v1' as const, frames }
      const expected = oldV30Frame(before, frames)
      const actual = replayPublicV30FramesWithEvents(before, witness)
      expect(actual?.progress ?? null).toEqual(expected)
      expect(actual?.events ?? null).toEqual(expected
        ? replayPublicV28FramesWithEvents(before, frames)?.events : null)
      expect(replayPublicV30Witness(before, witness)).toEqual(expected)
      expect(replayPublicV31FramesWithEvents(before, frames)?.progress ?? null)
        .toEqual(expected ? { ...expected, raisedSoilCells: [] } : null)
    }
    expect(replayPublicV30FramesWithEvents(base, { kind: 'frame-batch/v1',
      frames: move(0.1, 0), reward: 'diamond' })).toBeNull()
  })

  it('keeps the empty-soil airborne preview on V28 rather than durable V30 proof', () => {
    const before = at(0, 0)
    const frames = [{ intents: [{ type: 'jump' as const }], walkRequested: false }]
    const observed = replayPublicV28FramesWithEvents(before, frames, true)
    expect(observed).not.toBeNull()
    expect(replayPublicV31FramesWithEvents(before, frames, true)).toEqual({
      progress: { ...observed!.progress, miningTools: before.miningTools,
        claimedBridgeheadId: before.claimedBridgeheadId, raisedSoilCells: [] },
      events: observed!.events,
    })
  })

  it('does not cache a mutable frame witness or return aliases of the caller state', () => {
    const before = at(0, 0), saved = structuredClone(before)
    const witness = { kind: 'frame-batch/v1', frames: move(0.1, 0) }
    const first = replayPublicV30FramesWithEvents(before, witness)
    expect(first).not.toBeNull()
    const returnedPosition = first!.progress.state.player.position as { x: number }
    returnedPosition.x = 999
    expect(before).toEqual(saved)
    witness.frames[0].intents[0].delta.x = 10
    expect(replayPublicV30FramesWithEvents(before, witness)).toBeNull()
    expect(before).toEqual(saved)
  })

  it('keeps the saved far-bank post dry descent playable through V31', () => {
    const farSeed = 'greenway-alpha', { head } = createPublicV23Root(farSeed)
    const bridge = resolvePublicV28RiverBridge(farSeed, 'works6:river-bridge:-43')!
    const point = { x: -170.04, z: 16.68 }
    const surface = resolvePublicV23Surface(head.state, point, [])!
    const old = decodePublicV23Progress({ state: { ...head.state,
      movementOwner: 'streamed',
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(head.state.discoveryMask), ...bridge.footprintTileIds,
        surface.tileId])].sort()),
      player: { ...head.state.player,
        position: { ...point, y: surface.floorY }, verticalVelocity: 0 } },
    greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }, farSeed)
    expect(old).not.toBeNull()
    const before: PublicV31Progress = { ...old!, terrain: emptyPublicV26TerrainLedger(),
      nextHomeAtMs: 0, riverBridgeIds: [bridge.id],
      miningTools: { basicPickOwned: false, enchantedPickOwned: false, activePick: null },
      claimedBridgeheadId: null, raisedSoilCells: [] }
    expect(decodePublicV31ActionProgress(before)).not.toBeNull()
    const claimed = { ...before, claimedBridgeheadId: bridge.id }
    const claimedFrames = move(0.16, 0)
    const checkedClaim = replayPublicV30FramesWithEvents(claimed,
      { kind: 'frame-batch/v1', frames: claimedFrames })
    expect(checkedClaim?.progress).toEqual(oldV30Frame(claimed, claimedFrames))
    expect(checkedClaim?.events).toEqual(replayPublicV28FramesWithEvents(claimed,
      claimedFrames)?.events)
    expect(replayPublicV31FramesWithEvents(claimed, claimedFrames)?.progress)
      .toEqual(checkedClaim ? { ...checkedClaim.progress, raisedSoilCells: [] } : null)
    const hidden = { ...claimed, state: { ...claimed.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(
        claimed.state.discoveryMask).filter((id) => id !== bridge.footprintTileIds[0])) } }
    expect(oldV30Frame(hidden, claimedFrames)).toBeNull()
    expect(replayPublicV30FramesWithEvents(hidden,
      { kind: 'frame-batch/v1', frames: claimedFrames })).toBeNull()
    const stepped = replayPublicV31FramesWithEvents(before, move(0.16, 0))
    expect(stepped?.progress.state.player.position.x).toBeCloseTo(-169.88)
    expect(stepped?.progress.state.player.verticalVelocity).toBe(0)
    expect(stepped?.progress.state.player.position.y).toBeCloseTo(
      resolvePublicV23Surface(head.state, stepped!.progress.state.player.position, [])!.floorY)
    expect(stepped?.events.find((event) => event.type === 'player_moved'))
      .toMatchObject({ position: stepped?.progress.state.player.position })
  })

  it('settles the dry Mireglass approach and nearer 188 m route seam without bypassing V31 replay', () => {
    const farSeed = 'greenway-alpha', { head } = createPublicV23Root(farSeed)
    const bridge = resolvePublicV28RiverBridge(farSeed, 'works6:river-bridge:-44')!
    for (const { point, drop } of [
      { point: { x: -154.08, z: 16 }, drop: 0.0735449 },
      { point: { x: -142.08, z: 120 }, drop: 0.03733 },
    ]) {
      const surface = resolvePublicV23Surface(head.state, point, [])!
      const target = resolvePublicV23Surface(head.state, { x: point.x + 0.16, z: point.z }, [])!
      expect(surface.floorY - target.floorY).toBeCloseTo(drop, 4)
      const old = decodePublicV23Progress({ state: { ...head.state,
        movementOwner: 'streamed',
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(head.state.discoveryMask), ...bridge.footprintTileIds,
          surface.tileId])].sort()),
        player: { ...head.state.player,
          position: { ...point, y: surface.floorY }, verticalVelocity: 0 } },
      greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }, farSeed)
      expect(old).not.toBeNull()
      const before: PublicV31Progress = { ...old!, terrain: emptyPublicV26TerrainLedger(),
        nextHomeAtMs: 0, riverBridgeIds: [bridge.id],
        miningTools: { basicPickOwned: false, enchantedPickOwned: false, activePick: null },
        claimedBridgeheadId: null, raisedSoilCells: [] }
      expect(decodePublicV31ActionProgress(before)).not.toBeNull()
      const stepped = replayPublicV31FramesWithEvents(before, move(0.16, 0))
      expect(stepped?.progress.state.player.position.y).toBe(target.floorY)
      expect(stepped?.progress.state.player.verticalVelocity).toBe(0)
      expect(stepped?.events.find((event) => event.type === 'player_moved'))
        .toMatchObject({ position: stepped?.progress.state.player.position })
      if (point.z === 16) {
        const cell = { gx: Math.ceil((point.x + 0.16) / 4 - 0.5), gz: Math.ceil(point.z / 4 - 0.5) }
        const pit = { ...before, terrain: { ...before.terrain, columns: [
          { ...cell, openDepth: 1, rewardDepth: 1, pitLadder: false }] } }
        expect(replayPublicV31FramesWithEvents(pit, move(0.16, 0))).toBeNull()
        expect(decodePublicV31ActionProgress({ ...pit, raisedSoilCells: [cell] })).toBeNull()
      }
    }
  })

  it('keeps the visible marker-east eight-frame dry descent grounded', () => {
    const farSeed = 'greenway-alpha', { head } = createPublicV23Root(farSeed)
    const point = { x: -87.19, z: 102.02 }
    const surface = resolvePublicV23Surface(head.state, point, [])!
    const old = decodePublicV23Progress({ state: { ...head.state,
      movementOwner: 'streamed',
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(head.state.discoveryMask), surface.tileId])].sort()),
      player: { ...head.state.player,
        position: { ...point, y: surface.floorY }, verticalVelocity: 0 } },
    greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }, farSeed)
    expect(old).not.toBeNull()
    const before: PublicV31Progress = { ...old!, terrain: emptyPublicV26TerrainLedger(),
      nextHomeAtMs: 0, riverBridgeIds: [],
      miningTools: { basicPickOwned: false, enchantedPickOwned: false, activePick: null },
      claimedBridgeheadId: null, raisedSoilCells: [] }
    expect(decodePublicV31ActionProgress(before)).not.toBeNull()
    const frame = move(0.15875, -0.01625)[0]
    let current = before
    for (let index = 0; index < 7; index++) {
      const accepted = replayPublicV31FramesWithEvents(current, [frame])
      expect(accepted, `frame ${index + 1}`).not.toBeNull()
      current = accepted!.progress
    }
    const from = resolvePublicV23Surface(head.state, current.state.player.position, [])!
    const toPoint = { x: current.state.player.position.x + frame.intents[0].delta.x,
      z: current.state.player.position.z + frame.intents[0].delta.z }
    const to = resolvePublicV23Surface(head.state, toPoint, [])!
    expect(from.floorY - to.floorY).toBeCloseTo(0.0834436951067141)
    const crossed = replayPublicV31FramesWithEvents(current, [frame])
    expect(crossed?.progress.state.player.position).toEqual({ ...toPoint, y: to.floorY })
    expect(crossed?.progress.state.player.verticalVelocity).toBe(0)
    expect(crossed?.events.find((event) => event.type === 'player_moved'))
      .toMatchObject({ position: crossed?.progress.state.player.position })
    expect(replayPublicV31FramesWithEvents(before, Array(8).fill(frame))?.progress.state.player)
      .toEqual(crossed?.progress.state.player)
  })

  it('walks onto a single dry lift, but does not turn an ordinary bank into a >0.8 m step', () => {
    const flat = at(1.95, 0)
    const lifted = { ...flat, raisedSoilCells: [{ gx: 1, gz: 0 }] }
    const stepped = replayPublicV31FramesWithEvents(lifted, move(0.1, 0))
    expect(stepped?.progress.state.player.position.x).toBeCloseTo(2.05)
    expect(stepped && projectPublicV31Pose(stepped.progress)?.effective.position.y)
      .toBeCloseTo(projectPublicV31Pose(stepped!.progress)!.effective.floorY)
    const longer = [move(0.1, 0)[0], move(0.1, 0)[0], move(0.1, 0)[0]]
    const walked = replayPublicV31FramesWithEvents(lifted, longer)
    const oldWalk = replayPublicV30Witness(flat, { kind: 'frame-batch/v1', frames: longer })
    expect(walked?.progress.state).toEqual(oldWalk?.state)
    expect(walked?.progress.raisedSoilCells).toEqual(lifted.raisedSoilCells)
    const bank = at(13.95, 4)
    expect(replayPublicV30Witness(bank, { kind: 'frame-batch/v1',
      frames: move(0.1, 0) })).not.toBeNull()
    expect(replayPublicV31FramesWithEvents({ ...bank,
      raisedSoilCells: [{ gx: 4, gz: 1 }] }, move(0.1, 0))).toBeNull()
  })

  it('accepts a structurally valid dry +0.4 m lift without loosening the effective step', () => {
    const base = at(9.95, -16)
    const lifted: PublicV31Progress = { ...base,
      state: { ...base.state, discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask), 'tile-6--1'])].sort()) },
      raisedSoilCells: [{ gx: 3, gz: -4 }] }
    expect(decodePublicV31ActionProgress(lifted)).not.toBeNull()
    const stepped = replayPublicV31FramesWithEvents(lifted, move(0.1, 0))
    expect(stepped?.progress.state.player.position.x).toBeCloseTo(10.05)
    expect(projectPublicV31Pose(stepped!.progress)?.effective.floorY).toBeCloseTo(4.472424100602511)
    expect(projectPublicV31Pose(lifted)?.effective.floorY).toBeCloseTo(3.9436482308921406)
  })

  it('retains inherited river, cliff, and pit rejections with a remote lift', () => {
    for (const [point, delta] of [
      [{ x: 12, z: 5.9 }, { x: 0, z: 0.16 }],
      [{ x: 28, z: -5.95 }, { x: 0, z: -0.1 }],
    ] as const) {
      const before = { ...at(point.x, point.z),
        raisedSoilCells: [{ gx: 1, gz: 0 }] }
      expect(replayPublicV31FramesWithEvents(before, move(delta.x, delta.z))).toBeNull()
    }
    const pit = at(12, -1.95)
    const before = { ...pit, terrain: { ...pit.terrain,
      columns: [{ gx: 3, gz: 0, openDepth: 2, rewardDepth: 2, pitLadder: false }] },
    raisedSoilCells: [{ gx: 1, gz: 0 }] }
    expect(replayPublicV31FramesWithEvents(before, move(0, -0.1))).toBeNull()
  })

  it('keeps a saved Greenway bridge deck at its V28 height and movement gate', () => {
    const base = at(0, 0)
    const site = resolvePublicV17GreenwaySite(seed, 'works3:bridge:1')
    if (!site || site.kind !== 'bridge') throw new Error('Missing bridge fixture')
    const greenwayWorks = { ...base.greenwayWorks, builtBridgeIds: [site.id] }
    const point = { ...site.gapCenter }
    const support = publicV17StarterSupportAt({ seed,
      profile: base.state.generationProfile,
      route: base.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
      built: false, greenwayWorks }, point)
    if (support?.kind !== 'bridge') throw new Error('Missing saved deck support')
    const old = decodePublicV23Progress({ state: { ...base.state,
      player: { ...base.state.player, xp: 80,
        skillXp: { ...base.state.player.skillXp, construction: 80 },
        position: { ...point, y: support.floorY } } },
    greenwayWorks, regionalWorks: base.regionalWorks }, seed)
    if (!old) throw new Error('Invalid built bridge carrier')
    const progress: PublicV31Progress = { ...base, ...old,
      raisedSoilCells: [{ gx: 20, gz: 20 }] }
    expect(projectPublicV31Pose(progress)).toEqual(projectPublicV28Pose(progress,
      progress.terrain, progress.riverBridgeIds))
    const frames = move(0, 0.1)
    const crossed = replayPublicV31FramesWithEvents(progress, frames)
    expect(crossed?.progress.state.player.position.z)
      .toBeCloseTo(point.z + 0.1)
    expect(crossed?.progress.state).toEqual(replayPublicV30Witness(progress,
      { kind: 'frame-batch/v1', frames })?.state)
  })

  it('retains checked Return Home for a trapped pit with remote or adjacent soil', () => {
    const base = at(12, 4)
    const terrain = { ...base.terrain, columns: [
      { gx: 3, gz: 1, openDepth: 8, rewardDepth: 8, pitLadder: false }] }
    const lift = (near: boolean): PublicV31Progress => {
      for (let gx = -8; gx <= 8; gx++) for (let gz = -8; gz <= 8; gz++) {
        const distance = Math.hypot(gx * 4 - 12, gz * 4 - 4)
        if ((distance <= 8) !== near) continue
        const id = `tile-${gx + 3}-${gz + 3}`
        const candidate: PublicV31Progress = { ...base, terrain,
          state: { ...base.state, discoveryMask: encodeDiscoveredTileIds([
            ...new Set([...decodeDiscoveredTileIds(base.state.discoveryMask), id])].sort()) },
          raisedSoilCells: [{ gx, gz }] }
        if (decodePublicV31ActionProgress(candidate)) return candidate
      }
      throw new Error('Missing valid raised-cell fixture')
    }
    const trapped = lift(false)
    const empty = { ...trapped, raisedSoilCells: [] }
    expect(replayPublicV31ReturnHome(empty, 10_000))
      .toEqual({ ...replayPublicV30Witness(empty,
        { kind: 'return-home/v1', atMs: 10_000 }), raisedSoilCells: [] })
    const old = replayPublicV30Witness(trapped,
      { kind: 'return-home/v1', atMs: 10_000 })
    expect(old).not.toBeNull()
    expect(replayPublicV31ReturnHome(trapped, 10_000))
      .toEqual({ ...old, raisedSoilCells: trapped.raisedSoilCells })
    const adjacent = lift(true)
    const oldAdjacent = replayPublicV30Witness(adjacent,
      { kind: 'return-home/v1', atMs: 10_000 })
    expect(oldAdjacent).not.toBeNull()
    expect(replayPublicV31ReturnHome(adjacent, 10_000))
      .toEqual({ ...oldAdjacent, raisedSoilCells: adjacent.raisedSoilCells })
  })

})
