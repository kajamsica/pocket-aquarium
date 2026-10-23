import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { WizardViewIntent, WizardViewProjection } from './contracts'
import { WizardHud } from './WizardHud'
import { WizardMap, mapToggleForKey } from './WizardMap'
import { WizardScene, sceneTerrainFor, sceneTerrainPickKind, v26TargetedTerrainCell, type SceneGroundPicker, type SceneTerrainPicker, type SceneWorkAimKind, type SceneWorkAimPicker, type V9WorkActionCue } from './WizardScene'
import type { PublicV17InputTrace } from '../PublicV17InputScheduler'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from '../domain/worldChunks'

export interface WizardSurfaceProps {
  projection: WizardViewProjection
  onIntent: (intent: WizardViewIntent) => void
  diagnostics?: boolean
  inputTrace?: PublicV17InputTrace | null
  saveInProgress?: boolean
  workActionCue?: V9WorkActionCue | null
  greenwayLogOrder?: ReactNode
  starterChapterActors?: boolean
  starterChapterPrimary?: boolean
  soilPlaceRejection?: string | null
}

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD'])
const TRACE_KEYS = new Set([...MOVEMENT_KEYS, 'KeyM', 'KeyR', 'KeyE', 'KeyB', 'KeyF',
  'Digit1', 'Digit2', 'Digit3', 'Space', 'Escape'])
const RESERVED_SHORTCUTS = new Set([...TRACE_KEYS, 'Tab', 'Enter'])
const KEYBIND_STORAGE_KEY = 'wizard-realms:keybinds:v1'
export const DEFAULT_ACTION_KEYS = { dig: 'KeyG', switchTool: 'KeyQ' } as const
export type ActionKeys = { dig: string; switchTool: string }
export type ActionKey = keyof ActionKeys
export function bindableActionCode(code: string, other: string): boolean {
  return /^(Key[A-Z]|Digit[0-9])$/.test(code) && !RESERVED_SHORTCUTS.has(code)
    && code !== other
}
export function parseActionKeys(raw: string | null): ActionKeys {
  if (!raw) return { ...DEFAULT_ACTION_KEYS }
  try {
    const value = JSON.parse(raw) as Partial<ActionKeys> & { version?: number }
    if (value.version === 1 && typeof value.dig === 'string'
      && typeof value.switchTool === 'string'
      && bindableActionCode(value.dig, value.switchTool)
      && bindableActionCode(value.switchTool, value.dig)) return { dig: value.dig, switchTool: value.switchTool }
  } catch { /* Invalid or older client preference. */ }
  return { ...DEFAULT_ACTION_KEYS }
}
export function keybindCaptureVisible(projection: WizardViewProjection, mapOpen: boolean,
  detailsOpen: boolean): boolean {
  return detailsOpen && projection.v26ValleyRimSegments !== undefined && !mapOpen
    && !projection.openStoreId && !projection.savedTerrainWorks?.modeActive
}
const actionKeyLabel = (code: string) => code.replace(/^(Key|Digit)/, '')
const ORBIT_DRAG_THRESHOLD_PX = 6
export const CENTERED_CAMERA_ORBIT = [0, 0.28] as const
const KEYBOARD_TERRAIN_AIM_Y = 0.62
const keyboardTerrainAimX = (width: number) => width < 720 ? 0.72 : 0.38
export const keyboardEventTime = (eventTimeMs: number, nowMs: number) =>
  Number.isFinite(eventTimeMs) && Math.abs(eventTimeMs - nowMs) <= 60_000 ? eventTimeMs : nowMs

