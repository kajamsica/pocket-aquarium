import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

export type HudPanelId = 'guide' | 'water' | 'store' | 'care' | 'view' | 'progress' | 'residents' | 'specimen' | `metric:${string}`
export type HudDeviceProfile = 'compact' | 'wide'
type SnapHorizontal = 'left' | 'center' | 'right'
type SnapVertical = 'top' | 'center' | 'bottom'
export type HudSnap = `${SnapVertical}-${SnapHorizontal}`

export interface HudWindowLayout {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly open: boolean
  readonly minimized: boolean
  readonly z: number
  readonly snap: HudSnap | null
  readonly snapOrder: number
}

type HudProfiles = Record<HudDeviceProfile, Record<string, HudWindowLayout>>

const HUD_LAYOUT_KEY = 'pocket-aquarium-hud-layout-v4'
const HUD_LEGACY_LAYOUT_KEY = 'pocket-aquarium-hud-layout-v3'
const DESKTOP_QUERY = '(min-width: 861px)'
const PHONE_QUERY = '(max-width: 600px)'
const BOTTOM_SAFE = 72
const EDGE = 12
const STACK_GAP = 8
const MINIMIZED_HEIGHT = 42
/* A pinned reading is an instrument, not a sheet, so compact gives it its own
 * size envelope: wide enough for a label and value, small enough to rail up an edge. */
const METRIC_MAX_WIDTH = 150
const METRIC_MAX_HEIGHT = 64
const METRIC_MIN_WIDTH = 96
const METRIC_MIN_HEIGHT = 44
/* Fresh compact pins rail in after any reef-first preset slot, then renormalize on load. */
const METRIC_RAIL_ORDER = 8
const METRIC_RAIL_SNAP: HudSnap = 'top-right'
const BUILT_IN_PANELS = ['guide', 'water', 'store', 'care', 'view', 'progress', 'residents', 'specimen'] as const satisfies readonly HudPanelId[]
const SNAP_TARGETS: readonly HudSnap[] = [
  'top-left', 'top-center', 'top-right',
  'center-left', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]
type HudResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
const RESIZE_LABELS: Readonly<Record<HudResizeDirection, string>> = {
  n: 'top edge', ne: 'top right corner', e: 'right edge', se: 'bottom right corner',
  s: 'bottom edge', sw: 'bottom left corner', w: 'left edge', nw: 'top left corner',
}
const RESIZE_DIRECTIONS = Object.keys(RESIZE_LABELS) as readonly HudResizeDirection[]

function topSafe() {
  return window.innerWidth < 861 ? 204 : 104
}

function isMetricPanel(id: string) {
  return id.startsWith('metric:')
}

