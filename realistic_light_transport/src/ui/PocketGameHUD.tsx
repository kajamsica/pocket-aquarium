import type { DiagnosticView, ReefRenderSettings, ReefRenderTelemetry, RenderQuality } from '../contracts'
import type { PocketGameView, PocketStoreOffer } from '../integration/pocketAquariumBridge'

const SPEEDS = [0, 1, 4, 8] as const
const QUALITIES = ['balanced', 'cinematic'] as const satisfies readonly RenderQuality[]
const DIAGNOSTICS = ['beauty', 'spectral', 'flow'] as const satisfies readonly DiagnosticView[]

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
  const { clock, tank, lightField, events } = view.reefSnapshot
  const levelRatio = Math.min(1, Math.max(0, view.water.levelL / tank.targetWaterVolumeLiters))

  return (
    <div className="reef-hud pocket-game-hud">
      <header className="hud-topbar">
        <div className="hud-brand">
          <span className="hud-brand-mark" aria-hidden="true">PA</span>
          <div>
            <p>Mature reef showcase</p>
            <h1>Pocket Reef Lab</h1>
          </div>
        </div>

        <div className="hud-run-state" aria-label="Authoritative game status">
          <span className="hud-live-dot" data-paused={clock.paused} aria-hidden="true" />
          <div>
            <span>{clock.paused ? 'Root simulation paused' : `Root simulation ${clock.speed}×`}</span>
            <strong>Day {clock.day} · {view.cycleStage}</strong>
          </div>
        </div>

        <div className="hud-namespace" title="Pre-stocked sandbox using Pocket Aquarium game state">
          <span aria-hidden="true">●</span>
          <code>{view.reefSnapshot.namespace}</code>
          <small>showcase</small>
        </div>
      </header>

      <aside className="hud-panel hud-water-panel" aria-labelledby="pocket-water-heading">
        <div className="hud-panel-heading">
          <div>
            <p>Tested water parameters</p>
            <h2 id="pocket-water-heading">{view.habitatName}</h2>
          </div>
          <span className="hud-status-chip" data-alert={!view.cycled}>{view.cycled ? 'Cycled' : 'Cycling'}</span>
        </div>

        <dl className="hud-metric-grid pocket-summary-grid" aria-label="Progression and tank summary">
          <div className="hud-metric"><dt>Credits</dt><dd>{view.credits}</dd></div>
          <div className="hud-metric"><dt>XP</dt><dd>{view.xp}</dd></div>
          <div className="hud-metric"><dt>Tier</dt><dd>{view.tierName}</dd></div>
          <div className="hud-metric"><dt>Residents</dt><dd>{view.specimens.length}</dd></div>
        </dl>

        <div className="pocket-water-level">
          <div><span>Water level</span><strong>{view.water.levelL.toFixed(1)} / {tank.targetWaterVolumeLiters.toFixed(1)} L</strong></div>
          <progress max={tank.targetWaterVolumeLiters} value={view.water.levelL} aria-label="Operating water level">
            {Math.round(levelRatio * 100)}%
          </progress>
          <small>{Math.round(levelRatio * 100)}% of operating target</small>
        </div>

        <dl className="hud-metric-grid pocket-water-metrics" aria-label="Latest authoritative water test">
          <div className="hud-metric hud-metric-primary"><dt>Salinity</dt><dd>{reading(view.water.salinity, 2, ' ppt')}</dd></div>
          <div className="hud-metric"><dt>PAR</dt><dd>{reading(view.water.par, 0, ' µmol')}</dd></div>
          <div className="hud-metric"><dt>Flow</dt><dd>{reading(view.water.flow, 2, ' idx')}</dd></div>
          <div className="hud-metric"><dt>Ammonia</dt><dd>{reading(view.water.ammonia, 3, ' mg/L')}</dd></div>
          <div className="hud-metric"><dt>Nitrite</dt><dd>{reading(view.water.nitrite, 3, ' mg/L')}</dd></div>
          <div className="hud-metric"><dt>Nitrate</dt><dd>{reading(view.water.nitrate, 2, ' mg/L')}</dd></div>
          <div className="hud-metric"><dt>Phosphate</dt><dd>{reading(view.water.phosphate, 3, ' mg/L')}</dd></div>
          <div className="hud-metric"><dt>Temperature</dt><dd>{reading(view.water.tempC, 1, ' °C')}</dd></div>
          <div className="hud-metric"><dt>pH</dt><dd>{reading(view.water.pH, 2)}</dd></div>
        </dl>

        <div className="hud-light-reading">
          <div><span>Local PPFD</span><strong>{Math.round(lightField.localPpfd)}</strong><small>µmol photons m⁻² s⁻¹</small></div>
          <p>RLT sample at {lightField.sampleDepthMeters.toFixed(2)} m, read-only physical presentation.</p>
        </div>

        <div className="hud-event" aria-live="polite" aria-atomic="true">
          <span>Latest root event · #{events.sequence}</span>
          <strong>{events.lastEvent}</strong>
          <p>{events.causalNote}</p>
        </div>
      </aside>

      <aside className="hud-panel hud-ecology-panel" aria-labelledby="pocket-store-heading">
        <section className="hud-render-lab" aria-labelledby="pocket-render-heading">
          <div className="hud-render-lab-heading">
            <div><p>Read-only physical services</p><h2 id="pocket-render-heading">Optics and flow</h2></div>
            <span>{renderSettings.diagnosticView} view</span>
          </div>
          <div className="hud-render-controls">
            <div className="hud-render-choice">
              <span id="pocket-quality-label">Quality</span>
              <div role="group" aria-labelledby="pocket-quality-label">
                {QUALITIES.map((quality) => (
                  <button key={quality} type="button" aria-pressed={renderSettings.quality === quality}
                    onClick={() => onRenderSettingsChange({ ...renderSettings, quality })}>{quality}</button>
                ))}
              </div>
            </div>
            <div className="hud-render-choice">
              <span id="pocket-diagnostic-label">Diagnostic</span>
              <div role="group" aria-labelledby="pocket-diagnostic-label">
                {DIAGNOSTICS.map((diagnosticView) => (
                  <button key={diagnosticView} type="button" aria-pressed={renderSettings.diagnosticView === diagnosticView}
                    onClick={() => onRenderSettingsChange({ ...renderSettings, diagnosticView })}>{diagnosticView}</button>
                ))}
              </div>
            </div>
          </div>
          <details className="hud-render-telemetry">
            <summary>Render telemetry <span>{renderTelemetry ? 'Live' : 'Awaiting scene'}</span></summary>
            <dl>
              <div><dt>Visible transmission</dt><dd>{telemetry(renderTelemetry?.optics.meanVisibleTransmittance === undefined ? undefined : renderTelemetry.optics.meanVisibleTransmittance * 100, 1, '%')}</dd></div>
              <div><dt>Chromatic spread</dt><dd>{telemetry(renderTelemetry?.optics.chromaticSpreadPixels, 2, ' px')}</dd></div>
              <div><dt>Mean flow</dt><dd>{telemetry(renderTelemetry?.flow.meanSpeedMetersPerSecond, 3, ' m/s')}</dd></div>
              <div><dt>Peak flow</dt><dd>{telemetry(renderTelemetry?.flow.peakSpeedMetersPerSecond, 3, ' m/s')}</dd></div>
            </dl>
          </details>
        </section>

        <section className="pocket-store" aria-labelledby="pocket-store-heading">
          <div className="hud-panel-heading">
            <div><p>Root catalog and validation</p><h2 id="pocket-store-heading">Store</h2></div>
            <span className="hud-day-chip">{view.storeOffers.length} offers</span>
          </div>
          <ul className="pocket-store-list">
            {view.storeOffers.map((offer) => (
              <li className="hud-event pocket-store-offer" key={`${offer.kind}:${offer.id}`} data-locked={!offer.allowed}>
                <div><span>{offer.kind}</span><strong>{offer.name}</strong><small>{offer.price} credits</small></div>
                <button className="hud-button" type="button" disabled={!offer.allowed} onClick={() => dispatch(offer.action)}>
                  {offer.allowed ? 'Purchase' : 'Locked'}
                </button>
                {offer.reasons.length > 0 ? (
                  <ul className="pocket-lock-reasons" aria-label={`${offer.name} lock reasons`}>
                    {offer.reasons.map((reason, index) => <li key={`${index}:${reason}`}>{reason}</li>)}
                  </ul>
                ) : <p className="pocket-offer-ready">Eligible under current root rules.</p>}
              </li>
            ))}
          </ul>
        </section>
      </aside>

      <section className="hud-control-deck pocket-control-deck" aria-label="Pocket Aquarium care controls">
        <div className="hud-control-primary pocket-care-controls">
          <button className="hud-button hud-button-feed" type="button" onClick={() => dispatch({ type: 'FEED', x: 0.5, y: 0.38 })}>✦ Feed</button>
          <button className="hud-button" type="button" onClick={() => dispatch({ type: 'WATER_TEST' })}>Water test</button>
          <button className="hud-button" type="button" onClick={() => dispatch({ type: 'WATER_CHANGE', fraction: 0.25 })}>25% water change</button>
          <button className="hud-button hud-button-ato" type="button" onClick={() => dispatch({ type: 'WATER_TOP_OFF' })}>Freshwater top-off</button>
        </div>
        <div className="hud-speed-control pocket-speed-control" role="group" aria-label="Simulation speed">
          <span>Root speed</span>
          {SPEEDS.map((speed) => (
            <button key={speed} type="button" aria-pressed={clock.speed === speed}
              aria-label={speed === 0 ? 'Pause simulation' : `Set simulation speed to ${speed} times`}
              onClick={() => dispatch({ type: 'SET_SPEED', speed })}>{speed === 0 ? 'Pause' : `${speed}×`}</button>
          ))}
        </div>
      </section>
    </div>
  )
}
