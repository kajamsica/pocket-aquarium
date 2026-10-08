import { describe, expect, it } from 'vitest'
import { applyFieldCampAction, resolveFieldCampSite } from './fieldCamp'
import type { FieldCampActionResult } from './fieldCamp'
import { createGeneratedWorld } from './generation'
import { mireglassAnchors, mireglassFairyRing, mireglassResources } from './mireglassContent'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import { mireglassRouteSites } from './mireglassRouteSites'
import { serializeWizardWorld } from './persistence'
import { commitLegacyImportToPublicV6, inspectLegacyImportSource } from './publicWorldV6'
import { createFreshPublicWorld } from './publicWorldState'
import { createPublicV7StateFromV6Root, withFreshPublicV7Herbs } from './publicWorldV7'
import { isValidPublicWorldV9State, withFreshPublicV9Camps } from './publicWorldV9State'
import type { PublicWorldV9State } from './publicWorldV9State'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const tiles = [worldTileAtGrid(seed, -76, 100), worldTileAtGrid(seed, -70, 100)]
const base = withFreshPublicV9Camps(withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1')))
function at(index = 0, source = base): PublicWorldV9State {
  return { ...source, movementOwner: 'streamed',
    player: { ...structuredClone(source.player), position: { ...tiles[index].center }, verticalVelocity: 0,
      inventory: [...source.player.inventory, { itemId: 'logs', quantity: 2 },
        { itemId: 'logs', quantity: 3 }, { itemId: 'stone', quantity: 2 }] },
    discoveredTileIds: [...new Set([...source.discoveredTileIds, tiles[index].id])].sort() }
}
function rejected(state: PublicWorldV9State, id: string, code: string) {
  const before = JSON.stringify(state)
  const result = applyFieldCampAction(state, id)
  expect(result.rejection?.code).toBe(code)
  expect(result.event).toBeUndefined()
  expect(result.state).toBe(state)
  expect(result.state.player).toBe(state.player)
  expect(JSON.stringify(state)).toBe(before)
}
function placed(result: FieldCampActionResult) {
  expect(result.rejection).toBeUndefined()
  expect(result.event).toBeDefined()
  return result.state
}

describe('canonical field camp authority', () => {
  it('places a camp with the actual legacy-import bootstrap and validates its lineage', () => {
    const values = new Map([['wizard-realms:world:v5', serializeWizardWorld(createGeneratedWorld(seed))]])
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, bytes: string) => { values.set(key, bytes) } }
    const source = inspectLegacyImportSource(storage, 'greenway-classic-v1')
    if (source.status !== 'available') throw new Error(source.status)
    const imported = commitLegacyImportToPublicV6(storage, source)
    if (imported.status !== 'committed') throw new Error(imported.status)
    const state = at(0, withFreshPublicV9Camps(createPublicV7StateFromV6Root(imported.root)))
    expect(isValidPublicWorldV9State(state, imported.root)).toBe(true)
    const before = JSON.stringify(state)
    const next = placed(applyFieldCampAction(state, tiles[0].id, imported.root))
    expect(next.fieldCampTileIds).toEqual([tiles[0].id])
    expect(isValidPublicWorldV9State(next, imported.root)).toBe(true)
    expect(JSON.stringify(state)).toBe(before)
    const wrongSource = applyFieldCampAction(state, tiles[0].id, { ...imported.root, seed: 'another-world' })
    expect(wrongSource.rejection?.code).toBe('invalid_progress')
    expect(wrongSource.state).toBe(state)
  })

  it('offers two distinct dry sites with canonical coordinates and immutable results', () => {
    const sites = tiles.map((tile) => resolveFieldCampSite(seed, tile.id)!)
    expect(sites.every(Boolean)).toBe(true)
    expect(Math.hypot(sites[0].tile.center.x - sites[1].tile.center.x,
      sites[0].tile.center.z - sites[1].tile.center.z)).toBeGreaterThanOrEqual(24)
    sites.forEach((site, index) => {
      expect(site.gridX * 4).toBe(tiles[index].center.x)
      expect(site.gridZ * 4).toBe(tiles[index].center.z)
      expect(site.gridX).toBe(tiles[index].gridX - 3)
      expect(Object.isFrozen(site.tile.center)).toBe(true)
      expect(resolveFieldCampSite(seed, site.tileId)).toEqual(site)
      expect(placed(applyFieldCampAction(at(index), site.tileId)).fieldCampTileIds).toEqual([site.tileId])
    })
  })

  it('spends exactly 4 logs and 1 stone across stacks and grants 30 construction XP once', () => {
    const state = at()
    const before = JSON.stringify(state)
    const result = applyFieldCampAction(state, tiles[0].id)
    const next = placed(result)
    expect(result.event).toEqual({ type: 'field_camp_placed', tileId: tiles[0].id,
      logsSpent: 4, stoneSpent: 1, xp: 30, sequence: state.eventSequence + 1 })
    expect(next.player.inventory.filter(({ itemId }) => itemId === 'logs')).toEqual([{ itemId: 'logs', quantity: 1 }])
    expect(next.player.inventory.filter(({ itemId }) => itemId === 'stone')).toEqual([{ itemId: 'stone', quantity: 1 }])
    expect(next.player.xp).toBe(state.player.xp + 30)
    expect(next.player.skillXp.construction).toBe(state.player.skillXp.construction + 30)
    expect(next.player.level).toBe(1 + Math.floor(next.player.xp / 100))
    expect(next.eventSequence).toBe(state.eventSequence + 1)
    expect(next.tick).toBe(state.tick)
    expect(next.rng).toBe(state.rng)
    expect(next.greenway).toBe(state.greenway)
    expect(next.mireglass).toBe(state.mireglass)
    expect(JSON.stringify(state)).toBe(before)
    expect(isValidPublicWorldV9State(next, null)).toBe(true)
    rejected(next, tiles[0].id, 'already_built')
    rejected(next, tiles[1].id, 'already_built')
  })

  it('rejects malformed, spoofed, outside, wet, unsupported and occupied cells atomically', () => {
    const anchors = mireglassAnchors(seed)
    const route = mireglassRouteSites(seed)[0]
    const ids = ['invented', 'tile--073-103', 'tile-999999999999999999-103', 'tile-0-0',
      ...Object.values(anchors).map(({ tile }) => tile.id),
      ...mireglassResources(seed).map(({ tile }) => tile.id),
      ...mireglassHerbPatches(seed).map(({ tile }) => tile.id),
      mireglassFairyRing(seed).tile.id,
      worldTileAtGrid(seed, route.from.x / 4, route.from.z / 4).id]
    for (const id of ids) {
      expect(resolveFieldCampSite(seed, id)).toBeNull()
      rejected(at(), id, 'invalid_site')
    }
  })

  it('rejects undiscovered, distant, airborne and Greenway-owned placement without mutation', () => {
    rejected(at(1), tiles[0].id, 'site_hidden')
    const distant = { ...at(1), discoveredTileIds: [...at(1).discoveredTileIds, tiles[0].id].sort() }
    rejected(distant, tiles[0].id, 'too_far')
    const airborne = at()
    airborne.player.position.y += 4
    rejected(airborne, tiles[0].id, 'too_far')
    rejected(base, tiles[0].id, 'unavailable_here')
  })

  it('rejects insufficient materials and exhausted XP or sequence before any spend', () => {
    for (const itemId of ['logs', 'stone']) {
      const state = at()
      state.player.inventory = state.player.inventory.filter((stack) => stack.itemId !== itemId)
      rejected(state, tiles[0].id, 'not_owned')
    }
    const total = at()
    total.player.xp = Number.MAX_SAFE_INTEGER
    total.player.level = 1 + Math.floor(total.player.xp / 100)
    rejected(total, tiles[0].id, 'invalid_value')
    const skill = at()
    skill.player.skillXp.construction = Number.MAX_SAFE_INTEGER
    rejected(skill, tiles[0].id, 'invalid_value')
    rejected({ ...at(), eventSequence: Number.MAX_SAFE_INTEGER }, tiles[0].id, 'invalid_value')
    rejected({ ...at(), fieldCampTileIds: ['invented'] }, tiles[0].id, 'invalid_progress')
  })
})
