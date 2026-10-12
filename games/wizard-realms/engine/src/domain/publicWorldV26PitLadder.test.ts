import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { publicWorldV16TileAtGrid } from './publicWorldV16GreenwaySites'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import type { PublicV26Progress } from './publicWorldV26Migration'
import { applyPublicV26PitLadderAction, decodePublicV26PitLadderAction } from './publicWorldV26PitLadder'
import { decodePublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { worldTileAtGrid } from './worldChunks'

const seed = 'wizard-realms'
const id = (gx: number, gz: number) => `tile-${gx + 3}-${gz + 3}`
const action = (gx: number, gz: number) => ({ kind: 'place-pit-ladder' as const, gx, gz })

function at(gx: number, gz: number, logCount = 4): PublicV26Progress {
  const { head } = createPublicV23Root(seed)
  const base = { state: head.state, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks }
  const x = gx * 4, z = gz * 4
  const support = publicV17StarterSupportAt({ seed, profile: base.state.generationProfile,
    route: base.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: base.greenwayWorks }, { x, z })
  if (!support || support.kind !== 'ground') throw new Error('Needs ordinary ground')
  const player = structuredClone(base.state.player)
  player.position = { x, y: support.floorY, z }
  player.inventory = player.inventory.filter((stack) => stack.itemId !== 'logs')
  if (logCount) player.inventory.push({ itemId: 'logs', quantity: logCount })
  const discoveryMask = encodeDiscoveredTileIds([...new Set([
    ...decodeDiscoveredTileIds(base.state.discoveryMask), id(gx, gz)])].sort())
  const old = decodePublicV23Progress({ ...base,
    state: { ...base.state, player, discoveryMask } }, seed)
  if (!old) throw new Error('Needs valid old progress')
  return { ...old, terrain: { columns: [{ gx, gz, openDepth: 2,
    rewardDepth: 2, pitLadder: false }],
    bag: { soil: 0, stone: 0, iron_ore: 0, gold_ore: 0, diamond: 0 } }, nextHomeAtMs: 0 }
}

function target() {
  for (let gz = -5; gz <= 1; gz += 1) for (let gx = -6; gx <= 6; gx += 1) {
    if (gx === 0 && gz === 0 || publicV25RiverCellAtGrid(seed, gx, gz)
      || worldTileAtGrid(seed, gx, gz).terrain === 'wetland') continue
    try {
      const progress = at(gx, gz)
      if (applyPublicV26PitLadderAction(progress, action(gx, gz)).progress) {
        return { gx, gz, progress }
      }
    } catch { /* This cell has no valid old ground support. */ }
  }
  throw new Error('No ordinary reachable pit fixture')
}

describe('V26 saved pit-ladder action', () => {
  it('allows a saved pit ladder on authored dry bank despite the raw wet classification', () => {
    const gx = -2, gz = 4
    expect(worldTileAtGrid(seed, gx, gz).terrain).toBe('wetland')
    expect(publicWorldV16TileAtGrid(seed, gx, gz).terrain).toBe('loam')
    const progress = at(gx, gz)
    const result = applyPublicV26PitLadderAction(progress, action(gx, gz))
    expect(result.progress?.terrain.columns[0]).toMatchObject({ gx, gz, pitLadder: true })
  })

  it('accepts only an exact canonical clicked cell', () => {
    expect(decodePublicV26PitLadderAction(action(2, -1))).toEqual(action(2, -1))
    expect(decodePublicV26PitLadderAction({ ...action(2, -1), eligible: true })).toBeNull()
    expect(decodePublicV26PitLadderAction({ kind: 'dig', gx: 2, gz: -1 })).toBeNull()
    expect(decodePublicV26PitLadderAction(action(256, 0))).toBeNull()
    expect(decodePublicV26PitLadderAction(Object.create(action(2, -1)))).toBeNull()
  })

  it('spends exactly four owned logs and grants one construction event without mutating input', () => {
    const { gx, gz } = target(), progress = at(gx, gz, 6), before = structuredClone(progress)
    const result = applyPublicV26PitLadderAction(progress, action(gx, gz))
    if (!result.progress) throw new Error(result.rejection)
    const next = result.progress
    expect(next.terrain.columns).toEqual([{ gx, gz, openDepth: 2,
      rewardDepth: 2, pitLadder: true }])
    expect(next.terrain.bag).toEqual(progress.terrain.bag)
    expect(next.state.player.inventory.filter((stack) => stack.itemId === 'logs'))
      .toEqual([{ itemId: 'logs', quantity: 2 }])
    expect(next.state.player.xp).toBe(progress.state.player.xp + 60)
    expect(next.state.player.skillXp.construction)
      .toBe(progress.state.player.skillXp.construction + 60)
    expect(next.state.eventSequence).toBe(progress.state.eventSequence + 1)
    expect(next.nextHomeAtMs).toBe(progress.nextHomeAtMs)
    expect(next.greenwayWorks).toEqual(progress.greenwayWorks)
    expect(next.regionalWorks).toEqual(progress.regionalWorks)
    expect(decodePublicV23Progress({ state: next.state, greenwayWorks: next.greenwayWorks,
      regionalWorks: next.regionalWorks }, seed)).not.toBeNull()
    expect(decodePublicV26TerrainLedger(next.terrain)).toEqual(next.terrain)
    expect(progress).toEqual(before)
    expect(applyPublicV26PitLadderAction(progress, action(gx, gz))).toEqual(result)
  })

  it('rejects insufficient logs, shallow or duplicate columns, and a wrong player cell', () => {
    const { gx, gz, progress } = target()
    const poor = at(gx, gz, 3), shallow = { ...progress, terrain: { ...progress.terrain,
      columns: [{ gx, gz, openDepth: 1, rewardDepth: 2, pitLadder: false }] } }
    const duplicate = { ...progress, terrain: { ...progress.terrain,
      columns: [{ gx, gz, openDepth: 2, rewardDepth: 2, pitLadder: true }] } }
    const otherGx = gx === 6 ? gx - 1 : gx + 1
    const wrong = { ...progress, state: { ...progress.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(progress.state.discoveryMask), id(otherGx, gz)])].sort()) } }
    for (const [input, clicked, reason] of [
      [poor, action(gx, gz), 'not_owned'], [shallow, action(gx, gz), 'needs_depth'],
      [duplicate, action(gx, gz), 'already_done'], [wrong, action(otherGx, gz), 'wrong_cell'],
    ] as const) {
      const before = structuredClone(input)
      expect(applyPublicV26PitLadderAction(input, clicked)).toEqual({ rejection: reason })
      expect(input).toEqual(before)
    }
  })

  it('rejects home and wet targets without changing the saved progress', () => {
    const { gx, gz, progress } = target(), before = structuredClone(progress)
    expect(applyPublicV26PitLadderAction(progress, action(0, 0)))
      .toEqual({ rejection: 'occupied' })
    const wetGz = 2
    expect(publicV25RiverCellAtGrid(seed, gx, wetGz)
      || worldTileAtGrid(seed, gx, wetGz).terrain === 'wetland').toBeTruthy()
    const wet = { ...progress, state: { ...progress.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(progress.state.discoveryMask), id(gx, wetGz)])].sort()) } }
    const wetBefore = structuredClone(wet)
    expect(applyPublicV26PitLadderAction(wet, action(gx, wetGz)))
      .toEqual({ rejection: 'wet' })
    expect(progress).toEqual(before)
    expect(wet).toEqual(wetBefore)
  })
})
