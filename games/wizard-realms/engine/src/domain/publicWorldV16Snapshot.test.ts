import { describe, expect, it } from 'vitest'
import { createFreshPublicV15Head } from './publicWorldV15Snapshot'
import { resolvePublicV16GreenwaySite } from './publicWorldV16GreenwaySites'
import { publicV16StarterSupportAt } from './publicWorldV16StarterMovement'
import { createFreshPublicV16Head, createMigratedPublicV16Head,
  decodePublicV16Head, decodePublicV16Lineage, encodePublicV16Head,
  PUBLIC_V16_DATABASE_NAME, PUBLIC_V16_RULES_PROFILE, PUBLIC_V16_SCHEMA } from './publicWorldV16Snapshot'
import { decodePublicV16Progress, preservesPublicV16GreenwayWorks } from './publicWorldV16Validation'
import { starterCliffCanonicalSite } from './starterCliffProfile'
import { validatePublicV14State } from './publicWorldV14Validation'

const seed = 'wizard-realms'
const works = (builtBridgeIds: string[] = [], builtLadderIds: string[] = [],
  dugTileIds: string[] = []) => ({ builtBridgeIds, builtLadderIds, dugTileIds })

describe('v16 envelope and checked progress', () => {
  it('creates a distinct, exact fresh root and rejects generic genesis edits', () => {
    const { head, lineage } = createFreshPublicV16Head(seed)
    expect(PUBLIC_V16_SCHEMA).toBe('wizard-world/v16')
    expect(PUBLIC_V16_RULES_PROFILE).toBe('greenway-works/v1')
    expect(PUBLIC_V16_DATABASE_NAME).toBe('wizard-realms:world:v16')
    expect(decodePublicV16Lineage(lineage)).toEqual(lineage)
    expect(decodePublicV16Head(head, lineage)).toEqual(head)
    expect(decodePublicV16Head({ ...head, schemaVersion: 'wizard-world/v15' }, lineage)).toBeNull()
    expect(decodePublicV16Head({ ...head, greenwayWorks: works(['works3:bridge:0']) },
      lineage)).toBeNull()
    expect(decodePublicV16Head({ ...head, extra: 1 }, lineage)).toBeNull()
    expect(decodePublicV16Lineage({ ...lineage, rulesProfile: 'starter-crossing/v2' }))
      .toBeNull()
    expect(decodePublicV16Lineage({ ...lineage, sourceReceipt: {} })).toBeNull()
  })

  it('accepts an alternate built bridge pose on real v16 support only', () => {
    const { head, lineage } = createFreshPublicV16Head(seed)
    const candidate = [-2, -1, 1, 2].map((gx) =>
      resolvePublicV16GreenwaySite(seed, `works3:bridge:${gx}`))
      .find((site) => site?.kind === 'bridge' && site.blockingResourceIds.length === 0)
    if (!candidate || candidate.kind !== 'bridge') throw new Error('No clear alternate bridge.')
    const greenwayWorks = works([candidate.id])
    const route = head.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
    const context = { seed, profile: head.state.generationProfile, route,
      built: false, greenwayWorks }
    const point = { x: candidate.from.x, z: 8 }
    const support = publicV16StarterSupportAt(context, point)
    expect(support?.kind).toBe('bridge')
    const state = { ...head.state, player: { ...head.state.player,
      xp: 80, skillXp: { ...head.state.player.skillXp, construction: 80 },
      position: { ...point, y: support!.floorY } } }
    expect(decodePublicV16Progress({ state, greenwayWorks }, seed)).not.toBeNull()
    expect(encodePublicV16Head({ state, greenwayWorks }, 1, lineage).state.player.position)
      .toEqual(state.player.position)
    expect(decodePublicV16Progress({ state: { ...state, player: { ...state.player,
      position: { ...state.player.position, y: state.player.position.y - 0.24 } } },
      greenwayWorks }, seed)).toBeNull()
    expect(decodePublicV16Progress({ state: { ...state, player: { ...state.player,
      xp: 79 } }, greenwayWorks }, seed)).toBeNull()
  })

  it('pins an exact migrated v15 source and counts bridge plus dig rewards once', () => {
    const v15 = createFreshPublicV15Head(seed)
    const state = { ...v15.head.state, player: { ...v15.head.state.player,
      xp: 110, level: 2, skillXp: { ...v15.head.state.player.skillXp,
        construction: 80, excavation: 30 } } }
    const source = { state, starterWorks: { bridgeBuilt: true, bankCacheDug: true },
      bootstrap: null, saveRevision: 1, lineage: v15.lineage }
    const migrated = createMigratedPublicV16Head(source)
    expect(migrated).not.toBeNull()
    if (!migrated) return
    expect(migrated.lineage.sourceReceipt).toMatchObject({ saveRevision: 1,
      starterWorks: source.starterWorks })
    expect(migrated.lineage.sourceReceipt).not.toBe(source)
    expect(migrated.lineage.sourceReceipt?.state).not.toBe(source.state)
    expect(migrated.lineage.sourceReceipt?.starterWorks).not.toBe(source.starterWorks)
    expect(migrated.head.greenwayWorks).toEqual(works(['works3:bridge:0'], [],
      ['works3:dig:1:3']))
    expect(migrated.head.state).toEqual(source.state)
    expect(decodePublicV16Head(migrated.head, migrated.lineage)).toEqual(migrated.head)
    expect(decodePublicV16Head({ ...migrated.head, greenwayWorks: works() },
      migrated.lineage)).toBeNull()
    expect(decodePublicV16Lineage({ ...migrated.lineage, sourceReceipt: {
      ...migrated.lineage.sourceReceipt!, saveRevision: -1 } })).toBeNull()
    expect(decodePublicV16Lineage({ ...migrated.lineage, sourceReceipt: {
      ...migrated.lineage.sourceReceipt!, extra: true } })).toBeNull()
    expect(createMigratedPublicV16Head({ ...source, lineage: {
      ...source.lineage, rulesProfile: 'starter-crossing/v1' } })).toBeNull()
  })

  it('counts the authored ladder in core XP without duplicating it in works3', () => {
    const { head, lineage } = createFreshPublicV16Head(seed)
    const site = starterCliffCanonicalSite(seed)
    const state: typeof head.state = { ...head.state,
      greenway: { ...head.state.greenway, builtRouteIds: ['greenway_ladder'],
        routes: head.state.greenway.routes.map((route) => route.id === 'greenway_ladder'
          ? { ...route, siteId: site.id, from: site.from, to: site.to } : route) },
      player: { ...head.state.player, xp: 60, level: 1,
        skillXp: { ...head.state.player.skillXp, construction: 60 } } }
    expect(decodePublicV16Progress({ state, greenwayWorks: works() }, seed)).not.toBeNull()
    expect(encodePublicV16Head({ state, greenwayWorks: works() }, 1, lineage)
      .greenwayWorks.builtLadderIds).toEqual([])
    expect(decodePublicV16Progress({ state,
      greenwayWorks: works(['works3:bridge:0']) }, seed)).toBeNull()
    expect(decodePublicV16Progress({ state,
      greenwayWorks: works([], ['works3:ladder:0']) }, seed)).toBeNull()
  })

  it('rejects malformed ledgers and preserves sorted work history', () => {
    const { head } = createFreshPublicV16Head(seed)
    for (const greenwayWorks of [works(['works3:bridge:01']),
      works(['works3:bridge:0', 'works3:bridge:0']),
      works(['works3:bridge:2', 'works3:bridge:1']),
      { ...works(), builtBridgeIds: new Array(1) },
      { ...works(), builtBridgeIds: Array.from({ length: 33 }, () => 'works3:bridge:0') },
      { ...works(), extra: true }]) {
      expect(decodePublicV16Progress({ state: head.state, greenwayWorks }, seed)).toBeNull()
    }
    expect(preservesPublicV16GreenwayWorks(works(['works3:bridge:0']),
      works(['works3:bridge:0'], [], ['works3:dig:1:3']), seed)).toBe(true)
    expect(preservesPublicV16GreenwayWorks(works(['works3:bridge:0']),
      works([], [], ['works3:dig:1:3']), seed)).toBe(false)
  })

  it('requires a built connector tree to be fully harvested, not only flagged depleted', () => {
    const blockedSeed = 'p29-seed-0'
    const { head } = createFreshPublicV16Head(blockedSeed)
    const blocked = resolvePublicV16GreenwaySite(blockedSeed, 'works3:bridge:1')
    if (!blocked || blocked.kind === 'dig') throw new Error('No tree-blocked connector.')
    const id = blocked.blockingResourceIds[0]
    const greenwayWorks = blocked.kind === 'bridge' ? works([blocked.id])
      : works([], [blocked.id])
    const state = { ...head.state, player: { ...head.state.player,
      xp: blocked.xpReward, skillXp: { ...head.state.player.skillXp,
        construction: blocked.xpReward } },
      greenway: { ...head.state.greenway,
        resources: head.state.greenway.resources.map((resource) => resource.id === id
          ? { ...resource, depleted: true } : resource) } }
    expect(validatePublicV14State(state, blockedSeed)).not.toBeNull()
    expect(decodePublicV16Progress({ state, greenwayWorks }, blockedSeed)).toBeNull()
    const harvested = { ...state, greenway: { ...state.greenway,
      resources: state.greenway.resources.map((resource) => resource.id === id
        ? { ...resource, health: 0 } : resource) } }
    expect(decodePublicV16Progress({ state: harvested, greenwayWorks }, blockedSeed)).not.toBeNull()
  })
})
