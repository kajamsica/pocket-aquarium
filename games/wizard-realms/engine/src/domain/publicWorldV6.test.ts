import { describe, expect, it } from 'vitest'
import { createGeneratedWorld, terrainHeightAt } from './generation'
import { isRestorableWizardSave, serializeWizardWorld, restoreWizardWorld } from './persistence'
import {
  PUBLIC_V6_BOOTSTRAP_SCHEMA, PUBLIC_V6_ROOT_KEY, PUBLIC_V6_STAGE_KEY,
  commitLegacyImportToPublicV6, inspectLegacyImportSource, loadPublicV6Root,
  legacyMovementEnvelope, parsePublicV6BootstrapRoot,
} from './publicWorldV6'
import type { GenerationProfile } from './types'
import { worldTileAtGrid } from './worldChunks'

const CLASSIC = 'greenway-classic-v1'
const EXPANDED = 'greenway-expanded-v1'
const CLASSIC_KEY = 'wizard-realms:world:v5'
const EXPANDED_KEY = 'wizard-realms:world:expanded:v4'

function memoryStorage(entries: readonly (readonly [string, string])[] = []) {
  const values = new Map(entries)
  const writes: string[] = []
  return {
    values, writes,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, bytes: string) => { writes.push(key); values.set(key, bytes) },
  }
}

function available(storage: Pick<Storage, 'getItem'>, profile: GenerationProfile) {
  const result = inspectLegacyImportSource(storage, profile)
  expect(result.status).toBe('available')
  if (result.status !== 'available') throw new Error('Expected an available import source.')
  return result
}

function legacySave(version: 'wizard-world/v1' | 'wizard-world/v2' | 'wizard-world/v3' | 'wizard-world/v4', profile: GenerationProfile) {
  const world = createGeneratedWorld('greenway-alpha', profile)
  world.player.coins = 73
  const save = JSON.parse(serializeWizardWorld(world)) as Record<string, unknown>
  const player = save.player as Record<string, unknown>
  const stores = save.stores as Array<{ listings: Array<{ id: string }> }>
  save.schemaVersion = version
  save.contentRevision = version === 'wizard-world/v4' ? 'greenway-region-v2'
    : version === 'wizard-world/v3' ? 'greenway-region-v1' : undefined
  if (version !== 'wizard-world/v4') {
    stores[0].listings = stores[0].listings.filter((listing) => listing.id !== 'spade')
    for (const field of ['inscriptions', 'digSites', 'studiedInscriptionIds', 'revealedDigSiteIds', 'excavatedDigSiteIds']) delete save[field]
    delete player.skillXp
    delete player.learnedSpellIds
  }
  if (version !== 'wizard-world/v1') {
    for (const route of save.routes as Array<Record<string, unknown>>) delete route.siteId
  } else {
    for (const field of ['generationProfile', 'areas', 'routes', 'recipes', 'builtRouteIds', 'unlockedRecipeIds', 'discoveredTileIds']) delete save[field]
    save.resources = (save.resources as Array<{ id: string }>).filter((resource) => !resource.id.startsWith('greenway-journey-tree-'))
    delete player.verticalVelocity
  }
  return JSON.stringify(save)
}