/** A visible off-avatar reticle is the keyboard fallback; mouse hover keeps priority. */
export function keyboardTerrainPointer(pointer: readonly [number, number] | null,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | null): readonly [number, number] | null {
  if (pointer) return pointer
  if (!bounds || ![bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0) return null
  return [bounds.left + bounds.width * keyboardTerrainAimX(bounds.width),
    bounds.top + bounds.height * KEYBOARD_TERRAIN_AIM_Y]
}

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

/** Works shortcuts only address the currently visible, discovered aim preview. */
export function savedWorkKeyboardIntent(code: string,
  saved: WizardViewProjection['savedTerrainWorks'], v26TerrainActive = false): WizardViewIntent | null {
  if (code === 'Escape') return saved?.modeActive
    ? { type: 'saved-work.mode', active: false } : null
  if (!saved?.actionsEnabled) return null
  if (code === 'KeyB') return { type: 'saved-work.mode', active: !saved.modeActive }
  if (!saved.modeActive) return null
  if (v26TerrainActive && (code === 'Digit3'
    || code === 'KeyF' && saved.selectedKind === 'dig')) return null
  const kind = { Digit1: 'bridge', Digit2: 'ladder', Digit3: 'dig' } as const
  if (Object.hasOwn(kind, code)) {
    const selected = kind[code as keyof typeof kind]
    return saved.context === 'starter-greenway' && selected === 'ladder'
      ? null : { type: 'saved-work.kind', kind: selected }
  }
  const aimed = saved.preview?.selected
  return code === 'KeyF' && aimed?.rejection === null
    ? { type: 'saved-work.confirm', id: aimed.site.id } : null
}

/** The top visible overlay owns Escape before underlying Works or backpack controls. */
export function escapeSurfaceTarget(mapOpen: boolean,
  projection: Pick<WizardViewProjection, 'openStoreId' | 'savedTerrainWorks' | 'v26ValleyRimSegments'>):
  'map' | WizardViewIntent | null {
  if (mapOpen) return 'map'
  if (projection.openStoreId) return { type: 'store.close' }
  return savedWorkKeyboardIntent('Escape', projection.savedTerrainWorks,
    projection.v26ValleyRimSegments !== undefined)
}

export function focusStoreOpener(root: HTMLElement | null, storeName: string | null): void {
  const opener = root && storeName ? Array.from(root.querySelectorAll<HTMLButtonElement>('button[aria-label]'))
    .find((button) => button.getAttribute('aria-label') === `Open ${storeName}`) : null
  ;(opener ?? root)?.focus({ preventScroll: true })
}

export function releaseHeldControls(keys: Set<string>): readonly [0, 0] {
  keys.clear()
  return [0, 0]
}

/** Pointer actions return to gameplay; keyboard activation keeps the control's focus. */
export function focusGameplayAfterClick(root: HTMLElement, target: Element, detail: number): void {
  if (detail > 0 && target.closest('.wr-hud button, .wr-backpack-toggle, .wr-v26-terrain button')
    && !target.closest('.wr-touch') && !target.closest('.wr-keybinds')) root.focus({ preventScroll: true })
}

export function shouldHandleGameplayKey(event: Pick<KeyboardEvent, 'code' | 'repeat' | 'target'>): boolean {
  const target = event.target as HTMLElement | null
  return !event.repeat && !/INPUT|TEXTAREA|SELECT/.test(target?.tagName ?? '')
    && !target?.isContentEditable && !(event.code === 'Space' && target?.closest?.(
      'button, summary, details, dialog, menu, a, [role="button"], [role="dialog"], [role="menu"], [role="menuitem"]'))
}

export function pointerWorkAimKind(projection: WizardViewProjection, mapOpen: boolean): SceneWorkAimKind | null {
  const saved = projection.savedTerrainWorks
  if (!mapOpen && projection.controllerActionsEnabled !== false && !projection.unavailableActions
    && saved?.context === 'v28-river' && saved.actionsEnabled && saved.modeActive
    && saved.selectedKind === 'bridge') return 'river-bridge'
  if (!mapOpen && projection.controllerActionsEnabled !== false && !projection.unavailableActions
    && saved?.context === 'works4-greenway' && saved.actionsEnabled && saved.modeActive
    && (saved.selectedKind === 'bridge' || saved.selectedKind === 'ladder')) return saved.selectedKind
  return !mapOpen && projection.controllerActionsEnabled !== false
    && saved?.context === undefined && saved?.actionsEnabled && saved.modeActive
    && saved.selectedKind === 'ladder' && projection.regionalLadders && projection.visualWorld
    ? 'regional-ladder' : null
}

export function pointerMovedBeyondOrbitThreshold(start: readonly [number, number],
  current: readonly [number, number]): boolean {
  return Math.hypot(current[0] - start[0], current[1] - start[1]) > ORBIT_DRAG_THRESHOLD_PX
}

type PointerPress = { id: number; start: readonly [number, number]; primary: boolean; dragged: boolean }
export function pointerAimTap(press: PointerPress | null, pointerId: number,
  end: readonly [number, number]): boolean {
  return !!press && press.id === pointerId && press.primary && !press.dragged
    && !pointerMovedBeyondOrbitThreshold(press.start, end)
}

export function devNavigationEnabled(search: string): boolean {
  const params = new URLSearchParams(search)
  return params.get('dev') === '1' && (params.get('publicWorld') === 'v42'
    || params.get('publicWorld') === 'v43')
}

type SceneTap = { atMs: number; point: readonly [number, number] }
export function devDoubleTap(previous: SceneTap | null, current: SceneTap): boolean {
  return !!previous && current.atMs >= previous.atMs && current.atMs - previous.atMs <= 500
    && Math.hypot(current.point[0] - previous.point[0],
      current.point[1] - previous.point[1]) <= 9
}

/** A selected terrain tool owns taps; dev double-click routing only applies with tools off. */
export function devSceneTapDecision(eligible: boolean, previous: SceneTap | null,
  current: SceneTap, terrainMode: V31TerrainMode | null): 'navigate' | 'terrain' {
  return eligible && !terrainMode && devDoubleTap(previous, current) ? 'navigate' : 'terrain'
}

/** Works and open panels keep ownership; callers arbitrate active ground tools first. */
export function pointerDevNavigateIntent(enabled: boolean, projection: WizardViewProjection,
  mapOpen: boolean, ground: ReturnType<SceneGroundPicker>): WizardViewIntent | null {
  if (!enabled || mapOpen || projection.openStoreId
    || projection.savedTerrainWorks?.modeActive || projection.controllerActionsEnabled === false
    || projection.unavailableActions
    || !ground || !Number.isFinite(ground.x) || !Number.isFinite(ground.z)) return null
  return { type: 'dev.navigate', destination: { x: ground.x, z: ground.z } }
}

export function pointerWorkAimIntent(kind: SceneWorkAimKind, aimed: number | null): WizardViewIntent | null {
  if (aimed === null || !Number.isFinite(aimed)) return null
  return kind === 'regional-ladder' ? { type: 'saved-work.aim-west', aimZ: aimed }
    : { type: 'saved-work.aim', aimX: aimed }
}

export type V26TerrainMode = 'dig' | 'fill'
export type V29TerrainMode = V26TerrainMode | 'mine'
export type V31TerrainMode = V29TerrainMode | 'place-soil'
export const V29_NO_GROUND_TARGET_HINT = 'No ground cell in reach targeted. Move within 5 m of clear, revealed dry ground, then tap or click a ground cell. An outline shows the target when available. A foreground tree or rock may block the view.'

export function terrainModeAfterSpadeChange(previouslyEquipped: boolean, equipped: boolean,
  mode: V26TerrainMode | null): V26TerrainMode | null {
  return previouslyEquipped === equipped ? mode : equipped ? 'dig' : null
}

export function pointerV26TerrainKind(projection: WizardViewProjection, mapOpen: boolean,
  mode: V26TerrainMode | null): V26TerrainMode | null {
  return mode && !mapOpen && projection.v26ValleyRimSegments !== undefined
    && projection.controllerActionsEnabled === true && !projection.unavailableActions
    && !projection.openStoreId && !projection.savedTerrainWorks?.modeActive
    && projection.equipment?.mainHand?.itemId === 'field_spade' ? mode : null
}

export function pointerV26TerrainTapIntent(projection: WizardViewProjection, mapOpen: boolean,
  mode: V26TerrainMode | null, press: PointerPress | null, pointerId: number,
  end: readonly [number, number], picker: () => ReturnType<SceneTerrainPicker>): WizardViewIntent | null {
  if (!pointerAimTap(press, pointerId, end) || pointerWorkAimKind(projection, mapOpen)) return null
  const kind = pointerV26TerrainKind(projection, mapOpen, mode)
  if (!kind) return null
  const picked = picker()
  if (!picked || ![picked.gx, picked.gz].every((value) => Number.isSafeInteger(value)
    && value >= WORLD_GRID_MIN && value <= WORLD_GRID_MAX)) return null
  return { type: 'v26.terrain', kind, gx: picked.gx, gz: picked.gz }
}

/** Keyboard Dig uses the same frontmost scene ray as pointer Dig, never an assumed avatar cell. */
export function keyboardDigIntent(projection: WizardViewProjection, mapOpen: boolean,
  pointer: readonly [number, number] | null, picker: SceneTerrainPicker | null): WizardViewIntent | null {
  if (!pointer || !picker || !pointerV26TerrainKind(projection, mapOpen, 'dig')
    || pointerWorkAimKind(projection, mapOpen)) return null
  const picked = picker(pointer[0], pointer[1], sceneTerrainPickKind(projection, 'dig'))
  if (!picked || !v26TargetedTerrainCell(projection, sceneTerrainFor(projection).revealedTerrain,
    picked)) return null
  return { type: 'v26.terrain', kind: 'dig', gx: picked.gx, gz: picked.gz }
}

/** Keyboard Mine uses the pointer Mine gates and the same frontmost scene ray. */
export function keyboardMineIntent(projection: WizardViewProjection, mapOpen: boolean,
  pointer: readonly [number, number] | null, picker: SceneTerrainPicker | null): WizardViewIntent | null {
  return pointer && picker ? v29TerrainIntent(projection, mapOpen, 'mine',
    () => picker(pointer[0], pointer[1], sceneTerrainPickKind(projection, 'mine'))) : null
}

/** Cycle only usable, owned main-hand tools; the controller remains the equipment authority. */
export function nextToolIntent(projection: WizardViewProjection): WizardViewIntent | null {
  if (projection.controllerActionsEnabled !== true || projection.unavailableActions
    || projection.openStoreId || projection.savedTerrainWorks?.modeActive) return null
  const physical = (itemId: string) => {
    const stack = projection.backpack.stacks.find((item) => item.itemId === itemId
      && item.quantity > 0 && item.equippableSlots?.includes('mainHand'))
    const choice = projection.checkedEquipmentChoices?.find((item) => item.itemId === itemId)
    return stack && (!projection.checkedEquipmentChoices || choice?.actionable) ? stack : null
  }
  const choices = [
    { id: 'woodcutters_axe', stack: physical('woodcutters_axe') },
    { id: 'field_spade', stack: physical('field_spade') },
    { id: 'basic', owned: projection.v29Mining?.tools.basicPickOwned },
    { id: 'enchanted', owned: projection.v29Mining?.tools.enchantedPickOwned },
  ]
  const current = projection.v29Mining?.tools.activePick ?? projection.equipment.mainHand?.itemId
  const index = choices.findIndex((choice) => choice.id === current)
  const next = Array.from({ length: choices.length }, (_, offset) =>
    choices[(index + offset + 1) % choices.length]).find((choice) =>
    choice.id !== current && (choice.stack || choice.owned))
  if (!next) return null
  return next.stack ? { type: 'equipment.equip', stackId: next.stack.id, slot: 'mainHand' }
    : { type: 'v29.mining-tool', action: 'equip', tier: next.id as 'basic' | 'enchanted' }
}

/** A V29 mine tap preflights reach and names one cell; authority checks its exact pose and geology. */
export function pointerV29TerrainTapIntent(projection: WizardViewProjection, mapOpen: boolean,
  mode: V29TerrainMode | null, press: PointerPress | null, pointerId: number,
  end: readonly [number, number], picker: () => ReturnType<SceneTerrainPicker>): WizardViewIntent | null {
  return pointerAimTap(press, pointerId, end) ? v29TerrainIntent(projection, mapOpen, mode, picker) : null
}

function v29TerrainIntent(projection: WizardViewProjection, mapOpen: boolean,
  mode: V29TerrainMode | null, picker: () => ReturnType<SceneTerrainPicker>): WizardViewIntent | null {
  if (mode !== 'mine' || !projection.v29Mining?.tools.activePick
    || !projection.v26ValleyRimSegments || mapOpen || projection.openStoreId
    || projection.controllerActionsEnabled !== true || projection.unavailableActions
    || projection.savedTerrainWorks?.modeActive || pointerWorkAimKind(projection, mapOpen)) return null
  const picked = picker()
  if (!picked || ![picked.gx, picked.gz].every((value) => Number.isSafeInteger(value)
    && value >= WORLD_GRID_MIN && value <= WORLD_GRID_MAX)
    || Math.hypot(projection.player.position[0] - picked.gx * WORLD_CELL_METERS,
      projection.player.position[2] - picked.gz * WORLD_CELL_METERS) > 5) return null
  return { type: 'v29.deep-dig', gx: picked.gx, gz: picked.gz }
}

/** V31 placement names one visible top cell; the checked writer decides soil and clearance. */
export function pointerV31SoilPlaceTapIntent(projection: WizardViewProjection, mapOpen: boolean,
  mode: V31TerrainMode | null, press: PointerPress | null, pointerId: number,
  end: readonly [number, number], picker: () => ReturnType<SceneTerrainPicker>): WizardViewIntent | null {
  if (mode !== 'place-soil' || !projection.v31Soil || projection.v31Soil.soilAvailable < 1
    || !pointerV26TerrainKind(projection, mapOpen, 'dig')
    || !pointerAimTap(press, pointerId, end) || pointerWorkAimKind(projection, mapOpen)) return null
  const picked = picker()
  if (!picked || ![picked.gx, picked.gz].every((value) => Number.isSafeInteger(value)
    && value >= WORLD_GRID_MIN && value <= WORLD_GRID_MAX)
    || Math.hypot(projection.player.position[0] - picked.gx * WORLD_CELL_METERS,
      projection.player.position[2] - picked.gz * WORLD_CELL_METERS) > 5) return null
  return { type: 'v31.soil-place', gx: picked.gx, gz: picked.gz }
}

export function cameraOrbitFromDrag(current: readonly [number, number], delta: readonly [number, number]): readonly [number, number] {
  return [current[0] - delta[0] * 0.004, Math.max(0.08, Math.min(0.72, current[1] + delta[1] * 0.003))]
}

const STYLES = `
.wr-surface{position:relative;width:100%;height:100%;min-height:600px;overflow:hidden;background:#14221f;color:#f5f1df;font:500 14px/1.35 system-ui,sans-serif;outline:none}.wr-scene{position:absolute;z-index:0;inset:0;cursor:grab}.wr-scene[data-dragging="true"]{cursor:grabbing}.wr-surface button{font:inherit}.wr-hud{position:absolute;z-index:1;inset:0;pointer-events:none}.wr-hud button,.wr-panel{pointer-events:auto}.wr-topbar{position:absolute;left:50%;top:16px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;min-width:300px;padding:9px 13px;border:1px solid #d5b86f55;border-radius:12px;background:#101a17dd;box-shadow:0 8px 28px #0007}.wr-topbar>div:first-child{display:flex;gap:7px;align-items:baseline}.wr-kicker,.wr-panel header small{font-size:10px;letter-spacing:.15em;color:#d9ba6a}.wr-xp{height:8px;flex:1;overflow:hidden;border-radius:9px;background:#27342d}.wr-xp span{display:block;height:100%;background:linear-gradient(90deg,#7a49bd,#d283e7)}.wr-coins{color:#f5d670}.wr-prompt{position:absolute;left:50%;bottom:130px;transform:translateX(-50%);display:flex;gap:11px;align-items:center;padding:9px 14px;border:1px solid #ddc88266;border-radius:10px;background:#111b18e8;color:#fff;box-shadow:0 6px 18px #0008}.wr-prompt[data-actionable="true"]{cursor:pointer}.wr-prompt kbd{padding:5px 8px;border:1px solid #f5dc87;border-radius:5px;background:#594923}.wr-prompt span{display:flex;flex-direction:column;text-align:left}.wr-prompt b{color:#ffe395}.wr-panel{position:absolute;width:260px;padding:12px;border:1px solid #c9ad6652;border-radius:13px;background:linear-gradient(145deg,#14201ded,#0d1513ed);box-shadow:0 10px 32px #0008;backdrop-filter:blur(8px)}.wr-panel header{display:flex;justify-content:space-between;margin-bottom:9px;color:#f5d889;font:700 13px/1.2 Georgia,serif;text-transform:uppercase;letter-spacing:.09em}.wr-backpack{left:16px;top:16px}.wr-gear{right:16px;top:16px}.wr-trade{right:16px;bottom:16px}.wr-context{left:50%;bottom:24px;transform:translateX(-50%);width:290px}.wr-list{display:grid;gap:6px;max-height:220px;overflow:auto}.wr-item{display:grid;grid-template-columns:25px 1fr auto auto auto;gap:6px;align-items:center;padding:6px;border-radius:7px;background:#27322b}.wr-item small{color:#b7c2b9}.wr-item button,.wr-context button{border:1px solid #cfb66b55;border-radius:6px;background:#374b3d;color:#f8e8b2;cursor:pointer}.wr-item button:disabled{opacity:.35}.wr-icon{color:#d28ee8}.wr-slot-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.wr-slot{min-height:45px;padding:6px;border:1px solid #81724b66;border-radius:7px;background:#1e2b25}.wr-slot small,.wr-slot b{display:block}.wr-slot small{text-transform:capitalize;color:#ad9d76}.wr-trade-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.wr-trade-grid button,.wr-empty-slot{min-height:48px;padding:6px;border:1px solid #75674466;border-radius:7px;background:#1d2a24;color:#eee;text-align:left}.wr-trade-grid b,.wr-trade-grid small,.wr-trade-grid em{display:block}.wr-trade-grid small{color:#c9bd98}.wr-trade-grid em{color:#ef9c8c;font-size:11px}.wr-empty-slot{display:grid;place-items:center;color:#85968d}.wr-context button{display:flex;justify-content:space-between;width:100%;margin-top:6px;padding:9px}.wr-context button span{color:#e2c86d}.wr-caption,.wr-empty{margin:4px 0;color:#9fb0a7;font-size:12px}.wr-events{position:absolute;left:17px;bottom:18px;width:340px;text-shadow:0 2px 4px #000}.wr-events p{margin:3px 0;color:#e8eadf}.wr-diagnostics{position:absolute;left:50%;top:69px;transform:translateX(-50%);padding:4px 8px;border-radius:5px;background:#101814aa;color:#b6c8bf;font:11px monospace}.wr-touch{display:none}.wr-focus-note{position:absolute;right:20px;top:300px;padding:7px 10px;border-radius:7px;background:#111b18bb;color:#c9d6cf;font-size:12px}.wr-map-toggle{position:absolute;left:16px;top:286px;z-index:5;display:grid;gap:6px;width:132px;min-height:44px;padding:6px 10px;border:1px solid #d5b86f66;border-radius:9px;background:#101a17e8;color:#fff;text-align:left;cursor:pointer}.wr-map-toggle-label{display:flex;justify-content:space-between;align-items:center;min-height:30px}.wr-map-toggle small{color:#f5d670}.wr-map-toggle:focus-visible,.wr-map-dialog header button:focus-visible{outline:3px solid #ffe395;outline-offset:2px}.wr-map-compact{display:block;pointer-events:none}.wr-map-grid{display:grid;gap:2px;aspect-ratio:1}.wr-map-tile{display:grid;place-items:center;min-width:0;border:1px solid #ffffff1b;color:#fff;font-size:10px}.wr-map-tile[data-discovered="false"]{border-style:dashed}.wr-map-tile b{display:block}.wr-map-backdrop{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:#07100dcc}.wr-map-dialog{position:relative;box-sizing:border-box;width:min(560px,88vw);max-height:calc(100% - 24px);padding:18px;overflow-y:auto;overscroll-behavior:contain;border:1px solid #d5b86f88;border-radius:16px;background:#0e1715f5;box-shadow:0 20px 80px #000b}.wr-map-dialog header{display:flex;justify-content:space-between;align-items:start}.wr-map-dialog h2{margin:3px 0 14px;font:700 25px Georgia,serif;color:#f5d889}.wr-map-dialog header small{letter-spacing:.14em;color:#ab9d76}.wr-map-dialog header button{width:44px;height:44px;border:1px solid #d5b86f66;border-radius:9px;background:#27342d;color:#fff;font-size:24px}.wr-map-dialog .wr-map-grid{width:min(60vh,100%);margin:auto}.wr-map-routes{display:grid;gap:4px;margin-top:12px}.wr-map-routes div{display:flex;justify-content:space-between;padding:6px 8px;border-radius:6px;background:#1d2a24}.wr-map-dialog>p{margin:10px 0 0;color:#b7c2b9;font-size:12px}
.wr-map-backdrop{position:fixed}
.wr-map-dialog{height:min(620px,calc(100% - 24px));scrollbar-gutter:stable}
.wr-map-dialog header{position:sticky;top:0;z-index:1;background:#0e1715}
@media(max-width:719px){.wr-map-dialog{height:auto}}
.wr-context{bottom:60px}.wr-hud:has(.wr-context) .wr-prompt[data-actionable="false"]{display:none}.wr-backpack .wr-item{grid-template-columns:25px minmax(0,1fr) auto}.wr-backpack .wr-item button:first-of-type{grid-column:2}
.wr-gait{position:absolute;z-index:5;top:70px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:7px;padding:4px 7px;border:1px solid #d5b86f77;border-radius:10px;background:#101a17e8;pointer-events:auto;white-space:nowrap}.wr-gait button{min-width:62px;min-height:44px;border:1px solid #f5dc87;border-radius:7px;background:#374b3d;color:#fff;cursor:pointer}.wr-gait button[aria-pressed="true"]{background:#73561f}.wr-gait button:disabled{opacity:.65;cursor:default}.wr-gait small{color:#e8eadf}.wr-gait kbd{color:#f5d670}
@media(max-width:719px){.wr-gait{box-sizing:border-box;left:8px;width:calc(100% - 16px);transform:none;white-space:normal}.wr-gait small{min-width:0;flex:1}}
.wr-context[data-store-panel]{z-index:6}
.wr-map-camp-window{position:relative;display:block;max-height:min(52vh,480px);overflow:auto;overscroll-behavior:contain}.wr-map-grid button.wr-map-tile{padding:0;cursor:pointer;font-size:10px;border-radius:0;touch-action:manipulation}.wr-map-grid button.wr-map-tile:focus-visible{position:relative;z-index:1;outline:3px solid #ffe395;outline-offset:0}.wr-map-grid button.wr-map-tile[aria-pressed="true"]{box-shadow:inset 0 0 0 2px #ffe395}
.wr-map-routes section{padding:6px 8px;border-radius:7px;background:#1d2a24}.wr-map-routes h3{display:flex;justify-content:space-between;gap:8px;margin:0 0 4px;color:#f5d889;font-size:13px}.wr-map-routes h3 small{color:#c9bd98;font-weight:500}.wr-map-site{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;min-height:44px;margin-top:5px;padding:7px 9px;border:1px solid #d5b86f66;border-radius:7px;background:#293c32;color:#f7ecd0;text-align:left;cursor:pointer}.wr-map-site small{color:#d4c590}.wr-map-site[aria-pressed="true"]{outline:2px solid #ffe395;outline-offset:1px}.wr-build-preview{bottom:210px}.wr-build-preview .wr-build-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.wr-build-preview .wr-build-actions button{min-height:44px;justify-content:center}.wr-build-preview .wr-build-actions button:disabled{opacity:.45;cursor:not-allowed}
.wr-trade{box-sizing:border-box;max-height:176px;overflow-y:auto;overscroll-behavior:contain}.wr-saved-work-panel{z-index:5;box-sizing:border-box;right:16px;top:285px;max-height:calc(100% - 493px);overflow-y:auto;overscroll-behavior:contain}.wr-saved-work-panel:has(details:not([open])){width:auto;min-width:170px}.wr-saved-work-panel summary{color:#f5d889;font-weight:700}.wr-saved-work-panel button:disabled{opacity:.6;cursor:not-allowed}.wr-surface:has(.wr-saved-work-panel) .wr-focus-note{display:none}
.wr-surface:has(.wr-map-backdrop) .wr-saved-work-panel{display:none}
.wr-saved-work-actions{position:sticky;bottom:0;z-index:1;display:grid;gap:6px;padding-top:8px;background:#101a17}
.wr-surface[data-work-mode="true"] .wr-gear,.wr-surface[data-work-mode="true"] .wr-trade{display:none}.wr-surface[data-work-mode="true"] .wr-saved-work-panel{top:76px;max-height:calc(100% - 92px)}
@media(min-width:720px) and (max-width:900px){.wr-surface[data-work-mode="true"] .wr-saved-work-panel{top:130px;max-height:calc(100% - 146px)}}
@media(max-width:719px){.wr-saved-work-panel{right:8px;top:176px;width:min(280px,calc(100% - 16px));max-height:calc(100% - 330px)}.wr-surface:has(.wr-saved-work-panel details[open]) .wr-prompt,.wr-surface:has(.wr-saved-work-panel details[open]) .wr-events{display:none}}
@media(max-width:719px){.wr-surface[data-work-mode="true"] .wr-saved-work-panel{top:8px;max-height:calc(100% - 160px)}.wr-surface[data-work-mode="true"] .wr-topbar,.wr-surface[data-work-mode="true"] .wr-gait,.wr-surface[data-work-mode="true"] .wr-map-toggle,.wr-surface[data-work-mode="true"] .wr-backpack-toggle,.wr-surface[data-work-mode="true"] .wr-events{display:none}}
@media(max-width:719px) and (max-height:400px){.wr-saved-work-panel{top:120px;max-height:calc(100% - 240px)}.wr-saved-work-panel:has(details:not([open])){min-width:150px}.wr-saved-work-panel:has(details[open]){z-index:30;left:8px;right:8px;top:8px;width:auto;height:calc(100% - 16px);max-height:calc(100% - 16px)}.wr-surface:has(.wr-saved-work-panel details[open]) .wr-gait,.wr-surface:has(.wr-saved-work-panel details[open]) .wr-touch,.wr-surface:has(.wr-saved-work-panel details[open]) .wr-backpack-toggle,.wr-surface:has(.wr-saved-work-panel details[open]) .wr-map-toggle,.wr-surface:has(.wr-saved-work-panel details[open]) .wr-topbar{display:none}}
@media(max-width:719px),(min-width:720px) and (max-width:900px) and (max-height:590px){.wr-surface{min-height:480px}.wr-backpack{box-sizing:border-box;left:8px;top:64px;width:220px}.wr-gear,.wr-trade,.wr-diagnostics{display:none}.wr-events{left:10px;top:205px;bottom:auto;width:calc(100% - 20px);max-height:80px;overflow-y:auto;font-size:12px}.wr-context{bottom:150px;width:min(280px,78vw)}.wr-build-preview{bottom:230px}.wr-prompt{bottom:148px}.wr-touch{display:flex;position:absolute;inset:auto 14px 14px;justify-content:space-between;align-items:end;pointer-events:none}.wr-touch button{pointer-events:auto;width:58px;height:58px;border:1px solid #ffe39577;border-radius:17px;background:#17231ed9;color:#fff;font-size:24px;touch-action:none}.wr-dpad{display:grid;grid-template-columns:repeat(3,58px);grid-template-rows:repeat(2,58px);gap:5px}.wr-dpad button:nth-child(1){grid-column:2}.wr-dpad button:nth-child(2){grid-column:1}.wr-dpad button:nth-child(3){grid-column:2}.wr-dpad button:nth-child(4){grid-column:3}.wr-touch-actions{display:grid;gap:6px}.wr-touch .wr-touch-action{width:72px;height:54px;border-radius:18px;font-size:13px;background:#6c3e7ee8}.wr-focus-note{display:none}.wr-topbar{top:8px;min-width:min(300px,85vw)}.wr-map-toggle{left:auto;right:8px;top:64px;display:flex;justify-content:center;width:auto;min-width:44px;min-height:44px;padding:0 10px}.wr-map-toggle small,.wr-map-compact{display:none}.wr-map-backdrop{display:block}.wr-map-dialog{position:absolute;inset:0;width:auto;max-height:none;border:0;border-radius:0;padding:calc(14px + env(safe-area-inset-top,0px)) calc(14px + env(safe-area-inset-right,0px)) calc(14px + env(safe-area-inset-bottom,0px)) calc(14px + env(safe-area-inset-left,0px))}.wr-map-dialog .wr-map-grid{width:min(75vh,100%)} }
@media(min-width:720px) and (max-width:900px) and (max-height:590px){.wr-surface{min-height:100%}.wr-backpack,.wr-events{display:none}.wr-saved-work-panel{top:120px;max-height:calc(100% - 136px)}}
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
@media(min-width:720px) and (max-height:599px){.wr-context[data-store-panel]{position:fixed;bottom:60px;max-height:calc(100dvh - 110px)}}
@media(max-width:719px) and (max-height:400px){.wr-surface .wr-context.wr-build-preview{left:50%;top:54px;bottom:auto;transform:translateX(-50%);box-sizing:border-box;width:min(280px,72vw);max-height:145px;overflow-y:auto;z-index:8}}
@media(min-width:720px) and (min-height:591px){.wr-backpack{box-sizing:border-box;max-height:calc(100% - 230px);overflow-y:auto}.wr-map-toggle{top:auto;bottom:16px}.wr-events{left:186px}}
@media(min-width:901px) and (min-height:591px){[data-public-version=v29] .wr-events{left:290px;bottom:270px;max-width:340px}}
@media(min-width:901px) and (max-height:590px){.wr-surface{min-height:100%}.wr-gear{box-sizing:border-box;max-height:128px;overflow-y:auto}.wr-trade{max-height:120px}.wr-saved-work-panel{top:160px;max-height:calc(100% - 312px)}.wr-map-toggle{left:316px;top:64px;display:flex;justify-content:center;width:auto;min-width:44px;min-height:44px;padding:0 10px}.wr-map-toggle small,.wr-map-compact{display:none}}
@media(min-width:901px) and (max-height:400px){.wr-gear{max-height:96px}.wr-trade{max-height:100px}.wr-saved-work-panel{top:128px;max-height:calc(100% - 260px)}}
@media(max-width:719px){.wr-surface:has([data-field-camp-panel]) .wr-prompt,.wr-surface:has([data-field-camp-panel]) .wr-events{display:none}}
@media(max-width:719px) and (min-height:401px) and (max-height:599px){.wr-surface .wr-context[data-field-camp-panel]{left:8px;top:208px;bottom:auto;transform:none;box-sizing:border-box;width:min(280px,calc(100% - 108px));max-height:calc(100% - 350px);overflow-y:auto;overscroll-behavior:contain;padding:8px;font-size:12px}.wr-surface .wr-context[data-field-camp-panel] header{margin-bottom:5px}}
.wr-v26-terrain{position:absolute;z-index:6;right:16px;bottom:68px;box-sizing:border-box;width:220px;max-height:calc(100% - 170px);overflow-y:auto;padding:8px;border:1px solid #d5b86f88;border-radius:10px;background:#101a17e8;color:#f5f1df}.wr-v26-terrain-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.wr-v26-terrain button{min-height:44px;border:1px solid #d5b86f88;border-radius:7px;background:#374b3d;color:#fff;cursor:pointer;touch-action:manipulation}.wr-v26-terrain button[aria-pressed="true"]{background:#73561f}.wr-v26-terrain button:disabled{opacity:.48;cursor:not-allowed}.wr-v26-terrain p{margin:7px 1px 0;font-size:12px;color:#e0d5b6}.wr-v26-terrain .wr-soil-rejection{padding:6px 8px;border-left:3px solid #ffba75;background:#3b281c;color:#ffe3bd}.wr-surface[data-work-mode="true"] .wr-v26-terrain,.wr-surface:has(.wr-map-backdrop) .wr-v26-terrain,.wr-surface:has(.wr-context[data-store-panel]) .wr-v26-terrain{display:none}
.wr-v26-terrain[data-v29="true"] .wr-v26-terrain-actions{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
.wr-terrain-inline-hint{display:none}
.wr-terrain-hover-hint{position:absolute;left:50%;top:142px;transform:translateX(-50%);box-sizing:border-box;max-width:min(420px,calc(100% - 24px));padding:5px 9px;border-radius:7px;background:#102622e8;color:#d3e7e7;font-size:11px;text-align:center;pointer-events:none}
@media(min-width:720px) and (max-width:1199px){.wr-terrain-hover-hint{left:280px;top:136px;width:calc(100% - 560px);max-width:none;transform:none;font-size:10px;line-height:1.2}}
@media(min-width:1200px) and (min-height:600px){.wr-terrain-hover-hint{display:none}.wr-terrain-inline-hint{display:block;color:#d3e7e7!important}}
@media(max-width:719px){.wr-terrain-hover-hint{display:none}.wr-terrain-inline-hint{display:block;color:#d3e7e7!important}}
.wr-keyboard-terrain-aim{position:absolute;z-index:1;left:38%;top:62%;display:grid;place-items:center;width:26px;height:26px;transform:translate(-50%,-50%);border:2px solid #ffe395;border-radius:50%;background:#101a1788;color:#fff;font:bold 20px/1 system-ui;pointer-events:none;text-shadow:0 1px 3px #000}.wr-scene:hover .wr-keyboard-terrain-aim{display:none}
@media(max-width:719px){.wr-keyboard-terrain-aim{left:72%}}
.wr-keybinds{margin-top:7px;font-size:12px}.wr-keybinds summary{cursor:pointer;color:#f5d889}.wr-keybinds>div{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:6px}.wr-keybinds button{min-height:36px}.wr-keybinds summary:focus-visible,.wr-keybinds button:focus-visible{outline:3px solid #ffe395;outline-offset:2px}
.wr-dev-nav-hint{position:absolute;z-index:4;left:50%;bottom:16px;transform:translateX(-50%);max-width:min(520px,80vw);padding:6px 10px;border-radius:7px;background:#101a17d9;color:#f5e6b2;text-align:center;font-size:12px;pointer-events:none}
@media(min-width:720px) and (max-width:900px) and (min-height:591px){[data-public-version=v42] .wr-gait small,[data-public-version=v43] .wr-gait small{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}[data-public-version=v42] .wr-dev-nav-hint{display:none}}
@media(min-width:901px) and (min-height:591px){[data-public-version=v42] .wr-dev-nav-hint{bottom:64px}}
@media(max-width:719px){.wr-v26-terrain{right:8px;bottom:150px;width:180px}}
`

export function WizardSurface({ projection, onIntent, diagnostics = false, inputTrace,
  saveInProgress = false, workActionCue = null,
  greenwayLogOrder, starterChapterActors = false, starterChapterPrimary = false,
  soilPlaceRejection = null }: WizardSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const devNavigation = typeof window !== 'undefined' && devNavigationEnabled(window.location.search)
  const pressedKeys = useRef(new Set<string>())
  const lastDragPoint = useRef<readonly [number, number] | null>(null)
  const pointerPress = useRef<PointerPress | null>(null)
  const aimPicker = useRef<SceneWorkAimPicker | null>(null)
  const terrainPicker = useRef<SceneTerrainPicker | null>(null)
  const groundPicker = useRef<SceneGroundPicker | null>(null)
  const lastSceneTap = useRef<SceneTap | null>(null)
  const terrainPointer = useRef<readonly [number, number] | null>(null)
  const spadeEquipped = projection.equipment?.mainHand?.itemId === 'field_spade'
  const activePick = projection.v29Mining?.tools.activePick ?? null
  const groundActionLabel = activePick ? 'Mine' : 'Dig'
  const inOpenPit = !!projection.v29Mining && projection.v26OpenPitColumns?.some((column) =>
    column.openDepth > 0
    && column.gx === Math.ceil(projection.player.position[0] / WORLD_CELL_METERS - 0.5)
    && column.gz === Math.ceil(projection.player.position[2] / WORLD_CELL_METERS - 0.5))
  const previouslySpadeEquipped = useRef(spadeEquipped)
  const previousPick = useRef(activePick)
  const [dragging, setDragging] = useState(false)
  const [terrainMode, setTerrainMode] = useState<V31TerrainMode | null>(activePick ? 'mine' : spadeEquipped ? 'dig' : null)
  const [terrainTapHint, setTerrainTapHint] = useState<string | null>(null)
  const [terrainHoverFeedback, setTerrainHoverFeedback] = useState<string | null>(null)
  const [devNavHint, setDevNavHint] = useState<string | null>(null)
  const cameraOrbit = useRef<readonly [number, number]>(CENTERED_CAMERA_ORBIT)
  const [mapOpen, setMapOpen] = useState(false)
  const [backpackOpen, setBackpackOpen] = useState(false)
  const [actionKeys, setActionKeys] = useState<ActionKeys>(() => {
    if (typeof window === 'undefined') return { ...DEFAULT_ACTION_KEYS }
    try { return parseActionKeys(window.localStorage.getItem(KEYBIND_STORAGE_KEY)) }
    catch { return { ...DEFAULT_ACTION_KEYS } }
  })
  const [bindingAction, setBindingAction] = useState<ActionKey | null>(null)
  const [bindingHint, setBindingHint] = useState<string | null>(null)
  const keybindDetailsRef = useRef<HTMLDetailsElement>(null)
  const mapButtonRef = useRef<HTMLButtonElement>(null)
  const mapCloseRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    try { window.localStorage.setItem(KEYBIND_STORAGE_KEY, JSON.stringify({ version: 1, ...actionKeys })) }
    catch { /* Shortcuts remain usable when browser storage is unavailable. */ }
  }, [actionKeys])

  useEffect(() => {
    if (mapOpen || projection.openStoreId || projection.savedTerrainWorks?.modeActive
      || projection.v26ValleyRimSegments === undefined) setBindingAction(null)
  }, [mapOpen, projection.openStoreId, projection.savedTerrainWorks?.modeActive,
    projection.v26ValleyRimSegments])

  useEffect(() => {
    if (previouslySpadeEquipped.current === spadeEquipped) return
    setTerrainMode((mode) => terrainModeAfterSpadeChange(previouslySpadeEquipped.current,
      spadeEquipped, mode === 'mine' || mode === 'place-soil' ? null : mode))
    previouslySpadeEquipped.current = spadeEquipped
    setTerrainTapHint(null)
  }, [spadeEquipped])

  useEffect(() => {
    if (previousPick.current === activePick) return
    previousPick.current = activePick
    setTerrainMode(activePick ? 'mine' : spadeEquipped ? 'dig' : null)
    setTerrainTapHint(null)
  }, [activePick, spadeEquipped])

  useEffect(() => {
    if (!terrainTapHint) return
    const timeout = window.setTimeout(() => setTerrainTapHint(null), 2500)
    return () => window.clearTimeout(timeout)
  }, [terrainTapHint])

  useEffect(() => {
    if (!devNavHint) return
    const timeout = window.setTimeout(() => setDevNavHint(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [devNavHint])

  useEffect(() => {
    if (!mapOpen && !projection.openStoreId && !projection.savedTerrainWorks?.modeActive) return
    lastSceneTap.current = null
  }, [mapOpen, projection.openStoreId, projection.savedTerrainWorks?.modeActive])

  const toggleMap = () => {
    const next = !mapOpen
    inputTrace?.record('dom.map.toggle', { before: mapOpen, after: next })
    if (next) {
      if (devNavigation) onIntent({ type: 'dev.navigate.cancel' })
      lastSceneTap.current = null
      setBackpackOpen(false)
      terrainPointer.current = null
      onIntent({ type: 'movement', vector: releaseHeldControls(pressedKeys.current) })
      setDragging(false)
      lastDragPoint.current = null
      cameraOrbit.current = CENTERED_CAMERA_ORBIT
      window.requestAnimationFrame(() => mapCloseRef.current?.focus())
    } else window.requestAnimationFrame(() => mapButtonRef.current?.focus())
    setMapOpen(next)
  }

  useEffect(() => {
    const clearControls = (event?: Event) => {
      inputTrace?.record('dom.clear', { cause: event?.type ?? 'controls',
        visibility: document.visibilityState })
      onIntent({ type: 'movement', vector: releaseHeldControls(pressedKeys.current) })
      if (devNavigation) onIntent({ type: 'dev.navigate.cancel' })
      lastSceneTap.current = null
      setDragging(false)
      lastDragPoint.current = null
      cameraOrbit.current = CENTERED_CAMERA_ORBIT
    }
    const onVisibilityChange = () => { if (document.visibilityState !== 'visible') clearControls() }
    const onKeyDown = (event: KeyboardEvent) => {
      if (inputTrace && TRACE_KEYS.has(event.code)) inputTrace.record('dom.keydown', { code: event.code,
        eventTimeMs: event.timeStamp, repeat: event.repeat, mapOpen,
        targetTag: (event.target as HTMLElement | null)?.tagName ?? null,
        handled: shouldHandleGameplayKey(event) })
      if (bindingAction && keybindCaptureVisible(projection, mapOpen,
        keybindDetailsRef.current?.open === true)) {
        if (event.code === 'Escape') {
          event.preventDefault(); setBindingAction(null); setBindingHint('Key change cancelled.')
          return
        }
        if (event.ctrlKey || event.metaKey || event.altKey || event.code === 'Tab') return
        if (!shouldHandleGameplayKey(event)) return
        event.preventDefault()
        if (!bindableActionCode(event.code, actionKeys[bindingAction === 'dig' ? 'switchTool' : 'dig'])) {
          setBindingHint('That key is reserved or already assigned. Choose another letter or number.')
          return
        }
        setActionKeys((keys) => ({ ...keys, [bindingAction]: event.code }))
        setBindingHint(`${bindingAction === 'dig' ? groundActionLabel : 'Switch tool'} bound to ${actionKeyLabel(event.code)}.`)
        setBindingAction(null)
        return
      }
      if (event.code === 'Escape') {
        if (event.repeat) return
        clearControls()
        const target = escapeSurfaceTarget(mapOpen, projection)
        if (target === 'map') toggleMap()
        else if (target?.type === 'store.close') {
          event.preventDefault()
          const storeName = projection.stores.find((store) => store.id === projection.openStoreId)?.name ?? null
          onIntent(target)
          window.requestAnimationFrame(() => focusStoreOpener(rootRef.current, storeName))
        } else if (target) onIntent(target)
        else setBackpackOpen(false)
        return
      }
      if (!shouldHandleGameplayKey(event)) return
      if (event.code === 'KeyM') {
        event.preventDefault()
        if (mapToggleForKey(mapOpen, event.code, event.repeat) !== mapOpen) toggleMap()
        return
      }
      if (mapOpen) return
      if ((event.code === actionKeys.dig || event.code === actionKeys.switchTool)
        && (event.ctrlKey || event.metaKey || event.altKey)) return
      if (event.code === actionKeys.dig) {
        event.preventDefault()
        if (projection.openStoreId || projection.savedTerrainWorks?.modeActive
          || projection.controllerActionsEnabled !== true || projection.unavailableActions) return
        if (!activePick && !spadeEquipped) {
          setTerrainTapHint('Equip a field spade to dig or an owned pick to mine.'); return
        }
        setTerrainMode(activePick ? 'mine' : 'dig')
        const pointer = keyboardTerrainPointer(terrainPointer.current,
          rootRef.current?.querySelector('canvas')?.getBoundingClientRect() ?? null)
        const intent = activePick
          ? keyboardMineIntent(projection, mapOpen, pointer, terrainPicker.current)
          : keyboardDigIntent(projection, mapOpen, pointer, terrainPicker.current)
        if (intent) { setTerrainTapHint(null); onIntent(intent) }
        else setTerrainTapHint(V29_NO_GROUND_TARGET_HINT)
        return
      }
      if (event.code === actionKeys.switchTool) {
        event.preventDefault()
        if (projection.openStoreId || projection.savedTerrainWorks?.modeActive) return
        const intent = nextToolIntent(projection)
        if (intent) { setTerrainTapHint(null); onIntent(intent) }
        else setTerrainTapHint('No other owned, usable main-hand tool to switch to.')
        return
      }
      const workIntent = savedWorkKeyboardIntent(event.code, projection.savedTerrainWorks,
        projection.v26ValleyRimSegments !== undefined)
      if (workIntent) {
        event.preventDefault()
        onIntent(workIntent)
        return
      }
      if (event.code === 'KeyR' && projection.gait) {
        event.preventDefault()
        onIntent({ type: 'gait.toggle' })
        return
      }
      if (event.code === 'KeyE' && !projection.unavailableActions) onIntent({ type: 'interact' })
      if (event.code === 'Space') {
        event.preventDefault()
        lastSceneTap.current = null
        if (devNavigation) onIntent({ type: 'dev.navigate.cancel' })
        onIntent({ type: 'jump' })
      }
      if (MOVEMENT_KEYS.has(event.code)) {
        event.preventDefault()
        lastSceneTap.current = null
        if (devNavigation) onIntent({ type: 'dev.navigate.cancel' })
        for (const intent of keyboardMovementIntents(pressedKeys.current, event.code, true,
          keyboardEventTime(event.timeStamp, performance.now()))) onIntent(intent)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (inputTrace && TRACE_KEYS.has(event.code)) inputTrace.record('dom.keyup', { code: event.code,
        eventTimeMs: event.timeStamp, repeat: event.repeat, mapOpen,
        targetTag: (event.target as HTMLElement | null)?.tagName ?? null })
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
  }, [actionKeys, activePick, bindingAction, devNavigation, groundActionLabel, inputTrace, mapOpen, onIntent, projection, spadeEquipped])

  return (
    <div className="wr-surface" ref={rootRef} tabIndex={0} aria-label="Wizard Realms third-person world" data-backpack-open={backpackOpen} data-work-mode={projection.savedTerrainWorks?.modeActive === true}
      onClickCapture={(event) => focusGameplayAfterClick(event.currentTarget, event.target as Element, event.detail)}>
      <style>{STYLES}</style>
      <div className="wr-scene" data-dragging={dragging}
        onPointerEnter={(event) => { terrainPointer.current = [event.clientX, event.clientY] }}
        onPointerDown={(event) => {
          if (pointerPress.current) return
          rootRef.current?.focus()
          terrainPointer.current = [event.clientX, event.clientY]
          event.currentTarget.setPointerCapture(event.pointerId)
          const start = [event.clientX, event.clientY] as const
          pointerPress.current = { id: event.pointerId, start, primary: event.button === 0 && event.isPrimary, dragged: false }
          lastDragPoint.current = start
        }}
        onPointerMove={(event) => {
          terrainPointer.current = [event.clientX, event.clientY]
          const press = pointerPress.current
          if (!press || press.id !== event.pointerId) return
          if (!press.dragged && pointerMovedBeyondOrbitThreshold(press.start, [event.clientX, event.clientY])) {
            press.dragged = true
            setDragging(true)
          }
          if (!press.dragged) return
          const previous = lastDragPoint.current
          if (!previous) return
          const next = [event.clientX, event.clientY] as const
          lastDragPoint.current = next
          cameraOrbit.current = cameraOrbitFromDrag(cameraOrbit.current, [next[0] - previous[0], next[1] - previous[1]])
        }}
        onPointerUp={(event) => {
          const press = pointerPress.current
          if (!press || press.id !== event.pointerId) return
          const tap = pointerAimTap(press, event.pointerId, [event.clientX, event.clientY])
          const eligible = devNavigation && tap && pressedKeys.current.size === 0
            && !mapOpen && !projection.openStoreId
            && !projection.savedTerrainWorks?.modeActive && !projection.unavailableActions
          const currentTap = { atMs: event.timeStamp,
            point: [event.clientX, event.clientY] as const }
          const decision = devSceneTapDecision(eligible, lastSceneTap.current, currentTap, terrainMode)
          const doubleTap = decision === 'navigate'
          lastSceneTap.current = eligible && !terrainMode && !doubleTap ? currentTap : null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          pointerPress.current = null
          lastDragPoint.current = null
          setDragging(false)
          if (doubleTap) {
            const intent = pointerDevNavigateIntent(devNavigation, projection, mapOpen,
              groundPicker.current?.(event.clientX, event.clientY) ?? null)
            if (intent) { setDevNavHint('Finding a safe route to the selected ground.'); onIntent(intent) }
            else setDevNavHint('No visible revealed ground at that point. Double-click a clear terrain surface.')
            return
          }
          const kind = tap && pointerWorkAimKind(projection, mapOpen)
          if (kind) {
            const aimed = aimPicker.current?.(event.clientX, event.clientY, kind,
              kind === 'regional-ladder' && projection.visualWorld
                ? { seed: projection.seed, discoveredTileIds: projection.visualWorld.discoveredTileIds }
                : undefined)
            const intent = pointerWorkAimIntent(kind, aimed ?? null)
            if (intent) onIntent(intent)
            return
          }
          const dispatchTerrainTap = () => {
            const soilIntent = pointerV31SoilPlaceTapIntent(projection, mapOpen, terrainMode,
              press, event.pointerId, [event.clientX, event.clientY],
              () => terrainPicker.current?.(event.clientX, event.clientY, 'dig') ?? null)
            if (soilIntent?.type === 'v31.soil-place') {
              setTerrainTapHint(`Cell x ${soilIntent.gx * 4}, z ${soilIntent.gz * 4} m selected. The checked action decides if soil can be placed here.`)
              onIntent(soilIntent)
              return
            }
            const mineIntent = pointerV29TerrainTapIntent(projection, mapOpen,
              terrainMode === 'place-soil' ? null : terrainMode,
              press, event.pointerId, [event.clientX, event.clientY],
              () => terrainPicker.current?.(event.clientX, event.clientY,
                sceneTerrainPickKind(projection, 'mine')) ?? null)
            if (mineIntent?.type === 'v29.deep-dig') {
              setTerrainTapHint(`Cell x ${mineIntent.gx * 4}, z ${mineIntent.gz * 4} m selected. The checked dig decides this layer or reports why it is blocked.`)
              onIntent(mineIntent)
              return
            }
            const v26Mode = terrainMode === 'mine' || terrainMode === 'place-soil' ? null : terrainMode
            const intent = pointerV26TerrainTapIntent(projection, mapOpen, v26Mode,
              press, event.pointerId, [event.clientX, event.clientY],
              () => terrainPicker.current?.(event.clientX, event.clientY,
                sceneTerrainPickKind(projection, v26Mode)) ?? null)
            if (intent) { setTerrainTapHint(null); onIntent(intent) }
            else if (tap && terrainMode === 'place-soil' && projection.v31Soil) {
              setTerrainTapHint(projection.v31Soil.soilAvailable < 1
                ? 'No carried soil. Dig safe dry ground first.'
                : 'No clear dry ground cell targeted. Move within 5 m and tap the visible top, not its side.')
            } else if (tap && terrainMode === 'mine' && projection.v29Mining?.tools.activePick) {
              setTerrainTapHint(V29_NO_GROUND_TARGET_HINT)
            } else if (tap && pointerV26TerrainKind(projection, mapOpen, v26Mode)) {
              setTerrainTapHint(projection.v29Mining && terrainMode === 'dig'
                ? V29_NO_GROUND_TARGET_HINT
                : terrainMode === 'fill'
                ? 'Tap the exposed floor or inner wall of a saved pit. Rocks and water block the spade.'
                : 'Tap clear, revealed dry ground. Rocks and water block the spade.')
            }
          }
          dispatchTerrainTap()
        }}
        onPointerCancel={(event) => {
          if (pointerPress.current?.id !== event.pointerId) return
          pointerPress.current = null; lastDragPoint.current = null; lastSceneTap.current = null; setDragging(false)
        }}
        onPointerLeave={() => { terrainPointer.current = null }}
        onLostPointerCapture={(event) => {
          if (pointerPress.current?.id !== event.pointerId) return
          pointerPress.current = null; lastDragPoint.current = null; setDragging(false)
        }}>
        {(spadeEquipped || activePick) && terrainMode && !mapOpen
          && !projection.openStoreId && !projection.savedTerrainWorks?.modeActive
          && <span className="wr-keyboard-terrain-aim" aria-hidden="true">+</span>}
        <WizardScene projection={projection} cameraOrbit={cameraOrbit} orbiting={dragging}
          terrainMode={terrainMode} inputTrace={inputTrace} saveInProgress={saveInProgress}
          workActionCue={workActionCue}
          starterChapterActors={starterChapterActors}
          onTerrainHoverFeedback={setTerrainHoverFeedback}
          onAimPickerReady={(picker) => { aimPicker.current = picker }}
          onTerrainPickerReady={(picker) => { terrainPicker.current = picker }}
          onGroundPickerReady={(picker) => { groundPicker.current = picker }} />
      </div>
      {projection.v26ValleyRimSegments !== undefined && <div className="wr-v26-terrain"
        data-v29={projection.v29Mining ? 'true' : undefined}
        role="group" aria-label="Terrain tools">
        <div className="wr-v26-terrain-actions">
          {(['dig', 'fill'] as const).map((kind) => <button key={kind} type="button"
            aria-pressed={terrainMode === kind} disabled={!pointerV26TerrainKind(projection, mapOpen, kind)}
            onClick={() => { setTerrainTapHint(null); setTerrainMode((current) => current === kind ? null : kind) }}>
            {kind === 'dig' ? 'Dig' : 'Fill'}
          </button>)}
          {projection.v29Mining && <button type="button" aria-pressed={terrainMode === 'mine'}
            disabled={!activePick || projection.controllerActionsEnabled !== true || !!projection.unavailableActions}
            onClick={() => { setTerrainTapHint(null); setTerrainMode((current) => current === 'mine' ? null : 'mine') }}>Mine</button>}
          {projection.v31Soil && <button type="button" aria-pressed={terrainMode === 'place-soil'}
            disabled={!pointerV26TerrainKind(projection, mapOpen, 'dig') || projection.v31Soil.soilAvailable < 1}
            onClick={() => { setTerrainTapHint(null); setTerrainMode((current) => current === 'place-soil' ? null : 'place-soil') }}>Place soil</button>}
        </div>
        {soilPlaceRejection && <p className="wr-soil-rejection" role="alert">
          Soil placement was not saved: {soilPlaceRejection}</p>}
        <p role="status">{projection.v31Soil && terrainMode === 'place-soil'
          ? terrainTapHint ?? (projection.v31Soil.soilAvailable < 1
            ? 'No carried soil. Dig safe dry ground first.'
            : `Carried soil: ${projection.v31Soil.soilAvailable}. Hover for a ground outline, then tap a revealed dry top to request one 0.4 m lift. The checked action decides reach and clearance.`)
          : projection.v29Mining && terrainMode === 'mine' && activePick
          ? terrainTapHint ?? `Active ${activePick} pick. Grey rocks are scenery, not mineable nodes. Wet or river cells cannot be excavated. Tap or click clear ground within 5 m; an outline shows the target when available. The checked action reports its layer, reach, skill, tool, and capacity result. Not every cell holds ore.`
          : projection.equipment?.mainHand?.itemId !== 'field_spade'
          ? terrainTapHint ?? 'Equip a field spade to work the ground.'
          : projection.controllerActionsEnabled !== true
            ? 'Terrain actions are unavailable while the world is saving.'
            : projection.unavailableActions
              ? 'Terrain actions are unavailable in this region.'
            : terrainTapHint ?? (projection.v29Mining && terrainMode === 'dig'
              ? 'Select Dig, then tap or click clear, revealed dry ground within 5 m. An outline shows the target when available. Trees and rocks can block the view; the checked action decides if this soil layer is safe and in reach.'
              : terrainMode === 'dig' ? 'Tap revealed dry ground to dig one layer.'
              : terrainMode === 'fill' ? 'Tap an open pit to fill one layer with earned soil.'
                : 'Choose Dig or Fill, then tap clear ground. Drag to look around.')}</p>
        {terrainMode === 'mine' && terrainHoverFeedback && <p className="wr-terrain-inline-hint" role="status">
          {terrainHoverFeedback}</p>}
        {(spadeEquipped || activePick) && terrainMode && <p>{actionKeyLabel(actionKeys.dig)} aims at the mouse over the world. Move the mouse onto this panel to aim at +; turn or step to line up the ring. Click ground for an exact cell.</p>}
        <details className="wr-keybinds" ref={keybindDetailsRef}
          onToggle={(event) => { if (!event.currentTarget.open) setBindingAction(null) }}>
          <summary>Keys: {actionKeyLabel(actionKeys.dig)} {groundActionLabel} · {actionKeyLabel(actionKeys.switchTool)} Tool</summary>
          <div>
            {(['dig', 'switchTool'] as const).map((action) => <button key={action} type="button"
              aria-label={`Rebind ${action === 'dig' ? groundActionLabel : 'Switch tool'}`}
              onClick={() => { setBindingAction(action); setBindingHint(`Press a letter or number for ${action === 'dig' ? groundActionLabel : 'Switch tool'}. Escape cancels.`) }}>
              {action === 'dig' ? groundActionLabel : 'Switch tool'}: {actionKeyLabel(actionKeys[action])}
            </button>)}
          </div>
          {bindingHint && <p role="status">{bindingHint}</p>}
        </details>
        {inOpenPit && <p>Open pit view: step onto neighboring ground or orbit until its floor or inner wall outlines.</p>}
      </div>}
      <WizardHud projection={projection} onIntent={onIntent} diagnostics={diagnostics}
        greenwayLogOrder={greenwayLogOrder} starterChapterPrimary={starterChapterPrimary} />
      {devNavigation && !projection.openStoreId && <div className="wr-dev-nav-hint" role="status">{devNavHint
        ?? 'Dev: select a terrain tool to use it with one click. Turn tools off, then double-click clear revealed ground to follow a safe route.'}</div>}
      {!projection.openStoreId && <button className="wr-backpack-toggle" type="button" aria-controls="wizard-backpack" aria-expanded={backpackOpen} onClick={() => setBackpackOpen((open) => !open)}>Backpack</button>}
      <WizardMap projection={projection} open={mapOpen} onToggle={toggleMap} onIntent={onIntent} buttonRef={mapButtonRef} closeRef={mapCloseRef} />
      <div className="wr-focus-note">{projection.v31Soil
        ? 'W/S move · A/D pivot · Space jump · B Works · spade Dig/Fill/Place soil · equipped pick Mine · M map'
        : projection.v26ValleyRimSegments !== undefined
        ? projection.v29Mining
          ? 'W/S move · A/D pivot · Space jump · B Works · spade Dig/Fill soil · equipped pick Mine deeper layers · M map'
          : 'W/S move · A/D pivot · Space jump · B Works · 1/2 bridge or ladder · equip spade to dig, choose Fill to refill · M map'
        : projection.savedTerrainWorks?.actionsEnabled
        ? projection.savedTerrainWorks.context === 'works4-greenway'
          ? 'W/S move · A/D pivot · Space jump · B Works · 1/2/3 kind · reticle or aim slider · F confirm · Esc cancel · M map'
          : 'W/S move · A/D pivot · Space jump · B Works · 1/2/3 kind · F confirm · Esc cancel · M map'
        : 'W/S move · A/D pivot · Space jump · hold and drag to orbit · E interact · M map'}</div>
    </div>
  )
}
