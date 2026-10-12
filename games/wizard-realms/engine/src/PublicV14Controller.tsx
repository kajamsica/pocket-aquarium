import { useEffect, useRef, useState } from 'react'
import { createPublicV14ControllerRuntime } from './PublicV14ControllerRuntime'
import { publicWorldV14ViewProjection } from './PublicV14WorldView'
import type { PublicV14EntryBindings } from './PublicV14Entry'
import { PUBLIC_V11_BOOTS_LISTING_ID, publicV11Gait } from './domain/publicWorldGait'
import { commitPublicV14FrameBatch, commitPublicV14GreenwayAction,
  commitPublicV14TerrainWork } from './domain/publicWorldV14Flow'
import type { PublicV14Start } from './domain/publicWorldV14Flow'
import type { PublicWorldIntent } from './domain/publicWorldRuntime'
import { STARTER_CLIFF_SITE_ID } from './domain/starterCliffProfile'
import type { WizardViewIntent, WizardViewProjection } from './view/contracts'
import { sampleTimedMovement, createTimedMovementSampler, recordTimedMovement } from './view/timedInput'
import { WizardSurface } from './view/WizardSurface'

const STEP_MS = 50
const MAX_CATCH_UP = 12
const PIVOT_RADIANS_PER_TICK = 0.13

/** Only visible, currently actionable Greenway controls can reach the checked D1 writer. */
export function publicV14ActionForView(intent: WizardViewIntent,
  view: WizardViewProjection): PublicWorldIntent | null {
  if (!view.starterCliff || view.unavailableActions || view.controllerActionsEnabled === false) return null
  if (intent.type === 'interact') {
    const nearby = view.nearbyInteraction
    return nearby?.kind === 'resource' && nearby.actionable
      && view.resources.some((resource) => resource.id === nearby.targetId
        && resource.kind === 'tree' && resource.available)
      ? { type: 'harvest', resourceId: nearby.targetId } : null
  }
  if (intent.type === 'build-site.confirm') {
    const site = view.buildSites.find((candidate) => candidate.id === intent.siteId)
    return intent.siteId === STARTER_CLIFF_SITE_ID && view.selectedBuildSiteId === intent.siteId
      && site?.discovered && site.status === 'ready' && site.routeId === 'greenway_ladder'
      ? { type: 'build_route', routeId: 'greenway_ladder', siteId: STARTER_CLIFF_SITE_ID } : null
  }
  if (intent.type === 'equipment.equip') {
    const stack = view.backpack.stacks.find((entry) => entry.id === intent.stackId && entry.quantity > 0)
    if ((stack?.itemId === 'woodcutters_axe' || stack?.itemId === 'field_spade')
      && intent.slot === 'mainHand') {
      return { type: 'equip_item', itemId: stack.itemId, slot: 'mainHand' }
    }
    if (stack?.itemId === 'leather_boots' && intent.slot === 'feet') {
      return { type: 'equip_item', itemId: 'leather_boots', slot: 'feet' }
    }
    return null
  }
  if (intent.type === 'equipment.unequip') return intent.slot === 'feet'
    && view.equipment.feet?.itemId === 'leather_boots' ? { type: 'unequip_item', slot: 'feet' } : null
  if (intent.type === 'store.select-listing') return view.openStoreId === intent.storeId
    && intent.storeId === 'store-greenway'
    && (intent.listingId === PUBLIC_V11_BOOTS_LISTING_ID || intent.listingId === 'spade')
    && view.stores.some((store) => store.id === intent.storeId
      && store.listings.some((listing) => listing.id === intent.listingId))
    ? { type: 'buy_store_listing', storeId: intent.storeId, listingId: intent.listingId } : null
  if (intent.type === 'store.sell-item') return view.openStoreId === intent.storeId
    && intent.storeId === 'store-greenway' && intent.itemId === 'stone'
    && Number.isSafeInteger(intent.quantity) && intent.quantity > 0
    && view.stores.some((store) => store.id === intent.storeId
      && store.sellOffers.some((offer) => offer.itemId === 'stone' && offer.quantity >= intent.quantity))
    ? { type: 'sell_to_store', storeId: intent.storeId, itemId: 'stone', quantity: intent.quantity } : null
  return null
}

