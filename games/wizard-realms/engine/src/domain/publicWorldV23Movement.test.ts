import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { createPublicV14StreamTerrain, createPublicV23StreamTerrain,
  resolvePublicV14Surface, resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { resolvePublicV23Site } from './publicWorldV23Sites'
import { visitPublicV23FramesWithEvents } from './publicWorldV23Transitions'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import type { PublicV14Frame, PublicV14State } from './publicWorldV14Snapshot'

const seed = 'greenway-alpha'
const id = (q: number) => `works5:ladder:mireglass-slate:W:-103:${q}`
const base = createPublicV23Root(seed).head.state

function standing(x: number, z: number, ids: string[]): PublicV14State {
  const surface = resolvePublicV23Surface(base, { x, z }, ids)
  if (!surface) throw new Error('Missing test support')
  return { ...base, movementOwner: 'streamed',
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(base.discoveryMask), surface.tileId])].sort()),
    player: { ...base.player, position: { x, y: surface.floorY, z }, verticalVelocity: 0 } }
}

function step(runtime: ReturnType<typeof createPublicV23StreamTerrain>, dx: number, dz = 0) {
  return runtime.advance([{ type: 'move', delta: { x: dx, z: dz } }],
    { atomicOnRejection: true })
}

describe('V23 west-facing ladder movement', () => {
  it.each([4306, 4334])('climbs and descends the actual rungs at q=%i', (q) => {
    const site = resolvePublicV23Site(seed, id(q))!
    const runtime = createPublicV23StreamTerrain(standing(site.from.x, site.from.z, [site.id]), [site.id])
    for (let index = 0; index < 20; index++) {
      const result = step(runtime, -0.2)
      expect(result.rejections, `westward step ${index}`).toEqual([])
      expect(result.state.player.position.x).toBeCloseTo(site.from.x - (index + 1) * 0.2)
      expect(result.state.player.position.y).toBeCloseTo(
        resolvePublicV23Surface(base, result.state.player.position, [site.id])!.floorY)
    }
    expect(runtime.state.player.position.x).toBeCloseTo(site.to.x)
    expect(runtime.state.player.position.y).toBeCloseTo(site.to.y)
    expect(runtime.state.player.position.z).toBe(site.to.z)
    for (let index = 0; index < 20; index++) {
      const result = step(runtime, 0.2)
      expect(result.rejections, `eastward step ${index}`).toEqual([])
      expect(result.state.player.position.y).toBeCloseTo(
        resolvePublicV23Surface(base, result.state.player.position, [site.id])!.floorY)
    }
    expect(runtime.state.player.position.x).toBeCloseTo(site.from.x)
    expect(runtime.state.player.position.y).toBeCloseTo(site.from.y)
    expect(runtime.state.player.position.z).toBe(site.from.z)
  })

  it.each([4306, 4334])('blocks bare cliff and side entry at q=%i', (q) => {
    const site = resolvePublicV23Site(seed, id(q))!
    const unbuilt = createPublicV23StreamTerrain(standing(-413.9, site.from.z, []), [])
    expect(step(unbuilt, -0.2).rejections).toMatchObject([{ code: 'slate_cliff' }])
    const sideSign = q === 4306 ? 1 : -1
    const bareZ = site.from.z + sideSign * (site.widthMeters / 2 + 0.1)
    const bare = createPublicV23StreamTerrain(standing(-413.9, bareZ, [site.id]), [site.id])
    expect(step(bare, -0.2).rejections).toMatchObject([{ code: 'slate_cliff' }])
    const side = createPublicV23StreamTerrain(standing(-414, bareZ, [site.id]), [site.id])
    expect(step(side, 0, -sideSign * 0.2).rejections).toMatchObject([{ code: 'slate_cliff' }])
    const sideExit = createPublicV23StreamTerrain(
      standing(-414, site.from.z + sideSign * 0.45, [site.id]), [site.id])
    expect(step(sideExit, 0, sideSign * 0.2).rejections).toMatchObject([{ code: 'slate_cliff' }])
    expect(() => createPublicV23StreamTerrain(standing(-413.9, site.from.z, []), [id(4305)]))
      .toThrow(RangeError)
  })

  it('restores a built rung and rejects the same pose without its saved ladder ID', () => {
    const site = resolvePublicV23Site(seed, id(4306))!
    const rung = standing(-414, site.from.z, [site.id])
    expect(rung.player.position.y).toBeCloseTo(1.62)
    expect(resolvePublicV23Surface(base, rung.player.position, [])?.support).toBe('terrain')
    expect(resolvePublicV23Surface(base, rung.player.position, [])?.floorY).not.toBeCloseTo(1.62)
    expect(createPublicV23StreamTerrain(rung, [site.id]).state.player.position).toEqual(rung.player.position)
    expect(() => createPublicV23StreamTerrain(rung, [])).toThrow(RangeError)
  })

  it('keeps legacy Greenway and empty-regional streamed surfaces identical', () => {
    for (const point of [{ x: 0, z: -5.6 }, { x: -412, z: 432 }, { x: -414, z: 432 }]) {
      expect(resolvePublicV23Surface(base, point, [])).toEqual(resolvePublicV14Surface(base, point))
    }
    const state = standing(-412, 432, [])
    const oldRuntime = createPublicV14StreamTerrain(state)
    const newRuntime = createPublicV23StreamTerrain(state, [])
    expect(step(newRuntime, -0.2)).toEqual(oldRuntime.advance([
      { type: 'move', delta: { x: -0.2, z: 0 } }], { atomicOnRejection: true }))
  })
})

