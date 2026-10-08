import { describe, expect, it, vi } from 'vitest'
import { createElement, createRef, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cameraOrbitFromDrag, CENTERED_CAMERA_ORBIT, keyboardEventTime, keyboardMovementIntents, movementVector, releaseHeldControls, WizardSurface } from './WizardSurface'
import { WizardHud } from './WizardHud'
import { RouteKey, WizardMap, mapCellForArrow, mapDialogTabTarget, mapHeadingRotation, mapSheetMode, mapToggleForKey, northUpGridOrder } from './WizardMap'
import type { WizardViewProjection } from './contracts'

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
  it('keeps the shop header and Close control within a short viewport', () => {
    const markup = renderToStaticMarkup(createElement(WizardSurface, { projection: sellProjection, onIntent: () => {} }))
    expect(markup).toContain('Greenway Outfitters')
    expect(markup).toContain('class="wr-panel wr-context" data-store-panel="true"')
    expect(markup).toContain('>Close</button>')
    expect(markup).toContain('.wr-context:not(.wr-build-preview){box-sizing:border-box;max-height:calc(100% - 215px);overflow-y:auto')
    expect(markup).toContain('@media(max-width:719px){.wr-backpack{display:none}.wr-backpack-toggle{position:absolute')
    expect(markup).toContain('.wr-map-toggle{left:106px;right:auto;top:120px}')
    expect(markup).toContain('.wr-prompt{left:8px;top:176px;bottom:auto;transform:none')
    expect(markup).toContain('.wr-events{top:252px;left:8px;max-height:48px;overflow:hidden')
    expect(markup).toContain('.wr-surface .wr-context[data-store-panel]{bottom:14px;max-height:calc(100% - 78px)}')
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

  it('shows field camp markers only on discovered local cells and in the overview', () => {
    const current = { ...campProjection, map: { ...campProjection.map,
      tiles: campProjection.map.tiles.map((tile) => ({ ...tile, hasCamp: true, discovered: tile.id === 'tile-1-1' })),
      overview: () => ({ player: { gridX: 1, gridZ: 1, yaw: 0 }, cells: [{ id: 'camp-chunk', gridX: 0, gridZ: 0, terrain: 'loam' as const, biome: 'meadow', discoveredCells: 1, markers: ['Field camp'] }] }),
    } }
    const markup = renderToStaticMarkup(createElement(WizardMap, { ...mapProps(true), projection: current }))
    expect(markup).toContain('tile-1-1: meadow, player location, field camp')
    expect(markup).not.toContain('unexplored, field camp')
    expect(markup).toContain('Field camp"><i')
    expect(markup).toContain('<b>C</b>')
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
    expect(loadOverview).toHaveBeenCalledTimes(1)
    expect(expanded).toContain('<details class="wr-map-overview"><summary>World overview (toggle local map)</summary>')
    expect(expanded).toContain('.wr-map-overview[open]~.wr-map-local{display:none}')
    expect(expanded).toContain('chunk-0-0: 2 of 256 cells discovered, sampled temperate_forest, player location, Greenway Outfitters')
    expect(expanded).toContain('chunk-1-0: unexplored')
    expect(expanded).not.toContain('chunk-1-0: unexplored, sampled')
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
    expect(open).toContain('Walk to either end and press E to cross')
    expect(open).toContain('locked')
    expect(open).not.toContain('Fogged crossing')
    expect(open).toContain('fog: unexplored')
    expect(open).not.toContain('fog: unexplored, route build site')
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
    const sellButtons = findElements(WizardHud({ projection: sellProjection, onIntent: () => {} }), (element) => element.type === 'button' && String(element.props['aria-label']).startsWith('Sell '))
    expect(sellButtons.map((button) => (button.props.style as { minHeight: number }).minHeight)).toEqual([44, 44])

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

  it('lets the player choose a hand for a wand instead of silently taking the empty off hand', () => {
    const wand = { id: 'wand-stack', itemId: 'oak_wand', name: 'Oak wand', quantity: 1, equippableSlots: ['mainHand', 'offHand'] as const }
    const spade = { id: 'spade-stack', itemId: 'field_spade', name: 'Field spade', quantity: 1 }
    const projection = { ...gearProjection, backpack: { capacity: 20, stacks: [wand] },
      equipment: { ...gearProjection.equipment, mainHand: spade, offHand: null } } as WizardViewProjection
    const emitted: unknown[] = []
    const buttons = findElements(WizardHud({ projection, onIntent: (intent) => emitted.push(intent) }), (element) => element.type === 'button')
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
    const buttons = findElements(WizardHud({ projection: atWaystone, onIntent: (intent) => emitted.push(intent) }), (element) => element.type === 'button')
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
    const hud = WizardHud({ projection: ready, onIntent: (intent) => emitted.push(intent) })
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
    const buttons = findElements(WizardHud({ projection: withoutSpade, onIntent: () => {} }), (element) => element.type === 'button')
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
    const hud = WizardHud({ projection: ready, onIntent: (intent) => emitted.push(intent) })
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
    const card = findElements(WizardHud({ projection: blocked, onIntent: () => {} }), (element) => element.props.className === 'wr-panel wr-context wr-build-preview')[0]
    const build = findElements(card, (element) => element.type === 'button')[0]
    expect(build.props.disabled).toBe(true)
    expect(renderToStaticMarkup(createElement(WizardHud, { projection: blocked, onIntent: () => {} }))).toContain('Move closer to the scaffold')
    const hidden = { ...ready, selectedBuildSiteId: 'bridge-fog' } as WizardViewProjection
    expect(findElements(WizardHud({ projection: hidden, onIntent: () => {} }), (element) => element.props.className === 'wr-panel wr-context wr-build-preview')).toHaveLength(0)
  })
})

describe('field camp construction controls', () => {
  const ready = { ...sellProjection, openStoreId: null,
    fieldCamp: { camps: [], selectionEnabled: true, preview: { tileId: 'camp-tile', position: [0, 0, 0], rejection: null } },
  } as WizardViewProjection

  it('shows the fixed recipe, authoritative readiness, and exact Build and Cancel intents', () => {
    const onIntent = vi.fn()
    const card = findElements(WizardHud({ projection: ready, onIntent }), (element) => element.props['aria-label'] === 'Field camp preview')[0]
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
      const hud = WizardHud({ projection: { ...sellProjection, selectedBuildSiteId: 'bridge-west', fieldCamp: camp }, onIntent: vi.fn() })
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
