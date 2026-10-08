import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { highlandLandmark, highlandStoneNodes } from './domain/highlandContent'
import { createFreshPublicWorld } from './domain/publicWorldState'
import { withFreshPublicV7Herbs } from './domain/publicWorldV7'
import { withFreshPublicV9Camps } from './domain/publicWorldV9State'
import { withPublicV10TerrainRevision } from './domain/publicWorldV10State'
import { withPublicV11Highland, type PublicWorldV11State } from './domain/publicWorldV11State'
import { createStreamedWorld } from './domain/streamedWorld'
import { worldTileAtGrid } from './domain/worldChunks'
import { highlandExtractionFor, highlandMapTiles, highlandTerrainFor,
  publicWorldV11ViewProjection } from './PublicV11WorldView'
import { publicWorldViewProjection } from './PublicWorldView'
import { WizardHud } from './view/WizardHud'
import { WizardMap } from './view/WizardMap'

const seed = 'greenway-alpha'
const fresh = () => withPublicV11Highland(withPublicV10TerrainRevision(
  withFreshPublicV9Camps(withFreshPublicV7Herbs(
    createFreshPublicWorld(seed, 'greenway-classic-v1')))))
const at = (state: PublicWorldV11State, x: number, z: number): PublicWorldV11State => {
  const streamed = createStreamedWorld(seed, { x, z })
  return { ...state, movementOwner: 'streamed', player: { ...state.player,
    position: streamed.state.player.position } }
}

