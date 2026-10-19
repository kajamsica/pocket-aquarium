import { describe, expect, it } from 'vitest'
import { DISCOVERY_MASK_BYTES } from './discoveryMask'
import { createFreshPublicWorld } from './publicWorldState'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { encodePublicV11Head, PUBLIC_V11_SCHEMA } from './publicWorldV11Snapshot'
import { withPublicV11Highland } from './publicWorldV11State'
import { encodePublicV12Head, PUBLIC_V12_SCHEMA } from './publicWorldV12Snapshot'
import { withPublicV12Windstep } from './publicWorldV12State'
import type { PublicV13Start } from './publicWorldV13Flow'
import { parsePublicV13Rescue, PUBLIC_V13_RESCUE_SCHEMA,
  serializePublicV13Rescue } from './publicWorldV13Rescue'
import { createPublicV13MigrationHead, decodePublicV13Head,
  PUBLIC_V13_SCHEMA } from './publicWorldV13Snapshot'
import { appendTerrainWorkLedger } from './terrainWorkLedger'

const seed = 'greenway-alpha'
const v11 = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
  withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1')))))
const v12 = withPublicV12Windstep(v11)
const source11 = { sourceSchemaVersion: PUBLIC_V11_SCHEMA,
  sourceHead: encodePublicV11Head(v11, null, 0) } as const
const source12 = { sourceSchemaVersion: PUBLIC_V12_SCHEMA,
  sourceHead: encodePublicV12Head(v12, null, 0) } as const

function start(source: typeof source11 | typeof source12): PublicV13Start {
  const zero = createPublicV13MigrationHead(source)!
  return { state: zero.state, bootstrap: zero.bootstrap, saveRevision: zero.saveRevision,
    sourceLineage: source }
}
const frame = (base: PublicV13Start) => ({ ...base.state, tick: base.state.tick + 1 })
const edit = (bytes: string, change: (packet: any) => void) => {
  const packet = JSON.parse(bytes)
  change(packet)
  return JSON.stringify(packet)
}

describe('read-only v13 rescue packet', () => {
  it.each([source11, source12])('roundtrips a revision-zero saved base and one unsaved frame', (source) => {
    const base = start(source)
    const original = structuredClone(base)
    const candidate = frame(base)
    const bytes = serializePublicV13Rescue(base, candidate)
    const parsed = parsePublicV13Rescue(bytes)!
    expect(JSON.parse(bytes).schemaVersion).toBe(PUBLIC_V13_RESCUE_SCHEMA)
    expect(new TextEncoder().encode(bytes).length).toBeLessThan(8 * 1024 * 1024)
    expect(parsed.savedBase.saveRevision).toBe(0)
    expect(parsed.unsavedCandidate?.saveRevision).toBe(1)
    expect(parsed.unsavedCandidate?.state).toEqual(candidate)
    expect(parsed.sourceLineage).toEqual(source)
    expect(base).toEqual(original)
    expect(candidate.discoveryMask).toBeInstanceOf(Uint8Array)
    expect(JSON.parse(bytes).unsavedCandidate.state.discoveryMask).toHaveLength(DISCOVERY_MASK_BYTES)
  })

  it('exports a validated saved base alone, without fabricating unsaved progress', () => {
    const base = start(source11)
    const parsed = parsePublicV13Rescue(serializePublicV13Rescue(base, null))!
    expect(parsed.savedBase.state).toEqual(base.state)
    expect(parsed.unsavedCandidate).toBeNull()
  })

  it('keeps a dense mask, saved works, wind, and inventory without tile-ID expansion', () => {
    const zero = start(source12)
    const works = appendTerrainWorkLedger(zero.state.terrainWorks,
      'works1:bridge:-102:92:z', { seed, fieldCampTileIds: [], authoredBuiltRouteIds: [] })!
    const saved = { ...zero.state, tick: zero.state.tick + 1,
      discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff), terrainWorks: works,
      highland: { ...zero.state.highland, landmarkDiscovered: true },
      windstep: { ...zero.state.windstep, learned: true } }
    const head = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
      saveRevision: 1, bootstrap: zero.bootstrap, state: saved }, zero.sourceLineage)!
    expect(head).not.toBeNull()
    const base: PublicV13Start = { ...zero, state: head.state, saveRevision: 1 }
    const packet = parsePublicV13Rescue(serializePublicV13Rescue(base, frame(base)))!
    expect(packet.savedBase.state.discoveryMask).toEqual(saved.discoveryMask)
    expect(packet.unsavedCandidate?.state.discoveryMask).toEqual(saved.discoveryMask)
    expect(packet.savedBase.state.terrainWorks).toEqual(works)
    expect(packet.savedBase.state.windstep.learned).toBe(true)
    expect(packet.savedBase.state.player.inventory).toEqual(zero.state.player.inventory)
    expect('discoveredTileIds' in packet.savedBase.state).toBe(false)
  })

  it('preserves signed zero in lineage and heads, including a later frame', () => {
    const source = structuredClone(source11)
    source.sourceHead.state.player.yaw = -0
    const base = start(source)
    const candidate = frame(base)
    const packet = parsePublicV13Rescue(serializePublicV13Rescue(base, candidate))!
    expect(Object.is(packet.sourceLineage.sourceHead.state.player.yaw, -0)).toBe(true)
    expect(Object.is(packet.savedBase.state.player.yaw, -0)).toBe(true)
    expect(Object.is(packet.unsavedCandidate?.state.player.yaw, -0)).toBe(true)
  })

  it('rejects extra fields, masks, changed source, wrong revision and rolled-back history', () => {
    const base = start(source12), bytes = serializePublicV13Rescue(base, frame(base))
    const corruptions = [
      (packet: any) => { packet.extra = true },
      (packet: any) => { packet.savedBase.state.extra = true },
      (packet: any) => { packet.savedBase.state.discoveryMask.pop() },
      (packet: any) => { packet.savedBase.state.discoveryMask[0] = 256 },
      (packet: any) => { packet.sourceLineage.sourceHead.state.player.yaw = 1 },
      (packet: any) => { packet.unsavedCandidate.saveRevision = 2 },
      (packet: any) => { packet.unsavedCandidate.state.tick = packet.savedBase.state.tick },
      (packet: any) => { packet.unsavedCandidate.state.discoveryMask.fill(0) },
      (packet: any) => { packet.unsavedCandidate.state.terrainWorks.dugTileIds = ['tile--64-76'] },
      (packet: any) => { packet.unsavedCandidate.state.player.xp = -1 },
      (packet: any) => { packet.savedBase.state.player.yaw = { $v13NegativeZero: false } },
    ]
    for (const corruption of corruptions) expect(parsePublicV13Rescue(edit(bytes, corruption))).toBeNull()
    expect(() => serializePublicV13Rescue(base, { ...frame(base),
      terrainWorks: { ...base.state.terrainWorks, dugTileIds: ['tile--64-76'] } })).toThrow()
    expect(() => serializePublicV13Rescue(base, { ...base.state })).toThrow()
  })

  it('rejects malformed and oversized text before decoding', () => {
    expect(parsePublicV13Rescue('{')).toBeNull()
    expect(parsePublicV13Rescue('x'.repeat(8 * 1024 * 1024 + 1))).toBeNull()
    expect(parsePublicV13Rescue('é'.repeat(5 * 1024 * 1024))).toBeNull()
    const bytes = serializePublicV13Rescue(start(source11), null)
    expect(parsePublicV13Rescue(bytes.replace(seed, '\\ud800'))).toBeNull()
    expect(parsePublicV13Rescue(bytes.replace(seed, '\ud800'))).toBeNull()
  })
})
