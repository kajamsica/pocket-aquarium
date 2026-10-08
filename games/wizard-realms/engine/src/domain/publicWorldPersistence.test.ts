import { describe, expect, it } from 'vitest'
import { createGeneratedWorld, terrainHeightAt } from './generation'
import { isRestorableWizardSave, serializeWizardWorld } from './persistence'
import {
  PUBLIC_V6_BACKUP_KEY, PUBLIC_V6_ROOT_KEY, PUBLIC_V6_STAGE_KEY,
  commitLegacyImportToPublicV6, commitPublicV6World, inspectLegacyImportSource,
  inspectPublicV6Artifacts, loadPublicV6Root, parsePublicV6PlayableRoot, serializePublicV6World,
} from './publicWorldV6'
import { createFreshPublicWorld, createPublicWorldFromBootstrap } from './publicWorldState'
import { createStreamedWorld } from './streamedWorld'
import type { PublicWorldState } from './publicWorldState'

const seed = 'greenway-alpha'
const classic = 'greenway-classic-v1'
const expanded = 'greenway-expanded-v1'
const classicKey = 'wizard-realms:world:v5'
const expandedKey = 'wizard-realms:world:expanded:v4'

function memoryStorage(entries: readonly (readonly [string, string])[] = []) {
  const values = new Map(entries)
  const writes: string[] = []
  return {
    values, writes,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, bytes: string) => { writes.push(key); values.set(key, bytes) },
  }
}

function imported(storage: ReturnType<typeof memoryStorage>, profile: typeof classic | typeof expanded) {
  const inspected = inspectLegacyImportSource(storage, profile)
  expect(inspected.status).toBe('available')
  if (inspected.status !== 'available') throw new Error('Expected legacy import.')
  const result = commitLegacyImportToPublicV6(storage, inspected)
  expect(result.status).toBe('committed')
  if (result.status !== 'committed') throw new Error('Expected committed bootstrap.')
  return result.root
}

