import { describe, expect, it } from 'vitest'
import { DISCOVERY_MASK_BYTES } from './discoveryMask'
import { HIGHLAND_CONTENT_REVISION, highlandLandmark, highlandStoneNodes } from './highlandContent'
import { mireglassAnchors } from './mireglassContent'
import { createFreshPublicWorld } from './publicWorldState'
import { PUBLIC_V7_SCHEMA, serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
import { encodePublicV8Head } from './publicWorldV8Snapshot'
import { encodePublicV9Head } from './publicWorldV9Snapshot'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { encodePublicV10Head } from './publicWorldV10Snapshot'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { decodePublicV11Head, encodePublicV11Head, isValidPublicV11SourceReceipt,
  parsePublicV11Rescue, parsePublicV11World, PUBLIC_V11_RESCUE_SCHEMA, PUBLIC_V11_SCHEMA,
  samePublicV11SourceReceipt, serializePublicV11Rescue, serializePublicV11World } from './publicWorldV11Snapshot'
import { isValidPublicWorldV11State, withPublicV11Highland } from './publicWorldV11State'

const seed = 'greenway-alpha'
const v7 = withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))
const v9 = withFreshPublicV9Camps(v7)
const v10 = withPublicV10TerrainRevision(v9)
const v11 = withPublicV11Highland(v10)
const v7Bytes = `\n${serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
  saveRevision: 4, bootstrap: null, migrationSourceV6Bytes: null, state: v7 })}\n`
const lineage = { sourceV8Head: encodePublicV8Head(v7, null, 2), sourceV7Bytes: v7Bytes }
const sourceV10Lineage = { sourceV9Head: encodePublicV9Head(v9, null, 0), sourceV9Lineage: lineage }
const source = { sourceV10Head: encodePublicV10Head(v10, null, 0), sourceV10Lineage }

