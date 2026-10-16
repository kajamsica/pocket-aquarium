import { mireglassMoveBarrier } from '../domain/mireglassMovementGate'
import { mireglassFenDepthAt } from '../domain/mireglassTerrain'
import { publicV25RiverCellAtGrid } from '../domain/publicWorldV25River'
import { publicV25RiverTouchesSegment } from '../domain/publicWorldV25RiverSweep'
import { starterCliffCanonicalFace } from '../domain/starterCliffProfile'
import type { WizardViewProjection } from './contracts'

type Point = Readonly<{ x: number; z: number }>
type Site = Readonly<{ kind: 'bridge' | 'ladder'; width: number; path: readonly Point[];
  face?: readonly Point[] }>
export type DevRouteResult = { ok: true; waypoints: readonly Point[] }
  | { ok: false; reason: string }

const STEP = 0.5
const MAX_DISTANCE = 100
const MAX_EXPANSIONS = 12000
const grid = (value: number) => Math.ceil(value / 4 - 0.5)
const tileId = (point: Point) => `tile-${grid(point.x) + 3}-${grid(point.z) + 3}`
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)
const finite = (point: Point) => Number.isFinite(point?.x) && Number.isFinite(point?.z)
const key = (x: number, z: number) => `${x},${z}`

function builtSites(view: WizardViewProjection): Site[] {
  const sites = new Map<string, Site>()
  const add = (id: string, kind: 'bridge' | 'ladder', width: number,
    points: readonly (readonly [number, number, number] | { x: number; z: number })[]) => {
    const path = points.map((point) => 'x' in point
      ? { x: point.x, z: point.z } : { x: point[0], z: point[2] })
    if (path.length >= 2 && path.every(finite)) sites.set(id, { kind, width, path,
      ...(kind === 'ladder' ? { face: path.length >= 4 ? path.slice(1, 3) : path } : {}) })
  }
  for (const site of view.savedTerrainWorks?.builtSites ?? []) {
    add(site.id, site.kind, site.widthMeters, site.supportPath)
  }
  for (const site of view.regionalLadders?.builtSites ?? []) {
    add(site.id, 'ladder', site.widthMeters, site.supportPath)
  }
  for (const site of view.v28TravelContinuity?.greenwayLadders ?? []) {
    if (!sites.has(site.id)) add(site.id, 'ladder', 1.05, [site.from, site.to])
  }
  for (const route of view.routes) {
    if (route.built && route.id === 'greenway_ladder' && !sites.has(route.id)) {
      const face = starterCliffCanonicalFace(view.seed)
      add(route.id, 'ladder', face.width, [face.from, face.to])
    }
  }
  return [...sites.values()]
}

function covers(site: Site, point: Point): boolean {
  for (let index = 1; index < site.path.length; index++) {
    const a = site.path[index - 1], b = site.path[index]
    const dx = b.x - a.x, dz = b.z - a.z, lengthSquared = dx * dx + dz * dz
    if (lengthSquared === 0) continue
    const t = ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared
    if (t < -0.02 || t > 1.02) continue
    if (Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz)
      <= site.width / 2 - 0.04) return true
  }
  return false
}

