import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { resolvePublicV16GreenwaySite } from './publicWorldV16GreenwaySites'
import type { PublicV16GreenwaySite } from './publicWorldV16GreenwaySites'
import { confirmPublicV16GreenwayWork as confirm, previewPublicV16GreenwayWork as preview } from './publicWorldV16GreenwayWork'
import { createFreshPublicV16Head } from './publicWorldV16Snapshot'
import { publicV16StarterSupportAt } from './publicWorldV16StarterMovement'
import type { PublicV16Progress } from './publicWorldV16Validation'
type Bridge = Extract<PublicV16GreenwaySite, { kind: 'bridge' }>
type Ladder = Extract<PublicV16GreenwaySite, { kind: 'ladder' }>
type Dig = Extract<PublicV16GreenwaySite, { kind: 'dig' }>
const seed = 'wizard-realms'
const start = (worldSeed = seed): PublicV16Progress => {
  const { head } = createFreshPublicV16Head(worldSeed)
  return { state: head.state, greenwayWorks: head.greenwayWorks }
}
function at(progress: PublicV16Progress, x: number, z: number): PublicV16Progress {
  const state = progress.state
  const route = state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null
  const y = publicV16StarterSupportAt({ seed: state.seed, profile: state.generationProfile,
    route, built: state.greenway.builtRouteIds.includes('greenway_ladder'),
    greenwayWorks: progress.greenwayWorks }, { x, z })?.floorY
  if (y === undefined) throw new Error(`Unsupported stance: ${x}, ${z}`)
  return { ...progress, state: { ...state, player: { ...state.player,
    position: { x, y, z } } } }
}
const reveal = (progress: PublicV16Progress, ids: readonly string[]): PublicV16Progress => ({
  ...progress, state: { ...progress.state, discoveryMask: encodeDiscoveredTileIds(
    [...new Set([...decodeDiscoveredTileIds(progress.state.discoveryMask), ...ids])].sort()) } })
const logs = (progress: PublicV16Progress, quantity: number): PublicV16Progress => ({
  ...progress, state: { ...progress.state, player: { ...progress.state.player,
    inventory: [...progress.state.player.inventory, { itemId: 'logs', quantity }] } } })
const spade = (progress: PublicV16Progress): PublicV16Progress => ({
  ...progress, state: { ...progress.state, player: { ...progress.state.player,
    inventory: [...progress.state.player.inventory, { itemId: 'field_spade', quantity: 1 }],
    equipment: { ...progress.state.player.equipment, mainHand: 'field_spade' } } } })
const rejection = (progress: PublicV16Progress, id: string) => confirm(progress, id).rejection
function stance(work: PublicV16GreenwaySite): { x: number; z: number } {
  return work.kind === 'dig' ? {
    x: work.center.x + Math.sign(work.adjacentStance.x - work.center.x) * 2.1,
    z: work.center.z + Math.sign(work.adjacentStance.z - work.center.z) * 2.1,
  } : { x: work.from.x, z: work.from.z + (work.kind === 'bridge' ? -0.6 : 0.6) }
}
function ready(worldSeed: string, work: PublicV16GreenwaySite): PublicV16Progress {
  const point = stance(work)
  return reveal(at(start(worldSeed), point.x, point.z), work.footprintTileIds)
}

