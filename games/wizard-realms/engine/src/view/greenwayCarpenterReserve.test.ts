import { describe, expect, it } from 'vitest'
import { resolvePublicV17GreenwaySite } from '../domain/publicWorldV17GreenwaySites'
import { resolvePublicV28RiverBridge } from '../domain/publicWorldV28RiverBridgeSites'
import { createFreshPublicV43Root } from '../domain/publicWorldV43Snapshot'
import { greenwayCarpenterOrderStep, greenwayCarpenterReserve }
  from './greenwayCarpenterReserve'

const creekId = 'works4:bridge:greenway-creek:-14'
const ladderId = 'works4:ladder:greenway-north-cliff:11'
const riverId = 'works6:river-bridge:-14'
const fresh = (logs: number) => {
  const head = createFreshPublicV43Root('wizard-realms').head
  return { ...head, state: { ...head.state, player: { ...head.state.player,
    inventory: [...head.state.player.inventory, { itemId: 'logs' as const, quantity: logs }] } } }
}

describe('Greenway carpenter timber warning', () => {
  it('uses the checked route sequence and costs, then stops after all three routes are built', () => {
    const start = fresh(4)
    expect(resolvePublicV17GreenwaySite(start.state.seed, creekId))
      .toMatchObject({ kind: 'bridge', logCost: 8 })
    expect(resolvePublicV17GreenwaySite(start.state.seed, ladderId))
      .toMatchObject({ kind: 'ladder', logCost: 4 })
    expect(resolvePublicV28RiverBridge(start.state.seed, riverId)?.logCost).toBe(8)
    expect(greenwayCarpenterReserve(start)).toEqual({ route: 'creek bridge',
      required: 8, remaining: 0, shortfall: 8 })
    expect(greenwayCarpenterReserve(fresh(12))).toBeNull()
    const creek = { ...start, greenwayWorks: { ...start.greenwayWorks,
      builtBridgeIds: [creekId] } }
    expect(greenwayCarpenterReserve(creek)).toEqual({ route: 'north-cliff ladder',
      required: 4, remaining: 0, shortfall: 4 })
    const canonicalOnly = { ...creek, state: { ...creek.state,
      greenway: { ...creek.state.greenway,
        builtRouteIds: [...creek.state.greenway.builtRouteIds, 'greenway_ladder' as const] } } }
    expect(greenwayCarpenterReserve(canonicalOnly)).toEqual({ route: 'connected-river bridge',
      required: 8, remaining: 0, shortfall: 8 })
    const ladder = { ...creek, greenwayWorks: { ...creek.greenwayWorks,
      builtLadderIds: [ladderId] } }
    expect(greenwayCarpenterReserve(ladder)).toEqual({ route: 'connected-river bridge',
      required: 8, remaining: 0, shortfall: 8 })
    expect(greenwayCarpenterReserve({ ...ladder, riverBridgeIds: [riverId] })).toBeNull()
  })

  it('prompts before spending route timber, cancel leaves it untouched, and confirm submits once', () => {
    const warning = greenwayCarpenterReserve(fresh(8))!
    expect(warning).toMatchObject({ required: 8, remaining: 4, shortfall: 4 })
    const first = greenwayCarpenterOrderStep('offer', null, warning)
    expect(first).toEqual({ pending: warning, submit: false })
    expect(greenwayCarpenterOrderStep('cancel', first.pending, warning))
      .toEqual({ pending: null, submit: false })
    expect(greenwayCarpenterOrderStep('confirm', null, warning))
      .toEqual({ pending: warning, submit: false })
    expect(greenwayCarpenterOrderStep('confirm', first.pending, warning))
      .toEqual({ pending: null, submit: true })
    expect(greenwayCarpenterOrderStep('confirm', null, warning).submit).toBe(false)
    expect(greenwayCarpenterOrderStep('offer', null, null))
      .toEqual({ pending: null, submit: true })
  })

  it('requires another review if carried timber or the next checked route changes', () => {
    const first = greenwayCarpenterReserve(fresh(4))!
    const moreLogs = greenwayCarpenterReserve(fresh(8))!
    const afterCreek = greenwayCarpenterReserve({ ...fresh(4),
      greenwayWorks: { ...fresh(4).greenwayWorks, builtBridgeIds: [creekId] } })!
    expect(greenwayCarpenterOrderStep('confirm', first, moreLogs))
      .toEqual({ pending: moreLogs, submit: false })
    expect(greenwayCarpenterOrderStep('confirm', first, afterCreek))
      .toEqual({ pending: afterCreek, submit: false })
  })
})