/** A bounded scene-only route hint. The checked movement writer remains final authority. */
export function planDevRoute(view: WizardViewProjection, start: Point,
  destination: Point): DevRouteResult {
  if (!finite(start) || !finite(destination)) return { ok: false, reason: 'Choose visible ground.' }
  if (distance(start, destination) > MAX_DISTANCE) return { ok: false,
    reason: 'Choose a destination within 100 m of the current position.' }
  const known = new Set(view.visualWorld?.discoveredTileIds
    ?? view.map.tiles.filter((tile) => tile.discovered).map((tile) => tile.id))
  const terrain = new Map((view.visualWorld?.terrain ?? view.terrain)
    .filter((cell) => known.has(cell.id))
    .map((cell) => [cell.id, cell]))
  const sites = builtSites(view)
  const supports = (kind: Site['kind'], point: Point) => sites.some((site) =>
    site.kind === kind && covers(site, point))
  const obstacles = [...(view.visualWorld?.resources ?? view.resources)
    .filter((node) => node.available)
    .map((node) => ({ x: node.position[0], z: node.position[2], radius: 0.7 })),
  ...(view.visualWorld?.stores ?? view.stores)
    .map((store) => ({ x: store.position[0], z: store.position[2], radius: 1.1 }))]
    .filter((obstacle) => distance(start, obstacle) > obstacle.radius)
  const clear = (point: Point) => {
    const cell = terrain.get(tileId(point))
    if (!cell || obstacles.some((obstacle) => distance(point, obstacle) < obstacle.radius)) return false
    if (view.v26OpenPitColumns?.some((pit) => pit.openDepth > 0
      && pit.gx === grid(point.x) && pit.gz === grid(point.z))) return false
    const gx = grid(point.x), gz = grid(point.z)
    if (publicV25RiverCellAtGrid(view.seed, gx, gz)
      || mireglassFenDepthAt(view.seed, gx * 4, gz * 4)) {
      return supports('bridge', point)
    }
    return true
  }
  const crossesWall = (a: Point, b: Point) => (view.v26ValleyRimSegments ?? []).some((wall) => {
    if (wall.ladderAperture) return false
    const axis = wall.from.x === wall.to.x ? 'x' : 'z'
    const other = axis === 'x' ? 'z' : 'x'
    const fixed = wall.from[axis], delta = b[axis] - a[axis]
    if (delta === 0) return a[axis] === fixed
      && Math.max(Math.min(a[other], b[other]), Math.min(wall.from[other], wall.to[other]))
      <= Math.min(Math.max(a[other], b[other]), Math.max(wall.from[other], wall.to[other]))
    const t = (fixed - a[axis]) / delta, along = a[other] + t * (b[other] - a[other])
    return t >= 0 && t <= 1 && along >= Math.min(wall.from[other], wall.to[other])
      && along <= Math.max(wall.from[other], wall.to[other])
  })
  // The checked starter writer rejects entering a ladder from its side while
  // traversing the short rail face, even when a wall aperture is already built.
  const staysOnLadderFace = (a: Point, b: Point) => sites.every((site) => {
    if (!site.face || site.face.length !== 2) return true
    const [from, to] = site.face
    const axis = Math.abs(to.x - from.x) > Math.abs(to.z - from.z) ? 'x' : 'z'
    const other = axis === 'x' ? 'z' : 'x'
    const delta = b[axis] - a[axis], low = Math.min(from[axis], to[axis])
    const high = Math.max(from[axis], to[axis])
    if (delta === 0 && (a[axis] < low || a[axis] > high)) return true
    const first = delta === 0 ? 0 : Math.max(0, Math.min((low - a[axis]) / delta,
      (high - a[axis]) / delta))
    const last = delta === 0 ? 1 : Math.min(1, Math.max((low - a[axis]) / delta,
      (high - a[axis]) / delta))
    if (first > last) return true
    const offset = (t: number) => Math.abs(a[other] + (b[other] - a[other]) * t - from[other])
    const inside = (t: number) => offset(t) <= site.width / 2 - 0.04
    return inside(first) === inside(last)
  })
  const riverCornersSafe = (a: Point, b: Point) => {
    if (a.x === b.x || a.z === b.z) return true
    const low = Math.min(a.x, b.x), high = Math.max(a.x, b.x)
    for (let gx = Math.ceil((low - 2) / 4); gx * 4 + 2 < high; gx++) {
      const x = gx * 4 + 2, t = (x - a.x) / (b.x - a.x)
      if (t <= 0) continue
      const z = a.z + t * (b.z - a.z), gz = Math.round((z - 2) / 4)
      if (Math.abs(z - (gz * 4 + 2)) > 1e-8) continue
      try {
        if ([gx, gx + 1].some((cx) => [gz, gz + 1].some((cz) =>
          publicV25RiverCellAtGrid(view.seed, cx, cz))) && !supports('bridge', { x, z })) return false
      } catch { return false }
    }
    return true
  }
  const safe = (a: Point, b: Point) => {
    const count = Math.max(1, Math.ceil(distance(a, b) / 0.25))
    let previous = a
    if (!clear(a) || !riverCornersSafe(a, b)) return false
    for (let index = 1; index <= count; index++) {
      const t = index / count, point = { x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t }
      if (!clear(point) || crossesWall(previous, point)
        || !staysOnLadderFace(previous, point)) return false
      const before = terrain.get(tileId(previous))!, after = terrain.get(tileId(point))!
      const midpoint = { x: (previous.x + point.x) / 2, z: (previous.z + point.z) / 2 }
      if ((grid(previous.x) !== grid(point.x) || grid(previous.z) !== grid(point.z))
        && publicV25RiverTouchesSegment(view.seed, previous, point)
        && !supports('bridge', midpoint)) return false
      if (Math.abs(before.position[1] - after.position[1]) > 0.8 + 1e-6
        && !supports('ladder', midpoint)) return false
      const barrier = mireglassMoveBarrier(view.seed, previous, point)
      if (barrier === 'fen_channel' && !supports('bridge', midpoint)
        || barrier === 'slate_cliff' && !supports('ladder', midpoint)) return false
      previous = point
    }
    return true
  }
  if (!clear(destination)) return { ok: false,
    reason: 'That ground is unrevealed, obstructed, or lacks a built crossing.' }
  if (distance(start, destination) < 0.35) return { ok: true, waypoints: [] }
  if (safe(start, destination)) return { ok: true, waypoints: [destination] }

  type Node = { ix: number; iz: number; g: number; f: number; previous?: string }
  const nodes = new Map<string, Node>(), heap: Node[] = []
  const push = (node: Node) => {
    heap.push(node)
    for (let child = heap.length - 1; child > 0;) {
      const parent = (child - 1) >> 1
      if (heap[parent].f <= heap[child].f) break
      ;[heap[parent], heap[child]] = [heap[child], heap[parent]]; child = parent
    }
  }
  const pop = (): Node | undefined => {
    const first = heap[0], last = heap.pop()
    if (heap.length && last) {
      heap[0] = last
      for (let parent = 0;;) {
        const left = parent * 2 + 1, right = left + 1
        if (left >= heap.length) break
        const child = right < heap.length && heap[right].f < heap[left].f ? right : left
        if (heap[parent].f <= heap[child].f) break
        ;[heap[parent], heap[child]] = [heap[child], heap[parent]]; parent = child
      }
    }
    return first
  }
  const baseX = Math.round(start.x / STEP), baseZ = Math.round(start.z / STEP)
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const ix = baseX + dx, iz = baseZ + dz, point = { x: ix * STEP, z: iz * STEP }
    if (!safe(start, point)) continue
    const g = distance(start, point), node = { ix, iz, g, f: g + distance(point, destination) }
    nodes.set(key(ix, iz), node); push(node)
  }
  const bounds = { minX: Math.min(start.x, destination.x) - 20,
    maxX: Math.max(start.x, destination.x) + 20,
    minZ: Math.min(start.z, destination.z) - 20,
    maxZ: Math.max(start.z, destination.z) + 20 }
  const directions = [-1, 0, 1].flatMap((x) => [-1, 0, 1]
    .filter((z) => x !== 0 || z !== 0).map((z) => ({ x, z })))
  for (let expanded = 0; heap.length && expanded < MAX_EXPANSIONS;) {
    const current = pop()!, id = key(current.ix, current.iz)
    if (nodes.get(id) !== current) continue
    expanded++
    const at = { x: current.ix * STEP, z: current.iz * STEP }
    if (distance(at, destination) <= STEP * 1.5 && safe(at, destination)) {
      const path: Point[] = [destination]
      for (let node: Node | undefined = current; node; node = node.previous
        ? nodes.get(node.previous) : undefined) path.push({ x: node.ix * STEP, z: node.iz * STEP })
      path.push(start); path.reverse()
      const smoothed: Point[] = []
      for (let index = 0; index < path.length - 1;) {
        let next = Math.min(path.length - 1, index + 24)
        while (next > index + 1 && !safe(path[index], path[next])) next--
        smoothed.push(path[next]); index = next
      }
      return { ok: true, waypoints: smoothed }
    }
    for (const direction of directions) {
      const ix = current.ix + direction.x, iz = current.iz + direction.z
      const point = { x: ix * STEP, z: iz * STEP }
      if (point.x < bounds.minX || point.x > bounds.maxX
        || point.z < bounds.minZ || point.z > bounds.maxZ
        || distance(start, point) > MAX_DISTANCE) continue
      const g = current.g + distance(at, point), nextId = key(ix, iz)
      if (g >= (nodes.get(nextId)?.g ?? Infinity) || !safe(at, point)) continue
      const next: Node = { ix, iz, g, f: g + distance(point, destination), previous: id }
      nodes.set(nextId, next); push(next)
    }
  }
  return { ok: false, reason: 'No safe route is known through revealed ground and built crossings.' }
}
