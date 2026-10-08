import { describe, expect, it } from 'vitest'
import { createGeneratedWorld } from './generation'
import { serializeWizardWorld } from './persistence'
import {
  PUBLIC_V6_BACKUP_KEY, PUBLIC_V6_ROOT_KEY, PUBLIC_V6_STAGE_KEY, commitLegacyImportToPublicV6,
  commitPublicV6World, inspectLegacyImportSource,
} from './publicWorldV6'
import { createFreshPublicWorld } from './publicWorldState'
import {
  PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_STAGE_KEY,
  commitPublicV7World, loadPublicV7Root, migratePublicV6ToV7, serializePublicV7World,
} from './publicWorldV7'
import { readPublicV7RecoverySnapshot, recoverPublicV7Root } from './publicWorldV7Recovery'
import {
  inspectPublicV7RootConflictSnapshot, readPublicV7RootConflictSnapshot,
  resolvePublicV7RootConflict,
} from './publicWorldV7RootConflict'

const archiveKey = 'wizard-realms:world:v7:source-conflict-archive:00000000-0000-4000-8000-000000000001'
const retryArchiveKey = 'wizard-realms:world:v7:source-conflict-archive:00000000-0000-4000-8000-000000000003'
const recoveryArchiveKey = 'wizard-realms:world:v7:archive:00000000-0000-4000-8000-000000000002'
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

function fixture() {
  const storage = memoryStorage()
  const originalV6 = commitPublicV6World(storage, createFreshPublicWorld(seed, profile), null)
  if (originalV6.status !== 'committed') throw new Error(originalV6.status)
  const migrated = migratePublicV6ToV7(storage, originalV6.bytes)
  if (migrated.status !== 'committed') throw new Error(migrated.status)
  const v7Progress = commitPublicV7World(storage, migrated.root.state, migrated.bytes)
  if (v7Progress.status !== 'committed') throw new Error(v7Progress.status)
  const newerV6 = commitPublicV6World(storage, {
    ...originalV6.root.state,
    player: { ...originalV6.root.state.player, coins: originalV6.root.state.player.coins + 7 },
  }, originalV6.bytes)
  if (newerV6.status !== 'committed') throw new Error(newerV6.status)
  storage.writes.length = 0
  const read = readPublicV7RootConflictSnapshot(storage)
  if (read.status !== 'available') throw new Error(read.status)
  return { storage, snapshot: read.snapshot, originalV6, newerV6, v7Progress }
}