describe('v11 Highland read-only projection', () => {
  it('marks only walked quarry ground, keeps fog unknown, and changes no old v10 projection', () => {
    const node = highlandStoneNodes(seed)[0]
    const landmark = highlandLandmark(seed)
    const start = fresh()
    const state = at({ ...start, discoveredTileIds: [node.tile.id, landmark.tile.id],
      highland: { ...start.highland, landmarkDiscovered: true } }, node.tile.center.x, node.tile.center.z)
    const before = JSON.stringify(state)
    const view = publicWorldV11ViewProjection(state, [], null)
    expect(view.map.title).toBe('Highland Quarry')
    expect(view.map.guidance).toContain('stone shelf')
    expect(view.ambience).toBe('highland-wind')
    expect(view.terrain.some((cell) => cell.highlandSurface === 'quarry')).toBe(true)
    expect(view.terrain.some((cell) => cell.highlandTrailSegment)).toBe(true)
    expect(view.resources.filter((resource) => resource.visualKind === 'highland-stone')).toHaveLength(4)
    expect(view.resources.every((resource) => resource.available)).toBe(true)
    expect(view.map.tiles.find((tile) => tile.id === node.tile.id)).toMatchObject({
      discovered: true, hasHighlandNode: true, highlandNodeReady: true })
    expect(view.map.tiles.filter((tile) => !tile.discovered).every((tile) =>
      tile.terrain === null && !tile.hasHighlandNode && !tile.hasHighlandLandmark
      && !tile.hasHighlandTrail)).toBe(true)
    expect(JSON.stringify(state)).toBe(before)
    const old = publicWorldViewProjection(start, [], null)
    expect(old.map.tiles.every((tile) => !Object.hasOwn(tile, 'hasHighlandNode'))).toBe(true)
    expect(old.terrain.every((cell) => !Object.hasOwn(cell, 'highlandSurface'))).toBe(true)
  })

  it('uses the committed recovery ledger for visible depletion and regrowth', () => {
    const node = highlandStoneNodes(seed)[0]
    const start = fresh()
    const depleted = at({ ...start,
      discoveredTileIds: [node.tile.id, highlandLandmark(seed).tile.id],
      highland: { ...start.highland, landmarkDiscovered: true,
        stoneNodes: start.highland.stoneNodes.map((entry) => entry.id === node.id
          ? { ...entry, readyAtTick: 3000 } : entry) } }, node.tile.center.x, node.tile.center.z)
    const before = publicWorldV11ViewProjection(depleted, [], null)
    expect(before.resources.find((resource) => resource.id === node.id)?.available).toBe(false)
    expect(before.map.tiles.find((tile) => tile.id === node.tile.id)?.highlandNodeReady).toBe(false)
    expect(before.highlandExtraction?.reason).toContain('field spade')
    const recovered = publicWorldV11ViewProjection({ ...depleted, tick: 3000 }, [], null)
    expect(recovered.resources.find((resource) => resource.id === node.id)?.available).toBe(true)
    expect(recovered.map.tiles.find((tile) => tile.id === node.tile.id)?.highlandNodeReady).toBe(true)
  })

  it('projects exactly the authority 3D reach and prerequisites, never makes blocked extraction actionable', () => {
    const node = highlandStoneNodes(seed)[0]
    const start = fresh()
    const onNode = at({ ...start, discoveredTileIds: [node.tile.id],
      highland: { ...start.highland, landmarkDiscovered: true } }, node.tile.center.x, node.tile.center.z)
    expect(highlandExtractionFor(onNode)).toMatchObject({ nodeId: node.id, actionable: false,
      reason: 'A field spade is required' })
    const owned = { ...onNode, player: { ...onNode.player,
      inventory: [...onNode.player.inventory, { itemId: 'field_spade' as const, quantity: 1 }] } }
    expect(highlandExtractionFor(owned)?.reason).toBe('Equip your field spade')
    const equipped = { ...owned, player: { ...owned.player,
      equipment: { ...owned.player.equipment, mainHand: 'field_spade' as const } } }
    expect(highlandExtractionFor(equipped)?.reason).toBe('Excavation Lv2 required')
    const skilled = { ...equipped, player: { ...equipped.player,
      skillXp: { ...equipped.player.skillXp, excavation: 30 } } }
    expect(highlandExtractionFor(skilled)?.actionable).toBe(true)
    expect(publicWorldV11ViewProjection(skilled, [], null).nearbyInteraction).toMatchObject({
      targetId: node.id, action: 'Extract', actionable: true })
    const full = { ...skilled, player: { ...skilled.player,
      backpackCapacity: skilled.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0) + 1 } }
    expect(highlandExtractionFor(full)?.reason).toBe('Make room for 2 stone')
    const escrowFull = { ...skilled, player: { ...skilled.player,
      backpackCapacity: skilled.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0) + 2,
      tradeSlots: [{ ...skilled.player.tradeSlots[0], itemId: 'logs' as const, quantity: 1, unitPrice: 1 },
        skilled.player.tradeSlots[1], skilled.player.tradeSlots[2], skilled.player.tradeSlots[3]] as typeof skilled.player.tradeSlots } }
    expect(highlandExtractionFor(escrowFull)?.reason).toBe('Make room for 2 stone')
    const elevated = { ...skilled, player: { ...skilled.player,
      position: { ...skilled.player.position, y: node.tile.center.y + 3.01 } } }
    expect(highlandExtractionFor(elevated)).toBeUndefined()
  })

  it('names early eastern terrain wilderness and leaves Mireglass visuals out of that region', () => {
    const start = fresh()
    const eastern = at(start, 100, 0)
    const view = publicWorldV11ViewProjection(eastern, [], null)
    expect(view.map.title).toBe('Uncharted wilderness')
    expect(view.map.guidance).toContain('highland')
    expect(view.map.guidance).not.toContain('Mireglass Reach')
    expect(view.routes).toEqual([])
    expect(view.landmarks).toEqual([])
    expect(view.terrain.some((cell) => cell.highlandTrailSegment)).toBe(true)
    const western = at(start, -392, 332)
    const old = publicWorldViewProjection(western, [], null)
    const v11 = publicWorldV11ViewProjection(western, [], null)
    expect(v11.map.title).toBe(old.map.title)
    expect(v11.map.guidance).toBe(old.map.guidance)
    expect(v11.terrain).toBe(old.terrain)
  })

  it('tags visible ridge rock and gallery only in the v11 projection', () => {
    const state = at(fresh(), 552, -466)
    const view = publicWorldV11ViewProjection(state, [], null)
    const cellAt = (x: number, z: number) => view.terrain.find((cell) =>
      cell.position[0] === x && cell.position[2] === z)
    expect(view.highlandRidgeActive).toBe(true)
    expect(cellAt(560, -472)?.highlandRidgeCell).toBe('rock')
    expect(cellAt(560, -468)?.highlandRidgeCell).toBe('gallery')
    expect(cellAt(560, -464)?.highlandRidgeCell).toBe('gallery')
    expect(cellAt(556, -472)?.highlandRidgeCell).toBeUndefined()
    expect(view.terrain.some((cell) => cell.highlandRidgeCell)).toBe(true)

    const base = publicWorldViewProjection(state, [], null)
    expect(base.highlandRidgeActive).toBeUndefined()
    expect(base.terrain.every((cell) => !Object.hasOwn(cell, 'highlandRidgeCell'))).toBe(true)
  })

  it('guides an old saved pose inside ridge rock without moving or rewriting it', () => {
    const state = at(fresh(), 580, -500)
    const saved = JSON.stringify(state)
    const view = publicWorldV11ViewProjection(state, [], null)
    expect(view.map.guidance).toContain('Old save inside newly raised ridge rock')
    expect(view.map.guidance).toContain('Ridge scenery is temporarily hidden')
    expect(view.map.guidance).toContain('Walk E about 20 m to the nearest open cell')
    expect(view.player.position).toEqual([state.player.position.x, state.player.position.y,
      state.player.position.z])
    expect(JSON.stringify(state)).toBe(saved)
    const map = renderToStaticMarkup(createElement(WizardMap, { projection: view, open: true,
      onToggle: () => {}, onIntent: () => {},
      buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>() }))
    expect(map).toContain('aria-label="Map guidance"')
    expect(map).toContain('Walk E about 20 m to the nearest open cell')

    const open = publicWorldV11ViewProjection(at(fresh(), 580, -468), [], null)
    expect(open.map.guidance).not.toContain('Old save')
    expect(open.map.guidance).not.toContain('temporarily hidden')
  })

  it('caches bounded visual terrain and includes only discovered Highland markers in the overview', () => {
    const start = fresh()
    const trail = worldTileAtGrid(seed, 96 / 4, 0)
    const node = highlandStoneNodes(seed)[0]
    const landmark = highlandLandmark(seed)
    const state = at({ ...start, discoveredTileIds: [trail.id, node.tile.id, landmark.tile.id],
      highland: { ...start.highland, landmarkDiscovered: true } }, node.tile.center.x, node.tile.center.z)
    const view = publicWorldV11ViewProjection(state, [], null)
    expect(view.map.overview?.()).toBe(view.map.overview?.())
    expect(view.map.overview?.().cells.flatMap((cell) => cell.markers)).toContain('Quarry Crown')
    expect(view.map.overview?.().cells.flatMap((cell) => cell.markers)).toContain('Stone shelf')
    expect(highlandTerrainFor(view.terrain, seed)).toBe(highlandTerrainFor(view.terrain, seed))
    const hidden = publicWorldV11ViewProjection({ ...state, discoveredTileIds: [] }, [], null)
    expect(hidden.map.overview?.().cells.flatMap((cell) => cell.markers)).not.toContain('Quarry Crown')
    expect(hidden.map.overview?.().cells.flatMap((cell) => cell.markers)).not.toContain('Stone shelf')
    const tiles = highlandMapTiles(hidden.map.tiles, state)
    expect(tiles.filter((tile) => !tile.discovered).every((tile) =>
      !tile.hasHighlandNode && !tile.hasHighlandLandmark)).toBe(true)
  })

  it('renders an accessible Quarry Crown map cue and explicit extraction action without claiming audio', () => {
    const node = highlandStoneNodes(seed)[0]
    const landmark = highlandLandmark(seed)
    const start = fresh()
    const state = at({ ...start,
      discoveredTileIds: [node.tile.id, landmark.tile.id],
      player: { ...start.player, inventory: [...start.player.inventory,
        { itemId: 'field_spade', quantity: 1 }],
      equipment: { ...start.player.equipment, mainHand: 'field_spade' },
      skillXp: { ...start.player.skillXp, excavation: 30 } },
      highland: { ...start.highland, landmarkDiscovered: true } }, node.tile.center.x, node.tile.center.z)
    const view = publicWorldV11ViewProjection(state, [], null)
    const map = renderToStaticMarkup(createElement(WizardMap, { projection: view, open: true,
      onToggle: () => {}, onIntent: () => {},
      buttonRef: createRef<HTMLButtonElement>(), closeRef: createRef<HTMLButtonElement>() }))
    expect(map).toContain('aria-label="Highland wind"')
    expect(map).toContain('aria-label="North-up world map')
    expect(map).toContain('Quarry Crown')
    expect(map).toContain('ready stone shelf')
    expect(map).not.toContain('audio')
    const hud = renderToStaticMarkup(createElement(WizardHud, { projection: view, onIntent: () => {} }))
    expect(hud).toContain('aria-label="Extract quarry stone"')
    expect(hud).toContain('<b>Extract</b>Highland stone outcrop')
  })
})
