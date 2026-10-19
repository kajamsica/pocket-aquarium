import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { highlandCorridorCells, highlandLandmark } from './highlandContent'
import { highlandWindTrailLocation } from './highlandWindContent'
import { publicV14InsideGreenway } from './publicWorldV14Boundary'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { projectPublicV31Pose } from './publicWorldV31Support'
import type { PublicV36MarkerProgress } from './publicWorldV36MarkerAction'
import { createFreshPublicV36Root, replayPublicV36Witness } from './publicWorldV36Snapshot'
import { previewPublicV37FrameBatch as preview,
  replayPublicV37FrameBatch as replay } from './publicWorldV37Movement'
import { worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const frame = (x = 0, z = 0.16) => ({ intents: [{ type: 'move' as const,
  delta: { x, z } }], walkRequested: true })
const batch = (...frames: ReturnType<typeof frame>[]) => ({ kind: 'frame-batch/v1', frames })
const idle = { intents: [], walkRequested: true }
const airborne = (progress: PublicV36MarkerProgress) => {
  const pose = projectPublicV31Pose(progress)!
  return progress.state.player.verticalVelocity !== 0
    || Math.abs(pose.effective.position.y - pose.effective.floorY) > 1e-6
}

function at(x = 464, z = -431, seed = 'wizard-realms'): PublicV36MarkerProgress {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...base } = createFreshPublicV36Root('wizard-realms').head
  const point = { x, z }, state = seed === 'wizard-realms'
    ? base.state : createPublicV23Root(seed).head.state
  const movementOwner = publicV14InsideGreenway(point) ? 'greenway' : 'streamed'
  const floor = movementOwner === 'greenway'
    ? publicV17StarterSupportAt({ seed, profile: state.generationProfile,
      route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
      built: false, greenwayWorks: base.greenwayWorks }, point)?.floorY
    : resolvePublicV23Surface(state, point, [])?.floorY
  if (floor === undefined) throw new Error('Missing fixture floor')
  const ids = [point, ...highlandCorridorCells()].map((p) => worldTileAtGrid(seed,
    Math.ceil(p.x / 4 - 0.5), Math.ceil(p.z / 4 - 0.5)).id)
  return { ...base, state: { ...state, movementOwner, tick: 100,
    highland: { ...state.highland, landmarkDiscovered: true },
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(state.discoveryMask), ...ids,
      highlandLandmark(seed).tile.id])].sort()),
    windstep: { learned: true, activeUntilTick: 1200, nextCastTick: 1800,
      practicedRouteIndices: [] },
    player: { ...state.player, position: { x, y: floor, z }, xp: 100, level: 2,
      skillXp: { ...state.player.skillXp, spellcraft: 100 } } } }
}

function claimed(): PublicV36MarkerProgress {
  const before = at(465, -431), bridge = resolvePublicV28RiverBridge(seed,
    'works6:river-bridge:-14')!, player = before.state.player
  return { ...before, riverBridgeIds: [bridge.id], claimedBridgeheadId: bridge.id,
    ledgerSurveyBridgeId: bridge.id, ledgerClaimReward: 'coins', markerClaimReward: 'coins',
    state: { ...before.state, eventSequence: before.state.eventSequence + 4,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(before.state.discoveryMask), ...bridge.footprintTileIds])].sort()),
      player: { ...player, xp: 290, level: 3, coins: player.coins + 315,
        skillXp: { ...player.skillXp, construction: 80, wayfinding: 60, spellcraft: 150 },
        inventory: [...player.inventory, { itemId: 'traveler_tunic', quantity: 1 },
          { itemId: 'mireglass_reach/item/waders', quantity: 1 }] } } }
}

