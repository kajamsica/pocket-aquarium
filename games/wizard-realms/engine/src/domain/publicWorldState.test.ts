import { describe, expect, it } from 'vitest'
import { createGeneratedWorld, terrainHeightAt } from './generation'
import { isRestorableWizardSave, restoreWizardWorld, serializeWizardWorld } from './persistence'
import { commitLegacyImportToPublicV6, inspectLegacyImportSource, legacyMovementEnvelope } from './publicWorldV6'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { createFreshPublicWorld, createPublicWorldFromBootstrap } from './publicWorldState'
import type { PublicWorldState } from './publicWorldState'
import type { GenerationProfile, WizardWorldState } from './types'

const seed = 'greenway-alpha'
const classic = 'greenway-classic-v1'
const expanded = 'greenway-expanded-v1'
const keyFor = (profile: GenerationProfile) => profile === classic
  ? 'wizard-realms:world:v5' : 'wizard-realms:world:expanded:v4'

function bootstrap(profile: GenerationProfile, sourceBytes: string, key = keyFor(profile)) {
  const values = new Map([[key, sourceBytes]])
  const writes: string[] = []
  const storage = {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, bytes: string) => { writes.push(name); values.set(name, bytes) },
  }
  const source = inspectLegacyImportSource(storage, profile)
  expect(source.status).toBe('available')
  if (source.status !== 'available') throw new Error('Expected restorable import source.')
  const result = commitLegacyImportToPublicV6(storage, source)
  expect(result.status).toBe('committed')
  if (result.status !== 'committed') throw new Error('Expected committed import root.')
  return { root: result.root, storage, writes }
}

function reassemble(state: PublicWorldState): WizardWorldState {
  return {
    ...state.greenway, seed: state.seed, generationProfile: state.generationProfile,
    tick: state.tick, rng: state.rng, eventSequence: state.eventSequence,
    player: state.player as WizardWorldState['player'],
    discoveredTileIds: [...state.discoveredTileIds],
  }
}

function progressedWorld(profile: GenerationProfile): WizardWorldState {
  const world = createGeneratedWorld(seed, profile)
  world.tick = 437
  world.eventSequence = 91
  world.rng.generation = 12_345
  world.rng.simulation = 67_890
  world.player.position = { ...world.tiles.find((tile) => tile.center.x === 4 && tile.center.z === 4)!.center }
  world.player.yaw = 0.4
  world.player.pitch = -0.2
  world.player.verticalVelocity = 0.3
  world.player.coins = 73
  world.player.xp = 200
  world.player.level = 3
  world.player.inventory.push({ itemId: 'field_spade', quantity: 1 }, { itemId: 'logs', quantity: 4 })
  world.player.equipment.mainHand = 'field_spade'
  world.player.tradeSlots[0] = { slotIndex: 0, itemId: 'stone', quantity: 1, unitPrice: 9 }
  world.player.discoveredRingIds = ['ring-greenway']
  world.player.skillXp.excavation = 30
  world.player.skillXp.spellcraft = 10
  world.player.learnedSpellIds = ['wayfinder_glow']
  world.resources[0].health = 0
  world.resources[0].depleted = true
  world.resources[0].position.x += 0.1
  world.stores[0].listings[2].stock = 2
  world.stores[0].listings[2].price = 19
  world.fairyRings[0].position.x += 0.1
  world.fairyRings[0].position.y = terrainHeightAt(world.tiles,
    world.fairyRings[0].position.x, world.fairyRings[0].position.z)
  world.builtRouteIds = ['greenway_ladder']
  world.routes[0].siteId = 'greenway_ladder:x:0'
  world.unlockedRecipeIds = ['greenway_ladder', 'highland_bridge']
  world.studiedInscriptionIds = ['greenway_waystone']
  world.revealedDigSiteIds = ['practice_mound']
  world.excavatedDigSiteIds = ['practice_mound']
  return world
}

function legacyBytes(profile: GenerationProfile, version: 'wizard-world/v1' | 'wizard-world/v2') {
  const save = JSON.parse(serializeWizardWorld(createGeneratedWorld(seed, profile))) as Record<string, unknown>
  const player = save.player as Record<string, unknown>
  const stores = save.stores as Array<{ listings: Array<{ id: string }> }>
  save.schemaVersion = version
  delete save.contentRevision
  stores[0].listings = stores[0].listings.filter((listing) => listing.id !== 'spade')
  for (const field of ['inscriptions', 'digSites', 'studiedInscriptionIds', 'revealedDigSiteIds', 'excavatedDigSiteIds']) delete save[field]
  delete player.skillXp
  delete player.learnedSpellIds
  player.coins = 77
  if (version === 'wizard-world/v1') {
    for (const field of ['generationProfile', 'areas', 'routes', 'recipes', 'builtRouteIds', 'unlockedRecipeIds', 'discoveredTileIds']) delete save[field]
    save.resources = (save.resources as Array<{ id: string }>).filter((resource) => !resource.id.startsWith('greenway-journey-tree-'))
    delete player.verticalVelocity
  } else for (const route of save.routes as Array<Record<string, unknown>>) delete route.siteId
  return JSON.stringify(save)
}

