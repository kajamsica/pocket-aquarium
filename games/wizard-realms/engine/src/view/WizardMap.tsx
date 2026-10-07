import type { WizardMapTile, WizardRoute, WizardViewProjection } from './contracts'
import type { RefObject } from 'react'

const TERRAIN = { loam: '#56824b', wetland: '#466f62', rocky: '#7b765e', snow: '#d4e3df' } as const

export const mapToggleForKey = (open: boolean, code: string, repeat = false) => code === 'KeyM' && !repeat ? !open : open
export const mapSheetMode = (width: number) => width < 720 ? 'sheet' : 'modal'

function Tile({ tile, player }: { tile: WizardMapTile; player: WizardViewProjection['map']['player'] }) {
  const occupied = tile.gridX === player.gridX && tile.gridZ === player.gridZ
  const marker = occupied ? '▲' : tile.hasStore ? 'S' : tile.hasRing ? 'R' : tile.hasResource ? '•' : tile.discovered ? '' : '?'
  return <span className="wr-map-tile" data-discovered={tile.discovered} style={{ background: tile.terrain ? TERRAIN[tile.terrain as keyof typeof TERRAIN] : '#17201e' }} aria-label={`${tile.id}: ${tile.discovered ? tile.biome : 'unexplored'}${occupied ? ', player location' : ''}`}>
    <b style={occupied ? { transform: `rotate(${player.yaw}rad)` } : undefined}>{marker}</b>
  </span>
}

function MapGrid({ projection }: { projection: WizardViewProjection }) {
  const tiles = [...projection.map.tiles].sort((left, right) => left.gridZ - right.gridZ || left.gridX - right.gridX)
  return <div className="wr-map-grid" aria-label="North-up world map">{tiles.map((tile) => <Tile key={tile.id} tile={tile} player={projection.map.player} />)}</div>
}

function RouteKey({ routes }: { routes: readonly WizardRoute[] }) {
  return <div className="wr-map-routes">{routes.map((route) => <div key={route.id}><b>{route.built ? '✓' : route.unlocked ? '◇' : '×'} {route.label}</b><span>{route.built ? 'completed' : route.unlocked ? `${route.logCost} logs` : 'locked'}</span></div>)}</div>
}

export function WizardMap({ projection, open, onToggle, buttonRef, closeRef }: {
  projection: WizardViewProjection
  open: boolean
  onToggle: () => void
  buttonRef: RefObject<HTMLButtonElement | null>
  closeRef: RefObject<HTMLButtonElement | null>
}) {
  return <>
    <button ref={buttonRef} className="wr-map-toggle" aria-expanded={open} aria-controls="wizard-world-map" onClick={onToggle}>
      <span>Map</span><small>M</small>
    </button>
    {!open && <div className="wr-map-compact" aria-hidden="true"><MapGrid projection={projection} /></div>}
    {open && <div className="wr-map-backdrop"><section id="wizard-world-map" className="wr-map-dialog" role="dialog" aria-modal="true" aria-labelledby="wizard-world-map-title">
      <header><div><small>NORTH-UP EXPLORATION MAP</small><h2 id="wizard-world-map-title">Greenway atlas</h2></div><button ref={closeRef} onClick={onToggle} aria-label="Close map">×</button></header>
      <MapGrid projection={projection} />
      <RouteKey routes={projection.routes} />
      <p>▲ you · S store · R fairy ring · • resource · ? unexplored</p>
    </section></div>}
  </>
}
