import { useEffect, useMemo, useState } from 'react'

import type { DiagnosticView, ReefRenderSettings, ReefRenderTelemetry, RenderQuality } from '../contracts'
import type { PocketAction, PocketGameView, PocketPreventedDeath, PocketStoreOffer } from '../integration/pocketAquariumBridge'
import { HudWindow, useHudWorkspace, type HudPanelId } from './HudWorkspace'

export interface GodModeControls {
  readonly on: boolean
  readonly prevented: readonly PocketPreventedDeath[]
  readonly toggle: () => void
}

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
type StoreFilter = 'recommended' | 'equipment' | 'livestock' | 'coral' | 'tank'
const STORE_FILTERS = ['recommended', 'equipment', 'livestock', 'coral', 'tank'] as const satisfies readonly StoreFilter[]

interface PocketGameHUDProps {
  readonly view: PocketGameView
  readonly dispatch: (action: PocketStoreOffer['action']) => void
  readonly renderSettings: ReefRenderSettings
  readonly renderTelemetry?: ReefRenderTelemetry
  readonly onRenderSettingsChange: (settings: ReefRenderSettings) => void
  readonly godMode?: GodModeControls
}

function telemetry(value: number | undefined, digits: number, unit = '') {
  return value === undefined || !Number.isFinite(value) ? 'Sampling' : `${value.toFixed(digits)}${unit}`
}

