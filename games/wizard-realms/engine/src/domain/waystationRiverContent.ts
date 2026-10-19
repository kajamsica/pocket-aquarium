import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import type { PublicV28RiverBridgeSite } from './publicWorldV28RiverBridgeSites'

/** Prefer the eastbound trail, then nearby columns, then the bounded outer search. */
export function waystationRiverSite(seed: string): PublicV28RiverBridgeSite | null {
  const columns = [20]
  for (let offset = 1; offset <= 8; offset++) columns.push(20 - offset, 20 + offset)
  for (let column = 29; column <= 48; column++) columns.push(column)
  for (const column of columns) {
    const site = resolvePublicV28RiverBridge(seed, `works6:river-bridge:${column}`)
    if (site) return site
  }
  return null
}