describe('V23 streamed dry-step witnesses', () => {
  const move = (x: number, z = 0) => ({ intents: [{ type: 'move' as const,
    delta: { x, z } }], walkRequested: false })
  const idle = { intents: [], walkRequested: false }
  const replay = (x: number, z: number, frames: readonly PublicV14Frame[], allowAirborne = false) => {
    const { head } = createPublicV23Root(seed)
    const before = { state: standing(x, z, []),
      greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }
    expect(decodePublicV23Progress(before, seed)).not.toBeNull()
    return visitPublicV23FramesWithEvents(before,
    frames, () => true, allowAirborne)
  }

  it('settles a 6.8 cm dry descent only for a newly grounded terminal step', () => {
    const x = -202.04, z = -20, east = move(0.16)
    const from = resolvePublicV23Surface(base, { x, z }, [])!
    const to = resolvePublicV23Surface(base, { x: x + 0.16, z }, [])!
    expect(from.floorY - to.floorY).toBeCloseTo(0.06761593123659226)
    expect(replay(x, z, [east], true)?.progress.state.player.verticalVelocity).toBeLessThan(0)
    const settled = replay(x, z, [east])
    expect(settled?.progress.state.player.position.y).toBe(to.floorY)
    expect(settled?.progress.state.player.verticalVelocity).toBe(0)
    expect(settled?.events.find((event) => event.type === 'player_moved'))
      .toMatchObject({ position: settled?.progress.state.player.position })
    const airborne = standing(-170.04, 16.68, [])
    expect(decodePublicV23Progress({ state: { ...airborne,
      player: { ...airborne.player, verticalVelocity: -0.49 } },
    greenwayWorks: createPublicV23Root(seed).head.greenwayWorks,
    regionalWorks: createPublicV23Root(seed).head.regionalWorks }, seed)).toBeNull()
  })

  it('still rejects a dry terrain descent beyond 10 cm', () => {
    const point = { x: -2.04, z: -92 }
    const source = resolvePublicV23Surface(base, point, [])!
    const target = resolvePublicV23Surface(base, { x: point.x + 0.16, z: point.z }, [])!
    expect(source.support).toBe('terrain')
    expect(target.support).toBe('terrain')
    expect(source.floorY - target.floorY).toBeGreaterThan(0.10)
    const preview = replay(point.x, point.z, [move(0.16)], true)
    expect(preview).not.toBeNull()
    expect(preview!.progress.state.player.position.y - target.floorY).toBeGreaterThan(0.10)
    expect(preview?.progress.state.player.verticalVelocity).toBeLessThan(0)
    expect(replay(point.x, point.z, [move(0.16)])).toBeNull()
  })

  it('reproduces both terminal dry micro-drops while retaining old two-frame witnesses', async () => {
    const bridge = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const prebridge = { x: bridge.approach.x, z: bridge.from.z - 2.08 }
    for (const { point, step } of [
      { point: { x: -170.04, z: 16.68 }, step: move(0.16) },
      { point: prebridge, step: move(0, 0.16) },
    ]) {
      const settled = replay(point.x, point.z, [step])
      expect(settled?.progress.state.player.verticalVelocity).toBe(0)
      expect(settled?.progress.state.player.position.y).toBeCloseTo(
        resolvePublicV23Surface(base, settled!.progress.state.player.position, [])!.floorY)
      expect(settled?.events.find((event) => event.type === 'player_moved'))
        .toMatchObject({ position: settled?.progress.state.player.position })
      expect(visitPublicV23FramesWithEvents(settled!.progress, [idle], () => true)).not.toBeNull()
      expect(replay(point.x, point.z, [step, idle])).not.toBeNull()
      expect(replay(point.x, point.z, [step, step])).not.toBeNull()
    }
    const hashes: string[] = []
    for (const frames of [[move(0.16), idle], [move(0.16), move(0.16)]]) {
      const bytes = new TextEncoder().encode(JSON.stringify(replay(-170.04, 16.68, frames)))
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      hashes.push(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''))
    }
    expect(hashes).toEqual([
      '39630b055206c44ab6aa1b2e919ea5088ce798e818807815d25587d7e71a27e4',
      '9fa7691aa716e232fda02fe34df9120ecfc9b37c4539a385261aab7627b68bba',
    ])
  })
})