describe('public v11 state, snapshot and rescue', () => {
  it('pins one exact revision and a sorted canonical four-node readiness ledger', () => {
    expect(v11.highlandContentRevision).toBe(HIGHLAND_CONTENT_REVISION)
    expect(v11.highland).toEqual({ landmarkDiscovered: false,
      stoneNodes: highlandStoneNodes(seed).map(({ id }) => ({ id, readyAtTick: 0 }))
        .sort((a, b) => a.id.localeCompare(b.id)) })
    expect(isValidPublicWorldV11State(v11, null)).toBe(true)
    expect(() => withPublicV11Highland(v11)).toThrow(RangeError)
    for (const candidate of [
      { ...v11, highlandContentRevision: 'future-content' },
      { ...v11, highland: { ...v11.highland, stoneNodes: [...v11.highland.stoneNodes].reverse() } },
      { ...v11, highland: { ...v11.highland, stoneNodes: v11.highland.stoneNodes.slice(1) } },
      { ...v11, highland: { ...v11.highland, stoneNodes: v11.highland.stoneNodes.map((node, i) =>
        i === 0 ? { ...node, readyAtTick: -1 } : node) } },
      { ...v11, highland: { ...v11.highland, stoneNodes: v11.highland.stoneNodes.map((node, i) =>
        i === 0 ? { ...node, readyAtTick: 3000 } : node) } },
      { ...v11, unexpected: true },
    ]) expect(isValidPublicWorldV11State(candidate, null)).toBe(false)
  })

  it('rejects a recovery tick beyond the authoritative 3000-tick cadence without overflow', () => {
    const withReadyAt = (readyAtTick: number) => ({ ...v11, tick: 100,
      highland: { landmarkDiscovered: true,
        stoneNodes: v11.highland.stoneNodes.map((node, index) => index === 0
          ? { ...node, readyAtTick } : node) } })
    const valid = withReadyAt(3100)
    expect(isValidPublicWorldV11State(valid, null)).toBe(true)
    expect(isValidPublicWorldV11State(withReadyAt(3101), null)).toBe(false)
    expect(isValidPublicWorldV11State(withReadyAt(Number.MAX_SAFE_INTEGER), null)).toBe(false)
    const head = encodePublicV11Head(valid, null, 1)
    const forged = { ...head, state: { ...head.state, highland: withReadyAt(Number.MAX_SAFE_INTEGER).highland } }
    expect(decodePublicV11Head(forged)).toBeNull()
  })

  it('roundtrips typed IndexedDB heads and portable exports without changing v10 schema', () => {
    const progressed = { ...v11, highland: { landmarkDiscovered: true,
      stoneNodes: v11.highland.stoneNodes.map((node, index) => index === 0
        ? { ...node, readyAtTick: 3000 } : node) } }
    const head = encodePublicV11Head(progressed, null, 5)
    expect(head.schemaVersion).toBe(PUBLIC_V11_SCHEMA)
    expect(head.state.discoveryMask).toBeInstanceOf(Uint8Array)
    expect(head.state.discoveryMask).toHaveLength(DISCOVERY_MASK_BYTES)
    expect(decodePublicV11Head(structuredClone(head)))
      .toEqual({ state: progressed, bootstrap: null, saveRevision: 5 })
    const bytes = serializePublicV11World(progressed, null, 5)
    expect(parsePublicV11World(bytes)?.state).toEqual(progressed)
    expect(parsePublicV11World(JSON.stringify(head))).toBeNull()
  })

  it('validates and roundtrips a real streamed pose at the Highland landmark', () => {
    const tile = highlandLandmark(seed).tile
    const atHighland = { ...v11, movementOwner: 'streamed' as const,
      player: { ...v11.player, position: { ...tile.center } },
      discoveredTileIds: [...v11.discoveredTileIds, tile.id].sort() }
    expect(isValidPublicWorldV11State(atHighland, null)).toBe(true)
    expect(decodePublicV11Head(encodePublicV11Head(atHighland, null, 1))?.state)
      .toEqual(atHighland)
  })

  it('rejects malformed head, wrong canonical node, non-integer recovery, and wrong schema', () => {
    const head = encodePublicV11Head(v11, null, 0)
    const invalid = [
      { ...head, schemaVersion: 'wizard-world/v10' },
      { ...head, extra: 1 },
      { ...head, state: { ...head.state, discoveryMask: [...head.state.discoveryMask] } },
      { ...head, state: { ...head.state, highlandContentRevision: 'changed' } },
      { ...head, state: { ...head.state, highland: { ...head.state.highland,
        stoneNodes: head.state.highland.stoneNodes.map((node, index) => index === 0
          ? { ...node, id: 'fake' } : node) } } },
      { ...head, state: { ...head.state, highland: { ...head.state.highland,
        stoneNodes: head.state.highland.stoneNodes.map((node, index) => index === 0
          ? { ...node, readyAtTick: 2.5 } : node) } } },
    ]
    for (const candidate of invalid) expect(decodePublicV11Head(candidate)).toBeNull()
  })

  it('preserves full v10-to-v7 provenance through a portable rescue', () => {
    expect(isValidPublicV11SourceReceipt(source)).toBe(true)
    expect(samePublicV11SourceReceipt(source, structuredClone(source))).toBe(true)
    const bytes = serializePublicV11Rescue(v11, null, 0, source)
    const wire = JSON.parse(bytes)
    expect(wire.schemaVersion).toBe(PUBLIC_V11_RESCUE_SCHEMA)
    expect(wire.sourceV10Head.state.discoveryMask).toHaveLength(DISCOVERY_MASK_BYTES)
    expect(wire.sourceV10Lineage.sourceV9Head.state.discoveryMask).toHaveLength(DISCOVERY_MASK_BYTES)
    expect(wire.sourceV10Lineage.sourceV9Lineage.sourceV8Head.state.discoveryMask)
      .toHaveLength(DISCOVERY_MASK_BYTES)
    const parsed = parsePublicV11Rescue(bytes)!
    expect(parsed.snapshot.state).toEqual(v11)
    expect(parsed.sourceReceipt.sourceV10Head.state.discoveryMask).toBeInstanceOf(Uint8Array)
    expect(samePublicV11SourceReceipt(parsed.sourceReceipt, source)).toBe(true)
    expect(parsePublicV11World(bytes)).toBeNull()
  })

  it('rejects forged revision-zero rescue and malformed ancestor mask', () => {
    const bytes = serializePublicV11Rescue(v11, null, 0, source)
    const forged = JSON.parse(bytes)
    forged.snapshot.state.player.coins += 1
    expect(parsePublicV11Rescue(JSON.stringify(forged))).toBeNull()
    for (const bad of [null, {}, new Array(DISCOVERY_MASK_BYTES - 1).fill(0),
      [...new Array(DISCOVERY_MASK_BYTES - 1).fill(0), 256]]) {
      const changed = JSON.parse(bytes)
      changed.sourceV10Head.state.discoveryMask = bad
      expect(parsePublicV11Rescue(JSON.stringify(changed))).toBeNull()
    }
  })

  it('rejects a source v10 revision zero that does not derive from its v9 receipt', () => {
    const altered = { ...v10, player: { ...v10.player, coins: v10.player.coins + 1 } }
    const impossible = { ...source, sourceV10Head: encodePublicV10Head(altered, null, 0) }
    expect(isValidPublicV11SourceReceipt(impossible)).toBe(false)
    expect(() => serializePublicV11Rescue(v11, null, 0, impossible)).toThrow(RangeError)
  })

  it('carries an already excavated v10 pit into v11 and rejects a rescue that erases it', () => {
    const tile = mireglassAnchors(seed).sealCache.tile
    const dugV10 = { ...v10, movementOwner: 'streamed' as const,
      player: { ...v10.player, xp: 50, level: 1,
        position: { ...tile.center, y: 1.65 },
        inventory: [...v10.player.inventory, { itemId: 'mireglass_reach/item/seal' as const, quantity: 1 }],
        learnedSpellIds: ['wayfinder_glow' as const],
        skillXp: { ...v10.player.skillXp, wayfinding: 10, spellcraft: 10, excavation: 40 } },
      discoveredTileIds: [...v10.discoveredTileIds, tile.id].sort(),
      mireglass: { ...v10.mireglass, fringeMarkerStudied: true,
        cacheRevealed: true, cacheExcavated: true } }
    const dugSource = { ...source, sourceV10Head: encodePublicV10Head(dugV10, null, 1) }
    expect(isValidPublicV11SourceReceipt(dugSource)).toBe(true)
    const migrated = withPublicV11Highland(dugV10)
    expect(parsePublicV11Rescue(serializePublicV11Rescue(migrated, null, 0, dugSource))?.snapshot.state)
      .toEqual(migrated)
    expect(() => serializePublicV11Rescue(v11, null, 1, dugSource)).toThrow(RangeError)
  })
})
