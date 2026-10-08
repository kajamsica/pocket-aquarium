import { describe, expect, it } from 'vitest'
import { intentForView } from './App'
import { mireglassActionChoices } from './MireglassPlayableApp'
import { createGeneratedWorld } from './domain/generation'
import { mireglassAnchors } from './domain/mireglassContent'
import { actPublicMireglass } from './domain/publicWorldActions'
import { createFreshPublicWorld } from './domain/publicWorldState'
import { PUBLIC_V6_BACKUP_KEY, PUBLIC_V6_ROOT_KEY, PUBLIC_V6_SCHEMA, PUBLIC_V6_STAGE_KEY,
  loadPublicV6Root, parsePublicV6PlayableRoot, readPublicV6RecoverySnapshot, serializePublicV6World } from './domain/publicWorldV6'
import { serializeWizardWorld } from './domain/persistence'
import { createFixedInputClock, createTimedMovementSampler, recordTimedMovement, sampleFixedInputBatch } from './view/timedInput'
import {
  PUBLIC_V6_LOCK_NAME, advancePublicControls, commitPublicSnapshot, greenwayForPublicView,
  importPublicWorld, inspectPublicEntry, mireglassForPublicView, publicRecoveryChoices,
  recoverPublicWorld, resumePublicWorld, startFreshPublicWorld, unsavedPublicWorldBytes,
  type PublicLockProvider,
} from './PublicWizardApp'

const seed = 'greenway-alpha'
const legacyKey = 'wizard-realms:world:v5'
function memoryStorage() {
  const values = new Map<string, string>()
  const writes: string[] = []
  return { values, writes, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push(key); values.set(key, value) } }
}
function webLocks() {
  const names: string[] = []
  const provider: PublicLockProvider = { request: async (_name, options, callback) => {
    names.push(_name)
    expect(options).toEqual({ mode: 'exclusive' })
    return callback()
  } }
  return { provider, names }
}

