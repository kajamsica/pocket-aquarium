import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { highlandCorridorCells, highlandLandmark } from './highlandContent'
import { HIGHLAND_SIGNAL_BEARING, highlandSignalVane } from './highlandSignalContent'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV25RiverTouchesSegment } from './publicWorldV25RiverSweep'
import { publicV26ValleyRimPassage } from './publicWorldV26ValleyRim'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { createFreshPublicV36Root } from './publicWorldV36Snapshot'
import { previewPublicV37FrameBatch, replayPublicV37FrameBatch } from './publicWorldV37Movement'
import { confirmPublicV38SignalAction as confirm, decodePublicV38SignalWitness as decode,
  previewPublicV38SignalAction as preview } from './publicWorldV38SignalAction'
import type { PublicV38SignalProgress } from './publicWorldV38SignalAction'
import { worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms', vane = highlandSignalVane(seed)
const inspect = { kind: 'signal-vantage/v1' as const }
const claim = { kind: 'signal-claim/v1' as const }
const route = highlandCorridorCells()

function at(x: number, z: number, learned = true,
  revealedVane = true): PublicV38SignalProgress {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...base } = createFreshPublicV36Root(seed).head
  const floor = resolvePublicV23Surface(base.state, { x, z }, [])?.floorY
  if (floor === undefined) throw new Error('Missing authored Highland floor')
  const ids = route.map((point) => worldTileAtGrid(seed, point.x / 4, point.z / 4).id)
    .filter((id) => revealedVane || id !== vane.tile.id)
  const discovered = encodeDiscoveredTileIds([...new Set([
    ...decodeDiscoveredTileIds(base.state.discoveryMask), ...ids,
    highlandLandmark(seed).tile.id])].sort())
  return { ...base, signalVantageInspected: false, signalClaimed: false,
    state: { ...base.state, movementOwner: 'streamed', tick: 100,
      highland: { ...base.state.highland, landmarkDiscovered: true },
      discoveryMask: discovered,
      windstep: { learned, activeUntilTick: learned ? 1200 : 0,
        nextCastTick: learned ? 1800 : 0, practicedRouteIndices: [] },
      player: { ...base.state.player, position: { x, y: floor, z },
        xp: 100, level: 2, skillXp: { ...base.state.player.skillXp, spellcraft: 100 } } } }
}

/** The practice fact comes from V37's accepted physical replay, not a client flag. */
function practiced(): PublicV38SignalProgress {
  const before = at(512.2, -472)
  const moved = replayPublicV37FrameBatch(before, { kind: 'frame-batch/v1',
    frames: [{ intents: [{ type: 'move', delta: { x: -0.16, z: 0 } }], walkRequested: true }] })
  if (!moved) throw new Error('Canonical assisted crossing was not accepted')
  expect(moved.state.windstep.practicedRouteIndices).toEqual([242])
  return { ...moved, signalVantageInspected: false, signalClaimed: false }
}

function relocate(progress: PublicV38SignalProgress, x: number,
  z: number): PublicV38SignalProgress {
  const floor = resolvePublicV23Surface(progress.state, { x, z }, [])?.floorY
  if (floor === undefined) throw new Error('Missing destination floor')
  return { ...progress, state: { ...progress.state, player: { ...progress.state.player,
    position: { x, y: floor, z } } } }
}

