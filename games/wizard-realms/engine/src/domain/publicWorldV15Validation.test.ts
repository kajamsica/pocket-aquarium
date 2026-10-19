import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { createFreshPublicV15Head, decodePublicV15Head, encodePublicV15Head,
  decodePublicV15Lineage, isLegacyPublicV15Lineage,
  PUBLIC_V15_LEGACY_RULES_PROFILE, PUBLIC_V15_RULES_PROFILE } from './publicWorldV15Snapshot'
import { publicV15StarterSupportAt } from './publicWorldV15StarterMovement'
import { PUBLIC_V15_STARTER_BRIDGE_ID, PUBLIC_V15_STARTER_DIG_ID,
  publicWorldV15StarterSites, publicWorldV15SuppressedStarterResourceIds } from './publicWorldV15StarterSites'
import { confirmPublicV15StarterWork, previewPublicV15StarterWork } from './publicWorldV15StarterWork'
import { decodePublicV15Progress, preservesPublicV15StarterWorks,
  validatePublicV15Progress } from './publicWorldV15Validation'
import type { PublicV15Progress } from './publicWorldV15Validation'
import { starterCliffCanonicalSite } from './starterCliffProfile'
import { validatePublicV14State } from './publicWorldV14Validation'

const seed = 'greenway-alpha'
const start = (): PublicV15Progress => {
  const fresh = createFreshPublicV15Head(seed)
  return { state: fresh.head.state, starterWorks: fresh.head.starterWorks }
}
function at(progress: PublicV15Progress, x: number, z: number): PublicV15Progress {
  const state = progress.state
  const route = state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
  const y = publicV15StarterSupportAt({ seed, profile: state.generationProfile, route,
    built: state.greenway.builtRouteIds.includes('greenway_ladder'),
    starterWorks: progress.starterWorks }, { x, z })?.floorY
  if (y === undefined) throw new Error('Test stance is unsupported.')
  return { ...progress, state: { ...state, player: { ...state.player,
    position: { x, y, z } } } }
}
function reveal(progress: PublicV15Progress, ids: readonly string[]): PublicV15Progress {
  const all = [...new Set([...decodeDiscoveredTileIds(progress.state.discoveryMask), ...ids])].sort()
  return { ...progress, state: { ...progress.state,
    discoveryMask: encodeDiscoveredTileIds(all) } }
}
function withLogs(progress: PublicV15Progress, quantity: number): PublicV15Progress {
  return { ...progress, state: { ...progress.state,
    player: { ...progress.state.player, inventory: [...progress.state.player.inventory,
      { itemId: 'logs', quantity }] } } }
}
function bridgeReady(): PublicV15Progress {
  const [bridge] = publicWorldV15StarterSites(seed)
  if (bridge.kind !== 'bridge') throw new Error('No bridge.')
  return withLogs(reveal(at(start(), bridge.from.x, bridge.from.z),
    bridge.footprintTileIds), 8)
}

