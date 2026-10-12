import { describe, expect, it } from 'vitest'
import { createPublicV17InputScheduler, publicV17StepDecision,
  createPublicV17InputTrace, publicV17InputTraceEnabled, registerPublicV17SaveTrace,
  publicV17SavePhaseStart, publicV17SavePhaseEnd } from './PublicV17InputScheduler'
import type { PublicV17QueueHead, PublicV17SchedulerGate } from './PublicV17InputScheduler'

describe('v17 fixed-step input scheduler', () => {
  it('enables bundled input diagnostics only for an explicit local-host flag', () => {
    expect(publicV17InputTraceEnabled('127.0.0.1', '?inputTrace=1')).toBe(true)
    expect(publicV17InputTraceEnabled('localhost', '?inputTrace=1')).toBe(true)
    expect(publicV17InputTraceEnabled('example.com', '?inputTrace=1')).toBe(false)
    expect(publicV17InputTraceEnabled('localhost.evil.com', '?inputTrace=1')).toBe(false)
    expect(publicV17InputTraceEnabled('localhost', '')).toBe(false)
    expect(publicV17InputTraceEnabled('localhost', '?inputTrace=0')).toBe(false)
  })
  it('bounds diagnostic records, preserves their order, and snapshots mutable input', () => {
    const trace = createPublicV17InputTrace(), vector = [0, 1]
    trace.record('input', { vector }); vector[1] = 0
    expect(JSON.parse(trace.json()).records[0].data.vector).toEqual([0, 1])
    for (let index = 0; index < 1205; index++) trace.record('step', { index })
    const snapshot = JSON.parse(trace.json())
    expect(snapshot.records).toHaveLength(1200)
    expect(snapshot.dropped).toBe(6)
    expect(snapshot.records[0].sequence).toBe(7)
    expect(snapshot.records.at(-1).data.index).toBe(1204)
    trace.clear()
    expect(JSON.parse(trace.json()).records).toEqual([])
  })
  it('isolates save phases by controller store identity and disables them on teardown', () => {
    const first = {}, second = {}, a = createPublicV17InputTrace(), b = createPublicV17InputTrace()
    expect(publicV17SavePhaseStart(first)).toBeUndefined()
    const cleanupA = registerPublicV17SaveTrace(first, a)
    const cleanupB = registerPublicV17SaveTrace(second, b)
    publicV17SavePhaseEnd(first, 'incoming-replay', publicV17SavePhaseStart(first))
    expect(JSON.parse(a.json()).records[0].data).toMatchObject({ phase: 'incoming-replay' })
    expect(JSON.parse(b.json()).records).toEqual([])
    cleanupA(); cleanupB()
    expect(publicV17SavePhaseStart(first)).toBeUndefined()
    expect(publicV17SavePhaseStart(second)).toBeUndefined()
  })
  it('keeps a click between its reserved boundary step and the next accepted step', () => {
    const queue = createPublicV17InputScheduler()
    expect(queue.enqueueIntent({ type: 'gait.toggle' }, true)).toBe(true)
    expect(queue.acceptStep([0, 1])).toBe(true)
    expect(queue.acceptStep([0, 1])).toBe(true)
    expect(queue.tokens.map((token) => token.type === 'step'
      ? `step:${token.id}` : `intent:${token.afterStepId}`))
      .toEqual(['step:1', 'intent:1', 'step:2'])
    expect(queue.tokens[0]).toMatchObject({ type: 'step',
      frame: { vector: [0, 1], jumping: false } })
  })

  it('reserves a step independently of 128 queued clicks and refuses only the next click', () => {
    const queue = createPublicV17InputScheduler()
    for (let index = 0; index < 128; index++)
      expect(queue.enqueueIntent({ type: 'saved-work.mode', active: index % 2 === 0 }, true))
        .toBe(true)
    expect(queue.queuedSteps()).toBe(1)
    expect(queue.queuedCommands()).toBe(128)
    const accepted = structuredClone(queue.tokens)
    expect(queue.enqueueIntent({ type: 'saved-work.mode', active: true }, true)).toBe(false)
    expect(queue.tokens).toEqual(accepted)
    expect(queue.acceptStep([0, 0])).toBe(true)
    expect(queue.tokens[0]).toMatchObject({ type: 'step', id: 1,
      frame: { vector: [0, 0], jumping: false } })
  })

  it('orders a pulse and subsequent click without merging distinct commands', () => {
    const queue = createPublicV17InputScheduler()
    expect(queue.enqueuePulse([0, 0], true)).toBe(true)
    expect(queue.enqueueIntent({ type: 'saved-work.mode', active: true }, true)).toBe(true)
    expect(queue.acceptStep([0, 1])).toBe(true)
    expect(queue.acceptStep([0, 1])).toBe(true)
    expect(queue.tokens.map((token) => token.type === 'step'
      ? `step:${token.id}:${token.frame?.jumping}` : `intent:${token.afterStepId}`))
      .toEqual(['step:1:true', 'intent:1', 'step:2:false'])
  })

  it('clears only a paused held press while preserving a click, jump, and touch tap in order', () => {
    const queue = createPublicV17InputScheduler()
    expect(queue.enqueuePulse([0, 1], false, true)).toBe(true)
    expect(queue.enqueueIntent({ type: 'gait.toggle' }, true)).toBe(true)
    expect(queue.enqueuePulse([0, 0], true)).toBe(true)
    expect(queue.enqueuePulse([1, 0], false)).toBe(true)
    queue.cancelUnreadyPulses()
    expect(queue.queuedCommands()).toBe(3)
    expect(queue.tokens.map((token) => token.type)).toEqual(['step', 'intent', 'step', 'step'])
    expect(queue.acceptStep([0, 0])).toBe(true)
    expect(queue.peek()).toMatchObject({ type: 'step',
      frame: { vector: [0, 0], jumping: false } })
    queue.shift(); queue.shift()
    expect(queue.acceptStep([0, 0])).toBe(true)
    expect(queue.peek()).toMatchObject({ type: 'step',
      frame: { vector: [0, 0], jumping: true } })
    queue.shift()
    expect(queue.acceptStep([0, 0])).toBe(true)
    expect(queue.peek()).toMatchObject({ type: 'step',
      frame: { vector: [1, 0], jumping: false } })
  })

  it('fills a virtual landing boundary with a neutral frame even when it owns a pulse', () => {
    const queue = createPublicV17InputScheduler()
    expect(queue.enqueuePulse([1, 0], false)).toBe(true)
    expect(queue.acceptStep([0, 0], true)).toBe(true)
    expect(queue.peek()).toMatchObject({ type: 'step',
      frame: { vector: [0, 0], jumping: false }, pulse: { vector: [1, 0] } })
  })

  it('never exceeds the independent 96-step quota when pulses and clicks reserve boundaries', () => {
    const queue = createPublicV17InputScheduler()
    expect(queue.enqueuePulse([0, 1], false, true)).toBe(true)
    for (let index = 1; index < 96; index++)
      expect(queue.enqueuePulse([1, 0], false)).toBe(true)
    expect(queue.queuedSteps()).toBe(96)
    const accepted = structuredClone(queue.tokens)
    expect(queue.enqueuePulse([0, 1], false)).toBe(false)
    expect(queue.tokens).toEqual(accepted)
    queue.cancelUnreadyPulses()
    expect(queue.queuedSteps()).toBe(95)
    expect(queue.queuedCommands()).toBe(95)
    expect(queue.enqueuePulse([0, -1], false)).toBe(true)
    expect(queue.queuedSteps()).toBe(96)
    expect(queue.tokens[0]).toMatchObject({ type: 'step',
      pulse: { vector: [1, 0] } })
    expect(queue.tokens.at(-1)).toMatchObject({ type: 'step',
      pulse: { vector: [0, -1] } })
    for (let index = 0; index < 96; index++) expect(queue.acceptStep([0, 0])).toBe(true)
    expect(queue.enqueueIntent({ type: 'gait.toggle' }, true)).toBe(false)
    expect(queue.queuedSteps()).toBe(96)
    expect(queue.queuedCommands()).toBe(96)
  })

  it('has a finite pause/admission decision for gate, pose, reserve, head, and arrival', () => {
    const gates: PublicV17SchedulerGate[] = ['open', 'checkpointing', 'barrier',
      'blocked', 'cap-paused']
    const heads: PublicV17QueueHead[] = ['none', 'ready-step', 'virtual-step',
      'ui-only', 'checked-action']
    for (const gate of gates) for (const airborne of [false, true])
      for (const pendingFrames of [64, 94, 95, 96, 128])
        for (const head of heads) for (const arrival of ['none', 'ui-click', 'pulse']) {
          // cap-paused is the runtime's exact 128-frame state, not an arbitrary gate.
          if (gate === 'cap-paused' && pendingFrames !== 128) continue
          const result = publicV17StepDecision({ gate, airborne, pendingFrames,
            queuedSteps: head === 'ready-step' || head === 'virtual-step' ? 1 : 0,
            queuedCommands: arrival === 'none' ? 0 : 1, head, canAcceptStep: true })
          expect(['blocked', 'barrier', 'invariant', 'drain-first', 'pause',
            'sample', 'neutral']).toContain(result)
          if (gate === 'blocked') expect(result).toBe('blocked')
          else if (airborne && pendingFrames === 128) expect(result).toBe('invariant')
          else if (gate === 'barrier' || gate === 'cap-paused')
            expect(result).toBe('barrier')
          else if (airborne && head === 'virtual-step')
            expect(result).toBe(pendingFrames >= 96 ? 'neutral' : 'sample')
          else if (!airborne && pendingFrames >= 96 && head === 'ready-step')
            expect(result).toBe('pause')
        }
    expect(publicV17StepDecision({ gate: 'checkpointing', airborne: false,
      pendingFrames: 95, queuedSteps: 1, queuedCommands: 0,
      head: 'virtual-step', canAcceptStep: true })).toBe('pause')
    expect(publicV17StepDecision({ gate: 'checkpointing', airborne: true,
      pendingFrames: 95, queuedSteps: 1, queuedCommands: 0,
      head: 'virtual-step', canAcceptStep: true })).toBe('sample')
    expect(publicV17StepDecision({ gate: 'checkpointing', airborne: true,
      pendingFrames: 96, queuedSteps: 1, queuedCommands: 128,
      head: 'virtual-step', canAcceptStep: true })).toBe('neutral')
    expect(publicV17StepDecision({ gate: 'checkpointing', airborne: true,
      pendingFrames: 127, queuedSteps: 96, queuedCommands: 128,
      head: 'virtual-step', canAcceptStep: true })).toBe('neutral')
    expect(publicV17StepDecision({ gate: 'checkpointing', airborne: true,
      pendingFrames: 127, queuedSteps: 96, queuedCommands: 128,
      head: 'virtual-step', canAcceptStep: false })).toBe('invariant')
  })

  it('keeps every valid airborne checkpoint state live until landing or the explicit cap', () => {
    for (const start of [64, 94, 95, 96, 127]) {
      for (let pendingFrames = start; pendingFrames < 128; pendingFrames++) {
        const decision = publicV17StepDecision({ gate: 'checkpointing',
          airborne: true, pendingFrames, queuedSteps: 1, queuedCommands: 128,
          head: 'virtual-step', canAcceptStep: true })
        expect(decision).toBe(pendingFrames >= 96 ? 'neutral' : 'sample')
      }
      expect(publicV17StepDecision({ gate: 'checkpointing', airborne: true,
        pendingFrames: 128, queuedSteps: 1, queuedCommands: 128,
        head: 'virtual-step', canAcceptStep: true })).toBe('invariant')
    }
  })
})
