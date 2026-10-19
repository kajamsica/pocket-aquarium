import { describe, expect, it, vi } from 'vitest'
import { createPublicV26ControllerRuntime, createPublicV27ControllerRuntime } from './PublicV26ControllerRuntime'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { mireglassBermFaceRowAt, mireglassFenRowAt } from './domain/mireglassTerrain'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { createPublicV23Root, decodePublicV23Progress } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { createPublicV26Root } from './domain/publicWorldV26Snapshot'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { previewPublicV17GreenwayWork } from './domain/publicWorldV17GreenwayWork'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import { createPublicV27Root, replayPublicV27Witness } from './domain/publicWorldV27Snapshot'
import type { PublicV27Start } from './domain/publicWorldV27Flow'

const seed = 'wizard-realms'
const move = (x: number, z = 0) => [{ type: 'move' as const, delta: { x, z } }]
const owned = ({ head }: PublicV27Start) => ({ state: head.state,
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
  terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs })
function atPoint(point = { x: 13.95, z: 4 }, owner: 'greenway' | 'streamed' = 'greenway',
  bridge?: string, pit?: { gx: number; gz: number; depth: number }, logs?: number,
  discoveredSiteId?: string):
  PublicV27Start {
  const v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const base = v24.head
  const greenwayWorks = bridge ? { ...base.greenwayWorks, builtBridgeIds: [bridge] }
    : base.greenwayWorks
  const state = { ...base.state, movementOwner: owner, player: bridge
    ? { ...base.state.player, xp: base.state.player.xp + 80,
      skillXp: { ...base.state.player.skillXp,
        construction: base.state.player.skillXp.construction + 80 } }
    : base.state.player }
  if (logs !== undefined) state.player = { ...state.player,
    inventory: [...state.player.inventory.filter((stack) => stack.itemId !== 'logs'),
      { itemId: 'logs', quantity: logs }] }
  const support = owner === 'greenway' ? publicV17StarterSupportAt({ seed,
    profile: base.state.generationProfile,
    route: base.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks }, point)
    : resolvePublicV23Surface(state, point, base.regionalWorks.builtLadderIds)
  if (!support) throw new Error('Missing dry lip support')
  const discoveredSite = discoveredSiteId
    ? resolvePublicV17GreenwaySite(seed, discoveredSiteId) : null
  const discoveryMask = discoveredSite
    ? encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(state.discoveryMask), ...discoveredSite.footprintTileIds])].sort())
    : owner === 'streamed' && 'tileId' in support
    ? encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(state.discoveryMask), support.tileId])].sort())
    : state.discoveryMask
  const shaped = decodePublicV23Progress({ state: { ...state, discoveryMask,
    player: { ...state.player, position: { ...point, y: support.floorY } } },
    greenwayWorks, regionalWorks: base.regionalWorks }, seed)
  if (!shaped) throw new Error('Invalid dry lip fixture')
  const v25 = createPublicV25Root({ head: { ...base, ...shaped,
    saveRevision: 1, witness: { kind: 'checkpoint' as const } }, lineage: v24.lineage })
  const v25Head = pit ? { ...v25.head, saveRevision: 1,
    witness: { kind: 'checkpoint' as const }, excavation: {
      ...v25.head.excavation, columns: [pit] } } : v25.head
  const v26 = createPublicV26Root({ head: v25Head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  return { head: v27.head, lineage: v27.lineage }
}

describe('V27 checked controller runtime', () => {
  it('saves and reloads a formerly blocked ordinary lip through V27 replay', async () => {
    const start = atPoint()
    const old = createPublicV26ControllerRuntime(start.lineage.sourceReceipt,
      async () => ({ ok: false as const, reason: 'not-called' }))
    expect(old.advanceFrame(move(0.1), false).rejections).not.toEqual([])
    let current = start
    const writer = vi.fn(async (revision: number, lineage: PublicV27Start['lineage'],
      witness: NonNullable<PublicV27Start['head']['witness']>) => {
      if (revision !== current.head.saveRevision || !samePublicV14Value(lineage, current.lineage))
        return { ok: false as const, reason: 'revision-changed' }
      const next = replayPublicV27Witness(owned(current), witness)
      if (!next) return { ok: false as const, reason: 'frame-rejected' }
      current = { lineage, head: { ...current.head, ...next,
        saveRevision: revision + 1, witness } }
      return { ok: true as const, value: current }
    })
    const runtime = createPublicV27ControllerRuntime(start, writer)
    expect(runtime.advanceFrame(move(0.1), false).rejections).toEqual([])
    expect(runtime.preview().state.player.position.x).toBeCloseTo(14.05)
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(writer).toHaveBeenCalledOnce()
    const reload = createPublicV27ControllerRuntime(runtime.committed(),
      async () => ({ ok: false as const, reason: 'not-called' }))
    expect(reload.preview()).toEqual(runtime.preview())
    expect(reload.advanceFrame(move(-0.1), false).rejections).toEqual([])
    expect(reload.preview().state.player.position.x).toBeCloseTo(13.95)
  })

  it.each([
    { point: { x: 13.95, z: 5.95 }, delta: { x: 0.1, z: 0.1 }, cause: /river blocks this step/i },
    { point: { x: 28, z: -5.95 }, delta: { x: 0, z: -0.1 }, cause: /cliff needs a ladder/i },
    { point: { x: 29.95, z: 0 }, delta: { x: 0.1, z: 0 }, cause: /rock wall closes this side/i },
  ])('explains the actual V27 obstruction at $point without changing state', ({ point, delta, cause }) => {
    const start = atPoint(point)
    const runtime = createPublicV27ControllerRuntime(start,
      async () => ({ ok: false as const, reason: 'not-called' }))
    const before = runtime.preview()
    expect(runtime.advanceFrame(move(delta.x, delta.z), false).rejections)
      .toEqual([expect.objectContaining({ code: 'terrain_missing', message: expect.stringMatching(cause) })])
    expect(runtime.preview()).toEqual(before)
    expect(runtime.status().pendingFrames).toBe(0)
  })

  it.each([
    { logs: 4, message: /You have enough logs\./ },
    { logs: 2, message: /Chop 2 more logs\./ },
  ])('uses carried logs for the V27 north-rim cue with $logs logs', ({ logs, message }) => {
    const start = atPoint({ x: 28, z: -5.95 }, 'greenway', undefined, undefined, logs)
    const runtime = createPublicV27ControllerRuntime(start,
      async () => ({ ok: false as const, reason: 'not-called' }))
    expect(runtime.advanceFrame(move(0, -0.1), false).rejections)
      .toEqual([expect.objectContaining({ code: 'terrain_missing',
        message: expect.stringMatching(message) })])
    expect(runtime.preview()).toEqual(owned(start))
  })

  it('guides an ineligible cliff face toward a marked ladder site', () => {
    const start = atPoint({ x: 29.6, z: -5.95 }, 'greenway', undefined, undefined, 4)
    const runtime = createPublicV27ControllerRuntime(start,
      async () => ({ ok: false as const, reason: 'not-called' }))
    expect(runtime.advanceFrame(move(0, -0.1), false).rejections)
      .toEqual([expect.objectContaining({ code: 'terrain_missing',
        message: expect.stringMatching(/You have enough logs\. Follow the lower cliff face until Works marks a buildable ladder site\./) })])
    expect(runtime.preview()).toEqual(owned(start))
  })

  it('does not promise to build while standing inside a discovered ladder footprint', () => {
    const siteId = 'works4:ladder:greenway-north-cliff:11'
    const start = atPoint({ x: 1.1, z: -5.95 }, 'greenway', undefined, undefined, 4, siteId)
    expect(previewPublicV17GreenwayWork({ state: start.head.state,
      greenwayWorks: start.head.greenwayWorks }, siteId).rejection).toBe('occupied')
    const runtime = createPublicV27ControllerRuntime(start,
      async () => ({ ok: false as const, reason: 'not-called' }))
    expect(runtime.advanceFrame(move(0, -0.1), false).rejections)
      .toEqual([expect.objectContaining({ code: 'terrain_missing',
        message: expect.stringMatching(/You have enough logs\. Follow the lower cliff face until Works marks a buildable ladder site\./) })])
    expect(runtime.preview()).toEqual(owned(start))
  })

  it('names the finite streamed world edge instead of a terrain failure', () => {
    const start = atPoint({ x: 1021.95, z: 0 }, 'streamed')
    const runtime = createPublicV27ControllerRuntime(start,
      async () => ({ ok: false as const, reason: 'not-called' }))
    expect(runtime.advanceFrame(move(0.1), false).rejections)
      .toEqual([expect.objectContaining({ code: 'terrain_missing',
        message: expect.stringMatching(/edge of this world/i) })])
    expect(runtime.preview()).toEqual(owned(start))
  })

  it('names the authored fen channel rather than all marsh ground', () => {
    const row = mireglassFenRowAt(seed, -352)
    const start = atPoint({ x: -352, z: row - 2.05 }, 'streamed')
    const runtime = createPublicV27ControllerRuntime(start,
      async () => ({ ok: false as const, reason: 'not-called' }))
    expect(runtime.advanceFrame(move(0, 0.1), false).rejections)
      .toEqual([expect.objectContaining({ message: expect.stringMatching(/unsupported wetland/i) })])
    expect(runtime.preview()).toEqual(owned(start))
  })

  it('distinguishes the authored slate cliff from the fen channel', () => {
    const row = mireglassBermFaceRowAt(seed, -400)
    const start = atPoint({ x: -400, z: row - 2.05 }, 'streamed')
    const runtime = createPublicV27ControllerRuntime(start,
      async () => ({ ok: false as const, reason: 'not-called' }))
    expect(runtime.advanceFrame(move(0, 0.1), false).rejections)
      .toEqual([expect.objectContaining({ message: expect.stringMatching(/slate cliff blocks/i) })])
    expect(runtime.preview()).toEqual(owned(start))
  })

  it('points toward the dry end of a nearby saved bridge instead of another build', () => {
    const bridge = resolvePublicV17GreenwaySite(seed, 'works3:bridge:1')
    if (bridge?.kind !== 'bridge') throw new Error('Missing saved bridge fixture')
    const start = atPoint({ x: bridge.from.x + bridge.widthMeters / 2 - 0.05,
      z: 5.95 }, 'greenway', bridge.id)
    const runtime = createPublicV27ControllerRuntime(start,
      async () => ({ ok: false as const, reason: 'not-called' }))
    expect(runtime.advanceFrame(move(0.1, 0.1), false).rejections)
      .toEqual([expect.objectContaining({ message: expect.stringMatching(/built bridge from its dry end/i) })])
  })

  it('identifies a too-steep excavated edge without opening the pit', () => {
    const start = atPoint({ x: 12, z: -1.95 }, 'greenway', undefined,
      { gx: 3, gz: 0, depth: 2 })
    const runtime = createPublicV27ControllerRuntime(start,
      async () => ({ ok: false as const, reason: 'not-called' }))
    expect(runtime.advanceFrame(move(0, -0.1), false).rejections)
      .toEqual([expect.objectContaining({ message: expect.stringMatching(/pit edge is too steep/i) })])
    expect(runtime.preview()).toEqual(owned(start))
  })

})
