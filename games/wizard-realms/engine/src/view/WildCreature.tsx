import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

const sourcesByUrl = new Map<string, Promise<GLTF>>()

function loadSource(modelUrl: string): Promise<GLTF> {
  const cached = sourcesByUrl.get(modelUrl)
  if (cached) return cached
  const pending = new Promise<GLTF>((resolve, reject) => {
    new GLTFLoader().load(modelUrl, resolve, undefined, reject)
  })
  sourcesByUrl.set(modelUrl, pending)
  void pending.catch(() => {
    if (sourcesByUrl.get(modelUrl) === pending) sourcesByUrl.delete(modelUrl)
  })
  return pending
}

export type WildCreatureProps = {
  id: string
  label: string
  modelUrl: string
  position: readonly [number, number, number]
  yaw: number
  scale: number
  idleClip: 'Idle'
  hiddenNodes: readonly string[]
}

/** An untacked, non-interactive creature shown only while its encounter is visible. */
export function WildCreature({ id, label, modelUrl, position, yaw, scale, idleClip,
  hiddenNodes }: WildCreatureProps) {
  const [loaded, setLoaded] = useState<{ url: string; source: GLTF } | null>(null)
  useEffect(() => {
    let mounted = true
    void loadSource(modelUrl).then(
      (source) => { if (mounted) setLoaded({ url: modelUrl, source }) },
      (error) => { if (mounted) console.error(`Wild creature ${id} could not load`, error) },
    )
    return () => { mounted = false }
  }, [id, modelUrl])

  const source = loaded?.url === modelUrl ? loaded.source : null
  const model = useMemo(() => {
    if (!source) return null
    const copy = cloneSkinned(source.scene) as THREE.Group
    copy.name = `${label} (untacked)`
    for (const name of hiddenNodes) (copy.getObjectByName(name)
      ?? copy.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)))?.traverse((node) => {
      node.visible = false
    })
    copy.traverse((node) => {
      if ((node as THREE.Mesh).isMesh !== true) return
      const mesh = node as THREE.Mesh
      mesh.castShadow = true
      mesh.raycast = () => {}
    })
    return copy
  }, [source, hiddenNodes, label])
  const mixer = useMemo(() => model ? new THREE.AnimationMixer(model) : null, [model])
  useEffect(() => {
    if (!mixer || !model || !source) return
    const clip = THREE.AnimationClip.findByName(source.animations, idleClip)
    if (clip) mixer.clipAction(clip).play()
    else console.error(`Wild creature ${id} is missing its ${idleClip} animation`)
    return () => {
      mixer.stopAllAction()
      mixer.uncacheRoot(model)
      const skeletons = new Set<THREE.Skeleton>()
      model.traverse((node) => {
        if ((node as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((node as THREE.SkinnedMesh).skeleton)
      })
      skeletons.forEach((skeleton) => skeleton.dispose())
    }
  }, [id, idleClip, mixer, model, source])
  useFrame((_, delta) => { mixer?.update(delta) })

  if (!model) return null
  return <group name={`${label}, visual encounter only`}
    position={[position[0], position[1], position[2]]}
    rotation={[0, yaw, 0]} scale={scale}>
    <primitive object={model} />
  </group>
}
