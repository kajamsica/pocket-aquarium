import { useCallback, useEffect, useRef, useState } from 'react'

import type { DiagnosticView, ReefRenderSettings, ReefRenderTelemetry } from './contracts'
import {
  advancePocketState,
  createPocketReefShowcase,
  dispatchPocketAction,
  projectPocketState,
} from './integration/pocketAquariumBridge'
import { ReefScene } from './scene/ReefScene'

const UPDATE_INTERVAL_MS = 250
const MAX_ELAPSED_REAL_SECONDS = 0.5
const RENDER_TELEMETRY_INTERVAL_MS = 250
const DEFAULT_RENDER_SETTINGS: ReefRenderSettings = {
  quality: 'balanced',
  diagnosticView: 'beauty',
}

export default function App() {
  const [pocketState, setPocketState] = useState(createPocketReefShowcase)
  const [renderSettings, setRenderSettings] = useState(DEFAULT_RENDER_SETTINGS)
  const [renderTelemetry, setRenderTelemetry] = useState<ReefRenderTelemetry>()
  const lastTelemetryUpdate = useRef(0)
  const view = projectPocketState(pocketState)

  useEffect(() => {
    let previousUpdate = performance.now()

    const timer = window.setInterval(() => {
      const currentUpdate = performance.now()
      const elapsedRealSeconds = Math.min(
        (currentUpdate - previousUpdate) / 1000,
        MAX_ELAPSED_REAL_SECONDS,
      )
      previousUpdate = currentUpdate
      setPocketState((current) => advancePocketState(current, elapsedRealSeconds))
    }, UPDATE_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [])

  const dispatch = useCallback((action: Parameters<typeof dispatchPocketAction>[1]) => {
    setPocketState((current) => dispatchPocketAction(current, action))
  }, [])

  const updateRenderTelemetry = useCallback((telemetry: ReefRenderTelemetry) => {
    const now = performance.now()
    if (now - lastTelemetryUpdate.current < RENDER_TELEMETRY_INTERVAL_MS) return
    lastTelemetryUpdate.current = now
    setRenderTelemetry(telemetry)
  }, [])

  return (
    <main className="reef-app">
      <ReefScene
        snapshot={view.reefSnapshot}
        renderSettings={renderSettings}
        onRenderTelemetry={updateRenderTelemetry}
      />
      <div className="reef-hud">
        <header className="hud-topbar">
          <div className="hud-brand">
            <span className="hud-brand-mark" aria-hidden="true">PA</span>
            <div><p>Integrated showcase</p><h1>Pocket Reef Lab</h1></div>
          </div>
          <div className="hud-run-state" aria-label="Pocket Aquarium authority proof">
            <span className="hud-live-dot" data-paused={view.reefSnapshot.clock.paused} />
            <div><span>Gameplay authority: root PA</span><strong>RLT optics and flow presentation</strong></div>
          </div>
          <div className="hud-namespace"><span aria-hidden="true">●</span><code>marine_reef</code><small>showcase</small></div>
        </header>

        <aside className="hud-panel hud-water-panel" aria-labelledby="proof-water">
          <div className="hud-panel-heading"><div><p>Authoritative water</p><h2 id="proof-water">{view.cycleStage}</h2></div>
            <span className="hud-status-chip">{view.cycled ? 'Cycled' : 'Cycling'}</span></div>
          <div className="hud-metric-grid">
            <div className="hud-metric hud-metric-primary"><span>Salinity</span><strong>{view.water.salinity.toFixed(2)} ppt</strong></div>
            <div className="hud-metric"><span>Ammonia</span><strong>{view.water.ammonia.toFixed(3)} mg/L</strong></div>
            <div className="hud-metric"><span>Credits</span><strong>{view.credits}</strong></div>
            <div className="hud-metric"><span>XP</span><strong>{view.xp}</strong></div>
            <div className="hud-metric"><span>PAR</span><strong>{Math.round(view.water.par)} µmol</strong></div>
            <div className="hud-metric"><span>Residents</span><strong>{view.specimens.length}</strong></div>
          </div>
          <div className="hud-event" aria-live="polite"><span>Root state response</span>
            <strong>{view.reefSnapshot.events.lastEvent}</strong><p>{view.reefSnapshot.events.causalNote}</p></div>
        </aside>

        <aside className="hud-panel hud-ecology-panel" aria-labelledby="proof-render">
          <div className="hud-panel-heading"><div><p>Read-only physical services</p><h2 id="proof-render">Optics and flow</h2></div>
            <span className="hud-day-chip">{renderSettings.diagnosticView}</span></div>
          <div className="hud-render-choice"><span id="diagnostic-proof-label">Diagnostic view</span>
            <div role="group" aria-labelledby="diagnostic-proof-label">
              {(['beauty', 'spectral', 'flow'] as const satisfies readonly DiagnosticView[]).map((diagnosticView) => (
                <button key={diagnosticView} type="button" aria-pressed={renderSettings.diagnosticView === diagnosticView}
                  onClick={() => setRenderSettings((current) => ({ ...current, diagnosticView }))}>{diagnosticView}</button>
              ))}
            </div>
          </div>
          <dl className="hud-metric-grid">
            <div className="hud-metric"><dt>Visible transmission</dt><dd>{renderTelemetry ? `${(renderTelemetry.optics.meanVisibleTransmittance * 100).toFixed(1)}%` : 'Sampling'}</dd></div>
            <div className="hud-metric"><dt>Mean flow</dt><dd>{renderTelemetry ? `${renderTelemetry.flow.meanSpeedMetersPerSecond.toFixed(3)} m/s` : 'Sampling'}</dd></div>
          </dl>
          {(() => { const offer = view.storeOffers.find((item) => item.id === 'epaulette_shark'); return offer ? (
            <div className="hud-event"><span>Authoritative store example</span><strong>{offer.name}: {offer.allowed ? 'Eligible' : 'Locked'}</strong>
              <p>{offer.reasons.join(' ') || `${offer.price} credits`}</p></div>) : null })()}
        </aside>

        <section className="hud-control-deck" aria-label="Pocket Aquarium showcase controls">
          <div className="hud-control-primary">
            <button className="hud-button hud-button-feed" type="button"
              onClick={() => dispatch({ type: 'FEED', x: 0.5, y: 0.38 })}>✦ Feed</button>
            <button className="hud-button hud-button-ato" type="button"
              onClick={() => dispatch({ type: 'WATER_TOP_OFF' })}>Freshwater top-off</button>
            <div className="hud-speed-control" role="group" aria-label="Simulation speed"><span>Root speed</span>
              {[0, 1, 4, 8].map((speed) => <button key={speed} type="button" aria-pressed={pocketState.speed === speed}
                onClick={() => dispatch({ type: 'SET_SPEED', speed })}>{speed === 0 ? 'Pause' : `${speed}×`}</button>)}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
