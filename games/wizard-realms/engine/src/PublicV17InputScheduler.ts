import type { WizardViewIntent } from './view/contracts'

export type PublicV17InputTrace = ReturnType<typeof createPublicV17InputTrace>
const saveTraces = new WeakMap<object, PublicV17InputTrace>()
export function registerPublicV17SaveTrace(store: object, trace: PublicV17InputTrace) {
  saveTraces.set(store, trace)
  return () => { if (saveTraces.get(store) === trace) saveTraces.delete(store) }
}
export function publicV17SavePhaseStart(store: object): number | undefined {
  return saveTraces.has(store) ? performance.now() : undefined
}
export function publicV17SavePhaseEnd(store: object, phase: 'checked-records'
  | 'previous-replay' | 'incoming-replay' | 'encode-final-replay' | 'atomic-raw-read'
  | 'atomic-decode' | 'commit-preflight' | 'commit-transaction', start: number | undefined) {
  if (start !== undefined) saveTraces.get(store)?.record('save.phase', {
    phase, durationMs: performance.now() - start })
}
export function publicV17InputTraceEnabled(hostname: string, search: string): boolean {
  return (hostname === 'localhost' || hostname === '127.0.0.1')
    && new URLSearchParams(search).get('inputTrace') === '1'
}
/** Opt-in diagnostics contain only gameplay snapshots, never persisted user data. */
export function createPublicV17InputTrace() {
  const records: Array<{ sequence: number; atMs: number; event: string; data: unknown }> = []
  let sequence = 0
  return {
    record(event: string, data: unknown) {
      records.push({ sequence: ++sequence, atMs: performance.now(), event,
        data: structuredClone(data) })
      if (records.length > 1200) records.shift()
    },
    json: () => JSON.stringify({ format: 'wizard-input-trace/v1', capacity: 1200,
      dropped: Math.max(0, sequence - records.length), records }, null, 2),
    clear() { records.length = 0; sequence = 0 },
  }
}

const MAX_QUEUED_STEPS = 96
export const PUBLIC_V17_MAX_QUEUED_COMMANDS = 128
type Vector = readonly [number, number]
export type PublicV17SchedulerGate = 'open' | 'checkpointing' | 'barrier' | 'blocked' | 'cap-paused'
export type PublicV17QueueHead = 'none' | 'ready-step' | 'virtual-step'
  | 'ui-only' | 'checked-action'
export type PublicV17StepDecision = 'blocked' | 'barrier' | 'invariant'
  | 'drain-first' | 'pause' | 'sample' | 'neutral'
export type PublicV17AdmissionState = Readonly<{
  gate: PublicV17SchedulerGate
  airborne: boolean
  pendingFrames: number
  queuedSteps: number
  queuedCommands: number
  head: PublicV17QueueHead
  canAcceptStep: boolean
}>

export const publicV17UiOnlyIntent = (intent: WizardViewIntent): boolean => [
  'gait.toggle', 'saved-work.mode', 'saved-work.kind', 'saved-work.aim',
  'store.open', 'store.close', 'build-site.select', 'field-camp.select',
  'terrain-work.select',
].includes(intent.type)

/** Drain runnable older tokens before admitting a new 50 ms step or pausing. */
export function publicV17StepDecision(state: PublicV17AdmissionState): PublicV17StepDecision {
  const { gate, airborne, pendingFrames, queuedSteps, queuedCommands, head,
    canAcceptStep } = state
  if (gate === 'blocked') return 'blocked'
  if (airborne && pendingFrames >= 128) return 'invariant'
  if (gate === 'barrier' || gate === 'cap-paused') return 'barrier'
  if (head === 'ui-only' || head === 'checked-action'
    && (airborne || gate === 'open')
    || head === 'ready-step' && (airborne || pendingFrames < 96)) return 'drain-first'
  if (airborne) return canAcceptStep
    ? pendingFrames >= 96 ? 'neutral' : 'sample' : 'invariant'
  if (pendingFrames >= 96 || gate === 'checkpointing'
    && (pendingFrames + queuedSteps >= 96 || queuedSteps >= 96
      || queuedCommands >= PUBLIC_V17_MAX_QUEUED_COMMANDS)
    || !canAcceptStep) return 'pause'
  return 'sample'
}
export type ScheduledStep = { type: 'step'; id: number;
  frame: { vector: Vector; jumping: boolean } | null;
  pulse: { vector: Vector; jumping: boolean; clearCancellable: boolean } | null }
