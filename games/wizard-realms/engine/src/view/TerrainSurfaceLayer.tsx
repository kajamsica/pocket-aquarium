import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mireglassFenDepthAt, mireglassPlateauCliffBetween } from '../domain/mireglassTerrain'
import { publicV25RiverCellAtGrid } from '../domain/publicWorldV25River'
import type { PublicV26ValleyRimSegment } from '../domain/publicWorldV26ValleyRim'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from '../domain/worldChunks'
import type { WizardTerrainCell } from './contracts'

type Appearance = { top: THREE.Color; side: THREE.Color }
type Point = { x: number; y: number; z: number; color: THREE.Color }
type V27WalkableOptions = Readonly<{ rimSegments: readonly PublicV26ValleyRimSegment[];
  openPitColumns: readonly { gx: number; gz: number; openDepth: number }[] }>
type RaisedSoilCell = Readonly<{ gx: number; gz: number }>
export const DISCOVERY_FOG_COLOR = '#a7cddb'
const BASE_Y = -0.72 // Meet the existing bedrock plane at the visible perimeter.
const STEP_HEIGHT = 0.8
const DIRECTIONS = [
  [0, -1, [1, 2, 3]], [1, 0, [3, 4, 5]],
  [0, 1, [5, 6, 7]], [-1, 0, [7, 8, 1]],
] as const
const FAN = [2, 1, 8, 7, 6, 5, 4, 3] as const
const key = (x: number, z: number) => `${x}:${z}`
const atWorldFace = (cell: WizardTerrainCell, dx: number, dz: number) => {
  const [x, , z] = cell.position
  const gx = x / WORLD_CELL_METERS, gz = z / WORLD_CELL_METERS
  return cell.size[0] === WORLD_CELL_METERS && cell.size[1] === WORLD_CELL_METERS
    && Number.isInteger(gx) && Number.isInteger(gz)
    && cell.id === `tile-${gx + 3}-${gz + 3}`
    && (dx < 0 && gx === WORLD_GRID_MIN || dx > 0 && gx === WORLD_GRID_MAX
      || dz < 0 && gz === WORLD_GRID_MIN || dz > 0 && gz === WORLD_GRID_MAX)
}
const TOP_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 })
const FASCIA_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97 })
const DISCOVERY_EDGE_MATERIAL = new THREE.MeshBasicMaterial({ vertexColors: true,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 })
const terrainSignatures = new WeakMap<readonly WizardTerrainCell[], string>()

// Broad world-space pigment masses keep pale ground from washing out under the sun.
// Shared seam points have the same base color and coordinates, so they keep the same tint.
function groundTone(point: Point) {
  const luminance = point.color.r * 0.2126 + point.color.g * 0.7152 + point.color.b * 0.0722
  const pale = THREE.MathUtils.clamp((luminance - 0.35) / 0.4, 0, 1)
  const mass = Math.sin(point.x * 0.11 + point.z * 0.041)
    * Math.sin(point.z * 0.096 - point.x * 0.036)
  return 1 - pale * 0.34 + mass * 0.1
}

export function terrainSignature(cells: readonly WizardTerrainCell[]) {
  const cached = terrainSignatures.get(cells)
  if (cached !== undefined) return cached
  const signature = cells.map((cell) => `${cell.id}:${cell.position.join(',')}:${cell.size.join(',')}:${cell.height}`
    + `:${cell.color}:${cell.climate}:${cell.mireglassApproach}:${cell.highlandSurface}`).join('|')
  terrainSignatures.set(cells, signature)
  return signature
}

