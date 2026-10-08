import { describe, expect, it } from 'vitest'
import { createGeneratedWorld } from './generation'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import { serializeWizardWorld } from './persistence'
import {
  PUBLIC_V6_ROOT_KEY, PUBLIC_V6_STAGE_KEY, commitLegacyImportToPublicV6,
  commitPublicV6World, inspectLegacyImportSource, parsePublicV6PlayableRoot,
} from './publicWorldV6'
import { createFreshPublicWorld } from './publicWorldState'
import {
  HERB_REGROW_TICKS, PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_LOCK_NAME, PUBLIC_V7_ROOT_KEY,
  PUBLIC_V7_SCHEMA, PUBLIC_V7_STAGE_KEY, commitPublicV7World, createPublicV7StateFromV6Root,
  inspectPublicV7Artifacts, loadPublicV7Root, migratePublicV6ToV7,
  parsePublicV7PlayableRoot, withFreshPublicV7Herbs,
} from './publicWorldV7'

const seed = 'greenway-alpha'
const profile = 'greenway-classic-v1'
function memoryStorage(entries: readonly (readonly [string, string])[] = []) {
  const values = new Map(entries)
  const writes: string[] = []
  return { values, writes,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, bytes: string) => { writes.push(key); values.set(key, bytes) },
  }
}
function v6Playable() {
  const storage = memoryStorage()
  const saved = commitPublicV6World(storage, createFreshPublicWorld(seed, profile), null)
  if (saved.status !== 'committed') throw new Error(saved.status)
  return { storage, saved }
}

