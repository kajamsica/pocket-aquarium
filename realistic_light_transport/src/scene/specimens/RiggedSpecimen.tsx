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

const EPAULETTE_TURN_BONES = [
  ['Spine_A', 0.07],
  ['Spine_B', 0.13],
  ['Peduncle', 0.2],
  ['Caudal', 0.24],
] as const
const TURN_AXIS = new THREE.Vector3(0, 0, 1)
const TURN_ROTATION = new THREE.Quaternion()

/** Add the shared Epaulette steering pose after an authored clip has been sampled. */
export function applyEpauletteTurnPose(root: THREE.Object3D, speciesId: string, turnDrive: number) {
  if (speciesId !== 'epaulette_shark') return
  const drive = THREE.MathUtils.clamp(turnDrive, -1, 1)
  if (drive === 0) return
  for (const [boneName, bendRadians] of EPAULETTE_TURN_BONES) {
    const bone = root.getObjectByName(boneName)
    if (!(bone instanceof THREE.Bone)) continue
    TURN_ROTATION.setFromAxisAngle(TURN_AXIS, bendRadians * drive)
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
  hunger: number, feedDrive: number) {
  const burstDrive = THREE.MathUtils.clamp(feedDrive, 0, 1)
  // Ordinary pursuit stays on the locomotion clip. Only the short acquisition/contact pulse
  // crosses this gate, so a non-looping response cannot restart throughout the whole chase.
  const responseActive = burstDrive > 0.72
  const responseWeight = responseActive ? burstDrive : 0
  const baseWeight = 1 - responseWeight
  const locomotion = actions[plan.locomotion.clipName]
  const idle = actions[plan.idle.clipName]
  const response = actions[plan.response.clipName]
  locomotion?.setEffectiveWeight(0.78 * baseWeight)
  locomotion?.setEffectiveTimeScale(0.92 + hunger * 0.28 + burstDrive * 0.34)
  idle?.setEffectiveWeight(0.22 * baseWeight)
  if (!response) return
  response.setEffectiveWeight(responseWeight)
  response.setEffectiveTimeScale(1.15 + burstDrive * 0.45)
  if (responseActive && !response.isRunning() && response.time < response.getClip().duration - 1e-4) response.play()
  else if (!responseActive && response.isRunning()) response.stop().setEffectiveWeight(0)
  else if (!responseActive) response.stop().setEffectiveWeight(0)
}

export function RiggedSpecimen({ asset, individualId, targetLengthSceneUnits, stage, hunger, feedDrive,
  turnDrive }: RiggedSpecimenProps) {
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
    applySemanticAnimationDrive(actions.current, animationPlan, hunger, feedDrive.current)
    const frameDelta = Math.min(delta, 0.05)
    mixer.update(frameDelta)
    const liveTurn = turnDrive?.current ?? 0
    const targetTurn = Math.abs(liveTurn) < 0.025 ? 0 : THREE.MathUtils.clamp(liveTurn, -1, 1)
    const damping = Math.abs(targetTurn) > 0.8 ? 8 : 4.5
    smoothedTurnDrive.current = THREE.MathUtils.damp(smoothedTurnDrive.current, targetTurn, damping, frameDelta)
    applyEpauletteTurnPose(root, asset.speciesId, smoothedTurnDrive.current)
  })

  const authoredScale = targetLengthSceneUnits / asset.referenceAdultLengthMeters
  return <primitive object={root} scale={authoredScale} />
}
