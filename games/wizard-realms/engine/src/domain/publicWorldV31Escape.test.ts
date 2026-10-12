import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { applyPublicV26ReturnHome } from './publicWorldV26Escape'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { replayPublicV30Witness } from './publicWorldV30Snapshot'
import { replayPublicV31Witness } from './publicWorldV31Snapshot'
import type { PublicV31Progress } from './publicWorldV31Migration'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { applyPublicV31ReturnHome } from './publicWorldV31Escape'
import { replayPublicV31FramesWithEvents } from './publicWorldV31Movement'

const seed = 'wizard-realms'
const source = createPublicV23Root(seed).head
const move = (x: number, z: number) => [{ intents: [{ type: 'move' as const,
  delta: { x, z } }], walkRequested: false }]

function at(x: number, z: number): PublicV31Progress | null {
  const support = publicV17StarterSupportAt({ seed,
    profile: source.state.generationProfile,
    route: source.state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: source.greenwayWorks }, { x, z })
  if (!support) return null
  const old = decodePublicV23Progress({ state: { ...source.state,
    player: { ...source.state.player, position: { x, y: support.floorY, z } } },
  greenwayWorks: source.greenwayWorks, regionalWorks: source.regionalWorks }, seed)
  return old ? { ...old, terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0,
    riverBridgeIds: [], miningTools: { basicPickOwned: false,
      enchantedPickOwned: false, activePick: null }, claimedBridgeheadId: null,
    raisedSoilCells: [] } : null
}

function inherited(progress: PublicV31Progress) {
  const { raisedSoilCells: _raised, ...v30 } = progress
  return v30
}

function newlyClosedExit(): PublicV31Progress {
  const base = at(-18.05, -20)
  if (!base) throw new Error('Missing west-bank fixture')
  const candidate: PublicV31Progress = { ...base,
    state: { ...base.state, discoveryMask: encodeDiscoveredTileIds([
      ...new Set([...decodeDiscoveredTileIds(base.state.discoveryMask),
        'tile--1--2'])].sort()) },
    raisedSoilCells: [{ gx: -4, gz: -5 }] }
  if (!decodePublicV31ActionProgress(candidate)) throw new Error('Invalid raised-bank fixture')
  const frames = move(0.1, 0)
  if (!replayPublicV30Witness(inherited(candidate), { kind: 'frame-batch/v1', frames })
    || replayPublicV31FramesWithEvents(candidate, frames))
    throw new Error('The lift no longer closes the inherited east exit')
  return candidate
}

describe('V31 effective-support Return Home', () => {
  it('preserves inherited rescue, cooldown, and a clear-exit rejection', () => {
    const base = at(12, 4)
    if (!base) throw new Error('Missing rescue fixture')
    const trapped: PublicV31Progress = { ...base, terrain: { ...base.terrain,
      columns: [{ gx: 3, gz: 1, openDepth: 8, rewardDepth: 8, pitLadder: false }] } }
    expect(applyPublicV31ReturnHome(trapped, 10_000))
      .toEqual({ ...replayPublicV30Witness(inherited(trapped),
        { kind: 'return-home/v1', atMs: 10_000 }), raisedSoilCells: [] })
    expect(applyPublicV31ReturnHome({ ...trapped, nextHomeAtMs: 20_000 }, 10_000)).toBeNull()
    expect(applyPublicV31ReturnHome(base, 10_000)).toBeNull()
    expect(applyPublicV31ReturnHome({ ...trapped, state: { ...trapped.state,
      player: { ...trapped.state.player, verticalVelocity: 1 } } }, 10_000)).toBeNull()
  })

  it('rescues a structurally valid single-lift trap that V30 sees as reachable', () => {
    const progress = newlyClosedExit(), dx = 1, dz = 0
    const playerGx = Math.ceil(progress.state.player.position.x / 4 - 0.5)
    const playerGz = Math.ceil(progress.state.player.position.z / 4 - 0.5)
    const columns = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
      .filter(([x, z]) => x !== dx || z !== dz)
      .map(([x, z]) => ({ gx: playerGx + x, gz: playerGz + z,
        openDepth: 8, rewardDepth: 8, pitLadder: false }))
      .sort((a, b) => a.gx - b.gx || a.gz - b.gz)
    const boxed: PublicV31Progress = { ...progress, terrain: { ...progress.terrain, columns } }
    expect(decodePublicV31ActionProgress(boxed)).not.toBeNull()
    expect(applyPublicV26ReturnHome({ state: boxed.state,
      greenwayWorks: boxed.greenwayWorks, regionalWorks: boxed.regionalWorks,
      terrain: boxed.terrain, nextHomeAtMs: boxed.nextHomeAtMs }, 10_000))
      .toEqual({ rejection: 'not_trapped' })
    expect(replayPublicV30Witness(inherited(boxed),
      { kind: 'return-home/v1', atMs: 10_000 })).toBeNull()
    const escaped = applyPublicV31ReturnHome(boxed, 10_000)
    expect(replayPublicV31Witness(boxed,
      { kind: 'return-home/v1', atMs: 10_000 })).toEqual(escaped)
    expect(escaped?.state.player.position).toMatchObject({ x: 0, z: 0 })
    expect(escaped?.nextHomeAtMs).toBe(1_810_000)
    expect(escaped?.raisedSoilCells).toEqual(boxed.raisedSoilCells)
    expect(applyPublicV31ReturnHome({ ...boxed, nextHomeAtMs: 20_000 }, 10_000)).toBeNull()
  }, 60_000)
})
