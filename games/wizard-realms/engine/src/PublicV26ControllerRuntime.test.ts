import { describe, expect, it, vi } from 'vitest'
import { createPublicV26ControllerRuntime } from './PublicV26ControllerRuntime'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { createPublicV23Root, decodePublicV23Progress } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import type { PublicV26Start } from './domain/publicWorldV26Flow'
import { createPublicV26Root, replayPublicV26Witness } from './domain/publicWorldV26Snapshot'
import type { PublicV26Witness } from './domain/publicWorldV26Snapshot'

const seed = 'wizard-realms'
const move = (x: number, z: number) => [{ type: 'move' as const, delta: { x, z } }]
const noWrite = async () => ({ ok: false as const, reason: 'not-called' })
const owned = ({ head }: PublicV26Start) => ({ state: head.state,
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
  terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs })

function at(point: { x: number; z: number }, options: {
  ladder?: string; bridge?: string; pit?: { gx: number; gz: number; depth: number }; logs?: number
} = {}): PublicV26Start {
  const v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const base = v24.head
  const greenwayWorks = { ...base.greenwayWorks,
    builtLadderIds: options.ladder ? [options.ladder] : base.greenwayWorks.builtLadderIds,
    builtBridgeIds: options.bridge ? [options.bridge] : base.greenwayWorks.builtBridgeIds }
  const route = base.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
  const support = publicV17StarterSupportAt({ seed, profile: base.state.generationProfile,
    route, built: base.state.greenway.builtRouteIds.includes('greenway_ladder'),
    greenwayWorks }, point)
  if (!support) throw new Error('Missing old support fixture')
  const construction = Number(!!options.ladder) * 60 + Number(!!options.bridge) * 80
  const inventory = options.logs === undefined ? base.state.player.inventory
    : [...base.state.player.inventory.filter((stack) => stack.itemId !== 'logs'),
      { itemId: 'logs', quantity: options.logs }]
  const discoveryMask = options.logs === undefined ? base.state.discoveryMask
    : encodeDiscoveredTileIds([...new Set([...decodeDiscoveredTileIds(base.state.discoveryMask),
      `tile-${Math.ceil(point.x / 4 - 0.5) + 3}-${Math.ceil(point.z / 4 - 0.5) + 3}`])].sort())
  const old = decodePublicV23Progress({ state: { ...base.state,
    discoveryMask,
    player: { ...base.state.player, xp: base.state.player.xp + construction,
      inventory,
      skillXp: { ...base.state.player.skillXp,
        construction: base.state.player.skillXp.construction + construction },
      position: { ...point, y: support.floorY } } },
    greenwayWorks, regionalWorks: base.regionalWorks }, seed)
  if (!old) throw new Error('Invalid old fixture')
  const v25 = createPublicV25Root({ head: { ...base, ...old, saveRevision: 1,
    witness: { kind: 'checkpoint' as const } }, lineage: v24.lineage })
  const head = options.pit ? { ...v25.head, saveRevision: 1,
    witness: { kind: 'checkpoint' as const }, excavation: {
      columns: [options.pit], bag: { ...v25.head.excavation.bag } } } : v25.head
  const root = createPublicV26Root({ head, lineage: v25.lineage })
  return { head: root.head, lineage: root.lineage }
}

function writerFor(initial: PublicV26Start) {
  let current = initial
  return vi.fn(async (revision: number, lineage: PublicV26Start['lineage'],
    witness: PublicV26Witness) => {
    if (revision !== current.head.saveRevision || lineage.seed !== current.lineage.seed)
      return { ok: false as const, reason: 'stale' }
    const next = replayPublicV26Witness(owned(current), witness)
    if (!next) return { ok: false as const, reason: 'frame-rejected' }
    current = { head: { ...current.head, ...next, saveRevision: revision + 1, witness },
      lineage: current.lineage }
    return { ok: true as const, value: current }
  })
}

function returnHomeFor(start: PublicV26Start, atMs = 10_000) {
  return vi.fn(async (revision: number, lineage: PublicV26Start['lineage']) => {
    const witness = { kind: 'return-home/v1' as const, atMs }
    const next = replayPublicV26Witness(owned(start), witness)
    if (!next) return { ok: false as const, reason: 'not_trapped' }
    return { ok: true as const, value: { lineage, head: { ...start.head, ...next,
      saveRevision: revision + 1, witness } } }
  })
}

