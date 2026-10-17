import { describe, expect, it, vi } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { highlandCorridorCells } from './highlandContent'
import { highlandQuarryRing } from './highlandQuarryRingContent'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import * as terrainSurface from './publicWorldV26TerrainSurface'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { previewPublicV37FrameBatch } from './publicWorldV37Movement'
import { createFreshPublicV38Root } from './publicWorldV38Snapshot'
import { confirmPublicV39RingAction as confirm, decodePublicV39RingProgress,
  decodePublicV39RingWitness as decode, previewPublicV39RingAction as preview,
  previewPublicV39RingActions as previewBatch } from './publicWorldV39RingAction'
import type { PublicV39RingProgress, PublicV39RingWitness } from './publicWorldV39RingAction'
import { createStreamedWorld } from './streamedWorld'
import { worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const quarry = highlandQuarryRing(seed)
const greenway = createFreshPublicV38Root(seed).head.state.greenway.fairyRings
  .find(({ id }) => id === 'ring-greenway')!
const greenwayTile = worldTileAtGrid(seed, 0, -1)
const discover = { kind: 'ringkeeper-discover/v1' } as const
const link = { kind: 'ringkeeper-link/v1' } as const
const outbound = { kind: 'ringkeeper-travel/v1', direction: 'greenway-to-highland' } as const
const inbound = { kind: 'ringkeeper-travel/v1', direction: 'highland-to-greenway' } as const
const claim = { kind: 'ringkeeper-claim/v1' } as const

function atQuarry(revealed = true): PublicV39RingProgress {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness,
    ...base } = createFreshPublicV38Root(seed).head
  const neighbor = worldTileAtGrid(seed, 131, -122)
  const ids = [...decodeDiscoveredTileIds(base.state.discoveryMask), greenwayTile.id,
    revealed ? quarry.tile.id : neighbor.id]
  const mask = encodeDiscoveredTileIds([...new Set(ids)].sort())
  const position = revealed ? quarry.tile.center : { x: 522.1, y: neighbor.center.y, z: -488 }
  return { ...base, quarryRingDiscovered: false, ringLinkEstablished: false,
    ringOutboundCompleted: false, ringReturnCompleted: false, ringkeeperClaimed: false,
    state: { ...base.state, movementOwner: 'streamed', discoveryMask: mask,
      player: { ...base.state.player, position: { ...position },
        discoveredRingIds: [...base.state.player.discoveredRingIds, 'ring-greenway'] } } }
}

function atGreenway(progress: PublicV39RingProgress): PublicV39RingProgress {
  return { ...progress, state: { ...progress.state, movementOwner: 'greenway',
    player: { ...progress.state.player, position: { ...greenway.position } } } }
}

function accepted(progress: PublicV39RingProgress,
  witness: PublicV39RingWitness): PublicV39RingProgress {
  const result = confirm(progress, witness)
  expect(result.rejection).toBeUndefined()
  return result.progress!
}

function linked(): PublicV39RingProgress {
  return accepted(atGreenway(accepted(atQuarry(), discover)), link)
}

function withOpenPit(progress: PublicV39RingProgress, gx: number,
  gz: number): PublicV39RingProgress {
  return { ...progress, terrain: { ...progress.terrain,
    columns: [{ gx, gz, openDepth: 1, rewardDepth: 1, pitLadder: false }] } }
}

