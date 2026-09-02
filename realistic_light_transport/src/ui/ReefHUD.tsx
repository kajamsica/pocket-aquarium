import type {
  DiagnosticView,
  LifecyclePhase,
  ReefHudProps,
  ReefRenderSettings,
  RenderQuality,
} from '../contracts'

const SPEEDS = [1, 12, 48] as const

const PHASE_LABELS: Readonly<Record<LifecyclePhase, string>> = {
  commissioning: 'Commissioning',
  cycling: 'Cycling',
  ugly_phase: 'Ugly phase',
  stabilizing: 'Stabilizing',
  young_reef: 'Young reef',
}

const DEFAULT_RENDER_SETTINGS: ReefRenderSettings = {
  quality: 'balanced',
  diagnosticView: 'beauty',
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value))
}

function percent(value: number) {
  return `${Math.round(clampUnit(value) * 100)}%`
}

function formatClock(hours: number) {
  const normalizedHours = ((hours % 24) + 24) % 24
  const wholeHours = Math.floor(normalizedHours)
  const minutes = Math.floor((normalizedHours - wholeHours) * 60)

  return `${wholeHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}

function conditionLabel(value: number, inverted = false) {
  const score = inverted ? 1 - clampUnit(value) : clampUnit(value)

  if (score >= 0.8) return 'Excellent'
  if (score >= 0.58) return 'Stable'
  if (score >= 0.34) return 'Watch'
  return 'At risk'
}

function telemetryValue(value: number | undefined, digits: number, unit = '') {
  return value === undefined || !Number.isFinite(value) ? 'Pending' : `${value.toFixed(digits)}${unit}`
}

interface SignalProps {
  readonly label: string
  readonly value: number
  readonly display: string
  readonly tone?: 'cyan' | 'violet' | 'amber' | 'green' | 'red'
}

function Signal({ label, value, display, tone = 'cyan' }: SignalProps) {
  const normalized = clampUnit(value)

  return (
    <div className="hud-signal" data-tone={tone}>
      <div className="hud-signal-copy">
        <span>{label}</span>
        <output>{display}</output>
      </div>
      <div
        className="hud-signal-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(normalized * 100)}
      >
        <span style={{ '--signal-level': `${normalized * 100}%` } as React.CSSProperties} />
      </div>
    </div>
  )
}

interface RangeControlProps {
  readonly id: string
  readonly label: string
  readonly value: number
  readonly onChange: (value: number) => void
}

function RangeControl({ id, label, value, onChange }: RangeControlProps) {
  const normalized = clampUnit(value)

  return (
    <label className="hud-range" htmlFor={id}>
      <span>{label}</span>
      <output htmlFor={id}>{percent(normalized)}</output>
      <input
        id={id}
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={normalized}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}

export function ReefHUD({
  snapshot,
  dispatch,
  renderSettings = DEFAULT_RENDER_SETTINGS,
  renderTelemetry,
  onRenderSettingsChange,
}: ReefHudProps) {
  const waterRatio = snapshot.tank.waterVolumeLiters / snapshot.tank.targetWaterVolumeLiters
  const waterLevelState = waterRatio >= 0.985 ? 'At target' : waterRatio >= 0.95 ? 'Evaporating' : 'Top off needed'
  const fishCount = snapshot.livestock.clownfishCount + snapshot.livestock.smallReefFishCount
  const feedingUnavailable = fishCount === 0
  const atoState = snapshot.equipment.atoEnabled
    ? snapshot.equipment.atoReservoirLiters > 0.05
      ? 'Armed'
      : 'Reservoir empty'
    : 'Manual'

  return (
    <div className="reef-hud">
      <header className="hud-topbar">
        <div className="hud-brand">
          <span className="hud-brand-mark" aria-hidden="true">
            RR
          </span>
          <div>
            <p>Marine aquarium simulator</p>
            <h1>Reef Room</h1>
          </div>
        </div>

        <div className="hud-run-state" aria-label="Simulation clock">
          <span className="hud-live-dot" data-paused={snapshot.clock.paused} aria-hidden="true" />
          <div>
            <span>{snapshot.clock.paused ? 'Simulation paused' : `${snapshot.clock.speed}× simulation`}</span>
            <strong>
              Day {snapshot.clock.day} · {formatClock(snapshot.clock.timeOfDayHours)} ·{' '}
              {PHASE_LABELS[snapshot.ecology.phase]}
            </strong>
          </div>
        </div>

        <div className="hud-namespace" title="The playable system is locked to marine reef chemistry and life">
          <span aria-hidden="true">●</span>
          <code>{snapshot.namespace}</code>
          <small>locked</small>
        </div>
      </header>

      <aside className="hud-panel hud-water-panel" aria-labelledby="water-heading">
        <div className="hud-panel-heading">
          <div>
            <p>Life support</p>
            <h2 id="water-heading">Water column</h2>
          </div>
          <span className="hud-status-chip" data-alert={waterRatio < 0.95}>
            {waterLevelState}
          </span>
        </div>

        <div className="hud-volume">
          <div>
            <span>Operating volume</span>
            <strong>{snapshot.tank.waterVolumeLiters.toFixed(1)}</strong>
            <small>liters</small>
          </div>
          <div className="hud-water-gauge" aria-hidden="true">
            <span style={{ '--water-level': `${clampUnit(waterRatio) * 100}%` } as React.CSSProperties} />
          </div>
          <dl>
            <div>
              <dt>Level</dt>
              <dd>{snapshot.tank.waterLevelMeters.toFixed(3)} m</dd>
            </div>
            <div>
              <dt>Operating target</dt>
              <dd>{snapshot.tank.targetWaterVolumeLiters.toFixed(1)} L</dd>
            </div>
            <div>
              <dt>ATO trigger</dt>
              <dd>{snapshot.equipment.atoSetpointLiters.toFixed(1)} L</dd>
            </div>
            <div>
              <dt>Evaporation</dt>
              <dd>{snapshot.tank.evaporationLitersPerDay.toFixed(2)} L/day</dd>
            </div>
          </dl>
        </div>

        <div className="hud-metric-grid" aria-label="Water chemistry">
          <div className="hud-metric hud-metric-primary">
            <span>Salt eq · S<sub>eq</sub></span>
            <strong>{snapshot.chemistry.saltEquivalentGPerKg.toFixed(2)} g/kg</strong>
            <small>salt-equivalent mass fraction</small>
          </div>
          <div className="hud-metric">
            <span>Temperature</span>
            <strong>{snapshot.chemistry.temperatureCelsius.toFixed(1)} °C</strong>
          </div>
          <div className="hud-metric">
            <span>pH</span>
            <strong>{snapshot.chemistry.ph.toFixed(2)}</strong>
          </div>
          <div className="hud-metric">
            <span aria-label="Total ammonia nitrogen, milligrams nitrogen per liter">TAN · mg N/L</span>
            <strong>{snapshot.chemistry.totalAmmoniaNitrogenMgPerLiter.toFixed(3)}</strong>
          </div>
          <div className="hud-metric">
            <span aria-label="Nitrite nitrogen, milligrams nitrogen per liter">NO₂-N · mg N/L</span>
            <strong>{snapshot.chemistry.nitriteNitrogenMgPerLiter.toFixed(3)}</strong>
          </div>
          <div className="hud-metric">
            <span aria-label="Nitrate nitrogen, milligrams nitrogen per liter">NO₃-N · mg N/L</span>
            <strong>{snapshot.chemistry.nitrateNitrogenMgPerLiter.toFixed(2)}</strong>
          </div>
          <div className="hud-metric">
            <span aria-label="Phosphate phosphorus, milligrams phosphorus per liter">PO₄-P · mg P/L</span>
            <strong>{snapshot.chemistry.phosphatePhosphorusMgPerLiter.toFixed(3)}</strong>
          </div>
        </div>

        <div className="hud-ato" data-enabled={snapshot.equipment.atoEnabled}>
          <div className="hud-ato-icon" aria-hidden="true">
            H₂O
          </div>
          <div>
            <span>Freshwater ATO · {atoState}</span>
            <strong>{snapshot.equipment.atoReservoirLiters.toFixed(1)} L remaining</strong>
            <small>Finite RO/DI reservoir</small>
          </div>
        </div>

        <div className="hud-light-reading">
          <div>
            <span>Local PPFD</span>
            <strong>{Math.round(snapshot.lightField.localPpfd)}</strong>
            <small>µmol photons m⁻² s⁻¹</small>
          </div>
          <p>
            Sampled at {snapshot.lightField.sampleDepthMeters.toFixed(2)} m depth ·{' '}
            {percent(snapshot.lightField.interfaceTransmission)} interface transmission
          </p>
        </div>
      </aside>

      <aside className="hud-panel hud-ecology-panel" aria-labelledby="ecology-heading">
        <div className="hud-panel-heading">
          <div>
            <p>Living system</p>
            <h2 id="ecology-heading">{PHASE_LABELS[snapshot.ecology.phase]}</h2>
          </div>
          <span className="hud-day-chip">{percent(snapshot.ecology.maturity)} mature</span>
        </div>

        <section className="hud-render-lab" aria-labelledby="render-lab-heading">
          <div className="hud-render-lab-heading">
            <div>
              <p>Render laboratory</p>
              <h3 id="render-lab-heading">Optics and flow views</h3>
            </div>
            <span>{renderSettings.diagnosticView} view</span>
          </div>

          <div className="hud-render-controls">
            <div className="hud-render-choice">
              <span id="render-quality-label">Quality</span>
              <div role="group" aria-labelledby="render-quality-label">
                {(['balanced', 'cinematic'] as const satisfies readonly RenderQuality[]).map((quality) => (
                  <button
                    key={quality}
                    type="button"
                    aria-pressed={renderSettings.quality === quality}
                    onClick={() => onRenderSettingsChange?.({ ...renderSettings, quality })}
                  >
                    {quality}
                  </button>
                ))}
              </div>
            </div>

            <div className="hud-render-choice">
              <span id="diagnostic-view-label">Diagnostic view</span>
              <div role="group" aria-labelledby="diagnostic-view-label">
                {(['beauty', 'spectral', 'flow'] as const satisfies readonly DiagnosticView[]).map(
                  (diagnosticView) => (
                    <button
                      key={diagnosticView}
                      type="button"
                      aria-pressed={renderSettings.diagnosticView === diagnosticView}
                      onClick={() => onRenderSettingsChange?.({ ...renderSettings, diagnosticView })}
                    >
                      {diagnosticView}
                    </button>
                  ),
                )}
              </div>
            </div>
          </div>

          <details className="hud-render-telemetry">
            <summary>
              Render telemetry
              <span>{renderTelemetry ? 'Live' : 'Awaiting integration'}</span>
            </summary>
            <dl>
              <div>
                <dt>Spectral model</dt>
                <dd>{renderTelemetry?.optics.spectralBands ?? 6} bands</dd>
              </div>
              <div>
                <dt>Render scale</dt>
                <dd>{telemetryValue(renderTelemetry?.optics.renderScale, 2, '×')}</dd>
              </div>
              <div>
                <dt>Mean visible transmission</dt>
                <dd>
                  {telemetryValue(
                    renderTelemetry ? renderTelemetry.optics.meanVisibleTransmittance * 100 : undefined,
                    1,
                    '%',
                  )}
                </dd>
              </div>
              <div>
                <dt>Chromatic spread</dt>
                <dd>{telemetryValue(renderTelemetry?.optics.chromaticSpreadPixels, 2, ' px')}</dd>
              </div>
              <div>
                <dt>Flow grid</dt>
                <dd>
                  {renderTelemetry ? `${renderTelemetry.flow.columns} × ${renderTelemetry.flow.rows}` : 'Pending'}
                </dd>
              </div>
              <div>
                <dt>Mean / peak speed</dt>
                <dd>
                  {renderTelemetry
                    ? `${renderTelemetry.flow.meanSpeedMetersPerSecond.toFixed(3)} / ${renderTelemetry.flow.peakSpeedMetersPerSecond.toFixed(3)} m/s`
                    : 'Pending'}
                </dd>
              </div>
              <div>
                <dt>Mean shear</dt>
                <dd>{telemetryValue(renderTelemetry?.flow.meanShearPerSecond, 3, ' s⁻¹')}</dd>
              </div>
              <div>
                <dt>Low-flow area</dt>
                <dd>
                  {telemetryValue(
                    renderTelemetry ? renderTelemetry.flow.lowFlowFraction * 100 : undefined,
                    1,
                    '%',
                  )}
                </dd>
              </div>
              <div>
                <dt>Maximum divergence</dt>
                <dd>
                  {renderTelemetry
                    ? renderTelemetry.flow.maximumDivergence.toExponential(2)
                    : 'Pending'}
                </dd>
              </div>
              <div>
                <dt>Pressure residual</dt>
                <dd>
                  {renderTelemetry ? renderTelemetry.flow.pressureResidual.toExponential(2) : 'Pending'}
                </dd>
              </div>
            </dl>
          </details>
        </section>

        <section className="hud-organism-group" aria-labelledby="fish-heading">
          <div className="hud-section-label">
            <h3 id="fish-heading">Fish</h3>
            <span>
              {snapshot.livestock.clownfishCount} clownfish · {snapshot.livestock.smallReefFishCount} reef fish
            </span>
          </div>
          <Signal
            label="Satiation"
            value={snapshot.livestock.fishSatiation}
            display={conditionLabel(snapshot.livestock.fishSatiation)}
            tone="amber"
          />
          <Signal
            label="Stress"
            value={snapshot.livestock.fishStress}
            display={conditionLabel(snapshot.livestock.fishStress, true)}
            tone="red"
          />
        </section>

        <section className="hud-organism-group" aria-labelledby="coral-heading">
          <div className="hud-section-label">
            <h3 id="coral-heading">Coral colony</h3>
            <span>Light, flow, maturity and water quality linked</span>
          </div>
          <Signal
            label="Colony health"
            value={snapshot.livestock.coralHealth}
            display={percent(snapshot.livestock.coralHealth)}
            tone="violet"
          />
          <Signal
            label="Polyp extension"
            value={snapshot.ecology.polypExtension}
            display={percent(snapshot.ecology.polypExtension)}
            tone="violet"
          />
        </section>

        <section className="hud-organism-group" aria-labelledby="succession-heading">
          <div className="hud-section-label">
            <h3 id="succession-heading">Succession cues</h3>
            <span>Coverage is contingent, not a fixed calendar</span>
          </div>
          <Signal
            label="Microfauna"
            value={snapshot.ecology.microfaunaActivity}
            display={percent(snapshot.ecology.microfaunaActivity)}
            tone="green"
          />
          <Signal
            label="Diatom film"
            value={snapshot.ecology.diatomCoverage}
            display={percent(snapshot.ecology.diatomCoverage)}
            tone="amber"
          />
          <Signal
            label="Green algae"
            value={snapshot.ecology.greenAlgaeCoverage}
            display={percent(snapshot.ecology.greenAlgaeCoverage)}
            tone="green"
          />
          <Signal
            label="Cyanobacteria"
            value={snapshot.ecology.cyanobacteriaCoverage}
            display={percent(snapshot.ecology.cyanobacteriaCoverage)}
            tone="red"
          />
        </section>

        <div className="hud-event" aria-live="polite" aria-atomic="true">
          <span>Latest event · #{snapshot.events.sequence}</span>
          <strong>{snapshot.events.lastEvent}</strong>
          <p>{snapshot.events.causalNote}</p>
        </div>

        <details className="hud-disclosure">
          <summary>Model truth boundaries</summary>
          <p>
            Optics: one-bounce real-time spectral approximation, not full/offline path tracing.
          </p>
          <p>
            Local PPFD depends on depth, spectrum, interface transmission and shading. It is a sampled light
            field, not a universal coral target.
          </p>
          <p>
            Flow: reduced-order 2D incompressible solver, not full 3D CFD.
          </p>
        </details>
      </aside>

      <section className="hud-control-deck" aria-label="Aquarium controls">
        <div className="hud-control-primary">
          <button
            className="hud-button hud-button-primary"
            type="button"
            aria-pressed={snapshot.clock.paused}
            onClick={() => dispatch({ type: 'toggle_pause' })}
          >
            <span aria-hidden="true">{snapshot.clock.paused ? '▶' : 'Ⅱ'}</span>
            {snapshot.clock.paused ? 'Resume' : 'Pause'}
          </button>
          <button
            className="hud-button hud-button-feed"
            type="button"
            disabled={feedingUnavailable}
            aria-label={
              feedingUnavailable
                ? 'Feeding unavailable. Stocking is unavailable during fishless commissioning, cycling, and ugly phase previews.'
                : 'Feed fish 0.4 grams'
            }
            title={
              feedingUnavailable
                ? 'Stocking is unavailable during fishless commissioning, cycling, and ugly phase previews.'
                : undefined
            }
            onClick={() => dispatch({ type: 'feed', amountGrams: 0.4 })}
          >
            <span aria-hidden="true">✦</span>
            {feedingUnavailable ? 'Fishless phase' : 'Feed 0.4 g'}
          </button>
          <div className="hud-speed-control" role="group" aria-label="Simulation speed">
            <span>Speed</span>
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                aria-label={`Set simulation speed to ${speed} times`}
                aria-pressed={snapshot.clock.speed === speed}
                onClick={() => dispatch({ type: 'set_speed', speed })}
              >
                {speed}×
              </button>
            ))}
          </div>
        </div>

        <div className="hud-control-tuning">
          <RangeControl
            id="reef-light-power"
            label="Reef light"
            value={snapshot.equipment.lightPower}
            onChange={(power) => dispatch({ type: 'set_light', power })}
          />
          <RangeControl
            id="reef-flow-power"
            label="Local circulation proxy"
            value={snapshot.equipment.flowPower}
            onChange={(power) => dispatch({ type: 'set_flow', power })}
          />
        </div>

        <div className="hud-control-secondary">
          <button
            className="hud-button hud-button-ato"
            type="button"
            aria-pressed={snapshot.equipment.atoEnabled}
            onClick={() => dispatch({ type: 'toggle_ato' })}
          >
            <span className="hud-button-led" aria-hidden="true" />
            ATO {snapshot.equipment.atoEnabled ? 'on' : 'off'}
          </button>
          <button className="hud-button" type="button" onClick={() => dispatch({ type: 'refill_ato' })}>
            Refill ATO
          </button>
          <label className="hud-phase-select" htmlFor="reef-phase-preview">
            <span>Phase preview</span>
            <select
              id="reef-phase-preview"
              value={snapshot.ecology.phase}
              onChange={(event) =>
                dispatch({ type: 'set_phase_preview', phase: event.currentTarget.value as LifecyclePhase })
              }
            >
              {(Object.keys(PHASE_LABELS) as LifecyclePhase[]).map((phase) => (
                <option key={phase} value={phase}>
                  {PHASE_LABELS[phase]}
                </option>
              ))}
            </select>
          </label>
          <button className="hud-button hud-button-reset" type="button" onClick={() => dispatch({ type: 'reset' })}>
            Reset
          </button>
        </div>
      </section>
    </div>
  )
}
