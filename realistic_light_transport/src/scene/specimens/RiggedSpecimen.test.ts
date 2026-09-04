import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import { specimenAssetFor } from './assetRegistry'
import { applySemanticAnimationDrive, initializeSemanticActions, resolveSemanticAnimationPlan,
  type SemanticAnimationActions, type SemanticAnimationPlan } from './RiggedSpecimen'

function createActions(plan: SemanticAnimationPlan): SemanticAnimationActions {
  const mixer = new THREE.AnimationMixer(new THREE.Object3D())
  return Object.fromEntries(Object.values(plan).map(({ clipName }) =>
    [clipName, mixer.clipAction(new THREE.AnimationClip(clipName, 1))]))
}

describe('rigged specimen semantic animation plan', () => {
  it.each(['ocellaris', 'watchman_goby', 'epaulette_shark'])('maps %s fish behavior to idle, swim, and burst', (speciesId) => {
    const asset = specimenAssetFor(speciesId)
    expect(asset).toBeDefined()
    expect(resolveSemanticAnimationPlan(asset!)).toEqual({
      idle: { clipName: 'idle', loop: true },
      locomotion: { clipName: 'swim', loop: true },
      response: { clipName: 'burst', loop: false },
    })
  })

  it('maps pistol shrimp behavior to rest, walk, and snap without fish-specific clip assumptions', () => {
    const asset = specimenAssetFor('pistol_shrimp')
    expect(asset).toBeDefined()
    expect(resolveSemanticAnimationPlan(asset!)).toEqual({
      idle: { clipName: 'rest', loop: true },
      locomotion: { clipName: 'walk', loop: true },
      response: { clipName: 'snap', loop: false },
    })
  })

  it('starts only idle and locomotion after explicitly zeroing every action', () => {
    const asset = specimenAssetFor('ocellaris')!
    const plan = resolveSemanticAnimationPlan(asset)
    const actions = createActions(plan)
    const idleWeight = vi.spyOn(actions.idle!, 'setEffectiveWeight')
    const swimWeight = vi.spyOn(actions.swim!, 'setEffectiveWeight')
    const burstWeight = vi.spyOn(actions.burst!, 'setEffectiveWeight')
    initializeSemanticActions(actions, plan)

    expect(idleWeight.mock.calls[0]).toEqual([0])
    expect(swimWeight.mock.calls[0]).toEqual([0])
    expect(burstWeight.mock.calls[0]).toEqual([0])
    expect(actions.idle?.getEffectiveWeight()).toBeCloseTo(0.22)
    expect(actions.idle?.isRunning()).toBe(true)
    expect(actions.swim?.getEffectiveWeight()).toBeCloseTo(0.78)
    expect(actions.swim?.isRunning()).toBe(true)
    expect(actions.burst?.getEffectiveWeight()).toBe(0)
    expect(actions.burst?.isRunning()).toBe(false)
  })

  it('gates response playback and keeps transition weights bounded', () => {
    const asset = specimenAssetFor('ocellaris')!
    const plan = resolveSemanticAnimationPlan(asset)
    const actions = createActions(plan)
    initializeSemanticActions(actions, plan)

    applySemanticAnimationDrive(actions, plan, 0.5, 0.1)
    expect(actions.burst?.getEffectiveWeight()).toBe(0)
    expect(actions.burst?.isRunning()).toBe(false)

    applySemanticAnimationDrive(actions, plan, 0.5, 0.5)
    const totalWeight = (actions.idle?.getEffectiveWeight() ?? 0) +
      (actions.swim?.getEffectiveWeight() ?? 0) + (actions.burst?.getEffectiveWeight() ?? 0)
    expect(totalWeight).toBeCloseTo(1)
    expect(actions.burst?.isRunning()).toBe(true)

    applySemanticAnimationDrive(actions, plan, 0.5, 0)
    expect(actions.burst?.getEffectiveWeight()).toBe(0)
    expect(actions.burst?.isRunning()).toBe(false)
  })
})
