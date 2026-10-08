import { describe, expect, it } from 'vitest'
import { intentForView } from './App'
import { mireglassActionChoices } from './MireglassPlayableApp'
import { createGeneratedWorld } from './domain/generation'
import { mireglassAnchors } from './domain/mireglassContent'
import { actPublicMireglass } from './domain/publicWorldActions'
import { createFreshPublicWorld } from './domain/publicWorldState'
import { PUBLIC_V6_ROOT_KEY, loadPublicV6Root } from './domain/publicWorldV6'
import { serializeWizardWorld } from './domain/persistence'
import { createFixedInputClock, createTimedMovementSampler, recordTimedMovement, sampleFixedInputBatch } from './view/timedInput'
import {
  PUBLIC_V6_LOCK_NAME, advancePublicControls, commitPublicSnapshot, greenwayForPublicView,
  importPublicWorld, inspectPublicEntry, mireglassForPublicView, resumePublicWorld, startFreshPublicWorld,
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
})
