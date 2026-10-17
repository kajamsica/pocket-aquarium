import { describe, expect, it, vi } from 'vitest'
import { createElement, createRef, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { bindableActionCode, cameraOrbitFromDrag, CENTERED_CAMERA_ORBIT, DEFAULT_ACTION_KEYS, devDoubleTap, devNavigationEnabled, devSceneTapDecision, focusGameplayAfterClick, keybindCaptureVisible, keyboardDigIntent, keyboardEventTime, keyboardMineIntent, keyboardMovementIntents, movementVector, nextToolIntent, parseActionKeys, pointerAimTap, pointerDevNavigateIntent, pointerMovedBeyondOrbitThreshold, pointerV26TerrainKind, pointerV26TerrainTapIntent, pointerV29TerrainTapIntent, pointerV31SoilPlaceTapIntent, pointerWorkAimIntent, pointerWorkAimKind, releaseHeldControls, savedWorkKeyboardIntent, shouldHandleGameplayKey, terrainModeAfterSpadeChange, V29_NO_GROUND_TARGET_HINT, WizardSurface } from './WizardSurface'
import { WizardHud } from './WizardHud'
import { RouteKey, WizardMap, mapCellForArrow, mapDialogTabTarget, mapHeadingRotation, mapSheetMode, mapToggleForKey, northUpGridOrder, overviewForDetails } from './WizardMap'
import type { WizardTerrainCell, WizardViewProjection } from './contracts'
import { publicV13WorkIntentStillReady } from '../PublicV13Controller'
import { encodeDiscoveredTileIds } from '../domain/discoveryMask'
import { createFreshPublicWorld } from '../domain/publicWorldState'
import { withFreshPublicV7Herbs } from '../domain/publicWorldV7'
import { withFreshPublicV9Camps } from '../domain/publicWorldV9State'
import { withPublicV10TerrainRevision } from '../domain/publicWorldV10State'
import { withPublicV11Highland } from '../domain/publicWorldV11State'
import { withPublicV12Windstep } from '../domain/publicWorldV12State'
import type { PublicV13Head } from '../domain/publicWorldV13Snapshot'
import { emptyTerrainWorkLedger } from '../domain/terrainWorkLedger'
import { parseTerrainWorkId, resolveTerrainWorkSite } from '../domain/terrainWorks'
import { starterCliffCanonicalFace } from '../domain/starterCliffProfile'

const projection = {
  routes: [
    { id: 'bridge', label: 'Greenway bridge', from: [0, 0, 0], to: [1, 0, 1], built: false, unlocked: true, logCost: 6 },
    { id: 'pass', label: 'Highland pass', from: [1, 0, 1], to: [2, 0, 2], built: true, unlocked: true, logCost: 4 },
    { id: 'ford', label: 'Wetland ford', from: [2, 0, 2], to: [3, 0, 3], built: false, unlocked: false, logCost: 8 },
  ],
  buildSites: [
    { id: 'bridge-west', routeId: 'bridge', label: 'West bank crossing', from: [0, 0, 0], to: [1, 0, 1], logCost: 6, status: 'ready', reason: 'Ready to build', discovered: true },
    { id: 'bridge-east', routeId: 'bridge', label: 'East bank crossing', from: [2, 0, 0], to: [3, 0, 1], logCost: 6, status: 'too_far', reason: 'Move closer to the scaffold', discovered: true },
    { id: 'bridge-fog', routeId: 'bridge', label: 'Fogged crossing', from: [4, 0, 0], to: [5, 0, 1], logCost: 6, status: 'ready', reason: 'Ready to build', discovered: false },
  ],
  selectedBuildSiteId: null,
  map: {
    tiles: [
      { id: 'home', gridX: 0, gridZ: 0, terrain: 'loam', biome: 'meadow', discovered: true, hasResource: false, hasStore: true, hasRing: false, hasRouteSite: true, hasBuiltRoute: false },
      { id: 'fog', gridX: 1, gridZ: 0, terrain: null, biome: null, discovered: false, hasResource: false, hasStore: false, hasRing: false, hasRouteSite: true, hasBuiltRoute: false },
    ],
    player: { gridX: 0, gridZ: 0, yaw: 0 },
  },
} as unknown as WizardViewProjection

describe('dev-only ground navigation handoff', () => {
  const ground = { x: 5.75, y: 1.2, z: -12.25 }
  it('requires exactly the V42 dev URL, never the ordinary public world', () => {
    expect(devNavigationEnabled('?dev=1&publicWorld=v42')).toBe(true)
    expect(devNavigationEnabled('?publicWorld=v42')).toBe(false)
    expect(devNavigationEnabled('?dev=0&publicWorld=v42')).toBe(false)
    expect(devNavigationEnabled('?dev=1&publicWorld=v41')).toBe(false)
    expect(pointerDevNavigateIntent(devNavigationEnabled('?publicWorld=v42'), projection,
      false, ground)).toBeNull()
    expect(pointerDevNavigateIntent(devNavigationEnabled('?dev=1&publicWorld=v42'), projection,
      false, ground)).toEqual({ type: 'dev.navigate', destination: { x: 5.75, z: -12.25 } })
  })

  it('routes close dev double taps only with terrain tools off; active tools submit each tap immediately', () => {
    const first = { atMs: 100, point: [100, 100] as const }
    const second = { atMs: 345, point: [104, 103] as const }
    expect(devDoubleTap(first, { atMs: 345, point: [104, 103] })).toBe(true)
    expect(devDoubleTap(first, { atMs: 700, point: [100, 100] })).toBe(false)
    expect(devDoubleTap(first, { atMs: 200, point: [120, 100] })).toBe(false)
    expect(devDoubleTap(null, { atMs: 200, point: [100, 100] })).toBe(false)
    for (const mode of ['dig', 'fill', 'mine', 'place-soil'] as const) {
      expect(devSceneTapDecision(true, null, first, mode)).toBe('terrain')
      expect(devSceneTapDecision(true, first, second, mode)).toBe('terrain')
      expect(devSceneTapDecision(false, first, second, mode)).toBe('terrain')
    }
    expect(devSceneTapDecision(true, null, first, null)).toBe('terrain')
    expect(devSceneTapDecision(true, first, second, null)).toBe('navigate')
    expect(devSceneTapDecision(false, first, second, null)).toBe('terrain')
  })

  it('keeps map, store, Works, and obscured taps from routing even when tools are off', () => {
    const request = (current: WizardViewProjection, mapOpen: boolean,
      point: typeof ground | null = ground) => pointerDevNavigateIntent(true, current,
        mapOpen, point)
    expect(request(projection, true)).toBeNull()
    expect(request({ ...projection, openStoreId: 'outfitters' }, false)).toBeNull()
    expect(request({ ...projection, controllerActionsEnabled: false }, false)).toBeNull()
    expect(request({ ...projection, savedTerrainWorks: { modeActive: true } as WizardViewProjection['savedTerrainWorks'] }, false)).toBeNull()
    expect(request(projection, false, null)).toBeNull()
  })
})

type Props = Record<string, unknown>
const mapProps = (open: boolean, onToggle = vi.fn(), onIntent = vi.fn()) => ({ projection, open, onToggle, onIntent, buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>() })
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
  inscriptions: [], digSites: [], skillXp: { woodcutting: 0, construction: 0, wayfinding: 0, spellcraft: 0, excavation: 0 }, learnedSpellIds: [],
  backpack: { capacity: 20, stacks: [] },
  equipment: { head: null, chest: null, legs: null, feet: null, mainHand: null, offHand: null },
  tradeListings: [null, null, null, null], nearbyInteraction: null, recentEvents: [],
  openStoreId: 'store-greenway',
  stores: [{ id: 'store-greenway', name: 'Greenway Outfitters', position: [0, 0, 0],
    listings: [{ id: 'hat', name: 'Apprentice hat', price: 20, stock: 2 }],
    sellOffers: [{ itemId: 'logs', name: 'Greenway logs', quantity: 3, unitPrice: 4 }],
  }],
} as WizardViewProjection
const v29Mining = {
  tools: { basicPickOwned: true, enchantedPickOwned: false, activePick: 'basic' as const },
  offers: [{ tier: 'basic' as const, price: 35, owned: true, buyReason: 'Already owned.' },
    { tier: 'enchanted' as const, price: 240, owned: false,
      buyReason: 'Requires Excavation level 25.' }],
  bids: { soil: 1, stone: 3, iron_ore: 8, gold_ore: 15, diamond: 60 },
  bag: { soil: 2, stone: 1, iron_ore: 0, gold_ore: 0, diamond: 0 },
  excavationLevel: 2, atOutfitters: true,
} satisfies NonNullable<WizardViewProjection['v29Mining']>

describe('V29-only mining controls', () => {
  it('shows virtual pick ownership, main-hand state, mineral bids, and precise map guidance', () => {
    const current: WizardViewProjection = { ...sellProjection, v29Mining,
      v26ValleyRimSegments: [], v26TerrainBag: v29Mining.bag,
      controllerActionsEnabled: true }
    const hud = renderToStaticMarkup(createElement(WizardHud, { projection: current, onIntent: vi.fn() }))
    expect(hud).toContain('Basic pick (active)')
    expect(hud).toContain('Sell terrain bag')
    expect(hud).toContain('stone ×1 · 3g each')
    expect(hud).toContain('Requires Excavation level 25.')
    expect(hud).not.toContain('Store sales are not available yet.')
    const full = renderToStaticMarkup(createElement(WizardHud, { projection: {
      ...current, backpack: { ...current.backpack, capacity: 3 } }, onIntent: vi.fn() }))
    expect(full).toContain('Pack full.')
    expect(full).toContain('sell terrain-bag soil, stone, or ore')
    const map = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: current }))
    expect(map).toContain('Excavation level 2')
    expect(map).toContain('Ore is not guaranteed')
    expect(renderToStaticMarkup(createElement(WizardHud,
      { projection: sellProjection, onIntent: vi.fn() }))).not.toContain('Mining picks')
  })

  it('emits only narrow V29 purchase, equip, and checked mineral-sale intents', () => {
    const emitted: unknown[] = []
    const current: WizardViewProjection = { ...sellProjection, coins: 100,
      v29Mining: { ...v29Mining, tools: { ...v29Mining.tools, activePick: null },
        offers: [{ tier: 'basic', price: 35, owned: false, buyReason: null },
          v29Mining.offers[1]] } }
    const controls = findElements(renderHudTree({ projection: current,
      onIntent: (intent) => emitted.push(intent) }), (element) => element.type === 'button')
    const click = (label: string) => {
      const button = controls.find((element) => element.props['aria-label'] === label)
      expect(button).toBeDefined()
      expect(button!.props.disabled).toBe(false)
      ;(button!.props.onClick as () => void)()
    }
    click('Buy basic pick for 35 gold')
    click('Sell 1 soil')
    expect(emitted).toEqual([
      { type: 'v29.mining-tool', action: 'buy', tier: 'basic' },
      { type: 'v29.sell-mineral', material: 'soil', quantity: 1 },
    ])
    const owned = { ...current, v29Mining: { ...v29Mining,
      tools: { ...v29Mining.tools, activePick: null } } }
    const equip = findElements(renderHudTree({ projection: owned,
      onIntent: (intent) => emitted.push(intent) }), (element) =>
      element.props['aria-label'] === 'Equip basic pick')[0]
    ;(equip.props.onClick as () => void)()
    expect(emitted[2]).toEqual({ type: 'v29.mining-tool', action: 'equip', tier: 'basic' })
  })

  it('sends only the chosen geometric cell for a pick, not an assumed ore', () => {
    const current: WizardViewProjection = { ...sellProjection, v29Mining,
      v26ValleyRimSegments: [], openStoreId: null, controllerActionsEnabled: true }
    const press = { id: 7, start: [10, 10] as const, primary: true, dragged: false }
    const tap = () => pointerV29TerrainTapIntent(current, false, 'mine', press, 7,
      [10, 10], () => ({ gx: 1, gz: 0 }))
    expect(tap()).toEqual({ type: 'v29.deep-dig', gx: 1, gz: 0 })
    expect(pointerV29TerrainTapIntent(current, false, 'mine', press, 7,
      [10, 10], () => ({ gx: 3, gz: 4 }))).toBeNull()
    expect(pointerV29TerrainTapIntent({ ...current, player: { ...current.player,
      position: [0, 0, 1.01] } }, false, 'mine', press, 7,
      [10, 10], () => ({ gx: 0, gz: -1 }))).toBeNull()
    expect(pointerV29TerrainTapIntent(current, false, 'dig', press, 7,
      [10, 10], () => ({ gx: 3, gz: 4 }))).toBeNull()
    expect(pointerV29TerrainTapIntent({ ...current, v29Mining: undefined }, false,
      'mine', press, 7, [10, 10], () => ({ gx: 3, gz: 4 }))).toBeNull()
    expect(pointerV29TerrainTapIntent(current, true, 'mine', press, 7,
      [10, 10], () => ({ gx: 3, gz: 4 }))).toBeNull()
    const surface = renderToStaticMarkup(createElement(WizardSurface,
      { projection: current, onIntent: vi.fn() }))
    expect(surface).toContain('Active basic pick')
    expect(surface).toContain('an outline shows the target when available')
    expect(surface).toContain('The checked action reports its layer, reach, skill, tool, and capacity result.')
    expect(surface).toContain('Not every cell holds ore.')
  })

  it('uses the same visible, in-reach Mine target for the equipped-pick key', () => {
    const current: WizardViewProjection = { ...sellProjection, v29Mining,
      v26ValleyRimSegments: [], openStoreId: null, controllerActionsEnabled: true }
    const picker = vi.fn(() => ({ gx: 1, gz: 0 }))
    expect(keyboardMineIntent(current, false, [200, 100], picker))
      .toEqual({ type: 'v29.deep-dig', gx: 1, gz: 0 })
    expect(picker).toHaveBeenCalledWith(200, 100, 'v29-open-pit')
    expect(keyboardMineIntent(current, false, null, picker)).toBeNull()
    expect(keyboardMineIntent(current, false, [200, 100], () => null)).toBeNull()
    expect(keyboardMineIntent(current, false, [200, 100], () => ({ gx: 3, gz: 4 }))).toBeNull()
    expect(keyboardMineIntent(current, true, [200, 100], picker)).toBeNull()
    expect(keyboardMineIntent({ ...current, openStoreId: 'store-greenway' }, false,
      [200, 100], picker)).toBeNull()
    expect(keyboardMineIntent({ ...current, savedTerrainWorks: { actionsEnabled: true,
      modeActive: true, builtSites: [], dugTileIds: [], preview: null } }, false,
    [200, 100], picker)).toBeNull()
    expect(keyboardMineIntent({ ...current, v29Mining: { ...v29Mining,
      tools: { ...v29Mining.tools, activePick: null } } }, false, [200, 100], picker)).toBeNull()
    const panel = renderToStaticMarkup(createElement(WizardSurface,
      { projection: current, onIntent: vi.fn() }))
    expect(panel).toContain('Keys: G Mine · Q Tool')
    expect(panel).toContain('aria-label="Rebind Mine"')
  })

  it('tells a V29 Dig or Mine player to wait for an outline and explains an occluded no-target tap', () => {
    const pickView: WizardViewProjection = { ...sellProjection, v29Mining,
      v26ValleyRimSegments: [], openStoreId: null, controllerActionsEnabled: true }
    const pickPanel = renderToStaticMarkup(createElement(WizardSurface,
      { projection: pickView, onIntent: vi.fn() }))
    expect(pickPanel).toContain('Tap or click clear ground within 5 m; an outline shows the target when available.')
    expect(pickPanel).toContain('The checked action reports its layer, reach, skill, tool, and capacity result.')
    expect(V29_NO_GROUND_TARGET_HINT).toContain('No ground cell in reach targeted.')
    expect(V29_NO_GROUND_TARGET_HINT).toContain('within 5 m')
    expect(V29_NO_GROUND_TARGET_HINT).toContain('foreground tree or rock')
    const press = { id: 1, start: [10, 10] as const, primary: true, dragged: false }
    expect(pointerV29TerrainTapIntent(pickView, false, 'mine', press, 1,
      [10, 10], () => null)).toBeNull()
    const spadeView: WizardViewProjection = { ...pickView,
      equipment: { ...pickView.equipment, mainHand: { id: 'spade', itemId: 'field_spade',
        name: 'Field spade', quantity: 1 } },
      v29Mining: { ...v29Mining, tools: { ...v29Mining.tools, activePick: null } } }
    const spadePanel = renderToStaticMarkup(createElement(WizardSurface,
      { projection: spadeView, onIntent: vi.fn() }))
    expect(spadePanel).toContain('Select Dig, then tap or click clear, revealed dry ground within 5 m.')
    expect(spadePanel).toContain('Trees and rocks can block the view; the checked action decides if this soil layer is safe and in reach.')
    expect(pointerV26TerrainTapIntent(spadeView, false, 'dig', press, 1,
      [10, 10], () => null)).toBeNull()
    const historical = renderToStaticMarkup(createElement(WizardSurface, { projection: {
      ...spadeView, v29Mining: undefined }, onIntent: vi.fn() }))
    expect(historical).not.toContain('Trees and rocks can block the view; the checked action decides if this soil layer is safe and in reach.')
    const inPit = { ...pickView, v26OpenPitColumns: [{ gx: 0, gz: 0, openDepth: 1 }] }
    expect(renderToStaticMarkup(createElement(WizardSurface,
      { projection: inPit, onIntent: vi.fn() }))).toContain('Open pit view: step onto neighboring ground or orbit')
    expect(renderToStaticMarkup(createElement(WizardSurface,
      { projection: { ...inPit, player: { ...inPit.player, position: [4, 0, 0] } }, onIntent: vi.fn() })))
      .not.toContain('Open pit view:')
    expect(renderToStaticMarkup(createElement(WizardSurface,
      { projection: { ...inPit, v29Mining: undefined }, onIntent: vi.fn() })))
      .not.toContain('Open pit view:')
  })
})
const findElements = (node: ReactNode, matches: (element: ReactElement<Props>) => boolean): ReactElement<Props>[] => {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, matches))
  if (!isValidElement<Props>(node)) return []
  const nested = findElements(node.props.children as ReactNode, matches)
  return matches(node) ? [node, ...nested] : nested
}

