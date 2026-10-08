import type { EquipmentSlot, WizardViewIntent, WizardViewProjection } from './contracts'

export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ['head', 'chest', 'mainHand', 'legs', 'feet', 'offHand']
export const EQUIPMENT_SLOT_LABELS: Readonly<Record<EquipmentSlot, string>> = {
  head: 'Head', chest: 'Chest', legs: 'Legs', feet: 'Feet', mainHand: 'Main hand', offHand: 'Off hand',
}
const FIELD_ACTION_STYLE = { minHeight: 44, padding: '6px 8px', border: '1px solid #cfb66b55', borderRadius: 6, background: '#374b3d', color: '#f8e8b2', cursor: 'pointer' } as const
const SKILL_LABELS = { woodcutting: 'Woodcutting', construction: 'Construction', wayfinding: 'Wayfinding', spellcraft: 'Spellcraft', excavation: 'Excavation' } as const

export function WizardHud({ projection, onIntent, diagnostics }: {
  projection: WizardViewProjection
  onIntent: (intent: WizardViewIntent) => void
  diagnostics?: boolean
}) {
  const nearbyStore = projection.openStoreId
    ? projection.stores.find((store) => store.id === projection.openStoreId)
    : undefined
  const availableStore = projection.nearbyStoreId && projection.openStoreId === null
    ? projection.stores.find((store) => store.id === projection.nearbyStoreId)
    : undefined
  const nearbyRing = projection.nearbyInteraction?.kind === 'fairy-ring'
    ? projection.fairyRings.find((ring) => ring.id === projection.nearbyInteraction?.targetId)
    : undefined
  const discoveredDestinations = nearbyRing?.destinations.filter((destination) => destination.discovered) ?? []
  const usedCapacity = projection.backpack.stacks.reduce((total, stack) => total + stack.quantity, 0)
    + projection.tradeListings.reduce((total, listing) => total + (listing?.quantity ?? 0), 0)
  const firstTradeSlot = projection.tradeListings.findIndex((listing) => listing === null)
  const learnedGlow = projection.learnedSpellIds.includes('wayfinder_glow')
  const excavationLevel = 1 + Math.floor(projection.skillXp.excavation / 30)
  const spadeEquipped = projection.equipment.mainHand?.itemId === 'field_spade'
  const inReach = (position: readonly [number, number, number]) => Math.hypot(position[0] - projection.player.position[0], position[1] - projection.player.position[1], position[2] - projection.player.position[2]) <= 3
  const nearbyInscriptions = projection.inscriptions.filter((inscription) => !inscription.studied && inReach(inscription.position))
  const nearbyDigSites = projection.digSites.filter((site) => site.revealed && !site.excavated && inReach(site.position))
  const campPreview = projection.fieldCamp?.preview
  const selectedBuildSite = !campPreview && projection.buildSites.find((site) => site.id === projection.selectedBuildSiteId && site.discovered && site.status !== 'built')
  const xpPercent = Math.min(100, projection.experience.nextLevelXp > 0
    ? projection.experience.xp / projection.experience.nextLevelXp * 100
    : 100)
  const windward = projection.windwardStep
  const windwardAction = windward?.learned ? { type: 'windward.cast' as const } : { type: 'windward.study' as const }
  const windwardActionable = windward?.learned ? windward.canCast : windward?.glyph?.canStudy === true
  const windwardStatus = windward?.activeSeconds
    ? `Active for ${windward.activeSeconds}s. Recast in ${windward.cooldownSeconds}s.`
    : windward?.cooldownSeconds ? `Recast in ${windward.cooldownSeconds}s.`
      : windward?.learned ? windward.canCast ? 'Ready on the dry Highland trail.' : 'Follow the dry Highland trail to cast.'
        : windward?.glyph?.canStudy ? 'Study the wind-cut glyph here.' : 'Find the wind-cut glyph at Quarry Crown.'

  return (
    <div className="wr-hud">
      <div className="wr-topbar">
        <div><span className="wr-kicker">LEVEL</span><strong>{projection.experience.level}</strong></div>
        <div className="wr-xp"><span style={{ width: `${xpPercent}%` }} /></div>
        <div className="wr-coins" aria-label={`${projection.coins} coins`}>◉ {projection.coins.toLocaleString()}</div>
      </div>

      {projection.nearbyInteraction?.actionable && (
        <button className="wr-prompt" data-actionable="true" onClick={() => onIntent(projection.highlandExtraction
          ? { type: 'highland.extract', nodeId: projection.highlandExtraction.nodeId } : { type: 'interact' })}>
          <kbd>E</kbd><span><b>{projection.nearbyInteraction.action}</b>{projection.nearbyInteraction.label}</span>
        </button>
      )}
      {projection.nearbyInteraction && !projection.nearbyInteraction.actionable && (
        <div className="wr-prompt" data-actionable="false" role="status">
          <span><b>{projection.nearbyInteraction.action}</b>{projection.nearbyInteraction.label}</span>
        </div>
      )}

      <aside id="wizard-backpack" className="wr-panel wr-backpack">
        <header><span>Backpack</span><small>{usedCapacity}/{projection.backpack.capacity}</small></header>
        {projection.fieldCamp && !campPreview && <section aria-label="Field camp" className="wr-caption">
          <b>Field camp: 4 logs + 1 stone</b>
          <p>{projection.fieldCamp.camps.length ? 'Field camp built. One camp per world.' : projection.fieldCamp.selectionEnabled ? 'Follow the frontier trail into inner Mireglass. Map marks suitable discovered camp ground.' : 'Explore Mireglass to choose a camp site.'}</p>
        </section>}
        {availableStore && <button type="button" style={{ ...FIELD_ACTION_STYLE, width: '100%', marginBottom: 8 }} aria-label={`Open ${availableStore.name}`} onClick={() => onIntent({ type: 'store.open', storeId: availableStore.id })}>Open {availableStore.name}</button>}
        <section aria-label="Magic and skills" style={{ display: 'grid', gap: 5, marginBottom: 8 }}>
          <small className="wr-caption">Wayfinder Glow: {learnedGlow ? 'Learned' : 'Unknown'} · Excavation Lv{excavationLevel}</small>
          {projection.highlandExtraction && <>
            <button type="button" style={FIELD_ACTION_STYLE} disabled={!projection.highlandExtraction.actionable}
              aria-label="Extract quarry stone"
              onClick={() => onIntent({ type: 'highland.extract', nodeId: projection.highlandExtraction!.nodeId })}>Extract quarry stone</button>
            <small className="wr-caption" role="status">{projection.highlandExtraction.reason}</small>
          </>}
          <button type="button" style={FIELD_ACTION_STYLE} disabled={!learnedGlow} aria-label="Cast Wayfinder Glow" onClick={() => onIntent({ type: 'spell.cast', spellId: 'wayfinder_glow' })}>Cast Wayfinder Glow</button>
          {windward && <>
            <button type="button" style={FIELD_ACTION_STYLE} disabled={!windwardActionable}
              aria-label={windward.learned ? 'Cast Windward Step' : 'Study Windward Step glyph'}
              onClick={() => onIntent(windwardAction)}>{windward.learned ? 'Cast Windward Step' : 'Study Windward Step'}</button>
            <small className="wr-caption">Windward Step: {windward.learned ? 'Learned. ' : 'Unknown. '}{windwardStatus}</small>
          </>}
          {windward?.stoneReturn && <small className="wr-caption" role="status">
            {windward.stoneReturn.quantity} carried stone: {windward.stoneReturn.offers.map((offer) =>
              `${offer.name} ${offer.unitPrice}g each (${offer.total}g total)`).join('; ')}.
          </small>}
          {nearbyInscriptions.map((inscription) => <button key={inscription.id} type="button" style={FIELD_ACTION_STYLE} aria-label={`Study ${inscription.name}`} onClick={() => onIntent({ type: 'inscription.study', inscriptionId: inscription.id })}>Study {inscription.name}</button>)}
          {nearbyDigSites.map((site) => {
            const unmetLevel = excavationLevel < site.minimumExcavationLevel
            return <div key={site.id}>
              <button type="button" style={{ ...FIELD_ACTION_STYLE, width: '100%' }} disabled={!spadeEquipped || unmetLevel} aria-label={`Excavate ${site.name}`} onClick={() => onIntent({ type: 'dig-site.excavate', digSiteId: site.id })}>Excavate {site.name}</button>
              {(!spadeEquipped || unmetLevel) && <small className="wr-caption">{!spadeEquipped ? 'Equip a field spade' : `Excavation Lv${site.minimumExcavationLevel} required`}</small>}
            </div>
          })}
          <details className="wr-caption"><summary>Skills</summary>{Object.entries(SKILL_LABELS).map(([id, label]) => <div key={id}>{label}: Lv{1 + Math.floor(projection.skillXp[id as keyof typeof SKILL_LABELS] / 30)} ({projection.skillXp[id as keyof typeof SKILL_LABELS]} XP)</div>)}</details>
        </section>
        <div className="wr-list">
          {projection.backpack.stacks.map((stack) => {
            const equippedSlot = stack.equippableSlots?.find((slot) => projection.equipment[slot]?.id === stack.id)
            const targetSlot = stack.equippableSlots?.find((slot) => projection.equipment[slot] === null) ?? stack.equippableSlots?.[0]
            const equipped = equippedSlot !== undefined
            const unassignedCopies = stack.quantity - Object.values(projection.equipment).filter((item) => item?.id === stack.id).length
            return <div className="wr-item" key={stack.id}>
              <span className="wr-icon">{stack.icon ?? '◆'}</span><b>{stack.name}</b><small>×{stack.quantity}</small>
              {stack.equippableSlots && stack.equippableSlots.length > 1
                ? <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, gridColumn: '2 / 3' }}>
                  {stack.equippableSlots.map((slot) => {
                    const wornHere = projection.equipment[slot]?.id === stack.id
                    if (!wornHere && unassignedCopies < 1) return null
                    const label = EQUIPMENT_SLOT_LABELS[slot]
                    return <button key={slot} type="button" style={{ minHeight: 44 }} aria-pressed={wornHere} aria-label={`${wornHere ? 'Unequip' : 'Equip'} ${stack.name} ${wornHere ? 'from' : 'in'} ${label}`}
                      onClick={() => onIntent(wornHere ? { type: 'equipment.unequip', slot } : { type: 'equipment.equip', stackId: stack.id, slot })}>{wornHere ? `Unequip ${label}` : `Equip ${label}`}</button>
                  })}
                </span>
                : targetSlot && <button type="button" style={{ minHeight: 44 }} aria-pressed={equipped} aria-label={equipped ? `Unequip ${stack.name}` : `Equip ${stack.name}`} onClick={() => onIntent(equippedSlot ? { type: 'equipment.unequip', slot: equippedSlot } : { type: 'equipment.equip', stackId: stack.id, slot: targetSlot })}>{equipped ? 'Unequip' : 'Equip'}</button>}
              <button disabled={firstTradeSlot < 0} onClick={() => onIntent({ type: 'trade.create-listing', stackId: stack.id, slot: firstTradeSlot, quantity: 1, unitPrice: stack.suggestedTradePrice ?? 1 })}>List</button>
            </div>
          })}
          {projection.backpack.stacks.length === 0 && <p className="wr-empty">Your pack is empty.</p>}
        </div>
      </aside>

      <aside className="wr-panel wr-gear">
        <header>Equipment</header>
        <div className="wr-slot-grid">
          {EQUIPMENT_SLOTS.map((slot) => <div className="wr-slot" key={slot} data-slot={slot}>
            <small>{EQUIPMENT_SLOT_LABELS[slot]}</small><b>{projection.equipment[slot]?.name ?? 'Empty'}</b>
            {projection.equipment[slot] && <button type="button" style={{ minHeight: 44, width: '100%' }} aria-label={`Unequip ${projection.equipment[slot].name} from ${EQUIPMENT_SLOT_LABELS[slot]}`} onClick={() => onIntent({ type: 'equipment.unequip', slot })}>Unequip</button>}
          </div>)}
        </div>
      </aside>

      <aside className="wr-panel wr-trade">
        <header>Trade board</header>
        <div className="wr-trade-grid">
          {projection.tradeListings.map((listing, slot) => listing
            ? <button key={slot} onClick={() => onIntent({ type: 'trade.cancel-listing', slot })}><b>{listing.itemName}</b><small>{listing.quantity} × {listing.unitPrice}g</small><em>Cancel</em></button>
            : <div className="wr-empty-slot" key={slot}>Open slot {slot + 1}</div>)}
        </div>
      </aside>

      {selectedBuildSite && <aside className="wr-panel wr-context wr-build-preview" aria-label="Selected build site">
        <header>{projection.routes.find((route) => route.id === selectedBuildSite.routeId)?.label ?? 'Build route'}</header>
        <b>{selectedBuildSite.label}</b>
        <p className="wr-caption" role="status">{selectedBuildSite.logCost} logs · {selectedBuildSite.reason || 'Ready to build'}</p>
        <div className="wr-build-actions">
          <button type="button" disabled={selectedBuildSite.status !== 'ready'} onClick={() => onIntent({ type: 'build-site.confirm', siteId: selectedBuildSite.id })}>Build</button>
          <button type="button" onClick={() => onIntent({ type: 'build-site.select', siteId: null })}>Cancel</button>
        </div>
      </aside>}

      {campPreview && <aside className="wr-panel wr-context wr-build-preview" aria-label="Field camp preview" data-field-camp-panel="true">
        <header>Field camp<small>{campPreview.tileId}</small></header>
        <p className="wr-caption">4 logs + 1 stone · 30 construction XP</p>
        <p className="wr-caption" role="status">{campPreview.rejection?.message ?? (campPreview.position && projection.fieldCamp?.selectionEnabled ? 'Ready to build' : 'Camp placement is unavailable here.')}</p>
        <div className="wr-build-actions">
          <button type="button" disabled={!projection.fieldCamp?.selectionEnabled || !campPreview.position || !!campPreview.rejection} onClick={() => onIntent({ type: 'field-camp.confirm', tileId: campPreview.tileId })}>Build</button>
          <button type="button" onClick={() => onIntent({ type: 'field-camp.select', tileId: null })}>Cancel</button>
        </div>
      </aside>}

      {nearbyStore && !selectedBuildSite && !campPreview && <aside className="wr-panel wr-context" data-store-panel="true">
        <header>{nearbyStore.name}</header>
        <button type="button" onClick={() => onIntent({ type: 'store.close' })}>Close</button>
        {nearbyStore.listings.map((listing) => <button key={listing.id} onClick={() => onIntent({ type: 'store.select-listing', storeId: nearbyStore.id, listingId: listing.id })}><b>{listing.name}</b><span>{listing.price}g{listing.stock === undefined ? '' : ` · ${listing.stock} left`}</span></button>)}
        <section>
          <h3 className="wr-caption">Sell materials</h3>
          {nearbyStore.sellOffers.map((offer) => <div key={offer.itemId}>
            <small>{offer.name} ×{offer.quantity} · {offer.unitPrice}g each</small>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button type="button" style={{ minHeight: 44 }} aria-label={`Sell 1 ${offer.name}`} onClick={() => onIntent({ type: 'store.sell-item', storeId: nearbyStore.id, itemId: offer.itemId, quantity: 1 })}>Sell 1</button>
              <button type="button" style={{ minHeight: 44 }} aria-label={`Sell all ${offer.quantity} ${offer.name} for ${offer.quantity * offer.unitPrice} gold`} onClick={() => onIntent({ type: 'store.sell-item', storeId: nearbyStore.id, itemId: offer.itemId, quantity: offer.quantity })}>Sell all ×{offer.quantity} · {offer.quantity * offer.unitPrice}g</button>
            </div>
          </div>)}
          {nearbyStore.sellOffers.length === 0 && <p className="wr-empty">No materials to sell.</p>}
        </section>
      </aside>}

      {nearbyRing?.discovered && !selectedBuildSite && !campPreview && <aside className="wr-panel wr-context">
        <header data-ring-panel="true">{nearbyRing.label}</header>
        <p className="wr-caption">{discoveredDestinations.length ? 'Discovered fairy paths' : 'Discover another fairy ring to unlock travel.'}</p>
        {discoveredDestinations.map((destination) => <button key={destination.ringId} onClick={() => onIntent({ type: 'fairy-ring.teleport', ringId: nearbyRing.id, destinationRingId: destination.ringId })}><b>{destination.label}</b><span>Travel</span></button>)}
      </aside>}

      <div className="wr-events" aria-live="polite">{projection.recentEvents.slice(-3).map((event, index) => <p key={`${index}-${event}`}>{event}</p>)}</div>
      {diagnostics && <output className="wr-diagnostics">seed {projection.seed} · tick {projection.tick} · x {projection.player.position[0].toFixed(1)} z {projection.player.position[2].toFixed(1)} · yaw {projection.player.yaw.toFixed(2)}</output>}

      <div className="wr-touch" aria-label="Touch controls">
        <div className="wr-dpad">
          {([['↑', [0, 1]], ['←', [-1, 0]], ['↓', [0, -1]], ['→', [1, 0]]] as const).map(([label, vector]) => (
            <button key={label} onPointerDown={() => onIntent({ type: 'movement', vector })} onPointerUp={() => onIntent({ type: 'movement', vector: [0, 0] })} onPointerCancel={() => onIntent({ type: 'movement', vector: [0, 0] })} onClick={() => onIntent({ type: 'movement.tap', vector })}>{label}</button>
          ))}
        </div>
        <div className="wr-touch-actions">
          <button className="wr-touch-action" onClick={() => onIntent({ type: 'jump' })}>Jump</button>
          <button className="wr-touch-action" onClick={() => onIntent({ type: 'interact' })}>Interact</button>
          <button className="wr-touch-action" disabled={!learnedGlow} aria-label="Cast Wayfinder Glow" onClick={() => onIntent({ type: 'spell.cast', spellId: 'wayfinder_glow' })}>Cast</button>
          {windward && <button className="wr-touch-action" disabled={!windwardActionable}
            aria-label={windward.learned ? 'Cast Windward Step' : 'Study Windward Step glyph'}
            onClick={() => onIntent(windwardAction)}>{windward.learned ? 'Wind' : 'Study'}</button>}
        </div>
      </div>
    </div>
  )
}
