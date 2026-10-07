import type { EquipmentSlot, WizardViewIntent, WizardViewProjection } from './contracts'

export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ['head', 'chest', 'mainHand', 'legs', 'feet', 'offHand']
export const EQUIPMENT_SLOT_LABELS: Readonly<Record<EquipmentSlot, string>> = {
  head: 'Head', chest: 'Chest', legs: 'Legs', feet: 'Feet', mainHand: 'Main hand', offHand: 'Off hand',
}

export function WizardHud({ projection, onIntent, diagnostics }: {
  projection: WizardViewProjection
  onIntent: (intent: WizardViewIntent) => void
  diagnostics?: boolean
}) {
  const nearbyStore = projection.nearbyInteraction?.kind === 'store'
    ? projection.stores.find((store) => store.id === projection.nearbyInteraction?.targetId)
    : undefined
  const nearbyRing = projection.nearbyInteraction?.kind === 'fairy-ring'
    ? projection.fairyRings.find((ring) => ring.id === projection.nearbyInteraction?.targetId)
    : undefined
  const usedCapacity = projection.backpack.stacks.reduce((total, stack) => total + stack.quantity, 0)
  const firstTradeSlot = projection.tradeListings.findIndex((listing) => listing === null)
  const xpPercent = Math.min(100, projection.experience.nextLevelXp > 0
    ? projection.experience.xp / projection.experience.nextLevelXp * 100
    : 100)

  return (
    <div className="wr-hud">
      <div className="wr-topbar">
        <div><span className="wr-kicker">LEVEL</span><strong>{projection.experience.level}</strong></div>
        <div className="wr-xp"><span style={{ width: `${xpPercent}%` }} /></div>
        <div className="wr-coins" aria-label={`${projection.coins} coins`}>◉ {projection.coins.toLocaleString()}</div>
      </div>

      {projection.nearbyInteraction?.actionable && (
        <button className="wr-prompt" data-actionable="true" onClick={() => onIntent({ type: 'interact' })}>
          <kbd>E</kbd><span><b>{projection.nearbyInteraction.action}</b>{projection.nearbyInteraction.label}</span>
        </button>
      )}
      {projection.nearbyInteraction && !projection.nearbyInteraction.actionable && (
        <div className="wr-prompt" data-actionable="false" role="status">
          <span><b>{projection.nearbyInteraction.action}</b>{projection.nearbyInteraction.label}</span>
        </div>
      )}

      <aside className="wr-panel wr-backpack">
        <header><span>Backpack</span><small>{usedCapacity}/{projection.backpack.capacity}</small></header>
        <div className="wr-list">
          {projection.backpack.stacks.map((stack) => {
            const equippedSlot = stack.equippableSlots?.find((slot) => projection.equipment[slot]?.id === stack.id)
            const targetSlot = stack.equippableSlots?.find((slot) => projection.equipment[slot] === null) ?? stack.equippableSlots?.[0]
            const equipped = equippedSlot !== undefined
            return <div className="wr-item" key={stack.id}>
              <span className="wr-icon">{stack.icon ?? '◆'}</span><b>{stack.name}</b><small>×{stack.quantity}</small>
              {targetSlot && <button disabled={equipped} aria-pressed={equipped} onClick={() => onIntent({ type: 'equipment.equip', stackId: stack.id, slot: targetSlot })}>{equipped ? 'Equipped' : 'Equip'}</button>}
              <button disabled={firstTradeSlot < 0} onClick={() => onIntent({ type: 'trade.create-listing', stackId: stack.id, slot: firstTradeSlot, quantity: 1, unitPrice: stack.suggestedTradePrice ?? 1 })}>List</button>
            </div>
          })}
          {projection.backpack.stacks.length === 0 && <p className="wr-empty">Your pack is empty.</p>}
        </div>
      </aside>

      <aside className="wr-panel wr-gear">
        <header>Equipment</header>
        <div className="wr-slot-grid">
          {EQUIPMENT_SLOTS.map((slot) => <div className="wr-slot" key={slot} data-slot={slot}><small>{EQUIPMENT_SLOT_LABELS[slot]}</small><b>{projection.equipment[slot]?.name ?? 'Empty'}</b></div>)}
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

      {nearbyStore && <aside className="wr-panel wr-context">
        <header>{nearbyStore.name}</header>
        {nearbyStore.listings.map((listing) => <button key={listing.id} onClick={() => onIntent({ type: 'store.select-listing', storeId: nearbyStore.id, listingId: listing.id })}><b>{listing.name}</b><span>{listing.price}g{listing.stock === undefined ? '' : ` · ${listing.stock} left`}</span></button>)}
      </aside>}

      {nearbyRing && <aside className="wr-panel wr-context">
        <header>{nearbyRing.label}</header>
        <p className="wr-caption">{nearbyRing.destinations.some((destination) => destination.discovered) ? 'Discovered fairy paths' : 'Discover another fairy ring to unlock travel.'}</p>
        {nearbyRing.destinations.filter((destination) => destination.discovered).map((destination) => <button key={destination.ringId} onClick={() => onIntent({ type: 'fairy-ring.teleport', ringId: nearbyRing.id, destinationRingId: destination.ringId })}><b>{destination.label}</b><span>Travel</span></button>)}
      </aside>}

      <div className="wr-events" aria-live="polite">{projection.recentEvents.slice(-3).map((event, index) => <p key={`${index}-${event}`}>{event}</p>)}</div>
      {diagnostics && <output className="wr-diagnostics">seed {projection.seed} · tick {projection.tick} · x {projection.player.position[0].toFixed(1)} z {projection.player.position[2].toFixed(1)} · yaw {projection.player.yaw.toFixed(2)}</output>}

      <div className="wr-touch" aria-label="Touch controls">
        <div className="wr-dpad">
          {([['↑', [0, 1]], ['←', [-1, 0]], ['↓', [0, -1]], ['→', [1, 0]]] as const).map(([label, vector]) => (
            <button key={label} onPointerDown={() => onIntent({ type: 'movement', vector })} onPointerUp={() => onIntent({ type: 'movement', vector: [0, 0] })} onPointerCancel={() => onIntent({ type: 'movement', vector: [0, 0] })}>{label}</button>
          ))}
        </div>
        <div className="wr-touch-actions">
          <button className="wr-touch-action" onClick={() => onIntent({ type: 'jump' })}>Jump</button>
          <button className="wr-touch-action" onClick={() => onIntent({ type: 'interact' })}>Interact</button>
        </div>
      </div>
    </div>
  )
}