describe('V26 checked controller runtime', () => {
  it('takes a checked partial stride at the dry x=6,z=-2 tile corner', async () => {
    const start = at({ x: 5.95, z: -1.95 })
    const direct = { kind: 'frame-batch/v1' as const,
      frames: [{ intents: move(0.1, -0.1), walkRequested: false }] }
    expect(replayPublicV26Witness(owned(start), direct)).toBeNull()
    const write = writerFor(start), runtime = createPublicV26ControllerRuntime(start, write)
    expect(runtime.advanceFrame(move(0.1, -0.1), false).rejections).toEqual([])
    expect(runtime.preview().state.player.position).not.toEqual(start.head.state.player.position)
    expect((await runtime.save()).status).toBe('saved')
    const witness = write.mock.calls[0][2]
    if (witness.kind !== 'frame-batch/v1') throw new Error('Missing corner frame witness')
    expect(witness.frames[0].intents.find((intent) => intent.type === 'move'))
      .toMatchObject({ delta: { x: 0.1, z: 0 } })
    expect(replayPublicV26Witness(owned(start), witness)).toEqual(owned(runtime.committed()))
    const reloaded = createPublicV26ControllerRuntime(runtime.committed(), noWrite)
    expect(reloaded.preview()).toEqual(runtime.preview())
    expect(reloaded.advanceFrame(move(0.1, -0.1), false).rejections).toEqual([])
    expect(reloaded.preview().state.player.position.x).toBeGreaterThan(6.1)
    expect(reloaded.preview().state.player.position.z).toBeLessThan(-2)
  })

  it.each([
    { point: { x: 13.95, z: 5.95 }, delta: { x: 0.1, z: 0.1 },
      message: 'River crossing blocked. Build a bridge to cross.' },
    { point: { x: 27.95, z: -5.95 }, delta: { x: 0.1, z: -0.1 },
      message: 'Build a ladder at this cliff face.' },
  ])('does not split a real river or rim crossing at $point', ({ point, delta, message }) => {
    const start = at(point), runtime = createPublicV26ControllerRuntime(start, noWrite)
    expect(runtime.advanceFrame(move(delta.x, delta.z), false).rejections)
      .toEqual([expect.objectContaining({ code: 'terrain_missing', message })])
    expect(runtime.preview()).toEqual(owned(start))
    expect(runtime.status().pendingFrames).toBe(0)
  })

  it('rejects the unbuilt north seam at x=28 without changing preview', () => {
    const start = at({ x: 28, z: -5.95 })
    const runtime = createPublicV26ControllerRuntime(start, noWrite)
    const before = runtime.preview()
    expect(runtime.advanceFrame(move(0, -0.1), false).rejections)
      .toEqual([expect.objectContaining({ code: 'terrain_missing',
        message: 'Build a ladder at this cliff face.' })])
    expect(runtime.preview()).toEqual(before)
    expect(runtime.status().pendingFrames).toBe(0)
  })

  it.each([-5.95, -5.1])('guides a near off-axis start at z=%s through saved rungs', async (z) => {
    const ladder = 'works4:ladder:greenway-north-cliff:11'
    const start = at({ x: 0, z }, { ladder })
    const write = writerFor(start), runtime = createPublicV26ControllerRuntime(start, write)
    for (let frame = 0; frame < 48 && runtime.preview().state.player.position.z > -6.4;
      frame += 1) expect(runtime.advanceFrame(move(0, -0.1), false).rejections).toEqual([])
    expect(runtime.preview().state.player.position).toMatchObject({ x: expect.any(Number),
      z: expect.any(Number) })
    expect(runtime.preview().state.player.position.x).toBeGreaterThan(0.5)
    expect(runtime.preview().state.player.position.z).toBeLessThan(-6.4)
    expect((await runtime.save()).status).toBe('saved')
    const witness = write.mock.calls[0][2]
    if (witness.kind !== 'frame-batch/v1') throw new Error('Missing guided frame witness')
    const deltas = witness.frames.flatMap((frame) => frame.intents.flatMap((intent) =>
      intent.type === 'move' ? [intent.delta] : []))
    expect(deltas[0]).toEqual(z < -5.35 ? { x: 0, z: 0.1 } : { x: 0.1, z: 0 })
    expect(deltas.some((delta) => delta.x > 0)).toBe(true)
    expect(deltas.some((delta) => delta.z < 0)).toBe(true)
    if (z < -5.35) expect(deltas.some((delta) => delta.z > 0)).toBe(true)
    expect(deltas.every((delta) => Math.hypot(delta.x, delta.z) <= 0.1 + 1e-6)).toBe(true)
    expect(replayPublicV26Witness(owned(start), witness)).toEqual(owned(runtime.committed()))
    expect(createPublicV26ControllerRuntime(runtime.committed(), noWrite).preview())
      .toEqual(runtime.preview())
  })

  it('does not steer distant, lateral, backward, or airborne input', () => {
    const ladder = 'works4:ladder:greenway-north-cliff:11'
    const far = createPublicV26ControllerRuntime(at({ x: 28, z: -5.95 }, { ladder }), noWrite)
    expect(far.advanceFrame(move(0, -0.1), false).rejections)
      .toEqual([expect.objectContaining({ code: 'terrain_missing',
        message: 'A ladder is already built farther along this cliff. Follow the lower cliff face to its rungs.' })])
    const lateral = createPublicV26ControllerRuntime(at({ x: 0, z: -5.95 }, { ladder }), noWrite)
    expect(lateral.advanceFrame(move(0.1, 0), false).rejections).toEqual([])
    expect(lateral.preview().state.player.position).toMatchObject({ x: 0.1, z: -5.95 })
    const backward = createPublicV26ControllerRuntime(at({ x: 0, z: -5.95 }, { ladder }), noWrite)
    expect(backward.advanceFrame(move(0, 0.1), false).rejections).toEqual([])
    expect(backward.preview().state.player.position.x).toBe(0)
    expect(backward.preview().state.player.position.z).toBeCloseTo(-5.85)
    const airborne = createPublicV26ControllerRuntime(at({ x: 0, z: -4.9 }, { ladder }), noWrite)
    expect(airborne.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    expect(airborne.advanceFrame(move(0, -0.1), false).rejections).toEqual([])
    expect(airborne.preview().state.player.position.x).toBe(0)
  })

  it('leaves upper-side forward travel unchanged beside a saved lower-bank ladder', () => {
    const ladder = 'works4:ladder:greenway-north-cliff:11'
    const upper = createPublicV26ControllerRuntime(at({ x: 0, z: -6.1 }, { ladder }), noWrite)
    expect(upper.advanceFrame(move(0, -0.1), false).rejections).toEqual([])
    expect(upper.preview().state.player.position.x).toBe(0)
    expect(upper.preview().state.player.position.z).toBeCloseTo(-6.2)
  })

  it('accepts the saved Works ladder opening and checkpoints full V26 progress', async () => {
    const start = at({ x: -2, z: -5.95 },
      { ladder: 'works4:ladder:greenway-north-cliff:-20' })
    const write = writerFor(start), runtime = createPublicV26ControllerRuntime(start, write)
    expect(runtime.advanceFrame(move(0, -0.1), false).rejections).toEqual([])
    expect(runtime.status().pendingFrames).toBe(1)
    expect(runtime.view().player.position).toEqual(runtime.preview().state.player.position)
    expect((await runtime.save()).status).toBe('saved')
    expect(runtime.status()).toMatchObject({ saveRevision: 1, pendingFrames: 0, gate: 'open' })
    expect(runtime.committed().head.terrain).toEqual(start.head.terrain)
    expect(write).toHaveBeenCalledOnce()
  })

  it('allows the saved bridge deck but rejects an effective uphill pit exit', () => {
    const site = resolvePublicV17GreenwaySite(seed, 'works3:bridge:1')
    if (!site || site.kind !== 'bridge') throw new Error('Missing bridge fixture')
    const bridge = createPublicV26ControllerRuntime(at(site.gapCenter, { bridge: site.id }), noWrite)
    expect(bridge.advanceFrame(move(0, 0.16), false).rejections).toEqual([])
    const pit = createPublicV26ControllerRuntime(at({ x: 12, z: -1.95 },
      { pit: { gx: 3, gz: 0, depth: 2 } }), noWrite)
    const before = pit.preview()
    expect(pit.advanceFrame(move(0, -0.1), false).rejections)
      .toEqual([expect.objectContaining({ code: 'terrain_missing' })])
    expect(pit.preview()).toEqual(before)
    expect(pit.status().pendingFrames).toBe(0)
  })

  it('explains that an unsaved creek crossing needs a bridge', () => {
    const runtime = createPublicV26ControllerRuntime(at({ x: 12, z: 5.95 }), noWrite)
    expect(runtime.advanceFrame(move(0, 0.16), false).rejections)
      .toEqual([expect.objectContaining({ code: 'terrain_missing',
        message: 'River crossing blocked. Build a bridge to cross.' })])
  })

  it('previews airborne frames but defers a checkpoint until grounded', async () => {
    const start = at({ x: 12, z: 4 })
    const runtime = createPublicV26ControllerRuntime(start, writerFor(start))
    expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    expect(runtime.preview().state.player.verticalVelocity).toBeGreaterThan(0)
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(await runtime.save()).toEqual({ status: 'deferred-airborne' })
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 2 })
    for (let frame = 0; frame < 32 && runtime.preview().state.player.verticalVelocity !== 0;
      frame += 1) expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(runtime.preview().state.player.verticalVelocity).toBe(0)
    expect((await runtime.save()).status).toBe('saved')
  })

  it('blocks a writer response with altered V26 terrain and keeps the old committed head', async () => {
    const start = at({ x: 12, z: 4 })
    const good = writerFor(start)
    const runtime = createPublicV26ControllerRuntime(start, async (revision, lineage, witness) => {
      const reply = await good(revision, lineage, witness)
      return reply.ok ? { ok: true as const, value: { ...reply.value,
        head: { ...reply.value.head, terrain: { ...reply.value.head.terrain,
          bag: { ...reply.value.head.terrain.bag, soil: 1 } } } } } : reply
    })
    expect(runtime.advanceFrame(move(0.1, 0), false).rejections).toEqual([])
    expect(await runtime.save()).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(runtime.committed()).toEqual(start)
    expect(runtime.status()).toMatchObject({ gate: 'blocked', pendingFrames: 1 })
  })

  it('flushes pending movement before an action and rejects an invalid dig', async () => {
    const start = at({ x: 12, z: 4 }), write = writerFor(start)
    const runtime = createPublicV26ControllerRuntime(start, write)
    expect(runtime.advanceFrame(move(0.1, 0), false).rejections).toEqual([])
    expect(await runtime.action({ kind: 'terrain-action/v1',
      action: { kind: 'dig', gx: 0, gz: 0 } })).toEqual({ status: 'rejected', reason: 'occupied' })
    expect(runtime.status()).toMatchObject({ saveRevision: 1, pendingFrames: 0, gate: 'open' })
    expect(write).toHaveBeenCalledOnce()
  })

  it('saves a writer-stamped return home but never accepts its timestamp as an ordinary action', async () => {
    const start = at({ x: 12, z: 4 }, { pit: { gx: 3, gz: 1, depth: 8 } })
    const write = writerFor(start), home = returnHomeFor(start)
    const runtime = createPublicV26ControllerRuntime(start, write, home)
    expect(await runtime.action({ kind: 'return-home/v1', atMs: 10_000 } as never))
      .toEqual({ status: 'rejected', reason: 'invalid-action' })
    expect(write).not.toHaveBeenCalled()
    expect(home).not.toHaveBeenCalled()
    expect(await runtime.returnHome()).toMatchObject({ status: 'saved', resetWalkRequested: false })
    expect(home).toHaveBeenCalledWith(0, start.lineage)
    expect(runtime.committed().head.witness).toEqual({ kind: 'return-home/v1', atMs: 10_000 })
    expect(runtime.preview()).toMatchObject({ nextHomeAtMs: 1_810_000,
      state: { player: { position: { x: 0, z: 0 } } } })
    expect(runtime.status()).toMatchObject({ gate: 'open', saveRevision: 1, pendingFrames: 0 })
  })

  it('keeps domain return-home denials nonblocking but blocks source failures', async () => {
    const start = at({ x: 12, z: 4 })
    const unavailable = createPublicV26ControllerRuntime(start, noWrite)
    expect(await unavailable.returnHome()).toEqual({ status: 'rejected',
      reason: 'return-home-unavailable' })
    const home = vi.fn().mockResolvedValueOnce({ ok: false, reason: 'not_trapped' })
      .mockResolvedValueOnce({ ok: false, reason: 'cooldown' })
      .mockResolvedValueOnce({ ok: false, reason: 'source-changed' })
    const runtime = createPublicV26ControllerRuntime(start, noWrite, home)
    expect(await runtime.returnHome()).toEqual({ status: 'rejected', reason: 'not_trapped' })
    expect(await runtime.returnHome()).toEqual({ status: 'rejected', reason: 'cooldown' })
    expect(runtime.status().gate).toBe('open')
    expect(await runtime.returnHome()).toEqual({ status: 'blocked', reason: 'source-changed' })
    expect(runtime.committed()).toEqual(start)
  })

  it('blocks a forged return-home reply without changing committed progress', async () => {
    const start = at({ x: 12, z: 4 }, { pit: { gx: 3, gz: 1, depth: 8 } })
    const good = returnHomeFor(start)
    const runtime = createPublicV26ControllerRuntime(start, noWrite, async (revision, lineage) => {
      const reply = await good(revision, lineage)
      return reply.ok ? { ok: true as const, value: { ...reply.value,
        head: { ...reply.value.head, terrain: { ...reply.value.head.terrain,
          bag: { ...reply.value.head.terrain.bag, soil: 1 } } } } } : reply
    })
    expect(await runtime.returnHome()).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(runtime.committed()).toEqual(start)
    const malformed = createPublicV26ControllerRuntime(start, noWrite,
      async (revision, lineage) => {
        const reply = await good(revision, lineage)
        return reply.ok ? { ok: true as const, value: { ...reply.value,
          head: { ...reply.value.head, witness: { kind: 'return-home/v1' as const,
            atMs: 10_000, eligible: true } as never } } } : reply
      })
    expect(await malformed.returnHome()).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(malformed.committed()).toEqual(start)
  })

  it('flushes movement before return-home and defers an airborne request', async () => {
    const start = at({ x: 12, z: 4 }, { pit: { gx: 3, gz: 1, depth: 8 } })
    let current = start
    const write = vi.fn(async (revision: number, lineage: PublicV26Start['lineage'],
      witness: PublicV26Witness) => {
      const next = replayPublicV26Witness(owned(current), witness)
      if (!next) return { ok: false as const, reason: 'frame-rejected' }
      current = { lineage, head: { ...current.head, ...next,
        saveRevision: revision + 1, witness } }
      return { ok: true as const, value: current }
    })
    const home = vi.fn(async (revision: number, lineage: PublicV26Start['lineage']) => {
      const witness = { kind: 'return-home/v1' as const, atMs: 10_000 }
      const next = replayPublicV26Witness(owned(current), witness)
      if (!next) return { ok: false as const, reason: 'not_trapped' }
      current = { lineage, head: { ...current.head, ...next,
        saveRevision: revision + 1, witness } }
      return { ok: true as const, value: current }
    })
    const runtime = createPublicV26ControllerRuntime(start, write, home)
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect((await runtime.returnHome()).status).toBe('saved')
    expect(write).toHaveBeenCalledOnce()
    expect(home).toHaveBeenCalledWith(1, start.lineage)
    expect(runtime.status()).toMatchObject({ pendingFrames: 0, saveRevision: 2 })
    const airborne = createPublicV26ControllerRuntime(at({ x: 12, z: 4 }), noWrite, home)
    expect(airborne.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    expect(await airborne.returnHome()).toEqual({ status: 'deferred-airborne' })
    expect(airborne.status()).toMatchObject({ gate: 'open', pendingFrames: 1 })
    expect(home).toHaveBeenCalledOnce()
  })

  it('saves a V26 pit ladder without sending it to the old action reducer', async () => {
    const start = at({ x: 12, z: 4 }, { pit: { gx: 3, gz: 1, depth: 2 }, logs: 4 })
    const runtime = createPublicV26ControllerRuntime(start, writerFor(start))
    const witness = { kind: 'pit-ladder/v1' as const,
      action: { kind: 'place-pit-ladder' as const, gx: 3, gz: 1 } }
    expect((await runtime.action(witness)).status).toBe('saved')
    expect(runtime.preview().terrain.columns[0].pitLadder).toBe(true)
    expect(runtime.preview().state.player.xp).toBe(start.head.state.player.xp + 60)
    expect(await runtime.action(witness)).toEqual({ status: 'rejected', reason: 'already_done' })
  })
})
