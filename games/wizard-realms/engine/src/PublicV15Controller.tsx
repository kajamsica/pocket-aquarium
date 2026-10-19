import { useEffect, useRef, useState } from 'react'
import { publicV14ActionForView, publicV14MovementIntents,
  publicV14WorkIntentStillReady } from './PublicV14Controller'
import { createPublicV15ControllerRuntime } from './PublicV15ControllerRuntime'
import { publicWorldV15ViewProjection } from './PublicV15WorldView'
import { createAtomicV15Store } from './domain/atomicV15Database'
import { publicV11Gait } from './domain/publicWorldGait'
import { commitPublicV15FrameBatch, commitPublicV15GreenwayAction,
  commitPublicV15StarterWork, commitPublicV15TerrainWork } from './domain/publicWorldV15Flow'
import type { PublicV15Start } from './domain/publicWorldV15Flow'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import type { PublicWorldIntent } from './domain/publicWorldRuntime'
import { PUBLIC_V15_STARTER_BRIDGE_ID,
  PUBLIC_V15_STARTER_DIG_ID } from './domain/publicWorldV15StarterSites'
import type { WizardViewIntent, WizardViewProjection } from './view/contracts'
import { createTimedMovementSampler, recordTimedMovement,
  sampleTimedMovement } from './view/timedInput'
import { WizardSurface } from './view/WizardSurface'

const STEP_MS = 50
const MAX_CATCH_UP = 12
type Runtime = ReturnType<typeof createPublicV15ControllerRuntime>
type WorkOwner = 'greenway' | 'streamed'

export function publicV15CheckpointDue(status: ReturnType<Runtime['status']>,
  pendingBoundary: boolean, idleWorks = false): boolean {
  return (status.gate === 'open' || status.gate === 'cap-paused') && status.pendingFrames > 0
    && (idleWorks || pendingBoundary || status.checkpointRecommended || status.checkpointRequired)
}

export async function publicV15CheckpointWithWorkMode(runtime: Runtime,
  mode: { current: boolean }) {
  const result = await runtime.save()
  if (result.status === 'blocked') mode.current = false
  return result
}

/** Works may idle on either owner; queued taps and airborne landing frames still run. */
export function publicV15IdleWorksSampler(active: ReturnType<Runtime['view']>, modeActive: boolean,
  controls: { held: readonly [number, number]; tap: readonly [number, number] | null;
    jump: boolean; sampler: ReturnType<typeof createTimedMovementSampler> }, now: number) {
  if (!modeActive || active.pendingBoundary || active.player.verticalVelocity !== 0
    || controls.held.some(Boolean) || controls.tap || controls.jump
    || controls.sampler.vector.some(Boolean)
    || controls.sampler.changes.some(({ vector }) => vector.some(Boolean))) return null
  return createTimedMovementSampler(now)
}

/** The selected preview is advisory; the owner-specific checked writer proves the work again. */
export function publicV15WorkRouteForView(view: WizardViewProjection, id: string,
  owner: WorkOwner): 'starter' | 'streamed' | null {
  if (!publicV14WorkIntentStillReady(view, id)
    || view.controllerActionsEnabled === false) return null
  if (owner === 'greenway') return id === PUBLIC_V15_STARTER_BRIDGE_ID
    || id === PUBLIC_V15_STARTER_DIG_ID ? 'starter' : null
  return id.startsWith('works1:') ? 'streamed' : null
}

export type PublicV15ControllerProps = Readonly<{
  start: PublicV15Start
  locks: PublicV7LockProvider
  store: ReturnType<typeof createAtomicV15Store>
}>

