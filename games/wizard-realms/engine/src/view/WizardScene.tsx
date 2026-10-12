import { Canvas, useFrame } from '@react-three/fiber'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { WizardBuildSite, WizardDigSite, WizardFairyRing, WizardInscription, WizardLandmark, WizardRegionalLaddersView, WizardResourceNode, WizardRoute, WizardStore, WizardTerrainCell, WizardV26PitLadder, WizardV30BridgeheadPost, WizardViewProjection } from './contracts'
import type { BuiltTerrainWorkTrialSite } from '../domain/terrainWorkTrial'
import type { PublicV23ResolvedSite } from '../domain/publicWorldV23Sites'
import type { StarterCliffFace } from '../domain/starterCliffProfile'
import { PUBLIC_VISUAL_RADIUS_CELLS, visibleTerrainCells } from './visibleTerrain'
import { LandscapeDressing } from './LandscapeDressingLayer'
import { GreenwayCreekWaterLayer, MireglassWaterLayer } from './MireglassWaterLayer'
import { MireglassCliffLayer } from './MireglassCliffLayer'
import { HighlandRidgeLayer } from './HighlandRidgeLayer'
import { createTerrainSurfaceSampler, DISCOVERY_FOG_COLOR, terrainSignature, TerrainSurfaceLayer } from './TerrainSurfaceLayer'
import { V26ValleyRimLayer } from './V26ValleyRimLayer'
import { pickV26TerrainColumn, type V26PickedTerrainColumn, type V26TerrainPickKind } from './V26TerrainPicker'
import { highlandRidgeCellAt, highlandRidgeMoveBarrier } from '../domain/highlandRidge'
import { discoveredTileSet } from '../domain/publicWorldDiscovery'
import { publicV25RiverCellAtGrid } from '../domain/publicWorldV25River'
import { publicV26TerrainCellIsWet } from '../domain/publicWorldV26TerrainSurface'
import { publicV14InsideGreenway } from '../domain/publicWorldV14Boundary'
import { publicV23PlacementId, resolvePublicV23Site } from '../domain/publicWorldV23Sites'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from '../domain/worldChunks'

// Authoritative transforms arrive at 20 Hz; the view eases a presentation pose toward them each frame.
const TELEPORT_SNAP_DISTANCE_M = 3
const POSITION_DAMPING_PER_S = 14
const YAW_DAMPING_PER_S = 16
const SPEED_DAMPING_PER_S = 10
const WALK_SPEED_M_PER_S = 3.2
const STRIDE_LENGTH_M = 1.4
const LEG_SWING_RAD = 0.5
const ARM_SWING_RAD = 0.3
const BODY_BOB_M = 0.05

// Atmosphere palette. three applies fog after tone mapping and colour-space conversion, and both fog and clear colour
// are converted as unlit output-space colours, so these values compare directly (neither is ACES-compressed).
// The fog is kept marginally brighter than the sky on purpose, for a soft haze band above the far terrain edge.
const SKY_COLOR = '#8fc0d6'
const FOG_COLOR = DISCOVERY_FOG_COLOR
export const PUBLIC_FOG_START_M = 24
export const PUBLIC_FOG_END_M = 31
export const fogEndFor = (hasPublicVisualWorld: boolean) => hasPublicVisualWorld ? PUBLIC_FOG_END_M : 40
export function sceneGraphicsOptionsForSearch(search: string) {
  const software = new URLSearchParams(search).get('graphics') === 'software'
  const dpr: number | [number, number] = software ? 1 : [1, 1.5]
  return { dpr, shadows: software ? false : { type: THREE.PCFShadowMap }, antialias: !software }
}
const BEDROCK_COLOR = '#4a6a3e'
const BEDROCK_MIN_FACE_M = (WORLD_GRID_MIN - 0.5) * WORLD_CELL_METERS
const BEDROCK_MAX_FACE_M = (WORLD_GRID_MAX + 0.5) * WORLD_CELL_METERS
export const WORLD_BEDROCK_BOUNDS = {
  west: BEDROCK_MIN_FACE_M,
  east: BEDROCK_MAX_FACE_M,
  north: BEDROCK_MIN_FACE_M,
  south: BEDROCK_MAX_FACE_M,
  centerX: (BEDROCK_MIN_FACE_M + BEDROCK_MAX_FACE_M) / 2,
  centerZ: (BEDROCK_MIN_FACE_M + BEDROCK_MAX_FACE_M) / 2,
  width: BEDROCK_MAX_FACE_M - BEDROCK_MIN_FACE_M,
  depth: BEDROCK_MAX_FACE_M - BEDROCK_MIN_FACE_M,
} as const
const UNCHARTED_GROUND_MATERIAL = new THREE.MeshBasicMaterial({ color: '#5b657c', fog: false })

// Shared geometry/material instances for primitives that have no per-instance variance.
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const TERRAIN_TARGET_OUTLINE = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-1.45, 0, -1.45), new THREE.Vector3(1.45, 0, -1.45),
  new THREE.Vector3(1.45, 0, 1.45), new THREE.Vector3(-1.45, 0, 1.45),
])
const TERRAIN_TARGET_MATERIAL = new THREE.LineBasicMaterial({ color: '#b7d8e1', transparent: true,
  opacity: 0.8, depthWrite: false })
const WORKS_SURVEY_MATERIAL = new THREE.LineBasicMaterial({ color: '#c6e7ed', transparent: true,
  opacity: 0.95, depthWrite: false })
const MIREGLASS_PATCH_GEOMETRY = new THREE.CircleGeometry(1, 9)
MIREGLASS_PATCH_GEOMETRY.rotateX(-Math.PI / 2)
const LEAF_GEOMETRY = new THREE.IcosahedronGeometry(1, 1)
const ROCK_GEOMETRY = new THREE.DodecahedronGeometry(1, 0)
const CRYSTAL_GEOMETRY = new THREE.OctahedronGeometry(1, 0)
const AVATAR_ROUND_GEOMETRY = new THREE.SphereGeometry(1, 14, 10)
const ROBE_GEOMETRY = new THREE.LatheGeometry([
  new THREE.Vector2(0.48, 0.2), new THREE.Vector2(0.54, 0.25), new THREE.Vector2(0.5, 0.36),
  new THREE.Vector2(0.38, 0.68), new THREE.Vector2(0.28, 1.02), new THREE.Vector2(0.29, 1.28),
  new THREE.Vector2(0.35, 1.48), new THREE.Vector2(0.25, 1.58),
], 16)
const WADER_ROBE_GEOMETRY = new THREE.LatheGeometry([
  new THREE.Vector2(0.36, 0.57), new THREE.Vector2(0.43, 0.63), new THREE.Vector2(0.4, 0.74),
  new THREE.Vector2(0.3, 1.02), new THREE.Vector2(0.29, 1.28), new THREE.Vector2(0.35, 1.48),
  new THREE.Vector2(0.25, 1.58),
], 16)
const ROBE_HEM_GEOMETRY = new THREE.CylinderGeometry(0.51, 0.54, 0.08, 16)
const ROBE_MANTLE_GEOMETRY = new THREE.CylinderGeometry(0.38, 0.46, 0.68, 16, 2, true, -Math.PI / 2, Math.PI)
const ROBE_BELT_GEOMETRY = new THREE.CylinderGeometry(0.33, 0.34, 0.09, 16)
const ROBE_FOLD_GEOMETRY = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 1.03, 0.27), new THREE.Vector3(0, 0.82, 0.31),
  new THREE.Vector3(0, 0.52, 0.39), new THREE.Vector3(0, 0.29, 0.49),
]), 10, 0.025, 4, false)
const SATCHEL_STRAP_GEOMETRY = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.2, 1.54, 0.31), new THREE.Vector3(-0.1, 1.35, 0.43),
  new THREE.Vector3(0.17, 1.13, 0.43), new THREE.Vector3(0.43, 0.93, 0.21),
]), 10, 0.03, 4, false)
const SLEEVE_GEOMETRY = new THREE.CylinderGeometry(0.12, 0.18, 0.68, 12)
const LEG_GEOMETRY = new THREE.CylinderGeometry(0.1, 0.13, 0.65, 10)
// A waisted, pointed surcoat follows the robe; shallow flutes keep the cloth from reading as a flat apron.
const TRAVELER_TUNIC_PANELS = ([-1, 1] as const).map((side) => {
  const vertices: number[] = []
  const colors: number[] = []
  const folds = [-1, -0.55, 0, 0.55, 1]
  const rows = [[1.47, 0.23, 0.5], [1.24, 0.25, 0.5], [1.03, 0.19, 0.5],
    [0.78, 0.28, 0.51], [0.56, 0.36, 0.53]]
  const cloth = new THREE.Color('#a78b67')
  for (const [row, [y, width, radius]] of rows.entries()) {
    for (const fold of folds) {
      const x = fold * width
      const hem = row === rows.length - 1 ? 0.05 * Math.abs(fold) - 0.11 * (1 - Math.abs(fold)) : 0
      const depth = radius + (fold === 0 ? 0.015 : Math.abs(fold) === 0.55 ? -0.006 : 0)
      vertices.push(x, y + hem, side * Math.sqrt(depth * depth - x * x))
      cloth.clone().multiplyScalar(fold === 0 ? 1.05 : Math.abs(fold) === 1 ? 0.72 : 0.9).toArray(colors, colors.length)
    }
  }
  const triangles: number[] = []
  for (let row = 0; row < rows.length - 1; row++) for (let column = 0; column < folds.length - 1; column++) {
    const a = row * folds.length + column, b = a + folds.length
    triangles.push(...(side < 0 ? [a, a + 1, b, a + 1, b + 1, b]
      : [a, b, a + 1, a + 1, b, b + 1]))
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(triangles)
  geometry.computeVertexNormals()
  return geometry
})
const TRAVELER_TUNIC_BELT_GEOMETRY = new THREE.CylinderGeometry(0.52, 0.52, 0.085, 16)
const COLLAR_GEOMETRY = new THREE.TorusGeometry(0.23, 0.026, 6, 16)
const HAT_GEOMETRY = new THREE.LatheGeometry([
  new THREE.Vector2(0.42, 0), new THREE.Vector2(0.38, 0.08), new THREE.Vector2(0.3, 0.28),
  new THREE.Vector2(0.24, 0.46), new THREE.Vector2(0.13, 0.62), new THREE.Vector2(0.03, 0.7),
], 16)
const AXE_BLADE_GEOMETRY = new THREE.ExtrudeGeometry(new THREE.Shape([
  new THREE.Vector2(-0.06, -0.12), new THREE.Vector2(0.16, -0.16),
  new THREE.Vector2(0.5, -0.3), new THREE.Vector2(0.43, 0),
  new THREE.Vector2(0.5, 0.3), new THREE.Vector2(0.16, 0.16),
  new THREE.Vector2(-0.06, 0.12),
]), { depth: 0.09, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.015, bevelThickness: 0.015 })
const SPADE_BLADE_GEOMETRY = new THREE.ExtrudeGeometry(new THREE.Shape([
  new THREE.Vector2(-0.25, 0.24), new THREE.Vector2(0.25, 0.24),
  new THREE.Vector2(0.24, -0.12), new THREE.Vector2(0, -0.42),
  new THREE.Vector2(-0.24, -0.12),
]), { depth: 0.06, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.012, bevelThickness: 0.012 })
const SHIELD_GEOMETRY = new THREE.ExtrudeGeometry(new THREE.Shape([
  new THREE.Vector2(-0.3, 0.36), new THREE.Vector2(0.3, 0.36),
  new THREE.Vector2(0.29, -0.12), new THREE.Vector2(0, -0.43),
  new THREE.Vector2(-0.29, -0.12),
]), { depth: 0.07, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.025, bevelThickness: 0.018 })
const WOOD_MATERIAL = new THREE.MeshStandardMaterial({ color: '#6e4a30', roughness: 0.92 })
const DARK_WOOD_MATERIAL = new THREE.MeshStandardMaterial({ color: '#4a3222', roughness: 0.9 })
const LADDER_RUNG_MATERIAL = new THREE.MeshStandardMaterial({ color: '#bf9660', roughness: 0.86 })
const ladderRungCount = (length: number) => Math.min(7, Math.max(5, Math.ceil(length / 0.4)))
const STAKE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#9a8a70', roughness: 0.9 })
const BRIDGEHEAD_SIGN_MATERIAL = new THREE.MeshStandardMaterial({ color: '#477782', roughness: 0.75 })
const BRIDGEHEAD_MARK_MATERIAL = new THREE.MeshStandardMaterial({ color: '#bce7eb', roughness: 0.38,
  emissive: '#5b9299', emissiveIntensity: 0.28 })
const ROBE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#4f3176', roughness: 0.76 })
const ROBE_TRIM_MATERIAL = new THREE.MeshStandardMaterial({ color: '#2d1f45', roughness: 0.82 })
const ROBE_FOLD_MATERIAL = new THREE.MeshStandardMaterial({ color: '#75539a', roughness: 0.86 })
const SKIN_MATERIAL = new THREE.MeshStandardMaterial({ color: '#d6a27a', roughness: 0.82 })
const HAIR_MATERIAL = new THREE.MeshStandardMaterial({ color: '#4a302b', roughness: 0.9 })
const EYE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#292032', roughness: 0.7 })
const TUNIC_MATERIAL = new THREE.MeshStandardMaterial({ color: '#8c6e4d', roughness: 0.9 })
const TRAVELER_TUNIC_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86,
  side: THREE.DoubleSide })
const WADER_MATERIAL = new THREE.MeshStandardMaterial({ color: '#41695f', roughness: 0.88 })
const WADER_CUFF_MATERIAL = new THREE.MeshStandardMaterial({ color: '#9ab6a0', roughness: 0.84 })
const GOLD_MATERIAL = new THREE.MeshStandardMaterial({ color: '#d4aa52', roughness: 0.38, metalness: 0.45 })
const ROUTE_GHOST_MATERIAL = new THREE.MeshBasicMaterial({ color: '#8cece3', transparent: true,
  opacity: 0.76, depthWrite: false, wireframe: true })
const ROUTE_BLOCKED_GHOST_MATERIAL = new THREE.MeshBasicMaterial({ color: '#f18c79', transparent: true,
  opacity: 0.76, depthWrite: false, wireframe: true })
const AXE_HEAD_MATERIAL = new THREE.MeshStandardMaterial({ color: '#9ba4ad', roughness: 0.42, metalness: 0.6 })
const MIREGLASS_WATER_MATERIAL = new THREE.MeshStandardMaterial({ color: '#417b83', roughness: 0.28, metalness: 0.12 })
const MIREGLASS_REED_MATERIAL = new THREE.MeshStandardMaterial({ color: '#849568', roughness: 0.95 })
const MIREGLASS_PEAT_MATERIAL = new THREE.MeshStandardMaterial({ color: '#433c34', roughness: 1 })
const MIREGLASS_STONE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#a4aaa0', roughness: 0.94 })
const APPROACH_BRUSH_MATERIAL = new THREE.MeshStandardMaterial({ color: '#6a8253', roughness: 1, flatShading: true })
const APPROACH_PEBBLE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#a89e82', roughness: 0.98, flatShading: true })
const APPROACH_TRAIL_MATERIAL = new THREE.MeshStandardMaterial({ color: '#aa9672', roughness: 1, flatShading: true })
const REGIONAL_LADDER_FOOT_MATERIAL = new THREE.MeshBasicMaterial({ color: '#6df3e6' })
const APPROACH_SOIL_MATERIAL = new THREE.MeshStandardMaterial({ color: '#6c7255', roughness: 1, flatShading: true })
const APPROACH_GROUND_COLOR = new THREE.Color('#687a59')
const HIGHLAND_QUARRY_COLOR = new THREE.Color('#888a7d')
const HIGHLAND_TRAIL_COLOR = new THREE.Color('#aaa188')
const HIGHLAND_SCREE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#8b887a', roughness: 0.98, flatShading: true })
const HIGHLAND_STRATA_MATERIAL = new THREE.MeshStandardMaterial({ color: '#b5ab91', roughness: 0.96, flatShading: true })
const HIGHLAND_TRAIL_MATERIAL = new THREE.MeshStandardMaterial({ color: '#bfb395', roughness: 0.98, flatShading: true })
const HIGHLAND_CROWN_MATERIAL = new THREE.MeshStandardMaterial({ color: '#b8b2a4', roughness: 0.92, flatShading: true })
const HIGHLAND_CROWN_SEAM_MATERIAL = new THREE.MeshStandardMaterial({ color: '#a6c3c1', emissive: '#6b9e9e', emissiveIntensity: 0.45, roughness: 0.75 })
const HIGHLAND_DEPLETED_MATERIAL = new THREE.MeshStandardMaterial({ color: '#686b66', roughness: 0.98, flatShading: true })
const HIGHLAND_WIND_MATERIAL = new THREE.MeshBasicMaterial({ color: '#d6e1dc', transparent: true,
  opacity: 0.22, depthWrite: false })
const WINDWARD_RUNE_MATERIAL = new THREE.MeshBasicMaterial({ color: '#a9e7df', transparent: true,
  opacity: 0.72, depthWrite: false })
const WINDWARD_DORMANT_MATERIAL = new THREE.MeshStandardMaterial({ color: '#759793', roughness: 0.85 })
const WINDWARD_RIBBON_MATERIAL = new THREE.MeshBasicMaterial({ color: '#c6fff0', transparent: true,
  opacity: 0.4, depthWrite: false, side: THREE.DoubleSide })
const WINDWARD_GLYPH_GEOMETRY = new THREE.RingGeometry(0.28, 0.36, 12)
const WINDWARD_RIBBON_GEOMETRY = new THREE.TorusGeometry(0.56, 0.012, 4, 24, Math.PI * 1.2)
const MARKER_STONE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#b9aa89', roughness: 0.95, flatShading: true })
const MARKER_RUNE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#bde4d0', emissive: '#4d9b82', emissiveIntensity: 0.9, roughness: 0.5 })
const MARKER_DORMANT_MATERIAL = new THREE.MeshStandardMaterial({ color: '#787d69', roughness: 0.9 })
const TRAIL_RUNE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#bdecc4', emissive: '#58b981', emissiveIntensity: 1.4, roughness: 0.5 })
const ALDER_BARK_MATERIAL = new THREE.MeshStandardMaterial({ color: '#45382d', roughness: 1, flatShading: true })
const ALDER_LEAF_MATERIAL = new THREE.MeshStandardMaterial({ color: '#628661', roughness: 0.9, flatShading: true })
const ALDER_BELL_MATERIAL = new THREE.MeshStandardMaterial({ color: '#a98552', metalness: 0.35, roughness: 0.55 })
const CACHE_PEAT_MATERIAL = new THREE.MeshStandardMaterial({ color: '#665442', roughness: 1, flatShading: true })
const CACHE_PIT_MATERIAL = new THREE.MeshStandardMaterial({ color: '#2e302a', roughness: 1 })
const CAMP_CANVAS_MATERIAL = new THREE.MeshStandardMaterial({ color: '#a88d5b', roughness: 0.95 })
const CAMP_PREVIEW_MATERIAL = new THREE.MeshStandardMaterial({ color: '#9bdcc9', emissive: '#409c85', emissiveIntensity: 0.35, transparent: true, opacity: 0.55, depthWrite: false })
const CAMP_BLOCKED_MATERIAL = new THREE.MeshStandardMaterial({ color: '#e8ac83', emissive: '#a64a30', emissiveIntensity: 0.35, transparent: true, opacity: 0.55, depthWrite: false })
const ALDER_TRUNK_GEOMETRY = new THREE.CylinderGeometry(0.18, 0.34, 3.4, 7)
const CACHE_PIT_GEOMETRY = new THREE.CircleGeometry(0.72, 12)
const WADER_SHAFT_GEOMETRY = new THREE.CylinderGeometry(0.13, 0.15, 0.5, 10)
const NO_MIREGLASS_DETAIL = { water: false, reeds: false, peat: false, stone: false, brush: false, pebbles: false,
  soil: false, trail: false, trailStake: false, trailYaw: 0, trailLength: 0, trailX: 0, trailZ: 0,
  brushX: 0, brushZ: 0, stakeX: 0, stakeZ: 0, x: 0, z: 0, rotation: 0 } as const