// Capture the HUD tree during a React render, so its hooks have a renderer while
// intent tests can still inspect and invoke the actual button handlers.
const renderHudTree = (props: Parameters<typeof WizardHud>[0]): ReactNode => {
  let tree: ReactNode = null
  function CaptureHud() {
    tree = WizardHud(props)
    return null
  }
  renderToStaticMarkup(createElement(CaptureHud))
  return tree
}

describe('third-person control grammar', () => {
  it('loads only valid versioned, non-conflicting action keys and exposes them in compact controls', () => {
    expect(parseActionKeys(null)).toEqual(DEFAULT_ACTION_KEYS)
    expect(parseActionKeys('{bad')).toEqual(DEFAULT_ACTION_KEYS)
    expect(parseActionKeys(JSON.stringify({ version: 2, dig: 'KeyH', switchTool: 'KeyJ' })))
      .toEqual(DEFAULT_ACTION_KEYS)
    expect(parseActionKeys(JSON.stringify({ version: 1, dig: 'KeyH', switchTool: 'Digit4' })))
      .toEqual({ dig: 'KeyH', switchTool: 'Digit4' })
    for (const code of ['KeyW', 'KeyB', 'Digit1', 'Space', 'Escape', 'Tab', 'Enter', 'KeyQ']) {
      expect(bindableActionCode(code, 'KeyQ')).toBe(false)
    }
    expect(bindableActionCode('KeyH', 'KeyQ')).toBe(true)
    const view = { ...sellProjection, openStoreId: null, v26ValleyRimSegments: [] }
    const html = renderToStaticMarkup(createElement(WizardSurface, { projection: view, onIntent: vi.fn() }))
    expect(html).toContain('Keys: G Dig · Q Tool')
    expect(html).toContain('aria-label="Rebind Dig"')
    expect(html).toContain('aria-label="Rebind Switch tool"')
  })

  it('captures a pending rebind only while its actual details and terrain panel are visible', () => {
    const view = { ...sellProjection, openStoreId: null,
      v26ValleyRimSegments: [] } as WizardViewProjection
    expect(keybindCaptureVisible(view, false, true)).toBe(true)
    expect(keybindCaptureVisible(view, false, false)).toBe(false)
    expect(keybindCaptureVisible(view, true, true)).toBe(false)
    expect(keybindCaptureVisible({ ...view, openStoreId: 'store-greenway' }, false, true)).toBe(false)
    expect(keybindCaptureVisible({ ...view, savedTerrainWorks: { actionsEnabled: true,
      modeActive: true, builtSites: [], dugTileIds: [], preview: null } }, false, true)).toBe(false)
    expect(keybindCaptureVisible({ ...view, v26ValleyRimSegments: undefined }, false, true)).toBe(false)
  })

  it('digs only the hovered frontmost revealed dry cell with the checked spade gate', () => {
    const ground: WizardTerrainCell = { id: 'tile-3-3', position: [0, 1, 0],
      size: [4, 4], height: 1.8, climate: 'temperate_forest' }
    const current = { ...sellProjection, seed: 'wizard-realms', openStoreId: null,
      controllerActionsEnabled: true, terrain: [ground], v26ValleyRimSegments: [],
      player: { ...sellProjection.player, position: [0, 1, 0] as const },
      equipment: { ...sellProjection.equipment, mainHand: { id: 'spade-1', itemId: 'field_spade',
        name: 'Field spade', quantity: 1 } } } as WizardViewProjection
    const picker = vi.fn(() => ({ gx: 0, gz: 0 }))
    expect(keyboardDigIntent(current, false, [200, 100], picker))
      .toEqual({ type: 'v26.terrain', kind: 'dig', gx: 0, gz: 0 })
    expect(picker).toHaveBeenCalledWith(200, 100, 'dig')
    expect(keyboardDigIntent(current, false, null, picker)).toBeNull()
    expect(keyboardDigIntent(current, true, [200, 100], picker)).toBeNull()
    expect(keyboardDigIntent({ ...current, equipment: sellProjection.equipment }, false,
      [200, 100], picker)).toBeNull()
    expect(keyboardDigIntent({ ...current, terrain: [] }, false, [200, 100], picker)).toBeNull()
    expect(keyboardDigIntent({ ...current, player: { ...current.player,
      position: [40, 1, 0] } }, false, [200, 100], picker)).toBeNull()
    expect(keyboardDigIntent({ ...current, savedTerrainWorks: { actionsEnabled: true,
      modeActive: true, builtSites: [], dugTileIds: [], preview: null } }, false,
    [200, 100], picker)).toBeNull()
    expect(keyboardDigIntent(current, false, [200, 100], () => null)).toBeNull()
  })

  it('cycles only owned actionable main-hand gear and never buys or unequips', () => {
    const axe = { id: 'axe-1', itemId: 'woodcutters_axe', name: 'Axe', quantity: 1,
      equippableSlots: ['mainHand'] as const }
    const spade = { id: 'spade-1', itemId: 'field_spade', name: 'Spade', quantity: 1,
      equippableSlots: ['mainHand'] as const }
    const current = { ...sellProjection, openStoreId: null, controllerActionsEnabled: true,
      backpack: { ...sellProjection.backpack, stacks: [axe, spade] },
      equipment: { ...sellProjection.equipment, mainHand: axe },
      v29Mining: { ...v29Mining, tools: { ...v29Mining.tools, activePick: null } } } as WizardViewProjection
    expect(nextToolIntent(current)).toEqual({ type: 'equipment.equip', stackId: 'spade-1', slot: 'mainHand' })
    expect(nextToolIntent({ ...current, equipment: { ...current.equipment, mainHand: spade } }))
      .toEqual({ type: 'v29.mining-tool', action: 'equip', tier: 'basic' })
    expect(nextToolIntent({ ...current, equipment: { ...current.equipment, mainHand: spade },
      checkedEquipmentChoices: [{ itemId: 'woodcutters_axe', actionable: true, reason: null }] }))
      .toEqual({ type: 'v29.mining-tool', action: 'equip', tier: 'basic' })
    expect(nextToolIntent({ ...current, equipment: { ...current.equipment, mainHand: null },
      v29Mining })).toEqual({ type: 'equipment.equip', stackId: 'axe-1', slot: 'mainHand' })
    expect(nextToolIntent({ ...current, checkedEquipmentChoices: [
      { itemId: 'woodcutters_axe', actionable: false, reason: 'Blocked' },
      { itemId: 'field_spade', actionable: true, reason: null }],
      v29Mining: undefined })).toEqual({ type: 'equipment.equip', stackId: 'spade-1', slot: 'mainHand' })
    expect(nextToolIntent({ ...current, backpack: { ...current.backpack, stacks: [] },
      v29Mining: undefined })).toBeNull()
    expect(nextToolIntent({ ...current, openStoreId: 'store-greenway' })).toBeNull()
    expect(nextToolIntent({ ...current, controllerActionsEnabled: false })).toBeNull()
  })
  it('shows V31 Place soil only in V31 and submits a checked top-cell intent under spade gates', () => {
    const ready: WizardViewProjection = { ...sellProjection, openStoreId: null,
      controllerActionsEnabled: true, v26ValleyRimSegments: [],
      equipment: { ...sellProjection.equipment, mainHand: { id: 'spade-1',
        itemId: 'field_spade', name: 'Field spade', quantity: 1 } },
      v31Soil: { raisedCells: [], soilAvailable: 2 } }
    const press = { id: 7, start: [200, 100] as const, primary: true, dragged: false }
    const picker = vi.fn(() => ({ gx: 1, gz: 0 }))
    expect(pointerV31SoilPlaceTapIntent(ready, false, 'place-soil', press, 7,
      [201, 101], picker)).toEqual({ type: 'v31.soil-place', gx: 1, gz: 0 })
    for (const view of [{ ...ready, v31Soil: undefined },
      { ...ready, v31Soil: { raisedCells: [], soilAvailable: 0 } },
      { ...ready, controllerActionsEnabled: false },
      { ...ready, equipment: sellProjection.equipment },
      { ...ready, savedTerrainWorks: { context: 'works4-greenway' as const,
        actionsEnabled: true, modeActive: true, builtSites: [], dugTileIds: [], preview: null } }]) {
      expect(pointerV31SoilPlaceTapIntent(view, false, 'place-soil', press, 7,
        [201, 101], picker)).toBeNull()
    }
    expect(pointerV31SoilPlaceTapIntent(ready, true, 'place-soil', press, 7,
      [201, 101], picker)).toBeNull()
    expect(pointerV31SoilPlaceTapIntent(ready, false, 'dig', press, 7,
      [201, 101], picker)).toBeNull()
    expect(pointerV31SoilPlaceTapIntent(ready, false, 'place-soil', press, 7,
      [201, 101], () => null)).toBeNull()
    expect(renderToStaticMarkup(createElement(WizardSurface,
      { projection: ready, onIntent: vi.fn() }))).toContain('Place soil')
    expect(renderToStaticMarkup(createElement(WizardSurface,
      { projection: { ...ready, v31Soil: undefined }, onIntent: vi.fn() })))
      .not.toContain('Place soil')
  })

  it('dispatches V26 terrain only for a spade-equipped primary tap with world actions ready', () => {
    const ready = { ...sellProjection, openStoreId: null, controllerActionsEnabled: true,
      v26ValleyRimSegments: [], equipment: { ...sellProjection.equipment,
        mainHand: { id: 'spade-1', itemId: 'field_spade', name: 'Field spade', quantity: 1 } } }
    const press = { id: 7, start: [200, 100] as const, primary: true, dragged: false }
    const end = [202, 101] as const
    const picker = vi.fn(() => ({ gx: 3, gz: 1 }))
    expect(pointerV26TerrainKind(ready, false, 'dig')).toBe('dig')
    expect(pointerV26TerrainTapIntent(ready, false, 'dig', press, 7, end, picker))
      .toEqual({ type: 'v26.terrain', kind: 'dig', gx: 3, gz: 1 })
    expect(pointerV26TerrainTapIntent(ready, false, 'fill', press, 7, end, picker))
      .toEqual({ type: 'v26.terrain', kind: 'fill', gx: 3, gz: 1 })
    picker.mockClear()
    for (const [candidate, mapOpen, mode, pointer] of [
      [ready, true, 'dig', press], [ready, false, null, press],
      [{ ...ready, controllerActionsEnabled: false }, false, 'dig', press],
      [{ ...ready, unavailableActions: true }, false, 'dig', press],
      [{ ...ready, openStoreId: 'store-greenway' }, false, 'dig', press],
      [{ ...ready, v26ValleyRimSegments: undefined }, false, 'dig', press],
      [{ ...ready, equipment: sellProjection.equipment }, false, 'dig', press],
      [{ ...ready, savedTerrainWorks: { context: 'works4-greenway', actionsEnabled: true,
        modeActive: true, selectedKind: 'bridge', builtSites: [], dugTileIds: [], preview: null } }, false, 'dig', press],
      [ready, false, 'dig', { ...press, dragged: true }],
      [ready, false, 'dig', { ...press, primary: false }],
    ] as const) {
      expect(pointerV26TerrainTapIntent(candidate as WizardViewProjection, mapOpen, mode,
        pointer, 7, end, picker)).toBeNull()
    }
    expect(pointerV26TerrainTapIntent(ready, false, 'dig', press, 7, [208, 101], picker))
      .toBeNull()
    expect(picker).not.toHaveBeenCalled()
    expect(pointerV26TerrainTapIntent(ready, false, 'dig', press, 7, end, () => null)).toBeNull()
    expect(pointerV26TerrainTapIntent(ready, false, 'dig', press, 7, end,
      () => ({ gx: Number.NaN, gz: 1 }))).toBeNull()
    expect(pointerV26TerrainTapIntent(ready, false, 'dig', press, 7, end,
      () => ({ gx: Number.MAX_SAFE_INTEGER, gz: 1 }))).toBeNull()
  })

  it('defaults an initially equipped spade to Dig and keeps the V26 controls', () => {
    const current = { ...sellProjection, openStoreId: null, controllerActionsEnabled: true,
      v26ValleyRimSegments: [] } as WizardViewProjection
    const missing = renderToStaticMarkup(createElement(WizardSurface, { projection: current, onIntent: vi.fn() }))
    expect(missing).toContain('aria-label="Terrain tools"')
    expect(missing).toContain('Equip a field spade to work the ground.')
    expect(missing).toContain('min-height:44px')
    const equipped = { ...current, equipment: { ...current.equipment,
      mainHand: { id: 'spade-1', itemId: 'field_spade', name: 'Field spade', quantity: 1 } } }
    const enabled = renderToStaticMarkup(createElement(WizardSurface, { projection: equipped, onIntent: vi.fn() }))
    expect(enabled).toContain('Tap revealed dry ground to dig one layer.')
    expect(enabled).toMatch(/aria-pressed="true"[^>]*>Dig<\/button>/)
    expect(enabled).toMatch(/aria-pressed="false"[^>]*>Fill<\/button>/)
    expect(enabled).toContain('equip spade to dig, choose Fill to refill')
    const restricted = renderToStaticMarkup(createElement(WizardSurface, {
      projection: { ...equipped, unavailableActions: true }, onIntent: vi.fn() }))
    expect(restricted).toContain('Terrain actions are unavailable in this region.')
    expect(restricted).not.toContain('Terrain actions are unavailable while the world is saving.')
    const paused = renderToStaticMarkup(createElement(WizardSurface, {
      projection: { ...equipped, controllerActionsEnabled: false }, onIntent: vi.fn() }))
    expect(paused).toContain('Terrain actions are unavailable while the world is saving.')
    expect(renderToStaticMarkup(createElement(WizardSurface, { projection: sellProjection, onIntent: vi.fn() })))
      .not.toContain('aria-label="Terrain tools"')
  })

  it('selects Dig on equip and re-equip while preserving explicit Fill and Off until unequip', () => {
    expect(terrainModeAfterSpadeChange(false, true, null)).toBe('dig')
    expect(terrainModeAfterSpadeChange(true, true, 'fill')).toBe('fill')
    expect(terrainModeAfterSpadeChange(true, true, null)).toBeNull()
    expect(terrainModeAfterSpadeChange(true, false, 'fill')).toBeNull()
    expect(terrainModeAfterSpadeChange(false, true, null)).toBe('dig')
  })

  it('gates direct pointer aim to active, healthy Greenway Bridge or Ladder and keeps orbit drags distinct', () => {
    const saved = { context: 'works4-greenway' as const, actionsEnabled: true,
      modeActive: true, selectedKind: 'bridge' as const, builtSites: [], dugTileIds: [], preview: null }
    const current = { ...projection, controllerActionsEnabled: true,
      savedTerrainWorks: saved } as WizardViewProjection
    expect(pointerWorkAimKind(current, false)).toBe('bridge')
    expect(pointerWorkAimKind({ ...current, savedTerrainWorks: { ...saved, selectedKind: 'ladder' } }, false)).toBe('ladder')
    expect(pointerWorkAimKind(current, true)).toBeNull()
    expect(pointerWorkAimKind({ ...current, controllerActionsEnabled: false }, false)).toBeNull()
    expect(pointerWorkAimKind({ ...current, unavailableActions: true }, false)).toBeNull()
    expect(pointerWorkAimKind({ ...current, savedTerrainWorks: { ...saved, actionsEnabled: false } }, false)).toBeNull()
    expect(pointerWorkAimKind({ ...current, savedTerrainWorks: { ...saved, modeActive: false } }, false)).toBeNull()
    expect(pointerWorkAimKind({ ...current, savedTerrainWorks: { ...saved, selectedKind: 'dig' } }, false)).toBeNull()
    expect(pointerWorkAimKind({ ...current, savedTerrainWorks: { ...saved, context: 'works3-greenway' } }, false)).toBeNull()
    const river = { ...current, savedTerrainWorks: { ...saved, context: 'v28-river' as const } }
    expect(pointerWorkAimKind(river, false)).toBe('river-bridge')
    expect(pointerWorkAimIntent('river-bridge', -56))
      .toEqual({ type: 'saved-work.aim', aimX: -56 })
    expect(pointerWorkAimKind({ ...river, savedTerrainWorks: {
      ...river.savedTerrainWorks!, selectedKind: 'ladder' } }, false)).toBeNull()
    expect(pointerMovedBeyondOrbitThreshold([10, 20], [16, 20])).toBe(false)
    expect(pointerMovedBeyondOrbitThreshold([10, 20], [16.1, 20])).toBe(true)
    const press = { id: 1, start: [10, 20] as const, primary: true, dragged: false }
    expect(pointerAimTap(press, 1, [14, 20])).toBe(true)
    expect(pointerAimTap(press, 1, [17, 20])).toBe(false)
    expect(pointerAimTap({ ...press, dragged: true }, 1, [10, 20])).toBe(false)
    expect(pointerAimTap({ ...press, primary: false }, 1, [10, 20])).toBe(false)
    expect(pointerAimTap(press, 2, [10, 20])).toBe(false)
    expect(pointerAimTap(null, 1, [10, 20])).toBe(false)
  })

  it('routes a primary west-face touch tap to Z only while regional Works Ladder is active', () => {
    const saved = { actionsEnabled: true, modeActive: true, selectedKind: 'ladder' as const,
      builtSites: [], dugTileIds: [], preview: null }
    const regional = { ...projection, controllerActionsEnabled: true, unavailableActions: true,
      savedTerrainWorks: saved, regionalLadders: { builtSites: [], preview: null },
      visualWorld: { discoveredTileIds: [] } } as unknown as WizardViewProjection
    expect(pointerWorkAimKind(regional, false)).toBe('regional-ladder')
    expect(pointerWorkAimKind(regional, true)).toBeNull()
    expect(pointerWorkAimKind({ ...regional, controllerActionsEnabled: false }, false)).toBeNull()
    expect(pointerWorkAimKind({ ...regional, regionalLadders: undefined }, false)).toBeNull()
    expect(pointerWorkAimKind({ ...regional, savedTerrainWorks: { ...saved,
      modeActive: false } }, false)).toBeNull()
    expect(pointerWorkAimKind({ ...regional, savedTerrainWorks: { ...saved,
      selectedKind: 'bridge' } }, false)).toBeNull()
    const touch = { id: 7, start: [200, 100] as const, primary: true, dragged: false }
    expect(pointerAimTap(touch, 7, [202, 101])).toBe(true)
    expect(pointerAimTap({ ...touch, dragged: true }, 7, [202, 101])).toBe(false)
    expect(pointerAimTap(touch, 7, [208, 101])).toBe(false)
    expect(pointerWorkAimIntent('regional-ladder', 430.6))
      .toEqual({ type: 'saved-work.aim-west', aimZ: 430.6 })
    expect(pointerWorkAimIntent('bridge', 1.5)).toEqual({ type: 'saved-work.aim', aimX: 1.5 })
    expect(pointerWorkAimIntent('ladder', -2)).toEqual({ type: 'saved-work.aim', aimX: -2 })
    expect(pointerWorkAimIntent('regional-ladder', null)).toBeNull()
    expect(pointerWorkAimIntent('regional-ladder', Number.NaN)).toBeNull()
  })

  it('returns pointer button clicks to gameplay without moving keyboard, slider, map or touch focus', () => {
    const root = { focus: vi.fn() } as unknown as HTMLElement
    const target = (hudButton: boolean, touch = false) => ({
      closest: (selector: string) => selector === '.wr-hud button, .wr-backpack-toggle, .wr-v26-terrain button'
        ? hudButton ? {} : null : touch ? {} : null,
    }) as unknown as Element
    focusGameplayAfterClick(root, target(true), 1)
    expect(root.focus).toHaveBeenCalledWith({ preventScroll: true })
    root.focus = vi.fn()
    focusGameplayAfterClick(root, target(true), 0)
    focusGameplayAfterClick(root, target(false), 1)
    focusGameplayAfterClick(root, target(true, true), 1)
    expect(root.focus).not.toHaveBeenCalled()
  })

  it('keeps gameplay keys on controls without stealing native Space activation', () => {
    const key = (code: string, target: Partial<HTMLInputElement>) => ({ code, repeat: false,
      target: target as EventTarget })
    const button = { tagName: 'BUTTON', closest: () => ({}) }
    expect(shouldHandleGameplayKey(key('KeyW', button))).toBe(true)
    expect(shouldHandleGameplayKey(key('KeyB', button))).toBe(true)
    expect(shouldHandleGameplayKey(key('KeyF', button))).toBe(true)
    expect(shouldHandleGameplayKey(key('Space', button))).toBe(false)
    expect(shouldHandleGameplayKey(key('Space', { tagName: 'DIV', closest: () => null }))).toBe(true)
    for (const ancestor of ['button', 'summary', 'details', 'dialog', 'menu', 'a',
      '[role="button"]', '[role="dialog"]', '[role="menu"]', '[role="menuitem"]']) {
      const nested = { tagName: 'SPAN', closest: (selector: string) => selector.split(', ').includes(ancestor) ? {} : null }
      expect(shouldHandleGameplayKey(key('Space', nested))).toBe(false)
      expect(shouldHandleGameplayKey(key('Enter', nested))).toBe(true)
    }
    expect(shouldHandleGameplayKey(key('KeyW', { tagName: 'SUMMARY', closest: () => ({}) }))).toBe(true)
    expect(shouldHandleGameplayKey(key('KeyW', { tagName: 'INPUT', type: 'range' }))).toBe(false)
    expect(shouldHandleGameplayKey(key('Space', { tagName: 'INPUT', type: 'range' }))).toBe(false)
    expect(shouldHandleGameplayKey(key('KeyB', { tagName: 'INPUT', type: 'text' }))).toBe(false)
    expect(shouldHandleGameplayKey(key('KeyF', { tagName: 'TEXTAREA' }))).toBe(false)
    expect(shouldHandleGameplayKey(key('KeyW', { tagName: 'DIV', isContentEditable: true }))).toBe(false)
    expect(shouldHandleGameplayKey({ ...key('KeyW', button), repeat: true })).toBe(false)
  })

  it('rechecks an immediate turn or move before accepting the formerly aimed F intent', () => {
    const seed = 'greenway-alpha'
    const bridge = resolveTerrainWorkSite(seed, 'works1:bridge:-102:92:z')!
    if (bridge.kind !== 'bridge') throw new Error('Missing bridge fixture')
    const source = withPublicV12Windstep(withPublicV11Highland(withPublicV10TerrainRevision(
      withFreshPublicV9Camps(withFreshPublicV7Herbs(
        createFreshPublicWorld(seed, 'greenway-classic-v1'))))))
    const { discoveredTileIds, ...legacy } = source
    const midpoint = { x: (bridge.from.x + bridge.to.x) / 2,
      z: (bridge.from.z + bridge.to.z) / 2 }
    const yaw = Math.atan2(bridge.from.x - midpoint.x, bridge.from.z - midpoint.z)
    const state: PublicV13Head['state'] = { ...legacy, movementOwner: 'streamed',
      discoveryMask: encodeDiscoveredTileIds([...new Set([...discoveredTileIds,
        ...bridge.footprintTileIds])].sort()), terrainWorks: emptyTerrainWorkLedger(),
      player: { ...legacy.player, position: { ...bridge.from }, yaw,
        backpackCapacity: 30, inventory: [...legacy.player.inventory,
          { itemId: 'logs', quantity: 12 }] } }
    const anchor = parseTerrainWorkId(bridge.id)!
    const window = { minGX: anchor.gx - 7, maxGX: anchor.gx + 8,
      minGZ: anchor.gz - 7, maxGZ: anchor.gz + 8 }
    const stillReady = (current: PublicV13Head['state']) =>
      publicV13WorkIntentStillReady(current, 'bridge', window, [bridge], bridge.id)
    expect(stillReady(state)).toBe(true)
    const oldF = savedWorkKeyboardIntent('KeyF', { actionsEnabled: true, modeActive: true,
      builtSites: [], dugTileIds: [], preview: { selected: { site: bridge, angleRadians: 0,
        distanceMeters: 2, rejection: null, reason: 'Ready', benefit: 'Costs 8 logs' },
        nearby: [], guidance: null } })
    expect(oldF).toEqual({ type: 'saved-work.confirm', id: bridge.id })
    expect(publicV13WorkIntentStillReady(state, 'ladder', window, [bridge], bridge.id)).toBe(false)
    expect(stillReady({ ...state, player: { ...state.player, yaw: yaw + Math.PI } })).toBe(false)
    expect(stillReady({ ...state, player: { ...state.player,
      position: { ...state.player.position, z: state.player.position.z + 5 } } })).toBe(false)
  })

  it('maps B, 1/2/3, F and Escape only through the visible Works mode', () => {
    const bridge = resolveTerrainWorkSite('greenway-alpha', 'works1:bridge:-102:92:z')!
    const off = { actionsEnabled: true, modeActive: false, selectedKind: 'bridge' as const,
      builtSites: [], dugTileIds: [], preview: null }
    expect(savedWorkKeyboardIntent('KeyB', off)).toEqual({ type: 'saved-work.mode', active: true })
    expect(savedWorkKeyboardIntent('Digit1', off)).toBeNull()
    expect(savedWorkKeyboardIntent('KeyF', off)).toBeNull()
    const choice = { site: bridge, angleRadians: 0, distanceMeters: 2,
      rejection: null, reason: 'Ready to build here.', benefit: 'Costs 8 logs.' }
    const on = { ...off, modeActive: true,
      preview: { selected: choice, nearby: [choice], guidance: null } }
    expect(savedWorkKeyboardIntent('KeyB', on)).toEqual({ type: 'saved-work.mode', active: false })
    expect(savedWorkKeyboardIntent('Digit1', on)).toEqual({ type: 'saved-work.kind', kind: 'bridge' })
    expect(savedWorkKeyboardIntent('Digit2', on)).toEqual({ type: 'saved-work.kind', kind: 'ladder' })
    expect(savedWorkKeyboardIntent('Digit2', { ...on, context: 'starter-greenway' })).toBeNull()
    expect(savedWorkKeyboardIntent('Digit2', { ...on, context: 'works3-greenway' }))
      .toEqual({ type: 'saved-work.kind', kind: 'ladder' })
    expect(savedWorkKeyboardIntent('Digit1', { ...on, context: 'starter-greenway' }))
      .toEqual({ type: 'saved-work.kind', kind: 'bridge' })
    expect(savedWorkKeyboardIntent('Digit3', on)).toEqual({ type: 'saved-work.kind', kind: 'dig' })
    expect(savedWorkKeyboardIntent('Digit3', on, true)).toBeNull()
    expect(savedWorkKeyboardIntent('KeyF', on)).toEqual({ type: 'saved-work.confirm', id: bridge.id })
    expect(savedWorkKeyboardIntent('KeyF', on, true)).toEqual({ type: 'saved-work.confirm', id: bridge.id })
    const v28 = { ...on, context: 'v28-river' as const, preview: { ...on.preview,
      selected: { ...choice, site: { ...bridge, id: 'works6:river-bridge:-14' } } } }
    expect(savedWorkKeyboardIntent('KeyB', v28)).toEqual({ type: 'saved-work.mode', active: false })
    expect(savedWorkKeyboardIntent('Digit1', v28)).toEqual({ type: 'saved-work.kind', kind: 'bridge' })
    expect(savedWorkKeyboardIntent('KeyF', v28))
      .toEqual({ type: 'saved-work.confirm', id: 'works6:river-bridge:-14' })
    expect(savedWorkKeyboardIntent('KeyF', { ...on, selectedKind: 'dig' as const }, true)).toBeNull()
    expect(savedWorkKeyboardIntent('Escape', on)).toEqual({ type: 'saved-work.mode', active: false })
    expect(savedWorkKeyboardIntent('KeyF', { ...on, preview: { ...on.preview,
      selected: { ...choice, rejection: 'not_owned' as const } } })).toBeNull()
    expect(savedWorkKeyboardIntent('KeyF', { ...on, actionsEnabled: false })).toBeNull()
    expect(savedWorkKeyboardIntent('KeyB', { ...on, actionsEnabled: false })).toBeNull()
    expect(savedWorkKeyboardIntent('KeyB', { ...on, preview: null, modeActive: false,
      actionsEnabled: false })).toBeNull()
  })

  it('offers collapsed novice work guidance in Greenway without changing the compact map', () => {
    const current = { ...projection, savedTerrainWorks: {
      actionsEnabled: false, builtSites: [], dugTileIds: [], preview: null,
    } } as WizardViewProjection
    const expanded = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: current }))
    expect(expanded).toContain('<details class="wr-map-work-guide"><summary>How to reach Mireglass and use Works</summary>')
    expect(expanded).toContain('follow the west trail (⇦) through the dry gap')
    expect(expanded).toContain('Bring 8 logs')
    expect(expanded).toContain('Bring 4 logs')
    expect(expanded).toContain('Own and equip a field spade')
    expect(expanded).toContain('Saved building and digging become available beyond Greenway.')
    expect(expanded).toContain('min-height:44px')
    expect(expanded).toContain('summary:focus-visible')
    expect(expanded).toContain('overflow-wrap:anywhere')
    expect(renderToStaticMarkup(createElement(WizardMap, { ...mapProps(false), projection: current }))).toBe(renderMap(false))
    expect(renderMap(true)).not.toContain('wr-map-work-guide')
  })

  it('explains all three checked v16 Greenway Works without changing v15 map guidance', () => {
    const saved = { actionsEnabled: true, modeActive: true, selectedKind: 'ladder' as const,
      builtSites: [], dugTileIds: [], preview: null }
    const v16 = { ...projection, savedTerrainWorks: {
      ...saved, context: 'works3-greenway' as const } } as WizardViewProjection
    const html = renderToStaticMarkup(createElement(WizardMap,
      { ...mapProps(true), projection: v16 }))
    expect(html).toContain('How to bridge, climb, and dig in Greenway')
    expect(html).toContain('Ladder with 2')
    expect(html).toContain('clear off-center ladders')
    expect(html).not.toContain('The separate starter ladder climbs the north cliff.')
    const v15 = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true),
      projection: { ...v16, savedTerrainWorks: {
        ...saved, context: 'starter-greenway' } } }))
    expect(v15).toContain('How to cross the creek and dig')
    expect(v15).toContain('choose Bridge with 1 or Dig with 3')
    expect(v15).not.toContain('Ladder with 2')
  })

  it('shows precise dig range and adjacent stance in the v16 HUD and map', () => {
    const dig = resolveTerrainWorkSite('greenway-alpha', 'tile--64-76')
    if (dig?.kind !== 'dig') throw new Error('Missing dig fixture')
    const reason = 'Stand beside the marked dig ground, not on it; choose another patch if it overlaps saved works.'
    const choice = { site: dig, distanceMeters: 3.75, angleRadians: 0,
      rejection: 'occupied' as const, reason, benefit: 'One stone and 30 Excavation XP.' }
    const current = { ...sellProjection,
      player: { ...sellProjection.player,
        position: [dig.center.x + 3.75, dig.center.y, dig.center.z] as const },
      savedTerrainWorks: { context: 'works3-greenway' as const,
        actionsEnabled: true, modeActive: true, selectedKind: 'dig' as const,
        builtSites: [], dugTileIds: [],
        preview: { selected: choice, nearby: [choice], guidance: null } } }
    const hud = renderToStaticMarkup(createElement(WizardHud,
      { projection: current, onIntent: vi.fn() }))
    expect(hud).toContain('3.75 m on map')
    expect(hud).toContain(reason)
    expect(hud).toContain('within 4 m, not on it')
    expect(hud).not.toContain('Step beside the ghost route')
    const map = renderToStaticMarkup(createElement(WizardMap,
      { ...mapProps(true), projection: current }))
    expect(map).toContain('Bridge and ladder reach is 3 m')
    expect(map).toContain('Stand beside marked dry loam within 4 m, not on it.')
    expect(map).toContain(reason)
  })

  it('explains the v15 south creek without the streamed Mireglass work guide', () => {
    const current = { ...projection, savedTerrainWorks: {
      context: 'starter-greenway', actionsEnabled: true, modeActive: false,
      builtSites: [], dugTileIds: [], preview: null,
    } } as WizardViewProjection
    const markup = renderToStaticMarkup(createElement(WizardMap,
      { ...mapProps(true), projection: current }))
    expect(markup).toContain('How to cross the creek and dig')
    expect(markup).toContain('south of the starting area')
    expect(markup).toContain('The separate starter ladder climbs the north cliff')
    expect(markup).not.toContain('How to reach Mireglass and use Works')
  })

  it('uses only locally discovered preview choices for streamed map work guidance', () => {
    const bridge = resolveTerrainWorkSite('greenway-alpha', 'works1:bridge:-102:92:z')!
    const current = { ...projection, unavailableActions: true, routes: [], buildSites: [],
      savedTerrainWorks: { actionsEnabled: true, selectedKind: 'bridge', builtSites: [], dugTileIds: [],
        preview: { selected: null, nearby: [{ site: bridge, angleRadians: 1, distanceMeters: 6.25,
          rejection: 'too_far', reason: 'Move within 3 m of the source foot.',
          benefit: 'Cross a shallow Fen channel. Costs 8 logs and earns 80 Construction XP.' }],
        guidance: 'Explore the far bank before previewing a bridge.' } },
    } as WizardViewProjection
    const markup = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: current }))
    expect(markup).toContain('Bridge nearby (6.3 m): Cross a shallow Fen channel.')
    expect(markup).toContain('Explore the far bank before previewing a bridge.')
    expect(markup).toContain('Switch kind if the wrong work is selected')
    expect(markup).toContain('Built supports and dug ground stay in your save.')
    expect(markup).not.toContain(bridge.id)
    expect(markup).not.toContain('Gather logs and equip a field spade before heading west.')
    expect(markup).toContain('fog: unexplored')
    expect(markup).not.toContain('fog: unexplored, route build site')
  })

  it('distinguishes paused streamed saves from Greenway travel requirements', () => {
    const current = { ...projection, unavailableActions: true, savedTerrainWorks: {
      actionsEnabled: false, builtSites: [], dugTileIds: [], preview: null,
    } } as WizardViewProjection
    const markup = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: current }))
    expect(markup).toContain('Saved building and digging are paused. Check the save status')
    expect(markup).toContain('moving to another site will not enable them')
    expect(markup).not.toContain('Explore beyond Greenway to use the Works panel')
    expect(markup).not.toContain('Saved building and digging become available beyond Greenway')
    expect(markup).not.toContain('before heading west')
    expect(markup).toContain('fog: unexplored')
    expect(markup).not.toContain('fog: unexplored, route build site')
  })

  it('keeps paused Works closed and sends exact touch mode, kind, confirm and cancel intents', () => {
    const bridge = resolveTerrainWorkSite('greenway-alpha', 'works1:bridge:-102:92:z')
    if (!bridge || bridge.kind !== 'bridge') throw new Error('Missing bridge fixture')
    const choice = { site: bridge, angleRadians: 0, distanceMeters: 2, rejection: 'not_owned' as const,
      reason: 'Gather 8 logs before building.', benefit: 'Cross a shallow Fen channel. Costs 8 logs and earns 80 Construction XP.' }
    const current = { ...sellProjection, openStoreId: null, controllerActionsEnabled: false,
      windwardStep: { learned: true, glyph: null, activeSeconds: 0, cooldownSeconds: 0,
        canCast: false, unavailableReason: 'Windward Step actions are unavailable in this preview.' },
      savedTerrainWorks: {
      actionsEnabled: false, modeActive: false, builtSites: [], dugTileIds: [], preview: null,
    } } as WizardViewProjection
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection: current, onIntent: vi.fn() }))
    expect(markup).toContain('aria-label="Saved terrain works"')
    expect(markup).toContain('Bridge: cross a Fen channel')
    expect(markup).toContain('Ladder: climb a Slate cliff')
    expect(markup).toContain('Dig: lower loam')
    expect(markup).toContain('min-height:44px')
    expect(markup).toContain('Saved Works paused. Check the save status')
    expect(markup).not.toContain('aria-label="Confirm aimed saved work"')
    expect(markup).not.toContain('aria-label="Choose saved work kind"')
    expect(markup).not.toContain('Unsaved terrain-work trial')
    expect(markup).not.toContain('Kit:')
    expect(markup).toContain('Windward Step actions are unavailable in this preview.')
    expect(markup).not.toContain('Follow the dry Highland trail to cast.')
    expect(renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: current })))
      .toContain('Saved local works: 0 bridge or ladder, 0 dug cells.')
    const pausedToggle = findElements(renderHudTree({ projection: current, onIntent: vi.fn() }),
      (element) => element.type === 'button' && element.props['aria-label'] === 'Open Works mode')
    expect(pausedToggle).toHaveLength(1)
    expect(pausedToggle[0].props.disabled).toBe(true)
    const ready = { ...choice, rejection: null, reason: 'Ready to build here.' }
    const off = { ...current, controllerActionsEnabled: true, savedTerrainWorks: { ...current.savedTerrainWorks!,
      selectedKind: 'bridge' as const, actionsEnabled: true, modeActive: false } }
    const emitted: unknown[] = []
    const openButton = findElements(renderHudTree({ projection: off, onIntent: (intent) => emitted.push(intent) }),
      (element) => element.type === 'button' && element.props['aria-label'] === 'Open Works mode')[0]
    expect(openButton.props.disabled).toBe(false)
    ;(openButton.props.onClick as () => void)()
    const enabled = { ...off, savedTerrainWorks: { ...off.savedTerrainWorks,
      modeActive: true,
      preview: { selected: ready, nearby: [ready], guidance: null } } }
    const buttons = findElements(renderHudTree({ projection: enabled, onIntent: (intent) => emitted.push(intent) }),
      (element) => element.type === 'button')
    ;(buttons.find((button) => button.props.children === 'ladder')!.props.onClick as () => void)()
    ;(buttons.find((button) => button.props['aria-label'] === 'Confirm aimed saved work')!.props.onClick as () => void)()
    ;(buttons.find((button) => button.props['aria-label'] === 'Cancel Works mode')!.props.onClick as () => void)()
    expect(emitted).toEqual([{ type: 'saved-work.mode', active: true },
      { type: 'saved-work.kind', kind: 'ladder' },
      { type: 'saved-work.confirm', id: bridge.id }, { type: 'saved-work.mode', active: false }])
    const enabledMarkup = renderToStaticMarkup(createElement(WizardHud, { projection: enabled, onIntent: vi.fn() }))
    expect(enabledMarkup).toContain('aria-label="Choose saved work kind"')
    expect(enabledMarkup).toContain('aria-label="Confirm aimed saved work"')
    expect(enabledMarkup).toMatch(/class="wr-saved-work-actions">.*aria-label="Confirm aimed saved work".*aria-label="Cancel Works mode".*<\/div>/)
    expect(enabledMarkup).not.toContain('<details>')
    const surface = renderToStaticMarkup(createElement(WizardSurface, { projection: enabled, onIntent: vi.fn() }))
    expect(surface).toContain('data-work-mode="true"')
    expect(surface).toContain('.wr-saved-work-actions{position:sticky;bottom:0;z-index:1;display:grid;gap:6px;')
    const works4 = renderToStaticMarkup(createElement(WizardHud, { projection: { ...enabled,
      savedTerrainWorks: { ...enabled.savedTerrainWorks, context: 'works4-greenway', aimX: 0 } },
    onIntent: vi.fn() }))
    expect(works4).toContain('id="wizard-work-aim" type="range"')
    expect(works4).toContain('class="wr-saved-work-actions"')
    expect(works4).toContain('aria-label="Confirm selected saved work"')
    const short = renderToStaticMarkup(createElement(WizardSurface, { projection: current, onIntent: vi.fn() }))
    expect(short).toContain('@media(max-width:719px) and (max-height:400px){.wr-saved-work-panel{top:120px')
    expect(short).toContain('.wr-saved-work-panel:has(details[open]){z-index:30;left:8px;right:8px;top:8px')
    expect(short).toContain('.wr-surface:has(.wr-saved-work-panel details[open]) .wr-touch')
  })

  it('guides healthy Greenway players west without calling their save paused or enabling Works', () => {
    const current = { ...sellProjection, openStoreId: null, controllerActionsEnabled: true,
      savedTerrainWorks: { actionsEnabled: false, selectedKind: 'bridge' as const,
        builtSites: [], dugTileIds: [], preview: null } } as WizardViewProjection
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection: current, onIntent: vi.fn() }))
    expect(markup).toContain('Works start in Mireglass. Follow the ⇦ west trail')
    expect(markup).toContain('then choose Bridge, Ladder, or Dig at discovered ground.')
    expect(markup).not.toContain('Saved Works paused')
    expect(markup).not.toContain('Check the save status')
    expect(markup).not.toContain('aria-label="Confirm aimed saved work"')
    expect(markup).not.toContain('aria-label="Choose saved work kind"')
    expect(markup).toContain('disabled="" aria-label="Open Works mode"')
  })

  it('shows a discovered ready Slate ladder and blocked dig without leaking hidden work sites', () => {
    const ladder = resolveTerrainWorkSite('greenway-alpha', 'works1:ladder:-103:108:W')!
    const dig = resolveTerrainWorkSite('greenway-alpha', 'tile--64-76')!
    const ready = { site: ladder, angleRadians: 0, distanceMeters: 2, rejection: null,
      reason: 'Ready to build here.', benefit: 'Climb a 1.56 m Slate cliff. Costs 4 logs and earns 60 Construction XP.' }
    const blocked = { site: dig, angleRadians: 0, distanceMeters: 2,
      rejection: 'requires_spade' as const, reason: 'Own and equip a field spade to dig.',
      benefit: 'Lower loam by 0.24 m and gain 1 stone plus 30 Excavation XP. Stone and 4 logs can make a camp.' }
    const base = { ...sellProjection, openStoreId: null, unavailableActions: true } as WizardViewProjection
    const ladderView = { ...base, savedTerrainWorks: { actionsEnabled: true, modeActive: true,
      selectedKind: 'ladder' as const, builtSites: [], dugTileIds: [],
      preview: { selected: ready, nearby: [ready], guidance: null } } }
    const ladderHud = renderToStaticMarkup(createElement(WizardHud, { projection: ladderView, onIntent: vi.fn() }))
    expect(ladderHud).toContain('Slate ladder: Ready to build here.')
    expect(ladderHud).toContain('Confirm Slate ladder')
    expect(ladderHud).not.toContain(ladder.id)
    const digView = { ...base, savedTerrainWorks: { ...ladderView.savedTerrainWorks,
      selectedKind: 'dig' as const, preview: { selected: blocked, nearby: [blocked], guidance: null } } }
    const digHud = renderToStaticMarkup(createElement(WizardHud, { projection: digView, onIntent: vi.fn() }))
    expect(digHud).toContain('Own and equip a field spade to dig.')
    expect(digHud).toContain('gain 1 stone plus 30 Excavation XP')
    expect(digHud).toContain('disabled="" aria-label="Confirm aimed saved work"')
    expect(digHud).not.toContain(dig.id)
    const map = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: digView }))
    expect(map).toContain('aria-label="Next discovered work"')
    expect(map).toContain('Dig nearby: Own and equip a field spade to dig.')
    expect(map).not.toContain(dig.id)
  })

  it('keeps unsupported streamed legacy controls read-only without changing older projections', () => {
    const streamed = { ...sellProjection, unavailableActions: true as const,
      gait: { pace: 'run' as const, canRun: true, reason: 'Boots equipped' },
      learnedSpellIds: ['wayfinder_glow'] as WizardViewProjection['learnedSpellIds'],
      nearbyInteraction: { kind: 'resource' as const, targetId: 'tree-1', label: 'Tree', action: 'Chop tree', actionable: true },
      inscriptions: [{ id: 'greenway_waystone', name: 'Old stone', position: [0, 0, 0] as const,
        spellId: 'wayfinder_glow', studied: false }],
      digSites: [{ id: 'practice_mound', name: 'Cache', position: [0, 0, 0] as const,
        revealed: true, excavated: false, minimumExcavationLevel: 1 }],
      equipment: { ...sellProjection.equipment, mainHand: { id: 'spade-1', itemId: 'field_spade',
        name: 'Field spade', quantity: 1 } },
      backpack: { capacity: 20, stacks: [{ id: 'spade-1', itemId: 'field_spade', name: 'Field spade', quantity: 1,
        equippableSlots: ['mainHand' as const] }] } } as WizardViewProjection
    const controls = findElements(renderHudTree({ projection: streamed, onIntent: vi.fn() }),
      (element) => element.type === 'button')
    expect(controls.find((button) => button.props['aria-label'] === 'Walk')?.props.disabled).toBe(false)
    for (const label of ['Cast Wayfinder Glow', 'Unequip Field spade']) {
      expect(controls.find((button) => button.props['aria-label'] === label)?.props.disabled).toBe(true)
    }
    expect(controls.find((button) => button.props.children === 'List')?.props.disabled).toBe(true)
    expect(controls.some((button) => button.props['aria-label'] === 'Study Old stone')).toBe(false)
    expect(controls.some((button) => button.props['aria-label'] === 'Excavate Cache')).toBe(false)
    expect(controls.some((button) => button.props['data-actionable'] === 'true')).toBe(false)
    expect(renderToStaticMarkup(createElement(WizardHud, { projection: streamed, onIntent: vi.fn() })))
      .toContain('Interaction unavailable here')
    const eligible = { ...streamed, unavailableActions: undefined } as WizardViewProjection
    const oldControls = findElements(renderHudTree({ projection: eligible, onIntent: vi.fn() }),
      (element) => element.type === 'button')
    expect(oldControls.find((button) => button.props['aria-label'] === 'Study Old stone')?.props.disabled).toBe(false)
    expect(oldControls.find((button) => button.props['aria-label'] === 'Excavate Cache')?.props.disabled).toBe(false)
    const map = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: streamed }))
    expect(map).toContain('Legacy route and camp actions are unavailable')
    expect(map).toContain('class="wr-map-site" disabled=""')
    expect(renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection })))
      .not.toContain('class="wr-map-site" disabled=""')
  })

  it('shows a 44px touch Walk toggle only for public gait and emits the same intent as R', () => {
    const emitted: string[] = []
    const running = { ...sellProjection, gait: { pace: 'run' as const, canRun: true,
      reason: 'Running in leather boots' } }
    const hud = renderHudTree({ projection: running, onIntent: (intent) => emitted.push(intent.type) })
    const walk = findElements(hud, (element) => element.props['aria-label'] === 'Walk')[0]
    expect(walk.props['aria-pressed']).toBe(false)
    expect(walk.props.disabled).toBe(false)
    ;(walk.props.onClick as () => void)()
    expect(emitted).toEqual(['gait.toggle'])
    const markup = renderToStaticMarkup(createElement(WizardSurface, {
      projection: running, onIntent: () => {} }))
    expect(markup).toContain('min-height:44px;border:1px solid #f5dc87')
    expect(markup).toContain('Running in leather boots')
    expect(markup).toContain('>R</kbd>')
    const barefoot = { ...sellProjection, gait: { pace: 'walk' as const, canRun: false,
      reason: 'Barefoot: walk only' } }
    const disabled = findElements(renderHudTree({ projection: barefoot, onIntent: () => {} }),
      (element) => element.props['aria-label'] === 'Walk')[0]
    expect(disabled.props.disabled).toBe(true)
    expect(disabled.props['aria-pressed']).toBe(true)
    expect(renderToStaticMarkup(createElement(WizardHud, { projection: sellProjection,
      onIntent: () => {} }))).not.toContain('aria-label="Walk"')
  })

  it('keeps V42 compact movement status accessible without covering panels or Safety', () => {
    const running = { ...sellProjection, gait: { pace: 'run' as const, canRun: true,
      reason: 'Running in leather boots' } }
    const markup = renderToStaticMarkup(createElement(WizardSurface, {
      projection: running, onIntent: () => {} }))
    const styles = markup.match(/<style>([\s\S]*?)<\/style>/)?.[1]
    expect(markup).toContain('<small role="status">Running in leather boots</small>')
    expect(styles).toContain('@media(min-width:720px) and (max-width:900px) and (min-height:591px){[data-public-version=v42] .wr-gait small{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}[data-public-version=v42] .wr-dev-nav-hint{display:none}}')
  })

  it('positions the wide V42 DEV navigation hint above Safety', () => {
    const markup = renderToStaticMarkup(createElement(WizardSurface, {
      projection: sellProjection, onIntent: () => {} }))
    const styles = markup.match(/<style>([\s\S]*?)<\/style>/)?.[1]
    expect(styles).toContain('@media(min-width:901px) and (min-height:591px){[data-public-version=v42] .wr-dev-nav-hint{bottom:64px}}')
  })

  it('keeps forward, backward, and pivot axes independent', () => {
    expect(movementVector(new Set(['KeyW']))).toEqual([0, 1])
    expect(movementVector(new Set(['KeyS']))).toEqual([0, -1])
    expect(movementVector(new Set(['KeyA']))).toEqual([-1, 0])
    expect(movementVector(new Set(['KeyD']))).toEqual([1, 0])
    expect(movementVector(new Set(['KeyW', 'KeyD']))).toEqual([1, 1])
  })

  it('guarantees one bounded pivot intent for a short A/D tap without turning on release', () => {
    const held = new Set<string>()
    expect(keyboardMovementIntents(held, 'KeyA', true)).toEqual([
      { type: 'movement.tap', vector: [-1, 0], source: 'keyboard' },
      { type: 'movement', vector: [-1, 0] },
    ])
    expect(keyboardMovementIntents(held, 'KeyA', false)).toEqual([{ type: 'movement', vector: [0, 0] }])
    expect(keyboardMovementIntents(held, 'KeyD', true)).toEqual([
      { type: 'movement.tap', vector: [1, 0], source: 'keyboard' },
      { type: 'movement', vector: [1, 0] },
    ])
    expect(keyboardMovementIntents(held, 'KeyD', false)).toEqual([{ type: 'movement', vector: [0, 0] }])
    expect(held.size).toBe(0)
  })

  it('attaches the same event time to pivot and held-vector changes', () => {
    const held = new Set<string>()
    expect(keyboardMovementIntents(held, 'KeyA', true, 120)).toEqual([
      { type: 'movement.tap', vector: [-1, 0], source: 'keyboard', atMs: 120 },
      { type: 'movement', vector: [-1, 0], atMs: 120 },
    ])
    expect(keyboardMovementIntents(held, 'KeyA', false, 145)).toEqual([
      { type: 'movement', vector: [0, 0], atMs: 145 },
    ])
  })

  it('uses the native event clock when compatible and falls back from epoch timestamps', () => {
    expect(keyboardEventTime(120, 125)).toBe(120)
    expect(keyboardEventTime(1_700_000_000_000, 125)).toBe(125)
    expect(keyboardEventTime(Number.NaN, 125)).toBe(125)
  })

  it('does not issue extra taps while held, duplicate keydown, or keyup-only movement', () => {
    const held = new Set<string>()
    expect(keyboardMovementIntents(held, 'KeyD', true)).toHaveLength(2)
    expect(keyboardMovementIntents(held, 'KeyD', true)).toEqual([])
    expect(keyboardMovementIntents(held, 'KeyW', true)).toEqual([{ type: 'movement', vector: [1, 1] }])
    expect(keyboardMovementIntents(held, 'KeyD', false)).toEqual([{ type: 'movement', vector: [0, 1] }])
    expect(keyboardMovementIntents(held, 'KeyD', false)).toEqual([])
    expect(keyboardMovementIntents(held, 'KeyW', false)).toEqual([{ type: 'movement', vector: [0, 0] }])
    expect(keyboardMovementIntents(held, 'KeyW', true)).toEqual([{ type: 'movement', vector: [0, 1] }])
  })

  it('changes camera orbit only from drag deltas and clamps pitch', () => {
    expect(cameraOrbitFromDrag([0, 0.28], [25, -10])).toEqual([-0.1, 0.25])
    expect(cameraOrbitFromDrag([0, 0.7], [0, 100])).toEqual([0, 0.72])
    expect(cameraOrbitFromDrag([0, 0.1], [0, -100])).toEqual([0, 0.08])
  })

  it('continues a second drag from the released camera target', () => {
    const firstDrag = cameraOrbitFromDrag(CENTERED_CAMERA_ORBIT, [50, 20])
    expect(firstDrag).not.toEqual(CENTERED_CAMERA_ORBIT)
    expect(cameraOrbitFromDrag(firstDrag, [0, 0])).toEqual(firstDrag)
    const secondDrag = cameraOrbitFromDrag(firstDrag, [10, 0])
    expect(secondDrag[0]).toBeCloseTo(-0.24)
    expect(secondDrag[1]).toBeCloseTo(0.34)
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

  it('cycles Tab and Shift+Tab through the dialog controls and wraps at either end', () => {
    expect(mapDialogTabTarget(true, 'Tab', false, 0, 4)).toBe(1)
    expect(mapDialogTabTarget(true, 'Tab', false, 3, 4)).toBe(0)
    expect(mapDialogTabTarget(true, 'Tab', true, 2, 4)).toBe(1)
    expect(mapDialogTabTarget(true, 'Tab', true, 0, 4)).toBe(3)
    expect(mapDialogTabTarget(true, 'Tab', true, -1, 4)).toBe(3)
    expect(mapDialogTabTarget(false, 'Tab', false, 0, 4)).toBeNull()
    expect(mapDialogTabTarget(true, 'Enter', false, 0, 4)).toBeNull()
  })

  it.each(['window blur', 'document visibility loss'])('releases W/S/A/D after %s', () => {
    const held = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD'])
    expect(releaseHeldControls(held)).toEqual([0, 0])
    expect(held.size).toBe(0)
    expect(movementVector(held)).toEqual([0, 0])
  })
})

