import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

import { prepareReefScapeSupport, sampleReefScapeSupport,
  type ScapeSupportSample } from '../surfaceLocomotion'
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
  /** Optional non-fish drive for authored lifecycle animation speed. */
  readonly semanticDrive?: number
  readonly appearance?: SpecimenAppearance
}

export interface SpecimenAppearance {
  readonly saturation: number
  readonly opacity: number
}

export function resolveSpecimenAppearance(appearance?: SpecimenAppearance): SpecimenAppearance | undefined {
  if (!appearance) return undefined
  const unit = (value: number) => THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1)
  return { saturation: unit(appearance.saturation), opacity: unit(appearance.opacity) }
}

type ColorMaterial = THREE.Material & { color: THREE.Color }
const materialColor = (material: THREE.Material) =>
  'color' in material && material.color instanceof THREE.Color ? material as ColorMaterial : undefined

function applyResolvedAppearance(material: THREE.Material, baseColor: THREE.Color | undefined,
  baseOpacity: number, baseTransparent: boolean, baseDepthWrite: boolean, appearance: SpecimenAppearance) {
  const colored = materialColor(material)
  if (colored && baseColor) {
    if (appearance.saturation === 1) colored.color.copy(baseColor)
    else {
      const luminance = baseColor.r * .2126 + baseColor.g * .7152 + baseColor.b * .0722
      colored.color.setRGB(luminance, luminance, luminance).lerp(baseColor, appearance.saturation)
    }
  }
  material.opacity = baseOpacity * appearance.opacity
  material.transparent = baseTransparent || material.opacity < 1
  material.depthWrite = baseDepthWrite && material.opacity >= 1
  material.needsUpdate = true
}

/** Clone before applying lifecycle appearance so accepted source assets and sibling instances stay immutable. */
export function specimenMaterialWithAppearance(source: THREE.Material,
  appearance: SpecimenAppearance): THREE.Material {
  const resolved = resolveSpecimenAppearance(appearance)!
  const material = source.clone()
  applyResolvedAppearance(material, materialColor(source)?.color, source.opacity, source.transparent,
    source.depthWrite, resolved)
  return material
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
  regal_angelfish: DEEP_BODY_TURN_PROFILE,
  tomini_tang: DEEP_BODY_TURN_PROFILE,
  yellow_tang: DEEP_BODY_TURN_PROFILE,
  diamond_goby: FUSIFORM_TURN_PROFILE,
  watchman_goby: FUSIFORM_TURN_PROFILE,
  royal_gramma: FUSIFORM_TURN_PROFILE,
  six_line_wrasse: FUSIFORM_TURN_PROFILE,
}
const TURN_AXIS = new THREE.Vector3(0, 0, 1)
const TURN_ROTATION = new THREE.Quaternion()

const LINCKIA_ARM_CHAINS = [
  ['Arm0_A', 'Arm0_B', 'Arm0_C', 'Arm0_D'],
  ['Arm1_A_L', 'Arm1_B_L', 'Arm1_C_L', 'Arm1_D_L'],
  ['Arm1_A_R', 'Arm1_B_R', 'Arm1_C_R', 'Arm1_D_R'],
  ['Arm2_A_L', 'Arm2_B_L', 'Arm2_C_L', 'Arm2_D_L'],
  ['Arm2_A_R', 'Arm2_B_R', 'Arm2_C_R', 'Arm2_D_R'],
] as const
const LINCKIA_MAX_JOINT_BEND = [0.2, 0.28, 0.34, 0.38] as const
// Accepted mesh: the arm bone axis sits about 9 mm above the oral surface on a 250 mm adult span.
const LINCKIA_ARM_AXIS_CLEARANCE_RATIO = 0.036
const LINCKIA_LOCAL_BEND_AXIS = new THREE.Vector3(1, 0, 0)
const LINCKIA_LOCAL_TIP_DIRECTION = new THREE.Vector3(0, 1, 0)
const LINCKIA_BEND_ROTATION = new THREE.Quaternion()

interface LinckiaArmJoint {
  readonly bone: THREE.Bone
  readonly chainIndex: number
  readonly endpoint?: THREE.Bone
  readonly tipLength: number
  readonly maximumBend: number
  readonly support: ScapeSupportSample
}