export type ScheduledIntent = { type: 'intent'; afterStepId: number; order: number;
  intent: WizardViewIntent }
export type ScheduledInput = ScheduledStep | ScheduledIntent

/** A boundary runs its step first, then its intents in arrival order. IDs survive save pauses. */
export function createPublicV17InputScheduler() {
  const tokens: ScheduledInput[] = []
  let nextStepId = 0
  let nextOrder = 0
  const queuedSteps = () => tokens.filter((token) => token.type === 'step').length
  const queuedCommands = () => tokens.filter((token) => token.type === 'intent'
    || token.pulse !== null).length
  const reserveStep = (): ScheduledStep => {
    const step: ScheduledStep = { type: 'step', id: ++nextStepId,
      frame: null, pulse: null }
    tokens.push(step)
    return step
  }
  return {
    tokens,
    queuedSteps,
    queuedCommands,
    canAcceptStep: () => tokens.some((token) => token.type === 'step'
      && token.frame === null) || queuedSteps() < MAX_QUEUED_STEPS,
    peek: () => tokens[0] ?? null,
    shift: () => tokens.shift() ?? null,
    enqueueIntent(intent: WizardViewIntent, boundaryRequired: boolean): boolean {
      const tail = tokens.at(-1)
      if (intent.type === 'saved-work.aim' && tail?.type === 'intent'
        && tail.intent.type === 'saved-work.aim'
        && tokens.some((token) => token.type === 'step'
          && token.id === tail.afterStepId && token.frame === null)) {
        tail.intent = intent
        return true
      }
      if (queuedCommands() >= PUBLIC_V17_MAX_QUEUED_COMMANDS) return false
      let afterStepId = nextStepId
      if (boundaryRequired) {
        const candidate = tail?.type === 'step' ? tail
          : tail?.type === 'intent' ? tokens.find((token): token is ScheduledStep =>
            token.type === 'step' && token.id === tail.afterStepId) : null
        if (candidate?.frame !== null && queuedSteps() >= MAX_QUEUED_STEPS) return false
        const boundary = candidate?.frame === null ? candidate : reserveStep()
        afterStepId = boundary.id
      }
      tokens.push({ type: 'intent', afterStepId, order: ++nextOrder, intent })
      return true
    },
    enqueuePulse(vector: Vector, jumping: boolean, clearCancellable = false): boolean {
      if (queuedCommands() >= PUBLIC_V17_MAX_QUEUED_COMMANDS) return false
      const tail = tokens.at(-1)
      if (!(tail?.type === 'step' && tail.frame === null && tail.pulse === null)
        && queuedSteps() >= MAX_QUEUED_STEPS) return false
      const step = tail?.type === 'step' && tail.frame === null && tail.pulse === null
        ? tail : reserveStep()
      step.pulse = { vector, jumping, clearCancellable }
      return true
    },
    cancelUnreadyPulses(): void {
      for (let index = tokens.length - 1; index >= 0; index--) {
        const token = tokens[index]
        if (token.type !== 'step' || token.frame !== null
          || !token.pulse?.clearCancellable) continue
        token.pulse = null
        if (!tokens.some((next) => next.type === 'intent' && next.afterStepId === token.id))
          tokens.splice(index, 1)
      }
    },
    acceptStep(vector: Vector, neutralOnly = false): boolean {
      const virtual = tokens.find((token): token is ScheduledStep =>
        token.type === 'step' && token.frame === null)
      if (!virtual && queuedSteps() >= MAX_QUEUED_STEPS) return false
      const step = virtual ?? reserveStep()
      const pulse = step.pulse
      step.frame = { jumping: neutralOnly ? false : pulse?.jumping ?? false,
        vector: neutralOnly ? [0, 0] : pulse && !pulse.jumping
          ? [pulse.vector[0] || vector[0], pulse.vector[1] || vector[1]] : vector }
      return true
    },
  }
}
