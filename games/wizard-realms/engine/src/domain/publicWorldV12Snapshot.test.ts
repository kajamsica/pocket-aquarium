import { describe, expect, it } from 'vitest'
import { DISCOVERY_MASK_BYTES } from './discoveryMask'
import { createFreshPublicWorld } from './publicWorldState'
import { PUBLIC_V7_SCHEMA, serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
import { encodePublicV8Head } from './publicWorldV8Snapshot'
import { encodePublicV9Head } from './publicWorldV9Snapshot'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { encodePublicV10Head } from './publicWorldV10Snapshot'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { encodePublicV11Head, serializePublicV11World } from './publicWorldV11Snapshot'
import { withPublicV11Highland } from './publicWorldV11State'
import { decodePublicV12Head, encodePublicV12Head, isPublicV12MigrationHead,
  isValidPublicV12SourceReceipt, parsePublicV12Rescue, parsePublicV12World,
  PUBLIC_V12_RESCUE_SCHEMA, PUBLIC_V12_SCHEMA, samePublicV12SourceReceipt,
  serializePublicV12Rescue, serializePublicV12World } from './publicWorldV12Snapshot'
import { withPublicV12Windstep } from './publicWorldV12State'

const v7 = withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'))
const v9 = withFreshPublicV9Camps(v7)
const v10 = withPublicV10TerrainRevision(v9)
const v11 = withPublicV11Highland(v10)
const v12 = withPublicV12Windstep(v11)
const source = { sourceV11Head: encodePublicV11Head(v11, null, 0), sourceV11Receipt: {
  sourceV10Head: encodePublicV10Head(v10, null, 0), sourceV10Lineage: {
    sourceV9Head: encodePublicV9Head(v9, null, 0), sourceV9Lineage: {
      sourceV8Head: encodePublicV8Head(v7, null, 2),
      sourceV7Bytes: `\n${serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
        saveRevision: 4, bootstrap: null, migrationSourceV6Bytes: null, state: v7 })}\n`,
    },
  },
} }

describe('public v12 snapshot and pinned v11 anchor', () => {
  it('roundtrips a strict typed head while older v11 state stays unchanged', () => {
    const prior = structuredClone(v11)
    const head = encodePublicV12Head(v12, null, 0)
    expect(head.schemaVersion).toBe(PUBLIC_V12_SCHEMA)
    expect(head.state.discoveryMask).toBeInstanceOf(Uint8Array)
    expect(head.state.discoveryMask).toHaveLength(DISCOVERY_MASK_BYTES)
    expect(Reflect.ownKeys(head)).toEqual(['schemaVersion', 'saveRevision', 'bootstrap', 'state'])
    expect(Reflect.ownKeys(head)).not.toContain('lineage')
    expect(decodePublicV12Head(structuredClone(head)))
      .toEqual({ state: v12, bootstrap: null, saveRevision: 0 })
    expect(v11).toEqual(prior)
    expect(decodePublicV12Head(encodePublicV11Head(v11, null, 0))).toBeNull()
  })

  it('rejects malformed, unknown and JSON-unsafe typed head fields', () => {
    const head = encodePublicV12Head(v12, null, 0)
    for (const candidate of [
      { ...head, schemaVersion: 'wizard-world/v11' },
      { ...head, lineage: source },
      { ...head, state: { ...head.state, discoveryMask: Array.from(head.state.discoveryMask) } },
      { ...head, state: { ...head.state, windContentRevision: 'unknown' } },
      { ...head, state: { ...head.state, windstep: { ...head.state.windstep, learned: true } } },
      { ...head, state: { ...head.state, windstep: { ...head.state.windstep, extra: true } } },
      { ...head, state: { ...head.state, extra: true } },
    ]) expect(decodePublicV12Head(candidate)).toBeNull()
    const hidden = { ...head }
    Object.defineProperty(hidden, 'hidden', { value: true })
    expect(decodePublicV12Head(hidden)).toBeNull()
  })

  it('exports portable tile IDs and rejects extra keys or typed-mask JSON', () => {
    const bytes = serializePublicV12World(v12, null, 0)
    expect(parsePublicV12World(bytes)?.state).toEqual(v12)
    expect(parsePublicV12World(JSON.stringify(encodePublicV12Head(v12, null, 0)))).toBeNull()
    const raw = JSON.parse(bytes)
    raw.state.windstep.extra = true
    expect(parsePublicV12World(JSON.stringify(raw))).toBeNull()
    const v11Bytes = serializePublicV11World(v11, null, 0).length
    expect(bytes.length - v11Bytes).toBeGreaterThan(0)
    expect(bytes.length - v11Bytes).toBeLessThan(1024)
  })

  it('pins the exact v11 head and full old receipt, including rev0 equivalence', () => {
    expect(isValidPublicV12SourceReceipt(source)).toBe(true)
    expect(samePublicV12SourceReceipt(source, structuredClone(source))).toBe(true)
    expect(isPublicV12MigrationHead(encodePublicV12Head(v12, null, 0), source)).toBe(true)
    expect(isPublicV12MigrationHead(encodePublicV12Head(v12, null, 1), source)).toBe(false)
    expect(isPublicV12MigrationHead(encodePublicV12Head({ ...v12,
      player: { ...v12.player, coins: v12.player.coins + 1 } }, null, 0), source)).toBe(false)
    const wrongV11 = { ...v11, player: { ...v11.player, coins: v11.player.coins + 1 } }
    expect(isValidPublicV12SourceReceipt({ ...source,
      sourceV11Head: encodePublicV11Head(wrongV11, null, 0) })).toBe(false)
    expect(isValidPublicV12SourceReceipt({ ...source, extra: true })).toBe(false)
    expect(isValidPublicV12SourceReceipt({ ...source, sourceV11Receipt: {
      ...source.sourceV11Receipt, unexpected: true } })).toBe(false)
  })

  it('roundtrips a read-only rescue and rejects forged origin and malformed masks', () => {
    const bytes = serializePublicV12Rescue(v12, null, 0, source)
    const raw = JSON.parse(bytes)
    expect(raw.schemaVersion).toBe(PUBLIC_V12_RESCUE_SCHEMA)
    expect(raw.sourceV11Head.state.discoveryMask).toHaveLength(DISCOVERY_MASK_BYTES)
    expect(raw.sourceV11Receipt.sourceV10Head.state.discoveryMask).toHaveLength(DISCOVERY_MASK_BYTES)
    const parsed = parsePublicV12Rescue(bytes)!
    expect(parsed.snapshot.state).toEqual(v12)
    expect(parsed.sourceReceipt.sourceV11Head.state.discoveryMask).toBeInstanceOf(Uint8Array)
    expect(samePublicV12SourceReceipt(parsed.sourceReceipt, source)).toBe(true)
    expect(parsePublicV12World(bytes)).toBeNull()

    const forged = JSON.parse(bytes)
    forged.snapshot.state.player.coins++
    expect(parsePublicV12Rescue(JSON.stringify(forged))).toBeNull()
    for (const bad of [null, {}, new Array(DISCOVERY_MASK_BYTES - 1).fill(0),
      [...new Array(DISCOVERY_MASK_BYTES - 1).fill(0), 256]]) {
      const changed = JSON.parse(bytes)
      changed.sourceV11Head.state.discoveryMask = bad
      expect(parsePublicV12Rescue(JSON.stringify(changed))).toBeNull()
    }
    const extra = JSON.parse(bytes)
    extra.sourceV11Receipt.sourceV10Lineage.sourceV9Lineage.extra = 1
    expect(parsePublicV12Rescue(JSON.stringify(extra))).toBeNull()
  })

  it('rejects an oversized yet otherwise valid rescue before parsing', () => {
    const bytes = serializePublicV12Rescue(v12, null, 0, source)
    const limit = 8 * 1024 * 1024
    expect(bytes.length).toBeLessThan(limit)
    // Trailing JSON whitespace preserves the document's meaning, so rejection
    // here proves the alpha size gate rather than a syntax or origin failure.
    expect(parsePublicV12Rescue(bytes + ' '.repeat(limit - bytes.length + 1))).toBeNull()
  })

  it('rejects a rescue that erases Highland progress pinned in a later v11 source', () => {
    const developed = { ...v11, highland: { ...v11.highland, landmarkDiscovered: true } }
    const developedSource = { ...source, sourceV11Head: encodePublicV11Head(developed, null, 1) }
    expect(isValidPublicV12SourceReceipt(developedSource)).toBe(true)
    expect(() => serializePublicV12Rescue(v12, null, 1, developedSource)).toThrow(RangeError)
    expect(parsePublicV12Rescue(serializePublicV12Rescue(withPublicV12Windstep(developed),
      null, 0, developedSource))).not.toBeNull()
  })
})
