import { describe, expect, it, vi } from 'vitest'
import { createElement, createRef, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cameraOrbitFromDrag, CENTERED_CAMERA_ORBIT, movementVector, releaseHeldControls } from './WizardSurface'
import { WizardHud } from './WizardHud'
import { WizardMap, mapDialogTabTarget, mapHeadingRotation, mapSheetMode, mapToggleForKey, northUpGridOrder } from './WizardMap'
import type { WizardViewProjection } from './contracts'

const projection = {
  routes: [
    { id: 'bridge', label: 'Greenway bridge', from: [0, 0, 0], to: [1, 0, 1], built: false, unlocked: true, logCost: 6 },
    { id: 'pass', label: 'Highland pass', from: [1, 0, 1], to: [2, 0, 2], built: true, unlocked: true, logCost: 4 },
    { id: 'ford', label: 'Wetland ford', from: [2, 0, 2], to: [3, 0, 3], built: false, unlocked: false, logCost: 8 },
  ],
  map: {
    tiles: [
      { id: 'home', gridX: 0, gridZ: 0, terrain: 'loam', biome: 'meadow', discovered: true, hasResource: false, hasStore: true, hasRing: false, hasRouteSite: false, hasBuiltRoute: false },
      { id: 'fog', gridX: 1, gridZ: 0, terrain: null, biome: null, discovered: false, hasResource: false, hasStore: false, hasRing: false, hasRouteSite: false, hasBuiltRoute: false },
    ],
    player: { gridX: 0, gridZ: 0, yaw: 0 },
  },
} as unknown as WizardViewProjection

type Props = Record<string, unknown>
const mapProps = (open: boolean, onToggle = vi.fn()) => ({ projection, open, onToggle, buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>() })
const renderMap = (open: boolean) => renderToStaticMarkup(createElement(WizardMap, mapProps(open)))
const gridProjection = (size: number, gridX: number, gridZ: number) => ({
  ...projection,
  map: {
    tiles: Array.from({ length: size * size }, (_, index) => {
      const x = index % size
      const z = Math.floor(index / size)
      return { id: `tile-${x}-${z}`, gridX: x, gridZ: z, terrain: 'loam', biome: 'meadow', discovered: true, hasResource: false, hasStore: false, hasRing: false, hasRouteSite: false, hasBuiltRoute: false }
    }),
    player: { gridX, gridZ, yaw: 0 },
  },
}) as WizardViewProjection
const sellProjection = {
  ...projection, seed: 'sell-test', tick: 0, player: { position: [0, 0, 0], yaw: 0, pitch: 0 },
  terrain: [], resources: [], fairyRings: [], coins: 10, experience: { xp: 0, nextLevelXp: 100, level: 1 },
  backpack: { capacity: 20, stacks: [] },
  equipment: { head: null, chest: null, legs: null, feet: null, mainHand: null, offHand: null },
  tradeListings: [null, null, null, null], nearbyInteraction: null, recentEvents: [],
  openStoreId: 'store-greenway',
  stores: [{ id: 'store-greenway', name: 'Greenway Outfitters', position: [0, 0, 0],
    listings: [{ id: 'hat', name: 'Apprentice hat', price: 20, stock: 2 }],
    sellOffers: [{ itemId: 'logs', name: 'Greenway logs', quantity: 3, unitPrice: 4 }],
  }],
} as WizardViewProjection
const findElements = (node: ReactNode, matches: (element: ReactElement<Props>) => boolean): ReactElement<Props>[] => {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, matches))
  if (!isValidElement<Props>(node)) return []
  const nested = findElements(node.props.children as ReactNode, matches)
  return matches(node) ? [node, ...nested] : nested
}

