import { IDBFactory } from 'fake-indexeddb'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PublicV23Controller, publicV24ActionForChoice,
  publicV24ActionForSharedIntent, publicV24OpenStoreId } from './PublicV23Controller'
import { toViewProjection } from './App'
import { createWizardWorld } from './domain'
import type { PublicV24MireglassChoice } from './PublicV24MireglassView'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { createAtomicV24Store } from './domain/atomicV24Database'
import { encodeDiscoveredTileIds } from './domain/discoveryMask'
import { mireglassAnchors } from './domain/mireglassContent'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import type { WizardViewProjection } from './view/contracts'
import { WizardHud } from './view/WizardHud'

const choice = (data: Partial<PublicV24MireglassChoice> = {}): PublicV24MireglassChoice => ({
  id: 'mireglass:study:fringe_marker', label: 'Study frontier marker', detail: 'Learn Glow',
  action: { type: 'study_fringe_marker' }, distanceMeters: 1, genericInteract: true,
  actionable: true, disabledReason: null, ...data,
})
const buttons = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(buttons)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(node.type === 'button' ? [node] : []), ...buttons(node.props.children as ReactNode)]
}

describe('V24 controller choice routing', () => {
  it('requires the current actionable choice for E and explicit actions', () => {
    const study = choice()
    const trade = choice({ id: 'mireglass:buy:field_spade', label: 'Buy field spade',
      action: { type: 'buy_item', itemId: 'field_spade' }, genericInteract: false })
    const blocked = choice({ id: 'mireglass:chop:depleted',
      action: { type: 'chop_tree', resourceId: 'depleted' }, actionable: false,
      disabledReason: 'depleted' })
    const current = [study, trade, blocked]
    expect(publicV24ActionForChoice(current, study.id, 'generic')).toEqual({
      kind: 'mireglass-action/v1', action: { type: 'study_fringe_marker' },
    })
    expect(publicV24ActionForChoice(current, trade.id, 'generic')).toBeNull()
    expect(publicV24ActionForChoice(current, trade.id, 'explicit')?.action.type).toBe('buy_item')
    expect(publicV24ActionForChoice(current, blocked.id, 'explicit')).toBeNull()
    expect(publicV24ActionForChoice([trade], study.id, 'explicit')).toBeNull()
  })

  it('routes shared Glow and open-store controls only through current checked choices', () => {
    const glow = choice({ id: 'mireglass:cast:wayfinder_glow',
      action: { type: 'cast_wayfinder_glow' }, genericInteract: false })
    const buy = choice({ id: 'mireglass:buy:field_spade',
      action: { type: 'buy_item', itemId: 'field_spade' }, genericInteract: false })
    const sale = choice({ id: 'mireglass:sell-all:logs',
      action: { type: 'sell_item', itemId: 'logs', quantity: 4 }, genericInteract: false })
    const equip = choice({ id: 'mireglass:equip:field_spade',
      action: { type: 'equip_item', itemId: 'field_spade' }, genericInteract: false })
    const choices = [glow, buy, sale, equip]
    expect(publicV24ActionForChoice(choices, buy.id, 'generic')).toBeNull()
    expect(publicV24ActionForSharedIntent({ type: 'spell.cast', spellId: 'wayfinder_glow' },
      choices, null, null)?.action.type).toBe('cast_wayfinder_glow')
    const buyIntent = { type: 'store.select-listing' as const,
      storeId: 'salvager', listingId: 'field_spade' }
    expect(publicV24ActionForSharedIntent(buyIntent, choices, 'salvager', null)).toBeNull()
    expect(publicV24ActionForSharedIntent(buyIntent, choices, 'salvager', 'salvager')
      ?.action.type).toBe('buy_item')
    expect(publicV24ActionForSharedIntent({ type: 'store.sell-item', storeId: 'salvager',
      itemId: 'logs', quantity: 4 }, choices, 'salvager', 'salvager')
      ?.action).toEqual({ type: 'sell_item', itemId: 'logs', quantity: 4 })
    expect(publicV24ActionForSharedIntent({ type: 'store.sell-item', storeId: 'salvager',
      itemId: 'logs', quantity: 3 }, choices, 'salvager', 'salvager')).toBeNull()
    expect(publicV24ActionForSharedIntent({ type: 'spell.cast', spellId: 'wayfinder_glow' },
      [choice({ ...glow, actionable: false })], null, null)).toBeNull()
    const stacks = [{ id: 'inventory-field_spade', itemId: 'field_spade',
      name: 'Field spade', quantity: 1, equippableSlots: ['mainHand' as const] }]
    expect(publicV24ActionForSharedIntent({ type: 'equipment.equip',
      stackId: 'inventory-field_spade', slot: 'mainHand' }, choices, null, null, stacks)
      ?.action.type).toBe('equip_item')
    expect(publicV24ActionForSharedIntent({ type: 'equipment.equip',
      stackId: 'inventory-field_spade', slot: 'feet' }, choices, null, null, stacks)).toBeNull()
    expect(publicV24ActionForSharedIntent({ type: 'equipment.equip',
      stackId: 'inventory-field_spade', slot: 'mainHand' }, [glow], null, null, stacks)).toBeNull()
    expect(publicV24ActionForSharedIntent({ type: 'equipment.unequip',
      slot: 'mainHand' }, choices, null, null, stacks)).toBeNull()
    const view = { nearbyStoreId: 'salvager', openStoreId: null,
      stores: [{ id: 'salvager' }] } as unknown as WizardViewProjection
    expect(publicV24OpenStoreId(view, 'salvager')).toBe('salvager')
    expect(publicV24OpenStoreId({ ...view, nearbyStoreId: null }, 'salvager')).toBeNull()
  })

  it('keeps default V23 construction while V24 is an explicit session', () => {
    const factory = new IDBFactory()
    const source = createPublicV23Root('greenway-alpha')
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, body: () => T | Promise<T>) => body() }
    const sourceStore = createAtomicV23Store(factory)
    const ancestorStore = createAtomicV17Store(factory)
    const v23 = renderToStaticMarkup(createElement(PublicV23Controller, {
      start: source, locks, store: sourceStore, sourceStore: ancestorStore,
    }))
    expect(v23).toContain('data-public-version="v23"')
    const v24 = renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v24', start: createPublicV24Root(source), locks,
      store: createAtomicV24Store(factory), sourceStore, ancestorStore,
    }))
    expect(v24).toContain('data-public-version="v24"')
    expect(v24).not.toContain('V23 progress saved on this device.')
  })

  it('disables unsupported shared V24 unequip and listing while retaining checked equip', () => {
    const seed = 'greenway-alpha', factory = new IDBFactory()
    const source = createPublicV23Root(seed), root = createPublicV24Root(source)
    const marker = mireglassAnchors(seed).fringeMarker.tile
    const player = { ...root.head.state.player, position: { ...marker.center },
      inventory: [{ itemId: 'woodcutters_axe' as const, quantity: 1 },
        { itemId: 'field_spade' as const, quantity: 1 },
        { itemId: 'leather_boots' as const, quantity: 1 }],
      equipment: { ...root.head.state.player.equipment, mainHand: 'woodcutters_axe' as const,
        feet: null } }
    const start = { ...root, head: { ...root.head, state: { ...root.head.state,
      player, movementOwner: 'streamed' as const,
      discoveryMask: encodeDiscoveredTileIds([marker.id]) } } }
    const locks = { request: async <T,>(_name: string,
      _options: { mode: 'exclusive' }, body: () => T | Promise<T>) => body() }
    const html = renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v24', start, locks, store: createAtomicV24Store(factory),
      sourceStore: createAtomicV23Store(factory), ancestorStore: createAtomicV17Store(factory),
    }))
    expect(html).toContain('Mireglass supports equipping another item to switch gear')
    expect(html).toMatch(/disabled=""[^>]*aria-label="Unequip Woodcutter axe/)
    expect(html).toMatch(/aria-label="Equip Field spade"[^>]*>Equip<\/button>/)
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*aria-label="Equip Leather boots"[^>]*>Equip<\/button>/)
    expect(html).toContain('Player trade listings are not available in Mireglass yet')
  })

  it('mirrors current checked Glow and salvager readiness in both shared Cast and trade controls', () => {
    const base = toViewProjection(createWizardWorld('greenway-alpha'), [])
    const view: WizardViewProjection = { ...base, starterCliff: undefined,
      learnedSpellIds: ['wayfinder_glow'], openStoreId: 'salvager', nearbyStoreId: 'salvager',
      stores: [{ id: 'salvager', name: 'Salvager', position: [0, 0, 0],
        listings: [{ id: 'field_spade', name: 'Field spade', price: 20, stock: 0 },
          { id: 'mireglass_reach/item/waders', name: 'Fen waders', price: 40, stock: 2 }],
        sellOffers: [{ itemId: 'logs', name: 'Logs', quantity: 2, unitPrice: 4 }] }],
      checkedActionChoices: [
        { id: 'mireglass:cast:wayfinder_glow', actionable: false, reason: 'Already revealed.' },
        { id: 'mireglass:buy:field_spade', actionable: false, reason: 'Item is out of stock.' },
        { id: 'mireglass:buy:mireglass_reach/item/waders', actionable: false, reason: 'Not enough coins.' },
        { id: 'mireglass:sell:logs', actionable: false, reason: 'Coin total would exceed safe limits.' },
        { id: 'mireglass:sell-all:logs', actionable: false, reason: 'Coin total would exceed safe limits.' },
      ] }
    const all = buttons(WizardHud({ projection: view, onIntent: () => {} }))
    const named = (label: string) => all.filter((button) => button.props['aria-label'] === label)
    expect(named('Cast Wayfinder Glow')).toHaveLength(2)
    expect(named('Cast Wayfinder Glow').every((button) => button.props.disabled === true
      && button.props.title === 'Already revealed.')).toBe(true)
    for (const [name, reason] of [['Field spade', 'Item is out of stock.'],
      ['Fen waders', 'Not enough coins.']] as const) {
      const button = all.find((entry) => renderToStaticMarkup(entry).includes(`<b>${name}</b>`))!
      expect(button.props.disabled).toBe(true)
      expect(button.props.title).toBe(reason)
    }
    expect(named('Sell 1 Logs')[0].props.disabled).toBe(true)
    expect(named('Sell all 2 Logs for 8 gold')[0].props.disabled).toBe(true)
    const v23 = buttons(WizardHud({ projection: { ...view, checkedActionChoices: undefined },
      onIntent: () => {} }))
    expect(v23.filter((button) => button.props['aria-label'] === 'Cast Wayfinder Glow')
      .every((button) => button.props.disabled === false)).toBe(true)
  })

  it('gates touch Interact to a current marker or nearby salvager in V24 only', () => {
    const base = toViewProjection(createWizardWorld('greenway-alpha'), [])
    const view: WizardViewProjection = { ...base, starterCliff: undefined,
      unavailableActions: undefined, checkedActionChoices: [], nearbyInteraction: null,
      nearbyStoreId: null }
    const touch = (projection: WizardViewProjection) => buttons(WizardHud({ projection,
      onIntent: () => {} })).find((button) => button.props.className === 'wr-touch-action'
        && button.props.children === 'Interact')!
    expect(touch(view).props.disabled).toBe(true)
    const marker = { ...view, checkedActionChoices: [{
      id: 'mireglass:study:fringe_marker', actionable: true, reason: null }],
      nearbyInteraction: { kind: 'inscription' as const,
        targetId: 'mireglass:study:fringe_marker', label: 'Frontier marker',
        action: 'Study', actionable: true } }
    expect(touch(marker).props.disabled).toBe(false)
    const outpost = { ...view, nearbyStoreId: 'salvager', nearbyInteraction: {
      kind: 'store' as const, targetId: 'salvager', label: 'Salvager',
      action: 'Open trade', actionable: true } }
    expect(touch(outpost).props.disabled).toBe(false)
    expect(touch({ ...outpost, nearbyStoreId: null }).props.disabled).toBe(true)
    expect(touch({ ...view, checkedActionChoices: undefined }).props.disabled).toBe(false)
  })
})
