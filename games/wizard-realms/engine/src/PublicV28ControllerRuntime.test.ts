import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createPublicV28ControllerRuntime } from './PublicV28ControllerRuntime'
import { createAtomicV28Store } from './domain/atomicV28Database'
import { decodeDiscoveredTileIds, discoveryMaskHasTileId,
  encodeDiscoveredTileIds } from './domain/discoveryMask'
import { mireglassBermFaceRowAt, mireglassFenRowAt } from './domain/mireglassTerrain'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import * as streamTerrain from './domain/publicWorldV14Terrain'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import { createPublicV23Root, decodePublicV23Progress } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { createPublicV26Root } from './domain/publicWorldV26Snapshot'
import { createPublicV27Root, replayPublicV27Witness } from './domain/publicWorldV27Snapshot'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { resolvePublicV28RiverBridge } from './domain/publicWorldV28RiverBridgeSites'
import { previewPublicV28RiverBridge,
  publicV28BridgeSitesValid } from './domain/publicWorldV28RiverBridgeAction'
import { replayPublicV28FramesWithEvents } from './domain/publicWorldV28Replay'
import type { PublicV28Progress } from './domain/publicWorldV28Migration'
import { projectPublicV28Pose } from './domain/publicWorldV28RiverSupport'
import { publicV28RiverBridgeFloorAt } from './domain/publicWorldV28RiverSupport'
import { publicV28RiverPassage } from './domain/publicWorldV28RiverPassage'
import { replayPublicV28Witness, createPublicV28Root,
  decodePublicV28Root } from './domain/publicWorldV28Snapshot'
import { replayPublicV29Witness } from './domain/publicWorldV29Snapshot'
import { replayPublicV30Witness } from './domain/publicWorldV30Snapshot'
import { resolveTerrainWorkSite } from './domain/terrainWorks'
import type { PublicV28Witness } from './domain/publicWorldV28Snapshot'
import type { PublicV28Start } from './domain/publicWorldV28Flow'

const seed = 'greenway-alpha'
const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-14')!
const bridge = { kind: 'river-bridge/v1' as const, id: site.id }
const move = (z: number) => [{ type: 'move' as const, delta: { x: 0, z } }]
const owned = ({ head }: PublicV28Start) => ({ state: head.state,
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
  terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs,
  riverBridgeIds: head.riverBridgeIds })

