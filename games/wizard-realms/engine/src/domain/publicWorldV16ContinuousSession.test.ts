import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { createPublicV16ContinuousSession, replayPublicV16Frames } from './publicWorldV16ContinuousSession'
import { resolvePublicV14Surface } from './publicWorldV14Terrain'
import { publicV16StarterSupportAt } from './publicWorldV16StarterMovement'
import { createFreshPublicV16Head } from './publicWorldV16Snapshot'
import { decodePublicV16Progress } from './publicWorldV16Validation'

const seed = 'wizard-realms'

function dugBoundaryStart(x: 12 | 16, owner: 'streamed' | 'greenway') {
  const { lineage, head } = createFreshPublicV16Head(seed)
  const greenwayWorks = { builtBridgeIds: [], builtLadderIds: [],
    dugTileIds: [`works3:dig:${x / 4}:8`] }
  const point = { x, z: owner === 'streamed' ? 34.16 : 34 }
  const context = { seed, profile: head.state.generationProfile,
    route: head.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks }
  const floor = owner === 'streamed'
    ? resolvePublicV14Surface({ ...head.state, movementOwner: owner }, point)?.floorY
    : publicV16StarterSupportAt(context, point)?.floorY
  if (floor === undefined) throw new Error('Missing fixture support')
  const state = { ...head.state, movementOwner: owner, tick: 1,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(head.state.discoveryMask),
      ...nearbyWorldTileIds(point, PUBLIC_WALK_REVEAL_RADIUS_METERS),
    ])].sort()),
    player: { ...head.state.player, xp: 30,
      skillXp: { ...head.state.player.skillXp, excavation: 30 },
      position: { ...point, y: floor } } }
  const progress = decodePublicV16Progress({ state, greenwayWorks }, seed)
  if (!progress) throw new Error('Invalid dug-boundary fixture')
  return { ...progress, saveRevision: 1, lineage }
}

describe('v16 dug Greenway owner boundary', () => {
  for (const x of [12, 16] as const) {
    it(`returns from streamed terrain onto the actual dug floor at x${x}`, () => {
      const start = dugBoundaryStart(x, 'streamed')
      const session = createPublicV16ContinuousSession(start)
      const frame = session.advanceFrame([{ type: 'move', delta: { x: 0, z: -0.16 } }],
        { walkRequested: true })
      const floor = publicV16StarterSupportAt({ seed,
        profile: start.state.generationProfile,
        route: start.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
        built: false, greenwayWorks: start.greenwayWorks }, { x, z: 34 })?.floorY
      expect(frame.rejections).toEqual([])
      expect(session.previewSnapshot().state).toMatchObject({ movementOwner: 'greenway',
        player: { position: { x, y: floor, z: 34 } } })
      expect(frame.events.find((event) => event.type === 'player_moved'))
        .toMatchObject({ position: { x, y: floor, z: 34 } })
      expect(session.snapshotForSave()).toMatchObject({ status: 'needs-checked-commit' })
      const replay = replayPublicV16Frames({ ...createFreshPublicV16Head(seed).head,
        saveRevision: 1, state: start.state, greenwayWorks: start.greenwayWorks },
      start.lineage, { kind: 'frame-batch/v1', frames: [{ intents: [
        { type: 'move', delta: { x: 0, z: -0.16 } }], walkRequested: true }] })
      expect(replay?.next).toEqual(session.previewSnapshot())
      expect(replay?.events).toEqual(frame.events)
    })
  }

  it('leaves a dug Greenway tile without replacing the native source pose', () => {
    const start = dugBoundaryStart(12, 'greenway')
    const session = createPublicV16ContinuousSession(start)
    const frame = session.advanceFrame([{ type: 'move', delta: { x: 0, z: 0.16 } }],
      { walkRequested: true })
    const expected = resolvePublicV14Surface({ ...start.state,
      movementOwner: 'streamed' }, { x: 12, z: 34.16 })?.floorY
    expect(frame.rejections).toEqual([])
    expect(start.state.player.position.y).not.toBe(expected)
    expect(session.previewSnapshot().state).toMatchObject({ movementOwner: 'streamed',
      player: { position: { x: 12, y: expected, z: 34.16 } } })
    expect(session.snapshotForSave()).toMatchObject({ status: 'needs-checked-commit' })
  })
})