/** Side/soil colour per biome; the projection colour stays the authoritative top tone. */
const TERRAIN_SURFACE: Record<string, { side: string }> = {
  temperate_forest: { side: '#5a4330' },
  marsh: { side: '#40493a' },
  dry_highland: { side: '#6a6052' },
  alpine: { side: '#8a97a1' },
}

const TREE_TRUNK_GEOMETRY = new THREE.CylinderGeometry(0.17, 0.39, 3.35, 10, 3)
const TREE_ROOT_GEOMETRY = new THREE.CylinderGeometry(0.36, 0.55, 0.48, 10)
const TREE_BRANCH_GEOMETRY = new THREE.CylinderGeometry(0.06, 0.16, 1, 8)
const MIREGLASS_TIMBER_CROWN_GEOMETRY = new THREE.ConeGeometry(1.12, 3.5, 8)
const TREE_CANOPY = [
  [-0.92, 2.98, 0.18, 0.72, 0.38, 0.59, '#3d7e49'],
  [-1.14, 3.5, -0.12, 0.49, 0.34, 0.47, '#4a9051'],
  [-0.62, 3.68, 0.55, 0.65, 0.35, 0.54, '#579b55'],
  [-0.18, 2.9, -0.35, 0.72, 0.38, 0.67, '#43884d'],
  [-0.14, 4.08, 0.07, 0.71, 0.42, 0.67, '#64a95d'],
  [0.73, 3.09, 0.17, 0.73, 0.38, 0.61, '#3b8048'],
  [1.11, 3.51, -0.22, 0.49, 0.32, 0.47, '#4e9755'],
  [0.62, 3.89, -0.34, 0.64, 0.36, 0.55, '#62a65e'],
  [0.3, 3.57, -0.65, 0.62, 0.35, 0.54, '#559951'],
  [-0.49, 3.45, -0.7, 0.52, 0.33, 0.44, '#498d4e'],
  [-1.44, 3.08, 0.2, 0.25, 0.25, 0.31, '#559854'],
  [-1.38, 3.72, -0.08, 0.22, 0.21, 0.3, '#66a85c'],
  [-0.82, 4.22, 0.27, 0.29, 0.25, 0.26, '#6cad63'],
  [0.07, 4.49, -0.04, 0.32, 0.24, 0.3, '#70af65'],
  [1.4, 3.24, 0.08, 0.3, 0.24, 0.3, '#4e9354'],
  [1.43, 3.64, -0.15, 0.23, 0.23, 0.28, '#5ca35a'],
  [0.75, 4.26, -0.34, 0.27, 0.22, 0.28, '#71ae63'],
  [-0.42, 2.56, 0.33, 0.27, 0.26, 0.25, '#4d8d4f'],
] as const
// Irregular, flattened boughs and small edge tufts merge into one vertex-tinted crown draw call.
const TREE_CROWN_GEOMETRY = (() => {
  const base = new THREE.SphereGeometry(1, 10, 8)
  const lobes = TREE_CANOPY.map(([x, y, z, sx, sy, sz, tint], lobeIndex) => {
    const lobe = base.clone()
    const positions = lobe.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(positions.count * 3)
    const color = new THREE.Color(tint)
    for (let index = 0; index < positions.count; index += 1) {
      const px = positions.getX(index), py = positions.getY(index), pz = positions.getZ(index)
      const ripple = 1 + 0.12 * Math.sin(8 * px + 5 * pz + lobeIndex) * Math.sin(6 * py - 3 * pz)
        + 0.06 * Math.cos(7 * pz - 4 * px + lobeIndex * 2)
      positions.setXYZ(index, px * ripple, py * ripple, pz * ripple)
      const shade = 0.8 + 0.16 * (py + 1) / 2 + 0.06 * Math.sin(5 * px + 4 * pz + lobeIndex)
      colors[index * 3] = color.r * shade
      colors[index * 3 + 1] = color.g * shade
      colors[index * 3 + 2] = color.b * shade
    }
    lobe.computeVertexNormals()
    lobe.scale(sx, sy, sz)
    lobe.translate(x, y, z)
    lobe.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return lobe
  })
  const crown = mergeGeometries(lobes)!
  lobes.forEach((lobe) => lobe.dispose())
  base.dispose()
  return crown
})()

// Camera-line tree occlusion. Nearby trunks and canopies fade with hysteresis so the avatar stays visible.
// Scalar math only, no per-frame geometry or material allocation.
const CANOPY_CENTRE_Y_M = 3.4
const CANOPY_RADIUS_M = 1.75
const OCCLUDE_ENTER_MARGIN_M = 0.25
const OCCLUDE_EXIT_MARGIN_M = 0.8
const OCCLUDED_OPACITY = 0.12
const AVATAR_FOCUS_HEIGHT_M = 1.5
const FADE_OUT_PER_S = 12
const FADE_IN_PER_S = 5

/** View-only pose shared by avatar and camera. It is derived from the projection and never fed back to the domain. */
interface PresentationPose {
  position: THREE.Vector3
  yaw: number
  speed: number
  phase: number
}

function damping(ratePerSecond: number, delta: number) {
  return 1 - Math.exp(-ratePerSecond * delta)
}

function shortestArc(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

/** A trunk may fill the near camera even when its canopy misses the avatar sightline. */
export function treeTrunkBlocksView(
  camera: THREE.Vector3, avatar: THREE.Vector3, trunk: readonly [number, number, number], scale: number, margin: number,
): boolean {
  const dx = avatar.x - camera.x
  const dz = avatar.z - camera.z
  const horizontalLength2 = dx * dx + dz * dz
  const projected = horizontalLength2 > 1e-8 ? ((trunk[0] - camera.x) * dx + (trunk[2] - camera.z) * dz) / horizontalLength2 : 0
  if (projected < -0.08 || projected > 1.08) return false
  const t = Math.min(1, Math.max(0, projected))
  const rayY = camera.y + (avatar.y + AVATAR_FOCUS_HEIGHT_M - camera.y) * t
  if (rayY < trunk[1] - 0.3 * scale - margin || rayY > trunk[1] + 3.55 * scale + margin) return false
  const segmentDistance = Math.hypot(camera.x + dx * t - trunk[0], camera.z + dz * t - trunk[2])
  const cameraDistance = Math.hypot(camera.x - trunk[0], camera.z - trunk[2])
  return segmentDistance < 0.62 * scale + margin || cameraDistance < 1.35 * scale + margin
}

// These bounds enclose the rendered shop body and pitched roof. They affect only the presentation camera.
export function storeStructureOccludesTarget(target: THREE.Vector3, store: WizardStore): boolean {
  const [x, y, z] = store.position
  return Math.abs(target.x - x) < 2.1 && Math.abs(target.z - z) < 1.6
    && target.y > y - 0.6 && target.y < y + 3.5
}

function segmentBoxHit(from: THREE.Vector3, to: THREE.Vector3, centre: THREE.Vector3, half: THREE.Vector3): number | null {
  let enter = 0
  let exit = 1
  let fromInside = true
  let toInside = true
  for (const axis of ['x', 'y', 'z'] as const) {
    const change = to[axis] - from[axis]
    const low = centre[axis] - half[axis]
    const high = centre[axis] + half[axis]
    fromInside &&= from[axis] >= low && from[axis] <= high
    toInside &&= to[axis] >= low && to[axis] <= high
    if (Math.abs(change) < 1e-8) {
      if (from[axis] < low || from[axis] > high) return null
      continue
    }
    const first = (low - from[axis]) / change
    const second = (high - from[axis]) / change
    enter = Math.max(enter, Math.min(first, second))
    exit = Math.min(exit, Math.max(first, second))
    if (enter > exit) return null
  }
  // A legacy save may start inside a shop. Keep its camera before the exit wall, not at distance zero.
  return fromInside ? (toInside ? null : exit) : enter
}

function storeCameraHit(from: THREE.Vector3, to: THREE.Vector3, store: WizardStore): number | null {
  const [x, y, z] = store.position
  const body = segmentBoxHit(from, to, new THREE.Vector3(x, y + 1.2, z), new THREE.Vector3(1.7, 1.2, 1.2))
  const roof = segmentBoxHit(from, to, new THREE.Vector3(x, y + 2.95, z), new THREE.Vector3(2.4, 0.8, 2.4))
  return body === null ? roof : roof === null ? body : Math.min(body, roof)
}

/** A nearby shop may fill the compact view even when the player stands just beyond its wall. */
export function storeStructureOccludesView(target: THREE.Vector3, camera: THREE.Vector3, store: WizardStore): boolean {
  if (storeStructureOccludesTarget(target, store)) return true
  const [x, y, z] = store.position
  return Math.abs(target.x - x) < 2.6 && Math.abs(target.z - z) < 1.9
    && target.y > y - 0.6 && target.y < y + 3.5
    && storeCameraHit(target, camera, store) !== null
}

function firstStoreCameraHit(from: THREE.Vector3, to: THREE.Vector3, stores: readonly WizardStore[]): number | null {
  let firstHit: number | null = null
  for (const store of stores) {
    if (storeStructureOccludesView(from, to, store)) continue
    const hit = storeCameraHit(from, to, store)
    if (hit !== null) firstHit = firstHit === null ? hit : Math.min(firstHit, hit)
  }
  return firstHit
}

/** Keep the wizard visible when the requested follow orbit looks through a shop. Never changes world movement. */
export function storeSafeCameraPosition(
  target: THREE.Vector3, desired: THREE.Vector3, stores: readonly WizardStore[], previous: THREE.Vector3 | null, delta: number,
): THREE.Vector3 {
  let clear = desired
  let bestHit = firstStoreCameraHit(target, desired, stores)
  if (bestHit !== null) {
    const offset = desired.clone().sub(target)
    for (const angle of [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75, Math.PI]) {
      const sin = Math.sin(angle)
      const cos = Math.cos(angle)
      const candidate = target.clone().add(new THREE.Vector3(offset.x * cos + offset.z * sin, offset.y, offset.z * cos - offset.x * sin))
      const hit = firstStoreCameraHit(target, candidate, stores)
      if (hit === null) {
        clear = candidate
        break
      }
      if (hit > bestHit) {
        clear = candidate
        bestHit = hit
      }
    }
  }
  const next = previous ? previous.clone().lerp(clear, damping(10, Math.max(0, delta))) : clear.clone()
  const hit = firstStoreCameraHit(target, next, stores)
  if (hit === null) return next
  const distance = target.distanceTo(next)
  // The frame and near plane still fill part of the view when the eye is only 12 cm from the shop bound.
  return target.clone().lerp(next, Math.max(0, hit - 0.45 / Math.max(distance, 0.45)))
}

function ridgeCameraHit(from: THREE.Vector3, to: THREE.Vector3): number | null {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.25))
  let previous = { x: from.x, z: from.z }
  for (let index = 1; index <= steps; index += 1) {
    const next = { x: from.x + (to.x - from.x) * index / steps,
      z: from.z + (to.z - from.z) * index / steps }
    if (highlandRidgeMoveBarrier(previous, next)) return (index - 1) / steps
    previous = next
  }
  return null
}

/** View-only orbit around ridge rock, with the gallery eye below its 7.25 m roof. */
export function ridgeSafeCameraPosition(target: THREE.Vector3, desired: THREE.Vector3): THREE.Vector3 {
  const cellX = Math.ceil(target.x / WORLD_CELL_METERS - 0.5) * WORLD_CELL_METERS
  const cellZ = Math.ceil(target.z / WORLD_CELL_METERS - 0.5) * WORLD_CELL_METERS
  const eye = desired.clone()
  if (highlandRidgeCellAt(cellX, cellZ) === 'gallery') eye.y = Math.min(eye.y, 6.8)
  let best = eye
  let bestHit = ridgeCameraHit(target, eye)
  if (bestHit === null) return eye
  const offset = eye.clone().sub(target)
  for (const angle of [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4,
    Math.PI / 2, -Math.PI / 2, 1.75, -1.75, Math.PI]) {
    const sin = Math.sin(angle)
    const cos = Math.cos(angle)
    const candidate = target.clone().add(new THREE.Vector3(
      offset.x * cos + offset.z * sin, offset.y, offset.z * cos - offset.x * sin))
    const hit = ridgeCameraHit(target, candidate)
    if (hit === null) return candidate
    if (hit > bestHit) { best = candidate; bestHit = hit }
  }
  return target.clone().lerp(best, Math.max(0, bestHit - 0.45 / Math.max(target.distanceTo(best), 0.45)))
}

const DESKTOP_CAMERA = { focusHeight: 1.35, eyeRise: 1.2, distance: 6.4, pitchScale: 1 } as const
const COMPACT_CAMERA = { focusHeight: 0.45, eyeRise: 0.45, distance: 5.6, pitchScale: 0.65 } as const

/** Match the HUD's compact breakpoint so the wizard stays above its lower objective and touch controls. */
export function cameraFramingFor(width: number, height: number) {
  return width < 720 || (width <= 900 && height <= 590) ? COMPACT_CAMERA : DESKTOP_CAMERA
}

/** Deterministic [0, 1) from a stable id, so cosmetic variation never depends on randomness or time. */
function hashUnit(id: string, salt: number) {
  let hash = 2166136261 ^ salt
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  hash ^= hash >>> 15
  hash = Math.imul(hash, 2246822507)
  hash ^= hash >>> 13
  return (hash >>> 0) / 4294967296
}

/** Stable, sparse ground detail. It is scenery only and has no interaction target. */
export function mireglassDetailFor(cell: WizardTerrainCell) {
  const terrain = cell.mireglassTerrain
  if (!terrain && !cell.mireglassApproach && !cell.mireglassTrailSegment) return NO_MIREGLASS_DETAIL
  const roll = hashUnit(cell.id, 7)
  const segment = cell.mireglassTrailSegment
  const dx = segment ? segment.to[0] - segment.from[0] : 0
  const dz = segment ? segment.to[1] - segment.from[1] : 0
  const trailLength = Math.hypot(dx, dz)
  const trail = !!segment && Number.isFinite(trailLength) && trailLength > 0.01
  const trailYaw = trail ? Math.atan2(dx, dz) : 0
  const trailX = trail ? (segment.from[0] + segment.to[0]) / 2 - cell.position[0] : 0
  const trailZ = trail ? (segment.from[1] + segment.to[1]) / 2 - cell.position[2] : 0
  const side = hashUnit(cell.id, 16) < 0.5 ? -1 : 1
  const straightTrail = trail && (Math.abs(dx) < 0.01 || Math.abs(dz) < 0.01)
  const approachX = (hashUnit(cell.id, 14) - 0.5) * 2.6
  const approachZ = (hashUnit(cell.id, 15) - 0.5) * 2.6
  return {
    water: terrain === 'wetland' && roll < 0.72,
    reeds: terrain === 'wetland' && roll >= 0.22 && roll < 0.58,
    peat: terrain === 'loam' && roll < 0.38,
    stone: terrain === 'rocky' && roll < 0.6,
    brush: !!cell.mireglassApproach && hashUnit(cell.id, 11) < 0.62,
    pebbles: !!cell.mireglassApproach && hashUnit(cell.id, 12) < 0.52,
    soil: !!cell.mireglassApproach && hashUnit(cell.id, 13) < 0.42,
    trailStake: straightTrail && hashUnit(cell.id, 24) < 0.16,
    trail, trailYaw, trailLength, trailX, trailZ,
    brushX: trail ? trailX + side * Math.cos(trailYaw) * 1.18 : approachX,
    brushZ: trail ? trailZ - side * Math.sin(trailYaw) * 1.18 : approachZ,
    stakeX: trail ? trailX - side * Math.cos(trailYaw) * 1.48 : 0,
    stakeZ: trail ? trailZ + side * Math.sin(trailYaw) * 1.48 : 0,
    x: (hashUnit(cell.id, 8) - 0.5) * 1.3,
    z: (hashUnit(cell.id, 9) - 0.5) * 1.3,
    rotation: hashUnit(cell.id, 10) * Math.PI,
  }
}

/** Deterministic, low relief scree. No display-only cliff or wall obstructs the walkable route. */
export function highlandDetailFor(cell: WizardTerrainCell) {
  const segment = cell.highlandTrailSegment
  const dx = segment ? segment.to[0] - segment.from[0] : 0
  const dz = segment ? segment.to[1] - segment.from[1] : 0
  const length = Math.hypot(dx, dz)
  const trail = !!segment && length > 0.01
  const yaw = trail ? Math.atan2(dx, dz) : 0
  const trailX = trail ? (segment.from[0] + segment.to[0]) / 2 - cell.position[0] : 0
  const trailZ = trail ? (segment.from[1] + segment.to[1]) / 2 - cell.position[2] : 0
  return {
    trail, yaw, length, trailX, trailZ,
    scree: cell.highlandSurface === 'quarry' && !trail && hashUnit(cell.id, 35) < 0.28,
    x: (hashUnit(cell.id, 36) - 0.5) * 2.0,
    z: (hashUnit(cell.id, 37) - 0.5) * 2.0,
    rotation: hashUnit(cell.id, 38) * Math.PI,
  }
}

function PresentationPoseDriver({ player, pose, worldSupport, presentationTargetYAt }: {
  player: WizardViewProjection['player']; pose: PresentationPose; worldSupport: RefObject<THREE.Group | null>
  presentationTargetYAt: (x: number, z: number, authoritativeY: number) => number
}) {
  const target = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, delta) => {
    target.set(player.position[0], presentationTargetYAt(player.position[0], player.position[2],
      player.position[1]), player.position[2])
    if (Math.hypot(target.x - pose.position.x, target.z - pose.position.z) > TELEPORT_SNAP_DISTANCE_M) {
      pose.position.copy(target)
      pose.yaw = player.yaw
      pose.speed = 0
    } else {
      const previousX = pose.position.x
      const previousZ = pose.position.z
      pose.position.lerp(target, damping(POSITION_DAMPING_PER_S, delta))
      pose.yaw += shortestArc(pose.yaw, player.yaw) * damping(YAW_DAMPING_PER_S, delta)
      const realizedSpeed = delta > 0 ? Math.hypot(pose.position.x - previousX, pose.position.z - previousZ) / delta : 0
      pose.speed += (realizedSpeed - pose.speed) * damping(SPEED_DAMPING_PER_S, delta)
      pose.phase = (pose.phase + pose.speed / STRIDE_LENGTH_M * Math.PI * 2 * delta) % (Math.PI * 2)
    }
    worldSupport.current?.position.set(pose.position.x, 0, pose.position.z)
  }, -1)
  return null
}

