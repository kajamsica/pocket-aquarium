import { describe, expect, it } from 'vitest'
import { DISCOVERY_MASK_BYTES } from './discoveryMask'
import { applyFieldCampAction } from './fieldCamp'
import { createGeneratedWorld } from './generation'
import { serializeWizardWorld } from './persistence'
import { commitLegacyImportToPublicV6, inspectLegacyImportSource } from './publicWorldV6'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { createFreshPublicWorld } from './publicWorldState'
import { createPublicV7StateFromV6Root, PUBLIC_V7_SCHEMA, serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
import { decodePublicV8Head, encodePublicV8Head } from './publicWorldV8Snapshot'
import { decodePublicV9Head, encodePublicV9Head, isValidPublicV9SourceReceipt,
  parsePublicV9Rescue, parsePublicV9World, PUBLIC_V9_RESCUE_SCHEMA, PUBLIC_V9_SCHEMA,
  samePublicV9SourceReceipt, serializePublicV9Rescue, serializePublicV9World } from './publicWorldV9Snapshot'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const base = withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))
const fresh = withFreshPublicV9Camps(base)
const receipt = { sourceV8Head: encodePublicV8Head(base, null, 3),
  sourceV7Bytes: `\n${serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
    saveRevision: 4, bootstrap: null, migrationSourceV6Bytes: null, state: base })}\n` }

function campState(state = fresh, bootstrap: PublicV6BootstrapRoot | null = null) {
  const tile = worldTileAtGrid(seed, -76, 100)
  const result = applyFieldCampAction({ ...state, movementOwner: 'streamed',
    player: { ...state.player, position: { ...tile.center },
      inventory: [...state.player.inventory, { itemId: 'logs', quantity: 4 }, { itemId: 'stone', quantity: 1 }] },
    discoveredTileIds: [...state.discoveredTileIds, tile.id].sort() }, tile.id, bootstrap)
  if (result.rejection) throw new Error(result.rejection.code)
  return result.state
}

function importedBootstrap() {
  const values = new Map([['wizard-realms:world:v5', serializeWizardWorld(createGeneratedWorld(seed))]])
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, bytes: string) => { values.set(key, bytes) } }
  const source = inspectLegacyImportSource(storage, 'greenway-classic-v1')
  if (source.status !== 'available') throw new Error(source.status)
  const imported = commitLegacyImportToPublicV6(storage, source)
  if (imported.status !== 'committed') throw new Error(imported.status)
  return imported.root
}

