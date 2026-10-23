import { publicV17NorthCliffLadderBuilt, resolvePublicV17GreenwaySite }
  from '../domain/publicWorldV17GreenwaySites'
import { resolvePublicV28RiverBridge } from '../domain/publicWorldV28RiverBridgeSites'
import type { PublicV43Progress } from '../domain/publicWorldV43Snapshot'
import { GREENWAY_LOG_ORDER } from '../domain/greenwayProcurementOrder'

export type GreenwayCarpenterReserve = Readonly<{
  route: string; required: number; remaining: number; shortfall: number
}>

/** Warn only for the next unbuilt, checked first-region route. This never blocks fulfillment. */
export function greenwayCarpenterReserve(progress: Pick<PublicV43Progress,
  'state' | 'greenwayWorks' | 'riverBridgeIds'>): GreenwayCarpenterReserve | null {
  const { seed } = progress.state
  const creekBuilt = progress.greenwayWorks.builtBridgeIds.some((id) => {
    const site = resolvePublicV17GreenwaySite(seed, id)
    return site?.kind === 'bridge' && site.obstacle === 'greenway_creek'
  })
  const ladderBuilt = publicV17NorthCliffLadderBuilt(seed,
    progress.state.greenway.builtRouteIds.includes('greenway_ladder'),
    progress.greenwayWorks.builtLadderIds)
  const riverBuilt = progress.riverBridgeIds.some((id) =>
    resolvePublicV28RiverBridge(seed, id) !== null)
  const next = !creekBuilt ? { route: 'creek bridge', required: 8 }
    : !ladderBuilt ? { route: 'north-cliff ladder', required: 4 }
      : !riverBuilt ? { route: 'connected-river bridge', required: 8 } : null
  if (!next) return null
  const carried = progress.state.player.inventory.reduce((sum, stack) =>
    sum + (stack.itemId === GREENWAY_LOG_ORDER.itemId ? stack.quantity : 0), 0)
  const remaining = carried - GREENWAY_LOG_ORDER.quantity
  return remaining < next.required ? { ...next,
    remaining, shortfall: next.required - remaining } : null
}

export function greenwayCarpenterOrderStep(request: 'offer' | 'confirm' | 'cancel',
  pending: GreenwayCarpenterReserve | null,
  current: GreenwayCarpenterReserve | null): Readonly<{
    pending: GreenwayCarpenterReserve | null; submit: boolean
  }> {
  if (request === 'cancel') return { pending: null, submit: false }
  if (request === 'offer') return current
    ? { pending: current, submit: false } : { pending: null, submit: true }
  const unchanged = pending && current && pending.route === current.route
    && pending.required === current.required && pending.remaining === current.remaining
  return unchanged ? { pending: null, submit: true }
    : { pending: current, submit: false }
}