describe('public v6 app boundary', () => {
  it('holds first Greenway entry behind an explicit start and resumes its validated root', async () => {
    const storage = memoryStorage()
    const { provider, names } = webLocks()
    const entry = await inspectPublicEntry(storage, provider)
    expect(entry.ok && entry.value.root.status).toBe('missing')
    expect(storage.writes).toEqual([])
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.value.state.movementOwner).toBe('greenway')
    expect(loadPublicV6Root(storage).status).toBe('valid-playable')
    const resumed = await resumePublicWorld(storage, provider, started.value.bytes)
    expect(resumed).toEqual(started)
    expect(names.every((name) => name === PUBLIC_V6_LOCK_NAME)).toBe(true)
    expect(storage.writes).not.toContain(legacyKey)
  })

  it('imports a legacy Greenway only after selection and never rewrites v5 bytes', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    const legacy = createGeneratedWorld(seed, 'greenway-classic-v1')
    legacy.player.coins = 77
    const bytes = serializeWizardWorld(legacy)
    storage.values.set(legacyKey, bytes)
    const entry = await inspectPublicEntry(storage, provider)
    expect(entry.ok).toBe(true)
    if (!entry.ok || entry.value.classic.status !== 'available') return
    expect(storage.writes).toEqual([])
    const imported = await importPublicWorld(storage, provider, entry.value.classic)
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.value.state.player.coins).toBe(77)
    expect(storage.getItem(legacyKey)).toBe(bytes)
    expect(storage.writes).not.toContain(legacyKey)
    const root = loadPublicV6Root(storage)
    expect(root.status).toBe('valid-playable')
    if (root.status === 'valid-playable') expect(root.root.bootstrap?.source.bytes).toBe(bytes)
  })

  it('requires explicit confirmation for a new world when any legacy save exists', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    storage.values.set(legacyKey, serializeWizardWorld(createGeneratedWorld(seed)))
    const denied = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(denied).toEqual({ ok: false, reason: 'legacy-present' })
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBeNull()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', true)
    expect(started.ok).toBe(true)
    expect(storage.writes).not.toContain(legacyKey)
  })

  it('keeps Greenway UI actions separate from one sampled look-and-move frame', () => {
    const state = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const equip = intentForView(greenwayForPublicView(state),
      { type: 'equipment.equip', stackId: 'inventory-woodcutters_axe', slot: 'mainHand' })
    expect(equip).toEqual({ type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' })
    const result = advancePublicControls(state, [[equip!]], [[-1, 1]])
    expect(result.rejections).toEqual([])
    expect(result.state.player.equipment.mainHand).toBe('woodcutters_axe')
    expect(result.state.tick).toBe(state.tick + 2)
    expect(result.events.map((event) => event.type)).toEqual(expect.arrayContaining(['item_equipped', 'player_looked', 'player_moved']))
    expect(result.state.player.position).not.toEqual(state.player.position)
  })

  it('commits a queued action even when blur arrives before the next movement sample', () => {
    const state = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const result = advancePublicControls(state,
      [[{ type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' }]], [])
    expect(result.rejections).toEqual([])
    expect(result.events.map((event) => event.type)).toContain('item_equipped')
    expect(result.state.player.equipment.mainHand).toBe('woodcutters_axe')
    expect(result.state.tick).toBe(state.tick + 1)
  })

  it('uses timestamped Mireglass movement and authoritative nearby action results', () => {
    const fresh = createFreshPublicWorld(seed, 'greenway-classic-v1')
    const marker = mireglassAnchors(seed).fringeMarker.tile
    const state = { ...fresh, movementOwner: 'streamed' as const,
      player: { ...fresh.player, position: { ...marker.center } },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds, marker.id])].sort() }
    const choice = mireglassActionChoices(mireglassForPublicView(state))
      .find((candidate) => candidate.action.type === 'study_fringe_marker')
    expect(choice).toBeDefined()
    const studied = actPublicMireglass(state, choice!.action)
    expect(studied.event?.type).toBe('fringe_marker_studied')
    const sampler = createTimedMovementSampler(0)
    const clock = createFixedInputClock(0)
    recordTimedMovement(sampler, 10, [1, 0])
    recordTimedMovement(sampler, 210, [0, 0])
    const samples = sampleFixedInputBatch(sampler, clock, 1_200, 50, 12)
    const turned = advancePublicControls(studied.state, [], samples)
    expect(turned.rejections).toEqual([])
    expect(turned.state.movementOwner).toBe('streamed')
    expect(turned.state.player.yaw).toBeCloseTo(studied.state.player.yaw - 0.52)
    expect(turned.state.tick).toBe(studied.state.tick + 12)
    const walked = advancePublicControls(studied.state, [], [[0, 1]])
    expect(walked.rejections).toEqual([])
    expect(walked.events.map((event) => event.type)).toContain('player_moved')
    expect(walked.state.player.position).not.toEqual(studied.state.player.position)
  })

  it('blocks stale cross-tab saves and unsupported Web Locks without touching v5', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const stepped = advancePublicControls(started.value.state, [], [[0, 1]])
    const current = await commitPublicSnapshot(storage, provider, stepped.state, started.value.bytes)
    expect(current.ok).toBe(true)
    const stale = await commitPublicSnapshot(storage, provider, stepped.state, started.value.bytes)
    expect(stale).toEqual({ ok: false, reason: 'root-changed' })
    const noLocks = await commitPublicSnapshot(storage, undefined, stepped.state,
      current.ok ? current.value.bytes : started.value.bytes)
    expect(noLocks.ok).toBe(false)
    expect(storage.writes).not.toContain(legacyKey)
  })

  it('exports a valid standalone snapshot of unsaved progress without changing storage or state', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const progressed = advancePublicControls(started.value.state, [], [[0, 1]]).state
    const beforeState = JSON.stringify(progressed)
    const beforeWrites = [...storage.writes]
    const exported = unsavedPublicWorldBytes(progressed, started.value.bytes)
    const parsed = exported ? parsePublicV6PlayableRoot(exported) : null
    expect(parsed?.state).toEqual(progressed)
    expect(parsed?.saveRevision).toBe(1)
    expect(storage.writes).toEqual(beforeWrites)
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(started.value.bytes)
    expect(JSON.stringify(progressed)).toBe(beforeState)
    expect(unsavedPublicWorldBytes(progressed, null)).toBeNull()
    expect(unsavedPublicWorldBytes(progressed, '{invalid root')).toBeNull()
  })

  it('preserves a pending stage and refuses to resume or import across it', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    storage.values.set('wizard-realms:world:v6:stage', 'unfinished-other-save')
    const resumed = await resumePublicWorld(storage, provider, started.value.bytes)
    expect(resumed).toEqual({ ok: false, reason: 'pending-stage' })
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(started.value.bytes)
    expect(storage.getItem('wizard-realms:world:v6:stage')).toBe('unfinished-other-save')
  })

  it('offers validated pending stage and committed root as explicit choices, then archives before promoting stage', async () => {
    const storage = memoryStorage()
    const { provider, names } = webLocks()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const root = loadPublicV6Root(storage)
    expect(root.status).toBe('valid-playable')
    if (root.status !== 'valid-playable') return
    const moved = advancePublicControls(root.root.state, [], [[0, 1]])
    const stagedBytes = serializePublicV6World({ schemaVersion: PUBLIC_V6_SCHEMA,
      saveRevision: root.root.saveRevision + 1, bootstrap: root.root.bootstrap, state: moved.state })
    storage.values.set(PUBLIC_V6_STAGE_KEY, stagedBytes)
    const entry = await inspectPublicEntry(storage, provider)
    expect(entry.ok).toBe(true)
    if (!entry.ok || entry.value.recovery.status !== 'available') return
    expect(publicRecoveryChoices(entry.value.recovery.snapshot).map((choice) => choice.source))
      .toEqual(expect.arrayContaining(['root', 'stage']))
    const recovered = await recoverPublicWorld(storage, provider, 'stage', entry.value.recovery.snapshot)
    expect(recovered.ok).toBe(true)
    if (!recovered.ok) return
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(stagedBytes)
    expect(storage.getItem(PUBLIC_V6_STAGE_KEY)).toBe(stagedBytes)
    expect(JSON.parse(storage.getItem(recovered.value.archiveKey)!)).toMatchObject({
      selectedSource: 'stage', rootBytes: started.value.bytes, stageBytes: stagedBytes,
    })
    expect(names.every((name) => name === PUBLIC_V6_LOCK_NAME)).toBe(true)
    const reread = await inspectPublicEntry(storage, provider)
    expect(reread.ok && reread.value.root.status).toBe('valid-playable')
    expect(reread.ok && reread.value.artifacts.status === 'available'
      && reread.value.artifacts.stage.status).toBe('settled')
  })

  it('recovers invalid root from a verified backup without discarding the invalid bytes', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    storage.values.set(PUBLIC_V6_BACKUP_KEY, started.value.bytes)
    storage.values.set(PUBLIC_V6_ROOT_KEY, '{corrupt root')
    const entry = await inspectPublicEntry(storage, provider)
    expect(entry.ok).toBe(true)
    if (!entry.ok || entry.value.recovery.status !== 'available') return
    expect(entry.value.root.status).toBe('invalid')
    expect(publicRecoveryChoices(entry.value.recovery.snapshot).map((choice) => choice.source))
      .toEqual(['stage', 'backup'])
    const recovered = await recoverPublicWorld(storage, provider, 'backup', entry.value.recovery.snapshot)
    expect(recovered.ok).toBe(true)
    if (!recovered.ok) return
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(started.value.bytes)
    expect(storage.getItem(PUBLIC_V6_STAGE_KEY)).toBe(started.value.bytes)
    expect(JSON.parse(storage.getItem(recovered.value.archiveKey)!)).toMatchObject({
      selectedSource: 'backup', rootBytes: '{corrupt root', backupBytes: started.value.bytes,
    })
    expect(storage.writes).not.toContain(legacyKey)
  })

  it('refuses a stale displayed choice without archive or save writes', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const inspected = readPublicV6RecoverySnapshot(storage)
    expect(inspected.status).toBe('available')
    if (inspected.status !== 'available') return
    storage.values.set(PUBLIC_V6_STAGE_KEY, '{changed in another tab')
    const before = [...storage.writes]
    const refused = await recoverPublicWorld(storage, provider, 'root', inspected.snapshot)
    expect(refused).toEqual({ ok: false, reason: 'snapshot-changed' })
    expect(storage.writes).toEqual(before)
    expect(storage.getItem(PUBLIC_V6_STAGE_KEY)).toBe('{changed in another tab')
    expect([...storage.values.keys()].some((key) => key.includes(':archive:'))).toBe(false)
  })

  it('does not mutate bytes for an invalid candidate, missing lock, or storage failure', async () => {
    const storage = memoryStorage()
    const { provider } = webLocks()
    const started = await startFreshPublicWorld(storage, provider, 'greenway-classic-v1', false)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const inspected = readPublicV6RecoverySnapshot(storage)
    expect(inspected.status).toBe('available')
    if (inspected.status !== 'available') return
    const before = [...storage.writes]
    expect(await recoverPublicWorld(storage, provider, 'backup', inspected.snapshot))
      .toEqual({ ok: false, reason: 'invalid-source' })
    expect(await recoverPublicWorld(storage, undefined, 'root', inspected.snapshot))
      .toEqual({ ok: false, reason: 'lock-unavailable' })
    expect(await recoverPublicWorld({ getItem: storage.getItem, setItem: () => { throw Error('quota') } },
      provider, 'root', inspected.snapshot)).toEqual({ ok: false, reason: 'storage-error' })
    expect(storage.writes).toEqual(before)
    expect(storage.getItem(PUBLIC_V6_ROOT_KEY)).toBe(started.value.bytes)
  })
})
