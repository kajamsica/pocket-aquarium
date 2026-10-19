import { describe, expect, it } from 'vitest'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import type { PublicV26Progress } from './publicWorldV26Migration'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'

const seed = 'wizard-realms'
const position = { x: 12, z: 4 }
function fixture(depth = 0): PublicV26Progress {
  const { head } = createPublicV23Root(seed)
  const old = { state: head.state, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks }
  const support = publicV17StarterSupportAt({ seed,
    profile: old.state.generationProfile,
    route: old.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: old.greenwayWorks }, position)
  if (!support || support.kind !== 'ground') throw new Error('Missing old floor')
  const checked = decodePublicV23Progress({ ...old, state: { ...old.state,
    player: { ...old.state.player,
      position: { ...position, y: support.floorY } } } }, seed)
  if (!checked) throw new Error('Invalid old progress')
  return { ...checked, terrain: depth ? { ...emptyPublicV26TerrainLedger(),
    columns: [{ gx: 3, gz: 1, openDepth: depth,
      rewardDepth: depth, pitLadder: false }] } : emptyPublicV26TerrainLedger(),
    nextHomeAtMs: 0 }
}

describe('V26 return-home transition', () => {
  it('returns a genuinely pit-trapped grounded player home and preserves possessions', () => {
    const before = fixture(8), copy = structuredClone(before)
    const result = applyPublicV26ReturnHome(before, 10_000)
    if (!result.progress) throw new Error(result.rejection)
    expect(result.progress.state.player.position).toMatchObject({ x: 0, z: 0 })
    expect(result.progress.state.player.verticalVelocity).toBe(0)
    expect(result.progress.state.movementOwner).toBe('greenway')
    expect(result.progress.nextHomeAtMs).toBe(1_810_000)
    expect(result.progress.terrain).toEqual(before.terrain)
    expect(result.progress.greenwayWorks).toEqual(before.greenwayWorks)
    expect(result.progress.regionalWorks).toEqual(before.regionalWorks)
    expect(result.progress.state.player.inventory).toEqual(before.state.player.inventory)
    expect(result.progress.state.player.xp).toBe(before.state.player.xp)
    expect(before).toEqual(copy)
    expect(applyPublicV26ReturnHome(before, 10_000)).toEqual(result)
  })

  it('rejects a clear cardinal exit, an equipped pit ladder, and a midair pose', () => {
    expect(applyPublicV26ReturnHome(fixture(), 10_000)).toEqual({ rejection: 'not_trapped' })
    const pit = fixture(8)
    const ladder = { ...pit, terrain: { ...pit.terrain,
      columns: pit.terrain.columns.map((column) => ({ ...column, pitLadder: true })) } }
    expect(applyPublicV26ReturnHome(ladder, 10_000)).toEqual({ rejection: 'not_trapped' })
    const airborne = { ...pit, state: { ...pit.state,
      player: { ...pit.state.player, verticalVelocity: 1 } } }
    expect(applyPublicV26ReturnHome(airborne, 10_000)).toEqual({ rejection: 'invalid_progress' })
  })

  it('enforces writer time, cooldown, and a dry unexcavated home', () => {
    const pit = fixture(8)
    expect(applyPublicV26ReturnHome({ ...fixture(), trapped: true } as never, 10_000))
      .toEqual({ rejection: 'invalid_progress' })
    expect(applyPublicV26ReturnHome(pit, -1)).toEqual({ rejection: 'invalid_time' })
    expect(applyPublicV26ReturnHome(pit, Number.MAX_SAFE_INTEGER))
      .toEqual({ rejection: 'invalid_time' })
    expect(applyPublicV26ReturnHome({ ...pit, nextHomeAtMs: 20_000 }, 10_000))
      .toEqual({ rejection: 'cooldown' })
    expect(applyPublicV26ReturnHome({ ...pit, nextHomeAtMs: 10_000 }, 10_000).progress)
      .toBeDefined()
    const openHome = { ...pit, terrain: { ...pit.terrain,
      columns: [{ gx: 0, gz: 0, openDepth: 1, rewardDepth: 1, pitLadder: false },
        ...pit.terrain.columns] } }
    expect(applyPublicV26ReturnHome(openHome, 10_000)).toEqual({ rejection: 'unsafe_home' })
  })
})