function CameraRig({ pose, cameraOrbit, orbiting, stores, highlandRidgeActive }: {
  pose: PresentationPose
  cameraOrbit: readonly [number, number]
  orbiting: boolean
  stores: readonly WizardStore[]
  highlandRidgeActive: boolean
}) {
  const orbitYaw = useRef(cameraOrbit[0])
  const orbitPitch = useRef(cameraOrbit[1])
  const initialized = useRef(false)
  const target = useMemo(() => new THREE.Vector3(), [])
  const desired = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }, delta) => {
    const blend = 1 - Math.exp(-(orbiting ? 18 : 2.6) * delta)
    orbitYaw.current += (cameraOrbit[0] - orbitYaw.current) * blend
    orbitPitch.current += (cameraOrbit[1] - orbitPitch.current) * blend
    const heading = pose.yaw + orbitYaw.current
    const framing = cameraFramingFor(size.width, size.height)
    const horizontal = Math.cos(orbitPitch.current * framing.pitchScale) * framing.distance
    target.set(pose.position.x, pose.position.y + framing.focusHeight, pose.position.z)
    desired.set(
      target.x + Math.sin(heading) * horizontal,
      target.y + framing.eyeRise + Math.sin(orbitPitch.current * framing.pitchScale) * framing.distance,
      target.z + Math.cos(heading) * horizontal,
    )
    const ridgeDesired = highlandRidgeActive ? ridgeSafeCameraPosition(target, desired) : desired
    const next = storeSafeCameraPosition(target, ridgeDesired, stores, initialized.current ? camera.position : null, delta)
    camera.position.copy(highlandRidgeActive ? ridgeSafeCameraPosition(target, next) : next)
    initialized.current = true
    camera.lookAt(target)
  })
  return null
}

type AvatarEquipment = WizardViewProjection['equipment']
type ActivePick = NonNullable<WizardViewProjection['v29Mining']>['tools']['activePick']

/** Pure mapping from authoritative equipment to the gear the avatar shows. Unknown or empty slots render nothing. */
export function avatarGearFor(equipment: AvatarEquipment, activePick: ActivePick = null) {
  const id = (slot: keyof AvatarEquipment) => equipment[slot]?.itemId ?? null
  const feet = id('feet')
  const mainHand = activePick ? `${activePick}-pick` as const
    : id('mainHand') === 'woodcutters_axe' ? 'axe' : id('mainHand') === 'field_spade' ? 'spade' : id('mainHand') === 'oak_wand' ? 'wand' : null
  const offHand = id('offHand') === 'wooden_shield' ? 'shield' : id('offHand') === 'oak_wand' ? 'wand' : null
  return {
    hat: id('head') === 'apprentice_hat',
    tunic: id('chest') === 'traveler_tunic',
    leggings: id('legs') === 'trail_leggings',
    boots: feet === 'leather_boots',
    waders: feet === 'mireglass_reach/item/waders',
    mainHand,
    offHand,
    // One wand light at most: two equipped wands share the main-hand light rather than doubling fragment cost.
    offHandLight: offHand === 'wand' && mainHand !== 'wand',
  } as const
}

function Wand({ side, light }: { side: 1 | -1; light: boolean }) {
  return <>
    <mesh position={[0.18 * side, -0.32, 0]} rotation={[0.05, 0, 0.12 * side]} material={DARK_WOOD_MATERIAL} castShadow><cylinderGeometry args={[0.035, 0.05, 2.45, 7]} /></mesh>
    <mesh position={[0.04 * side, 0.78, -0.06]} material={GOLD_MATERIAL}><cylinderGeometry args={[0.06, 0.04, 0.12, 7]} /></mesh>
    <mesh position={[0.03 * side, 0.95, -0.07]}><sphereGeometry args={[0.12, 12, 10]} /><meshStandardMaterial color="#e9dcff" emissive="#bd82ff" emissiveIntensity={2.2} roughness={0.25} /></mesh>
    {light && <pointLight position={[0.03 * side, 1.0, -0.07]} color="#bd82ff" intensity={2.6} distance={3.8} />}
  </>
}

function Axe() {
  return <group position={[0.24, -0.5, 0.04]} rotation={[0.1, 0, 0.1]}>
    <mesh position={[0, 0.12, 0]} material={DARK_WOOD_MATERIAL} castShadow><cylinderGeometry args={[0.045, 0.055, 1.35, 6]} /></mesh>
    <mesh geometry={AXE_BLADE_GEOMETRY} material={AXE_HEAD_MATERIAL} position={[0, 0.65, -0.045]} castShadow />
    <mesh geometry={UNIT_BOX} material={DARK_WOOD_MATERIAL} position={[0, 0.65, 0.02]} scale={[0.09, 0.24, 0.13]} />
  </group>
}

function Spade() {
  return <group position={[0.24, -0.44, 0.04]} rotation={[0.08, 0, 0.08]}>
    <mesh position={[0, 0.08, 0]} material={DARK_WOOD_MATERIAL} castShadow><cylinderGeometry args={[0.045, 0.05, 1.18, 6]} /></mesh>
    <mesh geometry={SPADE_BLADE_GEOMETRY} material={AXE_HEAD_MATERIAL} position={[0, -0.5, -0.03]} castShadow />
    <mesh geometry={UNIT_BOX} material={DARK_WOOD_MATERIAL} position={[-0.15, 0.75, 0]} scale={[0.06, 0.3, 0.08]} />
    <mesh geometry={UNIT_BOX} material={DARK_WOOD_MATERIAL} position={[0.15, 0.75, 0]} scale={[0.06, 0.3, 0.08]} />
    <mesh geometry={UNIT_BOX} material={DARK_WOOD_MATERIAL} position={[0, 0.89, 0]} scale={[0.36, 0.07, 0.08]} />
  </group>
}