describe('public v6 import bootstrap', () => {
  it.each([
    [CLASSIC, CLASSIC_KEY, 'wizard-realms:world:v4'],
    [EXPANDED, EXPANDED_KEY, 'wizard-realms:world:expanded:v3'],
  ] as const)('blocks fallback for an invalid first present %s key', (profile, newest, older) => {
    const valid = serializeWizardWorld(createGeneratedWorld('greenway-alpha', profile))
    const storage = memoryStorage([[newest, '{bad json'], [older, valid]])
    expect(inspectLegacyImportSource(storage, profile)).toEqual({ status: 'invalid', key: newest })
    expect(storage.writes).toEqual([])
  })

  it.each([
    ['wizard-world/v1', CLASSIC, 'wizard-realms:world:v1'],
    ['wizard-world/v2', CLASSIC, 'wizard-realms:world:v2'],
    ['wizard-world/v3', CLASSIC, 'wizard-realms:world:v3'],
    ['wizard-world/v4', CLASSIC, 'wizard-realms:world:v4'],
    ['wizard-world/v2', EXPANDED, 'wizard-realms:world:expanded:v1'],
    ['wizard-world/v3', EXPANDED, 'wizard-realms:world:expanded:v2'],
    ['wizard-world/v4', EXPANDED, 'wizard-realms:world:expanded:v3'],
  ] as const)('restores real %s %s bytes from the first present key', (version, profile, key) => {
    const legacy = legacySave(version, profile)
    const storage = memoryStorage([[key, legacy]])
    const result = commitLegacyImportToPublicV6(storage, available(storage, profile))
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('Expected committed import.')
    expect(restoreWizardWorld(result.root.greenwaySaveBytes)).toMatchObject({
      schemaVersion: 'wizard-world/v5', generationProfile: profile, player: { coins: 73 },
    })
    expect(result.root.source).toEqual({ key, profile, bytes: legacy })
    expect(storage.values.get(key)).toBe(legacy)
    expect(storage.writes).toEqual([PUBLIC_V6_STAGE_KEY, PUBLIC_V6_ROOT_KEY])
  })

  it('uses the streamed lower-cell rule at an exact 4 m half-cell boundary', () => {
    const world = createGeneratedWorld('greenway-alpha')
    const lower = worldTileAtGrid(world.seed, 0, 0)
    const upper = worldTileAtGrid(world.seed, 1, 0)
    expect(lower.center.y).toBeLessThan(upper.center.y)
    world.player.position = { x: 2, y: lower.center.y, z: 0 }
    expect(available(memoryStorage([[CLASSIC_KEY, serializeWizardWorld(world)]]), CLASSIC).source.key).toBe(CLASSIC_KEY)
    world.player.position = { x: 2.000001, y: upper.center.y, z: 0 }
    expect(available(memoryStorage([[CLASSIC_KEY, serializeWizardWorld(world)]]), CLASSIC).source.key).toBe(CLASSIC_KEY)
  })

  it.each([[CLASSIC, CLASSIC_KEY], [EXPANDED, EXPANDED_KEY]] as const)(
    'preserves complete %s Greenway progress and exact legacy bytes on commit and resume', (profile, key) => {
    const world = createGeneratedWorld('greenway-alpha', profile)
    world.tick = 43
    world.eventSequence = 9
    world.rng.simulation = 12345
    world.player.coins = 79
    world.player.skillXp.excavation = 30
    world.player.xp = 30
    world.player.inventory.push({ itemId: 'field_spade', quantity: 1 })
    world.studiedInscriptionIds = ['greenway_waystone']
    world.player.learnedSpellIds = ['wayfinder_glow']
    world.revealedDigSiteIds = ['practice_mound']
    world.excavatedDigSiteIds = ['practice_mound']
    world.stores[0].listings[2].stock = 2
    world.resources[0].health = 0
    world.resources[0].depleted = true
    const sourceBytes = serializeWizardWorld(world)
    const storage = memoryStorage([[key, sourceBytes]])
    const inspected = available(storage, profile)
    expect(commitLegacyImportToPublicV6(storage, inspected).status).toBe('committed')
    expect(storage.writes).toEqual([PUBLIC_V6_STAGE_KEY, PUBLIC_V6_ROOT_KEY])
    expect(storage.values.get(key)).toBe(sourceBytes)
    const loaded = loadPublicV6Root(storage)
    expect(loaded.status).toBe('valid-bootstrap')
    if (loaded.status !== 'valid-bootstrap') throw new Error('Expected a valid bootstrap root.')
    expect(loaded.root).toMatchObject({
      schemaVersion: PUBLIC_V6_BOOTSTRAP_SCHEMA,
      seed: world.seed,
      source: { profile, key, bytes: sourceBytes },
    })
    expect(restoreWizardWorld(loaded.root.greenwaySaveBytes)).toEqual(world)
    storage.values.set(key, '{changed after import')
    expect(loadPublicV6Root(storage)).toEqual(loaded)
    expect(commitLegacyImportToPublicV6(storage, inspected)).toEqual({ status: 'root-present' })
  })

  it('rechecks source bytes and the first-present key at commit', () => {
    const bytes = serializeWizardWorld(createGeneratedWorld('greenway-alpha'))
    const storage = memoryStorage([[CLASSIC_KEY, bytes]])
    const inspected = available(storage, CLASSIC)
    storage.values.set(CLASSIC_KEY, `${bytes} `)
    expect(commitLegacyImportToPublicV6(storage, inspected)).toEqual({ status: 'source-changed' })
    expect(storage.values.has(PUBLIC_V6_ROOT_KEY)).toBe(false)
    storage.values.set(CLASSIC_KEY, bytes)
    storage.values.set('wizard-realms:world:v4', bytes)
    storage.values.delete(CLASSIC_KEY)
    expect(commitLegacyImportToPublicV6(storage, inspected)).toEqual({ status: 'source-changed' })
    expect(storage.writes).toEqual([])
  })

  it('blocks import and writes when the active public root is invalid', () => {
    const bytes = serializeWizardWorld(createGeneratedWorld('greenway-alpha'))
    const badRoot = '{"schemaVersion":"wizard-world/v7"}'
    const storage = memoryStorage([[CLASSIC_KEY, bytes], [PUBLIC_V6_ROOT_KEY, badRoot]])
    const inspected = available(storage, CLASSIC)
    expect(loadPublicV6Root(storage)).toEqual({ status: 'invalid' })
    expect(commitLegacyImportToPublicV6(storage, inspected)).toEqual({ status: 'invalid-root' })
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(badRoot)
    expect(storage.writes).toEqual([])
    expect(parsePublicV6BootstrapRoot(JSON.stringify({ ...JSON.parse(badRoot), source: inspected.source }))).toBeNull()
  })

  it.each([PUBLIC_V6_STAGE_KEY, PUBLIC_V6_ROOT_KEY])('keeps the root absent when %s write fails', (failedKey) => {
    const bytes = serializeWizardWorld(createGeneratedWorld('greenway-alpha'))
    const storage = memoryStorage([[CLASSIC_KEY, bytes]])
    const inspected = available(storage, CLASSIC)
    const failing = {
      getItem: storage.getItem,
      setItem: (key: string, value: string) => {
        if (key === failedKey) throw new Error('quota')
        storage.setItem(key, value)
      },
    }
    expect(commitLegacyImportToPublicV6(failing, inspected)).toEqual({ status: 'storage-error' })
    expect(storage.values.has(PUBLIC_V6_ROOT_KEY)).toBe(false)
    expect(storage.values.get(CLASSIC_KEY)).toBe(bytes)
  })

  it('does not publish a root if the staged readback differs or the source changes during staging', () => {
    const bytes = serializeWizardWorld(createGeneratedWorld('greenway-alpha'))
    const storage = memoryStorage([[CLASSIC_KEY, bytes]])
    const inspected = available(storage, CLASSIC)
    const corruptStage = {
      getItem: (key: string) => key === PUBLIC_V6_STAGE_KEY ? 'corrupt' : storage.getItem(key),
      setItem: storage.setItem,
    }
    expect(commitLegacyImportToPublicV6(corruptStage, inspected)).toEqual({ status: 'stage-verification-failed' })
    expect(storage.values.has(PUBLIC_V6_ROOT_KEY)).toBe(false)
    const changedDuringStage = {
      getItem: storage.getItem,
      setItem: (key: string, value: string) => {
        storage.setItem(key, value)
        if (key === PUBLIC_V6_STAGE_KEY) storage.values.set(CLASSIC_KEY, `${bytes} `)
      },
    }
    expect(commitLegacyImportToPublicV6(changedDuringStage, inspected)).toEqual({ status: 'source-changed' })
    expect(storage.values.has(PUBLIC_V6_ROOT_KEY)).toBe(false)
  })

  it('reports v5 terrain that cannot be regenerated as incompatible, preserving its bytes', () => {
    const world = createGeneratedWorld('greenway-alpha')
    world.tiles[0].center.x += 0.1
    const bytes = serializeWizardWorld(world)
    const storage = memoryStorage([[CLASSIC_KEY, bytes]])
    expect(inspectLegacyImportSource(storage, CLASSIC)).toEqual({
      status: 'incompatible', key: CLASSIC_KEY, reason: 'terrain',
    })
    expect(storage.values.get(CLASSIC_KEY)).toBe(bytes)
    expect(storage.writes).toEqual([])
  })

  it('keeps a v5-owned pose even when its streamed half-cell was never discovered', () => {
    const world = createGeneratedWorld('greenway-alpha')
    world.player.position = { ...world.routes[0].to }
    const bytes = serializeWizardWorld(world)
    expect(isRestorableWizardSave(bytes, CLASSIC)).toBe(true)
    const storage = memoryStorage([[CLASSIC_KEY, bytes]])
    const imported = available(storage, CLASSIC)
    expect(restoreWizardWorld(imported.greenwaySaveBytes).player.position).toEqual(world.player.position)
    expect(storage.values.get(CLASSIC_KEY)).toBe(bytes)
    expect(storage.writes).toEqual([])
  })

  it.each([[CLASSIC, CLASSIC_KEY], [EXPANDED, EXPANDED_KEY]] as const)(
    'preserves %s boundary poses instead of applying streamed half-cell terrain', (profile, key) => {
    const world = createGeneratedWorld('greenway-alpha', profile)
    const bounds = legacyMovementEnvelope(world)
    const poses = [
      { x: bounds.minX, z: 0 }, { x: 0, z: bounds.minZ },
      { x: bounds.minX, z: bounds.minZ },
      { x: bounds.maxX, z: 0 }, { x: 0, z: bounds.maxZ },
    ]
    for (const pose of poses) {
      world.player.position = { ...pose, y: terrainHeightAt(world.tiles, pose.x, pose.z) }
      const bytes = serializeWizardWorld(world)
      expect(isRestorableWizardSave(bytes, profile)).toBe(true)
      const imported = available(memoryStorage([[key, bytes]]), profile)
      expect(imported.source.bytes).toBe(bytes)
      expect(restoreWizardWorld(imported.greenwaySaveBytes).player.position).toEqual(world.player.position)
    }
  })

  it.each([[CLASSIC, CLASSIC_KEY], [EXPANDED, EXPANDED_KEY]] as const)(
    'does not silently import a restorable %s save already outside its movement envelope', (profile, key) => {
    const world = createGeneratedWorld('greenway-alpha', profile)
    const bounds = legacyMovementEnvelope(world)
    const outside = [
      { x: bounds.minX - 0.000001, z: 0 }, { x: 0, z: bounds.minZ - 0.000001 },
      { x: bounds.maxX + 0.000001, z: 0 }, { x: 0, z: bounds.maxZ + 0.000001 },
    ]
    for (const pose of outside) {
      world.player.position = { ...pose, y: terrainHeightAt(world.tiles, pose.x, pose.z) }
      const bytes = serializeWizardWorld(world)
      expect(isRestorableWizardSave(bytes, profile)).toBe(true)
      const storage = memoryStorage([[key, bytes]])
      expect(inspectLegacyImportSource(storage, profile)).toEqual({ status: 'incompatible', key, reason: 'position' })
      expect(storage.values.get(key)).toBe(bytes)
      expect(storage.writes).toEqual([])
    }
  })

  it('accepts the expanded Greenway west edge at x=-30 across the 100-seed corpus', () => {
    for (let index = 0; index < 100; index += 1) {
      const world = createGeneratedWorld(`mireglass-corpus-${index}`, EXPANDED)
      const { minX } = legacyMovementEnvelope(world)
      expect(minX).toBe(-30)
      world.player.position = { x: minX, y: terrainHeightAt(world.tiles, minX, 0), z: 0 }
      const sourceBytes = serializeWizardWorld(world)
      const inspected = available(memoryStorage([[EXPANDED_KEY, sourceBytes]]), EXPANDED)
      expect(inspected.source.bytes, world.seed).toBe(sourceBytes)
      expect(restoreWizardWorld(inspected.greenwaySaveBytes).player.position, world.seed)
        .toEqual(world.player.position)
    }
  }, 120_000)

  it('rejects a seed with no required dry Mireglass approach trail before import', () => {
    const bytes = serializeWizardWorld(createGeneratedWorld('public-seed-0'))
    const storage = memoryStorage([[CLASSIC_KEY, bytes]])
    expect(inspectLegacyImportSource(storage, CLASSIC)).toEqual({
      status: 'incompatible', key: CLASSIC_KEY, reason: 'mireglass-content',
    })
    expect(storage.values.get(CLASSIC_KEY)).toBe(bytes)
    expect(storage.writes).toEqual([])
  })
})