describe('short desktop layout', () => {
  it('keeps Saved Works and Trade independently scrollable without overlapping their desktop regions', () => {
    const current = { ...sellProjection, savedTerrainWorks: {
      actionsEnabled: true, selectedKind: 'bridge' as const, builtSites: [], dugTileIds: [], preview: null,
    } }
    const markup = renderToStaticMarkup(createElement(WizardSurface, { projection: current, onIntent: () => {} }))
    expect(markup).toContain('class="wr-panel wr-saved-work-panel"')
    expect(markup).toContain('class="wr-panel wr-trade"')
    expect(markup).toContain('.wr-trade{right:16px;bottom:16px}')
    expect(markup).toContain('.wr-trade{box-sizing:border-box;max-height:176px;overflow-y:auto;overscroll-behavior:contain}')
    expect(markup).toContain('.wr-saved-work-panel{z-index:5;box-sizing:border-box;right:16px;top:285px;max-height:calc(100% - 493px);overflow-y:auto')
    const tradeHeight = Number(markup.match(/\.wr-trade\{box-sizing:[^}]*max-height:(\d+)px/)?.[1])
    const savedCap = Number(markup.match(/\.wr-saved-work-panel\{z-index:[^}]*max-height:calc\(100% - (\d+)px\)/)?.[1])
    expect(savedCap).toBeGreaterThanOrEqual(285 + 16 + tradeHeight + 16)
    expect(markup).toContain('.wr-saved-work-panel{top:160px;max-height:calc(100% - 312px)}')
    expect(markup).toContain('.wr-trade{max-height:120px}')
    expect(markup).toContain('.wr-saved-work-panel{top:128px;max-height:calc(100% - 260px)}')
    expect(markup).toContain('.wr-trade{max-height:100px}')
    expect(markup).toContain('.wr-saved-work-panel{top:120px;max-height:calc(100% - 136px)}')
    expect(markup).toContain('.wr-saved-work-panel{right:8px;top:176px;')
  })

  it('keeps the shop header and Close control within a short viewport', () => {
    const markup = renderToStaticMarkup(createElement(WizardSurface, { projection: sellProjection, onIntent: () => {} }))
    expect(markup).toContain('Greenway Outfitters')
    expect(markup).toContain('class="wr-panel wr-context" data-store-panel="true"')
    expect(markup).toContain('>Close</button>')
    expect(markup).toContain('.wr-scene{position:absolute;z-index:0;inset:0;cursor:grab}')
    expect(markup).toContain('.wr-hud{position:absolute;z-index:1;inset:0;pointer-events:none}.wr-hud button,.wr-panel{pointer-events:auto}')
    expect(markup).toContain('.wr-context:not(.wr-build-preview){box-sizing:border-box;max-height:calc(100% - 215px);overflow-y:auto')
    expect(markup).toContain('@media(min-width:720px) and (max-height:599px){.wr-context[data-store-panel]{position:fixed;bottom:60px;max-height:calc(100dvh - 110px)}}')
    expect(markup).toContain('@media(max-width:719px){.wr-backpack{display:none}.wr-backpack-toggle{position:absolute')
    expect(markup).toContain('.wr-map-toggle{left:106px;right:auto;top:120px}')
    expect(markup).toContain('.wr-prompt{left:8px;top:176px;bottom:auto;transform:none')
    expect(markup).toContain('.wr-events{top:252px;left:8px;max-height:48px;overflow:hidden')
    expect(markup).toContain('.wr-surface .wr-context[data-store-panel]{bottom:14px;max-height:calc(100% - 78px)}')
  })

  it('moves only V29 desktop event guidance clear of the First steps guide', () => {
    const markup = renderToStaticMarkup(createElement(WizardSurface,
      { projection: sellProjection, onIntent: () => {} }))
    const styles = markup.match(/<style>([\s\S]*?)<\/style>/)?.[1]
    expect(styles).toContain('@media(min-width:901px) and (min-height:591px){[data-public-version=v29] .wr-events{left:290px;bottom:270px;max-width:340px}}')
    expect(styles).toContain('@media(max-width:719px){.wr-events{top:252px;left:8px;max-height:48px;overflow:hidden;pointer-events:none}.wr-events p:not(:last-child){display:none}}')
  })

  it('identifies ring travel as a separate compact panel beside touch controls', () => {
    const current = { ...sellProjection, openStoreId: null,
      nearbyInteraction: { kind: 'fairy-ring', targetId: 'ring-greenway', label: 'Greenway Ring', action: 'Travel', actionable: true },
      fairyRings: [{ id: 'ring-greenway', label: 'Greenway Ring', position: [0, 0, 0], discovered: true,
        destinations: [{ ringId: 'ring-highland', label: 'Highland Ring', discovered: true }] }],
    } as WizardViewProjection
    const markup = renderToStaticMarkup(createElement(WizardSurface, { projection: current, onIntent: () => {} }))
    expect(markup).toContain('class="wr-panel wr-context"><header data-ring-panel="true"')
    expect(markup).toContain('Highland Ring')
    expect(markup).toContain('.wr-surface .wr-context:has(> header[data-ring-panel]){left:8px;transform:none')
  })

  it('anchors the build panel to the viewport above the objective bar', () => {
    const markup = renderToStaticMarkup(createElement(WizardSurface, { projection: { ...sellProjection, openStoreId: null, selectedBuildSiteId: 'bridge-west' }, onIntent: () => {} }))
    expect(markup).toContain('class="wr-panel wr-context wr-build-preview"')
    expect(markup).toContain('.wr-build-preview{bottom:210px}')
    expect(markup).toContain('.wr-build-preview{bottom:230px}')
    expect(markup).toContain('.wr-surface{position:relative;width:100%;height:100%;min-height:600px')
    expect(markup).toContain('@media(min-width:901px) and (max-height:590px){.wr-surface{min-height:100%}')
  })
})

