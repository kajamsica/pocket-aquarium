import { describe, expect, it, vi } from 'vitest'

const generated = vi.hoisted(() => new Map<string, number>())
const routeSitesGenerated = vi.hoisted(() => new Map<string, number>())
vi.mock('./generation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./generation')>()
  return { ...actual,
    createGeneratedWorld: (...args: Parameters<typeof actual.createGeneratedWorld>) => {
      generated.set(args[0], (generated.get(args[0]) ?? 0) + 1)
      return actual.createGeneratedWorld(...args)
    },
  }
})
vi.mock('./routeSites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./routeSites')>()
  return { ...actual,
    canonicalRouteSites: (...args: Parameters<typeof actual.canonicalRouteSites>) => {
      const seed = args[0].seed
      routeSitesGenerated.set(seed, (routeSitesGenerated.get(seed) ?? 0) + 1)
      return actual.canonicalRouteSites(...args)
    },
  }
})

import { createGeneratedWorld } from './generation'
import { canonicalRouteSites } from './routeSites'
import { starterCliffCanonicalSite } from './starterCliffProfile'
import type { WizardWorldState } from './types'
import { cloneBoundedPublicV13StateShape } from './publicWorldV13Snapshot'
import { canonicalPublicV14StarterFacts, createFreshPublicV14State,
  validatePublicV14State } from './publicWorldV14Validation'
import { createFreshPublicV17Head } from './publicWorldV17Snapshot'
import { decodePublicV17Progress } from './publicWorldV17Validation'
import { createPublicV23Root, decodePublicV23Head, decodePublicV23Progress,
  replayPublicV23Transition } from './publicWorldV23Snapshot'

