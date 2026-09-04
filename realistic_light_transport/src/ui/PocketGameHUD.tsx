import { useEffect, useMemo, useRef, useState } from 'react'

import type { DiagnosticView, ReefRenderSettings, ReefRenderTelemetry, RenderQuality } from '../contracts'
import { residentNameMaxLength } from '../integration/pocketAquariumBridge'
import type { PocketAction, PocketGameView, PocketPreventedDeath, PocketStoreOffer } from '../integration/pocketAquariumBridge'
import { REEF_CAMERA_RESET_EVENT } from '../scene/ReefScene'
import type { AcceptedShowcaseCatalog, SpecimenHover } from '../scene/SpecimenFish'
import { HudWindow, useHudWorkspace, type HudDeviceProfile, type HudPanelId } from './HudWorkspace'

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
const STORE_FILTER_META: Readonly<Record<StoreFilter, readonly [string, string]>> = {
  recommended: ['For you', '✦'], equipment: ['Equipment', '⚙'], livestock: ['Fish', '◁'], coral: ['Coral', '⌁'], tank: ['Aquariums', '□'],
}
/* The readings the reef-first phone preset rails up the edge, in rail order. */
const REEF_FIRST_READINGS = ['tempC', 'pH', 'ammonia'] as const
const PINNED_READINGS_KEY = 'pocket-aquarium-pinned-readings-v2'
const PINNED_READINGS_LEGACY_KEY = 'pocket-aquarium-pinned-readings-v1'
type PinnedReadings = Readonly<Record<HudDeviceProfile, readonly string[]>>
const PANEL_TABS = [
  ['guide', 'Guide'], ['water', 'Water'], ['care', 'Care'], ['residents', 'Residents'], ['store', 'Store'], ['progress', 'Rank'], ['view', 'View'],
] as const satisfies readonly (readonly [HudPanelId, string])[]

interface PocketGameHUDProps {
  readonly view: PocketGameView
  readonly dispatch: (action: PocketStoreOffer['action']) => void
  readonly renderSettings: ReefRenderSettings
  readonly renderTelemetry?: ReefRenderTelemetry
  readonly onRenderSettingsChange: (settings: ReefRenderSettings) => void
  readonly godMode?: GodModeControls
  readonly showcaseCatalog?: AcceptedShowcaseCatalog
  readonly hoveredSpecimen?: SpecimenHover | null
}

/* Which readings are pinned is a per-profile preference like window geometry: the phone rail
 * and the laptop board hold different sets, so the reef-first preset can restock the rail
 * without disturbing a laptop selection. A v1 record predates that split and is a flat array,
 * so it seeds both profiles rather than being discarded. */
function readPinnedReadings(): PinnedReadings {
  const keys = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
  try {
    const stored = window.localStorage.getItem(PINNED_READINGS_KEY)
    if (stored !== null) {
      const parsed = JSON.parse(stored) as Partial<Record<HudDeviceProfile, unknown>> | null
      return { compact: keys(parsed?.compact), wide: keys(parsed?.wide) }
    }
    const legacy = keys(JSON.parse(window.localStorage.getItem(PINNED_READINGS_LEGACY_KEY) ?? '[]'))
    return { compact: legacy, wide: legacy }
  } catch { /* A corrupt UI preference should never block the aquarium. */ }
  return { compact: [], wide: [] }
}

function telemetry(value: number | undefined, digits: number, unit = '') {
  return value === undefined || !Number.isFinite(value) ? 'Sampling' : `${value.toFixed(digits)}${unit}`
}

function merchandisedOffers(offers: readonly PocketStoreOffer[], filter: StoreFilter): PocketStoreOffer[] {
  if (filter === 'recommended') return offers.filter((offer) => offer.recommended)
  const inGroup = offers.filter((offer) => offer.group === filter)
  if (filter === 'tank') return inGroup.filter((offer) => offer.levelIndex === (offer.installedLevelIndex ?? -1) + 1)
  if (filter !== 'equipment') return inGroup

  const categories = new Map<string, PocketStoreOffer[]>()
  inGroup.forEach((offer) => {
    const key = offer.categoryId ?? offer.category ?? offer.id
    categories.set(key, [...(categories.get(key) ?? []), offer])
  })
  return Array.from(categories.values()).map((categoryOffers) => {
    const ordered = [...categoryOffers].sort((a, b) => (a.levelIndex ?? 0) - (b.levelIndex ?? 0))
    const installed = ordered.find((offer) => offer.installed)
    return ordered.find((offer) => offer.levelIndex === (offer.installedLevelIndex ?? -1) + 1) ?? installed ?? ordered[0]
  }).filter((offer): offer is PocketStoreOffer => Boolean(offer))
}

/* What a compatibility decision costs, read straight off the root's structured conflicts: the
 * exact living residents involved (deduplicated, because one animal must never be sold twice in
 * one action), how to name them, and the aggregate sell-back the root would actually pay. */
