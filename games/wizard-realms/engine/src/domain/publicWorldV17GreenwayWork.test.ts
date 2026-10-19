import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { confirmPublicV17GreenwayWork as confirm,
  previewPublicV17GreenwayWork as preview } from './publicWorldV17GreenwayWork'
import { placementId, resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { createFreshPublicV17Head } from './publicWorldV17Snapshot'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import type { PublicV17Progress } from './publicWorldV17Validation'

const seed = 'wizard-realms'
const fresh = (): PublicV17Progress => {
  const { head } = createFreshPublicV17Head(seed)
  return { state: head.state, greenwayWorks: head.greenwayWorks }
}
function ready(id: string, logs: number): PublicV17Progress {
  const site = resolvePublicV17GreenwaySite(seed, id)
  if (!site || site.kind === 'dig') throw new Error(`Missing work ${id}`)
  const initial = fresh()
  const point = { x: site.from.x,
    z: site.from.z + (site.kind === 'bridge' ? -0.6 : 0.6) }
  const y = publicV17StarterSupportAt({ seed,
    profile: initial.state.generationProfile,
    route: initial.state.greenway.routes[0] ?? null,
    built: false, greenwayWorks: initial.greenwayWorks }, point)?.floorY
  if (y === undefined) throw new Error('No dry approach stance')
  const known = [...new Set([...decodeDiscoveredTileIds(initial.state.discoveryMask),
    ...site.footprintTileIds])].sort()
  return { ...initial, state: { ...initial.state,
    discoveryMask: encodeDiscoveredTileIds(known),
    player: { ...initial.state.player, position: { ...point, y },
      inventory: [...initial.state.player.inventory,
        { itemId: 'logs', quantity: logs }] } } }
}

describe('v17 free-placement confirmation', () => {
  it('confirms a snapped bridge through current-state checks and charges once', () => {
    const id = 'works4:bridge:greenway-creek:0'
    const before = ready(id, 8)
    expect(preview(before, id).rejection).toBeNull()
    const result = confirm(before, id)
    expect(result.rejection).toBeUndefined()
    expect(result.progress?.greenwayWorks.builtBridgeIds).toEqual([id])
    expect(result.event).toMatchObject({ id, kind: 'bridge', logsSpent: 8, xp: 80 })
    expect(before.greenwayWorks.builtBridgeIds).toEqual([])
    if (!result.progress) return
    expect(confirm(result.progress, id).rejection).toBe('already_done')
  })

  it('keeps preview advisory and rejects stale or forged confirmations', () => {
    const id = 'works4:ladder:greenway-north-cliff:11'
    const before = ready(id, 4)
    expect(preview(before, id).rejection).toBeNull()
    const noLogs = { ...before, state: { ...before.state,
      player: { ...before.state.player, inventory: before.state.player.inventory
        .filter((stack) => stack.itemId !== 'logs') } } }
    expect(confirm(noLogs, id).rejection).toBe('not_owned')
    expect(confirm(before, 'works4:ladder:greenway-north-cliff:011').rejection)
      .toBe('invalid_site')
  })

  it('builds a north-cliff ladder after a separate creek bridge', () => {
    const bridgeId = 'works4:bridge:greenway-creek:0'
    const ladderId = 'works4:ladder:greenway-north-cliff:11'
    const bridge = confirm(ready(bridgeId, 8), bridgeId)
    if (!bridge.progress) throw new Error(bridge.rejection)
    expect(preview(bridge.progress, 'works4:bridge:greenway-creek:1').rejection)
      .toBe('occupied')
    const ladder = resolvePublicV17GreenwaySite(seed, ladderId)
    if (!ladder || ladder.kind !== 'ladder') throw new Error('Missing ladder')
    const point = { x: ladder.from.x, z: ladder.from.z + 0.6 }
    const current = bridge.progress
    const y = publicV17StarterSupportAt({ seed, profile: current.state.generationProfile,
      route: current.state.greenway.routes[0] ?? null,
      built: false, greenwayWorks: current.greenwayWorks }, point)?.floorY
    if (y === undefined) throw new Error('Missing ladder stance')
    const known = [...new Set([...decodeDiscoveredTileIds(current.state.discoveryMask),
      ...ladder.footprintTileIds])].sort()
    const approach: PublicV17Progress = { ...current, state: { ...current.state,
      discoveryMask: encodeDiscoveredTileIds(known),
      player: { ...current.state.player, position: { ...point, y },
        inventory: [...current.state.player.inventory,
          { itemId: 'logs', quantity: 4 }] } } }
    expect(preview(approach, ladderId).rejection).toBeNull()
    const built = confirm(approach, ladderId)
    expect(built.progress?.greenwayWorks).toMatchObject({
      builtBridgeIds: [bridgeId], builtLadderIds: [ladderId] })
  })

  it('still blocks a works4 deck overlapping an existing works3 deck', () => {
    const legacy = resolvePublicV17GreenwaySite(seed, 'works3:bridge:1')
    if (!legacy || legacy.kind !== 'bridge') throw new Error('Missing legacy bridge')
    const freeId = placementId('bridge', legacy.from.x)
    if (!freeId || !resolvePublicV17GreenwaySite(seed, freeId)) {
      throw new Error('Missing snapped overlap site')
    }
    const built = confirm(ready(legacy.id, 8), legacy.id)
    if (!built.progress) throw new Error(built.rejection)
    expect(preview(built.progress, freeId).rejection).toBe('occupied')
  })
})
