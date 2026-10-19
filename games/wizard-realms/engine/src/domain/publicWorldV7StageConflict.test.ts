import { describe, expect, it } from 'vitest'
import {
  PUBLIC_V6_BACKUP_KEY, PUBLIC_V6_ROOT_KEY, PUBLIC_V6_STAGE_KEY, commitPublicV6World,
} from './publicWorldV6'
import {
  PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_STAGE_KEY, migratePublicV6ToV7,
} from './publicWorldV7'
import { createFreshPublicWorld } from './publicWorldState'
import { inspectPublicV7Entry, upgradePublicV6 } from './publicWorldV7Flow'
import type { PublicV7LockProvider } from './publicWorldV7Flow'
import {
  inspectPublicV7StaleStageConflict, readPublicV7StageConflictSnapshot, resolvePublicV7StaleStage,
} from './publicWorldV7StageConflict'

const archiveKey = 'wizard-realms:world:v7:stage-conflict-archive:00000000-0000-4000-8000-000000000001'
const retryArchiveKey = 'wizard-realms:world:v7:stage-conflict-archive:00000000-0000-4000-8000-000000000002'
const locks: PublicV7LockProvider = { request: async (_name, _options, callback) => callback() }

function memoryStorage(entries: readonly (readonly [string, string])[] = []) {
  const values = new Map(entries)
  const writes: string[] = []
  const removals: string[] = []
  return { values, writes, removals,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, bytes: string) => { writes.push(key); values.set(key, bytes) },
    removeItem: (key: string) => { removals.push(key); values.delete(key) },
  }
}

