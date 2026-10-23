import type { WizardBuildSite, WizardMapTile, WizardRoute, WizardSavedTerrainWorksView, WizardViewIntent, WizardViewProjection, WizardWorldOverview } from './contracts'
import type { TerrainWorkSite } from '../domain/terrainWorks'
import { PUBLIC_V15_STARTER_CREEK_BOUNDS } from '../domain/publicWorldV15StarterSites'
import { useState, type RefObject } from 'react'

const TERRAIN = { loam: '#56824b', wetland: '#466f62', rocky: '#7b765e', snow: '#d4e3df' } as const
const naturalShelf = (tile: WizardMapTile) => tile.discovered
  && tile.hasNaturalMireglassShelf === true && tile.hasRaisedSoil !== true
  && tile.elevationMeters === undefined

export const mapToggleForKey = (open: boolean, code: string, repeat = false) => code === 'KeyM' && !repeat ? !open : open
export const mapSheetMode = (width: number) => width < 720 ? 'sheet' : 'modal'
// World forward is (-sin(yaw), -cos(yaw)); CSS rotation is clockwise on a north-up map.
export const mapHeadingRotation = (yaw: number) => yaw === 0 ? 0 : -yaw
export const northUpGridOrder = <T extends { gridX: number; gridZ: number }>(tiles: readonly T[]) =>
  [...tiles].sort((left, right) => left.gridZ - right.gridZ || left.gridX - right.gridX)
export const mapDialogTabTarget = (open: boolean, code: string, shiftKey: boolean, activeIndex: number, count: number) =>
  open && code === 'Tab' && count > 0 ? (activeIndex < 0 ? shiftKey ? count - 1 : 0 : (activeIndex + (shiftKey ? -1 : 1) + count) % count) : null

const discoveredFootprint = (site: Pick<TerrainWorkSite, 'footprintTileIds'>, known: ReadonlySet<string>) =>
  site.footprintTileIds.every((id) => known.has(id))
/** Mirror V17's bridge/dig physical bounds for map choices; confirmation remains authoritative. */
const underBuiltBridge = (dig: Extract<TerrainWorkSite, { kind: 'dig' }>,
  builtSites: WizardSavedTerrainWorksView['builtSites']) => builtSites.some((site) => {
  if (site.kind !== 'bridge') return false
  const halfWidth = site.widthMeters / 2 + 0.04
  const nearZ = Math.min(site.from.z, site.to.z) - 0.5
  const farZ = Math.max(site.from.z, site.to.z) + 0.5
  return dig.center.x - 2 < site.from.x + halfWidth
    && site.from.x - halfWidth < dig.center.x + 2
    && dig.center.z - 2 < farZ && nearZ < dig.center.z + 2
})
const revealedDigChoices = (sites: readonly TerrainWorkSite[], dugTileIds: readonly string[],
  builtSites: WizardSavedTerrainWorksView['builtSites'],
  position?: WizardViewProjection['player']['position']) => {
  const available = [...new Map(sites.filter((site): site is Extract<TerrainWorkSite, { kind: 'dig' }> =>
    site.kind === 'dig' && !dugTileIds.includes(site.footprintTileIds[0])
      && !underBuiltBridge(site, builtSites))
    .map((site) => [site.id, site] as const)).values()]
  const distance = (site: (typeof available)[number]) => position
    ? Math.hypot(position[0] - site.center.x, position[2] - site.center.z) : Infinity
  const nearby = available.filter((site) => distance(site) <= 5)
    .sort((left, right) => distance(left) - distance(right))
  const fallback = available.find((site) => site.center.z > PUBLIC_V15_STARTER_CREEK_BOUNDS.farZ)
    ?? available[0]
  return nearby.length ? nearby : fallback ? [fallback] : []
}
const digBank = (z: number) => z > PUBLIC_V15_STARTER_CREEK_BOUNDS.farZ ? 'far-bank'
  : z < PUBLIC_V15_STARTER_CREEK_BOUNDS.nearZ ? 'near-bank' : 'dry-loam'

