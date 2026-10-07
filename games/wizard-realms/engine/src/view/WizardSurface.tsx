import { useEffect, useRef, useState } from 'react'
import type { WizardViewIntent, WizardViewProjection } from './contracts'
import { WizardHud } from './WizardHud'
import { WizardScene } from './WizardScene'

export interface WizardSurfaceProps {
  projection: WizardViewProjection
  onIntent: (intent: WizardViewIntent) => void
  diagnostics?: boolean
}

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD'])

function movementVector(keys: ReadonlySet<string>): readonly [number, number] {
  const x = Number(keys.has('KeyD')) - Number(keys.has('KeyA'))
  const y = Number(keys.has('KeyW')) - Number(keys.has('KeyS'))
  const length = Math.hypot(x, y) || 1
  return [x / length, y / length]
}

const STYLES = `
.wr-surface{position:relative;width:100%;height:100%;min-height:600px;overflow:hidden;background:#14221f;color:#f5f1df;font:500 14px/1.35 system-ui,sans-serif;outline:none}.wr-scene{position:absolute;inset:0;cursor:crosshair}.wr-surface button{font:inherit}.wr-hud{position:absolute;inset:0;pointer-events:none}.wr-hud button,.wr-panel{pointer-events:auto}.wr-focus{position:absolute;left:50%;top:58%;transform:translate(-50%,-50%);padding:13px 20px;border:1px solid #f4d98588;border-radius:999px;background:#18241ee8;color:#fff3bf;box-shadow:0 8px 30px #0008;cursor:pointer}.wr-focus b{display:block}.wr-focus small{color:#b8c9bd}.wr-topbar{position:absolute;left:50%;top:16px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;min-width:300px;padding:9px 13px;border:1px solid #d5b86f55;border-radius:12px;background:#101a17dd;box-shadow:0 8px 28px #0007}.wr-topbar>div:first-child{display:flex;gap:7px;align-items:baseline}.wr-kicker,.wr-panel header small{font-size:10px;letter-spacing:.15em;color:#d9ba6a}.wr-xp{height:8px;flex:1;overflow:hidden;border-radius:9px;background:#27342d}.wr-xp span{display:block;height:100%;background:linear-gradient(90deg,#7a49bd,#d283e7)}.wr-coins{color:#f5d670}.wr-crosshair{position:absolute;left:50%;top:50%;width:22px;height:22px;transform:translate(-50%,-50%)}.wr-crosshair i{position:absolute;background:#fff8dd;box-shadow:0 0 4px #000}.wr-crosshair i:first-child{left:10px;top:2px;width:2px;height:18px}.wr-crosshair i:last-child{left:2px;top:10px;width:18px;height:2px}.wr-prompt{position:absolute;left:50%;bottom:130px;transform:translateX(-50%);display:flex;gap:11px;align-items:center;padding:9px 14px;border:1px solid #ddc88266;border-radius:10px;background:#111b18e8;color:#fff;box-shadow:0 6px 18px #0008;cursor:pointer}.wr-prompt kbd{padding:5px 8px;border:1px solid #f5dc87;border-radius:5px;background:#594923}.wr-prompt span{display:flex;flex-direction:column;text-align:left}.wr-prompt b{color:#ffe395}.wr-panel{position:absolute;width:260px;padding:12px;border:1px solid #c9ad6652;border-radius:13px;background:linear-gradient(145deg,#14201ded,#0d1513ed);box-shadow:0 10px 32px #0008;backdrop-filter:blur(8px)}.wr-panel header{display:flex;justify-content:space-between;margin-bottom:9px;color:#f5d889;font:700 13px/1.2 Georgia,serif;text-transform:uppercase;letter-spacing:.09em}.wr-backpack{left:16px;top:16px}.wr-gear{right:16px;top:16px}.wr-trade{right:16px;bottom:16px}.wr-context{left:50%;bottom:24px;transform:translateX(-50%);width:290px}.wr-list{display:grid;gap:6px;max-height:220px;overflow:auto}.wr-item{display:grid;grid-template-columns:25px 1fr auto auto auto;gap:6px;align-items:center;padding:6px;border-radius:7px;background:#27322b}.wr-item small{color:#b7c2b9}.wr-item button,.wr-context button{border:1px solid #cfb66b55;border-radius:6px;background:#374b3d;color:#f8e8b2;cursor:pointer}.wr-item button:disabled{opacity:.35}.wr-icon{color:#d28ee8}.wr-slot-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.wr-slot{min-height:45px;padding:6px;border:1px solid #81724b66;border-radius:7px;background:#1e2b25}.wr-slot small,.wr-slot b{display:block}.wr-slot small{text-transform:capitalize;color:#ad9d76}.wr-trade-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.wr-trade-grid button,.wr-empty-slot{min-height:48px;padding:6px;border:1px solid #75674466;border-radius:7px;background:#1d2a24;color:#eee;text-align:left}.wr-trade-grid b,.wr-trade-grid small,.wr-trade-grid em{display:block}.wr-trade-grid small{color:#c9bd98}.wr-trade-grid em{color:#ef9c8c;font-size:11px}.wr-empty-slot{display:grid;place-items:center;color:#85968d}.wr-context button{display:flex;justify-content:space-between;width:100%;margin-top:6px;padding:9px}.wr-context button span{color:#e2c86d}.wr-caption,.wr-empty{margin:4px 0;color:#9fb0a7;font-size:12px}.wr-events{position:absolute;left:17px;bottom:18px;width:340px;text-shadow:0 2px 4px #000}.wr-events p{margin:3px 0;color:#e8eadf}.wr-diagnostics{position:absolute;left:50%;top:69px;transform:translateX(-50%);padding:4px 8px;border-radius:5px;background:#101814aa;color:#b6c8bf;font:11px monospace}.wr-touch{display:none}.wr-focus-note{position:absolute;right:20px;top:300px;padding:7px 10px;border-radius:7px;background:#111b18bb;color:#c9d6cf;font-size:12px}
@media(max-width:719px){.wr-surface{min-height:480px}.wr-backpack{left:8px;top:64px;width:210px}.wr-gear,.wr-trade{display:none}.wr-events{left:10px;bottom:152px;width:70%;font-size:12px}.wr-context{bottom:150px;width:min(280px,78vw)}.wr-prompt{bottom:148px}.wr-touch{display:flex;position:absolute;inset:auto 14px 14px;justify-content:space-between;align-items:end;pointer-events:none}.wr-touch button{pointer-events:auto;width:58px;height:58px;border:1px solid #ffe39577;border-radius:17px;background:#17231ed9;color:#fff;font-size:24px;touch-action:none}.wr-dpad{display:grid;grid-template-columns:repeat(3,58px);grid-template-rows:repeat(2,58px);gap:5px}.wr-dpad button:nth-child(1){grid-column:2}.wr-dpad button:nth-child(2){grid-column:1}.wr-dpad button:nth-child(3){grid-column:2}.wr-dpad button:nth-child(4){grid-column:3}.wr-touch .wr-touch-action{width:86px;height:86px;border-radius:50%;font-size:14px;background:#6c3e7ee8}.wr-focus-note{display:none}.wr-topbar{top:8px;min-width:min(300px,85vw)}}
`

