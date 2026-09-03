import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

import type { SpecimenAsset } from './assetRegistry'

export interface RiggedSpecimenProps {
  readonly asset: SpecimenAsset
  readonly individualId: number
  readonly targetLengthSceneUnits: number
  readonly stage: string
  readonly hunger: number
  /** Live 0..1 feeding-pursuit drive updated each frame by the fish's steering. */
  readonly feedDrive: RefObject<number>
}

function phaseForId(id: number) {
  const value = Math.sin((id + 1) * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

export function RiggedSpecimen({ asset, individualId, targetLengthSceneUnits, stage, hunger, feedDrive }: RiggedSpecimenProps) {
  const source = useLoader(GLTFLoader, asset.url)
  const root = useMemo(() => cloneSkinned(source.scene) as THREE.Group, [source.scene])
  const mixer = useMemo(() => new THREE.AnimationMixer(root), [root])
  const actions = useRef<Partial<Record<(typeof asset.clips)[number], THREE.AnimationAction>>>({})
  const seeded = useRef(false)

  useEffect(() => {
    root.name = `rigged-${asset.speciesId}-${individualId}`
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
      const action = mixer.clipAction(clip, root)
      action.enabled = true
      action.setLoop(clipName === 'burst' ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
      action.clampWhenFinished = clipName === 'burst'
      action.play()
      actions.current[clipName] = action
    }
    const firstLoop = actions.current.swim ?? actions.current.idle
    if (firstLoop && !seeded.current) {
      mixer.setTime(firstLoop.getClip().duration * phaseForId(individualId))
      seeded.current = true
    }
    return () => {
      mixer.stopAllAction()
      mixer.uncacheRoot(root)
      actions.current = {}
    }
  }, [asset.clips, asset.speciesId, individualId, mixer, root, source.animations, stage])

  useFrame((_, delta) => {
    const burstDrive = THREE.MathUtils.clamp(feedDrive.current, 0, 1)
    const swim = actions.current.swim
    const idle = actions.current.idle
    const burst = actions.current.burst
    if (swim) {
      swim.setEffectiveWeight(0.78 - burstDrive * 0.54)
      swim.setEffectiveTimeScale(0.92 + hunger * 0.28 + burstDrive * 0.34)
    }
    idle?.setEffectiveWeight(0.22 - burstDrive * 0.14)
    if (burst) {
      burst.setEffectiveWeight(burstDrive)
      burst.setEffectiveTimeScale(1.15 + burstDrive * 0.45)
      if (burstDrive > 0.12 && !burst.isRunning()) burst.reset().play()
    }
    mixer.update(Math.min(delta, 0.05))
  })

  const authoredScale = targetLengthSceneUnits / asset.referenceAdultLengthMeters
  return <primitive object={root} scale={authoredScale} />
}
