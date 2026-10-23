import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { WildCreature } from './WildCreature'

const harness = vi.hoisted(() => ({
  loaded: null as { url: string; source: unknown } | null,
  source: null as unknown,
  cleanups: [] as (() => void)[],
}))

vi.mock('@react-three/fiber', () => ({ useFrame: () => {} }))
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(_url: string, onLoad: (source: unknown) => void) { onLoad(harness.source) }
  },
}))
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      const cleanup = effect()
      if (cleanup) harness.cleanups.push(cleanup)
    },
    useMemo: (factory: () => unknown) => factory(),
    useState: () => [harness.loaded, (value: typeof harness.loaded) => { harness.loaded = value }],
  }
})

describe('wild creature presentation', () => {
  it('hides exact and GLB-sanitized tack names without hiding body or accepting ray picks', () => {
    const source = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    body.name = 'Body'
    const saddle = new THREE.Group()
    saddle.name = 'BM_saddle'
    saddle.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()))
    const guard = new THREE.Group()
    guard.name = THREE.PropertyBinding.sanitizeNodeName('BM_guard.L')
    guard.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()))
    source.add(body, saddle, guard)
    harness.source = { scene: source, animations: [new THREE.AnimationClip('Idle', 1, [])] }
    harness.loaded = null
    harness.cleanups = []
    const props = { id: 'barrow-mole', label: 'Wild Barrow', modelUrl: '/barrow.glb',
      position: [528, 2, -496] as const, yaw: 0, scale: 1, idleClip: 'Idle' as const,
      hiddenNodes: ['BM_saddle', 'BM_guard.L'] }

    expect(WildCreature(props)).toBeNull()
    const rendered = WildCreature(props)
    expect(rendered).not.toBeNull()
    const model = rendered!.props.children.props.object as THREE.Group
    expect(model.getObjectByName('BM_saddle')?.visible).toBe(false)
    expect(model.getObjectByName('BM_saddle')?.children[0].visible).toBe(false)
    expect(model.getObjectByName(guard.name)?.visible).toBe(false)
    expect(model.getObjectByName('Body')?.visible).toBe(true)
    expect(saddle.visible).toBe(true)
    expect((model.getObjectByName('Body') as THREE.Mesh).raycast)
      .not.toBe(THREE.Mesh.prototype.raycast)
    harness.cleanups.forEach((cleanup) => cleanup())
  })
})