describe('public v7 herb save and migration', () => {
  it('migrates a validated playable v6 root without writing a v6 key', () => {
    const { storage, saved } = v6Playable()
    const oldEntries = new Map(storage.values)
    const result = migratePublicV6ToV7(storage, saved.bytes)
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') return
    expect(result.root.schemaVersion).toBe(PUBLIC_V7_SCHEMA)
    expect(result.root.saveRevision).toBe(0)
    expect(result.root.migrationSourceV6Bytes).toBe(saved.bytes)
    expect(result.root.state).toEqual(withFreshPublicV7Herbs(saved.root.state))
    expect(result.root.state.mireglass.herbHarvestCycles).toEqual([])
    expect(loadPublicV7Root(storage)).toEqual({ status: 'valid-playable', root: result.root, bytes: result.bytes })
    for (const [key, bytes] of oldEntries) expect(storage.values.get(key)).toBe(bytes)
    expect(storage.writes.slice(2)).toEqual([PUBLIC_V7_STAGE_KEY, PUBLIC_V7_ROOT_KEY])
    expect(PUBLIC_V7_LOCK_NAME).toBe(`${PUBLIC_V6_ROOT_KEY}:exclusive`)

    const next = commitPublicV7World(storage, result.root.state, result.bytes)
    expect(next.status).toBe('committed')
    if (next.status !== 'committed') return
    expect(next.root.saveRevision).toBe(1)
    expect(next.root.migrationSourceV6Bytes).toBe(saved.bytes)
    expect(storage.values.get(PUBLIC_V7_BACKUP_KEY)).toBe(result.bytes)
    expect(inspectPublicV7Artifacts(storage)).toMatchObject({
      status: 'available', stage: { status: 'settled' }, backup: { status: 'available' },
    })
    expect(commitPublicV7World(storage, result.root.state, result.bytes)).toEqual({ status: 'root-changed' })
    expect(parsePublicV6PlayableRoot(saved.bytes)).toEqual(saved.root)
  })

  it('accepts a v6 bootstrap and retains its exact legacy lineage', () => {
    const legacyBytes = serializeWizardWorld(createGeneratedWorld(seed))
    const storage = memoryStorage([['wizard-realms:world:v5', legacyBytes]])
    const inspected = inspectLegacyImportSource(storage, profile)
    if (inspected.status !== 'available') throw new Error(inspected.status)
    const imported = commitLegacyImportToPublicV6(storage, inspected)
    if (imported.status !== 'committed') throw new Error(imported.status)
    const sourceBytes = storage.values.get(PUBLIC_V6_ROOT_KEY)!
    const result = migratePublicV6ToV7(storage, sourceBytes)
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') return
    expect(result.root.bootstrap).toEqual(imported.root)
    expect(result.root.state).toEqual(createPublicV7StateFromV6Root(imported.root))
    expect(parsePublicV7PlayableRoot(JSON.stringify({ ...result.root, bootstrap: null }))).toBeNull()
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(sourceBytes)
    expect(storage.values.get('wizard-realms:world:v5')).toBe(legacyBytes)
  })

  it('validates canonical per-cycle history and leaves existing bytes untouched on invalid state', () => {
    const { storage, saved } = v6Playable()
    const migrated = migratePublicV6ToV7(storage, saved.bytes)
    if (migrated.status !== 'committed') throw new Error(migrated.status)
    const patchId = mireglassHerbPatches(seed)[0].id
    const state = { ...migrated.root.state, tick: HERB_REGROW_TICKS,
      mireglass: { ...migrated.root.state.mireglass,
        herbHarvestCycles: [{ patchId, cycle: 1 }] } }
    const valid = { ...migrated.root, state }
    expect(parsePublicV7PlayableRoot(JSON.stringify(valid))).toEqual(valid)
    const badEntries = [
      [{ patchId, cycle: 2 }], [{ patchId, cycle: -1 }], [{ patchId, cycle: 0.5 }],
      [{ patchId: 'invented', cycle: 0 }], [{ patchId, cycle: 0 }, { patchId, cycle: 1 }],
      [{ patchId, cycle: 0, extra: true }],
    ]
    for (const herbHarvestCycles of badEntries) {
      const forged = { ...state, mireglass: { ...state.mireglass, herbHarvestCycles } }
      expect(parsePublicV7PlayableRoot(JSON.stringify({ ...valid, state: forged }))).toBeNull()
      expect(commitPublicV7World(storage, forged, migrated.bytes)).toEqual({ status: 'invalid-state' })
    }
    expect(parsePublicV7PlayableRoot(JSON.stringify({ ...valid,
      state: { ...state, mireglass: { ...state.mireglass, herbHarvestCycles: undefined } } }))).toBeNull()
    expect(parsePublicV7PlayableRoot(JSON.stringify({ ...valid, extra: true }))).toBeNull()
    expect(() => withFreshPublicV7Herbs(state)).toThrow('Herb history already exists')
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(migrated.bytes)
  })

  it('blocks a migrated world if an old v6 tab advances its source', () => {
    const { storage, saved } = v6Playable()
    const migrated = migratePublicV6ToV7(storage, saved.bytes)
    if (migrated.status !== 'committed') throw new Error(migrated.status)
    storage.values.set(PUBLIC_V6_ROOT_KEY,
      JSON.stringify({ ...saved.root, saveRevision: saved.root.saveRevision + 1 }))
    expect(loadPublicV7Root(storage)).toEqual({ status: 'source-changed' })
    expect(commitPublicV7World(storage, migrated.root.state, migrated.bytes)).toEqual({ status: 'source-changed' })
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(migrated.bytes)
    expect(parsePublicV7PlayableRoot(migrated.bytes)).toEqual(migrated.root)
  })

  it('marks a fresh v7 root with a null migration receipt', () => {
    const storage = memoryStorage()
    const state = withFreshPublicV7Herbs(createFreshPublicWorld(seed, profile))
    const saved = commitPublicV7World(storage, state, null)
    expect(saved.status).toBe('committed')
    if (saved.status !== 'committed') return
    expect(saved.root.migrationSourceV6Bytes).toBeNull()
    expect(loadPublicV7Root(storage)).toEqual({ status: 'valid-playable', root: saved.root, bytes: saved.bytes })
    const olderTab = v6Playable().saved.bytes
    storage.values.set(PUBLIC_V6_ROOT_KEY, olderTab)
    expect(loadPublicV7Root(storage)).toEqual({ status: 'source-changed' })
    expect(commitPublicV7World(storage, saved.root.state, saved.bytes)).toEqual({ status: 'source-changed' })
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(saved.bytes)
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(olderTab)
  })

  it('retains the committed root and backup after a failed v7 publish', () => {
    const { storage, saved } = v6Playable()
    const first = migratePublicV6ToV7(storage, saved.bytes)
    if (first.status !== 'committed') throw new Error(first.status)
    const failing = { ...storage, setItem: (key: string, bytes: string) => {
      if (key === PUBLIC_V7_ROOT_KEY) throw new Error('quota')
      storage.setItem(key, bytes)
    } }
    expect(commitPublicV7World(failing, first.root.state, first.bytes)).toEqual({ status: 'storage-error' })
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(first.bytes)
    expect(storage.values.get(PUBLIC_V7_BACKUP_KEY)).toBe(first.bytes)
    expect(inspectPublicV7Artifacts(storage)).toMatchObject({ status: 'available', stage: { status: 'pending' } })
  })

  it('blocks fresh overwrite of v6 and leaves a pending v7 stage when the v6 source changes', () => {
    const { storage, saved } = v6Playable()
    expect(commitPublicV7World(storage, withFreshPublicV7Herbs(saved.root.state), null))
      .toEqual({ status: 'v6-present' })
    const otherBytes = JSON.stringify({ ...saved.root, saveRevision: saved.root.saveRevision + 1 })
    const raced = { ...storage, setItem: (key: string, bytes: string) => {
      storage.setItem(key, bytes)
      if (key === PUBLIC_V7_STAGE_KEY) storage.values.set(PUBLIC_V6_ROOT_KEY, otherBytes)
    } }
    expect(migratePublicV6ToV7(raced, saved.bytes)).toEqual({ status: 'source-changed' })
    expect(storage.values.has(PUBLIC_V7_ROOT_KEY)).toBe(false)
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(otherBytes)
    expect(inspectPublicV7Artifacts(storage)).toMatchObject({ status: 'available', stage: { status: 'pending' } })
    expect(migratePublicV6ToV7(storage, otherBytes)).toEqual({ status: 'pending-v6-stage' })
  })

  it('rejects invalid and pending roots or stages without replacing any source bytes', () => {
    const { storage, saved } = v6Playable()
    expect(migratePublicV6ToV7(storage, '{bad')).toEqual({ status: 'invalid-v6-source' })
    storage.values.set(PUBLIC_V6_STAGE_KEY, '{bad')
    expect(migratePublicV6ToV7(storage, saved.bytes)).toEqual({ status: 'pending-v6-stage' })
    storage.values.set(PUBLIC_V6_STAGE_KEY, saved.bytes)
    storage.values.set(PUBLIC_V7_ROOT_KEY, '{bad')
    expect(migratePublicV6ToV7(storage, saved.bytes)).toEqual({ status: 'invalid-root' })
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(saved.bytes)
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe('{bad')
  })
})
