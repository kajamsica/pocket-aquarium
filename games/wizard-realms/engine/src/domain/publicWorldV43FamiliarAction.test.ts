import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { createFreshPublicV42Root, replayPublicV42Witness } from './publicWorldV42Snapshot'
import { publicV43FamiliarTouchesForbiddenSupport,
  publicV43FamiliarTouchesUnrevealedCell,
  replayPublicV43FamiliarFrame,
  advancePublicV43FamiliarFollower } from './publicWorldV43FamiliarFollower'
import { publicV25RiverCenterZ, publicV25RiverCellAtGrid } from './publicWorldV25River'
import { confirmPublicV43FamiliarAction, createPublicV43FamiliarProgress,
  decodePublicV43FamiliarProgress, decodePublicV43FamiliarWitness } from './publicWorldV43FamiliarAction'
import type { PublicV43FamiliarProgress, PublicV43FamiliarWitness } from './publicWorldV43FamiliarAction'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'
import { waystationRiverSite } from './waystationRiverContent'
import type { WorldTile } from './types'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN,
  worldTileAtGrid } from './worldChunks'

const witness = (kind: PublicV43FamiliarWitness['kind']) => ({ kind })
const idle = { intents: [], walkRequested: true } as const
const act = (progress: PublicV43FamiliarProgress,
  kind: PublicV43FamiliarWitness['kind']) => {
  const result = confirmPublicV43FamiliarAction(progress, witness(kind))
  expect(result.rejection).toBeUndefined()
  expect(result.progress?.state.eventSequence).toBe(progress.state.eventSequence + 1)
  return result.progress!
}

function ready(): PublicV43FamiliarProgress {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...base } = createFreshPublicV42Root('wizard-realms').head
  const site = resolveSedgehornFamiliarSite(base)!
  const bridge = waystationRiverSite(base.state.seed)!
  expect(site).not.toBeNull()
  expect(bridge).not.toBeNull()
  const inventory = [...base.state.player.inventory,
    { itemId: 'marsh_herb' as const, quantity: 1 },
    { itemId: 'logs' as const, quantity: 2 }]
  const pocket = [] as string[]
  const anchors = [site.tracks, site.habitat, site.shelter,
    site.dryApproach, site.keeper]
  const minX = Math.min(...anchors.map(({ center }) => center.x)) / WORLD_CELL_METERS - 1
  const maxX = Math.max(...anchors.map(({ center }) => center.x)) / WORLD_CELL_METERS + 1
  const minZ = Math.min(...anchors.map(({ center }) => center.z)) / WORLD_CELL_METERS - 1
  const maxZ = Math.max(...anchors.map(({ center }) => center.z)) / WORLD_CELL_METERS + 1
  for (let gz = minZ; gz <= maxZ; gz++) for (let gx = minX; gx <= maxX; gx++) {
    pocket.push(worldTileAtGrid(base.state.seed, gx, gz).id)
  }
  const parent = { ...base, southbankReached: true,
    riverBridgeIds: [bridge.id], state: { ...base.state,
      movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask),
        ...bridge.footprintTileIds, ...pocket,
      ])].sort()),
      player: { ...base.state.player, inventory,
        position: { ...site.tracks.center }, verticalVelocity: 0 } } }
  const progress = createPublicV43FamiliarProgress(parent)
  expect(progress).not.toBeNull()
  expect(decodePublicV43FamiliarProgress(progress)).not.toBeNull()
  return progress!
}

function at(progress: PublicV43FamiliarProgress, tile: WorldTile):
  PublicV43FamiliarProgress {
  return { ...progress, state: { ...progress.state, player: {
    ...progress.state.player, position: { ...tile.center }, verticalVelocity: 0 } } }
}

