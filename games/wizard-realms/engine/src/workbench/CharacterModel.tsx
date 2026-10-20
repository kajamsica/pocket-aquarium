import { createPortal, useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { Axe, MiningPick, Spade, V9_EQUIPPED_CARRY_STRENGTH, Wand, applyV9EquippedCarryPose, restoreV9EquippedCarryPose, rightHandToolMountFor } from '../view/WizardScene'
import { ADULT_SEDGEHORN_PREVIEW, CHARACTER_TOOL_GRIP_CLIP, RIDER_SEAT_OFFSET, missingAdultSedgehornClips, onFootHeldTool, overlappingToolGripTracks, type CharacterCandidate, type CharacterClip, type CharacterHeldTool, type CharacterRideClip } from './characterCatalog'

// Vite can load Three through separate optimized chunks. glTF nodes still expose these
// intrinsic flags even when `instanceof THREE.Mesh` crosses module instances.
const isMesh = (node: THREE.Object3D): node is THREE.Mesh => (node as THREE.Mesh).isMesh === true
const isBone = (node: THREE.Object3D): node is THREE.Bone => (node as THREE.Bone).isBone === true

export interface CharacterStats {
  readonly triangles: number
  readonly nodes: number
  readonly bones: number
  readonly materials: number
  readonly clips: readonly { readonly name: string; readonly duration: number }[]
  readonly bounds: { readonly center: THREE.Vector3Tuple; readonly size: THREE.Vector3Tuple }
}

interface CharacterModelProps {
  readonly candidate: CharacterCandidate
  readonly clipName: CharacterClip
  readonly heldTool: CharacterHeldTool
  readonly riding: boolean
  readonly phaseRef: { current: number }
  readonly playing: boolean
  readonly playbackRate: number
  readonly phase: number
  readonly wireframe: boolean
  readonly showSkeleton: boolean
  readonly turntable: boolean
  readonly onReady: (stats: CharacterStats) => void
  readonly onMountReady: (bounds: CharacterStats['bounds']) => void
  readonly onClipError: (error?: string) => void
  readonly onGripError: (error?: string) => void
  readonly onPhase: (phase: number) => void
}

export function CharacterModel({
  candidate, clipName, heldTool, riding, phaseRef, playing, playbackRate, phase, wireframe, showSkeleton, turntable,
  onReady, onMountReady, onClipError, onGripError, onPhase,
}: CharacterModelProps) {
  const mainHand = onFootHeldTool(candidate.id, heldTool, riding)
  const toolSelected = mainHand !== null
  const source = useLoader(GLTFLoader, candidate.glbUrl)
  const turntableRoot = useRef<THREE.Group>(null)
  const reportClock = useRef(0)
  const mounted = useRef(false)
  const root = useMemo(() => {
    const copy = cloneSkinned(source.scene) as THREE.Group
    copy.name = `character-workbench-${candidate.id}`
    copy.traverse((node) => {
      if (!isMesh(node)) return
      node.material = Array.isArray(node.material)
        ? node.material.map((material) => material.clone())
        : node.material.clone()
      node.castShadow = true
      node.receiveShadow = true
    })
    return copy
  }, [candidate.id, source.scene])
  const rightHandSocket = useMemo(() => candidate.id === 'wayfarer-v9-male'
    ? root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('Socket.RightHand'))
    : undefined, [candidate.id, root])
  const restRightHandSocket = useMemo(() => candidate.id === 'wayfarer-v9-male'
    ? source.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('Socket.RightHand'))
    : undefined, [candidate.id, source.scene])
  const rightHandGripFrame = useMemo(() => restRightHandSocket
    ? rightHandToolMountFor(mainHand, restRightHandSocket) : null, [mainHand, restRightHandSocket])
  const rightArmCarry = useMemo(() => {
    if (candidate.id !== 'wayfarer-v9-male') return null
    const body = root.getObjectByName('V9_body') as THREE.SkinnedMesh | undefined
    if (!body?.isSkinnedMesh) return null
    const upperArm = body.skeleton.bones.find((bone) => bone.name === 'UpperArmR')
    const forearm = body.skeleton.bones.find((bone) => bone.name === 'ForearmR')
    if (!upperArm || !forearm) return null
    return { upperArm, forearm, restUpperArm: upperArm.quaternion.clone(),
      restForearm: forearm.quaternion.clone(), state: {
        rawUpperArm: upperArm.quaternion.clone(), rawForearm: forearm.quaternion.clone(), applied: false } }
  }, [candidate.id, root])
  const mixer = useMemo(() => new THREE.AnimationMixer(root), [root])
  const skeleton = useMemo(() => {
    const helper = new THREE.SkeletonHelper(root)
    const materials = Array.isArray(helper.material) ? helper.material : [helper.material]
    materials.forEach((material) => {
      material.depthTest = false
      material.transparent = true
      material.opacity = 0.9
    })
    return helper
  }, [root])
  const clip = useMemo(() => THREE.AnimationClip.findByName(source.animations, clipName), [clipName, source.animations])
  const action = useMemo(() => clip ? mixer.clipAction(clip, root) : undefined, [clip, mixer, root])
  const gripClip = useMemo(() => THREE.AnimationClip.findByName(source.animations, CHARACTER_TOOL_GRIP_CLIP), [source.animations])
  const gripAction = useMemo(() => gripClip ? mixer.clipAction(gripClip, root) : undefined, [gripClip, mixer, root])
  const gripTrackOverlap = useMemo(() => overlappingToolGripTracks(source.animations), [source.animations])

  useEffect(() => {
    let triangles = 0
    let nodes = 0
    let bones = 0
    const materials = new Set<string>()
    root.traverse((node) => {
      nodes += 1
      if (isBone(node)) bones += 1
      if (!isMesh(node)) return
      triangles += node.geometry.index
        ? node.geometry.index.count / 3
        : (node.geometry.getAttribute('position')?.count ?? 0) / 3
      const meshMaterials = Array.isArray(node.material) ? node.material : [node.material]
      meshMaterials.forEach((material) => materials.add(material.uuid))
    })
    root.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const parserJson = (source.parser as unknown as { json?: { materials?: readonly unknown[] } }).json
    onReady({
      triangles: Math.round(triangles), nodes, bones, materials: parserJson?.materials?.length ?? materials.size,
      clips: source.animations.map((entry) => ({ name: entry.name, duration: entry.duration })),
      bounds: { center: center.toArray() as THREE.Vector3Tuple, size: size.toArray() as THREE.Vector3Tuple },
    })
  }, [onReady, root, source.animations, source.parser])

  useEffect(() => {
    root.traverse((node) => {
      if (!isMesh(node)) return
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      materials.forEach((material) => {
        if ('wireframe' in material) {
          material.wireframe = wireframe
          material.needsUpdate = true
        }
      })
    })
  }, [root, wireframe])

  useEffect(() => { skeleton.visible = showSkeleton }, [showSkeleton, skeleton])

  useEffect(() => {
    if (!action) {
      onClipError(`The GLB does not contain the requested ${clipName} animation.`)
      return
    }
    onClipError()
    if (rightArmCarry) restoreV9EquippedCarryPose(rightArmCarry.upperArm, rightArmCarry.forearm,
      rightArmCarry.state)
    action.reset().setLoop(THREE.LoopRepeat, Infinity).play()
    mixer.setTime(0)
    return () => { action.stop() }
  }, [action, clipName, mixer, onClipError, rightArmCarry])

  useEffect(() => {
    if (!mainHand) { onGripError(); return }
    if (!rightArmCarry) {
      onGripError('The V9 right-arm carry rig is missing. Held-tool movement is not previewable.')
      return
    }
    if (!gripClip || gripClip.tracks.length === 0 || !gripAction) {
      onGripError('The V9 GLB has no usable ToolGrip clip. The held tool remains visible, but finger grip is not yet previewable.')
      return
    }
    if (gripTrackOverlap.length > 0) {
      onGripError(`ToolGrip overlaps on-foot animation tracks (${gripTrackOverlap.join(', ')}). Finger grip is disabled to avoid conflicting poses.`)
      return
    }
    onGripError()
    gripAction.reset().setEffectiveWeight(1).setLoop(THREE.LoopRepeat, Infinity).play()
    mixer.update(0)
    return () => { gripAction.stop(); mixer.update(0) }
  }, [mainHand, rightArmCarry, gripAction, gripClip, gripTrackOverlap, mixer, onGripError])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // StrictMode may remount this exact clone. Dispose only after a real unmount.
      window.requestAnimationFrame(() => {
        if (mounted.current) return
        mixer.stopAllAction()
        mixer.uncacheRoot(root)
        skeleton.geometry.dispose()
        const skeletonMaterials = Array.isArray(skeleton.material) ? skeleton.material : [skeleton.material]
        skeletonMaterials.forEach((material) => material.dispose())
        root.traverse((node) => {
          if (!isMesh(node)) return
          const materials = Array.isArray(node.material) ? node.material : [node.material]
          materials.forEach((material) => material.dispose())
        })
      })
    }
  }, [mixer, root, skeleton])

  useFrame((_, delta) => {
    if (action && clip) {
      if (rightArmCarry) restoreV9EquippedCarryPose(rightArmCarry.upperArm, rightArmCarry.forearm,
        rightArmCarry.state)
      if (playing) mixer.update(Math.min(delta, 0.05) * playbackRate)
      else mixer.setTime(phase * clip.duration)
      if (toolSelected && rightArmCarry) applyV9EquippedCarryPose(rightArmCarry.upperArm, rightArmCarry.forearm,
        rightArmCarry.restUpperArm, rightArmCarry.restForearm, V9_EQUIPPED_CARRY_STRENGTH,
        rightArmCarry.state)
      phaseRef.current = clip.duration > 0 ? (action.time / clip.duration) % 1 : 0
      reportClock.current += delta
      if (playing && reportClock.current >= 0.08 && clip.duration > 0) {
        reportClock.current = 0
        onPhase((action.time / clip.duration) % 1)
      }
    }
    if (turntable && turntableRoot.current) turntableRoot.current.rotation.y += Math.min(delta, 0.05) * 0.5
  })

  useEffect(() => {
    if (!turntable && turntableRoot.current) turntableRoot.current.rotation.y = 0
  }, [turntable])

  if (candidate.id === 'wayfarer-v9-male' && !rightHandSocket) {
    throw new Error('V9 GLB is missing Socket.RightHand for held-gear inspection.')
  }
  return <group ref={turntableRoot}>
    <group position={riding ? RIDER_SEAT_OFFSET : [0, 0, 0]}>
      <primitive object={root} />
      <primitive object={skeleton} />
    </group>
    {riding && <AdultSedgehornModel
      clipName={ADULT_SEDGEHORN_PREVIEW.clipsByRiderClip[clipName as CharacterRideClip]}
      phaseRef={phaseRef}
      wireframe={wireframe}
      onReady={onMountReady}
    />}
    {rightHandSocket && rightHandGripFrame && createPortal(<group {...rightHandGripFrame}>
      {heldTool === 'axe' && <Axe />}
      {heldTool === 'basic-pick' && <MiningPick tier="basic" />}
      {heldTool === 'enchanted-pick' && <MiningPick tier="enchanted" />}
      {heldTool === 'spade' && <Spade />}
      {heldTool === 'wand' && <Wand side={1} light />}
    </group>, rightHandSocket)}
  </group>
}

