import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

export type HudPanelId = 'guide' | 'water' | 'store' | 'care' | 'view' | 'progress' | `metric:${string}`

export interface HudWindowLayout {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly open: boolean
  readonly minimized: boolean
  readonly z: number
}

const HUD_LAYOUT_KEY = 'pocket-aquarium-hud-layout-v1'
const DESKTOP_QUERY = '(min-width: 861px)'

function defaultLayout(id: HudPanelId): HudWindowLayout {
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  switch (id) {
    case 'guide': return { x: 24, y: 116, width: 310, height: 186, open: true, minimized: false, z: 20 }
    case 'water': return { x: 24, y: 170, width: 350, height: 520, open: false, minimized: false, z: 21 }
    case 'store': return { x: Math.max(24, viewportWidth - 430), y: 116, width: 400, height: 570, open: false, minimized: false, z: 22 }
    case 'care': return { x: Math.max(24, viewportWidth - 420), y: 140, width: 390, height: 430, open: false, minimized: false, z: 23 }
    case 'view': return { x: Math.max(24, viewportWidth - 330), y: 150, width: 300, height: 320, open: false, minimized: false, z: 24 }
    case 'progress': return { x: 24, y: 330, width: 340, height: 390, open: false, minimized: false, z: 25 }
    default: {
      const index = Math.abs(id.split('').reduce((value, character) => value + character.charCodeAt(0), 0)) % 5
      return { x: 28 + index * 44, y: 320 + index * 38, width: 220, height: 132, open: true, minimized: false, z: 30 + index }
    }
  }
}

function readLayouts(): Record<string, HudWindowLayout> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HUD_LAYOUT_KEY) ?? '{}') as Record<string, Partial<HudWindowLayout>>
    return Object.fromEntries(Object.entries(parsed).map(([id, layout]) => [id, { ...defaultLayout(id as HudPanelId), ...layout }]))
  } catch {
    return {}
  }
}

export interface HudWorkspaceController {
  readonly isDesktop: boolean
  readonly mobileSheet: HudPanelId | null
  readonly layoutFor: (id: HudPanelId) => HudWindowLayout
  readonly isOpen: (id: HudPanelId) => boolean
  readonly openPanel: (id: HudPanelId) => void
  readonly togglePanel: (id: HudPanelId) => void
  readonly closePanel: (id: HudPanelId) => void
  readonly toggleMinimized: (id: HudPanelId) => void
  readonly resetWorkspace: () => void
  readonly bringToFront: (id: HudPanelId) => void
  readonly updateLayout: (id: HudPanelId, patch: Partial<HudWindowLayout>) => void
}

