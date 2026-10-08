import { describe, expect, it } from 'vitest'
import { DISCOVERY_MASK_BYTES } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import { createFreshPublicWorld } from './publicWorldState'
import { PUBLIC_V7_SCHEMA, serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
import { encodePublicV8Head } from './publicWorldV8Snapshot'
import { decodePublicV9Head, encodePublicV9Head } from './publicWorldV9Snapshot'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { decodePublicV10Head, encodePublicV10Head, isValidPublicV10SourceReceipt,
  parsePublicV10Rescue, parsePublicV10World, PUBLIC_V10_RESCUE_SCHEMA, PUBLIC_V10_SCHEMA,
  samePublicV10SourceReceipt, serializePublicV10Rescue, serializePublicV10World } from './publicWorldV10Snapshot'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const v7 = withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))
const v9 = withFreshPublicV9Camps(v7)
const v10 = withPublicV10TerrainRevision(v9)
const lineage = { sourceV8Head: encodePublicV8Head(v7, null, 2),
  sourceV7Bytes: `\n${serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
    saveRevision: 4, bootstrap: null, migrationSourceV6Bytes: null, state: v7 })}\n` }
const source = { sourceV9Head: encodePublicV9Head(v9, null, 3), sourceV9Lineage: lineage }

function landedState() {
  const tile = mireglassAnchors(seed).sealCache.tile
  return { ...v10, movementOwner: 'streamed' as const,
    player: { ...v10.player, xp: 50, level: 1, position: { ...tile.center, y: 1.65 },
      inventory: [...v10.player.inventory, { itemId: 'mireglass_reach/item/seal' as const, quantity: 1 }],
      learnedSpellIds: ['wayfinder_glow' as const],
      skillXp: { ...v10.player.skillXp, wayfinding: 10, spellcraft: 10, excavation: 40 } },
    discoveredTileIds: [...v10.discoveredTileIds, tile.id].sort(),
    mireglass: { ...v10.mireglass, fringeMarkerStudied: true,
      cacheRevealed: true, cacheExcavated: true } }
}

