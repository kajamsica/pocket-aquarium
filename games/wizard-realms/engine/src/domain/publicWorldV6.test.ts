import { describe, expect, it } from 'vitest'
import { createGeneratedWorld, terrainHeightAt } from './generation'
import { isRestorableWizardSave, serializeWizardWorld, restoreWizardWorld } from './persistence'
import {
  PUBLIC_V6_BACKUP_KEY, PUBLIC_V6_BOOTSTRAP_SCHEMA, PUBLIC_V6_ROOT_KEY, PUBLIC_V6_SCHEMA, PUBLIC_V6_STAGE_KEY,
  commitLegacyImportToPublicV6, inspectLegacyImportSource, inspectPublicV6Artifacts, loadPublicV6Root,
  legacyMovementEnvelope, parsePublicV6BootstrapRoot, readPublicV6RecoverySnapshot,
  recoverPublicV6Root, serializePublicV6World,
} from './publicWorldV6'
import { createPublicWorldFromBootstrap } from './publicWorldState'
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

const archiveKey = 'wizard-realms:world:v6:archive:00000000-0000-4000-8000-000000000001'

function recoveryFixtures() {
  const sourceBytes = serializeWizardWorld(createGeneratedWorld('greenway-alpha'))
  const imported = memoryStorage([[CLASSIC_KEY, sourceBytes]])
  const result = commitLegacyImportToPublicV6(imported, available(imported, CLASSIC))
  expect(result.status).toBe('committed')
  if (result.status !== 'committed') throw new Error('Expected bootstrap fixture.')
  const bootstrapBytes = imported.values.get(PUBLIC_V6_ROOT_KEY)!
  const playableBytes = serializePublicV6World({
    schemaVersion: PUBLIC_V6_SCHEMA, saveRevision: 0, bootstrap: result.root,
    state: createPublicWorldFromBootstrap(result.root),
  })
  return { sourceBytes, bootstrapBytes, playableBytes }
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
    let stageWritten = false
    const corruptStage = {
      getItem: (key: string) => key === PUBLIC_V6_STAGE_KEY && stageWritten ? 'corrupt' : storage.getItem(key),
      setItem: (key: string, value: string) => {
        storage.setItem(key, value)
        if (key === PUBLIC_V6_STAGE_KEY) stageWritten = true
      },
    }
    expect(commitLegacyImportToPublicV6(corruptStage, inspected)).toEqual({ status: 'stage-verification-failed' })
    expect(storage.values.has(PUBLIC_V6_ROOT_KEY)).toBe(false)
    const secondStorage = memoryStorage([[CLASSIC_KEY, bytes]])
    const secondInspected = available(secondStorage, CLASSIC)
    const changedDuringStage = {
      getItem: secondStorage.getItem,
      setItem: (key: string, value: string) => {
        secondStorage.setItem(key, value)
        if (key === PUBLIC_V6_STAGE_KEY) secondStorage.values.set(CLASSIC_KEY, `${bytes} `)
      },
    }
    expect(commitLegacyImportToPublicV6(changedDuringStage, secondInspected)).toEqual({ status: 'source-changed' })
    expect(secondStorage.values.has(PUBLIC_V6_ROOT_KEY)).toBe(false)
  })

  it('preserves a pending stage when the public root is missing', () => {
    const bytes = serializeWizardWorld(createGeneratedWorld('greenway-alpha'))
    const staged = '{"schemaVersion":"wizard-world/v6","saveRevision":8}'
    const storage = memoryStorage([[CLASSIC_KEY, bytes], [PUBLIC_V6_STAGE_KEY, staged]])
    const inspected = available(storage, CLASSIC)
    expect(commitLegacyImportToPublicV6(storage, inspected)).toEqual({ status: 'pending-stage' })
    expect(storage.values.get(PUBLIC_V6_STAGE_KEY)).toBe(staged)
    expect(storage.values.has(PUBLIC_V6_ROOT_KEY)).toBe(false)
    expect(storage.writes).toEqual([])
  })

  it('rechecks the stage just before import writes when another caller staged in the meantime', () => {
    const bytes = serializeWizardWorld(createGeneratedWorld('greenway-alpha'))
    const staged = '{"schemaVersion":"wizard-world/v6","saveRevision":9}'
    const storage = memoryStorage([[CLASSIC_KEY, bytes]])
    const inspected = available(storage, CLASSIC)
    let firstSourceRead = true
    const interveningStage = {
      getItem: (key: string) => {
        if (key === CLASSIC_KEY && firstSourceRead) {
          firstSourceRead = false
          storage.values.set(PUBLIC_V6_STAGE_KEY, staged)
        }
        return storage.getItem(key)
      },
      setItem: storage.setItem,
    }
    expect(commitLegacyImportToPublicV6(interveningStage, inspected)).toEqual({ status: 'pending-stage' })
    expect(storage.values.get(PUBLIC_V6_STAGE_KEY)).toBe(staged)
    expect(storage.values.has(PUBLIC_V6_ROOT_KEY)).toBe(false)
    expect(storage.writes).toEqual([])
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

describe('explicit public v6 recovery', () => {
  it('archives an invalid root and publishes a chosen valid pending stage', () => {
    const { sourceBytes, bootstrapBytes, playableBytes } = recoveryFixtures()
    const storage = memoryStorage([
      [CLASSIC_KEY, sourceBytes], [PUBLIC_V6_ROOT_KEY, '{invalid root'],
      [PUBLIC_V6_STAGE_KEY, playableBytes], [PUBLIC_V6_BACKUP_KEY, bootstrapBytes],
    ])
    const read = readPublicV6RecoverySnapshot(storage)
    expect(read.status).toBe('available')
    if (read.status !== 'available') throw new Error('Expected recovery snapshot.')
    const result = recoverPublicV6Root(storage, 'stage', read.snapshot, { archiveKey })
    expect(result.status).toBe('recovered')
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(playableBytes)
    expect(storage.values.get(PUBLIC_V6_STAGE_KEY)).toBe(playableBytes)
    expect(storage.values.get(PUBLIC_V6_BACKUP_KEY)).toBe(bootstrapBytes)
    expect(storage.values.get(CLASSIC_KEY)).toBe(sourceBytes)
    expect(JSON.parse(storage.values.get(archiveKey)!)).toEqual({
      schemaVersion: 'wizard-world/v6-recovery-archive', selectedSource: 'stage', ...read.snapshot,
    })
    expect(storage.writes).toEqual([archiveKey, PUBLIC_V6_STAGE_KEY, PUBLIC_V6_ROOT_KEY])
    expect(inspectPublicV6Artifacts(storage)).toMatchObject({ status: 'available', stage: { status: 'settled' } })
  })

  it('archives an invalid stage and keeps the selected valid root without rewriting it', () => {
    const { bootstrapBytes, playableBytes } = recoveryFixtures()
    const storage = memoryStorage([
      [PUBLIC_V6_ROOT_KEY, playableBytes], [PUBLIC_V6_STAGE_KEY, '{invalid stage'],
      [PUBLIC_V6_BACKUP_KEY, bootstrapBytes],
    ])
    const read = readPublicV6RecoverySnapshot(storage)
    if (read.status !== 'available') throw new Error('Expected recovery snapshot.')
    expect(recoverPublicV6Root(storage, 'root', read.snapshot, { archiveKey })).toMatchObject({
      status: 'recovered', bytes: playableBytes, archiveKey,
    })
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(playableBytes)
    expect(storage.values.get(PUBLIC_V6_STAGE_KEY)).toBe(playableBytes)
    expect(storage.writes).toEqual([archiveKey, PUBLIC_V6_STAGE_KEY])
  })

  it('can choose a valid backup when the stage is invalid, after archiving all disputed bytes', () => {
    const { bootstrapBytes, playableBytes } = recoveryFixtures()
    const storage = memoryStorage([
      [PUBLIC_V6_ROOT_KEY, bootstrapBytes], [PUBLIC_V6_STAGE_KEY, '{invalid stage'],
      [PUBLIC_V6_BACKUP_KEY, playableBytes],
    ])
    const read = readPublicV6RecoverySnapshot(storage)
    if (read.status !== 'available') throw new Error('Expected recovery snapshot.')
    expect(recoverPublicV6Root(storage, 'backup', read.snapshot, { archiveKey }).status).toBe('recovered')
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(playableBytes)
    expect(storage.values.get(PUBLIC_V6_STAGE_KEY)).toBe(playableBytes)
    expect(JSON.parse(storage.values.get(archiveKey)!)).toMatchObject({
      rootBytes: bootstrapBytes, stageBytes: '{invalid stage', backupBytes: playableBytes,
    })
  })

  it('rejects invalid selected bytes, stale snapshots, and occupied archive keys without writes', () => {
    const { bootstrapBytes, playableBytes } = recoveryFixtures()
    const storage = memoryStorage([
      [PUBLIC_V6_ROOT_KEY, bootstrapBytes], [PUBLIC_V6_STAGE_KEY, '{invalid stage'],
      [PUBLIC_V6_BACKUP_KEY, playableBytes],
    ])
    const read = readPublicV6RecoverySnapshot(storage)
    if (read.status !== 'available') throw new Error('Expected recovery snapshot.')
    expect(recoverPublicV6Root(storage, 'stage', read.snapshot, { archiveKey })).toEqual({ status: 'invalid-source' })
    storage.values.set(PUBLIC_V6_STAGE_KEY, playableBytes)
    expect(recoverPublicV6Root(storage, 'backup', read.snapshot, { archiveKey })).toEqual({ status: 'snapshot-changed' })
    storage.values.set(PUBLIC_V6_STAGE_KEY, '{invalid stage')
    storage.values.set(archiveKey, 'existing archive')
    expect(recoverPublicV6Root(storage, 'backup', read.snapshot, { archiveKey })).toEqual({ status: 'archive-key-present' })
    expect(storage.values.get(archiveKey)).toBe('existing archive')
    expect(storage.writes).toEqual([])
  })

  it.each([archiveKey, PUBLIC_V6_STAGE_KEY, PUBLIC_V6_ROOT_KEY])(
    'reports a %s write failure and retains the verified archive when created', (failedKey) => {
      const { bootstrapBytes, playableBytes } = recoveryFixtures()
      const storage = memoryStorage([
        [PUBLIC_V6_ROOT_KEY, bootstrapBytes], [PUBLIC_V6_STAGE_KEY, '{invalid stage'],
        [PUBLIC_V6_BACKUP_KEY, playableBytes],
      ])
      const read = readPublicV6RecoverySnapshot(storage)
      if (read.status !== 'available') throw new Error('Expected recovery snapshot.')
      const failing = {
        getItem: storage.getItem,
        setItem: (key: string, bytes: string) => {
          if (key === failedKey) throw new Error('quota')
          storage.setItem(key, bytes)
        },
      }
      expect(recoverPublicV6Root(failing, 'backup', read.snapshot, { archiveKey })).toEqual({ status: 'storage-error' })
      expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(bootstrapBytes)
      expect(storage.values.get(archiveKey) === undefined).toBe(failedKey === archiveKey)
      expect(storage.values.get(PUBLIC_V6_STAGE_KEY)).toBe(
        failedKey === PUBLIC_V6_ROOT_KEY ? playableBytes : '{invalid stage',
      )
      if (failedKey !== archiveKey) {
        expect(JSON.parse(storage.values.get(archiveKey)!)).toMatchObject(read.snapshot)
      }
    },
  )
})