export function createTerrainSurfaceSampler(seed: string, allCells: readonly WizardTerrainCell[],
  appearanceFor: (cell: WizardTerrainCell) => Appearance, physicalPitEdges = false,
  v27Walkable?: V27WalkableOptions, raisedSoilCells?: readonly RaisedSoilCell[]) {
  const byGrid = new Map<number, Map<number, WizardTerrainCell>>()
  for (const cell of allCells) {
    const [x, , z] = cell.position
    if (!byGrid.has(x)) byGrid.set(x, new Map())
    byGrid.get(x)!.set(z, cell)
  }
  const at = (x: number, z: number) => byGrid.get(x)?.get(z)
  const looks = new Map<WizardTerrainCell, Appearance>()
  const points = new Map<WizardTerrainCell, Point[]>()
  const appearance = (cell: WizardTerrainCell) => {
    let value = looks.get(cell)
    if (!value) { value = appearanceFor(cell); looks.set(cell, value) }
    return value
  }
  const neighbor = (cell: WizardTerrainCell, dx: number, dz: number) =>
    at(cell.position[0] + dx * cell.size[0], cell.position[2] + dz * cell.size[1])
  const openPits = new Set(v27Walkable?.openPitColumns.filter((column) => column.openDepth > 0)
    .map((column) => key(column.gx, column.gz)))
  const raised = new Set(raisedSoilCells?.map(({ gx, gz }) => key(gx, gz)))
  const linked = (a: WizardTerrainCell, b: WizardTerrainCell | undefined) => {
    if (!b || a.size[0] !== b.size[0] || a.size[1] !== b.size[1]) return false
    const [ax, ay, az] = a.position
    const [bx, by, bz] = b.position
    if (Math.abs(ax - bx) + Math.abs(az - bz) !== (ax === bx ? a.size[1] : a.size[0])) return false
    if (a.size[0] === WORLD_CELL_METERS && a.size[1] === WORLD_CELL_METERS
      && b.size[0] === WORLD_CELL_METERS && b.size[1] === WORLD_CELL_METERS
      && raised.has(key(ax / WORLD_CELL_METERS, az / WORLD_CELL_METERS))
        !== raised.has(key(bx / WORLD_CELL_METERS, bz / WORLD_CELL_METERS))) return false
    const canonical = v27Walkable && a.size[0] === WORLD_CELL_METERS
      && a.size[1] === WORLD_CELL_METERS && [ax, az, bx, bz].every((coordinate) => {
        const grid = coordinate / WORLD_CELL_METERS
        return Number.isInteger(grid) && grid >= WORLD_GRID_MIN && grid <= WORLD_GRID_MAX
      })
    const rise = Math.abs(ay - by)
    if (canonical ? rise > STEP_HEIGHT : rise >= (physicalPitEdges ? 0.3 : STEP_HEIGHT)) return false
    if (mireglassPlateauCliffBetween(seed, ax, az, bx, bz)) return false
    if (canonical) {
      if (openPits.has(key(ax / WORLD_CELL_METERS, az / WORLD_CELL_METERS))
        || openPits.has(key(bx / WORLD_CELL_METERS, bz / WORLD_CELL_METERS))) return false
      if (publicV25RiverCellAtGrid(seed, ax / WORLD_CELL_METERS, az / WORLD_CELL_METERS)
        !== publicV25RiverCellAtGrid(seed, bx / WORLD_CELL_METERS, bz / WORLD_CELL_METERS)) return false
      if (v27Walkable.rimSegments.some(({ from, to }) =>
        from.z === to.z && ax === bx && Math.min(az, bz) < from.z && from.z < Math.max(az, bz)
          && ax >= Math.min(from.x, to.x) && ax <= Math.max(from.x, to.x)
        || from.x === to.x && az === bz && Math.min(ax, bx) < from.x && from.x < Math.max(ax, bx)
          && az >= Math.min(from.z, to.z) && az <= Math.max(from.z, to.z))) return false
    }
    return Boolean(mireglassFenDepthAt(seed, ax, az)) === Boolean(mireglassFenDepthAt(seed, bx, bz))
  }
  const average = (group: readonly WizardTerrainCell[]) => {
    const color = new THREE.Color(0, 0, 0)
    let y = 0
    for (const member of group) { y += member.position[1]; color.add(appearance(member).top) }
    return { y: y / group.length, color: color.multiplyScalar(1 / group.length) }
  }
  const edgePoint = (cell: WizardTerrainCell, dx: number, dz: number) =>
    average(linked(cell, neighbor(cell, dx, dz)) ? [cell, neighbor(cell, dx, dz)!] : [cell])
  const cornerPoint = (cell: WizardTerrainCell, dx: number, dz: number) => {
    const xNeighbor = neighbor(cell, dx, 0)
    const zNeighbor = neighbor(cell, 0, dz)
    const diagonal = at(cell.position[0] + dx * cell.size[0],
      cell.position[2] + dz * cell.size[1])
    const candidates = [cell, xNeighbor, zNeighbor, diagonal].filter((value): value is WizardTerrainCell => !!value)
    const group = [cell]
    for (let index = 0; index < group.length; index += 1) {
      for (const candidate of candidates) {
        if (!group.includes(candidate) && linked(group[index], candidate)) group.push(candidate)
      }
    }
    return average(group)
  }
  const pointsFor = (cell: WizardTerrainCell) => {
    const cached = points.get(cell)
    if (cached) return cached
    const [x, y, z] = cell.position
    const [halfX, halfZ] = [cell.size[0] / 2, cell.size[1] / 2]
    const samples = [
      { y, color: appearance(cell).top }, cornerPoint(cell, -1, -1), edgePoint(cell, 0, -1),
      cornerPoint(cell, 1, -1), edgePoint(cell, 1, 0), cornerPoint(cell, 1, 1),
      edgePoint(cell, 0, 1), cornerPoint(cell, -1, 1), edgePoint(cell, -1, 0),
    ]
    const coordinates = [
      [x, z], [x - halfX, z - halfZ], [x, z - halfZ], [x + halfX, z - halfZ],
      [x + halfX, z], [x + halfX, z + halfZ], [x, z + halfZ],
      [x - halfX, z + halfZ], [x - halfX, z],
    ] as const
    const cellPoints = samples.map((sample, index) =>
      ({ x: coordinates[index][0], y: sample.y, z: coordinates[index][1], color: sample.color }))
    points.set(cell, cellPoints)
    return cellPoints
  }
  const presentationTargetYAt = (x: number, z: number, authoritativeY: number) => {
    const spacing = allCells[0]?.size
    if (!spacing) return authoritativeY
    // Match the domain's nearest-center rule: exact half-cell ties belong to the lower grid coordinate.
    const cell = at(Math.ceil(x / spacing[0] - 0.5) * spacing[0],
      Math.ceil(z / spacing[1] - 0.5) * spacing[1])
    if (!cell) return authoritativeY
    const fan = pointsFor(cell)
    for (let index = 0; index < FAN.length; index += 1) {
      const a = fan[0], b = fan[FAN[index]], c = fan[FAN[(index + 1) % FAN.length]]
      const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
      const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator
      const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator
      if (wa < -0.000001 || wb < -0.000001 || wa + wb > 1.000001) continue
      return authoritativeY + wa * a.y + wb * b.y + (1 - wa - wb) * c.y - cell.position[1]
    }
    return authoritativeY
  }
  return { appearance, neighbor, linked, pointsFor, presentationTargetYAt }
}

