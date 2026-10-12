import { describe, expect, it } from 'vitest'
import { encodeDiscoveredTileIds } from './discoveryMask'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { advancePublicV14BoundaryFrame } from './publicWorldV14Boundary'
import { createPublicV15ContinuousSession } from './publicWorldV15ContinuousSession'
import { advancePublicV15GreenwayFrame } from './publicWorldV15GreenwayFrame'
import { publicV15StarterSupportAt } from './publicWorldV15StarterMovement'
import { createFreshPublicV15Head } from './publicWorldV15Snapshot'
import { validatePublicV15Progress } from './publicWorldV15Validation'

const seed = 'greenway-alpha'
const move = (x: number, z: number) => [{ type: 'move' as const, delta: { x, z } }]
const walk = { walkRequested: true }
function startAt(z: number, bridgeBuilt: boolean) {
  const fresh = createFreshPublicV15Head(seed)
  const state = fresh.head.state
  const starterWorks = { bridgeBuilt, bankCacheDug: false }
  const context = { seed, profile: state.generationProfile,
    route: state.greenway.routes[0] ?? null, built: false, starterWorks }
  const support = publicV15StarterSupportAt(context, { x: 0, z })!
  const withPose = { ...state, player: { ...state.player,
    position: { x: 0, y: support.floorY, z },
    xp: bridgeBuilt ? 80 : 0,
    skillXp: { ...state.player.skillXp, construction: bridgeBuilt ? 80 : 0 } } }
  return { state: withPose, starterWorks, saveRevision: 1, lineage: fresh.lineage }
}

describe('v15 native continuous session', () => {
  it('streams across the west edge from a fresh revision-0 v15 session', () => {
    const fresh = createFreshPublicV15Head(seed)
    const session = createPublicV15ContinuousSession({ state: fresh.head.state,
      starterWorks: fresh.head.starterWorks, saveRevision: 0, lineage: fresh.lineage })
    for (let step = 0; step < 187; step++) {
      expect(session.advanceFrame(move(-0.16, 0), walk).rejections,
        `Greenway step ${step + 1}`).toEqual([])
    }
    expect(session.view().movementOwner).toBe('greenway')
    const crossing = session.advanceFrame(move(-0.16, 0), walk)
    expect(crossing.rejections).toEqual([])
    expect(session.view().movementOwner).toBe('streamed')
    expect(session.previewSnapshot().starterWorks).toEqual(fresh.head.starterWorks)
    expect(session.snapshotForSave()).toMatchObject({ status: 'needs-checked-commit',
      boundaryTransitions: 1 })
  })

  it('does not treat an altered v15 state as revision-0 genesis', () => {
    expect(() => createPublicV15ContinuousSession({ ...startAt(5.92, true),
      saveRevision: 0 })).toThrow('A validated v15 start is required.')
  })

  it('does not cross an unbuilt creek or advance its clock', () => {
    const session = createPublicV15ContinuousSession(startAt(5.92, false))
    expect(session.view().activeTiles.find((tile) => tile.center.x === 0
      && tile.center.z === 8)?.terrain).toBe('wetland')
    const before = session.previewSnapshot()
    const result = session.advanceFrame(move(0, 0.16), walk)
    expect(result.rejections[0]?.code).toBe('locked_area')
    expect(session.previewSnapshot()).toEqual(before)
    expect(session.snapshotForSave()).toMatchObject({ status: 'ready' })
  })

  it('walks the built deck and keeps flags in the preview and save pair', () => {
    const start = startAt(5.92, true)
    expect(validatePublicV15Progress({ state: start.state,
      starterWorks: start.starterWorks }, seed)).toBe(true)
    const session = createPublicV15ContinuousSession(start)
    for (let step = 0; step < 40; step++) {
      expect(session.advanceFrame(move(0, 0.16), walk).rejections).toEqual([])
      if (step === 12) expect(session.snapshotForSave()).toMatchObject({ status: 'ready',
        progress: { starterWorks: { bridgeBuilt: true } } })
    }
    expect(session.view().player.position.z).toBeCloseTo(12.32, 10)
    expect(session.previewSnapshot().starterWorks.bridgeBuilt).toBe(true)
    expect(session.snapshotForSave()).toMatchObject({ status: 'ready',
      progress: { starterWorks: { bridgeBuilt: true, bankCacheDug: false } } })
  })

  it('uses the same pure frame for local preview and a bounded replay', () => {
    const start = startAt(5.92, true)
    const session = createPublicV15ContinuousSession(start)
    const frames = [
      [{ type: 'look' as const, yawDelta: 0.1, pitchDelta: 0 }, ...move(0, 0.16)],
      move(0, 0.16), move(0, 0.16),
    ]
    let expected = { state: start.state, starterWorks: start.starterWorks }
    for (const intents of frames) {
      const next = advancePublicV15GreenwayFrame(expected, intents, walk)
      expect(next.rejections).toEqual([])
      expected = next.progress
      expect(session.advanceFrame(intents, walk).rejections).toEqual([])
    }
    expect(session.previewSnapshot()).toEqual(expected)
    expect(session.snapshotForSave()).toMatchObject({ status: 'ready', progress: expected })
  })

  it('crosses to the streamed owner and back without dropping starter works', () => {
    const fresh = createFreshPublicV15Head(seed)
    const base = fresh.head.state
    let selected: ReturnType<typeof startAt> | null = null
    for (let z = -28; z <= 32 && !selected; z += 4) {
      const starterWorks = { bridgeBuilt: true, bankCacheDug: false }
      const context = { seed, profile: base.generationProfile,
        route: base.greenway.routes[0] ?? null, built: false, starterWorks }
      const floor = publicV15StarterSupportAt(context, { x: -30, z })?.floorY
      if (floor === undefined) continue
      const mask = new Uint8Array(base.discoveryMask)
      const bits = encodeDiscoveredTileIds(nearbyWorldTileIds({ x: -30, z },
        PUBLIC_WALK_REVEAL_RADIUS_METERS))
      for (let index = 0; index < mask.length; index++) mask[index] |= bits[index]
      const state = { ...base, tick: 1, discoveryMask: mask,
        player: { ...base.player, xp: 80,
          skillXp: { ...base.player.skillXp, construction: 80 },
          position: { x: -30, y: floor, z } } }
      if (advancePublicV14BoundaryFrame(state, move(-0.16, 0), walk).candidate) {
        selected = { state, starterWorks, saveRevision: 1, lineage: fresh.lineage }
      }
    }
    if (!selected) throw new Error('No dry Greenway owner seam.')
    const session = createPublicV15ContinuousSession(selected)
    expect(session.advanceFrame(move(-0.16, 0), walk).rejections).toEqual([])
    expect(session.view().movementOwner).toBe('streamed')
    expect(session.previewSnapshot().starterWorks.bridgeBuilt).toBe(true)
    expect(session.advanceFrame(move(0.16, 0), walk).rejections).toEqual([])
    expect(session.view().movementOwner).toBe('greenway')
    expect(session.snapshotForSave()).toMatchObject({ status: 'needs-checked-commit',
      boundaryTransitions: 2, progress: { starterWorks: { bridgeBuilt: true } } })
  })
})
