import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { createPublicV25Migration, decodePublicV25Lineage,
  decodePublicV25SourceReceipt, PUBLIC_V25_DATABASE_NAME, PUBLIC_V25_SCHEMA } from './publicWorldV25Migration'
import { publicV25RiverCellAtGrid, publicV25RiverCenterZ } from './publicWorldV25River'

const seed = 'wizard-realms'
const fresh = () => createPublicV24Root(createPublicV23Root(seed))
const receipt = (head = fresh().head) => ({ head, lineage: fresh().lineage })
const progress = (head: ReturnType<typeof fresh>['head']) => ({ state: head.state,
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks })
describe('V25 pinned V24 migration genesis', () => {
  it('accepts revision zero and later receipt shapes without mutating the source', () => {
    const source = receipt(), before = structuredClone(source)
    const migrated = createPublicV25Migration(source)
    expect([PUBLIC_V25_SCHEMA, PUBLIC_V25_DATABASE_NAME]).toEqual([
      'wizard-world/v25', 'wizard-realms:world:v25'])
    expect(migrated).toEqual({ lineage: { origin: 'v24-migration', seed,
      rulesProfile: 'connected-river/v1', sourceReceipt: source },
      progress: progress(source.head), relocation: null })
    expect(decodePublicV25Lineage(migrated.lineage)).toEqual(migrated.lineage)
    expect(migrated.lineage.sourceReceipt.head).not.toBe(source.head)
    expect(source).toEqual(before)
    const later = receipt({ ...source.head, saveRevision: 1, witness: { kind: 'checkpoint' } })
    expect(decodePublicV25SourceReceipt(later)).toEqual(later)
    expect(createPublicV25Migration(later).lineage.sourceReceipt).toEqual(later)
  })

  it('rejects mismatched seeds, profiles, extra keys, forged heads, and hostile input', () => {
    const source = receipt(), lineage = createPublicV25Migration(source).lineage
    expect(decodePublicV25SourceReceipt({ ...source, previous: null })).toBeNull()
    expect(decodePublicV25SourceReceipt({ ...source, head: { ...source.head,
      state: { ...source.head.state, seed: 'other' } } })).toBeNull()
    expect(decodePublicV25SourceReceipt({ ...source, head: { ...source.head,
      schemaVersion: PUBLIC_V25_SCHEMA } })).toBeNull()
    expect(decodePublicV25SourceReceipt({ ...source, lineage: { ...source.lineage, rulesProfile: 'other' } })).toBeNull()
    expect(decodePublicV25Lineage({ ...lineage, seed: 'other' })).toBeNull()
    expect(decodePublicV25Lineage({ ...lineage, rulesProfile: 'other' })).toBeNull()
    expect(decodePublicV25Lineage({ ...lineage, extra: true })).toBeNull()
    expect(() => createPublicV25Migration({ ...source, previous: null })).toThrow(RangeError)
    const hostile = new Proxy(source, { get() { throw new Error('hostile') } })
    expect(decodePublicV25SourceReceipt(hostile)).toBeNull()
    expect(decodePublicV25Lineage(new Proxy(lineage, {
      get() { throw new Error('hostile') },
    }))).toBeNull()
    expect(() => createPublicV25Migration(hostile)).toThrow(RangeError)
  })
  it('relocates a newly wet pose to the same-bank dry column without a free crossing', () => {
    const source = receipt(), base = progress(source.head)
    const point = { x: 12, z: 8 }, support = publicV17StarterSupportAt({ seed,
      profile: base.state.generationProfile, route: base.state.greenway.routes.find(
        (route) => route.id === 'greenway_ladder') ?? null,
      built: base.state.greenway.builtRouteIds.includes('greenway_ladder'),
      greenwayWorks: base.greenwayWorks }, point)
    expect(support?.kind).toBe('ground')
    expect(publicV25RiverCellAtGrid(seed, 3, 2)).toBe(true)
    const wet = decodePublicV23Progress({ ...base, state: { ...base.state,
      player: { ...base.state.player, position: { ...point, y: support!.floorY } } } }, seed)!
    const old = receipt({ ...source.head, ...wet, saveRevision: 1, witness: { kind: 'checkpoint' } })
    const before = structuredClone(old), migrated = createPublicV25Migration(old)
    expect(migrated.relocation?.from).toEqual(wet.state.player.position)
    expect(migrated.relocation?.to).toEqual(migrated.progress.state.player.position)
    expect(migrated.relocation?.to.x).toBe(point.x)
    expect(migrated.relocation?.to.z).toBe(4)
    expect(publicV25RiverCellAtGrid(seed, 3, 1)).toBe(false)
    expect(migrated.progress.state.movementOwner).toBe('greenway')
    expect(migrated.progress.state.player.inventory).toEqual(wet.state.player.inventory)
    expect(old).toEqual(before)
  })

  it('keeps an old built bridge deck valid over new water', () => {
    const source = receipt(), site = resolvePublicV17GreenwaySite(seed, 'works3:bridge:1')!
    if (site.kind !== 'bridge') throw new Error('Missing bridge fixture')
    const works = { ...source.head.greenwayWorks, builtBridgeIds: [site.id] }
    const point = { x: site.gapCenter.x, z: site.gapCenter.z }
    const support = publicV17StarterSupportAt({ seed, profile: source.head.state.generationProfile,
      route: source.head.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
      built: false, greenwayWorks: works }, point)!
    const next = decodePublicV23Progress({ ...progress(source.head), greenwayWorks: works,
      state: { ...source.head.state, player: { ...source.head.state.player,
        xp: 80, skillXp: { ...source.head.state.player.skillXp, construction: 80 },
        position: { ...point, y: support.floorY } } } }, seed)!
    const migrated = createPublicV25Migration(receipt({ ...source.head, ...next,
      saveRevision: 1, witness: { kind: 'checkpoint' } }))
    expect(migrated.relocation).toBeNull()
    expect(migrated.progress).toEqual(next)
  })

  it('rejects a valid streamed pose with no discovered dry destination', () => {
    const source = receipt(), base = progress(source.head), gz = publicV25RiverCenterZ(seed, 9)
    const point = { x: 36, z: gz * 4 }, floor = resolvePublicV23Surface(base.state, point, [])!
    const wet = decodePublicV23Progress({ ...base, state: { ...base.state,
      movementOwner: 'streamed', discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(base.state.discoveryMask), floor.tileId])].sort()),
      player: { ...base.state.player, position: { ...point, y: floor.floorY } } } }, seed)!
    expect(wet).not.toBeNull()
    expect(() => createPublicV25Migration(receipt({ ...source.head, ...wet,
      saveRevision: 1, witness: { kind: 'checkpoint' } }))).toThrow(RangeError)
  })
})
