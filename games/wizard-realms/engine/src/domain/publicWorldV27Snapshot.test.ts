import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassRouteSites } from './mireglassRouteSites'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { visitPublicV23FramesWithEvents } from './publicWorldV23Transitions'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { applyPublicV24MireglassAction } from './publicWorldV24MireglassAction'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import { createPublicV26Root, replayPublicV26Witness } from './publicWorldV26Snapshot'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { STARTER_CLIFF_SITE_ID } from './starterCliffProfile'
import { worldTileAtGrid } from './worldChunks'
import { createPublicV27Root, decodePublicV27CheckedSuccessor, decodePublicV27Root, previewPublicV27Frames,
  publicV27MovementSegmentAccepted, replayPublicV27FramesWithEvents,
  replayPublicV27Witness } from './publicWorldV27Snapshot'
import type { PublicV27Progress } from './publicWorldV27Migration'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

const seed = 'wizard-realms'
const move = (x: number, z: number) => ({ kind: 'frame-batch/v1' as const,
  frames: [{ intents: [{ type: 'move' as const, delta: { x, z } }], walkRequested: false }] })
function rootAt(point?: { x: number; z: number }, excavation?: { gx: number; gz: number; depth: number }) {
  const v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const base = { state: v24.head.state, greenwayWorks: v24.head.greenwayWorks,
    regionalWorks: v24.head.regionalWorks }
  let shaped = base
  if (point) {
    const support = publicV17StarterSupportAt({ seed, profile: base.state.generationProfile,
      route: base.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null,
      built: false, greenwayWorks: base.greenwayWorks }, point)
    if (!support) throw new Error('Missing Greenway fixture support')
    const value = decodePublicV23Progress({ ...base, state: { ...base.state,
      player: { ...base.state.player, position: { ...point, y: support.floorY } } } }, seed)
    if (!value) throw new Error('Invalid Greenway fixture')
    shaped = value
  }
  const v25 = createPublicV25Root({ head: { ...v24.head, ...shaped,
    saveRevision: point ? 1 : 0, witness: point ? { kind: 'checkpoint' as const } : null },
    lineage: v24.lineage })
  const v25Head = excavation ? { ...v25.head, saveRevision: 1,
    witness: { kind: 'checkpoint' as const }, excavation: {
      ...v25.head.excavation, columns: [excavation] } } : v25.head
  const v26 = createPublicV26Root({ head: v25Head, lineage: v25.lineage })
  return createPublicV27Root({ head: v26.head, lineage: v26.lineage })
}
const progress = (head: PublicV27Progress): PublicV27Progress => ({ state: head.state,
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
  terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs })

describe('V27 checked movement replay', () => {
  it('preserves the visitor result and events for accepted dry movement', () => {
    const before = progress(rootAt().head)
    const frames = [move(0, -0.08).frames[0], move(0, -0.08).frames[0]]
    const visited = visitPublicV23FramesWithEvents({ state: before.state,
      greenwayWorks: before.greenwayWorks, regionalWorks: before.regionalWorks }, frames,
      () => true, false, { maxOrdinaryGroundStepMeters: 0.8 })
    const replayed = replayPublicV27FramesWithEvents(before, frames)
    expect(visited).not.toBeNull()
    expect(replayed).toEqual(visited && { progress: { ...visited.progress,
      terrain: before.terrain, nextHomeAtMs: before.nextHomeAtMs }, events: visited.events })
    expect(replayed?.events.length).toBeGreaterThan(0)
  })

  it('rejects empty, malformed and proxy frames and invalid initial state', () => {
    const before = progress(rootAt().head), valid = move(0, -0.08).frames[0]
    for (const frames of [[], [{ ...valid, walkRequested: 'false' }],
      [{ ...valid, extra: true }], Array.from({ length: 129 }, () => valid),
      [new Proxy(valid, {})]] as readonly unknown[][]) {
      expect(replayPublicV27FramesWithEvents(before, frames as never)).toBeNull()
    }
    expect(replayPublicV27FramesWithEvents({ ...before,
      state: new Proxy(before.state, {}) }, [valid])).toBeNull()
    expect(replayPublicV27FramesWithEvents({ ...before, nextHomeAtMs: -1 }, [valid])).toBeNull()
    expect(replayPublicV27FramesWithEvents({ ...before, state: { ...before.state,
      player: { ...before.state.player, position: { ...before.state.player.position,
        y: before.state.player.position.y - 1 } } } }, [valid])).toBeNull()
    const jump = [{ intents: [{ type: 'jump' as const }], walkRequested: false }]
    expect(previewPublicV27Frames(before, jump)).not.toBeNull()
    expect(replayPublicV27FramesWithEvents(before, jump)).toBeNull()
  })

  it('matches full-root successor replay for valid and forged canonical heads', () => {
    const genesis = rootAt()
    const first = { lineage: genesis.lineage, previous: genesis.head,
      head: { ...genesis.head, saveRevision: 1, witness: { kind: 'checkpoint' as const } } }
    const before = decodePublicV27Root(first)
    if (!before) throw new Error('Invalid first checked save')
    const next = { lineage: before.lineage, previous: before.head,
      head: { ...before.head, saveRevision: 2, witness: { kind: 'checkpoint' as const } } }
    const cases = [next,
      { ...next, head: { ...next.head, saveRevision: 3 } },
      { ...next, head: { ...next.head, witness: { kind: 'checkpoint', extra: true } } },
      { ...next, head: { ...next.head, state: { ...next.head.state,
        player: { ...next.head.state.player, coins: next.head.state.player.coins + 1 } } } },
      { ...next, head: { ...next.head, terrain: { ...next.head.terrain,
        columns: [{ gx: 1, gz: 1, openDepth: 1, pitLadder: false }] } } },
      { ...next, head: { ...next.head, nextHomeAtMs: -1 } },
    ]
    for (const candidate of cases) {
      expect(sameStrictBoundedRaw(candidate.lineage, before.lineage, 2 << 20)).toBe(true)
      expect(sameStrictBoundedRaw(candidate.previous, before.head, 2 << 20)).toBe(true)
      expect(decodePublicV27CheckedSuccessor(before, candidate))
        .toEqual(decodePublicV27Root(candidate))
    }
    const frozenLineage = { ...next, lineage: Object.freeze({ ...next.lineage }) }
    expect(sameStrictBoundedRaw(frozenLineage.lineage, before.lineage, 2 << 20)).toBe(false)
    expect(decodePublicV27Root(frozenLineage)).not.toBeNull()
    expect(decodePublicV27Root({ ...next, lineage: { ...next.lineage,
      sourceReceipt: { ...next.lineage.sourceReceipt, head: {
        ...next.lineage.sourceReceipt.head, saveRevision: 1 } } } })).toBeNull()
  }, 30_000)

  it('replays and reloads the 0.57 m dry Greenway/streamed owner join both ways', () => {
    const point = { x: 14.05, z: 33.95 }
    const root = rootAt(point)
    const forward = move(-0.1, 0.1)
    expect(replayPublicV26Witness(progress(root.head), forward)).toBeNull()
    const crossed = replayPublicV27Witness(progress(root.head), forward)
    expect(crossed?.state.movementOwner).toBe('streamed')
    if (!crossed) throw new Error('V27 dry owner join rejected')
    const saved = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...crossed, saveRevision: 1, witness: forward } }
    expect(decodePublicV27Root(saved)).toEqual(saved)
    const reverse = move(0.1, -0.1)
    const returned = replayPublicV27Witness(progress(saved.head), reverse)
    expect(returned?.state.movementOwner).toBe('greenway')
    expect(returned?.state.player.position.x).toBeCloseTo(point.x)
    expect(returned?.state.player.position.z).toBeCloseTo(point.z)
    expect(decodePublicV27Root({ lineage: root.lineage, previous: saved.head,
      head: { ...saved.head, ...returned, saveRevision: 2, witness: reverse } })).not.toBeNull()
  })
  it('opens the default-seed ordinary dry pair north of the built starter ladder', () => {
    const worldSeed = 'greenway-alpha'
    const west = worldTileAtGrid(worldSeed, 0, -2)
    const east = worldTileAtGrid(worldSeed, 1, -2)
    expect([west.center.x, west.center.z, east.center.x, east.center.z]).toEqual([0, -8, 4, -8])
    expect(Math.abs(east.center.y - west.center.y)).toBeCloseTo(0.641, 3)
    const v23 = createPublicV23Root(worldSeed)
    const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
    const point = { x: 1.95, z: -8 }
    const state = { ...v24.head.state, greenway: { ...v24.head.state.greenway,
      builtRouteIds: ['greenway_ladder' as const],
      routes: v24.head.state.greenway.routes.map((route) => route.id === 'greenway_ladder'
        ? { ...route, siteId: STARTER_CLIFF_SITE_ID } : route) },
    player: { ...v24.head.state.player, xp: v24.head.state.player.xp + 60,
      skillXp: { ...v24.head.state.player.skillXp,
        construction: v24.head.state.player.skillXp.construction + 60 } } }
    const route = state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
    const support = publicV17StarterSupportAt({ seed: worldSeed,
      profile: state.generationProfile, route, built: true,
      greenwayWorks: v24.head.greenwayWorks }, point)
    if (!support) throw new Error('Missing built Greenway support')
    const base = decodePublicV23Progress({ state: { ...state,
      player: { ...state.player, position: { ...point, y: support.floorY } } },
    greenwayWorks: v24.head.greenwayWorks, regionalWorks: v24.head.regionalWorks }, worldSeed)
    if (!base) throw new Error('Invalid built Greenway source')
    const v25 = createPublicV25Root({ head: { ...v24.head, ...base,
      saveRevision: 1, witness: { kind: 'checkpoint' as const } }, lineage: v24.lineage })
    const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
    const root = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
    expect(decodePublicV27Root(root)).toEqual(root)
    const forward = move(0.1, 0)
    expect(replayPublicV26Witness(progress(root.head), forward)).toBeNull()
    const crossed = replayPublicV27Witness(progress(root.head), forward)
    expect(crossed?.state.player.position.x).toBeCloseTo(2.05)
    if (!crossed) throw new Error('V27 default-seed dry pair rejected')
    expect(replayPublicV26Witness(crossed, move(-0.1, 0))).toBeNull()
    expect(replayPublicV27Witness(crossed, move(-0.1, 0))?.state.player.position.x)
      .toBeCloseTo(point.x)
  })

  it.each([
    ['west lip', { x: -20, z: -2.05 }, { x: 0, z: 0.1 }],
    ['southwest lip', { x: 5.95, z: 12 }, { x: 0.1, z: 0 }],
    ['east lip', { x: 13.95, z: 4 }, { x: 0.1, z: 0 }],
    ['far east lip', { x: 13.95, z: 32 }, { x: 0.1, z: 0 }],
    ['southern lip', { x: 17.95, z: 16 }, { x: 0.1, z: 0 }],
  ] as const)('opens the ordinary dry %s in both directions', (_label, point, delta) => {
    const root = rootAt(point), witness = move(delta.x, delta.z)
    expect(replayPublicV26Witness(progress(root.head), witness)).toBeNull()
    const crossed = replayPublicV27Witness(progress(root.head), witness)
    expect(crossed).not.toBeNull()
    if (!crossed) throw new Error('V27 dry lip rejected')
    const back = replayPublicV27Witness(crossed, move(-delta.x, -delta.z))
    expect(back?.state.player.position.x).toBeCloseTo(point.x)
    expect(back?.state.player.position.z).toBeCloseTo(point.z)
  })

  it('accepts ordinary 0.65 m dry lip in either direction without changing V26 replay', () => {
    const root = rootAt({ x: 13.95, z: 4 }), witness = move(0.1, 0)
    const old = replayPublicV26Witness(progress(root.head), witness)
    expect(old).toBeNull()
    const effects = replayPublicV27FramesWithEvents(progress(root.head), witness.frames)
    expect(effects?.progress.state.player.position.x).toBeCloseTo(14.05)
    expect(effects?.events).toEqual(expect.any(Array))
    const next = replayPublicV27Witness(progress(root.head), witness)
    expect(next).toEqual(effects?.progress)
    if (!next) throw new Error('V27 ordinary crossing rejected')
    const crossed = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...next, saveRevision: 1, witness } }
    expect(decodePublicV27Root(crossed)).toEqual(crossed)
    const reverse = move(-0.1, 0)
    const back = replayPublicV27Witness(progress(crossed.head), reverse)
    expect(back?.state.player.position.x).toBeCloseTo(13.95)
    expect(decodePublicV27Root({ lineage: root.lineage, previous: crossed.head,
      head: { ...crossed.head, ...back, saveRevision: 2, witness: reverse } })).not.toBeNull()
  })

  it('keeps the river, authored rim, and unladdered pit closed', () => {
    for (const [point, delta] of [
      [{ x: 12, z: 5.9 }, { x: 0, z: 0.16 }],
      [{ x: 28, z: -5.95 }, { x: 0, z: -0.1 }],
    ] as const) {
      const root = rootAt(point)
      expect(replayPublicV27Witness(progress(root.head), move(delta.x, delta.z))).toBeNull()
    }
    const pit = rootAt({ x: 12, z: -1.95 }, { gx: 3, gz: 0, depth: 2 })
    expect(pit.head.terrain.columns[0].openDepth).toBe(2)
    expect(replayPublicV27Witness(progress(pit.head), move(0, -0.1))).toBeNull()
  })

  it('does not grant the 0.8 m dry-ground allowance to an authored streamed ladder', () => {
    const site = mireglassRouteSites(seed).find((entry) => entry.kind === 'ladder')!
    const initial = createPublicV23Root(seed).head
    const base = { state: initial.state, greenwayWorks: initial.greenwayWorks,
      regionalWorks: initial.regionalWorks }
    const at = (current: typeof base, t: number) => {
      const point = { x: site.from.x + (site.to.x - site.from.x) * t,
        z: site.from.z + (site.to.z - site.from.z) * t }
      const state = { ...current.state, movementOwner: 'streamed' as const }
      const surface = resolvePublicV23Surface(state, point, current.regionalWorks.builtLadderIds)!
      const discoveryMask = encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(state.discoveryMask), surface.tileId])].sort())
      const result = decodePublicV23Progress({ ...current, state: { ...state, discoveryMask,
        player: { ...state.player, position: { ...point, y: surface.floorY } } } }, seed)
      if (!result) throw new Error('Invalid streamed ladder fixture')
      return { result, surface }
    }
    const approach = at(base, 0).result
    const logs = { ...approach, state: { ...approach.state,
      player: { ...approach.state.player, inventory: [...approach.state.player.inventory,
        { itemId: 'logs' as const, quantity: site.logCost }] } } }
    const built = applyPublicV24MireglassAction(logs,
      { type: 'build_route', siteId: site.id })
    if ('rejection' in built) throw new Error(`Could not build streamed ladder: ${built.rejection}`)
    const from = at(built.progress, 0.4625), to = at(built.progress, 0.5375)
    expect([from.surface.support, to.surface.support]).toEqual(['authored_route', 'authored_route'])
    expect(Math.abs(to.surface.floorY - from.surface.floorY)).toBeGreaterThan(0.55)
    expect(Math.abs(to.surface.floorY - from.surface.floorY)).toBeLessThan(0.8)
    const wrapped = (current: typeof from.result): PublicV27Progress => ({ ...current,
      terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0 })
    expect(publicV27MovementSegmentAccepted(wrapped(from.result), wrapped(to.result))).toBe(false)
  })

  it('preserves inherited actions, disallows durable airborne saves, and rejects tampering', () => {
    const root = rootAt(), checkpoint = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, saveRevision: 1, witness: { kind: 'checkpoint' as const } } }
    expect(decodePublicV27Root(root)).toEqual(root)
    expect(decodePublicV27Root(checkpoint)).toEqual(checkpoint)
    const jump = [{ intents: [{ type: 'jump' as const }], walkRequested: false }]
    expect(previewPublicV27Frames(progress(root.head), jump)?.state.player.verticalVelocity)
      .not.toBe(0)
    expect(replayPublicV27Witness(progress(root.head), { kind: 'frame-batch/v1', frames: jump }))
      .toBeNull()
    expect(decodePublicV27Root({ ...checkpoint, head: { ...checkpoint.head,
      state: { ...checkpoint.head.state, player: { ...checkpoint.head.state.player,
        coins: checkpoint.head.state.player.coins + 1 } } } })).toBeNull()
    expect(decodePublicV27Root({ ...checkpoint, extra: true })).toBeNull()
    expect(decodePublicV27Root({ ...checkpoint, head: { ...checkpoint.head,
      witness: { kind: 'checkpoint', extra: true } } })).toBeNull()
  }, 30_000)
})