describe('native v15 progress and starter works', () => {
  it('keeps v1 experimental roots blocked and generates native v2 genesis', () => {
    const fresh = createFreshPublicV15Head(seed)
    expect(fresh.lineage.rulesProfile).toBe('starter-crossing/v2')
    expect(PUBLIC_V15_RULES_PROFILE).toBe('starter-crossing/v2')
    expect(decodePublicV15Lineage(fresh.lineage)).toEqual(fresh.lineage)
    expect(decodePublicV15Head(fresh.head, fresh.lineage)).toEqual(fresh.head)
    const legacy = { ...fresh.lineage, rulesProfile: PUBLIC_V15_LEGACY_RULES_PROFILE }
    expect(isLegacyPublicV15Lineage(legacy)).toBe(true)
    expect(decodePublicV15Lineage(legacy)).toBeNull()
    expect(decodePublicV15Head(fresh.head, legacy)).toBeNull()
    expect(isLegacyPublicV15Lineage({ ...legacy, extra: true })).toBe(false)
  })

  it('proves true support, exact flags, and monotone work flags', () => {
    const fresh = start()
    expect(validatePublicV15Progress(fresh, seed)).toBe(true)
    expect(decodePublicV15Progress({ ...fresh,
      starterWorks: { bridgeBuilt: true, bankCacheDug: false } }, seed)).toBeNull()
    expect(validatePublicV15Progress({ ...fresh,
      starterWorks: { ...fresh.starterWorks, extra: true } }, seed)).toBe(false)
    expect(preservesPublicV15StarterWorks(fresh.starterWorks,
      { bridgeBuilt: true, bankCacheDug: false })).toBe(true)
    expect(preservesPublicV15StarterWorks({ bridgeBuilt: true, bankCacheDug: false },
      fresh.starterWorks)).toBe(false)
    const bridge = confirmPublicV15StarterWork(bridgeReady(), PUBLIC_V15_STARTER_BRIDGE_ID)
    expect(bridge.rejection).toBeUndefined()
    if (!bridge.progress) return
    const deck = at(bridge.progress, 0, 8)
    expect(validatePublicV15Progress(deck, seed)).toBe(true)
    const lineage = createFreshPublicV15Head(seed).lineage
    expect(encodePublicV15Head(deck.state, 1, lineage, undefined,
      deck.starterWorks).starterWorks).toEqual(deck.starterWorks)
    expect(validatePublicV15Progress({ ...deck,
      starterWorks: { bridgeBuilt: false, bankCacheDug: false } }, seed)).toBe(false)
    expect(validatePublicV15Progress({ ...deck, state: { ...deck.state,
      player: { ...deck.state.player, position: { ...deck.state.player.position,
        y: deck.state.player.position.y - 0.24 } } } }, seed)).toBe(false)
  })

  it('retains seed-canonical suppressed resources unharvested in the core', () => {
    const fresh = start()
    const ids = publicWorldV15SuppressedStarterResourceIds(seed,
      fresh.state.greenway.resources)
    expect(ids.length).toBeGreaterThan(0)
    const changed = { ...fresh, state: { ...fresh.state, greenway: {
      ...fresh.state.greenway, resources: fresh.state.greenway.resources.map((resource) =>
        resource.id === ids[0] ? { ...resource, health: resource.health - 1 } : resource) } } }
    expect(validatePublicV15Progress(changed, seed)).toBe(false)
    expect(validatePublicV15Progress(fresh, seed)).toBe(true)
  })

  it('does not double-count one XP balance for both the old ladder and new bridge', () => {
    const ready = bridgeReady()
    const ladder = starterCliffCanonicalSite(seed)
    const oldAndNew: PublicV15Progress = {
      starterWorks: { bridgeBuilt: true, bankCacheDug: false },
      state: { ...ready.state,
        greenway: { ...ready.state.greenway,
          builtRouteIds: ['greenway_ladder'],
          routes: ready.state.greenway.routes.map((route) => route.id === 'greenway_ladder'
            ? { ...route, siteId: ladder.id, from: ladder.from, to: ladder.to } : route) },
        player: { ...ready.state.player, xp: 80, level: 1,
          skillXp: { ...ready.state.player.skillXp, construction: 80 } } },
    }
    expect(validatePublicV14State(oldAndNew.state, seed)).not.toBeNull()
    expect(validatePublicV15Progress(oldAndNew, seed)).toBe(false)
    const enough: PublicV15Progress = { ...oldAndNew, state: { ...oldAndNew.state,
      greenway: { ...oldAndNew.state.greenway,
        unlockedRecipeIds: [...oldAndNew.state.greenway.unlockedRecipeIds,
          'highland_bridge' as const].sort() },
      player: { ...oldAndNew.state.player, xp: 140, level: 2,
        skillXp: { ...oldAndNew.state.player.skillXp, construction: 140 } } } }
    expect(validatePublicV15Progress(enough, seed)).toBe(true)
  })

  it('does not double-count an old terrain dig and the new bank-cache dig', () => {
    const fresh = start()
    const oldAndNew: PublicV15Progress = {
      starterWorks: { bridgeBuilt: false, bankCacheDug: true },
      state: { ...fresh.state,
        terrainWorks: { ...fresh.state.terrainWorks, dugTileIds: ['tile--64-76'] },
        player: { ...fresh.state.player, xp: 30, level: 1,
          skillXp: { ...fresh.state.player.skillXp, excavation: 30 } } },
    }
    expect(validatePublicV14State(oldAndNew.state, seed)).not.toBeNull()
    expect(validatePublicV15Progress(oldAndNew, seed)).toBe(false)
    const enough: PublicV15Progress = { ...oldAndNew, state: { ...oldAndNew.state,
      player: { ...oldAndNew.state.player, xp: 60,
        skillXp: { ...oldAndNew.state.player.skillXp, excavation: 60 } } } }
    expect(validatePublicV15Progress(enough, seed)).toBe(true)
  })

  it('confirms an eight-log bridge once, with a full discovered footprint and no input mutation', () => {
    const ready = bridgeReady()
    const before = structuredClone(ready)
    expect(previewPublicV15StarterWork(ready, PUBLIC_V15_STARTER_BRIDGE_ID))
      .toMatchObject({ rejection: null, site: { kind: 'bridge' } })
    const result = confirmPublicV15StarterWork(ready, PUBLIC_V15_STARTER_BRIDGE_ID)
    expect(result.rejection).toBeUndefined()
    expect(ready).toEqual(before)
    if (!result.progress || !result.event) return
    expect(result.progress.starterWorks).toEqual({ bridgeBuilt: true, bankCacheDug: false })
    expect(result.progress.state.player.inventory.some((stack) => stack.itemId === 'logs')).toBe(false)
    expect(result.progress.state.player.skillXp.construction).toBe(80)
    expect(result.progress.state.player.xp).toBe(80)
    expect(result.progress.state.eventSequence).toBe(ready.state.eventSequence + 1)
    expect(result.event).toEqual({ type: 'terrain_work_built', id: PUBLIC_V15_STARTER_BRIDGE_ID,
      tick: ready.state.tick, sequence: result.progress.state.eventSequence,
      logsSpent: 8, stoneGained: 0, xp: 80 })
    expect(confirmPublicV15StarterWork(result.progress, PUBLIC_V15_STARTER_BRIDGE_ID))
      .toEqual({ rejection: 'already_done' })
  })

  it('rejects hidden, distant, unsupported, and underfunded bridge requests', () => {
    const ready = bridgeReady()
    const [bridge] = publicWorldV15StarterSites(seed)
    if (bridge.kind !== 'bridge') throw new Error('No bridge.')
    const hidden = { ...ready, state: { ...ready.state,
      discoveryMask: start().state.discoveryMask } }
    expect(confirmPublicV15StarterWork(hidden, bridge.id))
      .toEqual({ rejection: 'undiscovered' })
    const partial = { ...ready, state: { ...ready.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(ready.state.discoveryMask)
        .filter((id) => id !== bridge.footprintTileIds[4])) } }
    expect(confirmPublicV15StarterWork(partial, bridge.id))
      .toEqual({ rejection: 'undiscovered' })
    expect(confirmPublicV15StarterWork(at(ready, 0, 0), bridge.id))
      .toEqual({ rejection: 'too_far' })
    expect(confirmPublicV15StarterWork(at(ready, 0, 5), bridge.id))
      .toEqual({ rejection: 'occupied' })
    expect(confirmPublicV15StarterWork(withLogs(reveal(at(start(), 0, 4),
      bridge.footprintTileIds), 7), bridge.id)).toEqual({ rejection: 'not_owned' })
    expect(confirmPublicV15StarterWork(ready, 'works2:bridge:forged'))
      .toEqual({ rejection: 'invalid_site' })
    expect(confirmPublicV15StarterWork({ ...ready, state: { ...ready.state,
      player: { ...ready.state.player, position: { x: 0, y: 0, z: 8 } } } }, bridge.id))
      .toEqual({ rejection: 'invalid_progress' })
  })

  it('digs only from a supported adjacent stance with an owned equipped spade and room', () => {
    const bridge = confirmPublicV15StarterWork(bridgeReady(), PUBLIC_V15_STARTER_BRIDGE_ID)
    if (!bridge.progress) throw new Error(`Bridge rejected: ${bridge.rejection}`)
    const [, dig] = publicWorldV15StarterSites(seed)
    if (dig.kind !== 'dig') throw new Error('No dig.')
    const atBank = reveal(at(bridge.progress, dig.adjacentStance.x,
      dig.adjacentStance.z), dig.footprintTileIds)
    expect(confirmPublicV15StarterWork(atBank, dig.id))
      .toEqual({ rejection: 'requires_spade' })
    const equipped: PublicV15Progress = { ...atBank, state: { ...atBank.state,
      player: { ...atBank.state.player,
        inventory: [...atBank.state.player.inventory, { itemId: 'field_spade', quantity: 1 }],
        equipment: { ...atBank.state.player.equipment, mainHand: 'field_spade' } } } }
    expect(previewPublicV15StarterWork(equipped, dig.id).rejection).toBeNull()
    const result = confirmPublicV15StarterWork(equipped, PUBLIC_V15_STARTER_DIG_ID)
    expect(result.rejection).toBeUndefined()
    if (!result.progress || !result.event) return
    expect(result.progress.starterWorks).toEqual({ bridgeBuilt: true, bankCacheDug: true })
    expect(result.progress.state.player.inventory.find((stack) => stack.itemId === 'stone')?.quantity)
      .toBe(1)
    expect(result.progress.state.player.skillXp.excavation).toBe(30)
    expect(result.progress.state.player.xp).toBe(110)
    expect(result.event).toEqual({ type: 'terrain_work_dug', id: PUBLIC_V15_STARTER_DIG_ID,
      tick: equipped.state.tick, sequence: result.progress.state.eventSequence,
      logsSpent: 0, stoneGained: 1, xp: 30 })
    expect(confirmPublicV15StarterWork(result.progress, dig.id))
      .toEqual({ rejection: 'already_done' })
    expect(confirmPublicV15StarterWork(at(equipped, 4, 12), dig.id))
      .toEqual({ rejection: 'occupied' })
    const full = { ...equipped, state: { ...equipped.state,
      player: { ...equipped.state.player,
        backpackCapacity: equipped.state.player.inventory.reduce((sum, stack) =>
          sum + stack.quantity, 0) } } }
    expect(confirmPublicV15StarterWork(full, dig.id))
      .toEqual({ rejection: 'capacity' })
  })
})
