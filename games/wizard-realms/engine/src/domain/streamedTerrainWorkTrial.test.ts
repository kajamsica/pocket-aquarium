import { describe, expect, it } from 'vitest'
import { createStreamedTerrainWorkTrial, terrainWorkTrialRequested } from './streamedTerrainWorkTrial'
import { createStreamedWorld, createStreamedWorldFromState } from './streamedWorld'
import type { StreamedWorldRuntime } from './streamedWorld'
import { createStreamedWorldV13FromState } from './terrainWorkRuntimeHooks'
import { resolveTerrainWorkSite } from './terrainWorks'

const seed = 'greenway-alpha'
const bridgeId = 'works1:bridge:-102:92:z'
const ladderId = 'works1:ladder:-103:108:W'
const digId = 'tile--64-76'
const structure = (id: string) => {
  const site = resolveTerrainWorkSite(seed, id)
  if (!site || site.kind === 'dig') throw new Error(`Missing structure ${id}`)
  return site
}
const step = (runtime: StreamedWorldRuntime, dx: number, dz: number) =>
  runtime.advance([{ type: 'move', delta: { x: dx, z: dz } }])
const context = { seed, fieldCampTileIds: [], authoredBuiltRouteIds: [] }
const ledger = (builtWorkIds: string[] = [], dugTileIds: string[] = []) =>
  ({ builtWorkIds, dugTileIds })