export function WizardSurface({ projection, onIntent, diagnostics = false }: WizardSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const pressedKeys = useRef(new Set<string>())
  const [engaged, setEngaged] = useState(false)
  const [pointerLocked, setPointerLocked] = useState(false)

  useEffect(() => {
    const onPointerLockChange = () => {
      const locked = document.pointerLockElement?.closest('.wr-surface') === rootRef.current
      setPointerLocked(locked)
      if (!locked) {
        pressedKeys.current.clear()
        setEngaged(false)
        onIntent({ type: 'movement', vector: [0, 0] })
      }
    }
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement && rootRef.current?.contains(document.pointerLockElement)) {
        onIntent({ type: 'look', delta: [event.movementX * 0.0024, event.movementY * 0.0024] })
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        pressedKeys.current.clear()
        onIntent({ type: 'movement', vector: [0, 0] })
        setEngaged(false)
        document.exitPointerLock?.()
        return
      }
      if (!engaged || event.repeat || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName)) return
      if (event.code === 'KeyE') onIntent({ type: 'interact' })
      if (MOVEMENT_KEYS.has(event.code)) {
        event.preventDefault()
        pressedKeys.current.add(event.code)
        onIntent({ type: 'movement', vector: movementVector(pressedKeys.current) })
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!MOVEMENT_KEYS.has(event.code) || !pressedKeys.current.delete(event.code)) return
      onIntent({ type: 'movement', vector: movementVector(pressedKeys.current) })
    }
    document.addEventListener('pointerlockchange', onPointerLockChange)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [engaged, onIntent])

  const focusWorld = () => {
    setEngaged(true)
    rootRef.current?.focus()
    rootRef.current?.querySelector('canvas')?.requestPointerLock?.()
  }

  return (
    <div className="wr-surface" ref={rootRef} tabIndex={0} aria-label="Wizard Realms first-person world">
      <style>{STYLES}</style>
      <div className="wr-scene" onClick={focusWorld}><WizardScene projection={projection} /></div>
      <WizardHud projection={projection} onIntent={onIntent} diagnostics={diagnostics} />
      {!engaged && <button className="wr-focus" onClick={focusWorld}><b>Enter the realm</b><small>Click to focus · Esc releases the cursor</small></button>}
      {pointerLocked && <div className="wr-focus-note">WASD move · mouse look · E interact · Esc release</div>}
    </div>
  )
}