describe('bounded private V14 validation baselines', () => {
  it('reuses a seed-specific baseline but leaves the public fresh constructor fresh', () => {
    const seed = 'baseline-repeat-2026'
    const source = createFreshPublicV14State(seed)
    generated.clear()
    const first = validatePublicV14State(source, seed)
    const firstGenerationCalls = generated.get(seed) ?? 0
    const second = validatePublicV14State(source, seed)
    const secondGenerationCalls = (generated.get(seed) ?? 0) - firstGenerationCalls
    expect(first).not.toBeNull()
    expect(second).toEqual(first)
    // A warm validation reuses both the genesis baseline and bridge sites.
    expect(firstGenerationCalls).toBeGreaterThan(secondGenerationCalls)
    expect(secondGenerationCalls).toBe(0)
    const fresh = createFreshPublicV14State(seed)
    expect(fresh).toEqual(source)
    expect(fresh).not.toBe(source)
    expect(fresh.discoveryMask).not.toBe(source.discoveryMask)
  })

  it('keeps four recent seeds and evicts the least recently validated seed', () => {
    const seeds = Array.from({ length: 5 }, (_, index) => `baseline-evict-${index}-2026`)
    const states = seeds.map((seed) => createFreshPublicV14State(seed))
    generated.clear()
    for (let index = 0; index < 4; index++) {
      expect(validatePublicV14State(states[index], seeds[index])).not.toBeNull()
    }
    const beforeHit = generated.get(seeds[0]) ?? 0
    expect(validatePublicV14State(states[0], seeds[0])).not.toBeNull()
    const hitCalls = (generated.get(seeds[0]) ?? 0) - beforeHit
    expect(hitCalls).toBe(0)
    expect(validatePublicV14State(states[4], seeds[4])).not.toBeNull()
    const beforeEvicted = generated.get(seeds[1]) ?? 0
    expect(validatePublicV14State(states[1], seeds[1])).not.toBeNull()
    expect((generated.get(seeds[1]) ?? 0) - beforeEvicted).toBeGreaterThan(hitCalls)
  })

  it('reuses only canonical bridge sites and evicts the least recently used seed', () => {
    const seeds = Array.from({ length: 5 }, (_, index) => `bridge-sites-evict-${index}-2026`)
    const states = seeds.map((seed) => createFreshPublicV14State(seed))
    routeSitesGenerated.clear()
    for (let index = 0; index < 4; index++) {
      expect(validatePublicV14State(states[index], seeds[index])).not.toBeNull()
      expect(routeSitesGenerated.get(seeds[index])).toBe(1)
    }
    expect(validatePublicV14State(states[0], seeds[0])).not.toBeNull()
    expect(routeSitesGenerated.get(seeds[0])).toBe(1)
    expect(validatePublicV14State(states[4], seeds[4])).not.toBeNull()
    expect(routeSitesGenerated.get(seeds[4])).toBe(1)
    expect(validatePublicV14State(states[1], seeds[1])).not.toBeNull()
    expect(routeSitesGenerated.get(seeds[1])).toBe(2)
  })

  it('checks built bridge geometry and current routes on every warm validation', () => {
    const seed = 'bridge-sites-built-parity-2026'
    const source = createFreshPublicV14State(seed)
    const bridge = canonicalRouteSites({ ...createGeneratedWorld(seed,
      'greenway-expanded-v1'), tiles: source.greenway.tiles } as WizardWorldState)
      .find((site) => site.routeId === 'highland_bridge')
    if (!bridge) throw new Error('Missing canonical bridge site')
    const ladder = starterCliffCanonicalSite(seed)
    const built = { ...structuredClone(source),
      greenway: { ...source.greenway,
        builtRouteIds: ['greenway_ladder', 'highland_bridge'],
        unlockedRecipeIds: ['greenway_ladder', 'highland_bridge'],
        routes: source.greenway.routes.map((route) => {
          const site = route.id === 'greenway_ladder' ? ladder : bridge
          return { ...route, siteId: site.id, from: site.from, to: site.to }
        }) },
      player: { ...source.player, level: 2, xp: 140,
        skillXp: { ...source.player.skillXp, construction: 140 } } }
    const original = structuredClone(built)
    routeSitesGenerated.clear()
    expect(validatePublicV14State(built, seed)).toEqual(built)
    expect(validatePublicV14State(built, seed)).toEqual(built)
    expect(routeSitesGenerated.get(seed)).toBe(1)
    expect(built).toEqual(original)
    const forged = structuredClone(built)
    forged.greenway.routes[1].from.y += 0.01
    expect(validatePublicV14State(forged, seed)).toBeNull()
    expect(routeSitesGenerated.get(seed)).toBe(1)
  })

  it('never exposes the cached baseline through a validation result or accepts tampering', () => {
    const seed = 'baseline-isolation-2026'
    const source = createFreshPublicV14State(seed)
    const accepted = validatePublicV14State(source, seed)
    if (!accepted) throw new Error('Fresh V14 state was rejected')
    accepted.greenway.tiles[0].elevation = 999
    expect(validatePublicV14State(accepted, seed)).toBeNull()
    expect(validatePublicV14State(source, seed)).toEqual(source)
    const forged = structuredClone(source)
    forged.rng.generation++
    expect(validatePublicV14State(forged, seed)).toBeNull()
  })

  it('compares copied immutable facts exactly for both canonical seeds', () => {
    for (const seed of ['greenway-alpha', 'wizard-realms']) {
      const source = createFreshPublicV14State(seed)
      const copied = cloneBoundedPublicV13StateShape(source)
      expect(copied).not.toBeNull()
      expect(validatePublicV14State(copied, seed)).toEqual(source)
      const changed = structuredClone(source)
      changed.greenway.tiles[0].elevation += 1
      expect(cloneBoundedPublicV13StateShape(changed)).not.toBeNull()
      expect(validatePublicV14State(changed, seed)).toBeNull()
      const signedZero = structuredClone(source)
      const zeroX = signedZero.greenway.tiles.find((tile) => Object.is(tile.center.x, 0))
      if (!zeroX) throw new Error('Missing canonical zero-X tile')
      zeroX.center.x = -0
      expect(cloneBoundedPublicV13StateShape(signedZero)).not.toBeNull()
      expect(validatePublicV14State(signedZero, seed)).toBeNull()
      const extraKey = structuredClone(source)
      Object.defineProperty(extraKey.greenway.tiles[0], 'unexpected', {
        value: true, enumerable: true, configurable: true,
      })
      expect(cloneBoundedPublicV13StateShape(extraKey)).not.toBeNull()
      expect(validatePublicV14State(extraKey, seed)).toBeNull()
      const shorter = structuredClone(source)
      shorter.greenway.tiles.pop()
      expect(cloneBoundedPublicV13StateShape(shorter)).not.toBeNull()
      expect(validatePublicV14State(shorter, seed)).toBeNull()
      expect(validatePublicV14State(source, seed)).toEqual(source)
    }
  })

  it('rejects malformed immutable shapes in the V13 descriptor copier', () => {
    const seed = 'greenway-alpha'
    const source = createFreshPublicV14State(seed)
    let getterReads = 0
    const mutations: Array<[string, (state: typeof source) => void]> = [
      ['array hole', (state) => { Reflect.deleteProperty(state.greenway.tiles, '0') }],
      ['array extra key', (state) => { Object.defineProperty(state.greenway.tiles,
        'unexpected', { value: true, enumerable: true }) }],
      ['symbol key', (state) => { Object.defineProperty(state.greenway.tiles[0],
        Symbol('unexpected'), { value: true, enumerable: true }) }],
      ['nonenumerable key', (state) => { Object.defineProperty(state.greenway.tiles[0],
        'unexpected', { value: true }) }],
      ['accessor', (state) => { Object.defineProperty(state.greenway.tiles[0], 'elevation',
        { enumerable: true, get() { getterReads++; return 0 } }) }],
      ['prototype', (state) => { Object.setPrototypeOf(state.greenway.tiles[0], null) }],
      ['NaN', (state) => { state.greenway.tiles[0].elevation = Number.NaN }],
      ['cycle', (state) => { Object.defineProperty(state.greenway.tiles[0], 'unexpected',
        { value: state.greenway.tiles[0], enumerable: true }) }],
    ]
    for (const [name, mutate] of mutations) {
      const malformed = structuredClone(source)
      mutate(malformed)
      expect(cloneBoundedPublicV13StateShape(malformed), name).toBeNull()
      expect(validatePublicV14State(malformed, seed), name).toBeNull()
    }
    expect(getterReads).toBe(0)
    expect(validatePublicV14State(source, seed)).toEqual(source)
  })

  it('preserves V17 and V23 projection results after repeated validation', () => {
    const seed = 'greenway-alpha'
    const v17 = createFreshPublicV17Head(seed).head
    const v17Progress = { state: v17.state, greenwayWorks: v17.greenwayWorks }
    expect(decodePublicV17Progress(v17Progress, seed)).toEqual(v17Progress)
    expect(decodePublicV17Progress(v17Progress, seed)).toEqual(v17Progress)
    const v23 = createPublicV23Root(seed).head
    const v23Progress = { state: v23.state, greenwayWorks: v23.greenwayWorks,
      regionalWorks: v23.regionalWorks }
    expect(decodePublicV23Progress(v23Progress, seed)).toEqual(v23Progress)
    expect(decodePublicV23Progress(v23Progress, seed)).toEqual(v23Progress)
  })

  it('reuses starter facts instead of regenerating them on every V17 and V23 decode', () => {
    const seed = 'baseline-v17-v23-decode-2026'
    const v17 = createFreshPublicV17Head(seed).head
    const v17Progress = { state: v17.state, greenwayWorks: v17.greenwayWorks }
    generated.clear()
    expect(decodePublicV17Progress(v17Progress, seed)).toEqual(v17Progress)
    expect(decodePublicV17Progress(v17Progress, seed)).toEqual(v17Progress)
    expect(generated.get(seed) ?? 0).toBe(0)
    const v23 = { ...v17Progress, regionalWorks: { builtLadderIds: [] } }
    generated.clear()
    expect(decodePublicV23Progress(v23, seed)).toEqual(v23)
    expect(decodePublicV23Progress(v23, seed)).toEqual(v23)
    expect(generated.get(seed) ?? 0).toBe(0)
  })

  it('returns detached starter facts and still rejects forged resources', () => {
    const seed = 'baseline-starter-facts-isolation-2026'
    const v17 = createFreshPublicV17Head(seed).head
    const facts = canonicalPublicV14StarterFacts(seed)
    ;(facts.playerStart as { x: number }).x = 999
    ;(facts.resources[0] as { maxHealth: number }).maxHealth = 999
    const again = canonicalPublicV14StarterFacts(seed)
    expect(again.playerStart).toEqual(v17.state.player.position)
    expect(again.resources).toEqual(v17.state.greenway.resources)
    const forged = structuredClone({ state: v17.state, greenwayWorks: v17.greenwayWorks })
    forged.state.greenway.resources[0].maxHealth++
    expect(decodePublicV17Progress(forged, seed)).toBeNull()
    expect(decodePublicV17Progress({ state: v17.state,
      greenwayWorks: v17.greenwayWorks }, seed)).not.toBeNull()
  })

  it('keeps detached starter facts in the same four-seed eviction budget', () => {
    const seeds = Array.from({ length: 5 }, (_, index) => `baseline-facts-evict-${index}-2026`)
    for (const seed of seeds.slice(0, 4)) canonicalPublicV14StarterFacts(seed)
    generated.clear()
    canonicalPublicV14StarterFacts(seeds[0])
    expect(generated.get(seeds[0]) ?? 0).toBe(0)
    canonicalPublicV14StarterFacts(seeds[4])
    const coldCalls = generated.get(seeds[4]) ?? 0
    expect(coldCalls).toBeGreaterThan(0)
    canonicalPublicV14StarterFacts(seeds[1])
    expect(generated.get(seeds[1])).toBe(coldCalls)
  })

  it('keeps fresh and V17-migrated V23 checkpoint replay identical', () => {
    for (const migrated of [false, true]) {
      const seed = `baseline-v23-checkpoint-${migrated}-2026`
      const v17 = createFreshPublicV17Head(seed)
      const receipt = migrated ? { state: v17.head.state,
        greenwayWorks: v17.head.greenwayWorks, saveRevision: 0,
        lineage: v17.lineage } : null
      const root = createPublicV23Root(seed, receipt)
      const next = { ...root.head, saveRevision: 1,
        witness: { kind: 'checkpoint' as const } }
      expect(replayPublicV23Transition(root.head, next)).toBe(true)
      expect(decodePublicV23Head(next, root.lineage)).toEqual(next)
    }
  })
})
