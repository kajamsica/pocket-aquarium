import { describe, expect, it } from 'vitest'
import { createGeneratedWorld } from './generation'
import { serializeWizardWorld } from './persistence'
import {
  PUBLIC_V6_BACKUP_KEY, PUBLIC_V6_ROOT_KEY, PUBLIC_V6_STAGE_KEY,
  commitLegacyImportToPublicV6, commitPublicV6World, inspectLegacyImportSource,
} from './publicWorldV6'
import { createFreshPublicWorld } from './publicWorldState'
import {
  PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_STAGE_KEY,
  commitPublicV7World, inspectPublicV7Artifacts, loadPublicV7Root,
  migratePublicV6ToV7, serializePublicV7World, withFreshPublicV7Herbs,
} from './publicWorldV7'
import { readPublicV7RecoverySnapshot, recoverPublicV7Root } from './publicWorldV7Recovery'
import {
  inspectPublicV7FreshForkSnapshot, readPublicV7FreshForkSnapshot,
  resolvePublicV7FreshFork,
} from './publicWorldV7FreshFork'

const archiveKey = 'wizard-realms:world:v7:fresh-fork-archive:00000000-0000-4000-8000-000000000001'
const retryArchiveKey = 'wizard-realms:world:v7:fresh-fork-archive:00000000-0000-4000-8000-000000000002'
const seed = 'greenway-alpha'
const profile = 'greenway-classic-v1'

function memoryStorage() {
  const values = new Map<string, string>()
  const mutations: string[] = []
  return { values, mutations,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, bytes: string) => { mutations.push(`set:${key}`); values.set(key, bytes) },
    removeItem: (key: string) => { mutations.push(`remove:${key}`); values.delete(key) },
  }
}

function fixture() {
  const storage = memoryStorage()
  const fresh = commitPublicV7World(storage,
    withFreshPublicV7Herbs(createFreshPublicWorld(seed, profile)), null)
  if (fresh.status !== 'committed') throw new Error(fresh.status)
  const olderTab = memoryStorage()
  const olderWorld = createFreshPublicWorld(seed, profile)
  olderWorld.player.coins = 71
  const v6 = commitPublicV6World(olderTab, olderWorld, null)
  if (v6.status !== 'committed') throw new Error(v6.status)
  for (const key of [PUBLIC_V6_ROOT_KEY, PUBLIC_V6_STAGE_KEY, PUBLIC_V6_BACKUP_KEY]) {
    const bytes = olderTab.getItem(key)
    if (bytes !== null) storage.values.set(key, bytes)
  }
  storage.mutations.length = 0
  const read = readPublicV7FreshForkSnapshot(storage)
  if (read.status !== 'available') throw new Error(read.status)
  return { storage, snapshot: read.snapshot, fresh, v6 }
}

function pendingFixture() {
  const base = fixture()
  const stageState = { ...base.fresh.root.state,
    player: { ...base.fresh.root.state.player, coins: base.fresh.root.state.player.coins + 5 } }
  const stageBytes = serializePublicV7World({ ...base.fresh.root,
    saveRevision: base.fresh.root.saveRevision + 1, state: stageState })
  base.storage.values.set(PUBLIC_V7_STAGE_KEY, stageBytes)
  return { ...base, stageState, stageBytes,
    snapshot: { ...base.snapshot, v7StageBytes: stageBytes } }
}

function initialStageFixture() {
  const storage = memoryStorage()
  const state = withFreshPublicV7Herbs(createFreshPublicWorld(seed, profile))
  const interrupted = { getItem: storage.getItem,
    setItem: (key: string, bytes: string) => {
      if (key === PUBLIC_V7_ROOT_KEY) throw new Error('initial root write failed')
      storage.setItem(key, bytes)
    } }
  expect(commitPublicV7World(interrupted, state, null)).toEqual({ status: 'storage-error' })
  const stageBytes = storage.getItem(PUBLIC_V7_STAGE_KEY)!
  expect(storage.getItem(PUBLIC_V7_ROOT_KEY)).toBeNull()
  const v6State = createFreshPublicWorld(seed, profile)
  v6State.player.coins = 71
  const v6 = commitPublicV6World(storage, v6State, null)
  if (v6.status !== 'committed') throw new Error(v6.status)
  storage.mutations.length = 0
  const read = readPublicV7FreshForkSnapshot(storage)
  if (read.status !== 'available') throw new Error(read.status)
  return { storage, snapshot: read.snapshot, state, stageBytes, v6 }
}