describe('public v9 snapshot and portable export', () => {
  it('round-trips a placed camp, spent materials and XP through a typed 32 KiB head', () => {
    const state = campState()
    const head = encodePublicV9Head(state, null, 7)
    expect(head.schemaVersion).toBe(PUBLIC_V9_SCHEMA)
    expect(Object.keys(head).sort()).toEqual(['bootstrap', 'saveRevision', 'schemaVersion', 'state'])
    expect(head.state.discoveryMask).toBeInstanceOf(Uint8Array)
    expect(head.state.discoveryMask.byteLength).toBe(32 * 1024)
    expect(Object.hasOwn(head.state, 'discoveredTileIds')).toBe(false)
    expect(decodePublicV9Head(structuredClone(head))).toEqual({ state, bootstrap: null, saveRevision: 7 })
    expect(decodePublicV8Head(head)).toBeNull()
  })

  it('requires exact root/state keys, valid revisions and a real valid typed mask', () => {
    const head = encodePublicV9Head(fresh, null, 0)
    for (const saveRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1']) {
      expect(decodePublicV9Head({ ...head, saveRevision })).toBeNull()
      expect(() => encodePublicV9Head(fresh, null, saveRevision as number)).toThrow()
    }
    for (const discoveryMask of [[...head.state.discoveryMask], head.state.discoveryMask.buffer,
      new Uint8ClampedArray(DISCOVERY_MASK_BYTES), new Uint8Array(DISCOVERY_MASK_BYTES - 1),
      new Uint8Array(DISCOVERY_MASK_BYTES + 1), new Uint8Array(DISCOVERY_MASK_BYTES)]) {
      expect(decodePublicV9Head({ ...head, state: { ...head.state, discoveryMask } })).toBeNull()
    }
    for (const value of [{ ...head, extra: 1 }, { ...head, bootstrap: undefined },
      { ...head, schemaVersion: 'wizard-world/v8' }, { ...head, [Symbol('extra')]: 1 },
      Object.defineProperty({ ...head }, 'hidden', { value: true })]) expect(decodePublicV9Head(value)).toBeNull()
    for (const state of [{ ...head.state, extra: 1 }, { ...head.state, fieldCampTileIds: ['invented'] },
      { ...head.state, tick: -1 }, { ...head.state, discoveredTileIds: fresh.discoveredTileIds },
      { ...head.state, [Symbol('extra')]: 1 },
      Object.defineProperty({ ...head.state }, 'hidden', { value: true })]) {
      expect(decodePublicV9Head({ ...head, state })).toBeNull()
    }
    const { fieldCampTileIds: _camp, ...missingCamp } = head.state
    expect(decodePublicV9Head({ ...head, state: missingCamp })).toBeNull()
  })

  it('validates imported bootstrap provenance at both boundaries', () => {
    const bootstrap = importedBootstrap()
    const state = withFreshPublicV9Camps(createPublicV7StateFromV6Root(bootstrap))
    expect(parsePublicV9World(serializePublicV9World(state, bootstrap, 0)))
      .toEqual({ schemaVersion: PUBLIC_V9_SCHEMA, state, bootstrap, saveRevision: 0 })
    const invalid = { ...bootstrap, source: { ...bootstrap.source, bytes: 'tampered' } }
    expect(decodePublicV9Head({ ...encodePublicV9Head(state, bootstrap, 0), bootstrap: invalid })).toBeNull()
    expect(() => serializePublicV9World(state, invalid as PublicV6BootstrapRoot, 0)).toThrow()
  })

  it('exports independent JSON that retains full camp and discovery records', () => {
    const state = campState()
    const bytes = serializePublicV9World(state, null, 8)
    const portable = JSON.parse(bytes)
    expect(portable.schemaVersion).toBe('wizard-world/v9')
    expect(portable.state.discoveredTileIds).toEqual(state.discoveredTileIds)
    expect(portable.state.fieldCampTileIds).toEqual(state.fieldCampTileIds)
    expect(Object.hasOwn(portable.state, 'discoveryMask')).toBe(false)
    expect(parsePublicV9World(bytes)).toEqual({ schemaVersion: PUBLIC_V9_SCHEMA, saveRevision: 8, bootstrap: null, state })
    expect(parsePublicV9World(bytes)?.state).not.toBe(state)
    for (const bad of ['{', receipt.sourceV7Bytes, JSON.stringify(encodePublicV9Head(state, null, 8)),
      JSON.stringify({ ...portable, extra: 1 }), JSON.stringify({ ...portable, bootstrap: {} }),
      JSON.stringify({ ...portable, state: { ...state, fieldCampTileIds: [] , extra: 1 } }),
      JSON.stringify({ ...portable, state: { ...state, fieldCampTileIds: ['invented'] } })]) {
      expect(parsePublicV9World(bad)).toBeNull()
    }
    expect(() => serializePublicV9World({ ...state, fieldCampTileIds: ['invented'] }, null, 8)).toThrow()
  })

  it('validates complete source receipts and compares typed bytes without key-order dependence', () => {
    expect(isValidPublicV9SourceReceipt(receipt)).toBe(true)
    const copy = structuredClone(receipt)
    expect(samePublicV9SourceReceipt(receipt, copy)).toBe(true)
    expect(samePublicV9SourceReceipt(receipt, { sourceV7Bytes: copy.sourceV7Bytes,
      sourceV8Head: { state: copy.sourceV8Head.state, bootstrap: null,
        saveRevision: 3, schemaVersion: copy.sourceV8Head.schemaVersion } })).toBe(true)
    for (const bad of [null, { ...receipt, extra: 1 }, { ...receipt, sourceV7Bytes: null },
      { ...receipt, sourceV7Bytes: '{}' }, { ...receipt, sourceV8Head: { saveRevision: 3 } },
      { ...receipt, sourceV8Head: { ...receipt.sourceV8Head, state: { ...receipt.sourceV8Head.state,
        discoveryMask: [...receipt.sourceV8Head.state.discoveryMask] } } },
      Object.defineProperty({ ...receipt }, 'hidden', { value: true })]) {
      expect(isValidPublicV9SourceReceipt(bad)).toBe(false)
      expect(samePublicV9SourceReceipt(receipt, bad)).toBe(false)
    }
    expect(samePublicV9SourceReceipt(receipt, { ...copy, sourceV7Bytes: copy.sourceV7Bytes.trim() })).toBe(false)
    expect(samePublicV9SourceReceipt(receipt, { ...copy, sourceV8Head: { ...copy.sourceV8Head, saveRevision: 4 } })).toBe(false)
    const changed = structuredClone(receipt)
    changed.sourceV8Head.state.discoveryMask[0] |= 1
    expect(isValidPublicV9SourceReceipt(changed)).toBe(true)
    expect(samePublicV9SourceReceipt(receipt, changed)).toBe(false)
    const sparse = structuredClone(receipt)
    sparse.sourceV8Head.state.player.discoveredRingIds = new Array(1)
    expect(isValidPublicV9SourceReceipt(sparse)).toBe(true)
    expect(samePublicV9SourceReceipt(receipt, sparse)).toBe(false)
  })
})

