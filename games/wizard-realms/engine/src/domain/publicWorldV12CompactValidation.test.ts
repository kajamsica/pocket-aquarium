import { describe, expect, it, vi } from 'vitest'
import { decodeDiscoveredTileIds, DISCOVERY_MASK_BYTES, encodeDiscoveredTileIds } from './discoveryMask'
import { createGeneratedWorld } from './generation'
import { mireglassAnchors } from './mireglassContent'
import { mireglassRouteSites } from './mireglassRouteSites'
import { serializeWizardWorld } from './persistence'
import { validatePublicWorldV12CompactState } from './publicWorldV12CompactValidation'
import { commitLegacyImportToPublicV6, inspectLegacyImportSource } from './publicWorldV6'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { createFreshPublicWorld, createPublicWorldFromBootstrap } from './publicWorldState'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { actPublicV11Mireglass, advancePublicWorldV11Frame } from './publicWorldV11Authority'
import { withPublicV11Highland } from './publicWorldV11State'
import type { PublicWorldV11State } from './publicWorldV11State'
import { decodePublicV12Head, PUBLIC_V12_SCHEMA } from './publicWorldV12Snapshot'
import { isValidPublicWorldV12State, withPublicV12Windstep } from './publicWorldV12State'
import type { PublicWorldV12State } from './publicWorldV12State'
import { createStreamedWorld } from './streamedWorld'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const makeState = (profile: 'greenway-classic-v1' | 'greenway-expanded-v1' = 'greenway-classic-v1') =>
  withPublicV12Windstep(withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
    withFreshPublicV7Herbs(createFreshPublicWorld(seed, profile))))))
const fresh = makeState()
const maskOf = (state: PublicWorldV12State) => encodeDiscoveredTileIds(state.discoveredTileIds)

function parity(state: PublicWorldV12State, mask = maskOf(state),
  bootstrap: PublicV6BootstrapRoot | null = null) {
  const { discoveredTileIds: _ids, ...fields } = state
  const compact = { ...fields, discoveryMask: mask }
  const expanded = { ...fields, discoveredTileIds: decodeDiscoveredTileIds(mask) }
  const expected = isValidPublicWorldV12State(expanded, bootstrap)
  expect(validatePublicWorldV12CompactState(compact, bootstrap) !== null).toBe(expected)
  expect(decodePublicV12Head({ schemaVersion: PUBLIC_V12_SCHEMA, saveRevision: 1,
    bootstrap, state: compact }) !== null).toBe(expected)
  return expected
}

