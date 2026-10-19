import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { confirmPublicV14TerrainWork } from './publicWorldV14TerrainWork'
import { resolvePublicV14Surface } from './publicWorldV14Terrain'
import { createPublicV17ContinuousSession,
  replayPublicV17Frames } from './publicWorldV17ContinuousSession'
import { confirmPublicV17GreenwayWork } from './publicWorldV17GreenwayWork'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { createFreshPublicV17Head, encodePublicV17Head } from './publicWorldV17Snapshot'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { resolveTerrainWorkSite } from './terrainWorks'
import { starterCliffWorldTileAtGrid } from './starterCliffWorld'

const seed = 'wizard-realms'

describe('v17 native free-placement session', () => {
  it('keeps the public start checked for nested proxy and cyclic state', () => {
    const { head, lineage } = createFreshPublicV17Head(seed)
    const start = { state: head.state, greenwayWorks: head.greenwayWorks,
      saveRevision: 1, lineage }
    expect(() => createPublicV17ContinuousSession({ ...start,
      state: new Proxy(head.state, {}) })).toThrow(RangeError)
    const cyclicState = structuredClone(head.state)
    Object.defineProperty(cyclicState.player, 'unexpected', {
      enumerable: true, value: cyclicState.player })
    expect(() => createPublicV17ContinuousSession({ ...start, state: cyclicState }))
      .toThrow(RangeError)
  })

  it('passes the V27 dry-step policy through both owner crossings and reload', () => {
    const { head, lineage } = createFreshPublicV17Head(seed)
    const point = { x: 14.05, z: 33.95 }
    const floor = publicV17StarterSupportAt({ seed,
      profile: head.state.generationProfile,
      route: head.state.greenway.routes[0] ?? null,
      built: false, greenwayWorks: head.greenwayWorks }, point)?.floorY
    if (floor === undefined) throw new Error('Missing dry owner-edge support')
    const tileId = starterCliffWorldTileAtGrid(seed, 4, 8).id
    const start = { state: { ...head.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(head.state.discoveryMask), tileId,
      ])].sort()),
      player: { ...head.state.player, position: { ...point, y: floor } } },
    greenwayWorks: head.greenwayWorks, lineage, saveRevision: 1 }
    const walk = { walkRequested: true }
    const east = [{ type: 'move' as const, delta: { x: -0.1, z: 0.1 } }]
    const west = [{ type: 'move' as const, delta: { x: 0.1, z: -0.1 } }]
    expect(createPublicV17ContinuousSession(start).advanceFrame(east, walk)
      .rejections).toHaveLength(1)
    const policy = { maxOrdinaryGroundStepMeters: 0.8 } as const
    const session = createPublicV17ContinuousSession(start, policy)
    expect(session.advanceFrame(east, walk).rejections).toEqual([])
    expect(session.view().movementOwner).toBe('streamed')
    const saved = session.snapshotForSave()
    expect(saved.status).toBe('needs-checked-commit')
    if (saved.status === 'deferred-airborne') return
    const reload = createPublicV17ContinuousSession({ ...saved.progress,
      lineage, saveRevision: 2 }, policy)
    expect(reload.advanceFrame(west, walk).rejections).toEqual([])
    expect(reload.view().movementOwner).toBe('greenway')
    expect(reload.view().player.position.x).toBeCloseTo(point.x)
    expect(reload.view().player.position.z).toBeCloseTo(point.z)
    expect(reload.view().player.position.y).toBeCloseTo(floor)
    expect(reload.snapshotForSave().status).toBe('needs-checked-commit')
  })
  it('saves and reloads an opt-in ordinary dry step without changing the default', () => {
    const { head, lineage } = createFreshPublicV17Head(seed)
    const point = { x: 13.95, z: 4 }
    const floor = publicV17StarterSupportAt({ seed,
      profile: head.state.generationProfile,
      route: head.state.greenway.routes[0] ?? null,
      built: false, greenwayWorks: head.greenwayWorks }, point)?.floorY
    if (floor === undefined) throw new Error('Missing dry-step fixture support')
    const start = { state: { ...head.state, player: { ...head.state.player,
      position: { ...point, y: floor } } }, greenwayWorks: head.greenwayWorks,
    lineage, saveRevision: 1 }
    const east = [{ type: 'move' as const, delta: { x: 0.1, z: 0 } }]
    expect(createPublicV17ContinuousSession(start).advanceFrame(east,
      { walkRequested: true }).rejections).toHaveLength(1)
    const policy = { maxOrdinaryGroundStepMeters: 0.8 } as const
    const session = createPublicV17ContinuousSession(start, policy)
    expect(session.advanceFrame(east, { walkRequested: true }).rejections).toEqual([])
    const saved = session.snapshotForSave()
    expect(saved.status).toBe('ready')
    if (saved.status !== 'ready') return
    const reload = createPublicV17ContinuousSession({ ...saved.progress,
      lineage, saveRevision: 2 }, policy)
    expect(reload.advanceFrame([{ type: 'move', delta: { x: -0.1, z: 0 } }],
      { walkRequested: true }).rejections).toEqual([])
    expect(reload.snapshotForSave()).toMatchObject({ status: 'ready',
      progress: { state: { player: { position: { x: point.x, y: floor, z: point.z } } } } })
  })

  it('crosses a built snapped bridge and replays the saved frame witness', () => {
    const { head, lineage } = createFreshPublicV17Head(seed)
    const site = resolvePublicV17GreenwaySite(seed, 'works4:bridge:greenway-creek:0')
    if (!site || site.kind !== 'bridge') throw new Error('Missing bridge')
    const point = { x: site.from.x, z: site.from.z - 0.6 }
    const y = publicV17StarterSupportAt({ seed,
      profile: head.state.generationProfile,
      route: head.state.greenway.routes[0] ?? null,
      built: false, greenwayWorks: head.greenwayWorks }, point)?.floorY
    if (y === undefined) throw new Error('Missing approach')
    const ready = { state: { ...head.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(head.state.discoveryMask), ...site.footprintTileIds,
      ])].sort()),
      player: { ...head.state.player, position: { ...point, y },
        inventory: [...head.state.player.inventory, { itemId: 'logs' as const, quantity: 8 }] } },
    greenwayWorks: head.greenwayWorks }
    const built = confirmPublicV17GreenwayWork(ready, site.id)
    if (!built.progress) throw new Error(built.rejection)
    const before = encodePublicV17Head(built.progress, 1, lineage)
    const session = createPublicV17ContinuousSession({ ...built.progress,
      lineage, saveRevision: 1 })
    const frames = Array.from({ length: 56 }, () => ({
      intents: [{ type: 'move' as const, delta: { x: 0, z: 0.16 } }],
      walkRequested: true,
    }))
    for (const frame of frames) expect(session.advanceFrame(frame.intents,
      { walkRequested: frame.walkRequested }).rejections).toEqual([])
    const saved = session.snapshotForSave()
    expect(saved.status).toBe('ready')
    if (saved.status !== 'ready') return
    expect(saved.progress.state.player.position.z).toBeGreaterThan(site.to.z)
    const witness = { kind: 'frame-batch/v1' as const, frames }
    expect(replayPublicV17Frames(before, lineage, witness)?.next).toEqual(saved.progress)
    const reload = createPublicV17ContinuousSession({ ...saved.progress,
      lineage, saveRevision: 2 })
    for (const frame of frames) expect(reload.advanceFrame(
      [{ type: 'move', delta: { x: 0, z: -0.16 } }],
      { walkRequested: frame.walkRequested }).rejections).toEqual([])
    expect(reload.snapshotForSave().status).toBe('ready')
    expect(reload.view().player.position.z).toBeCloseTo(point.z)
  })

  it('climbs and descends the snapped north-cliff ladder after reload', () => {
    const { head, lineage } = createFreshPublicV17Head(seed)
    const site = resolvePublicV17GreenwaySite(seed,
      'works4:ladder:greenway-north-cliff:11')
    if (!site || site.kind !== 'ladder') throw new Error('Missing ladder')
    const point = { x: site.from.x, z: site.from.z + 0.6 }
    const y = publicV17StarterSupportAt({ seed,
      profile: head.state.generationProfile,
      route: head.state.greenway.routes[0] ?? null,
      built: false, greenwayWorks: head.greenwayWorks }, point)?.floorY
    if (y === undefined) throw new Error('Missing cliff stance')
    const ready = { state: { ...head.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(head.state.discoveryMask), ...site.footprintTileIds,
      ])].sort()),
      player: { ...head.state.player, position: { ...point, y },
        inventory: [...head.state.player.inventory, { itemId: 'logs' as const, quantity: 4 }] } },
    greenwayWorks: head.greenwayWorks }
    const built = confirmPublicV17GreenwayWork(ready, site.id)
    if (!built.progress) throw new Error(built.rejection)
    const session = createPublicV17ContinuousSession({ ...built.progress,
      lineage, saveRevision: 1 })
    for (let index = 0; index < 31; index++) expect(session.advanceFrame(
      [{ type: 'move', delta: { x: 0, z: -0.16 } }],
      { walkRequested: true }).rejections).toEqual([])
    const saved = session.snapshotForSave()
    expect(saved.status).toBe('ready')
    if (saved.status !== 'ready') return
    expect(saved.progress.state.player.position.y).toBeGreaterThan(y + 0.55)
    const reload = createPublicV17ContinuousSession({ ...saved.progress,
      lineage, saveRevision: 2 })
    for (let index = 0; index < 31; index++) expect(reload.advanceFrame(
      [{ type: 'move', delta: { x: 0, z: 0.16 } }],
      { walkRequested: true }).rejections).toEqual([])
    expect(reload.snapshotForSave().status).toBe('ready')
    expect(reload.view().player.position.z).toBeCloseTo(point.z)
  })

  it.each([
    ['works1:bridge:-102:92:z', 0, 0.16, 'fen_channel'],
    ['works1:ladder:-103:108:W', -0.16, 0, 'slate_cliff'],
  ] as const)('crosses Mireglass %s in both directions, but not without support or off-side',
    (id, dx, dz, barrier) => {
      const mireSeed = 'greenway-alpha'
      const { head, lineage } = createFreshPublicV17Head(mireSeed)
      const site = resolveTerrainWorkSite(mireSeed, id)
      if (!site || site.kind === 'dig') throw new Error(`Missing canonical ${id}`)
      const floor = resolvePublicV14Surface(head.state, site.from)
      if (!floor) throw new Error('Missing Mireglass approach support')
      const ready = { state: { ...head.state, tick: 1, movementOwner: 'streamed' as const,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(head.state.discoveryMask), floor.tileId,
          site.footprintTileIds[1],
        ])].sort()),
        player: { ...head.state.player, position: { ...site.from, y: floor.floorY },
          backpackCapacity: 30,
          inventory: [...head.state.player.inventory.filter((stack) => stack.itemId !== 'logs'),
            { itemId: 'logs' as const, quantity: 12 }] } },
      greenwayWorks: head.greenwayWorks }
      const start = { ...ready, lineage, saveRevision: 1 }
      const remainsNear = (position: { x: number; z: number }) => site.kind === 'bridge'
        ? position.z < site.to.z : position.x > site.to.x
      const unbuilt = createPublicV17ContinuousSession(start)
      let denied = false
      for (let index = 0; index < 60; index++) {
        const frame = unbuilt.advanceFrame([{ type: 'move', delta: { x: dx, z: dz } }],
          { walkRequested: true })
        if (frame.rejections.some((rejection) => rejection.code === barrier)) {
          denied = true
          break
        }
      }
      expect(denied).toBe(true)
      expect(remainsNear(unbuilt.view().player.position)).toBe(true)
      const built = confirmPublicV14TerrainWork(ready.state, id)
      if (!built.candidate) throw new Error(`Build rejected: ${built.rejection}`)
      const progress = { state: built.candidate, greenwayWorks: ready.greenwayWorks }
      const before = encodePublicV17Head(progress, 1, lineage)
      const session = createPublicV17ContinuousSession({ ...progress, lineage,
        saveRevision: 1 })
      const steps = Math.round(Math.hypot(site.to.x - site.from.x,
        site.to.z - site.from.z) / 0.16)
      const frames = Array.from({ length: steps }, () => ({ intents: [{ type: 'move' as const,
        delta: { x: dx, z: dz } }], walkRequested: true }))
      for (const frame of frames) expect(session.advanceFrame(frame.intents,
        { walkRequested: true }).rejections).toEqual([])
      const saved = session.snapshotForSave()
      expect(saved.status).toBe('ready')
      if (saved.status !== 'ready') return
      expect(saved.progress.state.player.position.x).toBeCloseTo(site.to.x)
      expect(saved.progress.state.player.position.z).toBeCloseTo(site.to.z)
      expect(replayPublicV17Frames(before, lineage,
        { kind: 'frame-batch/v1', frames })?.next).toEqual(saved.progress)
      const reload = createPublicV17ContinuousSession({ ...saved.progress,
        lineage, saveRevision: 2 })
      for (let index = 0; index < steps; index++) expect(reload.advanceFrame(
        [{ type: 'move', delta: { x: -dx, z: -dz } }],
        { walkRequested: true }).rejections).toEqual([])
      expect(reload.view().player.position.x).toBeCloseTo(site.from.x)
      expect(reload.view().player.position.z).toBeCloseTo(site.from.z)

      const offPoint = site.kind === 'bridge'
        ? { x: site.from.x + 1, z: site.from.z }
        : { x: site.from.x, z: site.from.z + 1 }
      const offFloor = resolvePublicV14Surface(built.candidate, offPoint)
      if (!offFloor) throw new Error('Missing off-side bank support')
      const off = createPublicV17ContinuousSession({ ...progress, lineage, saveRevision: 1,
        state: { ...built.candidate, player: { ...built.candidate.player,
          position: { ...offPoint, y: offFloor.floorY } } } })
      let offSideDenied = false
      const offSideCodes: string[] = []
      for (let index = 0; index < 60; index++) {
        const frame = off.advanceFrame([{ type: 'move', delta: { x: dx, z: dz } }],
          { walkRequested: true })
        offSideCodes.push(...frame.rejections.map((rejection) => rejection.code))
        if (frame.rejections.some((rejection) => rejection.code === barrier)) {
          offSideDenied = true
          break
        }
      }
      expect(offSideDenied, JSON.stringify({ offSideCodes, position: off.view().player.position,
        site: { from: site.from, to: site.to } })).toBe(true)
      expect(remainsNear(off.view().player.position)).toBe(true)
      const diagonalPoint = site.kind === 'bridge'
        ? { x: site.from.x + 0.4, z: site.from.z }
        : { x: site.from.x, z: site.from.z + 0.3 }
      const diagonalFloor = resolvePublicV14Surface(built.candidate, diagonalPoint)
      if (!diagonalFloor) throw new Error('Missing in-lane approach support')
      expect(site.kind === 'bridge' ? 0.4 : 0.3).toBeLessThan(site.widthMeters / 2)
      const diagonal = createPublicV17ContinuousSession({ ...progress, lineage, saveRevision: 1,
        state: { ...built.candidate, player: { ...built.candidate.player,
          position: { ...diagonalPoint, y: diagonalFloor.floorY } } } })
      const diagonalDelta = site.kind === 'bridge'
        ? { x: 0.02, z: 0.15 } : { x: -0.14, z: 0.02 }
      let diagonalDenied = false
      let acceptedDiagonalSteps = 0
      for (let index = 0; index < 60; index++) {
        const frame = diagonal.advanceFrame([{ type: 'move', delta: diagonalDelta }],
          { walkRequested: true })
        if (frame.rejections.some((rejection) => rejection.code === barrier)) {
          diagonalDenied = true
          break
        }
        if (!frame.rejections.length) acceptedDiagonalSteps++
      }
      expect(diagonalDenied, JSON.stringify(diagonal.view().player.position)).toBe(true)
      expect(acceptedDiagonalSteps).toBeGreaterThan(3)
      const stopped = diagonal.view().player.position
      const attemptedOffset = site.kind === 'bridge'
        ? Math.abs(stopped.x + diagonalDelta.x - site.from.x)
        : Math.abs(stopped.z + diagonalDelta.z - site.from.z)
      expect(attemptedOffset).toBeGreaterThan(site.widthMeters / 2)
      expect(remainsNear(diagonal.view().player.position)).toBe(true)
    })
})
