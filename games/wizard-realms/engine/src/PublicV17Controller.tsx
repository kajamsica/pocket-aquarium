import { useEffect, useRef, useState } from 'react'
import { publicV14ActionForView, publicV14MovementIntents,
  publicV14WorkIntentStillReady } from './PublicV14Controller'
import { createPublicV17InputScheduler, publicV17StepDecision,
  publicV17UiOnlyIntent, PUBLIC_V17_MAX_QUEUED_COMMANDS,
  createPublicV17InputTrace, publicV17InputTraceEnabled,
  registerPublicV17SaveTrace } from './PublicV17InputScheduler'
import { createPublicV17ControllerRuntime } from './PublicV17ControllerRuntime'
import { publicWorldV17ViewProjection } from './PublicV17WorldView'
import type { PublicV17EntryBindings } from './PublicV17Entry'
import { publicV11Gait } from './domain/publicWorldGait'
import { commitPublicV17FrameBatch, commitPublicV17GreenwayAction,
  commitPublicV17GreenwayWork, commitPublicV17TerrainWork } from './domain/publicWorldV17Flow'
import type { PublicV17Start } from './domain/publicWorldV17Flow'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import type { TerrainWorkSite } from './domain/terrainWorks'
import type { PublicWorldIntent } from './domain/publicWorldRuntime'
import type { WizardViewIntent, WizardViewProjection } from './view/contracts'
import { createTimedMovementSampler, recordTimedMovement,
  sampleTimedMovement } from './view/timedInput'
import { WizardSurface } from './view/WizardSurface'

const STEP_MS = 50
const MAX_CATCH_UP = 12
const MOVE_RESERVE_AT = 96
const FRAME_CAP = 128
type Runtime = ReturnType<typeof createPublicV17ControllerRuntime>
type WorkOwner = 'greenway' | 'streamed'

export function publicV17CheckpointDue(status: ReturnType<Runtime['status']>,
  pendingBoundary: boolean, idleWorks = false): boolean {
  return (status.gate === 'open' || status.gate === 'cap-paused') && status.pendingFrames > 0
    && (idleWorks || pendingBoundary || status.checkpointRecommended || status.checkpointRequired)
}

export async function publicV17CheckpointWithWorkMode(runtime: Runtime,
  mode: { current: boolean }) {
  const result = await runtime.save()
  if (result.status === 'blocked') mode.current = false
  return result
}

export function publicV17IdleWorksSampler(active: ReturnType<Runtime['view']>, modeActive: boolean,
  controls: { held: readonly [number, number]; tap: readonly [number, number] | null;
    jump: boolean; sampler: ReturnType<typeof createTimedMovementSampler> }, now: number) {
  if (!modeActive || active.pendingBoundary || active.player.verticalVelocity !== 0
    || controls.held.some(Boolean) || controls.tap || controls.jump
    || controls.sampler.vector.some(Boolean)
    || controls.sampler.changes.some(({ vector }) => vector.some(Boolean))) return null
  return createTimedMovementSampler(now)
}

/** Reticle ray intersects the relevant obstacle plane; only X is preview input. */
export function publicV17ReticleAimX(position: { x: number; z: number },
  yaw: number, kind: 'bridge' | 'ladder' | 'dig'): number | null {
  if (kind === 'dig' || ![position.x, position.z, yaw].every(Number.isFinite)) return null
  const faceZ = -Math.cos(yaw)
  if (Math.abs(faceZ) < 1e-6) return null
  const planeZ = kind === 'bridge' ? 8 : -5.35
  const distance = (planeZ - position.z) / faceZ
  return distance >= 0 && distance <= 32 ? position.x - Math.sin(yaw) * distance : null
}

/** Start a work preview on a discovered site, not an unsupported reticle lane. */
export function publicV17SuggestedWorkAimX(view: WizardViewProjection,
  kind: 'bridge' | 'ladder', playerX: number): number | null {
  const sites = view.savedTerrainWorks?.suggestedSites?.filter((site): site is Exclude<
    TerrainWorkSite, { kind: 'dig' }> => site.kind === kind) ?? []
  const nearest = sites.reduce<(typeof sites)[number] | null>((best, site) =>
    !best || Math.abs(site.from.x - playerX) < Math.abs(best.from.x - playerX)
      || Math.abs(site.from.x - playerX) === Math.abs(best.from.x - playerX)
        && site.id.localeCompare(best.id) < 0 ? site : best, null)
  return nearest?.from.x ?? null
}