describe('wizard atlas markup', () => {
  it('shows only the discovered canonical starter cliff ladder under the v14 marker', () => {
    const cliff = { face: starterCliffCanonicalFace('greenway-alpha'), ladder: null } as const
    const routes = [
      { id: 'greenway_ladder', label: 'Greenway low steps', from: [0, 1, -4], to: [0, 2.56, -8],
        built: false, unlocked: true, logCost: 4 },
      { id: 'highland_bridge', label: 'Highland bridge', from: [4, 0, -8], to: [6, 0, -8],
        built: false, unlocked: true, logCost: 6 },
    ] as WizardViewProjection['routes']
    const canonical = { id: cliff.face.siteId, routeId: 'greenway_ladder',
      label: 'Greenway ladder, north edge', from: [0, 1, -4], to: [0, 2.56, -8],
      logCost: 4, status: 'ready', reason: 'Ready to build', discovered: true } as const
    const sites = [canonical, { ...canonical, id: 'greenway_ladder:x:2',
      label: 'Phantom site at x 2', from: [2, 1, -4] as const },
    { ...canonical, id: 'hidden-site-id', label: 'Fogged ladder', discovered: false }] as WizardViewProjection['buildSites']
    const view = { ...projection, starterCliff: cliff, routes, buildSites: sites } as WizardViewProjection
    const shown = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: view }))
    expect(shown).toContain('Starter cliff ladder')
    expect(shown).toContain('x 0, z -4')
    expect(shown).toContain('Build with 4 logs')
    expect(shown).toContain('W to climb or S to descend')
    expect(shown).toContain('Preview Starter cliff ladder')
    expect(shown).not.toContain('low steps')
    expect(shown).not.toContain('Highland bridge')
    expect(shown).not.toContain('Phantom site')
    expect(shown).not.toContain('hidden-site-id')
    const hidden = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: {
      ...view, buildSites: sites.map((site) => ({ ...site, discovered: false })),
    } }))
    expect(hidden).toContain('Find the cliff foot')
    expect(hidden).not.toContain('x 0, z -4')
    expect(hidden).not.toContain('Preview Starter cliff ladder')
    const paused = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: {
      ...view, routes: [{ ...routes[0], built: true }], buildSites: [],
      controllerActionsEnabled: false,
    } }))
    expect(paused).toContain('Movement is paused until the save recovers.')
    expect(paused).not.toContain('route shortcuts are paused')
  })

  it('keeps the authored x 0 route distinct from a committed off-center v17 Works ladder', () => {
    const site = resolveTerrainWorkSite('greenway-alpha', 'works1:ladder:-103:108:W')
    if (site?.kind !== 'ladder') throw new Error('Missing ladder fixture')
    const face = starterCliffCanonicalFace('greenway-alpha')
    const ladder = { ...site,
      from: { ...site.from, x: -5.1, z: -4 }, to: { ...site.to, x: -5.1, z: -8 },
      supportPath: [{ x: -5.1, y: 1, z: -4 }, { x: -5.1, y: 1, z: -5.35 },
        { x: -5.1, y: 2.56, z: -6 }, { x: -5.1, y: 2.56, z: -8 }],
      widthMeters: 1.05 }
    const routes = [{ id: 'greenway_ladder', label: 'Greenway ladder',
      from: [0, 1, -4], to: [0, 2.56, -8], built: false, unlocked: true, logCost: 4 }] as WizardViewProjection['routes']
    const current = { ...sellProjection,
      map: { ...sellProjection.map, tiles: [
        ...sellProjection.map.tiles,
        ...ladder.footprintTileIds.map((id, index) => ({
          ...sellProjection.map.tiles[0], id, gridX: index + 2, discovered: true,
          hasStore: false, hasRouteSite: false, hasBuiltRoute: false,
        })),
      ] },
      starterCliff: { face, ladder: null },
      routes, buildSites: [{ id: face.siteId, routeId: 'greenway_ladder',
        label: 'Starter cliff ladder', from: [0, 1, -4] as const, to: [0, 2.56, -8] as const,
        logCost: 4, status: 'ready' as const, reason: 'Ready to build', discovered: true }],
      savedTerrainWorks: { context: 'works4-greenway' as const, builtSites: [ladder],
        dugTileIds: [], actionsEnabled: true, modeActive: false,
        selectedKind: 'ladder' as const, preview: null } } as WizardViewProjection
    const html = renderToStaticMarkup(createElement(WizardMap,
      { ...mapProps(true), projection: current }))
    expect(html).toContain('Starter cliff ladder (authored center route)')
    expect(html).toContain('Preview Starter cliff ladder (authored center route)')
    expect(html).toContain('The centered starter ladder site is x 0, z -4. Off-center Works ladder candidates are separate')
    expect(html).toContain('Your built Works ladder follows its own preview coordinates.')
    expect(html).toContain('Built Works north cliff ladder, separate from the authored x 0 route')
    expect(html).toContain('lower foot x -5.1, z -4; upper foot x -5.1, z -8')
    expect(html).toContain('Rails center on x -5.1 from z -5.35 to -6 (width 1.05 m)')
    expect(html).toContain('Approach the lower foot from the south, align between these rails')
    const choice = { site: ladder, distanceMeters: 1.6, angleRadians: 0,
      rejection: 'occupied' as const, reason: 'Move clear of the footprint and other works.',
      benefit: 'Climb the north cliff.' }
    const ghost = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true),
      projection: { ...current,
        player: { ...current.player, position: [-5.1, 1, -5.6] },
        savedTerrainWorks: { ...current.savedTerrainWorks!, builtSites: [],
          preview: { selected: choice, nearby: [choice], guidance: null } } } }))
    expect(ghost).toContain('You are standing in this ladder ghost. Step south to the lower foot x -5.1, z -4')
    expect(ghost).not.toContain('Move clear of the footprint and other works.')
  })

  it('distinguishes starter low steps from the locked Highland bridge and never lists a hidden site', () => {
    const routes = [
      { id: 'greenway_ladder', label: 'Greenway low steps', from: [0, 0, -4], to: [0, 0.3, -8],
        built: false, unlocked: true, logCost: 4 },
      { id: 'highland_bridge', label: 'Highland bridge', from: [4, 0, -8], to: [6, 0, -8],
        built: false, unlocked: false, logCost: 6 },
    ] as WizardViewProjection['routes']
    const sites = [
      { id: 'known-steps', routeId: 'greenway_ladder', label: 'Greenway ladder, north edge',
        from: [0, 0, -4], to: [0, 0.3, -8], logCost: 4, status: 'ready', reason: 'Ready to build', discovered: true },
      { id: 'hidden-bridge', routeId: 'highland_bridge', label: 'Hidden bridge at x 6',
        from: [4, 0, -8], to: [6, 0, -8], logCost: 6, status: 'locked', reason: 'Not discovered', discovered: false },
    ] as WizardViewProjection['buildSites']
    const markup = renderToStaticMarkup(createElement(RouteKey, { routes, buildSites: sites,
      selectedBuildSiteId: null, onSelect: vi.fn() }))
    expect(markup).toContain('First route: low steps to Northern Ridge, not a cliff ladder.')
    expect(markup).toContain('The climbable Slate ladder is a separate work in Mireglass.')
    expect(markup).toContain('Next route: bridge the gap east from Northern Ridge to Eastern Highland.')
    expect(markup).toContain('Build the low steps and reach level 2 first; then bring 6 logs')
    expect(markup).toContain('Preview Greenway low steps, north edge')
    expect(markup).toContain('No discovered Highland bridge sites yet.')
    expect(markup).not.toContain('hidden-bridge')
    expect(markup).not.toContain('Hidden bridge at x 6')
    const paused = renderToStaticMarkup(createElement(RouteKey, { routes, buildSites: sites,
      selectedBuildSiteId: null, onSelect: vi.fn(), actionsEnabled: false }))
    expect(paused).toContain('Route actions unavailable here')
    expect(paused).not.toContain('Ready to build</small>')
    const routeMap = (nextRoutes = routes, nextSites = sites) => renderToStaticMarkup(createElement(WizardMap,
      { ...mapProps(true), projection: { ...projection, routes: nextRoutes, buildSites: nextSites } }))
    const locked = routeMap()
    expect(locked).toContain('aria-label="Route roadmap"')
    expect(locked).toContain('Highland bridge east to Eastern Highland (6 logs, locked: build the low steps and reach level 2)')
    expect(locked).not.toContain('Fen bridges in Mireglass are separate Works.')
    const withWorks = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: {
      ...projection, routes, buildSites: sites, controllerActionsEnabled: true,
      savedTerrainWorks: { actionsEnabled: false, builtSites: [], dugTileIds: [], preview: null },
    } }))
    expect(withWorks).toContain('Fen bridges in Mireglass are separate Works.')
    expect(locked.indexOf('aria-label="Route roadmap"')).toBeLessThan(locked.indexOf('class="wr-map-routes"'))
    expect(locked).not.toContain('Hidden bridge at x 6')
    const unlocked = routes.map((route) => route.id === 'highland_bridge' ? { ...route, unlocked: true } : route)
    const known = sites.map((site) => site.id === 'hidden-bridge'
      ? { ...site, id: 'known-bridge', label: 'Known bridge', discovered: true, status: 'ready' as const } : site)
    expect(routeMap(unlocked, known)).toContain('Highland bridge east to Eastern Highland (6 logs, ready at a discovered site)')
    const unavailable = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true),
      projection: { ...projection, routes: unlocked, buildSites: known, unavailableActions: true } }))
    expect(unavailable).toContain('Highland bridge east to Eastern Highland (6 logs, unavailable here)')
    expect(unavailable).not.toContain('6 logs, ready at a discovered site')
    const built = unlocked.map((route) => route.id === 'highland_bridge' ? { ...route, built: true } : route)
    expect(routeMap(built, sites)).toContain('Highland bridge east to Eastern Highland (6 logs, built)')
  })

  const campProjection = { ...gridProjection(3, 1, 1), fieldCamp: { camps: [], preview: null, selectionEnabled: true } } as WizardViewProjection

  it('makes only discovered expanded v9 cells native selection buttons with one Tab stop', () => {
    const current = { ...campProjection, map: { ...campProjection.map, tiles: campProjection.map.tiles.map((tile) => tile.id === 'tile-2-1' ? { ...tile, discovered: false } : tile) } }
    const markup = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: current }))
    expect(markup.match(/data-camp-tile=/g)).toHaveLength(8)
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1)
    expect(markup).toContain('type="button" tabindex="0" data-camp-tile="tile-1-1"')
    expect(markup).not.toContain('data-camp-tile="tile-2-1"')
    expect(markup).toContain('Enter or Space previews one')
    for (const props of [{ ...mapProps(false), projection: current }, { ...mapProps(true), projection: { ...current, fieldCamp: undefined } },
      { ...mapProps(true), projection: { ...current, fieldCamp: { ...current.fieldCamp!, selectionEnabled: false } } }]) {
      expect(renderToStaticMarkup(createElement(WizardMap, props))).not.toContain('data-camp-tile=')
    }
  })

  it('marks suitable discovered camp cells without implying the player can build from afar', () => {
    const guidance = 'Inner basin approach is roughly SW of here, about 210 m away.'
    const current = { ...campProjection, fieldCamp: { ...campProjection.fieldCamp!, guidance },
      map: { ...campProjection.map, tiles: campProjection.map.tiles.map((tile) => ({
      ...tile, campSuitable: tile.id === 'tile-2-1' || tile.id === 'tile-1-1',
      discovered: tile.id !== 'tile-1-0',
    })) } }
    const markup = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: current }))
    expect(markup).toContain('tile-2-1: meadow, suitable field camp ground')
    expect(markup).toContain('tile-1-1: meadow, player location, suitable field camp ground')
    expect(markup).toContain('>⌂</b>')
    expect(markup).toContain('>⌂</small>')
    expect(markup).not.toContain('tile-1-0: unexplored, suitable field camp ground')
    expect(markup).toContain('role="note" aria-label="Camp guidance"')
    expect(markup).toContain(guidance)
    expect(markup).toContain('Move within 3 m of a site to build')
    const older = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: { ...current, fieldCamp: undefined } }))
    expect(older).not.toContain('suitable field camp ground')
    expect(older).not.toContain('⌂')
  })

  it('moves roving focus by north-up row or column, skipping fog and stopping at map edges', () => {
    const tiles = campProjection.map.tiles.map((tile) => tile.id === 'tile-1-0' ? { ...tile, discovered: false } : tile)
    expect(mapCellForArrow(tiles, 'tile-0-0', 'ArrowRight')).toBe('tile-2-0')
    expect(mapCellForArrow(tiles, 'tile-1-1', 'ArrowDown')).toBe('tile-1-2')
    expect(mapCellForArrow(tiles, 'tile-1-1', 'ArrowUp')).toBe('tile-1-1')
    expect(mapCellForArrow(tiles, 'tile-0-0', 'ArrowLeft')).toBe('tile-0-0')
    expect(mapCellForArrow(tiles, 'tile-2-2', 'ArrowUp')).toBe('tile-2-1')
    expect(mapCellForArrow(tiles, 'tile-1-1', 'Enter')).toBeNull()
  })

  it('selects a cell through its native button click and returns to the camp preview', () => {
    const onToggle = vi.fn(), onIntent = vi.fn()
    const map = WizardMap({ ...mapProps(true, onToggle, onIntent), projection: campProjection })
    const grid = findElements(map, (element) => typeof element.type === 'function' && element.props.projection === campProjection)[0]
    const gridWindow = (grid.type as (props: Props) => ReactElement<Props>)(grid.props)
    const renderedGrid = findElements(gridWindow, (element) => element.props.className === 'wr-map-grid')[0]
    const tile = findElements(renderedGrid, (element) => typeof element.type === 'function' && (element.props.tile as { id: string })?.id === 'tile-1-1')[0]
    const button = (tile.type as (props: Props) => ReactElement<Props>)(tile.props)
    expect(button.type).toBe('button')
    expect(button.props.onKeyDown).toBeUndefined() // Enter and Space keep native button activation.
    ;(button.props.onClick as () => void)()
    expect(onIntent).toHaveBeenCalledWith({ type: 'field-camp.select', tileId: 'tile-1-1' })
    expect(onToggle).toHaveBeenCalledOnce()
    const focused = { tabIndex: -1, focus: vi.fn(), dataset: { campTile: 'tile-2-1' } }
    const previous = { tabIndex: 0, focus: vi.fn(), dataset: { campTile: 'tile-1-1' } }
    const currentTarget = { querySelectorAll: () => [previous, focused] }
    ;(renderedGrid.props.onKeyDown as (event: unknown) => void)({ key: 'ArrowRight', preventDefault: vi.fn(), currentTarget, target: { closest: () => previous } })
    expect(focused.focus).toHaveBeenCalledOnce()
    ;(renderedGrid.props.onFocus as (event: unknown) => void)({ currentTarget, target: focused })
    expect([previous.tabIndex, focused.tabIndex]).toEqual([-1, 0])
  })

  it('keeps 44px camp targets in a bounded scroll window and centers the initial player or selected cell', () => {
    const current = { ...gridProjection(33, 16, 16), fieldCamp: campProjection.fieldCamp }
    const map = WizardMap({ ...mapProps(true), projection: current })
    const grid = findElements(map, (element) => typeof element.type === 'function' && element.props.projection === current)[0]
    const gridWindow = (grid.type as (props: Props) => ReactElement<Props>)(grid.props)
    const markup = renderToStaticMarkup(gridWindow)
    expect(markup).toContain('grid-template-columns:repeat(33, 44px);grid-auto-rows:44px;width:1516px')
    expect(markup).toContain('tabindex="0" data-camp-tile="tile-16-16"')
    const node = { clientWidth: 362, clientHeight: 260, scrollLeft: 0, scrollTop: 0,
      querySelector: () => ({ offsetLeft: 16 * 46, offsetTop: 16 * 46, offsetWidth: 44, offsetHeight: 44 }) }
    ;(gridWindow.props.ref as (node: unknown) => void)(node)
    expect([node.scrollLeft, node.scrollTop]).toEqual([577, 628])
    const selected = { ...current, fieldCamp: { ...current.fieldCamp!, preview: { tileId: 'tile-20-20', position: [0, 0, 0] as const, rejection: null } } }
    expect(renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: selected }))).toContain('tabindex="0" data-camp-tile="tile-20-20"')
    expect(renderToStaticMarkup(createElement(WizardSurface, { projection: sellProjection, onIntent: vi.fn() }))).toContain('max-height:min(52vh,480px);overflow:auto;overscroll-behavior:contain')
  })

  it('cycles visible controls without entering hidden overview content and closes on Escape', () => {
    const onToggle = vi.fn()
    const dialog = findElements(WizardMap(mapProps(true, onToggle)), (element) => element.props.role === 'dialog')[0]
    const close = { tabIndex: 0, hasAttribute: () => false, getClientRects: () => [1], focus: vi.fn() }
    const route = { ...close, focus: vi.fn() }
    const hidden = { ...close, getClientRects: () => [], focus: vi.fn() }
    const untabbable = { ...close, tabIndex: -1, focus: vi.fn() }
    const event = { key: 'Tab', shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: { querySelectorAll: () => [close, hidden, untabbable, route] } }
    vi.stubGlobal('document', { activeElement: close })
    try {
      const keydown = dialog.props.onKeyDown as (event: unknown) => void
      keydown(event)
      expect(route.focus).toHaveBeenCalledOnce()
      keydown({ ...event, shiftKey: true })
      expect(route.focus).toHaveBeenCalledTimes(2)
      expect(hidden.focus).not.toHaveBeenCalled()
      expect(untabbable.focus).not.toHaveBeenCalled()
      keydown({ ...event, key: 'Escape' })
      expect(onToggle).toHaveBeenCalledOnce()
      expect(event.stopPropagation).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })

  it('shows field camp markers only on discovered local cells and defers the overview marker', () => {
    const current = { ...campProjection, map: { ...campProjection.map,
      tiles: campProjection.map.tiles.map((tile) => ({ ...tile, hasCamp: true, discovered: tile.id === 'tile-1-1' })),
      overview: () => ({ player: { gridX: 1, gridZ: 1, yaw: 0 }, cells: [{ id: 'camp-chunk', gridX: 0, gridZ: 0, terrain: 'loam' as const, biome: 'meadow', discoveredCells: 1, markers: ['Field camp'] }] }),
    } }
    const markup = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: current }))
    expect(markup).toContain('tile-1-1: meadow, player location, field camp')
    expect(markup).not.toContain('unexplored, field camp')
    expect(markup).not.toContain('Field camp"><i')
    expect(overviewForDetails(true, current.map.overview)?.cells[0].markers).toEqual(['Field camp'])
  })

  it('offers a native local/world map toggle only when the public overview exists', () => {
    const loadOverview = vi.fn(() => ({ player: { gridX: 0, gridZ: 0, yaw: 0 }, cells: [
      { id: 'chunk-0-0', gridX: 0, gridZ: 0, discoveredCells: 2, terrain: 'loam' as const, biome: 'temperate_forest', markers: ['Greenway Outfitters'] },
      { id: 'chunk-1-0', gridX: 1, gridZ: 0, discoveredCells: 0, terrain: null, biome: null, markers: [] },
    ] }))
    const current = { ...projection, map: { ...projection.map,
      overview: loadOverview,
    } } as WizardViewProjection
    const compact = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(false), projection: current }))
    expect(loadOverview).not.toHaveBeenCalled()
    expect(compact).not.toContain('wr-map-overview')
    const expanded = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: current }))
    expect(loadOverview).not.toHaveBeenCalled()
    expect(expanded).toContain('<details class="wr-map-overview"><summary>World overview (toggle local map)</summary>')
    expect(expanded).toContain('.wr-map-overview[open]~.wr-map-local{display:none}')
    expect(expanded).not.toContain('chunk-0-0')
    expect(overviewForDetails(false, loadOverview)).toBeNull()
    expect(loadOverview).not.toHaveBeenCalled()
    expect(overviewForDetails(true, loadOverview)?.cells.map((cell) => cell.id)).toEqual(['chunk-0-0', 'chunk-1-0'])
    expect(loadOverview).toHaveBeenCalledTimes(1)
    expect(expanded).toContain('class="wr-map-local"')
    expect(renderToStaticMarkup(createElement(WizardMap, mapProps(true)))).not.toContain('wr-map-overview')
  })

  it('shows guidance as accessible text only in the expanded map', () => {
    const current = { ...projection, map: { ...projection.map,
      guidance: 'West to Mireglass: dry gap near z≈0, about 12 m.' } } as WizardViewProjection
    const expanded = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: current }))
    const compact = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(false), projection: current }))
    expect(expanded).toContain('role="note" aria-label="Map guidance"')
    expect(expanded).toContain('West to Mireglass: dry gap near z≈0, about 12 m.')
    expect(compact).not.toContain('Map guidance')
    expect(compact).not.toContain('dry gap near z≈0')
  })

  it('marks an excavated lower cell accessibly without changing older map tiles', () => {
    const home = projection.map.tiles[0]
    const lowered = { ...projection, map: { ...projection.map,
      tiles: [{ ...home, hasCache: true, elevationMeters: 1.65 }] } } as WizardViewProjection
    const markup = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: lowered }))
    expect(markup).toContain('lowered ground at 1.65 m')
    expect(markup).toContain('▾ lowered ground')
    expect(markup).toContain('>▾</small>')
    const older = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection }))
    expect(older).not.toContain('lowered ground')
  })

  it('shows a discovered waystone and keeps a store visible under the player marker without revealing fog', () => {
    const home = projection.map.tiles[0]
    const fog = projection.map.tiles[1]
    const current = { ...projection, map: { ...projection.map, tiles: [
      { ...home, hasRouteSite: false },
      { ...home, id: 'waystone', gridX: 1, hasStore: false, hasWaystone: true },
      { ...fog, id: 'hidden-waystone', gridX: 2, hasWaystone: true },
    ] } } as WizardViewProjection
    const markup = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: current }))
    expect(markup).toContain('home: meadow, player location, store')
    expect(markup).toMatch(/home: meadow, player location, store[^\"]*\"><b[^>]*>▲<\/b><small[^>]*>S<\/small>/)
    expect(markup).toContain('waystone: meadow, Greenway waystone')
    expect(markup).toMatch(/waystone: meadow, Greenway waystone[^\"]*\"><b>W<\/b>/)
    expect(markup).toContain('hidden-waystone: unexplored')
    expect(markup).not.toContain('hidden-waystone: unexplored, Greenway waystone')
    expect(markup).toContain('W waystone')
    const standingOnWaystone = renderToStaticMarkup(createElement(WizardMap, {
      ...mapProps(true), projection: { ...current, map: { ...current.map, player: { gridX: 1, gridZ: 0, yaw: 0 } } },
    }))
    expect(standingOnWaystone).toMatch(/waystone: meadow, player location, Greenway waystone[^\"]*\"><b[^>]*>▲<\/b><small[^>]*>W<\/small>/)
  })

  it('labels the learned west trail on a fogged map tile without claiming the terrain is explored', () => {
    const fog = projection.map.tiles[1]
    const current = { ...projection, map: { ...projection.map, tiles: [projection.map.tiles[0],
      { ...fog, hasWestTrail: true }] } } as WizardViewProjection
    const markup = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: current }))
    expect(markup).toContain('fog: unexplored, west trail to Mireglass')
    expect(markup).toContain('data-discovered="false"')
    expect(markup).toMatch(/fog: unexplored, west trail to Mireglass[^\"]*"><b>⇦<\/b>/)
    expect(markup).not.toContain('fog: meadow')
  })

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
    expect(open.match(/<h3>/g)).toHaveLength(projection.routes.length)
    expect(open).toContain('West bank crossing')
    expect(open).toContain('Move closer to the scaffold')
    expect(open).toContain('completed')
    expect(open).toContain('West foot (x 1, z 1) to east foot (x 2, z 2)')
    expect(open).toContain('Within 3 m of either foot, press E to cross')
    expect(open).toContain('locked')
    expect(open).not.toContain('Fogged crossing')
    expect(open).toContain('fog: unexplored')
    expect(open).not.toContain('fog: unexplored, route build site')
  })

  it('keeps the map Close target stable across content changes and preserves the scrollable mobile sheet', () => {
    const markup = renderToStaticMarkup(createElement(WizardSurface,
      { projection: sellProjection, onIntent: () => {} }))
    expect(markup.indexOf('.wr-map-backdrop{position:fixed}'))
      .toBeGreaterThan(markup.indexOf('.wr-map-backdrop{position:absolute;inset:0;z-index:10;'))
    expect(markup).toContain('.wr-map-dialog{height:min(620px,calc(100% - 24px));scrollbar-gutter:stable}')
    expect(markup).toContain('.wr-map-dialog header{position:sticky;top:0;z-index:1;background:#0e1715}')
    expect(markup).toContain('@media(max-width:719px){.wr-map-dialog{height:auto}}')
    expect(markup).toContain('.wr-map-dialog{position:relative;box-sizing:border-box;width:min(560px,88vw);max-height:calc(100% - 24px);padding:18px;overflow-y:auto')
    expect(markup).toContain('.wr-map-dialog header button{width:44px;height:44px;')
    expect(markup).toContain('.wr-map-dialog{position:absolute;inset:0;width:auto;max-height:none;')
    expect(renderMap(true)).toContain('aria-label="Close map"')
  })

  it('selects one discovered candidate by touch-sized atlas row and closes the map', () => {
    const onToggle = vi.fn()
    const onIntent = vi.fn()
    const routeKey = findElements(WizardMap(mapProps(true, onToggle, onIntent)), (element) => element.type === RouteKey)[0]
    const buttons = findElements(RouteKey(routeKey.props as Parameters<typeof RouteKey>[0]), (element) => element.props.className === 'wr-map-site')
    expect(buttons.map((button) => button.props['aria-label'])).toEqual(['Preview West bank crossing', 'Preview East bank crossing'])
    ;(buttons[1].props.onClick as () => void)()
    expect(onIntent).toHaveBeenCalledWith({ type: 'build-site.select', siteId: 'bridge-east' })
    expect(onToggle).toHaveBeenCalledTimes(1)
    const selected = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: { ...projection, selectedBuildSiteId: 'bridge-east' } }))
    expect(selected).toContain('aria-label="Preview East bank crossing" aria-pressed="true"')
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
    const sellButtons = findElements(renderHudTree({ projection: sellProjection, onIntent: () => {} }), (element) => element.type === 'button' && String(element.props['aria-label']).startsWith('Sell '))
    expect(sellButtons.map((button) => (button.props.style as { minHeight: number }).minHeight)).toEqual([44, 44])

    const noOffers = { ...sellProjection, stores: [{ ...sellProjection.stores[0], sellOffers: [] }] }
    const empty = renderToStaticMarkup(createElement(WizardHud, { projection: noOffers, onIntent: () => {} }))
    expect(empty).toContain('No materials to sell.')
    expect(empty).not.toContain('Sell all ×')
  })

  it('emits exact Sell 1 and Sell all quantities while preserving purchase and Close intents', () => {
    const emitted: unknown[] = []
    const buttons = findElements(renderHudTree({ projection: sellProjection, onIntent: (intent) => emitted.push(intent) }), (element) => element.type === 'button')
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
    const slots = findElements(renderHudTree({ projection: gearProjection, onIntent: () => {} }), (element) => element.props.className === 'wr-slot')
    expect(slots).toHaveLength(6)
    expect(findElements(slots[0], (element) => element.type === 'button')).toHaveLength(1)
    expect(slots.slice(1).every((slot) => findElements(slot, (element) => element.type === 'button').length === 0)).toBe(true)
    expect(markup).toContain('aria-label="Unequip Apprentice hat"')
    expect(markup).toContain('>Equip</button>')
  })

  it('emits unequip from both Equipment and Backpack while preserving backpack equip', () => {
    const emitted: unknown[] = []
    const buttons = findElements(renderHudTree({ projection: gearProjection, onIntent: (intent) => emitted.push(intent) }), (element) => element.type === 'button')
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

  it('lets the player choose a hand for a wand instead of silently taking the empty off hand', () => {
    const wand = { id: 'wand-stack', itemId: 'oak_wand', name: 'Oak wand', quantity: 1, equippableSlots: ['mainHand', 'offHand'] as const }
    const spade = { id: 'spade-stack', itemId: 'field_spade', name: 'Field spade', quantity: 1 }
    const projection = { ...gearProjection, backpack: { capacity: 20, stacks: [wand] },
      equipment: { ...gearProjection.equipment, mainHand: spade, offHand: null } } as WizardViewProjection
    const emitted: unknown[] = []
    const buttons = findElements(renderHudTree({ projection, onIntent: (intent) => emitted.push(intent) }), (element) => element.type === 'button')
    const main = buttons.find((button) => button.props['aria-label'] === 'Equip Oak wand in Main hand')
    const off = buttons.find((button) => button.props['aria-label'] === 'Equip Oak wand in Off hand')
    expect(main).toBeDefined()
    expect(off).toBeDefined()
    ;(main?.props.onClick as () => void)()
    ;(off?.props.onClick as () => void)()
    expect(emitted).toEqual([
      { type: 'equipment.equip', stackId: 'wand-stack', slot: 'mainHand' },
      { type: 'equipment.equip', stackId: 'wand-stack', slot: 'offHand' },
    ])
    const worn = { ...projection, equipment: { ...projection.equipment, offHand: wand } }
    const wornMarkup = renderToStaticMarkup(createElement(WizardHud, { projection: worn, onIntent: () => {} }))
    expect(wornMarkup).toContain('aria-label="Unequip Oak wand from Off hand"')
    expect(wornMarkup).not.toContain('aria-label="Equip Oak wand in Main hand"')
  })
})

