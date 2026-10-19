import { useEffect, useRef, useState } from 'react'
import { publicV14ActionForView, publicV14MovementIntents,
  publicV14WorkIntentStillReady } from './PublicV14Controller'
import { createPublicV16ControllerRuntime } from './PublicV16ControllerRuntime'
import { publicWorldV16ViewProjection } from './PublicV16WorldView'
import type { PublicV16EntryBindings } from './PublicV16Entry'
import { publicV11Gait } from './domain/publicWorldGait'
import { commitPublicV16FrameBatch, commitPublicV16GreenwayAction,
  commitPublicV16GreenwayWork, commitPublicV16TerrainWork } from './domain/publicWorldV16Flow'
import type { PublicV16Start } from './domain/publicWorldV16Flow'
import { resolvePublicV16GreenwaySite } from './domain/publicWorldV16GreenwaySites'
import type { PublicWorldIntent } from './domain/publicWorldRuntime'
import type { WizardViewIntent, WizardViewProjection } from './view/contracts'
import { createTimedMovementSampler, recordTimedMovement,
  sampleTimedMovement } from './view/timedInput'
import { WizardSurface } from './view/WizardSurface'

const STEP_MS = 50
const MAX_CATCH_UP = 12
const MOVE_RESERVE_AT = 96
const FRAME_CAP = 128
const MAX_DEFERRED_INPUTS = 128
type Runtime = ReturnType<typeof createPublicV16ControllerRuntime>
type WorkOwner = 'greenway' | 'streamed'
type DeferredInput = { type: 'frame'; vector: readonly [number, number];
  jumping: boolean; walking: boolean } | { type: 'intent'; intent: WizardViewIntent;
  readyAtMs: number } | { type: 'pulse'; vector: readonly [number, number];
  jumping: boolean; readyAtMs: number }

export function publicV16CheckpointDue(status: ReturnType<Runtime['status']>,
  pendingBoundary: boolean, idleWorks = false): boolean {
  return (status.gate === 'open' || status.gate === 'cap-paused') && status.pendingFrames > 0
    && (idleWorks || pendingBoundary || status.checkpointRecommended || status.checkpointRequired)
}

export async function publicV16CheckpointWithWorkMode(runtime: Runtime,
  mode: { current: boolean }) {
  const result = await runtime.save()
  if (result.status === 'blocked') mode.current = false
  return result
}

/** Idle Works may checkpoint, while queued movement and airborne frames continue. */
export function publicV16IdleWorksSampler(active: ReturnType<Runtime['view']>, modeActive: boolean,
  controls: { held: readonly [number, number]; tap: readonly [number, number] | null;
    jump: boolean; sampler: ReturnType<typeof createTimedMovementSampler> }, now: number) {
  if (!modeActive || active.pendingBoundary || active.player.verticalVelocity !== 0
    || controls.held.some(Boolean) || controls.tap || controls.jump
    || controls.sampler.vector.some(Boolean)
    || controls.sampler.changes.some(({ vector }) => vector.some(Boolean))) return null
  return createTimedMovementSampler(now)
}

/** The selected preview is advisory; the matching checked writer rechecks the site. */
export function publicV16WorkRouteForView(view: WizardViewProjection, id: string,
  owner: WorkOwner, seed: string): WorkOwner | null {
  if (!publicV14WorkIntentStillReady(view, id)
    || view.controllerActionsEnabled === false) return null
  if (owner === 'greenway') return resolvePublicV16GreenwaySite(seed, id)
    ? 'greenway' : null
  return id.startsWith('works1:') ? 'streamed' : null
}