describe('third-person control grammar', () => {
  it('keeps forward, backward, and pivot axes independent', () => {
    expect(movementVector(new Set(['KeyW']))).toEqual([0, 1])
    expect(movementVector(new Set(['KeyS']))).toEqual([0, -1])
    expect(movementVector(new Set(['KeyA']))).toEqual([-1, 0])
    expect(movementVector(new Set(['KeyD']))).toEqual([1, 0])
    expect(movementVector(new Set(['KeyW', 'KeyD']))).toEqual([1, 1])
  })

  it('changes camera orbit only from drag deltas and clamps pitch', () => {
    expect(cameraOrbitFromDrag([0, 0.28], [25, -10])).toEqual([-0.1, 0.25])
    expect(cameraOrbitFromDrag([0, 0.7], [0, 100])).toEqual([0, 0.72])
    expect(cameraOrbitFromDrag([0, 0.1], [0, -100])).toEqual([0, 0.08])
  })

  it('starts a second drag from the recentered camera target', () => {
    const firstDrag = cameraOrbitFromDrag(CENTERED_CAMERA_ORBIT, [50, 20])
    expect(firstDrag).not.toEqual(CENTERED_CAMERA_ORBIT)
    expect(cameraOrbitFromDrag(CENTERED_CAMERA_ORBIT, [0, 0])).toEqual(CENTERED_CAMERA_ORBIT)
    expect(cameraOrbitFromDrag(CENTERED_CAMERA_ORBIT, [10, 0])).toEqual([-0.04, 0.28])
  })

  it('toggles the map from keyboard and selects a mobile full-screen sheet', () => {
    const opened = mapToggleForKey(false, 'KeyM')
    expect(opened).toBe(true)
    expect(mapToggleForKey(opened, 'KeyM', true)).toBe(true)
    expect(mapToggleForKey(opened, 'KeyM')).toBe(false)
    expect(mapToggleForKey(false, 'KeyW')).toBe(false)
    expect(mapSheetMode(719)).toBe('sheet')
    expect(mapSheetMode(720)).toBe('modal')
  })

  it('uses negative Z as north and keeps yaw zero pointing up', () => {
    const ordered = northUpGridOrder([
      { id: 'south', gridX: 0, gridZ: 1 },
      { id: 'north-east', gridX: 1, gridZ: -1 },
      { id: 'north-west', gridX: -1, gridZ: -1 },
    ])
    expect(ordered.map((tile) => tile.id)).toEqual(['north-west', 'north-east', 'south'])
    expect(mapHeadingRotation(0)).toBe(0)
  })

  it('traps Tab and Shift+Tab on the map dialog close control', () => {
    expect(mapDialogTabTarget(true, 'Tab', false)).toBe('close')
    expect(mapDialogTabTarget(true, 'Tab', true)).toBe('close')
    expect(mapDialogTabTarget(false, 'Tab', false)).toBeNull()
  })

  it.each(['window blur', 'document visibility loss'])('releases W/S/A/D after %s', () => {
    const held = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD'])
    expect(releaseHeldControls(held)).toEqual([0, 0])
    expect(held.size).toBe(0)
    expect(movementVector(held)).toEqual([0, 0])
  })
})

describe('wizard atlas markup', () => {
  it.each([7, 16])('scales a %i-column atlas while keeping the compact map focused on the player', (size) => {
    const player = size === 16 ? { gridX: 14, gridZ: 12 } : { gridX: 3, gridZ: 3 }
    const current = gridProjection(size, player.gridX, player.gridZ)
    const compact = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(false), projection: current }))
    const expanded = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: current }))

    expect(compact).toContain('grid-template-columns:repeat(7, minmax(0, 1fr))')
    expect(compact.match(/class="wr-map-tile"/g)).toHaveLength(49)
    expect(compact.match(/player location/g)).toHaveLength(1)
    expect(expanded).toContain(`grid-template-columns:repeat(${size}, minmax(0, 1fr))`)
    expect(expanded.match(/class="wr-map-tile"/g)).toHaveLength(size * size)
    expect(expanded.indexOf('tile-0-0:')).toBeLessThan(expanded.indexOf(`tile-${size - 1}-${size - 1}:`))
    if (size === 16) {
      expect(compact).toContain('tile-9-9:')
      expect(compact).toContain('tile-15-15:')
      expect(compact).not.toContain('tile-0-0:')
    }
  })

  it('clamps the compact viewport at the north-west edge without losing the player marker', () => {
    const compact = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(false), projection: gridProjection(16, 0, 0) }))
    expect(compact).toContain('tile-0-0:')
    expect(compact).toContain('tile-6-6:')
    expect(compact).not.toContain('tile-7-7:')
    expect(compact.match(/player location/g)).toHaveLength(1)
  })

  it('renders the minimap preview inside the single toggle button whose click handler is the toggle', () => {
    const onToggle = vi.fn()
    const buttons = findElements(WizardMap(mapProps(false, onToggle)), (element) => element.type === 'button')
    expect(buttons).toHaveLength(1)
    expect(findElements(buttons[0], (element) => element.props.className === 'wr-map-compact')).toHaveLength(1)
    ;(buttons[0].props.onClick as () => void)()
    expect(onToggle).toHaveBeenCalledTimes(1)
    const closed = renderMap(false)
    expect(closed.match(/<button/g)).toHaveLength(1)
    expect(closed).toMatch(/<button class="wr-map-toggle" aria-expanded="false">.*<span class="wr-map-compact" aria-hidden="true"><span class="wr-map-grid".*<\/button>/)
    expect(closed.slice(closed.indexOf('<button'), closed.indexOf('</button>'))).not.toContain('<div')
  })

  it('keeps aria-expanded and aria-controls truthful across closed and open states', () => {
    const closed = renderMap(false)
    expect(closed).not.toContain('aria-controls')
    expect(closed).not.toContain('id="wizard-world-map"')
    const open = renderMap(true)
    expect(open).toContain('<button class="wr-map-toggle" aria-expanded="true" aria-controls="wizard-world-map">')
    expect(open).toContain('<section id="wizard-world-map" class="wr-map-dialog" role="dialog" aria-modal="true" aria-labelledby="wizard-world-map-title">')
    expect(open).toContain('aria-label="Close map"')
    expect(open).not.toContain('wr-map-compact')
    expect(open.match(/<div><b>/g)).toHaveLength(projection.routes.length)
    expect(open).toMatch(/6 logs.*completed.*locked.*\? unexplored/)
  })
})