function windowLimits(id?: HudPanelId) {
  const compact = window.innerWidth < 861
  const availableHeight = Math.max(116, window.innerHeight - topSafe() - BOTTOM_SAFE)
  if (compact && id && isMetricPanel(id)) {
    const maxWidth = Math.min(METRIC_MAX_WIDTH, window.innerWidth - 16)
    const maxHeight = Math.min(METRIC_MAX_HEIGHT, availableHeight)
    return { minWidth: Math.min(METRIC_MIN_WIDTH, maxWidth), minHeight: Math.min(METRIC_MIN_HEIGHT, maxHeight), maxWidth, maxHeight }
  }
  const minWidth = Math.min(compact ? 210 : 220, window.innerWidth - 16)
  const minHeight = Math.min(140, availableHeight)
  return {
    minWidth,
    minHeight,
    maxWidth: compact ? Math.max(minWidth, Math.min(320, window.innerWidth - 20)) : Math.max(minWidth, window.innerWidth - 16),
    maxHeight: compact
      ? Math.max(minHeight, Math.min(availableHeight, Math.round(window.innerHeight * .38)))
      : availableHeight,
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function defaultLayout(id: HudPanelId, profile: HudDeviceProfile): HudWindowLayout {
  const currentWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const currentHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  const compact = profile === 'compact'
  const viewportWidth = (currentWidth < 861) === compact ? currentWidth : compact ? 390 : 1440
  const viewportHeight = (currentWidth < 861) === compact ? currentHeight : compact ? 844 : 900
  const edge = compact ? 10 : 24
  const top = compact ? 204 : 116
  const width = (desktop: number, phone = desktop) => Math.min(compact ? phone : desktop, viewportWidth - edge * 2)
  const height = (desktop: number, phone = desktop) => Math.min(compact ? phone : desktop, viewportHeight - top - 78)
  const right = (panelWidth: number) => Math.max(edge, viewportWidth - panelWidth - edge)
  switch (id) {
    case 'guide': return { x: edge, y: top, width: width(310, 286), height: height(186, 170), open: true, minimized: false, z: 20, snap: 'top-left', snapOrder: 0 }
    /* Compact chemistry is a bounded bottom tool (<=40dvh) so the tank stays the world. */
    case 'water': {
      if (!compact) return { x: edge, y: top + 26, width: width(380), height: height(500), open: false, minimized: false, z: 21, snap: 'top-left', snapOrder: 1 }
      const panelHeight = height(Math.round(viewportHeight * .38))
      return { x: edge, y: Math.max(top, viewportHeight - BOTTOM_SAFE - panelHeight), width: width(342), height: panelHeight,
        open: false, minimized: false, z: 21, snap: 'bottom-center', snapOrder: 0 }
    }
    case 'store': { const panelWidth = width(460, 344); return { x: right(panelWidth), y: top, width: panelWidth, height: height(570, 480), open: false, minimized: false, z: 22, snap: 'top-right', snapOrder: 0 } }
    case 'care': { const panelWidth = width(360, 286); return { x: right(panelWidth), y: top, width: panelWidth, height: height(260, 180),
      open: false, minimized: false, z: 23, snap: 'bottom-right', snapOrder: 0 } }
    case 'view': { const panelWidth = width(320, 294); return { x: right(panelWidth), y: top + 34, width: panelWidth, height: height(340, 310), open: false, minimized: false, z: 24, snap: null, snapOrder: 0 } }
    case 'progress': return { x: edge, y: top + 72, width: width(360, 332), height: height(420, 380), open: false, minimized: false, z: 25, snap: null, snapOrder: 0 }
    /* Roster and inspector stay unsnapped so adding them cannot reshuffle an existing snap stack. */
    case 'residents': { const panelWidth = width(320, 300); return { x: right(panelWidth), y: top + 60, width: panelWidth, height: height(340, 300), open: false, minimized: false, z: 26, snap: null, snapOrder: 0 } }
    case 'specimen': return { x: edge, y: top + 200, width: width(300, 286), height: height(228, 208), open: false, minimized: false, z: 27, snap: null, snapOrder: 0 }
    default: {
      const index = Math.abs(id.split('').reduce((value, character) => value + character.charCodeAt(0), 0)) % 5
      /* Compact pins join an ordered edge rail instead of cascading over the tank centre. */
      if (compact) return { x: right(METRIC_MAX_WIDTH), y: top + index * (METRIC_MAX_HEIGHT + STACK_GAP),
        width: METRIC_MAX_WIDTH, height: METRIC_MAX_HEIGHT, open: true, minimized: false, z: 30 + index,
        snap: METRIC_RAIL_SNAP, snapOrder: METRIC_RAIL_ORDER + index }
      return { x: 28 + index * 44, y: 260 + index * 38, width: 220, height: 132, open: true, minimized: false, z: 30 + index, snap: null, snapOrder: index }
    }
  }
}

function mergeProfiles(source: Partial<Record<HudDeviceProfile, Record<string, Partial<HudWindowLayout>>>> | undefined): HudProfiles {
  const profiles: HudProfiles = { compact: {}, wide: {} }
  for (const profile of ['compact', 'wide'] as const) {
    const merged = Object.entries(source?.[profile] ?? {}).map(([id, layout]) =>
      [id, { ...defaultLayout(id as HudPanelId, profile), ...layout }, typeof layout?.snapOrder === 'number'] as [string, HudWindowLayout, boolean])
    // A v3 record never supplied snapOrder, so its stack order falls back to the saved z/id order.
    const savedOrder = (entry: [string, HudWindowLayout, boolean]) => entry[2] ? entry[1].snapOrder : Number.MAX_SAFE_INTEGER
    const stacked = merged.filter(([, layout]) => layout.snap)
      .sort((a, b) => (savedOrder(a) - savedOrder(b)) || (a[1].z - b[1].z) || a[0].localeCompare(b[0])).map(([id]) => id)
    profiles[profile] = Object.fromEntries(merged.map(([id, layout]) =>
      [id, layout.snap ? { ...layout, snapOrder: stacked.indexOf(id) } : layout]))
  }
  return profiles
}

function readProfiles(): HudProfiles {
  try {
    const stored = window.localStorage.getItem(HUD_LAYOUT_KEY) ?? window.localStorage.getItem(HUD_LEGACY_LAYOUT_KEY)
    return mergeProfiles(JSON.parse(stored ?? '{}') as Partial<Record<HudDeviceProfile, Record<string, Partial<HudWindowLayout>>>>)
  } catch { /* A corrupt UI preference should never block the aquarium. */ }
  return { compact: {}, wide: {} }
}

/* Persisted records are sparse, so stack math runs against the built-in panels
 * plus any stored override or pinned metric window, with overrides winning. */
function effectiveLayouts(overrides: Record<string, HudWindowLayout>, profile: HudDeviceProfile) {
  return { ...Object.fromEntries(BUILT_IN_PANELS.map((id) => [id, defaultLayout(id, profile)])), ...overrides }
}

/* Compact viewports show one full sheet at a time, so opening a built-in panel closes the
 * other built-ins by materializing a closed override that keeps their saved geometry, snap,
 * minimized preference, and z. Pinned metric windows are never part of that exclusivity, and
 * neither is a minimized panel: collapsed to its title bar it is edge chrome, not a sheet. */
function closedBuiltInSiblings(overrides: Record<string, HudWindowLayout>, keep: HudPanelId) {
  const layouts = effectiveLayouts(overrides, 'compact')
  return Object.fromEntries(BUILT_IN_PANELS.filter((id) => id !== keep && layouts[id].open && !layouts[id].minimized)
    .map((id) => [id, { ...layouts[id], open: false }]))
}

function measured(id: string, layout: HudWindowLayout) {
  const limits = windowLimits(id as HudPanelId)
  return {
    width: clamp(layout.width, limits.minWidth, limits.maxWidth),
    height: layout.minimized ? MINIMIZED_HEIGHT : clamp(layout.height, limits.minHeight, limits.maxHeight),
  }
}

/* Every open window on one anchor is laid out as a single contained stack:
 * top anchors grow down, bottom anchors grow up, center anchors stay centered. */
function stackPositions(layouts: Record<string, HudWindowLayout>, snap: HudSnap) {
  const [vertical, horizontal] = snap.split('-') as [SnapVertical, SnapHorizontal]
  const members = Object.entries(layouts).filter(([, layout]) => layout.open && layout.snap === snap)
    .sort((a, b) => (a[1].snapOrder - b[1].snapOrder) || a[0].localeCompare(b[0]))
  const sizes = members.map(([id, layout]) => measured(id, layout))
  const total = sizes.reduce((sum, size) => sum + size.height, 0) + STACK_GAP * Math.max(0, sizes.length - 1)
  const safeTop = topSafe()
  const safeBottom = Math.max(safeTop, window.innerHeight - BOTTOM_SAFE)
  let y = Math.max(safeTop, vertical === 'top' ? safeTop
    : vertical === 'bottom' ? safeBottom - total : safeTop + (safeBottom - safeTop - total) / 2)
  const positions: Record<string, { x: number; y: number }> = {}
  members.forEach(([id], index) => {
    const width = sizes[index].width
    positions[id] = {
      x: Math.round(horizontal === 'left' ? EDGE
        : horizontal === 'right' ? Math.max(EDGE, window.innerWidth - width - EDGE)
          : Math.max(EDGE, (window.innerWidth - width) / 2)),
      y: Math.round(y),
    }
    y += sizes[index].height + STACK_GAP
  })
  return { positions, fits: total <= safeBottom - safeTop }
}

function snapAtPointer(x: number, y: number): HudSnap | null {
  const sideBand = Math.min(92, window.innerWidth * .24)
  const topBand = Math.min(154, window.innerHeight * .22)
  const bottomBand = Math.min(116, window.innerHeight * .18)
  const centerBandX = Math.min(84, window.innerWidth * .18)
  const horizontal: SnapHorizontal | null = x <= sideBand ? 'left'
    : x >= window.innerWidth - sideBand ? 'right'
      : Math.abs(x - window.innerWidth / 2) <= centerBandX ? 'center' : null
  const vertical: SnapVertical | null = y <= topBand ? 'top'
    : y >= window.innerHeight - bottomBand ? 'bottom'
      : horizontal && horizontal !== 'center' ? 'center' : null
  if (!horizontal || !vertical || (horizontal === 'center' && vertical === 'center')) return null
  return `${vertical}-${horizontal}`
}

export interface HudWorkspaceController {
  readonly isDesktop: boolean
  readonly isPhone: boolean
  readonly profile: HudDeviceProfile
  readonly isArranging: boolean
  readonly arrangeLocked: boolean
  readonly toggleArrange: () => void
  readonly stopArrange: () => void
  readonly positionFor: (id: HudPanelId, width: number, height: number) => { x: number; y: number }
  readonly canSnap: (id: HudPanelId, snap: HudSnap, width: number, height: number) => boolean
  readonly snapOrderFor: (id: HudPanelId, snap: HudSnap) => number
  readonly layoutFor: (id: HudPanelId) => HudWindowLayout
  readonly isOpen: (id: HudPanelId) => boolean
  readonly openPanel: (id: HudPanelId) => void
  readonly togglePanel: (id: HudPanelId) => void
  readonly closePanel: (id: HudPanelId) => void
  readonly toggleMinimized: (id: HudPanelId) => void
  readonly resetPanel: (id: HudPanelId) => void
  readonly resetWorkspace: () => void
  readonly registerPanel: (id: HudPanelId) => void
  readonly applyReefFirstPreset: (metricIds: readonly HudPanelId[]) => void
  readonly bringToFront: (id: HudPanelId) => void
  readonly updateLayout: (id: HudPanelId, patch: Partial<HudWindowLayout>) => void
}

export function useHudWorkspace(): HudWorkspaceController {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches)
  const [isPhone, setIsPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches)
  const [arrange, setArrange] = useState({ locked: false, alt: false })
  const [profiles, setProfiles] = useState<HudProfiles>(readProfiles)
  const profile: HudDeviceProfile = isDesktop ? 'wide' : 'compact'
  const profilesRef = useRef(profiles)
  const profileRef = useRef(profile)
  profilesRef.current = profiles
  profileRef.current = profile

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY)
    const phone = window.matchMedia(PHONE_QUERY)
    const update = () => {
      setIsDesktop(media.matches)
      setIsPhone(phone.matches)
    }
    update()
    media.addEventListener('change', update)
    phone.addEventListener('change', update)
    window.addEventListener('resize', update)
    return () => {
      media.removeEventListener('change', update)
      phone.removeEventListener('change', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  useEffect(() => {
    const editing = () => {
      const active = document.activeElement as HTMLElement | null
      return !!active && (active.isContentEditable || /^(input|select|textarea)$/i.test(active.tagName))
    }
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setArrange({ locked: false, alt: false })
      else if (event.key === 'Alt' && !editing()) setArrange((current) => ({ ...current, alt: true }))
    }
    const up = (event: KeyboardEvent) => { if (event.key === 'Alt') setArrange((current) => ({ ...current, alt: false })) }
    const drop = () => setArrange((current) => (current.alt ? { ...current, alt: false } : current))
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', drop)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', drop)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem(HUD_LAYOUT_KEY, JSON.stringify(profiles)) } catch { /* UI layout persistence is optional */ }
    }, 140)
    return () => window.clearTimeout(timer)
  }, [profiles])

  /* A saved or wide-authored layout can carry several open built-ins into compact, so the
   * profile is normalized once on activation to the front-most open sheet and left untouched
   * when it already satisfies the one-sheet invariant. */
  useEffect(() => {
    if (profile !== 'compact') return
    setProfiles((current) => {
      const layouts = effectiveLayouts(current.compact, 'compact')
      const open = BUILT_IN_PANELS.filter((id) => layouts[id].open && !layouts[id].minimized)
      if (open.length < 2) return current
      const front = open.reduce((best, id) => (layouts[id].z > layouts[best].z ? id : best))
      return { ...current, compact: { ...current.compact, ...closedBuiltInSiblings(current.compact, front) } }
    })
  }, [profile])

  const layoutFor = useCallback((id: HudPanelId) => profilesRef.current[profileRef.current][id] ?? defaultLayout(id, profileRef.current), [])
  const updateLayout = useCallback((id: HudPanelId, patch: Partial<HudWindowLayout>) => {
    setProfiles((current) => {
      const profile = profileRef.current
      return { ...current, [profile]: { ...current[profile], [id]: { ...(current[profile][id] ?? defaultLayout(id, profile)), ...patch } } }
    })
  }, [])
  const bringToFront = useCallback((id: HudPanelId) => {
    setProfiles((current) => {
      const profile = profileRef.current
      const nextZ = Math.max(30, ...Object.values(current[profile]).map((layout) => layout.z)) + 1
      return { ...current, [profile]: { ...current[profile], [id]: { ...(current[profile][id] ?? defaultLayout(id, profile)), z: nextZ } } }
    })
  }, [])
  const openPanel = useCallback((id: HudPanelId) => {
    setProfiles((current) => {
      const profile = profileRef.current
      const nextZ = Math.max(30, ...Object.values(current[profile]).map((layout) => layout.z)) + 1
      const exclusive = profile === 'compact' && (BUILT_IN_PANELS as readonly HudPanelId[]).includes(id)
        ? closedBuiltInSiblings(current.compact, id) : {}
      return { ...current, [profile]: { ...current[profile], ...exclusive,
        [id]: { ...(current[profile][id] ?? defaultLayout(id, profile)), open: true, minimized: false, z: nextZ } } }
    })
  }, [])
  const closePanel = useCallback((id: HudPanelId) => updateLayout(id, { open: false }), [updateLayout])
  const togglePanel = useCallback((id: HudPanelId) => {
    const current = layoutFor(id)
    if (current.open && !current.minimized) closePanel(id)
    else openPanel(id)
  }, [closePanel, layoutFor, openPanel])
  const toggleMinimized = useCallback((id: HudPanelId) => {
    const current = layoutFor(id)
    // Restoring makes a compact built-in a full sheet again, so it has to claim the screen through
    // the same exclusivity rule as opening it -- which is what `togglePanel` already does for a
    // minimized panel. Collapsing stays a plain patch: title-bar chrome has no sibling to close.
    if (current.minimized) openPanel(id)
    else updateLayout(id, { minimized: true, open: true })
  }, [layoutFor, openPanel, updateLayout])
  // `defaultLayout` is never minimized, so a reset built-in also lands full size and must reuse the
  // same exclusivity: restore the default geometry, then open it through `openPanel`.
  const resetPanel = useCallback((id: HudPanelId) => {
    updateLayout(id, defaultLayout(id, profileRef.current))
    openPanel(id)
  }, [openPanel, updateLayout])
  const isOpen = useCallback((id: HudPanelId) => layoutFor(id).open, [layoutFor])
  const positionFor = useCallback((id: HudPanelId, width: number, height: number) => {
    const layouts = effectiveLayouts(profilesRef.current[profileRef.current], profileRef.current)
    const layout = layouts[id] ?? defaultLayout(id, profileRef.current)
    const stacked = layout.snap ? stackPositions({ ...layouts, [id]: layout }, layout.snap).positions[id] : undefined
    return stacked ?? {
      x: Math.round(clamp(layout.x, 8, Math.max(8, window.innerWidth - width - 8))),
      y: Math.round(clamp(layout.y, topSafe(), Math.max(topSafe(), window.innerHeight - height - BOTTOM_SAFE))),
    }
  }, [])
  const canSnap = useCallback((id: HudPanelId, snap: HudSnap, width: number, height: number) => {
    const layouts = effectiveLayouts(profilesRef.current[profileRef.current], profileRef.current)
    const layout = { ...(layouts[id] ?? defaultLayout(id, profileRef.current)), open: true, snap, width, height }
    return stackPositions({ ...layouts, [id]: layout }, snap).fits
  }, [])
  const snapOrderFor = useCallback((id: HudPanelId, snap: HudSnap) => {
    const layouts = effectiveLayouts(profilesRef.current[profileRef.current], profileRef.current)
    if (layouts[id]?.snap === snap) return layouts[id].snapOrder
    return Math.max(-1, ...Object.entries(layouts)
      .filter(([otherId, layout]) => otherId !== id && layout.snap === snap).map(([, layout]) => layout.snapOrder)) + 1
  }, [])
  const toggleArrange = useCallback(() => setArrange((current) => ({ locked: !(current.locked || current.alt), alt: false })), [])
  const stopArrange = useCallback(() => setArrange({ locked: false, alt: false }), [])
  const resetWorkspace = useCallback(() => setProfiles((current) => ({ ...current, [profileRef.current]: {} })), [])

  /* effectiveLayouts knows the built-ins by construction but can only see a dynamic window
   * once the profile stores one, so a pinned reading records its default geometry on first
   * render. Without it two unstored pins resolve to the same rail slot and overlap, which
   * is reachable by resetting the layout or by pinning on the laptop and then narrowing. */
  const registerPanel = useCallback((id: HudPanelId) => {
    if (!isMetricPanel(id)) return
    setProfiles((current) => {
      const profile = profileRef.current
      return current[profile][id] ? current : { ...current, [profile]: { ...current[profile], [id]: defaultLayout(id, profile) } }
    })
  }, [])

  /* One action installs the playtested reef-first phone arrangement: a narrowed guide sheet
   * with Care collapsed beneath it, chemistry parked as a closed bottom tool, full sheets
   * unsnapped out of the reading lane, and the essential readings railed up the free edge.
   * It writes only the compact profile, so a laptop arrangement is never disturbed, and it
   * is a starting layout — every window stays openable, movable, resizable, and closable. */
  const applyReefFirstPreset = useCallback((metricIds: readonly HudPanelId[]) => {
    setProfiles((current) => {
      const layouts = effectiveLayouts(current.compact, 'compact')
      const limits = windowLimits('guide')
      const sheetWidth = clamp(window.innerWidth - METRIC_MAX_WIDTH - EDGE * 2 - STACK_GAP, limits.minWidth, limits.maxWidth)
      /* Title, explanation, and the pinned call to action each need their own band at 390x844,
       * so the preset sheet gets a bounded reading height instead of inheriting a shorter one. */
      const guideHeight = clamp(Math.round(window.innerHeight * .3), 236, limits.maxHeight)
      const compact: Record<string, HudWindowLayout> = Object.fromEntries(Object.entries(current.compact)
        // A reading left over from an earlier pin set leaves the rail so it cannot hold a slot.
        .map(([id, layout]) => [id, isMetricPanel(id) ? { ...layout, open: false } : layout]))
      for (const id of BUILT_IN_PANELS) compact[id] = { ...layouts[id], open: false, snap: null }
      compact.guide = { ...layouts.guide, width: sheetWidth, height: guideHeight, open: true, minimized: false, snap: 'top-left', snapOrder: 0, z: 20 }
      compact.care = { ...layouts.care, width: sheetWidth, open: true, minimized: true, snap: 'top-left', snapOrder: 1, z: 21 }
      compact.water = { ...defaultLayout('water', 'compact'), z: 22 }
      metricIds.forEach((id, index) => {
        compact[id] = { ...defaultLayout(id, 'compact'), width: METRIC_MAX_WIDTH, height: METRIC_MAX_HEIGHT,
          open: true, minimized: false, snap: METRIC_RAIL_SNAP, snapOrder: index, z: 30 + index }
      })
      return { ...current, compact }
    })
  }, [])

  return useMemo(() => ({ isDesktop, isPhone, profile, isArranging: arrange.locked || arrange.alt, arrangeLocked: arrange.locked, toggleArrange, stopArrange,
    positionFor, canSnap, snapOrderFor, layoutFor, isOpen, openPanel, togglePanel, closePanel, toggleMinimized, resetPanel, resetWorkspace,
    registerPanel, applyReefFirstPreset, bringToFront, updateLayout }),
    [applyReefFirstPreset, arrange, bringToFront, canSnap, closePanel, isDesktop, isOpen, isPhone, layoutFor, openPanel, positionFor, profile,
      registerPanel, resetPanel, resetWorkspace, snapOrderFor, stopArrange, toggleArrange, toggleMinimized, togglePanel, updateLayout])
}

