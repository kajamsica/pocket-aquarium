import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createWizardWorld } from '../domain'
import { toViewProjection } from '../App'
import { WizardHud } from './WizardHud'

const projectionAtGreenwayRing = (discoveredRingIds: string[]) => {
  const state = createWizardWorld('greenway-alpha')
  state.player.position = { ...state.fairyRings.find((ring) => ring.id === 'ring-greenway')!.position }
  state.player.discoveredRingIds = discoveredRingIds
  const projection = toViewProjection(state, [])
  expect(projection.nearbyInteraction).toMatchObject({ kind: 'fairy-ring', targetId: 'ring-greenway' })
  return projection
}

const renderHud = (projection: ReturnType<typeof projectionAtGreenwayRing>) =>
  renderToStaticMarkup(createElement(WizardHud, { projection, onIntent: () => {} }))

describe('Wizard fairy ring HUD', () => {
  it('shows only the Discover prompt at an undiscovered source, even with a discovered destination', () => {
    const markup = renderHud(projectionAtGreenwayRing(['ring-highland']))
    expect(markup).toContain('<button class="wr-prompt" data-actionable="true"')
    expect(markup).toContain('<b>Discover</b>Greenway Ring')
    expect(markup).not.toContain('<aside class="wr-panel wr-context">')
    expect(markup).not.toContain('>Travel</span>')
  })

  it('asks for another ring when only the source is discovered', () => {
    const markup = renderHud(projectionAtGreenwayRing(['ring-greenway']))
    expect(markup).toContain('<aside class="wr-panel wr-context">')
    expect(markup).toContain('Discover another fairy ring to unlock travel.')
    expect(markup).not.toContain('>Travel</span>')
  })

  it('offers travel only to discovered destinations when the source is discovered', () => {
    const projection = projectionAtGreenwayRing(['ring-greenway', 'ring-highland'])
    const withHiddenRing = {
      ...projection,
      fairyRings: projection.fairyRings.map((ring) => ring.id === 'ring-greenway'
        ? { ...ring, destinations: [...ring.destinations, { ringId: 'ring-hidden', label: 'Hidden Ring', discovered: false }] }
        : ring),
    }
    const markup = renderHud(withHiddenRing)
    expect(markup).toContain('<aside class="wr-panel wr-context">')
    expect(markup).toContain('Discovered fairy paths')
    expect(markup).toContain('<b>Highland Ring</b><span>Travel</span>')
    expect(markup).not.toContain('Hidden Ring')
    expect(markup.match(/>Travel<\/span>/g)).toHaveLength(1)
  })
})

describe('Wizard field action range', () => {
  it('matches the authoritative three-dimensional range on sloped ground', () => {
    const state = createWizardWorld('greenway-alpha')
    const mound = state.digSites.find((site) => site.id === 'practice_mound')!
    state.player.position = { ...mound.position, y: mound.position.y + 3.1 }
    state.player.inventory.push({ itemId: 'field_spade', quantity: 1 })
    state.player.equipment.mainHand = 'field_spade'
    expect(renderHud(toViewProjection(state, []))).not.toContain('aria-label="Excavate Practice mound"')
    state.player.position.y = mound.position.y + 2.9
    expect(renderHud(toViewProjection(state, []))).toContain('aria-label="Excavate Practice mound"')
  })
})