/** A/D pivots the avatar, W/S move along the resulting heading. Camera drag remains in WizardSurface. */
export function publicV14MovementIntents(yaw: number, vector: readonly [number, number],
  metersPerStep: number): PublicWorldIntent[] {
  const turn = -vector[0] * PIVOT_RADIANS_PER_TICK
  const facing = yaw + turn
  return [
    ...(turn ? [{ type: 'look' as const, yawDelta: turn, pitchDelta: 0 }] : []),
    ...(vector[1] ? [{ type: 'move' as const, delta: {
      x: -vector[1] * Math.sin(facing) * metersPerStep,
      z: -vector[1] * Math.cos(facing) * metersPerStep } }] : []),
  ]
}

export function publicV14CheckpointDue(status: ReturnType<ReturnType<typeof createPublicV14ControllerRuntime>['status']>,
  pendingBoundary: boolean, idleWorks = false): boolean {
  return (status.gate === 'open' || status.gate === 'cap-paused') && status.pendingFrames > 0
    && (idleWorks || pendingBoundary || status.checkpointRecommended || status.checkpointRequired)
}

/** A routine write pauses the preview, but does not close the player's local Works mode. */
export async function publicV14CheckpointWithWorkMode(
  runtime: ReturnType<typeof createPublicV14ControllerRuntime>, mode: { current: boolean }) {
  const result = await runtime.save()
  if (result.status === 'blocked' || runtime.view().movementOwner !== 'streamed') mode.current = false
  return result
}

/** Pause only true idle Works time; retain queued taps and airborne landing frames. */
export function publicV14IdleWorksSampler(
  active: ReturnType<ReturnType<typeof createPublicV14ControllerRuntime>['view']>, modeActive: boolean,
  input: { held: readonly [number, number]; tap: readonly [number, number] | null;
    jump: boolean; sampler: ReturnType<typeof createTimedMovementSampler> }, now: number) {
  if (!modeActive || active.movementOwner !== 'streamed' || active.pendingBoundary
    || active.player.verticalVelocity !== 0 || input.held.some(Boolean) || input.tap || input.jump
    || input.sampler.vector.some(Boolean)
    || input.sampler.changes.some(({ vector }) => vector.some(Boolean))) return null
  return createTimedMovementSampler(now)
}

/** A keyboard or touch ID is advisory until this live, discovered aim is reprojected. */
export function publicV14WorkIntentStillReady(view: WizardViewProjection, id: string): boolean {
  const saved = view.savedTerrainWorks
  return saved?.modeActive === true && saved.actionsEnabled === true
    && saved.preview?.selected?.site.id === id && saved.preview.selected.rejection === null
}

export interface PublicV14ControllerProps extends PublicV14EntryBindings {
  start: PublicV14Start
}

