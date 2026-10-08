import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { highlandLandmark } from './domain/highlandContent'
import { createFreshPublicWorld } from './domain/publicWorldState'
import { actPublicV12Windstep } from './domain/publicWorldV12Authority'
import { withFreshPublicV7Herbs } from './domain/publicWorldV7'
import { withFreshPublicV9Camps } from './domain/publicWorldV9State'
import { withPublicV10TerrainRevision } from './domain/publicWorldV10State'
import { withPublicV11Highland } from './domain/publicWorldV11State'
import { withPublicV12Windstep, type PublicWorldV12State } from './domain/publicWorldV12State'
import { createStreamedWorld } from './domain/streamedWorld'
import { WORLD_CELL_METERS, worldTileAtGrid } from './domain/worldChunks'
import { publicWorldV11ViewProjection } from './PublicV11WorldView'
import { publicWorldV12ViewProjection } from './PublicV12WorldView'
import { WizardHud } from './view/WizardHud'

const seed = 'greenway-alpha'
const fresh = () => withPublicV12Windstep(withPublicV11Highland(withPublicV10TerrainRevision(
  withFreshPublicV9Camps(withFreshPublicV7Herbs(
    createFreshPublicWorld(seed, 'greenway-classic-v1'))))))
const at = (state: PublicWorldV12State, x: number, z: number): PublicWorldV12State => ({
  ...state, movementOwner: 'streamed', player: { ...state.player,
    position: createStreamedWorld(seed, { x, z }).state.player.position },
})
const atCrown = (learned = false): PublicWorldV12State => {
  const start = fresh()
  const crown = highlandLandmark(seed)
  return at({ ...start, discoveredTileIds: [...start.discoveredTileIds, crown.tile.id],
    highland: { ...start.highland, landmarkDiscovered: true },
    windstep: { ...start.windstep, learned } }, crown.tile.center.x, crown.tile.center.z)
}

function buttonsWithLabel(node: ReactNode, label: string): Array<{ onClick?: () => void; disabled?: boolean }> {
  if (Array.isArray(node)) return node.flatMap((child) => buttonsWithLabel(child, label))
  if (!isValidElement(node)) return []
  const props = node.props as { 'aria-label'?: string; onClick?: () => void; disabled?: boolean; children?: ReactNode }
  return [...(node.type === 'button' && props['aria-label'] === label ? [props] : []),
    ...buttonsWithLabel(props.children, label)]
}

