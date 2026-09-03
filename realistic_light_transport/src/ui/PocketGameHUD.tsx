import { useState } from 'react'

import type { DiagnosticView, ReefRenderSettings, ReefRenderTelemetry, RenderQuality } from '../contracts'
import type { PocketAction, PocketGameView, PocketStoreOffer } from '../integration/pocketAquariumBridge'

const SPEEDS = [0, 1, 4, 8] as const
const QUALITIES = ['balanced', 'cinematic'] as const satisfies readonly RenderQuality[]
const DIAGNOSTICS = ['beauty', 'spectral', 'flow'] as const satisfies readonly DiagnosticView[]
const READING_META: Readonly<Record<string, readonly [string, string, number]>> = {
  level: ['Water level', '%', 0], tempC: ['Temperature', ' °C', 1], pH: ['pH', '', 2],
  ammonia: ['Ammonia', ' mg/L', 3], nitrite: ['Nitrite', ' mg/L', 3], nitrate: ['Nitrate', ' mg/L', 2],
  oxygen: ['Oxygen', ' mg/L', 2], salinity: ['Salinity', ' ppt', 2], alkalinity: ['Alkalinity', ' dKH', 2],
  calcium: ['Calcium', ' mg/L', 0], magnesium: ['Magnesium', ' mg/L', 0], phosphate: ['Phosphate', ' mg/L', 3],
  par: ['PAR', ' µmol', 0], flow: ['Flow', ' idx', 2], hardness: ['Hardness', ' dGH', 1], tannin: ['Tannin', ' idx', 2],
}
type MobileSheet = 'water' | 'store' | 'care'

interface PocketGameHUDProps {
  readonly view: PocketGameView
  readonly dispatch: (action: PocketStoreOffer['action']) => void
  readonly renderSettings: ReefRenderSettings
  readonly renderTelemetry?: ReefRenderTelemetry
  readonly onRenderSettingsChange: (settings: ReefRenderSettings) => void
}

function telemetry(value: number | undefined, digits: number, unit = '') {
  return value === undefined || !Number.isFinite(value) ? 'Sampling' : `${value.toFixed(digits)}${unit}`
}

function guideCommand(type: string | undefined): { action?: PocketAction; sheet?: MobileSheet } | null {
  switch (type) {
    case 'setup-fill': return { action: { type: 'SETUP_FILL' } }
    case 'life-on': return { action: { type: 'SETUP_LIFE_SUPPORT', on: true } }
    case 'ammonia-on': return { action: { type: 'ADD_AMMONIA_SOURCE', on: true } }
    case 'inoculate': return { action: { type: 'INOCULATE_BACTERIA' } }
    case 'test': return { action: { type: 'WATER_TEST' } }
    case 'wc25': return { action: { type: 'WATER_CHANGE', fraction: 0.25 } }
    case 'topoff': return { action: { type: 'WATER_TOP_OFF' } }
    case 'feed': return { action: { type: 'FEED_AT', x: 0.5, y: 0.38 } }
    case 'open-store': case 'open-livestock': return { sheet: 'store' }
    case 'open-water': return { sheet: 'water' }
    default: return null
  }
}

function signal(label: string, value: number, inverted = false) {
  const normalized = Math.min(1, Math.max(0, value))
  const score = inverted ? 1 - normalized : normalized
  const status = score >= 0.8 ? 'Excellent' : score >= 0.58 ? 'Stable' : score >= 0.34 ? 'Watch' : 'At risk'
  return <div className="hud-signal" data-tone={score < 0.34 ? 'red' : score < 0.58 ? 'amber' : 'green'}>
    <div className="hud-signal-copy"><span>{label}</span><output>{Math.round(normalized * 100)}% · {status}</output></div>
    <div className="hud-signal-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(normalized * 100)}><span style={{ '--signal-level': `${normalized * 100}%` } as React.CSSProperties} /></div>
  </div>
}

