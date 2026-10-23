import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { WildCreature } from './WildCreature'

const harness = vi.hoisted(() => ({
  loaded: null as { url: string; source: unknown } | null,
  source: null as unknown,
  cleanups: [] as (() => void)[],
  loadUrls: [] as string[],
  failOnceUrl: null as string | null,
}))

vi.mock('@react-three/fiber', () => ({ useFrame: () => {} }))
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(url: string, onLoad: (source: unknown) => void, _progress: unknown,
      onError: (error: Error) => void) {
      harness.loadUrls.push(url)
      if (harness.failOnceUrl === url) {
        harness.failOnceUrl = null
        onError(new Error('temporary load failure'))
      } else onLoad(harness.source)
    }
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
  it('hides exact and GLB-sanitized tack names without hiding body or accepting ray picks', async () => {
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
    harness.loadUrls = []
    const props = { id: 'barrow-mole', label: 'Wild Barrow', modelUrl: '/barrow.glb',
      position: [528, 2, -496] as const, yaw: 0, scale: 1, idleClip: 'Idle' as const,
      hiddenNodes: ['BM_saddle', 'BM_guard.L'] }

    expect(WildCreature(props)).toBeNull()
    await Promise.resolve()
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

  it('parses once across concurrent and repeat mounts, and retries a failed load', async () => {
    const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    body.name = 'Body'
    const source = new THREE.Group()
    source.add(body)
    harness.source = { scene: source, animations: [new THREE.AnimationClip('Idle', 1, [])] }
    harness.loaded = null
    harness.cleanups = []
    harness.loadUrls = []
    const props = { id: 'cache-test', label: 'Wild Cache Test', modelUrl: '/cache-test.glb',
      position: [0, 0, 0] as const, yaw: 0, scale: 1, idleClip: 'Idle' as const,
      hiddenNodes: [] }

    expect(WildCreature(props)).toBeNull()
    expect(WildCreature(props)).toBeNull()
    expect(harness.loadUrls).toEqual(['/cache-test.glb'])
    await Promise.resolve()
    const first = WildCreature(props)!
    const firstBody = first.props.children.props.object.getObjectByName('Body') as THREE.Mesh
    expect(firstBody.geometry).toBe(body.geometry)
    expect(firstBody.material).toBe(body.material)
    harness.cleanups.forEach((cleanup) => cleanup())

    harness.loaded = null
    harness.cleanups = []
    expect(WildCreature(props)).toBeNull()
    await Promise.resolve()
    expect(WildCreature(props)).not.toBeNull()
    expect(harness.loadUrls).toEqual(['/cache-test.glb'])
    harness.cleanups.forEach((cleanup) => cleanup())

    harness.loaded = null
    harness.cleanups = []
    harness.failOnceUrl = '/retry-test.glb'
    const retryProps = { ...props, id: 'retry-test', modelUrl: '/retry-test.glb' }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(WildCreature(retryProps)).toBeNull()
    await Promise.resolve()
    expect(harness.loadUrls.filter((url) => url === '/retry-test.glb')).toHaveLength(1)
    harness.cleanups.forEach((cleanup) => cleanup())
    harness.cleanups = []
    harness.loaded = null
    expect(WildCreature(retryProps)).toBeNull()
    expect(harness.loadUrls.filter((url) => url === '/retry-test.glb')).toHaveLength(2)
    await Promise.resolve()
    expect(WildCreature(retryProps)).not.toBeNull()
    harness.cleanups.forEach((cleanup) => cleanup())
    error.mockRestore()
  })

  it('disposes the clone skeleton but retains shared geometry and material', async () => {
    const bone = new THREE.Bone()
    const body = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    body.name = 'SkinnedBody'
    body.add(bone)
    body.bind(new THREE.Skeleton([bone]))
    const source = new THREE.Group()
    source.add(body)
    harness.source = { scene: source, animations: [new THREE.AnimationClip('Idle', 1, [])] }
    harness.loaded = null
    harness.cleanups = []
    const props = { id: 'skeleton-test', label: 'Wild Skeleton Test', modelUrl: '/skeleton-test.glb',
      position: [0, 0, 0] as const, yaw: 0, scale: 1, idleClip: 'Idle' as const,
      hiddenNodes: [] }

    expect(WildCreature(props)).toBeNull()
    await Promise.resolve()
    const rendered = WildCreature(props)!
    const clone = rendered.props.children.props.object.getObjectByName('SkinnedBody') as THREE.SkinnedMesh
    expect(clone.skeleton).not.toBe(body.skeleton)
    expect(clone.geometry).toBe(body.geometry)
    expect(clone.material).toBe(body.material)
    const dispose = vi.spyOn(clone.skeleton, 'dispose')
    const sourceDispose = vi.spyOn(body.skeleton, 'dispose')
    harness.cleanups.forEach((cleanup) => cleanup())
    expect(dispose).toHaveBeenCalledOnce()
    expect(sourceDispose).not.toHaveBeenCalled()
  })
})
