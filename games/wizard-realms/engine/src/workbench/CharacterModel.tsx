import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import type { CharacterCandidate, CharacterClip } from './characterCatalog'

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
  readonly playing: boolean
  readonly playbackRate: number
  readonly phase: number
  readonly wireframe: boolean
  readonly showSkeleton: boolean
  readonly turntable: boolean
  readonly onReady: (stats: CharacterStats) => void
  readonly onClipError: (error?: string) => void
  readonly onPhase: (phase: number) => void
}

export function CharacterModel({
  candidate, clipName, playing, playbackRate, phase, wireframe, showSkeleton, turntable,
  onReady, onClipError, onPhase,
}: CharacterModelProps) {
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
    mixer.stopAllAction()
    if (!action) {
      onClipError(`The GLB does not contain the requested ${clipName} animation.`)
      return
    }
    onClipError()
    action.reset().setLoop(THREE.LoopRepeat, Infinity).play()
    mixer.setTime(0)
    return () => { action.stop() }
  }, [action, clipName, mixer, onClipError])

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
      if (playing) mixer.update(Math.min(delta, 0.05) * playbackRate)
      else mixer.setTime(phase * clip.duration)
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

  return <group ref={turntableRoot}>
    <primitive object={root} />
    <primitive object={skeleton} />
  </group>
}