describe('explicit fresh v7 versus later independent v6 fork', () => {
  it.each(['use-v7-stage', 'use-v6'] as const)(
    'resolves a root-missing fresh start by explicitly choosing %s', (choice) => {
      const { storage, snapshot, state, stageBytes, v6 } = initialStageFixture()
      expect(inspectPublicV7FreshForkSnapshot(snapshot)).toEqual({ status: 'available',
        choices: ['use-v7-stage', 'use-v6'] })
      const result = resolvePublicV7FreshFork(storage, choice, snapshot, { archiveKey })
      expect(result.status).toBe('resolved')
      if (result.status !== 'resolved') return
      expect(result.root.saveRevision).toBe(1)
      expect(result.root.state).toEqual(choice === 'use-v7-stage' ? state
        : withFreshPublicV7Herbs(v6.root.state))
      expect(result.root.migrationSourceV6Bytes).toBe(v6.bytes)
      expect(JSON.parse(storage.getItem(archiveKey)!)).toEqual({
        schemaVersion: 'wizard-world/v7-fresh-fork-archive', choice, ...snapshot,
      })
      expect(storage.getItem(PUBLIC_V7_BACKUP_KEY)).toBe(stageBytes)
      expect(storage.getItem(PUBLIC_V7_STAGE_KEY)).toBe(result.bytes)
      expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(snapshot.v6RootBytes)
      expect(storage.getItem(PUBLIC_V6_STAGE_KEY)).toBe(snapshot.v6StageBytes)
      expect(storage.getItem(PUBLIC_V6_BACKUP_KEY)).toBe(snapshot.v6BackupBytes)
      expect(storage.mutations).toEqual([`set:${archiveKey}`, `set:${PUBLIC_V7_BACKUP_KEY}`,
        `set:${PUBLIC_V7_ROOT_KEY}`, `set:${PUBLIC_V7_STAGE_KEY}`])
      expect(inspectPublicV7Artifacts(storage)).toMatchObject({ stage: { status: 'settled' } })
    })

  it.each([
    ['other-seed', profile], [seed, 'greenway-expanded-v1'],
  ] as const)('offers only archived v6 when the staged v7 lineage differs: %s / %s',
    (otherSeed, otherProfile) => {
      const { storage, stageBytes } = initialStageFixture()
      const other = commitPublicV6World(memoryStorage(),
        createFreshPublicWorld(otherSeed, otherProfile), null)
      if (other.status !== 'committed') throw new Error(other.status)
      storage.values.set(PUBLIC_V6_ROOT_KEY, other.bytes)
      storage.values.set(PUBLIC_V6_STAGE_KEY, other.bytes)
      const read = readPublicV7FreshForkSnapshot(storage)
      if (read.status !== 'available') throw new Error(read.status)
      expect(inspectPublicV7FreshForkSnapshot(read.snapshot))
        .toEqual({ status: 'available', choices: ['use-v6'] })
      expect(resolvePublicV7FreshFork(storage, 'use-v7-stage', read.snapshot, { archiveKey }))
        .toEqual({ status: 'invalid-choice' })
      expect(storage.mutations).toEqual([])
      const result = resolvePublicV7FreshFork(storage, 'use-v6', read.snapshot, { archiveKey })
      expect(result.status).toBe('resolved')
      if (result.status !== 'resolved') return
      expect(result.root.state.seed).toBe(otherSeed)
      expect(result.root.state.generationProfile).toBe(otherProfile)
      expect(result.root.migrationSourceV6Bytes).toBe(other.bytes)
      expect(JSON.parse(storage.getItem(archiveKey)!)).toMatchObject({
        v7RootBytes: null, v7StageBytes: stageBytes, v6RootBytes: other.bytes,
      })
      expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(other.bytes)
      expect(storage.getItem(PUBLIC_V6_STAGE_KEY)).toBe(other.bytes)
      expect(storage.getItem(PUBLIC_V6_BACKUP_KEY)).toBe(read.snapshot.v6BackupBytes)
      expect(storage.mutations).toEqual([`set:${archiveKey}`, `set:${PUBLIC_V7_BACKUP_KEY}`,
        `set:${PUBLIC_V7_ROOT_KEY}`, `set:${PUBLIC_V7_STAGE_KEY}`])
    })

  it('offers only archived v6 for a later legacy bootstrap', () => {
    const { storage, stageBytes } = initialStageFixture()
    const legacy = memoryStorage()
    legacy.values.set('wizard-realms:world:v5', serializeWizardWorld(createGeneratedWorld(seed, profile)))
    const source = inspectLegacyImportSource(legacy, profile)
    if (source.status !== 'available') throw new Error(source.status)
    const imported = commitLegacyImportToPublicV6(legacy, source)
    if (imported.status !== 'committed') throw new Error(imported.status)
    const v6Bytes = legacy.getItem(PUBLIC_V6_ROOT_KEY)!
    storage.values.set(PUBLIC_V6_ROOT_KEY, v6Bytes)
    storage.values.set(PUBLIC_V6_STAGE_KEY, v6Bytes)
    const read = readPublicV7FreshForkSnapshot(storage)
    if (read.status !== 'available') throw new Error(read.status)
    expect(inspectPublicV7FreshForkSnapshot(read.snapshot))
      .toEqual({ status: 'available', choices: ['use-v6'] })
    const result = resolvePublicV7FreshFork(storage, 'use-v6', read.snapshot, { archiveKey })
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.root.bootstrap).toEqual(imported.root)
    expect(result.root.migrationSourceV6Bytes).toBe(v6Bytes)
    expect(JSON.parse(storage.getItem(archiveKey)!)).toMatchObject({
      v7RootBytes: null, v7StageBytes: stageBytes, v6RootBytes: v6Bytes,
    })
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(v6Bytes)
    expect(storage.getItem(PUBLIC_V6_STAGE_KEY)).toBe(v6Bytes)
  })

  it('does not treat a later staged revision as an initial fresh start', () => {
    const { snapshot, stageBytes } = initialStageFixture()
    const later = JSON.stringify({ ...JSON.parse(stageBytes), saveRevision: 1 })
    expect(inspectPublicV7FreshForkSnapshot({ ...snapshot, v7StageBytes: later }))
      .toEqual({ status: 'not-initial-fresh-stage' })
  })

  it.each([
    [PUBLIC_V7_BACKUP_KEY, 'backup-verification-failed'],
    [PUBLIC_V7_ROOT_KEY, 'root-verification-failed'],
  ])('keeps a missing-root choice retryable if %s readback fails', (blockedKey, status) => {
    const { storage, snapshot, stageBytes } = initialStageFixture()
    const refusing = { ...storage, setItem: (key: string, bytes: string) => {
      if (key !== blockedKey) storage.setItem(key, bytes)
    } }
    expect(resolvePublicV7FreshFork(refusing, 'use-v7-stage', snapshot, { archiveKey }))
      .toEqual({ status, archiveKey })
    expect(storage.getItem(PUBLIC_V7_ROOT_KEY)).toBeNull()
    expect(storage.getItem(PUBLIC_V7_STAGE_KEY)).toBe(stageBytes)
    const retry = readPublicV7FreshForkSnapshot(storage)
    if (retry.status !== 'available') throw new Error(retry.status)
    expect(inspectPublicV7FreshForkSnapshot(retry.snapshot))
      .toEqual({ status: 'available', choices: ['use-v7-stage', 'use-v6'] })
    expect(resolvePublicV7FreshFork(storage, 'use-v7-stage', retry.snapshot,
      { archiveKey: retryArchiveKey }).status).toBe('resolved')
  })

  it('keeps a missing-root stage failure recoverable from its new root', () => {
    const { storage, snapshot, stageBytes } = initialStageFixture()
    const refusing = { ...storage, setItem: (key: string, bytes: string) => {
      if (key !== PUBLIC_V7_STAGE_KEY) storage.setItem(key, bytes)
    } }
    expect(resolvePublicV7FreshFork(refusing, 'use-v7-stage', snapshot, { archiveKey }))
      .toEqual({ status: 'stage-verification-failed', archiveKey })
    expect(storage.getItem(PUBLIC_V7_STAGE_KEY)).toBe(stageBytes)
    expect(loadPublicV7Root(storage).status).toBe('valid-playable')
    const recovery = readPublicV7RecoverySnapshot(storage)
    if (recovery.status !== 'available') throw new Error(recovery.status)
    expect(recoverPublicV7Root(storage, 'root', recovery.snapshot, {
      archiveKey: 'wizard-realms:world:v7:archive:00000000-0000-4000-8000-000000000005',
    }).status).toBe('recovered')
    expect(inspectPublicV7Artifacts(storage)).toMatchObject({ stage: { status: 'settled' } })
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(snapshot.v6RootBytes)
  })
  it('requires valid roots but archives pending or invalid artifacts', () => {
    const { snapshot } = fixture()
    expect(inspectPublicV7FreshForkSnapshot(snapshot)).toEqual({
      status: 'available', choices: ['continue-v7', 'use-v6'],
    })
    expect(inspectPublicV7FreshForkSnapshot({ ...snapshot, extra: true }))
      .toEqual({ status: 'invalid-expected-snapshot' })
    expect(inspectPublicV7FreshForkSnapshot({ ...snapshot, v7RootBytes: '{bad' }))
      .toEqual({ status: 'invalid-v7-root' })
    expect(inspectPublicV7FreshForkSnapshot({ ...snapshot, v6RootBytes: '{bad' }))
      .toEqual({ status: 'invalid-v6-root' })
    expect(inspectPublicV7FreshForkSnapshot({ ...snapshot,
      v7StageBytes: '{pending', v7BackupBytes: '{bad',
      v6StageBytes: '{pending', v6BackupBytes: '{bad',
    })).toEqual({ status: 'available', choices: ['continue-v7', 'use-v6'] })
    for (const [otherSeed, otherProfile] of [
      ['other-seed', profile], [seed, 'greenway-expanded-v1'],
    ] as const) {
      const other = commitPublicV6World(memoryStorage(),
        createFreshPublicWorld(otherSeed, otherProfile), null)
      if (other.status !== 'committed') throw new Error(other.status)
      expect(inspectPublicV7FreshForkSnapshot({ ...snapshot,
        v6RootBytes: other.bytes, v6StageBytes: other.bytes,
      })).toEqual({ status: 'available', choices: ['use-v6'] })
    }
  })

  it.each(['continue-v7', 'use-v7-stage', 'use-v6'] as const)(
    'offers the strictly newer fresh v7 stage as a distinct archived choice: %s', (choice) => {
      const { storage, snapshot, fresh, stageState, stageBytes, v6 } = pendingFixture()
      expect(inspectPublicV7FreshForkSnapshot(snapshot)).toEqual({ status: 'available',
        choices: ['continue-v7', 'use-v7-stage', 'use-v6'] })
      const result = resolvePublicV7FreshFork(storage, choice, snapshot, { archiveKey })
      expect(result.status).toBe('resolved')
      if (result.status !== 'resolved') return
      expect(result.root.saveRevision).toBe(fresh.root.saveRevision + 2)
      expect(result.root.state).toEqual(choice === 'continue-v7' ? fresh.root.state
        : choice === 'use-v7-stage' ? stageState : withFreshPublicV7Herbs(v6.root.state))
      expect(result.root.migrationSourceV6Bytes).toBe(v6.bytes)
      expect(JSON.parse(storage.getItem(archiveKey)!)).toEqual({
        schemaVersion: 'wizard-world/v7-fresh-fork-archive', choice, ...snapshot,
      })
      expect(storage.getItem(PUBLIC_V7_BACKUP_KEY)).toBe(fresh.bytes)
      expect(storage.getItem(PUBLIC_V7_STAGE_KEY)).toBe(result.bytes)
      expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(v6.bytes)
      expect(storage.getItem(PUBLIC_V6_STAGE_KEY)).toBe(snapshot.v6StageBytes)
      expect(storage.getItem(PUBLIC_V6_BACKUP_KEY)).toBe(snapshot.v6BackupBytes)
      expect(storage.mutations).toEqual([`set:${archiveKey}`, `set:${PUBLIC_V7_BACKUP_KEY}`,
        `set:${PUBLIC_V7_ROOT_KEY}`, `set:${PUBLIC_V7_STAGE_KEY}`])
      expect(stageBytes).not.toBe(result.bytes)
      expect(inspectPublicV7Artifacts(storage)).toMatchObject({ stage: { status: 'settled' } })
    })

  it('does not offer an invalid, stale, or unrelated v7 stage', () => {
    const { snapshot, fresh } = pendingFixture()
    expect(inspectPublicV7FreshForkSnapshot({ ...snapshot, v7StageBytes: '{bad' }))
      .toEqual({ status: 'available', choices: ['continue-v7', 'use-v6'] })
    expect(inspectPublicV7FreshForkSnapshot({ ...snapshot,
      v7StageBytes: JSON.stringify({ ...fresh.root, saveRevision: fresh.root.saveRevision }),
    })).toEqual({ status: 'available', choices: ['continue-v7', 'use-v6'] })
    const other = memoryStorage()
    const unrelated = commitPublicV7World(other,
      withFreshPublicV7Herbs(createFreshPublicWorld('other-seed', profile)), null)
    if (unrelated.status !== 'committed') throw new Error(unrelated.status)
    expect(inspectPublicV7FreshForkSnapshot({ ...snapshot, v7StageBytes: unrelated.bytes }))
      .toEqual({ status: 'available', choices: ['continue-v7', 'use-v6'] })
  })

  it('archives every original byte and binds the v7 state to v6 without changing any v6 key', () => {
    const { storage, snapshot, fresh, v6 } = fixture()
    const result = resolvePublicV7FreshFork(storage, 'continue-v7', snapshot, { archiveKey })
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.choice).toBe('continue-v7')
    expect(result.root.saveRevision).toBe(fresh.root.saveRevision + 1)
    expect(result.root.state).toEqual(fresh.root.state)
    expect(result.root.migrationSourceV6Bytes).toBe(v6.bytes)
    expect(result.warning).toBe('old-v6-tabs-may-advance-source')
    expect(storage.mutations).toEqual([
      `set:${archiveKey}`, `set:${PUBLIC_V7_BACKUP_KEY}`,
      `set:${PUBLIC_V7_ROOT_KEY}`, `set:${PUBLIC_V7_STAGE_KEY}`,
    ])
    expect(JSON.parse(storage.values.get(archiveKey)!)).toEqual({
      schemaVersion: 'wizard-world/v7-fresh-fork-archive', choice: 'continue-v7', ...snapshot,
    })
    expect(storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(result.bytes)
    expect(storage.getItem(PUBLIC_V7_STAGE_KEY)).toBe(result.bytes)
    expect(storage.getItem(PUBLIC_V7_BACKUP_KEY)).toBe(snapshot.v7RootBytes)
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(snapshot.v6RootBytes)
    expect(storage.getItem(PUBLIC_V6_STAGE_KEY)).toBe(snapshot.v6StageBytes)
    expect(storage.getItem(PUBLIC_V6_BACKUP_KEY)).toBe(snapshot.v6BackupBytes)
    expect(loadPublicV7Root(storage).status).toBe('valid-playable')
    expect(inspectPublicV7Artifacts(storage)).toMatchObject({
      status: 'available', stage: { status: 'settled' }, backup: { status: 'available' },
    })
    expect(commitPublicV7World(storage, result.root.state, result.bytes).status).toBe('committed')
  })

  it('archives the prior v7 fork and publishes a revision sourced from v6 without writing v6 keys', () => {
    const { storage, snapshot, fresh, v6 } = fixture()
    const result = resolvePublicV7FreshFork(storage, 'use-v6', snapshot, { archiveKey })
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.root.saveRevision).toBe(fresh.root.saveRevision + 1)
    expect(result.root.migrationSourceV6Bytes).toBe(v6.bytes)
    expect(result.root.bootstrap).toBeNull()
    expect(result.root.state).toEqual(withFreshPublicV7Herbs(v6.root.state))
    expect(storage.mutations).toEqual([
      `set:${archiveKey}`, `set:${PUBLIC_V7_BACKUP_KEY}`,
      `set:${PUBLIC_V7_ROOT_KEY}`, `set:${PUBLIC_V7_STAGE_KEY}`,
    ])
    expect(storage.getItem(PUBLIC_V7_BACKUP_KEY)).toBe(fresh.bytes)
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(snapshot.v6RootBytes)
    expect(storage.getItem(PUBLIC_V6_STAGE_KEY)).toBe(snapshot.v6StageBytes)
    expect(storage.getItem(PUBLIC_V6_BACKUP_KEY)).toBe(snapshot.v6BackupBytes)
    expect(loadPublicV7Root(storage).status).toBe('valid-playable')
    expect(inspectPublicV7Artifacts(storage)).toMatchObject({ stage: { status: 'settled' } })
  })

  it('derives bootstrap and playable state from a later v6 import without changing its bytes', () => {
    const { storage } = fixture()
    const legacy = memoryStorage()
    legacy.values.set('wizard-realms:world:v5', serializeWizardWorld(createGeneratedWorld(seed, profile)))
    const source = inspectLegacyImportSource(legacy, profile)
    if (source.status !== 'available') throw new Error(source.status)
    const imported = commitLegacyImportToPublicV6(legacy, source)
    if (imported.status !== 'committed') throw new Error(imported.status)
    const v6Bytes = legacy.getItem(PUBLIC_V6_ROOT_KEY)!
    storage.values.set(PUBLIC_V6_ROOT_KEY, v6Bytes)
    storage.values.set(PUBLIC_V6_STAGE_KEY, v6Bytes)
    const read = readPublicV7FreshForkSnapshot(storage)
    if (read.status !== 'available') throw new Error(read.status)
    expect(inspectPublicV7FreshForkSnapshot(read.snapshot))
      .toEqual({ status: 'available', choices: ['use-v6'] })
    expect(resolvePublicV7FreshFork(storage, 'continue-v7', read.snapshot, { archiveKey }))
      .toEqual({ status: 'incompatible-lineage' })
    expect(storage.mutations).toEqual([])
    const result = resolvePublicV7FreshFork(storage, 'use-v6', read.snapshot, { archiveKey })
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.root.bootstrap).toEqual(imported.root)
    expect(result.root.migrationSourceV6Bytes).toBe(v6Bytes)
    expect(result.root.state.seed).toBe(imported.root.seed)
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(v6Bytes)
    expect(storage.getItem(PUBLIC_V6_STAGE_KEY)).toBe(v6Bytes)
  })

  it('rejects migrated v7 and stale snapshots without mutations', () => {
    const { storage, snapshot } = fixture()
    const source = memoryStorage()
    const v6 = commitPublicV6World(source, createFreshPublicWorld(seed, profile), null)
    if (v6.status !== 'committed') throw new Error(v6.status)
    const migrated = migratePublicV6ToV7(source, v6.bytes)
    if (migrated.status !== 'committed') throw new Error(migrated.status)
    expect(inspectPublicV7FreshForkSnapshot({ ...snapshot, v7RootBytes: migrated.bytes }))
      .toEqual({ status: 'not-fresh-v7' })
    storage.values.set(PUBLIC_V6_ROOT_KEY, '{raced')
    expect(resolvePublicV7FreshFork(storage, 'continue-v7', snapshot, { archiveKey }))
      .toEqual({ status: 'snapshot-changed' })
    expect(storage.mutations).toEqual([])
  })

  it('archives invalid stage and backup bytes before choosing the current root', () => {
    const { storage, snapshot } = fixture()
    storage.values.set(PUBLIC_V7_STAGE_KEY, '{invalid-stage')
    storage.values.set(PUBLIC_V7_BACKUP_KEY, '{invalid-backup')
    storage.values.set(PUBLIC_V6_STAGE_KEY, '{invalid-v6-stage')
    storage.values.set(PUBLIC_V6_BACKUP_KEY, '{invalid-v6-backup')
    const read = readPublicV7FreshForkSnapshot(storage)
    if (read.status !== 'available') throw new Error(read.status)
    expect(inspectPublicV7FreshForkSnapshot(read.snapshot))
      .toEqual({ status: 'available', choices: ['continue-v7', 'use-v6'] })
    const result = resolvePublicV7FreshFork(storage, 'continue-v7', read.snapshot, { archiveKey })
    expect(result.status).toBe('resolved')
    expect(JSON.parse(storage.getItem(archiveKey)!)).toMatchObject({
      v7StageBytes: '{invalid-stage', v7BackupBytes: '{invalid-backup',
      v6StageBytes: '{invalid-v6-stage', v6BackupBytes: '{invalid-v6-backup',
    })
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(snapshot.v6RootBytes)
    expect(storage.getItem(PUBLIC_V6_STAGE_KEY)).toBe('{invalid-v6-stage')
    expect(storage.getItem(PUBLIC_V6_BACKUP_KEY)).toBe('{invalid-v6-backup')
    expect(inspectPublicV7Artifacts(storage)).toMatchObject({ stage: { status: 'settled' } })
  })

  it('does not remove or publish either root when archive creation or readback fails', () => {
    const { storage, snapshot } = fixture()
    const failedWrite = { ...storage, setItem: (key: string, bytes: string) => {
      if (key === archiveKey) throw new Error('quota')
      storage.setItem(key, bytes)
    } }
    expect(resolvePublicV7FreshFork(failedWrite, 'continue-v7', snapshot, { archiveKey }))
      .toEqual({ status: 'storage-error' })
    const failedRead = { ...storage, getItem: (key: string) =>
      key === archiveKey ? null : storage.getItem(key) }
    expect(resolvePublicV7FreshFork(failedRead, 'use-v6', snapshot, { archiveKey }))
      .toEqual({ status: 'archive-verification-failed' })
    expect(storage.mutations).toEqual([`set:${archiveKey}`])
    expect(storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(snapshot.v7RootBytes)
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(snapshot.v6RootBytes)
  })

  it('rechecks the six keys after archival before mutation', () => {
    const { storage, snapshot } = fixture()
    const racing = { ...storage, setItem: (key: string, bytes: string) => {
      storage.setItem(key, bytes)
      if (key === archiveKey) storage.values.set(PUBLIC_V6_ROOT_KEY, '{raced')
    } }
    expect(resolvePublicV7FreshFork(racing, 'continue-v7', snapshot, { archiveKey }))
      .toEqual({ status: 'snapshot-changed', archiveKey })
    expect(storage.mutations).toEqual([`set:${archiveKey}`])
    expect(storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(snapshot.v7RootBytes)
  })

  it.each([
    [PUBLIC_V7_BACKUP_KEY, 'backup-verification-failed'],
    [PUBLIC_V7_ROOT_KEY, 'root-verification-failed'],
  ])('leaves the choice retryable when %s readback fails', (blockedKey, status) => {
    const { storage, snapshot } = fixture()
    const refusing = { ...storage, setItem: (key: string, bytes: string) => {
      if (key !== blockedKey) storage.setItem(key, bytes)
    } }
    expect(resolvePublicV7FreshFork(refusing, 'use-v6', snapshot, { archiveKey }))
      .toEqual({ status, archiveKey })
    expect(storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(snapshot.v7RootBytes)
    expect(storage.getItem(PUBLIC_V7_STAGE_KEY)).toBe(snapshot.v7StageBytes)
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(snapshot.v6RootBytes)
    const retry = readPublicV7FreshForkSnapshot(storage)
    if (retry.status !== 'available') throw new Error(retry.status)
    expect(inspectPublicV7FreshForkSnapshot(retry.snapshot).status).toBe('available')
    expect(resolvePublicV7FreshFork(storage, 'use-v6', retry.snapshot,
      { archiveKey: retryArchiveKey }).status).toBe('resolved')
  })

  it.each([PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_ROOT_KEY])(
    'leaves the original stage settled when %s throws before writing', (blockedKey) => {
      const { storage, snapshot } = fixture()
      const refusing = { ...storage, setItem: (key: string, bytes: string) => {
        if (key === blockedKey) throw new Error('quota')
        storage.setItem(key, bytes)
      } }
      expect(resolvePublicV7FreshFork(refusing, 'continue-v7', snapshot, { archiveKey }))
        .toEqual({ status: 'storage-error', archiveKey })
      expect(storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(snapshot.v7RootBytes)
      expect(storage.getItem(PUBLIC_V7_STAGE_KEY)).toBe(snapshot.v7StageBytes)
      expect(inspectPublicV7Artifacts(storage)).toMatchObject({ stage: { status: 'settled' } })
    })

  it('recovers an already-published root when final stage settlement fails', () => {
    const { storage, snapshot } = fixture()
    const refusing = { ...storage, setItem: (key: string, bytes: string) => {
      if (key !== PUBLIC_V7_STAGE_KEY) storage.setItem(key, bytes)
    } }
    expect(resolvePublicV7FreshFork(refusing, 'continue-v7', snapshot, { archiveKey }))
      .toEqual({ status: 'stage-verification-failed', archiveKey })
    expect(loadPublicV7Root(storage).status).toBe('valid-playable')
    expect(inspectPublicV7Artifacts(storage)).toMatchObject({ stage: { status: 'pending' } })
    const recovery = readPublicV7RecoverySnapshot(storage)
    if (recovery.status !== 'available') throw new Error(recovery.status)
    const repaired = recoverPublicV7Root(storage, 'root', recovery.snapshot, {
      archiveKey: 'wizard-realms:world:v7:archive:00000000-0000-4000-8000-000000000003',
    })
    expect(repaired.status).toBe('recovered')
    expect(inspectPublicV7Artifacts(storage)).toMatchObject({ stage: { status: 'settled' } })
    expect(storage.getItem(archiveKey)).not.toBeNull()
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(snapshot.v6RootBytes)
  })

  it('can recover a root write that committed before the storage adapter threw', () => {
    const { storage, snapshot } = fixture()
    const throwAfterWrite = { ...storage, setItem: (key: string, bytes: string) => {
      storage.setItem(key, bytes)
      if (key === PUBLIC_V7_ROOT_KEY) throw new Error('interrupted')
    } }
    expect(resolvePublicV7FreshFork(throwAfterWrite, 'use-v6', snapshot, { archiveKey }))
      .toEqual({ status: 'storage-error', archiveKey })
    const recovery = readPublicV7RecoverySnapshot(storage)
    if (recovery.status !== 'available') throw new Error(recovery.status)
    expect(recoverPublicV7Root(storage, 'root', recovery.snapshot, {
      archiveKey: 'wizard-realms:world:v7:archive:00000000-0000-4000-8000-000000000004',
    }).status).toBe('recovered')
    expect(inspectPublicV7Artifacts(storage)).toMatchObject({ stage: { status: 'settled' } })
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(snapshot.v6RootBytes)
  })
})
