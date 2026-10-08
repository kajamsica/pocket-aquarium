import { describe, expect, it } from 'vitest'
import { PUBLIC_V6_ROOT_KEY, commitPublicV6World } from './publicWorldV6'
import { createFreshPublicWorld } from './publicWorldState'
import {
  PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_STAGE_KEY,
  commitPublicV7World, migratePublicV6ToV7, withFreshPublicV7Herbs,
} from './publicWorldV7'
import { inspectV7SourceForV8 } from './publicWorldV8Source'

const state = createFreshPublicWorld('greenway-alpha', 'greenway-classic-v1')

function memoryStorage() {
  const values = new Map<string, string>()
  const writes: string[] = []
  return { values, writes,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, bytes: string) => { writes.push(key); values.set(key, bytes) },
  }
}

function freshV7() {
  const storage = memoryStorage()
  const saved = commitPublicV7World(storage, withFreshPublicV7Herbs(state), null)
  if (saved.status !== 'committed') throw new Error(saved.status)
  return { storage, saved }
}

function migratedV7() {
  const storage = memoryStorage()
  const v6 = commitPublicV6World(storage, state, null)
  if (v6.status !== 'committed') throw new Error(v6.status)
  const v7 = migratePublicV6ToV7(storage, v6.bytes)
  if (v7.status !== 'committed') throw new Error(v7.status)
  return { storage, v6, v7 }
}

describe('public v8 v7-source guard', () => {
  it('accepts exact unchanged bytes with settled stage and valid backup without writes', () => {
    const { storage, saved } = freshV7()
    const next = commitPublicV7World(storage, saved.root.state, saved.bytes)
    if (next.status !== 'committed') throw new Error(next.status)
    const before = new Map(storage.values)
    const writes = storage.writes.length
    expect(inspectV7SourceForV8(storage, next.bytes)).toEqual({ status: 'same', root: next.root })
    expect(storage.values).toEqual(before)
    expect(storage.writes).toHaveLength(writes)
  })

  it('rejects malformed expected bytes before reading storage', () => {
    const storage = { getItem: (_key: string): string | null => { throw new Error('read') } }
    expect(inspectV7SourceForV8(storage, '{bad')).toEqual({ status: 'invalid-expected-source' })
  })

  it('rejects a changed, missing, or differently encoded valid root', () => {
    const { storage, saved } = freshV7()
    storage.values.set(PUBLIC_V7_ROOT_KEY, JSON.stringify({ ...saved.root, saveRevision: 1 }))
    expect(inspectV7SourceForV8(storage, saved.bytes)).toEqual({ status: 'source-changed' })
    storage.values.set(PUBLIC_V7_ROOT_KEY, ` ${saved.bytes}`)
    expect(inspectV7SourceForV8(storage, saved.bytes)).toEqual({ status: 'source-changed' })
    storage.values.delete(PUBLIC_V7_ROOT_KEY)
    expect(inspectV7SourceForV8(storage, saved.bytes)).toEqual({ status: 'source-changed' })
  })

  it('distinguishes an invalid current root', () => {
    const { storage, saved } = freshV7()
    storage.values.set(PUBLIC_V7_ROOT_KEY, '{bad')
    expect(inspectV7SourceForV8(storage, saved.bytes)).toEqual({ status: 'invalid-v7-root' })
  })

  it('rejects nested v6 source divergence for a migrated root', () => {
    const { storage, v6, v7 } = migratedV7()
    expect(inspectV7SourceForV8(storage, v7.bytes)).toEqual({ status: 'same', root: v7.root })
    storage.values.set(PUBLIC_V6_ROOT_KEY, JSON.stringify({ ...v6.root, saveRevision: 1 }))
    expect(inspectV7SourceForV8(storage, v7.bytes)).toEqual({ status: 'source-changed' })
    expect(storage.values.get(PUBLIC_V7_ROOT_KEY)).toBe(v7.bytes)
  })

  it('rejects pending and invalid v7 stages', () => {
    const { storage, saved } = freshV7()
    for (const bytes of [JSON.stringify({ ...saved.root, saveRevision: 1 }), '{bad']) {
      storage.values.set(PUBLIC_V7_STAGE_KEY, bytes)
      expect(inspectV7SourceForV8(storage, saved.bytes)).toEqual({ status: 'pending-v7-stage' })
    }
  })

  it('rejects an invalid v7 backup', () => {
    const { storage, saved } = freshV7()
    storage.values.set(PUBLIC_V7_BACKUP_KEY, '{bad')
    expect(inspectV7SourceForV8(storage, saved.bytes)).toEqual({ status: 'invalid-v7-backup' })
  })

  it('reports storage errors for root, artifact, and nested v6 reads', () => {
    const { storage, saved } = freshV7()
    for (const failedKey of [PUBLIC_V7_ROOT_KEY, PUBLIC_V7_STAGE_KEY, PUBLIC_V7_BACKUP_KEY]) {
      const failing = { getItem: (key: string) => {
        if (key === failedKey) throw new Error('read')
        return storage.getItem(key)
      } }
      expect(inspectV7SourceForV8(failing, saved.bytes)).toEqual({ status: 'storage-error' })
    }
    const { storage: migrated, v7 } = migratedV7()
    const failing = { getItem: (key: string) => {
      if (key === PUBLIC_V6_ROOT_KEY) throw new Error('read')
      return migrated.getItem(key)
    } }
    expect(inspectV7SourceForV8(failing, v7.bytes)).toEqual({ status: 'storage-error' })
  })
})
