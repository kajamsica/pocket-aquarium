import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import type { MorphologyProfileV1 } from '../specimens/specimenProfile'
import type { EvaluatedMorphology } from './geometry/evaluateMorphology'

interface EditableSpecimenProps {
  readonly profile: MorphologyProfileV1
  readonly evaluated: EvaluatedMorphology
  readonly accepted?: EvaluatedMorphology
  readonly showAcceptedGhost: boolean
  readonly wireframe: boolean
  readonly showSkeleton: boolean
  readonly clipPhase: number
}

export function EditableSpecimen({ profile, evaluated, accepted, showAcceptedGhost, wireframe, showSkeleton, clipPhase }: EditableSpecimenProps) {
  const skeleton = useMemo(() => new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(profile.controlStations.map((station) => new THREE.Vector3(station.x, station.centerY, station.centerZ))),
    new THREE.LineBasicMaterial({ color: '#fff4b8', depthTest: false }),
  ), [profile.controlStations])

  useEffect(() => () => { skeleton.geometry.dispose(); skeleton.material.dispose() }, [skeleton])

  return (
    <group userData={{ clipPhase, geometryDigest: evaluated.digest.value }}>
      {showAcceptedGhost && accepted && (
        <mesh geometry={accepted.geometry} renderOrder={1}>
          <meshBasicMaterial color="#48b8c7" transparent opacity={0.24} wireframe depthWrite={false} />
        </mesh>
      )}
      <mesh geometry={evaluated.geometry} castShadow receiveShadow renderOrder={2}>
        <meshPhysicalMaterial color="#e96c24" roughness={0.48} clearcoat={0.18} wireframe={wireframe} />
      </mesh>
      {showSkeleton && <primitive object={skeleton} renderOrder={3} />}
    </group>
  )
}