/** Version-native controller, mounted only through the explicit v14 entry. */
export function PublicV14Controller({ start, locks, store }: PublicV14ControllerProps) {
  const runtimeRef = useRef<ReturnType<typeof createPublicV14ControllerRuntime> | null>(null)
  runtimeRef.current ??= createPublicV14ControllerRuntime(start, {
    frames: (frames, revision, lineage) => commitPublicV14FrameBatch(locks, store,
      frames, revision, lineage),
    action: (intent, revision, lineage) => commitPublicV14GreenwayAction(locks, store,
      intent, revision, lineage),
    work: (id, revision, lineage) => commitPublicV14TerrainWork(locks, store,
      id, revision, lineage),
  })
  const runtime = runtimeRef.current
  const [, redraw] = useState(0)
  const [messages, setMessages] = useState<string[]>([])
  const [walkRequested, setWalkRequested] = useState(false)
  const walkRef = useRef(false)
  const [openStoreId, setOpenStoreId] = useState<string | null>(null)
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const openRef = useRef<string | null>(null)
  const selectedRef = useRef<string | null>(null)
  const workMode = useRef(false)
  const workKind = useRef<'bridge' | 'ladder' | 'dig'>('bridge')
  const held = useRef<readonly [number, number]>([0, 0])
  const tap = useRef<readonly [number, number] | null>(null)
  const jump = useRef(false)
  const input = useRef(createTimedMovementSampler(performance.now()))
  const lastStep = useRef(input.current.cursorMs)
  const saving = useRef(false)
  const tell = (message: string) => setMessages((prior) => [...prior.slice(-2), message])
  const repaint = () => redraw((version) => version + 1)
  const rebaseInput = () => {
    const now = performance.now()
    input.current = createTimedMovementSampler(now)
    lastStep.current = now
    recordTimedMovement(input.current, now, held.current)
  }
  const project = (selected = selectedRef.current, open = openRef.current,
    walk = walkRef.current, active = runtime.view(), gate = runtime.status()) => {
    if (active.movementOwner !== 'streamed' || gate.gate === 'blocked') workMode.current = false
    return { ...publicWorldV14ViewProjection(runtime.preview(), active, messages,
      selected, open, walk, active.movementOwner === 'streamed' ? {
        kind: workKind.current, bodyYaw: active.player.yaw,
        modeActive: workMode.current && gate.gate === 'open',
        actionsEnabled: gate.gate === 'open' } : undefined),
    controllerActionsEnabled: gate.gate === 'open' }
  }
  const status = runtime.status()
  const active = runtime.view()
  const projection = project(selectedSiteId, openStoreId, walkRequested, active, status)

  const save = async (idleWorks = false) => {
    if (saving.current || !publicV14CheckpointDue(runtime.status(),
      runtime.view().pendingBoundary, idleWorks)) return
    saving.current = true; repaint()
    const result = await publicV14CheckpointWithWorkMode(runtime, workMode)
    saving.current = false
    if (result.status === 'saved') { rebaseInput(); tell('V14 progress saved on this device.') }
    else if (result.status === 'blocked') { held.current = [0, 0]; tell(`Save blocked: ${result.reason}.`) }
    repaint()
  }
  const action = async (intent: PublicWorldIntent | string) => {
    if (runtime.status().gate !== 'open') return
    if (typeof intent === 'string') workMode.current = false
    repaint()
    const result = typeof intent === 'string' ? await runtime.buildWork(intent) : await runtime.action(intent)
    if (result.status === 'saved') {
      if (result.resetWalkRequested) { walkRef.current = false; setWalkRequested(false) }
      rebaseInput()
      tell(result.workEvent ? `${result.workEvent.type === 'terrain_work_dug' ? 'Dig' : 'Build'} saved: ${result.workEvent.id}. ${result.workEvent.logsSpent} logs spent, ${result.workEvent.stoneGained} stone gained, ${result.workEvent.xp} XP.`
        : result.events.at(-1)?.type.replaceAll('_', ' ') ?? 'Action saved.')
    } else if (result.status === 'rejected') {
      rebaseInput()
      tell('Action rejected. Check the current site and equipment.')
    }
    else if (result.status === 'deferred-airborne') tell('Land before interacting.')
    else if (result.status === 'blocked') { held.current = [0, 0]; tell(`Save blocked: ${result.reason}.`) }
    repaint()
  }
  const frame = (vector: readonly [number, number]) => {
    if (runtime.status().gate !== 'open') return
    const player = runtime.view().player
    const gait = publicV11Gait(player.equipment.feet, walkRef.current)
    const intents = jump.current ? [{ type: 'jump' as const }]
      : publicV14MovementIntents(player.yaw, vector, gait.metersPerStep)
    if (jump.current) jump.current = false
    const result = runtime.advanceFrame(intents, walkRef.current)
    if (result.rejections.length) tell(result.rejections.at(-1)!.message)
    else if (result.events.length) tell(result.events.at(-1)!.type.replaceAll('_', ' '))
    repaint()
  }
  const frameRef = useRef(frame)
  frameRef.current = frame
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (runtime.status().gate === 'cap-paused') { void saveRef.current(); return }
      if (runtime.status().gate !== 'open') return
      const now = performance.now()
      const idle = workMode.current && publicV14IdleWorksSampler(runtime.view(), true,
        { held: held.current, tap: tap.current, jump: jump.current, sampler: input.current }, now)
      if (idle) {
        input.current = idle; lastStep.current = now
        if (runtime.status().pendingFrames) void saveRef.current(true)
        return
      }
      const due = Math.min(MAX_CATCH_UP, Math.floor((now - lastStep.current) / STEP_MS))
      for (let index = 0; index < due && runtime.status().gate === 'open'; index++) {
        lastStep.current += STEP_MS
        const sampled = sampleTimedMovement(input.current, lastStep.current)
        const queued = tap.current
        if (!jump.current) tap.current = null
        frameRef.current(queued && !jump.current
          ? [queued[0] || sampled[0], queued[1] || sampled[1]] : sampled)
        if (publicV14CheckpointDue(runtime.status(), runtime.view().pendingBoundary)) {
          void saveRef.current()
        }
      }
      if (now - lastStep.current >= STEP_MS) {
        input.current = createTimedMovementSampler(now)
        lastStep.current = now
        recordTimedMovement(input.current, now, held.current)
      }
    }, STEP_MS)
    return () => window.clearInterval(timer)
  }, [runtime])
  const onIntent = (intent: WizardViewIntent) => {
    if (intent.type === 'movement') {
      held.current = intent.vector
      if (runtime.status().gate === 'open') recordTimedMovement(input.current,
        intent.atMs ?? performance.now(), intent.vector)
      return
    }
    if (runtime.status().gate !== 'open') return
    if (intent.type === 'movement.tap') { tap.current = intent.vector; return }
    if (intent.type === 'jump') { jump.current = true; return }
    if (intent.type === 'gait.toggle') {
      if (project().gait?.canRun) {
        walkRef.current = !walkRef.current
        setWalkRequested(walkRef.current)
      }
      return
    }
    if (intent.type === 'saved-work.mode') {
      workMode.current = intent.active && runtime.view().movementOwner === 'streamed'
      repaint(); return
    }
    if (intent.type === 'saved-work.kind') {
      if (workMode.current && runtime.view().movementOwner === 'streamed') {
        workKind.current = intent.kind
        repaint()
      }
      return
    }
    const current = project()
    if (intent.type === 'saved-work.confirm') {
      if (runtime.view().movementOwner === 'streamed'
        && publicV14WorkIntentStillReady(current, intent.id)) void action(intent.id)
      else tell('Aim at a ready, discovered work site first.')
      return
    }
    if (intent.type === 'store.close') { openRef.current = null; setOpenStoreId(null); return }
    if (intent.type === 'store.open' && current.nearbyStoreId === intent.storeId) {
      openRef.current = intent.storeId; setOpenStoreId(intent.storeId); return
    }
    if (intent.type === 'interact' && current.nearbyInteraction?.kind === 'store'
      && current.nearbyStoreId) {
      openRef.current = current.nearbyStoreId; setOpenStoreId(current.nearbyStoreId); return
    }
    if (intent.type === 'build-site.select') {
      const selected = intent.siteId === STARTER_CLIFF_SITE_ID
        && current.buildSites.some((site) => site.id === intent.siteId && site.discovered)
        ? intent.siteId : null
      selectedRef.current = selected; setSelectedSiteId(selected); return
    }
    const mapped = publicV14ActionForView(intent, current)
    if (mapped) void action(mapped)
    else tell('This action is unavailable in the v14 starter world.')
  }
  return <main data-public-v14="true" data-owner={active.movementOwner}>
    {status.gate === 'blocked' && <p role="alert" style={{ margin: 0, padding: 12,
      background: '#6b1721', color: '#fff', font: '600 15px/1.4 system-ui' }}>Save blocked ({status.blockedReason}).
      Movement is frozen. Keep this tab open; unsaved progress has no recovery export yet.</p>}
    <WizardSurface projection={projection} onIntent={onIntent} />
  </main>
}