/** One lightweight held pick, with a distinct enchanted head. V29 is the only caller. */
export function MiningPick({ tier }: { tier: 'basic' | 'enchanted' }) {
  const enchanted = tier === 'enchanted'
  return <group name={`${tier} mining pick`} position={[0.24, -0.46, 0.04]} rotation={[0.08, 0, 0.08]}>
    <mesh position={[0, 0.05, 0]} material={DARK_WOOD_MATERIAL} castShadow>
      <cylinderGeometry args={[0.045, 0.052, 1.22, 7]} />
    </mesh>
    <mesh position={[0, 0.55, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[0.018, 0.018, 0.52, 7]} />
      <meshStandardMaterial color={enchanted ? '#a96cff' : '#788891'} metalness={0.8}
        roughness={0.32} emissive={enchanted ? '#7135bb' : '#000000'} emissiveIntensity={enchanted ? 0.7 : 0} />
    </mesh>
    <mesh position={[0.27, 0.55, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
      <coneGeometry args={[0.085, 0.23, 7]} />
      <meshStandardMaterial color={enchanted ? '#ba8aff' : '#8b9599'} metalness={0.75}
        roughness={0.35} emissive={enchanted ? '#7135bb' : '#000000'} emissiveIntensity={enchanted ? 0.7 : 0} />
    </mesh>
    <mesh position={[-0.27, 0.55, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <coneGeometry args={[0.085, 0.23, 7]} />
      <meshStandardMaterial color={enchanted ? '#ba8aff' : '#8b9599'} metalness={0.75}
        roughness={0.35} emissive={enchanted ? '#7135bb' : '#000000'} emissiveIntensity={enchanted ? 0.7 : 0} />
    </mesh>
  </group>
}

function Shield() {
  return <group position={[-0.22, -0.38, 0.02]}>
    <mesh geometry={SHIELD_GEOMETRY} material={WOOD_MATERIAL} castShadow />
    <mesh geometry={AVATAR_ROUND_GEOMETRY} material={GOLD_MATERIAL} position={[0, 0, 0.12]} scale={[0.11, 0.11, 0.035]} />
  </group>
}

function WizardAvatar({ pose, equipment, activePick = null, windwardActive = false }: {
  pose: PresentationPose; equipment: AvatarEquipment; activePick?: ActivePick; windwardActive?: boolean
}) {
  const gear = avatarGearFor(equipment, activePick)
  const legMaterial = gear.leggings ? STAKE_MATERIAL : ROBE_TRIM_MATERIAL
  const root = useRef<THREE.Group>(null)
  const torso = useRef<THREE.Group>(null)
  const leftLeg = useRef<THREE.Group>(null)
  const rightLeg = useRef<THREE.Group>(null)
  const leftArm = useRef<THREE.Group>(null)
  const rightArm = useRef<THREE.Group>(null)
  const windRibbon = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!root.current || !torso.current || !leftLeg.current || !rightLeg.current || !leftArm.current || !rightArm.current) return
    root.current.position.copy(pose.position)
    root.current.rotation.y = pose.yaw
    // Swing amplitude follows realized speed, so stopping fades to idle while the phase stays continuous.
    const stride = Math.min(pose.speed / WALK_SPEED_M_PER_S, 1)
    const swing = Math.sin(pose.phase) * stride
    leftLeg.current.rotation.x = swing * LEG_SWING_RAD
    rightLeg.current.rotation.x = -swing * LEG_SWING_RAD
    leftArm.current.rotation.x = -swing * ARM_SWING_RAD
    rightArm.current.rotation.x = swing * ARM_SWING_RAD
    torso.current.position.y = BODY_BOB_M * stride * 0.5 * (1 + Math.cos(2 * pose.phase))
    if (windRibbon.current) windRibbon.current.rotation.y = clock.elapsedTime * 1.4
  })
  return (
    <group ref={root} aria-label="Player wizard">
      {[leftLeg, rightLeg].map((leg, index) => (
        <group key={index} ref={leg} position={[index === 0 ? -0.16 : 0.16, 0.6, 0]}>
          <mesh geometry={LEG_GEOMETRY} position={[0, -0.31, 0]} material={legMaterial} castShadow />
          {gear.boots && <mesh geometry={AVATAR_ROUND_GEOMETRY} material={DARK_WOOD_MATERIAL}
            position={[0, -0.54, -0.1]} scale={[0.17, 0.13, 0.28]} castShadow />}
          {gear.waders && <>
            <mesh geometry={WADER_SHAFT_GEOMETRY} material={WADER_MATERIAL} position={[0, -0.3, 0]} castShadow />
            <mesh geometry={AVATAR_ROUND_GEOMETRY} material={WADER_CUFF_MATERIAL}
              position={[0, -0.06, 0]} scale={[0.16, 0.055, 0.16]} castShadow />
            <mesh geometry={AVATAR_ROUND_GEOMETRY} material={WADER_MATERIAL}
              position={[0, -0.52, -0.12]} scale={[0.18, 0.15, 0.34]} castShadow />
          </>}
        </group>
      ))}
      <group ref={torso}>
        <mesh geometry={gear.waders ? WADER_ROBE_GEOMETRY : ROBE_GEOMETRY}
          material={ROBE_MATERIAL} castShadow />
        <mesh geometry={AVATAR_ROUND_GEOMETRY} material={ROBE_MATERIAL}
          position={[0, 1.46, 0]} scale={[0.36, 0.18, 0.27]} castShadow />
        <mesh geometry={ROBE_MANTLE_GEOMETRY} material={ROBE_TRIM_MATERIAL} position={[0, 1.32, 0]} castShadow />
        <mesh geometry={SATCHEL_STRAP_GEOMETRY} material={TUNIC_MATERIAL} castShadow />
        <mesh geometry={ROBE_BELT_GEOMETRY} material={DARK_WOOD_MATERIAL} position={[0, 1.03, 0]} castShadow />
        <mesh geometry={UNIT_BOX} material={GOLD_MATERIAL} position={[0, 1.03, -0.36]}
          scale={[0.14, 0.12, 0.045]} />
        {!gear.waders && <>
          {[-0.18, 0.18].map((side) => <mesh key={side} geometry={ROBE_FOLD_GEOMETRY}
            material={ROBE_FOLD_MATERIAL} position={[side, 0, 0]} castShadow />)}
          <mesh geometry={ROBE_FOLD_GEOMETRY} material={GOLD_MATERIAL} rotation={[0, Math.PI, 0]} />
        </>}
        <mesh geometry={AVATAR_ROUND_GEOMETRY} material={TUNIC_MATERIAL}
          position={[0.45, 0.83, 0.18]} scale={[0.17, 0.2, 0.11]} castShadow />
        <mesh geometry={AVATAR_ROUND_GEOMETRY} material={DARK_WOOD_MATERIAL}
          position={[0.45, 0.97, 0.23]} scale={[0.16, 0.075, 0.12]} castShadow />
        <mesh geometry={AVATAR_ROUND_GEOMETRY} material={GOLD_MATERIAL}
          position={[0.45, 0.94, 0.35]} scale={[0.035, 0.035, 0.02]} />
        {gear.waders && <mesh geometry={UNIT_BOX} material={WADER_MATERIAL} position={[0, 0.75, 0.43]} scale={[0.42, 0.66, 0.1]} castShadow />}
        <mesh geometry={ROBE_HEM_GEOMETRY} material={ROBE_TRIM_MATERIAL}
          position={[0, gear.waders ? 0.62 : 0.24, 0]} scale={gear.waders ? [0.8, 1, 0.8] : [1, 1, 1]} castShadow />
        {gear.tunic && <>
          {TRAVELER_TUNIC_PANELS.map((geometry, side) => <mesh key={side}
            name="Traveler tunic over-robe panel" geometry={geometry}
            material={TRAVELER_TUNIC_MATERIAL} castShadow />)}
          <mesh geometry={TRAVELER_TUNIC_BELT_GEOMETRY} material={DARK_WOOD_MATERIAL}
            position={[0, 1.03, 0]} castShadow />
          <mesh geometry={UNIT_BOX} material={GOLD_MATERIAL} position={[0, 1.03, -0.54]}
            scale={[0.16, 0.12, 0.045]} />
        </>}
        <mesh geometry={COLLAR_GEOMETRY} material={GOLD_MATERIAL} position={[0, 1.63, 0]} rotation={[Math.PI / 2, 0, 0]} />
        <mesh geometry={AVATAR_ROUND_GEOMETRY} material={SKIN_MATERIAL}
          position={[0, 1.88, 0]} scale={[0.28, 0.32, 0.27]} castShadow />
        <mesh geometry={AVATAR_ROUND_GEOMETRY} material={HAIR_MATERIAL}
          position={[0, 2.11, 0.03]} scale={[0.29, 0.15, 0.27]} castShadow />
        <mesh geometry={AVATAR_ROUND_GEOMETRY} material={HAIR_MATERIAL}
          position={[0, 1.91, 0.2]} scale={[0.24, 0.18, 0.1]} castShadow />
        {[-1, 1].map((side) => <mesh key={side} geometry={AVATAR_ROUND_GEOMETRY} material={HAIR_MATERIAL}
          position={[side * 0.25, 1.9, -0.02]} scale={[0.065, 0.16, 0.09]} castShadow />)}
        {[-1, 1].map((side) => <mesh key={side} geometry={AVATAR_ROUND_GEOMETRY} material={HAIR_MATERIAL}
          position={[side * 0.13, 2.08, -0.19]} scale={[0.15, 0.08, 0.095]} castShadow />)}
        <mesh geometry={AVATAR_ROUND_GEOMETRY} material={SKIN_MATERIAL}
          position={[0, 1.83, -0.28]} scale={[0.055, 0.085, 0.065]} />
        {[-1, 1].map((side) => <mesh key={side} geometry={AVATAR_ROUND_GEOMETRY} material={EYE_MATERIAL}
          position={[side * 0.1, 1.94, -0.255]} scale={[0.03, 0.04, 0.018]} />)}
        <mesh geometry={UNIT_BOX} material={EYE_MATERIAL} position={[0, 1.75, -0.255]}
          scale={[0.09, 0.018, 0.018]} />
        {gear.hat && <>
          <mesh geometry={HAT_GEOMETRY} material={ROBE_TRIM_MATERIAL} position={[0, 2.07, 0]} castShadow />
          <mesh position={[0, 2.17, 0]} material={GOLD_MATERIAL}><cylinderGeometry args={[0.38, 0.39, 0.055, 16]} /></mesh>
          <mesh position={[0, 2.07, 0]} material={ROBE_TRIM_MATERIAL} castShadow><cylinderGeometry args={[0.53, 0.53, 0.055, 16]} /></mesh>
        </>}
        <group ref={leftArm} position={[-0.34, 1.47, 0]}>
          <mesh geometry={AVATAR_ROUND_GEOMETRY} material={ROBE_MATERIAL} position={[-0.02, -0.08, 0]}
            scale={[0.18, 0.18, 0.18]} castShadow />
          <mesh geometry={SLEEVE_GEOMETRY} position={[-0.07, -0.3, 0]} rotation={[0, 0, 0.2]} material={ROBE_MATERIAL} castShadow />
          <mesh geometry={AVATAR_ROUND_GEOMETRY} material={ROBE_TRIM_MATERIAL} position={[-0.13, -0.59, 0]}
            scale={[0.17, 0.065, 0.15]} castShadow />
          <mesh geometry={AVATAR_ROUND_GEOMETRY} material={SKIN_MATERIAL} position={[-0.13, -0.66, 0]}
            scale={[0.1, 0.12, 0.1]} castShadow />
          {gear.offHand === 'shield' && <Shield />}
          {gear.offHand === 'wand' && <Wand side={-1} light={gear.offHandLight} />}
        </group>
        <group ref={rightArm} position={[0.34, 1.47, 0]}>
          <mesh geometry={AVATAR_ROUND_GEOMETRY} material={ROBE_MATERIAL} position={[0.02, -0.08, 0]}
            scale={[0.18, 0.18, 0.18]} castShadow />
          <mesh geometry={SLEEVE_GEOMETRY} position={[0.07, -0.3, 0]} rotation={[0, 0, -0.2]} material={ROBE_MATERIAL} castShadow />
          <mesh geometry={AVATAR_ROUND_GEOMETRY} material={ROBE_TRIM_MATERIAL} position={[0.13, -0.59, 0]}
            scale={[0.17, 0.065, 0.15]} castShadow />
          <mesh geometry={AVATAR_ROUND_GEOMETRY} material={SKIN_MATERIAL} position={[0.13, -0.66, 0]}
            scale={[0.1, 0.12, 0.1]} castShadow />
          {gear.mainHand === 'axe' && <Axe />}
          {gear.mainHand === 'spade' && <Spade />}
          {gear.mainHand === 'basic-pick' && <MiningPick tier="basic" />}
          {gear.mainHand === 'enchanted-pick' && <MiningPick tier="enchanted" />}
          {gear.mainHand === 'wand' && <Wand side={1} light />}
        </group>
      </group>
      {windwardActive && <group ref={windRibbon} name="Windward Step active wind" position={[0, 1.05, 0]}>
        <mesh geometry={WINDWARD_RIBBON_GEOMETRY} material={WINDWARD_RIBBON_MATERIAL}
          rotation={[Math.PI / 2, 0, 0]} position={[0, -0.3, 0]} />
        <mesh geometry={WINDWARD_RIBBON_GEOMETRY} material={WINDWARD_RIBBON_MATERIAL}
          rotation={[Math.PI / 2, Math.PI, 0]} position={[0, 0.25, 0]} />
      </group>}
    </group>
  )
}

/** Slow world-space colour drift keeps adjacent caps visually continuous without changing tile geometry. */
export function terrainAppearanceFor(cell: WizardTerrainCell) {
  const surface = TERRAIN_SURFACE[cell.climate] ?? TERRAIN_SURFACE.temperate_forest
  const [x, , z] = cell.position
  const tint = 0.5 * Math.sin(x * 0.055 + z * 0.037) * Math.cos(z * 0.071 - x * 0.029)
  const lift = (cell.height - 2) * 0.02
  const top = new THREE.Color(cell.color ?? '#56824b')
  if (cell.mireglassApproach) top.lerp(APPROACH_GROUND_COLOR, 0.42)
  if (cell.highlandSurface === 'quarry') top.lerp(HIGHLAND_QUARRY_COLOR, 0.85)
  else if (cell.highlandSurface === 'trail') top.lerp(HIGHLAND_TRAIL_COLOR, 0.48)
  top.offsetHSL(tint * (cell.mireglassApproach ? 0.008 : 0.02),
    tint * (cell.mireglassApproach ? 0.02 : 0.05),
    tint * (cell.mireglassApproach ? 0.018 : 0.04) + lift)
  return { top, side: new THREE.Color(surface.side).lerp(top, 0.18) }
}

const sameCoordinates = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length && left.every((value, index) => value === right[index])
type CellTrail = NonNullable<WizardTerrainCell['mireglassTrailSegment']>
const sameTrail = (left: CellTrail | undefined, right: CellTrail | undefined) =>
  left === right || !!left && !!right
    && sameCoordinates(left.from, right.from) && sameCoordinates(left.to, right.to)

/** The projection clones cells at 20 Hz; compare the complete cell before skipping its scenery. */
export function terrainCellVisualsEqual(left: WizardTerrainCell, right: WizardTerrainCell): boolean {
  return left.id === right.id && sameCoordinates(left.position, right.position)
    && sameCoordinates(left.size, right.size) && left.height === right.height
    && left.climate === right.climate && left.color === right.color
    && left.mireglassTerrain === right.mireglassTerrain
    && left.mireglassApproach === right.mireglassApproach
    && sameTrail(left.mireglassTrailSegment, right.mireglassTrailSegment)
    && left.highlandSurface === right.highlandSurface
    && sameTrail(left.highlandTrailSegment, right.highlandTrailSegment)
    && left.highlandRidgeCell === right.highlandRidgeCell
}

function TerrainCell({ cell }: { cell: WizardTerrainCell }) {
  const detail = useMemo(() => mireglassDetailFor(cell), [cell.id, cell.mireglassTerrain,
    cell.mireglassApproach, cell.mireglassTrailSegment])
  const highland = useMemo(() => highlandDetailFor(cell), [cell.id, cell.highlandSurface,
    cell.highlandTrailSegment])
  const [x, y, z] = cell.position
  return (
    <group position={[x, 0, z]}>
      {highland.trail && <mesh geometry={UNIT_BOX} material={HIGHLAND_TRAIL_MATERIAL}
        position={[highland.trailX, y + 0.023, highland.trailZ]} rotation={[0, highland.yaw, 0]}
        scale={[1.16, 0.025, highland.length + 0.06]} receiveShadow />}
      {highland.scree && <group position={[highland.x, y, highland.z]} rotation={[0, highland.rotation, 0]}>
        <mesh geometry={ROCK_GEOMETRY} material={HIGHLAND_SCREE_MATERIAL}
          position={[0, 0.12, 0]} scale={[0.64, 0.14, 0.43]} castShadow />
        <mesh geometry={ROCK_GEOMETRY} material={HIGHLAND_STRATA_MATERIAL}
          position={[0.24, 0.19, -0.09]} rotation={[0, 0.2, -0.08]} scale={[0.38, 0.11, 0.27]} castShadow />
      </group>}
      {detail.water && <mesh geometry={MIREGLASS_PATCH_GEOMETRY} material={MIREGLASS_WATER_MATERIAL}
        position={[detail.x, y + 0.019, detail.z]} rotation={[0, detail.rotation, 0]} scale={[1.32, 1, 0.88]} />}
      {detail.reeds && <group position={[detail.x + 0.9, y, detail.z - 0.7]} rotation={[0, detail.rotation, 0]}>
        <mesh geometry={UNIT_BOX} material={MIREGLASS_REED_MATERIAL} position={[-0.12, 0.24, 0]} rotation={[0, 0, -0.12]} scale={[0.045, 0.48, 0.045]} />
        <mesh geometry={UNIT_BOX} material={MIREGLASS_REED_MATERIAL} position={[0.09, 0.31, 0.09]} rotation={[0, 0, 0.16]} scale={[0.04, 0.62, 0.04]} />
        <mesh geometry={UNIT_BOX} material={MIREGLASS_REED_MATERIAL} position={[0.02, 0.18, -0.1]} scale={[0.04, 0.36, 0.04]} />
      </group>}
      {detail.peat && <mesh geometry={MIREGLASS_PATCH_GEOMETRY} material={MIREGLASS_PEAT_MATERIAL}
        position={[detail.x, y + 0.018, detail.z]} rotation={[0, detail.rotation, 0]} scale={[1.08, 1, 0.74]} />}
      {detail.stone && <mesh geometry={ROCK_GEOMETRY} material={MIREGLASS_STONE_MATERIAL} position={[detail.x, y + 0.1, detail.z]} rotation={[0, detail.rotation, 0]} scale={[0.55, 0.16, 0.42]} />}
      {detail.soil && <mesh geometry={ROCK_GEOMETRY} material={APPROACH_SOIL_MATERIAL}
        position={[detail.x, y + 0.012, detail.z]} rotation={[0, detail.rotation, 0]} scale={[1.05, 0.025, 0.8]} />}
      {detail.trail && <mesh geometry={UNIT_BOX} material={APPROACH_TRAIL_MATERIAL}
        position={[detail.trailX, y + 0.021, detail.trailZ]} rotation={[0, detail.trailYaw, 0]}
        scale={[1.1, 0.024, detail.trailLength + 0.04]} receiveShadow />}
      {detail.trailStake && <group position={[detail.stakeX, y, detail.stakeZ]} rotation={[0, detail.rotation, 0]}>
        <mesh geometry={ROCK_GEOMETRY} material={MIREGLASS_PEAT_MATERIAL} position={[0, 0.06, 0]} scale={[0.31, 0.12, 0.28]} />
        <mesh geometry={UNIT_BOX} material={STAKE_MATERIAL} position={[0, 0.51, 0]} rotation={[0, 0, -0.07]}
          scale={[0.17, 1.02, 0.17]} castShadow />
        <mesh geometry={UNIT_BOX} material={MARKER_RUNE_MATERIAL} position={[0, 0.76, 0]} scale={[0.22, 0.07, 0.22]} />
      </group>}
      {detail.brush && <group position={[detail.brushX, y, detail.brushZ]} rotation={[0, detail.rotation, 0]}>
        <mesh geometry={UNIT_BOX} material={MIREGLASS_REED_MATERIAL} position={[-0.12, 0.23, 0]} rotation={[0, 0, -0.22]} scale={[0.035, 0.46, 0.035]} />
        <mesh geometry={UNIT_BOX} material={MIREGLASS_REED_MATERIAL} position={[0.11, 0.19, 0.08]} rotation={[0, 0, 0.24]} scale={[0.035, 0.38, 0.035]} />
        <mesh geometry={LEAF_GEOMETRY} material={APPROACH_BRUSH_MATERIAL} position={[-0.19, 0.39, 0]} scale={[0.23, 0.12, 0.2]} />
        <mesh geometry={LEAF_GEOMETRY} material={APPROACH_BRUSH_MATERIAL} position={[0.18, 0.31, 0.08]} scale={[0.21, 0.11, 0.18]} />
      </group>}
      {detail.pebbles && <group position={[detail.x + 0.68, y, detail.z - 0.52]} rotation={[0, detail.rotation, 0]}>
        <mesh geometry={ROCK_GEOMETRY} material={APPROACH_PEBBLE_MATERIAL} position={[-0.16, 0.055, 0]} scale={[0.27, 0.09, 0.2]} />
        <mesh geometry={ROCK_GEOMETRY} material={APPROACH_PEBBLE_MATERIAL} position={[0.17, 0.04, 0.08]} scale={[0.18, 0.07, 0.16]} />
      </group>}
    </group>
  )
}

const MemoizedTerrainCell = memo(TerrainCell,
  (previous, next) => terrainCellVisualsEqual(previous.cell, next.cell))

/** Recheck the bounded revealed cell before displaying saved pit-ladder geometry. */
export function visibleV26PitLadders(ladders: readonly WizardV26PitLadder[] | undefined,
  revealed: readonly WizardTerrainCell[]): WizardV26PitLadder[] {
  if (!ladders || ladders.length > 256) return []
  const byId = new Map(ladders.map((ladder) => [ladder.cellId, ladder]))
  return revealed.flatMap((cell) => {
    const ladder = byId.get(cell.id)
    return ladder && cell.id === `tile-${ladder.gx + 3}-${ladder.gz + 3}`
      && cell.size[0] === WORLD_CELL_METERS && cell.size[1] === WORLD_CELL_METERS
      && cell.position[0] === ladder.gx * WORLD_CELL_METERS
      && cell.position[2] === ladder.gz * WORLD_CELL_METERS
      && cell.position[1] === ladder.floorY
      && ladder.rimY > ladder.floorY && ladder.rimY - ladder.floorY <= 4.8 + 1e-6
      ? [ladder] : []
  })
}

function V26PitLadderLayer({ ladders, cells }: { ladders: readonly WizardV26PitLadder[];
  cells: readonly WizardTerrainCell[] }) {
  const shown = visibleV26PitLadders(ladders, cells)
  return shown.length ? <group name="V26 pit ladders">
    {shown.map((ladder) => {
      const height = ladder.rimY - ladder.floorY
      const rungs = Math.max(1, Math.floor(height / 0.35))
      return <group key={ladder.cellId}
        position={[ladder.gx * WORLD_CELL_METERS + 1.55, ladder.floorY,
          ladder.gz * WORLD_CELL_METERS]}>
        {[-0.29, 0.29].map((z) => <mesh key={z} name="V26 pit ladder rail"
          geometry={UNIT_BOX} material={DARK_WOOD_MATERIAL}
          position={[0, height / 2, z]} scale={[0.11, height, 0.11]} castShadow />)}
        {Array.from({ length: rungs }, (_, index) => <mesh key={index}
          name="V26 pit ladder rung" geometry={UNIT_BOX} material={LADDER_RUNG_MATERIAL}
          position={[0, height * (index + 1) / (rungs + 1), 0]}
          scale={[0.12, 0.085, 0.7]} castShadow />)}
      </group>
    })}
  </group> : null
}

/** One draw call for bounded, undiscovered terrain instead of a mesh per tile. */
function UnchartedTerrain({ cells }: { cells: readonly WizardTerrainCell[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const instance = useMemo(() => new THREE.Object3D(), [])
  const signature = cells.map((cell) => `${cell.id}:${cell.position.join(',')}`).join('|')
  useLayoutEffect(() => {
    if (!mesh.current) return
    cells.forEach((cell, index) => {
      instance.position.set(cell.position[0], cell.position[1] - 2.875, cell.position[2])
      instance.scale.set(cell.size[0] + 0.04, 6, cell.size[1] + 0.04)
      instance.updateMatrix()
      mesh.current!.setMatrixAt(index, instance.matrix)
    })
    mesh.current.instanceMatrix.needsUpdate = true
  // The signature represents all matrix inputs; projections may rebuild equal arrays at 20 Hz.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, signature])
  return cells.length ? <instancedMesh key={cells.length} ref={mesh}
    name="Uncharted terrain fog" args={[UNIT_BOX, UNCHARTED_GROUND_MATERIAL, cells.length]}
    frustumCulled={false} /> : null
}

function Tree({ node, pose, yaw, scale, baseOpacity }: { node: WizardResourceNode; pose: PresentationPose; yaw: number; scale: number; baseOpacity: number }) {
  const timber = node.visualKind === 'mireglass-timber' && node.available
  const [barkMaterial] = useState(() => new THREE.MeshStandardMaterial({ color: '#5c3b27', roughness: 0.95,
    transparent: true, opacity: baseOpacity }))
  const [crownMaterial] = useState(() => new THREE.MeshStandardMaterial({ color: timber ? '#4b795f' : '#ffffff', vertexColors: !timber,
    roughness: 0.88, transparent: true, opacity: baseOpacity, depthWrite: true }))
  useEffect(() => () => {
    barkMaterial.dispose()
    crownMaterial.dispose()
  }, [barkMaterial, crownMaterial])
  const occluded = useRef(false)
  const treeOpacity = useRef(baseOpacity)
  const [x, y, z] = node.position
  useFrame(({ camera }, delta) => {
    const centreY = y + CANOPY_CENTRE_Y_M * scale
    const ax = camera.position.x
    const ay = camera.position.y
    const az = camera.position.z
    const dx = pose.position.x - ax
    const dy = pose.position.y + AVATAR_FOCUS_HEIGHT_M - ay
    const dz = pose.position.z - az
    const length2 = dx * dx + dy * dy + dz * dz
    const t = length2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (centreY - ay) * dy + (z - az) * dz) / length2)) : 0
    const distance = Math.hypot(ax + dx * t - x, ay + dy * t - centreY, az + dz * t - z)
    const radius = CANOPY_RADIUS_M * scale
    const margin = occluded.current ? OCCLUDE_EXIT_MARGIN_M : OCCLUDE_ENTER_MARGIN_M
    occluded.current = distance < radius + margin || treeTrunkBlocksView(camera.position, pose.position, node.position, scale, margin)
    const target = occluded.current ? Math.min(baseOpacity, OCCLUDED_OPACITY) : baseOpacity
    treeOpacity.current += (target - treeOpacity.current) * damping(occluded.current ? FADE_OUT_PER_S : FADE_IN_PER_S, delta)
    barkMaterial.opacity = crownMaterial.opacity = treeOpacity.current
    barkMaterial.depthWrite = !occluded.current
  })
  // Shadow depth ignores opacity, so a faded (depleted) node stops casting rather than leaving a solid silhouette.
  const castShadow = node.available
  return (
    <group name={timber ? 'Harvestable Mireglass timber' : undefined}
      position={[x, y, z]} rotation={[0, yaw, 0]} scale={scale}>
      {/* Crown depth writing prevents its overlapping transparent lobes from stacking over the wizard. */}
      <mesh geometry={TREE_ROOT_GEOMETRY} material={barkMaterial} position={[0, 0.24, 0]} castShadow={castShadow} />
      <mesh geometry={TREE_TRUNK_GEOMETRY} material={barkMaterial} position={[0, 1.68, 0]} castShadow={castShadow} />
      {!timber && <><mesh geometry={TREE_BRANCH_GEOMETRY} material={barkMaterial} position={[-0.46, 2.75, 0.08]}
        rotation={[0, 0, 0.82]} scale={[1, 1.55, 1]} castShadow={castShadow} />
      <mesh geometry={TREE_BRANCH_GEOMETRY} material={barkMaterial} position={[0.46, 2.9, -0.12]}
        rotation={[0, 0, -0.76]} scale={[1, 1.44, 1]} castShadow={castShadow} />
      <mesh geometry={TREE_BRANCH_GEOMETRY} material={barkMaterial} position={[0, 2.87, 0.39]}
        rotation={[0.72, 0, 0]} scale={[1, 1.15, 1]} castShadow={castShadow} /></>}
      <mesh geometry={timber ? MIREGLASS_TIMBER_CROWN_GEOMETRY : TREE_CROWN_GEOMETRY}
        material={crownMaterial} position={timber ? [0, 3.75, 0] : undefined} castShadow={castShadow} />
    </group>
  )
}

function Resource({ node, pose }: { node: WizardResourceNode; pose: PresentationPose }) {
  const faded = { transparent: !node.available, opacity: node.available ? 1 : 0.3 }
  const yaw = hashUnit(node.id, 1) * Math.PI * 2
  const scale = 0.88 + hashUnit(node.id, 2) * 0.24
  const position = node.position as [number, number, number]
  if (node.kind === 'tree') return <Tree key={node.visualKind ?? 'tree'} node={node} pose={pose}
    yaw={yaw} scale={scale} baseOpacity={faded.opacity} />
  if (node.visualKind === 'highland-stone') return <group name={`Highland stone: ${node.label} (${node.available ? 'ready' : 'recovering'})`}
    position={position} rotation={[0, yaw, 0]} scale={scale}>
    {/* A depleted node remains a low, dark scar rather than a translucent intact rock. */}
    <mesh geometry={ROCK_GEOMETRY} material={node.available ? HIGHLAND_SCREE_MATERIAL : HIGHLAND_DEPLETED_MATERIAL}
      position={[0, node.available ? 0.27 : 0.08, 0]}
      scale={node.available ? [0.85, 0.34, 0.69] : [0.72, 0.11, 0.6]} castShadow={node.available} />
    {node.available && <>
      <mesh geometry={ROCK_GEOMETRY} material={HIGHLAND_STRATA_MATERIAL}
        position={[0.2, 0.48, -0.14]} rotation={[0.16, 0.3, -0.1]}
        scale={[0.58, 0.21, 0.47]} castShadow />
      <mesh geometry={UNIT_BOX} material={HIGHLAND_CROWN_SEAM_MATERIAL}
        position={[-0.2, 0.52, 0.48]} rotation={[0, -0.25, -0.2]}
        scale={[0.5, 0.055, 0.025]} />
    </>}
  </group>
  if (node.kind === 'ore') {
    return (
      <group position={position} rotation={[0, yaw, 0]} scale={scale}>
        <mesh geometry={ROCK_GEOMETRY} position={[0, 0.45, 0]} rotation={[0.15, 0.4, 0]} scale={0.7} castShadow={node.available}>
          <meshStandardMaterial color="#5d6477" roughness={0.6} metalness={0.3} flatShading {...faded} />
        </mesh>
        {([[0.25, 1.0, 0.1, 0.22], [-0.3, 0.9, -0.15, 0.17]] as const).map(([x, y, z, size], index) => (
          <mesh key={index} geometry={CRYSTAL_GEOMETRY} position={[x, y, z]} rotation={[0.3 * index, 0.5, -0.2]} scale={[size, size * 1.8, size]} castShadow={node.available}>
            <meshStandardMaterial color="#a98cff" emissive="#7a52e8" emissiveIntensity={node.available ? 0.9 : 0.15} roughness={0.3} flatShading {...faded} />
          </mesh>
        ))}
      </group>
    )
  }
  const herb = node.kind === 'herb'
  return (
    <group position={position} rotation={[0, yaw, 0]} scale={scale}>
      {[-0.28, 0, 0.28].map((offset, index) => herb ? (
        <group key={offset} position={[offset, 0, 0]} rotation={[0, 0, offset * 1.2]}>
          <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.025, 0.04, 0.4, 5]} /><meshStandardMaterial color="#3f7a2e" roughness={0.9} {...faded} /></mesh>
          <mesh geometry={LEAF_GEOMETRY} position={[0, 0.46, 0]} scale={[0.26, 0.2, 0.26]} castShadow={node.available}>
            <meshStandardMaterial color={index === 1 ? '#8fe066' : '#6fcf55'} emissive="#2d6a1c" emissiveIntensity={0.2} roughness={0.75} flatShading {...faded} />
          </mesh>
        </group>
      ) : (
        <mesh key={offset} geometry={ROCK_GEOMETRY} position={[offset, 0.22, offset * 0.4]} rotation={[0.2, offset * 2, 0]} scale={[0.3, 0.24 + index * 0.04, 0.3]} castShadow={node.available}>
          <meshStandardMaterial color={index === 1 ? '#a89b84' : '#8f8370'} roughness={0.96} flatShading {...faded} />
        </mesh>
      ))}
    </group>
  )
}

function Store({ store, pose }: { store: WizardStore; pose: PresentationPose }) {
  const structure = useRef<THREE.Group>(null)
  useFrame(({ camera }) => {
    if (structure.current) structure.current.visible = !storeStructureOccludesView(pose.position, camera.position, store)
  })
  return (
    <group position={store.position as [number, number, number]}>
      <mesh geometry={UNIT_BOX} position={[0, 0.16, 0]} scale={[3.5, 0.32, 2.5]} castShadow receiveShadow><meshStandardMaterial color="#6d6a62" roughness={0.95} /></mesh>
      <group ref={structure}>
      <mesh geometry={UNIT_BOX} position={[0, 1.3, 0]} scale={[3.2, 2.0, 2.2]} castShadow receiveShadow><meshStandardMaterial color="#8a5a3e" roughness={0.86} /></mesh>
      {([[-1.52, 1.03], [1.52, 1.03], [-1.52, -1.03], [1.52, -1.03]] as const).map(([x, z], index) => (
        <mesh key={index} geometry={UNIT_BOX} material={DARK_WOOD_MATERIAL} position={[x, 1.3, z]} scale={[0.18, 2.0, 0.18]} castShadow />
      ))}
      <mesh position={[0, 2.95, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[2.35, 1.5, 4]} /><meshStandardMaterial color="#7c2f49" roughness={0.7} flatShading /></mesh>
      <mesh geometry={UNIT_BOX} position={[0.9, 3.35, -0.4]} scale={[0.36, 0.9, 0.36]} castShadow><meshStandardMaterial color="#5b5651" roughness={0.9} /></mesh>
      <mesh geometry={UNIT_BOX} position={[0, 1.8, 1.12]} scale={[1.8, 0.7, 0.12]}><meshStandardMaterial color="#d9b872" roughness={0.6} /></mesh>
      <mesh geometry={UNIT_BOX} position={[-0.9, 0.95, 1.12]} scale={[0.7, 1.25, 0.1]}><meshStandardMaterial color="#3d2a1c" roughness={0.9} /></mesh>
      {/* The lit window is purely emissive; a per-store point light was not worth its per-fragment cost. */}
      <mesh geometry={UNIT_BOX} position={[0.8, 1.15, 1.12]} scale={[0.6, 0.6, 0.1]}><meshStandardMaterial color="#ffd98a" emissive="#ffb650" emissiveIntensity={1.9} roughness={0.3} /></mesh>
      </group>
    </group>
  )
}

function FairyRing({ ring }: { ring: WizardFairyRing }) {
  const mushrooms = useMemo(() => Array.from({ length: 11 }, (_, index) => {
    const angle = index / 11 * Math.PI * 2
    return [Math.cos(angle) * 1.35, Math.sin(angle) * 1.35, angle, 0.8 + hashUnit(`${ring.id}:${index}`, 4) * 0.45] as const
  }), [ring.id])
  const glow = ring.discovered ? 1 : 0.4
  return (
    <group position={ring.position as [number, number, number]}>
      <pointLight position={[0, 0.8, 0]} color="#b085ff" intensity={ring.discovered ? 12 : 4} distance={7} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.95, 1.7, 40]} />
        <meshStandardMaterial color="#5a3f7a" emissive="#8a5cff" emissiveIntensity={0.6 * glow} roughness={0.8} transparent opacity={0.55} depthWrite={false} />
      </mesh>
      {mushrooms.map(([x, z, angle, size], index) => (
        <group key={index} position={[x, 0, z]} rotation={[0, -angle, 0]} scale={size}>
          <mesh position={[0, 0.22, 0]} castShadow><cylinderGeometry args={[0.06, 0.1, 0.44, 7]} /><meshStandardMaterial color="#efe7d6" roughness={0.85} /></mesh>
          <mesh position={[0, 0.48, 0]} castShadow><coneGeometry args={[0.24, 0.22, 8]} /><meshStandardMaterial color={ring.discovered ? '#b06cea' : '#776a78'} emissive="#713ea5" emissiveIntensity={0.9 * glow} roughness={0.55} flatShading /></mesh>
        </group>
      ))}
    </group>
  )
}

