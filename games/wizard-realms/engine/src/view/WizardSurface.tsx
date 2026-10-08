import { useEffect, useRef, useState } from 'react'
import type { WizardViewIntent, WizardViewProjection } from './contracts'
import { WizardHud } from './WizardHud'
import { WizardMap, mapToggleForKey } from './WizardMap'
import { WizardScene } from './WizardScene'

export interface WizardSurfaceProps {
  projection: WizardViewProjection
  onIntent: (intent: WizardViewIntent) => void
  diagnostics?: boolean
}

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD'])
export const CENTERED_CAMERA_ORBIT = [0, 0.28] as const
export const keyboardEventTime = (eventTimeMs: number, nowMs: number) =>
  Number.isFinite(eventTimeMs) && Math.abs(eventTimeMs - nowMs) <= 60_000 ? eventTimeMs : nowMs

export function movementVector(keys: ReadonlySet<string>): readonly [number, number] {
  const x = Number(keys.has('KeyD')) - Number(keys.has('KeyA'))
  const y = Number(keys.has('KeyW')) - Number(keys.has('KeyS'))
  return [x, y]
}

/** A newly pressed pivot gets one fixed-step turn even when released between simulation ticks. */
export function keyboardMovementIntents(keys: Set<string>, code: string, pressed: boolean, atMs?: number): WizardViewIntent[] {
  if (!MOVEMENT_KEYS.has(code)) return []
  const timestamp = atMs === undefined ? {} : { atMs }
  if (pressed) {
    if (keys.has(code)) return []
    keys.add(code)
    const tap: WizardViewIntent[] = code === 'KeyA' || code === 'KeyD'
      ? [{ type: 'movement.tap', vector: [code === 'KeyA' ? -1 : 1, 0], source: 'keyboard', ...timestamp }] : []
    return [...tap, { type: 'movement', vector: movementVector(keys), ...timestamp }]
  }
  if (!keys.delete(code)) return []
  return [{ type: 'movement', vector: movementVector(keys), ...timestamp }]
}

export function releaseHeldControls(keys: Set<string>): readonly [0, 0] {
  keys.clear()
  return [0, 0]
}

export function cameraOrbitFromDrag(current: readonly [number, number], delta: readonly [number, number]): readonly [number, number] {
  return [current[0] - delta[0] * 0.004, Math.max(0.08, Math.min(0.72, current[1] + delta[1] * 0.003))]
}