describe('V39 Ringkeeper checked action', () => {
  it('batches advisory readiness with one checked decode and unchanged rejections', () => {
    const found = accepted(atQuarry(), discover)
    const ready = linked()
    const paid = accepted(accepted(accepted(ready, outbound), inbound), claim)
    const kinds = [discover.kind, link.kind, claim.kind] as const
    for (const progress of [atQuarry(), found, ready, paid,
      { ...ready, ringLinkEstablished: false }]) {
      expect(previewBatch(progress, kinds)).toEqual(kinds.map((kind) =>
        preview(progress, { kind })))
    }
    const source = atQuarry()
    const clone = vi.spyOn(globalThis, 'structuredClone')
    try {
      kinds.forEach((kind) => preview(source, { kind }))
      const separateClones = clone.mock.calls.length
      clone.mockClear()
      previewBatch(source, kinds)
      expect(clone.mock.calls.length).toBeLessThan(separateClones)
    } finally { clone.mockRestore() }
  })
  it('has a dry supported site and a real reversible walk from the Highland trail', () => {
    expect(quarry.id).toBe('ring-highland-quarry')
    expect(quarry.tile.center).toMatchObject({ x: 520, z: -488 })
    expect(quarry.tile.terrain).toBe('rocky')
    expect(publicV26TerrainCellIsWet(seed, 130, -122, 'streamed')).toBe(false)
    expect(publicV25RiverCellAtGrid(seed, 130, -122)).toBe(false)
    expect(resolvePublicV23Surface(atQuarry().state, quarry.tile.center, [])?.floorY)
      .toBeCloseTo(quarry.tile.center.y)
    const pose = projectPublicV31Pose(atQuarry())
    expect(pose?.support).toBe('terrain')
    expect(pose?.effective.position.y).toBeCloseTo(pose!.effective.floorY)

    const route = highlandCorridorCells()
    const crownIndex = route.findIndex(({ x, z }) => x === 464 && z === -432)
    const points = [...route.slice(crownIndex), { x: 520, z: -484 },
      { x: 520, z: -488 }]
    const world = createStreamedWorld(seed, points[0])
    for (const path of [points, [...points].reverse()]) {
      for (let index = 1; index < path.length; index += 1) {
        const from = path[index - 1], to = path[index]
        const moved = world.advance([{ type: 'move', delta: {
          x: to.x - from.x, z: to.z - from.z } }], { atomicOnRejection: true })
        expect(moved.rejections, `${from.x},${from.z} to ${to.x},${to.z}`).toEqual([])
        expect(moved.state.player.position).toMatchObject(to)
      }
    }
  })

  it('accepts only exact cloneable witnesses and an implied five-flag chain', () => {
    for (const witness of [discover, link, outbound, inbound, claim])
      expect(decode(witness)).toEqual(witness)
    for (const forged of [null, { kind: 'ringkeeper-discover/v1', x: 520 },
      { kind: 'ringkeeper-link/v1', linked: true },
      { kind: 'ringkeeper-travel/v1', direction: 'greenway-to-highland', reward: 25 },
      { kind: 'ringkeeper-travel/v1', direction: 'highland-to-mireglass' },
      { kind: 'ringkeeper-claim/v1', coins: 25 }, new Proxy(discover, {}),
      Object.create({ kind: discover.kind }),
      Object.defineProperty({}, 'kind', { enumerable: true, get: () => discover.kind })]) {
      expect(decode(forged)).toBeNull()
      expect(confirm(atQuarry(), forged)).toEqual({ rejection: 'invalid_value' })
    }
    const broken = { ...atQuarry(), ringkeeperClaimed: true }
    expect(decodePublicV39RingProgress(broken)).toBeNull()
    expect(confirm(broken, discover)).toEqual({ rejection: 'invalid_progress' })
  })

  it('rejects unrevealed, remote, airborne, wet and open-pit discovery sources', () => {
    expect(confirm(atQuarry(false), discover)).toEqual({ rejection: 'unrevealed' })
    const base = atQuarry()
    const remote = { x: 520, z: -480 }
    const remoteY = resolvePublicV23Surface(base.state, remote, [])!.floorY
    const remoteMask = encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(base.state.discoveryMask),
      worldTileAtGrid(seed, 130, -120).id])].sort())
    expect(confirm({ ...base, state: { ...base.state,
      discoveryMask: remoteMask,
      player: { ...base.state.player, position: { ...remote, y: remoteY } } } }, discover))
      .toEqual({ rejection: 'too_far' })
    const jumped = previewPublicV37FrameBatch(base, { kind: 'frame-batch/v1',
      frames: [{ intents: [{ type: 'jump' }], walkRequested: true }] })
    expect(jumped?.state.player.verticalVelocity).toBeGreaterThan(0)
    const airborne = { ...base, state: jumped!.state }
    expect(confirm(airborne, discover)).toEqual({ rejection: 'invalid_progress' })

    const wet = vi.spyOn(terrainSurface, 'publicV26TerrainCellIsWet').mockReturnValue(true)
    try { expect(confirm(base, discover)).toEqual({ rejection: 'unsafe_source' }) }
    finally { wet.mockRestore() }
    expect(confirm(withOpenPit(base, 130, -122), discover).rejection)
      .toBe('unsafe_source')
  })

  it('requires discovery, Greenway discovery, link and outbound before return or claim', () => {
    const atHome = atGreenway(atQuarry())
    expect(confirm(atHome, link)).toEqual({ rejection: 'undiscovered' })
    const found = accepted(atQuarry(), discover)
    expect(confirm(found, discover)).toEqual({ rejection: 'already_discovered' })
    expect(found.state.player.discoveredRingIds).not.toContain('ring-highland-quarry')
    expect(confirm(found, link)).toEqual({ rejection: 'wrong_region' })
    const withoutGreenway = atGreenway({ ...found, state: { ...found.state,
      player: { ...found.state.player, discoveredRingIds: [] } } })
    expect(confirm(withoutGreenway, link)).toEqual({ rejection: 'undiscovered' })
    const linkedProgress = accepted(atGreenway(found), link)
    expect(confirm(linkedProgress, link)).toEqual({ rejection: 'already_linked' })
    expect(confirm(linkedProgress, claim)).toEqual({ rejection: 'requires_return' })
    expect(confirm(linkedProgress, inbound)).toEqual({ rejection: 'wrong_region' })
    expect(confirm(atQuarryWithFlags(linkedProgress), inbound))
      .toEqual({ rejection: 'requires_outbound' })
  })

  it('rejects unsupported, open-pit and raised-soil target landings', () => {
    const ready = linked()
    const hiddenTarget = { ...ready, state: { ...ready.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(ready.state.discoveryMask)
        .filter((id) => id !== quarry.tile.id)) } }
    expect(confirm(hiddenTarget, outbound)).toEqual({ rejection: 'unrevealed' })
    expect(confirm(withOpenPit(ready, 130, -122), outbound))
      .toEqual({ rejection: 'unsafe_arrival' })
    const raised = { ...ready, raisedSoilCells: [{ gx: 130, gz: -122 }] }
    expect(confirm(raised, outbound)).toEqual({ rejection: 'unsafe_arrival' })
  })

  it('relocates safely both ways and pays exactly once without changing old ring IDs', () => {
    const ready = linked()
    expect(preview(ready, outbound)).toEqual({ rejection: null })
    const out = accepted(ready, outbound)
    expect(out.state.player.position).toEqual(quarry.tile.center)
    expect(out.state.movementOwner).toBe('streamed')
    expect(out.state.tick).toBe(ready.state.tick + 1)
    expect(out.state.eventSequence).toBe(ready.state.eventSequence + 1)
    expect(out.ringOutboundCompleted).toBe(true)
    const back = accepted(out, inbound)
    expect(back.state.player.position).toEqual(greenway.position)
    expect(back.state.movementOwner).toBe('greenway')
    expect(back.state.tick).toBe(out.state.tick + 1)
    expect(back.state.eventSequence).toBe(out.state.eventSequence + 1)
    expect(back.ringReturnCompleted).toBe(true)
    const paid = accepted(back, claim)
    expect(paid.state.player.coins - back.state.player.coins).toBe(25)
    expect(paid.state.player.skillXp.wayfinding - back.state.player.skillXp.wayfinding).toBe(30)
    expect(paid.state.player.skillXp.spellcraft - back.state.player.skillXp.spellcraft).toBe(20)
    expect(paid.state.player.xp - back.state.player.xp).toBe(35)
    expect(paid.state.eventSequence).toBe(back.state.eventSequence + 1)
    expect(paid.state.tick).toBe(back.state.tick)
    expect(paid.state.player.discoveredRingIds).toEqual(back.state.player.discoveredRingIds)
    expect(confirm(paid, claim)).toEqual({ rejection: 'already_claimed' })
    const laterTravel = accepted(paid, outbound)
    expect(laterTravel.ringkeeperClaimed).toBe(true)
    expect(laterTravel.state.player.coins).toBe(paid.state.player.coins)
    expect(laterTravel.state.player.xp).toBe(paid.state.player.xp)
  })

  it('refuses reward and event-sequence overflow without changing progress', () => {
    const ready = linked()
    const out = accepted(ready, outbound), back = accepted(out, inbound)
    const maxCoins = { ...back, state: { ...back.state, player: { ...back.state.player,
      coins: Number.MAX_SAFE_INTEGER } } }
    expect(confirm(maxCoins, claim)).toEqual({ rejection: 'invalid_value' })
    const maxEvent = { ...atQuarry(), state: { ...atQuarry().state,
      eventSequence: Number.MAX_SAFE_INTEGER } }
    expect(confirm(maxEvent, discover)).toEqual({ rejection: 'invalid_value' })
  })
})

function atQuarryWithFlags(progress: PublicV39RingProgress): PublicV39RingProgress {
  return { ...progress, state: { ...progress.state, movementOwner: 'streamed',
    player: { ...progress.state.player, position: { ...quarry.tile.center } } } }
}
