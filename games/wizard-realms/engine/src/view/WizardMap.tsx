import type { WizardBuildSite, WizardMapTile, WizardRoute, WizardViewIntent, WizardViewProjection, WizardWorldOverview } from './contracts'
import type { RefObject } from 'react'

const TERRAIN = { loam: '#56824b', wetland: '#466f62', rocky: '#7b765e', snow: '#d4e3df' } as const

export const mapToggleForKey = (open: boolean, code: string, repeat = false) => code === 'KeyM' && !repeat ? !open : open
export const mapSheetMode = (width: number) => width < 720 ? 'sheet' : 'modal'
export const mapHeadingRotation = (yaw: number) => yaw
export const northUpGridOrder = <T extends { gridX: number; gridZ: number }>(tiles: readonly T[]) =>
  [...tiles].sort((left, right) => left.gridZ - right.gridZ || left.gridX - right.gridX)
export const mapDialogTabTarget = (open: boolean, code: string, _shiftKey: boolean) => open && code === 'Tab' ? 'close' : null

function Tile({ tile, player, cacheLabel }: { tile: WizardMapTile; player: WizardViewProjection['map']['player']; cacheLabel: string }) {
  const occupied = tile.gridX === player.gridX && tile.gridZ === player.gridZ
  const routeSite = tile.discovered && tile.hasRouteSite
  const builtRoute = tile.discovered && tile.hasBuiltRoute
  const waystone = tile.discovered && tile.hasWaystone
  const store = tile.discovered && tile.hasStore
  const westTrail = tile.hasWestTrail === true
  const frontierMarker = tile.hasFrontierMarker === true
  const frontierTrail = tile.hasFrontierTrail === true
  const landmark = westTrail ? '⇦' : frontierMarker ? 'M' : tile.discovered
    ? tile.hasCache ? '✦' : waystone ? 'W' : builtRoute ? '✓' : routeSite ? '◇' : store ? 'S' : tile.hasRing ? 'R' : tile.hasResource ? '•' : frontierTrail ? '·' : ''
    : frontierTrail ? '·' : '?'
  return <span className="wr-map-tile" data-discovered={tile.discovered} style={{ position: 'relative', background: tile.terrain ? TERRAIN[tile.terrain as keyof typeof TERRAIN] : '#17201e' }} aria-label={`${tile.id}: ${tile.discovered ? tile.biome : 'unexplored'}${occupied ? ', player location' : ''}${westTrail ? ', west trail to Mireglass' : ''}${frontierTrail ? ', marked frontier trail' : ''}${frontierMarker ? ', frontier marker' : ''}${store ? ', store' : ''}${waystone ? ', Greenway waystone' : ''}${tile.discovered && tile.hasCache ? `, ${cacheLabel}` : ''}${routeSite ? ', route build site' : ''}${builtRoute ? ', completed route' : ''}`}>
    <b style={occupied ? { transform: `rotate(${mapHeadingRotation(player.yaw)}rad)` } : undefined}>{occupied ? '▲' : landmark}</b>
    {occupied && (westTrail || store || waystone) && <small aria-hidden="true" style={{ position: 'absolute', right: 0, bottom: 0, fontSize: 8, lineHeight: 1 }}>{westTrail ? '⇦' : store ? 'S' : 'W'}</small>}
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
  return <span className="wr-map-grid" style={{ gridTemplateColumns: `repeat(${windowColumns}, minmax(0, 1fr))` }} aria-label="North-up world map, negative Z is north">{tiles.map((tile) => <Tile key={tile.id} tile={tile} player={projection.map.player} cacheLabel={projection.map.cacheLabel ?? 'revealed cache'} />)}</span>
}