function resolveLinckiaArmJoints(root: THREE.Object3D): readonly LinckiaArmJoint[] {
  return LINCKIA_ARM_CHAINS.flatMap((chain, chainIndex) => chain.flatMap((boneName, index) => {
    const bone = root.getObjectByName(boneName)
    if (!(bone instanceof THREE.Bone)) return []
    const endpoint = index < chain.length - 1 ? root.getObjectByName(chain[index + 1]) : undefined
    const nextBone = endpoint instanceof THREE.Bone ? endpoint : undefined
    return [{
      bone,
      chainIndex,
      endpoint: nextBone,
      tipLength: Math.max(nextBone?.position.length() ?? bone.position.length(), 0.01),
      maximumBend: LINCKIA_MAX_JOINT_BEND[index],
      support: {
        position: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0),
        kind: 'sand' as const, distance: 0,
      },
    }]
  }))
}

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
  turnDrive, locomotionDrive, semanticDrive, appearance }: RiggedSpecimenProps) {
  const source = useLoader(GLTFLoader, asset.url)
  const appearancePlan = useMemo(() => resolveSpecimenAppearance(appearance),
    [appearance?.opacity, appearance?.saturation])
  const instance = useMemo(() => {
    const root = cloneSkinned(source.scene) as THREE.Group
    const materials: Array<{ material: THREE.Material; baseColor?: THREE.Color;
      baseOpacity: number; baseTransparent: boolean; baseDepthWrite: boolean }> = []
    if (appearancePlan) root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      const own = (sourceMaterial: THREE.Material) => {
        const material = specimenMaterialWithAppearance(sourceMaterial, appearancePlan)
        materials.push({ material, baseColor: materialColor(sourceMaterial)?.color.clone(),
          baseOpacity: sourceMaterial.opacity, baseTransparent: sourceMaterial.transparent,
          baseDepthWrite: sourceMaterial.depthWrite })
        return material
      }
      node.material = Array.isArray(node.material) ? node.material.map(own) : own(node.material)
    })
    return { root, materials }
  }, [Boolean(appearancePlan), source.scene])
  const { root, materials: instanceMaterials } = instance
  const mixer = useMemo(() => new THREE.AnimationMixer(root), [root])
  const actions = useRef<Partial<Record<string, THREE.AnimationAction>>>({})
  const animationPlan = useMemo(() => resolveSemanticAnimationPlan(asset), [asset])
  const linckiaArmJoints = useMemo(() => asset.speciesId === 'blue_linckia'
    ? resolveLinckiaArmJoints(root) : [], [asset.speciesId, root])
  const linckiaArmBends = useRef<number[]>([])
  const linckiaTargetBends = useRef<number[]>([])
  const linckiaSampleCursor = useRef(0)
  const linckiaScratch = useMemo(() => ({
    axisWorld: new THREE.Vector3(), bendCross: new THREE.Vector3(), currentDirection: new THREE.Vector3(),
    desiredDirection: new THREE.Vector3(), endpointScape: new THREE.Vector3(),
    endpointWorld: new THREE.Vector3(), jointWorld: new THREE.Vector3(),
    preferredNormal: new THREE.Vector3(), scapeMatrixInverse: new THREE.Matrix4(),
    targetWorld: new THREE.Vector3(), specimenWorldPosition: new THREE.Vector3(),
  }), [])
  const seeded = useRef(false)
  const smoothedTurnDrive = useRef(0)

  useEffect(() => {
    root.name = `rigged-${asset.speciesId}-${individualId}`
    smoothedTurnDrive.current = 0
    linckiaArmBends.current = linckiaArmJoints.map(() => 0)
    linckiaTargetBends.current = linckiaArmJoints.map(() => 0)
    linckiaSampleCursor.current = Math.abs(individualId) % LINCKIA_ARM_CHAINS.length
    if (asset.speciesId === 'blue_linckia') prepareReefScapeSupport()
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
  }, [animationPlan, asset.clipLoops, asset.clips, asset.speciesId, individualId, linckiaArmJoints,
    mixer, root, source.animations, stage])

  useEffect(() => {
    if (!appearancePlan) return
    for (const record of instanceMaterials) applyResolvedAppearance(record.material, record.baseColor,
      record.baseOpacity, record.baseTransparent, record.baseDepthWrite, appearancePlan)
  }, [appearancePlan, instanceMaterials])

  useEffect(() => () => {
    for (const record of instanceMaterials) record.material.dispose()
  }, [instanceMaterials])

  useFrame((_, delta) => {
    const drive = semanticDrive === undefined ? hunger
      : THREE.MathUtils.clamp(Number.isFinite(semanticDrive) ? semanticDrive : 0, 0, 1)
    applySemanticAnimationDrive(actions.current, animationPlan, drive, feedDrive.current,
      asset.category === 'fish' ? locomotionDrive?.current : undefined)
    const frameDelta = Math.min(delta, 0.05)
    mixer.update(frameDelta)
    const liveTurn = turnDrive?.current ?? 0
    const targetTurn = Math.abs(liveTurn) < 0.025 ? 0 : THREE.MathUtils.clamp(liveTurn, -1, 1)
    const damping = Math.abs(targetTurn) > 0.8 ? 8 : 4.5
    smoothedTurnDrive.current = THREE.MathUtils.damp(smoothedTurnDrive.current, targetTurn, damping, frameDelta)
    applySpecimenTurnPose(root, asset.speciesId, smoothedTurnDrive.current)

    const specimenGroup = root.parent
    const scapeSpace = specimenGroup?.parent
    if (asset.speciesId !== 'blue_linckia' || !specimenGroup || !scapeSpace || !linckiaArmJoints.length) return
    specimenGroup.updateWorldMatrix(true, false)
    scapeSpace.updateWorldMatrix(true, false)
    root.updateWorldMatrix(true, true)
    const maximumDistance = Math.max(targetLengthSceneUnits * 0.7, 0.1)
    const surfaceClearance = Math.max(targetLengthSceneUnits * LINCKIA_ARM_AXIS_CLEARANCE_RATIO, 0.003)
    specimenGroup.getWorldPosition(linckiaScratch.specimenWorldPosition)
    linckiaScratch.preferredNormal.copy(LINCKIA_LOCAL_TIP_DIRECTION)
    specimenGroup.localToWorld(linckiaScratch.preferredNormal)
    linckiaScratch.preferredNormal.sub(linckiaScratch.specimenWorldPosition)
      .transformDirection(linckiaScratch.scapeMatrixInverse.copy(scapeSpace.matrixWorld).invert())
    const sampledChain = linckiaSampleCursor.current
    linckiaSampleCursor.current = (sampledChain + 1) % LINCKIA_ARM_CHAINS.length

    for (const [index, joint] of linckiaArmJoints.entries()) {
      if (joint.chainIndex === sampledChain) {
        joint.bone.getWorldPosition(linckiaScratch.jointWorld)
        if (joint.endpoint) joint.endpoint.getWorldPosition(linckiaScratch.endpointWorld)
        else joint.bone.localToWorld(linckiaScratch.endpointWorld.copy(LINCKIA_LOCAL_TIP_DIRECTION)
          .multiplyScalar(joint.tipLength))
        linckiaScratch.endpointScape.copy(linckiaScratch.endpointWorld)
        scapeSpace.worldToLocal(linckiaScratch.endpointScape)
        const support = sampleReefScapeSupport(linckiaScratch.endpointScape,
          linckiaScratch.preferredNormal, maximumDistance, joint.support)
        let targetBend = 0
        if (support.distance <= maximumDistance) {
          linckiaScratch.targetWorld.copy(support.position).addScaledVector(support.normal, surfaceClearance)
          scapeSpace.localToWorld(linckiaScratch.targetWorld)
          linckiaScratch.currentDirection.copy(linckiaScratch.endpointWorld).sub(linckiaScratch.jointWorld)
          linckiaScratch.desiredDirection.copy(linckiaScratch.targetWorld).sub(linckiaScratch.jointWorld)
          if (linckiaScratch.currentDirection.lengthSq() >= 1e-8 &&
            linckiaScratch.desiredDirection.lengthSq() >= 1e-8) {
            linckiaScratch.currentDirection.normalize()
            linckiaScratch.desiredDirection.normalize()
            joint.bone.getWorldQuaternion(LINCKIA_BEND_ROTATION)
            linckiaScratch.axisWorld.copy(LINCKIA_LOCAL_BEND_AXIS)
              .applyQuaternion(LINCKIA_BEND_ROTATION).normalize()
            targetBend = THREE.MathUtils.clamp(Math.atan2(
              linckiaScratch.axisWorld.dot(linckiaScratch.bendCross.crossVectors(
                linckiaScratch.currentDirection, linckiaScratch.desiredDirection)),
              linckiaScratch.currentDirection.dot(linckiaScratch.desiredDirection),
            ), -joint.maximumBend, joint.maximumBend)
          }
        }
        linckiaTargetBends.current[index] = targetBend
      }
      const targetBend = linckiaTargetBends.current[index] ?? 0
      const bend = THREE.MathUtils.damp(linckiaArmBends.current[index] ?? 0, targetBend, 7, frameDelta)
      linckiaArmBends.current[index] = bend
      LINCKIA_BEND_ROTATION.setFromAxisAngle(LINCKIA_LOCAL_BEND_AXIS, bend)
      joint.bone.quaternion.multiply(LINCKIA_BEND_ROTATION)
      joint.bone.updateWorldMatrix(false, true)
    }
  })

  const authoredScale = targetLengthSceneUnits / asset.referenceAdultLengthMeters
  return <primitive object={root} scale={authoredScale} />
}
