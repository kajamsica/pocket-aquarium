import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import { specimenAssetFor } from './assetRegistry'
import { applySemanticAnimationDrive, applySpecimenTurnPose, initializeSemanticActions, makeAnimationClipInPlace,
  resolveSemanticAnimationPlan, supportsSpecimenTurnPose, type SemanticAnimationActions,
  type SemanticAnimationPlan } from './RiggedSpecimen'

function createActions(plan: SemanticAnimationPlan): SemanticAnimationActions {
  const mixer = new THREE.AnimationMixer(new THREE.Object3D())
  return Object.fromEntries(Object.values(plan).map(({ clipName }) =>
    [clipName, mixer.clipAction(new THREE.AnimationClip(clipName, 1))]))
}

const turnBoneNames = ['Spine_A', 'Spine_B', 'Peduncle', 'Caudal'] as const
const clownTurnProfile = [0.03, 0.07, 0.14, 0.22] as const
const deepTurnProfile = [0.025, 0.055, 0.115, 0.18] as const
const fusiformTurnProfile = [0.04, 0.08, 0.15, 0.23] as const
const sharkTurnProfile = [0.1, 0.18, 0.28, 0.34] as const
const turnProfileCases = [
  ['ocellaris', clownTurnProfile], ['black_storm_ocellaris', clownTurnProfile],
  ['banggai_cardinal', deepTurnProfile], ['blue_hippo_tang', deepTurnProfile],
  ['gem_tang', deepTurnProfile], ['purple_tang', deepTurnProfile],
  ['tomini_tang', deepTurnProfile], ['yellow_tang', deepTurnProfile],
  ['diamond_goby', fusiformTurnProfile], ['watchman_goby', fusiformTurnProfile],
  ['royal_gramma', fusiformTurnProfile], ['six_line_wrasse', fusiformTurnProfile],
  ['epaulette_shark', sharkTurnProfile],
] as const

function createTurnRig() {
  const root = new THREE.Group()
  for (const name of turnBoneNames) {
    const bone = new THREE.Bone()
    bone.name = name
    root.add(bone)
  }
  return root
}

function zAngle(root: THREE.Object3D, boneName: string) {
  const rotation = root.getObjectByName(boneName)!.quaternion
  return 2 * Math.atan2(rotation.z, rotation.w)
}

describe('rigged specimen semantic animation plan', () => {
  it.each(turnProfileCases)('clamps and mirrors the %s directional turn pose', (speciesId) => {
    const hardRight = createTurnRig()
    const clampedRight = createTurnRig()
    const hardLeft = createTurnRig()

    applySpecimenTurnPose(hardRight, speciesId, 1)
    applySpecimenTurnPose(clampedRight, speciesId, 4)
    applySpecimenTurnPose(hardLeft, speciesId, -1)

    for (const name of turnBoneNames) {
      expect(hardRight.getObjectByName(name)!.quaternion.angleTo(clampedRight.getObjectByName(name)!.quaternion))
        .toBeCloseTo(0)
      expect(zAngle(hardLeft, name)).toBeCloseTo(-zAngle(hardRight, name))
    }
  })

  it.each(turnProfileCases)('supports %s and applies its exact progressive turn profile', (speciesId, profile) => {
    const root = createTurnRig()
    applySpecimenTurnPose(root, speciesId, 1)

    const bends = turnBoneNames.map((name) => Math.abs(zAngle(root, name)))
    expect(supportsSpecimenTurnPose(speciesId)).toBe(true)
    for (let index = 0; index < bends.length; index += 1) {
      expect(bends[index]).toBeCloseTo(profile[index])
      if (index > 0) expect(bends[index]).toBeGreaterThan(bends[index - 1])
    }
  })

  it.each(turnProfileCases)('reapplies %s from a fresh sampled pose without accumulating bend', (speciesId) => {
    const root = createTurnRig()
    const spine = root.getObjectByName('Spine_A')!
    const sampledPose = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.12)

    spine.quaternion.copy(sampledPose)
    applySpecimenTurnPose(root, speciesId, 0.6)
    const firstFrame = spine.quaternion.clone()
    spine.quaternion.copy(sampledPose)
    applySpecimenTurnPose(root, speciesId, 0.6)

    expect(spine.quaternion.angleTo(firstFrame)).toBeCloseTo(0)
  })

  it('leaves a supported fish neutral pose unchanged', () => {
    const root = createTurnRig()
    const base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.2)
    root.getObjectByName('Spine_A')!.quaternion.copy(base)

    applySpecimenTurnPose(root, 'ocellaris', 0)

    expect(root.getObjectByName('Spine_A')!.quaternion.equals(base)).toBe(true)
  })

  it.each(['cleaner_shrimp', 'astrea_snail', 'acropora_branching'])('leaves unsupported %s rigs unchanged', (speciesId) => {
    const root = createTurnRig()
    const before = root.children.map((bone) => bone.quaternion.clone())

    applySpecimenTurnPose(root, speciesId, 1)

    expect(supportsSpecimenTurnPose(speciesId)).toBe(false)
    expect(root.children.every((bone, index) => bone.quaternion.equals(before[index]))).toBe(true)
  })

  it('removes only cloned rig-root translation and leaves the source clip unchanged', () => {
    const source = new THREE.AnimationClip('swim', 1, [
      new THREE.VectorKeyframeTrack('Root.position', [0, 1], [0, 0, 0, 1, 2, 3]),
      new THREE.VectorKeyframeTrack('Body.position', [0, 1], [0, 0, 0, 0.1, 0, 0]),
      new THREE.QuaternionKeyframeTrack('Spine_A.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.1, 0, 0.995]),
    ])
    const sourceTrackNames = source.tracks.map((track) => track.name)
    const sourceRootValues = [...source.tracks[0].values]

    const inPlace = makeAnimationClipInPlace(source, 'ocellaris')

    expect(inPlace).not.toBe(source)
    expect(inPlace.tracks.map((track) => track.name)).toEqual(['Body.position', 'Spine_A.quaternion'])
    expect(inPlace.tracks.every((track) => !source.tracks.includes(track))).toBe(true)
    expect(source.tracks.map((track) => track.name)).toEqual(sourceTrackNames)
    expect([...source.tracks[0].values]).toEqual(sourceRootValues)
  })

  it('recognizes accepted species whose rig root is named Base', () => {
    const source = new THREE.AnimationClip('sway', 1, [
      new THREE.VectorKeyframeTrack('Base.position', [0, 1], [0, 0, 0, 0, 0.1, 0]),
      new THREE.VectorKeyframeTrack('Br_00.position', [0, 1], [0, 0, 0, 0.1, 0, 0]),
    ])

    expect(makeAnimationClipInPlace(source, 'stylophora').tracks.map((track) => track.name))
      .toEqual(['Br_00.position'])
  })

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

    applySemanticAnimationDrive(actions, plan, 0.5, 0.6)
    expect(actions.burst?.getEffectiveWeight()).toBe(0)
    expect(actions.burst?.isRunning()).toBe(false)

    applySemanticAnimationDrive(actions, plan, 0.5, 0.8)
    const totalWeight = (actions.idle?.getEffectiveWeight() ?? 0) +
      (actions.swim?.getEffectiveWeight() ?? 0) + (actions.burst?.getEffectiveWeight() ?? 0)
    expect(totalWeight).toBeCloseTo(1)
    expect(actions.burst?.isRunning()).toBe(true)

    applySemanticAnimationDrive(actions, plan, 0.5, 0)
    expect(actions.burst?.getEffectiveWeight()).toBe(0)
    expect(actions.burst?.isRunning()).toBe(false)
  })
})
