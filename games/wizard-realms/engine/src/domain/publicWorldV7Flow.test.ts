import { describe, expect, it } from 'vitest'
import { createGeneratedWorld } from './generation'
import { serializeWizardWorld } from './persistence'
import { createFreshPublicWorld } from './publicWorldState'
import { PUBLIC_V6_ROOT_KEY, PUBLIC_V6_STAGE_KEY, commitPublicV6World } from './publicWorldV6'
import { PUBLIC_V7_BACKUP_KEY, PUBLIC_V7_ROOT_KEY, PUBLIC_V7_STAGE_KEY, PUBLIC_V7_LOCK_NAME, PUBLIC_V7_SCHEMA, loadPublicV7Root,
  parsePublicV7PlayableRoot, serializePublicV7World, withFreshPublicV7Herbs } from './publicWorldV7'
import { readPublicV7RecoverySnapshot } from './publicWorldV7Recovery'
import { clearArchivedStaleV7Stage, commitPublicV7Snapshot, importLegacyToPublicV7, inspectPublicV7Entry,
  reconcilePublicV7FreshFork, reconcilePublicV7RootConflict, recoverPublicV7Snapshot, resumePublicV7, startFreshPublicV7, unsavedPublicV7Bytes,
  upgradePublicV6, type PublicV7LockProvider } from './publicWorldV7Flow'

const profile = 'greenway-classic-v1'
const legacyKey = 'wizard-realms:world:v5'
function memoryStorage() {
  const values = new Map<string, string>()
  const writes: string[] = []
  return { values, writes, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, bytes: string) => { writes.push(key); values.set(key, bytes) },
    removeItem: (key: string) => { writes.push(`removed:${key}`); values.delete(key) } }
}
function webLocks() {
  const names: string[] = []
  const provider: PublicV7LockProvider = { request: async (name, options, callback) => {
    names.push(name)
    expect(options).toEqual({ mode: 'exclusive' })
    return callback()
  } }
  return { provider, names }
}