function Waystone({ inscription }: { inscription: WizardInscription }) {
  return <group name={`Waystone: ${inscription.name}`} position={inscription.position as [number, number, number]}>
    <mesh geometry={ROCK_GEOMETRY} position={[0, 1.05, 0]} rotation={[0.08, 0.3, -0.09]} scale={[0.55, 1.05, 0.42]} castShadow>
      <meshStandardMaterial color="#796e91" roughness={0.83} flatShading />
    </mesh>
    <mesh geometry={CRYSTAL_GEOMETRY} position={[0, 1.35, 0.4]} scale={[0.2, 0.38, 0.08]}>
      <meshStandardMaterial color="#bd9cff" emissive="#9b6fff" emissiveIntensity={inscription.studied ? 1.2 : 2.2} roughness={0.3} />
    </mesh>
    <mesh geometry={ROCK_GEOMETRY} position={[0, 0.1, 0]} scale={[0.9, 0.25, 0.8]} receiveShadow><meshStandardMaterial color="#5d566e" roughness={0.95} flatShading /></mesh>
  </group>
}

export function digSiteAppearance(site: Pick<WizardDigSite, 'revealed' | 'excavated'>): 'hidden' | 'mound' | 'dug' {
  return site.excavated ? 'dug' : site.revealed ? 'mound' : 'hidden'
}

function DigSite({ site }: { site: WizardDigSite }) {
  const appearance = digSiteAppearance(site)
  if (appearance === 'hidden') return null
  return <group name={`Dig site: ${site.name} (${appearance})`} position={site.position as [number, number, number]}>
    {appearance === 'dug' ? <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} receiveShadow><circleGeometry args={[0.7, 16]} /><meshStandardMaterial color="#352c23" roughness={1} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}><torusGeometry args={[0.83, 0.15, 6, 16]} /><meshStandardMaterial color="#84684a" roughness={1} flatShading /></mesh>
      {[-1, 1].map((side) => <mesh key={side} geometry={ROCK_GEOMETRY} position={[side * 0.78, 0.14, 0.2]} scale={[0.32, 0.18, 0.3]} castShadow><meshStandardMaterial color="#8c7151" roughness={1} flatShading /></mesh>)}
    </> : <>
      <mesh position={[0, 0.1, 0]} scale={[1, 0.28, 0.75]} castShadow receiveShadow><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial color="#8b7558" roughness={1} flatShading /></mesh>
      <mesh geometry={CRYSTAL_GEOMETRY} position={[0, 0.5, 0]} scale={[0.16, 0.28, 0.16]}><meshStandardMaterial color="#d9bd7a" emissive="#a27c38" emissiveIntensity={0.5} roughness={0.55} /></mesh>
    </>}
  </group>
}

/** Display selection only. The campaign owns revelation, excavation, and interaction reach. */
export function landmarkAppearance(landmark: WizardLandmark): 'west-trail-gate' | 'frontier-marker' | 'bell-alder' | 'quarry-crown' | 'hidden' | 'mound' | 'dug' {
  if (landmark.kind !== 'seal-cache') return landmark.kind
  if (!landmark.revealed) return 'hidden'
  return digSiteAppearance(landmark)
}

function Landmark({ landmark }: { landmark: WizardLandmark }) {
  const appearance = landmarkAppearance(landmark)
  if (appearance === 'hidden') return null
  const position = landmark.position as [number, number, number]
  if (landmark.kind === 'west-trail-gate') return <group name="Greenway west trail to Mireglass" position={position}>
    {[-1.55, 1.55].map((side) => <group key={side} position={[0, 0, side]}>
      <mesh geometry={UNIT_BOX} material={DARK_WOOD_MATERIAL} position={[0, 1.15, 0]} scale={[0.22, 2.3, 0.22]} castShadow />
      <mesh geometry={CRYSTAL_GEOMETRY} material={TRAIL_RUNE_MATERIAL} position={[0, 2.42, 0]} scale={[0.16, 0.32, 0.16]} />
    </group>)}
    <mesh geometry={UNIT_BOX} material={WOOD_MATERIAL} position={[0, 2.2, 0]} scale={[0.22, 0.18, 3.28]} castShadow />
    <mesh geometry={CRYSTAL_GEOMETRY} material={TRAIL_RUNE_MATERIAL} position={[0, 2.74, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.34, 0.58, 0.26]} />
  </group>
  if (landmark.kind === 'frontier-marker') return <group name="Mireglass frontier marker" position={position}>
    <mesh geometry={ROCK_GEOMETRY} material={MARKER_STONE_MATERIAL} position={[0, 0.12, 0]} scale={[0.95, 0.22, 0.7]} castShadow receiveShadow />
    <mesh geometry={ROCK_GEOMETRY} material={MARKER_STONE_MATERIAL} position={[-0.34, 0.84, 0]} rotation={[0, 0.16, -0.12]} scale={[0.32, 0.84, 0.29]} castShadow />
    <mesh geometry={ROCK_GEOMETRY} material={MARKER_STONE_MATERIAL} position={[0.28, 1.02, -0.08]} rotation={[0, -0.18, 0.11]} scale={[0.35, 1.01, 0.3]} castShadow />
    <mesh geometry={UNIT_BOX} material={landmark.studied ? MARKER_DORMANT_MATERIAL : MARKER_RUNE_MATERIAL} position={[0.28, 1.23, 0.27]} rotation={[0, -0.18, 0.11]} scale={[0.09, 0.55, 0.05]} />
    <mesh geometry={CRYSTAL_GEOMETRY} material={MARKER_STONE_MATERIAL} position={[0.02, 1.85, -0.02]} rotation={[0, 0.4, 0.4]} scale={[0.24, 0.36, 0.21]} castShadow />
  </group>
  if (landmark.kind === 'bell-alder') return <group name="Mireglass bell alder" position={position}>
    <mesh geometry={ROCK_GEOMETRY} material={CACHE_PEAT_MATERIAL} position={[0, 0.08, 0]} scale={[0.8, 0.18, 0.65]} receiveShadow />
    <mesh geometry={ALDER_TRUNK_GEOMETRY} material={ALDER_BARK_MATERIAL} position={[0.43, 1.72, 0]} rotation={[0, 0, -0.26]} castShadow />
    <mesh geometry={UNIT_BOX} material={ALDER_BARK_MATERIAL} position={[-0.38, 2.66, 0]} rotation={[0, 0, 0.33]} scale={[1.8, 0.18, 0.18]} castShadow />
    <mesh geometry={UNIT_BOX} material={ALDER_BARK_MATERIAL} position={[1.19, 2.81, -0.12]} rotation={[0, 0, -0.44]} scale={[1.45, 0.16, 0.16]} castShadow />
    <mesh geometry={LEAF_GEOMETRY} material={ALDER_LEAF_MATERIAL} position={[-1.15, 3.1, 0]} scale={[0.92, 0.46, 0.72]} castShadow />
    <mesh geometry={LEAF_GEOMETRY} material={ALDER_LEAF_MATERIAL} position={[0.35, 3.51, -0.16]} scale={[1.25, 0.62, 0.78]} castShadow />
    <mesh geometry={LEAF_GEOMETRY} material={ALDER_LEAF_MATERIAL} position={[1.54, 3.25, -0.16]} scale={[0.86, 0.48, 0.62]} castShadow />
    <mesh geometry={UNIT_BOX} material={ALDER_BARK_MATERIAL} position={[-1.09, 2.26, 0]} scale={[0.035, 0.78, 0.035]} />
    <mesh geometry={CRYSTAL_GEOMETRY} material={ALDER_BELL_MATERIAL} position={[-1.09, 1.79, 0]} scale={[0.2, 0.25, 0.2]} />
  </group>
  if (landmark.kind === 'quarry-crown') return <group name={`Quarry Crown (${landmark.discovered ? 'discovered' : 'undiscovered'})`} position={position}>
    {/* The wind gate frames the canonical path with a clear 3 m opening; it is not a false collision wall. */}
    {[-1.58, 1.58].map((side) => <group key={side} position={[side, 0, 0]}>
      <mesh geometry={ROCK_GEOMETRY} material={HIGHLAND_CROWN_MATERIAL}
        position={[0, 1.48, 0]} rotation={[0, side * 0.1, side * -0.04]}
        scale={[0.21, 1.48, 0.25]} castShadow />
      <mesh geometry={CRYSTAL_GEOMETRY} material={HIGHLAND_CROWN_SEAM_MATERIAL}
        position={[0, 2.83, 0]} scale={[0.1, 0.18, 0.13]} />
      <mesh geometry={ROCK_GEOMETRY} material={HIGHLAND_SCREE_MATERIAL}
        position={[side * 0.1, 0.09, 0]} scale={[0.31, 0.12, 0.37]} receiveShadow />
    </group>)}
    <mesh geometry={UNIT_BOX} material={HIGHLAND_CROWN_MATERIAL}
      position={[0, 3.04, 0]} rotation={[0, 0, 0.03]} scale={[3.35, 0.22, 0.32]} castShadow />
    <mesh geometry={CRYSTAL_GEOMETRY} material={HIGHLAND_CROWN_SEAM_MATERIAL}
      position={[0, 3.34, 0]} scale={[0.21, 0.29, 0.14]} />
  </group>
  return <group name={`Mireglass seal cache (${appearance})`} position={position}>
    {appearance === 'mound' ? <>
      <mesh geometry={ROCK_GEOMETRY} material={CACHE_PEAT_MATERIAL} position={[0, 0.14, 0]} rotation={[0, 0.36, 0]} scale={[0.85, 0.26, 0.63]} castShadow receiveShadow />
      <mesh geometry={ROCK_GEOMETRY} material={MIREGLASS_STONE_MATERIAL} position={[-0.41, 0.27, 0.14]} scale={[0.24, 0.12, 0.2]} castShadow />
      <mesh geometry={CRYSTAL_GEOMETRY} material={MARKER_DORMANT_MATERIAL} position={[0.19, 0.32, 0.03]} scale={[0.12, 0.09, 0.12]} />
    </> : <>
      <mesh geometry={CACHE_PIT_GEOMETRY} material={CACHE_PIT_MATERIAL} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} receiveShadow />
      {[-1, 0, 1].map((side) => <mesh key={side} geometry={ROCK_GEOMETRY} material={CACHE_PEAT_MATERIAL}
        position={[side * 0.62, 0.13, side === 0 ? -0.67 : 0.23]} rotation={[0, side * 0.4, 0]} scale={[0.31, 0.16, 0.26]} castShadow />)}
    </>}
  </group>
}

export function constructionVisuals(routes: readonly WizardRoute[], sites: readonly WizardBuildSite[], siteId: string | null): Pick<WizardRoute, 'id' | 'from' | 'to' | 'built'>[] {
  const preview = sites.find((site) => site.id === siteId && site.discovered && site.status !== 'built' && !routes.some((route) => route.id === site.routeId && route.built))
  return [...routes.filter((route) => route.built), ...(preview ? [{ id: preview.id, from: preview.from, to: preview.to, built: false }] : [])]
}

/** V14 alone replaces the old four-meter Greenway route with the canonical short face. */
export function starterCliffConstructionVisuals(projection: WizardViewProjection,
  routes: ReturnType<typeof constructionVisuals>, visibleSites: readonly WizardBuildSite[]) {
  const cliff = projection.starterCliff
  if (!cliff) return { routes, ladder: null }
  const built = routes.some((route) => route.id === 'greenway_ladder' && route.built)
  const preview = projection.controllerActionsEnabled !== false
    && projection.selectedBuildSiteId === cliff.face.siteId
    && routes.some((route) => route.id === cliff.face.siteId && !route.built)
    && visibleSites.some((site) => site.id === cliff.face.siteId
      && site.routeId === 'greenway_ladder' && site.discovered && site.status === 'ready')
  return {
    routes: routes.filter((route) => route.id !== 'greenway_ladder' && route.id !== cliff.face.siteId),
    ladder: cliff.ladder === 'built' && built ? 'built' as const
      : cliff.ladder === 'preview' && !built && preview ? 'preview' as const : null,
  }
}

/** Canonical positions come from camp authority; tile IDs never determine scene coordinates. */
export function fieldCampVisuals(fieldCamp: WizardViewProjection['fieldCamp'], terrain: readonly WizardTerrainCell[]) {
  const fitsVisibleTerrain = (position: readonly [number, number, number]) => position.every(Number.isFinite)
    && terrain.some((cell) => Math.abs(position[0] - cell.position[0]) + 1.1 <= cell.size[0] / 2
      && Math.abs(position[2] - cell.position[2]) + 1.05 <= cell.size[1] / 2)
  const committed = fieldCamp?.camps[0]
  const preview = fieldCamp?.preview
  const position = preview?.position
  return [
    ...(committed && fitsVisibleTerrain(committed.position) ? [{ ...committed, status: 'built' as const }] : []),
    ...(preview && position && fitsVisibleTerrain(position)
      && !fieldCamp?.camps.some((camp) => camp.tileId === preview.tileId
        || camp.position.every((coordinate, index) => coordinate === position[index]))
      ? [{ tileId: preview.tileId, position, status: preview.rejection ? 'blocked' as const : 'ready' as const }] : []),
  ]
}

function FieldCamp({ camp }: { camp: ReturnType<typeof fieldCampVisuals>[number] }) {
  const built = camp.status === 'built'
  const canvas = built ? CAMP_CANVAS_MATERIAL : camp.status === 'ready' ? CAMP_PREVIEW_MATERIAL : CAMP_BLOCKED_MATERIAL
  return <group name={`Field camp: ${camp.tileId} (${camp.status})`} position={camp.position as [number, number, number]}>
    <mesh geometry={UNIT_BOX} material={built ? DARK_WOOD_MATERIAL : canvas}
      position={[0, 0.06, 0]} scale={[2.2, 0.12, 2.1]} receiveShadow />
    {[-1, 1].map((side) => <mesh key={side} geometry={UNIT_BOX} material={canvas}
      position={[side * 0.5, 0.8, 0]} rotation={[0, 0, side * Math.PI / 4]}
      scale={[0.1, 1.42, 2]} castShadow={built} />)}
    {[-0.85, 0.85].map((z) => <mesh key={z} geometry={UNIT_BOX} material={built ? WOOD_MATERIAL : canvas}
      position={[0, 0.72, z]} scale={[0.1, 1.44, 0.1]} castShadow={built} />)}
    <mesh geometry={ROCK_GEOMETRY} material={built ? MIREGLASS_STONE_MATERIAL : canvas}
      position={[0.8, 0.19, 0.68]} scale={[0.2, 0.18, 0.2]} castShadow={built} />
  </group>
}

