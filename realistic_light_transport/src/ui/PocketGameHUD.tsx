import { useState } from 'react'

import type { DiagnosticView, ReefRenderSettings, ReefRenderTelemetry, RenderQuality } from '../contracts'
import type { PocketGameView, PocketStoreOffer } from '../integration/pocketAquariumBridge'

const SPEEDS = [0, 1, 4, 8] as const
const QUALITIES = ['balanced', 'cinematic'] as const satisfies readonly RenderQuality[]
const DIAGNOSTICS = ['beauty', 'spectral', 'flow'] as const satisfies readonly DiagnosticView[]

type SheetId = 'care' | 'store' | 'journal' | 'tune'
const SHEETS: readonly { readonly id: SheetId; readonly label: string }[] = [
  { id: 'care', label: 'Care' },
  { id: 'store', label: 'Store' },
  { id: 'journal', label: 'Journal' },
  { id: 'tune', label: 'Tune' },
]

const OFFER_EFFECT: Record<PocketStoreOffer['kind'], string> = {
  livestock: 'Adds a living inhabitant — raises bioload the biofilter must handle.',
  coral: 'Adds a calcifier that draws down alkalinity/calcium as it grows.',
  equipment: 'Upgrades a life-support system (filtration, flow, light, heat, or top-off).',
  tier: 'Larger tank — more water volume dilutes waste and raises the stocking cap.',
}

interface PocketGameHUDProps {
  readonly view: PocketGameView
  readonly dispatch: (action: PocketStoreOffer['action']) => void
  readonly renderSettings: ReefRenderSettings
  readonly renderTelemetry?: ReefRenderTelemetry
  readonly onRenderSettingsChange: (settings: ReefRenderSettings) => void
}

function reading(value: number, digits: number, unit = '') {
  return `${value.toFixed(digits)}${unit}`
}

function telemetry(value: number | undefined, digits: number, unit = '') {
  return value === undefined || !Number.isFinite(value) ? 'Sampling' : `${value.toFixed(digits)}${unit}`
}

