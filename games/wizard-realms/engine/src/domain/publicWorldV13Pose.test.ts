import { describe, expect, it, vi } from 'vitest'
import { DISCOVERY_MASK_BYTES, encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import { mireglassRouteSites } from './mireglassRouteSites'
import { createPublicV11RouteSupport } from './publicV11RouteSupport'
import { validatePublicWorldV12CompactState } from './publicWorldV12CompactValidation'
import type { PublicV12Head } from './publicWorldV12Snapshot'
import { isValidPublicWorldV12State, withPublicV12Windstep } from './publicWorldV12State'
import type { PublicWorldV12State } from './publicWorldV12State'
import { provePublicWorldV13Pose } from './publicWorldV13Pose'
import { createFreshPublicWorld } from './publicWorldState'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { withPublicV11Highland } from './publicWorldV11State'
import { appendTerrainWorkLedger, emptyTerrainWorkLedger } from './terrainWorkLedger'
import { terrainWorkSupportAt } from './terrainWorkSupport'
import { resolveTerrainWorkSite } from './terrainWorks'

const seed = 'greenway-alpha'
const bridgeId = 'works1:bridge:-102:92:z', ladderId = 'works1:ladder:-103:108:W'
const digId = 'tile--64-76'
const base = withPublicV12Windstep(withPublicV11Highland(withPublicV10TerrainRevision(
  withFreshPublicV9Camps(withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))))))
const context = { seed, fieldCampTileIds: [], authoredBuiltRouteIds: [] }
const ledgerWith = (id: string) => appendTerrainWorkLedger(emptyTerrainWorkLedger(), id, context)!
const site = (id: string) => {
  const value = resolveTerrainWorkSite(seed, id)
  if (!value) throw new Error(`Missing fixture ${id}`)
  return value
}
const compact = (state: PublicWorldV12State): PublicV12Head['state'] => {
  const { discoveredTileIds, ...fields } = state
  return { ...fields, discoveryMask: encodeDiscoveredTileIds(discoveredTileIds) }
}
const at = (id: string): PublicV12Head['state'] => {
  const value = site(id)
  const position = value.kind === 'dig' ? value.center : value.from
  const full: PublicWorldV12State = { ...base, movementOwner: 'streamed',
    discoveredTileIds: [...new Set([...base.discoveredTileIds, ...value.footprintTileIds])].sort(),
    player: { ...base.player, position: { ...position } } }
  if (!isValidPublicWorldV12State(full, null)) throw new Error('Invalid pose fixture.')
  return compact(full)
}
const along = (id: string, t: number) => {
  const value = site(id)
  if (value.kind === 'dig') throw new Error('Expected structure fixture.')
  const point = { x: value.from.x + (value.to.x - value.from.x) * t,
    z: value.from.z + (value.to.z - value.from.z) * t }
  return { value, point, y: terrainWorkSupportAt(value, point).floorY! }
}
const posed = (state: PublicV12Head['state'], position: { x: number; y: number; z: number }) =>
  ({ ...state, player: { ...state.player, position } })

