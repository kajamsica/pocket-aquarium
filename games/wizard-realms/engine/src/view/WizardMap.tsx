import type { WizardBuildSite, WizardMapTile, WizardRoute, WizardViewIntent, WizardViewProjection, WizardWorldOverview } from './contracts'
import type { RefObject } from 'react'

const TERRAIN = { loam: '#56824b', wetland: '#466f62', rocky: '#7b765e', snow: '#d4e3df' } as const

export const mapToggleForKey = (open: boolean, code: string, repeat = false) => code === 'KeyM' && !repeat ? !open : open
export const mapSheetMode = (width: number) => width < 720 ? 'sheet' : 'modal'
export const mapHeadingRotation = (yaw: number) => yaw
export const northUpGridOrder = <T extends { gridX: number; gridZ: number }>(tiles: readonly T[]) =>
  [...tiles].sort((left, right) => left.gridZ - right.gridZ || left.gridX - right.gridX)
export const mapDialogTabTarget = (open: boolean, code: string, shiftKey: boolean, activeIndex: number, count: number) =>
  open && code === 'Tab' && count > 0 ? (activeIndex < 0 ? shiftKey ? count - 1 : 0 : (activeIndex + (shiftKey ? -1 : 1) + count) % count) : null

export function mapCellForArrow(tiles: readonly WizardMapTile[], currentId: string, key: string): string | null {
  const current = tiles.find((tile) => tile.id === currentId)
  if (!current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return null
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight'
  const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1
  const axis = horizontal ? 'gridX' : 'gridZ'
  const fixed = horizontal ? 'gridZ' : 'gridX'
  return tiles.filter((tile) => tile.discovered && tile[fixed] === current[fixed] && (tile[axis] - current[axis]) * direction > 0)
    .sort((left, right) => Math.abs(left[axis] - current[axis]) - Math.abs(right[axis] - current[axis]))[0]?.id ?? currentId
}

function Tile({ tile, player, cacheLabel, onSelect, tabIndex, selected }: {
  tile: WizardMapTile; player: WizardViewProjection['map']['player']; cacheLabel: string
  onSelect?: (tileId: string) => void; tabIndex?: number; selected?: boolean
}) {
  const occupied = tile.gridX === player.gridX && tile.gridZ === player.gridZ
  const routeSite = tile.discovered && tile.hasRouteSite
  const builtRoute = tile.discovered && tile.hasBuiltRoute
  const waystone = tile.discovered && tile.hasWaystone
  const store = tile.discovered && tile.hasStore
  const camp = tile.discovered && tile.hasCamp
  const westTrail = tile.hasWestTrail === true
  const frontierMarker = tile.hasFrontierMarker === true
  const frontierTrail = tile.hasFrontierTrail === true
  const landmark = westTrail ? '⇦' : frontierMarker ? 'M' : tile.discovered
    ? camp ? 'C' : tile.hasCache ? '✦' : waystone ? 'W' : builtRoute ? '✓' : routeSite ? '◇' : store ? 'S' : tile.hasRing ? 'R' : tile.hasResource ? '•' : frontierTrail ? '·' : ''
    : frontierTrail ? '·' : '?'
  const Element = onSelect ? 'button' : 'span'
  return <Element type={onSelect ? 'button' : undefined} tabIndex={tabIndex} data-camp-tile={onSelect ? tile.id : undefined} aria-pressed={onSelect ? selected : undefined} onClick={onSelect ? () => onSelect(tile.id) : undefined} className="wr-map-tile" data-discovered={tile.discovered} style={{ position: 'relative', background: tile.terrain ? TERRAIN[tile.terrain as keyof typeof TERRAIN] : '#17201e' }} aria-label={`${tile.id}: ${tile.discovered ? tile.biome : 'unexplored'}${occupied ? ', player location' : ''}${westTrail ? ', west trail to Mireglass' : ''}${frontierTrail ? ', marked frontier trail' : ''}${frontierMarker ? ', frontier marker' : ''}${store ? ', store' : ''}${waystone ? ', Greenway waystone' : ''}${tile.discovered && tile.hasCache ? `, ${cacheLabel}` : ''}${routeSite ? ', route build site' : ''}${builtRoute ? ', completed route' : ''}${camp ? ', field camp' : ''}`}>
    <b style={occupied ? { transform: `rotate(${mapHeadingRotation(player.yaw)}rad)` } : undefined}>{occupied ? '▲' : landmark}</b>
    {occupied && (camp || westTrail || store || waystone) && <small aria-hidden="true" style={{ position: 'absolute', right: 0, bottom: 0, fontSize: 8, lineHeight: 1 }}>{camp ? 'C' : westTrail ? '⇦' : store ? 'S' : 'W'}</small>}
  </Element>
}

// A stable mount ref centers once, without resetting a player's scroll on world ticks.
function centerCampMap(node: HTMLSpanElement | null) {
  const cell = node?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
  if (!node || !cell) return
  node.scrollLeft = Math.max(0, cell.offsetLeft + cell.offsetWidth / 2 - node.clientWidth / 2)
  node.scrollTop = Math.max(0, cell.offsetTop + cell.offsetHeight / 2 - node.clientHeight / 2)
}

function MapGrid({ projection, compact = false, onSelect }: { projection: WizardViewProjection; compact?: boolean; onSelect?: (tileId: string) => void }) {
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
  const selectable = !compact && projection.fieldCamp?.selectionEnabled && onSelect
  const focusId = tiles.find((tile) => tile.discovered && tile.id === projection.fieldCamp?.preview?.tileId)?.id
    ?? tiles.find((tile) => tile.discovered && tile.gridX === projection.map.player.gridX && tile.gridZ === projection.map.player.gridZ)?.id
    ?? tiles.find((tile) => tile.discovered)?.id
  const grid = <span className="wr-map-grid" style={selectable
    ? { gridTemplateColumns: `repeat(${windowColumns}, 44px)`, gridAutoRows: 44, width: windowColumns * 46 - 2, aspectRatio: 'auto' }
    : { gridTemplateColumns: `repeat(${windowColumns}, minmax(0, 1fr))` }} aria-label="North-up world map, negative Z is north"
    onFocus={selectable ? (event) => {
      for (const button of event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-camp-tile]')) button.tabIndex = button === event.target ? 0 : -1
    } : undefined}
    onKeyDown={selectable ? (event) => {
      const id = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-camp-tile]')?.dataset.campTile
      const nextId = id ? mapCellForArrow(tiles, id, event.key) : null
      if (!nextId) return
      event.preventDefault()
      for (const button of event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-camp-tile]')) if (button.dataset.campTile === nextId) button.focus()
    } : undefined}>{tiles.map((tile) => <Tile key={tile.id} tile={tile} player={projection.map.player} cacheLabel={projection.map.cacheLabel ?? 'revealed cache'}
      onSelect={selectable && tile.discovered ? onSelect : undefined} tabIndex={selectable && tile.discovered ? tile.id === focusId ? 0 : -1 : undefined} selected={tile.id === projection.fieldCamp?.preview?.tileId} />)}</span>
  return selectable ? <span className="wr-map-camp-window" ref={centerCampMap}>{grid}</span> : grid
}