describe('bounded compact v12 discovery witness', () => {
  it('agrees with old state and head validation for starter, sparse, boundary, dense and expanded Greenway', () => {
    expect(parity(fresh)).toBe(true)
    expect(parity(makeState('greenway-expanded-v1'))).toBe(true)
    const starter = maskOf(fresh)
    const boundary = new Uint8Array(starter)
    boundary[0] |= 1
    boundary[DISCOVERY_MASK_BYTES - 1] |= 0x80
    expect(parity(fresh, boundary)).toBe(true)
    const dense = new Uint8Array(starter)
    dense.fill(0xff, 0, 128) // At most 1,024 extra IDs in the old differential decoder.
    expect(parity(fresh, dense)).toBe(true)
    const missingStart = new Uint8Array(starter)
    const startBit = encodeDiscoveredTileIds(['tile-3-3'])
      .findIndex((byte) => byte !== 0)
    missingStart[startBit] &= ~encodeDiscoveredTileIds(['tile-3-3'])[startBit]
    expect(parity(fresh, missingStart)).toBe(false)
  })

  it('preserves bootstrap baseline, Greenway, camp, streamed current tile and extra-bit parity', () => {
    const values = new Map([['wizard-realms:world:v5',
      serializeWizardWorld(createGeneratedWorld(seed, 'greenway-classic-v1'))]])
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, bytes: string) => { values.set(key, bytes) } }
    const inspected = inspectLegacyImportSource(storage, 'greenway-classic-v1')
    expect(inspected.status).toBe('available')
    if (inspected.status !== 'available') return
    const imported = commitLegacyImportToPublicV6(storage, inspected)
    expect(imported.status).toBe('committed')
    if (imported.status !== 'committed') return
    const fromBootstrap = withPublicV12Windstep(withPublicV11Highland(withPublicV10TerrainRevision(
      withFreshPublicV9Camps(withFreshPublicV7Herbs(createPublicWorldFromBootstrap(imported.root))))))
    expect(parity(fromBootstrap, maskOf(fromBootstrap), imported.root)).toBe(true)
    const required = fromBootstrap.discoveredTileIds.find((id) => id !== 'tile-3-3')!
    const baselineMissing = encodeDiscoveredTileIds(
      fromBootstrap.discoveredTileIds.filter((id) => id !== required))
    expect(parity(fromBootstrap, baselineMissing, imported.root)).toBe(false)

    const campTile = worldTileAtGrid(seed, -76, 100)
    const camp = { ...fresh, discoveredTileIds: [...fresh.discoveredTileIds, campTile.id].sort(),
      fieldCampTileIds: [campTile.id] }
    expect(parity(camp)).toBe(true)
    expect(parity(camp, maskOf(fresh))).toBe(false)
    const streamed = createStreamedWorld(seed, { x: -32, z: 0 }).state
    const away = { ...fresh, movementOwner: 'streamed' as const,
      player: { ...fresh.player, position: streamed.player.position },
      discoveredTileIds: [...new Set([...fresh.discoveredTileIds, ...streamed.discoveredTileIds])].sort() }
    expect(parity(away)).toBe(true)
    expect(parity(away, maskOf(fresh))).toBe(false)
  })

  it('matches old rejection for malformed Greenway, pit pose, Highland and wind facts', () => {
    const cache = mireglassAnchors(seed).sealCache.tile
    const pit = { ...fresh, movementOwner: 'streamed' as const,
      player: { ...fresh.player, xp: 50, level: 1, position: { ...cache.center, y: 1.65 },
        inventory: [...fresh.player.inventory, { itemId: 'mireglass_reach/item/seal' as const, quantity: 1 }],
        learnedSpellIds: ['wayfinder_glow' as const],
        skillXp: { ...fresh.player.skillXp, wayfinding: 10, spellcraft: 10, excavation: 40 } },
      discoveredTileIds: [...fresh.discoveredTileIds, cache.id].sort(),
      mireglass: { ...fresh.mireglass, fringeMarkerStudied: true,
        cacheRevealed: true, cacheExcavated: true } }
    expect(parity(pit)).toBe(true)
    expect(parity({ ...pit, mireglass: { ...pit.mireglass, cacheExcavated: false } })).toBe(false)
    expect(parity({ ...pit, player: { ...pit.player,
      position: { ...pit.player.position, y: 1.64 } } })).toBe(false)
    expect(parity({ ...fresh, greenway: { ...fresh.greenway, tiles: [] } })).toBe(false)
    expect(parity({ ...fresh, mireglass: { ...fresh.mireglass,
      herbHarvestCycles: [{ patchId: 'invented', cycle: 0 }] } })).toBe(false)
    expect(parity({ ...fresh, highland: { ...fresh.highland, landmarkDiscovered: true,
      stoneNodes: [{ id: 'invented', readyAtTick: 0 }] } })).toBe(false)
    expect(parity({ ...fresh, highland: { ...fresh.highland, landmarkDiscovered: true },
      windstep: { ...fresh.windstep, learned: true } })).toBe(true)
    expect(parity({ ...fresh, windstep: { ...fresh.windstep, learned: true } })).toBe(false)
  })

  it('keeps the lower-side ladder pose proof in the unchanged v11 validator', () => {
    const site = mireglassRouteSites(seed).find((candidate) => candidate.kind === 'ladder')!
    const tile = worldTileAtGrid(seed, site.from.x / 4, site.from.z / 4)
    const v11 = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
      withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1')))))
    const ready: PublicWorldV11State = { ...v11, movementOwner: 'streamed',
      player: { ...v11.player, position: { ...site.from },
        inventory: [...v11.player.inventory, { itemId: 'logs', quantity: site.logCost }] },
      discoveredTileIds: [...new Set([...v11.discoveredTileIds, tile.id])].sort() }
    const built = actPublicV11Mireglass(ready, { type: 'build_route', siteId: site.id })
    expect(built.rejection).toBeUndefined()
    let rising = built.state
    for (let index = 0; index < 11; index++) {
      const moved = advancePublicWorldV11Frame(rising,
        [{ type: 'move', delta: { x: 0, z: 0.16 } }])
      expect(moved.rejections).toEqual([])
      rising = moved.state
    }
    expect(parity(withPublicV12Windstep(rising))).toBe(true)
    const forged = { ...rising, player: { ...rising.player,
      position: { ...rising.player.position, y: site.from.y + 0.1 } } }
    expect(parity(withPublicV12Windstep(forged))).toBe(false)
  })

  it('rejects malformed compact shape before witness expansion', () => {
    const { discoveredTileIds: _ids, ...fields } = fresh
    const mask = maskOf(fresh)
    expect(validatePublicWorldV12CompactState({ ...fields,
      discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES - 1) }, null)).toBeNull()
    expect(validatePublicWorldV12CompactState({ ...fields, discoveredTileIds: [],
      discoveryMask: mask }, null)).toBeNull()
    expect(validatePublicWorldV12CompactState({ ...fields, discoveryMask: mask,
      greenway: { ...fields.greenway, tiles: new Array(257) } }, null)).toBeNull()
    expect(validatePublicWorldV12CompactState({ ...fields, discoveryMask: mask,
      fieldCampTileIds: ['a', 'b'] }, null)).toBeNull()
    const hidden = { ...fields, discoveryMask: mask }
    Object.defineProperty(hidden, 'hidden', { value: true })
    expect(validatePublicWorldV12CompactState(hidden, null)).toBeNull()
  })

  it('rejects a mask getter or proxy that changes after the first validated read', () => {
    const { discoveredTileIds: _ids, ...fields } = fresh
    const valid = maskOf(fresh)
    const short = new Uint8Array(DISCOVERY_MASK_BYTES - 1)
    let getterReads = 0
    const getterState = { ...fields, discoveryMask: valid }
    Object.defineProperty(getterState, 'discoveryMask', { enumerable: true,
      get: () => getterReads++ === 0 ? valid : short })
    expect(validatePublicWorldV12CompactState(getterState, null)).toBeNull()
    let proxyReads = 0
    const proxyState = new Proxy({ ...fields, discoveryMask: valid }, {
      get: (target, key, receiver) => key === 'discoveryMask'
        ? proxyReads++ === 0 ? valid : short : Reflect.get(target, key, receiver),
    })
    expect(validatePublicWorldV12CompactState(proxyState, null)).toBeNull()
  })

  it('returns an owned compact state rather than a claim about mutable caller inputs', () => {
    const { discoveredTileIds: _ids, ...fields } = fresh
    const mask = maskOf(fresh)
    const input = { ...fields, player: { ...fields.player }, discoveryMask: mask }
    const validated = validatePublicWorldV12CompactState(input, null)
    expect(validated).not.toBeNull()
    expect(validated?.player).not.toBe(input.player)
    expect(validated?.discoveryMask).not.toBe(mask)
    const firstByte = validated!.discoveryMask[0]
    const coins = validated!.player.coins
    mask[0] ^= 1
    input.player.coins += 1
    expect(validated!.discoveryMask[0]).toBe(firstByte)
    expect(validated!.player.coins).toBe(coins)
  })

  it('rejects unbounded clone inputs before structured cloning', () => {
    const { discoveredTileIds: _ids, ...fields } = fresh
    const clone = vi.spyOn(globalThis, 'structuredClone').mockImplementation(() => { throw new Error('clone reached') })
    try {
      expect(validatePublicWorldV12CompactState({ ...fields,
        seed: 'x'.repeat(5 * 1024 * 1024), greenway: { ...fields.greenway,
          padding: 'y'.repeat(5 * 1024 * 1024) }, discoveryMask: maskOf(fresh) }, null)).toBeNull()
      expect(validatePublicWorldV12CompactState({ ...fields, discoveryMask: maskOf(fresh),
        greenway: { ...fields.greenway, extraMask: maskOf(fresh) } }, null)).toBeNull()
      expect(validatePublicWorldV12CompactState({ ...fields,
        discoveryMask: new Uint8Array(new ArrayBuffer(5 * 1024 * 1024), 0, DISCOVERY_MASK_BYTES) }, null)).toBeNull()
      expect(validatePublicWorldV12CompactState({ ...fields,
        discoveryMask: new Uint8Array(Reflect.construct(ArrayBuffer,
          [DISCOVERY_MASK_BYTES, { maxByteLength: 5 * 1024 * 1024 }]) as ArrayBuffer) }, null)).toBeNull()
      expect(validatePublicWorldV12CompactState({ ...fields, discoveryMask: maskOf(fresh),
        player: { ...fields.player, coins: 1n } }, null)).toBeNull()
      expect(clone).not.toHaveBeenCalled()
    } finally { clone.mockRestore() }
  })
})