describe('public v6 domain construction', () => {
  it.each([classic, expanded] as const)('preserves every normalized %s Greenway fact under one player', (profile) => {
    const original = progressedWorld(profile)
    const sourceBytes = serializeWizardWorld(original)
    expect(isRestorableWizardSave(sourceBytes, profile)).toBe(true)
    const { root, storage, writes } = bootstrap(profile, sourceBytes)
    const rootBefore = JSON.stringify(root)
    const writesBefore = [...writes]
    const state = createPublicWorldFromBootstrap(root)
    expect(state.player.position).toEqual(original.player.position)
    expect(state.movementOwner).toBe('greenway')
    expect(state.generationProfile).toBe(profile)
    expect(state.greenway.schemaVersion).toBe('wizard-world/v5')
    expect(state.greenway.contentRevision).toBe('greenway-region-v3')
    expect(state.mireglass).toMatchObject({ seed, contentRevision: 'mireglass-reach-v3',
      depletedResourceIds: [], dugStumpIds: [], builtRoutes: { bridge: null, ladder: null } })
    expect(Object.hasOwn(state.greenway, 'player')).toBe(false)
    expect(Object.hasOwn(state.mireglass, 'player')).toBe(false)
    expect(reassemble(state)).toEqual(original)
    expect(isRestorableWizardSave(serializeWizardWorld(reassemble(state)), profile)).toBe(true)
    expect(JSON.stringify(root)).toBe(rootBefore)
    expect(storage.getItem(keyFor(profile))).toBe(sourceBytes)
    expect(writes).toEqual(writesBefore)
  })

  it.each([
    [classic, 'wizard-world/v1', 'wizard-realms:world:v1'],
    [expanded, 'wizard-world/v2', 'wizard-realms:world:expanded:v1'],
  ] as const)('constructs from normalized %s %s progress without changing legacy bytes', (profile, version, key) => {
    const sourceBytes = legacyBytes(profile, version)
    const { root, storage } = bootstrap(profile, sourceBytes, key)
    const state = createPublicWorldFromBootstrap(root)
    const expected = restoreWizardWorld(sourceBytes)
    expect(reassemble(state)).toEqual(expected)
    expect(state.player.coins).toBe(77)
    expect(storage.getItem(key)).toBe(sourceBytes)
  })

  it.each([classic, expanded] as const)('starts a fresh %s journey at Greenway with detached state', (profile) => {
    const state = createFreshPublicWorld(seed, profile)
    expect(reassemble(state)).toEqual(createGeneratedWorld(seed, profile))
    expect(state.player.position.x).toBe(0)
    expect(state.player.position.z).toBe(0)
    expect(state.movementOwner).toBe('greenway')
    expect(state.mireglass.depletedResourceIds).toEqual([])
    expect(state.mireglass.cacheRevealed).toBe(false)
  })

  it('rejects mismatched seed, revision and a legacy position outside its movement envelope', () => {
    const good = bootstrap(classic, serializeWizardWorld(createGeneratedWorld(seed))).root
    expect(() => createPublicWorldFromBootstrap({ ...good, seed: 'other' })).toThrow(RangeError)
    expect(() => createPublicWorldFromBootstrap({ ...good, mireglassContentRevision: 'future' } as unknown as PublicV6BootstrapRoot)).toThrow(RangeError)
    expect(() => createFreshPublicWorld('', classic)).toThrow(RangeError)
    expect(() => createFreshPublicWorld(seed, 'unknown' as GenerationProfile)).toThrow(RangeError)
    expect(() => createFreshPublicWorld('public-seed-0', classic)).toThrow('mireglass-content')

    const outside = createGeneratedWorld(seed)
    outside.player.position.x = legacyMovementEnvelope(outside).minX - 0.000001
    outside.player.position.y = terrainHeightAt(outside.tiles, outside.player.position.x, outside.player.position.z)
    const invalidResumeBytes = serializeWizardWorld(outside)
    expect(isRestorableWizardSave(invalidResumeBytes, classic)).toBe(true)
    const inconsistent = { ...good, source: { ...good.source, bytes: invalidResumeBytes },
      greenwaySaveBytes: invalidResumeBytes }
    expect(() => createPublicWorldFromBootstrap(inconsistent)).toThrow(RangeError)
  })
})