/** V11 renders physical authored routes; older Greenway routes retain their legacy markers. */
export function mireglassConstructionGeometry(route: Pick<WizardRoute, 'id' | 'from' | 'to'>,
  physicalRoutes = false) {
  const bridgeId = 'mireglass_reach/route/fen_bridge'
  const ladderId = 'mireglass_reach/route/slate_ladder'
  const kind = route.id === bridgeId || route.id.startsWith(`${bridgeId}/`) ? 'bridge'
    : route.id === ladderId || route.id.startsWith(`${ladderId}/`) ? 'ladder'
      : physicalRoutes && (route.id === 'highland_bridge' || route.id.startsWith('highland_bridge:')) ? 'bridge'
        : physicalRoutes && (route.id === 'greenway_ladder' || route.id.startsWith('greenway_ladder:')) ? 'ramp' : null
  if (!kind) return null
  const dx = route.to[0] - route.from[0]
  const dz = route.to[2] - route.from[2]
  const horizontalSpan = Math.hypot(dx, dz)
  if (horizontalSpan < 0.01) return null
  const rise = route.to[1] - route.from[1]
  // The ladder leans against the seam between tile centres, rather than lying across the whole 4 m tile span.
  const run = kind === 'ladder' ? Math.min(0.65, horizontalSpan * 0.2) : horizontalSpan
  const length = Math.hypot(run, rise)
  const count = kind === 'ladder' ? Math.max(4, Math.ceil(length / 0.32))
    : Math.max(4, Math.ceil(horizontalSpan / 0.65))
  // Raised planks top out 0.135 m above their group origin. Keep that top near v11 route support.
  const deckLift = physicalRoutes ? route.id.startsWith('highland_bridge') ? -0.115 : 0.045 : 0.16
  return { kind, midpoint: [(route.from[0] + route.to[0]) / 2, (route.from[1] + route.to[1]) / 2,
    (route.from[2] + route.to[2]) / 2] as const,
    yaw: Math.atan2(dx, dz), pitch: -Math.atan2(rise, run), run, rise, length, count, deckLift } as const
}

function ConstructionRoute({ route, physicalRoutes = false }: {
  route: Pick<WizardRoute, 'id' | 'from' | 'to' | 'built'>; physicalRoutes?: boolean
}) {
  const mireglass = mireglassConstructionGeometry(route, physicalRoutes)
  if (mireglass) {
    const material = route.built ? WOOD_MATERIAL : GOLD_MATERIAL
    const [x, y, z] = mireglass.midpoint
    if (!route.built) {
      const bridge = mireglass.kind === 'bridge'
      const ladder = mireglass.kind === 'ladder'
      const span = bridge ? mireglass.run + 0.7 : ladder ? mireglass.length + 0.22 : mireglass.run + 0.2
      const sides = bridge ? [-0.57, 0.57] : ladder ? [-0.47, 0.47] : [-0.55, 0.55]
      return <group name={`${mireglass.kind} placement preview`}
        position={[x, y + (bridge ? mireglass.deckLift : ladder ? 0.14 : 0), z]}
        rotation={[ladder || bridge ? mireglass.pitch : 0, mireglass.yaw, 0]}>
        {sides.map((side) => <mesh key={side} geometry={UNIT_BOX} material={ROUTE_GHOST_MATERIAL}
          position={[side, 0.06, 0]} scale={[0.11, 0.1, span]} />)}
        {[-span / 2, span / 2].map((end) => <mesh key={end} geometry={UNIT_BOX}
          material={ROUTE_GHOST_MATERIAL} position={[0, 0.06, end]}
          scale={[bridge ? 1.58 : ladder ? 1.05 : 1.4, 0.05, 0.05]} />)}
      </group>
    }
    if (mireglass.kind === 'bridge') return <group name={route.id.startsWith('highland_bridge')
      ? 'Highland bridge deck' : 'Mireglass fen bridge'} position={[x, y + mireglass.deckLift, z]} rotation={[mireglass.pitch, mireglass.yaw, 0]}>
      {/* One continuous deck and two longitudinal beams carry joined planks across both banks. */}
      <mesh geometry={UNIT_BOX} material={material} scale={[1.58, 0.14, mireglass.run + 0.7]} castShadow={route.built} receiveShadow />
      {[-0.57, 0.57].map((side) => <mesh key={side} geometry={UNIT_BOX} material={DARK_WOOD_MATERIAL}
        position={[side, -0.13, 0]} scale={[0.15, 0.15, mireglass.run + 0.55]} castShadow={route.built} />)}
      {Array.from({ length: mireglass.count }, (_, index) => <mesh key={index} geometry={UNIT_BOX}
        material={route.built && index % 2 ? DARK_WOOD_MATERIAL : material}
        position={[0, 0.105, -mireglass.run / 2 + (index + 0.5) * mireglass.run / mireglass.count]}
        scale={[1.68, 0.06, mireglass.run / mireglass.count + 0.04]} castShadow={route.built} receiveShadow />)}
    </group>
    if (mireglass.kind === 'ramp') return <group name="Greenway low steps" position={[x, y, z]}
      rotation={[0, mireglass.yaw, 0]}>
      {Array.from({ length: mireglass.count }, (_, index) => <mesh key={index} geometry={UNIT_BOX}
        material={material}
        position={[0, -mireglass.rise / 2 + mireglass.rise * (index + 0.5) / mireglass.count + 0.05,
          -mireglass.run / 2 + mireglass.run * (index + 0.5) / mireglass.count]}
        scale={[1.5, 0.1, mireglass.run / mireglass.count + 0.05]} castShadow={route.built} receiveShadow />)}
    </group>
    return <group name="Mireglass slate ladder" position={[x, y + 0.14, z]} rotation={[mireglass.pitch, mireglass.yaw, 0]}>
      {[-0.47, 0.47].map((side) => <mesh key={side} geometry={UNIT_BOX} material={material}
        position={[side, 0, 0]} scale={[0.11, 0.11, mireglass.length + 0.22]} castShadow={route.built} />)}
      {Array.from({ length: mireglass.count }, (_, index) => <mesh key={index} geometry={UNIT_BOX} material={material}
        position={[0, 0.04, -mireglass.length / 2 + (index + 0.5) * mireglass.length / mireglass.count]}
        scale={[1.05, 0.09, 0.14]} castShadow={route.built} />)}
    </group>
  }
  const from = new THREE.Vector3(...route.from)
  const to = new THREE.Vector3(...route.to)
  const midpoint = from.clone().lerp(to, 0.5)
  const length = from.distanceTo(to)
  const yaw = Math.atan2(to.x - from.x, to.z - from.z)
  return (
    <group>
      {[route.from, route.to].map((position, index) => (
        <group key={index} position={[position[0], position[1], position[2]]}>
          <mesh position={[0, 0.5, 0]} material={route.built ? WOOD_MATERIAL : ROUTE_GHOST_MATERIAL} castShadow={route.built}><cylinderGeometry args={[0.11, 0.17, 1.0, 6]} /></mesh>
          <mesh geometry={CRYSTAL_GEOMETRY} position={[0, 1.1, 0]} scale={[0.1, 0.16, 0.1]}>
            <meshStandardMaterial color="#d9b45c" emissive={route.built ? '#ffb347' : '#89c9ff'} emissiveIntensity={route.built ? 0.8 : 1.7} roughness={0.4} metalness={0.4} />
          </mesh>
        </group>
      ))}
      <group position={[midpoint.x, midpoint.y + 0.25, midpoint.z]} rotation={[0, yaw, 0]}>
        {route.built ? Array.from({ length: 7 }, (_, index) => (
          <mesh key={index} geometry={UNIT_BOX} position={[0, 0, -length / 2 + length * index / 6]} rotation={[0, (hashUnit(`${route.id}:${index}`, 5) - 0.5) * 0.12, 0]} scale={[1.35, 0.16, 0.46]} castShadow receiveShadow>
            <meshStandardMaterial color={index % 2 ? '#8a5f36' : '#7d552f'} roughness={0.92} />
          </mesh>
        )) : <>
          {[-0.55, 0.55].map((x) => <mesh key={x} geometry={UNIT_BOX} material={ROUTE_GHOST_MATERIAL}
            position={[x, 0, 0]} scale={[0.08, 0.08, length]} />)}
          {[-length / 2, length / 2].map((end) => <mesh key={end} geometry={UNIT_BOX}
            material={ROUTE_GHOST_MATERIAL} position={[0, 0, end]} scale={[1.2, 0.05, 0.05]} />)}
        </>}
      </group>
    </group>
  )
}

/** The avatar's support climbs from `from` to `to`; rails and rungs follow those same endpoints. */
export function starterCliffLadderGeometry(face: StarterCliffFace) {
  const dx = face.to.x - face.from.x
  const dz = face.to.z - face.from.z
  const run = Math.hypot(dx, dz)
  const rise = face.to.y - face.from.y
  const length = Math.hypot(run, rise)
  return { midpoint: [(face.from.x + face.to.x) / 2, (face.from.y + face.to.y) / 2,
    (face.from.z + face.to.z) / 2] as const,
  run, rise, length, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(rise, run),
  railOffset: face.width / 2 - 0.1, rungWidth: face.width - 0.14,
  rungCount: ladderRungCount(length) }
}

export function StarterCliffLadder({ face, status }: { face: StarterCliffFace; status: 'built' | 'preview' }) {
  const shape = starterCliffLadderGeometry(face)
  const built = status === 'built'
  if (!built) return <group name="Greenway starter cliff ladder (preview)" position={[...shape.midpoint]}
    rotation={[shape.pitch, shape.yaw, 0]}>
    {[-shape.railOffset, shape.railOffset].map((side) => <mesh key={side}
      geometry={UNIT_BOX} material={ROUTE_GHOST_MATERIAL} position={[side, 0, -0.2]}
      scale={[0.13, 0.14, shape.length + 0.5]} />)}
    {[-shape.length / 2, shape.length / 2].map((end) => <mesh key={end}
      geometry={UNIT_BOX} material={ROUTE_GHOST_MATERIAL} position={[0, 0.1, end]}
      scale={[shape.rungWidth, 0.06, 0.06]} />)}
  </group>
  const material = WOOD_MATERIAL
  return <group name={`Greenway starter cliff ladder (${status})`} position={[...shape.midpoint]}
    rotation={[shape.pitch, shape.yaw, 0]}>
    {[-shape.railOffset, shape.railOffset].map((side) => <group key={side}>
      {/* Rails project above the cliff lip as handholds; the short foot stays on the lower bank. */}
      <mesh geometry={UNIT_BOX} material={built ? DARK_WOOD_MATERIAL : material}
        position={[side, 0, -0.2]} scale={[0.13, 0.14, shape.length + 0.5]} castShadow={built} />
      <mesh geometry={UNIT_BOX} material={material} position={[side, 0, shape.length / 2 - 0.04]}
        scale={[0.2, 0.18, 0.22]} castShadow={built} />
    </group>)}
    {Array.from({ length: shape.rungCount }, (_, index) => <mesh key={index}
      geometry={UNIT_BOX} material={built ? LADDER_RUNG_MATERIAL : material}
      position={[0, 0.1, -shape.length / 2 + (index + 1) * shape.length / (shape.rungCount + 1)]}
      scale={[shape.rungWidth, 0.13, 0.08]} castShadow={built} />)}
  </group>
}

/** Trial works keep the authority's deck path and short cliff-face rise, not a legacy route midpoint. */
type RenderedTerrainWorkSite = BuiltTerrainWorkTrialSite | PublicV23ResolvedSite

export function terrainWorkStructureGeometry(site: RenderedTerrainWorkSite) {
  const path = site.kind === 'bridge' ? site.supportPath : site.supportPath.slice(1, 3)
  return path.slice(1).map((to, index) => {
    const from = path[index]
    const dx = to.x - from.x, dz = to.z - from.z
    const run = Math.hypot(dx, dz), rise = to.y - from.y
    return { midpoint: [(from.x + to.x) / 2, (from.y + to.y) / 2,
      (from.z + to.z) / 2] as const, yaw: Math.atan2(dx, dz),
    pitch: -Math.atan2(rise, run), rotationOrder: site.kind === 'ladder' ? 'YXZ' as const : 'XYZ' as const,
    run, rise, length: Math.hypot(run, rise),
    // The existing top plank is 0.125 m above its group origin. V28's checked
    // supportPath is the walkable deck surface, so align the level wet segments.
    deckLift: site.id.startsWith('works6:river-bridge:') ? 0.035 : 0 }
  })
}

export function terrainWorkConstructionVisuals(trial: WizardViewProjection['terrainWorkTrial'],
  terrain: readonly WizardTerrainCell[]) {
  if (!trial) return []
  const visible = new Set(terrain.map((cell) => cell.id))
  const built: { site: BuiltTerrainWorkTrialSite; built: boolean }[] = trial.builtSites
    .filter((site) => site.footprintTileIds.some((id) => visible.has(id)))
    .map((site) => ({ site, built: true }))
  const selected = trial.selectedSite
  if (selected && selected.kind !== 'dig' && trial.selectedRejection === null
    && !trial.builtSites.some((site) => site.id === selected.id)
    && selected.footprintTileIds.some((id) => visible.has(id))) {
    built.push({ site: selected, built: false })
  }
  return built
}

/** Saved structures and the aimed ghost never reveal an undiscovered footprint. */
export function savedTerrainWorkVisuals(saved: WizardViewProjection['savedTerrainWorks'],
  terrain: readonly WizardTerrainCell[], regional?: WizardRegionalLaddersView) {
  if (!saved) return []
  const visible = new Set(terrain.map((cell) => cell.id))
  const regionalIds = new Set([...(regional?.builtSites ?? []),
    ...(regional?.preview ? [regional.preview.site] : [])].map((site) => site.id))
  const superseded = (id: string) => id.startsWith('works5:') && regionalIds.has(id)
  const revealed = (site: BuiltTerrainWorkTrialSite) => site.footprintTileIds.length > 0
    && site.footprintTileIds.every((id) => visible.has(id))
  const built: { site: BuiltTerrainWorkTrialSite; built: boolean; blocked?: boolean }[] =
    saved.builtSites.filter((site) => revealed(site) && !superseded(site.id))
      .map((site) => ({ site, built: true }))
  const aimed = saved.preview?.selected
  if (aimed && !superseded(aimed.site.id) && (aimed.rejection === null
    || (saved.context === 'works4-greenway' || saved.context === 'v28-river')
      && aimed.rejection !== 'undiscovered'
      && aimed.rejection !== 'already_done')
    && aimed.site.kind !== 'dig' && revealed(aimed.site)
    && !saved.builtSites.some((site) => site.id === aimed.site.id)) {
    built.push({ site: aimed.site, built: false,
      ...((saved.context === 'works4-greenway' || saved.context === 'v28-river')
        ? { blocked: aimed.rejection !== null } : {}) })
  }
  return built
}

/** The optional V23 scene feed never draws any part of a hidden footprint. */
export function regionalLadderVisuals(regional: WizardRegionalLaddersView | undefined,
  terrain: readonly WizardTerrainCell[]) {
  if (!regional) return []
  const visible = new Set(terrain.map((cell) => cell.id))
  const revealed = (site: PublicV23ResolvedSite) => site.footprintTileIds.length > 0
    && site.footprintTileIds.every((id) => visible.has(id))
  const works: { site: PublicV23ResolvedSite; built: boolean; blocked: boolean; source: 'Regional' }[] =
    regional.builtSites.filter(revealed).map((site) => ({ site, built: true, blocked: false, source: 'Regional' }))
  const aimed = regional.preview
  if (aimed && aimed.rejection !== 'undiscovered' && aimed.rejection !== 'already_done'
    && revealed(aimed.site) && !regional.builtSites.some((site) => site.id === aimed.site.id)) {
    works.push({ site: aimed.site, built: false, blocked: aimed.rejection !== null, source: 'Regional' })
  }
  return works
}

export function savedTerrainWorkMarkers(saved: WizardViewProjection['savedTerrainWorks'],
  terrain: readonly WizardTerrainCell[]) {
  if (!saved) return []
  const visible = new Set(terrain.map((cell) => cell.id))
  const built = new Set(saved.builtSites.map((site) => site.id))
  const ghost = new Set(savedTerrainWorkVisuals(saved, terrain)
    .filter((work) => !work.built).map((work) => work.site.id))
  const preview = saved.preview?.nearby.slice(0, 5) ?? []
  const candidates = [...(saved.suggestedSites ?? []).map((site) => ({ site, rejection: null })),
    ...preview]
  return [...new Map(candidates.flatMap(({ site, rejection }) => {
    if (built.has(site.id) || site.kind === 'dig' && saved.dugTileIds.includes(site.footprintTileIds[0])
      || rejection === 'already_done' || rejection === 'undiscovered'
      || !site.footprintTileIds.length || !site.footprintTileIds.every((id) => visible.has(id))
      || ghost.has(site.id)) return []
    const points = site.kind === 'dig' ? [site.center]
      : site.kind === 'bridge' ? [site.from, site.to] : [site.supportPath[1]]
    return [[site.id, { id: site.id, kind: site.kind,
      positions: points.map(({ x, y, z }) => [x, y, z] as const) }] as const]
  })).values()]
}

type WorksSurveySegment = Readonly<{ id: string; from: readonly [number, number, number];
  to: readonly [number, number, number] }>

/** Surveyed obstacle skin, not a buildable-site or Ready verdict. The checked ghost decides that. */
export function greenwayWorksSurveySegments(saved: WizardViewProjection['savedTerrainWorks'],
  revealed: readonly WizardTerrainCell[]): readonly WorksSurveySegment[] {
  if (saved?.context !== 'works4-greenway' || saved.modeActive !== true
    || saved.actionsEnabled !== true || (saved.selectedKind !== 'ladder' && saved.selectedKind !== 'bridge')) return []
  const kind = saved.selectedKind
  const rows = kind === 'ladder' ? [0, -1, -2, -3] : [0, 1, 2, 3, 4]
  const centers = kind === 'ladder'
    ? [-28, -24, -20, -16, -12, -8, -4, 4, 8, 12, 16, 20, 24, 28]
    : [-8, -4, 0, 4, 8]
  const cells = new Map(revealed.filter((cell) => cell.size[0] === WORLD_CELL_METERS
    && cell.size[1] === WORLD_CELL_METERS).map((cell) =>
    [`${cell.position[0]}:${cell.position[2]}`, cell]))
  return centers.flatMap((x) => {
    const footprint = rows.map((gz) => {
      const cell = cells.get(`${x}:${gz * WORLD_CELL_METERS}`)
      return cell?.id === `tile-${x / WORLD_CELL_METERS + 3}-${gz + 3}` ? cell : null
    })
    if (footprint.some((cell) => cell === null)) return []
    const surface = footprint[kind === 'ladder' ? 1 : 2]!
    // The north face slopes back from z=-5.5 at its shoulder. Put the mark
    // visibly in front of its mid-height stone, not at the buried lower foot.
    const y = surface.position[1] + (kind === 'ladder' ? 0.92 : 0.16)
    const z = kind === 'ladder' ? -5.48 : 8
    const halfSpan = kind === 'ladder' ? 1.38 : 1.1
    return [{ id: `${kind}:${x}`, from: [x - halfSpan, y, z] as const,
      to: [x + halfSpan, y, z] as const }]
  })
}