describe('public v10 typed snapshot and rescue', () => {
  it('encodes the real below-seed-ground pose in a typed head and portable world', () => {
    const state = landedState()
    const head = encodePublicV10Head(state, null, 5)
    expect(head.schemaVersion).toBe(PUBLIC_V10_SCHEMA)
    expect(head.state.player.position.y).toBe(1.65)
    expect(head.state.discoveryMask).toBeInstanceOf(Uint8Array)
    expect(head.state.discoveryMask).toHaveLength(DISCOVERY_MASK_BYTES)
    expect(decodePublicV10Head(structuredClone(head))).toEqual({ state, bootstrap: null, saveRevision: 5 })
    expect(decodePublicV9Head(head)).toBeNull()
    const bytes = serializePublicV10World(state, null, 5)
    expect(JSON.parse(bytes).state.player.position.y).toBe(1.65)
    expect(JSON.parse(bytes).state.discoveredTileIds).toEqual(state.discoveredTileIds)
    expect(parsePublicV10World(bytes)?.state).toEqual(state)
    expect(parsePublicV10World(JSON.stringify(head))).toBeNull()
  })

  it('rejects malformed heads and does not accept a fake terrain revision or lower unexcavated pose', () => {
    const head = encodePublicV10Head(landedState(), null, 5)
    for (const value of [{ ...head, extra: 1 }, { ...head, schemaVersion: 'wizard-world/v9' },
      { ...head, state: { ...head.state, terrainRevision: 'wrong' } },
      { ...head, state: { ...head.state, discoveryMask: [...head.state.discoveryMask] } },
      { ...head, state: { ...head.state, mireglass: { ...head.state.mireglass,
        cacheExcavated: false } } },
      { ...head, state: { ...head.state, player: { ...head.state.player,
        position: { ...head.state.player.position, y: 1.64 } } } }]) {
      expect(decodePublicV10Head(value)).toBeNull()
    }
  })

  it('checks both v9 head and v8/v7 lineage, then serializes typed masks as byte arrays', () => {
    expect(isValidPublicV10SourceReceipt(source)).toBe(true)
    expect(samePublicV10SourceReceipt(source, structuredClone(source))).toBe(true)
    const changedMask = structuredClone(source)
    changedMask.sourceV9Head.state.discoveryMask[DISCOVERY_MASK_BYTES - 1] |= 1
    expect(isValidPublicV10SourceReceipt(changedMask)).toBe(true)
    expect(samePublicV10SourceReceipt(source, changedMask)).toBe(false)
    const state = landedState()
    const bytes = serializePublicV10Rescue(state, null, 1, source)
    const wire = JSON.parse(bytes)
    expect(Object.keys(wire).sort()).toEqual(['schemaVersion', 'snapshot', 'sourceV9Head', 'sourceV9Lineage'])
    expect(wire.sourceV9Head.state.discoveryMask).toBeInstanceOf(Array)
    expect(wire.sourceV9Head.state.discoveryMask).toHaveLength(DISCOVERY_MASK_BYTES)
    expect(wire.sourceV9Lineage.sourceV8Head.state.discoveryMask).toBeInstanceOf(Array)
    expect(wire.sourceV9Lineage.sourceV8Head.state.discoveryMask).toHaveLength(DISCOVERY_MASK_BYTES)
    expect(wire.snapshot.state.player.position.y).toBe(1.65)
    const parsed = parsePublicV10Rescue(bytes)!
    expect(parsed.schemaVersion).toBe(PUBLIC_V10_RESCUE_SCHEMA)
    expect(parsed.snapshot.state).toEqual(state)
    expect(parsed.sourceReceipt.sourceV9Head.state.discoveryMask).toBeInstanceOf(Uint8Array)
    expect(samePublicV10SourceReceipt(parsed.sourceReceipt, source)).toBe(true)
    expect(parsePublicV10World(bytes)).toBeNull()
  })

  it('requires exact migration at revision zero and rejects malformed rescue masks', () => {
    const initialSource = { ...source, sourceV9Head: encodePublicV9Head(v9, null, 0) }
    const bytes = serializePublicV10Rescue(v10, null, 0, initialSource)
    expect(parsePublicV10Rescue(bytes)?.snapshot.state).toEqual(v10)
    const changedState = JSON.parse(bytes)
    changedState.snapshot.state.player.coins += 1
    expect(parsePublicV10Rescue(JSON.stringify(changedState))).toBeNull()
    for (const changed of [null, [], {}, new Array(DISCOVERY_MASK_BYTES - 1).fill(0),
      [...new Array(DISCOVERY_MASK_BYTES - 1).fill(0), 256]]) {
      const wire = JSON.parse(bytes)
      wire.sourceV9Head.state.discoveryMask = changed
      expect(parsePublicV10Rescue(JSON.stringify(wire))).toBeNull()
    }
    const defaultTyped = JSON.parse(bytes)
    defaultTyped.sourceV9Head.state.discoveryMask = source.sourceV9Head.state.discoveryMask
    expect(parsePublicV10Rescue(JSON.stringify(defaultTyped))).toBeNull()
    expect(() => serializePublicV10Rescue(landedState(), null, 0, initialSource)).toThrow(RangeError)
  })

  it('rejects a later rescue that drops a camp already present in its v9 source', () => {
    const campTile = worldTileAtGrid(seed, -76, 100)
    const sourceState = { ...v9,
      discoveredTileIds: [...v9.discoveredTileIds, campTile.id].sort(),
      fieldCampTileIds: [campTile.id] }
    const campSource = { ...source, sourceV9Head: encodePublicV9Head(sourceState, null, 3) }
    const validBytes = serializePublicV10Rescue(withPublicV10TerrainRevision(sourceState), null, 1, campSource)
    const wire = JSON.parse(validBytes)
    wire.snapshot = JSON.parse(serializePublicV10World(v10, null, 1))
    expect(parsePublicV10Rescue(JSON.stringify(wire)) === null).toBe(true)
    expect(() => serializePublicV10Rescue(v10, null, 1, campSource)).toThrow(RangeError)
  })

  it('rejects a later rescue that reverses an excavation already present in its v9 source', () => {
    const landed = landedState()
    const { terrainRevision: _revision, ...state } = landed
    const cache = mireglassAnchors(seed).sealCache.tile
    const sourceState = { ...state,
      player: { ...state.player, position: { ...cache.center } } }
    const dugSource = { ...source, sourceV9Head: encodePublicV9Head(sourceState, null, 3) }
    const validBytes = serializePublicV10Rescue(withPublicV10TerrainRevision(sourceState), null, 1, dugSource)
    const wire = JSON.parse(validBytes)
    wire.snapshot = JSON.parse(serializePublicV10World(v10, null, 1))
    expect(parsePublicV10Rescue(JSON.stringify(wire)) === null).toBe(true)
    expect(() => serializePublicV10Rescue(v10, null, 1, dugSource)).toThrow(RangeError)
  })

  it('rejects an impossible revision-zero v8 ancestor even when v9 source and v7 text are individually valid', () => {
    const v7Bytes = serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
      saveRevision: 4, bootstrap: null, migrationSourceV6Bytes: null, state: v7 })
    const validSource = { ...source, sourceV9Lineage: {
      sourceV8Head: encodePublicV8Head(v7, null, 0), sourceV7Bytes: v7Bytes } }
    const validBytes = serializePublicV10Rescue(v10, null, 1, validSource)
    expect(parsePublicV10Rescue(validBytes)).not.toBeNull()

    const impossibleV8 = encodePublicV8Head({ ...v7,
      player: { ...v7.player, coins: v7.player.coins + 1 } }, null, 0)
    const impossible = { ...validSource, sourceV9Lineage: {
      sourceV8Head: impossibleV8, sourceV7Bytes: v7Bytes } }
    expect.soft(isValidPublicV10SourceReceipt(impossible)).toBe(false)
    expect.soft(() => serializePublicV10Rescue(v10, null, 1, impossible)).toThrow(RangeError)
    const wire = JSON.parse(validBytes)
    wire.sourceV9Lineage.sourceV8Head.state.player.coins += 1
    expect.soft(parsePublicV10Rescue(JSON.stringify(wire)) === null).toBe(true)

    const wrongV7Bytes = serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
      saveRevision: 4, bootstrap: null, migrationSourceV6Bytes: null,
      state: { ...v7, player: { ...v7.player, coins: v7.player.coins + 2 } } })
    const wrongV7Receipt = { ...validSource, sourceV9Lineage: {
      sourceV8Head: validSource.sourceV9Lineage.sourceV8Head, sourceV7Bytes: wrongV7Bytes } }
    expect(isValidPublicV10SourceReceipt(wrongV7Receipt)).toBe(false)
    const changedText = JSON.parse(validBytes)
    changedText.sourceV9Lineage.sourceV7Bytes = wrongV7Bytes
    expect(parsePublicV10Rescue(JSON.stringify(changedText)) === null).toBe(true)
  })
})
