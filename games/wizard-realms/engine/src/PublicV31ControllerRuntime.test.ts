import { describe, expect, it, vi } from 'vitest'
import { createPublicV31ControllerRuntime } from './PublicV31ControllerRuntime'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { createPublicV26Root } from './domain/publicWorldV26Snapshot'
import { createPublicV27Root } from './domain/publicWorldV27Snapshot'
import { createPublicV28Root } from './domain/publicWorldV28Snapshot'
import { createPublicV29Root } from './domain/publicWorldV29Snapshot'
import { createPublicV30Root, replayPublicV30Witness } from './domain/publicWorldV30Snapshot'
import { resolvePublicV28RiverBridge } from './domain/publicWorldV28RiverBridgeSites'
import { createPublicV31Root, replayPublicV31Witness } from './domain/publicWorldV31Snapshot'
import { replayPublicV31FramesWithEvents } from './domain/publicWorldV31Movement'
import type { PublicV31Witness } from './domain/publicWorldV31Snapshot'
import type { PublicV31Start } from './domain/publicWorldV31Flow'
import { decodePublicV31ActionProgress } from './domain/publicWorldV31Soil'

const seed = 'wizard-realms'
const move = (x: number) => [{ type: 'move' as const, delta: { x, z: 0 } }]

function genesis(worldSeed = seed): PublicV31Start {
  const v23 = createPublicV23Root(worldSeed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
  const v31 = createPublicV31Root(v30)
  return { head: v31.head, lineage: v31.lineage }
}

const fresh = genesis()

function writerFor(start: PublicV31Start) {
  let current = structuredClone(start)
  const write = vi.fn(async (revision: number, lineage: PublicV31Start['lineage'],
    witness: PublicV31Witness) => {
    if (revision !== current.head.saveRevision || !samePublicV14Value(lineage, current.lineage))
      return { ok: false as const, reason: 'revision-changed' }
    const next = replayPublicV31Witness(current.head, witness)
    if (!next) return { ok: false as const, reason: 'frame-rejected' }
    current = { lineage, head: { ...current.head, ...next,
      saveRevision: revision + 1, witness } }
    return { ok: true as const, value: current }
  })
  return { write, current: () => current }
}

function drySeamStart(): PublicV31Start {
  const base = genesis('greenway-alpha')
  const point = { x: -80.43882791987258, z: -30.0020115161052 }
  const floor = resolvePublicV23Surface(base.head.state, point, [])
  if (!floor) throw new Error('Missing upper-shelf support')
  return { ...base, head: { ...base.head,
    state: { ...base.head.state, movementOwner: 'streamed',
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.head.state.discoveryMask), floor.tileId])].sort()),
      player: { ...base.head.state.player,
        position: { ...point, y: floor.floorY } } } } }
}

