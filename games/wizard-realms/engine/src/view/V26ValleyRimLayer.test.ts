import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { publicV26ValleyRimSegments } from '../domain/publicWorldV26ValleyRim'
import { publicWorldV15StarterTileAtGrid } from '../domain/publicWorldV15StarterSites'
import type { WizardTerrainCell } from './contracts'

const lifecycle = vi.hoisted(() => ({ cleanup: null as null | (() => void) }))
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useMemo: (build: () => unknown) => build(),
    useEffect: (setup: () => () => void) => { lifecycle.cleanup = setup() } }
})

import { buildV26ValleyRimGeometry, V26ValleyRimLayer } from './V26ValleyRimLayer'

const seed = 'wizard-realms'
const tile = (x: number, z: number): WizardTerrainCell => ({
  id: `${x}:${z}`, position: [x, 0.4, z], size: [4, 4], height: 1.1,
  climate: 'rocky', color: '#7b765e',
})
const revealed = Array.from({ length: 17 }, (_, column) => -32 + column * 4)
  .flatMap((x) => Array.from({ length: 8 }, (_, row) => tile(x, -8 + row * 4)))
const xs = (geometry: THREE.BufferGeometry) => {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  return Array.from({ length: positions.count }, (_, index) => positions.getX(index))
}

describe('V26 starter valley rim mesh', () => {
  it('leaves the exact saved x=-2 Works ladder opening free of rock faces', () => {
    const segments = publicV26ValleyRimSegments(seed, [{ x: -2, widthMeters: 1.05 }])
    const geometry = buildV26ValleyRimGeometry(segments, revealed)
    const allX = xs(geometry)
    expect(allX.length).toBeGreaterThan(0)
    expect(allX.some((x) => x > -2.524 && x < -1.476)).toBe(false)
    expect(allX.some((x) => x < -2.525)).toBe(true)
    expect(allX.some((x) => x > -1.475)).toBe(true)
    geometry.dispose()
  })

  it('renders a continuous closed seam and both rock returns from canonical segments', () => {
    const geometry = buildV26ValleyRimGeometry(publicV26ValleyRimSegments(seed, []), revealed)
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute
    const allX = new Set(xs(geometry))
    for (let x = -30; x <= 30; x += 1) expect(allX.has(x)).toBe(true)
    const vertices = Array.from({ length: positions.count }, (_, index) =>
      [positions.getX(index), positions.getY(index), positions.getZ(index)])
    expect(vertices.some(([x, , z]) => x < -29 && z > -5)).toBe(true)
    expect(vertices.some(([x, , z]) => x > 29 && z > -5)).toBe(true)
    expect(new Set(vertices.map(([, y]) => y)).size).toBeGreaterThan(4)
    geometry.dispose()
  })

  it('keeps every closed north crest above both revealed sides of the default valley', () => {
    const sampleX = [-20, 0, 20]
    const groundY = (x: number, z: number) =>
      publicWorldV15StarterTileAtGrid(seed, x / 4, z / 4).center.y
    const cells = sampleX.flatMap((x) => [-8, -4].map((z): WizardTerrainCell => ({
      ...tile(x, z), position: [x, groundY(x, z), z],
    })))
    const geometry = buildV26ValleyRimGeometry(publicV26ValleyRimSegments(seed, []), cells)
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute
    for (const x of sampleX) {
      const upper = groundY(x, -8), lower = groundY(x, -4)
      expect(upper).toBeGreaterThan(lower)
      const crest = Array.from({ length: positions.count }, (_, index) => index)
        .filter((index) => positions.getX(index) === x && positions.getZ(index) === -6)
        .map((index) => positions.getY(index))
      expect(crest.length).toBeGreaterThan(0)
      for (const y of crest) expect(y).toBeGreaterThan(Math.max(upper, lower) + 0.3)
      if (x === 0) expect(Math.min(...crest)).toBeCloseTo(upper + 0.35, 5)
    }
    geometry.dispose()
  })

  it('shows only revealed nearby cells and stays deterministic and bounded', () => {
    const segments = publicV26ValleyRimSegments(seed, [])
    const beforeSegments = structuredClone(segments), beforeCells = structuredClone(revealed)
    const one = buildV26ValleyRimGeometry(segments, revealed)
    const two = buildV26ValleyRimGeometry(segments, revealed)
    expect(one.getAttribute('position').array).toEqual(two.getAttribute('position').array)
    expect(one.getAttribute('color').array).toEqual(two.getAttribute('color').array)
    expect(one.getAttribute('position').count).toBeLessThanOrEqual(8_192)
    expect(segments).toEqual(beforeSegments)
    expect(revealed).toEqual(beforeCells)
    one.dispose(); two.dispose()

    const local = buildV26ValleyRimGeometry(segments, [tile(0, -4)])
    expect(Math.max(...xs(local).map(Math.abs))).toBeLessThanOrEqual(4)
    const hidden = buildV26ValleyRimGeometry(segments, [])
    expect(hidden.getAttribute('position').count).toBe(0)
    local.dispose(); hidden.dispose()
  })

  it('disposes component geometry when its React effect cleans up', () => {
    const element = V26ValleyRimLayer({ segments: publicV26ValleyRimSegments(seed, []),
      cells: [tile(0, -4)] })
    const geometry = element.props.geometry as THREE.BufferGeometry
    const dispose = vi.spyOn(geometry, 'dispose')
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
    lifecycle.cleanup?.()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