export function useHudWorkspace(): HudWorkspaceController {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches)
  const [mobileSheet, setMobileSheet] = useState<HudPanelId | null>(null)
  const [layouts, setLayouts] = useState<Record<string, HudWindowLayout>>(readLayouts)
  const layoutsRef = useRef(layouts)
  layoutsRef.current = layouts

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY)
    const update = () => setIsDesktop(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem(HUD_LAYOUT_KEY, JSON.stringify(layouts)) } catch { /* UI layout persistence is optional */ }
    }, 140)
    return () => window.clearTimeout(timer)
  }, [layouts])

  const layoutFor = useCallback((id: HudPanelId) => layoutsRef.current[id] ?? defaultLayout(id), [])
  const updateLayout = useCallback((id: HudPanelId, patch: Partial<HudWindowLayout>) => {
    setLayouts((current) => ({ ...current, [id]: { ...(current[id] ?? defaultLayout(id)), ...patch } }))
  }, [])
  const bringToFront = useCallback((id: HudPanelId) => {
    setLayouts((current) => {
      const nextZ = Math.max(30, ...Object.values(current).map((layout) => layout.z)) + 1
      return { ...current, [id]: { ...(current[id] ?? defaultLayout(id)), z: nextZ } }
    })
  }, [])
  const openPanel = useCallback((id: HudPanelId) => {
    if (!window.matchMedia(DESKTOP_QUERY).matches) {
      setMobileSheet(id)
      return
    }
    setLayouts((current) => {
      const nextZ = Math.max(30, ...Object.values(current).map((layout) => layout.z)) + 1
      return { ...current, [id]: { ...(current[id] ?? defaultLayout(id)), open: true, minimized: false, z: nextZ } }
    })
  }, [])
  const closePanel = useCallback((id: HudPanelId) => {
    if (!window.matchMedia(DESKTOP_QUERY).matches) setMobileSheet((current) => current === id ? null : current)
    else updateLayout(id, { open: false })
  }, [updateLayout])
  const togglePanel = useCallback((id: HudPanelId) => {
    if (!window.matchMedia(DESKTOP_QUERY).matches) {
      setMobileSheet((current) => current === id ? null : id)
      return
    }
    const current = layoutsRef.current[id] ?? defaultLayout(id)
    if (current.open && !current.minimized) updateLayout(id, { open: false })
    else openPanel(id)
  }, [openPanel, updateLayout])
  const toggleMinimized = useCallback((id: HudPanelId) => {
    const current = layoutFor(id)
    updateLayout(id, { minimized: !current.minimized, open: true })
  }, [layoutFor, updateLayout])
  const isOpen = useCallback((id: HudPanelId) => isDesktop ? layoutFor(id).open : mobileSheet === id, [isDesktop, layoutFor, mobileSheet])
  const resetWorkspace = useCallback(() => {
    setLayouts({})
    setMobileSheet(null)
  }, [])

  return useMemo(() => ({ isDesktop, mobileSheet, layoutFor, isOpen, openPanel, togglePanel, closePanel, toggleMinimized, resetWorkspace, bringToFront, updateLayout }),
    [bringToFront, closePanel, isDesktop, isOpen, layoutFor, mobileSheet, openPanel, resetWorkspace, toggleMinimized, togglePanel, updateLayout])
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
  const rootRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ pointerId: number; originX: number; originY: number; startX: number; startY: number; x: number; y: number } | null>(null)

  useEffect(() => {
    const node = rootRef.current
    if (!node || !workspace.isDesktop || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || dragRef.current) return
      const current = workspace.layoutFor(id)
      if (!current.open || current.minimized) return
      const width = Math.round(node.offsetWidth)
      const height = Math.round(node.offsetHeight)
      if (Math.abs(width - current.width) > 2 || Math.abs(height - current.height) > 2) workspace.updateLayout(id, { width, height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [id, workspace])

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!workspace.isDesktop || (event.target as HTMLElement).closest('button')) return
    workspace.bringToFront(id)
    dragRef.current = { pointerId: event.pointerId, originX: event.clientX, originY: event.clientY, startX: layout.x, startY: layout.y, x: layout.x, y: layout.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const maxX = Math.max(8, window.innerWidth - Math.min(layout.width, window.innerWidth) - 8)
    const maxY = Math.max(76, window.innerHeight - 54)
    drag.x = Math.min(maxX, Math.max(8, drag.startX + event.clientX - drag.originX))
    drag.y = Math.min(maxY, Math.max(76, drag.startY + event.clientY - drag.originY))
    if (rootRef.current) {
      rootRef.current.style.left = `${drag.x}px`
      rootRef.current.style.top = `${drag.y}px`
    }
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag?.pointerId === event.pointerId) {
      dragRef.current = null
      workspace.updateLayout(id, { x: drag.x, y: drag.y })
    }
  }
  const close = () => {
    workspace.closePanel(id)
    onClose?.()
  }
  const safeWidth = Math.min(layout.width, Math.max(220, window.innerWidth - 16))
  const safeHeight = Math.min(layout.height, Math.max(116, window.innerHeight - 84))
  const style = workspace.isDesktop ? {
    left: Math.min(layout.x, Math.max(8, window.innerWidth - safeWidth - 8)),
    top: Math.min(layout.y, Math.max(76, window.innerHeight - 54)),
    width: safeWidth,
    height: layout.minimized ? 'auto' : safeHeight,
    zIndex: layout.z,
  } satisfies CSSProperties : undefined

  return <section ref={rootRef} className={`pocket-window pocket-drawer ${className}`}
    data-desktop-open={layout.open} data-mobile-open={workspace.mobileSheet === id}
    data-minimized={layout.minimized} style={style} onPointerDown={() => workspace.bringToFront(id)}>
    <div className="pocket-window-bar" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <div>{eyebrow ? <small>{eyebrow}</small> : null}<strong>{title}</strong></div>
      <div className="pocket-window-actions">
        <button type="button" className="pocket-window-minimize" aria-label={`${layout.minimized ? 'Restore' : 'Minimize'} ${title}`}
          onClick={() => workspace.toggleMinimized(id)}>{layout.minimized ? '□' : '—'}</button>
        <button type="button" aria-label={`Close ${title}`} onClick={close}>×</button>
      </div>
    </div>
    <div className="pocket-window-content">{children}</div>
  </section>
}
