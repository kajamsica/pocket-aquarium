import { describe, expect, it } from 'vitest'
import { DISCOVERY_MASK_BYTES } from './discoveryMask'
import { createGeneratedWorld } from './generation'
import { serializeWizardWorld } from './persistence'
import { commitLegacyImportToPublicV6, inspectLegacyImportSource } from './publicWorldV6'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { createFreshPublicWorld } from './publicWorldState'
import { createPublicV7StateFromV6Root, withFreshPublicV7Herbs } from './publicWorldV7'
import { decodePublicV8Head, encodePublicV8Head, PUBLIC_V8_SCHEMA } from './publicWorldV8Snapshot'

const seed = 'greenway-alpha'
const profile = 'greenway-classic-v1'
const freshState = withFreshPublicV7Herbs(createFreshPublicWorld(seed, profile))

function importedBootstrap(): PublicV6BootstrapRoot {
  const legacyBytes = serializeWizardWorld(createGeneratedWorld(seed))
  const values = new Map([['wizard-realms:world:v5', legacyBytes]])
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, bytes: string) => { values.set(key, bytes) },
  }
  const inspected = inspectLegacyImportSource(storage, profile)
  if (inspected.status !== 'available') throw new Error(inspected.status)
  const imported = commitLegacyImportToPublicV6(storage, inspected)
  if (imported.status !== 'committed') throw new Error(imported.status)
  return imported.root
}

describe('public v8 snapshot', () => {
  it('round-trips a real v7 state through a compact cloneable head', () => {
    const head = encodePublicV8Head(freshState, null, 7)
    expect(head.schemaVersion).toBe(PUBLIC_V8_SCHEMA)
    expect(Object.keys(head).sort()).toEqual(['bootstrap', 'saveRevision', 'schemaVersion', 'state'])
    expect(Object.keys(head.state).sort()).toEqual([
      'discoveryMask', 'eventSequence', 'generationProfile', 'greenway', 'mireglass',
      'movementOwner', 'player', 'rng', 'seed', 'tick',
    ])
    expect(head.state.discoveryMask).toBeInstanceOf(Uint8Array)
    expect(head.state.discoveryMask).toHaveLength(DISCOVERY_MASK_BYTES)
    expect(Object.hasOwn(head.state, 'discoveredTileIds')).toBe(false)
    expect(Object.hasOwn(head, 'migrationSourceV6Bytes')).toBe(false)
    expect(decodePublicV8Head(structuredClone(head))).toEqual({
      state: freshState, bootstrap: null, saveRevision: 7,
    })
  })

  it('round-trips an imported state with its validated bootstrap', () => {
    const bootstrap = importedBootstrap()
    const state = createPublicV7StateFromV6Root(bootstrap)
    const head = encodePublicV8Head(state, bootstrap, 0)
    expect(decodePublicV8Head(structuredClone(head))).toEqual({ state, bootstrap, saveRevision: 0 })
    expect(decodePublicV8Head({ ...head,
      bootstrap: { ...bootstrap, source: { ...bootstrap.source, bytes: 'tampered' } },
    })).toBeNull()
  })

  it('rejects malformed revisions and non-exact roots', () => {
    const head = encodePublicV8Head(freshState, null, 0)
    for (const saveRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1']) {
      expect(decodePublicV8Head({ ...head, saveRevision })).toBeNull()
      expect(() => encodePublicV8Head(freshState, null, saveRevision as number)).toThrow(RangeError)
    }
    expect(decodePublicV8Head({ ...head, schemaVersion: 'wizard-world/v7' })).toBeNull()
    expect(decodePublicV8Head({ ...head, migrationSourceV6Bytes: 'old bytes' })).toBeNull()
    expect(decodePublicV8Head({ schemaVersion: head.schemaVersion,
      saveRevision: head.saveRevision, state: head.state })).toBeNull()
    const withHiddenKey = { ...head }
    Object.defineProperty(withHiddenKey, 'hidden', { value: true })
    expect(decodePublicV8Head(withHiddenKey)).toBeNull()
  })

  it('rejects malformed or tampered masks and state fields', () => {
    const head = encodePublicV8Head(freshState, null, 0)
    for (const discoveryMask of [
      [...head.state.discoveryMask],
      new Uint8Array(DISCOVERY_MASK_BYTES - 1),
      new Uint8Array(DISCOVERY_MASK_BYTES + 1),
      new Uint8Array(DISCOVERY_MASK_BYTES),
    ]) {
      expect(decodePublicV8Head({ ...head, state: { ...head.state, discoveryMask } })).toBeNull()
    }
    expect(decodePublicV8Head({ ...head,
      state: { ...head.state, discoveredTileIds: freshState.discoveredTileIds },
    })).toBeNull()
    expect(decodePublicV8Head({ ...head, state: { ...head.state, tick: -1 } })).toBeNull()
    expect(decodePublicV8Head({ ...head, state: { ...head.state,
      mireglass: { ...head.state.mireglass,
        herbHarvestCycles: [{ patchId: 'invented', cycle: 0 }] },
    } })).toBeNull()
    expect(() => encodePublicV8Head({ ...freshState, tick: -1 }, null, 0)).toThrow(RangeError)
  })

  it('rejects invalid bootstraps at both boundaries', () => {
    const head = encodePublicV8Head(freshState, null, 0)
    const invalid = { schemaVersion: 'wizard-world/v6-bootstrap', seed }
    expect(decodePublicV8Head({ ...head, bootstrap: invalid })).toBeNull()
    expect(() => encodePublicV8Head(freshState, invalid as PublicV6BootstrapRoot, 0)).toThrow(RangeError)
  })
})