describe('store selling controls', () => {
  it('shows compact sell offers, payout, and the empty state without losing purchase or Close', () => {
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection: sellProjection, onIntent: () => {} }))
    expect(markup).toContain('Greenway Outfitters')
    expect(markup).toContain('Apprentice hat')
    expect(markup).toContain('>Close</button>')
    expect(markup).toContain('>Sell materials</h3>')
    expect(markup).toContain('Greenway logs ×3 · 4g each')
    expect(markup).toContain('Sell all ×3 · 12g')
    expect(markup.match(/min-height:44px/g)).toHaveLength(2)

    const noOffers = { ...sellProjection, stores: [{ ...sellProjection.stores[0], sellOffers: [] }] }
    const empty = renderToStaticMarkup(createElement(WizardHud, { projection: noOffers, onIntent: () => {} }))
    expect(empty).toContain('No materials to sell.')
    expect(empty).not.toContain('Sell all ×')
  })

  it('emits exact Sell 1 and Sell all quantities while preserving purchase and Close intents', () => {
    const emitted: unknown[] = []
    const buttons = findElements(WizardHud({ projection: sellProjection, onIntent: (intent) => emitted.push(intent) }), (element) => element.type === 'button')
    const click = (match: (button: ReactElement<Props>) => boolean) => {
      const button = buttons.find(match)
      if (!button) throw new Error('Expected store button')
      ;(button.props.onClick as () => void)()
    }
    click((button) => button.props['aria-label'] === 'Sell 1 Greenway logs')
    click((button) => button.props['aria-label'] === 'Sell all 3 Greenway logs for 12 gold')
    click((button) => button.props.children === 'Close')
    click((button) => Array.isArray(button.props.children) && button.props.children.some((child) => isValidElement<{ children: unknown }>(child) && child.props.children === 'Apprentice hat'))
    expect(emitted).toEqual([
      { type: 'store.sell-item', storeId: 'store-greenway', itemId: 'logs', quantity: 1 },
      { type: 'store.sell-item', storeId: 'store-greenway', itemId: 'logs', quantity: 3 },
      { type: 'store.close' },
      { type: 'store.select-listing', storeId: 'store-greenway', listingId: 'hat' },
    ])
  })
})

describe('equipment controls', () => {
  const equippedHat = { id: 'hat-stack', itemId: 'apprentice_hat', name: 'Apprentice hat', quantity: 1, equippableSlots: ['head'] as const }
  const spareAxe = { id: 'axe-stack', itemId: 'woodcutters_axe', name: 'Woodcutter axe', quantity: 1, equippableSlots: ['mainHand'] as const }
  const gearProjection = {
    ...sellProjection,
    openStoreId: null,
    backpack: { capacity: 20, stacks: [equippedHat, spareAxe] },
    equipment: { ...sellProjection.equipment, head: equippedHat },
  } as WizardViewProjection

  it('shows equipped names and only occupied slots have a touch-sized Unequip button', () => {
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection: gearProjection, onIntent: () => {} }))
    expect(markup).toContain('Apprentice hat')
    expect(markup).toContain('Woodcutter axe')
    expect(markup).toContain('aria-label="Unequip Apprentice hat from Head"')
    expect(markup).toContain('min-height:44px;width:100%')
    const slots = findElements(WizardHud({ projection: gearProjection, onIntent: () => {} }), (element) => element.props.className === 'wr-slot')
    expect(slots).toHaveLength(6)
    expect(findElements(slots[0], (element) => element.type === 'button')).toHaveLength(1)
    expect(slots.slice(1).every((slot) => findElements(slot, (element) => element.type === 'button').length === 0)).toBe(true)
    expect(markup).toContain('aria-label="Unequip Apprentice hat"')
    expect(markup).toContain('>Equip</button>')
  })

  it('emits unequip from both Equipment and Backpack while preserving backpack equip', () => {
    const emitted: unknown[] = []
    const buttons = findElements(WizardHud({ projection: gearProjection, onIntent: (intent) => emitted.push(intent) }), (element) => element.type === 'button')
    const gearUnequip = buttons.find((button) => button.props['aria-label'] === 'Unequip Apprentice hat from Head')
    const backpackUnequip = buttons.find((button) => button.props['aria-label'] === 'Unequip Apprentice hat')
    const equip = buttons.find((button) => button.props.children === 'Equip')
    expect(gearUnequip).toBeDefined()
    expect(backpackUnequip).toBeDefined()
    expect(equip).toBeDefined()
    ;(gearUnequip?.props.onClick as () => void)()
    ;(backpackUnequip?.props.onClick as () => void)()
    ;(equip?.props.onClick as () => void)()
    expect(emitted).toEqual([
      { type: 'equipment.unequip', slot: 'head' },
      { type: 'equipment.unequip', slot: 'head' },
      { type: 'equipment.equip', stackId: 'axe-stack', slot: 'mainHand' },
    ])
  })
})