interface HudWindowProps {
  readonly id: HudPanelId
  readonly title: string
  readonly eyebrow?: string
  readonly className?: string
  readonly workspace: HudWorkspaceController
  readonly onClose?: () => void
  readonly children: ReactNode
}

export function HudWindow({ id, title, eyebrow, className = '', workspace, onClose, children }: HudWindowProps) {
  const layout = workspace.layoutFor(id)
  const arranging = workspace.isArranging
  const rootRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ pointerId: number; originX: number; originY: number; startX: number; startY: number; x: number; y: number; snap: HudSnap | null } | null>(null)
  const resizeRef = useRef<{ pointerId: number; originX: number; originY: number; startX: number; startY: number; startWidth: number; startHeight: number;
    x: number; y: number; width: number; height: number } | null>(null)
  const cleanupInteractionRef = useRef<(() => void) | null>(null)
  const [snapPreview, setSnapPreview] = useState<{ snap: HudSnap; valid: boolean } | null>(null)

  const limits = windowLimits(id)
  const safeWidth = clamp(layout.width, limits.minWidth, limits.maxWidth)
  const safeHeight = clamp(layout.height, limits.minHeight, limits.maxHeight)
  const { x: renderedX, y: renderedY } = workspace.positionFor(id, safeWidth, safeHeight)

  useEffect(() => () => cleanupInteractionRef.current?.(), [])
  useEffect(() => { workspace.registerPanel(id) }, [id, workspace])
  useEffect(() => {
    if (arranging) return
    const drag = dragRef.current
    const resize = resizeRef.current
    // Leaving Arrange mid-gesture commits what the player already moved, then drops every listener.
    if (drag || resize) restoreRenderedGeometry()
    if (drag) workspace.updateLayout(id, { x: Math.round(drag.x), y: Math.round(drag.y), snap: null })
    else if (resize) workspace.updateLayout(id, { x: Math.round(resize.x), y: Math.round(resize.y), snap: null,
      width: Math.round(resize.width), height: Math.round(resize.height) })
    cleanupInteractionRef.current?.()
  }, [arranging, id, workspace])

  const beginInteraction = (move: (event: PointerEvent) => void, end: (event: PointerEvent) => void) => {
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      dragRef.current = null
      resizeRef.current = null
      setSnapPreview(null)
      if (cleanupInteractionRef.current === cleanup) cleanupInteractionRef.current = null
    }
    cleanupInteractionRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  /* Pointer moves write geometry straight to the node, so React can skip an unchanged
   * style write and leave that manual value on screen. Re-baseline before every commit. */
  const restoreRenderedGeometry = () => {
    const node = rootRef.current
    if (!node) return
    node.style.left = `${renderedX}px`
    node.style.top = `${renderedY}px`
    node.style.width = `${safeWidth}px`
    node.style.height = layout.minimized ? 'auto' : `${safeHeight}px`
  }

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!arranging || (event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    cleanupInteractionRef.current?.()
    workspace.bringToFront(id)
    dragRef.current = { pointerId: event.pointerId, originX: event.clientX, originY: event.clientY,
      startX: renderedX, startY: renderedY, x: renderedX, y: renderedY, snap: null }
    const move = (pointerEvent: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== pointerEvent.pointerId) return
      const candidate = snapAtPointer(pointerEvent.clientX, pointerEvent.clientY)
      const valid = candidate ? workspace.canSnap(id, candidate, safeWidth, safeHeight) : false
      drag.snap = valid ? candidate : null
      setSnapPreview(candidate ? { snap: candidate, valid } : null)
      drag.x = clamp(drag.startX + pointerEvent.clientX - drag.originX, 8, Math.max(8, window.innerWidth - safeWidth - 8))
      drag.y = clamp(drag.startY + pointerEvent.clientY - drag.originY, topSafe(), Math.max(topSafe(), window.innerHeight - safeHeight - BOTTOM_SAFE))
      if (rootRef.current) {
        rootRef.current.style.left = `${drag.x}px`
        rootRef.current.style.top = `${drag.y}px`
      }
    }
    const end = (pointerEvent: PointerEvent) => {
      const drag = dragRef.current
      if (drag?.pointerId !== pointerEvent.pointerId) return
      restoreRenderedGeometry()
      workspace.updateLayout(id, { x: Math.round(drag.x), y: Math.round(drag.y), snap: drag.snap,
        snapOrder: drag.snap ? workspace.snapOrderFor(id, drag.snap) : layout.snapOrder })
      cleanupInteractionRef.current?.()
    }
    beginInteraction(move, end)
  }

  const startResize = (event: ReactPointerEvent<HTMLDivElement>, direction: HudResizeDirection) => {
    if (layout.minimized) return
    event.preventDefault()
    event.stopPropagation()
    cleanupInteractionRef.current?.()
    workspace.bringToFront(id)
    resizeRef.current = { pointerId: event.pointerId, originX: event.clientX, originY: event.clientY,
      startX: renderedX, startY: renderedY, startWidth: safeWidth, startHeight: safeHeight,
      x: renderedX, y: renderedY, width: safeWidth, height: safeHeight }
    const west = direction.includes('w')
    const north = direction.includes('n')
    const move = (pointerEvent: PointerEvent) => {
      const resize = resizeRef.current
      if (!resize || resize.pointerId !== pointerEvent.pointerId) return
      const dx = (west ? -1 : 1) * (pointerEvent.clientX - resize.originX)
      const dy = (north ? -1 : 1) * (pointerEvent.clientY - resize.originY)
      const maxWidth = Math.max(limits.minWidth, Math.min(limits.maxWidth,
        west ? resize.startX + resize.startWidth - 8 : window.innerWidth - resize.startX - 8))
      const maxHeight = Math.max(limits.minHeight, Math.min(limits.maxHeight,
        north ? resize.startY + resize.startHeight - topSafe() : window.innerHeight - resize.startY - BOTTOM_SAFE))
      resize.width = direction === 'n' || direction === 's' ? resize.startWidth : clamp(resize.startWidth + dx, limits.minWidth, maxWidth)
      resize.height = direction === 'e' || direction === 'w' ? resize.startHeight : clamp(resize.startHeight + dy, limits.minHeight, maxHeight)
      resize.x = west ? resize.startX + resize.startWidth - resize.width : resize.startX
      resize.y = north ? resize.startY + resize.startHeight - resize.height : resize.startY
      if (rootRef.current) {
        rootRef.current.style.left = `${resize.x}px`
        rootRef.current.style.top = `${resize.y}px`
        rootRef.current.style.width = `${resize.width}px`
        rootRef.current.style.height = `${resize.height}px`
      }
    }
    const end = (pointerEvent: PointerEvent) => {
      const resize = resizeRef.current
      if (resize?.pointerId !== pointerEvent.pointerId) return
      restoreRenderedGeometry()
      workspace.updateLayout(id, { x: Math.round(resize.x), y: Math.round(resize.y), snap: null,
        width: Math.round(resize.width), height: Math.round(resize.height) })
      cleanupInteractionRef.current?.()
    }
    beginInteraction(move, end)
  }
  const close = () => {
    workspace.closePanel(id)
    onClose?.()
  }
  const style = {
    left: renderedX,
    top: renderedY,
    width: safeWidth,
    height: layout.minimized ? 'auto' : safeHeight,
    zIndex: layout.z,
  } satisfies CSSProperties

  return <>
    {dragRef.current ? <div className="pocket-snap-guides" aria-hidden="true">
      {SNAP_TARGETS.map((snap) => <span key={snap} data-snap={snap} data-active={snapPreview?.snap === snap}
        data-valid={snapPreview?.snap === snap ? snapPreview.valid : undefined} />)}
    </div> : null}
    <section ref={rootRef} className={`pocket-window pocket-drawer ${className}`} data-arranging={arranging}
      data-open={layout.open} data-minimized={layout.minimized} data-snapped={layout.snap ?? undefined}
      style={style} onPointerDown={() => workspace.bringToFront(id)}>
      <div className="pocket-window-bar" onPointerDown={startDrag}>
        <div>{eyebrow ? <small>{eyebrow}</small> : null}<strong>{title}</strong></div>
        <div className="pocket-window-actions">
          {arranging ? <button type="button" aria-label={`Reset ${title} position and size`} title="Reset this window"
            onClick={() => workspace.resetPanel(id)}>↺</button> : null}
          <button type="button" className="pocket-window-minimize" aria-label={`${layout.minimized ? 'Restore' : 'Minimize'} ${title}`}
            onClick={() => workspace.toggleMinimized(id)}>{layout.minimized ? '□' : '—'}</button>
          <button type="button" aria-label={`Close ${title}`} onClick={close}>×</button>
        </div>
      </div>
      <div className="pocket-window-content">{children}</div>
      {arranging && !layout.minimized ? RESIZE_DIRECTIONS.map((direction) =>
        <div key={direction} className="pocket-window-resize-handle" data-direction={direction} role="separator"
          aria-label={`Resize ${title} from the ${RESIZE_LABELS[direction]}`}
          aria-orientation={direction === 'n' || direction === 's' ? 'horizontal' : 'vertical'}
          onPointerDown={(event) => startResize(event, direction)} />) : null}
    </section>
  </>
}