export function PocketGameHUD({
  view,
  dispatch,
  renderSettings,
  renderTelemetry,
  onRenderSettingsChange,
}: PocketGameHUDProps) {
  const [openSheet, setOpenSheet] = useState<SheetId | null>(null)
  const { clock } = view.reefSnapshot
  const water = view.water
  const status = !view.filled ? 'Dry' : !view.cycled ? 'Cycling' : view.alerts.length ? view.alerts[0] : 'Stable'
  const toggle = (id: SheetId) => setOpenSheet((current) => (current === id ? null : id))

  const waterCards: readonly { title: string; rows: readonly [string, string][] }[] = [
    { title: 'Nitrogen cycle', rows: [
      ['Ammonia', reading(water.ammonia, 3, ' mg/L')],
      ['Nitrite', reading(water.nitrite, 3, ' mg/L')],
      ['Nitrate', reading(water.nitrate, 2, ' mg/L')],
    ] },
    { title: 'Stability', rows: [
      ['Cycle', view.cycleStage],
      ['pH', reading(water.pH, 2)],
      ['Phosphate', reading(water.phosphate, 3, ' mg/L')],
    ] },
    { title: 'Salinity / temp', rows: [
      ['Salinity', reading(water.salinity, 2, ' ppt')],
      ['Temperature', reading(water.tempC, 1, ' °C')],
    ] },
    { title: 'Light / flow', rows: [
      ['PAR', reading(water.par, 0, ' µmol')],
      ['Flow', reading(water.flow, 2, ' idx')],
    ] },
  ]

  return (
    <div className="pa-hud">
      <header className="pa-rail">
        <div className="pa-rail-live">
          <span className="pa-live-dot" data-paused={clock.paused} aria-hidden="true" />
          <span>{clock.paused ? 'Paused' : `${clock.speed}×`}</span>
        </div>
        <button className="pa-rail-objective" type="button" onClick={() => setOpenSheet(view.objective.destination)}
          aria-label={`Open ${view.objective.destination}: ${view.objective.title}`}>
          <span>{view.objective.chapter}</span>
          <strong>{view.nextAction.title}</strong>
          <small>{view.nextAction.detail}</small>
        </button>
        <dl className="pa-rail-stats">
          <div data-alert={view.alerts.length > 0}><dt>Status</dt><dd>{status}</dd></div>
          <div><dt>Credits</dt><dd>{view.credits}</dd></div>
          <div><dt>Day</dt><dd>{clock.day}</dd></div>
        </dl>
      </header>

      <div className="pa-spacer">
        <p className="pa-feed-hint" aria-hidden="true">Tap the water to feed</p>
      </div>

      <div className="pa-bottom">
      {openSheet && (
        <section className="pa-sheet" role="dialog" aria-label={`${openSheet} panel`}>
          <div className="pa-sheet-head">
            <h2>{SHEETS.find((sheet) => sheet.id === openSheet)?.label}</h2>
            <button className="pa-close" type="button" aria-label="Close panel" onClick={() => setOpenSheet(null)}>✕</button>
          </div>
          <div className="pa-sheet-body">
            {openSheet === 'care' && (
              <>
                <article className="pa-guide-card">
                  <span>{view.objective.chapter}</span>
                  <h3>{view.objective.title}</h3>
                  <p>{view.objective.lesson}</p>
                  {view.objective.action && view.objective.actionLabel && (
                    <button className="hud-button pa-primary-action" type="button"
                      onClick={() => dispatch(view.objective.action!)}>{view.objective.actionLabel}</button>
                  )}
                </article>
                <ol className="pa-nitrogen-chain" aria-label="Nitrogen cycle">
                  <li data-active={water.ammonia > 0.05}><span>1 · Waste</span><strong>Ammonia</strong><small>{reading(water.ammonia, 2, ' mg/L')} · toxic fuel</small></li>
                  <li data-active={water.nitrite > 0.05}><span>2 · First colony</span><strong>Nitrite</strong><small>{reading(water.nitrite, 2, ' mg/L')} · toxic middle</small></li>
                  <li data-active={water.nitrate > 1}><span>3 · Second colony</span><strong>Nitrate</strong><small>{reading(water.nitrate, 1, ' mg/L')} · exportable end</small></li>
                </ol>
                <div className="pa-card-grid">
                  {waterCards.map((card) => (
                    <div className="pa-card" key={card.title}>
                      <h3>{card.title}</h3>
                      <dl>
                        {card.rows.map(([label, value]) => (
                          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
                <div className="pa-actions">
                  <button className="hud-button" type="button" onClick={() => dispatch({ type: 'WATER_TEST' })}>Water test</button>
                  <button className="hud-button" type="button" onClick={() => dispatch({ type: 'WATER_CHANGE', fraction: 0.25 })}>25% water change</button>
                  <button className="hud-button" type="button" onClick={() => dispatch({ type: 'WATER_TOP_OFF' })}>Freshwater top-off</button>
                </div>
                <div className="pa-speed" role="group" aria-label="Simulation speed">
                  <span>Speed</span>
                  {SPEEDS.map((speed) => (
                    <button key={speed} type="button" aria-pressed={clock.speed === speed}
                      onClick={() => dispatch({ type: 'SET_SPEED', speed })}>{speed === 0 ? 'Pause' : `${speed}×`}</button>
                  ))}
                </div>
              </>
            )}

            {openSheet === 'store' && (
              <ul className="pa-store">
                {view.storeOffers.map((offer) => (
                  <li className="pa-offer" key={`${offer.kind}:${offer.id}`} data-locked={!offer.allowed}>
                    <div className="pa-offer-head">
                      <div><span>{offer.kind}</span><strong>{offer.name}</strong></div>
                      <button className="hud-button" type="button" disabled={!offer.allowed} onClick={() => dispatch(offer.action)}>
                        {offer.allowed ? `${offer.price}c` : 'Locked'}
                      </button>
                    </div>
                    <p className="pa-offer-effect">{OFFER_EFFECT[offer.kind]}</p>
                    {offer.reasons.length > 0 && (
                      <ul className="pa-offer-reasons">
                        {offer.reasons.map((reason, index) => <li key={`${index}:${reason}`}>{reason}</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {openSheet === 'journal' && (
              <>
                <div className="pa-event">
                  <span>Latest · #{view.reefSnapshot.events.sequence}</span>
                  <strong>{view.reefSnapshot.events.lastEvent}</strong>
                </div>
                <ul className="pa-residents">
                  {view.specimens.map((specimen) => (
                    <li key={specimen.id}>
                      <strong>{specimen.name}</strong>
                      <small>hunger {Math.round(specimen.hunger * 100)}% · health {Math.round(specimen.health * 100)}%</small>
                    </li>
                  ))}
                  {view.specimens.length === 0 && <li><small>No livestock yet — stock the tank once it is cycled.</small></li>}
                </ul>
              </>
            )}

            {openSheet === 'tune' && (
              <div className="pa-tune">
                <div className="pa-choice" role="group" aria-label="Render quality">
                  <span>Quality</span>
                  {QUALITIES.map((quality) => (
                    <button key={quality} type="button" aria-pressed={renderSettings.quality === quality}
                      onClick={() => onRenderSettingsChange({ ...renderSettings, quality })}>{quality}</button>
                  ))}
                </div>
                <div className="pa-choice" role="group" aria-label="Diagnostic view">
                  <span>View</span>
                  {DIAGNOSTICS.map((diagnosticView) => (
                    <button key={diagnosticView} type="button" aria-pressed={renderSettings.diagnosticView === diagnosticView}
                      onClick={() => onRenderSettingsChange({ ...renderSettings, diagnosticView })}>{diagnosticView}</button>
                  ))}
                </div>
                <dl className="pa-telemetry">
                  <div><dt>Visible transmission</dt><dd>{telemetry(renderTelemetry?.optics.meanVisibleTransmittance === undefined ? undefined : renderTelemetry.optics.meanVisibleTransmittance * 100, 1, '%')}</dd></div>
                  <div><dt>Mean flow</dt><dd>{telemetry(renderTelemetry?.flow.meanSpeedMetersPerSecond, 3, ' m/s')}</dd></div>
                </dl>
                <div className="pa-new-tank">
                  <strong>Test the first-run chapter</strong>
                  <small>Clears this reef's livestock, water, and cycle state. Your current tank cannot be recovered afterward.</small>
                  <button className="hud-button" type="button" onClick={() => {
                    if (window.confirm('Start a new dry reef? This replaces the current aquarium save.')) {
                      dispatch({ type: 'CHOOSE_HABITAT', habitat: 'reef' })
                      setOpenSheet('care')
                    }
                  }}>Start new reef</button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <nav className="pa-dock" aria-label="Aquarium panels">
        {SHEETS.map((sheet) => (
          <button key={sheet.id} type="button" aria-pressed={openSheet === sheet.id} onClick={() => toggle(sheet.id)}>
            {sheet.label}
          </button>
        ))}
      </nav>
      </div>
    </div>
  )
}