/** One continuous, shaded top; only physical cliffs, banks and world faces get fascia. */
export function buildTerrainSurfaceGeometry(seed: string, cells: readonly WizardTerrainCell[],
  allCells: readonly WizardTerrainCell[], appearanceFor: (cell: WizardTerrainCell) => Appearance,
  v26RimSegments?: readonly PublicV26ValleyRimSegment[],
  v27WalkableSurface = false,
  v27OpenPitColumns?: V27WalkableOptions['openPitColumns'],
  raisedSoilCells?: readonly RaisedSoilCell[]) {
  const { appearance, neighbor, linked, pointsFor } = createTerrainSurfaceSampler(seed, allCells,
    appearanceFor, v26RimSegments !== undefined || v27WalkableSurface,
    v27WalkableSurface && v26RimSegments?.length && v27OpenPitColumns ? { rimSegments: v26RimSegments,
      openPitColumns: v27OpenPitColumns } : undefined, raisedSoilCells)
  const onV26Rim = (a: Point, b: Point) => v26RimSegments?.some((segment) => {
    const { from, to } = segment
    return from.x === to.x && a.x === from.x && b.x === from.x
      && Math.max(Math.min(a.z, b.z), Math.min(from.z, to.z))
        < Math.min(Math.max(a.z, b.z), Math.max(from.z, to.z))
      || from.z === to.z && a.z === from.z && b.z === from.z
      && Math.max(Math.min(a.x, b.x), Math.min(from.x, to.x))
        < Math.min(Math.max(a.x, b.x), Math.max(from.x, to.x))
  }) ?? false
  const visible = new Set(cells.map((cell) => key(cell.position[0], cell.position[2])))
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  for (const cell of cells) {
    const start = positions.length / 3
    const cellPoints = pointsFor(cell)
    for (const point of cellPoints) {
      positions.push(point.x, point.y, point.z)
      const tone = groundTone(point)
      colors.push(point.color.r * tone, point.color.g * tone, point.color.b * tone)
    }
    for (let index = 0; index < FAN.length; index += 1) {
      indices.push(start, start + FAN[index], start + FAN[(index + 1) % FAN.length])
    }
  }
  const top = new THREE.BufferGeometry()
  top.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  top.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  top.setIndex(indices)
  top.computeVertexNormals()
  // Matching positions across ordinary cells share a normal, without smoothing across a cliff.
  const normals = top.getAttribute('normal') as THREE.BufferAttribute
  const shared = new Map<string, THREE.Vector3>()
  for (let index = 0; index < positions.length / 3; index += 1) {
    const normalKey = `${positions[index * 3]}:${Math.round(positions[index * 3 + 1] * 100000)}:${positions[index * 3 + 2]}`
    const sum = shared.get(normalKey) ?? new THREE.Vector3()
    sum.add(new THREE.Vector3(normals.getX(index), normals.getY(index), normals.getZ(index)))
    shared.set(normalKey, sum)
  }
  for (let index = 0; index < positions.length / 3; index += 1) {
    const normalKey = `${positions[index * 3]}:${Math.round(positions[index * 3 + 1] * 100000)}:${positions[index * 3 + 2]}`
    const normal = shared.get(normalKey)!.clone().normalize()
    normals.setXYZ(index, normal.x, normal.y, normal.z)
  }
  const sidePositions: number[] = []
  const sideColors: number[] = []
  const sideVertex = (point: Point, y: number, color: THREE.Color) => {
    sidePositions.push(point.x, y, point.z)
    sideColors.push(color.r, color.g, color.b)
  }
  const sideQuad = (a: Point, b: Point, lowerA: number, lowerB: number, color: THREE.Color) => {
    sideVertex(a, a.y, color); sideVertex(b, b.y, color); sideVertex(a, lowerA, color)
    sideVertex(b, b.y, color); sideVertex(b, lowerB, color); sideVertex(a, lowerA, color)
  }
  for (const cell of cells) {
    const cellPoints = pointsFor(cell)
    for (const [dx, dz, edge] of DIRECTIONS) {
      const next = neighbor(cell, dx, dz)
      const nextVisible = next && visible.has(key(next.position[0], next.position[2]))
      // Discovery concealment is not a cliff. The neighbor is still part of the
      // continuous world even when its top is temporarily hidden by fog.
      if (next && !nextVisible) continue
      // A missing neighbor at the bounded render window is not the end of the world.
      if (!next && !atWorldFace(cell, dx, dz)) continue
      if (nextVisible && linked(cell, next)) continue
      if (nextVisible && cell.position[1] <= next.position[1]) continue
      const lower = nextVisible ? pointsFor(next) : null
      for (let index = 0; index < 2; index += 1) {
        const a = cellPoints[edge[index]], b = cellPoints[edge[index + 1]]
        if (onV26Rim(a, b)) continue
        const lowerA = lower?.find((point) => point.x === a.x && point.z === a.z)?.y ?? BASE_Y
        const lowerB = lower?.find((point) => point.x === b.x && point.z === b.z)?.y ?? BASE_Y
        sideQuad(a, b, lowerA, lowerB, appearance(cell).side)
      }
    }
  }
  const sides = new THREE.BufferGeometry()
  sides.setAttribute('position', new THREE.Float32BufferAttribute(sidePositions, 3))
  sides.setAttribute('color', new THREE.Float32BufferAttribute(sideColors, 3))
  sides.computeVertexNormals()
  return { top, sides }
}