describe('v12 Windward Step presentation', () => {
  it('keeps the legacy spell list, fog, and v11 projection unchanged', () => {
    const state = fresh()
    const { windContentRevision: _revision, windstep: _windstep, ...v11 } = state
    const before = JSON.stringify(state)
    const prior = publicWorldV11ViewProjection(v11, [], null)
    const next = publicWorldV12ViewProjection(state, [], null)
    expect(next.learnedSpellIds).toEqual(prior.learnedSpellIds)
    expect(next.windwardStep?.learned).toBe(false)
    expect(next.windwardStep?.glyph).toBeNull()
    expect(next.map.tiles).toEqual(prior.map.tiles)
    expect(next.map.tiles.filter((tile) => !tile.discovered).every((tile) =>
      tile.terrain === null && !tile.hasHighlandLandmark && !tile.hasHighlandNode)).toBe(true)
    expect(prior.windwardStep).toBeUndefined()
    expect(renderToStaticMarkup(createElement(WizardHud, { projection: prior, onIntent: () => {} })))
      .not.toContain('Windward Step')
    expect(JSON.stringify(state)).toBe(before)
  })

  it('shows the Crown glyph only after discovery and gates study by true 3D reach', () => {
    const crown = highlandLandmark(seed)
    const undiscovered = at(fresh(), crown.tile.center.x, crown.tile.center.z)
    expect(publicWorldV12ViewProjection(undiscovered, [], null).windwardStep?.glyph).toBeNull()
    const nearby = atCrown()
    const view = publicWorldV12ViewProjection(nearby, [], null)
    expect(view.windwardStep?.glyph).toMatchObject({ canStudy: true,
      position: [crown.tile.center.x, crown.tile.center.y, crown.tile.center.z] })
    expect(view.map.tiles.find((tile) => tile.id === crown.tile.id)?.hasHighlandLandmark).toBe(true)
    const raised = { ...nearby, player: { ...nearby.player,
      position: { ...nearby.player.position, y: crown.tile.center.y + 3.01 } } }
    expect(publicWorldV12ViewProjection(raised, [], null).windwardStep?.glyph?.canStudy).toBe(false)
    const jumping = { ...nearby, player: { ...nearby.player, verticalVelocity: 1 } }
    expect(publicWorldV12ViewProjection(jumping, [], null).windwardStep?.glyph?.canStudy).toBe(false)
    const studied = publicWorldV12ViewProjection(atCrown(true), [], null)
    expect(studied.windwardStep?.glyph?.canStudy).toBe(false)
    expect(studied.windwardStep?.learned).toBe(true)
    expect(studied.learnedSpellIds).not.toContain('windward_step')
  })

  it('uses the same Crown center and 3 m edge as the study authority', () => {
    const crown = highlandLandmark(seed)
    const ready = atCrown()
    const atReach = (offset: number): PublicWorldV12State => {
      const x = crown.tile.center.x + offset
      const tile = worldTileAtGrid(seed, Math.ceil(x / WORLD_CELL_METERS - 0.5),
        Math.ceil(crown.tile.center.z / WORLD_CELL_METERS - 0.5))
      return { ...ready, discoveredTileIds: [...new Set([...ready.discoveredTileIds, tile.id])].sort(),
        player: { ...ready.player, position: { ...ready.player.position, x, y: tile.center.y } } }
    }
    const inside = atReach(2.99)
    const outside = atReach(3.01)
    expect(publicWorldV12ViewProjection(inside, [], null).windwardStep?.glyph)
      .toMatchObject({ position: [crown.tile.center.x, crown.tile.center.y, crown.tile.center.z],
        canStudy: true })
    expect(actPublicV12Windstep(inside, { type: 'study_windward_glyph' }).event?.type)
      .toBe('windward_glyph_studied')
    expect(publicWorldV12ViewProjection(outside, [], null).windwardStep?.glyph?.canStudy).toBe(false)
    expect(actPublicV12Windstep(outside, { type: 'study_windward_glyph' }).rejection?.code)
      .toBe('too_far')
  })

  it('shows active and cooldown seconds from saved ticks and disables casting off the dry trail', () => {
    const learned = atCrown(true)
    expect(publicWorldV12ViewProjection(learned, [], null).windwardStep?.canCast).toBe(true)
    const cast = { ...learned, tick: 100, windstep: { ...learned.windstep,
      activeUntilTick: 1300, nextCastTick: 1900 } }
    const active = publicWorldV12ViewProjection(cast, [], null)
    expect(active.windwardStep).toMatchObject({ activeSeconds: 60, cooldownSeconds: 90, canCast: false })
    const cooling = publicWorldV12ViewProjection({ ...cast, tick: 1300 }, [], null)
    expect(cooling.windwardStep).toMatchObject({ activeSeconds: 0, cooldownSeconds: 30, canCast: false })
    const ready = publicWorldV12ViewProjection({ ...cast, tick: 1900 }, [], null)
    expect(ready.windwardStep).toMatchObject({ activeSeconds: 0, cooldownSeconds: 0, canCast: true })
    const away = at({ ...cast, tick: 1900 }, 360, -300)
    expect(publicWorldV12ViewProjection(away, [], null).windwardStep?.canCast).toBe(false)
    expect(publicWorldV12ViewProjection({ ...learned, player: { ...learned.player,
      verticalVelocity: 1 } }, [], null).windwardStep?.canCast).toBe(false)
  })

  it('compares only discovered buyers, using live store prices and carried stone not escrow', () => {
    const start = atCrown(true)
    const held = { ...start, player: { ...start.player,
      inventory: [...start.player.inventory, { itemId: 'stone' as const, quantity: 2 }] } }
    const view = publicWorldV12ViewProjection(held, [], null)
    expect(view.windwardStep?.stoneReturn).toEqual({ quantity: 2, offers: [
      { storeId: 'store-highland', name: 'Highland Arcanum', unitPrice: 3, total: 6 },
      { storeId: 'store-greenway', name: 'Greenway Outfitters', unitPrice: 1, total: 2 },
    ] })
    const highland = start.greenway.stores.find((store) => store.id === 'store-highland')!
    const hiddenId = worldTileAtGrid(seed, Math.round(highland.position.x / WORLD_CELL_METERS),
      Math.round(highland.position.z / WORLD_CELL_METERS)).id
    const hidden = { ...held, discoveredTileIds: held.discoveredTileIds.filter((id) => id !== hiddenId) }
    expect(publicWorldV12ViewProjection(hidden, [], null).windwardStep?.stoneReturn?.offers)
      .toEqual([{ storeId: 'store-greenway', name: 'Greenway Outfitters', unitPrice: 1, total: 2 }])
    const escrowOnly = { ...start, player: { ...start.player,
      tradeSlots: [{ ...start.player.tradeSlots[0], itemId: 'stone' as const, quantity: 2, unitPrice: 3 },
        start.player.tradeSlots[1], start.player.tradeSlots[2], start.player.tradeSlots[3]] as typeof start.player.tradeSlots } }
    expect(publicWorldV12ViewProjection(escrowOnly, [], null).windwardStep?.stoneReturn).toBeUndefined()
  })

  it('dispatches one semantic study or cast intent and announces market and spell status', () => {
    const studyView = publicWorldV12ViewProjection(atCrown(), [], null)
    const onIntent = vi.fn()
    const studyHud = WizardHud({ projection: studyView, onIntent })
    const study = buttonsWithLabel(studyHud, 'Study Windward Step glyph')
    expect(study).toHaveLength(2) // HUD and touch layout share the same semantic action.
    expect(study.every((button) => button.disabled === false)).toBe(true)
    study[0].onClick?.()
    expect(onIntent).toHaveBeenCalledWith({ type: 'windward.study' })
    const learned = atCrown(true)
    const held = { ...learned, player: { ...learned.player,
      inventory: [...learned.player.inventory, { itemId: 'stone' as const, quantity: 2 }] } }
    const castView = publicWorldV12ViewProjection(held, [], null)
    const castHud = WizardHud({ projection: castView, onIntent })
    const cast = buttonsWithLabel(castHud, 'Cast Windward Step')
    expect(cast).toHaveLength(2)
    cast[0].onClick?.()
    expect(onIntent).toHaveBeenCalledWith({ type: 'windward.cast' })
    const markup = renderToStaticMarkup(createElement(WizardHud, { projection: castView, onIntent }))
    expect(markup).toContain('Windward Step: Learned. Ready on the dry Highland trail.')
    expect(markup).toContain('Highland Arcanum 3g each (6g total); Greenway Outfitters 1g each (2g total)')
    const cooling = publicWorldV12ViewProjection({ ...learned, tick: 1300,
      windstep: { ...learned.windstep, activeUntilTick: 1300, nextCastTick: 1900 } }, [], null)
    expect(renderToStaticMarkup(createElement(WizardHud, { projection: cooling, onIntent })))
      .toContain('Windward Step: Learned. Recast in 30s.')
  })
})