function startWithLogs(logs = 12, worldSeed = seed, bridgeSite = site,
  point: { x: number; z: number } = bridgeSite.from): PublicV28Start {
  const v23 = createPublicV23Root(worldSeed)
  const floor = resolvePublicV23Surface(v23.head.state, point, [])
  if (!floor) throw new Error('Missing canonical north bank')
  const state = { ...v23.head.state, movementOwner: 'streamed' as const,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(v23.head.state.discoveryMask), ...bridgeSite.footprintTileIds])].sort()),
    player: { ...v23.head.state.player, position: { ...point, y: floor.floorY },
      inventory: logs ? [...v23.head.state.player.inventory,
        { itemId: 'logs' as const, quantity: logs }] : v23.head.state.player.inventory } }
  const v24 = createPublicV24Root({ head: { ...v23.head, state, saveRevision: 1,
    witness: { kind: 'checkpoint' as const } }, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  return { head: v28.head, lineage: v28.lineage }
}

function startAtPoint(ladderBuilt: boolean, point: { x: number; z: number },
  owner: 'greenway' | 'streamed' = 'greenway', logs = 0): PublicV28Start {
  const rockSeed = 'wizard-realms'
  const v23 = createPublicV23Root(rockSeed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const base = v24.head
  const greenwayWorks = ladderBuilt ? { ...base.greenwayWorks,
    builtLadderIds: ['works4:ladder:greenway-north-cliff:11'] } : base.greenwayWorks
  const state = { ...base.state, movementOwner: owner }
  const support = owner === 'greenway' ? publicV17StarterSupportAt({ seed: rockSeed,
    profile: base.state.generationProfile,
    route: base.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks }, point)
    : resolvePublicV23Surface(state, point, base.regionalWorks.builtLadderIds)
  if (!support) throw new Error('Missing dry approach support')
  const discoveryMask = owner === 'streamed' && 'tileId' in support
    ? encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(state.discoveryMask), support.tileId])].sort())
    : state.discoveryMask
  const construction = ladderBuilt ? 60 : 0
  const shaped = decodePublicV23Progress({ state: { ...state, discoveryMask,
    player: { ...base.state.player, xp: base.state.player.xp + construction,
      skillXp: { ...base.state.player.skillXp,
        construction: base.state.player.skillXp.construction + construction },
      position: { ...point, y: support.floorY },
      inventory: logs ? [...base.state.player.inventory,
        { itemId: 'logs' as const, quantity: logs }] : base.state.player.inventory } },
    greenwayWorks, regionalWorks: base.regionalWorks }, rockSeed)
  if (!shaped) throw new Error('Invalid rock-return approach')
  const v25 = createPublicV25Root({ head: { ...base, ...shaped, saveRevision: 1,
    witness: { kind: 'checkpoint' as const } }, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  return { head: v28.head, lineage: v28.lineage }
}

function writerFor(initial: PublicV28Start) {
  let current = initial
  const write = vi.fn(async (revision: number, lineage: PublicV28Start['lineage'],
    witness: PublicV28Witness) => {
    if (revision !== current.head.saveRevision || !samePublicV14Value(lineage, current.lineage))
      return { ok: false as const, reason: 'revision-changed' }
    const next = replayPublicV28Witness(owned(current), witness)
    if (!next) return { ok: false as const, reason: 'frame-rejected' }
    current = { lineage, head: { ...current.head, ...next,
      saveRevision: revision + 1, witness } }
    return { ok: true as const, value: current }
  })
  return { write, current: () => current }
}

describe('V28 checked controller runtime', () => {
  it('crosses and returns over the saved -11 deck with checked saves and river controls', async () => {
    const riverSite = resolvePublicV28RiverBridge('wizard-realms', 'works6:river-bridge:-11')
    if (!riverSite) throw new Error('Missing canonical -11 bridge')
    const run = async (x: number, built: boolean) => {
      const start = startWithLogs(8, 'wizard-realms', riverSite, { x, z: riverSite.from.z })
      const writer = writerFor(start)
      const runtime = createPublicV28ControllerRuntime(start, writer.write)
      if (built) expect(await runtime.action({ kind: 'river-bridge/v1', id: riverSite.id }))
        .toMatchObject({ status: 'saved' })
      let frames = 0, idles = 0, saves = 0
      const settle = () => {
        for (let i = 0; runtime.preview().state.player.verticalVelocity !== 0 && i < 32; i++) {
          const result = runtime.advanceFrame([], false)
          frames++; idles++
          if (result.rejections.length) return result.rejections
        }
        return runtime.preview().state.player.verticalVelocity === 0 ? [] : ['landing-bound']
      }
      const checkpoint = async () => {
        if (!runtime.status().pendingFrames) return
        if (runtime.preview().state.player.verticalVelocity !== 0)
          throw new Error('Attempted airborne checkpoint')
        const outcome = await runtime.save()
        if (outcome.status !== 'saved') throw new Error(`Checked save rejected: ${JSON.stringify(outcome)}`)
        saves++
      }
      const walkTo = async (z: number) => {
        for (let i = 0; i < 100; i++) {
          const from = runtime.preview().state.player.position
          const remaining = z - from.z
          if (Math.abs(remaining) < 0.00001) return null
          const dz = Math.sign(remaining) * Math.min(0.16, Math.abs(remaining))
          const result = runtime.advanceFrame(move(dz), true)
          frames++
          if (result.rejections.length) return { from, dz, result }
          const landing = settle()
          if (landing.length) return { from, dz, result: { rejections: landing } }
          if (runtime.status().pendingFrames >= 48 || runtime.status().checkpointRequired)
            await checkpoint()
        }
        throw new Error('Bounded approach exhausted')
      }
      const approach = await walkTo(1.96)
      const before = runtime.preview()
      const from = before.state.player.position
      const beforePose = projectPublicV28Pose(before, before.terrain, before.riverBridgeIds)
      const frame = move(0.16)
      const result = approach ? null : runtime.advanceFrame(frame, true)
      if (result) frames++
      const after = runtime.preview()
      const to = after.state.player.position
      const afterPose = projectPublicV28Pose(after, after.terrain, after.riverBridgeIds)
      const oldWet = resolvePublicV23Surface(before.state, { x, z: 2.12 },
        before.regionalWorks.builtLadderIds)
      const seam = { x, built, approach, frame, from, to,
        beforeVelocity: before.state.player.verticalVelocity,
        afterVelocity: after.state.player.verticalVelocity,
        oldWetFloor: oldWet?.floorY ?? null,
        deckFromFloor: publicV28RiverBridgeFloorAt(riverSite, from),
        deckWetFloor: publicV28RiverBridgeFloorAt(riverSite, { x, z: 2.12 }),
        beforeSupport: beforePose?.support ?? null,
        beforeEffectiveFloor: beforePose?.effective.floorY ?? null,
        afterSupport: afterPose?.support ?? null,
        afterEffectiveFloor: afterPose?.effective.floorY ?? null,
        postSnapPassage: result && !result.rejections.length
          ? publicV28RiverPassage(before, before.terrain, before.riverBridgeIds, from, to)
          : null,
        rejections: result?.rejections ?? null, frames, idles, saves }
      let outbound: unknown = null, returned: unknown = null
      if (result && !result.rejections.length) {
        const landing = settle()
        outbound = landing.length ? { landing } : await walkTo(riverSite.to.z + 0.2)
        if (outbound === null) {
          await checkpoint()
          returned = await walkTo(riverSite.from.z)
          if (returned === null) await checkpoint()
        }
      }
      console.log('V145_A2_SEAM', JSON.stringify({ ...seam, outbound, returned,
        final: runtime.preview().state.player.position,
        finalVelocity: runtime.preview().state.player.verticalVelocity,
        frames, idles, saves }))
      const final = runtime.preview().state.player.position
      const reload = createPublicV28ControllerRuntime(runtime.committed(), writer.write)
      return { ...seam, outbound, returned, final,
        committed: runtime.committed().head.state.player.position,
        reloaded: reload.preview().state.player.position, checkedSaves: saves }
    }
    const center = await run(-44, true)
    const lateral = await run(-43.48, true)
    const outside = await run(-42.69, true)
    const noBridge = await run(-44, false)
    for (const row of [center, lateral, outside, noBridge]) {
      expect(row.approach).toBeNull()
      expect(row.from.z).toBeCloseTo(1.96, 6)
      expect(row.beforeVelocity).toBe(0)
    }
    expect(center.beforeSupport).toBe('bridge')
    expect(lateral.beforeSupport).toBe('bridge')
    expect(outside.beforeSupport).toBe('terrain')
    for (const row of [center, lateral]) {
      expect(row.rejections).toEqual([])
      expect(row.to.z).toBeCloseTo(2.12, 6)
      expect(row.afterVelocity).toBe(0)
      expect(row.outbound).toBeNull()
      expect(row.returned).toBeNull()
      expect(row.final.z).toBeCloseTo(riverSite.from.z, 6)
      expect(row.committed).toEqual(row.final)
      expect(row.reloaded).toEqual(row.final)
      expect(row.checkedSaves).toBeGreaterThanOrEqual(2)
    }
    expect(outside.rejections?.length).toBeGreaterThan(0)
    expect(noBridge.rejections?.length).toBeGreaterThan(0)
  }, 120_000)

  it('walks from the low bank through the north ladder to a discovered ready river Works', async () => {
    const ladder = resolvePublicV17GreenwaySite('wizard-realms',
      'works4:ladder:greenway-north-cliff:11')
    const target = resolvePublicV28RiverBridge('wizard-realms', 'works6:river-bridge:-14')
    if (!ladder || ladder.kind !== 'ladder' || !target) throw new Error('Missing route sites')
    const start = startAtPoint(true, { x: -25.8, z: 2.2 }, 'greenway', 8)
    const writer = writerFor(start)
    const runtime = createPublicV28ControllerRuntime(start, writer.write)
    expect(target.footprintTileIds.some((id) => !discoveryMaskHasTileId(
      runtime.preview().state.discoveryMask, id))).toBe(true)
    expect(previewPublicV28RiverBridge(runtime.preview(), target.id).rejection).not.toBeNull()
    let frames = 0, idleFrames = 0, saves = 0, crossedOwner = false, oldSeam = false
    const position = () => runtime.preview().state.player.position
    const evidence = (label: string) => ({ label, frame: frames, position: position(),
      velocity: runtime.preview().state.player.verticalVelocity,
      owner: runtime.preview().state.movementOwner, pending: runtime.status().pendingFrames,
      pose: projectPublicV28Pose(runtime.preview(), runtime.preview().terrain,
        runtime.preview().riverBridgeIds) })
    const settle = () => {
      for (let i = 0; runtime.preview().state.player.verticalVelocity !== 0 && i < 32; i++) {
        const result = runtime.advanceFrame([], false)
        frames++; idleFrames++
        if (result.rejections.length) throw new Error(`idle rejection ${JSON.stringify({
          result, ...evidence('landing') })}`)
      }
      if (runtime.preview().state.player.verticalVelocity !== 0)
        throw new Error(`airborne after bounded landing ${JSON.stringify(evidence('landing'))}`)
    }
    const checkpoint = async () => {
      settle()
      if (!runtime.status().pendingFrames) return
      const result = await runtime.save()
      if (result.status !== 'saved') throw new Error(`save rejected ${JSON.stringify({
        result, ...evidence('checkpoint') })}`)
      saves++
    }
    const walkTo = async (label: string, point: { x: number; z: number }) => {
      for (let i = 0; i < 900; i++) {
        const before = runtime.preview()
        const p = before.state.player.position
        const dx = point.x - p.x, dz = point.z - p.z, distance = Math.hypot(dx, dz)
        if (distance < 0.025) return
        const step = Math.min(0.16, distance)
        const result = runtime.advanceFrame([{ type: 'move', delta: {
          x: dx / distance * step, z: dz / distance * step } }], true)
        frames++
        if (!oldSeam && p.x <= -33.9 && p.x >= -34.3) {
          oldSeam = true
          console.log('V144_A3_OLD_SEAM', JSON.stringify({ before: {
            position: p, velocity: before.state.player.verticalVelocity,
            pending: runtime.status().pendingFrames }, result,
            after: evidence(label) }))
        }
        if (result.rejections.length) throw new Error(`first controller rejection ${JSON.stringify({
          result, before: p, ...evidence(label) })}`)
        const after = runtime.preview()
        if (before.state.movementOwner === 'greenway'
          && after.state.movementOwner === 'streamed') crossedOwner = true
        if (!projectPublicV28Pose(after, after.terrain, after.riverBridgeIds))
          throw new Error(`unsupported pose ${JSON.stringify(evidence(label))}`)
        settle()
        if (runtime.status().pendingFrames >= 48 || runtime.status().checkpointRequired)
          await checkpoint()
      }
      throw new Error(`route bound reached ${JSON.stringify(evidence(label))}`)
    }
    await walkTo('low east approach', { x: ladder.from.x, z: 2.2 })
    await walkTo('built north ladder', { x: ladder.from.x, z: ladder.exit.z })
    await walkTo('upper west shelf', { x: -29.9, z: ladder.exit.z })
    await walkTo('west owner handoff', { x: target.from.x, z: ladder.exit.z })
    await walkTo('dry source descent', target.from)
    await checkpoint()
    expect(oldSeam).toBe(true)
    expect(crossedOwner).toBe(true)
    expect(runtime.preview().state.movementOwner).toBe('streamed')
    expect(target.footprintTileIds.every((id) => discoveryMaskHasTileId(
      runtime.preview().state.discoveryMask, id))).toBe(true)
    expect(previewPublicV28RiverBridge(runtime.preview(), target.id))
      .toMatchObject({ site: target, rejection: null })
    console.log('V144_A3_ROUTE', JSON.stringify({ frames, idleFrames, saves,
      bridge: target.id, ...evidence('ready') }))
  }, 120_000)

  it('reuses streamed tiles within a chunk, regenerates at its boundary, and isolates view callers', async () => {
    const start = startAtPoint(false, { x: 63.85, z: -32 }, 'streamed')
    const writer = writerFor(start)
    const runtime = createPublicV28ControllerRuntime(start, writer.write)
    const generate = vi.spyOn(streamTerrain, 'createPublicV23StreamTerrain')
    try {
      const first = runtime.view()
      expect(generate).toHaveBeenCalledOnce()
      ;(first.activeTiles as unknown as { center: { y: number } }[])[0].center.y = 999
      generate.mockClear()
      const isolated = runtime.view()
      expect(generate).not.toHaveBeenCalled()
      expect(isolated.activeTiles[0].center.y).not.toBe(999)
      expect(isolated.activeTiles).not.toBe(first.activeTiles)
      expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.1, z: 0 } }], false)
        .rejections).toEqual([])
      generate.mockClear()
      expect(runtime.view().activeTiles).toEqual(isolated.activeTiles)
      expect(generate).not.toHaveBeenCalled()
      expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.1, z: 0 } }], false)
        .rejections).toEqual([])
      generate.mockClear()
      const crossed = runtime.view()
      expect(generate).toHaveBeenCalledOnce()
      expect(crossed.activeTiles).not.toEqual(isolated.activeTiles)
      expect(crossed.activeTiles).toEqual(streamTerrain.createPublicV23StreamTerrain(
        runtime.preview().state, runtime.preview().regionalWorks.builtLadderIds).activeTiles())
      expect(await runtime.save()).toMatchObject({ status: 'saved' })
      expect(runtime.committed()).toEqual(writer.current())
      expect(runtime.status()).toMatchObject({ pendingFrames: 0,
        saveRevision: start.head.saveRevision + 1 })
    } finally { generate.mockRestore() }
  }, 30_000)

  it('invalidates streamed tiles after a checked legacy terrain dig', async () => {
    const base = startWithLogs(0)
    const site = resolveTerrainWorkSite(seed, 'tile--64-76')
    if (!site || site.kind !== 'dig') throw new Error('Missing canonical dig site')
    const point = { x: site.center.x + 2.5, z: site.center.z }
    const floor = resolvePublicV23Surface(base.head.state, point,
      base.head.regionalWorks.builtLadderIds)
    if (!floor) throw new Error('Missing dig approach support')
    const start: PublicV28Start = { ...base, head: { ...base.head,
      state: { ...base.head.state, tick: 1,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(base.head.state.discoveryMask), floor.tileId,
          ...site.footprintTileIds])].sort()),
        player: { ...base.head.state.player,
          position: { ...point, y: floor.floorY }, backpackCapacity: 30,
          inventory: [...base.head.state.player.inventory.filter((stack) =>
            stack.itemId !== 'logs' && stack.itemId !== 'field_spade'),
          { itemId: 'field_spade', quantity: 1 }],
          equipment: { ...base.head.state.player.equipment, mainHand: 'field_spade' } } } } }
    const writer = writerFor(start)
    const runtime = createPublicV28ControllerRuntime(start, writer.write)
    const generate = vi.spyOn(streamTerrain, 'createPublicV23StreamTerrain')
    try {
      const before = runtime.view()
      generate.mockClear()
      expect(await runtime.action({ kind: 'legacy-work', id: site.id }))
        .toMatchObject({ status: 'saved', workEvent: { id: site.id, kind: 'dig' } })
      expect(runtime.preview().state.terrainWorks.dugTileIds).toContain(site.id)
      generate.mockClear()
      const after = runtime.view()
      expect(generate).toHaveBeenCalledOnce()
      expect(after.activeTiles).not.toEqual(before.activeTiles)
      expect(after.activeTiles).toEqual(streamTerrain.createPublicV23StreamTerrain(
        runtime.preview().state, runtime.preview().regionalWorks.builtLadderIds).activeTiles())
      expect(runtime.committed()).toEqual(writer.current())
    } finally { generate.mockRestore() }
  }, 30_000)

  it('builds only from canonical Ready preview and preserves the bridge on reload', async () => {
    const start = startWithLogs(), writer = writerFor(start)
    const runtime = createPublicV28ControllerRuntime(start, writer.write)
    expect(runtime.preview().riverBridgeIds).toEqual([])
    expect(await runtime.action(bridge)).toMatchObject({ status: 'saved',
      workEvent: { id: site.id, kind: 'bridge', logsSpent: 8, xp: 80 } })
    expect(writer.write).toHaveBeenCalledOnce()
    expect(runtime.preview().riverBridgeIds).toEqual([site.id])
    expect(runtime.committed().head.riverBridgeIds).toEqual([site.id])
    expect(runtime.status()).toMatchObject({ gate: 'open', saveRevision: 1, pendingFrames: 0 })
    const reload = createPublicV28ControllerRuntime(runtime.committed(), writer.write)
    expect(reload.preview()).toEqual(runtime.preview())
    expect(reload.advanceFrame(move(0.16), false).rejections).toEqual([])
    expect(reload.preview().riverBridgeIds).toEqual([site.id])
    expect(await reload.save()).toMatchObject({ status: 'saved' })
    expect(reload.committed().head.riverBridgeIds).toEqual([site.id])
    expect(reload.committed().head.saveRevision).toBe(2)
  })

  it('rejects unready and noncanonical bridge actions before calling the writer', async () => {
    const start = startWithLogs(0), writer = writerFor(start)
    const runtime = createPublicV28ControllerRuntime(start, writer.write)
    expect(await runtime.action(bridge)).toEqual({ status: 'rejected', reason: 'not_owned' })
    expect(await runtime.action({ kind: 'river-bridge/v1',
      id: 'works6:river-bridge:-014' })).toEqual({ status: 'rejected', reason: 'invalid-action' })
    expect(runtime.preview()).toEqual(owned(start))
    expect(writer.write).not.toHaveBeenCalled()
  })

  it('names the river obstruction before construction without mutating preview', () => {
    const start = startWithLogs(), runtime = createPublicV28ControllerRuntime(start,
      async () => ({ ok: false as const, reason: 'not-called' }))
    const before = runtime.preview()
    let rejection = null as ReturnType<typeof runtime.advanceFrame>['rejections'][number] | null
    for (let index = 0; index < 50; index++) {
      const result = runtime.advanceFrame(move(0.16), false)
      if (result.rejections.length) { rejection = result.rejections[0]; break }
    }
    expect(rejection).toMatchObject({ code: 'terrain_missing',
      message: expect.stringMatching(/river blocks this step/i) })
    expect(runtime.preview().riverBridgeIds).toEqual([])
    expect(runtime.status().pendingFrames).toBeGreaterThan(0)
    expect(runtime.preview().state.player.position.z).toBeGreaterThan(before.state.player.position.z)
  })

  it('names an off-rail step from the saved deck without telling its rider to approach the dry end', async () => {
    const start = startWithLogs(), writer = writerFor(start)
    const runtime = createPublicV28ControllerRuntime(start, writer.write)
    expect(await runtime.action(bridge)).toMatchObject({ status: 'saved' })
    for (let index = 0; index < 25; index++)
      expect(runtime.advanceFrame(move(0.16), false).rejections).toEqual([])
    const position = runtime.preview().state.player.position
    expect(projectPublicV28Pose(runtime.preview(), runtime.preview().terrain,
      runtime.preview().riverBridgeIds)?.bridgeId).toBe(site.id)
    let rejection: ReturnType<typeof runtime.advanceFrame>['rejections'][number] | null = null
    for (let index = 0; index < 12; index++) {
      const result = runtime.advanceFrame([{ type: 'move', delta: { x: 0.16, z: 0 } }], false)
      if (result.rejections.length) { rejection = result.rejections[0]; break }
    }
    expect(rejection).toMatchObject({ code: 'terrain_missing',
      message: expect.stringMatching(/Stay on the deck, or return to a dry end before moving sideways/) })
    expect(runtime.preview().state.player.position.x).toBeGreaterThanOrEqual(position.x)
    expect(projectPublicV28Pose(runtime.preview(), runtime.preview().terrain,
      runtime.preview().riverBridgeIds)?.bridgeId).toBe(site.id)
  })

  it('retains dry-end approach guidance near a saved bridge when off its deck', async () => {
    const start = startWithLogs(), writer = writerFor(start)
    const runtime = createPublicV28ControllerRuntime(start, writer.write)
    expect(await runtime.action(bridge)).toMatchObject({ status: 'saved' })
    for (let index = 0; index < 8; index++)
      expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.16, z: 0 } }], false)
        .rejections).toEqual([])
    expect(projectPublicV28Pose(runtime.preview(), runtime.preview().terrain,
      runtime.preview().riverBridgeIds)?.bridgeId).toBeNull()
    let rejection: ReturnType<typeof runtime.advanceFrame>['rejections'][number] | null = null
    for (let index = 0; index < 50; index++) {
      const result = runtime.advanceFrame(move(0.16), false)
      if (result.rejections.length) { rejection = result.rejections[0]; break }
    }
    expect(rejection).toMatchObject({ code: 'terrain_missing',
      message: expect.stringMatching(/Approach the built bridge from its dry end and stay on the deck/) })
  })

  it.each([
    { obstacle: 'fen channel', point: { x: -352,
      z: mireglassFenRowAt('wizard-realms', -352) - 2.05 },
      cause: /unsupported wetland/i, direction: /dry ground.*marked crossing/i },
    { obstacle: 'slate cliff', point: { x: -400,
      z: mireglassBermFaceRowAt('wizard-realms', -400) - 2.05 },
      cause: /slate cliff/i, direction: /marked ladder.*gentler slope/i },
  ])('names the authored $obstacle and a safe next action without moving',
    ({ point, cause, direction }) => {
      const start = startAtPoint(false, point, 'streamed')
      const runtime = createPublicV28ControllerRuntime(start,
        async () => ({ ok: false as const, reason: 'not-called' }))
      const before = runtime.preview()
      const rejection = runtime.advanceFrame(move(0.1), false).rejections
      expect(rejection).toEqual([expect.objectContaining({ code: 'terrain_missing',
        message: expect.stringMatching(cause) })])
      expect(rejection[0].message).toMatch(direction)
      expect(runtime.preview()).toEqual(before)
      expect(runtime.status().pendingFrames).toBe(0)
    })

  it.each([
    { side: 'west' as const, ladderBuilt: false, direction: /Build a ladder at a marked north cliff site, then climb it, skirt above the west rock return, then head toward the river bank/ },
    { side: 'west' as const, ladderBuilt: true, direction: /Climb your marked north cliff ladder, skirt above the west rock return, then head toward the river bank/ },
    { side: 'east' as const, ladderBuilt: false, direction: /Build a ladder at a marked north cliff site, then climb it, skirt above the east rock return, then head toward the river bank/ },
  ])('routes the $side rock-return rejection via the north ladder (built: $ladderBuilt)',
    ({ side, ladderBuilt, direction }) => {
      const start = startAtPoint(ladderBuilt,
        { x: side === 'west' ? -29.95 : 29.95, z: -0.3 })
      const runtime = createPublicV28ControllerRuntime(start,
        async () => ({ ok: false as const, reason: 'not-called' }))
      const before = runtime.preview()
      expect(runtime.advanceFrame([{ type: 'move', delta: {
        x: side === 'west' ? -0.1 : 0.1, z: 0 } }], false)
        .rejections).toEqual([expect.objectContaining({ code: 'terrain_missing',
          message: expect.stringMatching(direction) })])
      expect(runtime.preview()).toEqual(before)
      expect(runtime.status().pendingFrames).toBe(0)
    })

  it.each([
    { side: 'upper', ladderBuilt: true, z: -6.08, step: 0.16,
      message: 'The cliff lip is a drop. Back away and stay on the upper shelf, or return to your built ladder to descend.' },
    { side: 'lower', ladderBuilt: true, z: -5.92, step: -0.16,
      message: 'The cliff blocks this step. Follow the lower face to your built ladder and climb its rungs.' },
    { side: 'lower', ladderBuilt: false, z: -5.92, step: -0.16,
      message: 'The cliff needs a ladder. Follow the lower face to a marked ladder site.' },
  ])('names the $side cliff obstruction accurately (built: $ladderBuilt)',
    ({ ladderBuilt, z, step, message }) => {
      const start = startAtPoint(ladderBuilt, { x: -24.9, z })
      const runtime = createPublicV28ControllerRuntime(start,
        async () => ({ ok: false as const, reason: 'not-called' }))
      const before = runtime.preview()
      expect(runtime.advanceFrame(move(step), false).rejections)
        .toEqual([expect.objectContaining({ code: 'terrain_missing', message })])
      expect(runtime.preview()).toEqual(before)
      expect(runtime.status().pendingFrames).toBe(0)
    })

  it('buffers checked deck movement, saves it, and leaves V27 replay policy untouched', async () => {
    const start = startWithLogs(), writer = writerFor(start)
    const runtime = createPublicV28ControllerRuntime(start, writer.write)
    expect(await runtime.action(bridge)).toMatchObject({ status: 'saved' })
    for (let index = 0; index < 25; index++)
      expect(runtime.advanceFrame(move(0.16), false).rejections).toEqual([])
    expect(runtime.status().pendingFrames).toBe(25)
    expect(runtime.preview().riverBridgeIds).toEqual([site.id])
    expect(replayPublicV27Witness(runtime.committed().head,
      { kind: 'frame-batch/v1', frames: Array.from({ length: 50 }, () => ({
        intents: move(0.16), walkRequested: false })) })).toBeNull()
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(runtime.committed().head.riverBridgeIds).toEqual([site.id])
    expect(runtime.committed().head.state.player.position.z).toBeCloseTo(12, 7)
    const reload = createPublicV28ControllerRuntime(runtime.committed(), writer.write)
    expect(reload.preview().riverBridgeIds).toEqual([site.id])
    expect(reload.preview().state.player.position.z).toBeCloseTo(12, 7)
  }, 30_000)

  it('keeps saved-bridge replay detached and rejects malformed caller state', async () => {
    const start = startWithLogs(), writer = writerFor(start)
    const builder = createPublicV28ControllerRuntime(start, writer.write)
    expect(await builder.action(bridge)).toMatchObject({ status: 'saved' })
    const before = structuredClone(owned(builder.committed()))
    const callerSnapshot = structuredClone(before)
    const frame = { intents: move(0.16), walkRequested: false }
    const replay = replayPublicV28FramesWithEvents(before, [frame])
    expect(replay).not.toBeNull()
    if (!replay) throw new Error('Valid saved-bridge frame rejected')
    expect(before).toEqual(callerSnapshot)
    const detached = structuredClone(replay)
    Reflect.set(before.state.player.position, 'z', 999)
    Reflect.set(before.riverBridgeIds, '0', 'invalid-bridge')
    expect(replay).toEqual(detached)

    const malformed = structuredClone(owned(builder.committed()))
    Reflect.set(malformed.state.player, 'coins', -1)
    expect(replayPublicV28FramesWithEvents(malformed, [frame])).toBeNull()
    const accessor = structuredClone(owned(builder.committed()))
    Object.defineProperty(accessor.state.player, 'position', {
      enumerable: true, get: () => { throw new Error('Caller accessor failed') } })
    expect(replayPublicV28FramesWithEvents(accessor, [frame])).toBeNull()
    const proxied = structuredClone(owned(builder.committed()))
    Reflect.set(proxied, 'state', new Proxy(proxied.state, {}))
    expect(replayPublicV28FramesWithEvents(proxied, [frame])).toBeNull()
    expect(replayPublicV28FramesWithEvents(owned(builder.committed()), [])).toBeNull()
  })

  it('saves a 64-frame bridge crossing with the exact replayed progress and events', async () => {
    const start = startWithLogs(), writer = writerFor(start)
    const proofs: PublicV28Progress[] = []
    const runtime = createPublicV28ControllerRuntime(start,
      async (revision, lineage, witness, frameExpected) => {
        if (frameExpected) {
          proofs.push(structuredClone(frameExpected))
          Reflect.set(frameExpected.state.player, 'coins', -1)
        }
        return writer.write(revision, lineage, witness)
      })
    expect(await runtime.action(bridge)).toMatchObject({ status: 'saved' })
    const before = owned(runtime.committed())
    for (let index = 0; index < 64; index++)
      expect(runtime.advanceFrame(move(0.16), false).rejections).toEqual([])
    expect(runtime.status()).toMatchObject({ pendingFrames: 64,
      checkpointRecommended: true })
    const frames = Array.from({ length: 64 }, () => ({ intents: move(0.16),
      walkRequested: false }))
    const expected = replayPublicV28FramesWithEvents(before, frames)
    if (!expected) throw new Error('64-frame checked replay rejected')
    expect(runtime.preview()).toEqual(expected.progress)
    const saved = await runtime.save()
    expect(saved).toMatchObject({ status: 'saved' })
    if (saved.status !== 'saved') throw new Error(JSON.stringify(saved))
    expect(saved.events).toEqual(expected.events)
    expect(owned(runtime.committed())).toEqual(expected.progress)
    expect(proofs).toEqual([expected.progress])
    const witness = writer.write.mock.calls.at(-1)?.[2]
    expect(witness).toEqual({ kind: 'frame-batch/v1', frames })
    expect(createPublicV28ControllerRuntime(runtime.committed(), writer.write).preview())
      .toEqual(expected.progress)
    const v29Before = { ...before, miningTools: { basicPickOwned: false,
      enchantedPickOwned: false, activePick: null } }
    expect(replayPublicV29Witness(v29Before, witness)?.state).toEqual(expected.progress.state)
    expect(replayPublicV30Witness({ ...v29Before, claimedBridgeheadId: null }, witness)?.state)
      .toEqual(expected.progress.state)
  }, 60_000)

  it('lands and saves a dry flight with a saved bridge elsewhere', async () => {
    const base = startWithLogs(0)
    const savedBridge = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const from = { x: -148.25, z: 37.85 }, to = { x: -148.25, z: 38.01 }
    const upper = resolvePublicV23Surface(base.head.state, from, [])!
    const lower = resolvePublicV23Surface(base.head.state, to, [])!
    expect(upper.floorY - lower.floorY).toBeCloseTo(0.10591385867358216)
    const start: PublicV28Start = { ...base, head: { ...base.head,
      riverBridgeIds: [savedBridge.id], state: { ...base.head.state,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(base.head.state.discoveryMask),
          ...savedBridge.footprintTileIds, upper.tileId, lower.tileId])].sort()),
        player: { ...base.head.state.player,
          position: { ...from, y: upper.floorY } } } } }
    expect(publicV28BridgeSitesValid(owned(start))).toBe(true)
    const writer = writerFor(start)
    const runtime = createPublicV28ControllerRuntime(start, writer.write)
    const frames = [{ intents: move(0.16), walkRequested: false },
      ...Array.from({ length: 3 }, () => ({ intents: [], walkRequested: false }))]
    expect(replayPublicV28FramesWithEvents(owned(start), frames.slice(0, 1))).toBeNull()
    expect(runtime.advanceFrame(frames[0].intents, false).rejections).toEqual([])
    expect(runtime.preview().state.player.verticalVelocity).toBeLessThan(0)
    expect(await runtime.save()).toEqual({ status: 'deferred-airborne' })
    expect(writer.write).not.toHaveBeenCalled()
    for (const frame of frames.slice(1))
      expect(runtime.advanceFrame(frame.intents, false).rejections).toEqual([])
    expect(runtime.preview().state.player.position).toEqual({ ...to, y: lower.floorY })
    expect(runtime.preview().state.player.verticalVelocity).toBe(0)
    const replay = replayPublicV28FramesWithEvents(owned(start), frames)
    expect(replay?.progress).toEqual(runtime.preview())
    expect(await runtime.save()).toMatchObject({ status: 'saved', events: replay?.events })
    expect(writer.write).toHaveBeenCalledOnce()
    expect(writer.write.mock.calls[0]?.[2]).toEqual({ kind: 'frame-batch/v1', frames })
    expect(runtime.committed()).toEqual(writer.current())
    expect(runtime.advanceFrame(move(0.16), false).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writer.write).toHaveBeenCalledTimes(2)
    expect(runtime.committed()).toEqual(writer.current())
  }, 30_000)

  it('lands and saves an ordinary Greenway jump with a valid saved bridge', async () => {
    const base = startWithLogs(0)
    const fresh = createPublicV23Root(seed)
    const savedBridge = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const start: PublicV28Start = { ...base, head: { ...base.head,
      riverBridgeIds: [savedBridge.id], state: { ...fresh.head.state,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(fresh.head.state.discoveryMask),
          ...savedBridge.footprintTileIds])].sort()) } } }
    expect(decodePublicV23Progress({ state: start.head.state,
      greenwayWorks: start.head.greenwayWorks,
      regionalWorks: start.head.regionalWorks }, seed)).not.toBeNull()
    expect(publicV28BridgeSitesValid(owned(start))).toBe(true)
    const frames = [{ intents: [{ type: 'jump' as const }], walkRequested: false },
      ...Array.from({ length: 24 }, () => ({ intents: [], walkRequested: false }))]
    const withoutBridge = { ...owned(start), riverBridgeIds: [] }
    const baseline = replayPublicV28FramesWithEvents(withoutBridge, frames)
    expect(baseline?.progress.state.player.verticalVelocity).toBe(0)
    const writer = writerFor(start)
    const runtime = createPublicV28ControllerRuntime(start, writer.write)
    expect(runtime.advanceFrame(frames[0].intents, false).rejections).toEqual([])
    expect(runtime.preview().state.player.verticalVelocity).toBeGreaterThan(0)
    expect(await runtime.save()).toEqual({ status: 'deferred-airborne' })
    expect(writer.write).not.toHaveBeenCalled()
    for (const frame of frames.slice(1))
      expect(runtime.advanceFrame(frame.intents, false).rejections).toEqual([])
    expect(runtime.preview().state.player.verticalVelocity).toBe(0)
    const replay = replayPublicV28FramesWithEvents(owned(start), frames)
    expect(replay?.progress).toEqual(runtime.preview())
    expect(replay?.progress.state).toEqual(baseline?.progress.state)
    expect(replay?.events).toEqual(baseline?.events)
    expect(await runtime.save()).toMatchObject({ status: 'saved', events: replay?.events })
    expect(writer.write.mock.calls[0]?.[2]).toEqual({ kind: 'frame-batch/v1', frames })
    expect(runtime.committed()).toEqual(writer.current())
    expect(runtime.advanceFrame(move(0.16), false).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writer.write).toHaveBeenCalledTimes(2)
  }, 30_000)

  it('rejects an airborne step into an open pit without stranding the saved-bridge flight', async () => {
    const base = startWithLogs(0)
    const fresh = createPublicV23Root(seed)
    const savedBridge = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const point = { x: 1.9, z: 0 }
    const support = publicV17StarterSupportAt({ seed,
      profile: fresh.head.state.generationProfile,
      route: fresh.head.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
      built: false, greenwayWorks: base.head.greenwayWorks }, point)
    if (!support) throw new Error('Missing Greenway pit approach support')
    const start: PublicV28Start = { ...base, head: { ...base.head,
      riverBridgeIds: [savedBridge.id],
      terrain: { ...base.head.terrain, columns: [{ gx: 1, gz: 0,
        openDepth: 1, rewardDepth: 1, pitLadder: false }] },
      state: { ...fresh.head.state,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(fresh.head.state.discoveryMask),
          ...savedBridge.footprintTileIds])].sort()),
        player: { ...fresh.head.state.player,
          position: { ...point, y: support.floorY } } } } }
    expect(publicV28BridgeSitesValid(owned(start))).toBe(true)
    const writer = writerFor(start)
    const runtime = createPublicV28ControllerRuntime(start, writer.write)
    expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    const airborne = runtime.preview()
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.16, z: 0 } }], false)
      .rejections).toHaveLength(1)
    expect(runtime.preview()).toEqual(airborne)
    for (let index = 0; index < 24; index++)
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(runtime.preview().state.player.verticalVelocity).toBe(0)
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writer.write).toHaveBeenCalledOnce()
  }, 30_000)

  it('proves a saved-bridge jump can land within the frame cap before admitting takeoff', async () => {
    const base = startWithLogs(0)
    const fresh = createPublicV23Root(seed)
    const savedBridge = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-43')!
    const start: PublicV28Start = { ...base, head: { ...base.head,
      riverBridgeIds: [savedBridge.id], state: { ...fresh.head.state,
        discoveryMask: encodeDiscoveredTileIds([...new Set([
          ...decodeDiscoveredTileIds(fresh.head.state.discoveryMask),
          ...savedBridge.footprintTileIds])].sort()) } } }
    expect(publicV28BridgeSitesValid(owned(start))).toBe(true)
    const look = { intents: [{ type: 'look' as const,
      yawDelta: 0.001, pitchDelta: 0 }], walkRequested: false }
    const jump = { intents: [{ type: 'jump' as const }], walkRequested: false }
    const startAt = performance.now()
    const admitted = replayPublicV28FramesWithEvents(owned(start),
      [...Array.from({ length: 95 }, () => look), jump], true)
    const admissionMs = performance.now() - startAt
    expect(admitted?.progress.state.player.verticalVelocity).toBeGreaterThan(0)
    expect(admissionMs).toBeLessThan(20_000)
    expect(replayPublicV28FramesWithEvents(owned(start),
      [...Array.from({ length: 127 }, () => look), jump], true)).toBeNull()
    const writer = writerFor(start)
    const runtime = createPublicV28ControllerRuntime(start, writer.write)
    for (let index = 0; index < 96; index++)
      expect(runtime.advanceFrame(look.intents, false).rejections).toEqual([])
    expect(runtime.advanceFrame(jump.intents, false).rejections)
      .toEqual([expect.objectContaining({ code: 'unavailable_here' })])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(runtime.advanceFrame(jump.intents, false).rejections).toEqual([])
  }, 60_000)

  it('buffers a saved north-deck jump through landing and rejects an off-deck flight step', async () => {
    const builderStart = startWithLogs()
    const store = createAtomicV28Store(new IDBFactory())
    const genesis = { ...builderStart, previous: null }
    expect(decodePublicV28Root(genesis)).toEqual(genesis)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Missing V28 root')
    expect(await store.commit(missing.proof, genesis)).toBe('committed')
    const checkedWrite = vi.fn(async (revision: number, lineage: PublicV28Start['lineage'],
      witness: PublicV28Witness) => {
      const before = await store.readChecked()
      if (before.status !== 'valid' || before.root.head.saveRevision !== revision
        || !samePublicV14Value(before.root.lineage, lineage))
        return { ok: false as const, reason: 'revision-changed' }
      const replayed = replayPublicV28Witness(owned({ head: before.root.head,
        lineage: before.root.lineage }), witness)
      if (!replayed) return { ok: false as const, reason: 'frame-rejected' }
      const successor = { lineage: before.root.lineage, previous: before.root.head,
        head: { ...before.root.head, ...replayed, saveRevision: revision + 1, witness } }
      const receipt = await store.commit(before.proof, successor)
      if (receipt !== 'committed') return { ok: false as const, reason: receipt }
      const reloaded = await store.readChecked()
      return reloaded.status === 'valid'
        ? { ok: true as const, value: { head: reloaded.root.head,
          lineage: reloaded.root.lineage } }
        : { ok: false as const, reason: 'reload-failed' }
    })
    const builder = createPublicV28ControllerRuntime(builderStart, checkedWrite)
    expect(await builder.action(bridge)).toMatchObject({ status: 'saved' })
    for (let index = 0; index < 25; index++)
      expect(builder.advanceFrame(move(0.16), false).rejections).toEqual([])
    expect(await builder.save()).toMatchObject({ status: 'saved' })
    const start = builder.committed()
    expect(decodePublicV23Progress({ state: start.head.state,
      greenwayWorks: start.head.greenwayWorks,
      regionalWorks: start.head.regionalWorks }, seed)).not.toBeNull()
    expect(publicV28BridgeSitesValid(owned(start))).toBe(true)
    expect(projectPublicV28Pose(owned(start), start.head.terrain,
      start.head.riverBridgeIds)?.bridgeId).toBe(site.id)
    const frames = [{ intents: [{ type: 'jump' as const }], walkRequested: false },
      ...Array.from({ length: 24 }, () => ({ intents: [], walkRequested: false }))]
    expect(replayPublicV28FramesWithEvents(owned(start), frames.slice(0, 1))).toBeNull()
    expect(replayPublicV28FramesWithEvents(owned(start), frames.slice(0, 2), true)
      ?.progress.state.player.verticalVelocity).toBeGreaterThan(0)
    const writesBeforeJump = checkedWrite.mock.calls.length
    const runtime = createPublicV28ControllerRuntime(start, checkedWrite)
    expect(runtime.advanceFrame(frames[0].intents, false).rejections).toEqual([])
    expect(await runtime.save()).toEqual({ status: 'deferred-airborne' })
    expect(checkedWrite).toHaveBeenCalledTimes(writesBeforeJump)
    for (const frame of frames.slice(1))
      expect(runtime.advanceFrame(frame.intents, false).rejections).toEqual([])
    expect(runtime.preview().state.player.verticalVelocity).toBe(0)
    const replay = replayPublicV28FramesWithEvents(owned(start), frames)
    expect(replay?.progress).toEqual(runtime.preview())
    expect(await runtime.save()).toMatchObject({ status: 'saved', events: replay?.events })
    expect(checkedWrite.mock.calls[writesBeforeJump]?.[2])
      .toEqual({ kind: 'frame-batch/v1', frames })
    expect(runtime.advanceFrame(move(0.16), false).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    const persisted = await store.readChecked()
    expect(persisted).toMatchObject({ status: 'valid',
      root: { head: runtime.committed().head } })

    const boundary = createPublicV28ControllerRuntime(start, writerFor(start).write)
    expect(boundary.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    let denied = false
    for (let index = 0; index < 6; index++) {
      const before = boundary.preview()
      const result = boundary.advanceFrame([{ type: 'move', delta: { x: 0.16, z: 0 } }], false)
      if (!result.rejections.length) continue
      expect(boundary.preview()).toEqual(before)
      denied = true
      break
    }
    expect(denied).toBe(true)
    for (let index = 0; index < 24; index++)
      expect(boundary.advanceFrame([], false).rejections).toEqual([])
    expect(boundary.preview().state.player.verticalVelocity).toBe(0)
    expect(await boundary.save()).toMatchObject({ status: 'saved' })
  }, 60_000)

  it('freezes invalid saved bridge sites and mismatched checked writer replies', async () => {
    const start = startWithLogs(), builder = writerFor(start)
    const built = createPublicV28ControllerRuntime(start, builder.write)
    expect(await built.action(bridge)).toMatchObject({ status: 'saved' })
    const accepted = built.committed()
    const invalid: PublicV28Start = { ...accepted, head: { ...accepted.head,
      state: { ...accepted.head.state,
        discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(
          accepted.head.state.discoveryMask).filter((id) =>
          id !== site.footprintTileIds.at(-1))) } } }
    expect(publicV28BridgeSitesValid(owned(invalid))).toBe(false)
    const deniedWriter = vi.fn(async () => ({ ok: false as const, reason: 'not-called' }))
    const invalidRuntime = createPublicV28ControllerRuntime(invalid, deniedWriter)
    expect(invalidRuntime.advanceFrame(move(0.16), false).rejections).toEqual([])
    expect(await invalidRuntime.save()).toEqual({ status: 'blocked',
      reason: 'local-frame-replay' })
    expect(invalidRuntime.status().gate).toBe('blocked')
    expect(deniedWriter).not.toHaveBeenCalled()
    expect(invalidRuntime.committed()).toEqual(invalid)

    const writer = writerFor(start)
    const mismatched = createPublicV28ControllerRuntime(start, async (...args) => {
      const result = await writer.write(args[0], args[1], args[2])
      return result.ok ? { ok: true as const, value: { ...result.value,
        head: { ...result.value.head, state: { ...result.value.head.state,
          eventSequence: result.value.head.state.eventSequence + 1 } } } } : result
    })
    expect(mismatched.advanceFrame([{ type: 'move', delta: { x: 0.1, z: 0 } }], false)
      .rejections).toEqual([])
    expect(await mismatched.save()).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(mismatched.status().gate).toBe('blocked')
    expect(mismatched.committed()).toEqual(start)
    expect(await mismatched.save()).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
  }, 30_000)

  it('freezes a stale checked writer without advancing committed progress', async () => {
    const start = startWithLogs()
    const writer = vi.fn(async () => ({ ok: false as const, reason: 'revision-changed' }))
    const runtime = createPublicV28ControllerRuntime(start, writer)
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.1, z: 0 } }], false)
      .rejections).toEqual([])
    const preview = runtime.preview()
    expect(await runtime.save()).toEqual({ status: 'blocked', reason: 'revision-changed' })
    expect(writer).toHaveBeenCalledOnce()
    expect(runtime.status()).toMatchObject({ gate: 'blocked', saveRevision: 0,
      pendingFrames: 1 })
    expect(runtime.preview()).toEqual(preview)
    expect(runtime.committed()).toEqual(start)
  })
})
