import { describe, expect, it } from 'vitest'
import { createPublicV23ControllerRuntime, createPublicV24ControllerRuntime,
  createPublicV25ControllerRuntime } from './PublicV23ControllerRuntime'
import { createPublicV23Root, decodePublicV23Progress } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'

const seed = 'wizard-realms'
const move = (z: number) => [{ type: 'move' as const, delta: { x: 0, z } }]
const noWrite = async () => ({ ok: false as const, reason: 'not-called' })
function at(point: { x: number; z: number }, builtBridgeId?: string) {
  const v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const greenwayWorks = builtBridgeId
    ? { ...v24.head.greenwayWorks, builtBridgeIds: [builtBridgeId] }
    : v24.head.greenwayWorks
  const support = publicV17StarterSupportAt({ seed,
    profile: v24.head.state.generationProfile,
    route: v24.head.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks }, point)
  if (!support) throw new Error('Missing fixture support')
  const owned = decodePublicV23Progress({ state: { ...v24.head.state,
    player: { ...v24.head.state.player, xp: builtBridgeId ? 80 : 0,
      skillXp: { ...v24.head.state.player.skillXp, construction: builtBridgeId ? 80 : 0 },
      position: { ...point, y: support.floorY } } },
    greenwayWorks, regionalWorks: v24.head.regionalWorks }, seed)
  if (!owned) throw new Error('Invalid fixture progress')
  const start23 = { head: { ...v23.head, ...owned, saveRevision: 1,
    witness: { kind: 'checkpoint' as const } }, lineage: v23.lineage }
  const start24 = { head: { ...v24.head, ...owned, saveRevision: 1,
    witness: { kind: 'checkpoint' as const } }, lineage: v24.lineage }
  const root25 = createPublicV25Root(start24)
  return { start23, start24, start25: { head: root25.head, lineage: root25.lineage } }
}

describe('V25 local connected river preview', () => {
  it('accepts a dry step and keeps the old V23 and V24 frame paths unchanged', () => {
    const dry = at({ x: 12, z: 5.7 })
    const v25 = createPublicV25ControllerRuntime(dry.start25, noWrite)
    expect(v25.advanceFrame(move(0.1), false).rejections).toEqual([])
    expect(v25.status().pendingFrames).toBe(1)
    const wet = at({ x: 12, z: 5.9 })
    for (const runtime of [createPublicV23ControllerRuntime(wet.start23, noWrite),
      createPublicV24ControllerRuntime(wet.start24, noWrite)]) {
      expect(runtime.advanceFrame(move(0.16), false).rejections).toEqual([])
      expect(runtime.status().pendingFrames).toBe(1)
    }
  })

  it('rejects new water before changing preview or pending frames, including a return attempt', () => {
    const start = at({ x: 12, z: 5.9 }).start25
    const runtime = createPublicV25ControllerRuntime(start, noWrite)
    const before = runtime.preview()
    expect(runtime.advanceFrame(move(0.16), false).rejections).toEqual([
      expect.objectContaining({ intentType: 'move', code: 'terrain_missing',
        message: 'River crossing blocked. Build a bridge to cross.' })])
    expect(runtime.preview()).toEqual(before)
    expect(runtime.status().pendingFrames).toBe(0)
    expect(runtime.advanceFrame(move(-0.16), false).rejections).toEqual([])
    expect(runtime.status().pendingFrames).toBe(1)
    expect(runtime.preview().state.player.position.z).toBeCloseTo(5.74)
  })

  it('accepts a step on the saved central bridge deck', () => {
    const site = resolvePublicV17GreenwaySite(seed, 'works3:bridge:1')
    if (!site || site.kind !== 'bridge') throw new Error('Missing bridge fixture')
    const runtime = createPublicV25ControllerRuntime(at(site.gapCenter, site.id).start25, noWrite)
    const beforeZ = runtime.preview().state.player.position.z
    expect(runtime.advanceFrame(move(0.16), false).rejections).toEqual([])
    expect(runtime.status().pendingFrames).toBe(1)
    expect(runtime.preview().state.player.position.z).toBeCloseTo(beforeZ + 0.16)
  })
})