describe('V38 checked Highland Signal action', () => {
  it('pins a dry, grounded and traversable vane on the authored route', () => {
    expect(vane.routeIndex).toBe(243)
    expect(vane.routeCell).toEqual({ x: 512, z: -472 })
    expect(route[vane.routeIndex]).toEqual(vane.routeCell)
    expect(vane.tile.terrain).toBe('rocky')
    expect(HIGHLAND_SIGNAL_BEARING).toEqual({ x: 540, z: -500,
      label: 'Stormline Foothill' })
    const pose = projectPublicV31Pose(at(512, -472))
    expect(pose?.support).toBe('terrain')
    expect(pose?.effective.position.y).toBeCloseTo(pose!.effective.floorY)
    expect(publicV25RiverTouchesSegment(seed, route[243], route[244])).toBe(false)
    expect(publicV26ValleyRimPassage(seed, route[243], route[244], []).ok).toBe(true)
  })

  it('decodes only payload-free, cloneable witnesses and leaves rejections unchanged', () => {
    const ready = practiced(), saved = structuredClone(ready)
    expect(decode(inspect)).toEqual(inspect)
    expect(decode(claim)).toEqual(claim)
    for (const bad of [null, { kind: 'other' }, { kind: 'signal-vantage/v1', x: 512 },
      { kind: 'signal-claim/v1', reward: 300 }, new Proxy(inspect, {}),
      Object.create({ kind: inspect.kind }),
      Object.defineProperty({}, 'kind', { get: () => inspect.kind, enumerable: true })]) {
      expect(decode(bad)).toBeNull()
      expect(confirm(ready, bad)).toEqual({ rejection: 'invalid_value' })
    }
    expect(ready).toEqual(saved)
  })

  it('rejects missing discovery, reveal, learning, active cast and credited approach', () => {
    const ready = practiced()
    const beforeDiscovery = at(512, -472, false)
    expect(confirm({ ...beforeDiscovery, state: { ...beforeDiscovery.state,
      highland: { ...beforeDiscovery.state.highland, landmarkDiscovered: false } } }, inspect).rejection)
      .toBe('undiscovered')
    expect(confirm(at(512, -469.9, true, false), inspect).rejection).toBe('unrevealed')
    expect(confirm(at(512, -472, false), inspect).rejection).toBe('not_learned')
    expect(confirm({ ...ready, state: { ...ready.state, tick: 1200 } }, inspect).rejection)
      .toBe('not_active')
    expect(confirm(at(512, -472), inspect).rejection).toBe('not_practiced')
    expect(confirm(relocate(ready, 464, -432), inspect).rejection).toBe('too_far')
  })

  it('rejects airborne preview, remote claim and repeated witnesses', () => {
    const ready = practiced()
    const flying = previewPublicV37FrameBatch(ready, { kind: 'frame-batch/v1',
      frames: [{ intents: [{ type: 'jump' }], walkRequested: true }] })
    expect(flying?.state.player.verticalVelocity).toBeGreaterThan(0)
    expect(confirm({ ...flying!, signalVantageInspected: false,
      signalClaimed: false }, inspect).progress).toBeUndefined()
    const inspected = confirm(ready, inspect).progress!
    expect(confirm(inspected, inspect).rejection).toBe('already_inspected')
    expect(confirm(inspected, claim).rejection).toBe('too_far')
    expect(confirm(ready, claim).rejection).toBe('requires_vantage')
  })

  it('pays exactly once at Crown, with one event and no changed equipment', () => {
    const ready = practiced()
    expect(preview(ready, inspect)).toEqual({ rejection: null })
    const inspected = confirm(ready, inspect).progress!
    expect(inspected.signalVantageInspected).toBe(true)
    expect(inspected.signalClaimed).toBe(false)
    expect(inspected.state.eventSequence).toBe(ready.state.eventSequence + 1)
    const atCrown = relocate(inspected, 464, -432)
    expect(preview(atCrown, claim)).toEqual({ rejection: null })
    const paid = confirm(atCrown, claim).progress!
    expect(paid.signalClaimed).toBe(true)
    expect(paid.state.eventSequence).toBe(atCrown.state.eventSequence + 1)
    expect(paid.state.player).toMatchObject({ coins: atCrown.state.player.coins + 30,
      xp: atCrown.state.player.xp + 35,
      level: 1 + Math.floor((atCrown.state.player.xp + 35) / 100) })
    expect(paid.state.player.skillXp.spellcraft).toBe(atCrown.state.player.skillXp.spellcraft + 35)
    expect(paid.state.player.inventory).toEqual(atCrown.state.player.inventory)
    expect(paid.state.player.equipment).toEqual(atCrown.state.player.equipment)
    expect(confirm(paid, claim).rejection).toBe('already_claimed')
    expect(ready.signalVantageInspected).toBe(false)
  })

  it('refuses invalid flags and unsafe reward arithmetic', () => {
    const ready = practiced(), inspected = confirm(ready, inspect).progress!
    const atCrown = relocate(inspected, 464, -432)
    expect(confirm({ ...ready, signalClaimed: true }, claim).rejection).toBe('invalid_progress')
    for (const player of [
      { ...atCrown.state.player, coins: Number.MAX_SAFE_INTEGER },
      { ...atCrown.state.player, skillXp: { ...atCrown.state.player.skillXp,
        spellcraft: Number.MAX_SAFE_INTEGER } },
    ]) {
      expect(confirm({ ...atCrown, state: { ...atCrown.state, player } }, claim).rejection)
        .toBe('invalid_value')
    }
    expect(confirm({ ...atCrown, state: { ...atCrown.state,
      eventSequence: Number.MAX_SAFE_INTEGER } }, claim).rejection).toBe('invalid_value')
  })
})