export function PocketGameHUD({ view, dispatch, renderSettings, renderTelemetry, onRenderSettingsChange }: PocketGameHUDProps) {
  const [mobileSheet, setMobileSheet] = useState<MobileSheet | null>('water')
  const { clock, tank, lightField, events } = view.reefSnapshot
  const levelRatio = Math.min(1, Math.max(0, view.water.levelL / tank.targetWaterVolumeLiters))
  const command = guideCommand(view.guide.nextAction?.type)
  const guideLabel = typeof view.guide.nextAction?.label === 'string' ? view.guide.nextAction.label : 'Continue'
  const selectedSpecimen = view.selection?.entityType === 'livestock'
    ? view.specimens.find((item) => item.id === view.selection?.id) : undefined
  const selectedOffer = selectedSpecimen
    ? view.storeOffers.find((offer) => offer.kind === 'livestock' && offer.id === selectedSpecimen.speciesId)
    : view.storeOffers.find((offer) => offer.kind === 'coral' && offer.name === view.selection?.title)
  const selectSheet = (sheet: MobileSheet) => setMobileSheet((current) => current === sheet ? null : sheet)
  const runGuide = () => {
    if (command?.action) dispatch(command.action)
    if (command?.sheet) setMobileSheet(command.sheet)
  }

  return <div className="reef-hud pocket-game-hud">
    <header className="hud-topbar">
      <div className="hud-brand"><span className="hud-brand-mark" aria-hidden="true">PA</span><div>
        <p>Guided reef care</p><h1>Pocket Reef Lab</h1>
      </div></div>
      <div className="hud-run-state" aria-label="Authoritative game status">
        <span className="hud-live-dot" data-paused={clock.paused} aria-hidden="true" /><div>
          <span>{clock.paused ? 'Root simulation paused' : `Root simulation ${clock.speed}×`}</span>
          <strong>Day {clock.day} · {view.cycleStage}</strong>
        </div>
      </div>
      <div className="hud-namespace" title="Root PA is the gameplay authority"><span aria-hidden="true">●</span>
        <code>{view.reefSnapshot.namespace}</code><small>root state</small></div>
    </header>

    <nav className="pocket-sheet-tabs" aria-label="Aquarium panels">
      {(['water', 'store', 'care'] as const).map((sheet) => <button key={sheet} type="button"
        aria-pressed={mobileSheet === sheet} onClick={() => selectSheet(sheet)}>{sheet}</button>)}
    </nav>

    <aside className="hud-panel hud-water-panel" data-mobile-open={mobileSheet === 'water'} aria-labelledby="pocket-water-heading">
      <section className="pocket-guide" aria-labelledby="pocket-guide-title">
        <div><p>Next guided step · {view.guide.stage.replaceAll('_', ' ')}</p><h2 id="pocket-guide-title">{view.guide.title}</h2></div>
        <p>{view.guide.body}</p>
        {command ? <button className="hud-button hud-button-primary" type="button" onClick={runGuide}>{guideLabel}</button> : null}
      </section>
      <div className="hud-panel-heading"><div><p>Last tested water</p><h2 id="pocket-water-heading">{view.habitatName}</h2></div>
        <span className="hud-status-chip" data-alert={view.testFreshness.stale}>{view.testFreshness.label}</span></div>
      <dl className="hud-metric-grid pocket-summary-grid" aria-label="Progression and tank summary">
        <div className="hud-metric"><dt>Credits</dt><dd>{view.credits}</dd></div><div className="hud-metric"><dt>XP</dt><dd>{view.xp}</dd></div>
        <div className="hud-metric"><dt>Tier</dt><dd>{view.tierName}</dd></div><div className="hud-metric"><dt>Residents</dt><dd>{view.specimens.length}</dd></div>
      </dl>
      <div className="pocket-water-level"><div><span>Live fill level</span><strong>{view.water.levelL.toFixed(1)} / {tank.targetWaterVolumeLiters.toFixed(1)} L</strong></div>
        <progress max={tank.targetWaterVolumeLiters} value={view.water.levelL} aria-label="Operating water level">{Math.round(levelRatio * 100)}%</progress>
        <small>{Math.round(levelRatio * 100)}% of operating target, separate from chemistry test results.</small></div>
      <div className="pocket-test-freshness"><strong>{view.testFreshness.label}</strong><span>{view.testFreshness.readingAgeDays === null
        ? 'Run a water test to reveal current chemistry.' : `Oldest reading ${view.testFreshness.readingAgeDays.toFixed(2)} days old${view.testFreshness.testedAtDay === null ? '' : ` · tested day ${view.testFreshness.testedAtDay.toFixed(2)}`}`}</span></div>
      <dl className="hud-metric-grid pocket-water-metrics" aria-label="Last tested water parameters">
        {view.testedWater.map((item) => { const meta = READING_META[item.key] ?? [item.key, '', 2] as const; return <div className="hud-metric" key={item.key} data-known={item.known}>
          <dt>{meta[0]}</dt><dd>{item.known && item.value !== null ? `${item.value.toFixed(meta[2])}${meta[1]}` : 'Not tested'}</dd>
        </div> })}
      </dl>
      <div className="hud-ato" data-enabled={view.reefSnapshot.equipment.atoEnabled}><div className="hud-ato-icon" aria-hidden="true">H₂O</div><div>
        <span>Freshwater auto top-off</span><strong>{view.reefSnapshot.equipment.atoEnabled ? 'Installed and active' : 'Manual top-off'}</strong>
        <small>{view.reefSnapshot.equipment.atoEnabled ? 'Replaces evaporated water without adding salt.' : 'Install an ATO in the store or top off manually.'}</small>
      </div></div>
      <div className="hud-light-reading"><div><span>Local PPFD</span><strong>{Math.round(lightField.localPpfd)}</strong><small>µmol photons m⁻² s⁻¹</small></div>
        <p>Read-only RLT physical sample at {lightField.sampleDepthMeters.toFixed(2)} m. It is not a water-test result.</p></div>
      <div className="hud-event" aria-live="polite" aria-atomic="true"><span>Latest root event · #{events.sequence}</span>
        <strong>{events.lastEvent}</strong><p>{events.causalNote}</p></div>
    </aside>

    <aside className="hud-panel hud-ecology-panel" data-mobile-open={mobileSheet === 'store'} aria-labelledby="pocket-store-heading">
      <section className="pocket-inspector" aria-labelledby="pocket-inspector-heading">
        <div className="hud-panel-heading"><div><p>Root organism projection</p><h2 id="pocket-inspector-heading">{view.selection?.title ?? 'Select a resident'}</h2></div>
          <span className="hud-day-chip">{view.selection?.entityType ?? 'inspection'}</span></div>
        {view.selection ? <div className="pocket-inspector-body">
          {selectedSpecimen ? <div className="pocket-condition-signals">{signal('Health', selectedSpecimen.health)}
            {signal('Hunger', selectedSpecimen.hunger, true)}{signal('Condition', selectedSpecimen.condition)}</div> : null}
          <ul className="pocket-facts">{view.selection.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
          <div className="pocket-compatibility"><strong>Compatibility and stocking rules</strong>
            {selectedOffer ? selectedOffer.reasons.length ? <ul>{selectedOffer.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              : <p>Compatible with the current tank under projected root rules.</p>
              : <p>No compatibility decision is projected for this selection.</p>}</div>
        </div> : <p className="pocket-empty-state">Click a fish or coral in the aquarium to inspect its authoritative condition.</p>}
      </section>
      <section className="pocket-breeding" aria-labelledby="pocket-breeding-heading"><div className="hud-section-label">
        <h3 id="pocket-breeding-heading">Clutches and fry</h3><span>{view.clutches.length ? `${view.clutches.length} active` : 'No active clutch'}</span></div>
        {view.clutches.length ? <ul>{view.clutches.map((clutch) => <li key={clutch.id}><strong>{clutch.speciesId.replaceAll('_', ' ')}</strong>
          <span>{clutch.stage} · {clutch.ageDays.toFixed(1)} days</span></li>)}</ul>
          : <p>Breeding state will appear here when root husbandry requirements are met.</p>}</section>
      <section className="pocket-store" aria-labelledby="pocket-store-heading"><div className="hud-panel-heading"><div><p>Root catalog and validation</p>
        <h2 id="pocket-store-heading">Store</h2></div><span className="hud-day-chip">{view.storeOffers.length} offers</span></div>
        <ul className="pocket-store-list">{view.storeOffers.map((offer) => <li className="hud-event pocket-store-offer" key={`${offer.kind}:${offer.id}`} data-locked={!offer.allowed}>
          <div><span>{offer.kind}</span><strong>{offer.name}</strong><small>{offer.price} credits</small></div>
          <button className="hud-button" type="button" disabled={!offer.allowed} onClick={() => dispatch(offer.action)}>{offer.allowed ? 'Purchase' : 'Locked'}</button>
          {offer.reasons.length ? <ul className="pocket-lock-reasons" aria-label={`${offer.name} lock reasons`}>
            {offer.reasons.map((reason, index) => <li key={`${index}:${reason}`}>{reason}</li>)}</ul>
            : <p className="pocket-offer-ready">Eligible under current root rules.</p>}
        </li>)}</ul>
      </section>
      <details className="hud-render-lab"><summary>Optics and flow display</summary><div className="hud-render-controls">
        <div className="hud-render-choice"><span id="pocket-quality-label">Quality</span><div role="group" aria-labelledby="pocket-quality-label">
          {QUALITIES.map((quality) => <button key={quality} type="button" aria-pressed={renderSettings.quality === quality}
            onClick={() => onRenderSettingsChange({ ...renderSettings, quality })}>{quality}</button>)}</div></div>
        <div className="hud-render-choice"><span id="pocket-diagnostic-label">Diagnostic</span><div role="group" aria-labelledby="pocket-diagnostic-label">
          {DIAGNOSTICS.map((diagnosticView) => <button key={diagnosticView} type="button" aria-pressed={renderSettings.diagnosticView === diagnosticView}
            onClick={() => onRenderSettingsChange({ ...renderSettings, diagnosticView })}>{diagnosticView}</button>)}</div></div>
      </div><dl className="pocket-telemetry"><div><dt>Visible transmission</dt><dd>{telemetry(renderTelemetry?.optics.meanVisibleTransmittance === undefined ? undefined : renderTelemetry.optics.meanVisibleTransmittance * 100, 1, '%')}</dd></div>
        <div><dt>Mean flow</dt><dd>{telemetry(renderTelemetry?.flow.meanSpeedMetersPerSecond, 3, ' m/s')}</dd></div></dl></details>
    </aside>

    <section className="hud-control-deck pocket-control-deck" data-mobile-open={mobileSheet === 'care'} aria-label="Pocket Aquarium care controls">
      <div className="hud-control-primary pocket-care-controls">
        <button className="hud-button hud-button-feed" type="button" onClick={() => dispatch({ type: 'FEED_AT', x: 0.5, y: 0.38 })}>✦ Feed</button>
        <button className="hud-button" type="button" onClick={() => dispatch({ type: 'WATER_TEST' })}>Water test</button>
        <button className="hud-button" type="button" onClick={() => dispatch({ type: 'WATER_CHANGE', fraction: 0.25 })}>25% water change</button>
        <button className="hud-button hud-button-ato" type="button" onClick={() => dispatch({ type: 'WATER_TOP_OFF' })}>Freshwater top-off</button>
      </div>
      <div className="hud-speed-control pocket-speed-control" role="group" aria-label="Simulation speed"><span>Root speed</span>
        {SPEEDS.map((speed) => <button key={speed} type="button" aria-pressed={clock.speed === speed}
          aria-label={speed === 0 ? 'Pause simulation' : `Set simulation speed to ${speed} times`}
          onClick={() => dispatch({ type: 'SET_SPEED', speed })}>{speed === 0 ? 'Pause' : `${speed}×`}</button>)}</div>
    </section>
  </div>
}