const STYLES = `
.wr-surface{position:relative;width:100%;height:100%;min-height:600px;overflow:hidden;background:#14221f;color:#f5f1df;font:500 14px/1.35 system-ui,sans-serif;outline:none}.wr-scene{position:absolute;inset:0;cursor:grab}.wr-scene[data-dragging="true"]{cursor:grabbing}.wr-surface button{font:inherit}.wr-hud{position:absolute;inset:0;pointer-events:none}.wr-hud button,.wr-panel{pointer-events:auto}.wr-topbar{position:absolute;left:50%;top:16px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;min-width:300px;padding:9px 13px;border:1px solid #d5b86f55;border-radius:12px;background:#101a17dd;box-shadow:0 8px 28px #0007}.wr-topbar>div:first-child{display:flex;gap:7px;align-items:baseline}.wr-kicker,.wr-panel header small{font-size:10px;letter-spacing:.15em;color:#d9ba6a}.wr-xp{height:8px;flex:1;overflow:hidden;border-radius:9px;background:#27342d}.wr-xp span{display:block;height:100%;background:linear-gradient(90deg,#7a49bd,#d283e7)}.wr-coins{color:#f5d670}.wr-prompt{position:absolute;left:50%;bottom:130px;transform:translateX(-50%);display:flex;gap:11px;align-items:center;padding:9px 14px;border:1px solid #ddc88266;border-radius:10px;background:#111b18e8;color:#fff;box-shadow:0 6px 18px #0008}.wr-prompt[data-actionable="true"]{cursor:pointer}.wr-prompt kbd{padding:5px 8px;border:1px solid #f5dc87;border-radius:5px;background:#594923}.wr-prompt span{display:flex;flex-direction:column;text-align:left}.wr-prompt b{color:#ffe395}.wr-panel{position:absolute;width:260px;padding:12px;border:1px solid #c9ad6652;border-radius:13px;background:linear-gradient(145deg,#14201ded,#0d1513ed);box-shadow:0 10px 32px #0008;backdrop-filter:blur(8px)}.wr-panel header{display:flex;justify-content:space-between;margin-bottom:9px;color:#f5d889;font:700 13px/1.2 Georgia,serif;text-transform:uppercase;letter-spacing:.09em}.wr-backpack{left:16px;top:16px}.wr-gear{right:16px;top:16px}.wr-trade{right:16px;bottom:16px}.wr-context{left:50%;bottom:24px;transform:translateX(-50%);width:290px}.wr-list{display:grid;gap:6px;max-height:220px;overflow:auto}.wr-item{display:grid;grid-template-columns:25px 1fr auto auto auto;gap:6px;align-items:center;padding:6px;border-radius:7px;background:#27322b}.wr-item small{color:#b7c2b9}.wr-item button,.wr-context button{border:1px solid #cfb66b55;border-radius:6px;background:#374b3d;color:#f8e8b2;cursor:pointer}.wr-item button:disabled{opacity:.35}.wr-icon{color:#d28ee8}.wr-slot-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.wr-slot{min-height:45px;padding:6px;border:1px solid #81724b66;border-radius:7px;background:#1e2b25}.wr-slot small,.wr-slot b{display:block}.wr-slot small{text-transform:capitalize;color:#ad9d76}.wr-trade-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.wr-trade-grid button,.wr-empty-slot{min-height:48px;padding:6px;border:1px solid #75674466;border-radius:7px;background:#1d2a24;color:#eee;text-align:left}.wr-trade-grid b,.wr-trade-grid small,.wr-trade-grid em{display:block}.wr-trade-grid small{color:#c9bd98}.wr-trade-grid em{color:#ef9c8c;font-size:11px}.wr-empty-slot{display:grid;place-items:center;color:#85968d}.wr-context button{display:flex;justify-content:space-between;width:100%;margin-top:6px;padding:9px}.wr-context button span{color:#e2c86d}.wr-caption,.wr-empty{margin:4px 0;color:#9fb0a7;font-size:12px}.wr-events{position:absolute;left:17px;bottom:18px;width:340px;text-shadow:0 2px 4px #000}.wr-events p{margin:3px 0;color:#e8eadf}.wr-diagnostics{position:absolute;left:50%;top:69px;transform:translateX(-50%);padding:4px 8px;border-radius:5px;background:#101814aa;color:#b6c8bf;font:11px monospace}.wr-touch{display:none}.wr-focus-note{position:absolute;right:20px;top:300px;padding:7px 10px;border-radius:7px;background:#111b18bb;color:#c9d6cf;font-size:12px}.wr-map-toggle{position:absolute;left:16px;top:286px;z-index:5;display:grid;gap:6px;width:132px;min-height:44px;padding:6px 10px;border:1px solid #d5b86f66;border-radius:9px;background:#101a17e8;color:#fff;text-align:left;cursor:pointer}.wr-map-toggle-label{display:flex;justify-content:space-between;align-items:center;min-height:30px}.wr-map-toggle small{color:#f5d670}.wr-map-toggle:focus-visible,.wr-map-dialog header button:focus-visible{outline:3px solid #ffe395;outline-offset:2px}.wr-map-compact{display:block;pointer-events:none}.wr-map-grid{display:grid;gap:2px;aspect-ratio:1}.wr-map-tile{display:grid;place-items:center;min-width:0;border:1px solid #ffffff1b;color:#fff;font-size:10px}.wr-map-tile[data-discovered="false"]{border-style:dashed}.wr-map-tile b{display:block}.wr-map-backdrop{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:#07100dcc}.wr-map-dialog{position:relative;box-sizing:border-box;width:min(560px,88vw);max-height:calc(100% - 24px);padding:18px;overflow-y:auto;overscroll-behavior:contain;border:1px solid #d5b86f88;border-radius:16px;background:#0e1715f5;box-shadow:0 20px 80px #000b}.wr-map-dialog header{display:flex;justify-content:space-between;align-items:start}.wr-map-dialog h2{margin:3px 0 14px;font:700 25px Georgia,serif;color:#f5d889}.wr-map-dialog header small{letter-spacing:.14em;color:#ab9d76}.wr-map-dialog header button{width:44px;height:44px;border:1px solid #d5b86f66;border-radius:9px;background:#27342d;color:#fff;font-size:24px}.wr-map-dialog .wr-map-grid{width:min(60vh,100%);margin:auto}.wr-map-routes{display:grid;gap:4px;margin-top:12px}.wr-map-routes div{display:flex;justify-content:space-between;padding:6px 8px;border-radius:6px;background:#1d2a24}.wr-map-dialog>p{margin:10px 0 0;color:#b7c2b9;font-size:12px}
.wr-context{bottom:60px}.wr-hud:has(.wr-context) .wr-prompt[data-actionable="false"]{display:none}.wr-backpack .wr-item{grid-template-columns:25px minmax(0,1fr) auto}.wr-backpack .wr-item button:first-of-type{grid-column:2}
.wr-map-camp-window{position:relative;display:block;max-height:min(52vh,480px);overflow:auto;overscroll-behavior:contain}.wr-map-grid button.wr-map-tile{padding:0;cursor:pointer;font-size:10px;border-radius:0;touch-action:manipulation}.wr-map-grid button.wr-map-tile:focus-visible{position:relative;z-index:1;outline:3px solid #ffe395;outline-offset:0}.wr-map-grid button.wr-map-tile[aria-pressed="true"]{box-shadow:inset 0 0 0 2px #ffe395}
.wr-map-routes section{padding:6px 8px;border-radius:7px;background:#1d2a24}.wr-map-routes h3{display:flex;justify-content:space-between;gap:8px;margin:0 0 4px;color:#f5d889;font-size:13px}.wr-map-routes h3 small{color:#c9bd98;font-weight:500}.wr-map-site{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;min-height:44px;margin-top:5px;padding:7px 9px;border:1px solid #d5b86f66;border-radius:7px;background:#293c32;color:#f7ecd0;text-align:left;cursor:pointer}.wr-map-site small{color:#d4c590}.wr-map-site[aria-pressed="true"]{outline:2px solid #ffe395;outline-offset:1px}.wr-build-preview{bottom:210px}.wr-build-preview .wr-build-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.wr-build-preview .wr-build-actions button{min-height:44px;justify-content:center}.wr-build-preview .wr-build-actions button:disabled{opacity:.45;cursor:not-allowed}
@media(max-width:719px),(min-width:720px) and (max-width:900px) and (max-height:590px){.wr-surface{min-height:480px}.wr-backpack{box-sizing:border-box;left:8px;top:64px;width:220px}.wr-gear,.wr-trade,.wr-diagnostics{display:none}.wr-events{left:10px;top:205px;bottom:auto;width:calc(100% - 20px);max-height:80px;overflow-y:auto;font-size:12px}.wr-context{bottom:150px;width:min(280px,78vw)}.wr-build-preview{bottom:230px}.wr-prompt{bottom:148px}.wr-touch{display:flex;position:absolute;inset:auto 14px 14px;justify-content:space-between;align-items:end;pointer-events:none}.wr-touch button{pointer-events:auto;width:58px;height:58px;border:1px solid #ffe39577;border-radius:17px;background:#17231ed9;color:#fff;font-size:24px;touch-action:none}.wr-dpad{display:grid;grid-template-columns:repeat(3,58px);grid-template-rows:repeat(2,58px);gap:5px}.wr-dpad button:nth-child(1){grid-column:2}.wr-dpad button:nth-child(2){grid-column:1}.wr-dpad button:nth-child(3){grid-column:2}.wr-dpad button:nth-child(4){grid-column:3}.wr-touch-actions{display:grid;gap:6px}.wr-touch .wr-touch-action{width:72px;height:54px;border-radius:18px;font-size:13px;background:#6c3e7ee8}.wr-focus-note{display:none}.wr-topbar{top:8px;min-width:min(300px,85vw)}.wr-map-toggle{left:auto;right:8px;top:64px;display:flex;justify-content:center;width:auto;min-width:44px;min-height:44px;padding:0 10px}.wr-map-toggle small,.wr-map-compact{display:none}.wr-map-backdrop{display:block}.wr-map-dialog{position:absolute;inset:0;width:auto;max-height:none;border:0;border-radius:0;padding:calc(14px + env(safe-area-inset-top,0px)) calc(14px + env(safe-area-inset-right,0px)) calc(14px + env(safe-area-inset-bottom,0px)) calc(14px + env(safe-area-inset-left,0px))}.wr-map-dialog .wr-map-grid{width:min(75vh,100%)} }
@media(min-width:720px) and (max-width:900px) and (max-height:590px){.wr-surface{min-height:100%}.wr-backpack,.wr-events{display:none}}
.wr-backpack-toggle{display:none}
@media(max-width:719px){.wr-backpack{display:none}.wr-backpack-toggle{position:absolute;z-index:7;left:8px;top:64px;display:block;min-width:88px;min-height:44px;padding:6px 10px;border:1px solid #d5b86f66;border-radius:9px;background:#101a17e8;color:#fff;cursor:pointer}.wr-surface[data-backpack-open="true"] .wr-backpack{display:block;top:114px;max-height:calc(100% - 130px);overflow-y:auto;z-index:6}}
@media(max-width:719px){.wr-backpack-toggle{top:120px}.wr-map-toggle{left:106px;right:auto;top:120px}.wr-surface[data-backpack-open="true"] .wr-backpack{top:170px;max-height:calc(100% - 185px)}.wr-prompt{left:8px;top:176px;bottom:auto;transform:none;box-sizing:border-box;width:180px;max-width:calc(100% - 16px);padding:6px 8px;font-size:12px}.wr-surface[data-backpack-open="true"] .wr-prompt{display:none}}
@media(max-width:719px){.wr-events{top:252px;left:8px;max-height:48px;overflow:hidden;pointer-events:none}.wr-events p:not(:last-child){display:none}}
@media(max-width:719px) and (max-height:400px){.wr-prompt{top:164px}.wr-events{display:none}}
@media(max-width:719px) and (max-height:400px){.wr-surface{min-height:100%}.wr-touch-actions{grid-template-columns:repeat(2,72px);grid-template-rows:repeat(2,54px)}}
@media(max-width:419px) and (max-height:400px){.wr-dpad{grid-template-columns:repeat(3,48px);grid-template-rows:repeat(2,48px)}.wr-dpad button{width:48px;height:48px}.wr-touch-actions{grid-template-columns:repeat(2,62px);grid-template-rows:repeat(2,48px)}.wr-touch .wr-touch-action{width:62px;height:48px}}
@media(max-width:719px){.wr-surface .wr-context[data-store-panel]{bottom:14px;max-height:calc(100% - 78px)}.wr-surface:has([data-store-panel]) .wr-touch,.wr-surface:has([data-store-panel]) .wr-map-toggle,.wr-surface:has([data-store-panel]) .wr-backpack-toggle,.wr-surface:has([data-store-panel]) .wr-events{display:none}}
@media(max-width:719px){.wr-surface .wr-context:has(> header[data-ring-panel]){left:8px;transform:none;box-sizing:border-box;width:min(270px,calc(100% - 108px));bottom:150px;max-height:calc(100% - 215px);overflow-y:auto}.wr-surface:has([data-ring-panel]) .wr-events{display:none}}
@media(min-width:720px) and (max-width:900px) and (max-height:590px){.wr-backpack-toggle{position:absolute;z-index:7;left:8px;top:64px;display:block;min-width:88px;min-height:44px;padding:6px 10px;border:1px solid #d5b86f66;border-radius:9px;background:#101a17e8;color:#fff;cursor:pointer}.wr-surface[data-backpack-open="true"] .wr-backpack{display:block;top:114px;max-height:calc(100vh - 235px);overflow-y:auto;z-index:6}}
@media(max-height:599px){.wr-map-backdrop{position:fixed}}
@media(max-height:599px){.wr-context:not(.wr-build-preview){box-sizing:border-box;max-height:calc(100% - 215px);overflow-y:auto;overscroll-behavior:contain}}
@media(max-width:719px) and (max-height:400px){.wr-surface .wr-context.wr-build-preview{left:50%;top:54px;bottom:auto;transform:translateX(-50%);box-sizing:border-box;width:min(280px,72vw);max-height:145px;overflow-y:auto;z-index:8}}
@media(min-width:720px) and (min-height:591px){.wr-backpack{box-sizing:border-box;max-height:calc(100% - 230px);overflow-y:auto}.wr-map-toggle{top:auto;bottom:16px}.wr-events{left:186px}}
@media(min-width:901px) and (max-height:590px){.wr-surface{min-height:100%}.wr-map-toggle{left:316px;top:64px;display:flex;justify-content:center;width:auto;min-width:44px;min-height:44px;padding:0 10px}.wr-map-toggle small,.wr-map-compact{display:none}}
@media(max-width:719px){.wr-surface:has([data-field-camp-panel]) .wr-prompt,.wr-surface:has([data-field-camp-panel]) .wr-events{display:none}}
@media(max-width:719px) and (min-height:401px) and (max-height:599px){.wr-surface .wr-context[data-field-camp-panel]{left:8px;top:208px;bottom:auto;transform:none;box-sizing:border-box;width:min(280px,calc(100% - 108px));max-height:calc(100% - 350px);overflow-y:auto;overscroll-behavior:contain;padding:8px;font-size:12px}.wr-surface .wr-context[data-field-camp-panel] header{margin-bottom:5px}}
`

