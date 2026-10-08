import { describe, expect, it } from 'vitest'
import { highlandCorridorCells, highlandLandmark } from './highlandContent'
import { HIGHLAND_WINDWARD_STEP, highlandWindTrailLocation } from './highlandWindContent'
import { mireglassFenRowAt } from './mireglassTerrain'
import { actPublicV12Windstep, advancePublicWorldV12Frame } from './publicWorldV12Authority'
import { createFreshPublicWorld } from './publicWorldState'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { withPublicV11Highland } from './publicWorldV11State'
import { isValidPublicWorldV12State, withPublicV12Windstep } from './publicWorldV12State'
import type { PublicWorldV12State } from './publicWorldV12State'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const route = highlandCorridorCells()
const fresh = withPublicV12Windstep(withPublicV11Highland(withPublicV10TerrainRevision(
  withFreshPublicV9Camps(withFreshPublicV7Herbs(
    createFreshPublicWorld(seed, 'greenway-classic-v1'))))))
const gridAt = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)

function at(point: { x: number; z: number }, source: PublicWorldV12State = fresh): PublicWorldV12State {
  const tile = worldTileAtGrid(source.seed, gridAt(point.x), gridAt(point.z))
  return { ...source, movementOwner: 'streamed',
    player: { ...source.player, position: { x: point.x, y: tile.center.y, z: point.z },
      verticalVelocity: 0 },
    discoveredTileIds: [...new Set([...source.discoveredTileIds, tile.id])].sort() }
}

function learnedAt(point: { x: number; z: number }): PublicWorldV12State {
  const located = at(point)
  return { ...located, highland: { ...located.highland, landmarkDiscovered: true },
    windstep: { ...located.windstep, learned: true } }
}

function castAt(point: { x: number; z: number }): PublicWorldV12State {
  const learned = learnedAt(point)
  expect(isValidPublicWorldV12State(learned, null)).toBe(true)
  const cast = actPublicV12Windstep(learned, { type: 'cast_windward_step' })
  expect(cast.rejection).toBeUndefined()
  return cast.state
}

const west = (from: { x: number; z: number }, to: { x: number; z: number }, length = 0.16) => {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const distance = Math.hypot(dx, dz)
  return { type: 'move' as const, delta: { x: dx / distance * length, z: dz / distance * length } }
}