function conflictDecision(conflicts: NonNullable<PocketStoreOffer['conflicts']>) {
  return {
    residentIds: [...new Set(conflicts.flatMap((item) => item.residentIds))],
    residents: conflicts.map((item) => `${item.residentIds.length} × ${item.residentName}`).join(', '),
    refund: conflicts.reduce((total, item) => total + item.refundCredits, 0),
  }
}

function StoreArtwork({ offer }: { readonly offer: PocketStoreOffer }) {
  const key = offer.kind === 'equipment' ? offer.categoryId : offer.kind
  let drawing: React.ReactNode
  switch (key) {
    case 'heater': drawing = <><path d="M18 8v27a9 9 0 1 0 12 0V8" /><path d="M24 14v25" /><circle cx="24" cy="40" r="3" /></>; break
    case 'circulation': drawing = <><circle cx="24" cy="24" r="15" /><circle cx="24" cy="24" r="3" /><path d="M24 21c-2-9 3-12 7-10 3 2 1 8-7 10ZM27 24c9-2 12 3 10 7-2 3-8 1-10-7ZM24 27c2 9-3 12-7 10-3-2-1-8 7-10Z" /></>; break
    case 'light': drawing = <><path d="M8 16h32v7H8zM12 28l-4 10m14-10-2 10m16-10 4 10" /><circle cx="15" cy="19.5" r="1" /><circle cx="24" cy="19.5" r="1" /><circle cx="33" cy="19.5" r="1" /></>; break
    case 'skimmer': drawing = <><path d="M16 9h16l-2 8v21c0 3-2 5-6 5s-6-2-6-5V17Z" /><path d="M15 17h18M20 29c4-5 8-5 12 0" /><circle cx="23" cy="23" r="1" /><circle cx="28" cy="20" r="1" /></>; break
    case 'refugium': drawing = <><path d="M8 12h32v28H8zM8 32h32" /><path d="M19 32c-1-8 2-13 7-16m-7 9-5-5m6 1 7-4m1 15c0-6 3-9 7-11" /></>; break
    case 'ato': drawing = <><path d="M13 9h22v34H13zM17 14h14" /><path d="M24 19c5 7 7 10 7 14a7 7 0 0 1-14 0c0-4 2-7 7-14Z" /></>; break
    case 'feeder': drawing = <><path d="M13 8h22l-3 20H16Z" /><path d="M20 28h8v6h-8zM24 34v7" /><circle cx="18" cy="42" r="1" /><circle cx="24" cy="44" r="1" /><circle cx="30" cy="41" r="1" /></>; break
    case 'filter': drawing = <><rect x="12" y="7" width="24" height="36" rx="3" /><path d="M17 14h14M17 20h14M17 26h14M17 35c5-5 9-5 14 0" /></>; break
    case 'coral': drawing = <><path d="M24 42V17m0 9-9-9m9 15 10-11m-10 4 7-12m-16 29h20" /><circle cx="15" cy="17" r="3" /><circle cx="31" cy="13" r="3" /><circle cx="34" cy="21" r="3" /></>; break
    case 'tier': drawing = <><path d="M5 10h38v31H5zM8 14h32v22H8z" /><path d="M9 30c7-5 13 4 20-1s8 2 11 0" /><circle cx="17" cy="23" r="3" /></>; break
    default: drawing = <><path d="M8 25c7-11 20-13 29-4l6-5-1 13-7-4C25 34 14 32 8 25Z" /><circle cx="31" cy="21" r="1.5" /><path d="M17 29l-4 7" /></>
  }
  return <div className="pocket-offer-visual" data-kind={offer.kind} data-category={offer.categoryId} aria-hidden="true">
    {offer.acceptedPreviewUrl
      ? <img src={offer.acceptedPreviewUrl} alt={offer.acceptedName ?? offer.name} loading="lazy" decoding="async" />
      : <svg viewBox="0 0 48 48" role="presentation">{drawing}</svg>}
    <span>{offer.category ?? (offer.kind === 'tier' ? 'Aquarium' : offer.kind)}</span>
  </div>
}

function guideCommand(type: string | undefined): { action?: PocketAction; sheet?: HudPanelId } | null {
  switch (type) {
    case 'setup-fill': return { action: { type: 'SETUP_FILL' } }
    case 'life-on': return { action: { type: 'SETUP_LIFE_SUPPORT', on: true } }
    case 'ammonia-on': return { action: { type: 'ADD_AMMONIA_SOURCE', on: true } }
    case 'inoculate': return { action: { type: 'INOCULATE_BACTERIA' } }
    case 'test': return { action: { type: 'WATER_TEST' } }
    case 'wc25': return { action: { type: 'WATER_CHANGE', fraction: 0.25 } }
    case 'speed4': return { action: { type: 'SET_SPEED', speed: 4 } }
    case 'topoff': return { action: { type: 'WATER_TOP_OFF' } }
    case 'feed': return { action: { type: 'FEED_AT', x: 0.5, y: 0.38 } }
    case 'open-store': return { sheet: 'store' }
    case 'open-livestock': return { sheet: 'residents' }
    case 'open-water': return { sheet: 'water' }
    default: return null
  }
}