/** Precise directions use discovered site geometry, not the coarse 4 m map glyph. */
export function greenwayWorkRouteNotes(position: WizardViewProjection['player']['position'],
  mapTiles: readonly Pick<WizardMapTile, 'id' | 'discovered'>[],
  works: WizardSavedTerrainWorksView | undefined,
  visibleTileIds?: ReadonlySet<string> | null, v26Terrain = false): string[] {
  if (works?.context !== 'works4-greenway') return []
  const at = (value: number) => Number(value.toFixed(1)).toFixed(1)
  const known = new Set(mapTiles.filter((tile) => tile.discovered).map((tile) => tile.id))
  const sites = [...works.builtSites, ...(works.suggestedSites ?? []),
    ...(works.preview?.nearby.map((choice) => choice.site) ?? [])]
    .filter((site) => discoveredFootprint(site, known)
      && (!visibleTileIds || discoveredFootprint(site, visibleTileIds)))
  const built = new Set(works.builtSites.map((site) => site.id))
  const notes = [`You are at x ${at(position[0])}, z ${at(position[2])} m, elevation ${at(position[1])} m. ▲ marks a 4 m cell, not exact alignment.`]
  const bridge = sites.find((site) => site.kind === 'bridge')
  if (bridge?.kind === 'bridge') {
    const half = bridge.widthMeters / 2
    const center = bridge.from.x
    const near = Math.abs(position[2] - bridge.from.z) <= Math.abs(position[2] - bridge.to.z)
    const foot = near ? bridge.from : bridge.to
    const opposite = near ? bridge.to : bridge.from
    const bank = near ? 'north/shop' : 'south/far'
    const across = foot.z < opposite.z ? 'south' : 'north'
    if (built.has(bridge.id)) {
      const midZ = (bridge.from.z + bridge.to.z) / 2
      const onDeck = Math.abs(position[0] - center) <= half
        && Math.abs(position[2] - midZ) < Math.abs(bridge.to.z - bridge.from.z) / 4
      const stagingZ = near
        ? Math.min(foot.z - 1, PUBLIC_V15_STARTER_CREEK_BOUNDS.nearZ - 1)
        : Math.max(foot.z + 1, PUBLIC_V15_STARTER_CREEK_BOUNDS.farZ + 1)
      const lateralDirection = position[0] < center - half ? 'east'
        : position[0] > center + half ? 'west' : null
      const lateral = lateralDirection
        ? `Retreat or stay ${near ? 'north' : 'south'} on dry ground to z ${at(stagingZ)} or ${near ? 'less' : 'more'}; then move ${lateralDirection} along that dry bank to x ${at(center)} before moving ${across} to foot z ${at(foot.z)}. `
        : ''
      notes.push(onDeck
        ? `On the bridge: stay within x ${at(center - half)} to ${at(center + half)}; follow the deck to a dry foot, not the water beside it.`
        : `Built bridge: ${lateral}Stay on the ${bank} dry bank and align at foot x ${at(foot.x)}, z ${at(foot.z)}; lane x ${at(center - half)} to ${at(center + half)}. Face ${across} and walk straight to opposite dry foot x ${at(opposite.x)}, z ${at(opposite.z)}. Do not enter water beside the deck.`)
    } else notes.push(`Discovered bridge: dry feet x ${at(bridge.from.x)}, z ${at(bridge.from.z)} and x ${at(bridge.to.x)}, z ${at(bridge.to.z)}. Water is blocked until B Works, 1 Bridge, aim, then F when Ready.`)
  }
  const ladder = sites.find((site) => site.kind === 'ladder')
  if (ladder?.kind === 'ladder') {
    const lower = ladder.from.y <= ladder.to.y ? ladder.from : ladder.to
    const upper = lower === ladder.from ? ladder.to : ladder.from
    notes.push(built.has(ladder.id)
      ? `Built cliff ladder: lower foot x ${at(lower.x)}, z ${at(lower.z)}; upper foot x ${at(upper.x)}, z ${at(upper.z)}. Align with the rungs, face north and W to climb; S descends.`
      : `Discovered cliff ladder: lower foot x ${at(lower.x)}, z ${at(lower.z)}; upper foot x ${at(upper.x)}, z ${at(upper.z)}. B Works, 2 Ladder, aim, then F when Ready.`)
  }
  const digChoices = revealedDigChoices(sites, works.dugTileIds, works.builtSites, position)
  if (digChoices.length && !v26Terrain) {
    const bank = digChoices.every((site) => digBank(site.center.z) === digBank(digChoices[0].center.z))
      ? `${digBank(digChoices[0].center.z)} ` : ''
    const coordinates = digChoices.map((site) => `x ${at(site.center.x)}, z ${at(site.center.z)}`).join('; ')
    notes.push(`Revealed ${bank}dry-loam patch ${digChoices.length === 1 ? 'choice' : 'choices'}: ${coordinates}. These map coordinates are options, not the automatic Works target. Stand beside a patch within 4 m, not on it. Equip a field spade, keep one bag slot free, then B Works, 3 Dig; check Works Selected x/z and Ready before F. Gain one stone and 30 Excavation XP; sell the stone at Outfitters.`)
  }
  return notes
}

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
  const digSite = tile.discovered && tile.hasDigSite === true
  const builtRoute = tile.discovered && tile.hasBuiltRoute
  const bridgehead = tile.discovered && tile.hasBridgeheadPost === true
  const waystone = tile.discovered && tile.hasWaystone
  const store = tile.discovered && tile.hasStore
  const camp = tile.discovered && tile.hasCamp
  const raised = tile.discovered && tile.hasRaisedSoil === true
  const lowered = tile.discovered && tile.elevationMeters !== undefined && !raised
  const upperShelf = naturalShelf(tile)
  const campSuitable = !!onSelect && tile.discovered && tile.campSuitable === true
  const westTrail = tile.hasWestTrail === true
  const centerBridgeRoute = tile.hasCenterBridgeRoute === true
  const eastTrail = tile.discovered && tile.hasEastTrail === true
  const frontierMarker = tile.hasFrontierMarker === true
  const frontierTrail = tile.hasFrontierTrail === true
  const highlandLandmark = tile.discovered && tile.hasHighlandLandmark === true
  const highlandNode = tile.discovered && tile.hasHighlandNode === true
  const highlandTrail = tile.discovered && tile.hasHighlandTrail === true
  const mireglassTimber = tile.discovered && tile.hasMireglassTimber === true
  const landmark = centerBridgeRoute ? '⇣' : westTrail ? '⇦' : eastTrail ? '⇨' : frontierMarker ? 'M' : tile.discovered
    ? camp ? 'C' : campSuitable ? '⌂' : bridgehead ? 'P' : tile.hasCache ? '✦' : highlandLandmark ? 'Q'
      : highlandNode ? tile.highlandNodeReady ? '◆' : '◌'
        : waystone ? 'W' : builtRoute ? '✓' : routeSite ? '◇' : digSite ? '⌄' : store ? 'S' : tile.hasRing ? 'R' : mireglassTimber ? '♣' : tile.hasResource ? '•' : highlandTrail || frontierTrail ? '·' : ''
    : frontierTrail ? '·' : '?'
  const occupiedBadge = camp ? 'C' : campSuitable ? '⌂' : bridgehead ? 'P' : centerBridgeRoute ? '⇣' : westTrail ? '⇦' : eastTrail ? '⇨'
    : highlandLandmark ? 'Q' : highlandNode ? tile.highlandNodeReady ? '◆' : '◌'
      : store ? 'S' : waystone ? 'W' : builtRoute ? '✓' : routeSite ? '◇' : digSite ? '⌄' : mireglassTimber ? '♣' : null
  const Element = onSelect ? 'button' : 'span'
  return <Element type={onSelect ? 'button' : undefined} role={onSelect ? undefined : 'img'} tabIndex={tabIndex} data-camp-tile={onSelect ? tile.id : undefined} aria-pressed={onSelect ? selected : undefined} onClick={onSelect ? () => onSelect(tile.id) : undefined} className="wr-map-tile" data-discovered={tile.discovered} style={{ position: 'relative', background: upperShelf ? '#91ab82' : tile.terrain ? TERRAIN[tile.terrain as keyof typeof TERRAIN] : '#17201e', ...(raised ? { boxShadow: 'inset 0 0 0 2px #9fdcb3, inset 0 0 8px #101b18' } : lowered ? { boxShadow: 'inset 0 0 0 2px #d3a66f, inset 0 0 8px #101b18' } : upperShelf ? { boxShadow: 'inset 0 0 0 2px #dbe8c4' } : {}) }} aria-label={`${tile.id}: ${tile.discovered ? tile.biome : 'unexplored'}${occupied ? ', player location' : ''}${upperShelf ? ', natural upper shelf' : ''}${bridgehead ? ', River Works survey post' : ''}${centerBridgeRoute ? ', center creek bridge toward Mireglass; build before crossing' : ''}${westTrail ? ', west trail to Mireglass' : ''}${eastTrail ? ', east trail toward Highland Quarry' : ''}${frontierTrail ? ', marked frontier trail' : ''}${highlandTrail ? ', walked quarry path' : ''}${frontierMarker ? ', frontier marker' : ''}${highlandLandmark ? ', Quarry Crown' : ''}${highlandNode ? tile.highlandNodeReady ? ', ready stone shelf' : ', recovering stone shelf' : ''}${mireglassTimber ? ', harvestable dry Mireglass timber' : ''}${store ? ', store' : ''}${waystone ? ', Greenway waystone' : ''}${tile.discovered && tile.hasCache ? `, ${cacheLabel}` : ''}${raised ? `, raised soil top at ${tile.elevationMeters!.toFixed(2)} m` : lowered ? `, lowered ground at ${tile.elevationMeters!.toFixed(2)} m` : ''}${routeSite ? ', route build site' : ''}${digSite ? ', dig site' : ''}${builtRoute ? ', completed route' : ''}${campSuitable ? ', suitable field camp ground' : ''}${camp ? ', field camp' : ''}`}>
    <b style={occupied ? { transform: `rotate(${mapHeadingRotation(player.yaw)}rad)`,
      ...(upperShelf ? { color: '#1b2b21' } : {}) }
      : upperShelf ? { color: '#1b2b21' } : campSuitable ? { color: '#ffe395' }
        : mireglassTimber ? { color: '#d0e7b7' } : undefined}>{occupied ? '▲' : landmark}</b>
    {occupied && occupiedBadge && <small aria-hidden="true" style={{ position: 'absolute', right: 0, bottom: 0, fontSize: 8, lineHeight: 1, color: campSuitable ? '#ffe395' : undefined }}>{occupiedBadge}</small>}
    {lowered && <small aria-hidden="true" style={{ position: 'absolute', left: 1, bottom: 0, fontSize: 10, lineHeight: 1, color: '#ffe395' }}>▾</small>}
    {raised && <small aria-hidden="true" style={{ position: 'absolute', left: 1, bottom: 0, fontSize: 10, lineHeight: 1, color: '#b9f3c8' }}>▴</small>}
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
  const selectable = !compact && !projection.unavailableActions && projection.fieldCamp?.selectionEnabled && onSelect
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

