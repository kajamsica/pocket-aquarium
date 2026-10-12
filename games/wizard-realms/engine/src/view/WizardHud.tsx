import { Component, useState, type ReactNode } from 'react'
import type { EquipmentSlot, WizardViewIntent, WizardViewProjection } from './contracts'
import type { TerrainWorkSite } from '../domain/terrainWorks'
import { PUBLIC_V11_BOOTS_LISTING_ID } from '../domain/publicWorldGait'
import { publicV36MarkerRejectionMessage } from './publicV36MarkerQuest'
import { publicV40WaystationRejectionHint } from './publicV40WaystationQuest'
import { publicV41IronHallQuest, publicV41IronHallRejectionHint,
  type PublicV41IronHallActionPreview } from './publicV41IronHallQuest'

export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ['head', 'chest', 'mainHand', 'legs', 'feet', 'offHand']
export const EQUIPMENT_SLOT_LABELS: Readonly<Record<EquipmentSlot, string>> = {
  head: 'Head', chest: 'Chest', legs: 'Legs', feet: 'Feet', mainHand: 'Main hand', offHand: 'Off hand',
}
const FIELD_ACTION_STYLE = { minHeight: 44, padding: '6px 8px', border: '1px solid #cfb66b55', borderRadius: 6, background: '#374b3d', color: '#f8e8b2', cursor: 'pointer' } as const
const SKILL_LABELS = { woodcutting: 'Woodcutting', construction: 'Construction', wayfinding: 'Wayfinding', spellcraft: 'Spellcraft', excavation: 'Excavation' } as const
const RINGKEEPER_NEXT = {
  find: 'Find Quarry ring', return: 'Return to Greenway', link: 'Link the rings',
  outbound: 'Travel to Highland', 'return-via-ring': 'Travel back to Greenway',
  claim: 'Claim at Greenway', complete: 'Complete',
} as const
const WAYSTATION_NEXT = {
  find: 'Find the river crossing', 'choose-materials': 'Gather or barter timber',
  build: 'Build the bridge', cross: 'Reach the south bank',
  return: 'Claim at Outfitters', complete: 'Complete',
} as const
const ironHallActionHint = (action: PublicV41IronHallActionPreview) => action.hint
  ?? (action.rejection ? publicV41IronHallRejectionHint(action.rejection) : null)
const WORK_REASONS = {
  invalid_state: 'Trial state unavailable', invalid_site: 'Invalid site', undiscovered: 'Not discovered',
  too_far: 'Move within 3 m', occupied: 'Footprint occupied', already_done: 'Already completed',
  insufficient_logs: 'Not enough logs', requires_spade: 'Equip a spade', capacity: 'Kit full',
  limit_reached: 'Trial limit reached', invalid_value: 'Invalid reward',
} as const
const workLocation = (position: WizardViewProjection['player']['position'], site: TerrainWorkSite) => {
  const point = site.kind === 'dig' ? site.center : site.from
  const east = point.x - position[0], north = position[2] - point.z
  const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
  const bearing = Math.hypot(east, north) < 1 ? 'here'
    : compass[(Math.round(Math.atan2(east, north) / (Math.PI / 4)) + 8) % 8]
  const distance = Math.hypot(east, north)
  const displayDistance = distance <= 5 ? Number(distance.toFixed(2)) : Math.round(distance)
  return `${bearing} · ${displayDistance} m on map · x ${Number(point.x.toFixed(1))}, z ${Number(point.z.toFixed(1))}`
}
const workClimbDirection = (site: Exclude<TerrainWorkSite, { kind: 'dig' }>) =>
  site.to.x > site.from.x ? 'east' : site.to.x < site.from.x ? 'west'
    : site.to.z > site.from.z ? 'south' : 'north'

export function publicV25NorthLadderGuidance(projection: WizardViewProjection): string | null {
  const works = projection.savedTerrainWorks
  if (!projection.v25RiverActive || works?.context !== 'works4-greenway'
    || !works.builtSites.some((site) => site.kind === 'bridge')
    || works.builtSites.some((site) => site.kind === 'ladder')) return null
  const logs = projection.backpack.stacks.reduce((total, stack) =>
    total + (stack.itemId === 'logs' ? stack.quantity : 0), 0)
  const remaining = Math.max(0, 4 - logs)
  return `North cliff Ladder to upper ledge: costs 4 logs; ${logs} in your bag${remaining
    ? `, ${remaining} more needed` : ', enough to build'}. B Works, 2 Ladder, aim at a discovered clear face, F.`
}

type WorksFocusProps = { active: boolean; expanded: boolean; children: ReactNode }
export class WizardWorksFocusBoundary extends Component<WorksFocusProps> {
  private panel: HTMLDivElement | null = null

  getSnapshotBeforeUpdate(previous: Readonly<WorksFocusProps>): boolean {
    if (!this.props.active || !previous.expanded || this.props.expanded) return false
    const focused = this.panel?.ownerDocument.activeElement
    const toggle = this.panel?.querySelector<HTMLButtonElement>('button[aria-expanded]')
    return !!focused && focused !== toggle && !!this.panel?.contains(focused)
  }

  componentDidUpdate(_previous: Readonly<WorksFocusProps>, _state: unknown, restore?: boolean) {
    if (restore) this.panel?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus({ preventScroll: true })
  }

  render() {
    return this.props.active
      ? <div ref={(node) => { this.panel = node }} style={{ display: 'contents' }}>{this.props.children}</div>
      : this.props.children
  }
}