describe('V31 controller runtime boundary', () => {
  it('keeps a dry descent replayable through a full frame batch and later saves', async () => {
    const start = drySeamStart()
    const writer = writerFor(start)
    const runtime = createPublicV31ControllerRuntime(start, writer.write)
    const intents = [{ type: 'move' as const,
      delta: { x: -0.15505746062087306, z: 0.03946116959501334 } }]
    for (let index = 1; index <= 65; index++) {
      expect(runtime.advanceFrame(intents, false).rejections, `frame ${index}`).toEqual([])
      if (index === 62) expect(runtime.preview().state.player.verticalVelocity).toBeLessThan(0)
      if (index === 63 || index === 64) {
        expect(runtime.preview().state.player.verticalVelocity).toBeLessThan(0)
        expect(await runtime.save()).toEqual({ status: 'deferred-airborne' })
        expect(writer.write).not.toHaveBeenCalled()
      }
    }
    expect(runtime.preview().state.player.position.x).toBeCloseTo(-90.51756286022894)
    expect(runtime.preview().state.player.verticalVelocity).toBe(0)
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writer.write).toHaveBeenCalledOnce()
    expect(writer.write.mock.calls[0]?.[2]).toEqual({ kind: 'frame-batch/v1',
      frames: Array.from({ length: 65 }, () => ({ intents, walkRequested: false })) })
    expect(runtime.committed()).toEqual(writer.current())
    for (let index = 0; index < 5; index++)
      expect(runtime.advanceFrame(intents, false).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writer.write).toHaveBeenCalledTimes(2)
    expect(writer.write.mock.calls[1]?.[2]).toEqual({ kind: 'frame-batch/v1',
      frames: Array.from({ length: 5 }, () => ({ intents, walkRequested: false })) })
    expect(runtime.committed()).toEqual(writer.current())
  }, 60_000)

  it('checkpoints a terminal dry descent at the frame cap and resumes movement', async () => {
    const start = drySeamStart(), setupWriter = writerFor(start)
    const setup = createPublicV31ControllerRuntime(start, setupWriter.write)
    const moveSeam = [{ type: 'move' as const,
      delta: { x: -0.15505746062087306, z: 0.03946116959501334 } }]
    for (let index = 0; index < 61; index++)
      expect(setup.advanceFrame(moveSeam, false).rejections, `setup ${index + 1}`).toEqual([])
    expect(await setup.save()).toMatchObject({ status: 'saved' })
    const atSeam = setup.committed()
    const landingWriter = writerFor(atSeam)
    const landing = createPublicV31ControllerRuntime(atSeam, landingWriter.write,
      undefined, true)
    const look = [{ type: 'look' as const, yawDelta: 0.001, pitchDelta: 0 }]
    for (let index = 0; index < 95; index++)
      expect(landing.advanceFrame(look, false).rejections).toEqual([])
    expect(landing.advanceFrame(moveSeam, false).rejections).toEqual([])
    expect(landing.preview().state.player.verticalVelocity).toBeLessThan(0)
    for (let index = 0; index < 4 && landing.preview().state.player.verticalVelocity !== 0; index++)
      expect(landing.advanceFrame([], false).rejections).toEqual([])
    expect(landing.preview().state.player.verticalVelocity).toBe(0)
    expect(landing.status().pendingFrames).toBeLessThan(128)
    expect(await landing.save()).toMatchObject({ status: 'saved' })
    expect(landingWriter.write).toHaveBeenCalledOnce()
    for (const looks of [125, 127]) {
      const writer = writerFor(atSeam)
      const runtime = createPublicV31ControllerRuntime(atSeam, writer.write,
        undefined, true)
      for (let index = 0; index < looks; index++)
        expect(runtime.advanceFrame(look, false).rejections, `look ${index + 1}`).toEqual([])
      expect(runtime.advanceFrame(moveSeam, false).rejections).toEqual([])
      expect(runtime.status()).toMatchObject({ pendingFrames: looks + 1,
        checkpointRequired: true })
      expect(runtime.preview().state.player.verticalVelocity).toBe(0)
      expect(runtime.advanceFrame(moveSeam, false).rejections)
        .toMatchObject([{ code: 'unavailable_here' }])
      const saved = await runtime.save()
      expect(saved).toMatchObject({ status: 'saved' })
      expect(writer.write).toHaveBeenCalledOnce()
      const batch = writer.write.mock.calls[0]?.[2]
      expect(batch?.kind).toBe('frame-batch/v1')
      expect(batch?.kind === 'frame-batch/v1' && batch.frames).toHaveLength(looks + 1)
      expect((writer.write.mock.calls[0] as unknown[])[3]).toBeTypeOf('function')
      if (batch?.kind === 'frame-batch/v1' && saved.status === 'saved')
        expect(saved.events).toEqual(replayPublicV31FramesWithEvents(atSeam.head,
          batch.frames)?.events)
      expect(runtime.status().pendingFrames).toBe(0)
      expect(runtime.advanceFrame(moveSeam, false).rejections).toEqual([])
      for (let index = 0; index < 4 && runtime.preview().state.player.verticalVelocity !== 0; index++)
        expect(runtime.advanceFrame([], false).rejections).toEqual([])
      expect(await runtime.save()).toMatchObject({ status: 'saved' })
      expect(writer.write).toHaveBeenCalledTimes(2)
      expect(runtime.committed()).toEqual(writer.current())
    }
  }, 60_000)

  it('keeps empty-sidecar frame save and compact view on the inherited checked path', async () => {
    const start = structuredClone(fresh), writer = writerFor(start)
    const runtime = createPublicV31ControllerRuntime(start, writer.write)
    expect(runtime.preview().raisedSoilCells).toEqual([])
    expect(runtime.view()).toBeDefined()
    expect(runtime.advanceFrame(move(0.02), false).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writer.write).toHaveBeenCalledOnce()
    expect(writer.write.mock.calls[0]?.[2].kind).toBe('frame-batch/v1')
    expect(runtime.committed()).toEqual(writer.current())
  }, 60_000)

  it('rejects forged starting mining tools before an opted-in frame proof can reach a writer', async () => {
    const start: PublicV31Start = { ...fresh, head: { ...fresh.head,
      miningTools: { basicPickOwned: false, enchantedPickOwned: false, activePick: 'basic' } } }
    const frame = { kind: 'frame-batch/v1' as const, frames: [{ intents: [{ type: 'look' as const,
      yawDelta: 0.001, pitchDelta: 0 }], walkRequested: false }] }
    expect(replayPublicV31Witness(start.head, frame)).toBeNull()
    let runtime: ReturnType<typeof createPublicV31ControllerRuntime>
    const write = vi.fn(async (revision: number, lineage: PublicV31Start['lineage'],
      witness: PublicV31Witness) => ({ ok: true as const, value: { lineage,
        head: { ...start.head, ...runtime.preview(), saveRevision: revision + 1, witness } } }))
    runtime = createPublicV31ControllerRuntime(start, write, undefined, true)
    expect(runtime.advanceFrame(frame.frames[0].intents, false).rejections).toEqual([])
    expect(await runtime.save()).toEqual({ status: 'blocked', reason: 'local-replay' })
    expect(write).not.toHaveBeenCalled()
    expect(runtime.committed()).toEqual(start)
  }, 60_000)

  it('rejects a new >0.8 m raised bank before mutating the frame preview', () => {
    const base = structuredClone(fresh)
    const x = 13.95, z = 4
    const support = publicV17StarterSupportAt({ seed,
      profile: base.head.state.generationProfile,
      route: base.head.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
      built: false, greenwayWorks: base.head.greenwayWorks }, { x, z })
    if (!support) throw new Error('Missing bank fixture support')
    const start: PublicV31Start = { ...base, head: { ...base.head,
      state: { ...base.head.state, player: { ...base.head.state.player,
        position: { x, y: support.floorY, z } } },
      raisedSoilCells: [{ gx: 4, gz: 1 }] } }
    const writer = writerFor(start)
    const runtime = createPublicV31ControllerRuntime(start, writer.write)
    const before = runtime.preview()
    expect(runtime.advanceFrame(move(0.1), false).rejections)
      .toMatchObject([{ code: 'terrain_missing' }])
    expect(runtime.preview()).toEqual(before)
    expect(writer.write).not.toHaveBeenCalled()
  }, 30_000)

  it('preflights an invalid soil action without a write', async () => {
    const writer = writerFor(fresh)
    const runtime = createPublicV31ControllerRuntime(fresh, writer.write)
    expect(await runtime.action({ kind: 'soil-place/v1', gx: 0, gz: 0 }))
      .toMatchObject({ status: 'rejected' })
    expect(writer.write).not.toHaveBeenCalled()
    expect(runtime.committed()).toEqual(fresh)
  }, 30_000)

  it('persists a checked soil placement and removes it without duplicating soil', async () => {
    let base = structuredClone(fresh)
    let site: { gx: number; gz: number; position: { x: number; y: number; z: number } } | null = null
    for (let gx = -10; gx <= 10 && !site; gx++) for (let gz = -10; gz <= 10; gz++) {
      const position = { x: (gx - 1) * 4, z: gz * 4 }
      const support = publicV17StarterSupportAt({ seed,
        profile: base.head.state.generationProfile,
        route: base.head.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
        built: false, greenwayWorks: base.head.greenwayWorks }, position)
      if (support?.kind === 'ground') {
        const candidate: PublicV31Start = { ...base, head: { ...base.head,
          terrain: { ...base.head.terrain, bag: { ...base.head.terrain.bag, soil: 1 } },
          state: { ...base.head.state,
            discoveryMask: encodeDiscoveredTileIds([...new Set([
              ...decodeDiscoveredTileIds(base.head.state.discoveryMask),
              `tile-${gx + 3}-${gz + 3}`])].sort()),
            player: { ...base.head.state.player,
              position: { ...position, y: support.floorY },
              inventory: [...base.head.state.player.inventory,
                { itemId: 'field_spade' as const, quantity: 1 }],
              equipment: { ...base.head.state.player.equipment,
                mainHand: 'field_spade' } } } } }
        if (replayPublicV31Witness(candidate.head, { kind: 'soil-place/v1', gx, gz })) {
          base = candidate
          site = { gx, gz, position: candidate.head.state.player.position }
          break
        }
      }
    }
    if (!site) throw new Error('No checked placement fixture')
    const writer = writerFor(base)
    const runtime = createPublicV31ControllerRuntime(base, writer.write, undefined, true)
    expect(await runtime.action({ kind: 'soil-place/v1', gx: site.gx, gz: site.gz }))
      .toMatchObject({ status: 'saved' })
    expect(runtime.preview().raisedSoilCells).toEqual([{ gx: site.gx, gz: site.gz }])
    expect(runtime.preview().terrain.bag.soil).toBe(0)
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.001, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writer.write.mock.calls[1]).toHaveLength(3)
    expect(await runtime.action({ kind: 'soil-remove/v1', gx: site.gx, gz: site.gz }))
      .toMatchObject({ status: 'saved' })
    expect(runtime.preview().raisedSoilCells).toEqual([])
    expect(runtime.preview().terrain.bag.soil).toBe(1)
    expect(writer.write).toHaveBeenCalledTimes(3)
  }, 60_000)

  it('rejects a V30-valid river bridge that would overlap saved soil without freezing', async () => {
    const bridgeSeed = 'greenway-alpha'
    const site = resolvePublicV28RiverBridge(bridgeSeed, 'works6:river-bridge:-14')
    if (!site) throw new Error('Missing river bridge')
    const source = genesis(bridgeSeed)
    const floor = resolvePublicV23Surface(source.head.state, site.from, [])
    if (!floor) throw new Error('Missing bank floor')
    const state = { ...source.head.state, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(source.head.state.discoveryMask),
        ...site.footprintTileIds])].sort()),
      player: { ...source.head.state.player,
        position: { ...site.from, y: floor.floorY },
        inventory: [...source.head.state.player.inventory,
          { itemId: 'logs' as const, quantity: 12 }] } }
    const witness = { kind: 'river-bridge/v1' as const, id: site.id }
    let start: PublicV31Start | null = null
    for (const id of site.footprintTileIds) {
      const match = /^tile-(-?\d+)-(-?\d+)$/.exec(id)
      if (!match) continue
      const candidate: PublicV31Start = { ...source, head: { ...source.head, state,
        raisedSoilCells: [{ gx: Number(match[1]) - 3, gz: Number(match[2]) - 3 }] } }
      const { schemaVersion: _schema, saveRevision: _revision,
        witness: _witness, ...candidateProgress } = candidate.head
      const { raisedSoilCells: _cells, ...old } = candidateProgress
      if (decodePublicV31ActionProgress(candidateProgress)
        && replayPublicV30Witness(old, witness)
        && !replayPublicV31Witness(candidateProgress, witness)) {
        start = candidate
        break
      }
    }
    if (!start) throw new Error('Missing valid soil overlap fixture')
    const writer = writerFor(start)
    const runtime = createPublicV31ControllerRuntime(start, writer.write)
    expect(await runtime.action(witness)).toEqual({ status: 'rejected', reason: 'soil_overlap' })
    expect(writer.write).not.toHaveBeenCalled()
    expect(runtime.status().gate).not.toBe('blocked')
    expect(runtime.committed()).toEqual(start)
    expect(runtime.advanceFrame(move(0.02), false).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writer.write).toHaveBeenCalledOnce()
  }, 60_000)
})