/** Only the live v16 Greenway projection can offer the checked magic actions. */
export function publicV16ActionForView(intent: WizardViewIntent,
  view: WizardViewProjection, owner: WorkOwner): PublicWorldIntent | null {
  if (owner === 'greenway' && view.savedTerrainWorks?.context === 'works3-greenway'
    && view.controllerActionsEnabled === true && !view.unavailableActions) {
    if (intent.type === 'inscription.study' && intent.inscriptionId === 'greenway_waystone'
      && view.inscriptions.some((inscription) => inscription.id === intent.inscriptionId
        && !inscription.studied && Math.hypot(
          inscription.position[0] - view.player.position[0],
          inscription.position[1] - view.player.position[1],
          inscription.position[2] - view.player.position[2]) <= 3)) {
      return { type: 'study_inscription', inscriptionId: intent.inscriptionId }
    }
    if (intent.type === 'spell.cast' && intent.spellId === 'wayfinder_glow'
      && view.learnedSpellIds.includes(intent.spellId)) {
      return { type: 'cast_spell', spellId: intent.spellId }
    }
  }
  return publicV14ActionForView(intent, view)
}

export type PublicV16ControllerProps = PublicV16EntryBindings & Readonly<{ start: PublicV16Start }>

/** The v16 controller receives only an explicitly chosen, checked v16 start. */
export function PublicV16Controller({ start, locks, store }: PublicV16ControllerProps) {
  const runtimeRef = useRef<Runtime | null>(null)
  runtimeRef.current ??= createPublicV16ControllerRuntime(start, {
    frames: (frames, revision, lineage) => commitPublicV16FrameBatch(locks, store,
      frames, revision, lineage),
    action: (intent, revision, lineage) => commitPublicV16GreenwayAction(locks, store,
      intent, revision, lineage),
    greenwayWork: (id, revision, lineage) => commitPublicV16GreenwayWork(locks, store,
      id, revision, lineage),
    work: (id, revision, lineage) => commitPublicV16TerrainWork(locks, store,
      id, revision, lineage),
  })
  const runtime = runtimeRef.current
  const [, redraw] = useState(0)
  const [messages, setMessages] = useState<string[]>([])
  const [walkRequested, setWalkRequested] = useState(false)
  const walkRef = useRef(false)
  const [, setOpenStoreId] = useState<string | null>(null)
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const openRef = useRef<string | null>(null)
  const uiOpenRef = useRef<string | null>(null)
  const selectedRef = useRef<string | null>(null)
  const workMode = useRef(false)
  const workKind = useRef<'bridge' | 'ladder' | 'dig'>('bridge')
  const uiWorkMode = useRef(false)
  const uiWorkKind = useRef<'bridge' | 'ladder' | 'dig'>('bridge')
  const held = useRef<readonly [number, number]>([0, 0])
  const input = useRef(createTimedMovementSampler(performance.now()))
  const lastStep = useRef(input.current.cursorMs)
  const saving = useRef(false)
  const deferred = useRef<DeferredInput[]>([])
  const draining = useRef(false)
  const overflow = useRef(false)
  const landingMovementPaused = useRef(false)
  const tell = (message: string) => setMessages((prior) => [...prior.slice(-2), message])
  const repaint = () => redraw((version) => version + 1)
  const enqueue = (item: DeferredInput) => {
    // A queued click still needs one fixed-step frame to make its boundary runnable.
    if (deferred.current.length >= MAX_DEFERRED_INPUTS - (item.type === 'frame' ? 0 : 1)) {
      overflow.current = true; repaint(); return false
    }
    deferred.current.push(item)
    return true
  }
  const project = (ui = true, selected = selectedRef.current,
    open = ui ? uiOpenRef.current : openRef.current,
    walk = walkRef.current, active = runtime.view(), gate = runtime.status()) => {
    if (gate.gate === 'blocked') {
      workMode.current = false; uiWorkMode.current = false
    }
    const interactive = gate.gate !== 'blocked'
    const mode = ui ? uiWorkMode.current : workMode.current
    const kind = ui ? uiWorkKind.current : workKind.current
    return { ...publicWorldV16ViewProjection(runtime.preview(), active, messages,
      selected, open, walk, { kind, bodyYaw: active.player.yaw,
        modeActive: mode && interactive,
        actionsEnabled: interactive }),
    controllerActionsEnabled: interactive }
  }
  const status = runtime.status()
  const active = runtime.view()
  const projection = project(true, selectedSiteId, uiOpenRef.current,
    walkRequested, active, status)

  const save = async (idleWorks = false) => {
    if (saving.current || !publicV16CheckpointDue(runtime.status(),
      runtime.view().pendingBoundary, idleWorks)) return
    saving.current = true; repaint()
    const result = await publicV16CheckpointWithWorkMode(runtime, workMode)
    saving.current = false
    if (result.status === 'saved') tell('V16 progress saved on this device.')
    else if (result.status === 'blocked') {
      held.current = [0, 0]; deferred.current = []
      uiWorkMode.current = false; uiOpenRef.current = null
      tell(`Save blocked: ${result.reason}.`)
    }
    repaint()
    if (runtime.status().gate === 'open') void drain()
  }
  const action = async (intent: PublicWorldIntent | { id: string; route: WorkOwner }) => {
    if (runtime.status().gate !== 'open') return
    if ('id' in intent) {
      workMode.current = false
      if (!deferred.current.some((item) => item.type === 'intent'
        && item.intent.type === 'saved-work.mode')) uiWorkMode.current = false
    }
    repaint()
    const result = 'id' in intent
      ? await (intent.route === 'greenway' ? runtime.buildGreenwayWork(intent.id)
        : runtime.buildWork(intent.id)) : await runtime.action(intent)
    if (result.status === 'saved') {
      if (result.resetWalkRequested) { walkRef.current = false; setWalkRequested(false) }
      tell(result.workEvent ? `${result.workEvent.type === 'terrain_work_dug' ? 'Dig' : 'Build'} saved: ${result.workEvent.id}. ${result.workEvent.logsSpent} logs spent, ${result.workEvent.stoneGained} stone gained, ${result.workEvent.xp} XP.`
        : result.events.at(-1)?.type.replaceAll('_', ' ') ?? 'Action saved.')
    } else if (result.status === 'rejected') {
      tell(`Action rejected: ${result.reason}. Check the current site and equipment.`)
    } else if (result.status === 'deferred-airborne') tell('Land before interacting.')
    else if (result.status === 'blocked') {
      held.current = [0, 0]; deferred.current = []
      uiWorkMode.current = false; uiOpenRef.current = null
      tell(`Save blocked: ${result.reason}.`)
    }
    repaint()
    if (runtime.status().gate === 'open') void drain()
  }
  const frame = (vector: readonly [number, number], jumping: boolean, walking: boolean) => {
    if (runtime.status().gate !== 'open' && runtime.status().gate !== 'checkpointing') return
    const player = runtime.view().player
    const gait = publicV11Gait(player.equipment.feet, walking)
    const intents = jumping ? [{ type: 'jump' as const }]
      : publicV14MovementIntents(player.yaw, vector, gait.metersPerStep)
    const result = runtime.advanceFrame(intents, walking)
    if (result.rejections.length) tell(result.rejections.at(-1)!.message)
    else if (result.events.length) tell(result.events.at(-1)!.type.replaceAll('_', ' '))
    repaint()
  }
  const frameRef = useRef(frame)
  frameRef.current = frame
  const saveRef = useRef(save)
  saveRef.current = save
  const dispatchFrame = (item: Extract<DeferredInput, { type: 'frame' }>) => {
    const status = runtime.status()
    if ((status.gate === 'open' || status.gate === 'checkpointing')
      && !deferred.current.length && !draining.current
      && status.pendingFrames < MOVE_RESERVE_AT) {
      frameRef.current(item.vector, item.jumping, item.walking)
      return true
    }
    return enqueue(item)
  }
  const nextBoundary = (atMs: number) => lastStep.current + STEP_MS * Math.max(1,
    Math.ceil((atMs - lastStep.current) / STEP_MS))
  const queueSampledFrame = (sampled: readonly [number, number], endMs: number) => {
    let index = 0
    while (index < deferred.current.length) {
      const item = deferred.current[index]
      if (item.type === 'frame' || item.type === 'intent' && item.readyAtMs < endMs) {
        index++; continue
      }
      break
    }
    const item = deferred.current[index]
    const pulse = item?.type === 'pulse' && item.readyAtMs <= endMs
      ? deferred.current.splice(index, 1)[0] as Extract<DeferredInput, { type: 'pulse' }>
      : null
    const jumping = pulse?.jumping ?? false
    const vector: readonly [number, number] = pulse && !jumping
      ? [pulse.vector[0] || sampled[0], pulse.vector[1] || sampled[1]] : sampled
    const frameItem: Extract<DeferredInput, { type: 'frame' }> = {
      type: 'frame', vector, jumping, walking: walkRef.current }
    if (!deferred.current.length) dispatchFrame(frameItem)
    else deferred.current.splice(index, 0, frameItem)
    return frameItem
  }
  const drain = async () => {
    if (draining.current || runtime.status().gate !== 'open') return
    draining.current = true
    try {
      while (deferred.current.length && runtime.status().gate === 'open') {
        if (runtime.status().pendingFrames >= MOVE_RESERVE_AT) {
          if (runtime.view().player.verticalVelocity === 0) void saveRef.current()
          break
        }
        const next = deferred.current[0]
        if (next.type === 'pulse' || next.type === 'intent'
          && next.readyAtMs > lastStep.current) break
        deferred.current.shift()
        if (next.type === 'frame') frameRef.current(next.vector, next.jumping, walkRef.current)
        else if (next.type === 'intent') await handleIntent(next.intent)
      }
    } finally {
      draining.current = false
      repaint()
    }
  }
  const drainRef = useRef(drain)
  drainRef.current = drain
  useEffect(() => {
    const timer = window.setInterval(() => {
      const gate = runtime.status().gate
      if (gate === 'blocked') return
      if (gate === 'cap-paused') void saveRef.current()
      const now = performance.now()
      const due = Math.min(MAX_CATCH_UP, Math.floor((now - lastStep.current) / STEP_MS))
      const idle = gate === 'open' && runtime.status().pendingFrames < MOVE_RESERVE_AT
        && !deferred.current.length && due <= 1 && publicV16IdleWorksSampler(runtime.view(), workMode.current,
        { held: held.current, tap: null, jump: false, sampler: input.current }, now)
      if (idle) {
        input.current = idle; lastStep.current = now
        if (runtime.status().pendingFrames) void saveRef.current(true)
        return
      }
      for (let index = 0; index < due; index++) {
        const status = runtime.status()
        if (status.gate === 'blocked') break
        const airborne = runtime.view().player.verticalVelocity !== 0
        const landing = (status.gate === 'open' || status.gate === 'checkpointing')
          && status.pendingFrames >= MOVE_RESERVE_AT
          && status.pendingFrames < FRAME_CAP && airborne
        if (!landing && deferred.current.length >= MAX_DEFERRED_INPUTS) {
          overflow.current = true; repaint(); break
        }
        if (status.pendingFrames >= MOVE_RESERVE_AT && !airborne
          && (status.gate === 'open' || status.gate === 'cap-paused')) void saveRef.current()
        lastStep.current += STEP_MS
        const sampled = sampleTimedMovement(input.current, lastStep.current)
        if (landing) {
          if (sampled.some(Boolean)) { landingMovementPaused.current = true; repaint() }
          frameRef.current([0, 0], false, walkRef.current)
        } else queueSampledFrame(sampled, lastStep.current)
        if (runtime.view().player.verticalVelocity === 0 && publicV16CheckpointDue(
          runtime.status(), runtime.view().pendingBoundary)) {
          void saveRef.current()
        }
      }
      if (deferred.current.length && runtime.status().gate === 'open') void drainRef.current()
    }, STEP_MS)
    return () => window.clearInterval(timer)
  }, [runtime])
  const onIntent = (intent: WizardViewIntent) => {
    const gate = runtime.status().gate
    if (gate === 'blocked') return
    if (intent.type === 'movement') {
      held.current = intent.vector
      const before = input.current.discardedBeforeMs
      recordTimedMovement(input.current, intent.atMs ?? performance.now(), intent.vector)
      if (input.current.discardedBeforeMs > before) { overflow.current = true; repaint() }
      return
    }
    const atMs = intent.type === 'movement.tap' ? intent.atMs ?? performance.now()
      : performance.now()
    const readyAtMs = nextBoundary(atMs)
    if (intent.type === 'movement.tap') {
      enqueue({ type: 'pulse', vector: intent.vector, jumping: false, readyAtMs }); return
    }
    if (intent.type === 'jump') {
      enqueue({ type: 'pulse', vector: [0, 0], jumping: true, readyAtMs }); return
    }
    const updateUi = () => {
      if (intent.type === 'saved-work.mode') uiWorkMode.current = intent.active
      else if (intent.type === 'saved-work.kind' && uiWorkMode.current)
        uiWorkKind.current = intent.kind
      else if (intent.type === 'store.close') uiOpenRef.current = null
      else if (intent.type === 'store.open' && project().nearbyStoreId === intent.storeId)
        uiOpenRef.current = intent.storeId
      else if (intent.type === 'interact') {
        const visible = project()
        if (visible.nearbyInteraction?.kind === 'store' && visible.nearbyStoreId)
          uiOpenRef.current = visible.nearbyStoreId
      }
      repaint()
    }
    if (gate === 'open' && !deferred.current.length && !draining.current
      && !held.current.some(Boolean) && !input.current.vector.some(Boolean)
      && !input.current.changes.length
      && !(runtime.status().pendingFrames >= MOVE_RESERVE_AT
        && runtime.view().player.verticalVelocity !== 0)) {
      updateUi(); void handleIntent(intent); return
    }
    if (enqueue({ type: 'intent', intent, readyAtMs })) updateUi()
  }
  const handleIntent = (intent: WizardViewIntent): Promise<void> | void => {
    if (intent.type === 'gait.toggle') {
      if (project().gait?.canRun) {
        walkRef.current = !walkRef.current
        setWalkRequested(walkRef.current)
      }
      return
    }
    if (intent.type === 'saved-work.mode') {
      workMode.current = intent.active; repaint(); return
    }
    if (intent.type === 'saved-work.kind') {
      if (workMode.current) { workKind.current = intent.kind; repaint() }
      return
    }
    const current = project(false)
    if (intent.type === 'saved-work.confirm') {
      const route = publicV16WorkRouteForView(current, intent.id,
        runtime.view().movementOwner, runtime.preview().state.seed)
      if (route) return action({ id: intent.id, route })
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
      const selected = current.buildSites.some((site) => site.id === intent.siteId
        && site.discovered) ? intent.siteId : null
      selectedRef.current = selected; setSelectedSiteId(selected); return
    }
    const mapped = publicV16ActionForView(intent, current, runtime.view().movementOwner)
    if (mapped) return action(mapped)
    else tell('This action is unavailable in the v16 world.')
  }
  return <main data-public-v16="true" data-owner={active.movementOwner}>
    {(status.pendingFrames >= MOVE_RESERVE_AT || deferred.current.length >= MAX_DEFERRED_INPUTS)
      && status.gate !== 'blocked' && <p role="status">Checkpoint backpressure: new movement waits for the checked save; landing frames are neutral ({status.pendingFrames}/128 saved frames, {deferred.current.length}/128 queued inputs).</p>}
    {landingMovementPaused.current && status.gate !== 'blocked'
      && <p role="alert">Movement was paused while landing at checkpoint reserve; held movement resumes on later available frames.</p>}
    {overflow.current && status.gate !== 'blocked' && <p role="alert">Input backpressure: the buffer reached capacity. New clicks were refused and rapid movement changes may need to be retried after this write.</p>}
    {status.gate === 'blocked' && <p role="alert" style={{ margin: 0, padding: 12,
      background: '#6b1721', color: '#fff', font: '600 15px/1.4 system-ui' }}>Save blocked ({status.blockedReason}).
      Movement is frozen. Keep this tab open; unsaved progress has no recovery export yet.</p>}
    <WizardSurface projection={projection} onIntent={onIntent} />
  </main>
}
