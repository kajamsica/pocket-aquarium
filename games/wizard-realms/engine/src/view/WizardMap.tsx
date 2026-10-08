import type { WizardBuildSite, WizardMapTile, WizardRoute, WizardViewIntent, WizardViewProjection } from './contracts'
import type { RefObject } from 'react'

const TERRAIN = { loam: '#56824b', wetland: '#466f62', rocky: '#7b765e', snow: '#d4e3df' } as const

export const mapToggleForKey = (open: boolean, code: string, repeat = false) => code === 'KeyM' && !repeat ? !open : open
export const mapSheetMode = (width: number) => width < 720 ? 'sheet' : 'modal'
export const mapHeadingRotation = (yaw: number) => yaw
export const northUpGridOrder = <T extends { gridX: number; gridZ: number }>(tiles: readonly T[]) =>
  [...tiles].sort((left, right) => left.gridZ - right.gridZ || left.gridX - right.gridX)
export const mapDialogTabTarget = (open: boolean, code: string, _shiftKey: boolean) => open && code === 'Tab' ? 'close' : null

function Tile({ tile, player }: { tile: WizardMapTile; player: WizardViewProjection['map']['player'] }) {
  const occupied = tile.gridX === player.gridX && tile.gridZ === player.gridZ
  const routeSite = tile.discovered && tile.hasRouteSite
  const builtRoute = tile.discovered && tile.hasBuiltRoute
  const marker = occupied ? '▲' : builtRoute ? '✓' : routeSite ? '◇' : tile.hasStore ? 'S' : tile.hasRing ? 'R' : tile.hasResource ? '•' : tile.discovered ? '' : '?'
  return <span className="wr-map-tile" data-discovered={tile.discovered} style={{ background: tile.terrain ? TERRAIN[tile.terrain as keyof typeof TERRAIN] : '#17201e' }} aria-label={`${tile.id}: ${tile.discovered ? tile.biome : 'unexplored'}${occupied ? ', player location' : ''}${routeSite ? ', route build site' : ''}${builtRoute ? ', completed route' : ''}`}>
    <b style={occupied ? { transform: `rotate(${mapHeadingRotation(player.yaw)}rad)` } : undefined}>{marker}</b>
  </span>
}

function MapGrid({ projection, compact = false }: { projection: WizardViewProjection; compact?: boolean }) {
  const allTiles = northUpGridOrder(projection.map.tiles)
  const minX = Math.min(...allTiles.map((tile) => tile.gridX))
  const maxX = Math.max(...allTiles.map((tile) => tile.gridX))
  const minZ = Math.min(...allTiles.map((tile) => tile.gridZ))
  const maxZ = Math.max(...allTiles.map((tile) => tile.gridZ))
  const columns = maxX - minX + 1
  const windowColumns = compact ? Math.min(columns, 7) : columns
  const windowRows = compact ? Math.min(maxZ - minZ + 1, 7) : maxZ - minZ + 1
  const startX = Math.max(minX, Math.min(projection.map.player.gridX - Math.floor(windowColumns / 2), maxX - windowColumns + 1))
  const startZ = Math.max(minZ, Math.min(projection.map.player.gridZ - Math.floor(windowRows / 2), maxZ - windowRows + 1))
  const tiles = compact ? allTiles.filter((tile) => tile.gridX >= startX && tile.gridX < startX + windowColumns && tile.gridZ >= startZ && tile.gridZ < startZ + windowRows) : allTiles
  return <span className="wr-map-grid" style={{ gridTemplateColumns: `repeat(${windowColumns}, minmax(0, 1fr))` }} aria-label="North-up world map, negative Z is north">{tiles.map((tile) => <Tile key={tile.id} tile={tile} player={projection.map.player} />)}</span>
}

export function RouteKey({ routes, buildSites, selectedBuildSiteId, onSelect }: {
  routes: readonly WizardRoute[]
  buildSites: readonly WizardBuildSite[]
  selectedBuildSiteId: string | null
  onSelect: (siteId: string) => void
}) {
  return <div className="wr-map-routes">{routes.map((route) => {
    const candidates = buildSites.filter((site) => site.routeId === route.id && site.discovered && site.status !== 'built')
    return <section key={route.id}>
      <h3>{route.built ? '✓' : route.unlocked ? '◇' : '×'} {route.label} <small>{route.built ? 'completed' : route.unlocked ? `${route.logCost} logs` : 'locked'}</small></h3>
      {!route.built && candidates.map((site) => <button key={site.id} type="button" className="wr-map-site" aria-label={`Preview ${site.label}`} aria-pressed={selectedBuildSiteId === site.id} onClick={() => onSelect(site.id)}>
        <span>{site.label} <small>{site.logCost} logs</small></span><small>{site.reason || 'Ready to build'}</small>
      </button>)}
      {!route.built && candidates.length === 0 && <small>No discovered build sites.</small>}
    </section>
  })}</div>
}

export function WizardMap({ projection, open, onToggle, onIntent, buttonRef, closeRef }: {
  projection: WizardViewProjection
  open: boolean
  onToggle: () => void
  onIntent: (intent: WizardViewIntent) => void
  buttonRef: RefObject<HTMLButtonElement | null>
  closeRef: RefObject<HTMLButtonElement | null>
}) {
  return <>
    <button ref={buttonRef} className="wr-map-toggle" aria-expanded={open} aria-controls={open ? 'wizard-world-map' : undefined} onClick={onToggle}>
      <span className="wr-map-toggle-label"><span>Map</span><small>M</small></span>
      {!open && <span className="wr-map-compact" aria-hidden="true"><MapGrid projection={projection} compact /></span>}
    </button>
    {open && <div className="wr-map-backdrop"><section id="wizard-world-map" className="wr-map-dialog" role="dialog" aria-modal="true" aria-labelledby="wizard-world-map-title">
      <header><div><small>NORTH-UP EXPLORATION MAP</small><h2 id="wizard-world-map-title">{projection.map.title ?? 'Greenway atlas'}</h2></div><button ref={closeRef} onClick={onToggle} aria-label="Close map">×</button></header>
      <MapGrid projection={projection} />
      <RouteKey routes={projection.routes} buildSites={projection.buildSites} selectedBuildSiteId={projection.selectedBuildSiteId} onSelect={(siteId) => { onIntent({ type: 'build-site.select', siteId }); onToggle() }} />
      <p>{projection.map.legend ?? '▲ you · ◇ route build site · ✓ completed route · S store · R fairy ring · • resource · ? unexplored'}</p>
    </section></div>}
  </>
}