describe('public v12 Windward Step authority', () => {
  it('studies the canonical Quarry Crown glyph only after on-foot discovery and 3D reach', () => {
    const glyph = highlandLandmark(seed)
    const ready = at(glyph.tile.center)
    const hidden = actPublicV12Windstep(ready, { type: 'study_windward_glyph' })
    expect(hidden).toMatchObject({ state: ready, rejection: { code: 'undiscovered' } })
    expect(hidden.state).toBe(ready)
    const discovered = { ...ready, highland: { ...ready.highland, landmarkDiscovered: true } }
    const original = JSON.stringify(discovered)
    const studied = actPublicV12Windstep(discovered, { type: 'study_windward_glyph' })
    expect(studied.rejection).toBeUndefined()
    expect(studied.event).toMatchObject({ type: 'windward_glyph_studied',
      landmarkId: glyph.id, spellId: 'windward_step', tick: discovered.tick,
      sequence: discovered.eventSequence + 1 })
    expect(studied.state.tick).toBe(discovered.tick)
    expect(studied.state.windstep.learned).toBe(true)
    expect(studied.state.player.learnedSpellIds).toEqual(discovered.player.learnedSpellIds)
    expect(isValidPublicWorldV12State(studied.state, null)).toBe(true)
    expect(JSON.stringify(discovered)).toBe(original)
    expect(Object.isFrozen(studied.state.player.position)).toBe(true)
    const duplicate = actPublicV12Windstep(studied.state, { type: 'study_windward_glyph' })
    expect(duplicate.rejection?.code).toBe('already_learned')
    expect(duplicate.state).toBe(studied.state)
    expect(duplicate.event).toBeUndefined()

    const distant = at({ x: glyph.tile.center.x - 4, z: glyph.tile.center.z }, discovered)
    expect(actPublicV12Windstep(distant, { type: 'study_windward_glyph' }).rejection?.code).toBe('too_far')
    const airborne = { ...discovered, player: { ...discovered.player,
      position: { ...discovered.player.position, y: glyph.tile.center.y + 2 }, verticalVelocity: 1 } }
    expect(isValidPublicWorldV12State(airborne, null)).toBe(true)
    expect(actPublicV12Windstep(airborne, { type: 'study_windward_glyph' }).rejection?.code).toBe('not_on_foot')
    const greenway = { ...discovered, movementOwner: 'greenway' as const }
    expect(actPublicV12Windstep(greenway, { type: 'study_windward_glyph' }).state).toBe(greenway)
  })

  it('casts only when learned, grounded, dry and canonical, with exact clock and cooldown', () => {
    const point = route[110]
    const unlearned = at(point)
    expect(actPublicV12Windstep(unlearned, { type: 'cast_windward_step' }).rejection?.code)
      .toBe('not_learned')
    const learned = learnedAt(point)
    const cast = actPublicV12Windstep(learned, { type: 'cast_windward_step' })
    expect(cast.rejection).toBeUndefined()
    expect(cast.event).toMatchObject({ type: 'windward_step_cast', spellId: 'windward_step',
      tick: learned.tick, sequence: learned.eventSequence + 1,
      activeUntilTick: HIGHLAND_WINDWARD_STEP.durationTicks,
      nextCastTick: HIGHLAND_WINDWARD_STEP.cooldownTicks })
    expect(cast.state.tick).toBe(learned.tick)
    expect(cast.state.player.xp).toBe(learned.player.xp)
    const early = actPublicV12Windstep(cast.state, { type: 'cast_windward_step' })
    expect(early.rejection?.code).toBe('cooldown')
    expect(early.state).toBe(cast.state)
    const ready = { ...cast.state, tick: HIGHLAND_WINDWARD_STEP.cooldownTicks }
    expect(isValidPublicWorldV12State(ready, null)).toBe(true)
    const recast = actPublicV12Windstep(ready, { type: 'cast_windward_step' })
    expect(recast.rejection).toBeUndefined()
    expect(recast.state.windstep.activeUntilTick).toBe(3000)
    expect(recast.state.windstep.nextCastTick).toBe(3600)
    const offTrail = at({ x: point.x, z: point.z + 2 }, learned)
    expect(actPublicV12Windstep(offTrail, { type: 'cast_windward_step' }).rejection?.code)
      .toBe('not_on_trail')
    const nearMax = { ...learned, tick: Number.MAX_SAFE_INTEGER - 1799 }
    expect(isValidPublicWorldV12State(nearMax, null)).toBe(true)
    expect(actPublicV12Windstep(nearMax, { type: 'cast_windward_step' }).rejection?.code)
      .toBe('invalid_value')
  })

  it('boosts only a normal sampled westbound move on the dry trail, never an east move', () => {
    const point = { x: 100, z: 0 }
    const active = castAt(point)
    const normal = { ...active, windstep: { ...active.windstep,
      activeUntilTick: 0, nextCastTick: 0 } }
    expect(isValidPublicWorldV12State(normal, null)).toBe(true)
    const intent = [{ type: 'move' as const, delta: { x: -0.16, z: 0 } }]
    const ordinary = advancePublicWorldV12Frame(normal, intent)
    const assisted = advancePublicWorldV12Frame(active, intent)
    expect(ordinary.rejections).toEqual([])
    expect(assisted.rejections).toEqual([])
    expect(point.x - ordinary.state.player.position.x).toBeCloseTo(0.16, 9)
    expect(point.x - assisted.state.player.position.x).toBeCloseTo(0.20, 9)
    expect(assisted.state.tick).toBe(active.tick + 1)
    expect(assisted.state.eventSequence).toBe(active.eventSequence + assisted.events.length)
    expect(assisted.state.player.xp).toBe(active.player.xp)
    expect(assisted.state.windstep.practicedRouteIndices).toEqual([])
    expect(isValidPublicWorldV12State(assisted.state, null)).toBe(true)
    const lookAndMove = advancePublicWorldV12Frame(active,
      [{ type: 'look', yawDelta: 0.1, pitchDelta: 0 }, intent[0]])
    expect(lookAndMove.rejections).toEqual([])
    expect(lookAndMove.state.tick).toBe(active.tick + 1)
    expect(lookAndMove.state.eventSequence - active.eventSequence).toBe(lookAndMove.events.length)
    expect(point.x - lookAndMove.state.player.position.x).toBeCloseTo(0.20, 9)
    const east = advancePublicWorldV12Frame(active,
      [{ type: 'move', delta: { x: 0.16, z: 0 } }])
    expect(east.rejections).toEqual([])
    expect(east.state.player.position.x - point.x).toBeCloseTo(0.16, 9)
    const long = advancePublicWorldV12Frame(active,
      [{ type: 'move', delta: { x: -4, z: 0 } }])
    expect(long.rejections).toEqual([])
    expect(point.x - long.state.player.position.x).toBeCloseTo(4, 9)
  })

  it('does not assist connector, trail edge, expiry, airborne or off-trail movement', () => {
    const active = castAt({ x: 100, z: 0 })
    const edge = at({ x: 96, z: 0 }, active)
    const expired = { ...active, tick: active.windstep.activeUntilTick }
    const airborne = { ...active, player: { ...active.player,
      position: { ...active.player.position, y: active.player.position.y + 1 },
      verticalVelocity: 1 } }
    const offTrail = at({ x: 100, z: 1 }, active)
    for (const [state, delta] of [
      [edge, { x: -0.16, z: 0 }],
      [expired, { x: -0.16, z: 0 }],
      [airborne, { x: -0.16, z: 0 }],
      [offTrail, { x: -0.16, z: 0 }],
    ] as const) {
      expect(isValidPublicWorldV12State(state, null)).toBe(true)
      const frame = advancePublicWorldV12Frame(state, [{ type: 'move', delta }])
      if (!frame.rejections.length) {
        expect(state.player.position.x - frame.state.player.position.x).toBeCloseTo(0.16, 9)
        expect(frame.state.windstep.practicedRouteIndices).toEqual([])
      } else {
        expect(frame.state).toBe(state)
      }
    }
    const nearEdge = at({ x: 96.02, z: 0 }, active)
    const edgeFrame = advancePublicWorldV12Frame(nearEdge,
      [{ type: 'move', delta: { x: -0.16, z: 0 } }])
    expect(edgeFrame.state.player.position.x - nearEdge.player.position.x).toBeCloseTo(-0.16, 9)
    const atLastActiveTick = { ...active, tick: HIGHLAND_WINDWARD_STEP.durationTicks - 1 }
    const lastBoost = advancePublicWorldV12Frame(atLastActiveTick,
      [{ type: 'move', delta: { x: -0.16, z: 0 } }])
    expect(pointDistance(lastBoost.state.player.position, atLastActiveTick.player.position))
      .toBeCloseTo(0.20, 9)
    expect(lastBoost.state.tick).toBe(HIGHLAND_WINDWARD_STEP.durationTicks)
  })

  it('permits an exact authored bend arrival but never boosts an old-tangent overshoot', () => {
    const index = route.findIndex((point, candidate) => candidate > 22
      && candidate < route.length - 1
      && (point.x - route[candidate - 1].x !== route[candidate + 1].x - point.x
        || point.z - route[candidate - 1].z !== route[candidate + 1].z - point.z))
    expect(index).toBeGreaterThan(22)
    const vertex = route[index]
    const east = route[index + 1]
    const near = (fraction: number) => ({ x: vertex.x + (east.x - vertex.x) * fraction,
      z: vertex.z + (east.z - vertex.z) * fraction })
    const exact = castAt(near(0.05))
    const accepted = advancePublicWorldV12Frame(exact, [west(east, vertex)])
    expect(accepted.rejections).toEqual([])
    expect(pointDistance(accepted.state.player.position, exact.player.position)).toBeCloseTo(0.20, 9)
    expect(accepted.state.player.position.x).toBeCloseTo(vertex.x, 9)
    expect(accepted.state.player.position.z).toBeCloseTo(vertex.z, 9)
    expect(accepted.state.windstep.practicedRouteIndices).toEqual([index - 1])
    const tooNear = castAt(near(0.0375))
    const overshoot = advancePublicWorldV12Frame(tooNear, [west(east, vertex)])
    expect(overshoot.rejections).toEqual([])
    expect(pointDistance(overshoot.state.player.position, tooNear.player.position))
      .toBeCloseTo(0.16, 9)
    expect(overshoot.state.windstep.practicedRouteIndices).toEqual([])
  })

  it('records only new realized westbound segments and one Spellcraft XP per four', () => {
    let state = castAt(route[106])
    const firstTick = state.tick
    const firstXp = state.player.xp
    const firstSkill = state.player.skillXp.spellcraft
    const awards: number[] = []
    for (let index = 105; index > 101; index -= 1) {
      const vertex = route[index]
      const from = route[index + 1]
      // A grounded, reachable pose 0.20 m before each authored corner. The
      // complete return journey is exercised separately by the UI gate.
      const near = { x: vertex.x + (from.x - vertex.x) * 0.05,
        z: vertex.z + (from.z - vertex.z) * 0.05 }
      const positioned = at(near, state)
      expect(isValidPublicWorldV12State(positioned, null)).toBe(true)
      const frame = advancePublicWorldV12Frame(positioned, [west(from, vertex)])
      expect(frame.rejections, `corner ${index}`).toEqual([])
      expect(frame.state.tick).toBe(positioned.tick + 1)
      expect(frame.state.eventSequence - positioned.eventSequence).toBe(frame.events.length)
      expect(frame.state.player.position.x).toBeCloseTo(vertex.x, 9)
      expect(frame.state.player.position.z).toBeCloseTo(vertex.z, 9)
      for (const event of frame.events) {
        if (event.type === 'windward_step_practiced') awards.push(event.segmentIndex)
      }
      state = frame.state
    }
    expect(state.windstep.practicedRouteIndices).toEqual([101, 102, 103, 104])
    expect(state.tick).toBe(firstTick + 4)
    expect(awards).toEqual([state.windstep.practicedRouteIndices[0]])
    expect(state.player.xp).toBe(firstXp + 1)
    expect(state.player.skillXp.spellcraft).toBe(firstSkill + 1)
    expect(state.eventSequence).toBeGreaterThan(firstTick)
    expect(isValidPublicWorldV12State(state, null)).toBe(true)
    const repeat = advancePublicWorldV12Frame(state, [west(route[101], route[102])])
    expect(repeat.rejections).toEqual([])
    expect(repeat.state.windstep.practicedRouteIndices).toEqual(state.windstep.practicedRouteIndices)
    expect(repeat.events.some((event) => event.type === 'windward_step_practiced')).toBe(false)
  }, 30_000)

  it('keeps the bounded 226-segment ledger below 57 Spellcraft awards', () => {
    const vertex = route[22]
    const from = route[23]
    const near = { x: vertex.x + (from.x - vertex.x) * 0.05,
      z: vertex.z + (from.z - vertex.z) * 0.05 }
    const active = castAt(near)
    const prior = Array.from({ length: 225 }, (_, index) => index + 22)
    const saturated = { ...active, windstep: { ...active.windstep,
      practicedRouteIndices: prior } }
    expect(isValidPublicWorldV12State(saturated, null)).toBe(true)
    const frame = advancePublicWorldV12Frame(saturated, [west(from, vertex)])
    expect(frame.rejections).toEqual([])
    expect(frame.state.windstep.practicedRouteIndices).toHaveLength(226)
    expect(frame.state.windstep.practicedRouteIndices[0]).toBe(21)
    expect(frame.events.some((event) => event.type === 'windward_step_practiced')).toBe(false)
    expect(frame.state.player.skillXp.spellcraft).toBe(saturated.player.skillXp.spellcraft)
    expect(isValidPublicWorldV12State(frame.state, null)).toBe(true)
  })

  it('rejects an overflowing fourth practice award atomically, including movement', () => {
    const index = 106
    const from = route[index]
    const to = route[index - 1]
    const near = { x: to.x + (from.x - to.x) * 0.05,
      z: to.z + (from.z - to.z) * 0.05 }
    const ready = castAt(near)
    const prior = highlandWindTrailLocation(near)!
    expect(prior.segmentIndex).toBe(index - 1)
    const due = { ...ready, player: { ...ready.player, xp: Number.MAX_SAFE_INTEGER,
      level: 1 + Math.floor(Number.MAX_SAFE_INTEGER / 100),
      skillXp: { ...ready.player.skillXp, spellcraft: Number.MAX_SAFE_INTEGER } },
    windstep: { ...ready.windstep, practicedRouteIndices: [22, 23, 24] } }
    expect(isValidPublicWorldV12State(due, null)).toBe(true)
    const before = JSON.stringify(due)
    const frame = advancePublicWorldV12Frame(due, [west(from, to)])
    expect(frame.rejections).toMatchObject([{ code: 'invalid_value' }])
    expect(frame.state).toBe(due)
    expect(frame.events).toEqual([])
    expect(JSON.stringify(due)).toBe(before)
  })

  it('keeps malformed inputs, invalid frames and failed moves identity-preserving', () => {
    const state = castAt({ x: 100, z: 0 })
    for (const action of [
      { type: 'cast_windward_step', xp: 999 },
      { type: 'cast_windward_step', speed: 10 },
      { type: 'study_windward_glyph', routeIndex: 22 },
      { type: 'unknown' },
    ]) {
      const result = actPublicV12Windstep(state, action as never)
      expect(result.rejection?.code).toBe('invalid_value')
      expect(result.state).toBe(state)
      expect(result.event).toBeUndefined()
    }
    const malformed = { ...state, windContentRevision: 'wrong' } as unknown as PublicWorldV12State
    const invalid = advancePublicWorldV12Frame(malformed,
      [{ type: 'move', delta: { x: -0.16, z: 0 } }])
    expect(invalid.state).toBe(malformed)
    expect(invalid.rejections).toMatchObject([{ code: 'invalid_value' }])
    const invalidMove = advancePublicWorldV12Frame(state,
      [{ type: 'move', delta: { x: NaN, z: 0 } }])
    expect(invalidMove.state).toBe(state)
    expect(invalidMove.events).toEqual([])
    expect(invalidMove.rejections).toMatchObject([{ code: 'invalid_value' }])
    const fenRow = mireglassFenRowAt(seed, -352)
    const fenApproach = at({ x: -352, z: fenRow - 4 }, state)
    const blocked = advancePublicWorldV12Frame(fenApproach,
      [{ type: 'move', delta: { x: 0, z: 4 } }])
    expect(blocked.rejections).toMatchObject([{ code: 'fen_channel' }])
    expect(blocked.state).toBe(fenApproach)
    expect(blocked.events).toEqual([])
    const badComposite = advancePublicWorldV12Frame(state,
      [{ type: 'move', delta: { x: -0.16, z: 0 } },
        { type: 'look', yawDelta: 0, pitchDelta: 0 }])
    expect(badComposite.state).toBe(state)
    expect(badComposite.events).toEqual([])
    expect(badComposite.rejections).toMatchObject([{ code: 'invalid_frame' }])
    for (const incompatible of [
      [{ type: 'jump' as const }, { type: 'move' as const, delta: { x: -0.16, z: 0 } }],
      [{ type: 'move' as const, delta: { x: -0.16, z: 0 } },
        { type: 'move' as const, delta: { x: -0.16, z: 0 } }],
    ]) {
      const result = advancePublicWorldV12Frame(state, incompatible)
      expect(result.state).toBe(state)
      expect(result.events).toEqual([])
      expect(result.rejections).toMatchObject([{ code: 'invalid_frame' }])
    }
  })

  it('detaches a mutable caller state before reading a move getter and freezes accepted outputs', () => {
    const source = castAt({ x: 100, z: 0 })
    const mutable = structuredClone(source)
    let reads = 0
    const delta = { z: 0 } as { x: number; z: number }
    Object.defineProperty(delta, 'x', { enumerable: true, get() {
      reads += 1
      mutable.player.position.x = 500
      return -0.16
    } })
    const result = advancePublicWorldV12Frame(mutable, [{ type: 'move', delta }])
    expect(result.rejections).toEqual([])
    expect(reads).toBe(1)
    expect(result.state.player.position.x).toBeCloseTo(99.8, 9)
    expect(Object.isFrozen(result.state)).toBe(true)
    expect(Object.isFrozen(result.state.windstep.practicedRouteIndices)).toBe(true)
    expect(isValidPublicWorldV12State(result.state, null)).toBe(true)
  })

  it('samples the bounded frozen fast path on 128 accepted return frames', () => {
    let state = castAt(route[120])
    let index = 120
    const times: number[] = []
    for (let frameIndex = 0; frameIndex < 128; frameIndex += 1) {
      const target = route[index - 1]
      const remaining = pointDistance(state.player.position, target)
      const intent = west(state.player.position, target, Math.min(0.16, remaining))
      const started = performance.now()
      const frame = advancePublicWorldV12Frame(state, [intent])
      times.push(performance.now() - started)
      expect(frame.rejections).toEqual([])
      state = frame.state
      if (pointDistance(state.player.position, target) <= 1e-6) index -= 1
    }
    times.sort((a, b) => a - b)
    expect(times[121]).toBeLessThan(50)
    expect(state.tick).toBe(128)
  }, 30_000)
})

function pointDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}