describe('v13 terrain-work pose witness, not a save or runtime mount', () => {
  it('uses one canonical bridge deck in both longitudinal directions', () => {
    const ledger = ledgerWith(bridgeId), start = at(bridgeId)
    for (const t of [0.25, 0.75]) {
      const { point, y } = along(bridgeId, t)
      const original = posed(start, { ...point, y })
      const proof = provePublicWorldV13Pose(original, ledger)
      expect(proof?.effectiveFloorY).toBeCloseTo(y)
      expect(proof?.originalY).toBe(y)
      expect(proof?.witness.player.position.y).toBe(y)
      expect(validatePublicWorldV12CompactState(proof!.witness, null)).not.toBeNull()
      expect(original.player.position.y).toBe(y)
    }
    const middle = along(bridgeId, 0.5)
    expect(provePublicWorldV13Pose(posed(start, { ...middle.point, y: middle.y }), ledger)
      ?.effectiveFloorY).toBeCloseTo(middle.y)
    expect(provePublicWorldV13Pose(posed(start,
      { ...middle.point, y: middle.y - 0.001 }), ledger)).toBeNull()
  })

  it('proves the 1.56 m ladder rise on either side of its steep midpoint, then projects only Y', () => {
    const ledger = ledgerWith(ladderId), start = at(ladderId)
    const low = along(ladderId, 0.45), high = along(ladderId, 0.55)
    expect(high.value.to.y - high.value.from.y).toBeCloseTo(1.56)
    expect(high.y).toBeGreaterThan(low.y)
    for (const { point, y } of [low, high]) {
      const original = posed(start, { ...point, y })
      const proof = provePublicWorldV13Pose(original, ledger)
      expect(proof?.effectiveFloorY).toBeCloseTo(y)
      expect(proof?.witness.player.position.y).toBeGreaterThanOrEqual(y)
      expect(proof?.witness.player.verticalVelocity).toBe(original.player.verticalVelocity)
      expect(validatePublicWorldV12CompactState(proof!.witness, null)).not.toBeNull()
      expect(original.player.position.y).toBe(y)
    }
    const upperOriginal = posed(start, { ...high.point, y: high.y })
    const upperProof = provePublicWorldV13Pose(upperOriginal, ledger)!
    expect(validatePublicWorldV12CompactState(upperOriginal, null)).toBeNull()
    expect(upperProof.legacyFloorY).toBeGreaterThan(upperProof.originalY)
    expect(upperProof.witness.player.position.y).toBe(upperProof.legacyFloorY)
    const middle = along(ladderId, 0.5)
    expect(provePublicWorldV13Pose(posed(start, { ...middle.point, y: middle.y }), ledger)
      ?.effectiveFloorY).toBeCloseTo(middle.y)
    expect(provePublicWorldV13Pose(posed(start,
      { ...middle.point, y: middle.y - 0.001 }), ledger)).toBeNull()
    const reverse = [0.75, 0.55, 0.5, 0.45, 0.25].map((t) => along(ladderId, t))
    expect(reverse.map(({ y }) => y)).toEqual([...reverse.map(({ y }) => y)].sort((a, b) => b - a))
    for (const { point, y } of reverse) {
      expect(provePublicWorldV13Pose(posed(start, { ...point, y }), ledger)?.effectiveFloorY)
        .toBeCloseTo(y)
    }
  })

  it('rejects below-floor, outside-width, unbuilt and wrong-site ladder poses', () => {
    const ledger = ledgerWith(ladderId), start = at(ladderId)
    const { value, point, y } = along(ladderId, 0.55)
    const middle = posed(start, { ...point, y })
    expect(terrainWorkSupportAt(value,
      { ...point, z: point.z + value.widthMeters / 2 }).floorY).toBeCloseTo(y)
    expect(provePublicWorldV13Pose(posed(start,
      { ...point, z: point.z + value.widthMeters / 2, y }), ledger)).not.toBeNull()
    expect(terrainWorkSupportAt(value,
      { ...point, z: point.z + value.widthMeters / 2 + 0.001 }).floorY).toBeNull()
    expect(provePublicWorldV13Pose(posed(start, { ...point, y: y - 0.01 }), ledger)).toBeNull()
    expect(provePublicWorldV13Pose(posed(start,
      { ...point, z: point.z + value.widthMeters / 2 + 0.04, y }), ledger)).toBeNull()
    expect(provePublicWorldV13Pose(middle, emptyTerrainWorkLedger())).toBeNull()
    expect(provePublicWorldV13Pose(middle, ledgerWith(bridgeId))).toBeNull()
  })

  it('proves a 0.24 m suitable dig and projects its validation witness, not original Y', () => {
    const value = site(digId)
    if (value.kind !== 'dig') throw new Error('Expected dig fixture.')
    const original = posed(at(digId), { ...value.loweredCenter })
    const proof = provePublicWorldV13Pose(original, ledgerWith(digId))!
    expect(proof.effectiveFloorY).toBeCloseTo(value.center.y - 0.24)
    expect(proof.originalY).toBe(value.loweredCenter.y)
    expect(proof.legacyFloorY).toBe(value.center.y)
    expect(proof.witness.player.position.y).toBe(value.center.y)
    expect(validatePublicWorldV12CompactState(original, null)).toBeNull()
    expect(validatePublicWorldV12CompactState(proof.witness, null)).not.toBeNull()
    expect(original.player.position.y).toBe(value.loweredCenter.y)
    expect(provePublicWorldV13Pose(original, emptyTerrainWorkLedger())).toBeNull()
  })

  it('preserves existing authored ladder support and an untouched Greenway owner', () => {
    const route = mireglassRouteSites(seed).find((candidate) => candidate.kind === 'ladder')!
    const authored: PublicWorldV12State = { ...base, movementOwner: 'streamed',
      player: { ...base.player, position: { ...route.from }, xp: base.player.xp + 60,
        level: 1 + Math.floor((base.player.xp + 60) / 100),
        skillXp: { ...base.player.skillXp, construction: base.player.skillXp.construction + 60 } },
      discoveredTileIds: [...new Set([...base.discoveredTileIds,
        `tile-${route.from.x / 4 + 3}-${route.from.z / 4 + 3}`,
        `tile-${route.to.x / 4 + 3}-${route.to.z / 4 + 3}`])].sort(),
      mireglass: { ...base.mireglass, builtRoutes: { ...base.mireglass.builtRoutes, ladder: route.id } } }
    expect(isValidPublicWorldV12State(authored, null)).toBe(true)
    const point = { x: route.from.x + (route.to.x - route.from.x) * 0.52,
      z: route.from.z + (route.to.z - route.from.z) * 0.52 }
    const y = createPublicV11RouteSupport(authored).at(point)!.floorY
    const original = posed(compact(authored), { ...point, y })
    const proof = provePublicWorldV13Pose(original, emptyTerrainWorkLedger())!
    expect(proof.effectiveFloorY).toBe(y)
    expect(proof.witness.player.position.y).toBe(y)
    expect(validatePublicWorldV12CompactState(proof.witness, null)).not.toBeNull()
    const greenway = compact(base), unchanged = provePublicWorldV13Pose(greenway, emptyTerrainWorkLedger())!
    expect(unchanged.effectiveFloorY).toBeNull()
    expect(unchanged.witness.player.position).toEqual(greenway.player.position)
    expect(unchanged.witness).not.toBe(greenway)
  })

  it('fails closed on malformed ownership or ledger input', () => {
    const start = at(bridgeId)
    expect(provePublicWorldV13Pose(new Proxy(start, {}), emptyTerrainWorkLedger())).toBeNull()
    expect(provePublicWorldV13Pose(start,
      { builtWorkIds: [bridgeId, bridgeId], dugTileIds: [] })).toBeNull()
    expect(provePublicWorldV13Pose({ ...start, movementOwner: 'invented' as never },
      emptyTerrainWorkLedger())).toBeNull()
  })

  it('returns an owned mask on both ownership paths', () => {
    for (const source of [compact(base), at(bridgeId)]) {
      const proof = provePublicWorldV13Pose(source, emptyTerrainWorkLedger())!
      expect(proof).not.toBeNull()
      expect(proof.witness.discoveryMask.buffer).not.toBe(source.discoveryMask.buffer)
      const first = proof.witness.discoveryMask[0]
      source.discoveryMask[0] ^= 1
      expect(proof.witness.discoveryMask[0]).toBe(first)
    }
  })

  it('rejects oversized or shared mask backing before any structured clone', () => {
    const source = compact(base)
    const oversized = new Uint8Array(new ArrayBuffer(DISCOVERY_MASK_BYTES * 2),
      0, DISCOVERY_MASK_BYTES)
    const offset = new Uint8Array(new ArrayBuffer(DISCOVERY_MASK_BYTES + 1),
      1, DISCOVERY_MASK_BYTES)
    const shared = new Uint8Array(new SharedArrayBuffer(DISCOVERY_MASK_BYTES))
    const masks = [oversized, offset, shared]
    const growable = Reflect.construct(ArrayBuffer,
      [DISCOVERY_MASK_BYTES, { maxByteLength: DISCOVERY_MASK_BYTES * 2 }]) as ArrayBuffer
    if ((growable as ArrayBuffer & { resizable?: boolean }).resizable) masks.push(new Uint8Array(growable))
    const clone = vi.spyOn(globalThis, 'structuredClone').mockImplementation(() => {
      throw new Error('A rejected mask reached structuredClone.')
    })
    try {
      for (const discoveryMask of masks) {
        expect(provePublicWorldV13Pose({ ...source, discoveryMask },
          emptyTerrainWorkLedger())).toBeNull()
      }
      expect(clone).not.toHaveBeenCalled()
    } finally { clone.mockRestore() }
  })

  it('rejects a changing seed getter before it can swap in oversized clone backing', () => {
    const source = compact(base), forged = { ...source }
    const oversized = new Uint8Array(new ArrayBuffer(DISCOVERY_MASK_BYTES * 2),
      0, DISCOVERY_MASK_BYTES)
    Object.defineProperty(forged, 'seed', { enumerable: true, get() {
      Object.defineProperty(forged, 'discoveryMask', { value: oversized, enumerable: true })
      return source.seed
    } })
    const clone = vi.spyOn(globalThis, 'structuredClone').mockImplementation(() => {
      throw new Error('A getter-controlled tree reached structuredClone.')
    })
    try {
      expect(provePublicWorldV13Pose(forged, emptyTerrainWorkLedger())).toBeNull()
      expect(clone).not.toHaveBeenCalled()
    } finally { clone.mockRestore() }
  })

  it('keeps the already-dug authored cache pit at its v10 floor', () => {
    const cache = mireglassAnchors(seed).sealCache.tile
    const pit: PublicWorldV12State = { ...base, movementOwner: 'streamed',
      player: { ...base.player, position: { ...cache.center, y: 1.65 }, xp: 50,
        inventory: [...base.player.inventory, { itemId: 'mireglass_reach/item/seal', quantity: 1 }],
        learnedSpellIds: ['wayfinder_glow'],
        skillXp: { ...base.player.skillXp, wayfinding: 10, spellcraft: 10, excavation: 40 } },
      discoveredTileIds: [...base.discoveredTileIds, cache.id].sort(),
      mireglass: { ...base.mireglass, fringeMarkerStudied: true,
        cacheRevealed: true, cacheExcavated: true } }
    expect(isValidPublicWorldV12State(pit, null)).toBe(true)
    const proof = provePublicWorldV13Pose(compact(pit), emptyTerrainWorkLedger())!
    expect(proof.effectiveFloorY).toBe(1.65)
    expect(proof.legacyFloorY).toBe(1.65)
    expect(proof.witness.player.position.y).toBe(1.65)
  })
})