describe('first-region magic and excavation controls', () => {
  const waystone = { id: 'greenway_waystone' as const, name: 'Greenway waystone', position: [3, 0, 3] as const, spellId: 'wayfinder_glow' as const, studied: false }
  const mound = { id: 'practice_mound' as const, name: 'Practice mound', position: [7, 0, 7] as const, revealed: true, excavated: false, minimumExcavationLevel: 1 }
  const cache = { id: 'ridge_cache' as const, name: 'Ridge cache', position: [7, 0, 7] as const, revealed: false, excavated: false, minimumExcavationLevel: 2 }
  const nearbyTree = { kind: 'resource' as const, targetId: 'oak', label: 'Greenway oak', action: 'Chop', actionable: true }
  const atWaystone = { ...sellProjection, openStoreId: null, player: { position: [3, 0, 3] as const, yaw: 0, pitch: 0 }, inscriptions: [waystone], digSites: [mound, cache], nearbyInteraction: nearbyTree } as WizardViewProjection

  it('offers Study beside another interaction while unknown magic cannot cast', () => {
    const emitted: unknown[] = []
    const buttons = findElements(renderHudTree({ projection: atWaystone, onIntent: (intent) => emitted.push(intent) }), (element) => element.type === 'button')
    const study = buttons.find((button) => button.props['aria-label'] === 'Study Greenway waystone')
    const cast = buttons.filter((button) => button.props['aria-label'] === 'Cast Wayfinder Glow')
    expect(study).toBeDefined()
    expect(cast).toHaveLength(2)
    expect(cast.every((button) => button.props.disabled === true)).toBe(true)
    expect(buttons.some((button) => button.props.className === 'wr-prompt')).toBe(true)
    ;(study?.props.onClick as () => void)()
    expect(emitted).toEqual([{ type: 'inscription.study', inscriptionId: 'greenway_waystone' }])
  })

  it('exposes learned Cast on touch and dig when the spade is equipped, without leaking the hidden cache', () => {
    const emitted: unknown[] = []
    const ready = {
      ...atWaystone,
      player: { position: [7, 0, 7] as const, yaw: 0, pitch: 0 },
      inscriptions: [{ ...waystone, studied: true }],
      learnedSpellIds: ['wayfinder_glow'],
      equipment: { ...atWaystone.equipment, mainHand: { id: 'spade-stack', itemId: 'field_spade', name: 'Field spade', quantity: 1 } },
      skillXp: { ...atWaystone.skillXp, excavation: 30, spellcraft: 10, wayfinding: 10 },
    } as WizardViewProjection
    const hud = renderHudTree({ projection: ready, onIntent: (intent) => emitted.push(intent) })
    const buttons = findElements(hud, (element) => element.type === 'button')
    const cast = buttons.find((button) => button.props.className === 'wr-touch-action' && button.props['aria-label'] === 'Cast Wayfinder Glow')
    const dig = buttons.find((button) => button.props['aria-label'] === 'Excavate Practice mound')
    expect(cast?.props.disabled).toBe(false)
    expect(dig?.props.disabled).toBe(false)
    expect(buttons.some((button) => button.props['aria-label'] === 'Excavate Ridge cache')).toBe(false)
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection: ready, onIntent: () => {} }))
    expect(markup).toContain('Wayfinder Glow: Learned')
    expect(markup).toContain('Excavation Lv2')
    expect(markup).toContain('Spellcraft: Lv1 (10 XP)')
    ;(cast?.props.onClick as () => void)()
    ;(dig?.props.onClick as () => void)()
    expect(emitted).toEqual([
      { type: 'spell.cast', spellId: 'wayfinder_glow' },
      { type: 'dig-site.excavate', digSiteId: 'practice_mound' },
    ])
  })

  it('keeps a revealed mound visible but explains why digging is unavailable without a spade', () => {
    const withoutSpade = { ...atWaystone, player: { position: [7, 0, 7] as const, yaw: 0, pitch: 0 }, digSites: [mound] } as WizardViewProjection
    const buttons = findElements(renderHudTree({ projection: withoutSpade, onIntent: () => {} }), (element) => element.type === 'button')
    expect(buttons.find((button) => button.props['aria-label'] === 'Excavate Practice mound')?.props.disabled).toBe(true)
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection: withoutSpade, onIntent: () => {} }))
    expect(markup).toContain('Equip a field spade')
  })
})

