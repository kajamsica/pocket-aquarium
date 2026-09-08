import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

import type { SemanticAnimationRole, SpecimenAsset } from './assetRegistry'

export interface RiggedSpecimenProps {
  readonly asset: SpecimenAsset
  readonly individualId: number
  readonly targetLengthSceneUnits: number
  readonly stage: string
  readonly hunger: number
  /** Live 0..1 feeding-pursuit drive updated each frame by the fish's steering. */
  readonly feedDrive: RefObject<number>
  /** Live -1..1 steering drive, with negative turning left and positive turning right. */
  readonly turnDrive?: RefObject<number>
  /** Live ratio of current locomotion speed to the resident's normal cruise speed. */
  readonly locomotionDrive?: RefObject<number>
}

function phaseForId(id: number) {
  const value = Math.sin((id + 1) * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

export interface SemanticClipConfig {
  readonly clipName: string
  readonly loop: boolean
}

export type SemanticAnimationPlan = Readonly<Record<SemanticAnimationRole, SemanticClipConfig>>

/** Translate species-specific authored clip names into the shared runtime behaviors. */
export function resolveSemanticAnimationPlan(asset: SpecimenAsset): SemanticAnimationPlan {
  const configFor = (role: SemanticAnimationRole): SemanticClipConfig => {
    const clipName = asset.clipRoles[role]
    return { clipName, loop: asset.clipLoops[clipName] }
  }
  return {
    idle: configFor('idle'),
    locomotion: configFor('locomotion'),
    response: configFor('response'),
  }
}

export type SemanticAnimationActions = Partial<Record<string, THREE.AnimationAction>>

const TURN_BONE_NAMES = ['Spine_A', 'Spine_B', 'Peduncle', 'Caudal'] as const
type SpecimenTurnProfile = readonly [number, number, number, number]
const CLOWN_TURN_PROFILE: SpecimenTurnProfile = [0.03, 0.07, 0.14, 0.22]
const DEEP_BODY_TURN_PROFILE: SpecimenTurnProfile = [0.025, 0.055, 0.115, 0.18]
const FUSIFORM_TURN_PROFILE: SpecimenTurnProfile = [0.04, 0.08, 0.15, 0.23]
const SPECIMEN_TURN_PROFILES: Readonly<Record<string, SpecimenTurnProfile>> = {
  epaulette_shark: [0.1, 0.18, 0.28, 0.34],
  ocellaris: CLOWN_TURN_PROFILE,
  black_storm_ocellaris: CLOWN_TURN_PROFILE,
  banggai_cardinal: DEEP_BODY_TURN_PROFILE,
  blue_hippo_tang: DEEP_BODY_TURN_PROFILE,
  gem_tang: DEEP_BODY_TURN_PROFILE,
  purple_tang: DEEP_BODY_TURN_PROFILE,
  tomini_tang: DEEP_BODY_TURN_PROFILE,
  yellow_tang: DEEP_BODY_TURN_PROFILE,
  diamond_goby: FUSIFORM_TURN_PROFILE,
  watchman_goby: FUSIFORM_TURN_PROFILE,
  royal_gramma: FUSIFORM_TURN_PROFILE,
  six_line_wrasse: FUSIFORM_TURN_PROFILE,
}
const TURN_AXIS = new THREE.Vector3(0, 0, 1)
const TURN_ROTATION = new THREE.Quaternion()

export function supportsSpecimenTurnPose(speciesId: string) {
  return SPECIMEN_TURN_PROFILES[speciesId] !== undefined
}

/** Add the species turn pose after an authored clip has been sampled. */
export function applySpecimenTurnPose(root: THREE.Object3D, speciesId: string, turnDrive: number) {
  const profile = SPECIMEN_TURN_PROFILES[speciesId]
  if (!profile) return
  const drive = THREE.MathUtils.clamp(turnDrive, -1, 1)
  if (drive === 0) return
  for (const [index, boneName] of TURN_BONE_NAMES.entries()) {
    const bone = root.getObjectByName(boneName)
    if (!(bone instanceof THREE.Bone)) continue
    TURN_ROTATION.setFromAxisAngle(TURN_AXIS, profile[index] * drive)
    bone.quaternion.multiply(TURN_ROTATION)
  }
}

const BASE_ROOT_SPECIES = new Set(['acropora_branching', 'stylophora'])

/** Clone an authored clip and remove only translation owned by the rig root. */
export function makeAnimationClipInPlace(clip: THREE.AnimationClip, speciesId: string): THREE.AnimationClip {
  const rigRootName = BASE_ROOT_SPECIES.has(speciesId) ? 'Base' : 'Root'
  const inPlaceClip = clip.clone()
  inPlaceClip.tracks = inPlaceClip.tracks.filter((track) => track.name !== `${rigRootName}.position`)
  return inPlaceClip
}

export function initializeSemanticActions(actions: SemanticAnimationActions, plan: SemanticAnimationPlan) {
  for (const action of Object.values(actions)) action?.stop().setEffectiveWeight(0)
  actions[plan.idle.clipName]?.setEffectiveWeight(0.22).play()
  actions[plan.locomotion.clipName]?.setEffectiveWeight(0.78).play()
}

export function applySemanticAnimationDrive(actions: SemanticAnimationActions, plan: SemanticAnimationPlan,
  hunger: number, feedDrive: number, locomotionSpeedRatio?: number) {
  const burstDrive = THREE.MathUtils.clamp(feedDrive, 0, 1)
  // Ordinary pursuit stays on the locomotion clip. Only the short acquisition/contact pulse
  // crosses this gate, so a non-looping response cannot restart throughout the whole chase.
  const responseActive = burstDrive > 0.72
  const responseWeight = responseActive ? burstDrive : 0
  const baseWeight = 1 - responseWeight
  const locomotion = actions[plan.locomotion.clipName]
  const idle = actions[plan.idle.clipName]
  const response = actions[plan.response.clipName]
  const speedRatio = locomotionSpeedRatio === undefined ? undefined : THREE.MathUtils.clamp(locomotionSpeedRatio, 0, 1.4)
  const locomotionBaseWeight = speedRatio === undefined ? 0.78 : THREE.MathUtils.lerp(0.32, 0.78, Math.min(speedRatio, 1))
  const idleBaseWeight = speedRatio === undefined ? 0.22 : 1 - locomotionBaseWeight
  locomotion?.setEffectiveWeight(locomotionBaseWeight * baseWeight)
  locomotion?.setEffectiveTimeScale(speedRatio === undefined
    ? 0.92 + hunger * 0.28 + burstDrive * 0.34
    : 0.5 + speedRatio * 0.5 + burstDrive * 0.15)
  idle?.setEffectiveWeight(idleBaseWeight * baseWeight)
  if (!response) return
  response.setEffectiveWeight(responseWeight)
  response.setEffectiveTimeScale(1.15 + burstDrive * 0.45)
  if (responseActive && !response.isRunning() && response.time < response.getClip().duration - 1e-4) response.play()
  else if (!responseActive && response.isRunning()) response.stop().setEffectiveWeight(0)
  else if (!responseActive) response.stop().setEffectiveWeight(0)
}

export function RiggedSpecimen({ asset, individualId, targetLengthSceneUnits, stage, hunger, feedDrive,
  turnDrive, locomotionDrive }: RiggedSpecimenProps) {
  const source = useLoader(GLTFLoader, asset.url)
  const root = useMemo(() => cloneSkinned(source.scene) as THREE.Group, [source.scene])
  const mixer = useMemo(() => new THREE.AnimationMixer(root), [root])
  const actions = useRef<Partial<Record<string, THREE.AnimationAction>>>({})
  const animationPlan = useMemo(() => resolveSemanticAnimationPlan(asset), [asset])
  const seeded = useRef(false)
  const smoothedTurnDrive = useRef(0)

  useEffect(() => {
    root.name = `rigged-${asset.speciesId}-${individualId}`
    smoothedTurnDrive.current = 0
    root.userData = { ...root.userData, rootSpecimenId: individualId, speciesId: asset.speciesId, stage }
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true
        node.receiveShadow = true
        const materials = Array.isArray(node.material) ? node.material : [node.material]
        materials.forEach((material) => {
          material.depthTest = true
          material.depthWrite = true
        })
      }
    })
    for (const clipName of asset.clips) {
      const clip = THREE.AnimationClip.findByName(source.animations, clipName)
      if (!clip) continue
      const action = mixer.clipAction(makeAnimationClipInPlace(clip, asset.speciesId), root)
      const loop = asset.clipLoops[clipName]
      action.enabled = true
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
      action.clampWhenFinished = !loop
      actions.current[clipName] = action
    }
    initializeSemanticActions(actions.current, animationPlan)
    const firstLoop = actions.current[animationPlan.locomotion.clipName] ?? actions.current[animationPlan.idle.clipName]
    if (firstLoop && !seeded.current) {
      mixer.setTime(firstLoop.getClip().duration * phaseForId(individualId))
      seeded.current = true
    }
    return () => {
      mixer.stopAllAction()
      mixer.uncacheRoot(root)
      actions.current = {}
    }
  }, [animationPlan, asset.clipLoops, asset.clips, asset.speciesId, individualId, mixer, root, source.animations, stage])

  useFrame((_, delta) => {
    applySemanticAnimationDrive(actions.current, animationPlan, hunger, feedDrive.current,
      asset.category === 'fish' ? locomotionDrive?.current : undefined)
    const frameDelta = Math.min(delta, 0.05)
    mixer.update(frameDelta)
    const liveTurn = turnDrive?.current ?? 0
    const targetTurn = Math.abs(liveTurn) < 0.025 ? 0 : THREE.MathUtils.clamp(liveTurn, -1, 1)
    const damping = Math.abs(targetTurn) > 0.8 ? 8 : 4.5
    smoothedTurnDrive.current = THREE.MathUtils.damp(smoothedTurnDrive.current, targetTurn, damping, frameDelta)
    applySpecimenTurnPose(root, asset.speciesId, smoothedTurnDrive.current)
  })

  const authoredScale = targetLengthSceneUnits / asset.referenceAdultLengthMeters
  return <primitive object={root} scale={authoredScale} />
}