describe('receipt-bearing public v9 rescue', () => {
  it('round-trips full source mask bytes, exact v7 text, camp, inventory and XP without mutating inputs', () => {
    const sourceReceipt = structuredClone(receipt)
    sourceReceipt.sourceV8Head.state.discoveryMask[0] = 0b10101010
    sourceReceipt.sourceV8Head.state.discoveryMask[DISCOVERY_MASK_BYTES - 1] = 0b10000001
    const source = decodePublicV8Head(sourceReceipt.sourceV8Head)!
    const state = campState(withFreshPublicV9Camps(source.state))
    const before = structuredClone({ state, sourceReceipt })
    const bytes = serializePublicV9Rescue(state, null, 4, sourceReceipt)
    const wire = JSON.parse(bytes)
    expect(Object.keys(wire).sort()).toEqual(['schemaVersion', 'snapshot', 'sourceV7Bytes', 'sourceV8Head'])
    expect(wire.sourceV8Head.state.discoveredTileIds).toEqual(source.state.discoveredTileIds)
    expect(Object.hasOwn(wire.sourceV8Head.state, 'discoveryMask')).toBe(false)
    const rescue = parsePublicV9Rescue(bytes)!
    expect(rescue).toEqual({ schemaVersion: PUBLIC_V9_RESCUE_SCHEMA,
      snapshot: parsePublicV9World(serializePublicV9World(state, null, 4)), sourceReceipt })
    expect(rescue.sourceReceipt.sourceV8Head.state.discoveryMask).toBeInstanceOf(Uint8Array)
    expect(rescue.sourceReceipt.sourceV8Head.state.discoveryMask).toHaveLength(32 * 1024)
    expect(samePublicV9SourceReceipt(rescue.sourceReceipt, sourceReceipt)).toBe(true)
    expect(rescue.snapshot.state.fieldCampTileIds).toEqual(state.fieldCampTileIds)
    expect(rescue.snapshot.state.player).toEqual(state.player)
    expect(rescue.sourceReceipt.sourceV7Bytes).toBe(sourceReceipt.sourceV7Bytes)
    expect({ state, sourceReceipt }).toEqual(before)
    expect(parsePublicV9World(bytes)).toBeNull()
    expect(parsePublicV9Rescue(serializePublicV9World(state, null, 4))).toBeNull()
  })

  it('preserves an imported bootstrap and camp while rejecting a mismatched snapshot bootstrap', () => {
    const bootstrap = importedBootstrap()
    const v7 = createPublicV7StateFromV6Root(bootstrap)
    const sourceReceipt = { sourceV8Head: encodePublicV8Head(v7, bootstrap, 0),
      sourceV7Bytes: `\n${serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
        saveRevision: 0, bootstrap, migrationSourceV6Bytes: JSON.stringify(bootstrap), state: v7 })}\n` }
    const state = campState(withFreshPublicV9Camps(v7), bootstrap)
    const bytes = serializePublicV9Rescue(state, bootstrap, 1, sourceReceipt)
    expect(parsePublicV9Rescue(bytes)).toEqual({ schemaVersion: PUBLIC_V9_RESCUE_SCHEMA,
      snapshot: parsePublicV9World(serializePublicV9World(state, bootstrap, 1)), sourceReceipt })
    const wire = JSON.parse(bytes)
    wire.snapshot = JSON.parse(serializePublicV9World(campState(), null, 1))
    expect(parsePublicV9Rescue(JSON.stringify(wire))).toBeNull()
  })

  it('checks consistency, not external authentication: coherent edits must still be compared with live source', () => {
    const bytes = serializePublicV9Rescue(campState(), null, 1, receipt)
    for (const change of ['v7-text', 'v8-revision', 'v8-state']) {
      const wire = JSON.parse(bytes)
      if (change === 'v7-text') wire.sourceV7Bytes = wire.sourceV7Bytes.trim()
      if (change === 'v8-revision') wire.sourceV8Head.saveRevision += 1
      if (change === 'v8-state') wire.sourceV8Head.state.player.coins += 1
      const parsed = parsePublicV9Rescue(JSON.stringify(wire))!
      expect(parsed).not.toBeNull()
      expect(parsed.sourceReceipt.sourceV7Bytes).toBe(wire.sourceV7Bytes)
      expect(samePublicV9SourceReceipt(parsed.sourceReceipt, receipt)).toBe(false)
    }
  })

  it('requires exact initial v8 and v9 origins instead of accepting fabricated revision-zero progress', () => {
    const sourceReceipt = { ...receipt, sourceV8Head: encodePublicV8Head(base, null, 0) }
    const bytes = serializePublicV9Rescue(fresh, null, 0, sourceReceipt)
    expect(parsePublicV9Rescue(bytes)?.snapshot.state).toEqual(fresh)
    for (const target of ['snapshot', 'sourceV8Head']) {
      const wire = JSON.parse(bytes)
      wire[target].state.player.coins += 1
      expect(parsePublicV9Rescue(JSON.stringify(wire))).toBeNull()
    }
    expect(() => serializePublicV9Rescue(campState(), null, 0, receipt)).toThrow(RangeError)
    const progressed = { ...sourceReceipt, sourceV8Head: encodePublicV8Head({ ...base,
      player: { ...base.player, coins: 99 } }, null, 0) }
    expect(() => serializePublicV9Rescue(fresh, null, 1, progressed)).toThrow(RangeError)
  })

  it('rejects malformed envelope, source and snapshot keys, versions, revisions and payloads', () => {
    const wire = JSON.parse(serializePublicV9Rescue(campState(), null, 1, receipt))
    const { snapshot: _snapshot, ...missing } = wire
    const bad = [missing, { ...wire, extra: true }, { ...wire, schemaVersion: PUBLIC_V9_SCHEMA },
      { ...wire, sourceV7Bytes: null }, { ...wire, sourceV7Bytes: '{}' },
      { ...wire, sourceV8Head: receipt.sourceV8Head },
      { ...wire, sourceV8Head: { ...wire.sourceV8Head, schemaVersion: PUBLIC_V9_SCHEMA } },
      { ...wire, sourceV8Head: { ...wire.sourceV8Head, saveRevision: -1 } },
      { ...wire, sourceV8Head: { ...wire.sourceV8Head, extra: true } },
      { ...wire, sourceV8Head: { ...wire.sourceV8Head, state: { ...wire.sourceV8Head.state, fieldCampTileIds: [] } } },
      { ...wire, sourceV8Head: { ...wire.sourceV8Head, state: { ...wire.sourceV8Head.state, discoveredTileIds: ['invented'] } } },
      { ...wire, snapshot: { ...wire.snapshot, extra: true } },
      { ...wire, snapshot: { ...wire.snapshot, state: { ...wire.snapshot.state, fieldCampTileIds: ['invented'] } } }]
    for (const value of bad) expect(parsePublicV9Rescue(JSON.stringify(value))).toBeNull()
    expect(parsePublicV9Rescue('{')).toBeNull()
    const other = withFreshPublicV7Herbs(createFreshPublicWorld('other-world', 'greenway-classic-v1'))
    const unrelated = { sourceV8Head: encodePublicV8Head(other, null, 0),
      sourceV7Bytes: serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA, saveRevision: 0,
        bootstrap: null, migrationSourceV6Bytes: null, state: other }) }
    expect(() => serializePublicV9Rescue(campState(), null, 1, unrelated)).toThrow(RangeError)
    expect(() => serializePublicV9Rescue(campState(), null, 1, { ...receipt, sourceV7Bytes: '{}' })).toThrow(RangeError)
  })
})