function OverviewGrid({ overview }: { overview: WizardWorldOverview }) {
  const cells = northUpGridOrder(overview.cells)
  const columns = Math.max(...cells.map(({ gridX }) => gridX)) - Math.min(...cells.map(({ gridX }) => gridX)) + 1
  return <span className="wr-overview-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} aria-label="Discovered world overview, north up, each square is 64 meters">
    {cells.map((cell) => {
      const occupied = cell.gridX === overview.player.gridX && cell.gridZ === overview.player.gridZ
      const marker = cell.markers.includes('Field camp') ? 'C' : cell.markers.find((label) => /Outfitters|Arcanum|salvager/.test(label)) ? 'S'
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
    {projection.fieldCamp?.selectionEnabled && <p className="wr-map-guidance">Scroll the map to choose discovered ground for a field camp. Arrow keys move between cells; Enter or Space previews one. Recipe: 4 logs + 1 stone.</p>}
    <MapGrid projection={projection} onSelect={(tileId) => { onIntent({ type: 'field-camp.select', tileId }); onToggle() }} />
    <RouteKey routes={projection.routes} buildSites={projection.buildSites} selectedBuildSiteId={projection.selectedBuildSiteId} onSelect={(siteId) => { onIntent({ type: 'build-site.select', siteId }); onToggle() }} />
    <p>{projection.map.legend ?? '▲ you · W waystone · ✦ revealed cache · ◇ route build site · ✓ completed route · S store · R fairy ring · • resource · ? unexplored'}{projection.fieldCamp && ' · C field camp'}</p>
  </>
  const overview = open ? projection.map.overview?.() : undefined
  return <>
    <button ref={buttonRef} className="wr-map-toggle" aria-expanded={open} aria-controls={open ? 'wizard-world-map' : undefined} onClick={onToggle}>
      <span className="wr-map-toggle-label"><span>Map</span><small>M</small></span>
      {!open && <span className="wr-map-compact" aria-hidden="true"><MapGrid projection={projection} compact /></span>}
    </button>
    {open && <div className="wr-map-backdrop"><section id="wizard-world-map" className="wr-map-dialog" role="dialog" aria-modal="true" aria-labelledby="wizard-world-map-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onToggle(); return }
        if (event.key !== 'Tab') return
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, summary, [href], input, select, textarea, [tabindex]')]
          .filter((control) => control.tabIndex >= 0 && !control.hasAttribute('disabled') && control.getClientRects().length > 0)
        const next = mapDialogTabTarget(true, event.key, event.shiftKey, controls.indexOf(document.activeElement as HTMLElement), controls.length)
        if (next !== null) { event.preventDefault(); controls[next].focus() }
      }}>
      <header><div><small>NORTH-UP EXPLORATION MAP</small><h2 id="wizard-world-map-title">{projection.map.title ?? 'Greenway atlas'}</h2></div><button ref={closeRef} onClick={onToggle} aria-label="Close map">×</button></header>
      {overview ? <>
        <style>{`.wr-map-overview[open]~.wr-map-local{display:none}.wr-map-overview>summary{box-sizing:border-box;display:flex;align-items:center;min-height:44px;margin:0 0 12px;padding:8px 12px;border:1px solid #d5b86f88;border-radius:8px;background:#283a30;color:#f5d889;cursor:pointer}.wr-map-overview>summary:focus-visible{outline:3px solid #ffe395;outline-offset:2px}.wr-overview-grid{display:grid;gap:2px;width:min(60vh,100%);margin:auto}.wr-overview-cell{position:relative;display:grid;place-items:center;min-width:0;aspect-ratio:1;border:1px solid #ffffff1b;background:#17201e;color:#fff;font-size:10px}.wr-overview-cell[data-discovered=false]{border-style:dashed}.wr-overview-cell i{position:absolute;inset:20%;border-radius:2px;opacity:.72}.wr-overview-cell b{position:relative}.wr-map-overview p,.wr-map-local>p{margin:10px 0;color:#b7c2b9;font-size:12px}`}</style>
        <details className="wr-map-overview"><summary>World overview (toggle local map)</summary>
          <p>Each square is 64 m. Color shows only a sample of visited ground; dark squares remain unexplored.</p>
          <OverviewGrid overview={overview} />
          <p>▲ you · S known store · R discovered ring · ✓ built route · ✦ revealed cache · ⇦ known trail · ? unexplored{projection.fieldCamp && ' · C field camp'}</p>
        </details>
        <div className="wr-map-local">{localMap}</div>
      </> : localMap}
    </section></div>}
  </>
}