describe('selected construction site controls', () => {
  const nearbyTree = { kind: 'resource' as const, targetId: 'oak', label: 'Greenway oak', action: 'Chop', actionable: true }
  const ready = { ...sellProjection, openStoreId: null, selectedBuildSiteId: 'bridge-west', nearbyInteraction: nearbyTree } as WizardViewProjection

  it('shows Build and Cancel independently of the nearer generic interaction', () => {
    const emitted: unknown[] = []
    const hud = renderHudTree({ projection: ready, onIntent: (intent) => emitted.push(intent) })
    const card = findElements(hud, (element) => element.props.className === 'wr-panel wr-context wr-build-preview')[0]
    expect(card).toBeDefined()
    const buttons = findElements(card, (element) => element.type === 'button')
    expect(buttons.map((button) => button.props.children)).toEqual(['Build', 'Cancel'])
    expect(buttons[0].props.disabled).toBe(false)
    expect(findElements(hud, (element) => element.props.className === 'wr-prompt')).toHaveLength(1)
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection: ready, onIntent: () => {} }))
    expect(markup).toContain('West bank crossing')
    expect(markup).toContain('6 logs · Ready to build')
    ;(buttons[0].props.onClick as () => void)()
    ;(buttons[1].props.onClick as () => void)()
    expect(emitted).toEqual([
      { type: 'build-site.confirm', siteId: 'bridge-west' },
      { type: 'build-site.select', siteId: null },
    ])
  })

  it('disables Build with a reason and never previews a fogged site', () => {
    const blocked = { ...ready, selectedBuildSiteId: 'bridge-east' } as WizardViewProjection
    const card = findElements(renderHudTree({ projection: blocked, onIntent: () => {} }), (element) => element.props.className === 'wr-panel wr-context wr-build-preview')[0]
    const build = findElements(card, (element) => element.type === 'button')[0]
    expect(build.props.disabled).toBe(true)
    expect(renderToStaticMarkup(createElement(WizardHud, { projection: blocked, onIntent: () => {} }))).toContain('Move closer to the scaffold')
    const hidden = { ...ready, selectedBuildSiteId: 'bridge-fog' } as WizardViewProjection
    expect(findElements(renderHudTree({ projection: hidden, onIntent: () => {} }), (element) => element.props.className === 'wr-panel wr-context wr-build-preview')).toHaveLength(0)
  })
})

