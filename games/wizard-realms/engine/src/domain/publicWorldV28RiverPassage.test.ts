import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { visitPublicV23FramesWithEvents } from './publicWorldV23Transitions'
import { publicV25RiverPassage } from './publicWorldV25Passage'
import { projectPublicV26Pose } from './publicWorldV26Pose'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { replayPublicV27FramesWithEvents } from './publicWorldV27Snapshot'
import { publicV28AdjacentBankSeam, publicV28RiverPassage } from './publicWorldV28RiverPassage'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { projectPublicV28Pose, publicV28ResolvedRiverBridges } from './publicWorldV28RiverSupport'
import type { Vec3 } from './types'

const seed = 'greenway-alpha'
const terrain = emptyPublicV26TerrainLedger()
const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-14')!

function streamedAt(point: { x: number; z: number }, worldSeed = seed) {
  const { head } = createPublicV23Root(worldSeed)
  const floor = resolvePublicV23Surface(head.state, point, [])
  if (!floor) throw new Error('Missing canonical old carrier floor')
  const discoveryMask = encodeDiscoveredTileIds([...new Set([
    ...decodeDiscoveredTileIds(head.state.discoveryMask), floor.tileId])].sort())
  const progress = decodePublicV23Progress({ state: { ...head.state,
    movementOwner: 'streamed', discoveryMask,
    player: { ...head.state.player, position: { ...point, y: floor.floorY } } },
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }, worldSeed)
  if (!progress) throw new Error('Missing checked streamed carrier')
  return progress
}

