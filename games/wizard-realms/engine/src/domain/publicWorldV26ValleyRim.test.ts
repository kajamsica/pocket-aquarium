import { describe, expect, it } from 'vitest'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV25RiverTouchesSegment } from './publicWorldV25RiverSweep'
import { starterCliffCanonicalFace } from './starterCliffProfile'
import { WORLD_CELL_METERS } from './worldChunks'
import { PUBLIC_V26_VALLEY_RIM_PROFILE, publicV26ValleyRimPassage,
  publicV26ValleyRimSegments } from './publicWorldV26ValleyRim'

const seed = 'wizard-realms'
const passage = (from: { x: number; z: number }, to: { x: number; z: number },
  ladders: readonly { x: number; widthMeters: number }[] = []) =>
  publicV26ValleyRimPassage(seed, from, to, ladders)
const gridAt = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
const centerLadder = [{ x: 0, widthMeters: starterCliffCanonicalFace(seed).width }]
const worksLadder = [{ x: -2, widthMeters: 1.05 }]

describe('V26 physical starter valley rim', () => {
  it('has one contiguous north seam and seeded returns that terminate in wet V25 cells', () => {
    expect(PUBLIC_V26_VALLEY_RIM_PROFILE).toBe('physical-starter-valley/v1')
    for (const riverSeed of [seed, 'greenway-alpha', 'mireglass-corpus-1']) {
      const closed = publicV26ValleyRimSegments(riverSeed, [])
      expect(closed[0]).toMatchObject({ from: { x: -30, z: -6 },
        to: { x: 30, z: -6 }, kind: 'cliff' })
      expect(closed[0].ladderAperture).toBeUndefined()
      const [westNorth, aperture, eastNorth, westReturn, eastReturn] =
        publicV26ValleyRimSegments(riverSeed,
          [{ x: 0, widthMeters: starterCliffCanonicalFace(riverSeed).width }])
      expect(westNorth.from).toEqual(closed[0].from)
      expect(westNorth.to).toEqual(aperture.from)
      expect(aperture.to).toEqual(eastNorth.from)
      expect(eastNorth.to).toEqual(closed[0].to)
      expect(aperture.to.x - aperture.from.x).toBe(starterCliffCanonicalFace(riverSeed).width)
      expect(aperture.ladderAperture).toBe(true)
      expect(westReturn.from).toEqual(westNorth.from)
      expect(eastReturn.from).toEqual(eastNorth.to)
      for (const wall of [westReturn, eastReturn]) {
        expect(wall.kind).toBe('rock-return')
        expect(wall.to.z).toBeGreaterThan(-6)
        expect(publicV25RiverCellAtGrid(riverSeed, gridAt(wall.to.x), gridAt(wall.to.z)))
          .toBe(true)
      }
    }
  })

  it('closes the known x=28 no-ladder route and fast diagonal around the cliff end', () => {
    const from = { x: 28, z: -5 }
    const to = { x: 28, z: -7 }
    expect(passage(from, to)).toEqual({ ok: false, reason: 'cliff-needs-ladder' })
    expect(passage(to, from)).toEqual({ ok: false, reason: 'cliff-needs-ladder' })
    expect(passage({ x: 28, z: -4 }, { x: 32, z: -8 }))
      .toEqual({ ok: false, reason: 'cliff-needs-ladder' })
    expect(passage({ x: 32, z: -8 }, { x: 28, z: -4 }))
      .toEqual({ ok: false, reason: 'cliff-needs-ladder' })
  })

  it('blocks both side returns even when the north ladder is built', () => {
    for (const side of [-1, 1]) {
      const inside = { x: side * 29, z: 0 }
      const outside = { x: side * 31, z: 0 }
      expect(passage(inside, outside)).toEqual({ ok: false, reason: 'rock-return-blocked' })
      expect(passage(outside, inside, centerLadder)).toEqual({ ok: false, reason: 'rock-return-blocked' })
    }
    const eastWetEnd = publicV26ValleyRimSegments(seed, [])[2].to
    expect(publicV25RiverTouchesSegment(seed,
      { x: 29, z: eastWetEnd.z + 1 }, { x: 31, z: eastWetEnd.z + 1 })).toBe(true)
  })

  it('leaves ordinary dry walking inside the pocket and beyond the north seam open', () => {
    expect(passage({ x: 0, z: 0 }, { x: 3, z: 0 })).toEqual({ ok: true })
    expect(passage({ x: 28, z: -4 }, { x: 28, z: -5 })).toEqual({ ok: true })
    expect(passage({ x: 20, z: -8 }, { x: 20, z: -10 })).toEqual({ ok: true })
  })

  it('opens only saved ladder spans, including Works4 at x=-2, never adjacent rock', () => {
    const from = { x: 0, z: -5 }, to = { x: 0, z: -7 }
    expect(passage(from, to)).toEqual({ ok: false, reason: 'cliff-needs-ladder' })
    expect(passage(from, to, centerLadder)).toEqual({ ok: true })
    expect(passage(to, from, centerLadder)).toEqual({ ok: true })
    expect(passage({ x: -2, z: -5 }, { x: -2, z: -7 }, worksLadder)).toEqual({ ok: true })
    expect(passage(from, to, worksLadder)).toEqual({ ok: false, reason: 'cliff-needs-ladder' })
    for (const x of [0.525, 0.6, -0.525, -0.6]) {
      expect(passage({ x, z: -5 }, { x, z: -7 }, centerLadder))
        .toEqual({ ok: false, reason: 'cliff-needs-ladder' })
    }
    expect(passage({ x: 28, z: -5 }, { x: 28, z: -7 }, [...worksLadder, ...centerLadder]))
      .toEqual({ ok: false, reason: 'cliff-needs-ladder' })
  })

  it('merges overlapping spans, clamps the seam ends, and keeps side joints sealed', () => {
    const merged = publicV26ValleyRimSegments(seed,
      [{ x: 0, widthMeters: 1.05 }, { x: 0.5, widthMeters: 1.05 }])
    expect(merged.filter((segment) => segment.ladderAperture)).toHaveLength(1)
    expect(merged[1].from.x).toBe(-0.525)
    expect(merged[1].to.x).toBe(1.025)
    const edge = [{ x: 30, widthMeters: 1.05 }]
    const north = publicV26ValleyRimSegments(seed, edge).filter((segment) => segment.kind === 'cliff')
    expect(north.map((segment) => [segment.from.x, segment.to.x]))
      .toEqual([[-30, 29.475], [29.475, 30]])
    expect(passage({ x: 30, z: -5 }, { x: 30, z: -7 }, edge))
      .toEqual({ ok: false, reason: 'rock-return-blocked' })
  })

  it('rejects malformed seeds, coordinates, and ladder spans without opening the wall', () => {
    const valid = { x: 0, z: 0 }
    for (const badSeed of ['', 'x'.repeat(129), null as never]) {
      expect(publicV26ValleyRimPassage(badSeed, valid, valid, []))
        .toEqual({ ok: false, reason: 'invalid-segment' })
      expect(() => publicV26ValleyRimSegments(badSeed, [])).toThrow(RangeError)
    }
    for (const bad of [null, { x: Number.NaN, z: 0 }, { x: Infinity, z: 0 },
      { x: 1023, z: 0 }] as never[]) {
      expect(publicV26ValleyRimPassage(seed, bad, valid, []))
        .toEqual({ ok: false, reason: 'invalid-segment' })
      expect(publicV26ValleyRimPassage(seed, valid, bad, []))
        .toEqual({ ok: false, reason: 'invalid-segment' })
    }
    const crossing = { x: 0, z: -5 }, far = { x: 0, z: -7 }
    for (const bad of [null, true, [{ x: 0, widthMeters: 0 }],
      [{ x: 0, widthMeters: 1e6 }], [{ x: NaN, widthMeters: 1.05 }],
      Array.from({ length: 65 }, () => centerLadder[0])] as never[]) {
      expect(publicV26ValleyRimPassage(seed, crossing, far, bad))
        .toEqual({ ok: false, reason: 'invalid-segment' })
      expect(publicV26ValleyRimSegments(seed, bad).filter((segment) => segment.ladderAperture))
        .toEqual([])
    }
  })
})