export function OverviewGrid({ overview }: { overview: WizardWorldOverview }) {
  const cells = northUpGridOrder(overview.cells)
  const columns = Math.max(...cells.map(({ gridX }) => gridX)) - Math.min(...cells.map(({ gridX }) => gridX)) + 1
  return <span className="wr-overview-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} aria-label="Discovered world overview, north up, each square is 64 meters">
    {cells.map((cell) => {
      const occupied = cell.gridX === overview.player.gridX && cell.gridZ === overview.player.gridZ
      const marker = cell.markers.includes('Field camp') ? 'C' : cell.markers.includes('Quarry Crown') ? 'Q'
        : cell.markers.some((label) => /Stone shelf/.test(label)) ? '◆'
        : cell.markers.find((label) => /Outfitters|Arcanum|salvager/.test(label)) ? 'S'
        : cell.markers.some((label) => /Ring/.test(label)) ? 'R'
          : cell.markers.some((label) => /built/.test(label)) ? '✓'
            : cell.markers.some((label) => /cache/.test(label)) ? '✦'
              : cell.markers.some((label) => /Center creek bridge to Mireglass/.test(label)) ? '⇣'
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

export const overviewForDetails = (open: boolean, load: () => WizardWorldOverview) => open ? load() : null

function LazyOverview({ load, hasCamp }: { load: () => WizardWorldOverview; hasCamp: boolean }) {
  const [overview, setOverview] = useState<WizardWorldOverview | null>(null)
  return <details className="wr-map-overview"
    onToggle={(event) => setOverview(overviewForDetails(event.currentTarget.open, load))}>
    <summary>World overview (toggle local map)</summary>
    {overview ? <>
      <p>Each square is 64 m. Color shows only a sample of visited ground; dark squares remain unexplored.</p>
      <OverviewGrid overview={overview} />
      <p>▲ you · S known store · R discovered ring · ✓ built route · ✦ revealed cache · ⇦ known trail · ? unexplored{overview.cells.some((cell) => cell.markers.includes('Quarry Crown')) && ' · Q Quarry Crown'}{overview.cells.some((cell) => cell.markers.some((label) => /Stone shelf/.test(label))) && ' · ◆ stone shelf'}{hasCamp && ' · C field camp'}</p>
    </> : <p>Expand to load the discovered world overview.</p>}
  </details>
}

export function RouteKey({ routes, buildSites, selectedBuildSiteId, onSelect, physicalRoutes = false, actionsEnabled = true, savePaused = false, starterCliff, worksLadderBuilt = false }: {
  routes: readonly WizardRoute[]
  buildSites: readonly WizardBuildSite[]
  selectedBuildSiteId: string | null
  onSelect: (siteId: string) => void
  physicalRoutes?: boolean
  actionsEnabled?: boolean
  savePaused?: boolean
  starterCliff?: WizardViewProjection['starterCliff']
  worksLadderBuilt?: boolean
}) {
  return <div className="wr-map-routes">{routes.filter((route) => !starterCliff || route.id === 'greenway_ladder').map((route) => {
    const candidates = buildSites.filter((site) => site.routeId === route.id && site.discovered && site.status !== 'built'
      && (!starterCliff || site.id === starterCliff.face.siteId))
    const starterSteps = route.id === 'greenway_ladder'
    const cliffLadder = starterSteps && starterCliff !== undefined
    const routeLabel = cliffLadder ? worksLadderBuilt ? 'Starter cliff ladder (authored center route)' : 'Starter cliff ladder' : starterSteps
      ? route.label.replace(/^Greenway ladder/, 'Greenway low steps') : route.label
    const highlandBridge = route.id === 'highland_bridge'
    const east = route.to[0] - route.from[0], south = route.to[2] - route.from[2]
    const fromSide = Math.abs(east) >= Math.abs(south) ? east > 0 ? 'West' : 'East' : south > 0 ? 'North' : 'South'
    const toSide = Math.abs(east) >= Math.abs(south) ? east > 0 ? 'east' : 'west' : south > 0 ? 'south' : 'north'
    return <section key={route.id}>
      <h3>{route.built ? '✓' : route.unlocked ? '◇' : '×'} {routeLabel} <small>{route.built ? 'completed' : route.unlocked ? `${worksLadderBuilt && cliffLadder ? 'optional, ' : ''}${route.logCost} logs` : 'locked'}</small></h3>
      {cliffLadder ? <small>{route.built || candidates.length || worksLadderBuilt
        ? `The centered starter ${route.built ? 'ladder' : 'ladder site'} is x ${route.from[0]}, z ${route.from[2]}. Off-center Works ladder candidates are separate; follow the selected Works x/z, not this centered route. ${route.built ? 'Use the completed ladder: face north and walk with W to climb or S to descend between the rails.' : worksLadderBuilt ? 'The centered build is optional; use your saved Works ladder at its own x/z to climb.' : `Build with ${route.logCost} logs, then face north and use W to climb or S to descend between the rails.`}${worksLadderBuilt && route.built ? ' Your built Works ladder follows its own preview coordinates.' : ''}`
        : `Find the cliff foot at Greenway's north edge. Chop a tree twice for ${route.logCost} logs, then build the ladder.`}</small>
        : starterSteps && <small>First route: low steps to Northern Ridge, not a cliff ladder. {route.built ? 'The climbable Slate ladder is a separate work in Mireglass.' : `Explore Greenway's north edge for a discovered ◇ build site; bring ${route.logCost} logs. The climbable Slate ladder is a separate work in Mireglass.`}</small>}
      {highlandBridge && !route.built && <small>Next route: bridge the gap east from Northern Ridge to Eastern Highland. Build the low steps and reach level 2 first; then bring {route.logCost} logs to a discovered ◇ site.</small>}
      {route.built && <small>{fromSide} foot (x {route.from[0]}, z {route.from[2]}) to {toSide} foot (x {route.to[0]}, z {route.to[2]}). {cliffLadder && savePaused
        ? 'Movement is paused until the save recovers.' : savePaused
        ? 'Movement and route shortcuts are paused until the save recovers.' : !actionsEnabled
        ? 'Walk the built support; the Interact shortcut is unavailable in this preview.' : cliffLadder
        ? 'Climb the steep rung ladder: face north and walk with W to climb or S to descend, one step at a time. Stay centered; Interact does not teleport across.' : physicalRoutes
        ? `${starterSteps ? 'Walk the low steps' : route.id.includes('slate_ladder') ? 'Walk into the ladder face and climb' : 'Walk across the bridge deck'} one step at a time. Approach the foot on your side until Cross appears; press E or tap Interact as a shortcut. You can also walk across the built route.`
        : 'Within 3 m of either foot, press E to cross. On touch, tap Interact. Walking into the edge alone will not cross it.'}</small>}
      {!route.built && candidates.map((site) => <button key={site.id} type="button" className="wr-map-site" disabled={!actionsEnabled} aria-label={`Preview ${cliffLadder ? routeLabel : starterSteps ? site.label.replace(/^Greenway ladder/, 'Greenway low steps') : site.label}`} aria-pressed={selectedBuildSiteId === site.id} onClick={() => onSelect(site.id)}>
        <span>{cliffLadder ? routeLabel : starterSteps ? site.label.replace(/^Greenway ladder/, 'Greenway low steps') : site.label} <small>{site.logCost} logs</small></span><small>{savePaused ? 'Route actions paused for save' : actionsEnabled ? site.reason || 'Ready to build' : 'Route actions unavailable here'}</small>
      </button>)}
      {!route.built && candidates.length === 0 && !(cliffLadder && worksLadderBuilt) && <small>{route.id === 'highland_bridge'
        ? 'No discovered Highland bridge sites yet. Walk east along Northern Ridge to chart the gap.'
        : cliffLadder ? 'No discovered starter cliff foot yet. Explore Greenway’s north edge.'
          : route.id === 'greenway_ladder'
          ? "No discovered Greenway low-steps site yet. Explore Greenway's north edge."
          : 'No discovered build sites.'}</small>}
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
  const savePaused = projection.controllerActionsEnabled === false
  const starterGreenwayWorks = projection.savedTerrainWorks?.context === 'starter-greenway'
  const works3Greenway = projection.savedTerrainWorks?.context === 'works3-greenway'
  const works4Greenway = projection.savedTerrainWorks?.context === 'works4-greenway'
  const v28River = projection.savedTerrainWorks?.context === 'v28-river'
  const continuity = projection.v28TravelContinuity
  const coordinate = (value: number) => value.toFixed(2)
  const v26Terrain = projection.v26ValleyRimSegments !== undefined
  const mining = projection.v29Mining
  const visibleOpenPitCount = projection.v26OpenPitColumns?.length ?? 0
  const discoveredWorkTileIds = new Set(projection.map.tiles
    .filter((tile) => tile.discovered).map((tile) => tile.id))
  const visibleWorkTileIds = works4Greenway && projection.terrain?.length
    ? new Set(projection.terrain.map((cell) => cell.id)) : null
  const fullyVisibleWork = (site: { footprintTileIds: readonly string[] }) =>
    discoveredFootprint(site, discoveredWorkTileIds)
      && (!visibleWorkTileIds || site.footprintTileIds.every((id) => visibleWorkTileIds.has(id)))
  const nextWork = projection.savedTerrainWorks?.actionsEnabled
    ? [projection.savedTerrainWorks.preview?.selected,
      projection.savedTerrainWorks.preview?.nearby[0]].find((choice) =>
      choice && (!v26Terrain || choice.site.kind !== 'dig')
        && (!works4Greenway || fullyVisibleWork(choice.site)))
    : null
  const builtWorksLadders = works4Greenway
    ? projection.savedTerrainWorks!.builtSites.filter((site) => site.kind === 'ladder'
      && fullyVisibleWork(site)) : []
  const knownWorks = works4Greenway ? projection.savedTerrainWorks?.preview?.nearby
    .filter((choice) => fullyVisibleWork(choice.site)
      && (!v26Terrain || choice.site.kind !== 'dig')) ?? [] : []
  const knownBridge = knownWorks.find((choice) => choice.site.kind === 'bridge')
  const knownLadder = knownWorks.find((choice) => choice.site.kind === 'ladder')
  const routeDigChoices = works4Greenway && !v26Terrain ? revealedDigChoices([
    ...(projection.savedTerrainWorks?.suggestedSites ?? []),
    ...knownWorks.map((choice) => choice.site),
  ].filter(fullyVisibleWork), projection.savedTerrainWorks!.dugTileIds,
  projection.savedTerrainWorks!.builtSites,
  projection.player?.position) : []
  const routeDig = routeDigChoices[0]
  const routeDigBank = routeDig && routeDigChoices.every((site) =>
    digBank(site.center.z) === digBank(routeDig.center.z)) ? digBank(routeDig.center.z) : null
  const suggestedBridge = works4Greenway && projection.savedTerrainWorks?.suggestedSites?.find((site) => site.kind === 'bridge'
    && fullyVisibleWork(site))
  const suggestedLadder = works4Greenway && projection.savedTerrainWorks?.suggestedSites?.find((site) => site.kind === 'ladder'
    && fullyVisibleWork(site))
  const builtBridge = works4Greenway && projection.savedTerrainWorks?.builtSites.find((site) => site.kind === 'bridge'
    && fullyVisibleWork(site))
  const knownDigTile = works4Greenway && projection.map.tiles.find((tile) => tile.discovered && tile.hasDigSite)
  const workReason = (choice: NonNullable<typeof nextWork>) => {
    if (!works4Greenway || choice.site.kind !== 'ladder' || choice.rejection !== 'occupied'
      || choice.reason !== 'Move clear of the footprint and other works.') return choice.reason
    const railStart = choice.site.supportPath[1]
    const railEnd = choice.site.supportPath[choice.site.supportPath.length - 2]
    const [x, , z] = projection.player.position
    return Math.abs(x - choice.site.from.x) <= choice.site.widthMeters / 2 + 0.015
      && z >= Math.min(railStart.z, railEnd.z) - 0.5
      && z <= Math.max(railStart.z, railEnd.z) + 0.5
      ? `You are standing in this ladder ghost. Step south to the lower foot x ${Number(choice.site.from.x.toFixed(1))}, z ${Number(choice.site.from.z.toFixed(1))}, then confirm within 3 m. If still occupied, shift the aim or clear overlapping work.`
      : choice.reason
  }
  const firstRoute = projection.routes.find((route) => route.id === 'greenway_ladder')
  const bridgeRoute = projection.routes.find((route) => route.id === 'highland_bridge')
  const bridgeReady = projection.buildSites.some((site) => site.routeId === 'highland_bridge'
    && site.discovered && site.status === 'ready')
  const bridgeStatus = bridgeRoute?.built ? 'built' : !bridgeRoute?.unlocked
    ? 'locked: build the low steps and reach level 2' : savePaused || projection.unavailableActions
      ? 'unavailable here' : bridgeReady ? 'ready at a discovered site'
        : 'unlocked, but not ready at a discovered site yet'
  const preciseWorkNotes = works4Greenway && projection.player?.position
    ? greenwayWorkRouteNotes(projection.player.position,
      projection.map.tiles, projection.savedTerrainWorks, visibleWorkTileIds, v26Terrain) : []
  const localMap = <div className="wr-map-local">
    {projection.map.guidance && (!v26Terrain || v28River || projection.map.guidancePriority)
      && <p className="wr-map-guidance" role="note" aria-label="Map guidance">{projection.map.guidance}</p>}
    <MapGrid projection={projection} onSelect={(tileId) => { onIntent({ type: 'field-camp.select', tileId }); onToggle() }} />
    <p className="wr-map-legend">{projection.map.legend ?? '▲ you · W waystone · ✦ revealed cache · ◇ route build site · ✓ completed route · S store · R fairy ring · • resource · ? unexplored'}
      {projection.map.tiles.some(naturalShelf) && <> · <span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, background: '#91ab82', boxShadow: 'inset 0 0 0 2px #dbe8c4' }} /> discovered natural upper shelf (height only)</>}
      {!projection.map.legend?.includes('▾') && projection.map.tiles.some((tile) => tile.discovered && tile.elevationMeters !== undefined && !tile.hasRaisedSoil) && ' · ▾ lowered ground'}{projection.map.tiles.some((tile) => tile.discovered && tile.hasRaisedSoil) && ' · ▴ raised soil'}{projection.fieldCamp?.selectionEnabled && !projection.unavailableActions && ' · ⌂ suitable camp ground'}{projection.fieldCamp && ' · C field camp'}{projection.v30Bridgehead && ' · P River Works post'}</p>
    {continuity && <section className="wr-map-guidance" role="note"
      aria-label="Continuous world and saved Greenway route">
      <p>Current position: x {coordinate(continuity.position[0])}, y {coordinate(continuity.position[1])}, z {coordinate(continuity.position[2])} m. This is the same continuous world after the Greenway boundary.</p>
      <p>Saved Greenway Works ladders (global): {continuity.greenwayLadders.length}.
        {continuity.greenwayLadders.map((site) => <span key={site.id}> Lower foot x {coordinate(site.from[0])}, z {coordinate(site.from[2])}; upper foot x {coordinate(site.to[0])}, z {coordinate(site.to[2])}.</span>)}</p>
      <p>To return, retrace revealed dry ground toward the saved ladder feet. On the westward route, follow the connected river bank to a marked crossing; unmarked banks are not build sites.</p>
    </section>}
    {works4Greenway && <section className="wr-map-route-key" aria-label="Greenway route key">
      <h3>Greenway route key</h3>
      <ul>
        <li><b>South creek · Bridge</b><span>South of spawn · 8 logs · B, 1, aim, F · Cross water, 80 Construction XP.</span>
          <small>{builtBridge && builtBridge.kind === 'bridge' ? `✓ Built at x ${Number(builtBridge.from.x.toFixed(1))}, z ${Number(builtBridge.from.z.toFixed(1))}`
            : knownBridge && knownBridge.site.kind === 'bridge' ? `◇ Discovered at x ${Number(knownBridge.site.from.x.toFixed(1))}, z ${Number(knownBridge.site.from.z.toFixed(1))} · ${knownBridge.rejection ? 'Blocked' : 'Ready'}`
              : suggestedBridge && suggestedBridge.kind === 'bridge' ? `◇ Discovered candidate at x ${Number(suggestedBridge.from.x.toFixed(1))}, z ${Number(suggestedBridge.from.z.toFixed(1))} · Aim in Works to inspect.`
              : 'Not built · Aim in Works to inspect a discovered site.'}</small></li>
        <li><b>North cliff · Ladder</b><span>North of spawn · 4 logs · B, 2, aim, F · Climb rungs, 60 Construction XP.</span>
          <small>{builtWorksLadders[0] ? `✓ Built at x ${Number(builtWorksLadders[0].from.x.toFixed(1))}, z ${Number(builtWorksLadders[0].from.z.toFixed(1))}`
            : knownLadder && knownLadder.site.kind === 'ladder' ? `◇ Discovered at x ${Number(knownLadder.site.from.x.toFixed(1))}, z ${Number(knownLadder.site.from.z.toFixed(1))} · ${knownLadder.rejection ? 'Blocked' : 'Ready'}`
              : suggestedLadder && suggestedLadder.kind === 'ladder' ? `◇ Discovered candidate at x ${Number(suggestedLadder.from.x.toFixed(1))}, z ${Number(suggestedLadder.from.z.toFixed(1))} · Aim in Works to inspect.`
              : 'Works ladder not built · Aim in Works to inspect a discovered site.'}</small></li>
        {v26Terrain ? <li><b>Ground · {mining ? 'Dig/Fill/Mine' : 'Dig/Fill'}</b><span>{mining
          ? 'Buy a field spade and a basic pick at Greenway Outfitters. Spade Dig handles soil and Fill refills an open pit with carried soil. Equip a pick for deeper layers; Mine checks the exact tapped dry cell, tool, skill, reach, and bag room. Ore is not guaranteed.'
          : 'Equip a field spade, choose Dig or Fill in Terrain tools, then tap nearby revealed dry ground. The checked action determines reach, clearance, and material.'}</span></li>
          : <li><b>{routeDigBank === 'far-bank' ? 'Far bank' : routeDigBank === 'near-bank' ? 'Near bank' : 'Dry loam'} · Dig</b><span>{routeDigBank === 'far-bank' ? 'Across the creek' : routeDigBank === 'near-bank' ? 'On the near dry bank' : 'At a revealed dry-loam patch'} · equipped field spade + free bag slot · B, 3, F · Stone, 30 Excavation XP; sell at Outfitters.</span>
          <small>{routeDig ? `⌄ Discovered at ${routeDigChoices.map((site) => `x ${Number(site.center.x.toFixed(1))}, z ${Number(site.center.z.toFixed(1))}`).join('; ')} · Map ${routeDigChoices.length === 1 ? 'choice' : 'choices'}, not Works selection; check Works Selected x/z and Ready before F.`
            : projection.savedTerrainWorks!.dugTileIds.length ? `✓ ${projection.savedTerrainWorks!.dugTileIds.length} patch dug`
              : knownDigTile ? `⌄ Discovered map cell x ${knownDigTile.gridX}, z ${knownDigTile.gridZ}`
                : 'Not dug · reveal dry loam on a safe bank.'}</small></li>}
      </ul>
    </section>}
    {preciseWorkNotes.map((note, index) => <p key={index} className="wr-map-guidance" role="note"
      aria-label={index === 0 ? 'Exact player position' : 'Precise Greenway route guidance'}>{note}</p>)}
    {projection.v30Bridgehead && <p className="wr-map-guidance" role="note" aria-label="River Works bridgehead">
      River Works post at the discovered dry far exit, x {coordinate(projection.v30Bridgehead.position[0])}, z {coordinate(projection.v30Bridgehead.position[2])} m. {projection.v30Bridgehead.claimed
        ? 'The one-time crossing reward is recorded. Prospect only on suitable dry ground; ore is not guaranteed. Return to Greenway Outfitters to sell recovered material.'
        : 'Cross the saved deck and approach the post. The checked claim appears only when you are grounded and in reach; the field spade remains needed for soil.'}
    </p>}
    {projection.v31Soil && <p className="wr-map-guidance" role="note" aria-label="Placed soil guidance">
      Carried soil: {projection.v31Soil.soilAvailable}. With a field spade equipped, choose Place soil and tap the visible top of one revealed dry cell to request a 0.4 m lift. Dig on a raised cell removes that lift first and returns one soil; Fill still restores an open pit. The checked action may reject an occupied or protected cell.
    </p>}
    {mining && <p className="wr-map-guidance" role="note" aria-label="Deep excavation guidance">
      Excavation level {mining.excavationLevel}. Outfitters sells the basic pick for 35g and the enchanted pick for 240g at level 25. Equip the spade for soil or an owned pick for deeper layers, then select the matching Terrain tool and tap one revealed dry cell. The tap is a geometric target until checked; water, occupied ground, distance, tool, skill, bedrock, and a full pack can block it. Ore is not guaranteed. Sell terrain-bag materials at Outfitters to free space.
    </p>}
    {projection.ambience === 'highland-wind' && <p className="wr-map-guidance" role="note" aria-label="Highland wind">Wind sweeps the open stone shelves; the pale path is visible only where you have walked.</p>}
    {projection.fieldCamp?.guidance && <p className="wr-map-guidance" role="note" aria-label="Camp guidance">{projection.fieldCamp.guidance}</p>}
    {projection.unavailableActions && <p className="wr-map-guidance" role="note">Legacy route and camp actions are unavailable in this continuous preview. Saved work controls appear in Works when ready.</p>}
    {savePaused && <p className="wr-map-guidance" role="status">Route actions paused for save. The map remains readable while progress is saving or blocked.</p>}
    {projection.savedTerrainWorks && <p className="wr-map-guidance" role="note" aria-label="Saved local works">
      {continuity ? 'Nearby visible saved works' : 'Saved local works'}: {projection.savedTerrainWorks.builtSites.length} {starterGreenwayWorks ? 'creek bridge' : 'bridge or ladder'}, {mining ? <>{projection.savedTerrainWorks.dugTileIds.length} marked Works digs; {visibleOpenPitCount} visible open excavated {visibleOpenPitCount === 1 ? 'column' : 'columns'}</> : <>{projection.savedTerrainWorks.dugTileIds.length} dug cells</>}. Lowered ground uses ▾. {projection.savedTerrainWorks.actionsEnabled
        ? v28River ? 'At a marked connected-river crossing, reveal the complete footprint and stand on its dry source-bank cell. Open Works, choose Bridge, aim, and confirm only when Ready; not every bank supports a bridge.'
          : continuity ? 'This is the local scene count, not the global Greenway ledger. Continue exploring dry ground; open Works only at a supported, discovered site.'
          : v26Terrain ? 'Open Works to build a bridge or ladder. Equip a field spade and use Terrain tools to Dig or Fill nearby revealed dry ground; each tap is checked.'
          : starterGreenwayWorks
          ? 'Near spawn, chop two oaks twice each for 8 logs, then use Works → Bridge at the discovered south creek. Cross the built deck to the dig patch. Dig requires an owned, equipped field spade and one free backpack slot; return to Outfitters to sell the stone.'
          : works4Greenway
            ? 'Open Works for checked placement and the reason a site is blocked.'
          : works3Greenway
            ? 'Map symbols appear only after you reveal a complete site. At a marked site, use B Works, then 1 Bridge, 2 Ladder, or 3 Dig; press F when the selected preview says Ready.'
          : 'Choose Bridge, Ladder, or Dig in Works, face a discovered site, then confirm. Bridge: Fen channel, 8 logs, cross water. Ladder: Slate cliff, 4 logs, climb. Dig: discovered loam, equipped field spade and one free pack slot, gain stone and Excavation XP for camp building.'
        : savePaused ? 'Saved building and digging are paused. Check the save status before using Works.'
          : projection.unavailableActions && projection.controllerActionsEnabled === true
            ? 'Saved building and digging are unavailable on this terrain.'
            : projection.unavailableActions ? 'Saved building and digging are paused. Check the save status before using Works.'
          : continuity ? 'Local building is paused. Your saved Greenway ladder remains in the global ledger above.'
          : starterGreenwayWorks ? 'Explore the south creek to use starter Works.'
            : works3Greenway || works4Greenway ? 'Explore Greenway to reveal the creek banks, cliff ledges, and dry far-bank dig sites.'
            : 'Building here is unavailable. Explore beyond Greenway to use the Works panel.'}
    </p>}
    {nextWork && <p className="wr-map-guidance" role="status" aria-label="Next discovered work">
      {nextWork.site.kind === 'dig' ? 'Dig' : nextWork.site.kind === 'ladder' ? 'Ladder' : 'Bridge'} nearby: {workReason(nextWork)} {nextWork.benefit}
    </p>}
    {builtWorksLadders.map((site) => <p key={site.id} className="wr-map-guidance" role="note" aria-label="Built Works ladder route">
      Built Works north cliff ladder, separate from the authored x 0 route: lower foot x {Number(site.from.x.toFixed(1))}, z {Number(site.from.z.toFixed(1))}; upper foot x {Number(site.to.x.toFixed(1))}, z {Number(site.to.z.toFixed(1))}. Rails center on x {Number(site.supportPath[1].x.toFixed(1))} from z {Number(site.supportPath[1].z.toFixed(2))} to {Number(site.supportPath[2].z.toFixed(2))} (width {site.widthMeters} m). Approach the lower foot from the south, align between these rails, face north and walk with W to climb; S descends from the upper foot.
    </p>)}
    {projection.savedTerrainWorks && <details className="wr-map-work-guide">
      <summary>{v28River ? 'How to build a supported connected-river bridge'
        : v26Terrain ? 'How to build routes and use spade terrain tools'
        : starterGreenwayWorks ? 'How to cross the creek and dig'
        : works4Greenway ? 'How to aim a bridge, climb, dig, and sell'
        : works3Greenway ? 'How to bridge, climb, and dig in Greenway'
          : 'How to reach Mireglass and use Works'}</summary>
      <p>{v28River
        ? 'The connected river is continuous. A bridge exists only at supported dry-bank columns, and a candidate appears after its dry approach, wet span, and far-bank exit are all discovered. An unmarked bank is not a promise of a bridge.'
        : starterGreenwayWorks
        ? 'The first creek is just south of the starting area. Walk toward it to reveal the banks and water. The separate starter ladder climbs the north cliff.'
        : works4Greenway
          ? 'South of spawn, discover both creek banks for a bridge. North of spawn, discover both cliff ledges for an upright ladder. The fixed starter ladder remains at the center; free placement on clear cliff face is off-center. Move the Works ghost along the obstacle with the reticle or aim slider.'
        : works3Greenway
          ? 'South of spawn, reveal creek bridge sites. The fixed starter cliff ladder is centered; Works can add clear off-center ladders. Follow the selected Works preview coordinates for the structure F will build. Bridge and ladder building is limited to discovered obstacle sites; freeform placement is a future system.'
        : projection.v42IronHall
          ? 'From Greenway, use the center creek bridge, building it before crossing if needed. Follow revealed dry ground to the Mireglass frontier marker; hidden work sites stay off the map.'
          : 'From Greenway, follow the west trail (⇦) through the dry gap into Mireglass. Explore on foot to chart ground; hidden work sites stay off the map.'}</p>
      <p>{v28River
        ? 'Gather 8 logs. Stand grounded in the marked dry source-bank cell, within 3 m of its foot. A blocked preview states the actual reason; do not step into the water before the deck is built.'
        : starterGreenwayWorks
        ? 'Chop two nearby oaks twice each for 8 logs. At the near bank, open Works, choose Bridge, face the discovered crossing, and confirm. The creek blocks travel until the narrow deck is built.'
        : works4Greenway
          ? 'Gather 8 logs for a narrow supported creek deck or 4 logs for a rung ladder up the north cliff. Choose Bridge with 1 or Ladder with 2; shift the ghost to a supported clear position within 3 m of its lower foot. Gold means Ready, red means blocked; the displayed reason says what to change.'
        : works3Greenway
          ? 'Gather 8 logs for a narrow creek bridge or 4 logs for a clear north cliff ladder. In Works choose Bridge with 1 or Ladder with 2, face a discovered site, and confirm before crossing or climbing.'
        : 'Bridge: look for shallow Fen water between dry banks. Bring 8 logs to make a crossing. Ladder: look for a Slate cliff with an upper ledge. Bring 4 logs to reach higher ground. Explore both ends before building.'}</p>
      <p>{mining ? 'For soil, equip the field spade and choose Dig; Fill restores only an open pit with carried soil. For a deeper layer, equip a pick and choose Mine. Click a revealed dry cell to ask the checked action what its next layer permits. Not all ground is safe or valuable.'
        : v28River ? 'For digging, equip a field spade and use Terrain tools on checked dry ground. Fill restores an open excavated pit with carried soil; it does not place soil on arbitrary ground.'
        : v26Terrain ? 'Equip a field spade, choose Dig or Fill in Terrain tools, then tap nearby revealed dry ground. The checked action reports whether that exact cell can be changed. Works is for Bridge and Ladder.'
        : starterGreenwayWorks
        ? 'Buy and equip the field spade at Greenway Outfitters. Cross the bridge, stand beside the discovered patch, then choose Dig in Works. It lowers the ground, gives one stone and 30 Excavation XP, and persists; sell the stone back at Outfitters.'
        : works4Greenway
          ? 'Cross the creek to far-bank dry loam. Buy and equip a field spade, keep one backpack slot free, then choose Dig with 3. Stand beside a revealed patch within 4 m, not on it. Digging lowers it by 0.24 m, gives one stone and 30 Excavation XP; sell the stone at Greenway Outfitters.'
        : works3Greenway
          ? 'Cross the creek to far-bank dry loam. Buy and equip a field spade, keep one backpack slot free, then choose Dig with 3. Stand beside marked dry loam within 4 m, not on it. Digging lowers ground by 0.24 m and earns one stone plus 30 Excavation XP; Outfitters buys the stone.'
        : 'Dig: look for loam ground. Own and equip a field spade, and leave backpack room for stone. Digging lowers ground and earns stone and Excavation XP; bridges and ladders earn Construction XP. Built supports and dug ground stay in your save.'}</p>
      <p>{projection.savedTerrainWorks.actionsEnabled
        ? v28River ? 'Close the map. Press B for Works, 1 for Bridge, then aim at a marked crossing and press F only when Ready. On touch, open Works, tap the river crossing, then Confirm. The checked save spends logs and makes one persistent deck.'
          : v26Terrain ? 'Close the map, press B for Works, then choose 1 Bridge or 2 Ladder. Aim and press F only when Ready. Close Works before using the spade Dig/Fill controls.'
          : starterGreenwayWorks
          ? 'Close the map, open Works with B, choose Bridge with 1 or Dig with 3, face the site, then press F when its preview says Ready. The preview never spends materials; confirmation saves the work.'
          : works4Greenway
            ? 'Close the map, press B, then choose 1 Bridge or 2 Ladder. Turn toward the obstacle or move the aim slider to place the ghost; press F only when it says Ready. Choose 3 Dig for marked loam. The preview spends nothing; checked confirmation saves the work.'
          : works3Greenway
            ? 'Close the map, open Works with B, choose Bridge with 1, Ladder with 2, or Dig with 3. Bridge and ladder reach is 3 m; dig from beside the marked patch within 4 m. Check the selected site coordinates, then press F only when its preview says Ready; the checked confirmation saves the work.'
          : 'Close the map, open Works, and choose Bridge, Ladder, or Dig. Move within 3 m of the source foot or dig ground, then turn your wizard toward it. Switch kind if the wrong work is selected; check the benefit and reason before confirming. Walk across a finished bridge or into a ladder to climb.'
        : savePaused ? 'Saved work actions are paused here. Check the save status; moving to another site will not enable them.'
          : projection.unavailableActions && projection.controllerActionsEnabled === true
            ? 'Legacy route actions are unavailable on streamed terrain; use Works for saved building and digging.'
            : projection.unavailableActions ? 'Saved work actions are paused here. Check the save status; moving to another site will not enable them.'
          : v28River ? 'Gather logs and reveal a complete supported crossing before trying Works again.'
          : starterGreenwayWorks ? 'Gather logs for the bridge, then equip a field spade for the far-bank dig.'
            : works3Greenway || works4Greenway ? 'Gather logs for bridges and ladders, or equip a spade for far-bank digging.'
            : projection.v42IronHall
              ? 'Gather logs and equip a field spade before using the center creek bridge. Saved building and digging become available beyond Greenway.'
              : 'Gather logs and equip a field spade before heading west. Saved building and digging become available beyond Greenway.'}</p>
      {projection.savedTerrainWorks.preview?.guidance && (!v26Terrain || v28River) && <p role="note">{projection.savedTerrainWorks.preview.guidance}</p>}
      {(works4Greenway ? knownWorks : projection.savedTerrainWorks.preview?.nearby ?? [])
        .map(({ site, distanceMeters, benefit, reason }) => <p key={site.id}>
        {site.kind === 'bridge' ? 'Bridge' : site.kind === 'ladder' ? 'Ladder' : 'Dig'} nearby ({distanceMeters.toFixed(1)} m): {benefit} {site.id === nextWork?.site.id ? workReason(nextWork) : reason}
      </p>)}
    </details>}
    {projection.fieldCamp?.selectionEnabled && !projection.unavailableActions && <p className="wr-map-guidance">Find flat 3×3 loam ground. Move within 3 m of a site to build. Scroll the map or use arrow keys to choose a cell; Enter or Space previews one.</p>}
    {!continuity && !projection.starterCliff && firstRoute && bridgeRoute && <p className="wr-map-guidance" role="note" aria-label="Route roadmap">
      Route roadmap: Greenway low steps ({firstRoute.logCost} logs) to Northern Ridge. Next, Highland bridge east to Eastern Highland ({bridgeRoute.logCost} logs, {bridgeStatus}).{projection.savedTerrainWorks && (v28River ? ' Marked connected-river bridges are separate Works.' : ' Fen bridges in Mireglass are separate Works.')}
    </p>}
    {!continuity && <RouteKey routes={projection.routes} buildSites={projection.buildSites} selectedBuildSiteId={projection.selectedBuildSiteId}
      physicalRoutes={projection.physicalRoutes !== undefined}
      starterCliff={projection.starterCliff}
      worksLadderBuilt={builtWorksLadders.length > 0}
      actionsEnabled={!projection.unavailableActions && !savePaused} savePaused={savePaused}
      onSelect={(siteId) => { onIntent({ type: 'build-site.select', siteId }); onToggle() }} />}
  </div>
  return <>
    <button ref={buttonRef} className="wr-map-toggle" aria-expanded={open} aria-controls={open ? 'wizard-world-map' : undefined} onClick={onToggle}>
      <span className="wr-map-toggle-label"><span>Map / routes</span><small>M</small></span>
      {!open && <span className="wr-map-compact" aria-hidden="true"><MapGrid projection={projection} compact /></span>}
    </button>
    {open && <div className="wr-map-backdrop"><section id="wizard-world-map" className="wr-map-dialog" role="dialog" aria-modal="true" aria-labelledby="wizard-world-map-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onToggle(); return }
        if (!mapToggleForKey(true, event.code, event.repeat)) {
          event.preventDefault(); event.stopPropagation(); onToggle(); return
        }
        if (event.key !== 'Tab') return
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, summary, [href], input, select, textarea, [tabindex]')]
          .filter((control) => control.tabIndex >= 0 && !control.hasAttribute('disabled') && control.getClientRects().length > 0)
        const next = mapDialogTabTarget(true, event.key, event.shiftKey, controls.indexOf(document.activeElement as HTMLElement), controls.length)
        if (next !== null) { event.preventDefault(); controls[next].focus() }
      }}>
      <header><div><small>NORTH-UP EXPLORATION MAP</small><h2 id="wizard-world-map-title">{projection.map.title ?? 'Greenway atlas'}</h2></div><button ref={closeRef} onClick={onToggle} aria-label="Close map">×</button></header>
      {projection.savedTerrainWorks && <style>{`.wr-map-work-guide{margin:10px 0;font-size:12px;color:#b7c2b9}.wr-map-work-guide>summary{box-sizing:border-box;display:flex;align-items:center;min-height:44px;padding:8px;border:1px solid #d5b86f88;border-radius:8px;color:#f5d889;cursor:pointer}.wr-map-work-guide>summary:focus-visible{outline:3px solid #ffe395;outline-offset:2px}.wr-map-work-guide p{margin:8px 0;overflow-wrap:anywhere}.wr-map-route-key{padding:8px;border:1px solid #d5b86f88;border-radius:8px;background:#1d2a24}.wr-map-route-key h3{margin:0 0 6px;color:#f5d889;font-size:13px}.wr-map-route-key ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin:0;padding:0;list-style:none}.wr-map-route-key li{display:grid;gap:3px;align-content:start;font-size:11px}.wr-map-route-key li span{color:#e3e6d8}.wr-map-route-key li small{color:#f5d889;overflow-wrap:anywhere}@media(min-width:900px) and (min-height:600px){.wr-map-dialog:has(.wr-map-route-key){width:min(1000px,94vw)}.wr-map-local:has(.wr-map-route-key){display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:16px;align-items:start}.wr-map-local:has(.wr-map-route-key)>.wr-map-guidance:first-child{grid-column:1/-1}.wr-map-local:has(.wr-map-route-key)>.wr-map-grid,.wr-map-local:has(.wr-map-route-key)>.wr-map-camp-window{grid-column:1;grid-row:2;width:min(55vh,100%)}.wr-map-local:has(.wr-map-route-key)>.wr-map-legend{grid-column:1;grid-row:3}.wr-map-local:has(.wr-map-route-key)>.wr-map-route-key{grid-column:2;grid-row:2/span 2}.wr-map-local:has(.wr-map-route-key)>.wr-map-route-key ul{grid-template-columns:1fr}.wr-map-local:has(.wr-map-route-key)>:not(.wr-map-grid):not(.wr-map-camp-window):not(.wr-map-legend):not(.wr-map-route-key){grid-column:1/-1}}`}</style>}
      {projection.map.overview ? <>
        <style>{`.wr-map-overview[open]~.wr-map-local{display:none}.wr-map-overview>summary{box-sizing:border-box;display:flex;align-items:center;min-height:44px;margin:0 0 12px;padding:8px 12px;border:1px solid #d5b86f88;border-radius:8px;background:#283a30;color:#f5d889;cursor:pointer}.wr-map-overview>summary:focus-visible{outline:3px solid #ffe395;outline-offset:2px}.wr-overview-grid{display:grid;gap:2px;width:min(60vh,100%);margin:auto}.wr-overview-cell{position:relative;display:grid;place-items:center;min-width:0;aspect-ratio:1;border:1px solid #ffffff1b;background:#17201e;color:#fff;font-size:10px}.wr-overview-cell[data-discovered=false]{border-style:dashed}.wr-overview-cell i{position:absolute;inset:20%;border-radius:2px;opacity:.72}.wr-overview-cell b{position:relative}.wr-map-overview p,.wr-map-local>p{margin:10px 0;color:#b7c2b9;font-size:12px}`}</style>
        <LazyOverview load={projection.map.overview} hasCamp={Boolean(projection.fieldCamp)} />
        {localMap}
      </> : localMap}
    </section></div>}
  </>
}