describe('public v7 app storage flow', () => {
  it('starts, inspects, and resumes a fresh root through the shared lock', async () => {
    const storage = memoryStorage(); const { provider, names } = webLocks()
    const empty = await inspectPublicV7Entry(storage, provider)
    expect(empty.ok && empty.value.root.status).toBe('missing')
    const started = await startFreshPublicV7(storage, provider, profile, false)
    if (!started.ok) throw new Error(started.reason)
    expect(started.value.state.mireglass.herbHarvestCycles).toEqual([])
    expect(await resumePublicV7(storage, provider, started.value.bytes)).toEqual(started)
    const entry = await inspectPublicV7Entry(storage, provider)
    expect(entry.ok && entry.value.v6.status).toBe('skipped')
    expect(names.every((name) => name === PUBLIC_V7_LOCK_NAME)).toBe(true)
    expect(storage.writes).toEqual([PUBLIC_V7_STAGE_KEY, PUBLIC_V7_ROOT_KEY])
  })

  it('requires confirmation for a fresh start over legacy bytes and never writes without a lock', async () => {
    const storage = memoryStorage(); const { provider } = webLocks()
    const legacy = serializeWizardWorld(createGeneratedWorld('greenway-alpha', profile))
    storage.values.set(legacyKey, legacy)
    expect(await startFreshPublicV7(storage, provider, profile, false))
      .toEqual({ ok: false, reason: 'legacy-present' })
    expect(await startFreshPublicV7(storage, undefined, profile, true))
      .toEqual({ ok: false, reason: 'lock-unavailable' })
    const started = await startFreshPublicV7(storage, provider, profile, true)
    expect(started.ok).toBe(true)
    expect(storage.getItem(legacyKey)).toBe(legacy)
    expect(storage.writes).not.toContain(legacyKey)
  })

  it.each(['continue-v7', 'use-v6'] as const)('offers an archive-first choice for a fresh-v7/later-v6 fork: %s', async (choice) => {
    const storage = memoryStorage(); const { provider, names } = webLocks()
    const fresh = await startFreshPublicV7(storage, provider, profile, false)
    if (!fresh.ok) throw new Error(fresh.reason)
    const olderTab = createFreshPublicWorld('greenway-alpha', profile)
    olderTab.player.coins = 71
    const v6 = commitPublicV6World(storage, olderTab, null)
    if (v6.status !== 'committed') throw new Error(v6.status)
    const conflict = await inspectPublicV7Entry(storage, provider)
    expect(conflict.ok && conflict.value.blockedReason).toBe('source-changed')
    expect(conflict.ok && conflict.value.freshFork.status).toBe('eligible')
    expect(conflict.ok && conflict.value.rootConflict.status).toBe('unavailable')
    if (!conflict.ok || conflict.value.freshFork.status !== 'eligible') throw new Error('fork unavailable')
    const resolved = await reconcilePublicV7FreshFork(storage, provider, choice, conflict.value.freshFork.snapshot)
    if (!resolved.ok) throw new Error(resolved.reason)
    const archive = JSON.parse(storage.getItem(resolved.value.archiveKey)!)
    expect(archive.v7RootBytes).toBe(fresh.value.bytes)
    expect(archive.v6RootBytes).toBe(v6.bytes)
    const next = await inspectPublicV7Entry(storage, provider)
    expect(next.ok && next.value.blockedReason).toBeNull()
    expect(next.ok && next.value.root.status).toBe('valid-playable')
    expect(loadPublicV7Root(storage).status).toBe('valid-playable')
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(v6.bytes)
    expect(parsePublicV7PlayableRoot(storage.getItem(PUBLIC_V7_ROOT_KEY)!)?.migrationSourceV6Bytes).toBe(v6.bytes)
    if (choice === 'continue-v7') {
      expect(parsePublicV7PlayableRoot(storage.getItem(PUBLIC_V7_ROOT_KEY)!)?.state.player.coins)
        .toBe(fresh.value.state.player.coins)
    } else {
      expect(parsePublicV7PlayableRoot(storage.getItem(PUBLIC_V7_ROOT_KEY)!)?.state.player.coins).toBe(71)
    }
    expect(names.every((name) => name === PUBLIC_V7_LOCK_NAME)).toBe(true)
  })

  it('offers an interrupted fresh-v7 save as a third choice after an old v6 tab creates a root', async () => {
    const storage = memoryStorage(); const { provider } = webLocks()
    const fresh = await startFreshPublicV7(storage, provider, profile, false)
    if (!fresh.ok) throw new Error(fresh.reason)
    const pendingState = { ...fresh.value.state,
      player: { ...fresh.value.state.player, coins: fresh.value.state.player.coins + 5 } }
    const failAfterStage = { getItem: storage.getItem,
      setItem: (key: string, bytes: string) => {
        storage.setItem(key, bytes)
        if (key === PUBLIC_V7_STAGE_KEY) throw new Error('interrupted save')
      } }
    expect(await commitPublicV7Snapshot(failAfterStage, provider, pendingState, fresh.value.bytes))
      .toEqual({ ok: false, reason: 'storage-error' })
    const pendingBytes = storage.getItem(PUBLIC_V7_STAGE_KEY)!
    const oldTabState = createFreshPublicWorld('greenway-alpha', profile)
    oldTabState.player.coins = 71
    const v6 = commitPublicV6World(storage, oldTabState, null)
    if (v6.status !== 'committed') throw new Error(v6.status)
    const entry = await inspectPublicV7Entry(storage, provider)
    expect(entry.ok && entry.value.blockedReason).toBe('source-changed')
    if (!entry.ok || entry.value.freshFork.status !== 'eligible') throw new Error('fork unavailable')
    expect(entry.value.freshFork.choices).toEqual(['continue-v7', 'use-v7-stage', 'use-v6'])
    const resolved = await reconcilePublicV7FreshFork(storage, provider,
      'use-v7-stage', entry.value.freshFork.snapshot)
    if (!resolved.ok) throw new Error(resolved.reason)
    expect(JSON.parse(storage.getItem(resolved.value.archiveKey)!)).toMatchObject({
      v7RootBytes: fresh.value.bytes, v7StageBytes: pendingBytes, v6RootBytes: v6.bytes,
    })
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(v6.bytes)
    expect(parsePublicV7PlayableRoot(storage.getItem(PUBLIC_V7_ROOT_KEY)!)?.state.player.coins)
      .toBe(pendingState.player.coins)
    expect(storage.getItem(PUBLIC_V7_STAGE_KEY)).toBe(storage.getItem(PUBLIC_V7_ROOT_KEY))
    const resumed = await inspectPublicV7Entry(storage, provider)
    expect(resumed.ok && resumed.value.blockedReason).toBeNull()
  })

  it('recovers an initial fresh-v7 stage after its root write fails and a v6 tab starts', async () => {
    const storage = memoryStorage(); const { provider } = webLocks()
    const failRoot = { getItem: storage.getItem,
      setItem: (key: string, bytes: string) => {
        if (key === PUBLIC_V7_ROOT_KEY) throw new Error('root write failed')
        storage.setItem(key, bytes)
      } }
    expect(await startFreshPublicV7(failRoot, provider, profile, false))
      .toEqual({ ok: false, reason: 'storage-error' })
    const freshStage = storage.getItem(PUBLIC_V7_STAGE_KEY)!
    expect(storage.getItem(PUBLIC_V7_ROOT_KEY)).toBeNull()
    const v6State = createFreshPublicWorld('greenway-alpha', profile)
    v6State.player.coins = 71
    const v6 = commitPublicV6World(storage, v6State, null)
    if (v6.status !== 'committed') throw new Error(v6.status)
    const entry = await inspectPublicV7Entry(storage, provider)
    expect(entry.ok && entry.value.blockedReason).toBe('pending-v7-stage')
    if (!entry.ok || entry.value.freshFork.status !== 'eligible') throw new Error('fork unavailable')
    expect(entry.value.freshFork.choices).toEqual(['use-v7-stage', 'use-v6'])
    const resolved = await reconcilePublicV7FreshFork(storage, provider,
      'use-v7-stage', entry.value.freshFork.snapshot)
    if (!resolved.ok) throw new Error(resolved.reason)
    expect(JSON.parse(storage.getItem(resolved.value.archiveKey)!)).toMatchObject({
      v7RootBytes: null, v7StageBytes: freshStage, v6RootBytes: v6.bytes,
    })
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(v6.bytes)
    expect(parsePublicV7PlayableRoot(storage.getItem(PUBLIC_V7_ROOT_KEY)!)?.migrationSourceV6Bytes)
      .toBe(v6.bytes)
    expect(storage.getItem(PUBLIC_V7_STAGE_KEY)).toBe(storage.getItem(PUBLIC_V7_ROOT_KEY))
    const resumed = await inspectPublicV7Entry(storage, provider)
    expect(resumed.ok && resumed.value.blockedReason).toBeNull()
  })

  it('offers only v6 for an unrelated initial fresh stage, preserving the staged candidate in the archive', async () => {
    const storage = memoryStorage(); const { provider } = webLocks()
    const failRoot = { getItem: storage.getItem,
      setItem: (key: string, bytes: string) => {
        if (key === PUBLIC_V7_ROOT_KEY) throw new Error('root write failed')
        storage.setItem(key, bytes)
      } }
    expect(await startFreshPublicV7(failRoot, provider, profile, false))
      .toEqual({ ok: false, reason: 'storage-error' })
    const stage = storage.getItem(PUBLIC_V7_STAGE_KEY)
    const v6 = commitPublicV6World(storage, createFreshPublicWorld('other-seed', profile), null)
    if (v6.status !== 'committed') throw new Error(v6.status)
    const entry = await inspectPublicV7Entry(storage, provider)
    expect(entry.ok && entry.value.blockedReason).toBe('pending-v7-stage')
    if (!entry.ok || entry.value.freshFork.status !== 'eligible') throw new Error('fork unavailable')
    expect(entry.value.freshFork.choices).toEqual(['use-v6'])
    const resolved = await reconcilePublicV7FreshFork(storage, provider,
      'use-v6', entry.value.freshFork.snapshot)
    if (!resolved.ok) throw new Error(resolved.reason)
    expect(JSON.parse(storage.getItem(resolved.value.archiveKey)!)).toMatchObject({
      v7RootBytes: null, v7StageBytes: stage, v6RootBytes: v6.bytes,
    })
    expect(storage.getItem(PUBLIC_V7_STAGE_KEY)).toBe(storage.getItem(PUBLIC_V7_ROOT_KEY))
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(v6.bytes)
    expect(parsePublicV7PlayableRoot(storage.getItem(PUBLIC_V7_ROOT_KEY)!)?.state.seed).toBe('other-seed')
    const resumed = await inspectPublicV7Entry(storage, provider)
    expect(resumed.ok && resumed.value.blockedReason).toBeNull()
  })

  it('offers an explicit upgrade and keeps the exact v6 root intact', async () => {
    const storage = memoryStorage(); const { provider } = webLocks()
    const v6 = commitPublicV6World(storage, createFreshPublicWorld('greenway-alpha', profile), null)
    if (v6.status !== 'committed') throw new Error(v6.status)
    const entry = await inspectPublicV7Entry(storage, provider)
    expect(entry.ok && entry.value.v6.status).toBe('valid-playable')
    expect(await startFreshPublicV7(storage, provider, profile, false)).toEqual({ ok: false, reason: 'v6-present' })
    const upgraded = await upgradePublicV6(storage, provider, v6.bytes)
    if (!upgraded.ok) throw new Error(upgraded.reason)
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(v6.bytes)
    expect(parsePublicV7PlayableRoot(upgraded.value.bytes)?.migrationSourceV6Bytes).toBe(v6.bytes)
    expect(await resumePublicV7(storage, provider, upgraded.value.bytes)).toEqual(upgraded)
    const newerV6 = JSON.stringify({ ...v6.root, saveRevision: 1 })
    storage.values.set(PUBLIC_V6_ROOT_KEY, newerV6)
    storage.values.set(PUBLIC_V6_STAGE_KEY, newerV6)
    const changed = await inspectPublicV7Entry(storage, provider)
    expect(changed.ok && changed.value.blockedReason).toBe('source-changed')
    expect(changed.ok && changed.value.rootConflict.status).toBe('eligible')
    expect(await resumePublicV7(storage, provider, upgraded.value.bytes))
      .toEqual({ ok: false, reason: 'source-changed' })
    if (!changed.ok || changed.value.rootConflict.status !== 'eligible') throw new Error('conflict unavailable')
    const resolved = await reconcilePublicV7RootConflict(storage, provider, 'continue-v7', changed.value.rootConflict.snapshot)
    expect(resolved.ok).toBe(true)
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(newerV6)
    expect(loadPublicV7Root(storage).status).toBe('valid-playable')
  })

  it('offers the pending v7 save as a distinct choice after an older v6 tab advances', async () => {
    const storage = memoryStorage(); const { provider } = webLocks()
    const v6 = commitPublicV6World(storage, createFreshPublicWorld('greenway-alpha', profile), null)
    if (v6.status !== 'committed') throw new Error(v6.status)
    const upgraded = await upgradePublicV6(storage, provider, v6.bytes)
    if (!upgraded.ok) throw new Error(upgraded.reason)
    const pendingState = { ...upgraded.value.state,
      player: { ...upgraded.value.state.player, coins: upgraded.value.state.player.coins + 5 } }
    const failAfterStage = { getItem: storage.getItem,
      setItem: (key: string, bytes: string) => {
        storage.setItem(key, bytes)
        if (key === PUBLIC_V7_STAGE_KEY) throw new Error('interrupted save')
      } }
    expect(await commitPublicV7Snapshot(failAfterStage, provider, pendingState, upgraded.value.bytes))
      .toEqual({ ok: false, reason: 'storage-error' })
    const stagedBytes = storage.getItem(PUBLIC_V7_STAGE_KEY)!
    expect(stagedBytes).not.toBe(upgraded.value.bytes)
    const newerV6 = commitPublicV6World(storage, { ...v6.root.state,
      player: { ...v6.root.state.player, coins: v6.root.state.player.coins + 9 },
    }, v6.bytes)
    if (newerV6.status !== 'committed') throw new Error(newerV6.status)
    const entry = await inspectPublicV7Entry(storage, provider)
    expect(entry.ok && entry.value.blockedReason).toBe('source-changed')
    expect(entry.ok && entry.value.rootConflict.status).toBe('eligible')
    if (!entry.ok || entry.value.rootConflict.status !== 'eligible') throw new Error('conflict unavailable')
    expect(entry.value.rootConflict.choices).toEqual(['continue-v7', 'use-v7-stage', 'use-newer-v6'])
    const resolved = await reconcilePublicV7RootConflict(storage, provider,
      'use-v7-stage', entry.value.rootConflict.snapshot)
    if (!resolved.ok) throw new Error(resolved.reason)
    expect(JSON.parse(storage.getItem(resolved.value.archiveKey)!)).toMatchObject({
      v7RootBytes: upgraded.value.bytes, v7StageBytes: stagedBytes, v6RootBytes: newerV6.bytes,
    })
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(newerV6.bytes)
    expect(parsePublicV7PlayableRoot(storage.getItem(PUBLIC_V7_ROOT_KEY)!)?.state.player.coins)
      .toBe(pendingState.player.coins)
    expect(storage.getItem(PUBLIC_V7_STAGE_KEY)).toBe(storage.getItem(PUBLIC_V7_ROOT_KEY))
    const resumed = await inspectPublicV7Entry(storage, provider)
    expect(resumed.ok && resumed.value.blockedReason).toBeNull()
  })

  it('allows root or v6 reconciliation when pending v7 artifacts are invalid', async () => {
    const storage = memoryStorage(); const { provider } = webLocks()
    const v6 = commitPublicV6World(storage, createFreshPublicWorld('greenway-alpha', profile), null)
    if (v6.status !== 'committed') throw new Error(v6.status)
    const upgraded = await upgradePublicV6(storage, provider, v6.bytes)
    if (!upgraded.ok) throw new Error(upgraded.reason)
    storage.values.set(PUBLIC_V7_STAGE_KEY, '{invalid stage')
    storage.values.set(PUBLIC_V7_BACKUP_KEY, '{invalid backup')
    const newerV6 = JSON.stringify({ ...v6.root, saveRevision: v6.root.saveRevision + 1 })
    storage.values.set(PUBLIC_V6_ROOT_KEY, newerV6)
    storage.values.set(PUBLIC_V6_STAGE_KEY, newerV6)
    const entry = await inspectPublicV7Entry(storage, provider)
    expect(entry.ok && entry.value.rootConflict.status).toBe('eligible')
    if (!entry.ok || entry.value.rootConflict.status !== 'eligible') throw new Error('conflict unavailable')
    expect(entry.value.rootConflict.choices).toEqual(['continue-v7', 'use-newer-v6'])
    const resolved = await reconcilePublicV7RootConflict(storage, provider,
      'continue-v7', entry.value.rootConflict.snapshot)
    if (!resolved.ok) throw new Error(resolved.reason)
    expect(JSON.parse(storage.getItem(resolved.value.archiveKey)!)).toMatchObject({
      v7StageBytes: '{invalid stage', v7BackupBytes: '{invalid backup',
    })
    expect((await inspectPublicV7Entry(storage, provider)).ok).toBe(true)
    expect(loadPublicV7Root(storage).status).toBe('valid-playable')
  })

  it('imports legacy through a lossless v6 receipt before making v7 playable', async () => {
    const storage = memoryStorage(); const { provider } = webLocks()
    const legacy = createGeneratedWorld('greenway-alpha', profile); legacy.player.coins = 77
    const bytes = serializeWizardWorld(legacy); storage.values.set(legacyKey, bytes)
    const entry = await inspectPublicV7Entry(storage, provider)
    if (!entry.ok || entry.value.classic.status !== 'available') throw new Error('legacy unavailable')
    const imported = await importLegacyToPublicV7(storage, provider, entry.value.classic)
    if (!imported.ok) throw new Error(imported.reason)
    expect(imported.value.state.player.coins).toBe(77)
    expect(storage.getItem(legacyKey)).toBe(bytes)
    expect(parsePublicV7PlayableRoot(imported.value.bytes)?.bootstrap?.source.bytes).toBe(bytes)
    expect(storage.writes).not.toContain(legacyKey)
  })

  it('rejects a stale save and produces a valid unsaved export', async () => {
    const storage = memoryStorage(); const { provider } = webLocks()
    const started = await startFreshPublicV7(storage, provider, profile, false)
    if (!started.ok) throw new Error(started.reason)
    const current = await commitPublicV7Snapshot(storage, provider, started.value.state, started.value.bytes)
    if (!current.ok) throw new Error(current.reason)
    expect(await commitPublicV7Snapshot(storage, provider, started.value.state, started.value.bytes))
      .toEqual({ ok: false, reason: 'root-changed' })
    const exported = unsavedPublicV7Bytes(started.value.state, current.value.bytes)
    expect(parsePublicV7PlayableRoot(exported ?? '')?.saveRevision).toBe(2)
    expect(storage.getItem(PUBLIC_V7_ROOT_KEY)).toBe(current.value.bytes)
  })

  it('does not fall back to v6 when v7 is invalid or staged', async () => {
    const storage = memoryStorage(); const { provider } = webLocks()
    const v6 = commitPublicV6World(storage, createFreshPublicWorld('greenway-alpha', profile), null)
    if (v6.status !== 'committed') throw new Error(v6.status)
    storage.values.set(PUBLIC_V7_ROOT_KEY, '{bad')
    const invalid = await inspectPublicV7Entry(storage, provider)
    expect(invalid.ok && invalid.value.blockedReason).toBe('invalid-v7-root')
    expect(invalid.ok && invalid.value.v6.status).toBe('skipped')
    expect(await upgradePublicV6(storage, provider, v6.bytes)).toEqual({ ok: false, reason: 'invalid-v7-root' })
    storage.values.delete(PUBLIC_V7_ROOT_KEY); storage.values.set(PUBLIC_V7_STAGE_KEY, '{bad')
    const staged = await inspectPublicV7Entry(storage, provider)
    expect(staged.ok && staged.value.blockedReason).toBe('pending-v7-stage')
    expect(staged.ok && staged.value.v6.status).toBe('skipped')
    storage.values.delete(PUBLIC_V7_STAGE_KEY); storage.values.set(PUBLIC_V6_STAGE_KEY, '{bad')
    expect((await inspectPublicV7Entry(storage, provider)).ok).toBe(true)
    expect(await upgradePublicV6(storage, provider, v6.bytes)).toEqual({ ok: false, reason: 'pending-v6-stage' })
  })

  it('archives a stale stage before returning to explicit upgrade of newer v6 progress', async () => {
    const storage = memoryStorage(); const { provider } = webLocks()
    const v6 = commitPublicV6World(storage, createFreshPublicWorld('greenway-alpha', profile), null)
    if (v6.status !== 'committed') throw new Error(v6.status)
    const staleStage = serializePublicV7World({ schemaVersion: PUBLIC_V7_SCHEMA,
      saveRevision: 0, bootstrap: v6.root.bootstrap, migrationSourceV6Bytes: v6.bytes,
      state: withFreshPublicV7Herbs(v6.root.state) })
    storage.values.set(PUBLIC_V7_STAGE_KEY, staleStage)
    const newerV6 = JSON.stringify({ ...v6.root, saveRevision: 1 })
    storage.values.set(PUBLIC_V6_ROOT_KEY, newerV6)
    storage.values.set(PUBLIC_V6_STAGE_KEY, newerV6)
    const conflict = await inspectPublicV7Entry(storage, provider)
    expect(conflict.ok && conflict.value.stageConflict.status).toBe('eligible')
    if (!conflict.ok || conflict.value.stageConflict.status !== 'eligible') throw new Error('stale stage unavailable')
    const cleared = await clearArchivedStaleV7Stage(storage, provider, conflict.value.stageConflict.snapshot)
    if (!cleared.ok) throw new Error(cleared.reason)
    expect(JSON.parse(storage.getItem(cleared.value.archiveKey)!).v7StageBytes).toBe(staleStage)
    expect(storage.getItem(PUBLIC_V7_STAGE_KEY)).toBeNull()
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(newerV6)
    const next = await inspectPublicV7Entry(storage, provider)
    expect(next.ok && next.value.v6.status).toBe('valid-playable')
    const upgraded = await upgradePublicV6(storage, provider, newerV6)
    expect(upgraded.ok).toBe(true)
  })

  it('recovers a valid v7 backup under the lock and archives the invalid root', async () => {
    const storage = memoryStorage(); const { provider, names } = webLocks()
    const started = await startFreshPublicV7(storage, provider, profile, false)
    if (!started.ok) throw new Error(started.reason)
    const saved = await commitPublicV7Snapshot(storage, provider, started.value.state, started.value.bytes)
    if (!saved.ok) throw new Error(saved.reason)
    storage.values.set(PUBLIC_V7_ROOT_KEY, '{bad')
    const before = readPublicV7RecoverySnapshot(storage)
    if (before.status !== 'available') throw new Error(before.status)
    const recovered = await recoverPublicV7Snapshot(storage, provider, 'backup', before.snapshot)
    if (!recovered.ok) throw new Error(recovered.reason)
    expect(storage.getItem(recovered.value.archiveKey)).toContain('"rootBytes":"{bad"')
    expect(loadPublicV7Root(storage).status).toBe('valid-playable')
    expect(names.every((name) => name === PUBLIC_V7_LOCK_NAME)).toBe(true)
  })
})