export function WizardSurface({ projection, onIntent, diagnostics = false }: WizardSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const pressedKeys = useRef(new Set<string>())
  const lastDragPoint = useRef<readonly [number, number] | null>(null)
  const [dragging, setDragging] = useState(false)
  const [cameraOrbit, setCameraOrbit] = useState<readonly [number, number]>(CENTERED_CAMERA_ORBIT)
  const [mapOpen, setMapOpen] = useState(false)
  const [backpackOpen, setBackpackOpen] = useState(false)
  const mapButtonRef = useRef<HTMLButtonElement>(null)
  const mapCloseRef = useRef<HTMLButtonElement>(null)

  const toggleMap = () => {
    const next = !mapOpen
    if (next) {
      setBackpackOpen(false)
      onIntent({ type: 'movement', vector: releaseHeldControls(pressedKeys.current) })
      setDragging(false)
      lastDragPoint.current = null
      setCameraOrbit(CENTERED_CAMERA_ORBIT)
      window.requestAnimationFrame(() => mapCloseRef.current?.focus())
    } else window.requestAnimationFrame(() => mapButtonRef.current?.focus())
    setMapOpen(next)
  }

  useEffect(() => {
    const clearControls = () => {
      onIntent({ type: 'movement', vector: releaseHeldControls(pressedKeys.current) })
      setDragging(false)
      lastDragPoint.current = null
      setCameraOrbit(CENTERED_CAMERA_ORBIT)
    }
    const onVisibilityChange = () => { if (document.visibilityState !== 'visible') clearControls() }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        clearControls()
        if (mapOpen) toggleMap()
        else setBackpackOpen(false)
        return
      }
      if (event.repeat || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName)) return
      if (event.code === 'KeyM') {
        event.preventDefault()
        if (mapToggleForKey(mapOpen, event.code, event.repeat) !== mapOpen) toggleMap()
        return
      }
      if (mapOpen) return
      if (event.code === 'KeyE') onIntent({ type: 'interact' })
      if (event.code === 'Space') {
        event.preventDefault()
        onIntent({ type: 'jump' })
      }
      if (MOVEMENT_KEYS.has(event.code)) {
        event.preventDefault()
        for (const intent of keyboardMovementIntents(pressedKeys.current, event.code, true,
          keyboardEventTime(event.timeStamp, performance.now()))) onIntent(intent)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      for (const intent of keyboardMovementIntents(pressedKeys.current, event.code, false,
        keyboardEventTime(event.timeStamp, performance.now()))) onIntent(intent)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('blur', clearControls)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('blur', clearControls)
    }
  }, [mapOpen, onIntent])

  return (
    <div className="wr-surface" ref={rootRef} tabIndex={0} aria-label="Wizard Realms third-person world" data-backpack-open={backpackOpen}>
      <style>{STYLES}</style>
      <div className="wr-scene" data-dragging={dragging}
        onPointerDown={(event) => { rootRef.current?.focus(); event.currentTarget.setPointerCapture(event.pointerId); lastDragPoint.current = [event.clientX, event.clientY]; setDragging(true) }}
        onPointerMove={(event) => {
          const previous = lastDragPoint.current
          if (!previous) return
          const next = [event.clientX, event.clientY] as const
          lastDragPoint.current = next
          setCameraOrbit((current) => cameraOrbitFromDrag(current, [next[0] - previous[0], next[1] - previous[1]]))
        }}
        onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); lastDragPoint.current = null; setDragging(false) }}
        onPointerCancel={() => { lastDragPoint.current = null; setDragging(false) }}>
        <WizardScene projection={projection} cameraOrbit={cameraOrbit} orbiting={dragging} />
      </div>
      <WizardHud projection={projection} onIntent={onIntent} diagnostics={diagnostics} />
      {!projection.openStoreId && <button className="wr-backpack-toggle" type="button" aria-controls="wizard-backpack" aria-expanded={backpackOpen} onClick={() => setBackpackOpen((open) => !open)}>Backpack</button>}
      <WizardMap projection={projection} open={mapOpen} onToggle={toggleMap} onIntent={onIntent} buttonRef={mapButtonRef} closeRef={mapCloseRef} />
      <div className="wr-focus-note">W/S move · A/D pivot · Space jump · hold and drag to orbit · E interact · M map</div>
    </div>
  )
}
