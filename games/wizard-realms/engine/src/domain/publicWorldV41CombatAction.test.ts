/** Physical Iron Hall combat, including checked action ingress and per-frame strikes. */
import { describe, expect, it, vi } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import * as hallContent from './ironHallSite'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import * as terrainSurface from './publicWorldV26TerrainSurface'
import { decodePublicV41CombatProgress, decodePublicV41CombatWitness,
  confirmPublicV41CombatAction, previewPublicV41CombatAction,
  previewPublicV41CombatActions, replayPublicV41CombatFrameBatch } from './publicWorldV41CombatAction'
import type { PublicV41CombatProgress, PublicV41CombatWitness } from './publicWorldV41CombatAction'
import { createFreshPublicV41Root } from './publicWorldV41Snapshot'
import { STARTER_CLIFF_SITE_ID } from './starterCliffProfile'
import { waystationRiverSite } from './waystationRiverContent'
import { worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const study = { kind: 'ironhall-study/v1' } as const
const engage = { kind: 'ironhall-engage/v1' } as const
const bolt = { kind: 'ironhall-bolt/v1' } as const
const guard = { kind: 'ironhall-guard/v1' } as const
const rest = { kind: 'ironhall-rest/v1' } as const
const idle = { intents: [], walkRequested: true }
const move = (x: number, z = 0) => ({ intents: [{ type: 'move' as const,
  delta: { x, z } }], walkRequested: true })
const batch = (...frames: (typeof idle | ReturnType<typeof move>)[]) =>
  ({ kind: 'frame-batch/v1', frames })

function at(point: Readonly<{ x: number; y: number; z: number }>,
  progress: PublicV41CombatProgress): PublicV41CombatProgress {
  return { ...progress, state: { ...progress.state,
    player: { ...progress.state.player, position: { ...point }, verticalVelocity: 0 } } }
}

function ready(): PublicV41CombatProgress {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...base } = createFreshPublicV41Root(seed).head
  const hall = hallContent.ironHallSite(base)!, bridge = waystationRiverSite(seed)!
  const nearby = [] as string[]
  for (let gx = 19; gx <= 25; gx++) for (let gz = 5; gz <= 12; gz++)
    nearby.push(worldTileAtGrid(seed, gx, gz).id)
  const ids = [...new Set([...decodeDiscoveredTileIds(base.state.discoveryMask),
    ...bridge.footprintTileIds, ...nearby, hall.alcove.id, hall.ward.id,
    hall.door.id])].sort()
  const progress = at(hall.alcove.center, { ...base, riverBridgeIds: [bridge.id],
    southbankReached: true, state: { ...base.state, movementOwner: 'streamed',
      discoveryMask: encodeDiscoveredTileIds(ids) } })
  expect(decodePublicV41CombatProgress(progress)).not.toBeNull()
  return progress
}

function accepted(progress: PublicV41CombatProgress,
  witness: PublicV41CombatWitness): PublicV41CombatProgress {
  const result = confirmPublicV41CombatAction(progress, witness)
  expect(result.rejection).toBeUndefined()
  return result.progress!
}

function advanced(progress: PublicV41CombatProgress,
  ...frames: (typeof idle | ReturnType<typeof move>)[]): PublicV41CombatProgress {
  const next = replayPublicV41CombatFrameBatch(progress, batch(...frames))
  expect(next).not.toBeNull()
  return next!
}

function inFight(): PublicV41CombatProgress {
  const base = ready(), hall = hallContent.ironHallSite(base)!
  return accepted(at(hall.ward.center, accepted(base, study)), engage)
}

