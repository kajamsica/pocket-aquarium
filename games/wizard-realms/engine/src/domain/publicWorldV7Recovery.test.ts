import { describe, expect, it } from 'vitest'
import { createGeneratedWorld } from './generation'
import { serializeWizardWorld } from './persistence'
import {
  PUBLIC_V6_ROOT_KEY, commitLegacyImportToPublicV6, commitPublicV6World, inspectLegacyImportSource,
  parsePublicV6PlayableRoot, serializePublicV6World,
} from './publicWorldV6'
import { createFreshPublicWorld } from './publicWorldState'
import {
  PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_STAGE_KEY,
  commitPublicV7World, migratePublicV6ToV7, parsePublicV7PlayableRoot,
  serializePublicV7World, withFreshPublicV7Herbs,
} from './publicWorldV7'
import {
  readPublicV7RecoverySnapshot, recoverPublicV7Root,
} from './publicWorldV7Recovery'

const archiveKey = 'wizard-realms:world:v7:archive:00000000-0000-4000-8000-000000000001'

function memoryStorage(entries: readonly (readonly [string, string])[] = []) {
  const values = new Map(entries)
  const writes: string[] = []
  return { values, writes,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, bytes: string) => { writes.push(key); values.set(key, bytes) },
  }
}

function v7Candidates() {
  const storage = memoryStorage()
  const v6 = commitPublicV6World(storage,
    createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'), null)
  if (v6.status !== 'committed') throw new Error(v6.status)
  const first = migratePublicV6ToV7(storage, v6.bytes)
  if (first.status !== 'committed') throw new Error(first.status)
  const next = commitPublicV7World(storage, first.root.state, first.bytes)
  if (next.status !== 'committed') throw new Error(next.status)
  return { v6Bytes: v6.bytes, firstBytes: first.bytes, nextBytes: next.bytes }
}

function snapshot(storage: Pick<Storage, 'getItem'>) {
  const read = readPublicV7RecoverySnapshot(storage)
  if (read.status !== 'available') throw new Error('Expected recovery snapshot.')
  return read.snapshot
}

describe('explicit public v7 recovery', () => {
  it('archives every original byte string before publishing a valid pending stage', () => {
    const { v6Bytes, firstBytes, nextBytes } = v7Candidates()
    const storage = memoryStorage([
      [PUBLIC_V6_ROOT_KEY, v6Bytes],
      [PUBLIC_V7_ROOT_KEY, firstBytes], [PUBLIC_V7_STAGE_KEY, nextBytes],
      [PUBLIC_V7_BACKUP_KEY, '{invalid backup'],
    ])
    const original = snapshot(storage)
    const result = recoverPublicV7Root(storage, 'stage', original, { archiveKey })
    expect(result).toMatchObject({ status: 'recovered', bytes: nextBytes, archiveKey })
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(nextBytes)
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(nextBytes)
    expect(storage.values.get(PUBLIC_V7_BACKUP_KEY)).toBe(nextBytes)
    expect(JSON.parse(storage.values.get(archiveKey)!)).toEqual({
      schemaVersion: 'wizard-world/v7-recovery-archive', selectedSource: 'stage', ...original,
    })
    expect(storage.writes).toEqual([
      archiveKey, PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_STAGE_KEY, PUBLIC_V7_ROOT_KEY,
    ])
  })

  it('restores an invalid root from a valid backup and retains the invalid bytes in the archive', () => {
    const { v6Bytes, firstBytes } = v7Candidates()
    const storage = memoryStorage([
      [PUBLIC_V6_ROOT_KEY, v6Bytes],
      [PUBLIC_V7_ROOT_KEY, '{invalid root'], [PUBLIC_V7_STAGE_KEY, '{invalid stage'],
      [PUBLIC_V7_BACKUP_KEY, firstBytes],
    ])
    const original = snapshot(storage)
    expect(recoverPublicV7Root(storage, 'backup', original, { archiveKey })).toMatchObject({
      status: 'recovered', bytes: firstBytes, archiveKey,
    })
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(firstBytes)
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(firstBytes)
    expect(JSON.parse(storage.values.get(archiveKey)!)).toMatchObject(original)
    expect(storage.writes).toEqual([archiveKey, PUBLIC_V7_STAGE_KEY, PUBLIC_V7_ROOT_KEY])
  })

  it('rejects stale and malformed snapshots, invalid sources, and an occupied archive without writes', () => {
    const { v6Bytes, firstBytes, nextBytes } = v7Candidates()
    const storage = memoryStorage([
      [PUBLIC_V6_ROOT_KEY, v6Bytes],
      [PUBLIC_V7_ROOT_KEY, firstBytes], [PUBLIC_V7_STAGE_KEY, '{invalid stage'],
      [PUBLIC_V7_BACKUP_KEY, nextBytes],
    ])
    const original = snapshot(storage)
    expect(recoverPublicV7Root(storage, 'stage', original, { archiveKey }))
      .toEqual({ status: 'invalid-source' })
    expect(recoverPublicV7Root(storage, 'backup', { ...original, extra: true } as never, { archiveKey }))
      .toEqual({ status: 'invalid-expected-snapshot' })
    storage.values.set(PUBLIC_V7_ROOT_KEY, nextBytes)
    expect(recoverPublicV7Root(storage, 'backup', original, { archiveKey }))
      .toEqual({ status: 'snapshot-changed' })
    storage.values.set(PUBLIC_V7_ROOT_KEY, firstBytes)
    storage.values.set(archiveKey, 'existing archive')
    expect(recoverPublicV7Root(storage, 'backup', original, { archiveKey }))
      .toEqual({ status: 'archive-key-present' })
    expect(storage.values.get(archiveKey)).toBe('existing archive')
    expect(storage.writes).toEqual([])
  })

  it('leaves candidate bytes untouched when the archive write or readback fails', () => {
    const { v6Bytes, firstBytes } = v7Candidates()
    const storage = memoryStorage([
      [PUBLIC_V6_ROOT_KEY, v6Bytes],
      [PUBLIC_V7_ROOT_KEY, '{invalid root'], [PUBLIC_V7_STAGE_KEY, firstBytes],
    ])
    const original = snapshot(storage)
    const failingWrite = {
      getItem: storage.getItem,
      setItem: (key: string, bytes: string) => {
        if (key === archiveKey) throw new Error('quota')
        storage.setItem(key, bytes)
      },
    }
    expect(recoverPublicV7Root(failingWrite, 'stage', original, { archiveKey }))
      .toEqual({ status: 'storage-error' })
    expect(storage.writes).toEqual([])
    const failingReadback = {
      getItem: (key: string) => key === archiveKey ? null : storage.getItem(key),
      setItem: storage.setItem,
    }
    expect(recoverPublicV7Root(failingReadback, 'stage', original, { archiveKey }))
      .toEqual({ status: 'archive-verification-failed' })
    expect(storage.writes).toEqual([archiveKey])
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(original.rootBytes)
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(original.stageBytes)
  })

  it.each([PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_STAGE_KEY, PUBLIC_V7_ROOT_KEY])(
    'keeps a verified archive when a %s publication write fails', (failedKey) => {
      const { v6Bytes, firstBytes } = v7Candidates()
      const storage = memoryStorage([
        [PUBLIC_V6_ROOT_KEY, v6Bytes],
        [PUBLIC_V7_ROOT_KEY, '{invalid root'], [PUBLIC_V7_STAGE_KEY, '{invalid stage'],
        [PUBLIC_V7_BACKUP_KEY, '{invalid backup'],
      ])
      // The selected valid candidate is installed as a backup for stage/root failures.
      if (failedKey !== PUBLIC_V7_BACKUP_KEY) storage.values.set(PUBLIC_V7_BACKUP_KEY, firstBytes)
      else storage.values.set(PUBLIC_V7_STAGE_KEY, firstBytes)
      const original = snapshot(storage)
      const source = failedKey === PUBLIC_V7_BACKUP_KEY ? 'stage' : 'backup'
      const failing = {
        getItem: storage.getItem,
        setItem: (key: string, bytes: string) => {
          if (key === failedKey) throw new Error('quota')
          storage.setItem(key, bytes)
        },
      }
      expect(recoverPublicV7Root(failing, source, original, { archiveKey }))
        .toEqual({ status: 'storage-error' })
      expect(JSON.parse(storage.values.get(archiveKey)!)).toMatchObject(original)
      expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe('{invalid root')
    },
  )

  it('honors the nested v6 import lineage when selecting a migrated v7 candidate', () => {
    const legacyKey = 'wizard-realms:world:v5'
    const legacyBytes = serializeWizardWorld(createGeneratedWorld('greenway-alpha'))
    const sourceStorage = memoryStorage([[legacyKey, legacyBytes]])
    const inspected = inspectLegacyImportSource(sourceStorage, 'greenway-classic-v1')
    if (inspected.status !== 'available') throw new Error(inspected.status)
    const imported = commitLegacyImportToPublicV6(sourceStorage, inspected)
    if (imported.status !== 'committed') throw new Error(imported.status)
    const v6Bytes = sourceStorage.values.get(PUBLIC_V6_ROOT_KEY)!
    const migrated = migratePublicV6ToV7(sourceStorage, v6Bytes)
    if (migrated.status !== 'committed') throw new Error(migrated.status)
    const forged = JSON.parse(migrated.bytes)
    forged.bootstrap.source.bytes = '{forged lineage'
    const forgedBytes = JSON.stringify(forged)
    expect(parsePublicV7PlayableRoot(forgedBytes)).toBeNull()
    const storage = memoryStorage([
      [legacyKey, legacyBytes], [PUBLIC_V6_ROOT_KEY, v6Bytes],
      [PUBLIC_V7_ROOT_KEY, '{invalid root'], [PUBLIC_V7_STAGE_KEY, forgedBytes],
      [PUBLIC_V7_BACKUP_KEY, migrated.bytes],
    ])
    const original = snapshot(storage)
    expect(recoverPublicV7Root(storage, 'stage', original, { archiveKey }))
      .toEqual({ status: 'invalid-source' })
    storage.values.set(PUBLIC_V6_ROOT_KEY, '{changed v6 source')
    expect(recoverPublicV7Root(storage, 'backup', original, { archiveKey }))
      .toEqual({ status: 'source-changed' })
    expect(storage.writes).toEqual([])
    storage.values.set(PUBLIC_V6_ROOT_KEY, v6Bytes)
    expect(recoverPublicV7Root(storage, 'backup', original, { archiveKey })).toMatchObject({
      status: 'recovered', bytes: migrated.bytes,
    })
    expect(storage.values.get(legacyKey)).toBe(legacyBytes)
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(v6Bytes)
    expect(JSON.parse(storage.values.get(archiveKey)!)).toMatchObject({ stageBytes: forgedBytes })
  })

  it('rejects older migrated stage and backup after a resolver publishes a root bound to newer v6', () => {
    const { v6Bytes, nextBytes } = v7Candidates()
    const oldV6 = parsePublicV6PlayableRoot(v6Bytes)
    const oldV7 = parsePublicV7PlayableRoot(nextBytes)
    if (!oldV6 || !oldV7) throw new Error('Expected migrated fixtures.')
    const newerV6Bytes = serializePublicV6World({ ...oldV6, saveRevision: oldV6.saveRevision + 1,
      state: { ...oldV6.state, player: { ...oldV6.state.player, coins: oldV6.state.player.coins + 7 } } })
    const newerRootBytes = serializePublicV7World({ ...oldV7, saveRevision: oldV7.saveRevision + 1,
      migrationSourceV6Bytes: newerV6Bytes })
    const storage = memoryStorage([
      [PUBLIC_V6_ROOT_KEY, newerV6Bytes],
      [PUBLIC_V7_ROOT_KEY, newerRootBytes], [PUBLIC_V7_STAGE_KEY, nextBytes],
      [PUBLIC_V7_BACKUP_KEY, nextBytes],
    ])
    const original = snapshot(storage)
    expect(recoverPublicV7Root(storage, 'stage', original, { archiveKey }))
      .toEqual({ status: 'source-changed' })
    expect(recoverPublicV7Root(storage, 'backup', original, { archiveKey }))
      .toEqual({ status: 'source-changed' })
    expect(storage.writes).toEqual([])
    expect(storage.values.has(archiveKey)).toBe(false)
    expect(recoverPublicV7Root(storage, 'root', original, { archiveKey })).toMatchObject({
      status: 'recovered', bytes: newerRootBytes,
    })
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(newerRootBytes)
    expect(JSON.parse(storage.values.get(archiveKey)!)).toMatchObject({
      selectedSource: 'root', ...original,
    })
  })

  it('rejects older fresh stage and backup when a later v6 fork has been bound to the root', () => {
    const freshStorage = memoryStorage()
    const fresh = commitPublicV7World(freshStorage,
      withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1')), null)
    if (fresh.status !== 'committed') throw new Error(fresh.status)
    const { v6Bytes } = v7Candidates()
    const boundRootBytes = serializePublicV7World({ ...fresh.root,
      saveRevision: fresh.root.saveRevision + 1, migrationSourceV6Bytes: v6Bytes })
    const storage = memoryStorage([
      [PUBLIC_V6_ROOT_KEY, v6Bytes],
      [PUBLIC_V7_ROOT_KEY, boundRootBytes], [PUBLIC_V7_STAGE_KEY, fresh.bytes],
      [PUBLIC_V7_BACKUP_KEY, fresh.bytes],
    ])
    const original = snapshot(storage)
    for (const source of ['stage', 'backup'] as const) {
      expect(recoverPublicV7Root(storage, source, original, { archiveKey }))
        .toEqual({ status: 'source-changed' })
    }
    expect(storage.writes).toEqual([])
    expect(storage.values.has(archiveKey)).toBe(false)
    expect(recoverPublicV7Root(storage, 'root', original, { archiveKey })).toMatchObject({
      status: 'recovered', bytes: boundRootBytes,
    })
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(boundRootBytes)
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(v6Bytes)
  })

  it('still promotes an ordinary fresh v7 pending save when no v6 root exists', () => {
    const storage = memoryStorage()
    const first = commitPublicV7World(storage,
      withFreshPublicV7Herbs(createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1')), null)
    if (first.status !== 'committed') throw new Error(first.status)
    const next = commitPublicV7World(storage, first.root.state, first.bytes)
    if (next.status !== 'committed') throw new Error(next.status)
    storage.values.set(PUBLIC_V7_ROOT_KEY, first.bytes)
    storage.writes.length = 0
    const original = snapshot(storage)
    expect(recoverPublicV7Root(storage, 'stage', original, { archiveKey })).toMatchObject({
      status: 'recovered', bytes: next.bytes,
    })
    expect(storage.writes).toEqual([archiveKey, PUBLIC_V7_STAGE_KEY, PUBLIC_V7_ROOT_KEY])
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(next.bytes)
  })
})