function offerMark(offer: PocketStoreOffer): string {
  if (offer.kind === 'livestock') return 'FISH'
  if (offer.kind === 'coral') return 'CORAL'
  if (offer.kind === 'tier') return 'TANK'
  return (offer.category ?? 'GEAR').split(/\s|\//).filter(Boolean).map((word) => word[0]).join('').slice(0, 4).toUpperCase()
}

function guideCommand(type: string | undefined): { action?: PocketAction; sheet?: HudPanelId } | null {
  switch (type) {
    case 'setup-fill': return { action: { type: 'SETUP_FILL' } }
    case 'life-on': return { action: { type: 'SETUP_LIFE_SUPPORT', on: true } }
    case 'ammonia-on': return { action: { type: 'ADD_AMMONIA_SOURCE', on: true } }
    case 'inoculate': return { action: { type: 'INOCULATE_BACTERIA' } }
    case 'test': return { action: { type: 'WATER_TEST' } }
    case 'wc25': return { action: { type: 'WATER_CHANGE', fraction: 0.25 } }
    case 'topoff': return { action: { type: 'WATER_TOP_OFF' } }
    case 'feed': return { action: { type: 'FEED_AT', x: 0.5, y: 0.38 } }
    case 'open-store': return { sheet: 'store' }
    case 'open-livestock': return { sheet: 'care' }
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

export function PocketGameHUD({ view, dispatch, renderSettings, renderTelemetry, onRenderSettingsChange, godMode }: PocketGameHUDProps) {
  const workspace = useHudWorkspace()
  const [pinnedReadings, setPinnedReadings] = useState<readonly string[]>(() => {
    try { return JSON.parse(window.localStorage.getItem('pocket-aquarium-pinned-readings-v1') ?? '[]') as string[] } catch { return [] }
  })
  const hasRecommendedOffers = view.storeOffers.some((offer) => offer.recommended)
  const [storeFilter, setStoreFilter] = useState<StoreFilter>(hasRecommendedOffers ? 'recommended' : 'equipment')
  const [focusedOfferId, setFocusedOfferId] = useState<string | null>(null)
  const seeInStore = (offerId: string, group: StoreFilter) => {
    setStoreFilter(group)
    setFocusedOfferId(offerId)
    workspace.openPanel('store')
  }
  const visibleOffers = useMemo(() => view.storeOffers.filter((offer) =>
    storeFilter === 'recommended' ? offer.recommended : offer.group === storeFilter), [view.storeOffers, storeFilter])
  const { clock, tank, lightField, events } = view.reefSnapshot
  const hungryFishCount = view.specimens.filter((specimen) => specimen.kind === 'fish' && specimen.alive && specimen.hunger > .12).length
  const levelRatio = Math.min(1, Math.max(0, view.water.levelL / tank.targetWaterVolumeLiters))
  const command = guideCommand(view.guide.nextAction?.type)
  const guideLabel = typeof view.guide.nextAction?.label === 'string' ? view.guide.nextAction.label : 'Continue'
  const selectedSpecimen = view.selectedSpecimen
  const toggleReading = (key: string) => setPinnedReadings((current) => current.includes(key)
    ? current.filter((item) => item !== key) : [...current, key])
  const runGuide = () => {
    if (command?.action) dispatch(command.action)
    if (command?.sheet) workspace.openPanel(command.sheet)
  }

  useEffect(() => {
    try { window.localStorage.setItem('pocket-aquarium-pinned-readings-v1', JSON.stringify(pinnedReadings)) } catch { /* optional UI preference */ }
  }, [pinnedReadings])

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

    <div className="pocket-utility" aria-label="Tank utilities">
      <span className="pocket-credit-pill" title="Available tank credits">
        <small>Tank credits</small><strong>{godMode?.on ? '∞' : view.credits}</strong></span>
      {godMode ? <button type="button" className="pocket-god-mode" aria-pressed={godMode.on} onClick={godMode.toggle}
        title={`God mode protects residents and makes purchases free · ${godMode.prevented.length} deaths prevented`}>
        <span aria-hidden="true">●</span> GOD MODE
      </button> : null}
    </div>

    {selectedSpecimen ? <aside className="pocket-specimen-card" aria-label={`${selectedSpecimen.name} specimen`}>
      <div className="pocket-specimen-card-head">
        <div><strong>{selectedSpecimen.name}</strong>
          <small>{selectedSpecimen.scientificName}{selectedSpecimen.stage ? ` · ${selectedSpecimen.stage}` : ''}</small></div>
        <button type="button" className="pocket-card-close" aria-label="Close specimen card"
          onClick={() => dispatch({ type: 'SELECT_ENTITY', id: null })}>×</button>
      </div>
      <div className="pocket-condition-signals">{signal('Health', selectedSpecimen.health)}
        {signal('Hunger', selectedSpecimen.hunger, true)}{signal('Condition', selectedSpecimen.condition)}</div>
    </aside> : null}

    <nav className="pocket-sheet-tabs" aria-label="Aquarium panels">
      {(['guide', 'water', 'care', 'store', 'view'] as const).map((sheet) => <button key={sheet} type="button"
        aria-pressed={workspace.isOpen(sheet)} onClick={() => workspace.togglePanel(sheet)}>{sheet}</button>)}
    </nav>

    <HudWindow id="guide" title="Next step" eyebrow="Guided reef care" className="pocket-guide-window" workspace={workspace}>
      <section className="pocket-guide" aria-labelledby="pocket-guide-title">
        <div><p>Next guided step · {view.guide.stage.replaceAll('_', ' ')}</p><h2 id="pocket-guide-title">{view.guide.title}</h2></div>
        <p>{view.guide.body}</p>
        {command ? <button className="hud-button hud-button-primary" type="button" onClick={runGuide}>{guideLabel}</button> : null}
      </section>
    </HudWindow>

    <HudWindow id="water" title="Water" eyebrow="Chemistry and life support" className="hud-panel hud-water-panel" workspace={workspace}>
      <section className="pocket-nitrogen-cycle" aria-labelledby="pocket-cycle-heading">
        <div><p>Live biofilter model</p><h2 id="pocket-cycle-heading">Ammonia → nitrite → nitrate</h2></div>
        <ol>
          <li data-active={view.water.ammonia > .05 || view.cycle.ammoniaSource}>
            <span>1 · Waste fuel</span><strong>NH₃ {view.water.ammonia.toFixed(2)} mg/L</strong>
            <small>{view.cycle.ammoniaSource ? 'Measured source is feeding colony one.' : 'Add a source to begin fishless cycling.'}</small>
          </li>
          <li data-active={view.water.nitrite > .05 || view.cycle.aob > .08}>
            <span>2 · Colony one</span><strong>NO₂ {view.water.nitrite.toFixed(2)} mg/L</strong>
            <small>Ammonia oxidizers {Math.round(view.cycle.aob * 100)}% established.</small>
          </li>
          <li data-active={view.water.nitrate > 1 || view.cycle.nob > .06}>
            <span>3 · Colony two</span><strong>NO₃ {view.water.nitrate.toFixed(1)} mg/L</strong>
            <small>Nitrite oxidizers {Math.round(view.cycle.nob * 100)}% established.</small>
          </li>
        </ol>
        <small className="pocket-cycle-note">The arrows follow authoritative simulation state. Player water-test readings remain in the panel below.</small>
      </section>
      <div className="hud-panel-heading"><div><p>Last tested water</p><h2 id="pocket-water-heading">{view.habitatName}</h2></div>
        <span className="hud-status-chip" data-alert={view.testFreshness.stale}>{view.testFreshness.label}</span></div>
      <dl className="hud-metric-grid pocket-summary-grid" aria-label="Progression and tank summary">
        <div className="hud-metric"><dt>Credits</dt><dd>{view.unlimitedCredits ? '∞' : view.credits}</dd></div><div className="hud-metric"><dt>XP</dt><dd>{view.xp}</dd></div>
        <div className="hud-metric"><dt>Tier</dt><dd>{view.tierName}</dd></div><div className="hud-metric"><dt>Residents</dt><dd>{view.specimens.length}</dd></div>
        <div className="hud-metric"><dt>Still need food</dt><dd>{hungryFishCount}</dd></div>
      </dl>
      <div className="pocket-water-level"><div><span>Live fill level</span><strong>{view.water.levelL.toFixed(1)} / {tank.targetWaterVolumeLiters.toFixed(1)} L</strong></div>
        <progress max={tank.targetWaterVolumeLiters} value={view.water.levelL} aria-label="Operating water level">{Math.round(levelRatio * 100)}%</progress>
        <small>{Math.round(levelRatio * 100)}% of operating target, separate from chemistry test results.</small></div>
      <div className="pocket-test-freshness"><strong>{view.testFreshness.label}</strong><span>{view.testFreshness.readingAgeDays === null
        ? 'Run a water test to reveal current chemistry.' : `Oldest reading ${view.testFreshness.readingAgeDays.toFixed(2)} days old${view.testFreshness.testedAtDay === null ? '' : ` · tested day ${view.testFreshness.testedAtDay.toFixed(2)}`}`}</span></div>
      <dl className="hud-metric-grid pocket-water-metrics" aria-label="Last tested water parameters">
        {view.testedWater.map((item) => { const meta = READING_META[item.key] ?? [item.key, '', 2] as const; return <div className="hud-metric" key={item.key} data-known={item.known}>
          <dt>{meta[0]}<button type="button" className="pocket-metric-pin" aria-pressed={pinnedReadings.includes(item.key)}
            aria-label={`${pinnedReadings.includes(item.key) ? 'Unpin' : 'Pin'} ${meta[0]}`}
            onClick={() => toggleReading(item.key)}>{pinnedReadings.includes(item.key) ? 'Pinned' : 'Pin'}</button></dt>
          <dd>{item.known && item.value !== null ? `${item.value.toFixed(meta[2])}${meta[1]}` : 'Not tested'}</dd>
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
    </HudWindow>

    <HudWindow id="store" title="Store" eyebrow="Livestock and equipment" className="hud-panel hud-ecology-panel" workspace={workspace}>
      <section className="pocket-store" aria-labelledby="pocket-store-heading"><div className="hud-panel-heading"><div><p>Root catalog and validation</p>
        <h2 id="pocket-store-heading">Store</h2></div><span className="hud-day-chip">{visibleOffers.length} offers</span></div>
        <div className="pocket-store-filters" role="group" aria-label="Store category">
          {STORE_FILTERS.map((filter) => <button key={filter} type="button" aria-pressed={storeFilter === filter}
            disabled={filter === 'recommended' && !hasRecommendedOffers}
            onClick={() => { setStoreFilter(filter); setFocusedOfferId(null) }}>{filter}</button>)}
        </div>
        <ul className="pocket-store-list">{visibleOffers.map((offer) => {
          const focused = offer.id === focusedOfferId
          return <li className="hud-event pocket-store-offer" key={`${offer.kind}:${offer.id}`}
            data-locked={!offer.allowed} data-installed={offer.installed} data-recommended={offer.recommended} data-focused={focused}
            ref={focused ? (node) => node?.scrollIntoView({ block: 'nearest' }) : undefined}>
            <div className="pocket-store-offer-head">
              <div className="pocket-offer-visual" data-kind={offer.kind} data-category={offer.category?.toLowerCase()} aria-hidden="true">
                <i /><span>{offerMark(offer)}</span>
              </div>
              <span>{offer.category ?? offer.kind}</span><strong>{offer.name}</strong>
              <small>{offer.price} credits</small>
              {offer.recommended ? <span className="pocket-offer-tag" data-tone="rec">Recommended</span> : null}
              {offer.installed ? <span className="pocket-offer-tag" data-tone="installed">Installed</span> : null}</div>
            {offer.detail ? <p className="pocket-offer-detail">{offer.detail}</p> : null}
            {offer.problemSolved ? <dl className="pocket-offer-facts">
              <div><dt>Solves</dt><dd>{offer.problemSolved}</dd></div>
              {offer.durableEffect ? <div><dt>Effect</dt><dd>{offer.durableEffect}</dd></div> : null}
              {offer.operatingResource ? <div><dt>Upkeep</dt><dd>{offer.operatingResource}</dd></div> : null}
            </dl> : null}
            <button className="hud-button" type="button" disabled={offer.installed || !offer.allowed} onClick={() => dispatch(offer.action)}>
              {offer.installed ? 'Installed' : offer.allowed ? `Buy · ${offer.price}` : 'Locked'}</button>
            {offer.reasons.length ? <ul className="pocket-lock-reasons" aria-label={`${offer.name} lock reasons`}>
              {offer.reasons.map((reason, index) => <li key={`${index}:${reason}`}>{reason}</li>)}</ul>
              : offer.installed ? null : <p className="pocket-offer-ready">Eligible under current root rules.</p>}
          </li>
        })}
        {visibleOffers.length === 0 ? <li className="pocket-store-empty">No offers in this category yet.</li> : null}</ul>
      </section>
    </HudWindow>

    <HudWindow id="view" title="View" eyebrow="Aquarium optics" className="hud-panel pocket-view-panel" workspace={workspace}>
      <div className="hud-render-controls">
        <div className="hud-render-choice"><span id="pocket-quality-label">Quality</span><div role="group" aria-labelledby="pocket-quality-label">
          {QUALITIES.map((quality) => <button key={quality} type="button" aria-pressed={renderSettings.quality === quality}
            onClick={() => onRenderSettingsChange({ ...renderSettings, quality })}>{quality}</button>)}</div></div>
        <div className="hud-render-choice"><span id="pocket-diagnostic-label">Diagnostic</span><div role="group" aria-labelledby="pocket-diagnostic-label">
          {DIAGNOSTICS.map((diagnosticView) => <button key={diagnosticView} type="button" aria-pressed={renderSettings.diagnosticView === diagnosticView}
            onClick={() => onRenderSettingsChange({ ...renderSettings, diagnosticView })}>{diagnosticView}</button>)}</div></div>
        <label className="pa-brightness"><span>Viewing brightness <small>visual only · PAR unchanged</small></span>
          <output>{Math.round(renderSettings.brightness * 100)}%</output>
          <input type="range" min="0.75" max="1.35" step="0.05" value={renderSettings.brightness}
            onChange={(event) => onRenderSettingsChange({ ...renderSettings, brightness: Number(event.target.value) })} />
        </label>
      </div><dl className="pocket-telemetry"><div><dt>Visible transmission</dt><dd>{telemetry(renderTelemetry?.optics.meanVisibleTransmittance === undefined ? undefined : renderTelemetry.optics.meanVisibleTransmittance * 100, 1, '%')}</dd></div>
        <div><dt>Mean flow</dt><dd>{telemetry(renderTelemetry?.flow.meanSpeedMetersPerSecond, 3, ' m/s')}</dd></div></dl>
      <button className="hud-button pocket-reset-workspace" type="button" onClick={workspace.resetWorkspace}>Reset window layout</button>
    </HudWindow>

    <HudWindow id="care" title="Care" eyebrow="Actions and husbandry" className="hud-control-deck pocket-control-deck pocket-care-tray" workspace={workspace}>
      <section className="pocket-care-diagnose" aria-label="Test, diagnosis and action">
        <button className="hud-button hud-button-primary pocket-care-test" type="button"
          onClick={() => dispatch({ type: 'WATER_TEST' })}>Water test</button>
        <small className="pocket-care-freshness">{view.testFreshness.label}</small>
        <ul className="pocket-care-recs" aria-label="Current care recommendations">
          {view.careRecommendations.map((rec, index) => {
            const suggested = rec.suggestedOfferId ? view.storeOffers.find((offer) => offer.id === rec.suggestedOfferId) : undefined
            return <li key={`${index}:${rec.title}`} className="pocket-care-rec" data-severity={rec.severity}>
              <div className="pocket-care-rec-head"><span className="pocket-care-sev" data-severity={rec.severity}>{rec.severity}</span>
                <strong>{rec.title}</strong></div>
              <p>{rec.cause}</p>
              <div className="pocket-care-rec-actions">
                {rec.actionLabel && rec.action ? <button className="hud-button hud-button-primary" type="button"
                  onClick={() => dispatch(rec.action as PocketAction)}>{rec.actionLabel}</button> : null}
                {suggested ? <button className="hud-button" type="button"
                  onClick={() => seeInStore(suggested.id, suggested.group)}>See {suggested.name} in Store</button> : null}
              </div>
            </li>
          })}
        </ul>
      </section>
      {view.deadResidents.length ? <section className="pocket-care-dead" aria-label="Dead residents">
        <div className="hud-section-label"><h3>Dead residents</h3><span>{view.deadResidents.length}</span></div>
        <ul>{view.deadResidents.map((resident) => <li key={resident.id} className="pocket-dead-row">
          <div><strong>{resident.name}</strong>{resident.cause ? <small>{resident.cause}</small> : null}</div>
          <button className="hud-button hud-button-danger" type="button"
            onClick={() => dispatch({ type: 'REMOVE_DEAD', id: resident.id })}>Remove</button>
        </li>)}</ul>
      </section> : null}
      <section className="pocket-breeding" aria-labelledby="pocket-breeding-heading"><div className="hud-section-label">
        <h3 id="pocket-breeding-heading">Clutches and fry</h3><span>{view.clutches.length ? `${view.clutches.length} active` : 'No active clutch'}</span></div>
        {view.clutches.length ? <ul>{view.clutches.map((clutch) => <li key={clutch.id}><strong>{clutch.speciesId.replaceAll('_', ' ')}</strong>
          <span>{clutch.stage} · {clutch.ageDays.toFixed(1)} days</span></li>)}</ul>
          : <p>Breeding state will appear here when husbandry requirements are met.</p>}</section>
      <div className="hud-control-primary pocket-care-controls">
        <button className="hud-button hud-button-feed" type="button" onClick={() => dispatch({ type: 'FEED_AT', x: 0.5, y: 0.38 })}>✦ Feed</button>
        <button className="hud-button" type="button" onClick={() => dispatch({ type: 'WATER_CHANGE', fraction: 0.25 })}>25% water change</button>
        <button className="hud-button hud-button-ato" type="button" onClick={() => dispatch({ type: 'WATER_TOP_OFF' })}>Freshwater top-off</button>
        <button className="hud-button" type="button" onClick={() => {
          if (window.confirm('Start a new dry reef? This replaces the current aquarium save.')) {
            dispatch({ type: 'CHOOSE_HABITAT', habitat: 'reef' })
            workspace.openPanel('water')
          }
        }}>Start new dry reef</button>
      </div>
      <details className="pocket-automation-details">
        <summary>Automation</summary>
        <div className="pocket-automation" aria-label="Installed automation">
        <div className="pocket-automation-device" data-empty={view.feeder.installed && view.feeder.hopperPortions <= 0}>
          <div className="pocket-automation-head"><span>Auto feeder</span>
            <strong>{!view.feeder.installed ? 'Not installed'
              : view.feeder.enabled ? `Armed · ${view.feeder.hopperPortions}/${view.feeder.capacity}`
              : `Off · ${view.feeder.hopperPortions}/${view.feeder.capacity}`}</strong></div>
          {view.feeder.installed ? <>
            <small>Every {view.feeder.intervalDays.toFixed(2)} d · {view.feeder.portionsPerDispense} portion(s){view.feeder.hopperPortions <= 0 ? ' · hopper empty' : ''}</small>
            <div className="pocket-automation-actions">
              <button className="hud-button" type="button" aria-pressed={view.feeder.enabled}
                onClick={() => dispatch({ type: 'SET_FEEDER', enabled: !view.feeder.enabled })}>{view.feeder.enabled ? 'Disable' : 'Enable'}</button>
              <button className="hud-button" type="button" aria-label="Slower cadence"
                onClick={() => dispatch({ type: 'SET_FEEDER', intervalDays: Math.min(14, view.feeder.intervalDays + 0.5) })}>Slower</button>
              <button className="hud-button" type="button" aria-label="Faster cadence"
                onClick={() => dispatch({ type: 'SET_FEEDER', intervalDays: Math.max(0.25, view.feeder.intervalDays - 0.5) })}>Faster</button>
              <button className="hud-button" type="button"
                onClick={() => dispatch({ type: 'REFILL_FEEDER' })}>Refill hopper</button>
            </div>
          </> : <small>Buy the auto feeder in the store to schedule feeding.</small>}
        </div>
        <div className="pocket-automation-device" data-empty={view.ato.installed && view.ato.reservoirL <= 0.05}>
          <div className="pocket-automation-head"><span>ATO reservoir</span>
            <strong>{!view.ato.installed ? 'Not installed'
              : `${view.ato.reservoirL.toFixed(1)} / ${view.ato.capacityL.toFixed(0)} L`}</strong></div>
          {view.ato.installed ? <>
            <small>{view.ato.reservoirL <= 0.05 ? 'Empty — evaporation now concentrates salt.' : view.ato.topping ? 'Topping off evaporated freshwater.' : 'Holding the waterline.'}</small>
            <div className="pocket-automation-actions">
              <button className="hud-button hud-button-ato" type="button"
                onClick={() => dispatch({ type: 'REFILL_RESERVOIR' })}>Refill reservoir</button>
            </div>
          </> : <small>Install an ATO to auto-replace evaporation from a finite reservoir.</small>}
        </div>
        </div>
      </details>
      <div className="hud-speed-control pocket-speed-control" role="group" aria-label="Simulation speed"><span>Root speed</span>
        {SPEEDS.map((speed) => <button key={speed} type="button" aria-pressed={clock.speed === speed}
          aria-label={speed === 0 ? 'Pause simulation' : `Set simulation speed to ${speed} times`}
          onClick={() => dispatch({ type: 'SET_SPEED', speed })}>{speed === 0 ? 'Pause' : `${speed}×`}</button>)}</div>
    </HudWindow>

    {pinnedReadings.map((key) => {
      const item = view.testedWater.find((reading) => reading.key === key)
      if (!item) return null
      const meta = READING_META[key] ?? [key, '', 2] as const
      return <HudWindow key={key} id={`metric:${key}`} title={meta[0]} eyebrow="Pinned water reading" className="pocket-metric-window"
        workspace={workspace} onClose={() => toggleReading(key)}>
        <div className="pocket-pinned-reading" data-known={item.known}>
          <strong>{item.known && item.value !== null ? `${item.value.toFixed(meta[2])}${meta[1]}` : 'Not tested'}</strong>
          <small>{view.testFreshness.label}</small>
        </div>
      </HudWindow>
    })}
  </div>
}
