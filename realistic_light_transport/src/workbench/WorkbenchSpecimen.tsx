import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

import type { SpecimenAsset } from '../scene/specimens/assetRegistry'

export type WorkbenchClipName = SpecimenAsset['clips'][number]

export interface WorkbenchAssetStats {
  readonly triangles: number
  readonly nodes: number
  readonly bones: number
  readonly materials: number
  readonly clips: readonly { readonly name: string; readonly duration: number }[]
}

interface WorkbenchSpecimenProps {
  readonly asset: SpecimenAsset
  readonly clipName: WorkbenchClipName
  readonly playing: boolean
  readonly playbackRate: number
  readonly phase: number
  readonly wireframe: boolean
  readonly showSkeleton: boolean
  readonly castShadow: boolean
  readonly turntable: boolean
  readonly onReady: (stats: WorkbenchAssetStats) => void
  readonly onMissingClip: (message?: string) => void
  readonly onPhase: (phase: number) => void
}

function countTriangles(geometry: THREE.BufferGeometry) {
  return geometry.index ? geometry.index.count / 3 : (geometry.getAttribute('position')?.count ?? 0) / 3
}

export function WorkbenchSpecimen({
  asset,
  clipName,
  playing,
  playbackRate,
  phase,
  wireframe,
  showSkeleton,
  castShadow,
  turntable,
  onReady,
  onMissingClip,
  onPhase,
}: WorkbenchSpecimenProps) {
  const source = useLoader(GLTFLoader, asset.url)
  const turntableRoot = useRef<THREE.Group>(null)
  const mounted = useRef(false)
  const root = useMemo(() => {
    const cloned = cloneSkinned(source.scene) as THREE.Group
    cloned.name = `workbench-${asset.speciesId}`
    cloned.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      node.material = Array.isArray(node.material)
        ? node.material.map((material) => material.clone())
        : node.material.clone()
    })
    return cloned
  }, [asset.speciesId, source.scene])
  const mixer = useMemo(() => new THREE.AnimationMixer(root), [root])
  const skeletonHelper = useMemo(() => {
    const helper = new THREE.SkeletonHelper(root)
    helper.name = 'workbench-skeleton'
    const materials = Array.isArray(helper.material) ? helper.material : [helper.material]
    materials.forEach((material) => {
      material.depthTest = false
      material.transparent = true
      material.opacity = 0.9
    })
    return helper
  }, [root])
  const action = useMemo(() => {
    const clip = THREE.AnimationClip.findByName(source.animations, clipName)
    return clip ? mixer.clipAction(clip, root) : undefined
  }, [clipName, mixer, root, source.animations])

  useEffect(() => {
    let triangles = 0
    let runtimeNodes = 0
    let bones = 0
    const runtimeMaterials = new Set<string>()

    root.traverse((node) => {
      runtimeNodes += 1
      if (node instanceof THREE.Bone) bones += 1
      if (!(node instanceof THREE.Mesh)) return
      triangles += countTriangles(node.geometry)
      const meshMaterials = Array.isArray(node.material) ? node.material : [node.material]
      meshMaterials.forEach((material) => runtimeMaterials.add(material.uuid))
    })

    const parserJson = (source.parser as unknown as {
      readonly json?: { readonly nodes?: readonly unknown[]; readonly materials?: readonly unknown[] }
    }).json

    onReady({
      triangles,
      nodes: parserJson?.nodes?.length ?? runtimeNodes,
      bones,
      materials: parserJson?.materials?.length ?? runtimeMaterials.size,
      clips: source.animations.map((clip) => ({ name: clip.name, duration: clip.duration })),
    })
  }, [onReady, root, source.animations])

  useEffect(() => {
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      node.castShadow = castShadow
      node.receiveShadow = castShadow
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      materials.forEach((material) => {
        material.depthTest = true
        material.depthWrite = true
        material.wireframe = wireframe
        material.needsUpdate = true
      })
    })
  }, [castShadow, root, wireframe])

  useEffect(() => {
    skeletonHelper.visible = showSkeleton
  }, [showSkeleton, skeletonHelper])

  useEffect(() => {
    mixer.stopAllAction()
    if (!action) {
      onMissingClip(`The asset does not contain the requested “${clipName}” clip.`)
      return
    }
    onMissingClip()
    action.reset().setLoop(clipName === 'burst' ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
    action.clampWhenFinished = clipName === 'burst'
    action.play()
    mixer.setTime(phase * action.getClip().duration)
    return () => {
      action.stop()
    }
  }, [action, clipName, mixer, onMissingClip])

  useEffect(() => {
    if (!playing && action) mixer.setTime(phase * action.getClip().duration)
  }, [action, mixer, phase, playing])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      window.requestAnimationFrame(() => {
        if (mounted.current) return
        mixer.stopAllAction()
        mixer.uncacheRoot(root)
        skeletonHelper.geometry.dispose()
        const helperMaterials = Array.isArray(skeletonHelper.material) ? skeletonHelper.material : [skeletonHelper.material]
        helperMaterials.forEach((material) => material.dispose())
        root.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return
          const materials = Array.isArray(node.material) ? node.material : [node.material]
          materials.forEach((material) => material.dispose())
        })
      })
    }
  }, [mixer, root, skeletonHelper])

  useFrame((_, delta) => {
    if (playing && action) {
      mixer.update(Math.min(delta, 0.05) * playbackRate)
      const duration = action.getClip().duration
      if (duration > 0) onPhase(Math.min(action.time / duration, 1))
    }
    if (turntable && turntableRoot.current) {
      turntableRoot.current.rotation.y += Math.min(delta, 0.05) * 0.55
    }
  })

  return (
    <group ref={turntableRoot}>
      <primitive object={root} />
      <primitive object={skeletonHelper} />
    </group>
  )
}
