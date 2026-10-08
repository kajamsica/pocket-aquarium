import { describe, expect, it } from 'vitest'
import { createGeneratedWorld } from './domain/generation'
import { mireglassAnchors, mireglassResources } from './domain/mireglassContent'
import { mireglassRouteSites } from './domain/mireglassRouteSites'
import { createMireglassWorld } from './domain/mireglassWorld'
import {
  bearingText, createMireglassDevWorld, mireglassActionChoices, mireglassNextObjective, mireglassViewProjection,
} from './MireglassPlayableApp'

const seed = 'greenway-alpha'

describe('Mireglass playable dev adapter', () => {
  it('starts at the frontier with ordinary items, no learned spell, and no automatic progress', () => {
    const world = createMireglassDevWorld(seed)
    const marker = mireglassAnchors(seed).fringeMarker.tile.center
    expect(world.state.player.position).toEqual(marker)
    expect(world.state.player.inventory).toEqual([{ itemId: 'woodcutters_axe', quantity: 1 }])
    expect(world.state.player.learnedSpellIds).toEqual([])
    expect(world.state.expedition.fringeMarkerStudied).toBe(false)
    expect(mireglassActionChoices(world.state).map((choice) => choice.action.type)).toContain('study_fringe_marker')
    expect(mireglassNextObjective(world.state).position).toEqual(marker)

    const result = world.act({ type: 'study_fringe_marker' })
    expect(result.event?.type).toBe('fringe_marker_studied')
    expect(world.state.player.learnedSpellIds).toContain('wayfinder_glow')
    expect(world.state.expedition.fringeMarkerStudied).toBe(true)
    expect(mireglassNextObjective(world.state).position).toEqual(mireglassAnchors(seed).salvager.tile.center)
  })

  it('shows only in-reach stump actions and leaves authoritative prerequisites to the reducer', () => {
    const tree = mireglassResources(seed)[0]
    const world = createMireglassWorld(seed, undefined, tree.tile.center)
    expect(mireglassActionChoices(world.state).map((choice) => choice.action.type)).toContain('chop_tree')
    const denied = world.act({ type: 'chop_tree', resourceId: tree.id })
    expect(denied.rejection?.code).toBe('requires_axe')
    world.act({ type: 'equip_item', itemId: 'woodcutters_axe' })
    expect(world.act({ type: 'chop_tree', resourceId: tree.id }).event?.type).toBe('tree_chopped')
    expect(mireglassActionChoices(world.state).map((choice) => choice.action.type)).toContain('dig_tree_stump')
    expect(world.act({ type: 'dig_tree_stump', resourceId: tree.id }).rejection?.code).toBe('requires_spade')
  })

  it('projects real player gear, inventory, discovery, and only the chosen built route', () => {
    const site = mireglassRouteSites(seed).find((candidate) => candidate.kind === 'bridge')!
    const source = createGeneratedWorld(seed).player
    source.position = { ...site.from }
    source.inventory.push({ itemId: 'logs', quantity: 8 })
    source.equipment.mainHand = 'woodcutters_axe'
    const world = createMireglassWorld(seed, source)
    const before = mireglassViewProjection(world, world.state, [], null)
    expect(before.backpack.stacks.find((stack) => stack.itemId === 'logs')?.quantity).toBe(8)
    expect(before.equipment.mainHand?.itemId).toBe('woodcutters_axe')
    expect(before.coins).toBe(source.coins)
    expect(before.skillXp).toEqual(source.skillXp)
    expect(before.learnedSpellIds).toEqual([])
    expect(before.map.title).toContain('unsaved dev')
    expect(before.map.tiles).toHaveLength(17 * 17)
    expect(before.map.tiles.filter((tile) => tile.discovered).length).toBe(1)

    expect(world.act({ type: 'build_route', siteId: site.id }).event?.type).toBe('route_built')
    const after = mireglassViewProjection(world, world.state, [], null)
    expect(after.routes.find((route) => route.id === site.routeId)?.built).toBe(true)
    expect(after.routes.find((route) => route.id === site.routeId)?.from).toEqual([site.from.x, site.from.y, site.from.z])
    expect(after.buildSites.filter((candidate) => candidate.status === 'built').map((candidate) => candidate.id)).toEqual([site.id])
    expect(after.backpack.stacks.find((stack) => stack.itemId === 'logs')).toBeUndefined()
    expect(after.skillXp.construction).toBeGreaterThan(before.skillXp.construction)
  })

  it('renders useful compass bearings from world coordinates', () => {
    const origin = { x: 0, z: 0 }
    expect(bearingText(origin, { x: 0, z: -8 })).toBe('N')
    expect(bearingText(origin, { x: 8, z: 0 })).toBe('E')
    expect(bearingText(origin, { x: -8, z: 8 })).toBe('SW')
    expect(bearingText(origin, { x: 0.2, z: 0.2 })).toBe('here')
  })

  it('guides both the outward crossings and the return trip through built routes', () => {
    const bridge = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const ladder = mireglassRouteSites(seed).find((site) => site.kind === 'ladder')!
    const initial = createMireglassDevWorld(seed).state
    const advanced = { ...initial,
      player: { ...initial.player,
        inventory: [...initial.player.inventory, { itemId: 'field_spade' as const, quantity: 1 }, { itemId: 'logs' as const, quantity: 12 }],
        position: { ...bridge.from }, skillXp: { ...initial.player.skillXp, excavation: 30 } },
      expedition: { ...initial.expedition, fringeMarkerStudied: true,
        builtRoutes: { bridge: bridge.id, ladder: null } },
    }
    expect(mireglassNextObjective(advanced).label).toBe('Cross the built fen bridge')
    const across = { ...advanced, player: { ...advanced.player, position: { ...ladder.from } },
      expedition: { ...advanced.expedition, builtRoutes: { bridge: bridge.id, ladder: ladder.id } } }
    expect(mireglassNextObjective(across).label).toBe('Climb the built slate ladder')
    const returning = { ...across, player: { ...across.player, position: { ...ladder.to } },
      expedition: { ...across.expedition, cacheRevealed: true, cacheExcavated: true } }
    expect(mireglassNextObjective(returning).label).toBe('Descend the built slate ladder')
    expect(mireglassNextObjective({ ...returning, player: { ...returning.player, position: { ...bridge.to } } }).label)
      .toBe('Return across the built fen bridge')
  })
})