/** Only the current ready selected ghost may reach the versioned checked writer. */
export function publicV17WorkRouteForView(view: WizardViewProjection, id: string,
  owner: WorkOwner, seed: string): WorkOwner | null {
  if (!publicV14WorkIntentStillReady(view, id)
    || view.controllerActionsEnabled === false) return null
  if (owner === 'greenway') return resolvePublicV17GreenwaySite(seed, id)
    ? 'greenway' : null
  return id.startsWith('works1:') ? 'streamed' : null
}

/** The v17 Greenway waystone retains its checked Study and Cast mapping. */
export function publicV17ActionForView(intent: WizardViewIntent,
  view: WizardViewProjection, owner: WorkOwner): PublicWorldIntent | null {
  if (owner === 'greenway' && view.savedTerrainWorks?.context === 'works4-greenway'
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

export type PublicV17ControllerProps = PublicV17EntryBindings & Readonly<{ start: PublicV17Start }>

/** A chosen, checked v17 root is the only source of playable state. */
export function PublicV17Controller({ start, locks, store }: PublicV17ControllerProps) {
  const traceRef = useRef<ReturnType<typeof createPublicV17InputTrace> | null | undefined>(undefined)
  if (traceRef.current === undefined) traceRef.current = publicV17InputTraceEnabled(
    typeof window === 'undefined' ? '' : window.location?.hostname ?? '',
    typeof window === 'undefined' ? '' : window.location?.search ?? '')
    ? createPublicV17InputTrace() : null
  const trace = traceRef.current
  const [traceJson, setTraceJson] = useState('')
  const tracedLocks = trace ? { request: ((name, options, callback) => {
    trace.record('save.lock.request', {})
    return locks.request(name, options, async () => {
      trace.record('save.lock.acquired', {})
      try { return await callback() }
      finally { trace.record('save.lock.finished', {}) }
    })
  }) as typeof locks.request } : locks
  const tracedStore = trace ? { ...store,
    readChecked: async () => {
      trace.record('save.read.start', {})
      const result = await store.readChecked(tracedStore)
      trace.record('save.read.finished', { status: result.status })
      return result
    },
    commit: (async (...args) => {
      trace.record('save.commit.start', {})
      const result = await store.commit(args[0], args[1], args[2], args[3], args[4], tracedStore)
      trace.record('save.commit.finished', { result })
      return result
    }) as typeof store.commit,
  } : store
  const runtimeRef = useRef<Runtime | null>(null)
  runtimeRef.current ??= createPublicV17ControllerRuntime(start, {
    frames: (frames, revision, lineage) => commitPublicV17FrameBatch(tracedLocks, tracedStore,
      frames, revision, lineage),
    action: (intent, revision, lineage) => commitPublicV17GreenwayAction(tracedLocks, tracedStore,
      intent, revision, lineage),
    greenwayWork: (id, revision, lineage) => commitPublicV17GreenwayWork(tracedLocks, tracedStore,
      id, revision, lineage),
    work: (id, revision, lineage) => commitPublicV17TerrainWork(tracedLocks, tracedStore,
      id, revision, lineage),
  })
  const runtime = runtimeRef.current
  useEffect(() => {
    if (!trace) return
    // The runtime retains the initial store wrapper. Registration follows its lifetime.
    const unregisterWrapper = registerPublicV17SaveTrace(tracedStore, trace)
    return unregisterWrapper
  }, [runtime])
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
  const aimOverride = useRef<number | null>(null)
  const uiWorkMode = useRef(false)
  const uiWorkKind = useRef<'bridge' | 'ladder' | 'dig'>('bridge')
  const uiAimOverride = useRef<number | null>(null)
  const held = useRef<readonly [number, number]>([0, 0])
  const input = useRef(createTimedMovementSampler(performance.now()))
  const lastStep = useRef(input.current.cursorMs)
  const saving = useRef(false)
  const deferred = useRef(createPublicV17InputScheduler())
  const draining = useRef(false)
  const overflow = useRef({ clicks: false, steps: false, movement: false })
  const airborneRejected = useRef<'new' | 'queued' | null>(null)
  const landingPulseRejected = useRef(false)
  const landingInvariant = useRef(false)
  const landingMovementPaused = useRef(false)
  const checkpointPaused = useRef(false)
  const tell = (message: string) => setMessages((prior) => [...prior.slice(-2), message])
  const repaint = () => redraw((version) => version + 1)
  const enqueueIntent = (intent: WizardViewIntent, boundaryRequired: boolean) => {
    if (deferred.current.enqueueIntent(intent, boundaryRequired)) return true
    if (deferred.current.queuedCommands() >= PUBLIC_V17_MAX_QUEUED_COMMANDS)
      overflow.current.clicks = true
    else overflow.current.steps = true
    repaint(); return false
  }
  const enqueuePulse = (vector: readonly [number, number], jumping: boolean,
    clearCancellable = false) => {
    if (deferred.current.enqueuePulse(vector, jumping, clearCancellable)) { repaint(); return true }
    if (deferred.current.queuedCommands() >= PUBLIC_V17_MAX_QUEUED_COMMANDS)
      overflow.current.clicks = true
    else overflow.current.steps = true
    repaint(); return false
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
    const aimX = (ui ? uiAimOverride.current : aimOverride.current)
      ?? publicV17ReticleAimX(active.player.position, active.player.yaw, kind)
    return { ...publicWorldV17ViewProjection(runtime.preview(), active, messages,
      selected, open, walk, { kind, bodyYaw: active.player.yaw,
        aimX, modeActive: mode && interactive,
        actionsEnabled: interactive }),
    controllerActionsEnabled: interactive }
  }
  const status = runtime.status()
  const active = runtime.view()
  const projection = project(true, selectedSiteId, uiOpenRef.current,
    walkRequested, active, status)

  const save = async (idleWorks = false) => {
    if (saving.current || !publicV17CheckpointDue(runtime.status(),
      runtime.view().pendingBoundary, idleWorks)) return
    saving.current = true; repaint()
    if (trace) trace.record('save.start', runtime.status())
    const result = await publicV17CheckpointWithWorkMode(runtime, workMode)
    if (trace) trace.record('save.finished', { result: result.status, ...runtime.status() })
    saving.current = false
    if (result.status === 'saved') tell('V17 progress saved on this device.')
    else if (result.status === 'blocked') {
      held.current = [0, 0]
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
      if (!deferred.current.tokens.some((item) => item.type === 'intent'
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
      held.current = [0, 0]
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
    if (landingMovementPaused.current && !result.rejections.length
      && intents.some((intent) => intent.type === 'move')
      && runtime.status().gate === 'open'
      && runtime.status().pendingFrames < MOVE_RESERVE_AT
      && runtime.view().player.verticalVelocity === 0) landingMovementPaused.current = false
    if (result.rejections.length) tell(result.rejections.at(-1)!.message)
    else if (result.events.length) tell(result.events.at(-1)!.type.replaceAll('_', ' '))
    repaint()
  }
  const frameRef = useRef(frame)
  frameRef.current = frame
  const saveRef = useRef(save)
  saveRef.current = save
  const drain = async () => {
    if (draining.current) return
    draining.current = true
    try {
      while (deferred.current.peek()) {
        const status = runtime.status(), next = deferred.current.peek()!
        if (status.gate === 'blocked' || status.gate === 'barrier'
          || status.gate === 'cap-paused') break
        if (next.type === 'step') {
          if (!next.frame || status.pendingFrames >= FRAME_CAP) break
          const airborne = runtime.view().player.verticalVelocity !== 0
          if (airborne && status.pendingFrames >= MOVE_RESERVE_AT
            && (next.frame.jumping || next.frame.vector.some(Boolean))) {
            if (next.pulse) landingPulseRejected.current = true
            else landingMovementPaused.current = true
            next.frame = { vector: [0, 0], jumping: false }
            repaint()
          }
          if (status.pendingFrames >= MOVE_RESERVE_AT
            && (!airborne || next.frame.jumping || next.frame.vector.some(Boolean))) {
            if (!airborne && status.gate === 'open') void saveRef.current()
            break
          }
          const before = trace ? runtime.poseSnapshot() : null
          frameRef.current(next.frame.vector, next.frame.jumping, walkRef.current)
          if (trace) trace.record('step.applied', { id: next.id, frame: next.frame,
            before, after: runtime.poseSnapshot(), ...runtime.status() })
          if (runtime.status().gate === 'blocked') break
          deferred.current.shift()
          if (runtime.view().player.verticalVelocity === 0 && publicV17CheckpointDue(
            runtime.status(), runtime.view().pendingBoundary)) void saveRef.current()
        } else {
          if (runtime.view().player.verticalVelocity !== 0 && !publicV17UiOnlyIntent(next.intent)) {
            airborneRejected.current = 'queued'; repaint()
            deferred.current.shift()
            continue
          }
          if (status.gate !== 'open'
            && !(status.gate === 'checkpointing' && publicV17UiOnlyIntent(next.intent))) break
          const handled = handleIntent(next.intent)
          if (handled) await handled
          if (runtime.status().gate === 'blocked') break
          deferred.current.shift()
        }
      }
    } finally {
      draining.current = false
      if (!deferred.current.tokens.length && runtime.status().gate === 'open') {
        overflow.current.clicks = false; overflow.current.steps = false
        if (!input.current.changes.length) overflow.current.movement = false
      }
      repaint()
    }
  }
  const drainRef = useRef(drain)
  drainRef.current = drain
  const stepDecision = () => {
    const status = runtime.status(), head = deferred.current.peek()
    return publicV17StepDecision({ gate: status.gate,
      airborne: runtime.view().player.verticalVelocity !== 0,
      pendingFrames: status.pendingFrames,
      queuedSteps: deferred.current.queuedSteps(),
      queuedCommands: deferred.current.queuedCommands(),
      head: !head ? 'none' : head.type === 'step'
        ? head.frame ? 'ready-step' : 'virtual-step'
        : publicV17UiOnlyIntent(head.intent) ? 'ui-only' : 'checked-action',
      canAcceptStep: deferred.current.canAcceptStep() })
  }
  useEffect(() => {
    const timer = window.setInterval(() => {
      void drainRef.current()
      if ((airborneRejected.current || landingPulseRejected.current)
        && runtime.view().player.verticalVelocity === 0) {
        airborneRejected.current = null; landingPulseRejected.current = false; repaint()
      }
      const now = performance.now()
      const decision = stepDecision()
      if (trace) trace.record('callback', { nowMs: now, lastStepMs: lastStep.current,
        decision, held: held.current, samplerCursorMs: input.current.cursorMs,
        ...runtime.status(), queuedSteps: deferred.current.queuedSteps(),
        queuedCommands: deferred.current.queuedCommands() })
      if (decision === 'blocked') return
      if (decision === 'invariant') {
        if (!landingInvariant.current) { landingInvariant.current = true; repaint() }
        return
      }
      if (runtime.status().gate === 'cap-paused'
        || decision === 'pause' && runtime.status().gate === 'open') void saveRef.current()
      if (decision === 'barrier' || decision === 'pause' || decision === 'drain-first') {
        if (!checkpointPaused.current) { checkpointPaused.current = true; repaint() }
        return
      }
      if (checkpointPaused.current) {
        if (trace) trace.record('sampler.recovery', { nowMs: now, held: held.current,
          priorCursorMs: input.current.cursorMs, priorLastStepMs: lastStep.current })
        checkpointPaused.current = false
        input.current = createTimedMovementSampler(now)
        recordTimedMovement(input.current, now, held.current)
        lastStep.current = now
        repaint()
        if (runtime.status().gate === 'open') void drainRef.current()
        return
      }
      if ((overflow.current.clicks || overflow.current.steps || overflow.current.movement)
        && runtime.status().gate === 'open' && !deferred.current.tokens.length
        && !input.current.changes.length
        && runtime.status().pendingFrames < MOVE_RESERVE_AT) {
        overflow.current.clicks = false; overflow.current.steps = false
        overflow.current.movement = false; repaint()
      }
      const due = Math.min(MAX_CATCH_UP, Math.floor((now - lastStep.current) / STEP_MS))
      if (trace) trace.record('callback.due', { nowMs: now, due })
      const beforeSteps = trace ? lastStep.current : 0
      const idle = runtime.status().gate === 'open'
        && runtime.status().pendingFrames < MOVE_RESERVE_AT
        && !deferred.current.tokens.length && due <= 1 && publicV17IdleWorksSampler(runtime.view(), workMode.current,
        { held: held.current, tap: null, jump: false, sampler: input.current }, now)
      if (idle) {
        input.current = idle; lastStep.current = now
        if (runtime.status().pendingFrames) void saveRef.current(true)
        return
      }
      for (let index = 0; index < due; index++) {
        void drainRef.current()
        const nextDecision = stepDecision()
        if (nextDecision === 'invariant') {
          if (!landingInvariant.current) { landingInvariant.current = true; repaint() }
          break
        }
        if (nextDecision !== 'sample' && nextDecision !== 'neutral') {
          if (nextDecision === 'pause' && runtime.status().gate === 'open')
            void saveRef.current()
          if (nextDecision !== 'blocked' && !checkpointPaused.current) {
            checkpointPaused.current = true; repaint()
          }
          break
        }
        const stepAt = lastStep.current + STEP_MS
        const neutral = nextDecision === 'neutral'
        const sampler = neutral ? null : structuredClone(input.current)
        const sampled = neutral ? [0, 0] as const : sampleTimedMovement(sampler!, stepAt)
        const virtual = deferred.current.tokens.find((token): token is Extract<
          typeof token, { type: 'step' }> => token.type === 'step' && token.frame === null)
        if (!deferred.current.acceptStep(sampled, neutral)) {
          if (!checkpointPaused.current) { checkpointPaused.current = true; repaint() }
          break
        }
        lastStep.current = stepAt
        if (trace) {
          const accepted = virtual ?? deferred.current.tokens.at(-1)
          trace.record('step.sampled', { stepAtMs: stepAt, sampled, neutral,
            id: accepted?.type === 'step' ? accepted.id : null,
            frame: accepted?.type === 'step' ? accepted.frame : null })
        }
        if (neutral) {
          if (virtual?.pulse) landingPulseRejected.current = true
          if (held.current.some(Boolean) || input.current.changes.length)
            landingMovementPaused.current = true
          input.current = createTimedMovementSampler(stepAt)
          recordTimedMovement(input.current, stepAt, held.current)
        } else input.current = sampler!
        void drainRef.current()
        if (runtime.view().player.verticalVelocity === 0 && publicV17CheckpointDue(
          runtime.status(), runtime.view().pendingBoundary)) {
          void saveRef.current()
        }
      }
      if (deferred.current.tokens.length) void drainRef.current()
      if (trace) trace.record('callback.finished', {
        sampledFrames: (lastStep.current - beforeSteps) / STEP_MS,
        lastStepMs: lastStep.current })
    }, STEP_MS)
    return () => window.clearInterval(timer)
  }, [runtime])
  const onIntent = (intent: WizardViewIntent) => {
    const gate = runtime.status().gate
    if (trace) trace.record('controller.receive', { type: intent.type,
      ...('vector' in intent ? { vector: intent.vector } : {}),
      ...('atMs' in intent ? { eventAtMs: intent.atMs } : {}),
      held: held.current, paused: checkpointPaused.current,
      ...runtime.status(), queuedSteps: deferred.current.queuedSteps(),
      queuedCommands: deferred.current.queuedCommands() })
    if (gate === 'blocked') return
    if (intent.type === 'movement') {
      const prior = held.current
      const paused = checkpointPaused.current || gate === 'barrier' || gate === 'cap-paused'
        || runtime.status().pendingFrames >= MOVE_RESERVE_AT
          && runtime.view().player.verticalVelocity === 0
      held.current = intent.vector
      if (!intent.vector.some(Boolean) && intent.atMs === undefined) {
        deferred.current.cancelUnreadyPulses()
        repaint()
      }
      if (paused) {
        // Preserve one deliberate W/S press; paused wall time is never replayed.
        if (runtime.view().player.verticalVelocity === 0
          && intent.vector[1] && intent.vector[1] !== prior[1])
          enqueuePulse([0, intent.vector[1]], false, true)
        return
      }
      const before = input.current.discardedBeforeMs
      const firstChange = input.current.changes[0]
      recordTimedMovement(input.current, intent.atMs ?? performance.now(), intent.vector)
      if (input.current.discardedBeforeMs > before
        || firstChange && firstChange !== input.current.changes[0]) {
        overflow.current.movement = true; repaint()
      }
      return
    }
    if (intent.type === 'movement.tap') {
      if (runtime.view().player.verticalVelocity !== 0) {
        airborneRejected.current = 'new'; repaint(); return
      }
      enqueuePulse(intent.vector, false); return
    }
    if (intent.type === 'jump') {
      if (runtime.view().player.verticalVelocity !== 0) {
        airborneRejected.current = 'new'; repaint(); return
      }
      enqueuePulse([0, 0], true); return
    }
    const updateUi = () => {
      if (intent.type === 'saved-work.mode') {
        uiWorkMode.current = intent.active
        uiAimOverride.current = intent.active && uiWorkKind.current !== 'dig'
          ? publicV17SuggestedWorkAimX(project(), uiWorkKind.current,
            runtime.view().player.position.x) : null
      } else if (intent.type === 'saved-work.kind' && uiWorkMode.current) {
        uiWorkKind.current = intent.kind
        uiAimOverride.current = intent.kind === 'dig' ? null
          : publicV17SuggestedWorkAimX(project(), intent.kind, runtime.view().player.position.x)
      } else if (intent.type === 'saved-work.aim' && uiWorkMode.current
        && (intent.aimX === null || Number.isFinite(intent.aimX))) {
        uiAimOverride.current = intent.aimX
      } else if (intent.type === 'store.close') uiOpenRef.current = null
      else if (intent.type === 'store.open' && project().nearbyStoreId === intent.storeId)
        uiOpenRef.current = intent.storeId
      else if (intent.type === 'interact') {
        const visible = project()
        if (visible.nearbyInteraction?.kind === 'store' && visible.nearbyStoreId)
          uiOpenRef.current = visible.nearbyStoreId
      }
      repaint()
    }
    if (runtime.view().player.verticalVelocity !== 0) {
      if (!publicV17UiOnlyIntent(intent)) {
        airborneRejected.current = 'new'; repaint(); return
      }
    }
    const direct = gate === 'open' && !deferred.current.tokens.length && !draining.current
      && !held.current.some(Boolean) && !input.current.vector.some(Boolean)
      && !input.current.changes.length
      && !(runtime.status().pendingFrames >= MOVE_RESERVE_AT
        && runtime.view().player.verticalVelocity !== 0)
    if (enqueueIntent(intent, !direct)) {
      updateUi()
      if (direct) void drainRef.current()
    }
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
      workMode.current = intent.active
      aimOverride.current = intent.active && workKind.current !== 'dig'
        ? publicV17SuggestedWorkAimX(project(false), workKind.current,
          runtime.view().player.position.x) : null
      repaint(); return
    }
    if (intent.type === 'saved-work.kind') {
      if (workMode.current) {
        workKind.current = intent.kind
        aimOverride.current = intent.kind === 'dig' ? null
          : publicV17SuggestedWorkAimX(project(false), intent.kind, runtime.view().player.position.x)
        repaint()
      }
      return
    }
    if (intent.type === 'saved-work.aim') {
      if (workMode.current && (intent.aimX === null || Number.isFinite(intent.aimX))) {
        aimOverride.current = intent.aimX; repaint()
      }
      return
    }
    const current = project(false)
    if (intent.type === 'saved-work.confirm') {
      const route = publicV17WorkRouteForView(current, intent.id,
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
    const mapped = publicV17ActionForView(intent, current, runtime.view().movementOwner)
    if (mapped) return action(mapped)
    else tell('This action is unavailable in the v17 world.')
  }
  const queuedSteps = deferred.current.queuedSteps()
  const queuedCommands = deferred.current.queuedCommands()
  const hasQueuedInput = queuedSteps + queuedCommands > 0
  const counts = `(${status.pendingFrames}/128 recorded frames, ${queuedSteps} queued steps, ${queuedCommands} queued commands).`
  let checkpointStatus: string | null = null
  if (status.gate === 'barrier') checkpointStatus = `Checked action in progress: world time is paused for its checked write. ${hasQueuedInput ? '' : 'No inputs queued. '}${counts}`
  else if (status.gate === 'cap-paused') checkpointStatus = active.player.verticalVelocity !== 0
    ? `Landing frame cap reached: world time is frozen because landing exceeded 128 recorded frames. ${hasQueuedInput ? '' : 'No inputs queued. '}${counts}`
    : `Frame cap reached: world time is paused until a checked save completes. ${hasQueuedInput ? '' : 'No inputs queued. '}${counts}`
  else if (status.gate !== 'blocked' && active.player.verticalVelocity !== 0
    && status.pendingFrames >= MOVE_RESERVE_AT) checkpointStatus = `Landing reserve: movement frames are neutral until grounded; the checked save follows. ${hasQueuedInput ? '' : 'No inputs queued. '}${counts}`
  else if (status.gate !== 'blocked' && (checkpointPaused.current
    || status.pendingFrames >= MOVE_RESERVE_AT)) {
    if (hasQueuedInput) checkpointStatus = `Checkpoint backpressure: world time is paused for the checked save. Held direction resumes afterward; clicks stay queued in order, and waiting time is not replayed. ${counts}`
    else if (status.gate === 'checkpointing') checkpointStatus = `Checkpoint in progress: world time is paused for the checked save. No inputs queued. ${counts}`
    else if (status.pendingFrames < MOVE_RESERVE_AT) checkpointStatus = `Checkpoint recovery: checked save completed; world time resumes on the next fixed step. No inputs queued. ${counts}`
    else checkpointStatus = `Checkpoint pending: world time is paused while a checked save starts. No inputs queued. ${counts}`
  }
  else if (status.gate === 'checkpointing') checkpointStatus = hasQueuedInput
    ? `Checked save running in background; accepted inputs wait in order. ${counts}`
    : `Checked save running in background; movement remains available. No inputs queued. ${counts}`
  else if (status.gate === 'open' && hasQueuedInput)
    checkpointStatus = `Accepted inputs are draining in order. ${counts}`
  return <main data-public-v17="true" data-owner={active.movementOwner}>
    <p role="status" style={{ boxSizing: 'border-box', height: 42, margin: 0,
      overflowY: 'auto', padding: '4px 8px' }}>{checkpointStatus}</p>
    {landingMovementPaused.current && status.gate !== 'blocked'
      && <p role="alert">Movement was paused while landing at checkpoint reserve; held movement resumes on later available frames.</p>}
    {airborneRejected.current && status.gate !== 'blocked'
      && <p role="alert">{airborneRejected.current === 'new'
        ? 'Land before interacting. Action was not queued.'
        : 'Queued action was rejected while airborne. Land before interacting.'}</p>}
    {landingPulseRejected.current && status.gate !== 'blocked'
      && <p role="alert">Queued tap or jump was rejected during landing; the landing frame stayed neutral.</p>}
    {landingInvariant.current && <p role="alert">Landing could not complete within the 128-frame authority cap. Movement is frozen; keep this tab open for recovery.</p>}
    {overflow.current.clicks && status.gate !== 'blocked' && <p role="alert">Input backpressure: the 128-command buffer reached capacity. New clicks or key commands were refused; retry them after this write.</p>}
    {overflow.current.steps && status.gate !== 'blocked' && <p role="alert">Step backpressure: the 96-step buffer reached capacity. A new input command was refused; retry it after this write.</p>}
    {overflow.current.movement && status.gate !== 'blocked' && <p role="alert">Movement history reached capacity. Some movement changes were not recorded; retry them after this write.</p>}
    {status.gate === 'blocked' && <p role="alert" style={{ margin: 0, padding: 12,
      background: '#6b1721', color: '#fff', font: '600 15px/1.4 system-ui' }}>Save blocked ({status.blockedReason}).
      Movement is frozen. Keep this tab open; unsaved progress has no recovery export yet.</p>}
    <WizardSurface projection={projection} onIntent={onIntent} inputTrace={trace} />
    {trace && <details style={{ position: 'fixed', bottom: 8, left: 8, zIndex: 100,
      background: '#101a17', color: '#fff', maxWidth: 'min(640px, 95vw)', padding: 8 }}
      onToggle={(event) => { if (event.currentTarget.open) setTraceJson(trace.json()) }}>
      <summary>Input trace (local diagnostics)</summary>
      <p>Last 1200 input and simulation records. Refresh after reproducing.</p>
      <button type="button" onClick={() => setTraceJson(trace.json())}>Refresh trace</button>
      <button type="button" onClick={() => {
        const json = trace.json(); setTraceJson(json)
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
        const link = document.createElement('a'); link.href = url
        link.download = 'wizard-input-trace.json'; link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}>Download JSON</button>
      <button type="button" onClick={() => { trace.clear(); setTraceJson(trace.json()) }}>Clear trace</button>
      <pre aria-label="Input trace JSON" style={{ maxHeight: '45vh', overflow: 'auto',
        whiteSpace: 'pre-wrap', fontSize: 11 }}>{traceJson}</pre>
    </details>}
  </main>
}