describe('pure v16 Greenway works confirmation', () => {
  it('builds a clear shifted bridge once, with one reward and no input mutation', () => {
    const bridge = resolvePublicV16GreenwaySite(seed, 'works3:bridge:1') as Bridge
    expect(bridge.from.x).not.toBe(4)
    const nearBank = at(start(), bridge.from.x, bridge.from.z - 0.6)
    const walkedReveal = nearbyWorldTileIds(nearBank.state.player.position,
      PUBLIC_WALK_REVEAL_RADIUS_METERS)
    expect(bridge.footprintTileIds.every((id) => walkedReveal.includes(id))).toBe(true)
    const current = logs(reveal(nearBank, walkedReveal), 8), original = structuredClone(current)
    expect(preview(current, bridge.id).rejection).toBeNull()
    const result = confirm(current, bridge.id)
    expect(current).toEqual(original)
    expect(result.progress?.greenwayWorks.builtBridgeIds).toEqual([bridge.id])
    expect(result.progress?.state.player.inventory.some((stack) => stack.itemId === 'logs')).toBe(false)
    expect(result.progress?.state.player.skillXp.construction).toBe(80)
    expect(result.progress?.state.player.xp).toBe(80)
    expect({ ...result.progress?.state, player: current.state.player,
      eventSequence: current.state.eventSequence }).toEqual(current.state)
    expect(result.event).toEqual({ kind: 'bridge', type: 'terrain_work_built', id: bridge.id,
      tick: current.state.tick, sequence: current.state.eventSequence + 1,
      logsSpent: 8, stoneGained: 0, xp: 80 })
    expect(rejection(result.progress!, bridge.id)).toBe('already_done')
  })

  it('requires current zero-health depletion of every blocking tree', () => {
    const blockedSeed = 'p29-seed-0'
    const bridge = resolvePublicV16GreenwaySite(blockedSeed, 'works3:bridge:1') as Bridge
    const current = logs(ready(blockedSeed, bridge), 8)
    expect(preview(current, bridge.id).rejection).toBe('occupied')
    const changed = (health: boolean): PublicV16Progress => ({ ...current,
      state: { ...current.state, greenway: { ...current.state.greenway,
        resources: current.state.greenway.resources.map((resource) =>
          bridge.blockingResourceIds.includes(resource.id)
            ? { ...resource, depleted: true, health: health ? 0 : resource.health } : resource) } } })
    expect(rejection(changed(false), bridge.id)).toBe('occupied')
    expect(confirm(changed(true), bridge.id).progress?.greenwayWorks.builtBridgeIds)
      .toEqual([bridge.id])
  })

  it('builds a clear offcenter ladder with four logs and a distinct event kind', () => {
    const ladder = [-3, -2, -1, 2, 3].map((gx) =>
      resolvePublicV16GreenwaySite(seed, `works3:ladder:${gx}`))
      .find((candidate): candidate is Ladder => candidate?.kind === 'ladder'
        && candidate.blockingResourceIds.length === 0)!
    const result = confirm(logs(ready(seed, ladder), 4), ladder.id)
    expect(result.event).toMatchObject({ kind: 'ladder', type: 'terrain_work_built',
      logsSpent: 4, stoneGained: 0, xp: 60 })
    expect(result.progress?.greenwayWorks.builtLadderIds).toEqual([ladder.id])
  })

  it('digs from a supported stance with an equipped spade and room for stone', () => {
    const dig = resolvePublicV16GreenwaySite(seed, 'works3:dig:1:3') as Dig
    const current = ready(seed, dig)
    expect(rejection(current, dig.id)).toBe('requires_spade')
    const equipped = spade(current)
    expect(rejection(at(equipped, dig.center.x, dig.center.z), dig.id)).toBe('occupied')
    const full = { ...equipped, state: { ...equipped.state, player: {
      ...equipped.state.player, backpackCapacity: equipped.state.player.inventory
        .reduce((sum, stack) => sum + stack.quantity, 0) } } }
    expect(rejection(full, dig.id)).toBe('capacity')
    const result = confirm(equipped, dig.id)
    expect(result.event).toMatchObject({ kind: 'dig', type: 'terrain_work_dug',
      logsSpent: 0, stoneGained: 1, xp: 30 })
    expect(result.progress?.state.player.inventory.find((stack) => stack.itemId === 'stone'))
      .toEqual({ itemId: 'stone', quantity: 1 })
    expect(result.progress?.greenwayWorks.dugTileIds).toEqual([dig.id])
  })

  it('accepts an adjacent dig stance between 3 and 4 m without allowing underfoot digging', () => {
    const dig = resolvePublicV16GreenwaySite(seed, 'works3:dig:1:3') as Dig
    const x = dig.center.x + Math.sign(dig.adjacentStance.x - dig.center.x) * 3.6
    const z = dig.center.z + Math.sign(dig.adjacentStance.z - dig.center.z) * 3.6
    const current = spade(reveal(at(start(), x, z), dig.footprintTileIds))
    const position = current.state.player.position
    const distance = Math.hypot(position.x - dig.center.x, position.y - dig.center.y,
      position.z - dig.center.z)
    expect(distance).toBeGreaterThan(3)
    expect(distance).toBeLessThanOrEqual(4)
    expect(preview(current, dig.id).rejection).toBeNull()
    expect(confirm(current, dig.id).progress?.greenwayWorks.dugTileIds).toEqual([dig.id])
    expect(rejection(at(current, dig.center.x, dig.center.z), dig.id)).toBe('occupied')
    expect(rejection(at(current, dig.center.x + Math.sign(x - dig.center.x) * 4.2,
      dig.center.z + Math.sign(z - dig.center.z) * 4.2), dig.id)).toBe('too_far')
  })

  it('keeps bridge and ladder confirmation at 3 m reach', () => {
    const bridge = resolvePublicV16GreenwaySite(seed, 'works3:bridge:1') as Bridge
    const ladder = [-3, -2, -1, 2, 3].map((gx) =>
      resolvePublicV16GreenwaySite(seed, `works3:ladder:${gx}`))
      .find((candidate): candidate is Ladder => candidate?.kind === 'ladder'
        && candidate.blockingResourceIds.length === 0)!
    for (const [site, z] of [[bridge, bridge.from.z - 3.5],
      [ladder, ladder.from.z + 3.5]] as const) {
      const current = logs(reveal(at(start(), site.from.x, z), site.footprintTileIds), 8)
      const position = current.state.player.position
      const distance = Math.hypot(position.x - site.from.x, position.y - site.from.y,
        position.z - site.from.z)
      expect(distance).toBeGreaterThan(3)
      expect(distance).toBeLessThanOrEqual(4)
      expect(preview(current, site.id).rejection).toBe('too_far')
      expect(rejection(current, site.id)).toBe('too_far')
    }
  })

  it('rejects forged, hidden, distant, underfunded, and underfoot sites', () => {
    const bridge = resolvePublicV16GreenwaySite(seed, 'works3:bridge:1') as Bridge
    const current = logs(ready(seed, bridge), 8)
    expect(rejection(current, 'works3:bridge:01')).toBe('invalid_site')
    expect(rejection(current, 'works3:ladder:1')).toBe('invalid_site')
    expect(rejection({ ...current, greenwayWorks: { ...current.greenwayWorks,
      builtBridgeIds: ['works3:bridge:01'] } }, bridge.id)).toBe('invalid_progress')
    const hidden = { ...current, state: { ...current.state,
      discoveryMask: encodeDiscoveredTileIds(decodeDiscoveredTileIds(current.state.discoveryMask)
        .filter((id) => id !== bridge.footprintTileIds[4])) } }
    expect(rejection(hidden, bridge.id)).toBe('undiscovered')
    expect(rejection(at(current, bridge.from.x, 0), bridge.id)).toBe('too_far')
    expect(rejection(logs(ready(seed, bridge), 7), bridge.id)).toBe('not_owned')
    expect(rejection(at(current, bridge.from.x, bridge.from.z), bridge.id)).toBe('occupied')
    const water = { ...current, state: { ...current.state, player: {
      ...current.state.player, position: { x: bridge.from.x, y: 0, z: 8 } } } }
    expect(rejection(water, bridge.id)).toBe('invalid_progress')
  })

  it('rejects a dig footprint that overlaps a built bridge', () => {
    const bridge = resolvePublicV16GreenwaySite(seed, 'works3:bridge:1') as Bridge
    const built = confirm(logs(ready(seed, bridge), 8), bridge.id).progress!
    const overlap = [-2, -1, 0, 1, 2].flatMap((gx) => [0, 1, 3, 4].map((gz) =>
      resolvePublicV16GreenwaySite(seed, `works3:dig:${gx}:${gz}`)))
      .find((candidate): candidate is Dig => candidate?.kind === 'dig'
        && candidate.footprintTileIds.some((id) => bridge.footprintTileIds.includes(id)))!
    const point = stance(overlap)
    const candidate = spade(reveal(at(built, point.x, point.z), overlap.footprintTileIds))
    expect(rejection(candidate, overlap.id)).toBe('occupied')
  })
})