function OverviewGrid({ overview }: { overview: WizardWorldOverview }) {
  const cells = northUpGridOrder(overview.cells)
  const columns = Math.max(...cells.map(({ gridX }) => gridX)) - Math.min(...cells.map(({ gridX }) => gridX)) + 1
  return <span className="wr-overview-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} aria-label="Discovered world overview, north up, each square is 64 meters">
    {cells.map((cell) => {
      const occupied = cell.gridX === overview.player.gridX && cell.gridZ === overview.player.gridZ
      const marker = cell.markers.find((label) => /Outfitters|Arcanum|salvager/.test(label)) ? 'S'
        : cell.markers.some((label) => /Ring/.test(label)) ? 'R'
          : cell.markers.some((label) => /built/.test(label)) ? '✓'
            : cell.markers.some((label) => /cache/.test(label)) ? '✦'
              : cell.markers.some((label) => /trail/.test(label)) ? '⇦'
                : cell.markers.some((label) => /waystone/.test(label)) ? 'W'
                  : cell.markers.length ? '•' : cell.discoveredCells ? '·' : '?'
      const exploration = cell.discoveredCells === 0 ? 'unexplored'
        : `${cell.discoveredCells} of 256 cells discovered, sampled ${cell.biome}`
      return <span key={cell.id} className="wr-overview-cell" data-discovered={cell.discoveredCells > 0}
        aria-label={`${cell.id}: ${exploration}${occupied ? ', player location' : ''}${cell.markers.length ? `, ${cell.markers.join(', ')}` : ''}`}>
        {cell.terrain && <i aria-hidden="true" style={{ background: TERRAIN[cell.terrain] }} />}
        <b style={occupied ? { transform: `rotate(${mapHeadingRotation(overview.player.yaw)}rad)` } : undefined}>{occupied ? '▲' : marker}</b>
      </span>
    })}
  </span>
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
      {route.built && <small>Walk to either end and press E to cross. Walking into the edge alone will not cross it.</small>}
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
  const localMap = <>
    {projection.map.guidance && <p className="wr-map-guidance" role="note" aria-label="Map guidance">{projection.map.guidance}</p>}
    <MapGrid projection={projection} />
    <RouteKey routes={projection.routes} buildSites={projection.buildSites} selectedBuildSiteId={projection.selectedBuildSiteId} onSelect={(siteId) => { onIntent({ type: 'build-site.select', siteId }); onToggle() }} />
    <p>{projection.map.legend ?? '▲ you · W waystone · ✦ revealed cache · ◇ route build site · ✓ completed route · S store · R fairy ring · • resource · ? unexplored'}</p>
  </>
  const overview = open ? projection.map.overview?.() : undefined
  return <>
    <button ref={buttonRef} className="wr-map-toggle" aria-expanded={open} aria-controls={open ? 'wizard-world-map' : undefined} onClick={onToggle}>
      <span className="wr-map-toggle-label"><span>Map</span><small>M</small></span>
      {!open && <span className="wr-map-compact" aria-hidden="true"><MapGrid projection={projection} compact /></span>}
    </button>
    {open && <div className="wr-map-backdrop"><section id="wizard-world-map" className="wr-map-dialog" role="dialog" aria-modal="true" aria-labelledby="wizard-world-map-title">
      <header><div><small>NORTH-UP EXPLORATION MAP</small><h2 id="wizard-world-map-title">{projection.map.title ?? 'Greenway atlas'}</h2></div><button ref={closeRef} onClick={onToggle} aria-label="Close map">×</button></header>
      {overview ? <>
        <style>{`.wr-map-overview[open]~.wr-map-local{display:none}.wr-map-overview>summary{box-sizing:border-box;display:flex;align-items:center;min-height:44px;margin:0 0 12px;padding:8px 12px;border:1px solid #d5b86f88;border-radius:8px;background:#283a30;color:#f5d889;cursor:pointer}.wr-map-overview>summary:focus-visible{outline:3px solid #ffe395;outline-offset:2px}.wr-overview-grid{display:grid;gap:2px;width:min(60vh,100%);margin:auto}.wr-overview-cell{position:relative;display:grid;place-items:center;min-width:0;aspect-ratio:1;border:1px solid #ffffff1b;background:#17201e;color:#fff;font-size:10px}.wr-overview-cell[data-discovered=false]{border-style:dashed}.wr-overview-cell i{position:absolute;inset:20%;border-radius:2px;opacity:.72}.wr-overview-cell b{position:relative}.wr-map-overview p,.wr-map-local>p{margin:10px 0;color:#b7c2b9;font-size:12px}`}</style>
        <details className="wr-map-overview"><summary>World overview (toggle local map)</summary>
          <p>Each square is 64 m. Color shows only a sample of visited ground; dark squares remain unexplored.</p>
          <OverviewGrid overview={overview} />
          <p>▲ you · S known store · R discovered ring · ✓ built route · ✦ revealed cache · ⇦ known trail · ? unexplored</p>
        </details>
        <div className="wr-map-local">{localMap}</div>
      </> : localMap}
    </section></div>}
  </>
}