describe('public v6 playable persistence', () => {
  it('round-trips a fresh world with one player and monotonically increasing revisions', () => {
    const storage = memoryStorage()
    const state = createFreshPublicWorld(seed, classic)
    const first = commitPublicV6World(storage, state, null)
    expect(first.status).toBe('committed')
    if (first.status !== 'committed') throw new Error('Expected first public save.')
    expect(first.root.saveRevision).toBe(0)
    expect(first.root.bootstrap).toBeNull()
    expect(Object.hasOwn(first.root.state.greenway, 'player')).toBe(false)
    expect(parsePublicV6PlayableRoot(first.bytes)).toEqual(first.root)
    expect(serializePublicV6World(first.root)).toBe(first.bytes)
    expect(loadPublicV6Root(storage)).toEqual({ status: 'valid-playable', root: first.root, bytes: first.bytes })
    const second = commitPublicV6World(storage, state, first.bytes)
    expect(second.status).toBe('committed')
    if (second.status !== 'committed') throw new Error('Expected second public save.')
    expect(second.root.saveRevision).toBe(1)
    expect(storage.values.get(PUBLIC_V6_BACKUP_KEY)).toBe(first.bytes)
    expect(inspectPublicV6Artifacts(storage)).toMatchObject({
      status: 'available', stage: { status: 'settled', bytes: second.bytes },
      backup: { status: 'available', bytes: first.bytes },
    })
  })

  it('upgrades an expanded x=-30 import without streamed preflight or loss of source bytes', () => {
    const world = createGeneratedWorld(seed, expanded)
    world.player.position = { x: -30, y: terrainHeightAt(world.tiles, -30, 0), z: 0 }
    world.player.coins = 73
    const sourceBytes = serializeWizardWorld(world)
    const storage = memoryStorage([[expandedKey, sourceBytes]])
    const bootstrap = imported(storage, expanded)
    const state = createPublicWorldFromBootstrap(bootstrap)
    expect(state.movementOwner).toBe('greenway')
    const expected = storage.values.get(PUBLIC_V6_ROOT_KEY)!
    const result = commitPublicV6World(storage, state, expected)
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('Expected playable import.')
    expect(result.root.bootstrap?.source.bytes).toBe(sourceBytes)
    expect(result.root.bootstrap?.greenwaySaveBytes).toBe(bootstrap.greenwaySaveBytes)
    expect(result.root.state.player.position).toEqual(world.player.position)
    expect(storage.values.get(expandedKey)).toBe(sourceBytes)
    expect(storage.values.get(PUBLIC_V6_BACKUP_KEY)).toBe(expected)
    const inspected = inspectLegacyImportSource(storage, expanded)
    expect(inspected.status).toBe('available')
    if (inspected.status === 'available') {
      expect(commitLegacyImportToPublicV6(storage, inspected)).toEqual({ status: 'root-present' })
    }
  })

  it('validates a streamed owner through streamed restore and current-tile discovery', () => {
    const state = createFreshPublicWorld(seed, classic)
    const streamed = createStreamedWorld(seed, { x: -32, z: 0 }).state
    const away: PublicWorldState = {
      ...state, movementOwner: 'streamed', player: { ...state.player, position: streamed.player.position },
      discoveredTileIds: [...new Set([...state.discoveredTileIds, ...streamed.discoveredTileIds])].sort(),
    }
    const storage = memoryStorage()
    const saved = commitPublicV6World(storage, away, null)
    expect(saved.status).toBe('committed')
    if (saved.status !== 'committed') throw new Error('Expected streamed-owner save.')
    expect(saved.root.state.movementOwner).toBe('streamed')
    const missingCurrentTile = { ...away, discoveredTileIds: [...state.discoveredTileIds] }
    expect(parsePublicV6PlayableRoot(JSON.stringify({ ...saved.root, state: missingCurrentTile }))).toBeNull()
  })

  it('rejects forged detached/player/region state without changing the valid root', () => {
    const state = createFreshPublicWorld(seed, classic)
    const storage = memoryStorage()
    const first = commitPublicV6World(storage, state, null)
    expect(first.status).toBe('committed')
    if (first.status !== 'committed') throw new Error('Expected valid public root.')
    const forged: unknown[] = [
      { ...state, greenway: { ...state.greenway, player: state.player } },
      { ...state, greenway: { ...state.greenway, tiles: [] } },
      { ...state, greenway: { ...state.greenway, tiles: null } },
      { ...state, player: { ...state.player, equipment: { ...state.player.equipment, feet: 'mireglass_reach/item/seal' } } },
      { ...state, mireglass: { ...state.mireglass, cacheExcavated: true } },
      { ...state, movementOwner: 'greenway', player: { ...state.player, position: { x: -100, y: 3, z: 0 } } },
      { ...state, movementOwner: 'streamed', discoveredTileIds: [] },
    ]
    for (const candidate of forged) {
      expect(commitPublicV6World(storage, candidate as PublicWorldState, first.bytes)).toEqual({ status: 'invalid-state' })
      expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(first.bytes)
    }
    expect(storage.writes).toEqual([PUBLIC_V6_STAGE_KEY, PUBLIC_V6_ROOT_KEY])
  })

  it('round-trips legitimate region rewards and equipped waders without a v5 player copy', () => {
    const base = createFreshPublicWorld(seed, classic)
    const state: PublicWorldState = {
      ...base,
      player: {
        ...base.player, xp: 50, level: 1,
        inventory: [...base.player.inventory,
          { itemId: 'mireglass_reach/item/waders', quantity: 1 },
          { itemId: 'mireglass_reach/item/seal', quantity: 1 }],
        equipment: { ...base.player.equipment, feet: 'mireglass_reach/item/waders' },
        learnedSpellIds: ['wayfinder_glow'],
        skillXp: { ...base.player.skillXp, wayfinding: 10, spellcraft: 10, excavation: 40 },
      },
      mireglass: {
        ...base.mireglass, fringeMarkerStudied: true, cacheRevealed: true, cacheExcavated: true,
        shopStock: { ...base.mireglass.shopStock, 'mireglass_reach/item/waders': 1 },
      },
    }
    const saved = commitPublicV6World(memoryStorage(), state, null)
    expect(saved.status).toBe('committed')
    if (saved.status !== 'committed') throw new Error('Expected region reward save.')
    expect(saved.root.state.player.equipment.feet).toBe('mireglass_reach/item/waders')
    expect(saved.root.state.player.inventory.map((entry) => entry.itemId)).toContain('mireglass_reach/item/seal')
    expect(Object.hasOwn(saved.root.state.greenway, 'player')).toBe(false)
    expect(parsePublicV6PlayableRoot(saved.bytes)?.state).toEqual(state)
  })

  it('accepts Mireglass level gain before v5 recipe unlock without persisting a witness player', () => {
    const world = createGeneratedWorld(seed, classic)
    world.player.xp = 60
    world.player.level = 1
    world.player.skillXp.construction = 60
    world.builtRouteIds = ['greenway_ladder']
    world.routes[0].siteId = 'greenway_ladder:x:0'
    const bytes = serializeWizardWorld(world)
    expect(isRestorableWizardSave(bytes, classic)).toBe(true)
    const storage = memoryStorage([[classicKey, bytes]])
    const bootstrap = imported(storage, classic)
    const state = createPublicWorldFromBootstrap(bootstrap)
    const gained = { ...state, player: { ...state.player, xp: 110, level: 2 } }
    const result = commitPublicV6World(storage, gained, storage.values.get(PUBLIC_V6_ROOT_KEY)!)
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('Expected level-lag save.')
    expect(result.root.state.player.level).toBe(2)
    expect(result.root.state.greenway.unlockedRecipeIds).not.toContain('highland_bridge')
    expect(Object.hasOwn(result.root.state.greenway, 'player')).toBe(false)
  })

  it('refuses stale expected bytes and never overwrites a root another tab advanced', () => {
    const storage = memoryStorage()
    const state = createFreshPublicWorld(seed, classic)
    const first = commitPublicV6World(storage, state, null)
    expect(first.status).toBe('committed')
    if (first.status !== 'committed') throw new Error('Expected first save.')
    const second = commitPublicV6World(storage, state, first.bytes)
    expect(second.status).toBe('committed')
    if (second.status !== 'committed') throw new Error('Expected second save.')
    const writesBefore = [...storage.writes]
    expect(commitPublicV6World(storage, state, first.bytes)).toEqual({ status: 'root-changed' })
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(second.bytes)
    expect(storage.writes).toEqual(writesBefore)
  })

  it('rechecks exact root bytes after staging before publishing over another tab', () => {
    const storage = memoryStorage()
    const state = createFreshPublicWorld(seed, classic)
    const first = commitPublicV6World(storage, state, null)
    expect(first.status).toBe('committed')
    if (first.status !== 'committed') throw new Error('Expected first save.')
    const otherTabBytes = serializePublicV6World({ ...first.root, saveRevision: 2 })
    const raced = {
      getItem: storage.getItem,
      setItem: (key: string, bytes: string) => {
        storage.setItem(key, bytes)
        if (key === PUBLIC_V6_STAGE_KEY) storage.values.set(PUBLIC_V6_ROOT_KEY, otherTabBytes)
      },
    }
    expect(commitPublicV6World(raced, state, first.bytes)).toEqual({ status: 'root-changed' })
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(otherTabBytes)
    expect(storage.values.has(PUBLIC_V6_BACKUP_KEY)).toBe(false)
    expect(inspectPublicV6Artifacts(storage)).toMatchObject({ status: 'available', stage: { status: 'pending' } })
  })

  it.each([PUBLIC_V6_STAGE_KEY, PUBLIC_V6_BACKUP_KEY, PUBLIC_V6_ROOT_KEY])(
    'keeps the prior root when %s write fails and exposes pending stage', (failedKey) => {
      const storage = memoryStorage()
      const state = createFreshPublicWorld(seed, classic)
      const first = commitPublicV6World(storage, state, null)
      expect(first.status).toBe('committed')
      if (first.status !== 'committed') throw new Error('Expected first save.')
      const failing = {
        getItem: storage.getItem,
        setItem: (key: string, bytes: string) => {
          if (key === failedKey) throw new Error('quota')
          storage.setItem(key, bytes)
        },
      }
      expect(commitPublicV6World(failing, state, first.bytes)).toEqual({ status: 'storage-error' })
      expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(first.bytes)
      expect(storage.values.get(PUBLIC_V6_BACKUP_KEY)).toBe(failedKey === PUBLIC_V6_ROOT_KEY ? first.bytes : undefined)
      expect(inspectPublicV6Artifacts(storage)).toMatchObject({
        status: 'available', stage: { status: failedKey === PUBLIC_V6_STAGE_KEY ? 'settled' : 'pending' },
      })
    },
  )

  it('does not publish when backup readback differs', () => {
    const storage = memoryStorage()
    const state = createFreshPublicWorld(seed, classic)
    const first = commitPublicV6World(storage, state, null)
    expect(first.status).toBe('committed')
    if (first.status !== 'committed') throw new Error('Expected first save.')
    const corruptReadback = {
      getItem: (key: string) => key === PUBLIC_V6_BACKUP_KEY ? '{corrupt}' : storage.getItem(key),
      setItem: storage.setItem,
    }
    expect(commitPublicV6World(corruptReadback, state, first.bytes)).toEqual({ status: 'backup-verification-failed' })
    expect(storage.values.get(PUBLIC_V6_ROOT_KEY)).toBe(first.bytes)
    expect(inspectPublicV6Artifacts(storage)).toMatchObject({ status: 'available', stage: { status: 'pending' } })
  })

  it('requires explicit fresh-start confirmation if any legacy save is present', () => {
    const source = serializeWizardWorld(createGeneratedWorld(seed))
    const storage = memoryStorage([[classicKey, source]])
    const state = createFreshPublicWorld(seed, classic)
    expect(commitPublicV6World(storage, state, null)).toEqual({ status: 'legacy-present' })
    expect(storage.writes).toEqual([])
    const confirmed = commitPublicV6World(storage, state, null, { confirmedFreshStartWithLegacy: true })
    expect(confirmed.status).toBe('committed')
    expect(storage.values.get(classicKey)).toBe(source)
  })

  it('rejects an invalid active root and never treats an interrupted stage as an automatic recovery', () => {
    const state = createFreshPublicWorld(seed, classic)
    const storage = memoryStorage([[PUBLIC_V6_ROOT_KEY, '{bad'], [PUBLIC_V6_STAGE_KEY, '{candidate}']])
    expect(commitPublicV6World(storage, state, null)).toEqual({ status: 'invalid-root' })
    expect(storage.writes).toEqual([])
    expect(inspectPublicV6Artifacts(storage)).toMatchObject({ status: 'available', stage: { status: 'invalid' } })
    storage.values.delete(PUBLIC_V6_ROOT_KEY)
    expect(commitPublicV6World(storage, state, null)).toEqual({ status: 'pending-stage' })
    expect(storage.values.get(PUBLIC_V6_STAGE_KEY)).toBe('{candidate}')
  })

  it('rejects a borrowed bootstrap with mismatched seed or profile', () => {
    const world = createGeneratedWorld(seed, classic)
    const storage = memoryStorage([[classicKey, serializeWizardWorld(world)]])
    const bootstrap = imported(storage, classic)
    const state = createPublicWorldFromBootstrap(bootstrap)
    const expected = storage.values.get(PUBLIC_V6_ROOT_KEY)!
    expect(commitPublicV6World(storage, { ...state, seed: 'other' }, expected)).toEqual({ status: 'invalid-state' })
    expect(commitPublicV6World(storage, { ...state, generationProfile: expanded }, expected)).toEqual({ status: 'invalid-state' })
  })
})