describe('V37 checked Windward movement', () => {
  it('observes the exact assisted downhill batch until the same policy can save its landing', () => {
    const before = at(462.18, -428), west = frame(-0.16, 0)
    const first = replay(before, batch(west))!
    expect(first.state.player.position.x).toBeCloseTo(461.98)
    expect(airborne(first)).toBe(false)
    expect(preview(before, batch(west))).toEqual(first)
    const frames = [west, west]
    expect(replay(before, { kind: 'frame-batch/v1', frames })).toBeNull()
    const falling = preview(before, { kind: 'frame-batch/v1', frames })!
    expect(falling.state.player.position.x).toBeCloseTo(461.82)
    expect(falling.state.player.verticalVelocity).toBeLessThan(0)
    expect(airborne(falling)).toBe(true)
    // A landed preview must be the exact durable replay, never a settled-prefix proxy.
    for (let count = 0; count <= 8; count++) {
      const witness = { kind: 'frame-batch/v1', frames: [...frames, ...Array(count).fill(idle)] }
      const strict = replay(before, witness), observed = preview(before, witness)
      expect(observed).not.toBeNull()
      if (strict) expect(observed).toEqual(strict)
      else expect(airborne(observed!)).toBe(true)
    }
    const landedWitness = { kind: 'frame-batch/v1', frames: [...frames, idle] }
    const landed = replay(before, landedWitness)!
    expect(airborne(landed)).toBe(false)
    expect(landed.state.player.position.x).toBeCloseTo(461.82)
    expect(preview(before, landedWitness)).toEqual(landed)
  })

  it('previews canonical fresh jump flight and returns the strict landed result', () => {
    const before = createFreshPublicV36Root(seed).head
    const jump = { intents: [{ type: 'jump' as const }], walkRequested: true }
    const witness = { kind: 'frame-batch/v1', frames: [jump] }
    expect(replay(before, witness)).toBeNull()
    const flying = preview(before, witness)!
    expect(flying.state.player.position.y).toBeCloseTo(1.3431104366667568)
    expect(flying.state.player.verticalVelocity).toBeCloseTo(4.51)
    expect(airborne(flying)).toBe(true)
    const landing = { kind: 'frame-batch/v1', frames: [jump, ...Array(48).fill(idle)] }
    const strict = replay(before, landing)!
    expect(airborne(strict)).toBe(false)
    expect(preview(before, landing)).toEqual(strict)
  })

  it('keeps whole-batch preview and durable replay aligned through the gentle dry descent', () => {
    const before = at(-80.43882791987258, -30.0020115161052, 'greenway-alpha')
    const step = { ...frame(-0.15505746062087306, 0.03946116959501334), walkRequested: false }
    for (const count of [62, 63, 64, 65]) {
      const witness = { kind: 'frame-batch/v1', frames: Array(count).fill(step) }
      const strict = replay(before, witness), observed = preview(before, witness)
      expect(observed, `frame ${count}`).not.toBeNull()
      if (strict) expect(observed).toEqual(strict)
      else expect(airborne(observed!)).toBe(true)
      if (count === 63 || count === 64) {
        expect(strict).toBeNull()
        expect(observed!.state.player.verticalVelocity).toBeLessThan(0)
      }
      if (count === 65) {
        expect(strict?.state.player.position.x).toBeCloseTo(-90.51756286022894)
        expect(airborne(strict!)).toBe(false)
      }
    }
  })

  it.each([false, true])('derives 0.20 m from ordinary 0.16 m input, saved bridge=%s', (built) => {
    const base = at(), bridge = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-14')!
    const before = built ? { ...base, riverBridgeIds: [bridge.id], state: { ...base.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask), ...bridge.footprintTileIds])].sort()),
      player: { ...base.state.player, xp: 180,
        skillXp: { ...base.state.player.skillXp, construction: 80 } } } } : base
    const input = batch(frame()), saved = structuredClone(before)
    expect(replayPublicV36Witness(before, { kind: 'checkpoint' })).not.toBeNull()
    const old = replayPublicV36Witness(before, input), next = replay(before, input)
    expect(old?.state.player.position.z).toBeCloseTo(-430.84)
    expect(next?.state.player.position.z).toBeCloseTo(-430.80)
    expect(next!.state.tick).toBe(before.state.tick + 1)
    expect(next!.state.windstep).toEqual(before.state.windstep)
    expect(before).toEqual(saved)
    expect(input).toEqual(batch(frame()))
  })

  it('keeps the V25 river overlay wet on the historic Highland trail', () => {
    const route = highlandCorridorCells(), wetSeed = 'greenway-alpha'
    const index = route.findIndex((point, i) => i > 21
      && !!publicV25RiverCellAtGrid(wetSeed, point.x / 4, point.z / 4))
    expect(index).toBeGreaterThan(0)
    const point = route[index], previous = route[index - 1], before = at(point.x, point.z, wetSeed)
    const input = batch(frame((previous.x - point.x) * 0.04, (previous.z - point.z) * 0.04))
    expect(replayPublicV36Witness(before, input)).toBeNull()
    expect(replay(before, input)).toBeNull()
  })

  it('keeps V31 effective support and its complete V30 replay with raised soil present', () => {
    const base = at(), before = { ...base, raisedSoilCells: [{ gx: 20, gz: 20 }],
      state: { ...base.state, discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask), 'tile-23-23'])].sort()) } }
    expect(replayPublicV36Witness(before, { kind: 'checkpoint' })).not.toBeNull()
    const next = replay(before, batch(frame(), frame()))
    expect(next?.state.player.position.z).toBeCloseTo(-430.6)
    expect(next?.raisedSoilCells).toEqual(before.raisedSoilCells)
  })

  it('does not boost an airborne movement inside a checked jump and landing batch', () => {
    const before = at(), input = { kind: 'frame-batch/v1', frames: [
      { intents: [{ type: 'jump' }], walkRequested: true }, frame(),
      ...Array.from({ length: 48 }, () => ({ intents: [], walkRequested: true }))] }
    const old = replayPublicV36Witness(before, input)
    expect(old?.state.player.position.z).toBeCloseTo(-430.84)
    expect(old?.state.player.verticalVelocity).toBe(0)
    expect(replay(before, input)).toEqual(old)
  })

  it('retains a boots-enabled run and never compounds the 0.24 m gait', () => {
    const base = at(), before = { ...base, state: { ...base.state, player: {
      ...base.state.player, inventory: [...base.state.player.inventory,
        { itemId: 'leather_boots' as const, quantity: 1 }],
      equipment: { ...base.state.player.equipment, feet: 'leather_boots' as const } } } }
    const input = batch({ ...frame(0, 0.24), walkRequested: false })
    expect(replay(before, input)?.state.player.position.z).toBeCloseTo(-430.76)
    expect(replay(before, input)).toEqual(replayPublicV36Witness(before, input))
    expect(replay(before, batch(frame(0, 0.20)))).toBeNull()
  })

  it('uses ordinary replay off-trail, eastbound, unlearned, expired and undiscovered', () => {
    const active = at(), cooldown = { ...active, state: { ...active.state, tick: 1200 } }
    const unlearned = { ...active, state: { ...active.state, windstep: {
      learned: false, activeUntilTick: 0, nextCastTick: 0, practicedRouteIndices: [] } } }
    const hidden = at(464, -430.1)
    const targetId = worldTileAtGrid(seed, 116, -107).id
    const undiscovered = { ...hidden, state: { ...hidden.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(hidden.state.discoveryMask)
        .filter((id) => id !== targetId)) } }
    for (const [index, [before, input]] of ([[at(465, -431), batch(frame())],
      [active, batch(frame(0, -0.16))], [unlearned, batch(frame())],
      [cooldown, batch(frame())], [undiscovered, batch(frame())],
      [at(464, -428.1), batch(frame())]] as const).entries()) {
      const old = replayPublicV36Witness(before, input)
      expect(old, `ordinary fixture ${index}`).not.toBeNull()
      expect(replay(before, input)).toEqual(old)
    }
    const crossingExpiry = { ...active, state: { ...active.state, tick: 1199 } }
    expect(replay(crossingExpiry, batch(frame(), frame()))?.state.player.position.z)
      .toBeCloseTo(-430.64)
  })

  it('rejects airborne ingress and forged or oversized witness input without mutation', () => {
    const before = at(), saved = structuredClone(before)
    expect(replay({ ...before, state: { ...before.state, player: {
      ...before.state.player, verticalVelocity: 1 } } }, batch(frame()))).toBeNull()
    for (const bad of [batch(frame(0, 0.20)), batch(frame(0, 0.241)),
      { ...batch(frame()), assisted: true }, batch({ ...frame(), boost: 1.25 } as never),
      batch({ ...frame(), intents: [...frame().intents, ...frame().intents] } as never),
      new Proxy(batch(frame()), {})]) {
      expect(replay(before, bad)).toBeNull()
      expect(preview(before, bad)).toBeNull()
    }
    expect(before).toEqual(saved)
  })

  it('keeps later-version overlays out of checked movement and rejects forged marker facts', () => {
    const before = at(), input = batch(frame())
    const withOverlay = { ...before, laterVersionOverlay: { active: true } }
    expect(replay(withOverlay, input))
      .toEqual(replay(before, input))
    expect(replay({ ...before, regionalWorks: { builtLadderIds: ['forged'] } }, input))
      .toBeNull()
    expect(replay({ ...before, markerClaimReward: 'coins' }, input)).toBeNull()
    expect(preview({ ...before, markerClaimReward: 'coins' }, input)).toBeNull()
  })

  it('rejects a forged surveyed bridge ID in otherwise claimed progress', () => {
    const before = claimed(), input = batch(frame())
    expect(replay(before, input)).not.toBeNull()
    expect(replay({ ...before, ledgerSurveyBridgeId: 'forged' }, input)).toBeNull()
    expect(preview({ ...before, ledgerSurveyBridgeId: 'forged' }, input)).toBeNull()
  })

  it('keeps ordinary movement replay after ledger and marker claims', () => {
    const before = claimed(), input = batch(frame())
    const moved = replay(before, input)
    expect(moved).not.toBeNull()
    expect(moved).toEqual(replayPublicV36Witness(before, input))
    expect(moved).toMatchObject({ ledgerSurveyBridgeId: before.ledgerSurveyBridgeId,
      ledgerClaimReward: before.ledgerClaimReward, markerClaimReward: before.markerClaimReward })
  })

  it('keeps river, rim, pit and raised-soil gates when the spell is active', () => {
    for (const [before, input] of [
      [at(12, 5.9), batch(frame())],
      [at(28, -5.95), batch(frame(0, -0.1))],
      [{ ...at(12, -1.95), terrain: { ...at().terrain,
        columns: [{ gx: 3, gz: 0, openDepth: 2, rewardDepth: 2, pitLadder: false }] } },
      batch(frame(0, -0.1))],
      [{ ...at(13.95, 4), raisedSoilCells: [{ gx: 4, gz: 1 }] }, batch(frame(0.1, 0))],
    ] as const) {
      expect(replayPublicV36Witness(before, input)).toBeNull()
      expect(replay(before, input)).toBeNull()
    }
  })

  it('awards one XP on the fourth unique crossed segment and never pays a repeated crossing', () => {
    const before = at(464, -428.2), start = highlandWindTrailLocation(before.state.player.position)!
    const arrival = highlandWindTrailLocation({ x: 464, z: -428 })!
    expect(arrival.segmentIndex).toBeLessThan(start.segmentIndex)
    const practiced = [arrival.segmentIndex + 1, arrival.segmentIndex + 2, arrival.segmentIndex + 3]
    const ready = { ...before, state: { ...before.state, windstep: {
      ...before.state.windstep, practicedRouteIndices: practiced } } }
    const earned = replay(ready, batch(frame(), frame()))
    expect(earned?.state.windstep.practicedRouteIndices).toEqual([arrival.segmentIndex, ...practiced])
    expect(earned?.state.player.xp).toBe(before.state.player.xp + 1)
    expect(earned?.state.player.skillXp.spellcraft).toBe(before.state.player.skillXp.spellcraft + 1)
    const first = replay(ready, batch(frame()))!
    expect(replay(first, batch(frame()))).toEqual(earned)
    const again = { ...ready, state: { ...ready.state, player: earned!.state.player,
      windstep: earned!.state.windstep } }
    const returned = { ...again, state: { ...again.state, player: {
      ...again.state.player, position: before.state.player.position } } }
    expect(replay(returned, batch(frame()))?.state.player.xp).toBe(earned!.state.player.xp)
  })
})
