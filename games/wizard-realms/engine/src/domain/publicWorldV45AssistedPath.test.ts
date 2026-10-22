import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import type { PublicV23Progress } from './publicWorldV23Snapshot'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import type { PublicV31Progress } from './publicWorldV31Migration'
import { replayPublicV31FramesWithEvents } from './publicWorldV31Movement'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { publicV45AssistedPathSupported } from './publicWorldV45AssistedPath'

const seed = 'wizard-realms'
const start = { x: -197.92, z: -18.04 }
const toward = (meters: number) => {
  const scale = meters / Math.hypot(0.2, 0.12)
  return { x: -0.2 * scale, z: 0.12 * scale }
}
const assisted = { substeps: [toward(0.08513), toward(0.14811)] as const,
  settle: (after: PublicV23Progress) => after }
const frame = { intents: [{ type: 'move' as const, delta: toward(0.15) }],
  walkRequested: false }

function standing(): PublicV31Progress {
  const { head } = createPublicV23Root(seed)
  const surface = resolvePublicV23Surface(head.state, start, [])
  if (!surface) throw new Error('Missing dry starter surface')
  const old = decodePublicV23Progress({ state: { ...head.state,
    movementOwner: 'streamed',
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(head.state.discoveryMask), surface.tileId])].sort()),
    player: { ...head.state.player, position: { ...start, y: surface.floorY },
      verticalVelocity: 0 } },
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }, seed)
  if (!old) throw new Error('Invalid streamed V31 fixture')
  return { ...old, terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0,
    riverBridgeIds: [], miningTools: { basicPickOwned: false,
      enchantedPickOwned: false, activePick: null }, claimedBridgeheadId: null,
    raisedSoilCells: [] }
}

const checkedFrame = (before: PublicV31Progress) =>
  replayPublicV31FramesWithEvents(before, [frame], false, () => assisted)
const remoteSoil = (before: PublicV31Progress): PublicV31Progress => ({ ...before,
  state: { ...before.state, discoveryMask: encodeDiscoveredTileIds([...new Set([
    ...decodeDiscoveredTileIds(before.state.discoveryMask), 'tile-6--1'])].sort()) },
  raisedSoilCells: [{ gx: 3, gz: -4 }] })

describe('V45 post-replay assisted support gate', () => {
  it.each([false, true])('rejects a two-step path through an open pit, remote soil=%s', (soil) => {
    const base = standing()
    const pit: PublicV31Progress = { ...base, terrain: { ...base.terrain,
      columns: [{ gx: -49, gz: -4, openDepth: 2, rewardDepth: 2, pitLadder: false }] } }
    const before = soil ? remoteSoil(pit) : pit
    expect(decodePublicV31ActionProgress(before)).not.toBeNull()
    const checked = checkedFrame(before)
    expect(checked).not.toBeNull()
    expect(checked!.events.filter((event) => event.type === 'player_moved')).toHaveLength(2)
    expect(publicV45AssistedPathSupported(before, checked!, assisted)).toBe(false)
  })

  it.each([false, true])('accepts two checked dry steps, remote soil=%s', (soil) => {
    const base = standing(), before = soil ? remoteSoil(base) : base
    expect(decodePublicV31ActionProgress(before)).not.toBeNull()
    const checked = checkedFrame(before)
    expect(checked).not.toBeNull()
    expect(publicV45AssistedPathSupported(before, checked!, assisted)).toBe(true)
    expect(before.state.tick + 1).toBe(checked!.progress.state.tick)
  })

  it('fails closed on missing, out-of-order, changed, or terminal-mismatched events', () => {
    const before = standing(), checked = checkedFrame(before)
    expect(checked).not.toBeNull()
    const events = [...checked!.events]
    const indices = events.flatMap((event, index) => event.type === 'player_moved' ? [index] : [])
    expect(indices).toHaveLength(2)
    expect(publicV45AssistedPathSupported(before,
      { ...checked!, events: events.filter((_, index) => index !== indices[0]) }, assisted)).toBe(false)
    const reversed = [...events]
    ;[reversed[indices[0]], reversed[indices[1]]] = [reversed[indices[1]], reversed[indices[0]]]
    expect(publicV45AssistedPathSupported(before,
      { ...checked!, events: reversed }, assisted)).toBe(false)
    const shifted = events.map((event, index) => event.type === 'player_moved'
      && index === indices[0] ? { ...event,
        position: { ...event.position, x: event.position.x + 0.01 } } : event)
    expect(publicV45AssistedPathSupported(before,
      { ...checked!, events: shifted }, assisted)).toBe(false)
    const wrongTick = events.map((event, index) => event.type === 'player_moved'
      && index === indices[0] ? { ...event, tick: event.tick + 1 } : event)
    expect(publicV45AssistedPathSupported(before,
      { ...checked!, events: wrongTick }, assisted)).toBe(false)
    const invalidMid = events.map((event, index) => event.type === 'player_moved'
      && index === indices[0] ? { ...event,
        position: { ...event.position, y: -1_000_000 } } : event)
    expect(publicV45AssistedPathSupported(before,
      { ...checked!, events: invalidMid }, assisted)).toBe(false)
    const terminal = checked!.progress.state.player.position
    const mismatch = { ...checked!, progress: { ...checked!.progress,
      state: { ...checked!.progress.state, player: { ...checked!.progress.state.player,
        position: { ...terminal, y: terminal.y + 0.01 } } } } }
    expect(publicV45AssistedPathSupported(before, mismatch, assisted)).toBe(false)
  })
})