describe('V28 saved river bridge support and passage', () => {
  it('authenticates only the saved -11 adjacent bank seam in both directions', () => {
    const riverSeed = 'wizard-realms'
    const saved = resolvePublicV28RiverBridge(riverSeed, 'works6:river-bridge:-11')
    const wrong = resolvePublicV28RiverBridge(riverSeed, 'works6:river-bridge:-14')
    if (!saved || !wrong) throw new Error('Missing canonical bridge controls')
    const dry = streamedAt({ x: -44, z: 1.96 }, riverSeed)
    const outwardFrame = { intents: [{ type: 'move' as const,
      delta: { x: 0, z: 0.16 } }], walkRequested: true }
    const outwardTrial = visitPublicV23FramesWithEvents(dry, [outwardFrame], () => true, true)
    if (!outwardTrial) throw new Error('Missing authentic outward V23 trial')
    const outwardFrom = dry.state.player.position
    const outwardTo = outwardTrial.progress.state.player.position
    expect(outwardTrial.progress.state.player.verticalVelocity).toBeLessThan(0)
    const wet = streamedAt({ x: -44, z: 2.12 }, riverSeed)
    const returnFrame = { intents: [{ type: 'move' as const,
      delta: { x: 0, z: -0.16 } }], walkRequested: true }
    const returnTrial = visitPublicV23FramesWithEvents(wet, [returnFrame], () => true, true)
    if (!returnTrial) throw new Error('Missing authentic return V23 trial')
    const returnFrom = wet.state.player.position
    const returnTo = returnTrial.progress.state.player.position
    expect(returnTrial.progress.state.player.verticalVelocity).toBe(0)
    for (const [progress, from, to, direction] of [
      [dry, outwardFrom, outwardTo, 'outward'],
      [wet, returnFrom, returnTo, 'return']] as const) {
      expect(publicV28AdjacentBankSeam(progress, terrain, [saved.id], from, to))
        .toMatchObject({ direction, wetTileId: saved.wetGapTileIds[0] })
      expect(publicV28RiverPassage(progress, terrain, [saved.id], from, to))
        .toEqual({ ok: true })
      for (const ids of [[], [wrong.id]]) {
        expect(publicV28AdjacentBankSeam(progress, terrain, ids, from, to)).toBeNull()
        expect(publicV28RiverPassage(progress, terrain, ids, from, to))
          .toEqual({ ok: false, reason: 'river-needs-bridge' })
      }
      for (const [a, b] of [[{ ...from, y: from.y + 1 }, to],
        [from, { ...to, y: to.y + 1 }], [from, { ...to, y: to.y - 0.1 }]]) {
        expect(publicV28AdjacentBankSeam(progress, terrain, [saved.id], a, b)).toBeNull()
        expect(publicV28RiverPassage(progress, terrain, [saved.id], a, b))
          .toEqual({ ok: false, reason: 'river-needs-bridge' })
      }
      const pit = { ...terrain, columns: [{ gx: -11, gz: 1,
        openDepth: 1, rewardDepth: 1, pitLadder: false }] }
      expect(publicV28AdjacentBankSeam(progress, pit, [saved.id], from, to)).toBeNull()
      expect(publicV28RiverPassage(progress, pit, [saved.id], from, to))
        .toEqual({ ok: false, reason: 'river-needs-bridge' })
    }
    expect(replayPublicV27FramesWithEvents({ ...dry, terrain, nextHomeAtMs: 0 },
      [outwardFrame])).toBeNull()
    const outside = streamedAt({ x: -42.69, z: 1.96 }, riverSeed)
    const outsideTrial = visitPublicV23FramesWithEvents(outside, [outwardFrame], () => true, true)
    if (!outsideTrial) throw new Error('Missing off-lane V23 trial')
    const offFrom = outside.state.player.position, offTo = outsideTrial.progress.state.player.position
    expect(publicV28AdjacentBankSeam(outside, terrain, [saved.id], offFrom, offTo)).toBeNull()
    expect(publicV28RiverPassage(outside, terrain, [saved.id], offFrom, offTo))
      .toEqual({ ok: false, reason: 'river-needs-bridge' })
    const cornerFrom = { ...outwardFrom, x: -42.05 }
    const cornerTo = { ...outwardTo, x: -41.93, z: 2.08 }
    expect(publicV28AdjacentBankSeam(dry, terrain, [saved.id], cornerFrom, cornerTo)).toBeNull()
  })

  it('replays the old carrier across the off-starter water and restores its wet pose', () => {
    const start = streamedAt({ x: -56, z: 8 })
    const frames = Array.from({ length: 50 }, () => ({ intents: [{ type: 'move' as const,
      delta: { x: 0, z: 0.16 } }], walkRequested: false }))
    const rejected: { from: Vec3; to: Vec3; reason: string }[] = []
    let wet: ReturnType<typeof streamedAt> | null = null
    let count = 0
    const replay = visitPublicV23FramesWithEvents(start, frames, (before, after) => {
      count++
      if (count === 25) wet = after
      const from = before.state.player.position, to = after.state.player.position
      const passage = publicV28RiverPassage(before, terrain, [site.id], from, to)
      if (!passage.ok) rejected.push({ from, to, reason: passage.reason })
      return passage.ok
    })
    expect(rejected).toEqual([])
    expect(replay?.progress.state.player.position.x).toBe(-56)
    expect(replay?.progress.state.player.position.z).toBeCloseTo(16, 8)
    expect(wet).not.toBeNull()
    const carrier = wet!.state.player.position
    expect(carrier.x).toBe(-56)
    expect(carrier.z).toBeCloseTo(12, 8)
    expect(decodePublicV23Progress(wet, seed)).not.toBeNull()
    const oldPose = projectPublicV26Pose(wet!, terrain)
    const newPose = projectPublicV28Pose(wet!, terrain, [site.id])
    expect(oldPose).not.toBeNull()
    expect(newPose).not.toBeNull()
    expect(newPose?.carrier).toEqual(oldPose?.carrier)
    expect(newPose?.bridgeId).toBe(site.id)
    expect(newPose?.support).toBe('bridge')
    expect(newPose!.effective.floorY).toBeGreaterThan(oldPose!.effective.floorY)
    expect(newPose!.effective.position.y - carrier.y).toBeCloseTo(
      newPose!.effective.floorY - oldPose!.effective.floorY, 8)
    expect(projectPublicV28Pose(wet!, terrain, [site.id])).toEqual(newPose)
  })

  it('replays the old carrier back across the same saved deck, including the wet-to-dry bank seam', () => {
    const start = streamedAt({ x: -56, z: 16 })
    const frames = Array.from({ length: 50 }, () => ({ intents: [{ type: 'move' as const,
      delta: { x: 0, z: -0.16 } }], walkRequested: false }))
    const rejected: { from: Vec3; to: Vec3; reason: string }[] = []
    const replay = visitPublicV23FramesWithEvents(start, frames, (before, after) => {
      const from = before.state.player.position, to = after.state.player.position
      const passage = publicV28RiverPassage(before, terrain, [site.id], from, to)
      if (!passage.ok) rejected.push({ from, to, reason: passage.reason })
      return passage.ok
    })
    expect(rejected).toEqual([])
    expect(replay?.progress.state.player.position.z).toBeCloseTo(8, 8)
  })

  it('keeps a saved old Greenway bridge valid without a V28 deck', () => {
    const oldSeed = 'wizard-realms'
    const { head } = createPublicV23Root(oldSeed)
    const old = resolvePublicV17GreenwaySite(oldSeed, 'works3:bridge:1')
    if (!old || old.kind !== 'bridge') throw new Error('Missing old bridge')
    const greenwayWorks = { ...head.greenwayWorks, builtBridgeIds: [old.id] }
    const context = { seed: oldSeed, profile: head.state.generationProfile,
      route: head.state.greenway.routes[0] ?? null, built: false, greenwayWorks }
    const fromXZ = { x: old.gapCenter.x, z: old.gapCenter.z }
    const toXZ = { ...fromXZ, z: fromXZ.z + 0.16 }
    const first = publicV17StarterSupportAt(context, fromXZ)
    const last = publicV17StarterSupportAt(context, toXZ)
    if (first?.kind !== 'bridge' || last?.kind !== 'bridge') throw new Error('Missing old deck support')
    const from = { ...fromXZ, y: first.floorY }, to = { ...toXZ, y: last.floorY }
    const progress = decodePublicV23Progress({ state: { ...head.state,
      player: { ...head.state.player, xp: 80,
        skillXp: { ...head.state.player.skillXp, construction: 80 }, position: from } },
    greenwayWorks, regionalWorks: head.regionalWorks }, oldSeed)
    if (!progress) throw new Error('Missing old bridge progress')
    expect(publicV25RiverPassage(progress, from, to)).toEqual({ ok: true })
    expect(publicV28RiverPassage(progress, terrain, [], from, to)).toEqual({ ok: true })
  })

  it('rejects water with no deck, an off-rail step, vertical mismatch and a diagonal wet corner', () => {
    const progress = streamedAt({ x: -56, z: 12 })
    const floor = progress.state.player.position.y
    const from = { x: -56, y: floor, z: 12 }
    const to = { ...from, z: 12.16 }
    expect(publicV28RiverPassage(progress, terrain, [], from, to))
      .toEqual({ ok: false, reason: 'river-needs-bridge' })
    expect(publicV28RiverPassage(progress, terrain, [site.id], from, to))
      .toEqual({ ok: true })
    const offRail = { x: -55.1, y: floor, z: 12 }
    expect(publicV28RiverPassage(progress, terrain, [site.id], offRail,
      { ...offRail, z: 12.16 })).toEqual({ ok: false, reason: 'river-needs-bridge' })
    expect(publicV28RiverPassage(progress, terrain, [site.id],
      { ...from, y: from.y + 1 }, { ...to, y: to.y + 1 }))
      .toEqual({ ok: false, reason: 'river-needs-bridge' })
    expect(projectPublicV28Pose(progress, terrain, [site.id], offRail)?.bridgeId).toBeNull()
    const corner = { x: -54, z: 10 }
    const diagonalFrom = { x: corner.x - 0.05, y: floor, z: corner.z - 0.05 }
    const diagonalTo = { x: corner.x + 0.05, y: floor, z: corner.z + 0.05 }
    expect(publicV28RiverPassage(progress, terrain, [site.id], diagonalFrom, diagonalTo))
      .toEqual({ ok: false, reason: 'river-needs-bridge' })
  })

  it('fails closed on malformed ledgers, segments and world edges', () => {
    const progress = streamedAt({ x: -56, z: 12 })
    const from = progress.state.player.position
    for (const ids of [[site.id, site.id], ['works6:river-bridge:-013'],
      ['works6:river-bridge:255', site.id], Array(129).fill(site.id)]) {
      expect(publicV28ResolvedRiverBridges(seed, ids)).toBeNull()
      expect(projectPublicV28Pose(progress, terrain, ids)).toBeNull()
      expect(publicV28RiverPassage(progress, terrain, ids, from,
        { ...from, z: from.z + 0.16 })).toEqual({ ok: false, reason: 'invalid-segment' })
    }
    expect(publicV28RiverPassage(progress, terrain, [site.id], from,
      { ...from, z: from.z + 0.25 })).toEqual({ ok: false, reason: 'invalid-segment' })
    expect(publicV28RiverPassage(progress, terrain, [site.id], from,
      { ...from, x: Number.NaN })).toEqual({ ok: false, reason: 'invalid-segment' })
    expect(publicV28RiverPassage(progress, terrain, [site.id], from,
      { ...from, x: 1024 })).toEqual({ ok: false, reason: 'invalid-segment' })
    expect(publicV28RiverPassage(progress, terrain, [site.id],
      { x: 1022, y: from.y, z: 12 }, { x: 1022.16, y: from.y, z: 12 }))
      .toEqual({ ok: false, reason: 'invalid-segment' })
  })
})