/** Native v15 controller. The opt-in route remains on its safety gate until acceptance. */
export function PublicV15Controller({ start, locks, store }: PublicV15ControllerProps) {
  const runtimeRef = useRef<Runtime | null>(null)
  runtimeRef.current ??= createPublicV15ControllerRuntime(start, {
    frames: (frames, revision, lineage) => commitPublicV15FrameBatch(locks, store,
      frames, revision, lineage),
    action: (intent, revision, lineage) => commitPublicV15GreenwayAction(locks, store,
      intent, revision, lineage),
    work: (id, revision, lineage) => commitPublicV15TerrainWork(locks, store,
      id, revision, lineage),
    starterWork: (id, revision, lineage) => commitPublicV15StarterWork(locks, store,
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
    if (gate.gate === 'blocked') workMode.current = false
    if (active.movementOwner === 'greenway' && workKind.current === 'ladder') workKind.current = 'bridge'
    return { ...publicWorldV15ViewProjection(runtime.preview(), active, messages,
      selected, open, walk, { kind: workKind.current, bodyYaw: active.player.yaw,
        modeActive: workMode.current && gate.gate === 'open',
        actionsEnabled: gate.gate === 'open' }),
    controllerActionsEnabled: gate.gate === 'open' }
  }
  const status = runtime.status()
  const active = runtime.view()
  const projection = project(selectedSiteId, openStoreId, walkRequested, active, status)

  const save = async (idleWorks = false) => {
    if (saving.current || !publicV15CheckpointDue(runtime.status(),
      runtime.view().pendingBoundary, idleWorks)) return
    saving.current = true; repaint()
    const result = await publicV15CheckpointWithWorkMode(runtime, workMode)
    saving.current = false
    if (result.status === 'saved') { rebaseInput(); tell('V15 progress saved on this device.') }
    else if (result.status === 'blocked') {
      held.current = [0, 0]; tell(`Save blocked: ${result.reason}.`)
    }
    repaint()
  }
  const action = async (intent: PublicWorldIntent | { id: string; route: 'starter' | 'streamed' }) => {
    if (runtime.status().gate !== 'open') return
    if ('id' in intent) workMode.current = false
    repaint()
    const result = 'id' in intent
      ? await (intent.route === 'starter' ? runtime.buildStarterWork(intent.id)
        : runtime.buildWork(intent.id)) : await runtime.action(intent)
    if (result.status === 'saved') {
      if (result.resetWalkRequested) { walkRef.current = false; setWalkRequested(false) }
      rebaseInput()
      tell(result.workEvent ? `${result.workEvent.type === 'terrain_work_dug' ? 'Dig' : 'Build'} saved: ${result.workEvent.id}. ${result.workEvent.logsSpent} logs spent, ${result.workEvent.stoneGained} stone gained, ${result.workEvent.xp} XP.`
        : result.events.at(-1)?.type.replaceAll('_', ' ') ?? 'Action saved.')
    } else if (result.status === 'rejected') {
      rebaseInput(); tell('Action rejected. Check the current site and equipment.')
    } else if (result.status === 'deferred-airborne') tell('Land before interacting.')
    else if (result.status === 'blocked') {
      held.current = [0, 0]; tell(`Save blocked: ${result.reason}.`)
    }
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
      const idle = publicV15IdleWorksSampler(runtime.view(), workMode.current,
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
        if (publicV15CheckpointDue(runtime.status(), runtime.view().pendingBoundary)) {
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
      workMode.current = intent.active; repaint(); return
    }
    if (intent.type === 'saved-work.kind') {
      if (workMode.current && (runtime.view().movementOwner !== 'greenway'
        || intent.kind !== 'ladder')) { workKind.current = intent.kind; repaint() }
      return
    }
    const current = project()
    if (intent.type === 'saved-work.confirm') {
      const route = publicV15WorkRouteForView(current, intent.id,
        runtime.view().movementOwner)
      if (route) void action({ id: intent.id, route })
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
    const mapped = publicV14ActionForView(intent, current)
    if (mapped) void action(mapped)
    else tell('This action is unavailable in the v15 world.')
  }
  return <main data-public-v15="true" data-owner={active.movementOwner}>
    {status.gate === 'blocked' && <p role="alert" style={{ margin: 0, padding: 12,
      background: '#6b1721', color: '#fff', font: '600 15px/1.4 system-ui' }}>Save blocked ({status.blockedReason}).
      Movement is frozen. Keep this tab open; unsaved progress has no recovery export yet.</p>}
    <WizardSurface projection={projection} onIntent={onIntent} />
  </main>
}