describe('V41 physical Iron Hall combat', () => {
  it('keeps batched preview rejections identical across combat, pose and invalid heads', () => {
    const base = ready(), hall = hallContent.ironHallSite(base)!
    const learned = accepted(base, study)
    const fighting = accepted(at(hall.ward.center, learned), engage)
    const hurt = { ...base, ironHall: { ...base.ironHall, playerHealth: 8 } }
    const nearLevelUp = { ...base, state: { ...base.state,
      greenway: { ...base.state.greenway, builtRouteIds: ['greenway_ladder'],
        routes: base.state.greenway.routes.map((route) => route.id === 'greenway_ladder'
          ? { ...route, siteId: STARTER_CLIFF_SITE_ID } : route) },
      player: { ...base.state.player, xp: 95, skillXp: { ...base.state.player.skillXp,
        construction: 60 } } } } as PublicV41CombatProgress
    expect(decodePublicV41CombatProgress(nearLevelUp)).not.toBeNull()
    expect(confirmPublicV41CombatAction(nearLevelUp, study).rejection).toBe('invalid_value')
    const cases = [base, learned, fighting, hurt,
      nearLevelUp,
      { ...base, southbankReached: false },
      at({ x: 900, y: base.state.player.position.y, z: 900 }, base),
      { ...base, state: { ...base.state, player: { ...base.state.player,
        verticalVelocity: 1 } } },
      { ...base, state: { ...base.state, eventSequence: Number.MAX_SAFE_INTEGER } },
      { ...base, state: { ...base.state, tick: -1 } }]
    const kinds = [study.kind, engage.kind, bolt.kind, guard.kind, rest.kind,
      'forged/v1'] as unknown as readonly PublicV41CombatWitness['kind'][]
    for (const candidate of cases) expect(previewPublicV41CombatActions(candidate, kinds))
      .toEqual(kinds.map((kind) => previewPublicV41CombatAction(candidate, { kind })))
  })
  it('selects dry supported alcove, ward and door for both terrain seeds', () => {
    for (const testSeed of [seed, 'greenway-alpha']) {
      const base = ready(), progress = { ...base,
        state: testSeed === seed ? base.state : createPublicV23Root(testSeed).head.state }
      const hall = hallContent.ironHallSite(progress)!
      expect(hall).not.toBeNull()
      expect([hall.alcove.center.x, hall.ward.center.x, hall.door.center.x])
        .toEqual([80, 84, 84])
      expect([hall.alcove.center.z, hall.ward.center.z, hall.door.center.z])
        .toEqual([28, 32, 36])
      for (const tile of [hall.alcove, hall.ward, hall.door]) {
        expect(tile.terrain).toBe('loam')
        expect(terrainSurface.publicV26TerrainCellIsWet(testSeed,
          tile.center.x / 4, tile.center.z / 4, 'streamed')).toBe(false)
      }
    }
  })

  it('refuses unsupported, unrevealed, airborne, wet, remote and forged actions', () => {
    const base = ready(), hall = hallContent.ironHallSite(base)!
    const noCrossing = { ...base, southbankReached: false }
    expect(confirmPublicV41CombatAction(noCrossing, study).rejection).toBe('requires_crossing')
    const learned = accepted(base, study)
    const hidden = { ...learned, state: { ...learned.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(
        learned.state.discoveryMask).filter((id) => id !== hall.ward.id)) } }
    expect(confirmPublicV41CombatAction(hidden, engage).rejection).toBe('unrevealed')
    expect(confirmPublicV41CombatAction(at(hall.ward.center, base), study).rejection)
      .toBe('too_far')
    expect(confirmPublicV41CombatAction({ ...base, state: { ...base.state,
      player: { ...base.state.player, verticalVelocity: 1 } } }, study).progress)
      .toBeUndefined()
    const wetPosition = { x: 81.9, z: 32 }, floor = resolvePublicV23Surface(
      learned.state, wetPosition, learned.regionalWorks.builtLadderIds)!.floorY
    const nearWard = at({ ...wetPosition, y: floor }, learned)
    const actualWet = terrainSurface.publicV26TerrainCellIsWet
    const wet = vi.spyOn(terrainSurface, 'publicV26TerrainCellIsWet')
      .mockImplementation((testSeed, gx, gz, owner) => gx === 20 && gz === 8
        || actualWet(testSeed, gx, gz, owner))
    try { expect(confirmPublicV41CombatAction(nearWard, engage).rejection)
      .toBe('unsafe_source') }
    finally { wet.mockRestore() }
    const unsupported = vi.spyOn(hallContent, 'ironHallSite').mockReturnValue(null)
    try { expect(confirmPublicV41CombatAction(base, study).rejection).toBe('invalid_progress') }
    finally { unsupported.mockRestore() }
    for (const forged of [{ ...study, xp: 100 }, { ...bolt, damage: 9 },
      { ...guard, duration: 999 }, { ...rest, health: 12 },
      { kind: 'ironhall-bolt/v2' }, new Proxy(study, {}),
      Object.create({ kind: study.kind })]) {
      expect(decodePublicV41CombatWitness(forged)).toBeNull()
      expect(confirmPublicV41CombatAction(base, forged).rejection).toBe('invalid_value')
    }
    expect(decodePublicV41CombatProgress({ ...base,
      ironHall: { ...base.ironHall, combatXp: -1 } })).toBeNull()
    expect(decodePublicV41CombatProgress({ ...base,
      ironHall: { ...base.ironHall, playerHealth: 999 } })).toBeNull()
  })

  it('awards study and bolt XP exactly, then enforces cast and guard cooldowns', () => {
    const base = ready(), learned = accepted(base, study)
    expect(learned.state.player.xp - base.state.player.xp).toBe(10)
    expect(learned.state.player.skillXp.spellcraft
      - base.state.player.skillXp.spellcraft).toBe(10)
    expect(learned.state.eventSequence).toBe(base.state.eventSequence + 1)
    expect(confirmPublicV41CombatAction(learned, study).rejection).toBe('already_learned')
    const hall = hallContent.ironHallSite(base)!, fight = accepted(at(hall.ward.center,
      learned), engage)
    expect(fight.ironHall.phaseUntilTick).toBe(fight.state.tick + 20)
    const guarded = accepted(fight, guard), fired = accepted(guarded, bolt)
    expect(fired.ironHall.wardHealth).toBe(6)
    expect(fired.ironHall.combatXp).toBe(2)
    expect(fired.state.player.xp - guarded.state.player.xp).toBe(2)
    expect(fired.state.player.skillXp.spellcraft).toBe(learned.state.player.skillXp.spellcraft)
    expect(fired.state.eventSequence).toBe(guarded.state.eventSequence + 1)
    expect(confirmPublicV41CombatAction(fired, bolt).rejection).toBe('cooldown')
    expect(confirmPublicV41CombatAction(fired, guard).rejection).toBe('cooldown')
    const twelve = advanced(fired, ...Array(12).fill(idle))
    expect(confirmPublicV41CombatAction(twelve, bolt).rejection).toBeUndefined()
    expect(confirmPublicV41CombatAction(twelve, guard).rejection).toBe('cooldown')
    const thirty = advanced(twelve, ...Array(18).fill(idle))
    expect(confirmPublicV41CombatAction(thirty, guard).rejection).toBeUndefined()
  })

  it('resolves the exact strike frame, then recovers before the next windup', () => {
    const fight = inFight()
    const before = advanced(fight, ...Array(19).fill(idle))
    expect(before.ironHall).toMatchObject({ phase: 'windup', playerHealth: 12,
      phaseUntilTick: fight.state.tick + 20 })
    const strike = advanced(before, idle)
    expect(strike.ironHall).toMatchObject({ phase: 'recovery', playerHealth: 8,
      phaseUntilTick: fight.state.tick + 35 })
    expect(advanced(strike, ...Array(14).fill(idle)).ironHall.phase).toBe('recovery')
    const renewed = advanced(strike, ...Array(15).fill(idle))
    expect(renewed.ironHall).toMatchObject({ phase: 'windup',
      phaseUntilTick: fight.state.tick + 55 })
    const guarded = accepted(fight, guard)
    expect(advanced(guarded, ...Array(20).fill(idle)).ironHall.playerHealth).toBe(11)
  })

  it('uses actual frame positions to dodge the strike and reset on retreat', () => {
    const fight = inFight()
    const dodge = advanced(fight, ...Array(19).fill(move(0.16)), idle)
    expect(dodge.state.player.position.x).toBeGreaterThan(fight.state.player.position.x + 2.7)
    expect(dodge.ironHall).toMatchObject({ playerHealth: 12, phase: 'recovery' })
    const retreated = advanced(dodge, ...Array(60).fill(move(0.16)))
    expect(retreated.ironHall).toMatchObject({ engaged: false, phase: 'dormant',
      wardHealth: 9, playerHealth: 12, learnedBolt: true })
    expect(Math.hypot(retreated.state.player.position.x
      - hallContent.ironHallSite(retreated)!.ward.center.x,
    retreated.state.player.position.z
      - hallContent.ironHallSite(retreated)!.ward.center.z)).toBeGreaterThan(12)
  })

  it('rescues knockout locally and keeps home recovery unused', () => {
    const fight = inFight(), homeCooldown = 123456
    const withHome = { ...fight, nextHomeAtMs: homeCooldown }
    const downed = advanced(withHome, ...Array(90).fill(idle))
    expect(downed.ironHall).toMatchObject({ engaged: false, phase: 'dormant',
      playerHealth: 6, wardHealth: 9, knockouts: 1 })
    expect(downed.state.player.position).toEqual(hallContent.ironHallSite(downed)!.alcove.center)
    expect(downed.nextHomeAtMs).toBe(homeCooldown)
    expect(accepted(downed, rest).ironHall.playerHealth).toBe(12)
  })

  it('records defeat once and never grants a second combat XP or hit', () => {
    const fight = inFight(), first = accepted(fight, bolt)
    const second = accepted(advanced(first, ...Array(12).fill(idle)), bolt)
    const third = accepted(advanced(second, ...Array(12).fill(idle)), bolt)
    expect(third.ironHall).toMatchObject({ wardHealth: 0, wardDefeated: true,
      phase: 'defeated', engaged: false, combatXp: 6 })
    expect(third.state.player.xp - fight.state.player.xp).toBe(6)
    expect(confirmPublicV41CombatAction(third, engage).rejection).toBe('ward_defeated')
    expect(confirmPublicV41CombatAction(third, bolt).progress).toBeUndefined()
    expect(advanced(third, ...Array(35).fill(idle)).ironHall).toEqual(third.ironHall)
  })
})