function AdultSedgehornModel({ clipName, phaseRef, wireframe, onReady }: {
  readonly clipName: 'Idle' | 'Walk' | 'Run'
  readonly phaseRef: { current: number }
  readonly wireframe: boolean
  readonly onReady: (bounds: CharacterStats['bounds']) => void
}) {
  const source = useLoader(GLTFLoader, ADULT_SEDGEHORN_PREVIEW.glbUrl)
  const mounted = useRef(false)
  const root = useMemo(() => {
    const copy = cloneSkinned(source.scene) as THREE.Group
    copy.name = 'character-workbench-adult-sedgehorn'
    copy.traverse((node) => {
      if (!isMesh(node)) return
      node.material = Array.isArray(node.material)
        ? node.material.map((material) => material.clone())
        : node.material.clone()
      node.castShadow = true
      node.receiveShadow = true
    })
    return copy
  }, [source.scene])
  const mixer = useMemo(() => new THREE.AnimationMixer(root), [root])
  const missingClips = useMemo(() => missingAdultSedgehornClips(source.animations.map((entry) => entry.name)), [source.animations])
  const clip = useMemo(() => THREE.AnimationClip.findByName(source.animations, clipName), [clipName, source.animations])
  const action = useMemo(() => clip ? mixer.clipAction(clip, root) : undefined, [clip, mixer, root])

  useEffect(() => {
    root.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(root)
    onReady({
      center: box.getCenter(new THREE.Vector3()).toArray() as THREE.Vector3Tuple,
      size: box.getSize(new THREE.Vector3()).toArray() as THREE.Vector3Tuple,
    })
  }, [onReady, root])

  useEffect(() => {
    root.traverse((node) => {
      if (!isMesh(node)) return
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      materials.forEach((material) => {
        if ('wireframe' in material) {
          material.wireframe = wireframe
          material.needsUpdate = true
        }
      })
    })
  }, [root, wireframe])

  useEffect(() => {
    mixer.stopAllAction()
    if (!action) return
    action.reset().setLoop(THREE.LoopRepeat, Infinity).play()
    mixer.setTime(0)
    return () => { action.stop() }
  }, [action, clipName, mixer])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      window.requestAnimationFrame(() => {
        if (mounted.current) return
        mixer.stopAllAction()
        mixer.uncacheRoot(root)
        root.traverse((node) => {
          if (!isMesh(node)) return
          const materials = Array.isArray(node.material) ? node.material : [node.material]
          materials.forEach((material) => material.dispose())
        })
      })
    }
  }, [mixer, root])

  useFrame(() => { if (clip && action) mixer.setTime(phaseRef.current * clip.duration) })

  if (missingClips.length > 0) throw new Error(`Adult sedgehorn GLB is incomplete; missing required ${missingClips.join(', ')} animation${missingClips.length === 1 ? '' : 's'}.`)
  if (!clip) throw new Error(`Adult sedgehorn GLB is missing the ${clipName} animation.`)

  return <primitive object={root} />
}