describe('opt-in unsaved terrain-work streamed runtime', () => {
  it.each([
    [bridgeId, 0, 1], [ladderId, -1, 0],
  ] as const)('rehydrates the exact mid-route %s pose and first steps at both walking gaits',
    (id, xDirection, zDirection) => {
      for (const gait of [0.16, 0.24]) {
        const site = structure(id)
        const trial = createStreamedTerrainWorkTrial(seed, site.from)
        if (gait === 0.24) trial.toggleFootwear()
        expect(trial.confirm(id).event?.type).toBe('terrain_work_built')
        for (let i = 0; i < 9; i++) {
          const result = step(trial, xDirection * gait, zDirection * gait)
          expect(result.rejections, `${id} gait ${gait} step ${i} at ${JSON.stringify(result.state.player.position)}`).toEqual([])
        }
        const snapshot = trial.state
        const resumed = createStreamedWorldV13FromState(snapshot, ledger([id]), context)
        expect(resumed.state).toEqual(snapshot)
        expect(resumed.state.player.position).toEqual(snapshot.player.position)
        expect(step(resumed, xDirection * gait, zDirection * gait))
          .toEqual(step(trial, xDirection * gait, zDirection * gait))
        expect(step(resumed, -xDirection * gait, -zDirection * gait))
          .toEqual(step(trial, -xDirection * gait, -zDirection * gait))
        const below = { ...snapshot, player: { ...snapshot.player,
          position: { ...snapshot.player.position, y: snapshot.player.position.y - 0.01 } } }
        expect(() => createStreamedWorldV13FromState(below, ledger([id]), context))
          .toThrow('Invalid streamed-world snapshot position.')
        const before = resumed.state
        const forgedBatch = resumed.advance(Array.from({ length: 25 }, () =>
          ({ type: 'move' as const, delta: { x: xDirection * gait, z: zDirection * gait } })))
        expect(forgedBatch.state).toBe(before)
        expect(forgedBatch.rejections[0]).toMatchObject({ intentIndex: 1, code: 'invalid_value' })
      }
    })

  it('keeps descending ladder feet on the support instead of hovering after reload', () => {
    const site = structure(ladderId)
    const trial = createStreamedTerrainWorkTrial(seed, site.from)
    expect(trial.confirm(ladderId).event?.type).toBe('terrain_work_built')
    for (let i = 0; i < 12; i++) expect(step(trial, -0.16, 0).rejections).toEqual([])
    const resumed = createStreamedWorldV13FromState(trial.state, ledger([ladderId]), context)
    const priorY = resumed.state.player.position.y
    const reversed = step(resumed, 0.16, 0)
    expect(reversed.rejections).toEqual([])
    expect(reversed.state.player.position.y).toBeLessThan(priorY)
    expect(reversed.state.player.verticalVelocity).toBe(0)
    expect(reversed).toEqual(step(trial, 0.16, 0))
    const lateral = { ...resumed.state, player: { ...resumed.state.player,
      position: { ...resumed.state.player.position, z: site.from.z + 0.48 } } }
    const edge = createStreamedWorldV13FromState(lateral, ledger([ladderId]), context)
    expect(step(edge, 0, 0.16).rejections[0]?.code).toBe('slate_cliff')
  })

  it('loads lowered dug ground without a snap and binds each runtime to its own ledger', () => {
    const site = resolveTerrainWorkSite(seed, digId)
    if (!site || site.kind !== 'dig') throw new Error('Missing suitable dig fixture.')
    const trial = createStreamedTerrainWorkTrial(seed, site.center)
    const before = createStreamedWorldV13FromState(trial.state, ledger(), context)
    expect(trial.confirm(digId).event?.type).toBe('terrain_work_dug')
    for (let i = 0; i < 10; i++) trial.advance([])
    const snapshot = trial.state
    expect(() => createStreamedWorldFromState(snapshot)).toThrow('Invalid streamed-world snapshot position.')
    const resumed = createStreamedWorldV13FromState(snapshot, ledger([], [digId]), context)
    expect(resumed.state).toEqual(snapshot)
    expect(resumed.tileAtWorld(site.center.x, site.center.z)!.center.y)
      .toBeCloseTo(site.center.y - 0.24)
    expect(resumed.advance([]).state.player.position.y).toBe(snapshot.player.position.y)
    expect(before.tileAtWorld(site.center.x, site.center.z)!.center.y).toBeCloseTo(site.center.y)
    expect(() => createStreamedWorldV13FromState(snapshot, ledger(), context))
      .toThrow('Invalid streamed-world snapshot position.')
  })

  it('does not open wrong-site or lateral corridors, and composes authored support on load', () => {
    const site = structure(ladderId)
    const trial = createStreamedTerrainWorkTrial(seed, site.from)
    expect(trial.confirm(ladderId).event?.type).toBe('terrain_work_built')
    for (let i = 0; i < 9; i++) step(trial, -0.16, 0)
    const snapshot = trial.state
    expect(() => createStreamedWorldV13FromState(snapshot, ledger(['works1:ladder:0:0:W']), context))
      .toThrow('Invalid terrain-work ledger.')
    expect(() => createStreamedWorldV13FromState(snapshot, ledger([ladderId]),
      { ...context, seed: 'other-seed' })).toThrow('Invalid terrain-work ledger.')
    const wrongStart = createStreamedTerrainWorkTrial(seed, site.from).state
    const wrong = createStreamedWorldV13FromState(wrongStart, ledger([bridgeId]), context)
    let wrongSiteBlocked = false
    for (let i = 0; i < 25; i++) {
      const result = step(wrong, -0.16, 0)
      if (result.rejections.some((rejection) => rejection.code === 'slate_cliff')) {
        wrongSiteBlocked = true
        break
      }
    }
    expect(wrongSiteBlocked).toBe(true)
    const lateral = { ...snapshot, player: { ...snapshot.player,
      position: { ...snapshot.player.position, z: site.from.z + 0.48 } } }
    const built = createStreamedWorldV13FromState(lateral, ledger([ladderId]), context)
    expect(step(built, 0, 0.16).rejections[0]?.code).toBe('slate_cliff')
    const facts = { cachePitDug: false, routeSupport: {
      at: () => null, crossing: () => null, clearsMireglassBarrier: () => false,
      floorY: (_position: { x: number; z: number }, groundY: number) => groundY + 0.2,
    } }
    expect(() => createStreamedWorldV13FromState(snapshot, ledger([ladderId]), context, facts))
      .toThrow('Invalid streamed-world snapshot position.')
    const raised = { ...snapshot, player: { ...snapshot.player,
      position: { ...snapshot.player.position, y: snapshot.player.position.y + 0.2 } } }
    expect(createStreamedWorldV13FromState(raised, ledger([ladderId]), context, facts)
      .state.player.position.y).toBe(raised.player.position.y)
    const old = createStreamedWorldFromState(snapshot)
    const omitted = createStreamedWorldFromState(snapshot, undefined, undefined)
    expect(old.state).toEqual(omitted.state)
    expect(step(old, 0, 0.16)).toEqual(step(omitted, 0, 0.16))
  })
  it.each([[bridgeId, 0, 0.16], [ladderId, -0.16, 0]] as const)(
    'walks %s forward and back through only its narrow built corridor', (id, dx, dz) => {
      const site = structure(id)
      const ordinary = createStreamedWorld(seed, site.from)
      const trial = createStreamedTerrainWorkTrial(seed, site.from)
      expect(trial.preview(id).rejection).toBeNull()
      expect(trial.confirm(id).event?.type).toBe('terrain_work_built')
      expect(trial.builtSites()[0].supportPath).toEqual(site.supportPath)
      const first = step(trial, dx, dz)
      expect(first.rejections).toEqual([])
      expect(first.state.player.position.x).toBeCloseTo(site.from.x + dx)
      expect(first.state.player.position.z).toBeCloseTo(site.from.z + dz)
      expect(Math.hypot(first.state.player.position.x - site.to.x,
        first.state.player.position.z - site.to.z)).toBeGreaterThan(3)
      const forwardY = [first.state.player.position.y]
      const steps = Math.round(Math.hypot(site.to.x - site.from.x, site.to.z - site.from.z) / 0.16)
      for (let i = 1; i < steps; i++) {
        const result = step(trial, dx, dz)
        expect(result.rejections, `forward step ${i}`).toEqual([])
        forwardY.push(result.state.player.position.y)
      }
      expect(trial.state.player.position.x).toBeCloseTo(site.to.x)
      expect(trial.state.player.position.z).toBeCloseTo(site.to.z)
      expect(Math.max(...forwardY)).toBeGreaterThan(site.from.y)
      if (site.kind === 'ladder') {
        expect(forwardY.some((y) => y > site.from.y + 0.1 && y < site.to.y - 0.1)).toBe(true)
        expect(trial.state.player.position.y).toBeCloseTo(site.to.y)
      }
      for (let i = 0; i < steps; i++) {
        const result = step(trial, -dx, -dz)
        expect(result.rejections, `reverse step ${i}`).toEqual([])
      }
      expect(trial.state.player.position.x).toBeCloseTo(site.from.x)
      expect(trial.state.player.position.z).toBeCloseTo(site.from.z)
      for (let i = 0; i < 12; i++) trial.advance([])
      expect(trial.state.player.position.y).toBeCloseTo(site.from.y)
      expect(step(ordinary, dx, dz).state.player.position).toMatchObject(
        { x: site.from.x + dx, z: site.from.z + dz })
    })
  it('rejects off-corridor crossings and overlong trial moves while baseline remains unchanged', () => {
    const site = structure(bridgeId)
    const trial = createStreamedTerrainWorkTrial(seed, { x: site.from.x + 1, z: site.from.z })
    expect(trial.confirm(bridgeId).event?.type).toBe('terrain_work_built')
    expect(step(trial, 0, 4).rejections[0]?.code).toBe('invalid_value')
    let blocked = false
    for (let i = 0; i < 40; i++) {
      const result = step(trial, 0, 0.16)
      if (result.rejections.some((rejection) => rejection.code === 'fen_channel')) {
        blocked = true
        break
      }
    }
    expect(blocked).toBe(true)
    const base = createStreamedWorld(seed, site.from)
    expect(base.advance([{ type: 'move', delta: { x: 0, z: 4 } }]).rejections[0]?.code).not.toBe('invalid_value')
    const omitted = createStreamedWorld(seed, site.from)
    const explicitNone = createStreamedWorld(seed, site.from, undefined, undefined)
    for (const intents of [[{ type: 'move', delta: { x: 0, z: 4 } }], []] as const) {
      expect(explicitNone.advance(intents)).toEqual(omitted.advance(intents))
    }
  })

  it('rejects a forged 50-move bridge batch atomically but keeps look plus one move', () => {
    const site = structure(bridgeId)
    const trial = createStreamedTerrainWorkTrial(seed, site.from)
    expect(trial.confirm(bridgeId).event?.type).toBe('terrain_work_built')
    const before = trial.state
    const forged = trial.advance(Array.from({ length: 50 }, () =>
      ({ type: 'move' as const, delta: { x: 0, z: 0.16 } })))
    expect(forged.rejections).toEqual([{ intentIndex: 1, intentType: 'move', code: 'invalid_value' }])
    expect(forged.events).toEqual([])
    expect(forged.state).toBe(before)
    expect(trial.state.tick).toBe(before.tick)
    const legitimate = trial.advance([
      { type: 'look', yawDelta: 0.1, pitchDelta: 0 },
      { type: 'move', delta: { x: 0, z: 0.16 } },
    ])
    expect(legitimate.rejections).toEqual([])
    expect(legitimate.state.tick).toBe(before.tick + 1)
    expect(legitimate.state.player.position.z).toBeCloseTo(site.from.z + 0.16)
  })

  it('starts barefoot walking, gates running on trial boots, and resets to walking when removed', () => {
    const site = structure(bridgeId)
    const trial = createStreamedTerrainWorkTrial(seed, site.from)
    const initial = trial.state
    expect(trial.bootsEquipped).toBe(false)
    expect(trial.gait).toMatchObject({ canRun: false, pace: 'walk', metersPerStep: 0.16 })
    expect(step(trial, 0, 0.24).rejections[0]?.code).toBe('invalid_value')
    expect(trial.state).toBe(initial)
    expect(step(trial, 0, 0.16).rejections).toEqual([])

    trial.toggleFootwear()
    expect(trial.bootsEquipped).toBe(true)
    expect(trial.gait).toMatchObject({ canRun: true, pace: 'run', metersPerStep: 0.24 })
    expect(step(trial, 0, 0.24).rejections).toEqual([])
    trial.toggleWalk()
    expect(trial.gait).toMatchObject({ canRun: true, pace: 'walk', metersPerStep: 0.16 })
    const walking = trial.state
    expect(step(trial, 0, 0.24).rejections[0]?.code).toBe('invalid_value')
    expect(trial.state).toBe(walking)
    expect(step(trial, 0, 0.16).rejections).toEqual([])

    trial.toggleFootwear()
    expect(trial.gait).toMatchObject({ canRun: false, pace: 'walk', metersPerStep: 0.16 })
    trial.toggleFootwear()
    expect(trial.gait).toMatchObject({ canRun: true, pace: 'run', metersPerStep: 0.24 })
  })

  it('rejects lateral and diagonal mid-ladder entry without a height jump', () => {
    for (const delta of [{ x: 0, z: -0.08 }, { x: -0.08, z: -0.08 }]) {
      const trial = createStreamedTerrainWorkTrial(seed, { x: -413.9, z: 432.56 })
      expect(trial.confirm(ladderId).event?.type).toBe('terrain_work_built')
      const before = trial.state.player.position
      const result = step(trial, delta.x, delta.z)
      expect(result.rejections[0]?.code).toBe('slate_cliff')
      expect(result.state.player.position).toEqual(before)
    }
  })

  it('still permits longitudinal ladder entry from either end', () => {
    const site = structure(ladderId)
    const trial = createStreamedTerrainWorkTrial(seed, site.from)
    expect(trial.confirm(ladderId).event?.type).toBe('terrain_work_built')
    expect(step(trial, 0.16, 0).rejections).toEqual([])
    expect(step(trial, -0.16, 0).rejections).toEqual([])
    for (let i = 0; i < 25; i++) expect(step(trial, -0.16, 0).rejections).toEqual([])
    expect(trial.state.player.position.x).toBeCloseTo(site.to.x)
    expect(step(trial, -0.16, 0).rejections).toEqual([])
    expect(step(trial, 0.16, 0).rejections).toEqual([])
    expect(trial.state.player.position.x).toBeCloseTo(site.to.x)
  })

  it('allows ordinary lateral walking at both dry ladder feet', () => {
    const site = structure(ladderId)
    const low = createStreamedTerrainWorkTrial(seed, site.from)
    expect(low.confirm(ladderId).event?.type).toBe('terrain_work_built')
    for (let i = 0; i < 4; i++) expect(step(low, 0, 0.16).rejections).toEqual([])
    expect(low.state.player.position.z).toBeCloseTo(432.64)
    const high = createStreamedTerrainWorkTrial(seed, site.from)
    expect(high.confirm(ladderId).event?.type).toBe('terrain_work_built')
    for (let i = 0; i < 25; i++) expect(step(high, -0.16, 0).rejections).toEqual([])
    expect(high.state.player.position.x).toBeCloseTo(site.to.x)
    for (let i = 0; i < 4; i++) expect(step(high, 0, 0.16).rejections).toEqual([])
    expect(high.state.player.position.z).toBeCloseTo(432.64)
  })

  it('uses one 0.24m dug ground witness in collision and stable active tiles', () => {
    const site = resolveTerrainWorkSite(seed, digId)
    if (!site || site.kind !== 'dig') throw new Error('Missing suitable dig fixture.')
    const trial = createStreamedTerrainWorkTrial(seed, site.center)
    const before = trial.activeTiles()
    expect(trial.activeTiles()).toBe(before)
    const rejected = trial.confirm('tile--64-999')
    expect(rejected.rejection).toBe('invalid_site')
    expect(rejected.state).toBe(trial.trialState)
    expect(trial.activeTiles()).toBe(before)
    expect(trial.confirm(digId).event?.type).toBe('terrain_work_dug')
    const after = trial.activeTiles()
    expect(after).not.toBe(before)
    expect(trial.activeTiles()).toBe(after)
    const effective = trial.tileAtWorld(site.center.x, site.center.z)!
    expect(effective.center.y).toBeCloseTo(site.center.y - 0.24)
    expect(after.find((tile) => tile.id === digId)).toBe(effective)
    for (let i = 0; i < 10; i++) trial.advance([])
    expect(trial.state.player.position.y).toBeCloseTo(effective.center.y)
    expect(trial.activeTiles()).toBe(after)
  })

  it('enumerates nearby discovered sites deterministically without consuming or mutating state', () => {
    const site = structure(bridgeId)
    const trial = createStreamedTerrainWorkTrial(seed, site.from)
    const state = trial.trialState
    const first = trial.nearbyCandidates().map((candidate) => candidate.id)
    expect(first).toContain(bridgeId)
    expect(trial.nearbyCandidates().map((candidate) => candidate.id)).toEqual(first)
    expect(trial.trialState).toBe(state)
    expect(trial.confirm(bridgeId).event?.type).toBe('terrain_work_built')
    expect(trial.nearbyCandidates().map((candidate) => candidate.id)).not.toContain(bridgeId)
  })

  it('requires the exact development-only query gate', () => {
    expect(terrainWorkTrialRequested('?devRegion=streamed&trial=works', true)).toBe(true)
    expect(terrainWorkTrialRequested('?devRegion=streamed&trial=works', false)).toBe(false)
    expect(terrainWorkTrialRequested('?devRegion=streamed', true)).toBe(false)
    expect(terrainWorkTrialRequested('?trial=works', true)).toBe(false)
  })
})