describe('field camp construction controls', () => {
  const ready = { ...sellProjection, openStoreId: null,
    fieldCamp: { camps: [], selectionEnabled: true, preview: { tileId: 'camp-tile', position: [0, 0, 0], rejection: null } },
  } as WizardViewProjection

  it('shows the fixed recipe, authoritative readiness, and exact Build and Cancel intents', () => {
    const onIntent = vi.fn()
    const card = findElements(renderHudTree({ projection: ready, onIntent }), (element) => element.props['aria-label'] === 'Field camp preview')[0]
    const buttons = findElements(card, (element) => element.type === 'button')
    expect(renderToStaticMarkup(card)).toContain('4 logs + 1 stone · 30 construction XP')
    expect(renderToStaticMarkup(card)).toContain('Ready to build')
    expect(buttons[0].props.disabled).toBe(false)
    ;(buttons[0].props.onClick as () => void)()
    ;(buttons[1].props.onClick as () => void)()
    expect(onIntent.mock.calls.map(([intent]) => intent)).toEqual([{ type: 'field-camp.confirm', tileId: 'camp-tile' }, { type: 'field-camp.select', tileId: null }])
  })

  it('gives the 390x500 camp preview a scrolling card below the top controls and beside touch actions', () => {
    const markup = renderToStaticMarkup(createElement(WizardSurface, { projection: ready, onIntent: vi.fn() }))
    expect(markup).toContain('aria-label="Field camp preview" data-field-camp-panel="true"')
    expect(markup).toContain('left:8px;top:208px;bottom:auto;transform:none;box-sizing:border-box;width:min(280px,calc(100% - 108px));max-height:calc(100% - 350px);overflow-y:auto;overscroll-behavior:contain')
    expect(markup).toContain('.wr-build-preview .wr-build-actions button{min-height:44px;justify-content:center}')
    expect(markup).toContain('.wr-surface:has([data-field-camp-panel]) .wr-events{display:none}')
    expect(markup).toContain('>Build</button>')
    expect(markup).toContain('>Cancel</button>')
  })

  it('disables unresolved, rejected, or unavailable previews and shows the rejection without overlapping route or shop cards', () => {
    const fieldCamp = ready.fieldCamp!
    for (const camp of [
      { ...fieldCamp, preview: { ...fieldCamp.preview!, position: null } },
      { ...fieldCamp, selectionEnabled: false },
      { ...fieldCamp, preview: { ...fieldCamp.preview!, rejection: { code: 'too_far' as const, message: 'The camp site is out of reach.' } } },
    ]) {
      const hud = renderHudTree({ projection: { ...sellProjection, selectedBuildSiteId: 'bridge-west', fieldCamp: camp }, onIntent: vi.fn() })
      const cards = findElements(hud, (element) => element.props.className === 'wr-panel wr-context wr-build-preview')
      expect(cards).toHaveLength(1)
      expect(findElements(cards[0], (element) => element.type === 'button')[0].props.disabled).toBe(true)
      expect(renderToStaticMarkup(hud)).not.toContain('data-store-panel')
      if (camp.preview?.rejection) expect(renderToStaticMarkup(cards[0])).toContain(camp.preview.rejection.message)
    }
  })

  it('shows a built status after placement and keeps older HUDs free of camp controls', () => {
    const current = { ...ready, fieldCamp: { camps: [{ tileId: 'camp-tile', position: [0, 0, 0] as const }], preview: null, selectionEnabled: false } }
    expect(renderToStaticMarkup(createElement(WizardHud, { projection: current, onIntent: vi.fn() }))).toContain('Field camp built. One camp per world.')
    expect(renderToStaticMarkup(createElement(WizardHud, { projection: sellProjection, onIntent: vi.fn() }))).not.toContain('Field camp')
  })
})