/** Feather the last metre of discovered ground into the opaque unknown-field colour. */
export function buildDiscoveryEdgeGeometry(seed: string, cells: readonly WizardTerrainCell[],
  allCells: readonly WizardTerrainCell[], appearanceFor: (cell: WizardTerrainCell) => Appearance,
  raisedSoilCells?: readonly RaisedSoilCell[]) {
  const { neighbor, pointsFor } = createTerrainSurfaceSampler(seed, allCells, appearanceFor,
    false, undefined, raisedSoilCells)
  const visible = new Set(cells.map((cell) => key(cell.position[0], cell.position[2])))
  const positions: number[] = []
  const colors: number[] = []
  const fog = new THREE.Color(DISCOVERY_FOG_COLOR)
  const vertex = (point: Point, alpha: number) => {
    positions.push(point.x, point.y + 0.035, point.z)
    colors.push(fog.r, fog.g, fog.b, alpha)
  }
  for (const cell of cells) {
    const points = pointsFor(cell)
    const center = points[0]
    for (const [dx, dz, edge] of DIRECTIONS) {
      const next = neighbor(cell, dx, dz)
      if (next && visible.has(key(next.position[0], next.position[2]))) continue
      for (let index = 0; index < 2; index += 1) {
        const outerA = points[edge[index]], outerB = points[edge[index + 1]]
        const inward = (outer: Point): Point => ({
          x: outer.x + (center.x - outer.x) * 0.58,
          y: outer.y + (center.y - outer.y) * 0.58,
          z: outer.z + (center.z - outer.z) * 0.58,
          color: fog,
        })
        const innerA = inward(outerA), innerB = inward(outerB)
        vertex(innerA, 0); vertex(outerA, 1); vertex(innerB, 0)
        vertex(outerA, 1); vertex(outerB, 1); vertex(innerB, 0)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))
  geometry.computeVertexNormals()
  return geometry
}

export function TerrainSurfaceLayer({ seed, cells, allCells, appearanceFor, discoveryFog = false,
  v26RimSegments, v27WalkableSurface = false, v26OpenPitColumns, raisedSoilCells }: {
  seed: string; cells: readonly WizardTerrainCell[]; allCells: readonly WizardTerrainCell[]
  appearanceFor: (cell: WizardTerrainCell) => Appearance; discoveryFog?: boolean
  v26RimSegments?: readonly PublicV26ValleyRimSegment[]
  v27WalkableSurface?: boolean
  v26OpenPitColumns?: V27WalkableOptions['openPitColumns']
  raisedSoilCells?: readonly RaisedSoilCell[]
}) {
  const signature = `${cells.map((cell) => cell.id).join('|')}:${terrainSignature(allCells)}`
  const rimSignature = v26RimSegments?.map((segment) => `${segment.id}:${segment.from.x},${segment.from.z}`
    + `:${segment.to.x},${segment.to.z}`).join('|')
  const pitSignature = v27WalkableSurface ? v26OpenPitColumns?.map((column) =>
    `${column.gx},${column.gz},${column.openDepth}`).join('|') : undefined
  const raisedSignature = raisedSoilCells?.map(({ gx, gz }) => `${gx},${gz}`).join('|')
  // Both the visible array and classic projection can be recreated at 20 Hz without changing terrain.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => buildTerrainSurfaceGeometry(seed, cells, allCells, appearanceFor,
    v26RimSegments, v27WalkableSurface, v26OpenPitColumns, raisedSoilCells),
  [seed, appearanceFor, signature, rimSignature, v27WalkableSurface, pitSignature, raisedSignature])
  useEffect(() => () => { geometry.top.dispose(); geometry.sides.dispose() }, [geometry])
  // Both the visible array and classic projection can be recreated at 20 Hz without changing terrain.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const edgeGeometry = useMemo(() => discoveryFog
    ? buildDiscoveryEdgeGeometry(seed, cells, allCells, appearanceFor, raisedSoilCells) : null,
  [seed, appearanceFor, signature, discoveryFog, raisedSignature])
  useEffect(() => () => edgeGeometry?.dispose(), [edgeGeometry])
  return <>
    <mesh geometry={geometry.top} material={TOP_MATERIAL} name="Continuous terrain surface"
      receiveShadow frustumCulled={false} dispose={null} />
    <mesh geometry={geometry.sides} material={FASCIA_MATERIAL} name="Terrain perimeter and cliff fascia"
      receiveShadow frustumCulled={false} dispose={null} />
    {edgeGeometry && <mesh geometry={edgeGeometry} material={DISCOVERY_EDGE_MATERIAL}
      name="Discovery fog edge" frustumCulled={false} renderOrder={2} dispose={null} />}
  </>
}