/** Lines are never Mesh objects, so the obstacle-only work picker cannot hit the survey. */
export function GreenwayWorksSurvey({ segments }: { segments: readonly WorksSurveySegment[] }) {
  const signature = segments.map(({ id, from, to }) => `${id}:${from.join(',')}:${to.join(',')}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(segments.flatMap(({ from, to }) =>
    [new THREE.Vector3(...from), new THREE.Vector3(...to),
      new THREE.Vector3(from[0], from[1] + 0.07, from[2]),
      new THREE.Vector3(to[0], to[1] + 0.07, to[2])])), [signature])
  useEffect(() => () => geometry.dispose(), [geometry])
  return segments.length ? <lineSegments name="Greenway Works survey only, aim to check"
    geometry={geometry} material={WORKS_SURVEY_MATERIAL} frustumCulled={false} dispose={null} /> : null
}

/** Revealed dry-foot marks keep previews at the lower approach; built regional Slate marks both feet. */
export function terrainWorkApproachMarkers(works: readonly { site: RenderedTerrainWorkSite; built: boolean; blocked?: boolean }[],
  terrain: readonly WizardTerrainCell[]) {
  const visible = new Set(terrain.map((cell) => cell.id))
  return works.flatMap(({ site, built, blocked }) => {
    const regional = site.obstacle === 'mireglass-slate'
    if ((!built && !regional) || !site.footprintTileIds.length
      || !site.footprintTileIds.every((id) => visible.has(id))) return []
    const anchors = site.kind === 'bridge' || regional && built ? [site.from, site.to] : [site.from]
    return anchors.map((anchor, index) => {
      const upperSlateFoot = regional && built && index === 1
      const greenwayLadder = built && site.kind === 'ladder'
        && site.id.startsWith('works4:ladder:greenway-north-cliff:')
      const toward = site.kind === 'bridge'
        ? index === 0 ? site.to : site.from : site.supportPath[upperSlateFoot ? 2 : 1]
      const away = site.kind === 'bridge' || upperSlateFoot ? anchor : site.from
      const dx = toward.x - away.x, dz = toward.z - away.z
      const length = Math.hypot(dx, dz)
      const offset = site.kind === 'bridge' ? 0.6 : greenwayLadder ? 0.27 : 0.4
      return { id: `${site.id}:${index}`, kind: site.kind,
        position: [greenwayLadder ? toward.x : anchor.x - dx / length * offset, anchor.y + 0.055,
          greenwayLadder ? anchor.z + dz / length * offset : anchor.z - dz / length * offset] as const,
        yaw: Math.atan2(dx, dz), width: Math.min(site.widthMeters, 1.05),
        regional, built, blocked: blocked === true }
    })
  })
}

function TerrainWorkApproachMarker({ marker }: {
  marker: ReturnType<typeof terrainWorkApproachMarkers>[number]
}) {
  return <group name={`${marker.built ? 'Built' : 'Preview'} ${marker.kind} dry foot ${marker.id}`}
    position={[...marker.position]} rotation={[0, marker.yaw, 0]}>
    {[-0.14, 0.14].map((distance) => <mesh key={distance} geometry={UNIT_BOX}
      material={marker.blocked ? CAMP_BLOCKED_MATERIAL
        : marker.regional ? REGIONAL_LADDER_FOOT_MATERIAL : APPROACH_TRAIL_MATERIAL} position={[0, 0, distance]}
      scale={[marker.width, 0.035, 0.1]} />)}
  </group>
}

/** Candidate markers are presentation only; every footprint tile must already be revealed. */
export function terrainWorkCandidateMarkers(trial: WizardViewProjection['terrainWorkTrial'],
  terrain: readonly WizardTerrainCell[]) {
  if (!trial) return []
  const revealed = new Set(terrain.map((cell) => cell.id))
  const built = new Set(trial.builtSites.map((site) => site.id))
  return trial.candidates.slice(0, 5).flatMap(({ site, rejection }) => {
    if (built.has(site.id) || rejection === 'already_done' || rejection === 'undiscovered'
      || site.footprintTileIds.length === 0 || !site.footprintTileIds.every((id) => revealed.has(id))
      || (site.kind !== 'dig' && trial.selectedId === site.id
        && trial.selectedSite?.id === site.id && trial.selectedRejection === null)) return []
    const points = site.kind === 'dig' ? [site.center]
      : site.kind === 'bridge' ? [site.from, site.to] : [site.supportPath[1]]
    return [{ id: site.id, kind: site.kind,
      positions: points.map(({ x, y, z }) => [x, y, z] as const) }]
  })
}

function TerrainWorkCandidateMarker({ marker }: {
  marker: ReturnType<typeof terrainWorkCandidateMarkers>[number]
}) {
  return <group name={`Unbuilt ${marker.kind} site ${marker.id}`}>
    {marker.kind === 'bridge' && marker.positions.map((position, index) => <group key={index}
      position={[...position]}>
      <mesh geometry={UNIT_BOX} material={STAKE_MATERIAL} position={[0, 0.48, 0]}
        scale={[0.12, 0.96, 0.12]} />
      <mesh geometry={UNIT_BOX} material={GOLD_MATERIAL} position={[0, 0.95, 0]}
        scale={[0.32, 0.09, 0.32]} />
    </group>)}
    {marker.kind === 'ladder' && <group position={[...marker.positions[0]]}>
      <mesh geometry={UNIT_BOX} material={STAKE_MATERIAL}
        position={[0, 0.55, 0]} scale={[0.1, 1.1, 0.1]} />
      <mesh geometry={UNIT_BOX} material={GOLD_MATERIAL}
        position={[0, 1.14, 0]} rotation={[0, 0, Math.PI / 4]}
        scale={[0.3, 0.3, 0.08]} />
    </group>}
    {marker.kind === 'dig' && <group position={[...marker.positions[0]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}
        material={APPROACH_SOIL_MATERIAL}><torusGeometry args={[0.55, 0.08, 5, 16]} /></mesh>
      <group position={[0.55, 0.65, 0]} rotation={[0, 0, -0.2]} scale={0.55}><Spade /></group>
    </group>}
  </group>
}

function RiverWorksBridgeheadPost({ post }: { post: WizardV30BridgeheadPost }) {
  return <group name="River Works survey post" position={[...post.position]}>
    <mesh geometry={UNIT_BOX} material={DARK_WOOD_MATERIAL} position={[0, 0.76, 0]}
      scale={[0.15, 1.52, 0.15]} castShadow />
    <mesh geometry={UNIT_BOX} material={BRIDGEHEAD_SIGN_MATERIAL} position={[0, 1.39, 0]}
      scale={[0.76, 0.42, 0.12]} castShadow />
    {[-1, 1].map((side) => <mesh key={side} geometry={CRYSTAL_GEOMETRY}
      material={BRIDGEHEAD_MARK_MATERIAL} position={[0, 1.39, side * 0.09]}
      scale={[0.15, 0.15, 0.04]} />)}
  </group>
}

export function TerrainWorkStructure({ site, built, blocked = false, source = 'Trial' }: {
  site: RenderedTerrainWorkSite; built: boolean; blocked?: boolean; source?: 'Trial' | 'Saved' | 'Regional'
}) {
  const segments = terrainWorkStructureGeometry(site)
  if (!built) return <group name={`${source} ${site.kind} ${site.id} (${blocked ? 'blocked preview' : 'preview'})`}>
    {segments.map((segment, index) => <group key={index}
      position={[segment.midpoint[0], segment.midpoint[1] + segment.deckLift,
        segment.midpoint[2]]}
      rotation={new THREE.Euler(segment.pitch, segment.yaw, 0, segment.rotationOrder)}>
      {(site.kind === 'bridge' ? [-0.58, 0.58]
        : [-site.widthMeters / 2 + 0.1, site.widthMeters / 2 - 0.1]).map((side) => <mesh key={side}
        geometry={UNIT_BOX} material={blocked ? ROUTE_BLOCKED_GHOST_MATERIAL : ROUTE_GHOST_MATERIAL}
        position={[side, site.kind === 'bridge' ? 0.09 : 0.08, 0]}
        scale={[0.11, 0.1, segment.length + (site.kind === 'bridge' ? 0.18 : 0.42)]} />)}
      {[-segment.length / 2, segment.length / 2].map((end) => <mesh key={end}
        geometry={UNIT_BOX} material={blocked ? ROUTE_BLOCKED_GHOST_MATERIAL : ROUTE_GHOST_MATERIAL}
        position={[0, site.kind === 'bridge' ? 0.09 : 0.16, end]}
        scale={[site.kind === 'bridge' ? site.widthMeters : site.widthMeters - 0.26,
          0.05, 0.05]} />)}
    </group>)}
  </group>
  const material = WOOD_MATERIAL
  return <group name={`${source} ${site.kind} ${site.id} (${built ? 'built' : blocked ? 'blocked preview' : 'preview'})`}>
    {segments.map((segment, index) => <group key={index}
      position={[segment.midpoint[0], segment.midpoint[1] + segment.deckLift,
        segment.midpoint[2]]}
      rotation={new THREE.Euler(segment.pitch, segment.yaw, 0, segment.rotationOrder)}>
      {site.kind === 'bridge' ? <>
        <mesh geometry={UNIT_BOX} material={material} scale={[site.widthMeters, 0.14, segment.length + 0.22]}
          castShadow={built} receiveShadow />
        {[-0.58, 0.58].map((side) => <mesh key={side} geometry={UNIT_BOX}
          material={built ? DARK_WOOD_MATERIAL : material} position={[side, -0.13, 0]}
          scale={[0.15, 0.15, segment.length + 0.18]} castShadow={built} />)}
        {Array.from({ length: Math.ceil(segment.length / 0.65) }, (_, plank) => <mesh key={plank}
          geometry={UNIT_BOX} material={material}
          position={[0, 0.1, -segment.length / 2 + (plank + 0.5) * segment.length / Math.ceil(segment.length / 0.65)]}
          scale={[site.widthMeters + 0.08, 0.05, segment.length / Math.ceil(segment.length / 0.65) + 0.04]}
          castShadow={built} receiveShadow />)}
      </> : <>
        {/* Open rungs on the steep authority path, with feet against the lower rock and handholds above the lip. */}
        {[-site.widthMeters / 2 + 0.1, site.widthMeters / 2 - 0.1].map((side) => <group key={side}>
          <mesh geometry={UNIT_BOX} material={built ? DARK_WOOD_MATERIAL : material}
            position={[side, 0.08, 0]} scale={[0.12, 0.13, segment.length + 0.42]} castShadow={built} />
          <mesh geometry={UNIT_BOX} material={material}
            position={[side, 0.02, -segment.length / 2 - 0.12]}
            scale={[0.19, 0.18, 0.28]} castShadow={built} />
          <mesh geometry={UNIT_BOX} material={material}
            position={[side, 0.22, segment.length / 2 + 0.14]}
            scale={[0.12, 0.3, 0.14]} castShadow={built} />
        </group>)}
        {Array.from({ length: ladderRungCount(segment.length) }, (_, rung) => <mesh
          key={rung} geometry={UNIT_BOX} material={built ? LADDER_RUNG_MATERIAL : material}
          position={[0, 0.16, -segment.length / 2 + (rung + 1) * segment.length / (ladderRungCount(segment.length) + 1)]}
          scale={[site.widthMeters - 0.26, 0.1, 0.08]} castShadow={built} />)}
      </>}
    </group>)}
  </group>
}

/** Small, view-only wind threads around the camera focus, not a physical weather system. */
function HighlandWind({ pose }: { pose: PresentationPose }) {
  const wind = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!wind.current) return
    const travel = (clock.elapsedTime * 2.8) % 9
    wind.current.position.set(pose.position.x - 4 + travel, pose.position.y + 1.3,
      pose.position.z - 2.2)
  })
  return <group ref={wind} name="Highland wind ambience">
    {Array.from({ length: 5 }, (_, index) => <mesh key={index} geometry={UNIT_BOX}
      material={HIGHLAND_WIND_MATERIAL} position={[index * -1.5, 0.35 * index, index % 2 ? 1.4 : 0]}
      rotation={[0, -0.16, 0.09]} scale={[0.75 + (index % 3) * 0.25, 0.018, 0.018]} />)}
  </group>
}

/** Projection-only glyph, rendered only after the Crown tile has actually been discovered. */
function WindwardGlyph({ position, learned }: { position: readonly [number, number, number]; learned: boolean }) {
  return <group name={`Windward Step glyph (${learned ? 'studied' : 'unstudied'})`}
    position={position as [number, number, number]}>
    <mesh geometry={ROCK_GEOMETRY} material={HIGHLAND_CROWN_MATERIAL}
      position={[0, 0.055, 0]} scale={[0.52, 0.11, 0.52]} receiveShadow />
    <mesh geometry={WINDWARD_GLYPH_GEOMETRY}
      material={learned ? WINDWARD_DORMANT_MATERIAL : WINDWARD_RUNE_MATERIAL}
      position={[0, 0.13, 0]} rotation={[-Math.PI / 2, 0, 0]} />
  </group>
}

/** A visible trail landmark only; the checked witness decides whether it can be inspected. */
function HighlandSignalVane({ position, inspected }: { position: readonly [number, number, number]; inspected: boolean }) {
  return <group name={`Highland signal vane (${inspected ? 'inspected' : 'uninspected'})`}
    position={position as [number, number, number]}>
    <mesh geometry={ROCK_GEOMETRY} material={HIGHLAND_SCREE_MATERIAL}
      position={[0, 0.1, 0]} scale={[0.66, 0.18, 0.55]} receiveShadow />
    <mesh geometry={UNIT_BOX} material={HIGHLAND_CROWN_MATERIAL}
      position={[0, 1.12, 0]} rotation={[0, 0, 0.09]} scale={[0.13, 2.05, 0.13]} castShadow />
    <mesh geometry={UNIT_BOX} material={HIGHLAND_CROWN_SEAM_MATERIAL}
      position={[0.12, 1.85, 0]} rotation={[0, 0, -0.16]} scale={[1.15, 0.1, 0.12]} />
    <mesh geometry={CRYSTAL_GEOMETRY}
      material={inspected ? MARKER_DORMANT_MATERIAL : MARKER_RUNE_MATERIAL}
      position={[0.75, 1.9, 0]} rotation={[0, 0, -Math.PI / 2]} scale={[0.43, 0.24, 0.2]} />
    <mesh geometry={CRYSTAL_GEOMETRY} material={HIGHLAND_CROWN_SEAM_MATERIAL}
      position={[0.06, 2.25, 0]} scale={[0.12, 0.2, 0.12]} />
  </group>
}

/** One bounded scene partition for public discoveries and the opt-in ordinary preview. */
export function sceneTerrainFor(projection: WizardViewProjection) {
  const visual = projection.visualWorld ?? projection
  const discoveryIds = projection.visualWorld?.discoveredTileIds ?? projection.previewSceneDiscoveryIds
  const discovered = discoveryIds === undefined ? null : discoveredTileSet(discoveryIds)
  const visibleTerrain = visibleTerrainCells(visual.terrain, projection.player.position,
    projection.visualWorld ? PUBLIC_VISUAL_RADIUS_CELLS : undefined)
  return {
    revealedTerrain: discovered ? visibleTerrain.filter((cell) => discovered.has(cell.id)) : visibleTerrain,
    unchartedFringe: discovered ? visibleTerrain.filter((cell) => !discovered.has(cell.id)) : [],
    discoveryFog: discovered !== null,
  }
}

export type SceneWorkAimKind = 'bridge' | 'ladder' | 'regional-ladder' | 'river-bridge'
export type SceneRegionalAim = Readonly<{ seed: string; discoveredTileIds: readonly string[] }>
export type SceneWorkAimPicker = (clientX: number, clientY: number, kind: SceneWorkAimKind,
  regional?: SceneRegionalAim) => number | null
export type SceneTerrainPicker = (clientX: number, clientY: number,
  kind?: V26TerrainPickKind) => V26PickedTerrainColumn | null

/** V29 can address a saved pit wall; earlier Dig remains ground-only. */
export function sceneTerrainPickKind(projection: WizardViewProjection,
  mode?: 'dig' | 'fill' | 'mine' | 'place-soil' | null): V26TerrainPickKind {
  return mode === 'fill' ? 'fill' : mode === 'place-soil' ? 'dig'
    : projection.v29Mining ? 'v29-open-pit' : 'dig'
}

/** A neutral view hint, not a terrain-action authorization. The writer checks every tap. */
export function v26TargetedTerrainCell(projection: WizardViewProjection,
  revealed: readonly WizardTerrainCell[], picked: V26PickedTerrainColumn | null): WizardTerrainCell | null {
  if (!picked || projection.v26ValleyRimSegments === undefined
    || projection.controllerActionsEnabled !== true || projection.unavailableActions
    || projection.equipment.mainHand?.itemId !== 'field_spade'
      && !projection.v29Mining?.tools.activePick
    || Math.hypot(projection.player.position[0] - picked.gx * WORLD_CELL_METERS,
      projection.player.position[2] - picked.gz * WORLD_CELL_METERS) > 5
    || publicV25RiverCellAtGrid(projection.seed, picked.gx, picked.gz)
    || publicV26TerrainCellIsWet(projection.seed, picked.gx, picked.gz,
      publicV14InsideGreenway({ x: projection.player.position[0],
        z: projection.player.position[2] }) ? 'greenway' : 'streamed')) return null
  const matches = revealed.filter((cell) => cell.id === `tile-${picked.gx + 3}-${picked.gz + 3}`
    && cell.size[0] === WORLD_CELL_METERS && cell.size[1] === WORLD_CELL_METERS
    && cell.position[0] === picked.gx * WORLD_CELL_METERS
    && cell.position[2] === picked.gz * WORLD_CELL_METERS)
  return matches.length === 1 ? matches[0] : null
}

/** Pick the frontmost revealed obstacle skin, never a projected point behind other scenery. */
export function pickVisibleWorkAimX(scene: THREE.Scene, camera: THREE.Camera,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, clientX: number, clientY: number,
  kind: 'bridge' | 'ladder' | 'river-bridge', seed?: string,
  revealedTerrain?: readonly WizardTerrainCell[]): number | null {
  if (bounds.width <= 0 || bounds.height <= 0 || !Number.isFinite(clientX) || !Number.isFinite(clientY)
    || clientX < bounds.left || clientX > bounds.left + bounds.width
    || clientY < bounds.top || clientY > bounds.top + bounds.height) return null
  scene.updateMatrixWorld(true)
  camera.updateMatrixWorld()
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(
    (clientX - bounds.left) / bounds.width * 2 - 1,
    1 - (clientY - bounds.top) / bounds.height * 2), camera)
  const visibleMeshes: THREE.Object3D[] = []
  scene.traverseVisible((object) => { if (object instanceof THREE.Mesh) visibleMeshes.push(object) })
  const hit = raycaster.intersectObjects(visibleMeshes, false)[0]
  if (!hit || scene.fog instanceof THREE.Fog && hit.distance >= scene.fog.far) return null
  if (kind === 'river-bridge') {
    if (!seed || hit.object.name !== 'Greenway creek water') return null
    const gx = Math.round(hit.point.x / WORLD_CELL_METERS)
    const gz = Math.round(hit.point.z / WORLD_CELL_METERS)
    return publicV25RiverCellAtGrid(seed, gx, gz) ? gx * WORLD_CELL_METERS : null
  }
  if (kind === 'bridge') return hit.object.name === 'Greenway creek water'
    && Math.abs(hit.point.x) <= 10 && hit.point.z >= 6 && hit.point.z <= 10
    ? hit.point.x : null
  if (hit.object.name === 'V26 starter valley rock rim') {
    if (raycaster.ray.origin.z <= -6 || raycaster.ray.direction.z >= 0
      || (hit.face?.normal.z ?? 0) <= 0 || Math.abs(hit.point.x) > 29.4
      || Math.abs(hit.point.z + 6) > 0.55 || !revealedTerrain) return null
    const gx = Math.ceil(hit.point.x / WORLD_CELL_METERS - 0.5)
    const revealed = (gz: number) => revealedTerrain.some((cell) =>
      cell.id === `tile-${gx + 3}-${gz + 3}`
      && cell.size[0] === WORLD_CELL_METERS && cell.size[1] === WORLD_CELL_METERS
      && cell.position[0] === gx * WORLD_CELL_METERS
      && cell.position[2] === gz * WORLD_CELL_METERS)
    return revealed(-1) && revealed(-2) ? hit.point.x : null
  }
  return hit.object.name === 'Terrain perimeter and cliff fascia'
    && Math.abs(hit.point.x) <= 29.4 && Math.abs(hit.point.z + 6) <= 0.2
    ? hit.point.x : null
}

/** A west-face tap selects the tangent Z only from the frontmost visible cliff skin. */
export function pickVisibleRegionalLadderAimZ(scene: THREE.Scene, camera: THREE.Camera,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, clientX: number, clientY: number,
  regional: SceneRegionalAim): number | null {
  if (bounds.width <= 0 || bounds.height <= 0 || !Number.isFinite(clientX) || !Number.isFinite(clientY)
    || clientX < bounds.left || clientX > bounds.left + bounds.width
    || clientY < bounds.top || clientY > bounds.top + bounds.height) return null
  scene.updateMatrixWorld(true)
  camera.updateMatrixWorld()
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(
    (clientX - bounds.left) / bounds.width * 2 - 1,
    1 - (clientY - bounds.top) / bounds.height * 2), camera)
  const visibleMeshes: THREE.Object3D[] = []
  scene.traverseVisible((object) => { if (object instanceof THREE.Mesh) visibleMeshes.push(object) })
  const hit = raycaster.intersectObjects(visibleMeshes, false)[0]
  if (!hit || scene.fog instanceof THREE.Fog && hit.distance >= scene.fog.far
    || hit.object.name !== 'Mireglass cosmetic slate escarpment'
      && hit.object.name !== 'Terrain perimeter and cliff fascia') return null
  const id = publicV23PlacementId(hit.point.z)
  const site = id && resolvePublicV23Site(regional.seed, id)
  if (!site || !site.footprintTileIds.every((tileId) => regional.discoveredTileIds.includes(tileId))) return null
  const lower = site.supportPath[1], upper = site.supportPath[2]
  return hit.point.x >= Math.min(lower.x, upper.x) - 0.2
    && hit.point.x <= Math.max(lower.x, upper.x) + 0.2
    && hit.point.y >= Math.min(lower.y, upper.y) - 0.2
    && hit.point.y <= Math.max(lower.y, upper.y) + 0.2 ? site.from.z : null
}

export function WizardScene({ projection, cameraOrbit, orbiting, terrainMode,
  onAimPickerReady, onTerrainPickerReady }: {
  projection: WizardViewProjection
  cameraOrbit: readonly [number, number]
  orbiting: boolean
  terrainMode?: 'dig' | 'fill' | 'mine' | 'place-soil' | null
  onAimPickerReady?: (picker: SceneWorkAimPicker) => void
  onTerrainPickerReady?: (picker: SceneTerrainPicker) => void
}) {
  const graphics = sceneGraphicsOptionsForSearch(typeof window === 'undefined' ? '' : window.location.search)
  // Region ownership controls actions and HUD state, never which established scenery exists.
  const visual = projection.visualWorld ?? projection
  const { revealedTerrain, unchartedFringe, discoveryFog } = sceneTerrainFor(projection)
  const revealedTerrainRef = useRef(revealedTerrain)
  useLayoutEffect(() => { revealedTerrainRef.current = revealedTerrain }, [revealedTerrain])
  const openPitColumnsRef = useRef(projection.v26OpenPitColumns)
  useLayoutEffect(() => { openPitColumnsRef.current = projection.v26OpenPitColumns }, [projection.v26OpenPitColumns])
  const [hoverSurface, setHoverSurface] = useState<{ canvas: HTMLCanvasElement; picker: SceneTerrainPicker } | null>(null)
  const [hoveredTerrain, setHoveredTerrain] = useState<V26PickedTerrainColumn | null>(null)
  const v26HoverEnabled = projection.v26ValleyRimSegments !== undefined
    && projection.controllerActionsEnabled === true && !projection.unavailableActions
    && (projection.equipment.mainHand?.itemId === 'field_spade'
      || !!projection.v29Mining?.tools.activePick)
  const hoverPickKind = sceneTerrainPickKind(projection, terrainMode)
  useEffect(() => {
    if (!hoverSurface || !v26HoverEnabled) { setHoveredTerrain(null); return }
    const { canvas, picker } = hoverSurface
    const update = (event: PointerEvent) => {
      const next = picker(event.clientX, event.clientY, hoverPickKind)
      setHoveredTerrain((previous) => previous?.gx === next?.gx && previous?.gz === next?.gz
        ? previous : next)
    }
    const clear = () => setHoveredTerrain(null)
    canvas.addEventListener('pointermove', update)
    canvas.addEventListener('pointerdown', update)
    canvas.addEventListener('pointerleave', clear)
    canvas.addEventListener('pointercancel', clear)
    return () => {
      canvas.removeEventListener('pointermove', update)
      canvas.removeEventListener('pointerdown', update)
      canvas.removeEventListener('pointerleave', clear)
      canvas.removeEventListener('pointercancel', clear)
    }
  }, [hoverSurface, v26HoverEnabled, hoverPickKind])
  const targetedTerrain = v26TargetedTerrainCell(projection, revealedTerrain, hoveredTerrain)
  const terrainRevision = terrainSignature(visual.terrain)
  const v27SurfaceReady = projection.v27WalkableSurface === true
    && Boolean(projection.v26ValleyRimSegments?.length)
    && projection.v26OpenPitColumns !== undefined
  const rimSignature = v27SurfaceReady ? projection.v26ValleyRimSegments!.map((segment) =>
    `${segment.id}:${segment.from.x},${segment.from.z}:${segment.to.x},${segment.to.z}`).join('|') : ''
  const pitSignature = v27SurfaceReady ? projection.v26OpenPitColumns!.map((column) =>
    `${column.gx},${column.gz},${column.openDepth}`).join('|') : ''
  const raisedSignature = projection.v31Soil?.raisedCells.map(({ gx, gz }) => `${gx},${gz}`).join('|') ?? ''
  // A classic projection may recreate equal cells at 20 Hz; reuse the presentation lookup by content.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const terrainSampler = useMemo(() => createTerrainSurfaceSampler(projection.seed, visual.terrain,
    terrainAppearanceFor, projection.v26ValleyRimSegments !== undefined || projection.v27WalkableSurface === true,
    v27SurfaceReady ? { rimSegments: projection.v26ValleyRimSegments!,
      openPitColumns: projection.v26OpenPitColumns! } : undefined,
    projection.v31Soil?.raisedCells),
  [projection.seed, terrainRevision, projection.v26ValleyRimSegments !== undefined,
    projection.v27WalkableSurface, v27SurfaceReady, rimSignature, pitSignature, raisedSignature])
  const onPhysicalRoute = Boolean(projection.physicalRoutes?.active)
  const onStarterCliff = projection.starterCliff !== undefined
  const useTerrainPresentation = v27SurfaceReady || !(projection.v26ValleyRimSegments
    || projection.terrainWorkTrial || projection.savedTerrainWorks || onPhysicalRoute || onStarterCliff)
  const [pose] = useState<PresentationPose>(() => ({
    position: new THREE.Vector3(projection.player.position[0],
      useTerrainPresentation
        ? terrainSampler.presentationTargetYAt(projection.player.position[0], projection.player.position[2],
          projection.player.position[1]) : projection.player.position[1],
      projection.player.position[2]), yaw: projection.player.yaw, speed: 0, phase: 0,
  }))
  const worldSupport = useRef<THREE.Group>(null)
  const sunTarget = useMemo(() => new THREE.Object3D(), [])
  const { routes: visibleRoutes, ladder: starterLadder } = starterCliffConstructionVisuals(projection,
    constructionVisuals(visual.routes, visual.buildSites, projection.selectedBuildSiteId), visual.buildSites)
  const visibleWorks = [
    ...terrainWorkConstructionVisuals(projection.terrainWorkTrial, revealedTerrain).map((work) => ({ ...work, source: 'Trial' as const })),
    ...savedTerrainWorkVisuals(projection.savedTerrainWorks, revealedTerrain, projection.regionalLadders)
      .map((work) => ({ ...work, source: 'Saved' as const })),
    ...regionalLadderVisuals(projection.regionalLadders, revealedTerrain),
  ]
  const approachMarkers = terrainWorkApproachMarkers(visibleWorks, revealedTerrain)
  const candidateMarkers = discoveryFog ? [
    ...terrainWorkCandidateMarkers(projection.terrainWorkTrial, revealedTerrain),
    ...savedTerrainWorkMarkers(projection.savedTerrainWorks, revealedTerrain),
  ] : []
  const worksSurvey = discoveryFog ? greenwayWorksSurveySegments(projection.savedTerrainWorks, revealedTerrain) : []
  const bridgeheadPost = projection.v30Bridgehead && revealedTerrain.some((cell) =>
    cell.id === projection.v30Bridgehead!.tileId && cell.size[0] === WORLD_CELL_METERS
    && cell.size[1] === WORLD_CELL_METERS
    && Math.abs(projection.v30Bridgehead!.position[0] - cell.position[0]) < WORLD_CELL_METERS / 2
    && projection.v30Bridgehead!.position[2] === cell.position[2])
    ? projection.v30Bridgehead : null
  const visibleCamps = fieldCampVisuals(projection.fieldCamp, revealedTerrain)
  const landscapeClearings = [
    ...visual.resources, ...visual.stores, ...visual.fairyRings,
    ...visual.inscriptions, ...visual.digSites, ...(visual.landmarks ?? []),
  ].map(({ position }) => [position[0], position[2]] as const)
  for (const route of visual.routes) {
    landscapeClearings.push([route.from[0], route.from[2]], [route.to[0], route.to[2]])
  }
  for (const site of visual.buildSites) {
    landscapeClearings.push([site.from[0], site.from[2]], [site.to[0], site.to[2]])
  }
  for (const { site } of visibleWorks) {
    landscapeClearings.push([site.from.x, site.from.z], [site.to.x, site.to.z])
  }
  for (const marker of candidateMarkers) for (const [x, , z] of marker.positions) {
    landscapeClearings.push([x, z])
  }
  for (const camp of visibleCamps) {
    if (camp.status === 'built') landscapeClearings.push([camp.position[0], camp.position[2]])
  }
  if (projection.windwardStep?.glyph) landscapeClearings.push([
    projection.windwardStep.glyph.position[0], projection.windwardStep.glyph.position[2],
  ])
  return (<>
    <Canvas
      shadows={graphics.shadows}
      dpr={graphics.dpr}
      gl={{
        alpha: false,
        antialias: graphics.antialias,
        powerPreference: 'high-performance',
        outputColorSpace: THREE.SRGBColorSpace,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.08,
      }}
      camera={{ fov: 68, near: 0.08, far: 180 }}
      onCreated={({ scene, camera, gl }) => {
        onAimPickerReady?.((clientX, clientY, kind, regional) =>
          kind === 'regional-ladder' && regional
            ? pickVisibleRegionalLadderAimZ(scene, camera, gl.domElement.getBoundingClientRect(),
              clientX, clientY, regional)
            : kind === 'bridge' || kind === 'ladder' || kind === 'river-bridge'
              ? pickVisibleWorkAimX(scene, camera, gl.domElement.getBoundingClientRect(),
                clientX, clientY, kind, projection.seed, revealedTerrainRef.current) : null)
        const terrainPicker: SceneTerrainPicker = (clientX, clientY, kind) => pickV26TerrainColumn(scene, camera,
          gl.domElement.getBoundingClientRect(), clientX, clientY, revealedTerrainRef.current,
          kind, openPitColumnsRef.current)
        onTerrainPickerReady?.(terrainPicker)
        if (projection.v26ValleyRimSegments !== undefined) {
          setHoverSurface({ canvas: gl.domElement, picker: terrainPicker })
        }
      }}
    >
      <color attach="background" args={[SKY_COLOR]} />
      <fog attach="fog" args={[FOG_COLOR, projection.visualWorld ? PUBLIC_FOG_START_M : 16, fogEndFor(Boolean(projection.visualWorld))]} />
      {/* Light hierarchy: warm sun key with shadows, sky/ground hemisphere fill, cool rim from the shaded side. */}
      <hemisphereLight args={['#cde4ff', '#4f6a33', 0.85]} />
      <ambientLight intensity={0.22} color="#dfe8ff" />
      <group ref={worldSupport} position={[pose.position.x, 0, pose.position.z]}>
        <primitive object={sunTarget} />
        <directionalLight
          position={[18, 30, 12]}
          target={sunTarget}
          intensity={2.9}
          color="#ffe6b8"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-radius={2.5}
          shadow-bias={-0.0004}
          shadow-normalBias={0.04}
          shadow-camera-near={4}
          shadow-camera-far={90}
          shadow-camera-left={-26}
          shadow-camera-right={26}
          shadow-camera-top={26}
          shadow-camera-bottom={-26}
        />
        <directionalLight position={[-16, 10, -20]} target={sunTarget} intensity={0.7} color="#9ec1ff" />
      </group>
      {/* Static bedrock ends at the canonical world faces instead of following the player past the edge. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}
        position={[WORLD_BEDROCK_BOUNDS.centerX, -0.72, WORLD_BEDROCK_BOUNDS.centerZ]} receiveShadow>
        <planeGeometry args={[WORLD_BEDROCK_BOUNDS.width, WORLD_BEDROCK_BOUNDS.depth]} />
        <meshStandardMaterial color={BEDROCK_COLOR} roughness={1} />
      </mesh>
      <PresentationPoseDriver player={projection.player} pose={pose} worldSupport={worldSupport}
        presentationTargetYAt={useTerrainPresentation
          ? terrainSampler.presentationTargetYAt : (_x, _z, authoritativeY) => authoritativeY} />
      <CameraRig pose={pose} cameraOrbit={cameraOrbit} orbiting={orbiting} stores={visual.stores}
        highlandRidgeActive={projection.highlandRidgeActive === true} />
      <TerrainSurfaceLayer seed={projection.seed} cells={revealedTerrain}
        allCells={visual.terrain} appearanceFor={terrainAppearanceFor}
        discoveryFog={discoveryFog} v26RimSegments={projection.v26ValleyRimSegments}
        v27WalkableSurface={projection.v27WalkableSurface}
        v26OpenPitColumns={projection.v26OpenPitColumns}
        raisedSoilCells={projection.v31Soil?.raisedCells} />
      {targetedTerrain && <lineLoop name="Ground target only, checked on tap"
        geometry={TERRAIN_TARGET_OUTLINE} material={TERRAIN_TARGET_MATERIAL}
        position={[targetedTerrain.position[0], targetedTerrain.position[1] + 0.14,
          targetedTerrain.position[2]]} />}
      {projection.v26ValleyRimSegments && <V26ValleyRimLayer
        segments={projection.v26ValleyRimSegments} cells={revealedTerrain} />}
      {projection.v26PitLadders && <V26PitLadderLayer
        ladders={projection.v26PitLadders} cells={revealedTerrain} />}
      <UnchartedTerrain cells={unchartedFringe} />
      {revealedTerrain.map((cell) => <MemoizedTerrainCell key={cell.id} cell={cell} />)}
      <MireglassWaterLayer seed={projection.seed} cells={revealedTerrain} />
      {(projection.v25RiverActive || projection.savedTerrainWorks?.context === 'works4-greenway')
        && <GreenwayCreekWaterLayer seed={projection.seed} cells={revealedTerrain}
          allCells={visual.terrain} appearanceFor={terrainAppearanceFor}
          v25RiverActive={projection.v25RiverActive} />}
      <MireglassCliffLayer seed={projection.seed} cells={revealedTerrain} />
      {projection.highlandRidgeActive && <HighlandRidgeLayer cells={revealedTerrain}
        playerPosition={projection.player.position} />}
      <LandscapeDressing cells={revealedTerrain} clearings={landscapeClearings} />
      {visual.resources.map((node) => <Resource key={node.id} node={node} pose={pose} />)}
      {visual.stores.map((store) => <Store key={store.id} store={store} pose={pose} />)}
      {visual.fairyRings.map((ring) => <FairyRing key={ring.id} ring={ring} />)}
      {visual.inscriptions.map((inscription) => <Waystone key={inscription.id} inscription={inscription} />)}
      {visual.digSites.map((site) => <DigSite key={site.id} site={site} />)}
      {visual.landmarks?.map((landmark) => <Landmark key={landmark.id} landmark={landmark} />)}
      {projection.windwardStep?.glyph && <WindwardGlyph position={projection.windwardStep.glyph.position}
        learned={projection.windwardStep.learned} />}
      {projection.v38SignalVane && revealedTerrain.some((cell) =>
        Math.abs(cell.position[0] - projection.v38SignalVane!.position[0]) <= cell.size[0] / 2
          && Math.abs(cell.position[2] - projection.v38SignalVane!.position[2]) <= cell.size[1] / 2)
        && <HighlandSignalVane position={projection.v38SignalVane.position}
          inspected={projection.v38SignalVane.inspected} />}
      {visibleRoutes.map((route) => <ConstructionRoute key={route.id} route={route}
        physicalRoutes={projection.physicalRoutes !== undefined} />)}
      {starterLadder && <StarterCliffLadder face={projection.starterCliff!.face} status={starterLadder} />}
      <GreenwayWorksSurvey segments={worksSurvey} />
      {bridgeheadPost && <RiverWorksBridgeheadPost post={bridgeheadPost} />}
      {candidateMarkers.map((marker) => <TerrainWorkCandidateMarker key={marker.id} marker={marker} />)}
      {visibleWorks.map((work) => <TerrainWorkStructure
        key={`${work.source}:${work.site.id}`} site={work.site} built={work.built}
        blocked={'blocked' in work && work.blocked === true} source={work.source} />)}
      {approachMarkers.map((marker) => <TerrainWorkApproachMarker key={marker.id} marker={marker} />)}
      {visibleCamps.map((camp) => <FieldCamp key={`${camp.status}:${camp.tileId}`} camp={camp} />)}
      {projection.ambience === 'highland-wind' && <HighlandWind pose={pose} />}
      <WizardAvatar pose={pose} equipment={projection.equipment}
        activePick={projection.v29Mining?.tools.activePick}
        windwardActive={(projection.windwardStep?.activeSeconds ?? 0) > 0} />
    </Canvas>
    {targetedTerrain && <div role="status" style={{ position: 'absolute', left: '50%', top: 84,
      transform: 'translateX(-50%)', padding: '5px 9px', borderRadius: 7,
      background: '#102622d9', color: '#d3e7e7', fontSize: 11, pointerEvents: 'none',
      whiteSpace: 'nowrap' }}>{terrainMode === 'place-soil'
        ? 'Place soil target only. Tap to check this dry cell.'
        : 'Ground target only. Tap to check if digging is possible.'}</div>}
  </>
  )
}