describe('explicit migrated v7 versus newer v6 root choice', () => {
  it('offers choices only on a valid six-key divergent snapshot', () => {
    const { snapshot } = fixture()
    expect(inspectPublicV7RootConflictSnapshot(snapshot)).toEqual({
      status: 'available', choices: ['continue-v7', 'use-newer-v6'],
    })
    expect(inspectPublicV7RootConflictSnapshot({ ...snapshot, extra: true }))
      .toEqual({ status: 'invalid-expected-snapshot' })
    expect(inspectPublicV7RootConflictSnapshot({ ...snapshot,
      v6RootBytes: JSON.stringify({ ...JSON.parse(snapshot.v6RootBytes!), saveRevision: 0 }),
    })).toEqual({ status: 'not-newer-v6' })
  })

  it('archives all six original byte strings then keeps the v7 state with a rebased receipt', () => {
    const { storage, snapshot, newerV6, v7Progress } = fixture()
    const result = resolvePublicV7RootConflict(storage, 'continue-v7', snapshot, { archiveKey })
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.root.saveRevision).toBe(v7Progress.root.saveRevision + 1)
    expect(result.root.state).toEqual(v7Progress.root.state)
    expect(result.root.migrationSourceV6Bytes).toBe(newerV6.bytes)
    expect(storage.writes).toEqual([
      archiveKey, PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_STAGE_KEY,
    ])
    expect(JSON.parse(storage.values.get(archiveKey)!)).toEqual({
      schemaVersion: 'wizard-world/v7-source-conflict-archive', choice: 'continue-v7', ...snapshot,
    })
    expect(storage.values.get(PUBLIC_V7_BACKUP_KEY)).toBe(snapshot.v7RootBytes)
    expect(loadPublicV7Root(storage)).toEqual({ status: 'valid-playable', root: result.root, bytes: result.bytes })
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(snapshot.v6RootBytes)
    expect(storage.values.get(PUBLIC_V6_STAGE_KEY)).toBe(snapshot.v6StageBytes)
    expect(storage.values.get(PUBLIC_V6_BACKUP_KEY)).toBe(snapshot.v6BackupBytes)
  })

  it('archives the divergent v7 root then chooses the newer v6 state', () => {
    const { storage, snapshot, newerV6, v7Progress } = fixture()
    const result = resolvePublicV7RootConflict(storage, 'use-newer-v6', snapshot, { archiveKey })
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.root.saveRevision).toBe(v7Progress.root.saveRevision + 1)
    expect(result.root.state.player.coins).toBe(newerV6.root.state.player.coins)
    expect(result.root.state.mireglass.herbHarvestCycles).toEqual([])
    expect(result.root.migrationSourceV6Bytes).toBe(newerV6.bytes)
    expect(JSON.parse(storage.values.get(archiveKey)!)).toMatchObject({
      choice: 'use-newer-v6', v7RootBytes: snapshot.v7RootBytes,
    })
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(newerV6.bytes)
    expect(loadPublicV7Root(storage).status).toBe('valid-playable')
  })

  it('rejects stale snapshots, incompatible seed, and a fresh v7 fork without writes', () => {
    const { storage, snapshot, originalV6 } = fixture()
    storage.values.set(PUBLIC_V7_ROOT_KEY, '{changed')
    expect(resolvePublicV7RootConflict(storage, 'continue-v7', snapshot, { archiveKey }))
      .toEqual({ status: 'snapshot-changed' })
    storage.values.set(PUBLIC_V7_ROOT_KEY, snapshot.v7RootBytes!)
    const other = commitPublicV6World(memoryStorage(), createFreshPublicWorld('other-seed', profile), null)
    if (other.status !== 'committed') throw new Error(other.status)
    expect(inspectPublicV7RootConflictSnapshot({ ...snapshot, v6RootBytes: other.bytes }))
      .toEqual({ status: 'incompatible-lineage' })
    const freshStorage = memoryStorage()
    const fresh = commitPublicV7World(freshStorage, {
      ...originalV6.root.state,
      mireglass: { ...originalV6.root.state.mireglass, herbHarvestCycles: [] },
    }, null)
    if (fresh.status !== 'committed') throw new Error(fresh.status)
    expect(inspectPublicV7RootConflictSnapshot({ ...snapshot, v7RootBytes: fresh.bytes }))
      .toEqual({ status: 'not-source-conflict' })
    expect(storage.writes).toEqual([])
  })

  it('rejects a different valid bootstrap lineage even with the same seed', () => {
    const { storage, snapshot } = fixture()
    const importedStorage = memoryStorage([[
      'wizard-realms:world:v5', serializeWizardWorld(createGeneratedWorld(seed, profile)),
    ]])
    const source = inspectLegacyImportSource(importedStorage, profile)
    if (source.status !== 'available') throw new Error(source.status)
    const imported = commitLegacyImportToPublicV6(importedStorage, source)
    if (imported.status !== 'committed') throw new Error(imported.status)
    const newer = commitPublicV6World(importedStorage,
      createFreshPublicWorld(seed, profile), importedStorage.values.get(PUBLIC_V6_ROOT_KEY)!)
    if (newer.status !== 'committed') throw new Error(newer.status)
    expect(inspectPublicV7RootConflictSnapshot({ ...snapshot, v6RootBytes: newer.bytes }))
      .toEqual({ status: 'incompatible-lineage' })
    expect(storage.writes).toEqual([])
  })

  it('offers a distinct compatible newer stage and archives it before selecting its progress', () => {
    const { storage, snapshot, v7Progress } = fixture()
    const stageBytes = serializePublicV7World({ ...v7Progress.root,
      saveRevision: v7Progress.root.saveRevision + 1,
      state: { ...v7Progress.root.state, player: { ...v7Progress.root.state.player,
        coins: v7Progress.root.state.player.coins + 4 } },
    })
    storage.values.set(PUBLIC_V7_STAGE_KEY, stageBytes)
    const pending = { ...snapshot, v7StageBytes: stageBytes }
    expect(inspectPublicV7RootConflictSnapshot(pending)).toEqual({ status: 'available',
      choices: ['continue-v7', 'use-v7-stage', 'use-newer-v6'] })
    const result = resolvePublicV7RootConflict(storage, 'use-v7-stage', pending, { archiveKey })
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.root.state.player.coins).toBe(v7Progress.root.state.player.coins + 4)
    expect(result.root.saveRevision).toBe(v7Progress.root.saveRevision + 2)
    expect(JSON.parse(storage.values.get(archiveKey)!)).toMatchObject({ v7StageBytes: stageBytes })
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(result.bytes)
  })

  it('archives invalid pending stage and backup while offering safe root and v6 choices', () => {
    const { storage, snapshot } = fixture()
    expect(inspectPublicV7RootConflictSnapshot({ ...snapshot, v7StageBytes: '{pending' }))
      .toEqual({ status: 'available', choices: ['continue-v7', 'use-newer-v6'] })
    expect(inspectPublicV7RootConflictSnapshot({ ...snapshot, v7BackupBytes: '{invalid' }))
      .toEqual({ status: 'available', choices: ['continue-v7', 'use-newer-v6'] })
    expect(inspectPublicV7RootConflictSnapshot({ ...snapshot, v6StageBytes: '{pending' }))
      .toEqual({ status: 'available', choices: ['continue-v7', 'use-newer-v6'] })
    expect(inspectPublicV7RootConflictSnapshot({ ...snapshot, v6BackupBytes: '{invalid' }))
      .toEqual({ status: 'available', choices: ['continue-v7', 'use-newer-v6'] })
    storage.values.set(PUBLIC_V7_STAGE_KEY, '{pending')
    storage.values.set(PUBLIC_V7_BACKUP_KEY, '{invalid')
    const damaged = { ...snapshot, v7StageBytes: '{pending', v7BackupBytes: '{invalid' }
    expect(resolvePublicV7RootConflict(storage, 'use-v7-stage', damaged, { archiveKey }))
      .toEqual({ status: 'invalid-choice' })
    expect(storage.writes).toEqual([])
    const resolved = resolvePublicV7RootConflict(storage, 'use-newer-v6', damaged, { archiveKey })
    expect(resolved.status).toBe('resolved')
    expect(JSON.parse(storage.values.get(archiveKey)!)).toMatchObject({
      v7StageBytes: '{pending', v7BackupBytes: '{invalid',
    })
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(storage.values.get(PUBLIC_V7_ROOT_KEY))
  })

  it('does not publish any candidate if archive write/readback fails or key is occupied', () => {
    const { storage, snapshot } = fixture()
    storage.values.set(archiveKey, 'previous')
    expect(resolvePublicV7RootConflict(storage, 'continue-v7', snapshot, { archiveKey }))
      .toEqual({ status: 'archive-key-present' })
    storage.values.delete(archiveKey)
    const failedWrite = { getItem: storage.getItem,
      setItem: (key: string, bytes: string) => {
        if (key === archiveKey) throw new Error('quota')
        storage.setItem(key, bytes)
      } }
    expect(resolvePublicV7RootConflict(failedWrite, 'continue-v7', snapshot, { archiveKey }))
      .toEqual({ status: 'storage-error' })
    const failedReadback = { getItem: (key: string) => key === archiveKey ? null : storage.getItem(key),
      setItem: storage.setItem }
    expect(resolvePublicV7RootConflict(failedReadback, 'continue-v7', snapshot, { archiveKey }))
      .toEqual({ status: 'archive-verification-failed' })
    expect(storage.writes).toEqual([archiveKey])
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(snapshot.v7RootBytes)
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(snapshot.v6RootBytes)
  })

  it('rechecks all six keys after archive readback before touching stage, backup, or root', () => {
    const { storage, snapshot } = fixture()
    const racingStorage = { getItem: storage.getItem,
      setItem: (key: string, bytes: string) => {
        storage.setItem(key, bytes)
        if (key === archiveKey) storage.values.set(PUBLIC_V6_ROOT_KEY, '{raced v6 root')
      } }
    expect(resolvePublicV7RootConflict(racingStorage, 'use-newer-v6', snapshot, { archiveKey }))
      .toEqual({ status: 'snapshot-changed', archiveKey })
    expect(storage.writes).toEqual([archiveKey])
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(snapshot.v7RootBytes)
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(snapshot.v7StageBytes)
  })

  it.each([PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_ROOT_KEY])(
    'keeps the original conflict retryable if %s throws before writing', (failedKey) => {
      const { storage, snapshot } = fixture()
      const failing = { getItem: storage.getItem,
        setItem: (key: string, bytes: string) => {
          if (key === failedKey) throw new Error('quota')
          storage.setItem(key, bytes)
        } }
      expect(resolvePublicV7RootConflict(failing, 'continue-v7', snapshot, { archiveKey }))
        .toEqual({ status: 'storage-error', archiveKey })
      expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(snapshot.v7RootBytes)
      expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(snapshot.v7StageBytes)
      const retry = readPublicV7RootConflictSnapshot(storage)
      expect(retry.status).toBe('available')
      if (retry.status === 'available') expect(inspectPublicV7RootConflictSnapshot(retry.snapshot).status).toBe('available')
      expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(snapshot.v6RootBytes)
      expect(storage.writes[0]).toBe(archiveKey)
      expect(storage.writes).not.toContain(PUBLIC_V7_STAGE_KEY)
    },
  )

  it('keeps the conflict retryable if backup readback is inconsistent after its write', () => {
    const { storage, snapshot } = fixture()
    let backupWritten = false
    let lied = false
    const inconsistent = { getItem: (key: string) => {
      if (key === PUBLIC_V7_BACKUP_KEY && backupWritten && !lied) { lied = true; return '{wrong readback' }
      return storage.getItem(key)
    }, setItem: (key: string, bytes: string) => {
      storage.setItem(key, bytes)
      if (key === PUBLIC_V7_BACKUP_KEY) backupWritten = true
    } }
    expect(resolvePublicV7RootConflict(inconsistent, 'continue-v7', snapshot, { archiveKey }))
      .toEqual({ status: 'backup-verification-failed', archiveKey })
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(snapshot.v7RootBytes)
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(snapshot.v7StageBytes)
    const retry = readPublicV7RootConflictSnapshot(storage)
    expect(retry.status).toBe('available')
    if (retry.status === 'available') expect(inspectPublicV7RootConflictSnapshot(retry.snapshot).status).toBe('available')
  })

  it('archives a corrupted backup from an earlier failed attempt before retrying', () => {
    const { storage, snapshot } = fixture()
    let corrupted = false
    const failing = { getItem: storage.getItem,
      setItem: (key: string, bytes: string) => {
        storage.setItem(key, bytes)
        if (key === PUBLIC_V7_BACKUP_KEY && !corrupted) {
          corrupted = true
          storage.values.set(PUBLIC_V7_BACKUP_KEY, '{corrupted backup')
        }
      } }
    expect(resolvePublicV7RootConflict(failing, 'continue-v7', snapshot, { archiveKey }))
      .toEqual({ status: 'backup-verification-failed', archiveKey })
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(snapshot.v7RootBytes)
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(snapshot.v7StageBytes)
    const retry = readPublicV7RootConflictSnapshot(storage)
    if (retry.status !== 'available') throw new Error(retry.status)
    expect(inspectPublicV7RootConflictSnapshot(retry.snapshot).status).toBe('available')
    expect(resolvePublicV7RootConflict(storage, 'continue-v7', retry.snapshot,
      { archiveKey: retryArchiveKey }).status).toBe('resolved')
    expect(JSON.parse(storage.values.get(retryArchiveKey)!)).toMatchObject({
      v7BackupBytes: '{corrupted backup',
    })
  })

  it('keeps the old stage settled when the v6 source advances after backup write', () => {
    const { storage, snapshot, newerV6 } = fixture()
    const evenNewerBytes = JSON.stringify({ ...newerV6.root, saveRevision: newerV6.root.saveRevision + 1 })
    const racing = { getItem: storage.getItem,
      setItem: (key: string, bytes: string) => {
        storage.setItem(key, bytes)
        if (key === PUBLIC_V7_BACKUP_KEY) {
          storage.values.set(PUBLIC_V6_ROOT_KEY, evenNewerBytes)
          storage.values.set(PUBLIC_V6_STAGE_KEY, evenNewerBytes)
        }
      } }
    expect(resolvePublicV7RootConflict(racing, 'continue-v7', snapshot, { archiveKey }))
      .toEqual({ status: 'snapshot-changed', archiveKey })
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(snapshot.v7RootBytes)
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(snapshot.v7StageBytes)
    const retry = readPublicV7RootConflictSnapshot(storage)
    expect(retry.status).toBe('available')
    if (retry.status === 'available') expect(inspectPublicV7RootConflictSnapshot(retry.snapshot).status).toBe('available')
    expect(JSON.parse(storage.values.get(archiveKey)!)).toMatchObject(snapshot)
  })

  it('can retry when v6 advances after the new v7 root publishes but before stage settles', () => {
    const { storage, snapshot, newerV6 } = fixture()
    const evenNewerBytes = JSON.stringify({ ...newerV6.root, saveRevision: newerV6.root.saveRevision + 1 })
    const racing = { getItem: storage.getItem,
      setItem: (key: string, bytes: string) => {
        storage.setItem(key, bytes)
        if (key === PUBLIC_V7_ROOT_KEY) {
          storage.values.set(PUBLIC_V6_ROOT_KEY, evenNewerBytes)
          storage.values.set(PUBLIC_V6_STAGE_KEY, evenNewerBytes)
        }
      } }
    expect(resolvePublicV7RootConflict(racing, 'continue-v7', snapshot, { archiveKey }))
      .toEqual({ status: 'snapshot-changed', archiveKey })
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(snapshot.v7StageBytes)
    const retry = readPublicV7RootConflictSnapshot(storage)
    if (retry.status !== 'available') throw new Error(retry.status)
    expect(inspectPublicV7RootConflictSnapshot(retry.snapshot)).toMatchObject({ status: 'available' })
    expect(resolvePublicV7RootConflict(storage, 'continue-v7', retry.snapshot,
      { archiveKey: retryArchiveKey }).status).toBe('resolved')
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(storage.values.get(PUBLIC_V7_ROOT_KEY))
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(evenNewerBytes)
  })

  it('offers ordinary explicit v7 root recovery if final stage settlement fails', () => {
    const { storage, snapshot } = fixture()
    const failing = { getItem: storage.getItem,
      setItem: (key: string, bytes: string) => {
        if (key === PUBLIC_V7_STAGE_KEY) throw new Error('quota')
        storage.setItem(key, bytes)
      } }
    expect(resolvePublicV7RootConflict(failing, 'use-newer-v6', snapshot, { archiveKey }))
      .toEqual({ status: 'storage-error', archiveKey })
    expect(loadPublicV7Root(storage).status).toBe('valid-playable')
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(snapshot.v7StageBytes)
    const recovery = readPublicV7RecoverySnapshot(storage)
    if (recovery.status !== 'available') throw new Error(recovery.status)
    expect(recoverPublicV7Root(storage, 'root', recovery.snapshot, { archiveKey: recoveryArchiveKey }).status)
      .toBe('recovered')
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(storage.values.get(PUBLIC_V7_ROOT_KEY))
  })

  it('offers ordinary v7 recovery if root readback mismatches after publication', () => {
    const { storage, snapshot } = fixture()
    let rootWritten = false
    let lied = false
    const inconsistent = { getItem: (key: string) => {
      if (key === PUBLIC_V7_ROOT_KEY && rootWritten && !lied) { lied = true; return '{wrong readback' }
      return storage.getItem(key)
    }, setItem: (key: string, bytes: string) => {
      storage.setItem(key, bytes)
      if (key === PUBLIC_V7_ROOT_KEY) rootWritten = true
    } }
    expect(resolvePublicV7RootConflict(inconsistent, 'continue-v7', snapshot, { archiveKey }))
      .toEqual({ status: 'root-verification-failed', archiveKey })
    expect(loadPublicV7Root(storage).status).toBe('valid-playable')
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(snapshot.v7StageBytes)
    const recovery = readPublicV7RecoverySnapshot(storage)
    if (recovery.status !== 'available') throw new Error(recovery.status)
    expect(recoverPublicV7Root(storage, 'root', recovery.snapshot, { archiveKey: recoveryArchiveKey }).status)
      .toBe('recovered')
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(storage.values.get(PUBLIC_V7_ROOT_KEY))
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(snapshot.v6RootBytes)
  })
})