/* Welfare reads high-is-good; hunger is inverted so a starving fish still shows red. */
function tone(value: number, inverted = false) {
  const score = inverted ? 1 - Math.min(1, Math.max(0, value)) : Math.min(1, Math.max(0, value))
  return score < 0.34 ? 'red' : score < 0.58 ? 'amber' : 'green'
}

function signal(label: string, value: number, inverted = false) {
  const normalized = Math.min(1, Math.max(0, value))
  const score = inverted ? 1 - normalized : normalized
  const status = score >= 0.8 ? 'Excellent' : score >= 0.58 ? 'Stable' : score >= 0.34 ? 'Watch' : 'At risk'
  return <div className="hud-signal" data-tone={tone(value, inverted)}>
    <div className="hud-signal-copy"><span>{label}</span><output>{Math.round(normalized * 100)}% · {status}</output></div>
    <div className="hud-signal-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(normalized * 100)}><span style={{ '--signal-level': `${normalized * 100}%` } as React.CSSProperties} /></div>
  </div>
}

export function PocketGameHUD({ view, dispatch, renderSettings, renderTelemetry, onRenderSettingsChange, godMode, showcaseCatalog, hoveredSpecimen }: PocketGameHUDProps) {
  const workspace = useHudWorkspace()
  const [launcherCollapsed, setLauncherCollapsed] = useState(false)
  const [pinnedByProfile, setPinnedByProfile] = useState<PinnedReadings>(readPinnedReadings)
  const pinnedReadings = pinnedByProfile[workspace.profile]
  const hasRecommendedOffers = view.storeOffers.some((offer) => offer.recommended)
  const [storeFilter, setStoreFilter] = useState<StoreFilter>(hasRecommendedOffers ? 'recommended' : 'equipment')
  const [focusedOfferId, setFocusedOfferId] = useState<string | null>(null)
  /* The one offer whose compatibility decision is open, and the one inline rename currently being
   * drafted. Both are transient UI intent: neither exists in the authoritative save. */
  const [decidingOfferId, setDecidingOfferId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState<{
    readonly residentId: number
    readonly surface: 'selected' | 'roster'
    readonly value: string
  } | null>(null)
  const rosterSelectionTimer = useRef<number | null>(null)
  const seeInStore = (offerId: string, group: StoreFilter) => {
    setStoreFilter(group)
    setFocusedOfferId(offerId)
    workspace.openPanel('store')
  }
  const visibleOffers = useMemo(() => merchandisedOffers(view.storeOffers, storeFilter), [view.storeOffers, storeFilter])
  const storeCounts = useMemo(() => Object.fromEntries(STORE_FILTERS.map((filter) =>
    [filter, merchandisedOffers(view.storeOffers, filter).length])) as Record<StoreFilter, number>, [view.storeOffers])
  const { clock, tank, lightField, events } = view.reefSnapshot
  /* Root photoperiod (js/sim.js): scheduled lights run between .28 and .86 of the game day. */
  const timeOfDay = ((clock.timeOfDayHours % 24) + 24) % 24
  const gameClock = `${Math.floor(timeOfDay).toString().padStart(2, '0')}:${Math.floor((timeOfDay % 1) * 60).toString().padStart(2, '0')}`
  const lightsOn = timeOfDay / 24 > .28 && timeOfDay / 24 < .86
  const livingResidents = view.specimens.filter((specimen) => specimen.alive)
  const hungryResidentCount = livingResidents.filter((specimen) => specimen.hunger > .12).length
  const portionShortfall = Math.max(0, livingResidents.length - view.feeder.portionsPerDispense)
  const levelRatio = Math.min(1, Math.max(0, view.water.levelL / tank.targetWaterVolumeLiters))
  const command = guideCommand(view.guide.nextAction?.type)
  const guideLabel = typeof view.guide.nextAction?.label === 'string' ? view.guide.nextAction.label : 'Continue'
  /* One authoritative selection, two kinds of inspected entity. `view.selectedSpecimen` is keyed
   * by id alone, so it must be read through the selection's own type or a coral would surface a
   * resident that happens to share its id. */
  const selectedSpecimen = view.selection?.entityType === 'livestock' ? view.selectedSpecimen : undefined
  const selectedCoral = view.selection?.entityType === 'coral' ? view.selection : null
  const selectedEntityKey = view.selection ? `${view.selection.entityType}:${view.selection.id}` : null
  const hoveredResident = hoveredSpecimen ? view.residents.find((resident) => resident.id === hoveredSpecimen.id) : undefined
  const beginRename = (resident: PocketGameView['residents'][number], surface: 'selected' | 'roster') => {
    if (rosterSelectionTimer.current !== null) window.clearTimeout(rosterSelectionTimer.current)
    rosterSelectionTimer.current = null
    setRenameDraft({ residentId: resident.id, surface, value: resident.customName ?? '' })
  }
  const commitRename = (residentId: number) => {
    if (renameDraft?.residentId !== residentId) return
    dispatch({ type: 'RENAME_LIVESTOCK', id: residentId, name: renameDraft.value })
    setRenameDraft(null)
  }
  const renameInput = (resident: PocketGameView['residents'][number], surface: 'selected' | 'roster') =>
    renameDraft?.residentId === resident.id && renameDraft.surface === surface
      ? <input className="pocket-inline-name-input" type="text" autoComplete="off" autoFocus
          maxLength={residentNameMaxLength} value={renameDraft.value} aria-label={`Rename ${resident.name}`}
          placeholder={resident.speciesName} onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setRenameDraft({ ...renameDraft, value: event.target.value })}
          onBlur={() => setRenameDraft(null)} onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commitRename(resident.id) }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenameDraft(null) }
          }} />
      : <button className="pocket-inline-name" type="button" aria-label={`Rename ${resident.name}`}
          title="Double-click or press Enter to rename" onDoubleClick={() => beginRename(resident, surface)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); beginRename(resident, surface) }
          }}>{resident.name}</button>
  /* A reading window must exist in the saved layout to hold a rail slot, and must give the
   * slot back when unpinned, so the compact reading rail never keeps a phantom gap. */
  const toggleReading = (key: string) => {
    const pinned = pinnedReadings.includes(key)
    if (pinned) workspace.closePanel(`metric:${key}`)
    else workspace.openPanel(`metric:${key}`)
    setPinnedByProfile((current) => ({ ...current,
      [workspace.profile]: pinned ? current[workspace.profile].filter((item) => item !== key) : [...current[workspace.profile], key] }))
  }
  const applyReefView = () => {
    const available = view.testedWater.map((item) => item.key)
    const essential = REEF_FIRST_READINGS.filter((key) => available.includes(key))
    const readings = essential.length ? essential : available.slice(0, REEF_FIRST_READINGS.length)
    setPinnedByProfile((current) => ({ ...current, compact: readings }))
    workspace.applyReefFirstPreset(readings.map((key) => `metric:${key}` as HudPanelId))
  }
  const runGuide = () => {
    if (command?.action) dispatch(command.action)
    /* A guided shopping step lands on the category it just asked for: the first stocking goes
     * to Fish, general upkeep to For you when it has picks, otherwise the current filter stands. */
    if (command?.sheet === 'store') {
      const guided = view.guide.stage === 'stock_first_community' ? 'livestock'
        : hasRecommendedOffers ? 'recommended' : null
      if (guided !== null) { setStoreFilter(guided); setFocusedOfferId(null) }
    }
    if (command?.sheet) workspace.openPanel(command.sheet)
  }

  useEffect(() => {
    try { window.localStorage.setItem(PINNED_READINGS_KEY, JSON.stringify(pinnedByProfile)) } catch { /* optional UI preference */ }
  }, [pinnedByProfile])

  useEffect(() => {
    if (storeFilter === 'recommended' && !hasRecommendedOffers) setStoreFilter('equipment')
  }, [hasRecommendedOffers, storeFilter])

  /* Only a change of selected resident reopens the inspector, so a window the player
   * closed stays closed while the simulation keeps re-rendering the same selection. */
  const openPanel = workspace.openPanel
  useEffect(() => {
    if (selectedEntityKey !== null) openPanel('specimen')
    // An unsaved name belongs to the resident that was open, so it is dropped rather than carried
    // onto whichever fish the player selects next.
    setRenameDraft(null)
  }, [openPanel, selectedEntityKey])

  useEffect(() => () => {
    if (rosterSelectionTimer.current !== null) window.clearTimeout(rosterSelectionTimer.current)
  }, [])

  return <div className="reef-hud pocket-game-hud" data-arranging={workspace.isArranging}>
    <header className="hud-topbar">
      <div className="hud-brand"><span className="hud-brand-mark" aria-hidden="true">PA</span><div>
        <p>Guided reef care</p><h1>Pocket Reef Lab</h1>
      </div></div>
      <span className="hud-phone-clock">{gameClock} · {lightsOn ? 'Lights on' : 'Lights off'}</span>
      <div className="hud-run-state" aria-label="Authoritative game status">
        <span className="hud-live-dot" data-paused={clock.paused} aria-hidden="true" /><div>
          <span>{clock.paused ? 'Root simulation paused' : `Root simulation ${clock.speed}×`}</span>
          <strong>Day {clock.day} · {gameClock} · {lightsOn ? 'Lights on' : 'Lights off'} · {view.cycleStage}</strong>
        </div>
      </div>
      <div className="hud-namespace" title="Root PA is the gameplay authority"><span aria-hidden="true">●</span>
        <code>{view.reefSnapshot.namespace}</code><small>root state</small></div>
    </header>

    <div className="pocket-utility" aria-label="Tank utilities">
      {showcaseCatalog ? <span className="pocket-credit-pill" title="Accepted catalog seeded through root gameplay">
        <small>Accepted catalog</small><strong>{showcaseCatalog.acceptedSpeciesCount} species · {showcaseCatalog.animalAssets.length} animals · {showcaseCatalog.coralAssets.length} corals</strong>
      </span> : null}
      <span className="pocket-credit-pill" title="Available tank credits">
        <small>Tank credits</small><strong>{godMode?.on ? '∞' : view.credits}</strong></span>
      {godMode ? <button type="button" className="pocket-god-mode" aria-pressed={godMode.on} onClick={godMode.toggle}
        title={`God mode protects residents and makes purchases free · ${godMode.prevented.length} deaths prevented this session`}>
        <span aria-hidden="true">●</span> GOD MODE
      </button> : null}
    </div>

    {/* The resident's own editable name is the window title, so the inspector shows it once.
      * Editing replaces that one line in place; it never grows a permanent form. */}
    {selectedSpecimen ? <HudWindow id="specimen" title={selectedSpecimen.name} titleContent={renameInput(selectedSpecimen, 'selected')}
      eyebrow={selectedSpecimen.stage || 'Resident'}
      className="hud-panel pocket-specimen-panel" workspace={workspace}
      onClose={() => dispatch({ type: 'SELECT_ENTITY', id: null })}>
      <div className="pocket-selected-identity">
        <small>{selectedSpecimen.customName ? `${selectedSpecimen.speciesName} · ` : ''}{selectedSpecimen.scientificName}</small></div>
      <div className="pocket-condition-signals">{signal('Health', selectedSpecimen.health)}
        {signal('Hunger', selectedSpecimen.hunger, true)}{signal('Condition', selectedSpecimen.condition)}</div>
    </HudWindow> : selectedCoral ? <HudWindow id="specimen" title="Colony details" eyebrow="Coral health"
      className="hud-panel pocket-specimen-panel" workspace={workspace}
      onClose={() => dispatch({ type: 'SELECT_ENTITY', id: null })}>
      <div className="pocket-selected-identity"><strong>{selectedCoral.title}</strong></div>
      <div className="pocket-resident-vitals">{selectedCoral.facts.map((fact) => <span key={fact}>{fact}</span>)}</div>
    </HudWindow> : null}

    {/* Identity under the pointer, read from the same projected residents the roster shows. It is
      * decoration for a mouse hover the tank already resolved, so it is hidden from assistive
      * technology and takes no pointer input: every feed, drag, and pinch passes straight through. */}
    {hoveredSpecimen && hoveredResident ? <div className="pocket-hover-tag" aria-hidden="true"
      data-below={hoveredSpecimen.y < 96} style={{
        left: Math.min(Math.max(hoveredSpecimen.x, 92), Math.max(92, window.innerWidth - 92)),
        top: hoveredSpecimen.y,
      }}>
      <strong>{hoveredResident.name}</strong>
      <span className="pocket-resident-vitals"><span data-tone={tone(hoveredResident.health)}>
        Health <b>{Math.round(hoveredResident.health * 100)}%</b></span></span>
    </div> : null}

    <nav className="pocket-window-launcher" aria-label="Aquarium windows" data-collapsed={launcherCollapsed}>
      <button type="button" className="pocket-window-launcher-toggle" aria-expanded={!launcherCollapsed}
        aria-label={`${launcherCollapsed ? 'Expand' : 'Collapse'} aquarium windows`}
        onClick={() => setLauncherCollapsed((collapsed) => !collapsed)}>{launcherCollapsed ? 'Tools +' : 'Tools −'}</button>
      <span className="pocket-window-launcher-label">Windows</span>
      {workspace.isPhone ? <button type="button" className="pocket-reef-preset"
        title="Lay out a reef-first phone workspace: tank dominant, guided next step, collapsed care, and railed water readings"
        onClick={applyReefView}>Reef view</button> : null}
      <button type="button" className="pocket-window-arrange" aria-pressed={workspace.isArranging}
        title={workspace.isArranging ? 'Finish arranging the HUD' : 'Arrange HUD windows · hold Alt on desktop'}
        onClick={workspace.toggleArrange}>{workspace.isArranging ? 'Done' : 'Arrange'}</button>
      {workspace.isArranging ? <span className="pocket-window-launcher-hint" role="status">
        Drag titles · resize any edge · drop on a snap lane · ↺ reset · Esc done</span> : null}
      {PANEL_TABS.map(([sheet, label]) => <button key={sheet} type="button"
        aria-pressed={workspace.isOpen(sheet)} title={`${workspace.isOpen(sheet) ? 'Close' : 'Open'} ${label} window`}
        onClick={() => workspace.togglePanel(sheet)}>{label}</button>)}
    </nav>

    <HudWindow id="guide" title="Next step" eyebrow="Guided reef care" className="pocket-guide-window" workspace={workspace}>
      <section className="pocket-guide" aria-labelledby="pocket-guide-title">
        <div><p>Next guided step · {view.guide.stage.replaceAll('_', ' ')}</p><h2 id="pocket-guide-title">{view.guide.title}</h2></div>
        <p>{view.guide.body}</p>
        {command ? <button className="hud-button hud-button-primary" type="button" onClick={runGuide}>{guideLabel}</button> : null}
      </section>
    </HudWindow>

    <HudWindow id="progress" title="Keeper rank" eyebrow="Lifetime husbandry experience" className="hud-panel pocket-progress-panel" workspace={workspace}>
      <section className="pocket-progress" aria-labelledby="pocket-progress-title">
        <div className="pocket-rank-hero"><span className="pocket-rank-mark" aria-hidden="true">{view.progression.rank.split(' ').map((word) => word[0]).join('')}</span><div>
          <p>Your keeper rank</p><h2 id="pocket-progress-title">{view.progression.rank}</h2><strong>{view.xp} lifetime XP</strong></div></div>
        <p className="pocket-progress-explainer"><strong>XP records real husbandry experience.</strong> It is never spent. Rank-ups pay Tank credits; Tank credits are what you spend in the Store.</p>
        <div className="pocket-rank-progress"><div><span>{view.progression.rank}</span><strong>{view.progression.nextRank ?? 'Highest rank'}</strong></div>
          <div className="pocket-rank-track" role="progressbar" aria-label="Progress to next keeper rank" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round(view.progression.progress * 100)}><span style={{ '--rank-progress': `${view.progression.progress * 100}%` } as React.CSSProperties} /></div>
          <small>{view.progression.nextRank
            ? `${view.progression.xpToNext} XP to ${view.progression.nextRank} · rank reward +${view.progression.nextRewardCredits} Tank credits`
            : 'Every keeper rank achieved. Stable husbandry still earns XP and credits.'}</small></div>
        <div className="pocket-progress-section"><h3>How to earn it</h3><ul>{view.progression.earningPaths.map((path) => <li key={path.label}>
          <span>{path.label}</span><strong>{path.reward}</strong></li>)}</ul></div>
        <div className="pocket-progress-section"><h3>Recent achievements</h3>{view.progression.recentMilestones.length
          ? <ul>{view.progression.recentMilestones.map((milestone, index) => <li key={`${index}:${milestone}`}><span>{milestone}</span></li>)}</ul>
          : <p>Your first water test and cycling milestones will appear here.</p>}</div>
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
        <div className="hud-metric"><dt>Credits</dt><dd>{view.unlimitedCredits ? '∞' : view.credits}</dd></div><div className="hud-metric"><dt>Keeper rank</dt><dd>{view.progression.rank}</dd></div>
        <div className="hud-metric"><dt>Tier</dt><dd>{view.tierName}</dd></div><div className="hud-metric"><dt>Residents</dt><dd>{view.specimens.length}</dd></div>
        <div className="hud-metric"><dt>Still need food</dt><dd>{hungryResidentCount}</dd></div>
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
      <section className="pocket-store" aria-labelledby="pocket-store-heading"><div className="hud-panel-heading pocket-store-heading"><div><p>Build a healthier reef</p>
        <h2 id="pocket-store-heading">Aquarium supply</h2></div><span className="pocket-store-wallet"><small>Tank credits</small><strong>{view.unlimitedCredits ? '∞' : view.credits}</strong></span></div>
        <div className="pocket-store-filters" role="group" aria-label="Store category">
          {STORE_FILTERS.map((filter) => <button key={filter} type="button" aria-pressed={storeFilter === filter}
            disabled={filter === 'recommended' && !hasRecommendedOffers}
            onClick={() => { setStoreFilter(filter); setFocusedOfferId(null) }}><span aria-hidden="true">{STORE_FILTER_META[filter][1]}</span>
            {STORE_FILTER_META[filter][0]} <small>{storeCounts[filter]}</small></button>)}
        </div>
        <ul className="pocket-store-list">{visibleOffers.map((offer) => {
          const focused = offer.id === focusedOfferId
          const maxed = Boolean(offer.installed && offer.levelIndex === (offer.levelCount ?? 1) - 1)
          const upgradeStep = offer.levelIndex === undefined ? null : `${offer.levelIndex + 1} / ${offer.levelCount}`
          /* Compatibility is the only lock the player may overrule, so this card trades its
           * one-click purchase for a deliberate choice. Every other lock stays a lock. */
          const conflicts = offer.conflicts?.length ? offer.conflicts : null
          const conflictMessages = new Set(conflicts?.map((conflict) => conflict.message) ?? [])
          const hardReasons = offer.reasons.filter((reason) => !conflictMessages.has(reason))
          const riskOnly = conflicts !== null && hardReasons.length === 0
          const deciding = riskOnly && offer.id === decidingOfferId
          const decision = riskOnly && conflicts ? conflictDecision(conflicts) : null
          return <li className="hud-event pocket-store-offer" key={`${offer.kind}:${offer.id}`}
            data-locked={!offer.allowed} data-risk={Boolean(conflicts)}
            data-installed={offer.installed} data-recommended={offer.recommended} data-focused={focused}
            ref={focused ? (node) => node?.scrollIntoView({ block: 'nearest' }) : undefined}>
            <div className="pocket-store-offer-head">
              <StoreArtwork offer={offer} />
              <div className="pocket-offer-title"><span>{offer.category ?? offer.kind}{upgradeStep ? ` · ${upgradeStep}` : ''}</span><strong>{offer.name}</strong>
                {offer.installedName && !offer.installed ? <small>Installed now · {offer.installedName}</small> : null}</div>
              <div className="pocket-offer-price"><strong>{offer.installed ? 'Owned' : offer.price}</strong><small>{offer.installed ? (maxed ? 'System complete' : 'Installed') : 'tank credits'}</small></div>
              <div className="pocket-offer-tags">{offer.recommended ? <span className="pocket-offer-tag" data-tone="rec">Recommended</span> : null}
                {conflicts ? <span className="pocket-offer-tag" data-tone="risk">Compatibility risk</span> : null}
                {offer.installed ? <span className="pocket-offer-tag" data-tone="installed">Installed</span> : null}
                {offer.kind === 'equipment' && !offer.installed ? <span className="pocket-offer-tag" data-tone="upgrade">Next upgrade</span> : null}</div></div>
            {offer.durableEffect ? <p className="pocket-offer-outcome">{offer.durableEffect}</p> : offer.detail ? <p className="pocket-offer-outcome">{offer.detail}</p> : null}
            {riskOnly
              ? deciding ? null : <button className="hud-button" type="button" aria-expanded={false}
                  onClick={() => setDecidingOfferId(offer.id)}>Decide · {offer.price}</button>
              : <button className="hud-button" type="button" disabled={offer.installed || !offer.allowed} onClick={() => dispatch(offer.action)}>
                  {offer.installed ? (maxed ? 'Fully upgraded' : 'Installed') : offer.allowed ? `Install for ${offer.price}` : 'Unavailable'}</button>}
            {deciding && conflicts && decision ? <div className="pocket-offer-decision" role="group"
              aria-labelledby={`pocket-decision-${offer.id}`}
              onKeyDown={(event) => { if (event.key === 'Escape') setDecidingOfferId(null) }}>
              <strong id={`pocket-decision-${offer.id}`}>{offer.name} is incompatible with residents you already keep</strong>
              <ul>{conflicts.map((item) => <li key={`${item.riskTag}:${item.residentSpeciesId}`}>{item.message}</li>)}</ul>
              <p>Selling {decision.residents} refunds {decision.refund} tank credits and cannot be undone.
                Accepting stocks {offer.name} anyway: both stay in the tank and the incompatibility
                remains a husbandry warning the simulation does not act out.</p>
              <div className="pocket-offer-decision-actions">
                <button className="hud-button hud-button-danger" type="button"
                  onClick={() => {
                    dispatch({ type: 'SELL_LIVESTOCK', ids: decision.residentIds })
                    dispatch(offer.action)
                    setDecidingOfferId(null)
                  }}>
                  Sell conflicting residents (+{decision.refund} credits), then add</button>
                <button className="hud-button" type="button"
                  onClick={() => { dispatch({ ...offer.action, acceptRisk: true }); setDecidingOfferId(null) }}>
                  Accept risk and add</button>
                <button className="hud-button" type="button" autoFocus
                  onClick={() => setDecidingOfferId(null)}>Cancel</button>
              </div>
            </div> : null}
            {offer.detail || offer.problemSolved || offer.operatingResource || offer.reasons.length ? <details className="pocket-offer-more">
              <summary>{conflicts ? 'Compatibility risk' : offer.reasons.length ? 'Why unavailable' : 'Why this upgrade'}</summary>
              {offer.detail && offer.detail !== offer.durableEffect ? <p className="pocket-offer-detail">{offer.detail}</p> : null}
              {offer.problemSolved ? <dl className="pocket-offer-facts">
                <div><dt>Solves</dt><dd>{offer.problemSolved}</dd></div>
                {offer.operatingResource ? <div><dt>Upkeep</dt><dd>{offer.operatingResource}</dd></div> : null}
              </dl> : null}
              {offer.reasons.length ? <ul className="pocket-lock-reasons"
                aria-label={`${offer.name} ${conflicts ? 'compatibility risks' : 'lock reasons'}`}>
                {offer.reasons.map((reason, index) => <li key={`${index}:${reason}`}>{reason}</li>)}</ul> : null}
            </details> : offer.installed ? null : <p className="pocket-offer-ready">Ready to install.</p>}
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
      <button className="hud-button" type="button" title="Also available by double-clicking the tank"
        onClick={() => window.dispatchEvent(new Event(REEF_CAMERA_RESET_EVENT))}>Reset camera</button>{' '}
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
            <small>One portion is one feeding opportunity for one resident, and bottom residents only reach it after it settles.{portionShortfall > 0 ? ` This drop is ${portionShortfall} portion(s) short of ${livingResidents.length} living resident(s) — raise portions or feed manually.` : ''}</small>
            <div className="pocket-automation-actions">
              <button className="hud-button" type="button" aria-pressed={view.feeder.enabled}
                onClick={() => dispatch({ type: 'SET_FEEDER', enabled: !view.feeder.enabled })}>{view.feeder.enabled ? 'Disable' : 'Enable'}</button>
              <button className="hud-button" type="button" aria-label="Slower cadence"
                onClick={() => dispatch({ type: 'SET_FEEDER', intervalDays: Math.min(14, view.feeder.intervalDays + 0.5) })}>Slower</button>
              <button className="hud-button" type="button" aria-label="Faster cadence"
                onClick={() => dispatch({ type: 'SET_FEEDER', intervalDays: Math.max(0.25, view.feeder.intervalDays - 0.5) })}>Faster</button>
              <button className="hud-button" type="button" aria-label="Fewer portions per dispense"
                onClick={() => dispatch({ type: 'SET_FEEDER', portionsPerDispense: Math.max(1, view.feeder.portionsPerDispense - 1) })}>Fewer</button>
              <button className="hud-button" type="button" aria-label="More portions per dispense"
                onClick={() => dispatch({ type: 'SET_FEEDER', portionsPerDispense: Math.min(10, view.feeder.portionsPerDispense + 1) })}>More</button>
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

    <HudWindow id="residents" title="Residents" eyebrow="Tank roster" className="hud-panel pocket-residents-panel" workspace={workspace}>
      <ul className="pocket-resident-list" aria-label="Tank residents">
        {view.residents.map((resident) => {
          const editing = renameDraft?.residentId === resident.id && renameDraft.surface === 'roster'
          return <li key={resident.id}>
          {editing ? <div className="pocket-resident-row" data-dead={resident.alive === false} data-editing="true">
            <span className="pocket-resident-identity">{renameInput(resident, 'roster')}
              <small>{resident.customName ? `${resident.speciesName} · ` : ''}{resident.alive === false ? 'Deceased' : resident.stage}</small></span>
            <span className="pocket-resident-vitals">
              <span data-tone={tone(resident.health)}>Health <b>{Math.round(resident.health * 100)}%</b></span>
              <span data-tone={tone(resident.hunger, true)}>Hunger <b>{Math.round(Math.min(1, Math.max(0, resident.hunger)) * 100)}%</b></span>
              <span data-tone={tone(resident.condition)}>Condition <b>{Math.round(resident.condition * 100)}%</b></span>
            </span>
          </div> : <button type="button" className="pocket-resident-row" data-dead={resident.alive === false}
            aria-pressed={selectedSpecimen?.id === resident.id} title={`Inspect ${resident.name}; double-click or press Enter to rename`}
            onClick={() => {
              if (rosterSelectionTimer.current !== null) window.clearTimeout(rosterSelectionTimer.current)
              rosterSelectionTimer.current = window.setTimeout(() => {
                dispatch({ type: 'SELECT_ENTITY', entityType: 'livestock', id: resident.id })
                rosterSelectionTimer.current = null
              }, 220)
            }} onDoubleClick={() => beginRename(resident, 'roster')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); beginRename(resident, 'roster') }
            }}>
            <span className="pocket-resident-identity"><strong>{resident.name}</strong>
              <small>{resident.customName ? `${resident.speciesName} · ` : ''}{resident.alive === false ? 'Deceased' : resident.stage}</small></span>
            <span className="pocket-resident-vitals">
              <span data-tone={tone(resident.health)}>Health <b>{Math.round(resident.health * 100)}%</b></span>
              <span data-tone={tone(resident.hunger, true)}>Hunger <b>{Math.round(Math.min(1, Math.max(0, resident.hunger)) * 100)}%</b></span>
              <span data-tone={tone(resident.condition)}>Condition <b>{Math.round(resident.condition * 100)}%</b></span>
            </span>
          </button>}
        </li>})}
        {view.residents.length ? null : <li className="pocket-store-empty">No residents yet. Add livestock in the Store.</li>}
      </ul>
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