describe('V43 Lost Familiar domain-only contract', () => {
  it('anchors one seed-bound wetland animal and supported dry clues/care/keeper', () => {
    const progress = ready(), site = resolveSedgehornFamiliarSite(progress)!
    expect(site.habitat.terrain).toBe('wetland')
    for (const tile of [site.tracks, site.shelter, site.dryApproach,
      site.careStation, site.keeper]) expect(tile.terrain).toBe('loam')
    expect(new Set([site.tracks.id, site.shelter.id,
      site.dryApproach.id, site.keeper.id]).size).toBe(4)
    expect(progress.familiar).toMatchObject({ id: site.id, phase: 'search',
      routeChoice: null, trust: 0, creatureCareXp: 0, stationKnown: false })
    expect(resolveSedgehornFamiliarSite(progress)).toEqual(site)
  })

  it('spends an herb exactly once, then takes the material shelter path', () => {
    const site = resolveSedgehornFamiliarSite(ready())!
    const tracked = act(ready(), 'familiar-tracks/v1')
    expect(confirmPublicV43FamiliarAction(tracked,
      witness('familiar-tracks/v1')).rejection).toBe('wrong_stage')
    const fed = act(at(tracked, site.shelter), 'familiar-herb/v1')
    expect(fed.state.player.inventory.some(({ itemId }) => itemId === 'marsh_herb'))
      .toBe(false)
    expect(fed.familiar).toMatchObject({ phase: 'fed', trust: 1,
      creatureCareXp: 10 })
    const sheltered = act(fed, 'familiar-shelter/v1')
    expect(sheltered.state.player.inventory.some(({ itemId }) => itemId === 'logs'))
      .toBe(false)
    expect(sheltered.familiar).toMatchObject({ phase: 'route-ready',
      routeChoice: 'shelter', trust: 2, creatureCareXp: 20 })
    expect(confirmPublicV43FamiliarAction(sheltered,
      witness('familiar-shelter/v1')).rejection).toBe('wrong_stage')
    const escort = act(sheltered, 'familiar-escort/v1')
    const calmed = act(escort, 'familiar-calm/v1')
    expect(calmed.familiar).toMatchObject({ phase: 'escort', calmed: true,
      trust: 3, creatureCareXp: 20 })
    expect(confirmPublicV43FamiliarAction(calmed,
      witness('familiar-calm/v1')).rejection).toBe('wrong_stage')
  })

  it('allows the longer dry-approach choice without charging shelter logs', () => {
    const first = ready(), site = resolveSedgehornFamiliarSite(first)!
    const fed = act(at(act(first, 'familiar-tracks/v1'), site.shelter),
      'familiar-herb/v1')
    const dry = act(at(fed, site.dryApproach), 'familiar-dry-approach/v1')
    expect(dry.familiar).toMatchObject({ phase: 'route-ready',
      routeChoice: 'dry-approach', trust: 2, creatureCareXp: 20 })
    expect(dry.state.player.inventory.find(({ itemId }) => itemId === 'logs')?.quantity)
      .toBe(2)
    expect(confirmPublicV43FamiliarAction(at(dry, site.shelter),
      witness('familiar-shelter/v1')).rejection).toBe('wrong_stage')
  })

  it('walks the familiar through accepted frames before return and one-time claim', () => {
    const first = ready(), site = resolveSedgehornFamiliarSite(first)!
    const tracked = act(first, 'familiar-tracks/v1')
    const fed = act(at(tracked, site.shelter), 'familiar-herb/v1')
    let progress = act(act(fed, 'familiar-shelter/v1'), 'familiar-escort/v1')
    for (let index = 0; index < 100; index++) {
      if (Math.hypot(progress.familiar.position.x - site.shelter.center.x,
        progress.familiar.position.z - site.shelter.center.z) < 1.5) break
      const next = replayPublicV43FamiliarFrame(progress, idle)
      expect(next, `follow frame ${index}, wait=${progress.familiar.waitReason}`).not.toBeNull()
      expect(Math.hypot(next!.familiar.position.x - progress.familiar.position.x,
        next!.familiar.position.z - progress.familiar.position.z))
        .toBeLessThanOrEqual(0.200001)
      progress = next!
    }
    const gap = Math.hypot(progress.familiar.position.x - site.shelter.center.x,
      progress.familiar.position.z - site.shelter.center.z)
    expect(gap, `wait=${progress.familiar.waitReason}, habitat=${JSON.stringify(site.habitat.center)}, shelter=${JSON.stringify(site.shelter.center)}, familiar=${JSON.stringify(progress.familiar.position)}, player=${JSON.stringify(progress.state.player.position)}`).toBeLessThan(3)
    expect(progress.familiar.waitReason).toBe('none')
    for (let index = 0; index < 200; index++) {
      const dx = site.keeper.center.x - progress.state.player.position.x
      const dz = site.keeper.center.z - progress.state.player.position.z
      if (Math.hypot(dx, dz) < 0.15) break
      const scale = Math.min(0.16, Math.hypot(dx, dz)) / Math.hypot(dx, dz)
      const frame = { intents: [{ type: 'move' as const,
        delta: { x: dx * scale, z: dz * scale } }], walkRequested: true }
      const next = replayPublicV43FamiliarFrame(progress, frame)
      expect(next, `travel frame ${index}, x=${progress.state.player.position.x}, z=${progress.state.player.position.z}`).not.toBeNull()
      expect(Math.hypot(next!.familiar.position.x - progress.familiar.position.x,
        next!.familiar.position.z - progress.familiar.position.z))
        .toBeLessThanOrEqual(0.200001)
      progress = next!
    }
    for (let index = 0; index < 100; index++) {
      if (Math.hypot(progress.familiar.position.x - site.keeper.center.x,
        progress.familiar.position.z - site.keeper.center.z) < 2.5) break
      const next = replayPublicV43FamiliarFrame(progress, idle)
      expect(next, `catch-up frame ${index}`).not.toBeNull()
      progress = next!
    }
    expect(Math.hypot(progress.state.player.position.x - site.keeper.center.x,
      progress.state.player.position.z - site.keeper.center.z)).toBeLessThan(3)
    expect(Math.hypot(progress.familiar.position.x - site.keeper.center.x,
      progress.familiar.position.z - site.keeper.center.z)).toBeLessThan(3)
    const returned = act(progress, 'familiar-return/v1')
    const claimed = act(returned, 'familiar-claim/v1')
    expect(claimed.state.player.coins - returned.state.player.coins).toBe(25)
    expect(claimed.state.player.xp - returned.state.player.xp).toBe(40)
    expect(claimed.familiar).toMatchObject({ phase: 'claimed', stationKnown: true,
      creatureCareXp: 40 })
    expect(confirmPublicV43FamiliarAction(claimed,
      witness('familiar-claim/v1')).rejection).toBe('already_claimed')
  }, 60000)

  it('waits while separated and resumes at bounded speed when the player returns', () => {
    const first = ready(), site = resolveSedgehornFamiliarSite(first)!
    const fed = act(at(act(first, 'familiar-tracks/v1'), site.shelter),
      'familiar-herb/v1')
    const escort = act(act(fed, 'familiar-shelter/v1'), 'familiar-escort/v1')
    expect(replayPublicV43FamiliarFrame(escort, { intents: [{ type: 'move',
      delta: { x: 99, z: 0 } }], walkRequested: true })).toBeNull()
    // Construct only the player's distant, supported pose to isolate the
    // recovery rule; the end-to-end test above moves the animal only by frames.
    const far = at(escort, site.keeper)
    const waiting = replayPublicV43FamiliarFrame(far, idle)!
    expect(waiting.familiar.waitReason).toBe('separated')
    expect(waiting.familiar.position).toEqual(escort.familiar.position)
    const nearby = at(waiting, site.shelter)
    const resumed = replayPublicV43FamiliarFrame(nearby, idle)!
    expect(resumed.familiar.waitReason).toBe('none')
    expect(Math.hypot(resumed.familiar.position.x - waiting.familiar.position.x,
      resumed.familiar.position.z - waiting.familiar.position.z))
      .toBeGreaterThan(0)
    expect(Math.hypot(resumed.familiar.position.x - waiting.familiar.position.x,
      resumed.familiar.position.z - waiting.familiar.position.z))
      .toBeLessThanOrEqual(0.200001)
  })

  it('takes one bounded step from a checked grounded later prefix, without replaying it', () => {
    const first = ready(), site = resolveSedgehornFamiliarSite(first)!
    const fed = act(at(act(first, 'familiar-tracks/v1'), site.shelter),
      'familiar-herb/v1')
    const escort = act(act(fed, 'familiar-shelter/v1'), 'familiar-escort/v1')
    const later = replayPublicV42Witness(escort,
      { kind: 'frame-batch/v1', frames: [idle, idle, idle] })
    expect(later).not.toBeNull()
    expect(later!.state.tick - escort.state.tick).toBe(3)
    const advanced = advancePublicV43FamiliarFollower(escort, later!)
    expect(advanced).not.toBeNull()
    expect(advanced!.state.tick).toBe(later!.state.tick)
    expect(Math.hypot(advanced!.familiar.position.x - escort.familiar.position.x,
      advanced!.familiar.position.z - escort.familiar.position.z))
      .toBeGreaterThan(0)
    expect(Math.hypot(advanced!.familiar.position.x - escort.familiar.position.x,
      advanced!.familiar.position.z - escort.familiar.position.z))
      .toBeLessThanOrEqual(0.200001)
    expect(advancePublicV43FamiliarFollower(escort, {
      ...later!, state: { ...later!.state, player: {
        ...later!.state.player, verticalVelocity: 1 } },
    })).toBeNull()
    expect(advancePublicV43FamiliarFollower(escort, {
      ...later!, state: { ...later!.state, tick: escort.state.tick },
    })).toBeNull()
  })

  it('holds at a crossing rather than walking through unsupported bridge water', () => {
    const first = ready(), site = resolveSedgehornFamiliarSite(first)!
    const fed = act(at(act(first, 'familiar-tracks/v1'), site.shelter),
      'familiar-herb/v1')
    const escort = act(act(fed, 'familiar-shelter/v1'), 'familiar-escort/v1')
    const bridge = waystationRiverSite(first.state.seed)!
    const animal = { ...bridge.from }, player = { ...bridge.to }
    const situated: PublicV43FamiliarProgress = {
      ...escort, familiar: { ...escort.familiar, position: animal },
      state: { ...escort.state,
        player: { ...escort.state.player, position: player } },
    }
    expect(decodePublicV43FamiliarProgress(situated)).not.toBeNull()
    let waiting = situated
    for (let index = 0; index < 40; index++) {
      const next = replayPublicV43FamiliarFrame(waiting, idle)
      expect(next).not.toBeNull()
      waiting = next!
      if (waiting.familiar.waitReason === 'unsafe_support') break
    }
    expect(waiting).not.toBeNull()
    expect(waiting.familiar.waitReason).toBe('unsafe_support')
  })

  it('blocks a wet diagonal corner even when both follower endpoints are dry', () => {
    const seed = 'greenway-alpha'
    let rise: number | undefined
    for (let gx = WORLD_GRID_MIN + 1; gx <= WORLD_GRID_MAX; gx += 1) {
      if (publicV25RiverCenterZ(seed, gx) > publicV25RiverCenterZ(seed, gx - 1)) {
        rise = gx
        break
      }
    }
    expect(rise).toBeDefined()
    if (rise === undefined) return
    const x = (rise - 0.5) * WORLD_CELL_METERS
    const z = (publicV25RiverCenterZ(seed, rise) + 0.5) * WORLD_CELL_METERS
    const from = { x: x - 0.1, z: z - 0.1 }
    const to = { x: x + 0.1, z: z + 0.1 }
    expect(publicV25RiverCellAtGrid(seed, rise - 1,
      publicV25RiverCenterZ(seed, rise))).toBe(false)
    expect(publicV43FamiliarTouchesForbiddenSupport(seed, from, to, [], []))
      .toBe(true)
    expect(publicV43FamiliarTouchesForbiddenSupport(seed, to, from, [], []))
      .toBe(true)
  })

  it('sweeps dug pits and raised soil at a diagonal corner, not just endpoint cells', () => {
    const seed = 'greenway-alpha'
    const from = { x: 1.9, z: -6.1 }
    const to = { x: 2.1, z: -5.9 }
    const cell = { gx: 1, gz: -2 }
    expect(publicV43FamiliarTouchesForbiddenSupport(seed, from, to, [], []))
      .toBe(false)
    expect(publicV43FamiliarTouchesForbiddenSupport(seed, from, to,
      [{ ...cell, openDepth: 1 }], [])).toBe(true)
    expect(publicV43FamiliarTouchesForbiddenSupport(seed, from, to,
      [], [cell])).toBe(true)
    expect(publicV43FamiliarTouchesForbiddenSupport(seed, to, from,
      [{ ...cell, openDepth: 1 }], [])).toBe(true)
    expect(publicV43FamiliarTouchesForbiddenSupport(seed, to, from,
      [], [cell])).toBe(true)
  })

  it('requires every touched tile to be revealed, including diagonal side corners', () => {
    const from = { x: 1.9, z: -6.1 }
    const to = { x: 2.1, z: -5.9 }
    const tile = (gx: number, gz: number) => `tile-${gx + 3}-${gz + 3}`
    const endpointsOnly = encodeDiscoveredTileIds([
      tile(0, -2), tile(1, -1),
    ].sort())
    expect(publicV43FamiliarTouchesUnrevealedCell(endpointsOnly, from, to))
      .toBe(true)
    expect(publicV43FamiliarTouchesUnrevealedCell(endpointsOnly, to, from))
      .toBe(true)
    const fullyRevealed = encodeDiscoveredTileIds([
      tile(0, -2), tile(0, -1), tile(1, -2), tile(1, -1),
    ].sort())
    expect(publicV43FamiliarTouchesUnrevealedCell(fullyRevealed, from, to))
      .toBe(false)
  })

  it('refuses forged payloads, hidden clues, premature rewards and blocked return', () => {
    const first = ready(), site = resolveSedgehornFamiliarSite(first)!
    expect(confirmPublicV43FamiliarAction({ ...first, southbankReached: false },
      witness('familiar-tracks/v1')).rejection).toBe('requires_crossing')
    expect(confirmPublicV43FamiliarAction(at(first, site.keeper),
      witness('familiar-tracks/v1')).rejection).toBe('too_far')
    expect(confirmPublicV43FamiliarAction({ ...first, state: { ...first.state,
      player: { ...first.state.player, verticalVelocity: 1 } } },
    witness('familiar-tracks/v1')).rejection).toMatch(/invalid_progress|not_grounded/)
    expect(decodePublicV43FamiliarWitness({ kind: 'familiar-tracks/v1', trust: 3 }))
      .toBeNull()
    expect(confirmPublicV43FamiliarAction(first,
      { kind: 'familiar-claim/v1', coins: 250 }).rejection).toBe('invalid_value')
    expect(confirmPublicV43FamiliarAction(at(first, site.keeper),
      witness('familiar-claim/v1')).rejection).toBe('wrong_stage')
    const hidden = { ...first, state: { ...first.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(
        first.state.discoveryMask).filter((id) => id !== site.tracks.id)) } }
    expect(confirmPublicV43FamiliarAction(hidden,
      witness('familiar-tracks/v1')).rejection).toMatch(/invalid_progress|unrevealed/)
    expect(decodePublicV43FamiliarProgress({ ...first,
      familiar: { ...first.familiar, trust: 3 } })).toBeNull()
    expect(decodePublicV43FamiliarProgress({ ...first, forgedReward: 250 })).toBeNull()
    expect(confirmPublicV43FamiliarAction({ ...first, forgedReward: 250 } as
      PublicV43FamiliarProgress, witness('familiar-tracks/v1')).rejection)
      .toBe('invalid_progress')
    const tracked = act(first, 'familiar-tracks/v1')
    const atShelter = at(tracked, site.shelter)
    expect(confirmPublicV43FamiliarAction({ ...atShelter, state: { ...atShelter.state,
      player: { ...atShelter.state.player, inventory: atShelter.state.player.inventory.filter(
        ({ itemId }) => itemId !== 'marsh_herb') } } },
    witness('familiar-herb/v1')).rejection).toBe('not_owned')
    const fed = act(atShelter, 'familiar-herb/v1')
    expect(confirmPublicV43FamiliarAction({ ...fed, state: { ...fed.state,
      player: { ...fed.state.player, inventory: [] } } },
    witness('familiar-shelter/v1')).rejection).toBe('not_owned')
    const escort = act(act(fed, 'familiar-shelter/v1'), 'familiar-escort/v1')
    expect(confirmPublicV43FamiliarAction(at(escort, site.keeper),
      witness('familiar-return/v1')).rejection).toBe('companion_not_here')
  })
})