function fixture() {
  const source = memoryStorage()
  const oldV6 = commitPublicV6World(source,
    createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1'), null)
  if (oldV6.status !== 'committed') throw new Error(oldV6.status)
  const stage = migratePublicV6ToV7(source, oldV6.bytes)
  if (stage.status !== 'committed') throw new Error(stage.status)
  const current = memoryStorage()
  const newV6 = commitPublicV6World(current,
    createFreshPublicWorld('greenway-beta', 'greenway-classic-v1'), null)
  if (newV6.status !== 'committed') throw new Error(newV6.status)
  const storage = memoryStorage([
    [PUBLIC_V7_STAGE_KEY, stage.bytes], [PUBLIC_V6_ROOT_KEY, newV6.bytes],
    [PUBLIC_V6_STAGE_KEY, '{pending v6 stage'], [PUBLIC_V6_BACKUP_KEY, '{old v6 backup'],
  ])
  const read = readPublicV7StageConflictSnapshot(storage)
  if (read.status !== 'available') throw new Error(read.status)
  return { storage, snapshot: read.snapshot, oldV6Bytes: oldV6.bytes, newV6Bytes: newV6.bytes,
    stageBytes: stage.bytes }
}

describe('explicit stale v7 migration-stage resolution', () => {
  it('archives all six exact byte strings before removing stale v7 backup and stage', () => {
    const { storage, snapshot, newV6Bytes, stageBytes } = fixture()
    storage.values.set(PUBLIC_V7_BACKUP_KEY, stageBytes)
    const expected = readPublicV7StageConflictSnapshot(storage)
    if (expected.status !== 'available') throw new Error(expected.status)
    expect(inspectPublicV7StaleStageConflict(expected.snapshot)).toEqual({ status: 'eligible' })
    expect(resolvePublicV7StaleStage(storage, expected.snapshot, { archiveKey }))
      .toEqual({ status: 'resolved', archiveKey })
    expect(JSON.parse(storage.values.get(archiveKey)!)).toEqual({
      schemaVersion: 'wizard-world/v7-stage-conflict-archive', ...expected.snapshot,
    })
    expect(storage.writes).toEqual([archiveKey])
    expect(storage.removals).toEqual([PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_STAGE_KEY])
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBeUndefined()
    expect(storage.values.get(PUBLIC_V7_BACKUP_KEY)).toBeUndefined()
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBeUndefined()
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(newV6Bytes)
    expect(storage.values.get(PUBLIC_V6_STAGE_KEY)).toBe(snapshot.v6StageBytes)
    expect(storage.values.get(PUBLIC_V6_BACKUP_KEY)).toBe(snapshot.v6BackupBytes)
  })

  it('unblocks the v6 upgrade path after quarantining stale v7 stage and backup', async () => {
    const { storage, newV6Bytes, stageBytes } = fixture()
    storage.values.set(PUBLIC_V7_BACKUP_KEY, stageBytes)
    storage.values.delete(PUBLIC_V6_STAGE_KEY)
    storage.values.delete(PUBLIC_V6_BACKUP_KEY)
    const before = await inspectPublicV7Entry(storage, locks)
    expect(before.ok && before.value.stageConflict.status).toBe('eligible')
    if (!before.ok || before.value.stageConflict.status !== 'eligible') throw new Error('Expected conflict.')
    expect(resolvePublicV7StaleStage(storage, before.value.stageConflict.snapshot, { archiveKey }))
      .toEqual({ status: 'resolved', archiveKey })
    const after = await inspectPublicV7Entry(storage, locks)
    expect(after.ok && after.value.blockedReason).toBeNull()
    expect(after.ok && after.value.v6.status).toBe('valid-playable')
    expect(await upgradePublicV6(storage, locks, newV6Bytes)).toMatchObject({ ok: true })
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(newV6Bytes)
  })

  it('leaves the stage eligible for a second archived attempt when backup removal succeeds but stage removal fails', () => {
    const { storage, snapshot, stageBytes, newV6Bytes } = fixture()
    storage.values.set(PUBLIC_V7_BACKUP_KEY, stageBytes)
    const before = readPublicV7StageConflictSnapshot(storage)
    if (before.status !== 'available') throw new Error(before.status)
    const failing = { ...storage,
      removeItem: (key: string) => {
        if (key === PUBLIC_V7_STAGE_KEY) throw new Error('interrupted stage removal')
        storage.removeItem(key)
      },
    }
    expect(resolvePublicV7StaleStage(failing, before.snapshot, { archiveKey }))
      .toEqual({ status: 'storage-error' })
    expect(storage.values.get(PUBLIC_V7_BACKUP_KEY)).toBeUndefined()
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(stageBytes)
    expect(storage.values.get(archiveKey)).toBeDefined()
    const retry = readPublicV7StageConflictSnapshot(storage)
    if (retry.status !== 'available') throw new Error(retry.status)
    expect(inspectPublicV7StaleStageConflict(retry.snapshot)).toEqual({ status: 'eligible' })
    expect(resolvePublicV7StaleStage(storage, retry.snapshot, { archiveKey: retryArchiveKey }))
      .toEqual({ status: 'resolved', archiveKey: retryArchiveKey })
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(newV6Bytes)
    expect(storage.values.get(PUBLIC_V6_STAGE_KEY)).toBe(snapshot.v6StageBytes)
    expect(storage.values.get(PUBLIC_V6_BACKUP_KEY)).toBe(snapshot.v6BackupBytes)
  })

  it('requires a missing v7 root, valid pending migration stage, valid backup, and changed valid v6 source', () => {
    const { storage, snapshot, oldV6Bytes, stageBytes } = fixture()
    storage.values.set(PUBLIC_V6_ROOT_KEY, oldV6Bytes)
    const sameSource = readPublicV7StageConflictSnapshot(storage)
    if (sameSource.status !== 'available') throw new Error(sameSource.status)
    expect(inspectPublicV7StaleStageConflict(sameSource.snapshot))
      .toEqual({ status: 'source-not-changed' })
    expect(resolvePublicV7StaleStage(storage, sameSource.snapshot, { archiveKey }))
      .toEqual({ status: 'source-not-changed' })
    storage.values.set(PUBLIC_V6_ROOT_KEY, '{invalid v6')
    const badV6 = readPublicV7StageConflictSnapshot(storage)
    if (badV6.status !== 'available') throw new Error(badV6.status)
    expect(resolvePublicV7StaleStage(storage, badV6.snapshot, { archiveKey }))
      .toEqual({ status: 'invalid-v6-root' })
    storage.values.set(PUBLIC_V6_ROOT_KEY, snapshot.v6RootBytes!)
    for (const [key, bytes, status] of [
      [PUBLIC_V7_ROOT_KEY, stageBytes, 'root-present'],
      [PUBLIC_V7_STAGE_KEY, '{invalid stage', 'invalid-stage'],
      [PUBLIC_V7_BACKUP_KEY, '{invalid backup', 'invalid-backup'],
    ] as const) {
      storage.values.set(key, bytes)
      const read = readPublicV7StageConflictSnapshot(storage)
      if (read.status !== 'available') throw new Error(read.status)
      expect(resolvePublicV7StaleStage(storage, read.snapshot, { archiveKey })).toEqual({ status })
      if (key === PUBLIC_V7_STAGE_KEY) storage.values.set(key, stageBytes)
      else storage.values.delete(key)
    }
    const currentSource = memoryStorage([[PUBLIC_V6_ROOT_KEY, snapshot.v6RootBytes!]])
    const currentBackup = migratePublicV6ToV7(currentSource, snapshot.v6RootBytes!)
    if (currentBackup.status !== 'committed') throw new Error(currentBackup.status)
    storage.values.set(PUBLIC_V7_BACKUP_KEY, currentBackup.bytes)
    const protectedBackup = readPublicV7StageConflictSnapshot(storage)
    if (protectedBackup.status !== 'available') throw new Error(protectedBackup.status)
    expect(inspectPublicV7StaleStageConflict(protectedBackup.snapshot))
      .toEqual({ status: 'source-not-changed' })
    expect(storage.writes).toEqual([])
    expect(storage.removals).toEqual([])
  })

  it('rejects stale or malformed snapshots and occupied or malformed archive keys without deletion', () => {
    const { storage, snapshot } = fixture()
    expect(resolvePublicV7StaleStage(storage, { ...snapshot, extra: true } as never, { archiveKey }))
      .toEqual({ status: 'invalid-expected-snapshot' })
    storage.values.set(PUBLIC_V6_STAGE_KEY, 'changed after inspection')
    expect(resolvePublicV7StaleStage(storage, snapshot, { archiveKey }))
      .toEqual({ status: 'snapshot-changed' })
    storage.values.set(PUBLIC_V6_STAGE_KEY, snapshot.v6StageBytes!)
    expect(resolvePublicV7StaleStage(storage, snapshot, { archiveKey: 'not an archive key' }))
      .toEqual({ status: 'archive-key-invalid' })
    storage.values.set(archiveKey, 'existing archive')
    expect(resolvePublicV7StaleStage(storage, snapshot, { archiveKey }))
      .toEqual({ status: 'archive-key-present' })
    expect(storage.values.get(archiveKey)).toBe('existing archive')
    expect(storage.writes).toEqual([])
    expect(storage.removals).toEqual([])
  })

  it('never deletes before successful archive write and exact readback', () => {
    const { storage, snapshot, stageBytes } = fixture()
    const writeFails = { ...storage,
      setItem: () => { throw new Error('quota') },
    }
    expect(resolvePublicV7StaleStage(writeFails, snapshot, { archiveKey }))
      .toEqual({ status: 'storage-error' })
    const readbackFails = { ...storage,
      getItem: (key: string) => key === archiveKey ? null : storage.getItem(key),
    }
    expect(resolvePublicV7StaleStage(readbackFails, snapshot, { archiveKey }))
      .toEqual({ status: 'archive-verification-failed' })
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(stageBytes)
    expect(storage.removals).toEqual([])
  })

  it.each([PUBLIC_V6_ROOT_KEY, PUBLIC_V7_STAGE_KEY])(
    'retains the archived stage when %s changes during archival', (changedKey) => {
    const { storage, snapshot, stageBytes } = fixture()
    const raced = { ...storage,
      setItem: (key: string, bytes: string) => {
        storage.setItem(key, bytes)
        storage.values.set(changedKey, '{newer candidate')
      },
    }
    expect(resolvePublicV7StaleStage(raced, snapshot, { archiveKey }))
      .toEqual({ status: 'snapshot-changed' })
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(
      changedKey === PUBLIC_V7_STAGE_KEY ? '{newer candidate' : stageBytes)
    expect(storage.values.get(archiveKey)).toBeDefined()
    expect(storage.removals).toEqual([])
  })

  it('reports removal failures without touching v6 or claiming success', () => {
    const { storage, snapshot, newV6Bytes, stageBytes } = fixture()
    const noRemoval = { ...storage, removeItem: () => {} }
    expect(resolvePublicV7StaleStage(noRemoval, snapshot, { archiveKey }))
      .toEqual({ status: 'remove-verification-failed' })
    expect(storage.values.get(archiveKey)).toBeDefined()
    expect(storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(stageBytes)
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(newV6Bytes)
    const second = fixture()
    expect(resolvePublicV7StaleStage({ ...second.storage,
      removeItem: () => { throw new Error('storage unavailable') },
    }, second.snapshot, { archiveKey })).toEqual({ status: 'storage-error' })
    expect(second.storage.values.get(PUBLIC_V7_STAGE_KEY)).toBe(second.stageBytes)
    expect(second.storage.values.get(archiveKey)).toBeDefined()
  })
})