export function WizardHud({ projection, onIntent, diagnostics }: {
  projection: WizardViewProjection
  onIntent: (intent: WizardViewIntent) => void
  diagnostics?: boolean
}) {
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const markerQuest = projection.v36MarkerQuest?.active ? projection.v36MarkerQuest : null
  const earlierJournalQuest = projection.v35LedgerQuest && projection.v34Quest && !projection.v34Quest.complete
    ? projection.v34Quest
    : projection.v35LedgerQuest && !projection.v35LedgerQuest.complete
      ? projection.v35LedgerQuest : markerQuest ?? projection.v35LedgerQuest
  const signalQuest = projection.v38SignalQuest
  const ringkeeperQuest = projection.v39RingkeeperQuest
  const waystationQuest = projection.v40WaystationQuest
  const hallQuest = publicV41IronHallQuest(projection)
  const hall = projection.v41IronHall
  const hallSite = projection.v41IronHallSite
  const nearHallAlcove = hallSite?.revealed && Math.hypot(
    projection.player.position[0] - hallSite.alcove[0],
    projection.player.position[2] - hallSite.alcove[2]) < 9
  const nearHallWard = hallSite?.revealed && Math.hypot(
    projection.player.position[0] - hallSite.ward[0],
    projection.player.position[2] - hallSite.ward[2]) < 10
  const journalQuest = signalQuest && projection.v36MarkerQuest?.complete
    ? signalQuest : earlierJournalQuest
  const ledgerQuestPrimary = journalQuest?.id === 'outfitters-ledger/v1'
  const markerQuestPrimary = journalQuest?.id === 'beneath-old-marker/v1'
  const signalQuestPrimary = journalQuest?.id === 'highland-signal/v1'
  const starterCliff = projection.starterCliff !== undefined
  const mining = projection.v29Mining
  const knownCliffFoot = starterCliff && (projection.buildSites.some((site) =>
    site.id === projection.starterCliff!.face.siteId && site.discovered)
    || projection.routes.some((route) => route.id === 'greenway_ladder' && route.built))
  const legacyActionsUnavailable = projection.unavailableActions === true
  const savePaused = projection.controllerActionsEnabled === false
  const v16Magic = starterCliff
    && (projection.savedTerrainWorks?.context === 'works3-greenway'
      || projection.savedTerrainWorks?.context === 'works4-greenway')
    && projection.savedTerrainWorks.actionsEnabled === true && !legacyActionsUnavailable
  const showGlow = !starterCliff || v16Magic
  const nearbyStore = !legacyActionsUnavailable && projection.openStoreId
    && (!starterCliff || projection.openStoreId === 'store-greenway')
    ? projection.stores.find((store) => store.id === projection.openStoreId)
    : undefined
  const starterHasBoots = projection.backpack.stacks.some((stack) => stack.itemId === 'leather_boots')
    || projection.equipment.feet?.itemId === 'leather_boots'
  const starterHasSpade = projection.backpack.stacks.some((stack) => stack.itemId === 'field_spade')
    || projection.equipment.mainHand?.itemId === 'field_spade'
  const starterStoneQuantity = projection.backpack.stacks.reduce((total, stack) =>
    total + (stack.itemId === 'stone' ? stack.quantity : 0), 0)
  const sellOffers = nearbyStore?.sellOffers.filter((offer) => !starterCliff
    || offer.itemId === 'stone' && offer.unitPrice === 1
      && offer.quantity > 0 && offer.quantity === starterStoneQuantity) ?? []
  const availableStore = !legacyActionsUnavailable && projection.nearbyStoreId && projection.openStoreId === null
    && (!starterCliff || projection.nearbyStoreId === 'store-greenway')
    ? projection.stores.find((store) => store.id === projection.nearbyStoreId)
    : undefined
  const nearbyRing = (!starterCliff || projection.v33FairyTravel === true) && !legacyActionsUnavailable && projection.nearbyInteraction?.kind === 'fairy-ring'
    ? projection.fairyRings.find((ring) => ring.id === projection.nearbyInteraction?.targetId)
    : undefined
  const discoveredDestinations = nearbyRing?.destinations.filter((destination) => destination.discovered) ?? []
  const excavatedMaterials = Object.entries(projection.v26TerrainBag ?? {})
    .filter(([, quantity]) => quantity > 0)
  const usedCapacity = projection.backpack.stacks.reduce((total, stack) => total + stack.quantity, 0)
    + projection.tradeListings.reduce((total, listing) => total + (listing?.quantity ?? 0), 0)
    + excavatedMaterials.reduce((total, [, quantity]) => total + quantity, 0)
  const firstTradeSlot = projection.tradeListings.findIndex((listing) => listing === null)
  const learnedGlow = projection.learnedSpellIds.includes('wayfinder_glow')
  const checkedReason = (id: string): string | null => {
    if (!projection.checkedActionChoices) return null
    const choice = projection.checkedActionChoices.find((entry) => entry.id === id)
    return choice?.actionable ? null : choice?.reason ?? 'No current checked Mireglass action is available.'
  }
  const glowCheckedReason = checkedReason('mireglass:cast:wayfinder_glow')
  const glowUnavailable = !showGlow || savePaused || !learnedGlow
    || (legacyActionsUnavailable && projection.streamedSpellAvailable !== true)
    || !!glowCheckedReason
  const excavationLevel = 1 + Math.floor(projection.skillXp.excavation / 30)
  const spadeEquipped = projection.equipment.mainHand?.itemId === 'field_spade'
  const inReach = (position: readonly [number, number, number]) => Math.hypot(position[0] - projection.player.position[0], position[1] - projection.player.position[1], position[2] - projection.player.position[2]) <= 3
  const nearbyInscriptions = !showGlow || legacyActionsUnavailable ? []
    : projection.inscriptions.filter((inscription) => !inscription.studied && inReach(inscription.position))
  const nearbyDigSites = starterCliff || legacyActionsUnavailable ? [] : projection.digSites.filter((site) => site.revealed && !site.excavated && inReach(site.position))
  const campPreview = starterCliff || legacyActionsUnavailable ? null : projection.fieldCamp?.preview
  const selectedBuildSite = !legacyActionsUnavailable && !campPreview && projection.buildSites.find((site) => site.id === projection.selectedBuildSiteId && site.discovered && site.status !== 'built'
    && (!starterCliff || site.id === projection.starterCliff!.face.siteId))
  const bridgeheadClaim = projection.v30Bridgehead?.claimReady
    && projection.v30Bridgehead.reward && projection.controllerActionsEnabled === true
    ? projection.v30Bridgehead : null
  const nearbyAction = bridgeheadClaim ? null : starterCliff && projection.nearbyInteraction
    && !(projection.v33FairyTravel === true && projection.nearbyInteraction.kind === 'fairy-ring')
    && (projection.nearbyInteraction.kind !== 'resource' || !projection.resources.some((resource) =>
      resource.id === projection.nearbyInteraction?.targetId && resource.kind === 'tree' && resource.available))
    && (projection.nearbyInteraction.kind !== 'store' || projection.nearbyInteraction.targetId !== 'store-greenway')
    ? null : projection.nearbyInteraction
  const checkedNearbyInteract = projection.checkedActionChoices === undefined ? true
    : nearbyAction?.kind === 'store'
      ? !!nearbyAction.actionable && nearbyAction.targetId === projection.nearbyStoreId
      : !!nearbyAction?.actionable && projection.checkedActionChoices.some((choice) =>
        choice.id === nearbyAction.targetId && choice.actionable)
  const xpPercent = Math.min(100, projection.experience.nextLevelXp > 0
    ? projection.experience.xp / projection.experience.nextLevelXp * 100
    : 100)
  const windward = projection.windwardStep
  const windwardAction = windward?.learned ? { type: 'windward.cast' as const } : { type: 'windward.study' as const }
  const windwardActionable = !savePaused && (!legacyActionsUnavailable || windward?.checkedActions === true) && (windward?.learned ? windward.canCast : windward?.glyph?.canStudy === true)
  const windwardStatus = windward?.unavailableReason ?? (windward?.activeSeconds
    ? `Active for ${windward.activeSeconds}s. Recast in ${windward.cooldownSeconds}s.`
    : windward?.cooldownSeconds ? `Recast in ${windward.cooldownSeconds}s.`
      : windward?.learned ? windward.canCast ? 'Ready on the dry Highland trail.' : 'Follow the dry Highland trail to cast.'
        : windward?.glyph?.canStudy ? 'Study the wind-cut glyph here.' : 'Find the wind-cut glyph at Quarry Crown.')
  const trial = starterCliff ? undefined : projection.terrainWorkTrial
  const savedWorks = starterCliff && projection.savedTerrainWorks?.modeActive === undefined
    ? undefined : projection.savedTerrainWorks
  const v26Terrain = projection.v26ValleyRimSegments !== undefined
  const v27Terrain = projection.v27WalkableSurface === true
  const starterGreenwayWorks = savedWorks?.context === 'starter-greenway'
  const works3Greenway = savedWorks?.context === 'works3-greenway'
  const works4Greenway = savedWorks?.context === 'works4-greenway'
  const v28River = savedWorks?.context === 'v28-river'
  const greenwayWorks = starterGreenwayWorks || works3Greenway || works4Greenway
  const workMode = savedWorks?.modeActive === true
  const workPreview = workMode ? savedWorks?.preview : null
  const selectedRoutePreview = workPreview?.selected?.site
  const unbuiltRoutePreview = selectedRoutePreview?.kind !== 'dig'
    && selectedRoutePreview !== undefined
    && !savedWorks?.builtSites.some((site) => site.id === selectedRoutePreview.id)
  const nearestSuggestedWork = savedWorks?.suggestedSites?.filter((site): site is Exclude<TerrainWorkSite, { kind: 'dig' }> =>
    site.kind !== 'dig' && site.kind === savedWorks.selectedKind
      && (!v28River || site.id.startsWith('works6:river-bridge:')))
    .sort((a, b) => (v28River
      ? Math.hypot(a.from.x - projection.player.position[0], a.from.z - projection.player.position[2])
        - Math.hypot(b.from.x - projection.player.position[0], b.from.z - projection.player.position[2])
      : Math.abs(a.from.x - projection.player.position[0])
        - Math.abs(b.from.x - projection.player.position[0])) || a.id.localeCompare(b.id))[0]
  const aimedWork = v26Terrain && workPreview?.selected?.site.kind === 'dig'
    ? null : workPreview?.selected
  const builtWorksLadders = works4Greenway
    ? savedWorks!.builtSites.filter((site) => site.kind === 'ladder') : []
  const nearbyLowerLadder = builtWorksLadders.find((site) =>
    Math.hypot(site.from.x - projection.player.position[0],
      site.from.z - projection.player.position[2]) <= 7
    && projection.player.position[1] < site.to.y - 0.2)
  const selectedWork = trial?.selectedSite
  const builtLadder = trial?.builtSites.find((site) => site.kind === 'ladder'
    && Math.min(Math.hypot(site.from.x - projection.player.position[0], site.from.z - projection.player.position[2]),
      Math.hypot(site.to.x - projection.player.position[0], site.to.z - projection.player.position[2])) <= 4)
  const climbDirection = builtLadder && workClimbDirection(builtLadder)
  const descendDirection = climbDirection && ({ east: 'west', west: 'east', south: 'north', north: 'south' } as const)[climbDirection]
  const workName = (kind: 'bridge' | 'ladder' | 'dig') => kind === 'bridge'
    ? v28River ? 'Connected-river bridge' : greenwayWorks ? 'Creek bridge' : 'Fen bridge'
    : kind === 'ladder' ? works3Greenway || works4Greenway ? 'North cliff ladder' : 'Slate ladder'
      : greenwayWorks ? 'Bank dig' : 'Loam dig'
  const workReason = (choice: { site: TerrainWorkSite; rejection: string | null; reason: string }) => {
    if (works4Greenway && choice.site.kind === 'ladder' && choice.rejection === 'occupied'
      && choice.reason === 'Move clear of the footprint and other works.') {
      const railStart = choice.site.supportPath[1]
      const railEnd = choice.site.supportPath[choice.site.supportPath.length - 2]
      const [x, , z] = projection.player.position
      if (Math.abs(x - choice.site.from.x) <= choice.site.widthMeters / 2 + 0.015
        && z >= Math.min(railStart.z, railEnd.z) - 0.5
        && z <= Math.max(railStart.z, railEnd.z) + 0.5) {
        return `You are standing in this ladder ghost. Step south to the lower foot x ${Number(choice.site.from.x.toFixed(1))}, z ${Number(choice.site.from.z.toFixed(1))}, then confirm within 3 m. If still occupied, shift the aim or clear overlapping work.`
      }
    }
    return (works3Greenway || works4Greenway) && choice.site.kind !== 'dig' && choice.rejection === 'occupied'
      && choice.reason === 'Move clear of the footprint and other works.'
      ? 'Step beside the ghost route, staying within 3 m; if still blocked, choose a clear site.'
      : choice.reason
  }
  const nextSavedWork = aimedWork
  const nearbyUnaimedWork = !aimedWork ? workPreview?.nearby.find((choice) =>
    !v26Terrain || choice.site.kind !== 'dig') : null
  const starterWork = greenwayWorks ? aimedWork ?? workPreview?.nearby
    .filter((choice) => !v26Terrain || choice.site.kind !== 'dig')
    .slice().sort((left, right) => left.distanceMeters - right.distanceMeters)[0] : null
  const starterWorkComplete = starterWork?.site.kind === 'bridge'
    ? savedWorks?.builtSites.some((site) => site.id === starterWork.site.id)
    : starterWork?.site.kind === 'ladder'
      ? savedWorks?.builtSites.some((site) => site.id === starterWork.site.id)
    : starterWork?.site.kind === 'dig'
      && savedWorks?.dugTileIds.includes(starterWork.site.footprintTileIds[0])
  const greenwayLogs = projection.backpack.stacks.reduce((total, stack) =>
    total + (stack.itemId === 'logs' ? stack.quantity : 0), 0)
  const greenwayBridgeBuilt = savedWorks?.builtSites.some((site) => site.kind === 'bridge')
  const greenwayLadderBuilt = savedWorks?.builtSites.some((site) => site.kind === 'ladder')
  const v25NorthLadder = publicV25NorthLadderGuidance(projection)
  const greenwayLadderNext = greenwayBridgeBuilt && !!savedWorks?.dugTileIds.length
    && starterStoneQuantity === 0 && projection.equipment.feet?.itemId === 'leather_boots'
    && !greenwayLadderBuilt
  const greenwayObjective = savePaused ? 'Save paused: check the save status before using Works.'
    : v27Terrain ? mining && !greenwayLadderBuilt && !greenwayBridgeBuilt
      ? `${projection.equipment.mainHand?.itemId === 'woodcutters_axe' ? 'Axe ready' : 'Equip Woodcutter axe from Backpack'}: Interact with a nearby oak for logs. Choose a 4-log north ladder to the west route or an 8-log South creek bridge at a marked Ready site. Beyond the ladder, carry 8 more logs for the connected-river bridge.`
      : projection.map.guidance ?? 'Explore to reveal a Ready route site.'
    : mining ? !starterHasSpade
      ? 'Buy a field spade at Greenway Outfitters for soil, then buy a basic pick for deeper layers.'
      : !mining.tools.basicPickOwned
        ? 'Use the equipped spade on nearby revealed dry ground; a basic pick costs 35g at Greenway Outfitters for deeper layers.'
        : mining.tools.activePick === null && !spadeEquipped
          ? 'Equip your spade for soil or your owned basic pick for deeper layers.'
          : 'Choose Dig with the spade for soil, or Mine with an equipped pick for deeper layers. Tap one revealed dry cell; the checked result tells you what is there.'
    : nearbyLowerLadder
      ? `North cliff Ladder: back south past z ${Number((nearbyLowerLadder.supportPath[1].z + 0.15).toFixed(1))}, align x ${Number(nearbyLowerLadder.from.x.toFixed(1))}, then face north and press W between the rails. Side entry is blocked.`
    : v25NorthLadder ? v25NorthLadder
    : !greenwayBridgeBuilt ? greenwayLogs < 8
      ? `South creek Bridge to far bank: chop ${8 - greenwayLogs} more logs; B, 1, aim at a discovered dry crossing, F.`
      : 'South creek Bridge to far bank: B, 1, aim at a discovered dry crossing, F.'
    : !savedWorks?.dugTileIds.length ? !starterHasSpade
      ? v26Terrain ? 'Buy a field spade at Outfitters to use Terrain Dig/Fill.'
        : 'Dry far-bank Dig for stone: buy and equip a field spade at Outfitters.'
      : !spadeEquipped ? v26Terrain ? 'Equip your field spade to use Terrain Dig/Fill.'
        : 'Dry far-bank Dig: equip your field spade and free one bag slot.'
        : v26Terrain ? 'Equip the spade, choose Dig in Terrain tools, then tap nearby revealed dry ground.'
          : 'Dry far-bank Dig: free one bag slot, stand beside revealed loam, then B, 3, F.'
    : starterStoneQuantity > 0 ? `Sell ${starterStoneQuantity} stone at Greenway Outfitters for 1g each.`
      : !starterHasBoots ? 'Buy and equip leather boots at Outfitters to run by default.'
        : projection.equipment.feet?.itemId !== 'leather_boots'
          ? 'Equip your leather boots to run by default.'
          : !greenwayLadderBuilt ? 'North cliff Ladder to upper ledge: gather 4 logs; B, 2, aim at a discovered clear face, F.'
            : 'Explore Greenway for more discovered works.'

  return (
    <div className="wr-hud">
      <div className="wr-topbar">
        <div><span className="wr-kicker">LEVEL</span><strong>{projection.experience.level}</strong></div>
        <div className="wr-xp"><span style={{ width: `${xpPercent}%` }} /></div>
        <div className="wr-coins" aria-label={`${projection.coins} coins`}>◉ {projection.coins.toLocaleString()}</div>
      </div>

      {projection.gait && <div className="wr-gait" role="group" aria-label="Movement pace">
        <button type="button" aria-label={works3Greenway || works4Greenway ? 'Toggle Walk/Run pace' : 'Walk'}
          aria-pressed={projection.gait.pace === 'walk'} disabled={!projection.gait.canRun || savePaused}
          onClick={() => onIntent({ type: 'gait.toggle' })}>{works3Greenway || works4Greenway ? 'Walk/Run' : 'Walk'}</button>
        <small role="status">{savePaused ? 'Pace changes paused while the save is not ready.'
          : works3Greenway || works4Greenway ? projection.gait.canRun
            ? `${projection.gait.pace === 'run' ? 'Run' : 'Walk'} now in leather boots; R or Walk/Run switches to ${projection.gait.pace === 'run' ? 'Walk' : 'Run'}.`
            : 'Walk now: barefoot walking only. Outfitters boots enable Run by default.'
          : greenwayWorks ? projection.gait.canRun
            ? `Leather boots: ${projection.gait.pace} · default run · Walk/R`
            : 'Barefoot walks · Outfitters boots run'
          : projection.gait.reason}</small><kbd>R</kbd>
      </div>}

      {(works4Greenway || projection.v34Quest || journalQuest) && <>
        <style>{`
          .wr-greenway-objective{position:absolute;z-index:6;right:16px;top:192px;box-sizing:border-box;width:340px;padding:7px 9px;border:1px solid #d5b86f77;border-radius:9px;background:#101a17e8;color:#fff0c7;font:600 11px/1.25 system-ui,sans-serif;pointer-events:none}
          .wr-greenway-objective small{display:block;margin-top:3px;color:#c5d0c3;font-weight:400}
          .wr-v34-quest{max-height:85px;overflow:auto;overscroll-behavior:contain;pointer-events:auto}
          .wr-v34-quest summary{min-height:44px;cursor:pointer}
          .wr-v34-quest p{margin:5px 0 0;color:#c5d0c3;font-weight:400}
          .wr-v35-quest{max-height:116px;overflow:auto;overscroll-behavior:contain;pointer-events:auto;font-size:12px;line-height:1.35}
          .wr-v35-quest small{font-size:12px;line-height:1.35}
          .wr-v35-quest button{min-height:44px;width:100%;margin-top:6px;border:1px solid #d5b86f;border-radius:7px;background:#536647;color:#fff5d6;font:600 12px system-ui;cursor:pointer}
          .wr-v35-quest button:disabled{opacity:.58;cursor:not-allowed}
          .wr-work-selection{margin:6px 0;padding:7px 8px;border:1px solid #d5b86f88;border-radius:7px;background:#27382e;color:#f5e5b5;font-size:12px;overflow-wrap:anywhere}
          .wr-v35-quest details{margin-top:5px;color:#c5d0c3;font-weight:400}
          .wr-v35-quest summary{min-height:30px;cursor:pointer}
          .wr-v35-quest .wr-ringkeeper-chapter summary,.wr-v35-quest .wr-waystation-chapter summary,.wr-v35-quest .wr-ironhall-chapter summary{min-height:44px}
          .wr-ironhall-chapter summary{color:#f5d899}
          .wr-ironhall-chapter[data-phase="windup"] summary{color:#ffc4aa}
          .wr-v35-mobile-toggle{display:none}
          @media(min-width:1200px) and (min-height:600px){.wr-v35-quest{right:248px;top:266px;max-height:136px}}
          @media(min-width:901px) and (min-height:600px){.wr-surface[data-work-mode="true"] .wr-saved-work-panel{width:310px}}
          @media(min-width:720px) and (min-height:600px){[data-public-version=v35] .wr-context[data-store-panel],[data-public-version=v36] .wr-context[data-store-panel]{box-sizing:border-box;max-height:calc(100% - 80px);overflow-y:auto;overscroll-behavior:contain}}
          [data-public-v23]:has(.wr-surface[data-work-mode="true"]) .v23-guide{display:none}
          [data-public-v23]:has(.wr-surface[data-work-mode="true"]) .v23-save{max-height:120px;overflow-y:auto;font-size:12px;line-height:1.2;padding:6px}
          [data-public-v23]:has(.v23-save) .wr-surface[data-work-mode="true"] .wr-saved-work-panel{top:136px;max-height:calc(100% - 152px)}
          @media(max-height:590px) and (min-width:720px){.wr-greenway-objective{top:8px}.wr-surface:has(.wr-greenway-objective) .wr-saved-work-panel{top:120px;max-height:calc(100% - 136px)}}
          @media(min-width:720px) and (max-width:900px) and (max-height:590px){[data-public-v23]:has(.v23-save) .wr-surface[data-work-mode="true"] .wr-saved-work-panel{top:204px;max-height:calc(100% - 220px)}}
          @media(min-width:720px) and (max-width:900px) and (max-height:590px){.wr-greenway-objective{max-height:60px;overflow-y:auto;pointer-events:auto}.wr-surface:has(.wr-greenway-objective) .wr-saved-work-panel{top:140px;right:240px}[data-public-v23]:has(.wr-greenway-objective) .v23-save{max-height:120px;overflow-y:auto;font-size:12px;line-height:1.2;padding:6px}}
          @media(min-width:720px) and (max-width:900px) and (orientation:portrait){.wr-greenway-objective{position:relative;right:auto;top:192px;margin:0 16px 0 auto}.wr-surface:has(.wr-greenway-objective) .wr-saved-work-panel{position:relative;right:auto;top:200px;display:table;margin:0 16px 0 auto}}
          @media(max-width:719px){.wr-greenway-objective{position:relative;right:auto;top:156px;width:min(320px,calc(100% - 16px));margin:0 8px 0 auto}.wr-surface:has(.wr-greenway-objective) .wr-saved-work-panel{position:relative;right:auto;top:164px;display:table;margin:0 8px 0 auto}[data-public-v23]:has(.wr-surface[data-work-mode="true"]) .v23-save{top:8px}[data-public-v23]:has(.v23-save) .wr-surface[data-work-mode="true"] .wr-saved-work-panel{max-height:calc(100% - 296px)}}
          @media(max-width:719px){.wr-v34-quest{width:min(320px,calc(100% - 204px));max-height:136px}}
          @media(max-width:719px){.wr-v35-quest{width:min(320px,calc(100% - 16px));max-height:54px;padding:3px 8px}.wr-v35-quest .wr-v35-mobile-toggle{display:block;min-height:44px;margin:0;text-align:left;padding:6px 8px}.wr-v35-quest[data-expanded="false"] .wr-v35-quest-content{display:none}.wr-hud:has(.wr-v35-quest[data-expanded="true"]){z-index:10}.wr-v35-quest[data-expanded="true"]{position:absolute;left:8px;right:8px;top:64px;width:auto;max-height:min(360px,calc(100% - 80px));margin:0;padding:8px 10px;background:#101a17f8;box-shadow:0 20px 50px #000c}.wr-v35-quest[data-expanded="true"] .wr-v35-mobile-toggle{position:sticky;top:0;z-index:1;margin-bottom:8px}}
          @media(max-width:719px){.wr-v35-quest[data-expanded="false"]{position:absolute;left:220px;right:auto;top:122px;width:min(116px,calc(100% - 228px));max-height:44px;margin:0;padding:0;border:0}}
          @media(max-width:360px) and (max-height:600px){.wr-surface:has(.wr-greenway-objective) .wr-saved-work-panel{margin:0 auto 0 8px}[data-public-v23]:has(.wr-greenway-objective) .v23-guide{display:none}}
        `}</style>
        {!workMode && journalQuest && <section className="wr-greenway-objective wr-v35-quest"
          data-expanded={ledgerOpen} aria-label={`Quest journal: ${journalQuest.title}`}>
          <button type="button" className="wr-v35-mobile-toggle" aria-expanded={ledgerOpen}
            aria-label={ledgerOpen ? 'Close quest journal' : hallQuest
              ? `Open quest journal: ${hallQuest.title}, ${hallQuest.next}. ${hallQuest.status}`
              : `Open quest journal: ${journalQuest.title}`}
            aria-controls="wr-v35-journal-content"
            onKeyDown={(event) => { if (event.code === 'Space') event.stopPropagation() }}
            onClick={() => setLedgerOpen((open) => !open)}>
            {ledgerOpen ? 'Close quest journal ×' : hallQuest && hall ? <>
              <span>HP {hall.health} · W {hall.wardHealth}</span>
              <small>{hall.phase === 'windup'
                ? `Slam ${Math.max(0, hall.phaseUntilTick - projection.tick)}t ▾`
                : hall.phase === 'recovery' ? 'Ward recovering ▾' : 'Iron Hall ▾'}</small>
            </>
              : ringkeeperQuest || waystationQuest ? 'Quests ▾' : 'Quest ▾'}
          </button>
          <div id="wr-v35-journal-content" className="wr-v35-quest-content">
          <strong>{journalQuest.complete ? 'Quest complete' : 'Quest'}: {journalQuest.title}</strong>
          <small>{journalQuest.objective}</small>
          {ledgerQuestPrimary && projection.v35LedgerSurvey && <>
            <button type="button" disabled={savePaused || !!projection.v35LedgerSurvey.rejection}
              onClick={() => onIntent({ type: 'v35.ledger.survey',
                bridgeId: projection.v35LedgerSurvey!.bridgeId })}>Survey connected-river exit</button>
            {projection.v35LedgerSurvey.hint && <small role="status">{projection.v35LedgerSurvey.hint}</small>}
          </>}
          {ledgerQuestPrimary && projection.v35LedgerDeliver && <>
            <button type="button" disabled={savePaused || !!projection.v35LedgerDeliver.rejection}
              onClick={() => onIntent({ type: 'v35.ledger.deliver' })}>Deliver stone to Outfitters</button>
            {projection.v35LedgerDeliver.hint && <small role="status">{projection.v35LedgerDeliver.hint}</small>}
          </>}
          {markerQuestPrimary && projection.v36MarkerClaim && <>
            <button type="button" disabled={savePaused || !!projection.v36MarkerClaim.rejection}
              onClick={() => onIntent({ type: 'v36.marker.claim' })}>Claim Old Marker reward</button>
            {(projection.v36MarkerClaim.hint || projection.v36MarkerClaim.rejection) &&
              <small role="status">{projection.v36MarkerClaim.hint ?? publicV36MarkerRejectionMessage(projection.v36MarkerClaim.rejection!)}</small>}
          </>}
          {signalQuestPrimary && signalQuest && !signalQuest.complete && <>
            {signalQuest.stage === 'vane' && <>
              <button type="button" disabled={savePaused || !!signalQuest.inspect.rejection}
                onClick={() => onIntent({ type: 'v38.signal.inspect' })}>Inspect signal vane</button>
              {(signalQuest.inspect.hint || signalQuest.inspect.rejection) && <small role="status">
                {signalQuest.inspect.hint ?? 'The checked inspection is not ready yet.'}</small>}
            </>}
            {signalQuest.stage === 'return' && <>
              <button type="button" disabled={savePaused || !!signalQuest.claim.rejection}
                onClick={() => onIntent({ type: 'v38.signal.claim' })}>Claim Highland Signal reward</button>
              {(signalQuest.claim.hint || signalQuest.claim.rejection) && <small role="status">
                {signalQuest.claim.hint ?? 'The checked reward is not ready yet.'}</small>}
            </>}
          </>}
          {hallQuest && hall && <details className="wr-ironhall-chapter"
            data-phase={hall.phase} aria-label={`Quest chapter: ${hallQuest.title}`}>
            <summary>{hallQuest.title} · {hallQuest.next}
              <small>{hallQuest.status}</small></summary>
            <p>{hallQuest.objective}</p>
            {!hall.learnedBolt && nearHallAlcove && <>
              <button type="button" disabled={savePaused || !!hall.study.rejection}
                onClick={() => onIntent({ type: 'v41.ironhall.study' })}>Study Arc Bolt</button>
              {ironHallActionHint(hall.study) && <small role="status">{ironHallActionHint(hall.study)}</small>}
            </>}
            {hall.learnedBolt && !hall.wardDefeated && hall.phase === 'dormant' && nearHallWard && <>
              <button type="button" disabled={savePaused || !!hall.engage.rejection}
                onClick={() => onIntent({ type: 'v41.ironhall.engage' })}>Engage clockwork ward</button>
              {ironHallActionHint(hall.engage) && <small role="status">{ironHallActionHint(hall.engage)}</small>}
            </>}
            {!hall.wardDefeated && hall.phase !== 'dormant' && nearHallWard && <>
              <button type="button" disabled={savePaused || !!hall.bolt.rejection}
                onClick={() => onIntent({ type: 'v41.ironhall.bolt' })}>Cast Arc Bolt</button>
              <button type="button" disabled={savePaused || !!hall.guard.rejection}
                onClick={() => onIntent({ type: 'v41.ironhall.guard' })}>Guard next slam</button>
              {ironHallActionHint(hall.bolt) && <small role="status">Arc Bolt: {ironHallActionHint(hall.bolt)}</small>}
              {ironHallActionHint(hall.guard) && <small role="status">Guard: {ironHallActionHint(hall.guard)}</small>}
            </>}
            {hall.health < 12 && (hall.phase === 'dormant' || hall.phase === 'defeated')
              && nearHallAlcove && <>
              <button type="button" disabled={savePaused || !!hall.rest.rejection}
                onClick={() => onIntent({ type: 'v41.ironhall.rest' })}>Rest at the alcove</button>
              {ironHallActionHint(hall.rest) && <small role="status">{ironHallActionHint(hall.rest)}</small>}
            </>}
          </details>}
          {waystationQuest && <details className="wr-waystation-chapter"
            aria-label={`Quest chapter: ${waystationQuest.title}`}>
            <summary>{waystationQuest.title} · {WAYSTATION_NEXT[waystationQuest.stage]}</summary>
            <p>{waystationQuest.objective}</p>
            <p>{waystationQuest.reward}</p>
            {waystationQuest.stage === 'choose-materials' && waystationQuest.barter.rejection !== 'already_bartered'
              && projection.v40WaystationSite &&
              Math.hypot(projection.player.position[0] - projection.v40WaystationSite.approach[0],
                projection.player.position[2] - projection.v40WaystationSite.approach[2]) < 8 && <>
              <button type="button" disabled={savePaused || !!waystationQuest.barter.rejection}
                onClick={() => onIntent({ type: 'v40.waystation.barter' })}>Barter 2 stone for 8 logs</button>
              {(waystationQuest.barter.hint || waystationQuest.barter.rejection) && <small role="status">
                {waystationQuest.barter.hint ?? publicV40WaystationRejectionHint(waystationQuest.barter.rejection!)}</small>}
            </>}
            {waystationQuest.stage === 'cross' && projection.v40WaystationSite &&
              Math.hypot(projection.player.position[0] - projection.v40WaystationSite.exit[0],
                projection.player.position[2] - projection.v40WaystationSite.exit[2]) < 8 && <>
              <button type="button" disabled={savePaused || !!waystationQuest.cross.rejection}
                onClick={() => onIntent({ type: 'v40.waystation.cross' })}>Record south-bank crossing</button>
              {(waystationQuest.cross.hint || waystationQuest.cross.rejection) && <small role="status">
                {waystationQuest.cross.hint ?? publicV40WaystationRejectionHint(waystationQuest.cross.rejection!)}</small>}
            </>}
            {waystationQuest.stage === 'return' && projection.stores.some((store) =>
              store.id === 'store-greenway' && Math.hypot(projection.player.position[0] - store.position[0],
                projection.player.position[2] - store.position[2]) < 8) && <>
              <button type="button" disabled={savePaused || !!waystationQuest.claim.rejection}
                onClick={() => onIntent({ type: 'v40.waystation.claim' })}>Claim Waystation reward</button>
              {(waystationQuest.claim.hint || waystationQuest.claim.rejection) && <small role="status">
                {waystationQuest.claim.hint ?? publicV40WaystationRejectionHint(waystationQuest.claim.rejection!)}</small>}
            </>}
          </details>}
          {ringkeeperQuest && <details className="wr-ringkeeper-chapter"
            aria-label={`Quest chapter: ${ringkeeperQuest.title}`}>
            <summary>{ringkeeperQuest.title} · {RINGKEEPER_NEXT[ringkeeperQuest.stage]}</summary>
            <p>{ringkeeperQuest.objective}</p>
            <p>{ringkeeperQuest.reward}</p>
            {ringkeeperQuest.stage === 'find' && projection.v39QuarryRing && <>
              <button type="button" disabled={savePaused || !!ringkeeperQuest.discover.rejection}
                onClick={() => onIntent({ type: 'v39.ring.discover' })}>Discover Highland Quarry ring</button>
              {(ringkeeperQuest.discover.hint || ringkeeperQuest.discover.rejection) && <small role="status">
                {ringkeeperQuest.discover.hint ?? 'Move beside the revealed ring on dry ground.'}</small>}
            </>}
            {ringkeeperQuest.stage === 'link' && <>
              <button type="button" disabled={savePaused || !!ringkeeperQuest.link.rejection}
                onClick={() => onIntent({ type: 'v39.ring.link' })}>Link Highland Quarry ring</button>
              {(ringkeeperQuest.link.hint || ringkeeperQuest.link.rejection) && <small role="status">
                {ringkeeperQuest.link.hint ?? 'Move beside the revealed Greenway ring.'}</small>}
            </>}
            {ringkeeperQuest.stage === 'claim' && <>
              <button type="button" disabled={savePaused || !!ringkeeperQuest.claim.rejection}
                onClick={() => onIntent({ type: 'v39.ring.claim' })}>Claim Ringkeeper reward</button>
              {(ringkeeperQuest.claim.hint || ringkeeperQuest.claim.rejection) && <small role="status">
                {ringkeeperQuest.claim.hint ?? 'Return to the revealed Greenway ring.'}</small>}
            </>}
          </details>}
          <details><summary>Rewards and completed chapters</summary>
            <p>{journalQuest.reward}</p>
            {projection.v35LedgerQuest?.complete && !ledgerQuestPrimary && <p>{projection.v35LedgerQuest.title}: {projection.v35LedgerQuest.objective} {projection.v35LedgerQuest.reward}</p>}
            {projection.v34Quest?.complete && journalQuest.id !== projection.v34Quest.id && <p>{projection.v34Quest.title}: {projection.v34Quest.objective}</p>}
            {projection.v36MarkerQuest?.complete && !markerQuestPrimary && <p>{projection.v36MarkerQuest.title}: {projection.v36MarkerQuest.objective} {projection.v36MarkerQuest.reward}</p>}
            {signalQuest && !signalQuestPrimary && <p>Optional: {signalQuest.title}. {signalQuest.objective} {signalQuest.reward}</p>}
          </details>
          </div>
        </section>}
        {!workMode && !journalQuest && projection.v34Quest && <details className="wr-greenway-objective wr-v34-quest"
          aria-label="Quest journal: The Surveyor's First Find">
          <summary onKeyDown={(event) => { if (event.code === 'Space') event.stopPropagation() }}>
            <strong>{projection.v34Quest.complete ? 'Quest complete' : 'Quest'}: {projection.v34Quest.title}</strong>
            <small>{projection.v34Quest.objective}</small></summary>
          <p><strong>Rewards and progress:</strong> {projection.v34Quest.reward}</p>
        </details>}
        {!workMode && !journalQuest && !projection.v34Quest && <div className="wr-greenway-objective" role="note" aria-label="Greenway field objective">
          <strong>Field objective:</strong> {greenwayObjective}
          <small>{mining
            ? 'Optional digging: Outfitters sells a spade for soil and picks for deeper layers. Sell terrain-bag materials to free pack space. River and cliff routes still require marked Ready Works.'
            : v27Terrain
            ? 'Check Works for marked Ready crossings; not every river bank is buildable. Equip a spade to select Dig, then tap revealed dry ground in reach.'
            : v25NorthLadder
            ? v26Terrain ? 'Dig or Fill nearby revealed ground with the spade terrain controls.'
              : 'Far-bank Dig remains optional in Works; it yields stone and Excavation XP.'
            : greenwayBridgeBuilt && !savedWorks?.dugTileIds.length
            ? v26Terrain ? 'Terrain Dig/Fill is separate from Works and checks each tapped cell.'
              : 'Dig yields one stone and 30 Excavation XP; sell at Outfitters.'
            : !greenwayLadderNext && (greenwayLadderBuilt
              ? 'North cliff Ladder built: climb its rungs to the upper ledge.'
              : 'North cliff Ladder: 4 logs, B, 2, aim, F; climb rungs to the upper ledge.')}
            {' '}{projection.gait?.canRun ? `Boots: ${projection.gait.pace} now; R or Walk/Run toggles pace.`
              : projection.equipment.feet?.itemId === 'leather_boots'
                ? 'Boots equipped; run is default, R or Walk/Run toggles pace.'
                : 'Barefoot walks; boots run by default, R toggles walk.'}</small>
        </div>}
      </>}

      {savedWorks && <WizardWorksFocusBoundary active={works4Greenway} expanded={workMode}>
      <aside className="wr-panel wr-saved-work-panel" aria-label="Saved terrain works"
        style={works4Greenway && !workMode ? { width: 'auto', minWidth: 0, maxHeight: 'none', padding: 5 } : undefined}>
        {(workMode || !works4Greenway) && builtWorksLadders.map((site) => <p key={site.id} className="wr-caption" role="note">
          Built Works north cliff ladder, separate from the authored x 0 route: lower foot x {Number(site.from.x.toFixed(1))}, z {Number(site.from.z.toFixed(1))}; upper foot x {Number(site.to.x.toFixed(1))}, z {Number(site.to.z.toFixed(1))}. Rails center on x {Number(site.supportPath[1].x.toFixed(1))} from z {Number(site.supportPath[1].z.toFixed(2))} to {Number(site.supportPath[2].z.toFixed(2))} (width {site.widthMeters} m). Approach the lower foot from the south, align between these rails, face north and walk with W to climb; S descends from the upper foot.
        </p>)}
        <button type="button" style={{ ...FIELD_ACTION_STYLE, width: '100%' }}
          disabled={savePaused || !savedWorks.actionsEnabled}
          aria-label={workMode ? 'Close Works mode' : 'Open Works mode'} aria-pressed={workMode}
          aria-expanded={works4Greenway ? workMode : undefined}
          onClick={() => onIntent({ type: 'saved-work.mode', active: !workMode })}>
          Works {workMode ? 'On' : 'Off'} · B
        </button>
        {workMode && <div role="group" aria-label="Choose saved work kind" style={{ display: 'grid', gridTemplateColumns: `repeat(${v26Terrain ? 2 : 3},1fr)`, gap: 4 }}>
          {(['bridge', 'ladder', 'dig'] as const).filter((kind) =>
            (!starterGreenwayWorks || kind !== 'ladder') && (!v26Terrain || kind !== 'dig')).map((kind) => <button key={kind} type="button"
            style={FIELD_ACTION_STYLE} disabled={savePaused || !savedWorks.actionsEnabled}
            aria-label={`Choose ${kind}`} aria-pressed={savedWorks.selectedKind === kind}
            onClick={() => onIntent({ type: 'saved-work.kind', kind })}>{kind}</button>)}
        </div>}
        {workMode && works4Greenway && <p className="wr-work-selection" role="status" aria-label="Selected Works status">
          {aimedWork ? <>Selected {workName(aimedWork.site.kind)} · {workLocation(projection.player.position, aimedWork.site)} · {aimedWork.site.kind === 'dig' ? 'field spade + one free bag slot' : `${aimedWork.site.logCost} logs`} · {savePaused ? 'Saved Works paused; check the save status.' : workReason(aimedWork)}</>
            : <>{savedWorks.selectedKind === 'bridge' ? 'Bridge · 8 logs' : savedWorks.selectedKind === 'ladder' ? 'Ladder · 4 logs' : savedWorks.selectedKind === 'dig' ? 'Dig · field spade + one free bag slot' : 'Choose a work type'} · No site selected. Aim at a discovered site to check Ready.</>}
        </p>}
        {workMode && <p className="wr-caption">{v28River
          ? '1 Bridge · F confirm · Esc cancel. On touch: tap a marked river crossing, then Confirm when Ready.'
          : v26Terrain
          ? '1 Bridge · 2 Ladder · F confirm · Esc cancel. Dig/Fill: equip spade, use Terrain tools, tap ground.'
          : starterGreenwayWorks
          ? '1 Bridge · 3 Dig · F confirm · Esc cancel'
          : '1 Bridge · 2 Ladder · 3 Dig · F confirm · Esc cancel'}</p>}
        {workMode && works4Greenway && savedWorks?.selectedKind !== 'dig' && <div
          className="wr-caption" role="group" aria-label="Move structure aim"
          style={{ display: 'grid', gap: 4 }}>
          <label htmlFor="wizard-work-aim">Place along {savedWorks?.selectedKind === 'ladder'
            ? 'north cliff' : 'south creek'} · {savedWorks?.aimX === null
              || savedWorks?.aimX === undefined ? 'avatar facing; slider is not applied'
              : `x ${Number(savedWorks.aimX.toFixed(1))} m`}</label>
          <input id="wizard-work-aim" type="range"
            aria-label="Structure position along obstacle"
            style={{ minHeight: 44, width: '100%', touchAction: 'none' }}
            min={savedWorks?.selectedKind === 'ladder' ? -29.4 : -9.1}
            max={savedWorks?.selectedKind === 'ladder' ? 29.4 : 9.1}
            step={0.1}
            value={Math.max(savedWorks?.selectedKind === 'ladder' ? -29.4 : -9.1,
              Math.min(savedWorks?.selectedKind === 'ladder' ? 29.4 : 9.1,
                savedWorks?.aimX ?? projection.player.position[0]))}
            disabled={savePaused || !savedWorks?.actionsEnabled}
            onChange={(event) => onIntent({ type: 'saved-work.aim',
              aimX: Number(event.currentTarget.value) })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <button type="button" style={FIELD_ACTION_STYLE}
              disabled={savePaused || !savedWorks?.actionsEnabled || !nearestSuggestedWork}
              aria-label="Nearest discovered site"
              onClick={() => { if (nearestSuggestedWork) onIntent({ type: 'saved-work.aim', aimX: nearestSuggestedWork.from.x }) }}>
              Nearest discovered site
            </button>
            <button type="button" style={FIELD_ACTION_STYLE}
              disabled={savePaused || !savedWorks?.actionsEnabled}
              aria-label="Use avatar facing"
              onClick={() => onIntent({ type: 'saved-work.aim', aimX: null })}>
              Use avatar facing
            </button>
          </div>
          {!nearestSuggestedWork && <small role="note">{mining && works4Greenway && savedWorks.selectedKind === 'bridge'
            ? 'Walk south on dry ground toward South creek to reveal both banks. Then look for a marked crossing and use Nearest discovered site. The north cliff ladder is the first route west.'
            : `No discovered ${savedWorks.selectedKind ?? 'matching work'} site to aim at. Explore to reveal one, or use the slider to aim manually.`}</small>}
        </div>}
        {workMode && v28River && savedWorks.selectedKind === 'bridge' && <button type="button" style={FIELD_ACTION_STYLE}
          disabled={savePaused || !savedWorks.actionsEnabled || !nearestSuggestedWork}
          aria-label="Aim nearest discovered connected-river crossing"
          onClick={() => { if (nearestSuggestedWork) onIntent({ type: 'saved-work.aim', aimX: nearestSuggestedWork.from.x }) }}>
          Aim nearest discovered crossing
        </button>}
        {!works4Greenway && <p className="wr-caption" role="status">{v28River
          ? workMode ? nextSavedWork
            ? `${workName(nextSavedWork.site.kind)}: ${workReason(nextSavedWork)} ${nextSavedWork.benefit}`
            : workPreview?.guidance ?? 'Aim at a marked connected-river crossing from its dry source bank.'
            : projection.map.guidance ?? 'Open Works to inspect a supported connected-river crossing.'
          : v26Terrain && workMode && savedWorks.selectedKind === 'dig'
          ? 'Choose Bridge or Ladder in Works, or close Works to use spade Dig/Fill in Terrain tools.'
          : workMode && greenwayWorks
          ? starterWork
            ? starterWorkComplete
              ? `${workName(starterWork.site.kind)} complete. ${projection.map.guidance ?? 'Check the map for your next route.'}`
              : `${(works3Greenway || works4Greenway) && aimedWork ? 'Selected ' : ''}${workName(starterWork.site.kind)} · ${workLocation(projection.player.position, starterWork.site)} · ${starterWork.benefit} ${savePaused ? 'Saved Works paused; check the save status.' : `${aimedWork ? '' : 'Face the site to aim. '}${workReason(starterWork)}`}`
            : v26Terrain ? workPreview?.guidance ?? 'Choose Bridge or Ladder in Works, or close Works for spade Dig/Fill.'
              : workPreview?.guidance ?? projection.map.guidance ?? 'Explore south to discover the creek crossing.'
          : savedWorks.actionsEnabled && !workMode && (works3Greenway || works4Greenway)
          ? v26Terrain ? 'Works builds bridges and ladders. Equip a spade for Terrain Dig/Fill.' : projection.map.guidance
          : savedWorks.actionsEnabled
          ? nextSavedWork ? `${workName(nextSavedWork.site.kind)}: ${workReason(nextSavedWork)} ${nextSavedWork.benefit}`
            : nearbyUnaimedWork ? `Turn toward the ${workName(nearbyUnaimedWork.site.kind).toLowerCase()} to aim before confirming. ${nearbyUnaimedWork.benefit}`
            : workMode && v26Terrain ? 'Choose Bridge or Ladder; use spade Terrain tools for Dig/Fill.'
              : workMode ? greenwayWorks
              ? works3Greenway || works4Greenway
                ? 'Explore the creek, north cliff, and far-bank loam, then face a discovered site.'
                : 'Explore the creek crossing and far-bank dig patch, then face a discovered site.'
              : 'Explore discovered Fen channels, Slate cliffs, or loam; choose a work type to preview a site.'
              : greenwayWorks
                ? v26Terrain ? 'Press B or tap Works for Bridge or Ladder; use spade Terrain tools for Dig/Fill.'
                : works3Greenway || works4Greenway
                  ? 'Press B or tap Works to preview Greenway Bridge, Ladder, or Dig.'
                  : 'Press B or tap Works to preview the creek Bridge or far-bank Dig.'
                : 'Press B or tap Works to preview Bridge, Ladder, or Dig.'
          : savePaused ? 'Saved Works paused. Check the save status; changing sites will not enable building or digging.'
            : greenwayWorks
              ? v26Terrain ? 'Works builds creek bridges and cliff ladders; spade Terrain tools change ground.'
                : works3Greenway || works4Greenway
                ? 'Greenway Works include creek bridges, cliff ladders, and far-bank digs. Gather logs or equip a spade.'
                : 'Starter Works are near the south creek. Gather logs, then use Bridge; a spade enables Dig across it.'
              : 'Works start in Mireglass. Follow the ⇦ west trail, then choose Bridge, Ladder, or Dig at discovered ground.'}</p>}
        {unbuiltRoutePreview && <p className="wr-caption" role="note">
          Placement preview only. Confirm the build before crossing or climbing.
        </p>}
        {workMode && starterGreenwayWorks && <p className="wr-caption">
          South creek bridge: an 8-log deck across water. North cliff ladder: rungs to the upper ledge,
          a separate starter route, not a Works kind. Far-bank dig: lower loam for stone and 30 Excavation XP;
          own and equip a field spade, keep one backpack slot free, then sell stone at Greenway Outfitters.
        </p>}
        {workMode && v26Terrain && <p className="wr-caption">
          {v28River
            ? 'This connected-river bridge needs 8 logs, a fully revealed dry approach, wet span, and far exit, plus a grounded stance in its marked source-bank cell. Not every bank supports a bridge. Dig on checked dry ground or refill an open pit with the equipped spade in Terrain tools.'
            : 'Works builds bridges and ladders. For Dig or Fill, close Works, equip the field spade, choose a Terrain tool, and tap nearby revealed dry ground. The checked action decides whether the target is valid.'}
        </p>}
        {workMode && !v26Terrain && (works3Greenway || works4Greenway) && <p className="wr-caption">
          Bridge: south creek deck to the far bank, 8 logs; B, 1, aim at a discovered dry crossing, F.
          Ladder: north cliff rungs to the upper ledge, 4 logs; B, 2, aim at a discovered clear face, F.
          Dig: revealed dry far-bank loam; equip a field spade, free one bag slot, stand beside the patch within 4 m, not on it; then B, 3, F.
          Earn one stone and 30 Excavation XP; sell the stone at Greenway Outfitters.
        </p>}
        {workMode && <div className="wr-saved-work-actions">
          {savedWorks.actionsEnabled && aimedWork && !starterWorkComplete && <button type="button"
            style={{ ...FIELD_ACTION_STYLE, width: '100%' }} disabled={savePaused || aimedWork.rejection !== null}
            aria-label={works3Greenway || works4Greenway ? 'Confirm selected saved work' : 'Confirm aimed saved work'}
            onClick={() => onIntent({ type: 'saved-work.confirm', id: aimedWork.site.id })}>
            Confirm {workName(aimedWork.site.kind)}
          </button>}
          <button type="button" style={{ ...FIELD_ACTION_STYLE, width: '100%' }}
            aria-label="Cancel Works mode"
            onClick={() => onIntent({ type: 'saved-work.mode', active: false })}>Cancel</button>
        </div>}
        {!workMode && !works4Greenway && !v28River && <details>
          <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            Works details · {workPreview?.nearby.length ?? 0} nearby
          </summary>
          <p className="wr-caption">Nearby saved works: {savedWorks.builtSites.length} {starterGreenwayWorks ? 'bridge' : 'bridges or ladders'}, {savedWorks.dugTileIds.length} dug cells.</p>
          <p className="wr-caption">{starterGreenwayWorks
            ? 'Bridge: spend 8 logs to cross the creek near spawn. Dig: equip an owned field spade on the far bank to gain one stone and 30 XP. The separate starter ladder climbs a cliff.'
            : works3Greenway || works4Greenway
              ? 'Bridge: cross a Greenway creek with 8 logs. Ladder: climb a clear north cliff with 4 logs. Dig: lower far-bank loam with an equipped spade for stone and XP.'
            : 'Bridge: cross a Fen channel with logs. Ladder: climb a Slate cliff with logs. Dig: lower loam with an equipped spade, gain stone for a camp.'}</p>
          <p className="wr-caption" role="status">{savedWorks.actionsEnabled
            ? workMode ? works3Greenway || works4Greenway
              ? 'Choose a work type, approach a discovered site until Ready, then confirm the selected preview.'
              : 'Choose a work type, face a discovered site, then confirm the aimed preview.'
              : 'Open Works, then choose a work type and face a discovered site.'
            : savePaused ? 'Construction and digging are paused while the save is not ready. Aim previews do not spend materials or change the save.'
              : greenwayWorks
                ? works3Greenway || works4Greenway
                  ? 'Explore Greenway to reveal a creek bridge, clear cliff ladder, or dry dig patch.'
                  : 'Explore the south creek to reveal the starter bridge; cross it to find the dig patch.'
                : 'Follow the west trail into Mireglass to unlock saved Bridge, Ladder, and Dig previews.'}</p>
          {savedWorks.actionsEnabled && workPreview?.nearby.length === 0 && <p className="wr-caption">
            {greenwayWorks
              ? works3Greenway || works4Greenway
                ? 'No discovered site is within 16 m. Explore the creek, north cliff, or far bank.'
                : 'No discovered site is within 16 m. Walk south to the creek or cross the built bridge for the far-bank dig.'
              : 'No discovered site is within 16 m. Explore the Fen for bridges, Slate cliffs for ladders, or loam for digging. New sites appear here as you uncover them.'}
          </p>}
          {workPreview?.guidance && <p className="wr-caption" role="note">{workPreview.guidance}</p>}
          {workPreview?.nearby.map((choice) => <div key={choice.site.id} className="wr-caption">
            <b>{workName(choice.site.kind)}</b> · {workLocation(projection.player.position, choice.site)}<br />
            {choice.benefit}<br />{workReason(choice)}
          </div>)}
          {aimedWork && <p className="wr-caption" role="status">{works3Greenway || works4Greenway ? 'Selected' : 'Aiming at'} {workName(aimedWork.site.kind)}{works3Greenway || works4Greenway ? ` · ${workLocation(projection.player.position, aimedWork.site)}` : ''}: {workReason(aimedWork)}</p>}
        </details>}
      </aside>
      </WizardWorksFocusBoundary>}

      {trial && !savedWorks && !legacyActionsUnavailable && <aside className="wr-panel wr-trial-panel" aria-label="Unsaved terrain-work trial">
        <header>Local works <small>Unsaved</small></header>
        <p className="wr-caption">Kit: {trial.kit.logs} logs · {trial.kit.stone} stone · spade {trial.kit.spadeEquipped ? 'ready' : 'not equipped'} · {trial.kit.xp} XP</p>
        <button type="button" style={{ ...FIELD_ACTION_STYLE, width: '100%' }}
          disabled={savePaused}
          aria-label={trial.bootsEquipped ? 'Remove trial boots' : 'Equip trial boots'}
          onClick={() => onIntent({ type: 'trial-footwear.toggle' })}>
          {trial.bootsEquipped ? 'Remove trial boots' : 'Equip trial boots'}
        </button>
        <p className="wr-caption">{trial.bootsEquipped
          ? 'Trial boots allow running by default; press R or Walk to switch pace. Remove them to walk barefoot again.'
          : 'Barefoot means walking only. Equip unsaved trial boots to run by default.'} No boots are purchased or kept in this sample.</p>
        <p className="wr-caption">Find a discovered site on the map, approach until Ready, then press E or Confirm. A bridge crosses shallow Fen water; a ladder climbs the slate cliff; digging lowers loam and grants 1 stone plus 30 Excavation XP. Stone helps build a field camp in the full game. This sample resets on reload.</p>
        {builtLadder && <p className="wr-caption">
          <b>Built Slate ladder:</b> From lower foot x {builtLadder.from.x}, z {builtLadder.from.z},
          face {climbDirection}, then move forward with W to climb. From upper foot x {builtLadder.to.x},
          z {builtLadder.to.z}, face {descendDirection}, then move forward with W to descend.
          Stay centered near {builtLadder.from.z === builtLadder.to.z ? 'z' : 'x'}{' '}
          {builtLadder.from.z === builtLadder.to.z ? builtLadder.from.z : builtLadder.from.x}
          {' '}(ladder width {builtLadder.widthMeters} m).
        </p>}
        <nav aria-label="Restart unsaved terrain-work trial">
          <p className="wr-caption">Separate samples, not one continuous route. Each restart reloads and resets all UNSAVED works. The 12-log kit cannot build two eight-log bridges.</p>
          {([['bridge', '?devRegion=streamed&trial=works'], ['ladder', '?devRegion=streamed&trial=works&spawn=works-ladder'],
            ['dig', '?devRegion=streamed&trial=works&spawn=works-dig']] as const).map(([kind, href]) =>
            <a key={kind} href={href} style={{ ...FIELD_ACTION_STYLE, boxSizing: 'border-box', display: 'block', marginTop: 5, textDecoration: 'none' }}>Restart at {kind} (UNSAVED reset)</a>)}
        </nav>
        <div role="group" aria-label="Nearby discovered work sites">
          {trial.candidates.map(({ site, rejection }) => <button key={site.id} type="button"
            style={{ ...FIELD_ACTION_STYLE, display: 'grid', width: '100%', minHeight: 44, marginTop: 5, textAlign: 'left' }}
            disabled={savePaused}
            aria-pressed={trial.selectedId === site.id}
            aria-label={`Select ${workName(site.kind)} ${site.id}`}
            onClick={() => onIntent({ type: 'terrain-work.select', id: site.id })}>
            <b>{workName(site.kind)} · {site.kind === 'dig' ? '+1 stone, 30 Excavation XP, lowered ground' : `${site.logCost} logs`}</b>
            {site.kind === 'ladder' && <small>Climbs {workClimbDirection(site)} to upper foot x {site.to.x}, z {site.to.z}</small>}
            <small>{workLocation(projection.player.position, site)} · {rejection ? WORK_REASONS[rejection] : 'Ready to work'}</small>
          </button>)}
          {trial.candidates.length === 0 && <p className="wr-caption" role="status">No discovered local work site nearby. Walk to reveal ground; sites appear within 16 m.</p>}
        </div>
        {selectedWork && <div role="status" className="wr-caption">
          <p>{workName(selectedWork.kind)}: {trial.selectedRejection ? WORK_REASONS[trial.selectedRejection] : 'Ready to work'}</p>
          <button type="button" style={{ ...FIELD_ACTION_STYLE, width: '100%', minHeight: 44 }}
            disabled={savePaused || !!trial.selectedRejection} onClick={() => onIntent({ type: 'terrain-work.confirm', id: selectedWork.id })}>
            Confirm {workName(selectedWork.kind)}
          </button>
          <button type="button" style={{ ...FIELD_ACTION_STYLE, width: '100%', minHeight: 44, marginTop: 5 }}
            disabled={savePaused}
            onClick={() => onIntent({ type: 'terrain-work.select', id: null })}>Cancel selection</button>
        </div>}
      </aside>}

      {!savePaused && bridgeheadClaim && <button className="wr-prompt" data-actionable="true"
        aria-label="Claim River Works bridgehead reward"
        onClick={() => onIntent({ type: 'v30.bridgehead.claim', bridgeId: bridgeheadClaim.bridgeId })}>
        <span><b>Claim River Works find</b>{bridgeheadClaim.reward === 'basic-pick'
          ? 'Basic mining pick, not auto-equipped. A field spade still digs soil.' : '35 coins.'}</span>
      </button>}
      {!savePaused && !legacyActionsUnavailable && nearbyAction?.actionable && (
        <button className="wr-prompt" data-actionable="true" onClick={() => onIntent(projection.highlandExtraction
          ? { type: 'highland.extract', nodeId: projection.highlandExtraction.nodeId } : { type: 'interact' })}>
          <kbd>E</kbd><span><b>{nearbyAction.action}</b>{nearbyAction.label}</span>
        </button>
      )}
      {nearbyAction && (savePaused || legacyActionsUnavailable || !nearbyAction.actionable) && (
        <div className="wr-prompt" data-actionable="false" role="status">
          <span><b>{savePaused ? 'Interaction paused for save' : legacyActionsUnavailable ? 'Interaction unavailable here' : nearbyAction.action}</b>{nearbyAction.label}</span>
        </div>
      )}

      <aside id="wizard-backpack" className="wr-panel wr-backpack">
        <header><span>Backpack</span><small>{usedCapacity}/{projection.backpack.capacity}</small></header>
        {mining && usedCapacity >= projection.backpack.capacity && <p className="wr-caption" role="note">
          Pack full. Use carried logs only at a marked Ready bridge or ladder. At Greenway Outfitters, sell terrain-bag soil, stone, or ore to free space. If you have soil, Fill can refill an open pit in reach.
        </p>}
        {!mining && v27Terrain && works4Greenway && usedCapacity >= projection.backpack.capacity && <p className="wr-caption" role="note">
          Pack full. A Ready ladder costs 4 logs; a Ready bridge costs 8. Use carried logs at a valid site or sell carried stone at Greenway Outfitters.
          {(projection.v26TerrainBag?.soil ?? 0) > 0 && ' Use Fill on an open pit in reach to refill it with carried soil.'}
          {' '}Excavated terrain-bag materials cannot be sold yet.
        </p>}
        {starterCliff && starterGreenwayWorks && <p className="wr-caption" role="note">
          {projection.map.guidance} The separate starter ladder climbs the north cliff. Barefoot travel is walking only; leather boots from Greenway Outfitters enable default running, then Walk/R toggles pace.
        </p>}
        {starterCliff && v28River && <p className="wr-caption" role="note">
          {projection.map.guidancePriority
            ? projection.map.guidance
            : savedWorks?.builtSites.some((site) => site.kind === 'bridge' && site.id.startsWith('works6:river-bridge:'))
            ? projection.map.guidance
            : greenwayLogs < 8
              ? `Connected-river bridge needs 8 logs; ${greenwayLogs} in your pack. Return to accessible Greenway oaks, then use a marked Ready dry-bank site.`
              : 'Connected-river bridge needs 8 logs; you have enough. Use a marked Ready dry-bank site.'}
          {' '}Equip a spade to Dig checked dry ground; deeper layers need a pick.
        </p>}
        {starterCliff && v27Terrain && !greenwayWorks && !v28River && projection.map.guidance
          && <p className="wr-caption" role="note">{projection.map.guidance}</p>}
        {starterCliff && !v27Terrain && !greenwayWorks && !v28River && <p className="wr-caption" role="note">Chop a nearby oak twice for 4 logs. {knownCliffFoot
          ? 'At the discovered cliff foot x 0, z -4, build the starter ladder.'
          : 'Find the Greenway cliff foot, then build the starter ladder.'} Face north: W climbs and S descends while centered. Buy leather boots at Greenway Outfitters, then equip them to run; use Walk to slow down.</p>}
        {!starterCliff && projection.fieldCamp && !campPreview && <section aria-label="Field camp" className="wr-caption">
          <b>Field camp: 4 logs + 1 stone</b>
          <p>{projection.fieldCamp.camps.length ? 'Field camp built. One camp per world.' : legacyActionsUnavailable ? 'Camp building is unavailable in this continuous preview.' : projection.fieldCamp.selectionEnabled ? 'Follow the frontier trail into inner Mireglass. Map marks suitable discovered camp ground.' : 'Explore Mireglass to choose a camp site.'}</p>
        </section>}
        {availableStore && <button type="button" style={{ ...FIELD_ACTION_STYLE, width: '100%', marginBottom: 8 }} disabled={savePaused} aria-label={`Open ${availableStore.name}`} onClick={() => onIntent({ type: 'store.open', storeId: availableStore.id })}>Open {availableStore.name}</button>}
        <section aria-label="Magic and skills" style={{ display: 'grid', gap: 5, marginBottom: 8 }}>
          {showGlow && <small className="wr-caption">Wayfinder Glow: {learnedGlow ? 'Learned' : 'Unknown'} · Excavation Lv{excavationLevel}</small>}
          {!starterCliff && projection.highlandExtraction && <>
            <button type="button" style={FIELD_ACTION_STYLE} disabled={savePaused || legacyActionsUnavailable || !projection.highlandExtraction.actionable}
              aria-label="Extract quarry stone"
              onClick={() => onIntent({ type: 'highland.extract', nodeId: projection.highlandExtraction!.nodeId })}>Extract quarry stone</button>
            <small className="wr-caption" role="status">{projection.highlandExtraction.reason}</small>
          </>}
          {showGlow && <><button type="button" style={FIELD_ACTION_STYLE} disabled={glowUnavailable} title={glowCheckedReason ?? undefined} aria-label="Cast Wayfinder Glow" onClick={() => onIntent({ type: 'spell.cast', spellId: 'wayfinder_glow' })}>Cast Wayfinder Glow</button>
            {glowCheckedReason && <small className="wr-caption" role="note">{glowCheckedReason}</small>}</>}
          {!starterCliff && windward && <>
            <button type="button" style={FIELD_ACTION_STYLE} disabled={!windwardActionable}
              aria-label={windward.learned ? 'Cast Windward Step' : 'Study Windward Step glyph'}
              onClick={() => onIntent(windwardAction)}>{windward.learned ? 'Cast Windward Step' : 'Study Windward Step'}</button>
            <small className="wr-caption">Windward Step: {windward.learned ? 'Learned. ' : 'Unknown. '}{windwardStatus}</small>
          </>}
          {!starterCliff && windward?.stoneReturn && <small className="wr-caption" role="status">
            {windward.stoneReturn.quantity} carried stone: {windward.stoneReturn.offers.map((offer) =>
              `${offer.name} ${offer.unitPrice}g each (${offer.total}g total)`).join('; ')}.
          </small>}
          {nearbyInscriptions.map((inscription) => <button key={inscription.id} type="button" style={FIELD_ACTION_STYLE} disabled={savePaused || legacyActionsUnavailable} aria-label={`Study ${inscription.name}`} onClick={() => onIntent({ type: 'inscription.study', inscriptionId: inscription.id })}>Study {inscription.name}</button>)}
          {nearbyDigSites.map((site) => {
            const unmetLevel = excavationLevel < site.minimumExcavationLevel
            return <div key={site.id}>
              <button type="button" style={{ ...FIELD_ACTION_STYLE, width: '100%' }} disabled={savePaused || legacyActionsUnavailable || !spadeEquipped || unmetLevel} aria-label={`Excavate ${site.name}`} onClick={() => onIntent({ type: 'dig-site.excavate', digSiteId: site.id })}>Excavate {site.name}</button>
              {(!spadeEquipped || unmetLevel) && <small className="wr-caption">{!spadeEquipped ? 'Equip a field spade' : `Excavation Lv${site.minimumExcavationLevel} required`}</small>}
            </div>
          })}
          <details className="wr-caption"><summary>Skills</summary>{Object.entries(SKILL_LABELS).map(([id, label]) => <div key={id}>{label}: Lv{1 + Math.floor(projection.skillXp[id as keyof typeof SKILL_LABELS] / 30)} ({projection.skillXp[id as keyof typeof SKILL_LABELS]} XP)</div>)}</details>
        </section>
        <div className="wr-list">
          {projection.backpack.stacks.map((stack) => {
            const starterEquipment = !starterCliff || stack.itemId === 'leather_boots'
              || stack.itemId === 'woodcutters_axe' || stack.itemId === 'field_spade'
            const equippedSlot = stack.equippableSlots?.find((slot) => projection.equipment[slot]?.id === stack.id)
            const targetSlot = stack.equippableSlots?.find((slot) => projection.equipment[slot] === null) ?? stack.equippableSlots?.[0]
            const equipped = equippedSlot !== undefined
            const unassignedCopies = stack.quantity - Object.values(projection.equipment).filter((item) => item?.id === stack.id).length
            const checkedEquip = projection.checkedEquipmentChoices?.find((choice) => choice.itemId === stack.itemId)
            const equipReason = projection.checkedEquipmentChoices && !checkedEquip?.actionable
              ? checkedEquip?.reason ?? 'This item has no checked Mireglass equip action.' : null
            return <div className="wr-item" key={stack.id}>
              <span className="wr-icon">{stack.icon ?? '◆'}</span><b>{stack.name}</b><small>×{stack.quantity}</small>
              {starterEquipment && stack.equippableSlots && stack.equippableSlots.length > 1
                ? <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, gridColumn: '2 / 3' }}>
                  {stack.equippableSlots.map((slot) => {
                    const wornHere = projection.equipment[slot]?.id === stack.id
                    if (!wornHere && unassignedCopies < 1
                      || starterCliff && wornHere && stack.itemId !== 'leather_boots') return null
                    const label = EQUIPMENT_SLOT_LABELS[slot]
                    return <button key={slot} type="button" style={{ minHeight: 44 }} disabled={savePaused || legacyActionsUnavailable || !!(wornHere ? projection.unsupportedEquipmentUnequipReason : equipReason)} title={wornHere ? projection.unsupportedEquipmentUnequipReason : equipReason ?? undefined} aria-pressed={wornHere} aria-label={`${wornHere ? 'Unequip' : 'Equip'} ${stack.name} ${wornHere ? 'from' : 'in'} ${label}`}
                      onClick={() => onIntent(wornHere ? { type: 'equipment.unequip', slot } : { type: 'equipment.equip', stackId: stack.id, slot })}>{wornHere ? `Unequip ${label}` : `Equip ${label}`}</button>
                  })}
                </span>
                : starterEquipment && targetSlot && (!starterCliff || !equipped || stack.itemId === 'leather_boots') && <button type="button" style={{ minHeight: 44 }} disabled={savePaused || legacyActionsUnavailable || !!(equipped ? projection.unsupportedEquipmentUnequipReason : equipReason)} title={equipped ? projection.unsupportedEquipmentUnequipReason : equipReason ?? undefined} aria-pressed={equipped} aria-label={equipped ? `Unequip ${stack.name}` : `Equip ${stack.name}`} onClick={() => onIntent(equippedSlot ? { type: 'equipment.unequip', slot: equippedSlot } : { type: 'equipment.equip', stackId: stack.id, slot: targetSlot })}>{equipped ? 'Unequip' : 'Equip'}</button>}
              {!equipped && equipReason && stack.equippableSlots && <small role="note">{equipReason}</small>}
              {!starterCliff && <button disabled={savePaused || legacyActionsUnavailable || firstTradeSlot < 0 || !!projection.unsupportedTradeListingsReason} title={projection.unsupportedTradeListingsReason} onClick={() => onIntent({ type: 'trade.create-listing', stackId: stack.id, slot: firstTradeSlot, quantity: 1, unitPrice: stack.suggestedTradePrice ?? 1 })}>List</button>}
            </div>
          })}
          {projection.backpack.stacks.length === 0 && <p className="wr-empty">Your pack is empty.</p>}
        </div>
        {excavatedMaterials.length > 0 && <section className="wr-caption" aria-label="Excavated materials">
          <b>Excavated materials</b>
          <p>{mining ? 'These count toward your backpack. Sell them at Greenway Outfitters.'
            : 'These count toward your backpack. Store sales are not available yet.'}</p>
          {excavatedMaterials.map(([material, quantity]) => <div key={material}>
            {material[0].toUpperCase() + material.slice(1).replaceAll('_', ' ')} ×{quantity}
          </div>)}
        </section>}
        {mining && <section className="wr-caption" aria-label="Mining tools">
          <b>Mining tools</b>
          <p>Spade works soil and refills an open pit with carried soil. Picks work deeper layers when your Excavation skill is high enough.</p>
          {mining.offers.filter((offer) => offer.owned).map((offer) => <button key={offer.tier}
            type="button" style={{ ...FIELD_ACTION_STYLE, width: '100%', marginTop: 5 }}
            disabled={savePaused || mining.tools.activePick === offer.tier}
            aria-label={`Equip ${offer.tier} pick`}
            onClick={() => onIntent({ type: 'v29.mining-tool', action: 'equip', tier: offer.tier })}>
            {offer.tier === 'basic' ? 'Basic' : 'Enchanted'} pick · {mining.tools.activePick === offer.tier ? 'Equipped' : 'Equip'}
          </button>)}
        </section>}
      </aside>

      <aside className="wr-panel wr-gear">
        <header>Equipment</header>
        {projection.unsupportedEquipmentUnequipReason && <p className="wr-caption" role="note">{projection.unsupportedEquipmentUnequipReason}</p>}
        <div className="wr-slot-grid">
          {EQUIPMENT_SLOTS.map((slot) => <div className="wr-slot" key={slot} data-slot={slot}>
            <small>{EQUIPMENT_SLOT_LABELS[slot]}</small><b>{slot === 'mainHand' && mining?.tools.activePick
              ? `${mining.tools.activePick === 'basic' ? 'Basic' : 'Enchanted'} pick (active)`
              : projection.equipment[slot]?.name ?? 'Empty'}</b>
            {projection.equipment[slot] && (!starterCliff || slot === 'feet' && projection.equipment[slot].itemId === 'leather_boots') && <button type="button" style={{ minHeight: 44, width: '100%' }} disabled={savePaused || legacyActionsUnavailable || !!projection.unsupportedEquipmentUnequipReason} title={projection.unsupportedEquipmentUnequipReason} aria-label={`Unequip ${projection.equipment[slot].name} from ${EQUIPMENT_SLOT_LABELS[slot]}`} onClick={() => onIntent({ type: 'equipment.unequip', slot })}>Unequip</button>}
          </div>)}
        </div>
      </aside>

      {!starterCliff && <aside className="wr-panel wr-trade">
        <header>Trade board</header>
        {projection.unsupportedTradeListingsReason && <p className="wr-caption" role="note">{projection.unsupportedTradeListingsReason}</p>}
        <div className="wr-trade-grid">
          {projection.tradeListings.map((listing, slot) => listing
            ? <button key={slot} disabled={savePaused || legacyActionsUnavailable || !!projection.unsupportedTradeListingsReason} title={projection.unsupportedTradeListingsReason} onClick={() => onIntent({ type: 'trade.cancel-listing', slot })}><b>{listing.itemName}</b><small>{listing.quantity} × {listing.unitPrice}g</small><em>Cancel</em></button>
            : <div className="wr-empty-slot" key={slot}>Open slot {slot + 1}</div>)}
        </div>
      </aside>}

      {selectedBuildSite && <aside className="wr-panel wr-context wr-build-preview" aria-label="Selected build site">
        <header>{starterCliff ? 'Starter cliff ladder' : projection.routes.find((route) => route.id === selectedBuildSite.routeId)?.label ?? 'Build route'}</header>
        <b>{selectedBuildSite.label}</b>
        <p className="wr-caption" role="status">{selectedBuildSite.logCost} logs · {savePaused ? 'Save paused; build is unavailable.' : selectedBuildSite.reason || 'Ready to build'}</p>
        <div className="wr-build-actions">
          <button type="button" disabled={savePaused || selectedBuildSite.status !== 'ready'} onClick={() => onIntent({ type: 'build-site.confirm', siteId: selectedBuildSite.id })}>Build</button>
          <button type="button" disabled={savePaused} onClick={() => onIntent({ type: 'build-site.select', siteId: null })}>Cancel</button>
        </div>
      </aside>}

      {campPreview && <aside className="wr-panel wr-context wr-build-preview" aria-label="Field camp preview" data-field-camp-panel="true">
        <header>Field camp<small>{campPreview.tileId}</small></header>
        <p className="wr-caption">4 logs + 1 stone · 30 construction XP</p>
        <p className="wr-caption" role="status">{savePaused ? 'Save paused; camp building is unavailable.' : campPreview.rejection?.message ?? (campPreview.position && projection.fieldCamp?.selectionEnabled ? 'Ready to build' : 'Camp placement is unavailable here.')}</p>
        <div className="wr-build-actions">
          <button type="button" disabled={savePaused || !projection.fieldCamp?.selectionEnabled || !campPreview.position || !!campPreview.rejection} onClick={() => onIntent({ type: 'field-camp.confirm', tileId: campPreview.tileId })}>Build</button>
          <button type="button" disabled={savePaused} onClick={() => onIntent({ type: 'field-camp.select', tileId: null })}>Cancel</button>
        </div>
      </aside>}

      {nearbyStore && !selectedBuildSite && !campPreview && <aside className="wr-panel wr-context" data-store-panel="true">
        <header>{nearbyStore.name}</header>
        <button type="button" disabled={savePaused} onClick={() => onIntent({ type: 'store.close' })}>Close</button>
        {nearbyStore.listings.filter((listing) => !starterCliff
          || listing.id === PUBLIC_V11_BOOTS_LISTING_ID && !starterHasBoots
          || listing.id === 'spade' && !starterHasSpade && (listing.stock ?? 0) > 0).map((listing) => {
          const reason = checkedReason(`mireglass:buy:${listing.id}`)
          return <div key={listing.id}><button type="button" disabled={savePaused || !!reason}
            title={reason ?? undefined} onClick={() => onIntent({ type: 'store.select-listing',
              storeId: nearbyStore.id, listingId: listing.id })}><b>{listing.name}</b>
            <span>{listing.price}g{listing.stock === undefined ? '' : ` · ${listing.stock} left`}</span>
          </button>{reason && <small className="wr-caption" role="note">{reason}</small>}</div>
        })}
        {mining && nearbyStore.id === 'store-greenway' && <section aria-label="V29 mining tools">
          <h3 className="wr-caption">Mining picks</h3>
          {mining.offers.map((offer) => <div key={offer.tier}>
            <button type="button" disabled={savePaused || offer.owned || !!offer.buyReason}
              title={offer.buyReason ?? undefined} aria-label={`Buy ${offer.tier} pick for ${offer.price} gold`}
              onClick={() => onIntent({ type: 'v29.mining-tool', action: 'buy', tier: offer.tier })}>
              <b>{offer.tier === 'basic' ? 'Basic' : 'Enchanted'} pick</b>
              <span>{offer.owned ? 'Owned' : `${offer.price}g`}</span>
            </button>
            {offer.buyReason && <small className="wr-caption" role="note">{offer.buyReason}</small>}
          </div>)}
        </section>}
        {(!starterCliff || sellOffers.length > 0) && <section>
          <h3 className="wr-caption">Sell materials</h3>
          {sellOffers.map((offer) => {
            const oneReason = checkedReason(`mireglass:sell:${offer.itemId}`)
            const allReason = checkedReason(offer.quantity === 1
              ? `mireglass:sell:${offer.itemId}` : `mireglass:sell-all:${offer.itemId}`)
            return <div key={offer.itemId}>
            <small>{offer.name} ×{offer.quantity} · {offer.unitPrice}g each</small>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button type="button" style={{ minHeight: 44 }} disabled={savePaused || !!oneReason} title={oneReason ?? undefined} aria-label={`Sell 1 ${offer.name}`} onClick={() => onIntent({ type: 'store.sell-item', storeId: nearbyStore.id, itemId: offer.itemId, quantity: 1 })}>Sell 1</button>
              <button type="button" style={{ minHeight: 44 }} disabled={savePaused || !!allReason} title={allReason ?? undefined} aria-label={`Sell all ${offer.quantity} ${offer.name} for ${offer.quantity * offer.unitPrice} gold`} onClick={() => onIntent({ type: 'store.sell-item', storeId: nearbyStore.id, itemId: offer.itemId, quantity: offer.quantity })}>Sell all ×{offer.quantity} · {offer.quantity * offer.unitPrice}g</button>
            </div>
            {oneReason && <small className="wr-caption" role="note">Sell 1: {oneReason}</small>}
            {allReason && allReason !== oneReason && <small className="wr-caption" role="note">Sell all: {allReason}</small>}
          </div>})}
          {sellOffers.length === 0 && <p className="wr-empty">No materials to sell.</p>}
        </section>}
        {mining && nearbyStore.id === 'store-greenway' && <section aria-label="Sell mined materials">
          <h3 className="wr-caption">Sell terrain bag</h3>
          {(Object.keys(mining.bids) as (keyof typeof mining.bids)[]).map((material) => {
            const quantity = mining.bag[material], bid = mining.bids[material]
            return <div key={material}>
              <small>{material.replaceAll('_', ' ')} ×{quantity} · {bid}g each</small>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button type="button" style={{ minHeight: 44 }} disabled={savePaused || !mining.atOutfitters || quantity < 1}
                  aria-label={`Sell 1 ${material.replaceAll('_', ' ')}`}
                  onClick={() => onIntent({ type: 'v29.sell-mineral', material, quantity: 1 })}>Sell 1</button>
                <button type="button" style={{ minHeight: 44 }} disabled={savePaused || !mining.atOutfitters || quantity < 1}
                  aria-label={`Sell all ${quantity} ${material.replaceAll('_', ' ')} for ${quantity * bid} gold`}
                  onClick={() => onIntent({ type: 'v29.sell-mineral', material, quantity })}>Sell all · {quantity * bid}g</button>
              </div>
            </div>
          })}
        </section>}
      </aside>}

      {nearbyRing?.discovered && !selectedBuildSite && !campPreview && <aside className="wr-panel wr-context">
        <header data-ring-panel="true">{nearbyRing.label}</header>
        <p className="wr-caption">{discoveredDestinations.length ? 'Discovered fairy paths' : 'Discover another fairy ring to unlock travel.'}</p>
        {discoveredDestinations.map((destination) => <button key={destination.ringId} style={projection.v33FairyTravel ? { minHeight: 44 } : undefined} disabled={savePaused} onClick={() => onIntent({ type: 'fairy-ring.teleport', ringId: nearbyRing.id, destinationRingId: destination.ringId })}><b>{destination.label}</b><span>Travel</span></button>)}
      </aside>}

      <div className="wr-events" aria-live="polite">{projection.recentEvents.slice(-3).map((event, index) => <p key={`${index}-${event}`}>{event}</p>)}</div>
      {diagnostics && <output className="wr-diagnostics">seed {projection.seed} · tick {projection.tick} · x {projection.player.position[0].toFixed(1)} z {projection.player.position[2].toFixed(1)} · yaw {projection.player.yaw.toFixed(2)}</output>}

      <div className="wr-touch" aria-label="Touch controls">
        <div className="wr-dpad">
          {([['↑', [0, 1]], ['←', [-1, 0]], ['↓', [0, -1]], ['→', [1, 0]]] as const).map(([label, vector]) => (
            <button key={label} aria-disabled={savePaused} style={savePaused ? { opacity: .5, cursor: 'not-allowed' } : undefined}
              onPointerDown={() => { if (!savePaused) onIntent({ type: 'movement', vector }) }}
              onPointerUp={() => onIntent({ type: 'movement', vector: [0, 0] })}
              onPointerCancel={() => onIntent({ type: 'movement', vector: [0, 0] })}
              onClick={() => { if (!savePaused) onIntent({ type: 'movement.tap', vector }) }}>{label}</button>
          ))}
        </div>
        <div className="wr-touch-actions">
          <button className="wr-touch-action" disabled={savePaused} onClick={() => onIntent({ type: 'jump' })}>Jump</button>
          <button className="wr-touch-action" disabled={savePaused || legacyActionsUnavailable || starterCliff && !nearbyAction?.actionable || !checkedNearbyInteract} onClick={() => onIntent({ type: 'interact' })}>Interact</button>
          {v16Magic && nearbyInscriptions[0] && <button className="wr-touch-action" disabled={savePaused}
            aria-label={`Study ${nearbyInscriptions[0].name}`}
            onClick={() => onIntent({ type: 'inscription.study', inscriptionId: nearbyInscriptions[0].id })}>Study</button>}
          {showGlow && <button className="wr-touch-action" disabled={glowUnavailable} title={glowCheckedReason ?? undefined} aria-label="Cast Wayfinder Glow" onClick={() => onIntent({ type: 'spell.cast', spellId: 'wayfinder_glow' })}>Cast</button>}
          {!starterCliff && windward && <button className="wr-touch-action" disabled={!windwardActionable}
            aria-label={windward.learned ? 'Cast Windward Step' : 'Study Windward Step glyph'}
            onClick={() => onIntent(windwardAction)}>{windward.learned ? 'Wind' : 'Study'}</button>}
        </div>
      </div>
    </div>
  )
}
