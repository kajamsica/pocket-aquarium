import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { seededUnit } from './reefLayout'

const FLOOR_Y = -1.405
const DECORATION_NO_RAYCAST = () => undefined

function DriftwoodBranch({ from, to, radius }: {
  readonly from: readonly [number, number, number]
  readonly to: readonly [number, number, number]
  readonly radius: number
}) {
  const transform = useMemo(() => {
    const start = new THREE.Vector3(...from)
    const end = new THREE.Vector3(...to)
    const direction = end.clone().sub(start)
    return {
      position: start.add(end).multiplyScalar(.5),
      height: direction.length(),
      quaternion: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), direction.normalize(),
      ),
    }
  }, [from, to])
  return <mesh position={transform.position} quaternion={transform.quaternion} castShadow receiveShadow
    raycast={DECORATION_NO_RAYCAST}>
    <cylinderGeometry args={[radius * .62, radius, transform.height, 9]} />
    <meshStandardMaterial color="#4a2e1c" roughness={.98} />
  </mesh>
}

function Spiderwood() {
  const branches = [
    [[-2.1, FLOOR_Y, -.35], [-.7, -.66, -.18], .18],
    [[-1.62, -1.12, -.3], [-1.45, .18, -.42], .11],
    [[-1.28, -.92, -.27], [-.42, -.05, -.38], .09],
    [[-.82, -.75, -.22], [-.2, .42, -.32], .075],
    [[.62, FLOOR_Y, .25], [1.45, -.56, .18], .15],
    [[1.2, -.78, .2], [1.88, .14, .12], .08],
    [[1.22, -.72, .2], [2.12, -.48, -.08], .07],
  ] as const
  return <group name="freshwater-spiderwood">
    {branches.map(([from, to, radius], index) => <DriftwoodBranch key={index}
      from={from} to={to} radius={radius} />)}
  </group>
}

const PLANTS = [
  { x: -2.25, z: -.66, scale: 1.04, hue: '#477f3e' },
  { x: -1.78, z: .48, scale: .78, hue: '#5a9147' },
  { x: .35, z: -.72, scale: .92, hue: '#3d783e' },
  { x: 2.12, z: .58, scale: .86, hue: '#548c45' },
] as const

function SwordPlant({ x, z, scale, hue }: typeof PLANTS[number]) {
  return <group position={[x, FLOOR_Y, z]} scale={scale} name="freshwater-sword-plant"
    raycast={DECORATION_NO_RAYCAST}>
    {Array.from({ length: 8 }, (_, index) => {
      const angle = index / 8 * Math.PI * 2
      const tilt = .18 + (index % 3) * .1
      return <mesh key={index} position={[Math.cos(angle) * .06, .28, Math.sin(angle) * .06]}
        rotation={[Math.sin(angle) * tilt, angle, Math.cos(angle) * tilt]}
        scale={[.055, .38 + (index % 3) * .08, .13]} castShadow>
        <sphereGeometry args={[1, 7, 5]} />
        <meshStandardMaterial color={hue} roughness={.88} side={THREE.DoubleSide} />
      </mesh>
    })}
  </group>
}

function LeafLitter() {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useLayoutEffect(() => {
    if (!mesh.current) return
    for (let index = 0; index < 34; index += 1) {
      dummy.position.set(-2.45 + seededUnit(index, 701) * 4.9, FLOOR_Y + .012,
        -.98 + seededUnit(index, 702) * 1.96)
      dummy.rotation.set(-Math.PI / 2 + (seededUnit(index, 703) - .5) * .16,
        seededUnit(index, 704) * Math.PI, (seededUnit(index, 705) - .5) * .18)
      const size = .065 + seededUnit(index, 706) * .085
      dummy.scale.set(size, size * (.42 + seededUnit(index, 707) * .22), 1)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(index, dummy.matrix)
    }
    mesh.current.instanceMatrix.needsUpdate = true
  }, [dummy])
  return <instancedMesh ref={mesh} args={[undefined, undefined, 34]}
    raycast={DECORATION_NO_RAYCAST} receiveShadow>
    <circleGeometry args={[1, 9]} />
    <meshStandardMaterial color="#76502c" roughness={1} side={THREE.DoubleSide} />
  </instancedMesh>
}

export function FreshwaterHabitat() {
  return <group name="freshwater-hardscape">
    <Spiderwood />
    <LeafLitter />
    {PLANTS.map((plant) => <SwordPlant key={`${plant.x}:${plant.z}`} {...plant} />)}
  </group>
}
