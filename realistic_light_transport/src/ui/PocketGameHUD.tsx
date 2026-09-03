import { useState } from 'react'

import type { DiagnosticView, ReefRenderSettings, ReefRenderTelemetry, RenderQuality } from '../contracts'
import type { PocketAction, PocketGameView, PocketStoreOffer } from '../integration/pocketAquariumBridge'

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
  readonly dispatch: (action: PocketAction) => void
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
  const hungryCount = view.specimens.filter((specimen) => specimen.kind === 'fish' && specimen.hunger > .12).length
  const deadCount = view.residents.filter((specimen) => !specimen.alive).length
  const recommendedOffers = new Set(view.careRecommendations.map((item) => item.suggestedOfferId).filter(Boolean))
  const actionableStatus = view.careRecommendations.find((item) => item.severity !== 'stable')?.severity
  const status = !view.filled ? 'Dry'
    : !view.cycled && view.residents.length === 0 ? 'Cycling'
      : actionableStatus === 'urgent' ? 'Critical'
        : actionableStatus === 'watch' ? 'Watch'
          : view.alerts.length ? 'Watch' : 'Stable'
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

      {view.selectedSpecimen && (
        <aside className="pa-inspector" aria-label={`${view.selectedSpecimen.name} details`}>
          <button className="pa-close" type="button" aria-label="Close fish details"
            onClick={() => dispatch({ type: 'SELECT_ENTITY', id: null })}>✕</button>
          <span>{view.selectedSpecimen.alive ? `${view.selectedSpecimen.stage} · ${view.selectedSpecimen.sex}` : 'Deceased'}</span>
          <strong>{view.selectedSpecimen.name}</strong>
          <em>{view.selectedSpecimen.scientificName}</em>
          <dl>
            <div><dt>Age</dt><dd>{view.selectedSpecimen.ageDays.toFixed(1)} days</dd></div>
            <div><dt>Needs food</dt><dd>{Math.round(view.selectedSpecimen.hunger * 100)}%</dd></div>
            <div><dt>Condition</dt><dd>{Math.round(view.selectedSpecimen.condition * 100)}%</dd></div>
            <div><dt>Health</dt><dd>{Math.round(view.selectedSpecimen.health * 100)}%</dd></div>
          </dl>
          {!view.selectedSpecimen.alive && (
            <button className="hud-button pa-danger-action" type="button"
              onClick={() => dispatch({ type: 'REMOVE_DEAD', id: view.selectedSpecimen!.id })}>Remove remains</button>
          )}
        </aside>
      )}

      <div className="pa-spacer">
        <p className="pa-feed-hint" aria-hidden="true">
          {hungryCount > 0 ? `Tap to feed · ${hungryCount} ${hungryCount === 1 ? 'fish' : 'fish'} waiting` : 'Observe the aquarium'}
        </p>
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
                <section className="pa-diagnosis" aria-label="Recommended tank care">
                  {view.careRecommendations.map((item) => (
                    <article key={item.title} data-severity={item.severity}>
                      <div><span>{item.severity === 'stable' ? 'Observation' : item.severity}</span><strong>{item.title}</strong></div>
                      <p>{item.cause}</p>
                      <div className="pa-diagnosis-actions">
                        {item.action && item.actionLabel && <button className="hud-button" type="button" onClick={() => dispatch(item.action!)}>{item.actionLabel}</button>}
                        {item.suggestedOfferId && <button className="hud-button" type="button" onClick={() => setOpenSheet('store')}>Durable fix · {item.suggestedOfferName}</button>}
                        {item.title.startsWith('Remove') && <button className="hud-button" type="button" onClick={() => setOpenSheet('journal')}>Review remains</button>}
                      </div>
                    </article>
                  ))}
                </section>
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
                  <li className="pa-offer" key={`${offer.kind}:${offer.id}`} data-locked={!offer.allowed}
                    data-recommended={recommendedOffers.has(offer.id)}>
                    <div className="pa-offer-head">
                      <div><span>{recommendedOffers.has(offer.id) ? 'Recommended for this tank' : offer.kind}</span><strong>{offer.name}</strong></div>
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
                  {view.residents.map((specimen) => (
                    <li key={specimen.id} data-dead={!specimen.alive}>
                      <button className="pa-resident-info" type="button"
                        onClick={() => dispatch({ type: 'SELECT_ENTITY', entityType: 'livestock', id: specimen.id })}>
                        <strong>{specimen.name}</strong>
                        <small>{specimen.alive
                          ? `needs food ${Math.round(specimen.hunger * 100)}% · health ${Math.round(specimen.health * 100)}%`
                          : `${specimen.causeOfDeath ?? 'unknown cause'} · decaying ${(specimen.decayDays ?? 0).toFixed(1)} days`}</small>
                      </button>
                      {!specimen.alive && <button className="hud-button pa-danger-action" type="button"
                        onClick={() => dispatch({ type: 'REMOVE_DEAD', id: specimen.id })}>Remove</button>}
                    </li>
                  ))}
                  {view.residents.length === 0 && <li><small>No livestock yet — stock the tank once it is cycled.</small></li>}
                </ul>
                {deadCount > 1 && <button className="hud-button pa-danger-action" type="button"
                  onClick={() => view.residents.filter((specimen) => !specimen.alive)
                    .forEach((specimen) => dispatch({ type: 'REMOVE_DEAD', id: specimen.id }))}>Remove all {deadCount} remains</button>}
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
                <label className="pa-brightness">
                  <span>Viewing brightness <small>visual only · PAR unchanged</small></span>
                  <output>{Math.round(renderSettings.brightness * 100)}%</output>
                  <input type="range" min="0.75" max="1.35" step="0.05" value={renderSettings.brightness}
                    onChange={(event) => onRenderSettingsChange({ ...renderSettings, brightness: Number(event.target.value) })} />
                </label>
                <p className="pa-gesture-note">Pinch on the aquarium to zoom. Use the mouse wheel on desktop.</p>
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
