import type { Vec2 } from './contracts'

export interface TimedMovementSampler {
  cursorMs: number
  vector: Vec2
  changes: Array<{ atMs: number; vector: Vec2 }>
  discardedBeforeMs: number
}
export interface FixedInputClock {
  lastMs: number
  accruedMs: number
}

const MAX_QUEUED_MOVEMENT_CHANGES = 256

export function createTimedMovementSampler(startMs: number): TimedMovementSampler {
  if (!Number.isFinite(startMs)) throw new RangeError('Input clock must be finite.')
  return { cursorMs: startMs, vector: [0, 0], changes: [], discardedBeforeMs: startMs }
}
export function createFixedInputClock(startMs: number): FixedInputClock {
  if (!Number.isFinite(startMs)) throw new RangeError('Input clock must be finite.')
  return { lastMs: startMs, accruedMs: 0 }
}

export function recordTimedMovement(sampler: TimedMovementSampler, atMs: number, vector: Vec2): void {
  if (!Number.isFinite(atMs) || !vector.every(Number.isFinite)) return
  const previous = sampler.changes.at(-1)
  const timestamp = Math.max(sampler.cursorMs, previous?.atMs ?? sampler.cursorMs, atMs)
  const priorVector = previous?.vector ?? sampler.vector
  if (priorVector[0] === vector[0] && priorVector[1] === vector[1]) return
  sampler.changes.push({ atMs: timestamp, vector })
  // A backgrounded tab can receive keys without a simulation callback. Bound the queue
  // even if an input device produces an implausibly large number of transitions.
  // The lost prefix is later treated as idle, not as a phantom held key.
  if (sampler.changes.length > MAX_QUEUED_MOVEMENT_CHANGES) {
    const discarded = sampler.changes.shift()!
    sampler.vector = discarded.vector
    sampler.discardedBeforeMs = discarded.atMs
  }
}

/** Average the actual held duration within one fixed-step window, including between-callback taps. */
export function sampleTimedMovement(sampler: TimedMovementSampler, endMs: number): Vec2 {
  if (!Number.isFinite(endMs) || endMs <= sampler.cursorMs) return [0, 0]
  const startMs = sampler.cursorMs
  let previousMs = Math.max(startMs, Math.min(endMs, sampler.discardedBeforeMs))
  let vector = sampler.vector
  let xArea = 0
  let yArea = 0
  while (sampler.changes.length && sampler.changes[0].atMs < endMs) {
    const change = sampler.changes.shift()!
    const elapsed = change.atMs - previousMs
    xArea += vector[0] * elapsed
    yArea += vector[1] * elapsed
    previousMs = change.atMs
    vector = change.vector
  }
  const remaining = endMs - previousMs
  xArea += vector[0] * remaining
  yArea += vector[1] * remaining
  sampler.cursorMs = endMs
  sampler.vector = vector
  return [xArea / (endMs - startMs), yArea / (endMs - startMs)]
}

/**
 * Catch up at most maxSteps. Preserve active windows in time order, then spend any
 * remaining budget on the latest idle windows. This keeps a tap that happened before
 * a stalled callback without replaying an unbounded amount of world movement.
 */
export function sampleFixedInputBatch(
  sampler: TimedMovementSampler, clock: FixedInputClock, nowMs: number, stepMs: number, maxSteps: number,
): Vec2[] {
  if (!Number.isFinite(nowMs) || !Number.isFinite(stepMs) || stepMs <= 0
    || !Number.isSafeInteger(maxSteps) || maxSteps < 1) return []
  clock.accruedMs += Math.max(0, nowMs - clock.lastMs)
  clock.lastMs = nowMs
  const due = Math.floor(clock.accruedMs / stepMs)
  if (due <= 0) return []
  clock.accruedMs -= due * stepMs

  const startMs = sampler.cursorMs
  const endMs = startMs + due * stepMs
  const selected: Array<{ index: number; vector: Vec2 }> = []
  let index = 0
  while (index < due && selected.length < maxSteps) {
    if (sampler.cursorMs < sampler.discardedBeforeMs) {
      const nextIndex = Math.max(index, Math.min(due, Math.floor((sampler.discardedBeforeMs - startMs) / stepMs)))
      if (nextIndex > index) {
        sampleTimedMovement(sampler, startMs + nextIndex * stepMs)
        index = nextIndex
      }
    }
    if (index >= due) break
    if (sampler.vector[0] === 0 && sampler.vector[1] === 0) {
      const nextChangeMs = sampler.changes[0]?.atMs
      if (nextChangeMs === undefined || nextChangeMs >= endMs) break
      const nextIndex = Math.max(index, Math.min(due, Math.floor((nextChangeMs - startMs) / stepMs)))
      if (nextIndex > index) {
        sampleTimedMovement(sampler, startMs + nextIndex * stepMs)
        index = nextIndex
      }
    }
    const vector = sampleTimedMovement(sampler, startMs + (index + 1) * stepMs)
    if (vector[0] !== 0 || vector[1] !== 0) selected.push({ index, vector })
    index++
  }

  // Consume all elapsed input, including dropped active time, so it cannot replay on
  // the next callback. Idle gaps jump in one operation rather than one per 50 ms tick.
  if (sampler.cursorMs < endMs) sampleTimedMovement(sampler, endMs)
  const budget = Math.min(due, maxSteps)
  const activeIndices = new Set(selected.map(({ index: selectedIndex }) => selectedIndex))
  for (let idleIndex = due - 1; idleIndex >= 0 && selected.length < budget; idleIndex--) {
    if (!activeIndices.has(idleIndex)) selected.push({ index: idleIndex, vector: [0, 0] })
  }
  selected.sort((left, right) => left.index - right.index)
  return selected.map(({ vector }) => vector)
}
